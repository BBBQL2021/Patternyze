/* 网页组件采样器 —— 悬浮卡片版
 * 职责：点击图标/快捷键 → 注入 content.js（显示品牌卡，点击选择控件开始）；
 *       Figit 转换器（9.6MB）按需注入；导航离开时清理。
 * 采集、渲染、复制全部在 content script 内完成（网页内悬浮 UI，无 side panel）。 */

/* 调试日志：输出到 SW console（chrome://extensions → 检查视图可见） */
importScripts('diagnostics-worker.js');

function dbgLog(...args) {
  const msg = args.map(String).join(" ");
  console.log("[Patternyze]", msg);
}

function isInspectable(url = "") {
  return /^https?:\/\//.test(url) || /^file:\/\/\//.test(url);
}

/* 注入 content.js 到目标标签页（幂等：脚本检测到已存在实例时直接 start） */
async function activate(tabId) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    dbgLog("content.js injected, tab", tabId);
  } catch (error) {
    console.warn("Patternyze: executeScript failed", error);
  }
}

async function activateActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const tab = tabs?.[0];
  if (tab?.id && isInspectable(tab.url)) await activate(tab.id);
}

/* 点图标 = 在网页上激活采样器（悬浮卡片 + 选择模式） */
chrome.action.onClicked.addListener(() => {
  activateActiveTab();
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "start-selection") return;
  activateActiveTab();
});

/* 目标标签页内导航离开：尽力停止选择模式，防止残留选中 UI */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  chrome.tabs.sendMessage(tabId, { type: "STOP_SELECTION" }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Figma 复制链路：content 请求注入 Figit 转换器（体积大，按需加载）
  if (message.type === "ENSURE_FIGIT") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "未找到页面上下文" });
      return;
    }
    chrome.scripting.executeScript({ target: { tabId }, func: () => typeof window.__figitConvert === 'function' })
      .then(results => results[0]?.result ? null : chrome.scripting.executeScript({ target: { tabId }, files: ['figit.js'] }))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error && error.message || error) }));
    return true; // 异步响应
  }
});
