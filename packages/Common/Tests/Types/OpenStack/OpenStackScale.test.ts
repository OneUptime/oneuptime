import { describe, expect, test } from "@jest/globals";
import { AverageMetricRowSizeInBytes } from "../../../Server/EnvironmentConfig";
import {
  TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS,
  TELEMETRY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_RETENTION_IN_DAYS,
} from "../../../Types/Billing/PayAsYouGoPricing";
import { OpenStackInstanceMetricsMode } from "../../../Types/OpenStack/OpenStackInstanceMetrics";
import { OpenStackServiceType } from "../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_AVERAGE_METRIC_ROW_SIZE_IN_BYTES,
  OPENSTACK_INSTANCES_BY_STATUS_SERIES,
  OPENSTACK_LARGE_CLOUD,
  OPENSTACK_MEDIUM_CLOUD,
  OPENSTACK_SUMMARY_MODE_SERIES,
  OPENSTACK_SMALL_CLOUD,
  OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT,
  OpenStackVolumeEstimate,
  estimateOpenStackVolume,
  getOpenStackCountsOfSize,
  getOpenStackExporterRequestsPerScrape,
  getOpenStackListRequests,
  getOpenStackProbeRequestsPerMinute,
  getOpenStackSeriesCounts,
  getOpenStackShardPlanProblems,
  getOpenStackSlowServiceEveryMinutes,
  isOpenStackSeriesKeptInSummaryMode,
  isOpenStackSummaryMode,
  simulateOpenStackProbeRequests,
} from "../../../Types/OpenStack/OpenStackScale";

/*
 * The numbers a reviewer reads before installing anything. Whether they are what the collector
 * really does is OpenStackScaleBudget.test.ts's to prove, with the collector and a mock API. This
 * holds what they are made of: the rates the bill uses, and the shape of the answers.
 */

describe("the rates are the ones the bill uses", () => {
  test("the row size is what TelemetryUsageBillingService falls back on", () => {
    expect(OPENSTACK_AVERAGE_METRIC_ROW_SIZE_IN_BYTES).toBe(
      AverageMetricRowSizeInBytes,
    );
  });

  test("what a gigabyte costs is what TelemetryMeteredPlan charges", () => {
    const counts: ReturnType<typeof getOpenStackCountsOfSize> =
      OPENSTACK_MEDIUM_CLOUD;

    for (const retention of [1, 7, 15, 30]) {
      const estimate: OpenStackVolumeEstimate = estimateOpenStackVolume({
        counts: counts,
        retentionInDays: retention,
      });

      expect(estimate.costInUSDPerMonth).toBeCloseTo(
        estimate.gigabytesPerDay *
          30 *
          Math.max(retention, TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS) *
          (TELEMETRY_PRICE_IN_USD_PER_GB / TELEMETRY_PRICE_RETENTION_IN_DAYS),
        6,
      );
    }
  });

  test("bytes follow datapoints, and a gigabyte is the bill's", () => {
    const estimate: OpenStackVolumeEstimate = estimateOpenStackVolume({
      counts: OPENSTACK_SMALL_CLOUD,
    });

    expect(estimate.bytesPerDay).toBe(estimate.datapointsPerDay * 1024);
    expect(estimate.gigabytesPerDay).toBeCloseTo(
      estimate.bytesPerDay / (1024 * 1024 * 1024),
      6,
    );
  });
});

describe("the sizes the product is tested at", () => {
  test("are the issue's", () => {
    expect([
      OPENSTACK_SMALL_CLOUD.hypervisors,
      OPENSTACK_MEDIUM_CLOUD.hypervisors,
      OPENSTACK_LARGE_CLOUD.hypervisors,
    ]).toEqual([10, 500, 5000]);
    expect([
      OPENSTACK_SMALL_CLOUD.instances,
      OPENSTACK_MEDIUM_CLOUD.instances,
      OPENSTACK_LARGE_CLOUD.instances,
    ]).toEqual([100, 20000, 200000]);
    expect(OPENSTACK_LARGE_CLOUD.projects).toBe(10000);
  });
});

