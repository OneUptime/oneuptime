import { ArchivableValueDeleteEffect } from "Common/Types/ArchivableValue/ArchivableValueUsage";
import {
  ARCHIVABLE_VALUES,
  ArchivableValueType,
} from "Common/Utils/ArchivableValues";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What the settings pages of the values records pick from say about
 * archiving them (Common/Utils/ArchivableValues): Incident State, Incident
 * Severity, Alert State, Alert Severity, Monitor Status, Event State,
 * Labels, Incident Roles and Postmortem Statuses.
 *
 * Archiving is one idea for all nine - nobody can pick the value again,
 * and everything that has it keeps it - but what "has it" means differs: an
 * incident is in a state, a monitor has a status, a person holds a role. So
 * each value says it in its own words, written to make sense on its own,
 * and the dialogs and the Archived section read them from here.
 *
 * Every value is an English key: the components translate them, and
 * App/Tests/Dashboard/ArchivableValueCopyI18n checks that each has an entry
 * in all seventeen Dashboard locale files.
 */

export interface ArchivableValueCopy {
  // The Archive dialog's sentence: what archiving does to this value.
  archiveMessage: string;
  /*
   * The folded Archived section: its title - the table's above it, archived
   * - and what an archived value is, said from the records' side: they keep
   * it, nobody picks it again.
   */
  archivedTitle: string;
  archivedDescription: string;
}

export const ARCHIVABLE_VALUE_COPY: Record<
  ArchivableValueType,
  ArchivableValueCopy
> = {
  [ArchivableValueType.IncidentState]: {
    archiveMessage: translationKey(
      "Nobody can pick an archived state for an incident or an episode again. Incidents in it stay in it and move on as usual, and it stays in their history and in filters. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Incident States"),
    archivedDescription: translationKey(
      "Incidents and episodes in these states stay in them, and their history still shows them. Nobody can pick them again.",
    ),
  },
  [ArchivableValueType.IncidentSeverity]: {
    archiveMessage: translationKey(
      "Nobody can pick an archived severity for a new incident, an episode or a rule, or change an incident to it. Incidents that have it keep it, and you can still filter by it. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Incident Severities"),
    archivedDescription: translationKey(
      "Incidents and episodes that have these keep them. Nobody can pick them again.",
    ),
  },
  [ArchivableValueType.AlertState]: {
    archiveMessage: translationKey(
      "Nobody can pick an archived state for an alert or an episode again. Alerts in it stay in it and move on as usual, and it stays in their history and in filters. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Alert States"),
    archivedDescription: translationKey(
      "Alerts and episodes in these states stay in them, and their history still shows them. Nobody can pick them again.",
    ),
  },
  [ArchivableValueType.AlertSeverity]: {
    archiveMessage: translationKey(
      "Nobody can pick an archived severity for a new alert, an episode or a rule, or change an alert to it. Alerts that have it keep it, and you can still filter by it. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Alert Severities"),
    archivedDescription: translationKey(
      "Alerts and episodes that have these keep them. Nobody can pick them again.",
    ),
  },
  [ArchivableValueType.MonitorStatus]: {
    archiveMessage: translationKey(
      "Nobody can pick an archived status for a monitor, its criteria or a status change again. Monitors in it stay in it until their status changes, and it stays in their history. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Monitor Statuses"),
    archivedDescription: translationKey(
      "Monitors in these statuses stay in them until their status changes. Nobody can pick them again.",
    ),
  },
  [ArchivableValueType.ScheduledMaintenanceState]: {
    archiveMessage: translationKey(
      "Nobody can pick an archived state for a maintenance event again. Events in it stay in it and move on as usual, and it stays in their history and in filters. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Scheduled Maintenance States"),
    archivedDescription: translationKey(
      "Maintenance events in these states stay in them, and their history still shows them. Nobody can pick them again.",
    ),
  },
  [ArchivableValueType.Label]: {
    archiveMessage: translationKey(
      "Nobody can add an archived label to anything again. Everything that has it keeps it, and you can still filter by it. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Labels"),
    archivedDescription: translationKey(
      "Everything that has these labels keeps them. Nobody can add them to anything again.",
    ),
  },
  [ArchivableValueType.IncidentRole]: {
    archiveMessage: translationKey(
      "Nobody can be given an archived role again. People who hold it on an incident keep it. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Incident Roles"),
    archivedDescription: translationKey(
      "People who hold these roles on incidents keep them. Nobody can be given them again.",
    ),
  },
  [ArchivableValueType.IncidentPostmortemStatus]: {
    archiveMessage: translationKey(
      "Nobody can move a postmortem to an archived status again. Postmortems in it stay in it until someone moves them, and you can still filter by it. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Postmortem Statuses"),
    archivedDescription: translationKey(
      "Postmortems in these statuses stay in them. Nobody can move a postmortem to them again.",
    ),
  },
  [ArchivableValueType.SecurityCaseStatus]: {
    archiveMessage: translationKey(
      "Nobody can move a case to an archived status again. Cases in it stay in it until someone moves them, and you can still filter by it. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Case Statuses"),
    archivedDescription: translationKey(
      "Cases in these statuses stay in them. Nobody can move a case to them again.",
    ),
  },
  [ArchivableValueType.SecurityCasePriority]: {
    archiveMessage: translationKey(
      "Nobody can give a case an archived priority again. Cases at it keep it, playbooks that use it keep running, and you can still filter by it. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Case Priorities"),
    archivedDescription: translationKey(
      "Cases at these priorities keep them. Nobody can give a case one of them again.",
    ),
  },
};

