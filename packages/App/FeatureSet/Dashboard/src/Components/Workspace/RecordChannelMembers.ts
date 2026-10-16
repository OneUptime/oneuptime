import { WorkspaceChannelRecordType } from "Common/Types/Workspace/WorkspaceChannelLink";
import {
  WorkspaceChannelAddAnswer,
  WorkspaceChannelAddOutcome,
  WorkspaceChannelAddResult,
  WorkspaceChannelPerson,
  WorkspaceChannelState,
  WorkspaceChannelViewerStatus,
  WorkspaceRecordChannel,
} from "Common/Types/Workspace/WorkspaceChannelMembers";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE CHANNEL CARD OF A RECORD'S PAGE: WHO IS IN ITS CHANNEL, AND ADDING
 * PEOPLE TO IT.
 *
 * An incident, alert, episode or scheduled maintenance event with a channel
 * of its own (a workspace notification rule created it) shows a card beside
 * its details: the channel, the people in it, and - for somebody who may
 * edit the record - Join channel and Add people, which have the OneUptime
 * app invite them. The app created the channel and stays in it, so this
 * works for a private Slack channel that everybody has left, without a
 * Slack admin. A Microsoft Teams channel says who can open it instead:
 * Teams decides that, by the team or the private channel's own members.
 *
 * What the card says in each state, and in which order things are listed,
 * decided here, React-free, so the rules can be tested on their own. Every
 * string is a whole English sentence the Dashboard's locale files translate.
 */

// How many people the card lists before "Show N more".
export const CHANNEL_PEOPLE_FOLDED_COUNT: number = 5;

export const RECORD_CHANNEL_TEXT: {
  slackChannel: string;
  slackChannels: string;
  teamsChannel: string;
  teamsChannels: string;
  channels: string;
  privateChannel: string;
  publicChannel: string;
  archived: string;
  nobody: string;
  you: string;
  showFewer: string;
  joinChannel: string;
  addPeople: string;
  addPeopleSearch: string;
  addPeopleEmpty: string;
  notIn: string;
  notFound: string;
  connectSlack: string;
  publicJoinInSlack: string;
  archivedNote: string;
  unreachable: string;
  unreachableHint: string;
  notConnected: string;
  unavailable: string;
  teamsTeam: string;
  teamsTeamUnknown: string;
  teamsPrivate: string;
  teamsUnknown: string;
  couldNotRead: string;
  joined: string;
  openInSlack: string;
} = {
  slackChannel: translationKey("Slack Channel"),
  slackChannels: translationKey("Slack Channels"),
  teamsChannel: translationKey("Microsoft Teams Channel"),
  teamsChannels: translationKey("Microsoft Teams Channels"),
  channels: translationKey("Chat Channels"),
  privateChannel: translationKey("Private channel"),
  publicChannel: translationKey("Public channel"),
  archived: translationKey("Archived"),
  nobody: translationKey("Nobody is in this channel."),
  you: translationKey("You"),
  showFewer: translationKey("Show fewer"),
  joinChannel: translationKey("Join channel"),
  addPeople: translationKey("Add people"),
  // As the owners' list words them: the same list of people and teams.
  addPeopleSearch: translationKey("Search people or teams..."),
  addPeopleEmpty: translationKey("No people or teams available."),
  notIn: translationKey("You're not in this channel."),
  notFound: translationKey(
    "OneUptime can't find your Slack account, so it can't add you.",
  ),
  connectSlack: translationKey("Connect Slack account"),
  publicJoinInSlack: translationKey(
    "You're not in this channel. It's public: open it in Slack to join.",
  ),
  archivedNote: translationKey(
    "This channel is archived. Unarchive it in Slack to add people.",
  ),
  unreachable: translationKey(
    "OneUptime can't see this channel. It was deleted, or the OneUptime app was removed from it.",
  ),
  unreachableHint: translationKey(
    "If it's still there, someone in it can add the app back by typing /invite @OneUptime.",
  ),
  notConnected: translationKey("Slack isn't connected to this project."),
  unavailable: translationKey("Slack didn't answer. Try again in a minute."),
  teamsTeam: translationKey("Everyone in {{team}} can open the channel."),
  teamsTeamUnknown: translationKey(
    "Everyone in the team can open the channel.",
  ),
  teamsPrivate: translationKey(
    "A private channel: only its members can open it. Its owners add people in Microsoft Teams.",
  ),
  teamsUnknown: translationKey(
    "Microsoft Teams decides who can open it: open it there to see.",
  ),
  couldNotRead: translationKey(
    "Could not read who is in this channel. {{error}}",
  ),
  joined: translationKey("You're in the channel now."),
  openInSlack: translationKey("Open in Slack"),
};

