package com.oneuptime.androidagent.config

import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/*
 * The vault's sealing is AES-256-GCM. On a device the key lives in the
 * Android Keystore (KeystoreSecretCipher, tested on a device in
 * androidTest); here the same format runs with a software key.
 */
class TokenVaultTest {
    private fun softwareKey(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    private val key: SecretKey = softwareKey()
    private val cipher = AesGcmSecretCipher { key }

    @Test
    fun `a stored key reads back, and is never kept in plain text`() {
        val store = MemoryKeyValueStore()
        val vault = TokenVault(store, cipher)

        vault.save("  4c1f2a9e-ingestion-key  ")

        assertEquals(StoredToken.Present("4c1f2a9e-ingestion-key"), vault.read())
        val stored: String = store.getString(TokenVault.KEY)!!
        assertFalse(stored.contains("4c1f2a9e"))
    }

    @Test
    fun `each sealing uses a fresh IV, so the same key never seals the same way twice`() {
        val first: ByteArray = cipher.encrypt("same".toByteArray())
        val second: ByteArray = cipher.encrypt("same".toByteArray())

        assertNotEquals(first.toList(), second.toList())
        assertEquals("same", String(cipher.decrypt(first)))
        assertEquals("same", String(cipher.decrypt(second)))
    }

    @Test
    fun `nothing stored is absent`() {
        assertEquals(StoredToken.Absent, TokenVault(MemoryKeyValueStore(), cipher).read())
    }

    @Test
    fun `a key sealed with a Keystore key that is gone is unreadable, not an error`() {
        val store = MemoryKeyValueStore()
        TokenVault(store, cipher).save("secret")

        val otherDevice = TokenVault(store, AesGcmSecretCipher { softwareKey() })

        assertEquals(StoredToken.Unreadable, otherDevice.read())
    }

    @Test
    fun `tampered or truncated data is unreadable`() {
        val store = MemoryKeyValueStore()
        store.edit { putString(TokenVault.KEY, "bm90IGEgc2VhbGVkIGtleQ==") }
        assertEquals(StoredToken.Unreadable, TokenVault(store, cipher).read())

        store.edit { putString(TokenVault.KEY, "%%% not base64 %%%") }
        assertEquals(StoredToken.Unreadable, TokenVault(store, cipher).read())

        val sealed: ByteArray = cipher.encrypt("secret".toByteArray())
        sealed[sealed.size - 1] = (sealed[sealed.size - 1] + 1).toByte()
        store.edit { putString(TokenVault.KEY, kotlin.io.encoding.Base64.Default.encode(sealed)) }
        assertEquals(StoredToken.Unreadable, TokenVault(store, cipher).read())
    }

    @Test
    fun `clearing forgets the key`() {
        val store = MemoryKeyValueStore()
        val vault = TokenVault(store, cipher)
        vault.save("secret")

        vault.clear()

        assertEquals(StoredToken.Absent, vault.read())
        assertTrue(store.getString(TokenVault.KEY) == null)
    }

    @Test
    fun `the local settings keep the URL and name in the clear and the key sealed`() {
        val store = MemoryKeyValueStore()
        val local = LocalSettingsStore(store, TokenVault(store, cipher))

        local.save(" https://oneuptime.example.com ", "key-1", " front-desk ")
        assertEquals(LocalSettings("https://oneuptime.example.com", "key-1", "front-desk"), local.read())

        // Saving without a key keeps the one stored.
        local.save("", null, "")
        assertEquals(LocalSettings(null, "key-1", null), local.read())
        assertFalse(local.tokenIsUnreadable())

        local.clearToken()
        assertEquals(LocalSettings(null, null, null), local.read())
    }
}
