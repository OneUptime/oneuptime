import { describe, expect, test } from "@jest/globals";
import {
  AzureReadGroup,
  getAzureReadGroups,
} from "../../../Server/Utils/CloudConnection/Azure/AzureCloudConnector";
import {
  AZURE_HOURLY_GRAIN,
  AZURE_KEY_METRICS,
  AZURE_SIX_HOURLY_GRAIN,
  AzureKeyMetric,
  CloudKeyMetricCadence,
  getAzureKeyMetricCadence,
  getAzureStoredMetricName,
} from "../../../Types/Cloud/CloudKeyMetrics";
import {
  AZURE_HOURLY_READING_HOLD_MS,
  AZURE_SIX_HOURLY_READING_HOLD_MS,
  AZURE_SIX_HOURLY_READING_PERIOD_SECONDS,
  CLOUD_READINGS_STALE_MS,
  CloudHeadlineReading,
  CloudResourceReading,
  CloudResourceReadings,
  HEADLINE_STORAGE_USED,
  getCloudHeadlineReadings,
  getCloudReadingAgeMs,
  getCloudReadingHoldMs,
  getCloudReadingKey,
  getCloudReadingPeriodSeconds,
  isCloudHeadlineExpected,
  withHeldCloudReadings,
} from "../../../Types/Cloud/CloudResourceHealth";
import { isCloudReadingKeyOfType } from "../../../Types/Cloud/CloudReadingKeys";
import { CLOUD_CONNECTION_READ_INTERVALS } from "../../../Types/CloudConnection/CloudConnectionCatalog";

/*
 * #10026: AN APP SERVICE APP'S SIX-HOURLY FILESYSTEMUSAGE, KEPT BETWEEN ITS
 * READS.
 *
 * Azure Monitor keeps an App Service app's FileSystemUsage at six hours at
 * its finest. A connection reads it once six whole hours are there - six
 * hours after they end, as a window of an hour or more waits a whole
 * period - so its newest point is 12 hours old when read, and the next
 * comes six hours later. A read that brings none now keeps the reading
 * before while its datapoint is younger than its own hold, 19 hours, the
 * way an hourly one is kept for 4 (#9982), and drops it after; its tile,
 * the app's Storage used, says how old it is.
 */

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const NOW: Date = new Date("2026-11-19T10:00:00.000Z");
const SITES: string = "Microsoft.Web/sites";
const FILE_SYSTEM: string = "filesystemusage";

function hoursAgo(hours: number, value: number): CloudResourceReading {
  return {
    value,
    time: new Date(NOW.getTime() - hours * HOUR_MS).toISOString(),
    metric: "azure_filesystemusage_average",
  };
}

// Every Azure key metric marked with a grain, as its type, name and mark.
function markedMetrics(
  grain: string,
): Array<{ type: string; name: string; key: string }> {
  const marked: Array<{ type: string; name: string; key: string }> = [];

  for (const entry of AZURE_KEY_METRICS) {
    for (const metric of entry.metrics as Array<AzureKeyMetric>) {
      if (metric.grain === grain) {
        marked.push({
          type: entry.type,
          name: metric.name,
          key: getCloudReadingKey(
            "azure",
            getAzureStoredMetricName(metric.name, "average"),
          )!,
        });
      }
    }
  }

  return marked;
}

