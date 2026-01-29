const predef = require("./tools/predef");
const meta = require("./tools/meta");
const p = require("./tools/plotting");
const { ParamType } = meta;

function number(defValue, step, min) {
  return { type: ParamType.NUMBER, def: defValue, restrictions: { step: step || 1, min: min || 0 } };
}
function bool(defValue) {
  return { type: ParamType.BOOLEAN, def: !!defValue };
}

class QuarterlyTimeDivider {
  init() {
    // track last drawn marker id for uniqueness
    this.lastMarker = null;

    // timeframe detection state
    this.lastBarTs = null;
    this.frameMs = null;

    // current-day named sessions
    this.currentDayKey = null;
    this.sessions = null;
  }

  _utcDayKey(dt) {
    return dt.getUTCFullYear() + "-" + String(dt.getUTCMonth() + 1).padStart(2, "0") + "-" + String(dt.getUTCDate()).padStart(2, "0");
  }

  _makeNamedSessions(barTs) {
    // defaults in UTC (common market session windows)
    const defs = {
      Sydney: { sh: 22, sm: 0, eh: 7, em: 0 },   // 22:00 - 07:00 UTC (overnight)
      Asia:   { sh: 0,  sm: 0, eh: 9, em: 0 },   // 00:00 - 09:00 UTC (Tokyo/Asia)
      London: { sh: 8,  sm: 0, eh: 17, em: 0 },  // 08:00 - 17:00 UTC
      NY:     { sh: 13, sm: 0, eh: 22, em: 0 }   // 13:00 - 22:00 UTC
    };

    const pprops = this.props || {};
    const overrides = {
      Sydney: { sh: pprops.sydStartHour, sm: pprops.sydStartMin, eh: pprops.sydEndHour, em: pprops.sydEndMin },
      Asia:   { sh: pprops.asiaStartHour, sm: pprops.asiaStartMin, eh: pprops.asiaEndHour, em: pprops.asiaEndMin },
      London: { sh: pprops.lonStartHour, sm: pprops.lonStartMin, eh: pprops.lonEndHour, em: pprops.lonEndMin },
      NY:     { sh: pprops.nyStartHour,  sm: pprops.nyStartMin,  eh: pprops.nyEndHour,  em: pprops.nyEndMin }
    };

    const dt = barTs;
    const y = dt.getUTCFullYear();
    const m = dt.getUTCMonth();
    const d = dt.getUTCDate();

    const sessions = {};
    for (const name of Object.keys(defs)) {
      const def = defs[name];
      const over = overrides[name] || {};
      const sh = (typeof over.sh === "number") ? over.sh : def.sh;
      const sm = (typeof over.sm === "number") ? over.sm : def.sm;
      const eh = (typeof over.eh === "number") ? over.eh : def.eh;
      const em = (typeof over.em === "number") ? over.em : def.em;

      let startTs = Date.UTC(y, m, d, sh, sm, 0, 0);
      let endTs = Date.UTC(y, m, d, eh, em, 0, 0);
      if (endTs <= startTs) endTs += 24 * 60 * 60 * 1000; // overnight
      sessions[name] = { name, startTs, endTs, currentHigh: undefined, currentLow: undefined };
    }
    return sessions;
  }

