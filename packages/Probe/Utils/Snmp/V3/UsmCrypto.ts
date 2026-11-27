import {
  desCbcDecrypt,
  desCbcEncrypt,
  xorDesBlock,
} from "../SnmpDesPrivacyCompat";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import crypto from "crypto";

/*
 * The User-based Security Model's cryptography (RFC 3414, RFC 3826, RFC
 * 7860 and draft-blumenthal-aes-usm-04), for the probe's SNMPv3 trap
 * receiver.
 *
 * KEYS. A passphrase becomes a key in two steps (RFC 3414 section 2.6):
 *
 *   Ku  = H(the passphrase repeated to 1,048,576 octets)   - slow, per user
 *   Kul = H(Ku || engineID || Ku)                          - fast, per engine
 *
 * Ku is the expensive step and depends on the passphrase alone, so it is
 * computed once per user and kept; localizing it to an engine is one short
 * hash. A trap is authenticated with keys localized to the SENDER's engine
 * ID (it is authoritative for a trap), an inform with keys localized to the
 * PROBE's (the receiver is authoritative for an inform). The privacy key is
 * derived the same way from the privacy passphrase, with the
 * AUTHENTICATION protocol's hash.
 *
 * These are the algorithms net-snmp's Authentication and Encryption
 * implement, and the tests hold this module to net-snmp's output byte for
 * byte. It is separate because net-snmp derives Ku again for every engine
 * it sees and keeps every result forever: on an open port, every forged
 * datagram with a fresh engine ID would cost a megabyte of hashing and grow
 * a cache without end.
 */

// RFC 3414 section A.2: the passphrase is hashed over this many octets.
const PASSWORD_TO_KEY_OCTETS: number = 1024 * 1024;

interface AuthAlgorithm {
  hash: string;
  // The digest the message carries (RFC 3414: 12 octets; RFC 7860 for SHA-2).
  macLength: number;
}

const AUTH_ALGORITHMS: Record<SnmpAuthProtocol, AuthAlgorithm> = {
  [SnmpAuthProtocol.MD5]: { hash: "md5", macLength: 12 },
  [SnmpAuthProtocol.SHA]: { hash: "sha1", macLength: 12 },
  [SnmpAuthProtocol.SHA256]: { hash: "sha256", macLength: 24 },
  [SnmpAuthProtocol.SHA512]: { hash: "sha512", macLength: 48 },
};

interface PrivAlgorithm {
  keyLength: number;
  cipher: "des" | "aes-128-cfb" | "aes-256-cfb";
}

const PRIV_ALGORITHMS: Record<SnmpPrivProtocol, PrivAlgorithm> = {
  // RFC 3414 section 8: CBC-DES, an 8-octet key and an 8-octet pre-IV.
  [SnmpPrivProtocol.DES]: { keyLength: 8, cipher: "des" },
  // RFC 3826: AES-128 in 128-bit CFB mode.
  [SnmpPrivProtocol.AES]: { keyLength: 16, cipher: "aes-128-cfb" },
  /*
   * AES-256 with draft-blumenthal-aes-usm-04's key extension: what the
   * probe's poller uses for AES256 (net-snmp's aes256b), what Cisco and
   * Net-SNMP's "AES-256" do.
   */
  [SnmpPrivProtocol.AES256]: { keyLength: 32, cipher: "aes-256-cfb" },
};

const DES_BLOCK_LENGTH: number = 8;
const AES_SALT_LENGTH: number = 8;

export class UsmDecryptionError extends Error {}

// The privacy key as the cipher takes it, localized to one engine.
export interface UsmPrivacyKey {
  protocol: SnmpPrivProtocol;
  key: Buffer;
  // DES only: the pre-IV the salt is XORed with (RFC 3414 section 8.1.1.1).
  preIv?: Buffer | undefined;
}

export default class UsmCrypto {
  public static getMacLength(protocol: SnmpAuthProtocol): number {
    return AUTH_ALGORITHMS[protocol].macLength;
  }

