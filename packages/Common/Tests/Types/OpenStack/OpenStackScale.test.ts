import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
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
  OPENSTACK_CANDIDATE_READS_PER_COLLECTION,
  OPENSTACK_DATABASE_PATH_HYPERVISOR_LIMIT,
  OPENSTACK_DATABASE_PATH_INSTANCE_LIMIT,
  OPENSTACK_DHCP_AGENT_READS_PER_ROUND,
  OPENSTACK_INSTANCES_BY_STATUS_SERIES,
  OPENSTACK_LARGE_CLOUD,
  OPENSTACK_MEDIUM_CLOUD,
  OPENSTACK_PER_PART_READS_PER_COLLECTION,
  OPENSTACK_PROJECT_LIMIT_READS_PER_COLLECTION,
  OPENSTACK_SUMMARY_MODE_SERIES,
  OPENSTACK_SMALL_CLOUD,
  OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT,
  OpenStackCloudCounts,
  OpenStackVolumeEstimate,
  estimateOpenStackVolume,
  getOpenStackCountsOfSize,
  getOpenStackExporterRequestsPerMinute,
  getOpenStackExporterRequestsPerScrape,
  getOpenStackListRequests,
  getOpenStackProbeRequestsPerMinute,
  getOpenStackRollingDatapoints,
  getOpenStackRollingTurns,
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

describe("what a DHCP agent's networks cost", () => {
  const OVS: OpenStackCloudCounts = { ...OPENSTACK_SMALL_CLOUD, dhcpAgents: 3 };

  function neutronCallsPerHour(data: {
    counts: OpenStackCloudCounts;
    isOvs: boolean;
    isSummaryMode?: boolean;
  }): number {
    return simulateOpenStackProbeRequests({
      counts: data.counts,
      fromMinute: 120,
      toMinute: 180,
      options: {
        networkBackend: data.isOvs ? "ovs" : "ovn",
        isSummaryMode: data.isSummaryMode ?? false,
      },
    })[OpenStackServiceType.Network];
  }

  function withoutDhcp(counts: OpenStackCloudCounts): OpenStackCloudCounts {
    return { ...counts, dhcpAgents: 0 };
  }

  test("six rounds an hour, a call per agent, on ML2/OVS", () => {
    expect(
      neutronCallsPerHour({ counts: OVS, isOvs: true }) -
        neutronCallsPerHour({ counts: withoutDhcp(OVS), isOvs: true }),
    ).toBe(18);
  });

  test("however many agents a cloud runs, the same few a round", () => {
    const many: OpenStackCloudCounts = {
      ...OPENSTACK_SMALL_CLOUD,
      dhcpAgents: 500,
    };

    expect(
      neutronCallsPerHour({ counts: many, isOvs: true }) -
        neutronCallsPerHour({ counts: withoutDhcp(many), isOvs: true }),
    ).toBe(6 * OPENSTACK_DHCP_AGENT_READS_PER_ROUND);
  });

  test("nothing past the summary size, and nothing on OVN", () => {
    expect(
      neutronCallsPerHour({ counts: OVS, isOvs: true, isSummaryMode: true }) -
        neutronCallsPerHour({
          counts: withoutDhcp(OVS),
          isOvs: true,
          isSummaryMode: true,
        }),
    ).toBe(0);
    expect(
      neutronCallsPerHour({ counts: OVS, isOvs: false }) -
        neutronCallsPerHour({ counts: withoutDhcp(OVS), isOvs: false }),
    ).toBe(0);
  });
});

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

    // A first collection reads each host's aggregates, and asks no candidates: it has no flavors yet.
    expect(
      first[OpenStackServiceType.Placement] -
        later[OpenStackServiceType.Placement],
    ).toBe(
      OPENSTACK_SMALL_CLOUD.hypervisors -
        OPENSTACK_CANDIDATE_READS_PER_COLLECTION,
    );
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

