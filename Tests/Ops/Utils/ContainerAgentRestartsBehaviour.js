"use strict";

/**
 * The node half of container-agent-restarts-behaviour.sh: it builds the
 * collector configs and payloads that script runs, and checks what the
 * collector sent. Kept out of the shell script so it is plain JavaScript,
 * and its checks are plain functions ContainerAgentRestarts.test.js runs.
 *
 *   synthetic-config <agent> <dir>
 *       <dir>/config.yaml: an OTLP receiver, the agent's restart processors
 *       exactly as its metrics pipeline runs them, a file exporter
 *       (/out/metrics.json); <dir>/scrape-<n>.json: what docker_stats sends
 *       for two containers over seven samples; <dir>/empty.json.
 *   check-synthetic <agent> <exported metrics.json>
 *   ready-real <exported metrics.json> <container name>
 *       prints "yes" once the export holds what check-real needs: the
 *       container's count grown by MIN_REAL_GROWTH, and a sample taken
 *       while Docker was restarting it.
 *   check-real <agent> <exported metrics.json> <container name>
 *
 * The real-daemon config comes from ContainerAgentCpuBehaviour.js
 * (real-config): the agent's docker_stats receiver and its whole metrics
 * pipeline, with a file exporter.
 *
 * Exits non-zero, saying why, when a check fails.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { readExported } = require("./ContainerAgentCpuBehaviour");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const RESTART_PROCESSORS = [
  "transform/restarts-increase-source",
  "cumulative_to_delta/restarts-increase",
];

const RESTARTS_METRIC = "container.restarts";
const INCREASE_METRIC = "container.restarts.increase";
const MEMORY_LIMIT_METRIC = "container.memory.usage.limit";

const RESTARTS_UNIT = "{restarts}";

const INCREASE_DESCRIPTION =
  "Times the container restarted since the agent's previous sample of it.";

const DOCKER_STATS_SCOPE =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/dockerstatsreceiver";

// OTLP's aggregation temporalities.
const DELTA = 1;
const CUMULATIVE = 2;

// The receiver's start time, and the samples' offsets from a second after it.
const START_NANO = 1700000000000000000n;
const SECOND_NANO = 1000000000n;

/*
 * When each of the seven samples is taken, in seconds after the first: the
 * first three 30 seconds apart, then a gap of five minutes, two more 30
 * seconds apart, and one an hour later. The processor compares a sample
 * with the one before whatever lies between them.
 */
const SAMPLE_SECONDS = [0, 30, 60, 360, 390, 420, 4020];

/*
 * The restart count docker_stats reads at each sample.
 *
 * "looping": 3 when the agent first sees it; unchanged; 2 more; 4 more
 * across the five-minute gap; restarted by hand (Docker and Podman start
 * the count again at 0); 1 more; 3 more across the hour.
 * "steady": 12 restarts long ago, none since.
 */
const SCRAPES = {
  looping: [3, 3, 5, 9, 0, 1, 4],
  steady: [12, 12, 12, 12, 12, 12, 12],
};

/*
 * What a container's restart counts become, sample by sample: nothing for
 * the first, nothing for one whose count went down, else the count minus
 * the previous sample's - as the agent's cumulative_to_delta, with
 * initial_value: drop, makes them.
 */
function restartIncreasesFrom(counts) {
  const out = [];
  for (let index = 1; index < counts.length; index++) {
    const value = counts[index];
    const previous = counts[index - 1];
    if (value >= previous) {
      out.push({ sample: index, increase: value - previous });
    }
  }
  return out;
}

// What OneUptime must get: "<container> <sample> <increase>".
const EXPECTED_INCREASES = [
  "looping 1 0",
  "looping 2 2",
  "looping 3 4",
  // Sample 4: restarted by hand, the count went down: nothing.
  "looping 5 1",
  "looping 6 3",
  "steady 1 0",
  "steady 2 0",
  "steady 3 0",
  "steady 4 0",
  "steady 5 0",
  "steady 6 0",
];

// The growth check-real waits for: a restart loop, not one restart.
const MIN_REAL_GROWTH = 4;

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

function sampleTimeNano(index) {
  return (
    START_NANO +
    SECOND_NANO +
    BigInt(SAMPLE_SECONDS[index]) * SECOND_NANO
  ).toString();
}

function sampleIndexOf(time) {
  const seconds = Number(
    (BigInt(time) - START_NANO - SECOND_NANO) / SECOND_NANO,
  );
  return SAMPLE_SECONDS.indexOf(seconds);
}

function stringAttribute(key, value) {
  return { key, value: { stringValue: value } };
}

function scrapePayload(index) {
  const time = sampleTimeNano(index);
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
              name: RESTARTS_METRIC,
              description: "Number of restarts for the container.",
              unit: RESTARTS_UNIT,
              sum: {
                aggregationTemporality: CUMULATIVE,
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
          ],
        },
      ],
    };
  });

  return { resourceMetrics };
}

