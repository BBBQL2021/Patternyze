// Explicit, bounded diagnostics sessions for the requesting tab only.
const diagnosticSessions = new Map();
const diagnosticLimit = 100;
function cleanDiagnosticUrl(value) {
  try { const u = new URL(value); if (!/^https?:$/.test(u.protocol)) return '[非 HTTP 地址]'; u.username=''; u.password=''; u.search=''; u.hash=''; return u.href; } catch { return ''; }
}
function cleanDiagnosticText(value) {
  return String(value || '').slice(0, 4000)
    .replace(/https?:\/\/[^\s"'<>]+/g, cleanDiagnosticUrl)
    .replace(/\bBearer\s+\S+/gi, 'Bearer [已隐藏]')
    .replace(/((?:token|password|secret|authorization|cookie|session)\s*[=:]\s*)[^\s,;]+/gi, '$1[已隐藏]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[邮箱已隐藏]')
    .slice(0, 1200);
}
function diagnosticSnapshot(session) {
  if (!session) return {recording:false, errors:[], requests:[], note:'尚未开始记录'};
  return {recording:session.recording, startedAt:session.startedAt, stoppedAt:session.stoppedAt,
    errors:session.errors, requests:[...session.requests.values()].map(({start,...r})=>r),
    dropped:session.dropped, note:session.note};
}
async function stopDiagnostics(tabId, note='已停止记录') {
  const session=diagnosticSessions.get(tabId);
  if (session?.recording) {
    session.recording=false; session.stoppedAt=new Date().toISOString(); session.note=note;
    clearTimeout(session.timer);
    await chrome.debugger.detach({tabId}).catch(()=>{});
  }
  return diagnosticSnapshot(session);
}
async function diagnosticCommand(message, sender) {
  const tabId=sender.tab?.id;
  if (tabId == null || sender.frameId !== 0) throw Error('仅支持当前网页主框架');
  if (message.type==='DIAGNOSTICS_GET') return diagnosticSnapshot(diagnosticSessions.get(tabId));
  if (message.type==='DIAGNOSTICS_STOP') return stopDiagnostics(tabId);
  if (message.type==='DIAGNOSTICS_CLEAR') { await stopDiagnostics(tabId); diagnosticSessions.delete(tabId); return diagnosticSnapshot(); }
  if (message.type==='CAPTURE_FEEDBACK') {
    const v=message.viewport;
    if(!v||!['x','y','width','height'].every(k=>Number.isFinite(v[k]))||v.width<=0||v.height<=0||v.width*v.height>32000000||v.x<0||v.y<0)throw Error('截图区域无效');
    const before=(await chrome.tabs.query({active:true,windowId:sender.tab.windowId}))[0];
    if(before?.id!==tabId) throw Error('请切回需要截图的标签页');
    // Use the target's viewport so browser zoom/device emulation cannot shift annotations.
    const temporary=!diagnosticSessions.get(tabId)?.recording;
    if(temporary)await chrome.debugger.attach({tabId},'1.3');
    let capture;
    try { capture=await chrome.debugger.sendCommand({tabId},'Page.captureScreenshot',{format:'png',captureBeyondViewport:true,fromSurface:true,clip:{...v,scale:Math.min(1,2400/v.width,2400/v.height)}}); }
    finally { if(temporary)await chrome.debugger.detach({tabId}).catch(()=>{}); }
    const dataUrl=`data:image/png;base64,${capture.data}`;
    const after=(await chrome.tabs.query({active:true,windowId:sender.tab.windowId}))[0];
    if(after?.id!==tabId || after.url!==before.url) throw Error('截图期间页面发生切换，请重试');
    return {dataUrl};
  }
  const existing=diagnosticSessions.get(tabId);
  if(existing?.recording) return diagnosticSnapshot(existing);
  // Do not detach someone else's debugger if attach fails.
  await chrome.debugger.attach({tabId},'1.3');
  const session={recording:true,origin:new URL(sender.tab.url).origin,startedAt:new Date().toISOString(),errors:[],requests:new Map(),dropped:0,note:'仅记录开启后的主页面错误与网络请求；不含独立跨域框架或 Worker 全量记录。最多 5 分钟、各 100 条'};
  diagnosticSessions.set(tabId,session);
  try {
    await chrome.debugger.sendCommand({tabId},'Runtime.enable');
    await chrome.debugger.sendCommand({tabId},'Network.enable',{maxTotalBufferSize:0,maxResourceBufferSize:0});
    session.timer=setTimeout(()=>stopDiagnostics(tabId,'已达到 5 分钟上限，自动停止'),300000);
  } catch(error) { await stopDiagnostics(tabId,'启动失败'); throw error; }
  return diagnosticSnapshot(session);
}
chrome.debugger.onEvent.addListener((source,method,p)=>{
  const s=diagnosticSessions.get(source.tabId); if(!s?.recording) return;
  if(method==='Runtime.consoleAPICalled' && ['error','warning','assert'].includes(p.type)) {
    if(p.timestamp && p.timestamp < Date.parse(s.startedAt)) return;
    const message=(p.args||[]).map(a=>a.type==='string'?a.value:a.subtype==='error'?a.description:'[结构化值未采集]').join(' ');
    if(s.errors.length<diagnosticLimit)s.errors.push({time:new Date().toISOString(),type:p.type,message:cleanDiagnosticText(message),stack:cleanDiagnosticText((p.stackTrace?.callFrames||[]).slice(0,5).map(f=>`${f.functionName} ${f.url}:${f.lineNumber+1}:${f.columnNumber+1}`).join('\n'))}); else s.dropped++;
  }
  if(method==='Runtime.exceptionThrown') {
    if(p.timestamp && p.timestamp < Date.parse(s.startedAt)) return;
    const e=p.exceptionDetails||{};
    if(s.errors.length<diagnosticLimit)s.errors.push({time:new Date().toISOString(),type:'exception',message:cleanDiagnosticText(e.exception?.description||e.text),location:cleanDiagnosticText(`${e.url||''}:${(e.lineNumber||0)+1}`)}); else s.dropped++;
  }
  if(method==='Network.requestWillBeSent') {
    if(s.requests.size>=diagnosticLimit&&!s.requests.has(p.requestId)){s.dropped++;return;}
    s.requests.set(p.requestId,{time:new Date().toISOString(),method:p.request.method,url:cleanDiagnosticUrl(p.request.url),type:p.type,start:p.timestamp,status:null,state:'进行中'});
  }
  const r=s.requests.get(p.requestId); if(!r)return;
  if(method==='Network.responseReceived'){r.status=p.response.status;r.type=p.type;}
  if(method==='Network.loadingFinished'||method==='Network.loadingFailed'){
    r.durationMs=Math.max(0,Math.round((p.timestamp-r.start)*1000));
    r.state=method==='Network.loadingFailed'?'失败':'完成';
    if(p.errorText)r.error=cleanDiagnosticText(p.errorText);
  }
});
chrome.debugger.onDetach.addListener(source=>{
  const s=diagnosticSessions.get(source.tabId);if(s?.recording){s.recording=false;s.stoppedAt=new Date().toISOString();s.note='浏览器已中断记录';clearTimeout(s.timer);}
});
chrome.tabs.onRemoved.addListener(tabId=>{const s=diagnosticSessions.get(tabId);clearTimeout(s?.timer);diagnosticSessions.delete(tabId);});
chrome.tabs.onUpdated.addListener((tabId,change)=>{
  const s=diagnosticSessions.get(tabId);
  if(s?.recording&&change.url){try {if(new URL(change.url).origin!==s.origin)stopDiagnostics(tabId,'页面已离开原站点，自动停止');}catch{stopDiagnostics(tabId,'页面地址不可用，自动停止');}}
});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!['DIAGNOSTICS_START','DIAGNOSTICS_STOP','DIAGNOSTICS_GET','DIAGNOSTICS_CLEAR','CAPTURE_FEEDBACK'].includes(message?.type))return;
  diagnosticCommand(message,sender).then(data=>reply({ok:true,...data})).catch(error=>reply({ok:false,error:String(error.message||error)}));
  return true;
});