describe("what the docs publish", () => {
  const PAGE: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Docs/Content/en/telemetry/openstack-very-large-clouds.md",
    ),
    "utf8",
  );
  const LINES: Array<string> = PAGE.split("\n");
  const SIZES: Array<OpenStackCloudCounts> = [
    OPENSTACK_SMALL_CLOUD,
    OPENSTACK_MEDIUM_CLOUD,
    OPENSTACK_LARGE_CLOUD,
  ];

  function requests(value: number): string {
    return value >= 100
      ? Math.round(value).toLocaleString("en-US")
      : String(Math.round(value * 10) / 10);
  }

  function rowsOf(counts: OpenStackCloudCounts): Array<string> {
    return LINES.filter((line: string): boolean => {
      return line.startsWith(
        `| ${counts.hypervisors.toLocaleString("en-US")} hypervisors, ${counts.instances.toLocaleString("en-US")} instances, ${counts.projects.toLocaleString("en-US")} projects |`,
      );
    });
  }

  test.each(SIZES)(
    "each table has its row for $hypervisors hypervisors, in the order the services are written",
    (counts: OpenStackCloudCounts) => {
      const [probe, agent, volume]: Array<string> = rowsOf(counts);

      const order: Array<OpenStackServiceType> = [
        OpenStackServiceType.Identity,
        OpenStackServiceType.Compute,
        OpenStackServiceType.Placement,
        OpenStackServiceType.Network,
        OpenStackServiceType.Volume,
        OpenStackServiceType.Image,
      ];
      const cells: (row: string | undefined) => Array<string> = (
        row: string | undefined,
      ): Array<string> => {
        return (row || "")
          .split("|")
          .slice(2, -1)
          .map((cell: string): string => {
            return cell.trim();
          });
      };
      const probePerMinute: Record<OpenStackServiceType, number> =
        getOpenStackProbeRequestsPerMinute(counts);
      const agentPerMinute: Record<OpenStackServiceType, number> =
        getOpenStackExporterRequestsPerMinute(counts);

      expect(cells(probe)).toEqual(
        order.map((service: OpenStackServiceType): string => {
          return requests(probePerMinute[service]);
        }),
      );
      expect(cells(agent)).toEqual(
        order.map((service: OpenStackServiceType): string => {
          return requests(agentPerMinute[service]);
        }),
      );

      const isSummary: boolean =
        counts.instances > OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT;
      const everySeries: OpenStackVolumeEstimate = estimateOpenStackVolume({
        counts: counts,
      });
      const summary: OpenStackVolumeEstimate = estimateOpenStackVolume({
        counts: counts,
        isSummaryMode: isSummary,
        keptInstances: isSummary ? Math.ceil(counts.instances / 1000) : 0,
      });

      expect(cells(volume)).toEqual([
        everySeries.series.toLocaleString("en-US"),
        (Math.round(everySeries.gigabytesPerDay * 10) / 10).toString(),
        isSummary
          ? (Math.round(summary.gigabytesPerDay * 10) / 10).toString()
          : "Not in summary mode",
        `$${summary.costInUSDPerMonth.toFixed(2)}`,
      ]);
    },
  );

  test("what a probe sends in summary mode is what the sentence under the table says", () => {
    const gigabytes: (counts: OpenStackCloudCounts) => number = (
      counts: OpenStackCloudCounts,
    ): number => {
      return estimateOpenStackVolume({
        counts: counts,
        isSummaryMode: true,
        keptInstances: Math.ceil(counts.instances / 1000),
        collectionIntervalInMinutes: 2,
      }).gigabytesPerDay;
    };

    expect(PAGE).toContain(
      `about ${Math.round(gigabytes(OPENSTACK_MEDIUM_CLOUD) * 10) / 10} GB a day at the second size and ${Math.round(gigabytes(OPENSTACK_LARGE_CLOUD))} GB at the third`,
    );
  });

  test("each stated line is the one the code draws", () => {
    expect(OPENSTACK_SUMMARY_MODE_INSTANCE_LIMIT).toBe(5000);
    expect(PAGE).toContain("Past 5,000 instances a cloud keeps counts");
    expect(OPENSTACK_DATABASE_PATH_HYPERVISOR_LIMIT).toBe(1500);
    expect(OPENSTACK_DATABASE_PATH_INSTANCE_LIMIT).toBe(100000);
    expect(PAGE).toContain("**1,500 hypervisors or 100,000 instances**");
    expect(OPENSTACK_PER_PART_READS_PER_COLLECTION).toBe(2000);
    expect(OPENSTACK_PROJECT_LIMIT_READS_PER_COLLECTION).toBe(250);
    expect(PAGE).toContain("at most 250 projects a collection");
  });

  test("the cycle the summary section states is what each size works out to", () => {
    const cycleOf: (counts: OpenStackCloudCounts) => number = (
      counts: OpenStackCloudCounts,
    ): number => {
      return (
        getOpenStackRollingTurns(getOpenStackRollingDatapoints(counts)) * 2
      );
    };

    expect(PAGE).toContain(
      `${cycleOf(OPENSTACK_MEDIUM_CLOUD)} minutes at 20,000 instances, ${cycleOf(OPENSTACK_LARGE_CLOUD)} at 200,000`,
    );
  });
});

