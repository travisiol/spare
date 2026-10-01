import Link from "next/link";
import { redirect } from "next/navigation";
import { DemoControls } from "@/components/app/DemoControls";
import { ActionForm, AutoRefresh, SubmitButton } from "@/components/app/forms";
import { PurchaseList } from "@/components/app/PurchaseList";
import { Card, EmptyState, formatDateTime, StatusPill } from "@/components/app/ui";
import { instrumentBySymbol } from "@/config/instruments";
import { onboardingState } from "@/core/accounts";
import { formatTokenQty, formatUsd } from "@/core/money";
import { getOverview } from "@/core/queries";
import { formatWeekRange } from "@/core/weeks";
import { BATCH_STATUS } from "@/lib/status";
import { setPausedAction } from "@/server/actions";
import { getRuntime } from "@/server/runtime";
import { requireUser } from "@/server/session";

export default async function Overview() {
  const user = await requireUser();
  const { db, resolve } = await getRuntime();
  if (!(await onboardingState(db, user.id)).complete) redirect("/app/onboarding");
  const o = await getOverview(db, resolve, user, new Date());
  const instrument = instrumentBySymbol(o.prefs.instrumentSymbol);
  const capUsed = Math.min(100, Math.round(((o.capCents - o.capRemainingCents) / o.capCents) * 100));
  const latest = o.attention ?? o.inFlight ?? o.latestClosed;

  return (
    <div className="space-y-6">
      <AutoRefresh active={Boolean(o.inFlight)} />
      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        {/* This week */}
        <Card className="flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="eyebrow">This week&apos;s tracked round-ups</h1>
            <span className="text-sm text-muted">{formatWeekRange(o.weekStart)}</span>
          </div>
          <p className="num mt-3 text-[4.2rem] font-bold leading-none tracking-[-0.04em] text-orange sm:text-[5.5rem]">{formatUsd(o.trackedCents)}</p>
          <p className="mt-3 text-muted">
            {o.trackedCount === 0
              ? "No eligible purchases yet this week."
              : `From ${o.trackedCount} ${o.trackedCount === 1 ? "purchase" : "purchases"}${o.carriedCents > 0 ? `, including ${formatUsd(o.carriedCents)} carried over` : ""}.`}{" "}
            Tracked, not charged: nothing is collected until you approve the week.
          </p>
          {o.pendingCount > 0 && (
            <p className="mt-1 text-sm text-muted">
              {o.pendingCount} pending {o.pendingCount === 1 ? "purchase is" : "purchases are"} waiting to post and not counted yet.
            </p>
          )}

          <div className="mt-auto pt-7">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">Weekly cap {formatUsd(o.capCents)}</span>
              <span className="num text-muted">{formatUsd(o.capRemainingCents)} left</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Weekly cap used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={capUsed}>
              <div className="h-full rounded-full bg-cobalt" style={{ width: `${capUsed}%` }} />
            </div>
          </div>
        </Card>

        {/* Next action */}
        <section className="flex flex-col rounded-[1.375rem] bg-navy p-5 text-ice sm:p-6" aria-labelledby="next-action">
          <h2 id="next-action" className="text-[0.8125rem] font-semibold uppercase tracking-[0.08em] text-sky">
            Next step
          </h2>
          <NextAction o={o} timezone={user.timezone} />
        </section>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <h2 className="eyebrow">Company</h2>
          <p className="display mt-2 text-[2.4rem]">{o.prefs.instrumentSymbol}</p>
          <p className="text-muted">{instrument?.company}</p>
          <Link href="/app/settings#company" className="link mt-3 inline-block text-sm font-medium">
            Change for future weeks
          </Link>
        </Card>
        <Card>
          <h2 className="eyebrow">Next approval</h2>
          <p className="mt-2 text-[1.35rem] font-semibold leading-tight">{formatDateTime(o.nextCutoff, user.timezone)}</p>
          <p className="mt-1 text-sm text-muted">When this week closes. You review it after that.</p>
        </Card>
        <Card>
          <h2 className="eyebrow">Purchase data</h2>
          <p className="mt-2 font-semibold">{o.transactionSource?.label ?? "Not connected"}</p>
          <div className="mt-2">
            {o.prefs.paused ? <StatusPill tone="warn">Paused</StatusPill> : o.transactionSource ? <StatusPill tone="good">Connected</StatusPill> : <StatusPill tone="warn">Disconnected</StatusPill>}
          </div>
          <p className="mt-2 text-sm text-muted">Funding: {o.fundingMethod?.label ?? "not connected"}</p>
        </Card>
        <Card>
          <h2 className="eyebrow">Latest weekly batch</h2>
          {latest ? (
            <>
              <p className="mt-2 font-semibold">{formatWeekRange(latest.weekStart)}</p>
              <div className="mt-2">
                <StatusPill tone={BATCH_STATUS[latest.status].tone}>{BATCH_STATUS[latest.status].label}</StatusPill>
              </div>
              <Link href={`/app/weekly-review?batch=${latest.id}`} className="link mt-3 inline-block text-sm font-medium">
                Open
              </Link>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">No week has closed yet. Your first review comes after Sunday night.</p>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[1.25rem] font-semibold">Recent purchases</h2>
            <Link href="/app/activity" className="link text-sm font-medium">
              All activity
            </Link>
          </div>
          {o.recent.length > 0 ? (
            <div className="mt-2">
              <PurchaseList items={o.recent} timezone={user.timezone} />
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState title="No purchases yet">Purchases from your connected source will appear here as they post. Only purchases made after you started tracking are counted.</EmptyState>
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[1.25rem] font-semibold">Settled holdings</h2>
            <Link href="/app/holdings" className="link text-sm font-medium">
              Details
            </Link>
          </div>
          {o.holdings.some((h) => h.settledQty > 0n) ? (
            <ul className="mt-3 divide-y divide-line">
              {o.holdings
                .filter((h) => h.settledQty > 0n)
                .map((h) => (
                  <li key={h.symbol} className="flex items-baseline justify-between gap-4 py-3">
                    <span className="display text-[1.6rem]">{h.symbol}</span>
                    <span className="num text-right">
                      <span className="block font-semibold">{formatTokenQty(h.settledQty, h.decimals)} tokens</span>
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <div className="mt-4">
              <EmptyState title="Nothing delivered yet">Tokens appear here only after a week has been approved, funded, bought and delivered.</EmptyState>
            </div>
          )}
        </Card>
      </div>

      {user.env === "demo" && <DemoControls flags={o.prefs.demoFlags} canClose={Boolean(o.tracking)} />}
    </div>
  );
}

type OverviewData = Awaited<ReturnType<typeof getOverview>>;

function NextAction({ o, timezone }: { o: OverviewData; timezone: string }) {
  const big = "display mt-3 text-[2rem] leading-[1.02] sm:text-[2.5rem]";
  const body = "mt-3 text-sky";
  if (o.attention) {
    const b = o.attention;
    const copy =
      b.status === "ready_for_approval"
        ? { title: `Review ${formatUsd(b.authorizedCents ?? 0)} for ${b.instrumentSymbol}.`, text: `The week of ${formatWeekRange(b.weekStart)} is closed. Approve it or skip it by ${b.approveBy ? formatDateTime(b.approveBy, timezone) : "the deadline"}. Nothing has been charged.`, cta: "Review the week" }
        : b.status === "funding_failed"
          ? { title: "The charge did not go through.", text: "Nothing was collected. You can try the same approved amount again.", cta: "See what happened" }
          : { title: "The order was not filled.", text: "Your funds are held and were not spent. Try the order again or take a refund.", cta: "Choose what to do" };
    return (
      <>
        <p className={big}>{copy.title}</p>
        <p className={body}>{copy.text}</p>
        <Link href={`/app/weekly-review?batch=${b.id}`} className="btn btn-primary mt-auto self-start">
          {copy.cta}
        </Link>
      </>
    );
  }
  if (o.inFlight) {
    return (
      <>
        <p className={big}>{BATCH_STATUS[o.inFlight.status].label}.</p>
        <p className={body}>{BATCH_STATUS[o.inFlight.status].detail}</p>
        <Link href={`/app/weekly-review?batch=${o.inFlight.id}`} className="btn mt-auto self-start border-[1.5px] border-ice text-ice hover:bg-ice/10">
          Follow progress
        </Link>
      </>
    );
  }
  if (o.prefs.paused) {
    return (
      <>
        <p className={big}>Tracking is paused.</p>
        <p className={body}>Purchases made while paused do not round up.</p>
        <ActionForm action={setPausedAction} hidden={{ paused: "0" }} className="mt-auto" quiet>
          <SubmitButton>Resume tracking</SubmitButton>
        </ActionForm>
      </>
    );
  }
  if (!o.transactionSource || !o.fundingMethod) {
    return (
      <>
        <p className={big}>{!o.transactionSource ? "Reconnect your purchase data." : "Reconnect a funding method."}</p>
        <p className={body}>{!o.transactionSource ? "Without it, no purchases can be counted." : "Without it, a closed week cannot be approved."}</p>
        <Link href="/app/settings#connections" className="btn btn-primary mt-auto self-start">
          Open connections
        </Link>
      </>
    );
  }
  return (
    <>
      <p className={big}>Nothing to do. Pay like always.</p>
      <p className={body}>This week closes {formatDateTime(o.nextCutoff, timezone)}. You will review it after that.</p>
    </>
  );
}
