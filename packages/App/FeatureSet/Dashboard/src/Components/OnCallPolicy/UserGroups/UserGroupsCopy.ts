import {
  getUserGroupMention,
  WorkspaceAvailableUserGroup,
  WorkspaceUserGroupLeftOutReason,
  WorkspaceUserGroupLeftOutView,
  WorkspaceUserGroupProblem,
  WorkspaceUserGroupView,
} from "Common/Types/Workspace/WorkspaceUserGroup";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

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
  // The card's list could not be read: the bold first line of the alert.
  loadError: string;
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
      "Keep a Slack user group in step with whoever is on call here, so anyone can @mention it to reach them.",
    ),
    connectButton: translationKey("Connect user group"),
    emptyTitle: translationKey("No user groups yet"),
    emptyText: translationKey(
      "Connect one, such as @payments-oncall, and OneUptime updates its members at every hand-off and override.",
    ),
    loadError: translationKey("Could not load the user groups."),
    connectTitle: translationKey("Connect a Slack user group"),
    connectDescription: translationKey(
      "OneUptime replaces the group's members with whoever is on call in this schedule, and keeps them up to date.",
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
      "Keep a Microsoft Teams tag in step with whoever is on call here, so anyone in its team can @mention it to reach them.",
    ),
    connectButton: translationKey("Connect tag"),
    emptyTitle: translationKey("No tags yet"),
    emptyText: translationKey(
      "Connect one, such as @Payments on-call, and OneUptime updates its members at every hand-off and override.",
    ),
    loadError: translationKey("Could not load the tags."),
    connectTitle: translationKey("Connect a Microsoft Teams tag"),
    connectDescription: translationKey(
      "OneUptime replaces the tag's members with whoever is on call in this schedule, and keeps them up to date. A tag can only hold people in its team.",
    ),
    groupNoun: translationKey("tag"),
    turnedOffText: translationKey(
      "Nobody is on call now, so OneUptime emptied {{mention}}. It fills it again when somebody is on call.",
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
}> = {
  title: translationKey("Disconnect {{mention}}?"),
  last: translationKey(
    "OneUptime stops updating {{mention}}. Its members stay as they are.",
  ),
  oneOther: translationKey(
    "{{mention}} stops following this schedule. It keeps following {{schedule}}.",
  ),
};

export const DISCONNECT_MANY_OTHERS: PluralTemplate = {
  one: "{{mention}} stops following this schedule. It keeps following {{count}} other schedule.",
  other:
    "{{mention}} stops following this schedule. It keeps following {{count}} other schedules.",
};

// A Microsoft Teams tag's team, under its name.
export const TEAM_SUBTITLE: string = translationKey("In the {{team}} team");

