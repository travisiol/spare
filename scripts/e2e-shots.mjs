// End-to-end walk through the demo in headless Chrome (over CDP, no dependencies),
// saving desktop and mobile screenshots of every screen into ./shots.
//   node scripts/e2e-shots.mjs [baseUrl]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] || "http://localhost:3658";
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9300 + Math.floor(Math.random() * 500);
const OUT = "shots";
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, ["--headless=new", "--no-first-run", `--user-data-dir=${mkdtempSync(join(tmpdir(), "spare-e2e-"))}`, `--remote-debugging-port=${PORT}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) return new WebSocket(page.webSocketDebuggerUrl);
    } catch {}
    await sleep(200);
  }
  throw new Error("Chrome did not start");
}

const ws = await connect();
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const waiting = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg);
    waiting.delete(msg.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
  return r.result.value;
}
async function go(path) {
  await send("Page.navigate", { url: BASE + path });
  for (let i = 0; i < 100; i++) {
    await sleep(150);
    if (await evaluate(`return document.readyState === "complete" && !!document.querySelector("main")`).catch(() => false)) break;
  }
  await sleep(700);
}
async function viewport(width, height, mobile) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
}
async function shot(name, { full = true } = {}) {
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
  console.log("  saved", name);
}
/** Captures the current page at desktop and phone widths. */
async function both(name, path) {
  await viewport(1440, 900, false);
  await go(path);
  await shot(`${name}-desktop`);
  await viewport(390, 800, true);
  await go(path);
  await shot(`${name}-mobile`);
  const overflow = await evaluate(`return document.documentElement.scrollWidth - window.innerWidth`);
  if (overflow > 0) console.log(`  ! horizontal overflow of ${overflow}px on ${path} at 390px`);
  await viewport(1440, 900, false);
}

const HELPERS = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = (label) => { const b = [...document.querySelectorAll("main button")].find((x) => x.innerText.trim().startsWith(label)); if (!b) throw new Error("no button: " + label); return b; };
  const title = () => document.querySelector("#step-title")?.innerText;
  const stepTo = async (act) => { const t = title(); await act(); for (let i = 0; i < 60 && title() === t; i++) await sleep(200); };
  const status = () => document.querySelector("main h1 + p .pill")?.innerText;
  const until = async (fn) => { for (let i = 0; i < 80 && !fn(); i++) await sleep(300); await sleep(600); };
`;
const run = (body) => evaluate(HELPERS + body);

try {
  await send("Page.enable");
  await send("Runtime.enable");

  console.log("home");
  await viewport(1536, 1024, false);
  await go("/");
  await shot("home-hero-1536", { full: false });
  await both("home", "/");
  await go("/");
  await run(`document.querySelector("header button").click(); await sleep(600);`);
  await shot("home-start-dialog", { full: false });

  console.log("demo onboarding");
  await run(`await fetch("/api/demo/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ timezone: "America/New_York" }) });`);
  await both("onboarding-eligibility", "/app/onboarding");
  await run(`await stepTo(() => { document.querySelector("input[name=confirm]").click(); btn("Confirm").click(); });`);
  await both("onboarding-company", "/app/onboarding");
  await run(`await stepTo(() => { document.querySelector("input[name=symbol][value=AAPL]").click(); btn("Save company").click(); });`);
  await shot("onboarding-transactions");
  await run(`await stepTo(() => btn("Connect purchase data").click());`);
  await run(`await stepTo(() => btn("Connect funding method").click());`);
  await shot("onboarding-cap");
  await run(`await stepTo(() => btn("Save cap").click());`);
  await shot("onboarding-approval");
  await run(`await stepTo(() => btn("I understand").click());`);
  await shot("onboarding-activate");
  await run(`btn("Start tracking").click(); await until(() => location.pathname === "/app");`);

  console.log("tracking week");
  await both("dashboard-tracking", "/app");
  await both("activity", "/app/activity");

  console.log("weekly review");
  await go("/app");
  await run(`btn("Close this week now").click(); await sleep(2500);`);
  await both("dashboard-ready", "/app");
  await both("review-ready", "/app/weekly-review");
  await run(`document.querySelector("input[name=confirm]").click(); btn("Approve").click(); await until(() => status() === "Order pending" || status() === "Settlement pending" || status() === "Completed");`);
  await shot("review-in-flight");
  await run(`await until(() => status() === "Completed");`);
  await both("review-completed", "/app/weekly-review");
  await both("holdings", "/app/holdings");
  await both("settings", "/app/settings");

  console.log("failure path");
  await go("/app");
  await run(`btn("Make example purchases").click(); await sleep(2500);
    const s = document.querySelector("select[name=order]"); s.value = "fail"; s.dispatchEvent(new Event("change", { bubbles: true }));
    btn("Save switches").click(); await sleep(2000); btn("Close this week now").click(); await sleep(2500);`);
  await go("/app/weekly-review");
  await run(`document.querySelector("input[name=confirm]").click(); btn("Approve").click(); await until(() => status() === "Order failed");`);
  await both("review-order-failed", "/app/weekly-review");
  console.log("admin");
  const token = /^ADMIN_TOKEN=(.+)$/m.exec(readFileSync(".env.local", "utf8"))?.[1];
  await go("/admin");
  await shot("admin-signin", { full: false });
  if (token) {
    await evaluate(`const i = document.querySelector("#token"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(token)}); i.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("main button[type=submit]").click(); await new Promise((r) => setTimeout(r, 3500));`);
    await both("admin-demo", "/admin?env=demo");
    await go("/admin?env=live");
    await shot("admin-live");
    await go("/admin?env=demo");
    const before = await evaluate(`return [...document.querySelectorAll("td")].filter((t) => t.innerText === "funds_held_after_failed_order").length`);
    await evaluate(`const b = [...document.querySelectorAll("main button")].find((x) => x.innerText.trim() === "Retry order"); if (b) b.click(); await new Promise((r) => setTimeout(r, 9000));`);
    await go("/admin?env=demo");
    const after = await evaluate(`return [...document.querySelectorAll("td")].filter((t) => t.innerText === "funds_held_after_failed_order").length`);
    console.log(`  admin retry order: held-funds exceptions ${before} -> ${after}`);
  }
  console.log("done");
} finally {
  ws.close();
  chrome.kill();
}
