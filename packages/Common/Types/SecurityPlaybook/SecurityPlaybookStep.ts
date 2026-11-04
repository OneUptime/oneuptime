import ColumnLength from "../Database/ColumnLength";
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
import {
  SecurityPlaybookConditionMatch,
  SecurityPlaybookStepCondition,
  SecurityPlaybookStepOutcome,
  SecurityPlaybookStepRunIf,
  getSecurityPlaybookConditionMatch,
  getSecurityPlaybookFinds,
  getSecurityPlaybookStepConditions,
  getSecurityPlaybookStepOutcomes,
  readSecurityPlaybookStepCondition,
} from "./SecurityPlaybookStepCondition";

/*
 * One step of a playbook: an action, its settings, and what shapes how a
 * run treats it.
 *
 *  - requiresApproval: the run stops before the step and waits for a person
 *    to approve or reject it on the case. Rejecting ends the run. A
 *    containment step always waits, unless a Security Admin turned that off
 *    (approvalTurnedOff, which only the server writes; doesStepNeedApproval).
 *  - continueOnFailure: a failed step does not stop the steps after it.
 *  - runIf: the step runs only after an earlier step's result - it
 *    succeeded or failed, or, for a step that looks something up, it found
 *    something or found nothing - or after several, all of them or any one,
 *    and is skipped otherwise (SecurityPlaybookStepCondition). Two steps
 *    waiting on opposite results of one step are an if and an else.
 *  - onlyIfThreatIntelMatched: the step runs only when any earlier Check
 *    Threat Intel step of the same run found a known-bad entity. What
 *    playbooks saved before runIf branch with; still honoured, and still
 *    shown on the steps that have it.
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
  // Runs only after this result of an earlier step, or these; always when absent.
  runIf?: SecurityPlaybookStepRunIf | undefined;
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

/*
 * Tasks for the case's checklist (SecurityCaseTask), one a line, each
 * handed to the person named - a project member - or to nobody.
 */
export interface AddCaseTasksConfig {
  tasks: Array<string>;
  assigneeUserId?: string | undefined;
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

/*
 * Who is emailed is the case's to say: the owners of each data store it
 * names. A message of the playbook's own leads the email.
 */
export interface NotifyDataStoreOwnersConfig {
  // Markdown with {{case.*}} placeholders; a note of the case and the store when empty.
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

export interface RunRunbookConfig {
  runbookId: string;
}

/*
 * Stop the run: why, in a sentence of the playbook's own, said on the case
 * when the run stops there ("Nothing known-bad: nothing to contain").
 */
export interface StopRunConfig {
  reason?: string | undefined;
}

/*
 * Posted as written: nothing of the case is put into it, so nothing about
 * an investigation reaches a public page unless somebody wrote it there.
 */
export interface PostStatusPageAnnouncementConfig {
  statusPageIds: Array<string>;
  announcementTitle: string;
  // Markdown.
  announcementDescription: string;
  // Email, SMS and the rest to the pages' subscribers; off unless asked for.
  notifySubscribers?: boolean | undefined;
}

// Who may let a containment step run without approval: a Security Admin, or above.
export const TURN_OFF_CONTAINMENT_APPROVAL_PERMISSIONS: ReadonlyArray<Permission> =
  [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.SecurityAdmin];

export const SECURITY_PLAYBOOK_MAX_STEPS: number = 25;
export const SECURITY_PLAYBOOK_NOTE_MAX_LENGTH: number = 10000;
// The most tasks one Add tasks step adds, and how long each may be.
export const SECURITY_PLAYBOOK_MAX_TASKS_PER_STEP: number = 20;
export const SECURITY_PLAYBOOK_TASK_MAX_LENGTH: number = ColumnLength.LongText;
export const ENTITY_ACTIVITY_LOOKBACK_MIN_HOURS: number = 1;
export const ENTITY_ACTIVITY_LOOKBACK_MAX_HOURS: number = 720;
export const ENTITY_ACTIVITY_LOOKBACK_DEFAULT_HOURS: number = 24;
// A status page announcement's title is a short text column.
export const ANNOUNCEMENT_TITLE_MAX_LENGTH: number = 100;
// What a Stop step says on the case when the run stops there: a sentence.
export const SECURITY_PLAYBOOK_STOP_REASON_MAX_LENGTH: number = 500;

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

