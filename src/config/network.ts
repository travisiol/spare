/**
 * Network configuration. Nothing here is guessed.
 *
 * - Chain ID, RPC and explorer: official Robinhood Chain docs
 *   (https://docs.robinhood.com/chain/connecting). The chain ID was also read
 *   from the RPC with eth_chainId (4663) on 2026-10-01.
 * - `npm run verify:instruments` re-checks every configured token against the
 *   issuer's asset list and the chain itself.
 */
export const CHAIN = {
  id: 4663,
  name: "Robinhood Chain",
  rpcUrl: process.env.SPARE_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
  explorerUrl: "https://robinhoodchain.blockscout.com",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
} as const;

/** Issuer facts, from https://docs.robinhood.com/chain/stock-tokens/ (read 2026-10-01). */
export const ISSUER = {
  name: "Robinhood Assets (Jersey) Limited",
  docsUrl: "https://docs.robinhood.com/chain/stock-tokens/",
  restrictionsUrl: "https://docs.robinhood.com/rhj",
  /** Read-only issuer API (assets, prices, corporate actions). No order endpoint exists. */
  apiBase: "https://api.robinhood.com/rhj",
} as const;
