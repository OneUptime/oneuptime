// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { afterEach, describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import snmp from "net-snmp";
import {
  applySnmpDesPrivacyCompat,
  decryptPduDes,
  deriveDesKeyMaterial,
  desCbcDecrypt,
  desCbcEncrypt,
  encryptPduDes,
  generateDesSalt,
  isNativeDesCbcAvailable,
  isTripleDesCbcAvailable,
  padScopedPduForDes,
  SnmpAuthoritativeEngine,
  SnmpDesEncryptResult,
  xorDesBlock,
} from "../../../Utils/Snmp/SnmpDesPrivacyCompat";

/*
 * Known-answer vectors produced by genuine single DES-CBC (OpenSSL's legacy
 * provider, which still implements it). They are hard-coded rather than
 * computed at run time precisely because the default provider no longer
 * offers des-cbc — these are the ground truth this module must reproduce, and
 * the bytes a real DES-speaking device will decrypt.
 *
 * zero_key and all_ones are the classic published DES test vectors, so a
 * regression in the 3DES-EDE substitution shows up against public data and
 * not just against our own output.
 */
const DES_CBC_VECTORS: Array<{
  name: string;
  key: string;
  iv: string;
  plaintext: string;
  ciphertext: string;
}> = [
  {
    name: "single block, zero IV",
    key: "0123456789abcdef",
    iv: "0000000000000000",
    plaintext: "4e6f772069732074",
    ciphertext: "3fa40e8a984d4815",
  },
  {
    name: "single block, non-zero IV",
    key: "0123456789abcdef",
    iv: "fedcba9876543210",
    plaintext: "4e6f772069732074",
    ciphertext: "7f81654121dbd4cf",
  },
  {
    name: "five blocks, chained",
    key: "0123456789abcdef",
    iv: "fedcba9876543210",
    plaintext:
      "54686520717569636b2062726f776e20666f78206a756d7073206f76657220740a0a0a0a0a0a0a0a",
    ciphertext:
      "20b73ff3c7621e1dd3f7ac8b55170a5cedb5b6487538784b3d4cd3f25a35027a8703dcdd38a91870",
  },
  {
    name: "all-zero key and plaintext",
    key: "0000000000000000",
    iv: "0000000000000000",
    plaintext: "0000000000000000",
    ciphertext: "8ca64de9c1b123a7",
  },
  {
    name: "all-ones key, IV and plaintext",
    key: "ffffffffffffffff",
    iv: "ffffffffffffffff",
    plaintext: "ffffffffffffffff",
    ciphertext: "caaaaf4deaf1dbae",
  },
  {
    name: "scoped-PDU shaped payload",
    key: "8899aabbccddeeff",
    iv: "1122334455667788",
    plaintext:
      "302206072b06010201010002012a040841424344454647480201000201000000",
    ciphertext:
      "055934d00f40fdc22e83fe0824a47f669a414b206ced745f77bdfd64ddf1bfa4",
  },
];

const ENGINE_ID: Buffer = Buffer.from("8000000001020304050607", "hex");
const OTHER_ENGINE_ID: Buffer = Buffer.from("80000000aabbccddeeff00", "hex");

/*
 * net-snmp's shipped type definitions omit the encryptPdu/decryptPdu
 * dispatchers even though the library exports them and routes all v3 privacy
 * through them. This seam gives them their real runtime signatures — engine
 * is the authoritative engine record, not the Algorithm the types claim —
 * so the tests can exercise the library's own entry points.
 */
type SnmpEncryptionDispatch = {
  encryptPdu: (
    privProtocol: snmp.PrivProtocols,
    scopedPdu: Buffer,
    privPassword: string,
    authProtocol: snmp.AuthProtocols,
    engine: SnmpAuthoritativeEngine,
  ) => SnmpDesEncryptResult;
  decryptPdu: (
    privProtocol: snmp.PrivProtocols,
    encryptedPdu: Buffer,
    privParameters: Buffer,
    privPassword: string,
    authProtocol: snmp.AuthProtocols,
    engine: SnmpAuthoritativeEngine,
  ) => Buffer;
};

const EncryptionDispatch: SnmpEncryptionDispatch =
  snmp.Encryption as unknown as SnmpEncryptionDispatch;

function buildEngine(engineId: Buffer = ENGINE_ID): SnmpAuthoritativeEngine {
  return { engineID: engineId };
}

/*
 * A BER-shaped stand-in for a scoped PDU. Content does not matter to the
 * cipher, but keeping it self-delimiting mirrors what really gets encrypted.
 */
function buildScopedPdu(length: number): Buffer {
  const scopedPdu: Buffer = Buffer.alloc(length);
  for (let index: number = 0; index < length; index++) {
    scopedPdu[index] = (index * 7 + 0x30) % 256;
  }
  return scopedPdu;
}

