import { openLink } from '@meshpayhq/link-web-sdk'

const CONTAINER_ID = 'mesh-container'

const runBtn = document.getElementById('runBtn')
const statusEl = document.getElementById('status')

function setStatus(msg) {
  statusEl.textContent = msg
}

// ---- Environment switcher ---- //
// Sandbox is the default; the selected value is sent to the main process
// so it picks the matching MFS API host + credentials. Also drives which
// Link deployment openLink() loads (must match what the session was minted
// against — see @meshpayhq/link-web-sdk's README on `environment`).
let environment = 'sandbox'
const envSwitch = document.getElementById('envSwitch')
envSwitch.addEventListener('click', (e) => {
  const btn = e.target.closest('.seg-btn')
  if (!btn) return
  environment = btn.dataset.env
  envSwitch.querySelectorAll('.seg-btn').forEach((b) => {
    const active = b === btn
    b.classList.toggle('is-active', active)
    b.setAttribute('aria-selected', String(active))
  })
})

// ---- Destinations editor ---- //
// Each row maps to one transferOptions.toAddresses entry. Token list mirrors
// link-v2's test harness; networks are CAIP-2 ids (MFS's v2 API, unlike
// legacy's UUID networkIds — see openapi.yaml's TransferToAddress schema).
const KNOWN_TOKENS = [
  'USDC', 'USDT', 'USDE', 'ETH', 'SOL', 'BTC', 'PYUSD', 'DAI', 'WETH', 'WBTC',
  'POL', 'BNB', 'AVAX', 'LINK', 'UNI', 'AAVE', 'ARB', 'OP', 'RLUSD'
]

const KNOWN_NETWORKS = [
  { id: 'eip155:1', name: 'Ethereum' },
  { id: 'eip155:8453', name: 'Base' },
  { id: 'eip155:10', name: 'Optimism' },
  { id: 'eip155:42161', name: 'Arbitrum' },
  { id: 'eip155:137', name: 'Polygon' },
  { id: 'eip155:56', name: 'BSC' },
  { id: 'eip155:43114', name: 'Avalanche C' },
  { id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', name: 'Solana' },
  { id: 'bip122:000000000019d6689c085ae165831e93', name: 'Bitcoin' }
]

const EVM_DEFAULT = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const SOL_DEFAULT = 'DFySo5AikbgfEjfPuM5ZFUdnguEgnFny5GmYKk7Nv6dx'
const BTC_DEFAULT = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
const DEFAULT_ADDRESS = {
  'eip155:1': EVM_DEFAULT,
  'eip155:8453': EVM_DEFAULT,
  'eip155:10': EVM_DEFAULT,
  'eip155:42161': EVM_DEFAULT,
  'eip155:137': EVM_DEFAULT,
  'eip155:56': EVM_DEFAULT,
  'eip155:43114': EVM_DEFAULT,
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': SOL_DEFAULT,
  'bip122:000000000019d6689c085ae165831e93': BTC_DEFAULT
}

const destRowsEl = document.getElementById('destRows')
const destCountEl = document.getElementById('destCount')
const destAddBtn = document.getElementById('destAddBtn')

// Seed with the same destination the main process uses by default, so Run
// behaves identically until the user edits the list.
let destinations = [
  {
    symbol: 'USDC',
    networkCaip2: 'eip155:8453',
    address: EVM_DEFAULT
  }
]

function renderDestinations() {
  destRowsEl.innerHTML = ''
  destCountEl.textContent = String(destinations.length)
  if (destinations.length === 0) {
    const hint = document.createElement('div')
    hint.className = 'dest-empty-hint'
    hint.textContent = 'Click "+ Add" to define a destination (Run uses the default).'
    destRowsEl.appendChild(hint)
    return
  }

  destinations.forEach((dest, idx) => {
    const row = document.createElement('div')
    row.className = 'dest-row'

    const symbolSel = document.createElement('select')
    symbolSel.className = 'dest-symbol'
    if (KNOWN_TOKENS.indexOf(dest.symbol) === -1 && dest.symbol) {
      symbolSel.appendChild(new Option(dest.symbol, dest.symbol, true, true))
    }
    KNOWN_TOKENS.forEach((sym) => {
      symbolSel.appendChild(new Option(sym, sym, false, sym === dest.symbol))
    })
    symbolSel.addEventListener('change', () => {
      destinations[idx].symbol = symbolSel.value
    })

    const networkSel = document.createElement('select')
    networkSel.className = 'dest-network'
    KNOWN_NETWORKS.forEach((net) => {
      networkSel.appendChild(
        new Option(net.name, net.id, false, net.id === dest.networkCaip2)
      )
    })
    networkSel.addEventListener('change', () => {
      destinations[idx].networkCaip2 = networkSel.value
      // Swap in a sensible default address when the current one is empty or
      // is a known default for another chain.
      const addr = destinations[idx].address
      const allDefaults = Object.values(DEFAULT_ADDRESS)
      if (!addr || allDefaults.indexOf(addr) !== -1) {
        destinations[idx].address = DEFAULT_ADDRESS[networkSel.value] || ''
        renderDestinations()
      }
    })

    const addrInput = document.createElement('input')
    addrInput.type = 'text'
    addrInput.className = 'dest-address'
    addrInput.placeholder = 'Wallet address'
    addrInput.spellcheck = false
    addrInput.value = dest.address || ''
    addrInput.addEventListener('input', () => {
      destinations[idx].address = addrInput.value
    })

    const removeBtn = document.createElement('button')
    removeBtn.className = 'dest-remove-btn'
    removeBtn.textContent = '×'
    removeBtn.title = 'Remove destination'
    removeBtn.addEventListener('click', () => {
      destinations.splice(idx, 1)
      renderDestinations()
    })

    row.append(symbolSel, networkSel, addrInput, removeBtn)
    destRowsEl.appendChild(row)
  })
}

function addDestination() {
  const networkCaip2 = KNOWN_NETWORKS[0].id
  destinations.push({
    symbol: KNOWN_TOKENS[0],
    networkCaip2,
    address: DEFAULT_ADDRESS[networkCaip2] || ''
  })
  renderDestinations()
}

// Build the toAddresses payload from the rows, dropping incomplete ones.
function collectToAddresses() {
  return destinations
    .filter((d) => d.symbol && d.networkCaip2 && d.address)
    .map((d) => ({
      symbol: d.symbol,
      networkCaip2: d.networkCaip2,
      address: d.address.trim()
    }))
}

destAddBtn.addEventListener('click', addDestination)
renderDestinations()

let activeHandle = null

// New Session: ask the main process to mint a Link session (OAuth token +
// POST /v2/sessions), then hand the exchange code straight to openLink().
runBtn.addEventListener('click', async () => {
  runBtn.disabled = true
  setStatus('Creating session…')
  try {
    const { token, clientId, linkEnv } = await window.mfs.createSession({
      toAddresses: collectToAddresses(),
      environment
    })

    if (activeHandle) activeHandle.close()

    setStatus('Opening Mesh Link…')
    activeHandle = openLink(token, clientId, {
      environment: linkEnv,
      target: { mode: 'iframe', element: CONTAINER_ID },
      onExit: ({ status }) => {
        console.log('[MFS] exited', status)
        setStatus(`Closed (${status}).`)
        activeHandle.close()
      },
      onError: (error) => {
        console.error('[MFS] error', error)
        setStatus(`Error: ${error.code} — ${error.message}`)
        activeHandle.close()
      }
    })
  } catch (err) {
    console.error(err)
    setStatus(`Error: ${err.message}`)
  } finally {
    runBtn.disabled = false
  }
})
