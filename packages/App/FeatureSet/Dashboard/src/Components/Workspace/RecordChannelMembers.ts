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
  connectProjectSlack: string;
  teamAlreadyIn: string;
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
  openInSlack: translationKey("Open in Slack"),
  // Slack was taken off the project: where it is connected again.
  connectProjectSlack: translationKey("Connect Slack"),
  // A team picked in Add people whose people are all in the channel.
  teamAlreadyIn: translationKey(
    "Everyone in {{team}} is already in this channel.",
  ),
};

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

// The outcomes somebody has to do something about.
export type AddProblemOutcome = Exclude<
  WorkspaceChannelAddOutcome,
  WorkspaceChannelAddOutcome.Added | WorkspaceChannelAddOutcome.AlreadyIn
>;

/*
 * Several people with the same problem, said once: "OneUptime can't find
 * Ada Lovelace and Bob Stone in Slack: ..." - a team picked in Add people
 * would otherwise repeat a long sentence for each of them. {{names}} is
 * their names, listed the way the sentence's language lists names.
 */
export const ADD_PROBLEM_TEXT_FOR_SEVERAL: Record<AddProblemOutcome, string> = {
  [WorkspaceChannelAddOutcome.NotFound]: translationKey(
    "OneUptime can't find {{names}} in Slack: their accounts aren't connected, and no Slack account has their email address. Ask them to connect Slack in User Settings.",
  ),
  [WorkspaceChannelAddOutcome.NotProjectMember]: translationKey(
    "{{names}} aren't members of this project, so OneUptime can't add them.",
  ),
  [WorkspaceChannelAddOutcome.Guest]: translationKey(
    "{{names}} are guests in Slack, and Slack doesn't let OneUptime add them to this channel.",
  ),
  [WorkspaceChannelAddOutcome.TryAgain]: translationKey(
    "Slack didn't answer for {{names}}. Try again in a minute.",
  ),
  [WorkspaceChannelAddOutcome.Refused]: translationKey(
    "Slack didn't let OneUptime add {{names}}.",
  ),
};

// The order the problems of one pick are said in: what to do first, first.
export const ADD_PROBLEM_ORDER: ReadonlyArray<AddProblemOutcome> = [
  WorkspaceChannelAddOutcome.NotFound,
  WorkspaceChannelAddOutcome.NotProjectMember,
  WorkspaceChannelAddOutcome.Guest,
  WorkspaceChannelAddOutcome.Refused,
  WorkspaceChannelAddOutcome.TryAgain,
];

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

/*
 * Every problem of an answer, in the reader's language: the viewer as
 * "you", somebody else by name, and several people with the same problem
 * in one sentence that names them all.
 */
export function getAddProblemSentences(data: {
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

    if (others.length < people.length) {
      const self: string = ADD_OUTCOME_TEXT[outcome].self;

      sentences.push(translator.translateText(self) || self);
    }

    if (others.length === 1) {
      sentences.push(
        translator.translateTemplate(ADD_OUTCOME_TEXT[outcome].other, {
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
        translator.translateTemplate(ADD_PROBLEM_TEXT_FOR_SEVERAL[outcome], {
          names: composedValue((sentence: Translator): string => {
            return formatNameList(names, "and", sentence);
          }),
        }),
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
      const text: { self: string; other: string } =
        ADD_OUTCOME_TEXT[result.outcome];
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
    const stateText: string | undefined =
      CHANNEL_STATE_TEXT[
        data.answer.channelState as keyof typeof CHANNEL_STATE_TEXT
      ];

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
