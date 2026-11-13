import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import NotificationRuleUpdates, {
  NotificationRuleUpdateKind,
  NotificationRuleUpdatesChoice,
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
 *   The message that an incident was declared, and a video call's Join
 *   button, are always posted. Pick which updates follow them.
 *
 *   (o) Every update
 *       Every state change, note, owner, page and edit.
 *   ( ) Key updates only
 *       Resolved and reopened, severity changes, public notes and the
 *       postmortem.
 *   ( ) Choose updates
 *       Pick the updates to post.
 *         [x] Resolved and reopened   [ ] Private notes ...
 *
 * Only the kinds of rule that choose their updates have them
 * (NotificationRuleUpdates.canChooseUpdates): incidents, alerts, their
 * episodes and scheduled maintenance. Every sentence is whole in the locale
 * files, one per kind of record, so it reads right in every language.
 *
 * React-free, so App's tests can read it.
 */

export type UpdatesEventType =
  | NotificationRuleEventType.Incident
  | NotificationRuleEventType.Alert
  | NotificationRuleEventType.IncidentEpisode
  | NotificationRuleEventType.AlertEpisode
  | NotificationRuleEventType.ScheduledMaintenance;

type ByUpdatesEventType = Readonly<Record<UpdatesEventType, string>>;

/*
 * The rule wizard's step is "Updates" in its progress bar, as the rule's
 * card names its row (the form and the list translate their own titles).
 * The step opens with its question.
 */
export const UPDATES_SECTION_TITLE: string = translationKey(
  "Which updates to post",
);

// Under the question: what every rule posts, whatever it picks.
export const UPDATES_SECTION_DESCRIPTIONS: ByUpdatesEventType = {
  [NotificationRuleEventType.Incident]: translationKey(
    "The message that an incident was declared, and a video call's Join button, are always posted. Pick which updates follow them.",
  ),
  [NotificationRuleEventType.Alert]: translationKey(
    "The message that an alert was created, and a video call's Join button, are always posted. Pick which updates follow them.",
  ),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "The message that an incident episode was created is always posted. Pick which updates follow it.",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "The message that an alert episode was created is always posted. Pick which updates follow it.",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "The message that a scheduled maintenance event was created is always posted. Pick which updates follow it.",
  ),
};

// The three answers.
export const EVERY_UPDATE_TITLE: string = translationKey("Every update");

export const EVERY_UPDATE_DESCRIPTIONS: ByUpdatesEventType = {
  [NotificationRuleEventType.Incident]: translationKey(
    "Every state change, note, owner, page and edit.",
  ),
  [NotificationRuleEventType.Alert]: translationKey(
    "Every state change, note, owner, page and edit.",
  ),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "Every state change, note, owner and page, and each incident added or removed.",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "Every state change, note, owner and page, and each alert added or removed.",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "Every state change and note.",
  ),
};

export const KEY_UPDATES_TITLE: string = translationKey("Key updates only");

/*
 * What Key updates only posts, as NotificationRuleUpdates.getKeyKinds lists
 * it (NotificationRuleUpdatesCopy.test holds the two together).
 */
export const KEY_UPDATES_DESCRIPTIONS: ByUpdatesEventType = {
  [NotificationRuleEventType.Incident]: translationKey(
    "Resolved and reopened, severity changes, public notes and the postmortem.",
  ),
  [NotificationRuleEventType.Alert]: translationKey(
    "Resolved and reopened, and severity changes.",
  ),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "Resolved and reopened, and public notes.",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "Resolved and reopened.",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "State changes and public notes.",
  ),
};

export const CHOOSE_UPDATES_TITLE: string = translationKey("Choose updates");

export const CHOOSE_UPDATES_DESCRIPTION: string = translationKey(
  "Pick the updates to post.",
);

// With every box cleared: what the rule still posts.
export const NOTHING_CHOSEN_NOTES: ByUpdatesEventType = {
  [NotificationRuleEventType.Incident]: translationKey(
    "With none picked, the rule posts only that the incident was declared, and a video call's Join button.",
  ),
  [NotificationRuleEventType.Alert]: translationKey(
    "With none picked, the rule posts only that the alert was created, and a video call's Join button.",
  ),
  [NotificationRuleEventType.IncidentEpisode]: translationKey(
    "With none picked, the rule posts only that the incident episode was created.",
  ),
  [NotificationRuleEventType.AlertEpisode]: translationKey(
    "With none picked, the rule posts only that the alert episode was created.",
  ),
  [NotificationRuleEventType.ScheduledMaintenance]: translationKey(
    "With none picked, the rule posts only that the scheduled maintenance event was created.",
  ),
};

// One box of Choose updates: its name, and what it covers.
export interface UpdateKindCopy {
  title: string;
  description: string;
}

const NOTES_SHOWN_ON_STATUS_PAGES: string = translationKey(
  "Notes shown on status pages.",
);
const NOTES_FOR_YOUR_TEAM: string = translationKey("Notes for your team only.");
const PAGING_DESCRIPTION: string = translationKey(
  "Who an on-call policy paged, and who acknowledged.",
);
const OWNERS_DESCRIPTION: string = translationKey("Owners added and removed.");

