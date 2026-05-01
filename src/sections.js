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
  const [openRes, doneRes] = await Promise.all([
    sidecar.getCached('/todos?status=open&limit=25', { accessToken }),
    sidecar.getCached('/todos?status=completed&limit=20', { accessToken }),
  ]);

  // If both endpoints failed and nothing is cached, surface the offline error.
  if (openRes.value == null && doneRes.value == null) {
    return toString(
      html`<p class="err">Sidecar unreachable. ${openRes.error ? html`<span class="muted">${openRes.error}</span>` : ''}</p>
        ${addForm(offline)}`,
    );
  }

  const open = openRes.value || [];
  const completedToday = (doneRes.value || []).filter((t) => isCompletedToday(t.completed_at));
  const stale = openRes.stale || doneRes.stale;

  return toString(html`
    ${staleTag(stale)}
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
  const { value, stale, error } = await sidecar.getCached('/emails/important?limit=10', { accessToken });
  if (value == null) {
    return toString(html`<p class="err">Sidecar unreachable. ${error ? html`<span class="muted">${error}</span>` : ''}</p>`);
  }
  const items = Array.isArray(value.items) ? value.items : [];
  if (items.length === 0) {
    return toString(html`
      <p class="empty">No important email yet.</p>
      ${value.gmail_fetch_wired === false
        ? html`<p class="muted">Gmail fetch not yet wired in sidecar; flagged messages will appear here once wired.</p>`
        : ''}
      ${staleTag(stale)}
    `);
  }
  return toString(html`
    ${staleTag(stale)}
    <ul class="list">
      ${items.map(
        (e) => html`
          <li>
            <span class="text">${e.message_id}</span>
            <span class="meta">${e.flagged_at?.slice(0, 10) || ''}</span>
          </li>
        `,
      )}
    </ul>
  `);
}

// ---- Calendar ----------------------------------------------------------

export async function renderCalendar({ accessToken }) {
  const { value, stale, error } = await sidecar.getCached('/calendar/upcoming', { accessToken });
  if (value == null) {
    return toString(html`<p class="err">Sidecar unreachable. ${error ? html`<span class="muted">${error}</span>` : ''}</p>`);
  }
  const items = Array.isArray(value.items) ? value.items : [];
  if (items.length === 0) {
    return toString(html`
      <p class="empty">No upcoming events.</p>
      ${value.oauth_wired === false
        ? html`<p class="muted">Google Calendar OAuth not wired in sidecar yet.</p>`
        : ''}
      ${staleTag(stale)}
    `);
  }
  return toString(html`
    ${staleTag(stale)}
    <ul class="list">
      ${items.map(
        (e) => html`
          <li>
            <span class="text">${e.summary}</span>
            <span class="meta">${e.start}</span>
          </li>
        `,
      )}
    </ul>
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
  // Tracker is markdown. Show a condensed summary: count of lines containing
  // "outstanding" / "needs followup" / "rejected" markers. Hide rejected per
  // spec ("rejected hidden").
  const md = value.raw_markdown || '';
  const lines = md.split('\n');
  const outstanding = lines.filter((l) => /^[-*]\s/.test(l) && !/rejected/i.test(l)).slice(0, 8);
  return toString(html`
    ${staleTag(stale)}
    ${value.last_modified ? html`<p class="muted">Tracker updated ${value.last_modified.slice(0, 16).replace('T', ' ')}</p>` : ''}
    ${outstanding.length === 0
      ? html`<p class="empty">No outstanding applications.</p>`
      : html`<ul class="list">${outstanding.map((l) => html`<li><span class="text">${l.replace(/^[-*]\s+/, '')}</span></li>`)}</ul>`}
  `);
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
      ${value.map(
        (c) => html`
          <li>
            <span class="text">${c.raw_path.split('/').slice(-1)[0]}</span>
            <span class="meta">${c.original_kind} · ${c.created_at?.slice(0, 10)}</span>
          </li>
        `,
      )}
    </ul>
    <div class="rescan">${rescanButton(offline)}</div>
  `);
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
