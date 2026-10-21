import { JSONObject } from "Common/Types/JSON";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import NextNumberUtil, {
  NextNumberProblem,
  NumberedRecordKind,
  NumbersStartAtColumn,
  RecordNumbering,
} from "Common/Utils/Project/NextNumber";

/*
 * What each product's Numbering page says about next numbers: the number a
 * new incident, alert, episode or scheduled maintenance event gets
 * (Common/Utils/Project/NextNumber). One Next Number card per page, under
 * the Number Prefix card, one row per kind of number, edited together in
 * one dialog. The copy lives here, beside the kinds it describes, so the
 * three pages say the same thing the same way. Every sentence is a key of
 * the dashboard's locale files (translationKey).
 */

export const NEXT_NUMBER_CARD_TITLE: string = translationKey("Next Number");

export const NEXT_NUMBER_EDIT_BUTTON_TITLE: string = translationKey("Update");

export const NEXT_NUMBER_EDIT_MODAL_TITLE: string =
  translationKey("Edit Next Number");

/*
 * Beside a row's next number: the highest number given out so far, as a
 * label and its value (never a sentence glued together, so it reads the
 * same in every language), or that none has been.
 */
export const HIGHEST_SO_FAR_LABEL: string = translationKey("Highest so far:");

export const NONE_USED_YET: string = translationKey("None used yet");

/*
 * Under a field of the dialog: what the number may be. The first is a
 * template: the highest number goes where it says.
 */
export const HIGHER_THAN_HIGHEST_TEMPLATE: string = translationKey(
  "Must be higher than {{highestNumber}}, the highest used so far.",
);

export const ANY_NUMBER_FROM_ONE: string = translationKey(
  "None used yet: any number from 1 will do.",
);

/*
 * At the top of the dialog when the server refused a save because records
 * took the numbers while it was open: the field's title, then what the
 * highest number is now and what to do. Said in the dialog's own words, in
 * the reader's language - the server's own answer names the API column
 * ("Incident Numbers Start At"), which the dialog never shows. A template:
 * the field's title and the highest number go where it says.
 */
export const NUMBER_TAKEN_MEANWHILE_TEMPLATE: string = translationKey(
  "{{field}}: the highest number used is now {{highestNumber}}. Use a number higher than {{highestNumber}}.",
);

/*
 * What NextNumberUtil says is wrong with a number, as a field shows it.
 * Listed here so the locale files translate them; NextNumberCard.test holds
 * the list to NextNumberUtil's own messages.
 */
export const NEXT_NUMBER_PROBLEM_MESSAGES: ReadonlyArray<string> = [
  translationKey("Use a whole number, like 1000."),
  translationKey("Use a number of 1 or more."),
  translationKey("Use a number no higher than 1,000,000,000."),
  translationKey("Use a number higher than {{highestNumber}}."),
];

export interface NextNumberRow {
  kind: NumberedRecordKind;
  // The row's title on the card: what the numbers are numbers of.
  label: string;
  // The dialog's field for the kind.
  formTitle: string;
}

export interface NextNumberPage {
  // The dialog's form name, for analytics: unique per page.
  name: string;
  cardDescription: string;
  // Under the dialog's title, at the moment a change is made.
  editDescription: string;
  rows: Array<NextNumberRow>;
}

export const INCIDENT_NEXT_NUMBERS: NextNumberPage = {
  name: "Incident Next Number",
  cardDescription: translationKey(
    "The number the next incident and the next episode get. Moving from another tool? Start after its last number, so a number never means two incidents.",
  ),
  editDescription: translationKey(
    "New incidents and episodes count up from the numbers you set. A number is never used twice, so each must be higher than the highest used so far. Existing ones keep their numbers.",
  ),
  rows: [
    {
      kind: NumberedRecordKind.Incident,
      label: "Incidents",
      formTitle: translationKey("Next Incident Number"),
    },
    {
      kind: NumberedRecordKind.IncidentEpisode,
      label: "Incident Episodes",
      formTitle: translationKey("Next Incident Episode Number"),
    },
  ],
};

export const ALERT_NEXT_NUMBERS: NextNumberPage = {
  name: "Alert Next Number",
  cardDescription: translationKey(
    "The number the next alert and the next episode get. Moving from another tool? Start after its last number, so a number never means two alerts.",
  ),
  editDescription: translationKey(
    "New alerts and episodes count up from the numbers you set. A number is never used twice, so each must be higher than the highest used so far. Existing ones keep their numbers.",
  ),
  rows: [
    {
      kind: NumberedRecordKind.Alert,
      label: "Alerts",
      formTitle: translationKey("Next Alert Number"),
    },
    {
      kind: NumberedRecordKind.AlertEpisode,
      label: "Alert Episodes",
      formTitle: translationKey("Next Alert Episode Number"),
    },
  ],
};

