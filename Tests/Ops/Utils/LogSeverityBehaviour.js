"use strict";

/**
 * The work of agent-log-severity-behaviour.sh, which runs the agents' log
 * severity chain in the real collector:
 *
 *   fixtures <layout> <dir>       write the corpus (LogSeverityCorpus.js) into
 *                                 <dir> as a container runtime writes logs to
 *                                 disk, one container per case, and the cases
 *                                 to <dir>/../cases.json
 *   config <target> <source> <dir> [--min-severity]
 *                                 the collector config for one run: the
 *                                 target's own filelog receiver, exactly as it
 *                                 ships but read from the beginning, and a
 *                                 file exporter (with the chart's
 *                                 filter/telemetry for --min-severity)
 *   check <cases.json> <exported> <collector.log> [--min-severity LEVEL]
 *                                 what the collector sent, case by case:
 *                                 each record at its case's level, and
 *                                 at the number the one table of level
 *                                 words names for the text it carries
 *
 * Layouts: "pods" is a Kubernetes node's /var/log/pods (CRI lines, as
 * containerd writes them), "docker" Docker's json-file logs, "podman"
 * Podman's k8s-file logs.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const { CASES, PROSE } = require("./LogSeverityCorpus.js");

const SEVERITY_RANK = {
  Trace: 1,
  Debug: 2,
  Information: 3,
  Warning: 4,
  Error: 5,
  Fatal: 6,
};

const MIN_SEVERITY_RANK = {
  TRACE: 1,
  DEBUG: 2,
  INFO: 3,
  WARN: 4,
  ERROR: 5,
  FATAL: 6,
};

/** Every record the run writes: each case, and each line of prose on both streams. */
function allRecords() {
  return [
    ...CASES.map((entry) => {
      return {
        name: entry.name,
        stream: entry.stream,
        body: entry.body,
        severity: entry.severity,
      };
    }),
    ...PROSE.flatMap((body) => {
      return [
        {
          name: `prose on stdout: ${body}`,
          stream: "stdout",
          body,
          severity: "Information",
        },
        {
          name: `prose on stderr: ${body}`,
          stream: "stderr",
          body,
          severity: "Unspecified",
        },
      ];
    }),
  ];
}

function timestamp(index, line) {
  // A distinct, increasing time for each line; containerd writes nanoseconds.
  const nanos = String(index * 1000 + line).padStart(9, "0");

  return `2026-11-26T04:02:18.${nanos}Z`;
}

function hexId(index) {
  return index.toString(16).padStart(64, "0");
}

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function fixtures(layout, dir) {
  const cases = allRecords().map((record, index) => {
    const lines = record.body.split("\n");
    let id;

    if (layout === "pods") {
      // /var/log/pods/<namespace>_<pod>_<uid>/<container>/<restart>.log; the
      // chart's filelog receiver reads the pod's name off the path.
      id = `case-${index}`;
      const uid = `00000000-0000-0000-0000-${index.toString(16).padStart(12, "0")}`;

      writeFile(
        path.join(dir, `severity_${id}_${uid}`, "app", "0.log"),
        lines
          .map((line, n) => {
            return `${timestamp(index, n)} ${record.stream} F ${line}\n`;
          })
          .join(""),
      );
    } else if (layout === "docker") {
      // /var/lib/docker/containers/<id>/<id>-json.log; json-file keeps each
      // line's newline in `log`.
      id = hexId(index);

      writeFile(
        path.join(dir, id, `${id}-json.log`),
        lines
          .map((line, n) => {
            return `${JSON.stringify({ log: `${line}\n`, stream: record.stream, time: timestamp(index, n) })}\n`;
          })
          .join(""),
      );
    } else if (layout === "podman") {
      // /var/lib/containers/storage/overlay-containers/<id>/userdata/ctr.log
      id = hexId(index);

      writeFile(
        path.join(dir, id, "userdata", "ctr.log"),
        lines
          .map((line, n) => {
            return `${timestamp(index, n)} ${record.stream} F ${line}\n`;
          })
          .join(""),
      );
    } else {
      throw new Error(`unknown layout ${layout}`);
    }

    return { ...record, id };
  });

  writeFile(path.join(dir, "..", "cases.json"), JSON.stringify(cases, null, 2));
}

