"use strict";

/**
 * Container CPU and memory percent, as the Docker, Podman and Docker Swarm
 * agents send them.
 *
 * All three run the collector's docker_stats receiver. Its own
 * container.cpu.utilization is computed from ONE stats sample: since
 * collector 0.150.0 its Docker client asks the daemon for a one-shot sample,
 * which carries no previous reading (and Podman's Docker-compatible API never
 * sends one), so the receiver divides all the CPU a container used since it
 * started by all the CPU the host used since it booted. On a real Docker
 * 29.8.1 daemon with collector 0.161.0, a container held to a quarter of a
 * core read 0.014 while its container.cpu.usage.total rose 25% of a core per
 * second: a flat line near zero that never follows the load, which is what
 * a customer saw (0.07% on one host, 7.17% on another, for the same 1%
 * container).
 *
 * So the agents turn the receiver's figure off and build
 * container.cpu.utilization from container.cpu.usage.total in four
 * processors: copy, cumulative_to_delta (CPU time since the previous
 * scrape), delta_to_rate (per second) and a scale to percent of one core,
 * unit "%". The same last processor gives container.memory.percent, which the
 * receiver sends as 0-100 but labels "1" (a 0-1 fraction, which OneUptime
 * shows times 100), the unit "%".
 *
 * This suite holds the three configs to that, structurally and in arithmetic.
 * What the processors DO in the real collector, fed scrapes and run against a
 * real daemon, is container-agent-cpu-utilization-behaviour.sh's job.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const AGENTS = ["DockerAgent", "PodmanAgent", "DockerSwarmAgent"];

const CPU_PROCESSORS = [
  "transform/cpu-utilization-source",
  "cumulative_to_delta/cpu-utilization",
  "delta_to_rate/cpu-utilization",
  "transform/percent-units",
];

const CPU_METRIC = "container.cpu.utilization";
const CPU_TIME_METRIC = "container.cpu.usage.total";
const MEMORY_PERCENT_METRIC = "container.memory.percent";

// One core busy for a whole second is 10^9 nanoseconds of CPU per second.
const NANOSECONDS_PER_CORE_SECOND = 1e9;

const SCALE_STATEMENT =
  /^scale_metric\(([0-9.eE+-]+), "%"\) where metric\.name == "container\.cpu\.utilization"$/;

// The metric a statement's `where` clause names.
const WHERE_METRIC_NAME = /where metric\.name == "([^"]+)"$/;

function readConfig(agent) {
  const file = path.join(
    REPO_ROOT,
    "agents",
    agent,
    "otel-collector-config.yaml",
  );
  return yaml.load(fs.readFileSync(file, "utf8"));
}

// A collector duration ("30s", "10m", "1h") in seconds.
const DURATION = /^(\d+)(s|m|h)$/;

function durationSeconds(text) {
  const match = DURATION.exec(String(text));
  if (!match) {
    throw new Error(`not a duration: ${text}`);
  }
  return Number(match[1]) * { s: 1, m: 60, h: 3600 }[match[2]];
}

function statementsOf(processor) {
  return (processor.metric_statements || []).flatMap((group) => {
    return group.statements || [];
  });
}

function scaleFactor(config) {
  const statement = statementsOf(config.processors["transform/percent-units"])
    .map((line) => {
      return SCALE_STATEMENT.exec(line);
    })
    .find(Boolean);
  if (!statement) {
    throw new Error("transform/percent-units does not scale the CPU metric");
  }
  return Number(statement[1]);
}

/*
 * What the four processors do to one container's cumulative CPU counter, in
 * plain arithmetic: the first scrape and a scrape whose counter went down (the
 * container restarted) send nothing; every other one sends the CPU time since
 * the previous scrape, per second, as a percent of one core.
 */
function cpuPercentsFrom(scrapes, factor) {
  const out = [];
  let previous = null;
  for (const scrape of scrapes) {
    if (previous && scrape.cpuNanoseconds >= previous.cpuNanoseconds) {
      const seconds = (scrape.atMs - previous.atMs) / 1000;
      const nanosecondsPerSecond =
        (scrape.cpuNanoseconds - previous.cpuNanoseconds) / seconds;
      out.push({ atMs: scrape.atMs, percent: nanosecondsPerSecond * factor });
    }
    previous = scrape;
  }
  return out;
}

