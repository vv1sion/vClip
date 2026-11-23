import { addKey, createVault, fromBase64, replaceCredentials, revokeKey, toBase64, unlockAdmin } from './vault.js'

const API = 'https://api.github.com/repos/vv1sion/vClip/contents/keys.json'
const IDLE_LIMIT_MS = 15 * 60 * 1000
const MIN_PASSPHRASE = 14

const app = document.getElementById('app')
const show = (...nodes) => app.replaceChildren(...nodes.filter(Boolean))
const session = { token: '', master: null, file: null, sha: null, setup: false, notice: null, newKey: null, idleTimer: null }

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue
    if (name === 'class') node.className = value
    else if (name === 'text') node.textContent = value
    else if (name.startsWith('on')) node.addEventListener(name.slice(2), value)
    else node.setAttribute(name, value === true ? '' : value)
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue
    node.append(child.nodeType ? child : document.createTextNode(String(child)))
  }
  return node
}

function field(id, label, type, hint, extra = {}) {
  return el('div', { class: 'field' }, el('label', { for: id, text: label }), el('input', { id, type, autocomplete: 'off', spellcheck: 'false', ...extra }), hint ? el('small', { text: hint }) : null)
}

const value = (id) => document.getElementById(id).value

function wipe() {
  session.token = ''
  session.master = null
  session.file = null
  session.sha = null
  session.setup = false
  session.newKey = null
  render()
}

function touch() {
  clearTimeout(session.idleTimer)
  if (session.master) session.idleTimer = setTimeout(() => {
    session.notice = { kind: 'ok', text: 'Signed out after 15 minutes without activity.' }
    wipe()
  }, IDLE_LIMIT_MS)
}

function headers(token) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
}

