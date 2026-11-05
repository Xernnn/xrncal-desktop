import { safeStorage } from 'electron'
import type { OAuthClient, OAuthProvider } from '@shared/oauth-client'
import type { ISqliteDatabase } from './db/sqlite-driver'

export class EncryptionUnavailableError extends Error {
  constructor() {
    super('OS Keyring encryption is unavailable. Please unlock your system keychain before storing credentials.')
    this.name = 'EncryptionUnavailableError'
  }
}

export class SecureStore {
  constructor(private db?: ISqliteDatabase) {}

  /**
   * Check if OS safeStorage encryption is available. On Linux without a
   * keyring Electron falls back to 'basic_text', a key built into every copy of
   * Chromium - encryption in name only, so it counts as unavailable here
   * whatever isEncryptionAvailable() says.
   */
  isAvailable(): boolean {
    try {
      if (typeof safeStorage?.isEncryptionAvailable !== 'function' || !safeStorage.isEncryptionAvailable()) return false
      if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') return false
      return true
    } catch {
      return false
    }
  }

  /**
   * Encrypt a string using OS credentials keyring (safeStorage)
   */
  encrypt(plaintext: string): string {
    if (!this.isAvailable()) {
      throw new EncryptionUnavailableError()
    }
    const buffer = safeStorage.encryptString(plaintext)
    return buffer.toString('base64')
  }

  /**
   * Decrypt a string using OS credentials keyring
   */
  decrypt(encryptedBase64: string): string {
    if (!this.isAvailable()) {
      throw new EncryptionUnavailableError()
    }
    const buffer = Buffer.from(encryptedBase64, 'base64')
    return safeStorage.decryptString(buffer)
  }

  /**
   * Store token for an account in SQLite encrypted
   */
  storeToken(accountId: string, tokenData: unknown): void {
    this.put(`token:${accountId}`, tokenData)
  }

  /**
   * Retrieve and decrypt token for an account
   */
  getToken<T = unknown>(accountId: string): T | null {
    return this.read<T>(`token:${accountId}`)
  }

  /**
   * Remove stored token for an account
   */
  deleteToken(accountId: string): void {
    this.remove(`token:${accountId}`)
  }

  /**
   * The OAuth client typed into the app. Encrypted like a token, under a key
   * the settings IPC never serves (it serves only `AppSettings` keys).
   */
  storeOAuthClient(provider: OAuthProvider, client: OAuthClient): void {
    this.put(`oauth-client:${provider}`, client)
  }

  /** Null when there is none, or it cannot be read: a locked keyring, a backup from another computer. */
  getOAuthClient(provider: OAuthProvider): OAuthClient | null {
    return this.read<OAuthClient>(`oauth-client:${provider}`)
  }

  deleteOAuthClient(provider: OAuthProvider): void {
    this.remove(`oauth-client:${provider}`)
  }

  private put(key: string, data: unknown): void {
    if (!this.db) {
      throw new Error('Database instance required to persist tokens')
    }
    const serialized = JSON.stringify(data)
    const encrypted = this.encrypt(serialized)
    const now = new Date().toISOString()

    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, encrypted, now)
  }

  private read<T>(key: string): T | null {
    if (!this.db) return null
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get<{ value: string }>(key)

    if (!row || !row.value) return null
    try {
      const decrypted = this.decrypt(row.value)
      return JSON.parse(decrypted) as T
    } catch {
      return null
    }
  }

  private remove(key: string): void {
    if (!this.db) return
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  }
}
