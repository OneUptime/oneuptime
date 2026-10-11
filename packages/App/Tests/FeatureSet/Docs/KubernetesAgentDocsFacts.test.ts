import { DocsFence, readPage, scanMarkdown } from "./DocsContentSupport";
import { ONEUPTIME_LABEL_ATTRIBUTE_PREFIX } from "Common/Server/Utils/Telemetry/OneuptimeLabel";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English "Kubernetes Agent (Helm install)" page says about the
 * kubernetes-agent Helm chart, held to the chart: the defaults of every
 * option the page's tables give, the presets and what each one runs, the
 * workloads and their labels, the requirements, and the install, upgrade
 * and troubleshooting commands. Changing a default in values.yaml, a preset
 * helper or a workload fails this until the English page follows;
 * TemplatingAndAgentMonitorDocsTranslations then holds the 16 translations
 * to the English page.
 */

const PAGE: string = "monitor/kubernetes-agent";
const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const CHART_DIR: string = path.join(
  REPO_ROOT,
  "HelmChart",
  "Public",
  "kubernetes-agent",
);

const TABLE_DELIMITER_ROW: RegExp = /^\|\s*:?-/;
const SET_FLAG: RegExp = /--set\s+([\w.]+)=(\S+)/g;
const HELM_RELEASE_COMMAND: RegExp =
  /^helm (install|upgrade) (\S+) oneuptime\/kubernetes-agent/;

/*
 * js-yaml from Common/node_modules, as StorageArrayDocs and QueuesDocs load
 * it: Common declares js-yaml 4, App declares no YAML parser.
 */
interface JsYamlModule {
  load: (text: string) => unknown;
}

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const jsYaml: JsYamlModule = require(
  path.join(REPO_ROOT, "packages", "Common", "node_modules", "js-yaml"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const english: string = readPage("en", PAGE);

function chartFile(relative: string): string {
  return fs.readFileSync(path.join(CHART_DIR, relative), "utf8");
}

const values: Record<string, unknown> = jsYaml.load(
  chartFile("values.yaml"),
) as Record<string, unknown>;

// A value of values.yaml by its dotted path.
function valueAt(dotted: string): unknown {
  return dotted.split(".").reduce((current: unknown, key: string): unknown => {
    return (current as Record<string, unknown> | undefined)?.[key];
  }, values);
}

/*
 * Every table body row of the page whose first cell is the backticked
 * `option`. A table's header row, the one above its delimiter row, is not
 * one: the Pod logs table is headed `logs.mode`.
 */
function rowsFor(option: string): Array<Array<string>> {
  const lines: Array<string> = english.split("\n");

  return lines
    .filter((line: string, index: number): boolean => {
      return (
        line.startsWith(`| \`${option}\` |`) &&
        !TABLE_DELIMITER_ROW.test(lines[index + 1] || "")
      );
    })
    .map((line: string): Array<string> => {
      return line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        });
    });
}

// The body rows of the first table after a heading.
function tableAfter(heading: string): Array<Array<string>> {
  const lines: Array<string> = english.split("\n");
  const start: number = lines.indexOf(heading);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const rows: Array<Array<string>> = [];
  let started: boolean = false;

  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("|")) {
      if (started) {
        break;
      }
      continue;
    }

    started = true;

    if (TABLE_DELIMITER_ROW.test(line)) {
      continue;
    }

    rows.push(
      line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  return rows.slice(1);
}

function bashBlocks(): Array<string> {
  return scanMarkdown(english)
    .fences.filter((fence: DocsFence): boolean => {
      return fence.lang === "bash";
    })
    .map((fence: DocsFence): string => {
      return fence.code;
    });
}

// The --set flags of a command, joined over its continuation lines.
function setFlags(command: string): Record<string, string> {
  const flags: Record<string, string> = {};

  for (const match of command.replace(/\\\n/g, " ").matchAll(SET_FLAG)) {
    flags[match[1] as string] = match[2] as string;
  }

  return flags;
}

/*
 * The page's default for each option, as its tables write it, and the value
 * values.yaml gives it.
 */
