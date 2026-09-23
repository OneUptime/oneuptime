/*
 * ---------------------------------------------------------------------------
 * KubectlWriteScope.getRefusal: the ONE write-scope question.
 *
 * The Runner, the server's enqueue chokepoint and the remediation toolkit
 * used to answer "would the bound Runner refuse this write?" with three
 * implementations. Now each passes the same five inputs — the command (a
 * policy verdict or an argv), the write namespaces, the pod's namespace,
 * the node switch, and whether kubectl runs through a credential — and
 * words the structured answer itself. This suite pins the entry point's
 * own contract: the node switch it now owns, both command forms, where a
 * missing -n lands, and the facts every caller words its message from.
 * (KubectlWriteScope and KubectlWriteScopeClusterScoped pin the namespace
 * scope itself; KubectlWriteScopeCallerParity holds the callers to it.)
 * ---------------------------------------------------------------------------
 */

import KubectlWriteScope, {
  KubectlWriteScopeCommand,
  KubectlWriteScopeInput,
  KubectlWriteScopeNamespaceSource,
  KubectlWriteScopeRefusal,
  KubectlWriteScopeRefusalCode,
} from "../../../Utils/AiRemediation/KubectlWriteScope";
import KubectlPolicy, {
  KubectlPolicyResult,
  KubectlTokenizeResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import {
  KUBECTL_ALLOW_NODE_OPERATIONS_ENV,
  KubectlCommandTier,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { describe, expect, test } from "@jest/globals";

const POD_NAMESPACE: string = "oneuptime-agent";

function argsOf(command: string): Array<string> {
  const tokenized: KubectlTokenizeResult = KubectlPolicy.tokenize(command);
  const args: Array<string> = tokenized.args || [];

  expect(args.length).toBeGreaterThan(0);

  return args;
}

/*
 * The shared policy's verdict on a command the policy lets through as a
 * write — the input every caller already holds.
 */
function writeOf(command: string): KubectlPolicyResult {
  const policy: KubectlPolicyResult = KubectlPolicy.evaluateCommand(command);

  expect(policy.tier).not.toBe(KubectlCommandTier.Denied);
  expect(policy.tier).not.toBe(KubectlCommandTier.Read);

  return policy;
}

/*
 * A command the policy denies (or tiers differently today), judged as a
 * RiskyWrite: the scope must hold on its own.
 */
function riskyWriteOf(
  command: string,
  verb: string = "",
): KubectlWriteScopeCommand {
  const args: Array<string> = argsOf(command);

  return {
    args,
    tier: KubectlCommandTier.RiskyWrite,
    verb,
    displayCommand: KubectlPolicy.renderDisplayCommand(args),
  };
}

function refusalOf(
  command: KubectlWriteScopeCommand | Array<string>,
  scope: Partial<Omit<KubectlWriteScopeInput, "command">> = {},
): KubectlWriteScopeRefusal | null {
  return KubectlWriteScope.getRefusal({
    command,
    writeNamespaces: scope.writeNamespaces ?? [],
    podNamespace:
      scope.podNamespace === undefined ? POD_NAMESPACE : scope.podNamespace,
    allowNodeOperations: scope.allowNodeOperations ?? true,
    usesCredential: scope.usesCredential ?? false,
  });
}

const NODE_OPERATIONS: Array<string> = [
  "kubectl cordon n1",
  "kubectl uncordon n1",
  "kubectl drain n1 --ignore-daemonsets",
  "kubectl taint nodes n1 dedicated=ai:NoSchedule",
  "kubectl label node n1 team=a",
  "kubectl label nodes/n1 team=a --overwrite",
  "kubectl annotate no n1 note=x",
  `kubectl patch nodes.v1. n1 -p '{"spec":{"unschedulable":true}}'`,
  "kubectl label --save-config node n1 team=a",
  "kubectl label node n1 team=a -n kube-system",
];

interface NamespaceScope {
  writeNamespaces: Array<string>;
  podNamespace: string | null;
}

const NAMESPACE_SCOPES: Array<[string, NamespaceScope]> = [
  [
    "with no namespace scope at all",
    { writeNamespaces: [], podNamespace: null },
  ],
  [
    "with a namespace scope",
    { writeNamespaces: ["web"], podNamespace: POD_NAMESPACE },
  ],
];

describe("the node switch is part of the one rule", () => {
  describe.each(NAMESPACE_SCOPES)(
    "%s",
    (_label: string, scope: NamespaceScope) => {
      test.each(NODE_OPERATIONS)(
        "`%s` is refused while the switch is off",
        (command: string) => {
          const refusal: KubectlWriteScopeRefusal | null = refusalOf(
            writeOf(command),
            { ...scope, allowNodeOperations: false },
          );

          expect(refusal?.code).toBe("node_operations");
          expect(refusal?.uncertainty).toBeNull();
          // Nothing in the command itself would make it run.
          expect(refusal?.fix).toBe("");
          expect(refusal?.reason).toContain("is a node operation");
          expect(refusal?.reason).toContain(KUBECTL_ALLOW_NODE_OPERATIONS_ENV);
        },
      );

      // Negative control: the same commands with the switch on.
      test.each(NODE_OPERATIONS)(
        "`%s` is let through while the switch is on (a node is in no namespace)",
        (command: string) => {
          expect(
            refusalOf(writeOf(command), {
              ...scope,
              allowNodeOperations: true,
            }),
          ).toBeNull();
        },
      );
    },
  );

  test("a write whose objects cannot be read for certain could be a node operation, so it is refused", () => {
    const refusal: KubectlWriteScopeRefusal | null = refusalOf(
      writeOf("kubectl label node/n1 pod-1 x=y -n web"),
      { writeNamespaces: [], podNamespace: null, allowNodeOperations: false },
    );

    expect(refusal?.code).toBe("node_operations");
    expect(refusal?.uncertainty).toContain("separate name after TYPE/NAME");
    expect(refusal?.fix).toContain("TYPE NAME or TYPE/NAME");
    expect(refusal?.reason).toContain(
      'cannot tell for certain whether "kubectl label node/n1 pod-1 x=y -n web" changes a node',
    );
  });

  test("the switch is asked before the namespace scope", () => {
    const refusal: KubectlWriteScopeRefusal | null = refusalOf(
      writeOf("kubectl label node/n1 pod/web-1 x=y -n payments"),
      { writeNamespaces: ["web"], allowNodeOperations: false },
    );

    expect(refusal?.code).toBe("node_operations");
  });

  // Negative controls: writes that change no node, and reads.
  test.each([
    "kubectl rollout restart deployment/web -n web",
    "kubectl label pod web-1 app=web -n web",
    "kubectl set image deployment/web web=img:2 -n web",
    "kubectl annotate nodes.example.com n1 x=y -n web",
  ])(
    "`%s` changes no node and is let through with the switch off",
    (command: string) => {
      expect(
        refusalOf(writeOf(command), {
          writeNamespaces: [],
          podNamespace: null,
          allowNodeOperations: false,
        }),
      ).toBeNull();
    },
  );

  test.each(["kubectl get nodes", "kubectl describe node n1"])(
    "the read `%s` is never refused, switch off and scope set",
    (command: string) => {
      const policy: KubectlPolicyResult =
        KubectlPolicy.evaluateCommand(command);

      expect(policy.tier).toBe(KubectlCommandTier.Read);
      expect(
        refusalOf(policy, {
          writeNamespaces: ["web"],
          allowNodeOperations: false,
        }),
      ).toBeNull();
    },
  );
});

describe("the command may be the policy's verdict or the argv itself", () => {
  test.each([
    "kubectl rollout restart deployment/web -n web",
    "kubectl rollout restart deployment/pay -n payments",
    "kubectl rollout restart deployment/web",
    "kubectl cordon n1",
    "kubectl label namespace staging team=a -n web",
    `kubectl patch pv pv-1 -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}' -n web`,
    "kubectl rollout restart deployment/web --selector -n web",
  ])("`%s` gets the same answer either way", (command: string) => {
    for (const allowNodeOperations of [true, false]) {
      const scope: Partial<Omit<KubectlWriteScopeInput, "command">> = {
        writeNamespaces: ["web", "api"],
        allowNodeOperations,
      };

      expect(refusalOf(argsOf(command), scope)).toEqual(
        refusalOf(KubectlPolicy.evaluateCommand(command), scope),
      );
    }
  });

  test("an argv is tiered by the shared policy: a read is never refused", () => {
    expect(
      refusalOf(["get", "pods", "-n", POD_NAMESPACE], {
        writeNamespaces: ["web"],
        allowNodeOperations: false,
      }),
    ).toBeNull();
  });

  // Negative control: the same argv judged as a write is refused.
  test("the same argv passed as a write is refused", () => {
    expect(
      refusalOf(riskyWriteOf(`kubectl get pods -n ${POD_NAMESPACE}`, "get"), {
        writeNamespaces: ["web"],
      })?.code,
    ).toBe("own_namespace");
  });
});

describe("where a write with no -n lands", () => {
  const NO_NAMESPACE: string = "kubectl rollout restart deployment/web";

  test("in-cluster: the Runner pod's own namespace", () => {
    const refusal: KubectlWriteScopeRefusal | null = refusalOf(
      writeOf(NO_NAMESPACE),
    );

    expect(refusal?.code).toBe("own_namespace");
    expect(refusal?.namespace).toBe(POD_NAMESPACE);
    expect(refusal?.namespaceSource).toBe("default_namespace");
    expect(refusal?.fix).toBe("Name the target namespace with -n <namespace>.");
  });

  test("in-cluster with the pod's namespace unknown: no namespace this Runner could check", () => {
    const refusal: KubectlWriteScopeRefusal | null = refusalOf(
      writeOf(NO_NAMESPACE),
      { writeNamespaces: ["web"], podNamespace: null },
    );

    expect(refusal?.code).toBe("no_namespace");
    expect(refusal?.fix).toBe("Name the namespace with -n <namespace>.");
  });

  test('through a credential: "default", whatever the pod namespace says', () => {
    const outside: KubectlWriteScopeRefusal | null = refusalOf(
      writeOf(NO_NAMESPACE),
      { writeNamespaces: ["web"], podNamespace: null, usesCredential: true },
    );

    expect(outside?.code).toBe("outside_scope");
    expect(outside?.namespace).toBe("default");
    expect(outside?.namespaceSource).toBe("default_namespace");

    // "default" is not the pod's namespace, so no list means no refusal.
    expect(
      refusalOf(writeOf(NO_NAMESPACE), {
        writeNamespaces: [],
        podNamespace: POD_NAMESPACE,
        usesCredential: true,
      }),
    ).toBeNull();
  });

  // Negative control: "default" listed.
  test('through a credential, a listed "default" lets it through', () => {
    expect(
      refusalOf(writeOf(NO_NAMESPACE), {
        writeNamespaces: ["default"],
        podNamespace: null,
        usesCredential: true,
      }),
    ).toBeNull();
  });
});

describe("the scope is compared the way the Runner's configuration reads it", () => {
  test("case, spaces and blank entries do not matter", () => {
    const scope: Partial<Omit<KubectlWriteScopeInput, "command">> = {
      writeNamespaces: [" WEB ", "", "  "],
      podNamespace: " OneUptime-Agent ",
    };

    expect(
      refusalOf(
        writeOf("kubectl rollout restart deployment/web -n web"),
        scope,
      ),
    ).toBeNull();

    const own: KubectlWriteScopeRefusal | null = refusalOf(
      writeOf(`kubectl rollout restart deployment/x -n ${POD_NAMESPACE}`),
      scope,
    );

    expect(own?.code).toBe("own_namespace");
    expect(own?.writeNamespaces).toEqual(["web"]);
    expect(own?.podNamespace).toBe(POD_NAMESPACE);
  });

  test("a list of blanks is no list", () => {
    expect(
      refusalOf(writeOf("kubectl rollout restart deployment/pay -n payments"), {
        writeNamespaces: ["", " "],
        podNamespace: null,
      }),
    ).toBeNull();
  });
});

interface FactsCase {
  label: string;
  command: KubectlWriteScopeCommand;
  scope: Partial<Omit<KubectlWriteScopeInput, "command">>;
  code: KubectlWriteScopeRefusalCode;
  namespace?: string;
  namespaceSource?: KubectlWriteScopeNamespaceSource;
  clusterScopedKinds?: Array<string>;
  fix: string;
}

/*
 * Every code, with the facts each caller words its message from. Built
 * lazily: the policy verdicts are taken inside the test.
 */
function factsCases(): Array<FactsCase> {
  const scoped: Partial<Omit<KubectlWriteScopeInput, "command">> = {
    writeNamespaces: ["web", "api"],
  };

  return [
    {
      label: "a node operation, switch off",
      command: writeOf("kubectl cordon n1"),
      scope: { allowNodeOperations: false },
      code: "node_operations",
      fix: "",
    },
    {
      label: "objects that cannot be read",
      command: writeOf("kubectl label node/n1 pod-1 x=y -n web"),
      scope: scoped,
      code: "objects_uncertain",
      fix: 'Name the objects right after the verb (TYPE NAME or TYPE/NAME) and give each flag its value with "=" (--selector=app=web).',
    },
    {
      label: "a namespace that cannot be read",
      command: writeOf("kubectl rollout restart deployment/web -l -nweb"),
      scope: scoped,
      code: "namespace_uncertain",
      fix: "Put the namespace first so it cannot be misread: kubectl -n <namespace> ...",
    },
    {
      label: "a verb the policy read differently",
      command: riskyWriteOf("kubectl label pod web-1 x=y -n web", "annotate"),
      scope: scoped,
      code: "verb_mismatch",
      fix: "",
    },
    {
      label: "Namespace objects it does not name",
      command: writeOf("kubectl label ns -l env=prod team=a"),
      scope: scoped,
      code: "unnamed_namespace_objects",
      fix: "Name each Namespace object.",
    },
    {
      label: "a cluster-scoped kind",
      command: writeOf("kubectl annotate ingressclass nginx note=x -n web"),
      scope: scoped,
      code: "cluster_scoped",
      clusterScopedKinds: ["ingressclass"],
      fix: "",
    },
    {
      label: "every namespace",
      command: riskyWriteOf("kubectl label pods --all -A tier=x", "label"),
      scope: scoped,
      code: "all_namespaces",
      fix: "Name one namespace with -n <namespace>.",
    },
    {
      label: "an explicitly blank namespace",
      command: riskyWriteOf(
        "kubectl rollout restart deployment/web -n=",
        "rollout restart",
      ),
      scope: scoped,
      code: "no_namespace",
      fix: "Name the namespace with -n <namespace>.",
    },
    {
      label: "the Runner's own Namespace object",
      command: writeOf(`kubectl label ns ${POD_NAMESPACE} team=a -n web`),
      scope: scoped,
      code: "own_namespace",
      namespace: POD_NAMESPACE,
      namespaceSource: "namespace_object",
      fix: "",
    },
    {
      label: "the Runner's own namespace, named",
      command: writeOf(
        `kubectl rollout restart deployment/x -n ${POD_NAMESPACE}`,
      ),
      scope: scoped,
      code: "own_namespace",
      namespace: POD_NAMESPACE,
      namespaceSource: "namespace_flag",
      fix: "",
    },
    {
      label: "an unlisted Namespace object",
      command: writeOf("kubectl label namespace staging team=a -n web"),
      scope: scoped,
      code: "outside_scope",
      namespace: "staging",
      namespaceSource: "namespace_object",
      fix: "",
    },
    {
      label: "an unlisted namespace, named",
      command: writeOf("kubectl rollout restart deployment/pay -n payments"),
      scope: scoped,
      code: "outside_scope",
      namespace: "payments",
      namespaceSource: "namespace_flag",
      fix: "",
    },
    {
      label: "an unlisted default namespace",
      command: writeOf("kubectl rollout restart deployment/web"),
      scope: { ...scoped, podNamespace: null, usesCredential: true },
      code: "outside_scope",
      namespace: "default",
      namespaceSource: "default_namespace",
      fix: "Name the target namespace with -n <namespace>.",
    },
  ];
}

describe("the facts behind every refusal", () => {
  test("each case yields its code and facts", () => {
    for (const entry of factsCases()) {
      const refusal: KubectlWriteScopeRefusal | null = refusalOf(
        entry.command,
        entry.scope,
      );

      expect({ label: entry.label, code: refusal?.code }).toEqual({
        label: entry.label,
        code: entry.code,
      });
      expect({ label: entry.label, fix: refusal?.fix }).toEqual({
        label: entry.label,
        fix: entry.fix,
      });
      expect(refusal?.displayCommand).toBe(entry.command.displayCommand);
      expect(refusal?.namespace).toBe(entry.namespace ?? null);
      expect(refusal?.namespaceSource).toBe(entry.namespaceSource ?? null);
      expect(refusal?.clusterScopedKinds).toEqual(
        entry.clusterScopedKinds ?? [],
      );
      // The Runner's own wording: one or more whole sentences.
      expect(refusal?.reason.length).toBeGreaterThan(0);
      expect(refusal?.reason.endsWith(".")).toBe(true);
    }
  });

  /*
   * Every code is reachable, so a caller that words each one is tested
   * against each one (the Record makes adding a code fail here first).
   */
  test("the cases cover every refusal code", () => {
    const everyCode: Record<KubectlWriteScopeRefusalCode, true> = {
      node_operations: true,
      objects_uncertain: true,
      namespace_uncertain: true,
      verb_mismatch: true,
      unnamed_namespace_objects: true,
      cluster_scoped: true,
      all_namespaces: true,
      no_namespace: true,
      own_namespace: true,
      outside_scope: true,
    };

    const covered: Set<string> = new Set<string>(
      factsCases().map((entry: FactsCase) => {
        return entry.code;
      }),
    );

    expect(Array.from(covered).sort()).toEqual(Object.keys(everyCode).sort());
  });

  test("the verb cross-check reports both readings", () => {
    const refusal: KubectlWriteScopeRefusal | null = refusalOf(
      riskyWriteOf("kubectl label pod web-1 x=y -n web", "annotate"),
      { writeNamespaces: ["web"] },
    );

    expect(refusal?.readVerb).toBe("label");
    expect(refusal?.policyVerb).toBe("annotate");
  });

  // Negative control: the same argv with the verb the policy read.
  test("the same argv with the policy's own verb is let through", () => {
    expect(
      refusalOf(riskyWriteOf("kubectl label pod web-1 x=y -n web", "label"), {
        writeNamespaces: ["web"],
      }),
    ).toBeNull();
  });
});
