import {
  createTranslator,
  DEFAULT_LANGUAGE,
  PluralTemplate,
  translationKey,
  Translator,
} from "../../UI/Utils/TranslateTemplate";
import {
  getRemediationTrackRecordTone,
  RemediationTrackRecord,
  RemediationTrackRecordRun,
  RemediationTrackRecordTone,
} from "./RemediationTrackRecord";

/*
 * HOW A CHANGE'S TRACK RECORD READS (Types/AutoRemediation/
 * RemediationTrackRecord): one short sentence per tone, about the runs of
 * the same change on the same cluster or resource before - never a promise.
 * The Remediation step reads them in the reader's language; the Slack and
 * Microsoft Teams messages and OneUptime AI's own context read them in
 * English.
 */

/*
 * What a record says, in one short sentence, for each tone. Every one is
 * about the past runs on the same cluster or resource, never a promise.
 */
export const TRACK_RECORD_WORKED: PluralTemplate = {
  one: "Worked the one time it ran here before",
  other: "Worked all {{count}} times it ran here before",
};

/*
 * Exactly two runs are "both" and "either", as a person says it - never
 * "all 2 times". A language's plural forms cannot say it (English has only
 * "one" and "other"), so it is a sentence of its own.
 */
export const TRACK_RECORD_WORKED_BOTH: string = translationKey(
  "Worked both times it ran here before",
);

export const TRACK_RECORD_DID_NOT_WORK: PluralTemplate = {
  one: "Didn't work the one time it ran here before",
  other: "Didn't work any of the {{count}} times it ran here before",
};

export const TRACK_RECORD_DID_NOT_WORK_EITHER: string = translationKey(
  "Didn't work either time it ran here before",
);

export const TRACK_RECORD_MIXED: PluralTemplate = {
  one: "Worked {{worked}} of the {{count}} times it ran here before",
  other: "Worked {{worked}} of the {{count}} times it ran here before",
};

/*
 * The record's sentence, in the translator's language (English when none
 * is given, as the server, the chat messages and OneUptime AI read it).
 */
export function describeRemediationTrackRecord(
  record: RemediationTrackRecord,
  translator: Translator = createTranslator(undefined, DEFAULT_LANGUAGE),
): string {
  const total: number = record.workedCount + record.didNotWorkCount;

  switch (getRemediationTrackRecordTone(record)) {
    case RemediationTrackRecordTone.Worked:
      return total === 2
        ? translator.translateText(TRACK_RECORD_WORKED_BOTH) ||
            TRACK_RECORD_WORKED_BOTH
        : translator.translatePlural(TRACK_RECORD_WORKED, total);
    case RemediationTrackRecordTone.DidNotWork:
      return total === 2
        ? translator.translateText(TRACK_RECORD_DID_NOT_WORK_EITHER) ||
            TRACK_RECORD_DID_NOT_WORK_EITHER
        : translator.translatePlural(TRACK_RECORD_DID_NOT_WORK, total);
    default:
      return translator.translatePlural(TRACK_RECORD_MIXED, total, {
        worked: translator.formatNumber(record.workedCount),
      });
  }
}

/*
 * A record in one English line, with the incidents and alerts it names:
 * "Worked both times it ran here before (INC-41, INC-57)." - for a chat
 * message.
 */
export function describeRemediationTrackRecordLine(
  record: RemediationTrackRecord,
): string {
  const named: Array<string> = record.runs
    .map((run: RemediationTrackRecordRun): string => {
      return run.subjectNumber || "";
    })
    .filter((name: string): boolean => {
      return Boolean(name);
    });

  return named.length > 0
    ? `${describeRemediationTrackRecord(record)} (${named.join(", ")}).`
    : `${describeRemediationTrackRecord(record)}.`;
}

// How a run's subject is named: its number, or what it is when it has none.
export function describeTrackRecordRunSubject(
  run: RemediationTrackRecordRun,
): string {
  if (run.subjectNumber) {
    return run.subjectNumber;
  }

  return run.subjectKind === "incident" ? "an incident" : "an alert";
}
