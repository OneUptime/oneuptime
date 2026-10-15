import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import NotificationRuleInvites, {
  NotificationRuleInvitee,
} from "Common/Types/Workspace/NotificationRules/NotificationRuleInvites";
import IncidentNotificationRule from "Common/Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import {
  composedValue,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { formatNameList } from "../../AiAccess/AiAccessModes";

/*
 * WHAT A WORKSPACE NOTIFICATION RULE SAYS, IN PLAIN WORDS.
 *
 * The rule form's words and the sentences that say what a rule does, on
 * its card and under its form as it is filled in:
 *
 *   When: Incident State contains any Acknowledged
 *   Then:
 *     - Creates a channel like #inc-42 for each incident.
 *     - Invites on-call responders as they are paged, the Incident
 *       Commander and other incident roles as they are assigned and owners
 *       as they are added.
 *     - Archives the channel when the incident is resolved.
 *     - Posts updates in #ops.
 *
 * React-free, so the copy can be read where React is not (App's tests).
 * Every sentence is whole in the locale files - one per kind of record
 * where the record is named - so it reads right in every language; a list
 * of names goes in as a composedValue built in the sentence's language.
 */

type ByEventType = Readonly<Record<NotificationRuleEventType, string>>;

// The Conditions step's field: which records the rule is for.
export const NOTIFICATION_RULE_CONDITIONS_TITLES: ByEventType = {
  [NotificationRuleEventType.Incident]: translationKey("Which incidents"),
  [NotificationRuleEventType.Alert]: translationKey("Which alerts"),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "Which incident episodes",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "Which alert episodes",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "Which scheduled maintenance events",
  ),
  [NotificationRuleEventType.Monitor]: translationKey("Which monitors"),
  [NotificationRuleEventType.OnCallDutyPolicy]: translationKey(
    "Which on-call policies",
  ),
};

/*
 * And when they are checked: when the record is created and each time it
 * changes - so a rule for acknowledged incidents acts when an incident is
 * acknowledged, not only when one is created.
 */
export const NOTIFICATION_RULE_CONDITIONS_DESCRIPTIONS: ByEventType = {
  [NotificationRuleEventType.Incident]: translationKey(
    "Conditions are checked when an incident is created and again each time it changes, so a rule for acknowledged incidents acts when an incident is acknowledged.",
  ),
  [NotificationRuleEventType.Alert]: translationKey(
    "Conditions are checked when an alert is created and again each time it changes, so a rule for acknowledged alerts acts when an alert is acknowledged.",
  ),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "Conditions are checked when an incident episode is created and again each time it changes.",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "Conditions are checked when an alert episode is created and again each time it changes.",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "Conditions are checked when an event is created and again each time it changes, so a rule for ongoing events acts when an event starts.",
  ),
  [NotificationRuleEventType.Monitor]: translationKey(
    "Conditions are checked when a monitor is created and again each time it changes.",
  ),
  [NotificationRuleEventType.OnCallDutyPolicy]: translationKey(
    "Conditions are checked when an on-call policy is created and again each time it changes.",
  ),
};

// Under the Add Condition button, while there is none.
export const NO_CONDITIONS_YET_SENTENCES: ByEventType = {
  [NotificationRuleEventType.Incident]: translationKey(
    "No conditions: the rule is for every incident.",
  ),
  [NotificationRuleEventType.Alert]: translationKey(
    "No conditions: the rule is for every alert.",
  ),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "No conditions: the rule is for every incident episode.",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "No conditions: the rule is for every alert episode.",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "No conditions: the rule is for every scheduled maintenance event.",
  ),
  [NotificationRuleEventType.Monitor]: translationKey(
    "No conditions: the rule is for every monitor.",
  ),
  [NotificationRuleEventType.OnCallDutyPolicy]: translationKey(
    "No conditions: the rule is for every on-call policy.",
  ),
};

// The rules' card on a product's Slack or Microsoft Teams page.
export const NOTIFICATION_RULES_CARD_TITLE: string =
  translationKey("Notification Rules");

