"use strict";

/**
 * The node half of agent-job-failures-increase-behaviour.sh: it builds the
 * collector config and payloads that script runs, and checks what the
 * collector sent. Kept out of the shell script so it is plain JavaScript,
 * and its checks are plain functions KubernetesAgentJobFailuresIncrease.test.js
 * runs.
 *
 *   config <rendered chart> <dir>
 *       <dir>/config.yaml: an OTLP receiver, the cluster collector's Job
 *       failures processors exactly as the chart rendered them, then its
 *       resource processor, and a file exporter (/out/metrics.json);
 *       <dir>/image: the collector image the chart runs;
 *       <dir>/scrape-<n>.json: what the metrics pipeline gets at each
 *       sample; <dir>/empty.json.
 *   count <exported metrics.json>
 *       prints how many k8s.job.failed_pods.increase points came out.
 *   expected-count
 *       prints how many the check expects.
 *   check <exported metrics.json> <label>
 *
 * Exits non-zero, saying why, when a check fails.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

// The cluster collector's pipeline the processors run in.
const PIPELINE = "metrics";

// The processors this runs, in the pipeline's order: the two that make the
// increase, then the one that stamps the cluster's name.
const INCREASE_PROCESSORS = [
  "transform/job-failures-increase",
  "cumulative_to_delta/job-failures-increase",
];
const LIFTED_PROCESSORS = [...INCREASE_PROCESSORS, "resource"];

const FAILED_METRIC = "k8s.job.failed_pods";
const INCREASE_METRIC = "k8s.job.failed_pods.increase";
const ACTIVE_METRIC = "k8s.job.active_pods";
const SUCCESSFUL_METRIC = "k8s.job.successful_pods";
const RESTARTS_METRIC = "k8s.container.restarts";
// A Prometheus counter of the API server, which shares the pipeline.
const COUNTER_METRIC = "apiserver_request_total";

// What k8s_cluster declares for k8s.job.failed_pods (metadata.yaml).
const POD_UNIT = "{pod}";

const INCREASE_DESCRIPTION =
  "Pods of the Job that failed since the agent's previous sample of it.";
const FAILED_DESCRIPTION =
  "The number of pods which reached phase Failed for a job";

const K8S_CLUSTER_SCOPE =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/k8sclusterreceiver";
const PROMETHEUS_SCOPE =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/prometheusreceiver";

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
 * What k8s_cluster reads for each Job at each sample: the Job object's UID
 * and its status.failed.
 *
 *   nightly-export: failing its pods one retry after another - 1, 1, 2 and
 *     1 failures between samples, across the five-minute and the hour gaps
 *     too.
 *   db-migrate: had failed 3 pods; deleted and recreated under the same
 *     name before sample 3 (a deploy replacing its migration Job): a new
 *     UID, starting at 0; then one failure.
 *   report-28851120: a CronJob's run that failed once long ago and
 *     succeeded on its retry, kept in the CronJob's history.
 *   legacy-sync: its count went down in the same Job before sample 2 (a
 *     cluster that predates Job tracking with finalizers counts the failed
 *     pods that still exist); then one failure.
 */
const JOBS = [
  {
    namespace: "batch",
    job: "nightly-export",
    samples: [1, 1, 2, 2, 3, 5, 6].map((count) => {
      return { jobUid: "nightly-export-uid", count };
    }),
  },
  {
    namespace: "payments",
    job: "db-migrate",
    samples: [
      { jobUid: "db-migrate-old-uid", count: 3 },
      { jobUid: "db-migrate-old-uid", count: 3 },
      { jobUid: "db-migrate-old-uid", count: 3 },
      { jobUid: "db-migrate-new-uid", count: 0 },
      { jobUid: "db-migrate-new-uid", count: 0 },
      { jobUid: "db-migrate-new-uid", count: 1 },
      { jobUid: "db-migrate-new-uid", count: 1 },
    ],
  },
  {
    namespace: "batch",
    job: "report-28851120",
    samples: [1, 1, 1, 1, 1, 1, 1].map((count) => {
      return { jobUid: "report-uid", count };
    }),
  },
  {
    namespace: "batch",
    job: "legacy-sync",
    samples: [4, 4, 2, 2, 3, 3, 3].map((count) => {
      return { jobUid: "legacy-sync-uid", count };
    }),
  },
];

/*
 * What a Job's samples become, sample by sample, as the chart's processors
 * make them: a series is the Job's resource, so its UID; nothing for a
 * series' first sample, nothing for one whose count went down (the next is
 * measured from it), else the count minus the series' previous sample's -
 * as cumulative_to_delta, with initial_value: drop, makes them.
 */
