import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {defineConfig} from 'vite';

export default defineConfig({plugins:[{
  name:'class-portal-offline-shell',
  apply:'build',
  configResolved(config){
    if(config.env.VITE_FIREBASE_PROJECT_ID&&config.env.VITE_USE_EMULATORS!=='true'&&!/^https:\/\//.test(config.env.VITE_API_BASE||'')){
      throw new Error('실제 Firebase 빌드에는 배포된 Workers HTTPS 주소 VITE_API_BASE가 필요합니다.');
    }
  },
  writeBundle(options,bundle){
    const publicFiles=['manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png'];
    const template=readFileSync(resolve('public/sw.js'),'utf8');
    const hash=createHash('sha256').update(template);
    for(const name of [...publicFiles,'push-worker.js'])hash.update(readFileSync(resolve('public',name)));
    for(const [name,file] of Object.entries(bundle).sort(([a],[b])=>a.localeCompare(b))){
      hash.update(name).update(file.type==='chunk'?file.code:file.source);
    }
    const assets=['/',...publicFiles.map(name=>'/'+name),...Object.keys(bundle).filter(name=>/\.(?:js|css|woff2?|png|svg)$/.test(name)).map(name=>'/'+name)].sort();
    const worker=template.replace('__PWA_VERSION__',hash.digest('hex').slice(0,16)).replace('/* PWA_ASSETS */[]',JSON.stringify(assets));
    writeFileSync(resolve(options.dir||'dist','sw.js'),worker);
  }
}]});
