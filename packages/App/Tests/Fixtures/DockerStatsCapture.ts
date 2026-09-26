import { JSONArray, JSONObject } from "Common/Types/JSON";

/*
 * A REAL docker_stats capture: otel/opentelemetry-collector-contrib:0.161.0
 * running the Docker agent's own docker_stats receiver block
 * (agents/DockerAgent/otel-collector-config.yaml, container_labels_to_
 * metric_labels included) against the end-to-end run's daemon, exported
 * with the file exporter. Five postgres:16 containers, as the verification
 * left them:
 *
 *   - e2e-docker-spans-compose-postgres-1 / -2: one Compose service
 *     (`docker compose up --scale postgres=2`);
 *   - e2e-docker-spans-compose-oneoff: `docker compose run` (oneoff=True);
 *   - e2e-docker-spans-tc-pg: a Testcontainers container;
 *   - e2e-docker-spans-pg-2: a plain `docker run`, no labels.
 *
 * Every attribute (order included), unit and value is as captured; only
 * the metrics the snapshot path reads (plus container.restarts, which it
 * must ignore) are kept. Before the fix the agent sent none of the labels,
 * the ingest wrote no labels and no creation time, and each of the five
 * became its own database.
 */

export interface CapturedContainer {
  name: string;
  id: string;
  hostname: string;
  image: string;
  // The container labels, in the order the receiver emitted them.
  labels: Array<[string, string]>;
  cpuUtilization: number;
  memoryUsageTotal: string;
  uptimeSeconds: number;
}

// 2026-09-25T01:10:20.523Z, one scrape for all five.
export const CAPTURE_TIME_UNIX_NANO: string = "1790298620523629320";
export const CAPTURE_START_TIME_UNIX_NANO: string = "1790298619425530943";
export const CAPTURE_OBSERVED_AT: Date = new Date(1790298620523);
export const CAPTURE_HOST_NAME: string = "probe-host";

export const CAPTURED_CONTAINERS: Array<CapturedContainer> = [
  {
    name: "e2e-docker-spans-compose-postgres-2",
    id: "bf32d18b5a0a30e96bac6b726df561963840e3329174b387d1b822ae6796ea35",
    hostname: "bf32d18b5a0a",
    image: "postgres:16",
    labels: [
      ["com.docker.compose.service", "postgres"],
      ["com.docker.compose.oneoff", "False"],
      ["com.docker.compose.project", "e2e-docker-spans-compose"],
    ],
    cpuUtilization: 0.005351656502145266,
    memoryUsageTotal: "24342528",
    uptimeSeconds: 6221.595296978,
  },
  {
    name: "e2e-docker-spans-tc-pg",
    id: "f7c01bbfb85421e308df235a74bca2d206559b3e093ef85eff8216d11f6c61d8",
    hostname: "f7c01bbfb854",
    image: "postgres:16",
    labels: [
      ["org.testcontainers.sessionId", "5c1f0a54-e2e0-4d7b-9f35-2c9b7cbb0e11"],
      ["org.testcontainers", "true"],
    ],
    cpuUtilization: 0.003536756958639884,
    memoryUsageTotal: "24109056",
    uptimeSeconds: 6220.72516492,
  },
  {
    name: "e2e-docker-spans-compose-oneoff",
    id: "20c2a26f4fb4c7fac70b652a47c11fc0123ac36fd03330890f162379bfa9cc3d",
    hostname: "20c2a26f4fb4",
    image: "postgres:16",
    labels: [
      ["com.docker.compose.service", "postgres"],
      ["com.docker.compose.oneoff", "True"],
      ["com.docker.compose.project", "e2e-docker-spans-compose"],
    ],
    cpuUtilization: 0.0035405866303041453,
    memoryUsageTotal: "24068096",
    uptimeSeconds: 6220.315137091,
  },
  {
    name: "e2e-docker-spans-compose-postgres-1",
    id: "1b09d4df414d90f1c3afc18ed6076e56d0f27e8b18cca4c18e1776ae7e8ad107",
    hostname: "1b09d4df414d",
    image: "postgres:16",
    labels: [
      ["com.docker.compose.service", "postgres"],
      ["com.docker.compose.oneoff", "False"],
      ["com.docker.compose.project", "e2e-docker-spans-compose"],
    ],
    cpuUtilization: 0.005343887131549871,
    memoryUsageTotal: "24289280",
    uptimeSeconds: 6221.466024677,
  },
  {
    name: "e2e-docker-spans-pg-2",
    id: "dde8ff1adfdc086759c7b2484e59e46eb4cd33461843b6cc8c0ddb26adde4254",
    hostname: "dde8ff1adfdc",
    image: "postgres:16",
    labels: [],
    cpuUtilization: 0.0036074331947088104,
    memoryUsageTotal: "24113152",
    uptimeSeconds: 6221.217630502,
  },
];

function stringAttributes(values: Array<[string, string]>): JSONArray {
  return values.map(([key, value]: [string, string]): JSONObject => {
    return { key, value: { stringValue: value } };
  });
}

function dataPoint(value: JSONObject): JSONObject {
  return {
    startTimeUnixNano: CAPTURE_START_TIME_UNIX_NANO,
    timeUnixNano: CAPTURE_TIME_UNIX_NANO,
    ...value,
  };
}

// One ResourceMetrics block exactly as the receiver emitted it for a container.
export function capturedResourceMetrics(
  container: CapturedContainer,
  runtime: "docker" | "podman" = "docker",
): JSONObject {
  return {
    resource: {
      attributes: stringAttributes([
        ["container.runtime", runtime],
        ["container.hostname", container.hostname],
        ["container.id", container.id],
        ["container.image.name", container.image],
        ["container.name", container.name],
        ...container.labels,
        ["host.name", CAPTURE_HOST_NAME],
        ["oneuptime.agent.version", "probe"],
      ]),
    },
    scopeMetrics: [
      {
        scope: {
          name: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/dockerstatsreceiver",
          version: "0.161.0",
        },
        metrics: [
          {
            name: "container.cpu.utilization",
            description: "Percent of CPU used by the container.",
            unit: "1",
            gauge: {
              dataPoints: [dataPoint({ asDouble: container.cpuUtilization })],
            },
          },
          {
            name: "container.memory.usage.total",
            description:
              "Memory usage of the container. This excludes the cache.",
            unit: "By",
            sum: {
              dataPoints: [dataPoint({ asInt: container.memoryUsageTotal })],
              aggregationTemporality: 2,
            },
          },
          {
            name: "container.restarts",
            description: "Number of restarts for the container.",
            unit: "{restarts}",
            sum: {
              dataPoints: [dataPoint({ asInt: "0" })],
              aggregationTemporality: 2,
              isMonotonic: true,
            },
          },
          {
            name: "container.uptime",
            description: "Time elapsed since container start time.",
            unit: "s",
            gauge: {
              dataPoints: [dataPoint({ asDouble: container.uptimeSeconds })],
            },
          },
        ],
      },
    ],
  };
}

// When the container's current run started: the scrape time minus its uptime.
export function capturedStartedAt(container: CapturedContainer): Date {
  return new Date(
    Math.round(CAPTURE_OBSERVED_AT.getTime() - container.uptimeSeconds * 1000),
  );
}
