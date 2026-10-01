"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CHAIN } from "@/config/network";
import { buildSignInMessage } from "@/lib/signin";
import { closeStartDialog, connectWallet, signMessage, useWallet, walletErrorMessage, type DiscoveredWallet } from "@/lib/wallet";

const timezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
};

/**
 * The one way in: sign in with a wallet (live), or open the labelled demo.
 * Connecting shows an address; only the signature below creates a session.
 */
export function StartDialog({ demoEnabled }: { demoEnabled: boolean }) {
  const { wallets, dialogOpen } = useWallet();
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (dialogOpen && !dialog.open) dialog.showModal();
    if (!dialogOpen && dialog.open) dialog.close();
  }, [dialogOpen]);

  async function signIn(wallet: DiscoveredWallet) {
    setBusy(wallet.id);
    setError(null);
    try {
      const address = await connectWallet(wallet);
      const { nonce } = (await (await fetch("/api/auth/nonce", { method: "POST" })).json()) as { nonce: string };
      const message = buildSignInMessage(address, nonce, window.location);
      const signature = await signMessage(message, address);
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature, timezone: timezone() }),
      });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Sign-in failed.");
      closeStartDialog();
      router.push("/app");
      router.refresh();
    } catch (e) {
      setError(walletErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function startDemo() {
    setBusy("demo");
    setError(null);
    try {
      const res = await fetch("/api/demo/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ timezone: timezone() }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "The demo could not start.");
      closeStartDialog();
      router.push("/app/onboarding");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="start-title"
      onClose={closeStartDialog}
      onClick={(e) => {
        if (e.target === ref.current) closeStartDialog();
      }}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-3xl border border-line bg-ice p-0 text-cobalt shadow-[0_30px_80px_-20px_rgb(11_42_85/0.45)]"
    >
      {dialogOpen && (
        <div className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <h2 id="start-title" className="display text-[2.1rem]">
              Start rounding up
            </h2>
            <button type="button" onClick={closeStartDialog} aria-label="Close" className="-mr-2 -mt-1 grid size-10 place-items-center rounded-full hover:bg-surface">
              <svg viewBox="0 0 20 20" className="size-4" aria-hidden>
                <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <p className="mt-3 text-[0.95rem] text-muted">
            Sign in with a wallet on {CHAIN.name}. You sign one message to prove the wallet is yours. It approves no payment and no token spending.
          </p>

          <ul className="mt-5 space-y-2">
            {wallets.map((w) => (
              <li key={w.id}>
                <button type="button" disabled={busy !== null} onClick={() => signIn(w)} className="btn btn-outline w-full justify-between">
                  <span className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element -- wallet-provided data URI */}
                    {w.icon ? <img src={w.icon} alt="" className="size-6 rounded-md" /> : <span className="size-6 rounded-md bg-line" />}
                    {w.name}
                  </span>
                  <span className="text-sm font-medium text-muted">{busy === w.id ? "Check your wallet…" : "Sign in"}</span>
                </button>
              </li>
            ))}
            {wallets.length === 0 && (
              <li className="rounded-xl border border-dashed border-line px-4 py-3 text-[0.95rem] text-muted">
                No wallet was found in this browser. Install a wallet extension, or open this page in your wallet&apos;s browser.
              </li>
            )}
          </ul>

          {demoEnabled && (
            <div className="mt-6 border-t border-line pt-6">
              <p className="eyebrow">No wallet yet?</p>
              <button type="button" disabled={busy !== null} onClick={startDemo} className="btn btn-primary mt-3 w-full">
                {busy === "demo" ? "Opening the demo…" : "Explore the demo"}
              </button>
              <p className="mt-2 text-sm text-muted">Simulated purchases, simulated funding, no real money. Clearly labelled “Demo” throughout.</p>
            </div>
          )}

          <p role="alert" aria-live="assertive" className="mt-4 min-h-5 text-sm font-medium text-ember">
            {error}
          </p>
        </div>
      )}
    </dialog>
  );
}
