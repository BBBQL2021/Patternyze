# 回归测试

在仓库根目录运行 npm install、npx playwright install chromium、npm test。

reproduce.cjs 验证采样与真实转换器，ux-regression.cjs 验证面板和异步复制流程。测试使用虚构数据，不写入系统剪贴板。测试结果与截图写入本目录。

可设置 CHROME_EXECUTABLE 使用已有 Chrome，或设置 PLAYWRIGHT_MODULE 指向已有 Playwright 模块。