  map(d, i, history) {
    const {
      useCustomSession,
      startHour,
      startMinute,
      endHour,
      endMinute
    } = this.props || {};

    const barTs = d.timestamp();
    const barTime = barTs.getTime();

    // -- timeframe detection (capture frameMs from bar deltas) --
    if (this.lastBarTs != null) {
      const delta = barTime - this.lastBarTs;
      if (this.frameMs == null) this.frameMs = delta;
    }
    this.lastBarTs = barTime;

    // Build session start/end for the day of the bar (quarterly logic)
    const dayBase = new Date(barTs);
    dayBase.setSeconds(0, 0);
    dayBase.setMilliseconds(0);

    const sessionStart = new Date(dayBase);
    const sessionEnd = new Date(dayBase);

    if (useCustomSession) {
      sessionStart.setHours(startHour, startMinute, 0, 0);
      sessionEnd.setHours(endHour, endMinute, 0, 0);
    } else {
      sessionStart.setHours(0, 0, 0, 0);
      sessionEnd.setTime(sessionStart.getTime() + 24 * 60 * 60 * 1000);
    }
    if (sessionEnd.getTime() <= sessionStart.getTime()) {
      sessionEnd.setDate(sessionEnd.getDate() + 1);
    }

    const sTs = sessionStart.getTime();
    const eTs = sessionEnd.getTime();

    // initialize named sessions for current UTC day when day changes
    const dayKey = this._utcDayKey(barTs);
    if (this.currentDayKey !== dayKey || this.sessions == null) {
      this.currentDayKey = dayKey;
      this.sessions = this._makeNamedSessions(barTs);
    }

    // update named session highs/lows for current day only
    const barHigh = (typeof d.high === "function") ? d.high() : d.high;
    const barLow = (typeof d.low === "function") ? d.low() : d.low;
    for (const nm in this.sessions) {
      const s = this.sessions[nm];
      if (barTime >= s.startTs && barTime < s.endTs) {
        if (barHigh != null && (s.currentHigh == null || barHigh > s.currentHigh)) s.currentHigh = barHigh;
        if (barLow  != null && (s.currentLow  == null || barLow  < s.currentLow))  s.currentLow  = barLow;
      }
    }

    // outside session → reset quarterly markers but still expose session HL fields
    if (barTime < sTs || barTime > eTs) {
      this.lastMarker = null;
      this.lastMode = null;
      return Object.assign({ isMarker: false }, this._sessionFieldsForOutput());
    }

    // detect chart timeframe (unchanged)
    const oneMinute = 60 * 1000;
    const fiveMinute = 5 * oneMinute;
    const fifteenMinute = 15 * oneMinute;
    const oneHour = 60 * 60 * 1000;
    const tol1 = 2000;
    const tol5 = 5000;
    const tol15 = 7000;
    const tol60 = 20000;

    let mode = null;
    if (this.frameMs != null) {
      if (Math.abs(this.frameMs - oneMinute) <= tol1) mode = "1m";
      else if (Math.abs(this.frameMs - fiveMinute) <= tol5) mode = "5m";
      else if (Math.abs(this.frameMs - fifteenMinute) <= tol15) mode = "15m";
      else if (Math.abs(this.frameMs - oneHour) <= tol60) mode = "1h";
    }

    if (mode !== this.lastMode) {
      this.lastMarker = null;
      this.lastMode = mode;
    }

    // ---------- quarterly marker logic (unchanged) ----------
    if (mode === "1m") {
      const BLOCK_MINUTES_1M = 90;
      const SEGMENTS_1M = 4;
      const blockMs = BLOCK_MINUTES_1M * oneMinute;
      const segmentMs = Math.floor(blockMs / SEGMENTS_1M);
      const blockIndex = Math.floor((barTime - sTs) / blockMs);
      const blockStartTs = sTs + blockIndex * blockMs;
      let offsetInBlock = barTime - blockStartTs;
      if (offsetInBlock < 0) offsetInBlock = 0;
      let segmentIndex = Math.floor(offsetInBlock / segmentMs);
      if (segmentIndex >= SEGMENTS_1M) segmentIndex = SEGMENTS_1M - 1;
      const markerId = `1m-${new Date(sTs).toISOString().slice(0,10)}-${blockIndex}-${segmentIndex}`;
      if (this.lastMarker !== markerId) {
        this.lastMarker = markerId;
        return Object.assign({
          isMarker: true,
          base: (typeof d.close === "function" ? d.close() : (typeof d.value === "function" ? d.value() : 0)),
          isFirstSegment: segmentIndex === 0
        }, this._sessionFieldsForOutput());
      }
      return Object.assign({ isMarker: false }, this._sessionFieldsForOutput());
    }

    if (mode === "5m") {
      const BLOCK_MINUTES_5M = 90; const SEGMENTS_5M = 1;
      const blockMs = BLOCK_MINUTES_5M * oneMinute;
      const blockIndex = Math.floor((barTime - sTs) / blockMs);
      const blockStartTs = sTs + blockIndex * blockMs;
      const bsDate = new Date(blockStartTs);
      const bsHour = bsDate.getHours();
      const bsMinute = bsDate.getMinutes();
      const isSixHourFirst = (bsMinute === 0) && (bsHour % 6 === 3);
      const markerId = `5m-${new Date(sTs).toISOString().slice(0,10)}-${blockIndex}-0`;
      if (this.lastMarker !== markerId) {
        this.lastMarker = markerId;
        return Object.assign({
          isMarker: true,
          base: (typeof d.close === "function" ? d.close() : (typeof d.value === "function" ? d.value() : 0)),
          isFirstSegment: isSixHourFirst
        }, this._sessionFieldsForOutput());
      }
      return Object.assign({ isMarker: false }, this._sessionFieldsForOutput());
    }

    if (mode === "15m") {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit"
      }).formatToParts(new Date(barTime));
      let nyHour = 0, nyMinute = 0;
      for (const p of parts) {
        if (p.type === "hour") nyHour = parseInt(p.value, 10);
        if (p.type === "minute") nyMinute = parseInt(p.value, 10);
      }
      if (!(nyMinute === 0 && (nyHour % 6) === 0)) return Object.assign({ isMarker: false }, this._sessionFieldsForOutput());
      const markerId = `15m-6h-${new Date(barTime).toISOString().slice(0,16)}`;
      if (this.lastMarker !== markerId) {
        this.lastMarker = markerId;
        return Object.assign({
          isMarker: true,
          base: (typeof d.close === "function" ? d.close() : (typeof d.value === "function" ? d.value() : 0)),
          isFirstSegment: nyHour === 18
        }, this._sessionFieldsForOutput());
      }
      return Object.assign({ isMarker: false }, this._sessionFieldsForOutput());
    }

    if (mode === "1h") {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit"
      }).formatToParts(new Date(barTime));
      let nyHour = 0, nyMinute = 0;
      for (const p of parts) {
        if (p.type === "hour") nyHour = parseInt(p.value, 10);
        if (p.type === "minute") nyMinute = parseInt(p.value, 10);
      }
      if (!(nyHour === 18 && nyMinute === 0)) return Object.assign({ isMarker: false }, this._sessionFieldsForOutput());
      const markerId = `1h-18-${new Date(barTime).toISOString().slice(0,16)}`;
      if (this.lastMarker !== markerId) {
        this.hour18Count = (this.hour18Count || 0) + 1;
        this.lastMarker = markerId;
        const isFirst = (this.hour18Count % 4) === 1;
        return Object.assign({
          isMarker: true,
          base: (typeof d.close === "function" ? d.close() : (typeof d.value === "function" ? d.value() : 0)),
          isFirstSegment: isFirst
        }, this._sessionFieldsForOutput());
      }
      return Object.assign({ isMarker: false }, this._sessionFieldsForOutput());
    }

    return Object.assign({ isMarker: false }, this._sessionFieldsForOutput());
  }

  _sessionFieldsForOutput() {
    const out = {};
    if (!this.sessions) return out;
    for (const name in this.sessions) {
      const s = this.sessions[name];
      out[`${name}High`] = s.currentHigh;
      out[`${name}Low`] = s.currentLow;
      out[`${name}Start`] = new Date(s.startTs);
      out[`${name}End`] = new Date(s.endTs);
    }
    return out;
  }

  filter() { return true; }
}

