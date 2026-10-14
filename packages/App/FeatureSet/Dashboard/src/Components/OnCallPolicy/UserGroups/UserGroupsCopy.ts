import {
  getUserGroupMention,
  WorkspaceAvailableUserGroup,
  WorkspaceUserGroupLeftOutReason,
  WorkspaceUserGroupLeftOutView,
  WorkspaceUserGroupProblem,
  WorkspaceUserGroupView,
} from "Common/Types/Workspace/WorkspaceUserGroup";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT THE SCHEDULE PAGE'S USER GROUP CARD SAYS.
 *
 * Customer feedback #3: "We have a number of @teamname-oncall user group in
 * Slack that is always updated with the on-call person(s)". On an on-call
 * schedule's page, a card per connected chat workspace lists the Slack user
 * groups (Microsoft Teams tags) that follow the schedule - who is in each
 * now, the schedules it follows, and whether it is in step - with Connect
 * and Disconnect.
 *
 * Every sentence is here, whole, in English, for both workspaces - a
 * {{placeholder}} where a value goes - and is looked up in the reader's
 * language where it is drawn. React-free, so each decision is tested on its
 * own (App/Tests/Dashboard/OnCallUserGroupsCopy.test.ts).
 */

export interface UserGroupsWorkspaceCopy {
  // The workspace's name, as every list of them says it.
  workspaceName: string;
  title: string;
  description: string;
  connectButton: string;
  emptyTitle: string;
  emptyText: string;
  // The Connect dialog.
  connectTitle: string;
  connectDescription: string;
  // What the form calls one: "user group", "tag".
  groupNoun: string;
  // Turned off while nobody is on call.
  turnedOffText: string;
}

export const USER_GROUPS_COPY: Readonly<
  Record<WorkspaceType, UserGroupsWorkspaceCopy>
> = {
  [WorkspaceType.Slack]: {
    workspaceName: "Slack",
    title: translationKey("Slack user groups"),
    description: translationKey(
      "Keep a Slack user group's people equal to whoever is on call here, so anyone can @mention it to reach them.",
    ),
    connectButton: translationKey("Connect user group"),
    emptyTitle: translationKey("No user group yet"),
    emptyText: translationKey(
      "Connect one, such as @payments-oncall, and OneUptime keeps its people equal to whoever is on call here, at every hand-off and override.",
    ),
    connectTitle: translationKey("Connect a Slack user group"),
    connectDescription: translationKey(
      "OneUptime puts whoever is on call in this schedule in the group, in place of the people in it now, and keeps it up to date.",
    ),
    groupNoun: translationKey("user group"),
    turnedOffText: translationKey(
      "Nobody is on call now, so OneUptime turned {{mention}} off in Slack: Slack can't keep a user group with nobody in it. It turns it back on when somebody is on call.",
    ),
  },
  [WorkspaceType.MicrosoftTeams]: {
    workspaceName: "Microsoft Teams",
    title: translationKey("Microsoft Teams tags"),
    description: translationKey(
      "Keep a Microsoft Teams tag's people equal to whoever is on call here, so anyone can @mention it to reach them.",
    ),
    connectButton: translationKey("Connect tag"),
    emptyTitle: translationKey("No tag yet"),
    emptyText: translationKey(
      "Connect one, such as @Payments on-call, and OneUptime keeps its people equal to whoever is on call here, at every hand-off and override.",
    ),
    connectTitle: translationKey("Connect a Microsoft Teams tag"),
    connectDescription: translationKey(
      "OneUptime puts whoever is on call in this schedule in the tag, in place of the people in it now, and keeps it up to date. A tag holds only people in its team.",
    ),
    groupNoun: translationKey("tag"),
    turnedOffText: translationKey(
      "Nobody is on call now, so OneUptime took everybody out of {{mention}}. They go back in when somebody is on call.",
    ),
  },
};

/*
 * Disconnecting a group from this schedule: what stops, and what stays -
 * the other schedules it follows, by name when there is one.
 */