/*
 * Why a value can never be archived, as the server says it
 * (ARCHIVABLE_VALUES' protections and keepsOneLiveReason) - the same English,
 * declared here so the extractor finds it and each locale words it.
 * ArchivableValueCopyI18n.test pins them to the server's.
 */
export const ARCHIVE_LOCKED_REASONS: Array<string> = [
  translationKey("New incidents start in this state, so it can't be archived."),
  translationKey(
    "Acknowledging an incident moves it to this state, so it can't be archived.",
  ),
  translationKey(
    "Resolving an incident moves it to this state, so it can't be archived.",
  ),
  translationKey("New alerts start in this state, so it can't be archived."),
  translationKey(
    "Acknowledging an alert moves it to this state, so it can't be archived.",
  ),
  translationKey(
    "Resolving an alert moves it to this state, so it can't be archived.",
  ),
  translationKey("New monitors start in this status, so it can't be archived."),
  translationKey(
    "OneUptime treats a monitor in this status as down, so it can't be archived.",
  ),
  translationKey(
    "New maintenance events start in this state, so it can't be archived.",
  ),
  translationKey(
    "An event moves to this state when its maintenance starts, so it can't be archived.",
  ),
  translationKey(
    "An event moves to this state when its maintenance ends, so it can't be archived.",
  ),
  translationKey(
    "Completing an event moves it to this state, so it can't be archived.",
  ),
  translationKey(
    "Every incident needs someone in charge, so this role can't be archived.",
  ),
  translationKey(
    "A new incident's postmortem starts in this status, so it can't be archived.",
  ),
  translationKey(
    "Writing a postmortem moves it to this status, so it can't be archived.",
  ),
  translationKey(
    "Publishing a postmortem on a status page moves it to this status, so it can't be archived.",
  ),
  translationKey(
    "Every new incident needs a severity, so keep at least one that is not archived.",
  ),
  translationKey(
    "Every new alert needs a severity, so keep at least one that is not archived.",
  ),
  // A security case's built-in statuses and priorities.
  translationKey("New cases start in this status, so it can't be archived."),
  translationKey(
    "Reopening a case moves it to this status, so it can't be archived.",
  ),
  translationKey(
    "The time to contain is measured to this status, so it can't be archived.",
  ),
  translationKey(
    "Closing a case moves it to this status, so it can't be archived.",
  ),
  translationKey(
    "Critical detections open their cases at this priority, so it can't be archived.",
  ),
  translationKey(
    "High detections open their cases at this priority, so it can't be archived.",
  ),
  translationKey(
    "Medium detections and the cases people open start at this priority, so it can't be archived.",
  ),
  translationKey(
    "Low detections open their cases at this priority, so it can't be archived.",
  ),
  translationKey(
    "Informational detections open their cases at this priority, so it can't be archived.",
  ),
];

