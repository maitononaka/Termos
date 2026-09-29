const DB_KEY='termos-state-v1';
const defaultState=()=>({
  user:null, passwordHash:null, passwordDisabled:false,
  registry:{
    'HKEY_LOCAL_MACHINE':{'SYSTEM':{'Boot':{'BootDelay':'1200','SecureBoot':'Enabled'},'Display':{'Theme':'green','MaxClock':'100'}}},
    'HKEY_CURRENT_USER':{'Software':{'TERMOS':{'Version':'1.0.0','FirstBoot':'true'}}}
  },
  fs:{type:'dir',name:'/',children:{
    home:{type:'dir',name:'home',children:{}},
    etc:{type:'dir',name:'etc',children:{'os-release':{type:'file',name:'os-release',content:'NAME=TERMOS\nVERSION=1.0.0\nID=termos\nHTML_BASED=1'}}},
    var:{type:'dir',name:'var',children:{log:{type:'dir',name:'log',children:{'boot.log':{type:'file',name:'boot.log',content:'',owner:'root',group:'root',mode:'0644'}}}}}
  }},
  cwd:'/home', history:[], logs:[], aliases:{},
  env:{TERM:'xterm-256color',SHELL:'/bin/termsh'},
  settings:{theme:'green',maxClock:100,secureBoot:true,bootDelay:1200}
});
function loadState(){try{const raw=localStorage.getItem(DB_KEY);if(!raw)return defaultState();const s=JSON.parse(raw);return deepMerge(defaultState(),s)}catch{return defaultState()}}
function saveState(s){localStorage.setItem(DB_KEY,JSON.stringify(s))}
function deepMerge(a,b){if(!b||typeof b!=='object')return a;const out={...a};for(const k of Object.keys(b)){if(b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k])&&a[k]&&typeof a[k]==='object'&&!Array.isArray(a[k]))out[k]=deepMerge(a[k],b[k]);else out[k]=b[k]}return out}
async function sha256(text){const data=new TextEncoder().encode(text);const buf=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('')}
function resetState(){localStorage.removeItem(DB_KEY);location.reload()}
function getWebGLInfo(){try{const c=document.createElement('canvas');const gl=c.getContext('webgl')||c.getContext('experimental-webgl');if(!gl)return{};const dbg=gl.getExtension('WEBGL_debug_renderer_info');return{vendor:dbg?gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE)}}catch(e){return{error:String(e)}}}
function getHardwareSnapshot(){const nav=navigator;const conn=nav.connection||nav.mozConnection||nav.webkitConnection||{};return{
  browser:navigator.userAgent, uaData:navigator.userAgentData?`${navigator.userAgentData.brands?.map(x=>x.brand+' '+x.version).join(', ')} | mobile=${navigator.userAgentData.mobile}`:'Unavailable',
  platform:navigator.platform||'Unknown',vendor:navigator.vendor||'Unknown',language:navigator.language,languages:(navigator.languages||[]).join(', '),
  timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,cores:navigator.hardwareConcurrency??'Unavailable',deviceMemory:navigator.deviceMemory?`${navigator.deviceMemory} GB (approx)`:'Unavailable',
  maxTouch:navigator.maxTouchPoints??'Unavailable',online:navigator.onLine,connection:`${conn.effectiveType||'n/a'} down=${conn.downlink??'n/a'}Mb/s rtt=${conn.rtt??'n/a'}ms saveData=${!!conn.saveData}`,
  screen:`${screen.width}x${screen.height} @${window.devicePixelRatio}x`,viewport:`${innerWidth}x${innerHeight}`,
  colorDepth:screen.colorDepth,orientation:screen.orientation?.type||'Unknown',cookie: navigator.cookieEnabled,doNotTrack:navigator.doNotTrack||'Unset',pdfViewer:nav.pdfViewerEnabled??'Unavailable',
  storageEstimate:null, webgl:getWebGLInfo()
}}
async function enrichStorage(info){try{info.storageEstimate=await navigator.storage?.estimate?.()||null}catch{info.storageEstimate=null}return info}

class FPSMeter{
  constructor(onUpdate){this.onUpdate=onUpdate;this.frames=0;this.last=performance.now();this.current=0;this.raf=0}
  start(){const loop=(t)=>{this.frames++;if(t-this.last>=500){this.current=this.frames*1000/(t-this.last);this.frames=0;this.last=t;this.onUpdate?.(this.current)}this.raf=requestAnimationFrame(loop)};this.raf=requestAnimationFrame(loop)}
  stop(){cancelAnimationFrame(this.raf)}
}
async function benchmark(ms=700){const start=performance.now();let x=0,n=0;while(performance.now()-start<ms){x=Math.sin(n++)*Math.cos(n)*Math.sqrt(n+1)}return{ms:performance.now()-start,iterations:n,score:Math.round(n/(performance.now()-start)*1000),sink:x}}