describe("container agents: container.cpu.utilization is built from container.cpu.usage.total", () => {
  test.each(AGENTS)(
    "%s: the docker_stats receiver's own CPU percent is off, and the CPU time counter it is built from is on",
    (agent) => {
      const metrics = readConfig(agent).receivers.docker_stats.metrics;

      expect(metrics[CPU_METRIC]).toEqual({ enabled: false });
      // On by default in the receiver: the config must not turn it off.
      expect(metrics[CPU_TIME_METRIC]).toBeUndefined();
      expect(metrics[MEMORY_PERCENT_METRIC]).toEqual({ enabled: true });
    },
  );

  test.each(AGENTS)(
    "%s: the copy, delta, rate and scale processors, as written",
    (agent) => {
      const processors = readConfig(agent).processors;

      expect(processors["transform/cpu-utilization-source"]).toEqual({
        error_mode: "ignore",
        metric_statements: [
          {
            context: "metric",
            statements: [
              `copy_metric(name="${CPU_METRIC}") where metric.name == "${CPU_TIME_METRIC}"`,
            ],
          },
        ],
      });

      expect(processors["cumulative_to_delta/cpu-utilization"]).toEqual({
        include: { metrics: [CPU_METRIC], match_type: "strict" },
        initial_value: "drop",
        max_staleness: "10m",
      });

      expect(processors["delta_to_rate/cpu-utilization"]).toEqual({
        metrics: [CPU_METRIC],
      });

      expect(processors["transform/percent-units"]).toEqual({
        error_mode: "ignore",
        metric_statements: [
          {
            context: "metric",
            statements: [
              `scale_metric(0.0000001, "%") where metric.name == "${CPU_METRIC}"`,
              `set(metric.description, "CPU used by the container over the collection interval, as a percent of one CPU core (100% is one full core).") where metric.name == "${CPU_METRIC}"`,
              `set(metric.unit, "%") where metric.name == "${MEMORY_PERCENT_METRIC}"`,
              `set(metric.description, "Memory in use as a percent of the container's memory limit, or of the host's memory when the container has no limit.") where metric.name == "${MEMORY_PERCENT_METRIC}"`,
            ],
          },
        ],
      });
    },
  );

  test("the three agents run the same four processors, so a container reads the same on Docker, Podman and Swarm", () => {
    const [first, ...rest] = AGENTS.map((agent) => {
      const processors = readConfig(agent).processors;
      return Object.fromEntries(
        CPU_PROCESSORS.map((name) => {
          return [name, processors[name]];
        }),
      );
    });

    for (const other of rest) {
      expect(other).toEqual(first);
    }
  });

  test.each(AGENTS)(
    "%s: the metrics pipeline runs them in order right after memory_limiter, and no logs pipeline runs them",
    (agent) => {
      const pipelines = readConfig(agent).service.pipelines;
      const metrics = pipelines.metrics.processors;

      expect(metrics.slice(0, CPU_PROCESSORS.length + 1)).toEqual([
        "memory_limiter",
        ...CPU_PROCESSORS,
      ]);
      expect(metrics[metrics.length - 1]).toBe("batch");

      for (const [name, pipeline] of Object.entries(pipelines)) {
        if (name === "metrics") {
          continue;
        }
        for (const processor of CPU_PROCESSORS) {
          expect(pipeline.processors).not.toContain(processor);
        }
      }
    },
  );

  test.each(AGENTS)(
    "%s: the processors go by the names collector 0.161.0 gives them, not the deprecated aliases",
    (agent) => {
      const config = readConfig(agent);
      const names = [
        ...Object.keys(config.processors),
        ...Object.values(config.service.pipelines).flatMap((pipeline) => {
          return pipeline.processors || [];
        }),
      ];

      for (const name of names) {
        expect(name.split("/")[0]).not.toBe("cumulativetodelta");
        expect(name.split("/")[0]).not.toBe("deltatorate");
      }
    },
  );

  test.each(AGENTS)(
    "%s: a container's state outlives several missed scrapes but not a removed container",
    (agent) => {
      const config = readConfig(agent);
      const interval = config.receivers.docker_stats.collection_interval;
      const staleness =
        config.processors["cumulative_to_delta/cpu-utilization"].max_staleness;

      expect(interval).toBe("30s");
      // At least ten scrapes: a daemon that misses a few does not restart
      // every container's series (each restart costs one scrape with no
      // CPU percent), while the state of a removed container is let go.
      expect(durationSeconds(staleness)).toBeGreaterThanOrEqual(
        10 * durationSeconds(interval),
      );
      expect(durationSeconds(staleness)).toBeLessThanOrEqual(60 * 60);
    },
  );
});

