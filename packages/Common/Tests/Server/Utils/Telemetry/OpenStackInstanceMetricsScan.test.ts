import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import {
  CounterState,
  CounterStep,
  OPENSTACK_CEILOMETER_LONGEST_GAP_MS,
  OPENSTACK_CEILOMETER_QUIET_MS,
  OPENSTACK_CEILOMETER_SERIES,
  OPENSTACK_INSTANCE_METRICS_SCOPE_NAME,
  OPENSTACK_LIBVIRT_LONGEST_GAP_MS,
  OPENSTACK_LIBVIRT_SERIES,
  OpenStackInstanceMetricsDecision,
  OpenStackInstanceMetricsHostState,
  OpenStackInstancePlacement,
  advanceOpenStackCounter,
  advanceOpenStackLevel,
  appendOpenStackInstanceMetrics,
  applyOpenStackInstanceMetricSamples,
  hasOpenStackInstanceMetrics,
  readOpenStackInstanceMetricSamples,
  removeOpenStackInstanceOriginals,
} from "../../../../Server/Utils/Telemetry/OpenStackInstanceMetricsScan";
import { isOpenStackSnapshotDatapoint } from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  OPENSTACK_HYPERVISOR_ATTRIBUTE,
  OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE,
  OPENSTACK_INSTANCE_ID_ATTRIBUTE,
  OPENSTACK_INSTANCE_PROJECT_ATTRIBUTE,
  OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE,
  OpenStackHypervisorCapacity,
  OpenStackHypervisorMetric,
  OpenStackInstanceMetric,
  OpenStackInstanceMetricSource,
} from "../../../../Types/OpenStack/OpenStackInstanceMetrics";
import {
  BURNER_ID,
  IDLE_ID,
  InstanceTruth,
  PROJECT_ID,
  STOPPED_ID,
  ceilometerText,
  libvirtText,
  parsePrometheusExposition,
  prometheusToEnvelope,
} from "../../../Helpers/OpenStackInstanceMetricsFixtures";
import { seededRandom } from "../../../Helpers/SeededRandom";

/*
 * Real instance usage from either source, in one shape, and above all with the right rates.
 * A wrong rate here is a wrong page and a wrong page at night: libvirt's counters and
 * Ceilometer's cumulative gauges each have their own way of being read wrongly, and each way
 * is a test below.
 */

const MINUTE_MS: number = 60 * 1000;
const START_MS: number = 1793785799000;
const HOST: string = "compute-01";
const HYPERVISOR: string = "compute-01.example.internal";

const REPO_ROOT: string = path.resolve(__dirname, "../../../../../..");

function truthOf(fields: Partial<InstanceTruth>): InstanceTruth {
  return {
    instanceId: BURNER_ID,
    domain: "instance-00000001",
    vcpus: 2,
    cpuSeconds: 1000,
    delaySeconds: 10,
    availableBytes: 1000 * 1024 * 1024,
    usableBytes: 400 * 1024 * 1024,
    unusedBytes: 100 * 1024 * 1024,
    residentBytes: 800 * 1024 * 1024,
    diskReadBytes: 1000000,
    diskWriteBytes: 2000000,
    diskReadRequests: 100,
    diskWriteRequests: 200,
    diskReadSeconds: 1,
    diskWriteSeconds: 4,
    networkReceiveBytes: 5000,
    networkTransmitBytes: 7000,
    ...fields,
  };
}

const PLACEMENT: OpenStackInstancePlacement = {
  hypervisorName: HYPERVISOR,
  regionName: "RegionOne",
  projectId: PROJECT_ID,
  aggregates: ["fast"],
};

function placements(
  ...ids: Array<string>
): Map<string, OpenStackInstancePlacement> {
  return new Map(
    (ids.length > 0 ? ids : [BURNER_ID]).map(
      (id: string): [string, OpenStackInstancePlacement] => {
        return [id, PLACEMENT];
      },
    ),
  );
}

interface Run {
  decision: OpenStackInstanceMetricsDecision;
  envelope: JSONObject;
}

// One batch through everything a real one goes through, in the order ingest does it.
function runBatch(data: {
  text: string;
  timeMs: number;
  states: Map<string, OpenStackInstanceMetricsHostState>;
  exporterHost?: string | undefined;
  known?: Map<string, OpenStackInstancePlacement> | undefined;
  isKept?: ((instance: { projectId: string | null }) => boolean) | undefined;
}): Run {
  const envelope: JSONObject = prometheusToEnvelope({
    series: parsePrometheusExposition(data.text),
    timeMs: data.timeMs,
    exporterHost: data.exporterHost === undefined ? HOST : data.exporterHost,
  });
  const decision: OpenStackInstanceMetricsDecision =
    applyOpenStackInstanceMetricSamples({
      samples: readOpenStackInstanceMetricSamples(envelope),
      states: data.states,
      placements: data.known || placements(),
      isInstanceKept:
        data.isKept ||
        ((): boolean => {
          return true;
        }),
    });
  removeOpenStackInstanceOriginals({
    envelope,
    droppedDomains: decision.droppedDomains,
    droppedInstanceIds: decision.droppedInstanceIds,
  });
  appendOpenStackInstanceMetrics({ envelope, metrics: decision.metrics });
  return { decision, envelope };
}

function pointsOf(
  decision: OpenStackInstanceMetricsDecision,
  name: string,
): Array<JSONObject> {
  const metric: JSONObject | undefined = decision.metrics.find(
    (one: JSONObject): boolean => {
      return one["name"] === name;
    },
  );
  return (
    ((metric?.["gauge"] as JSONObject | undefined)?.[
      "dataPoints"
    ] as Array<JSONObject>) || []
  );
}

function attribute(point: JSONObject, key: string): string | undefined {
  const found: JSONObject | undefined = (
    point["attributes"] as Array<JSONObject>
  ).find((one: JSONObject): boolean => {
    return one["key"] === key;
  });
  return (found?.["value"] as JSONObject | undefined)?.["stringValue"] as
    | string
    | undefined;
}

function valueOf(
  decision: OpenStackInstanceMetricsDecision,
  name: string,
  device?: string,
): number | undefined {
  const point: JSONObject | undefined = pointsOf(decision, name).find(
    (one: JSONObject): boolean => {
      return (
        !device ||
        attribute(one, OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE) === device
      );
    },
  );
  return point?.["asDouble"] as number | undefined;
}

function newStates(): Map<string, OpenStackInstanceMetricsHostState> {
  return new Map();
}

