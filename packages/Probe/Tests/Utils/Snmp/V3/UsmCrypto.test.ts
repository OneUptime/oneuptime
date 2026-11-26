import UsmCrypto, {
  UsmDecryptionError,
  UsmPrivacyKey,
} from "../../../../Utils/Snmp/V3/UsmCrypto";
// Repairs net-snmp's DES on OpenSSL 3, so net-snmp can be the oracle for DES too.
import "../../../../Utils/Snmp/SnmpDesPrivacyCompat";
import SnmpAuthProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol from "Common/Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import { describe, expect, test } from "@jest/globals";
import snmp from "net-snmp";

/*
 * THE USER-BASED SECURITY MODEL'S CRYPTOGRAPHY, HELD TO THE RFC AND TO
 * NET-SNMP BYTE FOR BYTE.
 *
 * The trap receiver derives its keys itself (Ku once per user, Kul per
 * engine) instead of calling net-snmp's passwordToKey, which hashes a
 * megabyte again for every engine ID it meets and keeps every result -
 * on an open port, a forged datagram with a fresh engine ID each time
 * would cost a megabyte of hashing and memory that is never given back.
 * So the algorithm must be exactly net-snmp's - the poller authenticates
 * with net-snmp, a device with its own stack - and these tests hold it to:
 *
 *   - RFC 3414 appendix A.3's published keys for MD5 and SHA-1;
 *   - net-snmp's own Authentication and Encryption ("added for testing", as
 *     its exports say) for every protocol OneUptime's credentials name:
 *     MD5, SHA-1, SHA-256 and SHA-512 digests; DES, AES-128 and AES-256
 *     with the Blumenthal key extension (the poller's aes256b) - each way
 *     round: what net-snmp encrypts decrypts here, and what is encrypted
 *     here decrypts in net-snmp.
 */

const AUTH_PROTOCOLS: Array<[SnmpAuthProtocol, snmp.AuthProtocols]> = [
  [SnmpAuthProtocol.MD5, snmp.AuthProtocols.md5],
  [SnmpAuthProtocol.SHA, snmp.AuthProtocols.sha],
  [SnmpAuthProtocol.SHA256, snmp.AuthProtocols.sha256],
  [SnmpAuthProtocol.SHA512, snmp.AuthProtocols.sha512],
];

const PRIV_PROTOCOLS: Array<[SnmpPrivProtocol, snmp.PrivProtocols]> = [
  [SnmpPrivProtocol.DES, snmp.PrivProtocols.des],
  [SnmpPrivProtocol.AES, snmp.PrivProtocols.aes],
  [SnmpPrivProtocol.AES256, snmp.PrivProtocols.aes256b],
];

const ENGINE_IDS: Array<Buffer> = [
  Buffer.from("000000000000000000000002", "hex"),
  Buffer.from("80001F8880E9B104617361000000", "hex"),
  Buffer.from("8000B98380A1B2C3D4E5F60718293A4B", "hex"),
];

// net-snmp's typings call the engine record an Algorithm; at runtime it is the engine.
type NetSnmpEngine = Parameters<typeof snmp.Encryption.encryptPduAes>[4];

function asNetSnmpEngine(engine: {
  engineID: Buffer;
  engineBoots: number;
  engineTime: number;
}): NetSnmpEngine {
  return engine as unknown as NetSnmpEngine;
}

type NetSnmpPrivacyAlgorithm =
  (typeof snmp.Encryption.algorithms)[keyof typeof snmp.Encryption.algorithms];

// net-snmp keys its privacy algorithms by protocol, and has none for "none".
function getNetSnmpPrivacyAlgorithm(
  protocol: snmp.PrivProtocols,
): NetSnmpPrivacyAlgorithm {
  const algorithms: Partial<
    Record<snmp.PrivProtocols, NetSnmpPrivacyAlgorithm>
  > = snmp.Encryption.algorithms;
  const algorithm: NetSnmpPrivacyAlgorithm | undefined = algorithms[protocol];

  if (!algorithm) {
    throw new Error(`net-snmp has no privacy algorithm for ${protocol}`);
  }

  return algorithm;
}

