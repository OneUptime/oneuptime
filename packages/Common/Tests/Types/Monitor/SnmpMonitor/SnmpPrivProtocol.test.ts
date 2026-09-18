import SnmpPrivProtocol, {
  SnmpPrivProtocolUtil,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpPrivProtocol";

describe("SnmpPrivProtocolUtil.parse", () => {
  test("parses each cipher from its canonical spelling", () => {
    expect(SnmpPrivProtocolUtil.parse("DES")).toBe(SnmpPrivProtocol.DES);
    expect(SnmpPrivProtocolUtil.parse("AES")).toBe(SnmpPrivProtocol.AES);
    expect(SnmpPrivProtocolUtil.parse("AES256")).toBe(SnmpPrivProtocol.AES256);
  });

  test("treats AES, AES128 and AES-128 as the same (AES-128) cipher", () => {
    expect(SnmpPrivProtocolUtil.parse("aes")).toBe(SnmpPrivProtocol.AES);
    expect(SnmpPrivProtocolUtil.parse("aes128")).toBe(SnmpPrivProtocol.AES);
    expect(SnmpPrivProtocolUtil.parse("aes-128")).toBe(SnmpPrivProtocol.AES);
  });

  test("accepts the hyphenated UI label for AES-256", () => {
    expect(SnmpPrivProtocolUtil.parse("AES-256")).toBe(SnmpPrivProtocol.AES256);
    expect(SnmpPrivProtocolUtil.parse("aes256")).toBe(SnmpPrivProtocol.AES256);
  });

  test("is case-insensitive and whitespace-tolerant", () => {
    expect(SnmpPrivProtocolUtil.parse("  des ")).toBe(SnmpPrivProtocol.DES);
    expect(SnmpPrivProtocolUtil.parse("Aes-256")).toBe(SnmpPrivProtocol.AES256);
  });

  test("does NOT confuse the weaker AES-128 with AES-256", () => {
    // Guards the exact downgrade the parser exists to prevent.
    expect(SnmpPrivProtocolUtil.parse("aes")).not.toBe(SnmpPrivProtocol.AES256);
    expect(SnmpPrivProtocolUtil.parse("aes-256")).not.toBe(
      SnmpPrivProtocol.AES,
    );
  });

  test("returns undefined — never a silent DES default — for unknown input", () => {
    expect(SnmpPrivProtocolUtil.parse("3des")).toBeUndefined();
    expect(SnmpPrivProtocolUtil.parse("rc4")).toBeUndefined();
    expect(SnmpPrivProtocolUtil.parse("")).toBeUndefined();
    expect(SnmpPrivProtocolUtil.parse(null)).toBeUndefined();
    expect(SnmpPrivProtocolUtil.parse(undefined)).toBeUndefined();
  });
});

describe("SnmpPrivProtocolUtil.isUnrecognized", () => {
  test("is true only when something is stored but no spelling matches", () => {
    expect(SnmpPrivProtocolUtil.isUnrecognized("3des")).toBe(true);
    expect(SnmpPrivProtocolUtil.isUnrecognized("aes-512")).toBe(true);
  });

  test("is false for a recognised value", () => {
    expect(SnmpPrivProtocolUtil.isUnrecognized("AES-256")).toBe(false);
    expect(SnmpPrivProtocolUtil.isUnrecognized("des")).toBe(false);
  });

  test("an empty or absent column is 'unset', not 'unrecognized'", () => {
    expect(SnmpPrivProtocolUtil.isUnrecognized("")).toBe(false);
    expect(SnmpPrivProtocolUtil.isUnrecognized("   ")).toBe(false);
    expect(SnmpPrivProtocolUtil.isUnrecognized(null)).toBe(false);
    expect(SnmpPrivProtocolUtil.isUnrecognized(undefined)).toBe(false);
  });
});
