import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/app/forms";
import { Notice } from "@/components/app/ui";
import { CHAIN, ISSUER } from "@/config/network";
import { POLICY } from "@/config/policy";
import { instrumentOptions, onboardingState, ONBOARDING_STEPS, type OnboardingKey } from "@/core/accounts";
import { formatUsd } from "@/core/money";
import {
  acknowledgeApprovalAction,
  activateAction,
  attestEligibilityAction,
  chooseInstrumentAction,
  connectAction,
  setCapAction,
} from "@/server/actions";
import { getRuntime } from "@/server/runtime";
import { requireUser } from "@/server/session";

export default async function Onboarding({ searchParams }: PageProps<"/app/onboarding">) {
  const user = await requireUser();
  const { db, resolve } = await getRuntime();
  const state = await onboardingState(db, user.id);
  const params = await searchParams;
  if (state.complete && !params.step) redirect("/app");

  // A finished step can be reopened from the list; an unfinished later step cannot be jumped to.
  const requested = ONBOARDING_STEPS.find((s) => s.key === params.step)?.key;
  const step: OnboardingKey = requested && (state.done[requested] || requested === state.current) ? requested : (state.current ?? "activate");
  const index = ONBOARDING_STEPS.findIndex((s) => s.key === step);
  const adapters = resolve(user.env);
  const demo = user.env === "demo";
  const next = state.current && state.current !== step ? <Link href="/app/onboarding" className="btn btn-solid">Continue setup</Link> : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[17rem_1fr] lg:gap-16">
      <aside className="min-w-0">
        <p className="eyebrow">Setup</p>
        <ol className="mt-4 flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
          {ONBOARDING_STEPS.map((s, i) => {
            const isDone = state.done[s.key];
            const isCurrent = s.key === step;
            const body = (
              <span className={`flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-[0.95rem] ${isCurrent ? "bg-surface font-semibold ring-1 ring-cobalt" : isDone ? "text-cobalt" : "text-muted"}`}>
                <span className={`num grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${isDone ? "bg-cobalt text-ice" : "border border-line"}`}>
                  {isDone ? "✓" : i + 1}
                </span>
                {s.title}
                {isCurrent && <span aria-hidden className="ml-auto hidden size-2 rounded-full bg-orange lg:block" />}
              </span>
            );
            return (
              <li key={s.key} aria-current={isCurrent ? "step" : undefined}>
                {isDone && !isCurrent ? <Link href={`/app/onboarding?step=${s.key}`}>{body}</Link> : body}
              </li>
            );
          })}
        </ol>
      </aside>

      <section className="max-w-2xl" aria-labelledby="step-title">
        <p className="num text-sm font-semibold text-muted">
          Step {index + 1} of {ONBOARDING_STEPS.length}
        </p>

        {step === "wallet" && (
          <>
            <Title>{demo ? "You are in the demo." : "Your wallet is signed in."}</Title>
            <Lead>
              {demo
                ? "A demo account has no wallet and no real provider. Everything you do here is simulated and kept apart from live accounts."
                : `You proved you own ${user.walletAddress} by signing a message on ${CHAIN.name}. That signature approved no payment and no token spending.`}
            </Lead>
            <div className="mt-6">{next}</div>
          </>
        )}

        {step === "eligibility" && (
          <>
            <Title>Can you hold these tokens?</Title>
            <Lead>
              Stock tokens are issued by {ISSUER.name}. The issuer does not offer them to US persons or US residents, or to residents of some other jurisdictions.{" "}
              <a href={ISSUER.restrictionsUrl} target="_blank" rel="noreferrer" className="link">
                See the issuer&apos;s restricted list
              </a>
              .
            </Lead>
            {demo && <DemoNote>In the demo this is practice. Nothing is checked or stored about you beyond this account.</DemoNote>}
            <ActionForm action={attestEligibilityAction} className="mt-6" quiet>
              <label className="flex cursor-pointer gap-3 rounded-2xl border border-line bg-surface p-4">
                <input type="checkbox" name="confirm" defaultChecked={state.done.eligibility} className="mt-1 size-5 accent-[#103b76]" />
                <span>I am not a US person or US resident, and I do not live in a jurisdiction the issuer restricts. I understand a stock token is not a share and carries no shareholder rights.</span>
              </label>
              <div className="mt-5 flex flex-wrap gap-3">
                <SubmitButton>{state.done.eligibility ? "Confirm again" : "Confirm and continue"}</SubmitButton>
                {state.done.eligibility && next}
              </div>
            </ActionForm>
          </>
        )}

        {step === "company" && (
          <>
            <Title>Pick a company.</Title>
            <Lead>Each week&apos;s round-ups buy this one stock token. You can change it later; the change only applies to weeks that have not closed.</Lead>
            <ActionForm action={chooseInstrumentAction} className="mt-6" quiet>
              <fieldset>
                <legend className="sr-only">Company</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {instrumentOptions(resolve, user.env).map((i) => (
                    <label
                      key={i.symbol}
                      className={`relative flex items-baseline gap-4 rounded-2xl border-[1.5px] border-line bg-surface p-4 transition-colors has-[:checked]:border-cobalt has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-orange ${
                        i.selectable ? "cursor-pointer hover:border-sky" : "cursor-not-allowed opacity-60"
                      }`}
                    >
                      <input type="radio" name="symbol" value={i.symbol} disabled={!i.selectable} defaultChecked={state.prefs.instrumentSymbol === i.symbol} className="peer sr-only" />
                      <span className="display text-[2rem]">{i.symbol}</span>
                      <span>
                        <span className="block font-medium">{i.company}</span>
                        <span className="block text-sm text-muted">{i.selectable ? "Stock token" : "Not available yet"}</span>
                      </span>
                      <span aria-hidden className="absolute right-4 top-4 hidden size-3 rounded-full bg-orange peer-checked:block" />
                    </label>
                  ))}
                </div>
              </fieldset>
              {!adapters.execution.availability().available && (
                <div className="mt-5">
                  <Notice tone="warn" title="Live buying is not connected yet">
                    {adapters.execution.availability().reason} Until then no company can be selected and setup stops here. The demo shows the rest of the flow with simulated data.
                  </Notice>
                </div>
              )}
              <p className="mt-4 text-sm text-muted">Tickers name the underlying security. These companies are not partners or sponsors of SPARE.</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <SubmitButton disabled={!adapters.execution.availability().available}>Save company</SubmitButton>
                {state.done.company && next}
              </div>
            </ActionForm>
          </>
        )}

        {step === "transactions" && (
          <>
            <Title>Let SPARE see your purchases.</Title>
            <Lead>
              This is a read-only connection to your purchase history. It lets SPARE calculate round-ups. It cannot move money, and it is separate from your wallet and from your funding method.
            </Lead>
            <ConnectStep
              kind="transaction_source"
              connected={state.transactionSource?.label ?? null}
              provider={adapters.transactions.label}
              availability={adapters.transactions.availability()}
              demo={demo}
              demoNote="The demo card is simulated. Its example purchases appear once tracking is on."
              next={next}
            />
          </>
        )}

        {step === "funding" && (
          <>
            <Title>Choose where round-ups are paid from.</Title>
            <Lead>
              Connecting a funding method collects nothing. Money is only collected after you approve a closed week, and only the amount shown on that approval. Each approval names the amount, the destination and the purpose.
            </Lead>
            <ConnectStep
              kind="funding"
              connected={state.fundingMethod?.label ?? null}
              provider={adapters.funding.label}
              availability={adapters.funding.availability()}
              demo={demo}
              demoNote="The demo balance is simulated. No real money exists in it."
              next={next}
            />
          </>
        )}

        {step === "cap" && (
          <>
            <Title>Set a weekly cap.</Title>
            <Lead>The cap is the most your round-ups can add up to in one week. A round-up that would go past it is left out entirely. It is not postponed to another week.</Lead>
            <ActionForm action={setCapAction} className="mt-6" quiet>
              <label htmlFor="cap" className="block text-sm font-semibold">
                Weekly cap, in dollars
              </label>
              <div className="relative mt-2 max-w-xs">
                <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted">
                  $
                </span>
                <input id="cap" name="cap" inputMode="decimal" required defaultValue={(state.prefs.weeklyCapCents / 100).toFixed(2)} aria-describedby="cap-help" className="field num pl-8" />
              </div>
              <p id="cap-help" className="mt-2 text-sm text-muted">
                Between {formatUsd(POLICY.minWeeklyCapCents)} and {formatUsd(POLICY.maxWeeklyCapCents)}.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <SubmitButton>{state.done.cap ? "Update cap" : "Save cap"}</SubmitButton>
                {state.done.cap && next}
              </div>
            </ActionForm>
          </>
        )}

        {step === "approval" && (
          <>
            <Title>How the weekly approval works.</Title>
            <ol className="mt-6 space-y-4 text-[1.05rem]">
              {[
                ["Sunday night, your week closes.", `In your timezone (${user.timezone}). Purchases that arrive later go into the next week.`],
                ["You get one fixed amount to review.", "Every counted purchase, the total, any fee, the company and the funding method."],
                ["You approve it, or skip it.", `If you do nothing for ${Math.round(POLICY.approvalWindowHours / 24)} days it expires and nothing is charged.`],
                ["After approval the amount cannot change.", "It is collected once, used to buy your stock token, and the tokens are delivered to your wallet. You can follow each stage."],
                ["Small weeks roll over.", `A week under ${formatUsd(POLICY.minOrderCents)} is too small to invest. Its round-ups carry into the next week instead.`],
              ].map(([title, body], i) => (
                <li key={title} className="flex gap-4">
                  <span className="num mt-0.5 text-sm font-bold text-muted">0{i + 1}</span>
                  <span>
                    <span className="block font-semibold">{title}</span>
                    <span className="block text-muted">{body}</span>
                  </span>
                </li>
              ))}
            </ol>
            <ActionForm action={acknowledgeApprovalAction} className="mt-7" quiet>
              <div className="flex flex-wrap gap-3">
                <SubmitButton>I understand</SubmitButton>
                {state.done.approval && next}
              </div>
            </ActionForm>
          </>
        )}

        {step === "activate" && (
          <>
            <Title>{state.done.activate ? "Tracking is on." : "Ready to start tracking."}</Title>
            <dl className="mt-6 divide-y divide-line border-y border-line text-[1.05rem]">
              <Summary label="Company">{state.prefs.instrumentSymbol}</Summary>
              <Summary label="Purchase data">{state.transactionSource?.label}</Summary>
              <Summary label="Funding method">{state.fundingMethod?.label}</Summary>
              <Summary label="Weekly cap">{formatUsd(state.prefs.weeklyCapCents)}</Summary>
              <Summary label="Week closes">Sunday night, {user.timezone}</Summary>
            </dl>
            <p className="mt-5 text-muted">Only purchases that post after you start are counted. Starting collects nothing.</p>
            {state.done.activate ? (
              <Link href="/app" className="btn btn-primary mt-6">
                Go to your overview
              </Link>
            ) : (
              <ActionForm action={activateAction} className="mt-6" quiet>
                <SubmitButton className="btn btn-primary btn-hero" pendingLabel="Starting…">
                  Start tracking
                </SubmitButton>
              </ActionForm>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <h1 id="step-title" className="display mt-2 text-[2.3rem] sm:text-[3rem]">
      {children}
    </h1>
  );
}

function Lead({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 text-[1.1rem] leading-relaxed text-muted">{children}</p>;
}

function DemoNote({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 text-sm font-medium text-muted">{children}</p>;
}

function Summary({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-6 py-3.5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{children ?? "—"}</dd>
    </div>
  );
}

function ConnectStep({
  kind,
  connected,
  provider,
  availability,
  demo,
  demoNote,
  next,
}: {
  kind: "transaction_source" | "funding";
  connected: string | null;
  provider: string;
  availability: { available: boolean; reason?: string };
  demo: boolean;
  demoNote: string;
  next: React.ReactNode;
}) {
  if (connected) {
    return (
      <div className="mt-6">
        <div className="card flex items-center justify-between gap-4 p-4">
          <span>
            <span className="block font-semibold">{connected}</span>
            <span className="block text-sm text-muted">Connected. You can disconnect it in Settings.</span>
          </span>
          <span className="pill text-cobalt">Connected</span>
        </div>
        <div className="mt-5">{next}</div>
      </div>
    );
  }
  if (!availability.available) {
    return (
      <div className="mt-6">
        <Notice tone="warn" title="Not connected on this deployment">
          {availability.reason} Setup stops here for live accounts. Nothing is simulated in its place.
        </Notice>
      </div>
    );
  }
  return (
    <ActionForm action={connectAction} hidden={{ kind }} className="mt-6" quiet>
      <div className="card p-4">
        <p className="font-semibold">{provider}</p>
        {demo && <p className="mt-1 text-sm text-muted">{demoNote}</p>}
      </div>
      <div className="mt-5">
        <SubmitButton pendingLabel="Connecting…">{kind === "funding" ? "Connect funding method" : "Connect purchase data"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
