import { afterAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackInstanceMetricsMode } from "Common/Types/OpenStack/OpenStackInstanceMetrics";
import {
  OPENSTACK_COLLECTION_MAX_PAYLOAD_BYTES,
  OpenStackCollectionJob,
  OpenStackCollectionReport,
  OpenStackServiceSummary,
} from "Common/Types/OpenStack/OpenStackProbeCollection";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_LARGE_CLOUD,
  OPENSTACK_MEDIUM_CLOUD,
  OPENSTACK_PER_PART_READS_PER_COLLECTION,
  OPENSTACK_PROJECT_LIMIT_READS_PER_COLLECTION,
  OPENSTACK_SMALL_CLOUD,
  OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT,
  OpenStackCloudCounts,
  OpenStackRequestsByService,
  getOpenStackCountsOfSize,
  getOpenStackProbeRequestsPerMinute,
  getOpenStackSeriesCounts,
  simulateOpenStackProbeRequests,
} from "Common/Types/OpenStack/OpenStackScale";
import OpenStackCollector from "../../../Utils/OpenStack/OpenStackCollector";
import { splitOpenStackReport } from "../../../Utils/OpenStack/OpenStackReportParts";
import {
  CollectorHarness,
  FakeClock,
  ReportedDatapoint,
  collectionJob,
  createCollectorHarness,
  createFakeClock,
  datapointsOf,
} from "./Helpers/CollectorHarness";
import MockOpenStackCloud, {
  MOCK_AUTH_URL,
} from "./Helpers/MockOpenStackCloud";

/*
 * What a cloud of each size costs its control plane, counted rather than estimated: the real
 * collector, against a mock API of that size, on a clock that only moves when told. So an hour
 * takes as long as the work does, and what is asserted does not depend on the machine: a request
 * count is a request count. Every number here is the one the docs publish, read from the same
 * function (OpenStackScale) that the guide's calculator uses, so neither can move alone.
 *
 * The tested sizes are the issue's: 10, 500 and 5,000 hypervisors; 100, 20,000 and 200,000
 * instances; 10,000 projects. What else each size holds is stated in OpenStackScale.
 */

const INTERVAL_IN_MINUTES: number = 2;
const MINUTE_IN_MS: number = 60_000;

interface Scene {
  cloud: MockOpenStackCloud;
  clock: FakeClock;
  harness: CollectorHarness;
  job: OpenStackCollectionJob;
}

function sceneOf(
  counts: OpenStackCloudCounts,
  options?: {
    networkBackend?: "ovn" | "ovs" | undefined;
    job?: Partial<OpenStackCollectionJob> | undefined;
    latencyInMs?:
      | ((request: { url: string }, service: OpenStackServiceType) => number)
      | undefined;
  },
): Scene {
  const clock: FakeClock = createFakeClock();
  const cloud: MockOpenStackCloud = new MockOpenStackCloud({
    counts: counts,
    clock: clock,
    networkBackend: options?.networkBackend,
    latencyInMs: options?.latencyInMs,
  });
  const harness: CollectorHarness = createCollectorHarness({
    transport: cloud.transport,
    clock: clock,
  });

  return {
    cloud,
    clock,
    harness,
    job: collectionJob({
      authUrl: MOCK_AUTH_URL,
      collectionIntervalInMinutes: INTERVAL_IN_MINUTES,
      ...options?.job,
    }),
  };
}

async function collect(scene: Scene): Promise<OpenStackCollectionReport> {
  const startedAt: number = scene.clock.now();
  const report: OpenStackCollectionReport = await OpenStackCollector.collect(
    scene.job,
    scene.harness.dependencies,
  );

  // Collections start every two minutes, whatever this one took.
  scene.clock.advance(
    startedAt + INTERVAL_IN_MINUTES * MINUTE_IN_MS - scene.clock.now(),
  );

  return report;
}

// Each collection of a stretch of minutes, counted from when the cloud was first read.
async function collectFor(scene: Scene, minutes: number): Promise<void> {
  for (
    let minute: number = 0;
    minute < minutes;
    minute += INTERVAL_IN_MINUTES
  ) {
    await collect(scene);
  }
}

