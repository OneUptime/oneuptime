import AutoRemediationRule from "Common/Models/DatabaseModels/AutoRemediationRule";
import AutoRemediationAction from "Common/Types/AutoRemediation/AutoRemediationAction";
import AutoRemediationExecutionMode from "Common/Types/AutoRemediation/AutoRemediationExecutionMode";
import {
  AutoRemediationFixKind,
  getAutoRemediationFixKind,
  getRuleRunnerId,
} from "Common/Types/AutoRemediation/AutoRemediationFix";
import type FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  RULE_MCP_SERVERS_FIELD_COPY,
  hasRuleMcpServers,
} from "../ExternalMcpServer/ExternalMcpServerCopy";
import {
  RULE_CODE_REPOSITORIES_FIELD_COPY,
  hasRuleCodeRepositories,
} from "../Code/RuleCodeRepositoriesCopy";
import {
  AutomaticFixPullRequest,
  REMEDIATION_RULE_PULL_REQUEST_COLUMNS,
} from "Common/Types/AI/AutomaticFixPullRequests";

/*
 * What an AI rule's form and table say about fixing (AISettings/AiRuleCopy
 * says the rest), React-free so the table, its tests and the docs tests
 * read these exact strings.
 *
 * The maintainer, on the rule's Fix step: "Why should I pick between
 * OneUptime AI and Runbook? Can OneUptime AI do things by default, and I can
 * whitelist some Runbook for AI to pick and run? If I do not whitelist any
 * Runbook, it can basically run any Runbook by default." So the step asks
 * one question - don't fix, ask before fixing, or fix without asking
 * (AiRuleCopy's AI_RULE_FIX_OPTIONS) - and OneUptime AI fixes
 * (Common/Types/AutoRemediation/AutoRemediationFix).
 * What most people never change is folded under More fields: the runbooks
 * OneUptime AI may run (none picked: any), whether the rule runs them every
 * time instead, the Runner OneUptime AI runs the rule's Bash commands on,
 * the MCP servers and code repositories it may use (none picked: all), and
 * the two pull requests it opens after an investigation (both on). "Both of
 * these toggles should be inside of Remediation Rule, inside of More, and
 * they should be checked by default" - the maintainer, of the pull request
 * switches the AI settings page used to hold.
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

// What More fields holds, in the order it shows them.
export const AUTO_REMEDIATION_MORE_FIELDS_COPY: {
  runbooksTitle: string;
  runbooksDescription: string;
  runbooksPlaceholder: string;
  everyTimeTitle: string;
  everyTimeDescription: string;
  runnerTitle: string;
  runnerDescription: string;
  codeFixTitle: string;
  codeFixDescription: string;
  telemetryTitle: string;
  telemetryDescription: string;
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
  /*
   * The one line that says the AI agent on the affected cluster or host is
   * not a Runner choice: it is used whatever the rule picks. "Why does it
   * see an AI agent on the cluster or host? That doesn't make any sense" -
   * the maintainer, of the picker that listed it as a Runner. Not "inside
   * your network": a rule that picks none shows the Global Runner, and the
   * line under the picker says no Bash command runs there.
   */
  runnerDescription: translationKey(
    "Where OneUptime AI runs Bash commands for this rule. Commands on the affected cluster or host go through its AI agent.",
  ),
  // The two pull requests an investigation of a match can lead to: both on.
  codeFixTitle: translationKey("Fix pull requests"),
  codeFixDescription: translationKey(
    "When an investigation finds the cause in your code, OneUptime AI opens a pull request with the fix for review. Nothing is merged.",
  ),
  telemetryTitle: translationKey("Telemetry pull requests"),
  telemetryDescription: translationKey(
    "When missing logs, traces or metrics stop an investigation, OneUptime AI opens a pull request that adds them, for review.",
  ),
};

