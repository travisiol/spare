# Provider configuration

SPARE talks to the outside world through five adapters, defined in `src/core/adapters/types.ts`. Demo accounts get the simulated set (`demo.ts`); live accounts get the live set (`live.ts`). A live adapter that is not configured reports `available: false` with a reason, and every action that depends on it is disabled in the interface and refused on the server. Nothing falls back to a simulation.

| Adapter | Live status | What it needs |
| --- | --- | --- |
| Wallet authentication | **Working** | `SPARE_APP_DOMAIN` in production |
| Prices | **Working** | Nothing (public issuer API) |
| Transaction data | **Endpoint working, no provider linked** | `SPARE_TXN_WEBHOOK_SECRET` + a data provider + an account-linking flow |
| Funding | **Not connected** | A payment processor or collection contract + an adapter |
| Execution | **Not connected** | A reviewed trading route + an adapter |
| Settlement | **Not connected** | Follows from execution |

## Verified facts (2026-10-01)

- **Network.** Robinhood Chain, chain id 4663, RPC `https://rpc.mainnet.chain.robinhood.com`, explorer `https://robinhoodchain.blockscout.com` (official docs; chain id confirmed with `eth_chainId`).
- **Instruments.** AAPL, TSLA, NFLX and NVDA token addresses come from the issuer's asset list (`GET https://api.robinhood.com/rhj/assets`) and were read back on chain (`name`, `symbol`, `decimals`) at block 77,604,356. `npm run verify:instruments` repeats the check.
- **Issuer.** Robinhood Assets (Jersey) Limited. The tokens are tokenised debt securities giving economic exposure only: no legal or beneficial rights in the underlying shares. US persons and residents are excluded; other jurisdictions are restricted (see `https://docs.robinhood.com/rhj`).
- **Corporate actions.** Tokens implement ERC-8056: an on-chain `uiMultiplier()` adjusts for dividends and splits while raw balances stay fixed.
- **No order API.** The issuer's API is read-only (`/assets`, `/prices/{symbol}`, `/corporate-actions`). Minting is restricted to authorized participants. Everyone else acquires tokens on secondary venues; the docs name RFQ aggregators (0x, 1inch Fusion, LI.FI), AMM pools, Rialto and Lighter. No venue contract address is published in the docs, and none is assumed here.

## Wallet authentication

Sign-In with Ethereum (EIP-4361) in `src/core/auth.ts`. The server issues a nonce (10 minutes, single use, claimed atomically), the wallet signs a message bound to the site's domain, origin and chain id 4663, and the server verifies it: EOA signatures locally, contract wallets through ERC-1271 on the RPC (`SPARE_RPC_URL`). Sessions are random tokens stored hashed, in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production), valid 7 days and revocable. Sign-in asks for no token approval.

Set `SPARE_APP_DOMAIN` to the public host in production. Without it the server refuses to start a sign-in, because the domain check would depend on a client-supplied header.

## Prices

`issuerPrices()` reads `GET /rhj/prices/{symbol}` and uses the midpoint of `tokenBid` / `tokenAsk`, which already include the multiplier, with the API's `generatedAt` timestamp. A halted or missing quote returns `null`, and the interface then shows no estimate and no value. The API is cached for 15 seconds and limited to 60 requests per second upstream; add a cache before serving many users.

## Transaction data

`POST /api/webhooks/transactions/webhook`, enabled when `SPARE_TXN_WEBHOOK_SECRET` is set.

```
x-spare-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
```

```json
{
  "id": "evt_123",
  "type": "transaction.posted",
  "occurred_at": "2026-10-01T12:00:00Z",
  "account_id": "<the connection's external_ref>",
  "transaction": {
    "id": "txn_456",
    "pending_id": "auth_789",
    "merchant": "Harbor Coffee",
    "amount_minor": 463,
    "currency": "USD",
    "category": "purchase",
    "authorized_at": "2026-10-01T11:58:00Z",
    "posted_at": "2026-10-01T12:00:00Z"
  }
}
```

Types: `transaction.pending`, `.posted`, `.refunded`, `.reversed`, `.removed`. `category` must be `purchase` for a round-up; anything else (`transfer`, `fee`, `funding`, `investment`, `income`, …) is recorded and excluded. `amount_minor` is an integer in the currency's minor unit. Signatures older than 5 minutes are refused. Duplicate and stale events return 200 with `outcome: "duplicate" | "stale"` so the provider stops retrying.

**Still to build for live use:** an account-linking flow. A real provider (Plaid, a card issuer, an open-banking aggregator) has its own consent screen that returns an account reference; `TransactionSourceAdapter.connect()` must run that flow and return the reference, which becomes `connections.external_ref`. Until then `connect()` throws for live accounts and onboarding stops at that step. Map the provider's categories to the list above and its event ids to `id`.

## Funding

Implement `FundingAdapter` (`connect`, `collect`, `refund`, `get`) and return it from `liveAdapters()`.

- `connect` sets up a mandate or method and collects nothing.
- `collect` is called once per approved batch with an idempotency key (`fund:<batchId>:<n>`), the exact authorized amount and the approval statement as the purpose. It must be idempotent on that key.
- `get(key)` must return the provider's view of that key, or `null` if it never saw it. The pipeline calls it before every submission and whenever an outcome is unknown.
- Collected funds are client money. Keep them in an account separated from operating funds under the provider's safeguarding arrangement; the ledger accounts `clearing:funds_held` and `user:funds` mirror it.

Candidates: a card/ACH processor with idempotency keys, or an on-chain design where the user approves and transfers a stablecoin for the exact batch amount to a collection contract. Either needs its own compliance review.

## Execution and settlement

Implement `ExecutionAdapter` (`supports`, `placeOrder`, `get`) and `SettlementAdapter` (`deliver`, `get`).

- `supports(symbol)` must be true only for instruments the route can actually buy; the company picker and the approval both depend on it.
- `placeOrder` buys `notionalCents` of the token; `get` returns the fill quantity (token base units) and price.
- `deliver` sends the tokens to the user's wallet; its `providerRef` should be the transaction hash, and "settled" should mean the transfer is confirmed on chain (monitor the receipt and confirmations).

A generic token swap is not automatically a supported or compliant way to buy these securities for customers. Before enabling a route, confirm with the venue that it lists the instrument, with counsel that SPARE may arrange such purchases for its users in each jurisdiction served, and with the issuer's terms that those users may hold the tokens.

## Background work

The job queue is the `jobs` table. One process must run it:

- default: inside the web process (`src/server/runtime.ts`), once a second;
- `SPARE_INLINE_WORKER=0` + `npm run worker` for a separate worker on PostgreSQL;
- or a cron calling `POST /api/internal/tick` with `Authorization: Bearer $CRON_SECRET`.

Jobs are leased for 60 seconds, retried with backoff, and marked `dead` after 6 failures, where they appear in the admin area.
