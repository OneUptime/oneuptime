import { describe, expect, test } from "@jest/globals";
import SnmpAuthProtocol, {
  SnmpAuthProtocolUtil,
} from "../../../Types/Monitor/SnmpMonitor/SnmpAuthProtocol";
import SnmpPrivProtocol, {
  SnmpPrivProtocolUtil,
} from "../../../Types/Monitor/SnmpMonitor/SnmpPrivProtocol";
import SnmpSecurityLevel, {
  SnmpSecurityLevelUtil,
} from "../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";

/*
 * These three columns are free text with no check constraint, so the parsers
 * are the only thing standing between a hand-written row and a silent security
 * downgrade. Two properties matter and are tested separately throughout:
 *
 *   - parse() recognizes every spelling a human or API caller plausibly writes,
 *     so a legitimate value is never mistaken for garbage.
 *   - parse() returns undefined for anything else, and isUnrecognized() tells
 *     "unset" apart from "unreadable", so callers can refuse to guess.
 */

describe("SnmpSecurityLevelUtil.parse", () => {
  test.each([
    ["noAuthNoPriv", SnmpSecurityLevel.NoAuthNoPriv],
    ["authNoPriv", SnmpSecurityLevel.AuthNoPriv],
    ["authPriv", SnmpSecurityLevel.AuthPriv],
  ])(
    "reads the stored value %s",
    (stored: string, expected: SnmpSecurityLevel) => {
      expect(SnmpSecurityLevelUtil.parse(stored)).toBe(expected);
    },
  );

  /*
   * The enum KEYS differ from the values only in the first letter's case, and
   * the API reference documents the level in prose, so "AuthPriv" is exactly
   * what a hand-written row tends to contain. Reading it as unrecognized would
   * be survivable; reading it as noAuthNoPriv — which the old bare cast did —
   * strips the device's credentials and polls it in cleartext.
   */
  test.each([
    ["NoAuthNoPriv", SnmpSecurityLevel.NoAuthNoPriv],
    ["AuthNoPriv", SnmpSecurityLevel.AuthNoPriv],
    ["AuthPriv", SnmpSecurityLevel.AuthPriv],
  ])(
    "reads the enum key spelling %s",
    (stored: string, expected: SnmpSecurityLevel) => {
      expect(SnmpSecurityLevelUtil.parse(stored)).toBe(expected);
    },
  );

  test.each([
    ["AUTHPRIV", SnmpSecurityLevel.AuthPriv],
    ["authpriv", SnmpSecurityLevel.AuthPriv],
    ["AuThPrIv", SnmpSecurityLevel.AuthPriv],
    ["  authPriv  ", SnmpSecurityLevel.AuthPriv],
    ["\tauthPriv\n", SnmpSecurityLevel.AuthPriv],
  ])(
    "tolerates case and surrounding whitespace in %j",
    (stored: string, expected: SnmpSecurityLevel) => {
      expect(SnmpSecurityLevelUtil.parse(stored)).toBe(expected);
    },
  );

  test.each([[undefined], [null], [""], ["   "]])(
    "returns undefined for the unset value %j",
    (stored: string | undefined | null) => {
      expect(SnmpSecurityLevelUtil.parse(stored)).toBeUndefined();
    },
  );

  test.each([["nonsense"], ["auth"], ["priv"], ["authpriv2"], ["no"], ["0"]])(
    "returns undefined for the unrecognized value %j",
    (stored: string) => {
      expect(SnmpSecurityLevelUtil.parse(stored)).toBeUndefined();
    },
  );
});

describe("SnmpAuthProtocolUtil.parse", () => {
  test.each([
    ["MD5", SnmpAuthProtocol.MD5],
    ["SHA", SnmpAuthProtocol.SHA],
    ["SHA256", SnmpAuthProtocol.SHA256],
    ["SHA512", SnmpAuthProtocol.SHA512],
  ])(
    "reads the stored value %s",
    (stored: string, expected: SnmpAuthProtocol) => {
      expect(SnmpAuthProtocolUtil.parse(stored)).toBe(expected);
    },
  );

  /*
   * The form labels these "SHA-256" and "SHA-512" while storing them without
   * the hyphen, so the label spelling is the most likely near-miss. SHA-1 is
   * the same algorithm as the bare "SHA" of RFC 3414.
   */
  test.each([
    ["SHA-256", SnmpAuthProtocol.SHA256],
    ["sha-256", SnmpAuthProtocol.SHA256],
    ["SHA-512", SnmpAuthProtocol.SHA512],
    ["SHA1", SnmpAuthProtocol.SHA],
    ["SHA-1", SnmpAuthProtocol.SHA],
    ["  md5 ", SnmpAuthProtocol.MD5],
    ["Sha256", SnmpAuthProtocol.SHA256],
  ])(
    "tolerates the near-miss spelling %j",
    (stored: string, expected: SnmpAuthProtocol) => {
      expect(SnmpAuthProtocolUtil.parse(stored)).toBe(expected);
    },
  );

  test.each([[undefined], [null], [""], ["  "]])(
    "returns undefined for the unset value %j",
    (stored: string | undefined | null) => {
      expect(SnmpAuthProtocolUtil.parse(stored)).toBeUndefined();
    },
  );

  test.each([["sha3"], ["sha-384"], ["hmac"], ["none"], ["md4"], ["nonsense"]])(
    "returns undefined for the unrecognized value %j",
    (stored: string) => {
      expect(SnmpAuthProtocolUtil.parse(stored)).toBeUndefined();
    },
  );
});

