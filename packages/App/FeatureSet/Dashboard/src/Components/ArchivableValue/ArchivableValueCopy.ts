import { ArchivableValueDeleteEffect } from "Common/Types/ArchivableValue/ArchivableValueUsage";
import {
  ARCHIVABLE_VALUES,
  ArchivableValueType,
} from "Common/Utils/ArchivableValues";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the settings pages of the values records pick from say about
 * archiving them (Common/Utils/ArchivableValues): Incident State, Incident
 * Severity, Alert State, Alert Severity, Monitor Status, Event State,
 * Labels and Incident Roles.
 *
 * Archiving is one idea for all eight - nobody can pick the value again,
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
  // The folded Archived section: its title, and what an archived value is.
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
      "Kept on the incidents and episodes that are in them, and in their history and filters. Nobody can pick them again.",
    ),
  },
  [ArchivableValueType.IncidentSeverity]: {
    archiveMessage: translationKey(
      "Nobody can pick an archived severity for a new incident, an episode or a rule, or change an incident to it. Incidents that have it keep it, and you can still filter by it. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Incident Severities"),
    archivedDescription: translationKey(
      "Kept on the incidents and episodes that have them, and in filters. Nobody can pick them for anything new.",
    ),
  },
  [ArchivableValueType.AlertState]: {
    archiveMessage: translationKey(
      "Nobody can pick an archived state for an alert or an episode again. Alerts in it stay in it and move on as usual, and it stays in their history and in filters. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Alert States"),
    archivedDescription: translationKey(
      "Kept on the alerts and episodes that are in them, and in their history and filters. Nobody can pick them again.",
    ),
  },
  [ArchivableValueType.AlertSeverity]: {
    archiveMessage: translationKey(
      "Nobody can pick an archived severity for a new alert, an episode or a rule, or change an alert to it. Alerts that have it keep it, and you can still filter by it. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Alert Severities"),
    archivedDescription: translationKey(
      "Kept on the alerts and episodes that have them, and in filters. Nobody can pick them for anything new.",
    ),
  },
  [ArchivableValueType.MonitorStatus]: {
    archiveMessage: translationKey(
      "Nobody can pick an archived status for a monitor, a criteria or a status change again. Monitors in it stay in it until their status changes, and it stays in their history. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Monitor Statuses"),
    archivedDescription: translationKey(
      "Kept on the monitors that are in them, and in their history. Nobody can pick them again.",
    ),
  },
  [ArchivableValueType.ScheduledMaintenanceState]: {
    archiveMessage: translationKey(
      "Nobody can pick an archived state for a maintenance event again. Events in it stay in it and move on as usual, and it stays in their history and in filters. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Event States"),
    archivedDescription: translationKey(
      "Kept on the maintenance events that are in them, and in their history and filters. Nobody can pick them again.",
    ),
  },
  [ArchivableValueType.Label]: {
    archiveMessage: translationKey(
      "Nobody can add an archived label to anything again. Everything that has it keeps it, and you can still filter by it. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Labels"),
    archivedDescription: translationKey(
      "Kept on everything that has them, and in filters. Nobody can add them to anything again.",
    ),
  },
  [ArchivableValueType.IncidentRole]: {
    archiveMessage: translationKey(
      "Nobody can be given an archived role again. People who hold it on an incident keep it. You can unarchive it at any time.",
    ),
    archivedTitle: translationKey("Archived Incident Roles"),
    archivedDescription: translationKey(
      "Kept by the people who hold them on incidents. Nobody can be given them again.",
    ),
  },
};

/*
 * Why a value can never be archived, as the server says it
 * (ARCHIVABLE_VALUES' protections and keepsOneLiveReason) - the same English,
 * declared here so the extractor finds it and each locale words it.
 * ArchivableValueCopy.test pins them to the server's.
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
    "Every new incident needs a severity, so keep at least one that is not archived.",
  ),
  translationKey(
    "Every new alert needs a severity, so keep at least one that is not archived.",
  ),
];

// The row actions.
export const ARCHIVE_ACTION: string = translationKey("Archive");
export const UNARCHIVE_ACTION: string = translationKey("Unarchive");

// The Archive dialog.
export const ARCHIVE_DIALOG_TITLE: string = translationKey("Archive {{name}}?");
export const STILL_SET_UP_TO_USE_IT: string = translationKey(
  "These are set up to use it, and keep using it until you change them:",
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
  "It stays archived meanwhile: nobody can pick it, and everything that has it keeps it.",
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
      "Left pointing at nothing",
    ),
  };

// One kind of record and how many, in a list: "Incidents (12)".
export const USAGE_ITEM: string = translationKey("{{title}} ({{count}})");
// A count the server stopped at: "10,000+".
export const CAPPED_COUNT: string = translationKey("{{count}}+");

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

    for (const text of [
      ARCHIVE_ACTION,
      UNARCHIVE_ACTION,
      ARCHIVE_DIALOG_TITLE,
      STILL_SET_UP_TO_USE_IT,
      ARCHIVE_INSTEAD,
      DELETE_REFUSED_NAMED,
      DELETE_REFUSED_INTRO,
      DELETE_REFUSED_ARCHIVE_INSTEAD,
      DELETE_REFUSED_ALREADY_ARCHIVED,
      DELETE_CHANGES_INTRO,
      DELETE_CHANGES_ARCHIVE_INSTEAD,
      DELETE_CHANGES_CANNOT_UNDO,
      ARCHIVED_COUNT,
    ]) {
      strings.add(text);
    }

    return Array.from(strings);
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