describe("rates", () => {
  describe("a real counter, as libvirt's are", () => {
    function step(
      previous: CounterState | null,
      atMs: number,
      value: number,
    ): CounterStep {
      return advanceOpenStackCounter({
        previous,
        atMs,
        value,
        behaviour: "counter",
      });
    }

    test("the first reading has nothing to be a rate of", () => {
      expect(step(null, START_MS, 100).rate).toBeNull();
    });

    test("is what it added, over the time between readings", () => {
      const first: CounterStep = step(null, START_MS, 100);
      expect(step(first.next, START_MS + MINUTE_MS, 160).rate).toBeCloseTo(1);
    });

    test("an unchanged counter really did nothing", () => {
      const first: CounterStep = step(null, START_MS, 100);
      expect(step(first.next, START_MS + MINUTE_MS, 100).rate).toBe(0);
    });

    test("a counter below its last reading restarted, so it has added what it reads now", () => {
      const first: CounterStep = step(null, START_MS, 1000);
      expect(step(first.next, START_MS + MINUTE_MS, 60).rate).toBeCloseTo(1);
    });

    test("a retried export changes nothing and reports nothing", () => {
      const first: CounterStep = step(null, START_MS, 100);
      const second: CounterStep = step(first.next, START_MS + MINUTE_MS, 160);
      const retried: CounterStep = step(second.next, START_MS + MINUTE_MS, 160);
      expect(retried.rate).toBeNull();
      expect(retried.next).toEqual(second.next);
      // The next real reading is still measured from the last one.
      expect(
        step(retried.next, START_MS + 2 * MINUTE_MS, 220).rate,
      ).toBeCloseTo(1);
    });

    test("a batch that lost a race and came late changes nothing", () => {
      const first: CounterStep = step(null, START_MS, 100);
      const second: CounterStep = step(first.next, START_MS + MINUTE_MS, 160);
      const late: CounterStep = step(second.next, START_MS + 30000, 130);
      expect(late.rate).toBeNull();
      expect(late.next).toEqual(second.next);
    });

    test("past the longest gap it starts again, rather than averaging a day into a sample", () => {
      const first: CounterStep = step(null, START_MS, 100);
      const later: CounterStep = step(
        first.next,
        START_MS + OPENSTACK_LIBVIRT_LONGEST_GAP_MS + 1,
        9000,
      );
      expect(later.rate).toBeNull();
      expect(
        step(later.next, later.next[0] + MINUTE_MS, 9060).rate,
      ).toBeCloseTo(1);
    });

    test("just inside the longest gap it is still a rate", () => {
      const first: CounterStep = step(null, START_MS, 0);
      expect(
        step(first.next, START_MS + OPENSTACK_LIBVIRT_LONGEST_GAP_MS, 900).rate,
      ).toBeCloseTo(1);
    });
  });

  describe("a cumulative gauge that only changes when it is polled, as Ceilometer's are", () => {
    function step(
      previous: CounterState | null,
      atMs: number,
      value: number,
    ): CounterStep {
      return advanceOpenStackCounter({
        previous,
        atMs,
        value,
        behaviour: "polled",
      });
    }

    test("a repeated value says nothing new, so reports nothing", () => {
      const first: CounterStep = step(null, START_MS, 100);
      const repeated: CounterStep = step(
        first.next,
        START_MS + 2 * MINUTE_MS,
        100,
      );
      expect(repeated.rate).toBeNull();
    });

    test("is measured from when it last changed, not from the last scrape", () => {
      // Scraped every two minutes, polled every five: the trap is 300 / 120 = 2.5.
      const first: CounterStep = step(null, START_MS, 0);
      const second: CounterStep = step(first.next, START_MS + 2 * MINUTE_MS, 0);
      const third: CounterStep = step(second.next, START_MS + 4 * MINUTE_MS, 0);
      const fourth: CounterStep = step(
        third.next,
        START_MS + 6 * MINUTE_MS,
        360,
      );
      expect(fourth.rate).toBeCloseTo(1);
    });

    test("over a long run it adds up to the truth, whatever the scrape and polling cycles are", () => {
      const random: (limit?: number) => number = seededRandom(5735);
      for (let round: number = 0; round < 50; round++) {
        const scrapeSeconds: number = 15 + random(285);
        const pollSeconds: number = 60 + random(600);
        const truePerSecond: number = 1 + random(50);
        let state: CounterState | null = null;
        let reported: number = 0;
        let firstValue: number | null = null;
        let lastValue: number = 0;
        const total: number = 7200;
        for (let at: number = 0; at <= total; at += scrapeSeconds) {
          // What a poll last read, which is all a scrape can see.
          const polledAt: number = Math.floor(at / pollSeconds) * pollSeconds;
          const value: number = polledAt * truePerSecond;
          const atMs: number = START_MS + at * 1000;
          const changedAt: number = state ? state[0] : atMs;
          const result: CounterStep = step(state, atMs, value);
          if (result.rate !== null) {
            reported += result.rate * ((atMs - changedAt) / 1000);
          }
          state = result.next;
          firstValue = firstValue === null ? value : firstValue;
          lastValue = value;
        }
        expect(reported).toBeCloseTo(lastValue - firstValue!, 3);
      }
    });

    test("a value that hasn't moved for longer than two polling cycles really is idle: it reads 0", () => {
      const first: CounterStep = step(null, START_MS, 100);
      const quiet: CounterStep = step(
        first.next,
        START_MS + OPENSTACK_CEILOMETER_QUIET_MS,
        100,
      );
      expect(quiet.rate).toBe(0);
      // And no sooner.
      expect(
        step(first.next, START_MS + OPENSTACK_CEILOMETER_QUIET_MS - 1, 100)
          .rate,
      ).toBeNull();
    });

    test("one idle stretch doesn't smear into the next reading", () => {
      const first: CounterStep = step(null, START_MS, 100);
      const quiet: CounterStep = step(
        first.next,
        START_MS + OPENSTACK_CEILOMETER_QUIET_MS,
        100,
      );
      const moved: CounterStep = step(
        quiet.next,
        START_MS + OPENSTACK_CEILOMETER_QUIET_MS + 5 * MINUTE_MS,
        400,
      );
      expect(moved.rate).toBeCloseTo(1);
    });

    test("an instance that rebooted restarts its cumulative gauge, and that counts what it has added since", () => {
      const first: CounterStep = step(null, START_MS, 90000);
      const reset: CounterStep = step(
        first.next,
        START_MS + 5 * MINUTE_MS,
        300,
      );
      expect(reset.rate).toBeCloseTo(1);
    });

    test("past the longest gap it starts again", () => {
      const first: CounterStep = step(null, START_MS, 0);
      expect(
        step(
          first.next,
          START_MS + OPENSTACK_CEILOMETER_LONGEST_GAP_MS + 1,
          999,
        ).rate,
      ).toBeNull();
    });

    test("a retried export reports nothing", () => {
      const first: CounterStep = step(null, START_MS, 0);
      const second: CounterStep = step(first.next, START_MS + MINUTE_MS, 60);
      expect(step(second.next, START_MS + MINUTE_MS, 60).rate).toBeNull();
    });
  });

  describe("a level", () => {
    test("libvirt's is new at every scrape, even when it reads the same", () => {
      const first: { next: CounterState; isNew: boolean } =
        advanceOpenStackLevel({
          previous: null,
          atMs: START_MS,
          value: 5,
          behaviour: "counter",
        });
      expect(first.isNew).toBe(true);
      expect(
        advanceOpenStackLevel({
          previous: first.next,
          atMs: START_MS + MINUTE_MS,
          value: 5,
          behaviour: "counter",
        }).isNew,
      ).toBe(true);
    });

    test("Ceilometer's repeats between polls and adds no row until it moves", () => {
      const first: { next: CounterState; isNew: boolean } =
        advanceOpenStackLevel({
          previous: null,
          atMs: START_MS,
          value: 5,
          behaviour: "polled",
        });
      const repeat: { next: CounterState; isNew: boolean } =
        advanceOpenStackLevel({
          previous: first.next,
          atMs: START_MS + MINUTE_MS,
          value: 5,
          behaviour: "polled",
        });
      expect(repeat.isNew).toBe(false);
      expect(
        advanceOpenStackLevel({
          previous: repeat.next,
          atMs: START_MS + 2 * MINUTE_MS,
          value: 6,
          behaviour: "polled",
        }).isNew,
      ).toBe(true);
    });

    test("and one that never moves still says it is there, so it isn't read as gone", () => {
      const first: { next: CounterState; isNew: boolean } =
        advanceOpenStackLevel({
          previous: null,
          atMs: START_MS,
          value: 5,
          behaviour: "polled",
        });
      expect(
        advanceOpenStackLevel({
          previous: first.next,
          atMs: START_MS + OPENSTACK_CEILOMETER_QUIET_MS,
          value: 5,
          behaviour: "polled",
        }).isNew,
      ).toBe(true);
    });
  });
});

