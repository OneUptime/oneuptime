"use strict";

/**
 * The kubernetes-agent chart's privileged pods follow the preset.
 *
 * The eBPF instrumentation (OBI) and the continuous profiler each run a
 * privileged DaemonSet. GKE Autopilot refuses privileged pods, and EKS
 * Fargate runs neither privileged containers nor DaemonSets, so the
 * gke-autopilot and eks-fargate presets turn both off themselves:
 * kubernetes-agent.ebpfEnabled and kubernetes-agent.profilingEnabled
 * (templates/_helpers.tpl), on kubernetes-agent.privilegedPodsAllowed. The
 * README's preset commands used to set only the preset, leaving ebpf.enabled
 * at its default, true, and installing the eBPF DaemonSet where it cannot
 * run.
 *
 * The chart's helm-unittest suites (presets-privileged*_test.yaml) hold what
 * the presets render. This holds the source: every template reads the two
 * switches through the helpers, every privileged workload is behind one,
 * and the README and values.yaml say what the presets do.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHART_DIR = "HelmChart/Public/kubernetes-agent";
const TEMPLATES_DIR = `${CHART_DIR}/templates`;

const EBPF_GATE =
  '{{- if eq (include "kubernetes-agent.ebpfEnabled" .) "true" }}';
const PROFILING_GATE =
  '{{- if eq (include "kubernetes-agent.profilingEnabled" .) "true" }}';

// Any spelling of reading either switch straight from the values.
const DIRECT_READ =
  /\.Values\.(ebpf|profiling)\.enabled|\$(ebpf|profiling)\.enabled|\(\.Values\.(ebpf|profiling) \| default dict\)\.enabled/g;

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function templateFiles() {
  return fs
    .readdirSync(path.join(REPO_ROOT, TEMPLATES_DIR))
    .filter((name) => {
      return /\.(yaml|tpl|txt)$/.test(name);
    })
    .map((name) => {
      return `${TEMPLATES_DIR}/${name}`;
    });
}

// The body of one `define` block in a template file.
function defineBody(source, name) {
  const start = source.indexOf(`{{- define "${name}" -}}`);

  expect({ name, found: start > -1 }).toEqual({ name, found: true });

  const end = source.indexOf("{{- end -}}\n\n", start);

  return source.slice(start, end);
}

function firstLine(relativePath) {
  return read(relativePath).split("\n")[0];
}

describe("the kubernetes-agent chart reads ebpf.enabled and profiling.enabled through one helper each", () => {
  const helpers = read(`${TEMPLATES_DIR}/_helpers.tpl`);

  test("no template reads either switch straight from the values", () => {
    const found = [];

    for (const file of templateFiles()) {
      const source = read(file);
      const allowed =
        file === `${TEMPLATES_DIR}/_helpers.tpl`
          ? [
              defineBody(source, "kubernetes-agent.ebpfEnabled"),
              defineBody(source, "kubernetes-agent.profilingEnabled"),
            ]
          : [];

      let remaining = source;

      for (const block of allowed) {
        remaining = remaining.replace(block, "");
      }

      for (const match of remaining.matchAll(DIRECT_READ)) {
        found.push(`${file}: ${match[0]}`);
      }
    }

    expect(found).toEqual([]);
  });

  test("the two helpers read the switch and the platform, and nothing else", () => {
    expect(defineBody(helpers, "kubernetes-agent.ebpfEnabled")).toContain(
      '{{- if and ((.Values.ebpf | default dict).enabled) (eq (include "kubernetes-agent.privilegedPodsAllowed" .) "true") -}}',
    );
    expect(defineBody(helpers, "kubernetes-agent.profilingEnabled")).toContain(
      '{{- if and ((.Values.profiling | default dict).enabled) (eq (include "kubernetes-agent.privilegedPodsAllowed" .) "true") -}}',
    );
  });

  test("privileged pods are refused on exactly the presets that refuse hostPath", () => {
    const presetCondition =
      '{{- $preset := default "" .Values.preset -}}\n{{- if or (eq $preset "gke-autopilot") (eq $preset "eks-fargate") -}}\nfalse';

    expect(
      defineBody(helpers, "kubernetes-agent.privilegedPodsAllowed"),
    ).toContain(presetCondition);
    expect(defineBody(helpers, "kubernetes-agent.hostPathAvailable")).toContain(
      presetCondition,
    );

    const schema = JSON.parse(read(`${CHART_DIR}/values.schema.json`));

    expect(schema.properties.preset.enum).toEqual([
      "",
      "standard",
      "gke-autopilot",
      "eks-fargate",
    ]);
  });

  test("the eBPF resources open with the eBPF gate", () => {
    for (const file of [
      "daemonset-ebpf.yaml",
      "configmap-ebpf.yaml",
      "service.yaml",
    ]) {
      expect({ file, line: firstLine(`${TEMPLATES_DIR}/${file}`) }).toEqual({
        file,
        line: EBPF_GATE,
      });
    }
  });

  test("the profiler's resources open with the profiling gate", () => {
    for (const file of [
      "daemonset-profiling.yaml",
      "configmap-profiling.yaml",
    ]) {
      expect({ file, line: firstLine(`${TEMPLATES_DIR}/${file}`) }).toEqual({
        file,
        line: PROFILING_GATE,
      });
    }
  });

  test("every privileged workload is behind one of the two gates", () => {
    const privileged = templateFiles().filter((file) => {
      return /^\s*privileged: true$/m.test(read(file));
    });

    expect(privileged.sort()).toEqual([
      `${TEMPLATES_DIR}/daemonset-ebpf.yaml`,
      `${TEMPLATES_DIR}/daemonset-profiling.yaml`,
    ]);

    for (const file of privileged) {
      expect([EBPF_GATE, PROFILING_GATE]).toContain(firstLine(file));
    }
  });
});

describe("the README and values.yaml say what the presets do", () => {
  const readme = read(`${CHART_DIR}/README.md`);
  const values = read(`${CHART_DIR}/values.yaml`);

  test("the README's preset section says the presets leave eBPF and profiling out, and why", () => {
    const presets = readme.slice(
      readme.indexOf("## Pick a preset"),
      readme.indexOf("\n## ", readme.indexOf("## Pick a preset") + 1),
    );

    expect(presets).toContain(
      "On `gke-autopilot` and `eks-fargate` the preset also leaves out the eBPF auto-instrumentation and the continuous profiler, whatever `ebpf.enabled` and `profiling.enabled` say.",
    );
    expect(presets).toContain(
      "GKE Autopilot refuses privileged pods, and EKS Fargate runs neither privileged pods nor DaemonSets.",
    );
  });

  test("the README's preset commands need nothing but the preset", () => {
    const presets = readme.slice(
      readme.indexOf("## Pick a preset"),
      readme.indexOf("\n## ", readme.indexOf("## Pick a preset") + 1),
    );
    const commands = presets.match(/```bash\n[\s\S]*?```/g) || [];

    expect(commands.length).toBe(2);

    for (const command of commands) {
      expect(command).toMatch(/--set preset=(gke-autopilot|eks-fargate)\n```$/);
    }
  });

  test("the README no longer tells Autopilot and Fargate users to turn eBPF off themselves", () => {
    expect(readme).not.toContain(
      "can't run it, so disable it on those: `--set ebpf.enabled=false`",
    );
    expect(readme).toContain(
      "GKE Autopilot and EKS Fargate refuse privileged pods, so the `gke-autopilot` and `eks-fargate` presets leave it out for you.",
    );
    expect(readme).not.toContain("cannot run on GKE Autopilot / EKS Fargate");
  });

  test("values.yaml says the presets leave eBPF and the profiler out", () => {
    expect(values).toContain(
      "#                   pods are refused, so the eBPF instrumentation and the\n#                   profiler are left out, whatever ebpf.enabled and\n#                   profiling.enabled say.",
    );
    expect(values).toContain(
      "#     GKE Autopilot and EKS Fargate refuse privileged pods, so the\n#     gke-autopilot and eks-fargate presets leave it out whatever this says.",
    );
    expect(values).not.toContain(
      "(e.g.\n#     GKE Autopilot, EKS Fargate), set `ebpf.enabled: false`.",
    );
  });
});
