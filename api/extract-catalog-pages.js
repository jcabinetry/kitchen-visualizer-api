import { setCorsHeaders } from "./_lib/cors.js";
import { saveCatalog, cleanCatalogId } from "./_lib/catalogStore.js";

function slug(v){return String(v||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,90)}
function admin(req,res){const t=process.env.ADMIN_API_TOKEN||process.env.ADMIN_TOKEN||"";if(!t)return true;const s=req.headers["x-admin-token"]||req.headers.authorization?.replace(/^Bearer\s+/i,"");if(s===t)return true;res.status(401).json({error:"Unauthorized."});return false}
function parseJson(text){const raw=String(text||"").trim();try{return JSON.parse(raw)}catch(e){}const m=raw.match(/\{[\s\S]*\}/);if(!m)throw new Error("AI did not return JSON.");return JSON.parse(m[0])}
function responseText(data){if(data?.output_text)return data.output_text;const parts=[];(data?.output||[]).forEach(o=>(o.content||[]).forEach(c=>{if(typeof c.text==="string")parts.push(c.text);if(typeof c.output_text==="string")parts.push(c.output_text)}));return parts.join("\n")||JSON.stringify(data)}
function uniqueItems(items){const seen=new Set();return (items||[]).filter(item=>{const key=slug((item.type||"")+"-"+(item.name||"")+"-"+(item.pdf||"")+"-"+(item.page||""));if(!key||seen.has(key))return false;seen.add(key);return true})}
function compactItems(items){return uniqueItems(items).map(item=>({type:item.type,name:item.name,description:item.description,pdf:item.pdf,page:item.page,imageHint:item.imageHint,bbox:item.bbox,bboxKind:item.bboxKind,confidence:item.confidence}))}
function itemAsset(item){return item?.image||item?.swatch||item?.thumbnail||""}
function matchesLabel(label,item){const a=slug(label),b=slug(item?.name);return !!a&&!!b&&(a===b||a.includes(b)||b.includes(a))}
function isDoorType(item){return /door|style/i.test(String(item?.type||""))}
function isFinishType(item){return /(finish|color|colour|swatch|stain|paint|glaze|sheen)/i.test(String(item?.type||""))}
function isGenericGuess(item){const n=slug(item?.name);return /^(door|door-style|cabinet-door|shaker-door|shaker-style-door|flat-panel-door|slab-door|raised-panel-door|recessed-panel-door|finish|color|colour|paint|stain|wood-finish|swatch|sample)$/.test(n)}
function attachAssets(lines,items){const withAssets=uniqueItems(items).filter(item=>itemAsset(item)&&!isGenericGuess(item));lines.forEach(line=>{(line.doors||[]).forEach(door=>{const found=withAssets.find(item=>isDoorType(item)&&matchesLabel(door.label,item));if(found){door.image=itemAsset(found);door.thumbnail=itemAsset(found);door.imageStatus="ready";}});(line.finishes||[]).forEach(finish=>{const found=withAssets.find(item=>isFinishType(item)&&matchesLabel(finish.label,item));if(found){finish.swatch=itemAsset(found);finish.image=itemAsset(found);finish.thumbnail=itemAsset(found);finish.swatchStatus="ready";}})});return lines}
function imagePlanFromItems(items){return uniqueItems(items).filter(item=>item.imageHint||item.bbox).map(item=>({type:item.type||"item",name:item.name||"",pdf:item.pdf||"",page:item.page||"",hint:item.imageHint||"",bbox:item.bbox||null,bboxKind:item.bboxKind||""}))}
function cleanBbox(bbox,type){if(!Array.isArray(bbox)||bbox.length<4)return null;let [x,y,w,h]=bbox.map(Number);if(!isFinite(x)||!isFinite(y)||!isFinite(w)||!isFinite(h))return null;x=Math.max(0,Math.min(1000,x));y=Math.max(0,Math.min(1000,y));w=Math.max(0,Math.min(1000-x,w));h=Math.max(0,Math.min(1000-y,h));if(w<18||h<18)return null;if(isFinishType({type})&&(w>420||h>420))return null;if(isDoorType({type})&&(w>620||h>760))return null;return [Math.round(x),Math.round(y),Math.round(w),Math.round(h)]}

