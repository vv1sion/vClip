const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const KEY_LENGTH = 24
const PBKDF2_ROUNDS = 600000

export const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes))
export const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const random = (length) => crypto.getRandomValues(new Uint8Array(length))

async function sha256(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const joined = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', joined))
}

const importAes = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])

async function seal(rawKey, plain) {
  const iv = random(12)
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importAes(rawKey), plain))
  return { iv: toBase64(iv), data: toBase64(data) }
}

async function open(rawKey, box) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(box.iv) }, await importAes(rawKey), fromBase64(box.data)))
}

async function passphraseKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ROUNDS, hash: 'SHA-256' }, base, 256))
}

export function generateKey() {
  const symbols = [...random(KEY_LENGTH)].map((value) => KEY_ALPHABET[value & 31]).join('')
  return symbols
}

export const formatKey = (key) => key.match(/.{4}/g).join('-')

export function normalizeKey(input) {
  const key = String(input).toUpperCase().replace(/[\s-]/g, '')
  if (key.length !== KEY_LENGTH || [...key].some((c) => !KEY_ALPHABET.includes(c))) return null
  return key
}

export async function keyId(key) {
  return toHex(await sha256(encoder.encode(`vclip-id:${key}`))).slice(0, 32)
}

async function wrapKey(key, salt) {
  return sha256(encoder.encode('vclip-wrap:'), salt, encoder.encode(key))
}

export async function createVault({ clientId, clientSecret, passphrase }) {
  const master = random(32)
  const salt = random(16)
  const plain = encoder.encode(JSON.stringify({ client_id: clientId, client_secret: clientSecret }))
  const file = {
    version: 1,
    vault: await seal(master, plain),
    admin: { salt: toBase64(salt), ...(await seal(await passphraseKey(passphrase, salt), master)) },
    keys: [],
  }
  return { master, file }
}

export async function unlockAdmin(file, passphrase) {
  return open(await passphraseKey(passphrase, fromBase64(file.admin.salt)), file.admin)
}

export async function addKey(file, master, label) {
  const key = generateKey()
  const salt = random(16)
  const entry = {
    id: await keyId(key),
    label,
    created: new Date().toISOString(),
    salt: toBase64(salt),
    ...(await seal(await wrapKey(key, salt), master)),
  }
  return { key: formatKey(key), file: { ...file, keys: [...file.keys, entry] } }
}

export const revokeKey = (file, id) => ({ ...file, keys: file.keys.filter((entry) => entry.id !== id) })

export async function readCredentials(file, input) {
  const key = normalizeKey(input)
  if (!key) throw new Error('That is not a valid access key')
  const id = await keyId(key)
  const entry = file.keys.find((candidate) => candidate.id === id)
  if (!entry) throw new Error('This access key is not active')
  const master = await open(await wrapKey(key, fromBase64(entry.salt)), entry)
  const credentials = JSON.parse(decoder.decode(await open(master, file.vault)))
  return { clientId: credentials.client_id, clientSecret: credentials.client_secret }
}

export async function replaceCredentials(file, master, { clientId, clientSecret }) {
  const plain = encoder.encode(JSON.stringify({ client_id: clientId, client_secret: clientSecret }))
  return { ...file, vault: await seal(master, plain) }
}
