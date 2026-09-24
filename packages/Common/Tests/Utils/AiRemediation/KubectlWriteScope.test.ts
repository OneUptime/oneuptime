/*
 * ---------------------------------------------------------------------------
 * KubectlWriteScope: the Runner's own namespace bound on AI-composed kubectl
 * writes.
 *
 * The finding this pins: the kubernetes-agent chart bound its write RBAC
 * cluster-wide, and patch/update on a workload template (or create on a
 * job) is running any image as any ServiceAccount of that namespace. So
 * `set image deployment/ingress-nginx-controller -n ingress-nginx ...` or
 * `scale deployment coredns -n kube-system --replicas=0` ran wherever the
 * policy tiered them, and nothing on the Runner looked at the namespace.
 * Now every non-Read argv is refused before spawning when its namespace is
 * the Runner pod's own, or outside ONEUPTIME_KUBECTL_WRITE_NAMESPACES.
 *
 * Two halves: reading the namespace exactly the way kubectl does (every
 * spelling, and refusing what cannot be read for certain), and the verdict.
 *
 * The rule moved from the Runner into Common so the Runner, the server's
 * enqueue chokepoint and the remediation toolkit ask ONE function; these
 * cases moved with it unchanged (KubectlWriteScopeCallerParity holds the
 * three callers to it).
 * ---------------------------------------------------------------------------
 */