export const SCHEDULED_MAINTENANCE_NEXT_NUMBERS: NextNumberPage = {
  name: "Scheduled Maintenance Next Number",
  cardDescription: translationKey(
    "The number the next scheduled maintenance event gets. Moving from another tool? Start after its last number, so a number never means two events.",
  ),
  editDescription: translationKey(
    "New events count up from the number you set. A number is never used twice, so it must be higher than the highest used so far. Existing events keep their numbers.",
  ),
  rows: [
    {
      kind: NumberedRecordKind.ScheduledMaintenance,
      label: "Events",
      formTitle: translationKey("Next Scheduled Maintenance Number"),
    },
  ],
};

export const NEXT_NUMBER_PAGES: ReadonlyArray<NextNumberPage> = [
  INCIDENT_NEXT_NUMBERS,
  ALERT_NEXT_NUMBERS,
  SCHEDULED_MAINTENANCE_NEXT_NUMBERS,
];

// The Project column that holds where a kind's numbers start.
export function getStartsAtColumn(
  kind: NumberedRecordKind,
): NumbersStartAtColumn {
  return NextNumberUtil.getKindInfo(kind).startsAtColumn;
}

// The Project columns a page's dialog writes, and gates its button on.
export function getNextNumberColumns(
  page: NextNumberPage,
): Array<NumbersStartAtColumn> {
  return page.rows.map((row: NextNumberRow): NumbersStartAtColumn => {
    return getStartsAtColumn(row.kind);
  });
}

// Where each kind of number stands, by kind, as the card holds it.
export type NumberingByKind = Partial<
  Record<NumberedRecordKind, RecordNumbering>
>;

export function getNumberingByKind(
  entries: Array<RecordNumbering>,
): NumberingByKind {
  const byKind: NumberingByKind = {};

  for (const entry of entries) {
    byKind[entry.kind] = entry;
  }

  return byKind;
}

/*
 * The values the dialog opens with: each row's next number, as the card
 * shows it.
 */
export function getNextNumberFormValues(data: {
  page: NextNumberPage;
  numbering: NumberingByKind;
}): JSONObject {
  const values: JSONObject = {};

  for (const row of data.page.rows) {
    const entry: RecordNumbering | undefined = data.numbering[row.kind];

    if (entry) {
      values[getStartsAtColumn(row.kind)] = entry.nextNumber;
    }
  }

  return values;
}

/*
 * What a save of the dialog writes: for each row whose number differs from
 * the one it opened with, where that kind's numbers start from now on. A
 * number left as it was is not sent - it changes nothing, and records
 * created since the dialog opened may have passed it, which the server
 * would refuse.
 */
export function getNextNumberChanges(data: {
  page: NextNumberPage;
  values: JSONObject;
  numbering: NumberingByKind;
}): JSONObject {
  const changes: JSONObject = {};

  for (const row of data.page.rows) {
    const column: string = getStartsAtColumn(row.kind);
    const typed: number = NextNumberUtil.parse(data.values[column]);
    const shown: number | undefined = data.numbering[row.kind]?.nextNumber;

    if (Number.isInteger(typed) && typed !== shown) {
      changes[column] = typed;
    }
  }

  return changes;
}

export interface NumberTakenMeanwhile {
  row: NextNumberRow;
  // The highest number of the row's kind now: at or above the one sent.
  highestNumber: number;
}

/*
 * After the server refused a save: the rows whose number, as the save sent
 * it (getNextNumberChanges), records have reached since the dialog read the
 * numbers - read again after the refusal. A save is refused for this when a
 * record takes the number while the dialog is open; the dialog then says so
 * for each of these rows. None means the refusal was for something else,
 * and the server's own answer is shown.
 */
export function getNumbersTakenMeanwhile(data: {
  page: NextNumberPage;
  sent: JSONObject;
  numbering: NumberingByKind;
}): Array<NumberTakenMeanwhile> {
  const taken: Array<NumberTakenMeanwhile> = [];

  for (const row of data.page.rows) {
    const entry: RecordNumbering | undefined = data.numbering[row.kind];

    /*
     * A number the save did not send - one left as it was - is no whole
     * number here, so it is never named, however far records moved on.
     */
    if (
      entry &&
      NextNumberUtil.getProblem(
        data.sent[getStartsAtColumn(row.kind)],
        entry.highestNumber,
      ) === NextNumberProblem.NotAboveHighest
    ) {
      taken.push({ row: row, highestNumber: entry.highestNumber });
    }
  }

  return taken;
}