describe("which readings are kept as six-hourly ones, and for how long", () => {
  test("an App Service app's FileSystemUsage is the one key metric kept at six hours, and comes every 6 hours", () => {
    expect(markedMetrics(AZURE_SIX_HOURLY_GRAIN)).toEqual([
      { type: SITES, name: "FileSystemUsage", key: FILE_SYSTEM },
    ]);

    const metric: AzureKeyMetric | undefined = AZURE_KEY_METRICS.find(
      (entry: { type: string }): boolean => {
        return entry.type === SITES;
      },
    )?.metrics.find((candidate: AzureKeyMetric): boolean => {
      return candidate.name === "FileSystemUsage";
    });

    expect(getAzureKeyMetricCadence(metric!)).toBe(
      CloudKeyMetricCadence.SixHourly,
    );
    // Not an hourly one: the hourly marks are #9982's, untouched.
    expect(
      markedMetrics(AZURE_HOURLY_GRAIN).map(
        (item: { name: string }): string => {
          return item.name;
        },
      ),
    ).not.toContain("FileSystemUsage");
  });

  test("it is held 19 hours, an hourly one 4, and every other App Service reading not at all", () => {
    expect(
      getCloudReadingHoldMs({
        provider: "azure",
        type: SITES,
        key: FILE_SYSTEM,
      }),
    ).toBe(AZURE_SIX_HOURLY_READING_HOLD_MS);
    expect(AZURE_SIX_HOURLY_READING_HOLD_MS).toBe(19 * HOUR_MS);
    expect(AZURE_HOURLY_READING_HOLD_MS).toBe(4 * HOUR_MS);

    for (const key of ["requests", "http5xx", "memoryworkingset"]) {
      expect(
        getCloudReadingHoldMs({ provider: "azure", type: SITES, key }),
      ).toBe(null);
    }

    // Of another type, a file system of the same name is not held.
    expect(
      getCloudReadingHoldMs({
        provider: "azure",
        type: "Microsoft.Web/serverfarms",
        key: FILE_SYSTEM,
      }),
    ).toBe(null);
  });

  test("the hold: 12 hours old when read, the next six hours later, plus an hour between two reads at most", () => {
    expect(AZURE_SIX_HOURLY_READING_PERIOD_SECONDS).toBe(6 * 60 * 60);
    expect(AZURE_SIX_HOURLY_READING_HOLD_MS).toBe(
      12 * HOUR_MS +
        AZURE_SIX_HOURLY_READING_PERIOD_SECONDS * 1000 +
        Math.max(...CLOUD_CONNECTION_READ_INTERVALS) * MINUTE_MS,
    );
    // A bound of its own: a resource's readings as a whole go stale in an hour.
    expect(AZURE_SIX_HOURLY_READING_HOLD_MS).toBeGreaterThan(
      CLOUD_READINGS_STALE_MS,
    );
  });

  /*
   * The read itself, as the Azure connection decides it (getAzureReadGroups):
   * at every read interval a connection may have, and at any minute past the
   * hour it reads at, a call comes every six hours, its newest point is 12
   * hours old as it is read, and the reading is never older than its hold
   * at a read in between, so it is never dropped before the next call
   * brings a newer one.
   */
  test.each(CLOUD_CONNECTION_READ_INTERVALS)(
    "read every %i minutes, a six-hourly reading is never older than its hold between its calls",
    (intervalInMinutes: number) => {
      for (const phaseMinutes of [0, 1, 7, 29, 59]) {
        const start: number =
          Date.parse("2026-11-19T02:00:00.000Z") + phaseMinutes * MINUTE_MS;
        const cursors: Record<string, string> = {};
        let newestPointMs: number | null = null;
        const callsAt: Array<number> = [];
        let oldestBetweenCalls: number = 0;

        for (
          let at: number = start;
          at < start + 3 * 24 * HOUR_MS;
          at += intervalInMinutes * MINUTE_MS
        ) {
          const group: AzureReadGroup = getAzureReadGroups({
            cursors,
            now: new Date(at),
          }).get(AZURE_SIX_HOURLY_GRAIN)!;

          if (group.window) {
            callsAt.push(at);
            // Its points are stamped with their six hours' start.
            newestPointMs =
              group.window.end.getTime() -
              AZURE_SIX_HOURLY_READING_PERIOD_SECONDS * 1000;
            cursors[group.cursorKey] = group.window.end.toISOString();

            // 12 hours old as it is read, and never fresher.
            expect(at - newestPointMs).toBeGreaterThanOrEqual(12 * HOUR_MS);
            expect(at - newestPointMs).toBeLessThan(
              18 * HOUR_MS + intervalInMinutes * MINUTE_MS,
            );
          }

          expect(newestPointMs).not.toBe(null);
          oldestBetweenCalls = Math.max(
            oldestBetweenCalls,
            at - newestPointMs!,
          );
        }

        // A call every six hours: 12 in three days, give or take the edges.
        expect(callsAt.length).toBeGreaterThanOrEqual(11);
        expect(callsAt.length).toBeLessThanOrEqual(13);

        for (let index: number = 1; index < callsAt.length; index++) {
          expect(callsAt[index]! - callsAt[index - 1]!).toBeLessThanOrEqual(
            6 * HOUR_MS + intervalInMinutes * MINUTE_MS,
          );
        }

        expect(oldestBetweenCalls).toBeLessThan(
          AZURE_SIX_HOURLY_READING_HOLD_MS,
        );
      }
    },
  );

  /*
   * The readings a run of reads writes, simulated end to end: every read
   * brings the app's minute readings, and the read with a six-hour call its
   * file system too; the readings are written as the writer writes them
   * (withHeldCloudReadings). The file system's reading never leaves the
   * app's readings between two calls, at any interval.
   */
  test.each(CLOUD_CONNECTION_READ_INTERVALS)(
    "read every %i minutes, the app's readings hold its file system at every read after the first call",
    (intervalInMinutes: number) => {
      const start: number = Date.parse("2026-11-19T03:17:00.000Z");
      const cursors: Record<string, string> = {};
      let readings: CloudResourceReadings = {};
      let sawFirstCall: boolean = false;

      for (
        let at: number = start;
        at < start + 2 * 24 * HOUR_MS;
        at += intervalInMinutes * MINUTE_MS
      ) {
        const now: Date = new Date(at);
        const group: AzureReadGroup = getAzureReadGroups({ cursors, now }).get(
          AZURE_SIX_HOURLY_GRAIN,
        )!;
        const current: CloudResourceReadings = {
          requests: {
            value: 40,
            time: new Date(at - 5 * MINUTE_MS).toISOString(),
          },
        };

        if (group.window) {
          sawFirstCall = true;
          current[FILE_SYSTEM] = {
            value: 1_500_000_000,
            time: new Date(
              group.window.end.getTime() -
                AZURE_SIX_HOURLY_READING_PERIOD_SECONDS * 1000,
            ).toISOString(),
          };
          cursors[group.cursorKey] = group.window.end.toISOString();
        }

        readings = withHeldCloudReadings({
          provider: "azure",
          type: SITES,
          previous: readings,
          current,
          now,
        });

        if (sawFirstCall) {
          expect(readings[FILE_SYSTEM]).toBeDefined();
        }
      }

      expect(sawFirstCall).toBe(true);
    },
  );
});

