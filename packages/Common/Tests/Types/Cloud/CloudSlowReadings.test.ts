import { describe, expect, test } from "@jest/globals";
import {
  AZURE_FIVE_MINUTE_CURSOR,
  AzureReadGroup,
  getAzureReadGroups,
} from "../../../Server/Utils/CloudConnection/Azure/AzureCloudConnector";
import {
  AZURE_FIVE_MINUTE_GRAIN,
  AZURE_FIVE_MINUTE_READ_MINUTES,
  AZURE_KEY_METRICS,
  AzureKeyMetric,
  getAzureStoredMetricName,
} from "../../../Types/Cloud/CloudKeyMetrics";
import {
  APP_SERVICE_HEALTH_CHECK_KEY,
  AZURE_FIVE_MINUTE_READING_HOLD_MS,
  AZURE_FIVE_MINUTE_READING_PERIOD_SECONDS,
  CLOUD_HEALTH_CHECK_CRITICAL_PERCENT,
  CLOUD_READINGS_STALE_MS,
  CloudHealthAssessment,
  CloudHealthSeverity,
  CloudHeadlineReading,
  CloudResourceReading,
  CloudResourceReadings,
  HEADLINE_DATA_SIZE,
  HEADLINE_DOCUMENTS,
  HEADLINE_HEALTH,
  HEADLINE_INDEX_SIZE,
  REASON_HEALTH_CHECK_FAILING,
  assessCloudResourceHealth,
  findCloudHealthProblems,
  getCloudHeadlineReadings,
  getCloudHealthSeverity,
  getCloudReadingAgeMs,
  getCloudReadingHoldMs,
  getCloudReadingKey,
  getCloudReadingKeysForType,
  getCloudReadingPeriodSeconds,
  isCloudHeadlineExpected,
  withHeldCloudReadings,
} from "../../../Types/Cloud/CloudResourceHealth";
import { CLOUD_CONNECTION_READ_INTERVALS } from "../../../Types/CloudConnection/CloudConnectionCatalog";

/*
 * #9740: AZURE'S FIVE-MINUTE READINGS, KEPT BETWEEN THEIR READS.
 *
 * Azure Monitor keeps an App Service app's health check and a Cosmos DB
 * account's storage at five minutes at their finest, and a connection reads
 * them in a call of their own every 15 minutes: in one read of three. A
 * read that brings none keeps the reading before while its datapoint is
 * younger than its hold, so the rules and the tiles that read it do not
 * come and go - and drops it after, so a metric that stops still goes
 * stale. Each says how old it is.
 */

const MINUTE_MS: number = 60 * 1000;
const NOW: Date = new Date("2026-11-19T10:00:00.000Z");
const APP: string = "Microsoft.Web/sites";
const COSMOS: string = "Microsoft.DocumentDB/databaseAccounts";

function minutesAgo(minutes: number, value: number): CloudResourceReading {
  return {
    value,
    time: new Date(NOW.getTime() - minutes * MINUTE_MS).toISOString(),
  };
}

// Every Azure key metric marked as read at five minutes, as its reading's key and its type.
function fiveMinuteReadings(): Array<{ type: string; key: string }> {
  const readings: Array<{ type: string; key: string }> = [];

  for (const entry of AZURE_KEY_METRICS) {
    for (const metric of entry.metrics as Array<AzureKeyMetric>) {
      if (metric.grain === AZURE_FIVE_MINUTE_GRAIN) {
        readings.push({
          type: entry.type,
          key: getCloudReadingKey(
            "azure",
            getAzureStoredMetricName(metric.name, "total"),
          )!,
        });
      }
    }
  }

  return readings;
}