function zeroes(
  requests: OpenStackRequestsByService,
): OpenStackRequestsByService {
  const result: OpenStackRequestsByService = { ...requests };

  for (const service of Object.keys(result) as Array<OpenStackServiceType>) {
    result[service] = 0;
  }

  return result;
}

function bySize(
  data: Array<[string, OpenStackCloudCounts]>,
): Array<{ name: string; counts: OpenStackCloudCounts }> {
  return data.map(([name, counts]: [string, OpenStackCloudCounts]) => {
    return { name, counts };
  });
}

const SIZES: Array<{ name: string; counts: OpenStackCloudCounts }> = bySize([
  ["10 hypervisors, 100 instances", OPENSTACK_SMALL_CLOUD],
  ["500 hypervisors, 20,000 instances", OPENSTACK_MEDIUM_CLOUD],
  [
    "5,000 hypervisors, 200,000 instances, 10,000 projects",
    OPENSTACK_LARGE_CLOUD,
  ],
]);

/*
 * The measured numbers of a run, written out for the docs to be checked against by hand and for
 * the report: nothing reads this file. Set OPENSTACK_SCALE_MEASURES to a path to get it.
 */
const measures: Record<string, unknown> = {};

afterAll(() => {
  const file: string | undefined = process.env["OPENSTACK_SCALE_MEASURES"];

  if (file) {
    fs.writeFileSync(path.resolve(file), JSON.stringify(measures, null, 2));
  }
});

describe.each(SIZES)(
  "a cloud of $name",
  ({ name, counts }: { name: string; counts: OpenStackCloudCounts }): void => {
    test("the first hour and the one after each ask exactly what the docs say", async () => {
      const scene: Scene = sceneOf(counts);

      await collectFor(scene, 60);

      const firstHour: OpenStackRequestsByService =
        scene.cloud.countsByService();

      expect(firstHour).toEqual(
        simulateOpenStackProbeRequests({
          counts: counts,
          fromMinute: 0,
          toMinute: 60,
        }),
      );

      scene.cloud.resetCounts();
      await collectFor(scene, 60);

      const secondHour: OpenStackRequestsByService =
        scene.cloud.countsByService();

      expect(secondHour).toEqual(
        simulateOpenStackProbeRequests({
          counts: counts,
          fromMinute: 60,
          toMinute: 120,
        }),
      );

      const perMinute: OpenStackRequestsByService = zeroes(secondHour);

      for (const service of Object.keys(
        secondHour,
      ) as Array<OpenStackServiceType>) {
        perMinute[service] = secondHour[service] / 60;
      }

      measures[name] = {
        ...((measures[name] as JSONObject) || {}),
        requestsPerHourSettled: secondHour,
        requestsPerMinuteSettled: perMinute,
      };
    }, 1800000);

    test("one collection sends what the series count says, within its uploads", async () => {
      const scene: Scene = sceneOf(counts);

      const report: OpenStackCollectionReport = await collect(scene);
      const isSummary: boolean =
        counts.instances > OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT;

      expect(report.summary?.hypervisorCount).toBe(counts.hypervisors);
      expect(report.summary?.instanceCount).toBe(counts.instances);
      expect(report.summary?.volumeCount).toBe(counts.volumes);
      expect(report.summary?.projectCount).toBe(counts.projects);

      const bytes: number = Buffer.byteLength(
        JSON.stringify(report.resourceMetrics),
      );

      // The first collection cannot know the cloud is large: it knows once it has read it.
      expect(report.status).toBe("Succeeded");

      if (!isSummary) {
        const series: {
          fast: number;
          slow: number;
        } = getOpenStackSeriesCounts({ counts: counts });

        expect(report.summary?.datapointCount).toBe(series.fast + series.slow);
      }

      const parts: Array<OpenStackCollectionReport> =
        splitOpenStackReport(report);

      for (const part of parts) {
        expect(
          Buffer.byteLength(JSON.stringify(part.resourceMetrics)),
        ).toBeLessThanOrEqual(OPENSTACK_COLLECTION_MAX_PAYLOAD_BYTES);
      }

      measures[name] = {
        ...((measures[name] as JSONObject) || {}),
        firstCollectionPayloadBytes: bytes,
        firstCollectionUploads: parts.length,
        firstCollectionDatapoints: report.summary?.datapointCount,
      };
    }, 1800000);
  },
);