    case SecurityPlaybookActionType.AddCaseTasks: {
      const tasks: Array<string> = readTaskLines(rawConfig["tasks"]);
      const assigneeUserId: string = readText(rawConfig, "assigneeUserId");

      if (tasks.length === 0) {
        throw new BadDataException(`${label}: write at least one task.`);
      }

      if (tasks.length > SECURITY_PLAYBOOK_MAX_TASKS_PER_STEP) {
        throw new BadDataException(
          `${label}: a step adds at most ${SECURITY_PLAYBOOK_MAX_TASKS_PER_STEP} tasks; this one has ${tasks.length}.`,
        );
      }

      const tooLong: string | undefined = tasks.find(
        (task: string): boolean => {
          return task.length > SECURITY_PLAYBOOK_TASK_MAX_LENGTH;
        },
      );

      if (tooLong) {
        throw new BadDataException(
          `${label}: a task can be at most ${SECURITY_PLAYBOOK_TASK_MAX_LENGTH} characters. Keep each to a line.`,
        );
      }

      return assigneeUserId && isObjectIdText(assigneeUserId)
        ? { tasks, assigneeUserId }
        : { tasks };
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

    case SecurityPlaybookActionType.NotifyDataStoreOwners: {
      const message: string = readText(rawConfig, "message");

      if (message.length > SECURITY_PLAYBOOK_NOTE_MAX_LENGTH) {
        throw new BadDataException(
          `${label}: the message is longer than ${SECURITY_PLAYBOOK_NOTE_MAX_LENGTH} characters.`,
        );
      }

      return message ? { message } : {};
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
    case SecurityPlaybookActionType.DisableEntraIdUser:
    case SecurityPlaybookActionType.SignOutEntraIdUser:
    case SecurityPlaybookActionType.SuspendGoogleWorkspaceUser:
    case SecurityPlaybookActionType.SignOutGoogleWorkspaceUser:
    case SecurityPlaybookActionType.UnsuspendOktaUser:
    case SecurityPlaybookActionType.LiftCrowdStrikeContainment:
    case SecurityPlaybookActionType.ReleaseDefenderDevice:
    case SecurityPlaybookActionType.EnableEntraIdUser:
    case SecurityPlaybookActionType.UnsuspendGoogleWorkspaceUser:
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

    case SecurityPlaybookActionType.RunRunbook:
      return {
        runbookId: requireId(
          rawConfig,
          "runbookId",
          label,
          "the runbook to run",
        ),
      };

    case SecurityPlaybookActionType.PostStatusPageAnnouncement: {
      const statusPageIds: Array<string> = readIdList(
        rawConfig,
        "statusPageIds",
      );
      const announcementTitle: string = readText(
        rawConfig,
        "announcementTitle",
      );
      const announcementDescription: string = readText(
        rawConfig,
        "announcementDescription",
      );

      if (statusPageIds.length === 0) {
        throw new BadDataException(
          `${label}: choose the status pages to post on.`,
        );
      }

      if (!announcementTitle) {
        throw new BadDataException(`${label}: write the announcement's title.`);
      }

      if (announcementTitle.length > ANNOUNCEMENT_TITLE_MAX_LENGTH) {
        throw new BadDataException(
          `${label}: the title is longer than ${ANNOUNCEMENT_TITLE_MAX_LENGTH} characters.`,
        );
      }

      if (!announcementDescription) {
        throw new BadDataException(
          `${label}: write what the announcement says.`,
        );
      }

      if (announcementDescription.length > SECURITY_PLAYBOOK_NOTE_MAX_LENGTH) {
        throw new BadDataException(
          `${label}: the announcement is longer than ${SECURITY_PLAYBOOK_NOTE_MAX_LENGTH} characters.`,
        );
      }

      return {
        statusPageIds,
        announcementTitle,
        announcementDescription,
        notifySubscribers: rawConfig["notifySubscribers"] === true,
      };
    }

    case SecurityPlaybookActionType.StopRun: {
      const reason: string = readText(rawConfig, "reason");

      if (reason.length > SECURITY_PLAYBOOK_STOP_REASON_MAX_LENGTH) {
        throw new BadDataException(
          `${label}: say why it stops in at most ${SECURITY_PLAYBOOK_STOP_REASON_MAX_LENGTH} characters.`,
        );
      }

      return reason ? { reason } : {};
    }

    // Nothing to set: each reads what it acts on from the case.
    case SecurityPlaybookActionType.PreserveEvidence:
    case SecurityPlaybookActionType.FixWithAi:
    case SecurityPlaybookActionType.BlockDataStorePublicAccess:
    case SecurityPlaybookActionType.RevokeDataStoreSharing:
      return {};
  }
}

/*
 * The tasks of an Add tasks step: a list, or text with one a line, each
 * trimmed, without empty lines or the same task twice.
 */
export function readTaskLines(value: JSONValue | undefined): Array<string> {
  const lines: Array<unknown> = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split("\n")
      : [];
  const tasks: Array<string> = [];

  for (const line of lines) {
    const task: string = typeof line === "string" ? line.trim() : "";

    if (task && !tasks.includes(task)) {
      tasks.push(task);
    }
  }

  return tasks;
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
    // A step that stops the run does nothing to approve, and cannot fail.
    const stopsTheRun: boolean = action === SecurityPlaybookActionType.StopRun;
    const requiresApproval: boolean = stopsTheRun
      ? false
      : isDisruptive
        ? step["requiresApproval"] !== false
        : step["requiresApproval"] === true;
    const approvalTurnedOff: SecurityPlaybookApprovalTurnedOff | undefined =
      isDisruptive && !requiresApproval
        ? readApprovalTurnedOff(step["approvalTurnedOff"])
        : undefined;
    const runIf: SecurityPlaybookStepRunIf | undefined =
      readSecurityPlaybookStepCondition(step["runIf"], label);

    return {
      id,
      action,
      config: normalizeSecurityPlaybookStepConfig(
        action,
        readObject(step["config"]),
        label,
      ),
      requiresApproval,
      continueOnFailure: !stopsTheRun && step["continueOnFailure"] === true,
      onlyIfThreatIntelMatched: step["onlyIfThreatIntelMatched"] === true,
      ...(runIf ? { runIf } : {}),
      ...(approvalTurnedOff ? { approvalTurnedOff } : {}),
    };
  });
}