export const DISCONNECT_TEXT: Readonly<{
  title: string;
  last: string;
  oneOther: string;
  manyOthers: string;
  manyOthersOne: string;
}> = {
  title: translationKey("Disconnect {{mention}}?"),
  last: translationKey(
    "OneUptime stops updating {{mention}}. The people in it now stay in it.",
  ),
  oneOther: translationKey(
    "{{mention}} stops following this schedule. It keeps following {{schedule}}.",
  ),
  manyOthers: translationKey(
    "{{mention}} stops following this schedule. It keeps following {{count}} other schedules.",
  ),
  manyOthersOne: translationKey(
    "{{mention}} stops following this schedule. It keeps following {{count}} other schedule.",
  ),
};

// A Microsoft Teams tag's team, under its name.
export const TEAM_SUBTITLE: string = translationKey("In the {{team}} team");

// The labels the card's rows use.
export const USER_GROUP_LABELS: Readonly<{
  alsoFollows: string;
  inItNow: string;
  nobodyInIt: string;
  tryAgain: string;
  disconnect: string;
  connect: string;
}> = {
  alsoFollows: translationKey("Also follows"),
  inItNow: translationKey("In it now"),
  nobodyInIt: translationKey("Nobody"),
  tryAgain: translationKey("Try again"),
  disconnect: translationKey("Disconnect"),
  connect: translationKey("Connect"),
};

// Where a group stands, as its row's status pill says it.
export enum UserGroupStatusKind {
  // It holds whoever is on call.
  InStep = "InStep",
  // Linked a moment ago: OneUptime has not looked at it yet.
  NotYet = "NotYet",
  // Nobody on call: OneUptime turned it off (Slack) or emptied it (Teams).
  TurnedOff = "TurnedOff",
  // Its people are right, but somebody turned it off in Slack.
  TurnedOffInWorkspace = "TurnedOffInWorkspace",
  // The workspace refused: it is not up to date.
  Problem = "Problem",
}

export const USER_GROUP_STATUS_LABELS: Readonly<
  Record<UserGroupStatusKind, string>
> = {
  [UserGroupStatusKind.InStep]: translationKey("Up to date"),
  [UserGroupStatusKind.NotYet]: translationKey("Updating"),
  [UserGroupStatusKind.TurnedOff]: translationKey("Nobody on call"),
  [UserGroupStatusKind.TurnedOffInWorkspace]: translationKey(
    "Turned off in Slack",
  ),
  [UserGroupStatusKind.Problem]: translationKey("Not up to date"),
};

export const getUserGroupStatus: (
  view: WorkspaceUserGroupView,
) => UserGroupStatusKind = (
  view: WorkspaceUserGroupView,
): UserGroupStatusKind => {
  if (view.problem === WorkspaceUserGroupProblem.TurnedOffInWorkspace) {
    return UserGroupStatusKind.TurnedOffInWorkspace;
  }

  if (view.problem) {
    return UserGroupStatusKind.Problem;
  }

  if (!view.checkedAt) {
    return UserGroupStatusKind.NotYet;
  }

  if (view.isTurnedOff) {
    return UserGroupStatusKind.TurnedOff;
  }

  return UserGroupStatusKind.InStep;
};

// The time sentences: when it was last looked at, and last in step.
export const USER_GROUP_TIME_TEXT: Readonly<{
  checked: string;
  lastInStep: string;
  notYet: string;
}> = {
  checked: translationKey("Checked {{when}}"),
  lastInStep: translationKey("Last up to date {{when}}"),
  notYet: translationKey("OneUptime is putting whoever is on call in it."),
};

/*
 * What stops a group being kept in step, and what to do about it - one
 * sentence each, per workspace. {{mention}} is the group as people type it,
 * {{team}} a Teams tag's team, {{detail}} what the workspace said.
 */
