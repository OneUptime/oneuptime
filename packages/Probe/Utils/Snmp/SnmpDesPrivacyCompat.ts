import logger from "Common/Server/Utils/Logger";
import crypto from "crypto";
import snmp from "net-snmp";

/*
 * SNMPv3 DES privacy (RFC 3414 section 8) on OpenSSL 3.
 *
 * net-snmp encrypts DES-privacy PDUs with crypto.createCipheriv("des-cbc").
 * OpenSSL 3 moved single DES into the legacy provider, which Node does not
 * load by default, so on Node 17+ every authPriv poll of a DES device fails
 * before a packet leaves the probe:
 *
 *   error:0308010C:digital envelope routines::unsupported
 *
 * Triple DES in EDE mode with K1 = K2 = K3 *is* single DES by construction —
 * E_K(D_K(E_K(block))) collapses to E_K(block) — and "des-ede3-cbc" is still
 * in OpenSSL 3's default provider. Encrypting through it with the 8-octet DES
 * key repeated three times therefore reproduces the exact ciphertext the
 * removed "des-cbc" produced, and the exact bytes a DES-speaking device
 * expects, without enabling the legacy provider process-wide (which would
 * weaken crypto for everything else in the probe) and without hand-rolling a
 * block cipher.
 *
 * Everything else below — key localization, salt, IV derivation, padding — is
 * net-snmp's own algorithm preserved byte for byte, so the only thing this
 * module changes on the wire is which OpenSSL primitive computes the blocks.
 */

// The 3DES cipher OpenSSL 3 still ships in its default provider.
const TRIPLE_DES_CBC_CIPHER: string = "des-ede3-cbc";

// RFC 3414 section 8.1.1.1: DES privacy uses an 8-octet key and 8-octet blocks.
const DES_KEY_LENGTH: number = 8;
const DES_BLOCK_LENGTH: number = 8;

/*
 * net-snmp hands its DES functions the remote engine record, not the
 * `Algorithm` its bundled type definitions claim. Only engineID is read.
 */
export type SnmpAuthoritativeEngine = {
  engineID: Buffer;
};

export type SnmpDesEncryptResult = {
  encryptedPdu: Buffer;
  msgPrivacyParameters: Buffer;
};

/*
 * Repeat the 8-octet DES key into the 24-octet key des-ede3-cbc expects. The
 * EDE cascade over three identical keys is single DES, so this is a change of
 * primitive rather than of algorithm.
 */
function toTripleDesKey(desKey: Buffer): Buffer {
  return Buffer.concat([desKey, desKey, desKey]);
}

/*
 * True when this Node build can still do single DES natively. Only used to
 * describe the environment in logs — the 3DES path is taken either way so
 * that probes behave identically across Node and OpenSSL versions.
 */
export function isNativeDesCbcAvailable(): boolean {
  try {
    crypto.createCipheriv(
      "des-cbc",
      Buffer.alloc(DES_KEY_LENGTH),
      Buffer.alloc(DES_BLOCK_LENGTH),
    );
    return true;
  } catch {
    return false;
  }
}

export function isTripleDesCbcAvailable(): boolean {
  try {
    crypto.createCipheriv(
      TRIPLE_DES_CBC_CIPHER,
      Buffer.alloc(DES_KEY_LENGTH * 3),
      Buffer.alloc(DES_BLOCK_LENGTH),
    );
    return true;
  } catch {
    return false;
  }
}

/*
 * DES-CBC encryption expressed as 3DES-EDE-CBC over a tripled key.
 *
 * autoPadding mirrors the flag net-snmp passes to OpenSSL at each call site:
 * left on when encrypting, switched off when decrypting.
 */
