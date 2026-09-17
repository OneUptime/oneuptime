import { describe, expect, test } from "@jest/globals";
import SnmpVersion, {
  SnmpVersionUtil,
} from "../../../Types/Monitor/SnmpMonitor/SnmpVersion";

/*
 * snmpVersion is a free-text column with two live spellings: the enum VALUES
 * ("1"/"2c"/"3") that the probe contract uses, and the enum KEYS ("V1"/"V2c"/
 * "V3") that every form writes and the column default holds. SnmpVersionUtil is
 * the seam that reconciles them. Reading the column any other way silently takes
 * the wrong branch — a stored "V3" is not === SnmpVersion.V3 ("3"), so a v3
 * device would read as v2c and be polled in cleartext.
 *
 * Unlike the SnmpV3 protocol parsers, parse() cannot return undefined: the probe
 * must pick exactly one session type, so an unreadable value falls back to v2c
 * rather than refusing. These tests pin both the recognized spellings and that
 * deliberate default so a future edit cannot widen or narrow it unnoticed.
 */

describe("SnmpVersionUtil.parse", () => {
  test.each([
    ["1", SnmpVersion.V1],
    ["2c", SnmpVersion.V2c],
    ["3", SnmpVersion.V3],
  ])(
    "reads the probe-contract value spelling %j",
    (stored: string, expected: SnmpVersion) => {
      expect(SnmpVersionUtil.parse(stored)).toBe(expected);
    },
  );

  /*
   * The stored spelling — what forms write and the column default holds. This
   * is the spelling the bare-cast bug got wrong, so it is the one that most
   * needs a test.
   */
  test.each([
    ["V1", SnmpVersion.V1],
    ["V2c", SnmpVersion.V2c],
    ["V3", SnmpVersion.V3],
  ])(
    "reads the stored enum-key spelling %j",
    (stored: string, expected: SnmpVersion) => {
      expect(SnmpVersionUtil.parse(stored)).toBe(expected);
    },
  );

  test.each([
    ["V1", SnmpVersion.V1],
    ["v1", SnmpVersion.V1],
    ["  1  ", SnmpVersion.V1],
    ["\tv3\n", SnmpVersion.V3],
    ["V3", SnmpVersion.V3],
    ["v3", SnmpVersion.V3],
  ])(
    "tolerates case and surrounding whitespace in %j",
    (stored: string, expected: SnmpVersion) => {
      expect(SnmpVersionUtil.parse(stored)).toBe(expected);
    },
  );

  /*
   * v2c is the fallback branch, so every v2c spelling AND every value the parser
   * does not recognize must land here. The two are indistinguishable by design:
   * there is no "undefined version", the probe always needs a session type, and
   * v2c is the safe historic default. Anything that stops mapping to v2c here is
   * a behavior change, not a bug fix.
   */
  test.each([
    ["2c", "an exact value"],
    ["V2c", "the stored key"],
    ["v2c", "lowercased key"],
    ["2", "the version number without the c"],
    ["V2", "the key without the c"],
    [undefined, "an undefined column"],
    [null, "a null column"],
    ["", "an empty string"],
    ["   ", "whitespace only"],
    ["nonsense", "garbage"],
    ["v4", "a version that does not exist"],
    ["0", "a zero"],
  ])(
    "falls back to v2c for %j (%s)",
    (stored: string | undefined | null, _description: string) => {
      expect(SnmpVersionUtil.parse(stored)).toBe(SnmpVersion.V2c);
    },
  );
});

describe("SnmpVersionUtil.isV3", () => {
  test.each([["3"], ["v3"], ["V3"], ["  V3  "], ["\tv3\n"]])(
    "is true for the v3 spelling %j",
    (stored: string) => {
      expect(SnmpVersionUtil.isV3(stored)).toBe(true);
    },
  );

  /*
   * The consequential direction: everything that is not v3 must read as not-v3,
   * because isV3 gates whether auth/priv credentials are applied. A false
   * positive would be harmless; a false negative strands a v3 device in a v2c
   * branch and polls it without credentials.
   */
  test.each([
    ["1"],
    ["V1"],
    ["2c"],
    ["V2c"],
    ["v2c"],
    ["2"],
    [undefined],
    [null],
    [""],
    ["   "],
    ["nonsense"],
  ])(
    "is false for the non-v3 value %j",
    (stored: string | undefined | null) => {
      expect(SnmpVersionUtil.isV3(stored)).toBe(false);
    },
  );

  test("agrees with parse() for every recognized spelling", () => {
    for (const spelling of ["1", "v1", "V1", "2c", "V2c", "3", "v3", "V3"]) {
      expect(SnmpVersionUtil.isV3(spelling)).toBe(
        SnmpVersionUtil.parse(spelling) === SnmpVersion.V3,
      );
    }
  });
});

describe("every enum member survives a round trip", () => {
  /*
   * Exhaustive over the enum rather than a fixed list, so adding a version
   * without teaching parse() its value AND key spelling fails here instead of
   * silently collapsing to v2c in production.
   */
  test("each value spelling parses back to itself", () => {
    for (const member of Object.values(SnmpVersion)) {
      expect(SnmpVersionUtil.parse(member)).toBe(member);
    }
  });

  test("each key spelling parses to its member", () => {
    for (const key of Object.keys(SnmpVersion)) {
      // Keys are "V1"/"V2c"/"V3"; the member is looked up by that key.
      const expected: SnmpVersion =
        SnmpVersion[key as keyof typeof SnmpVersion];
      expect(SnmpVersionUtil.parse(key)).toBe(expected);
    }
  });
});
