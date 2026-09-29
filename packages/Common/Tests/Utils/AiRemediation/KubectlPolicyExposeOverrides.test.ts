import KubectlPolicy, {
  KubectlAutoExecutionVerdict,
  KubectlPolicyResult,
  KubectlTokenizeResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — `kubectl expose --overrides` is Denied:
 *  1. kubectl merges --overrides into the Service expose generates (as
 *     --override-type says: merge, strategic or json) and then creates
 *     whatever object the result describes, of any kind and in any
 *     namespace. Checked with the pinned kubectl v1.36.4 against a fake API
 *     server: `expose deployment web -n prod --overrides=<CRB>` POSTs a
 *     cluster-admin ClusterRoleBinding, and `--override_type=json` with a
 *     `replace /kind` POSTs a Namespace. So the command no longer says what
 *     it creates, and every rule that reads the object (RBAC creation,
 *     create job --image, the pod-security patch fields, the write scope)
 *     reads the wrong one.
 *  2. So any write that carries --overrides or --override-type — in every
 *     spelling kubectl accepts: `--overrides=...`, `--overrides ...`,
 *     `--override_type=...`, `--override-type ...`, an empty value, even a
 *     "harmless" Service override — is Denied, and stays Denied under Bypass
 *     approval and an allowlist entry that spells the command exactly.
 *     expose is the only verb OneUptime AI may run that has these flags in
 *     v1.36.4 (checked with `kubectl <verb> --help` over every allowed verb
 *     and create/set/rollout subcommand; `kubectl run` has them too and is a
 *     Denied verb); any other write that spells one is Denied the same way.
 *  3. An allowlist entry that spells either flag is refused where it is
 *     typed (it could only ever match Denied commands) and so never matches.
 *  4. Negative controls: a plain expose stays RiskyWrite and runs under
 *     Bypass approval and its exact entry; the other expose flags and
 *     autoscale are untouched; the flag's arity is unchanged, so the value
 *     after `--overrides` is never read as an object.
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

const CLUSTER_ADMIN_BINDING: string =
  '{"apiVersion":"rbac.authorization.k8s.io/v1","kind":"ClusterRoleBinding","metadata":{"name":"ai-escape","namespace":null,"labels":null},"spec":null,"roleRef":{"apiGroup":"rbac.authorization.k8s.io","kind":"ClusterRole","name":"cluster-admin"},"subjects":[{"kind":"ServiceAccount","name":"default","namespace":"prod"}]}';

const PRIVILEGED_JOB: string =
  '{"apiVersion":"batch/v1","kind":"Job","metadata":{"labels":null},"spec":{"selector":null,"ports":null,"template":{"spec":{"serviceAccountName":"payments-admin","hostPID":true,"restartPolicy":"Never","containers":[{"name":"x","image":"attacker/image","securityContext":{"privileged":true}}],"volumes":[{"name":"root","hostPath":{"path":"/"}}]}}}}';

const DEFAULT_PRIORITY_CLASS: string =
  '{"apiVersion":"scheduling.k8s.io/v1","kind":"PriorityClass","metadata":{"name":"ai","labels":null},"spec":null,"value":1000000,"globalDefault":true}';

const KIND_TO_NAMESPACE: string =
  '[{"op":"replace","path":"/kind","value":"Namespace"},{"op":"replace","path":"/metadata","value":{"name":"via-json-patch"}},{"op":"remove","path":"/spec"}]';

// Every spelling kubectl accepts, and every kind of override.
const DENIED_EXPOSES: Array<string> = [
  `kubectl expose deployment web -n prod --port=80 --overrides='${CLUSTER_ADMIN_BINDING}'`,
  `kubectl expose deployment web -n prod --port=80 --overrides '${CLUSTER_ADMIN_BINDING}'`,
  `kubectl expose deployment web -n prod --port=80 --overrides='${PRIVILEGED_JOB}'`,
  `kubectl expose deployment web -n prod --port=80 --overrides='${DEFAULT_PRIORITY_CLASS}'`,
  `kubectl expose deployment web -n prod --port=80 --override-type=json --overrides='${KIND_TO_NAMESPACE}'`,
  `kubectl expose deployment web -n prod --port=80 --override_type=json --overrides '${KIND_TO_NAMESPACE}'`,
  `kubectl expose deployment web -n prod --port=80 --override-type json --overrides='{"kind":"Job"}'`,
  `kubectl expose deployment web -n prod --port=80 --override-type=strategic --overrides='{"kind":"Job"}'`,
  // A "harmless" override is refused all the same: no reading of it is trusted.
  `kubectl expose deployment web -n prod --port=80 --overrides='{"apiVersion":"v1","kind":"Service"}'`,
  `kubectl expose deployment web -n prod --port=80 --overrides='{}'`,
  "kubectl expose deployment web -n prod --port=80 --overrides=",
  // Either flag alone.
  "kubectl expose deployment web -n prod --port=80 --override-type=json",
  "kubectl expose deployment web -n prod --port=80 --override_type=merge",
  "kubectl expose deployment web -n prod --port=80 --override-type merge",
  // Before the objects, TYPE/NAME, other objects and no namespace.
  `kubectl expose --overrides='{"kind":"Job"}' deployment web -n prod --port=80`,
  `kubectl expose deployment/web --port=80 --overrides='{"kind":"Job"}'`,
  `kubectl expose service web --port=80 --target-port=8080 --name=web2 -n prod --overrides='{"kind":"Job"}'`,
  `kubectl expose pod web-1 --port=80 -n prod --overrides='{"kind":"Job"}'`,
  `kubectl -n prod expose deployment web --port=80 --overrides='{"kind":"Job"}'`,
];

// Other writes that spell the flag: kubectl has no such flag there, and the policy refuses it too.
const DENIED_OTHER_WRITES: Array<[string, string]> = [
  [
    `kubectl patch deployment web -n web -p '{"spec":{"replicas":2}}' --overrides='{"kind":"Job"}'`,
    "patch",
  ],
  [
    `kubectl create job manual-run --from=cronjob/nightly -n web --overrides='{"kind":"Job"}'`,
    "create job",
  ],
  [
    "kubectl scale deployment/web --replicas=2 -n web --override-type=json",
    "scale",
  ],
  [
    `kubectl rollout restart deployment/web -n web --overrides='{}'`,
    "rollout restart",
  ],
  [
    "kubectl autoscale deployment web -n web --max=3 --overrides={}",
    "autoscale",
  ],
];

describe("KubectlPolicy: kubectl expose --overrides is Denied", () => {
  describe("every spelling of the override flags is Denied on expose", () => {
    it.each(DENIED_EXPOSES)("denies %s", (command: string) => {
      const result: KubectlPolicyResult =
        KubectlPolicy.evaluateCommand(command);

      expect(result.tier).toBe(KubectlCommandTier.Denied);
      expect(result.verb).toBe("expose");
      expect(result.reason).toContain("kubectl expose with --override");
      expect(result.reason).toContain("of any kind and in any namespace");
      expect(result.reason).toContain("ClusterRoleBinding");
      // The same verdict from the argv the Runner gets.
      expect(KubectlPolicy.evaluateArgs(result.args)).toEqual(result);
    });

    it.each(DENIED_EXPOSES)(
      "never runs %s: not with Bypass approval, not through an exact allowlist entry",
      (command: string) => {
        for (const options of [
          {},
          { bypassApproval: true },
          { allowlistPatterns: [command] },
          { allowlistPatterns: [command], bypassApproval: true },
        ]) {
          const verdict: KubectlAutoExecutionVerdict = autoVerdict(
            command,
            options,
          );
          expect(verdict.verdict).toBe(
            AiRemediationCommandPolicyVerdict.Denied,
          );
          expect(verdict.reason).toContain(
            "This command cannot run even with human approval",
          );
        }
      },
    );

    it("names the flag the command spelled", () => {
      expect(
        KubectlPolicy.evaluateCommand(
          "kubectl expose deployment web -n prod --port=80 --override_type=json",
        ).reason,
      ).toContain("with --override-type is never allowed");
      expect(
        KubectlPolicy.evaluateCommand(
          "kubectl expose deployment web -n prod --port=80 --overrides={}",
        ).reason,
      ).toContain("with --overrides is never allowed");
    });
  });

  describe("any other write that spells the flag is Denied too", () => {
    it.each(DENIED_OTHER_WRITES)(
      "denies %s",
      (command: string, verbLabel: string) => {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);

        expect(result.tier).toBe(KubectlCommandTier.Denied);
        expect(result.verb).toBe(verbLabel);
        expect(result.reason).toContain(`kubectl ${verbLabel} with --override`);
        expect(autoVerdict(command, { bypassApproval: true }).verdict).toBe(
          AiRemediationCommandPolicyVerdict.Denied,
        );
      },
    );
  });

  describe("an allowlist entry that spells the flag is refused where it is typed", () => {
    it.each([
      "kubectl expose deployment web -n web --port=80 --overrides=*",
      "kubectl expose deployment web -n web --port=80 --overrides *",
      "kubectl expose deployment * -n web --port=* --override-type=*",
      "expose deployment web -n web --port=80 --override_type=json",
      "kubectl patch deployment web -n web -p * --overrides=*",
    ])("refuses %p", (entry: string) => {
      const problem: string | null =
        KubectlPolicy.describeAllowlistPatternProblem(entry);

      expect(problem).not.toBeNull();
      expect(problem).toContain("can never match a command that runs");
      expect(problem).toContain("--override");
      expect(KubectlPolicy.isBroadAllowlistPattern(entry)).toBe(false);
    });

    it("the refused entry never matches the command it spells", () => {
      const command: string = `kubectl expose deployment web -n web --port=80 --overrides='{"kind":"Job"}'`;
      expect(
        KubectlPolicy.matchesAllowlist({
          args: argsOf(command),
          allowlistPatterns: [
            "kubectl expose deployment web -n web --port=80 --overrides=*",
          ],
        }),
      ).toBe(false);
    });

    it("negative control: the entry without the flag is valid and matches", () => {
      const entry: string = "kubectl expose deployment web -n web --port=*";
      expect(KubectlPolicy.describeAllowlistPatternProblem(entry)).toBeNull();
      expect(KubectlPolicy.isBroadAllowlistPattern(entry)).toBe(false);
      expect(
        KubectlPolicy.matchesAllowlist({
          args: argsOf("kubectl expose deployment web -n web --port=80"),
          allowlistPatterns: [entry],
        }),
      ).toBe(true);
    });
  });

  describe("negative controls", () => {
    it.each([
      "kubectl expose deployment web -n prod --port=80",
      "kubectl expose deployment web -n prod --port=80 --target-port=8080",
      "kubectl expose service web -n prod --port=80 --target-port=8080 --name=web2",
      "kubectl expose deployment/web -n prod --port=443 --type=LoadBalancer --protocol=TCP",
      "kubectl autoscale deployment web -n prod --max=3",
      "kubectl autoscale deployment web -n prod --min=2 --max=5 --cpu-percent=80",
    ])(
      "%s stays RiskyWrite and runs under Bypass approval or its entry",
      (command: string) => {
        const result: KubectlPolicyResult =
          KubectlPolicy.evaluateCommand(command);

        expect(result.tier).toBe(KubectlCommandTier.RiskyWrite);
        expect(result.requiresHuman).toBeUndefined();
        expect(autoVerdict(command, { bypassApproval: true }).verdict).toBe(
          AiRemediationCommandPolicyVerdict.AutoApproved,
        );
        expect(
          autoVerdict(command, { allowlistPatterns: [command] }).verdict,
        ).toBe(AiRemediationCommandPolicyVerdict.AutoApproved);
        expect(autoVerdict(command).verdict).toBe(
          AiRemediationCommandPolicyVerdict.RequiresApproval,
        );
      },
    );

    it("--overrides keeps its arity: the JSON after it is its value, not an object", () => {
      /*
       * Were --overrides read as a boolean, `secret/x` would be an object
       * the command names and the refusal would be about Secrets.
       */
      const result: KubectlPolicyResult = KubectlPolicy.evaluateCommand(
        "kubectl expose deployment web -n prod --port=80 --overrides secret/x",
      );
      expect(result.tier).toBe(KubectlCommandTier.Denied);
      expect(result.reason).toContain("kubectl expose with --overrides");
    });

    it("a read that spells the flag stays Read: it creates nothing, and kubectl refuses the flag on reads", () => {
      const result: KubectlPolicyResult = KubectlPolicy.evaluateCommand(
        "kubectl get services -n prod --overrides={}",
      );
      expect(result.tier).toBe(KubectlCommandTier.Read);
    });
  });
});
