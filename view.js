const mirador = window.mirador;
const ASK_AGAIN_MS = 60_000;

const style = document.createElement("style");
style.textContent = `
html { background: var(--mirador-bg); min-height: 100%; }
body { margin: 0; font: calc(13px * var(--mirador-font-scale, 1)) var(--mirador-font, system-ui); color: var(--mirador-text); background: var(--mirador-bg); }
main { max-width: 980px; margin: 0 auto; padding: 18px 22px 28px; display: grid; gap: 22px; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
h1 { font-size: 1.25em; margin: 0; flex: 1; }
h2 { font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.04em; color: var(--mirador-muted); margin: 0 0 8px; font-weight: 600; }
button { font: inherit; color: var(--mirador-text); background: var(--mirador-panel-2); border: 1px solid var(--mirador-border); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
button:hover { border-color: var(--mirador-accent); }
button.link { background: none; border: 0; padding: 0; color: var(--mirador-accent); }
.muted { color: var(--mirador-muted); }
.problem { color: var(--mirador-danger); }
.gateways { display: flex; gap: 6px; flex-wrap: wrap; }
.gateways button[aria-pressed="true"] { background: var(--mirador-accent-soft); border-color: var(--mirador-accent); }
.tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.tile { border: 1px solid var(--mirador-border); border-radius: 10px; padding: 12px 14px; background: var(--mirador-panel); }
.tile .label { color: var(--mirador-muted); font-size: 0.9em; }
.tile .value { font-size: 1.9em; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 2px; }
.stale .value, .stale .bars { opacity: 0.55; }
svg.bars { width: 100%; height: 150px; display: block; overflow: visible; }
svg.bars .bar { fill: var(--mirador-accent); }
svg.bars .hit { fill: transparent; }
svg.bars g:hover .bar, svg.bars g:focus-visible .bar { fill: var(--mirador-text); }
svg.bars .axis { stroke: var(--mirador-border); stroke-width: 1; }
svg.bars text { fill: var(--mirador-muted); font-size: 11px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th { text-align: left; font-weight: 600; color: var(--mirador-muted); font-size: 0.9em; padding: 4px 8px; border-bottom: 1px solid var(--mirador-border); }
td { padding: 5px 8px; border-bottom: 1px solid var(--mirador-border); vertical-align: middle; }
td.number, th.number { text-align: right; white-space: nowrap; }
tr.failed td { color: var(--mirador-danger); }
tbody tr.opens { cursor: pointer; }
tbody tr.opens:hover { background: var(--mirador-panel-2); }
.share { height: 8px; border-radius: 4px; background: var(--mirador-accent); min-width: 2px; }
.empty { border: 1px dashed var(--mirador-border); border-radius: 10px; padding: 18px; color: var(--mirador-muted); }
`;
document.head.append(style);

const main = document.createElement("main");
document.body.append(main);

/** An element with its attributes and children; text is set as text, never as markup. */
function el(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  Object.entries(attributes).forEach(([name, value]) => {
    if (value === undefined || value === null || value === false) return;
    if (name.startsWith("on")) element.addEventListener(name.slice(2), value);
    else element.setAttribute(name, String(value));
  });
  element.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return element;
}

const svg = (tag, attributes = {}, ...children) => {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
  element.append(...children);
  return element;
};

const send = (action) => mirador.send(action).catch(() => {});

function statusLine(overview) {
  if (overview.problem) return el("p", { class: "problem", role: "alert" }, overview.asOf ? `As of ${overview.asOf}. ${overview.problem}` : overview.problem);
  if (!overview.known) return el("p", { class: "muted" }, "Asking the gateway…");
  return el("p", { class: "muted" }, `${overview.who ? `Spend of ${overview.who}` : "Spend"} through the gateway, in UTC days. As of ${overview.asOf}${overview.loading ? ", updating…" : "."}`);
}

/** The last 30 days, one thin bar each, rounded at the top; hovering one tells its day and spend. */
function dailyBars(chart) {
  const width = 900;
  const height = 130;
  const most = Math.max(...chart.map(({ spend }) => spend), 0.01);
  const step = width / chart.length;
  const barWidth = Math.max(step - 2, 2);
  const bars = chart.map(({ day, spend, shown }, index) => {
    const barHeight = spend > 0 ? Math.max((spend / most) * height, 2) : 0;
    const x = index * step + 1;
    const label = `${day}: ${shown}`;
    return svg(
      "g",
      { tabindex: 0, "data-hint": label, role: "img", "aria-label": label },
      svg("rect", { class: "hit", x: index * step, y: 0, width: step, height }),
      svg("path", { class: "bar", d: roundedTop(x, height - barHeight, barWidth, barHeight) }),
    );
  });
  const firstDay = chart[0]?.day.slice(5) ?? "";
  const lastDay = chart.at(-1)?.day.slice(5) ?? "";
  return svg(
    "svg",
    { class: "bars", viewBox: `0 0 ${width} ${height + 16}`, preserveAspectRatio: "none", role: "group", "aria-label": "Spend each day, the last 30 days" },
    ...bars,
    svg("line", { class: "axis", x1: 0, x2: width, y1: height + 0.5, y2: height + 0.5 }),
    svg("text", { x: 0, y: height + 13 }, firstDay),
    svg("text", { x: width, y: height + 13, "text-anchor": "end" }, lastDay),
  );
}

