import BadDataException from "../Exception/BadDataException";
import { JSONObject, JSONValue } from "../JSON";
import ObjectID from "../ObjectID";
import Permission from "../Permission";
import SecurityCaseVerdict, {
  isSecurityCaseVerdict,
} from "../SecurityCase/SecurityCaseVerdict";
import {
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
  getSecurityPlaybookAction,
  isSecurityPlaybookActionType,
} from "./SecurityPlaybookAction";

/*
 * One step of a playbook: an action, its settings, and three switches that
 * shape how a run treats it.
 *
 *  - requiresApproval: the run stops before the step and waits for a person
 *    to approve or reject it on the case. Rejecting ends the run. A
 *    containment step always waits, unless a Security Admin turned that off
 *    (approvalTurnedOff, which only the server writes; doesStepNeedApproval).
 *  - continueOnFailure: a failed step does not stop the steps after it.
 *  - onlyIfThreatIntelMatched: the step runs only when an earlier Check
 *    Threat Intel step of the same run found a known-bad entity, and is
 *    skipped otherwise. "Contain only what intel says is bad" without a
 *    branching editor.
 *
 * Steps are stored as JSON on the playbook and copied onto each run when it
 * starts, so editing a playbook never changes a run already under way.
 *
 * A step that sets a case's priority or status names one of the project's
 * own by id (SecurityCasePriority, SecurityCaseStatus). Which ones it may
 * name - one of the project's, a status a case moves on to, a verdict for a
 * status that closes - is checked against the project's lists when the
 * playbook is saved (validateSecurityPlaybookStepValues), and again when the
 * step runs.
 */
export interface SecurityPlaybookStep {
  id: string;
  action: SecurityPlaybookActionType;
  config: JSONObject;
  requiresApproval: boolean;
  continueOnFailure: boolean;
  onlyIfThreatIntelMatched: boolean;
  approvalTurnedOff?: SecurityPlaybookApprovalTurnedOff | undefined;
}

/*
 * Who let a containment step run without approval, and when: a Security
 * Admin who saved it with Needs Approval off (or nobody, for an API key or
 * OneUptime itself). Stamped by the playbook service; one sent with a step
 * is never taken as it is.
 */
export interface SecurityPlaybookApprovalTurnedOff {
  byUserId?: string | undefined;
  // ISO 8601.
  at: string;
}

export interface AssignCaseConfig {
  userId?: string | undefined;
  teamId?: string | undefined;
}

export interface SetCasePriorityConfig {
  // One of the project's case priorities.
  priorityId: string;
}

export interface SetCaseStatusConfig {
  // One of the project's case statuses, other than the one cases start in.
  statusId: string;
  // Only for a status that closes the case.
  verdict?: SecurityCaseVerdict | undefined;
}

export interface AddCaseNoteConfig {
  note: string;
}

export interface AddCaseLabelsConfig {
  labelIds: Array<string>;
}

export interface CheckThreatIntelConfig {
  // Raise the case to at least this priority (one of the project's) when an entity matches.
  raisePriorityToId?: string | undefined;
}

export interface LookUpEntityActivityConfig {
  lookbackInHours: number;
}

export interface EmailPeopleConfig {
  userIds: Array<string>;
  teamIds: Array<string>;
  // Markdown with {{case.*}} placeholders; a summary of the case when empty.
  message?: string | undefined;
}

export interface PostToChannelConfig {
  channelName: string;
  /*
   * The Microsoft Teams team the channel is in, by its Teams id - not a
   * OneUptime team, hence the name. Teams only.
   */
  microsoftTeamsTeamId?: string | undefined;
  message?: string | undefined;
}

export interface PageOnCallConfig {
  onCallPolicyId: string;
}

export interface DeclareIncidentConfig {
  incidentSeverityId: string;
}

export interface ConnectionActionConfig {
  connectionId: string;
}

export enum DefenderIsolationType {
  Full = "Full",
  Selective = "Selective",
}

export interface IsolateDefenderDeviceConfig extends ConnectionActionConfig {
  isolationType: DefenderIsolationType;
}

export interface SendWebhookConfig {
  url: string;
}

export interface RunWorkflowConfig {
  workflowId: string;
}

// Who may let a containment step run without approval: a Security Admin, or above.
export const TURN_OFF_CONTAINMENT_APPROVAL_PERMISSIONS: ReadonlyArray<Permission> =
  [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.SecurityAdmin];

