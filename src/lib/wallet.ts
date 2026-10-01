"use client";

import { useSyncExternalStore } from "react";

/**
 * Wallet discovery (EIP-6963) and the two wallet calls sign-in needs:
 * request accounts, sign a message. No spending permission is ever requested here.
 */

interface Eip1193 {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface DiscoveredWallet {
  id: string;
  name: string;
  icon: string | null;
  provider: Eip1193;
}

export interface WalletState {
  wallets: DiscoveredWallet[];
  /** The wallet's active account. Not a session: the server decides who is signed in. */
  address: string | null;
  dialogOpen: boolean;
}

const REMEMBER_KEY = "spare.wallet";
const SERVER_STATE: WalletState = { wallets: [], address: null, dialogOpen: false };

let state: WalletState = SERVER_STATE;
let active: Eip1193 | null = null;
let started = false;
const listeners = new Set<() => void>();

function set(patch: Partial<WalletState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(REMEMBER_KEY, id);
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // storage unavailable — the connection simply is not remembered
  }
}

function attach(wallet: DiscoveredWallet, address: string) {
  active = wallet.provider;
  set({ address: address.toLowerCase() });
  wallet.provider.on?.("accountsChanged", (accounts) => {
    if (active !== wallet.provider) return;
    const next = (accounts as string[])[0];
    if (next) set({ address: next.toLowerCase() });
    else disconnectWallet();
  });
}

function addWallet(wallet: DiscoveredWallet) {
  if (state.wallets.some((w) => w.id === wallet.id)) return;
  set({ wallets: [...state.wallets, wallet] });
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(REMEMBER_KEY);
  } catch {
    remembered = null;
  }
  if (remembered === wallet.id && !state.address) {
    // Silent restore: eth_accounts never opens a prompt.
    wallet.provider
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        const first = (accounts as string[])[0];
        if (first && !state.address) attach(wallet, first);
      })
      .catch(() => {});
  }
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("eip6963:announceProvider", (event) => {
    const detail = (event as CustomEvent).detail as { info: { uuid: string; name: string; icon?: string; rdns?: string }; provider: Eip1193 };
    if (!detail?.provider || !detail.info) return;
    addWallet({ id: detail.info.rdns || detail.info.uuid, name: detail.info.name, icon: detail.info.icon ?? null, provider: detail.provider });
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  // Older wallets only inject window.ethereum.
  window.setTimeout(() => {
    const legacy = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (legacy && state.wallets.length === 0) addWallet({ id: "injected", name: "Browser wallet", icon: null, provider: legacy });
  }, 400);
}

export function useWallet(): WalletState {
  return useSyncExternalStore(
    (listener) => {
      start();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => SERVER_STATE,
  );
}

export function openStartDialog() {
  start();
  set({ dialogOpen: true });
}

export function closeStartDialog() {
  set({ dialogOpen: false });
}

export async function connectWallet(wallet: DiscoveredWallet): Promise<string> {
  const accounts = (await wallet.provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts[0]) throw new Error("The wallet returned no account.");
  attach(wallet, accounts[0]);
  remember(wallet.id);
  return accounts[0];
}

export function disconnectWallet() {
  active = null;
  remember(null);
  set({ address: null });
}

export function walletErrorMessage(error: unknown): string {
  const code = (error as { code?: number })?.code;
  if (code === 4001) return "Request declined in your wallet.";
  if (code === -32002) return "Your wallet already has a request open. Check it.";
  return (error as { shortMessage?: string; message?: string })?.shortMessage ?? (error as Error)?.message ?? "The wallet request failed.";
}

function toHex(text: string): string {
  return `0x${Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function signMessage(message: string, address: string): Promise<string> {
  if (!active) throw new Error("Connect a wallet first.");
  return (await active.request({ method: "personal_sign", params: [toHex(message), address] })) as string;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