describe("which readings are kept between their reads, and for how long", () => {
  test("every Azure key metric read at five minutes, and no other", () => {
    expect(fiveMinuteReadings()).toEqual([
      { type: APP, key: "healthcheckstatus" },
      { type: COSMOS, key: "datausagev2" },
      { type: COSMOS, key: "indexusagev2" },
      { type: COSMOS, key: "documentcountv2" },
    ]);

    for (const reading of fiveMinuteReadings()) {
      expect(getCloudReadingHoldMs({ provider: "azure", ...reading })).toBe(
        AZURE_FIVE_MINUTE_READING_HOLD_MS,
      );
    }

    // A minute metric every read brings, of the same types and of others.
    for (const [type, key] of [
      [APP, "requests"],
      [APP, "http5xx"],
      [COSMOS, "totalrequests"],
      [COSMOS, "normalizedruconsumption"],
      ["Microsoft.Compute/virtualMachines", "percentage_cpu"],
      // A Static Web App's only grain is five minutes: every read reads it.
      ["Microsoft.Web/staticSites", "sitehits"],
    ] as Array<[string, string]>) {
      expect(getCloudReadingHoldMs({ provider: "azure", type, key })).toBe(
        null,
      );
    }

    // A five-minute metric's key of another type, or of another cloud, is not one.
    expect(
      getCloudReadingHoldMs({
        provider: "azure",
        type: "Microsoft.Web/serverfarms",
        key: "healthcheckstatus",
      }),
    ).toBe(null);
    expect(
      getCloudReadingHoldMs({ provider: "aws", type: APP, key: "datausagev2" }),
    ).toBe(null);
  });

  test("names are matched whatever their case, as the read and the row spell them", () => {
    expect(
      getCloudReadingHoldMs({
        provider: "Azure",
        type: "microsoft.documentdb/DATABASEACCOUNTS",
        key: "DataUsageV2",
      }),
    ).toBe(AZURE_FIVE_MINUTE_READING_HOLD_MS);
  });

  test("the hold is 40 minutes: twice the 15 between calls, and the 10 a point is old when read", () => {
    expect(AZURE_FIVE_MINUTE_READ_MINUTES).toBe(15);
    expect(AZURE_FIVE_MINUTE_READING_HOLD_MS).toBe(40 * MINUTE_MS);
  });

  test("a kept reading never outlives the resource's readings", () => {
    expect(AZURE_FIVE_MINUTE_READING_HOLD_MS).toBeLessThan(
      CLOUD_READINGS_STALE_MS,
    );
  });

  /*
   * The read itself, as the Azure connection decides it (getAzureReadGroups):
   * at every read interval a connection may have, the newest five-minute
   * point is younger than the hold at every read in between, so a reading
   * kept never goes before the next call brings a newer one.
   */
  test.each(CLOUD_CONNECTION_READ_INTERVALS)(
    "read every %i minutes, a five-minute reading is never older than its hold between its calls",
    (intervalInMinutes: number) => {
      const start: number = Date.parse("2026-11-19T08:02:30.000Z");
      const cursors: Record<string, string> = {};
      let newestPointMs: number | null = null;
      let calls: number = 0;
      let oldestBetweenCalls: number = 0;

      for (
        let at: number = start;
        at < start + 4 * 60 * MINUTE_MS;
        at += intervalInMinutes * MINUTE_MS
      ) {
        const group: AzureReadGroup = getAzureReadGroups({
          cursors,
          now: new Date(at),
        }).get(AZURE_FIVE_MINUTE_CURSOR)!;

        if (group.window) {
          calls++;
          // Its points are stamped with their five minutes' start.
          newestPointMs =
            group.window.end.getTime() -
            AZURE_FIVE_MINUTE_READING_PERIOD_SECONDS * 1000;
          cursors[group.cursorKey] = group.window.end.toISOString();
        }

        expect(newestPointMs).not.toBe(null);
        oldestBetweenCalls = Math.max(oldestBetweenCalls, at - newestPointMs!);
      }

      expect(calls).toBeGreaterThan(0);
      expect(oldestBetweenCalls).toBeLessThan(
        AZURE_FIVE_MINUTE_READING_HOLD_MS,
      );

      // Read every 15 minutes or less often, every read calls.
      if (intervalInMinutes >= AZURE_FIVE_MINUTE_READ_MINUTES) {
        expect(calls).toBe(Math.ceil((4 * 60) / intervalInMinutes));
      }
    },
  );
});

