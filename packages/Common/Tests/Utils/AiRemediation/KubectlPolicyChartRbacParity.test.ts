import KubectlPolicy, {
  KubectlPolicyResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — every command the policy tiers SafeWrite (so
 * Automatic mode runs it with nobody asked) is one the kubernetes-agent
 * chart's in-cluster Runner is actually allowed to run.
 *
 * The in-cluster Runner's write RBAC (HelmChart/Public/kubernetes-agent/
 * templates/ai-runner.yaml, rendered with aiAccess.remediation.enabled=true)
 * is the fixture below. When the policy starts calling a new kind "safe",
 * this test fails until the chart grants it or the policy stops, so a safe
 * change can never be one the API server answers with Forbidden — nor a
 * label on an Ingress or a Service that only an external credential could
 * apply. tests/ai-runner_test.yaml pins the same rules on the chart side.
 *
 * The SafeWrite search is generative: every write verb that can be SafeWrite
 * crossed with every kind spelling below (built-in kinds, short names,
 * group-qualified forms and custom look-alikes), one named object each, and
 * every combination the policy tiers SafeWrite must map to a granted
 * (apiGroup, resource, verb).
 */

interface Grant {
  apiGroup: string;
  resource: string;
  verb: string;
}

/*
 * The chart's remediation write rules (aiAccess.remediation.enabled=true).
 * Keep in step with ai-runner.yaml; the read-only rules are not listed —
 * every SafeWrite also reads its target, which the read rules cover.
 */
const CHART_REMEDIATION_RULES: Array<{
  apiGroup: string;
  resources: Array<string>;
  verbs: Array<string>;
}> = [
  {
    apiGroup: "apps",
    resources: ["deployments", "statefulsets", "daemonsets", "replicasets"],
    verbs: ["patch", "update"],
  },
  {
    apiGroup: "apps",
    resources: ["deployments/scale", "statefulsets/scale", "replicasets/scale"],
    verbs: ["get", "patch", "update"],
  },
  {
    apiGroup: "batch",
    resources: ["jobs", "cronjobs"],
    verbs: ["patch", "update"],
  },
  { apiGroup: "batch", resources: ["jobs"], verbs: ["create"] },
  { apiGroup: "", resources: ["pods"], verbs: ["delete"] },
  { apiGroup: "batch", resources: ["jobs"], verbs: ["delete"] },
  { apiGroup: "", resources: ["nodes", "pods"], verbs: ["patch", "update"] },
  { apiGroup: "", resources: ["pods/eviction"], verbs: ["create"] },
  {
    apiGroup: "autoscaling",
    resources: ["horizontalpodautoscalers"],
    verbs: ["patch", "update", "create"],
  },
];

function isGranted(grant: Grant): boolean {
  return CHART_REMEDIATION_RULES.some(
    (rule: {
      apiGroup: string;
      resources: Array<string>;
      verbs: Array<string>;
    }) => {
      return (
        rule.apiGroup === grant.apiGroup &&
        rule.resources.includes(grant.resource) &&
        rule.verbs.includes(grant.verb)
      );
    },
  );
}

/*
 * Kind spellings to probe, with the (apiGroup, resource) kubectl resolves
 * each to. `undefined` means a resource the chart never grants writes on
 * (custom resources, and built-ins outside the fixture) — any SafeWrite on
 * one of those is a parity failure.
 */
const KIND_SPELLINGS: Array<
  [string, { apiGroup: string; resource: string } | undefined]
