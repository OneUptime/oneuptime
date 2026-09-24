/*
 * ---------------------------------------------------------------------------
 * KubectlWriteScope: the words a write acts on.
 *
 * The finding this pins (PR #3953 review, round 4): the scope stopped
 * reading a command's objects at the first KEY=VALUE or trailing-`-` word
 * on EVERY verb — the root cause the shared policy fixed in its own
 * objectTokens. Only label, annotate, taint, set image and set env read
 * such a word as an update (kubectl's GetResourcesAndPairs,
 * SplitEnvironmentFromResources and taint's own split). Every other verb
 * hands kubectl's resource builder all of its words, and kubectl goes on to
 * the next object when one fails: the pinned kubectl v1.36.4 against a fake
 * API server PATCHed the Node in `patch pod/a=b node/n1` after the missing
 * pod's error. So `kubectl patch pod/a=b node/n1 -n web -p {}` was let
 * through with node operations off, and `patch pod/a=b namespace/other -n
 * web` escaped a scope of web.
 *
 * Contract under test:
 *  1. For every verb but label, annotate, taint, set image and set env, a
 *     word with an `=` or a trailing `-` hides nothing after it: a Node
 *     there is a node operation, a Namespace object there is judged by its
 *     name, any other cluster-scoped object there is outside every listed
 *     namespace. set selector's LAST word is its selector expression
 *     (kubectl's getResourcesAndSelector), never an object.
 *  2. Negative controls: the update words of label, annotate, set image and
 *     set env are still updates; a taint's KEY=VALUE:EFFECT is a node
 *     operation and nothing more; a set selector expression that reads like
 *     an object is still the selector; commands with no such word read as
 *     before.
 *  3. The scope and the shared policy read the same objects: where the
 *     policy says a patch names a Node (it always needs a human), the scope
 *     says it touches nodes.
 * ---------------------------------------------------------------------------
 */

