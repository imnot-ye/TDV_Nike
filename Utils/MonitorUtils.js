/**
 * Common utility functions for monitors
 */

/**
 * Sleep for a specified duration
 * @param {number} ms - Time to sleep in milliseconds
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Get current timestamp formatted
 * @returns {string} Formatted timestamp
 */
export const timestamp = () => new Date().toISOString();

/**
 * Build region links object from product URL (replaces locale segment)
 * @param {string} url - Product URL (e.g. .../it-it/p/... or .../it-it/product/...)
 * @returns {Object|null} { IT, ES, FR, DE, EN } or null
 */
export function buildRegionLinks(url) {
    if (!url) return null;
    const localePattern = /\/[a-z]{2}-[a-z]{2}(\/|$)/;
    return {
        IT: url.replace(localePattern, '/it-it$1'),
        ES: url.replace(localePattern, '/es-es$1'),
        FR: url.replace(localePattern, '/fr-fr$1'),
        DE: url.replace(localePattern, '/de-de$1'),
        EN: url.replace(localePattern, '/en-en$1')
    };
}