> = [
  ["pod", { apiGroup: "", resource: "pods" }],
  ["pods", { apiGroup: "", resource: "pods" }],
  ["po", { apiGroup: "", resource: "pods" }],
  ["pods.v1.", { apiGroup: "", resource: "pods" }],
  ["node", { apiGroup: "", resource: "nodes" }],
  ["nodes", { apiGroup: "", resource: "nodes" }],
  ["deployment", { apiGroup: "apps", resource: "deployments" }],
  ["deploy", { apiGroup: "apps", resource: "deployments" }],
  ["deployments.apps", { apiGroup: "apps", resource: "deployments" }],
  ["deployments.v1.apps", { apiGroup: "apps", resource: "deployments" }],
  ["statefulset", { apiGroup: "apps", resource: "statefulsets" }],
  ["sts", { apiGroup: "apps", resource: "statefulsets" }],
  ["daemonset", { apiGroup: "apps", resource: "daemonsets" }],
  ["ds", { apiGroup: "apps", resource: "daemonsets" }],
  ["replicaset", { apiGroup: "apps", resource: "replicasets" }],
  ["rs", { apiGroup: "apps", resource: "replicasets" }],
  ["job", { apiGroup: "batch", resource: "jobs" }],
  ["jobs.batch", { apiGroup: "batch", resource: "jobs" }],
  ["cronjob", { apiGroup: "batch", resource: "cronjobs" }],
  ["cj", { apiGroup: "batch", resource: "cronjobs" }],
  ["hpa", { apiGroup: "autoscaling", resource: "horizontalpodautoscalers" }],
  // No write grant in the chart for any of these.
  ["service", undefined],
  ["svc", undefined],
  ["ingress", undefined],
  ["configmap", undefined],
  ["cm", undefined],
  ["namespace", undefined],
  ["ns", undefined],
  ["serviceaccount", undefined],
  ["sa", undefined],
  ["networkpolicy", undefined],
  ["poddisruptionbudget", undefined],
  ["pdb", undefined],
  ["persistentvolumeclaim", undefined],
  ["replicationcontroller", undefined],
  ["rc", undefined],
  ["endpoints", undefined],
  ["clusterrole", undefined],
  ["role", undefined],
  ["validatingwebhookconfiguration", undefined],
  ["pods.example.com", undefined],
  ["jobs.batch.volcano.sh", undefined],
  ["deployments.example.com", undefined],
  ["widgets.example.com", undefined],
];

/*
 * Each verb that can be SafeWrite, the command it takes for one named
 * object of `kind`, and the (verb on resource) kubectl then issues.
 */
const SAFE_WRITE_SHAPES: Array<{
  name: string;
  command: (kind: string) => string;
  grant: (target: { apiGroup: string; resource: string }) => Grant;
}> = [
  {
    name: "rollout restart",
    command: (kind: string) => {
      return `kubectl rollout restart ${kind}/x -n web`;
    },
    grant: (target: { apiGroup: string; resource: string }) => {
      return { ...target, verb: "patch" };
    },
  },
  {
    name: "rollout undo",
    command: (kind: string) => {
      return `kubectl rollout undo ${kind} x -n web`;
    },
    grant: (target: { apiGroup: string; resource: string }) => {
      return { ...target, verb: "patch" };
    },
  },
  {
    name: "rollout pause",
    command: (kind: string) => {
      return `kubectl rollout pause ${kind}/x -n web`;
    },
    grant: (target: { apiGroup: string; resource: string }) => {
      return { ...target, verb: "patch" };
    },
  },
  {
    name: "scale",
    command: (kind: string) => {
      return `kubectl scale ${kind}/x --replicas=2 -n web`;
    },
    grant: (target: { apiGroup: string; resource: string }) => {
      return {
        apiGroup: target.apiGroup,
        resource: `${target.resource}/scale`,
        verb: "patch",
      };
    },
  },
  {
    name: "delete",
    command: (kind: string) => {
      return `kubectl delete ${kind} x -n web`;
    },
    grant: (target: { apiGroup: string; resource: string }) => {
      return { ...target, verb: "delete" };
    },
  },
  {
    name: "label",
    command: (kind: string) => {
      return `kubectl label ${kind} x -n web team=a`;
    },
    grant: (target: { apiGroup: string; resource: string }) => {
      return { ...target, verb: "patch" };
    },
  },
  {
    name: "annotate",
    command: (kind: string) => {
      return `kubectl annotate ${kind}/x -n web example.com/note=x`;
    },
    grant: (target: { apiGroup: string; resource: string }) => {
      return { ...target, verb: "patch" };
    },
  },
  {
    name: "cordon",
    command: (kind: string) => {
      return `kubectl cordon ${kind}/x`;
    },
    grant: (target: { apiGroup: string; resource: string }) => {
      return { ...target, verb: "patch" };
    },
  },
  {
    name: "uncordon",
    command: (kind: string) => {
      return `kubectl uncordon ${kind}/x`;
    },
    grant: (target: { apiGroup: string; resource: string }) => {
      return { ...target, verb: "patch" };
    },
  },
];