function desAlgorithmEntry(): {
  encryptPdu: typeof snmp.Encryption.encryptPduDes;
  decryptPdu: typeof snmp.Encryption.decryptPduDes;
  CRYPTO_ALGORITHM: string;
  KEY_LENGTH: number;
  BLOCK_LENGTH: number;
} {
  return snmp.Encryption.algorithms[snmp.PrivProtocols.des];
}

/*
 * Restores the module's implementations into net-snmp's dispatch table. Tests
 * that deliberately reinstate the library's broken originals use this to put
 * things back, rather than exporting a reset hook from production code.
 */
function reinstateCompat(): void {
  desAlgorithmEntry().encryptPdu =
    encryptPduDes as unknown as typeof snmp.Encryption.encryptPduDes;
  desAlgorithmEntry().decryptPdu =
    decryptPduDes as unknown as typeof snmp.Encryption.decryptPduDes;
}

describe("SnmpDesPrivacyCompat — the OpenSSL 3 regression being fixed", () => {
  /*
   * The customer-visible symptom. net-snmp asks OpenSSL for "des-cbc", which
   * OpenSSL 3 moved into the legacy provider and Node does not load by
   * default, so every SNMP v3 authPriv poll of a DES device fails with
   * error:0308010C before a packet is sent. This test pins the environment
   * that makes the fix necessary; on an older OpenSSL that still offers
   * des-cbc it asserts the opposite, so it stays meaningful either way.
   */
  test("single des-cbc is unavailable on OpenSSL 3, which is what broke DES privacy", () => {
    const nativeAvailable: boolean = isNativeDesCbcAvailable();

    if (nativeAvailable) {
      expect(() => {
        return crypto.createCipheriv(
          "des-cbc",
          Buffer.alloc(8),
          Buffer.alloc(8),
        );
      }).not.toThrow();
      return;
    }

    expect(() => {
      return crypto.createCipheriv("des-cbc", Buffer.alloc(8), Buffer.alloc(8));
    }).toThrow(/unsupported|not supported|Unknown cipher/i);
  });

  // The primitive the fix is built on has to actually be there.
  test("des-ede3-cbc is available and is what the compat layer relies on", () => {
    expect(isTripleDesCbcAvailable()).toBe(true);
  });

  /*
   * The heart of the fix: net-snmp's own DES functions are put back into the
   * dispatch table and shown to fail exactly the way the customer's probe
   * did, then the compat implementations are restored and the same call
   * succeeds. Without this, a future refactor could quietly stop patching and
   * every other test here would still pass.
   */
  test("net-snmp's original DES implementation fails where the compat one succeeds", () => {
    const scopedPdu: Buffer = buildScopedPdu(32);
    const engine: SnmpAuthoritativeEngine = buildEngine();

    const encryptThroughTable: () => unknown = () => {
      return desAlgorithmEntry().encryptPdu(
        scopedPdu,
        snmp.PrivProtocols.des,
        "priv-passphrase-1234",
        snmp.AuthProtocols.sha,
        engine as never,
      );
    };

    try {
      desAlgorithmEntry().encryptPdu = snmp.Encryption.encryptPduDes;

      if (isNativeDesCbcAvailable()) {
        // Old OpenSSL: the original works, and must agree with ours.
        expect(encryptThroughTable).not.toThrow();
      } else {
        expect(encryptThroughTable).toThrow(
          /unsupported|not supported|Unknown cipher/i,
        );
      }
    } finally {
      reinstateCompat();
    }

    expect(encryptThroughTable).not.toThrow();
  });
});

