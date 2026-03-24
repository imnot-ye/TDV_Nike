import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '../Data');

// Ensure Data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Cache for in-memory state per site
const dbCache = new Map();
const dbLocks = new Map();

class Mutex {
    constructor() {
        this.queue = [];
        this.locked = false;
    }
    async acquire() {
        if (this.locked) {
            return new Promise(resolve => this.queue.push(resolve));
        }
        this.locked = true;
    }
    release() {
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            next();
        } else {
            this.locked = false;
        }
    }
}

function getSiteMutex(siteName) {
    if (!dbLocks.has(siteName)) {
        dbLocks.set(siteName, new Mutex());
    }
    return dbLocks.get(siteName);
}

function getDbPath(siteName) {
    const normalizedSite = (siteName || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    return join(dataDir, `db_${normalizedSite.toLowerCase()}.json`);
}

function loadDb(siteName) {
    const path = getDbPath(siteName);
    try {
        if (fs.existsSync(path)) {
            const raw = fs.readFileSync(path, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error(`[Database] Read error for ${siteName}:`, e.message);
    }
    return { products: [], lastUpdated: null };
}

function saveDb(siteName, data) {
    const path = getDbPath(siteName);
    try {
        fs.writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error(`[Database] Write error for ${siteName}:`, e.message);
        throw e;
    }
}

const database = {
    updateProduct: async (product) => {
        const siteName = (product.site || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        const mutex = getSiteMutex(siteName);
        await mutex.acquire();
        try {
            const data = loadDb(siteName);
            data.products = data.products || [];
            const index = data.products.findIndex((p) => p.id === product.id);
            const productData = {
                ...product,
                lastUpdated: new Date().toISOString()
            };
            if (index !== -1) {
                data.products[index] = productData;
            } else {
                data.products.push(productData);
            }
            data.lastUpdated = new Date().toISOString();
            saveDb(siteName, data);
        } finally {
            mutex.release();
        }
    },

    getProduct: async (id, site) => {
        const siteName = (site || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        const mutex = getSiteMutex(siteName);
        await mutex.acquire();
        try {
            const data = loadDb(siteName);
            return data.products?.find((p) => p.id === id);
        } finally {
            mutex.release();
        }
    },

    getSiteProducts: async (site) => {
        const siteName = (site || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        const mutex = getSiteMutex(siteName);
        await mutex.acquire();
        try {
            const data = loadDb(siteName);
            return data.products || [];
        } finally {
            mutex.release();
        }
    },

    getAllSites: async () => {
        const sites = {};
        if (!fs.existsSync(dataDir)) return sites;
        const files = fs.readdirSync(dataDir);
        for (const file of files) {
            if (file.startsWith('db_') && file.endsWith('.json')) {
                const siteName = file.replace('db_', '').replace('.json', '').toUpperCase();
                const mutex = getSiteMutex(siteName);
                await mutex.acquire();
                try {
                    const data = loadDb(siteName);
                    sites[siteName] = {
                        products: data.products || [],
                        lastUpdated: data.lastUpdated
                    };
                } finally {
                    mutex.release();
                }
            }
        }
        return sites;
    }
};

export default database;
