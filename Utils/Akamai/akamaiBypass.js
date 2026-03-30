import { applyArkenSolverToTlsSession } from '../ArkenSolver/solverSessionBridge.js';

/**
 * Akamai — stesso flusso di cfBypass ma mode `akamai` (API Arken).
 * @returns {Promise<{ success: boolean, cookies: Array }>}
 */
export async function updateAkamaiSessionCookies(sessionId, url, proxyDetails, logger) {
    return applyArkenSolverToTlsSession('akamai', sessionId, url, proxyDetails, logger);
}