describe("container agents: the arithmetic", () => {
  test.each(AGENTS)(
    "%s: one core busy for a second (10^9 ns of CPU per second) is 100%",
    (agent) => {
      const factor = scaleFactor(readConfig(agent));

      expect(factor * NANOSECONDS_PER_CORE_SECOND).toBeCloseTo(100, 10);
    },
  );

  test("a quarter of a core, one and a half cores, idle, a restart and a burst, scraped every 30 seconds", () => {
    const factor = scaleFactor(readConfig("DockerAgent"));
    const second = 1000;

    const percents = cpuPercentsFrom(
      [
        { atMs: 0, cpuNanoseconds: 50e9 },
        // 7.5 s of CPU in 30 s: a quarter of a core.
        { atMs: 30 * second, cpuNanoseconds: 57.5e9 },
        // 45 s of CPU in 30 s: one and a half cores.
        { atMs: 60 * second, cpuNanoseconds: 102.5e9 },
        // Idle.
        { atMs: 90 * second, cpuNanoseconds: 102.5e9 },
        // Restarted: the counter starts again, and nothing is sent.
        { atMs: 120 * second, cpuNanoseconds: 1e9 },
        // 3 s of CPU in 30 s after the restart: 10%.
        { atMs: 150 * second, cpuNanoseconds: 4e9 },
        // A short burst: 9 s of CPU in a 30-second interval reads 30%.
        { atMs: 180 * second, cpuNanoseconds: 13e9 },
      ],
      factor,
    );

    expect(
      percents.map((point) => {
        return [point.atMs / second, Number(point.percent.toFixed(6))];
      }),
    ).toEqual([
      [30, 25],
      [60, 150],
      [90, 0],
      [150, 10],
      [180, 30],
    ]);
  });

  test("the CPU percent is the per-second rate of container.cpu.usage.total over 10^7, whatever the interval", () => {
    const factor = scaleFactor(readConfig("DockerAgent"));

    for (const seconds of [2, 10, 30, 47]) {
      const [point] = cpuPercentsFrom(
        [
          { atMs: 0, cpuNanoseconds: 0 },
          { atMs: seconds * 1000, cpuNanoseconds: seconds * 12e6 },
        ],
        factor,
      );
      // 12 ms of CPU per second, the customer's container: 1.2% of a core.
      expect(point.percent).toBeCloseTo(1.2, 10);
    }
  });
});

describe("container agents: what the receiver sends that the agents keep as it was", () => {
  test.each(AGENTS)(
    "%s: only container.cpu.utilization and container.memory.percent are touched",
    (agent) => {
      const processors = readConfig(agent).processors;
      const touched = new Set();

      for (const name of [
        "transform/cpu-utilization-source",
        "transform/percent-units",
      ]) {
        for (const statement of statementsOf(processors[name])) {
          const match = WHERE_METRIC_NAME.exec(statement);
          expect(match).not.toBeNull();
          touched.add(match[1]);
        }
      }

      // The copy READS container.cpu.usage.total and writes a new metric;
      // the counter itself goes on to OneUptime unchanged.
      expect([...touched].sort()).toEqual(
        [CPU_TIME_METRIC, CPU_METRIC, MEMORY_PERCENT_METRIC].sort(),
      );
      expect(
        processors["cumulative_to_delta/cpu-utilization"].include.metrics,
      ).toEqual([CPU_METRIC]);
      expect(processors["delta_to_rate/cpu-utilization"].metrics).toEqual([
        CPU_METRIC,
      ]);
    },
  );
});
