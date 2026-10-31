"use strict";

/**
 * The node half of agent-restarts-increase-behaviour.sh: it builds the
 * collector config and payloads that script runs, and checks what the
 * collector sent. Kept out of the shell script so it is plain JavaScript,
 * and its checks are plain functions KubernetesAgentRestartsIncrease.test.js
 * runs.
 *
 *   config <rendered chart> <dir>
 *       <dir>/config.yaml: an OTLP receiver, the cluster collector's
 *       metrics/restarts-increase processors exactly as the chart rendered
 *       them (all but memory_limiter and batch), a file exporter
 *       (/out/metrics.json); <dir>/image: the collector image the chart
 *       runs; <dir>/scrape-<n>.json: what k8s_cluster sends at each sample;
 *       <dir>/empty.json.
 *   count <exported metrics.json>
 *       prints how many k8s.container.restarts.increase points came out.
 *   expected-count
 *       prints how many the check expects.
 *   check <exported metrics.json> <label>
 *
 * Exits non-zero, saying why, when a check fails.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const PIPELINE = "metrics/restarts-increase";

// The pipeline's processors this runs: all but memory_limiter and batch.
const LIFTED_PROCESSORS = [
  "filter/restarts-increase-source",
  "transform/restarts-increase",
  "cumulative_to_delta/restarts-increase",
  "resource",
];

const RESTARTS_METRIC = "k8s.container.restarts";
const INCREASE_METRIC = "k8s.container.restarts.increase";
const READY_METRIC = "k8s.container.ready";
const PHASE_METRIC = "k8s.pod.phase";

// What k8s_cluster declares for k8s.container.restarts (metadata.yaml).
const RESTARTS_UNIT = "{restart}";

const INCREASE_DESCRIPTION =
  "Times the container restarted since the agent's previous sample of it.";

const K8S_CLUSTER_SCOPE =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/k8sclusterreceiver";

// The clusterName the script renders the chart with.
const CLUSTER_NAME = "behaviour-test";

// OTLP's aggregation temporalities.
const DELTA = 1;
const CUMULATIVE = 2;

/*
 * The receiver's start time - every datapoint's start, as the receiver's
 * MetricsBuilder stamps it - and the samples' offsets from a second after
 * it.
 */
const START_NANO = 1700000000000000000n;
const SECOND_NANO = 1000000000n;

/*
 * When each of the seven samples is taken, in seconds after the first: five
 * 30 seconds apart, then a gap of five minutes and one of an hour. The
 * processor compares a sample with the one before whatever lies between
 * them, and keeps it for 2 hours.
 */
const SAMPLE_SECONDS = [0, 30, 60, 90, 120, 420, 4020];

/*
 * What k8s_cluster reads for each container at each sample: the UID of its
 * pod and its status' restartCount. The kubelet runs every restart as a new
 * container, so the ID the status names changes with the count
 * (containerIdOf).
 *
 *   web: crash-looping - 1, 1, 2 and 1 restarts between samples, across
 *     the five-minute and the hour gaps too.
 *   db-0: a StatefulSet's pod, restarted 5 times, deleted and recreated
 *     under the same name before sample 3: a new UID, starting at 0; then
 *     one restart.
 *   cache: its node rebooted and the runtime lost its containers before
 *     sample 2: the same pod, its count back at 0; then one restart.
 *   ledger: 40 restarts long ago, none since.
 */
const CONTAINERS = [
  {
    namespace: "payments",
    pod: "web-7d9f-abc",
    container: "web",
    samples: [3, 3, 4, 4, 5, 7, 8].map((count) => {
      return { podUid: "web-uid", count };
    }),
  },
  {
    namespace: "data",
    pod: "db-0",
    container: "postgres",
    samples: [
      { podUid: "db-0-old-uid", count: 5 },
      { podUid: "db-0-old-uid", count: 5 },
      { podUid: "db-0-old-uid", count: 5 },
      { podUid: "db-0-new-uid", count: 0 },
      { podUid: "db-0-new-uid", count: 0 },
      { podUid: "db-0-new-uid", count: 1 },
      { podUid: "db-0-new-uid", count: 1 },
    ],
  },
  {
    namespace: "payments",
    pod: "cache-6b7f-k2m",
    container: "redis",
    samples: [6, 6, 0, 0, 1, 1, 1].map((count) => {
      return { podUid: "cache-uid", count };
    }),
  },
  {
    namespace: "payments",
    pod: "ledger-66f8-q9z",
    container: "ledger",
    samples: [40, 40, 40, 40, 40, 40, 40].map((count) => {
      return { podUid: "ledger-uid", count };
    }),
  },
];

