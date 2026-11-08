import ProductType from "../../../Types/MeteredPlan/ProductType";
import {
  addTelemetryUsageAmounts,
  getEmptyTelemetryUsageAmount,
  getTelemetryUsageDays,
  getTelemetryUsageRangeOfLastDays,
  getTelemetryUsageRetentionInDays,
  getTelemetryUsageWindow,
  isTelemetryProjectUsageSortBy,
  isTelemetryUsageProductType,
  parseTelemetryUsageDay,
  TELEMETRY_USAGE_DEFAULT_RANGE_IN_DAYS,
  TELEMETRY_USAGE_DEFAULT_RETENTION_IN_DAYS,
  TELEMETRY_USAGE_MAX_RANGE_IN_DAYS,
  TELEMETRY_USAGE_MAX_RETENTION_IN_DAYS,
  TELEMETRY_USAGE_MIN_RETENTION_IN_DAYS,
  TELEMETRY_USAGE_PRODUCT_TYPES,
  TELEMETRY_USAGE_RANGE_OPTIONS_IN_DAYS,
  toTelemetryUsageDay,
  TelemetryUsageWindow,
} from "../../../Types/Telemetry/TelemetryUsage";
import { TELEMETRY_USAGE_STAGING_LOOKBACK_IN_DAYS } from "../../../Server/Services/TelemetryUsageBillingService";
import { describe, expect, test } from "@jest/globals";

/*
 * The shared vocabulary of telemetry usage (issue #5916): which signals are
 * counted, how long the usage rows are kept, and the ranges of UTC days the
 * usage pages and their API read. The server, the Dashboard and the Admin
 * Dashboard all read these, so each is pinned here once.
 */

describe("the signals usage is counted for", () => {
  test("are every telemetry product, in the order the pages show them", () => {
    expect([...TELEMETRY_USAGE_PRODUCT_TYPES]).toEqual([
      ProductType.Logs,
      ProductType.Metrics,
      ProductType.Traces,
      ProductType.Profiles,
      ProductType.SessionReplay,
      ProductType.SecurityEvents,
    ]);
  });

  test("leave out what is not telemetry: active monitors and watched tables", () => {
    expect(isTelemetryUsageProductType(ProductType.ActiveMonitoring)).toBe(
      false,
    );
    expect(isTelemetryUsageProductType(ProductType.WatchedTables)).toBe(false);
    expect(isTelemetryUsageProductType("Exceptions")).toBe(false);
    expect(isTelemetryUsageProductType(undefined)).toBe(false);

    for (const productType of TELEMETRY_USAGE_PRODUCT_TYPES) {
      expect(isTelemetryUsageProductType(productType)).toBe(true);
    }
  });
});

describe("how long usage rows are kept", () => {
  test("is 120 days when nothing is saved", () => {
    expect(TELEMETRY_USAGE_DEFAULT_RETENTION_IN_DAYS).toBe(120);

    for (const empty of [undefined, null, 0, -5, Number.NaN]) {
      expect(getTelemetryUsageRetentionInDays(empty as never)).toBe(120);
    }
  });

  test("is what is saved, in whole days, inside its bounds", () => {
    expect(getTelemetryUsageRetentionInDays(30)).toBe(30);
    expect(getTelemetryUsageRetentionInDays(365)).toBe(365);
    expect(getTelemetryUsageRetentionInDays(90.9)).toBe(90);
    expect(getTelemetryUsageRetentionInDays(1095)).toBe(1095);
  });

  test("is never fewer than 30 days nor more than three years, whatever is saved", () => {
    expect(TELEMETRY_USAGE_MIN_RETENTION_IN_DAYS).toBe(30);
    expect(TELEMETRY_USAGE_MAX_RETENTION_IN_DAYS).toBe(1095);
    expect(getTelemetryUsageRetentionInDays(1)).toBe(30);
    expect(getTelemetryUsageRetentionInDays(29)).toBe(30);
    expect(getTelemetryUsageRetentionInDays(1096)).toBe(1095);
    expect(getTelemetryUsageRetentionInDays(100000)).toBe(1095);
  });

  test("outlasts metering's catch-up week by far, so a counted day is never deleted and counted again", () => {
    /*
     * A day deleted while still inside the staging window would have no
     * usage row any more, and the next run would stage it again - with
     * billing on, a second charge.
     */
    expect(TELEMETRY_USAGE_MIN_RETENTION_IN_DAYS).toBeGreaterThan(
      TELEMETRY_USAGE_STAGING_LOOKBACK_IN_DAYS + 1,
    );
  });
});

