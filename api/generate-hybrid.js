import { renderHybridCabinetFaces } from "./_lib/hybridCabinetRenderer.js";

export const config = {
  maxDuration: 60,
  api: { bodyParser: { sizeLimit: "35mb" } }
};

export default async function handler(req,res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  if(req.method==="OPTIONS") return res.status(200).end();
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed."});
  try {
    const body=req.body||{};
    if(!body.image) return res.status(400).json({error:"Missing kitchen image."});
    if(!body.catalogDoorReference) return res.status(400).json({error:"Missing approved cabinet door reference."});
    const result=await renderHybridCabinetFaces({
      image:body.image,
      faces:body.cabinetFaces,
      doorReference:body.catalogDoorReference,
      drawerReference:body.catalogDrawerReference,
      upperHex:body.upperSwatchHex||body.mainCustomHex,
      baseHex:body.baseSwatchHex||body.islandCustomHex,
      upperSwatch:body.mainCustomReference||body.catalogSwatchReference,
      baseSwatch:body.islandCustomReference||body.catalogBaseSwatchReference
    });
    return res.status(200).json({image:result.image,faceCount:result.faceCount,mode:"hybrid-face-render"});
  } catch(error) {
    return res.status(500).json({error:error?.message||"Hybrid cabinet render failed."});
  }
}