// The container a status names: one per run, so one per count of a pod.
function containerIdOf(sample) {
  return `${sample.podUid}-run-${sample.count}`;
}

/*
 * What a container's samples become, sample by sample, as the chart's
 * pipeline makes them: container.id is off, so a series is the pod's UID
 * and the container's name (keyedBy "pod"); nothing for a series' first
 * sample, nothing for one whose count went down (the next is measured from
 * it), else the count minus the series' previous sample's - as
 * cumulative_to_delta, with initial_value: drop, makes them. keyedBy
 * "container-id" is what the same processors would make with container.id
 * left on.
 */
function restartIncreasesFrom(samples, keyedBy = "pod") {
  const previousBySeries = new Map();
  const out = [];
  samples.forEach((sample, index) => {
    const series =
      keyedBy === "container-id" ? containerIdOf(sample) : sample.podUid;
    const previous = previousBySeries.get(series);
    if (previous !== undefined && sample.count >= previous.count) {
      out.push({
        sample: index,
        increase: sample.count - previous.count,
        since: previous.index,
      });
    }
    previousBySeries.set(series, { count: sample.count, index });
  });
  return out;
}

// What OneUptime must get: "<pod>/<container> <sample> <increase>".
const EXPECTED_INCREASES = [
  "web-7d9f-abc/web 1 0",
  "web-7d9f-abc/web 2 1",
  "web-7d9f-abc/web 3 0",
  "web-7d9f-abc/web 4 1",
  "web-7d9f-abc/web 5 2",
  "web-7d9f-abc/web 6 1",
  "db-0/postgres 1 0",
  "db-0/postgres 2 0",
  // Sample 3: a new pod under the same name, its first sample: nothing.
  "db-0/postgres 4 0",
  "db-0/postgres 5 1",
  "db-0/postgres 6 0",
  "cache-6b7f-k2m/redis 1 0",
  // Sample 2: its count went down in the same pod: nothing.
  "cache-6b7f-k2m/redis 3 0",
  "cache-6b7f-k2m/redis 4 1",
  "cache-6b7f-k2m/redis 5 0",
  "cache-6b7f-k2m/redis 6 0",
  "ledger-66f8-q9z/ledger 1 0",
  "ledger-66f8-q9z/ledger 2 0",
  "ledger-66f8-q9z/ledger 3 0",
  "ledger-66f8-q9z/ledger 4 0",
  "ledger-66f8-q9z/ledger 5 0",
  "ledger-66f8-q9z/ledger 6 0",
];

