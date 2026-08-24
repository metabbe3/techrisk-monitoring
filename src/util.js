export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function retry(fn, attempts = 3, delayMs = 2000, label = 'step') {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      console.log(`  retry ${label} (${i + 1}/${attempts}): ${e.message}`);
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

// Walk a fallback chain, return the first visible element handle.
export async function firstVisible(page, selectors, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el && (await el.isVisible())) return el;
      } catch {}
    }
    await sleep(500);
  }
  throw new Error(`no visible element for: ${selectors.join(' | ')}`);
}