const PROBES: Array<
  [string, string, { apiGroup: string; resource: string } | undefined]
> = SAFE_WRITE_SHAPES.flatMap(
  (shape: {
    name: string;
    command: (kind: string) => string;
    grant: (target: { apiGroup: string; resource: string }) => Grant;
  }) => {
    return KIND_SPELLINGS.map(
      ([kind, target]: [
        string,
        { apiGroup: string; resource: string } | undefined,
      ]): [
        string,
        string,
        { apiGroup: string; resource: string } | undefined,
      ] => {
        return [shape.name, shape.command(kind), target];
      },
    );
  },
);

function shapeNamed(name: string): {
  name: string;
  command: (kind: string) => string;
  grant: (target: { apiGroup: string; resource: string }) => Grant;
} {
  return SAFE_WRITE_SHAPES.find((shape: { name: string }) => {
    return shape.name === name;
  })!;
}

describe("KubectlPolicy SafeWrite stays inside the chart's remediation RBAC", () => {
  it.each(PROBES)(
    "%s: if `%s` is SafeWrite, the chart grants what it needs",
    (
      shapeName: string,
      command: string,
      target: { apiGroup: string; resource: string } | undefined,
    ) => {
      const result: KubectlPolicyResult =
        KubectlPolicy.evaluateCommand(command);

      if (result.tier !== KubectlCommandTier.SafeWrite) {
        // Not unattended: a human (or the allowlist) decides, and RBAC may refuse.
        return;
      }

      expect(target).toBeDefined();
      const grant: Grant = shapeNamed(shapeName).grant(target!);
      expect({ command, grant, granted: isGranted(grant) }).toEqual({
        command,
        grant,
        granted: true,
      });
    },
  );

  it("finds SafeWrites for the documented shapes, so the probe is not vacuous", () => {
    const safe: Array<string> = PROBES.filter(
      ([, command]: [string, string, unknown]) => {
        return (
          KubectlPolicy.evaluateCommand(command).tier ===
          KubectlCommandTier.SafeWrite
        );
      },
    ).map(([, command]: [string, string, unknown]) => {
      return command;
    });

    expect(safe).toEqual(
      expect.arrayContaining([
        "kubectl rollout restart deployment/x -n web",
        "kubectl rollout undo sts x -n web",
        "kubectl scale deploy/x --replicas=2 -n web",
        "kubectl scale replicaset/x --replicas=2 -n web",
        "kubectl delete pod x -n web",
        "kubectl label job x -n web team=a",
        "kubectl annotate cronjob/x -n web example.com/note=x",
        "kubectl cordon node/x",
        "kubectl uncordon nodes/x",
      ]),
    );
  });

  it("never calls a change on a kind the chart cannot write SafeWrite", () => {
    for (const [, command, target] of PROBES) {
      if (target === undefined) {
        expect({
          command,
          tier: KubectlPolicy.evaluateCommand(command).tier,
        }).not.toEqual({ command, tier: KubectlCommandTier.SafeWrite });
      }
    }
  });

  it("keeps the fixture in the shape ai-runner.yaml renders", () => {
    // Deleting is limited to pods and jobs, and nothing writes RBAC or Secrets.
    const deletable: Array<string> = CHART_REMEDIATION_RULES.filter(
      (rule: { verbs: Array<string> }) => {
        return rule.verbs.includes("delete");
      },
    ).flatMap((rule: { resources: Array<string> }) => {
      return rule.resources;
    });
    expect(deletable.sort()).toEqual(["jobs", "pods"]);
    expect(
      CHART_REMEDIATION_RULES.some(
        (rule: { apiGroup: string; resources: Array<string> }) => {
          return (
            rule.apiGroup === "rbac.authorization.k8s.io" ||
            rule.resources.includes("secrets") ||
            rule.resources.includes("pods/exec")
          );
        },
      ),
    ).toBe(false);
  });
});