const DEFAULTS: Array<{ option: string; page: string; chart: unknown }> = [
  { option: "ebpf.features.httpMetrics", page: "on", chart: true },
  { option: "ebpf.features.spanMetrics", page: "on", chart: true },
  { option: "ebpf.features.serviceGraph", page: "on", chart: true },
  { option: "ebpf.features.networkMetrics", page: "on", chart: true },
  {
    option: "ebpf.features.networkInterZoneMetrics",
    page: "off",
    chart: false,
  },
  { option: "ebpf.features.tcpStats", page: "on", chart: true },
  { option: "ebpf.contextPropagation", page: "off", chart: false },
  {
    option: "ebpf.contextPropagationMode",
    page: "`headers`",
    chart: "headers",
  },
  { option: "ebpf.trackRequestHeaders", page: "on", chart: true },
  { option: "ebpf.logToTraceCorrelation", page: "`false`", chart: false },
  { option: "ebpf.enabled", page: "`true`", chart: true },
  { option: "ebpf.image.tag", page: "`v0.14.0`", chart: "v0.14.0" },
  { option: "ebpf.autoTargetExe", page: "`*`", chart: "*" },
  { option: "ebpf.logLevel", page: "`info`", chart: "info" },
  { option: "ebpf.printTraces", page: "`false`", chart: false },
  { option: "profiling.enabled", page: "`false`", chart: false },
  { option: "profiling.image.tag", page: "`0.152.0`", chart: "0.152.0" },
  { option: "profiling.samplesPerSecond", page: "`19`", chart: 19 },
  { option: "profiling.offCpuThreshold", page: "`0`", chart: 0 },
  { option: "profiling.tracers", page: '`""` (every runtime)', chart: "" },
  { option: "profiling.obiProcessContext", page: "`true`", chart: true },
  { option: "hostMetrics.enabled", page: "on", chart: true },
  {
    option: "kubeletstats.utilizationMetrics.enabled",
    page: "on",
    chart: true,
  },
  { option: "kubeletstats.volumeMetrics.enabled", page: "on", chart: true },
  { option: "cadvisor.enabled", page: "on", chart: true },
  { option: "auditLogs.enabled", page: "off", chart: false },
  { option: "csi.enabled", page: "off", chart: false },
  { option: "coreDns.enabled", page: "off", chart: false },
  { option: "controlPlane.enabled", page: "off", chart: false },
  { option: "cost.enabled", page: "off", chart: false },
  { option: "preset", page: "(empty: `standard`)", chart: "" },
  { option: "oneuptime.labels", page: "`{}`", chart: {} },
  { option: "filters.logs.minSeverity", page: '`""`', chart: "" },
  { option: "filters.metrics.exclude", page: "`[]`", chart: [] },
  { option: "sampling.traces.percentage", page: "`100`", chart: 100 },
  { option: "logs.enabled", page: "`true`", chart: true },
  { option: "logs.mode", page: "(from `preset`)", chart: "" },
  { option: "logs.windowsPods.enabled", page: "`false`", chart: false },
  { option: "logs.api.replicas", page: "`1`", chart: 1 },
  { option: "aiAgent.enabled", page: "`true`", chart: true },
];

