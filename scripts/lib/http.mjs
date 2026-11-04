// Polite HTTP client for the data pipeline.
//
// - Paces requests per host (minimum gap between requests + max concurrency),
//   so we stay inside each free API's rate limit.
// - Retries on network errors, HTTP 429 and 5xx, honouring Retry-After.
// - Records every request (URL, status, time, size, error) so the site can
//   show exactly what was fetched, when, and what failed.

const USER_AGENT =
  'defi-research-dashboard/1.0 (+https://github.com/austinpliu/defi-research-dashboard)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HostGate {
  constructor({ minIntervalMs = 0, concurrency = 4 } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.concurrency = concurrency;
    this.active = 0;
    this.lastStart = 0;
    this.waiters = [];
  }

  async acquire() {
    while (this.active >= this.concurrency) {
      await new Promise((r) => this.waiters.push(r));
    }
    this.active += 1;
    const wait = this.lastStart + this.minIntervalMs - Date.now();
    this.lastStart = Math.max(Date.now(), this.lastStart + this.minIntervalMs);
    if (wait > 0) await sleep(wait);
  }

  release() {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

export class Http {
  /**
   * budgetMs: overall time budget for the run; once spent, new requests are
   * skipped (and reported) so a slow or rate-limiting API can't stall the job.
   * tripAfter: after this many requests to one host in a row end in HTTP 429
   * (even after retries), further requests to that host are skipped this run.
   */
  constructor({ verbose = true, budgetMs = Infinity, tripAfter = 3, hostDefaults = {} } = {}) {
    this.requests = [];
    this.hostDefaults = hostDefaults; // pacing for hosts without their own configureHost()
    this.gates = new Map();
    this.verbose = verbose;
    this.deadline = Date.now() + budgetMs;
    this.tripAfter = tripAfter;
    this.consecutive429 = new Map();
    this.tripped = new Set();
  }

  skip(url, method, label, reason) {
    const fetchedAt = new Date().toISOString();
    const result = { ok: false, status: 0, data: null, error: reason, url, fetchedAt, ms: 0, bytes: 0, attempts: 0, label, method, skipped: true };
    this.requests.push({ label, method, url, status: 0, ok: false, error: reason, fetchedAt, ms: 0, bytes: 0, attempts: 0, skipped: true });
    if (this.verbose) console.log(`- ${method} skip ${url}  → ${reason}`);
    return result;
  }

  configureHost(host, opts) {
    // HTTP_NO_PACING=1 is only for offline tests against stubbed responses.
    const noPacing = process.env.HTTP_NO_PACING === '1';
    this.gates.set(host, new HostGate(noPacing ? { ...opts, minIntervalMs: 0 } : opts));
  }

  gateFor(host) {
    if (!this.gates.has(host)) this.configureHost(host, this.hostDefaults);
    return this.gates.get(host);
  }

  /**
   * Fetch a URL. Never throws: always resolves to a result object
   * { ok, status, data, error, url, fetchedAt, ms, bytes, attempts }.
   */
  async request(url, opts = {}) {
    const {
      method = 'GET',
      body,
      headers = {},
      parse = 'json',
      timeoutMs = 60000,
      retries = 3,
      backoffMs = 4000,
      label = '',
    } = opts;
    const host = new URL(url).host;
    if (this.tripped.has(host)) return this.skip(url, method, label, `Skipped: ${host} kept answering HTTP 429 (rate limited) earlier in this run`);
    if (Date.now() > this.deadline) return this.skip(url, method, label, 'Skipped: the run reached its time budget');
    const gate = this.gateFor(host);
    let attempt = 0;
    let result;

    while (true) {
      attempt += 1;
      await gate.acquire();
      const started = Date.now();
      const fetchedAt = new Date().toISOString();
      let status = 0;
      let retryAfterMs = null;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const res = await fetch(url, {
          method,
          body,
          headers: {
            'User-Agent': USER_AGENT,
            Accept:
              parse === 'json'
                ? 'application/json'
                : 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
            ...headers,
          },
          signal: controller.signal,
          redirect: 'follow',
        });
        status = res.status;
        const ra = res.headers.get('retry-after');
        if (ra) {
          const secs = Number(ra);
          retryAfterMs = Number.isFinite(secs)
            ? secs * 1000
            : Math.max(0, new Date(ra).getTime() - Date.now());
        }
        const text = await res.text();
        clearTimeout(timer);
        const ms = Date.now() - started;
        if (!res.ok) {
          result = {
            ok: false,
            status,
            data: null,
            error: `HTTP ${status}${text ? `: ${text.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`,
            url,
            finalUrl: res.url,
            fetchedAt,
            ms,
            bytes: text.length,
          };
        } else if (parse === 'json') {
          try {
            result = { ok: true, status, data: JSON.parse(text), error: null, url, finalUrl: res.url, fetchedAt, ms, bytes: text.length };
          } catch (e) {
            result = { ok: false, status, data: null, error: `Response was not valid JSON (${e.message.slice(0, 80)})`, url, finalUrl: res.url, fetchedAt, ms, bytes: text.length };
          }
        } else {
          result = { ok: true, status, data: text, error: null, url, finalUrl: res.url, fetchedAt, ms, bytes: text.length };
        }
      } catch (e) {
        const ms = Date.now() - started;
        const reason = e.name === 'AbortError' ? `Timed out after ${Math.round(timeoutMs / 1000)}s` : `Network error: ${e.cause?.code || e.message}`;
        result = { ok: false, status, data: null, error: reason, url, fetchedAt, ms, bytes: 0 };
      } finally {
        gate.release();
      }

      const retryable = !result.ok && (status === 0 || status === 429 || status >= 500);
      const timeLeft = this.deadline - Date.now();
      if (retryable && attempt <= retries && timeLeft > 30000) {
        const wait = process.env.HTTP_NO_PACING === '1' ? 0 : Math.min(retryAfterMs ?? backoffMs * 2 ** (attempt - 1), 90000);
        if (this.verbose) console.log(`  ↻ retry ${attempt}/${retries} in ${Math.round(wait / 1000)}s: ${result.error} — ${url}`);
        await sleep(wait);
        continue;
      }
      break;
    }

    if (result.status === 429) {
      const n = (this.consecutive429.get(host) || 0) + 1;
      this.consecutive429.set(host, n);
      if (n >= this.tripAfter && !this.tripped.has(host)) {
        this.tripped.add(host);
        if (this.verbose) console.log(`!! ${host} rate-limited ${n} requests in a row; skipping it for the rest of this run`);
      }
    } else {
      this.consecutive429.set(host, 0);
    }
    result.attempts = attempt;
    result.label = label;
    result.method = method;
    this.requests.push({
      label,
      method,
      url,
      status: result.status,
      ok: result.ok,
      error: result.error,
      fetchedAt: result.fetchedAt,
      ms: result.ms,
      bytes: result.bytes,
      attempts: attempt,
    });
    if (this.verbose) {
      const kb = (result.bytes / 1024).toFixed(0);
      console.log(`${result.ok ? '✓' : '✗'} ${method} ${result.status || '---'} ${String(result.ms).padStart(5)}ms ${kb.padStart(6)}KB ${url}${result.ok ? '' : `  → ${result.error}`}`);
    }
    return result;
  }

  json(url, opts = {}) {
    return this.request(url, { ...opts, parse: 'json' });
  }

  text(url, opts = {}) {
    return this.request(url, { ...opts, parse: 'text' });
  }
}
