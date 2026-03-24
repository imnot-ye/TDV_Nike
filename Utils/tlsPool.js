import { load, DataType, open } from 'ffi-rs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// Get the directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the base path to the assets folder relative to the current directory
const assetsPath = path.join(__dirname, '../assets');

// load the tls-client shared package for your OS
const LIBRARY_NAME = 'tls-client';
let libraryFileName = '';
const platform = os.platform();
const arch = os.arch();

if (platform === 'win32') {
  libraryFileName = arch === 'x64' ? 'tls.dll' : 'tls.dll';
} else if (platform === 'darwin') {
  libraryFileName = arch === 'arm64' ? 'tls.dylib' : 'tls.dylib';
} else if (platform === 'linux') {
  if (arch === 'arm64') {
    libraryFileName = 'tls.so';
  } else if (arch === 'arm') {
    libraryFileName = 'tls.so';
  } else {
    libraryFileName = 'tls.so'; // Default to ubuntu amd64
  }
}

if (!libraryFileName) {
  throw new Error(`Unsupported platform or architecture: ${platform}-${arch}`);
}

const fullLibraryPath = path.join(assetsPath, libraryFileName);

try {
  open({
    library: LIBRARY_NAME,
    path: fullLibraryPath
  });
} catch (e) {
  throw e;
}

/**
 * Make a TLS request
 * @param {Object} requestData - Request configuration
 * @returns {Promise<Object>} - Response object
 */
async function request(requestData) {
  // Map our API to the expected TLS client structure
  const tlsClientRequest = {
    // Required parameters
    tlsClientIdentifier: requestData.tlsClientIdentifier || 'chrome_133',
    followRedirects: requestData.followRedirects !== undefined ? requestData.followRedirects : true,
    insecureSkipVerify: requestData.insecureSkipVerify !== undefined ? requestData.insecureSkipVerify : false,
    withoutCookieJar: false,
    withDefaultCookieJar: false,
    isByteRequest: requestData.isByteRequest || false,
    forceHttp1: false,
    withRandomTLSExtensionOrder: false,
    timeoutSeconds: requestData.timeoutSeconds || 30,
    timeoutMilliseconds: 0,

    // Important: these are the field names the library expects
    requestUrl: requestData.url,
    requestMethod: requestData.method || 'GET',
    requestBody: requestData.requestBody || '',

    // Session management
    sessionId: requestData.sessionId || `session_${Date.now()}_${Math.random()}`,

    // Proxy settings
    proxyUrl: requestData.proxy || '',
    isRotatingProxy: false,

    // Headers
    headers: requestData.headers || {
      accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36'
    },

    // Optional parameters
    certificatePinningHosts: {},
    requestCookies: requestData.cookies || []
  };

  const responseJson = await load({
    library: LIBRARY_NAME,
    funcName: 'request',
    retType: DataType.String,
    paramsType: [DataType.String],
    paramsValue: [JSON.stringify(tlsClientRequest)],
    runInNewThread: true // Important for async Node.js
  });

  try {
    const response = JSON.parse(responseJson);

    // Add the sessionId to the response so we can reuse it
    response.sessionId = tlsClientRequest.sessionId;

    // Log when status is 0 for debugging
    if (!response.status || response.status === 0) {
      console.error('[TLS Client] Status 0 detected');
      console.error('[TLS Client] Request URL:', tlsClientRequest.requestUrl);
      console.error('[TLS Client] Request Method:', tlsClientRequest.requestMethod);
      console.error('[TLS Client] Proxy:', tlsClientRequest.proxyUrl || 'none');
      console.error('[TLS Client] Response:', JSON.stringify(response).substring(0, 500));
    }

    return response;
  } catch (e) {
    throw new Error('Failed to parse response from TLS client');
  }
}

/**
 * Free memory by ID
 * @param {string} id - Memory ID
 */
function freeMemory(id) {
  load({
    library: LIBRARY_NAME,
    funcName: 'freeMemory',
    retType: DataType.Void,
    paramsType: [DataType.String],
    paramsValue: [id],
    runInNewThread: true
  });
}

/**
 * Get cookies from session
 * @param {Object} requestData - Request data with sessionId
 * @returns {Promise<Object>} - Cookies object
 */
async function getCookiesFromSession(requestData) {
  const result = await load({
    library: LIBRARY_NAME,
    funcName: 'getCookiesFromSession',
    retType: DataType.String,
    paramsType: [DataType.String],
    paramsValue: [JSON.stringify(requestData)],
    runInNewThread: true
  });
  return JSON.parse(result);
}

/**
 * Add cookies to session
 * @param {Object} cookieData - Cookie data
 * @returns {Promise<Object>} - Result
 */
async function addCookiesToSession(cookieData) {
  try {
    const result = await load({
      library: LIBRARY_NAME,
      funcName: 'addCookiesToSession',
      retType: DataType.String,
      paramsType: [DataType.String],
      paramsValue: [JSON.stringify(cookieData)],
      runInNewThread: true
    });

    return JSON.parse(result);
  } catch (error) {
    throw error;
  }
}

/**
 * Destroy session by ID, cleaning native resources
 * @param {string} sessionId - Session ID to destroy
 */
async function destroySession(sessionId) {
  if (!sessionId) {
    return;
  }

  try {
    await load({
      library: LIBRARY_NAME,
      funcName: 'destroySession',
      retType: DataType.Void,
      paramsType: [DataType.String],
      paramsValue: [JSON.stringify({ sessionId })],
      runInNewThread: true
    });
  } catch (e) {
    // Don't rethrow - we want to continue even if session destruction fails
  }
}

export { request, freeMemory, getCookiesFromSession, addCookiesToSession, destroySession };