describe("what the soak measured, as the docs publish it", () => {
  const PAGE: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Docs/Content/en/telemetry/openstack-very-large-clouds.md",
    ),
    "utf8",
  );

  // What OpenStackSoak.test.ts wrote at the end of the hour the docs publish. Nothing else writes it.
  const MEASURED: Record<string, never> = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../Fixtures/OpenStackSoak/measured.json",
      ),
      "utf8",
    ),
  );
  const number: (key: string) => number = (key: string): number => {
    return MEASURED[key] as unknown as number;
  };

  function seconds(milliseconds: number): string {
    return milliseconds >= 10000
      ? `${(milliseconds / 1000).toFixed(0)} s`
      : `${(milliseconds / 1000).toFixed(1)} s`;
  }

  test("it held the largest size for the hour, and every budget", () => {
    expect(number("minutesRan")).toBeGreaterThanOrEqual(60);
    expect(MEASURED["counts"]).toMatchObject({
      hypervisors: 5000,
      instances: 200000,
      projects: 10000,
    });
    expect(MEASURED["requests"]).toEqual(MEASURED["requestsExpected"]);
    expect(number("skippedCollections")).toBe(0);
    expect(number("worstLagMs")).toBeLessThan(120000);
    expect(number("overviewWorstMs")).toBeLessThan(6000);
    expect(number("longestLockWaitMs")).toBeLessThan(5000);
    expect(number("rowsDeleted")).toBe(0);
    expect(MEASURED["failures"]).toEqual([]);
  });

  test("each number on the page is the one it measured", () => {
    const perMinute: Record<string, number> = MEASURED[
      "requestsPerMinute"
    ] as unknown as Record<string, number>;

    for (const text of [
      `Keystone ${perMinute["identity"]}, Nova ${perMinute["compute"]}, Placement ${Math.round(perMinute["placement"] as number).toLocaleString("en-US")}, Neutron ${perMinute["network"]}, Cinder ${perMinute["volume"]}, Glance ${perMinute["image"]}`,
      `${number("skippedCollections")} of ${number("collections")}`,
      `${seconds(number("medianLagMs"))} at the median, ${seconds(number("worstLagMs"))} at worst`,
      `${seconds(number("overviewMedianMs"))} at the median, ${seconds(number("overviewWorstMs"))} at worst`,
      `${number("overviewBytes").toLocaleString("en-US")} bytes of what needs attention`,
      `${seconds(number("longestLockWaitMs"))}, in ${number("lockSamples").toLocaleString("en-US")} looks`,
      `at most ${number("worstHeapUsedMb").toLocaleString("en-US")} MiB of JavaScript heap`,
      `${Math.round(number("medianPayloadBytes") / 1048576)} MiB of metrics a collection`,
    ]) {
      expect(PAGE).toContain(text);
    }
  });
});

