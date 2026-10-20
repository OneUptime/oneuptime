import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationAction from "Common/Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationExecutionMode from "Common/Types/AutoRemediation/AutoRemediationExecutionMode";
import {
  AutoRemediationFixKind,
  getAutoRemediationFixKind,
  getRuleRunnerId,
} from "Common/Types/AutoRemediation/AutoRemediationFix";
import IconProp from "Common/Types/Icon/IconProp";
import type { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import type FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What an auto remediation rule's form and table say, React-free so the
 * table, its tests and the docs tests read these exact strings.
 *
 * The maintainer, on the rule's Fix step: "Why should I pick between
 * OneUptime AI and Runbook? Can OneUptime AI do things by default, and I can
 * whitelist some Runbook for AI to pick and run? If I do not whitelist any
 * Runbook, it can basically run any Runbook by default." So the step asks
 * one question - whether a fix waits for someone to approve it - and
 * OneUptime AI fixes (Common/Types/AutoRemediation/AutoRemediationFix).
 * What most people never change is folded under More fields: the runbooks
 * OneUptime AI may run (none picked: any), whether the rule runs them every
 * time instead, and the Runner OneUptime AI runs the rule's commands on.
 */

// What the table says a rule is fixed by.
export const AUTO_REMEDIATION_FIX_WITH_TEXT: {
  oneUptimeAi: string;
  runbooks: string;
  runnerCommands: string;
  aiPickedRunbook: string;
} = {
  oneUptimeAi: translationKey("OneUptime AI"),
  // A rule that runs its runbooks every time, without OneUptime AI deciding.
  runbooks: translationKey("Its runbooks, every time"),
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

const FIX_WITH_BY_KIND: Record<AutoRemediationFixKind, AutoRemediationFixWith> =
  {
    [AutoRemediationFixKind.OneUptimeAi]: AutoRemediationFixWith.OneUptimeAi,
    [AutoRemediationFixKind.RunbooksEveryTime]: AutoRemediationFixWith.Runbooks,
    [AutoRemediationFixKind.CommandsOnRunners]:
      AutoRemediationFixWith.RunnerCommands,
    [AutoRemediationFixKind.AiPicksRunbook]:
      AutoRemediationFixWith.AiPickedRunbook,
  };

/*
 * What a rule is fixed by, as the engine reads it: OneUptime AI, or its
 * runbooks every time - except that a rule saved with AI command
 * composition or AI runbook picking (and so marked OneUptime AI) keeps
 * doing only that.
 */
export function getAutoRemediationFixWith(
  rule: Pick<
    AutoRemediationRule,
    "remediationAction" | "aiComposesCommands" | "aiSelectsRunbook"
  >,
): AutoRemediationFixWith {
  return FIX_WITH_BY_KIND[getAutoRemediationFixKind(rule)];
}

/*
 * Whether a rule's fixes wait for approval. A runbook a rule saved before
 * rules were simplified has OneUptime AI pick is always proposed, never
 * started, whatever the rule says.
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

// The Fix step's one question, and its answers.
export const AUTO_REMEDIATION_APPROVAL_FIELD_COPY: {
  title: string;
  description: string;
} = {
  title: translationKey("Approval"),
  description: translationKey(
    "OneUptime AI works out each fix. Choose whether it waits for someone to approve it.",
  ),
};

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
      "OneUptime AI fixes right away where the AI agent's settings allow it, and starts the runbooks you picked.",
    ),
    icon: IconProp.Bolt,
  },
];

// What More fields holds, in the order it shows them.
export const AUTO_REMEDIATION_MORE_FIELDS_COPY: {
  runbooksTitle: string;
  runbooksDescription: string;
  runbooksPlaceholder: string;
  everyTimeTitle: string;
  everyTimeDescription: string;
  runnerTitle: string;
  runnerDescription: string;
} = {
  runbooksTitle: translationKey("Runbooks"),
  runbooksDescription: translationKey(
    "OneUptime AI may run any of your runbooks. Pick some to let it run only those.",
  ),
  runbooksPlaceholder: translationKey("Any runbook"),
  everyTimeTitle: translationKey("Run them every time"),
  everyTimeDescription: translationKey(
    "Start every runbook above for every match, instead of OneUptime AI deciding.",
  ),
  runnerTitle: translationKey("Runner"),
  runnerDescription: translationKey(
    "Where OneUptime AI runs commands of its own for this rule, inside your network.",
  ),
};

/*
 * What More fields' defaults do, under its folded line: one sentence for
 * what is not set. Nothing when both are set - the line names them.
 */
export const AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES: {
  anyRunbookAndAgents: string;
  anyRunbook: string;
  agents: string;
} = {
  anyRunbookAndAgents: translationKey(
    "OneUptime AI may run any of your runbooks, and fixes through the AI agent on the affected cluster or host.",
  ),
  anyRunbook: translationKey("OneUptime AI may run any of your runbooks."),
  agents: translationKey(
    "OneUptime AI fixes through the AI agent on the affected cluster or host.",
  ),
};

/*
 * Whether the rule being edited runs its runbooks every time, without
 * OneUptime AI deciding - so it must name some, and has no Runner.
 */
export function isRunbooksEveryTime(
  values: FormValues<AutoRemediationRule>,
): boolean {
  return (
    (values as { remediationAction?: unknown }).remediationAction ===
    AutoRemediationAction.Runbooks
  );
}

/*
 * Whether the rule being edited names runbooks: rows, ids, or the
 * { value, label } options the dropdown holds them as.
 */
export function hasRuleRunbooks(
  values: FormValues<AutoRemediationRule>,
): boolean {
  const runbooks: unknown = (values as { runbooks?: unknown }).runbooks;

  return Array.isArray(runbooks) && runbooks.length > 0;
}

// Whether the rule being edited picks a Runner for OneUptime AI's commands.
export function hasRuleRunner(
  values: FormValues<AutoRemediationRule>,
): boolean {
  return Boolean(getRuleRunnerId(values as { runnerId?: unknown }));
}

/*
 * The sentence under More fields while it is folded: what the defaults left
 * do. A rule that runs its runbooks every time has neither default.
 */
export function getAutoRemediationMoreFieldsSummary(
  values: FormValues<AutoRemediationRule>,
): Array<string> | undefined {
  if (isRunbooksEveryTime(values)) {
    return undefined;
  }

  const isAnyRunbook: boolean = !hasRuleRunbooks(values);
  const isAgentsOnly: boolean = !hasRuleRunner(values);

  if (isAnyRunbook && isAgentsOnly) {
    return [AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES.anyRunbookAndAgents];
  }

  if (isAnyRunbook) {
    return [AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES.anyRunbook];
  }

  if (isAgentsOnly) {
    return [AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES.agents];
  }

  return undefined;
}
