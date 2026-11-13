import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import NotificationRuleUpdates, {
  NotificationRuleUpdateKind,
  NotificationRuleUpdatesChoice,
  StoredRuleUpdates,
} from "Common/Types/Workspace/NotificationRules/NotificationRuleUpdates";
import {
  formatInline,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHICH UPDATES A RULE POSTS, IN PLAIN WORDS (issue #7581).
 *
 * The words of a rule's Updates step and of the Updates row on its card:
 *
 *   Which updates to post
 *   The rule always posts when an incident is declared. Pick the updates
 *   it posts after that.
 *
 *   (o) Every update
 *       State changes, notes, owners, paging, edits and everything else.
 *   ( ) Key updates only
 *       Resolved and reopened, severity changes, public notes and the
 *       postmortem.
 *   ( ) Choose updates
 *       Pick the updates to post.
 *         [x] Resolved and reopened   [ ] Private notes ...
 *
 * Only the kinds of rule that choose their updates have them
 * (NotificationRuleUpdates.canChooseUpdates): incidents, alerts, their
 * episodes and scheduled maintenance. Each has all its words in one entry
 * of UPDATES_COPY, so a kind of rule that starts choosing its updates adds
 * one entry here and its kinds in NotificationRuleUpdates. Every sentence
 * is whole in the locale files, one per kind of record where the record is
 * named, so it reads right in every language.
 *
 * React-free, so App's tests can read it.
 */

export type UpdatesEventType =
  | NotificationRuleEventType.Incident
  | NotificationRuleEventType.Alert
  | NotificationRuleEventType.IncidentEpisode
  | NotificationRuleEventType.AlertEpisode
  | NotificationRuleEventType.ScheduledMaintenance;

// One box of Choose updates: its name, and what it covers.
export interface UpdateKindCopy {
  title: string;
  description: string;
}

// Every word of one kind of rule's Updates step, in English.
export interface UpdatesCopy {
  // Under the step's question: what the rule posts whatever it picks.
  sectionDescription: string;
  // Under Every update, and under Key updates only: what each posts.
  everyUpdateDescription: string;
  keyUpdatesDescription: string;
  // Under the boxes when none is ticked: what the rule still posts.
  nothingChosenNote: string;
  // Each update the rule can choose, by the update it stands for.
  kinds: Readonly<Partial<Record<NotificationRuleUpdateKind, UpdateKindCopy>>>;
}

// The step's question, its field's title and its section's heading.
export const UPDATES_SECTION_TITLE: string = translationKey(
  "Which updates to post",
);

// The three answers.
export const EVERY_UPDATE_TITLE: string = translationKey("Every update");
export const KEY_UPDATES_TITLE: string = translationKey("Key updates only");
export const CHOOSE_UPDATES_TITLE: string = translationKey("Choose updates");
export const CHOOSE_UPDATES_DESCRIPTION: string = translationKey(
  "Pick the updates to post.",
);

// The card's Updates row, for a rule that chose its updates.
export const CHOSEN_UPDATES_TITLE: string = translationKey("Chosen updates");
export const ONLY_FIRST_MESSAGE_TITLE: string = translationKey(
  "Only the first message",
);

// Words more than one kind of rule says the same way.
const RESOLVED_AND_REOPENED: string = translationKey("Resolved and reopened");
const OTHER_STATE_CHANGES: string = translationKey("Other state changes");
const SEVERITY_CHANGES: string = translationKey("Severity changes");
const PUBLIC_NOTES: string = translationKey("Public notes");
const PRIVATE_NOTES: string = translationKey("Private notes");
const OWNERS: string = translationKey("Owners");
const PAGING: string = translationKey("Paging");
const AI_ANALYSIS: string = translationKey("AI analysis and fixes");
const OTHER_EDITS: string = translationKey("Other edits");
const EVERYTHING_ELSE: string = translationKey("Everything else");

const NOTES_ON_STATUS_PAGES: string = translationKey(
  "Notes shown on status pages.",
);
const NOTES_OFF_STATUS_PAGES: string = translationKey(
  "Notes kept off status pages.",
);
const OWNERS_ADDED_AND_REMOVED: string = translationKey(
  "Owners added and removed.",
);
const WHO_WAS_PAGED: string = translationKey(
  "Who an on-call policy paged, and who acknowledged.",
);
const EPISODE_RESOLVED: string = translationKey(
  "When the episode is resolved, and if it is reopened.",
);
const EPISODE_OTHER_STATES: string = translationKey(
  "Acknowledged, and any other state the episode moves to.",
);
const ANYTHING_ELSE_ABOUT_THE_EPISODE: string = translationKey(
  "Anything else posted about the episode.",
);

export const UPDATES_COPY: Readonly<Record<UpdatesEventType, UpdatesCopy>> = {
  [NotificationRuleEventType.Incident]: {
    sectionDescription: translationKey(
      "The rule always posts when an incident is declared. Pick the updates it posts after that.",
    ),
    everyUpdateDescription: translationKey(
      "State changes, notes, owners, paging, edits and everything else.",
    ),
    keyUpdatesDescription: translationKey(
      "Resolved and reopened, severity changes, public notes and the postmortem.",
    ),
    nothingChosenNote: translationKey(
      "With none ticked, the rule posts only that the incident was declared, and a video call's Join button.",
    ),
    kinds: {
      [NotificationRuleUpdateKind.ResolvedAndReopened]: {
        title: RESOLVED_AND_REOPENED,
        description: translationKey(
          "When the incident is resolved, and if it is reopened.",
        ),
      },
      [NotificationRuleUpdateKind.StateChanges]: {
        title: OTHER_STATE_CHANGES,
        description: translationKey(
          "Acknowledged, and any other state the incident moves to.",
        ),
      },
      [NotificationRuleUpdateKind.SeverityChanges]: {
        title: SEVERITY_CHANGES,
        description: translationKey("When the incident's severity changes."),
      },
      [NotificationRuleUpdateKind.PublicNotes]: {
        title: PUBLIC_NOTES,
        description: NOTES_ON_STATUS_PAGES,
      },
      [NotificationRuleUpdateKind.PrivateNotes]: {
        title: PRIVATE_NOTES,
        description: NOTES_OFF_STATUS_PAGES,
      },
      [NotificationRuleUpdateKind.Owners]: {
        title: translationKey("Owners and roles"),
        description: translationKey(
          "Owners added and removed, and people given a role, such as Incident Commander.",
        ),
      },
      [NotificationRuleUpdateKind.Paging]: {
        title: PAGING,
        description: WHO_WAS_PAGED,
      },
      [NotificationRuleUpdateKind.Postmortem]: {
        title: translationKey("Postmortem"),
        description: translationKey("The postmortem's note and its status."),
      },
      [NotificationRuleUpdateKind.AI]: {
        title: AI_ANALYSIS,
        description: translationKey(
          "Root cause analysis, call summaries and automatic fixes.",
        ),
      },
      [NotificationRuleUpdateKind.Edits]: {
        title: OTHER_EDITS,
        description: translationKey(
          "Title, description, labels, custom fields and more.",
        ),
      },
      [NotificationRuleUpdateKind.Other]: {
        title: EVERYTHING_ELSE,
        description: translationKey(
          "Linked alerts, reminders and subscribers who could not be notified.",
        ),
      },
    },
  },
  [NotificationRuleEventType.Alert]: {
    sectionDescription: translationKey(
      "The rule always posts when an alert is created. Pick the updates it posts after that.",
    ),
    everyUpdateDescription: translationKey(
      "State changes, notes, owners, paging, edits and everything else.",
    ),
    keyUpdatesDescription: translationKey(
      "Resolved and reopened, and severity changes.",
    ),
    nothingChosenNote: translationKey(
      "With none ticked, the rule posts only that the alert was created, and a video call's Join button.",
    ),
    kinds: {
      [NotificationRuleUpdateKind.ResolvedAndReopened]: {
        title: RESOLVED_AND_REOPENED,
        description: translationKey(
          "When the alert is resolved, and if it is reopened.",
        ),
      },
      [NotificationRuleUpdateKind.StateChanges]: {
        title: OTHER_STATE_CHANGES,
        description: translationKey(
          "Acknowledged, and any other state the alert moves to.",
        ),
      },
      [NotificationRuleUpdateKind.SeverityChanges]: {
        title: SEVERITY_CHANGES,
        description: translationKey("When the alert's severity changes."),
      },
      [NotificationRuleUpdateKind.PrivateNotes]: {
        title: PRIVATE_NOTES,
        description: translationKey("Notes added to the alert."),
      },
      [NotificationRuleUpdateKind.Owners]: {
        title: OWNERS,
        description: OWNERS_ADDED_AND_REMOVED,
      },
      [NotificationRuleUpdateKind.Paging]: {
        title: PAGING,
        description: WHO_WAS_PAGED,
      },
      [NotificationRuleUpdateKind.AI]: {
        title: AI_ANALYSIS,
        description: translationKey("Root cause analysis and automatic fixes."),
      },
      [NotificationRuleUpdateKind.Edits]: {
        title: OTHER_EDITS,
        description: translationKey("Title, description, labels and more."),
      },
      [NotificationRuleUpdateKind.Other]: {
        title: EVERYTHING_ELSE,
        description: translationKey(
          "Reminders, and anything else posted about the alert.",
        ),
      },
    },
  },
  [NotificationRuleEventType.IncidentEpisode]: {
    sectionDescription: translationKey(
      "The rule always posts when an incident episode is created. Pick the updates it posts after that.",
    ),
    everyUpdateDescription: translationKey(
      "State changes, notes, owners, paging, incidents added or removed, and everything else.",
    ),
    keyUpdatesDescription: translationKey(
      "Resolved and reopened, and public notes.",
    ),
    nothingChosenNote: translationKey(
      "With none ticked, the rule posts only that the incident episode was created.",
    ),
    kinds: {
      [NotificationRuleUpdateKind.ResolvedAndReopened]: {
        title: RESOLVED_AND_REOPENED,
        description: EPISODE_RESOLVED,
      },
      [NotificationRuleUpdateKind.StateChanges]: {
        title: OTHER_STATE_CHANGES,
        description: EPISODE_OTHER_STATES,
      },
      [NotificationRuleUpdateKind.EpisodeMembers]: {
        title: translationKey("Incidents added and removed"),
        description: translationKey(
          "Incidents grouped into the episode, or taken out of it.",
        ),
      },
      [NotificationRuleUpdateKind.PublicNotes]: {
        title: PUBLIC_NOTES,
        description: NOTES_ON_STATUS_PAGES,
      },
      [NotificationRuleUpdateKind.PrivateNotes]: {
        title: PRIVATE_NOTES,
        description: NOTES_OFF_STATUS_PAGES,
      },
      [NotificationRuleUpdateKind.Owners]: {
        title: OWNERS,
        description: OWNERS_ADDED_AND_REMOVED,
      },
      [NotificationRuleUpdateKind.Paging]: {
        title: PAGING,
        description: WHO_WAS_PAGED,
      },
      [NotificationRuleUpdateKind.Other]: {
        title: EVERYTHING_ELSE,
        description: ANYTHING_ELSE_ABOUT_THE_EPISODE,
      },
    },
  },
  [NotificationRuleEventType.AlertEpisode]: {
    sectionDescription: translationKey(
      "The rule always posts when an alert episode is created. Pick the updates it posts after that.",
    ),
    everyUpdateDescription: translationKey(
      "State changes, notes, owners, paging, alerts added or removed, and everything else.",
    ),
    keyUpdatesDescription: translationKey("Resolved and reopened."),
    nothingChosenNote: translationKey(
      "With none ticked, the rule posts only that the alert episode was created.",
    ),
    kinds: {
      [NotificationRuleUpdateKind.ResolvedAndReopened]: {
        title: RESOLVED_AND_REOPENED,
        description: EPISODE_RESOLVED,
      },
      [NotificationRuleUpdateKind.StateChanges]: {
        title: OTHER_STATE_CHANGES,
        description: EPISODE_OTHER_STATES,
      },
      [NotificationRuleUpdateKind.EpisodeMembers]: {
        title: translationKey("Alerts added and removed"),
        description: translationKey(
          "Alerts grouped into the episode, or taken out of it.",
        ),
      },
      [NotificationRuleUpdateKind.PrivateNotes]: {
        title: PRIVATE_NOTES,
        description: translationKey("Notes added to the episode."),
      },
      [NotificationRuleUpdateKind.Owners]: {
        title: OWNERS,
        description: OWNERS_ADDED_AND_REMOVED,
      },
      [NotificationRuleUpdateKind.Paging]: {
        title: PAGING,
        description: WHO_WAS_PAGED,
      },
      [NotificationRuleUpdateKind.Other]: {
        title: EVERYTHING_ELSE,
        description: ANYTHING_ELSE_ABOUT_THE_EPISODE,
      },
    },
  },
  [NotificationRuleEventType.ScheduledMaintenance]: {
    sectionDescription: translationKey(
      "The rule always posts when a scheduled maintenance event is created. Pick the updates it posts after that.",
    ),
    everyUpdateDescription: translationKey(
      "State changes, notes and everything else.",
    ),
    keyUpdatesDescription: translationKey("State changes and public notes."),
    nothingChosenNote: translationKey(
      "With none ticked, the rule posts only that the scheduled maintenance event was created.",
    ),
    kinds: {
      [NotificationRuleUpdateKind.StateChanges]: {
        title: translationKey("State changes"),
        description: translationKey(
          "When the event starts, ends or moves to another state.",
        ),
      },
      [NotificationRuleUpdateKind.PublicNotes]: {
        title: PUBLIC_NOTES,
        description: NOTES_ON_STATUS_PAGES,
      },
      [NotificationRuleUpdateKind.PrivateNotes]: {
        title: PRIVATE_NOTES,
        description: NOTES_OFF_STATUS_PAGES,
      },
      [NotificationRuleUpdateKind.Other]: {
        title: EVERYTHING_ELSE,
        description: translationKey(
          "Reminders, and anything else posted about the event.",
        ),
      },
    },
  },
};

/*
 * The kinds of rule that choose their updates. Every other kind - monitors,
 * on-call policies, security and SLO rules - posts every update and has no
 * Updates step.
 */
export function isUpdatesEventType(
  eventType: NotificationRuleEventType,
): eventType is UpdatesEventType {
  return (
    NotificationRuleUpdates.canChooseUpdates(eventType) &&
    Object.prototype.hasOwnProperty.call(UPDATES_COPY, eventType)
  );
}

// One box's words, for a kind of rule and an update it can choose.
export function getUpdateKindCopy(
  eventType: UpdatesEventType,
  kind: NotificationRuleUpdateKind,
): UpdateKindCopy | undefined {
  return UPDATES_COPY[eventType].kinds[kind];
}

// What a rule's card says about the updates it posts.
export interface UpdatesSummary {
  // The answer it picked, translated: "Key updates only".
  title: string;
  /*
   * The updates it posts, translated and set apart as the reader's
   * language does ("Resolved and reopened · Public notes"); none for a rule
   * that posts every update, or only its first message.
   */
  detail: string | undefined;
}

/*
 * What a rule's card says about its updates: the answer it picked and,
 * when it picked some, the updates it posts. A rule with every box
 * cleared posts only its first message.
 */
export function getUpdatesSummary(data: {
  rule: StoredRuleUpdates;
  eventType: UpdatesEventType;
  translator: Translator;
}): UpdatesSummary {
  // In the reader's language, or the English when it has no words for it.
  const tx: (english: string) => string = (english: string): string => {
    return data.translator.translateText(english) || english;
  };

  const choice: NotificationRuleUpdatesChoice =
    NotificationRuleUpdates.getChoice({
      rule: data.rule,
      eventType: data.eventType,
    });

  if (choice === NotificationRuleUpdatesChoice.EveryUpdate) {
    return { title: tx(EVERY_UPDATE_TITLE), detail: undefined };
  }

  const posted: Array<NotificationRuleUpdateKind> =
    NotificationRuleUpdates.getPostedKinds({
      rule: data.rule,
      eventType: data.eventType,
    });

  if (posted.length === 0) {
    return { title: tx(ONLY_FIRST_MESSAGE_TITLE), detail: undefined };
  }

  const names: Array<string> = posted.map(
    (kind: NotificationRuleUpdateKind): string => {
      const copy: UpdateKindCopy | undefined = getUpdateKindCopy(
        data.eventType,
        kind,
      );

      return copy ? tx(copy.title) : kind;
    },
  );

  return {
    title: tx(
      choice === NotificationRuleUpdatesChoice.KeyUpdates
        ? KEY_UPDATES_TITLE
        : CHOSEN_UPDATES_TITLE,
    ),
    detail: formatInline(names, data.translator),
  };
}
