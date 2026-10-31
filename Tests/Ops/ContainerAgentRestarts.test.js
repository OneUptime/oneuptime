"use strict";

/**
 * Container restarts, as the Docker and Podman agents send them.
 *
 * Both run the collector's docker_stats receiver, whose container.restarts
 * is the engine's RestartCount for the container: a lifetime total that
 * only its restart policy raises, and that a manual restart or a recreated
 * container starts again at 0. OneUptime's Container Restart Loop template
 * used to take its growth between two samples of the SAME minute (a
 * monitor cannot take the difference of values in different minutes), so a
 * restart between the last sample of one minute and the first of the next
 * was never counted - about half of a crash loop at the agents' 30-second
 * interval, all of it for a container sampled less than twice a minute -
 * and a manual restart read as the whole count in one minute.
 *
 * So the agents copy container.restarts as container.restarts.increase and
 * turn the copy, with cumulative_to_delta, into the restarts since the
 * previous sample of the same container, whatever the gap; the template
 * sums it. container.restarts itself goes on unchanged, for the charts.
 *
 * This suite holds the two configs to that, structurally and in arithmetic,
 * and holds the checks of container-agent-restarts-behaviour.sh - which runs
 * the processors in the real collector, fed samples and against a real
 * daemon - to the same arithmetic.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const behaviour = require("./Utils/ContainerAgentRestartsBehaviour");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const AGENTS = ["DockerAgent", "PodmanAgent"];

const RESTART_PROCESSORS = [
  "transform/restarts-increase-source",
  "cumulative_to_delta/restarts-increase",
];

const CPU_PROCESSORS = [
  "transform/cpu-utilization-source",
  "cumulative_to_delta/cpu-utilization",
  "delta_to_rate/cpu-utilization",
  "transform/percent-units",
];

const RESTARTS_METRIC = "container.restarts";
const INCREASE_METRIC = "container.restarts.increase";

const COPY_STATEMENT = `copy_metric(name="${INCREASE_METRIC}", description="Times the container restarted since the agent's previous sample of it.") where metric.name == "${RESTARTS_METRIC}"`;

// The template's window: a container's previous sample must outlive it.
const TEMPLATE_WINDOW_SECONDS = 15 * 60;

function readRepoFile(file) {
  return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
}

function readConfig(agent) {
  return yaml.load(readRepoFile(`agents/${agent}/otel-collector-config.yaml`));
}

// A collector duration ("30s", "10m", "2h") in seconds.
const DURATION = /^(\d+)(s|m|h)$/;

function durationSeconds(text) {
  const match = DURATION.exec(String(text));
  if (!match) {
    throw new Error(`not a duration: ${text}`);
  }
  return Number(match[1]) * { s: 1, m: 60, h: 3600 }[match[2]];
}

/*
 * The arithmetic of the two processors on one container's samples, with
 * their times: a sample sends nothing when it is the container's first, or
 * when the count went down; when the previous sample is older than the
 * staleness limit the container counts as new; otherwise it sends the count
 * minus the previous sample's. (The collector sweeps stale state every
 * max_staleness, so it may keep a container up to twice as long; this is
 * the least it keeps.)
 */
function increasesFrom(samples, maxStalenessSeconds) {
  const out = [];
  let previous = null;
  for (const sample of samples) {
    const stale =
      previous && sample.atSeconds - previous.atSeconds > maxStalenessSeconds;
    if (previous && !stale && sample.count >= previous.count) {
      out.push({
        atSeconds: sample.atSeconds,
        increase: sample.count - previous.count,
        sinceSeconds: previous.atSeconds,
      });
    }
    previous = sample;
  }
  return out;
}

function sumOf(increases) {
  return increases.reduce((total, point) => {
    return total + point.increase;
  }, 0);
}