// "Show 3 more", folded under the first people.
export const SHOW_MORE_PEOPLE: PluralTemplate = {
  one: "Show {{count}} more",
  other: "Show {{count}} more",
};

/*
 * People in the channel the card cannot name - past what OneUptime asks
 * Slack about in one read.
 */
export const UNNAMED_PEOPLE: PluralTemplate = {
  one: "and {{count}} more person",
  other: "and {{count}} more people",
};

// "3 people", in the line under the channel's name.
export const PEOPLE_COUNT: PluralTemplate = {
  one: "{{count}} person",
  other: "{{count}} people",
};

/*
 * What adding one person came to, as the card or the Add people list says
 * it: about the viewer themselves, or about somebody else by name.
 */
export const ADD_OUTCOME_TEXT: Record<
  WorkspaceChannelAddOutcome,
  { self: string; other: string }
> = {
  [WorkspaceChannelAddOutcome.Added]: {
    self: translationKey("You're in the channel now."),
    other: translationKey("Added {{name}}."),
  },
  [WorkspaceChannelAddOutcome.AlreadyIn]: {
    self: translationKey("You're already in this channel."),
    other: translationKey("{{name}} is already in this channel."),
  },
  [WorkspaceChannelAddOutcome.NotFound]: {
    self: translationKey(
      "OneUptime can't find your Slack account, so it can't add you.",
    ),
    other: translationKey(
      "OneUptime can't find {{name}} in Slack: their account isn't connected, and no Slack account has their email address. Ask them to connect Slack in User Settings.",
    ),
  },
  [WorkspaceChannelAddOutcome.NotProjectMember]: {
    self: translationKey(
      "You're not a member of this project, so OneUptime can't add you.",
    ),
    other: translationKey(
      "{{name}} isn't a member of this project, so OneUptime can't add them.",
    ),
  },
  [WorkspaceChannelAddOutcome.Guest]: {
    self: translationKey(
      "You're a guest in Slack, and Slack doesn't let OneUptime add you to this channel.",
    ),
    other: translationKey(
      "{{name}} is a guest in Slack, and Slack doesn't let OneUptime add them to this channel.",
    ),
  },
  [WorkspaceChannelAddOutcome.TryAgain]: {
    self: translationKey("Slack didn't answer. Try again in a minute."),
    other: translationKey(
      "Slack didn't answer for {{name}}. Try again in a minute.",
    ),
  },
  [WorkspaceChannelAddOutcome.Refused]: {
    self: translationKey("Slack didn't let OneUptime add you."),
    other: translationKey("Slack didn't let OneUptime add {{name}}."),
  },
};

// What the card says about a channel that can take nobody.
export const CHANNEL_STATE_TEXT: Record<
  Exclude<
    WorkspaceChannelState,
    WorkspaceChannelState.Members | WorkspaceChannelState.ManagedInTeams
  >,
  string
> = {
  [WorkspaceChannelState.Archived]: RECORD_CHANNEL_TEXT.archivedNote,
  [WorkspaceChannelState.Unreachable]: RECORD_CHANNEL_TEXT.unreachable,
  [WorkspaceChannelState.NotConnected]: RECORD_CHANNEL_TEXT.notConnected,
  [WorkspaceChannelState.Unavailable]: RECORD_CHANNEL_TEXT.unavailable,
};

