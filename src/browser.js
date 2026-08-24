import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

// Owns the browser lifecycle, route blocking (the real speed win on this slow
// site), and storageState persistence so login happens once per session life.
export class BrowserSession {
  constructor({ headless = true, stateFile = 'sessions/state.json', blockRoutes = true } = {}) {
    this.headless = headless;
    this.stateFile = stateFile;
    this.blockRoutes = blockRoutes; // false = measure the site's real speed (audit mode)
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  async start() {
    this.browser = await chromium.launch({
      headless: this.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-software-rasterizer',
        '--disable-notifications',
      ],
    });

    const opts = { viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true };
    if (fs.existsSync(this.stateFile)) {
      opts.storageState = this.stateFile;
      console.log('Loaded saved session.');
    }

    this.context = await this.browser.newContext(opts);
    if (this.blockRoutes) {
      // Speed: kill images/fonts/media + telemetry. Site is AngularJS-heavy already.
      await this.context.route('**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,ttf,eot,mp4,mp3,webp}', (r) =>
        r.abort()
      );
      await this.context.route('**/analytics/**', (r) => r.abort());
      await this.context.route('**/tracking/**', (r) => r.abort());
    }

    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(30000);
    this.page.setDefaultNavigationTimeout(60000);
    return this;
  }

  async saveSession() {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    await this.context.storageState({ path: this.stateFile });
    console.log('Session saved.');
  }

  async close() {
    try {
      await this.context?.close();
    } catch {}
    try {
      await this.browser?.close();
    } catch {}
  }
}
