import SnmpSecurityLevel, {
  SnmpSecurityLevelUtil,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";

describe("SnmpSecurityLevelUtil.parse", () => {
  test("parses each level from its value spelling", () => {
    expect(SnmpSecurityLevelUtil.parse("noAuthNoPriv")).toBe(
      SnmpSecurityLevel.NoAuthNoPriv,
    );
    expect(SnmpSecurityLevelUtil.parse("authNoPriv")).toBe(
      SnmpSecurityLevel.AuthNoPriv,
    );
    expect(SnmpSecurityLevelUtil.parse("authPriv")).toBe(
      SnmpSecurityLevel.AuthPriv,
    );
  });

  test("collapses the key spelling onto the value spelling (case-insensitive)", () => {
    /*
     * The enum keys ("AuthPriv") and values ("authPriv") differ only by the
     * first letter's case — exactly the drift a hand-written row produces.
     */
    expect(SnmpSecurityLevelUtil.parse("AuthPriv")).toBe(
      SnmpSecurityLevel.AuthPriv,
    );
    expect(SnmpSecurityLevelUtil.parse("NOAUTHNOPRIV")).toBe(
      SnmpSecurityLevel.NoAuthNoPriv,
    );
  });

  test("is whitespace-tolerant", () => {
    expect(SnmpSecurityLevelUtil.parse("  authpriv  ")).toBe(
      SnmpSecurityLevel.AuthPriv,
    );
  });

  test("returns undefined rather than silently dropping to NoAuthNoPriv", () => {
    /*
     * The whole point: an unmatched value must not fall through to 'no
     * security at all'. The caller decides, not the parser.
     */
    expect(SnmpSecurityLevelUtil.parse("auth")).toBeUndefined();
    expect(SnmpSecurityLevelUtil.parse("priv")).toBeUndefined();
    expect(SnmpSecurityLevelUtil.parse("secure")).toBeUndefined();
    expect(SnmpSecurityLevelUtil.parse("")).toBeUndefined();
    expect(SnmpSecurityLevelUtil.parse(null)).toBeUndefined();
    expect(SnmpSecurityLevelUtil.parse(undefined)).toBeUndefined();
  });
});

describe("SnmpSecurityLevelUtil.isUnrecognized", () => {
  test("is true only when something is stored but no spelling matches", () => {
    expect(SnmpSecurityLevelUtil.isUnrecognized("auth")).toBe(true);
    expect(SnmpSecurityLevelUtil.isUnrecognized("full")).toBe(true);
  });

  test("is false for a recognised value in either spelling", () => {
    expect(SnmpSecurityLevelUtil.isUnrecognized("authPriv")).toBe(false);
    expect(SnmpSecurityLevelUtil.isUnrecognized("AuthPriv")).toBe(false);
  });

  test("an empty or absent column is 'unset', not 'unrecognized'", () => {
    expect(SnmpSecurityLevelUtil.isUnrecognized("")).toBe(false);
    expect(SnmpSecurityLevelUtil.isUnrecognized("   ")).toBe(false);
    expect(SnmpSecurityLevelUtil.isUnrecognized(null)).toBe(false);
    expect(SnmpSecurityLevelUtil.isUnrecognized(undefined)).toBe(false);
  });
});
