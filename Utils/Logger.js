import chalk from 'chalk';

/**
 * Logger Class
 * Handles logging with timestamps and colors
 */
class Logger {
  constructor(target, productId = null) {
    this.target = target;
    this.productId = productId;
  }

  /**
   * Set or update the product ID dynamically
   * @param {string} productId - Product ID to set
   */
  setProductId(productId) {
    this.productId = productId;
  }

  /**
   * Get current timestamp formatted
   * @returns {string} Formatted timestamp
   */
  getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  /**
   * Log a message with timestamp, target, and optional status code
   * @param {string} message - Message to log
   * @param {number|null} statusCode - HTTP status code (optional)
   * @param {Function} color - Chalk color function (default: white)
   */
  logMessage(message, statusCode = null, color = chalk.white) {
    const timestamp = this.getTimestamp();
    const statusInfo = statusCode !== null ? `[${statusCode}]` : '';
    const productInfo = this.productId !== null ? `[${this.productId}]` : '';

    const logOutput = color(
      `[${timestamp}][${this.target.toUpperCase()}]${productInfo}${statusInfo} - ${message}`
    );
    console.log(logOutput);
  }

  /**
   * Log success message in green
   * @param {string} message - Success message
   * @param {number|null} statusCode - HTTP status code
   */
  success(message, statusCode = null) {
    this.logMessage(message, statusCode, chalk.green);
  }

  /**
   * Log error message in red
   * @param {string} message - Error message
   * @param {number|null} statusCode - HTTP status code
   */
  error(message, statusCode = null) {
    this.logMessage(message, statusCode, chalk.red);
  }

  /**
   * Log warning message in yellow
   * @param {string} message - Warning message
   * @param {number|null} statusCode - HTTP status code
   */
  warn(message, statusCode = null) {
    this.logMessage(message, statusCode, chalk.yellow);
  }

  /**
   * Log info message in cyan
   * @param {string} message - Info message
   * @param {number|null} statusCode - HTTP status code
   */
  info(message, statusCode = null) {
    this.logMessage(message, statusCode, chalk.cyan);
  }

  /**
   * Log debug message in magenta
   * @param {string} message - Debug message
   */
  debug(message) {
    this.logMessage(message, null, chalk.magenta);
  }
}

export { Logger };