  // Ku: the passphrase hashed over a megabyte. Slow by design; keep the result.
  public static passwordToKu(
    protocol: SnmpAuthProtocol,
    passphrase: string,
  ): Buffer {
    const passphraseOctets: Buffer = Buffer.from(passphrase, "utf8");

    if (passphraseOctets.length === 0) {
      throw new Error("An SNMPv3 passphrase cannot be empty");
    }

    const hash: crypto.Hash = crypto.createHash(AUTH_ALGORITHMS[protocol].hash);

    /*
     * Whole repetitions of the passphrase, about 64 KB of them: hashed chunk
     * after chunk, the stream stays one unbroken repetition, and the last
     * chunk is cut to land on exactly PASSWORD_TO_KEY_OCTETS.
     */
    const repetitions: number = Math.ceil(65536 / passphraseOctets.length);
    const chunk: Buffer = Buffer.alloc(repetitions * passphraseOctets.length);

    for (let offset: number = 0; offset < chunk.length; ) {
      offset += passphraseOctets.copy(chunk, offset);
    }

    let remaining: number = PASSWORD_TO_KEY_OCTETS;

    while (remaining > 0) {
      const take: number = Math.min(remaining, chunk.length);
      hash.update(chunk.subarray(0, take));
      remaining -= take;
    }

    return hash.digest();
  }

  // Kul: Ku localized to one SNMP engine.
  public static localizeKey(
    protocol: SnmpAuthProtocol,
    ku: Buffer,
    engineId: Buffer,
  ): Buffer {
    return crypto
      .createHash(AUTH_ALGORITHMS[protocol].hash)
      .update(ku)
      .update(engineId)
      .update(ku)
      .digest();
  }

  /*
   * The digest of a whole message whose authentication parameters are
   * zeros, truncated to what the message carries.
   */
  public static computeMac(
    protocol: SnmpAuthProtocol,
    localizedAuthKey: Buffer,
    messageWithZeroedMac: Buffer,
  ): Buffer {
    const algorithm: AuthAlgorithm = AUTH_ALGORITHMS[protocol];

    return crypto
      .createHmac(algorithm.hash, localizedAuthKey)
      .update(messageWithZeroedMac)
      .digest()
      .subarray(0, algorithm.macLength);
  }

  /*
   * Whether a received message was signed with this key: its digest
   * recomputed over the message with the digest's own octets zeroed, and
   * compared in constant time. The message itself is not changed.
   */
  public static isAuthentic(data: {
    protocol: SnmpAuthProtocol;
    localizedAuthKey: Buffer;
    message: Buffer;
    macOffset: number;
    mac: Buffer;
  }): boolean {
    const macLength: number = AUTH_ALGORITHMS[data.protocol].macLength;

    if (data.mac.length !== macLength) {
      return false;
    }

    if (
      data.macOffset < 0 ||
      data.macOffset + macLength > data.message.length
    ) {
      return false;
    }

    const zeroed: Buffer = Buffer.from(data.message);
    zeroed.fill(0, data.macOffset, data.macOffset + macLength);

    const expected: Buffer = UsmCrypto.computeMac(
      data.protocol,
      data.localizedAuthKey,
      zeroed,
    );

    return crypto.timingSafeEqual(expected, data.mac);
  }

  /*
   * The privacy key localized to one engine, cut or extended to what the
   * cipher takes. privKu is Ku of the PRIVACY passphrase, computed with the
   * AUTHENTICATION protocol's hash (RFC 3414 section 2.6).
   */
  public static localizePrivacyKey(data: {
    authProtocol: SnmpAuthProtocol;
    privProtocol: SnmpPrivProtocol;
    privKu: Buffer;
    engineId: Buffer;
  }): UsmPrivacyKey {
    const localized: Buffer = UsmCrypto.localizeKey(
      data.authProtocol,
      data.privKu,
      data.engineId,
    );
    const algorithm: PrivAlgorithm = PRIV_ALGORITHMS[data.privProtocol];

    if (data.privProtocol === SnmpPrivProtocol.DES) {
      return {
        protocol: data.privProtocol,
        key: Buffer.from(localized.subarray(0, DES_BLOCK_LENGTH)),
        preIv: Buffer.from(
          localized.subarray(DES_BLOCK_LENGTH, DES_BLOCK_LENGTH * 2),
        ),
      };
    }

    /*
     * draft-blumenthal-aes-usm-04 section 3.1.2.1: while the localized key
     * is shorter than the cipher's, append the hash of what there is.
     * Only MD5 and SHA-1 keys are short of AES-256's 32 octets.
     */
    let key: Buffer = localized;
    let lastHash: Buffer = localized;
    const hash: string = AUTH_ALGORITHMS[data.authProtocol].hash;

    while (key.length < algorithm.keyLength) {
      lastHash = crypto.createHash(hash).update(lastHash).digest();
      key = Buffer.concat([key, lastHash]);
    }

    return {
      protocol: data.privProtocol,
      key: Buffer.from(key.subarray(0, algorithm.keyLength)),
    };
  }

