import axios from 'axios';
import { Logger } from '../Utils/Logger.js';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { io } from 'socket.io-client';

/**
 * Proxy Service Class
 * Manages proxy pools from API or local file
 */
class Proxy {
  // API Configuration
  static API_BASE_URL = 'https://prx.thedropview.eu/api';
  static WS_URL = 'https://ws.thedropview.eu/proxy'; // WebSocket URL
  static API_KEY = 'sDjK89?_DskEv_.svj!?';

  constructor(poolIdentifier) {
    this.poolIdentifier = poolIdentifier;
    this.logger = new Logger('PROXY');
    this.proxylist = [];
    this.currentProxy = null;
    this.initialized = false;
    this.socket = null;
    this.useWs = false;
  }

  /**
   * Initialize proxy list (must be called before using proxies)
   */
  async init() {
    if (!this.initialized) {
      // Try initializing WebSocket first
      this._initWebSocket();
      
      // Load initial list as fallback/cache
      this.proxylist = await this._loadProxies();
      this.initialized = true;
    }
  }

  _initWebSocket() {
    try {
      const wsOpts = {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
        timeout: 8000,
        // When server is behind Nginx at /proxy, Socket.IO endpoint is /proxy/socket.io
        path: '/proxy/socket.io',
        // Use secure connection when URL is https
        secure: Proxy.WS_URL.startsWith('https'),
      };
      this.socket = io(Proxy.WS_URL, wsOpts);

      this.socket.on('connect', () => {
        this.logger.logMessage('WS CONNECTED', null, chalk.green);
        this.useWs = true;
      });

      this.socket.on('connect_error', (err) => {
        this.useWs = false;
        if (process.env.DEBUG_PROXY_WS) {
          this.logger.logMessage(`WS ERROR: ${err.message}`, null, chalk.yellow);
        }
      });

      this.socket.on('disconnect', (reason) => {
        this.useWs = false;
      });

    } catch (e) {
      this.logger.logMessage(`WS INIT FAILED: ${e.message}`, null, chalk.yellow);
      this.useWs = false;
    }
  }

