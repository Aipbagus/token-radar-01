// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// strongest pre-token protocols below the watchlist floor. A protocol is pre-token when its snapshot
// record carries no token (no market cap, no CoinGecko id, no symbol); the snapshot's live-token
// protocols are kept apart and shown at the market's own values, never mixed into the ranked board.
//
// IMPLIED VALUE (radar-2, "category evidence"): what the market, on this snapshot's own evidence,
// would pay for a dollar of this protocol's TVL if its record stayed as it is.
//
//   1. category multiple  = the median market cap / TVL of the snapshot's LIVE protocols in the same
//      category, shrunk toward the all-live median with weight 4 (empirical Bayes): fewer live
//      comparables in a category, the more the board leans on the market's overall mcap/TVL.
//   2. base        = tvl_usd x category multiple
//   3. growth      = change_7d; when unreported, the category's own median 7-day change, else 0
//                    growthMult = clamp((1 + growth/100)^4, 0.60, 2.40)   (four weeks of momentum)
//   4. window      = how long it has run with no token: 0.90 + 0.55 x exp(-((age-180)/220)^2)
//                    — a peak at 180 days (old enough for real usage, young enough to launch soon),
//                    decaying to 0.90 by two years; an unlisted age scores a neutral 1.00.
//   5. implied     = max(1, round(base x growthMult x windowMult))
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
  shrink_weight: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_power: number;
  growth_floor: number;
  growth_cap: number;
  window_center_days: number;
  window_width_days: number;
  window_base: number;
  window_peak: number;
}

export const MODEL: ModelConstants = {
  shrink_weight: 4,
  multiple_floor: 0.05,
  multiple_cap: 2.5,
  growth_power: 4,
  growth_floor: 0.6,
  growth_cap: 2.4,
  window_center_days: 180,
  window_width_days: 220,
  window_base: 0.9,
  window_peak: 0.55,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

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
    category_multiple: number;
    evidence_n: number;
    base_usd: number;
    growth_pct: number;
    growth_mult: number;
    window_mult: number;
    age_days: number | null;
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
  category_multiple: number;
  evidence_n: number;
  base_usd: number;
  growth_mult: number;
  window_mult: number;
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

/** What the snapshot's live protocols say about a category: the comparables the model leans on. */
export interface CategoryEvidence {
  key: string;
  live_n: number;
  median_mc_tvl: number;
  median_growth: number;
}

/** Everything the dashboard needs: the board, the live set, the evidence and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_mc_tvl: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  categories: CategoryEvidence[];
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

const UNCATEGORISED = '(uncategorised)';

/** Live comparables a category needs before its own median is used as evidence. */
const MIN_COMPARABLES = 5;

/** The snapshot's live protocols' market evidence, one record per category. */
export function categoryEvidence(snapshot: Snapshot): { globalMcTvl: number; globalGrowth: number; byCategory: Map<string, { n: number; mcTvl: number; growth: number }> } {
  const ratios: number[] = [];
  const growths: number[] = [];
  const perCat = new Map<string, { r: number[]; g: number[] }>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const key = p.category ?? UNCATEGORISED;
    const bucket = perCat.get(key) ?? { r: [], g: [] };
    bucket.r.push(p.mcap_usd / p.tvl_usd);
    if (p.change_7d !== null) bucket.g.push(p.change_7d);
    perCat.set(key, bucket);
    ratios.push(p.mcap_usd / p.tvl_usd);
    if (p.change_7d !== null) growths.push(p.change_7d);
  }
  const globalMcTvl = median(ratios, 0.2);
  const globalGrowth = median(growths, 0);
  const byCategory = new Map<string, { n: number; mcTvl: number; growth: number }>();
  for (const [key, bucket] of perCat) {
    // A category with fewer than MIN_COMPARABLES live protocols is not evidence: drop it entirely and
    // let the shrink rule score its pre-token protocols straight off the all-live median. A single
    // oddball live protocol would otherwise set its whole category's multiple.
    if (bucket.r.length < MIN_COMPARABLES) continue;
    byCategory.set(key, { n: bucket.r.length, mcTvl: median(bucket.r, globalMcTvl), growth: median(bucket.g, globalGrowth) });
  }
  return { globalMcTvl, globalGrowth, byCategory };
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  evidence: { globalMcTvl: number; byCategory: Map<string, { n: number; mcTvl: number; growth: number }> },
): { implied: number; catMult: number; evidenceN: number; base: number; growthPct: number; growthMult: number; windowMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const key = protocol.category ?? UNCATEGORISED;
  const cat = evidence.byCategory.get(key);
  const n = cat?.n ?? 0;
  const catMedian = cat?.mcTvl ?? evidence.globalMcTvl;
  // Empirical Bayes shrink: a category with few live comparables leans on the all-live median, and
  // outliers are damped by blending in the median across ALL live protocols, not the category's tail.
  const catMult = Math.min(model.multiple_cap, Math.max(model.multiple_floor, (n * catMedian + model.shrink_weight * evidence.globalMcTvl) / (n + model.shrink_weight)));
  const growthPct = protocol.change_7d !== null ? protocol.change_7d : cat?.growth ?? 0;
  const clampedGrowth = Math.min(120, Math.max(-60, growthPct));
  const growthMult = Math.min(model.growth_cap, Math.max(model.growth_floor, Math.pow(1 + clampedGrowth / 100, model.growth_power)));
  const windowMult = age === null ? 1.0 : model.window_base + model.window_peak * Math.exp(-Math.pow((age - model.window_center_days) / model.window_width_days, 2));
  // The board multiplies the ROUNDED multipliers it publishes (4 decimal places), so the dashboard's
  // recomputation from the same published figures lands on the identical whole dollar.
  const base = protocol.tvl_usd * round4(catMult);
  const implied = Math.max(1, Math.round(base * round4(growthMult) * round4(windowMult)));
  return { implied, catMult, evidenceN: n, base, growthPct, growthMult, windowMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, always covered.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const evidence = categoryEvidence(snapshot);
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, evidence);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
      category_multiple: round4(s.catMult),
      evidence_n: s.evidenceN,
      base_usd: Math.round(s.base),
      growth_pct: round2(s.growthPct),
      growth_mult: round4(s.growthMult),
      window_mult: round4(s.windowMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, snapshot.as_of).map(stepText),
  }));
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

