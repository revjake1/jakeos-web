// Minimal HTML helper. Auto-escapes interpolated values; opt out with `raw()`.
//
// Usage:
//   html`<div>${userText}</div>`              // escaped
//   html`<div>${raw(trustedFragment)}</div>`  // not escaped
//   html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>`  // arrays flatten

const RAW = Symbol('raw');

export function raw(s) {
  return { [RAW]: true, value: String(s ?? '') };
}

export function escape(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function render(value) {
  if (value == null || value === false) return '';
  if (value && typeof value === 'object' && value[RAW]) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escape(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += render(values[i]) + strings[i + 1];
  }
  return raw(out);
}

// Convert a tagged-template result to a string for response bodies.
export function toString(value) {
  return render(value);
}