const SLACK_PROBLEM_TEXT: Readonly<Record<WorkspaceUserGroupProblem, string>> =
  {
    [WorkspaceUserGroupProblem.NotConnected]: translationKey(
      "Slack is not connected to this project any more, so OneUptime can't update {{mention}}. Connect Slack again in Project Settings > Workspace > Slack.",
    ),
    [WorkspaceUserGroupProblem.PaidPlanNeeded]: translationKey(
      "Slack keeps user groups for paid plans, so OneUptime can't update {{mention}}. Upgrade your Slack workspace to use them.",
    ),
    [WorkspaceUserGroupProblem.MissingScope]: translationKey(
      "OneUptime's Slack app isn't allowed to change user groups yet. Reconnect Slack in Project Settings > Workspace > Slack to allow it.",
    ),
    [WorkspaceUserGroupProblem.AdminsOnly]: translationKey(
      "Slack lets only workspace owners and admins change user groups in your workspace, so OneUptime can't update {{mention}}. A Slack admin can let everyone manage user groups in Slack's admin settings, under Permissions > User Groups.",
    ),
    [WorkspaceUserGroupProblem.MissingPermission]: translationKey(
      "OneUptime isn't allowed to change {{mention}} in Slack.",
    ),
    [WorkspaceUserGroupProblem.Gone]: translationKey(
      "{{mention}} is not in your Slack workspace any more. Disconnect it, or connect another user group.",
    ),
    [WorkspaceUserGroupProblem.TeamGone]: translationKey(
      "{{mention}} is not in your Slack workspace any more. Disconnect it, or connect another user group.",
    ),
    [WorkspaceUserGroupProblem.TurnedOffInWorkspace]: translationKey(
      "Somebody turned {{mention}} off in Slack, so nobody can mention it. OneUptime keeps its people up to date: turn it back on in Slack to use it.",
    ),
    [WorkspaceUserGroupProblem.Unavailable]: translationKey(
      "Slack didn't answer when OneUptime last tried. It tries again in a few minutes.",
    ),
    [WorkspaceUserGroupProblem.Refused]: translationKey(
      "Slack refused the change: {{detail}}.",
    ),
  };

const TEAMS_PROBLEM_TEXT: Readonly<Record<WorkspaceUserGroupProblem, string>> =
  {
    [WorkspaceUserGroupProblem.NotConnected]: translationKey(
      "Microsoft Teams is not connected to this project any more, so OneUptime can't update {{mention}}. Connect it again in Project Settings > Workspace > Microsoft Teams.",
    ),
    [WorkspaceUserGroupProblem.PaidPlanNeeded]: translationKey(
      "Microsoft Teams refused the change: {{detail}}.",
    ),
    [WorkspaceUserGroupProblem.MissingScope]: translationKey(
      "Microsoft Teams refused the change: {{detail}}.",
    ),
    [WorkspaceUserGroupProblem.AdminsOnly]: translationKey(
      "Microsoft Teams refused the change: {{detail}}.",
    ),
    [WorkspaceUserGroupProblem.MissingPermission]: translationKey(
      "Your Microsoft 365 tenant hasn't let OneUptime manage tags yet. A Microsoft 365 admin can allow it with Grant Admin Consent, in Project Settings > Workspace > Microsoft Teams.",
    ),
    [WorkspaceUserGroupProblem.Gone]: translationKey(
      "{{mention}} is not in the {{team}} team any more. Disconnect it, or connect another tag.",
    ),
    [WorkspaceUserGroupProblem.TeamGone]: translationKey(
      "OneUptime's app isn't in the {{team}} team any more, so it can't update {{mention}}. Add the app to the team in Microsoft Teams again.",
    ),
    [WorkspaceUserGroupProblem.TurnedOffInWorkspace]: translationKey(
      "Microsoft Teams refused the change: {{detail}}.",
    ),
    [WorkspaceUserGroupProblem.Unavailable]: translationKey(
      "Microsoft Teams didn't answer when OneUptime last tried. It tries again in a few minutes.",
    ),
    [WorkspaceUserGroupProblem.Refused]: translationKey(
      "Microsoft Teams refused the change: {{detail}}.",
    ),
  };

