import { JSONObject } from "../JSON";
import WorkspaceType from "./WorkspaceType";

/*
 * ON-CALL USER GROUPS.
 *
 * "We have a number of @teamname-oncall user group in Slack that is always
 * updated with the on-call person(s) - usually primary and sometimes
 * primary + secondary oncall. How can we achieve this?" (customer feedback)
 *
 * A Slack user group, or a Microsoft Teams tag, can follow one or more
 * on-call schedules: OneUptime keeps its members equal to whoever is on call
 * in them right now - at every hand-off, override, skip and layer edit - so
 * anyone can @mention it to reach them. The people are the ones each
 * schedule's page says are on call now (its roster: layers, people who are
 * away skipped, covers in their place).
 *
 * Linking a group replaces whoever was in it. Unlinking it from its last
 * schedule leaves it as it is: OneUptime stops changing it.
 *
 * When nobody is on call in any schedule a group follows, Slack cannot hold
 * an empty user group, so OneUptime turns the group off until somebody is on
 * call again, and turns it back on then. A Microsoft Teams tag is emptied the
 * same way.
 */

// Why the last sync of a group could not keep it in step.
export enum WorkspaceUserGroupProblem {
  // The project is not connected to the workspace any more.
  NotConnected = "NotConnected",
  // Slack: user groups need a paid Slack plan.
  PaidPlanNeeded = "PaidPlanNeeded",
  /*
   * Slack: OneUptime's app was installed before it asked to manage user
   * groups (usergroups:read and usergroups:write).
   */
  MissingScope = "MissingScope",
  /*
   * Slack: only workspace owners and admins may change user groups there -
   * Slack's default - so OneUptime's app may not.
   */
  AdminsOnly = "AdminsOnly",
  /*
   * Microsoft Teams: the Microsoft 365 tenant has not let OneUptime manage
   * tags (the TeamworkTag.ReadWrite.All application permission).
   */
  MissingPermission = "MissingPermission",
  // The user group, or the tag, is gone from the workspace.
  Gone = "Gone",
  // Microsoft Teams: the team is gone, or OneUptime's app is not in it.
  TeamGone = "TeamGone",
  /*
   * Slack: somebody turned the user group off, so it cannot be mentioned.
   * OneUptime keeps its members up to date but leaves it off.
   */
  TurnedOffInWorkspace = "TurnedOffInWorkspace",
  // The workspace did not answer, or asked OneUptime to slow down.
  Unavailable = "Unavailable",
  // Anything else the workspace refused; problemDetail holds its words.
  Refused = "Refused",
}

// Why somebody on call is not in the group.
export enum WorkspaceUserGroupLeftOutReason {
  /*
   * OneUptime cannot find them in the workspace: their account there is not
   * connected to OneUptime, and none has their email address.
   */
  NotFound = "NotFound",
  // A guest: Slack does not put guests in user groups.
  Guest = "Guest",
  // Their account in the workspace is deactivated.
  Deactivated = "Deactivated",
  // Microsoft Teams: not a member of the team the tag is in.
  NotInTeam = "NotInTeam",
}

// Somebody OneUptime put in a group: who they are, and who in the workspace.
export interface WorkspaceUserGroupMember {
  userId: string;
  workspaceUserId: string;
}

// Somebody on call who is not in the group, and why.
export interface WorkspaceUserGroupLeftOut {
  userId: string;
  reason: WorkspaceUserGroupLeftOutReason;
}

// What the last sync of a group came to (WorkspaceUserGroup.syncState).
export interface WorkspaceUserGroupSyncState {
  // Who OneUptime put in the group.
  members: Array<WorkspaceUserGroupMember>;
  // Who is on call in a schedule it follows but could not be put in it.
  leftOut: Array<WorkspaceUserGroupLeftOut>;
  /*
   * Nobody was on call, so OneUptime turned the Slack user group off, or
   * emptied the Microsoft Teams tag, until somebody is.
   */
  isTurnedOff: boolean;
  // What stopped the last sync; null when nothing did.
  problem: WorkspaceUserGroupProblem | null;
  // For Refused: what the workspace said ("invalid_users").
  problemDetail?: string | undefined;
  // When OneUptime last looked at the group (ISO 8601).
  checkedAt: string;
}

