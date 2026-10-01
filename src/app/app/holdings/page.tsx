import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, EmptyState, PageTitle, StatusPill } from "@/components/app/ui";
import { CHAIN, ISSUER } from "@/config/network";
import { instrumentBySymbol } from "@/config/instruments";
import { onboardingState } from "@/core/accounts";
import { destinationFor } from "@/core/batches";
import { formatTokenQty, formatUsd } from "@/core/money";
import { getHoldings, listBatches } from "@/core/queries";
import { formatWeekRange } from "@/core/weeks";
import { BATCH_STATUS } from "@/lib/status";
import { getRuntime } from "@/server/runtime";
import { requireUser } from "@/server/session";

export default async function Holdings() {
  const user = await requireUser();
  const { db, resolve } = await getRuntime();
  if (!(await onboardingState(db, user.id)).complete) redirect("/app/onboarding");
  const [holdings, batches] = await Promise.all([getHoldings(db, resolve, user), listBatches(db, user.id)]);
  const settled = holdings.filter((h) => h.settledQty > 0n);
  const pending = holdings.filter((h) => h.pendingQty > 0n);
  const delivered = batches.filter((b) => b.status === "completed");
  const demo = user.env === "demo";

  return (
    <>
      <PageTitle title="Holdings">Tokens SPARE has bought for you and delivered to {destinationFor(user)}. Nothing is listed until it has actually been delivered.</PageTitle>

      {settled.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2">
          {settled.map((h) => (
            <Card key={h.symbol}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="display text-[2.8rem]">{h.symbol}</p>
                  <p className="text-muted">{h.company}</p>
                </div>
                <StatusPill tone="good">Settled</StatusPill>
              </div>
              <p className="num mt-5 text-[2rem] font-bold leading-none tracking-[-0.02em]">{formatTokenQty(h.settledQty, h.decimals, 8)}</p>
              <p className="text-sm text-muted">tokens</p>
              {h.price && h.valueCents !== null ? (
                <p className="mt-4 text-[0.95rem] text-muted">
                  <span className="num font-semibold text-cobalt">≈ {formatUsd(h.valueCents)}</span> at ${h.price.price} per token.
                  <span className="block text-sm">
                    {h.price.source}, as of {h.price.asOf.toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC.
                  </span>
                </p>
              ) : (
                <p className="mt-4 text-sm text-muted">No price source is available right now, so no value is shown.</p>
              )}
              {!demo && instrumentBySymbol(h.symbol) && (
                <a href={`${CHAIN.explorerUrl}/token/${instrumentBySymbol(h.symbol)!.address}`} target="_blank" rel="noreferrer" className="link mt-3 inline-block text-sm font-medium">
                  Token contract on the explorer
                </a>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No settled holdings yet">Tokens appear here after a week has been approved, funded, bought and delivered to your wallet. Until then there is nothing to show, and nothing is estimated.</EmptyState>
      )}

      {pending.length > 0 && (
        <section className="mt-10" aria-labelledby="pending">
          <h2 id="pending" className="text-[1.25rem] font-semibold">
            Bought, not yet delivered
          </h2>
          <p className="text-[0.95rem] text-muted">These orders have filled but the tokens have not reached your wallet. They are not counted as holdings yet.</p>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {pending.map((h) => (
              <li key={h.symbol} className="flex items-baseline justify-between py-3.5">
                <span className="font-semibold">{h.symbol}</span>
                <span className="num">{formatTokenQty(h.pendingQty, h.decimals, 8)} tokens</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {delivered.length > 0 && (
        <section className="mt-10" aria-labelledby="deliveries">
          <h2 id="deliveries" className="text-[1.25rem] font-semibold">
            Delivered weeks
          </h2>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {delivered.map((b) => (
              <li key={b.id}>
                <Link href={`/app/weekly-review?batch=${b.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3.5 hover:bg-surface">
                  <span>{formatWeekRange(b.weekStart)}</span>
                  <span className="flex items-center gap-4">
                    <span className="num text-muted">
                      {formatUsd(b.totalCents ?? 0)} → {b.instrumentSymbol}
                    </span>
                    <StatusPill tone={BATCH_STATUS[b.status].tone}>{BATCH_STATUS[b.status].label}</StatusPill>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-10 max-w-2xl text-sm leading-relaxed text-muted">
        {demo ? "Demo holdings are simulated and exist only in this demo account. " : ""}
        Stock tokens are issued by {ISSUER.name}. They track a share&apos;s price but are not shares and carry no shareholder rights. SPARE shows no performance figures: a value appears only next to the timestamped price it was computed
        from.
      </p>
    </>
  );
}
