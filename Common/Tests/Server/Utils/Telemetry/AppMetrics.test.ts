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

  test("every metric name in the catalog is unique", () => {
    const names: Array<string> = CATALOG.map((e: Instrument) => {
      return e.name;
    });
    expect(new Set(names).size).toBe(names.length);
  });
});
