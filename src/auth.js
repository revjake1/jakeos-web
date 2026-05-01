// Auth headers from oauth2-proxy.
//
// Per phase-3/unraid-stack/docker-compose.yml, oauth2-proxy is configured with:
//   OAUTH2_PROXY_PASS_USER_HEADERS=true       → X-Forwarded-User, X-Forwarded-Email
//   OAUTH2_PROXY_PASS_ACCESS_TOKEN=true       → X-Forwarded-Access-Token
//   OAUTH2_PROXY_SET_XAUTHREQUEST=true        → X-Auth-Request-User / -Email / -Access-Token
//
// We trust these headers because the only way into the container is through
// oauth2-proxy → caddy → cloudflared. The single-allowed-account guard
// (authenticated-emails.txt) already rejected anyone but Jake at the proxy.
//
// We still defensively re-check the email matches the allowed list and refuse
// the session otherwise. Belt + suspenders.

const ALLOWED_EMAIL = (process.env.JAKEOS_ALLOWED_EMAIL || 'jake.hallman@gmail.com').toLowerCase();

export function identityFrom(req) {
  const h = req.header.bind(req);
  const email = (h('x-forwarded-email') || h('x-auth-request-email') || '').toLowerCase();
  const user = h('x-forwarded-user') || h('x-auth-request-user') || '';
  const accessToken = h('x-forwarded-access-token') || h('x-auth-request-access-token') || '';
  return { email, user, accessToken, allowed: !!email && email === ALLOWED_EMAIL };
}

// Hono middleware: refuse any request that didn't come from the right account.
// Skips /healthz so docker can probe without auth headers.
export function requireJake(c, next) {
  const path = c.req.path;
  if (path === '/healthz' || path === '/livez') return next();
  const id = identityFrom(c.req);
  if (!id.allowed) {
    return c.text(
      'Forbidden — single-allowed-account guard rejected this session.\n' +
        'Auth headers from oauth2-proxy were missing or did not match the configured account.\n',
      403,
    );
  }
  c.set('identity', id);
  return next();
}
