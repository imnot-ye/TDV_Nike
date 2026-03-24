/**
 * Generate headers for TLS client (matching real browser)
 * Always returns the same headers for consistency
 * @returns {Object} - Headers and TLS version
 */
export function generateHeaders() {
  const headers = {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'max-age=0',
    'priority': 'u=0, i',
    'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
    'sec-ch-ua-arch': '"x86"',
    'sec-ch-ua-bitness': '"64"',
    'sec-ch-ua-full-version': '"145.0.7632.117"',
    'sec-ch-ua-full-version-list': '"Not:A-Brand";v="99.0.0.0", "Google Chrome";v="145.0.7632.117", "Chromium";v="145.0.7632.117"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-model': '""',
    'sec-ch-ua-platform': '"Windows"',
    'sec-ch-ua-platform-version': '"12.0.0"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'same-origin',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
  };

  return {
    headers,
    tlsVersion: 'chrome_133_PSK'
  };
}

/**
 * Generate random cookies
 * @returns {Object} - Cookie object
 */
export function genCookie() {
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const userId = `user_${Math.random().toString(36).substring(7)}`;

  return {
    session_id: sessionId,
    user_id: userId,
    preferences: 'accepted'
  };
}

