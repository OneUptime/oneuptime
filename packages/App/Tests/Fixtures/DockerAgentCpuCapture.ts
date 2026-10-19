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
 * every 10 s; the agent ships 30 s), taken after the first scrape, whose CPU
 * percent the agent drops for want of a reading before it. Every attribute
 * (order included), unit, description, time and value is as captured; only
 * the metrics the ingest reads for container CPU and memory are kept, in the
 * captured order.
 *
 * Containers held the same way under the agent as it was (the receiver's own
 * CPU percent, a one-shot sample divided by the host's CPU since boot) read
 * about 0.014 - see Tests/Ops/ContainerAgentCpuUtilization.test.js.
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
export const CPU_CAPTURE_START_TIME_UNIX_NANO: string = "1792453592225305292";
export const CPU_CAPTURE_HOST_NAME: string = "e2e-final";

export const QUARTER_CORE_CONTAINER: string =
  "docker-agent-percent-metrics-load";
export const ONE_AND_A_HALF_CORE_CONTAINER: string =
  "docker-agent-percent-metrics-load2";

const QUARTER_CORE_ID: string =
  "3b06726174847e494e5d772983a7fac5022e4eea08b8b2655680a3de7da78610";
const ONE_AND_A_HALF_CORE_ID: string =
  "14b359f85bebc21eb575c032f3758630aca433c114b96c0b088a5f1ba4fe22ae";

export const CPU_CAPTURE_SCRAPES: Array<CapturedScrape> = [
  {
    timeUnixNano: "1792453603274632013",
    containers: [
      {
        name: QUARTER_CORE_CONTAINER,
        id: QUARTER_CORE_ID,
        hostname: "3b0672617484",
        image: "busybox:latest",
        cpuUsageTotalNanoseconds: "2918734000",
        cpuUtilizationStartTimeUnixNano: "1792453593274135376",
        cpuUtilizationPercent: 24.99419869561424,
        memoryPercent: 0.701904296875,
        memoryUsageLimitBytes: "67108864",
        memoryUsageTotalBytes: "471040",
        uptimeSeconds: 11.597839111,
      },
      {
        name: ONE_AND_A_HALF_CORE_CONTAINER,
        id: ONE_AND_A_HALF_CORE_ID,
        hostname: "14b359f85beb",
        image: "busybox:latest",
        cpuUsageTotalNanoseconds: "17043071000",
        cpuUtilizationStartTimeUnixNano: "1792453593274135376",
        cpuUtilizationPercent: 149.9709818861469,
        memoryPercent: 25.531005859375,
        memoryUsageLimitBytes: "134217728",
        memoryUsageTotalBytes: "34267136",
        uptimeSeconds: 11.426517626,
      },
    ],
  },
  {
    timeUnixNano: "1792453613274083960",
    containers: [
      {
        name: QUARTER_CORE_CONTAINER,
        id: QUARTER_CORE_ID,
        hostname: "3b0672617484",
        image: "busybox:latest",
        cpuUsageTotalNanoseconds: "5419096000",
        cpuUtilizationStartTimeUnixNano: "1792453603274632013",
        cpuUtilizationPercent: 25.004990406000697,
        memoryPercent: 0.701904296875,
        memoryUsageLimitBytes: "67108864",
        memoryUsageTotalBytes: "471040",
        uptimeSeconds: 21.597291058,
      },
      {
        name: ONE_AND_A_HALF_CORE_CONTAINER,
        id: ONE_AND_A_HALF_CORE_ID,
        hostname: "14b359f85beb",
        image: "busybox:latest",
        cpuUsageTotalNanoseconds: "32039558000",
        cpuUtilizationStartTimeUnixNano: "1792453603274632013",
        cpuUtilizationPercent: 149.9730893201521,
        memoryPercent: 25.531005859375,
        memoryUsageLimitBytes: "134217728",
        memoryUsageTotalBytes: "34267136",
        uptimeSeconds: 21.425969573,
      },
    ],
  },
];

export const CPU_CAPTURE_DESCRIPTION: string =
  "CPU used over each collection interval, where 100% is one full CPU core.";

export const MEMORY_CAPTURE_DESCRIPTION: string =
  "Memory in use as a percent of the container's limit, or of host memory if it has none.";

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
            description: MEMORY_CAPTURE_DESCRIPTION,
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
    schemaUrl: "https://opentelemetry.io/schemas/1.40.0",
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