function roundedTop(x, y, width, height) {
  if (height <= 0) return "";
  const radius = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + width - radius}Q${x + width},${y} ${x + width},${y + radius}V${y + height}Z`;
}

function modelsTable(models) {
  if (models.length === 0) return el("p", { class: "muted" }, "No spend this month yet.");
  return el(
    "table",
    {},
    el("thead", {}, el("tr", {}, el("th", {}, "Model"), el("th", { class: "number" }, "Requests"), el("th", { class: "number" }, "Spend"), el("th", { style: "width: 30%" }, el("span", { class: "muted" }, "Share")))),
    el(
      "tbody",
      {},
      models.map(({ model, requests, shown, share }) =>
        el("tr", {}, el("td", {}, model), el("td", { class: "number" }, requests.toLocaleString()), el("td", { class: "number" }, shown), el("td", {}, el("div", { class: "share", style: `width: ${Math.round(share * 100)}%` }))),
      ),
    ),
  );
}

function conversationsTable(conversations) {
  if (conversations.length === 0) return el("p", { class: "muted" }, "Conversations on this gateway's profiles show here once they've run.");
  return el(
    "table",
    {},
    el("thead", {}, el("tr", {}, el("th", {}, "Conversation"), el("th", {}, "Profile"), el("th", { class: "number" }, "Requests"), el("th", { class: "number" }, "Spend"))),
    el(
      "tbody",
      {},
      conversations.map(({ id, title, profile, requests, spend }) =>
        el(
          "tr",
          { class: "opens", tabindex: 0, onclick: () => send({ conversation: id }), onkeydown: (event) => event.key === "Enter" && send({ conversation: id }) },
          el("td", {}, title),
          el("td", { class: "muted" }, profile ?? ""),
          el("td", { class: "number" }, requests === null ? "…" : requests.toLocaleString()),
          el("td", { class: "number" }, spend ?? "…"),
        ),
      ),
    ),
  );
}

function focusView(focus) {
  const header = el(
    "header",
    {},
    el("button", { onclick: () => send({ back: true }) }, "← All conversations"),
    el("h1", {}, focus.title),
    el("button", { onclick: () => send({ refresh: true }) }, "Refresh"),
  );
  const summary = el(
    "p",
    { class: focus.problem ? "problem" : "muted" },
    focus.problem ?? `${focus.spend} over ${focus.count} request${focus.count === 1 ? "" : "s"}${focus.sessions > 1 ? ` in ${focus.sessions} sessions` : ""}${focus.loading ? ", updating…" : "."}`,
  );
  const rows = focus.requests.map(({ id, at, model, tokens, seconds, spend, failed }) =>
    el("tr", { class: failed ? "failed" : undefined, title: id }, el("td", {}, at), el("td", {}, model), el("td", { class: "number" }, tokens.toLocaleString()), el("td", { class: "number" }, seconds === null ? "" : `${seconds} s`), el("td", { class: "number" }, spend)),
  );
  const table =
    rows.length === 0
      ? el("p", { class: "empty" }, focus.loading ? "Asking the gateway…" : "The gateway logged no request of this conversation yet.")
      : el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "When"), el("th", {}, "Model"), el("th", { class: "number" }, "Tokens"), el("th", { class: "number" }, "Took"), el("th", { class: "number" }, "Spend"))), el("tbody", {}, rows));
  return [header, summary, table];
}

function overviewView(state) {
  const { gateways, selected, overview, conversations } = state;
  const header = el(
    "header",
    {},
    el("h1", {}, "LiteLLM"),
    el("button", { onclick: () => send({ refresh: true }) }, "Refresh"),
    el("button", { class: "link", onclick: () => mirador.openLink(overview.uiUrl) }, "Open LiteLLM UI ↗"),
  );
  const switcher =
    gateways.length > 1
      ? el(
          "div",
          { class: "gateways", role: "group", "aria-label": "Gateways" },
          gateways.map(({ id, label, profiles }) => el("button", { "aria-pressed": id === selected, "data-hint": `Used by ${profiles.join(", ")}`, onclick: () => send({ gateway: id }) }, label)),
        )
      : null;
  const stale = overview.stale ? "stale" : "";
  return [
    header,
    switcher,
    statusLine(overview),
    el("section", { class: `tiles ${stale}`, "aria-label": "Totals" }, overview.totals.map(({ label, shown }) => el("div", { class: "tile" }, el("div", { class: "label" }, label), el("div", { class: "value" }, shown)))),
    el("section", { class: stale }, el("h2", {}, "Each day, the last 30 days"), dailyBars(overview.chart)),
    el("section", {}, el("h2", {}, "By model, this month"), modelsTable(overview.models)),
    el("section", {}, el("h2", {}, "Mirador conversations"), conversationsTable(conversations)),
  ];
}

function draw(state) {
  const page = state.focus
    ? focusView(state.focus)
    : state.overview
      ? overviewView(state)
      : [
          el("header", {}, el("h1", {}, "LiteLLM")),
          el("p", { class: "empty" }, "No profile has a LiteLLM gateway set up yet. In Profiles, open a profile's Plugins tab, turn on “Uses a LiteLLM gateway”, and give its URL and access key, or set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN in its Launch environment."),
        ];
  main.replaceChildren(...page.flat().filter(Boolean));
}

mirador.onState(draw);
send({ look: true });
setInterval(() => send({ look: true }), ASK_AGAIN_MS);