async function ai(content,max=12000){
  if(!process.env.OPENAI_API_KEY)throw new Error("OPENAI_API_KEY is not configured.");
  const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.CATALOG_VISION_MODEL||process.env.CATALOG_EXTRACT_MODEL||"gpt-4.1",input:[{role:"user",content}],max_output_tokens:max})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d?.error?.message||"Page image extraction failed.");
  return parseJson(responseText(d));
}

async function scanPages(name,pages){
  const content=[{type:"input_text",text:`Look at these cabinet catalog page images and list visible cabinet catalog options. Return JSON only: {"items":[{"type":"door|finish|species|line|other","name":"exact visible product/finish name","description":"short note","pdf":"file name","page":"page number","imageHint":"where exact sample appears","bbox":[x,y,width,height],"bboxKind":"door|swatch|none","confidence":0.0}],"notes":""}.

Rules for names:
- Use exact readable catalog labels only. Do not invent generic names from appearance.
- Do not output names like "Shaker-style Door", "Slab Door", "Flat-panel Door", "cabinet door", "finish", or "swatch" unless those exact words are the printed product name.
- Include door styles, finish/color names, species, product lines, collections, paints, stains, glazes, and materials when their labels are readable.

Rules for image bbox:
- bbox uses tight normalized 0-1000 page coordinates.
- Only include bbox when the exact labeled item has a visible isolated product sample on that same page.
- For a door, bbox must include only the door sample/front, not a full kitchen scene, cover photo, room photo, page banner, logo, text block, or neighboring door.
- For a finish/color, bbox must include only the color/material chip or swatch rectangle, not the label text, whole row, whole page, or neighboring chips.
- If you cannot confidently connect the picture/swatch to the exact label, leave bbox null and bboxKind "none".
- Prefer missing images over wrong images. Manufacturer: ${name}.`}];
  pages.slice(0,4).forEach((p,n)=>{content.push({type:"input_text",text:`Image ${n+1}: ${p.fileName||"PDF"}, page ${p.pageNumber||n+1}`});content.push({type:"input_image",image_url:p.imageBase64})});
  const result=await ai(content,12000);
  return uniqueItems((Array.isArray(result.items)?result.items:[]).map(item=>{const type=String(item.type||"other");return {type,name:String(item.name||"").trim(),description:String(item.description||""),pdf:String(item.pdf||item.fileName||""),page:String(item.page||""),imageHint:String(item.imageHint||item.hint||""),bbox:cleanBbox(item.bbox,type),bboxKind:String(item.bboxKind||""),confidence:Number(item.confidence||0)||0}}).filter(item=>item.name&&!isGenericGuess(item)));
}

async function buildCatalog(name,items){
  const text=JSON.stringify(compactItems(items)).slice(0,150000);
  const content=[{type:"input_text",text:`Convert these extracted cabinet catalog page items into a saved cabinet catalog. Return JSON only: {"lines":[{"name":"collection","description":"","doors":[{"name":"door style","description":"","image":"","imageStatus":"needs-image"}],"finishes":[{"name":"finish/color","description":"","swatch":"","swatchStatus":"needs-image"}],"species":["species"]}],"imagePlan":[{"type":"door or swatch","name":"item name","pdf":"file name","page":"page number","hint":"where the picture/swatch appears","bbox":[x,y,width,height]}],"notes":""}. Put exact visible door style names under doors, color/paint/stain/finish names under finishes, and wood/material names under species. Do not invent names, do not create generic visual names, and do not leave it empty if readable items exist. Manufacturer: ${name}. Items: ${text}`}];
  return await ai(content,18000);
}

