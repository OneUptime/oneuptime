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
import { RuleCriteriaSubject } from "Common/Types/Rules/RuleCriteriaSubject";
import {
  getRuleCriteriaSubjectCopy,
  RuleCriteriaSubjectCopy,
} from "Common/UI/Components/RuleCriteria/RuleCriteriaSubjectCopy";
import { formatNameList } from "../../AiAccess/AiAccessModes";
import {
  canRuleCreateChannel,
  ChannelRecordEventType,
} from "./NotificationRuleOwnChannel";

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
 * A security case rule only posts to channels and chats people have
 * (NotificationRuleOwnChannel), so the words about a channel of the
 * record's own exist only for the kinds of record that can have one.
 *
 * React-free, so the copy can be read where React is not (App's tests).
 * Every sentence is whole in the locale files - one per kind of record
 * where the record is named - so it reads right in every language; a list
 * of names goes in as a composedValue built in the sentence's language.
 */

type ByEventType = Readonly<Record<NotificationRuleEventType, string>>;

// Words about the channel a rule creates: only where a rule can create one.
type ByChannelEventType = Readonly<Record<ChannelRecordEventType, string>>;

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
  [NotificationRuleEventType.SecurityCase]: translationKey(
    "Which security cases",
  ),
};

/*
 * And when they are checked: when the record is created and each time it
 * changes - so a rule for acknowledged incidents acts when an incident is
 * acknowledged, not only when one is created. A security case's rules are
 * checked each time there is something to post about the case
 * (SecurityCaseNotifications), against the case as it is then.
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
  [NotificationRuleEventType.SecurityCase]: translationKey(
    "Conditions are checked each time there is something to post about a security case: when it opens or rises to a higher priority, is assigned, or has a playbook step waiting for approval.",
  ),
};

/*
 * What the Conditions step asks first, under "Which incidents": every
 * record of the rule's kind, or only those its conditions match - "All
 * incidents" / "Only incidents that match conditions", the words every
 * other rule's conditions are asked with (RuleCriteriaSubjectCopy). A new
 * rule starts on the first. It said "No conditions: the rule is for every
 * incident." under an Add Condition button, and people added a condition
 * they did not want.
 */
const RULE_SUBJECTS: Readonly<
  Partial<Record<NotificationRuleEventType, RuleCriteriaSubject>>
> = {
  [NotificationRuleEventType.Incident]: RuleCriteriaSubject.Incidents,
  [NotificationRuleEventType.Alert]: RuleCriteriaSubject.Alerts,
  [NotificationRuleEventType.IncidentEpisode]:
    RuleCriteriaSubject.IncidentEpisodes,
  [NotificationRuleEventType.AlertEpisode]: RuleCriteriaSubject.AlertEpisodes,
  [NotificationRuleEventType.ScheduledMaintenance]:
    RuleCriteriaSubject.ScheduledMaintenanceEvents,
  [NotificationRuleEventType.Monitor]: RuleCriteriaSubject.Monitors,
  [NotificationRuleEventType.OnCallDutyPolicy]:
    RuleCriteriaSubject.OnCallPolicies,
};

/*
 * The kinds of record only these rules are about, so no other rule's
 * conditions name them (RuleCriteriaSubject has no security cases): their
 * two answers, in the same words.
 */
const OWN_ANSWERS: Readonly<
  Partial<Record<NotificationRuleEventType, RuleCriteriaSubjectCopy>>
> = {
  [NotificationRuleEventType.SecurityCase]: {
    all: translationKey("All security cases"),
    matching: translationKey("Only security cases that match conditions"),
  },
};

const answersByEventType: (
  pick: (copy: RuleCriteriaSubjectCopy) => string,
) => ByEventType = (
  pick: (copy: RuleCriteriaSubjectCopy) => string,
): ByEventType => {
  const answers: Partial<Record<NotificationRuleEventType, string>> = {};

  for (const eventType of Object.values(NotificationRuleEventType)) {
    answers[eventType] = pick(
      OWN_ANSWERS[eventType] ||
        getRuleCriteriaSubjectCopy(RULE_SUBJECTS[eventType]),
    );
  }

  return answers as Record<NotificationRuleEventType, string>;
};