// The English sentence for a group's problem; null for none.
export const getUserGroupProblemText: (
  view: WorkspaceUserGroupView,
) => string | null = (view: WorkspaceUserGroupView): string | null => {
  if (!view.problem) {
    return null;
  }

  return view.workspaceType === WorkspaceType.MicrosoftTeams
    ? TEAMS_PROBLEM_TEXT[view.problem]
    : SLACK_PROBLEM_TEXT[view.problem];
};

/*
 * Why somebody on call is not in the group: one sentence each, naming
 * them ({{name}}) and saying what would put them in.
 */
const LEFT_OUT_TEXT: Readonly<
  Record<
    WorkspaceType,
    Readonly<Record<WorkspaceUserGroupLeftOutReason, string>>
  >
> = {
  [WorkspaceType.Slack]: {
    [WorkspaceUserGroupLeftOutReason.NotFound]: translationKey(
      "{{name}} is on call but isn't in it: OneUptime can't find them in Slack. They can connect their Slack account in User Settings > Slack, or use the same email address in both.",
    ),
    [WorkspaceUserGroupLeftOutReason.Guest]: translationKey(
      "{{name}} is on call but isn't in it: they are a guest in Slack, and Slack keeps guests out of user groups.",
    ),
    [WorkspaceUserGroupLeftOutReason.Deactivated]: translationKey(
      "{{name}} is on call but isn't in it: their Slack account is deactivated.",
    ),
    [WorkspaceUserGroupLeftOutReason.NotInTeam]: translationKey(
      "{{name}} is on call but isn't in it: OneUptime can't find them in Slack. They can connect their Slack account in User Settings > Slack, or use the same email address in both.",
    ),
  },
  [WorkspaceType.MicrosoftTeams]: {
    [WorkspaceUserGroupLeftOutReason.NotFound]: translationKey(
      "{{name}} is on call but isn't in it: they aren't in the {{team}} team in Microsoft Teams, and a tag holds only people in its team.",
    ),
    [WorkspaceUserGroupLeftOutReason.Guest]: translationKey(
      "{{name}} is on call but isn't in it: they aren't in the {{team}} team in Microsoft Teams, and a tag holds only people in its team.",
    ),
    [WorkspaceUserGroupLeftOutReason.Deactivated]: translationKey(
      "{{name}} is on call but isn't in it: they aren't in the {{team}} team in Microsoft Teams, and a tag holds only people in its team.",
    ),
    [WorkspaceUserGroupLeftOutReason.NotInTeam]: translationKey(
      "{{name}} is on call but isn't in it: they aren't in the {{team}} team in Microsoft Teams, and a tag holds only people in its team.",
    ),
  },
};

export const getLeftOutText: (data: {
  workspaceType: WorkspaceType;
  person: WorkspaceUserGroupLeftOutView;
}) => string = (data: {
  workspaceType: WorkspaceType;
  person: WorkspaceUserGroupLeftOutView;
}): string => {
  return LEFT_OUT_TEXT[data.workspaceType][data.person.reason];
};

// The group as people type it: "@payments-oncall", "@Payments on-call".
export const getMention: (view: {
  workspaceType: WorkspaceType;
  name: string;
  handle: string | null;
}) => string = (view: {
  workspaceType: WorkspaceType;
  name: string;
  handle: string | null;
}): string => {
  return getUserGroupMention(view);
};

// A person by their name, or their email address when they have none.
export const getPersonName: (person: {
  name: string;
  email: string;
}) => string = (person: { name: string; email: string }): string => {
  return person.name?.trim() || person.email?.trim() || "";
};

/*
 * THE CONNECT FORM.
 */

// The value of "Create a new user group" in the user group list.
export const NEW_USER_GROUP_VALUE: string = "__new__";

