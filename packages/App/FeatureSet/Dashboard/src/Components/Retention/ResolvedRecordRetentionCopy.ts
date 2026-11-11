import {
  KEEP_EVERY_RESOLVED_RECORD,
  RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS,
  ResolvedRecordKind,
  isResolvedRecordRetentionOn,
} from "Common/Types/Retention/ResolvedRecordRetention";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * DATA RETENTION FOR RESOLVED INCIDENTS AND ALERTS (issue #6903): how long a
 * resolved incident - or alert - stays before it is deleted with everything
 * it carries (Project.incidentRetentionInDays, Project.alertRetentionInDays;
 * Common/Types/Retention/ResolvedRecordRetention).
 *
 *   - Incidents -> Settings -> Data Retention and Alerts -> Settings -> Data
 *     Retention: one card, "Resolved Incidents" or "Resolved Alerts", with
 *     one pick, "Delete after", that saves the moment it is made - Never
 *     (where every project starts), 30, 60, 90 or 180 days, or 1, 2 or 3
 *     years.
 *   - A pick that deletes more than the project deletes now - turning it on,
 *     or shortening it - asks first, saying what goes and that it cannot be
 *     brought back. Lengthening it, or Never, saves at once: it deletes
 *     nothing.
 *   - The incidents card has one more line while a length is picked: "Keep
 *     incidents with a completed postmortem", on unless turned off.
 *
 * Kept free of React so the card, the pages and their tests read these
 * exact strings. Every string is a whole sentence or a whole name, wrapped in
 * translationKey() (or a PluralTemplate) so npm run i18n:extract finds it,
 * and translated in every Dashboard locale file. The lengths are the
 * Dashboard's own "{{count}} days", and "{{count}} years" for a whole number
 * of years.
 */

export const RESOLVED_RECORD_RETENTION_CARD_TEST_ID: string =
  "resolved-record-retention";

export const RESOLVED_RECORD_RETENTION_SETTING_TEST_ID: string =
  "resolved-record-retention-setting";

export const KEEP_COMPLETED_POSTMORTEMS_TEST_ID: string =
  "resolved-record-retention-keep-postmortems";

// The project columns a card reads and writes.
export type ResolvedRecordRetentionColumn =
  | "incidentRetentionInDays"
  | "alertRetentionInDays";

// The project column the incidents card's postmortem switch writes.
export type KeepCompletedPostmortemsColumn =
  "keepIncidentsWithCompletedPostmortem";

export const KEEP_COMPLETED_POSTMORTEMS_COLUMN: KeepCompletedPostmortemsColumn =
  "keepIncidentsWithCompletedPostmortem";

// What one card says: incidents, or alerts.
export interface ResolvedRecordRetentionKindCopy {
  kind: ResolvedRecordKind;
  column: ResolvedRecordRetentionColumn;
  cardTitle: string;
  cardDescription: string;
  // Under the pick, for a length.
  onDescription: string;
  // Under the pick, for Never.
  offDescription: string;
  // The question asked before a pick that deletes more.
  confirmTitle: string;
  confirmButton: string;
  // What goes, for a length in days or in years.
  confirmInDays: PluralTemplate;
  confirmInYears: PluralTemplate;
  /*
   * Whether the card offers to keep incidents with a completed postmortem
   * (Project.keepIncidentsWithCompletedPostmortem): incidents only.
   */
  offersPostmortemKeep: boolean;
}

// What both cards say.
export const ResolvedRecordRetentionCopy: {
  label: string;
  never: string;
  keepPostmortemsTitle: string;
  keepPostmortemsOnDescription: string;
  keepPostmortemsOffDescription: string;
  keepPostmortemsOffConfirmTitle: string;
  keepPostmortemsOffConfirmDescription: string;
  keepPostmortemsOffConfirmButton: string;
} = {
  label: translationKey("Delete after"),
  never: translationKey("Never"),
  keepPostmortemsTitle: translationKey(
    "Keep incidents with a completed postmortem",
  ),
  keepPostmortemsOnDescription: translationKey(
    "An incident whose postmortem is completed stays, however long ago it was resolved.",
  ),
  keepPostmortemsOffDescription: translationKey(
    "Incidents are deleted whether or not their postmortem is completed.",
  ),
  // Asked before the switch is turned off while a length is picked.
  keepPostmortemsOffConfirmTitle: translationKey(
    "Delete incidents with a completed postmortem too?",
  ),
  keepPostmortemsOffConfirmDescription: translationKey(
    "Resolved incidents older than the length picked are deleted within the hour, even when their postmortem is completed. They can't be brought back.",
  ),
  keepPostmortemsOffConfirmButton: translationKey("Delete them too"),
};

export const INCIDENT_RETENTION_COPY: ResolvedRecordRetentionKindCopy = {
  kind: ResolvedRecordKind.Incident,
  column: "incidentRetentionInDays",
  cardTitle: translationKey("Resolved Incidents"),
  cardDescription: translationKey(
    "Delete incidents once they have been resolved for a while, with their timeline, notes and logs. Incidents that are not resolved are never deleted.",
  ),
  onDescription: translationKey(
    "Checked every hour, counting from when each incident was resolved. Status pages stop showing deleted incidents, and they can't be brought back.",
  ),
  offDescription: translationKey(
    "Every resolved incident stays until someone deletes it.",
  ),
  confirmTitle: translationKey("Delete old resolved incidents?"),
  confirmButton: translationKey("Delete old incidents"),
  confirmInDays: {
    one: "Incidents resolved more than {{count}} day ago are deleted within the hour, with their timeline, notes and logs. Status pages stop showing them, and they can't be brought back.",
    other:
      "Incidents resolved more than {{count}} days ago are deleted within the hour, with their timeline, notes and logs. Status pages stop showing them, and they can't be brought back.",
  },
  confirmInYears: {
    one: "Incidents resolved more than {{count}} year ago are deleted within the hour, with their timeline, notes and logs. Status pages stop showing them, and they can't be brought back.",
    other:
      "Incidents resolved more than {{count}} years ago are deleted within the hour, with their timeline, notes and logs. Status pages stop showing them, and they can't be brought back.",
  },
  offersPostmortemKeep: true,
};

export const ALERT_RETENTION_COPY: ResolvedRecordRetentionKindCopy = {
  kind: ResolvedRecordKind.Alert,
  column: "alertRetentionInDays",
  cardTitle: translationKey("Resolved Alerts"),
  cardDescription: translationKey(
    "Delete alerts once they have been resolved for a while, with their timeline, notes and logs. Alerts that are not resolved are never deleted, and an alert linked to an incident stays as long as the incident.",
  ),
  onDescription: translationKey(
    "Checked every hour, counting from when each alert was resolved. Deleted alerts can't be brought back.",
  ),
  offDescription: translationKey(
    "Every resolved alert stays until someone deletes it.",
  ),
  confirmTitle: translationKey("Delete old resolved alerts?"),
  confirmButton: translationKey("Delete old alerts"),
  confirmInDays: {
    one: "Alerts resolved more than {{count}} day ago are deleted within the hour, with their timeline, notes and logs. They can't be brought back.",
    other:
      "Alerts resolved more than {{count}} days ago are deleted within the hour, with their timeline, notes and logs. They can't be brought back.",
  },
  confirmInYears: {
    one: "Alerts resolved more than {{count}} year ago are deleted within the hour, with their timeline, notes and logs. They can't be brought back.",
    other:
      "Alerts resolved more than {{count}} years ago are deleted within the hour, with their timeline, notes and logs. They can't be brought back.",
  },
  offersPostmortemKeep: false,
};

// A length in days, as the pick says it: "30 days".
export const RETENTION_DAYS: PluralTemplate = {
  one: "{{count}} day",
  other: "{{count}} days",
};

// A whole number of years, as the pick says it: "1 year", "2 years".
export const RETENTION_YEARS: PluralTemplate = {
  one: "{{count}} year",
  other: "{{count}} years",
};

const DAYS_IN_A_YEAR: number = 365;

// A length as the reader counts it: whole years in years, the rest in days.
export interface RetentionLength {
  unit: "days" | "years";
  count: number;
}

export const getRetentionLength: (
  retentionInDays: number,
) => RetentionLength = (retentionInDays: number): RetentionLength => {
  if (
    retentionInDays >= DAYS_IN_A_YEAR &&
    retentionInDays % DAYS_IN_A_YEAR === 0
  ) {
    return { unit: "years", count: retentionInDays / DAYS_IN_A_YEAR };
  }

  return { unit: "days", count: retentionInDays };
};

// The pick's values: Never first - where every project starts - then the lengths.
export const getResolvedRecordRetentionChoices: () => Array<number> =
  (): Array<number> => {
    return [
      KEEP_EVERY_RESOLVED_RECORD,
      ...RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS,
    ];
  };

// A length as it reads: "90 days", "1 year", or "Never", in the reader's language.
export const getResolvedRecordRetentionText: (
  retentionInDays: number,
  translator: Translator,
) => string = (retentionInDays: number, translator: Translator): string => {
  if (!isResolvedRecordRetentionOn(retentionInDays)) {
    return (
      translator.translateText(ResolvedRecordRetentionCopy.never) ||
      ResolvedRecordRetentionCopy.never
    );
  }

  const length: RetentionLength = getRetentionLength(retentionInDays);

  return translator.translatePlural(
    length.unit === "years" ? RETENTION_YEARS : RETENTION_DAYS,
    length.count,
  );
};

// The sentence under the pick, for what it is set to.
export const getResolvedRecordRetentionDescription: (
  copy: ResolvedRecordRetentionKindCopy,
  retentionInDays: number,
) => string = (
  copy: ResolvedRecordRetentionKindCopy,
  retentionInDays: number,
): string => {
  return isResolvedRecordRetentionOn(retentionInDays)
    ? copy.onDescription
    : copy.offDescription;
};

// What the question before a pick that deletes more says goes, in the reader's language.
export const getResolvedRecordRetentionConfirmation: (
  copy: ResolvedRecordRetentionKindCopy,
  retentionInDays: number,
  translator: Translator,
) => string = (
  copy: ResolvedRecordRetentionKindCopy,
  retentionInDays: number,
  translator: Translator,
): string => {
  const length: RetentionLength = getRetentionLength(retentionInDays);

  return translator.translatePlural(
    length.unit === "years" ? copy.confirmInYears : copy.confirmInDays,
    length.count,
  );
};

// The sentence under the postmortem switch, for where it is.
export const getKeepCompletedPostmortemsDescription: (
  isOn: boolean,
) => string = (isOn: boolean): string => {
  return isOn
    ? ResolvedRecordRetentionCopy.keepPostmortemsOnDescription
    : ResolvedRecordRetentionCopy.keepPostmortemsOffDescription;
};

export default ResolvedRecordRetentionCopy;
