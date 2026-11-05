import { describe, expect, test } from "@jest/globals";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import {
  OPENSTACK_ANCHOR_METRIC_ALIAS,
  OpenStackAlertTemplate,
  OpenStackAlertTemplateArgs,
  getOpenStackAlertTemplateById,
} from "../../../Types/Monitor/OpenStackAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import {
  OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE,
  OpenStackHypervisorCapacity,
  OpenStackHypervisorMetric,
  OpenStackInstanceMetric,
  OpenStackInstanceMetricSource,
} from "../../../Types/OpenStack/OpenStackInstanceMetrics";
import {
  InstanceMetricsDrill,
  RecordedDrillInstance,
  ReplayedPoint,
  dataPointsOf,
  drillAnchorSamples,
  drillInstanceNamed,
  getDrilledInstanceMetricsReleases,
  labelOf,
  pointsOfHypervisor,
  pointsOfInstance,
  readInstanceMetricsDrill,
  replayDrillSource,
  valuesOf,
} from "../../Helpers/OpenStackInstanceMetricsRecordings";
import {
  TemplateWalkStep,
  TimedSample,
  TimedSamplesByAlias,
  walkTemplateCriteria,
} from "./Utils/TemplateCriteriaEvaluation";

/*
 * THE ALERT TEMPLATES ON WHAT REALLY HAPPENED. A real DevStack, with what the agent's real collector
 * really sent (Tests/Ops/openstack-e2e/instance-metrics-drill.sh), every evaluation a minute apart
 * through the real evaluator, with Ceilometer polling at its real default of five minutes:
 *
 *   burn    ou-burner spins on its one vCPU, and libvirt throttles its disk to four writes a second
 *   then    the throttle comes off, and later still the spinning stops, on a timer in the guest
 *   quiet   ou-running is hard rebooted, and ou-burner is shut off
 *
 * What a runner couldn't be made to do is said where it is made up: it has 4 threads and 16 GB, and
 * one burning vCPU is a quarter of it. So a hypervisor's two templates read the load it recorded
 * against a hypervisor's size chosen to put that load over their line. The load, its fall and the
 * template's whole path are real. The size isn't.
 */

const RELEASES: Array<string> = getDrilledInstanceMetricsReleases();

const LIBVIRT: OpenStackInstanceMetricSource =
  OpenStackInstanceMetricSource.Libvirt;
const CEILOMETER: OpenStackInstanceMetricSource =
  OpenStackInstanceMetricSource.Ceilometer;

const CASES: Array<[string, OpenStackInstanceMetricSource]> = RELEASES.flatMap(
  (release: string): Array<[string, OpenStackInstanceMetricSource]> => {
    return [
      [release, LIBVIRT],
      [release, CEILOMETER],
    ];
  },
);

const MINUTE_MS: number = 60 * 1000;
const MIB: number = 1024 * 1024;
const WINDOW_MINUTES: number = 15;
// What Placement said of the runner.
const RUNNER: OpenStackHypervisorCapacity = {
  cores: 4,
  memoryBytes: 15982 * MIB,
};

const ARGS: OpenStackAlertTemplateArgs = {
  cloudIdentifier: "devstack",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "The drill",
};

interface Walked {
  firedAtMs: number | null;
  recoveredAtMs: number | null;
  firedAgainAfterRecovering: boolean;
}

