import { describe, expect, test } from "@jest/globals";
import DataAssetKind from "../../../Types/DataObservability/DataAssetKind";
import {
  DataAssetFreshness,
  getDataAssetFreshness,
  MIN_LATENESS_SLACK_IN_SECONDS,
} from "../../../Types/DataObservability/DataAssetFreshness";

/*
 * FRESH OR LATE, AS THE CATALOG SHOWS IT.
 *
 * A table is late once it has gone twice its usual interval without a
 * change and at least fifteen minutes past it: a busy table is not late
 * after a quiet minute, and a nightly table is late the morning its load
 * does not come.
 */

const NOW: Date = new Date("2026-11-03T12:00:00.000Z");

function secondsAgo(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1000);
}

describe("getDataAssetFreshness", () => {
  test("a table that changed within its usual interval is Fresh", () => {
    expect(
      getDataAssetFreshness({
        kind: DataAssetKind.Table,
        lastChangedAt: secondsAgo(3000),
        updateIntervalInSeconds: 3600,
        now: NOW,
      }).freshness,
    ).toBe(DataAssetFreshness.Fresh);
  });

  test("an hourly table is Late once two hours pass without a change", () => {
    const result: ReturnType<typeof getDataAssetFreshness> =
      getDataAssetFreshness({
        kind: DataAssetKind.Table,
        lastChangedAt: secondsAgo(7200 + 60),
        updateIntervalInSeconds: 3600,
        now: NOW,
      });

    expect(result.freshness).toBe(DataAssetFreshness.Late);
    expect(result.overdueBySeconds).toBe(60);
  });

  test("a table that changes every minute gets fifteen minutes' slack, not two minutes", () => {
    expect(
      getDataAssetFreshness({
        kind: DataAssetKind.Table,
        lastChangedAt: secondsAgo(10 * 60),
        updateIntervalInSeconds: 60,
        now: NOW,
      }).freshness,
    ).toBe(DataAssetFreshness.Fresh);

    expect(
      getDataAssetFreshness({
        kind: DataAssetKind.Table,
        lastChangedAt: secondsAgo(60 + MIN_LATENESS_SLACK_IN_SECONDS + 1),
        updateIntervalInSeconds: 60,
        now: NOW,
      }).freshness,
    ).toBe(DataAssetFreshness.Late);
  });

  test("without a last change or a learned interval, freshness is Unknown", () => {
    expect(
      getDataAssetFreshness({
        kind: DataAssetKind.Table,
        lastChangedAt: null,
        updateIntervalInSeconds: 3600,
        now: NOW,
      }).freshness,
    ).toBe(DataAssetFreshness.Unknown);

    expect(
      getDataAssetFreshness({
        kind: DataAssetKind.Table,
        lastChangedAt: secondsAgo(10),
        updateIntervalInSeconds: null,
        now: NOW,
      }).freshness,
    ).toBe(DataAssetFreshness.Unknown);
  });

  test("a view holds no rows of its own, so freshness does not apply", () => {
    expect(
      getDataAssetFreshness({
        kind: DataAssetKind.View,
        lastChangedAt: secondsAgo(999_999),
        updateIntervalInSeconds: 60,
        now: NOW,
      }).freshness,
    ).toBe(DataAssetFreshness.NotApplicable);
  });

  test("says when a fresh table will become late", () => {
    const lastChangedAt: Date = secondsAgo(100);

    expect(
      getDataAssetFreshness({
        kind: DataAssetKind.Table,
        lastChangedAt,
        updateIntervalInSeconds: 3600,
        now: NOW,
      }).lateAt?.getTime(),
    ).toBe(lastChangedAt.getTime() + 7200 * 1000);
  });
});
