import { html, raw, toString } from './html.js';
import * as sidecar from './sidecar.js';

// Each renderX returns an HTML string (a fragment). All fragments wrap any
// failure path so a sidecar outage degrades to read-only with a "(stale)" tag,
// per dashboard/spec.md "Graceful degradation when sidecar unreachable".

function staleTag(stale) {
  return stale ? raw(' <span class="stale-tag" title="Last cached value — sidecar unreachable">stale</span>') : '';
}

function emptyOrError(value, stale, error, emptyText) {
  if (value == null) {
    return toString(
      html`<p class="err">Sidecar unreachable. ${error ? html`<span class="muted">${error}</span>` : ''}</p>`,
    );
  }
  if (Array.isArray(value) && value.length === 0) {
    return toString(html`<p class="empty">${emptyText}</p>${staleTag(stale)}`);
  }
  return null;
}

// ---- Todos -------------------------------------------------------------
//
// Renders open todos plus today's completed todos so the uncheck path is
// discoverable without leaving the dashboard. Per design.md (jakeos-todos-module)
// decisions 1-2: two parallel GETs, completed list filtered to today's UTC day.

function isCompletedToday(iso) {
  if (!iso) return false;
  const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
  return iso.slice(0, 10) === today;
}

export async function renderTodos({ accessToken, offline }) {
  const [openRes, doneRes, inboxRes] = await Promise.all([
    sidecar.getCached('/todos?status=open&limit=25', { accessToken }),
    sidecar.getCached('/todos?status=completed&limit=20', { accessToken }),
    sidecar.getCached('/raw-inbox?state=open&limit=50', { accessToken }),
  ]);

  // If both todos endpoints failed and nothing is cached, surface the offline error.
  if (openRes.value == null && doneRes.value == null) {
    return toString(
      html`<p class="err">Sidecar unreachable. ${openRes.error ? html`<span class="muted">${openRes.error}</span>` : ''}</p>
        ${addForm(offline)}`,
    );
  }

  const open = openRes.value || [];
  const completedToday = (doneRes.value || []).filter((t) => isCompletedToday(t.completed_at));
  const inbox = Array.isArray(inboxRes.value) ? inboxRes.value : [];
  const stale = openRes.stale || doneRes.stale || inboxRes.stale;

  return toString(html`
    ${staleTag(stale)}
    ${inbox.length > 0 ? renderInboxRegion(inbox, offline) : ''}
    ${open.length === 0 && completedToday.length === 0
      ? html`<p class="empty">No todos. Add one below.</p>`
      : ''}
    ${open.length > 0
      ? html`<ul class="list">
          ${open.map(
            (t) => html`
              <li>
                <span class="text">${t.text}</span>
                <button
                  class="linklike"
                  hx-post="/todos/${t.id}/complete"
                  hx-target="#card-todos .card-body"
                  hx-swap="innerHTML"
                  ${offline ? raw('disabled title="Offline — writes disabled"') : ''}
                >done</button>
              </li>
            `,
          )}
        </ul>`
      : ''}
    ${completedToday.length > 0
      ? html`
          ${open.length > 0 ? raw('<hr class="todos-sep" />') : ''}
          <ul class="list todos-completed">
            ${completedToday.map(
              (t) => html`
                <li class="todo-completed">
                  <span class="text">${t.text}</span>
                  <button
                    class="linklike"
                    title="Reopen this todo"
                    hx-post="/todos/${t.id}/reopen"
                    hx-target="#card-todos .card-body"
                    hx-swap="innerHTML"
                    ${offline ? raw('disabled title="Offline — writes disabled"') : ''}
                  >↩︎ undo</button>
                </li>
              `,
            )}
          </ul>
        `
      : ''}
    ${addForm(offline)}
  `);
}