describe("what a batch from libvirt's exporter becomes", () => {
  function twoScrapes(
    first: InstanceTruth,
    second: InstanceTruth,
  ): OpenStackInstanceMetricsDecision {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    runBatch({ text: libvirtText([first]), timeMs: START_MS, states });
    return runBatch({
      text: libvirtText([second]),
      timeMs: START_MS + MINUTE_MS,
      states,
    }).decision;
  }

  test("the first scrape has levels but no rates", () => {
    const { decision }: Run = runBatch({
      text: libvirtText([truthOf({})]),
      timeMs: START_MS,
      states: newStates(),
    });
    expect(valueOf(decision, OpenStackInstanceMetric.CpuUsage)).toBeUndefined();
    expect(valueOf(decision, OpenStackInstanceMetric.MemoryResident)).toBe(
      800 * 1024 * 1024,
    );
  });

  test("CPU: how many of the host's threads it uses, and that as a share of its vCPUs", () => {
    const decision: OpenStackInstanceMetricsDecision = twoScrapes(
      truthOf({ cpuSeconds: 1000 }),
      truthOf({ cpuSeconds: 1090 }),
    );
    expect(valueOf(decision, OpenStackInstanceMetric.CpuUsage)).toBeCloseTo(
      1.5,
    );
    expect(
      valueOf(decision, OpenStackInstanceMetric.CpuUtilization),
    ).toBeCloseTo(75);
  });

  test("a burning vCPU reads 100%, and more when its emulator threads run too", () => {
    const decision: OpenStackInstanceMetricsDecision = twoScrapes(
      truthOf({ vcpus: 1, cpuSeconds: 1000 }),
      truthOf({ vcpus: 1, cpuSeconds: 1066 }),
    );
    expect(
      valueOf(decision, OpenStackInstanceMetric.CpuUtilization),
    ).toBeCloseTo(110);
  });

  test("contention: the time its vCPUs waited, as a share of them, once per instance however many vCPUs", () => {
    const decision: OpenStackInstanceMetricsDecision = twoScrapes(
      truthOf({ vcpus: 2, delaySeconds: 10 }),
      truthOf({ vcpus: 2, delaySeconds: 22 }),
    );
    const points: Array<JSONObject> = pointsOf(
      decision,
      OpenStackInstanceMetric.CpuContention,
    );
    expect(points).toHaveLength(1);
    // 12 seconds of waiting in a minute, across 2 vCPUs: 10% of their time.
    expect(points[0]!["asDouble"]).toBeCloseTo(10);
  });

  test("memory is what the guest says it uses, not the balloon's size", () => {
    const decision: OpenStackInstanceMetricsDecision = twoScrapes(
      truthOf({}),
      truthOf({}),
    );
    // available - usable, as Ceilometer works it out. Never 134217728, the trap.
    expect(valueOf(decision, OpenStackInstanceMetric.MemoryUsage)).toBe(
      600 * 1024 * 1024,
    );
  });

  test("only one memory reading per collection, whichever series comes last", () => {
    const decision: OpenStackInstanceMetricsDecision = twoScrapes(
      truthOf({}),
      truthOf({}),
    );
    expect(
      pointsOf(decision, OpenStackInstanceMetric.MemoryUsage),
    ).toHaveLength(1);
  });

  test("a guest that only reports unused still has a reading", () => {
    const decision: OpenStackInstanceMetricsDecision = twoScrapes(
      truthOf({ usableBytes: undefined }),
      truthOf({ usableBytes: undefined }),
    );
    expect(valueOf(decision, OpenStackInstanceMetric.MemoryUsage)).toBe(
      900 * 1024 * 1024,
    );
  });

  test("with no balloon driver in the guest there is no memory reading, and what it holds on its host still reads", () => {
    const noBalloon: Partial<InstanceTruth> = {
      availableBytes: undefined,
      usableBytes: undefined,
      unusedBytes: undefined,
    };
    const decision: OpenStackInstanceMetricsDecision = twoScrapes(
      truthOf(noBalloon),
      truthOf(noBalloon),
    );
    expect(
      valueOf(decision, OpenStackInstanceMetric.MemoryUsage),
    ).toBeUndefined();
    expect(valueOf(decision, OpenStackInstanceMetric.MemoryResident)).toBe(
      800 * 1024 * 1024,
    );
  });

  test("disk and network: per device, per second", () => {
    const decision: OpenStackInstanceMetricsDecision = twoScrapes(
      truthOf({}),
      truthOf({
        diskReadBytes: 1000000 + 60000,
        diskWriteBytes: 2000000 + 120000,
        diskReadRequests: 100 + 60,
        diskWriteRequests: 200 + 120,
        networkReceiveBytes: 5000 + 6000,
        networkTransmitBytes: 7000 + 12000,
      }),
    );
    expect(valueOf(decision, OpenStackInstanceMetric.DiskReadRate, "vda")).toBe(
      1000,
    );
    expect(
      valueOf(decision, OpenStackInstanceMetric.DiskWriteRate, "vda"),
    ).toBe(2000);
    expect(
      valueOf(decision, OpenStackInstanceMetric.DiskReadOperations, "vda"),
    ).toBe(1);
    expect(
      valueOf(decision, OpenStackInstanceMetric.DiskWriteOperations, "vda"),
    ).toBe(2);
    expect(
      valueOf(
        decision,
        OpenStackInstanceMetric.NetworkReceiveRate,
        "tap1234abcd-ef",
      ),
    ).toBe(100);
    expect(
      valueOf(
        decision,
        OpenStackInstanceMetric.NetworkTransmitRate,
        "tap1234abcd-ef",
      ),
    ).toBe(200);
  });

  test("latency: the time a device's requests took, over how many there were", () => {
    const decision: OpenStackInstanceMetricsDecision = twoScrapes(
      truthOf({ diskReadSeconds: 1, diskReadRequests: 100 }),
      // 6 seconds over 60 requests: 100 ms each.
      truthOf({ diskReadSeconds: 7, diskReadRequests: 160 }),
    );
    expect(
      valueOf(decision, OpenStackInstanceMetric.DiskReadLatency, "vda"),
    ).toBeCloseTo(100);
  });

  test("a disk with no requests has no latency, rather than a latency of 0", () => {
    const decision: OpenStackInstanceMetricsDecision = twoScrapes(
      truthOf({}),
      truthOf({}),
    );
    expect(pointsOf(decision, OpenStackInstanceMetric.DiskReadLatency)).toEqual(
      [],
    );
    expect(valueOf(decision, OpenStackInstanceMetric.DiskReadRate, "vda")).toBe(
      0,
    );
  });

  test("a reboot resets the counters: CPU counts from zero, and never reads negative", () => {
    const decision: OpenStackInstanceMetricsDecision = twoScrapes(
      truthOf({ cpuSeconds: 90000 }),
      truthOf({ cpuSeconds: 30 }),
    );
    expect(valueOf(decision, OpenStackInstanceMetric.CpuUsage)).toBeCloseTo(
      0.5,
    );
  });

  test("every series names its instance, its source, its project, its hypervisor and its region", () => {
    const decision: OpenStackInstanceMetricsDecision = twoScrapes(
      truthOf({}),
      truthOf({ cpuSeconds: 1060 }),
    );
    const point: JSONObject = pointsOf(
      decision,
      OpenStackInstanceMetric.CpuUsage,
    )[0]!;
    expect(attribute(point, OPENSTACK_INSTANCE_ID_ATTRIBUTE)).toBe(BURNER_ID);
    expect(attribute(point, OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE)).toBe(
      OpenStackInstanceMetricSource.Libvirt,
    );
    expect(attribute(point, OPENSTACK_INSTANCE_PROJECT_ATTRIBUTE)).toBe(
      PROJECT_ID,
    );
    expect(attribute(point, OPENSTACK_HYPERVISOR_ATTRIBUTE)).toBe(HYPERVISOR);
    expect(attribute(point, "openstack.region.name")).toBe("RegionOne");
    expect(point["timeUnixNano"]).toBe(`${START_MS + MINUTE_MS}000000`);
  });

  test("an instance the inventory doesn't know yet still reports, with what its series say", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    runBatch({
      text: libvirtText([truthOf({})]),
      timeMs: START_MS,
      states,
      known: new Map(),
    });
    const { decision }: Run = runBatch({
      text: libvirtText([truthOf({ cpuSeconds: 1060 })]),
      timeMs: START_MS + MINUTE_MS,
      states,
      known: new Map(),
    });
    const point: JSONObject = pointsOf(
      decision,
      OpenStackInstanceMetric.CpuUsage,
    )[0]!;
    expect(attribute(point, OPENSTACK_INSTANCE_ID_ATTRIBUTE)).toBe(BURNER_ID);
    expect(attribute(point, OPENSTACK_INSTANCE_PROJECT_ATTRIBUTE)).toBe(
      PROJECT_ID,
    );
    expect(attribute(point, OPENSTACK_HYPERVISOR_ATTRIBUTE)).toBeUndefined();
  });

  test("a value the exporter couldn't work out is left out, not stored as NaN", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    const text: string = `libvirt_domain_openstack_info{domain="d",instance_id="${BURNER_ID}",project_id="${PROJECT_ID}"} 1\nlibvirt_domain_info_cpu_time_seconds_total{domain="d"} NaN`;
    const { decision }: Run = runBatch({ text, timeMs: START_MS, states });
    expect(decision.metrics).toEqual([]);
  });
});

