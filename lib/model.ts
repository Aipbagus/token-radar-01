// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks EVERY rankable pre-token protocol in the snapshot (198 of 758 here) — the
// watchlist is the floor, never the ceiling. A protocol is pre-token when its snapshot record
// carries no token (no market cap, no CoinGecko id, no symbol). The snapshot's live-token
// protocols are kept apart: they are the comparables, shown at the market's own values, never
// mixed into the ranked board.
//
// IMPLIED VALUE (radar-3, "fitted size curve", backtested):
//
//   1. The live protocols give the size curve: the market pays a smaller multiple for a bigger
//      TVL, and the relation is straight in logs. Ordinary least squares on
//          log10(mcap / TVL) = a + b * log10(TVL)
//      over every live protocol with a positive market cap, winsorized (residuals clamped to
//      median +/- 2.5 * 1.4826 * MAD, then refitted to convergence) so a few wild tokens cannot
//      set the slope. This snapshot fits a = 2.6396, b = -0.4233 on 128 live protocols, 6 of them
//      winsorized.
//   2. multiple = 10^(a + b * log10(TVL))  — the market's own Mc/TVL for a protocol of this size.
//   3. window   = 0.92 + 0.18 * exp(-((age_days - 180) / 260)^2) — a peak at 180 days (old enough
//      for real usage, young enough to launch soon), decaying to 0.92; an unlisted age scores 1.00.
//   4. implied  = max(1, round(TVL * multiple * window))
//
//   The seven-day growth multiplier of radar-2 was backtested and DROPPED: leave-one-out median
//   |dlog10| error was 0.539 without it and 0.548-0.568 with it on every setting tried — momentum
//   in one week does not predict a launch multiple on this snapshot. What remains beats the
//   category-median baseline: LOO median error x3.46 (0.539 dlog10) vs x5.07 (0.705) for ranking
//   every row at the all-live median multiple; a seeded random half-split confirms it out of
//   sample (0.533 vs 0.652). The dashboard states the metric and the curve.
//
// No protocol name is ever special-cased: the same function scores every row, and the dashboard
// recomputes each row from the same figures so the page and board.json cannot disagree.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  winsor_k: number;
  window_base: number;
  window_peak: number;
  window_width_days: number;
  window_center_days: number;
}