function usd(n: number): string {
  return `$${n >= 1 ? n.toFixed(n >= 100 ? 0 : 0) : n.toFixed(2)}`;
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
 * A protocol's farm plan: seven steps, each an action with a dollar cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) and the snapshot's date. No name is special-cased.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, asOf: string): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const gas = gasFor(p);
  const hold = holdDaysFor(age);
  const end = holdEndDate(asOf, hold);
  const gasStr = gas >= 1 ? `$${Math.round(gas)}` : `$${gas.toFixed(2)}`;
  return [
    {
      text: `Set up a dedicated wallet for this farm, funded only with the position's capital plus gas, and write its seed phrase on paper, never in a file.`,
      cost: `position ${usd(capital)} + ${gasStr} first gas on ${chain}`,
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `${usd(capital)} of capital, ${gasStr} of gas`,
      time: '15-30 minutes to set up',
    },
    {
      text: `Add one more touch every week: a $20 deposit top-up, a small swap, or a vote, so the address shows activity in several weekly snapshots.`,
      cost: `$20 a week plus about ${gasStr} of gas`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position to ${end} (${hold} days) without withdrawing, so the address spans at least one monthly user snapshot.`,
      cost: `${usd(capital)} stays locked in the position`,
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
      text: `Unwind after the window: withdraw the principal, swap any receipt back, and bridge home — expect 2 to 4 transactions at about ${gasStr} each.`,
      cost: `about ${usd(Math.max(1, Math.round(gas * 3)))} of exit gas`,
      time: '30 minutes',
    },
  ];
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
    category_multiple: row.model.category_multiple,
    evidence_n: row.model.evidence_n,
    base_usd: row.model.base_usd,
    growth_mult: row.model.growth_mult,
    window_mult: row.model.window_mult,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const evidence = categoryEvidence(snapshot);
  const categories: CategoryEvidence[] = [...evidence.byCategory.entries()]
    .map(([key, v]) => ({ key, live_n: v.n, median_mc_tvl: round4(v.mcTvl), median_growth: round2(v.growth) }))
    .sort((a, b) => a.key < b.key ? -1 : 1);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    global_mc_tvl: round4(evidence.globalMcTvl),
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
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
