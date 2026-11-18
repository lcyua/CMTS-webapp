import React,{useEffect,useId,useState} from 'react';
import {PushClient,PushStatus} from './push';

function usePushStatus(client:PushClient){
 const [state,setState]=useState<PushStatus|null>(null);
 useEffect(()=>{
  let active=true,sequence=0;
  const load=()=>{const request=++sequence;void client.status().then(value=>{if(active&&request===sequence)setState(value);});};
  load();const stop=client.onChange(load);
  return()=>{active=false;sequence++;stop();};
 },[client]);
 return state;
}
const pending=(state:PushStatus|null)=>state?.phase==='permission'||state?.phase==='connecting';

export function PushPermissionPrompt({client,disabled=false,notificationsEnabled=true,sessionKey='current'}:{client:PushClient;disabled?:boolean;notificationsEnabled?:boolean;sessionKey?:string}){
 const state=usePushStatus(client),[busy,setBusy]=useState(false),[error,setError]=useState(''),[dismissed,setDismissed]=useState(false);
 const key='wooriban.push-prompt-dismissed.'+sessionKey;
 useEffect(()=>{try{setDismissed(sessionStorage.getItem(key)==='true');}catch{setDismissed(false);}},[key]);
 if(!state?.configured||!state.supported||!state.optedIn||!notificationsEnabled||state.permission!=='default'||dismissed)return null;
 const allow=async()=>{setBusy(true);setError('');try{await client.enable();}catch(e){setError(e instanceof Error?e.message:'브라우저 알림 권한을 확인해 주세요.');}finally{setBusy(false);}};
 const later=()=>{setDismissed(true);try{sessionStorage.setItem(key,'true');}catch{}};
 const waiting=busy||pending(state),failure=error||state.error;
 return <section aria-label="기기 알림 허용">
 <p role={waiting?'status':undefined}>{waiting?'브라우저의 알림 권한을 확인하고 있습니다. 브라우저에 표시된 요청을 확인해 주세요.':'알림 수신은 켜져 있습니다. 이 기기에서 알림을 허용해 주세요.'}</p>
 <div className="actions"><button disabled={disabled||waiting} onClick={()=>void allow()}>{waiting?'알림 권한 확인 중…':'알림 허용'}</button><button className="secondary" disabled={disabled} onClick={later}>나중에</button></div>
 {failure&&<p role="alert" className="error">{failure}</p>}
 </section>;
}

export function PushSettings({client,disabled=false,notificationsEnabled=true,canTest=false}:{client:PushClient;disabled?:boolean;notificationsEnabled?:boolean;canTest?:boolean}){
 const state=usePushStatus(client),[working,setWorking]=useState<'connect'|'disable'|'test'|null>(null),[error,setError]=useState<{kind:string;message:string}|null>(null),[notice,setNotice]=useState('');
 const helpId=useId(),busy=working!==null||pending(state);
 const run=async(kind:'connect'|'disable'|'test',action:()=>Promise<void>,message='')=>{setWorking(kind);setError(null);setNotice('');try{await action();setNotice(message);}catch(e){setError({kind,message:e instanceof Error?e.message:'기기 알림 설정을 확인해 주세요.'});}finally{setWorking(null);}};
 const failure=(error?.kind==='connect'&&state?.registered?'':error?.message)||state?.error;
 const testDisabled=disabled||busy||!state?.configured||!state.supported||!state.registered||!notificationsEnabled;
 const testHelp=!state?'기기 알림 상태를 확인하고 있습니다.':!state.configured?'사이트의 기기 알림 설정을 불러오지 못했습니다. 사이트를 새로고침해 주세요.':!state.supported?'이 브라우저의 기기 알림 지원을 확인해 주세요.':!notificationsEnabled?'먼저 ‘내 알림 수신’을 켜 주세요.':!state.registered?'기기 알림 연결이 완료되면 테스트할 수 있습니다.':'현재 로그인한 교사의 이 기기 한 대로만 테스트 알림을 보냅니다.';
 return <section><h2>이 기기의 알림</h2>
 <p className="hint">화면을 닫아도 새 알림을 받을 수 있습니다. 잠금 화면에는 학생 이름이나 포인트, 알림 본문을 표시하지 않습니다.</p>
 {!state?<p role="status">기기 알림 상태를 확인하고 있습니다.</p>:!state.configured?<p>사이트의 기기 알림 설정을 불러오지 못했습니다. 사이트를 새로고침해 주세요.</p>:!state.supported?<p>이 브라우저에서는 기기 알림을 사용할 수 없습니다. iPhone·iPad에서는 앱을 홈 화면에 추가한 뒤 열어 주세요.</p>:<>
 <p>브라우저 알림 권한: {state.permission==='granted'?'허용됨':state.permission==='denied'?'차단됨':'허용 대기'}</p>
 <p role={pending(state)?'status':undefined}>{state.registered?'이 기기에 알림이 연결되었습니다.':state.phase==='permission'?'브라우저의 알림 권한 응답을 기다리고 있습니다.':state.phase==='connecting'?'이 기기를 알림 서비스에 연결하고 있습니다.':!state.optedIn?'이 기기의 알림 수신을 껐습니다.':state.permission==='denied'?'브라우저에서 알림이 차단되어 있습니다. 사이트 알림을 허용하면 받을 수 있습니다.':state.permission==='default'?'알림 수신은 기본으로 선택되어 있습니다. 이 기기에서 받으려면 브라우저 알림을 허용해 주세요.':'브라우저 권한은 허용됐습니다. 아래 버튼으로 기기 알림을 연결해 주세요.'}</p>
 {!notificationsEnabled&&<p>‘내 알림 수신’을 켜면 기기 알림을 연결할 수 있습니다.</p>}
 <div className="actions">
 {!state.registered&&<button className="secondary" disabled={disabled||busy||!notificationsEnabled||state.permission==='denied'} onClick={()=>void run('connect',client.enable)}>{state.phase==='permission'?'알림 권한 확인 중…':state.phase==='connecting'?'기기 알림 연결 중…':state.permission==='default'?'이 기기 알림 허용':state.permission==='granted'&&state.optedIn?'기기 알림 다시 연결':'기기 알림 켜기'}</button>}
 {state.optedIn&&<button className="secondary" disabled={disabled||busy} onClick={()=>void run('disable',client.disable)}>이 기기 알림 끄기</button>}
 </div>
 </>}
 {canTest&&<><p id={helpId} className="hint">{testHelp}</p><button className="secondary" aria-describedby={helpId} disabled={testDisabled} onClick={()=>void run('test',client.test,'테스트 알림을 요청했습니다. 이 기기의 알림을 확인해 주세요.')}>{working==='test'?'테스트 알림 요청 중…':'테스트 알림 받기'}</button></>}
 {notice&&<p role="status">{notice}</p>}{failure&&<p role="alert" className="error">{failure}</p>}
 </section>;
}
