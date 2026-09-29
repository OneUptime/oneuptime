/*
 * The window a scheduled status page report covers.
 *
 * The reported bug: "is there a way to have the reports be sent out monthly,
 * i.e. to show July 1st - July 31st?" - it was not, because the window was
 * always "the last N days counted back from whenever the cron fired", so a
 * monthly report sent on 1 Aug covered 2 Jul - 1 Aug and never lined up with a
 * calendar month. These tests pin the calendar option that fixes it, the
 * timezone the boundaries are resolved in, and the rolling behaviour that
 * existing status pages keep.
 */

import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import PositiveNumber from "../../../Types/PositiveNumber";
import StatusPageReportPeriodType from "../../../Types/StatusPage/StatusPageReportPeriodType";
import Timezone from "../../../Types/Timezone";
import StatusPageReportPeriodUtil, {
  StatusPageReportPeriod,
} from "../../../Utils/StatusPage/ReportPeriod";
import { describe, expect, test } from "@jest/globals";

function every(intervalType: EventInterval, intervalCount: number): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = intervalType;
  recurring.intervalCount = new PositiveNumber(intervalCount);
  return recurring;
}

function iso(date: Date): string {
  return date.toISOString();
}

describe("StatusPageReportPeriodUtil.getReportPeriod", () => {
  describe("the previous calendar period", () => {
    test("a monthly report sent in August covers all of July", () => {
      const period: StatusPageReportPeriod =
        StatusPageReportPeriodUtil.getReportPeriod({
          periodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
          reportRecurringInterval: every(EventInterval.Month, 1),
          timezone: Timezone.UTC,
          sentAt: OneUptimeDate.fromString("2026-08-01T09:00:00.000Z"),
        });

      expect(iso(period.startDate)).toBe("2026-07-01T00:00:00.000Z");
      expect(iso(period.endDate)).toBe("2026-07-31T23:59:59.999Z");
      expect(period.periodName).toBe("July 2026");
      expect(period.reportDates).toBe("Jul 1, 2026 - Jul 31, 2026");
      expect(period.numberOfDays).toBe(31);
    });

    test("still covers July when the email goes out later in August", () => {
      /*
       * The period is the last WHOLE one, not "the month before this instant",
       * so moving the send time inside August must not slide the window.
       */
      const period: StatusPageReportPeriod =
        StatusPageReportPeriodUtil.getReportPeriod({
          periodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
          reportRecurringInterval: every(EventInterval.Month, 1),
          timezone: Timezone.UTC,
          sentAt: OneUptimeDate.fromString("2026-08-27T16:45:00.000Z"),
        });

      expect(iso(period.startDate)).toBe("2026-07-01T00:00:00.000Z");
      expect(period.periodName).toBe("July 2026");
    });

    test("resolves the month boundary in the report timezone, not the server's", () => {
      /*
       * 1 Aug 03:00 UTC is still 31 Jul in New York, so a status page reporting
       * in New York has not finished July yet and must report June.
       */
      const period: StatusPageReportPeriod =
        StatusPageReportPeriodUtil.getReportPeriod({
          periodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
          reportRecurringInterval: every(EventInterval.Month, 1),
          timezone: Timezone.AmericaNew_York,
          sentAt: OneUptimeDate.fromString("2026-08-01T03:00:00.000Z"),
        });

      // 1 Jun 00:00 EDT and 30 Jun 23:59:59.999 EDT, both UTC-4.
      expect(iso(period.startDate)).toBe("2026-06-01T04:00:00.000Z");
      expect(iso(period.endDate)).toBe("2026-07-01T03:59:59.999Z");
      expect(period.periodName).toBe("June 2026");
    });

    test("a quarterly report covers the three whole months before it", () => {
      const period: StatusPageReportPeriod =
        StatusPageReportPeriodUtil.getReportPeriod({
          periodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
          reportRecurringInterval: every(EventInterval.Month, 3),
          timezone: Timezone.UTC,
          sentAt: OneUptimeDate.fromString("2026-10-01T09:00:00.000Z"),
        });

      expect(iso(period.startDate)).toBe("2026-07-01T00:00:00.000Z");
      expect(iso(period.endDate)).toBe("2026-09-30T23:59:59.999Z");
      // Three months have no single name a reader knows, so it stays a range.
      expect(period.periodName).toBe("Jul 1, 2026 - Sep 30, 2026");
    });

    test("a weekly report covers Monday to Sunday", () => {
      // Wednesday 5 Aug 2026.
      const period: StatusPageReportPeriod =
        StatusPageReportPeriodUtil.getReportPeriod({
          periodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
          reportRecurringInterval: every(EventInterval.Week, 1),
          timezone: Timezone.UTC,
          sentAt: OneUptimeDate.fromString("2026-08-05T09:00:00.000Z"),
        });

      // Monday 27 Jul through Sunday 2 Aug.
      expect(iso(period.startDate)).toBe("2026-07-27T00:00:00.000Z");
      expect(iso(period.endDate)).toBe("2026-08-02T23:59:59.999Z");
      expect(period.periodName).toBe("the week of Jul 27, 2026");
      expect(period.numberOfDays).toBe(7);
    });

    test("a daily report covers yesterday", () => {
      const period: StatusPageReportPeriod =
        StatusPageReportPeriodUtil.getReportPeriod({
          periodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
          reportRecurringInterval: every(EventInterval.Day, 1),
          timezone: Timezone.UTC,
          sentAt: OneUptimeDate.fromString("2026-08-05T09:00:00.000Z"),
        });

      expect(iso(period.startDate)).toBe("2026-08-04T00:00:00.000Z");
      expect(iso(period.endDate)).toBe("2026-08-04T23:59:59.999Z");
      expect(period.periodName).toBe("Aug 4, 2026");
    });

    test("a yearly report covers the previous calendar year", () => {
      const period: StatusPageReportPeriod =
        StatusPageReportPeriodUtil.getReportPeriod({
          periodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
          reportRecurringInterval: every(EventInterval.Year, 1),
          timezone: Timezone.UTC,
          sentAt: OneUptimeDate.fromString("2026-01-01T00:05:00.000Z"),
        });

      expect(iso(period.startDate)).toBe("2025-01-01T00:00:00.000Z");
      expect(iso(period.endDate)).toBe("2025-12-31T23:59:59.999Z");
      expect(period.periodName).toBe("2025");
    });

    test("falls back to a daily period when no frequency is configured", () => {
      const period: StatusPageReportPeriod =
        StatusPageReportPeriodUtil.getReportPeriod({
          periodType: StatusPageReportPeriodType.PreviousCalendarPeriod,
          timezone: Timezone.UTC,
          sentAt: OneUptimeDate.fromString("2026-08-05T09:00:00.000Z"),
        });

      // Recurring's own default is every 1 day.
      expect(iso(period.startDate)).toBe("2026-08-04T00:00:00.000Z");
    });
  });

  describe("the rolling window", () => {
    test("ends when the report is sent and runs back the configured days", () => {
      const period: StatusPageReportPeriod =
        StatusPageReportPeriodUtil.getReportPeriod({
          periodType: StatusPageReportPeriodType.Rolling,
          reportDataInDays: 30,
          timezone: Timezone.UTC,
          sentAt: OneUptimeDate.fromString("2026-07-30T09:00:00.000Z"),
        });

      expect(iso(period.startDate)).toBe("2026-06-30T09:00:00.000Z");
      expect(iso(period.endDate)).toBe("2026-07-30T09:00:00.000Z");
      expect(period.periodName).toBe("the last 30 days");
    });

    test("keeps the reportDates string custom email templates were written against", () => {
      const period: StatusPageReportPeriod =
        StatusPageReportPeriodUtil.getReportPeriod({
          periodType: StatusPageReportPeriodType.Rolling,
          reportDataInDays: 30,
          timezone: Timezone.UTC,
          sentAt: OneUptimeDate.fromString("2026-07-30T09:00:00.000Z"),
        });

      expect(period.reportDates).toBe("30 days (Jun 30, 2026 - Jul 30, 2026)");
    });

    test("is what a status page with no period configured gets", () => {
      // Every column is null on status pages created before this setting existed.
      const period: StatusPageReportPeriod =
        StatusPageReportPeriodUtil.getReportPeriod({
          sentAt: OneUptimeDate.fromString("2026-07-30T09:00:00.000Z"),
        });

      expect(iso(period.startDate)).toBe("2026-06-30T09:00:00.000Z");
      expect(period.numberOfDays).toBe(
        StatusPageReportPeriodUtil.DEFAULT_REPORT_DATA_IN_DAYS,
      );
      expect(period.timezone).toBe(Timezone.UTC);
    });

    test("refuses a zero, negative or non-numeric day count", () => {
      for (const badValue of [0, -5, NaN, undefined]) {
        const period: StatusPageReportPeriod =
          StatusPageReportPeriodUtil.getReportPeriod({
            periodType: StatusPageReportPeriodType.Rolling,
            reportDataInDays: badValue as number,
            sentAt: OneUptimeDate.fromString("2026-07-30T09:00:00.000Z"),
          });

        expect(period.numberOfDays).toBe(
          StatusPageReportPeriodUtil.DEFAULT_REPORT_DATA_IN_DAYS,
        );
      }
    });
  });
});
