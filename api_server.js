import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3006;

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '200kb' }));

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api', apiLimiter);

function bearerFromReq(req) {
    const h = req.headers.authorization || '';
    if (typeof h !== 'string') return null;
    const [scheme, token] = h.split(' ');
    if ((scheme || '').toLowerCase() !== 'bearer') return null;
    return token || null;
}

function requireBearerAuth(req, res, next) {
    const token = bearerFromReq(req);
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });
    try {
        const payload = jwt.verify(token, process.env.TDV_JWT_SECRET, {
            algorithms: ['HS256'],
        });
        req.user = payload;
        return next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

const DATA_DIR = path.join(__dirname, 'Data');
const MONITORS_FILE = path.join(DATA_DIR, 'monitors.json');
const WEBHOOKS_JSON = path.join(DATA_DIR, 'webhooks.json');
const NIKE_PROCESS_NAME = 'nike';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const defaultMonitorsData = () => ({ categories: [], monitors: {} });
if (!fs.existsSync(MONITORS_FILE)) {
    fs.writeFileSync(MONITORS_FILE, JSON.stringify(defaultMonitorsData(), null, 2), 'utf8');
}

const runCommand = (file, args, cwd = __dirname, options = {}) => {
    return new Promise((resolve) => {
        const execOpts = { cwd, maxBuffer: 1024 * 1024 * 20, ...options };
        execFile(file, Array.isArray(args) ? args : [], execOpts, (error, stdout, stderr) => {
            if (error) {
                resolve({ success: false, error: error.message, stderr, stdout: stdout || '' });
            } else {
                resolve({ success: true, stdout: stdout || '' });
            }
        });
    });
};

async function pm2Jlist() {
    const { success, stdout } = await runCommand('pm2', ['jlist']);
    if (!success) return { success: false, processes: [] };
    try {
        const arr = JSON.parse(stdout || '[]');
        return { success: true, processes: Array.isArray(arr) ? arr : [] };
    } catch (e) {
        return { success: false, processes: [] };
    }
}

function getMonitorsData() {
    try {
        const raw = fs.readFileSync(MONITORS_FILE, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.categories) && (typeof data.monitors === 'object')) {
            return {
                categories: data.categories,
                monitors: data.monitors || {}
            };
        }
        const def = defaultMonitorsData();
        if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
            const monitors = {};
            for (const [k, v] of Object.entries(data)) {
                if (v && typeof v === 'object' && v.sku) {
                    monitors[k] = { ...v, category: v.category || null };
                }
            }
            def.monitors = monitors;
        }
        return def;
    } catch (e) {
        return defaultMonitorsData();
    }
}

function saveMonitorsData(data) {
    const toSave = {
        categories: data.categories || [],
        monitors: data.monitors || {}
    };
    fs.writeFileSync(MONITORS_FILE, JSON.stringify(toSave, null, 2), 'utf8');
}

async function reloadNikeProcess() {
    const j = await pm2Jlist();
    const exists = j.success && j.processes.some(p => p.name === NIKE_PROCESS_NAME);
    if (exists) {
        const r = await runCommand('pm2', ['reload', NIKE_PROCESS_NAME]);
        return r.success;
    }
    const monitors = getMonitorsData().monitors;
    const count = Object.keys(monitors).length;
    if (count === 0) return true;
    const r = await runCommand('pm2', ['start', 'nike.js', '--name', NIKE_PROCESS_NAME]);
    return r.success;
}

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', requireBearerAuth);