// How often OneUptime looks at a group that is in step, to undo hand edits.
export const WORKSPACE_USER_GROUP_CHECK_EVERY_MINUTES: number = 15;

/*
 * How soon OneUptime tries again after the workspace did not answer, or
 * asked it to slow down.
 */
export const WORKSPACE_USER_GROUP_RETRY_UNAVAILABLE_MINUTES: number = 2;

/*
 * How soon it tries again after a refusal somebody has to fix: a plan, a
 * permission, a setting. Pressing Try again tries at once.
 */
export const WORKSPACE_USER_GROUP_RETRY_REFUSED_MINUTES: number = 60;

/*
 * Slack user group handles: what OneUptime accepts (Slack documents no
 * length; past this it decides), and the length of one it suggests.
 */
export const SLACK_USER_GROUP_HANDLE_MAX_LENGTH: number = 80;
export const SLACK_USER_GROUP_SUGGESTED_HANDLE_MAX_LENGTH: number = 32;
export const SLACK_USER_GROUP_NAME_MAX_LENGTH: number = 100;

// Microsoft Teams tags: a name holds 40 characters.
export const MICROSOFT_TEAMS_TAG_NAME_MAX_LENGTH: number = 40;

// Microsoft Teams: a tag holds 200 people, and a new one starts with 25.
export const MICROSOFT_TEAMS_TAG_MAX_MEMBERS: number = 200;
export const MICROSOFT_TEAMS_TAG_MAX_MEMBERS_ON_CREATE: number = 25;

// What the suggested name and handle add to the schedule's name.
const SUGGESTED_NAME_SUFFIX: string = " on-call";
const SUGGESTED_HANDLE_SUFFIX: string = "-oncall";

const WHITE_SPACE_RUN: RegExp = /\s+/;

/*
 * The names a new user group or tag is offered for a schedule: "Payments
 * Primary on-call", handle "payments-primary-oncall". The handle keeps
 * lower-case letters and digits (accents taken off: "Café" is "cafe"),
 * joined by single hyphens, and is cut to a short handle - at a hyphen when
 * it can be - keeping the "-oncall" that says what it is.
 */
export function getSuggestedUserGroupName(data: {
  scheduleName: string;
  maxLength: number;
}): string {
  const scheduleName: string = collapseWhiteSpace(data.scheduleName);
  const base: string = scheduleName || "On-call";
  const full: string = `${base}${SUGGESTED_NAME_SUFFIX}`;

  if (full.length <= data.maxLength) {
    return full;
  }

  const room: number = Math.max(
    1,
    data.maxLength - SUGGESTED_NAME_SUFFIX.length,
  );

  return `${base.substring(0, room).trimEnd()}${SUGGESTED_NAME_SUFFIX}`;
}

export function getSuggestedSlackHandle(scheduleName: string): string {
  let slug: string = "";
  let pendingHyphen: boolean = false;

  for (const character of (scheduleName || "").normalize("NFD").toLowerCase()) {
    const code: number = character.charCodeAt(0);

    // An accent's combining mark: "é" is "e" and this.
    if (code >= 0x300 && code <= 0x36f) {
      continue;
    }

    const isWordCharacter: boolean =
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9");

    if (!isWordCharacter) {
      pendingHyphen = slug.length > 0;
      continue;
    }

    if (pendingHyphen) {
      slug += "-";
      pendingHyphen = false;
    }

    slug += character;
  }

  const room: number =
    SLACK_USER_GROUP_SUGGESTED_HANDLE_MAX_LENGTH -
    SUGGESTED_HANDLE_SUFFIX.length;

  if (slug.length > room) {
    const cut: string = slug.substring(0, room);
    // Cut between two words: the cut keeps them whole.
    const isAtWordEnd: boolean = slug[room] === "-";
    const lastHyphen: number = cut.lastIndexOf("-");
    slug = isAtWordEnd || lastHyphen <= 0 ? cut : cut.substring(0, lastHyphen);
  }

  slug = trimHyphens(slug);

  return `${slug || "team"}${SUGGESTED_HANDLE_SUFFIX}`;
}

