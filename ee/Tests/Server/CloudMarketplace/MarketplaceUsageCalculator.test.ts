import MarketplaceUsageCalculator, {
  MarketplaceUsageCharge,
  MarketplaceUsageInput,
} from "../../../Server/CloudMarketplace/MarketplaceUsageCalculator";
import { describe, expect, it } from "@jest/globals";

/*
 * What a marketplace-billed project is charged, in whole cents, for a period.
 * The prices are oneuptime.com's: a plan's per-user monthly price and $1 per
 * active monitor per month, accrued by the hour against the length of the
 * month the hour is in, plus telemetry already priced by the daily staging.
 * Nothing is charged during the plan's trial. The fraction of a cent is
 * carried, never rounded away or up.
 */

const HOUR_IN_MS: number = 60 * 60 * 1000;

const baseInput: (
  overrides?: Partial<MarketplaceUsageInput>,
) => MarketplaceUsageInput = (
  overrides?: Partial<MarketplaceUsageInput>,
): MarketplaceUsageInput => {
  return {
    periodStart: new Date("2026-10-16T09:00:00.000Z"),
    periodEnd: new Date("2026-10-16T10:00:00.000Z"),
    seats: 0,
    seatPricePerMonthInUSD: 0,
    trialEndsAt: null,
    activeMonitors: 0,
    activeMonitorPricePerMonthInUSD: 1,
    telemetryInUSD: 0,
    carriedInUSD: 0,
    ...overrides,
  };
};

describe("MarketplaceUsageCalculator.getMonthsInPeriod", () => {
  it("counts a whole month of hours as exactly one month", () => {
    expect(
      MarketplaceUsageCalculator.getMonthsInPeriod({
        periodStart: new Date("2026-10-01T00:00:00.000Z"),
        periodEnd: new Date("2026-11-01T00:00:00.000Z"),
        notBefore: null,
      }),
    ).toBeCloseTo(1, 12);
  });

  it("weighs an hour by the length of the month it is in", () => {
    const februaryHour: number = MarketplaceUsageCalculator.getMonthsInPeriod({
      periodStart: new Date("2027-02-10T00:00:00.000Z"),
      periodEnd: new Date("2027-02-10T01:00:00.000Z"),
      notBefore: null,
    });
    const octoberHour: number = MarketplaceUsageCalculator.getMonthsInPeriod({
      periodStart: new Date("2026-10-10T00:00:00.000Z"),
      periodEnd: new Date("2026-10-10T01:00:00.000Z"),
      notBefore: null,
    });

    expect(februaryHour).toBeCloseTo(1 / (28 * 24), 12);
    expect(octoberHour).toBeCloseTo(1 / (31 * 24), 12);
  });

  it("splits a period that crosses a month boundary between the two months", () => {
    // 23:00 on 31 October to 01:00 on 1 November: one October hour, one November hour.
    const months: number = MarketplaceUsageCalculator.getMonthsInPeriod({
      periodStart: new Date("2026-10-31T23:00:00.000Z"),
      periodEnd: new Date("2026-11-01T01:00:00.000Z"),
      notBefore: null,
    });

    expect(months).toBeCloseTo(1 / (31 * 24) + 1 / (30 * 24), 12);
  });

  it("does not count time before notBefore (a trial)", () => {
    expect(
      MarketplaceUsageCalculator.getMonthsInPeriod({
        periodStart: new Date("2026-10-16T09:00:00.000Z"),
        periodEnd: new Date("2026-10-16T10:00:00.000Z"),
        notBefore: new Date("2026-10-16T09:30:00.000Z"),
      }),
    ).toBeCloseTo(0.5 / (31 * 24), 12);

    expect(
      MarketplaceUsageCalculator.getMonthsInPeriod({
        periodStart: new Date("2026-10-16T09:00:00.000Z"),
        periodEnd: new Date("2026-10-16T10:00:00.000Z"),
        notBefore: new Date("2026-10-30T00:00:00.000Z"),
      }),
    ).toBe(0);
  });

  it("is zero for an empty or backwards period", () => {
    const at: Date = new Date("2026-10-16T09:00:00.000Z");

    expect(
      MarketplaceUsageCalculator.getMonthsInPeriod({
        periodStart: at,
        periodEnd: at,
        notBefore: null,
      }),
    ).toBe(0);
    expect(
      MarketplaceUsageCalculator.getMonthsInPeriod({
        periodStart: new Date(at.getTime() + HOUR_IN_MS),
        periodEnd: at,
        notBefore: null,
      }),
    ).toBe(0);
  });

  it("caps a period at about three months, however long the reporter was away", () => {
    const months: number = MarketplaceUsageCalculator.getMonthsInPeriod({
      periodStart: new Date("2020-01-01T00:00:00.000Z"),
      periodEnd: new Date("2026-01-01T00:00:00.000Z"),
      notBefore: null,
    });

    expect(months).toBeGreaterThan(2.9);
    expect(months).toBeLessThan(3.1);
  });
});