// The row actions.
export const ARCHIVE_ACTION: string = translationKey("Archive");
export const UNARCHIVE_ACTION: string = translationKey("Unarchive");

// The Archive dialog.
export const ARCHIVE_DIALOG_TITLE: string = translationKey("Archive {{name}}?");
export const STILL_SET_UP_TO_USE_IT: string = translationKey(
  "These keep using it until you change them:",
);
// While they are read: the dialog opens at once.
export const CHECKING_WHAT_USES_IT: string = translationKey(
  "Checking what still uses it…",
);

// The Delete dialog, for a value records use.
export const ARCHIVE_INSTEAD: string = translationKey("Archive instead");
// The value's name, in bold (NamedSentence); the other for one with none.
export const DELETE_REFUSED_NAMED: string = translationKey(
  "{{name}} can't be deleted while these have it:",
);
export const DELETE_REFUSED_INTRO: string = translationKey(
  "It can't be deleted while these have it:",
);
export const DELETE_REFUSED_ARCHIVE_INSTEAD: string = translationKey(
  "Archive it instead: nobody can pick it again, and everything that has it keeps it.",
);
export const DELETE_REFUSED_ALREADY_ARCHIVED: string = translationKey(
  "It can stay archived: nobody can pick it, and everything that has it keeps it.",
);
export const DELETE_CHANGES_INTRO: string = translationKey(
  "Deleting it also changes these:",
);
export const DELETE_CHANGES_ARCHIVE_INSTEAD: string = translationKey(
  "This can't be undone. Archive it instead to keep them as they are.",
);
export const DELETE_CHANGES_CANNOT_UNDO: string = translationKey(
  "This can't be undone.",
);

// How each way of using a value is changed by a delete, before what it lists.
export const DELETE_EFFECT_LABELS: Record<ArchivableValueDeleteEffect, string> =
  {
    [ArchivableValueDeleteEffect.Refused]: translationKey("In use by"),
    [ArchivableValueDeleteEffect.RemovedFromList]:
      translationKey("Removed from"),
    [ArchivableValueDeleteEffect.Deleted]: translationKey("Deleted with it"),
    [ArchivableValueDeleteEffect.Cleared]: translationKey("Cleared on"),
    [ArchivableValueDeleteEffect.LeftDangling]: translationKey(
      "Left set to a deleted value",
    ),
  };

/*
 * A bulk Delete's label for what goes with the values it deletes, when
 * there are several of them; one value's says "Deleted with it".
 */
export const DELETED_WITH_THEM: string = translationKey("Deleted with them");

// One kind of record and how many, in a list: "Incidents (12)".
export const USAGE_ITEM: string = translationKey("{{title}} ({{count}})");
// A count the server stopped at: "10,000+".
export const CAPPED_COUNT: string = translationKey("{{count}}+");

/*
 * PEOPLE'S OWN SETTINGS THAT NAME A VALUE (ArchivableValueUsageKind.Personal).
 *
 * Every member of a project has on-call rules of their own - one for each
 * severity, kind (incidents, episodes) and notification method, which
 * OneUptime sets up when they join - and their own notification settings.
 * The Archive dialog used to list them as "Notification Rules (22)" among
 * the project's settings that keep using a value until someone changes
 * them: nobody recognised them, and the count was of rows. They are said as
 * whose they are, counted by person, and as what really happens to them.
 *
 * Keyed by the table of the people's settings (the server's tableName).
 * ArchivableValuePersonalCopy.test holds every personal table the models
 * declare to an entry here.
 */

// One line of a list - the Delete dialog's - "On-call rules of 11 people".
export const PERSONAL_USAGE_ITEMS: Record<string, PluralTemplate> = {
  UserNotificationRule: {
    one: "On-call rules of {{count}} person",
    other: "On-call rules of {{count}} people",
  },
  UserNotificationSetting: {
    one: "Notification settings of {{count}} person",
    other: "Notification settings of {{count}} people",
  },
};

// A person's own settings with no words of their own yet.
export const PERSONAL_USAGE_ITEM_FALLBACK: PluralTemplate = {
  one: "Own settings of {{count}} person",
  other: "Own settings of {{count}} people",
};

