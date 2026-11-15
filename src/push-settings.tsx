import React,{useEffect,useState} from 'react';
import {PushClient,PushStatus} from './push';

export function PushPermissionPrompt({client,disabled=false,notificationsEnabled=true,sessionKey='current'}:{client:PushClient;disabled?:boolean;notificationsEnabled?:boolean;sessionKey?:string}){
 const [state,setState]=useState<PushStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[dismissed,setDismissed]=useState(false);
 const key='wooriban.push-prompt-dismissed.'+sessionKey;
 useEffect(()=>{try{setDismissed(sessionStorage.getItem(key)==='true');}catch{setDismissed(false);}},[key]);
 useEffect(()=>{let active=true;const load=()=>{void client.status().then(s=>{if(active)setState(s);});};load();const stop=client.onChange(load);return()=>{active=false;stop();};},[client]);
 if(!state?.configured||!state.supported||!state.optedIn||!notificationsEnabled||state.permission!=='default'||dismissed)return null;
 const allow=async()=>{setBusy(true);setError('');try{await client.enable();}catch(e){setError(e instanceof Error?e.message:'브라우저 알림 권한을 확인해 주세요.');}finally{setBusy(false);setState(await client.status());}};
 const later=()=>{setDismissed(true);try{sessionStorage.setItem(key,'true');}catch{}};
 return <section aria-label="기기 알림 허용"><p>알림 수신은 켜져 있습니다. 이 기기에서 알림을 허용해 주세요.</p><div className="actions"><button disabled={disabled||busy} onClick={()=>void allow()}>알림 허용</button><button className="secondary" disabled={busy} onClick={later}>나중에</button></div>{error&&<p role="alert" className="error">{error}</p>}</section>;
}

export function PushSettings({client,disabled=false,notificationsEnabled=true,canTest=false}:{client:PushClient;disabled?:boolean;notificationsEnabled?:boolean;canTest?:boolean}){
 const [state,setState]=useState<PushStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{let active=true;const load=()=>{void client.status().then(s=>{if(active)setState(s);});};load();const stop=client.onChange(load);return()=>{active=false;stop();};},[client]);
 if(!state?.configured)return null;
 const run=async(action:()=>Promise<void>,message='')=>{setBusy(true);setError('');setNotice('');try{await action();setNotice(message);}catch(e){setError(e instanceof Error?e.message:'기기 알림 설정을 확인해 주세요.');}finally{setBusy(false);setState(await client.status());}};
 return <section><h2>이 기기의 알림</h2>
 <p className="hint">화면을 닫아도 새 알림을 받을 수 있습니다. 잠금 화면에는 학생 이름이나 포인트, 알림 본문을 표시하지 않습니다.</p>
 {!state.supported?<p>이 브라우저에서는 기기 알림을 사용할 수 없습니다. iPhone·iPad에서는 앱을 홈 화면에 추가한 뒤 열어 주세요.</p>:<>
 <p>{state.registered?'이 기기에 알림이 연결되었습니다.':!state.optedIn?'이 기기의 알림 수신을 껐습니다.':state.permission==='denied'?'브라우저에서 알림이 차단되어 있습니다. 사이트 알림을 허용하면 받을 수 있습니다.':state.permission==='default'?'알림 수신은 기본으로 선택되어 있습니다. 이 기기에서 받으려면 브라우저 알림을 허용해 주세요.':'알림 수신을 연결하고 있습니다. 연결되지 않으면 아래 버튼을 눌러 주세요.'}</p>
 {!notificationsEnabled&&<p>‘내 알림 수신’을 켜면 기기 알림을 연결할 수 있습니다.</p>}
 <div className="actions">{!state.registered&&<button className="secondary" disabled={disabled||busy||!notificationsEnabled||state.permission==='denied'} onClick={()=>void run(client.enable)}>{state.permission==='default'?'이 기기 알림 허용':state.permission==='granted'&&state.optedIn?'기기 알림 다시 연결':'기기 알림 켜기'}</button>}{state.optedIn&&<button className="secondary" disabled={disabled||busy} onClick={()=>void run(client.disable)}>이 기기 알림 끄기</button>}{canTest&&state.registered&&notificationsEnabled&&<button className="secondary" disabled={disabled||busy} onClick={()=>void run(client.test,'테스트 알림을 요청했습니다. 이 기기의 알림을 확인해 주세요.')}>테스트 알림 받기</button>}</div>
 </>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