export const NOTIFICATION_RULES_CARD_DESCRIPTIONS: ByEventType = {
  [NotificationRuleEventType.Incident]: translationKey(
    "Each rule picks the incidents it is for, then posts their updates to channels you have, or creates a channel for each incident with the people working on it.",
  ),
  [NotificationRuleEventType.Alert]: translationKey(
    "Each rule picks the alerts it is for, then posts their updates to channels you have, or creates a channel for each alert with the people working on it.",
  ),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "Each rule picks the incident episodes it is for, then posts their updates to channels you have, or creates a channel for each episode with the people working on it.",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "Each rule picks the alert episodes it is for, then posts their updates to channels you have, or creates a channel for each episode with the people working on it.",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "Each rule picks the scheduled maintenance events it is for, then posts their updates to channels you have, or creates a channel for each event.",
  ),
  [NotificationRuleEventType.Monitor]: translationKey(
    "Each rule picks the monitors it is for, then posts their updates to channels you have, or creates a channel for each monitor.",
  ),
  [NotificationRuleEventType.OnCallDutyPolicy]: translationKey(
    "Each rule picks the on-call policies it is for, then posts their updates to channels you have, or creates a channel for each policy.",
  ),
};

// The Destination step's field.
export const NOTIFICATION_RULE_DESTINATION_TITLES: Readonly<
  Record<WorkspaceType, string>
> = {
  [WorkspaceType.Slack]: translationKey("Then, in Slack"),
  [WorkspaceType.MicrosoftTeams]: translationKey("Then, in Microsoft Teams"),
};

export const NOTIFICATION_RULE_DESTINATION_DESCRIPTION: string = translationKey(
  "Where updates are posted, and who joins the channel the rule creates.",
);

// The switch that creates a channel for each record.
export const CREATE_CHANNEL_TITLES: ByEventType = {
  [NotificationRuleEventType.Incident]: translationKey(
    "Create a channel for each incident",
  ),
  [NotificationRuleEventType.Alert]: translationKey(
    "Create a channel for each alert",
  ),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "Create a channel for each incident episode",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "Create a channel for each alert episode",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "Create a channel for each scheduled maintenance event",
  ),
  [NotificationRuleEventType.Monitor]: translationKey(
    "Create a channel for each monitor",
  ),
  [NotificationRuleEventType.OnCallDutyPolicy]: translationKey(
    "Create a channel for each on-call policy",
  ),
};

export const CREATE_CHANNEL_DESCRIPTIONS: ByEventType = {
  [NotificationRuleEventType.Incident]: translationKey(
    "The first time an incident matches this rule, OneUptime creates its channel and posts the incident's updates there.",
  ),
  [NotificationRuleEventType.Alert]: translationKey(
    "The first time an alert matches this rule, OneUptime creates its channel and posts the alert's updates there.",
  ),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "The first time an incident episode matches this rule, OneUptime creates its channel and posts the episode's updates there.",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "The first time an alert episode matches this rule, OneUptime creates its channel and posts the episode's updates there.",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "The first time a scheduled maintenance event matches this rule, OneUptime creates its channel and posts the event's updates there.",
  ),
  [NotificationRuleEventType.Monitor]: translationKey(
    "The first time a monitor matches this rule, OneUptime creates its channel and posts the monitor's updates there.",
  ),
  [NotificationRuleEventType.OnCallDutyPolicy]: translationKey(
    "The first time an on-call policy matches this rule, OneUptime creates its channel and posts the policy's updates there.",
  ),
};

// Who joins the channel: the people the record has, as they join it.
export const WHO_JOINS_SECTION_TITLE: string = translationKey(
  "Who joins the channel",
);

export const WHO_JOINS_SECTION_DESCRIPTION: string = translationKey(
  "People are added as they join, not only when the channel is created. Someone without a connected Slack account is named in the channel instead.",
);

export const ON_CALL_RESPONDERS_TITLE: string = translationKey(
  "On-call responders, as they are paged",
);

export const ON_CALL_RESPONDERS_DESCRIPTION: string = translationKey(
  "Each person an on-call policy pages.",
);

export const INCIDENT_ROLES_TITLE: string = translationKey(
  "Incident Commander and other incident roles, as they are assigned",
);

export const INCIDENT_ROLES_DESCRIPTION: string = translationKey(
  "The commander is usually assigned when someone first acknowledges or changes the state.",
);

