import { JSONObject } from "../../../Types/JSON";
import { MARKETPLACE_USAGE_UNIT_IN_USD } from "../../../Types/Marketplace/MarketplacePurchase";

/*
 * What a marketplace-billed project owes for one period, in usage units of
 * one cent - the same charges a card-billed project pays, at the same prices
 * (oneuptime.com/pricing):
 *
 *   - its plan's per-user monthly price, for each user (seat), accrued by the
 *     hour - an hour costs the monthly price divided by the hours in that
 *     month, so a month of hours is exactly the monthly price; no charge
 *     while the project is in its trial;
 *   - each active monitor's monthly price, accrued the same way;
 *   - the telemetry it ingested, as already priced per GB and retention by
 *     the daily telemetry staging (TelemetryUsageBilling).
 *
 * A marketplace bills whole units, so the fraction of a cent left over is
 * carried into the next report rather than rounded away or up. Amounts are
 * added up in millionths of a dollar, so repeated small charges do not drift.
 */

export interface MarketplaceUsageInput {
  periodStart: Date;
  periodEnd: Date;
  seats: number;
  seatPricePerMonthInUSD: number;
  // Seats are free until then (the plan's trial).
  trialEndsAt?: Date | null | undefined;
  activeMonitors: number;
  activeMonitorPricePerMonthInUSD: number;
  telemetryInUSD: number;
  carriedInUSD: number;
}

export interface MarketplaceUsageCharge {
  quantity: number;
  carriedOutInUSD: number;
  totalInUSD: number;
  breakdown: JSONObject;
}

const MICROS_PER_USD: number = 1_000_000;
const MICROS_PER_UNIT: number = Math.round(
  MARKETPLACE_USAGE_UNIT_IN_USD * MICROS_PER_USD,
);
const MS_PER_HOUR: number = 60 * 60 * 1000;
// A report covers at most this much time; a longer gap is the reporter having been down for weeks.
const MAX_PERIOD_IN_HOURS: number = 31 * 24 * 3;

export default class MarketplaceUsageCalculator {
  public static calculate(input: MarketplaceUsageInput): MarketplaceUsageCharge {
    const monthsOfSeats: number = MarketplaceUsageCalculator.getMonthsInPeriod({
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      notBefore: input.trialEndsAt || null,
    });

    const monthsOfMonitors: number =
      MarketplaceUsageCalculator.getMonthsInPeriod({
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        notBefore: null,
      });

    const seatsMicros: number = MarketplaceUsageCalculator.toMicros(
      MarketplaceUsageCalculator.nonNegative(input.seats) *
        MarketplaceUsageCalculator.nonNegative(input.seatPricePerMonthInUSD) *
        monthsOfSeats,
    );

    const monitorsMicros: number = MarketplaceUsageCalculator.toMicros(
      MarketplaceUsageCalculator.nonNegative(input.activeMonitors) *
        MarketplaceUsageCalculator.nonNegative(
          input.activeMonitorPricePerMonthInUSD,
        ) *
        monthsOfMonitors,
    );

    const telemetryMicros: number = MarketplaceUsageCalculator.toMicros(
      MarketplaceUsageCalculator.nonNegative(input.telemetryInUSD),
    );

    const carriedInMicros: number = MarketplaceUsageCalculator.toMicros(
      MarketplaceUsageCalculator.nonNegative(input.carriedInUSD),
    );

    const totalMicros: number =
      seatsMicros + monitorsMicros + telemetryMicros + carriedInMicros;

    const quantity: number = Math.floor(totalMicros / MICROS_PER_UNIT);
    const carriedOutMicros: number = totalMicros - quantity * MICROS_PER_UNIT;

    return {
      quantity: quantity,
      carriedOutInUSD: carriedOutMicros / MICROS_PER_USD,
      totalInUSD: totalMicros / MICROS_PER_USD,
      breakdown: {
        seats: input.seats,
        seatPricePerMonthInUSD: input.seatPricePerMonthInUSD,
        seatsInUSD: seatsMicros / MICROS_PER_USD,
        activeMonitors: input.activeMonitors,
        activeMonitorPricePerMonthInUSD: input.activeMonitorPricePerMonthInUSD,
        activeMonitorsInUSD: monitorsMicros / MICROS_PER_USD,
        telemetryInUSD: telemetryMicros / MICROS_PER_USD,
        carriedInUSD: carriedInMicros / MICROS_PER_USD,
        carriedOutInUSD: carriedOutMicros / MICROS_PER_USD,
        totalInUSD: totalMicros / MICROS_PER_USD,
        units: quantity,
      },
    };
  }

  /*
   * How many months the period is, counting each hour against the length of
   * the month it falls in (UTC) - so January's hours and February's hours
   * each add up to one month. Hours before `notBefore` do not count. Partial
   * hours count by the minute.
   */
  public static getMonthsInPeriod(data: {
    periodStart: Date;
    periodEnd: Date;
    notBefore: Date | null;
  }): number {
    let start: number = data.periodStart.getTime();
    const end: number = Math.min(
      data.periodEnd.getTime(),
      start + MAX_PERIOD_IN_HOURS * MS_PER_HOUR,
    );

    if (data.notBefore && data.notBefore.getTime() > start) {
      start = data.notBefore.getTime();
    }

    if (!(end > start)) {
      return 0;
    }

    let months: number = 0;
    let cursor: number = start;

    while (cursor < end) {
      const cursorDate: Date = new Date(cursor);
      const nextMonth: number = Date.UTC(
        cursorDate.getUTCFullYear(),
        cursorDate.getUTCMonth() + 1,
        1,
      );
      const sliceEnd: number = Math.min(end, nextMonth);
      const monthStart: number = Date.UTC(
        cursorDate.getUTCFullYear(),
        cursorDate.getUTCMonth(),
        1,
      );
      const monthLength: number = nextMonth - monthStart;

      months += (sliceEnd - cursor) / monthLength;
      cursor = sliceEnd;
    }

    return months;
  }

  private static toMicros(amountInUSD: number): number {
    return Math.round(amountInUSD * MICROS_PER_USD);
  }

  private static nonNegative(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }
}
