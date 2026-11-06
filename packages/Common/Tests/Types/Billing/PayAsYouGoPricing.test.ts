import { describe, expect, it } from "@jest/globals";
import {
  ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
  PRICING_PAGE_URL,
  SESSION_REPLAY_PRICE_IN_USD_PER_GB,
  TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS,
  TELEMETRY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_RETENTION_IN_DAYS,
  formatPriceInUSD,
  DEFAULT_WATCHED_TABLE_PRICING,
  describeWatchedTablePricing,
  getWatchedTablesCostInCents,
  getWatchedTablesCostInUSD,
  WatchedTablePricing,
} from "../../../Types/Billing/PayAsYouGoPricing";

/*
 * These constants are quoted to users, verbatim, on the telemetry ingestion
 * key and create monitor pages. They are pinned here because changing one
 * silently changes what the product promises a customer - a change to any of
 * them has to be deliberate, and has to be made on the pricing page too.
 */

describe("PayAsYouGoPricing", () => {
  describe("rates", () => {
    it("charges $0.10 per GB of telemetry, quoted for 15 day retention", () => {
      expect(TELEMETRY_PRICE_IN_USD_PER_GB).toBe(0.1);
      expect(TELEMETRY_PRICE_RETENTION_IN_DAYS).toBe(15);
    });

    it("bills telemetry for at least 7 days of retention, a whole number of days under the quoted 15", () => {
      expect(TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS).toBe(7);
      expect(
        Number.isInteger(TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS),
      ).toBe(true);
      expect(TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS).toBeGreaterThan(0);
      // The advertised price, quoted for 15 days, is not raised by it.
      expect(TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS).toBeLessThan(
        TELEMETRY_PRICE_RETENTION_IN_DAYS,
      );
    });

    it("charges $2 per GB for session replay, on the same 15 day window", () => {
      expect(SESSION_REPLAY_PRICE_IN_USD_PER_GB).toBe(2);
    });

    it("charges $1 per active monitor per month", () => {
      expect(ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH).toBe(1);
    });

    it("points at the public pricing page", () => {
      expect(PRICING_PAGE_URL).toBe("https://oneuptime.com/pricing");
    });
  });

  describe("formatPriceInUSD", () => {
    it("writes a whole number of dollars without cents, like the pricing page", () => {
      expect(formatPriceInUSD(1)).toBe("$1");
      expect(formatPriceInUSD(22)).toBe("$22");
      expect(formatPriceInUSD(0)).toBe("$0");
    });

    it("writes a fractional amount with two decimal places", () => {
      expect(formatPriceInUSD(0.1)).toBe("$0.10");
      expect(formatPriceInUSD(1.5)).toBe("$1.50");
      expect(formatPriceInUSD(2.05)).toBe("$2.05");
    });

    it("rounds to cents rather than spilling extra digits into the copy", () => {
      expect(formatPriceInUSD(0.125)).toBe("$0.13");
      expect(formatPriceInUSD(0.006)).toBe("$0.01");
    });

    it("renders the advertised rates exactly as the pricing page writes them", () => {
      expect(formatPriceInUSD(TELEMETRY_PRICE_IN_USD_PER_GB)).toBe("$0.10");
      expect(formatPriceInUSD(SESSION_REPLAY_PRICE_IN_USD_PER_GB)).toBe("$2");
      expect(formatPriceInUSD(ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH)).toBe(
        "$1",
      );
    });
  });
});

describe("Watched table pricing", () => {
  test.each([
    [0, 0],
    [60, 0],
    [100, 0],
    [101, 1],
    [500, 400],
    [1000, 900],
    [1001, 900.25],
    [5000, 1900],
  ])("%i tables cost $%f a month", (tableCount: number, cost: number) => {
    expect(
      getWatchedTablesCostInUSD(tableCount, DEFAULT_WATCHED_TABLE_PRICING),
    ).toBe(cost);
    expect(
      getWatchedTablesCostInCents(tableCount, DEFAULT_WATCHED_TABLE_PRICING),
    ).toBe(cost * 100);
  });

  test("a threshold inside the free tables charges every billed table the volume price", () => {
    const pricing: WatchedTablePricing = {
      includedTables: 100,
      pricePerTableInUSD: 1,
      volumeThresholdInTables: 10,
      volumePricePerTableInUSD: 0.25,
    };

    expect(getWatchedTablesCostInUSD(50, pricing)).toBe(0);
    expect(getWatchedTablesCostInUSD(200, pricing)).toBe(25);
  });

  test("no free tables bills from the first", () => {
    const pricing: WatchedTablePricing = {
      ...DEFAULT_WATCHED_TABLE_PRICING,
      includedTables: 0,
    };

    expect(getWatchedTablesCostInUSD(1, pricing)).toBe(1);
    expect(describeWatchedTablePricing(pricing)).toBe(
      "$1 per table a month, $0.25 above 1,000",
    );
  });

  test("whole cents survive floating point", () => {
    const pricing: WatchedTablePricing = {
      ...DEFAULT_WATCHED_TABLE_PRICING,
      includedTables: 0,
      pricePerTableInUSD: 0.1,
    };

    expect(getWatchedTablesCostInCents(3, pricing)).toBe(30);
  });

  test("says the rates as the pricing page writes them", () => {
    expect(describeWatchedTablePricing(DEFAULT_WATCHED_TABLE_PRICING)).toBe(
      "First 100 tables free, then $1 per table a month, $0.25 above 1,000",
    );
    expect(
      describeWatchedTablePricing({
        ...DEFAULT_WATCHED_TABLE_PRICING,
        volumePricePerTableInUSD: 1,
      }),
    ).toBe("First 100 tables free, then $1 per table a month");
  });
});