/*
 * The Archive dialog's sentence about them, after what keeps using the
 * value: whose they are - people's own, not the project's rules the list
 * above names - that they stay as they are, and what they keep doing. Each
 * sentence names its subject ("Those rules"), never a bare "They" that
 * reads as the people. Keyed by the kind of value and the table,
 * `<ArchivableValueType>:<tableName>`.
 */
export interface PersonalUsageNote {
  sentence: PluralTemplate;
  // The link to the viewer's own, where a person sees what they are.
  linkText: string;
}

export const PERSONAL_USAGE_NOTES: Record<string, PersonalUsageNote> = {
  [`${ArchivableValueType.IncidentSeverity}:UserNotificationRule`]: {
    sentence: {
      one: "{{count}} person has their own on-call rules for this severity. Those rules stay as they are, so incidents with it still page them.",
      other:
        "{{count}} people have their own on-call rules for this severity. Those rules stay as they are, so incidents with it still page them.",
    },
    linkText: translationKey("See your on-call rules"),
  },
  [`${ArchivableValueType.AlertSeverity}:UserNotificationRule`]: {
    sentence: {
      one: "{{count}} person has their own on-call rules for this severity. Those rules stay as they are, so alerts with it still page them.",
      other:
        "{{count}} people have their own on-call rules for this severity. Those rules stay as they are, so alerts with it still page them.",
    },
    linkText: translationKey("See your on-call rules"),
  },
  [`${ArchivableValueType.SecurityCasePriority}:UserNotificationSetting`]: {
    sentence: {
      one: "{{count}} person is notified about new security cases at this priority and above. Their settings stay as they are.",
      other:
        "{{count}} people are notified about new security cases at this priority and above. Their settings stay as they are.",
    },
    linkText: translationKey("See your notification settings"),
  },
};

// The sentence for people's own settings with no words of their own yet.
export const PERSONAL_USAGE_NOTE_FALLBACK: PluralTemplate = {
  one: "{{count}} person has their own settings that use it. Those settings stay as they are.",
  other:
    "{{count}} people have their own settings that use it. Those settings stay as they are.",
};

/*
 * A bulk Delete of values (Bulk Actions > Delete on a settings page): what
 * deleting the selected ones would do, read when the dialog opens - each
 * record or person counted once, however many of them it has.
 */
export const CHECKING_WHAT_USES_THEM: string = translationKey(
  "Checking what still uses them…",
);
/*
 * {{names}}: the values records still have, "Critical and Major" - two
 * named at most, the rest counted ("Critical, Major and 3 more"), so a
 * selection of many labels never turns the sentence into the list.
 */
export const BULK_DELETE_REFUSED: PluralTemplate = {
  one: "{{names}} can't be deleted while these have it:",
  other: "{{names}} can't be deleted while these have them:",
};
// How many refused values the sentence above names before it counts.
export const BULK_DELETE_REFUSED_NAMES_SHOWN: number = 2;
// The rest of them, after the names: "Critical, Major and 3 more".
export const BULK_DELETE_REFUSED_MORE: PluralTemplate = {
  one: "{{count}} more",
  other: "{{count}} more",
};
/*
 * What the dialog's Delete does with them, when it deletes the others: it
 * leaves them out. Not said when there is nothing else to delete - the
 * Delete is then unavailable.
 */
export const BULK_DELETE_SKIPS: PluralTemplate = {
  one: "Delete skips it.",
  other: "Delete skips them.",
};
// Then the way on: what a row's own Delete says, for one or several.
export const BULK_DELETE_REFUSED_ARCHIVE_INSTEAD: PluralTemplate = {
  one: "Archive it instead: nobody can pick it again, and everything that has it keeps it.",
  other:
    "Archive them instead: nobody can pick them again, and everything that has them keeps them.",
};
export const BULK_DELETE_REFUSED_ALREADY_ARCHIVED: PluralTemplate = {
  one: "It can stay archived: nobody can pick it, and everything that has it keeps it.",
  other:
    "They can stay archived: nobody can pick them, and everything that has them keeps them.",
};
// What deleting changes: all of them, or the ones left once the refused are.
export const BULK_DELETE_CHANGES_INTRO: PluralTemplate = {
  one: "Deleting it also changes these:",
  other: "Deleting them also changes these:",
};
export const BULK_DELETE_CHANGES_INTRO_OTHERS: PluralTemplate = {
  one: "Deleting the other one also changes these:",
  other: "Deleting the others also changes these:",
};
/*
 * Why a value the dialog found in use is skipped, in the run's result - one
 * of the live list, and one already archived, which has nothing to archive.
 */
