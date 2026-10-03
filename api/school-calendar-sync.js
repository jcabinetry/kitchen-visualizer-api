function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),decodeURIComponent(v.slice(i+1))]}))}
async function token(req){const c=cookies(req);if(c.classroom_access)return c.classroom_access;if(!c.classroom_refresh)return null;const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLASSROOM_CLIENT_ID,client_secret:process.env.GOOGLE_CLASSROOM_CLIENT_SECRET,refresh_token:c.classroom_refresh,grant_type:'refresh_token'})});const j=await r.json();return r.ok?j.access_token:null}
export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'POST required'});
 try{
  const access=await token(req);if(!access)return res.status(401).json({error:'Connect the Google school account first.'});
  const items=Array.isArray(req.body?.assignments)?req.body.assignments.slice(0,50):[];let created=0;
  for(const a of items){
   const body={summary:(a.type? a.type+': ':'')+(a.title||'School item'),description:(a.course||'School')+' • Added by Molly\'s School Planner',start:{date:a.due},end:{date:new Date(new Date(a.due+'T12:00:00').getTime()+86400000).toISOString().slice(0,10)},extendedProperties:{private:{mollyPlannerId:String(a.id||'')}}};
   const r=await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events',{method:'POST',headers:{authorization:'Bearer '+access,'content-type':'application/json'},body:JSON.stringify(body)});if(r.ok)created++;
  }
  res.status(200).json({created});
 }catch(e){res.status(500).json({error:e.message||'Calendar sync failed'})}
}