import { describe, expect, jest, test } from "@jest/globals";

/*
 * AppMetrics is the single catalog of self-observability instruments the
 * OneUptime services emit. Dashboards and alerts are wired to these metric
 * NAMES and UNITS, so a rename or a unit change here silently breaks them —
 * these tests pin the catalog. They also pin the lazy-create-once caching the
 * module promises (importing it from many call sites must not register the
 * same instrument twice).
 */

jest.mock("../../../../Server/Utils/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      getCounter: jest.fn((data: { name: string; unit: string }) => {
        return { __kind: "counter", ...data };
      }),
      getHistogram: jest.fn((data: { name: string; unit: string }) => {
        return { __kind: "histogram", ...data };
      }),
      getGauge: jest.fn((data: { name: string; unit: string }) => {
        return { __kind: "gauge", ...data };
      }),
    },
  };
});

type Factory = "getCounter" | "getHistogram" | "getGauge";

interface Instrument {
  getter: string;
  factory: Factory;
  kind: string;
  name: string;
  unit: string;
}

/*
 * The expected catalog, mirrored from AppMetrics. Kept as data so a new
 * instrument (or a changed name/unit) has to be reflected here deliberately.
 */
const CATALOG: Array<Instrument> = [
  {
    getter: "getHttpRequestCounter",
    factory: "getCounter",
    kind: "counter",
    name: "http.server.request.count",
    unit: "1",
  },
  {
    getter: "getHttpRequestDuration",
    factory: "getHistogram",
    kind: "histogram",
    name: "http.server.request.duration",
    unit: "ms",
  },
  {
    getter: "getHttpRequestsInFlight",
    factory: "getGauge",
    kind: "gauge",
    name: "http.server.active_requests",
    unit: "1",
  },
  {
    getter: "getWorkerJobCounter",
    factory: "getCounter",
    kind: "counter",
    name: "worker.job.count",
    unit: "1",
  },
  {
    getter: "getWorkerJobDuration",
    factory: "getHistogram",
    kind: "histogram",
    name: "worker.job.duration",
    unit: "ms",
  },
  {
    getter: "getWorkerJobsInFlight",
    factory: "getGauge",
    kind: "gauge",
    name: "worker.job.active",
    unit: "1",
  },
  {
    getter: "getProbeCheckCounter",
    factory: "getCounter",
    kind: "counter",
    name: "probe.monitor.check.count",
    unit: "1",
  },
  {
    getter: "getProbeCheckDuration",
    factory: "getHistogram",
    kind: "histogram",
    name: "probe.monitor.check.duration",
    unit: "ms",
  },
  {
    getter: "getNotificationCounter",
    factory: "getCounter",
    kind: "counter",
    name: "notification.send.count",
    unit: "1",
  },
  {
    getter: "getNotificationDuration",
    factory: "getHistogram",
    kind: "histogram",
    name: "notification.send.duration",
    unit: "ms",
  },
  {
    getter: "getNotificationTriggerCounter",
    factory: "getCounter",
    kind: "counter",
    name: "notification.trigger.count",
    unit: "1",
  },
  {
    getter: "getNotificationTimeToSend",
    factory: "getHistogram",
    kind: "histogram",
    name: "notification.time_to_send",
    unit: "ms",
  },
  {
    getter: "getNotificationSendLag",
    factory: "getHistogram",
    kind: "histogram",
    name: "notification.send.lag",
    unit: "ms",
  },
  {
    getter: "getNotificationDeliveryCounter",
    factory: "getCounter",
    kind: "counter",
    name: "notification.delivery.count",
    unit: "1",
  },
  {
    getter: "getNotificationDeliveryDuration",
    factory: "getHistogram",
    kind: "histogram",
    name: "notification.delivery.duration",
    unit: "ms",
  },
  {
    getter: "getIngestCounter",
    factory: "getCounter",
    kind: "counter",
    name: "telemetry.ingest.request.count",
    unit: "1",
  },
  {
    getter: "getIngestDuration",
    factory: "getHistogram",
    kind: "histogram",
    name: "telemetry.ingest.request.duration",
    unit: "ms",
  },
  {
    getter: "getIngestPayloadBytes",
    factory: "getHistogram",
    kind: "histogram",
    name: "telemetry.ingest.request.payload.size",
    unit: "By",
  },
  {
    getter: "getIngestDroppedCounter",
    factory: "getCounter",
    kind: "counter",
    name: "oneuptime.telemetry.ingest.dropped.count",
    unit: "1",
  },
  {
    getter: "getOnCallCalendarRenderDuration",
    factory: "getHistogram",
    kind: "histogram",
    name: "oncall_calendar_render_duration_ms",
    unit: "ms",
  },
  {
    getter: "getOnCallCalendarRenderEvents",
    factory: "getHistogram",
    kind: "histogram",
    name: "oncall_calendar_render_events",
    unit: "1",
  },
];

interface LoadedModules {
  Telemetry: {
    getCounter: jest.Mock;
    getHistogram: jest.Mock;
    getGauge: jest.Mock;
  };
  // A catalog of no-arg getters returning tagged fake instruments.
  AppMetrics: Record<string, () => { __kind: string; name: string }>;
}

