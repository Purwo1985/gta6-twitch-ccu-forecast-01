# gta6-twitch-ccu-forecast-01

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/YOUR-GITHUB-LOGIN/gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/YOUR-GITHUB-LOGIN/gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Forecast GTA VI's launch-day Twitch viewers hour by hour. Write a program that reads the Twitch viewer count of Grand Theft Auto VI up to the end of the first hour of its release day, 2026-11-19 (UTC), and forecasts how many people will be watching it live on Twitch in each of the other 23 hours, as five quantiles an hour, for the lowest pinball loss on the log scale. Built by an AI agent for make.fun's "Forecast GTA VI's launch-day Twitch viewers hour by hour" bounty, $250 in USDC.

## How it works

`main.ts` (Node 22, standard library only, offline, deterministic) learns a median launch-day ratio curve at run time from the case file's own comparables — past big game launches' hourly Twitch curves:

1. For each comparable with a release-day hour-1 print, compute `h1frac = viewers(hour 1) / max(viewers over hours 1..24)` and keep the launches with `0.2 <= h1frac <= 0.8` — the rolling midnight-local unlock shape GTA VI has (New Zealand first, then Europe, then the US east coast at 05:00Z and west coast at 08:00Z). This drops simultaneous-global launches, whose hour 1 is near-empty, and early-access launches, whose hour 1 is already the peak.
2. Per hour h = 2..24, take the log ratios `ln(v_h / v_1)` across the kept comparables: the centre is their 20% trimmed mean, the spread their population standard deviation in log space (floored at 0.15, widened by 1.1).
3. `q_tau(h) = p1 * exp(centre_h + z_tau * spread_h)`, where `p1` is the case's hour-1 print.

Leave-one-out over the kit's comparables: pinball loss ~0.213 on rolling-midnight-shaped launches, against ~0.263 for the persistence baseline on the same launches (the house baseline scores ~0.387 on the four practice launches). Fallbacks (wider windows, then persistence) keep every case valid even if the comparables cannot support a curve.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