export const OWNERS_TITLE: string = translationKey("Owners, as they are added");

export const ALSO_INVITE_TITLE: string = translationKey("Also invite");

export const ALSO_INVITE_DESCRIPTION: string = translationKey(
  "These people and teams join every channel the rule creates.",
);

export const ALSO_INVITE_BUTTON_TEXT: string = translationKey(
  "Add people or teams",
);

/*
 * Microsoft Teams shows a team's channels to everybody in the team, so
 * OneUptime adds nobody to a channel one by one there.
 */
export const TEAMS_WHO_JOINS_NOTE: string = translationKey(
  "Everyone in the team can open the channel: Microsoft Teams shows a team's channels to all of its members.",
);

// What happens to the channel when the record is over.
export const ARCHIVE_CHANNEL_TITLES: ByEventType = {
  [NotificationRuleEventType.Incident]: translationKey(
    "Archive the channel when the incident is resolved",
  ),
  [NotificationRuleEventType.Alert]: translationKey(
    "Archive the channel when the alert is resolved",
  ),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "Archive the channel when the incident episode is resolved",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "Archive the channel when the alert episode is resolved",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "Archive the channel when the event is completed",
  ),
  [NotificationRuleEventType.Monitor]: translationKey(
    "Archive the channel when the monitor is deleted",
  ),
  [NotificationRuleEventType.OnCallDutyPolicy]: translationKey(
    "Archive the channel when the on-call policy is deleted",
  ),
};

// Posting to channels and chats people already have.
export const POST_TO_EXISTING_CHANNELS_TITLE: string = translationKey(
  "Post to existing channels",
);

export const POST_TO_EXISTING_CHANNELS_DESCRIPTION: string = translationKey(
  "Post updates in channels you already have, while the conditions match.",
);

export const EXISTING_CHANNEL_NAMES_TITLE: string = translationKey("Channels");

export const EXISTING_CHANNEL_NAMES_DESCRIPTIONS: Readonly<
  Record<WorkspaceType, string>
> = {
  [WorkspaceType.Slack]: translationKey(
    "Channel names, separated by commas. Invite the OneUptime app to a private channel first.",
  ),
  [WorkspaceType.MicrosoftTeams]: translationKey(
    "Channel names in the team, separated by commas.",
  ),
};

export const TEAM_TITLE: string = translationKey("Team");

export const EXISTING_CHANNELS_TEAM_DESCRIPTION: string = translationKey(
  "The team whose channels these are.",
);

export const NEW_CHANNEL_TEAM_DESCRIPTION: string = translationKey(
  "The team the channel is created in.",
);

export const POST_TO_CHATS_TITLE: string = translationKey("Post to chats");

export const POST_TO_CHATS_DESCRIPTION: string = translationKey(
  "Post updates in group chats and one-on-one chats the OneUptime app was added to.",
);

export const CHATS_TITLE: string = translationKey("Chats");

// The rule's card.
export const RULE_WHEN_TITLE: string = translationKey("When");
export const RULE_THEN_TITLE: string = translationKey("Then");
export const RULE_SUMMARY_TITLE: string = translationKey("What this rule does");

// A rule without conditions, on its card.
export const NO_CONDITIONS_SENTENCES: ByEventType = {
  [NotificationRuleEventType.Incident]: translationKey("Every incident."),
  [NotificationRuleEventType.Alert]: translationKey("Every alert."),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "Every incident episode.",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "Every alert episode.",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "Every scheduled maintenance event.",
  ),
  [NotificationRuleEventType.Monitor]: translationKey("Every monitor."),
  [NotificationRuleEventType.OnCallDutyPolicy]: translationKey(
    "Every on-call policy.",
  ),
};

/*
 * The sentences that say what a rule does. A channel's name is the one an
 * example record's channel gets (ChannelNamePreview), as the workspace
 * shows it: #inc-42 in Slack, inc-42 in Microsoft Teams.
 */