// Custom plotter vertical divider + current-day session horizontals with labels
function combinedPlotter(canvas, instance, history) {
  const props = instance.props || {};

  const lineColor = props.lineColor || props.color || "#8cecff";
  const firstLineColor = props.firstLineColor || props.color || "#ff8c00";

  const tick = instance.contractInfo ? instance.contractInfo.tickSize : 0.25;
  const span = tick * 100000;

  const firstLineWidth = Number(props.firstLineWidth || 2);
  const firstLineStyle = (props.firstLineStyle || "dashed").toLowerCase();

  const lineWidth = Number(props.lineWidth || 1);
  const lineStyle = (props.lineStyle || "solid").toLowerCase();

  const styleMap = { solid: 1, dotted: 2, dashed: 3 };
  const firstLineStyleVal = styleMap[firstLineStyle] || 1;
  const normalLineStyleVal = styleMap[lineStyle] || 1;

  // draw vertical markers
  for (let i = 0; i < history.data.length; ++i) {
    const item = history.get(i);
    if (item && item.isMarker) {
      const x = p.x.get(item);
      const yMid = item.base || 0;
      const style = item.isFirstSegment
        ? { color: firstLineColor, lineWidth: firstLineWidth, opacity: 100, lineStyle: firstLineStyleVal }
        : { color: lineColor, lineWidth: lineWidth, opacity: 100, lineStyle: normalLineStyleVal };

      canvas.drawLine(
        p.offset(x, yMid - span),
        p.offset(x, yMid + span),
        style
      );
    }
  }

  // draw named session horizontal high/low lines (current day only)
  const showSession = props.showSessionLines !== false;
  if (!showSession) return;

  const sessColors = {
    Sydney: props.sydneyColor || props.sessionLineColor || "#FFAA33",
    Asia:   props.asiaColor   || props.sessionLineColor || "#66CCFF",
    London: props.londonColor || props.sessionLineColor || "#88FF88",
    NY:     props.nyColor     || props.sessionLineColor || "#FF6666"
  };
  const sessLineWidth = Number(props.sessionLineWidth || 1);
  const sessLineStyle = styleMap[(props.sessionLineStyle || "dashed").toLowerCase()] || 3;

  // find latest item containing session fields
  let latest = null;
  for (let i = history.data.length - 1; i >= 0; --i) {
    const it = history.get(i);
    if (!it) continue;
    if (it.SydneyStart || it.AsiaStart || it.LondonStart || it.NYStart) { latest = it; break; }
  }
  if (!latest) return;

  const sessionNames = ["Sydney", "Asia", "London", "NY"];
  for (const name of sessionNames) {
    const high = latest[`${name}High`];
    const low = latest[`${name}Low`];
    const sStart = latest[`${name}Start`];
    const sEnd = latest[`${name}End`];
    if ((!sStart && !sEnd) || (high == null && low == null)) continue;

    const startTs = sStart.getTime();
    const endTs = sEnd.getTime();

    // find first/last indices that fall into session span
    let jStart = -1, jEnd = -1;
    for (let j = 0; j < history.data.length; ++j) {
      const h = history.get(j);
      if (!h || !h.date) continue;
      const t = h.date.getTime();
      if (jStart === -1 && t >= startTs) jStart = j;
      if (t <= endTs) jEnd = j;
    }
    if (jStart === -1) jStart = 0;
    if (jEnd === -1) jEnd = history.data.length - 1;

    const x1 = p.x.get(history.get(jStart));
    const x2 = p.x.get(history.get(jEnd));
    const color = sessColors[name] || "#FFFFFF";

    if (high != null) {
      canvas.drawLine(
        p.offset(x1, high),
        p.offset(x2, high),
        { color, lineWidth: sessLineWidth, lineStyle: sessLineStyle, opacity: 100 }
      );
      canvas.drawText && canvas.drawText(`${name} H ${high}`, p.offset(x2, high), { font: "12px Arial", color, align: "right" });
    }
    if (low != null) {
      canvas.drawLine(
        p.offset(x1, low),
        p.offset(x2, low),
        { color, lineWidth: sessLineWidth, lineStyle: sessLineStyle, opacity: 100 }
      );
      canvas.drawText && canvas.drawText(`${name} L ${low}`, p.offset(x2, low), { font: "12px Arial", color, align: "right" });
    }
  }
}