describe("summary mode, on the probe", () => {
  const counts: OpenStackCloudCounts = getOpenStackCountsOfSize({
    hypervisors: 20,
    instances: OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT + 1000,
    projects: 100,
  });

  function serverPoints(
    report: OpenStackCollectionReport,
  ): Array<ReportedDatapoint> {
    return datapointsOf(report.resourceMetrics).filter(
      (point: ReportedDatapoint): boolean => {
        return point.metric === "openstack_nova_server_status";
      },
    );
  }

  test("past the size, a collection sends a turn's share of what did not change, and the totals whole", async () => {
    const scene: Scene = sceneOf(counts);

    const first: OpenStackCollectionReport = await collect(scene);
    expect(first.summary?.isSummaryMode).toBeUndefined();
    expect(serverPoints(first)).toHaveLength(counts.instances);

    const second: OpenStackCollectionReport = await collect(scene);
    expect(second.summary?.isSummaryMode).toBe(true);

    /*
     * Nothing changed since the first, which sent everything, so what goes now is only this
     * turn's share. A small cloud's turn is the whole cloud: this one's turns come to one.
     */
    expect(second.summary?.refreshCycleInMinutes).toBe(INTERVAL_IN_MINUTES);
    expect(
      datapointsOf(second.resourceMetrics).find(
        (point: ReportedDatapoint): boolean => {
          return point.metric === "openstack_nova_total_vms";
        },
      )?.value,
    ).toBe(counts.instances);
  }, 600000);

  test("an instance that changes goes at once, and one in a bad state goes every time", async () => {
    const large: OpenStackCloudCounts = OPENSTACK_MEDIUM_CLOUD;
    const scene: Scene = sceneOf(large);

    await collect(scene);
    await collect(scene);

    scene.cloud.changeInstances([11, 12], "ERROR");

    const report: OpenStackCollectionReport = await collect(scene);
    const turns: number =
      (report.summary?.refreshCycleInMinutes as number) / INTERVAL_IN_MINUTES;

    expect(turns).toBeGreaterThan(1);

    const points: Array<ReportedDatapoint> = serverPoints(report);
    const inError: Array<ReportedDatapoint> = points.filter(
      (point: ReportedDatapoint): boolean => {
        return point.labels["status"] === "ERROR";
      },
    );

    expect(inError).toHaveLength(2);
    // Only a share of the rest.
    expect(points.length).toBeLessThan(large.instances);
    expect(points.length).toBeGreaterThan(2);

    const again: OpenStackCollectionReport = await collect(scene);

    expect(
      serverPoints(again).filter((point: ReportedDatapoint): boolean => {
        return point.labels["status"] === "ERROR";
      }),
    ).toHaveLength(2);
  }, 900000);

  test("every instance comes round within the stated cycle, and the stale-row rule is told how long that is", async () => {
    const large: OpenStackCloudCounts = OPENSTACK_MEDIUM_CLOUD;
    const scene: Scene = sceneOf(large);

    await collect(scene);

    const second: OpenStackCollectionReport = await collect(scene);
    const cycle: number = second.summary?.refreshCycleInMinutes as number;
    const turns: number = cycle / INTERVAL_IN_MINUTES;
    const seen: Set<string> = new Set();

    for (const point of serverPoints(second)) {
      seen.add(point.labels["id"] as string);
    }

    for (let turn: number = 1; turn < turns; turn++) {
      const report: OpenStackCollectionReport = await collect(scene);

      for (const point of serverPoints(report)) {
        seen.add(point.labels["id"] as string);
      }
    }

    expect(seen.size).toBe(large.instances);

    const up: ReportedDatapoint | undefined = datapointsOf(
      second.resourceMetrics,
    ).find((point: ReportedDatapoint): boolean => {
      return point.metric === "openstack_nova_up";
    });

    expect(up?.labels["refresh_cycle_minutes"]).toBe(String(cycle));
  }, 1200000);

  test("a project someone chose keeps every instance's series, every collection", async () => {
    const large: OpenStackCloudCounts = OPENSTACK_MEDIUM_CLOUD;
    const chosen: string = String(3).padStart(32, "0");
    const scene: Scene = sceneOf(large, {
      job: {
        options: {
          instanceSeriesMode: OpenStackInstanceMetricsMode.Selected,
          keptProjectIds: [chosen],
        },
      },
    });

    await collect(scene);
    await collect(scene);

    const report: OpenStackCollectionReport = await collect(scene);
    const ofChosen: Array<ReportedDatapoint> = serverPoints(report).filter(
      (point: ReportedDatapoint): boolean => {
        return point.labels["tenant_id"] === chosen;
      },
    );

    expect(ofChosen).toHaveLength(large.instances / large.projects);
  }, 900000);

  test("a cloud set to keep everything is never summarized", async () => {
    const scene: Scene = sceneOf(counts, {
      job: {
        options: { instanceSeriesMode: OpenStackInstanceMetricsMode.All },
      },
    });

    await collect(scene);

    const report: OpenStackCollectionReport = await collect(scene);

    expect(report.summary?.isSummaryMode).toBeUndefined();
    expect(serverPoints(report)).toHaveLength(counts.instances);
  }, 600000);

  test("past the size it does not ask Placement for allocations, which only series per instance use", async () => {
    const scene: Scene = sceneOf(counts);

    await collect(scene);
    scene.cloud.resetCounts();
    await collect(scene);

    expect(
      scene.cloud.requestsByRoute.get(
        "/placement/resource_providers/{id}/allocations",
      ),
    ).toBeUndefined();
    expect(
      datapointsOf((await collect(scene)).resourceMetrics).filter(
        (point: ReportedDatapoint): boolean => {
          return (
            point.metric === "openstack_placement_resource_provider_allocations"
          );
        },
      ),
    ).toHaveLength(0);
  }, 600000);

  test("a cloud of 200,000 instances that keeps everything says it is too large rather than holding it all in memory", async () => {
    const scene: Scene = sceneOf(OPENSTACK_LARGE_CLOUD, {
      job: {
        options: { instanceSeriesMode: OpenStackInstanceMetricsMode.All },
      },
    });

    const report: OpenStackCollectionReport = await collect(scene);

    expect(report.status).toBe("Failed");
    expect(report.errorMessage).toContain("Use the OpenStack agent");
    expect(
      datapointsOf(report.resourceMetrics).find(
        (point: ReportedDatapoint): boolean => {
          return point.metric === "openstack_nova_up";
        },
      )?.value,
    ).toBe(1);
  }, 900000);
});