describe("a resource's readings, as a read writes them", () => {
  test("a five-minute reading the read did not bring is kept, with its own time", () => {
    const held: CloudResourceReadings = withHeldCloudReadings({
      provider: "azure",
      type: COSMOS,
      previous: {
        datausagev2: minutesAgo(24, 5_000_000),
        totalrequests: minutesAgo(5, 900),
      },
      current: { totalrequests: minutesAgo(4, 1200) },
      now: NOW,
    });

    expect(held).toEqual({
      totalrequests: minutesAgo(4, 1200),
      datausagev2: minutesAgo(24, 5_000_000),
    });
  });

  test("once its datapoint is as old as its hold, it is dropped: a metric that stops goes stale", () => {
    expect(
      withHeldCloudReadings({
        provider: "azure",
        type: COSMOS,
        previous: {
          datausagev2: minutesAgo(40, 5_000_000),
          indexusagev2: minutesAgo(39, 1_000_000),
        },
        current: { totalrequests: minutesAgo(4, 1200) },
        now: NOW,
      }),
    ).toEqual({
      totalrequests: minutesAgo(4, 1200),
      indexusagev2: minutesAgo(39, 1_000_000),
    });
  });

  test("a reading every read brings is never kept: a read that did not bring it says so", () => {
    expect(
      withHeldCloudReadings({
        provider: "azure",
        type: COSMOS,
        previous: {
          totalrequests: minutesAgo(5, 900),
          normalizedruconsumption: minutesAgo(5, 40),
        },
        current: { datausagev2: minutesAgo(10, 5_000_000) },
        now: NOW,
      }),
    ).toEqual({ datausagev2: minutesAgo(10, 5_000_000) });
  });

  test("of a reading both have, the newer: the read's own, unless the one kept is newer", () => {
    expect(
      withHeldCloudReadings({
        provider: "azure",
        type: COSMOS,
        previous: { datausagev2: minutesAgo(24, 1) },
        current: { datausagev2: minutesAgo(9, 2) },
        now: NOW,
      }),
    ).toEqual({ datausagev2: minutesAgo(9, 2) });
    // A late point of an earlier stretch never replaces the newer one kept.
    expect(
      withHeldCloudReadings({
        provider: "azure",
        type: COSMOS,
        previous: { datausagev2: minutesAgo(9, 2) },
        current: { datausagev2: minutesAgo(24, 1) },
        now: NOW,
      }),
    ).toEqual({ datausagev2: minutesAgo(9, 2) });
  });

  test("nothing is kept of another type, or another cloud, and a time that is no time is ignored", () => {
    expect(
      withHeldCloudReadings({
        provider: "azure",
        type: "Microsoft.Web/serverfarms",
        previous: { healthcheckstatus: minutesAgo(10, 100) },
        current: {},
        now: NOW,
      }),
    ).toEqual({});
    expect(
      withHeldCloudReadings({
        provider: "gcp",
        type: "gce_instance",
        previous: {
          "agent.googleapis.com/memory/percent_used": minutesAgo(10, 50),
        },
        current: {},
        now: NOW,
      }),
    ).toEqual({});
    expect(
      withHeldCloudReadings({
        provider: "azure",
        type: COSMOS,
        previous: { datausagev2: { value: 1, time: "not a time" } },
        current: {},
        now: NOW,
      }),
    ).toEqual({});
  });

  test("the previous readings and the read's own are never changed", () => {
    const previous: CloudResourceReadings = {
      datausagev2: minutesAgo(20, 1),
    };
    const current: CloudResourceReadings = {
      totalrequests: minutesAgo(4, 2),
    };

    withHeldCloudReadings({
      provider: "azure",
      type: COSMOS,
      previous,
      current,
      now: NOW,
    });

    expect(previous).toEqual({ datausagev2: minutesAgo(20, 1) });
    expect(current).toEqual({ totalrequests: minutesAgo(4, 2) });
  });
});

