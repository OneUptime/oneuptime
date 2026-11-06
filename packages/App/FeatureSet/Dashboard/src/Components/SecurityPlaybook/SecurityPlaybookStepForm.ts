import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
  doesActionNeedApprovalByDefault,
  getSecurityPlaybookAction,
  isSecurityPlaybookActionType,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  ENTITY_ACTIVITY_LOOKBACK_DEFAULT_HOURS,
  SecurityPlaybookStep,
  doesStepWaitOn,
  getStepsWaitingOn,
  normalizeSecurityPlaybookStepConfig,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookConditionMatch,
  SecurityPlaybookStepCondition,
  SecurityPlaybookStepRunIf,
  buildSecurityPlaybookStepRunIf,
  describeSecurityPlaybookStepOutcome,
  getSecurityPlaybookConditionMatch,
  getSecurityPlaybookStepConditions,
  getSecurityPlaybookStepOutcomes,
  isSecurityPlaybookConditionMatch,
  isSecurityPlaybookStepOutcome,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStepCondition";
import {
  ComposedValue,
  Translator,
  composedValue,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * A playbook step as the step dialog edits it, and back. The dialog is one
 * form whose fields show for the action picked, so every setting has a form
 * key of its own; the connection an action works through gets one per
 * product, since each picker lists only that product's connections. The
 * step itself is checked by the same rules the server saves it with
 * (normalizeSecurityPlaybookStepConfig), so the dialog says what is missing
 * before the playbook is saved.
 *
 * React-free so the round trip is pinned in a plain test.
 */

export const STEP_ACTION_KEY: string = "action";

// The form key of each product's connection picker.
export const CONNECTION_FIELD_BY_PROVIDER: Partial<
  Record<SecurityEventConnectorProvider, string>
> = {
  [SecurityEventConnectorProvider.OktaSystemLog]: "oktaConnectionId",
  [SecurityEventConnectorProvider.CrowdStrikeFalcon]: "crowdStrikeConnectionId",
  [SecurityEventConnectorProvider.MicrosoftDefenderXdr]: "defenderConnectionId",
  [SecurityEventConnectorProvider.MicrosoftEntraId]: "entraIdConnectionId",
  [SecurityEventConnectorProvider.GoogleWorkspace]:
    "googleWorkspaceConnectionId",
};

export function getConnectionFieldKey(
  action: SecurityPlaybookActionType | string | undefined,
): string | undefined {
  const definition: SecurityPlaybookActionDefinition | undefined =
    getSecurityPlaybookAction(action);

  return definition?.connectionProvider
    ? CONNECTION_FIELD_BY_PROVIDER[definition.connectionProvider]
    : undefined;
}

// The config keys each action keeps, as the form names them.
const PLAIN_KEYS_BY_ACTION: Record<
  SecurityPlaybookActionType,
  Array<string>
> = {
  [SecurityPlaybookActionType.AssignCase]: ["userId", "teamId"],
  [SecurityPlaybookActionType.SetCasePriority]: ["priorityId"],
  [SecurityPlaybookActionType.SetCaseStatus]: ["statusId", "verdict"],
  [SecurityPlaybookActionType.AddCaseNote]: ["note"],
  [SecurityPlaybookActionType.AddCaseLabels]: ["labelIds"],
  [SecurityPlaybookActionType.AddCaseTasks]: ["tasks", "assigneeUserId"],
  [SecurityPlaybookActionType.CheckThreatIntel]: ["raisePriorityToId"],
  [SecurityPlaybookActionType.LookUpEntityActivity]: ["lookbackInHours"],
  [SecurityPlaybookActionType.EmailPeople]: ["userIds", "teamIds", "message"],
  [SecurityPlaybookActionType.NotifyDataStoreOwners]: ["message"],
  [SecurityPlaybookActionType.PostToSlack]: ["channelName", "message"],
  [SecurityPlaybookActionType.PostToMicrosoftTeams]: [
    "channelName",
    "microsoftTeamsTeamId",
    "message",
  ],
  [SecurityPlaybookActionType.PageOnCall]: ["onCallPolicyId"],
  [SecurityPlaybookActionType.DeclareIncident]: ["incidentSeverityId"],
  [SecurityPlaybookActionType.SuspendOktaUser]: [],
  [SecurityPlaybookActionType.EndOktaSessions]: [],
  [SecurityPlaybookActionType.ContainCrowdStrikeHost]: [],
  [SecurityPlaybookActionType.IsolateDefenderDevice]: ["isolationType"],
  [SecurityPlaybookActionType.DisableEntraIdUser]: [],
  [SecurityPlaybookActionType.SignOutEntraIdUser]: [],
  [SecurityPlaybookActionType.SuspendGoogleWorkspaceUser]: [],
  [SecurityPlaybookActionType.SignOutGoogleWorkspaceUser]: [],
  [SecurityPlaybookActionType.UnsuspendOktaUser]: [],
  [SecurityPlaybookActionType.LiftCrowdStrikeContainment]: [],
  [SecurityPlaybookActionType.ReleaseDefenderDevice]: [],
  [SecurityPlaybookActionType.EnableEntraIdUser]: [],
  [SecurityPlaybookActionType.UnsuspendGoogleWorkspaceUser]: [],
  [SecurityPlaybookActionType.BlockDataStorePublicAccess]: [],
  [SecurityPlaybookActionType.RevokeDataStoreSharing]: [],
  [SecurityPlaybookActionType.SendWebhook]: ["url"],
  [SecurityPlaybookActionType.RunWorkflow]: ["workflowId"],
  [SecurityPlaybookActionType.RunRunbook]: ["runbookId"],
  [SecurityPlaybookActionType.PreserveEvidence]: [],
  [SecurityPlaybookActionType.PostStatusPageAnnouncement]: [
    "statusPageIds",
    "announcementTitle",
    "announcementDescription",
    "notifySubscribers",
  ],
  [SecurityPlaybookActionType.FixWithAi]: [],
  [SecurityPlaybookActionType.StopRun]: ["reason"],
};

export function getStepConfigKeys(
  action: SecurityPlaybookActionType,
): Array<string> {
  return PLAIN_KEYS_BY_ACTION[action] || [];
}

/*
 * What a picker or dropdown hands back - an id, an ObjectID, a { value }
 * or { _id } option, or a list of any of these - as id text.
 */
export function readFormId(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value instanceof ObjectID) {
    return value.toString();
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record: Record<string, unknown> = value as Record<string, unknown>;

    for (const key of ["value", "_id", "id"]) {
      const candidate: unknown = record[key];

      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }

      if (candidate instanceof ObjectID) {
        return candidate.toString();
      }
    }
  }

  return "";
}

