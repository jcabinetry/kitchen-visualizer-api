function cookie(name,value,maxAge){
  return name+'='+encodeURIComponent(value)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+maxAge;
}
export default async function handler(req,res){
  const {code,state,error}=req.query||{};
  if(error)return res.redirect('/academic-planner.html?classroom=error');
  if(!code)return res.status(400).send('Missing authorization code.');
  const clientId=process.env.GOOGLE_CLASSROOM_CLIENT_ID;
  const clientSecret=process.env.GOOGLE_CLASSROOM_CLIENT_SECRET;
  const redirectUri=(process.env.GOOGLE_CLASSROOM_REDIRECT_URI||((req.headers['x-forwarded-proto']||'https')+'://'+req.headers.host+'/api/classroom-callback'));
  if(!clientId||!clientSecret)return res.status(500).send('Google Classroom OAuth is not configured yet.');
  const tokenRes=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      code:String(code),client_id:clientId,client_secret:clientSecret,
      redirect_uri:redirectUri,grant_type:'authorization_code'
    })
  });
  const token=await tokenRes.json();
  if(!tokenRes.ok||!token.access_token)return res.status(400).send('Google sign-in could not be completed.');
  const cookies=[cookie('classroom_access',token.access_token,Math.max(60,Number(token.expires_in||3600)-30))];
  if(token.refresh_token)cookies.push(cookie('classroom_refresh',token.refresh_token,60*60*24*30));
  res.setHeader('Set-Cookie',cookies);
  let returnTo='/academic-planner.html';
  try{if(state){const s=JSON.parse(Buffer.from(String(state),'base64url').toString('utf8'));if(String(s.returnTo||'').startsWith('/'))returnTo=s.returnTo}}catch{}
  res.redirect(returnTo+(returnTo.includes('?')?'&':'?')+'classroom=connected');
}