// Whether a step waits on this step's result, among any it waits on.
export function doesStepWaitOn(
  step: Pick<SecurityPlaybookStep, "runIf">,
  stepId: string,
): boolean {
  return getSecurityPlaybookStepConditions(step.runIf).some(
    (condition: SecurityPlaybookStepCondition): boolean => {
      return condition.stepId === stepId;
    },
  );
}

/*
 * The steps a step's own result is waited on by: every later step with a
 * condition that names it. What keeps it from being deleted, or moved
 * below one of them.
 */
export function getStepsWaitingOn(
  steps: ReadonlyArray<SecurityPlaybookStep>,
  stepId: string,
): Array<{ index: number; step: SecurityPlaybookStep }> {
  const waiting: Array<{ index: number; step: SecurityPlaybookStep }> = [];

  steps.forEach((step: SecurityPlaybookStep, index: number): void => {
    if (doesStepWaitOn(step, stepId)) {
      waiting.push({ index, step });
    }
  });

  return waiting;
}

/*
 * THE BRANCHING RULE, checked across the whole list when a playbook is
 * saved, for every result a step waits on: a step waits only on a step
 * before it, on a result that step can have - found or found nothing for
 * one that looks something up, succeeded otherwise - on its failure only
 * when that step carries on past one, and never on a step that stops the
 * run, after which nothing runs. A step waiting on all of its results never
 * waits on two results of one step, and a Stop step that always runs is the
 * last. Throws a message that names the step and says what to change. Runs
 * already under way keep the steps they started with, which the engine
 * reads as they are (evaluateSecurityPlaybookStepCondition).
 */
