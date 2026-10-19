import { JSONArray, JSONObject } from "Common/Types/JSON";

/*
 * A REAL capture of what the FIXED Docker agent sends: the metrics pipeline of
 * agents/DockerAgent/otel-collector-config.yaml (docker_stats with its own CPU
 * percent off, then transform/cpu-utilization-source,
 * cumulative_to_delta/cpu-utilization, delta_to_rate/cpu-utilization and
 * transform/percent-units) in otel/opentelemetry-collector-contrib:0.161.0,
 * against a Docker 29.8.1 daemon, exported with the file exporter. Two
 * busybox containers in a busy loop, held by their CPU quota:
 *
 *   - docker-agent-percent-metrics-load:  `--cpus=0.25 --memory=64m`;
 *   - docker-agent-percent-metrics-load2: `--cpus=1.5 --memory=128m`, with
 *     32 MB written to /dev/shm.
 *
 * Two consecutive scrapes, 10 seconds apart (the capture ran the receiver
 * every 10 s; the agent ships 30 s). Every attribute (order included), unit,
 * description, time and value is as captured; only the metrics the ingest
 * reads for container CPU and memory are kept, in the captured order.
 *
 * The same containers under the agent as it was (the receiver's own CPU
 * percent, a one-shot sample divided by the host's CPU since boot) read
 * 0.0140 and 0.0141 - see Tests/Ops/ContainerAgentCpuUtilization.test.js.
 */

export interface CapturedScrapeContainer {
  name: string;
  id: string;
  hostname: string;
  image: string;
  cpuUsageTotalNanoseconds: string;
  // container.cpu.utilization, its start (the previous scrape) and value.
  cpuUtilizationStartTimeUnixNano: string;
  cpuUtilizationPercent: number;
  memoryPercent: number;
  memoryUsageLimitBytes: string;
  memoryUsageTotalBytes: string;
  uptimeSeconds: number;
}

export interface CapturedScrape {
  timeUnixNano: string;
  containers: Array<CapturedScrapeContainer>;
}

// When the receiver started: the start time of every cumulative sum.
export const CPU_CAPTURE_START_TIME_UNIX_NANO: string = "1792446611771357491";
export const CPU_CAPTURE_HOST_NAME: string = "e2e-after";

export const QUARTER_CORE_CONTAINER: string =
  "docker-agent-percent-metrics-load";
export const ONE_AND_A_HALF_CORE_CONTAINER: string =
  "docker-agent-percent-metrics-load2";

const QUARTER_CORE_ID: string =
  "a6b9dae22f8e9fefa2362aa3ac0805e37e3c080b8e50fcd089a514fa364574b4";
const ONE_AND_A_HALF_CORE_ID: string =
  "c1733735124f2e78a30ee39bfb948dedbc398e520ae7865a8a71a3dec2836364";

export const CPU_CAPTURE_SCRAPES: Array<CapturedScrape> = [
  {
    timeUnixNano: "1792446622881284451",
    containers: [
      {
        name: QUARTER_CORE_CONTAINER,
        id: QUARTER_CORE_ID,
        hostname: "a6b9dae22f8e",
        image: "busybox:latest",
        cpuUsageTotalNanoseconds: "373190110000",
        cpuUtilizationStartTimeUnixNano: "1792446612881237815",
        cpuUtilizationPercent: 24.99738342220267,
        memoryPercent: 0.69580078125,
        memoryUsageLimitBytes: "67108864",
        memoryUsageTotalBytes: "466944",
        uptimeSeconds: 1492.760055726,
      },
      {
        name: ONE_AND_A_HALF_CORE_CONTAINER,
        id: ONE_AND_A_HALF_CORE_ID,
        hostname: "c1733735124f",
        image: "busybox:latest",
        cpuUsageTotalNanoseconds: "237049111000",
        cpuUtilizationStartTimeUnixNano: "1792446612881237815",
        cpuUtilizationPercent: 149.99626047743965,
        memoryPercent: 25.6195068359375,
        memoryUsageLimitBytes: "134217728",
        memoryUsageTotalBytes: "34385920",
        uptimeSeconds: 158.130655012,
      },
    ],
  },
  {
    timeUnixNano: "1792446632882217275",
    containers: [
      {
        name: QUARTER_CORE_CONTAINER,
        id: QUARTER_CORE_ID,
        hostname: "a6b9dae22f8e",
        image: "busybox:latest",
        cpuUsageTotalNanoseconds: "375690042000",
        cpuUtilizationStartTimeUnixNano: "1792446622881284451",
        cpuUtilizationPercent: 24.99698822094598,
        memoryPercent: 0.69580078125,
        memoryUsageLimitBytes: "67108864",
        memoryUsageTotalBytes: "466944",
        uptimeSeconds: 1502.76098855,
      },
      {
        name: ONE_AND_A_HALF_CORE_CONTAINER,
        id: ONE_AND_A_HALF_CORE_ID,
        hostname: "c1733735124f",
        image: "busybox:latest",
        cpuUsageTotalNanoseconds: "252050510000",
        cpuUtilizationStartTimeUnixNano: "1792446622881284451",
        cpuUtilizationPercent: 149.99999764022013,
        memoryPercent: 25.6195068359375,
        memoryUsageLimitBytes: "134217728",
        memoryUsageTotalBytes: "34385920",
        uptimeSeconds: 168.131587836,
      },
    ],
  },
];

