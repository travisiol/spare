"use client";

import Link from "next/link";
import { useEffect } from "react";
import { openStartDialog, shortAddress } from "@/lib/wallet";

export interface Viewer {
  env: "demo" | "live";
  walletAddress: string | null;
}

/** Header button: "Connect wallet" when signed out, a link to the app when signed in. */
export function HeaderAccountButton({ viewer }: { viewer: Viewer | null }) {
  const className =
    "inline-flex h-11 items-center rounded-full border-[1.5px] border-cobalt px-5 text-[0.95rem] font-medium transition-colors hover:bg-cobalt/5 sm:px-7";
  if (viewer) {
    return (
      <Link href="/app" className={className}>
        {viewer.env === "demo" ? "Open demo" : shortAddress(viewer.walletAddress ?? "")}
      </Link>
    );
  }
  return (
    <button type="button" onClick={openStartDialog} className={className}>
      Connect wallet
    </button>
  );
}

export function StartCta({ viewer, className = "btn btn-primary btn-hero", children = "Start rounding up" }: { viewer: Viewer | null; className?: string; children?: React.ReactNode }) {
  if (viewer) {
    return (
      <Link href="/app" className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={openStartDialog} className={className}>
      {children}
    </button>
  );
}

/** Opens the dialog when a protected page bounced the visitor back with ?signin=1. */
export function OpenOnSignIn({ open }: { open: boolean }) {
  useEffect(() => {
    if (open) openStartDialog();
  }, [open]);
  return null;
}
