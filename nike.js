/* Nike Monitor - Single process for all SKUs */
import { Webhook } from './Services/WebhookService.js';
import { Logger } from './Utils/Logger.js';
import database from './Utils/Database.js';
import { sleep } from './Utils/MonitorUtils.js';
import { simpleRequest } from './Utils/GotClient.js';
import { Proxy } from './Services/ProxyService.js';
import { getProductImageUrl, parseSizesAndLevels } from './Helper/NikeHelper.js';
import chalk from 'chalk';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.stdout.write('[Nike] Process starting...\n');

class NikeMonitor {
    constructor(sku, marketplace, language, channelId, proxyPool = 'big_pool', delay = 0, webhookTarget = null) {
        this.sku = sku;
        this.marketplace = marketplace;
        this.language = language;
        this.channelId = channelId;
        this.proxyPool = proxyPool;
        this.delay = delay;
        this.webhookTarget = webhookTarget && String(webhookTarget).trim() ? String(webhookTarget).trim() : null;
        this.target = 'NIKE';

        this.proxyManager = proxyPool === 'proxyless' ? null : new Proxy(proxyPool);

        this.url = `https://api.nike.com/product_feed/threads/v2?filter=exclusiveAccess(true,false)&filter=channelId(${this.channelId})&filter=marketplace(${this.marketplace})&filter=language(${this.language})&filter=publishedContent.properties.products.styleColor(${this.sku})`;

        this.logger = new Logger(`${this.target}_${this.sku}`);
        this.db = database;
        this.webhook = new Webhook();
        this.error_timeout = 10;
        this.success_delay = 300;
    }

    async init() {
        if (this.proxyManager) {
            await this.proxyManager.init();
            this.proxyManager.setRandomProxy();
        }
    }

    async fetchProductInfo() {
        this.logger.logMessage('EXTRACTING DATA', null, chalk.yellow);
        try {
            const proxyUrl = this.proxyManager ? this.proxyManager.getRandomProxy() : null;
            const response = await simpleRequest(this.url, proxyUrl);

            if (response.status === 403 || response.status === 429) {
                this.logger.logMessage(`Rotating proxy due to status ${response.status}...`, null, chalk.yellow);
                if (this.proxyManager) await this.proxyManager.setRandomProxy();
                return { status: 'error', statusCode: response.status };
            }

            if (response.status === 200) {
                this.logger.logMessage('Response status: 200', null, chalk.green);
                const data = JSON.parse(response.body);
                if (!data.objects || data.objects.length === 0) {
                    return { status: 'OOS', message: 'Product not found' };
                }

                const productInfo = data.objects[0].productInfo?.[0];
                if (!productInfo) {
                    return { status: 'OOS', message: 'Product info not found' };
                }

                const merchProduct = productInfo.merchProduct;
                const merchPrice = productInfo.merchPrice;
                const productContent = productInfo.productContent;
                const imageUrls = productInfo.imageUrls;
                const availability = productInfo.availability;

                const isAvailable = availability?.available === true;
                const rootObj = data.objects?.[0];
                const imageUrl = getProductImageUrl(productContent, productInfo, rootObj, data);
                const { inStockSizes, sizeLevelMap } = parseSizesAndLevels(productInfo.skus, productInfo.availableSkus);

                return {
                    status: isAvailable && inStockSizes.length > 0 ? 'INSTOCK' : 'OOS',
                    id: merchProduct.id,
                    productId: merchProduct.id,
                    merchStatus: merchProduct.status,
                    title: productContent.fullTitle || productContent.title,
                    price: merchPrice.currentPrice,
                    image: imageUrl,
                    url: `https://www.nike.com/${this.language}/t/${productContent.slug}/${this.sku}`,
                    available: isAvailable && inStockSizes.length > 0,
                    sizes: inStockSizes,
                    sizeLevels: sizeLevelMap
                };
            } else {
                return { status: 'error', statusCode: response.status };
            }
        } catch (error) {
            this.logger.logMessage(`ERROR WHILE EXTRACTING DATA: ${error.message}`, null, chalk.red);
            return { status: 'error', message: error.message };
        }
    }