function renderInboxRegion(items, offline) {
  return html`
    <section class="inbox-region">
      <h3 class="inbox-h">Inbox <span class="inbox-count">(${items.length} from raw notes)</span></h3>
      <ul class="list inbox-list">
        ${items.map(
          (i) => html`
            <li class="inbox-row">
              <div class="text">${i.text}</div>
              <div class="inbox-meta">
                <span class="inbox-file" title="${i.file_path}">${lastSegment(i.file_path)}</span>
                <span class="inbox-sep"> · </span>
                <span class="inbox-header">${i.nearest_header || '(no heading)'}</span>
              </div>
              <div class="inbox-actions">
                <button
                  class="linklike"
                  hx-post="/raw-inbox/${i.id}/promote-todo"
                  hx-target="#card-todos .card-body"
                  hx-swap="innerHTML"
                  ${offline ? raw('disabled title="Offline — writes disabled"') : ''}
                >Promote</button>
                <button
                  class="linklike"
                  hx-post="/raw-inbox/${i.id}/promote-wiki"
                  hx-target="#card-todos .card-body"
                  hx-swap="innerHTML"
                  ${offline ? raw('disabled title="Offline — writes disabled"') : ''}
                >Wiki</button>
                <button
                  class="linklike inbox-dismiss"
                  hx-post="/raw-inbox/${i.id}/dismiss"
                  hx-target="#card-todos .card-body"
                  hx-swap="innerHTML"
                  ${offline ? raw('disabled title="Offline — writes disabled"') : ''}
                >Dismiss</button>
              </div>
            </li>
          `,
        )}
      </ul>
      <hr class="inbox-sep-rule" />
      <h3 class="inbox-h inbox-active-h">Active</h3>
    </section>
  `;
}

function lastSegment(path) {
  if (!path) return '';
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

function addForm(offline) {
  return html`
    <form
      class="todo-add"
      hx-post="/todos"
      hx-target="#card-todos .card-body"
      hx-swap="innerHTML"
      hx-on::after-request="this.reset()"
    >
      <input
        type="text"
        name="text"
        placeholder="Add a todo…"
        autocomplete="off"
        ${offline ? raw('disabled title="Offline — sidecar unreachable"') : ''}
        required
      />
      <button type="submit" ${offline ? raw('disabled') : ''}>Add</button>
    </form>
  `;
}

// ---- Important emails --------------------------------------------------

export async function renderEmails({ accessToken }) {
  // v0: show most-recent unread inbox messages (no classifier yet).
  // The "important" classifier is Phase 4.2 future work; until then we just
  // surface what's actually unread so the section is useful, not empty.
  const { value, stale, error } = await sidecar.getCached('/emails/recent?limit=10', { accessToken });
  if (value == null) {
    return toString(html`<p class="err">Sidecar unreachable. ${error ? html`<span class="muted">${error}</span>` : ''}</p>`);
  }
  const items = Array.isArray(value.items) ? value.items : [];
  if (items.length === 0) {
    return toString(html`
      <p class="empty">${value.oauth_wired === false ? 'Gmail OAuth not wired.' : 'Inbox zero — no unread mail.'}</p>
      ${staleTag(stale)}
    `);
  }
  return toString(html`
    ${staleTag(stale)}
    <ul class="list">
      ${items.map(emailRow)}
    </ul>
  `);
}

function emailRow(e) {
  // From: "Alice Doe <alice@example.com>" → display "Alice Doe" if a friendly
  // name is present, otherwise the address.
  const m = (e.from || '').match(/^(.*?)\s*<.+>\s*$/);
  const fromShort = m ? m[1].replace(/^"|"$/g, '') : (e.from || '');
  const dateShort = e.date ? new Date(e.date).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }) : '';
  return html`
    <li>
      <span class="text">
        <strong>${fromShort}</strong>: ${e.subject}
      </span>
      <span class="meta">${dateShort}${e.snippet ? html` — ${e.snippet.slice(0, 90)}…` : ''}</span>
    </li>
  `;
}

// ---- Calendar ----------------------------------------------------------
//
// Two-region layout per dashboard/spec.md "Calendar surface — today and next
// 7 days": a prominent "Today" region followed by a condensed "Next 7 days"
// region grouped by day. Events come from the user's primary Google Calendar
// via the sidecar (which carries the access token forwarded as
// X-Google-Access-Token from oauth2-proxy through this app).

const LOCAL_TZ = 'America/New_York';

