"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useWallet } from "@/lib/wallet";

const LINKS = [
  { href: "/app", label: "Overview", short: "Overview" },
  { href: "/app/activity", label: "Activity", short: "Activity" },
  { href: "/app/weekly-review", label: "Weekly review", short: "Review" },
  { href: "/app/holdings", label: "Holdings", short: "Holdings" },
  { href: "/app/settings", label: "Settings", short: "Settings" },
];

export function AppNav({ attention }: { attention: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-ice/95 backdrop-blur md:static md:border-0 md:bg-transparent md:backdrop-blur-none">
      <ul className="mx-auto flex max-w-xl justify-around px-1 md:max-w-none md:justify-start md:gap-1 md:px-0">
        {LINKS.map((l) => {
          const current = l.href === "/app" ? pathname === "/app" : pathname.startsWith(l.href);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={current ? "page" : undefined}
                className={`relative flex min-h-14 items-center px-1.5 text-[0.8rem] font-medium md:min-h-10 md:rounded-full md:px-4 md:text-[0.95rem] ${
                  current ? "text-cobalt md:bg-cobalt md:text-ice" : "text-muted hover:text-cobalt"
                }`}
              >
                <span className="md:hidden">{l.short}</span>
                <span className="hidden md:inline">{l.label}</span>
                {l.href === "/app/weekly-review" && attention && <span className="ml-1.5 size-2 rounded-full bg-orange" aria-label="needs your attention" />}
                {current && <span aria-hidden className="absolute inset-x-1.5 top-0 h-0.5 bg-orange md:hidden" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * A session belongs to one wallet. If the wallet switches account or
 * disconnects, the session ends instead of quietly carrying on as someone else.
 */
export function WalletWatcher({ sessionAddress }: { sessionAddress: string }) {
  const { address } = useWallet();
  const router = useRouter();
  useEffect(() => {
    if (!address || address === sessionAddress) return;
    fetch("/api/auth/me", { method: "DELETE" }).finally(() => {
      router.push("/?signin=1");
      router.refresh();
    });
  }, [address, sessionAddress, router]);
  return null;
}
