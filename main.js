const { app, BrowserWindow, session, ipcMain } = require('electron')
const path = require('path')
const crypto = require('crypto')
require('dotenv').config({ path: path.join(__dirname, '.env') })

// MFS credentials, loaded from .env (see .env.example). These are secrets —
// fine for a local dev tool, but never ship them in a distributed/packaged
// build. Each environment (production / sandbox) has its own API host *and*
// its own OAuth client id/secret; the renderer's environment switcher decides
// which set a given Run uses.
const env = process.env
const MFS_ENVIRONMENTS = {
  production: {
    apiUrl: 'https://api.meshpay.com',
    linkEnv: 'prod',
    clientId: env.MFS_CLIENT_ID,
    clientSecret: env.MFS_CLIENT_SECRET
  },
  sandbox: {
    apiUrl: 'https://api.sbx.meshpay.com',
    linkEnv: 'sbx',
    clientId: env.MFS_SANDBOX_CLIENT_ID,
    clientSecret: env.MFS_SANDBOX_CLIENT_SECRET
  }
}

// Scopes needed to create a session via the S2S token (see
// POST /oauth2/token below). `sessions:edit` is what actually matters here;
// the rest mirror what a real merchant backend requests for the flows Link
// can trigger once the session is exchanged.
const SESSION_SCOPES = ['sessions:edit', 'sessions:read', 'connections:edit', 'transfers:read']

// Default destination used when the renderer doesn't supply its own. The
// Destinations editor in the renderer can override `toAddresses` per Run.
const DEFAULT_TO_ADDRESSES = [
  {
    networkCaip2: 'eip155:8453',
    symbol: 'USDC',
    address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
  }
]

// Mint an S2S access token via OAuth2 client_credentials (Hydra-fronted
// /oauth2/token requires HTTP Basic — credentials in the body are rejected).
async function fetchAccessToken(apiUrl, clientId, clientSecret) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(`${apiUrl}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: SESSION_SCOPES.join(' ')
    })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Token mint failed (${res.status}): ${data.error_description || data.message || JSON.stringify(data)}`
    )
  }
  return data.access_token
}

// Build the session request body. `toAddresses` (token/network/address rows)
// comes from the renderer's Destinations editor; falls back to the default.
function buildSessionBody(toAddresses) {
  const addresses =
    Array.isArray(toAddresses) && toAddresses.length > 0
      ? toAddresses
      : DEFAULT_TO_ADDRESSES
  return {
    userId: 'e479',
    transferOptions: {
      type: 'TRANSFER_TYPE_DEPOSIT',
      toAddresses: addresses
    }
  }
}

// Create a fresh Link session (runs in the main process): mints an S2S token,
// then calls POST /v2/sessions for the one-time exchange code the SDK's
// `openLink` consumes directly. `overrides.toAddresses` lets the renderer
// drive the destination list; `overrides.environment` ('production' |
// 'sandbox') picks which creds/host to use.
ipcMain.handle('mfs:create-session', async (_event, overrides) => {
  const environment = overrides?.environment === 'production' ? 'production' : 'sandbox'
  const creds = MFS_ENVIRONMENTS[environment]
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error(
      `Missing ${environment} MFS credentials in .env (see .env.example)`
    )
  }

  const accessToken = await fetchAccessToken(creds.apiUrl, creds.clientId, creds.clientSecret)

  const res = await fetch(`${creds.apiUrl}/v2/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Idempotency-Key': crypto.randomUUID(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildSessionBody(overrides && overrides.toAddresses))
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      `MFS API ${res.status}: ${data.message || JSON.stringify(data)}`
    )
  }
  if (!data.token) {
    throw new Error(`No token in response: ${JSON.stringify(data)}`)
  }

  // The session's exchange code is consumed directly by openLink() — unlike
  // legacy's linkToken, it is not a URL, so there is nothing to rewrite here.
  return { token: data.token, clientId: creds.clientId, linkEnv: creds.linkEnv }
})

// Only https pages on meshpay.com or its subdomains get their framing headers
// stripped. Matching the hostname, not the whole URL, keeps a look-alike such as
// https://meshpay.com.example.org or https://example.org/?meshpay.com out.
function isMeshpayUrl(url) {
  try {
    const { protocol, hostname } = new URL(url)
    return protocol === 'https:' && (hostname === 'meshpay.com' || hostname.endsWith('.meshpay.com'))
  } catch {
    return false
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 600,
    height: 950,
    backgroundColor: '#1a1b1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.loadFile('index.html')
  // win.webContents.openDevTools()
}

app.whenReady().then(() => {
  // Meshpay pages send X-Frame-Options / CSP frame-ancestors that would block
  // embedding. Strip those for meshpay.com domains so the SDK iframe renders
  // correctly.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!isMeshpayUrl(details.url)) return callback({ responseHeaders: details.responseHeaders })

    const headers = details.responseHeaders || {}
    for (const key of Object.keys(headers)) {
      const lk = key.toLowerCase()
      if (lk === 'x-frame-options') {
        delete headers[key]
      } else if (lk === 'content-security-policy') {
        headers[key] = headers[key].map((v) =>
          v.replace(/frame-ancestors[^;]*;?/gi, '')
        )
      }
    }
    callback({ responseHeaders: headers })
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
