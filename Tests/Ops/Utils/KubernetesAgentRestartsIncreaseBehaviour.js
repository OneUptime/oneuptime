"use strict";

/**
 * The node half of agent-restarts-increase-behaviour.sh: it builds the
 * collector config and payloads that script runs, and checks what the
 * collector sent. Kept out of the shell script so it is plain JavaScript,
 * and its checks are plain functions KubernetesAgentRestartsIncrease.test.js
 * runs.
 *
 *   config <rendered chart> <dir>
 *       <dir>/config.yaml: an OTLP receiver that feeds two pipelines, as
 *       k8s_cluster feeds the cluster collector's: metrics/restarts-increase
 *       with its processors exactly as the chart rendered them (all but
 *       memory_limiter), into the chart's forward/restarts-increase
 *       connector; and metrics, which receives from the OTLP receiver and
 *       the connector, with the chart's metrics pipeline processors (all but
 *       memory_limiter and batch) - k8sattributes, which needs a cluster,
 *       replaced by a stand-in that adds each pod's workload names as
 *       k8sattributes finds them by the pod's UID - into a file exporter
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
// The pipeline the increases join, which sends them.
const METRICS_PIPELINE = "metrics";
// The connector between the two.
const CONNECTOR = "forward/restarts-increase";

// The restarts pipeline's processors this runs: all but memory_limiter.
const LIFTED_PROCESSORS = [
  "filter/restarts-increase-source",
  "transform/restarts-increase",
  "cumulative_to_delta/restarts-increase",
];

/*
 * The metrics pipeline's processors, as the chart renders them for the
 * script (eBPF on, as by default): this runs all but memory_limiter and
 * batch, with K8S_ATTRIBUTES_STAND_IN in k8sattributes' place.
 */
const METRICS_PIPELINE_PROCESSORS = [
  "memory_limiter",
  "transform/job-failures-increase",
  "cumulative_to_delta/job-failures-increase",
  "transform/pod-level-mark",
  "k8sattributes",
  "transform/pod-level-unmark",
  "resource",
  "filter/ebpf-node-inspector",
  "batch",
];
const K8S_ATTRIBUTES = "k8sattributes";
const K8S_ATTRIBUTES_STAND_IN = "transform/k8sattributes-stand-in";

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
 * The workload attributes k8sattributes adds to a pod's telemetry, as the
 * chart extracts them: the names of the pod's owners and of their owners,
 * and two of the pod's labels.
 */
const WORKLOAD_KEYS = [
  "k8s.deployment.name",
  "k8s.replicaset.name",
  "k8s.statefulset.name",
  "k8s.daemonset.name",
  "k8s.job.name",
  "k8s.cronjob.name",
];
const LABEL_KEYS = [
  "k8s.pod.label.app",
  "k8s.pod.label.app.kubernetes.io/name",
];

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
 * (containerIdOf). `workload` is what k8sattributes finds for the pod, by
 * its UID: the names of the workloads it belongs to and its app labels. The
 * receiver sends none of them.
 *
 *   web: a Deployment's pod, crash-looping - 1, 1, 2 and 1 restarts between
 *     samples, across the five-minute and the hour gaps too.
 *   db-0: a StatefulSet's pod, restarted 5 times, deleted and recreated
 *     under the same name before sample 3: a new UID, starting at 0, the
 *     same StatefulSet; then one restart.
 *   cache: a Deployment's pod whose node rebooted and whose runtime lost its
 *     containers before sample 2: the same pod, its count back at 0; then
 *     one restart.
 *   ledger: a Deployment's pod, 40 restarts long ago, none since.
 *   node-agent: a DaemonSet's pod, crash-looping, a restart every minute.
 *   report: the pod of a CronJob's Job, restarted in place (restartPolicy
 *     OnFailure) twice.
 *   debug-shell: a pod of no workload at all (kubectl run), restarted once:
 *     no workload names, its restarts counted all the same.
 */
