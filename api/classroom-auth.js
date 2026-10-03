export default async function handler(req,res){
  const clientId=process.env.GOOGLE_CLASSROOM_CLIENT_ID;
  const redirectUri=(process.env.GOOGLE_CLASSROOM_REDIRECT_URI||((req.headers['x-forwarded-proto']||'https')+'://'+req.headers.host+'/api/classroom-callback'));
  if(!clientId)return res.status(500).send('Google OAuth is not configured yet.');
  const returnTo=String(req.query.returnTo||'/academic-planner.html');
  const state=Buffer.from(JSON.stringify({returnTo,ts:Date.now()})).toString('base64url');
  const scopes=[
    'openid','email','profile',
    'https://www.googleapis.com/auth/classroom.courses.readonly',
    'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
    'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar.events'
  ].join(' ');
  const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id',clientId);
  u.searchParams.set('redirect_uri',redirectUri);
  u.searchParams.set('response_type','code');
  u.searchParams.set('scope',scopes);
  u.searchParams.set('access_type','offline');
  u.searchParams.set('prompt','consent');
  u.searchParams.set('include_granted_scopes','true');
  u.searchParams.set('state',state);
  res.redirect(u.toString());
}