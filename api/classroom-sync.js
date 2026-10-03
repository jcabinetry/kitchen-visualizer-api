function parseCookies(req){
  return Object.fromEntries(String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),decodeURIComponent(v.slice(i+1))]}));
}
async function api(path,access){
  const r=await fetch('https://classroom.googleapis.com/v1'+path,{headers:{authorization:'Bearer '+access}});
  const j=await r.json(); if(!r.ok)throw new Error(j?.error?.message||'Google Classroom request failed'); return j;
}
function dueDate(cw){
  if(!cw.dueDate)return null;
  const d=cw.dueDate;
  return [d.year,String(d.month).padStart(2,'0'),String(d.day).padStart(2,'0')].join('-');
}
export default async function handler(req,res){
  try{
    const c=parseCookies(req);let access=c.classroom_access;
    if(!access&&c.classroom_refresh){
      const clientId=process.env.GOOGLE_CLASSROOM_CLIENT_ID,clientSecret=process.env.GOOGLE_CLASSROOM_CLIENT_SECRET;
      const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:c.classroom_refresh,grant_type:'refresh_token'})});
      const j=await r.json(); if(r.ok&&j.access_token)access=j.access_token;
    }
    if(!access)return res.status(401).json({error:'Connect Google Classroom first.'});
    const courseData=await api('/courses?courseStates=ACTIVE&pageSize=100',access);
    const courses=courseData.courses||[];
    const assignments=[];const gradeMap=new Map();
    for(const course of courses){
      let pageToken='';
      do{
        const q=new URLSearchParams({pageSize:'100'});if(pageToken)q.set('pageToken',pageToken);
        const cwData=await api('/courses/'+encodeURIComponent(course.id)+'/courseWork?'+q.toString(),access);
        for(const cw of (cwData.courseWork||[])){
          let sub=null;
          try{
            const s=await api('/courses/'+encodeURIComponent(course.id)+'/courseWork/'+encodeURIComponent(cw.id)+'/studentSubmissions?userId=me',access);
            sub=(s.studentSubmissions||[])[0]||null;
          }catch{}
          const due=dueDate(cw);
          if(!due)continue;
          const state=String(sub?.state||'').toUpperCase();
          const returned=state==='RETURNED';
          const turned=state==='TURNED_IN'||returned;
          const today=new Date();today.setHours(0,0,0,0);
          const d=new Date(due+'T12:00:00');
          const hasGrade=sub?.assignedGrade!=null||sub?.draftGrade!=null;
          const status=returned?'graded':(state==='TURNED_IN'?'waiting':(d<today?'missing':'assigned'));
          assignments.push({
            id:'gc-'+course.id+'-'+cw.id,
            course:course.name||'Class',
            title:cw.title||'Assignment',
            type:String(cw.workType||'ASSIGNMENT').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,m=>m.toUpperCase()),
            due,status,
            classroomState:state||null,
            submitted:turned,
            waitingOnGrade:state==='TURNED_IN',
            graded:returned,
            points:cw.maxPoints??null,
            grade:sub?.assignedGrade??sub?.draftGrade??null,
            notes:cw.description||'',
            link:cw.alternateLink||course.alternateLink||''
          });
          if(sub?.assignedGrade!=null&&cw.maxPoints){
            const prev=gradeMap.get(course.id)||{course:course.name,earned:0,possible:0};
            prev.earned+=Number(sub.assignedGrade);prev.possible+=Number(cw.maxPoints);gradeMap.set(course.id,prev);
          }
        }
        pageToken=cwData.nextPageToken||'';
      }while(pageToken);
    }
    const grades=[...gradeMap.values()].filter(g=>g.possible>0).map(g=>({course:g.course,score:Math.round((g.earned/g.possible)*100),goal:85}));
    res.setHeader('Cache-Control','no-store');
    res.status(200).json({courses:courses.map(c=>({id:c.id,name:c.name})),assignments,grades});
  }catch(e){
    res.status(500).json({error:e.message||'Classroom sync failed'});
  }
}