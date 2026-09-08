// Read-only audit: instrument a copy in memory; product files are never modified.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {}), headless:true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>.unrelated:hover{color:red}.animated{animation:pulse 1s infinite}@keyframes pulse{to{opacity:.5}}</style><div id="sample"><span style="color:red">A</span><span style="color:blue">B</span></div><button class="unrelated">outside</button><div class="animated">moving</div>`);
    await page.evaluate(() => { window.chrome = {runtime:{id:'audit',getURL:()=>'',onMessage:{addListener(){}}}}; });
    const source = fs.readFileSync(path.join(__dirname,'../content.js'),'utf8').replace('window.__componentSampler = { start, stop };', 'window.__audit = {analyze,sanitizeTree,collectStyles,collectMotion,collectStateRules,inferInteractions,updateOverlay,buildPayload,buildMarkdown,writeClipboard,setPayload(p){payload=p}}; window.__componentSampler = { start, stop };');
    await page.addScriptTag({content:source});
    const results = await page.evaluate(() => {
      const a=window.__audit, results=[];
      const record=(id,bugObserved,evidence)=>results.push({id,bugObserved,evidence});
      const moving=document.querySelector('.animated'), raw=a.collectMotion(moving), analyzed=a.analyze(moving);
      a.setPayload(analyzed);
      record('motion-dropped',raw.signals.length===0||!analyzed.motion||!a.buildMarkdown().includes('pulse'),{collectedSignals:raw.signals,exportedMotion:a.buildPayload().motion});
      const sample=document.querySelector('#sample');
      const state=a.collectStateRules(sample);
      record('outside-state-contamination',state.hover.some(x=>x.includes('.unrelated')),{hover:state.hover});
      const clean=a.sanitizeTree(sample), css=a.collectStyles(clean.orderedSources);
      const selectors=[...css.matchAll(/^([^\n]+) \{/gm)].map(x=>x[1]);
      const exported=document.createElement('div');exported.innerHTML=clean.html;
      record('css-target-mismatch',selectors.some(x=>exported.querySelectorAll(x).length!==1)||new Set(selectors).size<selectors.length,{html:clean.html,selectors});
      const renderHost=document.createElement('div');document.body.append(renderHost);
      const shadow=renderHost.attachShadow({mode:'open'});shadow.innerHTML='<style>'+css+'</style>'+clean.html;
      const colors=Array.from(shadow.querySelectorAll('span')).map(x=>getComputedStyle(x).color);
      record('exported-css-colors',colors.join('|')!=='rgb(255, 0, 0)|rgb(0, 0, 255)',{colors});renderHost.remove();
      const textarea=document.createElement('textarea');textarea.textContent='AUDIT_PRIVATE_TEXT';document.body.append(textarea);
      const sanitizedTextarea=a.sanitizeTree(textarea);
      record('textarea-value-survives',sanitizedTextarea.html.includes('AUDIT_PRIVATE_TEXT'),{html:sanitizedTextarea.html,removed:[...sanitizedTextarea.removed]});
      const wide=document.createElement('div');wide.innerHTML='<span>x</span>'.repeat(1000);document.body.append(wide);
      const sanitizedWide=a.sanitizeTree(wide);
      record('node-limit-exceeded',sanitizedWide.nodeCount>300,{nodeCount:sanitizedWide.nodeCount,styledNodes:sanitizedWide.orderedSources.length});
      const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.innerHTML='<input type="checkbox"><select><option>one</option></select>';document.body.append(dialog);
      const interactions=a.inferInteractions(dialog);
      record('nested-interactions-skipped',!interactions.some(x=>/onChange/.test(x.implementation)),{interactions});
      a.updateOverlay({getBoundingClientRect:()=>({top:-50,left:10,width:100,height:100,right:110,bottom:50})},sample);
      const overlay=document.querySelector('#cs-host').shadowRoot.querySelector('.cs-overlay');
      record('scrolled-overlay-too-tall',overlay.style.top==='0px'&&overlay.style.height==='100px',{top:overlay.style.top,height:overlay.style.height,expectedVisibleBottom:50});
      const frame=document.createElement('iframe');document.body.append(frame);
      frame.contentDocument.body.innerHTML='<textarea>FRAME_PRIVATE</textarea><span>Frame text</span>';
      const frameCapture=a.sanitizeTree(frame);
      record('iframe-content',!frameCapture.html.includes('Frame text')||frameCapture.html.includes('FRAME_PRIVATE'),{html:frameCapture.html});
      return results;
    });
    const clipboard = await page.evaluate(async () => {
      const saved=Object.getOwnPropertyDescriptor(navigator,'clipboard');
      const originalExec=document.execCommand;
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});
      const writes=[];
      document.execCommand=()=>{const data=new DataTransfer();document.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,cancelable:true}));writes.push({text:data.getData('text/plain'),html:data.getData('text/html')});return true;};
      try {await window.__audit.writeClipboard('plain test');await window.__audit.writeClipboard('<b>figma test</b>','text/html');}
      finally {document.execCommand=originalExec;if(saved)Object.defineProperty(navigator,'clipboard',saved);else delete navigator.clipboard;}
      return writes;
    });
    results.push({id:'clipboard-fallback-routing',passed:clipboard[0].text==='plain test'&&clipboard[1].html==='<b>figma test</b>',evidence:clipboard});
    await page.addScriptTag({path:path.join(__dirname,'../figit.js')});
    const conversion = await page.evaluate(async () => {
      window.__FIGIT_DEBUG=true;
      const progress=[],warnings=[];
      const result=await window.__figitConvert(document.querySelector('#sample'),{onProgress:text=>progress.push(text),onWarning:text=>warnings.push(text)});
      return {htmlLength:result.html.length,nodeCount:result.nodeCount,byteSize:result.byteSize,hasFigmaMarker:result.html.includes('figma'),progress,warnings};
    });
    results.push({id:'figma-conversion-smoke',passed:conversion.nodeCount>0&&conversion.hasFigmaMarker,evidence:conversion});
    results.push({id:'real-font-progress-warning',passed:conversion.progress.some(x=>x.includes('字体'))&&conversion.warnings.some(x=>x.includes('后备字体')),evidence:{progress:conversion.progress,warnings:conversion.warnings}});
    const figmaPrivacy=await page.evaluate(async()=>{
      const result=await window.__figitConvert(document.querySelector('textarea'));
      return {nodeCount:result.nodeCount,containsInput:JSON.stringify(result.nodeChanges).includes('AUDIT_PRIVATE_TEXT')};
    });
    results.push({id:'figma-textarea-privacy',passed:figmaPrivacy.nodeCount>0&&!figmaPrivacy.containsInput,evidence:figmaPrivacy});
    const pngData=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=4;c.height=3;return c.toDataURL().split(',')[1];});
    await page.route('https://patternyze.test/**',async route=>{
      if(route.request().url().includes('blocked'))return route.abort();
      await route.fulfill({contentType:'image/png',headers:{'access-control-allow-origin':'*'},body:Buffer.from(pngData,'base64')});
    });
    const figmaImages=await page.evaluate(async()=>{
      const el=document.createElement('div');el.style.cssText='width:100px;height:100px;background-image:url(https://patternyze.test/image.png)';document.body.append(el);
      const result=await window.__figitConvert(el);
      el.style.backgroundImage='url(https://patternyze.test/blocked.png)';
      let blocked=false;try {await window.__figitConvert(el);}catch(e){blocked=e.message.includes('图片');}
      el.remove();return {hasImage:JSON.stringify(result.nodeChanges).includes('IMAGE'),blocked};
    });
    results.push({id:'figma-background-conversion',passed:figmaImages.hasImage&&figmaImages.blocked,evidence:figmaImages});
    const bundle=fs.readFileSync(path.join(__dirname,'../figit.js'),'utf8');
    const loaderSource=bundle.slice(bundle.indexOf('      var EMPTY_PNG_B64 ='),bundle.indexOf('      var loadPatternyzeImage =',bundle.indexOf('      var EMPTY_PNG_B64 =')));
    const imageEvidence=await page.evaluate(async (loaderSource)=>{
      const b64ToArrayBuffer=(s)=>Uint8Array.from(atob(s),x=>x.charCodeAt(0)).buffer;
      const dataUrlToBytes=(s)=>b64ToArrayBuffer(s.slice(s.indexOf(',')+1));
      const load=eval(`(()=>{${loaderSource};return createOfflineImageLoader()})()`);
      const canvas=document.createElement('canvas');canvas.width=4;canvas.height=3;
      const png=await (await fetch(canvas.toDataURL())).arrayBuffer();
      const originalFetch=window.fetch;let requested=false;
      window.fetch=async()=>{requested=true;return new Response(png,{headers:{'Content-Type':'image/png'}})};
      let output;
      try { output=await load({src:'https://example.invalid/real-background.png',element:document.querySelector('#sample')}); }
      finally {window.fetch=originalFetch;}
      const view=new DataView(output.bytes);
      let decodeError=null;
      try { const bitmap=await createImageBitmap(new Blob([output.bytes],{type:output.mimeType})); bitmap.close(); } catch(e) {decodeError=e.message;}
      let rejected=false;window.fetch=async()=>{throw new Error('CORS blocked')};
      try {await load({src:'https://example.invalid/blocked.png'});}catch{rejected=true;}finally{window.fetch=originalFetch;}
      return {width:view.getUint32(16),height:view.getUint32(20),bytes:output.bytes.byteLength,decodeError,requested,rejected};
    },loaderSource);
    results.push({id:'http-background-image-replaced',bugObserved:imageEvidence.width!==4||imageEvidence.height!==3||!!imageEvidence.decodeError||!imageEvidence.requested||!imageEvidence.rejected,evidence:imageEvidence});
    await page.evaluate((icon)=>{
      window.__componentSampler.start();
      const shadow=document.querySelector('#cs-host').shadowRoot;
      shadow.querySelector('.cs-brand-thumb').style.backgroundImage=`url("${icon}")`;
      shadow.querySelector('.cs-btn-select').click();
      const target=document.querySelector('#sample');
      target.dispatchEvent(new PointerEvent('pointermove',{bubbles:true}));target.click();
    },'data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'../icons/patternyze-logo.png')).toString('base64'));
    await page.screenshot({path:path.join(__dirname,'patternyze-ui.png')});
    const uiCheck=await page.evaluate(()=>{const s=document.querySelector('#cs-host').shadowRoot;return {name:s.querySelector('.cs-brand-name').textContent,detailVisible:!s.querySelector('.cs-detail').hidden};});
    results.push({id:'patternyze-ui-selection',passed:uiCheck.name==='Patternyze'&&uiCheck.detailVisible,evidence:uiCheck});
    fs.writeFileSync(path.join(__dirname,'regression-results.json'),JSON.stringify({date:new Date().toISOString(),environment:'Headless Chrome, DOM behavior; mocked chrome.runtime and clipboard fallback; no installed-extension or Figma paste acceptance. Image loader isolated from bundled source for deterministic testing.',results},null,2));
    console.log(JSON.stringify(results,null,2));
    if(results.some(x=>x.bugObserved===true||x.passed===false))process.exitCode=1;
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