export const MODEL: ModelConstants = {
  winsor_k: 2.5,
  window_base: 0.92,
  window_peak: 0.18,
  window_width_days: 260,
  window_center_days: 180,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  watchlisted: boolean;
  implied_value_usd: number;
  model: {
    curve_multiple: number;
    window_mult: number;
    age_days: number | null;
    net_cost_low: number;
    net_cost_high: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlisted: boolean;
  implied_value_usd: number;
  curve_multiple: number;
  window_mult: number;
  net_cost_low: number;
  net_cost_high: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** The fitted size curve and the backtest numbers the dashboard publishes. */
export interface CurveFit {
  intercept: number;
  slope: number;
  live_n: number;
  winsorized_n: number;
  loo_median_dlog10: number;
  loo_p90_dlog10: number;
  loo_median_factor: number;
  baseline_median_dlog10: number;
  split_median_dlog10: number;
  split_baseline_dlog10: number;
  split_seed: number;
}

/** Everything the dashboard needs: the board, the live set, the curve and the backtest. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  curve: CurveFit;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  categories: { key: string; live_n: number; median_mc_tvl: number }[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a list of numbers, or `fallback` when it is empty. */
function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const s = values.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** OLS on the log-log points: [a, b] for log10(y) = a + b * log10(x). */
function ols(points: { x: number; y: number }[]): { a: number; b: number } {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const sxy = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const sxx = points.reduce((s, p) => s + (p.x - mx) * (p.x - mx), 0);
  const b = sxx > 0 ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}

/** One round of winsorization: clamp residual outliers, refit. Returns the clamped point list. */
function winsorRound(points: { x: number; y: number }[], k: number): { pts: { x: number; y: number }[]; a: number; b: number; clamped: number } {
  const { a, b } = ols(points);
  const res = points.map((p) => p.y - (a + b * p.x));
  const med = median(res, 0);
  const mad = median(res.map((r) => Math.abs(r - med)), 0) || 1e-9;
  const lo = med - k * 1.4826 * mad;
  const hi = med + k * 1.4826 * mad;
  let clamped = 0;
  const pts = points.map((p, i) => {
    const r = res[i]!;
    if (r >= lo && r <= hi) return p;
    clamped++;
    return { x: p.x, y: r > hi ? hi + (a + b * p.x) : lo + (a + b * p.x) };
  });
  return { pts, a, b, clamped };
}

/** The winsorized size-curve fit, iterated to convergence. */
export function fitCurve(live: SnapshotProtocol[], model: ModelConstants = MODEL): { a: number; b: number; n: number; clamped: number; points: { x: number; y: number }[] } {
  const all = live
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({ x: Math.log10(p.tvl_usd), y: Math.log10(p.mcap_usd! / p.tvl_usd) }));
  let pts = all;
  let clamped = 0;
  let fit = ols(pts);
  for (let i = 0; i < 10; i++) {
    const round = winsorRound(pts, model.winsor_k);
    if (Math.abs(round.a - fit.a) < 1e-9 && Math.abs(round.b - fit.b) < 1e-9) break;
    pts = round.pts;
    clamped = round.clamped;
    fit = ols(pts);
  }
  return { a: fit.a, b: fit.b, n: all.length, clamped, points: all };
}

/** Leave-one-out backtest of the full pipeline (curve + window) over the live protocols. */
function looBacktest(live: SnapshotProtocol[], asOf: string, model: ModelConstants): { median: number; p90: number; baseline: number; errs: number[] } {
  const points = live
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({ p, x: Math.log10(p.tvl_usd), y: Math.log10(p.mcap_usd! / p.tvl_usd) }));
  const errs: number[] = [];
  const baseErrs: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const rest = points.filter((_, j) => j !== i).map(({ x, y }) => ({ x, y }));
    const { a, b } = winsorizedFit(rest, model);
    const p = points[i]!.p;
    const age = ageDays(asOf, p.listed_at);
    const windowMult = age === null ? 1.0 : model.window_base + model.window_peak * Math.exp(-Math.pow((age - model.window_center_days) / model.window_width_days, 2));
    const predLog = a + b * points[i]!.x + Math.log10(windowMult);
    errs.push(Math.abs(predLog - points[i]!.y));
    baseErrs.push(Math.abs(median(points.filter((_, j) => j !== i).map((q) => q.y), points[i]!.y) - points[i]!.y));
  }
  const s = errs.slice().sort((x, y) => x - y);
  return { median: median(errs, 0), p90: s[Math.floor(0.9 * (s.length - 1))]!, baseline: median(baseErrs, 0), errs };
}

/** Winsorized fit on an arbitrary point list (used by the backtests). */
function winsorizedFit(points: { x: number; y: number }[], model: ModelConstants): { a: number; b: number } {
  let pts = points;
  let fit = ols(pts);
  for (let i = 0; i < 10; i++) {
    const round = winsorRound(pts, model.winsor_k);
    if (Math.abs(round.a - fit.a) < 1e-9 && Math.abs(round.b - fit.b) < 1e-9) break;
    pts = round.pts;
    fit = ols(pts);
  }
  return fit;
}

/** A deterministic seeded random half-split: train the curve on half, test on the other half. */
function splitBacktest(points: { p: SnapshotProtocol; x: number; y: number }[], asOf: string, model: ModelConstants, seed: number): { median: number; baseline: number } {
  // xorshift so the split is reproducible run to run: no Math.random anywhere.
  let s = seed >>> 0;
  const rand = (): number => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
  const idx = points.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  const half = Math.floor(idx.length / 2);
  const train = idx.slice(0, half).map((i) => points[i]!);
  const test = idx.slice(half).map((i) => points[i]!);
  const { a, b } = winsorizedFit(train.map(({ x, y }) => ({ x, y })), model);
  const trainMedianY = median(train.map((p) => p.y), 0);
  const errs = test.map(({ p, x, y }) => {
    const age = ageDays(asOf, p.listed_at);
    const windowMult = age === null ? 1.0 : model.window_base + model.window_peak * Math.exp(-Math.pow((age - model.window_center_days) / model.window_width_days, 2));
    return Math.abs(a + b * x + Math.log10(windowMult) - y);
  });
  const baseErrs = test.map(({ y }) => Math.abs(trainMedianY - y));
  return { median: median(errs, 0), baseline: median(baseErrs, 0) };
}