describe("SnmpDesPrivacyCompat.desCbcEncrypt — equivalence with genuine DES", () => {
  test.each(
    DES_CBC_VECTORS.map(
      (vector: {
        name: string;
        key: string;
        iv: string;
        plaintext: string;
        ciphertext: string;
      }) => {
        return [vector.name, vector] as const;
      },
    ),
  )(
    "reproduces real DES-CBC ciphertext for %s",
    (
      _name: string,
      vector: {
        key: string;
        iv: string;
        plaintext: string;
        ciphertext: string;
      },
    ) => {
      const encrypted: Buffer = desCbcEncrypt(
        Buffer.from(vector.key, "hex"),
        Buffer.from(vector.iv, "hex"),
        Buffer.from(vector.plaintext, "hex"),
        false,
      );

      expect(encrypted.toString("hex")).toBe(vector.ciphertext);
    },
  );

  test.each(
    DES_CBC_VECTORS.map(
      (vector: {
        name: string;
        key: string;
        iv: string;
        plaintext: string;
        ciphertext: string;
      }) => {
        return [vector.name, vector] as const;
      },
    ),
  )(
    "decrypts real DES-CBC ciphertext for %s",
    (
      _name: string,
      vector: {
        key: string;
        iv: string;
        plaintext: string;
        ciphertext: string;
      },
    ) => {
      const decrypted: Buffer = desCbcDecrypt(
        Buffer.from(vector.key, "hex"),
        Buffer.from(vector.iv, "hex"),
        Buffer.from(vector.ciphertext, "hex"),
        false,
      );

      expect(decrypted.toString("hex")).toBe(vector.plaintext);
    },
  );

  /*
   * When the runtime still has real single DES, hold the substitution to the
   * strictest possible standard: byte-identical output from both primitives
   * over random inputs. Skipped rather than failed on OpenSSL 3, where the
   * comparison cannot be made.
   */
  test("agrees byte for byte with native des-cbc when the runtime still has it", () => {
    if (!isNativeDesCbcAvailable()) {
      expect(isTripleDesCbcAvailable()).toBe(true);
      return;
    }

    for (let iteration: number = 0; iteration < 50; iteration++) {
      const key: Buffer = crypto.randomBytes(8);
      const iv: Buffer = crypto.randomBytes(8);
      const plaintext: Buffer = crypto.randomBytes(8 * (1 + (iteration % 6)));

      const native: crypto.Cipheriv = crypto.createCipheriv("des-cbc", key, iv);
      native.setAutoPadding(false);
      const expected: Buffer = Buffer.concat([
        native.update(plaintext),
        native.final(),
      ]);

      expect(desCbcEncrypt(key, iv, plaintext, false).toString("hex")).toBe(
        expected.toString("hex"),
      );
    }
  });

  test("round-trips arbitrary block-aligned payloads", () => {
    const key: Buffer = Buffer.from("0f1e2d3c4b5a6978", "hex");
    const iv: Buffer = Buffer.from("1122334455667788", "hex");

    for (let blocks: number = 1; blocks <= 16; blocks++) {
      const plaintext: Buffer = crypto.randomBytes(blocks * 8);
      const encrypted: Buffer = desCbcEncrypt(key, iv, plaintext, false);

      expect(encrypted.length).toBe(plaintext.length);
      expect(desCbcDecrypt(key, iv, encrypted, false).toString("hex")).toBe(
        plaintext.toString("hex"),
      );
    }
  });

  /*
   * CBC must chain: a change confined to the first block has to propagate to
   * every later block. If the substitution had degenerated into ECB this is
   * the test that would catch it.
   */
  test("chains blocks so an early change propagates through the ciphertext", () => {
    const key: Buffer = Buffer.from("0123456789abcdef", "hex");
    const iv: Buffer = Buffer.from("0000000000000000", "hex");
    const first: Buffer = Buffer.alloc(32, 0x41);
    const second: Buffer = Buffer.alloc(32, 0x41);
    second[0] = 0x42;

    const encryptedFirst: Buffer = desCbcEncrypt(key, iv, first, false);
    const encryptedSecond: Buffer = desCbcEncrypt(key, iv, second, false);

    expect(encryptedFirst.subarray(0, 8).toString("hex")).not.toBe(
      encryptedSecond.subarray(0, 8).toString("hex"),
    );
    expect(encryptedFirst.subarray(24, 32).toString("hex")).not.toBe(
      encryptedSecond.subarray(24, 32).toString("hex"),
    );
  });

  test("identical plaintext blocks encrypt differently, proving CBC not ECB", () => {
    const key: Buffer = Buffer.from("0123456789abcdef", "hex");
    const iv: Buffer = Buffer.from("1122334455667788", "hex");
    const plaintext: Buffer = Buffer.alloc(16, 0x5a);

    const encrypted: Buffer = desCbcEncrypt(key, iv, plaintext, false);

    expect(encrypted.subarray(0, 8).toString("hex")).not.toBe(
      encrypted.subarray(8, 16).toString("hex"),
    );
  });

  test("the IV changes the ciphertext", () => {
    const key: Buffer = Buffer.from("0123456789abcdef", "hex");
    const plaintext: Buffer = Buffer.alloc(8, 0x11);

    const withOneIv: Buffer = desCbcEncrypt(
      key,
      Buffer.from("0000000000000000", "hex"),
      plaintext,
      false,
    );
    const withAnotherIv: Buffer = desCbcEncrypt(
      key,
      Buffer.from("0000000000000001", "hex"),
      plaintext,
      false,
    );

    expect(withOneIv.toString("hex")).not.toBe(withAnotherIv.toString("hex"));
  });

  test("the key changes the ciphertext", () => {
    const iv: Buffer = Buffer.from("0000000000000000", "hex");
    const plaintext: Buffer = Buffer.alloc(8, 0x11);

    expect(
      desCbcEncrypt(
        Buffer.from("0123456789abcdef", "hex"),
        iv,
        plaintext,
        false,
      ).toString("hex"),
    ).not.toBe(
      desCbcEncrypt(
        // Differs in bit 1 of the first octet, which DES actually uses.
        Buffer.from("0323456789abcdef", "hex"),
        iv,
        plaintext,
        false,
      ).toString("hex"),
    );
  });

  /*
   * DES uses only 56 of the 64 key bits; the low bit of each octet is a parity
   * bit the algorithm discards. Two keys differing only there are the same key
   * and must encrypt identically. Beyond documenting a genuine surprise for
   * anyone debugging a key mismatch here, this is a sharp check on the
   * substitution: a cipher that is not really DES would almost certainly let
   * those bits change the output.
   */
  test("ignores key parity bits, exactly as real DES does", () => {
    const iv: Buffer = Buffer.from("1122334455667788", "hex");
    const plaintext: Buffer = Buffer.alloc(16, 0x11);

    const evenParity: Buffer = Buffer.from("0123456789abcdef", "hex");
    // Every octet's low bit flipped; all 56 effective key bits unchanged.
    const flippedParity: Buffer = Buffer.from("0022446688aaccee", "hex");

    expect(
      desCbcEncrypt(evenParity, iv, plaintext, false).toString("hex"),
    ).toBe(desCbcEncrypt(flippedParity, iv, plaintext, false).toString("hex"));
  });

  /*
   * With padding on, OpenSSL appends a whole extra PKCS#7 block to an already
   * aligned input. net-snmp has always sent that extra block, so it is
   * preserved deliberately — this pins the size contract.
   */
  test("automatic padding appends exactly one extra block to aligned input", () => {
    const key: Buffer = Buffer.from("0123456789abcdef", "hex");
    const iv: Buffer = Buffer.from("1122334455667788", "hex");

    const encrypted: Buffer = desCbcEncrypt(key, iv, Buffer.alloc(16), true);

    expect(encrypted.length).toBe(24);
  });
});

