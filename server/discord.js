const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Posts to a Discord webhook, one message at a time, never the same text twice in a row. */
export class Discord {
  constructor(url) {
    this.url = url;
    this.queue = Promise.resolve();
    this.lastText = null;
  }

  post(text) {
    if (!text || text === this.lastText) return this.queue;
    this.lastText = text;
    if (!this.url) {
      console.log(`[discord:off] ${text}`);
      return this.queue;
    }
    this.queue = this.queue.then(() => this.send(text)).catch((err) => console.warn(`[discord] ${err.message}`));
    return this.queue;
  }

  async send(text) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, username: 'Meta Orbit', allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        await sleep(Math.min(10, body.retry_after ?? 1) * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`webhook ${res.status}: ${(await res.text()).slice(0, 200)}`);
      await sleep(400); // stay well under Discord's webhook rate limit
      return;
    }
  }
}
