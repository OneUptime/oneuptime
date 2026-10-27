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
  normalizeSecurityPlaybookStepConfig,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookStep";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

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
  [SecurityPlaybookActionType.CheckThreatIntel]: ["raisePriorityToId"],
  [SecurityPlaybookActionType.LookUpEntityActivity]: ["lookbackInHours"],
  [SecurityPlaybookActionType.EmailPeople]: ["userIds", "teamIds", "message"],
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
  [SecurityPlaybookActionType.UnsuspendOktaUser]: [],
  [SecurityPlaybookActionType.LiftCrowdStrikeContainment]: [],
  [SecurityPlaybookActionType.ReleaseDefenderDevice]: [],
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
  "onCallPolicyId",
  "incidentSeverityId",
  "workflowId",
  "runbookId",
]);

// Switches among an action's settings: kept as true or false.
const SWITCH_KEYS: ReadonlySet<string> = new Set<string>(["notifySubscribers"]);

// A step as the dialog opens it: its settings under their form keys, and its three switches.
export function stepToFormValues(step: SecurityPlaybookStep): JSONObject {
  const values: JSONObject = {
    [STEP_ACTION_KEY]: step.action,
    requiresApproval: step.requiresApproval,
    continueOnFailure: step.continueOnFailure,
    onlyIfThreatIntelMatched: step.onlyIfThreatIntelMatched,
  };

  for (const key of getStepConfigKeys(step.action)) {
    const value: JSONValue | undefined = step.config[key];

    if (value !== undefined && value !== null) {
      values[key] = value;
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
    onlyIfThreatIntelMatched: false,
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

  return {
    id: data.stepId || ObjectID.generate().toString(),
    action,
    config: normalizeSecurityPlaybookStepConfig(
      action,
      rawConfig,
      `Step ${data.index + 1} (${definition?.title || action})`,
    ),
    requiresApproval: data.values["requiresApproval"] === true,
    continueOnFailure: data.values["continueOnFailure"] === true,
    onlyIfThreatIntelMatched: data.values["onlyIfThreatIntelMatched"] === true,
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