async function walk(data: {
  templateId: string;
  drill: InstanceMetricsDrill;
  samples: (metricName: string) => Array<TimedSample>;
  endMs?: number | undefined;
}): Promise<Walked> {
  const template: OpenStackAlertTemplate = getOpenStackAlertTemplateById(
    data.templateId,
  )!;
  const step: MonitorStep = template.getMonitorStep(ARGS);
  const viewConfig: MonitorStep["data"] = step.data;
  const queries: Array<MetricQueryConfigData> =
    viewConfig!.openstackMonitor!.metricViewConfig.queryConfigs;

  const samplesByAlias: TimedSamplesByAlias = {};
  for (const query of queries) {
    const alias: string = query.metricAliasData!.metricVariable!;
    samplesByAlias[alias] =
      alias === OPENSTACK_ANCHOR_METRIC_ALIAS
        ? drillAnchorSamples(data.drill)
        : data.samples(query.metricQueryData.filterData.metricName as string);
  }

  const steps: Array<TemplateWalkStep> = await walkTemplateCriteria({
    step,
    viewConfig: viewConfig!.openstackMonitor!.metricViewConfig,
    samplesByAlias,
    windowMinutes: WINDOW_MINUTES,
    startMs: data.drill.timeline["burn"]!,
    endMs: data.endMs || lastEnvelopeMs(data.drill),
  });

  let firedAtMs: number | null = null;
  let recoveredAtMs: number | null = null;
  let firedAgainAfterRecovering: boolean = false;
  for (const one of steps) {
    if (firedAtMs === null) {
      firedAtMs = one.breached ? one.atMs : null;
    } else if (recoveredAtMs === null) {
      recoveredAtMs = one.healthy ? one.atMs : null;
    } else if (one.breached) {
      firedAgainAfterRecovering = true;
    }
  }
  return { firedAtMs, recoveredAtMs, firedAgainAfterRecovering };
}

function lastEnvelopeMs(drill: InstanceMetricsDrill): number {
  let last: number = 0;
  for (const envelope of drill.envelopes) {
    for (const point of dataPointsOf(envelope, "openstack_nova_up")) {
      last = Math.max(last, Math.floor(Number(point["timeUnixNano"]) / 1e6));
    }
  }
  return last;
}

function timed(points: ReadonlyArray<ReplayedPoint>): Array<TimedSample> {
  return points.map((point: ReplayedPoint): TimedSample => {
    return { timeMs: point.atMs, value: point.value };
  });
}

test("the drill was recorded on the newest release and the oldest", () => {
  expect(RELEASES).toEqual(["epoxy-ovn", "hibiscus-ovn"]);
});