export const BULK_DELETE_REFUSAL_REASON: string = translationKey(
  "Records still have it, so it can't be deleted. Archive it instead.",
);
export const BULK_DELETE_REFUSAL_REASON_ARCHIVED: string = translationKey(
  "Records still have it, so it can't be deleted. It can stay archived.",
);

// The folded Archived section's count, beside its title.
export const ARCHIVED_COUNT: string = translationKey("{{count}} archived");

/** Every string these pages show, for the locale checks. */
export const getArchivableValueStrings: () => Array<string> =
  (): Array<string> => {
    const strings: Set<string> = new Set<string>();

    for (const copy of Object.values(ARCHIVABLE_VALUE_COPY)) {
      strings.add(copy.archiveMessage);
      strings.add(copy.archivedTitle);
      strings.add(copy.archivedDescription);
    }

    for (const reason of ARCHIVE_LOCKED_REASONS) {
      strings.add(reason);
    }

    for (const label of Object.values(DELETE_EFFECT_LABELS)) {
      strings.add(label);
    }

    strings.add(DELETED_WITH_THEM);

    for (const text of [
      ARCHIVE_ACTION,
      UNARCHIVE_ACTION,
      ARCHIVE_DIALOG_TITLE,
      STILL_SET_UP_TO_USE_IT,
      CHECKING_WHAT_USES_IT,
      ARCHIVE_INSTEAD,
      DELETE_REFUSED_NAMED,
      DELETE_REFUSED_INTRO,
      DELETE_REFUSED_ARCHIVE_INSTEAD,
      DELETE_REFUSED_ALREADY_ARCHIVED,
      DELETE_CHANGES_INTRO,
      DELETE_CHANGES_ARCHIVE_INSTEAD,
      DELETE_CHANGES_CANNOT_UNDO,
      ARCHIVED_COUNT,
      CHECKING_WHAT_USES_THEM,
      BULK_DELETE_REFUSAL_REASON,
      BULK_DELETE_REFUSAL_REASON_ARCHIVED,
    ]) {
      strings.add(text);
    }

    for (const note of Object.values(PERSONAL_USAGE_NOTES)) {
      strings.add(note.linkText);
    }

    for (const plural of getArchivableValuePluralStrings()) {
      strings.add(plural.other);
    }

    return Array.from(strings);
  };

/** Every plural sentence these pages show, for the locale checks. */
export const getArchivableValuePluralStrings: () => Array<PluralTemplate> =
  (): Array<PluralTemplate> => {
    return [
      ...Object.values(PERSONAL_USAGE_ITEMS),
      PERSONAL_USAGE_ITEM_FALLBACK,
      ...Object.values(PERSONAL_USAGE_NOTES).map(
        (note: PersonalUsageNote): PluralTemplate => {
          return note.sentence;
        },
      ),
      PERSONAL_USAGE_NOTE_FALLBACK,
      BULK_DELETE_REFUSED,
      BULK_DELETE_REFUSED_MORE,
      BULK_DELETE_SKIPS,
      BULK_DELETE_REFUSED_ARCHIVE_INSTEAD,
      BULK_DELETE_REFUSED_ALREADY_ARCHIVED,
      BULK_DELETE_CHANGES_INTRO,
      BULK_DELETE_CHANGES_INTRO_OTHERS,
    ];
  };

/*
 * The server's reasons, every one, so a test can hold ARCHIVE_LOCKED_REASONS
 * to them: a reason the server gives that the dashboard cannot translate
 * would show in English in every language.
 */
export const getServerArchiveLockedReasons: () => Array<string> =
  (): Array<string> => {
    const reasons: Set<string> = new Set<string>();

    for (const definition of Object.values(ARCHIVABLE_VALUES)) {
      for (const protection of definition.protections) {
        reasons.add(protection.reason);
      }

      if (definition.keepsOneLiveReason) {
        reasons.add(definition.keepsOneLiveReason);
      }
    }

    return Array.from(reasons);
  };