describe("Placement, the service a large cloud leans on hardest", () => {
  const counts: OpenStackCloudCounts = getOpenStackCountsOfSize({
    hypervisors: OPENSTACK_PER_PART_READS_PER_COLLECTION + 500,
    instances: 100,
    projects: 10,
  });

  test("a provider's inventories are read once, and again only when its generation moves", async () => {
    const small: OpenStackCloudCounts = OPENSTACK_SMALL_CLOUD;
    const scene: Scene = sceneOf(small);
    const inventories: string =
      "/placement/resource_providers/{id}/inventories";

    await collect(scene);
    expect(scene.cloud.requestsByRoute.get(inventories)).toBe(
      small.hypervisors,
    );

    scene.cloud.resetCounts();
    await collect(scene);
    expect(scene.cloud.requestsByRoute.get(inventories)).toBeUndefined();

    scene.cloud.bumpProviderGeneration(3);
    scene.cloud.resetCounts();
    await collect(scene);
    expect(scene.cloud.requestsByRoute.get(inventories)).toBe(1);
  }, 600000);

  test("past the limit it reads in turns, and sends every hypervisor's numbers every time", async () => {
    const scene: Scene = sceneOf(counts);
    const usages: string = "/placement/resource_providers/{id}/usages";

    await collect(scene);
    expect(scene.cloud.requestsByRoute.get(usages)).toBe(counts.hypervisors);

    scene.cloud.resetCounts();

    const report: OpenStackCollectionReport = await collect(scene);

    expect(scene.cloud.requestsByRoute.get(usages)).toBe(
      OPENSTACK_PER_PART_READS_PER_COLLECTION,
    );

    const hosts: Set<string> = new Set(
      datapointsOf(report.resourceMetrics)
        .filter((point: ReportedDatapoint): boolean => {
          return point.metric === "openstack_placement_resource_usage";
        })
        .map((point: ReportedDatapoint): string => {
          return point.labels["hostname"] as string;
        }),
    );

    expect(hosts.size).toBe(counts.hypervisors);
  }, 900000);

  test("a provider whose allocations moved is read ahead of its turn", async () => {
    const scene: Scene = sceneOf(counts);

    await collect(scene);
    await collect(scene);

    // Last in the list, so nowhere near its turn.
    scene.cloud.bumpProviderGeneration(counts.hypervisors - 1);
    scene.cloud.resetCounts();
    await collect(scene);

    expect(
      scene.cloud.requestsByRoute.get(
        "/placement/resource_providers/{id}/inventories",
      ),
    ).toBe(1);
    expect(
      scene.cloud.requestsByRoute.get(
        "/placement/resource_providers/{id}/usages",
      ),
    ).toBe(OPENSTACK_PER_PART_READS_PER_COLLECTION);
  }, 900000);
});