export const CREATES_CHANNEL_SENTENCES: ByEventType = {
  [NotificationRuleEventType.Incident]: translationKey(
    "Creates a channel like {{channel}} for each incident.",
  ),
  [NotificationRuleEventType.Alert]: translationKey(
    "Creates a channel like {{channel}} for each alert.",
  ),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "Creates a channel like {{channel}} for each incident episode.",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "Creates a channel like {{channel}} for each alert episode.",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "Creates a channel like {{channel}} for each scheduled maintenance event.",
  ),
  [NotificationRuleEventType.Monitor]: translationKey(
    "Creates a channel like {{channel}} for each monitor.",
  ),
  [NotificationRuleEventType.OnCallDutyPolicy]: translationKey(
    "Creates a channel like {{channel}} for each on-call policy.",
  ),
};

// Without a name to show: the project's number prefixes are not known.
export const CREATES_CHANNEL_WITHOUT_NAME_SENTENCES: ByEventType = {
  [NotificationRuleEventType.Incident]: translationKey(
    "Creates a channel for each incident.",
  ),
  [NotificationRuleEventType.Alert]: translationKey(
    "Creates a channel for each alert.",
  ),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "Creates a channel for each incident episode.",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "Creates a channel for each alert episode.",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "Creates a channel for each scheduled maintenance event.",
  ),
  [NotificationRuleEventType.Monitor]: translationKey(
    "Creates a channel for each monitor.",
  ),
  [NotificationRuleEventType.OnCallDutyPolicy]: translationKey(
    "Creates a channel for each on-call policy.",
  ),
};

export const INVITES_SENTENCE: string = translationKey("Invites {{people}}.");

export const INVITES_NOBODY_SENTENCE: string = translationKey(
  "Invites nobody to the channel: add people to it yourself.",
);

// The people a rule adds, as the invites sentence lists them.
export const INVITEE_PHRASES: Readonly<
  Record<NotificationRuleInvitee, string>
> = {
  [NotificationRuleInvitee.OnCallResponders]: translationKey(
    "on-call responders as they are paged",
  ),
  [NotificationRuleInvitee.IncidentRoles]: translationKey(
    "the Incident Commander and other incident roles as they are assigned",
  ),
  [NotificationRuleInvitee.Owners]: translationKey("owners as they are added"),
};

// The people and teams a rule names, at the end of the invites sentence.
export const NAMED_PEOPLE_PHRASE: string = translationKey(
  "{{names}} when the channel is created",
);

export const TEAMS_EVERYONE_SENTENCE: string = translationKey(
  "Everyone in {{team}} can open the channel.",
);

export const TEAMS_EVERYONE_WITHOUT_TEAM_SENTENCE: string = translationKey(
  "Everyone in the team can open the channel.",
);

export const ARCHIVES_SENTENCES: ByEventType = {
  [NotificationRuleEventType.Incident]: translationKey(
    "Archives the channel when the incident is resolved.",
  ),
  [NotificationRuleEventType.Alert]: translationKey(
    "Archives the channel when the alert is resolved.",
  ),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "Archives the channel when the incident episode is resolved.",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "Archives the channel when the alert episode is resolved.",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "Archives the channel when the event is completed.",
  ),
  [NotificationRuleEventType.Monitor]: translationKey(
    "Archives the channel when the monitor is deleted.",
  ),
  [NotificationRuleEventType.OnCallDutyPolicy]: translationKey(
    "Archives the channel when the on-call policy is deleted.",
  ),
};

export const POSTS_IN_CHANNELS_SENTENCE: string = translationKey(
  "Posts updates in {{channels}}.",
);

export const POSTS_IN_CHATS_SENTENCE: string = translationKey(
  "Posts updates in the chats {{chats}}.",
);

export const NOTHING_CHOSEN_SENTENCE: string = translationKey(
  "Pick where this rule posts: existing channels, a channel of its own for each one, or both.",
);

/*
 * What the summary needs besides the rule: the names of what it refers to,
 * already found (users, teams, Microsoft Teams teams and chats), and the
 * name an example record's channel gets, as the workspace shows it.
 */
export interface NotificationRuleSummaryInput {
  rule: Partial<IncidentNotificationRule> | undefined;
  eventType: NotificationRuleEventType;
  workspaceType: WorkspaceType;
  translator: Translator;
  // "#inc-42", or undefined when it is not known yet.
  exampleChannelName?: string | undefined;
  userNames: Array<string>;
  teamNames: Array<string>;
  // The Microsoft Teams team the channel is created in, by its name.
  channelTeamName?: string | undefined;
  chatNames: Array<string>;
}