async function loadFile(token) {
  const response = await fetch(`${API}?ref=updates`, { headers: headers(token), cache: 'no-store' })
  if (response.status === 404) return null
  if (response.status === 401 || response.status === 403) throw new Error('GitHub did not accept this token. It needs write access to Contents of the vClip repository.')
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`)
  const body = await response.json()
  const text = new TextDecoder().decode(fromBase64(body.content.replace(/\s/g, '')))
  return { sha: body.sha, file: JSON.parse(text) }
}

async function saveFile(message) {
  const content = toBase64(new TextEncoder().encode(JSON.stringify(session.file, null, 2)))
  const payload = { message, content, branch: 'updates' }
  if (session.sha) payload.sha = session.sha
  const response = await fetch(API, { method: 'PUT', headers: { ...headers(session.token), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  if (response.status === 409 || response.status === 422) throw new Error('The key list changed in the meantime. Open the dashboard again and retry.')
  if (response.status === 401 || response.status === 403) throw new Error('GitHub did not accept this token for writing.')
  if (!response.ok) throw new Error(`GitHub answered ${response.status}.`)
  session.sha = (await response.json()).content.sha
}

async function run(button, task) {
  button.disabled = true
  try {
    await task()
  } catch (error) {
    session.notice = { kind: 'error', text: error.message || String(error) }
  }
  render()
}

function notice() {
  if (!session.notice) return null
  const current = session.notice
  session.notice = null
  return el('p', { class: `message ${current.kind}`, role: current.kind === 'error' ? 'alert' : 'status', text: current.text })
}

function renderSignIn() {
  const open = el('button', { class: 'btn primary', type: 'button', text: 'Open dashboard' })
  open.addEventListener('click', () => run(open, async () => {
    const token = value('token').trim()
    const passphrase = value('passphrase')
    if (!token || !passphrase) throw new Error('Enter the GitHub token and the admin passphrase.')
    const loaded = await loadFile(token)
    if (!loaded) {
      session.token = token
      session.setup = true
      session.notice = { kind: 'ok', text: 'No key list exists yet. Set it up first.' }
      return
    }
    const master = await unlockAdmin(loaded.file, passphrase).catch(() => {
      throw new Error('That passphrase does not open this key list.')
    })
    session.token = token
    session.master = master
    session.file = loaded.file
    session.sha = loaded.sha
  }))

  show(
    el('div', {}, el('h1', { text: 'Access keys' }), el('p', { class: 'sub', text: 'Create and revoke the keys that unlock YouTube upload in vClip.' })),
    notice(),
    el(
      'section',
      { class: 'panel' },
      field('token', 'GitHub token', 'password', 'A fine-grained token for the vClip repository with Contents set to read and write. It stays in this tab and is gone when you close it.'),
      field('passphrase', 'Admin passphrase', 'password', 'Opens the master key. Never leaves your browser.'),
      el('div', { class: 'actions' }, open),
    ),
  )
}

function renderSetup() {
  const create = el('button', { class: 'btn primary', type: 'button', text: 'Create key list' })
  create.addEventListener('click', () => run(create, async () => {
    const clientId = value('client-id').trim()
    const clientSecret = value('client-secret').trim()
    const passphrase = value('new-passphrase')
    if (!clientId || !clientSecret) throw new Error('Enter the Google client ID and the client secret.')
    if (passphrase.length < MIN_PASSPHRASE) throw new Error(`Use a passphrase with at least ${MIN_PASSPHRASE} characters.`)
    if (passphrase !== value('repeat-passphrase')) throw new Error('The two passphrases are different.')
    const { master, file } = await createVault({ clientId, clientSecret, passphrase })
    session.file = file
    session.sha = null
    await saveFile('chore: set up access keys')
    session.master = master
    session.notice = { kind: 'ok', text: 'Key list created. You can create the first key now.' }
  }))

  show(
    el('div', {}, el('h1', { text: 'Set up access keys' }), el('p', { class: 'sub', text: 'The Google credentials are encrypted here in your browser. Only the encrypted data is stored in the repository.' })),
    notice(),
    el(
      'section',
      { class: 'panel' },
      field('client-id', 'Google client ID', 'text', 'From the OAuth client of type Desktop app.'),
      field('client-secret', 'Google client secret', 'password'),
      field('new-passphrase', 'Admin passphrase', 'password', `At least ${MIN_PASSPHRASE} characters. If you lose it, the key list cannot be opened again.`),
      field('repeat-passphrase', 'Repeat the passphrase', 'password'),
      el('div', { class: 'actions' }, create),
    ),
  )
}

function dateText(iso) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function renderKeys() {
  const make = el('button', { class: 'btn primary', type: 'button', text: 'Create key' })
  make.addEventListener('click', () => run(make, async () => {
    const label = value('label').trim()
    if (!label || label.length > 60) throw new Error('Give the key a name with 1 to 60 characters, for example who it is for.')
    const result = await addKey(session.file, session.master, label)
    session.file = result.file
    await saveFile(`chore: create access key for ${label.replace(/[\r\n]/g, ' ')}`)
    session.newKey = { key: result.key, label }
  }))

  const list = session.file.keys.length
    ? el(
        'ul',
        { class: 'keys' },
        session.file.keys.map((entry) => {
          const revoke = el('button', { class: 'btn danger', type: 'button', text: 'Revoke' })
          revoke.addEventListener('click', () => {
            if (!confirm(`Revoke the key for "${entry.label}"? It stops working for them right away.`)) return
            run(revoke, async () => {
              session.file = revokeKey(session.file, entry.id)
              await saveFile(`chore: revoke access key for ${String(entry.label).replace(/[\r\n]/g, ' ')}`)
              session.notice = { kind: 'ok', text: `The key for "${entry.label}" is revoked.` }
            })
          })
          const details = `Created ${dateText(entry.created)} · ID ${entry.id.slice(0, 8)}`
          const info = el('div', {}, el('b', { text: entry.label }), el('span', { text: details }))
          return el('li', {}, info, revoke)
        }),
      )
    : el('p', { class: 'empty', text: 'No keys yet.' })

  const replace = el('button', { class: 'btn', type: 'button', text: 'Replace credentials' })
  replace.addEventListener('click', () => run(replace, async () => {
    const clientId = value('replace-id').trim()
    const clientSecret = value('replace-secret').trim()
    if (!clientId || !clientSecret) throw new Error('Enter the new client ID and secret.')
    session.file = await replaceCredentials(session.file, session.master, { clientId, clientSecret })
    await saveFile('chore: replace google credentials')
    session.notice = { kind: 'ok', text: 'The Google credentials are replaced. Existing keys keep working.' }
  }))

  const signOut = el('button', { class: 'btn', type: 'button', text: 'Sign out' })
  signOut.addEventListener('click', wipe)

  const issued = session.newKey
  session.newKey = null
  const copy = el('button', { class: 'btn', type: 'button', text: 'Copy key' })
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(issued.key)
      copy.textContent = 'Copied'
    } catch {
      copy.textContent = 'Select the key and copy it by hand'
    }
  })

  show(
    el('div', {}, el('h1', { text: 'Access keys' }), el('p', { class: 'sub', text: 'Each key unlocks YouTube upload for one person. Revoke it and it stops working the next time vClip checks.' })),
    notice(),
    issued
      ? el('section', { class: 'newkey' }, el('p', { text: `Key for ${issued.label}` }), el('b', { text: issued.key }), el('p', { text: 'This is the only time the key is shown. Send it over a private channel.' }), el('div', { class: 'actions' }, copy))
      : null,
    el('section', { class: 'panel' }, el('h2', { text: 'Create a key' }), field('label', 'Name', 'text', 'Who is it for? Only you see this.', { maxlength: 60 }), el('div', { class: 'actions' }, make)),
    el('section', { class: 'panel' }, el('h2', { text: `Active keys (${session.file.keys.length})` }), list),
    el(
      'section',
      { class: 'panel' },
      el('details', {}, el('summary', { text: 'Replace the Google credentials' }), el('div', { class: 'panel-body' }, field('replace-id', 'New client ID', 'text'), field('replace-secret', 'New client secret', 'password'), el('div', { class: 'actions' }, replace))),
    ),
    el('div', { class: 'actions' }, signOut),
  )
}

function render() {
  touch()
  if (session.master && session.file) renderKeys()
  else if (session.setup && session.token) renderSetup()
  else renderSignIn()
}

for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, touch)
window.addEventListener('pagehide', () => {
  session.token = ''
  session.master = null
})

render()
