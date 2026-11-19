import { describe, expect, test } from "@jest/globals";
import {
  AzureReadGroup,
  getAzureReadGroups,
} from "../../../Server/Utils/CloudConnection/Azure/AzureCloudConnector";
import {
  AZURE_HOURLY_GRAIN,
  AZURE_KEY_METRICS,
  AzureKeyMetric,
  getAzureStoredMetricName,
} from "../../../Types/Cloud/CloudKeyMetrics";
import {
  AZURE_FIVE_MINUTE_READING_HOLD_MS,
  AZURE_HOURLY_READING_HOLD_MS,
  AZURE_HOURLY_READING_PERIOD_SECONDS,
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
import { CLOUD_CONNECTION_READ_INTERVALS } from "../../../Types/CloudConnection/CloudConnectionCatalog";

/*
 * #9982: AZURE'S HOURLY READINGS, KEPT BETWEEN THEIR READS.
 *
 * Azure Monitor keeps a Storage account's UsedCapacity (and a few other key
 * metrics) at an hour at its finest. A connection reads it in its hour's
 * call once an hour, so of the twelve reads an hour of a connection read
 * every 5 minutes one brought it, and its "Storage used" tile showed after
 * that read and was gone after the next. A read that brings none now keeps
 * the reading before while its datapoint is younger than its own hold - an
 * hourly point is 2 hours old when read, as its window waits a whole hour
 * for Azure Monitor to publish it - and drops it after; the tile says how
 * old it is.
 */

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const NOW: Date = new Date("2026-11-19T10:00:00.000Z");
const STORAGE: string = "Microsoft.Storage/storageAccounts";

function hoursAgo(hours: number, value: number): CloudResourceReading {
  return {
    value,
    time: new Date(NOW.getTime() - hours * HOUR_MS).toISOString(),
  };
}

// Every Azure key metric marked as kept at an hour, as its reading's key and its type.
function hourlyReadings(): Array<{ type: string; key: string }> {
  const readings: Array<{ type: string; key: string }> = [];

  for (const entry of AZURE_KEY_METRICS) {
    for (const metric of entry.metrics as Array<AzureKeyMetric>) {
      if (metric.grain === AZURE_HOURLY_GRAIN) {
        readings.push({
          type: entry.type,
          key: getCloudReadingKey(
            "azure",
            getAzureStoredMetricName(metric.name, "average"),
          )!,
        });
      }
    }
  }

  return readings;
}

describe("which readings are kept as hourly ones, and for how long", () => {
  test("every Azure key metric kept at an hour at its finest, and no other", () => {
    expect(hourlyReadings()).toEqual([
      {
        type: "Microsoft.DocumentDB/databaseAccounts",
        key: "serviceavailability",
      },
      { type: STORAGE, key: "usedcapacity" },
      { type: "Microsoft.Network/dnszones", key: "queryvolume" },
      {
        type: "Microsoft.Network/dnszones",
        key: "recordsetcapacityutilization",
      },
      { type: "Microsoft.ContainerRegistry/registries", key: "storageused" },
    ]);

    for (const reading of hourlyReadings()) {
      expect(getCloudReadingHoldMs({ provider: "azure", ...reading })).toBe(
        AZURE_HOURLY_READING_HOLD_MS,
      );
    }

    // A storage account's minute metrics, which every read brings, are never kept.
    for (const key of ["transactions", "availability", "successe2elatency"]) {
      expect(
        getCloudReadingHoldMs({ provider: "azure", type: STORAGE, key }),
      ).toBe(null);
    }

    // A five-minute reading keeps its own hold.
    expect(
      getCloudReadingHoldMs({
        provider: "azure",
        type: "Microsoft.DocumentDB/databaseAccounts",
        key: "datausagev2",
      }),
    ).toBe(AZURE_FIVE_MINUTE_READING_HOLD_MS);
  });

  test("the hold is 4 hours: a point is 2 hours old when read, and the next comes an hour later, after a read an hour apart at most", () => {
    expect(AZURE_HOURLY_READING_HOLD_MS).toBe(4 * HOUR_MS);
    expect(Math.max(...CLOUD_CONNECTION_READ_INTERVALS)).toBeLessThanOrEqual(
      60,
    );
  });

  /*
   * The read itself, as the Azure connection decides it (getAzureReadGroups):
   * at every read interval a connection may have, and at any minute past
   * the hour it reads at, the newest hourly point is younger than the hold
   * at every read in between, so the reading is never dropped before the
   * next hour's call brings a newer one.
   */
  test.each(CLOUD_CONNECTION_READ_INTERVALS)(
    "read every %i minutes, an hourly reading is never older than its hold between its calls",
    (intervalInMinutes: number) => {
      for (const phaseMinutes of [0, 1, 17, 29, 59]) {
        const start: number =
          Date.parse("2026-11-19T08:00:00.000Z") + phaseMinutes * MINUTE_MS;
        const cursors: Record<string, string> = {};
        let newestPointMs: number | null = null;
        let calls: number = 0;
        let oldestBetweenCalls: number = 0;

        for (
          let at: number = start;
          at < start + 12 * HOUR_MS;
          at += intervalInMinutes * MINUTE_MS
        ) {
          const group: AzureReadGroup = getAzureReadGroups({
            cursors,
            now: new Date(at),
          }).get(AZURE_HOURLY_GRAIN)!;

          if (group.window) {
            calls++;
            // Its points are stamped with their hour's start.
            newestPointMs =
              group.window.end.getTime() -
              AZURE_HOURLY_READING_PERIOD_SECONDS * 1000;
            cursors[group.cursorKey] = group.window.end.toISOString();

            // Two hours old as it is read, and never fresher.
            expect(at - newestPointMs).toBeGreaterThanOrEqual(2 * HOUR_MS);
          }

          expect(newestPointMs).not.toBe(null);
          oldestBetweenCalls = Math.max(
            oldestBetweenCalls,
            at - newestPointMs!,
          );
        }

        expect(calls).toBeGreaterThanOrEqual(11);
        expect(oldestBetweenCalls).toBeLessThan(AZURE_HOURLY_READING_HOLD_MS);
      }
    },
  );
});

describe("a storage account's readings, as a read writes them", () => {
  test("the read that brought no used capacity keeps the one before, with its own time", () => {
    const readings: CloudResourceReadings = withHeldCloudReadings({
      provider: "azure",
      type: STORAGE,
      previous: {
        usedcapacity: hoursAgo(2.5, 5_000_000_000),
        transactions: hoursAgo(0.1, 40),
      },
      current: { transactions: hoursAgo(0.05, 52) },
      now: NOW,
    });

    expect(readings).toEqual({
      transactions: hoursAgo(0.05, 52),
      usedcapacity: hoursAgo(2.5, 5_000_000_000),
    });
  });

  test("once its datapoint is as old as its hold, it is dropped: a metric that stops goes stale", () => {
    expect(
      withHeldCloudReadings({
        provider: "azure",
        type: STORAGE,
        previous: { usedcapacity: hoursAgo(4, 5_000_000_000) },
        current: { transactions: hoursAgo(0.05, 52) },
        now: NOW,
      }),
    ).toEqual({ transactions: hoursAgo(0.05, 52) });
  });

  test("the hour's call brings the newer one, which stands", () => {
    expect(
      withHeldCloudReadings({
        provider: "azure",
        type: STORAGE,
        previous: { usedcapacity: hoursAgo(3, 5_000_000_000) },
        current: { usedcapacity: hoursAgo(2, 5_100_000_000) },
        now: NOW,
      }),
    ).toEqual({ usedcapacity: hoursAgo(2, 5_100_000_000) });
  });
});

describe("what a storage account's page says of it", () => {
  test("its Storage used tile is one every account has: not reported when its readings hold none", () => {
    const headline: CloudHeadlineReading | undefined = getCloudHeadlineReadings(
      "azure",
      STORAGE,
    ).find((candidate: CloudHeadlineReading): boolean => {
      return candidate.key === "usedcapacity";
    });

    expect(headline?.label).toBe(HEADLINE_STORAGE_USED);
    expect(headline?.onlySome).toBeUndefined();
    expect(isCloudHeadlineExpected(headline!)).toBe(true);
  });

  test("its age is its datapoint's, which its tile says, and its period an hour", () => {
    expect(
      getCloudReadingAgeMs({
        provider: "azure",
        type: STORAGE,
        key: "usedcapacity",
        reading: hoursAgo(2.25, 5_000_000_000),
        now: NOW,
      }),
    ).toBe(2.25 * HOUR_MS);
    expect(
      getCloudReadingAgeMs({
        provider: "azure",
        type: STORAGE,
        key: "transactions",
        reading: hoursAgo(0.05, 52),
        now: NOW,
      }),
    ).toBeNull();
    expect(getCloudReadingPeriodSeconds("azure", "usedcapacity", STORAGE)).toBe(
      3600,
    );
    // A DNS zone's queries, a count an hour, are drawn per minute from an hour.
    expect(
      getCloudReadingPeriodSeconds(
        "azure",
        "queryvolume",
        "Microsoft.Network/dnszones",
      ),
    ).toBe(3600);
    expect(getCloudReadingPeriodSeconds("azure", "transactions", STORAGE)).toBe(
      60,
    );
  });
});
