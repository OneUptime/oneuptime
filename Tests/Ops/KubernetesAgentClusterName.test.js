"use strict";

/**
 * The kubernetes-agent chart hands its cluster name to every component whole.
 *
 * clusterName is free text (values.schema.json only says it is a string), and
 * OneUptime folds k8s.cluster.name into the identity of every Kubernetes
 * entity it derives: a component that reports a different name reports a
 * different cluster. Issue #7336 found three lines that spliced the name
 * inside literal double quotes, where YAML reads it by the rules of a
 * double-quoted string: both collectors' service.name
 * ("kubernetes-agent-{{ .Values.clusterName }}") and the eBPF DaemonSet's
 * OTEL_RESOURCE_ATTRIBUTES ("k8s.cluster.name={{ .Values.clusterName }}"). A
 * '"' ended the string (the eBPF DaemonSet failed to render; the collectors
 * crash-looped on a config they could not parse) and a '\' started an escape.
 * Six more lines read .Values.clusterName itself, untrimmed, while the
 * collectors read it through the trimming helper, so a name with spaces
 * around it reached the log tailer and the cost agent under another name.
 *
 * 1. The source. No template reads .Values.clusterName outside the
 *    kubernetes-agent.clusterName helper, which trims it and refuses a
 *    missing one. (HelmEnvValuesQuoted.test.js holds every value to being
 *    quoted, and refuses a setting spliced into a value of several pieces.)
 * 2. The render (helm on PATH; CI has it). With every component on and the
 *    name set to text full of YAML's and OBI's syntax, every collector config
 *    parses, and its resource processor, its service.name and the audit log
 *    reader carry the trimmed name; every env entry that names the cluster
 *    holds it; and OTEL_RESOURCE_ATTRIBUTES, read the way OBI reads it, says
 *    k8s.cluster.name is that name, or is left out for a name with a comma,
 *    which OBI cannot read back in any form.
 *
 * The chart's helm-unittest suite tests/cluster-name-whole_test.yaml holds the
 * same lines name by name.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHART = "HelmChart/Public/kubernetes-agent";
const TEMPLATES = `${CHART}/templates`;
const HELPER = "kubernetes-agent.clusterName";
const RELEASE = "agent";
const FULLNAME = `${RELEASE}-kubernetes-agent`;

// A template comment, {{/* ... */}} with any trim markers: its words are not code.
const TEMPLATE_COMMENT = /\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}/g;
const SETTING_READ = /\.Values\.clusterName\b/;
const HELPER_USE = /include "kubernetes-agent\.clusterName" \./g;

// Every file of the chart's templates directory.
function templateFiles() {
  return fs
    .readdirSync(path.join(REPO_ROOT, TEMPLATES))
    .filter((name) => {
      return !name.startsWith(".");
    })
    .sort()
    .map((name) => {
      return `${TEMPLATES}/${name}`;
    });
}

// A template's text with its comments and the helper's own definition out.
function code(file) {
  const text = fs
    .readFileSync(path.join(REPO_ROOT, file), "utf8")
    .replace(TEMPLATE_COMMENT, "");
  const start = text.indexOf(`{{- define "${HELPER}" -}}`);

  if (start === -1) {
    return text;
  }

  const end = text.indexOf("{{- end }}", start);

  return text.slice(0, start) + text.slice(end + "{{- end }}".length);
}

