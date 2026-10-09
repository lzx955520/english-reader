import {app,BrowserWindow,ipcMain,dialog,shell,safeStorage,net} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import {z} from 'zod';
import {Store} from './store';
import {Vault} from './vault';
import {NewsService,callAI} from './network';
import {localDay} from './domain';
import {RefreshManager} from './refresh';
import {feature,settingsSchema} from './schemas';
import type {Feature} from '../src/types';
const testMode=!app.isPackaged&&process.env.READER_E2E==='1';
if(testMode&&process.env.READER_DATA_DIR)app.setPath('userData',process.env.READER_DATA_DIR);
let store:Store,vault:Vault,window:BrowserWindow|null=null;
const primaryInstance=app.requestSingleInstanceLock();
if(!primaryInstance)app.quit();
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
const jobs=new Map<string,AbortController>();let refreshManager:RefreshManager;
const assets=path.join(app.getAppPath(),'assets');
const networkFetch=(url:string,options?:RequestInit)=>net.fetch(url,options);
const news=new NewsService(testMode&&process.env.READER_TEST_OFFLINE==='1'?async()=>{throw Error('测试断网');}:networkFetch);
function refresh(force=false){return refreshManager.refresh(force);}
const id=z.string().min(1).max(150);
function register(){
 const handle=(name:string,fn:(...args:any[])=>any)=>ipcMain.handle(name,(event,...args)=>{
  if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame)throw Error('不受信任的请求');return fn(...args);
 });
 handle('state',()=>{const s=store.state();for(const f of ['context','grammar','selection'] as Feature[]){try{s.settings.models[f].hasKey=!!vault.get(f);}catch{s.settings.models[f].hasKey=false;}}return s;});
 handle('refresh',(force:unknown)=>refresh(z.boolean().optional().parse(force)));
 handle('cancel',(job:unknown)=>{const name=id.parse(job);if(name==='refresh')refreshManager.cancel();else jobs.get(name)?.abort();});
 handle('lookup',(word:unknown)=>store.lookup(z.string().max(120).parse(word)));
 handle('progress',(article:unknown,p:unknown,position:unknown)=>store.progress(id.parse(article),z.number().finite().min(0).max(1).parse(p),z.number().finite().min(0).max(1e8).parse(position)));
 handle('saveCard',(input:unknown)=>store.saveCard(z.object({word:z.string().min(1).max(120),meaning:z.string().max(12000),example:z.string().max(10000),articleId:id}).parse(input)));
 handle('review',(card:unknown,rating:unknown,version:unknown)=>store.review(id.parse(card),z.union([z.literal(0),z.literal(3),z.literal(4),z.literal(5)]).parse(rating),z.number().int().nonnegative().parse(version)));
 handle('deleteCard',(card:unknown)=>store.deleteCard(id.parse(card)));
 handle('saveSettings',(input:unknown,keys:unknown)=>{
  const settings=settingsSchema.parse(input);const parsed=z.object({context:z.string().max(500).optional(),grammar:z.string().max(500).optional(),selection:z.string().max(500).optional()}).strict().parse(keys);
  for(const f of ['context','grammar','selection'] as Feature[])if(parsed[f]!==undefined)vault.set(f,parsed[f]!);store.saveSettings(settings);
 });
 handle('trackMinutes',(seconds:unknown)=>store.trackSeconds(z.number().int().min(0).max(60).parse(seconds)));
 handle('ai',async(input:unknown)=>{
  const r=z.object({feature,text:z.string().min(1).max(15000),context:z.string().max(15000).optional(),approved:z.literal(true),operationId:id}).parse(input);
  if(jobs.has(r.operationId))throw Error('该请求仍在进行');const key=vault.get(r.feature);if(!key)throw Error('未配置 API 密钥；请在设置中录入，基础功能不受影响');
  const controller=new AbortController();jobs.set(r.operationId,controller);
  try{const result=await callAI(store.state().settings.models[r.feature],key,r.feature,r.text,r.context||'',controller.signal,networkFetch);controller.signal.throwIfAborted();return result;}
  catch(e){if(controller.signal.aborted)throw Error('请求已取消；服务端可能已计费');throw Error(e instanceof Error&&/^服务返回 HTTP \d+$/.test(e.message)?e.message:'AI 请求失败，请检查接口、模型、密钥及网络；不会自动重试');}
  finally{jobs.delete(r.operationId);}
 });
 handle('backup',async()=>{const result=await dialog.showSaveDialog(window!,{title:'备份（不含 API 密钥）',defaultPath:'english-reader-backup.json',filters:[{name:'JSON',extensions:['json']}]});if(result.canceled||!result.filePath)return false;atomicWrite(result.filePath,JSON.stringify(store.backup(),null,2));return true;});
 handle('restore',async()=>{const result=await dialog.showOpenDialog(window!,{title:'选择备份',properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});if(result.canceled)return false;const file=result.filePaths[0];if(fs.statSync(file).size>50*1024*1024)throw Error('备份超过 50 MB 上限');const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
  const confirmation=await dialog.showMessageBox(window!,{type:'warning',buttons:['取消','恢复备份'],defaultId:0,cancelId:0,message:'恢复将替换当前文章、进度、收藏和设置。现有数据会先在数据目录保存安全备份，API 密钥不受影响。'});if(confirmation.response!==1)return false;
  const safety=path.join(path.dirname(store.file),`before-restore-${Date.now()}.json`);atomicWrite(safety,JSON.stringify(store.backup(),null,2));store.restore(parsed);return true;
 });
 handle('exportCards',async()=>{const result=await dialog.showSaveDialog(window!,{title:'导出生词和例句',defaultPath:'english-reader-vocabulary.csv',filters:[{name:'CSV',extensions:['csv']}]});if(result.canceled||!result.filePath)return false;
  const escape=(value:string)=>'"'+(/^\s*[=+@-]/.test(value)?"'"+value:value).replace(/"/g,'""')+'"';
  const rows=[['单词/短语','释义','例句','来源','链接','下次复习'],...store.state().cards.map(c=>[c.word,c.meaning,c.example,c.sourceTitle,c.sourceUrl,c.due])];atomicWrite(result.filePath,'\uFEFF'+rows.map(r=>r.map(escape).join(',')).join('\r\n'));return true;
 });
 handle('openSource',async(input:unknown)=>{const url=z.string().url().max(1000).parse(input);const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('只允许安全 HTTPS 来源链接');await shell.openExternal(url);});
 // Integration hooks are not exposed through preload and are unavailable in packaged production builds.
 if(testMode){handle('__testBackup',()=>store.backup());handle('__testRestore',(b:unknown)=>store.restore(b));}
}
function atomicWrite(file:string,data:string){const tmp=file+'.tmp';fs.writeFileSync(tmp,data,{mode:0o600});fs.renameSync(tmp,file);}
if(primaryInstance)app.whenReady().then(async()=>{
 store=await Store.open(app.getPath('userData'),assets,path.join(app.getAppPath(),'node_modules/sql.js/dist/sql-wasm.wasm'));
 vault=new Vault(app.getPath('userData'),safeStorage);refreshManager=new RefreshManager(store,news);register();
 window=new BrowserWindow({width:1340,height:880,minWidth:1050,minHeight:700,backgroundColor:'#f6f5f1',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
 window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 await window.loadFile(path.join(app.getAppPath(),'dist/index.html'));void refresh();
 const timer=setInterval(()=>{if(store.state().lastRefresh!==localDay())void refresh();},60000);timer.unref();
 window.on('closed',()=>{window=null;});
}).catch(()=>{dialog.showErrorBox('启动失败','无法打开应用数据或词典。请检查数据目录权限；现有数据不会自动重置。');app.quit();});
app.on('before-quit',()=>{refreshManager?.cancel();for(const job of jobs.values())job.abort();store?.close();});
app.on('window-all-closed',()=>app.quit());