// "today" partition uses Jake's local timezone. The server is UTC, so format
// with Intl in the local zone and compare YYYY-MM-DD strings.
function localDay(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LOCAL_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function eventDay(ev) {
  // All-day events: Google returns event.start.date (YYYY-MM-DD).
  if (ev.all_day) return ev.start.slice(0, 10);
  // Timed: event.start is RFC3339; partition by its day in LOCAL_TZ.
  const d = new Date(ev.start);
  if (Number.isNaN(d.getTime())) return ev.start.slice(0, 10);
  return localDay(d);
}

function formatTime(ev) {
  if (ev.all_day) return null;
  const d = new Date(ev.start);
  if (Number.isNaN(d.getTime())) return ev.start;
  // Render the event's wall-clock time in the timezone Google reported.
  const tz = ev.time_zone || LOCAL_TZ;
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz,
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: LOCAL_TZ,
    }).format(d);
  }
}

function formatDayHeading(yyyyMmDd) {
  // Anchor at noon UTC to dodge DST edge cases when formatting day-only strings.
  const d = new Date(`${yyyyMmDd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return yyyyMmDd;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

function renderEventToday(ev) {
  const time = formatTime(ev);
  return html`
    <li class="cal-event">
      ${ev.all_day
        ? html`<span class="cal-allday">all day</span>`
        : html`<span class="cal-time">${time}</span>`}
      <span class="cal-title">${ev.summary}</span>
      ${ev.location ? html`<span class="cal-loc">${ev.location}</span>` : ''}
    </li>
  `;
}

function renderEventCondensed(ev) {
  const time = formatTime(ev);
  return html`
    <li class="cal-event-condensed">
      ${ev.all_day
        ? html`<span class="cal-allday">all day</span>`
        : html`<span class="cal-time">${time}</span>`}
      <span class="cal-title">${ev.summary}</span>
    </li>
  `;
}

export async function renderCalendar({ accessToken }) {
  const { value, stale, error } = await sidecar.getCached('/calendar/upcoming', { accessToken });
  if (value == null) {
    return toString(
      html`<p class="err">Sidecar unreachable. ${error ? html`<span class="muted">${error}</span>` : ''}</p>`,
    );
  }
  const items = Array.isArray(value.items) ? value.items : [];

  // Empty list — including the OAuth-not-wired case — renders the friendly
  // empty state with the same hint behavior the stub had.
  if (items.length === 0) {
    return toString(html`
      ${staleTag(stale)}
      <p class="empty">No events in the next 7 days.</p>
      ${value.oauth_wired === false
        ? html`<p class="muted">Google Calendar OAuth not wired in sidecar yet.</p>`
        : ''}
    `);
  }

  // Partition into today and upcoming, grouped by event-day.
  const todayKey = localDay(new Date());
  const today = [];
  const upcomingByDay = new Map(); // YYYY-MM-DD -> events[]

  for (const ev of items) {
    const day = eventDay(ev);
    if (day === todayKey) {
      today.push(ev);
    } else if (day > todayKey) {
      const list = upcomingByDay.get(day) || [];
      list.push(ev);
      upcomingByDay.set(day, list);
    }
    // day < todayKey shouldn't happen given timeMin=now on the sidecar; ignore.
  }

  const upcomingDays = [...upcomingByDay.keys()].sort();
  const hasUpcoming = upcomingDays.length > 0;

  return toString(html`
    ${staleTag(stale)}
    <section class="cal-today">
      <h3>Today</h3>
      ${today.length === 0
        ? html`<p class="empty">Nothing today.</p>`
        : html`<ul class="cal-list cal-list-today">
            ${today.map(renderEventToday)}
          </ul>`}
    </section>
    ${hasUpcoming
      ? html`<section class="cal-upcoming">
          <h3>Next 7 days</h3>
          ${upcomingDays.map(
            (day) => html`
              <h4 class="cal-day">${formatDayHeading(day)}</h4>
              <ul class="cal-list cal-list-upcoming">
                ${upcomingByDay.get(day).map(renderEventCondensed)}
              </ul>
            `,
          )}
        </section>`
      : ''}
  `);
}

// ---- Employment --------------------------------------------------------

export async function renderEmployment() {
  const { value, stale, error } = await sidecar.getCached('/employment');
  if (value == null) {
    return toString(html`<p class="err">Sidecar unreachable. ${error ? html`<span class="muted">${error}</span>` : ''}</p>`);
  }
  if (!value.tracker_present) {
    return toString(html`
      <p class="empty">No application tracker found.</p>
      <p class="muted">Expected at <code>${value.tracker_path}</code></p>
      ${staleTag(stale)}
    `);
  }
  // Tracker is a pipe-table per the canonical layout in the wiki:
  //   | # | Date | Company | Role | ATS | Fit | Status |
  // Parse rows, hide rejected/closed/expired per the spec ("rejected hidden"),
  // surface action-required items first, then outstanding.
  const rows = parseEmploymentTable(value.raw_markdown || '');
  const visible = rows.filter((r) => !isHidden(r));
  const actionRequired = visible.filter((r) => /action required|needs followup|⚡/i.test(r.status));
  const outstanding = visible.filter((r) => !actionRequired.includes(r)).slice(0, 8);
  return toString(html`
    ${staleTag(stale)}
    ${value.last_modified ? html`<p class="muted">Tracker updated ${value.last_modified.slice(0, 16).replace('T', ' ')}</p>` : ''}
    ${actionRequired.length > 0
      ? html`<p class="muted" style="color: var(--warn); margin: 0 0 4px;">⚡ Needs follow-up</p>
        <ul class="list">
          ${actionRequired.map(employmentRow)}
        </ul>
        <hr class="todos-sep" />`
      : ''}
    ${outstanding.length === 0
      ? html`<p class="empty">No outstanding applications.</p>`
      : html`<ul class="list">${outstanding.map(employmentRow)}</ul>`}
  `);
}

function parseEmploymentTable(md) {
  // Split on the table's data rows (lines starting and ending with `|`).
  // Skip the header row (column names) and the separator row (---|---|...).
  const rows = [];
  for (const line of md.split('\n')) {
    if (!line.startsWith('|') || !line.trim().endsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 7) continue;
    if (cells[0].toLowerCase() === '#' || /^-+$/.test(cells[0])) continue; // header / separator
    const [num, date, company, role, ats, fit, status] = cells;
    rows.push({ num, date, company, role, ats, fit, status });
  }
  return rows;
}

function isHidden(row) {
  // Per dashboard/spec.md: rejected hidden. Also hide closed/expired.
  return /rejected|closed|expired|withdrawn/i.test(row.status);
}

function employmentRow(r) {
  const fitTag = r.fit && r.fit !== '—'
    ? html`<span class="meta" style="margin-left: 6px;">${r.fit}</span>`
    : '';
  const statusShort = (r.status || '').split('—')[0].trim().slice(0, 60);
  return html`
    <li>
      <span class="text">
        <strong>${r.company}</strong> · ${r.role}
        ${fitTag}
      </span>
      <span class="meta" title="${r.status}">${r.date} · ${r.ats} · ${statusShort}</span>
    </li>
  `;
}

// ---- Briefings ---------------------------------------------------------
//
// v1: there is no briefings endpoint on the sidecar yet (Phase 4.7 work).
// We render a placeholder that is still useful — the recent ingest state — so
// the section is not empty on first load. When the briefings endpoint exists,
// swap this body for /briefings.

export async function renderBriefings() {
  const { value, stale, error } = await sidecar.getCached('/ingest/state');
  if (value == null) {
    return toString(html`<p class="err">Sidecar unreachable. ${error ? html`<span class="muted">${error}</span>` : ''}</p>`);
  }
  const last = value.last_successful_run || value.last_trigger;
  return toString(html`
    ${staleTag(stale)}
    <p class="muted">Briefings surface lands in Phase 4.7. Showing ingest pulse for now.</p>
    <p>
      <span class="meta">Pending</span> ${value.pending_files} ·
      <span class="meta">Processed</span> ${value.processed_files} ·
      <span class="meta">Failed</span> ${value.failed_files}
    </p>
    ${last ? html`<p class="muted">Last run: ${last.ts?.slice(0, 16).replace('T', ' ')} · ${last.outcome}</p>` : ''}
  `);
}

// ---- Recent captures ---------------------------------------------------

export async function renderCaptures({ offline }) {
  const { value, stale, error } = await sidecar.getCached('/captures?limit=8');
  const fallback = emptyOrError(value, stale, error, 'No recent captures.');
  if (fallback != null) {
    return fallback + toString(html`<div class="rescan">${rescanButton(offline)}</div>`);
  }
  return toString(html`
    ${staleTag(stale)}
    <ul class="list">
      ${value.map(renderCaptureRow)}
    </ul>
    <div class="rescan">${rescanButton(offline)}</div>
  `);
}

function renderCaptureRow(c) {
  const filename = c.filename || c.raw_path.split('/').slice(-1)[0];
  const kindLabel = c.mime_type || c.original_kind;
  const metaParts = [kindLabel, humanSize(c.size_bytes), humanAge(c.created_at)].filter(Boolean);
  const filenameNode = c.companion_path
    ? html`<a class="capture-link" href="${companionHref(c.companion_path)}" target="_blank" rel="noopener">${filename}</a>`
    : html`${filename}`;
  return html`
    <li>
      <span class="text">${filenameNode}</span>
      <span class="meta">${metaParts.join(' · ')}</span>
    </li>
  `;
}

function humanSize(n) {
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Companion paths come back as absolute filesystem paths inside the wiki. v1
// renders them as plaintext-via-file:// — Obsidian/Finder open them. A future
// change can map these to a wiki-served URL once jakeos-web learns to serve
// the wiki tree directly.
function companionHref(p) {
  if (!p) return '#';
  if (p.startsWith('http')) return p;
  return `file://${p}`;
}

function rescanButton(offline) {
  return html`<button
    class="linklike"
    hx-post="/ingest/rescan"
    hx-target="#card-captures .card-body"
    hx-swap="innerHTML"
    ${offline ? raw('disabled title="Offline — sidecar unreachable"') : ''}
  >Re-scan now</button>`;
}

// ---- Self-loop queue ---------------------------------------------------

export async function renderSelfLoop({ offline }) {
  const { value, stale, error } = await sidecar.getCached('/self-loop/queue?state=pending&limit=20');
  const fallback = emptyOrError(value, stale, error, 'No pending proposals.');
  if (fallback != null) return fallback;

  const oldest = value[0];
  const oldestAge = oldest ? humanAge(oldest.created_at) : null;
  return toString(html`
    ${staleTag(stale)}
    <p class="muted">Pending: <strong>${value.length}</strong>${oldestAge ? html` · oldest ${oldestAge}` : ''}</p>
    <ul class="list">
      ${value.slice(0, 5).map(
        (p) => html`
          <li>
            <div class="text">
              <div>${p.rationale}</div>
              <pre class="diff">${p.diff}</pre>
              <div class="actions">
                <button
                  hx-post="/self-loop/${p.id}/review"
                  hx-vals='{"action":"approve"}'
                  hx-target="#card-self-loop .card-body"
                  hx-swap="innerHTML"
                  ${offline ? raw('disabled') : ''}
                >Approve</button>
                <button
                  hx-post="/self-loop/${p.id}/review"
                  hx-vals='{"action":"reject"}'
                  hx-target="#card-self-loop .card-body"
                  hx-swap="innerHTML"
                  ${offline ? raw('disabled') : ''}
                >Reject</button>
                <button
                  hx-post="/self-loop/${p.id}/review"
                  hx-vals='{"action":"defer"}'
                  hx-target="#card-self-loop .card-body"
                  hx-swap="innerHTML"
                  ${offline ? raw('disabled') : ''}
                >Defer</button>
              </div>
            </div>
          </li>
        `,
      )}
    </ul>
  `);
}

function humanAge(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return `${Math.round(s)}s old`;
  if (s < 5400) return `${Math.round(s / 60)}m old`;
  if (s < 172800) return `${Math.round(s / 3600)}h old`;
  return `${Math.round(s / 86400)}d old`;
}

// ---- Ingest indicator -------------------------------------------------
//
// Footer-chrome surface for the sidecar's ingest pipeline state. Single line
// when collapsed; click to expand a drawer with the last 10 trigger events
// from /ingest/status. Per dashboard/spec.md "Ingest status indicator" and
// ingest/spec.md "Surface visibility".

function relativeTimeFromIso(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

// Returns 'ok' | 'warn' | 'err' per dashboard/spec.md "Ingest status indicator"
// coloring rules. Pure timestamp logic; no extra state.
function ingestState({ last_successful_at, last_error_at }) {
  const errT = last_error_at ? Date.parse(last_error_at) : null;
  const okT = last_successful_at ? Date.parse(last_successful_at) : null;
  const errIsLatest = errT && (!okT || errT > okT);
  if (!errIsLatest) return 'ok';
  const ageMs = Date.now() - errT;
  return ageMs < 24 * 3600 * 1000 ? 'warn' : 'err';
}

function renderIngestEventRow(ev) {
  const at = relativeTimeFromIso(ev.at) || ev.at;
  const fileLabel =
    Array.isArray(ev.trigger_files) && ev.trigger_files.length > 0
      ? ev.trigger_files
          .map((p) => p.split('/').pop())
          .join(', ')
      : '';
  return html`<li class="ingest-event ingest-event--${ev.outcome === 'error' ? 'err' : 'ok'}">
    <span class="ingest-ev-time" title="${ev.at}">${at}</span>
    <span class="ingest-ev-mech">${ev.mechanism}</span>
    <span class="ingest-ev-outcome">${ev.outcome}</span>
    ${fileLabel ? html`<span class="ingest-ev-files" title="${ev.trigger_files.join('\n')}">${fileLabel}</span>` : ''}
    ${ev.error_message ? html`<span class="ingest-ev-err">${ev.error_message}</span>` : ''}
  </li>`;
}

// Renders the indicator + drawer as a single fragment. The 10s poll swaps
// outerHTML, so the summary count + drawer body always reflect the latest
// /ingest/status response. Drawer open/closed state resets on each poll —
// acceptable trade-off for keeping the visible count fresh.
//
// outcomeBanner: optional one-line message rendered at the top of the drawer
// after a manual rescan ("0 new" / "N queued for ingest" / "error: …").
export function renderIngestIndicator(status, { offline = false, outcomeBanner = null } = {}) {
  if (status == null) {
    return toString(html`
      <div id="ingest-indicator" class="ingest-indicator ingest-indicator--unknown"
           hx-get="/ingest-indicator" hx-trigger="every 10s" hx-swap="outerHTML">
        <span class="ingest-line">Ingest: unknown</span>
      </div>`);
  }

  const state = ingestState(status);
  const rel = status.last_successful_at
    ? relativeTimeFromIso(status.last_successful_at)
    : 'never run';
  const pendingLabel = `${status.pending_count} pending`;
  const errMsg = status.last_error_message || '';
  const titleAttr = state !== 'ok' && errMsg ? errMsg : '';

  return toString(html`
    <div id="ingest-indicator" class="ingest-indicator ingest-indicator--${state}"
         hx-get="/ingest-indicator" hx-trigger="every 10s" hx-swap="outerHTML"
         ${titleAttr ? raw(`title="${escapeAttr(titleAttr)}"`) : ''}>
      <details id="ingest-details"${outcomeBanner ? raw(' open') : ''}>
        <summary class="ingest-summary">
          <span class="ingest-line">
            Ingest: <span class="ingest-time">${rel}</span>,
            <span class="ingest-pending">${pendingLabel}</span>
          </span>
          <button class="ingest-rescan"
                  hx-post="/ingest/rescan"
                  hx-target="#ingest-indicator"
                  hx-swap="outerHTML"
                  hx-disabled-elt="this"
                  ${offline ? raw('disabled title="Offline — sidecar unreachable"') : ''}>
            Re-scan
          </button>
        </summary>
        <div class="ingest-drawer">
          ${outcomeBanner
            ? html`<p class="ingest-banner ingest-banner--${outcomeBanner.kind || 'info'}">${outcomeBanner.text}</p>`
            : ''}
          ${status.recent_events && status.recent_events.length > 0
            ? html`<ul class="ingest-events">
                ${status.recent_events.map(renderIngestEventRow)}
              </ul>`
            : html`<p class="empty">No ingest events recorded yet.</p>`}
        </div>
      </details>
    </div>
  `);
}

function escapeAttr(s) {
  return String(s ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
