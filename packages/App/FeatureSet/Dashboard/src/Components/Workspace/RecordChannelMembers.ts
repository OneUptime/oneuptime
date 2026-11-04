import IconProp from "Common/Types/Icon/IconProp";
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
  PeopleSearchNotice,
  PeopleSearchNoticeTone,
} from "Common/UI/Components/PeoplePicker/PeopleSearchNotice";
import {
  composedValue,
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import { formatNameList } from "../AiAccess/AiAccessModes";
import { CHANNEL_LINK_TEXT } from "./ChannelLinks";

/*
 * THE CHANNEL CARD OF A RECORD'S PAGE: WHO IS IN ITS CHANNEL, AND ADDING
 * PEOPLE TO IT.
 *
 * An incident, alert, episode or scheduled maintenance event with a channel
 * of its own (a workspace notification rule created it) shows a card beside
 * its details: the channel, the people in it, and - for somebody who may
 * edit the record - Join channel and Add people, which have the OneUptime
 * app invite them. The app created the channel and stays in it, so this
 * works for a private Slack or Mattermost channel that everybody has left,
 * without an admin of either. A Microsoft Teams channel says who can open it
 * instead: Teams decides that, by the team or the private channel's own
 * members.
 *
 * What the card says in each state, and in which order things are listed,
 * decided here, React-free, so the rules can be tested on their own. Every
 * string is a whole English sentence the Dashboard's locale files translate,
 * and names the product the channel is in (getChannelProductText).
 */

// How many people the card lists before "Show N more".
export const CHANNEL_PEOPLE_FOLDED_COUNT: number = 5;

export const RECORD_CHANNEL_TEXT: {
  slackChannel: string;
  slackChannels: string;
  teamsChannel: string;
  teamsChannels: string;
  mattermostChannel: string;
  mattermostChannels: string;
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
  connectProjectSlack: string;
  teamAlreadyIn: string;
} = {
  slackChannel: translationKey("Slack Channel"),
  slackChannels: translationKey("Slack Channels"),
  teamsChannel: translationKey("Microsoft Teams Channel"),
  teamsChannels: translationKey("Microsoft Teams Channels"),
  mattermostChannel: translationKey("Mattermost Channel"),
  mattermostChannels: translationKey("Mattermost Channels"),
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
  // Under "Private channel": what that means in Teams, not said twice.
  teamsPrivate: translationKey(
    "Only its members can open it. Its owners add people in Microsoft Teams.",
  ),
  teamsUnknown: translationKey(
    "Microsoft Teams decides who can open it: open it there to see.",
  ),
  couldNotRead: translationKey(
    "Could not read who is in this channel. {{error}}",
  ),
  joined: translationKey("You're in the channel now."),
  // Slack was taken off the project: where it is connected again.
  connectProjectSlack: translationKey("Connect Slack"),
  // A team picked in Add people whose people are all in the channel.
  teamAlreadyIn: translationKey(
    "Everyone in {{team}} is already in this channel.",
  ),
};

/*
 * What the card says about a channel, in the words of the product it is in:
 * who to find there, how to get in, and where to connect it.
 */
export interface ChannelProductText {
  notFound: string;
  connectAccount: string;
  publicJoin: string;
  unreachableHint: string;
  connectProject: string;
}

const SLACK_CHANNEL_TEXT: ChannelProductText = {
  notFound: RECORD_CHANNEL_TEXT.notFound,
  connectAccount: RECORD_CHANNEL_TEXT.connectSlack,
  publicJoin: RECORD_CHANNEL_TEXT.publicJoinInSlack,
  unreachableHint: RECORD_CHANNEL_TEXT.unreachableHint,
  connectProject: RECORD_CHANNEL_TEXT.connectProjectSlack,
};

export const MATTERMOST_CHANNEL_TEXT: ChannelProductText = {
  notFound: translationKey(
    "OneUptime can't find your Mattermost account, so it can't add you.",
  ),
  connectAccount: translationKey("Connect Mattermost account"),
  publicJoin: translationKey(
    "You're not in this channel. It's public: open it in Mattermost to join.",
  ),
  // Not a command: the bot's username is whatever it was given in Mattermost.
  unreachableHint: translationKey(
    "If it's still there, someone in it can add the bot back in Mattermost.",
  ),
  connectProject: translationKey("Connect Mattermost"),
};

export function getChannelProductText(
  workspaceType: WorkspaceType,
): ChannelProductText {
  return workspaceType === WorkspaceType.Mattermost
    ? MATTERMOST_CHANNEL_TEXT
    : SLACK_CHANNEL_TEXT;
}

// The product's name on the card: its icon, and what opens a channel there.
export function getChannelIcon(workspaceType: WorkspaceType): IconProp {
  if (workspaceType === WorkspaceType.Mattermost) {
    return IconProp.Mattermost;
  }

  return workspaceType === WorkspaceType.MicrosoftTeams
    ? IconProp.MicrosoftTeams
    : IconProp.Slack;
}

export function getOpenChannelText(workspaceType: WorkspaceType): string {
  if (workspaceType === WorkspaceType.Mattermost) {
    return CHANNEL_LINK_TEXT.openInMattermost;
  }

  return workspaceType === WorkspaceType.MicrosoftTeams
    ? CHANNEL_LINK_TEXT.openInMicrosoftTeams
    : CHANNEL_LINK_TEXT.openInSlack;
}

// What picking a team in Add people did: "Added 3 people from Platform."
export const ADDED_FROM_TEAM: PluralTemplate = {
  one: "Added {{count}} person from {{team}}.",
  other: "Added {{count}} people from {{team}}.",
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
 * it: about the viewer themselves, or about somebody else by name. Slack's
 * words; a Mattermost channel has its own (getAddOutcomeText).
 */
const SLACK_REFUSED_TEXT: { self: string; other: string } = {
  self: translationKey("Slack didn't let OneUptime add you."),
  other: translationKey("Slack didn't let OneUptime add {{name}}."),
};

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
  // Slack has no such answer: its channels are the whole workspace's.
  [WorkspaceChannelAddOutcome.NotInTeam]: SLACK_REFUSED_TEXT,
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
  [WorkspaceChannelAddOutcome.Refused]: SLACK_REFUSED_TEXT,
};

/*
 * The same for a Mattermost channel. Mattermost lets a guest be added when
 * they are in the team, and answers nothing of its own about guests: one it
 * did refuse is refused like anybody else.
 */
const MATTERMOST_REFUSED_TEXT: { self: string; other: string } = {
  self: translationKey("Mattermost didn't let OneUptime add you."),
  other: translationKey("Mattermost didn't let OneUptime add {{name}}."),
};

export const MATTERMOST_ADD_OUTCOME_TEXT: Record<
  WorkspaceChannelAddOutcome,
  { self: string; other: string }
> = {
  [WorkspaceChannelAddOutcome.Added]:
    ADD_OUTCOME_TEXT[WorkspaceChannelAddOutcome.Added],
  [WorkspaceChannelAddOutcome.AlreadyIn]:
    ADD_OUTCOME_TEXT[WorkspaceChannelAddOutcome.AlreadyIn],
  [WorkspaceChannelAddOutcome.NotFound]: {
    self: MATTERMOST_CHANNEL_TEXT.notFound,
    other: translationKey(
      "OneUptime can't find {{name}} in Mattermost: their account isn't connected, and OneUptime can't see a Mattermost account with their email address. Ask them to connect Mattermost in User Settings.",
    ),
  },
  [WorkspaceChannelAddOutcome.NotProjectMember]:
    ADD_OUTCOME_TEXT[WorkspaceChannelAddOutcome.NotProjectMember],
  [WorkspaceChannelAddOutcome.NotInTeam]: {
    self: translationKey(
      "You're not in the Mattermost team this project is connected to, so OneUptime can't add you.",
    ),
    other: translationKey(
      "{{name}} isn't in the Mattermost team this project is connected to, so OneUptime can't add them.",
    ),
  },
  [WorkspaceChannelAddOutcome.Guest]: MATTERMOST_REFUSED_TEXT,
  [WorkspaceChannelAddOutcome.TryAgain]: {
    self: translationKey("Mattermost didn't answer. Try again in a minute."),
    other: translationKey(
      "Mattermost didn't answer for {{name}}. Try again in a minute.",
    ),
  },
  [WorkspaceChannelAddOutcome.Refused]: MATTERMOST_REFUSED_TEXT,
};

export function getAddOutcomeText(
  workspaceType: WorkspaceType,
  outcome: WorkspaceChannelAddOutcome,
): { self: string; other: string } {
  return workspaceType === WorkspaceType.Mattermost
    ? MATTERMOST_ADD_OUTCOME_TEXT[outcome]
    : ADD_OUTCOME_TEXT[outcome];
}

// The outcomes somebody has to do something about.
export type AddProblemOutcome = Exclude<
  WorkspaceChannelAddOutcome,
  WorkspaceChannelAddOutcome.Added | WorkspaceChannelAddOutcome.AlreadyIn
>;

/*
 * Several people with the same problem, said once: "OneUptime can't find
 * Ada Lovelace and Bob Stone in Slack: ..." - a team picked in Add people
 * would otherwise repeat a long sentence for each of them. {{names}} is
 * their names, listed the way the sentence's language lists names. Slack's
 * words; a Mattermost channel has its own (getAddProblemTextForSeveral).
 */
const SLACK_REFUSED_TEXT_FOR_SEVERAL: string = translationKey(
  "Slack didn't let OneUptime add {{names}}.",
);

export const ADD_PROBLEM_TEXT_FOR_SEVERAL: Record<AddProblemOutcome, string> = {
  [WorkspaceChannelAddOutcome.NotFound]: translationKey(
    "OneUptime can't find {{names}} in Slack: their accounts aren't connected, and no Slack account has their email address. Ask them to connect Slack in User Settings.",
  ),
  [WorkspaceChannelAddOutcome.NotProjectMember]: translationKey(
    "{{names}} aren't members of this project, so OneUptime can't add them.",
  ),
  [WorkspaceChannelAddOutcome.NotInTeam]: SLACK_REFUSED_TEXT_FOR_SEVERAL,
  [WorkspaceChannelAddOutcome.Guest]: translationKey(
    "{{names}} are guests in Slack, and Slack doesn't let OneUptime add them to this channel.",
  ),
  [WorkspaceChannelAddOutcome.TryAgain]: translationKey(
    "Slack didn't answer for {{names}}. Try again in a minute.",
  ),
  [WorkspaceChannelAddOutcome.Refused]: SLACK_REFUSED_TEXT_FOR_SEVERAL,
};

const MATTERMOST_REFUSED_TEXT_FOR_SEVERAL: string = translationKey(
  "Mattermost didn't let OneUptime add {{names}}.",
);

export const MATTERMOST_ADD_PROBLEM_TEXT_FOR_SEVERAL: Record<
  AddProblemOutcome,
  string
> = {
  [WorkspaceChannelAddOutcome.NotFound]: translationKey(
    "OneUptime can't find {{names}} in Mattermost: their accounts aren't connected, and OneUptime can't see Mattermost accounts with their email addresses. Ask them to connect Mattermost in User Settings.",
  ),
  [WorkspaceChannelAddOutcome.NotProjectMember]:
    ADD_PROBLEM_TEXT_FOR_SEVERAL[WorkspaceChannelAddOutcome.NotProjectMember],
  [WorkspaceChannelAddOutcome.NotInTeam]: translationKey(
    "{{names}} aren't in the Mattermost team this project is connected to, so OneUptime can't add them.",
  ),
  [WorkspaceChannelAddOutcome.Guest]: MATTERMOST_REFUSED_TEXT_FOR_SEVERAL,
  [WorkspaceChannelAddOutcome.TryAgain]: translationKey(
    "Mattermost didn't answer for {{names}}. Try again in a minute.",
  ),
  [WorkspaceChannelAddOutcome.Refused]: MATTERMOST_REFUSED_TEXT_FOR_SEVERAL,
};

export function getAddProblemTextForSeveral(
  workspaceType: WorkspaceType,
  outcome: AddProblemOutcome,
): string {
  return workspaceType === WorkspaceType.Mattermost
    ? MATTERMOST_ADD_PROBLEM_TEXT_FOR_SEVERAL[outcome]
    : ADD_PROBLEM_TEXT_FOR_SEVERAL[outcome];
}

// The order the problems of one pick are said in: what to do first, first.
export const ADD_PROBLEM_ORDER: ReadonlyArray<AddProblemOutcome> = [
  WorkspaceChannelAddOutcome.NotFound,
  WorkspaceChannelAddOutcome.NotProjectMember,
  WorkspaceChannelAddOutcome.NotInTeam,
  WorkspaceChannelAddOutcome.Guest,
  WorkspaceChannelAddOutcome.Refused,
  WorkspaceChannelAddOutcome.TryAgain,
];

type ChannelStateWithText = Exclude<
  WorkspaceChannelState,
  WorkspaceChannelState.Members | WorkspaceChannelState.ManagedInTeams
>;

// What the card says about a channel that can take nobody.
export const CHANNEL_STATE_TEXT: Record<ChannelStateWithText, string> = {
  [WorkspaceChannelState.Archived]: RECORD_CHANNEL_TEXT.archivedNote,
  [WorkspaceChannelState.Unreachable]: RECORD_CHANNEL_TEXT.unreachable,
  [WorkspaceChannelState.NotConnected]: RECORD_CHANNEL_TEXT.notConnected,
  [WorkspaceChannelState.Unavailable]: RECORD_CHANNEL_TEXT.unavailable,
};

export const MATTERMOST_CHANNEL_STATE_TEXT: Record<
  ChannelStateWithText,
  string
> = {
  [WorkspaceChannelState.Archived]: translationKey(
    "This channel is archived. Unarchive it in Mattermost to add people.",
  ),
  [WorkspaceChannelState.Unreachable]: translationKey(
    "OneUptime can't see this channel. It was deleted, or OneUptime's bot was removed from it.",
  ),
  [WorkspaceChannelState.NotConnected]: translationKey(
    "Mattermost isn't connected to this project.",
  ),
  [WorkspaceChannelState.Unavailable]:
    MATTERMOST_ADD_OUTCOME_TEXT[WorkspaceChannelAddOutcome.TryAgain].self,
};

// What the card says about a channel in this state; nothing for one that takes people.
export function getChannelStateText(
  workspaceType: WorkspaceType,
  state: WorkspaceChannelState,
): string | undefined {
  const text: Record<ChannelStateWithText, string> =
    workspaceType === WorkspaceType.Mattermost
      ? MATTERMOST_CHANNEL_STATE_TEXT
      : CHANNEL_STATE_TEXT;

  return text[state as ChannelStateWithText];
}

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
 * Chat Channels when they are in more than one. Read off the record's
 * channels, or off the page's links to them while the channels load.
 */
export function getCardTitle(
  channels: Array<{ workspaceType: WorkspaceType }>,
): string {
  const workspaceTypes: Set<WorkspaceType> = new Set<WorkspaceType>(
    channels.map((channel: { workspaceType: WorkspaceType }) => {
      return channel.workspaceType;
    }),
  );
  const isMany: boolean = channels.length > 1;

  if (workspaceTypes.size > 1) {
    return RECORD_CHANNEL_TEXT.channels;
  }

  if (workspaceTypes.has(WorkspaceType.MicrosoftTeams)) {
    return isMany
      ? RECORD_CHANNEL_TEXT.teamsChannels
      : RECORD_CHANNEL_TEXT.teamsChannel;
  }

  if (workspaceTypes.has(WorkspaceType.Mattermost)) {
    return isMany
      ? RECORD_CHANNEL_TEXT.mattermostChannels
      : RECORD_CHANNEL_TEXT.mattermostChannel;
  }

  return isMany
    ? RECORD_CHANNEL_TEXT.slackChannels
    : RECORD_CHANNEL_TEXT.slackChannel;
}

/*
 * "#inc-42" in Slack, where channels are written with their #; "inc-42" in
 * Teams and Mattermost.
 */
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

// People counted but not named (past the names the workspace was asked for).
export function getUnnamedCount(channel: WorkspaceRecordChannel): number {
  return Math.max(0, channel.peopleCount - channel.people.length);
}

/*
 * What the card offers the viewer under a channel's people: to join it
 * (they may edit the record and are not in it), to connect their account
 * first (OneUptime cannot tell who they are in the workspace), or how to get
 * in without that permission. Nothing when they are in it already.
 */
export enum ChannelViewerPrompt {
  None = "none",
  Join = "join",
  ConnectToJoin = "connect-to-join",
  AskToBeAdded = "ask-to-be-added",
  JoinInWorkspace = "join-in-workspace",
}

export function getViewerPrompt(data: {
  channel: WorkspaceRecordChannel;
  canAddPeople: boolean;
}): ChannelViewerPrompt {
  const channel: WorkspaceRecordChannel = data.channel;

  if (
    channel.workspaceType === WorkspaceType.MicrosoftTeams ||
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
    ? ChannelViewerPrompt.JoinInWorkspace
    : ChannelViewerPrompt.AskToBeAdded;
}

// Whether the card offers Add people for a channel.
export function canAddPeopleTo(data: {
  channel: WorkspaceRecordChannel;
  canAddPeople: boolean;
}): boolean {
  return (
    data.canAddPeople &&
    data.channel.workspaceType !== WorkspaceType.MicrosoftTeams &&
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
  workspaceType: WorkspaceType;
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

    const text: { self: string; other: string } = getAddOutcomeText(
      data.workspaceType,
      result.outcome,
    );

    sentences.push({
      template: isViewer ? text.self : text.other,
      name: result.name,
      isProblem: isProblem,
    });
  }

  if (data.answer.channelState) {
    const stateText: string | undefined = getChannelStateText(
      data.workspaceType,
      data.answer.channelState,
    );

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

/*
 * Every problem of an answer, in the reader's language: the viewer as
 * "you", somebody else by name, and several people with the same problem
 * in one sentence that names them all.
 */
export function getAddProblemSentences(data: {
  workspaceType: WorkspaceType;
  results: Array<WorkspaceChannelAddResult>;
  viewerUserId: string | null;
  translator: Translator;
}): Array<string> {
  const translator: Translator = data.translator;
  const viewerKey: string = (data.viewerUserId || "").toLowerCase();
  const sentences: Array<string> = [];

  for (const outcome of ADD_PROBLEM_ORDER) {
    const people: Array<WorkspaceChannelAddResult> = data.results.filter(
      (result: WorkspaceChannelAddResult): boolean => {
        return result.outcome === outcome;
      },
    );
    const others: Array<WorkspaceChannelAddResult> = people.filter(
      (result: WorkspaceChannelAddResult): boolean => {
        return !viewerKey || result.userId.toLowerCase() !== viewerKey;
      },
    );

    const text: { self: string; other: string } = getAddOutcomeText(
      data.workspaceType,
      outcome,
    );

    if (others.length < people.length) {
      sentences.push(translator.translateText(text.self) || text.self);
    }

    if (others.length === 1) {
      sentences.push(
        translator.translateTemplate(text.other, {
          name: others[0]!.name,
        }),
      );
    } else if (others.length > 1) {
      const names: Array<string> = others.map(
        (result: WorkspaceChannelAddResult): string => {
          return result.name;
        },
      );

      sentences.push(
        translator.translateTemplate(
          getAddProblemTextForSeveral(data.workspaceType, outcome),
          {
            names: composedValue((sentence: Translator): string => {
              return formatNameList(names, "and", sentence);
            }),
          },
        ),
      );
    }
  }

  return sentences;
}

/*
 * What the Add people list says under it after a pick, as it says it: who
 * was added - a person by name, a team's people by how many - or that they
 * were in the channel already, then every problem, and a channel that took
 * nobody by its state. Nothing is left unsaid, so a pick never seems to do
 * nothing.
 */
export function getPickNotices(data: {
  workspaceType: WorkspaceType;
  answer: WorkspaceChannelAddAnswer;
  viewerUserId: string | null;
  // The team picked, by its name; undefined when a person was picked.
  teamName?: string | undefined;
  translator: Translator;
}): Array<PeopleSearchNotice> {
  const translator: Translator = data.translator;
  const results: Array<WorkspaceChannelAddResult> = data.answer.results;
  const viewerKey: string = (data.viewerUserId || "").toLowerCase();
  const notices: Array<PeopleSearchNotice> = [];

  const added: Array<WorkspaceChannelAddResult> = results.filter(
    (result: WorkspaceChannelAddResult): boolean => {
      return result.outcome === WorkspaceChannelAddOutcome.Added;
    },
  );
  const alreadyIn: Array<WorkspaceChannelAddResult> = results.filter(
    (result: WorkspaceChannelAddResult): boolean => {
      return result.outcome === WorkspaceChannelAddOutcome.AlreadyIn;
    },
  );
  const problems: Array<string> = getAddProblemSentences({
    workspaceType: data.workspaceType,
    results: results,
    viewerUserId: data.viewerUserId,
    translator: translator,
  });

  if (data.teamName !== undefined) {
    if (added.length > 0) {
      notices.push({
        tone: PeopleSearchNoticeTone.Done,
        text: translator.translatePlural(ADDED_FROM_TEAM, added.length, {
          team: data.teamName,
        }),
      });
    } else if (alreadyIn.length > 0 && problems.length === 0) {
      notices.push({
        tone: PeopleSearchNoticeTone.Unchanged,
        text: translator.translateTemplate(RECORD_CHANNEL_TEXT.teamAlreadyIn, {
          team: data.teamName,
        }),
      });
    }
  } else {
    for (const result of [...added, ...alreadyIn]) {
      const text: { self: string; other: string } = getAddOutcomeText(
        data.workspaceType,
        result.outcome,
      );
      const isViewer: boolean =
        Boolean(viewerKey) && result.userId.toLowerCase() === viewerKey;

      notices.push({
        tone:
          result.outcome === WorkspaceChannelAddOutcome.Added
            ? PeopleSearchNoticeTone.Done
            : PeopleSearchNoticeTone.Unchanged,
        text: isViewer
          ? translator.translateText(text.self) || text.self
          : translator.translateTemplate(text.other, { name: result.name }),
      });
    }
  }

  for (const problem of problems) {
    notices.push({ tone: PeopleSearchNoticeTone.Problem, text: problem });
  }

  if (data.answer.channelState) {
    const stateText: string | undefined = getChannelStateText(
      data.workspaceType,
      data.answer.channelState,
    );

    if (stateText) {
      notices.push({
        tone: PeopleSearchNoticeTone.Problem,
        text: translator.translateText(stateText) || stateText,
      });
    }
  }

  return notices;
}

/*
 * The hint for a channel the app was taken out of, in three parts, so the
 * page can show the Slack command in it as a command: the words before it,
 * the command ("/invite @OneUptime"), the words after. Without a command in
 * it - a language that words it otherwise - the whole hint is `before`.
 */
export const SLACK_INVITE_COMMAND_START: string = "/invite @";

/*
 * What a Slack handle is written with. The command ends where they do: at a
 * space, at a sentence's full stop, or at a word a language writes straight
 * after it (Korean's "/invite @OneUptime을").
 */
const SLACK_HANDLE_CHARACTER_REGEX: RegExp = /[A-Za-z0-9._-]/;

export function splitAtSlackInviteCommand(hint: string): {
  before: string;
  command: string;
  after: string;
} {
  const start: number = hint.indexOf(SLACK_INVITE_COMMAND_START);

  if (start < 0) {
    return { before: hint, command: "", after: "" };
  }

  let end: number = start + SLACK_INVITE_COMMAND_START.length;

  while (
    end < hint.length &&
    SLACK_HANDLE_CHARACTER_REGEX.test(hint.charAt(end))
  ) {
    end++;
  }

  // The full stop that ends the sentence is not the handle's.
  while (end > start && hint.charAt(end - 1) === ".") {
    end--;
  }

  const command: string = hint.substring(start, end);

  if (command.length <= SLACK_INVITE_COMMAND_START.length) {
    return { before: hint, command: "", after: "" };
  }

  return {
    before: hint.substring(0, start),
    command: command,
    after: hint.substring(end),
  };
}