describe("a scrape the collector split across batches", () => {
  function splitByLine(text: string, parts: number): Array<string> {
    const lines: Array<string> = text.split("\n");
    const out: Array<Array<string>> = Array.from({ length: parts }, () => {
      return [];
    });
    lines.forEach((line: string, index: number): void => {
      out[index % parts]!.push(line);
    });
    return out.map((part: Array<string>): string => {
      return part.join("\n");
    });
  }

  function reversedText(text: string): string {
    return text.split("\n").reverse().join("\n");
  }

  test("a domain's series that arrive before the one that says who it is wait for the next scrape", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    const onlyCpu: string = `libvirt_domain_info_cpu_time_seconds_total{domain="instance-00000001"} 1000`;
    const { decision }: Run = runBatch({
      text: onlyCpu,
      timeMs: START_MS,
      states,
    });
    expect(decision.metrics).toEqual([]);
    runBatch({
      text: `libvirt_domain_openstack_info{domain="instance-00000001",instance_id="${BURNER_ID}",project_id="${PROJECT_ID}"} 1`,
      timeMs: START_MS + 1000,
      states,
    });
    runBatch({
      text: onlyCpu,
      timeMs: START_MS + MINUTE_MS,
      states,
    });
    const next: Run = runBatch({
      text: `libvirt_domain_info_cpu_time_seconds_total{domain="instance-00000001"} 1060`,
      timeMs: START_MS + 2 * MINUTE_MS,
      states,
    });
    expect(
      valueOf(next.decision, OpenStackInstanceMetric.CpuUsage),
    ).toBeCloseTo(1);
  });

  test.each([2, 3, 7, 40])(
    "split into %i batches, the same rates come out",
    (parts: number) => {
      const whole: Map<string, OpenStackInstanceMetricsHostState> = newStates();
      const split: Map<string, OpenStackInstanceMetricsHostState> = newStates();
      const first: string = libvirtText([truthOf({})]);
      const second: string = libvirtText([
        truthOf({
          cpuSeconds: 1090,
          diskReadBytes: 1060000,
          networkReceiveBytes: 11000,
          diskReadRequests: 160,
          diskReadSeconds: 7,
        }),
      ]);
      runBatch({ text: first, timeMs: START_MS, states: whole });
      const wholeRun: Run = runBatch({
        text: second,
        timeMs: START_MS + MINUTE_MS,
        states: whole,
      });

      // The cloud has been reporting for a while, so who each domain is is known.
      runBatch({ text: first, timeMs: START_MS - MINUTE_MS, states: split });
      for (const part of splitByLine(first, parts)) {
        runBatch({ text: part, timeMs: START_MS, states: split });
      }
      const pieces: Array<OpenStackInstanceMetricsDecision> = splitByLine(
        second,
        parts,
      ).map((part: string): OpenStackInstanceMetricsDecision => {
        return runBatch({
          text: part,
          timeMs: START_MS + MINUTE_MS,
          states: split,
        }).decision;
      });

      const of: (name: OpenStackInstanceMetric, device?: string) => number = (
        name: OpenStackInstanceMetric,
        device?: string,
      ): number => {
        const values: Array<number> = [];
        for (const piece of pieces) {
          const value: number | undefined = valueOf(piece, name, device);
          if (value !== undefined) {
            values.push(value);
          }
        }
        // One reading, however the batches fell.
        expect(values.length).toBeGreaterThanOrEqual(1);
        return values[values.length - 1]!;
      };

      for (const [name, device] of [
        [OpenStackInstanceMetric.CpuUsage],
        [OpenStackInstanceMetric.DiskReadRate, "vda"],
        [OpenStackInstanceMetric.DiskReadLatency, "vda"],
        [OpenStackInstanceMetric.NetworkReceiveRate, "tap1234abcd-ef"],
        [OpenStackInstanceMetric.MemoryResident],
      ] as Array<[OpenStackInstanceMetric, string?]>) {
        expect(of(name, device)).toBeCloseTo(
          valueOf(wholeRun.decision, name, device)!,
        );
      }
    },
  );

  test("the order series arrive in doesn't change an answer", () => {
    const forward: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    const backward: Map<string, OpenStackInstanceMetricsHostState> =
      newStates();
    const first: string = libvirtText([truthOf({})]);
    const second: string = libvirtText([
      truthOf({ cpuSeconds: 1090, diskReadRequests: 160, diskReadSeconds: 7 }),
    ]);
    runBatch({ text: first, timeMs: START_MS, states: forward });
    runBatch({ text: reversedText(first), timeMs: START_MS, states: backward });
    const a: Run = runBatch({
      text: second,
      timeMs: START_MS + MINUTE_MS,
      states: forward,
    });
    const b: Run = runBatch({
      text: reversedText(second),
      timeMs: START_MS + MINUTE_MS,
      states: backward,
    });
    for (const name of [
      OpenStackInstanceMetric.CpuUsage,
      OpenStackInstanceMetric.CpuUtilization,
      OpenStackInstanceMetric.CpuContention,
      OpenStackInstanceMetric.MemoryUsage,
    ]) {
      expect(valueOf(b.decision, name)).toBeCloseTo(valueOf(a.decision, name)!);
    }
    expect(
      valueOf(b.decision, OpenStackInstanceMetric.DiskReadLatency, "vda"),
    ).toBeCloseTo(
      valueOf(a.decision, OpenStackInstanceMetric.DiskReadLatency, "vda")!,
    );
  });
});