export const SECURITY_PLAYBOOK_MAX_STEPS: number = 25;
export const SECURITY_PLAYBOOK_NOTE_MAX_LENGTH: number = 10000;
export const ENTITY_ACTIVITY_LOOKBACK_MIN_HOURS: number = 1;
export const ENTITY_ACTIVITY_LOOKBACK_MAX_HOURS: number = 720;
export const ENTITY_ACTIVITY_LOOKBACK_DEFAULT_HOURS: number = 24;

// An http(s) URL with a host: what a webhook step can post to.
const WEBHOOK_URL: RegExp = /^https?:\/\/[^\s/?#]+[^\s]*$/i;

function stepLabel(index: number, action: SecurityPlaybookActionType): string {
  const definition: SecurityPlaybookActionDefinition | undefined =
    getSecurityPlaybookAction(action);

  return `Step ${index + 1} (${definition?.title || action})`;
}

function readObject(value: JSONValue | undefined): JSONObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JSONObject;
  }

  return {};
}

function readText(config: JSONObject, key: string): string {
  const value: JSONValue | undefined = config[key];

  return typeof value === "string" ? value.trim() : "";
}

function isObjectIdText(value: string): boolean {
  return ObjectID.isValidUUID(value);
}

function readIdList(config: JSONObject, key: string): Array<string> {
  const value: JSONValue | undefined = config[key];

  if (!Array.isArray(value)) {
    return [];
  }

  const ids: Array<string> = [];

  for (const item of value) {
    const text: string = typeof item === "string" ? item.trim() : "";

    if (text && isObjectIdText(text) && !ids.includes(text)) {
      ids.push(text);
    }
  }

  return ids;
}

function requireId(
  config: JSONObject,
  key: string,
  label: string,
  what: string,
): string {
  const value: string = readText(config, key);

  if (!value || !isObjectIdText(value)) {
    throw new BadDataException(`${label}: choose ${what}.`);
  }

  return value;
}

/*
 * The settings an action keeps, cleaned: unknown keys dropped, text trimmed,
 * ids checked for shape. Throws a message that names the step and says what
 * to fix. Whether an id still points at something of this project (a user,
 * a policy, a connection) is checked when the step runs, not here: things
 * get deleted after playbooks are saved, and the run says so on the case.
 */
