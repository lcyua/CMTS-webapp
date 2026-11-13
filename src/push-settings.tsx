import React,{useEffect,useState} from 'react';
import {PushClient,PushStatus} from './push';

export function PushSettings({client,disabled=false,notificationsEnabled=true}:{client:PushClient;disabled?:boolean;notificationsEnabled?:boolean}){
 const [state,setState]=useState<PushStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;const load=()=>{void client.status().then(s=>{if(active)setState(s);});};load();const stop=client.onChange(load);return()=>{active=false;stop();};},[client]);
 if(!state?.configured)return null;
 const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:'기기 알림 설정을 확인해 주세요.');}finally{setBusy(false);setState(await client.status());}};
 return <section><h2>이 기기의 알림</h2>
 <p className="hint">화면을 닫아도 새 알림을 받을 수 있습니다. 잠금 화면에는 학생 이름이나 포인트, 알림 본문을 표시하지 않습니다.</p>
 {!state.supported?<p>이 브라우저에서는 기기 알림을 사용할 수 없습니다. iPhone·iPad에서는 앱을 홈 화면에 추가한 뒤 열어 주세요.</p>:<>
 <p>{state.registered?'이 기기에 알림이 연결되었습니다.':state.permission==='denied'?'브라우저 설정에서 이 사이트의 알림을 허용해 주세요.':'기기 알림을 켜면 브라우저에서 알림 권한을 요청합니다.'}</p>
 {!notificationsEnabled&&<p>‘내 알림 수신’을 켜면 기기 알림을 연결할 수 있습니다.</p>}
 <div className="actions">{!state.registered&&<button className="secondary" disabled={disabled||busy||!notificationsEnabled||state.permission==='denied'} onClick={()=>void run(client.enable)}>기기 알림 켜기</button>}{state.optedIn&&<button className="secondary" disabled={disabled||busy} onClick={()=>void run(client.disable)}>이 기기 알림 끄기</button>}</div>
 </>}{error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
