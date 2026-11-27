# CLAUDE.md

## What this is

A minimal Electron app that embeds the **MFS Link Web SDK**
(`@meshpayhq/link-web-sdk`) in an iframe to exercise the Meshpay Link flow.
It's a dev/testing harness, not a shippable product. Sibling of
`mesh-electron-example`, which does the same thing for legacy Mesh
(`@meshconnect/web-link-sdk`).

## Dependency chain

- **`@meshpayhq/link-web-sdk`** → published npm package, pinned exact
  (`0.0.12` in `package.json` — pre-1.0, so a caret range buys nothing).
- `openLink(token, clientId, options)` loads Link from a fixed per-environment
  URL (`LINK_URLS` in the SDK's `types.ts`): `https://link.meshpay.com` (prod)
  or `https://link.sbx.meshpay.com` (sandbox). There is no local front-catalog
  equivalent to run here — the SDK does not support a free-text host override
  the way legacy's linkToken rewriting did.

## Run

```bash
npm install
npm start    # esbuild bundles src/renderer.js → dist/renderer.js, then launches Electron
```

There is no separate watch task — `npm start`/`npm run dev` rebuild on each launch.

## Architecture

| File | Process | Responsibility |
|------|---------|----------------|
| `main.js` | main | Window creation (sandboxed renderer); security guards: the top-level page can only be the bundled `index.html` (`will-navigate`), web content cannot open app windows (`setWindowOpenHandler` denies, https goes to the default browser), every permission is denied except Link's delegated clipboard on `meshpay.com`, and `mfs:create-session` only answers the app page's top frame; strips `X-Frame-Options` / CSP `frame-ancestors` for `meshpay.com` so the SDK iframe embeds; `ipcMain` handler that mints an S2S OAuth token (`POST /oauth2/token`, client_credentials) then calls `POST /v2/sessions` to get a session exchange code. Picks credentials/host from `MFS_ENVIRONMENTS` (`production` / `sandbox`) by `overrides.environment` (defaults to sandbox). `buildSessionBody(toAddresses)` merges a renderer-supplied destination list into the request body (falls back to `DEFAULT_TO_ADDRESSES`) |
| `preload.js` | preload | `contextBridge` exposes `window.mfs.createSession(overrides)` only (`overrides = { toAddresses, environment }`), resolving to `{ token, clientId, linkEnv }` |
| `index.html` | renderer | UI: **Production / Sandbox** segmented switcher, **New Session** button, **Destinations** editor (token/network/address rows), `#mesh-container` iframe target; page CSP |
| `src/renderer.js` | renderer | `openLink(token, clientId, { environment, target: { mode: 'iframe', element } })` wiring; Destinations editor state → `toAddresses` payload |
| `dist/renderer.js` | — | esbuild output (gitignored) |

### Flow
- **New Session** — collects the Destinations editor rows into a `toAddresses`
  array and calls `window.mfs.createSession({ toAddresses, environment})`
  (main process). Main mints an S2S token for the selected environment, then
  `POST /v2/sessions` with that token + a fresh `Idempotency-Key`, and returns
  the response's one-time exchange code (`token`) plus the `clientId` and SDK
  environment string (`linkEnv`) to use.
- **Environment switcher** — a Production / Sandbox segmented control
  (Sandbox default). The selection decides both which MFS API host/creds
  `main.js` uses (`https://api.meshpay.com` vs `https://api.sbx.meshpay.com`)
  and which `environment` is passed to `openLink` — these **must** match,
  since a session is bound to the environment it was minted against
  (mismatches fail inside Link itself with an unhelpful error).

### Destinations editor
Same shape as `mesh-electron-example`'s, except each row's network is a
**CAIP-2 chain id** (`eip155:8453`, `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`,
...) instead of a legacy network UUID — MFS's v2 API's `TransferToAddress`
schema (`networkCaip2` / `symbol` / `address`). Incomplete rows are dropped
before minting; an empty list makes `main.js` fall back to
`DEFAULT_TO_ADDRESSES`.

### Why there's no "Host" field
Legacy's linkToken was itself a base64-encoded URL, so `mesh-electron-example`
could rewrite its host to point at a local or preview deployment. MFS's
session token is an opaque, single-use exchange code — not a URL — so there is
nothing to rewrite. `openLink`'s `environment` option is the only thing that
picks which Link deployment loads, and it must agree with the environment the
session was created against.

## Conventions
- Renderer is **bundled** by esbuild (IIFE). Renderer uses ES `import`; main/preload use CommonJS `require`.
- The MFS API calls (token mint + session creation) and the client secret live
  in the **main process** only — never move them into the renderer (CSP/CORS
  + secret exposure).
- No test framework is set up.

## Secrets / safety
MFS credentials are loaded from `.env` (gitignored) by `dotenv` in `main.js`;
see `.env.example` for the shape. Each environment has its **own** client
id/secret pair (`MFS_CLIENT_ID`/`MFS_CLIENT_SECRET` for production,
`MFS_SANDBOX_CLIENT_ID`/`MFS_SANDBOX_CLIENT_SECRET` for sandbox) — unlike
legacy Mesh, there is no client id shared across environments.
Treat the secrets as live: keep them in `.env`, never commit it, and never
package or distribute the credentials in a shipped build. This setup is
acceptable only because this is a local dev tool.
