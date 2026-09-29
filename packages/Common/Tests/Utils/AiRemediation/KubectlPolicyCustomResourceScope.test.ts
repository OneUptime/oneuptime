import KubectlPolicy, {
  KubectlAutoExecutionVerdict,
  KubectlPolicyResult,
  KubectlTokenizeResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — which namespace a write lands in, for the
 * protected-namespace rule, and writes to Namespace objects:
 *  1. The built-in cluster-scoped kinds (nodes, Namespace objects,
 *     PersistentVolumes, StorageClasses, ...) are written outside any
 *     namespace, so -n kube-system does not make a write to one a
 *     kube-system write. They count only in their own API group, the way
 *     kubectl resolves a group-qualified spelling (RESOURCE.GROUP and
 *     RESOURCE.VERSION.GROUP; "nodes." and "nodes.v1." are the core group).
 *  2. A custom resource that borrows a built-in name — `nodes.example.com`,
 *     `namespaces.example.com`, `storageclasses.example.io` — has a scope
 *     the policy cannot see, so it is judged by the namespace -n names: with
 *     -n kube-system (or kube-public, kube-node-lease) it carries
 *     protectedNamespace, and
 *     evaluateForAutoExecution never runs it without a human: not under
 *     Bypass approval, not through any allowlist entry. Before, the kind was
 *     folded into the built-in one, the write read as cluster-scoped, and
 *     Bypass approval or a matching entry ran it in kube-system.
 *  3. A write to Namespace objects that does not name each one — a selector
 *     (-l, --selector, --field-selector), --all or a bare kind — is Denied:
 *     it can change kube-system's Namespace object without naming it, where
 *     the protected-namespace rule (which reads the names) cannot see it.
 *     Only the built-in Namespace kind counts; a custom `namespaces.example.com`
 *     with a selector is judged by its -n like any namespaced object.
 * Negative controls pin that nothing else moved: built-in cluster-scoped
 * writes with -n kube-system stay unprotected, custom resources outside the
 * protected namespaces stay plain RiskyWrite (Bypass still runs them), named
 * Namespace-object writes stay RiskyWrite, and reads stay Read.
 */

function autoVerdict(
  command: string,
  options: { allowlistPatterns?: Array<string>; bypassApproval?: boolean } = {},
): KubectlAutoExecutionVerdict {
  return KubectlPolicy.evaluateForAutoExecution({
    command,
    allowlistPatterns: options.allowlistPatterns || [],
    bypassApproval: options.bypassApproval,
  });
}

/*
 * Every setting an operator could use to let a riskier change run on its
 * own: Bypass approval, the command itself as an entry, the broadest valid
 * entries of its shape, and all of them at once.
 */
function unattendedSettings(
  command: string,
  entries: Array<string>,
): Array<{ allowlistPatterns?: Array<string>; bypassApproval?: boolean }> {
  return [
    {},
    { bypassApproval: true },
    { allowlistPatterns: [command] },
    { allowlistPatterns: entries },
    { allowlistPatterns: [command, ...entries], bypassApproval: true },
  ];
}

// ---- 1 and 2: custom resources that borrow a built-in cluster-scoped name ----------

/*
 * Group-qualified spellings kubectl reads as some custom resource: a group
 * that is not the built-in kind's own. `nodes.v1` has one dot, so kubectl
 * reads "v1" as a GROUP, which is no built-in group either.
 */
const CUSTOM_KINDS_BORROWING_A_NAME: Array<string> = [
  "nodes.example.com",
  "node.example.com",
  "no.example.com",
  "Nodes.Example.COM",
  "nodes.v1.example.com",
  "nodes.v1",
  "nodes.k8s.io",
  "namespaces.example.com",
  "namespace.example.com",
  "ns.example.com",
  "namespaces.v1alpha1.example.com",
  "persistentvolumes.example.com",
  "pv.example.com",
  "storageclasses.example.io",
  "storageclasses.k8s.io",
  "priorityclasses.example.com",
  "ingressclasses.example.com",
  "runtimeclasses.example.com",
  "csidrivers.example.com",
  "volumeattachments.example.com",
  "flowschemas.example.com",
  "certificatesigningrequests.example.com",
  // Namespaced built-in names were never exempt; they stay protected.
  "pods.example.com",
  "deployments.example.com",
];

// The writes an operator's Bypass approval or allowlist could have run.
function writesOn(kind: string, namespaceFlag: string): Array<string> {
  return [
    `kubectl annotate ${kind} x1 note=y ${namespaceFlag}`,
    `kubectl label ${kind} x1 team=a ${namespaceFlag}`,
    `kubectl annotate ${kind}/x1 note=y ${namespaceFlag}`,
    `kubectl patch ${kind} x1 --type=merge -p '{"spec":{"paused":true}}' ${namespaceFlag}`,
  ];
}

const PROTECTED_NAMESPACE_FLAGS: Array<[string, string]> = [
  ["-n kube-system", "kube-system"],
  ["--namespace=kube-system", "kube-system"],
  ["-nkube-public", "kube-public"],
  ["-n kube-node-lease", "kube-node-lease"],
];

const CUSTOM_RESOURCE_WRITES_IN_PROTECTED_NAMESPACES: Array<[string, string]> =
  CUSTOM_KINDS_BORROWING_A_NAME.flatMap((kind: string) => {
    return PROTECTED_NAMESPACE_FLAGS.flatMap(
      ([flag, namespace]: [string, string]) => {
        return writesOn(kind, flag).map((command: string): [string, string] => {
          return [command, namespace];
        });
      },
    );
  });

// The -n written first, where only global flags may go.
const LEADING_NAMESPACE_WRITES: Array<string> = [
  "kubectl -n kube-system annotate nodes.example.com x1 note=y",
  "kubectl --namespace kube-system label namespaces.example.com x1 team=a",
];

// Wildcard entries of every write shape above (all valid).
const BROAD_ENTRIES: Array<string> = [
  "kubectl annotate * * * -n *",
  "kubectl label * * * -n *",
  "kubectl annotate * * -n *",
  "kubectl patch * * --type=merge -p * -n *",
];

// ---- Negative controls: the built-in cluster-scoped kinds, in their own group -----

/*
 * [plural, API group] of every built-in cluster-scoped kind that a write
 * verb may touch (RBAC and admission kinds are Denied in every write, so
 * they are pinned in KubectlPolicyDenials.test.ts, not here).
 */
const BUILTIN_CLUSTER_SCOPED: Array<[string, string]> = [
  ["nodes", ""],
  ["namespaces", ""],
  ["persistentvolumes", ""],
  ["storageclasses", "storage.k8s.io"],
  ["csidrivers", "storage.k8s.io"],
  ["csinodes", "storage.k8s.io"],
  ["volumeattachments", "storage.k8s.io"],
  ["priorityclasses", "scheduling.k8s.io"],
  ["certificatesigningrequests", "certificates.k8s.io"],
  ["ingressclasses", "networking.k8s.io"],
  ["runtimeclasses", "node.k8s.io"],
  ["flowschemas", "flowcontrol.apiserver.k8s.io"],
  ["prioritylevelconfigurations", "flowcontrol.apiserver.k8s.io"],
];

// Every spelling kubectl resolves to the built-in kind.
const BUILTIN_CLUSTER_SCOPED_SPELLINGS: Array<string> =
  BUILTIN_CLUSTER_SCOPED.flatMap(([plural, group]: [string, string]) => {
    return [
      plural,
      // RESOURCE.GROUP: "nodes." for the core group.
      `${plural}.${group}`,
      // RESOURCE.VERSION.GROUP: "nodes.v1." for the core group.
      `${plural}.v1.${group}`,
      plural.toUpperCase(),
    ];
  });

const BUILTIN_SHORT_AND_SINGULAR_SPELLINGS: Array<string> = [
  "no",
  "node",
  "Node",
  "ns",
  "namespace",
  "Namespace",
  "pv",
  "persistentvolume",
  "sc",
  "storageclass",
  "pc",
  "priorityclass",
  "csr",
  "ingressclass",
  "runtimeclass",
  "csidriver",
  "csinode",
  "volumeattachment",
  "flowschema",
  "prioritylevelconfiguration",
  "StorageClass.storage.k8s.io",
  "IngressClass.v1.networking.k8s.io",
];

// ---- 3. Namespace objects written without naming them ------------------------------

const UNNAMED_NAMESPACE_WRITES: Array<string> = [
  "kubectl label ns --all team=a",
  "kubectl label namespaces --all team=a",
  "kubectl label namespace -l env=prod team=a",
  "kubectl label ns --selector=env=prod team=a",
  "kubectl label ns -l 'kubernetes.io/metadata.name in (kube-system)' team=a",
  "kubectl annotate ns --field-selector metadata.name=kube-system note=x",
  "kubectl annotate ns --field-selector=metadata.name!=web note=x",
  "kubectl annotate ns --all --overwrite note=x",
  "kubectl annotate namespaces.v1. --all note=x",
  "kubectl label namespaces. -l a=b c=d",
  "kubectl label Namespace -l a=b c=d",
  "kubectl label NS --all team=a",
  "kubectl label ns --all=true team=a",
  // With -n, which kubectl ignores for a Namespace object.
  "kubectl label ns --all team=a -n web",
  "kubectl -n kube-system label ns --all team=a",
  // Among other kinds.
  "kubectl label pods,ns -l a=b c=d -n web",
  "kubectl label ns,pods -l a=b c=d -n web",
  // A bare kind names no object at all.
  "kubectl label ns team=a",
  "kubectl annotate namespaces note=x",
  // Other write verbs.
  `kubectl patch ns -l env=prod -p '{"metadata":{"labels":{"a":"b"}}}'`,
  "kubectl rollout restart ns --all",
  "kubectl scale ns --all --replicas=1",
  "kubectl set env ns --all A=b",
];

// Named Namespace-object writes, reads and custom kinds are left as they were.
const NAMED_NAMESPACE_WRITES: Array<string> = [
  "kubectl label ns web team=a",
  "kubectl label ns web api team=a",
  "kubectl label ns/web ns/api team=a",
  "kubectl annotate namespace/web note=x --overwrite",
  "kubectl label namespaces.v1. web team=a",
  "kubectl label ns web team=a -n kube-system",
];

const NAMESPACE_READS: Array<string> = [
  "kubectl get ns -l env=prod",
  "kubectl get namespaces --field-selector=metadata.name=kube-system",
  "kubectl describe ns",
  "kubectl get ns -o name",
];

describe("KubectlPolicy: which namespace a write lands in", () => {
  describe("a custom resource that borrows a built-in cluster-scoped name is judged by its -n", () => {
    it.each(CUSTOM_RESOURCE_WRITES_IN_PROTECTED_NAMESPACES)(
      "%s is a write in %s",
      (command: string, namespace: string) => {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.tier).toBe(KubectlCommandTier.RiskyWrite);
        expect(result.protectedNamespace).toBe(namespace);
        expect(result.reason).toContain(`protected namespace ${namespace}`);
      },
    );

    it.each(CUSTOM_RESOURCE_WRITES_IN_PROTECTED_NAMESPACES)(
      "never runs %s unattended (%s): not under Bypass approval, not through any entry",
      (command: string, namespace: string) => {
        for (const entry of BROAD_ENTRIES) {
          expect(
            KubectlPolicy.describeAllowlistPatternProblem(entry),
          ).toBeNull();
        }

        for (const options of unattendedSettings(command, BROAD_ENTRIES)) {
          const verdict: KubectlAutoExecutionVerdict = autoVerdict(
            command,
            options,
          );
          expect({ options, verdict: verdict.verdict }).toEqual({
            options,
            verdict: AiRemediationCommandPolicyVerdict.RequiresApproval,
          });
          expect(verdict.requiresHuman).toBe(true);
          expect(verdict.reason).toContain(namespace);
        }
      },
    );

    it.each(LEADING_NAMESPACE_WRITES)(
      "reads a -n written before the verb too: %s",
      (command: string) => {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.protectedNamespace).toBe("kube-system");
        expect(autoVerdict(command, { bypassApproval: true }).verdict).toBe(
          AiRemediationCommandPolicyVerdict.RequiresApproval,
        );
      },
    );

    it("names the reason the review found: the kind is not a Node, so -n counts", () => {
      const verdict: KubectlAutoExecutionVerdict = autoVerdict(
        "kubectl annotate nodes.example.com x1 note=y -n kube-system",
        { bypassApproval: true },
      );
      expect(verdict.reason).toContain(
        "Neither bypassing approvals nor the cluster's allowlist applies in kube-system",
      );
    });

    it.each(CUSTOM_KINDS_BORROWING_A_NAME)(
      "negative control: %s outside the protected namespaces is a plain riskier change",
      (kind: string) => {
        for (const command of [
          ...writesOn(kind, "-n web"),
          // No -n: the context's namespace, which is not a protected one here.
          ...writesOn(kind, ""),
        ]) {
          const result: KubectlPolicyResult =
            KubectlPolicy.evaluateCommand(command);
          expect({ command, tier: result.tier }).toEqual({
            command,
            tier: KubectlCommandTier.RiskyWrite,
          });
          expect(result.protectedNamespace).toBeUndefined();
          expect(autoVerdict(command, { bypassApproval: true }).verdict).toBe(
            AiRemediationCommandPolicyVerdict.AutoApproved,
          );
          expect(
            autoVerdict(command, { allowlistPatterns: [command] }).verdict,
          ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
        }
      },
    );
  });

  describe("negative control: the built-in cluster-scoped kinds ignore -n, in every spelling kubectl resolves", () => {
    it.each([
      ...BUILTIN_CLUSTER_SCOPED_SPELLINGS,
      ...BUILTIN_SHORT_AND_SINGULAR_SPELLINGS,
    ])(
      "annotate %s x1 note=y -n kube-system is not a kube-system write",
      (spelling: string) => {
        const command: string = `kubectl annotate ${spelling} x1 note=y -n kube-system`;
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.tier).toBe(KubectlCommandTier.RiskyWrite);
        expect(result.protectedNamespace).toBeUndefined();
        expect(autoVerdict(command, { bypassApproval: true }).verdict).toBe(
          AiRemediationCommandPolicyVerdict.AutoApproved,
        );
      },
    );

    it.each(
      BUILTIN_CLUSTER_SCOPED.filter(([, group]: [string, string]) => {
        return group !== "";
      }),
    )(
      "%s counts only in its own group %s: another group is a custom resource",
      (plural: string, group: string) => {
        const lastLabel: string = group.split(".").slice(1).join(".");

        for (const spelling of [
          // A group that only ends like the real one.
          `${plural}.x${group}`,
          // The version reading needs a version between.
          `${plural}.${lastLabel}`,
          `${plural}.v1.example.com`,
        ]) {
          expect({
            spelling,
            protectedNamespace: KubectlPolicy.evaluateCommand(
              `kubectl annotate ${spelling} x1 note=y -n kube-system`,
            ).protectedNamespace,
          }).toEqual({ spelling, protectedNamespace: "kube-system" });
        }
      },
    );

    it("keeps the node verbs outside every namespace, unless they name something that is not a node", () => {
      for (const command of [
        "kubectl cordon node-1 -n kube-system",
        "kubectl cordon node/node-1 -n kube-system",
        "kubectl uncordon nodes.v1./node-1 --namespace=kube-system",
        "kubectl cordon Nodes/node-1 -n kube-system",
      ]) {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect({ command, tier: result.tier }).toEqual({
          command,
          tier: KubectlCommandTier.SafeWrite,
        });
        expect(result.protectedNamespace).toBeUndefined();
      }

      for (const command of [
        "kubectl cordon nodes.example.com/node-1 -n kube-system",
        "kubectl uncordon node-1 nodes.example.com/x -n kube-system",
      ]) {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.tier).toBe(KubectlCommandTier.RiskyWrite);
        expect(result.protectedNamespace).toBe("kube-system");
        expect(autoVerdict(command, { bypassApproval: true }).verdict).toBe(
          AiRemediationCommandPolicyVerdict.RequiresApproval,
        );
      }
    });

    it("keeps a drain or taint of real nodes out of kube-system, and a custom kind in it (both always need a human)", () => {
      for (const command of [
        "kubectl drain node-1 --ignore-daemonsets -n kube-system",
        "kubectl taint nodes node-1 k=v:NoSchedule -n kube-system",
        "kubectl taint nodes.v1. node-1 k=v:NoSchedule -n kube-system",
        "kubectl taint node/node-1 k- -n kube-system",
      ]) {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.requiresHuman).toBe(true);
        expect(result.protectedNamespace).toBeUndefined();
      }

      for (const command of [
        "kubectl taint nodes.example.com node-1 k=v:NoSchedule -n kube-system",
        "kubectl drain nodes.example.com/node-1 -n kube-system",
      ]) {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.requiresHuman).toBe(true);
        expect(result.protectedNamespace).toBe("kube-system");
      }
    });

    it("still protects a Namespace object named after a protected namespace, whatever its spelling", () => {
      for (const command of [
        "kubectl label ns kube-system team=a -n web",
        "kubectl label namespaces.v1. kube-public team=a",
        "kubectl annotate namespace/kube-node-lease note=x",
        // The folded reading can only add a human: a custom kind NAMED kube-system too.
        "kubectl label namespaces.example.com kube-system team=a -n web",
      ]) {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.tier).toBe(KubectlCommandTier.RiskyWrite);
        expect(result.protectedNamespace).toBeDefined();
        expect(autoVerdict(command, { bypassApproval: true }).verdict).toBe(
          AiRemediationCommandPolicyVerdict.RequiresApproval,
        );
      }
    });
  });

  describe("a write to Namespace objects must name each one", () => {
    it.each(UNNAMED_NAMESPACE_WRITES)("denies %s", (command: string) => {
      const result: KubectlPolicyResult =
        KubectlPolicy.evaluateCommand(command);
      expect(result.tier).toBe(KubectlCommandTier.Denied);
      expect(result.reason).toContain("name each Namespace object");
      expect(result.reason).toContain("kube-system");

      for (const options of unattendedSettings(command, [])) {
        expect(autoVerdict(command, options).verdict).toBe(
          AiRemediationCommandPolicyVerdict.Denied,
        );
      }
    });

    it("says which shape reached the unnamed objects", () => {
      expect(
        KubectlPolicy.evaluateCommand("kubectl label ns --all team=a").reason,
      ).toContain("by a selector or --all");
      expect(
        KubectlPolicy.evaluateCommand("kubectl label ns team=a").reason,
      ).toContain("without naming any");
    });

    it("keeps the more specific refusals where they apply", () => {
      expect(
        KubectlPolicy.evaluateCommand(
          "kubectl label ns --all pod-security.kubernetes.io/enforce=privileged",
        ).reason,
      ).toContain("Pod Security Admission");
      expect(
        KubectlPolicy.evaluateCommand("kubectl delete ns -l env=prod").reason,
      ).toContain("deleting namespace objects is never allowed");
      expect(
        KubectlPolicy.evaluateCommand("kubectl label ns -A --all team=a")
          .reason,
      ).toContain("across all namespaces");
    });

    it.each(NAMED_NAMESPACE_WRITES)(
      "negative control: %s names its Namespace objects and stays RiskyWrite",
      (command: string) => {
        expect(KubectlPolicy.evaluateCommand(command).tier).toBe(
          KubectlCommandTier.RiskyWrite,
        );
      },
    );

    it.each(NAMESPACE_READS)(
      "negative control: %s only reads",
      (command: string) => {
        expect(KubectlPolicy.evaluateCommand(command).tier).toBe(
          KubectlCommandTier.Read,
        );
      },
    );

    it("negative control: a custom kind that borrows the name, by selector, is judged by its -n", () => {
      const outside: string =
        "kubectl label namespaces.example.com --all team=a -n web";
      expect(KubectlPolicy.evaluateCommand(outside).tier).toBe(
        KubectlCommandTier.RiskyWrite,
      );
      expect(autoVerdict(outside, { bypassApproval: true }).verdict).toBe(
        AiRemediationCommandPolicyVerdict.AutoApproved,
      );

      const inside: string =
        "kubectl label namespaces.example.com -l a=b team=a -n kube-system";
      const result: KubectlPolicyResult = KubectlPolicy.evaluateCommand(inside);
      expect(result.tier).toBe(KubectlCommandTier.RiskyWrite);
      expect(result.protectedNamespace).toBe("kube-system");
      expect(autoVerdict(inside, { bypassApproval: true }).verdict).toBe(
        AiRemediationCommandPolicyVerdict.RequiresApproval,
      );
    });

    it("negative control: selectors on other kinds are untouched", () => {
      for (const command of [
        "kubectl label pods -l app=web team=a -n web",
        "kubectl annotate deployments --all note=x -n web",
        "kubectl label nodes -l pool=spare team=a",
      ]) {
        expect(KubectlPolicy.evaluateCommand(command).tier).toBe(
          KubectlCommandTier.RiskyWrite,
        );
      }
    });
  });

  describe("evaluateCommand and evaluateArgs agree on every table above", () => {
    const allCommands: Array<string> = [
      ...CUSTOM_RESOURCE_WRITES_IN_PROTECTED_NAMESPACES.map(
        ([command]: [string, string]) => {
          return command;
        },
      ),
      ...LEADING_NAMESPACE_WRITES,
      ...UNNAMED_NAMESPACE_WRITES,
      ...NAMED_NAMESPACE_WRITES,
      ...NAMESPACE_READS,
    ];

    it.each(allCommands)(
      "returns the same verdict for %s",
      (command: string) => {
        const tokenized: KubectlTokenizeResult =
          KubectlPolicy.tokenize(command);
        expect(tokenized.args).toBeDefined();
        expect(KubectlPolicy.evaluateArgs(tokenized.args!)).toEqual(
          KubectlPolicy.evaluateCommand(command),
        );
      },
    );
  });
});
