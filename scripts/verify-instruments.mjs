// Re-verifies src/config against the outside world. Run before changing the catalogue:
//   - chain id from the RPC,
//   - each token against the issuer's official asset list,
//   - name() / symbol() / decimals() read from the chain.
import { readFileSync } from "node:fs";

const RPC = process.env.SPARE_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const source = readFileSync(new URL("../src/config/instruments.ts", import.meta.url), "utf8");
const pattern = /symbol: "(\w+)",[\s\S]*?tokenName: "([^"]+)",[\s\S]*?address: "(0x[0-9a-fA-F]{40})",[\s\S]*?decimals: (\d+)/g;
const configured = [...source.matchAll(pattern)].map((m) => ({ symbol: m[1], tokenName: m[2], address: m[3], decimals: Number(m[4]) }));

const rpc = async (method, params) => {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
};
const text = (hex) => {
  const bytes = Buffer.from(hex.slice(2), "hex");
  const length = Number(BigInt("0x" + bytes.subarray(32, 64).toString("hex")));
  return bytes.subarray(64, 64 + length).toString("utf8");
};

let failed = false;
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failed = true;
};

const chainId = parseInt(await rpc("eth_chainId", []), 16);
const block = parseInt(await rpc("eth_blockNumber", []), 16);
check(chainId === 4663, `chain id ${chainId} (block ${block.toLocaleString("en-US")})`);

const assets = (await (await fetch("https://api.robinhood.com/rhj/assets", { headers: { "user-agent": "spare-verify/0.1" } })).json()).assets;
for (const i of configured) {
  const listed = assets.find((a) => a.tokenSymbol === i.symbol);
  const deployment = listed?.deployments.find((d) => d.chainId === 4663);
  check(Boolean(deployment) && deployment.contractAddress.toLowerCase() === i.address.toLowerCase(), `${i.symbol} address matches the issuer's asset list`);
  check(listed?.status === "ASSET_STATUS_ACTIVE", `${i.symbol} is active with the issuer (${listed?.status})`);
  const calls = ["0x06fdde03", "0x95d89b41", "0x313ce567"].map((data) => rpc("eth_call", [{ to: i.address, data }, "latest"]));
  const [name, symbol, decimals] = await Promise.all(calls);
  const matches = text(name) === i.tokenName && text(symbol) === i.symbol && parseInt(decimals, 16) === i.decimals;
  check(matches, `${i.symbol} on chain: "${text(name)}" / ${text(symbol)} / ${parseInt(decimals, 16)} decimals`);
}
process.exit(failed ? 1 : 0);