describe("SnmpDesPrivacyCompat.deriveDesKeyMaterial", () => {
  test("produces an 8-octet key and an 8-octet pre-IV", () => {
    const material: { encryptionKey: Buffer; preIv: Buffer } =
      deriveDesKeyMaterial(
        "priv-passphrase",
        snmp.AuthProtocols.sha,
        ENGINE_ID,
      );

    expect(material.encryptionKey.length).toBe(8);
    expect(material.preIv.length).toBe(8);
  });

  /*
   * RFC 3414: the DES key is the first 8 octets of the localized key and the
   * pre-IV the next 8. Recomputed here from net-snmp's own passwordToKey so
   * the assertion is against the library's derivation, not a restatement of
   * our slicing.
   */
  test("slices net-snmp's own localized key exactly as RFC 3414 prescribes", () => {
    const localized: Buffer = snmp.Authentication.passwordToKey(
      snmp.AuthProtocols.sha,
      "priv-passphrase",
      ENGINE_ID,
    );

    const material: { encryptionKey: Buffer; preIv: Buffer } =
      deriveDesKeyMaterial(
        "priv-passphrase",
        snmp.AuthProtocols.sha,
        ENGINE_ID,
      );

    expect(material.encryptionKey.toString("hex")).toBe(
      localized.subarray(0, 8).toString("hex"),
    );
    expect(material.preIv.toString("hex")).toBe(
      localized.subarray(8, 16).toString("hex"),
    );
  });

  // Localization to the authoritative engine is what stops key reuse.
  test("localizes to the engine, so a different engine yields different material", () => {
    const first: { encryptionKey: Buffer; preIv: Buffer } =
      deriveDesKeyMaterial(
        "priv-passphrase",
        snmp.AuthProtocols.sha,
        ENGINE_ID,
      );
    const second: { encryptionKey: Buffer; preIv: Buffer } =
      deriveDesKeyMaterial(
        "priv-passphrase",
        snmp.AuthProtocols.sha,
        OTHER_ENGINE_ID,
      );

    expect(first.encryptionKey.toString("hex")).not.toBe(
      second.encryptionKey.toString("hex"),
    );
    expect(first.preIv.toString("hex")).not.toBe(second.preIv.toString("hex"));
  });

  test("a different passphrase yields different key material", () => {
    expect(
      deriveDesKeyMaterial(
        "priv-passphrase-a",
        snmp.AuthProtocols.sha,
        ENGINE_ID,
      ).encryptionKey.toString("hex"),
    ).not.toBe(
      deriveDesKeyMaterial(
        "priv-passphrase-b",
        snmp.AuthProtocols.sha,
        ENGINE_ID,
      ).encryptionKey.toString("hex"),
    );
  });

  /*
   * The privacy key is localized with the *auth* protocol's hash, so the
   * device's configured auth protocol changes the DES key. The customer's
   * device uses SHA; MD5, SHA256 and SHA512 must work too.
   */
  test.each([
    ["md5", snmp.AuthProtocols.md5],
    ["sha", snmp.AuthProtocols.sha],
    ["sha256", snmp.AuthProtocols.sha256],
    ["sha512", snmp.AuthProtocols.sha512],
  ])(
    "derives usable key material under the %s auth protocol",
    (_label: string, authProtocol: snmp.AuthProtocols) => {
      const material: { encryptionKey: Buffer; preIv: Buffer } =
        deriveDesKeyMaterial("priv-passphrase", authProtocol, ENGINE_ID);

      expect(material.encryptionKey.length).toBe(8);
      expect(material.preIv.length).toBe(8);
      expect(material.encryptionKey.toString("hex")).not.toBe(
        "0000000000000000",
      );
    },
  );

  test("different auth protocols localize to different DES keys", () => {
    const withMd5: string = deriveDesKeyMaterial(
      "priv-passphrase",
      snmp.AuthProtocols.md5,
      ENGINE_ID,
    ).encryptionKey.toString("hex");
    const withSha: string = deriveDesKeyMaterial(
      "priv-passphrase",
      snmp.AuthProtocols.sha,
      ENGINE_ID,
    ).encryptionKey.toString("hex");

    expect(withMd5).not.toBe(withSha);
  });
});

