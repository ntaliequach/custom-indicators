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
  }

  map(d, i) {
    const {
      useCustomSession,
      startHour,
      startMinute,
      endHour,
      endMinute
    } = this.props;

    const barTs = d.timestamp();
    const barTime = barTs.getTime();

    // -- timeframe detection (capture frameMs from bar deltas) --
    if (this.lastBarTs != null) {
      const delta = barTime - this.lastBarTs;
      if (this.frameMs == null) this.frameMs = delta;
    }
    this.lastBarTs = barTime;

    // Build session start/end for the day of the bar
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

    // outside session → reset and hide
    if (barTime < sTs || barTime > eTs) {
      this.lastMarker = null;
      this.lastMode = null;
      return { isMarker: false };
    }

    // detect chart timeframe
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

    // reset marker when mode changes
    if (mode !== this.lastMode) {
      this.lastMarker = null;
      this.lastMode = mode;
    }

    // ---------- 1-minute mode (unchanged) ----------
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
        return {
          isMarker: true,
          base: (typeof d.close === "function" ? d.close() : (typeof d.value === "function" ? d.value() : 0)),
          isFirstSegment: segmentIndex === 0
        };
      }
      return { isMarker: false };
    }

    // ---------- 5-minute mode (separate editable section) ----------
    if (mode === "5m") {
      const BLOCK_MINUTES_5M = 90;   // block length in minutes for 5m mode
      const SEGMENTS_5M = 1;         // keep segment count = 1

      const blockMs = BLOCK_MINUTES_5M * oneMinute;
      const segmentMs = Math.floor(blockMs / SEGMENTS_5M);

      const blockIndex = Math.floor((barTime - sTs) / blockMs);
      const blockStartTs = sTs + blockIndex * blockMs;
      let offsetInBlock = barTime - blockStartTs;
      if (offsetInBlock < 0) offsetInBlock = 0;

      // segmentIndex always 0 since SEGMENTS_5M === 1
      const segmentIndex = 0;

      // mark first line every 6 hours at HH:00 where hour % 6 === 3 (3:00,9:00,15:00,21:00 local time)
      const bsDate = new Date(blockStartTs);
      const bsHour = bsDate.getHours();
      const bsMinute = bsDate.getMinutes();
      const isSixHourFirst = (bsMinute === 0) && (bsHour % 6 === 3);

      const markerId = `5m-${new Date(sTs).toISOString().slice(0,10)}-${blockIndex}-${segmentIndex}`;

      if (this.lastMarker !== markerId) {
        this.lastMarker = markerId;
        return {
          isMarker: true,
          base: (typeof d.close === "function" ? d.close() : (typeof d.value === "function" ? d.value() : 0)),
          isFirstSegment: isSixHourFirst
        };
      }
      return { isMarker: false };
    }

    // ---------- 15-minute mode (editable) ----------
    if (mode === "15m") {
      // compute New York hour/minute for the current bar (handles DST)
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

      // require exact hour boundary and 6-hour cadence (hours 0,6,12,18)
      if (!(nyMinute === 0 && (nyHour % 6) === 0)) return { isMarker: false };

      const markerId = `15m-6h-${new Date(barTime).toISOString().slice(0,16)}`;
      if (this.lastMarker !== markerId) {
        this.lastMarker = markerId;
        return {
          isMarker: true,
          base: (typeof d.close === "function" ? d.close() : (typeof d.value === "function" ? d.value() : 0)),
          isFirstSegment: nyHour === 18
        };
      }
      return { isMarker: false };
    }

    // ---------- 1-hour mode (12-hour blocks; first line at 18:00 NY) ----------
    if (mode === "1h") {
      // compute New York hour/minute for current bar (handles DST)
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

      // only draw at exact 18:00 NY
      if (!(nyHour === 18 && nyMinute === 0)) return { isMarker: false };

      const markerId = `1h-18-${new Date(barTime).toISOString().slice(0,16)}`;
      if (this.lastMarker !== markerId) {
        this.hour18Count = (this.hour18Count || 0) + 1;
        this.lastMarker = markerId;
        // flag every 4th emitted 18:00 as first quarter line
        const isFirst = (this.hour18Count % 4) === 1;
        return {
          isMarker: true,
          base: (typeof d.close === "function" ? d.close() : (typeof d.value === "function" ? d.value() : 0)),
          isFirstSegment: isFirst
        };
      }
      return { isMarker: false };
    }

    return { isMarker: false };
  }

  filter() { return true; }
}

// Custom plotter vertical divider
// References:
// - typescript/plotter.d.ts (Custom plotter signature)
// - tutorial/Plotters.md (canvas.drawLine, plotting.x.get, p.offset)
function verticalDividerPlotter(canvas, instance, history) {
  const props = instance.props || {};

  const lineColor = props.lineColor || props.color || "#8cecff";
  const firstLineColor = props.firstLineColor || props.color || "#ff8c00";

  const tick = instance.contractInfo ? instance.contractInfo.tickSize : 0.25;
  const span = tick * 100000;

  // use param names expected by style system (lineWidth, lineStyle)
  const firstLineWidth = Number(props.firstLineWidth || 2);
  const firstLineStyle = (props.firstLineStyle || "dashed").toLowerCase();

  const lineWidth = Number(props.lineWidth || 1);
  const lineStyle = (props.lineStyle || "solid").toLowerCase();

  // Map to DashLineStyle enum values from Style.d.ts
  // 1 = Solid, 2 = ThreeOne (dotted-like), 3 = TwoTwo (dashed-like)
  const styleMap = {
    solid: 1,
    dotted: 2,
    dashed: 3
  };

  const firstLineStyleVal = styleMap[firstLineStyle] || 1;
  const normalLineStyleVal = styleMap[lineStyle] || 1;

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
}

module.exports = {
  name: "quarterlyTheory",
  description: "Quarterly Time Divider — divides each 90‑minute block into 4 equal segments and draws vertical dividers at each segment start (full day by default or custom session).",
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


  },

  plots: { isMarker: { title: "Segment Start", displayOnly: true } },

  inputType: meta.InputType.BARS,
  tags: ["> ntalieq's indicators"],
  plotter: predef.plotters.custom(verticalDividerPlotter),
  schemeStyles: predef.styles.solidLine("#8cecff")
};
