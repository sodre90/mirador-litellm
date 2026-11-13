const mirador = window.mirador;
const ASK_AGAIN_MS = 60_000;
const SVG_NS = "http://www.w3.org/2000/svg";
const AGENT_MARKS = { claude: "C", pi: "π", codex: "Cx", opencode: "O" };
const NOT_LINKED_HINT = "The gateway logged no request under this conversation's session. Its agent may not name the session in its requests: Claude Code and pi do.";

const style = document.createElement("style");
style.textContent = `
:root { --m1: #5b5bd6; --m2: #eb6834; --m3: #1baf7a; --m4: #eda100; --m0: var(--mirador-faint); }
:root[data-theme="dark"] { --m1: #7272ea; --m2: #d95926; --m3: #199e70; --m4: #c98500; }
:root { --grid: color-mix(in srgb, var(--mirador-border) 55%, transparent); --wash: color-mix(in srgb, var(--mirador-accent) 11%, transparent); }
* { box-sizing: border-box; }
html { background: var(--mirador-bg); min-height: 100%; }
body { margin: 0; font: calc(13px * var(--mirador-font-scale, 1)) / 1.45 var(--mirador-font, system-ui); color: var(--mirador-text); background: var(--mirador-bg); }
main { max-width: 1080px; margin: 0 auto; padding: 20px 28px 28px; display: grid; gap: 28px; }
button { font: inherit; color: var(--mirador-text); background: var(--mirador-panel); border: 1px solid var(--mirador-border); border-radius: 7px; padding: 5px 11px; cursor: pointer; }
button:hover { border-color: var(--mirador-faint); }
button:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--mirador-accent); outline-offset: 2px; }
button.link { border: 0; background: none; padding: 0; color: var(--mirador-accent); }
button.link:hover { text-decoration: underline; }
h1, h2 { margin: 0; }
.muted { color: var(--mirador-muted); }
.problem { margin: 0; padding: 10px 12px; border-radius: 8px; color: var(--mirador-danger); border: 1px solid color-mix(in srgb, var(--mirador-danger) 40%, transparent); background: color-mix(in srgb, var(--mirador-danger) 7%, transparent); }
.empty { margin: 0; border: 1px dashed var(--mirador-border); border-radius: 10px; padding: 18px; color: var(--mirador-muted); }
.stale .figure, .stale .tile .value, .stale .chart { opacity: 0.6; }

header.top { display: flex; align-items: flex-start; gap: 16px; }
header.top .who { flex: 1; min-width: 0; }
.gateway { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.gateway h1 { font-size: 1.15em; font-weight: 600; letter-spacing: -0.01em; }
.switcher, .seg-small { display: inline-flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--mirador-panel-2); }
.switcher button, .seg-small button { border: 0; background: none; padding: 3px 10px; border-radius: 6px; color: var(--mirador-muted); }
.seg-small button { padding: 2px 9px; font-size: 0.92em; }
.switcher button[aria-pressed="true"], .seg-small button[aria-pressed="true"] { background: var(--mirador-panel); color: var(--mirador-text); box-shadow: 0 0 0 1px var(--mirador-border); }
.sub { margin-top: 3px; color: var(--mirador-muted); overflow-wrap: anywhere; }
.actions { display: flex; align-items: center; gap: 12px; white-space: nowrap; }
.fresh { display: inline-flex; align-items: center; gap: 6px; color: var(--mirador-muted); }
.fresh .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--mirador-ok); }
.fresh .dot.busy { background: var(--mirador-accent); animation: pulse 1.2s ease-in-out infinite; }
.fresh .dot.warn { background: var(--mirador-warn); }
.fresh .dot.bad { background: var(--mirador-danger); }
@keyframes pulse { 50% { opacity: 0.3; } }
.icon-button { padding: 4px 7px; display: inline-flex; align-items: center; }
svg.icon { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 1.7; flex: none; }

.hero { display: grid; grid-template-columns: minmax(250px, 0.8fr) minmax(0, 1.4fr); gap: 28px; align-items: stretch; }
.hero .label { font-weight: 600; color: var(--mirador-muted); }
.hero .figure { font-size: 4.15em; font-weight: 600; letter-spacing: -0.035em; line-height: 1.05; margin: 6px 0 10px; font-variant-numeric: proportional-nums; }
.hero .figure .cents { font-size: 0.5em; color: var(--mirador-muted); letter-spacing: -0.01em; vertical-align: 0.62em; margin-left: 2px; }
.delta { display: flex; align-items: center; gap: 6px; color: var(--mirador-muted); }
.facts { margin-top: 14px; display: grid; gap: 12px; }
.facts b { font-weight: 600; }
.meter { position: relative; height: 8px; border-radius: 4px; background: var(--mirador-accent-soft); margin: 0 0 6px; }
.meter .fill { position: absolute; inset: 0 auto 0 0; border-radius: 4px; background: var(--mirador-accent); }
.meter.over .fill { background: var(--mirador-danger); }
.meter .pace { position: absolute; top: -3px; bottom: -3px; width: 2px; border-radius: 1px; background: var(--mirador-text); opacity: 0.55; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 14px; color: var(--mirador-muted); font-size: 0.92em; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.key-line { width: 14px; height: 2px; border-radius: 1px; display: inline-block; flex: none; }
.key-dash { width: 14px; height: 0; border-top: 2px dashed; display: inline-block; flex: none; }
.key-rect { width: 10px; height: 10px; border-radius: 3px; display: inline-block; flex: none; }
.key-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; }
.key-ring { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; border: 2px solid var(--mirador-danger); }
.card-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
.card-head h2 { font-size: 1em; font-weight: 600; }
.card-head .spacer { flex: 1; }
.burnup { min-width: 0; }
.chart { position: relative; min-width: 0; }
.chart svg { display: block; width: 100%; overflow: visible; }
.chart text { fill: var(--mirador-faint); font-size: 0.85em; font-variant-numeric: tabular-nums; }
.chart text.value { fill: var(--mirador-text); font-weight: 600; font-size: 0.92em; }
.chart text.today { fill: var(--mirador-text); }
.chart .gridline { stroke: var(--grid); stroke-width: 1; }
.chart .baseline { stroke: var(--mirador-border); stroke-width: 1; }
.chart .hit { fill: transparent; }
.chart .column.dim .part { opacity: 0.35; }
.chart .part { transition: opacity 120ms; }
.chart g[tabindex]:focus-visible { outline: none; }
.chart g[tabindex]:focus-visible .hit { stroke: var(--mirador-accent); stroke-width: 2; }

.tiles { display: grid; grid-template-columns: repeat(var(--count, 4), minmax(0, 1fr)); border: 1px solid var(--mirador-border); border-radius: 10px; background: var(--mirador-panel); }
.tile { padding: 13px 16px 12px; position: relative; min-width: 0; }
.tile + .tile { border-left: 1px solid var(--mirador-border); }
.tile .label { color: var(--mirador-muted); }
.tile .value { font-size: 1.85em; font-weight: 600; letter-spacing: -0.02em; margin: 2px 0 1px; font-variant-numeric: proportional-nums; }
.tile .note { color: var(--mirador-muted); font-size: 0.92em; display: flex; align-items: center; gap: 5px; }
.tile svg.spark { position: absolute; right: 14px; top: 16px; width: 76px; height: 28px; overflow: visible; }
@media (max-width: 1000px) { .tile svg.spark { display: none; } }
.tile .note.warn { color: var(--mirador-warn); }
.tile .note.danger { color: var(--mirador-danger); }

.tooltip { position: absolute; pointer-events: none; z-index: 5; min-width: 168px; max-width: 320px; padding: 9px 11px; border-radius: 9px; background: var(--mirador-panel); border: 1px solid var(--mirador-border); box-shadow: 0 8px 28px rgb(0 0 0 / 0.14); font-size: 0.92em; display: none; }
.tooltip .when { color: var(--mirador-muted); margin-bottom: 4px; }
.tooltip .total { font-size: 1.25em; font-weight: 600; margin-bottom: 6px; font-variant-numeric: tabular-nums; }
.tooltip .row { display: grid; grid-template-columns: 14px 1fr auto; align-items: center; gap: 7px; line-height: 1.6; }
.tooltip .row b { font-weight: 600; font-variant-numeric: tabular-nums; }
.tooltip .row span { color: var(--mirador-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tooltip .reason { color: var(--mirador-danger); }

table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-weight: 500; color: var(--mirador-muted); font-size: 0.92em; padding: 0 10px 7px; border-bottom: 1px solid var(--mirador-border); white-space: nowrap; }
td { padding: 9px 10px; border-bottom: 1px solid var(--mirador-border); vertical-align: middle; }
tr:last-child td { border-bottom: 0; }
th.r, td.r { text-align: right; }
td.r { font-variant-numeric: tabular-nums; white-space: nowrap; }
td.strong { font-weight: 600; }
td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
tbody tr.opens { cursor: pointer; }
tbody tr.opens:hover td { background: var(--mirador-panel-2); }
tbody tr.opens:hover td:first-child { border-radius: 8px 0 0 8px; }
tbody tr.opens:hover td:last-child { border-radius: 0 8px 8px 0; }
tbody tr.opens:focus-visible { outline: 2px solid var(--mirador-accent); outline-offset: -2px; }
.convo { display: flex; align-items: center; gap: 11px; min-width: 0; }
.agent { flex: none; width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center; font-size: 0.92em; font-weight: 600; background: var(--mirador-panel-2); color: var(--mirador-muted); border: 1px solid var(--mirador-border); }
.convo .text { min-width: 0; }
.convo .title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.convo .meta { color: var(--mirador-muted); font-size: 0.92em; }
.inline-bar { display: inline-block; height: 6px; border-radius: 3px; background: var(--mirador-accent); vertical-align: middle; opacity: 0.85; }
.bar-cell { width: 110px; }
.pill { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--mirador-border); color: var(--mirador-muted); font-size: 0.92em; white-space: nowrap; }
.chev { color: var(--mirador-faint); width: 18px; text-align: right; }

.split { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 28px; }
.ranked { display: grid; gap: 12px; }
.ranked .row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; align-items: baseline; }
.ranked .name { display: flex; align-items: center; gap: 8px; min-width: 0; font-weight: 500; }
.ranked .name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ranked .amount { font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
.ranked .track { grid-column: 1 / -1; height: 6px; border-radius: 3px; background: var(--mirador-panel-2); position: relative; margin-top: 4px; }
.ranked .track i { position: absolute; inset: 0 auto 0 0; border-radius: 3px; }
.ranked .detail { grid-column: 1 / -1; color: var(--mirador-muted); font-size: 0.92em; font-variant-numeric: tabular-nums; }
.providers { margin: 14px 0 0; color: var(--mirador-muted); font-size: 0.92em; }
.cache .big { font-size: 1.85em; font-weight: 600; letter-spacing: -0.02em; }
.segbar { display: flex; gap: 2px; height: 8px; margin: 12px 0 10px; }
.segbar i { display: block; height: 100%; border-radius: 4px; }
.cache ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.cache li { display: grid; grid-template-columns: 12px 1fr auto; gap: 8px; align-items: center; }
.cache li b { font-weight: 600; font-variant-numeric: tabular-nums; }
.cache .saving { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--mirador-border); color: var(--mirador-muted); }
.cache .saving b { color: var(--mirador-text); }
.read { background: var(--mirador-accent); }
.written { background: var(--mirador-accent); opacity: 0.45; }
.uncached { background: var(--mirador-border); }
footer { color: var(--mirador-faint); font-size: 0.92em; }

.back { border: 0; background: none; padding: 0; color: var(--mirador-muted); display: inline-flex; align-items: center; gap: 6px; }
.back:hover { color: var(--mirador-text); }
.focus-title { font-size: 1.55em; font-weight: 600; letter-spacing: -0.02em; margin: 8px 0 2px; overflow-wrap: anywhere; }
.model-cell { display: inline-flex; align-items: center; gap: 7px; }
.model-cell .key-rect { width: 8px; height: 8px; border-radius: 2px; }
.cached { color: var(--mirador-muted); font-size: 0.92em; }
tr.failed td { color: var(--mirador-danger); }
.reason { display: inline-flex; align-items: center; gap: 5px; white-space: normal; text-align: right; }
@media (max-width: 780px) {
  main { padding: 16px 18px 24px; gap: 24px; }
  .hero, .split { grid-template-columns: minmax(0, 1fr); }
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tile + .tile { border-left: 0; }
  .tile:nth-child(even) { border-left: 1px solid var(--mirador-border); }
  .tile:nth-child(n + 3) { border-top: 1px solid var(--mirador-border); }
  .card-head .legend { order: 5; flex-basis: 100%; }
  .bar-cell, .chev { display: none; }
}
`;
document.head.append(style);

