import React,{useEffect,useRef,useState} from 'react';
import './pwa.css';

interface InstallPrompt extends Event {
  prompt():Promise<void>;
  userChoice:Promise<{outcome:'accepted'|'dismissed'}>;
}
const installed=()=>window.matchMedia('(display-mode: standalone)').matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone);
const appleMobile=()=>/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);

/** Public app-shell lifecycle; it never stores login credentials or class data. */
export function PwaStatus(){
  const[online,setOnline]=useState(navigator.onLine),[standalone,setStandalone]=useState(installed);
  const[prompt,setPrompt]=useState<InstallPrompt|null>(null),[waiting,setWaiting]=useState<ServiceWorker|null>(null);
  const[help,setHelp]=useState(false),[warning,setWarning]=useState(''),[dismissed,setDismissed]=useState(false);
  const applying=useRef(false),registration=useRef<ServiceWorkerRegistration|null>(null);
  useEffect(()=>{
    let active=true,lastCheck=0,installing:ServiceWorker|null=null;
    const media=window.matchMedia('(display-mode: standalone)');
    const onOnline=()=>{setOnline(true);void check();},onOffline=()=>setOnline(false);
    const onInstall=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPrompt);setDismissed(false);};
    const onInstalled=()=>{setStandalone(true);setPrompt(null);setHelp(false);};
    const onDisplay=()=>setStandalone(installed());
    const onController=()=>{if(applying.current)window.location.reload();};
    const onState=()=>{
      if(!active)return;
      if(installing?.state==='installed'&&navigator.serviceWorker.controller)setWaiting(installing);
      if(installing?.state==='redundant'&&!registration.current?.active)setWarning('오프라인 실행 준비가 끝나지 않았습니다. 인터넷에 연결한 뒤 다시 열어 주세요.');
    };
    const onFound=()=>{installing?.removeEventListener('statechange',onState);installing=registration.current?.installing||null;installing?.addEventListener('statechange',onState);};
    async function check(){
      if(document.visibilityState!=='visible'||!navigator.onLine||Date.now()-lastCheck<60000)return;
      lastCheck=Date.now();
      await registration.current?.update().catch(()=>{});
    }
    const onVisible=()=>{void check();};
    async function register(){
      try{
        const result=await navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'});
        if(!active)return;
        registration.current=result;
        if(result.waiting&&navigator.serviceWorker.controller)setWaiting(result.waiting);
        result.addEventListener('updatefound',onFound);
        if(result.installing)onFound();
      }catch{
        if(active)setWarning('이 브라우저에서는 오프라인 실행을 준비하지 못했습니다. 인터넷에 연결해 이용해 주세요.');
      }
    }
    window.addEventListener('online',onOnline);window.addEventListener('offline',onOffline);
    window.addEventListener('beforeinstallprompt',onInstall);window.addEventListener('appinstalled',onInstalled);
    media.addEventListener('change',onDisplay);
    if(import.meta.env.PROD&&'serviceWorker'in navigator){
      navigator.serviceWorker.addEventListener('controllerchange',onController);
      document.addEventListener('visibilitychange',onVisible);
      void register();
    }
    return()=>{
      active=false;
      window.removeEventListener('online',onOnline);window.removeEventListener('offline',onOffline);
      window.removeEventListener('beforeinstallprompt',onInstall);window.removeEventListener('appinstalled',onInstalled);
      media.removeEventListener('change',onDisplay);
      navigator.serviceWorker?.removeEventListener('controllerchange',onController);
      document.removeEventListener('visibilitychange',onVisible);
      registration.current?.removeEventListener('updatefound',onFound);
      installing?.removeEventListener('statechange',onState);
    };
  },[]);
  async function install(){
    if(!prompt)return;
    try{await prompt.prompt();await prompt.userChoice;}catch{setHelp(true);}
    finally{setPrompt(null);}
  }
  function update(){
    if(!waiting||!online||!window.confirm('새 버전으로 업데이트할까요? 작성 중인 내용은 먼저 저장해 주세요.'))return;
    applying.current=true;waiting.postMessage({type:'APPLY_UPDATE'});
  }
  const canInstall=!standalone&&!dismissed&&(Boolean(prompt)||appleMobile());
  if(online&&!waiting&&!canInstall&&!help&&!warning)return null;
  return <div className="pwa-status" aria-label="앱 설치 및 연결 상태">
    {!online&&<p role="status">인터넷 연결이 없습니다. 다시 연결한 뒤 로그인·제출할 수 있습니다.</p>}
    {warning&&<p role="status">{warning}<button type="button" className="pwa-dismiss" aria-label="오프라인 준비 안내 닫기" onClick={()=>setWarning('')}>닫기</button></p>}
    {waiting&&<div className="pwa-row"><p role="status">새 버전이 준비됐습니다.</p><button type="button" onClick={update} disabled={!online}>업데이트 적용</button></div>}
    {canInstall&&<div className="pwa-row"><p>홈 화면에서 우리반을 바로 열 수 있어요.</p><button type="button" onClick={()=>prompt?void install():setHelp(true)}>앱 설치</button><button type="button" className="pwa-dismiss" onClick={()=>setDismissed(true)}>나중에</button></div>}
    {help&&<p role="status">브라우저의 공유 메뉴에서 ‘홈 화면에 추가’를 선택하세요.<button type="button" className="pwa-dismiss" onClick={()=>setHelp(false)}>닫기</button></p>}
  </div>;
}
