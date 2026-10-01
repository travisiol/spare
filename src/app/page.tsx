import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Hero } from "@/components/home/Hero";
import { HeaderAccountButton, OpenOnSignIn, StartCta, type Viewer } from "@/components/StartButtons";
import { StartDialog } from "@/components/StartDialog";
import { INSTRUMENTS } from "@/config/instruments";
import { CHAIN, ISSUER } from "@/config/network";
import { POLICY } from "@/config/policy";
import { formatUsd, roundUpCents } from "@/core/money";
import { getRuntime } from "@/server/runtime";
import { currentUser } from "@/server/session";

const EXAMPLE = [
  { what: "Coffee", cents: 463 },
  { what: "Groceries", cents: 3120 },
  { what: "Bus", cents: 275 },
];

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const user = await currentUser();
  const { resolve } = await getRuntime();
  const viewer: Viewer | null = user ? { env: user.env, walletAddress: user.walletAddress } : null;
  const demoEnabled = process.env.SPARE_DEMO_ENABLED !== "0";
  const live = resolve("live");
  const liveReady = live.transactions.availability().available && live.funding.availability().available && live.execution.availability().available;
  const total = EXAMPLE.reduce((sum, e) => sum + roundUpCents(e.cents), 0);

  return (
    <>
      <header className="relative mx-auto flex w-full max-w-[1536px] items-center justify-between px-5 py-5 sm:px-10 lg:px-[62px] lg:py-6">
        <Link href="/" aria-label="SPARE home">
          <Logo className="text-[2.1rem] sm:text-[2.9rem]" />
        </Link>
        <nav aria-label="Main" className="absolute left-1/2 hidden -translate-x-1/2 gap-10 text-[1.05rem] font-medium md:flex">
          <a href="#how" className="hover:text-ink">
            How it works
          </a>
          <a href="#stocks" className="hover:text-ink">
            Stocks
          </a>
        </nav>
        <HeaderAccountButton viewer={viewer} />
      </header>

      <main>
        <Hero viewer={viewer} />

        {/* 1 — How round-ups work */}
        <section id="how" className="mx-auto grid max-w-[1280px] gap-12 px-5 py-20 sm:px-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:py-32">
          <div>
            <p className="eyebrow">How round-ups work</p>
            <h2 className="display mt-4 text-[clamp(2.2rem,4.3vw,3.9rem)]">
              Three purchases.
              <br />
              One dollar <span className="whitespace-nowrap">forty-two.</span>
            </h2>
            <p className="mt-6 max-w-md text-[1.15rem] leading-relaxed text-muted">
              For every eligible purchase, SPARE works out the gap to the next whole dollar. A $5.00 purchase rounds up by nothing. That is the whole formula.
            </p>
            <p className="mt-4 max-w-md text-[1.15rem] leading-relaxed text-muted">
              These amounts are <strong className="font-semibold text-cobalt">tracked, not taken</strong>. No money moves until you approve the week.
            </p>
          </div>

          <div className="self-center">
            <table className="num w-full text-[1.15rem] sm:text-[1.3rem]">
              <caption className="sr-only">Example round-ups for three purchases</caption>
              <thead>
                <tr className="eyebrow border-b border-line text-left">
                  <th scope="col" className="pb-3 font-semibold">
                    Purchase
                  </th>
                  <th scope="col" className="pb-3 text-right font-semibold">
                    Paid
                  </th>
                  <th scope="col" className="pb-3 text-right font-semibold">
                    Round-up
                  </th>
                </tr>
              </thead>
              <tbody>
                {EXAMPLE.map((e) => (
                  <tr key={e.what} className="border-b border-line">
                    <th scope="row" className="py-5 text-left font-medium">
                      {e.what}
                    </th>
                    <td className="py-5 text-right text-muted">{formatUsd(e.cents)}</td>
                    <td className="py-5 text-right font-semibold">+{formatUsd(roundUpCents(e.cents))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="pt-6 text-left font-medium">
                    Tracked this week
                  </th>
                  <td />
                  <td className="pt-6 text-right text-[2.6rem] font-bold leading-none tracking-[-0.03em] text-orange sm:text-[3.4rem]">{formatUsd(total)}</td>
                </tr>
              </tfoot>
            </table>
            <p className="mt-6 text-sm text-muted">
              Illustration only. Only settled {POLICY.currency} purchases count. Transfers, fees, refunds and anything over your weekly cap are left out, and the app tells you why.
            </p>
          </div>
        </section>

        {/* 2 — Company selection */}
        <section id="stocks" className="bg-navy text-ice">
          <div className="mx-auto max-w-[1280px] px-5 py-20 sm:px-10 lg:py-28">
            <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-end">
              <h2 className="display text-[clamp(2.2rem,4.3vw,3.9rem)]">
                Pick one company.
                <br />
                Change it any week.
              </h2>
              <p className="text-[1.1rem] leading-relaxed text-sky">
                Your weekly round-ups buy one tokenized stock on {CHAIN.name}. Switching companies only affects future weeks. It never sells what you already hold.
              </p>
            </div>

            <ul className="mt-14 border-t border-ice/20">
              {INSTRUMENTS.map((i) => (
                <li key={i.symbol} className="grid grid-cols-[auto_1fr] items-baseline gap-x-6 border-b border-ice/20 py-5 sm:grid-cols-[11rem_1fr_auto] sm:py-6">
                  <span className="display text-[2.6rem] sm:text-[3.6rem]">{i.symbol}</span>
                  <span className="text-[1.2rem] sm:text-[1.5rem]">{i.company}</span>
                  <span className="col-span-2 mt-1 font-mono text-xs text-sky sm:col-span-1 sm:mt-0">
                    {i.address.slice(0, 10)}…{i.address.slice(-6)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-10 grid gap-6 text-[0.95rem] leading-relaxed text-sky md:grid-cols-3">
              <p>
                <strong className="font-semibold text-ice">What you would hold.</strong> Stock tokens are tokenised debt securities issued by {ISSUER.name}. They give economic exposure to the share price. They do not make you a
                shareholder: no voting rights and no legal claim on the company.
              </p>
              <p>
                <strong className="font-semibold text-ice">Who can hold them.</strong> The issuer excludes US persons and residents of several other jurisdictions.{" "}
                <a href={ISSUER.docsUrl} target="_blank" rel="noreferrer" className="link text-ice">
                  Read the issuer&apos;s terms
                </a>
                .
              </p>
              <p>
                <strong className="font-semibold text-ice">No endorsement.</strong> Tickers name the underlying security. The companies are not partners or sponsors of SPARE. A company is only selectable when a supported way to buy
                its token exists.
              </p>
            </div>
          </div>
        </section>

        {/* 3 — Weekly approval */}
        <section className="mx-auto max-w-[1280px] px-5 py-20 sm:px-10 lg:py-32">
          <p className="eyebrow">Weekly approval</p>
          <h2 className="display mt-4 max-w-4xl text-[clamp(2.2rem,4.3vw,3.9rem)]">Nothing moves until you say so.</h2>
          <p className="mt-6 max-w-2xl text-[1.15rem] leading-relaxed text-muted">
            Each week closes on Sunday night in your timezone. You then see every purchase that was counted, the exact total and any fees, and you decide. Approve it, or skip the week. Either is one tap.
          </p>

          <ol className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ["Tracked", "Round-ups add up during the week. It is a running count, not a balance."],
              ["You review", "The week locks. Later purchases wait for next week. You see one fixed amount."],
              ["Funded", "After you approve, that exact amount is collected once from your funding method."],
              ["Bought", "The amount buys your chosen stock token. You see the price it actually got."],
              ["Delivered", "The tokens arrive in your wallet. Only then do they count as holdings."],
            ].map(([title, body], i) => (
              <li key={title} className={`border-t-2 pt-5 ${i === 1 ? "border-orange" : "border-cobalt"}`}>
                <span className="num text-sm font-bold text-muted">0{i + 1}</span>
                <h3 className="mt-2 text-[1.35rem] font-semibold">{title}</h3>
                <p className="mt-2 text-[0.98rem] leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-10 max-w-2xl text-[0.98rem] leading-relaxed text-muted">
            Approval is not payment, payment is not purchase, and purchase is not delivery. If a step fails, the app shows where it stopped. The same amount is never collected twice.
          </p>
        </section>

        {/* 4 — Controls */}
        <section className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-[1280px] gap-12 px-5 py-20 sm:px-10 lg:grid-cols-[0.9fr_1.1fr] lg:py-28">
            <div>
              <p className="eyebrow">Your controls</p>
              <h2 className="display mt-4 text-[clamp(2.4rem,4.4vw,4rem)]">
                You hold
                <br />
                the off switch.
              </h2>
            </div>
            <dl className="divide-y divide-line border-y border-line text-[1.05rem]">
              {[
                ["Pause", "Stop tracking whenever you like. Purchases made while paused never round up, even after you resume."],
                ["Weekly cap", `Set the most a week can add up to, from ${formatUsd(POLICY.minWeeklyCapCents)} to ${formatUsd(POLICY.maxWeeklyCapCents)}. Round-ups beyond the cap are left out, not postponed.`],
                ["Change company", "Pick a different stock for future weeks. Existing holdings and approved weeks are untouched."],
                ["Disconnect", "Remove your purchase data source or funding method at any time. They are separate permissions and you can drop either one."],
              ].map(([term, description]) => (
                <div key={term} className="grid gap-2 py-6 sm:grid-cols-[11rem_1fr]">
                  <dt className="text-[1.3rem] font-semibold">{term}</dt>
                  <dd className="leading-relaxed text-muted">{description}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* 5 — FAQ */}
        <section className="mx-auto max-w-[900px] px-5 py-20 sm:px-10 lg:py-28">
          <h2 className="display text-[clamp(2.4rem,4.4vw,4rem)]">Questions, answered plainly.</h2>
          <div className="mt-10 divide-y divide-line border-y border-line">
            <Faq q="Does connecting my wallet let SPARE see my purchases?">
              No. A wallet is your identity here and the place your tokens are delivered. Seeing card or bank purchases needs a separate, read-only connection to a transaction data provider, and collecting money needs a third, separate
              funding method. Granting one never grants another.
            </Faq>
            <Faq q="Is my tracked total money that SPARE is holding?">
              No. It is a count of round-ups from your eligible purchases. Nothing has been collected. Money only moves after you approve a closed week, and then only the amount you approved.
            </Faq>
            <Faq q="Which payments count?">
              Settled purchases in {POLICY.currency} from your connected source. Pending authorizations are shown but not counted until they post. Transfers, fees, funding movements, stock purchases, refunds and other currencies do not
              count. Every excluded item shows its reason.
            </Faq>
            <Faq q="What does it cost?">
              {POLICY.feeBps === 0 ? "SPARE currently charges no fee on round-ups." : `SPARE charges ${(POLICY.feeBps / 100).toFixed(2)}% of the round-up total.`} Any fee, and any provider or network cost, is shown as its own line on
              the weekly review before you approve. The smallest week that can be invested is {formatUsd(POLICY.minOrderCents)}; a smaller week carries forward into the next one.
            </Faq>
            <Faq q="What if a purchase is refunded?">
              Before you approve, its round-up simply leaves the week. After you approve, the record stays as it happened and the refund is noted as an adjustment. SPARE never sells your stock and never makes an extra charge because of
              a refund.
            </Faq>
            <Faq q="Do I own shares?">
              No. You would hold stock tokens on {CHAIN.name}, issued by {ISSUER.name}. They track the price of the share and adjust for dividends and splits through an on-chain multiplier, but they carry no shareholder rights. Their
              value can fall. This page is not investment advice.
            </Faq>
            <Faq q="Can I use it today?">
              {liveReady
                ? "Yes. Sign in with a wallet to set up your account."
                : "You can sign in with a wallet, and you can walk through the whole product in the demo. Real purchases cannot round up yet: this deployment has no live transaction data, funding or stock execution provider connected, so every live money action is switched off rather than simulated."}
            </Faq>
          </div>
        </section>

        {/* 6 — Final CTA */}
        <section className="bg-navy text-ice">
          <div className="mx-auto flex max-w-[1280px] flex-col items-center px-5 py-20 text-center sm:px-10 lg:py-28">
            <h2 className="display text-[clamp(2.6rem,6.4vw,6rem)] tracking-[-0.05em]">Start with the change.</h2>
            <p className="mt-5 max-w-xl text-[1.15rem] text-sky">A few cents at a time, one approval a week.</p>
            <div className="mt-8">
              <StartCta viewer={viewer} />
            </div>
            {!liveReady && <p className="mt-5 max-w-md text-sm text-sky">Live round-ups are not available yet. The demo shows the complete flow with simulated data.</p>}
          </div>
        </section>
      </main>

      <footer className="bg-ink text-sky">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-5 py-10 text-sm sm:px-10 md:flex-row md:items-start md:justify-between">
          <Logo tone="light" className="text-[1.6rem]" />
          <p className="max-w-2xl leading-relaxed">
            SPARE is not a broker, bank or investment adviser. Stock tokens are issued by {ISSUER.name}, are not available to US persons, and carry no shareholder rights. Tokenized assets can lose value. Company names and tickers
            identify underlying securities only.
          </p>
        </div>
      </footer>

      <StartDialog demoEnabled={demoEnabled} />
      <OpenOnSignIn open={params.signin === "1" && !viewer} />
    </>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group py-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[1.2rem] font-semibold [&::-webkit-details-marker]:hidden">
        {q}
        <svg viewBox="0 0 20 20" aria-hidden className="size-5 shrink-0 transition-transform group-open:rotate-45">
          <path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </summary>
      <p className="mt-3 max-w-2xl text-[1.02rem] leading-relaxed text-muted">{children}</p>
    </details>
  );
}
