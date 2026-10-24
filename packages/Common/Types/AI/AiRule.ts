import AutoRemediationExecutionMode from "../AutoRemediation/AutoRemediationExecutionMode";

/*
 * AN AI RULE: WHAT ONEUPTIME AI DOES WITH THE NEW INCIDENTS (OR ALERTS) IT
 * MATCHES - the one reading, for the rule engines, the rule service, the
 * migration's tests and the dashboard alike.
 *
 * Incidents and alerts used to have two kinds of rule with the same
 * conditions: investigation rules (which ones OneUptime AI investigates)
 * and auto remediation rules (which ones it fixes, and how). The
 * maintainer: "Should incident investigation rule and remediation rule be
 * the same entity ... Since its not possible to remediate without
 * investigation." They are one now: an AI rule says, once, which incidents
 * it matches, when OneUptime AI investigates them, and whether - and how -
 * it fixes them. It is stored in the table the auto remediation rules had
 * (AutoRemediationRule), so their ids, their fixes' history, their API
 * route and their permissions carry on; the investigation rules moved into
 * it (MergeInvestigationRulesIntoAiRules).
 *
 * A rule does one or both of:
 *
 *   - investigates (`investigates`): matching it puts an incident in
 *     OneUptime AI's investigation scope, right away or after the rule's
 *     wait (onlyIfOpenAfterMinutes). Every rule made on the dashboard does.
 *   - fixes (`fixes`): matching it has OneUptime AI fix the incident, asking
 *     first or not (executionMode), with what the rule allows. Off: it only
 *     investigates ("Don't fix").
 *
 * Which incidents are investigated, and which are fixed:
 *
 *   - with no enabled rule, every new incident is investigated (while
 *     "Investigate new incidents" is on) and every one is fixed (while "Fix
 *     new incidents automatically" is on) - nothing changed there;
 *   - with enabled rules, an incident is fixed only when it matches a rule
 *     that fixes, each such rule acting as it says; one that matches only
 *     rules that don't fix is investigated and not fixed;
 *   - an incident is investigated when it matches a rule that investigates
 *     - or, while no enabled rule investigates, whatever it matches.
 *
 * That last line is for the one kind of rule that only fixes: a rule set
 * up as an auto remediation rule before rules were merged, where no
 * investigation rule decided the same incidents, and one an API or
 * Terraform client written before the merge creates (it says nothing about
 * investigating, and `investigates` defaults to off). Such a rule never
 * decided which incidents are investigated, and still does not: OneUptime
 * AI investigates its matches when another rule does, or when no rule
 * investigates at all - exactly what happened to them before. Its form
 * says so, and "Investigate too" makes it a rule like every other.
 *
 * A rule that does neither does nothing, and would still narrow what is
 * fixed: it is refused (getAiRuleShapeProblem).
 */

// What a rule says about what it does, as stored or as a write sends it.
export interface AiRuleShapeFacts {
  investigates?: unknown;
  fixes?: unknown;
}

/*
 * Whether matching the rule puts an incident in the investigation scope.
 * Strictly === true: the column is NOT NULL DEFAULT false, so a value that
 * was not read never widens - or narrows - what is investigated.
 */
export function doesAiRuleInvestigate(rule: AiRuleShapeFacts): boolean {
  return rule.investigates === true;
}

/*
 * Whether the rule fixes what it matches. !== false: the column is NOT NULL
 * DEFAULT true - every auto remediation rule fixed - so only a rule saved
 * as one that does not fix is read as one.
 */
export function doesAiRuleFix(rule: AiRuleShapeFacts): boolean {
  return rule.fixes !== false;
}

// The rules, of those given, whose matches OneUptime AI investigates.
export function getInvestigatingAiRules<TRule extends AiRuleShapeFacts>(
  rules: ReadonlyArray<TRule>,
): Array<TRule> {
  return rules.filter(doesAiRuleInvestigate);
}

// The rules, of those given, whose matches OneUptime AI fixes.
export function getFixingAiRules<TRule extends AiRuleShapeFacts>(
  rules: ReadonlyArray<TRule>,
): Array<TRule> {
  return rules.filter(doesAiRuleFix);
}

/*
 * Why a rule cannot be saved like this, or null when it can: it must
 * investigate, fix, or both. Only what the write says is judged - a field
 * it leaves out keeps (or takes) the column's value, which the caller
 * passes in when it knows it.
 */
export const AI_RULE_DOES_NOTHING_MESSAGE: string =
  "An AI rule must investigate what it matches, fix it, or both. Turn investigating or fixing on.";

export function getAiRuleShapeProblem(rule: AiRuleShapeFacts): string | null {
  if (
    rule.investigates !== undefined &&
    typeof rule.investigates !== "boolean"
  ) {
    return "Investigates must be true or false.";
  }

  if (rule.fixes !== undefined && typeof rule.fixes !== "boolean") {
    return "Fixes must be true or false.";
  }

  if (!doesAiRuleInvestigate(rule) && !doesAiRuleFix(rule)) {
    return AI_RULE_DOES_NOTHING_MESSAGE;
  }

  return null;
}

/*
 * The rule form's one Fix question: whether OneUptime AI fixes what the
 * rule matches, and whether a fix waits for approval. Drawn as three
 * answers; stored as two columns (fixes, executionMode), so an API client
 * that knows only executionMode reads every rule the way it always did.
 */
export enum AiRuleFix {
  // fixes = false: OneUptime AI investigates and posts what it finds.
  DoNotFix = "DoNotFix",
  // fixes = true, executionMode Suggest: every fix waits for approval.
  AskFirst = "AskFirst",
  // fixes = true, executionMode FullAuto.
  WithoutAsking = "WithoutAsking",
}

export const AI_RULE_FIXES: ReadonlyArray<AiRuleFix> = [
  AiRuleFix.DoNotFix,
  AiRuleFix.AskFirst,
  AiRuleFix.WithoutAsking,
];

export function isAiRuleFix(value: unknown): value is AiRuleFix {
  return (
    typeof value === "string" &&
    (AI_RULE_FIXES as ReadonlyArray<string>).includes(value)
  );
}

// The answer a rule's columns give.
export function getAiRuleFix(rule: {
  fixes?: unknown;
  executionMode?: unknown;
}): AiRuleFix {
  if (!doesAiRuleFix(rule)) {
    return AiRuleFix.DoNotFix;
  }

  return rule.executionMode === AutoRemediationExecutionMode.FullAuto
    ? AiRuleFix.WithoutAsking
    : AiRuleFix.AskFirst;
}

/*
 * The columns an answer writes. "Don't fix" leaves the execution mode as it
 * is, so turning fixing back on asks the way the rule did before.
 */
export function getAiRuleFixColumns(
  fix: AiRuleFix,
  currentExecutionMode?: unknown,
): { fixes: boolean; executionMode: AutoRemediationExecutionMode } {
  if (fix === AiRuleFix.DoNotFix) {
    return {
      fixes: false,
      executionMode:
        currentExecutionMode === AutoRemediationExecutionMode.FullAuto
          ? AutoRemediationExecutionMode.FullAuto
          : AutoRemediationExecutionMode.Suggest,
    };
  }

  return {
    fixes: true,
    executionMode:
      fix === AiRuleFix.WithoutAsking
        ? AutoRemediationExecutionMode.FullAuto
        : AutoRemediationExecutionMode.Suggest,
  };
}
