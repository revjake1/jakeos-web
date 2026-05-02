import { html, raw, toString } from './html.js';

// Each section is a self-contained card that polls its own HTMX endpoint.
// hx-trigger cadence varies per section (per dashboard/spec.md "auto-update").

const SECTIONS = [
  { id: 'todos',     title: 'Todos',           endpoint: '/sections/todos',     poll: '10s' },
  { id: 'emails',    title: 'Important email', endpoint: '/sections/emails',    poll: '30s' },
  { id: 'calendar',  title: 'Calendar',        endpoint: '/sections/calendar',  poll: '60s' },
  { id: 'employment', title: 'Employment',     endpoint: '/sections/employment', poll: '5m' },
  { id: 'briefings', title: 'Briefings',       endpoint: '/sections/briefings', poll: '60s' },
  { id: 'captures',  title: 'Recent captures', endpoint: '/sections/captures',  poll: '15s' },
  { id: 'self-loop', title: 'Self-loop queue', endpoint: '/sections/self-loop', poll: '30s' },
];

export function renderShell({ identity, sidecar }) {
  const offline = sidecar?.up === false;
  return toString(html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>JakeOS</title>
    <script src="https://unpkg.com/htmx.org@1.9.12" defer></script>
    <style>${raw(BASE_CSS)}</style>
  </head>
  <body>
    <header class="topbar">
      <div class="brand">JakeOS</div>
      <div class="who">${identity?.email || ''}</div>
    </header>

    <div id="offline-banner" hx-get="/partials/offline" hx-trigger="every 15s" hx-swap="outerHTML">
      ${raw(renderOfflineBanner(sidecar))}
    </div>

    <main class="grid">
      ${SECTIONS.map(
        (s) => html`
          <section class="card" id="card-${s.id}">
            <header class="card-h"><h2>${s.title}</h2></header>
            <div
              class="card-body"
              hx-get="${s.endpoint}"
              hx-trigger="load, every ${s.poll}"
              hx-swap="innerHTML"
            >
              <p class="muted">Loading…</p>
            </div>
          </section>
        `,
      )}
    </main>

    <footer class="cowork">
      <form
        hx-post="/cowork"
        hx-target="#cowork-result"
        hx-swap="innerHTML"
        hx-on::after-request="this.reset()"
      >
        <input
          type="text"
          name="text"
          placeholder="Capture a todo, idea, or question…"
          autocomplete="off"
          ${offline ? raw('disabled title="Offline — sidecar unreachable"') : ''}
          required
        />
        <button type="submit" ${offline ? raw('disabled') : ''}>Send</button>
      </form>
      <div id="cowork-result" class="cowork-result"></div>
    </footer>
  </body>
</html>`);
}

export function renderOfflineBanner(sidecar) {
  if (!sidecar) return toString(html`<div id="offline-banner"></div>`);
  if (sidecar.up) return toString(html`<div id="offline-banner" class="hidden"></div>`);
  return toString(html`<div id="offline-banner" class="banner banner-offline">
    <strong>Offline.</strong> Sidecar unreachable. Showing last-known state, writes disabled.
    ${sidecar.lastSuccessAt ? html` Last sync: <time>${sidecar.lastSuccessAt}</time>.` : ''}
  </div>`);
}

const BASE_CSS = `
  :root {
    --bg: #0e0f12;
    --fg: #e6e8eb;
    --muted: #8a8f97;
    --card: #16181d;
    --border: #23262d;
    --accent: #4f8cff;
    --warn: #d28a3a;
    --bad:  #c0444a;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
         background: var(--bg); color: var(--fg); }
  .topbar { display: flex; justify-content: space-between; align-items: center;
            padding: 10px 18px; border-bottom: 1px solid var(--border); }
  .brand { font-weight: 600; letter-spacing: 0.04em; }
  .who { color: var(--muted); font-size: 12px; }
  .banner { padding: 10px 18px; }
  .banner-offline { background: rgba(192, 68, 74, 0.18); border-bottom: 1px solid var(--bad); color: #f1c2c4; }
  .hidden { display: none; }
  .grid { display: grid; gap: 14px; padding: 16px; padding-bottom: 96px;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px;
          display: flex; flex-direction: column; min-height: 180px; }
  .card-h { padding: 10px 14px; border-bottom: 1px solid var(--border); }
  .card-h h2 { margin: 0; font-size: 13px; font-weight: 600; text-transform: uppercase;
               letter-spacing: 0.06em; color: var(--muted); }
  .card-body { padding: 12px 14px; flex: 1 1 auto; overflow: auto; }
  .muted { color: var(--muted); }
  .empty { color: var(--muted); font-style: italic; }
  ul.list { list-style: none; padding: 0; margin: 0; }
  ul.list li { padding: 6px 0; border-bottom: 1px dashed var(--border); display: flex; gap: 8px; align-items: flex-start; }
  ul.list li:last-child { border-bottom: none; }
  ul.list .text { flex: 1 1 auto; }
  ul.list .meta { color: var(--muted); font-size: 11px; }
  button.linklike { background: none; border: none; color: var(--accent); cursor: pointer; padding: 0; font: inherit; }
  button.linklike:disabled { color: var(--muted); cursor: not-allowed; }
  hr.todos-sep { border: none; border-top: 1px dashed var(--border); margin: 8px 0; }
  ul.todos-completed li.todo-completed .text { color: var(--muted); text-decoration: line-through; }
  form.todo-add { display: flex; gap: 6px; margin-top: 10px; }
  form.todo-add input[type=text] { flex: 1 1 auto; padding: 6px 8px; background: var(--bg);
                                    color: var(--fg); border: 1px solid var(--border); border-radius: 4px; font: inherit; }
  form.todo-add button { padding: 6px 10px; background: var(--bg); border: 1px solid var(--border);
                         color: var(--fg); border-radius: 4px; cursor: pointer; font-size: 12px; }
  form.todo-add button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  form.todo-add button:disabled,
  form.todo-add input:disabled { opacity: 0.5; cursor: not-allowed; }
  .stale-tag { display: inline-block; padding: 1px 6px; border-radius: 999px;
               background: rgba(210, 138, 58, 0.18); color: var(--warn); font-size: 11px; margin-left: 6px; }
  .err { color: var(--bad); }
  .cowork { position: fixed; bottom: 0; left: 0; right: 0; padding: 10px 18px;
            background: var(--card); border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
  .cowork form { display: flex; gap: 8px; }
  .cowork input[type=text] { flex: 1 1 auto; padding: 8px 10px; background: var(--bg);
                             color: var(--fg); border: 1px solid var(--border); border-radius: 6px; }
  .cowork button { padding: 8px 14px; background: var(--accent); color: white;
                   border: none; border-radius: 6px; cursor: pointer; }
  .cowork button:disabled { background: #2a2f37; cursor: not-allowed; }
  .cowork-result { color: var(--muted); font-size: 12px; min-height: 16px; }
  .actions button { background: var(--bg); border: 1px solid var(--border); color: var(--fg);
                    padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .actions button:hover { border-color: var(--accent); }
  .actions { display: flex; gap: 6px; margin-top: 6px; }
  .completed { text-decoration: line-through; color: var(--muted); }
  .rescan { display: inline-block; margin-top: 6px; }
  pre.diff { background: var(--bg); border: 1px solid var(--border); border-radius: 4px;
             padding: 6px; max-height: 120px; overflow: auto; font-size: 11px; margin: 4px 0; }
  .cal-today h3, .cal-upcoming h3 { margin: 0 0 6px; font-size: 12px; font-weight: 600;
                                    text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .cal-today { margin-bottom: 14px; }
  .cal-upcoming { border-top: 1px dashed var(--border); padding-top: 10px; }
  ul.cal-list { list-style: none; padding: 0; margin: 0; }
  ul.cal-list-today li.cal-event { padding: 6px 0; border-bottom: 1px dashed var(--border);
                                    display: grid; grid-template-columns: 64px 1fr; gap: 8px;
                                    align-items: baseline; font-size: 14px; }
  ul.cal-list-today li.cal-event:last-child { border-bottom: none; }
  ul.cal-list-today .cal-time, ul.cal-list-today .cal-allday { color: var(--accent); font-variant-numeric: tabular-nums; }
  ul.cal-list-today .cal-title { color: var(--fg); font-weight: 500; }
  ul.cal-list-today .cal-loc { grid-column: 2; color: var(--muted); font-size: 12px; }
  h4.cal-day { margin: 8px 0 4px; font-size: 11px; font-weight: 500; color: var(--muted);
               text-transform: uppercase; letter-spacing: 0.04em; }
  ul.cal-list-upcoming li.cal-event-condensed { padding: 3px 0; display: grid;
                                                 grid-template-columns: 56px 1fr; gap: 8px;
                                                 align-items: baseline; font-size: 12px; color: var(--muted); }
  ul.cal-list-upcoming .cal-time, ul.cal-list-upcoming .cal-allday {
    color: var(--muted); font-variant-numeric: tabular-nums;
  }
  ul.cal-list-upcoming .cal-title { color: var(--fg); }
  .cal-allday { font-style: italic; }
  .inbox-region { margin-bottom: 6px; }
  .inbox-h { margin: 0 0 6px; font-size: 12px; font-weight: 600; text-transform: uppercase;
             letter-spacing: 0.06em; color: var(--muted); }
  .inbox-h .inbox-count { font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--muted); margin-left: 6px; font-size: 11px; }
  ul.inbox-list { list-style: none; padding: 0; margin: 0; }
  ul.inbox-list li.inbox-row { display: block; padding: 8px 0; border-bottom: 1px dashed var(--border); }
  ul.inbox-list li.inbox-row:last-child { border-bottom: none; }
  ul.inbox-list li.inbox-row .text { color: var(--fg); margin-bottom: 2px; }
  .inbox-meta { color: var(--muted); font-size: 11px; }
  .inbox-file { color: var(--accent); }
  .inbox-actions { margin-top: 4px; display: flex; gap: 10px; }
  .inbox-actions button { padding: 0; font-size: 12px; }
  .inbox-actions .inbox-dismiss { color: var(--bad); opacity: 0.85; }
  hr.inbox-sep-rule { border: none; border-top: 1px dashed var(--border); margin: 10px 0 6px; }
  .inbox-active-h { margin-top: 4px; }
`;