export const CONNECT_FORM_TEXT: Readonly<{
  userGroup: string;
  userGroupPlaceholder: string;
  newUserGroup: string;
  name: string;
  handle: string;
  handleDescription: string;
  handleInvalid: string;
  team: string;
  teamPlaceholder: string;
  teamDescription: string;
  tag: string;
  tagDescription: string;
  noTeams: string;
  peopleCount: string;
  peopleCountOne: string;
  turnedOffOption: string;
  followsOne: string;
  followsMany: string;
  followsManyOne: string;
  replacesPeople: string;
  replacesPeopleOne: string;
  turnsOn: string;
}> = {
  userGroup: translationKey("User group"),
  userGroupPlaceholder: translationKey("Pick a user group"),
  newUserGroup: translationKey("Create a new user group"),
  name: translationKey("Name"),
  handle: translationKey("Handle"),
  handleDescription: translationKey(
    "People type @handle to reach whoever is on call. Lower-case letters, numbers and hyphens.",
  ),
  handleInvalid: translationKey(
    "Use lower-case letters, numbers and hyphens, such as payments-oncall.",
  ),
  team: translationKey("Team"),
  teamPlaceholder: translationKey("Pick a team"),
  teamDescription: translationKey("The teams OneUptime's app is in."),
  tag: translationKey("Tag"),
  tagDescription: translationKey(
    "The team's tag with this name, or a new one OneUptime makes.",
  ),
  noTeams: translationKey(
    "OneUptime's app isn't in any team yet. Add it to a team in Microsoft Teams, then try again.",
  ),
  peopleCount: translationKey("{{count}} people"),
  peopleCountOne: translationKey("{{count}} person"),
  turnedOffOption: translationKey("turned off"),
  followsOne: translationKey(
    "It follows {{schedule}} already: it will hold the people on call there and here.",
  ),
  followsMany: translationKey(
    "It follows {{count}} schedules already: it will hold the people on call in them and here.",
  ),
  followsManyOne: translationKey(
    "It follows {{count}} schedule already: it will hold the people on call in it and here.",
  ),
  replacesPeople: translationKey(
    "Its {{count}} people now are replaced with whoever is on call.",
  ),
  replacesPeopleOne: translationKey(
    "Its {{count}} person now is replaced with whoever is on call.",
  ),
  turnsOn: translationKey(
    "It is turned off in Slack now. Connecting it turns it back on.",
  ),
};

/*
 * The notes under the user group list for the group picked: which
 * schedules it follows already, who in it is replaced, and that a group
 * turned off is turned back on. English templates with their values, in
 * the order they are shown.
 */
export interface ConnectNote {
  template: string;
  // The plural's "one" form, when the note counts.
  oneTemplate?: string | undefined;
  count?: number | undefined;
  values: Record<string, string>;
}

export const getConnectNotes: (data: {
  group: WorkspaceAvailableUserGroup | undefined;
}) => Array<ConnectNote> = (data: {
  group: WorkspaceAvailableUserGroup | undefined;
}): Array<ConnectNote> => {
  const group: WorkspaceAvailableUserGroup | undefined = data.group;

  if (!group) {
    return [];
  }

  const notes: Array<ConnectNote> = [];

  if (group.followsScheduleNames.length === 1) {
    notes.push({
      template: CONNECT_FORM_TEXT.followsOne,
      values: { schedule: group.followsScheduleNames[0]! },
    });
  } else if (group.followsScheduleNames.length > 1) {
    notes.push({
      template: CONNECT_FORM_TEXT.followsMany,
      oneTemplate: CONNECT_FORM_TEXT.followsManyOne,
      count: group.followsScheduleNames.length,
      values: {},
    });
  } else if (group.userCount && group.userCount > 0) {
    // A group that follows no schedule yet: who is in it now goes.
    notes.push({
      template: CONNECT_FORM_TEXT.replacesPeople,
      oneTemplate: CONNECT_FORM_TEXT.replacesPeopleOne,
      count: group.userCount,
      values: {},
    });
  }

  if (group.isTurnedOff) {
    notes.push({ template: CONNECT_FORM_TEXT.turnsOn, values: {} });
  }

  return notes;
};