/** The filelog receiver of a collector config, under whichever name it has. */
function fileLogReceiver(collector) {
  const name = Object.keys(collector.receivers).find((receiver) => {
    return receiver === "filelog" || receiver === "file_log";
  });

  if (!name) {
    throw new Error("the config has no filelog receiver");
  }

  return { name, receiver: collector.receivers[name] };
}

function config(target, source, dir, withFilter) {
  let collector;
  let image = null;

  if (target === "kubernetes") {
    const docs = yaml.loadAll(fs.readFileSync(source, "utf8")).filter(Boolean);
    const configMap = docs.find((doc) => {
      return doc.kind === "ConfigMap" && /-daemonset$/.test(doc.metadata.name);
    });
    // The node collector: the DaemonSet that mounts that ConfigMap.
    const daemonSet = docs.find((doc) => {
      return (
        doc.kind === "DaemonSet" &&
        configMap &&
        (doc.spec.template.spec.volumes || []).some((volume) => {
          return (
            volume.configMap &&
            volume.configMap.name === configMap.metadata.name
          );
        })
      );
    });

    if (!configMap || !daemonSet) {
      throw new Error(
        "the node collector's DaemonSet or its ConfigMap is not in the render",
      );
    }

    collector = yaml.load(configMap.data["otel-collector-config.yaml"]);
    image = daemonSet.spec.template.spec.containers[0].image;
  } else {
    collector = yaml.load(fs.readFileSync(source, "utf8"));
  }

  const { name, receiver } = fileLogReceiver(collector);
  const processors = {};
  const pipelineProcessors = [];

  if (withFilter) {
    if (!collector.processors["filter/telemetry"]) {
      throw new Error("the render has no filter/telemetry processor");
    }

    processors["filter/telemetry"] = collector.processors["filter/telemetry"];
    pipelineProcessors.push("filter/telemetry");
  }

  const run = {
    receivers: {
      // Exactly as it ships, but from the start of each file: the fixtures
      // are written before the collector starts.
      [name]: { ...receiver, start_at: "beginning" },
    },
    processors,
    exporters: { file: { path: "/out/logs.json" } },
    service: {
      pipelines: {
        logs: {
          receivers: [name],
          processors: pipelineProcessors,
          exporters: ["file"],
        },
      },
    },
  };

  writeFile(path.join(dir, "config.yaml"), yaml.dump(run, { lineWidth: -1 }));

  if (image) {
    writeFile(path.join(dir, "image"), image);
  }
}

function severityOf(record) {
  const number = record.severityNumber || 0;

  if (number >= 1 && number <= 4) {
    return "Trace";
  }
  if (number >= 5 && number <= 8) {
    return "Debug";
  }
  if (number >= 9 && number <= 12) {
    return "Information";
  }
  if (number >= 13 && number <= 16) {
    return "Warning";
  }
  if (number >= 17 && number <= 20) {
    return "Error";
  }
  if (number >= 21 && number <= 24) {
    return "Fatal";
  }
  return "Unspecified";
}

/**
 * The exported records, keyed by the case id each one's resource carries.
 *
 * The file exporter writes one JSON line per batch, and a long line reaches
 * the file in pieces: read while the collector runs, the last line can be
 * unfinished. Only finished lines are read, so the count taken while waiting
 * never chokes on one; a finished line that is not JSON still throws.
 */
function exported(file) {
  const byId = new Map();
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const finished = text.slice(0, text.lastIndexOf("\n") + 1);

  for (const line of finished.split("\n").filter(Boolean)) {
    for (const resourceLogs of JSON.parse(line).resourceLogs || []) {
      const attributes = new Map(
        (resourceLogs.resource.attributes || []).map((attribute) => {
          return [attribute.key, attribute.value.stringValue];
        }),
      );
      const id =
        attributes.get("k8s.pod.name") || attributes.get("container.id");

      for (const scopeLogs of resourceLogs.scopeLogs || []) {
        for (const record of scopeLogs.logRecords || []) {
          if (!byId.has(id)) {
            byId.set(id, []);
          }

          byId.get(id).push(record);
        }
      }
    }
  }

  return byId;
}