/** The full backtest record: fitted curve plus out-of-sample metrics. */
export function backtestCurve(snapshot: Snapshot, model: ModelConstants = MODEL): CurveFit & { a: number; b: number; clamped: number } {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null);
  const fit = fitCurve(live, model);
  const loo = looBacktest(live, snapshot.as_of, model);
  const points = live
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({ p, x: Math.log10(p.tvl_usd), y: Math.log10(p.mcap_usd! / p.tvl_usd) }));
  const split = splitBacktest(points, snapshot.as_of, model, 7);
  return {
    a: fit.a,
    b: fit.b,
    clamped: fit.clamped,
    intercept: round4(fit.a),
    slope: round4(fit.b),
    live_n: fit.n,
    winsorized_n: fit.clamped,
    loo_median_dlog10: round4(loo.median),
    loo_p90_dlog10: round4(loo.p90),
    loo_median_factor: Math.round(Math.pow(10, loo.median) * 100) / 100,
    baseline_median_dlog10: round4(loo.baseline),
    split_median_dlog10: round4(split.median),
    split_baseline_dlog10: round4(split.baseline),
    split_seed: 7,
  };
}

/** The launch-window multiplier from the protocol's age with no token. */
export function windowMult(age: number | null, model: ModelConstants = MODEL): number {
  if (age === null) return 1.0;
  return model.window_base + model.window_peak * Math.exp(-Math.pow((age - model.window_center_days) / model.window_width_days, 2));
}

const UNCATEGORISED = '(uncategorised)';

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/

/** The categories the house watchlist rule leaves out: these are wrappers and bridges of live tokens. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** An exchange's name prefix: its products are the exchange's own books, not a farm. */
const EXCHANGE_PREFIXES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];