describe("what a batch from Ceilometer's exporter becomes", () => {
  test("is read from its resource label: an instance, or an instance and a device", () => {
    const envelope: JSONObject = prometheusToEnvelope({
      series: parsePrometheusExposition(ceilometerText([truthOf({})])),
      timeMs: START_MS,
      exporterHost: HOST,
    });
    const samples: ReturnType<typeof readOpenStackInstanceMetricSamples> =
      readOpenStackInstanceMetricSamples(envelope);
    expect(
      samples.every(
        (
          sample: ReturnType<typeof readOpenStackInstanceMetricSamples>[number],
        ) => {
          return sample.instanceId === BURNER_ID;
        },
      ),
    ).toBe(true);
    const devices: Array<string | null> = samples.map(
      (
        sample: ReturnType<typeof readOpenStackInstanceMetricSamples>[number],
      ) => {
        return sample.device;
      },
    );
    expect(devices).toContain("vda");
    expect(devices).toContain("tap1234abcd-ef");
  });

  test("a resource with no instance in it is nobody's", () => {
    const text: string = `ceilometer_network_incoming_bytes{resource="nova-instance-instance-00000001-fa163e12ab34",project="p"} 5`;
    expect(
      readOpenStackInstanceMetricSamples(
        prometheusToEnvelope({
          series: parsePrometheusExposition(text),
          timeMs: START_MS,
        }),
      ),
    ).toEqual([]);
  });

  test("nanoseconds become CPU threads", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    runBatch({
      text: ceilometerText([truthOf({ cpuSeconds: 1000 })]),
      timeMs: START_MS,
      states,
    });
    const { decision }: Run = runBatch({
      text: ceilometerText([truthOf({ cpuSeconds: 1300 })]),
      timeMs: START_MS + 5 * MINUTE_MS,
      states,
    });
    expect(valueOf(decision, OpenStackInstanceMetric.CpuUsage)).toBeCloseTo(1);
    expect(
      valueOf(decision, OpenStackInstanceMetric.CpuUtilization),
    ).toBeCloseTo(50);
  });

  test("scraped between polls it reports nothing new, and adds no rows", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    runBatch({
      text: ceilometerText([truthOf({})]),
      timeMs: START_MS,
      states,
    });
    const { decision }: Run = runBatch({
      text: ceilometerText([truthOf({})]),
      timeMs: START_MS + 2 * MINUTE_MS,
      states,
    });
    for (const name of Object.values(OpenStackInstanceMetric)) {
      expect(pointsOf(decision, name)).toEqual([]);
    }
  });

  test("across several polling cycles the rate holds still, however the scrapes fall", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    const rates: Array<number> = [];
    // Scraped every two minutes, polled every five, truly one thread busy.
    for (let minute: number = 0; minute <= 40; minute += 2) {
      const polled: number = Math.floor(minute / 5) * 5;
      const { decision }: Run = runBatch({
        text: ceilometerText([truthOf({ cpuSeconds: 1000 + polled * 60 })]),
        timeMs: START_MS + minute * MINUTE_MS,
        states,
      });
      const rate: number | undefined = valueOf(
        decision,
        OpenStackInstanceMetric.CpuUsage,
      );
      if (rate !== undefined) {
        rates.push(rate);
      }
    }
    expect(rates.length).toBe(8);
    for (const rate of rates) {
      /*
       * A polling cycle's five minutes seen across scrapes of two is either 4 or 6
       * minutes, so a reading is within a third of the truth and the average is the truth.
       */
      expect(rate).toBeGreaterThan(0.8);
      expect(rate).toBeLessThan(1.3);
    }
    const mean: number =
      rates.reduce((sum: number, rate: number): number => {
        return sum + rate;
      }, 0) / rates.length;
    expect(mean).toBeCloseTo(1, 0);
  });
});