describe("what the docs tell people to set, to share a cloud between agents", () => {
  const REGIONS_LINE: RegExp = /OPENSTACK_EXPORTER_CLOUDS=\[([^\]]*)\]/;
  const SERVICES_LINE: RegExp = /OPENSTACK_AGENT_SERVICES=(\S+)/;
  const PAGE: string = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Docs/Content/en/telemetry/openstack-very-large-clouds.md",
    ),
    "utf8",
  );
  const EVERY_SERVICE: Array<OpenStackServiceType> = [
    OpenStackServiceType.Identity,
    OpenStackServiceType.Compute,
    OpenStackServiceType.Placement,
    OpenStackServiceType.Network,
    OpenStackServiceType.Volume,
    OpenStackServiceType.Image,
  ];

  function shardsOfBlock(block: string): Array<{
    name: string;
    regions: Array<string>;
    services: Array<OpenStackServiceType>;
  }> {
    return block.split("\n\n").map(
      (
        shard: string,
        index: number,
      ): {
        name: string;
        regions: Array<string>;
        services: Array<OpenStackServiceType>;
      } => {
        const regions: string | undefined = REGIONS_LINE.exec(shard)?.[1];
        const services: string | undefined = SERVICES_LINE.exec(shard)?.[1];

        return {
          name: `agent ${index}`,
          regions: regions ? regions.split(",") : ["RegionOne"],
          // An agent not told reads everything.
          services: services
            ? (services.split("|") as Array<OpenStackServiceType>)
            : EVERY_SERVICE,
        };
      },
    );
  }

  function blockAfter(heading: string): string {
    const after: string = PAGE.substring(PAGE.indexOf(heading));
    const start: number = after.indexOf("```bash\n") + "```bash\n".length;

    return after.substring(start, after.indexOf("```", start));
  }

  test.each([
    ["One agent per region", ["RegionOne", "RegionTwo"]],
    ["One agent per service", ["RegionOne"]],
  ])(
    "%s leaves nothing out, and nothing twice",
    (heading: string, regions: Array<string>) => {
      expect(
        getOpenStackShardPlanProblems({
          regions: regions,
          services: EVERY_SERVICE,
          shards: shardsOfBlock(blockAfter(`**${heading}**`)),
        }),
      ).toEqual([]);
    },
  );
});

describe("a probe's volume, past the summary size", () => {
  test("is what goes every time, and a turn's share of the rest", () => {
    const agent: OpenStackVolumeEstimate = estimateOpenStackVolume({
      counts: OPENSTACK_LARGE_CLOUD,
      isSummaryMode: true,
      keptInstances: 200,
    });
    const probe: OpenStackVolumeEstimate = estimateOpenStackVolume({
      counts: OPENSTACK_LARGE_CLOUD,
      isSummaryMode: true,
      keptInstances: 200,
      collectionIntervalInMinutes: 2,
    });

    expect(probe.datapointsPerDay).toBeLessThan(agent.datapointsPerDay);
    // All the agent's, and how many of each flavor fit, which only a probe asks.
    expect(probe.series).toBe(agent.series + OPENSTACK_LARGE_CLOUD.flavors * 2);
  });

  test("below it, a probe sends what the agent does and how many of each flavor fit, on its own cadence", () => {
    const series: ReturnType<typeof getOpenStackSeriesCounts> =
      getOpenStackSeriesCounts({
        counts: OPENSTACK_SMALL_CLOUD,
        flavorsAnswered: OPENSTACK_SMALL_CLOUD.flavors,
      });

    expect(
      estimateOpenStackVolume({
        counts: OPENSTACK_SMALL_CLOUD,
        collectionIntervalInMinutes: 2,
      }).datapointsPerDay,
    ).toBe(series.fast * 720 + series.slow * 360);
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
