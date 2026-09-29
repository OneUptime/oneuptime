import AggregateResultUtil from "../../../../Server/Types/Database/AggregateResultUtil";
import { AggregateRow } from "../../../../Server/Types/Database/AggregateBy";
import { describe, expect, it } from "@jest/globals";

/*
 * Why this module has tests at all: node-postgres does not hand back numbers
 * for the columns this product counts with. `COUNT` is `bigint` and `SUM` over
 * an integer column is `numeric`, and both arrive as JavaScript STRINGS —
 * because they do not fit a double in the general case, so the driver refuses
 * to lose precision on your behalf.
 *
 * A caller that trusts the runtime type gets a value that renders perfectly
 * ("1204 devices"), sorts wrong ("10" < "9"), and adds by concatenating
 * ("1" + "2" === "12"). None of those three failures throws, and only the
 * first is visible in a screenshot — which is exactly why every aggregate row
 * in the Network product is read through here instead of being indexed into.
 *
 * So the suite below is deliberately written against the driver's reality
 * rather than against the TypeScript type: every string case here is a shape
 * Postgres can actually produce.
 */

/*
 * A helper rather than object literals inline, so a test says what SHAPE it is
 * feeding the reader and not just what value.
 */
function row(values: Record<string, unknown>): AggregateRow {
  return values as AggregateRow;
}