describe("the two sources produce one shape", () => {
  function burn(minute: number): InstanceTruth {
    return truthOf({
      cpuSeconds: 1000 + minute * 60 * 1.5,
      delaySeconds: 10 + minute * 60 * 0.2,
      diskReadBytes: 1000000 + minute * 60 * 1000,
      diskWriteBytes: 2000000 + minute * 60 * 2000,
      diskReadRequests: 100 + minute * 60 * 2,
      diskWriteRequests: 200 + minute * 60 * 4,
      diskReadSeconds: 1 + minute * 60 * 0.02,
      diskWriteSeconds: 4 + minute * 60 * 0.08,
      networkReceiveBytes: 5000 + minute * 60 * 300,
      networkTransmitBytes: 7000 + minute * 60 * 400,
      // A level moves between polls too, and only then adds a row for Ceilometer.
      availableBytes: (1000 + minute) * 1024 * 1024,
      residentBytes: (800 + minute) * 1024 * 1024,
    });
  }

  function lastPoll(
    source: OpenStackInstanceMetricSource,
  ): OpenStackInstanceMetricsDecision {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    const text: (minute: number) => string = (minute: number): string => {
      return source === OpenStackInstanceMetricSource.Libvirt
        ? libvirtText([burn(minute)])
        : ceilometerText([burn(minute)]);
    };
    runBatch({ text: text(0), timeMs: START_MS, states });
    return runBatch({
      text: text(5),
      timeMs: START_MS + 5 * MINUTE_MS,
      states,
    }).decision;
  }

  const libvirt: OpenStackInstanceMetricsDecision = lastPoll(
    OpenStackInstanceMetricSource.Libvirt,
  );
  const ceilometer: OpenStackInstanceMetricsDecision = lastPoll(
    OpenStackInstanceMetricSource.Ceilometer,
  );

  function namesOf(decision: OpenStackInstanceMetricsDecision): Array<string> {
    return decision.metrics
      .map((metric: JSONObject): string => {
        return metric["name"] as string;
      })
      .sort();
  }

  test("the same series come out of each", () => {
    expect(namesOf(ceilometer)).toEqual(namesOf(libvirt));
    expect(namesOf(libvirt)).toEqual(
      expect.arrayContaining(Object.values(OpenStackInstanceMetric)),
    );
  });

  test.each(Object.values(OpenStackInstanceMetric))(
    "%s reads the same from each, in the same labels",
    (name: string) => {
      const a: Array<JSONObject> = pointsOf(libvirt, name);
      const b: Array<JSONObject> = pointsOf(ceilometer, name);
      expect(a.length).toBeGreaterThan(0);
      expect(b).toHaveLength(a.length);
      const labelsOf: (point: JSONObject) => Array<string> = (
        point: JSONObject,
      ): Array<string> => {
        return (point["attributes"] as Array<JSONObject>)
          .map((one: JSONObject): string => {
            return one["key"] as string;
          })
          .sort();
      };
      expect(labelsOf(b[0]!)).toEqual(labelsOf(a[0]!));
      expect(b[0]!["asDouble"] as number).toBeCloseTo(
        a[0]!["asDouble"] as number,
        3,
      );
    },
  );

  test("only the source label tells them apart", () => {
    expect(
      attribute(
        pointsOf(ceilometer, OpenStackInstanceMetric.CpuUsage)[0]!,
        OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE,
      ),
    ).toBe(OpenStackInstanceMetricSource.Ceilometer);
  });

  test("hypervisor totals come from each too", () => {
    for (const name of [
      OpenStackHypervisorMetric.InstancesCpuUsage,
      OpenStackHypervisorMetric.InstancesMemoryResident,
      OpenStackHypervisorMetric.InstancesReporting,
    ]) {
      expect(valueOf(ceilometer, name)).toBeCloseTo(valueOf(libvirt, name)!, 3);
    }
  });
});