/*
 * Each kind of rule's boxes, by the update they stand for. Every update a
 * kind of rule can choose has its words here
 * (NotificationRuleUpdatesCopy.test).
 */
export const UPDATE_KIND_COPY: Readonly<
  Record<
    UpdatesEventType,
    Readonly<Partial<Record<NotificationRuleUpdateKind, UpdateKindCopy>>>
  >
> = {
  [NotificationRuleEventType.Incident]: {
    [NotificationRuleUpdateKind.ResolvedAndReopened]: {
      title: translationKey("Resolved and reopened"),
      description: translationKey(
        "When the incident is resolved, and if it is reopened.",
      ),
    },
    [NotificationRuleUpdateKind.StateChanges]: {
      title: translationKey("Other state changes"),
      description: translationKey(
        "Acknowledged and the incident's other states.",
      ),
    },
    [NotificationRuleUpdateKind.SeverityChanges]: {
      title: translationKey("Severity changes"),
      description: translationKey("When the incident's severity changes."),
    },
    [NotificationRuleUpdateKind.PublicNotes]: {
      title: translationKey("Public notes"),
      description: NOTES_SHOWN_ON_STATUS_PAGES,
    },
    [NotificationRuleUpdateKind.PrivateNotes]: {
      title: translationKey("Private notes"),
      description: NOTES_FOR_YOUR_TEAM,
    },
    [NotificationRuleUpdateKind.Owners]: {
      title: translationKey("Owners and roles"),
      description: translationKey(
        "Owners added and removed, and people given a role, such as Incident Commander.",
      ),
    },
    [NotificationRuleUpdateKind.Paging]: {
      title: translationKey("Paging"),
      description: PAGING_DESCRIPTION,
    },
    [NotificationRuleUpdateKind.Postmortem]: {
      title: translationKey("Postmortem"),
      description: translationKey("The postmortem's note and its status."),
    },
    [NotificationRuleUpdateKind.AI]: {
      title: translationKey("AI analysis and fixes"),
      description: translationKey(
        "Root cause analysis, call summaries and automatic fixes.",
      ),
    },
    [NotificationRuleUpdateKind.Edits]: {
      title: translationKey("Other edits"),
      description: translationKey(
        "Title, description, labels, monitors and other fields.",
      ),
    },
    [NotificationRuleUpdateKind.Other]: {
      title: translationKey("Everything else"),
      description: translationKey(
        "Linked alerts, reminders and subscribers who could not be notified.",
      ),
    },
  },
  [NotificationRuleEventType.Alert]: {
    [NotificationRuleUpdateKind.ResolvedAndReopened]: {
      title: translationKey("Resolved and reopened"),
      description: translationKey(
        "When the alert is resolved, and if it is reopened.",
      ),
    },
    [NotificationRuleUpdateKind.StateChanges]: {
      title: translationKey("Other state changes"),
      description: translationKey("Acknowledged and the alert's other states."),
    },
    [NotificationRuleUpdateKind.SeverityChanges]: {
      title: translationKey("Severity changes"),
      description: translationKey("When the alert's severity changes."),
    },
    [NotificationRuleUpdateKind.PrivateNotes]: {
      title: translationKey("Private notes"),
      description: NOTES_FOR_YOUR_TEAM,
    },
    [NotificationRuleUpdateKind.Owners]: {
      title: translationKey("Owners"),
      description: OWNERS_DESCRIPTION,
    },
    [NotificationRuleUpdateKind.Paging]: {
      title: translationKey("Paging"),
      description: PAGING_DESCRIPTION,
    },
    [NotificationRuleUpdateKind.AI]: {
      title: translationKey("AI analysis and fixes"),
      description: translationKey("Root cause analysis and automatic fixes."),
    },
    [NotificationRuleUpdateKind.Edits]: {
      title: translationKey("Other edits"),
      description: translationKey(
        "Title, description, labels and other fields.",
      ),
    },
    [NotificationRuleUpdateKind.Other]: {
      title: translationKey("Everything else"),
      description: translationKey("Reminders that the alert is still open."),
    },
  },
  [NotificationRuleEventType.IncidentEpisode]: {
    [NotificationRuleUpdateKind.ResolvedAndReopened]: {
      title: translationKey("Resolved and reopened"),
      description: translationKey(
        "When the episode is resolved, and if it is reopened.",
      ),
    },
    [NotificationRuleUpdateKind.StateChanges]: {
      title: translationKey("Other state changes"),
      description: translationKey(
        "Acknowledged and the episode's other states.",
      ),
    },
    [NotificationRuleUpdateKind.EpisodeMembers]: {
      title: translationKey("Incidents added and removed"),
      description: translationKey(
        "Incidents grouped into the episode, or taken out of it.",
      ),
    },
    [NotificationRuleUpdateKind.PublicNotes]: {
      title: translationKey("Public notes"),
      description: NOTES_SHOWN_ON_STATUS_PAGES,
    },
    [NotificationRuleUpdateKind.PrivateNotes]: {
      title: translationKey("Private notes"),
      description: NOTES_FOR_YOUR_TEAM,
    },
    [NotificationRuleUpdateKind.Owners]: {
      title: translationKey("Owners"),
      description: OWNERS_DESCRIPTION,
    },
    [NotificationRuleUpdateKind.Paging]: {
      title: translationKey("Paging"),
      description: PAGING_DESCRIPTION,
    },
    [NotificationRuleUpdateKind.Other]: {
      title: translationKey("Everything else"),
      description: translationKey(
        "Anything else posted about the episode.",
      ),
    },
  },
  [NotificationRuleEventType.AlertEpisode]: {
    [NotificationRuleUpdateKind.ResolvedAndReopened]: {
      title: translationKey("Resolved and reopened"),
      description: translationKey(
        "When the episode is resolved, and if it is reopened.",
      ),
    },
    [NotificationRuleUpdateKind.StateChanges]: {
      title: translationKey("Other state changes"),
      description: translationKey(
        "Acknowledged and the episode's other states.",
      ),
    },
    [NotificationRuleUpdateKind.EpisodeMembers]: {
      title: translationKey("Alerts added and removed"),
      description: translationKey(
        "Alerts grouped into the episode, or taken out of it.",
      ),
    },
    [NotificationRuleUpdateKind.PrivateNotes]: {
      title: translationKey("Private notes"),
      description: NOTES_FOR_YOUR_TEAM,
    },
    [NotificationRuleUpdateKind.Owners]: {
      title: translationKey("Owners"),
      description: OWNERS_DESCRIPTION,
    },
    [NotificationRuleUpdateKind.Paging]: {
      title: translationKey("Paging"),
      description: PAGING_DESCRIPTION,
    },
    [NotificationRuleUpdateKind.Other]: {
      title: translationKey("Everything else"),
      description: translationKey(
        "Anything else posted about the episode.",
      ),
    },
  },
  [NotificationRuleEventType.ScheduledMaintenance]: {
    [NotificationRuleUpdateKind.StateChanges]: {
      title: translationKey("State changes"),
      description: translationKey(
        "When the event starts, ends or moves to another state.",
      ),
    },
    [NotificationRuleUpdateKind.PublicNotes]: {
      title: translationKey("Public notes"),
      description: NOTES_SHOWN_ON_STATUS_PAGES,
    },
    [NotificationRuleUpdateKind.PrivateNotes]: {
      title: translationKey("Private notes"),
      description: NOTES_FOR_YOUR_TEAM,
    },
    [NotificationRuleUpdateKind.Other]: {
      title: translationKey("Everything else"),
      description: translationKey(
        "Reminders, and anything else posted about the event.",
      ),
    },
  },
};

