---
name: wechat-devtools-stable-test
description: Stable WeChat Developer Tools real-device-simulator testing workflow for mini programs. Use when the user asks to compile, preview, test, debug, validate page data, verify CloudBase runtime data, or recover from stuck WeChat DevTools automator/MCP states, including CLI auto timeout, simulator welcome page, page_stack hang, MCP wechat_automator/wechat_navigate timeout, CDP toolbar compile recovery, and raw miniprogram-automator fallback.
---

# WeChat DevTools Stable Test

## Core Rule

Treat MCP wrapper failure as a transport problem until proven otherwise. A compile success plus a stuck `page_stack` often means the IDE or automator daemon is stale, not that the mini program failed.

Always record four facts:

- IDE HTTP port from compile output, for example `37550`
- CDP port, normally `9222`
- auto port, use a fresh one such as `9432`, `9433`
- current page path and page data assertions

## Standard Workflow

1. Confirm project root is the directory containing `project.config.json`, not `miniprogram/`.
2. Read `project.config.json`; verify `appid`, `miniprogramRoot`, and `cloudfunctionRoot`.
3. Run `wechat_ide(action="status")`.
4. Open IDE with CDP enabled:

```json
{"action":"open","project_path":"<projectRoot>","cdp_enabled":true,"lang":"zh"}
```

5. Compile:

```json
{"action":"compile","project_path":"<projectRoot>","lang":"zh","info_output":"<projectRoot>\\test-results\\wechat-compile.json"}
```

Accept compile only when `compiled=true`, `errors=[]`, `warnings=[]`, `wxml_errors=[]`, and AppID is not undefined.

## Start Automator Reliably

If `wechat_automator(action="start")` times out, use the compile output IDE HTTP port and start auto manually:

```powershell
Start-Process -FilePath 'D:\微信开发者工具\AI版本\微信web开发者工具\cli.bat' `
  -ArgumentList @(
    'auto',
    '--project','D:\VScode\Project\web-cloudbase-vue-template-transto-miniprogram',
    '--port','<IDE_HTTP_PORT>',
    '--auto-port','<FRESH_AUTO_PORT>',
    '--trust-project',
    '--lang','zh'
  ) `
  -WindowStyle Hidden
```

Use a new auto port when the old one is suspect. Do not trust a hanging `page_stack` alone.

## CDP Recovery

Use when compile succeeds but simulator remains on the welcome page or `page_stack` hangs.

Connect to CDP `http://127.0.0.1:9222`, find the page with `projectpath=`, bring it forward, then click the toolbar compile button. Coordinates are approximate; for the known 1920x1030 DevTools window, `(1870, 48)` clicked `普通编译`.

```js
const { chromium } = await import("playwright");
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()
  .flatMap(c => c.pages())
  .find(p => p.url().includes("projectpath="));
await page.bringToFront();
await page.mouse.click(1870, 48);
await page.waitForTimeout(10000);
await browser.close();
```

If screenshot writing fails with permission errors, continue with data validation.

## WebSocket Health Check

Before abandoning an auto port, test raw WebSocket:

```js
const wsMod = await import("ws");
const WS = wsMod.default || wsMod.WebSocket;
const result = await new Promise(resolve => {
  const ws = new WS("ws://127.0.0.1:<AUTO_PORT>");
  const timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), 8000);
  ws.on("open", () => ws.send(JSON.stringify({ id: "1", method: "Tool.getInfo", params: {} })));
  ws.on("message", m => { clearTimeout(timer); resolve({ ok: true, message: String(m) }); ws.close(); });
  ws.on("error", e => { clearTimeout(timer); resolve({ ok: false, reason: "error", message: e.message }); });
});
```

If `Tool.getInfo` returns `version` and `SDKVersion`, the auto service is alive even if MCP wrappers hang.

## Raw miniprogram-automator Fallback

Use this when `wechat_automator`, `wechat_navigate`, `wechat_screenshot`, or `wechat_inspector` time out but the WebSocket health check passes.

```js
const automatorMod = await import("miniprogram-automator");
const automator = automatorMod.default || automatorMod["module.exports"];
const mini = await automator.connect({ wsEndpoint: "ws://127.0.0.1:<AUTO_PORT>" });
const stack = await mini.pageStack();
```

Navigate and read page data:

```js
await mini.switchTab("/pages/payments/index");
await new Promise(r => setTimeout(r, 5000));
const page = await mini.currentPage();
const data = await page.data();
```

For non-tab pages use `navigateTo` or `redirectTo` as appropriate.

## Page Assertions

For each important page, assert:

- `page.path` equals expected path
- `loading === false` when present
- key arrays are non-empty or intentionally empty
- target test records are visible with expected state

Recommended order:

- `pages/dashboard/index`
- `pages/houses/index`
- `pages/tenants/index`
- `pages/payments/index`
- `pages/utility/index`
- `pages/batch-meter/index`
- `pages/settings/index`
- `pages/create-lease/index`
- `pages/contract/index`

For this rental mini program, always recheck:

- payment page `allLeases` and `bills`
- target lease bill count, bill types, paid amounts, and statuses
- house `status` and `relationMismatch`
- tenant `status`, `isActive`, and `leaseInfo`

## Known Stable Conclusion

If the simulator appears stuck on the WeChat Developer Tools welcome page after a successful compile, it may still be testable. Use CDP to click the toolbar compile button, then verify via raw `miniprogram-automator` if MCP wrappers continue to hang.

## Report Format

Report briefly in Chinese:

- compile result: errors/warnings/WXML errors
- IDE HTTP port, CDP port, auto port
- whether MCP wrappers worked or raw automator fallback was used
- pages verified and key page data assertions
- CloudBase/runtime data consistency findings
- any remaining tool limitation, such as screenshot or CDP log collection timeout
