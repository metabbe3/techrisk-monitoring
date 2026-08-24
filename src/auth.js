import { URLS, LOGIN } from './selectors.js';
import { sleep, firstVisible } from './util.js';

// Login against the Ant Financial Cloud auth center + session detection.
export class AuthService {
  constructor(page) {
    this.page = page;
  }

  async isLoggedIn() {
    const reached = await this.page
      .goto(URLS.optimus, { waitUntil: 'domcontentloaded', timeout: 60000 })
      .then(() => true)
      .catch((e) => {
        console.log(`cannot reach ${URLS.optimus} (${e.message})`);
        return false;
      });
    if (!reached) return false; // unreachable host → doLogin will name the network error clearly
    // Soft wait: if the SPA boots the dashboard we're in; if the session is dead
    // it redirects to auth.
    await this.page.waitForSelector('h3.chart-title span, span[ng-click]', { timeout: 10000 }).catch(() => {});
    return !this.#onLoginPage();
  }

  async ensureLoggedIn(email, password, loginUrl) {
    if (await this.isLoggedIn()) {
      console.log('Session valid — skipping login.');
      return;
    }
    await this.#doLogin(email, password, loginUrl || URLS.login);
    // A "successful" submit can still leave us on the login page (rejected
    // credentials, expired OTP) — verify before letting the run continue.
    await this.page.waitForTimeout(2000);
    if (this.#onLoginPage()) {
      throw new Error('login rejected — still on the login page after submit. Check LOGIN_EMAIL/LOGIN_PASSWORD in .env');
    }
  }

  async #doLogin(email, password, loginUrl) {
    console.log('Logging in...');
    const page = this.page;
    try {
      await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

      const emailEl = await firstVisible(page, LOGIN.email, 30000);
      await emailEl.fill(email);
      const passEl = await firstVisible(page, LOGIN.password, 10000);
      await passEl.fill(password);
      const submit = await firstVisible(page, LOGIN.submit, 10000);
      await submit.click();

      const initialUrl = page.url();
      await page.waitForFunction((u) => window.location.href !== u, initialUrl, {
        timeout: 60000,
        polling: 1000,
      });

      // The site sometimes lands on a random console page after login — recover
      // by navigating straight to the goto= target.
      const target = this.#extractGoto(loginUrl);
      if (target && !page.url().includes('monitor.paas.dana.id')) {
        console.log(`Login landed on wrong page (${page.url()}), forcing goto target...`);
        await page.goto(target, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
      }
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      console.log(`Login done. URL: ${page.url()}`);
    } catch (e) {
      // Name the likely cause instead of a bare selector/timeout message —
      // this is the text the UI shows on the CAPTURE FAILED badge.
      console.error(`LOGIN FAILED: ${e.message}`);
      if (/waiting for selector|strict mode|Timeout.*exceeded/i.test(e.message)) {
        throw new Error(`login form never appeared (${e.message}) — this server may not reach ${loginUrl}; check VPN/network`);
      }
      if (/waitForFunction/i.test(e.message)) {
        throw new Error('login submitted but the page never moved on — credentials likely rejected; check LOGIN_EMAIL/LOGIN_PASSWORD in .env');
      }
      throw e;
    }
  }

  #onLoginPage() {
    const url = this.page.url();
    return url.includes('auth.paas.dana.id') || url.includes('login');
  }

  #extractGoto(loginUrl) {
    const m = loginUrl.match(/[?&]goto=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
}
