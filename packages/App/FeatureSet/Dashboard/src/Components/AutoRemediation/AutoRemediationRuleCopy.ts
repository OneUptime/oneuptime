import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationAction from "Common/Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationExecutionMode from "Common/Types/AutoRemediation/AutoRemediationExecutionMode";
import IconProp from "Common/Types/Icon/IconProp";
import type { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import type FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What an auto remediation rule's form and table say, React-free so the
 * table, its tests and the docs tests read these exact strings: the two
 * questions a rule asks besides its conditions - who fixes (Fix With) and
 * whether a fix waits for approval - and how the table names what a rule
 * fixes with, including the rules saved before Fix With existed.
 */

// The words the table uses for what a rule fixes with.
export const AUTO_REMEDIATION_FIX_WITH_TEXT: {
  oneUptimeAi: string;
  runbooks: string;
  runnerCommands: string;
  aiPickedRunbook: string;
} = {
  oneUptimeAi: translationKey("OneUptime AI"),
  runbooks: translationKey("Runbooks"),
  // Rules saved before rules were simplified.
  runnerCommands: translationKey("OneUptime AI: commands on Runners"),
  aiPickedRunbook: translationKey("OneUptime AI: picks a runbook"),
};

export const AUTO_REMEDIATION_APPROVAL_TEXT: {
  asksFirst: string;
  withoutAsking: string;
} = {
  asksFirst: translationKey("Asks first"),
  withoutAsking: translationKey("Without asking"),
};

export enum AutoRemediationFixWith {
  OneUptimeAi = "OneUptimeAi",
  Runbooks = "Runbooks",
  RunnerCommands = "RunnerCommands",
  AiPickedRunbook = "AiPickedRunbook",
}

/*
 * What a rule fixes with, as the engine reads it: its Fix With, except that
 * a rule saved with AI command composition or AI runbook picking (and so
 * marked OneUptime AI) keeps doing that.
 */
export function getAutoRemediationFixWith(
  rule: Pick<
    AutoRemediationRule,
    "remediationAction" | "aiComposesCommands" | "aiSelectsRunbook"
  >,
): AutoRemediationFixWith {
  if (rule.remediationAction === AutoRemediationAction.Runbooks) {
    return AutoRemediationFixWith.Runbooks;
  }

  if (rule.aiComposesCommands) {
    return AutoRemediationFixWith.RunnerCommands;
  }

  if (rule.aiSelectsRunbook) {
    return AutoRemediationFixWith.AiPickedRunbook;
  }

  return AutoRemediationFixWith.OneUptimeAi;
}

/*
 * Whether a rule's fixes wait for approval. A runbook OneUptime AI picks is
 * always proposed, never started, whatever the rule says.
 */
export function doesAutoRemediationRuleAskFirst(
  rule: Pick<
    AutoRemediationRule,
    | "remediationAction"
    | "aiComposesCommands"
    | "aiSelectsRunbook"
    | "executionMode"
  >,
): boolean {
  if (
    getAutoRemediationFixWith(rule) === AutoRemediationFixWith.AiPickedRunbook
  ) {
    return true;
  }

  return rule.executionMode !== AutoRemediationExecutionMode.FullAuto;
}

export const AUTO_REMEDIATION_FIX_WITH_OPTIONS: Array<CardSelectOption> = [
  {
    value: AutoRemediationAction.OneUptimeAI,
    title: translationKey("OneUptime AI"),
    description: translationKey(
      "OneUptime AI works out the fix and makes it through the AI agent on the Kubernetes cluster or host that is affected.",
    ),
    icon: IconProp.Sparkles,
  },
  {
    value: AutoRemediationAction.Runbooks,
    title: translationKey("Runbooks"),
    description: translationKey(
      "Run the runbooks you choose, the same way every time.",
    ),
    icon: IconProp.Book,
  },
];

export const AUTO_REMEDIATION_APPROVAL_OPTIONS: Array<CardSelectOption> = [
  {
    value: AutoRemediationExecutionMode.Suggest,
    title: translationKey("Ask before fixing"),
    description: translationKey(
      "Nothing runs until someone approves the fix with one click.",
    ),
    icon: IconProp.HandRaised,
  },
  {
    value: AutoRemediationExecutionMode.FullAuto,
    title: translationKey("Fix without asking"),
    description: translationKey(
      "Runbooks start right away, and OneUptime AI fixes without approval wherever the AI agent's settings allow it.",
    ),
    icon: IconProp.Bolt,
  },
];

// Whether the rule being edited runs runbooks, so it must name some.
export function isRunbooksFixWith(
  values: FormValues<AutoRemediationRule>,
): boolean {
  return (
    (values as { remediationAction?: unknown }).remediationAction ===
    AutoRemediationAction.Runbooks
  );
}