describe("summary mode", () => {
  test("begins past a stated size, and only when nobody asked to keep everything", () => {
    const options: { mode: OpenStackInstanceMetricsMode } = {
      mode: OpenStackInstanceMetricsMode.Automatic,
    };

    expect(
      isOpenStackSummaryMode({
        options,
        instanceCount: OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT,
      }),
    ).toBe(false);
    expect(
      isOpenStackSummaryMode({
        options,
        instanceCount: OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT + 1,
      }),
    ).toBe(true);
    expect(isOpenStackSummaryMode({ options, instanceCount: null })).toBe(
      false,
    );
    expect(
      isOpenStackSummaryMode({
        options: { mode: OpenStackInstanceMetricsMode.All },
        instanceCount: 1000000,
      }),
    ).toBe(false);

    for (const mode of [
      OpenStackInstanceMetricsMode.Selected,
      OpenStackInstanceMetricsMode.Off,
    ]) {
      expect(
        isOpenStackSummaryMode({
          options: { mode },
          instanceCount: OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT + 1,
        }),
      ).toBe(true);
    }
  });

  const kept: (data: {
    status?: string;
    projectId?: string;
    metricName?: string;
    keptProjectIds?: Array<string>;
  }) => boolean = (data: {
    status?: string;
    projectId?: string;
    metricName?: string;
    keptProjectIds?: Array<string>;
  }): boolean => {
    return isOpenStackSeriesKeptInSummaryMode({
      metricName: data.metricName || "openstack_nova_server_status",
      status: data.status,
      projectId: data.projectId,
      keptProjectIds: new Set(data.keptProjectIds || []),
    });
  };

  test("leaves alone every series that is not per instance", () => {
    expect(kept({ metricName: "openstack_nova_running_vms" })).toBe(true);
    expect(kept({ metricName: OPENSTACK_INSTANCES_BY_STATUS_SERIES })).toBe(
      true,
    );
    expect(kept({ metricName: "openstack_cinder_snapshot_gb" })).toBe(true);
  });

  test.each([
    "ACTIVE",
    "SHUTOFF",
    "SUSPENDED",
    "PAUSED",
    "SHELVED",
    "SHELVED_OFFLOADED",
  ])(
    "%s says nothing an alert watches, so its series goes",
    (status: string) => {
      expect(kept({ status })).toBe(false);
    },
  );

  test.each([
    "ERROR",
    "BUILD",
    "REBUILD",
    "RESIZE",
    "VERIFY_RESIZE",
    "MIGRATING",
    "HARD_REBOOT",
    "UNKNOWN",
  ])(
    "%s keeps its series, because the templates watch it and one that goes away reads as recovered",
    (status: string) => {
      expect(kept({ status })).toBe(true);
    },
  );

  test("a project someone chose keeps every instance's series", () => {
    expect(
      kept({ status: "ACTIVE", projectId: "p-1", keptProjectIds: ["p-1"] }),
    ).toBe(true);
    expect(
      kept({ status: "ACTIVE", projectId: "p-2", keptProjectIds: ["p-1"] }),
    ).toBe(false);
  });

  test("allocations go, whoever they belong to: nothing names their project", () => {
    expect(
      kept({
        metricName: "openstack_placement_resource_provider_allocations",
        status: "ERROR",
        keptProjectIds: ["p-1"],
      }),
    ).toBe(false);
    expect(OPENSTACK_SUMMARY_MODE_SERIES.size).toBe(5);
  });

  test("a volume keeps its series while something is wrong with it, or someone chose its project", () => {
    for (const metricName of [
      "openstack_cinder_volume_gb",
      "openstack_cinder_volume_status",
    ]) {
      expect(kept({ metricName, status: "in-use" })).toBe(false);
      expect(kept({ metricName, status: "available" })).toBe(false);
      expect(kept({ metricName, status: "error" })).toBe(true);
      expect(kept({ metricName, status: "attaching" })).toBe(true);
      expect(
        kept({
          metricName,
          status: "in-use",
          projectId: "p-1",
          keptProjectIds: ["p-1"],
        }),
      ).toBe(true);
    }
  });

  test("past the line is where these series are most of the bill, and in summary mode they are not", () => {
    const atTheLine: ReturnType<typeof getOpenStackCountsOfSize> =
      getOpenStackCountsOfSize({
        hypervisors: 125,
        instances: OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT,
        projects: 250,
      });
    const whole: OpenStackVolumeEstimate = estimateOpenStackVolume({
      counts: atTheLine,
    });

    expect(whole.perInstanceShare).toBeGreaterThan(0.5);

    const summary: OpenStackVolumeEstimate = estimateOpenStackVolume({
      counts: OPENSTACK_LARGE_CLOUD,
      isSummaryMode: true,
      keptInstances: 200,
    });
    const everything: OpenStackVolumeEstimate = estimateOpenStackVolume({
      counts: OPENSTACK_LARGE_CLOUD,
    });

    expect(everything.perInstanceShare).toBeGreaterThan(0.5);
    expect(summary.perInstanceShare).toBeLessThan(0.01);
    expect(summary.gigabytesPerDay).toBeLessThan(
      everything.gigabytesPerDay / 2,
    );
  });

  test("the series a cloud in summary mode keeps per project and status are counted", () => {
    const whole: ReturnType<typeof getOpenStackSeriesCounts> =
      getOpenStackSeriesCounts({ counts: OPENSTACK_LARGE_CLOUD });
    const summary: ReturnType<typeof getOpenStackSeriesCounts> =
      getOpenStackSeriesCounts({
        counts: OPENSTACK_LARGE_CLOUD,
        isSummaryMode: true,
        keptInstances: 0,
      });

    expect(whole.perInstance).toBe(
      OPENSTACK_LARGE_CLOUD.instances * 4 + OPENSTACK_LARGE_CLOUD.volumes * 2,
    );
    expect(summary.perInstance).toBe(0);
    expect(whole.fast - summary.fast).toBe(
      whole.perInstance - 6 - OPENSTACK_LARGE_CLOUD.projects,
    );
  });
});

