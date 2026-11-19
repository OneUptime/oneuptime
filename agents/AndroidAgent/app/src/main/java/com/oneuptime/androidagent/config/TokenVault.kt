package com.oneuptime.androidagent.config

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.ProviderException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.io.encoding.Base64

/** Seals and opens small secrets. */
interface SecretCipher {
    fun encrypt(plaintext: ByteArray): ByteArray

    fun decrypt(sealed: ByteArray): ByteArray
}

/**
 * AES-256-GCM, sealed as one blob: a version byte, the IV's length and the
 * IV, then the ciphertext with its 128-bit tag. The key comes from
 * [keyProvider], so the format is tested with a software key and runs on the
 * device with a key in the Android Keystore.
 */
open class AesGcmSecretCipher(private val keyProvider: () -> SecretKey) : SecretCipher {
    override fun encrypt(plaintext: ByteArray): ByteArray {
        val cipher: Cipher = Cipher.getInstance(TRANSFORMATION)
        // No IV is passed: the Keystore insists on making it, at random, itself.
        cipher.init(Cipher.ENCRYPT_MODE, keyProvider())
        val iv: ByteArray = cipher.iv
        val ciphertext: ByteArray = cipher.doFinal(plaintext)
        return byteArrayOf(FORMAT_VERSION, iv.size.toByte()) + iv + ciphertext
    }

    override fun decrypt(sealed: ByteArray): ByteArray {
        if (sealed.size < 2 || sealed[0] != FORMAT_VERSION) {
            throw GeneralSecurityException("Unknown sealed secret format")
        }
        val ivLength: Int = sealed[1].toInt()
        if (ivLength !in 12..16 || sealed.size < 2 + ivLength + TAG_BYTES) {
            throw GeneralSecurityException("Truncated sealed secret")
        }
        val iv: ByteArray = sealed.copyOfRange(2, 2 + ivLength)
        val cipher: Cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, keyProvider(), GCMParameterSpec(TAG_BYTES * 8, iv))
        return cipher.doFinal(sealed, 2 + ivLength, sealed.size - 2 - ivLength)
    }

    companion object {
        const val TRANSFORMATION: String = "AES/GCM/NoPadding"
        private const val FORMAT_VERSION: Byte = 1
        private const val TAG_BYTES: Int = 16
    }
}

/**
 * [AesGcmSecretCipher] under a key the Android Keystore makes and keeps: it
 * never leaves the Keystore (in hardware where the device has it), so the
 * ingestion key stored with it cannot be read off a copy of the app's files.
 */
class KeystoreSecretCipher(alias: String = DEFAULT_ALIAS) : AesGcmSecretCipher({ keystoreKey(alias) }) {
    companion object {
        const val DEFAULT_ALIAS: String = "oneuptime-agent-ingestion-key"
        private const val PROVIDER: String = "AndroidKeyStore"

        private fun keystoreKey(alias: String): SecretKey {
            val keyStore: KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }
            (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }

            val generator: KeyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
            generator.init(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
            return generator.generateKey()
        }
    }
}

/** What reading the stored ingestion key found. */
sealed interface StoredToken {
    data class Present(val token: String) : StoredToken

    data object Absent : StoredToken

    // It was stored, but its Keystore key is gone (a restore onto another device, or a cleared Keystore).
    data object Unreadable : StoredToken
}

/**
 * The ingestion key entered on the setup screen, sealed with [cipher] before
 * it is written, and only ever kept sealed. One the device manager sends is
 * never written here: Android keeps the managed configuration itself.
 */
class TokenVault(private val store: KeyValueStore, private val cipher: SecretCipher) {
    fun save(token: String) {
        val sealed: ByteArray = cipher.encrypt(token.trim().toByteArray(Charsets.UTF_8))
        store.edit { putString(KEY, Base64.Default.encode(sealed)) }
    }

    fun read(): StoredToken {
        val encoded: String = store.getString(KEY) ?: return StoredToken.Absent
        return try {
            val plain = String(cipher.decrypt(Base64.Default.decode(encoded)), Charsets.UTF_8)
            if (plain.isBlank()) StoredToken.Absent else StoredToken.Present(plain)
        } catch (_: GeneralSecurityException) {
            StoredToken.Unreadable
        } catch (_: ProviderException) {
            // How some devices' Keystores report a key they cannot use.
            StoredToken.Unreadable
        } catch (_: IllegalArgumentException) {
            StoredToken.Unreadable
        } catch (_: IllegalStateException) {
            StoredToken.Unreadable
        }
    }

    fun clear() {
        store.edit { putString(KEY, null) }
    }

    companion object {
        const val KEY: String = "sealed_ingestion_key"
    }
}
