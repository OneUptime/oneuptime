import { MarketplaceUsageHour } from "../../../Server/CloudMarketplace/MarketplaceAdapter";
import { describe, expect, it } from "@jest/globals";

/*
 * Where a usage report is filed in time. AWS and Microsoft keep one record
 * per purchase and hour, so every report of a purchase needs an hour of its
 * own: an hourly report (which ends on the hour) in the hour it covers, and a
 * final one (which ends part way through an hour) in that hour - never in the
 * hour of the hourly report before it.
 */
describe("MarketplaceUsageHour", () => {
  it("files an hourly report in the hour it covers", () => {
    const periodEnd: Date = new Date("2026-10-16T10:00:00.000Z");

    expect(MarketplaceUsageHour.getHour(periodEnd)).toEqual(
      new Date("2026-10-16T09:00:00.000Z"),
    );
    expect(MarketplaceUsageHour.getFilingTime(periodEnd)).toEqual(
      new Date("2026-10-16T09:59:00.000Z"),
    );
  });

  it("files a final report in the hour it ends in, after the hourly report before it", () => {
    const hourly: Date = MarketplaceUsageHour.getHour(
      new Date("2026-10-16T10:00:00.000Z"),
    );
    const final: Date = MarketplaceUsageHour.getHour(
      new Date("2026-10-16T10:42:17.250Z"),
    );

    expect(final).toEqual(new Date("2026-10-16T10:00:00.000Z"));
    expect(final.getTime()).toBeGreaterThan(hourly.getTime());
    expect(
      MarketplaceUsageHour.getFilingTime(new Date("2026-10-16T10:42:17.250Z")),
    ).toEqual(new Date("2026-10-16T10:41:17.250Z"));
  });

  it("files a report ending in the first minute of an hour in the hour before", () => {
    expect(
      MarketplaceUsageHour.getHour(new Date("2026-10-16T11:00:30.000Z")),
    ).toEqual(new Date("2026-10-16T10:00:00.000Z"));
    expect(
      MarketplaceUsageHour.getHour(new Date("2026-10-16T11:01:00.000Z")),
    ).toEqual(new Date("2026-10-16T11:00:00.000Z"));
  });

  it("files each hour's report in a different hour, across a day and a month", () => {
    const hours: Set<number> = new Set<number>();
    let periodEnd: number = Date.UTC(2026, 9, 31, 20);

    for (let index: number = 0; index < 10; index++) {
      periodEnd += 60 * 60 * 1000;
      hours.add(MarketplaceUsageHour.getHour(new Date(periodEnd)).getTime());
    }

    expect(hours.size).toBe(10);
  });

  it("never changes the date it is handed", () => {
    const periodEnd: Date = new Date("2026-10-16T10:42:17.250Z");

    MarketplaceUsageHour.getHour(periodEnd);
    MarketplaceUsageHour.getFilingTime(periodEnd);

    expect(periodEnd).toEqual(new Date("2026-10-16T10:42:17.250Z"));
  });
});
