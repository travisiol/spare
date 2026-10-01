// HTTP-level checks against a running server (default http://localhost:3658).
// Reads test secrets from .env.local; prints only pass/fail.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:3658";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

let failed = 0;
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failed++;
};
const get = (path, headers = {}) => fetch(BASE + path, { redirect: "manual", headers });
const post = (path, body, headers = {}) => fetch(BASE + path, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", ...headers }, body });

// --- pages need a session -------------------------------------------------
for (const path of ["/app", "/app/onboarding", "/app/activity", "/app/weekly-review", "/app/holdings", "/app/settings"]) {
  const res = await get(path);
  check(res.status === 307 && (res.headers.get("location") ?? "").includes("signin=1"), `${path} redirects to sign-in without a session`);
}
const forged = await get("/app", { cookie: "spare_session=forged-token" });
check(forged.status === 307, "a forged session cookie is refused");

// --- admin ----------------------------------------------------------------
const admin = await (await get("/admin")).text();
check(admin.includes("Operator token") && !admin.includes("Reconciliation exceptions"), "/admin shows only the sign-in form without an admin session");
const demo = await post("/api/demo/start", JSON.stringify({ timezone: "UTC" }));
const demoCookie = (demo.headers.get("set-cookie") ?? "").split(";")[0];
check(demo.status === 200 && demoCookie.startsWith("spare_session="), "the demo starts a session");
const adminAsDemo = await (await get("/admin", { cookie: demoCookie })).text();
check(!adminAsDemo.includes("Reconciliation exceptions"), "a demo user is not an admin");

// --- sign-in --------------------------------------------------------------
const cross = await post("/api/auth/nonce", "", { origin: "https://evil.example" });
check(cross.status === 403, "a cross-site POST to the nonce endpoint is refused");
const badVerify = await post("/api/auth/verify", JSON.stringify({ message: "hello", signature: "0x00" }));
check(badVerify.status === 401, "a malformed sign-in message is refused");
const me = await (await get("/api/auth/me")).json();
check(me.user === null, "/api/auth/me reports no user without a session");

// --- webhook --------------------------------------------------------------
const secret = env.SPARE_TXN_WEBHOOK_SECRET;
const event = (id) =>
  JSON.stringify({
    id,
    type: "transaction.posted",
    occurred_at: new Date().toISOString(),
    account_id: "acct-that-does-not-exist",
    transaction: { id: `txn-${id}`, merchant: "Verify Script", amount_minor: 463, currency: "USD", category: "purchase", authorized_at: new Date().toISOString(), posted_at: new Date().toISOString() },
  });
const sign = (body, t = Math.floor(Date.now() / 1000), key = secret) => `t=${t},v1=${createHmac("sha256", key).update(`${t}.${body}`).digest("hex")}`;
const hook = (body, signature) => post("/api/webhooks/transactions/webhook", body, signature ? { "x-spare-signature": signature } : {});

const body = event(`verify-${Date.now()}`);
check((await hook(body)).status === 401, "webhook without a signature is refused");
check((await hook(body, sign(body, undefined, "wrong-secret-wrong-secret"))).status === 401, "webhook with a wrong signature is refused");
check((await hook(body, sign(body, Math.floor(Date.now() / 1000) - 3600))).status === 401, "webhook with a stale timestamp is refused");
check((await hook(body.replace("463", "464"), sign(body))).status === 401, "webhook with a tampered body is refused");
const first = await hook(body, sign(body));
check(first.status === 200 && (await first.json()).outcome === "ignored", "a signed event for an unknown account is accepted and ignored");
const second = await hook(body, sign(body));
check(second.status === 200 && (await second.json()).outcome === "duplicate", "re-delivery of the same event is a duplicate");
check((await hook("{}", sign("{}"))).status === 400, "a signed but malformed event is refused");
check((await post("/api/webhooks/transactions/demo-bank", body, { "x-spare-signature": sign(body) })).status === 404, "the demo provider cannot be reached through the public webhook");

// --- cron -----------------------------------------------------------------
check((await post("/api/internal/tick", "")).status === 401, "the tick endpoint needs its secret");
const tick = await post("/api/internal/tick", "", { authorization: `Bearer ${env.CRON_SECRET}` });
check(tick.status === 200, "the tick endpoint runs with its secret");

console.log(failed ? `\n${failed} check(s) failed` : "\nAll HTTP checks passed");
process.exit(failed ? 1 : 0);