const clone=o=>structuredClone(o);
class Kernel{
  constructor(state,host){
    this.state=state; this.host=host; this.bootAt=performance.now();
    this.nextPid=100; this.processes=new Map(); this.services=new Map();
    this.init();
  }
  init(){
    if(this.state.kernel?.processes?.length){
      for(const p of this.state.kernel.processes){ this.processes.set(p.pid,p); this.nextPid=Math.max(this.nextPid,p.pid+1); }
      for(const [id,s] of Object.entries(this.state.kernel.services||{})) this.services.set(id,s);
      if(this.processes.size===0) this.seed();
      return;
    }
    this.seed();
  }
  seed(){
    const base=[
      ['init','RUN','kernel',0,'root'],['termsh','RUN','shell',0,this.state.user||'user'],['renderer','RUN','renderer',0,'root'],['uefi-monitor','RUN','uefi-monitor',0,'root']
    ];
    for(const [name,state,cmd,ppid,owner] of base)this.spawn(name,{state,cmd,ppid,owner,system:true});
    const defs={network:'Network Manager',logger:'System Logger','web-runtime':'HTML/CSS/JS Runtime',cron:'Virtual Scheduler'};
    for(const [id,label] of Object.entries(defs)){const p=this.spawn(`svc:${id}`,{cmd:`service ${id}`,owner:'root',system:true});this.services.set(id,{id,label,status:'running',pid:p.pid});}
    this.persist();
  }
  spawn(name,opt={}){const p={pid:this.nextPid++,ppid:opt.ppid??1,name,state:opt.state||'RUN',cmd:opt.cmd||name,owner:opt.owner||this.state.user||'user',cpu:0,mem:Math.round(2+Math.random()*30),started:Date.now(),system:!!opt.system};this.processes.set(p.pid,p);return p}
  kill(pid,signal='TERM'){
    pid=Number(pid);const p=this.processes.get(pid);if(!p)return {ok:false,msg:`kill: (${pid}) - No such process`};
    if(p.system&&pid<=3)return {ok:false,msg:`kill: ${pid}: operation not permitted`};
    p.state=signal==='STOP'?'STOP':'TERM'; if(signal!=='STOP')setTimeout(()=>this.processes.delete(pid),0);this.persist();return {ok:true,msg:`[${pid}] ${signal}`};
  }
  resume(pid){const p=this.processes.get(Number(pid));if(!p)return false;p.state='RUN';this.persist();return true}
  service(name,action){const s=this.services.get(name);if(!s)return {ok:false,msg:`service: unknown service ${name}`};
    if(action==='status')return {ok:true,msg:`${s.id} - ${s.label}\n   Loaded: virtual\n   Active: ${s.status}`};
    if(['start','stop','restart'].includes(action)){
      if(action==='stop'){s.status='stopped';const p=this.processes.get(s.pid);if(p)p.state='STOP'}
      if(action==='start'){s.status='running';const p=this.processes.get(s.pid);if(p)p.state='RUN';else s.pid=this.spawn(`svc:${s.id}`,{cmd:`service ${s.id}`,owner:'root',system:true}).pid}
      if(action==='restart'){s.status='running';const p=this.processes.get(s.pid);if(p)p.state='RUN';else s.pid=this.spawn(`svc:${s.id}`,{cmd:`service ${s.id}`,owner:'root',system:true}).pid}
      this.persist();return {ok:true,msg:`${s.id}: ${s.status}`};
    }
    return {ok:false,msg:`service ${name}: usage status|start|stop|restart`};
  }
  list(){return [...this.processes.values()].sort((a,b)=>a.pid-b.pid).map(p=>({...p,age:Math.floor((Date.now()-p.started)/1000)}))}
  tick(){for(const p of this.processes.values()){if(p.state==='RUN'){p.cpu=+(Math.random()*4).toFixed(1);p.mem=Math.max(1,Math.round(p.mem+(Math.random()-.5)*2))}}}
  persist(){this.state.kernel={nextPid:this.nextPid,services:Object.fromEntries(this.services),processes:[...this.processes.values()]};saveState(this.state)}
}

function perms(node){return node?.mode|| (node?.type==='dir'?'0755':'0644')}
function chmodNode(node,mode){node.mode=String(mode).replace(/^0o/,''); if(!/^([0-7]{3}|[0-7]{4})$/.test(node.mode))throw new Error('invalid mode');}
function chownNode(node,user,group){node.owner=user;node.group=group||node.group||user}
function modeString(node){const m=perms(node).padStart(4,'0').slice(-3);const bits=m.split('').map(Number);const chars=['r','w','x'];return '-'+bits.map(v=>[4,2,1].map((b,i)=>v&b?chars[i]:'-').join('')).join('')}
function canWrite(node,user){if(user==='root')return true;return node.owner===user ? Number(perms(node).slice(-3, -2))>=6 : Number(perms(node).slice(-1))>=6}

/* ===== vi/editor.js ===== */
class ViEditor{
 constructor({state,term,path}){this.state=state;this.term=term;this.path=norm(path,term.cwd);this.n=node(state.fs,this.path);this.mode='NORMAL';this.line=0;this.col=0;this.dirty=false;this.old=term.host.term.innerHTML;this.open()}
 open(){if(!this.n||this.n.type!=='file'){this.term.print(`vi: ${esc(this.path)}: no such file`);return}this.overlay=document.createElement('div');this.overlay.className='vi-overlay';this.overlay.innerHTML=`<div class="vi-top">TERMOS vi · ${esc(this.path)} <span id="vi-mode">NORMAL</span></div><textarea id="vi-text" spellcheck="false"></textarea><div class="vi-status" id="vi-status"></div>`;document.body.appendChild(this.overlay);this.ta=this.overlay.querySelector('#vi-text');this.ta.value=this.n.content||'';this.ta.focus();this.update();this.onKey=e=>this.key(e);document.addEventListener('keydown',this.onKey,true);}
 update(){const lines=this.ta.value.split('\n');this.overlay.querySelector('#vi-mode').textContent=this.mode;this.overlay.querySelector('#vi-status').textContent=`${this.dirty?'[modified] ':''}${lines.length} lines · ${this.mode} · ESC normal · :w save · :q quit · :wq save+quit`}
 key(e){if(e.target!==this.ta)return;if(this.mode==='INSERT'){if(e.key==='Escape'){e.preventDefault();this.mode='NORMAL';this.update();return}this.dirty=true;return}
   if(e.key==='i'){e.preventDefault();this.mode='INSERT';this.update();return}
   if(e.key==='a'){e.preventDefault();this.mode='INSERT';this.ta.selectionStart=Math.min(this.ta.value.length,this.ta.selectionStart+1);this.ta.selectionEnd=this.ta.selectionStart;this.update();return}
   if(e.key==='j'){e.preventDefault();this.move(1);return} if(e.key==='k'){e.preventDefault();this.move(-1);return}
   if(e.key==='0'){e.preventDefault();this.ta.selectionStart=this.ta.selectionEnd=this.lineStart();return}
   if(e.key==='$'){e.preventDefault();this.ta.selectionStart=this.ta.selectionEnd=this.lineEnd();return}
   if(e.key===':'){e.preventDefault();this.commandPrompt();return}
 }
 move(d){const v=this.ta.value,pos=this.ta.selectionStart;const ls=v.slice(0,pos).split('\n');let row=ls.length-1,col=ls.at(-1).length;row=Math.max(0,Math.min(v.split('\n').length-1,row+d));const lines=v.split('\n');col=Math.min(col,lines[row].length);let p=0;for(let i=0;i<row;i++)p+=lines[i].length+1;p+=col;this.ta.selectionStart=this.ta.selectionEnd=p;}
 lineStart(){let p=this.ta.selectionStart;while(p>0&&this.ta.value[p-1]!=='\n')p--;return p}
 lineEnd(){let p=this.ta.selectionStart;while(p<this.ta.value.length&&this.ta.value[p]!=='\n')p++;return p}
 commandPrompt(){const c=prompt(':');if(c==='w'||c==='write'){this.save();}else if(c==='q'){if(this.dirty&&!confirm('Unsaved changes. Quit?'))return;this.close()}else if(c==='wq'||c==='x'){this.save();this.close()}else if(c==='q!'){this.close()}else if(c){this.term.print(`vi: unknown command: ${esc(c)}`)}this.update()}
 save(){this.n.content=this.ta.value;this.dirty=false;saveState(this.state);this.term.log(`vi: wrote ${this.path}`)}
 close(){document.removeEventListener('keydown',this.onKey,true);this.overlay?.remove();this.term.host.term.innerHTML=this.old;this.term.refreshPrompt();this.term.host.input?.focus()}
}

