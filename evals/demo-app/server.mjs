#!/usr/bin/env node
// "Studio Bareket" — a small Hebrew/RTL storefront with PLANTED gaps, used to regression-test
// the web-qa-agent skill. Every planted gap is listed in ../expectations.json; pages marked
// CONTROL are deliberately correct and must NOT produce findings (false-positive checks).
// Usage: node server.mjs [--port 4321]
import http from 'node:http';

const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 4321;
const PRODUCTS = [
  { id: 1, name: 'ספל קרמיקה', en: 'Ceramic mug', price: 89 },
  { id: 2, name: 'מנורת שולחן', en: 'Desk Lamp', price: 249 },
  { id: 3, name: 'עציץ בטון', en: 'Concrete planter', price: 120 },
];
const carts = new Map(); // sid -> {id: qty}

const head = (title, { dir = 'rtl', viewport = true, desc = true } = {}) => `<!doctype html>
<html lang="he"${dir ? ` dir="${dir}"` : ''}><head><meta charset="utf-8">
${viewport ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : ''}
${desc ? `<meta name="description" content="סטודיו ברקת — כלי בית בעבודת יד">` : ''}
<link rel="canonical" href="http://localhost:${port}/">
<title>${title}</title>
<style>body{font-family:system-ui,Arial;margin:0;padding:16px;max-width:960px;margin-inline:auto}
nav a{margin-inline-end:12px}.card{border:1px solid #ccc;padding:12px;margin:8px 0}
button{min-width:44px;min-height:44px}.err{color:#b00}</style></head><body>
<nav aria-label="ראשי"><a href="/">בית</a><a href="/products">מוצרים</a><a href="/cart">עגלה</a>
<a href="/about">אודות</a><a href="/contact">צור קשר</a><a href="/team">הצוות</a><a href="/blog">בלוג</a><a href="/policy">מדיניות</a><a href="/account/orders">ההזמנות שלי</a></nav><main>`;
const foot = `</main><footer><p>© סטודיו ברקת</p></footer></body></html>`;

