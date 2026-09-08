(() => {
  if (window.__componentSampler) {
    window.__componentSampler.start();
    return;
  }

  /* ═══════════════ 采集管线常量（原逻辑保留） ═══════════════ */
  const MAX_NODES = 300;
  const MAX_DEPTH = 10;
  const TRANSPARENT_COLOR_VALUES = ["rgba(0, 0, 0, 0)", "transparent"];
  const SENSITIVE_ATTR = /(?:token|auth|session|cookie|csrf|secret|password|email|phone|address|user-id|account)/i;
  const TRACKING_ATTR = /(?:analytics|tracking|tracker|pixel|segment|amplitude|mixpanel|hotjar|gtm|ga-)/i;
  const SAFE_ATTRS = new Set([
    "id", "class", "role", "type", "name", "title", "placeholder", "disabled", "checked",
    "selected", "readonly", "required", "multiple", "tabindex", "aria-label", "aria-labelledby",
    "aria-describedby", "aria-expanded", "aria-selected", "aria-checked", "aria-disabled", "aria-invalid",
    "aria-haspopup", "aria-controls", "data-state", "data-disabled", "data-selected", "data-orientation"
  ]);
  const STYLE_PROPS = [
    "display", "position", "top", "right", "bottom", "left", "box-sizing", "width", "height", "min-width", "min-height", "max-width", "max-height",
    "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "flex-direction", "flex-wrap", "align-items", "align-content", "justify-content", "gap", "row-gap", "column-gap",
    "grid-template-columns", "grid-template-rows", "grid-auto-flow", "place-items", "overflow", "overflow-x", "overflow-y",
    "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "text-transform",
    "color", "background-color", "background-image", "background-size", "background-position", "opacity",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-style", "border-color",
    "border-radius", "box-shadow", "outline", "outline-offset", "cursor", "transform", "transform-origin",
    "transition", "animation", "object-fit", "aspect-ratio", "z-index"
  ];

  /* ═══════════════ 状态 ═══════════════ */
  let active = false;
  let hovered = null;
  let selected = null;
  let payload = null;
  let scopeStack = [];          // 采样范围历史栈：selected 始终 = 栈顶（↑ 扩大 / ↓ 缩小）
  let mode = "interactive";     // 采集深度：仅外观 / 外观+交互组件（Figma 输出时禁用「外观+交互组件」）
  let format = "markdown";      // 输出格式（默认 AI markdown）
  let toastTimer = null;
  let host = null;
  let ui = null;                // shadow root 内元素引用
  let copyJob = null;
  let lastCopyFailed = false;
  let conversionWarnings = [];

  /* ═══════════════ 悬浮 UI（设计稿 Patternyze，全部尺寸 ÷2） ═══════════════ */
  const UI_CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
.cs-root {
  position: fixed; inset: 0; z-index: 2147483646; pointer-events: none;
  font-family: Inter, "PingFang SC", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #fffdf8;
}
.cs-overlay {
  position: fixed; pointer-events: none;
  border: 1.5px dashed rgba(201, 105, 76, 0.6); border-radius: 15px;
  background: rgba(201, 105, 76, 0.1);
  transition: left 45ms linear, top 45ms linear, width 45ms linear, height 45ms linear;
}
.cs-overlay.selected { border-style: solid; border-color: #c9694c; background: rgba(201, 105, 76, 0.16); }
.cs-tip {
  position: fixed; pointer-events: none; white-space: nowrap;
  padding: 7.5px 11px; border-radius: 7.5px;
  background: rgba(38, 32, 25, 0.9); color: #fffdf8;
  font-size: 15px; font-weight: 600; line-height: 1.4;
}
.cs-toast {
  position: fixed; left: 50%; top: 15px; transform: translateX(-50%); pointer-events: none;
  padding: 9px 13px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 9px;
  background: rgba(38, 32, 25, 0.94); color: #fffdf8;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25); backdrop-filter: blur(12px);
  font-size: 13px; line-height: 1.4; text-align: center;
}
/* 右上品牌卡：设计稿 Save Success Container 457×84，×0.75 后再 ×0.75 = 设计稿 ×0.5625（用户拍板 2026-08-29） */
.cs-brand {
  position: fixed; top: 11px; right: 11px; pointer-events: auto;
  display: flex; align-items: center; gap: 5.625px; padding: 11.25px;
  border: 0.5625px solid rgba(255, 255, 255, 0.1); border-radius: 11.25px;
  background: rgba(38, 32, 25, 0.9);
  box-shadow: 0 2.25px 11.25px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.cs-brand-thumb {
  width: 17.25px; height: 17.25px; flex: none; border-radius: 2.25px;
  /* 无边框：设计稿 382:494 logo 无描边，浅灰 border 在深咖卡底上会显成白边 */
  background-size: cover; background-position: center;
}
.cs-brand-name { font-size: 16.875px; font-weight: 600; white-space: nowrap; }
.cs-brand .cs-btn {
  height: 23.625px; padding: 0 11.25px; border-radius: 999px; cursor: pointer;
  font-size: 11.25px; font-weight: 500; white-space: nowrap; font-family: inherit;
}
.cs-btn-select { background: rgba(255, 253, 248, 0.1); border: 1.125px solid rgba(255, 253, 248, 0.3); color: #fffdf8; }
.cs-btn-select:hover { background: rgba(255, 253, 248, 0.18); }
.cs-btn-exit { background: rgba(201, 105, 76, 0.1); border: 1.125px solid rgba(201, 105, 76, 0.6); color: #c9694c; }
.cs-btn-exit:hover { background: rgba(201, 105, 76, 0.2); }
/* 右下详情卡：设计稿 Rectangle 15 457×578，全量 ×0.75（宽 343，紧邻品牌卡下方间距 10px） */
.cs-detail {
  position: fixed; right: 11px; top: 67px; pointer-events: auto;
  width: 343px; max-height: calc(100vh - 77px); overflow-y: auto; padding: 15px;
  border: 0.75px solid rgba(255, 255, 255, 0.1); border-radius: 15px;
  background: rgba(38, 32, 25, 0.9);
  box-shadow: 0 3px 15px rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.cs-detail::-webkit-scrollbar { width: 4px; }
.cs-detail::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 2px; }
.cs-detail-title { font-size: 13.5px; font-weight: 600; color: #fffdf8; letter-spacing: -0.33px; }
.cs-section { margin-top: 15px; }
.cs-section:first-of-type { margin-top: 0; }
.cs-head { display: flex; align-items: center; gap: 5px; margin-bottom: 7.5px; }
.cs-head i { width: 3px; height: 10.5px; flex: none; border-radius: 1.5px; background: #c9694c; }
.cs-head { font-size: 9.75px; font-weight: 700; line-height: 1; color: #fffdf8; }
.cs-desc { font-size: 10.5px; line-height: 1.5; color: #a3a3a3; }
/* 采集深度行：设计稿 416×62，全量 ×0.75 */
.cs-modes { display: grid; gap: 7.5px; }
.cs-mode {
  display: flex; align-items: center; gap: 7.5px;
  min-height: 46.5px; padding: 7.5px 15px; border-radius: 7.5px;
  background: rgba(255, 253, 248, 0.1); cursor: pointer;
}
.cs-mode:hover { background: rgba(255, 253, 248, 0.16); }
.cs-mode:has(input:disabled) { opacity: 0.45; cursor: not-allowed; }
.cs-mode:has(input:disabled):hover { background: rgba(255, 253, 248, 0.1); }
.cs-mode:has(input:checked) { background: rgba(201, 105, 76, 0.2); }
.cs-mode input { position: absolute; opacity: 0; pointer-events: none; }
.cs-radio {
  width: 15px; height: 15px; flex: none; position: relative;
  border: 1.5px solid rgba(255, 253, 248, 0.3); border-radius: 50%;
}
.cs-radio::after {
  content: ""; position: absolute; inset: 0; margin: auto;
  width: 7.5px; height: 7.5px; border-radius: 50%; background: #c9694c;
  transform: scale(0); transition: transform 120ms ease;
}
.cs-mode:has(input:checked) .cs-radio { border-color: rgba(201, 105, 76, 0.6); background: rgba(201, 105, 76, 0.08); }
.cs-mode:has(input:checked) .cs-radio::after { transform: scale(1); }
.cs-mode-text { display: grid; gap: 2px; min-width: 0; }
/* 设计稿两行文字为 mixed 字号（bridge 无 run 级数据），按 42px 行高反推主行 15px/副行 12px 再 ×0.75 */
.cs-mode-text b { font-size: 11.25px; font-weight: 500; line-height: 15.75px; color: #fffdf8; }
.cs-mode-text small { font-size: 9px; line-height: 15.75px; color: #a3a3a3; }
.cs-mode em { margin-left: auto; font-size: 10.5px; font-style: normal; font-weight: 500; color: #fffdf8; }
/* 输出格式 chips：设计稿 416×50，全量 ×0.75（单行排列，宽度按内容适配） */
.cs-chips {
  display: flex; flex-wrap: nowrap; gap: 7.5px; padding: 7.5px; /* 输出格式不折行，宽度按内容适配 */
  border-radius: 37.5px; background: rgba(255, 253, 248, 0.1);
  width: fit-content;
}
.cs-chip {
  height: 22.5px; padding: 0 7.5px; border: 0; border-radius: 999px; cursor: pointer;
  background: transparent; color: #fffdf8;
  font-size: 10.5px; font-weight: 500; font-family: inherit; white-space: nowrap;
}
.cs-chip:hover { background: rgba(255, 253, 248, 0.14); }
.cs-chip.active { background: #c9694c; color: #fff; }
.cs-copy {
  width: 100%; height: 36px; margin-top: 19px; border: 0; border-radius: 999px; cursor: pointer;
  background: #c9694c; color: #fffdf8;
  font-size: 15px; font-weight: 500; font-family: inherit;
}
.cs-copy:hover { background: #d97a5c; }
.cs-detail { width: min(380px, calc(100vw - 22px)); }
.cs-preview, .cs-quality { margin-top: 12px; padding: 10px; background: rgba(255,255,255,.06); border-radius: 8px; }
.cs-preview summary { cursor: pointer; font-size: 12px; }
.cs-preview pre { max-height: 150px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.5 ui-monospace, monospace; margin-top: 8px; }
.cs-meta, .cs-status { font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; margin-top: 8px; }
.cs-quality { font-size: 11px; line-height: 1.6; color: #efdbbd; }
.cs-quality ul { padding-left: 16px; }
.cs-tools { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.cs-tools button, .cs-cancel { color: #fffdf8; border: 1px solid #8e8070; border-radius: 6px; padding: 5px 8px; background: transparent; font: 11px inherit; cursor: pointer; }
button:disabled { opacity: .5; cursor: not-allowed; }
button:focus-visible, summary:focus-visible { outline: 2px solid #f4c29d; outline-offset: 3px; }
.cs-status[data-state="error"] { color: #ffb4a4; }
.cs-status[data-state="success"] { color: #c3e7bb; }
.cs-cancel { margin-top: 6px; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }
[hidden] { display: none !important; }
`;

  const UI_HTML = `
<div class="cs-root">
  <div class="cs-overlay" hidden></div>
  <div class="cs-tip" hidden></div>
  <div class="cs-toast" hidden></div>
  <div class="cs-brand" hidden>
    <span class="cs-brand-thumb"></span>
    <span class="cs-brand-name">Patternyze</span>
    <button class="cs-btn cs-btn-select" type="button">选择控件</button>
    <button class="cs-btn cs-btn-exit" type="button">退出</button>
  </div>
  <div class="cs-detail" hidden>
    <div class="cs-detail-title" data-ref="title">输入框｜input</div>
    <div class="cs-section">
      <div class="cs-head"><i></i>组件描述</div>
      <p class="cs-desc" data-ref="desc"></p>
    </div>
    <div class="cs-meta" data-ref="meta"></div>
    <div class="cs-tools">
      <button type="button" data-ref="expand">↑ 扩大范围</button>
      <button type="button" data-ref="shrink">↓ 缩小范围</button>
      <button type="button" data-ref="refresh">重新采样</button>
    </div>
    <details class="cs-preview">
      <summary>查看待复制内容</summary>
      <p class="cs-desc" data-ref="preview-note"></p>
      <pre data-ref="preview"></pre>
    </details>
    <div class="cs-quality" aria-label="采样完整性" data-ref="quality"></div>
    <div class="cs-section">
      <div class="cs-head"><i></i>采集深度</div>
      <div class="cs-modes">
        <label class="cs-mode"><input type="radio" name="cs-mode" value="appearance"><span class="cs-radio"></span><span class="cs-mode-text"><b>仅外观</b><small>采集当前外观与可读取内容</small></span></label>
        <label class="cs-mode"><input type="radio" name="cs-mode" value="interactive" checked><span class="cs-radio"></span><span class="cs-mode-text"><b>外观+交互组件</b><small>外观 + 可识别的通用交互</small></span><em>推荐</em></label>
      </div>
    </div>
    <div class="cs-section">
      <div class="cs-head"><i></i>输出格式</div>
      <div class="cs-chips">
        <button class="cs-chip" data-f="figma" type="button">Figma</button>
        <button class="cs-chip active" data-f="markdown" type="button">AI markdown</button>
      </div>
    </div>
    <button class="cs-copy" data-ref="copy" type="button">复制给 AI</button>
    <p class="cs-status" role="status" aria-live="polite" data-ref="status"></p>
    <button class="cs-cancel" data-ref="cancel" type="button" hidden>取消复制</button>
  </div>
</div>
`;

  function ensureUi() {
    if (host) return;
    host = document.createElement("div");
    host.id = "cs-host";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = UI_CSS;
    shadow.appendChild(style);
    const wrap = document.createElement("div");
    wrap.innerHTML = UI_HTML;
    shadow.appendChild(wrap.firstElementChild);
    document.documentElement.appendChild(host);
    ui = {
      root: shadow.querySelector(".cs-root"),
      overlay: shadow.querySelector(".cs-overlay"),
      tip: shadow.querySelector(".cs-tip"),
      toast: shadow.querySelector(".cs-toast"),
      brand: shadow.querySelector(".cs-brand"),
      thumb: shadow.querySelector(".cs-brand-thumb"),
      select: shadow.querySelector(".cs-btn-select"),
      detail: shadow.querySelector(".cs-detail"),
      title: shadow.querySelector('[data-ref="title"]'),
      desc: shadow.querySelector('[data-ref="desc"]'),
      copy: shadow.querySelector('[data-ref="copy"]'),
      chips: Array.from(shadow.querySelectorAll(".cs-chip")),
      modes: Array.from(shadow.querySelectorAll(".cs-mode input"))
    };
    for (const key of ['meta','preview','preview-note','quality','status','cancel','expand','shrink','refresh']) ui[key] = shadow.querySelector(`[data-ref="${key}"]`);
    ui.cancel.addEventListener('click', cancelCopy);
    ui.expand.addEventListener('click', () => adjustScope(1));
    ui.shrink.addEventListener('click', () => adjustScope(-1));
    ui.refresh.addEventListener('click', () => {
      if (selected?.isConnected && !copyJob) { setSelection(selected); updateOverlay(selected, selected); }
      else if (!selected?.isConnected) showToast('原组件已被页面替换，请重新选择');
    });
    // 事件绑定（shadow 内部）
    shadow.querySelector(".cs-btn-select").addEventListener("click", beginSelect);
    shadow.querySelector(".cs-btn-exit").addEventListener("click", () => { stop(); });
    ui.copy.addEventListener("click", copyOutput);
    ui.chips.forEach((chip) => chip.addEventListener("click", () => selectFormat(chip.dataset.f)));
    ui.modes.forEach((input) => input.addEventListener("change", () => {
      // 选择「外观+交互组件」时若输出为 Figma：该选项已被禁用（selectFormat 联动），此处兜底拒绝
      if (input.value === "interactive" && format === "figma") {
        input.checked = false;
        ui.modes.forEach((i) => { i.checked = i.value === mode; });
        showToast("Figma 输出仅支持「仅外观」", 3400);
        return;
      }
      mode = input.value;
      renderPreview();
    }));
    // 用户提供的完整图案，按比例缩放为正方形品牌图标。
    if (runtimeAlive()) {
      ui.thumb.style.backgroundImage = `url("${chrome.runtime.getURL("icons/patternyze-logo.png")}")`;
    } else {
      // 测试环境（stub chrome）fallback
      ui.thumb.style.backgroundImage = 'url("icons/patternyze-logo.png")';
    }
  }

  function showToast(text, duration = 2200) {
    window.clearTimeout(toastTimer);
    ui.toast.textContent = text;
    ui.toast.hidden = false;
    toastTimer = window.setTimeout(() => { ui.toast.hidden = true; }, duration);
  }

  /* ═══════════════ 选择模式 ═══════════════ */
  /* 状态机：注入后仅显示品牌卡（active=false）；点「选择控件」→ beginSelect() 进入选择模式；
   * 点击选中 → active=false，选中框钉在控件上（滚动跟随），按钮变「重新选择」；
   * 点「重新选择」→ 再次进入选择模式换选。 */
  function start() {
    ensureUi();
    if (selected?.isConnected && payload && !ui.brand.hidden) {
      active = false;
      renderPreview();
      updateOverlay(selected, selected);
      return;
    }
    active = false;
    hovered = null;
    selected = null;
    ui.overlay.hidden = true;
    ui.tip.hidden = true;
    ui.brand.hidden = false;
    ui.detail.hidden = true;
    ui.overlay.dataset.selected = "false";
    renderSelectLabel();
    showToast("点击「选择控件」开始选择组件", 2600);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
  }

  /* 进入（重新进入）选择模式 */
  function beginSelect() {
    if (copyJob) return;
    payload = null;
    conversionWarnings = [];
    lastCopyFailed = false;
    active = true;
    hovered = null;
    selected = null;
    scopeStack = [];
    ui.overlay.dataset.selected = "false";
    ui.overlay.hidden = true;
    ui.tip.hidden = true;
    ui.detail.hidden = true; // 重新选择时收起详情卡
    showToast("移动鼠标选择组件 · 高亮框即采样范围 · 点击确认 · Esc 退出");
  }

  function stop() {
    cancelCopy();
    active = false;
    hovered = null;
    selected = null;
    payload = null;
    scopeStack = [];
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
    if (host) {
      ui.overlay.hidden = true;
      ui.tip.hidden = true;
      ui.toast.hidden = true;
      ui.brand.hidden = true;
      ui.detail.hidden = true;
    }
  }

  /* ═══════════════ 扩展生命周期 ═══════════════ */
  /* 扩展在 chrome://extensions 重新加载后，已打开页面上的旧 content script 实例
   * chrome.runtime 全部失效（runtime.id 变 undefined），任何调用都会同步抛
   * `Extension context invalidated`。所有 chrome.runtime 调用前先检查，失效即自清理：
   * 移除监听 + 卸载 UI + 删除注入标志，让下次点击图标重新注入完整实例。 */
  function runtimeAlive() {
    return typeof chrome !== "undefined" && !!chrome.runtime?.id;
  }

  function handleContextInvalidated() {
    try {
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onScroll);
    } catch { /* 已移除则忽略 */ }
    try { if (host) host.remove(); } catch { /* detached */ }
    try { delete window.__componentSampler; } catch { /* 不可删除则忽略 */ }
    const t = document.createElement("div");
    t.style.cssText =
      "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
      "background:#262019;color:#fffdf8;padding:8px 14px;border-radius:8px;" +
      "font:12px system-ui;box-shadow:0 4px 16px rgba(0,0,0,.35);pointer-events:none";
    t.textContent = "插件已更新：页面上的旧实例已清理，请重新点击插件图标或刷新页面";
    (document.body || document.documentElement).appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  function onScroll() {
    const el = selected || (active ? hovered : null);
    if (el) updateOverlay(selected ? selected : findVisualHost(el), el);
  }

  function onPointerMove(event) {
    if (!active || isOurUi(event.target)) return;
    hovered = event.target instanceof Element ? event.target : event.target.parentElement;
    if (!hovered) return;
    const host = findVisualHost(hovered);
    updateOverlay(host, host);
  }

  function onClick(event) {
    if (!active || isOurUi(event.target) || !hovered) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // 选中「视觉宿主」（用户看到的高亮框），所有输出格式（figma/json/html/markdown）统一
    // 基于同一元素——所见即所得；后续可用 ↑/↓ 逐级调整采样范围
    selected = findVisualHost(hovered);
    scopeStack = [selected];
    active = false;
    // 选中：虚线框钉在控件上（滚动跟随），hover 不再唤起新高亮
    ui.overlay.dataset.selected = "true";
    updateOverlay(selected, selected);
    renderSelectLabel();
    showToast("已选择组件 · ↑ 扩大范围 · ↓ 缩小范围 · 重新选择可换选 · Esc 退出");
    setSelection(selected);
  }

  function renderSelectLabel() {
    ui.select.textContent = selected ? "重新选择" : "选择控件";
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      stop();
      return;
    }
    if (isOurUi(event.target) || event.target?.closest?.("input,textarea,select,[contenteditable]")) return;
    if (copyJob) return;
    // 选中后：↑ 扩大到父级容器（把明细、兄弟区块一起纳入采样范围），↓ 缩回上一级
    if (!selected || !selected.isConnected) return;
    if (event.key === "ArrowUp") {
      const parent = selected.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement || scopeStack.length >= 8) return;
      event.preventDefault();
      scopeStack.push(parent);
      refreshSelection("已扩大到父级容器 · ↑ 继续扩大 · ↓ 缩小 · Esc 退出");
    } else if (event.key === "ArrowDown") {
      if (scopeStack.length <= 1) return;
      event.preventDefault();
      scopeStack.pop();
      refreshSelection("已缩回上一级 · ↑ 扩大 · ↓ 继续缩小 · Esc 退出");
    }
  }

  /* ↑/↓ 调整采样范围后：重新钉框 + 重新采集 + 刷新详情卡（所有输出格式随之更新） */
  function refreshSelection(message) {
    selected = scopeStack[scopeStack.length - 1];
    ui.overlay.dataset.selected = "true";
    updateOverlay(selected, selected);
    setSelection(selected);
    showToast(message);
  }

  function isOurUi(target) {
    if (!host || !(target instanceof Node)) return false;
    if (host.contains(target)) return true;
    return target.getRootNode() === host.shadowRoot;
  }

  /* 视觉宿主上溯：选中元素自身无视觉样式（透明 input/textarea 等）时，
   * 沿祖先链找最近真正承载边框/阴影/背景/圆角/毛玻璃的容器——
   * hover 框住宿主（用户「看到的」元素），所有输出格式（figma/json/html/markdown）
   * 统一基于该宿主，所见即所得。不做 4 倍尺寸限制（避免框住过小元素），
   * 仅上溯不超过 8 跳且不越过 body/html（防止框住整页）。 */
  function hasVisualStyle(el) {
    // iframe 本身视为透明宿主：hover/点击 iframe 时红框上溯到外层卡片容器，而不是框住 iframe
    if (el instanceof HTMLIFrameElement) return false;
    const cs = getComputedStyle(el);
    const border = ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"]
      .some((p) => parseFloat(cs[p]) > 0
        && cs[p.replace("Width", "Style")] !== "none"
        && !TRANSPARENT_COLOR_VALUES.includes(cs[p.replace("Width", "Color")]));
    return border
      || cs.boxShadow !== "none"
      || cs.backgroundImage !== "none"
      || !TRANSPARENT_COLOR_VALUES.includes(cs.backgroundColor)
      || cs.backdropFilter !== "none";
  }

  function findVisualHost(el) {
    if (hasVisualStyle(el)) return el;
    // 自身即 iframe 卡片区块（如 themes-wrapper）：整卡语义，不再上溯
    if (el.querySelector("iframe")) return el;
    let node = el.parentElement;
    for (let hops = 0; node && hops < 8 && node !== document.body && node !== document.documentElement; hops++, node = node.parentElement) {
      if (hasVisualStyle(node)) return node;
      // iframe 卡片区块：祖先包含 iframe 时视为整卡，不再上溯到页面级容器
      // （hover 卡片操作栏/标题栏时红框框住整个示例区块）
      if (node.querySelector("iframe")) return node;
    }
    return el;
  }

  function updateOverlay(element, labelElement) {
    const rect = element.getBoundingClientRect();
    // 控件滚出视口 → 隐藏选中框
    const inViewport = rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
    if (!inViewport) { ui.overlay.hidden = true; ui.tip.hidden = true; return; }
    Object.assign(ui.overlay.style, {
      left: `${Math.max(0, rect.left)}px`, top: `${Math.max(0, rect.top)}px`,
      width: `${Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left))}px`, height: `${Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top))}px`
    });
    ui.overlay.hidden = rect.width === 0 && rect.height === 0;
    // 左上角组件名标签：悬停/选中时显示「中文｜英文」（如 输入框｜input、导航｜nav）
    ui.tip.hidden = false;
    const tipType = inferType(labelElement);
    ui.tip.textContent = `${friendlyType(tipType)}｜${tipType}`;
    ui.tip.style.left = `${Math.min(Math.max(8, rect.left + 14), Math.max(8, innerWidth - 200))}px`;
    ui.tip.style.top = `${Math.max(8, rect.top + 14)}px`;
  }

  /* ═══════════════ 采集管线（原逻辑保留） ═══════════════ */
  function analyze(element) {
    const rect = element.getBoundingClientRect();
    const sanitized = sanitizeTree(element);
    const stateRules = collectStateRules(element);
    const detectedStates = detectStates(element, stateRules);
    const interactions = inferInteractions(element);
    const motion = collectMotion(element);
    const removed = Array.from(sanitized.removed);
    return {
      page: { title: document.title, origin: location.origin, stack: detectStack() },
      component: {
        name: inferName(element), type: inferType(element), tag: element.tagName.toLowerCase(),
        role: element.getAttribute("role") || implicitRole(element),
        dimensions: { width: Math.round(rect.width), height: Math.round(rect.height) },
        nodeCount: sanitized.nodeCount,
        selector: createSelector(element),
        text: safeText(element)
      },
      html: sanitized.html,
      css: collectStyles(sanitized.orderedSources),
      truncated: sanitized.truncatedNames,
      tokens: collectTokens(element),
      states: detectedStates,
      stateCss: stateRules,
      interactions,
      motion,
      accessibility: collectAccessibility(element),
      removed: removed.length ? removed : ["未检测到需要清理的业务或敏感信息"],
      capturedAt: new Date().toISOString()
    };
  }

  function sanitizeTree(root) {
    const removed = new Set(['原页面事件处理器（不读取）']);
    const orderedSources = [];
    const truncatedNames = [];
    let nodeCount = 0;
    function cut() {
      if (!truncatedNames.length) truncatedNames.push('内容已达到采样节点或深度上限');
      return document.createComment('内容已按采样上限截断');
    }
    function copy(source, depth) {
      if (source.nodeType === 3) return document.createTextNode(source.textContent);
      if (source.nodeType !== 1) return null;
      if (nodeCount >= MAX_NODES || depth > MAX_DEPTH) return cut();
      if (['SCRIPT','STYLE','LINK','OBJECT','EMBED'].includes(source.tagName)) {
        removed.add('脚本或嵌入内容');
        return document.createComment('脚本或嵌入内容已移除');
      }
      // Keep a stable wrapper so root iframe captures and their CSS remain aligned.
      const target = source.tagName === 'IFRAME' ? document.createElement('div') : source.cloneNode(false);
      cleanElement(source, target, removed);
      target.setAttribute('data-patternyze-node', String(nodeCount++));
      orderedSources.push(source);
      if (source === root) target.classList.add('sampled-component');
      if (source.tagName === 'TEXTAREA') return target;
      let children = source.childNodes;
      if (source.tagName === 'IFRAME') {
        const body = source.contentDocument?.body;
        if (!body) {
          removed.add('跨域 iframe 或嵌入内容');
          target.append(document.createComment('跨域 iframe 已移除，请单独打开该地址采样'));
          return target;
        }
        children = body.childNodes;
        removed.add('同源 iframe 内容已并入采样');
      }
      for (const child of children) {
        if (nodeCount >= MAX_NODES || depth >= MAX_DEPTH) { target.append(cut()); break; }
        const copied = copy(child, depth + 1);
        if (copied) target.append(copied);
      }
      return target;
    }
    const clone = copy(root, 0);
    return {html: formatHtml(clone.outerHTML || '<!-- 内容已移除 -->'), removed, nodeCount, orderedSources, truncatedNames};
  }

  function cleanElement(source, target, removed, queue, depth) {
    const isSvg = target.namespaceURI === "http://www.w3.org/2000/svg";
    for (const attr of Array.from(target.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) { target.removeAttribute(name); removed.add("内联事件处理器"); continue; }
      if (["href", "xlink:href", "ping", "action", "formaction", "target"].includes(name)) {
        target.removeAttribute(name); removed.add("原网站跳转地址或表单目标"); continue;
      }
      if (SENSITIVE_ATTR.test(name) || SENSITIVE_ATTR.test(attr.value)) {
        target.removeAttribute(name); removed.add("潜在敏感属性或身份信息"); continue;
      }
      if (TRACKING_ATTR.test(name) || TRACKING_ATTR.test(attr.value)) {
        target.removeAttribute(name); removed.add("分析、广告或埋点标识"); continue;
      }
      // SVG 图形元素：几何/描边属性（cx cy r d points stroke-* 等）是绘制必需，除上面已处理的安全项外一律保留；
      // 非 SVG 元素仍走白名单
      if (!isSvg && !SAFE_ATTRS.has(name) && !name.startsWith("aria-") && !["src", "alt", "width", "height", "viewbox", "d", "fill", "stroke", "xmlns"].includes(name)) {
        target.removeAttribute(name);
      }
    }
    if (['INPUT', 'TEXTAREA'].includes(target.tagName)) {
      if (source.type === "password" || source.value) removed.add("用户输入值");
      target.removeAttribute("value");
      target.value = "";
      if (target.tagName === "TEXTAREA") target.textContent = "";
    }
    if (target.tagName === "A") {
      target.setAttribute("role", "button");
      target.setAttribute("tabindex", "0");
      removed.add("链接目标已移除，并标记为通用按钮语义");
    }
  }

  function collectStyles(sources) {
    const entries = [];
    const root = sources[0];
    sources.forEach((node, index) => {
      const computed = getComputedStyle(node);
      const selector = `[data-patternyze-node="${index}"]`;
      const rules = [];
      for (const prop of STYLE_PROPS) {
        const value = computed.getPropertyValue(prop).trim();
        if (value && !isDefaultNoise(prop, value)) rules.push(`  ${prop}: ${value};`);
      }
      if (rules.length) entries.push(`${selector} {\n${rules.join("\n")}\n}`);
    });
    return entries.join("\n\n");
  }

  function collectStateRules(root) {
    const results = { hover: [], active: [], focus: [], disabled: [], selected: [], invalid: [] };
    const stateMap = { hover: /:hover\b/, active: /:active\b/, focus: /:focus(?:-visible)?\b/, disabled: /:disabled\b|\[aria-disabled/, selected: /:checked\b|\[aria-selected|\[data-state=["']?open/, invalid: /:invalid\b|\[aria-invalid/ };
    // 覆盖 root 子树内的同源 iframe 内容文档：状态规则按「元素所属文档」的样式表匹配
    const docs = [root.ownerDocument];
    Array.from(root.querySelectorAll("iframe")).forEach((f) => {
      if (f.contentDocument) docs.push(f.contentDocument);
    });
    for (const doc of docs) {
      for (const sheet of Array.from(doc.styleSheets)) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        walkCssRules(rules, (rule) => {
          if (rule.type !== CSSRule.STYLE_RULE) return;
          for (const [state, pattern] of Object.entries(stateMap)) {
            if (!pattern.test(rule.selectorText)) continue;
            const baseSelector = rule.selectorText.replace(/:(?:hover|active|focus-visible|focus|disabled|checked|invalid)\b/g, "").replace(/\[(?:aria-disabled|aria-selected|aria-invalid|data-state)[^\]]*\]/g, "");
            if (selectorRelates(root, baseSelector, doc)) results[state].push(rule.cssText);
          }
        });
      }
    }
    Object.keys(results).forEach((key) => { results[key] = Array.from(new Set(results[key])).slice(0, 12); });
    return results;
  }

  function walkCssRules(rules, visit) {
    if (!rules) return;
    for (const rule of Array.from(rules)) {
      visit(rule);
      if (rule.cssRules) walkCssRules(rule.cssRules, visit);
    }
  }

  /* ═══════════════ 动效采样（v2：采样时机声明 + 动效声明采集） ═══════════════
     新增于 2026-09-04（Calendly 轮播 / Function Health Lottie 两次实战后定稿）：
     - 时机信号：WAAPI 运行中动画、Lottie 播放器、疑似自动轮播结构
     - 声明采集：transition/animation 规则原文（时长/缓动/属性），Lottie 播放配置
     原则：动效只采「声明 + 当前瞬时状态」，不做行为观察窗；定时行为（轮播间隔等）
     如实标注「未能实测 → 执行方标注推测，不得编造」。 */
  function collectMotion(root) {
    const motion = { signals: [], transitions: [], animations: [], lotties: [] };
    // 1) Web Animations（WAAPI 与 CSS animation 都会出现在 getAnimations）
    let running = 0, paused = 0;
    try {
      const anims = Array.from(document.getAnimations ? document.getAnimations() : []);
      anims.forEach((a) => {
        const t = a.effect && a.effect.target;
        if (!t || !(root === t || root.contains(t))) return;
        if (a.playState === "running") running++;
        else if (a.playState === "paused") paused++;
      });
    } catch (e) { /* noop */ }
    // 2) 样式表声明：transition / animation 规则原文（root 相关选择器）
    const docs = [root.ownerDocument];
    Array.from(root.querySelectorAll("iframe")).forEach((f) => { if (f.contentDocument) docs.push(f.contentDocument); });
    const seen = new Set();
    for (const doc of docs) {
      for (const sheet of Array.from(doc.styleSheets)) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        walkCssRules(rules, (rule) => {
          if (rule.type !== CSSRule.STYLE_RULE) return;
          const text = rule.style.cssText || "";
          if (!/\btransition\b|\banimation\b/.test(text)) return;
          if (!selectorRelates(root, rule.selectorText, doc)) return;
          const dedupe = `${rule.selectorText} {${text}}`;
          if (seen.has(dedupe)) return;
          seen.add(dedupe);
          if (text.includes("animation")) motion.animations.push(rule.cssText);
          if (text.includes("transition")) motion.transitions.push(rule.cssText);
        });
      }
    }
    motion.transitions = Array.from(new Set(motion.transitions)).slice(0, 8);
    motion.animations = Array.from(new Set(motion.animations)).slice(0, 8);
    // 3) Lottie / 滚动触发播放器（远程动画文件不内联复制）
    const lottieHits = Array.from(root.querySelectorAll("*")).filter((el) => {
      const cls = typeof el.className === "string" ? el.className : "";
      const ds = JSON.stringify(el.dataset || {});
      return /lottie/i.test(cls) || /lottie/i.test(ds) || /"src"\s*:\s*"[^"]*\.json/.test(ds);
    }).slice(0, 3);
    lottieHits.forEach((el) => {
      let cfg = Object.keys(el.dataset).length ? JSON.stringify(el.dataset).slice(0, 300) : "";
      if (!cfg) {
        const script = el.nextElementSibling && el.nextElementSibling.tagName === "SCRIPT" ? el.nextElementSibling : el.querySelector("script");
        if (script) cfg = (script.textContent || "").replace(/\s+/g, " ").trim().slice(0, 260);
      }
      motion.lotties.push({ selector: relativeSelector(el, root), config: cfg || "(元素无内联播放配置)" });
    });
    // 信号汇总
    if (running || paused) {
      motion.signals.push(`组件内存在 ${running + paused} 个动画（${running} 个正在运行）——本次采样可能处于动画中间态：几何与激活状态请以「静止态」语义为准（指示点/选中态与当前可见内容未必一一对应），不要照搬中间帧数值`);
    }
    if (motion.lotties.length) {
      motion.signals.push(`组件含 Lottie/滚动触发播放器 ${motion.lotties.length} 个：播放配置见「动效声明」；动画 JSON 为远程资源，不内联复制——如需还原请本地化该文件并保留播放语义（滚动触发/循环/时长）`);
    }
    try {
      const tabs = root.querySelectorAll("[role='tab']");
      const indicators = root.querySelectorAll("[aria-selected], [class*='indicator'], [class*='dot']");
      const units = Array.from(root.children).filter((c) => { const r = c.getBoundingClientRect(); return r.width > 40 && c.children.length; });
      if ((tabs.length >= 2 || indicators.length >= 3) && units.length >= 2) {
        motion.signals.push("疑似自动轮播/步骤切换组件：自动播放间隔、循环方向、悬停暂停等定时行为无法在采样瞬间实测——执行方须按通用交互实现，凡涉及具体时长/间隔一律标注为推测，不得编造数值");
      }
    } catch (e) { /* noop */ }
    motion.signals = Array.from(new Set(motion.signals)).slice(0, 5);
    return motion;
  }

  function selectorRelates(root, selectorText, doc) {
    const d = doc || root.ownerDocument;
    return selectorText.split(",").some((selector) => {
      const clean = selector.trim();
      if (!clean) return false;
      try { const scope = d === root.ownerDocument ? root : d.body;
        return Boolean(scope && (scope.matches(clean) || Array.from(d.querySelectorAll(clean)).some(el => scope.contains(el)))); } catch { return false; }
    });
  }

  function detectStates(element, rules) {
    const has = (name) => rules[name].length > 0;
    return {
      normal: { detected: true, source: "当前计算样式" },
      hover: { detected: has("hover"), source: has("hover") ? "匹配到 :hover CSS" : "未检测到" },
      pressed: { detected: has("active"), source: has("active") ? "匹配到 :active CSS" : "未检测到" },
      focus: { detected: has("focus"), source: has("focus") ? "匹配到 focus CSS" : "未检测到" },
      disabled: { detected: has("disabled") || element.matches(":disabled,[aria-disabled='true'],[data-disabled]"), source: has("disabled") ? "匹配到 disabled CSS" : "未检测到" },
      selected: { detected: has("selected") || element.matches(":checked,[aria-selected='true'],[data-state='open']"), source: has("selected") ? "匹配到 selected/checked CSS" : "未检测到" },
      invalid: { detected: has("invalid") || element.matches("[aria-invalid='true']"), source: has("invalid") ? "匹配到 invalid CSS" : "未检测到" }
    };
  }

  const CHILD_INTERACTIVE_SELECTOR = [
    "[role='combobox']", "button[aria-haspopup='listbox']", "select", "textarea", "input",
    "a[href]", "button", "[role='switch']", "[role='tab']", "[role='dialog']", "dialog",
    "summary", "[role='slider']", "[contenteditable='true']"
  ].join(",");

  const CHILD_INTERACTION_DEFS = {
    combobox: ["下拉选择（combobox）", "打开选项并选择一个值：本地 open/value 状态 + onChange 回调；键盘 ↑↓ 选择、Esc 关闭", "high"],
    select: ["下拉选择（select）", "打开选项并选择一个值：本地 open/value 状态 + onChange 回调", "high"],
    switch: ["开关（switch）", "切换选中状态：受控 checked 属性 + onChange 回调", "high"],
    checkbox: ["复选（checkbox）", "切换选中状态：受控 checked 属性 + onChange 回调", "high"],
    radio: ["单选（radio）", "组内选择一项：受控 checked + 互斥 + onChange 回调", "high"],
    slider: ["滑块（slider）", "拖动调整数值：本地 value 状态 + onInput 回调", "high"],
    date: ["日期选择（date）", "打开日期面板并选择日期：本地 value 状态 + onChange 回调", "medium"],
    textarea: ["多行文本（textarea）", "输入文本内容：本地 value 状态 + onChange 回调", "high"],
    "text-input": ["文本输入（input）", "输入内容：本地 value 状态 + onChange 回调", "high"],
    tab: ["标签页（tab）", "切换面板：本地 activeIndex 状态 + onSelect 回调", "medium"],
    dialog: ["弹层（dialog）", "打开/关闭弹层：本地 open 状态，Esc 或点击外部关闭", "medium"],
    details: ["折叠（details/summary）", "展开/收起内容：原生 open 属性即可", "high"],
    link: ["链接（link）", "点击触发导航：本地路由或 onClick 回调，原链接已移除", "high"],
    button: ["通用操作（button）", "触发点击：暴露 onClick 回调，原站业务动作已移除", "high"]
  };

  function childInteractionKey(el) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (role === "option" || role === "listbox") return null;  // 下拉选项/面板归属 combobox/select，不单独计数
    if (role === "combobox" || (tag === "button" && el.getAttribute("aria-haspopup") === "listbox")) return "combobox";
    if (tag === "select") return "select";
    if (role === "switch") return "switch";
    if (role === "tab") return "tab";
    if (role === "dialog" || tag === "dialog") return "dialog";
    if (role === "slider" || type === "range") return "slider";
    if (tag === "textarea") return "textarea";
    if (tag === "input") {
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (["date", "month", "time", "datetime-local"].includes(type)) return "date";
      if (["hidden", "submit", "reset", "button", "image"].includes(type)) return null;
      return "text-input";
    }
    if (tag === "a") return "link";
    if (tag === "summary") return "details";
    if (tag === "button") return "button";
    return null;
  }

  function childInteractionLabel(el) {
    let t = el.getAttribute("aria-label") || "";
    if (!t && el.labels && el.labels[0]) t = el.labels[0].textContent;
    if (!t) {
      const group = el.closest("[role='group'], fieldset, li");
      if (group) {
        const lab = group.querySelector("label, [aria-label]");
        if (lab) t = lab.getAttribute("aria-label") || lab.textContent;
      }
    }
    if (!t) t = el.textContent || "";
    return t.replace(/\s+/g, " ").trim().slice(0, 24);
  }

  /* 容器场景：递归扫描内部交互元素，按类型聚合输出（2026-09-01） */
  function scanChildInteractions(root) {
    const nodes = Array.from(root.querySelectorAll(CHILD_INTERACTIVE_SELECTOR)).slice(0, 30);
    if (!nodes.length) return [];
    const groups = {};
    nodes.forEach((el) => {
      const key = childInteractionKey(el);
      if (!key) return;
      const g = groups[key] || (groups[key] = { count: 0, labels: [] });
      g.count++;
      const lb = childInteractionLabel(el);
      if (lb && g.labels.indexOf(lb) === -1 && g.labels.length < 3) g.labels.push(lb);
    });
    const order = ["combobox", "select", "switch", "checkbox", "radio", "slider", "date", "textarea", "text-input", "tab", "dialog", "details", "link", "button"];
    const list = [];
    order.forEach((key) => {
      const g = groups[key];
      if (!g) return;
      const [label, impl, conf] = CHILD_INTERACTION_DEFS[key];
      const suffix = g.count > 1 ? ` ×${g.count}` : "";
      const ids = g.labels.length ? `（${g.labels.join(" / ")}）` : "";
      list.push({ behavior: `${label}${ids}${suffix}`, implementation: impl, confidence: conf });
    });
    return list;
  }

  function inferInteractions(element) {
    const list = [];
    const type = inferType(element);
    const expanded = element.getAttribute("aria-expanded");
    if (expanded !== null) list.push({ behavior: "展开/收起关联内容", implementation: "使用本地 boolean 状态控制", confidence: "high" });
    if (["checkbox", "switch"].includes(type)) list.push({ behavior: "切换选中状态", implementation: "使用受控 checked 属性和 onChange 回调", confidence: "high" });
    if (["select", "combobox", "listbox"].includes(type)) list.push({ behavior: "打开选项并选择一个值", implementation: "使用本地 open/value 状态和 onChange 回调", confidence: "high" });
    if (type.includes("date")) list.push({ behavior: "打开日期面板并选择日期", implementation: "使用本地日期状态，不连接原网站接口", confidence: "medium" });
    if (["button", "link"].includes(type)) list.push({ behavior: "触发通用操作", implementation: "暴露 onClick callback；原跳转和业务动作已移除", confidence: "high" });
    if (element.matches("[role='dialog'],dialog") || element.querySelector("[role='dialog'],dialog")) list.push({ behavior: "打开/关闭弹层，Esc 或点击外部关闭", implementation: "使用本地 open 状态", confidence: "medium" });

    // 同时采集根节点和内部控件，避免弹层等容器遮蔽子控件交互。
    const children = scanChildInteractions(element);
    const combined = [...list, ...children].filter((item, index, all) => all.findIndex(other => other.behavior === item.behavior) === index);
    return combined.length ? combined : [{ behavior: "未可靠检测到通用交互", implementation: "仅按所选视觉和状态重建", confidence: "low" }];
  }

  function collectTokens(element) {
    const style = getComputedStyle(element);
    const tokens = {};
    for (const name of Array.from(style)) {
      if (name.startsWith("--")) {
        const value = style.getPropertyValue(name).trim();
        if (value && Object.keys(tokens).length < 30) tokens[name] = value;
      }
    }
    return tokens;
  }

  function collectAccessibility(element) {
    return {
      role: element.getAttribute("role") || implicitRole(element) || "未检测到显式角色",
      label: element.getAttribute("aria-label") || element.getAttribute("title") || safeText(element) || "未检测到可访问名称",
      tabIndex: element.tabIndex,
      keyboardFocusable: element.matches("a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1'])"),
      attributes: Object.fromEntries(Array.from(element.attributes).filter((a) => a.name.startsWith("aria-")).map((a) => [a.name, a.value]))
    };
  }

  function inferType(element) {
    const role = element.getAttribute("role");
    const inputType = element instanceof HTMLInputElement ? element.type : "";
    const haystack = `${role || ""} ${inputType} ${element.className || ""} ${element.getAttribute("aria-label") || ""}`.toLowerCase();
    if (/date|calendar/.test(haystack)) return "date-picker";
    if (role) return role;
    const tag = element.tagName.toLowerCase();
    if (element instanceof HTMLInputElement) {
      if (inputType === "radio") return "radio";
      if (inputType === "checkbox") return "checkbox";
      if (inputType === "range") return "slider";
      if (inputType === "file") return "file-upload";
      if (["date", "datetime-local", "month", "time"].includes(inputType)) return "date-picker";
      if (inputType === "search") return "search";
      if (["submit", "button", "reset"].includes(inputType)) return "button";
      if (inputType === "hidden") return "input";
      return inputType || "input";
    }
    if (tag === "a") return "link";
    if (tag === "textarea") return "textarea";
    if (tag === "select") return "select";
    if (tag === "button") return "button";
    if (tag === "nav") return "navigation";
    if (tag === "form") return "form";
    if (tag === "img") return "image";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "table") return "table";
    if (["ul", "ol"].includes(tag)) return "list";
    if (tag === "dialog") return "dialog";
    if (tag === "label") return "label";
    if (tag === "video") return "video";
    if (tag === "canvas") return "canvas";
    if (element.querySelector("input[type='date'],[role='grid'] [role='gridcell']")) return "date-picker";
    if (element.querySelector("iframe")) return "container";  // iframe 卡片区块：整卡语义优先于按钮组
    if (element.querySelector("button") && element.children.length > 1) return "interactive-group";
    return "container";
  }

  function inferName(element) {
    const explicit = element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("name");
    if (explicit && !SENSITIVE_ATTR.test(explicit)) return truncate(explicit, 52);
    const text = safeText(element);
    const type = inferType(element);
    if (text) return `${truncate(text, 34)} · ${friendlyType(type)}`;
    const id = element.id && !looksGenerated(element.id) ? element.id : "";
    const cls = typeof element.className === "string" ? element.className.split(/\s+/).find((item) => item && !looksGenerated(item)) : "";
    return id || cls || friendlyType(type);
  }

  /* 组件描述：说明组件的作用与常见出现场景（详情卡「组件描述」区） */
  const COMPONENT_DESCRIPTIONS = {
    "navigation": "用于组织页面信息层级，引导用户在不同区域或页面间跳转。常见于网站顶栏、侧边栏菜单、后台管理界面与移动端底部导航。",
    "input": "用于接收用户输入的单行文本，如关键词、账号、邮箱、电话号码等。常见于搜索栏、登录/注册表单、筛选器与设置页。",
    "search": "用于输入搜索关键词并触发检索。常见于网站顶部搜索框、电商商品搜索、后台列表筛选。",
    "textarea": "用于接收多行文本输入。常见于评论回复、反馈意见、描述编辑与聊天输入区。",
    "radio": "用于在互斥选项组中单选一个值。常见于表单的性别、套餐、支付方式与偏好设置。",
    "checkbox": "用于在一组选项中多选多个值。常见于筛选条件、权限配置、条款同意与批量操作。",
    "select": "用于从预定义选项列表中选择一个值。常见于表单字段、筛选器、设置项与分页大小选择。",
    "combobox": "用于输入并选择一个值，支持搜索过滤选项。常见于地址选择、城市联动与标签输入。",
    "switch": "用于在开/关两种状态间切换。常见于设置页的功能开关、权限控制与模式切换。",
    "button": "用于触发操作或提交信息。常见于表单提交、对话框操作、工具栏与卡片主操作。",
    "link": "用于跳转到其他页面或页面内锚点。常见于导航菜单、正文引用、页脚链接与面包屑。",
    "dialog": "用于在页面之上展示需要用户关注或确认的内容。常见于确认框、表单弹窗、图片预览与消息提示。",
    "date-picker": "用于选择日期或时间。常见于预订流程、日程安排、数据报表筛选与表单生日字段。",
    "slider": "用于在连续范围内选择一个值。常见于音量/亮度调节、价格区间筛选、进度与倍速设置。",
    "file-upload": "用于选择并上传本地文件。常见于头像上传、附件添加、资料导入与图片发布。",
    "image": "用于展示图片或图标内容。常见于轮播图、商品卡片、头像、广告位与插图。",
    "heading": "用于标识区块标题与信息层级。常见于页面主标题、卡片标题、章节小标题。",
    "list": "用于展示有序或无序的条目集合。常见于菜单、新闻列表、设置项与评论列表。",
    "table": "用于以行列结构展示数据。常见于数据管理后台、报表统计、价格对比与订单列表。",
    "form": "用于承载一组输入控件并提交数据。常见于登录注册、搜索、设置、反馈与下单流程。",
    "label": "用于说明输入项的名称或用途。常见于表单字段标题、复选框/单选框的说明文字。",
    "video": "用于播放视频内容。常见于视频网站播放器、课程页、直播与宣传片区域。",
    "canvas": "用于动态绘制图形或动画。常见于数据可视化、绘图工具、游戏与特效展示。",
    "interactive-group": "包含多个交互子元素的组合组件。常见于工具栏、按钮组、选项卡与卡片操作区。",
    "container": "用于承载与布局内容的通用盒子。常见于页面分区、卡片容器、栅格布局与模块包裹层。"
  };

  function describeComponent(type) {
    return COMPONENT_DESCRIPTIONS[type] || "承载页面内容与功能的通用组件，其作用取决于页面上下文，常见于各类页面布局与功能模块中。";
  }

  function friendlyType(type) {
    const labels = { button: "按钮", link: "链接", input: "输入框", search: "搜索框", textarea: "文本域", radio: "单选框", checkbox: "复选框", select: "下拉选择器", combobox: "下拉选择器", switch: "开关", dialog: "弹窗", navigation: "导航", "date-picker": "日期选择器", slider: "滑块", "file-upload": "文件上传", image: "图片", heading: "标题", list: "列表", table: "表格", form: "表单", label: "标签", video: "视频", canvas: "画布", "interactive-group": "交互组件组", container: "容器" };
    return labels[type] || type;
  }

  function implicitRole(element) {
    const tag = element.tagName.toLowerCase();
    return ({ button: "button", nav: "navigation", main: "main", form: "form", select: "combobox", textarea: "textbox" })[tag] || (tag === "a" && element.hasAttribute("href") ? "link" : "");
  }

  function detectStack() {
    const stacks = [];
    if (document.querySelector("[data-reactroot],#__next") || Object.keys(document.documentElement).some((key) => key.startsWith("__react"))) stacks.push("React/Next.js（推测）");
    if (document.querySelector("[data-v-app],[data-vue-meta]") || window.__VUE__) stacks.push("Vue（推测）");
    if (document.querySelector("[ng-version],[_nghost-]")) stacks.push("Angular（推测）");
    if (document.querySelector("[data-framer-name]")) stacks.push("Framer（推测）");
    return stacks.length ? stacks.join("、") : "未知/原生 Web";
  }

  function createSelector(element) {
    if (element.id && !looksGenerated(element.id)) return `#${CSS.escape(element.id)}`;
    const parts = [];
    let current = element;
    while (current && current !== document.body && parts.length < 5) {
      let part = current.tagName.toLowerCase();
      const stableClass = typeof current.className === "string" ? current.className.split(/\s+/).find((c) => c && !looksGenerated(c)) : "";
      if (stableClass) part += `.${CSS.escape(stableClass)}`;
      else if (current.parentElement) part += `:nth-child(${Array.from(current.parentElement.children).indexOf(current) + 1})`;
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function relativeSelector(node, root) {
    const parts = [];
    let current = node;
    while (current && current !== root && parts.length < 4) {
      let part = current.tagName.toLowerCase();
      const stableClass = typeof current.className === "string" ? current.className.split(/\s+/).find((c) => c && !looksGenerated(c)) : "";
      if (stableClass) part += `.${CSS.escape(stableClass)}`;
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ") || node.tagName.toLowerCase();
  }

  function safeText(element) {
    if (element.matches("input,textarea")) return element.getAttribute("placeholder") || "";
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text = '', node;
    while ((node = walker.nextNode()) && text.length < 140) {
      if (!node.parentElement?.closest('input,textarea,script,style')) text += node.textContent + ' ';
    }
    return truncate(text.replace(/\s+/g, ' ').trim(), 140);
  }

  function isDefaultNoise(prop, value) {
    const defaults = { "margin-top": "0px", "margin-right": "0px", "margin-bottom": "0px", "margin-left": "0px", "padding-top": "0px", "padding-right": "0px", "padding-bottom": "0px", "padding-left": "0px", "background-image": "none", "box-shadow": "none", "transform": "none", "transition": "all 0s ease 0s", "animation": "none 0s ease 0s 1 normal none running", "outline": "rgb(0, 0, 0) none 0px" };
    return defaults[prop] === value;
  }

  function looksGenerated(value) { return value.length > 42 || /(?:^|[-_])[a-f0-9]{7,}(?:$|[-_])/i.test(value); }
  function truncate(value, max) { return value.length > max ? `${value.slice(0, max - 1)}…` : value; }
  function formatHtml(html) { return html.replace(/></g, ">\n<"); }

  /* ═══════════════ 选中后渲染详情卡 ═══════════════ */
  function adjustScope(direction) {
    if (copyJob || !selected?.isConnected) return;
    if (direction > 0) {
      const parent = selected.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement || scopeStack.length >= 8) return;
      scopeStack.push(parent);
    } else {
      if (scopeStack.length <= 1) return;
      scopeStack.pop();
    }
    refreshSelection('采样范围已更新');
  }

  function captureWarnings() {
    if (!payload) return [];
    const warnings = [];
    if (!selected?.isConnected) warnings.push('原组件已被页面替换，请重新选择。');
    if (payload.truncated.length) warnings.push(format === 'figma' ? '内容摘要已截断；Figma 将转换所选原始组件，耗时可能较长。' : '内容已达到 300 个元素或 10 层深度上限，导出不是完整组件。');
    if (payload.removed.some(x => x.includes('跨域 iframe'))) warnings.push('包含无法读取的 iframe，内部内容未采集。');
    if (payload.motion.signals.length) warnings.push('包含动效：当前采样是瞬时状态，不代表完整动画行为。');
    if (format !== 'figma' && mode === 'interactive') warnings.push('交互是根据元素语义推断的建议，不是原网站业务逻辑。');
    if (format === 'figma') warnings.push('Figma 转换时检查图片和字体；复杂背景位置及字体效果需粘贴后核对。');
    if (selected?.querySelector('img') || selected?.matches('img') || payload.css.includes('url(')) warnings.push('图片已引用但尚未逐一验证可读取性。');
    warnings.push(...conversionWarnings);
    warnings.push('已清理输入值；可见正文仍会复制，请在分享前检查。');
    return [...new Set(warnings)];
  }

  function renderPreview() {
    if (!payload || !ui) return;
    const c = payload.component;
    ui.meta.textContent = `${c.dimensions.width} × ${c.dimensions.height} px · ${c.nodeCount} 个采样元素 · ${new Date(payload.capturedAt).toLocaleTimeString()} 的快照`;
    const parent = selected?.parentElement;
    ui.expand.disabled = !!copyJob || !selected?.isConnected || !parent || parent === document.body || parent === document.documentElement || scopeStack.length >= 8;
    ui.shrink.disabled = !!copyJob || scopeStack.length <= 1 || !selected?.isConnected;
    ui.refresh.disabled = !!copyJob || !selected?.isConnected;
    ui['preview-note'].textContent = format === 'figma' ? '这里显示采样结构摘要；Figma 图层会在转换时读取原组件当前外观。' : '这里展示实际将复制的 Markdown，可滚动检查文字与样式。';
    // textContent prevents captured page markup from running or fetching resources in the panel.
    ui.preview.textContent = format === 'figma' ? payload.html : buildMarkdown();
    ui.quality.replaceChildren();
    const title = document.createElement('b'); title.textContent = '采样说明与待核对项';
    const list = document.createElement('ul');
    for (const warning of captureWarnings()) { const item = document.createElement('li'); item.textContent = warning; list.append(item); }
    ui.quality.append(title, list);
  }

  function copyStatus(text, state = 'working') {
    ui.status.textContent = text;
    ui.status.dataset.state = state;
  }

  function cancelCopy() {
    if (!copyJob || copyJob.writing) return;
    copyJob.cancelled = true;
    copyStatus('正在停止：待当前转换结束后丢弃结果，不会写入剪贴板。');
    ui.cancel.disabled = true;
  }

  function assertJob(job) {
    if (job.cancelled) throw new Error('已取消复制');
    if (!job.element.isConnected) throw new Error('原组件已被页面替换，请重新选择');
  }

  function setBusy(busy) {
    ui.copy.disabled = busy;
    ui.copy.setAttribute('aria-busy', String(busy));
    ui.select.disabled = busy;
    ui.chips.forEach(chip => { chip.disabled = busy; });
    ui.modes.forEach(input => { input.disabled = busy || (format === 'figma' && input.value === 'interactive'); });
    ui.cancel.hidden = !busy;
    ui.cancel.disabled = false;
    renderPreview();
    renderCopyLabel();
  }

  function setSelection(element) {
    selected = element;
    payload = analyze(element);
    conversionWarnings = [];
    lastCopyFailed = false;
    copyStatus('采样完成，可展开预览并检查采样说明。', 'ready');
    ui.title.textContent = `${friendlyType(payload.component.type)}｜${payload.component.tag}`;
    ui.desc.textContent = describeComponent(payload.component.type);
    ui.modes.forEach((input) => { input.checked = input.value === mode; });
    ui.detail.hidden = false;
    renderCopyLabel();
    renderPreview();
  }

  function selectFormat(next) {
    if (copyJob) return;
    format = next;
    // Figma 只能粘贴图层：选中 Figma 时禁用「外观+交互组件」，已选中则自动回退「仅外观」
    const interactiveInput = ui.modes.find((i) => i.value === "interactive");
    if (interactiveInput) interactiveInput.disabled = next === "figma";
    if (next === "figma" && mode === "interactive") {
      mode = "appearance";
      showToast("Figma 输出仅支持「仅外观」，已自动切换", 3000);
    }
    ui.modes.forEach((input) => { input.checked = input.value === mode; });
    // 目标位置由用户在复制出的文档中自行填写（插件不收集网址）
    ui.chips.forEach((chip) => chip.classList.toggle("active", chip.dataset.f === next));
    renderCopyLabel();
    renderPreview();
  }

  function renderCopyLabel() {
    const labels = { figma: "复制到Figma", markdown: "复制给 AI" };
    ui.copy.textContent = copyJob ? '正在处理…' : lastCopyFailed ? '重试复制' : labels[format] || '复制';
  }

  /* ═══════════════ 输出生成（自 panel.js 移植，targetStack 固定） ═══════════════ */
  function buildPayload() {
    const source = payload;
    const data = {
      purpose: "在目标页面/项目中添加相似 UI 组件，不复制原网站业务逻辑",
      captureMode: mode,
      targetStack: "根据我的项目判断",
      component: source.component,
      pageStackGuess: source.page.stack,
      html: source.html,
      css: source.css,
      truncated: source.truncated || [],
      designTokens: source.tokens,
      accessibility: source.accessibility,
      removedContent: source.removed,
      motion: source.motion || { signals: [], transitions: [], animations: [], lotties: [] },
      constraints: [
        "不得恢复原网站链接、接口、埋点、凭证或业务动作",
        "所有业务动作使用 props 或通用 callback 暴露",
        "优先使用目标项目已有组件、Token 和编码规范"
      ]
    };
    if (mode !== "appearance") {
      data.uiStates = source.states;
      data.stateCss = source.stateCss;
    }
    if (mode === "interactive") data.genericInteractions = source.interactions;
    return data;
  }

  function modeLabel(m) {
    return ({ appearance: "仅外观（当前可读取内容）", interactive: "外观 + 交互组件" })[m];
  }

  function labelType(type) {
    return friendlyType(type);
  }

  function buildMarkdown() {
    const data = buildPayload();
    const stateLines = mode === "appearance" ? "- 本次仅采集当前外观" : Object.entries(data.uiStates).map(([name, value]) => `- ${name}: ${value.detected ? `已检测（${value.source}）` : "未检测到，不要假设来自原页面"}`).join("\n");
    const interactionLines = mode === "interactive" ? data.genericInteractions.map((item) => `- ${item.behavior}：${item.implementation}`).join("\n") : "- 本次仅复制外观；未复制交互行为";
    const tokenLines = Object.keys(data.designTokens).length ? Object.entries(data.designTokens).map(([key, value]) => `- ${key}: ${value}`).join("\n") : "- 未检测到组件级 CSS 自定义属性";
    const motion = data.motion || { signals: [], transitions: [], animations: [], lotties: [] };
    const timingLines = motion.signals.length ? motion.signals.map((s) => `- ${s}`).join("\n") : "- 组件内未检测到运行中动效/动画声明（本次采样为静止态，可直接采信几何与状态）";
    return `# 组件添加任务

请将下方采样的组件，**添加**到「目标位置」指定的页面中。**仅做增量添加：不修改、不删除、不覆盖目标页面/项目中已有的任何组件、内容、样式或逻辑。**不要复制或恢复原网站的业务逻辑、网络请求、跳转、埋点、凭证或用户数据。

## 目标位置（请填写后再发送给 AI，均可留空）
- 目标网址：＿＿＿＿＿＿＿＿（可选：页面 URL 或代码仓库；**留空则默认新建一个独立项目来交付该组件**）
- 具体位置：＿＿＿＿＿＿＿＿（可选：页面内的放置位置，如「A 模块下方」；**留空则默认放在页面所有组件的最后面**）

## 实现设置
- 目标技术栈：${data.targetStack}
- 采集模式：${modeLabel(mode)}
- 页面技术栈推测：${data.pageStackGuess}
- 请优先复用目标项目现有组件、设计 Token 和编码规范

## 组件摘要
- 推测名称：${data.component.name}
- 类型：${labelType(data.component.type)}
- HTML 标签：${data.component.tag}
- 角色：${data.component.role || "未检测到"}
- 尺寸：${data.component.dimensions.width}px × ${data.component.dimensions.height}px
- 原页面定位信息（仅供分析）：${data.component.selector}
${data.truncated.length ? `
## 采样说明
- ⚠ 组件内部部分子树超出采集深度/节点上限，内容已截断（容器骨架保留）：${data.truncated.join("、")}。缺失内容请结合「可访问名称 / 设计 Token」合理补全，不要凭空编造结构。` : ""}

## 采样时机声明
${timingLines}

## UI 状态
${stateLines}

## 通用交互
${interactionLines}

## 可访问性
- 角色：${data.accessibility.role}
- 可访问名称：${data.accessibility.label}
- 键盘可聚焦：${data.accessibility.keyboardFocusable ? "是" : "否"}
- 实现时请保留合理的语义标签、键盘操作和焦点样式

## 设计 Token
${tokenLines}

## 安全清理
${data.removedContent.map((item) => `- ${item}`).join("\n")}
- 请在目标页面/项目中重新连接业务行为

## 清理后的 DOM
\`\`\`html
${data.html}
\`\`\`

## 关键视觉 CSS
\`\`\`css
${data.css}
\`\`\`
${mode !== "appearance" ? `
## 检测到的状态 CSS
\`\`\`json
${JSON.stringify(data.stateCss, null, 2)}
\`\`\`

## 检测到的动效声明
### CSS 过渡 / 动画规则（原文：时长、缓动、属性以声明为准）
\`\`\`css
${[...motion.transitions, ...motion.animations].join("\n\n") || "/* 未检测到 transition/animation 声明 */"}
\`\`\`
${motion.lotties.length ? `
### Lottie / 滚动触发播放器
${motion.lotties.map((item) => `- \`${item.selector}\`：${item.config}`).join("\n")}
` : ""}
` : ""}
## 验收要求
- 保留组件的视觉层级、尺寸关系和已检测状态
- 动效还原以「检测到的动效声明」中的时长/缓动/属性为准；未能实测的自动行为（轮播间隔、悬停暂停规则等）标注为推测，不得编造数值
- 缺失状态可以按目标项目设计系统补全，但需要说明属于推测
- 不得恢复原网站链接、接口、埋点和业务动作
- 将通用动作通过 props/callback 暴露
- 输出可维护、可访问并适配目标项目的组件代码
- 不得改动目标页面/项目中已有内容：仅新增组件相关文件与必要引用
`;
  }

  function buildHtmlCss() {
    const data = buildPayload();
    return `<!--
组件：${data.component.name}
采集模式：${modeLabel(mode)}
清理说明：移除链接目标、事件属性和输入值；可见正文及资源仍需在分享前检查。
请在自己的项目中重新连接业务 callback。
-->

${data.html}

<style>
${data.css}
</style>
`;
  }

  /* ═══════════════ 复制 ═══════════════ */
  async function writeClipboard(value, mime = "text/plain") {
    try {
      if (!navigator.clipboard) throw new Error("当前页面不支持 Clipboard API");
      if (mime === "text/plain") await navigator.clipboard.writeText(value);
      else await navigator.clipboard.write([new ClipboardItem({[mime]: new Blob([value], {type: mime})})]);
      return;
    } catch {
      // HTTP 页面没有安全上下文 API；扩展的 clipboardWrite 权限支持传统 copy 路径。
      const focused = document.activeElement;
      const selection = document.getSelection();
      const ranges = selection ? Array.from({length: selection.rangeCount}, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
      const area = document.createElement("textarea");
      area.value = "Patternyze";
      area.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      host.shadowRoot.append(area);
      let handled = false;
      const listener = event => {
        if (!event.clipboardData) return;
        event.clipboardData.setData(mime, value);
        event.preventDefault();
        event.stopImmediatePropagation();
        handled = true;
      };
      document.addEventListener("copy", listener, true);
      try {
        area.focus(); area.select();
        if (!document.execCommand("copy") || !handled) throw new Error("浏览器拒绝复制，请切换到 HTTPS 页面或重新激活插件");
      } finally {
        document.removeEventListener("copy", listener, true);
        area.remove();
        focused?.focus?.({preventScroll:true});
        if (selection) { selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range)); }
      }
    }
  }

  async function copyOutput() {
    if (!payload || !selected?.isConnected) {
      copyStatus('原组件不可用，请重新选择。', 'error');
      showToast("请先在页面上点击选择一个组件", 3000);
      return;
    }
    if (copyJob) return;
    const job = {element: selected, cancelled: false, writing: false};
    copyJob = job;
    lastCopyFailed = false;
    conversionWarnings = [];
    setBusy(true);
    copyStatus('正在准备导出…');
    try {
      if (format === "figma") {
        const info = await copyFigmaOutput(job);
        copyStatus(`已复制 ${info.nodeCount} 个图层，前往 Figma 粘贴。${conversionWarnings.length ? '请查看下方采样说明。' : ''}`, 'success');
      } else {
        const output = format === "markdown" ? buildMarkdown() : buildHtmlCss();
        await new Promise(resolve => setTimeout(resolve, 0));
        assertJob(job);
        job.writing = true;
        ui.cancel.disabled = true;
        copyStatus('正在写入剪贴板…');
        await writeClipboard(output);
        copyStatus('已复制 Markdown。切换到 AI 粘贴，返回此页可继续调整。', 'success');
      }
    } catch (error) {
      lastCopyFailed = !job.cancelled;
      copyStatus(job.cancelled ? '已取消，结果未复制。选区已保留。' : `复制失败：${error.message || error}。选区已保留，可重试或切换 Markdown。`, job.cancelled ? 'ready' : 'error');
    } finally {
      copyJob = null;
      setBusy(false);
    }
  }

  async function copyFigmaOutput(job) {
    copyStatus('正在加载 Figma 转换器…');
    if (!runtimeAlive()) {
      // 扩展已重载：旧实例的 chrome.runtime 失效，sendMessage 会同步抛
      handleContextInvalidated();
      throw new Error("插件已更新，请重新点击插件图标或刷新页面");
    }
    // Figit 转换器体积大，按需注入：先请 service worker 确保已加载
    let ensure = null;
    try {
      ensure = await chrome.runtime.sendMessage({ type: "ENSURE_FIGIT" });
    } catch {
      // context invalidated 也会走到这里（同步抛被 try 接住）
      ensure = null;
      if (!runtimeAlive()) handleContextInvalidated();
    }
    if (!ensure?.ok || typeof window.__figitConvert === "undefined") {
      throw new Error(ensure?.error || "Figit 转换器加载失败，请重试");
    }
    assertJob(job);
    copyStatus('正在生成图层，检查图片与字体…');
    const result = await window.__figitConvert(job.element, {
      onProgress: text => { if (!job.cancelled) copyStatus(text); },
      onWarning: text => { if (!job.cancelled) { conversionWarnings.push(text); renderPreview(); } }
    });
    assertJob(job);
    job.writing = true;
    ui.cancel.disabled = true;
    copyStatus('正在写入剪贴板…');
    await writeClipboard(result.html, "text/html");
    return { nodeCount: result.nodeCount, byteSize: result.byteSize };
  }

  /* ═══════════════ 消息 ═══════════════ */
  if (runtimeAlive()) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "START_SELECTION" || message.type === "RESTART_SELECTION") { start(); sendResponse({ started: true }); }
      if (message.type === "STOP_SELECTION") { stop(); selected = null; payload = null; sendResponse({ stopped: true }); }
    });
  }

  // 切换应用时保留快照；离开页面只停止拾取和尚未写入的复制任务。
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      active = false;
      hovered = null;
      cancelCopy();
      if (ui) { ui.overlay.hidden = true; ui.tip.hidden = true; }
    } else if (payload && ui && !ui.brand.hidden) {
      renderPreview();
      if (selected?.isConnected) updateOverlay(selected, selected);
      else copyStatus('原组件已被页面替换。保留上次快照供查看，请重新选择后复制。', 'error');
    }
  });

  window.__componentSampler = { start, stop };
  start();
})();