/* ===== terminal.js ===== */

const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function args(s){const a=[];let c='',q=null;for(let i=0;i<s.length;i++){const x=s[i];if(q){if(x===q)q=null;else if(x==='\\'&&i+1<s.length)c+=s[++i];else c+=x}else if(x==='"'||x==="'")q=x;else if(/\s/.test(x)){if(c){a.push(c);c=''}}else c+=x}if(c)a.push(c);return a}
function splitPipe(s){const out=[];let c='',q=null;for(let i=0;i<s.length;i++){const x=s[i];if(q){c+=x;if(x===q)q=null;continue}if(x==='"'||x==="'"){q=x;c+=x}else if(x==='|'){out.push(c.trim());c=''}else c+=x}out.push(c.trim());return out}
function parseRedir(s){let q=null,idx=-1,op='';for(let i=0;i<s.length;i++){const x=s[i];if(q){if(x===q)q=null;continue}if(x==='"'||x==="'"){q=x;continue}if(x==='>'||x==='<'){idx=i;op=s.slice(i,i+2)==='>>'? '>>':x;break}}if(idx<0)return {cmd:s.trim()};return {cmd:s.slice(0,idx).trim(),op,file:s.slice(idx+op.length).trim()};}
function norm(p,cwd){const a=(p.startsWith('/')?p:cwd+'/'+p).split('/'),o=[];for(const x of a){if(!x||x==='.')continue;if(x==='..')o.pop();else o.push(x)}return '/'+o.join('/')}
function node(fs,p){if(p==='/')return fs;let n=fs;for(const x of p.split('/').filter(Boolean)){if(n.type!=='dir'||!n.children?.[x])return null;n=n.children[x]}return n}
const parent=p=>{const a=p.split('/').filter(Boolean);a.pop();return '/'+a.join('/')||'/'};
const base=p=>p.split('/').filter(Boolean).pop()||'/';

