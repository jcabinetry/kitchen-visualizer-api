function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),decodeURIComponent(v.slice(i+1))]}))}
async function token(req){
 const c=cookies(req); if(c.classroom_access)return c.classroom_access;
 if(!c.classroom_refresh)return null;
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLASSROOM_CLIENT_ID,client_secret:process.env.GOOGLE_CLASSROOM_CLIENT_SECRET,refresh_token:c.classroom_refresh,grant_type:'refresh_token'})});
 const j=await r.json(); return r.ok?j.access_token:null;
}
function decode(s){try{return Buffer.from(String(s||'').replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8')}catch{return''}}
function header(h,n){return (h||[]).find(x=>String(x.name).toLowerCase()===n)?.value||''}
function findBody(p){if(!p)return'';if(p.body?.data)return decode(p.body.data);for(const x of (p.parts||[])){const b=findBody(x);if(b)return b}return''}
function guess(subject,body){
 const text=(subject+' '+body).replace(/\s+/g,' ');
 if(!/(missing|overdue|due|assignment|quiz|test|project|homework)/i.test(text))return null;
 const m=text.match(/(?:due|by)\s+(?:on\s+)?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);
 let due=null;if(m){const d=new Date(m[1]);if(!isNaN(d)){due=d.toISOString().slice(0,10)}}
 return {title:subject||'School reminder',course:'School',due:due||null,type:/test/i.test(text)?'Test':/quiz/i.test(text)?'Quiz':/project/i.test(text)?'Project':'Assignment'};
}
export default async function handler(req,res){
 try{
  const access=await token(req); if(!access)return res.status(401).json({error:'Connect the Google school account first.'});
  const q=encodeURIComponent('newer_than:30d (assignment OR missing OR overdue OR due OR quiz OR test OR project OR homework)');
  const lr=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=40&q='+q,{headers:{authorization:'Bearer '+access}});
  const lj=await lr.json(); if(!lr.ok)throw new Error(lj?.error?.message||'Gmail access failed');
  const msgs=await Promise.all((lj.messages||[]).slice(0,30).map(async m=>{const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+m.id+'?format=full',{headers:{authorization:'Bearer '+access}});const j=await r.json();if(!r.ok)return null;const subject=header(j.payload?.headers,'subject'),from=header(j.payload?.headers,'from'),body=findBody(j.payload).slice(0,5000);return {id:m.id,subject,from,snippet:j.snippet||'',suggestion:guess(subject,body||j.snippet||'')}}));
  res.setHeader('Cache-Control','no-store');res.status(200).json({items:msgs.filter(Boolean)});
 }catch(e){res.status(500).json({error:e.message||'Gmail scan failed'})}
}