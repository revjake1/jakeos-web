import { Hono } from 'hono';
import { serve } from '@hono/node-server';

import { requireJake } from './auth.js';
import * as sidecar from './sidecar.js';
import { renderShell, renderOfflineBanner } from './layout.js';
import {
  renderTodos,
  renderEmails,
  renderCalendar,
  renderEmployment,
  renderBriefings,
  renderCaptures,
  renderSelfLoop,
} from './sections.js';

const app = new Hono();

// Health endpoint for docker. Skip auth.
app.get('/healthz', (c) => c.text('ok'));
app.get('/livez', (c) => c.text('ok'));

// Everything else needs Jake's identity from oauth2-proxy.
app.use('*', requireJake);

// --- Shell ---------------------------------------------------------------

app.get('/', async (c) => {
  const id = c.get('identity');
  const ping = await sidecar.ping();
  const sc = { ...sidecar.status(), up: ping.up };
  c.header('content-type', 'text/html; charset=utf-8');
  return c.body(renderShell({ identity: id, sidecar: sc }));
});

// --- Section fragments ---------------------------------------------------

const htmlFragment = (c, body) => {
  c.header('content-type', 'text/html; charset=utf-8');
  return c.body(body);
};

async function offlineFlag() {
  const p = await sidecar.ping();
  return !p.up;
}

app.get('/sections/todos', async (c) => {
  const id = c.get('identity');
  return htmlFragment(c, await renderTodos({ accessToken: id.accessToken, offline: await offlineFlag() }));
});
app.get('/sections/emails', async (c) => {
  const id = c.get('identity');
  return htmlFragment(c, await renderEmails({ accessToken: id.accessToken }));
});
app.get('/sections/calendar', async (c) => {
  const id = c.get('identity');
  return htmlFragment(c, await renderCalendar({ accessToken: id.accessToken }));
});
app.get('/sections/employment', async (c) => htmlFragment(c, await renderEmployment()));
app.get('/sections/briefings', async (c) => htmlFragment(c, await renderBriefings()));
app.get('/sections/captures', async (c) => htmlFragment(c, await renderCaptures({ offline: await offlineFlag() })));
app.get('/sections/self-loop', async (c) =>
  htmlFragment(c, await renderSelfLoop({ offline: await offlineFlag() })),
);

// --- Offline banner partial ---------------------------------------------

app.get('/partials/offline', async (c) => {
  const ping = await sidecar.ping();
  return htmlFragment(c, renderOfflineBanner({ ...sidecar.status(), up: ping.up }));
});

// --- Cowork input -------------------------------------------------------

app.post('/cowork', async (c) => {
  const form = await c.req.parseBody();
  const text = (form.text || '').toString().trim();
  if (!text) return htmlFragment(c, '<span class="err">Empty input.</span>');
  const id = c.get('identity');

  // Heuristic v1: text ending in "?" → idea/question; else → todo.
  // The richer Cowork-classifier path lands in Phase 4.5; for now we route
  // deterministically and still satisfy the spec scenario ("must never
  // silently drop the input").
  const looksLikeQuestion = /\?\s*$/.test(text);
  const path = looksLikeQuestion ? '/ideas' : '/todos';
  const r = await sidecar.post(path, { text, source: 'dashboard' }, { accessToken: id.accessToken });
  if (!r.ok) {
    return htmlFragment(c, `<span class="err">Couldn't reach sidecar: ${escapeHtml(r.error || 'unknown')}</span>`);
  }
  const noun = looksLikeQuestion ? 'idea' : 'todo';
  return htmlFragment(c, `<span>Captured as ${noun}.</span>`);
});

// --- Todo write ---------------------------------------------------------