class Terminal{
 constructor({state,host,onReboot,onShutdown,onUEFI}){this.state=state;this.host=host;this.onReboot=onReboot;this.onShutdown=onShutdown;this.onUEFI=onUEFI;this.fs=state.fs;this.cwd=state.cwd||'/home';this.env=state.env||{};this.aliases=state.aliases||{};this.kernel=new Kernel(state,host);this.lastStatus=0;this.bootAt=performance.now();this.vi=null}
 start(){this.print(`<span class="ansi-bold">TERMOS 1.1.0</span> · kernel ${this.kernel.list().length} processes · HTML-native userspace`);this.print(`Logged in as <span class="ansi-green">${esc(this.state.user)}</span>. Type <span class="ansi-yellow">help</span>.`);this.print('');this.refreshPrompt();return this}
 print(t='',cls='cmdout'){const d=document.createElement('div');d.className='terminal-line '+cls;d.innerHTML=t;this.host.term.appendChild(d);this.host.term.scrollTop=this.host.term.scrollHeight}
 log(msg,level='info'){this.state.logs.push({ts:new Date().toISOString(),level,msg});if(this.state.logs.length>500)this.state.logs.shift();saveState(this.state)}
 refreshPrompt(){const p=`${this.state.user}@termos:${this.cwd==='/'?'~':this.cwd.replace('/home','~')}$`;this.host.prompt.textContent=p;this.host.user.textContent=this.state.user}
 async runLine(raw){let line=raw.trim();if(!line)return;this.state.history.push(line);this.print(`<span class="ansi-green">${esc(this.promptText())}</span> ${esc(line)}`);try{this.lastStatus=await this.executeShell(line)}catch(e){this.lastStatus=1;this.print(`<span class="ansi-red">${esc(e.message||e)}</span>`)}saveState(this.state);this.refreshPrompt();}
 promptText(){return `${this.state.user}@termos:${this.cwd==='/'?'~':this.cwd.replace('/home','~')}$`}
 async executeShell(line){const pipes=splitPipe(line);let input='';let status=0;for(let i=0;i<pipes.length;i++){const r=parseRedir(pipes[i]);const a=args(r.cmd);if(!a.length)continue;const res=await this.command(a,input);status=res.status;input=res.out;if(r.op){const p=norm(r.file,this.cwd);if(r.op==='<' ){const n=node(this.fs,p);input=n?.content||''}else{if(!this.writeFile(p,input,r.op==='>>'))return 1;input=''}}if(i===pipes.length-1&&input!==''&&r.op!=='>'&&r.op!=='>>')this.print(esc(input));}return status}
 async command(a,input=''){let cmd=a.shift();if(this.aliases[cmd])a=args(this.aliases[cmd]).concat(a);cmd=cmd.toLowerCase();this.kernel.tick();
  switch(cmd){
   case 'help':return {status:0,out:`filesystem: ls cd pwd cat touch mkdir rm cp mv tree find\nprocess: ps top tasks taskmgr kill jobs bg fg\nshell: echo clear history alias export env whoami id uname hostname date uptime pipe/redirection\neditor: vi vim\npermissions: chmod chown stat\nservices: service systemctl\nsystem: info cpu mem gpu net battery screen fps clock benchmark logs dmesg uefi reboot shutdown\nregistry: reg regedit\nweb: html css js run open theme\nextras: grep head tail wc sort sleep neofetch nyancat`};
   case 'clear':this.host.term.innerHTML='';return {status:0,out:''};case 'echo':return {status:0,out:this.expand(a.join(' '))};case 'pwd':return {status:0,out:this.cwd};case 'whoami':return {status:0,out:this.state.user};case 'id':return {status:0,out:`uid=1000(${this.state.user}) gid=1000(${this.state.user}) groups=1000(${this.state.user})`};case 'uname':return {status:0,out:'TERMOS 1.1.0 termos-kernel-js amd64 browser'};case 'hostname':return {status:0,out:'termos'};case 'date':return {status:0,out:new Date().toString()};case 'uptime':return {status:0,out:`${Math.floor((performance.now()-this.bootAt)/1000)} seconds · ${this.kernel.list().length} processes`};
   case 'ls':return this.ls(a);case 'cd':return this.cd(a[0]||'/home');case 'cat':return this.cat(a);case 'touch':return this.touch(a);case 'mkdir':return this.mkdir(a);case 'rm':case 'rmdir':return this.rm(a);case 'cp':return this.cp(a);case 'mv':return this.mv(a);case 'tree':return this.tree(a[0]||this.cwd);case 'find':return this.find(a[0]||'.',a[1]||'');
   case 'history':return {status:0,out:this.state.history.map((x,i)=>`${String(i+1).padStart(4)}  ${x}`).join('\n')};case 'alias':return this.aliasCmd(a);case 'export':return this.exportCmd(a);case 'env':return {status:0,out:Object.entries(this.env).map(([k,v])=>`${k}=${v}`).join('\n')};
   case 'ps':case 'tasks':return this.ps();case 'top':case 'taskmgr':return this.top();case 'kill':return this.kill(a);case 'jobs':return {status:0,out:this.kernel.list().filter(p=>p.ppid!==0).map(p=>`[${p.pid}] ${p.state} ${p.cmd}`).join('\n')};case 'bg':return this.procState(a[0],'RUN');case 'fg':return this.procState(a[0],'RUN');
   case 'vi':case 'vim':this.vi=new ViEditor({state:this.state,term:this,path:a[0]||''});return {status:0,out:''};
   case 'chmod':return this.chmod(a);case 'chown':return this.chown(a);case 'stat':return this.stat(a);case 'service':case 'systemctl':return this.service(a);
   case 'logs':return this.logs(a);case 'dmesg':return {status:0,out:this.state.logs.slice(-50).map(x=>`[${x.ts}] ${x.level.toUpperCase()} ${x.msg}`).join('\n')};case 'info':{const i=await enrichStorage(getHardwareSnapshot());return {status:0,out:JSON.stringify(i,null,2)}}case 'cpu':return {status:0,out:`logical CPUs: ${navigator.hardwareConcurrency??'n/a'}\ndeviceMemory: ${navigator.deviceMemory??'n/a'} GB hint`};case 'mem':return {status:0,out:`JS-visible memory hint: ${navigator.deviceMemory??'n/a'} GB\nStorage: ${(await navigator.storage?.estimate?.())?.usage??0} bytes used`};case 'gpu':{const i=getHardwareSnapshot().webgl||{};return {status:0,out:`vendor: ${i.vendor||'n/a'}\nrenderer: ${i.renderer||'n/a'}\nversion: ${i.version||'n/a'}`}}case 'net':return {status:0,out:`online: ${navigator.onLine}\nconnection: ${navigator.connection?.effectiveType||'n/a'}`};case 'battery':return {status:0,out:'Battery API is browser-dependent; use info for detected capability.'};case 'screen':return {status:0,out:`${screen.width}x${screen.height} @${devicePixelRatio}x`};case 'fps':return {status:0,out:`terminal render FPS: ${this.host.fps().toFixed(0)}`};case 'clock':return {status:0,out:`virtual MAX CLOCK: ${this.state.settings.maxClock}%`};case 'benchmark':{const o=await benchmark();return {status:0,out:`${o.iterations.toLocaleString()} iterations / ${o.ms.toFixed(0)} ms / score ${o.score}`}}case 'neofetch':return {status:0,out:`   ██████  TERMOS\n  ██      1.1.0\n ██       ${this.state.user}\n  ██████  ${this.kernel.list().length} virtual processes\n     ██   ${navigator.hardwareConcurrency||'?'} CPU threads`};
   case 'reg':case 'regedit':return this.reg(a);case 'html':return this.web(a,'html');case 'css':return this.web(a,'css');case 'js':return this.web(a,'js');case 'run':return this.runFile(a[0]);case 'theme':this.theme(a[0]);return {status:0,out:`theme=${this.state.settings.theme||'green'}`};case 'open':return this.open(a[0]);
   case 'grep':return {status:0,out:input.split('\n').filter(x=>x.includes(a[0]||'')).join('\n')};case 'head':return {status:0,out:input.split('\n').slice(0,Number(a[0])||10).join('\n')};case 'tail':return {status:0,out:input.split('\n').slice(-(Number(a[0])||10)).join('\n')};case 'wc':return {status:0,out:`${input.split('\n').length} ${input.split(/\s+/).filter(Boolean).length} ${input.length}`};case 'sort':return {status:0,out:input.split('\n').sort().join('\n')};case 'sleep':await new Promise(r=>setTimeout(r,Math.min(5000,(Number(a[0])||1)*1000)));return {status:0,out:''};
   case 'uefi':this.onUEFI?.();return {status:0,out:''};case 'reboot':this.onReboot?.();return {status:0,out:'rebooting...'};case 'shutdown':this.onShutdown?.();return {status:0,out:'system halted'};case 'nyancat':this.nyancat();return {status:0,out:''};default:return {status:127,out:`${cmd}: command not found. Type help.`};
  }
 }
 expand(s){return s.replace(/\$(\w+)/g,(_,k)=>this.env[k]??'')}
 get(p){return node(this.fs,norm(p,this.cwd))}
 writable(p){const n=this.get(p);return !n||canWrite(n,this.state.user)}
 writeFile(p,data,append=false){const q=norm(p,this.cwd),par=node(this.fs,parent(q));if(!par||par.type!=='dir')return false;const b=base(q);if(par.children[b]&&par.children[b].type!=='file')return false;if(!par.children[b])par.children[b]={type:'file',name:b,content:'',owner:this.state.user,group:this.state.user,mode:'0644'};if(!this.writable(q))return false;par.children[b].content=append?par.children[b].content+data:data;saveState(this.state);return true}
 ls(a){const n=this.get(a[0]||this.cwd);if(!n)return {status:2,out:'ls: no such file'};if(n.type!=='dir')return {status:0,out:`${modeString(n)} ${n.owner||'root'} ${n.name}`};return {status:0,out:Object.values(n.children).sort((x,y)=>x.type.localeCompare(y.type)||x.name.localeCompare(y.name)).map(x=>`${modeString(x)} ${x.owner||'root'} ${x.name}${x.type==='dir'?'/':''}`).join('\n')}}
 cd(p){const n=this.get(p);if(!n||n.type!=='dir')return {status:1,out:'cd: directory not found'};this.cwd=norm(p,this.cwd);this.state.cwd=this.cwd;return {status:0,out:''}}
 cat(a){if(!a.length)return {status:1,out:'cat: missing file'};let out=[];for(const x of a){const n=this.get(x);if(!n||n.type!=='file')return {status:1,out:`cat: ${x}: not a file`};out.push(n.content||'')}return {status:0,out:out.join('\n')}}
 touch(a){for(const x of a){const p=norm(x,this.cwd),par=node(this.fs,parent(p));if(!par||par.type!=='dir')return {status:1,out:`touch: ${x}: parent not found`};if(!par.children[base(p)])par.children[base(p)]={type:'file',name:base(p),content:'',owner:this.state.user,group:this.state.user,mode:'0644'}}saveState(this.state);return {status:0,out:''}}
 mkdir(a){for(const x of a){const p=norm(x,this.cwd),par=node(this.fs,parent(p));if(!par||par.type!=='dir')return {status:1,out:`mkdir: ${x}: parent not found`};par.children[base(p)]={type:'dir',name:base(p),children:{},owner:this.state.user,group:this.state.user,mode:'0755'}}saveState(this.state);return {status:0,out:''}}
 rm(a){for(const x of a){const p=norm(x,this.cwd),par=node(this.fs,parent(p));if(!par?.children?.[base(p)])return {status:1,out:`rm: ${x}: not found`};delete par.children[base(p)]}saveState(this.state);return {status:0,out:''}}
 cp(a){if(a.length<2)return {status:1,out:'cp: usage cp SRC DST'};const s=this.get(a[0]),p=norm(a[1],this.cwd),par=node(this.fs,parent(p));if(!s||!par?.children)return {status:1,out:'cp: source or destination not found'};par.children[base(p)]=structuredClone(s);par.children[base(p)].name=base(p);saveState(this.state);return {status:0,out:''}}
 mv(a){const r=this.cp(a);if(r.status)return r;return this.rm([a[0]])}
 tree(p,d=0){const n=this.get(p);if(!n)return {status:1,out:'tree: path not found'};const out=[];const walk=(x,prefix='')=>{out.push(prefix+(x.name==='/'?'./':x.name+(x.type==='dir'?'/':'')));if(x.type==='dir'&&d<4)for(const c of Object.values(x.children).sort((a,b)=>a.name.localeCompare(b.name)))walk(c,prefix+'  ')};walk(n);return {status:0,out:out.join('\n')}}
 find(p,pat){const n=this.get(p);if(!n)return {status:1,out:'find: path not found'};const out=[];const walk=(x,q)=>{if(!pat||x.name.includes(pat))out.push(q);if(x.type==='dir')for(const c of Object.values(x.children))walk(c,q+(q==='/'?'':'/')+c.name)};walk(n,norm(p,this.cwd));return {status:0,out:out.join('\n')}}
 aliasCmd(a){if(!a.length)return {status:0,out:Object.entries(this.aliases).map(([k,v])=>`${k}='${v}'`).join('\n')};const [k,...v]=a;this.aliases[k]=v.join(' ');this.state.aliases=this.aliases;return {status:0,out:''}}
 exportCmd(a){for(const x of a){const m=x.match(/^([^=]+)=(.*)$/);if(m)this.env[m[1]]=m[2]}this.state.env=this.env;return {status:0,out:''}}
 ps(){const out=['PID  PPID USER     STATE CMD'];for(const p of this.kernel.list())out.push(`${String(p.pid).padEnd(5)}${String(p.ppid).padEnd(5)}${String(p.owner).padEnd(9)}${String(p.state).padEnd(6)}${p.cmd}`);return {status:0,out:out.join('\n')}}
 top(){return {status:0,out:this.kernel.list().map(p=>`${String(p.pid).padStart(4)} ${String(p.cpu).padStart(4)}% ${String(p.mem).padStart(4)}K ${p.state.padEnd(5)} ${p.owner.padEnd(8)} ${p.cmd}`).join('\n')}}
 kill(a){const r=this.kernel.kill(a[0],a[1]?.replace('-','').toUpperCase()==='KILL'?'KILL':'TERM');return {status:r.ok?0:1,out:r.msg}}
 procState(pid,s){if(!this.kernel.resume(pid))return {status:1,out:`${pid}: no such process`};return {status:0,out:`[${pid}] ${s}`}}
 chmod(a){if(a.length<2)return {status:1,out:'chmod: usage chmod MODE FILE'};const n=this.get(a[1]);if(!n)return {status:1,out:'chmod: file not found'};try{chmodNode(n,a[0]);saveState(this.state);return {status:0,out:''}}catch(e){return {status:1,out:e.message}}}
 chown(a){if(a.length<2)return {status:1,out:'chown: usage chown USER[:GROUP] FILE'};const n=this.get(a[1]);if(!n)return {status:1,out:'chown: file not found'};const [u,g]=a[0].split(':');chownNode(n,u,g);saveState(this.state);return {status:0,out:''}}
 stat(a){const n=this.get(a[0]||'.');if(!n)return {status:1,out:'stat: not found'};return {status:0,out:`File: ${a[0]||'.'}\nType: ${n.type}\nOwner: ${n.owner||'root'}\nGroup: ${n.group||n.owner||'root'}\nMode: ${perms(n)} (${modeString(n)})`}}
 service(a){if(!a.length)return {status:0,out:[...this.kernel.services.values()].map(s=>`${s.id.padEnd(16)} ${s.status}`).join('\n')};const r=this.kernel.service(a[0],a[1]||'status');return {status:r.ok?0:1,out:r.msg}}
 logs(a){if(a[0]==='clear'){this.state.logs=[];saveState(this.state);return {status:0,out:'logs cleared'}}const n=Math.min(200,Number(a[0])||30);return {status:0,out:this.state.logs.slice(-n).map(x=>`[${x.ts}] ${x.level.toUpperCase()} ${x.msg}`).join('\n')}}
 reg(a){if(!a.length)return {status:0,out:JSON.stringify(this.state.registry,null,2)};return {status:0,out:'registry editor: list|get|set|del|export (virtual registry)'}}
 web(a,type){const p=a[0];if(!p)return {status:1,out:`${type}: usage ${type} FILE`};return this.cat([p])}
 runFile(p){const n=this.get(p||'');if(!n)return {status:1,out:'run: file not found'};this.host.preview(n.content,'text/html');return {status:0,out:`sandboxed preview: ${norm(p,this.cwd)}`}}
 theme(x){if(x)this.state.settings.theme=x;saveState(this.state);document.documentElement.dataset.theme=x||'green'}
 open(p){return this.runFile(p)}
 nyancat(){this.print(`<div class="nyan-wrap"><div class="starfield"></div><div class="rainbow">🌈🌈🌈🌈🌈</div><div class="nyan">🐱</div><div class="nyan-text">NYANCAT // TERMOS EASTER EGG</div></div>`);}
}

