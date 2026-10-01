// Headless Chrome screenshots of local pages. Usage:
//   node scripts/capture.mjs <out.png> <url> [width] [height] [cookie]
// Mobile widths are rendered inside an iframe, because Chrome enforces a minimum window width.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [out, url, width = "1536", height = "1024"] = process.argv.slice(2);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = mkdtempSync(join(tmpdir(), "spare-shot-"));
let target = url;
let w = Number(width);
if (w < 520) {
  const page = join(profile, "frame.html");
  writeFileSync(page, `<body style="margin:0;background:#888"><iframe src="${url}" width="${w}" height="${height}" style="border:0;display:block"></iframe></body>`);
  target = `file:///${page.replace(/\\/g, "/")}`;
  w = Math.max(w, 520);
}
execFileSync(
  chrome,
  [
    "--headless=new",
    "--no-first-run",
    `--user-data-dir=${profile}`,
    "--hide-scrollbars",
    "--disable-web-security",
    `--window-size=${w},${height}`,
    "--virtual-time-budget=12000",
    `--screenshot=${resolve(out)}`,
    target,
  ],
  { stdio: "ignore" },
);
console.log(resolve(out));