    /**
     * Single check cycle for this SKU (used by multi-SKU runner)
     */
    async checkOnce() {
        try {
            const currentProductInfo = await this.fetchProductInfo();

            if (currentProductInfo?.status === 'error' || !currentProductInfo) {
                return;
            }

            if (currentProductInfo.status === 'OOS') {
                await this.db.updateProduct({
                    url: `https://www.nike.com/${this.language}/t/-/${this.sku}`,
                    id: String(this.sku),
                    site: this.target,
                    available: false
                });
                return;
            }

            if (currentProductInfo.available) {
                const previousState = await this.db.getProduct(String(this.sku), this.target);
                const wasOOS = !previousState || previousState.available === false;

                await this.db.updateProduct({
                    url: currentProductInfo.url,
                    image: currentProductInfo.image,
                    id: String(this.sku),
                    site: this.target,
                    title: currentProductInfo.title,
                    available: true,
                    price: currentProductInfo.price,
                    sizes: currentProductInfo.sizes,
                    sizeLevels: currentProductInfo.sizeLevels || currentProductInfo.sizes.map(s => ({ size: s, level: 'INSTOCK' }))
                });

                if (wasOOS) {
                    this.logger.logMessage('PRODUCT INSTOCK!', null, chalk.green);
                    const sizeLevels = currentProductInfo.sizeLevels || currentProductInfo.sizes.map(s => ({ size: s, level: 'INSTOCK' }));
                    const productForWebhook = {
                        id: this.sku,
                        url: currentProductInfo.url,
                        thumbnail: currentProductInfo.image,
                        title: currentProductInfo.title,
                        price: String(currentProductInfo.price),
                        merchStatus: currentProductInfo.merchStatus,
                        variants: sizeLevels.map(v => ({ size: v.size, level: v.level || 'INSTOCK', available: true })),
                        sizeLevels,
                        marketplace: this.marketplace
                    };
                    await this.webhook.sendWebhook(this.target, productForWebhook, this.webhookTarget);
                    await sleep(this.success_delay * 1000);
                }
            }
        } catch (error) {
            this.logger.logMessage(`ERROR: ${error.message}`, null, chalk.red);
        }
    }
}

const MONITORS_PATH = path.join(__dirname, 'Data', 'monitors.json');

function loadMonitors() {
    try {
        const raw = fs.readFileSync(MONITORS_PATH, 'utf8');
        const data = JSON.parse(raw);
        return data.monitors || {};
    } catch (e) {
        return {};
    }
}


/**
 * One SKU = one long-running task (same idea as cardgameclub initMonitor).
 */
function initNikeSkuTask(m, proxyManagers, index) {
    const monitor = new NikeMonitor(
        m.sku,
        m.marketplace || 'IT',
        m.language || 'it',
        m.channelId || 'd9a5bc42-4b9c-4976-858a-f159cf99c647',
        m.proxyPool || 'big_pool',
        m.delay || 0,
        m.webhook || null
    );
    if (monitor.proxyManager && proxyManagers.has(m.proxyPool)) {
        monitor.proxyManager = proxyManagers.get(m.proxyPool);
    }

    return (async () => {

        while (true) {
            await monitor.checkOnce();
        }
    })();
}

async function runAllMonitors() {
    console.log(chalk.cyan('[Nike] Starting...'));
    const monitorsData = loadMonitors();
    const list = Object.values(monitorsData).filter(m => m?.sku);
    if (list.length === 0) {
        console.log(chalk.yellow('[Nike] No monitors configured. Add SKUs via dashboard.'));
        process.exit(0);
    }
    console.log(chalk.cyan(`[Nike] Loaded ${list.length} monitor(s)`));

    const proxyPools = [...new Set(list.map(m => m.proxyPool).filter(Boolean))];
    const proxyManagers = new Map();
    for (const pool of proxyPools) {
        if (pool !== 'proxyless') {
            try {
                console.log(chalk.cyan(`[Nike] Init proxy pool: ${pool}`));
                const p = new Proxy(pool);
                await p.init();
                p.setRandomProxy();
                proxyManagers.set(pool, p);
                console.log(chalk.green(`[Nike] Proxy ${pool} ready`));
            } catch (e) {
                console.error(chalk.red(`[Nike] Proxy init failed for ${pool}:`), e.message);
            }
        }
    }

    console.log(chalk.green(`Monitoring ${list.length} SKU(s) in parallel`));

    const tasks = list.map((m, i) => initNikeSkuTask(m, proxyManagers, i));
    await Promise.allSettled(tasks);
    await new Promise(() => { });
}

async function main() {
    await runAllMonitors();
}

// Always run main (PM2 uses a wrapper script, so process.argv[1] check fails)
main().catch((error) => {
    console.error(chalk.red('[Nike] Fatal error:'), error?.message || error);
    process.exit(1);
});

export { NikeMonitor, runAllMonitors, initNikeSkuTask };
