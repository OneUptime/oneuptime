import { afterAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { JSONObject } from "Common/Types/JSON";
import { OpenStackInstanceMetricsMode } from "Common/Types/OpenStack/OpenStackInstanceMetrics";
import {
  OPENSTACK_COLLECTION_MAX_PAYLOAD_BYTES,
  OPENSTACK_COLLECTION_MAX_TOTAL_PAYLOAD_BYTES,
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
  OPENSTACK_ROLLING_BYTES_PER_DATAPOINT,
  OPENSTACK_SMALL_CLOUD,
  OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT,
  OpenStackCloudCounts,
  OpenStackRequestsByService,
  getOpenStackCountsOfSize,
  getOpenStackProbeRequestsPerMinute,
  getOpenStackRollingDatapoints,
  getOpenStackRollingTurns,
  getOpenStackSeriesCounts,
  simulateOpenStackProbeRequests,
} from "Common/Types/OpenStack/OpenStackScale";
import OpenStackCollector, {
  OpenStackCollectorDependencies,
} from "../../../Utils/OpenStack/OpenStackCollector";
import { splitOpenStackReport } from "../../../Utils/OpenStack/OpenStackReportParts";
import {
  CollectorHarness,
  FakeClock,
  ReportedDatapoint,
  collectionJob,
  createCollectorHarness,
  createEventClock,
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
 *
 * A collection of the largest size takes seconds of real work, and two hours of them is an hour on
 * a shared machine. It would say nothing more than the collections below already do: what a
 * collection asks follows from the time on the clock, and these are the ones where something
 * different falls due. Each is asserted exactly, on its own. So the smallest size walks every
 * collection of two hours, and each size walks those. To walk all of the largest too:
 *
 *   OPENSTACK_SCALE_FULL_WALK=true node_modules/.bin/jest \
 *     Tests/Utils/OpenStack/OpenStackScaleBudget.test.ts
 *
 * The soak (OpenStackSoak.test.ts) walks an hour at that size on a real clock.
 */

const INTERVAL_IN_MINUTES: number = 2;
const MINUTE_IN_MS: number = 60_000;

const SLOW_TEST_IN_MS: number = 1800000;

interface Scene {
  cloud: MockOpenStackCloud;
  clock: FakeClock;
  harness: CollectorHarness;
  job: OpenStackCollectionJob;
  startedAt: number;
  lastReport?: OpenStackCollectionReport | undefined;
}

function sceneOf(
  counts: OpenStackCloudCounts,
  options?: {
    networkBackend?: "ovn" | "ovs" | undefined;
    job?: Partial<OpenStackCollectionJob> | undefined;
    clock?: FakeClock | undefined;
    overrides?: Partial<OpenStackCollectorDependencies> | undefined;
    latencyInMs?:
      | ((request: { url: string }, service: OpenStackServiceType) => number)
      | undefined;
  },
): Scene {
  const clock: FakeClock = options?.clock || createFakeClock();
  const cloud: MockOpenStackCloud = new MockOpenStackCloud({
    counts: counts,
    clock: clock,
    networkBackend: options?.networkBackend,
    latencyInMs: options?.latencyInMs,
  });
  const harness: CollectorHarness = createCollectorHarness({
    transport: cloud.transport,
    clock: clock,
    overrides: options?.overrides,
  });

  return {
    cloud,
    clock,
    harness,
    startedAt: clock.now(),
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

  scene.lastReport = report;

  // Collections start every two minutes, whatever this one took.
  scene.clock.advance(
    Math.max(
      0,
      startedAt + INTERVAL_IN_MINUTES * MINUTE_IN_MS - scene.clock.now(),
    ),
  );

  return report;
}

function bySize(
  data: Array<[string, OpenStackCloudCounts]>,
): Array<{ name: string; counts: OpenStackCloudCounts }> {
  return data.map(([name, counts]: [string, OpenStackCloudCounts]) => {
    return { name, counts };
  });
}

const SMALL: { name: string; counts: OpenStackCloudCounts } = {
  name: "10 hypervisors, 100 instances",
  counts: OPENSTACK_SMALL_CLOUD,
};
const MEDIUM: { name: string; counts: OpenStackCloudCounts } = {
  name: "500 hypervisors, 20,000 instances",
  counts: OPENSTACK_MEDIUM_CLOUD,
};
const LARGE: { name: string; counts: OpenStackCloudCounts } = {
  name: "5,000 hypervisors, 200,000 instances, 10,000 projects",
  counts: OPENSTACK_LARGE_CLOUD,
};

const SIZES: Array<{ name: string; counts: OpenStackCloudCounts }> = bySize([
  [SMALL.name, SMALL.counts],
  [MEDIUM.name, MEDIUM.counts],
  [LARGE.name, LARGE.counts],
]);

/*
 * The measured numbers of a run, written out for the docs to be checked against by hand and for
 * the report: nothing reads this file. Set OPENSTACK_SCALE_MEASURES to a path to get it.
 */
const measures: Record<string, unknown> = {};

function measure(name: string, values: JSONObject): void {
  measures[name] = { ...((measures[name] as JSONObject) || {}), ...values };
}

afterAll(() => {
  const file: string | undefined = process.env["OPENSTACK_SCALE_MEASURES"];

  if (file) {
    fs.writeFileSync(path.resolve(file), JSON.stringify(measures, null, 2));
  }
});

const expectedAt: (
  counts: OpenStackCloudCounts,
  minute: number,
) => OpenStackRequestsByService = (
  counts: OpenStackCloudCounts,
  minute: number,
): OpenStackRequestsByService => {
  return simulateOpenStackProbeRequests({
    counts: counts,
    fromMinute: minute,
    toMinute: minute + INTERVAL_IN_MINUTES,
  });
};

/*
 * The minutes where something different falls due: a cold start, a settled collection, Keystone and
 * Glance's turn, a full read of Nova's instances, a token that needs renewing, and Neutron's
 * extensions, read once an hour. Each on the four-minute turn the slow services keep, so the
 * collection before each is the one the schedule says it is.
 */
const COLLECTIONS_WHERE_SOMETHING_FALLS_DUE: ReadonlyArray<number> = [
  0, 2, 4, 28, 30, 56, 60, 62,
];

async function collectAt(scene: Scene, minute: number): Promise<void> {
  scene.clock.advance(
    scene.startedAt + minute * MINUTE_IN_MS - scene.clock.now(),
  );
  scene.cloud.resetCounts();
  await collect(scene);
}

describe("what each size asks of its control plane, and sends", () => {
  test(
    "a cloud of 10 hypervisors, 100 instances asks exactly what the docs say, collection by collection, for two hours",
    async () => {
      const counts: OpenStackCloudCounts = SMALL.counts;
      const scene: Scene = sceneOf(counts);

      for (
        let minute: number = 0;
        minute < 120;
        minute += INTERVAL_IN_MINUTES
      ) {
        await collectAt(scene, minute);
        expect({ minute, requests: scene.cloud.countsByService() }).toEqual({
          minute,
          requests: expectedAt(counts, minute),
        });
      }
    },
    SLOW_TEST_IN_MS,
  );

  /*
   * One walk per size, the same collections asked of each, so a test of what is sent costs nothing
   * more than the collections this has to make anyway.
   */
  test.each(SIZES)(
    "a cloud of $name asks exactly what the docs say, wherever something different falls due, and each collection fits its uploads",
    async ({
      name,
      counts,
    }: {
      name: string;
      counts: OpenStackCloudCounts;
    }) => {
      const scene: Scene = sceneOf(counts);
      const isSummary: boolean =
        counts.instances > OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT;

      for (const minute of COLLECTIONS_WHERE_SOMETHING_FALLS_DUE) {
        await collectAt(scene, minute);

        expect({ minute, requests: scene.cloud.countsByService() }).toEqual({
          minute,
          requests: expectedAt(counts, minute),
        });

        const report: OpenStackCollectionReport = scene.lastReport as never;

        /*
         * Whatever falls due. The first of these at the largest size used to try to hold half a
         * gigabyte of JSON as one string, which a process cannot, and every restart of a probe
         * would have hit that.
         */
        expect({ minute, status: report.status }).toEqual({
          minute,
          status: "Succeeded",
        });

        for (const part of splitOpenStackReport(report)) {
          expect(
            Buffer.byteLength(JSON.stringify(part.resourceMetrics)),
          ).toBeLessThanOrEqual(OPENSTACK_COLLECTION_MAX_PAYLOAD_BYTES);
        }

        if (minute === 0) {
          expect(report.summary?.hypervisorCount).toBe(counts.hypervisors);
          expect(report.summary?.instanceCount).toBe(counts.instances);
          expect(report.summary?.volumeCount).toBe(counts.volumes);
          expect(report.summary?.projectCount).toBe(counts.projects);

          if (isSummary) {
            // Only its share of what goes in turns, and no more uploads than a settled collection.
            expect(report.summary?.isSummaryMode).toBe(true);
            expect(
              datapointsOf(report.resourceMetrics).filter(
                (point: ReportedDatapoint): boolean => {
                  return (
                    point.metric ===
                    "openstack_placement_resource_provider_allocations"
                  );
                },
              ),
            ).toHaveLength(0);
          } else {
            const series: { fast: number; slow: number } =
              getOpenStackSeriesCounts({ counts: counts });

            expect(report.summary?.datapointCount).toBe(
              series.fast + series.slow,
            );
          }

          measure(name, {
            firstCollectionPayloadBytes: Buffer.byteLength(
              JSON.stringify(report.resourceMetrics),
            ),
            firstCollectionUploads: splitOpenStackReport(report).length,
            firstCollectionDatapoints: report.summary?.datapointCount as number,
            refreshCycleInMinutes: report.summary
              ?.refreshCycleInMinutes as number,
          });
        }

        if (minute === 2) {
          measure(name, {
            settledCollectionDatapoints: report.summary
              ?.datapointCount as number,
            settledCollectionPayloadBytes: Buffer.byteLength(
              JSON.stringify(report.resourceMetrics),
            ),
            requestsPerMinuteSettled: getOpenStackProbeRequestsPerMinute(
              counts,
            ) as never,
          });
        }
      }
    },
    SLOW_TEST_IN_MS,
  );

  test("the largest size's cycle is what the docs say", () => {
    expect(
      getOpenStackRollingTurns(
        getOpenStackRollingDatapoints(OPENSTACK_LARGE_CLOUD),
      ) * INTERVAL_IN_MINUTES,
    ).toBe(44);
  });

  (process.env["OPENSTACK_SCALE_FULL_WALK"] === "true" ? test : test.skip)(
    "a cloud of 5,000 hypervisors asks exactly what the docs say over two whole hours",
    async () => {
      const counts: OpenStackCloudCounts = LARGE.counts;
      const scene: Scene = sceneOf(counts);

      for (let minute: number = 0; minute < 60; minute += INTERVAL_IN_MINUTES) {
        await collect(scene);
      }

      expect(scene.cloud.countsByService()).toEqual(
        simulateOpenStackProbeRequests({
          counts: counts,
          fromMinute: 0,
          toMinute: 60,
        }),
      );

      scene.cloud.resetCounts();

      for (let minute: number = 0; minute < 60; minute += INTERVAL_IN_MINUTES) {
        await collect(scene);
      }

      expect(scene.cloud.countsByService()).toEqual(
        simulateOpenStackProbeRequests({
          counts: counts,
          fromMinute: 60,
          toMinute: 120,
        }),
      );
    },
    2 * 60 * 60_000,
  );
});

describe("summary mode, on the probe", () => {
  /*
   * Past the line, in several turns, with a few hundred instances: how many there are only moves
   * how long these take. The walks above hold the real sizes.
   */
  const counts: OpenStackCloudCounts = getOpenStackCountsOfSize({
    hypervisors: 5,
    instances: 400,
    projects: 8,
  });
  const TURNS: number = 4;
  const PAST_THE_LINE: Partial<OpenStackCollectorDependencies> = {
    summaryModeInstanceLimit: 100,
    rollingBytesPerCollection:
      (getOpenStackRollingDatapoints(counts) *
        OPENSTACK_ROLLING_BYTES_PER_DATAPOINT) /
      TURNS,
  };

  function serverPoints(
    report: OpenStackCollectionReport,
  ): Array<ReportedDatapoint> {
    return datapointsOf(report.resourceMetrics).filter(
      (point: ReportedDatapoint): boolean => {
        return point.metric === "openstack_nova_server_status";
      },
    );
  }

  function upOf(
    report: OpenStackCollectionReport,
  ): ReportedDatapoint | undefined {
    return datapointsOf(report.resourceMetrics).find(
      (point: ReportedDatapoint): boolean => {
        return point.metric === "openstack_nova_up";
      },
    );
  }

  test("just past the size, one turn sends every part, and the totals whole", async () => {
    const justPast: OpenStackCloudCounts = getOpenStackCountsOfSize({
      hypervisors: 5,
      instances: OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT + 1000,
      projects: 20,
    });
    const scene: Scene = sceneOf(justPast);

    const first: OpenStackCollectionReport = await collect(scene);

    expect(first.summary?.isSummaryMode).toBe(true);
    expect(first.summary?.refreshCycleInMinutes).toBe(INTERVAL_IN_MINUTES);
    expect(serverPoints(first)).toHaveLength(justPast.instances);

    const second: OpenStackCollectionReport = await collect(scene);

    expect(second.summary?.isSummaryMode).toBe(true);
    expect(
      datapointsOf(second.resourceMetrics).find(
        (point: ReportedDatapoint): boolean => {
          return point.metric === "openstack_nova_total_vms";
        },
      )?.value,
    ).toBe(justPast.instances);
  }, 600000);

  test("an instance that changes goes at once, and one in a bad state goes every time", async () => {
    const scene: Scene = sceneOf(counts, { overrides: PAST_THE_LINE });

    await collect(scene);
    await collect(scene);

    scene.cloud.changeInstances([11, 12], "ERROR");

    const report: OpenStackCollectionReport = await collect(scene);

    expect(report.summary?.refreshCycleInMinutes).toBe(
      TURNS * INTERVAL_IN_MINUTES,
    );

    const points: Array<ReportedDatapoint> = serverPoints(report);
    const inError: Array<ReportedDatapoint> = points.filter(
      (point: ReportedDatapoint): boolean => {
        return point.labels["status"] === "ERROR";
      },
    );

    expect(inError).toHaveLength(2);
    // Only a share of the rest.
    expect(points.length).toBeLessThan(counts.instances);
    expect(points.length).toBeGreaterThan(2);

    const again: OpenStackCollectionReport = await collect(scene);

    expect(
      serverPoints(again).filter((point: ReportedDatapoint): boolean => {
        return point.labels["status"] === "ERROR";
      }),
    ).toHaveLength(2);
  }, 600000);

  test("every instance comes round within the stated cycle, and the stale-row rule is told how long that is", async () => {
    const scene: Scene = sceneOf(counts, { overrides: PAST_THE_LINE });

    const first: OpenStackCollectionReport = await collect(scene);
    const cycle: number = first.summary?.refreshCycleInMinutes as number;
    const seen: Set<string> = new Set();

    for (const point of serverPoints(first)) {
      seen.add(point.labels["id"] as string);
    }

    // Not everything has gone yet, so this read does not speak for what it held back.
    expect(upOf(first)?.labels["refresh_cycle_minutes"]).toBe(String(cycle));
    expect(upOf(first)?.labels["vouches_for_rows"]).toBe("false");

    for (let turn: number = 1; turn < TURNS; turn++) {
      for (const point of serverPoints(await collect(scene))) {
        seen.add(point.labels["id"] as string);
      }
    }

    expect(seen.size).toBe(counts.instances);

    // Now it does.
    const after: OpenStackCollectionReport = await collect(scene);

    expect(upOf(after)?.labels["refresh_cycle_minutes"]).toBe(String(cycle));
    expect(upOf(after)?.labels["vouches_for_rows"]).toBeUndefined();
  }, 600000);

  test("a project someone chose keeps every instance's series, every collection", async () => {
    const chosen: string = String(3).padStart(32, "0");
    const scene: Scene = sceneOf(counts, {
      overrides: PAST_THE_LINE,
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

    expect(ofChosen).toHaveLength(counts.instances / counts.projects);
  }, 600000);

  test("a cloud set to keep everything is never summarized", async () => {
    const scene: Scene = sceneOf(counts, {
      overrides: PAST_THE_LINE,
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
    const scene: Scene = sceneOf(counts, { overrides: PAST_THE_LINE });

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

  test("a cloud of 200,000 instances set to keep everything is past what a probe holds in memory, and says so rather than trying", async () => {
    expect(
      getOpenStackRollingDatapoints(OPENSTACK_LARGE_CLOUD) *
        OPENSTACK_ROLLING_BYTES_PER_DATAPOINT,
    ).toBeGreaterThan(OPENSTACK_COLLECTION_MAX_TOTAL_PAYLOAD_BYTES);

    // The same decision, on a cloud small enough to read here.
    const scene: Scene = sceneOf(counts, {
      overrides: { summaryModeInstanceLimit: 100, maxPayloadBytes: 1000 },
      job: {
        options: { instanceSeriesMode: OpenStackInstanceMetricsMode.All },
      },
    });

    const report: OpenStackCollectionReport = await collect(scene);

    expect(report.status).toBe("Failed");
    expect(report.errorMessage).toContain("Use the OpenStack agent");

    // The API answered, and that says nothing about the rows that did not fit.
    expect(upOf(report)?.value).toBe(1);
    expect(upOf(report)?.labels["vouches_for_rows"]).toBe("false");
  }, 600000);
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
      clock: createEventClock(),
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

    expect(novaSummary(slow)?.slowestAnswerInMs).toBe(2000);
    expect(novaSummary(slow)?.pausedForInMs).toBeGreaterThan(0);

    // Each service runs on its own, so nothing else was held up by Nova being slow.
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

  test("a pause takes real load off: the same reads take at least twice as long while it lasts", async () => {
    let isSlow: boolean = false;

    const scene: Scene = sceneOf(counts, {
      clock: createEventClock(),
      latencyInMs: (): number => {
        return isSlow ? 3000 : 100;
      },
    });

    await collect(scene);
    isSlow = true;

    scene.cloud.resetCounts();

    const startedAt: number = scene.clock.now();

    await OpenStackCollector.collect(scene.job, scene.harness.dependencies);

    const tookInMs: number = scene.clock.now() - startedAt;
    const nova: number =
      scene.cloud.countsByService()[OpenStackServiceType.Compute];

    /*
     * Nova's reads are one at a time, and each answer is followed by a wait as long as it took: at
     * half the rate it would otherwise be answering at. Every read but the last has a pause behind
     * it, and the first of them was not yet known to be slow.
     */
    expect(tookInMs).toBeGreaterThanOrEqual(3000 * nova * 2 - 3000);
  }, 300000);

  test("several reads at once take turns, so the pause does not end in a burst", async () => {
    const started: Array<number> = [];
    const clock: FakeClock = createEventClock();

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

describe("what a collection's time allows, as the docs say it", () => {
  /*
   * Two hundred pages of instances, a page a hundred rows here rather than a thousand, because what
   * this is about is how many pages fit in the time. The same arithmetic as 200,000 instances.
   */
  const counts: OpenStackCloudCounts = getOpenStackCountsOfSize({
    hypervisors: 2,
    instances: 20000,
    projects: 10,
  });

  async function fullReadOfNova(data: {
    secondsPerPage: number;
    interval: number;
  }): Promise<OpenStackServiceSummary | undefined> {
    const scene: Scene = sceneOf(counts, {
      clock: createEventClock(),
      overrides: { pageSize: 100 },
      job: { collectionIntervalInMinutes: data.interval },
      latencyInMs: (
        request: { url: string },
        service: OpenStackServiceType,
      ): number => {
        return service === OpenStackServiceType.Compute &&
          request.url.includes("/servers/detail")
          ? data.secondsPerPage * 1000
          : 0;
      },
    });

    const report: OpenStackCollectionReport = await collect(scene);

    return report.summary?.services.find(
      (service: OpenStackServiceSummary): boolean => {
        return service.service === OpenStackServiceType.Compute;
      },
    );
  }

  test("Nova's full read fits in two minutes at half a second a page", async () => {
    expect(
      (await fullReadOfNova({ secondsPerPage: 0.5, interval: 2 }))?.outcome,
    ).toBe("Succeeded");
  }, 300000);

  test("at a second a page it does not, and says so, and every five minutes it does", async () => {
    const tooOften: OpenStackServiceSummary | undefined = await fullReadOfNova({
      secondsPerPage: 1,
      interval: 2,
    });

    expect(tooOften?.outcome).not.toBe("Succeeded");
    expect(tooOften?.errorMessage).toContain("ran out of time");

    expect(
      (await fullReadOfNova({ secondsPerPage: 1, interval: 5 }))?.outcome,
    ).toBe("Succeeded");
  }, 300000);
});

describe("the numbers the docs publish", () => {
  const PAGE: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Docs/Content/en/telemetry/openstack-very-large-clouds.md",
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