// The rule card's Updates row, beside the answer the rule picked.
export const ONLY_FIRST_MESSAGE_TITLE: string = translationKey(
  "Only the first message",
);

export const CHOSEN_UPDATES_TITLE: string = translationKey("Chosen updates");

/*
 * The kinds of rule that choose their updates. Every other kind - monitors,
 * on-call policies, security and SLO rules - posts every update and has no
 * Updates step.
 */
export function isUpdatesEventType(
  eventType: NotificationRuleEventType,
): eventType is UpdatesEventType {
  return NotificationRuleUpdates.canChooseUpdates(eventType);
}

// One box's words, for a kind of rule and an update it can choose.
export function getUpdateKindCopy(
  eventType: UpdatesEventType,
  kind: NotificationRuleUpdateKind,
): UpdateKindCopy | undefined {
  return UPDATE_KIND_COPY[eventType][kind];
}

/*
 * What a rule's card says about its updates: the answer it picked and,
 * when it picked some, the updates it posts, set off from each other as
 * the reader's language does ("Resolved and reopened · Public notes ·
 * Paging"). A rule with every box cleared posts only its first message.
 */
export function getUpdatesSummary(data: {
  rule: Parameters<typeof NotificationRuleUpdates.getChoice>[0]["rule"];
  eventType: UpdatesEventType;
  translator: Translator;
}): { title: string; detail: string | undefined } {
  // In the reader's language, or the English when it has no words for it.
  const tx: (english: string) => string = (english: string): string => {
    return data.translator.translateText(english) || english;
  };

  const choice: NotificationRuleUpdatesChoice = NotificationRuleUpdates.getChoice(
    {
      rule: data.rule,
      eventType: data.eventType,
    },
  );

  if (choice === NotificationRuleUpdatesChoice.EveryUpdate) {
    return {
      title: tx(EVERY_UPDATE_TITLE),
      detail: undefined,
    };
  }

  const posted: Array<NotificationRuleUpdateKind> =
    NotificationRuleUpdates.getPostedKinds({
      rule: data.rule,
      eventType: data.eventType,
    });

  if (posted.length === 0) {
    return {
      title: tx(ONLY_FIRST_MESSAGE_TITLE),
      detail: undefined,
    };
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
