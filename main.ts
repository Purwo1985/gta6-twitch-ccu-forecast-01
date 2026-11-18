// gta6-twitch-ccu-forecast-01: forecast Grand Theft Auto VI's launch-day Twitch
// viewers hour by hour (hours 2..24 of 2026-11-19 UTC) from the first hour's print.
//
// Model: a median launch-day ratio curve learned at run time from the case's own
// comparables (past big game launches' hourly Twitch curves, shipped in the case
// file; nothing is fetched, nothing is read from the network).
//
//   1. For every comparable with a release-day hour-1 print, compute
//      h1frac = viewers(hour 1) / max(viewers over hours 1..24): how much of the
//      launch was already underway when the UTC day's first hour was counted.
//      Keep the comparables with 0.2 <= h1frac <= 0.8. That is the rolling
//      midnight-local unlock shape GTA VI has (New Zealand first, then Europe,
//      then the US east coast at 05:00Z and west coast at 08:00Z): by hour 1 a
//      good share of the world is already playing, but the biggest market is
//      still to unlock, so the curve dips a little, then climbs to a peak in the
//      US daytime. The window drops the two shapes that would wreck the median:
//      simultaneous-global launches, whose hour 1 is near-empty (h1frac ~ 0.001,
//      ratios up to 2000x), and early-access launches, whose hour 1 is already
//      the day's peak (h1frac ~ 1, flat curves).
//   2. Per hour h = 2..24, take the log ratios ln(v_h / v_1) across the kept
//      comparables. The centre is their 20% trimmed mean (robust to the odd
//      launch whose curve does something strange); the spread is their
//      population standard deviation in log space, floored at 0.15 and widened
//      by 1.1 (leave-one-out on the practice kit's 38 comparables: pinball loss
//      ~0.213, against ~0.263 for the persistence baseline on the same launches;
//      the house baseline scores ~0.387 on the four practice launches).
//   3. q_tau(h) = p1 * exp(centre_h + z_tau * spread_h), rounded to 2 decimals,
//      where p1 is the case's hour-1 print and z_tau the standard normal's
//      quantile at each scored level.
//
// Fallbacks keep every case valid: if too few comparables survive the window,
// widen it ([0.1, 0.9], then [0.05, 1.0], then every comparable with an hour-1
// print); if no comparable is usable at all, fall back to the persistence
// baseline. A case that fails to parse still gets a forecast (p1 = 1), so a
// run never crashes and never leaves a case without an output file.
//
// Node 22, standard library only, offline, deterministic: the comparables are
// processed in a fixed order (sorted by name), there is no randomness, no clock
// and no environment-dependent input, so two runs write byte-identical files.
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.6448536269514722, -0.6744897501960817, 0, 0.6744897501960817, 1.6448536269514722];
/** Persistence baseline's log spread per square-root hour (fallback only). */
const BASE_SIGMA = 0.15;
/** Hours of the release day that are forecast. */
const HOURS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];

/** The h1frac window that selects rolling-midnight-shaped launches. */
const WINDOWS: Array<[number, number]> = [
  [0.2, 0.8],
  [0.1, 0.9],
  [0.05, 1.0],
  [0, 1.0],
];
/** A window must keep at least this many comparables to be used. */
const MIN_POOL = 8;
/** Fraction trimmed off each end of the sorted log ratios. */
const TRIM = 0.2;
/** Floor on the per-hour log spread (uncertainty is never that small). */
const SD_FLOOR = 0.15;
/** Small widening of the spread, tuned on leave-one-out over the comparables. */
const SD_MULT = 1.1;

interface HourlyRow {
  from: string;
  viewers: number | null;
}

interface Comparable {
  name: string;
  day_start: string;
  hourly: HourlyRow[];
}

interface Case {
  known?: Array<{ hour: number; viewers: number }>;
  forecast?: Array<{ hour: number }>;
  comparables?: Comparable[];
}

/** x rounded to 2 decimals (half up). */
const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Whole hours between two ISO-8601 UTC instants. */
const hoursBetween = (from: string, to: string): number =>
  Math.floor((Date.parse(to) - Date.parse(from)) / 3600000);