module.exports = {
  name: "quarterlyTheory",
  description: "Quarterly Time Divider + Named Session High/Low (Sydney, Asia, London, New York) — draws quarterly vertical dividers and current-day session high/low horizontals.",
  calculator: QuarterlyTimeDivider,

  params: {
    useCustomSession: bool(false),
    startHour: number(9, 1, 0),
    startMinute: number(30, 1, 0),
    endHour: number(16, 1, 0),
    endMinute: number(0, 1, 0),

    color: predef.paramSpecs.color("#8cecff"),
    lineColor: predef.paramSpecs.color("#8cecff"),
    firstLineColor: predef.paramSpecs.color("#ff8c00"),
    lineWidth: number(1, 1, 1),
    lineStyle: { type: ParamType.ENUM, enumSet: { solid: "Solid", dashed: "Dashed", dotted: "Dotted" }, def: "solid" },
    firstLineStyle: { type: ParamType.ENUM, enumSet: { solid: "Solid", dashed: "Dashed", dotted: "Dotted" }, def: "dashed" },
    firstLineWidth: number(2, 1, 1),

    showSessionLines: bool(true),
    sessionLineColor: predef.paramSpecs.color("#33CC33"),
    sydneyColor: predef.paramSpecs.color("#FFAA33"),
    asiaColor: predef.paramSpecs.color("#66CCFF"),
    londonColor: predef.paramSpecs.color("#88FF88"),
    nyColor: predef.paramSpecs.color("#FF6666"),
    sessionLineWidth: number(1,1,1),
    sessionLineStyle: { type: ParamType.ENUM, enumSet: { solid: "Solid", dashed: "Dashed", dotted: "Dotted" }, def: "dashed" },

    // optional UTC overrides
    sydStartHour: number(22,1,0), sydStartMin: number(0,1,0), sydEndHour: number(7,1,0), sydEndMin: number(0,1,0),
    asiaStartHour: number(0,1,0), asiaStartMin: number(0,1,0), asiaEndHour: number(9,1,0), asiaEndMin: number(0,1,0),
    lonStartHour: number(8,1,0), lonStartMin: number(0,1,0), lonEndHour: number(17,1,0), lonEndMin: number(0,1,0),
    nyStartHour: number(13,1,0), nyStartMin: number(0,1,0), nyEndHour: number(22,1,0), nyEndMin: number(0,1,0)
  },

  plots: {
    isMarker: { title: "Segment Start", displayOnly: true },
    SydneyHigh: { title: "Sydney High", displayOnly: true },
    SydneyLow: { title: "Sydney Low", displayOnly: true },
    AsiaHigh: { title: "Asia High", displayOnly: true },
    AsiaLow: { title: "Asia Low", displayOnly: true },
    LondonHigh: { title: "London High", displayOnly: true },
    LondonLow: { title: "London Low", displayOnly: true },
    NYHigh: { title: "New York High", displayOnly: true },
    NYLow: { title: "New York Low", displayOnly: true }
  },

  inputType: meta.InputType.BARS,
  tags: ["> ntalieq's indicators"],
  plotter: predef.plotters.custom(combinedPlotter),
  schemeStyles: predef.styles.solidLine("#8cecff")
};
