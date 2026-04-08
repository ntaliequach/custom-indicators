# Quarterly Theory Time Divider

## Quick summary
- Purpose: develop, test, and publish personal indicators for Tradovate Trader.
- Highlight: `quarterlyTheory` — splits the trading day into four equal intraday segments and draws named session high/low lines (Sydney, Asia, London, New York).
- Status: working examples + helpers for local development and deployment.

## Repository layout
- `/builtin` — reusable indicators (library-style)
- `/examples` — small examples and prototypes
- `/tools` — helpers: plotting, params, session/time utilities, predefs
- `/typescript` — typings for editor tooling
- `/tutorial` — demo/tutorial sources (GitHub Pages)

## Key concepts
- Quarterly theory: divides the trading day into four equal segments to surface recurring pivot zones; vertical dividers mark segment starts and session HL lines show current-day ranges.
- Time alignment: timezone-aware marker logic uses Intl.DateTimeFormat (e.g. America/New_York) to handle DST and ensure markers align with market hours.
- Line styles: human-friendly params (solid, dashed, dotted) map to renderer values in the plotter.

## Getting started (local)
1. Fork (recommended) and clone:
   git clone git@github.com:YOUR_USERNAME/custom-indicators.git
2. Edit or add an indicator in `/examples` or `/builtin`.
3. Use `/tools` helpers (predef, plotting, meta) to keep params and plotting consistent.
4. Load the indicator into Tradovate Trader per the platform's dev instructions for testing.

## Development tips
- Use timezone-aware formatting for market-aligned markers:
  Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" })
- Reset internal counters/state when switching chart timeframe modes to avoid drift.
- Keep session HL updates local to the current UTC day to avoid cross-day leakage.

Personal collection of Tradovate Trader custom indicators and supporting utilities. Focused on practical, reusable JS indicators (examples and builtin-style), utilities for plotting/time handling, and TypeScript typings for IDE support.
