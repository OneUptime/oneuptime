import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import DockerResourceService, {
  ParsedDockerContainer,
} from "Common/Server/Services/DockerResourceService";
import PodmanResourceService, {
  ParsedPodmanContainer,
} from "Common/Server/Services/PodmanResourceService";
import DockerSwarmResourceService, {
  DockerSwarmResourceLatestMetric,
} from "Common/Server/Services/DockerSwarmResourceService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  CAPTURED_CONTAINERS,
  CapturedContainer,
  capturedResourceMetrics,
} from "../Fixtures/DockerStatsCapture";
import {
  CPU_CAPTURE_SCRAPES,
  CapturedScrape,
  CapturedScrapeContainer,
  ONE_AND_A_HALF_CORE_CONTAINER,
  QUARTER_CORE_CONTAINER,
  capturedAgentResourceMetrics,
  capturedScrapeContainer,
} from "../Fixtures/DockerAgentCpuCapture";

/*
 * Container CPU and memory percent at ingest, fed what the agents really
 * send.
 *
 * A customer saw container.memory.percent at 436.64% for a container using
 * 175 MB of a 4.01 GB limit (4.36%), and container.cpu.utilization flat and
 * near zero. The docker_stats receiver sends both as a percent (0-100, CPU
 * over 100 on several cores) but declares the unit "1", a 0-1 fraction, and
 * OneUptime drew, converted and mirrored every one of them times 100. The
 * fixed agents declare "%" (and compute the CPU percent over each interval,
 * Tests/Ops/ContainerAgentCpuUtilization.test.js); for every agent still in
 * the field, ingest reads a docker_stats (or podman_stats) percent declared
 * "1" as "%": the metric catalog, which every chart and generic monitor reads
 * the unit from, says "%", and the container rows mirror the percent as it
 * is.
 *
 * Two real captures: the agent as it was (Fixtures/DockerStatsCapture, its
 * receiver's own CPU percent, unit "1") and the agent as it is now
 * (Fixtures/DockerAgentCpuCapture, two consecutive scrapes, unit "%").
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const HOST_ID: ObjectID = ObjectID.generate();
const SWARM_CLUSTER_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();

const DOCKER_STATS_SCOPE: string =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/dockerstatsreceiver";
const KUBELETSTATS_SCOPE: string =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/kubeletstatsreceiver";
const PODMAN_STATS_SCOPE: string =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/podmanreceiver";

type Platform = "docker" | "podman" | "swarm" | "none";

const DISCOVERIES_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverIoTFleet",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

interface Spies {
  // The ClickHouse rows of the batch, as the final flush got them.
  storedRows: Array<JSONObject>;
  catalog: jest.SpyInstance;
  dockerRows: jest.SpyInstance;
  podmanRows: jest.SpyInstance;
  swarmRows: jest.SpyInstance;
}

function request(blocks: Array<JSONObject>): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: { resourceMetrics: blocks },
    headers: {},
  } as unknown as TelemetryRequest;
}

function setupIngest(platform: Platform): Spies {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelMetricsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  const storedRows: Array<JSONObject> = [];
  jest.spyOn(service, "runBatchHostEnrichment").mockResolvedValue(undefined);
  jest
    .spyOn(service, "submitMetricsBuffer")
    .mockImplementation(async (...args: Array<unknown>): Promise<void> => {
      // (rows, pendingAcks, force): the batch's rows are flushed with force
      // at its end, then cleared.
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      if (args[2] === true) {
        for (const row of rows) {
          storedRows.push({ ...row });
        }
      }
    });
  for (const method of DISCOVERIES_RETURNING_NULL) {
    if (typeof service[method] === "function") {
      jest.spyOn(service, method).mockResolvedValue(null);
    }
  }
  jest
    .spyOn(service, "autoDiscoverDockerHost")
    .mockResolvedValue(platform === "docker" ? HOST_ID : null);
  jest
    .spyOn(service, "autoDiscoverPodmanHost")
    .mockResolvedValue(platform === "podman" ? HOST_ID : null);
  jest
    .spyOn(service, "autoDiscoverDockerSwarmCluster")
    .mockResolvedValue(platform === "swarm" ? SWARM_CLUSTER_ID : null);
  jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
    serviceName: "probe-host",
    primaryEntityId: SERVICE_ID,
    primaryEntityType:
      platform === "podman" ? ServiceType.PodmanHost : ServiceType.DockerHost,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });
  jest
    .spyOn(MetricPipelineRuleService, "loadRules")
    .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });

  return {
    storedRows: storedRows,
    catalog: jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(undefined as any),
    dockerRows: jest
      .spyOn(DockerResourceService, "bulkUpsertContainers")
      .mockResolvedValue(undefined),
    podmanRows: jest
      .spyOn(PodmanResourceService, "bulkUpsertContainers")
      .mockResolvedValue(undefined),
    swarmRows: jest
      .spyOn(DockerSwarmResourceService, "bulkUpdateLatestMetrics")
      .mockResolvedValue(undefined),
  };
}

// The unit the batch recorded for each metric name, as the catalog gets it.
function catalogUnits(spy: jest.SpyInstance): Dictionary<string | undefined> {
  expect(spy).toHaveBeenCalledTimes(1);
  const map: Dictionary<MetricType> = (
    spy.mock.calls[0]![0] as {
      metricNameServiceNameMap: Dictionary<MetricType>;
    }
  ).metricNameServiceNameMap;
  const units: Dictionary<string | undefined> = {};
  for (const [name, metricType] of Object.entries(map)) {
    units[name] = metricType.unit;
  }
  return units;
}

function containerRows(
  spy: jest.SpyInstance,
): Map<string, ParsedDockerContainer | ParsedPodmanContainer> {
  expect(spy).toHaveBeenCalledTimes(1);
  const rows: Map<string, ParsedDockerContainer | ParsedPodmanContainer> =
    new Map<string, ParsedDockerContainer | ParsedPodmanContainer>();
  for (const row of (
    spy.mock.calls[0]![0] as {
      containers: Array<ParsedDockerContainer | ParsedPodmanContainer>;
    }
  ).containers) {
    rows.set(row.containerName, row);
  }
  return rows;
}

function scrapeBlocks(
  scrape: CapturedScrape,
  runtime: "docker" | "podman" = "docker",
): Array<JSONObject> {
  return scrape.containers.map(
    (container: CapturedScrapeContainer): JSONObject => {
      return capturedAgentResourceMetrics(scrape, container, runtime);
    },
  );
}

// A gauge block for one metric of one producer.
function gaugeBlock(input: {
  scopeName: string | undefined;
  metricName: string;
  unit: string | undefined;
  value: number;
  resource: Array<[string, string]>;
}): JSONObject {
  const metric: JSONObject = {
    name: input.metricName,
    gauge: {
      dataPoints: [
        { timeUnixNano: "1792446622881284451", asDouble: input.value },
      ],
    },
  };
  if (input.unit !== undefined) {
    metric["unit"] = input.unit;
  }
  const scopeMetric: JSONObject = { metrics: [metric] };
  if (input.scopeName !== undefined) {
    scopeMetric["scope"] = { name: input.scopeName, version: "0.161.0" };
  }
  return {
    resource: {
      attributes: input.resource.map(
        ([key, value]: [string, string]): JSONObject => {
          return { key, value: { stringValue: value } };
        },
      ),
    },
    scopeMetrics: [scopeMetric],
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the agent as it was: docker_stats percents declared '1'", () => {
  test("regression: the catalog records container.cpu.utilization and container.memory.percent as '%', not '1'", async () => {
    const spies: Spies = setupIngest("docker");

    await OtelMetricsIngestService.processMetricsFromQueue(
      request(
        CAPTURED_CONTAINERS.map((container: CapturedContainer): JSONObject => {
          return capturedResourceMetrics(container);
        }),
      ),
    );

    const units: Dictionary<string | undefined> = catalogUnits(spies.catalog);
    expect(units["container.cpu.utilization"]).toBe("%");
    // The other metrics keep the unit they declared.
    expect(units["container.memory.usage.total"]).toBe("By");
    expect(units["container.restarts"]).toBe("{restarts}");
    expect(units["container.uptime"]).toBe("s");
  });

  test("regression: a container row's CPU is the percent as sent, never times 100", async () => {
    const spies: Spies = setupIngest("docker");

    await OtelMetricsIngestService.processMetricsFromQueue(
      request(
        CAPTURED_CONTAINERS.map((container: CapturedContainer): JSONObject => {
          return capturedResourceMetrics(container);
        }),
      ),
    );

    const rows: Map<string, ParsedDockerContainer | ParsedPodmanContainer> =
      containerRows(spies.dockerRows);
    for (const container of CAPTURED_CONTAINERS) {
      expect(rows.get(container.name)!.cpuPercent).toBeCloseTo(
        container.cpuUtilization,
        12,
      );
      expect(rows.get(container.name)!.cpuPercent).not.toBeCloseTo(
        container.cpuUtilization * 100,
        6,
      );
    }
  });

  test("the customer's memory reading: 4.3664 declared '1' is recorded as 4.3664 '%' (it read 436.64%)", async () => {
    const spies: Spies = setupIngest("docker");
    const traefik: JSONObject = gaugeBlock({
      scopeName: DOCKER_STATS_SCOPE,
      metricName: "container.memory.percent",
      unit: "1",
      value: 4.3664,
      resource: [
        ["container.runtime", "docker"],
        ["container.name", "feature-flag-proxy-traefik-1"],
        ["host.name", "feature-flags-proxy-prod"],
      ],
    });

    await OtelMetricsIngestService.processMetricsFromQueue(request([traefik]));

    expect(catalogUnits(spies.catalog)["container.memory.percent"]).toBe("%");
    // The value is stored as sent: it was right, only its unit was not.
    const stored: Array<JSONObject> = spies.storedRows.filter(
      (row: JSONObject): boolean => {
        return row["name"] === "container.memory.percent";
      },
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!["value"]).toBe(4.3664);
  });
});

describe("the agent as it is now: the CPU percent over each interval, in '%'", () => {
  test("two consecutive real scrapes: the CPU percent is the rate of container.cpu.usage.total, a quarter core 25% and one and a half cores 150%", () => {
    const [first, second] = CPU_CAPTURE_SCRAPES as [
      CapturedScrape,
      CapturedScrape,
    ];
    const seconds: number =
      Number(BigInt(second.timeUnixNano) - BigInt(first.timeUnixNano)) / 1e9;

    for (const name of [
      QUARTER_CORE_CONTAINER,
      ONE_AND_A_HALF_CORE_CONTAINER,
    ]) {
      const before: CapturedScrapeContainer = capturedScrapeContainer(
        first,
        name,
      );
      const after: CapturedScrapeContainer = capturedScrapeContainer(
        second,
        name,
      );
      const nanosecondsPerSecond: number =
        (Number(after.cpuUsageTotalNanoseconds) -
          Number(before.cpuUsageTotalNanoseconds)) /
        seconds;

      // What the agent sent covers exactly the interval since the scrape before.
      expect(after.cpuUtilizationStartTimeUnixNano).toBe(first.timeUnixNano);
      expect(after.cpuUtilizationPercent).toBeCloseTo(
        nanosecondsPerSecond / 1e7,
        6,
      );
    }

    expect(
      capturedScrapeContainer(second, QUARTER_CORE_CONTAINER)
        .cpuUtilizationPercent,
    ).toBeCloseTo(25, 1);
    expect(
      capturedScrapeContainer(second, ONE_AND_A_HALF_CORE_CONTAINER)
        .cpuUtilizationPercent,
    ).toBeCloseTo(150, 1);
  });

  test("two consecutive real scrapes: memory percent is the usage over the container's memory limit", () => {
    for (const scrape of CPU_CAPTURE_SCRAPES) {
      for (const container of scrape.containers) {
        expect(container.memoryPercent).toBeCloseTo(
          (Number(container.memoryUsageTotalBytes) /
            Number(container.memoryUsageLimitBytes)) *
            100,
          10,
        );
      }
    }
  });

  test.each([0, 1])(
    "scrape %i: the catalog records both percents as '%', and each container row carries the CPU percent as sent",
    async (index: number) => {
      const spies: Spies = setupIngest("docker");
      const scrape: CapturedScrape = CPU_CAPTURE_SCRAPES[index]!;

      await OtelMetricsIngestService.processMetricsFromQueue(
        request(scrapeBlocks(scrape)),
      );

      const units: Dictionary<string | undefined> = catalogUnits(
        spies.catalog,
      );
      expect(units["container.cpu.utilization"]).toBe("%");
      expect(units["container.memory.percent"]).toBe("%");
      expect(units["container.cpu.usage.total"]).toBe("ns");

      const rows: Map<string, ParsedDockerContainer | ParsedPodmanContainer> =
        containerRows(spies.dockerRows);
      for (const container of scrape.containers) {
        expect(rows.get(container.name)!.cpuPercent).toBe(
          container.cpuUtilizationPercent,
        );
        expect(rows.get(container.name)!.memoryBytes).toBe(
          Number(container.memoryUsageTotalBytes),
        );
      }

      // And ClickHouse stores the percents exactly as the agent sent them.
      const storedCpu: Array<number> = spies.storedRows
        .filter((row: JSONObject): boolean => {
          return row["name"] === "container.cpu.utilization";
        })
        .map((row: JSONObject): number => {
          return row["value"] as number;
        })
        .sort((a: number, b: number): number => {
          return a - b;
        });
      expect(storedCpu).toEqual(
        scrape.containers
          .map((container: CapturedScrapeContainer): number => {
            return container.cpuUtilizationPercent;
          })
          .sort((a: number, b: number): number => {
            return a - b;
          }),
      );
    },
  );

  test("Podman: the same scrapes through Podman's host land on its rows unscaled, and the catalog says '%'", async () => {
    const spies: Spies = setupIngest("podman");
    const scrape: CapturedScrape = CPU_CAPTURE_SCRAPES[1]!;

    await OtelMetricsIngestService.processMetricsFromQueue(
      request(scrapeBlocks(scrape, "podman")),
    );

    const rows: Map<string, ParsedDockerContainer | ParsedPodmanContainer> =
      containerRows(spies.podmanRows);
    expect(rows.get(ONE_AND_A_HALF_CORE_CONTAINER)!.cpuPercent).toBeCloseTo(
      150,
      1,
    );
    expect(rows.get(QUARTER_CORE_CONTAINER)!.cpuPercent).toBeCloseTo(25, 1);
    expect(catalogUnits(spies.catalog)["container.memory.percent"]).toBe("%");
  });
});

describe("Docker Swarm tasks", () => {
  const TASK_CONTAINER: string = "web.1.k3j2h4g5f6d7s8a9q0w1e2r3t";

  function swarmBlock(unit: string, cpu: number, memory: number): JSONObject {
    return {
      resource: {
        attributes: [
          {
            key: "container.name",
            value: { stringValue: TASK_CONTAINER },
          },
          {
            key: "docker.swarm.cluster.name",
            value: { stringValue: "prod-swarm" },
          },
        ],
      },
      scopeMetrics: [
        {
          scope: { name: DOCKER_STATS_SCOPE, version: "0.161.0" },
          metrics: [
            {
              name: "container.cpu.utilization",
              unit: unit,
              gauge: {
                dataPoints: [
                  { timeUnixNano: "1792446622881284451", asDouble: cpu },
                ],
              },
            },
            {
              name: "container.memory.percent",
              unit: unit,
              gauge: {
                dataPoints: [
                  { timeUnixNano: "1792446622881284451", asDouble: memory },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  test.each(["1", "%"])(
    "a task's CPU and memory percent (declared '%s') are mirrored as sent: 7.17 stays 7.17, not 717",
    async (unit: string) => {
      const spies: Spies = setupIngest("swarm");

      await OtelMetricsIngestService.processMetricsFromQueue(
        request([swarmBlock(unit, 7.17, 4.36)]),
      );

      expect(spies.swarmRows).toHaveBeenCalledTimes(1);
      const metrics: Array<DockerSwarmResourceLatestMetric> = (
        spies.swarmRows.mock.calls[0]![0] as {
          metrics: Array<DockerSwarmResourceLatestMetric>;
        }
      ).metrics;
      expect(metrics).toHaveLength(1);
      expect(metrics[0]!.externalId).toBe("task/k3j2h4g5f6d7s8a9q0w1e2r3t");
      expect(metrics[0]!.cpuPercent).toBeCloseTo(7.17, 10);
      expect(metrics[0]!.memoryPercent).toBeCloseTo(4.36, 10);
    },
  );
});

describe("other producers of the same names keep the unit they declared", () => {
  test("Kubernetes: kubeletstats' container.cpu.utilization is CPU cores declared '1', and stays '1'", async () => {
    const spies: Spies = setupIngest("none");

    await OtelMetricsIngestService.processMetricsFromQueue(
      request([
        gaugeBlock({
          scopeName: KUBELETSTATS_SCOPE,
          metricName: "container.cpu.utilization",
          unit: "1",
          value: 0.05,
          resource: [
            ["k8s.cluster.name", "prod"],
            ["k8s.pod.name", "web-0"],
            ["k8s.container.name", "web"],
          ],
        }),
      ]),
    );

    expect(catalogUnits(spies.catalog)["container.cpu.utilization"]).toBe("1");
  });

  test.each<[string | undefined, string, string | undefined, string | undefined]>(
    [
      // No scope: nothing says whose percent this is.
      [undefined, "container.memory.percent", "1", "1"],
      // Another receiver's metric of the same name.
      ["my.company/collector", "container.memory.percent", "1", "1"],
      // A docker_stats metric that is not one of its percents.
      [DOCKER_STATS_SCOPE, "container.cpu.shares", "1", "1"],
      // Already "%".
      [DOCKER_STATS_SCOPE, "container.memory.percent", "%", "%"],
      // No unit at all: left as it is.
      [DOCKER_STATS_SCOPE, "container.memory.percent", undefined, undefined],
      // podman_stats' percents.
      [PODMAN_STATS_SCOPE, "container.cpu.percent", "1", "%"],
      [PODMAN_STATS_SCOPE, "container.memory.percent", "1", "%"],
      // podman_stats has no container.cpu.utilization.
      [PODMAN_STATS_SCOPE, "container.cpu.utilization", "1", "1"],
    ],
  )(
    "scope %s, %s declared %s: recorded as %s",
    async (
      scopeName: string | undefined,
      metricName: string,
      unit: string | undefined,
      recorded: string | undefined,
    ) => {
      const spies: Spies = setupIngest("none");

      await OtelMetricsIngestService.processMetricsFromQueue(
        request([
          gaugeBlock({
            scopeName,
            metricName,
            unit,
            value: 12.5,
            resource: [["host.name", "somewhere"]],
          }),
        ]),
      );

      expect(catalogUnits(spies.catalog)[metricName]).toBe(recorded);
    },
  );
});