  /*
   * A received scoped PDU, decrypted. engineBoots and engineTime are the
   * message's own (msgAuthoritativeEngineBoots/Time), which AES takes into
   * its IV. Throws UsmDecryptionError when the ciphertext cannot be what
   * the protocol makes - the caller counts it as a decryption error.
   */
  public static decrypt(data: {
    privacyKey: UsmPrivacyKey;
    privParameters: Buffer;
    engineBoots: number;
    engineTime: number;
    encrypted: Buffer;
  }): Buffer {
    try {
      if (data.privacyKey.protocol === SnmpPrivProtocol.DES) {
        if (
          data.privParameters.length !== DES_BLOCK_LENGTH ||
          data.encrypted.length === 0 ||
          data.encrypted.length % DES_BLOCK_LENGTH !== 0 ||
          !data.privacyKey.preIv
        ) {
          throw new UsmDecryptionError(
            "DES ciphertext or salt has the wrong length",
          );
        }

        return desCbcDecrypt(
          data.privacyKey.key,
          xorDesBlock(data.privacyKey.preIv, data.privParameters),
          data.encrypted,
          false,
        );
      }

      if (data.privParameters.length !== AES_SALT_LENGTH) {
        throw new UsmDecryptionError("AES salt has the wrong length");
      }

      const decipher: crypto.Decipheriv = crypto.createDecipheriv(
        PRIV_ALGORITHMS[data.privacyKey.protocol].cipher,
        data.privacyKey.key,
        UsmCrypto.getAesIv(
          data.engineBoots,
          data.engineTime,
          data.privParameters,
        ),
      );

      return Buffer.concat([decipher.update(data.encrypted), decipher.final()]);
    } catch (err) {
      if (err instanceof UsmDecryptionError) {
        throw err;
      }

      throw new UsmDecryptionError("The scoped PDU could not be decrypted");
    }
  }

  /*
   * A scoped PDU encrypted for sending, with the privacy parameters (the
   * salt) the message carries. `salt` is the 64-bit counter the sender keeps
   * (RFC 3826 section 3.1.2.1, RFC 3414 section 8.1.1.1); for DES its high
   * half is replaced by the engine's boots, as RFC 3414 says.
   */
  public static encrypt(data: {
    privacyKey: UsmPrivacyKey;
    engineBoots: number;
    engineTime: number;
    salt: Buffer;
    scopedPdu: Buffer;
  }): { encrypted: Buffer; privParameters: Buffer } {
    if (data.salt.length !== AES_SALT_LENGTH) {
      throw new Error("A USM salt is 8 octets");
    }

    if (data.privacyKey.protocol === SnmpPrivProtocol.DES) {
      if (!data.privacyKey.preIv) {
        throw new Error("A DES privacy key needs its pre-IV");
      }

      const salt: Buffer = Buffer.from(data.salt);
      salt.writeUInt32BE(data.engineBoots >>> 0, 0);

      // The pad is irrelevant (RFC 3414 section 8.1.1.2): zeros, to a whole block.
      const paddedLength: number =
        Math.ceil(data.scopedPdu.length / DES_BLOCK_LENGTH) * DES_BLOCK_LENGTH;
      const padded: Buffer = Buffer.alloc(paddedLength);
      data.scopedPdu.copy(padded);

      return {
        encrypted: desCbcEncrypt(
          data.privacyKey.key,
          xorDesBlock(data.privacyKey.preIv, salt),
          padded,
          false,
        ),
        privParameters: salt,
      };
    }

    const cipher: crypto.Cipheriv = crypto.createCipheriv(
      PRIV_ALGORITHMS[data.privacyKey.protocol].cipher,
      data.privacyKey.key,
      UsmCrypto.getAesIv(data.engineBoots, data.engineTime, data.salt),
    );

    return {
      encrypted: Buffer.concat([cipher.update(data.scopedPdu), cipher.final()]),
      privParameters: Buffer.from(data.salt),
    };
  }

  // RFC 3826 section 3.1.2.1: the IV is boots, time and the 64-bit salt.
  private static getAesIv(
    engineBoots: number,
    engineTime: number,
    salt: Buffer,
  ): Buffer {
    const iv: Buffer = Buffer.alloc(16);
    iv.writeUInt32BE(engineBoots >>> 0, 0);
    iv.writeUInt32BE(engineTime >>> 0, 4);
    salt.copy(iv, 8, 0, AES_SALT_LENGTH);
    return iv;
  }
}