// "All incidents": a new rule's answer, with no conditions.
export const APPLIES_TO_ALL_ANSWERS: ByEventType = answersByEventType(
  (copy: RuleCriteriaSubjectCopy): string => {
    return copy.all;
  },
);

// "Only incidents that match conditions": the answer that opens them.
export const APPLIES_TO_MATCHING_ANSWERS: ByEventType = answersByEventType(
  (copy: RuleCriteriaSubjectCopy): string => {
    return copy.matching;
  },
);

/*
 * What one rule of each kind is called - on the card's Create button, the
 * rule form's title, the list's count and its empty state - whole, so each
 * reads in the reader's language. They were made from the kind's name,
 * "Incident" + " Notification Rule", which no locale had: German read
 * "Neu erstellen: Incident Notification Rule".
 */
export const RULE_SINGULAR_NAMES: ByEventType = {
  [NotificationRuleEventType.Incident]: translationKey(
    "Incident Notification Rule",
  ),
  [NotificationRuleEventType.Alert]: translationKey("Alert Notification Rule"),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "Incident Episode Notification Rule",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "Alert Episode Notification Rule",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "Scheduled Maintenance Notification Rule",
  ),
  [NotificationRuleEventType.Monitor]: translationKey(
    "Monitor Notification Rule",
  ),
  [NotificationRuleEventType.OnCallDutyPolicy]: translationKey(
    "On-Call Policy Notification Rule",
  ),
  [NotificationRuleEventType.SecurityCase]: translationKey(
    "Security Case Notification Rule",
  ),
};

export const RULE_PLURAL_NAMES: ByEventType = {
  [NotificationRuleEventType.Incident]: translationKey(
    "Incident Notification Rules",
  ),
  [NotificationRuleEventType.Alert]: translationKey("Alert Notification Rules"),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "Incident Episode Notification Rules",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "Alert Episode Notification Rules",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "Scheduled Maintenance Notification Rules",
  ),
  [NotificationRuleEventType.Monitor]: translationKey(
    "Monitor Notification Rules",
  ),
  [NotificationRuleEventType.OnCallDutyPolicy]: translationKey(
    "On-Call Policy Notification Rules",
  ),
  [NotificationRuleEventType.SecurityCase]: translationKey(
    "Security Case Notification Rules",
  ),
};

/*
 * What a rule's conditions check, and how: the Conditions step's dropdowns
 * and the rule's card show a condition by its own values
 * (NotificationRuleConditionCheckOn, ConditionType - "Incident State",
 * "Contains Any"), and these are their words, listed so each is translated:
 * a German reader read "Vorfallsstatus Contains Any". A test holds the lists
 * to the enums. They are not imported here, which keeps this module free of
 * the condition module and the UI it reaches.
 */
export const CONDITION_FIELD_WORDS: ReadonlyArray<string> = [
  translationKey("Monitor Name"),
  translationKey("Incident Title"),
  translationKey("Incident Description"),
  translationKey("Incident Severity"),
  translationKey("Incident State"),
  translationKey("Monitor Type"),
  translationKey("Monitor Status"),
  translationKey("Alert Title"),
  translationKey("Alert Description"),
  translationKey("Alert Severity"),
  translationKey("Alert State"),
  translationKey("Alert Episode Title"),
  translationKey("Alert Episode Description"),
  translationKey("Alert Episode Severity"),
  translationKey("Alert Episode State"),
  translationKey("Alert Episode Labels"),
  translationKey("Incident Episode Title"),
  translationKey("Incident Episode Description"),
  translationKey("Incident Episode Severity"),
  translationKey("Incident Episode State"),
  translationKey("Incident Episode Labels"),
  translationKey("Scheduled Maintenance Title"),
  translationKey("Scheduled Maintenance Description"),
  translationKey("Scheduled Maintenance State"),
  translationKey("Incident Labels"),
  translationKey("Alert Labels"),
  translationKey("Monitor Labels"),
  translationKey("Scheduled Maintenance Labels"),
  translationKey("Monitors"),
  translationKey("On Call Duty Policy Name"),
  translationKey("On Call Duty Policy Description"),
  translationKey("On Call Duty Policy Labels"),
  translationKey("Security Case Title"),
  translationKey("Security Case Description"),
  translationKey("Security Case Priority"),
  translationKey("Security Case Status"),
  translationKey("Security Case Source"),
  translationKey("Security Case Labels"),
];

