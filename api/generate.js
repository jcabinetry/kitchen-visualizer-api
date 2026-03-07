export default async function handler(req, res) {

res.setHeader("Access-Control-Allow-Origin","*")
res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS")
res.setHeader("Access-Control-Allow-Headers","Content-Type")

if(req.method==="OPTIONS"){
return res.status(200).end()
}

if(req.method!=="POST"){
return res.status(405).json({error:"Method not allowed"})
}

try{

const {image,color,style,island,hardware}=req.body

if(!image){
return res.status(400).json({error:"Missing image"})
}

const islandInstruction=island
?`If the kitchen has an island change only the island cabinetry to ${island}.`
:`Keep the island the same color as the main cabinets.`

const hardwareInstruction=hardware
?`Use ${hardware} hardware on the cabinet doors and drawer fronts.`
:`Keep existing cabinet hardware.`

const prompt=`Edit this exact kitchen photo. Keep the same layout walls appliances counters backsplash floor lighting and camera angle. Only change cabinet color cabinet door style and hardware. Main cabinets should be ${color}. Door style should be ${style}. ${islandInstruction} ${hardwareInstruction}. Do not redesign the room.`

const response=await fetch("https://api.openai.com/v1/images/edits",{
method:"POST",
headers:{
"Content-Type":"application/json",
"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`
},
body:JSON.stringify({
model:"gpt-image-1",
images:[
{
type:"image_url",
image_url:{
url:image
}
}
],
prompt:prompt,
size:"1536x1024"
})
})

const data=await response.json()

if(!response.ok){
return res.status(response.status).json({error:data.error?.message||"OpenAI error"})
}

const img=data.data[0]

if(img.b64_json){
return res.status(200).json({
image:`data:image/png;base64,${img.b64_json}`
})
}

if(img.url){
return res.status(200).json({
image:img.url
})
}

return res.status(500).json({error:"No image returned"})

}catch(e){

return res.status(500).json({
error:"Server error",
details:e.toString()
})

}

}