export function normalizeSecurityPlaybookStepConfig(
  action: SecurityPlaybookActionType,
  rawConfig: JSONObject,
  label: string,
): JSONObject {
  switch (action) {
    case SecurityPlaybookActionType.AssignCase: {
      const userId: string = readText(rawConfig, "userId");
      const teamId: string = readText(rawConfig, "teamId");
      const config: JSONObject = {};

      if (userId && isObjectIdText(userId)) {
        config["userId"] = userId;
      }

      if (teamId && isObjectIdText(teamId)) {
        config["teamId"] = teamId;
      }

      if (!config["userId"] && !config["teamId"]) {
        throw new BadDataException(`${label}: choose a user, a team, or both.`);
      }

      return config;
    }

    case SecurityPlaybookActionType.SetCasePriority:
      return {
        priorityId: requireId(rawConfig, "priorityId", label, "a priority"),
      };

    case SecurityPlaybookActionType.SetCaseStatus: {
      const statusId: string = requireId(
        rawConfig,
        "statusId",
        label,
        "a status",
      );
      const verdict: string = readText(rawConfig, "verdict");

      /*
       * Whether the status closes a case - and so needs the verdict - is
       * the project's list's to say (validateSecurityPlaybookStepValues).
       */
      return isSecurityCaseVerdict(verdict)
        ? { statusId, verdict }
        : { statusId };
    }

    case SecurityPlaybookActionType.AddCaseNote: {
      const note: string = readText(rawConfig, "note");

      if (!note) {
        throw new BadDataException(`${label}: write the note.`);
      }

      if (note.length > SECURITY_PLAYBOOK_NOTE_MAX_LENGTH) {
        throw new BadDataException(
          `${label}: the note is longer than ${SECURITY_PLAYBOOK_NOTE_MAX_LENGTH} characters.`,
        );
      }

      return { note };
    }

    case SecurityPlaybookActionType.AddCaseLabels: {
      const labelIds: Array<string> = readIdList(rawConfig, "labelIds");

      if (labelIds.length === 0) {
        throw new BadDataException(`${label}: choose at least one label.`);
      }

      return { labelIds };
    }

    case SecurityPlaybookActionType.CheckThreatIntel: {
      const raisePriorityToId: string = readText(
        rawConfig,
        "raisePriorityToId",
      );

      return raisePriorityToId && isObjectIdText(raisePriorityToId)
        ? { raisePriorityToId }
        : {};
    }

    case SecurityPlaybookActionType.LookUpEntityActivity: {
      const raw: JSONValue | undefined = rawConfig["lookbackInHours"];
      const hours: number =
        typeof raw === "number"
          ? raw
          : typeof raw === "string" && raw.trim()
            ? Number(raw)
            : ENTITY_ACTIVITY_LOOKBACK_DEFAULT_HOURS;

      if (
        !Number.isInteger(hours) ||
        hours < ENTITY_ACTIVITY_LOOKBACK_MIN_HOURS ||
        hours > ENTITY_ACTIVITY_LOOKBACK_MAX_HOURS
      ) {
        throw new BadDataException(
          `${label}: look back a whole number of hours, ${ENTITY_ACTIVITY_LOOKBACK_MIN_HOURS} to ${ENTITY_ACTIVITY_LOOKBACK_MAX_HOURS}.`,
        );
      }

      return { lookbackInHours: hours };
    }

    case SecurityPlaybookActionType.EmailPeople: {
      const userIds: Array<string> = readIdList(rawConfig, "userIds");
      const teamIds: Array<string> = readIdList(rawConfig, "teamIds");
      const message: string = readText(rawConfig, "message");

      if (userIds.length === 0 && teamIds.length === 0) {
        throw new BadDataException(`${label}: choose who to email.`);
      }

      if (message.length > SECURITY_PLAYBOOK_NOTE_MAX_LENGTH) {
        throw new BadDataException(
          `${label}: the message is longer than ${SECURITY_PLAYBOOK_NOTE_MAX_LENGTH} characters.`,
        );
      }

      return { userIds, teamIds, ...(message ? { message } : {}) };
    }

    case SecurityPlaybookActionType.PostToSlack:
    case SecurityPlaybookActionType.PostToMicrosoftTeams: {
      const channelName: string = readText(rawConfig, "channelName").replace(
        /^#/,
        "",
      );
      const message: string = readText(rawConfig, "message");

      if (!channelName) {
        throw new BadDataException(`${label}: name the channel to post to.`);
      }

      if (message.length > SECURITY_PLAYBOOK_NOTE_MAX_LENGTH) {
        throw new BadDataException(
          `${label}: the message is longer than ${SECURITY_PLAYBOOK_NOTE_MAX_LENGTH} characters.`,
        );
      }

      // A Microsoft Teams channel is named within a team.
      if (action === SecurityPlaybookActionType.PostToMicrosoftTeams) {
        const microsoftTeamsTeamId: string = readText(
          rawConfig,
          "microsoftTeamsTeamId",
        );

        if (!microsoftTeamsTeamId) {
          throw new BadDataException(
            `${label}: choose the team the channel is in.`,
          );
        }

        return {
          channelName,
          microsoftTeamsTeamId,
          ...(message ? { message } : {}),
        };
      }

      return { channelName, ...(message ? { message } : {}) };
    }

    case SecurityPlaybookActionType.PageOnCall:
      return {
        onCallPolicyId: requireId(
          rawConfig,
          "onCallPolicyId",
          label,
          "the on-call policy to run",
        ),
      };

    case SecurityPlaybookActionType.DeclareIncident:
      return {
        incidentSeverityId: requireId(
          rawConfig,
          "incidentSeverityId",
          label,
          "the incident's severity",
        ),
      };

    case SecurityPlaybookActionType.SuspendOktaUser:
    case SecurityPlaybookActionType.EndOktaSessions:
    case SecurityPlaybookActionType.ContainCrowdStrikeHost:
    case SecurityPlaybookActionType.UnsuspendOktaUser:
    case SecurityPlaybookActionType.LiftCrowdStrikeContainment:
    case SecurityPlaybookActionType.ReleaseDefenderDevice:
      return {
        connectionId: requireId(
          rawConfig,
          "connectionId",
          label,
          "the connection to act through",
        ),
      };

    case SecurityPlaybookActionType.IsolateDefenderDevice: {
      const isolationType: string = readText(rawConfig, "isolationType");

      return {
        connectionId: requireId(
          rawConfig,
          "connectionId",
          label,
          "the connection to act through",
        ),
        isolationType:
          isolationType === DefenderIsolationType.Selective
            ? DefenderIsolationType.Selective
            : DefenderIsolationType.Full,
      };
    }

    case SecurityPlaybookActionType.SendWebhook: {
      const url: string = readText(rawConfig, "url");

      if (!WEBHOOK_URL.test(url)) {
        throw new BadDataException(
          `${label}: enter the URL to send to, starting with https:// or http://.`,
        );
      }

      return { url };
    }

    case SecurityPlaybookActionType.RunWorkflow:
      return {
        workflowId: requireId(
          rawConfig,
          "workflowId",
          label,
          "the workflow to run",
        ),
      };
  }
}