/*
 * Whether Slack could take `handle` as a user group's handle: lower-case
 * letters, digits, ".", "_" and "-", starting with a letter or a digit.
 * Slack decides the rest (a handle somebody has already).
 */
export function isValidSlackUserGroupHandle(handle: string): boolean {
  if (!handle || handle.length > SLACK_USER_GROUP_HANDLE_MAX_LENGTH) {
    return false;
  }

  for (let index: number = 0; index < handle.length; index++) {
    const character: string = handle[index]!;
    const isLetterOrDigit: boolean =
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9");

    if (index === 0 && !isLetterOrDigit) {
      return false;
    }

    if (
      !isLetterOrDigit &&
      character !== "-" &&
      character !== "_" &&
      character !== "."
    ) {
      return false;
    }
  }

  return true;
}

// A handle as people type it: "@payments-oncall" is "payments-oncall".
export function readSlackUserGroupHandle(value: string): string {
  let handle: string = (value || "").trim().toLowerCase();

  while (handle.startsWith("@")) {
    handle = handle.substring(1);
  }

  return handle;
}

/*
 * A stored sync state as it is: anything a row holds that is not one comes
 * back as "never synced". Read off a JSON column, it is never trusted
 * further than its shape.
 */
export function readWorkspaceUserGroupSyncState(
  value: unknown,
): WorkspaceUserGroupSyncState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: JSONObject = value as JSONObject;

  const problem: WorkspaceUserGroupProblem | null = Object.values(
    WorkspaceUserGroupProblem,
  ).includes(json["problem"] as WorkspaceUserGroupProblem)
    ? (json["problem"] as WorkspaceUserGroupProblem)
    : null;

  const members: Array<WorkspaceUserGroupMember> = (
    Array.isArray(json["members"]) ? (json["members"] as Array<unknown>) : []
  )
    .map((member: unknown): WorkspaceUserGroupMember | null => {
      const entry: JSONObject = (member || {}) as JSONObject;

      if (
        typeof entry["userId"] !== "string" ||
        typeof entry["workspaceUserId"] !== "string"
      ) {
        return null;
      }

      return {
        userId: entry["userId"] as string,
        workspaceUserId: entry["workspaceUserId"] as string,
      };
    })
    .filter((member: WorkspaceUserGroupMember | null): boolean => {
      return member !== null;
    }) as Array<WorkspaceUserGroupMember>;

  const leftOut: Array<WorkspaceUserGroupLeftOut> = (
    Array.isArray(json["leftOut"]) ? (json["leftOut"] as Array<unknown>) : []
  )
    .map((person: unknown): WorkspaceUserGroupLeftOut | null => {
      const entry: JSONObject = (person || {}) as JSONObject;

      if (
        typeof entry["userId"] !== "string" ||
        !Object.values(WorkspaceUserGroupLeftOutReason).includes(
          entry["reason"] as WorkspaceUserGroupLeftOutReason,
        )
      ) {
        return null;
      }

      return {
        userId: entry["userId"] as string,
        reason: entry["reason"] as WorkspaceUserGroupLeftOutReason,
      };
    })
    .filter((person: WorkspaceUserGroupLeftOut | null): boolean => {
      return person !== null;
    }) as Array<WorkspaceUserGroupLeftOut>;

  const state: WorkspaceUserGroupSyncState = {
    members: members,
    leftOut: leftOut,
    isTurnedOff: json["isTurnedOff"] === true,
    problem: problem,
    checkedAt:
      typeof json["checkedAt"] === "string"
        ? (json["checkedAt"] as string)
        : "",
  };

  if (typeof json["problemDetail"] === "string" && json["problemDetail"]) {
    state.problemDetail = json["problemDetail"] as string;
  }

  return state;
}