// The channels a rule names, as people wrote them, each once.
export function getExistingChannelNames(value: unknown): Array<string> {
  if (typeof value !== "string") {
    return [];
  }

  const names: Array<string> = [];

  for (const part of value.split(",")) {
    const name: string = part.trim();

    if (name && !names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}

/*
 * The sentences that say what a rule does, in the reader's language, in
 * the order the rule acts: its own channel and who joins it, then the
 * channels and chats it posts in.
 */
export function getNotificationRuleSummary(
  input: NotificationRuleSummaryInput,
): Array<string> {
  const rule: Partial<IncidentNotificationRule> = input.rule || {};
  const translator: Translator = input.translator;
  const sentences: Array<string> = [];

  if (rule.shouldCreateNewChannel) {
    sentences.push(
      input.exampleChannelName
        ? translator.translateTemplate(
            CREATES_CHANNEL_SENTENCES[input.eventType],
            { channel: input.exampleChannelName },
          )
        : translator.translateText(
            CREATES_CHANNEL_WITHOUT_NAME_SENTENCES[input.eventType],
          ) || "",
    );

    if (input.workspaceType === WorkspaceType.MicrosoftTeams) {
      sentences.push(
        input.channelTeamName
          ? translator.translateTemplate(TEAMS_EVERYONE_SENTENCE, {
              team: input.channelTeamName,
            })
          : translator.translateText(TEAMS_EVERYONE_WITHOUT_TEAM_SENTENCE) ||
              "",
      );
    } else {
      sentences.push(getInvitesSentence(input));

      // Slack only: OneUptime cannot archive a Microsoft Teams channel.
      if (rule.archiveChannelAutomatically) {
        sentences.push(
          translator.translateText(ARCHIVES_SENTENCES[input.eventType]) || "",
        );
      }
    }
  }

  if (rule.shouldPostToExistingChannel) {
    const channels: Array<string> = getExistingChannelNames(
      rule.existingChannelNames,
    );

    if (channels.length > 0) {
      sentences.push(
        translator.translateTemplate(POSTS_IN_CHANNELS_SENTENCE, {
          channels: composedValue((sentence: Translator): string => {
            return formatNameList(channels, "and", sentence);
          }),
        }),
      );
    }
  }

  if (
    input.workspaceType === WorkspaceType.MicrosoftTeams &&
    rule.shouldPostToExistingChat &&
    input.chatNames.length > 0
  ) {
    sentences.push(
      translator.translateTemplate(POSTS_IN_CHATS_SENTENCE, {
        chats: composedValue((sentence: Translator): string => {
          return formatNameList(input.chatNames, "and", sentence);
        }),
      }),
    );
  }

  return sentences.filter((sentence: string): boolean => {
    return Boolean(sentence);
  });
}

/*
 * Who the rule invites to its channel, in one sentence: the kinds of people
 * the record has, as they join it, then the people and teams the rule
 * names.
 */
function getInvitesSentence(input: NotificationRuleSummaryInput): string {
  const translator: Translator = input.translator;

  const invitees: Array<NotificationRuleInvitee> =
    NotificationRuleInvites.getInvited({
      rule: input.rule,
      eventType: input.eventType,
    });

  const names: Array<string> = [...input.userNames, ...input.teamNames];

  if (invitees.length === 0 && names.length === 0) {
    return translator.translateText(INVITES_NOBODY_SENTENCE) || "";
  }

  return translator.translateTemplate(INVITES_SENTENCE, {
    people: composedValue((sentence: Translator): string => {
      const phrases: Array<string> = invitees.map(
        (invitee: NotificationRuleInvitee): string => {
          return sentence.translateText(INVITEE_PHRASES[invitee]) || "";
        },
      );

      if (names.length > 0) {
        phrases.push(
          sentence.translateTemplate(NAMED_PEOPLE_PHRASE, {
            names: formatNameList(names, "and", sentence),
          }),
        );
      }

      return formatNameList(phrases, "and", sentence);
    }),
  });
}