export const CPU_CAPTURE_DESCRIPTION: string =
  "CPU used by the container over the collection interval, as a percent of one CPU core (100% is one full core).";

function stringAttributes(values: Array<[string, string]>): JSONArray {
  return values.map(([key, value]: [string, string]): JSONObject => {
    return { key, value: { stringValue: value } };
  });
}

function point(timeUnixNano: string, value: JSONObject): JSONObject {
  return {
    startTimeUnixNano: CPU_CAPTURE_START_TIME_UNIX_NANO,
    timeUnixNano: timeUnixNano,
    ...value,
  };
}

/*
 * One container's ResourceMetrics block of one scrape, exactly as the agent
 * sent it.
 */
export function capturedAgentResourceMetrics(
  scrape: CapturedScrape,
  container: CapturedScrapeContainer,
  runtime: "docker" | "podman" = "docker",
): JSONObject {
  const time: string = scrape.timeUnixNano;
  return {
    resource: {
      attributes: stringAttributes([
        ["container.runtime", runtime],
        ["container.hostname", container.hostname],
        ["container.id", container.id],
        ["container.image.name", container.image],
        ["container.name", container.name],
        ["host.name", CPU_CAPTURE_HOST_NAME],
        ["os.type", "linux"],
        ["oneuptime.agent.version", "branch"],
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
            name: "container.cpu.usage.total",
            description: "Total CPU time consumed.",
            unit: "ns",
            sum: {
              dataPoints: [
                point(time, { asInt: container.cpuUsageTotalNanoseconds }),
              ],
              aggregationTemporality: 2,
              isMonotonic: true,
            },
          },
          {
            name: "container.memory.percent",
            description: "Percentage of memory used. Not supported on Windows.",
            unit: "%",
            gauge: {
              dataPoints: [point(time, { asDouble: container.memoryPercent })],
            },
          },
          {
            name: "container.memory.usage.limit",
            description:
              "Memory limit of the container. Not supported on Windows.",
            unit: "By",
            sum: {
              dataPoints: [
                point(time, { asInt: container.memoryUsageLimitBytes }),
              ],
              aggregationTemporality: 2,
            },
          },
          {
            name: "container.memory.usage.total",
            description:
              "Memory usage of the container. This excludes the cache.",
            unit: "By",
            sum: {
              dataPoints: [
                point(time, { asInt: container.memoryUsageTotalBytes }),
              ],
              aggregationTemporality: 2,
            },
          },
          {
            name: "container.uptime",
            description: "Time elapsed since container start time.",
            unit: "s",
            gauge: {
              dataPoints: [point(time, { asDouble: container.uptimeSeconds })],
            },
          },
          {
            name: "container.cpu.utilization",
            description: CPU_CAPTURE_DESCRIPTION,
            unit: "%",
            gauge: {
              dataPoints: [
                {
                  startTimeUnixNano: container.cpuUtilizationStartTimeUnixNano,
                  timeUnixNano: time,
                  asDouble: container.cpuUtilizationPercent,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

// The same scrape's container, by name.
export function capturedScrapeContainer(
  scrape: CapturedScrape,
  name: string,
): CapturedScrapeContainer {
  const container: CapturedScrapeContainer | undefined = scrape.containers.find(
    (candidate: CapturedScrapeContainer): boolean => {
      return candidate.name === name;
    },
  );
  if (!container) {
    throw new Error(`no ${name} in the scrape at ${scrape.timeUnixNano}`);
  }
  return container;
}