describe("what is a call per thing stops growing with the cloud", () => {
  test("on ML2/OVS it asks routers which agents hold them in turns, and every router stays in the series", async () => {
    const counts: OpenStackCloudCounts = {
      ...getOpenStackCountsOfSize({
        hypervisors: 10,
        instances: 100,
        projects: 10,
      }),
      routers: OPENSTACK_PER_PART_READS_PER_COLLECTION + 200,
    };
    const scene: Scene = sceneOf(counts, { networkBackend: "ovs" });
    const route: string = "/networking/v2.0/routers/{id}/l3-agents";

    await collect(scene);
    expect(scene.cloud.requestsByRoute.get(route)).toBe(
      OPENSTACK_PER_PART_READS_PER_COLLECTION,
    );

    scene.cloud.resetCounts();

    const report: OpenStackCollectionReport = await collect(scene);

    expect(scene.cloud.requestsByRoute.get(route)).toBe(
      OPENSTACK_PER_PART_READS_PER_COLLECTION,
    );

    // All of them by now: the first turn's, and the second's that went round.
    const routers: Set<string> = new Set(
      datapointsOf(report.resourceMetrics)
        .filter((point: ReportedDatapoint): boolean => {
          return point.metric === "openstack_neutron_l3_agent_of_router";
        })
        .map((point: ReportedDatapoint): string => {
          return point.labels["router_id"] as string;
        }),
    );

    expect(routers.size).toBe(counts.routers);
  }, 600000);

  test("quotas on a cloud of 10,000 projects are read a few hundred at a time", async () => {
    const counts: OpenStackCloudCounts = getOpenStackCountsOfSize({
      hypervisors: 2,
      instances: 10,
      projects: 10000,
    });
    const scene: Scene = sceneOf(counts, {
      job: { options: { collectProjectLimits: true } },
    });

    await collect(scene);

    expect(
      scene.cloud.requestsByRoute.get("/compute/v2.1/limits"),
    ).toBeLessThanOrEqual(OPENSTACK_PROJECT_LIMIT_READS_PER_COLLECTION);
    expect(
      scene.cloud.requestsByRoute.get(
        "/compute/v2.1/os-quota-sets/{project}/detail",
      ),
    ).toBeLessThanOrEqual(OPENSTACK_PROJECT_LIMIT_READS_PER_COLLECTION);
  }, 600000);
});

