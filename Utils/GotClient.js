import got from 'got';
import { HttpsProxyAgent } from 'hpagent';

/**
 * Create a got instance with proxy support
 * @param {string} proxyUrl - Proxy URL (http://user:pass@host:port)
 * @returns {got} - Got instance with proxy
 */
export function createGotWithProxy(proxyUrl = null) {
  const options = {
    retry: {
      limit: 2,
      methods: ['GET', 'POST', 'PUT', 'DELETE']
    },
    timeout: {
      request: 30000
    },
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
    }
  };

  if (proxyUrl) {
    options.agent = {
      https: new HttpsProxyAgent({
        proxy: proxyUrl
      })
    };
  }

  return got.extend(options);
}

/**
 * Make a simple GET request with got
 * @param {string} url - URL to request
 * @param {string} proxyUrl - Optional proxy URL
 * @returns {Promise<Object>} - Response object
 */
export async function simpleRequest(url, proxyUrl = null) {
  const gotInstance = createGotWithProxy(proxyUrl);

  try {
    const response = await gotInstance(url);
    return {
      status: response.statusCode,
      body: response.body,
      headers: response.headers
    };
  } catch (error) {
    throw new Error(`Request failed: ${error.message}`);
  }
}