describe("SnmpDesPrivacyCompat.generateDesSalt", () => {
  test("is 8 octets with engine boots pinned to 1 in the high half", () => {
    const salt: Buffer = generateDesSalt();

    expect(salt.length).toBe(8);
    expect(salt.subarray(0, 4).toString("hex")).toBe("00000001");
  });

  /*
   * The low half must vary per message: a repeated salt means a repeated IV
   * under the same key, which leaks plaintext relationships.
   */
  test("randomises the low half so the IV never repeats across messages", () => {
    const seen: Set<string> = new Set<string>();

    for (let index: number = 0; index < 200; index++) {
      seen.add(generateDesSalt().subarray(4, 8).toString("hex"));
    }

    expect(seen.size).toBeGreaterThan(190);
  });
});

describe("SnmpDesPrivacyCompat.padScopedPduForDes", () => {
  test("passes block-aligned input through untouched", () => {
    const scopedPdu: Buffer = buildScopedPdu(24);
    const padded: Buffer = padScopedPduForDes(scopedPdu);

    expect(padded.length).toBe(24);
    expect(padded.toString("hex")).toBe(scopedPdu.toString("hex"));
  });

  test.each([
    [1, 8],
    [7, 8],
    [8, 8],
    [9, 16],
    [15, 16],
    [16, 16],
    [17, 24],
    [31, 32],
    [33, 40],
  ])(
    "pads a %i octet PDU up to %i octets",
    (inputLength: number, expectedLength: number) => {
      expect(padScopedPduForDes(buildScopedPdu(inputLength)).length).toBe(
        expectedLength,
      );
    },
  );

  test("preserves the original octets and zero-fills the remainder", () => {
    const scopedPdu: Buffer = buildScopedPdu(11);
    const padded: Buffer = padScopedPduForDes(scopedPdu);

    expect(padded.length).toBe(16);
    expect(padded.subarray(0, 11).toString("hex")).toBe(
      scopedPdu.toString("hex"),
    );
    expect(padded.subarray(11).toString("hex")).toBe("0000000000");
  });

  test("an empty PDU is already aligned and stays empty", () => {
    expect(padScopedPduForDes(Buffer.alloc(0)).length).toBe(0);
  });
});

describe("SnmpDesPrivacyCompat.xorDesBlock", () => {
  test("XORs two blocks octet by octet", () => {
    expect(
      xorDesBlock(
        Buffer.from("00ff0ff0aa553311", "hex"),
        Buffer.from("ff00f00f55aa3311", "hex"),
      ).toString("hex"),
    ).toBe("ffffffffffff0000");
  });

  test("XOR with zero is the identity", () => {
    const block: Buffer = Buffer.from("0123456789abcdef", "hex");

    expect(xorDesBlock(block, Buffer.alloc(8)).toString("hex")).toBe(
      block.toString("hex"),
    );
  });

  test("XOR is its own inverse", () => {
    const block: Buffer = Buffer.from("0123456789abcdef", "hex");
    const mask: Buffer = Buffer.from("fedcba9876543210", "hex");

    expect(xorDesBlock(xorDesBlock(block, mask), mask).toString("hex")).toBe(
      block.toString("hex"),
    );
  });

  test("always returns a full 8-octet block", () => {
    expect(xorDesBlock(Buffer.alloc(8), Buffer.alloc(8)).length).toBe(8);
  });
});

