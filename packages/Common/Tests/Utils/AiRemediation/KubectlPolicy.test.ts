import KubectlPolicy, {
  KubectlAutoExecutionVerdict,
  KubectlPolicyResult,
  KubectlTokenizeResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import {
  AiRemediationCommandPolicyVerdict,
  MAX_COMMAND_LENGTH_CHARS,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — KubectlPolicy is the pure, three-place policy for
 * kubectl commands OneUptime AI composes (compose time, server enqueue, and
 * the customer-side Runner all run the same code):
 *  1. tokenize() splits a one-line command shell-style for quoting only and
 *     strips a leading "kubectl"; it never treats operators specially
 *     because kubectl is spawned as an argv, never through a shell.
 *  2. Read verbs (get/describe/logs/events/top/rollout status, ...) tier as
 *     Read; reversible controller-managed changes (rollout restart, scale,
 *     delete a NAMED pod/job, cordon/uncordon, label/annotate) tier as
 *     SafeWrite; anything that changes what is deployed or fans out (patch,
 *     set image, drain, delete by selector, delete workloads) tiers as
 *     RiskyWrite; exec/cp/port-forward/apply/edit, credential and file
 *     flags, --all-namespaces writes, deleting namespaces/volumes/nodes/
 *     secrets/CRDs, and unknown verbs are Denied.
 *  3. evaluateForAutoExecution promotes Read and SafeWrite to AutoApproved,
 *     keeps RiskyWrite at RequiresApproval unless the operator allowlist
 *     matches the rendered command, and never lifts a Denied.
 */

function tier(command: string): KubectlCommandTier {
  return KubectlPolicy.evaluateCommand(command).tier;
}

describe("KubectlPolicy", () => {
  describe("tokenize", () => {
    it("splits on whitespace and strips a leading kubectl", () => {
      const result: KubectlTokenizeResult = KubectlPolicy.tokenize(
        "kubectl  get pods  -n web",
      );
      expect(result.args).toEqual(["get", "pods", "-n", "web"]);
    });

    it("accepts a command without the binary name", () => {
      expect(KubectlPolicy.tokenize("get pods").args).toEqual(["get", "pods"]);
    });

    it("honours single and double quotes and backslash escapes", () => {
      const result: KubectlTokenizeResult = KubectlPolicy.tokenize(
        `kubectl get pods -o jsonpath='{.items[*].metadata.name}' -l "app in (web, api)" --field-selector=status.phase\\=Pending`,
      );
      expect(result.args).toEqual([
        "get",
        "pods",
        "-o",
        "jsonpath={.items[*].metadata.name}",
        "-l",
        "app in (web, api)",
        "--field-selector=status.phase=Pending",
      ]);
    });

    it("keeps shell operators as literal argument bytes", () => {
      // No shell is ever involved, so these are just characters in a token.
      const result: KubectlTokenizeResult = KubectlPolicy.tokenize(
        "kubectl get pods; rm -rf / | cat",
      );
      expect(result.args).toEqual([
        "get",
        "pods;",
        "rm",
        "-rf",
        "/",
        "|",
        "cat",
      ]);
    });

    it("rejects empty, multi-line, unbalanced and over-long commands", () => {
      expect(KubectlPolicy.tokenize("").errorMessage).toBe("Empty command.");
      expect(KubectlPolicy.tokenize("kubectl").errorMessage).toBe(
        "The command names no kubectl verb.",
      );
      expect(
        KubectlPolicy.tokenize("kubectl get pods\nkubectl delete ns x")
          .errorMessage,
      ).toBe("A kubectl command must be a single line.");
      expect(KubectlPolicy.tokenize("kubectl get 'pods").errorMessage).toBe(
        "Unbalanced quotes in the command.",
      );
      expect(
        KubectlPolicy.tokenize(
          `kubectl get ${"x".repeat(MAX_COMMAND_LENGTH_CHARS)}`,
        ).errorMessage,
      ).toContain("character limit");
    });
  });

  describe("Read tier", () => {
    it.each([
      "kubectl get pods -n web",
      "kubectl get pods -A",
      "kubectl get pod web-7d9f-abc -n web -o yaml",
      "kubectl describe pod web-7d9f-abc -n web",
      "kubectl describe node worker-1",
      "kubectl logs web-7d9f-abc -n web --tail=200 --previous",
      "kubectl logs deploy/web -n web --since=15m -c app",
      "kubectl get events -n web --sort-by=.lastTimestamp",
      "kubectl events -n web --for pod/web-7d9f-abc",
      "kubectl top pods -n web",
      "kubectl top nodes",
      "kubectl rollout status deployment/web -n web",
      "kubectl rollout history deployment/web -n web",
      "kubectl auth can-i delete pods -n web",
      "kubectl cluster-info",
      "kubectl api-resources",
      "kubectl version",
      "kubectl explain pod.spec.containers",
      "get deploy -n web",
    ])("tiers %s as Read", (command: string) => {
      const result: KubectlPolicyResult =
        KubectlPolicy.evaluateCommand(command);
      expect(result.tier).toBe(KubectlCommandTier.Read);
      expect(KubectlPolicy.isReadOnly(command)).toBe(true);
    });
  });

  describe("SafeWrite tier", () => {
    it.each([
      "kubectl rollout restart deployment/web -n web",
      "kubectl rollout undo deployment/web -n web",
      "kubectl rollout undo deployment/web -n web --to-revision=3",
      "kubectl rollout pause deployment web -n web",
      "kubectl rollout resume deployment web -n web",
      "kubectl scale deployment/web -n web --replicas=3",
      "kubectl scale statefulset db --replicas 2 -n data",
      "kubectl delete pod web-7d9f-abc -n web",
      "kubectl delete pods web-7d9f-abc web-7d9f-def -n web",
      "kubectl delete pod/web-7d9f-abc -n web",
      "kubectl delete job migrate-42 -n web",
      "kubectl cordon worker-1",
      "kubectl uncordon worker-1",
      "kubectl label node worker-1 pool=spare --overwrite",
      "kubectl annotate deployment web -n web oneuptime.com/note=restarted",
    ])("tiers %s as SafeWrite", (command: string) => {
      expect(tier(command)).toBe(KubectlCommandTier.SafeWrite);
      expect(KubectlPolicy.isReadOnly(command)).toBe(false);
    });
  });

  describe("RiskyWrite tier", () => {
    it.each([
      'kubectl patch deployment web -n web -p \'{"spec":{"replicas":2}}\'',
      "kubectl set image deployment/web web=nginx:1.27 -n web",
      "kubectl set env deployment/web -n web LOG_LEVEL=debug",
      "kubectl set resources deployment/web -n web --limits=cpu=1",
      "kubectl taint nodes worker-1 dedicated=gpu:NoSchedule",
      "kubectl drain worker-1 --ignore-daemonsets",
      "kubectl delete deployment web -n web",
      "kubectl delete pods -n web -l app=web",
      "kubectl delete pod web-7d9f-abc -n web --force --grace-period=0",
      "kubectl rollout restart deployment -n web --all",
      "kubectl rollout restart deployment -n web -l tier=frontend",
      "kubectl scale deployment --all --replicas=0 -n web",
      "kubectl label pods -n web -l app=web canary=true",
      "kubectl create job manual-run --from=cronjob/nightly -n web",
      "kubectl expose deployment web --port=80 -n web",
      "kubectl autoscale deployment web --min=2 --max=5 -n web",
      "kubectl delete somecustomkind foo -n web",
    ])("tiers %s as RiskyWrite", (command: string) => {
      expect(tier(command)).toBe(KubectlCommandTier.RiskyWrite);
    });
  });

  describe("Denied", () => {
    it.each([
      "kubectl exec -it web-7d9f-abc -n web -- sh",
      "kubectl attach web-7d9f-abc -n web",
      "kubectl cp web:/etc/passwd ./passwd -n web",
      "kubectl port-forward svc/web 8080:80 -n web",
      "kubectl proxy",
      "kubectl debug node/worker-1 -it --image=busybox",
      "kubectl run tmp --image=busybox -n web",
      "kubectl edit deployment web -n web",
      "kubectl apply -f deploy.yaml",
      "kubectl replace -f deploy.yaml",
      "kubectl create -f job.yaml",
      "kubectl delete -f deploy.yaml",
      "kubectl diff -f deploy.yaml",
      "kubectl kustomize ./overlay",
      "kubectl config view",
      "kubectl certificate approve csr-1",
      "kubectl wait --for=condition=ready pod/web -n web",
      "kubectl cluster-info dump",
      "kubectl auth reconcile -f rbac.yaml",
      "kubectl logs web-7d9f-abc -n web -f",
      "kubectl logs web-7d9f-abc -n web --follow",
      "kubectl get pods --kubeconfig=/root/.kube/config",
      "kubectl get pods --token=abc",
      "kubectl get pods --server=https://evil.example",
      "kubectl get pods -s https://evil.example",
      "kubectl get secrets --as=system:admin",
      "kubectl get pods --context=prod",
      "kubectl get --raw /api/v1/namespaces",
      "kubectl get pods -v=9",
      "kubectl get pods --v 9",
      "kubectl delete namespace web",
      "kubectl delete ns web",
      "kubectl delete pv data-1",
      "kubectl delete pvc data-web-0 -n web",
      "kubectl delete node worker-1",
      "kubectl delete crd foos.example.com",
      "kubectl delete secret db-creds -n web",
      "kubectl delete clusterrolebinding admin",
      "kubectl delete all --all -n web",
      "kubectl delete pods --all -n web",
      "kubectl delete pods -A -l app=web",
      "kubectl delete pod -n web",
      "kubectl delete pod,secret web-1 -n web",
      "kubectl rollout restart deployment web -A",
      "kubectl scale deployment web -n web",
      "kubectl scale deployment web --all-namespaces --replicas=0",
      "kubectl frobnicate pods",
      "helm list",
      "kubectl",
      "",
    ])("denies %s", (command: string) => {
      const result: KubectlPolicyResult =
        KubectlPolicy.evaluateCommand(command);
      expect(result.tier).toBe(KubectlCommandTier.Denied);
      expect(result.reason.length).toBeGreaterThan(0);
    });

    it("explains the denied flag by name", () => {
      const result: KubectlPolicyResult = KubectlPolicy.evaluateCommand(
        "kubectl get pods --kubeconfig /tmp/kc",
      );
      expect(result.reason).toContain("--kubeconfig");
    });
  });

  describe("evaluateArgs", () => {
    it("evaluates an argv without re-tokenizing, as the Runner does", () => {
      const result: KubectlPolicyResult = KubectlPolicy.evaluateArgs([
        "get",
        "pods",
        "-n",
        "web",
      ]);
      expect(result.tier).toBe(KubectlCommandTier.Read);
      expect(result.verb).toBe("get");
      expect(result.displayCommand).toBe("kubectl get pods -n web");
    });

    it("treats an embedded line break as Denied even inside an argv", () => {
      expect(
        KubectlPolicy.evaluateArgs(["get", "pods\ndelete", "ns"]).tier,
      ).toBe(KubectlCommandTier.Denied);
    });

    it("denies an empty or non-string argv", () => {
      expect(KubectlPolicy.evaluateArgs([]).tier).toBe(
        KubectlCommandTier.Denied,
      );
      expect(
        KubectlPolicy.evaluateArgs([1 as unknown as string, "get"]).verb,
      ).toBe("get");
    });
  });

  describe("renderDisplayCommand", () => {
    it("round-trips through tokenize and quotes only what needs it", () => {
      const args: Array<string> = [
        "get",
        "pods",
        "-l",
        "app in (web, api)",
        "-o",
        "jsonpath={.items[*].metadata.name}",
        "--field-selector=status.phase=Pending",
      ];
      const rendered: string = KubectlPolicy.renderDisplayCommand(args);
      expect(rendered).toBe(
        `kubectl get pods -l 'app in (web, api)' -o 'jsonpath={.items[*].metadata.name}' --field-selector=status.phase=Pending`,
      );
      expect(KubectlPolicy.tokenize(rendered).args).toEqual(args);
    });

    it("escapes single quotes inside a quoted token", () => {
      const rendered: string = KubectlPolicy.renderDisplayCommand([
        "annotate",
        "pod",
        "x",
        "note=it's fine",
      ]);
      expect(KubectlPolicy.tokenize(rendered).args).toEqual([
        "annotate",
        "pod",
        "x",
        "note=it's fine",
      ]);
    });
  });

  describe("evaluateForAutoExecution", () => {
    it("auto-approves Read and SafeWrite regardless of the allowlist", () => {
      const read: KubectlAutoExecutionVerdict =
        KubectlPolicy.evaluateForAutoExecution({
          command: "kubectl get pods -n web",
          allowlistPatterns: [],
        });
      expect(read.verdict).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
      expect(read.tier).toBe(KubectlCommandTier.Read);

      const safe: KubectlAutoExecutionVerdict =
        KubectlPolicy.evaluateForAutoExecution({
          command: "kubectl rollout restart deployment/web -n web",
          allowlistPatterns: [],
        });
      expect(safe.verdict).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
      expect(safe.tier).toBe(KubectlCommandTier.SafeWrite);
    });

    it("keeps RiskyWrite at RequiresApproval without an allowlist match", () => {
      const verdict: KubectlAutoExecutionVerdict =
        KubectlPolicy.evaluateForAutoExecution({
          command: "kubectl set image deployment/web web=nginx:1.27 -n web",
          allowlistPatterns: ["kubectl drain *"],
        });
      expect(verdict.verdict).toBe(
        AiRemediationCommandPolicyVerdict.RequiresApproval,
      );
      expect(verdict.tier).toBe(KubectlCommandTier.RiskyWrite);
      expect(verdict.reason).toContain("Requires human approval");
    });

    it("promotes RiskyWrite to AutoApproved when the allowlist matches the rendered command", () => {
      const verdict: KubectlAutoExecutionVerdict =
        KubectlPolicy.evaluateForAutoExecution({
          command: "kubectl set image deployment/web web=nginx:1.27 -n web",
          allowlistPatterns: ["kubectl set image deployment/web * -n web"],
        });
      expect(verdict.verdict).toBe(
        AiRemediationCommandPolicyVerdict.AutoApproved,
      );
      expect(verdict.reason).toContain("allowlist");
    });

    it("never lifts a Denied command, even with a matching allowlist", () => {
      const verdict: KubectlAutoExecutionVerdict =
        KubectlPolicy.evaluateForAutoExecution({
          command: "kubectl delete namespace web",
          allowlistPatterns: ["kubectl delete *"],
        });
      expect(verdict.verdict).toBe(AiRemediationCommandPolicyVerdict.Denied);
      expect(verdict.reason).toContain("cannot run even with human approval");
    });
  });
});
