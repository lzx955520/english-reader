// Optional real-source verification. Never substitutes fixture content or calls a model.
const {_electron:electron}=require('@playwright/test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'reader-live-news-'));let desktop;
 try{
  desktop=await electron.launch({args:['--no-sandbox','--disable-gpu','.'],env:{...process.env,READER_E2E:'1',READER_DATA_DIR:directory,READER_TEST_OFFLINE:'0'}});
  const page=await desktop.firstWindow();await page.waitForFunction(()=>!!window.reader);
  await page.evaluate(()=>window.reader.refresh(true));const state=await page.evaluate(()=>window.reader.state());
  const news=state.articles.filter(a=>a.kind==='news');
  if(!news.length)throw Error(state.refreshError||'来源没有满足要求的近期文章');
  for(const a of news){if(!a.url.startsWith('https://en.wikinews.org/')||!a.license.startsWith('CC BY '))throw Error('Unexpected source');console.log(JSON.stringify({title:a.title,published:a.published,url:a.url,license:a.license,words:a.words}));}
  console.log('Verified actual news articles:',news.length);
 }catch(e){console.error(e instanceof Error?e.message:'Real-source check failed');process.exitCode=1;}
 finally{if(desktop)await desktop.close();fs.rmSync(directory,{recursive:true,force:true});}
})();