/* ===== uefi.js ===== */

class UEFI{
  constructor(state,{onExit}){this.state=state;this.onExit=onExit;this.tab='Main';this.info=null;this.fps=0;this.fpsMeter=new FPSMeter(f=>{this.fps=f;this.renderHeader()});this.bootOrder=['TERMOS OS','UEFI Shell','Virtual PXE'];this.bootDelay=state.settings.bootDelay||1200;this.secureBoot=!!state.settings.secureBoot;}
  async open(){document.getElementById('uefi').classList.remove('hidden');this.info=await enrichStorage(getHardwareSnapshot());this.fpsMeter.start();this.bind();this.render()}
  close(){this.fpsMeter.stop();document.getElementById('uefi').classList.add('hidden')}
  bind(){document.querySelectorAll('#uefi-tabs button').forEach(b=>b.onclick=()=>{this.tab=b.dataset.tab;document.querySelectorAll('#uefi-tabs button').forEach(x=>x.classList.toggle('active',x===b));this.render()});document.onkeydown=e=>{if(document.getElementById('uefi').classList.contains('hidden'))return;if(e.key==='Escape'){e.preventDefault();this.exit(false)}if(e.key==='F10'){e.preventDefault();this.exit(true)}}}
  renderHeader(){const el=document.getElementById('uefi-fps');if(el)el.textContent=`FPS ${this.fps.toFixed(0)}`}
  render(){const root=document.getElementById('uefi-content');this.renderHeader();root.innerHTML='';
    if(this.tab==='Main')root.innerHTML=this.mainHTML();
    if(this.tab==='Advanced')root.innerHTML=this.advancedHTML();
    if(this.tab==='Boot')root.innerHTML=this.bootHTML();
    if(this.tab==='Security')root.innerHTML=this.securityHTML();
    if(this.tab==='Exit')root.innerHTML=this.exitHTML();
    this.wireFields(root)
  }
  kv(rows){return `<div class="kv">${rows.map(([k,v])=>`<b>${k}</b><span>${v??'Unavailable'}</span>`).join('')}</div>`}
  mainHTML(){return `<div class="uefi-grid"><section class="uefi-card"><h3>System Summary</h3>${this.kv([['OS','TERMOS 1.0.0'],['Firmware','TERMOS UEFI'],['Mode','HTML / CSS / JavaScript'],['Boot order',this.bootOrder.join(' → ')],['Secure Boot',this.secureBoot?'Enabled':'Disabled'],['Clock limit',this.state.settings.maxClock+'% (virtual)'],['FPS',this.fps.toFixed(0)]])}</section><section class="uefi-card"><h3>Device</h3>${this.kv([['CPU threads',this.info?.cores],['Device memory',this.info?.deviceMemory],['Platform',this.info?.platform],['Touch points',this.info?.maxTouch],['Viewport',this.info?.viewport],['Screen',this.info?.screen],['Timezone',this.info?.timezone]])}</section><section class="uefi-card"><h3>Graphics</h3>${this.kv([['WebGL vendor',this.info?.webgl?.vendor],['Renderer',this.info?.webgl?.renderer],['WebGL version',this.info?.webgl?.version],['Max texture',this.info?.webgl?.maxTextureSize]])}<div class="small">GPU clocks cannot be controlled by a normal web page. The TERMO​S “MAX CLOCK” setting is a virtual performance cap used by the OS UI.</div></section></div>`}
  advancedHTML(){const w=this.info?.webgl||{};return `<div class="uefi-grid"><section class="uefi-card"><h3>Processor</h3>${this.kv([['logical processors',this.info?.cores],['deviceMemory',this.info?.deviceMemory],['performance.now','available'],['Current FPS',this.fps.toFixed(0)],['Benchmark','Press RUN below']])}<button id="bench" style="margin-top:12px" class="uefi-select">RUN JS BENCHMARK</button><div id="benchout" class="small" style="margin-top:8px"></div></section><section class="uefi-card"><h3>Graphics</h3>${this.kv([['Vendor',w.vendor],['Renderer',w.renderer],['Version',w.version],['Max texture',w.maxTextureSize],['Color depth',this.info?.colorDepth+' bit']])}</section><section class="uefi-card"><h3>Browser / Runtime</h3>${this.kv([['User Agent',this.info?.browser],['UA-CH',this.info?.uaData],['Vendor',this.info?.vendor],['Language',this.info?.language],['Languages',this.info?.languages],['PDF viewer',this.info?.pdfViewer],['Cookies',this.info?.cookie],['DNT',this.info?.doNotTrack]])}</section><section class="uefi-card"><h3>Network / Storage</h3>${this.kv([['Online',String(this.info?.online)],['Connection',this.info?.connection],['Storage',this.storageText()]] )}</section><section class="uefi-card"><h3>Performance Policy</h3><label class="small">Virtual MAX CLOCK <input id="maxClock" type="range" min=10 max=100 value="${this.state.settings.maxClock||100}"></label><div id="maxClockOut" class="good">${this.state.settings.maxClock||100}%</div><div class="small">Browser security prevents changing the host CPU/GPU clock. TERMOS uses this value as a virtual performance policy.</div></section></div>`}
  storageText(){const e=this.info?.storageEstimate;if(!e?.quota)return 'Unavailable';return `${(e.usage/1048576).toFixed(1)} MB / ${(e.quota/1073741824).toFixed(2)} GB approx.`}
  bootHTML(){return `<div class="uefi-grid"><section class="uefi-card"><h3>Boot Configuration</h3><label class="small">Boot delay (ms)<input id="bootDelay" class="uefi-num" type="number" min="0" max="10000" value="${this.bootDelay}"></label><div style="margin-top:10px"><label class="small">Primary device<select id="bootPrimary" class="uefi-select">${this.bootOrder.map((x,i)=>`<option ${i===0?'selected':''}>${x}</option>`).join('')}</select></label></div><div class="small" style="margin-top:10px">Press Enter repeatedly during POST to open this page. F10 saves firmware settings in this browser profile.</div></section><section class="uefi-card"><h3>Boot Order</h3>${this.bootOrder.map((x,i)=>`<div style="margin:8px 0"><span class="chip">${i+1}</span>${x}</div>`).join('')}</section></div>`}
  securityHTML(){return `<div class="uefi-grid"><section class="uefi-card"><h3>Security</h3><label class="uefi-switch"><input id="secureBoot" type="checkbox" ${this.secureBoot?'checked':''}> Secure Boot (virtual)</label><div class="small" style="margin-top:12px">This setting controls the simulated boot state only; it does not change firmware Secure Boot on the host computer.</div></section><section class="uefi-card"><h3>Account</h3>${this.kv([['Username',this.state.user||'Not configured'],['Password',this.state.passwordDisabled?'Disabled':'Enabled'],['Storage','localStorage']])}</section></div>`}
  exitHTML(){return `<div class="uefi-grid"><section class="uefi-card"><h3>Exit Options</h3><button id="exitSave" class="uefi-select">Save Changes & Exit</button><button id="exitNoSave" class="uefi-select" style="margin-top:8px">Exit Without Saving</button><button id="resetOS" class="uefi-select danger" style="margin-top:8px">Reset TERMOS User Data</button></section></div>`}
  wireFields(root){root.querySelector('#bench')?.addEventListener('click',async()=>{const o=await benchmark();root.querySelector('#benchout').textContent=`${o.iterations.toLocaleString()} iterations / ${o.ms.toFixed(0)} ms`});root.querySelector('#bootDelay')?.addEventListener('change',e=>this.bootDelay=Math.max(0,Math.min(10000,+e.target.value||0)));root.querySelector('#secureBoot')?.addEventListener('change',e=>this.secureBoot=e.target.checked);root.querySelector('#maxClock')?.addEventListener('input',e=>{this.state.settings.maxClock=+e.target.value;root.querySelector('#maxClockOut').textContent=`${e.target.value}%`});root.querySelector('#exitSave')?.addEventListener('click',()=>this.exit(true));root.querySelector('#exitNoSave')?.addEventListener('click',()=>this.exit(false));root.querySelector('#resetOS')?.addEventListener('click',()=>{if(confirm('Reset all TERMOS data for this browser?')){localStorage.clear();location.reload()}})}
  exit(save){if(save){this.state.settings.bootDelay=this.bootDelay;this.state.settings.secureBoot=this.secureBoot;localStorage.setItem('termos-uefi-settings-v1',JSON.stringify({bootDelay:this.bootDelay,secureBoot:this.secureBoot}))}this.close();document.onkeydown=null;this.onExit?.()}
}

