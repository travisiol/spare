# What works, what is blocked, what production needs

State on 2026-10-01. Nothing has been deployed and no real funds have moved.

## Working

| Capability | Proof |
| --- | --- |
| Marketing site in the approved blue-and-orange direction, responsive | Screenshots at 1536, 1440 and 390 px (`node scripts/e2e-shots.mjs`) |
| Demo: onboarding, example purchases, weekly close, review, approval, simulated funding / order / delivery, failures, retries, refund | Walked in headless Chrome end to end; also `tests/pipeline.test.ts` |
| Round-up arithmetic in integer cents, exact dollars → $0.00 | `tests/roundups.test.ts` |
| Ingestion: duplicates, out-of-order events, pending → posted, dropped authorizations | `tests/roundups.test.ts` |
| Weekly cap enforced on the server; timezone-aware cutoffs across DST | `tests/roundups.test.ts` |
| Refund before approval updates the batch; after approval it is an adjustment only | both test files |
| Approved batches are immutable; approval bound to the reviewed snapshot | `tests/pipeline.test.ts` |
| No duplicate charge: unique live attempt per batch, reconcile-before-retry, job replay | `tests/pipeline.test.ts` |
| Funding succeeded / order failed: funds held, order retry or full refund | `tests/pipeline.test.ts`, admin walk |
| Settlement tracked separately from execution; pending kept apart from holdings | `tests/pipeline.test.ts` |
| Double-entry ledger and reconciliation report | `tests/pipeline.test.ts`, `/admin` |
| Wallet sign-in (EIP-4361): nonce single-use and expiring, domain and chain binding, replay refused | `tests/pipeline.test.ts` (signed with generated keys) |
| Authorization on every page, action and endpoint; webhook signatures; cron secret | `scripts/verify-api.mjs` (23 checks), `tests/pipeline.test.ts` |
| Demo / live isolation | `tests/pipeline.test.ts` |
| Admin: provider status, ingestion, batches, attempts, exceptions, audit, idempotent retries | Walked in headless Chrome |
| Live price source (issuer API) and instrument verification | `npm run verify:instruments` |

## Blocked for live accounts

A live account can sign in with a wallet, attest eligibility and open settings. It cannot go further, and the interface says why at the step where it stops.

| Blocked | Why | What unblocks it |
| --- | --- | --- |
| Picking a company | No execution route exists, so no instrument is selectable | An `ExecutionAdapter` whose `supports()` is true |
| Connecting purchase data | No data provider or account-linking flow | A provider contract + `TransactionSourceAdapter.connect()`; the signed webhook endpoint is ready |
| Connecting a funding method, approving a week | No funding provider | A `FundingAdapter` and its safeguarding arrangement |
| Buying and delivering tokens | The issuer has no order API; secondary venues need a reviewed integration | Execution + settlement adapters, venue and legal confirmation |

## Not verified

- Sign-in with a real wallet extension in a browser. The server path is tested with generated keys; the EIP-6963 dialog was exercised only up to "no wallet found".
- Contract-wallet (ERC-1271) sign-in: implemented through viem's on-chain verification, not exercised.
- PostgreSQL through `DATABASE_URL`: the same Drizzle schema and SQL run on embedded Postgres (PGlite) in every test and in the demo; a real server has not been connected. `FOR UPDATE SKIP LOCKED` in the job queue only matters with several workers and is untested in that setting.
- The standalone worker (`npm run worker`) and the live issuer price adapter inside the app (no live account reaches a screen that uses it).

## Final asset requirement

`public/hero/dish.webp` (1084 px) and `dish@2x.webp` (2168 px) are the dish extracted from the approved 1536 px mockup: annotations removed, background matched to `#E7EFF5`, edges feathered. The 2× file is an upscale, so it is soft on large or high-density screens. For launch, replace both with a render or photograph of the same object at 3000 px or wider on a flat `#E7EFF5` background, keeping the 1084:418 framing so the annotation lines still meet the rim. The coins in the mockup resemble US quarters; a final asset should use plain, unbranded coins.

## Production requirements

1. PostgreSQL with backups: `DATABASE_URL`. The embedded database is refused in production unless explicitly allowed.
2. `SPARE_APP_DOMAIN`, HTTPS, and a reverse proxy that does not let clients override `Host`.
3. Admin identity: `ADMIN_WALLETS` and/or `ADMIN_TOKEN`; `CRON_SECRET` if a cron drives the worker.
4. One running worker (in-process, standalone, or cron) and monitoring on dead jobs and reconciliation exceptions.
5. Providers: transaction data, funding, execution, settlement (see `PROVIDERS.md`), each with production credentials kept server-side.
6. Legal: who may be offered the product (the issuer excludes US persons and other jurisdictions; self-attestation is recorded but is not KYC), whether arranging these purchases is a regulated activity where SPARE operates, client-money handling, terms and privacy notice.
7. Rate limiting on `/api/auth/*`, `/api/demo/start` and the webhook; a cache in front of the price API.
8. A decision on the demo in production (`SPARE_DEMO_ENABLED=0` to remove it) and a retention policy for demo accounts.
