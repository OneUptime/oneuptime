import KubectlPolicy, {
  KubectlAutoExecutionVerdict,
  KubectlPolicyResult,
  KubectlTokenizeResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — a patch of a Node always needs a human, exactly like
 * `kubectl taint` and `kubectl drain` (the every-mode promise in
 * KubernetesClusterAiAccess: "a node drain and a node taint always need a
 * human", Bypass approval included):
 *  1. A taint is nothing but the Node's spec.taints, and `kubectl patch`
 *     writes it in every patch type (checked with the pinned kubectl
 *     v1.36.4 and `patch --local`: a strategic-merge list REPLACES every
 *     taint the node had, a merge-patch null clears them, a JSON-patch add
 *     appends one). So EVERY `kubectl patch` of the built-in Node is
 *     RiskyWrite with requiresHuman, whatever its body says — the rule reads
 *     the kind, not the body — and evaluateForAutoExecution never runs one
 *     unattended: not in Bypass approval, not through an exact allowlist
 *     entry, not through `kubectl patch node * -p *`.
 *  2. Every spelling kubectl resolves to the built-in Node counts: node,
 *     nodes, no, Node, NODES, nodes., nodes.v1., TYPE/NAME, several names, a
 *     comma list with another kind, a list of TYPE/NAME objects, the status
 *     subresource, and a Node after another object whose name holds an
 *     `=` (`patch pod/a=b node/n1` — kubectl reads every word of a patch as
 *     an object and goes on after the first one fails; checked against a
 *     fake API server with the pinned kubectl, which PATCHed the Node).
 *  3. An allowlist entry that names a Node patch is valid, still matches
 *     word for word, pre-approves nothing and is never broad — like a taint
 *     or drain entry.
 *  4. Negative controls: cordon and uncordon stay SafeWrite and run
 *     unattended; `label node` / `annotate node` stay RiskyWrite WITHOUT
 *     requiresHuman, so Bypass approval and a matching entry still run
 *     them; a custom resource that borrows the name (`nodes.example.com`) is
 *     not a Node and stays an ordinary RiskyWrite; a workload patch still
 *     runs under Bypass approval and its entry; taint and drain keep their
 *     own reasons; a node patch whose body is not JSON stays Denied.
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

function argsOf(command: string): Array<string> {
  const tokenized: KubectlTokenizeResult = KubectlPolicy.tokenize(command);
  return tokenized.args || [];
}

const TAINT_NO_EXECUTE: string =
  '\'{"spec":{"taints":[{"key":"k","effect":"NoExecute"}]}}\'';

/*
 * Bodies that change a Node's taints in each patch type, and bodies that do
 * not: the rule reads the kind, so every one of them needs a human.
 */
const NODE_PATCH_BODIES: Array<string> = [
  `-p ${TAINT_NO_EXECUTE}`,
  `--type=strategic -p ${TAINT_NO_EXECUTE}`,
  `--type=merge -p ${TAINT_NO_EXECUTE}`,
  `--type merge -p '{"spec":{"taints":null}}'`,
  `-p '{"spec":{"taints":[]}}'`,
  `--type=json -p '[{"op":"add","path":"/spec/taints","value":[{"key":"k","effect":"NoExecute"}]}]'`,
  `--type=json -p '[{"op":"add","path":"/spec/taints/-","value":{"key":"k","effect":"NoExecute"}}]'`,
  `--type=json -p '[{"op":"remove","path":"/spec/taints"}]'`,
  `--type=json -p '[{"op":"copy","from":"/metadata/labels","path":"/spec/taints"}]'`,
  // No taint in sight — still a Node patch, still a human.
  `-p '{"spec":{"unschedulable":true}}'`,
  `-p '{"metadata":{"labels":{"pool":"spare"}}}'`,
  `--patch '{"metadata":{"annotations":{"note":"x"}}}'`,
  `--patch='{"spec":{"podCIDR":"10.0.0.0/24"}}'`,
];

// Every spelling of the objects kubectl resolves to (or through) the built-in Node.
const NODE_PATCH_OBJECTS: Array<string> = [
  "node n1",
  "nodes n1",
  "no n1",
  "Node n1",
  "NODES n1",
  "nodes. n1",
  "nodes.v1. n1",
  "node/n1",
  "nodes/n1",
  "no/n1",
  "Node/n1",
  "nodes.v1./n1",
  "node n1 n2 n3",
  "node/n1 node/n2",
  "no,pod n1 -n web",
  "pod,node n1 -n web",
  "deployment/web node/n1 -n web",
  "pod/a=b node/n1 -n web",
  "pod/x- nodes/n1 -n web",
  "node n1 --subresource=status",
  "node n1 --field-manager=ai",
  "-n web node n1",
];

const NODE_PATCHES: Array<string> = NODE_PATCH_OBJECTS.flatMap(
  (objects: string) => {
    return NODE_PATCH_BODIES.map((body: string) => {
      return `kubectl patch ${objects} ${body}`;
    });
  },
);

/*
 * [command, entry] pairs: the entry is valid and matches the command word
 * for word, yet pre-approves nothing and is never broad.
 */
const NODE_PATCH_ENTRIES: Array<[string, string]> = [
  [`kubectl patch node n1 -p ${TAINT_NO_EXECUTE}`, "kubectl patch node * -p *"],
  [
    `kubectl patch node n1 -p ${TAINT_NO_EXECUTE}`,
    "kubectl patch node n1 -p *",
  ],
  [`kubectl patch node n1 -p ${TAINT_NO_EXECUTE}`, "patch node n1 -p *"],
  [
    `kubectl patch nodes worker-7 -p '{"spec":{"taints":null}}'`,
    "kubectl patch nodes worker-* -p *",
  ],
  [`kubectl patch no/n1 -p ${TAINT_NO_EXECUTE}`, "kubectl patch no/* -p *"],
  [
    `kubectl patch nodes.v1. n1 --type=json -p '[{"op":"add","path":"/spec/taints/-","value":{"key":"k","effect":"NoExecute"}}]'`,
    "kubectl patch nodes.v1. * --type=json -p *",
  ],
  [
    `kubectl patch node n1 n2 -p ${TAINT_NO_EXECUTE}`,
    "kubectl patch node * * -p *",
  ],
];

describe("KubectlPolicy: a patch of a Node always needs a human", () => {
  describe("every Node patch carries requiresHuman, whatever its body", () => {
    it.each(NODE_PATCHES)(
      "tiers %s RiskyWrite with requiresHuman",
      (command: string) => {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);

        expect(result.tier).toBe(KubectlCommandTier.RiskyWrite);
        expect(result.verb).toBe("patch");
        expect(result.requiresHuman).toBe(true);
        expect(result.reason).toContain("kubectl patch of a Node");
        expect(result.reason).toContain("taints");
        expect(result.reason).toContain("in every namespace");
        expect(result.reason).toContain("kube-system");
        // The same verdict from the argv the Runner gets.
        expect(KubectlPolicy.evaluateArgs(result.args)).toEqual(result);
      },
    );

    it.each(NODE_PATCHES)(
      "never runs %s unattended: not in Bypass approval, not through an allowlist entry",
      (command: string) => {
        for (const options of [
          {},
          { bypassApproval: true },
          { allowlistPatterns: [command] },
          { allowlistPatterns: ["kubectl patch node * -p *", "*"] },
          { allowlistPatterns: [command], bypassApproval: true },
        ]) {
          const verdict: KubectlAutoExecutionVerdict = autoVerdict(
            command,
            options,
          );

          expect(verdict.verdict).toBe(
            AiRemediationCommandPolicyVerdict.RequiresApproval,
          );
          expect(verdict.tier).toBe(KubectlCommandTier.RiskyWrite);
          expect(verdict.requiresHuman).toBe(true);
          expect(verdict.reason).toContain(
            "Neither bypassing approvals nor the cluster's allowlist applies to a node drain or taint, or to a patch of a Node",
          );
          expect(verdict.reason).not.toContain(
            "Matched the cluster's kubectl allowlist",
          );
        }
      },
    );
  });

  describe("an allowlist entry that names a Node patch pre-approves nothing", () => {
    it.each(NODE_PATCH_ENTRIES)(
      "%s matches %s word for word, is valid and not broad, and is never promoted",
      (command: string, entry: string) => {
        expect(KubectlPolicy.describeAllowlistPatternProblem(entry)).toBeNull();
        expect(
          KubectlPolicy.matchesAllowlist({
            args: argsOf(command),
            allowlistPatterns: [entry],
          }),
        ).toBe(true);
        expect(KubectlPolicy.isBroadAllowlistPattern(entry)).toBe(false);

        const verdict: KubectlAutoExecutionVerdict = autoVerdict(command, {
          allowlistPatterns: [entry],
        });
        expect(verdict.verdict).toBe(
          AiRemediationCommandPolicyVerdict.RequiresApproval,
        );
        expect(verdict.requiresHuman).toBe(true);
      },
    );

    it("negative control: the same shapes on a workload are broad and do promote", () => {
      expect(
        KubectlPolicy.isBroadAllowlistPattern(
          "kubectl patch deployment * -p *",
        ),
      ).toBe(true);
      expect(
        KubectlPolicy.isBroadAllowlistPattern(
          "kubectl patch deployment web -n web -p *",
        ),
      ).toBe(false);

      const command: string = `kubectl patch deployment web -n web -p '{"spec":{"replicas":2}}'`;
      expect(
        autoVerdict(command, {
          allowlistPatterns: ["kubectl patch deployment web -n web -p *"],
        }).verdict,
      ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    });

    it("a wildcard kind may stand for a Node, so it is broad, and the Node commands it matches still need a human", () => {
      const entry: string = "kubectl patch * n1 -p *";
      expect(KubectlPolicy.describeAllowlistPatternProblem(entry)).toBeNull();
      expect(KubectlPolicy.isBroadAllowlistPattern(entry)).toBe(true);

      const nodePatch: KubectlAutoExecutionVerdict = autoVerdict(
        `kubectl patch node n1 -p ${TAINT_NO_EXECUTE}`,
        { allowlistPatterns: [entry] },
      );
      expect(nodePatch.verdict).toBe(
        AiRemediationCommandPolicyVerdict.RequiresApproval,
      );
      expect(nodePatch.requiresHuman).toBe(true);

      // Negative control: the same entry promotes a workload it matches.
      expect(
        autoVerdict(
          `kubectl patch deployment n1 -p '{"spec":{"replicas":2}}'`,
          {
            allowlistPatterns: [entry],
          },
        ).verdict,
      ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    });
  });

  describe("a Node patch in a protected namespace says both reasons", () => {
    it("keeps the Node reason and adds the protected namespace", () => {
      const result: KubectlPolicyResult = KubectlPolicy.evaluateCommand(
        `kubectl patch deployment/coredns node/n1 -n kube-system -p '{"metadata":{"labels":{"a":"b"}}}'`,
      );

      expect(result.tier).toBe(KubectlCommandTier.RiskyWrite);
      expect(result.requiresHuman).toBe(true);
      expect(result.protectedNamespace).toBe("kube-system");
      expect(result.reason).toContain("kubectl patch of a Node");
      expect(result.reason).toContain(
        "it changes the protected namespace kube-system, which always needs a human",
      );
    });

    it("a Node alone is cluster-scoped: -n kube-system does not make it a kube-system write", () => {
      const result: KubectlPolicyResult = KubectlPolicy.evaluateCommand(
        `kubectl patch node n1 -n kube-system -p ${TAINT_NO_EXECUTE}`,
      );

      expect(result.requiresHuman).toBe(true);
      expect(result.protectedNamespace).toBeUndefined();
    });
  });

  describe("negative controls", () => {
    it.each([
      "kubectl cordon n1",
      "kubectl uncordon n1",
      "kubectl cordon node/n1",
      "kubectl uncordon nodes/n1",
    ])(
      "%s stays SafeWrite and runs unattended in Automatic mode",
      (command: string) => {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);

        expect(result.tier).toBe(KubectlCommandTier.SafeWrite);
        expect(result.requiresHuman).toBeUndefined();
        expect(autoVerdict(command).verdict).toBe(
          AiRemediationCommandPolicyVerdict.AutoApproved,
        );
        expect(autoVerdict(command, { bypassApproval: true }).verdict).toBe(
          AiRemediationCommandPolicyVerdict.AutoApproved,
        );
      },
    );

    it.each([
      "kubectl label node n1 pool=spare",
      "kubectl label nodes/n1 pool=spare --overwrite",
      "kubectl label no n1 pool-",
      "kubectl annotate node n1 note=x",
      "kubectl annotate nodes.v1. n1 note=x",
      // A custom resource that borrows the name is not a Node.
      `kubectl patch nodes.example.com n1 -n web -p ${TAINT_NO_EXECUTE}`,
      `kubectl patch nodes.v1.example.com/n1 -n web -p ${TAINT_NO_EXECUTE}`,
      `kubectl patch nodes.v1 n1 -n web -p ${TAINT_NO_EXECUTE}`,
      `kubectl patch nodepools.karpenter.sh default -p '{"spec":{"limits":{"cpu":"100"}}}'`,
      // A workload patch.
      `kubectl patch deployment web -n web -p '{"spec":{"replicas":2}}'`,
      `kubectl patch deployment/node -n web -p '{"spec":{"replicas":2}}'`,
    ])(
      "%s stays RiskyWrite without requiresHuman: Bypass approval and its entry still run it",
      (command: string) => {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);

        expect(result.tier).toBe(KubectlCommandTier.RiskyWrite);
        expect(result.requiresHuman).toBeUndefined();
        expect(result.reason).not.toContain("kubectl patch of a Node");

        const bypass: KubectlAutoExecutionVerdict = autoVerdict(command, {
          bypassApproval: true,
        });
        expect(bypass.verdict).toBe(
          AiRemediationCommandPolicyVerdict.AutoApproved,
        );
        expect(bypass.requiresHuman).toBeUndefined();

        const allowlisted: KubectlAutoExecutionVerdict = autoVerdict(command, {
          allowlistPatterns: [command],
        });
        expect(allowlisted.verdict).toBe(
          AiRemediationCommandPolicyVerdict.AutoApproved,
        );
        expect(allowlisted.reason).toBe(
          "Matched the cluster's kubectl allowlist.",
        );

        // Without Bypass or an entry it asks — but not as an always-human command.
        const asked: KubectlAutoExecutionVerdict = autoVerdict(command);
        expect(asked.verdict).toBe(
          AiRemediationCommandPolicyVerdict.RequiresApproval,
        );
        expect(asked.requiresHuman).toBeUndefined();
      },
    );

    it("an entry for a node label is not refused as a node patch: it is valid and it promotes", () => {
      const entry: string = "kubectl label node * pool=*";
      expect(KubectlPolicy.describeAllowlistPatternProblem(entry)).toBeNull();
      expect(KubectlPolicy.isBroadAllowlistPattern(entry)).toBe(true);
      expect(
        autoVerdict("kubectl label node n1 pool=spare", {
          allowlistPatterns: [entry],
        }).verdict,
      ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    });

    it("taint and drain keep their own reasons", () => {
      const taint: KubectlPolicyResult = KubectlPolicy.evaluateCommand(
        "kubectl taint nodes n1 k=v:NoExecute",
      );
      expect(taint.requiresHuman).toBe(true);
      expect(taint.reason).toContain("kubectl taint decides which pods");

      const drain: KubectlPolicyResult = KubectlPolicy.evaluateCommand(
        "kubectl drain n1 --ignore-daemonsets",
      );
      expect(drain.requiresHuman).toBe(true);
      expect(drain.reason).toContain("kubectl drain evicts every pod");
    });

    it.each([
      // Not JSON.
      "kubectl patch node n1 -p 'spec: {taints: []}'",
      // A forbidden field name, wherever it sits.
      'kubectl patch node n1 -p \'{"spec":{"template":{"spec":{"hostNetwork":true}}}}\'',
      // Replacing spec wholesale (the pod-spec replacement rule reads spec on any kind).
      `kubectl patch node n1 --type=json -p '[{"op":"replace","path":"/spec","value":{"taints":[]}}]'`,
      `kubectl patch node n1 -p '{"spec":{"$setElementOrder/taints":[{"key":"k"}],"taints":[]}}'`,
      // A credential flag.
      "kubectl patch node n1 -p '{}' --kubeconfig=/tmp/x",
    ])(
      "%s stays Denied: a Denied node patch is not merely asked about",
      (command: string) => {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.tier).toBe(KubectlCommandTier.Denied);
        expect(result.requiresHuman).toBeUndefined();
        expect(
          autoVerdict(command, {
            allowlistPatterns: [command],
            bypassApproval: true,
          }).verdict,
        ).toBe(AiRemediationCommandPolicyVerdict.Denied);
      },
    );

    it("a read of a Node is still Read and auto-approved", () => {
      for (const command of [
        "kubectl get node n1 -o yaml",
        "kubectl describe nodes n1",
      ]) {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);
        expect(result.tier).toBe(KubectlCommandTier.Read);
        expect(result.requiresHuman).toBeUndefined();
        expect(autoVerdict(command).verdict).toBe(
          AiRemediationCommandPolicyVerdict.AutoApproved,
        );
      }
    });
  });
});