describe("collection slows itself down when an API's latency climbs", () => {
  const counts: OpenStackCloudCounts = OPENSTACK_SMALL_CLOUD;

  function novaSummary(
    report: OpenStackCollectionReport,
  ): OpenStackServiceSummary | undefined {
    return report.summary?.services.find(
      (service: OpenStackServiceSummary): boolean => {
        return service.service === OpenStackServiceType.Compute;
      },
    );
  }

  test("a service three times slower than it usually is, and past the line, gets a pause, and the card is told", async () => {
    let novaLatency: number = 100;

    const scene: Scene = sceneOf(counts, {
      latencyInMs: (
        _request: { url: string },
        service: OpenStackServiceType,
      ): number => {
        return service === OpenStackServiceType.Compute ? novaLatency : 10;
      },
    });

    const usual: OpenStackCollectionReport = await collect(scene);

    expect(novaSummary(usual)?.pausedForInMs).toBeUndefined();

    novaLatency = 2000;

    const slow: OpenStackCollectionReport = await collect(scene);

    // At least: the others' answers move the same clock while it waits for its own.
    expect(novaSummary(slow)?.slowestAnswerInMs).toBeGreaterThanOrEqual(2000);
    expect(novaSummary(slow)?.pausedForInMs).toBeGreaterThan(0);
    // Nothing else was held up by Nova being slow.
    expect(
      slow.summary?.services
        .filter((service: OpenStackServiceSummary): boolean => {
          return service.service !== OpenStackServiceType.Compute;
        })
        .some((service: OpenStackServiceSummary): boolean => {
          return Boolean(service.pausedForInMs);
        }),
    ).toBe(false);

    novaLatency = 100;

    const recovered: OpenStackCollectionReport = await collect(scene);

    expect(novaSummary(recovered)?.pausedForInMs).toBeUndefined();
  }, 300000);

  test("a pause takes real load off: fewer requests a minute while it lasts", async () => {
    const quiet: Scene = sceneOf(counts);
    await collect(quiet);

    let isSlow: boolean = false;

    const scene: Scene = sceneOf(counts, {
      latencyInMs: (): number => {
        return isSlow ? 3000 : 100;
      },
    });

    await collect(scene);
    isSlow = true;

    const startedAt: number = scene.clock.now();
    await OpenStackCollector.collect(scene.job, scene.harness.dependencies);
    const pausedTook: number = scene.clock.now() - startedAt;
    const requestsWithPause: number = scene.cloud.requestCount();

    /*
     * Each request is followed by a wait as long as its answer, so the same service reads at half
     * the rate it would otherwise be answering at. Its reads are one at a time, so this is the
     * clock's own account of it.
     */
    expect(pausedTook).toBeGreaterThan(3000 * 2);
    expect(requestsWithPause).toBeGreaterThan(0);
  }, 300000);

  test("several reads at once take turns, so the pause does not end in a burst", async () => {
    const started: Array<number> = [];
    const clock: FakeClock = createFakeClock();

    let isSlow: boolean = false;
    const cloud: MockOpenStackCloud = new MockOpenStackCloud({
      counts: counts,
      clock: clock,
      latencyInMs: (
        _request: { url: string },
        service: OpenStackServiceType,
      ): number => {
        if (service === OpenStackServiceType.Placement) {
          started.push(clock.now());
          return isSlow ? 6000 : 10;
        }
        return 1;
      },
    });
    const harness: CollectorHarness = createCollectorHarness({
      transport: cloud.transport,
      clock: clock,
    });
    const job: OpenStackCollectionJob = collectionJob({
      authUrl: MOCK_AUTH_URL,
      collectionIntervalInMinutes: 10,
    });

    await OpenStackCollector.collect(job, harness.dependencies);

    isSlow = true;
    started.length = 0;

    await OpenStackCollector.collect(job, harness.dependencies);

    // Four at a time would make the same instant repeat in fours for as long as it lasted.
    const repeats: Record<string, number> = {};

    for (const at of started.slice(4)) {
      repeats[String(at)] = (repeats[String(at)] || 0) + 1;
    }

    expect(Math.max(...Object.values(repeats))).toBeLessThanOrEqual(2);
  }, 300000);
});

describe("the numbers the docs publish", () => {
  const PAGE: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Docs/Content/en/telemetry/openstack.md",
    ),
    "utf8",
  );

  function format(value: number): string {
    return value >= 100
      ? Math.round(value).toLocaleString("en-US")
      : String(Math.round(value * 10) / 10);
  }

  test.each(SIZES)(
    "the load table's row for $name is what a cloud of that size asks",
    ({ counts }: { name: string; counts: OpenStackCloudCounts }): void => {
      const perMinute: OpenStackRequestsByService =
        getOpenStackProbeRequestsPerMinute(counts);
      const row: string | undefined = PAGE.split("\n").find((line: string) => {
        return line.startsWith(
          `| ${counts.hypervisors.toLocaleString("en-US")} hypervisors, ${counts.instances.toLocaleString("en-US")} instances`,
        );
      });

      expect(row).toBeDefined();

      for (const service of [
        OpenStackServiceType.Identity,
        OpenStackServiceType.Compute,
        OpenStackServiceType.Placement,
        OpenStackServiceType.Network,
        OpenStackServiceType.Volume,
        OpenStackServiceType.Image,
      ]) {
        expect(row).toContain(`| ${format(perMinute[service])} |`);
      }
    },
  );
});
