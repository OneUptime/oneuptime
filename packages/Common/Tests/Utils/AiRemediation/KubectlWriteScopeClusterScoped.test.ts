/*
 * ---------------------------------------------------------------------------
 * KubectlWriteScope and objects that live outside every namespace.
 *
 * The finding this pins: the scope judged every write by its -n flag (or the
 * default namespace without one), whatever it changed — and kubectl ignores
 * -n for a cluster-scoped object. Two opposite errors followed:
 *
 *   - `kubectl label node node-3 disktype=ssd`, which a human approved and
 *     the chart's node role grants, was refused on the in-cluster Runner as
 *     a write into its own namespace, and the refusal told the model to add
 *     a -n that means nothing to kubectl (with one, it ran);
 *   - on a Runner scoped with ONEUPTIME_KUBECTL_WRITE_NAMESPACES=prod,
 *     `label namespace staging ... -n prod` or `patch pv ... -n prod`
 *     passed on the strength of a meaningless -n, and `label namespace
 *     <the Runner's own> ... -n prod` got past the own-namespace rule.
 *
 * Now a Node (and every node verb) is not namespace-scoped here (the node
 * switch governs it), a Namespace object is judged by its name, and any
 * other cluster-scoped object is refused while a write-namespace list is
 * set. Every command below is run through the shared KubectlPolicy first,
 * exactly as KubectlExecutor does, so the tier and verb are the executor's.
 * The node switch is on throughout: KubectlWriteScopeEntryPoint covers it.
 * ---------------------------------------------------------------------------
 */