/*
 * What More fields' defaults do, under its folded line. A new rule keeps
 * them all - any runbook, every MCP server, every connected repository and
 * the pull requests opened in them - and that is said in one sentence: the
 * fold is the form's quietest line, and three sentences that each began
 * "OneUptime AI may" took more room than the fields they stood for. Once
 * some are set, one sentence for each default left as it is; nothing for
 * what is set: the line names it.
 */
export const AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES: {
  everythingAndPullRequests: string;
  everything: string;
  anyRunbook: string;
  allRepositoriesAndPullRequests: string;
  allRepositories: string;
} = {
  everythingAndPullRequests: translationKey(
    "OneUptime AI may use any of your runbooks, MCP servers and connected repositories, and open pull requests in them.",
  ),
  everything: translationKey(
    "OneUptime AI may use any of your runbooks, MCP servers and connected repositories.",
  ),
  anyRunbook: translationKey("OneUptime AI may run any of your runbooks."),
  allRepositoriesAndPullRequests: translationKey(
    "OneUptime AI may read all connected repositories, and open pull requests in them.",
  ),
  allRepositories: RULE_CODE_REPOSITORIES_FIELD_COPY.allRepositoriesSummary,
};

// The data-testids of the rule's two pull request switches.
export const AUTO_REMEDIATION_PULL_REQUEST_TEST_IDS: {
  codeFix: string;
  telemetry: string;
} = {
  codeFix: "auto-remediation-code-fix-pull-requests-field",
  telemetry: "auto-remediation-telemetry-pull-requests-field",
};

/*
 * Whether the rule being edited opens this pull request. A form that has
 * not read the switch - a new rule before its defaults are filled in -
 * reads as on, its column's default.
 */
export function doesEditedRuleOpenPullRequest(
  values: FormValues<AutoRemediationRule>,
  pullRequest: AutomaticFixPullRequest,
): boolean {
  const value: unknown = (values as Record<string, unknown>)[
    REMEDIATION_RULE_PULL_REQUEST_COLUMNS[pullRequest]
  ];

  return value !== false;
}

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
 * left do - any runbook, every MCP server, every connected repository and
 * the pull requests opened in them; one sentence while a rule keeps them
 * all, as a new rule does. A rule that runs its runbooks every time, or one
 * saved before rules were simplified, has no runbook or MCP default to
 * describe (its fields say what it does); the repositories and pull
 * requests are every rule's.
 */
export function getAutoRemediationMoreFieldsSummary(
  values: FormValues<AutoRemediationRule>,
): Array<string> | undefined {
  const isAiFix: boolean =
    !isRunbooksEveryTime(values) && !isOlderAutoRemediationRule(values);
  const isAnyRunbook: boolean = isAiFix && !hasRuleRunbooks(values);
  const isEveryMcpServer: boolean = isAiFix && !hasRuleMcpServers(values);
  const isEveryRepository: boolean = !hasRuleCodeRepositories(values);
  const opensPullRequests: boolean =
    doesEditedRuleOpenPullRequest(values, AutomaticFixPullRequest.CodeFix) ||
    doesEditedRuleOpenPullRequest(
      values,
      AutomaticFixPullRequest.MissingTelemetry,
    );

  // Every default kept, as a new rule does: one sentence says it.
  if (isAnyRunbook && isEveryMcpServer && isEveryRepository) {
    return [
      opensPullRequests
        ? AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES.everythingAndPullRequests
        : AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES.everything,
    ];
  }

  const sentences: Array<string> = [];

  if (isAnyRunbook) {
    sentences.push(AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES.anyRunbook);
  }

  if (isEveryMcpServer) {
    sentences.push(RULE_MCP_SERVERS_FIELD_COPY.allServersSummary);
  }

  if (isEveryRepository) {
    sentences.push(
      opensPullRequests
        ? AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES.allRepositoriesAndPullRequests
        : AUTO_REMEDIATION_MORE_FIELDS_SUMMARIES.allRepositories,
    );
  }

  return sentences.length > 0 ? sentences : undefined;
}