function failureIncreasesFrom(samples) {
  const previousBySeries = new Map();
  const out = [];
  samples.forEach((sample, index) => {
    const series = sample.jobUid;
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

// What OneUptime must get: "<namespace>/<job> <sample> <increase>".
const EXPECTED_INCREASES = [
  "batch/nightly-export 1 0",
  "batch/nightly-export 2 1",
  "batch/nightly-export 3 0",
  "batch/nightly-export 4 1",
  "batch/nightly-export 5 2",
  "batch/nightly-export 6 1",
  "payments/db-migrate 1 0",
  "payments/db-migrate 2 0",
  // Sample 3: a new Job under the same name, its first sample: nothing.
  "payments/db-migrate 4 0",
  "payments/db-migrate 5 1",
  "payments/db-migrate 6 0",
  "batch/report-28851120 1 0",
  "batch/report-28851120 2 0",
  "batch/report-28851120 3 0",
  "batch/report-28851120 4 0",
  "batch/report-28851120 5 0",
  "batch/report-28851120 6 0",
  "batch/legacy-sync 1 0",
  // Sample 2: its count went down in the same Job: nothing.
  "batch/legacy-sync 3 0",
  "batch/legacy-sync 4 1",
  "batch/legacy-sync 5 0",
  "batch/legacy-sync 6 0",
];

// The API server's request counter at each sample, a cumulative sum.
const COUNTER_VALUES = [100, 130, 165, 190, 240, 600, 9000];

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
 * What the metrics pipeline gets at a sample: from k8s_cluster, for every
 * Job its own resource (the k8s.job entity: keyed by k8s.job.uid, with the
 * Job's name and namespace) with its active, failed and successful pods as
 * int gauges, and a container's k8s.container.restarts gauge; and, from
 * the Prometheus scrape that shares the pipeline, the API server's request
 * counter.
 */
function scrapePayload(index) {
  const scope = { name: K8S_CLUSTER_SCOPE, version: "0.161.0" };

  const resourceMetrics = JOBS.map((entry) => {
    const sample = entry.samples[index];
    return {
      resource: {
        attributes: [
          stringAttribute("k8s.job.uid", sample.jobUid),
          stringAttribute("k8s.job.name", entry.job),
          stringAttribute("k8s.namespace.name", entry.namespace),
        ],
      },
      scopeMetrics: [
        {
          scope,
          metrics: [
            gauge(
              ACTIVE_METRIC,
              POD_UNIT,
              "The number of actively running pods for a job",
              sample.count === 0 ? 1 : 0,
              index,
            ),
            gauge(
              FAILED_METRIC,
              POD_UNIT,
              FAILED_DESCRIPTION,
              sample.count,
              index,
            ),
            gauge(
              SUCCESSFUL_METRIC,
              POD_UNIT,
              "The number of pods which reached phase Succeeded for a job",
              entry.job === "report-28851120" ? 1 : 0,
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
        stringAttribute("container.id", "api-run-3"),
        stringAttribute("k8s.container.name", "api"),
        stringAttribute("k8s.pod.name", "api-7d9f-abc"),
        stringAttribute("k8s.pod.uid", "api-uid"),
        stringAttribute("k8s.namespace.name", "payments"),
      ],
    },
    scopeMetrics: [
      {
        scope,
        metrics: [
          gauge(
            RESTARTS_METRIC,
            "{restart}",
            "How many times the container has restarted in the recent past.",
            3,
            index,
          ),
        ],
      },
    ],
  });

  resourceMetrics.push({
    resource: {
      attributes: [
        stringAttribute("service.name", "kube-apiserver"),
        stringAttribute("server.address", "kubernetes.default.svc"),
      ],
    },
    scopeMetrics: [
      {
        scope: { name: PROMETHEUS_SCOPE, version: "0.161.0" },
        metrics: [
          {
            name: COUNTER_METRIC,
            unit: "",
            description: "Counter of apiserver requests.",
            sum: {
              aggregationTemporality: CUMULATIVE,
              isMonotonic: true,
              dataPoints: [
                {
                  startTimeUnixNano: START_NANO.toString(),
                  timeUnixNano: sampleTimeNano(index),
                  asInt: String(COUNTER_VALUES[index]),
                },
              ],
            },
          },
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
 * The collector config that runs the processors, from a parsed cluster
 * collector config, after checking that its metrics pipeline runs them
 * where the chart says: right after the memory limiter, the copy first,
 * on what k8s_cluster sends.
 */
function behaviourConfig(collector) {
  const pipeline = collector.service.pipelines[PIPELINE];
  if (!pipeline) {
    fail(`the cluster collector has no ${PIPELINE} pipeline`);
  }
  const lead = pipeline.processors.slice(0, 1 + INCREASE_PROCESSORS.length);
  if (lead.join(",") !== ["memory_limiter", ...INCREASE_PROCESSORS].join(",")) {
    fail(`${PIPELINE} runs ${pipeline.processors.join(", ")}`);
  }
  if (!pipeline.processors.includes("resource")) {
    fail(`${PIPELINE} runs no resource processor`);
  }
  if (!pipeline.receivers.includes("k8s_cluster")) {
    fail(`${PIPELINE} receives from ${pipeline.receivers.join(", ")}`);
  }
  if (pipeline.exporters.join(",") !== "otlphttp") {
    fail(`${PIPELINE} exports to ${pipeline.exporters.join(", ")}`);
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
  return `${point.resource["k8s.namespace.name"]}/${point.resource["k8s.job.name"]} ${sampleIndexOf(point.time)} ${point.value}`;
}

function jobOf(point) {
  return JOBS.find((candidate) => {
    return (
      candidate.job === point.resource["k8s.job.name"] &&
      candidate.namespace === point.resource["k8s.namespace.name"]
    );
  });
}

/*
 * What is wrong with the points the collector exported, as a list of
 * sentences; empty when nothing is.
 */
function problemsWith(points) {
  const problems = [];

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
    if (point.unit !== POD_UNIT) {
      problems.push(`${at} is in "${point.unit}"`);
    }
    if (point.description !== INCREASE_DESCRIPTION) {
      problems.push(`${at} is described "${point.description}"`);
    }
    if (point.scope !== K8S_CLUSTER_SCOPE) {
      problems.push(`${at} left the k8s_cluster scope (${point.scope})`);
    }
    // The Job's own resource: its UID is what tells a recreated Job apart.
    for (const key of ["k8s.job.uid", "k8s.job.name", "k8s.namespace.name"]) {
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
    // It covers the time since the Job's previous sample.
    const entry = jobOf(point);
    const index = sampleIndexOf(point.time);
    const counted = entry
      ? failureIncreasesFrom(entry.samples).find((candidate) => {
          return candidate.sample === index;
        })
      : undefined;
    if (counted && point.start !== sampleTimeNano(counted.since)) {
      problems.push(
        `${at} starts at ${point.start}, not at its previous sample (${sampleTimeNano(counted.since)})`,
      );
    }
    if (
      entry &&
      point.resource["k8s.job.uid"] !== entry.samples[index]?.jobUid
    ) {
      problems.push(`${at} is for Job ${point.resource["k8s.job.uid"]}`);
    }
  }

  /*
   * The count it is copied from goes on as the receiver sent it: every
   * sample of every Job, a gauge with the Job's count.
   */
  const originals = points.filter((point) => {
    return point.metric === FAILED_METRIC;
  });
  const expectedOriginals = JOBS.flatMap((entry) => {
    return entry.samples.map((sample, index) => {
      return `${entry.namespace}/${entry.job} ${index} ${sample.count}`;
    });
  }).sort();
  if (
    JSON.stringify(originals.map(lineOf).sort()) !==
    JSON.stringify(expectedOriginals)
  ) {
    problems.push(
      `${FAILED_METRIC} came out as [${originals.map(lineOf).sort().join("; ")}]`,
    );
  }
  for (const point of originals) {
    if (point.type !== "gauge" || point.description !== FAILED_DESCRIPTION) {
      problems.push(
        `${FAILED_METRIC} ${lineOf(point)} is a ${point.type} described "${point.description}", not the receiver's gauge`,
      );
    }
  }

  // The rest of what shares the pipeline goes on as it came.
  const jobGauges = points.filter((point) => {
    return point.metric === ACTIVE_METRIC || point.metric === SUCCESSFUL_METRIC;
  });
  if (
    jobGauges.length !== 2 * JOBS.length * SAMPLE_SECONDS.length ||
    jobGauges.some((point) => {
      return point.type !== "gauge";
    })
  ) {
    problems.push(
      `the Jobs' other gauges came out as ${jobGauges.length} points of ${[...new Set(jobGauges.map((point) => point.type))].join(", ")}`,
    );
  }
  const restarts = points.filter((point) => {
    return point.metric === RESTARTS_METRIC;
  });
  if (
    restarts.length !== SAMPLE_SECONDS.length ||
    restarts.some((point) => {
      return point.type !== "gauge" || point.value !== 3;
    })
  ) {
    problems.push(`${RESTARTS_METRIC} did not go on as the receiver's gauge`);
  }
  const counter = points.filter((point) => {
    return point.metric === COUNTER_METRIC;
  });
  if (
    counter.length !== SAMPLE_SECONDS.length ||
    counter.some((point) => {
      return (
        point.type !== "sum" ||
        point.temporality !== CUMULATIVE ||
        point.value !== COUNTER_VALUES[sampleIndexOf(point.time)]
      );
    })
  ) {
    problems.push(
      `${COUNTER_METRIC} did not go on as the cumulative counter it came as`,
    );
  }

  const known = new Set([
    INCREASE_METRIC,
    FAILED_METRIC,
    ACTIVE_METRIC,
    SUCCESSFUL_METRIC,
    RESTARTS_METRIC,
    COUNTER_METRIC,
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
  INCREASE_PROCESSORS,
  LIFTED_PROCESSORS,
  FAILED_METRIC,
  INCREASE_METRIC,
  ACTIVE_METRIC,
  SUCCESSFUL_METRIC,
  RESTARTS_METRIC,
  COUNTER_METRIC,
  POD_UNIT,
  INCREASE_DESCRIPTION,
  FAILED_DESCRIPTION,
  K8S_CLUSTER_SCOPE,
  PROMETHEUS_SCOPE,
  CLUSTER_NAME,
  DELTA,
  CUMULATIVE,
  START_NANO,
  SAMPLE_SECONDS,
  JOBS,
  EXPECTED_INCREASES,
  COUNTER_VALUES,
  failureIncreasesFrom,
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