describe("the load on the control plane", () => {
  test("a list takes a request per thousand, and one more when the last page came back full", () => {
    expect(getOpenStackListRequests(0)).toBe(1);
    expect(getOpenStackListRequests(999)).toBe(1);
    expect(getOpenStackListRequests(1000)).toBe(2);
    expect(getOpenStackListRequests(200000)).toBe(201);
  });

  test("Keystone and Glance are read about every five minutes, in whole collections", () => {
    expect(getOpenStackSlowServiceEveryMinutes(1)).toBe(5);
    expect(getOpenStackSlowServiceEveryMinutes(2)).toBe(4);
    expect(getOpenStackSlowServiceEveryMinutes(5)).toBe(5);
    expect(getOpenStackSlowServiceEveryMinutes(10)).toBe(10);
  });

  test("collecting half as often is half the load, more or less", () => {
    const often: Record<OpenStackServiceType, number> =
      getOpenStackProbeRequestsPerMinute(OPENSTACK_MEDIUM_CLOUD);
    const rarely: Record<OpenStackServiceType, number> =
      getOpenStackProbeRequestsPerMinute(OPENSTACK_MEDIUM_CLOUD, {
        collectionIntervalInMinutes: 4,
      });

    expect(rarely[OpenStackServiceType.Placement]).toBeCloseTo(
      often[OpenStackServiceType.Placement] / 2,
      0,
    );
  });

  test("Placement stops growing with the cloud at the per-part limit", () => {
    const large: Record<OpenStackServiceType, number> =
      getOpenStackProbeRequestsPerMinute(OPENSTACK_LARGE_CLOUD);
    const larger: Record<OpenStackServiceType, number> =
      getOpenStackProbeRequestsPerMinute(
        getOpenStackCountsOfSize({
          hypervisors: 20000,
          instances: 800000,
          projects: 10000,
        }),
      );

    expect(larger[OpenStackServiceType.Placement]).toBe(
      large[OpenStackServiceType.Placement],
    );
  });

  test("the first hour holds what only a first collection reads", () => {
    const first: Record<OpenStackServiceType, number> =
      simulateOpenStackProbeRequests({
        counts: OPENSTACK_SMALL_CLOUD,
        fromMinute: 0,
        toMinute: 60,
      });
    const later: Record<OpenStackServiceType, number> =
      simulateOpenStackProbeRequests({
        counts: OPENSTACK_SMALL_CLOUD,
        fromMinute: 120,
        toMinute: 180,
      });

    expect(
      first[OpenStackServiceType.Placement] -
        later[OpenStackServiceType.Placement],
    ).toBe(OPENSTACK_SMALL_CLOUD.hypervisors);
  });

  test("the exporter reads three things per hypervisor on every scrape, however many there are", () => {
    expect(
      getOpenStackExporterRequestsPerScrape(OPENSTACK_LARGE_CLOUD)[
        OpenStackServiceType.Placement
      ],
    ).toBe(2 + 5000 * 3);
    expect(
      getOpenStackExporterRequestsPerScrape(OPENSTACK_LARGE_CLOUD)[
        OpenStackServiceType.Compute
      ],
    ).toBe(1 + 3 + 6 + 1 + 201);
  });
});

