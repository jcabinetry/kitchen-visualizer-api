import { setCorsHeaders } from "./_lib/cors.js";
import { saveCatalog, cleanCatalogId } from "./_lib/catalogStore.js";

function slug(v){return String(v||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,90)}
function admin(req,res){const t=process.env.ADMIN_API_TOKEN||process.env.ADMIN_TOKEN||"";if(!t)return true;const s=req.headers["x-admin-token"]||req.headers.authorization?.replace(/^Bearer\s+/i,"");if(s===t)return true;res.status(401).json({error:"Unauthorized."});return false}
function parseJson(text){const raw=String(text||"").trim();try{return JSON.parse(raw)}catch(e){}const m=raw.match(/\{[\s\S]*\}/);if(!m)throw new Error("AI did not return JSON.");return JSON.parse(m[0])}
function uniqueItems(items){const seen=new Set();return (items||[]).filter(item=>{const key=slug((item.type||"")+"-"+(item.name||"")+"-"+(item.pdf||"")+"-"+(item.page||""));if(!key||seen.has(key))return false;seen.add(key);return true})}

async function ai(content,max=12000){
  if(!process.env.OPENAI_API_KEY)throw new Error("OPENAI_API_KEY is not configured.");
  const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.CATALOG_VISION_MODEL||process.env.CATALOG_EXTRACT_MODEL||"gpt-4.1",input:[{role:"user",content}],max_output_tokens:max})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d?.error?.message||"Page image extraction failed.");
  return parseJson(d.output_text||JSON.stringify(d));
}

async function scanPages(name,pages){
  const content=[{type:"input_text",text:`Look at these cabinet catalog page images and list every visible cabinet option. Return JSON only: {"items":[{"type":"door|finish|species|line|other","name":"visible name","description":"short note","pdf":"file name","page":"page number","imageHint":"where picture/swatch appears"}],"notes":""}. Be aggressive. If you can read any cabinet color, finish, door style, species, product line, collection name, wood species, stain, paint, or material, include it. Manufacturer: ${name}.`}];
  pages.slice(0,4).forEach((p,n)=>{content.push({type:"input_text",text:`Image ${n+1}: ${p.fileName||"PDF"}, page ${p.pageNumber||n+1}`});content.push({type:"input_image",image_url:p.imageBase64})});
  const result=await ai(content,12000);
  return uniqueItems((Array.isArray(result.items)?result.items:[]).map(item=>({type:String(item.type||"other"),name:String(item.name||"").trim(),description:String(item.description||""),pdf:String(item.pdf||item.fileName||""),page:String(item.page||""),imageHint:String(item.imageHint||item.hint||"")})).filter(item=>item.name));
}

async function buildCatalog(name,items){
  const text=JSON.stringify(uniqueItems(items)).slice(0,150000);
  const content=[{type:"input_text",text:`Convert these extracted cabinet catalog page items into a saved cabinet catalog. Return JSON only: {"lines":[{"name":"collection","description":"","doors":[{"name":"door style","description":"","image":"","imageStatus":"needs-image"}],"finishes":[{"name":"finish/color","description":"","swatch":"","swatchStatus":"needs-image"}],"species":["species"]}],"imagePlan":[{"type":"door or swatch","name":"item name","pdf":"file name","page":"page number","hint":"where the picture/swatch appears"}],"notes":""}. Put door style names under doors, color/paint/stain/finish names under finishes, and wood/material names under species. Do not invent names, but do not leave it empty if items exist. Manufacturer: ${name}. Items: ${text}`}];
  return await ai(content,18000);
}

