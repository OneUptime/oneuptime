"use strict";

/**
 * The node half of agent-volume-series-behaviour.sh: it builds the collector
 * config and the payload that script runs, and checks what the collector
 * sent. Kept out of the shell script so it is plain JavaScript, and its checks
 * are plain functions KubernetesAgentVolumeSeries.test.js runs.
 *
 *   config <rendered chart> <dir>
 *       <dir>/config.yaml: an OTLP receiver, the node collector's
 *       filter/volume-series exactly as the chart rendered it, and a file
 *       exporter (/out/metrics.json); <dir>/image: the collector image the
 *       chart runs; <dir>/payload.json: one scrape of what the kubelet_stats
 *       receiver sends for every kind of volume a pod mounts, under each name
 *       a volume can go by, beside a node's, a pod's and a container's own
 *       series; <dir>/empty.json.
 *   count <exported metrics.json>
 *       prints how many points came out.
 *   expected-count
 *       prints how many the check expects.
 *   check <exported metrics.json> <label>
 *
 * Exits non-zero, saying why, when a check fails.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { componentTypeFor } = require("./CollectorComponentTypes");

const FILTER = "filter/volume-series";
const PIPELINE = "metrics";
// The receiver, by the type the chart's pinned collector knows it by.
const RECEIVER = "kubelet_stats";
const CONFIG_MAP = "behaviour-kubernetes-agent-daemonset";
const DAEMON_SET = "behaviour-kubernetes-agent-logs";
const KUBELETSTATS_SCOPE =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/kubeletstatsreceiver";

// The five series the receiver's volume group sends for each volume.
const VOLUME_METRICS = [
  "k8s.volume.available",
  "k8s.volume.capacity",
  "k8s.volume.inodes",
  "k8s.volume.inodes.free",
  "k8s.volume.inodes.used",
];

/*
 * The same five as semantic conventions name them (k8s.pod.volume.*, model/k8s
 * metrics.yaml), which the receiver is to follow: up-down counters, so sums
 * that never only rise.
 */
const POD_VOLUME_METRICS = [
  "k8s.pod.volume.available",
  "k8s.pod.volume.capacity",
  "k8s.pod.volume.inode.count",
  "k8s.pod.volume.inode.free",
  "k8s.pod.volume.inode.used",
];

/*
 * The names a collector gives a volume (#10055). The receiver names it
 * k8s.volume.name and k8s.volume.type; semantic conventions renamed those
 * k8s.pod.volume.name and k8s.pod.volume.type (semantic-conventions#4272),
 * and name its series k8s.pod.volume.*. A receiver that follows them may
 * rename the attributes alone first, or everything at once, or send both
 * names for a while: the filter must keep and drop the same volumes under
 * every one.
 */
const NAMINGS = [
  {
    label: "receiver",
    names: ["k8s.volume.name"],
    types: ["k8s.volume.type"],
    metrics: VOLUME_METRICS,
  },
  {
    label: "semconv-attributes",
    names: ["k8s.pod.volume.name"],
    types: ["k8s.pod.volume.type"],
    metrics: VOLUME_METRICS,
  },
  {
    label: "semconv",
    names: ["k8s.pod.volume.name"],
    types: ["k8s.pod.volume.type"],
    metrics: POD_VOLUME_METRICS,
  },
  {
    label: "both",
    names: ["k8s.volume.name", "k8s.pod.volume.name"],
    types: ["k8s.volume.type", "k8s.pod.volume.type"],
    metrics: VOLUME_METRICS,
  },
];

const NAMESPACE = "shop";
const POD = "web-0";
const POD_UID = "6b1c0d3e-5a0f-4c1e-9d61-0e0f0a0b0c0d";
const NODE = "node-1";
const TIME_NANO = "1700000060000000000";

/*
 * Every kind of volume a pod mounts, as the receiver names and types it
 * (extra_metadata_labels k8s.volume.type): the type it gives each from the
 * pod's spec, none for a projected or a generic ephemeral volume (collector
 * 0.165.0), and `projected` or `ephemeral` as a collector that gives them is
 * to (opentelemetry-collector-contrib#52198). `kept` is what OneUptime needs
 * of each: the disks it shows, never a few files in memory.
 */