export const CONDITION_OPERATOR_WORDS: ReadonlyArray<string> = [
  translationKey("Equal To"),
  translationKey("Not Equal To"),
  translationKey("Greater Than"),
  translationKey("Less Than"),
  translationKey("Greater Than Or Equal To"),
  translationKey("Less Than Or Equal To"),
  translationKey("Contains"),
  translationKey("Contains Any"),
  translationKey("Not Contains"),
  translationKey("Starts With"),
  translationKey("Ends With"),
  translationKey("Is Empty"),
  translationKey("Is Not Empty"),
  translationKey("True"),
  translationKey("False"),
  translationKey("Contains All"),
];

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
  // What there is to post about a case: SecurityCaseNotifications.
  [NotificationRuleEventType.SecurityCase]: translationKey(
    "Each rule picks the security cases it is for, then posts to channels you have when a case opens, is assigned or has a playbook step waiting for approval.",
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

/*
 * A rule that only posts (a security case's) creates no channel, so nobody
 * joins one: the step is only where it posts.
 */
export const POSTS_ONLY_DESTINATION_DESCRIPTIONS: Readonly<
  Record<WorkspaceType, string>
> = {
  [WorkspaceType.Slack]: translationKey("The channels the rule posts in."),
  [WorkspaceType.MicrosoftTeams]: translationKey(
    "The channels and chats the rule posts in.",
  ),
};

export function getNotificationRuleDestinationDescription(data: {
  eventType: NotificationRuleEventType;
  workspaceType: WorkspaceType;
}): string {
  return canRuleCreateChannel(data.eventType)
    ? NOTIFICATION_RULE_DESTINATION_DESCRIPTION
    : POSTS_ONLY_DESTINATION_DESCRIPTIONS[data.workspaceType];
}

// The switch that creates a channel for each record.
export const CREATE_CHANNEL_TITLES: ByChannelEventType = {
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

export const CREATE_CHANNEL_DESCRIPTIONS: ByChannelEventType = {
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
  "Everyone paged by an on-call policy.",
);

export const INCIDENT_ROLES_TITLE: string = translationKey(
  "Incident Commander and other incident roles, as they are assigned",
);

export const INCIDENT_ROLES_DESCRIPTION: string = translationKey(
  "The commander is usually assigned when someone first acknowledges the incident or changes its state.",
);

export const OWNERS_TITLE: string = translationKey("Owners, as they are added");

export const ALSO_INVITE_TITLE: string = translationKey("Also invite");

export const ALSO_INVITE_DESCRIPTION: string = translationKey(
  "These people and teams join every channel the rule creates, with whoever is on call in these schedules when the channel is created. Nobody is paged.",
);

export const ALSO_INVITE_BUTTON_TEXT: string = translationKey(
  "Add people, teams or schedules",
);

export const ALSO_INVITE_SEARCH_PLACEHOLDER: string = translationKey(
  "Search people, teams or schedules...",
);

export const ALSO_INVITE_EMPTY_TEXT: string = translationKey(
  "No people, teams or schedules available.",
);

/*
 * Microsoft Teams adds nobody to a channel: the people on call in the
 * schedules a rule names are @mentioned in it instead, so Teams notifies
 * them (MicrosoftTeamsOnCallMention).
 */
export const MENTION_ON_CALL_TITLE: string = translationKey(
  "Mention who is on call",
);

export const MENTION_ON_CALL_DESCRIPTION: string = translationKey(
  "Whoever is on call in these schedules when the channel is created is @mentioned in it, so Microsoft Teams notifies them. Nobody is paged.",
);

export const MENTION_ON_CALL_BUTTON_TEXT: string =
  translationKey("Add schedules");

export const MENTION_ON_CALL_SEARCH_PLACEHOLDER: string = translationKey(
  "Search on-call schedules...",
);

export const MENTION_ON_CALL_EMPTY_TEXT: string = translationKey(
  "No on-call schedules available.",
);

/*
 * Microsoft Teams shows a team's channels to everybody in the team, so
 * OneUptime adds nobody to a channel one by one there.
 */
export const TEAMS_WHO_JOINS_NOTE: string = translationKey(
  "Everyone in the team can open the channel: Microsoft Teams shows a team's channels to all of its members.",
);

// What happens to the channel when the record is over.
export const ARCHIVE_CHANNEL_TITLES: ByChannelEventType = {
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

/*
 * Slack only, and only for the records that have a thread there
 * (WorkspaceRecordThreads): the record's first message starts the thread in
 * each channel above, and everything after it is a reply. A kind of record
 * without a title here - a monitor, an on-call policy - is not offered it.
 */
export const POST_UPDATES_IN_THREAD_TITLES: Readonly<
  Partial<Record<NotificationRuleEventType, string>>
> = {
  [NotificationRuleEventType.Incident]: translationKey(
    "Keep each incident's updates in one thread",
  ),
  [NotificationRuleEventType.Alert]: translationKey(
    "Keep each alert's updates in one thread",
  ),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "Keep each incident episode's updates in one thread",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "Keep each alert episode's updates in one thread",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "Keep each event's updates in one thread",
  ),
};

export const POST_UPDATES_IN_THREAD_DESCRIPTION: string = translationKey(
  "The first message starts a thread. Later updates are replies in it, and state changes and on-call alarms show in the channel too.",
);

export const TEAM_TITLE: string = translationKey("Team");

export const TEAM_PLACEHOLDER: string = translationKey("Select a team");

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

export const CHATS_PLACEHOLDER: string = translationKey("Select chats");

/*
 * Which chats are listed, and what to do when one is missing or shows an
 * old name. It was a paragraph of four clauses under the field.
 */
export const CHATS_DESCRIPTION: string = translationKey(
  "Chats the OneUptime app was added to in Microsoft Teams. Wrong names? Click Refresh Chats in Project Settings > Workspace > Microsoft Teams.",
);

export const NO_CHATS_DESCRIPTION: string = translationKey(
  "No chats are connected yet. In Microsoft Teams, add the OneUptime app to the chat you want to post to, and it appears here.",
);

// The Video Call step, of the rules that can start a call.
export const VIDEO_CALL_STEP_TITLE: string = translationKey("Video call");

export const VIDEO_CALL_STEP_DESCRIPTIONS: Readonly<
  Partial<Record<NotificationRuleEventType, string>>
> = {
  [NotificationRuleEventType.Incident]: translationKey(
    "Start a dedicated call for the incident when this rule fires.",
  ),
  [NotificationRuleEventType.Alert]: translationKey(
    "Start a dedicated call for the alert when this rule fires.",
  ),
};

/*
 * The rule's card: which records the rule is for - titled as the
 * Conditions step asks it, NOTIFICATION_RULE_CONDITIONS_TITLES - then what
 * it does with them. It was "When", whose translations are the "when?" of a
 * time ("Wann", "タイミング"): the key also names the time columns of the
 * AI logs.
 */
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
  [NotificationRuleEventType.SecurityCase]: translationKey(
    "Every security case.",
  ),
};

/*
 * The sentences that say what a rule does. A channel's name is the one an
 * example record's channel gets (ChannelNamePreview), as the workspace
 * shows it: #inc-42 in Slack, inc-42 in Microsoft Teams.
 */
export const CREATES_CHANNEL_SENTENCES: ByChannelEventType = {
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
export const CREATES_CHANNEL_WITHOUT_NAME_SENTENCES: ByChannelEventType = {
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

// The people and teams a rule names, when it names nobody else.
export const NAMED_PEOPLE_PHRASE: string = translationKey(
  "{{names}} when the channel is created",
);

/*
 * The people and teams a rule names, in a sentence of their own after the
 * kinds of people it invites - as the form asks them, under "Also invite".
 * They were the last item of one list: "... and owners as they are added
 * and Alice Smith, Bob Jones and Platform when the channel is created".
 */
export const ALSO_INVITES_SENTENCE: string = translationKey(
  "Also invites {{names}} when the channel is created.",
);

/*
 * The on-call schedules a rule names, whose on-call person joins its
 * channel without being paged: a sentence of their own, after the people
 * and teams it names.
 */
export const INVITES_ON_CALL_SENTENCE: string = translationKey(
  "Invites whoever is on call in {{schedules}} when the channel is created.",
);

export const ALSO_INVITES_ON_CALL_SENTENCE: string = translationKey(
  "Also invites whoever is on call in {{schedules}} when the channel is created.",
);

// Microsoft Teams: they are @mentioned in the channel instead.
export const MENTIONS_ON_CALL_SENTENCE: string = translationKey(
  "Mentions whoever is on call in {{schedules}} when the channel is created.",
);

export const TEAMS_EVERYONE_SENTENCE: string = translationKey(
  "Everyone in {{team}} can open the channel.",
);

export const TEAMS_EVERYONE_WITHOUT_TEAM_SENTENCE: string = translationKey(
  "Everyone in the team can open the channel.",
);

export const ARCHIVES_SENTENCES: ByChannelEventType = {
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

// After the channels it posts in, of a rule that keeps a thread there.
export const POSTS_IN_THREAD_SENTENCES: Readonly<
  Partial<Record<NotificationRuleEventType, string>>
> = {
  [NotificationRuleEventType.Incident]: translationKey(
    "Keeps each incident's updates in one thread there.",
  ),
  [NotificationRuleEventType.Alert]: translationKey(
    "Keeps each alert's updates in one thread there.",
  ),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "Keeps each incident episode's updates in one thread there.",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "Keeps each alert episode's updates in one thread there.",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "Keeps each event's updates in one thread there.",
  ),
};

export const POSTS_IN_CHATS_SENTENCE: string = translationKey(
  "Posts updates in the chats {{chats}}.",
);

// One chat is one chat: "in the chats On-call leads" read as several.
export const POSTS_IN_CHAT_SENTENCE: string = translationKey(
  "Posts updates in the chat {{chat}}.",
);

export const NOTHING_CHOSEN_SENTENCE: string = translationKey(
  "Pick where this rule posts: existing channels, a channel of its own for each one, or both.",
);

// A rule that only posts has no channel of its own to offer.
export const POSTS_ONLY_NOTHING_CHOSEN_SENTENCES: Readonly<
  Record<WorkspaceType, string>
> = {
  [WorkspaceType.Slack]: translationKey(
    "Name the channels this rule posts in.",
  ),
  [WorkspaceType.MicrosoftTeams]: translationKey(
    "Pick where this rule posts: existing channels, chats, or both.",
  ),
};

// What is still to choose, while the rule posts nowhere.
export function getNothingChosenSentence(data: {
  eventType: NotificationRuleEventType;
  workspaceType: WorkspaceType;
}): string {
  return canRuleCreateChannel(data.eventType)
    ? NOTHING_CHOSEN_SENTENCE
    : POSTS_ONLY_NOTHING_CHOSEN_SENTENCES[data.workspaceType];
}

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
  // The on-call schedules whose on-call person joins the channel.
  scheduleNames?: Array<string> | undefined;
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
 * channels and chats it posts in. A rule that only posts (a security
 * case's) never creates a channel, whatever it holds, so it says none.
 */
export function getNotificationRuleSummary(
  input: NotificationRuleSummaryInput,
): Array<string> {
  const rule: Partial<IncidentNotificationRule> = input.rule || {};
  const translator: Translator = input.translator;
  const sentences: Array<string> = [];
  const channelEventType: ChannelRecordEventType | null = canRuleCreateChannel(
    input.eventType,
  )
    ? input.eventType
    : null;

  if (rule.shouldCreateNewChannel && channelEventType) {
    sentences.push(
      input.exampleChannelName
        ? translator.translateTemplate(
            CREATES_CHANNEL_SENTENCES[channelEventType],
            { channel: input.exampleChannelName },
          )
        : translator.translateText(
            CREATES_CHANNEL_WITHOUT_NAME_SENTENCES[channelEventType],
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

      const scheduleNames: Array<string> = input.scheduleNames || [];

      if (scheduleNames.length > 0) {
        sentences.push(
          translator.translateTemplate(MENTIONS_ON_CALL_SENTENCE, {
            schedules: composedValue((sentence: Translator): string => {
              return formatNameList(scheduleNames, "and", sentence);
            }),
          }),
        );
      }
    } else {
      sentences.push(...getInvitesSentences(input));

      // Slack only: OneUptime cannot archive a Microsoft Teams channel.
      if (rule.archiveChannelAutomatically) {
        sentences.push(
          translator.translateText(ARCHIVES_SENTENCES[channelEventType]) || "",
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

      // Slack only: Microsoft Teams posts every update as a message of its own.
      const inThread: string | undefined =
        POSTS_IN_THREAD_SENTENCES[input.eventType];

      if (
        rule.shouldPostUpdatesInThread &&
        inThread &&
        input.workspaceType === WorkspaceType.Slack
      ) {
        sentences.push(translator.translateText(inThread) || "");
      }
    }
  }

  if (
    input.workspaceType === WorkspaceType.MicrosoftTeams &&
    rule.shouldPostToExistingChat &&
    input.chatNames.length > 0
  ) {
    sentences.push(
      input.chatNames.length === 1
        ? translator.translateTemplate(POSTS_IN_CHAT_SENTENCE, {
            chat: input.chatNames[0]!,
          })
        : translator.translateTemplate(POSTS_IN_CHATS_SENTENCE, {
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
 * Who the rule invites to its channel: the kinds of people the record has,
 * as they join it, in one sentence, then the people and teams the rule
 * names, in one of their own ("Also invites Alice Smith and Platform when
 * the channel is created."), then whoever is on call in the schedules it
 * names, in a last one. A rule that names people only invites them in the
 * first, and one that names only schedules says so in its only sentence.
 */
function getInvitesSentences(
  input: NotificationRuleSummaryInput,
): Array<string> {
  const translator: Translator = input.translator;

  const invitees: Array<NotificationRuleInvitee> =
    NotificationRuleInvites.getInvited({
      rule: input.rule,
      eventType: input.eventType,
    });

  const names: Array<string> = [...input.userNames, ...input.teamNames];
  const scheduleNames: Array<string> = input.scheduleNames || [];

  if (
    invitees.length === 0 &&
    names.length === 0 &&
    scheduleNames.length === 0
  ) {
    return [translator.translateText(INVITES_NOBODY_SENTENCE) || ""];
  }

  const namedPeople: (sentence: Translator) => string = (
    sentence: Translator,
  ): string => {
    return formatNameList(names, "and", sentence);
  };

  const sentences: Array<string> = [];

  if (invitees.length > 0) {
    sentences.push(
      translator.translateTemplate(INVITES_SENTENCE, {
        people: composedValue((sentence: Translator): string => {
          return formatNameList(
            invitees.map((invitee: NotificationRuleInvitee): string => {
              return sentence.translateText(INVITEE_PHRASES[invitee]) || "";
            }),
            "and",
            sentence,
          );
        }),
      }),
    );
  }

  if (names.length > 0) {
    sentences.push(
      sentences.length === 0
        ? translator.translateTemplate(INVITES_SENTENCE, {
            people: composedValue((sentence: Translator): string => {
              return sentence.translateTemplate(NAMED_PEOPLE_PHRASE, {
                names: namedPeople(sentence),
              });
            }),
          })
        : translator.translateTemplate(ALSO_INVITES_SENTENCE, {
            names: composedValue(namedPeople),
          }),
    );
  }

  if (scheduleNames.length > 0) {
    sentences.push(
      translator.translateTemplate(
        sentences.length === 0
          ? INVITES_ON_CALL_SENTENCE
          : ALSO_INVITES_ON_CALL_SENTENCE,
        {
          schedules: composedValue((sentence: Translator): string => {
            return formatNameList(scheduleNames, "and", sentence);
          }),
        },
      ),
    );
  }

  return sentences;
}
