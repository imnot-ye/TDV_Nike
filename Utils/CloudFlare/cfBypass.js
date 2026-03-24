import { addCookiesToSession, getCookiesFromSession } from '../tlsPool.js';
import chalk from 'chalk';
import https from 'https';
import http from 'http';
import { URL } from 'url';

/**
 * Parse proxy details string into object format
 * @param {string} proxyDetails - Proxy string in format "https://username:password@host:port"
 * @returns {Object} Proxy object with host, port, username, password
 */
export function parseProxyDetails(proxyDetails) {
    try {
        // Remove 'https://' or 'http://' and split into auth@host:port
        const proxyInfo = proxyDetails.split('://')[1];

        // Split into auth and host:port
        const [authPart, hostPart] = proxyInfo.split('@');

        // Extract username and password
        const [username, password] = authPart.split(':');

        // Extract host and port
        const [host, port] = hostPart.split(':');

        return {
            host: host,
            port: parseInt(port, 10),
            username: username,
            password: password
        };
    } catch (error) {
        throw new Error(`Invalid proxy_details format. Expected 'https://username:password@host:port'. Error: ${error.message}`);
    }
}

/**
 * Make HTTP request (for CF bypass service)
 */
async function makeHttpRequest(url) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const isHttps = parsedUrl.protocol === 'https:';
        const httpModule = isHttps ? https : http;

        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            timeout: 600000 // 10 minutes
        };

        const req = httpModule.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve({ status: res.statusCode, body: JSON.parse(body) });
                    } catch (e) {
                        resolve({ status: res.statusCode, body: body });
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.end();
    });
}

/**
 * Update session cookies using CloudFlare bypass service
 * Adds cookies directly to the TLS session
 * @param {string} sessionId - TLS session ID
 * @param {string} url - Target URL
 * @param {string} proxyDetails - Proxy string
 * @param {Logger} logger - Logger instance
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
export async function updateSessionCookies(sessionId, url, proxyDetails, logger) {
    if (!proxyDetails) {
        logger.logMessage('Proxy non valida. Ignorata.', null, chalk.yellow);
        return false;
    }

    try {
        logger.logMessage('GENERATING CF COOKIE', null, chalk.magenta);

        // Call the CF bypass service
        const bypassUrl = `http://213.136.81.233:8000/cloudflare?key=axCszErd23w&url=${encodeURIComponent(url)}&proxy=${encodeURIComponent(proxyDetails)}`;

        const response = await makeHttpRequest(bypassUrl);

        if (response.status !== 200) {
            logger.logMessage(`HTTP RESPONSE ERROR FROM SERVER COOKIEGEN: ${response.status}`, null, chalk.yellow);
            if (typeof response.body === 'string') {
                console.log(response.body);
            } else {
                console.log(JSON.stringify(response.body));
            }
            return { success: false, cookies: [] };
        }

        const cfData = response.body;
        console.log(cfData);
        if (cfData.status !== 'success') {
            logger.logMessage(`ERROR FROM SERVER: ${cfData.message || 'Unknown error'}`, null, chalk.red);
            return { success: false, cookies: [] };
        }

        logger.logMessage('COOKIE GENERATED SUCCESSFULLY', null, chalk.magenta);

        const cfCookies = cfData.cookies?.raw || [];
        console.log(cfCookies);
        // Convert cookies to format for addCookiesToSession
        // Format: {sessionId: '...', cookies: [{name: '...', value: '...', domain: '...', path: '...'}, ...]}
        const cookies = [];
        if (Array.isArray(cfCookies)) {
            for (const cookie of cfCookies) {
                if (cookie.name && cookie.value) {
                    const cookieObj = {
                        name: cookie.name,
                        value: cookie.value,
                        domain: cookie.domain || new URL(url).hostname
                    };
                    // Add path if available
                    if (cookie.path) {
                        cookieObj.path = cookie.path;
                    }
                    cookies.push(cookieObj);
                }
            }
        }

        logger.logMessage(`CONVERTED ${cookies.length} COOKIES FOR SESSION`, null, chalk.yellow);

        // Add cookies to session
        let addedCookies = [];
        if (cookies.length > 0 && sessionId) {
            logger.logMessage(`ADDING ${cookies.length} COOKIES TO SESSION`, null, chalk.yellow);
            const addResult = await addCookiesToSession({
                sessionId: sessionId,
                cookies: cookies
            });

            // Use cookies from addResult if available, otherwise use the cookies we prepared
            if (addResult && addResult.cookies && Array.isArray(addResult.cookies)) {
                addedCookies = addResult.cookies;
                logger.logMessage(`COOKIES ADDED TO SESSION: ${addedCookies.length} cookies`, null, chalk.blue);
            } else {
                // Fallback: use the cookies we prepared
                addedCookies = cookies;
                logger.logMessage(`USING PREPARED COOKIES: ${addedCookies.length} cookies`, null, chalk.blue);
            }
        } else {
            logger.logMessage('NO COOKIES TO ADD OR SESSION ID MISSING', null, chalk.yellow);
        }

        logger.logMessage('COOKIE GENERATED SUCCESSFULLY', 200, chalk.magenta);
        // Return the cookies so they can be used directly in the request
        return { success: true, cookies: addedCookies };

    } catch (error) {
        logger.logMessage(`ERROR WHILE GENERATING COOKIE: ${error.message}`, null, chalk.red);
        return { success: false, cookies: [] };
    }
}

/**
 * Deprecated version (for backward compatibility)
 */
export async function updateSessionCookiesDep(sessionId, url, proxyDetails, logger) {
    return updateSessionCookies(sessionId, url, proxyDetails, logger);
}