describe("SnmpDesPrivacyCompat.encryptPduDes / decryptPduDes", () => {
  const PRIV_PASSWORD: string = "priv-passphrase-1234";

  test("returns an 8-octet salt and block-aligned ciphertext", () => {
    const result: SnmpDesEncryptResult = encryptPduDes(
      buildScopedPdu(30),
      snmp.PrivProtocols.des,
      PRIV_PASSWORD,
      snmp.AuthProtocols.sha,
      buildEngine(),
    );

    expect(result.msgPrivacyParameters.length).toBe(8);
    expect(result.encryptedPdu.length % 8).toBe(0);
    expect(result.encryptedPdu.length).toBeGreaterThanOrEqual(32);
  });

  /*
   * The whole point: what the probe encrypts, a peer holding the same
   * credentials decrypts back to the original scoped PDU. Trailing padding is
   * expected — the scoped PDU is self-delimiting BER and receivers stop at
   * the end of the sequence.
   */
  test.each([1, 7, 8, 9, 16, 23, 24, 31, 32, 64, 100, 484])(
    "round-trips a %i octet scoped PDU through encrypt and decrypt",
    (pduLength: number) => {
      const scopedPdu: Buffer = buildScopedPdu(pduLength);
      const engine: SnmpAuthoritativeEngine = buildEngine();

      const encrypted: SnmpDesEncryptResult = encryptPduDes(
        scopedPdu,
        snmp.PrivProtocols.des,
        PRIV_PASSWORD,
        snmp.AuthProtocols.sha,
        engine,
      );

      const decrypted: Buffer = decryptPduDes(
        encrypted.encryptedPdu,
        snmp.PrivProtocols.des,
        encrypted.msgPrivacyParameters,
        PRIV_PASSWORD,
        snmp.AuthProtocols.sha,
        engine,
      );

      expect(decrypted.subarray(0, pduLength).toString("hex")).toBe(
        scopedPdu.toString("hex"),
      );
    },
  );

  test.each([
    ["md5", snmp.AuthProtocols.md5],
    ["sha", snmp.AuthProtocols.sha],
    ["sha256", snmp.AuthProtocols.sha256],
    ["sha512", snmp.AuthProtocols.sha512],
  ])(
    "round-trips when the device localizes with the %s auth protocol",
    (_label: string, authProtocol: snmp.AuthProtocols) => {
      const scopedPdu: Buffer = buildScopedPdu(40);
      const engine: SnmpAuthoritativeEngine = buildEngine();

      const encrypted: SnmpDesEncryptResult = encryptPduDes(
        scopedPdu,
        snmp.PrivProtocols.des,
        PRIV_PASSWORD,
        authProtocol,
        engine,
      );

      expect(
        decryptPduDes(
          encrypted.encryptedPdu,
          snmp.PrivProtocols.des,
          encrypted.msgPrivacyParameters,
          PRIV_PASSWORD,
          authProtocol,
          engine,
        )
          .subarray(0, 40)
          .toString("hex"),
      ).toBe(scopedPdu.toString("hex"));
    },
  );

  /*
   * Two encryptions of the same PDU must differ, because the salt (and so the
   * IV) is fresh per message. Equal ciphertexts would mean IV reuse.
   */
  test("encrypting the same PDU twice produces different ciphertext and salt", () => {
    const scopedPdu: Buffer = buildScopedPdu(32);
    const engine: SnmpAuthoritativeEngine = buildEngine();

    const first: SnmpDesEncryptResult = encryptPduDes(
      scopedPdu,
      snmp.PrivProtocols.des,
      PRIV_PASSWORD,
      snmp.AuthProtocols.sha,
      engine,
    );
    const second: SnmpDesEncryptResult = encryptPduDes(
      scopedPdu,
      snmp.PrivProtocols.des,
      PRIV_PASSWORD,
      snmp.AuthProtocols.sha,
      engine,
    );

    expect(first.msgPrivacyParameters.toString("hex")).not.toBe(
      second.msgPrivacyParameters.toString("hex"),
    );
    expect(first.encryptedPdu.toString("hex")).not.toBe(
      second.encryptedPdu.toString("hex"),
    );
  });

  test("the ciphertext does not contain the plaintext", () => {
    const scopedPdu: Buffer = Buffer.alloc(32, 0x41);

    const encrypted: SnmpDesEncryptResult = encryptPduDes(
      scopedPdu,
      snmp.PrivProtocols.des,
      PRIV_PASSWORD,
      snmp.AuthProtocols.sha,
      buildEngine(),
    );

    expect(encrypted.encryptedPdu.includes(scopedPdu)).toBe(false);
  });

  test("a wrong privacy passphrase does not recover the PDU", () => {
    const scopedPdu: Buffer = buildScopedPdu(32);
    const engine: SnmpAuthoritativeEngine = buildEngine();

    const encrypted: SnmpDesEncryptResult = encryptPduDes(
      scopedPdu,
      snmp.PrivProtocols.des,
      PRIV_PASSWORD,
      snmp.AuthProtocols.sha,
      engine,
    );

    expect(
      decryptPduDes(
        encrypted.encryptedPdu,
        snmp.PrivProtocols.des,
        encrypted.msgPrivacyParameters,
        "the-wrong-passphrase",
        snmp.AuthProtocols.sha,
        engine,
      )
        .subarray(0, 32)
        .toString("hex"),
    ).not.toBe(scopedPdu.toString("hex"));
  });

  test("a wrong salt does not recover the first block", () => {
    const scopedPdu: Buffer = buildScopedPdu(32);
    const engine: SnmpAuthoritativeEngine = buildEngine();

    const encrypted: SnmpDesEncryptResult = encryptPduDes(
      scopedPdu,
      snmp.PrivProtocols.des,
      PRIV_PASSWORD,
      snmp.AuthProtocols.sha,
      engine,
    );

    expect(
      decryptPduDes(
        encrypted.encryptedPdu,
        snmp.PrivProtocols.des,
        Buffer.alloc(8),
        PRIV_PASSWORD,
        snmp.AuthProtocols.sha,
        engine,
      )
        .subarray(0, 8)
        .toString("hex"),
    ).not.toBe(scopedPdu.subarray(0, 8).toString("hex"));
  });

  test("a PDU encrypted for one engine does not decrypt under another", () => {
    const scopedPdu: Buffer = buildScopedPdu(32);

    const encrypted: SnmpDesEncryptResult = encryptPduDes(
      scopedPdu,
      snmp.PrivProtocols.des,
      PRIV_PASSWORD,
      snmp.AuthProtocols.sha,
      buildEngine(ENGINE_ID),
    );

    expect(
      decryptPduDes(
        encrypted.encryptedPdu,
        snmp.PrivProtocols.des,
        encrypted.msgPrivacyParameters,
        PRIV_PASSWORD,
        snmp.AuthProtocols.sha,
        buildEngine(OTHER_ENGINE_ID),
      )
        .subarray(0, 32)
        .toString("hex"),
    ).not.toBe(scopedPdu.toString("hex"));
  });

  /*
   * The IV a peer reconstructs is preIv XOR salt. Rebuilding it here from the
   * primitives and decrypting with the raw cipher proves the PDU-level
   * functions really follow RFC 3414's IV construction, rather than merely
   * being self-consistent with each other.
   */
  test("builds the IV as pre-IV XOR salt, so an RFC-conformant peer can decrypt", () => {
    const scopedPdu: Buffer = buildScopedPdu(32);
    const engine: SnmpAuthoritativeEngine = buildEngine();

    const encrypted: SnmpDesEncryptResult = encryptPduDes(
      scopedPdu,
      snmp.PrivProtocols.des,
      PRIV_PASSWORD,
      snmp.AuthProtocols.sha,
      engine,
    );

    const material: { encryptionKey: Buffer; preIv: Buffer } =
      deriveDesKeyMaterial(
        PRIV_PASSWORD,
        snmp.AuthProtocols.sha,
        engine.engineID,
      );
    const iv: Buffer = xorDesBlock(
      material.preIv,
      encrypted.msgPrivacyParameters,
    );

    const decrypted: Buffer = desCbcDecrypt(
      material.encryptionKey,
      iv,
      encrypted.encryptedPdu,
      false,
    );

    expect(decrypted.subarray(0, 32).toString("hex")).toBe(
      scopedPdu.toString("hex"),
    );
  });
});

