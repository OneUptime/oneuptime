import SnmpVersion, {
  SnmpVersionUtil,
} from "../../../../Types/Monitor/SnmpMonitor/SnmpVersion";

describe("SnmpVersionUtil.parse", () => {
  test("reads the stored key spelling (V1/V3), case-insensitively", () => {
    expect(SnmpVersionUtil.parse("V1")).toBe(SnmpVersion.V1);
    expect(SnmpVersionUtil.parse("v1")).toBe(SnmpVersion.V1);
    expect(SnmpVersionUtil.parse("V3")).toBe(SnmpVersion.V3);
    expect(SnmpVersionUtil.parse("v3")).toBe(SnmpVersion.V3);
  });

  test("reads the probe-contract value spelling (1/3)", () => {
    expect(SnmpVersionUtil.parse("1")).toBe(SnmpVersion.V1);
    expect(SnmpVersionUtil.parse("3")).toBe(SnmpVersion.V3);
  });

  test("tolerates surrounding whitespace", () => {
    expect(SnmpVersionUtil.parse("  v3  ")).toBe(SnmpVersion.V3);
    expect(SnmpVersionUtil.parse("\t3\n")).toBe(SnmpVersion.V3);
  });

  test("defaults to V2c for the v2c spellings and anything unknown", () => {
    // V2c is the default branch, so both its own spellings and junk land here.
    expect(SnmpVersionUtil.parse("2c")).toBe(SnmpVersion.V2c);
    expect(SnmpVersionUtil.parse("V2c")).toBe(SnmpVersion.V2c);
    expect(SnmpVersionUtil.parse("banana")).toBe(SnmpVersion.V2c);
    expect(SnmpVersionUtil.parse("")).toBe(SnmpVersion.V2c);
  });

  test("defaults to V2c for null and undefined", () => {
    expect(SnmpVersionUtil.parse(null)).toBe(SnmpVersion.V2c);
    expect(SnmpVersionUtil.parse(undefined)).toBe(SnmpVersion.V2c);
  });
});

describe("SnmpVersionUtil.isV3", () => {
  test("is true only for the v3 spellings", () => {
    expect(SnmpVersionUtil.isV3("V3")).toBe(true);
    expect(SnmpVersionUtil.isV3("3")).toBe(true);
    expect(SnmpVersionUtil.isV3(" v3 ")).toBe(true);
  });

  test("is false for v1, v2c, unknown and empty input", () => {
    expect(SnmpVersionUtil.isV3("V1")).toBe(false);
    expect(SnmpVersionUtil.isV3("2c")).toBe(false);
    expect(SnmpVersionUtil.isV3("nope")).toBe(false);
    expect(SnmpVersionUtil.isV3(null)).toBe(false);
    expect(SnmpVersionUtil.isV3(undefined)).toBe(false);
  });
});