describe("an App Service app's health, from its Health check", () => {
  function problemsOf(readings: CloudResourceReadings): {
    severity: CloudHealthSeverity | null;
    reasons: Array<string>;
    isChecked: boolean;
  } {
    const found: ReturnType<typeof findCloudHealthProblems> =
      findCloudHealthProblems({ provider: "azure", type: APP, readings });

    return {
      severity: getCloudHealthSeverity({
        provider: "azure",
        type: APP,
        readings,
      }),
      reasons: found.findings.map(
        (finding: { reason: { text: string } }): string => {
          return finding.reason.text;
        },
      ),
      isChecked: found.isChecked,
    };
  }

  test("every instance healthy is healthy, and checked", () => {
    expect(problemsOf({ healthcheckstatus: minutesAgo(10, 100) })).toEqual({
      severity: null,
      reasons: [],
      isChecked: true,
    });
  });

  test("an instance deemed unhealthy, out of the load balancer, is a warning", () => {
    for (const value of [99.5, 80, 75, 50]) {
      expect(problemsOf({ healthcheckstatus: minutesAgo(10, value) })).toEqual({
        severity: CloudHealthSeverity.Warning,
        reasons: [REASON_HEALTH_CHECK_FAILING],
        isChecked: true,
      });
    }
  });

  test("past half unhealthy, some requests reach an unhealthy instance: critical", () => {
    expect(CLOUD_HEALTH_CHECK_CRITICAL_PERCENT).toBe(50);

    for (const value of [49.9, 25, 0]) {
      expect(problemsOf({ healthcheckstatus: minutesAgo(10, value) })).toEqual({
        severity: CloudHealthSeverity.Critical,
        reasons: [REASON_HEALTH_CHECK_FAILING],
        isChecked: true,
      });
    }
  });

  test("an app without a Health check is judged by its requests alone, as before", () => {
    expect(
      problemsOf({
        requests: minutesAgo(1, 100),
        http5xx: minutesAgo(1, 0),
      }),
    ).toEqual({ severity: null, reasons: [], isChecked: true });
    expect(problemsOf({})).toEqual({
      severity: null,
      reasons: [],
      isChecked: false,
    });
  });

  test("the health check is read on the app's page, as its reading", () => {
    expect(
      getCloudReadingKeysForType("azure", APP).has("healthcheckstatus"),
    ).toBe(true);
    expect(APP_SERVICE_HEALTH_CHECK_KEY).toBe(
      getCloudReadingKey(
        "azure",
        getAzureStoredMetricName("HealthCheckStatus", "Average"),
      ),
    );
  });

  /*
   * The reason the issue was about: a "Health check failing" kept between
   * the health check's reads, rather than one read in three.
   */
  test("a failing health check stays failing between its reads, then goes stale", () => {
    let row: CloudResourceReadings = {};
    const verdicts: Array<string> = [];

    // Read every 5 minutes: the health check is in the first read of three.
    for (let read: number = 0; read < 12; read++) {
      const at: Date = new Date(NOW.getTime() + read * 5 * MINUTE_MS);
      const brought: CloudResourceReadings = {
        requests: {
          value: 100,
          time: new Date(at.getTime() - 4 * MINUTE_MS).toISOString(),
        },
        ...(read % 3 === 0
          ? {
              healthcheckstatus: {
                value: 0,
                time: new Date(at.getTime() - 10 * MINUTE_MS).toISOString(),
              },
            }
          : {}),
      };

      row = withHeldCloudReadings({
        provider: "azure",
        type: APP,
        previous: row,
        current: brought,
        now: at,
      });

      const assessment: CloudHealthAssessment = assessCloudResourceHealth(
        {
          cloudProvider: "azure",
          cloudResourceType: APP,
          otelCollectorStatus: "connected",
          cloudReadings: row,
          cloudReadingsAt: at,
        },
        { now: at },
      );

      verdicts.push(assessment.state);
    }

    // Never "healthy" between the calls: the failure is said every read.
    expect(verdicts).toEqual(Array(12).fill("unhealthy"));

    /*
     * Its calls stop (the app's Health check was turned off): the last
     * point, from the call at read 9, is 50 minutes old half an hour after
     * the last read, past its hold, and the app is judged by its requests.
     */
    const later: Date = new Date(NOW.getTime() + (11 * 5 + 30) * MINUTE_MS);
    const stopped: CloudResourceReadings = withHeldCloudReadings({
      provider: "azure",
      type: APP,
      previous: row,
      current: {
        requests: {
          value: 100,
          time: new Date(later.getTime() - 4 * MINUTE_MS).toISOString(),
        },
      },
      now: later,
    });

    expect(row["healthcheckstatus"]).toBeDefined();
    expect(stopped["healthcheckstatus"]).toBe(undefined);
    expect(
      getCloudHealthSeverity({
        provider: "azure",
        type: APP,
        readings: stopped,
      }),
    ).toBe(null);
  });
});