describe("SnmpDesPrivacyCompat.applySnmpDesPrivacyCompat", () => {
  afterEach(() => {
    reinstateCompat();
  });

  // Importing the module is enough; no bootstrap ordering to get wrong.
  test("is installed as a side effect of importing the module", () => {
    expect(desAlgorithmEntry().encryptPdu).toBe(encryptPduDes);
    expect(desAlgorithmEntry().decryptPdu).toBe(decryptPduDes);
  });

  test("is idempotent and reports success when called again", () => {
    expect(applySnmpDesPrivacyCompat()).toBe(true);
    expect(applySnmpDesPrivacyCompat()).toBe(true);
    expect(desAlgorithmEntry().encryptPdu).toBe(encryptPduDes);
  });

  /*
   * net-snmp copies the function references into its dispatch table at module
   * load, so patching Encryption.encryptPduDes would be silently ignored. The
   * namespace function must therefore still be the library's original — if
   * this ever flips, the patch is being applied in the wrong place.
   */
  test("leaves net-snmp's namespace functions alone and patches the dispatch table", () => {
    expect(snmp.Encryption.encryptPduDes).not.toBe(encryptPduDes);
    expect(snmp.Encryption.decryptPduDes).not.toBe(decryptPduDes);
  });

  test("does not disturb the DES algorithm metadata net-snmp reads", () => {
    expect(desAlgorithmEntry().KEY_LENGTH).toBe(8);
    expect(desAlgorithmEntry().BLOCK_LENGTH).toBe(8);
  });

  // AES devices were never broken; make sure they are not touched either.
  test.each([
    ["aes", snmp.PrivProtocols.aes],
    ["aes256b", snmp.PrivProtocols.aes256b],
  ])(
    "leaves the %s privacy implementation untouched",
    (_label: string, privProtocol: snmp.PrivProtocols) => {
      const entry: {
        encryptPdu: typeof snmp.Encryption.encryptPduAes;
        decryptPdu: typeof snmp.Encryption.decryptPduAes;
      } = snmp.Encryption.algorithms[
        privProtocol as snmp.PrivProtocols.aes
      ] as unknown as {
        encryptPdu: typeof snmp.Encryption.encryptPduAes;
        decryptPdu: typeof snmp.Encryption.decryptPduAes;
      };

      expect(entry.encryptPdu).toBe(snmp.Encryption.encryptPduAes);
      expect(entry.decryptPdu).toBe(snmp.Encryption.decryptPduAes);
    },
  );
});