export function desCbcEncrypt(
  desKey: Buffer,
  iv: Buffer,
  plaintext: Buffer,
  autoPadding: boolean,
): Buffer {
  const cipher: crypto.Cipheriv = crypto.createCipheriv(
    TRIPLE_DES_CBC_CIPHER,
    toTripleDesKey(desKey),
    iv,
  );
  cipher.setAutoPadding(autoPadding);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

export function desCbcDecrypt(
  desKey: Buffer,
  iv: Buffer,
  ciphertext: Buffer,
  autoPadding: boolean,
): Buffer {
  const decipher: crypto.Decipheriv = crypto.createDecipheriv(
    TRIPLE_DES_CBC_CIPHER,
    toTripleDesKey(desKey),
    iv,
  );
  decipher.setAutoPadding(autoPadding);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/*
 * RFC 3414 section 2.6 / 8.1.1.1: the privacy passphrase is localized to the
 * authoritative engine using the *auth* protocol's password-to-key function.
 * The first 8 octets of that localized key are the DES key; octets 8..16 are
 * the "pre-IV" the salt is XORed against. net-snmp's own passwordToKey is
 * reused so the derivation stays identical to the library's.
 */
export function deriveDesKeyMaterial(
  privPassword: string,
  authProtocol: snmp.AuthProtocols,
  engineId: Buffer,
): { encryptionKey: Buffer; preIv: Buffer } {
  const privLocalizedKey: Buffer = snmp.Authentication.passwordToKey(
    authProtocol as Exclude<snmp.AuthProtocols, snmp.AuthProtocols.none>,
    privPassword,
    engineId,
  );

  const encryptionKey: Buffer = Buffer.alloc(DES_KEY_LENGTH);
  privLocalizedKey.copy(encryptionKey, 0, 0, DES_KEY_LENGTH);

  const preIv: Buffer = Buffer.alloc(DES_BLOCK_LENGTH);
  privLocalizedKey.copy(
    preIv,
    0,
    DES_KEY_LENGTH,
    DES_KEY_LENGTH + DES_BLOCK_LENGTH,
  );

  return { encryptionKey: encryptionKey, preIv: preIv };
}

export function xorDesBlock(left: Buffer, right: Buffer): Buffer {
  const result: Buffer = Buffer.alloc(DES_BLOCK_LENGTH);

  for (let index: number = 0; index < DES_BLOCK_LENGTH; index++) {
    result[index] = (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return result;
}

/*
 * RFC 3414 section 8.1.1.1 salt: 4 octets of engine boots followed by 4
 * octets of a local counter. net-snmp keeps no persistent engine state, so it
 * pins boots to 1 and randomises the low half per message; preserved here so
 * the IV stream is what the library always produced.
 */
export function generateDesSalt(): Buffer {
  const salt: Buffer = Buffer.alloc(DES_BLOCK_LENGTH);
  salt.fill("00000001", 0, 4, "hex");
  salt.fill(crypto.randomBytes(4), 4, 8);
  return salt;
}

/*
 * Zero-pad the scoped PDU up to the 8-octet block boundary. Input that is
 * already a multiple of 8 is passed through untouched — matching net-snmp,
 * which then lets OpenSSL append one further full PKCS#7 block. That trailing
 * block falls outside the BER-encoded scopedPdu and receivers ignore it; it is
 * deliberately preserved so this change swaps the cipher primitive and
 * nothing else about the bytes on the wire.
 */
export function padScopedPduForDes(scopedPdu: Buffer): Buffer {
  if (scopedPdu.length % DES_BLOCK_LENGTH === 0) {
    return scopedPdu;
  }

  const paddedLength: number =
    DES_BLOCK_LENGTH * (Math.floor(scopedPdu.length / DES_BLOCK_LENGTH) + 1);
  const padded: Buffer = Buffer.alloc(paddedLength);
  scopedPdu.copy(padded, 0, 0, scopedPdu.length);
  return padded;
}

/*
 * Drop-in replacement for net-snmp's Encryption.encryptPduDes. Argument order
 * and return shape match the library's exactly — it is called through
 * Encryption.algorithms[PrivProtocols.des].encryptPdu.
 */
export function encryptPduDes(
  scopedPdu: Buffer,
  _privProtocol: snmp.PrivProtocols,
  privPassword: string,
  authProtocol: snmp.AuthProtocols,
  engine: SnmpAuthoritativeEngine,
): SnmpDesEncryptResult {
  const keyMaterial: { encryptionKey: Buffer; preIv: Buffer } =
    deriveDesKeyMaterial(privPassword, authProtocol, engine.engineID);

  const salt: Buffer = generateDesSalt();
  const iv: Buffer = xorDesBlock(keyMaterial.preIv, salt);

  const encryptedPdu: Buffer = desCbcEncrypt(
    keyMaterial.encryptionKey,
    iv,
    padScopedPduForDes(scopedPdu),
    // net-snmp leaves OpenSSL's automatic padding on when encrypting.
    true,
  );

  return {
    encryptedPdu: encryptedPdu,
    msgPrivacyParameters: salt,
  };
}

/*
 * Drop-in replacement for net-snmp's Encryption.decryptPduDes. The salt the
 * sender chose arrives in msgPrivacyParameters, so the IV is recovered rather
 * than generated.
 */
export function decryptPduDes(
  encryptedPdu: Buffer,
  _privProtocol: snmp.PrivProtocols,
  privParameters: Buffer,
  privPassword: string,
  authProtocol: snmp.AuthProtocols,
  engine: SnmpAuthoritativeEngine,
): Buffer {
  const keyMaterial: { encryptionKey: Buffer; preIv: Buffer } =
    deriveDesKeyMaterial(privPassword, authProtocol, engine.engineID);

  const iv: Buffer = xorDesBlock(keyMaterial.preIv, privParameters);

  return desCbcDecrypt(
    keyMaterial.encryptionKey,
    iv,
    encryptedPdu,
    /*
     * Padding is left in place: the scoped PDU is self-delimiting BER, so the
     * parser stops at the end of the sequence and trailing octets are inert.
     * Asking OpenSSL to strip PKCS#7 here would reject perfectly good frames
     * from devices that zero-pad instead.
     */
    false,
  );
}

let hasApplied: boolean = false;

/*
 * Swap net-snmp's DES privacy implementation for the 3DES-EDE one above.
 *
 * The table entry is patched rather than Encryption.encryptPduDes, because
 * net-snmp copies the function references into
 * Encryption.algorithms[PrivProtocols.des] at module load — reassigning the
 * namespace function afterwards would have no effect. Dispatch reads the
 * table on every call, so patching it here takes effect immediately and
 * covers the session, receiver, agent and subagent paths at once.
 *
 * Idempotent: safe to call from every module that imports net-snmp.
 */
export function applySnmpDesPrivacyCompat(): boolean {
  if (hasApplied) {
    return true;
  }

  /*
   * If this build somehow lacks 3DES too there is nothing better to fall back
   * to, so leave net-snmp untouched and let its own error surface rather than
   * replacing it with a less recognisable one.
   */
  if (!isTripleDesCbcAvailable()) {
    logger.error(
      "SNMP DES privacy compatibility not installed: this Node build provides neither des-cbc nor des-ede3-cbc. SNMP v3 authPriv monitors using DES will fail.",
    );
    return false;
  }

  const desAlgorithm: {
    encryptPdu: typeof snmp.Encryption.encryptPduDes;
    decryptPdu: typeof snmp.Encryption.decryptPduDes;
  } = snmp.Encryption.algorithms[snmp.PrivProtocols.des];

  /*
   * The library's own type definitions describe the `engine` parameter as an
   * Algorithm; at runtime it is the authoritative engine record. Cast once,
   * here, so the implementations above keep honest signatures.
   */
  desAlgorithm.encryptPdu =
    encryptPduDes as unknown as typeof snmp.Encryption.encryptPduDes;
  desAlgorithm.decryptPdu =
    decryptPduDes as unknown as typeof snmp.Encryption.decryptPduDes;

  hasApplied = true;

  logger.debug(
    `SNMP DES privacy compatibility installed (des-ede3-cbc); native des-cbc available: ${isNativeDesCbcAvailable()}`,
  );

  return true;
}

/*
 * Applied on import so that merely pulling in net-snmp anywhere in the probe
 * is enough — there is no bootstrap ordering to get wrong, and tests that
 * import a monitor directly get the same behaviour as production.
 */
applySnmpDesPrivacyCompat();