/* ===== app bootstrap ===== */

const state=loadState();
let bootEnterCount=0,bootDone=false,bootTimer=null;
const $=id=>document.getElementById(id);
const bootLog=(msg)=>{const d=document.createElement('div');d.textContent=msg;$('boot-log').appendChild(d);$('boot-log').scrollTop=$('boot-log').scrollHeight;state.logs.push({ts:new Date().toISOString(),level:'info',msg});saveState(state)};
function show(id){for(const x of ['boot','uefi','login','setup','os'])$(x).classList.toggle('hidden',x!==id)}
function applySettings(){try{const s=JSON.parse(localStorage.getItem('termos-uefi-settings-v1')||'{}');state.settings={...state.settings,...s}}catch{}}
applySettings();
const info=getHardwareSnapshot();
let fpsMeter;
function boot(){show('boot');bootEnterCount=0;bootDone=false;const phases=['POST: CPU topology detected','Memory probe: browser deviceMemory hint','Display init: WebGL','Storage init: localStorage','Runtime init: ES modules','Kernel init: virtual process manager','Termsh: userspace shell ready'];let p=0;let progress=0;bootLog('TERMOS BIOS 1.1.0 / UEFI-compatible firmware');bootLog('Booting TERMOS...  Press ENTER 3x for UEFI.  Press ESC for boot menu.');const onKey=e=>{if(bootDone)return;if(e.key==='Enter'){bootEnterCount++;if(bootEnterCount>=3){bootDone=true;clearInterval(bootTimer);document.removeEventListener('keydown',onKey);openUEFI();return}}if(e.key==='Escape'){bootDone=true;clearInterval(bootTimer);document.removeEventListener('keydown',onKey);showGrub();e.preventDefault()}};document.addEventListener('keydown',onKey);bootTimer=setInterval(()=>{if(bootDone)return;if(p<phases.length){bootLog(`[${String(Math.round(progress)).padStart(3,' ')}%] ${phases[p++]}`);progress=(p/phases.length)*100;$('boot-progress-bar').style.width=progress+'%'}else{bootDone=true;clearInterval(bootTimer);document.removeEventListener('keydown',onKey);setTimeout(continueBoot,180)}},150)}
function showGrub(){const grub=$('grub');grub.classList.remove('hidden');const items=['TERMOS OS 1.1.0','TERMOS Recovery / Safe Mode','UEFI Firmware Setup','Memory Diagnostic'];let selected=0;const render=()=>{$('grub-items').innerHTML=items.map((x,i)=>`<div class="grub-item ${i===selected?'selected':''}"><span>${i===selected?'▶':' '}</span> ${x}</div>`).join('')};render();const key=e=>{if(grub.classList.contains('hidden'))return;if(e.key==='ArrowDown'){selected=(selected+1)%items.length;render();e.preventDefault()}if(e.key==='ArrowUp'){selected=(selected+items.length-1)%items.length;render();e.preventDefault()}if(e.key==='F2'){cleanup();openUEFI();e.preventDefault()}if(e.key==='Enter'){cleanup();if(selected===2)openUEFI();else if(selected===3){bootLog('Memory diagnostic: browser-managed memory; no raw RAM access available.');show('boot');setTimeout(showGrub,900)}else continueBoot();e.preventDefault()}};const cleanup=()=>document.removeEventListener('keydown',key);document.addEventListener('keydown',key);}
function openUEFI(fromOS=false){show('uefi');const u=new UEFI(state,{onExit:()=>fromOS?startOS():continueBoot()});u.open()}
function continueBoot(){show(state.user? 'login':'setup');if(state.user)setupLogin()}
function setupLogin(){const form=$('login-form');$('login-mode').textContent=state.passwordDisabled?'Password disabled · local account':'Local account authentication';$('login-user').value=state.user;form.onsubmit=async e=>{e.preventDefault();const user=$('login-user').value.trim();const pass=$('login-pass').value;if(user!==state.user){$('login-msg').textContent='Unknown user';return}if(state.passwordDisabled||await sha256(pass)===state.passwordHash){$('login-msg').textContent='';startOS()}else $('login-msg').textContent='Invalid password'};}
$('setup-empty').onchange=e=>{if(e.target.checked){$('setup-pass').value='';$('setup-pass2').value='';$('setup-pass').disabled=true;$('setup-pass2').disabled=true}else{$('setup-pass').disabled=false;$('setup-pass2').disabled=false}};
$('setup-form').onsubmit=async e=>{e.preventDefault();const user=$('setup-user').value.trim();const p1=$('setup-pass').value;const p2=$('setup-pass2').value;if(!user){$('setup-msg').textContent='Username is required';return}if(!$('setup-empty').checked&&p1!==p2){$('setup-msg').textContent='Passwords do not match';return}state.user=user;state.passwordDisabled=$('setup-empty').checked;state.passwordHash=state.passwordDisabled?null:await sha256(p1);state.cwd='/home/'+user;state.env.USER=user;const home=getNodeForSetup('/home');home.children[user]={type:'dir',name:user,children:{'welcome.txt':{type:'file',name:'welcome.txt',content:'Welcome to TERMOS.\n'}}};saveState(state);startOS()};
function getNodeForSetup(p){let n=state.fs;for(const x of p.split('/').filter(Boolean)){n=n.children[x]}return n}
function startOS(){show('os');$('cmd').value='';$('cmd').focus();fpsMeter=new FPSMeter(()=>{});fpsMeter.start();const host={term:$('terminal'),prompt:$('prompt'),user:$('prompt-user'),input:$('cmd'),info:getHardwareSnapshot(),fps:()=>fpsMeter.current,uptimeText:()=>{return 'session active'},preview:(html,type)=>{const wrap=document.createElement('div');wrap.className='terminal-line';const frame=document.createElement('iframe');frame.style='width:100%;height:220px;border:1px solid #223029;background:#fff';frame.sandbox='allow-scripts';frame.srcdoc=type==='text/html'?html:`<pre>${html}</pre>`;wrap.appendChild(frame);$('terminal').appendChild(wrap)},};const term=new Terminal({state,host,onReboot:()=>location.reload(),onShutdown:()=>shutdown(),onUEFI:()=>openUEFI(true)});term.start();wireInput(term)}
function wireInput(term){const inp=$('cmd');inp.onkeydown=async e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();const v=inp.value;inp.value='';inp.style.height='22px';await term.runLine(v);return}if(e.key==='ArrowUp'&&inp.value===''){const idx=Math.max(0,(state.history?.length||1)-1);inp.value=state.history[idx]||'';e.preventDefault()}if(e.key==='Escape'){inp.value='';}}
inp.oninput=()=>{inp.style.height='auto';inp.style.height=Math.min(inp.scrollHeight,150)+'px'};setTimeout(()=>inp.focus(),50)}
function shutdown(){document.body.innerHTML='<div class="screen" style="display:flex;align-items:center;justify-content:center;background:#000;color:#87ffad;font-family:monospace;flex-direction:column;gap:8px"><div style="font-size:40px">TER​MOS</div><div>System halted.</div><div style="color:#6c806f">It is safe to close this tab.</div></div>'}
boot();