describe("an App Service app's readings, as a read writes them", () => {
  test("a read that brought no file system keeps the one before, with its own time", () => {
    expect(
      withHeldCloudReadings({
        provider: "azure",
        type: SITES,
        previous: {
          [FILE_SYSTEM]: hoursAgo(14, 1_500_000_000),
          requests: hoursAgo(0.1, 40),
        },
        current: { requests: hoursAgo(0.05, 52) },
        now: NOW,
      }),
    ).toEqual({
      requests: hoursAgo(0.05, 52),
      [FILE_SYSTEM]: hoursAgo(14, 1_500_000_000),
    });
  });

  test("once its datapoint is as old as its hold, it is dropped: a metric that stops goes", () => {
    expect(
      withHeldCloudReadings({
        provider: "azure",
        type: SITES,
        previous: { [FILE_SYSTEM]: hoursAgo(19, 1_500_000_000) },
        current: { requests: hoursAgo(0.05, 52) },
        now: NOW,
      }),
    ).toEqual({ requests: hoursAgo(0.05, 52) });
    // Just under it, kept.
    expect(
      withHeldCloudReadings({
        provider: "azure",
        type: SITES,
        previous: { [FILE_SYSTEM]: hoursAgo(18.99, 1_500_000_000) },
        current: {},
        now: NOW,
      })[FILE_SYSTEM],
    ).toEqual(hoursAgo(18.99, 1_500_000_000));
  });

  test("the call's newer one stands, and an older one a read brings does not replace a newer kept one", () => {
    expect(
      withHeldCloudReadings({
        provider: "azure",
        type: SITES,
        previous: { [FILE_SYSTEM]: hoursAgo(18, 1_500_000_000) },
        current: { [FILE_SYSTEM]: hoursAgo(12, 1_600_000_000) },
        now: NOW,
      }),
    ).toEqual({ [FILE_SYSTEM]: hoursAgo(12, 1_600_000_000) });
    expect(
      withHeldCloudReadings({
        provider: "azure",
        type: SITES,
        previous: { [FILE_SYSTEM]: hoursAgo(12, 1_600_000_000) },
        current: { [FILE_SYSTEM]: hoursAgo(18, 1_500_000_000) },
        now: NOW,
      }),
    ).toEqual({ [FILE_SYSTEM]: hoursAgo(12, 1_600_000_000) });
  });

  test("a read keeps it on the app at all: its Storage used tile reads it", () => {
    expect(
      isCloudReadingKeyOfType({
        provider: "azure",
        resourceType: SITES,
        key: FILE_SYSTEM,
      }),
    ).toBe(true);
  });
});

describe("what an App Service app's page says of it", () => {
  test("its Storage used tile is one some apps have: never Not reported", () => {
    const headline: CloudHeadlineReading | undefined = getCloudHeadlineReadings(
      "azure",
      SITES,
    ).find((candidate: CloudHeadlineReading): boolean => {
      return candidate.key === FILE_SYSTEM;
    });

    expect(headline?.label).toBe(HEADLINE_STORAGE_USED);
    expect(headline?.format).toBe("bytes");
    expect(headline?.onlySome).toBe(true);
    expect(isCloudHeadlineExpected(headline!)).toBe(false);
  });

  test("its age is its datapoint's, which its tile says, and its period six hours", () => {
    expect(
      getCloudReadingAgeMs({
        provider: "azure",
        type: SITES,
        key: FILE_SYSTEM,
        reading: hoursAgo(14.5, 1_500_000_000),
        now: NOW,
      }),
    ).toBe(14.5 * HOUR_MS);
    expect(getCloudReadingPeriodSeconds("azure", FILE_SYSTEM, SITES)).toBe(
      6 * 60 * 60,
    );
    // Its minute readings say no age of their own.
    expect(
      getCloudReadingAgeMs({
        provider: "azure",
        type: SITES,
        key: "requests",
        reading: hoursAgo(0.05, 52),
        now: NOW,
      }),
    ).toBeNull();
  });
});