const VOLUMES = [
  // A few small files in memory, dropped by the type the receiver gives them.
  { name: "config", type: "configMap", kept: false },
  { name: "tls", type: "secret", kept: false },
  { name: "podinfo", type: "downwardAPI", kept: false },
  // A projected volume the collector types: dropped whatever it is called.
  { name: "bundle", type: "projected", kept: false },
  { name: "kube-api-access-x7k2p", type: "projected", kept: false },
  // Tokens on a collector that types no projected volume: told by name.
  { name: "kube-api-access-x7k2p", kept: false },
  { name: "aws-iam-token", kept: false },
  { name: "eks-pod-identity-token", kept: false },
  { name: "azure-identity-token", kept: false },
  { name: "istio-token", kept: false },
  { name: "linkerd-identity-token", kept: false },
  /*
   * No type and no token's name: a projected volume of another name on such
   * a collector, or a generic ephemeral volume, whose claim the ingest names.
   * Neither can be told from the other here, so both are kept.
   */
  { name: "bundle", kept: true },
  { name: "scratch", kept: true },
  // A token's name only in part is no token's.
  { name: "kube-api-access-x7k2p-old", kept: true },
  { name: "my-istio-token", kept: true },
  // A generic ephemeral volume the collector types, its claim named or not.
  { name: "scratch", type: "ephemeral", kept: true },
  { name: "scratch", type: "ephemeral", claim: "web-0-scratch", kept: true },
  // The volumes that hold data: a claim's, an emptyDir and a hostPath.
  {
    name: "data",
    type: "persistentVolumeClaim",
    claim: "data-web-0",
    kept: true,
  },
  { name: "cache", type: "emptyDir", kept: true },
  { name: "host-logs", type: "hostPath", kept: true },
  // A claim is kept whatever its volume is called.
  {
    name: "istio-token",
    type: "persistentVolumeClaim",
    claim: "istio-token",
    kept: true,
  },
];

/*
 * The series beside them that are no volume's, which the filter must never
 * touch: the node's root filesystem, a pod's and a container's.
 */
const OTHERS = [
  { label: "node", metric: "k8s.node.filesystem.available" },
  { label: "pod", metric: "k8s.pod.filesystem.usage" },
  { label: "container", metric: "container.filesystem.available" },
];

function fail(message) {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}