/*
 * THE SCHEDULE PAGE'S CARD.
 *
 * What the server hands the card for each group a schedule feeds
 * (GET /workspace-user-group/schedule/:scheduleId): the group, the
 * schedules it follows with who is on call in each, and how its last sync
 * went - names read, so the card draws it as it is.
 */
export interface WorkspaceUserGroupPersonView {
  userId: string;
  name: string;
  email: string;
}

export interface WorkspaceUserGroupScheduleView {
  scheduleId: string;
  name: string;
  // Who the schedule's page says is on call now; null for nobody.
  onCallNow: WorkspaceUserGroupPersonView | null;
}

export interface WorkspaceUserGroupLeftOutView
  extends WorkspaceUserGroupPersonView {
  reason: WorkspaceUserGroupLeftOutReason;
}

export interface WorkspaceUserGroupView {
  workspaceUserGroupId: string;
  workspaceType: WorkspaceType;
  // Slack: the group's name ("Payments on-call"). Teams: the tag's name.
  name: string;
  // Slack: its handle, without the "@" ("payments-oncall"). Teams: none.
  handle: string | null;
  // Teams: the team the tag is in.
  teamName: string | null;
  // This schedule first, then the others it follows, by name.
  schedules: Array<WorkspaceUserGroupScheduleView>;
  // Who OneUptime put in it at its last sync.
  members: Array<WorkspaceUserGroupPersonView>;
  // Who is on call but not in it, and why.
  leftOut: Array<WorkspaceUserGroupLeftOutView>;
  isTurnedOff: boolean;
  problem: WorkspaceUserGroupProblem | null;
  problemDetail: string | null;
  // When it last matched who was on call (ISO 8601); null for never.
  syncedAt: string | null;
  // When OneUptime last looked at it (ISO 8601); null for never.
  checkedAt: string | null;
}

/*
 * A user group the workspace has, as the Connect form offers it
 * (GET /workspace-user-group/available).
 */
export interface WorkspaceAvailableUserGroup {
  // The group's id in Slack (S0604QSJC), or the tag's in Teams.
  workspaceGroupId: string;
  name: string;
  handle: string | null;
  // How many people it has now; null when the workspace did not say.
  userCount: number | null;
  // Turned off in Slack.
  isTurnedOff: boolean;
  /*
   * The OneUptime user group record when one already keeps it in step: a
   * schedule connected to it is added to the schedules it follows.
   */
  workspaceUserGroupId: string | null;
  // The schedules it follows already, by name.
  followsScheduleNames: Array<string>;
}

// A Microsoft Teams team a tag can be in: one OneUptime's app is in.
export interface WorkspaceUserGroupTeam {
  teamId: string;
  name: string;
}

// What the Connect form sends (POST /workspace-user-group/connect).
export interface WorkspaceUserGroupConnectRequest {
  onCallDutyPolicyScheduleId: string;
  workspaceType: WorkspaceType;
  // An existing user group or tag, by its workspace id.
  workspaceGroupId?: string | undefined;
  // Slack: a new user group to create, with its name and handle.
  newGroupName?: string | undefined;
  newGroupHandle?: string | undefined;
  // Microsoft Teams: the team, and the tag's name (used, or created).
  workspaceTeamId?: string | undefined;
  tagName?: string | undefined;
}

// What a Slack user group's or a Teams tag's mention looks like.
export function getUserGroupMention(data: {
  workspaceType: WorkspaceType;
  name: string;
  handle: string | null;
}): string {
  if (data.workspaceType === WorkspaceType.Slack && data.handle) {
    return `@${data.handle}`;
  }

  return `@${data.name}`;
}

function collapseWhiteSpace(text: string): string {
  return (text || "").split(WHITE_SPACE_RUN).filter(Boolean).join(" ");
}

function trimHyphens(text: string): string {
  let start: number = 0;
  let end: number = text.length;

  while (start < end && text[start] === "-") {
    start++;
  }

  while (end > start && text[end - 1] === "-") {
    end--;
  }

  return text.substring(start, end);
}
