import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createWorker } from '../worker/index.js';
const publicWorker=createWorker();
const root=resolve(import.meta.dirname,'..','dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg'};
// Deliberately local preview fixtures. These cookies are scenario selectors,
// not credentials; no Worker, account database or production session is used.
const qaScenarioCookie='pawprint_preview_scenario';
const qaActiveCookie='pawprint_preview_active';
const qaAccount={id:'qa-empty-owner',username:'New owner · Preview',email:'preview@example.invalid',petName:'Luna',isTest:false,role:'owner',onboardingCompleted:false};
const previewCookie=(name,value)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Strict${value?'':'; Max-Age=0'}`;
function sendJSON(res,result,status=200){res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(result));}
async function previewBody(req){
  let body='';
  for await(const part of req){body+=part;if(body.length>1024)throw new Error('Preview request too large');}
  const result=JSON.parse(body||'{}');
  if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('Invalid preview request');
  return result;
}
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://${req.headers.host}`);
    const cookies=new Map((req.headers.cookie||'').split(';').map(part=>part.trim().split('=')));
    const qaOwner=cookies.get(qaScenarioCookie)==='new-owner';
    const qaActive=qaOwner&&cookies.get(qaActiveCookie)==='1';
    if(['/__qa__/new-owner','/__qa__/reset'].includes(url.pathname)){
      if(req.method!=='GET'){res.setHeader('Allow','GET');sendJSON(res,{code:'method_not_allowed'},405);return;}
      res.setHeader('Set-Cookie',[previewCookie(qaScenarioCookie,url.pathname.endsWith('/new-owner')?'new-owner':''),previewCookie(qaActiveCookie,'')]);
      res.writeHead(303,{'Location':'/','Cache-Control':'no-store'});res.end();return;
    }
    if(url.pathname.startsWith('/api/')){
      // Preview public directory reads with the same implementation used in production.
      // Authentication and writes remain disabled; no production credentials are loaded.
      if(req.method==='GET' && ['/api/vets','/api/vets/feedback','/api/shop/catalog'].includes(url.pathname)){
        const response=await publicWorker.fetch(new Request(url,{headers:{Accept:'application/json'}}),{});
        res.statusCode=response.status;for(const [key,value] of response.headers)res.setHeader(key,value);
        res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      if(qaOwner&&url.pathname.startsWith('/api/auth/')){
        if(req.method==='GET'&&['/api/auth/status','/api/auth/session'].includes(url.pathname)){
          sendJSON(res,url.pathname.endsWith('/status')?{configured:false,storageReady:true,emailConfigured:false,testSessionAvailable:false,session:qaActive?qaAccount:null}:{account:qaActive?qaAccount:null});return;
        }
        if(['/api/auth/lock','/api/auth/logout','/api/auth/resume','/api/auth/forget','/api/auth/onboarding-complete'].includes(url.pathname)){
          if(req.method!=='POST'){res.setHeader('Allow','POST');sendJSON(res,{code:'method_not_allowed'},405);return;}
          let body;
          try{body=await previewBody(req);}catch{sendJSON(res,{code:'invalid_input',message:'Invalid local preview request.'},400);return;}
          if(['/api/auth/lock','/api/auth/logout'].includes(url.pathname)){
            res.setHeader('Set-Cookie',previewCookie(qaActiveCookie,''));sendJSON(res,{accounts:[qaAccount]});return;
          }
          if(body.accountId!==qaAccount.id){sendJSON(res,{code:'account_changed',message:'Choose the local preview account.'},409);return;}
          if(url.pathname==='/api/auth/resume'){
            res.setHeader('Set-Cookie',previewCookie(qaActiveCookie,'1'));sendJSON(res,{account:qaAccount});return;
          }
          if(url.pathname==='/api/auth/forget'){
            res.setHeader('Set-Cookie',[previewCookie(qaScenarioCookie,''),previewCookie(qaActiveCookie,'')]);sendJSON(res,{ok:true});return;
          }
          if(!qaActive){sendJSON(res,{code:'login_required',message:'Open the local preview account first.'},401);return;}
          sendJSON(res,{ok:true,onboardingCompleted:true});return;
        }
      }
      let result;
      if(url.pathname==='/api/capabilities')result={configured:false,chat:false,transcription:false};
      else if(url.pathname==='/api/auth/status')result={configured:false,session:null};
      else if(url.pathname==='/api/auth/session')result={account:null};
      else if(['/api/auth/logout','/api/auth/lock'].includes(url.pathname))result={accounts:[]};
      else {res.statusCode=503;result={code:'not_configured',message:'Email verification is not connected yet. You can explore the demo.'};}
      sendJSON(res,result,res.statusCode);return;
    }
    const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    const assetPath=path.slice(root.length);
    if(!path.startsWith(root+'/')||assetPath.includes('/server/')||assetPath.includes('/.')){res.writeHead(404);res.end();return;}
    const data=await readFile(path);res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(req.method==='HEAD'?undefined:data);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(Number(process.env.PORT||4173),'0.0.0.0',()=>console.log('Pawprint preview ready. Authentication delivery is disabled in local preview.'));