/*
 * What somebody who may not add people is told when they are not in the
 * channel: who can add them. A whole sentence for each kind of record, so
 * every language words it with its own grammar.
 */
export const ASK_TO_BE_ADDED: Record<WorkspaceChannelRecordType, string> = {
  [WorkspaceChannelRecordType.Incident]: translationKey(
    "You're not in this channel. Ask someone who can edit this incident to add you.",
  ),
  [WorkspaceChannelRecordType.Alert]: translationKey(
    "You're not in this channel. Ask someone who can edit this alert to add you.",
  ),
  [WorkspaceChannelRecordType.IncidentEpisode]: translationKey(
    "You're not in this channel. Ask someone who can edit this episode to add you.",
  ),
  [WorkspaceChannelRecordType.AlertEpisode]: translationKey(
    "You're not in this channel. Ask someone who can edit this episode to add you.",
  ),
  [WorkspaceChannelRecordType.ScheduledMaintenance]: translationKey(
    "You're not in this channel. Ask someone who can edit this event to add you.",
  ),
};

/*
 * The card's title: the product the record's channels are in, by name, or
 * Chat Channels when they are in both. Read off the record's channels, or
 * off the page's links to them while the channels load.
 */
export function getCardTitle(
  channels: Array<{ workspaceType: WorkspaceType }>,
): string {
  const isSlack: boolean = channels.some(
    (channel: { workspaceType: WorkspaceType }) => {
      return channel.workspaceType === WorkspaceType.Slack;
    },
  );
  const isTeams: boolean = channels.some(
    (channel: { workspaceType: WorkspaceType }) => {
      return channel.workspaceType === WorkspaceType.MicrosoftTeams;
    },
  );
  const isMany: boolean = channels.length > 1;

  if (isSlack && isTeams) {
    return RECORD_CHANNEL_TEXT.channels;
  }

  if (isTeams) {
    return isMany
      ? RECORD_CHANNEL_TEXT.teamsChannels
      : RECORD_CHANNEL_TEXT.teamsChannel;
  }

  return isMany
    ? RECORD_CHANNEL_TEXT.slackChannels
    : RECORD_CHANNEL_TEXT.slackChannel;
}

