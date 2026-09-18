import SnmpAuthProtocol, {
  SnmpAuthProtocolUtil,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpAuthProtocol";

describe("SnmpAuthProtocolUtil.parse", () => {
  test("parses each protocol from its canonical spelling", () => {
    expect(SnmpAuthProtocolUtil.parse("MD5")).toBe(SnmpAuthProtocol.MD5);
    expect(SnmpAuthProtocolUtil.parse("SHA")).toBe(SnmpAuthProtocol.SHA);
    expect(SnmpAuthProtocolUtil.parse("SHA256")).toBe(SnmpAuthProtocol.SHA256);
    expect(SnmpAuthProtocolUtil.parse("SHA512")).toBe(SnmpAuthProtocol.SHA512);
  });

  test("accepts the hyphenated UI labels", () => {
    // "SHA-256" is the label the form shows for that option.
    expect(SnmpAuthProtocolUtil.parse("SHA-256")).toBe(SnmpAuthProtocol.SHA256);
    expect(SnmpAuthProtocolUtil.parse("SHA-512")).toBe(SnmpAuthProtocol.SHA512);
    expect(SnmpAuthProtocolUtil.parse("SHA-1")).toBe(SnmpAuthProtocol.SHA);
  });

  test("treats SHA, SHA1 and SHA-1 as the same (SHA-1) algorithm", () => {
    expect(SnmpAuthProtocolUtil.parse("sha")).toBe(SnmpAuthProtocol.SHA);
    expect(SnmpAuthProtocolUtil.parse("sha1")).toBe(SnmpAuthProtocol.SHA);
    expect(SnmpAuthProtocolUtil.parse("sha-1")).toBe(SnmpAuthProtocol.SHA);
  });

  test("is case-insensitive and whitespace-tolerant", () => {
    expect(SnmpAuthProtocolUtil.parse("  md5 ")).toBe(SnmpAuthProtocol.MD5);
    expect(SnmpAuthProtocolUtil.parse("Sha256")).toBe(SnmpAuthProtocol.SHA256);
  });

  test("returns undefined — never a silent default — for unknown input", () => {
    /*
     * Deliberately NOT defaulting to MD5: 'unset' and 'unreadable' are
     * different problems and only the caller can decide the fallback.
     */
    expect(SnmpAuthProtocolUtil.parse("SHA-3")).toBeUndefined();
    expect(SnmpAuthProtocolUtil.parse("nonsense")).toBeUndefined();
    expect(SnmpAuthProtocolUtil.parse("")).toBeUndefined();
    expect(SnmpAuthProtocolUtil.parse(null)).toBeUndefined();
    expect(SnmpAuthProtocolUtil.parse(undefined)).toBeUndefined();
  });
});

describe("SnmpAuthProtocolUtil.isUnrecognized", () => {
  test("is true only when something is stored but no spelling matches", () => {
    expect(SnmpAuthProtocolUtil.isUnrecognized("SHA-3")).toBe(true);
    expect(SnmpAuthProtocolUtil.isUnrecognized("md-5")).toBe(true);
  });

  test("is false for a recognised value", () => {
    expect(SnmpAuthProtocolUtil.isUnrecognized("SHA-256")).toBe(false);
    expect(SnmpAuthProtocolUtil.isUnrecognized("md5")).toBe(false);
  });

  test("an empty or absent column is 'unset', not 'unrecognized'", () => {
    expect(SnmpAuthProtocolUtil.isUnrecognized("")).toBe(false);
    expect(SnmpAuthProtocolUtil.isUnrecognized("   ")).toBe(false);
    expect(SnmpAuthProtocolUtil.isUnrecognized(null)).toBe(false);
    expect(SnmpAuthProtocolUtil.isUnrecognized(undefined)).toBe(false);
  });
});
