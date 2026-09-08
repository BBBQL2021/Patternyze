// Isolated extension acceptance on a synthetic local page. Test-only localhost
// access bypasses toolbar activation; never ship this test manifest.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
  const root=path.resolve(__dirname,'..'),fixture=path.join(root,'evidence-test-extension');fs.mkdirSync(fixture,{recursive:true});
  for(const f of ['content.js','service-worker.js','diagnostics-worker.js'])fs.copyFileSync(path.join(root,f),path.join(fixture,f));
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));manifest.host_permissions=['http://127.0.0.1/*'];delete manifest.icons;delete manifest.action.default_icon;
  fs.mkdirSync(path.join(fixture,'icons'),{recursive:true});fs.copyFileSync(path.join(root,'icons/patternyze-logo.png'),path.join(fixture,'icons/patternyze-logo.png'));
  fs.writeFileSync(path.join(fixture,'manifest.json'),JSON.stringify(manifest));
  const server=http.createServer((req,res)=>{if(req.url.startsWith('/failure')){res.writeHead(500);res.end('synthetic failure');return;}
    res.setHeader('content-type','text/html; charset=utf-8');res.end('<style>body{font:18px system-ui;background:#eee8dc;padding:50px}section{background:white;padding:25px;width:420px;border-radius:15px}button{padding:14px}</style><title>问题反馈测试</title><section data-testid="sales"><h1>销售额</h1><button id="repro">复现问题</button></section><section data-testid="orders"><h1>订单量</h1></section><script>document.querySelector("button").onclick=()=>{console.error("Synthetic error token=abc person@example.com");fetch("/failure?token=secret");};</script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let context;
  try {
    context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(root,'evidence-browser-profile-')),{channel:'chromium',headless:true,args:['--window-size=1400,1000',`--disable-extensions-except=${fixture}`,`--load-extension=${fixture}`],viewport:null});
    const sw=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
    await sw.evaluate(async()=>{const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url?.startsWith('http://127.0.0.1'));await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});});
    await page.getByRole('button',{name:'选择控件',exact:true}).click();await page.locator('section').first().click({position:{x:10,y:10}});
    await page.getByRole('switch',{name:'多选',exact:true}).check();
    await page.locator('[data-testid=orders]').click({position:{x:10,y:10}});
    await page.getByRole('button',{name:'完成选择',exact:true}).click();
    await page.getByRole('button',{name:'问题反馈',exact:true}).click();
    await page.locator('[data-ref="problem"]').fill('销售额加载失败');
    await page.getByRole('button',{name:'开始记录',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#cs-host').shadowRoot.querySelector('[data-ref="record-status"]').textContent.startsWith('正在记录'));
    await page.locator('#repro').click();
    await page.waitForFunction(()=>document.querySelector('#cs-host').shadowRoot.querySelector('[data-ref="record-preview"]').textContent.includes('500'));
    await page.getByRole('button',{name:'停止记录',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#cs-host').shadowRoot.querySelector('[data-ref="record-status"]').textContent.startsWith('记录已停止'));
    const logs=await page.locator('[data-ref="record-preview"]').textContent();assert(logs.includes('Synthetic error'));assert(!logs.includes('token=secret')&&!logs.includes('person@example.com')&&!logs.includes('token=abc'));
    await page.getByRole('button',{name:'截图 / 重拍',exact:true}).click();
    await page.waitForFunction(()=>{const s=document.querySelector('#cs-host').shadowRoot;return !s.querySelector('canvas').hidden||s.querySelector('[data-ref=shot-status]').textContent.startsWith('截图失败')});
    assert(!(await page.locator('[data-ref=shot-status]').textContent()).startsWith('截图失败'),await page.locator('[data-ref=shot-status]').textContent());
    await page.locator('[data-ref="screenshot"]').click();
    const editor=page.getByRole('dialog',{name:'截图标注编辑器'});assert(await editor.isVisible());assert.equal(await editor.getByRole('button',{name:'拖动',exact:true}).getAttribute('aria-pressed'),'true');
    await page.locator('[data-ref="mark-width"]').evaluate(el=>{el.value='9';el.dispatchEvent(new Event('input'));});
    await page.locator('[data-ref="mark-hue"]').evaluate(el=>{el.value='210';el.dispatchEvent(new Event('input'));});
    const color=await page.locator('[data-ref="mark-color"]').inputValue();
    const canvas=page.locator('[data-ref="editor-canvas"]');
    for(const tool of ['矩形','圆形','箭头','线条']){
      await editor.getByRole('button',{name:tool,exact:true}).click();const b=await canvas.boundingBox();
      await page.mouse.move(b.x+40,b.y+40);await page.mouse.down();await page.mouse.move(b.x+180,b.y+110);await page.mouse.up();
    }
    await editor.getByRole('button',{name:'文字',exact:true}).click();
    let b=await canvas.boundingBox();await page.mouse.dblclick(b.x+60,b.y+130);
    await page.getByRole('textbox',{name:'编辑标注文字'}).fill('检查销售额');await page.getByRole('button',{name:'确认文字',exact:true}).click();
    await page.mouse.dblclick(b.x+65,b.y+135);assert.equal(await page.getByRole('textbox',{name:'编辑标注文字'}).inputValue(),'检查销售额');
    await page.getByRole('textbox',{name:'编辑标注文字'}).fill('检查销售额更新');await page.keyboard.press('Control+Enter');
    await editor.getByRole('button',{name:'拖动',exact:true}).click();
    await page.mouse.move(b.x+65,b.y+135);await page.mouse.down();await page.mouse.move(b.x+105,b.y+155);await page.mouse.up();
    await editor.getByRole('button',{name:'撤销',exact:true}).click();
    await page.mouse.dblclick(b.x+65,b.y+135);assert.equal(await page.getByRole('textbox',{name:'编辑标注文字'}).inputValue(),'检查销售额更新');await page.keyboard.press('Escape');assert(await editor.isVisible());
    await page.mouse.move(b.x+65,b.y+135);await page.mouse.down();await page.mouse.move(b.x+105,b.y+155);await page.mouse.up();
    await editor.getByRole('button',{name:'序号',exact:true}).click();await page.mouse.click(b.x+220,b.y+80);
    await page.locator('[data-ref="mark-zoom"]').evaluate(el=>{el.value='150';el.dispatchEvent(new Event('input'));});
    assert.equal(await page.locator('[data-ref="zoom-value"]').textContent(),'150%');
    await editor.getByRole('button',{name:'拖动',exact:true}).click();b=await canvas.boundingBox();
    await page.mouse.move(b.x+700,b.y+150);await page.mouse.down();await page.mouse.move(b.x+600,b.y+150);await page.mouse.up();assert((await page.locator('[data-ref=editor-stage]').evaluate(el=>el.scrollLeft))>0);
    b=await canvas.boundingBox();await page.mouse.move(b.x+150,b.y+80);await page.mouse.wheel(0,-150);await page.waitForFunction(()=>Number(document.querySelector('#cs-host').shadowRoot.querySelector('[data-ref=mark-zoom]').value)>150);
    await editor.getByRole('button',{name:'适应宽度',exact:true}).click();assert.equal(await page.locator('[data-ref=zoom-value]').textContent(),'100%');
    await page.screenshot({path:path.join(__dirname,'annotation-editor.png')});
    await editor.getByRole('button',{name:'保存标注',exact:true}).click();assert(!(await editor.isVisible()));
    await page.locator('[data-ref="screenshot"]').click();await editor.getByRole('button',{name:'清空标注',exact:true}).click();
    await page.keyboard.press('Escape');assert(!(await editor.isVisible()));assert(await page.locator('.cs-detail').isVisible());
    const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'下载完整反馈（含截图）',exact:true}).click();const download=await downloadPromise;
    const dest=path.join(__dirname,'evidence-test-report.json');await download.saveAs(dest);const report=JSON.parse(fs.readFileSync(dest));
    assert(report.screenshot.annotations.length===10);assert(report.screenshot.annotations.some(m=>m.text==='检查销售额更新'));for(const type of ['rect','circle','arrow','line','text','number'])assert(report.screenshot.annotations.some(m=>m.type===type&&m.color===color&&m.width===9));
    assert(report.screenshot.pngDataUrl.startsWith('data:image/png;base64,'));assert(report.diagnostics.requests.some(r=>r.status===500));assert(report.markdown.includes('销售额加载失败'));assert(report.markdown.includes('## 目标区域 2'));assert(report.screenshot.annotations.some(m=>m.type==='number'&&m.number===2));
    fs.writeFileSync(path.join(__dirname,'evidence-captured.png'),Buffer.from(report.screenshot.pngDataUrl.split(',')[1],'base64'));
    await page.locator('.cs-detail').evaluate(el=>el.scrollTop=500);await page.screenshot({path:path.join(__dirname,'evidence-ui.png')});
    console.log('Real extension browser checks passed: debugger errors, HTTP 500 and timing, redaction, screenshot, annotations, complete JSON download. Test-only localhost grant replaces toolbar injection gesture.');
  } finally {if(context)await context.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
