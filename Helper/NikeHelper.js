/**
 * Nike API response parsing helpers
 * Never use secure-images.nike.com - only static.nike.com (squarishURL/portraitURL)
 */

/**
 * Deep recursive search for squarishURL or portraitURL (static.nike.com)
 * @param {object} obj - any object to search
 * @param {Set} seen - prevent circular refs
 * @returns {string|null}
 */
function findSquarishUrlDeep(obj, seen = new Set()) {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return null;
  if (obj.properties?.squarishURL) return obj.properties.squarishURL;
  if (obj.properties?.portraitURL) return obj.properties.portraitURL;
  seen.add(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findSquarishUrlDeep(item, seen);
      if (found) return found;
    }
  } else {
    for (const key of Object.keys(obj)) {
      const found = findSquarishUrlDeep(obj[key], seen);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Extract product image URL - ONLY static.nike.com, NEVER secure-images.nike.com
 * @param {object} productContent
 * @param {object} productInfo
 * @param {object} rootObj - data.objects[0]
 * @param {object} fullData - entire API response (optional)
 * @returns {string|null}
 */
export function getProductImageUrl(productContent, productInfo, rootObj, fullData) {
  const urls = [rootObj, productInfo, productContent, fullData].map((o) => findSquarishUrlDeep(o)).filter(Boolean);
  const url = urls.find((u) => u.includes('static.nike.com'));
  return url || null;
}

/**
 * Parse sizes and stock levels from Nike productInfo
 * @param {Array} skus - productInfo.skus
 * @param {Array} availableSkus - productInfo.availableSkus
 * @returns {{ inStockSizes: string[], sizeLevelMap: { size: string, level: string }[] }}
 */
export function parseSizesAndLevels(skus = [], availableSkus = []) {
  const sizeMap = {};
  skus.forEach((s) => {
    const size = s.countrySpecifications?.[0]?.localizedSize || s.nikeSize;
    sizeMap[s.id] = size;
  });

  const inStockSizes = [];
  const sizeLevelMap = [];
  availableSkus.forEach((s) => {
    if (s.available && s.level !== 'OOS') {
      const size = sizeMap[s.skuId] || s.skuId;
      inStockSizes.push(size);
      sizeLevelMap.push({ size, level: (s.level || 'INSTOCK').toUpperCase() });
    }
  });

  return { inStockSizes, sizeLevelMap };
}