const main = document.createElement("main");
document.body.append(main);

/** An element with its attributes and children; text is set as text, never as markup. */
function el(tag, attributes = {}, ...children) {
  return withAttributes(document.createElement(tag), attributes, children);
}

function svg(tag, attributes = {}, ...children) {
  return withAttributes(document.createElementNS(SVG_NS, tag), attributes, children);
}

function withAttributes(element, attributes, children) {
  Object.entries(attributes).forEach(([name, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (name.startsWith("on")) element.addEventListener(name.slice(2), value);
    else element.setAttribute(name, String(value));
  });
  element.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
  return element;
}

const ICONS = {
  refresh: ["M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3"],
  up: ["M8 13V3M4 6.5 8 3l4 3.5"],
  down: ["M8 3v10M4 9.5 8 13l4-3.5"],
  warning: ["M8 2 1.5 13.5h13Z", "M8 6.5v3.2M8 11.6v.2"],
  failed: ["M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Z", "m6 6 4 4m0-4-4 4"],
  unlinked: ["M6.5 9.5 9.5 6.5M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"],
  back: ["M10 3 5 8l5 5"],
};
const icon = (name) => svg("svg", { class: "icon", viewBox: "0 0 16 16", "aria-hidden": "true" }, ICONS[name].map((d) => svg("path", { d })));

const send = (action) => mirador.send(action).catch(() => {});

const percent = (share) => `${Math.round(share * 100)}%`;
const slotColour = (slot) => `var(--m${slot})`;

/** Dollars as the plugin writes them elsewhere: cents under $100, whole dollars under $10,000, then thousands. */
function dollars(amount) {
  if (amount < 100) return `$${amount.toFixed(2)}`;
  if (amount < 10_000) return `$${Math.round(amount).toLocaleString("en-US")}`;
  return `$${(amount / 1000).toFixed(1)}k`;
}

function axisDollars(value) {
  if (value >= 1000) return `$${Number((value / 1000).toFixed(1))}K`;
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

/** Gridlines a round step apart, the top one at or above `highest`. */
function scaleOf(highest, ticks) {
  const raw = Math.max(highest, 0.01) / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw);
  const count = Math.ceil(highest / step - 1e-9) || 1;
  return { step, top: step * count, values: Array.from({ length: count + 1 }, (_, index) => index * step) };
}

const clock = (time) => new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const tooltip = el("div", { class: "tooltip", role: "tooltip" });
document.body.append(tooltip);

function showTooltip(anchor, x, y, rows) {
  tooltip.replaceChildren(...rows.flat().filter(Boolean));
  tooltip.style.display = "block";
  const box = anchor.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = tooltip;
  const left = box.left + scrollX + x;
  const fitsRight = left + 14 + width <= document.documentElement.clientWidth + scrollX - 4;
  tooltip.style.left = `${Math.max(scrollX + 4, fitsRight ? left + 14 : left - width - 14)}px`;
  tooltip.style.top = `${Math.max(scrollY + 4, Math.min(box.top + scrollY + y, scrollY + innerHeight - height - 4))}px`;
}

function hideTooltip() {
  tooltip.style.display = "none";
}

const MARKS = {
  line: (colour) => el("i", { class: "key-line", style: `background:${colour}` }),
  dash: (colour) => el("i", { class: "key-dash", style: `color:${colour}` }),
  rect: (colour) => el("i", { class: "key-rect", style: `background:${colour}` }),
  dot: (colour) => el("i", { class: "key-dot", style: `background:${colour}` }),
  ring: () => el("i", { class: "key-ring" }),
};

const tooltipRow = (mark, colour, label, value) => el("div", { class: "row" }, MARKS[mark](colour), el("span", {}, label), el("b", {}, value));

const legend = (entries) => el("div", { class: "legend" }, entries.map(({ mark, colour, label }) => el("span", {}, MARKS[mark](colour), label)));

const modelLegend = (models, mark = "rect") => legend(models.map(({ model, slot }) => ({ mark, colour: slotColour(slot), label: model })));

/** The charts on the page, drawn once the page is in place and again whenever it changes width. */
let charts = [];

function chart(label, draw, role = "img") {
  const host = el("div", { class: "chart", role, "aria-label": label });
  charts.push({ host, draw });
  return host;
}

function drawCharts() {
  hideTooltip();
  charts.forEach(({ host, draw }) => host.isConnected && host.clientWidth > 0 && host.replaceChildren(draw(host.clientWidth)));
}

function gridlines(group, scale, y, from, to, label = axisDollars) {
  scale.values.forEach((value) => {
    group.append(svg("line", { class: value === 0 ? "baseline" : "gridline", x1: from, x2: to, y1: y(value), y2: y(value) }));
    group.append(svg("text", { x: from - 8, y: y(value) + 4, "text-anchor": "end" }, label(value)));
  });
}

const linePath = (points) => points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");

function topRounded(x, y, width, height, radius = 4) {
  const r = Math.min(radius, height, width / 2);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

/** This month's running total against last month's, with where this pace ends the month. */
function burnupChart(month, width) {
  const height = 196;
  const margin = { left: 46, right: 74, top: 18, bottom: 22 };
  const plotWidth = Math.max(width - margin.left - margin.right, 60);
  const plotHeight = height - margin.top - margin.bottom;
  const spent = month.runningTotals.at(-1) ?? 0;
  const previous = month.previousRunningTotals.slice(0, month.length);
  const projecting = month.dayOfMonth < month.length;
  const scale = scaleOf(Math.max(month.previousRunningTotals.at(-1) ?? 0, month.projectedAmount, spent) * 1.04, 3);
  const x = (day) => margin.left + ((day - 1) / Math.max(month.length - 1, 1)) * plotWidth;
  const y = (value) => margin.top + plotHeight - (value / scale.top) * plotHeight;
  const dailyPace = projecting ? (month.projectedAmount - spent) / (month.length - month.dayOfMonth) : 0;
  const chartSvg = svg("svg", { height });
  gridlines(chartSvg, scale, y, margin.left, width - margin.right);
  [1, 8, 15, 22, 29].filter((day) => day <= month.length).forEach((day) => chartSvg.append(svg("text", { x: x(day), y: height - 4, "text-anchor": "middle" }, String(day))));
  const along = (totals) => totals.map((total, index) => [x(index + 1), y(total)]);
  if (previous.length > 0) chartSvg.append(svg("path", { d: linePath(along(previous)), fill: "none", stroke: "var(--mirador-faint)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  const thisMonth = along(month.runningTotals);
  chartSvg.append(svg("path", { d: `${linePath(thisMonth)}L${x(month.dayOfMonth)},${y(0)}L${x(1)},${y(0)}Z`, fill: "var(--wash)" }));
  chartSvg.append(svg("path", { d: linePath(thisMonth), fill: "none", stroke: "var(--mirador-accent)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  const todayX = x(month.dayOfMonth);
  if (projecting) {
    const endY = y(month.projectedAmount);
    chartSvg.append(svg("path", { d: `M${todayX},${y(spent)}L${x(month.length)},${endY}`, stroke: "var(--mirador-accent)", "stroke-width": 2, "stroke-dasharray": "2 4", "stroke-linecap": "round", fill: "none", opacity: 0.8 }));
    chartSvg.append(svg("circle", { cx: x(month.length), cy: endY, r: 3.5, fill: "var(--mirador-bg)", stroke: "var(--mirador-accent)", "stroke-width": 2 }));
    chartSvg.append(svg("text", { class: "value", x: x(month.length) + 9, y: endY + 4 }, `≈${month.projected}`));
  }
  chartSvg.append(svg("circle", { cx: todayX, cy: y(spent), r: 5, fill: "var(--mirador-accent)", stroke: "var(--mirador-bg)", "stroke-width": 2 }));
  chartSvg.append(svg("text", { class: "value", x: todayX, y: y(spent) - 12, "text-anchor": "middle" }, dollars(spent)));
  const crosshair = svg("line", { y1: margin.top, y2: margin.top + plotHeight, stroke: "var(--mirador-faint)", "stroke-width": 1, opacity: 0 });
  const hit = svg("rect", { class: "hit", x: margin.left, y: margin.top, width: plotWidth, height: plotHeight });
  hit.addEventListener("pointermove", (event) => {
    const box = chartSvg.getBoundingClientRect();
    const day = Math.min(month.length, Math.max(1, Math.round(((event.clientX - box.left - margin.left) / plotWidth) * (month.length - 1) + 1)));
    crosshair.setAttribute("x1", x(day));
    crosshair.setAttribute("x2", x(day));
    crosshair.setAttribute("opacity", 1);
    const soFar = month.runningTotals[day - 1];
    const before = month.previousRunningTotals[day - 1];
    showTooltip(chartSvg, x(day), margin.top, [
      el("div", { class: "when" }, `Day ${day} of the month`),
      soFar === undefined ? tooltipRow("dash", "var(--mirador-accent)", `${month.name} on this pace`, dollars(spent + dailyPace * (day - month.dayOfMonth))) : tooltipRow("line", "var(--mirador-accent)", month.name, dollars(soFar)),
      before === undefined ? null : tooltipRow("line", "var(--mirador-faint)", month.previousName, dollars(before)),
    ]);
  });
  hit.addEventListener("pointerleave", () => {
    crosshair.setAttribute("opacity", 0);
    hideTooltip();
  });
  chartSvg.append(crosshair, hit);
  return chartSvg;
}

/** Each of the last 30 days, its spend stacked by model, the most spent on at the bottom. */
function dailyChart(daily, width) {
  const height = 200;
  const margin = { left: 46, right: 4, top: 8, bottom: 24 };
  const plotWidth = Math.max(width - margin.left - margin.right, 60);
  const plotHeight = height - margin.top - margin.bottom;
  const band = plotWidth / daily.days.length;
  const barWidth = Math.max(2, Math.min(22, band - 6));
  const scale = scaleOf(Math.max(...daily.days.map(({ spend }) => spend)), 3);
  const tall = (value) => (value / scale.top) * plotHeight;
  const chartSvg = svg("svg", { height });
  gridlines(chartSvg, scale, (value) => margin.top + plotHeight - tall(value), margin.left, width - margin.right);
  const lastIndex = daily.days.length - 1;
  const columns = daily.days.map((day, index) => {
    const x = margin.left + index * band + (band - barWidth) / 2;
    const isToday = index === lastIndex;
    const column = svg("g", { class: "column", tabindex: 0, "data-key": `day:${day.day}`, "aria-label": `${day.label}: ${day.shown}` });
    column.append(svg("rect", { class: "hit", x: margin.left + index * band, y: margin.top, width: band, height: plotHeight, rx: 4 }));
    const drawn = day.parts.filter((part) => tall(part.spend) >= 1);
    drawn.reduce((base, part, partIndex) => {
      const partHeight = tall(part.spend);
      const isTop = partIndex === drawn.length - 1;
      const shown = Math.max(1, partHeight - (isTop ? 0 : 2));
      const top = base - partHeight;
      column.append(
        isTop
          ? svg("path", { class: "part", d: topRounded(x, top, barWidth, shown), fill: slotColour(part.slot) })
          : svg("rect", { class: "part", x, y: base - shown, width: barWidth, height: shown, fill: slotColour(part.slot) }),
      );
      return top;
    }, margin.top + plotHeight);
    const crowdsToday = !isToday && index > lastIndex - 4;
    if (day.tick && !crowdsToday) {
      column.append(svg("text", { class: isToday ? "today" : null, x: isToday ? x + barWidth : x + barWidth / 2, y: height - 6, "text-anchor": isToday ? "end" : "middle" }, day.tick));
    }
    const show = () => {
      columns.forEach((other) => other.classList.toggle("dim", other !== column));
      showTooltip(chartSvg, x + barWidth, margin.top, [
        el("div", { class: "when" }, isToday ? `${day.label}, so far` : day.label),
        el("div", { class: "total" }, day.shown),
        [...day.parts].reverse().map((part) => tooltipRow("rect", slotColour(part.slot), part.model, part.shown)),
        el("div", { class: "when", style: "margin:6px 0 0" }, `${day.requests.toLocaleString("en-US")} request${day.requests === 1 ? "" : "s"}`),
      ]);
    };
    const hide = () => {
      columns.forEach((other) => other.classList.remove("dim"));
      hideTooltip();
    };
    column.addEventListener("pointerenter", show);
    column.addEventListener("focus", show);
    column.addEventListener("pointerleave", hide);
    column.addEventListener("blur", hide);
    return column;
  });
  chartSvg.append(...columns);
  return chartSvg;
}

/** A conversation's running spend, a step at each request, its failed requests ringed. */
function timelineChart(focus, width) {
  const height = 170;
  const margin = { left: 46, right: 60, top: 14, bottom: 22 };
  const plotWidth = Math.max(width - margin.left - margin.right, 60);
  const plotHeight = height - margin.top - margin.bottom;
  const points = focus.timeline;
  const first = points[0].time;
  const last = points.at(-1).time;
  const span = Math.max(last - first, 1);
  const total = points.at(-1).total;
  const scale = scaleOf(total, 3);
  const x = (time) => (last === first ? margin.left + plotWidth / 2 : margin.left + ((time - first) / span) * plotWidth);
  const y = (value) => margin.top + plotHeight - (value / scale.top) * plotHeight;
  const chartSvg = svg("svg", { height });
  gridlines(chartSvg, scale, y, margin.left, width - margin.right);
  const spansDays = span > 20 * 3_600_000;
  const tickCount = last === first ? 1 : Math.min(5, Math.max(2, Math.floor(plotWidth / (spansDays ? 150 : 110))));
  Array.from({ length: tickCount }, (_, index) => (tickCount === 1 ? first : first + (span * index) / (tickCount - 1))).forEach((time, index) => {
    const anchor = tickCount === 1 ? "middle" : index === 0 ? "start" : index === tickCount - 1 ? "end" : "middle";
    const label = spansDays ? `${new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${clock(time)}` : clock(time);
    chartSvg.append(svg("text", { x: x(time), y: height - 4, "text-anchor": anchor }, label));
  });
  const steps = points.map((point, index) => ({ point, before: index === 0 ? 0 : points[index - 1].total }));
  const path = steps.map(({ point, before }, index) => `${index ? "L" : "M"}${x(point.time).toFixed(1)},${y(before).toFixed(1)}V${y(point.total).toFixed(1)}`).join("");
  chartSvg.append(svg("path", { d: `${path}L${x(last)},${y(0)}L${x(first)},${y(0)}Z`, fill: "var(--wash)" }));
  chartSvg.append(svg("path", { d: path, fill: "none", stroke: "var(--mirador-accent)", "stroke-width": 2, "stroke-linejoin": "round" }));
  chartSvg.append(svg("text", { class: "value", x: x(last) + 10, y: y(total) + 4 }, dollars(total)));
  chartSvg.append(
    ...points.map((point) => {
      const cx = x(point.time);
      const cy = y(point.total);
      const label = `${clock(point.time)}, ${point.model}, ${point.failed ? "failed" : point.spend}`;
      const group = svg("g", { tabindex: 0, "aria-label": label });
      group.append(
        point.failed
          ? svg("circle", { cx, cy, r: 4.5, fill: "var(--mirador-bg)", stroke: "var(--mirador-danger)", "stroke-width": 2 })
          : svg("circle", { cx, cy, r: 4.5, fill: slotColour(point.slot), stroke: "var(--mirador-bg)", "stroke-width": 2 }),
        svg("circle", { class: "hit", cx, cy, r: 12 }),
      );
      const show = () =>
        showTooltip(chartSvg, cx, cy - 10, [
          el("div", { class: "when" }, `${clock(point.time)} · ${point.model}`),
          el("div", { class: "total" }, point.failed ? "Failed" : point.spend),
          point.failed && point.failure ? el("div", { class: "reason" }, point.failure) : null,
          el("div", { class: "when", style: "margin:4px 0 0" }, `${dollars(point.total)} so far`),
        ]);
      group.addEventListener("pointerenter", show);
      group.addEventListener("focus", show);
      group.addEventListener("pointerleave", hideTooltip);
      group.addEventListener("blur", hideTooltip);
      return group;
    }),
  );
  return chartSvg;
}

function sparkline(trend) {
  const most = Math.max(...trend);
  if (most <= 0) return null;
  const sx = (index) => (index / (trend.length - 1)) * 76;
  const sy = (value) => 28 - (value / most) * 26;
  return svg(
    "svg",
    { class: "spark", "aria-hidden": "true" },
    svg("path", { d: linePath(trend.map((value, index) => [sx(index), sy(value)])), fill: "none", stroke: "var(--mirador-faint)", "stroke-width": 1.5, "stroke-linejoin": "round" }),
    svg("circle", { cx: sx(trend.length - 1), cy: sy(trend.at(-1)), r: 3, fill: "var(--mirador-accent)", stroke: "var(--mirador-panel)", "stroke-width": 1.5 }),
  );
}

/** What the window remembers between the states the plugin sends: how the daily spend and the requests show. */
const shownAs = { daily: "chart", requests: "latest" };

function toggle(label, key, options) {
  return el(
    "span",
    { class: "seg-small", role: "group", "aria-label": label },
    options.map(([value, text]) =>
      el(
        "button",
        {
          "aria-pressed": String(shownAs[key] === value),
          "data-key": `${key}:${value}`,
          onclick: () => {
            shownAs[key] = value;
            redraw();
          },
        },
        text,
      ),
    ),
  );
}

function refreshButton() {
  return el("button", { class: "icon-button", "aria-label": "Refresh", "data-hint": "Ask the gateway again", "data-key": "refresh", onclick: () => send({ refresh: true }) }, icon("refresh"));
}

function freshness({ loading, problem, stale, asOf }) {
  const [dot, text] = loading ? ["busy", "Updating…"] : problem ? ["bad", asOf ? `As of ${asOf}` : "Not reached"] : stale ? ["warn", `As of ${asOf}`] : asOf ? ["", `Updated ${asOf}`] : [null, null];
  return text === null ? null : el("span", { class: "fresh" }, el("span", { class: `dot ${dot}` }), text);
}

function overviewHeader({ gateways, selected, overview }) {
  const switcher =
    gateways.length > 1
      ? el(
          "span",
          { class: "switcher", role: "group", "aria-label": "Gateway" },
          gateways.map(({ id, label, profiles }) => el("button", { "aria-pressed": String(id === selected), "data-hint": `Used by ${profiles.join(", ")}`, "data-key": `gateway:${id}`, onclick: () => send({ gateway: id }) }, label)),
        )
      : null;
  const single = gateways.length === 1 ? gateways[0].label : null;
  const about = [single, overview.who, overview.keyAlias ? `key ${overview.keyAlias}` : null, "days in UTC"].filter(Boolean).join(" · ");
  return el(
    "header",
    { class: "top" },
    el("div", { class: "who" }, el("div", { class: "gateway" }, el("h1", {}, "LiteLLM"), switcher), el("div", { class: "sub" }, about)),
    el("div", { class: "actions" }, freshness(overview), refreshButton(), el("button", { class: "link", onclick: () => mirador.openLink(overview.uiUrl) }, "Open LiteLLM UI ↗")),
  );
}

function changeLine(month) {
  if (month.change === null) return null;
  const since = month.dayOfMonth === 1 ? `${month.previousName} 1` : `the first ${month.dayOfMonth} days of ${month.previousName}`;
  if (Math.abs(month.change) < 0.005) return el("div", { class: "delta" }, `About the same as ${since} (${month.sameDaysBefore})`);
  const more = month.change > 0;
  return el("div", { class: "delta" }, icon(more ? "up" : "down"), `${percent(Math.abs(month.change))} ${more ? "more" : "less"} than ${since} (${month.sameDaysBefore})`);
}

function paceLine(month) {
  const spent = month.runningTotals.at(-1) ?? 0;
  const previousSpent = (month.previousRunningTotals.at(-1) ?? 0) > 0;
  const previous = previousSpent ? ` ${month.previousName} came to ${month.previousTotal}.` : "";
  if (spent === 0 && month.projectedAmount === 0) return el("div", { class: "muted" }, `Nothing spent this month yet.${previous}`);
  if (month.dayOfMonth === month.length) return el("div", {}, `The month ends today.${previous}`);
  return el("div", {}, "On this pace, ", el("b", {}, `about ${month.projected}`), ` by ${month.endsOn}.${previous}`);
}

function budgetMeter(budget) {
  const used = Math.round(budget.used * 100);
  const into = budget.elapsed === null ? "" : `, ${percent(budget.elapsed)} into its period`;
  const resets = budget.resetsOn ? ` Resets ${budget.resetsOn}.` : "";
  return el(
    "div",
    {},
    el(
      "div",
      { class: `meter${budget.used >= 1 ? " over" : ""}`, role: "meter", "aria-label": "Budget used", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.min(used, 100) },
      el("div", { class: "fill", style: `width:${Math.min(100, budget.used * 100)}%` }),
      budget.elapsed === null ? null : el("div", { class: "pace", style: `left:calc(${budget.elapsed * 100}% - 1px)` }),
    ),
    el("div", { class: "muted" }, el("b", { style: "color:var(--mirador-text)" }, `${used}%`), ` of ${budget.keyAlias ? `the key ${budget.keyAlias}'s` : "the key's"} ${budget.limit} budget${into}.${resets}`),
  );
}

function hero({ month, budget }) {
  const [whole, cents] = month.shown.split(".");
  const previousSpent = (month.previousRunningTotals.at(-1) ?? 0) > 0;
  const projecting = month.dayOfMonth < month.length;
  const summary = `Spend through ${month.name} so far, ${month.shown}${projecting ? `; on this pace about ${month.projected} by ${month.endsOn}` : ""}${previousSpent ? `, against ${month.previousTotal} in ${month.previousName}` : ""}.`;
  return el(
    "section",
    { class: "hero", "aria-label": "This month" },
    el("div", {}, el("div", { class: "label" }, `${month.name} so far`), el("div", { class: "figure" }, whole, el("span", { class: "cents" }, `.${cents}`)), changeLine(month), el("div", { class: "facts" }, paceLine(month), budget ? budgetMeter(budget) : null)),
    el(
      "div",
      { class: "burnup" },
      el(
        "div",
        { class: "card-head" },
        el("h2", {}, "Spend through the month"),
        el("span", { class: "spacer" }),
        legend([
          { mark: "line", colour: "var(--mirador-accent)", label: month.name },
          projecting ? { mark: "dash", colour: "var(--mirador-accent)", label: "On this pace" } : null,
          previousSpent ? { mark: "line", colour: "var(--mirador-faint)", label: month.previousName } : null,
        ].filter(Boolean)),
      ),
      chart(summary, (width) => burnupChart(month, width)),
    ),
  );
}

const tile = (label, value, note, extra = null) => el("div", { class: "tile" }, el("div", { class: "label" }, label), el("div", { class: "value" }, value), note, extra);

function tiles({ tiles: { today, week, requests, caching } }) {
  const weekNote = week.change === null ? "Since Monday" : `${week.change >= 0 ? "+" : "−"}${percent(Math.abs(week.change))} on the same days last week`;
  const failedNote =
    requests.failed > 0
      ? el("div", { class: "note warn" }, icon("warning"), `${requests.failed.toLocaleString("en-US")} failed, ${(requests.failedShare * 100).toFixed(1)}%`)
      : el("div", { class: "note" }, requests.count > 0 ? "None failed" : "None yet");
  const shown = [
    tile("Today", today.shown, el("div", { class: "note" }, `${today.requests.toLocaleString("en-US")} request${today.requests === 1 ? "" : "s"} so far`), sparkline(today.trend)),
    tile("This week", week.shown, el("div", { class: "note" }, weekNote)),
    tile("Requests this month", requests.count.toLocaleString("en-US"), failedNote),
    caching ? tile("Saved by prompt caching", caching.saved, el("div", { class: "note" }, `${percent(caching.readShare)} of input from the cache`)) : null,
  ].filter(Boolean);
  return el("section", { class: "tiles", "aria-label": "At a glance", style: `--count:${shown.length}` }, shown);
}

function dailyTable(daily) {
  return el(
    "table",
    {},
    el("thead", {}, el("tr", {}, el("th", {}, "Day"), daily.models.map(({ model }) => el("th", { class: "r" }, model)), el("th", { class: "r" }, "Requests"), el("th", { class: "r" }, "Total"))),
    el(
      "tbody",
      {},
      [...daily.days].reverse().map((day) =>
        el(
          "tr",
          {},
          el("td", {}, day.label),
          daily.models.map(({ model }) => el("td", { class: "r" }, day.parts.find((part) => part.model === model)?.shown ?? "")),
          el("td", { class: "r" }, day.requests.toLocaleString("en-US")),
          el("td", { class: "r strong" }, day.shown),
        ),
      ),
    ),
  );
}

function eachDay({ daily }) {
  const anySpend = daily.days.some(({ spend }) => spend > 0);
  const body = !anySpend
    ? el("p", { class: "empty" }, "Nothing spent in the last 30 days.")
    : shownAs.daily === "table"
      ? dailyTable(daily)
      : chart("Spend each day of the last 30 days, split by model. The table view lists every figure.", (width) => dailyChart(daily, width), "group");
  return el(
    "section",
    { "aria-label": "Each day" },
    el("div", { class: "card-head" }, el("h2", {}, "Each day, by model"), el("span", { class: "muted" }, "The last 30 days"), el("span", { class: "spacer" }), anySpend ? modelLegend(daily.models) : null, anySpend ? toggle("Show as", "daily", [["chart", "Chart"], ["table", "Table"]]) : null),
    body,
  );
}

const agentMark = (agent) => (agent ? (AGENT_MARKS[agent.id] ?? agent.name.slice(0, 1).toUpperCase()) : "?");

function conversationCell({ title, agent, profile, sessions }) {
  const meta = [agent?.name, profile, sessions > 1 ? `${sessions} sessions` : null].filter(Boolean).join(" · ");
  return el(
    "td",
    {},
    el("div", { class: "convo" }, el("span", { class: "agent", "data-hint": agent?.name ?? "Unknown agent", "aria-hidden": "true" }, agentMark(agent)), el("div", { class: "text" }, el("div", { class: "title" }, title), el("div", { class: "meta" }, meta))),
  );
}

function conversationRow(conversation, most) {
  const { id, linked, lastRequest, requests, spend, amount } = conversation;
  if (linked === "unlinked") {
    return el(
      "tr",
      {},
      conversationCell(conversation),
      el("td", { class: "r muted" }, lastRequest ?? "—"),
      el("td", { colspan: 3, class: "r" }, el("span", { class: "pill", "data-hint": NOT_LINKED_HINT, tabindex: 0 }, icon("unlinked"), "Not linked")),
      el("td", { class: "chev" }),
    );
  }
  const open = () => send({ conversation: id });
  return el(
    "tr",
    { class: "opens", tabindex: 0, "data-key": `conversation:${id}`, onclick: open, onkeydown: (event) => (event.key === "Enter" || event.key === " ") && (event.preventDefault(), open()) },
    conversationCell(conversation),
    el("td", { class: "r muted" }, lastRequest ?? "—"),
    el("td", { class: "r" }, requests === null ? "…" : requests.toLocaleString("en-US")),
    el("td", { class: "r strong" }, spend ?? "…"),
    el("td", { class: "bar-cell" }, most > 0 && amount > 0 ? el("span", { class: "inline-bar", style: `width:${Math.max(3, (amount / most) * 100)}%` }) : null),
    el("td", { class: "chev", "aria-hidden": "true" }, "›"),
  );
}

function conversations({ conversations: listed }) {
  const most = Math.max(0, ...listed.map(({ amount }) => amount));
  const body =
    listed.length === 0
      ? el("p", { class: "empty" }, "Conversations on this gateway's profiles show here once they've run.")
      : el(
          "table",
          {},
          el("thead", {}, el("tr", {}, el("th", {}, "Conversation"), el("th", { class: "r" }, "Last request"), el("th", { class: "r" }, "Requests"), el("th", { class: "r" }, "Spend"), el("th", { class: "bar-cell" }), el("th", { class: "chev" }))),
          el("tbody", {}, listed.map((conversation) => conversationRow(conversation, most))),
        );
  return el("section", { "aria-label": "Mirador conversations" }, el("div", { class: "card-head" }, el("h2", {}, "Mirador conversations"), el("span", { class: "muted" }, "On this gateway, the latest first")), body);
}

function byModel({ models, providers }) {
  const most = models[0]?.spend ?? 0;
  const ranked =
    models.length === 0
      ? el("p", { class: "empty" }, "No spend this month yet.")
      : el(
          "div",
          { class: "ranked" },
          models.map(({ model, slot, shown, spend, requests, each, share }) =>
            el(
              "div",
              { class: "row" },
              el("div", { class: "name" }, MARKS.rect(slotColour(slot)), el("span", {}, model)),
              el("div", { class: "amount" }, shown),
              el("div", { class: "track" }, el("i", { style: `width:${most > 0 ? (spend / most) * 100 : 0}%;background:${slotColour(slot)}` })),
              el("div", { class: "detail" }, [`${requests.toLocaleString("en-US")} request${requests === 1 ? "" : "s"}`, each ? `${each} each` : null, `${percent(share)} of the month`].filter(Boolean).join(" · ")),
            ),
          ),
        );
  const byProvider = providers.length > 0 ? el("p", { class: "providers" }, `By provider: ${providers.map(({ provider, shown, share }) => `${provider} ${shown} (${percent(share)})`).join(" · ")}`) : null;
  return el("section", { "aria-label": "By model" }, el("div", { class: "card-head" }, el("h2", {}, "By model"), el("span", { class: "muted" }, "This month")), ranked, byProvider);
}

function caching({ cache }) {
  const parts = [
    { kind: "read", label: "Read from the cache", share: cache.readShare, count: cache.read },
    { kind: "written", label: "Written to the cache", share: cache.writtenShare, count: cache.written },
    { kind: "uncached", label: "Not cached", share: cache.uncachedShare, count: cache.uncached },
  ];
  return el(
    "section",
    { class: "cache", "aria-label": "Prompt caching" },
    el("div", { class: "card-head" }, el("h2", {}, "Prompt caching"), el("span", { class: "muted" }, "This month")),
    el("div", {}, el("span", { class: "big" }, percent(cache.readShare)), " ", el("span", { class: "muted" }, "of input tokens came from the cache")),
    el(
      "div",
      { class: "segbar", role: "img", "aria-label": `Input tokens: ${parts.map(({ label, share }) => `${percent(share)} ${label.toLowerCase()}`).join(", ")}` },
      parts.filter(({ share }) => share > 0).map(({ kind, share }) => el("i", { class: kind, style: `width:${share * 100}%` })),
    ),
    el("ul", {}, parts.map(({ kind, label, count }) => el("li", {}, el("i", { class: `key-rect ${kind}` }), el("span", {}, label), el("b", {}, count)))),
    cache.savedShare > 0 ? el("div", { class: "saving" }, "Caching saved ", el("b", {}, cache.saved), ` this month, ${percent(cache.savedShare)} of what these requests would have cost without it.`) : null,
  );
}

function overviewPage(state) {
  const { overview } = state;
  const header = overviewHeader(state);
  const problem = overview.problem ? el("p", { class: "problem", role: "alert" }, overview.asOf ? `As of ${overview.asOf}. ${overview.problem}` : overview.problem) : null;
  if (!overview.known) return [header, problem ?? el("p", { class: "empty" }, "Asking the gateway…"), conversations(state)];
  const stale = overview.stale ? "stale" : null;
  return [
    header,
    problem,
    el("div", { class: stale, style: "display:grid;gap:28px" }, hero(overview), tiles(overview), eachDay(overview)),
    conversations(state),
    overview.cache ? el("div", { class: "split" }, byModel(overview), caching(overview)) : byModel(overview),
    el("footer", {}, "Spend and tokens as the gateway logged them, in UTC days. A conversation's requests count when its agent names its session in them: Claude Code and pi do."),
  ];
}

function focusTiles(focus) {
  const failed = focus.failed > 0 ? el("div", { class: "note danger" }, icon("failed"), `${focus.failed} failed`) : el("div", { class: "note" }, "None failed");
  const shown = [
    tile("Spend", focus.spend, el("div", { class: "note" }, focus.perRequest ? `${focus.perRequest} a request` : "")),
    tile("Requests", focus.count.toLocaleString("en-US"), failed),
    tile("Input", focus.input, el("div", { class: "note" }, focus.cachedShare === null ? "tokens" : `${percent(focus.cachedShare)} from the cache`)),
    tile("Output", focus.output, el("div", { class: "note" }, "tokens")),
    tile("First token", focus.firstToken ?? "—", el("div", { class: "note" }, focus.firstToken ? `median, ${focus.slowestFirstToken} at worst` : "")),
  ];
  return el("section", { class: "tiles", "aria-label": "This conversation", style: `--count:${shown.length}` }, shown);
}

function requestRow(request, costliest) {
  const time = el("td", { class: "num" }, request.at);
  const model = el("td", {}, el("span", { class: "model-cell" }, MARKS.rect(slotColour(request.slot)), request.model));
  if (request.failed) {
    return el("tr", { class: "failed" }, time, model, el("td", { colspan: 4, class: "r" }, el("span", { class: "reason" }, icon("failed"), `Failed: ${request.failure ?? "the gateway gave no reason"}`)), el("td", { class: "r" }, request.spend));
  }
  return el(
    "tr",
    {},
    time,
    model,
    el("td", { class: "r" }, request.input, request.cachedShare === null ? null : el("span", { class: "cached" }, ` · ${percent(request.cachedShare)} cached`)),
    el("td", { class: "r" }, request.output),
    el("td", { class: "r" }, request.firstToken ?? "—"),
    el("td", { class: "r" }, request.took ?? "—"),
    el("td", { class: costliest.has(request.id) ? "r strong" : "r" }, request.spend),
  );
}

function requestsTable(focus) {
  const byCost = [...focus.requests].sort((one, other) => other.cost - one.cost);
  const costliest = new Set(byCost.slice(0, 3).filter(({ cost }) => cost > 0).map(({ id }) => id));
  const rows = shownAs.requests === "costliest" ? byCost : focus.requests;
  return el(
    "table",
    {},
    el("thead", {}, el("tr", {}, el("th", {}, "Time"), el("th", {}, "Model"), el("th", { class: "r" }, "Input"), el("th", { class: "r" }, "Output"), el("th", { class: "r" }, "First token"), el("th", { class: "r" }, "Took"), el("th", { class: "r" }, "Cost"))),
    el("tbody", {}, rows.map((request) => requestRow(request, costliest))),
  );
}

function focusPage({ focus, gateways, selected }) {
  const gatewayLabel = gateways.find(({ id }) => id === selected)?.label;
  const started = focus.started ? `started ${focus.started}` : null;
  const about = [focus.agent?.name, focus.profile ? `profile ${focus.profile}` : null, focus.sessions > 1 ? `${focus.sessions} sessions` : null, started].filter(Boolean).join(" · ");
  const header = el(
    "header",
    { class: "top" },
    el("div", { class: "who" }, el("button", { class: "back", "data-key": "back", onclick: () => send({ back: true }) }, icon("back"), gatewayLabel ? `All spend on ${gatewayLabel}` : "All spend"), el("h1", { class: "focus-title" }, focus.title), el("div", { class: "sub" }, about)),
    el("div", { class: "actions" }, focus.loading ? freshness({ loading: true }) : null, refreshButton()),
  );
  const problem = focus.problem ? el("p", { class: "problem", role: "alert" }, focus.problem) : null;
  if (focus.count === 0) {
    const empty = focus.loading ? "Asking the gateway…" : `The gateway logged no request of this conversation yet. ${focus.agent && !["claude", "pi"].includes(focus.agent.id) ? `${focus.agent.name} may not name its session in its requests: Claude Code and pi do.` : ""}`;
    return [header, problem, el("p", { class: "empty" }, empty.trim())];
  }
  const anyFailed = focus.timeline.some(({ failed }) => failed);
  const timelineLegend = legend([...focus.models.map(({ model, slot }) => ({ mark: "dot", colour: slotColour(slot), label: model })), anyFailed ? { mark: "ring", label: "failed" } : null].filter(Boolean));
  return [
    header,
    problem,
    focusTiles(focus),
    focus.timeline.length > 0
      ? el(
          "section",
          { "aria-label": "Spend over the conversation" },
          el("div", { class: "card-head" }, el("h2", {}, "Spend over the conversation"), el("span", { class: "spacer" }), timelineLegend),
          chart(`The conversation's spend over time, up to ${focus.spend}. The requests table lists each request.`, (width) => timelineChart(focus, width), "group"),
        )
      : null,
    el(
      "section",
      { "aria-label": "Requests" },
      el("div", { class: "card-head" }, el("h2", {}, "Requests"), focus.requests.length < focus.count ? el("span", { class: "muted" }, `The latest ${focus.requests.length} of ${focus.count}`) : null, el("span", { class: "spacer" }), toggle("Order", "requests", [["latest", "Latest first"], ["costliest", "Costliest first"]])),
      requestsTable(focus),
    ),
  ];
}

function setupPage() {
  return [
    el("header", { class: "top" }, el("div", { class: "who" }, el("h1", {}, "LiteLLM"))),
    el("p", { class: "empty" }, "No profile has a LiteLLM gateway set up yet. In Profiles, open a profile's Plugins tab, turn on “Uses a LiteLLM gateway”, and give its URL and access key, or set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN in its Launch environment."),
  ];
}

let lastState = null;

function draw(state) {
  lastState = state;
  const focused = document.activeElement?.closest?.("[data-key]")?.dataset.key;
  charts = [];
  hideTooltip();
  const page = state.focus ? focusPage(state) : state.overview ? overviewPage(state) : setupPage();
  main.replaceChildren(...page.filter(Boolean));
  drawCharts();
  if (focused) main.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
}

function redraw() {
  if (lastState) draw(lastState);
}

const colourProbe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

function lightnessOf(colour) {
  colourProbe.clearRect(0, 0, 1, 1);
  colourProbe.fillStyle = "#000";
  colourProbe.fillStyle = colour;
  colourProbe.fillRect(0, 0, 1, 1);
  const [red, green, blue] = colourProbe.getImageData(0, 0, 1, 1).data;
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

/** Mirador sends its colours, not whether they are dark, so the chart colours follow how light its background is. */
function followTheme() {
  const background = getComputedStyle(document.documentElement).getPropertyValue("--mirador-bg").trim();
  const dark = background ? lightnessOf(background) < 0.5 : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

new MutationObserver(followTheme).observe(document.head, { childList: true, subtree: true, characterData: true });
followTheme();

let drawnWidth = 0;
new ResizeObserver(() => {
  if (main.clientWidth === drawnWidth) return;
  drawnWidth = main.clientWidth;
  drawCharts();
}).observe(main);

let lastSent = "";

/** The plugin sends its state after every fetch; one that changed nothing would only close an open tooltip. */
function drawChanged(state) {
  const sent = JSON.stringify(state);
  if (sent === lastSent) return;
  lastSent = sent;
  draw(state);
}

mirador.onState(drawChanged);
send({ look: true });
setInterval(() => send({ look: true }), ASK_AGAIN_MS);