function fail(message) {
  console.error(`FAILED: ${message}`);
  process.exit(1);
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

function gauge(name, unit, description, value, index) {
  return {
    name,
    unit,
    description,
    gauge: {
      dataPoints: [
        {
          startTimeUnixNano: START_NANO.toString(),
          timeUnixNano: sampleTimeNano(index),
          asInt: String(value),
        },
      ],
    },
  };
}

/*
 * What k8s_cluster sends at a sample: for every container, its own
 * resource (the k8s.container entity: keyed by container.id, with the
 * container's name and image and its pod's UID, name, namespace and node)
 * with k8s.container.restarts and k8s.container.ready as int gauges; and
 * for a pod, k8s.pod.phase on the pod's resource.
 */
function scrapePayload(index) {
  const scope = { name: K8S_CLUSTER_SCOPE, version: "0.161.0" };

  const resourceMetrics = CONTAINERS.map((entry) => {
    const sample = entry.samples[index];
    return {
      resource: {
        attributes: [
          stringAttribute("container.id", containerIdOf(sample)),
          stringAttribute("k8s.container.name", entry.container),
          stringAttribute(
            "container.image.name",
            `docker.io/library/${entry.container}`,
          ),
          stringAttribute("container.image.tag", "1.0"),
          stringAttribute("k8s.pod.name", entry.pod),
          stringAttribute("k8s.pod.uid", sample.podUid),
          stringAttribute("k8s.namespace.name", entry.namespace),
          stringAttribute("k8s.node.name", "node-1"),
        ],
      },
      scopeMetrics: [
        {
          scope,
          metrics: [
            gauge(
              RESTARTS_METRIC,
              RESTARTS_UNIT,
              "How many times the container has restarted in the recent past.",
              sample.count,
              index,
            ),
            gauge(
              READY_METRIC,
              "",
              "Whether a container has passed its readiness probe (0 for no, 1 for yes)",
              0,
              index,
            ),
          ],
        },
      ],
    };
  });

  resourceMetrics.push({
    resource: {
      attributes: [
        stringAttribute("k8s.pod.name", "web-7d9f-abc"),
        stringAttribute("k8s.pod.uid", "web-uid"),
        stringAttribute("k8s.namespace.name", "payments"),
        stringAttribute("k8s.node.name", "node-1"),
      ],
    },
    scopeMetrics: [
      {
        scope,
        metrics: [
          gauge(PHASE_METRIC, "", "Current phase of the pod", 2, index),
        ],
      },
    ],
  });

  return { resourceMetrics };
}

function readRenderedDeployment(renderedFile) {
  const docs = yaml
    .loadAll(fs.readFileSync(renderedFile, "utf8"))
    .filter(Boolean);
  const configMap = docs.find((doc) => {
    return (
      doc.kind === "ConfigMap" &&
      doc.metadata.name === "behaviour-kubernetes-agent-deployment"
    );
  });
  const deployment = docs.find((doc) => {
    return (
      doc.kind === "Deployment" &&
      doc.metadata.name === "behaviour-kubernetes-agent"
    );
  });
  if (!configMap || !deployment) {
    fail(`${renderedFile}: no cluster collector ConfigMap and Deployment`);
  }
  return {
    collector: yaml.load(configMap.data["otel-collector-config.yaml"]),
    image: deployment.spec.template.spec.containers[0].image,
  };
}

/*
 * The collector config that runs the pipeline's processors, from a parsed
 * cluster collector config, after checking that the pipeline runs them
 * where the chart says.
 */
function behaviourConfig(collector) {
  const pipeline = collector.service.pipelines[PIPELINE];
  if (!pipeline) {
    fail(`the cluster collector has no ${PIPELINE} pipeline`);
  }
  const expected = ["memory_limiter", ...LIFTED_PROCESSORS, "batch"];
  if (pipeline.processors.join(",") !== expected.join(",")) {
    fail(`${PIPELINE} runs ${pipeline.processors.join(", ")}`);
  }
  if (pipeline.receivers.join(",") !== "k8s_cluster") {
    fail(`${PIPELINE} receives from ${pipeline.receivers.join(", ")}`);
  }
  if (pipeline.exporters.join(",") !== "otlphttp") {
    fail(`${PIPELINE} exports to ${pipeline.exporters.join(", ")}`);
  }
  // And the metrics pipeline still gets what k8s_cluster sends, unchanged.
  if (!collector.service.pipelines.metrics.receivers.includes("k8s_cluster")) {
    fail("the metrics pipeline no longer receives from k8s_cluster");
  }

  return {
    receivers: {
      otlp: { protocols: { http: { endpoint: "0.0.0.0:4318" } } },
    },
    processors: Object.fromEntries(
      LIFTED_PROCESSORS.map((name) => {
        return [name, collector.processors[name]];
      }),
    ),
    exporters: { file: { path: "/out/metrics.json" } },
    service: {
      pipelines: {
        metrics: {
          receivers: ["otlp"],
          processors: LIFTED_PROCESSORS,
          exporters: ["file"],
        },
      },
    },
  };
}

function writeConfig(renderedFile, dir) {
  const { collector, image } = readRenderedDeployment(renderedFile);
  fs.writeFileSync(
    path.join(dir, "config.yaml"),
    yaml.dump(behaviourConfig(collector)),
  );
  fs.writeFileSync(path.join(dir, "image"), image);
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

function valueOf(point) {
  if (point.asInt !== undefined) {
    return Number(point.asInt);
  }
  return point.asDouble;
}

/*
 * The points of a file exporter's output (one request per line), each with
 * its metric, its resource's attributes and its scope.
 */
function readExported(file) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  // A last line without its newline is still being written.
  const lines = text.split("\n");
  lines.pop();
  const points = [];
  for (const line of lines.filter(Boolean)) {
    for (const resourceMetric of JSON.parse(line).resourceMetrics || []) {
      const resource = {};
      for (const attribute of resourceMetric.resource.attributes || []) {
        resource[attribute.key] = Object.values(attribute.value)[0];
      }
      for (const scopeMetric of resourceMetric.scopeMetrics || []) {
        for (const metric of scopeMetric.metrics || []) {
          const type = ["gauge", "sum", "histogram", "summary"].find((key) => {
            return metric[key] !== undefined;
          });
          for (const point of metric[type].dataPoints || []) {
            points.push({
              resource,
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

function lineOf(point) {
  return `${point.resource["k8s.pod.name"]}/${point.resource["k8s.container.name"]} ${sampleIndexOf(point.time)} ${point.value}`;
}

/*
 * What is wrong with the points the collector exported, as a list of
 * sentences; empty when nothing is.
 */
function problemsWith(points) {
  const problems = [];

  // This pipeline sends the increase and nothing else.
  const others = [
    ...new Set(
      points
        .filter((point) => {
          return point.metric !== INCREASE_METRIC;
        })
        .map((point) => {
          return point.metric;
        }),
    ),
  ];
  if (others.length > 0) {
    problems.push(`it also sent ${others.join(", ")}`);
  }

  const increases = points.filter((point) => {
    return point.metric === INCREASE_METRIC;
  });
  const got = increases.map(lineOf).sort();
  const expected = [...EXPECTED_INCREASES].sort();
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    problems.push(`${INCREASE_METRIC} came out as [${got.join("; ")}]`);
  }

  for (const point of increases) {
    const at = lineOf(point);
    if (
      point.type !== "sum" ||
      point.temporality !== DELTA ||
      point.monotonic !== true
    ) {
      problems.push(
        `${at} is a ${point.type} (temporality ${point.temporality}, monotonic ${point.monotonic}), not a monotonic delta sum`,
      );
    }
    if (point.unit !== RESTARTS_UNIT) {
      problems.push(`${at} is in "${point.unit}"`);
    }
    if (point.description !== INCREASE_DESCRIPTION) {
      problems.push(`${at} is described "${point.description}"`);
    }
    if (point.scope !== K8S_CLUSTER_SCOPE) {
      problems.push(`${at} left the k8s_cluster scope (${point.scope})`);
    }
    if (point.resource["container.id"] !== undefined) {
      problems.push(`${at} still carries container.id`);
    }
    for (const key of [
      "k8s.pod.uid",
      "k8s.pod.name",
      "k8s.namespace.name",
      "k8s.container.name",
      "k8s.node.name",
    ]) {
      if (!point.resource[key]) {
        problems.push(`${at} lost ${key}`);
      }
    }
    // The cluster collector's resource processor ran.
    if (point.resource["k8s.cluster.name"] !== CLUSTER_NAME) {
      problems.push(
        `${at} is for cluster "${point.resource["k8s.cluster.name"]}"`,
      );
    }
    // It covers the time since its pod's previous sample of the container.
    const entry = CONTAINERS.find((candidate) => {
      return candidate.pod === point.resource["k8s.pod.name"];
    });
    const index = sampleIndexOf(point.time);
    const counted = entry
      ? restartIncreasesFrom(entry.samples).find((candidate) => {
          return candidate.sample === index;
        })
      : undefined;
    if (counted && point.start !== sampleTimeNano(counted.since)) {
      problems.push(
        `${at} starts at ${point.start}, not at its previous sample (${sampleTimeNano(counted.since)})`,
      );
    }
  }

  return problems;
}

function check(exported, label) {
  const points = readExported(exported);
  const got = points
    .filter((point) => {
      return point.metric === INCREASE_METRIC;
    })
    .map(lineOf);
  for (const line of EXPECTED_INCREASES) {
    console.log(`    ${got.includes(line) ? "ok    " : "MISSING"} ${line}`);
  }
  for (const line of got.filter((candidate) => {
    return !EXPECTED_INCREASES.includes(candidate);
  })) {
    console.log(`    EXTRA  ${line}`);
  }
  const problems = problemsWith(points);
  if (problems.length > 0) {
    fail(`${label}: ${problems.join("; ")}`);
  }
}

function count(exported) {
  return readExported(exported).filter((point) => {
    return point.metric === INCREASE_METRIC;
  }).length;
}

module.exports = {
  PIPELINE,
  LIFTED_PROCESSORS,
  RESTARTS_METRIC,
  INCREASE_METRIC,
  READY_METRIC,
  PHASE_METRIC,
  RESTARTS_UNIT,
  INCREASE_DESCRIPTION,
  K8S_CLUSTER_SCOPE,
  CLUSTER_NAME,
  DELTA,
  CUMULATIVE,
  START_NANO,
  SAMPLE_SECONDS,
  CONTAINERS,
  EXPECTED_INCREASES,
  containerIdOf,
  restartIncreasesFrom,
  sampleTimeNano,
  scrapePayload,
  behaviourConfig,
  problemsWith,
};

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "config") {
    writeConfig(args[0], args[1]);
  } else if (command === "count") {
    console.log(count(args[0]));
  } else if (command === "expected-count") {
    console.log(EXPECTED_INCREASES.length);
  } else if (command === "check") {
    check(args[0], args[1]);
  } else {
    fail(`unknown command ${command}`);
  }
}