describe("container agents: container.restarts.increase is built from container.restarts", () => {
  test.each(AGENTS)(
    "%s: the receiver's restart count is on, as the template needs",
    (agent) => {
      const metrics = readConfig(agent).receivers.docker_stats.metrics;

      expect(metrics[RESTARTS_METRIC]).toEqual({ enabled: true });
      expect(readConfig(agent).receivers.docker_stats.collection_interval).toBe(
        "30s",
      );
    },
  );

  test.each(AGENTS)("%s: the copy and the delta, as written", (agent) => {
    const processors = readConfig(agent).processors;

    expect(processors["transform/restarts-increase-source"]).toEqual({
      error_mode: "ignore",
      metric_statements: [{ context: "metric", statements: [COPY_STATEMENT] }],
    });

    expect(processors["cumulative_to_delta/restarts-increase"]).toEqual({
      include: { metrics: [INCREASE_METRIC], match_type: "strict" },
      initial_value: "drop",
      max_staleness: "2h",
    });
  });

  test("the two agents run the same processors, so a container counts the same on Docker and Podman", () => {
    const [docker, podman] = AGENTS.map((agent) => {
      const processors = readConfig(agent).processors;
      return Object.fromEntries(
        RESTART_PROCESSORS.map((name) => {
          return [name, processors[name]];
        }),
      );
    });

    expect(podman).toEqual(docker);
  });

  test.each(AGENTS)(
    "%s: the metrics pipeline runs them in order after the CPU processors and before the resource ones, and no logs pipeline runs them",
    (agent) => {
      const pipelines = readConfig(agent).service.pipelines;
      const metrics = pipelines.metrics.processors;
      const at = metrics.indexOf(RESTART_PROCESSORS[0]);

      expect(at).toBeGreaterThan(0);
      expect(metrics.slice(at, at + RESTART_PROCESSORS.length)).toEqual(
        RESTART_PROCESSORS,
      );
      // The CPU processors keep their place right after memory_limiter.
      expect(metrics.slice(0, CPU_PROCESSORS.length + 1)).toEqual([
        "memory_limiter",
        ...CPU_PROCESSORS,
      ]);
      expect(at).toBe(CPU_PROCESSORS.length + 1);
      // A container's identity is the receiver's, before anything is added.
      expect(at).toBeLessThan(metrics.indexOf("resource"));
      expect(metrics[metrics.length - 1]).toBe("batch");

      for (const [name, pipeline] of Object.entries(pipelines)) {
        if (name === "metrics") {
          continue;
        }
        for (const processor of RESTART_PROCESSORS) {
          expect(pipeline.processors).not.toContain(processor);
        }
      }
    },
  );

  test.each(AGENTS)(
    "%s: container.restarts goes on unchanged: only the copy is turned into increases",
    (agent) => {
      const processors = readConfig(agent).processors;
      const deltas = Object.entries(processors).filter(([name]) => {
        return name.startsWith("cumulative_to_delta/");
      });

      for (const [name, processor] of deltas) {
        expect({ name, includes: processor.include.metrics }).not.toEqual({
          name,
          includes: expect.arrayContaining([RESTARTS_METRIC]),
        });
      }
      // The copy never matches its own where clause, so it is made once.
      expect(COPY_STATEMENT.endsWith(`== "${RESTARTS_METRIC}"`)).toBe(true);
      expect(INCREASE_METRIC).not.toBe(RESTARTS_METRIC);
    },
  );

  test.each(AGENTS)(
    "%s: a container's first sample sends no increase, so its lifetime count is never sent as one",
    (agent) => {
      /*
       * initial_value "auto" would send a series' first value as it is when
       * the series started after the collector - and docker_stats stamps
       * every container's series with the receiver's start, a moment after
       * the processors start. A container with 40 old restarts would send
       * 40 restarts in its first sample after every agent restart.
       */
      expect(
        readConfig(agent).processors["cumulative_to_delta/restarts-increase"]
          .initial_value,
      ).toBe("drop");
    },
  );

  test.each(AGENTS)(
    "%s: a container's previous sample outlives the template's window many times over",
    (agent) => {
      const config = readConfig(agent);
      const interval = durationSeconds(
        config.receivers.docker_stats.collection_interval,
      );
      const staleness = durationSeconds(
        config.processors["cumulative_to_delta/restarts-increase"]
          .max_staleness,
      );

      // A container seen again after a long gap still sends its restarts.
      expect(staleness).toBeGreaterThanOrEqual(4 * TEMPLATE_WINDOW_SECONDS);
      expect(staleness).toBeGreaterThanOrEqual(100 * interval);
      // While a removed container's state is still let go the same day.
      expect(staleness).toBeLessThanOrEqual(6 * 60 * 60);
    },
  );
});

