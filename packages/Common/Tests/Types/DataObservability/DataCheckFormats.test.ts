import { describe, expect, test } from "@jest/globals";
import {
  DATA_CHECK_FORMAT_PATTERNS,
  DATA_CHECK_FORMATS,
  DataCheckFormat,
  getFormatOfDataType,
  getFormatPattern,
} from "../../../Types/DataObservability/DataCheckFormats";
import { getBuiltInDataType } from "../../../Types/DataSecurity/DataTypeCatalog";

/*
 * The formats a person picks rather than writes. Each pattern is held to the
 * values it should take and the ones it should not.
 */

function matches(format: DataCheckFormat, value: string): boolean {
  return new RegExp(getFormatPattern(format) || "^$").test(value);
}

describe("data check formats", () => {
  test.each([
    [DataCheckFormat.Email, "a.person@example.com", "a person@example"],
    [
      DataCheckFormat.Uuid,
      "7f9c24e8-3b12-4fef-91e2-111111111111",
      "7f9c24e8-3b12",
    ],
    [DataCheckFormat.CountryCode, "DE", "Germany"],
    [DataCheckFormat.Url, "https://example.com/a", "example.com"],
    [DataCheckFormat.IpAddress, "10.0.0.1", "10.0.1"],
    [DataCheckFormat.IsoDate, "2026-11-04T10:00:00Z", "04/11/2026"],
    [DataCheckFormat.PhoneNumber, "+1 (415) 555-0100", "call me"],
  ])("%s", (format: DataCheckFormat, good: string, bad: string) => {
    expect(matches(format, good)).toBe(true);
    expect(matches(format, bad)).toBe(false);
  });

  test("every format but Custom has a pattern", () => {
    for (const format of DATA_CHECK_FORMATS) {
      expect(Boolean(DATA_CHECK_FORMAT_PATTERNS[format])).toBe(
        format !== DataCheckFormat.Custom,
      );
    }
  });

  test("a custom or unknown format has no pattern of its own", () => {
    expect(getFormatPattern(DataCheckFormat.Custom)).toBeNull();
    expect(getFormatPattern("Nope")).toBeNull();
    expect(getFormatPattern(null)).toBeNull();
  });

  test("the data types with a format are real ones", () => {
    for (const id of ["email-address", "phone-number", "ip-address"]) {
      expect(getBuiltInDataType(id)).toBeDefined();
      expect(getFormatOfDataType(id)).not.toBeNull();
    }

    expect(getFormatOfDataType("person-name")).toBeNull();
  });
});
