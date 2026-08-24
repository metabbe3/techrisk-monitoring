import 'dotenv/config';
import { BrowserSession } from './browser.js';
import { URLS } from './selectors.js';

// Live selector finder: opens a headful browser with your saved session.
// Click anything and it prints a robust selector (ng-model / id / unique class)
// you can paste into src/selectors.js. Ctrl+C to exit (session auto-saved).

const CLICK_LOGGER = `(() => {
  if (window.__selLogger) return;
  window.__selLogger = true;
  document.addEventListener('click', (e) => {
    const el = e.target.closest('a,button,input,select,textarea,label,li,[role="tab"],[ng-click],[ng-model]') || e.target;
    if (!el || !el.tagName) return;
    let sel;
    const tag = el.tagName.toLowerCase();
    if (el.id) sel = tag + '#' + el.id;
    else if (el.getAttribute('ng-model')) sel = tag + '[ng-model="' + el.getAttribute('ng-model') + '"]';
    else if (el.getAttribute('ng-click')) sel = tag + '[ng-click="' + el.getAttribute('ng-click') + '"]';
    else {
      sel = tag;
      for (const c of el.classList || []) {
        const s = tag + '.' + CSS.escape(c);
        if (document.querySelectorAll(s).length === 1) { sel = s; break; }
      }
    }
    const text = (el.textContent || el.value || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
    console.log('SELECTOR>> ' + sel + '   | text: ' + text);
  }, true);
})();`;

const session = new BrowserSession({ headless: false });
await session.start();

// Re-inject on every SPA/full navigation.
await session.context.addInitScript(CLICK_LOGGER);

session.page.on('console', (msg) => {
  const text = msg.text();
  if (text.startsWith('SELECTOR>>')) console.log(text);
});

console.log('Opening DANA. Click around — selectors print below. Ctrl+C to quit.\n');
await session.page
  .goto(process.env.LOGIN_URL || URLS.login, { waitUntil: 'domcontentloaded', timeout: 60000 })
  .catch((e) => console.log(`goto: ${e.message}`));

// Keep the session file fresh while you browse.
const saver = setInterval(() => session.saveSession().catch(() => {}), 30000);

process.on('SIGINT', async () => {
  clearInterval(saver);
  await session.saveSession().catch(() => {});
  await session.close();
  process.exit(0);
});
