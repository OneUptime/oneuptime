import { describe, expect, test } from "@jest/globals";
import { RuleFromSentenceEvalCase } from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityEvalCase";
import { PaperworkEvalScore } from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityPaperworkEval";
import { scoreRuleDraft } from "../../../../../../Server/Utils/AI/Eval/DataSecurity/DataSecurityRuleDraftEval";
import { DataSecurityAiFeature } from "../../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import { DataSecurityRuleKind } from "../../../../../../Types/DataSecurity/DataSecurityRuleDraft";
import { JSONObject } from "../../../../../../Types/JSON";
import RulePatternMatchUtil from "../../../../../../Utils/Rules/RulePatternMatchUtil";

/*
 * A RULE FROM A SENTENCE, SCORED AS THE RULES READ IT (#10378).
 *
 * The eval says whether a drafted owner or label rule's name pattern matches
 * the stores its case names. It reads the pattern as the rules do
 * (RulePatternMatchUtil, linear time, case-insensitive), so it never passes
 * a draft the rules would match differently, and a model's pattern cannot
 * keep it running.
 */

const STORES: ReadonlyArray<string> = [
  "payments-ledger",
  "Payments-DB-Replica",
  "legacy-payments-archive",
  "paypay-ledger",
  "orders-db",
];

function ownerCase(
  stores: Partial<
    Pick<
      RuleFromSentenceEvalCase["expect"],
      "matchesStoreNames" | "missesStoreNames"
    >
  >,
): RuleFromSentenceEvalCase {
  return {
    id: "test-owner-payments",
    title: "The payments team owns the payments stores",
    feature: DataSecurityAiFeature.DraftRuleFromSentence,
    sentence: "The payments team owns every store named payments-",
    labels: [],
    teams: ["Payments"],
    expect: {
      kind: DataSecurityRuleKind.Owner,
      owners: ["Payments"],
      ...stores,
    },
  };
}

// The model's answer: an owner rule with this name pattern.
function ownerAnswer(nameRegexPattern: string): string {
  const rule: JSONObject = {
    kind: DataSecurityRuleKind.Owner,
    name: "Payments stores",
    nameRegexPattern,
    owners: ["Payments"],
  };

  return JSON.stringify({ rule, reason: "The sentence names the team." });
}

describe("a rule drafted from a sentence, scored", () => {
  test("matches a store's name as the rules do, whatever its case", () => {
    const score: PaperworkEvalScore = scoreRuleDraft(
      ownerCase({
        matchesStoreNames: ["payments-ledger", "Payments-DB-Replica"],
        missesStoreNames: ["legacy-payments-archive", "orders-db"],
      }),
      ownerAnswer("^payments-"),
    );

    expect(score).toEqual({ passed: true, notes: [] });
  });

  test("agrees with the rules on every store, for each pattern", () => {
    for (const pattern of ["^payments-", "ledger$", "PAYMENTS", "^(pay)+"]) {
      const matched: Array<string> = STORES.filter((name: string): boolean => {
        return RulePatternMatchUtil.testRegex(pattern, name);
      });
      const missed: Array<string> = STORES.filter((name: string): boolean => {
        return !matched.includes(name);
      });

      expect({
        pattern,
        score: scoreRuleDraft(
          ownerCase({ matchesStoreNames: matched, missesStoreNames: missed }),
          ownerAnswer(pattern),
        ),
      }).toEqual({ pattern, score: { passed: true, notes: [] } });
    }
  });

  test("a pattern the rules cannot run matches no store, as on a store", () => {
    // A backreference: a backtracking engine reads "paypay-" with it.
    const score: PaperworkEvalScore = scoreRuleDraft(
      ownerCase({ matchesStoreNames: ["paypay-ledger"] }),
      ownerAnswer("^(pay)\\1-"),
    );

    expect(score.passed).toBe(false);
    expect(score.notes).toContain("does not match the store paypay-ledger");
  });
});