app.post('/todos', async (c) => {
  const form = await c.req.parseBody();
  const text = (form.text || '').toString().trim();
  const ident = c.get('identity');
  if (!text) {
    return htmlFragment(
      c,
      `<p class="err">Empty todo.</p>` +
        (await renderTodos({ accessToken: ident.accessToken, offline: await offlineFlag() })),
    );
  }
  const r = await sidecar.post('/todos', { text, source: 'dashboard' }, { accessToken: ident.accessToken });
  if (!r.ok) {
    return htmlFragment(
      c,
      `<p class="err">Couldn't add todo: ${escapeHtml(r.error || '')}</p>` +
        (await renderTodos({ accessToken: ident.accessToken, offline: await offlineFlag() })),
    );
  }
  return htmlFragment(c, await renderTodos({ accessToken: ident.accessToken, offline: await offlineFlag() }));
});

app.post('/todos/:id/complete', async (c) => {
  const id = c.req.param('id');
  const ident = c.get('identity');
  const r = await sidecar.patch(`/todos/${encodeURIComponent(id)}/complete`, { source: 'dashboard' }, { accessToken: ident.accessToken });
  if (!r.ok) {
    return htmlFragment(c, `<p class="err">Couldn't complete todo: ${escapeHtml(r.error || '')}</p>`);
  }
  return htmlFragment(c, await renderTodos({ accessToken: ident.accessToken, offline: await offlineFlag() }));
});

app.post('/todos/:id/reopen', async (c) => {
  const id = c.req.param('id');
  const ident = c.get('identity');
  const r = await sidecar.patch(`/todos/${encodeURIComponent(id)}/reopen`, { source: 'dashboard' }, { accessToken: ident.accessToken });
  if (!r.ok) {
    return htmlFragment(c, `<p class="err">Couldn't reopen todo: ${escapeHtml(r.error || '')}</p>`);
  }
  return htmlFragment(c, await renderTodos({ accessToken: ident.accessToken, offline: await offlineFlag() }));
});

// --- Raw inbox (process verbs) ----------------------------------------

for (const verb of ['promote-todo', 'promote-wiki', 'dismiss']) {
  app.post(`/raw-inbox/:id/${verb}`, async (c) => {
    const id = c.req.param('id');
    const ident = c.get('identity');
    const r = await sidecar.post(
      `/raw-inbox/${encodeURIComponent(id)}/${verb}`,
      {},
      { accessToken: ident.accessToken },
    );
    if (!r.ok) {
      return htmlFragment(
        c,
        `<p class="err">Couldn't ${escapeHtml(verb)}: ${escapeHtml(r.error || '')}</p>` +
          (await renderTodos({ accessToken: ident.accessToken, offline: await offlineFlag() })),
      );
    }
    return htmlFragment(c, await renderTodos({ accessToken: ident.accessToken, offline: await offlineFlag() }));
  });
}

// --- Self-loop review ---------------------------------------------------

app.post('/self-loop/:id/review', async (c) => {
  const id = c.req.param('id');
  const form = await c.req.parseBody();
  const action = (form.action || '').toString();
  if (!['approve', 'reject', 'defer'].includes(action)) {
    return htmlFragment(c, `<p class="err">Bad action: ${escapeHtml(action)}</p>`);
  }
  const r = await sidecar.post(`/self-loop/${encodeURIComponent(id)}/review`, { action });
  if (!r.ok) {
    return htmlFragment(c, `<p class="err">Couldn't submit review: ${escapeHtml(r.error || '')}</p>`);
  }
  return htmlFragment(c, await renderSelfLoop({ offline: await offlineFlag() }));
});

// --- Manual ingest rescan ----------------------------------------------

app.post('/ingest/rescan', async (c) => {
  const r = await sidecar.post('/ingest/rescan', {});
  if (!r.ok) {
    return htmlFragment(c, `<p class="err">Rescan failed: ${escapeHtml(r.error || '')}</p>`);
  }
  return htmlFragment(c, await renderCaptures({ offline: false }));
});

// --- helpers -----------------------------------------------------------

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const port = Number(process.env.PORT || 3000);
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
console.log(`jakeos-web listening on :${port} → sidecar ${sidecar.status().baseUrl}`);