const SCOPED_PDU: Buffer = Buffer.from(
  "3027040b8000b98380a1b2c3d4e5f60400a716020429e2c3b50201000201003008300606022b060500",
  "hex",
);

describe("RFC 3414 appendix A.3: password to key", () => {
  const engineId: Buffer = Buffer.from("000000000000000000000002", "hex");

  test("MD5: Ku and Kul for 'maplesyrup'", () => {
    const ku: Buffer = UsmCrypto.passwordToKu(
      SnmpAuthProtocol.MD5,
      "maplesyrup",
    );

    expect(ku.toString("hex")).toBe("9faf3283884e92834ebc9847d8edd963");
    expect(
      UsmCrypto.localizeKey(SnmpAuthProtocol.MD5, ku, engineId).toString("hex"),
    ).toBe("526f5eed9fcce26f8964c2930787d82b");
  });

  test("SHA-1: Ku and Kul for 'maplesyrup'", () => {
    const ku: Buffer = UsmCrypto.passwordToKu(
      SnmpAuthProtocol.SHA,
      "maplesyrup",
    );

    expect(ku.toString("hex")).toBe("9fb5cc0381497b3793528939ff788d5d79145211");
    expect(
      UsmCrypto.localizeKey(SnmpAuthProtocol.SHA, ku, engineId).toString("hex"),
    ).toBe("6695febc9288e36282235fc7151f128497b38f3f");
  });
});

describe("keys are net-snmp's, for every protocol and engine", () => {
  for (const [protocol, netSnmpProtocol] of AUTH_PROTOCOLS) {
    for (const engineId of ENGINE_IDS) {
      test(`${protocol}, engine ${engineId.toString("hex")}`, () => {
        const passphrase: string = "a fabric's passphrase";

        expect(
          UsmCrypto.localizeKey(
            protocol,
            UsmCrypto.passwordToKu(protocol, passphrase),
            engineId,
          ).equals(
            snmp.Authentication.passwordToKey(
              netSnmpProtocol as Exclude<
                snmp.AuthProtocols,
                snmp.AuthProtocols.none
              >,
              passphrase,
              engineId,
            ),
          ),
        ).toBe(true);
      });
    }
  }

  test("a passphrase in more than ASCII is its UTF-8 octets, as net-snmp reads it", () => {
    const passphrase: string = "Pässwört-日本語-🔐";
    const engineId: Buffer = ENGINE_IDS[1]!;

    expect(
      UsmCrypto.localizeKey(
        SnmpAuthProtocol.SHA256,
        UsmCrypto.passwordToKu(SnmpAuthProtocol.SHA256, passphrase),
        engineId,
      ).equals(
        snmp.Authentication.passwordToKey(
          snmp.AuthProtocols.sha256,
          passphrase,
          engineId,
        ),
      ),
    ).toBe(true);
  });

  test("passphrases whose length does not divide a megabyte repeat across chunks unbroken", () => {
    for (const passphrase of [
      "seven77",
      "ninechars",
      "x".repeat(1000),
      "a".repeat(65537),
    ]) {
      expect(
        UsmCrypto.localizeKey(
          SnmpAuthProtocol.MD5,
          UsmCrypto.passwordToKu(SnmpAuthProtocol.MD5, passphrase),
          ENGINE_IDS[0]!,
        ).equals(
          snmp.Authentication.passwordToKey(
            snmp.AuthProtocols.md5,
            passphrase,
            ENGINE_IDS[0]!,
          ),
        ),
      ).toBe(true);
    }
  });

  test("an empty passphrase is no key", () => {
    expect(() => {
      UsmCrypto.passwordToKu(SnmpAuthProtocol.SHA, "");
    }).toThrow();
  });
});

