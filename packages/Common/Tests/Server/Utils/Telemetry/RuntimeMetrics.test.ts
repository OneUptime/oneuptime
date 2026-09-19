import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import type { Attributes, ObservableResult } from "@opentelemetry/api";
import type RuntimeMetricsType from "../../../../Server/Utils/Telemetry/RuntimeMetrics";

/*
 * RuntimeMetrics registers the process-level observable gauges (memory, CPU,
 * event-loop lag, uptime). Dashboards key off these metric NAMES and UNITS,
 * and the callbacks do a little math (CPU deltas, ns -> ms), so both are
 * pinned here. Telemetry, the logger and perf_hooks are mocked: no exporter
 * or real event-loop histogram is involved.
 */

type GaugeCallback = (result: ObservableResult<Attributes>) => void;

interface GaugeRegistration {
  name: string;
  description: string;
  unit: string;
  callback: GaugeCallback;
}

interface FakeHistogram {
  mean: number;
  max: number;
  percentile: Mock<(p: number) => number>;
  reset: Mock<() => void>;
  enable: Mock<() => boolean>;
}

interface Observation {
  value: number;
  attributes: Attributes | undefined;
}

const mockIsMetricsEnabled: Mock<() => boolean> = jest.fn(() => {
  return true;
});
const mockGetObservableGauge: Mock<(data: GaugeRegistration) => unknown> =
  jest.fn((_data: GaugeRegistration) => {
    return {};
  });
const mockLoggerError: Mock<(message: unknown) => void> = jest.fn();

const mockHistogram: FakeHistogram = {
  mean: 0,
  max: 0,
  percentile: jest.fn((_p: number) => {
    return 0;
  }),
  reset: jest.fn(),
  enable: jest.fn(() => {
    return true;
  }),
};
const mockMonitorEventLoopDelay: Mock<
  (options: { resolution: number }) => FakeHistogram
> = jest.fn((_options: { resolution: number }) => {
  return mockHistogram;
});

jest.mock("perf_hooks", () => {
  return {
    __esModule: true,
    monitorEventLoopDelay: (options: { resolution: number }) => {
      return mockMonitorEventLoopDelay(options);
    },
  };
});

