import DataCategory, {
  ALL_DATA_CATEGORIES,
} from "../../../../../Types/DataSecurity/DataCategory";
import { getKnownCloudRegions } from "../../../../../Types/DataSecurity/CloudRegionCountry";
import { regionMatches } from "../../../../../Types/DataSecurity/DataSecurityResidency";
import {
  DataSecurityRuleDraft,
  getDataSecurityRuleDraftProblem,
} from "../../../../../Types/DataSecurity/DataSecurityRuleDraft";
import { buildRuleFromSentencePrompt } from "../../DataSecurity/DataSecurityAiInput";
import {
  readRuleDraftAnswer,
  RULE_FROM_SENTENCE_SYSTEM_PROMPT,
  RuleDraftAnswer,
} from "../../DataSecurity/RuleDraftPrompt";
import {
  getRuleDraftPatternProblem,
  RULE_DRAFT_MAX_COMPLETION_TOKENS,
} from "../../DataSecurity/RuleFromSentence";
import { RuleFromSentenceEvalCase } from "./DataSecurityEvalCase";
import {
  PaperworkEvalCall,
  PaperworkEvalScore,
} from "./DataSecurityPaperworkEval";

/*
 * A RULE FROM A SENTENCE, SCORED (#10378).
 *
 * The eval asks as Ask AI's and the MCP server's draft_data_security_rule
 * ships (RuleFromSentence): the same builder, the same words, OneUptime's
 * own catalogs of data categories and cloud regions, and the project's
 * labels and teams by name - and reads the answer the way the draft does,
 * held to the same checks before anyone sees it. A right draft is the
 * rule the sentence asks for: its kind, the regions it allows and refuses,
 * what its name pattern matches and misses, and who and what it names. A
 * sentence that holds no rule must draft none: a rule nobody asked for is
 * the worse mistake, though the person still approves it before it saves.
 */

function sameName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function ruleDraftCall(
  testCase: RuleFromSentenceEvalCase,
): PaperworkEvalCall {
  return {
    messages: buildRuleFromSentencePrompt({
      instructions: RULE_FROM_SENTENCE_SYSTEM_PROMPT,
      sentence: testCase.sentence,
      dataCategories: ALL_DATA_CATEGORIES,
      regions: getKnownCloudRegions(),
      labels: testCase.labels,
      teams: testCase.teams,
    }).messages,
    maxTokens: RULE_DRAFT_MAX_COMPLETION_TOKENS,
    temperature: 0,
  };
}

// Whether a name pattern matches a store's name, as the owner and label rules read it.
function nameMatches(draft: DataSecurityRuleDraft, name: string): boolean {
  if (!draft.nameRegexPattern) {
    // No name condition: every store's name matches.
    return true;
  }

  try {
    return new RegExp(draft.nameRegexPattern, "i").test(name);
  } catch {
    return false;
  }
}

export function scoreRuleDraft(
  testCase: RuleFromSentenceEvalCase,
  answer: string,
): PaperworkEvalScore {
  const read: RuleDraftAnswer | null = readRuleDraftAnswer(answer);

  if (!read) {
    return { passed: false, notes: ["not the answer asked for"] };
  }

  if (testCase.expect.kind === null) {
    return read.kind === "none"
      ? { passed: true, notes: [] }
      : {
          passed: false,
          notes: ["drafted a rule from a sentence that asks for none"],
        };
  }

  if (read.kind === "none") {
    return { passed: false, notes: ["found no rule in the sentence"] };
  }

  const draft: DataSecurityRuleDraft = read.draft;
  const expected: RuleFromSentenceEvalCase["expect"] = testCase.expect;
  const notes: Array<string> = [];

  if (draft.kind !== expected.kind) {
    notes.push(`a ${draft.kind} rule, not a ${expected.kind} rule`);
  }

  const problem: string | null =
    getDataSecurityRuleDraftProblem(draft) || getRuleDraftPatternProblem(draft);

  if (problem) {
    notes.push(problem);
  }

  for (const region of expected.allowsRegions || []) {
    if (
      !draft.allowedRegions.some((pattern: string): boolean => {
        return regionMatches(pattern, region);
      })
    ) {
      notes.push(`does not allow ${region}`);
    }
  }

  for (const region of expected.refusesRegions || []) {
    if (
      draft.allowedRegions.some((pattern: string): boolean => {
        return regionMatches(pattern, region);
      })
    ) {
      notes.push(`allows ${region}`);
    }
  }

  for (const category of expected.dataCategories || []) {
    if (!draft.dataCategories.includes(category as DataCategory)) {
      notes.push(`does not name ${category}`);
    }
  }

  for (const country of expected.subjectCountries || []) {
    if (!draft.subjectCountries.includes(country)) {
      notes.push(`is not about people in ${country}`);
    }
  }

  for (const name of expected.matchesStoreNames || []) {
    if (!nameMatches(draft, name)) {
      notes.push(`does not match the store ${name}`);
    }
  }

  for (const name of expected.missesStoreNames || []) {
    if (nameMatches(draft, name)) {
      notes.push(`matches the store ${name}`);
    }
  }

  for (const owner of expected.owners || []) {
    if (
      !draft.owners.some((named: string): boolean => {
        return sameName(named, owner);
      })
    ) {
      notes.push(`does not name ${owner} as an owner`);
    }
  }

  for (const label of expected.labelsToAdd || []) {
    if (
      !draft.labelsToAdd.some((named: string): boolean => {
        return sameName(named, label);
      })
    ) {
      notes.push(`does not add the label ${label}`);
    }
  }

  return { passed: notes.length === 0, notes };
}
