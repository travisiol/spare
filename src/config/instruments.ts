/**
 * Instrument catalogue — the single list of stock tokens SPARE knows about.
 *
 * Each address comes from the issuer's official asset list
 * (GET https://api.robinhood.com/rhj/assets) and was re-read on chain with
 * name() / symbol() / decimals() on 2026-10-01 at block 77,604,356.
 *
 * Being listed here does NOT make an instrument selectable. An instrument is
 * selectable for an account only when that account's execution adapter
 * reports a supported route for it (see src/core/adapters).
 *
 * Company names identify the underlying security. The companies are not
 * partners or sponsors of SPARE.
 */
export interface Instrument {
  symbol: string;
  company: string;
  /** name() as returned by the token contract. */
  tokenName: string;
  address: `0x${string}`;
  decimals: number;
  verifiedAtBlock: number;
}

const VERIFIED_AT = 77_604_356;

export const INSTRUMENTS: Instrument[] = [
  {
    symbol: "AAPL",
    company: "Apple",
    tokenName: "Apple • Robinhood Token",
    address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
    decimals: 18,
    verifiedAtBlock: VERIFIED_AT,
  },
  {
    symbol: "TSLA",
    company: "Tesla",
    tokenName: "Tesla • Robinhood Token",
    address: "0x322f0929c4625ed5bad873c95208d54e1c003b2d",
    decimals: 18,
    verifiedAtBlock: VERIFIED_AT,
  },
  {
    symbol: "NFLX",
    company: "Netflix",
    tokenName: "Netflix • Robinhood Token",
    address: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8",
    decimals: 18,
    verifiedAtBlock: VERIFIED_AT,
  },
  {
    symbol: "NVDA",
    company: "NVIDIA",
    tokenName: "NVIDIA • Robinhood Token",
    address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    decimals: 18,
    verifiedAtBlock: VERIFIED_AT,
  },
];

export function instrumentBySymbol(symbol: string | null | undefined): Instrument | undefined {
  return INSTRUMENTS.find((i) => i.symbol === symbol);
}