describe.each(CASES)(
  "%s, read from %s",
  (release: string, source: OpenStackInstanceMetricSource) => {
    const drill: InstanceMetricsDrill = readInstanceMetricsDrill(release);
    const burner: RecordedDrillInstance = drillInstanceNamed(
      drill,
      "ou-burner",
    );
    const idle: RecordedDrillInstance = drillInstanceNamed(drill, "ou-running");
    const points: Array<ReplayedPoint> = replayDrillSource({
      drill,
      source,
      capacity: RUNNER,
    });
    const at: (name: string, minutes?: number) => number = (
      name: string,
      minutes: number = 0,
    ): number => {
      return drill.timeline[name]! + minutes * MINUTE_MS;
    };
    // The burner's timer, set on the guest from when it booted: how long the spinning went on.
    const burnEndsMs: number = at("neighbour", 22);

    describe("Instance CPU Saturated", () => {
      test("fires on the burning instance within two windows of it starting, and recovers within a window of it stopping", async () => {
        const walked: Walked = await walk({
          templateId: "openstack-instance-cpu-saturated",
          drill,
          samples: (metricName: string): Array<TimedSample> => {
            return timed(pointsOfInstance(points, metricName, burner.id));
          },
        });
        expect(walked.firedAtMs).not.toBeNull();
        expect(walked.firedAtMs!).toBeLessThan(at("burn", 2 * WINDOW_MINUTES));
        expect(walked.recoveredAtMs).not.toBeNull();
        expect(walked.recoveredAtMs!).toBeGreaterThan(at("neighbour"));
        expect(walked.recoveredAtMs!).toBeLessThan(
          burnEndsMs + (WINDOW_MINUTES + 10) * MINUTE_MS,
        );
        expect(walked.firedAgainAfterRecovering).toBe(false);
      });

      test("never fires on the idle instance beside it, through its hard reboot too", async () => {
        const walked: Walked = await walk({
          templateId: "openstack-instance-cpu-saturated",
          drill,
          samples: (metricName: string): Array<TimedSample> => {
            return timed(pointsOfInstance(points, metricName, idle.id));
          },
        });
        expect(walked.firedAtMs).toBeNull();
      });
    });

    describe("Instance Disk Latency High", () => {
      const onVda: (metricName: string) => Array<TimedSample> = (
        metricName: string,
      ): Array<TimedSample> => {
        return timed(pointsOfInstance(points, metricName, burner.id, "vda"));
      };

      test("reads what libvirt's throttle really did: hundreds of milliseconds, then under one", () => {
        const latencies: Array<ReplayedPoint> = pointsOfInstance(
          points,
          OpenStackInstanceMetric.DiskWriteLatency,
          burner.id,
          "vda",
        );
        const during: Array<number> = valuesOf(
          latencies.filter((point: ReplayedPoint): boolean => {
            return point.atMs > at("burn", 2) && point.atMs < at("burn", 18);
          }),
        );
        const after: Array<number> = valuesOf(
          latencies.filter((point: ReplayedPoint): boolean => {
            return (
              point.atMs > at("neighbour-booting", 10) &&
              point.atMs < at("neighbour", 15)
            );
          }),
        );
        expect(during.length).toBeGreaterThanOrEqual(2);
        expect(Math.min(...during)).toBeGreaterThan(100);
        expect(after.length).toBeGreaterThanOrEqual(2);
        expect(Math.max(...after)).toBeLessThan(50);
      });

      test("fires while the disk is throttled, and recovers once it isn't", async () => {
        const walked: Walked = await walk({
          templateId: "openstack-instance-disk-latency-high",
          drill,
          samples: onVda,
        });
        expect(walked.firedAtMs).not.toBeNull();
        // Ceilometer's first rate takes two polls, and the throttle lasted twenty minutes.
        expect(walked.firedAtMs!).toBeLessThan(at("neighbour-booting", 10));
        expect(walked.recoveredAtMs).not.toBeNull();
        expect(walked.recoveredAtMs!).toBeGreaterThan(at("neighbour-booting"));
        expect(walked.recoveredAtMs!).toBeLessThan(
          at("neighbour-booting", WINDOW_MINUTES + 10),
        );
      });

      test("never fires on a disk nobody is slowing", async () => {
        const walked: Walked = await walk({
          templateId: "openstack-instance-disk-latency-high",
          drill,
          samples: (metricName: string): Array<TimedSample> => {
            return timed(pointsOfInstance(points, metricName, idle.id, "vda"));
          },
        });
        expect(walked.firedAtMs).toBeNull();
      });
    });

    describe("Hypervisor CPU Saturated", () => {
      test("never fires on what the runner really has: one thread of four", async () => {
        const walked: Walked = await walk({
          templateId: "openstack-hypervisor-cpu-saturated",
          drill,
          samples: (metricName: string): Array<TimedSample> => {
            return timed(pointsOfHypervisor(points, metricName));
          },
        });
        expect(walked.firedAtMs).toBeNull();
      });

      test("against a hypervisor of one thread, made up to put that load over its line, fires and recovers", async () => {
        const replayed: Array<ReplayedPoint> = replayDrillSource({
          drill,
          source,
          capacity: { cores: 1, memoryBytes: RUNNER.memoryBytes },
        });
        const walked: Walked = await walk({
          templateId: "openstack-hypervisor-cpu-saturated",
          drill,
          samples: (metricName: string): Array<TimedSample> => {
            return timed(pointsOfHypervisor(replayed, metricName));
          },
        });
        expect(walked.firedAtMs).not.toBeNull();
        expect(walked.firedAtMs!).toBeLessThan(at("burn", 2 * WINDOW_MINUTES));
        expect(walked.recoveredAtMs).not.toBeNull();
        expect(walked.recoveredAtMs!).toBeGreaterThan(at("neighbour"));
        expect(walked.firedAgainAfterRecovering).toBe(false);
      });
    });

    describe("Hypervisor Memory Pressure", () => {
      // Just over what its three running instances really held: 177 MiB each or so.
      const TIGHT: OpenStackHypervisorCapacity = {
        cores: RUNNER.cores,
        memoryBytes: 560 * MIB,
      };
      const replayed: Array<ReplayedPoint> = replayDrillSource({
        drill,
        source,
        capacity: TIGHT,
      });

      test("never fires on what the runner really has", async () => {
        const walked: Walked = await walk({
          templateId: "openstack-hypervisor-memory-pressure",
          drill,
          samples: (metricName: string): Array<TimedSample> => {
            return timed(pointsOfHypervisor(points, metricName));
          },
        });
        expect(walked.firedAtMs).toBeNull();
      });

      test("what its instances hold really falls when one is shut off", () => {
        const held: Array<ReplayedPoint> = pointsOfHypervisor(
          replayed,
          OpenStackHypervisorMetric.InstancesMemoryUtilization,
        );
        // From when Ceilometer's first poll has said what the burner holds.
        const before: Array<number> = valuesOf(
          held.filter((point: ReplayedPoint): boolean => {
            return (
              point.atMs > at("burn", 8) && point.atMs < at("stop-ou-burner")
            );
          }),
        );
        const after: Array<number> = valuesOf(
          held.filter((point: ReplayedPoint): boolean => {
            return point.atMs > at("delete-ou-hog", 3);
          }),
        );
        expect(Math.min(...before)).toBeGreaterThan(90);
        expect(after.length).toBeGreaterThan(0);
        expect(Math.max(...after)).toBeLessThan(81);
      });

      test("against a hypervisor made up to be nearly full of them, fires, and recovers once a window has passed", async () => {
        /*
         * The recording stops ten minutes after the instance does, which is shorter than the
         * window, so what it last said is held by hand for the minutes more it takes to empty.
         */
        const endMs: number = lastEnvelopeMs(drill) + 20 * MINUTE_MS;
        const samplesOf: (metricName: string) => Array<TimedSample> = (
          metricName: string,
        ): Array<TimedSample> => {
          const recorded: Array<TimedSample> = timed(
            pointsOfHypervisor(replayed, metricName),
          );
          const last: TimedSample = recorded[recorded.length - 1]!;
          const held: Array<TimedSample> = [...recorded];
          for (
            let timeMs: number = last.timeMs + MINUTE_MS;
            timeMs <= endMs;
            timeMs += MINUTE_MS
          ) {
            held.push({ timeMs, value: last.value });
          }
          return held;
        };
        const walked: Walked = await walk({
          templateId: "openstack-hypervisor-memory-pressure",
          drill,
          samples: samplesOf,
          endMs,
        });
        expect(walked.firedAtMs).not.toBeNull();
        expect(walked.firedAtMs!).toBeLessThan(at("burn", 2 * WINDOW_MINUTES));
        expect(walked.recoveredAtMs).not.toBeNull();
        expect(walked.recoveredAtMs!).toBeGreaterThan(at("stop-ou-burner"));
      });
    });

    describe("what a counter really does through a hard reboot", () => {
      test.each(
        source === LIBVIRT
          ? ["libvirt_domain_info_cpu_time_seconds_total"]
          : ["ceilometer_cpu"],
      )("%s really went backwards", (metricName: string) => {
        // libvirt names a domain on all but one of its series. Ceilometer names the instance.
        let domain: string | undefined = undefined;
        const readings: Array<number> = [];
        for (const envelope of drill.envelopes) {
          for (const point of dataPointsOf(
            envelope,
            "libvirt_domain_openstack_info",
          )) {
            if (labelOf(point, "instance_id") === idle.id) {
              domain = labelOf(point, "domain");
            }
          }
          for (const point of dataPointsOf(envelope, metricName)) {
            if (
              labelOf(point, "resource") === idle.id ||
              (domain && labelOf(point, "domain") === domain)
            ) {
              readings.push(Number(point["asDouble"]));
            }
          }
        }
        expect(readings.length).toBeGreaterThan(5);
        expect(
          readings.some((value: number, index: number): boolean => {
            return index > 0 && value < readings[index - 1]!;
          }),
        ).toBe(true);
      });

      test("and every rate across it reads as what it used since, never negative, never past what it has", () => {
        for (const name of [
          OpenStackInstanceMetric.CpuUsage,
          OpenStackInstanceMetric.DiskReadRate,
          OpenStackInstanceMetric.DiskWriteRate,
          OpenStackInstanceMetric.NetworkReceiveRate,
          OpenStackInstanceMetric.NetworkTransmitRate,
        ]) {
          for (const value of valuesOf(
            pointsOfInstance(points, name, idle.id),
          )) {
            expect(value).toBeGreaterThanOrEqual(0);
          }
        }
        for (const value of valuesOf(
          pointsOfInstance(points, OpenStackInstanceMetric.CpuUsage, idle.id),
        )) {
          expect(value).toBeLessThan(1);
        }
      });

      test("and the reboot shows: a guest reads its disk as it boots, and only then", () => {
        const reads: Array<ReplayedPoint> = pointsOfInstance(
          points,
          OpenStackInstanceMetric.DiskReadRate,
          idle.id,
          "vda",
        );
        const busy: Array<ReplayedPoint> = reads.filter(
          (point: ReplayedPoint): boolean => {
            return point.value > 0;
          },
        );
        expect(busy.length).toBeGreaterThan(0);
        for (const point of busy) {
          expect(point.atMs).toBeGreaterThanOrEqual(at("reboot-ou-running"));
          expect(point.atMs).toBeLessThan(at("stop-ou-burner", 5));
        }
      });
    });

    describe("what a source says about an instance that is shut off", () => {
      test("adds no row of its own from a while after, and leaves the rest going", () => {
        const after: Array<ReplayedPoint> = points.filter(
          (point: ReplayedPoint): boolean => {
            return (
              point.atMs > at("delete-ou-hog") &&
              point.attributes["openstack.instance.id"] === burner.id
            );
          },
        );
        expect(after).toEqual([]);
        expect(
          pointsOfInstance(
            points,
            OpenStackInstanceMetric.CpuUsage,
            idle.id,
          ).filter((point: ReplayedPoint): boolean => {
            return point.atMs > at("delete-ou-hog");
          }).length,
        ).toBeGreaterThan(0);
      });

      test("and comes off its hypervisor's count", () => {
        const counts: Array<ReplayedPoint> = pointsOfHypervisor(
          points,
          OpenStackHypervisorMetric.InstancesReporting,
        );
        const before: Array<number> = valuesOf(
          counts.filter((point: ReplayedPoint): boolean => {
            return (
              point.atMs > at("burn", 5) && point.atMs < at("stop-ou-burner")
            );
          }),
        );
        const after: Array<number> = valuesOf(
          counts.filter((point: ReplayedPoint): boolean => {
            return point.atMs > at("delete-ou-hog", 3);
          }),
        );
        expect(Math.min(...before)).toBe(3);
        expect(Math.max(...after)).toBe(2);
      });
    });

    describe("the pace of it", () => {
      const cpu: Array<ReplayedPoint> = pointsOfInstance(
        points,
        OpenStackInstanceMetric.CpuUtilization,
        burner.id,
      ).filter((point: ReplayedPoint): boolean => {
        return point.atMs > at("burn", 15) && point.atMs < at("neighbour");
      });

      test(
        source === LIBVIRT
          ? "libvirt says something every minute it is read"
          : "Ceilometer says something once a five-minute poll, read every minute, and it reads true every time",
        () => {
          const gaps: Array<number> = cpu
            .slice(1)
            .map((point: ReplayedPoint, index: number): number => {
              return (point.atMs - cpu[index]!.atMs) / MINUTE_MS;
            });
          expect(gaps.length).toBeGreaterThanOrEqual(2);
          for (const gap of gaps) {
            expect(gap).toBeCloseTo(source === LIBVIRT ? 1 : 5, 0);
          }
          for (const point of cpu) {
            expect(point.value).toBeGreaterThan(95);
            expect(point.value).toBeLessThan(105);
          }
        },
      );

      test("a disk's every reading says which disk", () => {
        for (const point of pointsOfInstance(
          points,
          OpenStackInstanceMetric.DiskWriteRate,
          burner.id,
        )) {
          expect(
            point.attributes[OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE],
          ).toBeTruthy();
        }
      });
    });
  },
);