describe("the ranges the usage pages offer", () => {
  test("are the last 7, 30 or 90 days, opening on 30", () => {
    expect([...TELEMETRY_USAGE_RANGE_OPTIONS_IN_DAYS]).toEqual([7, 30, 90]);
    expect(TELEMETRY_USAGE_DEFAULT_RANGE_IN_DAYS).toBe(30);
    expect(TELEMETRY_USAGE_RANGE_OPTIONS_IN_DAYS).toContain(
      TELEMETRY_USAGE_DEFAULT_RANGE_IN_DAYS,
    );
  });

  test("end with yesterday in UTC: today is still being sent", () => {
    expect(
      getTelemetryUsageRangeOfLastDays(
        30,
        new Date("2026-11-08T09:30:00.000Z"),
      ),
    ).toEqual({ startDay: "2026-10-09", endDay: "2026-11-07" });

    expect(
      getTelemetryUsageRangeOfLastDays(7, new Date("2026-11-08T00:00:00.000Z")),
    ).toEqual({ startDay: "2026-11-01", endDay: "2026-11-07" });
  });

  test("keep UTC days just before midnight UTC, and across a month and a year", () => {
    expect(
      getTelemetryUsageRangeOfLastDays(1, new Date("2026-11-08T23:59:59.999Z")),
    ).toEqual({ startDay: "2026-11-07", endDay: "2026-11-07" });

    expect(
      getTelemetryUsageRangeOfLastDays(7, new Date("2027-01-03T05:00:00.000Z")),
    ).toEqual({ startDay: "2026-12-27", endDay: "2027-01-02" });
  });

  test("hold at least one day", () => {
    expect(
      getTelemetryUsageRangeOfLastDays(0, new Date("2026-11-08T09:30:00.000Z")),
    ).toEqual({ startDay: "2026-11-07", endDay: "2026-11-07" });
  });
});

describe("a day of a range", () => {
  test("is written YYYY-MM-DD, in UTC", () => {
    expect(toTelemetryUsageDay(new Date("2026-03-01T23:30:00.000Z"))).toBe(
      "2026-03-01",
    );
    expect(parseTelemetryUsageDay("2026-03-01")).toEqual(
      new Date("2026-03-01T00:00:00.000Z"),
    );
    expect(parseTelemetryUsageDay(" 2026-03-01 ")).toEqual(
      new Date("2026-03-01T00:00:00.000Z"),
    );
  });

  test.each([
    ["a day that does not exist", "2026-02-30"],
    ["a month that does not exist", "2026-13-01"],
    ["another format", "03/01/2026"],
    ["a timestamp", "2026-03-01T00:00:00Z"],
    ["a short year", "26-03-01"],
    ["nothing", ""],
    ["SQL", "2026-03-01' OR 1=1 --"],
  ])("is refused when it is %s", (_name: string, value: string) => {
    expect(parseTelemetryUsageDay(value)).toBeNull();
  });

  test("is refused when it is not text", () => {
    expect(parseTelemetryUsageDay(20260301)).toBeNull();
    expect(parseTelemetryUsageDay(undefined)).toBeNull();
    expect(parseTelemetryUsageDay(["2026-03-01"])).toBeNull();
  });
});