const pages = {
  // Home: API 500 (reviews), duplicate API calls (stock ×3), console error, image without alt.
  '/': () => head('סטודיו ברקת — כלי בית בעבודת יד') + `
    <h1>ברוכים הבאים לסטודיו ברקת</h1>
    <p>כלי בית מקרמיקה ובטון, בעבודת יד בנתניה.</p>
    <img src="/img/hero.svg" width="300" height="120">
    <section id="reviews"><h2>ביקורות</h2><p id="rv">טוען…</p></section>
    <script>
      fetch('/api/reviews').then(r => { if (!r.ok) throw new Error('reviews ' + r.status); return r.json(); })
        .catch(e => { document.getElementById('rv').textContent = ''; console.error('Failed to render reviews', e.message); });
      for (let i = 0; i < 3; i++) fetch('/api/stock');
    </script>` + foot,

  // Products: reflected search (unescaped) + case-sensitive English search (exploratory).
  '/products': (q) => {
    const term = q.get('q') || '';
    const list = PRODUCTS.filter(p => !term || p.name.includes(term) || p.en.includes(term)); // case-sensitive on purpose
    return head('מוצרים — סטודיו ברקת') + `
    <h1>מוצרים</h1>
    <form method="get" action="/products" role="search"><label for="q">חיפוש</label>
      <input id="q" name="q" type="search" value=""><button>חפש</button></form>
    ${term ? `<p>תוצאות עבור: ${term}</p>` : ''}
    ${list.map(p => `<div class="card"><h2>${p.name}</h2><p>₪${p.price}</p>
      <form method="post" action="/cart/add"><input type="hidden" name="id" value="${p.id}">
      <button>הוסף לעגלה</button></form></div>`).join('') || '<p>לא נמצאו מוצרים</p>'}` + foot;
  },

  // CONTROL search page: same feature, correctly escaped. Must NOT be flagged.
  '/search-safe': (q) => head('חיפוש — סטודיו ברקת') + `
    <h1>חיפוש</h1><form method="get" action="/search-safe"><label for="s">חיפוש</label>
    <input id="s" name="s" type="search"><button>חפש</button></form>
    ${q.get('s') ? `<p>תוצאות עבור: ${esc(q.get('s'))}</p>` : ''}` + foot,

  // Cart: adding the same item twice shows quantity 1 (exploratory, staging only).
  '/cart': (q, sid) => {
    const c = carts.get(sid) || {};
    const rows = Object.entries(c).map(([id, qty]) => { const p = PRODUCTS.find(x => x.id == id);
      return `<tr><td>${p.name}</td><td data-testid="qty">${Math.min(qty, 1)}</td><td>₪${p.price * qty}</td></tr>`; }).join('');
    return head('עגלה — סטודיו ברקת') + `<h1>העגלה שלך</h1>
      ${rows ? `<table><tr><th>מוצר</th><th>כמות</th><th>סה״כ</th></tr>${rows}</table>` : '<p>העגלה ריקה</p>'}` + foot;
  },

  // About: no dir attribute (RTL gap), left-aligned Hebrew, wide banner → mobile overflow, 2×h1.
  '/about': () => head('אודות', { dir: null, desc: false }) + `
    <h1>אודות</h1>
    <p style="text-align:left">הסטודיו נוסד בשנת 2019 על ידי שתי אמניות קרמיקה מנתניה.</p>
    <div style="width:820px;background:#eee;padding:8px">באנר רחב שלא מתכווץ במובייל</div>
    <h1>הסיפור שלנו</h1>` + foot,

  // Contact: name has no label; whitespace-only name passes; phone is type=text and rejects +972;
  // Hebrew name rejected by an ASCII-only pattern on "city"? no — on "name": pattern blocks Hebrew.
  '/contact': () => head('צור קשר — סטודיו ברקת') + `
    <h1>צור קשר</h1>
    <form id="cf" method="post" action="/contact" novalidate>
      <input id="name" name="name" placeholder="שם מלא" required pattern="[A-Za-z ]+">
      <label for="email">אימייל</label><input id="email" name="email" type="email" required autocomplete="email">
      <label for="phone">טלפון</label><input id="phone" name="phone" type="text" pattern="0[0-9]{8,9}">
      <label for="msg">הודעה</label><textarea id="msg" name="msg"></textarea>
      <button type="submit">שלח</button>
      <p id="err" class="err" role="alert"></p>
    </form>
    <script>
      document.getElementById('cf').addEventListener('submit', e => {
        const f = e.target; const bad = [...f.elements].filter(x => x.willValidate && !x.checkValidity());
        if (bad.length) { e.preventDefault(); document.getElementById('err').textContent = 'יש שדות לא תקינים: ' + bad.map(b => b.name).join(', '); }
      });
    </script>` + foot,

  // Soft 404: says "not found" but returns 200.
  '/team': () => head('העמוד לא נמצא') + `<h1>העמוד לא נמצא</h1><p>מצטערים, העמוד שחיפשת לא קיים.</p>` + foot,

  // CONTROL policy page: correct RTL, labels, one h1, nothing to report except site-wide headers.
  '/policy': () => head('מדיניות פרטיות — סטודיו ברקת') + `<h1>מדיניות פרטיות</h1>
    <p>אנחנו שומרים רק את המידע שנדרש לטיפול בהזמנה.</p><p><a href="/search-safe">חיפוש באתר</a></p>` + foot,
};

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${port}`);
  const sid = (req.headers.cookie || '').match(/sessionid=([^;]+)/)?.[1] || Math.random().toString(36).slice(2);
  // Session cookie without HttpOnly (gap) + version disclosure; no CSP / XFO / nosniff / Referrer-Policy.
  const baseHeaders = { 'x-powered-by': 'Express 4.17.1', 'set-cookie': `sessionid=${sid}; Path=/; SameSite=Lax` };

  // Login wall for coverage-honesty: account pages redirect to /login.
  if (u.pathname.startsWith('/account')) { res.writeHead(302, { ...baseHeaders, location: `/login?next=${encodeURIComponent(u.pathname)}` }); return res.end(); }
  if (u.pathname === '/login') { res.writeHead(200, { ...baseHeaders, 'content-type': 'text/html; charset=utf-8' });
    return res.end(head('התחברות — סטודיו ברקת') + `<h1>התחברות</h1><form method="post" action="/login"><label for="u">אימייל</label><input id="u" name="u" type="email" autocomplete="email"><label for="p">סיסמה</label><input id="p" name="p" type="password"><button>כניסה</button></form>` + foot); }
  if (u.pathname === '/.env') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('DB_PASSWORD=demo-not-real\nSTRIPE_KEY=demo\n'); }
  if (u.pathname === '/api/reviews') { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"error":"db down"}'); }
  if (u.pathname === '/api/stock') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
  if (u.pathname === '/img/hero.svg') { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><rect width="300" height="120" fill="#c9b"/></svg>'); }
  if (u.pathname === '/cart/add' && req.method === 'POST') {
    let body = ''; req.on('data', d => body += d); req.on('end', () => {
      const id = new URLSearchParams(body).get('id'); const c = carts.get(sid) || {}; c[id] = (c[id] || 0) + 1; carts.set(sid, c);
      res.writeHead(303, { ...baseHeaders, location: '/cart' }); res.end();
    }); return;
  }
  if (u.pathname === '/contact' && req.method === 'POST') { res.writeHead(200, { ...baseHeaders, 'content-type': 'text/html; charset=utf-8' }); return res.end(head('תודה') + '<h1>תודה! נחזור אלייך בקרוב</h1>' + foot); }
  const render = pages[u.pathname];
  if (render) { res.writeHead(200, { ...baseHeaders, 'content-type': 'text/html; charset=utf-8' }); return res.end(render(u.searchParams, sid)); }
  // Unknown routes (incl. /blog): real 404 — /blog is a broken nav link.
  res.writeHead(404, { ...baseHeaders, 'content-type': 'text/html; charset=utf-8' });
  res.end(head('404') + '<h1>404</h1>' + foot);
});
server.listen(port, () => console.log(`demo-app on http://localhost:${port}`));
