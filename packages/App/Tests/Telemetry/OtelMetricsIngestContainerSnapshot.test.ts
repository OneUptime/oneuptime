import fs from "fs";
import path from "path";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import DockerResourceService, {
  ParsedDockerContainer,
} from "Common/Server/Services/DockerResourceService";
import PodmanResourceService, {
  ParsedPodmanContainer,
} from "Common/Server/Services/PodmanResourceService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import { CONTAINER_CLASSIFIER_LABEL_KEYS } from "Common/Types/DatabaseServer/DatabaseContainerClassifier";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  CAPTURED_CONTAINERS,
  CAPTURE_OBSERVED_AT,
  CapturedContainer,
  capturedResourceMetrics,
  capturedStartedAt,
} from "../Fixtures/DockerStatsCapture";

/*
 * The Docker / Podman container snapshot the metrics ingest writes — the
 * only path that fills DockerResource / PodmanResource Container rows for
 * every agent — fed the REAL docker_stats capture of the end-to-end run
 * (see Fixtures/DockerStatsCapture). Pins that the Compose / Testcontainers
 * labels the agent copies onto its metrics, and the container's start time
 * (scrape time − container.uptime), reach the rows the database discovery
 * reads; before, every row had labels NULL and resourceCreationTimestamp
 * NULL, so Compose replicas never grouped, Testcontainers and one-off
 * containers became databases, and the lifetime gate timed containers from
 * their first sighting.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const HOST_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();

const OTHER_DISCOVERIES_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverCephCluster",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverIoTFleet",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

function request(blocks: Array<JSONObject>): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: { resourceMetrics: blocks },
    headers: {},
  } as unknown as TelemetryRequest;
}

function setupIngest(platform: "docker" | "podman"): jest.SpyInstance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelMetricsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  jest.spyOn(service, "runBatchHostEnrichment").mockResolvedValue(undefined);
  jest.spyOn(service, "submitMetricsBuffer").mockResolvedValue(undefined);
  for (const method of OTHER_DISCOVERIES_RETURNING_NULL) {
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
  jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
    serviceName: "probe-host",
    primaryEntityId: SERVICE_ID,
    primaryEntityType:
      platform === "docker" ? ServiceType.DockerHost : ServiceType.PodmanHost,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });
  jest
    .spyOn(MetricPipelineRuleService, "loadRules")
    .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue(undefined as any);

  return platform === "docker"
    ? jest
        .spyOn(DockerResourceService, "bulkUpsertContainers")
        .mockResolvedValue(undefined)
    : jest
        .spyOn(PodmanResourceService, "bulkUpsertContainers")
        .mockResolvedValue(undefined);
}

function written(
  spy: jest.SpyInstance,
): Map<string, ParsedDockerContainer | ParsedPodmanContainer> {
  expect(spy).toHaveBeenCalledTimes(1);
  const args: {
    containers: Array<ParsedDockerContainer | ParsedPodmanContainer>;
  } = spy.mock.calls[0]![0];
  const byName: Map<string, ParsedDockerContainer | ParsedPodmanContainer> =
    new Map<string, ParsedDockerContainer | ParsedPodmanContainer>();
  for (const container of args.containers) {
    byName.set(container.containerName, container);
  }
  return byName;
}

function capturedLabels(container: CapturedContainer): JSONObject | null {
  if (container.labels.length === 0) {
    return null;
  }
  const labels: JSONObject = {};
  for (const [key, value] of container.labels) {
    labels[key] = value;
  }
  return labels;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the Docker container snapshot, from the real docker_stats capture", () => {
  test("regression: each container row carries its Compose / Testcontainers labels and its start time", async () => {
    const upsert: jest.SpyInstance = setupIngest("docker");

    await OtelMetricsIngestService.processMetricsFromQueue(
      request(
        CAPTURED_CONTAINERS.map((container: CapturedContainer): JSONObject => {
          return capturedResourceMetrics(container);
        }),
      ),
    );

    const rows: Map<string, ParsedDockerContainer | ParsedPodmanContainer> =
      written(upsert);
    expect(Array.from(rows.keys()).sort()).toEqual(
      CAPTURED_CONTAINERS.map((container: CapturedContainer): string => {
        return container.name;
      }).sort(),
    );

    for (const container of CAPTURED_CONTAINERS) {
      const row: ParsedDockerContainer | ParsedPodmanContainer = rows.get(
        container.name,
      )!;
      expect(row.containerId).toBe(container.id);
      expect(row.imageName).toBe("postgres:16");
      expect(row.state).toBe("running");
      expect(row.observedAt).toEqual(CAPTURE_OBSERVED_AT);
      expect(row.labels ?? null).toEqual(capturedLabels(container));
      expect(row.startedAt).toEqual(capturedStartedAt(container));
      expect(row.cpuPercent).toBeCloseTo(container.cpuUtilization * 100, 10);
      expect(row.memoryBytes).toBe(Number(container.memoryUsageTotal));
    }

    // Started 23:26:39 on the 24th: 1 h 43 min before the scrape, not "just now".
    expect(rows.get("e2e-docker-spans-compose-postgres-1")!.startedAt).toEqual(
      new Date("2026-09-24T23:26:39.057Z"),
    );
  });

  test("only the classifier's label keys become labels — never another resource attribute", async () => {
    const upsert: jest.SpyInstance = setupIngest("docker");
    const block: JSONObject = capturedResourceMetrics(CAPTURED_CONTAINERS[3]!);
    const resource: JSONObject = block["resource"] as JSONObject;
    (resource["attributes"] as Array<JSONObject>).push(
      { key: "com.example.secret", value: { stringValue: "hunter2" } },
      { key: "container.command_line", value: { stringValue: "postgres" } },
    );

    await OtelMetricsIngestService.processMetricsFromQueue(request([block]));

    const row: ParsedDockerContainer | ParsedPodmanContainer = written(
      upsert,
    ).get("e2e-docker-spans-compose-postgres-1")!;
    expect(row.labels).toEqual({
      "com.docker.compose.service": "postgres",
      "com.docker.compose.oneoff": "False",
      "com.docker.compose.project": "e2e-docker-spans-compose",
    });
  });

  test("an agent without the label mapping or container.uptime leaves labels and start time alone", async () => {
    const upsert: jest.SpyInstance = setupIngest("docker");
    const block: JSONObject = capturedResourceMetrics({
      ...CAPTURED_CONTAINERS[3]!,
      labels: [],
    });
    const scope: JSONObject = (block["scopeMetrics"] as Array<JSONObject>)[0]!;
    scope["metrics"] = (scope["metrics"] as Array<JSONObject>).filter(
      (metric: JSONObject): boolean => {
        return metric["name"] !== "container.uptime";
      },
    );

    await OtelMetricsIngestService.processMetricsFromQueue(request([block]));

    const row: ParsedDockerContainer | ParsedPodmanContainer = written(
      upsert,
    ).get("e2e-docker-spans-compose-postgres-1")!;
    expect(row.labels).toBeNull();
    expect(row.startedAt).toBeNull();
    expect(row.cpuPercent).not.toBeNull();
  });
});

describe("the Podman container snapshot", () => {
  test("carries the same labels and start time (Podman's Docker-compatible API)", async () => {
    const upsert: jest.SpyInstance = setupIngest("podman");

    await OtelMetricsIngestService.processMetricsFromQueue(
      request(
        CAPTURED_CONTAINERS.map((container: CapturedContainer): JSONObject => {
          return capturedResourceMetrics(container, "podman");
        }),
      ),
    );

    const rows: Map<string, ParsedDockerContainer | ParsedPodmanContainer> =
      written(upsert);
    for (const container of CAPTURED_CONTAINERS) {
      const row: ParsedDockerContainer | ParsedPodmanContainer = rows.get(
        container.name,
      )!;
      expect(row.labels ?? null).toEqual(capturedLabels(container));
      expect(row.startedAt).toEqual(capturedStartedAt(container));
    }
  });
});

/*
 * The docker_stats receiver block of an agent config, as indented
 * `key: value` lines under `receivers: docker_stats:` — enough to read
 * the maps these tests check without a YAML dependency.
 */
