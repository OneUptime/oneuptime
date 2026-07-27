import MemoryUtil from "../../Utils/Memory";

/*
 * MemoryUtil.convertToGb turns a raw byte count into gibibytes (bytes / 1024^3)
 * rounded to two decimal places. These tests pin the unit (GiB, not GB), the
 * rounding, and the boundary/edge behaviour.
 */
describe("MemoryUtil.convertToGb", () => {
  const GIB: number = 1024 * 1024 * 1024;

  test("converts exactly one GiB to 1", () => {
    expect(MemoryUtil.convertToGb(GIB)).toBe(1);
  });

  test("converts whole GiB multiples", () => {
    expect(MemoryUtil.convertToGb(4 * GIB)).toBe(4);
    expect(MemoryUtil.convertToGb(16 * GIB)).toBe(16);
  });

  test("returns 0 for 0 bytes", () => {
    expect(MemoryUtil.convertToGb(0)).toBe(0);
  });

  test("rounds to two decimal places", () => {
    // 1.5 GiB -> 1.5
    expect(MemoryUtil.convertToGb(1.5 * GIB)).toBe(1.5);
    // 1.234 GiB rounds to 1.23
    expect(MemoryUtil.convertToGb(1.234 * GIB)).toBe(1.23);
    // 1.235 GiB rounds up to 1.24 (round-half-up)
    expect(MemoryUtil.convertToGb(1.235 * GIB)).toBe(1.24);
  });

  test("handles sub-GiB values", () => {
    // 512 MiB is half a GiB.
    expect(MemoryUtil.convertToGb(512 * 1024 * 1024)).toBe(0.5);
    // A single byte rounds down to 0.
    expect(MemoryUtil.convertToGb(1)).toBe(0);
  });

  test("uses GiB (1024^3), not GB (1000^3)", () => {
    // One billion bytes is < 1 GiB, so it must not round to 1.
    expect(MemoryUtil.convertToGb(1_000_000_000)).toBe(0.93);
  });
});
