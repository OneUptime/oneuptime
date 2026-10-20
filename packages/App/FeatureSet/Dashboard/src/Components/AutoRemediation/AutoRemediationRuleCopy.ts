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
import {
  RULE_MCP_SERVERS_FIELD_COPY,
  hasRuleMcpServers,
} from "../ExternalMcpServer/ExternalMcpServerCopy";

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

/*
 * What the table's Fix column says of a rule beside whether it asks first,
 * for a rule that does not fix the way every new rule does: one that runs
 * its runbooks every time, or one saved before rules were simplified. A
 * rule OneUptime AI fixes says nothing more - "OneUptime AI" on every row
 * would tell a reader nothing.
 */
export const AUTO_REMEDIATION_FIX_WITH_TEXT: {
  runbooks: string;
  runnerCommands: string;
  aiPickedRunbook: string;
} = {
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

const FIX_WITH_TEXT: Record<AutoRemediationFixWith, string | null> = {
  [AutoRemediationFixWith.OneUptimeAi]: null,
  [AutoRemediationFixWith.Runbooks]: AUTO_REMEDIATION_FIX_WITH_TEXT.runbooks,
  [AutoRemediationFixWith.RunnerCommands]:
    AUTO_REMEDIATION_FIX_WITH_TEXT.runnerCommands,
  [AutoRemediationFixWith.AiPickedRunbook]:
    AUTO_REMEDIATION_FIX_WITH_TEXT.aiPickedRunbook,
};

/*
 * What the Fix column says after whether a rule asks first: how it fixes,
 * for a rule that does not fix the way every new rule does - or null.
 */
export function getAutoRemediationFixWithText(
  rule: Pick<
    AutoRemediationRule,
    "remediationAction" | "aiComposesCommands" | "aiSelectsRunbook"
  >,
): string | null {
  return FIX_WITH_TEXT[getAutoRemediationFixWith(rule)];
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
    /*
     * Said whatever More fields holds: with no runbook picked, a runbook
     * OneUptime AI picks from any of them still waits for approval
     * (AutoRemediationFix.mayAiPickedRunbookStartWithoutAsking), and with
     * no MCP server picked, every change through one waits too
     * (McpRemediationRunner).
     */
    description: translationKey(
      "OneUptime AI fixes on its own where the AI agent's settings allow it, and with the runbooks and MCP servers you pick under More fields.",
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
 * How the rule being edited fixes, read from the form the way the engine
 * reads a saved rule (getAutoRemediationFixKind). The form keeps the two
 * flags a rule saved before rules were simplified holds (they are never
 * drawn), so an edit knows such a rule; a new rule holds neither.
 */
export function getEditedRuleFixKind(
  values: FormValues<AutoRemediationRule>,
): AutoRemediationFixKind {
  const facts: {
    remediationAction?: unknown;
    aiComposesCommands?: unknown;
    aiSelectsRunbook?: unknown;
  } = values as {
    remediationAction?: unknown;
    aiComposesCommands?: unknown;
    aiSelectsRunbook?: unknown;
  };

  return getAutoRemediationFixKind({
    remediationAction:
      typeof facts.remediationAction === "string"
        ? facts.remediationAction
        : undefined,
    aiComposesCommands: facts.aiComposesCommands === true,
    aiSelectsRunbook: facts.aiSelectsRunbook === true,
  });
}

/*
 * Whether the rule being edited was saved before rules were simplified, and
 * still has OneUptime AI do only what it did then: compose commands on its
 * Runners, or pick one of its runbooks.
 */
export function isOlderAutoRemediationRule(
  values: FormValues<AutoRemediationRule>,
): boolean {
  const kind: AutoRemediationFixKind = getEditedRuleFixKind(values);

  return (
    kind === AutoRemediationFixKind.CommandsOnRunners ||
    kind === AutoRemediationFixKind.AiPicksRunbook
  );
}

/*
 * The note at the top of an older rule's Fix step: what the rule does, in
 * place of the fields that do nothing for it, and the one way to make it fix
 * like a new rule (getValuesFixingLikeANewRule).
 */
export const AUTO_REMEDIATION_OLDER_RULE_COPY: {
  commandsOnRunners: string;
  picksRunbook: string;
  fixLikeANewRule: string;
} = {
  commandsOnRunners: translationKey(
    "This older rule only has OneUptime AI run commands on its Runners.",
  ),
  picksRunbook: translationKey(
    "This older rule only has OneUptime AI pick one of its runbooks, and always asks first.",
  ),
  fixLikeANewRule: translationKey("Fix like a new rule"),
};

// What the older rule being edited does, as its note says it; null for any other.
export function getOlderAutoRemediationRuleText(
  values: FormValues<AutoRemediationRule>,
): string | null {
  switch (getEditedRuleFixKind(values)) {
    case AutoRemediationFixKind.CommandsOnRunners:
      return AUTO_REMEDIATION_OLDER_RULE_COPY.commandsOnRunners;
    case AutoRemediationFixKind.AiPicksRunbook:
      return AUTO_REMEDIATION_OLDER_RULE_COPY.picksRunbook;
    default:
      return null;
  }
}

/*
 * "Fix like a new rule": the older rule's two flags off, so OneUptime AI
 * fixes what it matches the way every new rule does - through the AI agent,
 * with a runbook, and with commands on the rule's Runner. It asks before
 * fixing until someone says otherwise: it does more than it did, so nothing
 * of that runs without approval because of this switch alone (and a rule
 * that picks a runbook always asked).
 */
export function getValuesFixingLikeANewRule(
  values: FormValues<AutoRemediationRule>,
): FormValues<AutoRemediationRule> {
  return {
    ...values,
    aiComposesCommands: false,
    aiSelectsRunbook: false,
    executionMode: AutoRemediationExecutionMode.Suggest,
  } as FormValues<AutoRemediationRule>;
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
 * The sentences under More fields while it is folded: what the defaults
 * left do - the runbooks and the Runner in one, then the MCP servers. A
 * rule that runs its runbooks every time has none of the defaults.
 */
export function getAutoRemediationMoreFieldsSummary(
  values: FormValues<AutoRemediationRule>,
): Array<string> | undefined {
  // Neither has the defaults the line describes: their fields say what is set.
  if (isRunbooksEveryTime(values) || isOlderAutoRemediationRule(values)) {
    return undefined;
  }

  const sentences: Array<string> = [];
  const isAnyRunbook: boolean = !hasRuleRunbooks(values);
  const isAgentsOnly: boolean = !hasRuleRunner(values);

  if (isAnyRunbook && isAgentsOnly) {
    sentences.push(AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES.anyRunbookAndAgents);
  } else if (isAnyRunbook) {
    sentences.push(AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES.anyRunbook);
  } else if (isAgentsOnly) {
    sentences.push(AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES.agents);
  }

  if (!hasRuleMcpServers(values)) {
    sentences.push(RULE_MCP_SERVERS_FIELD_COPY.allServersSummary);
  }

  return sentences.length > 0 ? sentences : undefined;
}
