import chalk from 'chalk';
import { addCookiesToSession } from '../tlsPool.js';
import {
    runArkenSolverTask,
    pickCookieBuckets,
    tlsCookiesFromSolverRaw,
    ensureProxyUrlForArken,
} from './arkenSolverClient.js';

const MODE_LABEL = {
    cf: 'CF',
    akamai: 'AKAMAI',
    queueit: 'QUEUE-IT',
};

/**
 * Esegue createTask/getTaskResult sull'API Arken e applica i cookie al TLS session (o li restituisce).
 * @param {'cf'|'akamai'|'queueit'} mode
 * @returns {Promise<{ success: boolean, cookies: Array }>}
 */
export async function applyArkenSolverToTlsSession(mode, sessionId, url, proxyDetails, logger) {
    const proxyStr = ensureProxyUrlForArken(proxyDetails);
    if (!proxyStr) {
        logger.logMessage('Proxy non valida. Ignorata.', null, chalk.yellow);
        return { success: false, cookies: [] };
    }

    const label = MODE_LABEL[mode] || String(mode).toUpperCase();

    try {
        logger.logMessage(`GENERATING ${label} COOKIE (Arken)`, null, chalk.magenta);

        const payload = await runArkenSolverTask({
            mode,
            url,
            proxy: proxyStr,
        });

        const { raw } = pickCookieBuckets(payload, mode);
        const cookies = tlsCookiesFromSolverRaw(raw, url);

        logger.logMessage(`CONVERTED ${cookies.length} COOKIES FOR SESSION`, null, chalk.yellow);

        let addedCookies = [];
        if (cookies.length > 0 && sessionId) {
            logger.logMessage(`ADDING ${cookies.length} COOKIES TO SESSION`, null, chalk.yellow);
            const addResult = await addCookiesToSession({
                sessionId,
                cookies,
            });

            if (addResult && addResult.cookies && Array.isArray(addResult.cookies)) {
                addedCookies = addResult.cookies;
                logger.logMessage(`COOKIES ADDED TO SESSION: ${addedCookies.length} cookies`, null, chalk.blue);
            } else {
                addedCookies = cookies;
                logger.logMessage(`USING PREPARED COOKIES: ${addedCookies.length} cookies`, null, chalk.blue);
            }
        } else {
            logger.logMessage('NO COOKIES TO ADD OR SESSION ID MISSING', null, chalk.yellow);
        }

        logger.logMessage('COOKIE GENERATED SUCCESSFULLY', 200, chalk.magenta);
        return { success: true, cookies: addedCookies };
    } catch (error) {
        logger.logMessage(`ERROR WHILE GENERATING COOKIE: ${error.message}`, null, chalk.red);
        return { success: false, cookies: [] };
    }
}