describe("the window a range reads", () => {
  test("runs from the first day's UTC midnight to the midnight after the last", () => {
    const window: TelemetryUsageWindow | string = getTelemetryUsageWindow({
      startDay: "2026-10-01",
      endDay: "2026-10-31",
    });

    expect(window).toEqual({
      start: new Date("2026-10-01T00:00:00.000Z"),
      end: new Date("2026-11-01T00:00:00.000Z"),
      days: 31,
    });
  });

  test("lists every day of it, oldest first, across the daylight saving change", () => {
    const window: TelemetryUsageWindow = getTelemetryUsageWindow({
      startDay: "2026-10-30",
      endDay: "2026-11-02",
    }) as TelemetryUsageWindow;

    expect(getTelemetryUsageDays(window)).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });

  test("may be one day", () => {
    const window: TelemetryUsageWindow = getTelemetryUsageWindow({
      startDay: "2026-10-30",
      endDay: "2026-10-30",
    }) as TelemetryUsageWindow;

    expect(window.days).toBe(1);
    expect(getTelemetryUsageDays(window)).toEqual(["2026-10-30"]);
  });

  test("says why a range is not one", () => {
    expect(getTelemetryUsageWindow({})).toBe(
      "startDay and endDay are required, as days written YYYY-MM-DD.",
    );
    expect(
      getTelemetryUsageWindow({ startDay: "2026-10-30", endDay: "2026-10-29" }),
    ).toBe("startDay must not be after endDay.");
  });

  test("is at most as long as usage is kept", () => {
    expect(TELEMETRY_USAGE_MAX_RANGE_IN_DAYS).toBe(
      TELEMETRY_USAGE_MAX_RETENTION_IN_DAYS,
    );

    const longest: TelemetryUsageWindow | string = getTelemetryUsageWindow({
      startDay: "2024-01-01",
      endDay: toTelemetryUsageDay(
        new Date(
          Date.UTC(2024, 0, 1) +
            (TELEMETRY_USAGE_MAX_RANGE_IN_DAYS - 1) * 24 * 60 * 60 * 1000,
        ),
      ),
    });

    expect(typeof longest).toBe("object");
    expect((longest as TelemetryUsageWindow).days).toBe(
      TELEMETRY_USAGE_MAX_RANGE_IN_DAYS,
    );

    expect(
      getTelemetryUsageWindow({ startDay: "2020-01-01", endDay: "2026-01-01" }),
    ).toBe("A range can be at most 1095 days long.");
  });
});

describe("amounts of usage", () => {
  test("add up, and carry a cost only when both do", () => {
    expect(
      addTelemetryUsageAmounts(
        { dataIngestedInGB: 1.5, totalCostInUSD: 0.25 },
        { dataIngestedInGB: 2, totalCostInUSD: 1 },
      ),
    ).toEqual({ dataIngestedInGB: 3.5, totalCostInUSD: 1.25 });

    expect(
      addTelemetryUsageAmounts(
        { dataIngestedInGB: 1.5, totalCostInUSD: 0.25 },
        { dataIngestedInGB: 2 },
      ),
    ).toEqual({ dataIngestedInGB: 3.5 });
  });

  test("start at nothing, with a zero cost only where cost is counted", () => {
    expect(getEmptyTelemetryUsageAmount(true)).toEqual({
      dataIngestedInGB: 0,
      totalCostInUSD: 0,
    });
    expect(getEmptyTelemetryUsageAmount(false)).toEqual({
      dataIngestedInGB: 0,
    });
    expect("totalCostInUSD" in getEmptyTelemetryUsageAmount(false)).toBe(
      false,
    );
  });
});

describe("what the project list sorts by", () => {
  test("is the total, the name, or a signal", () => {
    expect(isTelemetryProjectUsageSortBy("total")).toBe(true);
    expect(isTelemetryProjectUsageSortBy("name")).toBe(true);

    for (const productType of TELEMETRY_USAGE_PRODUCT_TYPES) {
      expect(isTelemetryProjectUsageSortBy(productType)).toBe(true);
    }

    expect(isTelemetryProjectUsageSortBy("cost")).toBe(false);
    expect(isTelemetryProjectUsageSortBy(ProductType.ActiveMonitoring)).toBe(
      false,
    );
    expect(isTelemetryProjectUsageSortBy("projectName; DROP")).toBe(false);
  });
});
