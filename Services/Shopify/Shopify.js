import { SEARCH_KEYWORD, EXCLUDED_KEYWORDS } from '../../Utils/keywords.js';

/**
 * Pulisce il testo mantenendo i trattini uniti alle parole.
 * Esempio: "Son Goku FB07-104" resta ['son', 'goku', 'fb07-104']
 * In questo modo 'fb07' NON farà match con 'fb07-104'
 */
function getCleanWords(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    // Aggiunto \- per dire "non sostituire il trattino con spazio"
    .replace(/[^a-z0-9\-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0);
}

/**
 * Controlla se la frase della keyword (es: "one piece") è presente
 * nel titolo ESATTAMENTE in quell'ordine e sequenza.
 */
function titleHasExactPhrase(titleWords, keywordWords) {
  if (keywordWords.length === 0) return false;
  if (keywordWords.length > titleWords.length) return false;

  // Scorre il titolo parola per parola
  for (let i = 0; i <= titleWords.length - keywordWords.length; i++) {
    let match = true;
    // Controlla se le parole successive coincidono con la keyword
    for (let j = 0; j < keywordWords.length; j++) {
      if (titleWords[i + j] !== keywordWords[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

export class NewShopifyService {
  /**
   * Filter products based on keywords.
   * A keyword matches only if it appears as exact consecutive words in the title (split by space).
   * E.g. "last penguin" → ping only if title has words ["last", "penguin"]; "st" → ping only if title has word "st".
   * @param {Array} products - List of products
   * @returns {Array} - Filtered products
   */
  filterProducts(products) {
    if (!products || !Array.isArray(products)) return [];

    return products.filter(product => {
      const title = product.title;
      const titleLower = title.toLowerCase();
      const titleWords = getCleanWords(title);

      // Check Excluded Keywords first (substring match)
      const hasExcluded = EXCLUDED_KEYWORDS.some(kw => {
        const kwClean = kw.toLowerCase();
        if (kwClean.includes(' ')) {
          return titleLower.includes(kwClean);
        }
        return titleWords.includes(kwClean);
      });

      if (hasExcluded) {
        return false;
      }

      // Check Search Keywords (Sequenza Esatta)
      const hasKeyword = SEARCH_KEYWORD.some(kw => {
        const keywordWords = getCleanWords(kw);
        return titleHasExactPhrase(titleWords, keywordWords);
      });

      // NUOVO CHECK: Regex per Numerazione Set (es. 105/208, 9/304)
      const collectionNumberRegex = /\d+\/\d+/;
      const hasCollectionNumber = collectionNumberRegex.test(title);

      // Filtro prezzo: scarta se sotto 10
      const priceStr = product?.variants?.[0]?.price ?? product?.price ?? '0';
      const price = parseFloat(String(priceStr).replace(',', '.')) || 0;
      const priceOk = price >= 10;

      const isValid =
        !hasCollectionNumber &&
        hasKeyword &&
        !title.startsWith('PSA') &&
        priceOk;

      return isValid;
    });
  }

  /**
   * Normalize product data for DB and Webhook
   * @param {object} product - Raw Shopify product
   * @param {string} siteName - Site name for identification
   * @param {string} baseUrl - Base URL for links
   */
  normalizeProduct(product, siteName, baseUrl) {
    // Check if any variant is available
    let isAvailable = false;
    let price = 'N/A';
    const variants = [];

    if (product.variants && product.variants.length > 0) {
      isAvailable = product.variants.some(v => v.available);
      price = product.variants[0].price; // Use first variant price

      product.variants.forEach(v => {
        variants.push({
          id: String(v.id),
          size: v.title,
          price: v.price,
          available: v.available,
          stock: v.inventory_quantity // Some sites hide this, but if present
        });
      });
    }

    const image = product.images && product.images.length > 0 ? product.images[0].src : null;
    const handle = product.handle;
    const url = `${baseUrl.replace(/\/$/, '')}/products/${handle}`;

    return {
      id: String(product.id),
      site: siteName,
      title: product.title,
      price: price,
      available: isAvailable,
      url: url,
      thumbnail: image,
      variants: variants,
      handle: handle
    };
  }
}