describe("container agents: the arithmetic", () => {
  const staleness = durationSeconds(
    readConfig("DockerAgent").processors[
      "cumulative_to_delta/restarts-increase"
    ].max_staleness,
  );

  test("each sample sends the restarts since the one before, however far apart they are", () => {
    const increases = increasesFrom(
      [
        { atSeconds: 0, count: 3 },
        { atSeconds: 30, count: 3 },
        { atSeconds: 60, count: 5 },
        // Five minutes unseen: four restarts in between, in four minutes.
        { atSeconds: 360, count: 9 },
        // An hour later: still the same container's previous sample.
        { atSeconds: 3960, count: 11 },
      ],
      staleness,
    );

    expect(increases).toEqual([
      { atSeconds: 30, increase: 0, sinceSeconds: 0 },
      { atSeconds: 60, increase: 2, sinceSeconds: 30 },
      { atSeconds: 360, increase: 4, sinceSeconds: 60 },
      { atSeconds: 3960, increase: 2, sinceSeconds: 360 },
    ]);
  });

  test("a manual restart, which starts the count again at 0, sends nothing, and counting goes on from 0", () => {
    const increases = increasesFrom(
      [
        { atSeconds: 0, count: 5 },
        { atSeconds: 30, count: 5 },
        { atSeconds: 60, count: 0 },
        { atSeconds: 90, count: 2 },
      ],
      staleness,
    );

    expect(increases).toEqual([
      { atSeconds: 30, increase: 0, sinceSeconds: 0 },
      { atSeconds: 90, increase: 2, sinceSeconds: 60 },
    ]);
  });

  test("restarts between two minutes' samples count in full, where the old per-minute growth saw none", () => {
    // Sampled at :15 and :45, restarting at :55 of six minutes.
    const samples = [];
    for (let seconds = 15; seconds < 15 * 60; seconds += 30) {
      const restarts = [1, 3, 5, 7, 9, 11].filter((minute) => {
        return minute * 60 + 55 <= seconds;
      }).length;
      samples.push({ atSeconds: seconds, count: restarts });
    }

    expect(sumOf(increasesFrom(samples, staleness))).toBe(6);

    // The old template: each minute's highest count minus its lowest.
    const byMinute = new Map();
    for (const sample of samples) {
      const minute = Math.floor(sample.atSeconds / 60);
      byMinute.set(minute, [...(byMinute.get(minute) || []), sample.count]);
    }
    const oldGrowth = [...byMinute.values()].reduce((total, counts) => {
      return total + Math.max(...counts) - Math.min(...counts);
    }, 0);
    expect(oldGrowth).toBe(0);
  });

  test("the increases of an uninterrupted series add up to its count's growth", () => {
    const counts = [0, 0, 1, 1, 2, 4, 4, 7, 8, 8, 12];
    const samples = counts.map((count, index) => {
      return { atSeconds: index * 30, count };
    });

    expect(sumOf(increasesFrom(samples, staleness))).toBe(
      counts[counts.length - 1] - counts[0],
    );
  });
});