function normalize(name,data){return (Array.isArray(data?.lines)?data.lines:[]).map((line,i)=>{const lineName=String(line.name||`Line ${i+1}`).trim();return {id:slug(lineName)||`line-${i+1}`,name:lineName,description:String(line.description||"").trim(),doors:(Array.isArray(line.doors)?line.doors:[]).map(x=>{const label=String(x.name||x.label||"").trim();return {id:slug(label),label,value:`${name} ${label} cabinet door style`,image:x.image||"",thumbnail:x.image||"",imageStatus:x.image?"ready":(x.imageStatus||"needs-image"),desc:String(x.description||"Catalog door style").trim()}}).filter(x=>x.label&&!isGenericGuess({name:x.label,type:"door"})),finishes:(Array.isArray(line.finishes)?line.finishes:[]).map(x=>{const label=String(x.name||x.label||"").trim();const img=x.swatch||x.image||"";return {id:slug(label),label,value:`${name} ${label} cabinet finish`,image:img,swatch:img,thumbnail:img,swatchStatus:img?"ready":(x.swatchStatus||"needs-image"),desc:String(x.description||"Catalog finish").trim()}}).filter(x=>x.label&&!isGenericGuess({name:x.label,type:"finish"})),species:Array.isArray(line.species)?Array.from(new Set(line.species.map(String).filter(Boolean))):[]}}).filter(l=>l.doors.length||l.finishes.length||l.species.length)}

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

    let extracted,lines,method="batched-page-vision",pageImages=Number(body.pageImages||0),sourceItems=inputItems.filter(item=>!isGenericGuess(item));
    if(inputItems.length){
      extracted=await buildCatalog(name,sourceItems);
      lines=normalize(name,extracted);
      lines=attachAssets(lines,sourceItems);
      method="batched-page-items";
    }else{
      if(!pages.length)throw new Error("No PDF page images were rendered.");
      sourceItems=await scanPages(name,pages);
      if(!sourceItems.length)throw new Error("Vision scan found no readable catalog option names on the rendered pages.");
      extracted=await buildCatalog(name,sourceItems);
      lines=normalize(name,extracted);
      lines=attachAssets(lines,sourceItems);
      pageImages=pages.length;
    }

    if(!lines.length)throw new Error("Vision scan found text, but could not build catalog options.");
    const sourceUrls=Array.from(new Set((Array.isArray(body.sourceUrls)?body.sourceUrls:[]).concat(sourceItems.map(i=>i.pdf).filter(Boolean),pages.map(p=>p.fileName||"PDF")).filter(Boolean)));
    const readyDoors=lines.reduce((s,l)=>s+(l.doors||[]).filter(d=>d.image).length,0);
    const readySwatches=lines.reduce((s,l)=>s+(l.finishes||[]).filter(f=>f.swatch).length,0);
    const imagePlan=(Array.isArray(extracted.imagePlan)&&extracted.imagePlan.length?extracted.imagePlan:imagePlanFromItems(sourceItems));
    const catalog=await saveCatalog({catalogId,name,version:new Date().toISOString().slice(0,10),sourceType:"pdf-page-images",sourceUrl:sourceUrls[0]||"page-images",sourceUrls,notes:extracted.notes||"PDF page images extracted.",extraction:{engine:"v7-strict-cropped-page-vision",status:(readyDoors||readySwatches)?"ready-with-images":"ready-needs-images",updatedAt:new Date().toISOString(),method,imagePlan},stats:{sources:sourceUrls.length,pdfSources:sourceUrls.length,pageImages,items:sourceItems.length,lines:lines.length,doors:lines.reduce((s,l)=>s+l.doors.length,0),finishes:lines.reduce((s,l)=>s+l.finishes.length,0),doorImages:readyDoors,swatchImages:readySwatches,species:Array.from(new Set(lines.flatMap(l=>l.species||[]))).length},manufacturers:[{id:slug(name),name,sourceUrl:sourceUrls[0]||"page-images",sourceUrls,lines}]});
    res.status(200).json({catalog,message:"Catalog extracted from PDF page images."});
  }catch(e){res.status(400).json({error:e?.message||"Page image extraction failed."})}
}