function readApprovalTurnedOff(
  value: JSONValue | undefined,
): SecurityPlaybookApprovalTurnedOff | undefined {
  const record: JSONObject = readObject(value);
  const at: JSONValue | undefined = record["at"];
  const byUserId: JSONValue | undefined = record["byUserId"];

  if (typeof at !== "string" || !at) {
    return undefined;
  }

  return {
    ...(typeof byUserId === "string" && isObjectIdText(byUserId)
      ? { byUserId }
      : {}),
    at,
  };
}

/*
 * Whether a run stops before this step for a person to approve it: a step
 * marked so, and every containment step that no Security Admin let run
 * without approval - a step saved with approval off before that took a
 * Security Admin waits too.
 */
export function doesStepNeedApproval(step: SecurityPlaybookStep): boolean {
  if (step.requiresApproval) {
    return true;
  }

  return Boolean(
    getSecurityPlaybookAction(step.action)?.isDisruptive &&
      !step.approvalTurnedOff,
  );
}

/*
 * Reads a playbook's steps from what was stored or posted (an array, or the
 * JSON text of one) into clean steps. Throws BadDataException, naming the
 * step, for anything a run could not carry out. A containment step needs
 * approval unless it says false outright; whether it may say so is the
 * playbook service's to decide.
 */
export function parseSecurityPlaybookSteps(
  value: unknown,
): Array<SecurityPlaybookStep> {
  let raw: unknown = value;

  if (typeof raw === "string") {
    const text: string = raw.trim();

    if (!text) {
      return [];
    }

    try {
      raw = JSON.parse(text);
    } catch {
      throw new BadDataException("Playbook steps are not valid JSON.");
    }
  }

  if (raw === null || raw === undefined) {
    return [];
  }

  if (!Array.isArray(raw)) {
    throw new BadDataException("Playbook steps must be a list.");
  }

  if (raw.length > SECURITY_PLAYBOOK_MAX_STEPS) {
    throw new BadDataException(
      `A playbook can have at most ${SECURITY_PLAYBOOK_MAX_STEPS} steps.`,
    );
  }

  const seenIds: Set<string> = new Set<string>();

  return raw.map((item: unknown, index: number): SecurityPlaybookStep => {
    const step: JSONObject = readObject(item as JSONValue);
    const action: JSONValue | undefined = step["action"];

    if (!isSecurityPlaybookActionType(action)) {
      throw new BadDataException(
        `Step ${index + 1}: "${String(action ?? "")}" is not an action a playbook can run.`,
      );
    }

    const label: string = stepLabel(index, action);

    let id: string = typeof step["id"] === "string" ? step["id"].trim() : "";

    if (!id || seenIds.has(id)) {
      id = ObjectID.generate().toString();
    }

    seenIds.add(id);

    const isDisruptive: boolean = Boolean(
      getSecurityPlaybookAction(action)?.isDisruptive,
    );
    const requiresApproval: boolean = isDisruptive
      ? step["requiresApproval"] !== false
      : step["requiresApproval"] === true;
    const approvalTurnedOff: SecurityPlaybookApprovalTurnedOff | undefined =
      isDisruptive && !requiresApproval
        ? readApprovalTurnedOff(step["approvalTurnedOff"])
        : undefined;

    return {
      id,
      action,
      config: normalizeSecurityPlaybookStepConfig(
        action,
        readObject(step["config"]),
        label,
      ),
      requiresApproval,
      continueOnFailure: step["continueOnFailure"] === true,
      onlyIfThreatIntelMatched: step["onlyIfThreatIntelMatched"] === true,
      ...(approvalTurnedOff ? { approvalTurnedOff } : {}),
    };
  });
}