/*
 * Re-import with a cleared module registry so AppMetrics' static instrument
 * cache starts empty and the mocked Telemetry factories start with a clean
 * call history — required to assert "created exactly once".
 */
async function loadFresh(): Promise<LoadedModules> {
  jest.resetModules();

  const Telemetry: LoadedModules["Telemetry"] = (
    (await import("../../../../Server/Utils/Telemetry")) as unknown as {
      default: LoadedModules["Telemetry"];
    }
  ).default;

  const AppMetrics: LoadedModules["AppMetrics"] = (
    (await import(
      "../../../../Server/Utils/Telemetry/AppMetrics"
    )) as unknown as { default: LoadedModules["AppMetrics"] }
  ).default;

  return { Telemetry, AppMetrics };
}

describe("AppMetrics catalog", () => {
  test.each(CATALOG)(
    "$getter creates $name via $factory with unit $unit",
    async (entry: Instrument) => {
      const { Telemetry, AppMetrics } = await loadFresh();

      const instrument: { __kind: string; name: string } =
        AppMetrics[entry.getter]!();

      expect(Telemetry[entry.factory]).toHaveBeenCalledTimes(1);
      expect(Telemetry[entry.factory]).toHaveBeenCalledWith(
        expect.objectContaining({ name: entry.name, unit: entry.unit }),
      );
      expect(instrument.__kind).toBe(entry.kind);
      expect(instrument.name).toBe(entry.name);
    },
  );

  test.each(CATALOG)(
    "$getter lazily creates the instrument only once and caches it",
    async (entry: Instrument) => {
      const { Telemetry, AppMetrics } = await loadFresh();

      const first: unknown = AppMetrics[entry.getter]!();
      const second: unknown = AppMetrics[entry.getter]!();
      const third: unknown = AppMetrics[entry.getter]!();

      // Same instance handed back every time.
      expect(second).toBe(first);
      expect(third).toBe(first);

      // The factory ran exactly once despite three getter calls.
      const totalFactoryCalls: number =
        Telemetry.getCounter.mock.calls.length +
        Telemetry.getHistogram.mock.calls.length +
        Telemetry.getGauge.mock.calls.length;
      expect(totalFactoryCalls).toBe(1);
    },
  );

  test("no getter accidentally routes through the wrong factory", async () => {
    const { Telemetry, AppMetrics } = await loadFresh();

    for (const entry of CATALOG) {
      AppMetrics[entry.getter]!();
    }

    const counterNames: Array<string> = Telemetry.getCounter.mock.calls.map(
      (c: Array<{ name: string }>) => {
        return c[0]!.name;
      },
    );
    const histogramNames: Array<string> = Telemetry.getHistogram.mock.calls.map(
      (c: Array<{ name: string }>) => {
        return c[0]!.name;
      },
    );
    const gaugeNames: Array<string> = Telemetry.getGauge.mock.calls.map(
      (c: Array<{ name: string }>) => {
        return c[0]!.name;
      },
    );

    expect(counterNames.sort()).toEqual(
      CATALOG.filter((e: Instrument) => {
        return e.kind === "counter";
      })
        .map((e: Instrument) => {
          return e.name;
        })
        .sort(),
    );
    expect(histogramNames.sort()).toEqual(
      CATALOG.filter((e: Instrument) => {
        return e.kind === "histogram";
      })
        .map((e: Instrument) => {
          return e.name;
        })
        .sort(),
    );
    expect(gaugeNames.sort()).toEqual(
      CATALOG.filter((e: Instrument) => {
        return e.kind === "gauge";
      })
        .map((e: Instrument) => {
          return e.name;
        })
        .sort(),
    );
  });

  test("the on-call calendar feed attribute key is bounded and named", async () => {
    /*
     * The two feed histograms are labelled by feed kind and nothing else --
     * never a token, user or project id. The attribute key is exported so the
     * renderer and any dashboard agree on it.
     */
    const { AppMetrics } = await loadFresh();

    const attribute: unknown = (
      AppMetrics as unknown as Record<string, unknown>
    )["ON_CALL_CALENDAR_FEED_KIND_ATTRIBUTE"];

    expect(attribute).toBe("oneuptime.oncall_calendar.feed_kind");
  });

  test("the notification latency histograms carry buckets that reach minutes", async () => {
    /*
     * The SDK's default buckets end at 10,000 (ms): a page sent 45 seconds
     * after its trigger would land in the overflow bucket with every page
     * sent an hour late, and no SLO could be read off it.
     */
    const { Telemetry, AppMetrics } = await loadFresh();

    AppMetrics["getNotificationTimeToSend"]!();
    AppMetrics["getNotificationDuration"]!();

    const bucketsByName: Record<string, Array<number>> = {};

    for (const call of Telemetry.getHistogram.mock.calls) {
      const options: {
        name: string;
        explicitBucketBoundaries?: Array<number>;
      } = call[0] as {
        name: string;
        explicitBucketBoundaries?: Array<number>;
      };
      bucketsByName[options.name] = options.explicitBucketBoundaries || [];
    }

    const timeToSend: Array<number> =
      bucketsByName["notification.time_to_send"]!;
    const sendDuration: Array<number> =
      bucketsByName["notification.send.duration"]!;

    for (const buckets of [timeToSend, sendDuration]) {
      expect(buckets.length).toBeGreaterThan(5);
      // Strictly increasing, as the SDK requires.
      for (let i: number = 1; i < buckets.length; i++) {
        expect(buckets[i]!).toBeGreaterThan(buckets[i - 1]!);
      }
    }

    // An SLO of "within 30 seconds" and "within 5 minutes" has a bucket edge.
    expect(timeToSend).toContain(30000);
    expect(timeToSend).toContain(300000);
    expect(timeToSend[timeToSend.length - 1]!).toBeGreaterThanOrEqual(3600000);
    // A provider call that takes a minute is not lost in the overflow.
    expect(sendDuration[sendDuration.length - 1]!).toBeGreaterThanOrEqual(
      60000,
    );
  });

  test("the final status histogram's buckets reach a day: an SMS can wait hours on a phone that is off", async () => {
    /*
     * notification.delivery.duration (issue #6648): a call is picked up in
     * seconds, an SMS is delivered in seconds - or hours later, when the
     * phone comes back on - and a carrier gives up after a day or so. An SLO
     * of "delivered within 30 seconds", "within 5 minutes" or "within an
     * hour" has a bucket edge to be read off.
     */
    const { Telemetry, AppMetrics } = await loadFresh();

    AppMetrics["getNotificationDeliveryDuration"]!();

    const options: {
      name: string;
      explicitBucketBoundaries?: Array<number>;
    } = Telemetry.getHistogram.mock.calls[0]![0] as {
      name: string;
      explicitBucketBoundaries?: Array<number>;
    };

    expect(options.name).toBe("notification.delivery.duration");

    const buckets: Array<number> = options.explicitBucketBoundaries || [];

    expect(buckets).toEqual([
      500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000,
      1800000, 3600000, 14400000, 86400000,
    ]);

    for (let i: number = 1; i < buckets.length; i++) {
      expect(buckets[i]!).toBeGreaterThan(buckets[i - 1]!);
    }

    // The catalog's own copy, which the histogram is made from.
    expect([
      ...(
        AppMetrics as unknown as {
          NOTIFICATION_DELIVERY_DURATION_BUCKETS_IN_MS: ReadonlyArray<number>;
        }
      ).NOTIFICATION_DELIVERY_DURATION_BUCKETS_IN_MS,
    ]).toEqual(buckets);
  });

  test("the send lag histogram's edges sit close around a minute, and reach an hour", async () => {
    /*
     * notification.send.lag (issue #6646): the workers that send what a
     * wait made due run once a minute, so one that keeps up sends within a
     * minute or so of the moment - an SLO of "within 90 seconds" has an
     * edge to be read off - and one that fell behind shows by how many
     * minutes, up to an hour.
     */
    const { Telemetry, AppMetrics } = await loadFresh();

    AppMetrics["getNotificationSendLag"]!();

    const options: {
      name: string;
      description: string;
      explicitBucketBoundaries?: Array<number>;
    } = Telemetry.getHistogram.mock.calls[0]![0] as {
      name: string;
      description: string;
      explicitBucketBoundaries?: Array<number>;
    };

    expect(options.name).toBe("notification.send.lag");

    const buckets: Array<number> = options.explicitBucketBoundaries || [];

    expect(buckets).toEqual([
      1000, 5000, 10000, 15000, 30000, 45000, 60000, 75000, 90000, 120000,
      180000, 300000, 600000, 1800000, 3600000,
    ]);

    for (let i: number = 1; i < buckets.length; i++) {
      expect(buckets[i]!).toBeGreaterThan(buckets[i - 1]!);
    }

    // The catalog's own copy, which the histogram is made from.
    expect([
      ...(
        AppMetrics as unknown as {
          NOTIFICATION_SEND_LAG_BUCKETS_IN_MS: ReadonlyArray<number>;
        }
      ).NOTIFICATION_SEND_LAG_BUCKETS_IN_MS,
    ]).toEqual(buckets);

    // It says what it times, and how it is told apart.
    expect(options.description).toContain("was due");
    expect(options.description).toContain(
      "Partitioned by channel, schedule and trigger type",
    );
  });

  test("the final status metrics say what they count", async () => {
    const { Telemetry, AppMetrics } = await loadFresh();

    AppMetrics["getNotificationDeliveryCounter"]!();
    AppMetrics["getNotificationDeliveryDuration"]!();

    const counter: { description: string } = Telemetry.getCounter.mock
      .calls[0]![0] as { description: string };
    const histogram: { description: string } = Telemetry.getHistogram.mock
      .calls[0]![0] as { description: string };

    expect(counter.description).toContain("Each message is counted once");
    expect(histogram.description).toContain("not timed");
  });

  test("every metric name in the catalog is unique", () => {
    const names: Array<string> = CATALOG.map((e: Instrument) => {
      return e.name;
    });
    expect(new Set(names).size).toBe(names.length);
  });
});
