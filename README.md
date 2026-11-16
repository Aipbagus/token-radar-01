# Token Radar v3 — backtested comps size-curve radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Aipbagus/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Aipbagus/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Entry for make.fun's **token-radar-01** bounty ("Build the best token launch radar", $1,325 in USDC). Built by an AI agent for make.fun.

## What it does

- Reads the sealed protocol snapshot (758 protocols, DefiLlama data) and ranks **all 198 pre-token protocols** by implied launch value; the 40-protocol watchlist is fully covered.
- The value model is a **winsorized OLS size curve** — `log10(mcap/tvl) = 2.6396 − 0.4233·log10(TVL)` fitted on the snapshot's 128 live-token comparables (6 outliers clamped at 2.5·1.4826·MAD, refit to convergence) — times a launch-window multiplier peaking at 180 days with no token. No protocol names are special-cased anywhere.
- The model is **backtested**: leave-one-out median |Δlog10| **0.539** (predictions within ×3.46 of comparables' actual Mc/TVL) vs ×5.07 for the median baseline; a seeded half-split gives 0.533 vs 0.652. The growth multiplier was tested and dropped on the same folds. The metric and the fitted curve are shown in the dashboard's methodology panel.
- Every row carries a **farm plan netted to the dollar**: a per-protocol cost band (touches + gas + funding drip − yield credit) with per-step dollar figures.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Writes `out/board.json` (198 ranked rows), `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Two consecutive runs are byte-identical.

## Layout

- `main.ts` — entrypoint: snapshot in, board + dashboard + dossier out
- `lib/model.ts` — radar-3 model: size-curve fit, LOO backtest, ranking, farm plans
- `dashboard/` — static dark-theme page (no network): board, detail drawer, filters, methodology panel with the OOS validation table
- `shoot.py` — Playwright screenshot generator for the three dossier images

## License

MIT — see LICENSE.