import KubectlWriteScope, {
  KubectlWriteScopeRefusal,
  KubectlWriteTargets,
} from "../../../Utils/AiRemediation/KubectlWriteScope";
import KubectlPolicy, {
  KubectlPolicyResult,
  KubectlTokenizeResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { describe, expect, test } from "@jest/globals";

const POD_NAMESPACE: string = "oneuptime-agent";

interface Scope {
  writeNamespaces?: Array<string>;
  podNamespace?: string | null;
  // A missing -n means "default" (a credential's kubeconfig), not the pod's.
  usesCredential?: boolean;
}

function reasonOf(
  command: {
    args: Array<string>;
    tier: KubectlCommandTier;
    verb: string;
    displayCommand: string;
  },
  scope: Scope,
): string | null {
  const refusal: KubectlWriteScopeRefusal | null = KubectlWriteScope.getRefusal(
    {
      command,
      writeNamespaces: scope.writeNamespaces ?? [],
      podNamespace:
        scope.podNamespace === undefined ? POD_NAMESPACE : scope.podNamespace,
      allowNodeOperations: true,
      usesCredential: scope.usesCredential ?? false,
    },
  );

  return refusal ? refusal.reason : null;
}

function argsOf(command: string): Array<string> {
  const tokenized: KubectlTokenizeResult = KubectlPolicy.tokenize(command);
  const args: Array<string> = tokenized.args || [];

  expect(args.length).toBeGreaterThan(0);

  return args;
}

/*
 * The scope's verdict with the executor's inputs: the policy's tier, verb
 * and display command. The executor never reaches the scope for a Denied
 * command, so one here means the case is not testing what it claims.
 */
function verdict(command: string, scope: Scope = {}): string | null {
  const args: Array<string> = argsOf(command);
  const policy: KubectlPolicyResult = KubectlPolicy.evaluateArgs(args);

  expect(policy.tier).not.toBe(KubectlCommandTier.Denied);
  expect(policy.tier).not.toBe(KubectlCommandTier.Read);

  return reasonOf(policy, scope);
}

/*
 * The same with an explicit tier, for kinds the shared policy denies
 * outright (RBAC, admission, API extensions): the scope must hold on its
 * own, whatever the policy decides about them.
 */
function verdictWithoutPolicy(
  command: string,
  scope: Scope & { verb?: string } = {},
): string | null {
  const args: Array<string> = argsOf(command);

  return reasonOf(
    {
      args,
      tier: KubectlCommandTier.RiskyWrite,
      verb: scope.verb ?? "",
      displayCommand: KubectlPolicy.renderDisplayCommand(args),
    },
    scope,
  );
}

const IN_CLUSTER_SCOPES: Array<[string, Scope]> = [
  ["cluster-wide (the default install)", { writeNamespaces: [] }],
  ["scoped to web", { writeNamespaces: ["web"] }],
];

describe("writes to nodes are not namespace-scoped", () => {
  const NODE_WRITES: Array<string> = [
    "kubectl label node node-1 disktype=ssd",
    "kubectl label nodes node-1 disktype=ssd",
    "kubectl label no/node-1 disktype=ssd",
    "kubectl label node/node-1 disktype=ssd",
    "kubectl label Node node-1 disktype=ssd",
    "kubectl label nodes.v1. node-1 disktype=ssd",
    "kubectl label node node-1 node-2 disktype=ssd",
    "kubectl annotate node node-1 note=x",
    `kubectl patch node node-1 -p '{"spec":{"unschedulable":true}}'`,
    `kubectl patch node node-1 -p '{"metadata":{"labels":{"a":"b"}}}'`,
    "kubectl cordon node-1",
    "kubectl uncordon node-1",
    "kubectl drain node-1 --ignore-daemonsets",
    "kubectl taint nodes node-1 dedicated=ai:NoSchedule",
  ];

  describe.each(IN_CLUSTER_SCOPES)("%s", (_label: string, scope: Scope) => {
    test.each(NODE_WRITES)("`%s` is not refused", (command: string) => {
      expect(verdict(command, scope)).toBeNull();
    });

    /*
     * -n means nothing to kubectl for a node, so it may neither be what
     * lets a node write through nor what refuses it.
     */
    test.each(["kube-system", POD_NAMESPACE, "web", "payments"])(
      "`label node node-1 disktype=ssd -n %s` gets the same verdict as without -n",
      (namespace: string) => {
        expect(
          verdict(
            `kubectl label node node-1 disktype=ssd -n ${namespace}`,
            scope,
          ),
        ).toBeNull();
      },
    );
  });

  // Negative controls: the same shapes on namespaced objects stay scoped.
  test.each([
    ["label pod web-1 app=web", "names no namespace"],
    ["label deployment web x=y", "names no namespace"],
    ["rollout restart deployment/web", "names no namespace"],
    // A write to a node AND a pod is still a write into the pod's namespace.
    ["label node/node-1 pod/web-1 x=y", "names no namespace"],
  ])(
    "`kubectl %s` with no -n is still refused as the Runner's own namespace",
    (command: string, expected: string) => {
      const reason: string | null = verdict(`kubectl ${command}`);

      expect(reason).toContain(expected);
      expect(reason).toContain(`"${POD_NAMESPACE}"`);
      expect(reason).toContain("-n <namespace>");
    },
  );

  test("a namespaced write outside the list is still refused", () => {
    expect(
      verdict("kubectl label pod web-1 app=web -n api", {
        writeNamespaces: ["web"],
      }),
    ).toContain("outside the namespaces");
  });

  test("a node-and-pod write in an allowed namespace is let through", () => {
    expect(
      verdict("kubectl label node/node-1 pod/web-1 x=y -n web", {
        writeNamespaces: ["web"],
      }),
    ).toBeNull();
  });

  /*
   * kubectl reads "RESOURCE.GROUP": nodes.example.com is some custom
   * resource, not a Node, so it is judged by -n like any namespaced one.
   */
  test("a custom resource that happens to be called nodes is not a node", () => {
    expect(
      verdictWithoutPolicy("kubectl label nodes.example.com node-1 x=y"),
    ).toContain("names no namespace");
    expect(
      verdictWithoutPolicy("kubectl label nodes.example.com node-1 x=y -n web"),
    ).toBeNull();
  });
});

describe("a Namespace object is judged by its name, not by -n", () => {
  const writeNamespaces: Array<string> = ["web"];

  test.each([
    "kubectl label namespace staging istio-injection=disabled -n web",
    "kubectl label ns staging team=a -n web",
    "kubectl annotate namespace/staging note=x -n web",
    "kubectl label namespaces.v1. staging team=a -n web",
    "kubectl -n web label ns staging team=a",
    "kubectl create namespace staging",
  ])("`%s` is refused: staging is not listed", (command: string) => {
    const reason: string | null = verdict(command, { writeNamespaces });

    expect(reason).toContain('Namespace object "staging"');
    expect(reason).toContain("outside the namespaces");
    // The model must never be told to add a -n that would change nothing.
    expect(reason).not.toContain("-n <namespace>");
  });

  test.each([
    `kubectl label namespace ${POD_NAMESPACE} team=a -n web`,
    `kubectl label namespace ${POD_NAMESPACE} team=a`,
    `kubectl annotate ns/${POD_NAMESPACE.toUpperCase()} note=x -n web`,
  ])("`%s` is refused: it is the Runner's own namespace", (command: string) => {
    for (const scope of [{ writeNamespaces }, { writeNamespaces: [] }]) {
      const reason: string | null = verdict(command, scope);

      expect(reason).toContain(`Namespace object "${POD_NAMESPACE}"`);
      expect(reason).toContain("this Runner itself runs in");
    }
  });

  test("on the credential path (no pod namespace) the name is still what counts", () => {
    expect(
      verdict("kubectl label namespace staging team=a -n prod", {
        writeNamespaces: ["prod"],
        podNamespace: null,
        usesCredential: true,
      }),
    ).toContain('Namespace object "staging"');
  });

  test.each([
    "kubectl label namespaces --all team=a",
    "kubectl label ns -l env=prod team=a",
  ])(
    "`%s` changes Namespace objects it does not name, and is refused",
    (command: string) => {
      for (const scope of [{ writeNamespaces }, { writeNamespaces: [] }]) {
        expect(verdict(command, scope)).toContain(
          "Namespace objects without naming them",
        );
      }
    },
  );

  // Negative controls: a listed namespace, whatever -n says.
  test.each([
    "kubectl label namespace web team=a",
    "kubectl label namespace web team=a -n kube-system",
    "kubectl label namespace web team=a -n staging",
    "kubectl create namespace web",
  ])("`%s` is let through", (command: string) => {
    expect(verdict(command, { writeNamespaces })).toBeNull();
  });

  test("without a list, any Namespace object but the Runner's own is left to RBAC", () => {
    expect(
      verdict("kubectl label namespace staging team=a", {
        writeNamespaces: [],
      }),
    ).toBeNull();
  });
});

describe("other cluster-scoped objects are outside every listed namespace", () => {
  const CLUSTER_SCOPED_WRITES: Array<string> = [
    `kubectl patch pv pv-1 -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'`,
    `kubectl patch persistentvolume/pv-1 -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'`,
    `kubectl patch storageclass standard -p '{"allowVolumeExpansion":true}'`,
    `kubectl patch storageclasses.storage.k8s.io standard -p '{"allowVolumeExpansion":true}'`,
    "kubectl annotate ingressclass nginx note=x",
    "kubectl annotate ingressclasses.v1.networking.k8s.io nginx note=x",
    "kubectl label priorityclass high team=a",
    "kubectl label runtimeclass gvisor team=a",
    "kubectl create priorityclass high --value=1000",
  ];

  // The scenario from the review: an external Runner scoped to prod.
  test.each(CLUSTER_SCOPED_WRITES)(
    "`%s -n prod` is refused on a Runner scoped to prod",
    (command: string) => {
      const reason: string | null = verdict(`${command} -n prod`, {
        writeNamespaces: ["prod"],
        podNamespace: null,
        usesCredential: true,
      });

      expect(reason).toContain("cluster-scoped");
      expect(reason).toContain("whatever -n says");
      expect(reason).not.toContain("-n <namespace>");
    },
  );

  test.each(CLUSTER_SCOPED_WRITES)(
    "`%s` is left to RBAC when no list is set, even in-cluster with no -n",
    (command: string) => {
      expect(verdict(command, { writeNamespaces: [] })).toBeNull();
    },
  );

  /*
   * Kinds the shared policy denies outright (RBAC, admission, API
   * extensions): the scope holds on its own for them too.
   */
  test.each([
    "kubectl label clusterrole view team=a -n web",
    "kubectl annotate crd widgets.example.com note=x -n web",
    "kubectl annotate validatingwebhookconfiguration hook note=x -n web",
    "kubectl annotate apiservice v1.example.com note=x -n web",
  ])("`%s` is refused while a list is set", (command: string) => {
    expect(
      verdictWithoutPolicy(command, { writeNamespaces: ["web"] }),
    ).toContain("cluster-scoped");
  });

  // Negative control: an ordinary namespaced write in scope still runs.
  test("`patch deployment web -n web` is let through under the same list", () => {
    expect(
      verdict(
        `kubectl patch deployment web -n web -p '{"spec":{"paused":false}}'`,
        { writeNamespaces: ["web"] },
      ),
    ).toBeNull();
  });
});

describe("what the scope cannot read for certain is refused", () => {
  test("a flag this Runner does not know makes the objects uncertain", () => {
    const reason: string | null = verdictWithoutPolicy(
      "kubectl label --brand-new-flag node node-1 x=y",
    );

    expect(reason).toContain("cannot tell for certain which objects");
    expect(reason).toContain('"--brand-new-flag"');
  });

  test("a separate name after TYPE/NAME is uncertain (kubectl refuses it)", () => {
    expect(
      verdictWithoutPolicy("kubectl label node/node-1 pod-1 x=y -n web"),
    ).toContain("cannot tell for certain which objects");
  });

  test("a reading that disagrees with the policy's verb is refused", () => {
    expect(
      verdictWithoutPolicy("kubectl label node node-1 x=y", {
        verb: "rollout restart",
      }),
    ).toContain('the kubectl policy read "rollout"');
  });

  // Negative control: the same argv with the policy's own verb runs.
  test("the same argv with the verb the policy read is let through", () => {
    expect(
      verdictWithoutPolicy("kubectl label node node-1 x=y", { verb: "label" }),
    ).toBeNull();
  });

  test("nothing is refused when no scope is configured at all", () => {
    expect(
      verdictWithoutPolicy("kubectl label --brand-new-flag node node-1 x=y", {
        writeNamespaces: [],
        podNamespace: null,
      }),
    ).toBeNull();
  });
});

describe("KubectlWriteScope.resolveTargets", () => {
  function targetsOf(command: string): KubectlWriteTargets {
    return KubectlWriteScope.resolveTargets(argsOf(command));
  }

  test.each([
    [
      "a node verb",
      "kubectl drain node-1 --ignore-daemonsets",
      { touchesNodes: true, namespaced: false },
    ],
    [
      "a node label",
      "kubectl label node node-1 a=b",
      { touchesNodes: true, namespaced: false },
    ],
    [
      "a node patch after flags",
      `kubectl patch --type=merge -p '{"spec":{}}' node node-1`,
      { touchesNodes: true, namespaced: false },
    ],
    [
      "a node and a pod",
      "kubectl label node/node-1 pod/web-1 a=b",
      { touchesNodes: true, namespaced: true },
    ],
    [
      "a pod",
      "kubectl label pod web-1 a=b",
      { touchesNodes: false, namespaced: true },
    ],
    [
      "a selector value that names a node is a value, not the kind",
      "kubectl label -l node=x pods a=b",
      { touchesNodes: false, namespaced: true },
    ],
    [
      "a label value that looks like a node is a pair, not an object",
      "kubectl label pod web-1 node/x=y",
      { touchesNodes: false, namespaced: true },
    ],
    [
      "set image names its workload after the subcommand",
      "kubectl set image deployment/web web=img:2 -n web",
      { touchesNodes: false, namespaced: true },
    ],
    [
      "expose makes a namespaced Service",
      "kubectl expose deployment web --port=80",
      { touchesNodes: false, namespaced: true },
    ],
    [
      "create job is namespaced",
      "kubectl create job web-1 --from=cronjob/web -n web",
      { touchesNodes: false, namespaced: true },
    ],
  ])(
    "%s",
    (
      _label: string,
      command: string,
      expected: { touchesNodes: boolean; namespaced: boolean },
    ) => {
      const targets: KubectlWriteTargets = targetsOf(command);

      expect(targets.uncertainty).toBeNull();
      expect(targets.touchesNodes).toBe(expected.touchesNodes);
      expect(targets.namespaced).toBe(expected.namespaced);
    },
  );

  test("Namespace objects are named, lowercased and de-duplicated", () => {
    const targets: KubectlWriteTargets = targetsOf(
      "kubectl label ns Web api web x=y",
    );

    expect(targets.namespaceObjects).toEqual(["web", "api"]);
    expect(targets.unnamedNamespaceObjects).toBe(false);
    expect(targets.namespaced).toBe(false);
  });

  test("a comma list of kinds names each object of each kind", () => {
    const targets: KubectlWriteTargets = targetsOf(
      "kubectl label ns,pv staging x=y",
    );

    expect(targets.namespaceObjects).toEqual(["staging"]);
    expect(targets.clusterScopedKinds).toEqual(["persistentvolume"]);
    expect(targets.namespaced).toBe(false);
  });

  test("create namespace and create priorityclass are cluster-scoped", () => {
    expect(
      targetsOf("kubectl create namespace team-a").namespaceObjects,
    ).toEqual(["team-a"]);
    expect(
      targetsOf("kubectl create priorityclass high --value=10")
        .clusterScopedKinds,
    ).toEqual(["priorityclass"]);
  });

  test("an unknown create subcommand is uncertain", () => {
    expect(targetsOf("kubectl create widget x").uncertainty).toContain(
      '"create widget"',
    );
  });

  test("flags before the kind are read by their arity", () => {
    // --field-manager takes a value: "node" is its value, pods is the kind.
    const valued: KubectlWriteTargets = targetsOf(
      "kubectl label --field-manager node pods web-1 a=b",
    );
    expect(valued.touchesNodes).toBe(false);
    expect(valued.namespaced).toBe(true);

    // --overwrite takes none: node IS the kind.
    const bare: KubectlWriteTargets = targetsOf(
      "kubectl label --overwrite node node-1 a=b",
    );
    expect(bare.touchesNodes).toBe(true);
    expect(bare.namespaced).toBe(false);
  });
});