import KubectlWriteScope, {
  KubectlNamespaceResolution,
  KubectlWriteScopeRefusal,
} from "../../../Utils/AiRemediation/KubectlWriteScope";
import KubectlPolicy, {
  KubectlTokenizeResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { describe, expect, test } from "@jest/globals";

const POD_NAMESPACE: string = "oneuptime-agent";

function resolve(args: Array<string>): KubectlNamespaceResolution {
  return KubectlWriteScope.resolveNamespaces(args);
}

/*
 * The verdict for a command, tokenized the way the server tokenizes it.
 * The tier is passed in rather than taken from the shared policy: this
 * layer only distinguishes Read from everything else, and its verdict must
 * not depend on how the policy happens to tier a namespace today. The node
 * switch is on: these cases are about the namespace scope.
 *
 * `usesCredential` picks what a missing -n means: "default" through a
 * credential's kubeconfig, the pod's own namespace (unknown when
 * podNamespace is null) in-cluster.
 */
function verdict(
  command: string,
  scope: {
    writeNamespaces?: Array<string>;
    podNamespace?: string | null;
    usesCredential?: boolean;
    tier?: KubectlCommandTier;
  } = {},
): string | null {
  const tokenized: KubectlTokenizeResult = KubectlPolicy.tokenize(command);
  const args: Array<string> = tokenized.args || [];

  expect(args.length).toBeGreaterThan(0);

  const refusal: KubectlWriteScopeRefusal | null = KubectlWriteScope.getRefusal(
    {
      command: {
        args,
        tier: scope.tier ?? KubectlCommandTier.RiskyWrite,
        verb: KubectlPolicy.evaluateArgs(args).verb,
        displayCommand: KubectlPolicy.renderDisplayCommand(args),
      },
      writeNamespaces: scope.writeNamespaces ?? [],
      podNamespace:
        scope.podNamespace === undefined ? POD_NAMESPACE : scope.podNamespace,
      allowNodeOperations: true,
      usesCredential: scope.usesCredential ?? false,
    },
  );

  return refusal ? refusal.reason : null;
}

describe("KubectlWriteScope.resolveNamespaces reads -n the way kubectl does", () => {
  test.each([
    ["-n x", ["scale", "deploy/web", "-n", "web", "--replicas=1"], ["web"]],
    ["-nx", ["scale", "deploy/web", "-nweb", "--replicas=1"], ["web"]],
    ["-n=x", ["scale", "deploy/web", "-n=web", "--replicas=1"], ["web"]],
    [
      "--namespace x",
      ["scale", "deploy/web", "--namespace", "web", "--replicas=1"],
      ["web"],
    ],
    [
      "--namespace=x",
      ["scale", "deploy/web", "--namespace=web", "--replicas=1"],
      ["web"],
    ],
    [
      "-n before the verb",
      ["-n", "web", "rollout", "restart", "deploy/web"],
      ["web"],
    ],
    [
      "inside a boolean cluster (-An x)",
      ["get", "pods", "-An", "web"],
      ["web"],
    ],
    ["inside a boolean cluster (-Anx)", ["get", "pods", "-Anweb"], ["web"]],
    [
      "after a boolean long flag",
      ["label", "pod", "p", "--overwrite", "-n", "web", "a=b"],
      ["web"],
    ],
    [
      "after an optional-value flag written bare",
      ["delete", "pod", "p", "--cascade", "-n", "web"],
      ["web"],
    ],
    [
      "after a value flag that carries its value inline",
      ["get", "pods", "--selector=app=x", "-n", "web"],
      ["web"],
    ],
    [
      "after a value flag and its separate value",
      ["get", "pods", "-l", "app=x", "-n", "web"],
      ["web"],
    ],
    [
      "after an inline short value",
      ["get", "pods", "-lapp=x", "-nweb"],
      ["web"],
    ],
    [
      "every setting, in order (kubectl uses the last)",
      ["get", "pods", "-n", "a", "--namespace=b"],
      ["a", "b"],
    ],
    ["-n swallows a flag-looking value", ["get", "pods", "-n", "-A"], ["-A"]],
    ["no -n at all", ["rollout", "restart", "deploy/web"], []],
    [
      "an n inside a value is not a namespace",
      ["get", "pods", "-lnamespace=kube-system"],
      [],
    ],
    [
      "an n after a value letter is that letter's value",
      ["get", "pods", "-lnkube-system"],
      [],
    ],
    [
      "an inline patch mentioning -n is a value",
      ["patch", "deploy", "web", '-p{"spec":{"x":"-nkube-system"}}'],
      [],
    ],
    [
      "a positional that looks like a namespace flag value",
      ["label", "pod", "p", "note=-nkube-system"],
      [],
    ],
  ])("%s", (_label: string, args: Array<string>, expected: Array<string>) => {
    const resolution: KubectlNamespaceResolution = resolve(args);

    expect(resolution.ambiguity).toBeNull();
    expect(resolution.namespaces).toEqual(expected);
  });

  /*
   * Whether kubectl reads these as a namespace depends on something this
   * reader cannot know for certain, so they are refused rather than
   * guessed — both directions of a wrong guess would be a bypass.
   */
  test.each([
    [
      "right after a value flag written without its value",
      ["rollout", "restart", "deploy/web", "--selector", "-n", "web"],
    ],
    ["right after -l", ["rollout", "restart", "deploy/web", "-l", "-nweb"]],
    [
      "right after a long flag this reader does not know",
      ["scale", "deploy/web", "--brand-new-flag", "-n", "web"],
    ],
    ["after --", ["label", "pod", "p", "--", "-n", "web"]],
    ["with an unknown short letter before it", ["get", "pods", "-Xn", "web"]],
    ["-n with nothing after it", ["scale", "deploy/web", "-n"]],
  ])("is ambiguous %s", (_label: string, args: Array<string>) => {
    expect(resolve(args).ambiguity).not.toBeNull();
  });

  test.each([
    ["-A", ["label", "pods", "--all", "-A", "x=y"], true],
    ["--all-namespaces", ["label", "pods", "--all", "--all-namespaces"], true],
    ["--all_namespaces", ["label", "pods", "--all", "--all_namespaces"], true],
    ["-A inside a cluster", ["label", "pods", "-wA", "x=y"], true],
    ["-An web", ["get", "pods", "-An", "web"], true],
    [
      "--all-namespaces=false",
      ["get", "pods", "--all-namespaces=false"],
      false,
    ],
    ["-A=false", ["get", "pods", "-A=false"], false],
    ["an A inside a selector value", ["get", "pods", "-lA"], false],
    ["-A as the namespace value", ["get", "pods", "-n", "-A"], false],
    ["no -A at all", ["rollout", "restart", "deploy/web", "-n", "web"], false],
  ])(
    "reads all-namespaces: %s",
    (_label: string, args: Array<string>, expected: boolean) => {
      expect(resolve(args).allNamespaces).toBe(expected);
    },
  );
});

describe("KubectlWriteScope.getRefusal: the namespace scope", () => {
  describe("the Runner pod's own namespace", () => {
    test.each([
      `kubectl scale deployment oneuptime-agent-kubernetes-agent -n ${POD_NAMESPACE} --replicas=0`,
      `kubectl rollout restart deployment/x -n${POD_NAMESPACE}`,
      `kubectl patch deployment x --namespace=${POD_NAMESPACE} -p '{"spec":{}}'`,
      `kubectl -n ${POD_NAMESPACE} delete pod ai-runner-0`,
      `kubectl scale deployment x -n ${POD_NAMESPACE.toUpperCase()} --replicas=0`,
    ])("refuses `%s`", (command: string) => {
      const reason: string | null = verdict(command);

      expect(reason).not.toBeNull();
      expect(reason).toContain(`"${POD_NAMESPACE}"`);
      expect(reason).toContain("this Runner itself runs in");
    });

    /*
     * In-cluster, a namespaced write with no -n runs in the pod's own
     * namespace — the most natural way for a model to hit the agent.
     */
    test("refuses a write with no -n, which kubectl would run in the pod's namespace", () => {
      const reason: string | null = verdict(
        "kubectl rollout restart deployment/oneuptime-agent-kubernetes-agent",
      );

      expect(reason).not.toBeNull();
      expect(reason).toContain("names no namespace");
      expect(reason).toContain(POD_NAMESPACE);
      expect(reason).toContain("-n <namespace>");
    });

    test("lets a write into any other namespace through when no list is set", () => {
      expect(
        verdict("kubectl rollout restart deployment/web -n web"),
      ).toBeNull();
      expect(
        verdict("kubectl scale deployment coredns -n kube-system --replicas=2"),
      ).toBeNull();
    });
  });

  describe("the write-namespace list", () => {
    const writeNamespaces: Array<string> = ["web", "api"];

    test.each([
      "kubectl scale deployment coredns -n kube-system --replicas=0",
      "kubectl set image deployment/x -nkube-system c=i",
      `kubectl patch pod p --namespace=kube-system -p '{"spec":{}}'`,
      "kubectl set image deployment/ingress-nginx-controller -n ingress-nginx controller=attacker/img:1",
      "kubectl -n kube-system delete pod coredns-abc",
      // Every setting must be allowed, not just the one kubectl uses.
      "kubectl rollout restart deployment/web -n kube-system -n web",
    ])("refuses `%s`", (command: string) => {
      const reason: string | null = verdict(command, { writeNamespaces });

      expect(reason).not.toBeNull();
      expect(reason).toContain("outside the namespaces");
      expect(reason).toContain('"web", "api"');
      expect(reason).toContain("ONEUPTIME_KUBECTL_WRITE_NAMESPACES");
    });

    test.each([
      "kubectl rollout restart deployment/web -n web",
      "kubectl scale deployment/api -n api --replicas=3",
      `kubectl patch deployment web -n web -p'{"spec":{"paused":false}}'`,
      "kubectl -n WEB rollout restart deployment/web",
    ])("lets `%s` through", (command: string) => {
      expect(verdict(command, { writeNamespaces })).toBeNull();
    });

    test('a write with no -n on the credential path lands in "default", which is not listed', () => {
      const reason: string | null = verdict(
        "kubectl rollout restart deployment/web",
        { writeNamespaces, podNamespace: null, usesCredential: true },
      );

      expect(reason).toContain('"default"');
      expect(reason).toContain("-n <namespace>");
    });

    test("a write with no -n whose default namespace is unknown is refused", () => {
      const reason: string | null = verdict(
        "kubectl rollout restart deployment/web",
        { writeNamespaces, podNamespace: null, usesCredential: false },
      );

      expect(reason).toContain("names no namespace");
    });

    test("an ambiguous namespace is refused with the unambiguous spelling", () => {
      const reason: string | null = verdict(
        "kubectl rollout restart deployment/web --selector -n web",
        { writeNamespaces },
      );

      expect(reason).toContain("cannot tell for certain");
      expect(reason).toContain("kubectl -n <namespace>");
    });

    test("a write across every namespace is never inside a scope", () => {
      for (const command of [
        "kubectl label pods --all -A tier=x",
        "kubectl -n web label pods --all --all-namespaces tier=x",
      ]) {
        const reason: string | null = verdict(command, { writeNamespaces });

        expect(reason).toContain("every namespace");
      }

      // The pod-namespace rule alone refuses it too.
      expect(
        verdict("kubectl label pods --all -A tier=x", { writeNamespaces: [] }),
      ).toContain("every namespace");
    });

    test("an ambiguous namespace is refused even when it names an allowed one", () => {
      // kubectl may read "-n" as the selector's value and run in "default".
      expect(
        verdict("kubectl rollout restart deployment/web -l -n web", {
          writeNamespaces,
          podNamespace: null,
          usesCredential: true,
        }),
      ).not.toBeNull();
    });
  });

  describe("what is never namespace-scoped", () => {
    test.each([
      "kubectl get pods -n kube-system",
      `kubectl logs coredns-abc -n ${POD_NAMESPACE}`,
      "kubectl describe deployment web",
      "kubectl get pods -A",
    ])("a read: `%s`", (command: string) => {
      expect(
        verdict(command, {
          writeNamespaces: ["web"],
          tier: KubectlCommandTier.Read,
        }),
      ).toBeNull();
    });

    test("the same argv as a write IS scoped (the Read tier is what exempts it)", () => {
      expect(
        verdict("kubectl get pods -n kube-system", {
          writeNamespaces: ["web"],
          tier: KubectlCommandTier.SafeWrite,
        }),
      ).not.toBeNull();
    });

    test.each([
      "kubectl cordon node-1",
      "kubectl uncordon node-1",
      "kubectl drain node-1 --ignore-daemonsets",
      "kubectl taint nodes node-1 dedicated=ai:NoSchedule",
    ])("a node operation: `%s`", (command: string) => {
      expect(verdict(command, { writeNamespaces: ["web"] })).toBeNull();
    });

    test("nothing at all when no scope is configured", () => {
      expect(
        verdict(
          "kubectl scale deployment coredns -n kube-system --replicas=0",
          { writeNamespaces: [], podNamespace: null },
        ),
      ).toBeNull();
      expect(
        verdict("kubectl rollout restart deployment/web", {
          writeNamespaces: [],
          podNamespace: null,
        }),
      ).toBeNull();
    });
  });
});