// The labels the card's rows use.
export const USER_GROUP_LABELS: Readonly<{
  alsoFollows: string;
  members: string;
  // Members, when there are none: "None" ("Nobody" reads "page nobody" in some locales).
  noMembers: string;
  tryAgain: string;
  // Try again, while OneUptime looks at the group.
  checking: string;
  disconnect: string;
  connect: string;
}> = {
  alsoFollows: translationKey("Also follows"),
  members: translationKey("Members"),
  noMembers: translationKey("None"),
  tryAgain: translationKey("Try again"),
  checking: translationKey("Checking…"),
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
  /*
   * Only a Slack user group can be turned off by somebody: a Microsoft
   * Teams tag has no off. Said of a tag, it is a refusal like any other.
   */
  if (
    view.problem === WorkspaceUserGroupProblem.TurnedOffInWorkspace &&
    view.workspaceType === WorkspaceType.Slack
  ) {
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

/*
 * Whether the row lists who is in the group. Not before OneUptime has
 * looked at it, nor while it is off for nobody on call (the row says so),
 * nor after a refusal before it was ever in step: OneUptime has put nobody
 * in it yet, and does not know who is - "None" would be wrong.
 */
export const isMembersShown: (view: WorkspaceUserGroupView) => boolean = (
  view: WorkspaceUserGroupView,
): boolean => {
  const status: UserGroupStatusKind = getUserGroupStatus(view);

  if (
    status === UserGroupStatusKind.NotYet ||
    status === UserGroupStatusKind.TurnedOff
  ) {
    return false;
  }

  return view.members.length > 0 || Boolean(view.syncedAt);
};

// The time sentences: when it was last looked at, and last in step.
export const USER_GROUP_TIME_TEXT: Readonly<{
  checked: string;
  lastInStep: string;
  notYet: string;
}> = {
  checked: translationKey("Checked {{when}}"),
  lastInStep: translationKey("Last up to date {{when}}"),
  notYet: translationKey("OneUptime is adding whoever is on call now."),
};

/*
 * What stops a group being kept in step, and what to do about it - one
 * sentence each, per workspace. {{mention}} is the group as people type it,
 * {{team}} a Teams tag's team, {{detail}} what the workspace said.
 */
const SLACK_MISSING_SCOPE: string = translationKey(
  "OneUptime's Slack app isn't allowed to change user groups yet. Reconnect Slack in Project Settings > Workspace > Slack to allow it.",
);

const SLACK_GONE: string = translationKey(
  "{{mention}} is not in your Slack workspace any more. Disconnect it, or connect another user group.",
);

const SLACK_REFUSED: string = translationKey(
  "Slack refused the change: {{detail}}.",
);

const SLACK_PROBLEM_TEXT: Readonly<Record<WorkspaceUserGroupProblem, string>> =
  {
    [WorkspaceUserGroupProblem.NotConnected]: translationKey(
      "Slack is not connected to this project any more, so OneUptime can't update {{mention}}. Connect Slack again in Project Settings > Workspace > Slack.",
    ),
    [WorkspaceUserGroupProblem.PaidPlanNeeded]: translationKey(
      "User groups need a paid Slack plan, so OneUptime can't update {{mention}}. Upgrade your Slack workspace to use them.",
    ),
    [WorkspaceUserGroupProblem.MissingScope]: SLACK_MISSING_SCOPE,
    [WorkspaceUserGroupProblem.AdminsOnly]: translationKey(
      "Slack lets only workspace owners and admins change user groups in your workspace, so OneUptime can't update {{mention}}. A Slack admin can let everyone manage user groups in Slack's admin settings, under Permissions > User Groups.",
    ),
    // Slack says this as a missing scope: the same fix.
    [WorkspaceUserGroupProblem.MissingPermission]: SLACK_MISSING_SCOPE,
    [WorkspaceUserGroupProblem.Gone]: SLACK_GONE,
    [WorkspaceUserGroupProblem.TeamGone]: SLACK_GONE,
    [WorkspaceUserGroupProblem.TurnedOffInWorkspace]: translationKey(
      "Somebody turned {{mention}} off in Slack, so nobody can mention it. OneUptime keeps its people up to date: turn it back on in Slack to use it.",
    ),
    [WorkspaceUserGroupProblem.Unavailable]: translationKey(
      "Slack didn't answer when OneUptime last tried. It tries again in a few minutes.",
    ),
    [WorkspaceUserGroupProblem.Refused]: SLACK_REFUSED,
  };

const TEAMS_REFUSED: string = translationKey(
  "Microsoft Teams refused the change: {{detail}}.",
);

const TEAMS_PROBLEM_TEXT: Readonly<Record<WorkspaceUserGroupProblem, string>> =
  {
    [WorkspaceUserGroupProblem.NotConnected]: translationKey(
      "Microsoft Teams is not connected to this project any more, so OneUptime can't update {{mention}}. Connect it again in Project Settings > Workspace > Microsoft Teams.",
    ),
    // Slack's refusals: a tag never meets them, so they are said as given.
    [WorkspaceUserGroupProblem.PaidPlanNeeded]: TEAMS_REFUSED,
    [WorkspaceUserGroupProblem.MissingScope]: TEAMS_REFUSED,
    [WorkspaceUserGroupProblem.AdminsOnly]: TEAMS_REFUSED,
    [WorkspaceUserGroupProblem.MissingPermission]: translationKey(
      "Your Microsoft 365 organization hasn't let OneUptime manage tags yet. A Microsoft 365 admin can allow it with Grant Admin Consent, in Project Settings > Workspace > Microsoft Teams.",
    ),
    [WorkspaceUserGroupProblem.Gone]: translationKey(
      "{{mention}} is not in the {{team}} team any more. Disconnect it, or connect another tag.",
    ),
    [WorkspaceUserGroupProblem.TeamGone]: translationKey(
      "OneUptime's app isn't in the {{team}} team any more, so it can't update {{mention}}. Add the app to the team in Microsoft Teams again.",
    ),
    [WorkspaceUserGroupProblem.TurnedOffInWorkspace]: TEAMS_REFUSED,
    [WorkspaceUserGroupProblem.Unavailable]: translationKey(
      "Microsoft Teams didn't answer when OneUptime last tried. It tries again in a few minutes.",
    ),
    [WorkspaceUserGroupProblem.Refused]: TEAMS_REFUSED,
  };

/*
 * A refusal the workspace gave no words for: said without them, never as
 * "refused the change: ." with nothing after the colon.
 */
const REFUSED_WITHOUT_DETAIL: Readonly<Record<WorkspaceType, string>> = {
  [WorkspaceType.Slack]: translationKey("Slack refused the change."),
  [WorkspaceType.MicrosoftTeams]: translationKey(
    "Microsoft Teams refused the change.",
  ),
};

// The English sentence for a group's problem; null for none.
export const getUserGroupProblemText: (
  view: WorkspaceUserGroupView,
) => string | null = (view: WorkspaceUserGroupView): string | null => {
  if (!view.problem) {
    return null;
  }

  const text: string =
    view.workspaceType === WorkspaceType.MicrosoftTeams
      ? TEAMS_PROBLEM_TEXT[view.problem]
      : SLACK_PROBLEM_TEXT[view.problem];

  if (text.includes("{{detail}}") && !view.problemDetail?.trim()) {
    return REFUSED_WITHOUT_DETAIL[view.workspaceType];
  }

  return text;
};

/*
 * Why somebody on call is not in the group: one sentence each, naming
 * them ({{name}}) and saying what would put them in.
 */
const SLACK_NOT_FOUND: string = translationKey(
  "{{name}} is on call but isn't in the group: OneUptime can't find them in Slack. They can connect their Slack account in User Settings > Slack, or use the same email address in both.",
);

const TEAMS_NOT_IN_TEAM: string = translationKey(
  "{{name}} is on call but isn't in the tag: a tag holds only people in its team, and they aren't in the {{team}} team. Add them to it in Microsoft Teams.",
);

const LEFT_OUT_TEXT: Readonly<
  Record<
    WorkspaceType,
    Readonly<Record<WorkspaceUserGroupLeftOutReason, string>>
  >
> = {
  [WorkspaceType.Slack]: {
    [WorkspaceUserGroupLeftOutReason.NotFound]: SLACK_NOT_FOUND,
    [WorkspaceUserGroupLeftOutReason.Guest]: translationKey(
      "{{name}} is on call but isn't in the group: they are a guest in Slack, and Slack keeps guests out of user groups.",
    ),
    [WorkspaceUserGroupLeftOutReason.Deactivated]: translationKey(
      "{{name}} is on call but isn't in the group: their Slack account is deactivated.",
    ),
    [WorkspaceUserGroupLeftOutReason.NotInTeam]: SLACK_NOT_FOUND,
  },
  // A tag holds a team's members: whatever kept somebody out, that is why.
  [WorkspaceType.MicrosoftTeams]: {
    [WorkspaceUserGroupLeftOutReason.NotFound]: TEAMS_NOT_IN_TEAM,
    [WorkspaceUserGroupLeftOutReason.Guest]: TEAMS_NOT_IN_TEAM,
    [WorkspaceUserGroupLeftOutReason.Deactivated]: TEAMS_NOT_IN_TEAM,
    [WorkspaceUserGroupLeftOutReason.NotInTeam]: TEAMS_NOT_IN_TEAM,
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
  turnedOffOption: string;
  followsOne: string;
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
  teamDescription: translationKey(
    "Only teams that have the OneUptime app are listed.",
  ),
  tag: translationKey("Tag"),
  tagDescription: translationKey(
    "OneUptime uses the team's tag with this name, or creates one.",
  ),
  noTeams: translationKey(
    "OneUptime's app isn't in any team yet. Add it to a team in Microsoft Teams, then try again.",
  ),
  turnedOffOption: translationKey("turned off"),
  followsOne: translationKey(
    "It already follows {{schedule}}, so it will hold whoever is on call there and here.",
  ),
  turnsOn: translationKey(
    "It is turned off in Slack now. Connecting it turns it back on.",
  ),
};

// How many people a group in the list holds.
export const PEOPLE_COUNT: PluralTemplate = {
  one: "{{count}} person",
  other: "{{count}} people",
};

// A group picked that follows several schedules already.
export const FOLLOWS_MANY: PluralTemplate = {
  one: "It already follows {{count}} schedule, so it will hold whoever is on call in it and here.",
  other:
    "It already follows {{count}} schedules, so it will hold whoever is on call in them and here.",
};

// A group picked that follows no schedule yet, with people in it.
export const REPLACES_PEOPLE: PluralTemplate = {
  one: "OneUptime replaces its {{count}} member with whoever is on call.",
  other: "OneUptime replaces its {{count}} members with whoever is on call.",
};

/*
 * The notes under the user group list for the group picked: which
 * schedules it follows already, who in it is replaced, and that a group
 * turned off is turned back on. English templates with their values, in
 * the order they are shown.
 */
export interface ConnectNote {
  // A sentence, or a count-dependent one (with `count`).
  template: string | PluralTemplate;
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
      template: FOLLOWS_MANY,
      count: group.followsScheduleNames.length,
      values: {},
    });
  } else if (group.userCount && group.userCount > 0) {
    // A group that follows no schedule yet: who is in it now goes.
    notes.push({
      template: REPLACES_PEOPLE,
      count: group.userCount,
      values: {},
    });
  }

  if (group.isTurnedOff) {
    notes.push({ template: CONNECT_FORM_TEXT.turnsOn, values: {} });
  }

  return notes;
};