describe("digests", () => {
  const message: Buffer = Buffer.concat([
    Buffer.from("3081", "hex"),
    Buffer.alloc(120, 0x5a),
  ]);

  for (const [protocol, netSnmpProtocol] of AUTH_PROTOCOLS) {
    test(`${protocol}: the digest net-snmp computes, at the length the message carries`, () => {
      const engineId: Buffer = ENGINE_IDS[2]!;
      const passphrase: string = "digest passphrase";
      const key: Buffer = UsmCrypto.localizeKey(
        protocol,
        UsmCrypto.passwordToKu(protocol, passphrase),
        engineId,
      );

      const mac: Buffer = UsmCrypto.computeMac(protocol, key, message);

      expect(mac.length).toBe(UsmCrypto.getMacLength(protocol));
      expect(
        mac.equals(
          snmp.Authentication.calculateDigest(
            message,
            netSnmpProtocol as Exclude<
              snmp.AuthProtocols,
              snmp.AuthProtocols.none
            >,
            passphrase,
            engineId,
          ),
        ),
      ).toBe(true);
    });
  }

  test("RFC 3414 and RFC 7860's digest lengths", () => {
    expect(UsmCrypto.getMacLength(SnmpAuthProtocol.MD5)).toBe(12);
    expect(UsmCrypto.getMacLength(SnmpAuthProtocol.SHA)).toBe(12);
    expect(UsmCrypto.getMacLength(SnmpAuthProtocol.SHA256)).toBe(24);
    expect(UsmCrypto.getMacLength(SnmpAuthProtocol.SHA512)).toBe(48);
  });

  describe("isAuthentic", () => {
    const protocol: SnmpAuthProtocol = SnmpAuthProtocol.SHA256;
    const key: Buffer = UsmCrypto.localizeKey(
      protocol,
      UsmCrypto.passwordToKu(protocol, "the right passphrase"),
      ENGINE_IDS[1]!,
    );
    const macOffset: number = 40;

    function signed(): Buffer {
      const copy: Buffer = Buffer.from(message);
      copy.fill(0, macOffset, macOffset + 24);
      UsmCrypto.computeMac(protocol, key, copy).copy(copy, macOffset);
      return copy;
    }

    test("a message signed with the key is authentic, and is left as it was", () => {
      const datagram: Buffer = signed();
      const before: Buffer = Buffer.from(datagram);

      expect(
        UsmCrypto.isAuthentic({
          protocol: protocol,
          localizedAuthKey: key,
          message: datagram,
          macOffset: macOffset,
          mac: datagram.subarray(macOffset, macOffset + 24),
        }),
      ).toBe(true);
      expect(datagram.equals(before)).toBe(true);
    });

    test("one bit changed anywhere is not", () => {
      const datagram: Buffer = signed();
      datagram[100] = datagram[100]! ^ 0x01;

      expect(
        UsmCrypto.isAuthentic({
          protocol: protocol,
          localizedAuthKey: key,
          message: datagram,
          macOffset: macOffset,
          mac: datagram.subarray(macOffset, macOffset + 24),
        }),
      ).toBe(false);
    });

    test("another key is not", () => {
      const datagram: Buffer = signed();
      const otherKey: Buffer = UsmCrypto.localizeKey(
        protocol,
        UsmCrypto.passwordToKu(protocol, "the wrong passphrase"),
        ENGINE_IDS[1]!,
      );

      expect(
        UsmCrypto.isAuthentic({
          protocol: protocol,
          localizedAuthKey: otherKey,
          message: datagram,
          macOffset: macOffset,
          mac: datagram.subarray(macOffset, macOffset + 24),
        }),
      ).toBe(false);
    });

    test("the same key localized to another engine is not", () => {
      const datagram: Buffer = signed();
      const elsewhere: Buffer = UsmCrypto.localizeKey(
        protocol,
        UsmCrypto.passwordToKu(protocol, "the right passphrase"),
        ENGINE_IDS[2]!,
      );

      expect(
        UsmCrypto.isAuthentic({
          protocol: protocol,
          localizedAuthKey: elsewhere,
          message: datagram,
          macOffset: macOffset,
          mac: datagram.subarray(macOffset, macOffset + 24),
        }),
      ).toBe(false);
    });

    test("a digest of the wrong length, or where the message has none, is not", () => {
      const datagram: Buffer = signed();

      expect(
        UsmCrypto.isAuthentic({
          protocol: protocol,
          localizedAuthKey: key,
          message: datagram,
          macOffset: macOffset,
          mac: datagram.subarray(macOffset, macOffset + 12),
        }),
      ).toBe(false);

      expect(
        UsmCrypto.isAuthentic({
          protocol: protocol,
          localizedAuthKey: key,
          message: datagram,
          macOffset: datagram.length - 4,
          mac: Buffer.alloc(24),
        }),
      ).toBe(false);
    });
  });
});