describe("Kubernetes Agent (Helm install), against the chart", () => {
  it("is titled as its nav link", () => {
    expect(english.split("\n")[0]).toBe("# Kubernetes Agent (Helm install)");
  });

  it.each(DEFAULTS)(
    "$option: the page's default is the chart's",
    (entry: { option: string; page: string; chart: unknown }) => {
      const rows: Array<Array<string>> = rowsFor(entry.option);

      expect(rows.length).toBeGreaterThan(0);

      for (const row of rows) {
        expect({ option: entry.option, default: row[1] }).toEqual({
          option: entry.option,
          default: entry.page,
        });
      }

      expect(valueAt(entry.option)).toEqual(entry.chart);
    },
  );

  it("kube-state-metrics: off, bundled by default, or an endpoint of your own", () => {
    expect(
      rowsFor("kubeStateMetrics.enabled").map((row: Array<string>) => {
        return row[1];
      }),
    ).toEqual(["off", "`false`"]);
    expect(valueAt("kubeStateMetrics.enabled")).toBe(false);
    expect(valueAt("kubeStateMetrics.mode")).toBe("bundled");
    expect(english).toContain(
      "`kubeStateMetrics.mode: bundled` (the default) runs a small kube-state-metrics for you; `external` reads one you already run, at `kubeStateMetrics.endpoint`.",
    );
  });

  it("the eBPF resources are the chart's", () => {
    expect(valueAt("ebpf.resources.requests")).toEqual({
      cpu: "100m",
      memory: "512Mi",
    });
    expect(valueAt("ebpf.resources.limits")).toEqual({
      cpu: "2000m",
      memory: "2Gi",
    });
    expect(rowsFor("ebpf.resources.*")[0]![1]).toBe(
      "`100m` CPU and `512Mi` memory requested, `2000m` and `2Gi` limits",
    );
  });

  it("the default eBPF exclusions cover every kind of executable the page names", () => {
    const excluded: Array<string> = (
      valueAt("ebpf.excludeExePaths") as string
    ).split(",");

    expect(rowsFor("ebpf.excludeExePaths")[0]![1]).toBe(
      "Shells, cluster plumbing, service-mesh sidecars, CNI agents, browsers, ClickHouse, collectors and OBI itself",
    );

    for (const entry of [
      "*/sh",
      "*/bash",
      "*/kubelet",
      "*/containerd*",
      "*/runc",
      "*/envoy",
      "*/linkerd2-proxy",
      "*/cilium-agent",
      "*/calico-node",
      "*/chrome",
      "*/firefox",
      "*/clickhouse",
      "*/otelcol*",
      "*/ebpf-instrument",
      "*/obi",
    ]) {
      expect({ entry, excluded: excluded.includes(entry) }).toEqual({
        entry,
        excluded: true,
      });
    }
  });

  it("the default log enricher selector is the chart's", () => {
    expect(valueAt("ebpf.logEnricher.services")).toEqual([
      { service: [{ exe_path: "*" }] },
    ]);
    expect(rowsFor("ebpf.logEnricher.services")[0]![1]).toBe(
      '`[{service: [{exe_path: "*"}]}]`',
    );
  });

  it("namespace filters leave kube-system out of pod logs and eBPF discovery by default", () => {
    expect(valueAt("namespaceFilters.rules")).toEqual([
      {
        action: "exclude",
        namespaces: ["kube-system"],
        scopes: ["podLogs", "ebpfDiscovery"],
      },
    ]);
    expect(rowsFor("namespaceFilters.rules")[0]![1]).toBe(
      "Leaves `kube-system` out of `podLogs` and `ebpfDiscovery`",
    );
  });

  it("cAdvisor sends the three metrics the page names, and nothing else", () => {
    expect(valueAt("cadvisor.metricsAllowlist")).toEqual([
      "container_cpu_cfs_throttled_seconds_total",
      "container_cpu_cfs_periods_total",
      "container_oom_events_total",
    ]);
    expect(rowsFor("cadvisor.enabled")[0]![2]).toContain(
      "`container_cpu_cfs_throttled_seconds_total`, `container_cpu_cfs_periods_total` and `container_oom_events_total`, and nothing else.",
    );
  });

  it("audit logs, CoreDNS and CSI read where the page says", () => {
    expect(valueAt("auditLogs.paths")).toContain(
      "/var/log/kubernetes/audit.log",
    );
    expect(valueAt("coreDns.port")).toBe(9153);
    expect(chartFile("values.yaml")).toContain(
      "`app.kubernetes.io/component: csi-driver` or `app: csi-driver`",
    );
    expect(english).toContain("`/var/log/kubernetes/audit.log`");
    expect(english).toContain("`:9153/metrics`");
    expect(english).toContain(
      "pods labelled `app=csi-driver` or `app.kubernetes.io/component=csi-driver`",
    );
  });

  describe("presets", () => {
    const helpers: string = chartFile("templates/_helpers.tpl");

    it("are the chart's three, in the table's order", () => {
      const schema: {
        properties: { preset: { enum: Array<string> } };
      } = JSON.parse(chartFile("values.schema.json"));

      expect(schema.properties.preset.enum).toEqual([
        "",
        "standard",
        "gke-autopilot",
        "eks-fargate",
      ]);
      expect(
        tableAfter("## Pick a preset").map((row: Array<string>): string => {
          return row[0] as string;
        }),
      ).toEqual(["`standard` (default)", "`gke-autopilot`", "`eks-fargate`"]);
    });

    it("read logs through the API on GKE Autopilot and EKS Fargate, where hostPath is refused", () => {
      expect(helpers).toContain(
        '{{- if or (eq $preset "gke-autopilot") (eq $preset "eks-fargate") -}}\napi',
      );
      expect(helpers).toContain(
        'define "kubernetes-agent.hostPathAvailable" -}}\n{{- $preset := default "" .Values.preset -}}\n{{- if or (eq $preset "gke-autopilot") (eq $preset "eks-fargate") -}}\nfalse',
      );

      const rows: Array<Array<string>> = tableAfter("## Pick a preset");

      expect(rows[0]![2]).toBe("The node collector reads `/var/log/pods`");
      for (const row of rows.slice(1)) {
        expect(row[2]).toBe(
          "The log tailer reads them through the Kubernetes API",
        );
      }
    });

    it("run no DaemonSet on EKS Fargate, and the node collector without hostPath on GKE Autopilot", () => {
      expect(helpers).toContain(
        'define "kubernetes-agent.daemonSetSchedulable" -}}\n{{- if eq (default "" .Values.preset) "eks-fargate" -}}\nfalse',
      );

      const rows: Array<Array<string>> = tableAfter("## Pick a preset");

      expect(rows[0]![3]).toBe("Kubelet, cAdvisor and OS metrics");
      expect(rows[1]![3]).toBe(
        "Kubelet and cAdvisor metrics, without `hostPath`",
      );
      expect(rows[2]![3]).toBe("Nothing: Fargate runs no DaemonSets");
    });

    it("on GKE Autopilot and EKS Fargate turn eBPF off, because its pods are privileged", () => {
      expect(chartFile("templates/daemonset-ebpf.yaml")).toContain(
        "privileged: true",
      );
      expect(chartFile("templates/daemonset-profiling.yaml")).toContain(
        "privileged: true",
      );

      const lockedDown: Array<string> = bashBlocks().filter(
        (block: string): boolean => {
          const flags: Record<string, string> = setFlags(block);

          return (
            flags["preset"] === "gke-autopilot" ||
            flags["preset"] === "eks-fargate"
          );
        },
      );

      /*
       * The Autopilot and Fargate tabs, the hostPath troubleshooting, and the
       * sharding example.
       */
      expect(lockedDown.length).toBe(4);

      for (const block of lockedDown) {
        const flags: Record<string, string> = setFlags(block);

        // The sharding example sets the preset for log tailing alone.
        if (block.includes("namespaceFilters.rules")) {
          continue;
        }

        expect({ block, ebpf: flags["ebpf.enabled"] }).toEqual({
          block,
          ebpf: "false",
        });
      }
    });
  });

  it("refuses to install without a cluster name", () => {
    expect(chartFile("templates/_helpers.tpl")).toContain(
      '{{- required "clusterName is required',
    );
    expect(english).toContain(
      "**A name for the cluster**, unique in your project. The chart refuses to install without one",
    );
  });

  it("names the ingestion key and the header it is sent in as the chart does", () => {
    const valuesText: string = chartFile("values.yaml");

    expect(valuesText).toContain(
      "Telemetry ingestion key from OneUptime (Project Settings > Telemetry &\n  # APM > Ingestion Keys). The agent sends it as the x-oneuptime-token",
    );
    expect(english).toContain(
      "Create one in OneUptime under **Project Settings → Telemetry & APM → Ingestion Keys**. The agent sends it as the `x-oneuptime-token` header, so a project API key does not work here.",
    );
  });

  it("every install and upgrade uses the release, namespace and chart the page names", () => {
    const commands: Array<string> = bashBlocks()
      .flatMap((block: string): Array<string> => {
        return block.split("\n");
      })
      .filter((line: string): boolean => {
        return HELM_RELEASE_COMMAND.test(line);
      });

    expect(commands.length).toBeGreaterThan(8);

    for (const command of commands) {
      const release: string = (
        command.match(HELM_RELEASE_COMMAND) as RegExpMatchArray
      )[2]!;

      expect(["oneuptime-agent", "oneuptime-agent-ns-a"]).toContain(release);
    }

    for (const block of bashBlocks()) {
      if (
        block.includes("helm install oneuptime-agent ") ||
        block.includes("helm upgrade oneuptime-agent ") ||
        block.includes("helm uninstall")
      ) {
        expect({
          block,
          namespace: block.includes("oneuptime-kubernetes-agent"),
        }).toEqual({
          block,
          namespace: true,
        });
      }
    }

    expect(english).toContain(
      "helm repo add oneuptime https://helm-chart.oneuptime.com",
    );
    expect(chartFile("README.md")).toContain(
      "helm repo add oneuptime https://helm-chart.oneuptime.com",
    );
  });

  it("upgrades as the chart's README does, and says the notes warn about stale defaults", () => {
    const readme: string = chartFile("README.md");

    for (const block of [
      "helm repo update\nhelm upgrade oneuptime-agent oneuptime/kubernetes-agent \\\n  --namespace oneuptime-kubernetes-agent \\\n  --reset-then-reuse-values",
      "helm repo update\nhelm get values oneuptime-agent --namespace oneuptime-kubernetes-agent -o yaml > values.yaml && \\\n  helm upgrade oneuptime-agent oneuptime/kubernetes-agent \\\n  --namespace oneuptime-kubernetes-agent -f values.yaml",
    ]) {
      expect(bashBlocks()).toContain(block);
    }

    expect(readme).toContain("--reset-then-reuse-values");
    expect(readme).toContain("Don't upgrade with `--reuse-values`.");
    expect(chartFile("templates/NOTES.txt")).toContain(
      "WARNING: this release did not get this chart's defaults.",
    );
    expect(english).toContain(
      "the notes Helm prints after the install or upgrade end with a warning and the command that fixes it.",
    );
  });

  describe("the workloads the chart runs", () => {
    it("pins every workload to Linux nodes", () => {
      expect(chartFile("templates/_helpers.tpl")).toContain(
        '{{- toYaml (mergeOverwrite (dict "kubernetes.io/os" "linux") (. | default dict)) -}}',
      );
      expect(english).toContain(
        "Every agent image is Linux-only, so every workload is pinned to Linux nodes.",
      );
    });

    it("lists what is on by default as the chart's values set it", () => {
      const rows: Array<Array<string>> = tableAfter(
        "## What the chart installs",
      );
      const onByDefault: Record<string, string> = {};

      for (const row of rows) {
        onByDefault[row[0] as string] = row[3] as string;
      }

      expect(onByDefault).toEqual({
        "Cluster collector": "Yes",
        "Node collector": "Yes",
        "eBPF instrumentation (OBI)": "Yes",
        "Kubernetes AI agent": "Yes",
        "Log tailer": "With the `gke-autopilot` and `eks-fargate` presets",
        "eBPF profiler": "No",
        "kube-state-metrics": "No",
      });
      expect(valueAt("ebpf.enabled")).toBe(true);
      expect(valueAt("aiAgent.enabled")).toBe(true);
      expect(valueAt("profiling.enabled")).toBe(false);
      expect(valueAt("kubeStateMetrics.enabled")).toBe(false);

      for (const template of [
        "deployment.yaml",
        "daemonset.yaml",
        "daemonset-ebpf.yaml",
        "ai-agent.yaml",
        "deployment-logs-api.yaml",
        "daemonset-profiling.yaml",
        "kube-state-metrics.yaml",
      ]) {
        expect(fs.existsSync(path.join(CHART_DIR, "templates", template))).toBe(
          true,
        );
      }
    });

    it("labels the pods the troubleshooting commands select", () => {
      expect(chartFile("templates/daemonset-ebpf.yaml")).toContain(
        "component: ebpf-instrument",
      );
      expect(chartFile("templates/_helpers.tpl")).toContain(
        "app.kubernetes.io/part-of: oneuptime",
      );
      expect(english).toContain("-l component=ebpf-instrument");
      expect(english).toContain("-l app.kubernetes.io/part-of=oneuptime");
    });

    it("the log tailer answers /healthz on port 13133", () => {
      const tailer: string = chartFile("templates/deployment-logs-api.yaml");

      expect(tailer).toContain("containerPort: 13133");
      expect(tailer).toContain("path: /healthz");
      expect(english).toContain(
        "the log tailer answers on `/healthz`, port 13133",
      );
    });

    it("the diagnostic script is the chart's, and takes the namespace with -n", () => {
      const script: string = chartFile("troubleshoot.sh");

      expect(script).toContain('-n|--namespace) NS="${2:-}"; shift 2 ;;');
      expect(english).toContain(
        "curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \\\n  | bash -s -- -n oneuptime-kubernetes-agent",
      );
    });
  });

  it("labels become oneuptime.label.<key> resource attributes", () => {
    expect(ONEUPTIME_LABEL_ATTRIBUTE_PREFIX).toBe("oneuptime.label.");
    expect(chartFile("templates/_helpers.tpl")).toContain(
      "- key: oneuptime.label.{{ $key }}",
    );
    expect(english).toContain(
      "Each label is an `oneuptime.label.<key>=<value>` resource attribute, and OneUptime turns every attribute that starts with `oneuptime.label.` into a label.",
    );
  });

  it("states the kernels eBPF instrumentation and profiling need", () => {
    const valuesText: string = chartFile("values.yaml");

    expect(valuesText).toContain("Linux kernel 5.8+ with BTF");
    expect(valuesText).toContain("Linux kernel 5.10+");
    expect(english).toContain(
      "The nodes run a kernel older than **Linux 5.8** without BTF.",
    );
    expect(english).toContain("Profiling needs **Linux 5.10** or later");
  });
});
