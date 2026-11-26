import { afterEach, describe, expect, jest, test } from "@jest/globals";
import * as DateLanguage from "../../../Types/DateLanguage";
import {
  describeScanDuration,
  readScanDuration,
  SCAN_DURATION_PATTERN,
} from "../../../Types/DataSecurity/ScanWarningDuration";
import {
  formatScanDuration,
  readScanWarning,
  SCAN_WARNINGS,
  ScanWarningValueKind,
  writeScanWarning,
} from "../../../Types/DataSecurity/ScanWarnings";
import {
  NARROW_NO_BREAK_SPACE,
  NO_BREAK_SPACE,
} from "../../../Types/NoBreakSpaces";

/*
 * A SCAN WARNING'S DURATION: STORED AS WRITTEN, DRAWN HELD (#10930).
 *
 * A scan stores its warnings in English, a duration in them as "2 minutes",
 * and that English is read back as it was written - by the API, the MCP
 * server, OneUptime AI and the Dashboard, which matches it back to its
 * template - so it keeps the plain space every warning stored before has.
 * A page never draws it so: it draws the duration in the reader's words,
 * the number held to its unit, and where Intl cannot write the unit, the
 * stored English with the number held to its word.
 */

const DURATIONS: ReadonlyArray<[number, string]> = [
  [0, "1 second"],
  [1000, "1 second"],
  [6000, "6 seconds"],
  [59_000, "59 seconds"],
  [60_000, "1 minute"],
  [90_000, "90 seconds"],
  [120_000, "2 minutes"],
  [3_600_000, "60 minutes"],
];

describe("a duration as a scan stores it", () => {
  test("is English with the plain space every stored warning has, and reads back", () => {
    for (const [milliseconds, stored] of DURATIONS) {
      expect(describeScanDuration(milliseconds)).toBe(stored);
      expect(describeScanDuration(milliseconds)).not.toContain(NO_BREAK_SPACE);
      expect(describeScanDuration(milliseconds)).not.toContain(
        NARROW_NO_BREAK_SPACE,
      );
      expect(readScanDuration(stored)).toBe(
        Math.max(1, Math.round(milliseconds / 1000)) * 1000,
      );
    }
  });

  test("a template's pattern captures what it writes, whole, and nothing else", () => {
    const pattern: RegExp = new RegExp(`^${SCAN_DURATION_PATTERN}$`);

    for (const [milliseconds, stored] of DURATIONS) {
      expect(describeScanDuration(milliseconds).match(pattern)?.[1]).toBe(
        stored,
      );
    }

    expect("6 hours").not.toMatch(pattern);
    expect("six seconds").not.toMatch(pattern);
    // Held, it is a page's, never a stored warning's.
    expect(`6${NO_BREAK_SPACE}seconds`).not.toMatch(pattern);
  });

  test("a stored warning with a duration reads back as it was written, before this and after", () => {
    expect(SCAN_WARNINGS.modelStoreTimeRanOut.values["limit"]).toBe(
      ScanWarningValueKind.Duration,
    );

    const written: string = writeScanWarning("modelStoreTimeRanOut", {
      read: 120,
      total: 500,
      limit: 6000,
    });

    expect(written).toContain("6 seconds");
    expect(readScanWarning(written)).toEqual({
      key: "modelStoreTimeRanOut",
      values: { read: 120, total: 500, limit: 6000 },
    });
  });
});

describe("a duration as a page draws it", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("in the reader's words, the number held to its unit", () => {
    for (const [milliseconds] of DURATIONS) {
      expect(formatScanDuration(milliseconds, "en")).not.toMatch(/\d /);
    }
  });

  test("where Intl cannot write the unit, the stored English with the number held to its word", () => {
    jest.spyOn(DateLanguage, "formatUnitAmount").mockReturnValue(null);

    for (const [milliseconds, stored] of DURATIONS) {
      expect(formatScanDuration(milliseconds, "de")).toBe(
        stored.replace(" ", NO_BREAK_SPACE),
      );
    }
  });
});
