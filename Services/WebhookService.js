import axios from 'axios';
import { Logger } from '../Utils/Logger.js';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function _encodeSkuForUrl(sku) {
  return encodeURIComponent(String(sku || '').trim());
}

function _nikeAppLinkLine(sku) {
  const q = _encodeSkuForUrl(sku);
  return `[SNKRS](https://api.thedropview.eu/snkrs/?sku=${q}) | [NIKE APP](https://api.thedropview.eu/nike/?sku=${q})`;
}

function _nikeResaleLinksLine(sku) {
  const q = _encodeSkuForUrl(sku);
  return `[StockX](https://stockx.com/search?s=${q}) | [KLEKT](https://klekt.com/search?q=${q}) | [GOAT](https://www.goat.com/en-gb/search?query=${q}&pageNumber=1)`;
}
// Paths: from file location, or from cwd (PM2 often uses Shopify_Monitor as cwd)
const WEBHOOKS_PATHS = [
  path.join(__dirname, '../../Data', 'webhooks.json'),
  path.join(process.cwd(), 'Data', 'webhooks.json'),
];

function _resolveWebhooksPath() {
  for (const p of WEBHOOKS_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return WEBHOOKS_PATHS[0]; // default for error messages
}

/**
 * Webhook Service Class
 * Handles sending Discord webhooks
 */
class Webhook {
  constructor() {
    this.logger = new Logger('WEBHOOK');
  }

  _getWebhookConfig() {
    const filePath = _resolveWebhooksPath();
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        return {
          default: data.default || '',
          error: data.error || '',
          rules: Array.isArray(data.rules) ? data.rules : [],
        };
      }
    } catch (e) {
      this.logger.logMessage(`webhooks.json read error: ${e.message}`, null, chalk.red);
    }
    return { default: '', error: '', rules: [] };
  }

  _determineWebhookUrl(product, webhookTarget = null) {
    const config = this._getWebhookConfig();

    // If monitor has explicit webhook target, use that rule directly
    if (webhookTarget && config && Array.isArray(config.rules)) {
      const target = String(webhookTarget).trim().toUpperCase();
      const rule = config.rules.find(r => r?.region && String(r.region).toUpperCase() === target);
      if (rule?.url) return rule.url.trim();
    }
    
    // Check rules (match by product marketplace)
    if (config && Array.isArray(config.rules)) {
      const title = (product.title || '').toLowerCase();
      const tags = Array.isArray(product.tags) ? product.tags.map(t => t.toLowerCase()) : [];
      const region = (product.marketplace || '').toUpperCase();

      for (const rule of config.rules) {
        if (rule.region && rule.region.toUpperCase() !== region) continue;

        if (rule.match_kw && Array.isArray(rule.match_kw) && rule.match_kw.length > 0) {
          const match = rule.match_kw.some(kw => {
            const k = kw.toLowerCase().trim();
            if (!k) return false;
            const tagMatch = tags.some(t => t === k);
            if (tagMatch) return true;
            return title.includes(k);
          });
          if (match && rule.url) return rule.url;
        } else if (rule.url) {
          return rule.url;
        }
      }
    }

    if (config && typeof config.default === 'string' && config.default.trim()) {
      return config.default.trim();
    }

    return null;
  }

  /**
   * Sleep helper function
   * @param {number} ms - Milliseconds to sleep
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Send webhook with retry on 429 error
   * Retries indefinitely with 5 second wait when hitting 429
   * @param {object} payload - Payload to send
   * @returns {Promise<boolean>} - Returns true when successful
   */
  async _sendWithRetry(payload) {
    const maxRetries = 1000; // Very high number to effectively retry indefinitely
    const waitTimeOn429 = 5000; // 5 seconds wait on 429

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await axios.post(this.webhookUrl, payload);
        if (response.status === 200 || response.status === 204) {
          this.logger.logMessage('Webhook sent successfully!', response.status, chalk.yellow);
          return true;
        }
      } catch (error) {
        const statusCode = error.response?.status;

        if (statusCode === 429) {
          // Rate limited - wait 5 seconds and retry
          this.logger.logMessage(`Rate limit (429) hit, waiting ${waitTimeOn429 / 1000}s before retry (attempt ${attempt + 1})...`, null, chalk.yellow);
          await this._sleep(waitTimeOn429);
          continue; // Retry with same webhook
        } else {
          // Other error - log and retry after short delay
          this.logger.logMessage(`Error sending webhook (${statusCode || 'unknown'}): ${error.message}, retrying...`, null, chalk.yellow);
          await this._sleep(1000);
          continue;
        }
      }
    }

    // Should never reach here, but just in case
    this.logger.logMessage('Max retries reached, webhook failed', null, chalk.red);
    return false;
  }

  /**
   * Send standard webhook notification
   * @param {string} target - Target name (e.g., "SEPHORA")
   * @param {Product} product - Product object
   */
  async sendWebhook(target, product, webhookTarget = null) {
    const url = this._determineWebhookUrl(product, webhookTarget);
    
    if (!url) {
      this.logger.logMessage(`No webhook URL found for ${target} (check webhooks.json)`, null, chalk.red);
      return;
    }
    
    this.webhookUrl = url;

    const skuVal = product.prod_id || product.id || 'N/A';
    const fields = [
      { name: 'SKU', value: skuVal, inline: true },
      { name: 'Status', value: product.merchStatus != null ? String(product.merchStatus) : 'N/A', inline: true },
      { name: 'Price', value: product.price || 'N/A', inline: true },
    ];

    if (product.stock) {
      fields.push({ name: 'Quantity', value: String(product.stock), inline: true });
    }

    // Nike: Sizes with stock level (e.g. 44 / [LOW], 42 / [HIGH])
    const availableVariants = product.variants && Array.isArray(product.variants)
      ? product.variants.filter(v => v.available)
      : product.sizeLevels || [];

    if (availableVariants.length > 0) {
      const sizeLines = availableVariants.map(v => {
        const size = v.size || v.id || v;
        const level = (v.level || 'INSTOCK').toUpperCase();
        return `${size} / [${level}]`;
      });
      const chunkSize = 6;
      const chunks = [];
      for (let i = 0; i < sizeLines.length; i += chunkSize) {
        chunks.push(sizeLines.slice(i, i + chunkSize).join('\n'));
      }
      fields.push({ name: '**Sizes**', value: chunks[0] || '\u200b', inline: true });
      if (chunks[1]) fields.push({ name: '\u200b', value: chunks[1], inline: true });
      if (chunks[2]) fields.push({ name: '\u200b', value: chunks[2], inline: true });
    }

    fields.push(
      {
        name: 'APP LINK',
        value: product.appLink || _nikeAppLinkLine(skuVal),
        inline: false
      },
      {
        name: 'LINKS',
        value: product.links || _nikeResaleLinksLine(skuVal),
        inline: false
      }
    );

    const customTime = new Date();
    const isoTimestamp = customTime.toISOString();

    // Handle None title
    const title = product.title ? product.title.trim().replace(/\n/g, '') : 'Product';

    const embed = {
      title: title,
      url: product.url,
      color: 9027071,
      fields: fields,
      timestamp: isoTimestamp,
      footer: {
        text: `${target.charAt(0).toUpperCase() + target.slice(1).toLowerCase()} - The Drop View`,
        icon_url: 'https://api.thedropview.eu/tdv.png'
      }
    };

    const imgUrl = product.thumbnail || product.image;
    if (imgUrl) {
      embed.thumbnail = { url: imgUrl };
    }

    const payload = { embeds: [embed] };

    await this._sendWithRetry(payload);
  }



  /**
   * Send error webhook notification
   * @param {string} target - Target name
   * @param {string} errorMessage - Error message details
   */
  async sendErrorWebhook(target, errorMessage) {
    const config = this._getWebhookConfig();
    const errorUrl = config && typeof config.error === 'string' && config.error.trim() ? config.error.trim() : null;
    if (!errorUrl) {
      this.logger.logMessage('No error webhook URL configured (set in webhooks.json)', null, chalk.red);
      return;
    }

    const fields = [
      { name: 'Target', value: target, inline: true },
      { name: 'Error Details', value: `\`\`\`${errorMessage.substring(0, 1000)}\`\`\``, inline: false }
    ];

    const embed = {
      title: '⚠️ REQUEST FAILED',
      color: 16711680, // Red color
      fields: fields,
      footer: { text: `${target} SCRAPER BY TDV - YE` }
    };

    const payload = { embeds: [embed] };

    try {
      const response = await axios.post(errorUrl, payload);
      this.logger.logMessage('Error webhook sent successfully!', 200, chalk.yellow);
    } catch (error) {
      this.logger.logMessage(`Error sending error webhook: ${error.message}`, null, chalk.red);
    }
  }
}

export { Webhook };
