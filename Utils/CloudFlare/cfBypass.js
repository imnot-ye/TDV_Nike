import chalk from 'chalk';
import { applyArkenSolverToTlsSession } from '../ArkenSolver/solverSessionBridge.js';

/**
 * Parse proxy details string into object format
 * @param {string} proxyDetails - Proxy string in format "https://username:password@host:port"
 * @returns {Object} Proxy object with host, port, username, password
 */
export function parseProxyDetails(proxyDetails) {
    try {
        const proxyInfo = proxyDetails.split('://')[1];
        const [authPart, hostPart] = proxyInfo.split('@');
        const [username, password] = authPart.split(':');
        const [host, port] = hostPart.split(':');

        return {
            host: host,
            port: parseInt(port, 10),
            username: username,
            password: password,
        };
    } catch (error) {
        throw new Error(`Invalid proxy_details format. Expected 'https://username:password@host:port'. Error: ${error.message}`);
    }
}

/**
 * Cloudflare — usa API Arken async (mode cf) e tlsPool.
 */
export async function updateSessionCookies(sessionId, url, proxyDetails, logger) {
    return applyArkenSolverToTlsSession('cf', sessionId, url, proxyDetails, logger);
}

/**
 * Deprecated version (for backward compatibility)
 */
export async function updateSessionCookiesDep(sessionId, url, proxyDetails, logger) {
    return updateSessionCookies(sessionId, url, proxyDetails, logger);
}