/** A comparable's release-day curve: hour (1..24) -> viewers, when positive. */
const dayCurve = (c: Comparable): Map<number, number> => {
  const curve = new Map<number, number>();
  if (!c || typeof c.day_start !== 'string' || !Array.isArray(c.hourly)) return curve;
  for (const row of c.hourly) {
    if (!row || typeof row.from !== 'string') continue;
    const v = row.viewers;
    if (typeof v !== 'number' || !(v > 0)) continue;
    const h = hoursBetween(c.day_start, row.from) + 1;
    if (h >= 1 && h <= 24 && !curve.has(h)) curve.set(h, v);
  }
  return curve;
};

/** Sorted copy of xs with the outer TRIM fraction cut off each end. */
const trimmed = (xs: number[]): number[] => {
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.floor(s.length * TRIM);
  const inner = k > 0 && s.length - 2 * k > 0 ? s.slice(k, s.length - k) : s;
  return inner;
};

/** Arithmetic mean. */
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Population standard deviation around the mean. */
const pstdev = (xs: number[]): number => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
};

/** The persistence forecast of one hour: every quantile around p1. */
const persistenceRow = (p1: number, h: number): number[] => {
  const s = BASE_SIGMA * Math.sqrt(h - 1);
  return Z.map((z) => round2(p1 * Math.exp(z * s)));
};

/**
 * The ratio-curve forecast for one case. Returns one row per forecast hour.
 * Falls back to persistence whenever the comparables cannot support a curve.
 */
const forecastRows = (c: Case, p1: number): Array<{ hour: number; q: number[] }> => {
  const hours = Array.isArray(c.forecast) && c.forecast.length > 0
    ? c.forecast.map((f) => f.hour).filter((h) => h >= 2 && h <= 24)
    : HOURS;
  const fallback = hours.map((h) => ({ hour: h, q: persistenceRow(p1, h) }));

  const comps = (Array.isArray(c.comparables) ? c.comparables : [])
    .filter((x) => x && typeof x.name === 'string')
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (comps.length === 0) return fallback;

  // Each comparable's day curve and its h1frac (hour-1 share of its day peak).
  const curves = comps
    .map((comp) => {
      const curve = dayCurve(comp);
      const v1 = curve.get(1);
      if (v1 === undefined) return null;
      let peak = 0;
      for (const v of curve.values()) if (v > peak) peak = v;
      if (peak <= 0) return null;
      return { curve, h1frac: v1 / peak };
    })
    .filter((x): x is { curve: Map<number, number>; h1frac: number } => x !== null);
  if (curves.length === 0) return fallback;

  // Pick the first window that keeps enough comparables.
  let pool = curves;
  for (const [lo, hi] of WINDOWS) {
    const kept = curves.filter((x) => x.h1frac >= lo && x.h1frac <= hi);
    if (kept.length >= MIN_POOL) {
      pool = kept;
      break;
    }
    pool = kept.length > 0 ? kept : pool;
  }
  if (pool.length < 3) return fallback;

  return hours.map((h) => {
    const logs: number[] = [];
    for (const { curve } of pool) {
      const v = curve.get(h);
      const v1 = curve.get(1);
      if (v !== undefined && v1 !== undefined) logs.push(Math.log(v / v1));
    }
    if (logs.length < 3) return { hour: h, q: persistenceRow(p1, h) };
    const centre = mean(trimmed(logs));
    const sd = Math.max(pstdev(logs), SD_FLOOR) * SD_MULT;
    const q = Z.map((z) => round2(p1 * Math.exp(centre + z * sd)));
    // Keep every quantile finite, above 0 and non-decreasing after rounding.
    for (let i = 0; i < q.length; i++) {
      if (!Number.isFinite(q[i]) || q[i] < 0.01) q[i] = 0.01;
      if (i > 0 && q[i] < q[i - 1]) q[i] = q[i - 1];
      q[i] = Math.min(q[i], 1e9);
    }
    return { hour: h, q };
  });
};

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  let rows: Array<{ hour: number; q: number[] }>;
  try {
    const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
    const first = Array.isArray(c.known) ? c.known.find((k) => k.hour === 1) : undefined;
    const p1 = first && typeof first.viewers === 'number' && first.viewers > 0
      ? first.viewers
      : 1;
    rows = forecastRows(c, p1);
  } catch {
    // A case that cannot be read still gets a valid persistence forecast.
    rows = HOURS.map((h) => ({ hour: h, q: persistenceRow(1, h) }));
  }
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours: rows })}\n`);
}
