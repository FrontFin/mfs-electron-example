const { contextBridge, ipcRenderer } = require('electron')

// Expose a minimal API so the renderer can ask the main process to create a
// Link session. The MFS token-mint call (and the client secret) stays in the
// main process — out of the renderer and unaffected by the page CSP / CORS.
contextBridge.exposeInMainWorld('mfs', {
  // `overrides` may carry `{ toAddresses, environment }` from the renderer.
  // Resolves to `{ token, clientId, linkEnv }`.
  createSession: (overrides) =>
    ipcRenderer.invoke('mfs:create-session', overrides)
})
