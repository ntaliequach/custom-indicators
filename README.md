# Quarterly Theory — Time Divider

A small, personal set of Tradovate Trader indicators and helpers.  
Primary indicator: `quarterlyTheory` — splits the trading day into four equal intraday segments to surface recurring pivot zones and draws named session high/low lines (Sydney, Asia, London, New York).

---

## Highlights
- Clean, timezone-aware dividers for 1m / 5m / 15m / 1h charts  
- Session high/low tracking for major markets (Sydney, Asia, London, NY)  
- Configurable line styles (solid / dashed / dotted) and widths  
- Built with reusable helpers in `/tools` for plotting & params
- Note: On the 5-minute timeframe, the first quarter line may look inconsistent, but it is simply due to market re-opening at London session.



https://github.com/user-attachments/assets/f0cc5ff7-c702-4d0f-8b1a-3ba33a13f8ad



---

## Quick Start
1. Fork (recommended), then clone:
   git clone git@github.com:YOUR_USERNAME/custom-indicators.git
2. Edit or add indicators in `/examples` or `/builtin`.
3. Use `/tools` helpers (predef, plotting, meta).
4. Load the indicator file in Tradovate Trader for testing.

---

## Usage Notes
- Quarterly theory = divide trading day into 4 equal segments → vertical dividers mark segment starts; session HL lines show intraday ranges.
- Time alignment uses Intl.DateTimeFormat with `timeZone: "America/New_York"` so markers align with market hours and handle DST.

---

## Known Issues (current)
- Dashed/dotted line render has a bug in some environments — styled lines may not display correctly.  
- Session price-range horizontals only appear reliably for the very current session; older session HL lines may not render.

If you rely on these visuals, test locally before publishing.

---

## Dev / Implementation Tips
- Use timezone-aware formatting for market-aligned markers:
  Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, hour: "2-digit", minute: "2-digit" })
- Reset internal counters/state when switching chart timeframe modes to avoid drift (important for 1h special markers).
- Map human line-style params to renderer values in the plotter (see `/tools/plotting` and `/tools/predef`).

---

## Repo Layout
- `/builtin` — library-style indicators  
- `/examples` — prototypes & demos  
- `/tools` — helpers (plotting, params, time/session utilities)  
- `/typescript` — typings for IDE support  
- `/tutorial` — demo/tutorial sources

---

## License & Attribution
- Check upstream licensing before republishing code derived from other authors. Add a LICENSE and attribution if required.

---

Concise, test-driven, and ready for iteration — open an issue or PR with repro steps if you hit rendering bugs.