// "#inc-42" in Slack, where channels are written with their #; "inc-42" in Teams.
export function getChannelLabel(channel: WorkspaceRecordChannel): string {
  const name: string = channel.name.trim().replace(/^#+/, "");

  if (channel.workspaceType === WorkspaceType.Slack) {
    return `#${name || "channel"}`;
  }

  return name || "Channel";
}

/*
 * The people the card lists: the viewer first (the server sorts them so
 * already), all of them when unfolded, else the first few.
 */
export function getShownPeople(data: {
  people: Array<WorkspaceChannelPerson>;
  isUnfolded: boolean;
}): Array<WorkspaceChannelPerson> {
  return data.isUnfolded
    ? data.people
    : data.people.slice(0, CHANNEL_PEOPLE_FOLDED_COUNT);
}

// How many people "Show N more" would add.
export function getFoldedCount(people: Array<WorkspaceChannelPerson>): number {
  return Math.max(0, people.length - CHANNEL_PEOPLE_FOLDED_COUNT);
}

// People counted but not named (past the names Slack was asked for).
export function getUnnamedCount(channel: WorkspaceRecordChannel): number {
  return Math.max(0, channel.peopleCount - channel.people.length);
}

/*
 * What the card offers the viewer under a channel's people: to join it
 * (they may edit the record and are not in it), to connect their Slack
 * account first (OneUptime cannot tell who they are in Slack), or how to get
 * in without that permission. Nothing when they are in it already.
 */
export enum ChannelViewerPrompt {
  None = "none",
  Join = "join",
  ConnectToJoin = "connect-to-join",
  AskToBeAdded = "ask-to-be-added",
  JoinInSlack = "join-in-slack",
}

export function getViewerPrompt(data: {
  channel: WorkspaceRecordChannel;
  canAddPeople: boolean;
}): ChannelViewerPrompt {
  const channel: WorkspaceRecordChannel = data.channel;

  if (
    channel.workspaceType !== WorkspaceType.Slack ||
    channel.state !== WorkspaceChannelState.Members ||
    channel.viewer === WorkspaceChannelViewerStatus.In
  ) {
    return ChannelViewerPrompt.None;
  }

  if (data.canAddPeople) {
    return channel.viewer === WorkspaceChannelViewerStatus.NotIn
      ? ChannelViewerPrompt.Join
      : ChannelViewerPrompt.ConnectToJoin;
  }

  // Somebody OneUptime cannot find is told nothing they could act on.
  if (channel.viewer !== WorkspaceChannelViewerStatus.NotIn) {
    return ChannelViewerPrompt.None;
  }

  return channel.isPrivate === false
    ? ChannelViewerPrompt.JoinInSlack
    : ChannelViewerPrompt.AskToBeAdded;
}

// Whether the card offers Add people for a channel.
export function canAddPeopleTo(data: {
  channel: WorkspaceRecordChannel;
  canAddPeople: boolean;
}): boolean {
  return (
    data.canAddPeople &&
    data.channel.workspaceType === WorkspaceType.Slack &&
    data.channel.state === WorkspaceChannelState.Members
  );
}

/*
 * The OneUptime people already in a channel, as keys of the Add people
 * list (getPeoplePickerOptionKey's "<kind>:<id>"), so the list leaves them
 * out.
 */
export function getPeopleInChannelUserIds(
  channel: WorkspaceRecordChannel,
): Array<string> {
  return channel.people
    .map((person: WorkspaceChannelPerson): string => {
      return person.userId || "";
    })
    .filter((userId: string): boolean => {
      return Boolean(userId);
    });
}

export interface AddOutcomeSentence {
  // An English sentence, looked up whole; {{name}} filled in.
  template: string;
  name: string;
  isProblem: boolean;
}

/*
 * What an answer to adding people says, a sentence a person: the people
 * added are said only when the viewer added themselves (the list shows the
 * others appearing); every problem is said. A channel that took nobody is
 * said by its state instead.
 */
export function getAddOutcomeSentences(data: {
  answer: WorkspaceChannelAddAnswer;
  viewerUserId: string | null;
}): Array<AddOutcomeSentence> {
  const sentences: Array<AddOutcomeSentence> = [];
  const viewerKey: string = (data.viewerUserId || "").toLowerCase();

  for (const result of data.answer.results) {
    const isViewer: boolean =
      Boolean(viewerKey) && result.userId.toLowerCase() === viewerKey;
    const isProblem: boolean = isAddProblem(result);

    if (!isProblem && !isViewer) {
      continue;
    }

    const text: { self: string; other: string } =
      ADD_OUTCOME_TEXT[result.outcome];

    sentences.push({
      template: isViewer ? text.self : text.other,
      name: result.name,
      isProblem: isProblem,
    });
  }

  if (data.answer.channelState) {
    const stateText: string | undefined =
      CHANNEL_STATE_TEXT[
        data.answer.channelState as keyof typeof CHANNEL_STATE_TEXT
      ];

    if (stateText) {
      sentences.push({ template: stateText, name: "", isProblem: true });
    }
  }

  return sentences;
}

// Whether a person's answer is one somebody has to do something about.
export function isAddProblem(result: WorkspaceChannelAddResult): boolean {
  return (
    result.outcome !== WorkspaceChannelAddOutcome.Added &&
    result.outcome !== WorkspaceChannelAddOutcome.AlreadyIn
  );
}
