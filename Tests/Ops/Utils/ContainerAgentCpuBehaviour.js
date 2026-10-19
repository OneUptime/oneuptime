"use strict";

/**
 * The node half of container-agent-cpu-utilization-behaviour.sh: it builds the
 * collector configs and payloads that script runs, and checks what the
 * collector sent. Kept out of the shell script so it is plain JavaScript, not
 * a quoted string.
 *
 *   synthetic-config <agent> <dir>
 *       <dir>/config.yaml: an OTLP receiver, the agent's CPU and percent
 *       processors exactly as its metrics pipeline runs them, a file exporter
 *       (/out/metrics.json); <dir>/scrape-<n>.json: what docker_stats sends
 *       for two containers over six scrapes; <dir>/empty.json.
 *   check-synthetic <agent> <exported metrics.json>
 *   real-config <agent> <dir> <collection interval>
 *       <dir>/config.yaml: the agent's docker_stats receiver and its whole
 *       metrics pipeline, with a file exporter; prints the receiver's socket
 *       path, where the script mounts the daemon's socket.
 *   check-real <agent> <exported metrics.json> <container name> <percent> <tolerance>
 *   count <exported metrics.json> <metric> [container name]
 *       how many points of the metric came out, of one container if named.
 *
 * Exits non-zero, saying why, when a check fails.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const CPU_PROCESSORS = [
  "transform/cpu-utilization-source",
  "cumulative_to_delta/cpu-utilization",
  "delta_to_rate/cpu-utilization",
  "transform/percent-units",
];

const CPU_METRIC = "container.cpu.utilization";
const CPU_TIME_METRIC = "container.cpu.usage.total";
const MEMORY_PERCENT_METRIC = "container.memory.percent";
const MEMORY_USAGE_METRIC = "container.memory.usage.total";
const MEMORY_LIMIT_METRIC = "container.memory.usage.limit";

const DOCKER_STATS_SCOPE =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/dockerstatsreceiver";

const CPU_DESCRIPTION =
  "CPU used by the container over the collection interval, as a percent of one CPU core (100% is one full core).";

const MEMORY_DESCRIPTION =
  "Memory in use as a percent of the container's memory limit, or of the host's memory when the container has no limit.";

// The receiver's start time, and the first scrape a second later.
const START_NANO = 1700000000000000000n;
const SECOND_NANO = 1000000000n;
const SCRAPE_INTERVAL_SECONDS = 30n;

/*
 * Two containers over six scrapes, 30 seconds apart: the CPU time counter
 * (container.cpu.usage.total, nanoseconds since the container started) and
 * the memory percent docker_stats sends with them.
 *
 * "busy": a quarter of a core, one and a half cores, idle, then a restart
 * (its counter starts again), then 10%. "steady": 10 ms of CPU per second all
 * along -- 1% of a core, the customer's container.
 */
const SCRAPES = {
  busy: [50e9, 57.5e9, 102.5e9, 102.5e9, 1e9, 4e9],
  steady: [5e9, 5.3e9, 5.6e9, 5.9e9, 6.2e9, 6.5e9],
};

const MEMORY_PERCENT = { busy: 4.36, steady: 25.62 };

// What OneUptime must get: "<container> <scrape> <percent>".
const EXPECTED_CPU = [
  "busy 1 25",
  "busy 2 150",
  "busy 3 0",
  // Scrape 4 restarted the counter: nothing.
  "busy 5 10",
  "steady 1 1",
  "steady 2 1",
  "steady 3 1",
  "steady 4 1",
  "steady 5 1",
];

function fail(message) {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}

function readAgentConfig(agent) {
  return yaml.load(
    fs.readFileSync(
      path.join(REPO_ROOT, "agents", agent, "otel-collector-config.yaml"),
      "utf8",
    ),
  );
}

function scrapeTimeNano(index) {
  return (
    START_NANO +
    SECOND_NANO +
    BigInt(index) * SCRAPE_INTERVAL_SECONDS * SECOND_NANO
  ).toString();
}

function stringAttribute(key, value) {
  return { key, value: { stringValue: value } };
}

