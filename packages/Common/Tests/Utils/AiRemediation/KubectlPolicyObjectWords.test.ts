import KubectlPolicy, {
  KubectlPolicyResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — which words of a command are its OBJECTS, for every
 * rule that reads the objects (Secrets, RBAC and admission kinds, a Node
 * patch, a Namespace object, the SafeWrite shape):
 *  1. Only the commands that take updates after their objects — label,
 *     annotate, taint, set image and set env — read a KEY=VALUE or KEY- word
 *     as an update, and the objects end there (kubectl's
 *     GetResourcesAndPairs, SplitEnvironmentFromResources and taint's own
 *     split). `label pod web-1 secret/rotated=true` names no Secret.
 *  2. Every other verb hands kubectl's resource builder ALL of its words,
 *     and kubectl goes on to the next object when one fails. Checked with
 *     the pinned kubectl v1.36.4 against a fake API server: `get pod/a=b
 *     secret/s -o name` printed `secret/s` after the missing pod's error,
 *     `describe pod/x- secret/s` and `scale pod/a=b secret/s` read the Secret,
 *     and `patch pod/a=b node/n1` PATCHed the Node. So a word with an `=` (or
 *     a trailing `-`) hides nothing after it: a Secret there is Denied (a
 *     read of one included — investigations run reads unattended), an RBAC
 *     or admission kind there is Denied, a Node there needs a human, a
 *     protected Namespace object there is protected.
 *  3. Negative controls: the update words of label, annotate, taint, set
 *     image and set env are still updates, never objects; reads and writes
 *     with no such word are untouched.
 */

function evaluate(command: string): KubectlPolicyResult {
  return KubectlPolicy.evaluateCommand(command);
}

// Words kubectl reads as one more object name, which the policy used to take for an update.
const HIDING_WORDS: Array<string> = ["pod/a=b", "pod/x-", "pods/web=1"];

// [verb and objects before the hiding word, what follows it] — every verb that reads all its words.
const SECRET_AFTER_A_WORD: Array<[string, string]> = [
  ["get", "secret/db -n web -o yaml"],
  ["describe", "secret/db -n web"],
  ["patch", `secret/db -n web -p '{"metadata":{"labels":{"a":"b"}}}'`],
  ["scale", "secret/db -n web --replicas=1"],
  ["expose", "secret/db -n web --port=80"],
  ["autoscale", "secret/db -n web --max=3"],
  ["rollout restart", "secret/db -n web"],
  ["rollout undo", "secret/db -n web"],
  ["set resources", "secret/db -n web --limits=cpu=1"],
  ["set selector", "secret/db app=web -n web"],
];

const SECRET_READS_AND_WRITES: Array<string> = HIDING_WORDS.flatMap(
  (word: string) => {
    return SECRET_AFTER_A_WORD.map(([verb, rest]: [string, string]) => {
      return `kubectl ${verb} ${word} ${rest}`;
    });
  },
);

const RBAC_AND_ADMISSION_AFTER_A_WORD: Array<string> = [
  `kubectl patch pod/a=b clusterrole/admin -n web -p '{"rules":[]}'`,
  `kubectl patch pod/x- clusterrolebinding/ai -n web -p '{"subjects":[]}'`,
  `kubectl patch pod/a=b validatingwebhookconfiguration/gatekeeper -n web -p '{"webhooks":[]}'`,
  "kubectl scale pod/a=b role/r -n web --replicas=1",
  "kubectl rollout restart pod/a=b customresourcedefinition/x -n web",
];

describe("KubectlPolicy: the words a command acts on", () => {
  describe("a word with an `=` hides nothing after it from verbs that take no updates", () => {
    it.each(SECRET_READS_AND_WRITES)(
      "denies %s: it names a Secret",
      (command: string) => {
        const result: KubectlPolicyResult = evaluate(command);

        expect(result.tier).toBe(KubectlCommandTier.Denied);
        expect(result.reason).toContain("on Secret objects is never allowed");
        expect(
          KubectlPolicy.evaluateForAutoExecution({
            command,
            allowlistPatterns: [command],
            bypassApproval: true,
          }).verdict,
        ).toBe(AiRemediationCommandPolicyVerdict.Denied);
        // The investigation lane runs only Read: this is not one.
        expect(KubectlPolicy.isReadOnly(command)).toBe(false);
      },
    );

    it.each(RBAC_AND_ADMISSION_AFTER_A_WORD)(
      "denies %s: it names an RBAC or admission kind",
      (command: string) => {
        const result: KubectlPolicyResult = evaluate(command);

        expect(result.tier).toBe(KubectlCommandTier.Denied);
        expect(result.reason).toContain("objects is never allowed");
      },
    );

    it("a Node after such a word needs a human", () => {
      const result: KubectlPolicyResult = evaluate(
        `kubectl patch pod/a=b node/n1 -n web -p '{"spec":{"taints":[{"key":"k","effect":"NoExecute"}]}}'`,
      );

      expect(result.tier).toBe(KubectlCommandTier.RiskyWrite);
      expect(result.requiresHuman).toBe(true);
    });

    it("a protected Namespace object after such a word is protected", () => {
      const result: KubectlPolicyResult = evaluate(
        `kubectl patch pod/a=b namespace/kube-system -n web -p '{"metadata":{"annotations":{"a":"b"}}}'`,
      );

      expect(result.tier).toBe(KubectlCommandTier.RiskyWrite);
      expect(result.protectedNamespace).toBe("kube-system");
    });

    it("a second word is a second object: a rollout that names one is not one named workload", () => {
      const result: KubectlPolicyResult = evaluate(
        "kubectl rollout restart deployment/web a=b -n web",
      );

      expect(result.tier).toBe(KubectlCommandTier.RiskyWrite);
      expect(result.reason).toContain("several workloads");
    });
  });

  describe("negative controls: the update words of label, annotate, taint, set image and set env", () => {
    it.each([
      "kubectl label pod web-1 secret/rotated=true -n web",
      "kubectl label pod web-1 clusterrole/x=y -n web",
      "kubectl annotate pod web-1 secret/rotated=true -n web",
      "kubectl annotate deployment web note- -n web",
      "kubectl label pod web-1 app=web tier- -n web",
    ])("%s stays SafeWrite: its pairs are updates", (command: string) => {
      const result: KubectlPolicyResult = evaluate(command);

      expect(result.tier).toBe(KubectlCommandTier.SafeWrite);
      expect(
        KubectlPolicy.evaluateForAutoExecution({
          command,
          allowlistPatterns: [],
        }).verdict,
      ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
    });

    it.each([
      "kubectl set image deployment/web secret=registry.example.com/web:2 -n web",
      "kubectl set image deployment/web clusterrole/x=nginx:1 -n web",
      "kubectl set env deployment/web secret/x=y -n web",
      "kubectl set env deployment/web SECRET- -n web",
    ])(
      "%s stays RiskyWrite: its pairs are updates, not objects",
      (command: string) => {
        const result: KubectlPolicyResult = evaluate(command);

        expect(result.tier).toBe(KubectlCommandTier.RiskyWrite);
        expect(result.requiresHuman).toBeUndefined();
      },
    );

    it("a taint's KEY=VALUE:EFFECT is an update: the taint needs a human, and is not Denied", () => {
      const result: KubectlPolicyResult = evaluate(
        "kubectl taint nodes n1 secret=x:NoSchedule",
      );

      expect(result.tier).toBe(KubectlCommandTier.RiskyWrite);
      expect(result.requiresHuman).toBe(true);
    });

    it.each([
      ["kubectl get pods -n web -l app=web", KubectlCommandTier.Read],
      ["kubectl get pod/web-1 deployment/web -n web", KubectlCommandTier.Read],
      ["kubectl describe pod web-1 -n web", KubectlCommandTier.Read],
      [
        "kubectl rollout restart deployment/web -n web",
        KubectlCommandTier.SafeWrite,
      ],
      [
        "kubectl scale deployment/web --replicas=3 -n web",
        KubectlCommandTier.SafeWrite,
      ],
      [
        `kubectl patch deployment web -n web -p '{"spec":{"replicas":2}}'`,
        KubectlCommandTier.RiskyWrite,
      ],
      [
        "kubectl set selector service/web app=web -n web",
        KubectlCommandTier.RiskyWrite,
      ],
    ])("%s keeps its tier", (command: string, tier: KubectlCommandTier) => {
      expect(evaluate(command).tier).toBe(tier);
    });
  });
});
