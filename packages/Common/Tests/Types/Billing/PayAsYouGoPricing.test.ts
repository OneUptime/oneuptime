import { describe, expect, it } from "@jest/globals";
import {
  ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
  PRICING_PAGE_URL,
  SESSION_REPLAY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_RETENTION_IN_DAYS,
  formatPriceInUSD,
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