  /**
   * Get a single proxy via WebSocket
   * @param {string} poolName 
   * @returns {Promise<string|null>}
   */
  _getProxyFromWs(poolName) {
    return new Promise((resolve) => {
      if (!this.socket || !this.socket.connected) {
        return resolve(null);
      }

      // Timeout to prevent hanging if WS doesn't respond
      const timeout = setTimeout(() => resolve(null), 2000);

      this.socket.emit('get_proxy', poolName, (response) => {
        clearTimeout(timeout);
        if (response && response.formatted) {
          resolve(response.formatted);
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Check if identifier is a local file path
   * @param {string} identifier
   * @returns {boolean}
   */
  _isLocalFile(identifier) {
    return identifier.endsWith('.txt') || identifier.includes('/') || identifier.includes('\\');
  }

  /**
   * Extract pool name from identifier
   * @param {string} identifier
   * @returns {string}
   */
  _extractPoolName(identifier) {
    if (this._isLocalFile(identifier)) {
      const filename = path.basename(identifier);
      return path.parse(filename).name;
    }
    return identifier;
  }

  /**
   * Get fallback file path
   * @param {string} identifier
   * @returns {string}
   */
  _getFallbackFilePath(identifier) {
    if (this._isLocalFile(identifier)) {
      return identifier;
    }
    return `./Data/${identifier}.txt`;
  }

  /**
   * Load proxies from API
   * @param {string} poolName
   * @returns {Promise<Array|null>}
   */
  async _loadFromApi(poolName) {
    try {
      this.logger.logMessage(`FETCHING POOL '${poolName}' FROM API...`, null, chalk.magenta);

      const response = await axios.get(`${Proxy.API_BASE_URL}/pools/${poolName}`, {
        headers: { 'x-api-key': Proxy.API_KEY },
        timeout: 10000
      });

      if (response.status === 200) {
        const proxies = this._parseProxyList(response.data.proxies);
        this.logger.logMessage(`LOADED ${proxies.length} PROXIES FROM API`, null, chalk.green);
        return proxies;
      }
    } catch (error) {
      if (error.response) {
        if (error.response.status === 401) {
          this.logger.logMessage('API AUTHENTICATION FAILED - CHECK API KEY', null, chalk.red);
        } else if (error.response.status === 404) {
          this.logger.logMessage(`POOL '${poolName}' NOT FOUND IN API`, null, chalk.yellow);
        } else {
          this.logger.logMessage(`API ERROR ${error.response.status}`, null, chalk.red);
        }
      } else {
        this.logger.logMessage(`API CONNECTION ERROR: ${error.message}`, null, chalk.yellow);
      }
    }
    return null;
  }

  /**
   * Load proxies from local file
   * @param {string} filePath
   * @returns {Promise<Array>}
   */
  async _loadFromFile(filePath) {
    const proxies = [];
    try {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const proxyLines = fileContent.split('\n').map(line => line.trim()).filter(line => line);
      const parsedProxies = this._parseProxyList(proxyLines);
      this.logger.logMessage(
        `LOADED ${parsedProxies.length} PROXIES FROM LOCAL FILE`,
        null,
        chalk.green
      );
      return parsedProxies;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger.logMessage(`FILE ${filePath} NOT FOUND`, null, chalk.red);
      } else {
        this.logger.logMessage(`FILE READ ERROR: ${error.message}`, null, chalk.red);
      }
    }
    return proxies;
  }

  /**
   * Parse proxy list from strings to formatted URLs
   * @param {Array<string>} proxyLines
   * @returns {Array<string>}
   */
  _parseProxyList(proxyLines) {
    const proxies = [];
    for (const line of proxyLines) {
      if (!line) continue;
      try {
        const parts = line.split(':');
        if (parts.length === 4) {
          const [ip, port, username, password] = parts;
          const proxyUrl = `http://${username}:${password}@${ip}:${port}`;
          proxies.push(proxyUrl);
        } else {
          this.logger.logMessage(`INVALID PROXY FORMAT: ${line}`, null, chalk.yellow);
        }
      } catch (error) {
        this.logger.logMessage(`INVALID PROXY FORMAT: ${line}`, null, chalk.yellow);
      }
    }
    return proxies;
  }

  /**
   * Load proxies - try API first, then fallback to file
   * @returns {Promise<Array>}
   */
  async _loadProxies() {
    const poolName = this._extractPoolName(this.poolIdentifier);

    // Always try API first
    let proxies = await this._loadFromApi(poolName);

    if (proxies && proxies.length > 0) {
      return proxies;
    }

    // Fallback to local file
    const fallbackFile = this._getFallbackFilePath(this.poolIdentifier);
    this.logger.logMessage(
      `API FAILED - FALLBACK TO LOCAL FILE: ${fallbackFile}`,
      null,
      chalk.yellow
    );
    return await this._loadFromFile(fallbackFile);
  }

  /**
   * Set a random proxy from the list
   */
  async setRandomProxy() {
    // 1. Try WebSocket first if connected
    if (this.useWs && this.socket && this.socket.connected) {
      const poolName = this._extractPoolName(this.poolIdentifier);
      const wsProxy = await this._getProxyFromWs(poolName);
      if (wsProxy) {
        this.currentProxy = wsProxy;
        // this.logger.logMessage(`WS PROXY: ${this.currentProxy}`, null, chalk.cyan);
        return;
      }
    }

    // 2. Fallback to local cache (API/File loaded at init)
    if (this.proxylist && this.proxylist.length > 0) {
      this.currentProxy = this.proxylist[Math.floor(Math.random() * this.proxylist.length)];
      // this.logger.logMessage(`CACHE PROXY: ${this.currentProxy}`, null, chalk.cyan);
    } else {
      this.currentProxy = null;
      this.logger.logMessage('No proxy available', null, chalk.cyan);
    }
  }

  /**
   * Get current proxy URL (alias for .proxy, used by Nike monitor)
   * @returns {string|null}
   */
  getRandomProxy() {
    return this.currentProxy;
  }

  /**
   * Get current proxy URL
   * @returns {string|null}
   */
  get proxy() {
    return this.currentProxy;
  }

  /**
   * Get proxy details as object (useful for CF-Solver)
   * @returns {Object|null}
   */
  get proxyDetails() {
    if (!this.currentProxy) return null;
    try {
      const proxyUrl = this.currentProxy.replace('http://', '').replace('https://', '');
      const [credentials, hostPort] = proxyUrl.split('@');
      const [username, password] = credentials.split(':');
      const [host, port] = hostPort.split(':');
      return {
        host,
        port: parseInt(port),
        username,
        password
      };
    } catch (error) {
      this.logger.logMessage(`ERROR ON PROXY PARSING: ${error.message}`, null, chalk.red);
      return null;
    }
  }

  /**
   * Get proxy in JSON format (useful for Playwright)
   * @returns {Object|null}
   */
  getJsonProxy() {
    if (!this.currentProxy) return null;
    try {
      const proxyUrl = this.currentProxy.replace('http://', '').replace('https://', '');
      const [credentials, hostPort] = proxyUrl.split('@');
      const [username, password] = credentials.split(':');
      const [host, port] = hostPort.split(':');
      return {
        server: `${host}:${port}`,
        username,
        password
      };
    } catch (error) {
      this.logger.logMessage(`ERROR ON PROXY PARSING: ${error.message}`, null, chalk.red);
      return null;
    }
  }
}

export { Proxy };