describe("AggregateResultUtil.toNumber", () => {
  it("parses the strings Postgres actually returns for COUNT", () => {
    /*
     * The single most important assertion in the file. `COUNT(*)` comes back
     * as "1204", not 1204.
     */
    expect(
      AggregateResultUtil.toNumber(
        row({ totalDevices: "1204" }),
        "totalDevices",
      ),
    ).toBe(1204);
    expect(
      typeof AggregateResultUtil.toNumber(
        row({ totalDevices: "1204" }),
        "totalDevices",
      ),
    ).toBe("number");

    expect(
      AggregateResultUtil.toNumber(row({ devicesDown: "0" }), "devicesDown"),
    ).toBe(0);
  });

  it("fixes the three ways an unread count goes wrong", () => {
    /*
     * These assertions are the regression, stated directly: sorting and
     * addition over the raw driver values are both silently wrong, and neither
     * throws. If someone "simplifies" a call site back to `row[alias]`, this is
     * the behaviour that disappears.
     */
    const a: AggregateRow = row({ n: "10" });
    const b: AggregateRow = row({ n: "9" });

    // Raw: "10" < "9" is true (lexicographic). Read back: 10 > 9.
    expect((a["n"] as string) < (b["n"] as string)).toBe(true);
    expect(
      AggregateResultUtil.toNumber(a, "n") >
        AggregateResultUtil.toNumber(b, "n"),
    ).toBe(true);

    // Raw: "1" + "2" === "12". Read back: 3.
    expect(
      (row({ n: "1" })["n"] as string) + (row({ n: "2" })["n"] as string),
    ).toBe("12");
    expect(
      AggregateResultUtil.toNumber(row({ n: "1" }), "n") +
        AggregateResultUtil.toNumber(row({ n: "2" }), "n"),
    ).toBe(3);
  });

  it("passes a value that is already a number straight through", () => {
    // Not every aggregate is a bigint — AVG and a plain integer column arrive as numbers.
    expect(AggregateResultUtil.toNumber(row({ n: 1204 }), "n")).toBe(1204);
    expect(AggregateResultUtil.toNumber(row({ n: 0 }), "n")).toBe(0);
    expect(AggregateResultUtil.toNumber(row({ n: -7 }), "n")).toBe(-7);
    expect(AggregateResultUtil.toNumber(row({ n: 1.5 }), "n")).toBe(1.5);
  });

  it("reads a bigint string that fits a double exactly", () => {
    expect(
      AggregateResultUtil.toNumber(row({ n: "9007199254740991" }), "n"),
    ).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("loses precision above 2^53, which is the accepted trade-off", () => {
    /*
     * Pinned rather than celebrated. The driver returns bigint as a string
     * precisely because it does not fit a double, and toNumber opts back into
     * the double anyway — that is the right call for counting devices (a fleet
     * of nine quadrillion is not the failure mode we ship against) but it IS a
     * lossy conversion, and a future caller that aggregates bytes or nanosecond
     * durations would be wrong here rather than merely imprecise.
     *
     * 2^53 + 1 is not representable, so it reads back as 2^53.
     */
    expect(
      AggregateResultUtil.toNumber(row({ n: "9007199254740993" }), "n"),
    ).toBe(9007199254740992);
  });

  it("reads SUM over an empty set as 0", () => {
    /*
     * This is the case a naive `Number(row[alias])` gets right by accident and
     * a naive `row[alias] ?? 0` gets right too — but it is worth an explicit
     * test because the SQL is counter-intuitive: `SUM(x)` over ZERO matching
     * rows is NULL in SQL, not 0. (`COUNT(*)` over zero rows is genuinely "0".)
     * So the "no devices have any down interfaces" case arrives as null, and it
     * must render as 0 rather than as "-" or NaN.
     */
    expect(
      AggregateResultUtil.toNumber(
        row({ interfacesDown: null }),
        "interfacesDown",
      ),
    ).toBe(0);
  });

  it("reads a missing, empty or unparseable value as 0", () => {
    // An alias that was never selected — a typo, or a column dropped from the select.
    expect(
      AggregateResultUtil.toNumber(row({ other: "5" }), "totalDevices"),
    ).toBe(0);

    expect(AggregateResultUtil.toNumber(row({ n: undefined }), "n")).toBe(0);
    expect(AggregateResultUtil.toNumber(row({ n: "" }), "n")).toBe(0);
    expect(AggregateResultUtil.toNumber(row({ n: "not-a-number" }), "n")).toBe(
      0,
    );
    expect(AggregateResultUtil.toNumber(row({ n: "12 devices" }), "n")).toBe(0);
  });

  it("never returns a non-finite number", () => {
    /*
     * NaN and Infinity are the values that poison a total silently: NaN
     * propagates through every subsequent `+`, and both render as garbage.
     */
    expect(AggregateResultUtil.toNumber(row({ n: Number.NaN }), "n")).toBe(0);
    expect(
      AggregateResultUtil.toNumber(row({ n: Number.POSITIVE_INFINITY }), "n"),
    ).toBe(0);
    expect(
      AggregateResultUtil.toNumber(row({ n: Number.NEGATIVE_INFINITY }), "n"),
    ).toBe(0);
    expect(AggregateResultUtil.toNumber(row({ n: "Infinity" }), "n")).toBe(0);
  });

  it("reads a Date or a boolean as 0 rather than coercing it", () => {
    /*
     * A MAX(createdAt) column read with the wrong reader must not turn into a
     * millisecond epoch that looks like a plausible count.
     */
    expect(
      AggregateResultUtil.toNumber(
        row({ n: new Date("2026-01-01T00:00:00.000Z") }),
        "n",
      ),
    ).toBe(0);
    expect(AggregateResultUtil.toNumber(row({ n: true }), "n")).toBe(0);
    expect(AggregateResultUtil.toNumber(row({ n: false }), "n")).toBe(0);
  });

  it("does not throw when the row itself is missing", () => {
    /*
     * `getRawMany()` returns [] for a query that matched nothing, so
     * `rows[0]` is undefined at every call site. The reader has to absorb that
     * — otherwise every summary card needs its own null guard.
     */
    expect(AggregateResultUtil.toNumber(null, "n")).toBe(0);
    expect(AggregateResultUtil.toNumber(undefined, "n")).toBe(0);
  });
});

describe("AggregateResultUtil.toBoolean", () => {
  it("passes real booleans through", () => {
    // The normal case: pg maps the `boolean` type to a JS boolean.
    expect(AggregateResultUtil.toBoolean(row({ b: true }), "b")).toBe(true);
    expect(AggregateResultUtil.toBoolean(row({ b: false }), "b")).toBe(false);
  });

  it("accepts the textual forms a CASE or a cast produces", () => {
    /*
     * A boolean that travelled through `CASE WHEN ... THEN 't' END` or a
     * ::text cast arrives as text, and Postgres' own output form for true is
     * "t" — not "true".
     */
    expect(AggregateResultUtil.toBoolean(row({ b: "t" }), "b")).toBe(true);
    expect(AggregateResultUtil.toBoolean(row({ b: "true" }), "b")).toBe(true);
    expect(AggregateResultUtil.toBoolean(row({ b: "1" }), "b")).toBe(true);

    expect(AggregateResultUtil.toBoolean(row({ b: "f" }), "b")).toBe(false);
    expect(AggregateResultUtil.toBoolean(row({ b: "false" }), "b")).toBe(false);
    expect(AggregateResultUtil.toBoolean(row({ b: "0" }), "b")).toBe(false);
  });

  it("accepts 1/0 from a numeric CASE", () => {
    expect(AggregateResultUtil.toBoolean(row({ b: 1 }), "b")).toBe(true);
    expect(AggregateResultUtil.toBoolean(row({ b: 0 }), "b")).toBe(false);
    // Only exactly 1 is true — a COUNT read with the wrong reader is not "true".
    expect(AggregateResultUtil.toBoolean(row({ b: 2 }), "b")).toBe(false);
  });

  it("reads anything it does not recognise as false", () => {
    expect(AggregateResultUtil.toBoolean(row({ b: null }), "b")).toBe(false);
    expect(AggregateResultUtil.toBoolean(row({ b: undefined }), "b")).toBe(
      false,
    );
    expect(AggregateResultUtil.toBoolean(row({ other: true }), "b")).toBe(
      false,
    );
    expect(AggregateResultUtil.toBoolean(row({ b: "yes" }), "b")).toBe(false);
    expect(AggregateResultUtil.toBoolean(row({ b: new Date() }), "b")).toBe(
      false,
    );
  });

  it("does not throw when the row itself is missing", () => {
    expect(AggregateResultUtil.toBoolean(null, "b")).toBe(false);
    expect(AggregateResultUtil.toBoolean(undefined, "b")).toBe(false);
  });
});

describe("AggregateResultUtil.toNullableBoolean", () => {
  /*
   * The whole reason this reader exists instead of toBoolean: `isReachable` is
   * THREE-state. NULL means "this device has never been polled", which is a
   * different device-health verdict from "polled, and unreachable". Collapsing
   * NULL to false would classify every brand-new, never-polled device as DOWN
   * and page somebody at import time.
   *
   * The bucket keys that DeviceHealthAggregation groups by are exactly these
   * three states, so the distinction has to survive the read back out.
   */
  it("keeps NULL as null and does NOT collapse it to false", () => {
    const neverPolled: boolean | null = AggregateResultUtil.toNullableBoolean(
      row({ isReachable: null }),
      "isReachable",
    );

    expect(neverPolled).toBeNull();
    // Stated the other way round too, because `null == false` is the bug.
    expect(neverPolled).not.toBe(false);
    expect(neverPolled === false).toBe(false);
  });

  it("distinguishes all three states from each other", () => {
    expect(
      AggregateResultUtil.toNullableBoolean(
        row({ isReachable: true }),
        "isReachable",
      ),
    ).toBe(true);
    expect(
      AggregateResultUtil.toNullableBoolean(
        row({ isReachable: false }),
        "isReachable",
      ),
    ).toBe(false);
    expect(
      AggregateResultUtil.toNullableBoolean(
        row({ isReachable: null }),
        "isReachable",
      ),
    ).toBeNull();
  });

  it("treats an absent column and an undefined value as null, not false", () => {
    // A group key that was not selected is "unknown", not "unreachable".
    expect(
      AggregateResultUtil.toNullableBoolean(
        row({ other: true }),
        "isReachable",
      ),
    ).toBeNull();
    expect(
      AggregateResultUtil.toNullableBoolean(
        row({ isReachable: undefined }),
        "isReachable",
      ),
    ).toBeNull();
  });

  it("still understands the textual and numeric forms", () => {
    expect(AggregateResultUtil.toNullableBoolean(row({ b: "t" }), "b")).toBe(
      true,
    );
    expect(AggregateResultUtil.toNullableBoolean(row({ b: "f" }), "b")).toBe(
      false,
    );
    expect(AggregateResultUtil.toNullableBoolean(row({ b: "true" }), "b")).toBe(
      true,
    );
    expect(
      AggregateResultUtil.toNullableBoolean(row({ b: "false" }), "b"),
    ).toBe(false);
    expect(AggregateResultUtil.toNullableBoolean(row({ b: "1" }), "b")).toBe(
      true,
    );
    expect(AggregateResultUtil.toNullableBoolean(row({ b: "0" }), "b")).toBe(
      false,
    );
    expect(AggregateResultUtil.toNullableBoolean(row({ b: 1 }), "b")).toBe(
      true,
    );
    expect(AggregateResultUtil.toNullableBoolean(row({ b: 0 }), "b")).toBe(
      false,
    );
  });

  it("does not throw when the row itself is missing", () => {
    expect(AggregateResultUtil.toNullableBoolean(null, "b")).toBeNull();
    expect(AggregateResultUtil.toNullableBoolean(undefined, "b")).toBeNull();
  });
});

describe("AggregateResultUtil.toStringOrNull", () => {
  const UUID: string = "51fabb3e-bf84-4a95-95b5-9c5b4af720ca";

  it("returns a uuid group key unchanged", () => {
    // The group key that says WHICH site a bucket belongs to.
    expect(
      AggregateResultUtil.toStringOrNull(row({ siteId: UUID }), "siteId"),
    ).toBe(UUID);
  });

  it("reads the empty string as null", () => {
    /*
     * A grouped id column is only ever a real id or absent — an empty-string
     * id is not a site, and letting "" through would produce a bucket keyed on
     * a site that cannot be looked up.
     */
    expect(
      AggregateResultUtil.toStringOrNull(row({ siteId: "" }), "siteId"),
    ).toBeNull();
  });

  it("reads NULL, undefined and a missing column as null", () => {
    // A device with no site groups under siteId = NULL — a real, expected bucket.
    expect(
      AggregateResultUtil.toStringOrNull(row({ siteId: null }), "siteId"),
    ).toBeNull();
    expect(
      AggregateResultUtil.toStringOrNull(row({ siteId: undefined }), "siteId"),
    ).toBeNull();
    expect(
      AggregateResultUtil.toStringOrNull(row({ other: UUID }), "siteId"),
    ).toBeNull();
  });

  it("stringifies a number rather than returning it", () => {
    // Guarantees the caller can compare against a `.toString()`ed ObjectID.
    expect(AggregateResultUtil.toStringOrNull(row({ n: 42 }), "n")).toBe("42");
    expect(typeof AggregateResultUtil.toStringOrNull(row({ n: 42 }), "n")).toBe(
      "string",
    );
    // 0 is a value, not an absence — it must not read as null.
    expect(AggregateResultUtil.toStringOrNull(row({ n: 0 }), "n")).toBe("0");
  });

  it("renders a Date as ISO-8601 rather than a locale string", () => {
    /*
     * `String(new Date())` is a locale- and timezone-dependent human string,
     * which would make a MIN/MAX timestamp unparseable downstream. ISO is the
     * one form that round-trips.
     */
    const when: Date = new Date("2026-01-02T03:04:05.678Z");
    expect(AggregateResultUtil.toStringOrNull(row({ at: when }), "at")).toBe(
      "2026-01-02T03:04:05.678Z",
    );
  });

  it("does not throw when the row itself is missing", () => {
    expect(AggregateResultUtil.toStringOrNull(null, "siteId")).toBeNull();
    expect(AggregateResultUtil.toStringOrNull(undefined, "siteId")).toBeNull();
  });
});