// The name each volume's points carry, so an export says which came through.
function caseOf(volume, naming = NAMINGS[0]) {
  return [
    naming.label,
    volume.type || "untyped",
    volume.name,
    volume.claim ? `claim=${volume.claim}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function stringAttribute(key, value) {
  return { key, value: { stringValue: value } };
}

/*
 * A volume's resource as a collector sends it: its pod's, and its own, under
 * the naming's names.
 */
function volumeResourceAttributes(volume, naming = NAMINGS[0]) {
  const attributes = [
    stringAttribute("k8s.pod.uid", POD_UID),
    stringAttribute("k8s.pod.name", POD),
    stringAttribute("k8s.namespace.name", NAMESPACE),
  ];
  for (const key of naming.names) {
    attributes.push(stringAttribute(key, volume.name));
  }
  if (volume.type) {
    for (const key of naming.types) {
      attributes.push(stringAttribute(key, volume.type));
    }
  }
  if (volume.claim) {
    attributes.push(
      stringAttribute("k8s.persistentvolumeclaim.name", volume.claim),
    );
  }
  return attributes;
}

function otherResourceAttributes(other) {
  if (other.label === "node") {
    return [stringAttribute("k8s.node.name", NODE)];
  }
  const attributes = [
    stringAttribute("k8s.pod.uid", POD_UID),
    stringAttribute("k8s.pod.name", POD),
    stringAttribute("k8s.namespace.name", NAMESPACE),
  ];
  if (other.label === "container") {
    attributes.push(stringAttribute("k8s.container.name", "app"));
  }
  return attributes;
}

function gauge(name, label, value) {
  return {
    name,
    unit: name.includes("inode") ? "1" : "By",
    gauge: {
      dataPoints: [
        {
          attributes: [stringAttribute("case", label)],
          timeUnixNano: TIME_NANO,
          asInt: String(value),
        },
      ],
    },
  };
}

// A semantic conventions volume series: an up-down counter.
function upDownCounter(name, label, value) {
  const { gauge: points, ...metric } = gauge(name, label, value);
  return {
    ...metric,
    sum: {
      aggregationTemporality: 2,
      isMonotonic: false,
      dataPoints: points.dataPoints,
    },
  };
}

function volumeSeries(name, label, value) {
  return POD_VOLUME_METRICS.includes(name)
    ? upDownCounter(name, label, value)
    : gauge(name, label, value);
}

function resourceMetrics(attributes, metrics) {
  return {
    resource: { attributes },
    scopeMetrics: [{ scope: { name: KUBELETSTATS_SCOPE }, metrics }],
  };
}

/*
 * One scrape: every volume's five series under every naming, and the node's,
 * pod's and container's.
 */
function scrapePayload() {
  return {
    resourceMetrics: [
      ...NAMINGS.flatMap((naming) => {
        return VOLUMES.map((volume) => {
          return resourceMetrics(
            volumeResourceAttributes(volume, naming),
            naming.metrics.map((metric, index) => {
              return volumeSeries(
                metric,
                caseOf(volume, naming),
                1024 * (index + 1),
              );
            }),
          );
        });
      }),
      ...OTHERS.map((other) => {
        return resourceMetrics(otherResourceAttributes(other), [
          gauge(other.metric, other.label, 4096),
        ]);
      }),
    ],
  };
}

/*
 * What must come out: each kept volume's five series under every naming, and
 * every other one.
 */
function expectedLines() {
  const lines = [];
  for (const naming of NAMINGS) {
    for (const volume of VOLUMES) {
      if (!volume.kept) {
        continue;
      }
      for (const metric of naming.metrics) {
        lines.push(`${metric} ${caseOf(volume, naming)}`);
      }
    }
  }
  for (const other of OTHERS) {
    lines.push(`${other.metric} ${other.label}`);
  }
  return lines.sort();
}

function readRenderedDaemonSet(renderedFile) {
  const docs = yaml
    .loadAll(fs.readFileSync(renderedFile, "utf8"))
    .filter(Boolean);
  const configMap = docs.find((doc) => {
    return doc.kind === "ConfigMap" && doc.metadata.name === CONFIG_MAP;
  });
  const daemonSet = docs.find((doc) => {
    return doc.kind === "DaemonSet" && doc.metadata.name === DAEMON_SET;
  });
  if (!configMap || !daemonSet) {
    fail(`${renderedFile}: no node collector ConfigMap and DaemonSet`);
  }
  return {
    collector: yaml.load(configMap.data["otel-collector-config.yaml"]),
    image: daemonSet.spec.template.spec.containers[0].image,
  };
}

/*
 * The collector config that runs the filter, from a parsed node collector
 * config, after checking that its metrics pipeline runs it where the chart
 * says: first after the memory limiter, on what the kubelet receiver sends,
 * named as the collector `image` knows it (kubeletstats on the 0.96.0 a
 * --reuse-values upgrade keeps; with no image, as the chart's pin does).
 */
function behaviourConfig(collector, image) {
  const receiver = image ? componentTypeFor(RECEIVER, image) : RECEIVER;
  const pipeline = collector.service.pipelines[PIPELINE];
  if (!pipeline) {
    fail(`the node collector has no ${PIPELINE} pipeline`);
  }
  if (
    pipeline.processors.slice(0, 2).join(",") !== `memory_limiter,${FILTER}`
  ) {
    fail(`${PIPELINE} runs ${pipeline.processors.join(", ")}`);
  }
  if (!pipeline.receivers.includes(receiver)) {
    fail(`${PIPELINE} receives from ${pipeline.receivers.join(", ")}`);
  }
  if (!collector.processors[FILTER]) {
    fail(`the node collector defines no ${FILTER}`);
  }

  return {
    receivers: {
      otlp: { protocols: { http: { endpoint: "0.0.0.0:4318" } } },
    },
    processors: { [FILTER]: collector.processors[FILTER] },
    exporters: { file: { path: "/out/metrics.json" } },
    service: {
      pipelines: {
        metrics: {
          receivers: ["otlp"],
          processors: [FILTER],
          exporters: ["file"],
        },
      },
    },
  };
}

function writeConfig(renderedFile, dir) {
  const { collector, image } = readRenderedDaemonSet(renderedFile);
  fs.writeFileSync(
    path.join(dir, "config.yaml"),
    yaml.dump(behaviourConfig(collector, image)),
  );
  fs.writeFileSync(path.join(dir, "image"), image);
  fs.writeFileSync(
    path.join(dir, "payload.json"),
    JSON.stringify(scrapePayload()),
  );
  fs.writeFileSync(
    path.join(dir, "empty.json"),
    JSON.stringify({ resourceMetrics: [] }),
  );
}

/*
 * The points of a file exporter's output (one request per line), each with
 * its metric, its case and its resource's attributes.
 */
function readExported(file) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  // A last line without its newline is still being written.
  const lines = text.split("\n");
  lines.pop();
  const points = [];
  for (const line of lines.filter(Boolean)) {
    for (const rm of JSON.parse(line).resourceMetrics || []) {
      for (const sm of rm.scopeMetrics || []) {
        for (const metric of sm.metrics || []) {
          const dataPoints =
            (metric.gauge || metric.sum || {}).dataPoints || [];
          for (const point of dataPoints) {
            const label = (point.attributes || []).find((attribute) => {
              return attribute.key === "case";
            });
            points.push({
              metric: metric.name,
              label: label ? label.value.stringValue : "",
              resource: (rm.resource || {}).attributes || [],
            });
          }
        }
      }
    }
  }
  return points;
}

function lineOf(point) {
  return `${point.metric} ${point.label}`;
}

function attributesText(attributes) {
  return JSON.stringify(
    [...attributes]
      .map((attribute) => {
        return [attribute.key, attribute.value.stringValue];
      })
      .sort(),
  );
}

// What was sent for a line: its resource's attributes, or undefined.
function sentResourceOf(line) {
  for (const naming of NAMINGS) {
    for (const volume of VOLUMES) {
      for (const metric of naming.metrics) {
        if (`${metric} ${caseOf(volume, naming)}` === line) {
          return volumeResourceAttributes(volume, naming);
        }
      }
    }
  }
  for (const other of OTHERS) {
    if (`${other.metric} ${other.label}` === line) {
      return otherResourceAttributes(other);
    }
  }
  return undefined;
}

/*
 * Everything wrong with an export: a series missing that must be kept, one
 * sent that must be dropped, one sent twice, and a resource that came out
 * other than it went in (the filter drops; it changes nothing).
 */
function problemsWith(points) {
  const problems = [];
  const expected = expectedLines();
  const got = points.map(lineOf);

  const missing = expected.filter((line) => {
    return !got.includes(line);
  });
  if (missing.length > 0) {
    problems.push(`it dropped ${missing.join(", ")}`);
  }

  const extra = [
    ...new Set(
      got.filter((line) => {
        return !expected.includes(line);
      }),
    ),
  ];
  if (extra.length > 0) {
    problems.push(`it sent ${extra.join(", ")}`);
  }

  const twice = [
    ...new Set(
      got.filter((line, index) => {
        return got.indexOf(line) !== index;
      }),
    ),
  ];
  if (twice.length > 0) {
    problems.push(`it sent more than once ${twice.join(", ")}`);
  }

  for (const point of points) {
    const sent = sentResourceOf(lineOf(point));
    if (sent && attributesText(sent) !== attributesText(point.resource)) {
      problems.push(
        `${lineOf(point)} came out with ${attributesText(point.resource)}`,
      );
    }
  }

  if (got.length === 0) {
    problems.push("nothing came out");
  }

  return problems;
}

function check(exported, label) {
  const points = readExported(exported);
  const got = points.map(lineOf);
  const expected = expectedLines();
  for (const line of expected) {
    console.log(`    ${got.includes(line) ? "ok    " : "MISSING"} ${line}`);
  }
  for (const line of got.filter((candidate) => {
    return !expected.includes(candidate);
  })) {
    console.log(`    EXTRA  ${line}`);
  }
  const problems = problemsWith(points);
  if (problems.length > 0) {
    fail(`${label}: ${problems.join("; ")}`);
  }
}

function count(exported) {
  return readExported(exported).length;
}

module.exports = {
  FILTER,
  PIPELINE,
  RECEIVER,
  VOLUME_METRICS,
  POD_VOLUME_METRICS,
  NAMINGS,
  VOLUMES,
  OTHERS,
  caseOf,
  volumeResourceAttributes,
  otherResourceAttributes,
  scrapePayload,
  expectedLines,
  behaviourConfig,
  readExported,
  problemsWith,
};

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "config") {
    writeConfig(args[0], args[1]);
  } else if (command === "count") {
    console.log(count(args[0]));
  } else if (command === "expected-count") {
    console.log(expectedLines().length);
  } else if (command === "check") {
    check(args[0], args[1]);
  } else {
    fail(`unknown command ${command}`);
  }
}