describe("SnmpPrivProtocolUtil.parse", () => {
  test.each([
    ["DES", SnmpPrivProtocol.DES],
    ["AES", SnmpPrivProtocol.AES],
    ["AES256", SnmpPrivProtocol.AES256],
  ])(
    "reads the stored value %s",
    (stored: string, expected: SnmpPrivProtocol) => {
      expect(SnmpPrivProtocolUtil.parse(stored)).toBe(expected);
    },
  );

  /*
   * "AES-256" is the label the form shows for the value it stores as
   * "AES256". Under the old bare cast that near-miss encrypted with DES.
   */
  test.each([
    ["AES-256", SnmpPrivProtocol.AES256],
    ["aes-256", SnmpPrivProtocol.AES256],
    ["aes256", SnmpPrivProtocol.AES256],
    ["AES128", SnmpPrivProtocol.AES],
    ["AES-128", SnmpPrivProtocol.AES],
    ["des", SnmpPrivProtocol.DES],
    ["  Des  ", SnmpPrivProtocol.DES],
  ])(
    "tolerates the near-miss spelling %j",
    (stored: string, expected: SnmpPrivProtocol) => {
      expect(SnmpPrivProtocolUtil.parse(stored)).toBe(expected);
    },
  );

  test.each([[undefined], [null], [""], ["  "]])(
    "returns undefined for the unset value %j",
    (stored: string | undefined | null) => {
      expect(SnmpPrivProtocolUtil.parse(stored)).toBeUndefined();
    },
  );

  test.each([
    ["3des"],
    ["aes192"],
    ["rc4"],
    ["none"],
    ["nonsense"],
    ["AES512"],
  ])("returns undefined for the unrecognized value %j", (stored: string) => {
    expect(SnmpPrivProtocolUtil.parse(stored)).toBeUndefined();
  });
});

describe("isUnrecognized — telling unset apart from unreadable", () => {
  /*
   * The distinction the probe depends on. An unset protocol keeps its historic
   * default so devices configured before these columns were mandatory keep
   * polling; an unreadable one is refused, because there is no safe guess and
   * defaulting is what silently downgrades the cipher.
   */
  test.each([[undefined], [null], [""], ["   "], ["\t"]])(
    "an unset value %j is not unrecognized",
    (stored: string | undefined | null) => {
      expect(SnmpSecurityLevelUtil.isUnrecognized(stored)).toBe(false);
      expect(SnmpAuthProtocolUtil.isUnrecognized(stored)).toBe(false);
      expect(SnmpPrivProtocolUtil.isUnrecognized(stored)).toBe(false);
    },
  );

  test("a recognized value is not unrecognized", () => {
    expect(SnmpSecurityLevelUtil.isUnrecognized("AuthPriv")).toBe(false);
    expect(SnmpAuthProtocolUtil.isUnrecognized("SHA-256")).toBe(false);
    expect(SnmpPrivProtocolUtil.isUnrecognized("AES-256")).toBe(false);
  });

  test("a value that matches nothing is unrecognized", () => {
    expect(SnmpSecurityLevelUtil.isUnrecognized("nonsense")).toBe(true);
    expect(SnmpAuthProtocolUtil.isUnrecognized("sha3")).toBe(true);
    expect(SnmpPrivProtocolUtil.isUnrecognized("aes192")).toBe(true);
  });
});

describe("every enum member survives a round trip", () => {
  /*
   * Exhaustive over the enums rather than a fixed list, so adding a member
   * without teaching parse() about it fails here instead of silently becoming
   * unrecognized in production.
   */
  test("SnmpSecurityLevel", () => {
    for (const member of Object.values(SnmpSecurityLevel)) {
      expect(SnmpSecurityLevelUtil.parse(member)).toBe(member);
      expect(SnmpSecurityLevelUtil.isUnrecognized(member)).toBe(false);
    }
  });

  test("SnmpAuthProtocol", () => {
    for (const member of Object.values(SnmpAuthProtocol)) {
      expect(SnmpAuthProtocolUtil.parse(member)).toBe(member);
      expect(SnmpAuthProtocolUtil.isUnrecognized(member)).toBe(false);
    }
  });

  test("SnmpPrivProtocol", () => {
    for (const member of Object.values(SnmpPrivProtocol)) {
      expect(SnmpPrivProtocolUtil.parse(member)).toBe(member);
      expect(SnmpPrivProtocolUtil.isUnrecognized(member)).toBe(false);
    }
  });

  // Every enum KEY must parse too - that is the spelling hand-written rows use.
  test("every enum key spelling also parses", () => {
    for (const key of Object.keys(SnmpSecurityLevel)) {
      expect(SnmpSecurityLevelUtil.parse(key)).toBeDefined();
    }
    for (const key of Object.keys(SnmpAuthProtocol)) {
      expect(SnmpAuthProtocolUtil.parse(key)).toBeDefined();
    }
    for (const key of Object.keys(SnmpPrivProtocol)) {
      expect(SnmpPrivProtocolUtil.parse(key)).toBeDefined();
    }
  });
});
