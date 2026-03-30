import { applyArkenSolverToTlsSession } from '../ArkenSolver/solverSessionBridge.js';

/**
 * Queue-it / coda virtuale — mode `queueit` (API Arken).
 * @returns {Promise<{ success: boolean, cookies: Array }>}
 */
export async function updateQueueItSessionCookies(sessionId, url, proxyDetails, logger) {
    return applyArkenSolverToTlsSession('queueit', sessionId, url, proxyDetails, logger);
}
