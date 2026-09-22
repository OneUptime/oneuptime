import KubectlPolicy, {
  KubectlPolicyResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";

/*
 * Contract under test — the kubectl policy and the kubernetes-agent chart's
 * RBAC agree on what the in-cluster Runner can do unattended.
 *
 * A SafeWrite runs with nobody asked on an Automatic cluster. If the policy
 * tiers a command SafeWrite that the chart's RBAC does not allow, the Runner
 * runs it unattended, the API server answers Forbidden, and the failure lands
 * on the incident and the cluster's AI page as if the fix had been tried and
 * failed. So every command the policy tiers SafeWrite must be covered by the
 * roles the chart renders; a new SafeWrite kind with no grant fails here.
 * The fix for a failure is normally in the policy (tier it riskier), not in
 * the chart: widening the Runner's write RBAC is a deliberate decision, which
 * the second half of this file pins.
 *
 * The rules are not copied here. They are read from the arrays
 * tests/ai-runner_test.yaml pins with `equal` against the rendered chart, so
 * this file and the chart cannot drift apart silently: change the chart and
 * helm-unittest makes you change those arrays, and this test reads the new
 * ones. Each command is mapped to the (apiGroup, resource, verb) requests
 * kubectl makes for it — the resource builder GETs the object, `rollout
 * undo` lists ReplicaSets / ControllerRevisions, `scale` PATCHes (or GETs and
 * UPDATEs) the scale subresource, `drain` creates evictions, and so on.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const CHART_TEST_PATH: string = path.join(
  REPO_ROOT,
  "HelmChart",
  "Public",
  "kubernetes-agent",
  "tests",
  "ai-runner_test.yaml",
);
// The helm-unittest case that pins all three roles with remediation on.
const PINNED_TEST_NAME_PREFIX: string =
  "puts the fix verbs in a remediation role";

interface RbacRule {
  apiGroups: Array<string>;
  resources: Array<string>;
  verbs: Array<string>;
}

interface ApiRequest {
  apiGroup: string;
  resource: string;
  verb: string;
}

interface HelmUnitAssert {
  documentIndex?: number;
  equal?: { path: string; value: unknown };
}

interface HelmUnitTest {
  it: string;
  asserts?: Array<HelmUnitAssert>;
}

interface PinnedRoles {
  read: Array<RbacRule>;
  remediation: Array<RbacRule>;
  nodeOperations: Array<RbacRule>;
}

function readPinnedRoles(): PinnedRoles {
  const suite: { tests: Array<HelmUnitTest> } = yaml.load(
    fs.readFileSync(CHART_TEST_PATH, "utf8"),
  ) as { tests: Array<HelmUnitTest> };
  const test: HelmUnitTest | undefined = suite.tests.find(
    (candidate: HelmUnitTest) => {
      return candidate.it.startsWith(PINNED_TEST_NAME_PREFIX);
    },
  );

  if (!test) {
    throw new Error(
      `tests/ai-runner_test.yaml has no case starting "${PINNED_TEST_NAME_PREFIX}"`,
    );
  }

  const namesByIndex: Map<number, string> = new Map<number, string>();
  const rulesByIndex: Map<number, Array<RbacRule>> = new Map<
    number,
    Array<RbacRule>
  >();

  for (const assert of test.asserts || []) {
    if (assert.documentIndex === undefined || !assert.equal) {
      continue;
    }

    if (assert.equal.path === "metadata.name") {
      namesByIndex.set(assert.documentIndex, String(assert.equal.value));
    }

    if (assert.equal.path === "rules") {
      rulesByIndex.set(
        assert.documentIndex,
        assert.equal.value as Array<RbacRule>,
      );
    }
  }

  const rolesBySuffix: Map<string, Array<RbacRule>> = new Map<
    string,
    Array<RbacRule>
  >();

  for (const [index, rules] of rulesByIndex) {
    const name: string | undefined = namesByIndex.get(index);

    if (name) {
      rolesBySuffix.set(name.replace(/^.*-ai-runner/, "ai-runner"), rules);
    }
  }

  const read: Array<RbacRule> | undefined = rolesBySuffix.get("ai-runner");
  const remediation: Array<RbacRule> | undefined = rolesBySuffix.get(
    "ai-runner-remediation",
  );
  const nodeOperations: Array<RbacRule> | undefined = rolesBySuffix.get(
    "ai-runner-node-operations",
  );

  if (!read || !remediation || !nodeOperations) {
    throw new Error(
      `Expected the read-only, remediation and node-operations roles pinned in "${test.it}", found: ${Array.from(rolesBySuffix.keys()).join(", ")}`,
    );
  }

  return { read, remediation, nodeOperations };
}

function isAllowed(rules: Array<RbacRule>, request: ApiRequest): boolean {
  return rules.some((rule: RbacRule) => {
    return (
      rule.apiGroups.includes(request.apiGroup) &&
      rule.resources.includes(request.resource) &&
      rule.verbs.includes(request.verb)
    );
  });
}

// kind (as the policy normalizes it) -> where it lives in the API.
const KIND_RESOURCES: Record<string, { apiGroup: string; resource: string }> = {
  pod: { apiGroup: "", resource: "pods" },
  node: { apiGroup: "", resource: "nodes" },
  service: { apiGroup: "", resource: "services" },
  configmap: { apiGroup: "", resource: "configmaps" },
  namespace: { apiGroup: "", resource: "namespaces" },
  persistentvolumeclaim: {
    apiGroup: "",
    resource: "persistentvolumeclaims",
  },
  serviceaccount: { apiGroup: "", resource: "serviceaccounts" },
  replicationcontroller: {
    apiGroup: "",
    resource: "replicationcontrollers",
  },
  deployment: { apiGroup: "apps", resource: "deployments" },
  statefulset: { apiGroup: "apps", resource: "statefulsets" },
  daemonset: { apiGroup: "apps", resource: "daemonsets" },
  replicaset: { apiGroup: "apps", resource: "replicasets" },
  job: { apiGroup: "batch", resource: "jobs" },
  cronjob: { apiGroup: "batch", resource: "cronjobs" },
  horizontalpodautoscaler: {
    apiGroup: "autoscaling",
    resource: "horizontalpodautoscalers",
  },
  ingress: { apiGroup: "networking.k8s.io", resource: "ingresses" },
  networkpolicy: {
    apiGroup: "networking.k8s.io",
    resource: "networkpolicies",
  },
  poddisruptionbudget: {
    apiGroup: "policy",
    resource: "poddisruptionbudgets",
  },
  role: { apiGroup: "rbac.authorization.k8s.io", resource: "roles" },
  clusterrole: {
    apiGroup: "rbac.authorization.k8s.io",
    resource: "clusterroles",
  },
};

function request(kind: string, verb: string, subresource?: string): ApiRequest {
  const target: { apiGroup: string; resource: string } | undefined =
    KIND_RESOURCES[kind];

  if (!target) {
    throw new Error(`No API mapping for kind ${kind}`);
  }

  return {
    apiGroup: target.apiGroup,
    resource: subresource
      ? `${target.resource}/${subresource}`
      : target.resource,
    verb,
  };
}

interface Candidate {
  command: string;
  // Every API request kubectl makes to carry the command out.
  requests: Array<ApiRequest>;
}

// Label / annotate: GET the object through the resource builder, then PATCH.
function metadataWrite(verb: string, kind: string, name: string): Candidate {
  return {
    command: `kubectl ${verb} ${kind} ${name} -n web team=payments`,
    requests: [request(kind, "get"), request(kind, "patch")],
  };
}

const KINDS_KUBECTL_CAN_LABEL: Array<string> = Object.keys(KIND_RESOURCES);

/*
 * SafeWrite-shaped commands on every kind: the verbs the policy may tier
 * SafeWrite, each on exactly one named object in an ordinary namespace.
 * Whatever the policy tiers SafeWrite among these must be allowed by RBAC.
 */
const SAFE_SHAPED_CANDIDATES: Array<Candidate> = [
  ...KINDS_KUBECTL_CAN_LABEL.flatMap((kind: string) => {
    return [
      metadataWrite("label", kind, "web-1"),
      metadataWrite("annotate", kind, "web-1"),
    ];
  }),
  ...["deployment", "statefulset", "daemonset"].flatMap((kind: string) => {
    return ["restart", "pause", "resume"].map((subcommand: string) => {
      return {
        command: `kubectl rollout ${subcommand} ${kind}/web -n web`,
        requests: [request(kind, "get"), request(kind, "patch")],
      };
    });
  }),
  {
    command: "kubectl rollout undo deployment/web -n web",
    requests: [
      request("deployment", "get"),
      request("replicaset", "list"),
      request("deployment", "patch"),
    ],
  },
  ...["statefulset", "daemonset"].map((kind: string) => {
    return {
      command: `kubectl rollout undo ${kind}/web -n web`,
      requests: [
        request(kind, "get"),
        { apiGroup: "apps", resource: "controllerrevisions", verb: "list" },
        request(kind, "patch"),
      ],
    };
  }),
  ...["deployment", "statefulset", "replicaset", "replicationcontroller"].map(
    (kind: string) => {
      return {
        command: `kubectl scale ${kind}/web -n web --replicas=3`,
        requests: [request(kind, "get"), request(kind, "patch", "scale")],
      };
    },
  ),
  {
    // --current-replicas: GET the scale subresource, then UPDATE it.
    command:
      "kubectl scale deployment/web -n web --current-replicas=2 --replicas=3",
    requests: [
      request("deployment", "get"),
      request("deployment", "get", "scale"),
      request("deployment", "update", "scale"),
    ],
  },
  {
    command: "kubectl delete pod web-1 -n web",
    requests: [request("pod", "delete")],
  },
  {
    command: "kubectl delete job migrate-1 -n web",
    requests: [request("job", "delete")],
  },
  {
    command: "kubectl cordon worker-1",
    requests: [request("node", "get"), request("node", "patch")],
  },
  {
    command: "kubectl uncordon worker-1",
    requests: [request("node", "get"), request("node", "patch")],
  },
];

/*
 * The fixes the chart's write RBAC exists for: every one must work
 * in-cluster once it is approved (or allowlisted, or on Bypass approval).
 */
const GRANTED_FIXES: Array<Candidate> = [
  {
    command: "kubectl set image deployment/web web=registry/web:1.2.3 -n web",
    requests: [request("deployment", "get"), request("deployment", "patch")],
  },
  {
    command:
      'kubectl patch deployment web -n web -p \'{"spec":{"template":{"spec":{"containers":[{"name":"web","resources":{"limits":{"memory":"1Gi"}}}]}}}}\'',
    requests: [request("deployment", "get"), request("deployment", "patch")],
  },
  {
    command:
      'kubectl patch cronjob nightly -n web -p \'{"spec":{"suspend":true}}\'',
    requests: [request("cronjob", "get"), request("cronjob", "patch")],
  },
  {
    command: "kubectl create job nightly-manual -n web --from=cronjob/nightly",
    requests: [request("cronjob", "get"), request("job", "create")],
  },
  {
    command: "kubectl autoscale deployment web -n web --min=2 --max=5",
    requests: [
      request("deployment", "get"),
      request("horizontalpodautoscaler", "create"),
    ],
  },
  {
    command: 'kubectl patch hpa web -n web -p \'{"spec":{"maxReplicas":8}}\'',
    requests: [
      request("horizontalpodautoscaler", "get"),
      request("horizontalpodautoscaler", "patch"),
    ],
  },
  {
    command: "kubectl taint nodes worker-1 dedicated=db:NoSchedule",
    requests: [request("node", "get"), request("node", "patch")],
  },
  {
    command:
      "kubectl drain worker-1 --ignore-daemonsets --delete-emptydir-data",
    requests: [
      request("node", "get"),
      request("node", "patch"),
      request("pod", "list"),
      request("daemonset", "get"),
      request("replicaset", "get"),
      request("pod", "create", "eviction"),
    ],
  },
];

/*
 * Writes the chart deliberately does not grant. The policy may still let a
 * human approve them for an external Runner whose credential allows them;
 * in-cluster they fail Forbidden, which is why none of them may be
 * SafeWrite (checked above) and why the docs say so.
 */
const NOT_GRANTED: Array<Candidate> = [
  metadataWrite("annotate", "ingress", "web"),
  metadataWrite("label", "service", "web"),
  metadataWrite("label", "configmap", "app-config"),
  metadataWrite("label", "namespace", "web"),
  metadataWrite("label", "persistentvolumeclaim", "data"),
  {
    command: "kubectl expose deployment web -n web --port=80",
    requests: [request("deployment", "get"), request("service", "create")],
  },
  {
    command: "kubectl scale rc legacy -n web --replicas=2",
    requests: [
      request("replicationcontroller", "get"),
      request("replicationcontroller", "patch", "scale"),
    ],
  },
  {
    command: "kubectl delete deployment web -n web",
    requests: [request("deployment", "delete")],
  },
  {
    command:
      "kubectl create clusterrolebinding x --clusterrole=admin --serviceaccount=web:web",
    requests: [
      {
        apiGroup: "rbac.authorization.k8s.io",
        resource: "clusterrolebindings",
        verb: "create",
      },
    ],
  },
];

/*
 * Kind spellings to probe, with the (apiGroup, resource) kubectl resolves
 * each to. `undefined` means a resource the chart never grants writes on
 * (custom resources, and built-ins outside the chart's write roles) — any
 * SafeWrite on one of those is a parity failure.
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
  grant: (target: { apiGroup: string; resource: string }) => ApiRequest;
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
    grant: (target: { apiGroup: string; resource: string }) => ApiRequest;
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
  grant: (target: { apiGroup: string; resource: string }) => ApiRequest;
} {
  return SAFE_WRITE_SHAPES.find((shape: { name: string }) => {
    return shape.name === name;
  })!;
}

describe("KubectlPolicy against the kubernetes-agent chart's RBAC", () => {
  const roles: PinnedRoles = readPinnedRoles();
  // Remediation on, nodeOperations at its default (on).
  const granted: Array<RbacRule> = [
    ...roles.read,
    ...roles.remediation,
    ...roles.nodeOperations,
  ];

  function missingRequests(candidate: Candidate): Array<string> {
    return candidate.requests
      .filter((apiRequest: ApiRequest) => {
        return !isAllowed(granted, apiRequest);
      })
      .map((apiRequest: ApiRequest) => {
        return `${apiRequest.verb} ${apiRequest.apiGroup || "core"}/${apiRequest.resource}`;
      });
  }

  it("reads the three roles the chart test pins", () => {
    expect(roles.read.length).toBeGreaterThan(0);
    expect(roles.remediation.length).toBeGreaterThan(0);
    expect(roles.nodeOperations.length).toBeGreaterThan(0);
    // The read-only role really is read-only (a sanity check on the
    // parsing: the write rules must not have been read into it).
    expect(isAllowed(roles.read, request("deployment", "patch"))).toBe(false);
  });

  it("allows every command the policy would run unattended as a safe change", () => {
    const unattendedButForbidden: Array<string> = SAFE_SHAPED_CANDIDATES.filter(
      (candidate: Candidate) => {
        return (
          KubectlPolicy.evaluateCommand(candidate.command).tier ===
          KubectlCommandTier.SafeWrite
        );
      },
    )
      .map((candidate: Candidate) => {
        const missing: Array<string> = missingRequests(candidate);
        return missing.length
          ? `${candidate.command} (RBAC lacks: ${missing.join(", ")})`
          : "";
      })
      .filter(Boolean);

    expect(unattendedButForbidden).toEqual([]);
  });

  it("keeps the everyday safe fixes safe, so the parity above is not vacuous", () => {
    const everydaySafeFixes: Array<string> = [
      "kubectl rollout restart deployment/web -n web",
      "kubectl rollout undo deployment/web -n web",
      "kubectl rollout undo daemonset/web -n web",
      "kubectl scale deployment/web -n web --replicas=3",
      "kubectl delete pod web-1 -n web",
      "kubectl cordon worker-1",
      "kubectl label pod web-1 -n web team=payments",
      "kubectl annotate deployment web-1 -n web team=payments",
    ];

    for (const command of everydaySafeFixes) {
      expect({
        command,
        tier: KubectlPolicy.evaluateCommand(command).tier,
      }).toEqual({ command, tier: KubectlCommandTier.SafeWrite });

      const candidate: Candidate | undefined = SAFE_SHAPED_CANDIDATES.find(
        (item: Candidate) => {
          return item.command === command;
        },
      );

      expect({ command, mapped: Boolean(candidate) }).toEqual({
        command,
        mapped: true,
      });
      expect({ command, missing: missingRequests(candidate!) }).toEqual({
        command,
        missing: [],
      });
    }
  });

  it("grants what the riskier fixes the chart exists for need, once a human approves them", () => {
    for (const candidate of GRANTED_FIXES) {
      expect({
        command: candidate.command,
        denied:
          KubectlPolicy.evaluateCommand(candidate.command).tier ===
          KubectlCommandTier.Denied,
      }).toEqual({ command: candidate.command, denied: false });
      expect({
        command: candidate.command,
        missing: missingRequests(candidate),
      }).toEqual({ command: candidate.command, missing: [] });
    }
  });

  it("does not grant writes outside the workload kinds, so widening the Runner's RBAC stays a deliberate change", () => {
    for (const candidate of NOT_GRANTED) {
      expect({
        command: candidate.command,
        forbidden: missingRequests(candidate).length > 0,
      }).toEqual({ command: candidate.command, forbidden: true });
    }
  });

  it("keeps node operations out of the namespaced remediation role", () => {
    // Bound per namespace, a nodes rule would do nothing (nodes are
    // cluster-scoped) — and bound cluster-wide it would ignore
    // aiAccess.remediation.nodeOperations.
    expect(isAllowed(roles.remediation, request("node", "patch"))).toBe(false);
    expect(
      isAllowed(roles.remediation, request("pod", "create", "eviction")),
    ).toBe(false);
    expect(isAllowed(roles.nodeOperations, request("node", "patch"))).toBe(
      true,
    );
    expect(
      isAllowed(roles.nodeOperations, request("pod", "create", "eviction")),
    ).toBe(true);
  });
});

/*
 * The generative half: every write verb that can be SafeWrite, crossed with
 * every kind spelling above (built-in kinds, short names, group-qualified
 * forms and custom look-alikes), one named object each. Whatever the policy
 * tiers SafeWrite among these must be a request the chart's roles allow — so
 * an alias or a group-qualified spelling can never smuggle a kind the chart
 * cannot write into the unattended tier.
 */
describe("KubectlPolicy SafeWrite stays inside the chart's roles for every kind spelling", () => {
  const roles: PinnedRoles = readPinnedRoles();
  const granted: Array<RbacRule> = [
    ...roles.read,
    ...roles.remediation,
    ...roles.nodeOperations,
  ];

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
      const apiRequest: ApiRequest = shapeNamed(shapeName).grant(target!);
      expect({
        command,
        apiRequest,
        granted: isAllowed(granted, apiRequest),
      }).toEqual({
        command,
        apiRequest,
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

  it("never tiers a change on a kind the chart cannot write SafeWrite", () => {
    for (const [, command, target] of PROBES) {
      if (target === undefined) {
        expect({
          command,
          tier: KubectlPolicy.evaluateCommand(command).tier,
        }).not.toEqual({ command, tier: KubectlCommandTier.SafeWrite });
      }
    }
  });

  it("deletes only pods and jobs, and never writes RBAC, Secrets or exec", () => {
    const writeRules: Array<RbacRule> = [
      ...roles.remediation,
      ...roles.nodeOperations,
    ];
    const deletable: Array<string> = writeRules
      .filter((rule: RbacRule) => {
        return rule.verbs.includes("delete");
      })
      .flatMap((rule: RbacRule) => {
        return rule.resources;
      });
    expect(Array.from(new Set(deletable)).sort()).toEqual(["jobs", "pods"]);
    expect(
      [...roles.read, ...writeRules].some((rule: RbacRule) => {
        return (
          rule.apiGroups.includes("rbac.authorization.k8s.io") &&
          rule.verbs.some((verb: string) => {
            return verb !== "get" && verb !== "list" && verb !== "watch";
          })
        );
      }),
    ).toBe(false);
    expect(
      [...roles.read, ...writeRules].some((rule: RbacRule) => {
        return (
          rule.resources.includes("secrets") ||
          rule.resources.includes("pods/exec") ||
          rule.resources.includes("pods/attach") ||
          rule.resources.includes("pods/portforward")
        );
      }),
    ).toBe(false);
  });
});