describe("a hypervisor's totals", () => {
  const known: Map<string, OpenStackInstancePlacement> = placements(
    BURNER_ID,
    IDLE_ID,
    STOPPED_ID,
  );

  function estate(minute: number): Array<InstanceTruth> {
    return [
      truthOf({ cpuSeconds: 1000 + minute * 60 * 2 }),
      truthOf({
        instanceId: IDLE_ID,
        domain: "instance-00000002",
        cpuSeconds: 50 + minute * 6,
        residentBytes: 200 * 1024 * 1024,
      }),
    ];
  }

  function withCapacity(
    capacity: OpenStackHypervisorCapacity,
  ): Map<string, OpenStackInstancePlacement> {
    return new Map(
      Array.from(known.entries()).map(
        ([id, placement]: [string, OpenStackInstancePlacement]): [
          string,
          OpenStackInstancePlacement,
        ] => {
          return [id, { ...placement, hypervisorCapacity: capacity }];
        },
      ),
    );
  }

  test("say what share of the hypervisor that is, in the same batch, so an alert can't miss it", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    const capacity: Map<string, OpenStackInstancePlacement> = withCapacity({
      cores: 4,
      memoryBytes: 2000 * 1024 * 1024,
    });
    runBatch({
      text: libvirtText(estate(0)),
      timeMs: START_MS,
      states,
      known: capacity,
    });
    const { decision }: Run = runBatch({
      text: libvirtText(estate(1)),
      timeMs: START_MS + MINUTE_MS,
      states,
      known: capacity,
    });

    // 2.1 threads of 4, and 1000 MiB of 2000.
    expect(
      valueOf(decision, OpenStackHypervisorMetric.InstancesCpuUtilization),
    ).toBeCloseTo(52.5);
    expect(
      valueOf(decision, OpenStackHypervisorMetric.InstancesMemoryUtilization),
    ).toBeCloseTo(50);
    const point: JSONObject = pointsOf(
      decision,
      OpenStackHypervisorMetric.InstancesCpuUtilization,
    )[0]!;
    const total: JSONObject = pointsOf(
      decision,
      OpenStackHypervisorMetric.InstancesCpuUsage,
    )[0]!;
    expect(point["timeUnixNano"]).toBe(total["timeUnixNano"]);
    expect(attribute(point, OPENSTACK_HYPERVISOR_ATTRIBUTE)).toBe(HYPERVISOR);
  });

  test.each([
    ["no capacity read yet", undefined],
    ["a capacity of nothing", { cores: 0, memoryBytes: 0 }],
    ["only what is unknown", { cores: null, memoryBytes: null }],
  ])(
    "say no share with %s: a number against nothing is no number",
    (_name: string, capacity: OpenStackHypervisorCapacity | undefined) => {
      const states: Map<string, OpenStackInstanceMetricsHostState> =
        newStates();
      const given: Map<string, OpenStackInstancePlacement> = capacity
        ? withCapacity(capacity)
        : known;
      runBatch({
        text: libvirtText(estate(0)),
        timeMs: START_MS,
        states,
        known: given,
      });
      const { decision }: Run = runBatch({
        text: libvirtText(estate(1)),
        timeMs: START_MS + MINUTE_MS,
        states,
        known: given,
      });
      expect(
        pointsOf(decision, OpenStackHypervisorMetric.InstancesCpuUtilization),
      ).toHaveLength(0);
      expect(
        pointsOf(
          decision,
          OpenStackHypervisorMetric.InstancesMemoryUtilization,
        ),
      ).toHaveLength(0);
      // What it adds up to is still known, and still said.
      expect(
        valueOf(decision, OpenStackHypervisorMetric.InstancesCpuUsage),
      ).toBeCloseTo(2.1);
    },
  );

  test("add up what its instances use, and name it by Nova's own word for it", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    runBatch({ text: libvirtText(estate(0)), timeMs: START_MS, states, known });
    const { decision }: Run = runBatch({
      text: libvirtText(estate(1)),
      timeMs: START_MS + MINUTE_MS,
      states,
      known,
    });
    const point: JSONObject = pointsOf(
      decision,
      OpenStackHypervisorMetric.InstancesCpuUsage,
    )[0]!;
    expect(point["asDouble"]).toBeCloseTo(2.1);
    expect(attribute(point, OPENSTACK_HYPERVISOR_ATTRIBUTE)).toBe(HYPERVISOR);
    expect(attribute(point, "openstack.region.name")).toBe("RegionOne");
    expect(
      valueOf(decision, OpenStackHypervisorMetric.InstancesMemoryResident),
    ).toBe(1000 * 1024 * 1024);
    expect(
      valueOf(decision, OpenStackHypervisorMetric.InstancesReporting),
    ).toBe(2);
  });

  test("hold every instance however the scrape was split into batches", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    runBatch({ text: libvirtText(estate(0)), timeMs: START_MS, states, known });
    runBatch({
      text: libvirtText([estate(1)[0]!]),
      timeMs: START_MS + MINUTE_MS,
      states,
      known,
    });
    const { decision }: Run = runBatch({
      text: libvirtText([estate(1)[1]!]),
      timeMs: START_MS + MINUTE_MS,
      states,
      known,
    });
    expect(
      valueOf(decision, OpenStackHypervisorMetric.InstancesCpuUsage),
    ).toBeCloseTo(2.1);
  });

  test("let go of an instance that has stopped reporting", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    runBatch({ text: libvirtText(estate(0)), timeMs: START_MS, states, known });
    runBatch({
      text: libvirtText(estate(1)),
      timeMs: START_MS + MINUTE_MS,
      states,
      known,
    });
    // The second instance is deleted: only the first says anything from here.
    runBatch({
      text: libvirtText([estate(2)[0]!]),
      timeMs: START_MS + 2 * MINUTE_MS,
      states,
      known,
    });
    runBatch({
      text: libvirtText([estate(3)[0]!]),
      timeMs: START_MS + 3 * MINUTE_MS,
      states,
      known,
    });
    const { decision }: Run = runBatch({
      text: libvirtText([estate(5)[0]!]),
      timeMs: START_MS + 5 * MINUTE_MS,
      states,
      known,
    });
    expect(
      valueOf(decision, OpenStackHypervisorMetric.InstancesReporting),
    ).toBe(1);
    expect(
      valueOf(decision, OpenStackHypervisorMetric.InstancesCpuUsage),
    ).toBeCloseTo(2);
  });

  test("a stopped instance, which libvirt reads as 0, adds nothing", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    const withStopped: (minute: number) => Array<InstanceTruth> = (
      minute: number,
    ): Array<InstanceTruth> => {
      return [
        ...estate(minute),
        truthOf({
          instanceId: STOPPED_ID,
          domain: "instance-00000003",
          cpuSeconds: 0,
          residentBytes: 0,
        }),
      ];
    };
    runBatch({
      text: libvirtText(withStopped(0)),
      timeMs: START_MS,
      states,
      known,
    });
    const { decision }: Run = runBatch({
      text: libvirtText(withStopped(1)),
      timeMs: START_MS + MINUTE_MS,
      states,
      known,
    });
    expect(
      valueOf(decision, OpenStackHypervisorMetric.InstancesCpuUsage),
    ).toBeCloseTo(2.1);
  });

  test("are not written when nothing says which hypervisor this is", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    runBatch({ text: libvirtText(estate(0)), timeMs: START_MS, states });
    const { decision }: Run = runBatch({
      text: libvirtText(estate(1)),
      timeMs: START_MS + MINUTE_MS,
      states,
      known: new Map(),
    });
    expect(
      pointsOf(decision, OpenStackHypervisorMetric.InstancesCpuUsage),
    ).toEqual([]);
  });

  test("are not written for an exporter with no host: that would be several hypervisors mixed", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    runBatch({
      text: libvirtText(estate(0)),
      timeMs: START_MS,
      states,
      known,
      exporterHost: "",
    });
    const { decision }: Run = runBatch({
      text: libvirtText(estate(1)),
      timeMs: START_MS + MINUTE_MS,
      states,
      known,
      exporterHost: "",
    });
    expect(
      pointsOf(decision, OpenStackHypervisorMetric.InstancesCpuUsage),
    ).toEqual([]);
    // Each instance's own series don't need it.
    expect(pointsOf(decision, OpenStackInstanceMetric.CpuUsage)).toHaveLength(
      2,
    );
  });
});

describe("cost is a choice", () => {
  function notKept(): boolean {
    return false;
  }

  test("an instance nobody chose keeps none of its series, and its originals go too", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    runBatch({
      text: libvirtText([truthOf({})]),
      timeMs: START_MS,
      states,
      isKept: notKept,
    });
    const { decision, envelope }: Run = runBatch({
      text: libvirtText([truthOf({ cpuSeconds: 1060 })]),
      timeMs: START_MS + MINUTE_MS,
      states,
      isKept: notKept,
    });
    expect(pointsOf(decision, OpenStackInstanceMetric.CpuUsage)).toEqual([]);
    const names: Array<string> = (
      (envelope["scopeMetrics"] as JSONArray).flatMap((scope: unknown) => {
        return ((scope as JSONObject)["metrics"] as JSONArray) || [];
      }) as Array<JSONObject>
    ).map((metric: JSONObject): string => {
      return metric["name"] as string;
    });
    expect(
      names.filter((name: string): boolean => {
        return name.startsWith("libvirt_domain_block");
      }),
    ).toEqual([]);
    expect(names).not.toContain("libvirt_domain_openstack_info");
    // Whether the exporter is working is nobody's to give up.
    expect(names).toContain("libvirt_up");
    // A hypervisor's totals are one series each, and they are what names a busy host.
    expect(names).toContain(OpenStackHypervisorMetric.InstancesCpuUsage);
  });

  test("and even then, what it costs in state still means its hypervisor's total is right", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    runBatch({
      text: libvirtText([truthOf({})]),
      timeMs: START_MS,
      states,
      isKept: notKept,
    });
    const { decision }: Run = runBatch({
      text: libvirtText([truthOf({ cpuSeconds: 1120 })]),
      timeMs: START_MS + MINUTE_MS,
      states,
      isKept: notKept,
    });
    expect(
      valueOf(decision, OpenStackHypervisorMetric.InstancesCpuUsage),
    ).toBeCloseTo(2);
  });

  test("one chosen instance keeps its series and its originals, beside one that wasn't", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    const known: Map<string, OpenStackInstancePlacement> = new Map([
      [BURNER_ID, { ...PLACEMENT, projectId: "chosen" }],
      [IDLE_ID, { ...PLACEMENT, projectId: "other" }],
    ]);
    const isKept: (instance: {
      projectId: string | null;
    }) => boolean = (instance: { projectId: string | null }): boolean => {
      return instance.projectId !== PROJECT_ID;
    };
    // Its series say which project it is in, so the labels decide it here.
    const text: (minute: number) => string = (minute: number): string => {
      return libvirtText([truthOf({ cpuSeconds: 1000 + minute * 60 })]).replace(
        `project_id="${PROJECT_ID}"`,
        'project_id="chosen"',
      );
    };
    runBatch({ text: text(0), timeMs: START_MS, states, known, isKept });
    const { decision }: Run = runBatch({
      text: text(1),
      timeMs: START_MS + MINUTE_MS,
      states,
      known,
      isKept,
    });
    expect(pointsOf(decision, OpenStackInstanceMetric.CpuUsage)).toHaveLength(
      1,
    );
    expect(decision.droppedInstanceIds.size).toBe(0);
  });
});