describe("every template reads the cluster name through its helper", () => {
  const files = templateFiles();

  test("the helper trims the name and refuses to render without one", () => {
    const helpers = fs.readFileSync(
      path.join(REPO_ROOT, TEMPLATES, "_helpers.tpl"),
      "utf8",
    );

    expect(helpers).toContain(
      [
        `{{- define "${HELPER}" -}}`,
        '{{- required "clusterName is required: it identifies this cluster\'s nodes, namespaces, pods and deployments in OneUptime, and two clusters installed without it will be merged into one. Set it with --set clusterName=<name>." (.Values.clusterName | trim) -}}',
        "{{- end }}",
      ].join("\n"),
    );
  });

  test("no template reads .Values.clusterName itself", () => {
    const reads = files.flatMap((file) => {
      return code(file)
        .split("\n")
        .filter((line) => {
          return SETTING_READ.test(line);
        })
        .map((line) => {
          return `${file}: ${line.trim()}`;
        });
    });

    expect(reads).toEqual([]);
  });

  test("the scan reads the templates that name the cluster", () => {
    const uses = files.reduce((count, file) => {
      return count + (code(file).match(HELPER_USE) || []).length;
    }, 0);

    // Fourteen today: the collectors, OBI, the log tailer, the cost agent,
    // OpenCost, the AI agent, the profiler, the audit log reader and the notes.
    expect(uses).toBeGreaterThanOrEqual(14);
  });

  test("the helper's definition is what the scan leaves out, and only that", () => {
    const helpers = code(`${TEMPLATES}/_helpers.tpl`);

    expect(helpers).not.toContain(`define "${HELPER}"`);
    // The helper after it is still read.
    expect(helpers).toContain('define "kubernetes-agent.existingSecretName"');
  });
});

/*
 * OTEL_RESOURCE_ATTRIBUTES as OBI reads it (v0.14.0 and v1.0.0,
 * pkg/export/attributes/env.go): split at every comma, each pair cut at its
 * first '=', key and value trimmed, a pair without '=' or with an empty key
 * or value dropped, and nothing percent-decoded.
 */
function obiResourceAttributes(value) {
  const attributes = {};

  for (const pair of value.split(",")) {
    const cut = pair.indexOf("=");

    if (cut === -1) {
      continue;
    }

    const key = pair.slice(0, cut).trim();
    const read = pair.slice(cut + 1).trim();

    if (key && read) {
      attributes[key] = read;
    }
  }

  return attributes;
}

describe("OBI's reading of OTEL_RESOURCE_ATTRIBUTES", () => {
  test("keeps an '=' in a value, and spaces inside it", () => {
    expect(obiResourceAttributes("k8s.cluster.name=prod=eu west")).toEqual({
      "k8s.cluster.name": "prod=eu west",
    });
  });

  test("splits a value at a comma, which is why a name with one is left out", () => {
    expect(obiResourceAttributes("k8s.cluster.name=prod,eu")).toEqual({
      "k8s.cluster.name": "prod",
    });
  });

  test("decodes nothing, so a percent-encoded name would arrive as written", () => {
    expect(obiResourceAttributes("k8s.cluster.name=prod%2Ceu")).toEqual({
      "k8s.cluster.name": "prod%2Ceu",
    });
  });
});

const HELM_PROBE = spawnSync("helm", ["version", "--short"], {
  encoding: "utf8",
});
const HELM_MISSING = Boolean(HELM_PROBE.error) || HELM_PROBE.status !== 0;

if (HELM_MISSING && !process.env.CI) {
  // eslint-disable-next-line no-console
  console.warn(
    "kubernetes-agent cluster name renders skipped: helm is not on PATH (CI has it, see .github/workflows/test.ops.yaml).",
  );
}

const testWithHelm = HELM_MISSING && !process.env.CI ? test.skip : test;