function syntheticConfig(agent, dir) {
  const config = readAgentConfig(agent);
  const runs = config.service.pipelines.metrics.processors.filter((name) => {
    return RESTART_PROCESSORS.includes(name);
  });
  if (runs.join(",") !== RESTART_PROCESSORS.join(",")) {
    fail(
      `${agent}: its metrics pipeline runs ${runs.join(", ") || "none"} of ${RESTART_PROCESSORS.join(", ")}`,
    );
  }

  const out = {
    receivers: {
      otlp: { protocols: { http: { endpoint: "0.0.0.0:4318" } } },
    },
    processors: Object.fromEntries(
      RESTART_PROCESSORS.map((name) => {
        return [name, config.processors[name]];
      }),
    ),
    exporters: { file: { path: "/out/metrics.json" } },
    service: {
      pipelines: {
        metrics: {
          receivers: ["otlp"],
          processors: RESTART_PROCESSORS,
          exporters: ["file"],
        },
      },
    },
  };

  fs.writeFileSync(path.join(dir, "config.yaml"), yaml.dump(out));
  for (let index = 0; index < SAMPLE_SECONDS.length; index++) {
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

/*
 * What is wrong with the points the collector exported for the synthetic
 * samples, as a list of sentences; empty when nothing is.
 */
function syntheticProblems(points) {
  const problems = [];

  const increases = points.filter((point) => {
    return point.metric === INCREASE_METRIC;
  });
  const got = increases
    .map((point) => {
      return `${point.container} ${sampleIndexOf(point.time)} ${point.value}`;
    })
    .sort();
  const expected = [...EXPECTED_INCREASES].sort();

  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    problems.push(`${INCREASE_METRIC} came out as [${got.join("; ")}]`);
  }

  for (const point of increases) {
    const at = `${point.container} sample ${sampleIndexOf(point.time)}`;
    if (
      point.type !== "sum" ||
      point.temporality !== DELTA ||
      point.monotonic !== true
    ) {
      problems.push(
        `${INCREASE_METRIC} at ${at} is a ${point.type} (temporality ${point.temporality}, monotonic ${point.monotonic}), not a monotonic delta sum`,
      );
    }
    if (point.unit !== RESTARTS_UNIT) {
      problems.push(`${INCREASE_METRIC} at ${at} is in "${point.unit}"`);
    }
    if (point.description !== INCREASE_DESCRIPTION) {
      problems.push(
        `${INCREASE_METRIC} at ${at} is described "${point.description}"`,
      );
    }
    if (point.scope !== DOCKER_STATS_SCOPE) {
      problems.push(
        `${INCREASE_METRIC} at ${at} left the docker_stats scope (${point.scope})`,
      );
    }
    // It covers the time since the previous sample, however long that was.
    const index = sampleIndexOf(point.time);
    if (index > 0 && point.start !== sampleTimeNano(index - 1)) {
      problems.push(
        `${INCREASE_METRIC} at ${at} starts at ${point.start}, not at the previous sample (${sampleTimeNano(index - 1)})`,
      );
    }
  }

  // The lifetime count goes on to OneUptime as the receiver sent it.
  const counts = points.filter((point) => {
    return point.metric === RESTARTS_METRIC;
  });
  const sent = Object.keys(SCRAPES).length * SAMPLE_SECONDS.length;
  if (counts.length !== sent) {
    problems.push(
      `${RESTARTS_METRIC}: ${counts.length} points came out of ${sent} sent`,
    );
  }
  for (const point of counts) {
    const index = sampleIndexOf(point.time);
    const value = SCRAPES[point.container]
      ? SCRAPES[point.container][index]
      : undefined;
    if (
      point.type !== "sum" ||
      point.temporality !== CUMULATIVE ||
      point.monotonic !== true ||
      point.unit !== RESTARTS_UNIT ||
      point.value !== value ||
      point.start !== START_NANO.toString()
    ) {
      problems.push(
        `${RESTARTS_METRIC} changed: ${JSON.stringify(point)} (sent ${value})`,
      );
    }
  }

  return problems;
}

function checkSynthetic(agent, exported) {
  const points = readExported(exported);
  const got = points
    .filter((point) => {
      return point.metric === INCREASE_METRIC;
    })
    .map((point) => {
      return `${point.container} ${sampleIndexOf(point.time)} ${point.value}`;
    });

  for (const line of EXPECTED_INCREASES) {
    console.log(
      `    ${got.includes(line) ? "ok     " : "MISSING"} ${INCREASE_METRIC} ${line}`,
    );
  }
  for (const line of got.filter((entry) => {
    return !EXPECTED_INCREASES.includes(entry);
  })) {
    console.log(`    EXTRA   ${INCREASE_METRIC} ${line}`);
  }

  const problems = syntheticProblems(points);
  if (problems.length > 0) {
    fail(`${agent}:\n  ${problems.join("\n  ")}`);
  }
  console.log(
    `    ok      ${RESTARTS_METRIC} unchanged; ${INCREASE_METRIC} a delta sum in "${RESTARTS_UNIT}", each covering the time since the previous sample`,
  );
}

function byTime(points, metric) {
  return points
    .filter((point) => {
      return point.metric === metric;
    })
    .sort((a, b) => {
      return BigInt(a.time) < BigInt(b.time) ? -1 : 1;
    });
}

/*
 * What a real daemon's export of one container in a restart loop says:
 * its count's growth over the export, the increases sent, and how many of
 * its samples were taken while Docker was restarting it (Docker answers a
 * stats request for such a container with empty stats, whose memory limit
 * is 0).
 */
function realSummary(points, container) {
  const mine = points.filter((point) => {
    return point.container === container;
  });
  const counts = byTime(mine, RESTARTS_METRIC);
  const increases = byTime(mine, INCREASE_METRIC);
  const restartingSamples = byTime(mine, MEMORY_LIMIT_METRIC).filter(
    (point) => {
      return point.value === 0;
    },
  ).length;

  return {
    counts,
    increases,
    growth:
      counts.length > 0 ? counts[counts.length - 1].value - counts[0].value : 0,
    sentIncrease: increases.reduce((total, point) => {
      return total + point.value;
    }, 0),
    restartingSamples,
  };
}

function realProblems(points, container) {
  const summary = realSummary(points, container);
  const problems = [];

  if (summary.counts.length < 3) {
    problems.push(
      `only ${summary.counts.length} ${RESTARTS_METRIC} samples of ${container}`,
    );
  }
  if (summary.growth < MIN_REAL_GROWTH) {
    problems.push(
      `${container}'s ${RESTARTS_METRIC} grew by ${summary.growth}, not by ${MIN_REAL_GROWTH} or more`,
    );
  }

  /*
   * Every restart between the first sample and the last is in the
   * increases, exactly once: the counts only ever grew here (nothing
   * restarted the container by hand), so no sample was dropped.
   */
  if (summary.sentIncrease !== summary.growth) {
    problems.push(
      `${INCREASE_METRIC} adds up to ${summary.sentIncrease}, but ${container}'s count grew by ${summary.growth}`,
    );
  }
  if (summary.increases.length !== Math.max(summary.counts.length - 1, 0)) {
    problems.push(
      `${summary.increases.length} ${INCREASE_METRIC} points for ${summary.counts.length} samples: every sample but the first sends one`,
    );
  }
  for (const point of summary.increases) {
    if (
      point.type !== "sum" ||
      point.temporality !== DELTA ||
      point.unit !== RESTARTS_UNIT ||
      point.description !== INCREASE_DESCRIPTION
    ) {
      problems.push(`${INCREASE_METRIC} came out as ${JSON.stringify(point)}`);
      break;
    }
  }

  // The receiver kept sampling the container between its runs.
  if (summary.restartingSamples === 0) {
    problems.push(
      `no sample of ${container} was taken while Docker was restarting it (none with ${MEMORY_LIMIT_METRIC} 0)`,
    );
  }

  return problems;
}

function readyReal(exported, container) {
  const summary = realSummary(readExported(exported), container);
  process.stdout.write(
    summary.growth >= MIN_REAL_GROWTH && summary.restartingSamples > 0
      ? "yes"
      : "no",
  );
}

function checkReal(agent, exported, container) {
  const points = readExported(exported);
  const summary = realSummary(points, container);

  console.log(
    `    ${RESTARTS_METRIC} of ${container}: ${summary.counts
      .map((point) => {
        return point.value;
      })
      .join(", ")}`,
  );
  console.log(
    `    ${INCREASE_METRIC}: ${summary.increases
      .map((point) => {
        return point.value;
      })
      .join(", ")} (sum ${summary.sentIncrease}, growth ${summary.growth})`,
  );
  console.log(
    `    samples taken while Docker was restarting it: ${summary.restartingSamples}`,
  );

  const problems = realProblems(points, container);
  if (problems.length > 0) {
    fail(`${agent} against the daemon:\n  ${problems.join("\n  ")}`);
  }
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "synthetic-config":
      syntheticConfig(args[0], args[1]);
      return;
    case "check-synthetic":
      checkSynthetic(args[0], args[1]);
      return;
    case "ready-real":
      readyReal(args[0], args[1]);
      return;
    case "check-real":
      checkReal(args[0], args[1], args[2]);
      return;
    default:
      fail(`unknown command: ${command}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  CUMULATIVE,
  DELTA,
  DOCKER_STATS_SCOPE,
  EXPECTED_INCREASES,
  INCREASE_DESCRIPTION,
  INCREASE_METRIC,
  MEMORY_LIMIT_METRIC,
  MIN_REAL_GROWTH,
  RESTARTS_METRIC,
  RESTARTS_UNIT,
  RESTART_PROCESSORS,
  SAMPLE_SECONDS,
  SCRAPES,
  START_NANO,
  realProblems,
  restartIncreasesFrom,
  sampleTimeNano,
  scrapePayload,
  syntheticProblems,
};