describe("the batch it hands back", () => {
  test("appends beside the originals, in a scope of its own, and leaves the originals as they came", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    runBatch({ text: libvirtText([truthOf({})]), timeMs: START_MS, states });
    const { envelope }: Run = runBatch({
      text: libvirtText([truthOf({ cpuSeconds: 1060 })]),
      timeMs: START_MS + MINUTE_MS,
      states,
    });
    const scopes: Array<JSONObject> = envelope[
      "scopeMetrics"
    ] as Array<JSONObject>;
    expect(scopes).toHaveLength(2);
    expect((scopes[1]!["scope"] as JSONObject)["name"]).toBe(
      OPENSTACK_INSTANCE_METRICS_SCOPE_NAME,
    );
    const originals: Array<JSONObject> = scopes[0]![
      "metrics"
    ] as Array<JSONObject>;
    expect(
      originals.some((metric: JSONObject): boolean => {
        return metric["name"] === "libvirt_domain_info_cpu_time_seconds_total";
      }),
    ).toBe(true);
    // The trap stays where a person can read it. It just isn't called usage.
    expect(
      originals.some((metric: JSONObject): boolean => {
        return metric["name"] === "libvirt_domain_info_memory_usage_bytes";
      }),
    ).toBe(true);
  });

  test("a retried batch adds nothing twice", () => {
    const states: Map<string, OpenStackInstanceMetricsHostState> = newStates();
    runBatch({ text: libvirtText([truthOf({})]), timeMs: START_MS, states });
    runBatch({
      text: libvirtText([truthOf({ cpuSeconds: 1060 })]),
      timeMs: START_MS + MINUTE_MS,
      states,
    });
    const retried: Run = runBatch({
      text: libvirtText([truthOf({ cpuSeconds: 1060 })]),
      timeMs: START_MS + MINUTE_MS,
      states,
    });
    expect(
      pointsOf(retried.decision, OpenStackInstanceMetric.CpuUsage),
    ).toEqual([]);
  });

  test("a batch with nothing of either's isn't read at all", () => {
    expect(
      hasOpenStackInstanceMetrics(
        prometheusToEnvelope({
          series: parsePrometheusExposition("openstack_nova_up 1"),
          timeMs: START_MS,
        }),
      ),
    ).toBe(false);
  });

  test("nor is one from anything but an OpenStack cloud", () => {
    const envelope: JSONObject = prometheusToEnvelope({
      series: parsePrometheusExposition("libvirt_up 1"),
      timeMs: START_MS,
    });
    expect(hasOpenStackInstanceMetrics(envelope)).toBe(true);
    (envelope["resource"] as JSONObject)["attributes"] = [];
    expect(hasOpenStackInstanceMetrics(envelope)).toBe(false);
  });

  test("a malformed batch doesn't throw", () => {
    expect(hasOpenStackInstanceMetrics({})).toBe(false);
    expect(readOpenStackInstanceMetricSamples({})).toEqual([]);
    expect(
      readOpenStackInstanceMetricSamples({
        scopeMetrics: [
          null,
          { metrics: [null, { name: "libvirt_domain_info_virtual_cpus" }] },
        ],
      } as unknown as JSONObject),
    ).toEqual([]);
  });

  test("the agent's scrape jobs for these are no OpenStack API on the Services page", () => {
    for (const service of ["libvirt", "ceilometer"]) {
      expect(
        isOpenStackSnapshotDatapoint({
          metricName: "up",
          datapoint: {
            attributes: [
              { key: "openstack_service", value: { stringValue: service } },
            ],
          },
        }),
      ).toBe(false);
    }
    expect(
      isOpenStackSnapshotDatapoint({
        metricName: "up",
        datapoint: {
          attributes: [
            { key: "openstack_service", value: { stringValue: "compute" } },
          ],
        },
      }),
    ).toBe(true);
  });
});

describe("what the agent keeps of each exporter", () => {
  const config: string = fs.readFileSync(
    path.join(
      REPO_ROOT,
      "agents",
      "OpenStackAgent",
      "otel-collector-config.yaml",
    ),
    "utf8",
  );

  function keepRegexOf(jobName: string): RegExp {
    const job: string = config.substring(
      config.indexOf(`job_name: ${jobName}`),
    );
    const match: RegExpMatchArray | null = job.match(
      /regex: (\S+)\n\s+action: keep/,
    );
    expect(match).not.toBeNull();
    return new RegExp(`^(?:${match![1]!})$`);
  }

  test("holds every series the scan reads from libvirt", () => {
    const keep: RegExp = keepRegexOf("oneuptime-openstack-libvirt");
    for (const name of OPENSTACK_LIBVIRT_SERIES.keys()) {
      expect(keep.test(name)).toBe(true);
    }
  });

  test("holds every series the scan reads from Ceilometer", () => {
    const keep: RegExp = keepRegexOf("oneuptime-openstack-ceilometer");
    for (const name of OPENSTACK_CEILOMETER_SERIES.keys()) {
      expect(keep.test(name)).toBe(true);
    }
  });

  test("and leaves out what would only cost: the balloon's size, jobs and storage pools", () => {
    const keep: RegExp = keepRegexOf("oneuptime-openstack-libvirt");
    for (const name of [
      "libvirt_domain_info_memory_usage_bytes",
      "libvirt_domain_job_type",
      "libvirt_storage_pool_capacity_bytes",
      "libvirt_domain_vcpu_time_seconds_total",
    ]) {
      expect(keep.test(name)).toBe(false);
    }
  });

  test("keeps nothing the scan doesn't read, but the exporter's own health", () => {
    const libvirt: RegExp = keepRegexOf("oneuptime-openstack-libvirt");
    const names: Array<string> = libvirtText([truthOf({})])
      .split("\n")
      .map((line: string): string => {
        return line.replace(/[{ ].*/, "");
      })
      .filter((name: string): boolean => {
        return libvirt.test(name) && name !== "libvirt_up";
      });
    for (const name of names) {
      expect(OPENSTACK_LIBVIRT_SERIES.has(name)).toBe(true);
    }
  });
});