describe("what a five-minute reading's page says", () => {
  test("a Cosmos DB account leads with what it stores: its data, its indexes and its documents", () => {
    const headlines: Array<CloudHeadlineReading> = getCloudHeadlineReadings(
      "azure",
      COSMOS,
    );

    expect(
      headlines.slice(0, 3).map((headline: CloudHeadlineReading) => {
        return [headline.key, headline.label, headline.format];
      }),
    ).toEqual([
      ["datausagev2", HEADLINE_DATA_SIZE, "bytes"],
      ["indexusagev2", HEADLINE_INDEX_SIZE, "bytes"],
      ["documentcountv2", HEADLINE_DOCUMENTS, "count"],
    ]);
    // Levels every account reports: a fresh read without them says so.
    for (const headline of headlines.slice(0, 3)) {
      expect(isCloudHeadlineExpected(headline)).toBe(true);
    }
    // Its requests and latency follow.
    expect(
      headlines.slice(3).map((headline: CloudHeadlineReading) => {
        return headline.key;
      }),
    ).toEqual([
      "totalrequests",
      "normalizedruconsumption",
      "serversidelatencydirect",
    ]);
  });

  test("an App Service app with a Health check says the share of its instances that pass it", () => {
    const health: CloudHeadlineReading | undefined = getCloudHeadlineReadings(
      "azure",
      APP,
    ).find((headline: CloudHeadlineReading): boolean => {
      return headline.key === APP_SERVICE_HEALTH_CHECK_KEY;
    });

    expect(health).toEqual({
      key: APP_SERVICE_HEALTH_CHECK_KEY,
      label: HEADLINE_HEALTH,
      format: "percent",
      // Only an app with a Health check path set reports it.
      onlySome: true,
    });
    expect(isCloudHeadlineExpected(health!)).toBe(false);
  });

  test("its period is five minutes, so a sum of it would be drawn per minute rightly", () => {
    expect(getCloudReadingPeriodSeconds("azure", "datausagev2", COSMOS)).toBe(
      300,
    );
    expect(
      getCloudReadingPeriodSeconds("azure", "healthcheckstatus", APP),
    ).toBe(300);
    // A minute metric, and a reading of no type, as before.
    expect(getCloudReadingPeriodSeconds("azure", "totalrequests", COSMOS)).toBe(
      60,
    );
    expect(getCloudReadingPeriodSeconds("azure", "datausagev2")).toBe(60);
    expect(getCloudReadingPeriodSeconds("gcp", "x.googleapis.com/y")).toBe(60);
    expect(
      getCloudReadingPeriodSeconds("aws", "aws/ec2/cpuutilization", COSMOS),
    ).toBe(300);
  });

  test("its age is its datapoint's, and only a slow reading has one to say", () => {
    expect(
      getCloudReadingAgeMs({
        provider: "azure",
        type: COSMOS,
        key: "datausagev2",
        reading: minutesAgo(12, 1),
        now: NOW,
      }),
    ).toBe(12 * MINUTE_MS);
    // A point stamped after the page's clock is no negative age.
    expect(
      getCloudReadingAgeMs({
        provider: "azure",
        type: COSMOS,
        key: "datausagev2",
        reading: minutesAgo(-2, 1),
        now: NOW,
      }),
    ).toBe(0);
    expect(
      getCloudReadingAgeMs({
        provider: "azure",
        type: COSMOS,
        key: "totalrequests",
        reading: minutesAgo(12, 1),
        now: NOW,
      }),
    ).toBe(null);
    expect(
      getCloudReadingAgeMs({
        provider: "azure",
        type: COSMOS,
        key: "datausagev2",
        reading: { value: 1, time: "never" },
        now: NOW,
      }),
    ).toBe(null);
  });
});