export function readFormIdList(value: unknown): Array<string> {
  const items: Array<unknown> = Array.isArray(value)
    ? value
    : value === undefined || value === null || value === ""
      ? []
      : [value];

  const ids: Array<string> = [];

  for (const item of items) {
    const id: string = readFormId(item);

    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

const ID_LIST_KEYS: ReadonlySet<string> = new Set<string>([
  "labelIds",
  "userIds",
  "teamIds",
  "statusPageIds",
]);

const ID_KEYS: ReadonlySet<string> = new Set<string>([
  "userId",
  "teamId",
  "assigneeUserId",
  "onCallPolicyId",
  "incidentSeverityId",
  "workflowId",
  "runbookId",
]);

// Switches among an action's settings: kept as true or false.
const SWITCH_KEYS: ReadonlySet<string> = new Set<string>(["notifySubscribers"]);

/*
 * RUN THIS STEP: always, or only after earlier steps' results - the one
 * picker a step's branch is set with, which takes several. Its value is
 * the list of results it waits on (encodeRunIf each: the earlier step and
 * the result), or the legacy "only if threat intel matched" of a step saved
 * before branching; nothing picked is always. With two or more, RUN WHEN
 * says whether all of them must have happened, or any one.
 */
export const RUN_IF_KEY: string = "runIf";
export const RUN_IF_MATCH_KEY: string = "runIfMatch";
export const RUN_ALWAYS: string = "always";
export const RUN_IF_THREAT_INTEL_MATCHED: string = "threat-intel-matched";
const RUN_IF_PREFIX: string = "after:";

export function encodeRunIf(condition: SecurityPlaybookStepCondition): string {
  // The result first: it holds no colon, and an id may.
  return `${RUN_IF_PREFIX}${condition.outcome}:${condition.stepId}`;
}

export function decodeRunIf(
  value: unknown,
): SecurityPlaybookStepCondition | undefined {
  const text: string = readFormId(value);

  if (!text.startsWith(RUN_IF_PREFIX)) {
    return undefined;
  }

  const rest: string = text.slice(RUN_IF_PREFIX.length);
  const colon: number = rest.indexOf(":");
  const outcome: string = colon > 0 ? rest.slice(0, colon) : "";
  const stepId: string = colon > 0 ? rest.slice(colon + 1) : "";

  return stepId && isSecurityPlaybookStepOutcome(outcome)
    ? { stepId, outcome }
    : undefined;
}

// What a step runs after, as Run This Step holds it: nothing for a step that always runs.
export function getRunIfFormValue(step: SecurityPlaybookStep): Array<string> {
  const conditions: Array<SecurityPlaybookStepCondition> =
    getSecurityPlaybookStepConditions(step.runIf);

  if (conditions.length > 0) {
    return conditions.map(encodeRunIf);
  }

  return step.onlyIfThreatIntelMatched ? [RUN_IF_THREAT_INTEL_MATCHED] : [];
}

/*
 * Run This Step's value as the form hands it back - a list of choices, one
 * choice, or Always (what an older form, or a cleared one, holds) - as the
 * choices picked.
 */
export function readRunIfFormValues(value: unknown): Array<string> {
  return readFormIdList(value).filter((choice: string): boolean => {
    return choice !== RUN_ALWAYS;
  });
}

// How a step reads the results it waits on, as Run When holds it.
export function getRunIfMatchFormValue(
  step: SecurityPlaybookStep,
): SecurityPlaybookConditionMatch {
  return getSecurityPlaybookConditionMatch(step.runIf);
}

// Whether the form's step waits on two results or more: Run When is asked then.
export function waitsOnSeveralResults(values: JSONObject): boolean {
  return (
    getSecurityPlaybookStepConditions(
      readRunIfChoices(readRunIfFormValues(values[RUN_IF_KEY]), undefined),
    ).length > 1
  );
}

/*
 * RUN WHEN's two choices: every result picked, or any one of them. A step
 * that waits on one result needs neither.
 */
export const RUN_WHEN_ALL_LABEL: string = translationKey(
  "When all of them happened",
);
export const RUN_WHEN_ANY_LABEL: string = translationKey(
  "When any one of them happened",
);

/*
 * The sentence each result reads as in Run This Step, with the step's
 * number and title, by the result's own words (Common's
 * describeSecurityPlaybookStepOutcome): a whole sentence for each, so every
 * language words it its own way.
 */
export const RUN_IF_OPTION_TEMPLATES: Readonly<Record<string, string>> = {
  succeeded: translationKey("Only if step {{number}} ({{title}}) succeeded"),
  failed: translationKey("Only if step {{number}} ({{title}}) failed"),
  "found a known-bad entity": translationKey(
    "Only if step {{number}} ({{title}}) found a known-bad entity",
  ),
  "found nothing known-bad": translationKey(
    "Only if step {{number}} ({{title}}) found nothing known-bad",
  ),
  "found activity": translationKey(
    "Only if step {{number}} ({{title}}) found activity",
  ),
  "found no activity": translationKey(
    "Only if step {{number}} ({{title}}) found no activity",
  ),
};

/*
 * A result as a clause of a longer sentence, for a step that waits on
 * several: "step 1 found a known-bad entity and step 2 succeeded".
 */
export const RUN_IF_CLAUSE_TEMPLATES: Readonly<Record<string, string>> = {
  succeeded: translationKey("step {{number}} succeeded"),
  failed: translationKey("step {{number}} failed"),
  "found a known-bad entity": translationKey(
    "step {{number}} found a known-bad entity",
  ),
  "found nothing known-bad": translationKey(
    "step {{number}} found nothing known-bad",
  ),
  "found activity": translationKey("step {{number}} found activity"),
  "found no activity": translationKey("step {{number}} found no activity"),
};

/*
 * What a step that waits on several results says, by how it reads them and
 * how many: "Only if step 1 found a known-bad entity and step 2
 * succeeded". Sentences of their own, so each language joins its clauses
 * as it joins clauses, never as it lists names. Four or five read as three,
 * the first ones together.
 */
export const RUN_IF_SEVERAL_TEMPLATES: Readonly<
  Record<SecurityPlaybookConditionMatch, Readonly<Record<2 | 3, string>>>
> = {
  [SecurityPlaybookConditionMatch.All]: {
    2: translationKey("Only if {{first}} and {{second}}"),
    3: translationKey("Only if {{first}}, {{second}} and {{third}}"),
  },
  [SecurityPlaybookConditionMatch.Any]: {
    2: translationKey("Only if {{first}} or {{second}}"),
    3: translationKey("Only if {{first}}, {{second}} or {{third}}"),
  },
};

// ...and on the step's card, where the steps are numbered above it.
export const RUN_IF_FLAG_TEMPLATES: Readonly<Record<string, string>> = {
  succeeded: translationKey("Only if step {{number}} succeeded"),
  failed: translationKey("Only if step {{number}} failed"),
  "found a known-bad entity": translationKey(
    "Only if step {{number}} found a known-bad entity",
  ),
  "found nothing known-bad": translationKey(
    "Only if step {{number}} found nothing known-bad",
  ),
  "found activity": translationKey("Only if step {{number}} found activity"),
  "found no activity": translationKey(
    "Only if step {{number}} found no activity",
  ),
};

export const RUN_ALWAYS_LABEL: string = translationKey("Always");
export const RUN_IF_THREAT_INTEL_MATCHED_LABEL: string = translationKey(
  "Only if an earlier threat intel check found a known-bad entity",
);
export const RUN_IF_THREAT_INTEL_MATCHED_FLAG: string = translationKey(
  "Only if threat intel matched",
);
// A condition on a step that is no longer before it: shown, so it can be changed.
export const RUN_IF_MISSING_STEP_LABEL: string = translationKey(
  "Only after a step that is no longer before it",
);

function readStepTitle(
  action: SecurityPlaybookActionType | string,
  translator: Translator,
): string {
  const title: string = getSecurityPlaybookAction(action)?.title || action;

  return translator.translateText(title) || title;
}

/*
 * One choice of Run This Step, shaped as the Dropdown takes it (kept here,
 * React-free, rather than imported from the Dropdown component).
 */
export interface RunIfOption {
  value: string;
  label: string;
  // Built from translated parts: it reads the page's way.
  isInPageDirection: boolean;
}

/*
 * What Run This Step offers a step: each result of each step before it -
 * found or found nothing for a step that looks something up, succeeded
 * otherwise, and failed for one that carries on when it fails - in the
 * order the steps run; picking none is Always. A step that stops the run
 * has no result to wait on: nothing after it runs. A step saved with the
 * legacy "only if threat intel matched", or one whose condition no longer
 * fits, keeps what it has as an option, so opening it never changes it.
 */
export function getRunIfOptions(data: {
  earlierSteps: ReadonlyArray<SecurityPlaybookStep>;
  step?: SecurityPlaybookStep | undefined;
  translator: Translator;
}): Array<RunIfOption> {
  const { translator } = data;
  const options: Array<RunIfOption> = [];

  data.earlierSteps.forEach(
    (earlier: SecurityPlaybookStep, index: number): void => {
      for (const outcome of getSecurityPlaybookStepOutcomes(earlier)) {
        options.push({
          value: encodeRunIf({ stepId: earlier.id, outcome }),
          label: translator.translateTemplate(
            RUN_IF_OPTION_TEMPLATES[
              describeSecurityPlaybookStepOutcome(earlier.action, outcome)
            ] || RUN_IF_OPTION_TEMPLATES["succeeded"]!,
            {
              number: translator.formatNumber(index + 1),
              title: readStepTitle(earlier.action, translator),
            },
          ),
          isInPageDirection: true,
        });
      }
    },
  );

  const current: Array<string> = data.step ? getRunIfFormValue(data.step) : [];

  for (const value of current) {
    if (
      !options.some((option: RunIfOption): boolean => {
        return option.value === value;
      })
    ) {
      options.push({
        value,
        label:
          value === RUN_IF_THREAT_INTEL_MATCHED
            ? translator.translateText(RUN_IF_THREAT_INTEL_MATCHED_LABEL) ||
              RUN_IF_THREAT_INTEL_MATCHED_LABEL
            : translator.translateText(RUN_IF_MISSING_STEP_LABEL) ||
              RUN_IF_MISSING_STEP_LABEL,
        isInPageDirection: true,
      });
    }
  }

  return options;
}

/*
 * A step as numbered in its playbook or run: what a condition names it by,
 * and what it is.
 */
export interface NumberedStep {
  id: string;
  action: SecurityPlaybookActionType | string;
}

/*
 * What a step's card says of when it runs - "Only if step 1 found a
 * known-bad entity", or for several results "Only if step 1 found a
 * known-bad entity and step 2 succeeded" ("or" for a step that runs on any
 * one) - or nothing for a step that always runs. The run card says the
 * same under a step it skipped for it (getSkippedRunIf).
 */
export function describeRunIf(data: {
  step: Pick<SecurityPlaybookStep, "runIf" | "onlyIfThreatIntelMatched">;
  steps: ReadonlyArray<NumberedStep>;
  translator: Translator;
}): string {
  const { step, translator } = data;
  const conditions: Array<SecurityPlaybookStepCondition> =
    getSecurityPlaybookStepConditions(step.runIf);

  if (conditions.length > 0) {
    // Each result by the step it names, as numbered now.
    const named: Array<{ index: number; earlier: NumberedStep } | null> =
      conditions.map(
        (
          condition: SecurityPlaybookStepCondition,
        ): { index: number; earlier: NumberedStep } | null => {
          const index: number = data.steps.findIndex(
            (candidate: NumberedStep): boolean => {
              return candidate.id === condition.stepId;
            },
          );
          const earlier: NumberedStep | undefined = data.steps[index];

          return earlier ? { index, earlier } : null;
        },
      );

    if (named.includes(null)) {
      return (
        translator.translateText(RUN_IF_MISSING_STEP_LABEL) ||
        RUN_IF_MISSING_STEP_LABEL
      );
    }

    const outcomeOf: (position: number) => string = (
      position: number,
    ): string => {
      return describeSecurityPlaybookStepOutcome(
        named[position]!.earlier.action,
        conditions[position]!.outcome,
      );
    };

    if (conditions.length === 1) {
      return translator.translateTemplate(
        RUN_IF_FLAG_TEMPLATES[outcomeOf(0)] ||
          RUN_IF_FLAG_TEMPLATES["succeeded"]!,
        { number: translator.formatNumber(named[0]!.index + 1) },
      );
    }

    // Each clause, in the language the sentence is read in.
    const clauseAt: (positions: Array<number>) => ComposedValue = (
      positions: Array<number>,
    ): ComposedValue => {
      return composedValue((sentenceTranslator: Translator): string => {
        return positions
          .map((position: number): string => {
            return sentenceTranslator.translateTemplate(
              RUN_IF_CLAUSE_TEMPLATES[outcomeOf(position)] ||
                RUN_IF_CLAUSE_TEMPLATES["succeeded"]!,
              {
                number: sentenceTranslator.formatNumber(
                  named[position]!.index + 1,
                ),
              },
            );
          })
          .join(", ");
      });
    };
    const templates: Readonly<Record<2 | 3, string>> =
      RUN_IF_SEVERAL_TEMPLATES[getSecurityPlaybookConditionMatch(step.runIf)];
    const last: number = conditions.length - 1;

    if (conditions.length === 2) {
      return translator.translateTemplate(templates[2], {
        first: clauseAt([0]),
        second: clauseAt([1]),
      });
    }

    // Three, or the first ones together and the last two.
    return translator.translateTemplate(templates[3], {
      first: clauseAt(
        conditions
          .slice(0, last - 1)
          .map(
            (_condition: SecurityPlaybookStepCondition, position: number) => {
              return position;
            },
          ),
      ),
      second: clauseAt([last - 1]),
      third: clauseAt([last]),
    });
  }

  return step.onlyIfThreatIntelMatched
    ? translator.translateText(RUN_IF_THREAT_INTEL_MATCHED_FLAG) ||
        RUN_IF_THREAT_INTEL_MATCHED_FLAG
    : "";
}

/*
 * What Run This Step says on the folded More fields line: the step card's
 * own words for what it holds ("Only if step 1 found a known-bad entity") -
 * not the dropdown's longer choice, which a folded line cuts mid-title - or
 * null while it holds Always, the choice nobody has to make.
 */
export function describeRunIfFormValue(data: {
  value: unknown;
  match?: unknown;
  earlierSteps: ReadonlyArray<NumberedStep>;
  translator: Translator;
}): string | null {
  const choices: Array<string> = readRunIfFormValues(data.value);

  if (choices.length === 0) {
    return null;
  }

  const runIf: SecurityPlaybookStepRunIf | undefined = readRunIfChoices(
    choices,
    data.match,
  );

  return (
    describeRunIf({
      step: {
        onlyIfThreatIntelMatched: choices.includes(RUN_IF_THREAT_INTEL_MATCHED),
        ...(runIf ? { runIf } : {}),
      },
      steps: data.earlierSteps,
      translator: data.translator,
    }) || null
  );
}

// The results the choices of Run This Step name, read as Run When says.
export function readRunIfChoices(
  choices: ReadonlyArray<string>,
  match: unknown,
): SecurityPlaybookStepRunIf | undefined {
  const conditions: Array<SecurityPlaybookStepCondition> = [];

  for (const choice of choices) {
    const condition: SecurityPlaybookStepCondition | undefined =
      decodeRunIf(choice);

    if (condition) {
      conditions.push(condition);
    }
  }

  const readMatch: string = readFormId(match);

  return buildSecurityPlaybookStepRunIf(
    conditions,
    isSecurityPlaybookConditionMatch(readMatch)
      ? readMatch
      : SecurityPlaybookConditionMatch.All,
  );
}

/*
 * Why a step cannot move, or be deleted, without breaking a branch - a
 * step may wait only on one before it - or undefined when it can. Each
 * names the step in the way and the one thing that frees it.
 */
export const STEP_WAITED_ON_REASON: string = translationKey(
  "Step {{number}} waits on this step's result. Change Run This Step on step {{number}} first.",
);
export const STEP_WAITS_ON_REASON: string = translationKey(
  "This step waits on step {{number}}'s result, so it stays below step {{number}}.",
);

export function getStepMoveBlock(data: {
  steps: ReadonlyArray<SecurityPlaybookStep>;
  index: number;
  direction: -1 | 1;
  translator: Translator;
}): string | undefined {
  const { steps, index, direction, translator } = data;
  const step: SecurityPlaybookStep | undefined = steps[index];
  const neighbour: SecurityPlaybookStep | undefined = steps[index + direction];

  if (!step || !neighbour) {
    return undefined;
  }

  // Up: past a step it waits on. Down: past a step that waits on it.
  const [upper, lower]: [SecurityPlaybookStep, SecurityPlaybookStep] =
    direction === -1 ? [neighbour, step] : [step, neighbour];

  if (!doesStepWaitOn(lower, upper.id)) {
    return undefined;
  }

  const upperNumber: string = translator.formatNumber(
    (direction === -1 ? index - 1 : index) + 1,
  );
  const lowerNumber: string = translator.formatNumber(
    (direction === -1 ? index : index + 1) + 1,
  );

  return direction === -1
    ? translator.translateTemplate(STEP_WAITS_ON_REASON, {
        number: upperNumber,
      })
    : translator.translateTemplate(STEP_WAITED_ON_REASON, {
        number: lowerNumber,
      });
}

export function getStepDeleteBlock(data: {
  steps: ReadonlyArray<SecurityPlaybookStep>;
  index: number;
  translator: Translator;
}): string | undefined {
  const step: SecurityPlaybookStep | undefined = data.steps[data.index];

  if (!step) {
    return undefined;
  }

  const waiting: Array<{ index: number; step: SecurityPlaybookStep }> =
    getStepsWaitingOn(data.steps, step.id);

  return waiting.length > 0
    ? data.translator.translateTemplate(STEP_WAITED_ON_REASON, {
        number: data.translator.formatNumber(waiting[0]!.index + 1),
      })
    : undefined;
}

// A step as the dialog opens it: its settings under their form keys, and how it runs.
export function stepToFormValues(step: SecurityPlaybookStep): JSONObject {
  const values: JSONObject = {
    [STEP_ACTION_KEY]: step.action,
    requiresApproval: step.requiresApproval,
    continueOnFailure: step.continueOnFailure,
    [RUN_IF_KEY]: getRunIfFormValue(step),
    [RUN_IF_MATCH_KEY]: getRunIfMatchFormValue(step),
  };

  for (const key of getStepConfigKeys(step.action)) {
    const value: JSONValue | undefined = step.config[key];

    if (value !== undefined && value !== null) {
      // The tasks are written one a line.
      values[key] =
        key === "tasks" && Array.isArray(value)
          ? (value as Array<JSONValue>).join("\n")
          : value;
    }
  }

  const connectionKey: string | undefined = getConnectionFieldKey(step.action);

  if (connectionKey && typeof step.config["connectionId"] === "string") {
    values[connectionKey] = step.config["connectionId"];
  }

  return values;
}

/*
 * What a new step of an action starts as: a containment step waits for
 * approval, which only a Security Admin can turn off (the server holds
 * everyone else to it); so does a step that runs a runbook or posts to a
 * status page, which whoever adds it may turn off.
 */
export function getNewStepFormValues(
  action: SecurityPlaybookActionType,
): JSONObject {
  const definition: SecurityPlaybookActionDefinition | undefined =
    getSecurityPlaybookAction(action);

  return {
    [STEP_ACTION_KEY]: action,
    requiresApproval: doesActionNeedApprovalByDefault(definition),
    continueOnFailure: false,
    [RUN_IF_KEY]: [],
    [RUN_IF_MATCH_KEY]: SecurityPlaybookConditionMatch.All,
    ...(action === SecurityPlaybookActionType.LookUpEntityActivity
      ? { lookbackInHours: ENTITY_ACTIVITY_LOOKBACK_DEFAULT_HOURS }
      : {}),
    ...(action === SecurityPlaybookActionType.IsolateDefenderDevice
      ? { isolationType: "Full" }
      : {}),
    ...(action === SecurityPlaybookActionType.PostStatusPageAnnouncement
      ? { notifySubscribers: false }
      : {}),
  };
}

/*
 * The step a filled-in dialog describes. Throws the same message the server
 * would ("Step 2 (Post to Slack): name the channel to post to."), worded for
 * the step's position in the playbook.
 */
export function formValuesToStep(data: {
  values: JSONObject;
  stepId?: string | undefined;
  index: number;
}): SecurityPlaybookStep {
  const action: JSONValue | undefined = data.values[STEP_ACTION_KEY];

  if (!isSecurityPlaybookActionType(action)) {
    throw new Error("Choose what the step does.");
  }

  const rawConfig: JSONObject = {};

  for (const key of getStepConfigKeys(action)) {
    const value: JSONValue | undefined = data.values[key];

    if (SWITCH_KEYS.has(key)) {
      rawConfig[key] = value === true;
      continue;
    }

    if (value === undefined || value === null || value === "") {
      continue;
    }

    if (ID_LIST_KEYS.has(key)) {
      rawConfig[key] = readFormIdList(value);
    } else if (ID_KEYS.has(key)) {
      rawConfig[key] = readFormId(value);
    } else if (key === "lookbackInHours") {
      rawConfig[key] = typeof value === "number" ? value : Number(value);
    } else {
      rawConfig[key] = typeof value === "string" ? value : readFormId(value);
    }
  }

  const connectionKey: string | undefined = getConnectionFieldKey(action);

  if (connectionKey) {
    rawConfig["connectionId"] = readFormId(data.values[connectionKey]);
  }

  const definition: SecurityPlaybookActionDefinition | undefined =
    getSecurityPlaybookAction(action);
  const stopsTheRun: boolean = action === SecurityPlaybookActionType.StopRun;
  const runIfValue: JSONValue | undefined = data.values[RUN_IF_KEY];
  const choices: Array<string> = readRunIfFormValues(runIfValue);
  const runIf: SecurityPlaybookStepRunIf | undefined = readRunIfChoices(
    choices,
    data.values[RUN_IF_MATCH_KEY],
  );
  /*
   * The legacy "only if threat intel matched" stays only while Run This
   * Step still holds it alone - results picked beside it take its place -
   * or, from a caller that has no Run This Step, the switch it used to be.
   */
  const onlyIfThreatIntelMatched: boolean =
    runIfValue === undefined || runIfValue === null
      ? data.values["onlyIfThreatIntelMatched"] === true
      : !runIf && choices.includes(RUN_IF_THREAT_INTEL_MATCHED);

  return {
    id: data.stepId || ObjectID.generate().toString(),
    action,
    config: normalizeSecurityPlaybookStepConfig(
      action,
      rawConfig,
      `Step ${data.index + 1} (${definition?.title || action})`,
    ),
    // A Stop step has nothing to approve and cannot fail: neither switch is offered.
    requiresApproval: !stopsTheRun && data.values["requiresApproval"] === true,
    continueOnFailure:
      !stopsTheRun && data.values["continueOnFailure"] === true,
    onlyIfThreatIntelMatched,
    ...(runIf ? { runIf } : {}),
  };
}

/*
 * Whether the dialog offers the Needs Approval switch for a step of this
 * action: on a containment step only to whoever may turn approval off (a
 * Security Admin, or above); everyone else is shown what it is set to.
 */
export function isApprovalSwitchOffered(
  action: unknown,
  mayTurnOffContainmentApproval: boolean,
): boolean {
  return (
    !getSecurityPlaybookAction(action as string | undefined)?.isDisruptive ||
    mayTurnOffContainmentApproval
  );
}

// Swap a step with its neighbour; out-of-range moves leave the list as it is.
export function moveStep(
  steps: Array<SecurityPlaybookStep>,
  index: number,
  direction: -1 | 1,
): Array<SecurityPlaybookStep> {
  const target: number = index + direction;

  if (
    index < 0 ||
    index >= steps.length ||
    target < 0 ||
    target >= steps.length
  ) {
    return steps;
  }

  const moved: Array<SecurityPlaybookStep> = [...steps];
  const current: SecurityPlaybookStep = moved[index]!;
  moved[index] = moved[target]!;
  moved[target] = current;

  return moved;
}

export const EDIT_STEP_TITLE: string = translationKey(
  "Edit Step {{number}}: {{title}}",
);

/*
 * The dialog's title and the line under it. A step being changed is named
 * by its place and what it does, as a run lists its steps ("Step 4: Add a
 * note"), and what that does is said under it - each in the reader's
 * language. Joined from English pieces, the title read "Edit Step 4" and
 * its line "Add a note: Write a note on the case: ..." on every page, two
 * colons in one sentence. A new step has its action still to pick.
 */
export function getStepDialogWords(data: {
  definition: SecurityPlaybookActionDefinition | undefined;
  index: number;
  isNew: boolean;
  translator: Translator;
}): { title: string; description: string } {
  const { definition, translator } = data;

  if (data.isNew || !definition) {
    return {
      title: data.isNew ? "Add Step" : "Edit Step",
      description: "Pick what the step does, then fill in its settings.",
    };
  }

  return {
    title: translator.translateTemplate(EDIT_STEP_TITLE, {
      number: translator.formatNumber(data.index + 1),
      title: translator.translateText(definition.title) || definition.title,
    }),
    description:
      translator.translateText(definition.description) ||
      definition.description,
  };
}