import KubectlWriteScope, {
  KubectlWriteScopeRefusal,
  KubectlWriteScopeRefusalCode,
  KubectlWriteTargets,
} from "../../../Utils/AiRemediation/KubectlWriteScope";
import KubectlPolicy, {
  KubectlPolicyResult,
  KubectlTokenizeResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { describe, expect, test } from "@jest/globals";

function argsOf(command: string): Array<string> {
  const tokenized: KubectlTokenizeResult = KubectlPolicy.tokenize(command);
  const args: Array<string> = tokenized.args || [];

  expect(args.length).toBeGreaterThan(0);

  return args;
}

function targetsOf(command: string): KubectlWriteTargets {
  return KubectlWriteScope.resolveTargets(argsOf(command));
}

interface Posture {
  writeNamespaces: Array<string>;
  podNamespace: string | null;
  allowNodeOperations: boolean;
  usesCredential: boolean;
}

// The in-cluster Runner, scoped to web, node operations off.
const IN_CLUSTER_WEB_NODES_OFF: Posture = {
  writeNamespaces: ["web"],
  podNamespace: "oneuptime-agent",
  allowNodeOperations: false,
  usesCredential: false,
};

// The in-cluster Runner, cluster-wide, node operations off.
const IN_CLUSTER_CLUSTER_WIDE_NODES_OFF: Posture = {
  ...IN_CLUSTER_WEB_NODES_OFF,
  writeNamespaces: [],
};

// An ordinary Runner through a credential, scoped to web, node operations on.
const CREDENTIAL_WEB: Posture = {
  writeNamespaces: ["web"],
  podNamespace: null,
  allowNodeOperations: true,
  usesCredential: true,
};

// An ordinary Runner through a credential, cluster-wide, node operations off.
const CREDENTIAL_CLUSTER_WIDE_NODES_OFF: Posture = {
  writeNamespaces: [],
  podNamespace: null,
  allowNodeOperations: false,
  usesCredential: true,
};

/*
 * The scope's verdict on a command, with the shared policy's own verdict
 * on it — the way every caller asks (a command the policy denies never
 * reaches the scope).
 */
function refusalOf(
  command: string,
  posture: Posture,
): KubectlWriteScopeRefusal | null {
  const policy: KubectlPolicyResult = KubectlPolicy.evaluateCommand(command);

  expect({ command, tier: policy.tier }).not.toEqual({
    command,
    tier: KubectlCommandTier.Denied,
  });

  return KubectlWriteScope.getRefusal({ command: policy, ...posture });
}

// Words kubectl reads as one more object name, which the scope took for an update.
const HIDING_WORDS: Array<string> = ["pod/a=b", "pod/x-", "pods/web=1"];

/*
 * [verb (and subcommand), what follows the hiding word] — one per verb
 * that reads all its words; each names Node n1 after the hiding word.
 */
const NODE_AFTER_A_WORD: Array<[string, string]> = [
  ["patch", `node/n1 -n web -p '{"spec":{"unschedulable":true}}'`],
  ["scale", "node/n1 -n web --replicas=1"],
  ["expose", "node/n1 -n web --port=80"],
  ["autoscale", "node/n1 -n web --max=3"],
  ["rollout restart", "node/n1 -n web"],
  ["rollout undo", "node/n1 -n web"],
  ["set resources", "node/n1 -n web --limits=cpu=1"],
  ["set selector", "node/n1 app=web -n web"],
];

const NODE_COMMANDS: Array<string> = HIDING_WORDS.flatMap((word: string) => {
  return NODE_AFTER_A_WORD.map(([verb, rest]: [string, string]) => {
    return `kubectl ${verb} ${word} ${rest}`;
  });
});

// The review's commands: each writes something outside a scope of web.
const OUTSIDE_WEB_AFTER_A_WORD: Array<[string, KubectlWriteScopeRefusalCode]> =
  [
    [
      `kubectl patch pod/a=b namespace/other -n web -p '{"metadata":{"annotations":{"a":"b"}}}'`,
      "outside_scope",
    ],
    [
      `kubectl patch pod/x- ns/kube-public -n web -p '{"metadata":{"annotations":{"a":"b"}}}'`,
      "outside_scope",
    ],
    [
      `kubectl patch pod/a=b priorityclass/x -n web -p '{"value":1}'`,
      "cluster_scoped",
    ],
    [
      `kubectl patch pod/a=b storageclass/standard -n web -p '{"allowVolumeExpansion":true}'`,
      "cluster_scoped",
    ],
    [
      "kubectl rollout restart deployment/a=b namespace/other -n web",
      "outside_scope",
    ],
    ["kubectl scale pod/a=b pv/pv-1 -n web --replicas=1", "cluster_scoped"],
  ];

describe("resolveTargets: a word with an `=` or a trailing `-` hides nothing after it", () => {
  test.each(NODE_COMMANDS)("%s touches a node", (command: string) => {
    const targets: KubectlWriteTargets = targetsOf(command);

    expect(targets.uncertainty).toBeNull();
    expect(targets.touchesNodes).toBe(true);
    // The hiding word is a pod in web, judged as one.
    expect(targets.namespaced).toBe(true);
  });

  test("a Namespace object after such a word is read by its name", () => {
    const targets: KubectlWriteTargets = targetsOf(
      `kubectl patch pod/a=b namespace/Other -n web -p '{"metadata":{"annotations":{"a":"b"}}}'`,
    );

    expect(targets.uncertainty).toBeNull();
    expect(targets.namespaceObjects).toEqual(["other"]);
  });

  test("another cluster-scoped object after such a word is read as one", () => {
    const targets: KubectlWriteTargets = targetsOf(
      `kubectl patch pod/x- priorityclass/x -n web -p '{"value":1}'`,
    );

    expect(targets.uncertainty).toBeNull();
    expect(targets.clusterScopedKinds).toEqual(["priorityclass"]);
  });

  test("with the kind first, such a word is one more name of that kind", () => {
    const targets: KubectlWriteTargets = targetsOf(
      `kubectl patch node n1 a=b -p '{"spec":{"unschedulable":true}}'`,
    );

    expect(targets.uncertainty).toBeNull();
    expect(targets.touchesNodes).toBe(true);
    expect(targets.namespaced).toBe(false);
  });
});

describe("getRefusal: what follows such a word is judged", () => {
  // The review's command, on every Runner with node operations off.
  test.each([
    ["the in-cluster Runner scoped to web", IN_CLUSTER_WEB_NODES_OFF],
    ["the in-cluster Runner cluster-wide", IN_CLUSTER_CLUSTER_WIDE_NODES_OFF],
    ["a credential Runner cluster-wide", CREDENTIAL_CLUSTER_WIDE_NODES_OFF],
  ])(
    "patch pod/a=b node/n1 is a node operation on %s with node operations off",
    (_label: string, posture: Posture) => {
      const refusal: KubectlWriteScopeRefusal | null = refusalOf(
        `kubectl patch pod/a=b node/n1 -n web -p '{}'`,
        posture,
      );

      expect(refusal?.code).toBe("node_operations");
      expect(refusal?.uncertainty).toBeNull();
    },
  );

  test.each(NODE_COMMANDS)(
    "%s is refused while node operations are off",
    (command: string) => {
      expect(refusalOf(command, IN_CLUSTER_WEB_NODES_OFF)?.code).toBe(
        "node_operations",
      );
      expect(refusalOf(command, CREDENTIAL_CLUSTER_WIDE_NODES_OFF)?.code).toBe(
        "node_operations",
      );
    },
  );

  test.each(OUTSIDE_WEB_AFTER_A_WORD)(
    "%s is refused on a Runner scoped to web",
    (command: string, code: KubectlWriteScopeRefusalCode) => {
      expect(refusalOf(command, CREDENTIAL_WEB)?.code).toBe(code);
      expect(
        refusalOf(command, {
          ...IN_CLUSTER_WEB_NODES_OFF,
          allowNodeOperations: true,
        })?.code,
      ).toBe(code);
    },
  );

  // Nothing is configured to judge them by: RBAC decides, as for any write.
  test("a cluster-wide Runner with node operations on leaves them to RBAC", () => {
    const unscoped: Posture = {
      ...CREDENTIAL_CLUSTER_WIDE_NODES_OFF,
      allowNodeOperations: true,
    };

    expect(
      refusalOf(`kubectl patch pod/a=b node/n1 -n web -p '{}'`, unscoped),
    ).toBeNull();
    expect(
      refusalOf(
        `kubectl patch pod/a=b namespace/other -n web -p '{"metadata":{"annotations":{"a":"b"}}}'`,
        unscoped,
      ),
    ).toBeNull();
  });
});

describe("negative controls: the update words of label, annotate, taint, set image and set env", () => {
  test.each([
    "kubectl label pod web-1 node/n1=x -n web",
    "kubectl label pod web-1 namespace/other=x priorityclass/x- -n web",
    "kubectl annotate pod web-1 node/n1=x -n web",
    "kubectl annotate deployment web namespace/other- -n web",
    "kubectl set image deployment/web node/n1=img:2 -n web",
    "kubectl set image deployment/web namespace/other=img:2 -n web",
    "kubectl set env deployment/web node/n1=x -n web",
    "kubectl set env deployment/web namespace/other- -n web",
  ])("%s names only the object before its updates", (command: string) => {
    const targets: KubectlWriteTargets = targetsOf(command);

    expect(targets.uncertainty).toBeNull();
    expect(targets.touchesNodes).toBe(false);
    expect(targets.namespaceObjects).toEqual([]);
    expect(targets.clusterScopedKinds).toEqual([]);
    expect(targets.namespaced).toBe(true);
    // So it is inside a scope of web, node operations off.
    expect(refusalOf(command, IN_CLUSTER_WEB_NODES_OFF)).toBeNull();
    expect(refusalOf(command, CREDENTIAL_WEB)).toBeNull();
  });

  test("a taint's KEY=VALUE:EFFECT is an update: a node operation, not a Namespace object", () => {
    const targets: KubectlWriteTargets = targetsOf(
      "kubectl taint nodes n1 namespace/other=x:NoSchedule",
    );

    expect(targets.touchesNodes).toBe(true);
    expect(targets.namespaceObjects).toEqual([]);
    expect(
      refusalOf(
        "kubectl taint nodes n1 namespace/other=x:NoSchedule",
        CREDENTIAL_WEB,
      ),
    ).toBeNull();
  });

  test.each([
    "kubectl set selector service/web app=web -n web",
    "kubectl set selector service/web app.kubernetes.io/name=web -n web",
    // A selector expression that reads like a Node is still the selector.
    "kubectl set selector service/web node/n1 -n web",
  ])("%s: the last word is the selector, not an object", (command: string) => {
    const targets: KubectlWriteTargets = targetsOf(command);

    expect(targets.uncertainty).toBeNull();
    expect(targets.touchesNodes).toBe(false);
    expect(targets.clusterScopedKinds).toEqual([]);
    expect(targets.namespaced).toBe(true);
    expect(refusalOf(command, IN_CLUSTER_WEB_NODES_OFF)).toBeNull();
  });

  test.each([
    "kubectl rollout restart deployment/web -n web",
    "kubectl scale deployment/web --replicas=3 -n web",
    `kubectl patch deployment web -n web -p '{"spec":{"replicas":2}}'`,
    "kubectl set resources deployment/web -n web --limits=cpu=1",
    "kubectl expose deployment web -n web --port=80",
  ])("%s, with no such word, is inside a scope of web", (command: string) => {
    const targets: KubectlWriteTargets = targetsOf(command);

    expect(targets.uncertainty).toBeNull();
    expect(targets.touchesNodes).toBe(false);
    expect(refusalOf(command, IN_CLUSTER_WEB_NODES_OFF)).toBeNull();
  });
});

describe("the scope and the shared policy read the same objects", () => {
  test.each(
    HIDING_WORDS.flatMap((word: string) => {
      return [
        `kubectl patch ${word} node/n1 -n web -p '{}'`,
        `kubectl patch ${word} nodes/n1 -n web -p '{}'`,
        `kubectl patch ${word} deployment/web -n web -p '{}'`,
        `kubectl patch ${word} no/n1 -n web -p '{}'`,
      ];
    }),
  )(
    "%s: a Node patch to the policy is a node operation to the scope",
    (command: string) => {
      const policy: KubectlPolicyResult =
        KubectlPolicy.evaluateCommand(command);
      const targets: KubectlWriteTargets = targetsOf(command);

      expect(policy.tier).toBe(KubectlCommandTier.RiskyWrite);
      expect(targets.touchesNodes).toBe(policy.requiresHuman === true);
    },
  );
});
