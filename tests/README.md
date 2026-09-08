# 回归测试

在仓库根目录运行 npm install、npx playwright install chromium、npm test。

`npm test` 包含采样和真实转换器、面板异步流程、来源链接与问题反馈、多选和诊断采集单元测试。测试使用虚构数据，不写入系统剪贴板。测试结果与截图写入本目录。

`npm run test:evidence` 在独立 Chromium 扩展环境中验证真实诊断采集、截图、标注编辑、多选和完整反馈下载。它创建临时测试扩展与浏览器配置目录，只给测试扩展授予 localhost 权限；正式发布的 manifest 不含该权限。需要先运行 `npx playwright install chromium`。

自动化通过不代表任意业务网站都已验收；实际 Figma 粘贴、浏览器工具栏授权和业务页面仍需人工检查。

可设置 CHROME_EXECUTABLE 使用已有 Chrome，或设置 PLAYWRIGHT_MODULE 指向已有 Playwright 模块。