describe("SnmpDesPrivacyCompat — dispatch through net-snmp's own entry points", () => {
  const PRIV_PASSWORD: string = "priv-passphrase-1234";

  /*
   * net-snmp reaches DES via Encryption.encryptPdu, which looks the function
   * up in the algorithms table on every call. Going through that public entry
   * point is what proves the patch is actually reached by the library at
   * message-build time, rather than only by our own tests.
   */
  test("Encryption.encryptPdu routes DES traffic through the compat implementation", () => {
    const scopedPdu: Buffer = buildScopedPdu(32);
    const engine: SnmpAuthoritativeEngine = buildEngine();

    const result: SnmpDesEncryptResult = EncryptionDispatch.encryptPdu(
      snmp.PrivProtocols.des,
      scopedPdu,
      PRIV_PASSWORD,
      snmp.AuthProtocols.sha,
      engine as never,
    );

    expect(result.msgPrivacyParameters.length).toBe(8);
    expect(result.encryptedPdu.length % 8).toBe(0);
  });

  /*
   * The full library round trip: encrypt and decrypt entirely through
   * net-snmp's public dispatchers, exactly as a v3 request and its response
   * do. This is the closest stand-in for the customer's failing poll that can
   * run without a device on the network.
   */
  test("a DES PDU survives a full encrypt and decrypt through net-snmp's dispatchers", () => {
    const scopedPdu: Buffer = buildScopedPdu(48);
    const engine: SnmpAuthoritativeEngine = buildEngine();

    const encrypted: SnmpDesEncryptResult = EncryptionDispatch.encryptPdu(
      snmp.PrivProtocols.des,
      scopedPdu,
      PRIV_PASSWORD,
      snmp.AuthProtocols.sha,
      engine as never,
    );

    const decrypted: Buffer = EncryptionDispatch.decryptPdu(
      snmp.PrivProtocols.des,
      encrypted.encryptedPdu,
      encrypted.msgPrivacyParameters,
      PRIV_PASSWORD,
      snmp.AuthProtocols.sha,
      engine as never,
    );

    expect(decrypted.subarray(0, 48).toString("hex")).toBe(
      scopedPdu.toString("hex"),
    );
  });

  // AES must keep working through the same dispatcher after the DES patch.
  test("AES privacy still round-trips through the dispatcher after the DES patch", () => {
    const scopedPdu: Buffer = buildScopedPdu(32);
    const engine: SnmpAuthoritativeEngine = buildEngine();

    const encrypted: SnmpDesEncryptResult = EncryptionDispatch.encryptPdu(
      snmp.PrivProtocols.aes,
      scopedPdu,
      PRIV_PASSWORD,
      snmp.AuthProtocols.sha,
      { ...engine, engineBoots: 1, engineTime: 100 } as never,
    );

    const decrypted: Buffer = EncryptionDispatch.decryptPdu(
      snmp.PrivProtocols.aes,
      encrypted.encryptedPdu,
      encrypted.msgPrivacyParameters,
      PRIV_PASSWORD,
      snmp.AuthProtocols.sha,
      { ...engine, engineBoots: 1, engineTime: 100 } as never,
    );

    expect(decrypted.subarray(0, 32).toString("hex")).toBe(
      scopedPdu.toString("hex"),
    );
  });
});
