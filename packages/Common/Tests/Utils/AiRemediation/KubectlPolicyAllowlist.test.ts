import KubectlPolicy, {
  KubectlAutoExecutionVerdict,
  KubectlTokenizeResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { AiRemediationCommandPolicyVerdict } from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test — the cluster kubectl allowlist (the operator's
 * pre-approved RiskyWrite shapes for Automatic mode) is matched TOKEN BY
 * TOKEN against the argv kubectl will run, never as one glob over the
 * rendered string:
 *  1. A pattern is tokenized like a command (shell quoting, "kubectl"
 *     optional) and must have exactly as many tokens as the command, so a
 *     `*` can never absorb an extra resource, a selector, a second -n or any
 *     other argument.
 *  2. A `*` globs inside ONE token and never matches whitespace.
 *  3. A flag in the command must be spelled literally in the pattern (only a
 *     value after "=" may glob); a bare `*` never stands for a flag.
 *  4. The allowlist promotes only RiskyWrite: never a Denied command, never
 *     a write in a protected namespace, and never a drain or taint (which
 *     always need a human) — however exactly an entry matches them. An
 *     entry for `kubectl patch ... -p *` never promotes a body the policy
 *     denies.
 *  5. Entry normalization: non-strings and blank entries are skipped, only
 *     the first 100 entries are read, and every entry
 *     describeAllowlistPatternProblem refuses (longer than 500 characters,
 *     untokenizable, a `*` where the verb goes, ...) is ignored; case
 *     matters. The validity and broadness rules themselves are pinned in
 *     KubectlAllowlistValidatorParity.test.ts.
 *
 * The widened commands below are the ones the review showed a whole-string
 * glob auto-approved: extra resources before the image pair (kubectl's
 * GetResourcesAndPairs treats them as more targets), a second namespace
 * flag after a trailing `*` (pflag keeps the last value), and a value flag
 * that swallows a literal "-n".
 */

function verdictFor(
  command: string,
  allowlistPatterns: Array<string>,
): KubectlAutoExecutionVerdict {
  return KubectlPolicy.evaluateForAutoExecution({ command, allowlistPatterns });
}

function matches(command: string, allowlistPatterns: Array<string>): boolean {
  const tokenized: KubectlTokenizeResult = KubectlPolicy.tokenize(command);
  return KubectlPolicy.matchesAllowlist({
    args: tokenized.args || [],
    allowlistPatterns,
  });
}

const SET_IMAGE_PATTERN: string = "kubectl set image deployment/web * -n web";

// [command, pattern] pairs a whole-string glob would have approved.
const WIDENED_COMMANDS: Array<[string, string]> = [
  // Extra resources ahead of the pair: kubectl updates every one of them.
  [
    "kubectl set image deployment/web deployment/api web=evil:1 -n web",
    SET_IMAGE_PATTERN,
  ],
  [
    "kubectl set image deployment/web deployment/api statefulset/db '*=evil:1' -n web",
    SET_IMAGE_PATTERN,
  ],
  // A selector, --all or another flag where the pattern has none.
  ["kubectl set image deployment/web web=x -l app=y -n web", SET_IMAGE_PATTERN],
  ["kubectl set image deployment/web --all web=x -n web", SET_IMAGE_PATTERN],
  ["kubectl set image deployment/web -lapp=y -n web", SET_IMAGE_PATTERN],
  [
    "kubectl set image deployment/web --selector=app=y -n web",
    SET_IMAGE_PATTERN,
  ],
  // The pattern's namespace flag is literal: `*` cannot stand for another.
  [
    "kubectl -n web patch deployment web --namespace=kube-system",
    "kubectl -n web patch deployment web *",
  ],
  // A trailing `*` can no longer carry a body AND more flags.
  [
    "kubectl patch deployment web -n web -p '{\"spec\":{}}' --field-manager x",
    "kubectl patch deployment web -n web -p *",
  ],
  [
    "kubectl patch deployment web -p '{\"spec\":{}}' --field-manager -n",
    "kubectl patch deployment web *",
  ],
  // More names than the pattern.
  [
    "kubectl patch deployment web api -n web -p '{}'",
    "kubectl patch deployment web -n web -p *",
  ],
  [
    "kubectl delete deployment web api -n web",
    "kubectl delete deployment * -n web",
  ],
  // Another verb or object entirely.
  ["kubectl set image deployment/api api=x -n web", SET_IMAGE_PATTERN],
  ["kubectl set image deployment/web web=x -n prod", SET_IMAGE_PATTERN],
  ["kubectl set env deployment/web A=b -n web", SET_IMAGE_PATTERN],
  // `*` never matches whitespace, even inside one quoted token.
  [
    'kubectl patch deployment web -n web -p \'{"spec": {"replicas": 2}}\'',
    "kubectl patch deployment web -n web -p *",
  ],
  // A bare `*` is never a flag.
  ["kubectl drain node-1 --ignore-daemonsets", "kubectl drain * *"],
  ["kubectl drain node-1 --force", "kubectl drain node-1 *"],
  // Case-sensitive.
  ["kubectl set image deployment/Web web=x -n web", SET_IMAGE_PATTERN],
];

// [command, pattern] pairs that must keep matching.
const INTENDED_MATCHES: Array<[string, string]> = [
  // The documented example.
  ["kubectl set image deployment/web web=nginx:1.27 -n web", SET_IMAGE_PATTERN],
  ["kubectl set image deployment/web '*=nginx:1.27' -n web", SET_IMAGE_PATTERN],
  // A glob inside one token.
  [
    "kubectl set image deployment/web web=nginx:1.27 -n web",
    "kubectl set image deployment/web web=* -n web",
  ],
  [
    "kubectl set image deployment/api api=nginx:1.27 -n web",
    "kubectl set image deployment/* *=* -n web",
  ],
  [
    "kubectl set image deployment/web web=registry.example.com/web:1.2.3 -n web",
    "kubectl set image deployment/web web=registry.example.com/web:* -n web",
  ],
  // A patch body written without spaces.
  [
    'kubectl patch deployment web -n web -p \'{"spec":{"replicas":2}}\'',
    "kubectl patch deployment web -n web -p *",
  ],
  /*
   * A flag spelled literally, globbing only its value. (These rows used
   * `kubectl drain`, which the allowlist no longer promotes at all — see
   * DRAIN_AND_TAINT_MATCHES.)
   */
  [
    "kubectl scale deployment/web --replicas=0 -n web --timeout=120s",
    "kubectl scale deployment/web --replicas=* -n web --timeout=*",
  ],
  [
    "kubectl delete job migrate-42 -n web --grace-period=30",
    "kubectl delete job migrate-* -n web --grace-period=*",
  ],
  // "kubectl" optional in the pattern, and quoting in the pattern tokenizes too.
  ["kubectl delete job migrate-42 -n web", "delete job migrate-42 -n web"],
  [
    "kubectl delete job migrate-42 -n web",
    "KUBECTL delete job migrate-42 -n web",
  ],
  ["delete job migrate-42 -n web", "kubectl delete job migrate-42 -n web"],
  [
    'kubectl patch deployment web -n web -p \'{"spec": {"replicas": 2}}\'',
    'kubectl patch deployment web -n web -p \'{"spec": {"replicas": *}}\'',
  ],
  // Whitespace between tokens is not significant.
  [
    "kubectl  delete   job  migrate-42 -n  web",
    "kubectl delete job migrate-42    -n web",
  ],
  // A literal pattern with no glob at all.
  [
    "kubectl rollout restart deployment -n web",
    "kubectl rollout restart deployment -n web",
  ],
  ["kubectl delete job migrate-42 -n web", "kubectl delete job * -n web"],
];

/*
 * [command, pattern] pairs the matcher still matches word for word — but a
 * drain or taint always needs a human, so no entry promotes them.
 */
const DRAIN_AND_TAINT_MATCHES: Array<[string, string]> = [
  [
    "kubectl drain node-1 --ignore-daemonsets --timeout=120s",
    "kubectl drain * --ignore-daemonsets --timeout=*",
  ],
  [
    "kubectl drain node-7 --ignore-daemonsets",
    "kubectl drain node-* --ignore-daemonsets",
  ],
  [
    "kubectl drain node-1 --ignore-daemonsets",
    "drain node-1 --ignore-daemonsets",
  ],
  [
    "kubectl taint nodes node-1 dedicated=db:NoExecute",
    "kubectl taint nodes * dedicated=db:*",
  ],
];

/*
 * Patch bodies an allowlisted `-p *` shape reaches that the policy denies,
 * in every body syntax the policy used to accept — the entry must never
 * promote them, with Bypass approval off or on.
 */
const DENIED_BODIES_UNDER_PATCH_ENTRY: Array<string> = [
  // JSON touching a forbidden field, plainly or escaped.
  `kubectl patch deployment web -n web -p '{"spec":{"template":{"spec":{"serviceAccountName":"default"}}}}'`,
  `kubectl patch deployment web -n web -p '{"spec":{"template":{"spec":{"serviceAccount\\u004eame":"default"}}}}'`,
  `kubectl patch deployment web -n web -p '{"spec":{"template":{"spec":{"$setElementOrder/volumes":[]}}}}'`,
  `kubectl patch deployment web -n web -p '{"spec":{"template":{"spec":{"containers":[{"name":"web","command":["sh"]}]}}}}'`,
  // Bodies that are not JSON (a YAML tag needs a space, which * never matches).
  "kubectl patch deployment web -n web -p spec:{template:{spec:{hostNetwork:true}}}",
  "kubectl patch deployment web -n web -p spec:{replicas:2}",
  "kubectl patch deployment web -n web -p '!!binary'",
  "kubectl patch deployment web -n web -p '[&a{op:add},*a]'",
];

describe("KubectlPolicy cluster allowlist (token by token)", () => {
  describe("a pattern never widens past the shape it names", () => {
    it.each(WIDENED_COMMANDS)(
      "does not match %s with the pattern %s",
      (command: string, pattern: string) => {
        expect(matches(command, [pattern])).toBe(false);
        const verdict: KubectlAutoExecutionVerdict = verdictFor(command, [
          pattern,
        ]);
        expect(verdict.verdict).not.toBe(
          AiRemediationCommandPolicyVerdict.AutoApproved,
        );
      },
    );
  });

  describe("the shapes an operator meant still match (negative controls)", () => {
    it.each(INTENDED_MATCHES)(
      "matches %s with the pattern %s",
      (command: string, pattern: string) => {
        expect(matches(command, [pattern])).toBe(true);
        const verdict: KubectlAutoExecutionVerdict = verdictFor(command, [
          pattern,
        ]);
        expect(verdict.tier).toBe(KubectlCommandTier.RiskyWrite);
        expect(verdict.verdict).toBe(
          AiRemediationCommandPolicyVerdict.AutoApproved,
        );
        expect(verdict.reason).toContain("allowlist");
      },
    );
  });

  describe("what the allowlist can never promote", () => {
    it.each(DRAIN_AND_TAINT_MATCHES)(
      "matches %s with %s word for word, but never promotes a drain or taint",
      (command: string, pattern: string) => {
        expect(matches(command, [pattern])).toBe(true);
        const verdict: KubectlAutoExecutionVerdict = verdictFor(command, [
          pattern,
        ]);
        expect(verdict.tier).toBe(KubectlCommandTier.RiskyWrite);
        expect(verdict.verdict).toBe(
          AiRemediationCommandPolicyVerdict.RequiresApproval,
        );
        expect(verdict.requiresHuman).toBe(true);
        expect(verdict.reason).not.toContain(
          "Matched the cluster's kubectl allowlist",
        );
      },
    );

    it.each(DENIED_BODIES_UNDER_PATCH_ENTRY)(
      "never promotes %s through `kubectl patch deployment web -n web -p *`",
      (command: string) => {
        const pattern: string = "kubectl patch deployment web -n web -p *";
        // The entry matches word for word; the policy's Denied is what stops it.
        expect(matches(command, [pattern])).toBe(true);
        for (const bypassApproval of [false, true]) {
          expect(
            KubectlPolicy.evaluateForAutoExecution({
              command,
              allowlistPatterns: [pattern],
              bypassApproval,
            }).verdict,
          ).toBe(AiRemediationCommandPolicyVerdict.Denied);
        }
      },
    );

    it("negative control: the same entry still promotes a JSON body that only changes replicas", () => {
      const command: string = `kubectl patch deployment web -n web -p '{"spec":{"replicas":3}}'`;
      const verdict: KubectlAutoExecutionVerdict = verdictFor(command, [
        "kubectl patch deployment web -n web -p *",
      ]);
      expect(verdict.verdict).toBe(
        AiRemediationCommandPolicyVerdict.AutoApproved,
      );
      expect(verdict.reason).toContain("allowlist");
    });

    it("never lifts a Denied command", () => {
      for (const [command, pattern] of [
        ["kubectl delete namespace web", "kubectl delete * *"],
        ["kubectl delete namespace web", "kubectl delete namespace web"],
        [
          "kubectl delete api-extensions -l app=x",
          "kubectl delete api-extensions -l *",
        ],
        [
          "kubectl create clusterrolebinding x --clusterrole=cluster-admin --serviceaccount=a:b",
          "kubectl create clusterrolebinding x --clusterrole=* --serviceaccount=*",
        ],
        ["kubectl get pods -n a -n b", "kubectl get pods -n * -n *"],
      ] as Array<[string, string]>) {
        expect(matches(command, [pattern])).toBe(true);
        expect(verdictFor(command, [pattern]).verdict).toBe(
          AiRemediationCommandPolicyVerdict.Denied,
        );
      }
    });

    it("never promotes a write in a protected namespace", () => {
      const command: string =
        "kubectl set image deployment/coredns coredns=x -n kube-system";
      const pattern: string =
        "kubectl set image deployment/coredns * -n kube-system";
      expect(matches(command, [pattern])).toBe(true);
      const verdict: KubectlAutoExecutionVerdict = verdictFor(command, [
        pattern,
      ]);
      expect(verdict.verdict).toBe(
        AiRemediationCommandPolicyVerdict.RequiresApproval,
      );
      expect(verdict.reason).toContain("kube-system");
    });

    it("is not consulted for Read and SafeWrite, which auto-approve anyway", () => {
      expect(verdictFor("kubectl get pods -n web", []).verdict).toBe(
        AiRemediationCommandPolicyVerdict.AutoApproved,
      );
      expect(
        verdictFor("kubectl rollout restart deployment/web -n web", []).reason,
      ).not.toContain("allowlist");
    });
  });

  describe("entry normalization", () => {
    const command: string = "kubectl drain node-1 --ignore-daemonsets";
    const pattern: string = "kubectl drain * --ignore-daemonsets";

    it("skips non-string and blank entries", () => {
      expect(
        matches(command, [
          42 as unknown as string,
          null as unknown as string,
          "",
          "   ",
          pattern,
        ]),
      ).toBe(true);
      expect(matches(command, ["", "   "])).toBe(false);
      expect(
        KubectlPolicy.matchesAllowlist({
          args: ["drain", "node-1", "--ignore-daemonsets"],
          allowlistPatterns: undefined as unknown as Array<string>,
        }),
      ).toBe(false);
    });

    it("reads only the first 100 entries", () => {
      const filler: Array<string> = Array.from(
        { length: 100 },
        (_value: unknown, index: number) => {
          return `kubectl cordon filler-${index}`;
        },
      );
      expect(matches(command, [...filler.slice(0, 99), pattern])).toBe(true);
      expect(matches(command, [...filler, pattern])).toBe(false);
    });

    it("ignores an entry longer than 500 characters", () => {
      const long: string = `${pattern}${" ".repeat(600)}`;
      expect(long.length).toBeGreaterThan(500);
      expect(matches(command, [long])).toBe(false);
      expect(matches(command, [`${pattern}   `])).toBe(true);
    });

    it("skips an entry that does not tokenize", () => {
      expect(matches(command, ["kubectl drain 'node-1", pattern])).toBe(true);
      expect(matches(command, ["kubectl drain 'node-1"])).toBe(false);
      expect(matches(command, ["kubectl"])).toBe(false);
    });

    it("matches nothing for an empty argv", () => {
      expect(
        KubectlPolicy.matchesAllowlist({ args: [], allowlistPatterns: ["*"] }),
      ).toBe(false);
    });

    /*
     * A lone `*` (or "kubectl *") used to match every one-word command. A
     * `*` where the verb goes is no longer a valid entry, and the matcher
     * skips every invalid entry, stored ones included.
     */
    it("skips a lone * — it stands for the verb, which an entry must write out", () => {
      for (const lone of ["*", "kubectl *", "**", "kubectl*"]) {
        expect(
          KubectlPolicy.describeAllowlistPatternProblem(lone),
        ).not.toBeNull();
        expect(matches("kubectl drain", [lone])).toBe(false);
        expect(matches("kubectl cordon", [lone])).toBe(false);
        expect(matches(command, [lone])).toBe(false);
      }
    });

    it("skips an entry written for the old whole-command glob", () => {
      const setImage: string =
        "kubectl set image deployment/web web=nginx:2 -n web";
      expect(matches(setImage, ["* set image deployment/web * -n web"])).toBe(
        false,
      );
      expect(matches(setImage, ["kubectl * deployment/web * -n web"])).toBe(
        false,
      );
      // The same shape with the verb written out matches.
      expect(matches(setImage, [SET_IMAGE_PATTERN])).toBe(true);
      expect(matches(setImage, ["set image deployment/web * -n web"])).toBe(
        true,
      );
    });
  });
});