function render(values) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-cluster-name-"));
  const file = path.join(dir, "values.json");

  try {
    fs.writeFileSync(file, JSON.stringify(values));

    const result = spawnSync(
      "helm",
      [
        "template",
        RELEASE,
        path.join(REPO_ROOT, CHART),
        "--namespace",
        "oneuptime",
        "--values",
        file,
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );

    expect({
      status: result.status,
      error: result.status === 0 ? "" : result.stderr,
    }).toEqual({ status: 0, error: "" });

    return yaml.loadAll(result.stdout).filter(Boolean);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/*
 * Two layouts between them run every component that names the cluster: the
 * node collector with the audit log reader, OBI, the profiler, the cost agent
 * and OpenCost; and the log tailer, which reads pod logs in their place
 * (logs.mode api).
 */
const BASE = {
  oneuptime: { url: "https://oneuptime.example.com", apiKey: "ingestion-key" },
  ebpf: { enabled: true },
};
const EVERYTHING = {
  ...BASE,
  cost: { enabled: true },
  profiling: { enabled: true },
  auditLogs: { enabled: true },
};
const LOG_TAILER = { ...BASE, logs: { mode: "api" } };

// The env entries that name the cluster.
const CLUSTER_ENV = new Set([
  "CLUSTER_NAME",
  "CLUSTER_ID",
  "OTEL_EBPF_KUBE_CLUSTER_NAME",
  "ONEUPTIME_KUBERNETES_CLUSTER_NAME",
]);

// Where each layout puts the name. A component added or dropped fails below,
// so the change is looked at.
const PLACES = {
  everything: [
    `ConfigMap/${FULLNAME}-daemonset otel-collector-config.yaml filelog/audit`,
    `ConfigMap/${FULLNAME}-daemonset otel-collector-config.yaml resource k8s.cluster.name`,
    `ConfigMap/${FULLNAME}-daemonset otel-collector-config.yaml resource service.name`,
    `ConfigMap/${FULLNAME}-deployment otel-collector-config.yaml resource k8s.cluster.name`,
    `ConfigMap/${FULLNAME}-deployment otel-collector-config.yaml resource service.name`,
    `ConfigMap/${FULLNAME}-profiling config.yaml resource k8s.cluster.name`,
    `DaemonSet/${FULLNAME}-ebpf ebpf-instrument OTEL_EBPF_KUBE_CLUSTER_NAME`,
    `DaemonSet/${FULLNAME}-ebpf ebpf-instrument OTEL_RESOURCE_ATTRIBUTES`,
    `Deployment/${FULLNAME} otel-collector CLUSTER_NAME`,
    `Deployment/${FULLNAME}-ai-agent ai-agent ONEUPTIME_KUBERNETES_CLUSTER_NAME`,
    `Deployment/${FULLNAME}-cost cost-agent CLUSTER_NAME`,
    `Deployment/${FULLNAME}-opencost opencost CLUSTER_ID`,
  ],
  logTailer: [
    `ConfigMap/${FULLNAME}-daemonset otel-collector-config.yaml resource k8s.cluster.name`,
    `ConfigMap/${FULLNAME}-daemonset otel-collector-config.yaml resource service.name`,
    `ConfigMap/${FULLNAME}-deployment otel-collector-config.yaml resource k8s.cluster.name`,
    `ConfigMap/${FULLNAME}-deployment otel-collector-config.yaml resource service.name`,
    `DaemonSet/${FULLNAME}-ebpf ebpf-instrument OTEL_EBPF_KUBE_CLUSTER_NAME`,
    `DaemonSet/${FULLNAME}-ebpf ebpf-instrument OTEL_RESOURCE_ATTRIBUTES`,
    `Deployment/${FULLNAME} otel-collector CLUSTER_NAME`,
    `Deployment/${FULLNAME}-ai-agent ai-agent ONEUPTIME_KUBERNETES_CLUSTER_NAME`,
    `Deployment/${FULLNAME}-logs log-tailer CLUSTER_NAME`,
  ],
};

/*
 * What a render says the cluster is called, place by place, as
 * { "<place>": "<what it holds>" }. Each collector config is parsed as the
 * collector parses it, so one it could not load fails here.
 */
function clusterNames(documents) {
  const found = {};

  for (const document of documents) {
    const id = `${document.kind}/${document.metadata.name}`;

    if (document.kind === "ConfigMap") {
      for (const [key, text] of Object.entries(document.data || {})) {
        if (typeof text !== "string" || !text.includes("k8s.cluster.name")) {
          continue;
        }

        let config;

        try {
          config = yaml.load(text);
        } catch (error) {
          found[`${id} ${key}`] = `does not parse: ${error.message}`;
          continue;
        }

        for (const attribute of ((config.processors || {}).resource || {})
          .attributes || []) {
          if (["k8s.cluster.name", "service.name"].includes(attribute.key)) {
            found[`${id} ${key} resource ${attribute.key}`] = attribute.value;
          }
        }

        for (const [receiver, settings] of Object.entries(
          config.receivers || {},
        )) {
          for (const operator of (settings || {}).operators || []) {
            if (operator.field === 'resource["k8s.cluster.name"]') {
              found[`${id} ${key} ${receiver}`] = operator.value;
            }
          }
        }
      }
    }

    const pod = ((document.spec || {}).template || {}).spec;

    for (const container of pod
      ? [...(pod.initContainers || []), ...(pod.containers || [])]
      : []) {
      for (const entry of container.env || []) {
        if (
          CLUSTER_ENV.has(entry.name) ||
          entry.name === "OTEL_RESOURCE_ATTRIBUTES"
        ) {
          found[`${id} ${container.name} ${entry.name}`] = entry.value;
        }
      }
    }
  }

  return found;
}

// What each place should hold for a name, with the name trimmed.
function expected(places, name) {
  const trimmed = name.trim();

  return Object.fromEntries(
    places
      .filter((place) => {
        return !(
          place.endsWith(" OTEL_RESOURCE_ATTRIBUTES") && trimmed.includes(",")
        );
      })
      .map((place) => {
        if (place.endsWith(" service.name")) {
          return [place, `kubernetes-agent-${trimmed}`];
        }
        if (place.endsWith(" OTEL_RESOURCE_ATTRIBUTES")) {
          return [place, `k8s.cluster.name=${trimmed}`];
        }
        return [place, trimmed];
      }),
  );
}

/*
 * Names full of the syntax each reader has: YAML's double-quoted string ('"'
 * and '\', with letters it escapes), YAML's plain scalar (': ', ' #', a
 * leading '*', number and boolean lookalikes), OBI's list (',' and '='), a
 * percent sign OBI does not decode, and whitespace around the name as a file
 * leaves it.
 */
const NAMES = [
  'prod "eu"',
  "prod\\eu",
  "prod\\teu \\n",
  "prod,eu",
  "prod, eu=1",
  "prod=eu",
  "prod: eu #1",
  "  prod-eu \n",
  "\tprod eu\r\n",
  "2026",
  "yes",
  "*prod &eu !x",
  "prod%2Ceu",
  "europe/west-1 'b'",
];

describe("the kubernetes-agent chart hands its cluster name to every component whole", () => {
  testWithHelm.each(
    NAMES.map((name) => {
      return [JSON.stringify(name), name];
    }),
  )("with every component on, the name %s", (_label, name) => {
    const found = clusterNames(render({ ...EVERYTHING, clusterName: name }));

    expect(found).toEqual(expected(PLACES.everything, name));
  });

  testWithHelm.each([['prod "eu"'], ["  prod,eu\n"], ["prod\\eu: x #y"]])(
    "with the log tailer reading pod logs, the name %j",
    (name) => {
      const found = clusterNames(render({ ...LOG_TAILER, clusterName: name }));

      expect(found).toEqual(expected(PLACES.logTailer, name));
    },
  );

  testWithHelm(
    "OBI reads the trimmed name back from OTEL_RESOURCE_ATTRIBUTES, and nothing else",
    () => {
      for (const name of NAMES.filter((each) => {
        return !each.includes(",");
      })) {
        const found = clusterNames(render({ ...BASE, clusterName: name }));

        expect({
          name,
          read: obiResourceAttributes(
            found[
              `DaemonSet/${FULLNAME}-ebpf ebpf-instrument OTEL_RESOURCE_ATTRIBUTES`
            ],
          ),
        }).toEqual({ name, read: { "k8s.cluster.name": name.trim() } });
      }
    },
  );

  testWithHelm(
    "a name with a comma still reaches OBI whole, through OTEL_EBPF_KUBE_CLUSTER_NAME",
    () => {
      const found = clusterNames(
        render({ ...BASE, clusterName: " prod, eu=1 " }),
      );

      expect(
        found[
          `DaemonSet/${FULLNAME}-ebpf ebpf-instrument OTEL_EBPF_KUBE_CLUSTER_NAME`
        ],
      ).toBe("prod, eu=1");
      expect(
        `DaemonSet/${FULLNAME}-ebpf ebpf-instrument OTEL_RESOURCE_ATTRIBUTES` in
          found,
      ).toBe(false);
    },
  );
});
