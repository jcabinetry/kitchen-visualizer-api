import { setCorsHeaders } from "./_lib/cors.js";
import { saveCatalog, cleanCatalogId } from "./_lib/catalogStore.js";

function slug(v){return String(v||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,90)}
function admin(req,res){const t=process.env.ADMIN_API_TOKEN||process.env.ADMIN_TOKEN||"";if(!t)return true;const s=req.headers["x-admin-token"]||req.headers.authorization?.replace(/^Bearer\s+/i,"");if(s===t)return true;res.status(401).json({error:"Unauthorized."});return false}
function pdfBuffer(v){return Buffer.from(String(v||"").replace(/^data:application\/pdf;base64,/,""),"base64")}
function json(text){const raw=String(text||"").trim();try{return JSON.parse(raw)}catch(e){}const m=raw.match(/\{[\s\S]*\}/);if(!m)throw new Error("AI did not return JSON.");return JSON.parse(m[0])}

async function uploadToOpenAI(buffer,name){
  const form=new FormData();
  form.append("purpose","user_data");
  form.append("file",new Blob([buffer],{type:"application/pdf"}),name||"catalog.pdf");
  const r=await fetch("https://api.openai.com/v1/files",{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:form});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d?.error?.message||"PDF upload to AI failed.");
  return d.id;
}

async function runAI(name,pdfs){
  if(!process.env.OPENAI_API_KEY)throw new Error("OPENAI_API_KEY is not configured.");
  const content=[{type:"input_text",text:`Extract a cabinet manufacturer catalog from the attached PDF files. Cross-reference all PDFs. Return JSON only: {"lines":[{"name":"collection","description":"","doors":[{"name":"door style","description":"","image":"","imageStatus":"needs-image"}],"finishes":[{"name":"finish/color","description":"","swatch":"","swatchStatus":"needs-image"}],"species":["species"]}],"imagePlan":[{"type":"door or swatch","name":"item name","pdf":"file name","page":"page number","hint":"where the picture appears"}],"notes":""}. Include all door styles, colors, finishes, stains, paints, species and materials. Manufacturer: ${name}.`}];
  const ids=[];
  for(let i=0;i<pdfs.length;i++){
    const b=pdfBuffer(pdfs[i].fileBase64);
    if(!b.length)throw new Error((pdfs[i].fileName||"PDF")+" is empty.");
    if(b.slice(0,4).toString()!=="%PDF")throw new Error((pdfs[i].fileName||"PDF")+" is not a valid PDF.");
    const id=await uploadToOpenAI(b,pdfs[i].fileName||`catalog-${i+1}.pdf`);
    ids.push(id);
    content.push({type:"input_text",text:`PDF ${i+1}: ${pdfs[i].fileName||`catalog-${i+1}.pdf`}`});
    content.push({type:"input_file",file_id:id});
  }
  const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.CATALOG_EXTRACT_MODEL||"gpt-4.1-mini",input:[{role:"user",content}],max_output_tokens:16000})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d?.error?.message||"AI extraction failed.");
  return {data:json(d.output_text||JSON.stringify(d)),fileIds:ids};
}

function normalize(name,data){
  return (Array.isArray(data?.lines)?data.lines:[]).map((line,i)=>{const lineName=String(line.name||`Line ${i+1}`).trim();return {id:slug(lineName)||`line-${i+1}`,name:lineName,description:String(line.description||"").trim(),doors:(Array.isArray(line.doors)?line.doors:[]).map(x=>{const label=String(x.name||x.label||"").trim();return {id:slug(label),label,value:`${name} ${label} cabinet door style`,image:x.image||"",thumbnail:x.image||"",imageStatus:x.image?"ready":(x.imageStatus||"needs-image"),desc:String(x.description||"Catalog door style").trim()}}).filter(x=>x.label),finishes:(Array.isArray(line.finishes)?line.finishes:[]).map(x=>{const label=String(x.name||x.label||"").trim();const img=x.swatch||x.image||"";return {id:slug(label),label,value:`${name} ${label} cabinet finish`,image:img,swatch:img,thumbnail:img,swatchStatus:img?"ready":(x.swatchStatus||"needs-image"),desc:String(x.description||"Catalog finish").trim()}}).filter(x=>x.label),species:Array.isArray(line.species)?Array.from(new Set(line.species.map(String).filter(Boolean))):[]}}).filter(l=>l.doors.length||l.finishes.length||l.species.length)
}

export default async function handler(req,res){
  if(setCorsHeaders(req,res,"POST, OPTIONS"))return;
  res.setHeader("Cache-Control","no-store, max-age=0");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed."});
  if(!admin(req,res))return;
  try{
    const body=req.body||{};const name=String(body.name||"Imported Catalog").trim();const catalogId=cleanCatalogId(body.catalogId||slug(name));const pdfs=Array.isArray(body.pdfs)?body.pdfs:[];
    if(!catalogId)throw new Error("Manufacturer name is required.");
    if(!pdfs.length)throw new Error("Upload one or more PDFs.");
    const extracted=await runAI(name,pdfs);const lines=normalize(name,extracted.data);const sourceUrls=pdfs.map((p,i)=>p.fileName||`PDF ${i+1}`);
    const catalog=await saveCatalog({catalogId,name,version:new Date().toISOString().slice(0,10),sourceType:"uploaded-pdfs",sourceUrl:sourceUrls[0]||"uploaded-pdf",sourceUrls,notes:extracted.data.notes||"Uploaded PDFs extracted.",extraction:{engine:"v3-upload",status:lines.length?"ready-needs-images":"needs-review",updatedAt:new Date().toISOString(),imagePlan:extracted.data.imagePlan||[]},stats:{sources:pdfs.length,pdfSources:pdfs.length,lines:lines.length,doors:lines.reduce((s,l)=>s+l.doors.length,0),finishes:lines.reduce((s,l)=>s+l.finishes.length,0),species:Array.from(new Set(lines.flatMap(l=>l.species||[]))).length},manufacturers:[{id:slug(name),name,sourceUrl:sourceUrls[0]||"uploaded-pdf",sourceUrls,lines}]});
    res.status(200).json({catalog,message:"Catalog extracted. Door and swatch images are marked for the next image step."});
  }catch(e){res.status(400).json({error:e?.message||"Catalog extraction failed."})}
}