describe("sharding", () => {
  const regions: Array<string> = ["RegionOne", "RegionTwo"];
  const services: Array<OpenStackServiceType> = [
    OpenStackServiceType.Identity,
    OpenStackServiceType.Compute,
    OpenStackServiceType.Placement,
  ];

  test("one collector per region and one for Keystone leaves nothing out and nothing twice", () => {
    expect(
      getOpenStackShardPlanProblems({
        regions: regions,
        services: services,
        shards: [
          {
            name: "agent-one",
            regions: ["RegionOne"],
            services: [
              OpenStackServiceType.Identity,
              OpenStackServiceType.Compute,
              OpenStackServiceType.Placement,
            ],
          },
          {
            name: "agent-two",
            regions: ["RegionTwo"],
            services: [
              OpenStackServiceType.Compute,
              OpenStackServiceType.Placement,
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  test("a service read twice in a region is named, as is one nobody reads", () => {
    expect(
      getOpenStackShardPlanProblems({
        regions: ["RegionOne"],
        services: services,
        shards: [
          {
            name: "agent-one",
            regions: ["RegionOne"],
            services: [
              OpenStackServiceType.Identity,
              OpenStackServiceType.Compute,
            ],
          },
          {
            name: "agent-two",
            regions: ["RegionOne"],
            services: [OpenStackServiceType.Compute],
          },
        ],
      }),
    ).toEqual([
      {
        regionName: "RegionOne",
        service: OpenStackServiceType.Compute,
        problem: "doubled",
        collectors: ["agent-one", "agent-two"],
      },
      {
        regionName: "RegionOne",
        service: OpenStackServiceType.Placement,
        problem: "missing",
        collectors: [],
      },
    ]);
  });

  test("Keystone is one for the whole cloud, whichever region a shard reads", () => {
    expect(
      getOpenStackShardPlanProblems({
        regions: regions,
        services: [OpenStackServiceType.Identity],
        shards: [
          {
            name: "agent-one",
            regions: ["RegionOne"],
            services: [OpenStackServiceType.Identity],
          },
          {
            name: "agent-two",
            regions: ["RegionTwo"],
            services: [OpenStackServiceType.Identity],
          },
        ],
      }),
    ).toEqual([
      {
        regionName: "*",
        service: OpenStackServiceType.Identity,
        problem: "doubled",
        collectors: ["agent-one", "agent-two"],
      },
    ]);
  });
});
