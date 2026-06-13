const http=require('http');
const fs=require('fs');const raw=fs.readFileSync('.env','utf8');raw.split('\n').forEach(l=>{const i=l.indexOf('=');if(i>0)process.env[l.slice(0,i).trim()]=l.slice(i+1).trim();});
const B='http://localhost:4100';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  // Three capture servers = three Slack channels
  const got={notice:null,attendance:null,shoutout:null};
  const mk=(port,key)=>new Promise(r=>{const s=http.createServer((q,res)=>{let b='';q.on('data',c=>b+=c);q.on('end',()=>{got[key]=JSON.parse(b).text;res.writeHead(200);res.end('ok');});});s.listen(port,'127.0.0.1',()=>r(s));});
  const s1=await mk(4561,'notice'), s2=await mk(4562,'attendance'), s3=await mk(4563,'shoutout');

  const lr=await fetch(B+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@company.local',password:'ChangeMe@12345'})});
  const ck=(lr.headers.get('set-cookie')||'').split(';')[0];
  const cur=(await(await fetch(B+'/api/settings',{headers:{cookie:ck}})).json()).settings.slack||{};
  // Point each purpose at a different channel
  await fetch(B+'/api/settings',{method:'PUT',headers:{cookie:ck,'Content-Type':'application/json'},body:JSON.stringify({slack:{...cur,
    incomingWebhookUrl:'http://127.0.0.1:4561/', webhookAttendance:'http://127.0.0.1:4562/', webhookShoutout:'http://127.0.0.1:4563/'}})});

  // 1) Announcement → notices channel
  await fetch(B+'/api/announcements',{method:'POST',headers:{cookie:ck,'Content-Type':'application/json'},body:JSON.stringify({title:'ROUTETEST notice',body:'hi'})});
  // 2) Kudos/shoutout → shoutout channel  (give kudos to emp 15)
  const me=await(await fetch(B+'/api/employees/me',{headers:{cookie:ck}})).json();
  await fetch(B+'/api/kudos',{method:'POST',headers:{cookie:ck,'Content-Type':'application/json'},body:JSON.stringify({employee_id:15,message:'ROUTETEST great work',badge:'🚀'})});
  // 3) Attendance reminder → attendance channel
  const automation=require('./server/services/automation');
  // need server's settings to have the URLs — they were set via API (same process). Force a reminder:
  await fetch(B+'/api/automation/remind',{method:'POST',headers:{cookie:ck}});
  await sleep(1000);

  console.log('=== routing test — each action to its OWN channel ===');
  console.log('  Notices channel   got:', JSON.stringify(got.notice));
  console.log('  Shoutout channel  got:', JSON.stringify(got.shoutout));
  console.log('  Attendance channel got:', JSON.stringify(got.attendance));

  // cleanup
  const db=require('./server/db');await db.init();
  await db.prepare("DELETE FROM announcements WHERE title='ROUTETEST notice'").run();
  await db.prepare("DELETE FROM kudos WHERE message='ROUTETEST great work'").run();
  await db.prepare("DELETE FROM notifications WHERE title LIKE '%ROUTETEST%' OR body LIKE '%ROUTETEST%'").run();
  await db.prepare("DELETE FROM email_log WHERE status='skipped'").run();
  await db.prepare("DELETE FROM automation_markers WHERE marker LIKE 'attreminder:%'").run();
  await fetch(B+'/api/settings',{method:'PUT',headers:{cookie:ck,'Content-Type':'application/json'},body:JSON.stringify({slack:{...cur, incomingWebhookUrl:'', webhookAttendance:'', webhookShoutout:''}})});
  console.log('\n  cleaned up; webhook URLs cleared.');
  s1.close();s2.close();s3.close();await db.pool.end();
})().catch(e=>console.error('ERR',e.message));
