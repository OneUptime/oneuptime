"use strict";

/**
 * The kubernetes-agent chart's privileged pods follow the preset.
 *
 * The eBPF instrumentation (OBI) and the continuous profiler each run a
 * privileged DaemonSet. GKE Autopilot refuses privileged pods, EKS Fargate
 * runs neither privileged containers nor DaemonSets, and OpenShift's
 * restricted-v2 SCC, all the openshift-restricted preset runs under, refuses
 * them, so those presets turn both off themselves:
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

// The gate on the SCCs, the first template action after the file's comment.
function firstLineOfScc() {
  return read(`${TEMPLATES_DIR}/openshift-scc.yaml`)
    .split("*/}}\n")[1]
    .split("\n")[0];
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
      '{{- $preset := default "" .Values.preset -}}\n{{- if or (eq $preset "gke-autopilot") (eq $preset "eks-fargate") (eq $preset "openshift-restricted") -}}\nfalse';

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
      "openshift",
      "openshift-restricted",
    ]);
  });

  test("the openshift preset keeps the privileged pods, which run under an SCC of their own", () => {
    // Not among the presets that refuse hostPath and privileged pods...
    expect(
      defineBody(helpers, "kubernetes-agent.privilegedPodsAllowed"),
    ).not.toContain('"openshift"');
    expect(
      defineBody(helpers, "kubernetes-agent.hostPathAvailable"),
    ).not.toContain('"openshift"');

    // ...because the chart lets exactly those pods run that way there.
    const scc = read(`${TEMPLATES_DIR}/openshift-scc.yaml`);

    expect(scc).toContain(
      '{{- if eq (include "kubernetes-agent.ebpfPodsEnabled" .) "true" }}',
    );
    expect(scc).toContain("allowPrivilegedContainer: true");
    expect(defineBody(helpers, "kubernetes-agent.ebpfPodsEnabled")).toContain(
      '{{- if or (eq (include "kubernetes-agent.ebpfEnabled" .) "true") (eq (include "kubernetes-agent.profilingEnabled" .) "true") -}}',
    );
  });

  test("OpenShift's two meanings are apart: it is OpenShift on both presets, and SCCs are the openshift preset's alone", () => {
    expect(defineBody(helpers, "kubernetes-agent.openshift")).toContain(
      '{{- if or (eq $preset "openshift") (eq $preset "openshift-restricted") -}}\ntrue',
    );
    expect(defineBody(helpers, "kubernetes-agent.openshiftSccs")).toContain(
      '{{- if eq (default "" .Values.preset) "openshift" -}}\ntrue',
    );

    // What takes an SCC reads that one, and nothing else decides it.
    expect(firstLineOfScc()).toBe(
      '{{- if eq (include "kubernetes-agent.openshiftSccs" .) "true" }}',
    );
    expect(
      defineBody(helpers, "kubernetes-agent.nodeServiceAccounts"),
    ).toContain(
      '{{- if and (eq (include "kubernetes-agent.openshiftSccs" .) "true") .Values.serviceAccount.create -}}',
    );
    expect(read(`${TEMPLATES_DIR}/daemonset.yaml`)).toContain(
      '{{- if eq (include "kubernetes-agent.openshiftSccs" .) "true" }}\n      # OpenShift: pod log files belong to root',
    );
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
    const commands = presets.match(/```bash\nhelm install[\s\S]*?```/g) || [];

    expect(commands.length).toBe(4);

    for (const command of commands) {
      expect(command).toMatch(
        /--set preset=(gke-autopilot|eks-fargate|openshift|openshift-restricted)\n```$/,
      );
    }
  });

  test("the README says what openshift-restricted gives up, and how to get it back", () => {
    const presets = readme.slice(
      readme.indexOf("## Pick a preset"),
      readme.indexOf("\n## ", readme.indexOf("## Pick a preset") + 1),
    );

    expect(presets).toContain(
      "| `openshift-restricted` | **OpenShift**, where an admin will not add an SCC | Kubernetes API log tailer Deployment (no hostPath) |",
    );
    expect(presets).toContain(
      "`openshift` is the recommended preset on OpenShift.",
    );
    for (const lost of [
      "**Pod logs from the nodes.**",
      "**Host metrics**",
      "**eBPF traces and the continuous profiler,**",
      "**Audit logs**",
    ]) {
      expect(presets).toContain(lost);
    }
    expect(presets).toContain(
      "To get them back, move to `openshift` with `--set preset=openshift` on an upgrade, as a cluster admin.",
    );
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
      "#     GKE Autopilot and EKS Fargate refuse privileged pods, so the\n#     gke-autopilot and eks-fargate presets leave it out whatever this says.\n#     So does openshift-restricted, which runs under restricted-v2 alone.",
    );
    expect(values).toContain(
      "#                   so there are no host metrics, and the eBPF\n#                   instrumentation and the profiler are left out, whatever\n#                   ebpf.enabled and profiling.enabled say. Move to\n#                   `openshift` to get them back.",
    );
    expect(values).not.toContain(
      "(e.g.\n#     GKE Autopilot, EKS Fargate), set `ebpf.enabled: false`.",
    );
  });

  test("values.yaml names the one exception to 'explicit values win over the preset'", () => {
    expect(values).toContain(
      '# still be overridden explicitly — they always win over preset defaults.\n# The one exception is the privileged pods: on gke-autopilot, eks-fargate and\n# openshift-restricted, ebpf.enabled and profiling.enabled cannot turn eBPF or\n# the profiler back on, because those platforms cannot run them.\npreset: ""',
    );
  });
});