function dockerStatsSection(config: string): Array<string> {
  const lines: Array<string> = config.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trimEnd() === "  docker_stats:";
  });
  expect(start).toBeGreaterThanOrEqual(0);
  const section: Array<string> = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !line.startsWith("    ")) {
      break;
    }
    section.push(line);
  }
  return section;
}

// The `key: value` pairs one indentation level under `name:` in a section.
function mapUnder(
  section: Array<string>,
  name: string,
): Record<string, string> {
  const start: number = section.findIndex((line: string): boolean => {
    return line.trim() === `${name}:`;
  });
  if (start < 0) {
    return {};
  }
  const indent: number = section[start]!.search(/\S/);
  const map: Record<string, string> = {};
  for (const line of section.slice(start + 1)) {
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }
    const lineIndent: number = line.search(/\S/);
    if (lineIndent <= indent) {
      break;
    }
    const match: RegExpMatchArray | null = line
      .trim()
      .match(/^([^:\s]+):\s*(.*)$/);
    if (match && lineIndent === indent + 2) {
      map[match[1]!] = match[2]!.trim();
    }
  }
  return map;
}

describe("the agents copy exactly the labels the classifier reads", () => {
  test.each(["DockerAgent", "PodmanAgent"])(
    "%s maps CONTAINER_CLASSIFIER_LABEL_KEYS onto resource attributes of the same name, and never the command line",
    (agent: string) => {
      const config: string = fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../agents",
          agent,
          "otel-collector-config.yaml",
        ),
        "utf8",
      );
      const section: Array<string> = dockerStatsSection(config);

      const mapping: Record<string, string> = mapUnder(
        section,
        "container_labels_to_metric_labels",
      );
      expect(Object.keys(mapping).sort()).toEqual(
        [...CONTAINER_CLASSIFIER_LABEL_KEYS].sort(),
      );
      for (const [label, attribute] of Object.entries(mapping)) {
        expect(attribute).toBe(label);
      }

      // The start time comes from container.uptime.
      expect(section.join("\n")).toMatch(
        /\n {6}container\.uptime:\n {8}enabled: true/,
      );
      // A command line can carry secrets: it must never be exported.
      expect(section.join("\n")).not.toMatch(
        /container\.command_line:\s*\n\s*enabled:\s*true/,
      );
      expect(mapUnder(section, "resource_attributes")).toEqual({});
    },
  );
});