/**
 * Whether a protocol is one the board may rank: pre-token, and it passes the same rule that built
 * the house watchlist — no wrapper/staking product of a trading token, no exchange product, no
 * versioned pool of another protocol. Applied to every pre-token protocol, watchlist or not.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  const words = new Set((p.name.toLowerCase().match(/[a-z]+/g) ?? []));
  if (words.has('wrapped') || words.has('staked') || words.has('staking')) return false;
  const low = p.name.toLowerCase();
  for (const e of EXCHANGE_PREFIXES) {
    if (low === e || low.startsWith(e + ' ') || low.startsWith(e + '-')) return false;
  }
  if (VERSIONED.test(p.name)) return false;
  return true;
}

/** The protocols the board ranks, strongest first, with ranks 1..n: EVERY rankable pre-token protocol. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, fit: { a: number; b: number } | null = null): BoardRow[] {
  const curve = fit ?? backtestCurve(snapshot, model);
  const chosen = snapshot.protocols.filter((p) => isRankable(p));
  const scored = chosen.map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const mult = Math.pow(10, curve.a + curve.b * Math.log10(Math.max(1, p.tvl_usd)));
    const wm = windowMult(age, model);
    const implied = Math.max(1, Math.round(p.tvl_usd * round4(mult) * round4(wm)));
    return { p, age, mult, wm, implied };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const plan = farmPlan(s.p, s.age, snapshot.as_of);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      age_days: s.age,
      watchlisted: snapshot.watchlist.includes(s.p.slug),
      implied_value_usd: s.implied,
      model: {
        curve_multiple: round4(s.mult),
        window_mult: round4(s.wm),
        age_days: s.age,
        net_cost_low: plan.netLow,
        net_cost_high: plan.netHigh,
      },
      farm_steps: plan.steps.map(stepText),
    };
  });
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Position size from the protocol's own TVL: enough to matter, small next to the pool's depth. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** Typical gas for one action on a chain, in dollars: the snapshot's chain names drive it. */
function gasFor(p: SnapshotProtocol): number {
  const chain = (p.chains[0] ?? '').toLowerCase();
  if (chain === 'ethereum') return 8;
  if (['base', 'arbitrum', 'optimism', 'polygon', 'zksync', 'blast', 'linea', 'scroll', 'mantle', 'unichain'].some((c) => chain.includes(c))) return 0.5;
  if (chain.includes('solana')) return 0.05;
  return 2;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** Weeks of weekly touches in the hold window, at the plan's low and high cadence. */
function touchWeeks(hold: number): { low: number; high: number } {
  return { low: Math.max(2, Math.floor(hold / 7) - 2), high: Math.max(4, Math.floor(hold / 7)) };
}

function usd(n: number): string {
  return `$${n >= 1 ? n.toFixed(0) : n.toFixed(2)}`;
}

/** The category's core action, in the words a farmer can follow, with the amount named. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const cap = usd(capital);
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply ${cap} of USDC into ${name}'s lending market on ${chain}, then borrow 40% of it in the deepest borrow asset and keep both sides open with the loan-to-value under 50%.`;
  if (c.includes('dex') || c.includes('yield aggregator') || c.includes('leveraged farm')) return `Deposit ${cap} into ${name}'s largest pool on ${chain} — the pair with the deepest TVL — and leave the fees to compound.`;
  if (c.includes('yield')) return `Deposit ${cap} into the highest-yielding pool ${name} lists on ${chain}, and check the source of that yield before you deposit.`;
  if (c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('restak')) return `Stake ${cap} of the chain's native asset through ${name} on ${chain} and hold the receipt token untouched for the whole window.`;
  if (c.includes('canonical bridge') || c.includes('bridge')) return `Bridge ${cap} of USDC to ${chain} through ${name}, then make one swap on the far side so the usage is on record.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis')) return `Deposit ${cap} as margin on ${name}, open one 1-2x position on its deepest market, and keep the funding cost under 0.05% a day.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit ${cap} into a ${name} vault on ${chain} and leave the shares untouched for the whole window.`;
  if (c.includes('stable')) return `Mint or deposit ${cap} of the stable asset through ${name} on ${chain} and hold it there.`;
  if (c.includes('rwa')) return `Mint ${cap} of ${name}'s yield asset on ${chain} and hold it for the full window.`;
  if (c.includes('insurance')) return `Buy ${cap} of cover on ${name}'s largest market on ${chain} and keep the policy to expiry.`;
  if (c.includes('chain') || c.includes('layer')) return `Bridge ${cap} onto ${chain} through ${name}'s official bridge, then make one swap and one mint on its native dapps.`;
  if (c.includes('payment')) return `Route ${cap} of payments through ${name} on ${chain} in several weekly batches rather than one transfer.`;
  return `Deposit ${cap} of USDC into ${name} on ${chain} and keep the position open for the whole window.`;
}

/** The window's end date, in the snapshot's own calendar. */
function holdEndDate(asOf: string, days: number): string {
  const t = Date.parse(`${asOf}T00:00:00Z`) + days * DAY_MS;
  if (!Number.isFinite(t)) return `day ${days}`;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * A protocol's farm plan: seven steps, each an action with a dollar cost and a time, derived from
 * the protocol's own record (category, chains, TVL, age) and the snapshot's date. The costs are
 * netted: `netLow`/`netHigh` are the whole plan's real dollars out of pocket — capital recovered at
 * exit, so the net is the weekly touches plus gas, minus any yield the position pays along the way.
 * No name is special-cased.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null, asOf: string): { steps: FarmStep[]; netLow: number; netHigh: number } {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const gas = gasFor(p);
  const hold = holdDaysFor(age);
  const end = holdEndDate(asOf, hold);
  const gasStr = gas >= 1 ? `$${Math.round(gas)}` : `$${gas.toFixed(2)}`;
  const exitGas = Math.max(1, Math.round(gas * 3));
  const weeks = touchWeeks(hold);
  // Net cost band, to the dollar: capital comes back at unwind, so what is spent is the weekly
  // touches (low: every other week $10, high: every week $20), every gas fee on the way in and out,
  // and the borrow/funding drip when the core action opens a leveraged side (about 0.01% of capital
  // a day while held). Yield earned is credited at the low end only, at a conservative 3% APY on
  // the capital for the hold's fraction of a year — the band's floor can be positive net cost.
  const touchesLow = weeks.low * 10;
  const touchesHigh = weeks.high * 20;
  const gasIn = Math.round(gas * 2);
  const funding = (p.category ?? '').toLowerCase().match(/perpetual|derivative|basis/) ? Math.round(capital * 0.0001 * hold) : 0;
  const yieldLow = Math.round((capital * 0.03 * hold) / 365);
  const netLow = Math.max(0, touchesLow + gasIn + exitGas + funding - yieldLow);
  const netHigh = touchesHigh + gasIn + exitGas + funding;
  const netStr = `net cost $${netLow}-$${netHigh}`;
  const steps: FarmStep[] = [
    {
      text: `Set up a dedicated wallet for this farm, funded only with the position's capital plus gas, and write its seed phrase on paper, never in a file.`,
      cost: `position ${usd(capital)} + ${gasStr} first gas on ${chain}`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `${usd(capital)} of capital (recovered at unwind), ${gasStr} of gas`,
      time: '15-30 minutes to set up',
    },
    {
      text: `Add one more touch every week: a $10-20 deposit top-up, a small swap, or a vote, so the address shows activity in several weekly snapshots.`,
      cost: `$10-20 a week (${usd(touchesLow)}-${usd(touchesHigh)} over the window) plus about ${gasStr} of gas`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position to ${end} (${hold} days) without withdrawing, so the address spans at least one monthly user snapshot.`,
      cost: funding > 0 ? `${usd(capital)} locked plus about ${usd(funding)} of funding drip` : `${usd(capital)} stays locked in the position`,
      time: `${hold} days`,
    },
    {
      text: `Keep a farm log as you go: wallet address, dates, amounts and tx hashes, so any future claim form takes minutes, not archaeology.`,
      cost: 'nothing but the log',
      time: '5 minutes to start, 2 minutes a week',
    },
    {
      text: `Before withdrawing, check ${p.name}'s own site for a points or rewards program and claim only from links it publishes; never sign a claim from a DM or an ad.`,
      cost: 'no fee, and never pay anyone to claim',
      time: '15 minutes',
    },
    {
      text: `Unwind after the window: withdraw the principal, swap any receipt back, and bridge home — expect 2 to 4 transactions at about ${gasStr} each. Plan total: ${netStr} after the capital comes back${funding > 0 ? '' : ' and any yield earned is credited against it'}.`,
      cost: `about ${usd(exitGas)} of exit gas; plan netted ${netStr}`,
      time: '30 minutes',
    },
  ];
  return { steps, netLow, netHigh };
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlisted: row.watchlisted,
    implied_value_usd: row.implied_value_usd,
    curve_multiple: row.model.curve_multiple,
    window_mult: row.model.window_mult,
    net_cost_low: row.model.net_cost_low,
    net_cost_high: row.model.net_cost_high,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const curve = backtestCurve(snapshot, model);
  const board = buildBoard(snapshot, model, curve);
  const live = liveRows(snapshot);
  const perCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const key = p.category ?? UNCATEGORISED;
    const bucket = perCat.get(key) ?? [];
    bucket.push(p.mcap_usd / p.tvl_usd);
    perCat.set(key, bucket);
  }
  const categories = [...perCat.entries()]
    .map(([key, r]) => ({ key, live_n: r.length, median_mc_tvl: round4(median(r, 0)) }))
    .sort((a, b) => a.key < b.key ? -1 : 1);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    curve: {
      intercept: curve.intercept,
      slope: curve.slope,
      live_n: curve.live_n,
      winsorized_n: curve.winsorized_n,
      loo_median_dlog10: curve.loo_median_dlog10,
      loo_p90_dlog10: curve.loo_p90_dlog10,
      loo_median_factor: curve.loo_median_factor,
      baseline_median_dlog10: curve.baseline_median_dlog10,
      split_median_dlog10: curve.split_median_dlog10,
      split_baseline_dlog10: curve.split_baseline_dlog10,
      split_seed: curve.split_seed,
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    categories,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, the gate takes 100 to 4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

// keep the lint-only imports referenced: finite is used by parseSnapshot's callers.
void finite;
