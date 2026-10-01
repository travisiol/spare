import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/app/forms";
import { Card, Notice, PageTitle, StatusPill } from "@/components/app/ui";
import { CHAIN } from "@/config/network";
import { POLICY } from "@/config/policy";
import { instrumentOptions, onboardingState } from "@/core/accounts";
import { formatUsd } from "@/core/money";
import {
  chooseInstrumentAction,
  closeAccountAction,
  connectAction,
  disconnectAction,
  setCapAction,
  setPausedAction,
  setTimezoneAction,
} from "@/server/actions";
import { getRuntime } from "@/server/runtime";
import { requireUser } from "@/server/session";

export default async function Settings() {
  const user = await requireUser();
  const { db, resolve } = await getRuntime();
  const state = await onboardingState(db, user.id);
  if (!state.complete) redirect("/app/onboarding");
  const adapters = resolve(user.env);
  const demo = user.env === "demo";
  const timezones = Intl.supportedValuesOf("timeZone");

  return (
    <>
      <PageTitle title="Settings">Change how SPARE works for you. Nothing here sells holdings or alters a week you already approved.</PageTitle>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="scroll-mt-24">
          <h2 id="company" className="text-[1.25rem] font-semibold">
            Company for future weeks
          </h2>
          <p className="mt-1 text-[0.95rem] text-muted">Applies to weeks that have not closed yet. Existing holdings stay as they are; closed and approved weeks keep the company they closed with.</p>
          <ActionForm action={chooseInstrumentAction} className="mt-4">
            <fieldset className="grid grid-cols-2 gap-2">
              <legend className="sr-only">Company</legend>
              {instrumentOptions(resolve, user.env).map((i) => (
                <label
                  key={i.symbol}
                  className={`relative rounded-xl border-[1.5px] border-line bg-white/60 px-3.5 py-3 has-[:checked]:border-cobalt has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-orange ${i.selectable ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                >
                  <input type="radio" name="symbol" value={i.symbol} disabled={!i.selectable} defaultChecked={state.prefs.instrumentSymbol === i.symbol} className="peer sr-only" />
                  <span className="display block text-[1.5rem]">{i.symbol}</span>
                  <span className="block text-sm text-muted">{i.selectable ? i.company : "Not available yet"}</span>
                  <span aria-hidden className="absolute right-3 top-3 hidden size-2.5 rounded-full bg-orange peer-checked:block" />
                </label>
              ))}
            </fieldset>
            <div className="mt-4">
              <SubmitButton className="btn btn-solid">Save company</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card>
          <h2 className="text-[1.25rem] font-semibold">Weekly cap</h2>
          <p className="mt-1 text-[0.95rem] text-muted">
            The most one week&apos;s round-ups can add up to. A round-up that would pass the cap is left out. A new cap applies to purchases from now on.
          </p>
          <ActionForm action={setCapAction} className="mt-4">
            <label htmlFor="cap" className="block text-sm font-semibold">
              Cap in dollars ({formatUsd(POLICY.minWeeklyCapCents)} to {formatUsd(POLICY.maxWeeklyCapCents)})
            </label>
            <div className="mt-2 flex gap-3">
              <div className="relative flex-1">
                <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted">
                  $
                </span>
                <input id="cap" name="cap" inputMode="decimal" required defaultValue={(state.prefs.weeklyCapCents / 100).toFixed(2)} className="field num pl-8" />
              </div>
              <SubmitButton className="btn btn-solid h-[3.375rem]">Save</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-[1.25rem] font-semibold">Tracking</h2>
            {state.prefs.paused ? <StatusPill tone="warn">Paused</StatusPill> : <StatusPill tone="good">On</StatusPill>}
          </div>
          <p className="mt-1 text-[0.95rem] text-muted">
            {state.prefs.paused
              ? "Purchases are still listed in Activity but none of them round up. Purchases made while paused stay excluded after you resume."
              : "Eligible purchases round up into the current week. Pausing stops that immediately."}
          </p>
          <ActionForm action={setPausedAction} hidden={{ paused: state.prefs.paused ? "0" : "1" }} className="mt-4">
            <SubmitButton className={state.prefs.paused ? "btn btn-primary" : "btn btn-outline"}>{state.prefs.paused ? "Resume tracking" : "Pause tracking"}</SubmitButton>
          </ActionForm>
        </Card>

        <Card>
          <h2 className="text-[1.25rem] font-semibold">Timezone</h2>
          <p className="mt-1 text-[0.95rem] text-muted">Your week closes Sunday night in this timezone. A change applies from the next week that opens; a week already open keeps its cutoff.</p>
          <ActionForm action={setTimezoneAction} className="mt-4 flex flex-wrap gap-3">
            <label htmlFor="timezone" className="sr-only">
              Timezone
            </label>
            <select id="timezone" name="timezone" defaultValue={user.timezone} className="field min-w-0 flex-1">
              {!timezones.includes(user.timezone) && <option value={user.timezone}>{user.timezone}</option>}
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <SubmitButton className="btn btn-solid h-[3.375rem]">Save</SubmitButton>
          </ActionForm>
        </Card>

        <Card className="lg:col-span-2">
          <h2 id="connections" className="scroll-mt-24 text-[1.25rem] font-semibold">
            Connections
          </h2>
          <p className="mt-1 max-w-2xl text-[0.95rem] text-muted">Two separate permissions. Purchase data is read-only and can never move money. The funding method is only charged after you approve a specific week.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Connection
              title="Purchase data"
              kind="transaction_source"
              connection={state.transactionSource}
              availability={adapters.transactions.availability()}
              offNote="No purchases are counted while this is disconnected."
            />
            <Connection
              title="Funding method"
              kind="funding"
              connection={state.fundingMethod}
              availability={adapters.funding.availability()}
              offNote="A closed week cannot be approved while this is disconnected."
            />
          </div>
        </Card>

        <Card>
          <h2 className="text-[1.25rem] font-semibold">Wallet</h2>
          {demo ? (
            <p className="mt-1 text-[0.95rem] text-muted">Demo accounts have no wallet. Simulated tokens are &ldquo;delivered&rdquo; to a demo wallet that exists only in this account.</p>
          ) : (
            <dl className="mt-3 space-y-2 text-[0.95rem]">
              <div>
                <dt className="text-muted">Address (sign-in and delivery)</dt>
                <dd className="break-all font-mono text-sm">{user.walletAddress}</dd>
              </div>
              <div>
                <dt className="text-muted">Network</dt>
                <dd>
                  {CHAIN.name} (chain {CHAIN.id})
                </dd>
              </div>
              <div>
                <dt className="text-muted">Spending permissions held by SPARE</dt>
                <dd>None. Signing in never grants any.</dd>
              </div>
            </dl>
          )}
        </Card>

        <Card>
          <h2 className="text-[1.25rem] font-semibold">Privacy and account</h2>
          <p className="mt-1 text-[0.95rem] text-muted">
            SPARE stores your {demo ? "demo account" : "wallet address"}, timezone, connections, the purchases your data source reports, and your approvals. It does not sell or share them.
          </p>
          <details className="mt-4">
            <summary className="link cursor-pointer font-medium">Close this account</summary>
            <p className="mt-2 text-[0.95rem] text-muted">
              Closing pauses tracking, disconnects both connections and signs you out everywhere. Records of approved weeks are kept, as financial records must be. Tokens already delivered stay in your wallet.
            </p>
            <ActionForm action={closeAccountAction} className="mt-3">
              <SubmitButton className="btn btn-outline">Close account</SubmitButton>
            </ActionForm>
          </details>
        </Card>
      </div>
    </>
  );
}

function Connection({
  title,
  kind,
  connection,
  availability,
  offNote,
}: {
  title: string;
  kind: "transaction_source" | "funding";
  connection: { id: string; label: string; createdAt: Date } | null;
  availability: { available: boolean; reason?: string };
  offNote: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-white/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{title}</h3>
        {connection ? <StatusPill tone="good">Connected</StatusPill> : <StatusPill tone="warn">Not connected</StatusPill>}
      </div>
      {connection ? (
        <>
          <p className="mt-1 text-[0.95rem] text-muted">{connection.label}</p>
          <ActionForm action={disconnectAction} hidden={{ connectionId: connection.id }} className="mt-3">
            <SubmitButton className="btn btn-outline">Disconnect</SubmitButton>
          </ActionForm>
        </>
      ) : availability.available ? (
        <>
          <p className="mt-1 text-[0.95rem] text-muted">{offNote}</p>
          <ActionForm action={connectAction} hidden={{ kind }} className="mt-3">
            <SubmitButton className="btn btn-solid">Connect</SubmitButton>
          </ActionForm>
        </>
      ) : (
        <div className="mt-3">
          <Notice tone="warn">{availability.reason}</Notice>
        </div>
      )}
    </div>
  );
}
