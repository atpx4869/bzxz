// Shared HTTP agent with connection pooling
import { Agent } from 'undici';

// Reuse TCP/TLS connections across all fetch calls
export const httpAgent = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 16,
});

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
};

export async function pooledFetch(url: string, init?: RequestInit): Promise<Response> {
  const maxRetries = 3;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const resp = await fetch(url, {
        ...init,
        headers: { ...headers, ...init?.headers },
        // @ts-ignore
        dispatcher: httpAgent,
      });
      if (resp.ok || resp.status < 500) return resp;
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return resp;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError ?? new Error('pooledFetch: all retries failed');
}