function normalize(name,data){return (Array.isArray(data?.lines)?data.lines:[]).map((line,i)=>{const lineName=String(line.name||`Line ${i+1}`).trim();return {id:slug(lineName)||`line-${i+1}`,name:lineName,description:String(line.description||"").trim(),doors:(Array.isArray(line.doors)?line.doors:[]).map(x=>{const label=String(x.name||x.label||"").trim();return {id:slug(label),label,value:`${name} ${label} cabinet door style`,image:x.image||"",thumbnail:x.image||"",imageStatus:x.image?"ready":(x.imageStatus||"needs-image"),desc:String(x.description||"Catalog door style").trim()}}).filter(x=>x.label),finishes:(Array.isArray(line.finishes)?line.finishes:[]).map(x=>{const label=String(x.name||x.label||"").trim();const img=x.swatch||x.image||"";return {id:slug(label),label,value:`${name} ${label} cabinet finish`,image:img,swatch:img,thumbnail:img,swatchStatus:img?"ready":(x.swatchStatus||"needs-image"),desc:String(x.description||"Catalog finish").trim()}}).filter(x=>x.label),species:Array.isArray(line.species)?Array.from(new Set(line.species.map(String).filter(Boolean))):[]}}).filter(l=>l.doors.length||l.finishes.length||l.species.length)}

export default async function handler(req,res){
  if(setCorsHeaders(req,res,"POST, OPTIONS"))return;res.setHeader("Cache-Control","no-store, max-age=0");
  if(req.method!=="POST")return res.status(405).json({error:"Method not allowed."});if(!admin(req,res))return;
  try{
    const body=req.body||{};
    const name=String(body.name||"Imported Catalog").trim();
    const catalogId=cleanCatalogId(body.catalogId||slug(name));
    const pages=Array.isArray(body.pages)?body.pages:[];
    const inputItems=Array.isArray(body.items)?body.items:[];
    if(!catalogId)throw new Error("Manufacturer name is required.");

    if(body.scanOnly){
      if(!pages.length)throw new Error("No PDF page images were rendered.");
      const items=await scanPages(name,pages);
      return res.status(200).json({items,count:items.length});
    }

    let extracted,lines,method="batched-page-vision",pageImages=Number(body.pageImages||0);
    if(inputItems.length){
      extracted=await buildCatalog(name,inputItems);
      lines=normalize(name,extracted);
      method="batched-page-items";
    }else{
      if(!pages.length)throw new Error("No PDF page images were rendered.");
      const items=await scanPages(name,pages);
      if(!items.length)throw new Error("Vision scan found no readable catalog option names on the rendered pages.");
      extracted=await buildCatalog(name,items);
      lines=normalize(name,extracted);
      pageImages=pages.length;
    }

    if(!lines.length)throw new Error("Vision scan found text, but could not build catalog options.");
    const sourceUrls=Array.from(new Set((Array.isArray(body.sourceUrls)?body.sourceUrls:[]).concat(inputItems.map(i=>i.pdf).filter(Boolean),pages.map(p=>p.fileName||"PDF")).filter(Boolean)));
    const catalog=await saveCatalog({catalogId,name,version:new Date().toISOString().slice(0,10),sourceType:"pdf-page-images",sourceUrl:sourceUrls[0]||"page-images",sourceUrls,notes:extracted.notes||"PDF page images extracted.",extraction:{engine:"v5-batched-page-vision",status:"ready-needs-images",updatedAt:new Date().toISOString(),method,imagePlan:extracted.imagePlan||[]},stats:{sources:sourceUrls.length,pdfSources:sourceUrls.length,pageImages,items:inputItems.length,lines:lines.length,doors:lines.reduce((s,l)=>s+l.doors.length,0),finishes:lines.reduce((s,l)=>s+l.finishes.length,0),species:Array.from(new Set(lines.flatMap(l=>l.species||[]))).length},manufacturers:[{id:slug(name),name,sourceUrl:sourceUrls[0]||"page-images",sourceUrls,lines}]});
    res.status(200).json({catalog,message:"Catalog extracted from PDF page images. Door and swatch image cropping is still next."});
  }catch(e){res.status(400).json({error:e?.message||"Page image extraction failed."})}
}
