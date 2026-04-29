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
  return fetch(url, {
    ...init,
    headers: { ...headers, ...init?.headers },
    // @ts-ignore
    dispatcher: httpAgent,
  });
}