// Categories
app.get('/api/categories', (req, res) => {
    try {
        const data = getMonitorsData();
        res.json(data.categories || []);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/categories', (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'Category name is required' });
    }
    const trimmed = name.trim();
    if (!trimmed) return res.status(400).json({ error: 'Category name cannot be empty' });
    try {
        const data = getMonitorsData();
        if (data.categories.includes(trimmed)) {
            return res.status(400).json({ error: 'Category already exists' });
        }
        data.categories.push(trimmed);
        data.categories.sort((a, b) => a.localeCompare(b));
        saveMonitorsData(data);
        res.json({ success: true, categories: data.categories });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/categories/:oldName', (req, res) => {
    const { oldName } = req.params;
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'New category name is required' });
    }
    const newName = name.trim();
    if (!newName) return res.status(400).json({ error: 'Category name cannot be empty' });
    try {
        const data = getMonitorsData();
        const idx = data.categories.indexOf(oldName);
        if (idx === -1) return res.status(404).json({ error: 'Category not found' });
        if (data.categories.includes(newName) && newName !== oldName) {
            return res.status(400).json({ error: 'Category already exists' });
        }
        data.categories[idx] = newName;
        data.categories.sort((a, b) => a.localeCompare(b));
        for (const [sku, m] of Object.entries(data.monitors)) {
            if (m.category === oldName) data.monitors[sku].category = newName;
        }
        saveMonitorsData(data);
        res.json({ success: true, categories: data.categories });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/categories/:name', (req, res) => {
    const { name } = req.params;
    try {
        const data = getMonitorsData();
        const idx = data.categories.indexOf(name);
        if (idx === -1) return res.status(404).json({ error: 'Category not found' });
        data.categories.splice(idx, 1);
        for (const [sku, m] of Object.entries(data.monitors)) {
            if (m.category === name) data.monitors[sku].category = null;
        }
        saveMonitorsData(data);
        res.json({ success: true, categories: data.categories });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Monitors
app.get('/api/monitors', async (req, res) => {
    try {
        const data = getMonitorsData();
        const j = await pm2Jlist();
        const processes = j.success ? j.processes : [];
        const nikeProc = processes.find(p => p.name === NIKE_PROCESS_NAME);
        const status = nikeProc?.pm2_env?.status || 'stopped';

        const monitors = {};
        for (const [sku, m] of Object.entries(data.monitors)) {
            monitors[sku] = { ...m, status };
        }
        res.json(monitors);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/monitors', async (req, res) => {
    const { sku, label, marketplace, language, channelId, proxyPool, delay, webhook, category } = req.body;
    if (!sku || !marketplace || !language || !channelId) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    try {
        const data = getMonitorsData();
        data.monitors[sku] = {
            sku,
            label: label && String(label).trim() ? String(label).trim() : null,
            marketplace,
            language,
            channelId,
            proxyPool: proxyPool || 'big_pool',
            delay: parseInt(delay) || 0,
            webhook: webhook && webhook !== 'default' ? webhook : null,
            category: category && String(category).trim() ? String(category).trim() : null
        };
        saveMonitorsData(data);
        const ok = await reloadNikeProcess();
        res.json({ success: true, message: ok ? 'Monitor added' : 'Added but pm2 reload failed' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.put('/api/monitors/:sku', async (req, res) => {
    const { sku } = req.params;
    const { label, marketplace, language, channelId, proxyPool, delay, webhook, category } = req.body;
    try {
        const data = getMonitorsData();
        if (!data.monitors[sku]) return res.status(404).json({ error: 'Monitor not found' });
        const m = data.monitors[sku];
        if (label !== undefined) m.label = label && String(label).trim() ? String(label).trim() : null;
        if (marketplace !== undefined) m.marketplace = marketplace;
        if (language !== undefined) m.language = language;
        if (channelId !== undefined) m.channelId = channelId;
        if (proxyPool !== undefined) m.proxyPool = proxyPool || 'big_pool';
        if (delay !== undefined) m.delay = parseInt(delay) || 0;
        if (webhook !== undefined) m.webhook = webhook && webhook !== 'default' ? webhook : null;
        if (category !== undefined) m.category = category && String(category).trim() ? String(category).trim() : null;
        saveMonitorsData(data);
        await reloadNikeProcess();
        res.json({ success: true, monitor: m });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/monitors/:sku', async (req, res) => {
    const { sku } = req.params;
    try {
        const data = getMonitorsData();
        if (data.monitors[sku]) {
            delete data.monitors[sku];
            saveMonitorsData(data);
        }
        await reloadNikeProcess();
        res.json({ success: true, message: 'Monitor removed' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

async function handleProcessAction(action) {
    const data = getMonitorsData();
    const count = Object.keys(data.monitors).length;
    let result;
    if (action === 'start') {
        if (count === 0) return { ok: false, error: 'No monitors to start' };
        const j = await pm2Jlist();
        const exists = j.success && j.processes.some(p => p.name === NIKE_PROCESS_NAME);
        result = exists
            ? await runCommand('pm2', ['start', NIKE_PROCESS_NAME])
            : await runCommand('pm2', ['start', 'nike.js', '--name', NIKE_PROCESS_NAME]);
    } else {
        result = await runCommand('pm2', [action, NIKE_PROCESS_NAME]);
    }
    return { ok: result.success, error: result.stderr };
}

app.post('/api/monitors/:action', async (req, res) => {
    const { action } = req.params;
    if (!['start', 'stop', 'restart'].includes(action)) {
        return res.status(400).json({ error: 'Invalid action' });
    }
    try {
        const { ok, error } = await handleProcessAction(action);
        if (!ok) return res.status(500).json({ success: false, error: error || 'pm2 failed' });
        res.json({ success: true, message: `Nike monitor ${action}ed` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/monitors/:sku/:action', async (req, res) => {
    const { sku, action } = req.params;
    if (!['start', 'stop', 'restart'].includes(action)) {
        return res.status(400).json({ error: 'Invalid action' });
    }
    try {
        const data = getMonitorsData();
        if (!data.monitors[sku]) return res.status(404).json({ error: 'Monitor not found' });
        const { ok, error } = await handleProcessAction(action);
        if (!ok) return res.status(500).json({ success: false, error: error || 'pm2 failed' });
        res.json({ success: true, message: `Nike monitor ${action}ed` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Webhooks
app.get('/api/webhooks', (req, res) => {
    try {
        if (fs.existsSync(WEBHOOKS_JSON)) {
            res.json(JSON.parse(fs.readFileSync(WEBHOOKS_JSON, 'utf8')));
        } else {
            res.json({ default: '', error: '', rules: [] });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/webhooks', (req, res) => {
    try {
        fs.writeFileSync(WEBHOOKS_JSON, JSON.stringify(req.body, null, 2), 'utf8');
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DB view
app.get('/api/db/:sku', (req, res) => {
    const { sku } = req.params;
    try {
        const dbFile = path.join(DATA_DIR, 'db_NIKE.json');
        if (!fs.existsSync(dbFile)) return res.json({ products: [] });
        const data = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
        const product = data.products?.find(p => p.id === sku);
        res.json({ products: product ? [product] : [] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