const CONTAINERS = [
  {
    namespace: "payments",
    pod: "web-7d9f-abc",
    container: "web",
    workload: {
      "k8s.deployment.name": "web",
      "k8s.replicaset.name": "web-7d9f",
      "k8s.pod.label.app": "web",
    },
    samples: [3, 3, 4, 4, 5, 7, 8].map((count) => {
      return { podUid: "web-uid", count };
    }),
  },
  {
    namespace: "data",
    pod: "db-0",
    container: "postgres",
    workload: {
      "k8s.statefulset.name": "db",
      "k8s.pod.label.app.kubernetes.io/name": "postgres",
    },
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
    workload: {
      "k8s.deployment.name": "cache",
      "k8s.replicaset.name": "cache-6b7f",
      "k8s.pod.label.app": "cache",
    },
    samples: [6, 6, 0, 0, 1, 1, 1].map((count) => {
      return { podUid: "cache-uid", count };
    }),
  },
  {
    namespace: "payments",
    pod: "ledger-66f8-q9z",
    container: "ledger",
    workload: {
      "k8s.deployment.name": "ledger",
      "k8s.replicaset.name": "ledger-66f8",
    },
    samples: [40, 40, 40, 40, 40, 40, 40].map((count) => {
      return { podUid: "ledger-uid", count };
    }),
  },
  {
    namespace: "kube-system",
    pod: "node-agent-q8xz",
    container: "agent",
    workload: {
      "k8s.daemonset.name": "node-agent",
      "k8s.pod.label.app.kubernetes.io/name": "node-agent",
    },
    samples: [2, 2, 3, 3, 4, 4, 5].map((count) => {
      return { podUid: "node-agent-uid", count };
    }),
  },
  {
    namespace: "batch",
    pod: "report-28851120-x7k2p",
    container: "report",
    workload: {
      "k8s.job.name": "report-28851120",
      "k8s.cronjob.name": "report",
    },
    samples: [0, 1, 1, 2, 2, 2, 2].map((count) => {
      return { podUid: "report-uid", count };
    }),
  },
  {
    namespace: "default",
    pod: "debug-shell",
    container: "shell",
    workload: {},
    samples: [1, 1, 1, 2, 2, 2, 2].map((count) => {
      return { podUid: "debug-shell-uid", count };
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
 * left on. keyedBy "names-from" makes them as they would come out if the
 * workload names were added BEFORE cumulative_to_delta and k8sattributes
 * found the pod only from sample `namesFrom` on (a pod it has not seen
 * yet): the names would be part of the series, and the sample they first
 * appear at would start a new one.
 */
function restartIncreasesFrom(samples, keyedBy = "pod", namesFrom = 0) {
  const previousBySeries = new Map();
  const out = [];
  samples.forEach((sample, index) => {
    let series = sample.podUid;
    if (keyedBy === "container-id") {
      series = containerIdOf(sample);
    } else if (keyedBy === "names-from") {
      series = `${sample.podUid}|${index >= namesFrom ? "named" : "unnamed"}`;
    }
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
  "node-agent-q8xz/agent 1 0",
  "node-agent-q8xz/agent 2 1",
  "node-agent-q8xz/agent 3 0",
  "node-agent-q8xz/agent 4 1",
  "node-agent-q8xz/agent 5 0",
  "node-agent-q8xz/agent 6 1",
  "report-28851120-x7k2p/report 1 1",
  "report-28851120-x7k2p/report 2 0",
  "report-28851120-x7k2p/report 3 1",
  "report-28851120-x7k2p/report 4 0",
  "report-28851120-x7k2p/report 5 0",
  "report-28851120-x7k2p/report 6 0",
  "debug-shell/shell 1 0",
  "debug-shell/shell 2 0",
  "debug-shell/shell 3 1",
  "debug-shell/shell 4 0",
  "debug-shell/shell 5 0",
  "debug-shell/shell 6 0",
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
 * for a pod, k8s.pod.phase on the pod's resource. No workload name: the
 * receiver puts none on either.
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

// Every pod of the samples, by UID, with what k8sattributes finds for it.
function podsByUid() {
  const pods = new Map();
  for (const entry of CONTAINERS) {
    for (const sample of entry.samples) {
      pods.set(sample.podUid, { pod: entry.pod, workload: entry.workload });
    }
  }
  return pods;
}

/*
 * The stand-in for k8sattributes: in resource context, for every pod it
 * knows by UID, each workload attribute k8sattributes would add, only where
 * the resource does not carry it yet (k8sattributes never overwrites one).
 * It runs where k8sattributes runs in the metrics pipeline, so on the
 * increases after their conversion.
 */
function k8sAttributesStandIn() {
  const statements = [];
  for (const [podUid, { workload }] of podsByUid()) {
    for (const [key, value] of Object.entries(workload)) {
      statements.push(
        `set(attributes["${key}"], "${value}") where attributes["k8s.pod.uid"] == "${podUid}" and attributes["${key}"] == nil`,
      );
    }
  }
  return {
    error_mode: "ignore",
    metric_statements: [{ context: "resource", statements }],
  };
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

// The metrics pipeline's processors this runs, in k8sattributes' stead its stand-in.
function liftedMetricsProcessors() {
  return METRICS_PIPELINE_PROCESSORS.filter((name) => {
    return name !== "memory_limiter" && name !== "batch";
  }).map((name) => {
    return name === K8S_ATTRIBUTES ? K8S_ATTRIBUTES_STAND_IN : name;
  });
}

/*
 * The collector config that runs both pipelines, from a parsed cluster
 * collector config, after checking that they are wired as the chart says:
 * the restarts pipeline from k8s_cluster through its processors into the
 * connector, the metrics pipeline from k8s_cluster and the connector
 * through k8sattributes to the exporter.
 */
function behaviourConfig(collector) {
  const pipeline = collector.service.pipelines[PIPELINE];
  if (!pipeline) {
    fail(`the cluster collector has no ${PIPELINE} pipeline`);
  }
  const expected = ["memory_limiter", ...LIFTED_PROCESSORS];
  if (pipeline.processors.join(",") !== expected.join(",")) {
    fail(`${PIPELINE} runs ${pipeline.processors.join(", ")}`);
  }
  if (pipeline.receivers.join(",") !== "k8s_cluster") {
    fail(`${PIPELINE} receives from ${pipeline.receivers.join(", ")}`);
  }
  if (pipeline.exporters.join(",") !== CONNECTOR) {
    fail(`${PIPELINE} exports to ${pipeline.exporters.join(", ")}`);
  }
  if (!collector.connectors || !(CONNECTOR in collector.connectors)) {
    fail(`the cluster collector has no ${CONNECTOR} connector`);
  }

  const metrics = collector.service.pipelines[METRICS_PIPELINE];
  // The metrics pipeline still gets what k8s_cluster sends, and the increases.
  if (
    !metrics.receivers.includes("k8s_cluster") ||
    !metrics.receivers.includes(CONNECTOR)
  ) {
    fail(
      `the ${METRICS_PIPELINE} pipeline receives from ${metrics.receivers.join(", ")}`,
    );
  }
  if (metrics.processors.join(",") !== METRICS_PIPELINE_PROCESSORS.join(",")) {
    fail(`${METRICS_PIPELINE} runs ${metrics.processors.join(", ")}`);
  }
  if (metrics.exporters.join(",") !== "otlphttp") {
    fail(`${METRICS_PIPELINE} exports to ${metrics.exporters.join(", ")}`);
  }
  // And no other pipeline takes them from the connector.
  for (const [name, other] of Object.entries(collector.service.pipelines)) {
    if (name !== METRICS_PIPELINE && other.receivers.includes(CONNECTOR)) {
      fail(`${name} receives from ${CONNECTOR} too`);
    }
  }

  const metricsProcessors = liftedMetricsProcessors();
  const processors = {};
  for (const name of LIFTED_PROCESSORS) {
    processors[name] = collector.processors[name];
  }
  for (const name of metricsProcessors) {
    processors[name] =
      name === K8S_ATTRIBUTES_STAND_IN
        ? k8sAttributesStandIn()
        : collector.processors[name];
  }

  return {
    receivers: {
      otlp: { protocols: { http: { endpoint: "0.0.0.0:4318" } } },
    },
    processors,
    connectors: { [CONNECTOR]: collector.connectors[CONNECTOR] },
    exporters: { file: { path: "/out/metrics.json" } },
    service: {
      pipelines: {
        [PIPELINE]: {
          receivers: ["otlp"],
          processors: LIFTED_PROCESSORS,
          exporters: [CONNECTOR],
        },
        [METRICS_PIPELINE]: {
          receivers: ["otlp", CONNECTOR],
          processors: metricsProcessors,
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

function containerOf(point) {
  return CONTAINERS.find((candidate) => {
    return (
      candidate.pod === point.resource["k8s.pod.name"] &&
      candidate.container === point.resource["k8s.container.name"]
    );
  });
}

// A resource's attributes but container.id, in a stable order.
function withoutContainerId(resource) {
  return JSON.stringify(
    Object.keys(resource)
      .filter((key) => {
        return key !== "container.id";
      })
      .sort()
      .map((key) => {
        return [key, resource[key]];
      }),
  );
}

/*
 * What is wrong with the points the collector exported, as a list of
 * sentences; empty when nothing is.
 */
function problemsWith(points) {
  const problems = [];

  const known = new Set([
    INCREASE_METRIC,
    RESTARTS_METRIC,
    READY_METRIC,
    PHASE_METRIC,
  ]);
  const others = [
    ...new Set(
      points
        .filter((point) => {
          return !known.has(point.metric);
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

  const originals = points.filter((point) => {
    return point.metric === RESTARTS_METRIC;
  });

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
    // The metrics pipeline's resource processor ran.
    if (point.resource["k8s.cluster.name"] !== CLUSTER_NAME) {
      problems.push(
        `${at} is for cluster "${point.resource["k8s.cluster.name"]}"`,
      );
    }
    const entry = containerOf(point);
    const index = sampleIndexOf(point.time);
    // Its pod's workload names, as k8sattributes finds them, and no other.
    if (entry) {
      for (const key of [...WORKLOAD_KEYS, ...LABEL_KEYS]) {
        if (point.resource[key] !== entry.workload[key]) {
          problems.push(
            `${at} has ${key} "${point.resource[key]}", not "${entry.workload[key]}"`,
          );
        }
      }
    }
    // It covers the time since its pod's previous sample of the container.
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
    /*
     * And it carries what the count it is made from carries, at the same
     * sample, but container.id: the same workload names, from the same
     * k8sattributes.
     */
    const original = originals.find((candidate) => {
      return (
        candidate.time === point.time &&
        candidate.resource["k8s.pod.uid"] === point.resource["k8s.pod.uid"] &&
        candidate.resource["k8s.container.name"] ===
          point.resource["k8s.container.name"]
      );
    });
    if (!original) {
      problems.push(`${at} has no ${RESTARTS_METRIC} beside it`);
    } else if (
      withoutContainerId(original.resource) !==
      withoutContainerId(point.resource)
    ) {
      problems.push(
        `${at} carries ${withoutContainerId(point.resource)}, ${RESTARTS_METRIC} ${withoutContainerId(original.resource)}`,
      );
    }
  }

  /*
   * A restart does not split a container's series: every increase of one
   * pod's container carries the same attributes, whatever container.id the
   * status named at its sample.
   */
  const attributesBySeries = new Map();
  for (const point of increases) {
    const series = `${point.resource["k8s.pod.uid"]}/${point.resource["k8s.container.name"]}`;
    const attributes = withoutContainerId(point.resource);
    if (!attributesBySeries.has(series)) {
      attributesBySeries.set(series, new Set());
    }
    attributesBySeries.get(series).add(attributes);
  }
  for (const [series, attributes] of attributesBySeries) {
    if (attributes.size !== 1) {
      problems.push(
        `${series}'s increases carry ${attributes.size} sets of attributes`,
      );
    }
  }

  /*
   * The count, the readiness and the phase go on through the metrics
   * pipeline as the receiver sent them, once each per sample: the restarts
   * pipeline sends nothing but the increases.
   */
  const expectedOriginals = CONTAINERS.flatMap((entry) => {
    return entry.samples.map((sample, index) => {
      return `${entry.pod}/${entry.container} ${index} ${sample.count}`;
    });
  }).sort();
  if (
    JSON.stringify(originals.map(lineOf).sort()) !==
    JSON.stringify(expectedOriginals)
  ) {
    problems.push(
      `${RESTARTS_METRIC} came out as [${originals.map(lineOf).sort().join("; ")}]`,
    );
  }
  for (const point of originals) {
    const entry = containerOf(point);
    const sample = entry && entry.samples[sampleIndexOf(point.time)];
    if (
      point.type !== "gauge" ||
      !sample ||
      point.resource["container.id"] !== containerIdOf(sample)
    ) {
      problems.push(
        `${RESTARTS_METRIC} ${lineOf(point)} is a ${point.type} with container.id ${point.resource["container.id"]}, not the receiver's gauge`,
      );
    }
  }
  const ready = points.filter((point) => {
    return point.metric === READY_METRIC;
  });
  if (
    ready.length !== CONTAINERS.length * SAMPLE_SECONDS.length ||
    ready.some((point) => {
      return point.type !== "gauge";
    })
  ) {
    problems.push(`${READY_METRIC} did not go on as the receiver's gauge`);
  }
  const phases = points.filter((point) => {
    return point.metric === PHASE_METRIC;
  });
  if (
    phases.length !== SAMPLE_SECONDS.length ||
    phases.some((point) => {
      return point.type !== "gauge" || point.value !== 2;
    })
  ) {
    problems.push(`${PHASE_METRIC} did not go on as the receiver's gauge`);
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
  METRICS_PIPELINE,
  CONNECTOR,
  LIFTED_PROCESSORS,
  METRICS_PIPELINE_PROCESSORS,
  K8S_ATTRIBUTES,
  K8S_ATTRIBUTES_STAND_IN,
  WORKLOAD_KEYS,
  LABEL_KEYS,
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
  podsByUid,
  k8sAttributesStandIn,
  liftedMetricsProcessors,
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