function scrapePayload(index) {
  const time = scrapeTimeNano(index);
  const start = START_NANO.toString();

  const resourceMetrics = Object.keys(SCRAPES).map((container) => {
    return {
      resource: {
        attributes: [
          stringAttribute("container.runtime", "docker"),
          stringAttribute("container.id", `${container}-id`),
          stringAttribute("container.name", container),
          stringAttribute("container.image.name", "busybox:1.37"),
        ],
      },
      scopeMetrics: [
        {
          scope: { name: DOCKER_STATS_SCOPE, version: "0.161.0" },
          metrics: [
            {
              name: CPU_TIME_METRIC,
              description: "Total CPU time consumed.",
              unit: "ns",
              sum: {
                aggregationTemporality: 2,
                isMonotonic: true,
                dataPoints: [
                  {
                    startTimeUnixNano: start,
                    timeUnixNano: time,
                    asInt: String(SCRAPES[container][index]),
                  },
                ],
              },
            },
            {
              name: MEMORY_PERCENT_METRIC,
              description:
                "Percentage of memory used. Not supported on Windows.",
              unit: "1",
              gauge: {
                dataPoints: [
                  {
                    startTimeUnixNano: start,
                    timeUnixNano: time,
                    asDouble: MEMORY_PERCENT[container],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
  });

  return { resourceMetrics };
}

function pipelineProcessors(config) {
  return config.service.pipelines.metrics.processors;
}

function syntheticConfig(agent, dir) {
  const config = readAgentConfig(agent);
  const runs = pipelineProcessors(config).filter((name) => {
    return CPU_PROCESSORS.includes(name);
  });
  if (runs.join(",") !== CPU_PROCESSORS.join(",")) {
    fail(
      `${agent}: its metrics pipeline runs ${runs.join(", ") || "none"} of ${CPU_PROCESSORS.join(", ")}`,
    );
  }

  const out = {
    receivers: {
      otlp: { protocols: { http: { endpoint: "0.0.0.0:4318" } } },
    },
    processors: Object.fromEntries(
      CPU_PROCESSORS.map((name) => {
        return [name, config.processors[name]];
      }),
    ),
    exporters: { file: { path: "/out/metrics.json" } },
    service: {
      pipelines: {
        metrics: {
          receivers: ["otlp"],
          processors: CPU_PROCESSORS,
          exporters: ["file"],
        },
      },
    },
  };

  fs.writeFileSync(path.join(dir, "config.yaml"), yaml.dump(out));
  for (let index = 0; index < SCRAPES.busy.length; index++) {
    fs.writeFileSync(
      path.join(dir, `scrape-${index}.json`),
      JSON.stringify(scrapePayload(index)),
    );
  }
  fs.writeFileSync(
    path.join(dir, "empty.json"),
    JSON.stringify({ resourceMetrics: [] }),
  );
}

function valueOf(point) {
  if (point.asDouble !== undefined) {
    return Number(point.asDouble);
  }
  return Number(point.asInt);
}

/*
 * Every exported datapoint as { container, metric, unit, type, description,
 * time, start, value, temporality, monotonic }.
 */
function readExported(file) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  // The exporter writes one request per line; a last line without its
  // newline is still being written, and is read next time.
  const lines = text.split("\n");
  lines.pop();
  const points = [];
  for (const line of lines.filter(Boolean)) {
    for (const resourceMetric of JSON.parse(line).resourceMetrics || []) {
      const attributes = {};
      for (const attribute of resourceMetric.resource.attributes || []) {
        attributes[attribute.key] = Object.values(attribute.value)[0];
      }
      for (const scopeMetric of resourceMetric.scopeMetrics || []) {
        for (const metric of scopeMetric.metrics || []) {
          const type = ["gauge", "sum", "histogram", "summary"].find((key) => {
            return metric[key] !== undefined;
          });
          for (const point of metric[type].dataPoints || []) {
            points.push({
              container: attributes["container.name"],
              metric: metric.name,
              unit: metric.unit,
              description: metric.description,
              type,
              time: point.timeUnixNano,
              start: point.startTimeUnixNano,
              value: valueOf(point),
              temporality: metric[type].aggregationTemporality,
              monotonic: metric[type].isMonotonic,
              scope: scopeMetric.scope && scopeMetric.scope.name,
            });
          }
        }
      }
    }
  }
  return points;
}

function scrapeIndexOf(time) {
  const offset = BigInt(time) - START_NANO - SECOND_NANO;
  return Number(offset / (SCRAPE_INTERVAL_SECONDS * SECOND_NANO));
}

function checkSynthetic(agent, exported) {
  const points = readExported(exported);
  const problems = [];

  const cpu = points.filter((point) => {
    return point.metric === CPU_METRIC;
  });
  const got = cpu
    .map((point) => {
      return `${point.container} ${scrapeIndexOf(point.time)} ${Number(point.value.toFixed(6))}`;
    })
    .sort();
  const expected = [...EXPECTED_CPU].sort();

  for (const line of expected) {
    console.log(
      `    ${got.includes(line) ? "ok     " : "MISSING"} ${CPU_METRIC} ${line}`,
    );
  }
  for (const line of got.filter((entry) => {
    return !expected.includes(entry);
  })) {
    console.log(`    EXTRA   ${CPU_METRIC} ${line}`);
  }
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    problems.push(`${CPU_METRIC} came out as [${got.join("; ")}]`);
  }

  for (const point of cpu) {
    if (point.type !== "gauge" || point.unit !== "%") {
      problems.push(
        `${CPU_METRIC} is a ${point.type} in "${point.unit}", not a gauge in "%"`,
      );
    }
    if (point.description !== CPU_DESCRIPTION) {
      problems.push(`${CPU_METRIC} is described "${point.description}"`);
    }
    if (point.scope !== DOCKER_STATS_SCOPE) {
      problems.push(
        `${CPU_METRIC} left the docker_stats scope (${point.scope})`,
      );
    }
    // The interval it covers: the previous scrape to this one.
    const covered = (BigInt(point.time) - BigInt(point.start)) / SECOND_NANO;
    if (covered !== SCRAPE_INTERVAL_SECONDS) {
      problems.push(
        `${CPU_METRIC} at scrape ${scrapeIndexOf(point.time)} covers ${covered} s, not ${SCRAPE_INTERVAL_SECONDS}`,
      );
    }
  }

  // The counter goes on to OneUptime as the receiver sent it.
  const cpuTime = points.filter((point) => {
    return point.metric === CPU_TIME_METRIC;
  });
  const sentCpuTime = Object.keys(SCRAPES).length * SCRAPES.busy.length;
  if (cpuTime.length !== sentCpuTime) {
    problems.push(
      `${CPU_TIME_METRIC}: ${cpuTime.length} points came out of ${sentCpuTime} sent`,
    );
  }
  for (const point of cpuTime) {
    const sent = SCRAPES[point.container][scrapeIndexOf(point.time)];
    if (
      point.type !== "sum" ||
      point.unit !== "ns" ||
      point.temporality !== 2 ||
      point.monotonic !== true ||
      point.value !== sent ||
      point.start !== START_NANO.toString()
    ) {
      problems.push(
        `${CPU_TIME_METRIC} changed: ${JSON.stringify(point)} (sent ${sent})`,
      );
    }
  }

  // Memory percent: the same number, now saying it is a percent.
  const memory = points.filter((point) => {
    return point.metric === MEMORY_PERCENT_METRIC;
  });
  if (memory.length !== sentCpuTime) {
    problems.push(
      `${MEMORY_PERCENT_METRIC}: ${memory.length} points came out of ${sentCpuTime} sent`,
    );
  }
  for (const point of memory) {
    if (
      point.unit !== "%" ||
      point.type !== "gauge" ||
      point.value !== MEMORY_PERCENT[point.container]
    ) {
      problems.push(
        `${MEMORY_PERCENT_METRIC} came out as ${point.value} in "${point.unit}" (${point.type})`,
      );
    }
    if (point.description !== MEMORY_DESCRIPTION) {
      problems.push(
        `${MEMORY_PERCENT_METRIC} is described "${point.description}"`,
      );
    }
  }

  if (problems.length > 0) {
    fail(`${agent}:\n  ${problems.join("\n  ")}`);
  }
  console.log(
    `    ok      ${CPU_TIME_METRIC} and ${MEMORY_PERCENT_METRIC} unchanged but for the "%" unit`,
  );
}

function realConfig(agent, dir, interval) {
  const config = readAgentConfig(agent);
  const pipeline = config.service.pipelines.metrics;
  if (pipeline.receivers.join(",") !== "docker_stats") {
    fail(`${agent}: its metrics pipeline receives ${pipeline.receivers}`);
  }
  const receiver = {
    ...config.receivers.docker_stats,
    collection_interval: interval,
  };

  const out = {
    receivers: { docker_stats: receiver },
    processors: Object.fromEntries(
      pipeline.processors.map((name) => {
        return [name, config.processors[name]];
      }),
    ),
    exporters: { file: { path: "/out/metrics.json" } },
    service: {
      pipelines: {
        metrics: {
          receivers: ["docker_stats"],
          processors: pipeline.processors,
          exporters: ["file"],
        },
      },
    },
  };
  fs.writeFileSync(path.join(dir, "config.yaml"), yaml.dump(out));

  const socket = String(receiver.endpoint).replace("unix://", "");
  if (!socket.startsWith("/")) {
    fail(
      `${agent}: the receiver's endpoint is not a unix socket: ${receiver.endpoint}`,
    );
  }
  process.stdout.write(socket);
}

function checkReal(agent, exported, container, percent, tolerance) {
  const points = readExported(exported).filter((point) => {
    return point.container === container;
  });
  const problems = [];

  const at = (metric) => {
    const byTime = new Map();
    for (const point of points) {
      if (point.metric === metric) {
        byTime.set(point.time, point);
      }
    }
    return byTime;
  };

  const cpu = [...at(CPU_METRIC).values()].sort((a, b) => {
    return BigInt(a.time) < BigInt(b.time) ? -1 : 1;
  });
  const cpuTime = at(CPU_TIME_METRIC);
  const memory = at(MEMORY_PERCENT_METRIC);
  const usage = at(MEMORY_USAGE_METRIC);
  const limit = at(MEMORY_LIMIT_METRIC);

  if (cpu.length < 3) {
    problems.push(`only ${cpu.length} ${CPU_METRIC} points for ${container}`);
  }

  for (const point of cpu) {
    const seconds = Number(BigInt(point.time) - BigInt(point.start)) / 1e9;
    const line = `${CPU_METRIC} ${point.value.toFixed(2)}${point.unit} over ${seconds.toFixed(1)} s`;
    const inRange = Math.abs(point.value - percent) <= tolerance;
    console.log(`    ${inRange ? "ok     " : "OUT    "} ${line}`);
    if (point.unit !== "%" || point.type !== "gauge") {
      problems.push(`${CPU_METRIC} is a ${point.type} in "${point.unit}"`);
    }
    if (!inRange) {
      problems.push(`${line}: not within ${tolerance} of ${percent}%`);
    }

    // The same figure as the rate of the counter between the two scrapes.
    const now = cpuTime.get(point.time);
    const before = cpuTime.get(point.start);
    if (!now || !before) {
      problems.push(
        `no ${CPU_TIME_METRIC} at both ends of the interval ${point.start}..${point.time}`,
      );
      continue;
    }
    const rate = (now.value - before.value) / seconds / 1e7;
    if (Math.abs(rate - point.value) > 0.01) {
      problems.push(
        `${CPU_METRIC} ${point.value} is not the rate of ${CPU_TIME_METRIC} (${rate})`,
      );
    }
  }

  if (memory.size === 0) {
    problems.push(`no ${MEMORY_PERCENT_METRIC} for ${container}`);
  }
  for (const [time, point] of memory) {
    if (point.unit !== "%") {
      problems.push(`${MEMORY_PERCENT_METRIC} is in "${point.unit}", not "%"`);
    }
    const used = usage.get(time);
    const of = limit.get(time);
    if (!used || !of || of.value <= 0) {
      problems.push(
        `no memory usage and limit beside ${MEMORY_PERCENT_METRIC}`,
      );
      continue;
    }
    const expected = (used.value / of.value) * 100;
    if (Math.abs(expected - point.value) > 0.001) {
      problems.push(
        `${MEMORY_PERCENT_METRIC} ${point.value} is not usage / limit * 100 (${expected})`,
      );
    }
  }
  if (memory.size > 0) {
    const [first] = memory.values();
    console.log(
      `    ok      ${MEMORY_PERCENT_METRIC} ${first.value.toFixed(3)}% = memory usage / limit * 100`,
    );
  }

  if (problems.length > 0) {
    fail(`${agent} against the daemon:\n  ${problems.join("\n  ")}`);
  }
}

// How many points of a metric (of one container, when named) were exported.
function count(exported, metric, container) {
  const points = readExported(exported).filter((point) => {
    return (
      point.metric === metric && (!container || point.container === container)
    );
  });
  const keys = new Set(
    points.map((point) => {
      return `${point.container} ${point.time}`;
    }),
  );
  process.stdout.write(String(keys.size));
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "count":
      count(args[0], args[1], args[2]);
      return;
    case "synthetic-config":
      syntheticConfig(args[0], args[1]);
      return;
    case "check-synthetic":
      checkSynthetic(args[0], args[1]);
      return;
    case "real-config":
      realConfig(args[0], args[1], args[2]);
      return;
    case "check-real":
      checkReal(args[0], args[1], args[2], Number(args[3]), Number(args[4]));
      return;
    default:
      fail(`unknown command: ${command}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  CPU_PROCESSORS,
  EXPECTED_CPU,
  SCRAPES,
  readExported,
  scrapePayload,
};
