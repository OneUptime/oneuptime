import AutoRemediationSuggestion from "Common/Models/DatabaseModels/AutoRemediationSuggestion";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
} from "Common/Types/AutoRemediation/AiRemediationCommandPlan";
import {
  AutoRemediationDecisionEntry,
  AutoRemediationDecisionReason,
} from "Common/Types/AutoRemediation/AutoRemediationDecision";
import { isProjectRunbookPick } from "Common/Types/AutoRemediation/AutoRemediationFix";
import AutoRemediationSuggestionType from "Common/Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  getRemediationRoundResourceNoun,
  parseClusterRoundName,
  parseResourceRoundName,
  ParsedRoundName,
} from "Common/Types/AutoRemediation/RemediationRoundName";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import {
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * A FIX'S NAME AND WHERE IT CAME FROM, IN PLAIN WORDS (issue #6860).
 *
 * A fix on the Remediation step was headed by the engine's names for it:
 * "AI kubectl fix" over 'AI remediation for cluster "oneuptime-test"', "No
 * runbook" over "Rule: All alerts" - "AI" twice, "kubectl" and
 * "remediation" for the same thing, and a runbook fix named for the runbook
 * it did not find. Now a fix is named for what it is and where it works -
 * 'Fix on cluster "oneuptime-test"', 'Fix on Docker host "web-1"', "Fix
 * through MCP servers", 'Runbook "Restart checkout"' - and the line under
 * it says why OneUptime AI tried it: 'From AI rule "All alerts"', or "From
 * OneUptime AI" when no rule is set up and the project fixes everything it
 * may.
 *
 * A cluster's or resource's round carries no rule of its own: the rule
 * that matched is in the decision OneUptime AI wrote down for the record
 * (getRemediationRoundRuleName), the same rule its lines named.
 *
 * React-free, so App's tests can read it; RemediationStep draws it.
 */

export const REMEDIATION_FIX_TITLE_COPY: {
  cluster: string;
  clusterRound: string;
  anyCluster: string;
  resource: string;
  resourceRound: string;
  anyResource: string;
  commands: string;
  mcp: string;
  runbook: string;
  anyRunbook: string;
} = {
  cluster: translationKey('Fix on cluster "{{name}}"'),
  clusterRound: translationKey('Fix on cluster "{{name}}" (round {{round}})'),
  anyCluster: translationKey("Fix on a Kubernetes cluster"),
  resource: translationKey('Fix on {{kind}} "{{name}}"'),
  resourceRound: translationKey('Fix on {{kind}} "{{name}}" (round {{round}})'),
  anyResource: translationKey("Fix on your infrastructure"),
  commands: translationKey("Fix with commands"),
  mcp: translationKey("Fix through MCP servers"),
  runbook: translationKey('Runbook "{{name}}"'),
  anyRunbook: translationKey("Runbook"),
};

export const REMEDIATION_FIX_SOURCE_COPY: {
  rule: string;
  oneUptimeAi: string;
} = {
  rule: translationKey('From AI rule "{{name}}"'),
  oneUptimeAi: translationKey("From OneUptime AI"),
};

export type RemediationFixHeaderSuggestion = Pick<
  AutoRemediationSuggestion,
  | "suggestionType"
  | "commandPlan"
  | "ruleNameSnapshot"
  | "autoRemediationRuleId"
  | "runbookNameSnapshot"
  | "kubernetesClusterId"
  | "resourceId"
  | "resourceType"
>;

// What says a fix is a cluster's or a resource's round.
export type RemediationRoundFixFacts = Pick<
  AutoRemediationSuggestion,
  | "kubernetesClusterId"
  | "resourceId"
  | "autoRemediationRuleId"
  | "ruleNameSnapshot"
>;

/*
 * A cluster round's name read back - also of a round whose cluster was
 * deleted since, where its name is all that is left - or null for a rule's
 * fix named like one.
 */
function getClusterRoundName(
  suggestion: RemediationRoundFixFacts,
): ParsedRoundName | null {
  if (!suggestion.kubernetesClusterId && suggestion.autoRemediationRuleId) {
    return null;
  }

  return parseClusterRoundName(suggestion.ruleNameSnapshot);
}

/*
 * Whether the fix is a round OneUptime AI ran on a cluster or a resource
 * (AutoRemediationRuleEngineService's cluster and resource lanes): one with
 * a cluster or a resource, or one whose deleted cluster left only its name.
 */
export function isRemediationRoundFix(
  suggestion: RemediationRoundFixFacts,
): boolean {
  return Boolean(
    suggestion.kubernetesClusterId ||
      suggestion.resourceId ||
      (!suggestion.autoRemediationRuleId && getClusterRoundName(suggestion)),
  );
}

// Each name once, in order; an empty one is left out.
function distinct(names: Array<string | undefined>): Array<string> {
  return Array.from(
    new Set<string>(
      names.filter((name: string | undefined): name is string => {
        return Boolean(name && name.trim());
      }),
    ),
  );
}

function getPlanCommands(
  suggestion: RemediationFixHeaderSuggestion,
): Array<AiRemediationCommand> {
  if (suggestion.suggestionType !== AutoRemediationSuggestionType.CommandPlan) {
    return [];
  }

  const plan: AiRemediationCommandPlan | null =
    AiRemediationCommandPlanUtil.parse(suggestion.commandPlan || null);

  return plan?.commands || [];
}

/*
 * What the fix is and where it works, in the reader's language: the name
 * over its steps.
 */
export function getRemediationFixTitle(data: {
  suggestion: RemediationFixHeaderSuggestion;
  translator: Translator;
  /*
   * The decision's entries: a round whose stored name cannot be read is
   * named by the cluster or resource its round started on.
   */
  entries?: Array<AutoRemediationDecisionEntry> | undefined;
}): string {
  const { suggestion, translator } = data;
  const entries: Array<AutoRemediationDecisionEntry> = data.entries || [];
  const clusterId: string = suggestion.kubernetesClusterId?.toString() || "";
  const resourceId: string = suggestion.resourceId?.toString() || "";
  const options: { setsValuesApart: boolean } = { setsValuesApart: true };
  const text: (key: string) => string = (key: string): string => {
    return translator.translateText(key) || key;
  };

  if (
    suggestion.suggestionType === AutoRemediationSuggestionType.McpToolCalls
  ) {
    return text(REMEDIATION_FIX_TITLE_COPY.mcp);
  }

  if (suggestion.suggestionType !== AutoRemediationSuggestionType.CommandPlan) {
    return suggestion.runbookNameSnapshot
      ? translator.translateTemplate(
          REMEDIATION_FIX_TITLE_COPY.runbook,
          { name: suggestion.runbookNameSnapshot },
          options,
        )
      : text(REMEDIATION_FIX_TITLE_COPY.anyRunbook);
  }

  const commands: Array<AiRemediationCommand> = getPlanCommands(suggestion);
  const clusterNames: Array<string> = distinct(
    commands
      .filter((command: AiRemediationCommand): boolean => {
        return command.stepType === RunbookStepType.Kubectl;
      })
      .map((command: AiRemediationCommand): string | undefined => {
        return command.kubernetesClusterNameSnapshot;
      }),
  );
  const clusterRound: ParsedRoundName | null = getClusterRoundName(suggestion);

  // A cluster's round, or a plan that runs on one cluster.
  if (
    clusterRound ||
    suggestion.kubernetesClusterId ||
    commands.some((command: AiRemediationCommand): boolean => {
      return command.stepType === RunbookStepType.Kubectl;
    })
  ) {
    const name: string | undefined =
      clusterRound?.name ||
      (clusterNames.length === 1 ? clusterNames[0] : undefined) ||
      (clusterId
        ? entries.find((entry: AutoRemediationDecisionEntry): boolean => {
            return (
              entry.kubernetesClusterId === clusterId &&
              Boolean(entry.kubernetesClusterName)
            );
          })?.kubernetesClusterName
        : undefined);

    if (!name) {
      return text(REMEDIATION_FIX_TITLE_COPY.anyCluster);
    }

    return clusterRound && clusterRound.round > 1
      ? translator.translateTemplate(
          REMEDIATION_FIX_TITLE_COPY.clusterRound,
          { name, round: translator.formatNumber(clusterRound.round) },
          options,
        )
      : translator.translateTemplate(
          REMEDIATION_FIX_TITLE_COPY.cluster,
          { name },
          options,
        );
  }

  const resourceCommands: Array<AiRemediationCommand> = commands.filter(
    (command: AiRemediationCommand): boolean => {
      return command.stepType === RunbookStepType.ResourceCommand;
    },
  );

  // A resource's round, or a plan that runs on one resource.
  if (suggestion.resourceId || resourceCommands.length > 0) {
    const resourceEntry: AutoRemediationDecisionEntry | undefined = resourceId
      ? entries.find((entry: AutoRemediationDecisionEntry): boolean => {
          return entry.resourceId === resourceId && Boolean(entry.resourceName);
        })
      : undefined;
    const resourceType: string | undefined =
      suggestion.resourceType ||
      resourceCommands[0]?.resourceType ||
      resourceEntry?.resourceType;
    const resourceRound: ParsedRoundName | null = suggestion.resourceId
      ? parseResourceRoundName(suggestion.ruleNameSnapshot, resourceType)
      : null;
    const resourceNames: Array<string> = distinct(
      resourceCommands.map(
        (command: AiRemediationCommand): string | undefined => {
          return command.resourceNameSnapshot;
        },
      ),
    );
    const name: string | undefined =
      resourceRound?.name ||
      (resourceNames.length === 1 ? resourceNames[0] : undefined) ||
      resourceEntry?.resourceName;

    if (!name) {
      return text(REMEDIATION_FIX_TITLE_COPY.anyResource);
    }

    const kind: ReturnType<typeof translatableTerm> = translatableTerm(
      getRemediationRoundResourceNoun(resourceType),
      { inSentence: true },
    );

    return resourceRound && resourceRound.round > 1
      ? translator.translateTemplate(
          REMEDIATION_FIX_TITLE_COPY.resourceRound,
          {
            kind,
            name,
            round: translator.formatNumber(resourceRound.round),
          },
          options,
        )
      : translator.translateTemplate(
          REMEDIATION_FIX_TITLE_COPY.resource,
          { kind, name },
          options,
        );
  }

  // Commands of its own, on a Runner.
  return text(REMEDIATION_FIX_TITLE_COPY.commands);
}

/*
 * The AI rule that made OneUptime AI run a cluster's or a resource's round,
 * as the decision it wrote down for the record names it: the rule that
 * asked first for that round, else the first AI rule that matched and
 * fixes. "" when no rule did - none is set up, and the project fixes what
 * it may.
 */
export function getRemediationRoundRuleName(data: {
  entries: Array<AutoRemediationDecisionEntry>;
  suggestion: RemediationFixHeaderSuggestion;
}): string {
  const { entries, suggestion } = data;
  const clusterId: string = suggestion.kubernetesClusterId?.toString() || "";
  const resourceId: string = suggestion.resourceId?.toString() || "";

  const roundEntry: AutoRemediationDecisionEntry | undefined = entries.find(
    (entry: AutoRemediationDecisionEntry): boolean => {
      if (!entry.ruleName) {
        return false;
      }

      if (entry.reason === AutoRemediationDecisionReason.ClusterRoundStarted) {
        return Boolean(clusterId) && entry.kubernetesClusterId === clusterId;
      }

      if (entry.reason === AutoRemediationDecisionReason.ResourceRoundStarted) {
        return Boolean(resourceId) && entry.resourceId === resourceId;
      }

      return false;
    },
  );

  if (roundEntry?.ruleName) {
    return roundEntry.ruleName;
  }

  const matched: AutoRemediationDecisionEntry | undefined = entries.find(
    (entry: AutoRemediationDecisionEntry): boolean => {
      return (
        Boolean(entry.ruleName) &&
        (entry.reason === AutoRemediationDecisionReason.RuleMatchedAiFix ||
          entry.reason === AutoRemediationDecisionReason.RuleMatchedAiFixAsks)
      );
    },
  );

  return matched?.ruleName || "";
}

/*
 * Why OneUptime AI tried the fix, under its name: the AI rule it came
 * from, or OneUptime AI itself when no rule is behind it.
 */
export function getRemediationFixSource(data: {
  suggestion: RemediationFixHeaderSuggestion;
  translator: Translator;
  /*
   * The decision's entries: a cluster's or resource's round is named for
   * the rule that matched there.
   */
  entries?: Array<AutoRemediationDecisionEntry> | undefined;
}): string {
  const { suggestion, translator } = data;
  const fromRule: (name: string) => string = (name: string): string => {
    return translator.translateTemplate(
      REMEDIATION_FIX_SOURCE_COPY.rule,
      { name },
      { setsValuesApart: true },
    );
  };
  const fromOneUptimeAi: string =
    translator.translateText(REMEDIATION_FIX_SOURCE_COPY.oneUptimeAi) ||
    REMEDIATION_FIX_SOURCE_COPY.oneUptimeAi;

  if (isProjectRunbookPick(suggestion)) {
    return fromOneUptimeAi;
  }

  if (isRemediationRoundFix(suggestion)) {
    const ruleName: string = getRemediationRoundRuleName({
      entries: data.entries || [],
      suggestion,
    });

    return ruleName ? fromRule(ruleName) : fromOneUptimeAi;
  }

  return fromRule(
    suggestion.ruleNameSnapshot ||
      translator.translateText("Unknown") ||
      "Unknown",
  );
}
