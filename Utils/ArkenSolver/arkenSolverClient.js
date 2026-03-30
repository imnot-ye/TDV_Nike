/**
 * Client for Arken-Solvers async solver API (POST /createTask, POST /getTaskResult).
 * @see Arken-Solvers/API.md — defaults match production; override with ARKEN_SOLVER_URL / ARKEN_SOLVER_API_KEY.
 */

const POLL_MS = 1500;
const MAX_WAIT_MS = 10 * 60 * 1000;

const DEFAULT_ARKEN_SOLVER_URL = 'http://213.136.81.233:3000';
const DEFAULT_ARKEN_SOLVER_API_KEY = 'aDsXcFdR?3sr_easF';

export function getArkenSolverConfig() {
    const base = (process.env.ARKEN_SOLVER_URL || DEFAULT_ARKEN_SOLVER_URL).trim().replace(/\/+$/, '');
    const apiKey = (process.env.ARKEN_SOLVER_API_KEY || DEFAULT_ARKEN_SOLVER_API_KEY).trim();
    return { base, apiKey };
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function postArkenJson(path, body, apiKey, base) {
    const url = `${base}${path}?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = { _raw: text };
    }
    if (!res.ok) {
        const msg = data.error || data.message || text || `HTTP ${res.status}`;
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data;
}

/**
 * L'API Arken richiede proxy http(s) con porta esplicita.
 */
export function ensureProxyUrlForArken(proxyInput) {
    const raw = String(proxyInput ?? '').trim();
    if (!raw) return raw;
    try {
        const withProto = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
        const u = new URL(withProto);
        if (!u.port) {
            u.port = u.protocol === 'https:' ? '443' : '80';
        }
        return u.href;
    } catch {
        return raw;
    }
}

/**
 * Converte `cookies.*.raw` del worker in formato tlsPool.addCookiesToSession.
 */
export function tlsCookiesFromSolverRaw(raw, pageUrl) {
    let host = '';
    try {
        host = new URL(pageUrl).hostname;
    } catch {
        /* ignore */
    }
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const cookie of raw) {
        if (!cookie || typeof cookie !== 'object') continue;
        if (!cookie.name || cookie.value === undefined) continue;
        const cookieObj = {
            name: cookie.name,
            value: String(cookie.value),
            domain: cookie.domain || host,
        };
        if (cookie.path) cookieObj.path = cookie.path;
        out.push(cookieObj);
    }
    return out;
}

/**
 * @param {{ mode: 'cf'|'akamai'|'queueit', url: string, proxy: string, logger?: { logMessage: Function } }} opts
 * @returns {Promise<object>} Success payload (worker shape: cookies, sessionId, …)
 */
export async function runArkenSolverTask(opts) {
    const { mode, url, proxy } = opts;
    const { base, apiKey } = getArkenSolverConfig();
    const proxyNorm = ensureProxyUrlForArken(proxy);
    if (!proxyNorm) {
        throw new Error('proxy is required for Arken solver');
    }

    const create = await postArkenJson('/createTask', { mode, url, proxy: proxyNorm }, apiKey, base);
    const taskId = create.taskId;
    if (!taskId) {
        throw new Error('createTask: missing taskId');
    }

    const start = Date.now();
    while (Date.now() - start < MAX_WAIT_MS) {
        await sleep(POLL_MS);
        const r = await postArkenJson('/getTaskResult', { taskId }, apiKey, base);
        if (r.status === 'pending') continue;
        if (r.status === 'failed') {
            throw new Error(r.error || 'Solver task failed');
        }
        if (r.status === 'success') {
            return r.payload;
        }
    }
    throw new Error('Solver task timeout');
}

/**
 * Mode-specific cookie bucket for TLS/session (Playwright-shaped .raw arrays).
 */
export function pickCookieBuckets(payload, mode) {
    const c = payload?.cookies;
    if (!c || typeof c !== 'object') return { raw: [], formatted: '' };
    const m = String(mode).toLowerCase();
    if (m === 'cf') {
        const bucket = c.cloudflare?.raw?.length ? c.cloudflare : c.all;
        return { raw: bucket?.raw || [], formatted: bucket?.formatted || '' };
    }
    if (m === 'akamai') {
        const bucket = c.akamai?.raw?.length ? c.akamai : c.all;
        return { raw: bucket?.raw || [], formatted: bucket?.formatted || '' };
    }
    if (m === 'queueit') {
        const bucket = c.queue?.raw?.length ? c.queue : c.all;
        return { raw: bucket?.raw || [], formatted: bucket?.formatted || '' };
    }
    return { raw: c.all?.raw || [], formatted: c.all?.formatted || '' };
}
