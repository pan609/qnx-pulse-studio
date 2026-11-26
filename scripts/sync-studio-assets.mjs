import {copyFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root = new URL('../',import.meta.url);
const target = new URL('studio-ui/public/assets/',root);
mkdirSync(target,{recursive:true});
for(const name of ['recorded-studio.png','live-pi-off.png','live-pi-on.png','pi-transition.gif']) {
  copyFileSync(new URL('docs/assets/'+name,root), new URL(name,target));
}
copyFileSync(new URL('codelab/index.html',root),new URL('studio-ui/public/codelab/index.html',root));
console.log('Synced canonical Codelab and four real UI captures.');