export function assertSecurityPlaybookStepConditions(
  steps: ReadonlyArray<SecurityPlaybookStep>,
): void {
  steps.forEach((step: SecurityPlaybookStep, index: number): void => {
    const conditions: Array<SecurityPlaybookStepCondition> =
      getSecurityPlaybookStepConditions(step.runIf);

    for (const condition of conditions) {
      assertStepCondition({ steps, step, index, condition });
    }

    /*
     * A Stop step that always runs ends every run where it is: a step after
     * it would never run.
     */
    if (
      step.action === SecurityPlaybookActionType.StopRun &&
      conditions.length === 0 &&
      !step.onlyIfThreatIntelMatched &&
      index < steps.length - 1
    ) {
      throw new BadDataException(
        `${stepLabel(index, step.action)}: it always stops the run, so the steps after it would never run. Make it run only after an earlier step's result, or move it to the end.`,
      );
    }

    /*
     * Waiting on all of two results of one step - it found something and
     * found nothing - is waiting on what never happens.
     */
    if (
      getSecurityPlaybookConditionMatch(step.runIf) ===
      SecurityPlaybookConditionMatch.All
    ) {
      const firstClash: SecurityPlaybookStepCondition | undefined =
        conditions.find((condition: SecurityPlaybookStepCondition): boolean => {
          return conditions.some(
            (other: SecurityPlaybookStepCondition): boolean => {
              return (
                other.stepId === condition.stepId &&
                other.outcome !== condition.outcome
              );
            },
          );
        });

      if (firstClash) {
        const waitedOn: number = steps.findIndex(
          (candidate: SecurityPlaybookStep): boolean => {
            return candidate.id === firstClash.stepId;
          },
        );

        throw new BadDataException(
          `${stepLabel(index, step.action)}: it waits on two results of step ${waitedOn + 1}, which one run never has together. Choose one of them, or run it when any of its results happened.`,
        );
      }
    }
  });
}

function assertStepCondition(data: {
  steps: ReadonlyArray<SecurityPlaybookStep>;
  step: SecurityPlaybookStep;
  index: number;
  condition: SecurityPlaybookStepCondition;
}): void {
  const { steps, step, index, condition } = data;
  const label: string = stepLabel(index, step.action);
  const waitedOn: number = steps.findIndex(
    (candidate: SecurityPlaybookStep): boolean => {
      return candidate.id === condition.stepId;
    },
  );

  if (waitedOn < 0) {
    throw new BadDataException(
      `${label}: the step it runs after is no longer in the playbook. Choose again when it runs.`,
    );
  }

  if (waitedOn >= index) {
    throw new BadDataException(
      waitedOn === index
        ? `${label}: a step cannot run after its own result. Choose an earlier step.`
        : `${label}: it runs after step ${waitedOn + 1}, which comes after it. Move it below step ${waitedOn + 1}, or choose again when it runs.`,
    );
  }

  const earlier: SecurityPlaybookStep = steps[waitedOn]!;
  const earlierTitle: string =
    getSecurityPlaybookAction(earlier.action)?.title || earlier.action;

  if (earlier.action === SecurityPlaybookActionType.StopRun) {
    throw new BadDataException(
      `${label}: step ${waitedOn + 1} (${earlierTitle}) ends the run when it runs, so no step after it can wait on it. Choose another step.`,
    );
  }

  if (
    condition.outcome === SecurityPlaybookStepOutcome.Failed &&
    !earlier.continueOnFailure
  ) {
    throw new BadDataException(
      `${label}: it runs only if step ${waitedOn + 1} (${earlierTitle}) fails, but a failed step ${waitedOn + 1} stops the run. Turn on Carry On If It Fails for step ${waitedOn + 1}, or choose again when this step runs.`,
    );
  }

  if (!getSecurityPlaybookStepOutcomes(earlier).includes(condition.outcome)) {
    throw new BadDataException(
      getSecurityPlaybookFinds(earlier.action)
        ? `${label}: step ${waitedOn + 1} (${earlierTitle}) looks something up, so it finds something or finds nothing. Choose one of those.`
        : `${label}: step ${waitedOn + 1} (${earlierTitle}) does not look anything up, so it can only succeed or fail. Choose one of those.`,
    );
  }
}
