import OneUptimeDate from "../../Types/Date";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the ISO instant for a value that is *declared* a Date
 * but may not be one at runtime.
 *
 * TypeORM's save() hands back the entity it was given, so a date column read
 * off a freshly created model holds whatever the caller supplied. Calling
 * `.toISOString()` on that directly is what took enterprise licence creation
 * down: a TypeError thrown from a post-create hook, after the INSERT had
 * committed, surfacing as a bare HTTP 500 "Server Error" on a licence that
 * had in fact been created.
 */

describe("OneUptimeDate.toIsoStringOrNull", () => {
  it("returns the ISO instant for a Date", () => {
    expect(
      OneUptimeDate.toIsoStringOrNull(new Date("2027-01-01T10:30:00.000Z")),
    ).toBe("2027-01-01T10:30:00.000Z");
  });

  it("parses the string a date column may still be holding", () => {
    expect(OneUptimeDate.toIsoStringOrNull("2027-01-01T10:30:00.000Z")).toBe(
      "2027-01-01T10:30:00.000Z",
    );
  });

  it("returns null for an absent value rather than throwing", () => {
    expect(OneUptimeDate.toIsoStringOrNull(undefined)).toBeNull();
    expect(OneUptimeDate.toIsoStringOrNull(null)).toBeNull();
    expect(OneUptimeDate.toIsoStringOrNull("")).toBeNull();
  });

  it("returns null for a value no parser can make a date of", () => {
    expect(OneUptimeDate.toIsoStringOrNull("not-a-date")).toBeNull();
    expect(OneUptimeDate.toIsoStringOrNull("2027-13-45")).toBeNull();
  });

  it("returns null for an Invalid Date instead of throwing on it", () => {
    expect(OneUptimeDate.toIsoStringOrNull(new Date("nonsense"))).toBeNull();
  });

  /*
   * The whole point: whatever it is handed, it answers. A reporting caller
   * gets "unknown" instead of an exception it has no way to recover from.
   */
  it("never throws, whatever it is handed", () => {
    for (const value of [
      undefined,
      null,
      "",
      "   ",
      "not-a-date",
      "0",
      new Date("nonsense"),
      new Date(),
      "2027-01-01",
    ]) {
      expect(() => {
        return OneUptimeDate.toIsoStringOrNull(
          value as Date | string | undefined | null,
        );
      }).not.toThrow();
    }
  });
});