jest.mock("../../../../Server/Utils/Telemetry", () => {
  return {
    __esModule: true,
    default: {
      isMetricsEnabled: () => {
        return mockIsMetricsEnabled();
      },
      getObservableGauge: (data: GaugeRegistration) => {
        return mockGetObservableGauge(data);
      },
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: (message: unknown) => {
        mockLoggerError(message);
      },
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

const EXPECTED_GAUGES: Array<{ name: string; unit: string }> = [
  { name: "process.runtime.nodejs.memory.heap.used", unit: "By" },
  { name: "process.runtime.nodejs.memory.heap.total", unit: "By" },
  { name: "process.runtime.nodejs.memory.rss", unit: "By" },
  { name: "process.runtime.nodejs.memory.external", unit: "By" },
  { name: "process.runtime.nodejs.cpu.utilization", unit: "1" },
  { name: "process.runtime.nodejs.eventloop.lag", unit: "ms" },
  { name: "process.runtime.nodejs.uptime", unit: "s" },
];

/*
 * RuntimeMetrics keeps its "initialized" flag and CPU/histogram state in
 * static fields, so each test loads a fresh copy of the module.
 */
const loadRuntimeMetrics: () => typeof RuntimeMetricsType =
  (): typeof RuntimeMetricsType => {
    let loaded: typeof RuntimeMetricsType | undefined;
    jest.isolateModules(() => {
      loaded =
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("../../../../Server/Utils/Telemetry/RuntimeMetrics").default;
    });
    if (!loaded) {
      throw new Error("Failed to load RuntimeMetrics");
    }
    return loaded;
  };

const registrations: () => Array<GaugeRegistration> =
  (): Array<GaugeRegistration> => {
    return mockGetObservableGauge.mock.calls.map(
      (call: [GaugeRegistration]) => {
        return call[0];
      },
    );
  };

const gauge: (name: string) => GaugeRegistration = (
  name: string,
): GaugeRegistration => {
  const found: GaugeRegistration | undefined = registrations().find(
    (registration: GaugeRegistration) => {
      return registration.name === name;
    },
  );
  if (!found) {
    throw new Error(`Gauge ${name} was not registered`);
  }
  return found;
};

const observe: (name: string) => Array<Observation> = (
  name: string,
): Array<Observation> => {
  const observations: Array<Observation> = [];
  const result: ObservableResult<Attributes> = {
    observe: (value: number, attributes?: Attributes) => {
      observations.push({ value, attributes });
    },
  };
  gauge(name).callback(result);
  return observations;
};

describe("RuntimeMetrics", () => {
  beforeEach(() => {
    mockIsMetricsEnabled.mockReset();
    mockIsMetricsEnabled.mockReturnValue(true);
    mockGetObservableGauge.mockReset();
    mockGetObservableGauge.mockReturnValue({});
    mockLoggerError.mockReset();
    mockMonitorEventLoopDelay.mockClear();
    mockHistogram.mean = 0;
    mockHistogram.max = 0;
    mockHistogram.percentile.mockReset();
    mockHistogram.percentile.mockReturnValue(0);
    mockHistogram.reset.mockClear();
    mockHistogram.enable.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("init", () => {
    test("registers nothing when metrics are disabled", () => {
      mockIsMetricsEnabled.mockReturnValue(false);
      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();

      RuntimeMetrics.init();

      expect(mockGetObservableGauge).not.toHaveBeenCalled();
      expect(mockMonitorEventLoopDelay).not.toHaveBeenCalled();
    });

    test("a disabled init does not latch — enabling later registers the gauges", () => {
      mockIsMetricsEnabled.mockReturnValue(false);
      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();
      RuntimeMetrics.init();

      mockIsMetricsEnabled.mockReturnValue(true);
      RuntimeMetrics.init();

      expect(mockGetObservableGauge).toHaveBeenCalledTimes(
        EXPECTED_GAUGES.length,
      );
    });

    test("registers every runtime gauge with its name and unit", () => {
      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();
      RuntimeMetrics.init();

      expect(
        registrations().map((registration: GaugeRegistration) => {
          return { name: registration.name, unit: registration.unit };
        }),
      ).toEqual(EXPECTED_GAUGES);

      for (const registration of registrations()) {
        expect(registration.description.length).toBeGreaterThan(0);
        expect(typeof registration.callback).toBe("function");
      }
    });

    test("starts the event-loop monitor with 20ms resolution and enables it", () => {
      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();
      RuntimeMetrics.init();

      expect(mockMonitorEventLoopDelay).toHaveBeenCalledTimes(1);
      expect(mockMonitorEventLoopDelay).toHaveBeenCalledWith({
        resolution: 20,
      });
      expect(mockHistogram.enable).toHaveBeenCalledTimes(1);
    });

    test("is idempotent once initialized", () => {
      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();
      RuntimeMetrics.init();
      RuntimeMetrics.init();
      RuntimeMetrics.init();

      expect(mockGetObservableGauge).toHaveBeenCalledTimes(
        EXPECTED_GAUGES.length,
      );
      expect(mockMonitorEventLoopDelay).toHaveBeenCalledTimes(1);
      // Once initialized, the enabled check is not even consulted again.
      expect(mockIsMetricsEnabled).toHaveBeenCalledTimes(1);
    });

    test("logs and swallows a registration failure, and retries on the next init", () => {
      mockGetObservableGauge.mockImplementationOnce(() => {
        throw new Error("meter exploded");
      });
      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();

      expect(() => {
        RuntimeMetrics.init();
      }).not.toThrow();

      expect(mockLoggerError).toHaveBeenCalledWith(
        "Failed to initialize Node.js runtime metrics",
      );
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "meter exploded" }),
      );

      mockGetObservableGauge.mockClear();
      RuntimeMetrics.init();

      // Not latched as initialized, so the gauges are registered on retry...
      expect(mockGetObservableGauge).toHaveBeenCalledTimes(
        EXPECTED_GAUGES.length,
      );
      // ...but the event-loop histogram created by the first attempt is reused.
      expect(mockMonitorEventLoopDelay).toHaveBeenCalledTimes(1);
    });
  });

  describe("memory and uptime gauges", () => {
    test("observe the current process.memoryUsage() fields", () => {
      jest.spyOn(process, "memoryUsage").mockReturnValue({
        heapUsed: 111,
        heapTotal: 222,
        rss: 333,
        external: 444,
        arrayBuffers: 555,
      });
      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();
      RuntimeMetrics.init();

      expect(observe("process.runtime.nodejs.memory.heap.used")).toEqual([
        { value: 111, attributes: undefined },
      ]);
      expect(observe("process.runtime.nodejs.memory.heap.total")).toEqual([
        { value: 222, attributes: undefined },
      ]);
      expect(observe("process.runtime.nodejs.memory.rss")).toEqual([
        { value: 333, attributes: undefined },
      ]);
      expect(observe("process.runtime.nodejs.memory.external")).toEqual([
        { value: 444, attributes: undefined },
      ]);
    });

    test("uptime observes process.uptime() in seconds", () => {
      jest.spyOn(process, "uptime").mockReturnValue(1234.5);
      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();
      RuntimeMetrics.init();

      expect(observe("process.runtime.nodejs.uptime")).toEqual([
        { value: 1234.5, attributes: undefined },
      ]);
    });
  });

  describe("cpu utilization gauge", () => {
    const CPU_GAUGE: string = "process.runtime.nodejs.cpu.utilization";

    let nowNs: bigint;
    let cpu: NodeJS.CpuUsage;

    beforeEach(() => {
      nowNs = BigInt(1_000_000_000_000);
      cpu = { user: 1_000_000, system: 500_000 };
      jest.spyOn(process.hrtime, "bigint").mockImplementation(() => {
        return nowNs;
      });
      jest.spyOn(process, "cpuUsage").mockImplementation(() => {
        return { ...cpu };
      });
    });

    test("the first sample only primes the baseline and reports 0", () => {
      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();
      RuntimeMetrics.init();

      expect(observe(CPU_GAUGE)).toEqual([{ value: 0, attributes: undefined }]);
    });

    test("reports (user + system delta) / wall-clock elapsed", () => {
      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();
      RuntimeMetrics.init();
      observe(CPU_GAUGE); // prime

      // 1s of wall clock, 0.5s user + 0.25s system CPU.
      nowNs += BigInt(1_000_000_000);
      cpu = { user: cpu.user + 500_000, system: cpu.system + 250_000 };

      const observations: Array<Observation> = observe(CPU_GAUGE);
      expect(observations).toHaveLength(1);
      expect(observations[0]!.value).toBeCloseTo(0.75, 10);
    });

    test("can exceed 1 when several cores are busy", () => {
      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();
      RuntimeMetrics.init();
      observe(CPU_GAUGE);

      nowNs += BigInt(1_000_000_000);
      cpu = { user: cpu.user + 3_000_000, system: cpu.system + 500_000 };

      expect(observe(CPU_GAUGE)[0]!.value).toBeCloseTo(3.5, 10);
    });

    test("each sample is relative to the previous one, not the first", () => {
      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();
      RuntimeMetrics.init();
      observe(CPU_GAUGE);

      nowNs += BigInt(1_000_000_000);
      cpu = { user: cpu.user + 1_000_000, system: cpu.system };
      expect(observe(CPU_GAUGE)[0]!.value).toBeCloseTo(1, 10);

      nowNs += BigInt(2_000_000_000);
      cpu = { user: cpu.user + 500_000, system: cpu.system + 500_000 };
      expect(observe(CPU_GAUGE)[0]!.value).toBeCloseTo(0.5, 10);
    });

    test("reports 0 when no wall-clock time has elapsed (no divide-by-zero)", () => {
      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();
      RuntimeMetrics.init();
      observe(CPU_GAUGE);

      cpu = { user: cpu.user + 1_000, system: cpu.system };
      expect(observe(CPU_GAUGE)).toEqual([{ value: 0, attributes: undefined }]);
    });

    test("sub-microsecond elapsed time is treated as no elapsed time", () => {
      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();
      RuntimeMetrics.init();
      observe(CPU_GAUGE);

      nowNs += BigInt(999); // < 1µs, truncates to 0 micros
      cpu = { user: cpu.user + 10, system: cpu.system };
      expect(observe(CPU_GAUGE)).toEqual([{ value: 0, attributes: undefined }]);
    });

    test("a zero-elapsed sample does not reset the baseline", () => {
      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();
      RuntimeMetrics.init();
      observe(CPU_GAUGE);

      cpu = { user: cpu.user + 250_000, system: cpu.system };
      observe(CPU_GAUGE); // elapsed 0 -> 0, baseline kept

      nowNs += BigInt(1_000_000_000);
      cpu = { user: cpu.user + 250_000, system: cpu.system };
      // Measured against the original baseline: 0.5s CPU over 1s.
      expect(observe(CPU_GAUGE)[0]!.value).toBeCloseTo(0.5, 10);
    });
  });

  describe("event loop lag gauge", () => {
    const LAG_GAUGE: string = "process.runtime.nodejs.eventloop.lag";

    test("observes mean, p99 and max converted from ns to ms, then resets", () => {
      mockHistogram.mean = 12_500_000; // 12.5ms
      mockHistogram.max = 80_000_000; // 80ms
      mockHistogram.percentile.mockReturnValue(40_000_000); // 40ms

      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();
      RuntimeMetrics.init();

      expect(observe(LAG_GAUGE)).toEqual([
        { value: 12.5, attributes: { quantile: "mean" } },
        { value: 40, attributes: { quantile: "p99" } },
        { value: 80, attributes: { quantile: "max" } },
      ]);
      expect(mockHistogram.percentile).toHaveBeenCalledWith(99);
      expect(mockHistogram.reset).toHaveBeenCalledTimes(1);
    });

    test("skips non-finite values (empty histogram) but still resets", () => {
      mockHistogram.mean = NaN;
      mockHistogram.max = 5_000_000;
      mockHistogram.percentile.mockReturnValue(Infinity);

      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();
      RuntimeMetrics.init();

      expect(observe(LAG_GAUGE)).toEqual([
        { value: 5, attributes: { quantile: "max" } },
      ]);
      expect(mockHistogram.reset).toHaveBeenCalledTimes(1);
    });

    test("each collection resets the histogram so intervals do not accumulate", () => {
      mockHistogram.mean = 1_000_000;
      mockHistogram.max = 1_000_000;
      mockHistogram.percentile.mockReturnValue(1_000_000);

      const RuntimeMetrics: typeof RuntimeMetricsType = loadRuntimeMetrics();
      RuntimeMetrics.init();

      observe(LAG_GAUGE);
      observe(LAG_GAUGE);
      expect(mockHistogram.reset).toHaveBeenCalledTimes(2);
    });
  });
});
