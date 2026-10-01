import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { AppNav, WalletWatcher } from "@/components/app/AppNav";
import { onboardingState } from "@/core/accounts";
import { listBatches, NEEDS_USER } from "@/core/queries";
import { shortAddress } from "@/lib/wallet-format";
import { signOutAction } from "@/server/actions";
import { getRuntime } from "@/server/runtime";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Your round-ups", robots: { index: false } };

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const user = await requireUser();
  const { db } = await getRuntime();
  const [state, batches] = await Promise.all([onboardingState(db, user.id), listBatches(db, user.id)]);
  const attention = batches.some((b) => NEEDS_USER.includes(b.status));
  const demo = user.env === "demo";

  return (
    <div className="flex min-h-full flex-1 flex-col pb-20 md:pb-0">
      {demo && (
        <p className="bg-cobalt px-4 py-2 text-center text-[0.85rem] font-medium text-ice">
          <span className="mr-2 rounded bg-orange px-1.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wider text-ink">Demo</span>
          Simulated purchases, funding and delivery. No real money, no real tokens.
        </p>
      )}
      <header className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-8">
        <Link href="/" aria-label="SPARE home">
          <Logo className="text-[1.9rem]" />
        </Link>
        {state.complete && <AppNav attention={attention} />}
        <div className="flex items-center gap-3 text-sm">
          <span className="pill num text-muted">{demo ? "Demo account" : shortAddress(user.walletAddress ?? "")}</span>
          <form action={signOutAction}>
            <button type="submit" className="link font-medium">
              {demo ? "Leave demo" : "Sign out"}
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1180px] flex-1 px-5 pb-16 pt-4 sm:px-8">{children}</main>
      {!demo && user.walletAddress && <WalletWatcher sessionAddress={user.walletAddress} />}
    </div>
  );
}