/** Whether a record below this threshold is dropped by the chart's filter. */
function keptBy(minSeverity, severity) {
  if (!minSeverity || severity === "Unspecified") {
    return true;
  }

  return SEVERITY_RANK[severity] >= MIN_SEVERITY_RANK[minSeverity];
}

function check(casesFile, exportedFile, collectorLog, minSeverity) {
  // Loaded here rather than at the top: it transpiles Common's table, and
  // `count` runs once a second while the script waits for the collector.
  const { namedNumber } = require("./LogSeverityTable.js");
  const cases = JSON.parse(fs.readFileSync(casesFile, "utf8"));
  const got = exported(exportedFile);
  const failures = [];
  let kept = 0;

  for (const entry of cases) {
    const records = got.get(entry.id) || [];
    const shouldKeep = keptBy(minSeverity, entry.severity);

    if (!shouldKeep) {
      if (records.length > 0) {
        failures.push(
          `${entry.name}: kept as ${severityOf(records[0])}, should have been dropped (${entry.severity})`,
        );
      }
      continue;
    }

    if (records.length !== 1) {
      failures.push(`${entry.name}: ${records.length} records, wanted 1`);
      continue;
    }

    kept++;

    const record = records[0];
    const severity = severityOf(record);
    const scratch = (record.attributes || []).find((attribute) => {
      return attribute.key === "severity_text";
    });

    if (severity !== entry.severity) {
      failures.push(
        `${entry.name}: ${severity} (${record.severityText || "no text"}), wanted ${entry.severity}`,
      );
    } else if (severity === "Unspecified" && record.severityText) {
      failures.push(
        `${entry.name}: no severity, but the text "${record.severityText}"`,
      );
    } else if (scratch) {
      failures.push(
        `${entry.name}: still carries the scratch severity_text attribute`,
      );
    } else if (
      record.severityText &&
      record.severityNumber !== namedNumber(record.severityText)
    ) {
      // The text is the one the chain lifted; ingest stores the same word at
      // the one table's number, and so must the agent (issue #11228).
      failures.push(
        `${entry.name}: "${record.severityText}" left at ${record.severityNumber}, the one table stores it at ${namedNumber(record.severityText)}`,
      );
    }
  }

  // An operator of the chain that fails logs an error for the record and
  // sends it on unread (a route admitting what its parser cannot parse, a
  // remove of a field that is not there). None may.
  const chainErrors = fs
    .readFileSync(collectorLog, "utf8")
    .split("\n")
    .filter((line) => {
      return (
        /severity|recombine|regex pattern does not match|field does not exist/.test(
          line,
        ) && /error/i.test(line)
      );
    });

  for (const line of chainErrors.slice(0, 5)) {
    failures.push(`the collector logged: ${line.slice(0, 300)}`);
  }

  for (const failure of failures.slice(0, 60)) {
    console.log(`    FAILED ${failure}`);
  }

  if (failures.length > 60) {
    console.log(`    ... and ${failures.length - 60} more`);
  }

  console.log(
    `    ${cases.length - failures.length} of ${cases.length} cases as they should be; ${kept} records kept`,
  );

  return failures.length === 0;
}

function main(argv) {
  const [command, ...args] = argv;
  const withFilter = args.includes("--min-severity");
  const positional = args.filter((arg) => {
    return !arg.startsWith("--");
  });

  if (command === "fixtures") {
    fixtures(positional[0], positional[1]);
    return 0;
  }

  if (command === "config") {
    config(positional[0], positional[1], positional[2], withFilter);
    return 0;
  }

  if (command === "count") {
    const got = exported(positional[0]);
    let count = 0;

    for (const records of got.values()) {
      count += records.length;
    }

    console.log(count);
    return 0;
  }

  if (command === "check") {
    const minIndex = args.indexOf("--min-severity");
    const minSeverity = minIndex === -1 ? "" : args[minIndex + 1];

    return check(positional[0], positional[1], positional[2], minSeverity)
      ? 0
      : 1;
  }

  throw new Error(`unknown command ${command}`);
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  allRecords,
  check,
  config,
  exported,
  fixtures,
  keptBy,
  severityOf,
};