describe("privacy", () => {
  for (const [authProtocol, netSnmpAuth] of AUTH_PROTOCOLS) {
    for (const [privProtocol, netSnmpPriv] of PRIV_PROTOCOLS) {
      describe(`${authProtocol} / ${privProtocol}`, () => {
        const engine: {
          engineID: Buffer;
          engineBoots: number;
          engineTime: number;
        } = {
          engineID: ENGINE_IDS[1]!,
          engineBoots: 7,
          engineTime: 123456,
        };
        const privPassphrase: string = `privacy for ${authProtocol}`;
        const privacyKey: UsmPrivacyKey = UsmCrypto.localizePrivacyKey({
          authProtocol: authProtocol,
          privProtocol: privProtocol,
          privKu: UsmCrypto.passwordToKu(authProtocol, privPassphrase),
          engineId: engine.engineID,
        });

        test("what net-snmp encrypts decrypts here", () => {
          const encrypted: {
            encryptedPdu: Buffer;
            msgPrivacyParameters: Buffer;
          } = getNetSnmpPrivacyAlgorithm(netSnmpPriv).encryptPdu(
            SCOPED_PDU,
            netSnmpPriv,
            privPassphrase,
            netSnmpAuth,
            asNetSnmpEngine(engine),
          );

          const decrypted: Buffer = UsmCrypto.decrypt({
            privacyKey: privacyKey,
            privParameters: encrypted.msgPrivacyParameters,
            engineBoots: engine.engineBoots,
            engineTime: engine.engineTime,
            encrypted: encrypted.encryptedPdu,
          });

          expect(
            decrypted.subarray(0, SCOPED_PDU.length).equals(SCOPED_PDU),
          ).toBe(true);
        });

        test("what is encrypted here decrypts in net-snmp", () => {
          const salt: Buffer = Buffer.from("0102030405060708", "hex");
          const encrypted: { encrypted: Buffer; privParameters: Buffer } =
            UsmCrypto.encrypt({
              privacyKey: privacyKey,
              engineBoots: engine.engineBoots,
              engineTime: engine.engineTime,
              salt: salt,
              scopedPdu: SCOPED_PDU,
            });

          const decrypted: Buffer = getNetSnmpPrivacyAlgorithm(
            netSnmpPriv,
          ).decryptPdu(
            encrypted.encrypted,
            netSnmpPriv,
            encrypted.privParameters,
            privPassphrase,
            netSnmpAuth,
            asNetSnmpEngine(engine),
          );

          expect(
            decrypted.subarray(0, SCOPED_PDU.length).equals(SCOPED_PDU),
          ).toBe(true);
        });
      });
    }
  }

  test("AES-256's key is extended the Blumenthal way for MD5 and SHA-1, as net-snmp's aes256b", () => {
    for (const [authProtocol, netSnmpAuth] of AUTH_PROTOCOLS) {
      const passphrase: string = "short key, long cipher";
      const engineId: Buffer = ENGINE_IDS[0]!;

      expect(
        UsmCrypto.localizePrivacyKey({
          authProtocol: authProtocol,
          privProtocol: SnmpPrivProtocol.AES256,
          privKu: UsmCrypto.passwordToKu(authProtocol, passphrase),
          engineId: engineId,
        }).key.equals(
          snmp.Encryption.generateLocalizedKeyBlumenthal(
            snmp.Encryption.algorithms[
              snmp.PrivProtocols.aes256b
            ] as unknown as Parameters<
              typeof snmp.Encryption.generateLocalizedKeyBlumenthal
            >[0],
            netSnmpAuth,
            passphrase,
            engineId,
          ),
        ),
      ).toBe(true);
    }
  });

  test("a DES salt carries the engine's boots in its high half (RFC 3414 section 8.1.1.1)", () => {
    const privacyKey: UsmPrivacyKey = UsmCrypto.localizePrivacyKey({
      authProtocol: SnmpAuthProtocol.SHA,
      privProtocol: SnmpPrivProtocol.DES,
      privKu: UsmCrypto.passwordToKu(SnmpAuthProtocol.SHA, "des-passphrase"),
      engineId: ENGINE_IDS[0]!,
    });

    const encrypted: { encrypted: Buffer; privParameters: Buffer } =
      UsmCrypto.encrypt({
        privacyKey: privacyKey,
        engineBoots: 0x0102,
        engineTime: 5,
        salt: Buffer.from("ffffffff0a0b0c0d", "hex"),
        scopedPdu: SCOPED_PDU,
      });

    expect(encrypted.privParameters.toString("hex")).toBe("000001020a0b0c0d");
    expect(encrypted.encrypted.length % 8).toBe(0);
  });

  describe("what cannot have been encrypted for this key is a decryption error", () => {
    const desKey: UsmPrivacyKey = UsmCrypto.localizePrivacyKey({
      authProtocol: SnmpAuthProtocol.SHA,
      privProtocol: SnmpPrivProtocol.DES,
      privKu: UsmCrypto.passwordToKu(SnmpAuthProtocol.SHA, "des-passphrase"),
      engineId: ENGINE_IDS[0]!,
    });
    const aesKey: UsmPrivacyKey = UsmCrypto.localizePrivacyKey({
      authProtocol: SnmpAuthProtocol.SHA,
      privProtocol: SnmpPrivProtocol.AES,
      privKu: UsmCrypto.passwordToKu(SnmpAuthProtocol.SHA, "aes-passphrase"),
      engineId: ENGINE_IDS[0]!,
    });

    test("DES ciphertext that is not whole blocks", () => {
      expect(() => {
        UsmCrypto.decrypt({
          privacyKey: desKey,
          privParameters: Buffer.alloc(8),
          engineBoots: 1,
          engineTime: 1,
          encrypted: Buffer.alloc(13),
        });
      }).toThrow(UsmDecryptionError);
    });

    test("a DES salt that is not 8 octets", () => {
      expect(() => {
        UsmCrypto.decrypt({
          privacyKey: desKey,
          privParameters: Buffer.alloc(4),
          engineBoots: 1,
          engineTime: 1,
          encrypted: Buffer.alloc(16),
        });
      }).toThrow(UsmDecryptionError);
    });

    test("an AES salt that is not 8 octets", () => {
      expect(() => {
        UsmCrypto.decrypt({
          privacyKey: aesKey,
          privParameters: Buffer.alloc(0),
          engineBoots: 1,
          engineTime: 1,
          encrypted: Buffer.alloc(16),
        });
      }).toThrow(UsmDecryptionError);
    });

    test("no ciphertext at all", () => {
      expect(() => {
        UsmCrypto.decrypt({
          privacyKey: desKey,
          privParameters: Buffer.alloc(8),
          engineBoots: 1,
          engineTime: 1,
          encrypted: Buffer.alloc(0),
        });
      }).toThrow(UsmDecryptionError);
    });
  });
});