describe("container-agent-restarts-behaviour.sh: what it feeds the collector and expects back", () => {
  test("it runs the two processors every agent's pipeline runs, in that order", () => {
    expect(behaviour.RESTART_PROCESSORS).toEqual(RESTART_PROCESSORS);
  });

  test("it expects what the arithmetic says of the samples it posts", () => {
    const expected = Object.entries(behaviour.SCRAPES).flatMap(
      ([container, counts]) => {
        return behaviour.restartIncreasesFrom(counts).map((point) => {
          return `${container} ${point.sample} ${point.increase}`;
        });
      },
    );

    expect([...behaviour.EXPECTED_INCREASES].sort()).toEqual(expected.sort());

    // And restartIncreasesFrom is the arithmetic above, on the same samples.
    for (const counts of Object.values(behaviour.SCRAPES)) {
      const samples = counts.map((count, index) => {
        return { atSeconds: behaviour.SAMPLE_SECONDS[index], count };
      });
      expect(
        behaviour.restartIncreasesFrom(counts).map((point) => {
          return point.increase;
        }),
      ).toEqual(
        increasesFrom(samples, staleness()).map((point) => {
          return point.increase;
        }),
      );
    }

    function staleness() {
      return durationSeconds(
        readConfig("DockerAgent").processors[
          "cumulative_to_delta/restarts-increase"
        ].max_staleness,
      );
    }
  });

  test("its samples cover a manual restart, gaps of minutes and of an hour, and a quiet container", () => {
    const gaps = behaviour.SAMPLE_SECONDS.slice(1).map((seconds, index) => {
      return seconds - behaviour.SAMPLE_SECONDS[index];
    });

    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(60 * 60);
    expect(gaps).toContain(300);
    expect(gaps).toContain(30);

    const looping = behaviour.SCRAPES.looping;
    expect(
      looping.some((count, index) => {
        return index > 0 && count < looping[index - 1];
      }),
    ).toBe(true);
    expect(new Set(behaviour.SCRAPES.steady).size).toBe(1);
  });

  test("its payloads are docker_stats' container.restarts: a cumulative monotonic integer sum in {restarts}", () => {
    for (let index = 0; index < behaviour.SAMPLE_SECONDS.length; index++) {
      const payload = behaviour.scrapePayload(index);

      expect(payload.resourceMetrics).toHaveLength(2);
      for (const resourceMetric of payload.resourceMetrics) {
        const [metric] = resourceMetric.scopeMetrics[0].metrics;
        expect(resourceMetric.scopeMetrics[0].scope.name).toBe(
          behaviour.DOCKER_STATS_SCOPE,
        );
        expect(metric.name).toBe(RESTARTS_METRIC);
        expect(metric.unit).toBe("{restarts}");
        expect(metric.sum.aggregationTemporality).toBe(behaviour.CUMULATIVE);
        expect(metric.sum.isMonotonic).toBe(true);
        expect(metric.sum.dataPoints[0].startTimeUnixNano).toBe(
          behaviour.START_NANO.toString(),
        );
        expect(metric.sum.dataPoints[0].timeUnixNano).toBe(
          behaviour.sampleTimeNano(index),
        );
      }
    }
  });

  /*
   * What the collector should export for the fed samples, built from the
   * arithmetic, in the shape readExported gives it.
   */
  function exportedAsExpected() {
    const points = [];
    for (const [container, counts] of Object.entries(behaviour.SCRAPES)) {
      counts.forEach((count, index) => {
        points.push({
          container,
          metric: RESTARTS_METRIC,
          unit: "{restarts}",
          description: "Number of restarts for the container.",
          type: "sum",
          time: behaviour.sampleTimeNano(index),
          start: behaviour.START_NANO.toString(),
          value: count,
          temporality: behaviour.CUMULATIVE,
          monotonic: true,
          scope: behaviour.DOCKER_STATS_SCOPE,
        });
      });
      for (const point of behaviour.restartIncreasesFrom(counts)) {
        points.push({
          container,
          metric: INCREASE_METRIC,
          unit: "{restarts}",
          description: behaviour.INCREASE_DESCRIPTION,
          type: "sum",
          time: behaviour.sampleTimeNano(point.sample),
          start: behaviour.sampleTimeNano(point.sample - 1),
          value: point.increase,
          temporality: behaviour.DELTA,
          monotonic: true,
          scope: behaviour.DOCKER_STATS_SCOPE,
        });
      }
    }
    return points;
  }

  test("its synthetic check passes what the processors should send", () => {
    expect(behaviour.syntheticProblems(exportedAsExpected())).toEqual([]);
  });

  test.each([
    [
      "an increase for a container's first sample (the lifetime count)",
      (points) => {
        points.push({
          ...points.find((point) => {
            return point.metric === INCREASE_METRIC;
          }),
          time: behaviour.sampleTimeNano(0),
          value: 3,
        });
      },
    ],
    [
      "an increase for the sample a manual restart took to 0",
      (points) => {
        points.push({
          ...points.find((point) => {
            return point.metric === INCREASE_METRIC;
          }),
          time: behaviour.sampleTimeNano(4),
          start: behaviour.sampleTimeNano(3),
          value: 0,
        });
      },
    ],
    [
      "the copy left cumulative",
      (points) => {
        for (const point of points) {
          if (point.metric === INCREASE_METRIC) {
            point.temporality = behaviour.CUMULATIVE;
          }
        }
      },
    ],
    [
      "container.restarts itself turned into increases",
      (points) => {
        for (const point of points) {
          if (point.metric === RESTARTS_METRIC) {
            point.temporality = behaviour.DELTA;
          }
        }
      },
    ],
    [
      "an increase that does not cover the time since the previous sample",
      (points) => {
        const increase = points.find((point) => {
          return point.metric === INCREASE_METRIC && point.value === 4;
        });
        increase.start = increase.time;
      },
    ],
    [
      "the description left as the receiver's",
      (points) => {
        for (const point of points) {
          if (point.metric === INCREASE_METRIC) {
            point.description = "Number of restarts for the container.";
          }
        }
      },
    ],
  ])("its synthetic check fails %s", (_name, mutate) => {
    const points = exportedAsExpected();
    mutate(points);

    expect(behaviour.syntheticProblems(points).length).toBeGreaterThan(0);
  });

  /*
   * A real daemon's export of a container in a restart loop: its count at
   * each 2-second sample, and whether Docker was restarting it then (empty
   * stats: a memory limit of 0).
   */
  function realExport(samples, options = {}) {
    const points = [];
    samples.forEach((sample, index) => {
      const time = String(1700000000000000000n + BigInt(index) * 2000000000n);
      const previous = String(
        1700000000000000000n + BigInt(index - 1) * 2000000000n,
      );
      points.push({
        container: "looping",
        metric: RESTARTS_METRIC,
        unit: "{restarts}",
        type: "sum",
        time,
        value: sample.count,
        temporality: behaviour.CUMULATIVE,
      });
      points.push({
        container: "looping",
        metric: behaviour.MEMORY_LIMIT_METRIC,
        unit: "By",
        type: "sum",
        time,
        value: sample.restarting ? 0 : 8 * 1024 * 1024 * 1024,
      });
      if (index > 0 && !(options.dropIncreaseAt === index)) {
        points.push({
          container: "looping",
          metric: INCREASE_METRIC,
          unit: "{restarts}",
          description: behaviour.INCREASE_DESCRIPTION,
          type: "sum",
          time,
          start: previous,
          value: sample.count - samples[index - 1].count,
          temporality: behaviour.DELTA,
        });
      }
    });
    return points;
  }

  const LOOP = [
    { count: 0, restarting: false },
    { count: 1, restarting: false },
    { count: 3, restarting: false },
    { count: 4, restarting: true },
    { count: 5, restarting: true },
    { count: 5, restarting: true },
    { count: 6, restarting: false },
  ];

  test("its real-daemon check passes a restart loop sampled between its runs", () => {
    expect(behaviour.realProblems(realExport(LOOP), "looping")).toEqual([]);
  });

  test("its real-daemon check fails a loop never sampled while Docker restarted it", () => {
    const neverRestarting = LOOP.map((sample) => {
      return { ...sample, restarting: false };
    });

    expect(
      behaviour.realProblems(realExport(neverRestarting), "looping"),
    ).toEqual([
      "no sample of looping was taken while Docker was restarting it (none with container.memory.usage.limit 0)",
    ]);
  });

  test("its real-daemon check fails increases that miss a restart, and a loop that hardly grew", () => {
    expect(
      behaviour.realProblems(realExport(LOOP, { dropIncreaseAt: 2 }), "looping")
        .length,
    ).toBeGreaterThan(0);
    expect(
      behaviour.realProblems(
        realExport([
          { count: 0, restarting: false },
          { count: 1, restarting: true },
          { count: 2, restarting: false },
        ]),
        "looping",
      ),
    ).toContain(
      `looping's container.restarts grew by 2, not by ${behaviour.MIN_REAL_GROWTH} or more`,
    );
  });
});

describe("the templates read what the agents send", () => {
  test.each([
    ["packages/Common/Types/Monitor/DockerAlertTemplates.ts", "DockerAgent"],
    ["packages/Common/Types/Monitor/PodmanAlertTemplates.ts", "PodmanAgent"],
  ])("%s's restart loop reads the metric %s makes", (templates, agent) => {
    const source = readRepoFile(templates);

    expect(source).toContain(`metricName: "${INCREASE_METRIC}"`);
    expect(source).not.toContain(`metricName: "${RESTARTS_METRIC}"`);
    expect(
      readRepoFile(`agents/${agent}/otel-collector-config.yaml`),
    ).toContain(COPY_STATEMENT);
  });
});
