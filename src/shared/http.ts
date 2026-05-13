// Shared HTTP agent with connection pooling
import { Agent, setGlobalDispatcher } from 'undici';

// Reuse TCP/TLS connections across all fetch calls
// No proxy — direct connection only (bypass Clash / system proxy)
export const httpAgent = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 16,
});

// Force global undici dispatcher to use direct Agent (no proxy)
setGlobalDispatcher(httpAgent);

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
};

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

export async function fetchWithTimeoutAndRetry(url: string, init: FetchWithTimeoutOptions = {}): Promise<Response> {
  const { timeoutMs = 15_000, retries = 3, retryDelayMs = 1_000, signal, ...requestInit } = init;
  const maxRetries = Math.max(1, retries);
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
    const abortFromParent = () => ctrl.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) ctrl.abort(signal.reason);
      else signal.addEventListener('abort', abortFromParent, { once: true });
    }

    try {
      const resp = await fetch(url, {
        ...requestInit,
        headers: { ...headers, ...requestInit.headers },
        signal: ctrl.signal,
        // @ts-ignore
        dispatcher: httpAgent,
      });
      if (resp.ok || resp.status < 500) return resp;
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, retryDelayMs * (attempt + 1)));
        continue;
      }
      return resp;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, retryDelayMs * (attempt + 1)));
      }
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abortFromParent);
    }
  }
  throw lastError ?? new Error('fetchWithTimeoutAndRetry: all retries failed');
}

export async function pooledFetch(url: string, init?: FetchWithTimeoutOptions): Promise<Response> {
  return fetchWithTimeoutAndRetry(url, init);
}