describe("MarketplaceUsageCalculator.calculate", () => {
  it("bills a month of a $22 plan for 10 users as $220.00 - 22000 units", () => {
    const charge: MarketplaceUsageCharge = MarketplaceUsageCalculator.calculate(
      baseInput({
        periodStart: new Date("2026-10-01T00:00:00.000Z"),
        periodEnd: new Date("2026-11-01T00:00:00.000Z"),
        seats: 10,
        seatPricePerMonthInUSD: 22,
      }),
    );

    expect(charge.quantity).toBe(22000);
    expect(charge.carriedOutInUSD).toBe(0);
    expect(charge.breakdown["seatsInUSD"]).toBe(220);
  });

  it("adds hour after hour up to exactly the monthly price, carrying fractions of a cent", () => {
    // One user on $22 for every hour of October (744 hours), reported hourly.
    let carried: number = 0;
    let totalUnits: number = 0;
    let start: number = new Date("2026-10-01T00:00:00.000Z").getTime();
    const end: number = new Date("2026-11-01T00:00:00.000Z").getTime();

    while (start < end) {
      const charge: MarketplaceUsageCharge =
        MarketplaceUsageCalculator.calculate(
          baseInput({
            periodStart: new Date(start),
            periodEnd: new Date(start + HOUR_IN_MS),
            seats: 1,
            seatPricePerMonthInUSD: 22,
            carriedInUSD: carried,
          }),
        );

      expect(charge.carriedOutInUSD).toBeGreaterThanOrEqual(0);
      expect(charge.carriedOutInUSD).toBeLessThan(0.01);

      totalUnits += charge.quantity;
      carried = charge.carriedOutInUSD;
      start += HOUR_IN_MS;
    }

    // $22.00 to the cent: nothing lost to rounding, nothing billed twice.
    expect(totalUnits + Math.round(carried * 100)).toBe(2200);
    expect(totalUnits).toBeGreaterThanOrEqual(2199);
  });

  it("bills active monitors at $1 per monitor per month", () => {
    const charge: MarketplaceUsageCharge = MarketplaceUsageCalculator.calculate(
      baseInput({
        periodStart: new Date("2026-11-01T00:00:00.000Z"),
        periodEnd: new Date("2026-12-01T00:00:00.000Z"),
        activeMonitors: 7,
      }),
    );

    expect(charge.quantity).toBe(700);
  });

  it("bills staged telemetry as it is, in cents, carrying the remainder", () => {
    const charge: MarketplaceUsageCharge = MarketplaceUsageCalculator.calculate(
      baseInput({ telemetryInUSD: 1.23456 }),
    );

    expect(charge.quantity).toBe(123);
    expect(charge.carriedOutInUSD).toBeCloseTo(0.00456, 10);
  });

  it("adds the fraction carried in from the last report", () => {
    const charge: MarketplaceUsageCharge = MarketplaceUsageCalculator.calculate(
      baseInput({ telemetryInUSD: 0.006, carriedInUSD: 0.005 }),
    );

    expect(charge.quantity).toBe(1);
    expect(charge.carriedOutInUSD).toBeCloseTo(0.001, 10);
  });

  it("charges nothing for seats or monitors during the plan's trial, as card billing does", () => {
    const charge: MarketplaceUsageCharge = MarketplaceUsageCalculator.calculate(
      baseInput({
        periodStart: new Date("2026-10-01T00:00:00.000Z"),
        periodEnd: new Date("2026-11-01T00:00:00.000Z"),
        seats: 5,
        seatPricePerMonthInUSD: 99,
        trialEndsAt: new Date("2026-12-01T00:00:00.000Z"),
        activeMonitors: 3,
      }),
    );

    expect(charge.breakdown["seatsInUSD"]).toBe(0);
    expect(charge.breakdown["activeMonitorsInUSD"]).toBe(0);
    expect(charge.quantity).toBe(0);
  });

  it("starts charging seats and monitors the moment the trial ends", () => {
    // The trial ends at the start of 16 October: 16 of October's 31 days are billable.
    const charge: MarketplaceUsageCharge = MarketplaceUsageCalculator.calculate(
      baseInput({
        periodStart: new Date("2026-10-01T00:00:00.000Z"),
        periodEnd: new Date("2026-11-01T00:00:00.000Z"),
        seats: 5,
        seatPricePerMonthInUSD: 99,
        trialEndsAt: new Date("2026-10-16T00:00:00.000Z"),
        activeMonitors: 3,
      }),
    );

    expect(charge.breakdown["seatsInUSD"]).toBeCloseTo((5 * 99 * 16) / 31, 5);
    expect(charge.breakdown["activeMonitorsInUSD"]).toBeCloseTo(
      (3 * 16) / 31,
      5,
    );
  });

  it("still charges the telemetry it is given: the reporter leaves the trial's days out", () => {
    const charge: MarketplaceUsageCharge = MarketplaceUsageCalculator.calculate(
      baseInput({
        trialEndsAt: new Date("2026-12-01T00:00:00.000Z"),
        telemetryInUSD: 1,
      }),
    );

    expect(charge.quantity).toBe(100);
  });

  it("adds one-off charges as they are, and never waives them for a trial", () => {
    const charge: MarketplaceUsageCharge = MarketplaceUsageCalculator.calculate(
      baseInput({
        seats: 5,
        seatPricePerMonthInUSD: 99,
        trialEndsAt: new Date("2026-12-01T00:00:00.000Z"),
        activeMonitors: 3,
        chargesInUSD: 20.005,
      }),
    );

    expect(charge.breakdown["seatsInUSD"]).toBe(0);
    expect(charge.breakdown["activeMonitorsInUSD"]).toBe(0);
    expect(charge.breakdown["chargesInUSD"]).toBe(20.005);
    expect(charge.quantity).toBe(2000);
    expect(charge.carriedOutInUSD).toBeCloseTo(0.005, 10);
  });

  it("counts no charges when none are given", () => {
    expect(
      MarketplaceUsageCalculator.calculate(baseInput({})).breakdown[
        "chargesInUSD"
      ],
    ).toBe(0);
    expect(
      MarketplaceUsageCalculator.calculate(baseInput({ chargesInUSD: -20 }))
        .quantity,
    ).toBe(0);
  });

  it("treats negative, missing and non-finite inputs as nothing to charge", () => {
    const charge: MarketplaceUsageCharge = MarketplaceUsageCalculator.calculate(
      baseInput({
        seats: -3,
        seatPricePerMonthInUSD: Number.NaN,
        activeMonitors: Number.POSITIVE_INFINITY,
        telemetryInUSD: -5,
        carriedInUSD: -1,
      }),
    );

    expect(charge.quantity).toBe(0);
    expect(charge.totalInUSD).toBe(0);
    expect(charge.carriedOutInUSD).toBe(0);
  });

  it("explains every unit in the breakdown", () => {
    const charge: MarketplaceUsageCharge = MarketplaceUsageCalculator.calculate(
      baseInput({
        seats: 2,
        seatPricePerMonthInUSD: 22,
        activeMonitors: 1,
        telemetryInUSD: 0.5,
        carriedInUSD: 0.004,
      }),
    );

    expect(charge.breakdown).toMatchObject({
      seats: 2,
      seatPricePerMonthInUSD: 22,
      activeMonitors: 1,
      telemetryInUSD: 0.5,
      carriedInUSD: 0.004,
      units: charge.quantity,
    });

    const parts: number =
      (charge.breakdown["seatsInUSD"] as number) +
      (charge.breakdown["activeMonitorsInUSD"] as number) +
      (charge.breakdown["telemetryInUSD"] as number) +
      (charge.breakdown["chargesInUSD"] as number) +
      (charge.breakdown["carriedInUSD"] as number);

    expect(parts).toBeCloseTo(charge.totalInUSD, 6);
    expect(charge.quantity * 0.01 + charge.carriedOutInUSD).toBeCloseTo(
      charge.totalInUSD,
      6,
    );
  });
});
