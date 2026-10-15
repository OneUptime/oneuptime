import BadDataException from "../../Types/Exception/BadDataException";
import { NumberPrefixColumn } from "./NumberPrefix";

/*
 * Next numbers: the number a project's next incident, alert, episode or
 * scheduled maintenance event gets.
 *
 * Each kind of number comes from a counter on the project
 * (incidentCounter, ...) that holds the highest number given out so far, and
 * the next record gets the one after it. A project moving from another tool
 * can carry on from that tool's numbers - its next incident INC-2346 after
 * the old tool's INC-2345 - by choosing the number its next record gets.
 * That choice is stored as where the numbers start (incidentNumbersStartAt,
 * ...), and the next record gets the higher of the two: the one after the
 * counter, and that start. ProjectService takes a number in one statement
 * that does both, so two records never get the same number, whatever is
 * changed while they are created, and a start that records have passed no
 * longer changes anything.
 *
 * A start is only accepted above the highest number given out, so a number
 * is never given twice. It can be moved down again - to undo a typo - as
 * long as no record has used the numbers in between.
 *
 * The rules live here so that the two things that deal in next numbers
 * cannot disagree: the server, which stores a start and refuses one that
 * records have reached, and the dashboard's Numbering pages, which show the
 * next number and say what is wrong with one before it is saved.
 */

// The kinds of record a project numbers.
export enum NumberedRecordKind {
  Incident = "Incident",
  IncidentEpisode = "IncidentEpisode",
  Alert = "Alert",
  AlertEpisode = "AlertEpisode",
  ScheduledMaintenance = "ScheduledMaintenance",
}

// The Project columns that hold where each kind of number starts.
export type NumbersStartAtColumn =
  | "incidentNumbersStartAt"
  | "incidentEpisodeNumbersStartAt"
  | "alertNumbersStartAt"
  | "alertEpisodeNumbersStartAt"
  | "scheduledMaintenanceNumbersStartAt";

// The Project columns that hold the highest number given out so far.
export type NumberCounterColumn =
  | "incidentCounter"
  | "incidentEpisodeCounter"
  | "alertCounter"
  | "alertEpisodeCounter"
  | "scheduledMaintenanceCounter";

export interface NumberedRecordKindInfo {
  kind: NumberedRecordKind;
  // The highest number given out so far. Internal: no caller reads it.
  counterColumn: NumberCounterColumn;
  // The lowest number the next record may get, as the project chose it.
  startsAtColumn: NumbersStartAtColumn;
  // The text in front of the number (NumberPrefixUtil).
  prefixColumn: NumberPrefixColumn;
  // The start column's title, which names it in an error message.
  title: string;
  // One record of the kind, in a sentence: "incident".
  recordName: string;
}

export const NUMBERED_RECORD_KINDS: ReadonlyArray<NumberedRecordKindInfo> = [
  {
    kind: NumberedRecordKind.Incident,
    counterColumn: "incidentCounter",
    startsAtColumn: "incidentNumbersStartAt",
    prefixColumn: "incidentNumberPrefix",
    title: "Incident Numbers Start At",
    recordName: "incident",
  },
  {
    kind: NumberedRecordKind.IncidentEpisode,
    counterColumn: "incidentEpisodeCounter",
    startsAtColumn: "incidentEpisodeNumbersStartAt",
    prefixColumn: "incidentEpisodeNumberPrefix",
    title: "Incident Episode Numbers Start At",
    recordName: "incident episode",
  },
  {
    kind: NumberedRecordKind.Alert,
    counterColumn: "alertCounter",
    startsAtColumn: "alertNumbersStartAt",
    prefixColumn: "alertNumberPrefix",
    title: "Alert Numbers Start At",
    recordName: "alert",
  },
  {
    kind: NumberedRecordKind.AlertEpisode,
    counterColumn: "alertEpisodeCounter",
    startsAtColumn: "alertEpisodeNumbersStartAt",
    prefixColumn: "alertEpisodeNumberPrefix",
    title: "Alert Episode Numbers Start At",
    recordName: "alert episode",
  },
  {
    kind: NumberedRecordKind.ScheduledMaintenance,
    counterColumn: "scheduledMaintenanceCounter",
    startsAtColumn: "scheduledMaintenanceNumbersStartAt",
    prefixColumn: "scheduledMaintenanceNumberPrefix",
    title: "Scheduled Maintenance Numbers Start At",
    recordName: "scheduled maintenance event",
  },
];

/*
 * Where a kind of number stands: what the server's numbering route answers,
 * and what the dashboard's Next Number card shows. The highest number is 0
 * while no record of the kind has one.
 */
export interface RecordNumbering {
  kind: NumberedRecordKind;
  prefix: string | null;
  highestNumber: number;
  nextNumber: number;
  numbersStartAt: number | null;
}

export enum NextNumberProblem {
  NotWholeNumber = "NotWholeNumber",
  BelowOne = "BelowOne",
  TooLarge = "TooLarge",
  NotAboveHighest = "NotAboveHighest",
}

// A whole number typed as text: digits, with a minus sign or not.
const WHOLE_NUMBER_TEXT: RegExp = /^-?\d+$/;

/*
 * What each problem says, in English. Each message is also the key the
 * dashboard's locale files translate it by, so change it there too. The
 * last one is a template: the highest number goes where it says.
 */
const PROBLEM_MESSAGES: Record<NextNumberProblem, string> = {
  [NextNumberProblem.NotWholeNumber]: "Use a whole number, like 1000.",
  [NextNumberProblem.BelowOne]: "Use a number of 1 or more.",
  [NextNumberProblem.TooLarge]: "Use a number no higher than 1,000,000,000.",
  [NextNumberProblem.NotAboveHighest]:
    "Use a number higher than {{highestNumber}}.",
};

export default class NextNumberUtil {
  // The first number a project gives out.
  public static readonly MIN: number = 1;

  /*
   * The highest start a project may choose. Far above any project's
   * records, and well inside the integer columns that hold the numbers, so
   * a record numbered from it never runs out of room.
   */
  public static readonly MAX: number = 1_000_000_000;

  public static getKindInfo(kind: NumberedRecordKind): NumberedRecordKindInfo {
    const info: NumberedRecordKindInfo | undefined = NUMBERED_RECORD_KINDS.find(
      (candidate: NumberedRecordKindInfo): boolean => {
        return candidate.kind === kind;
      },
    );

    if (!info) {
      throw new BadDataException(`Unknown kind of numbered record: ${kind}`);
    }

    return info;
  }

  /*
   * A counter or a start as a row holds it - Postgres hands an integer back
   * as a number, raw SQL sometimes as text - or null for none.
   */
  public static toStoredNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    const number: number =
      typeof value === "number" || typeof value === "string"
        ? NextNumberUtil.parse(value)
        : Number.NaN;

    return Number.isSafeInteger(number) ? number : null;
  }

  /*
   * The number the next record gets: the one after the highest given out,
   * or the start the project chose when that is higher. The same rule the
   * server takes a number by.
   */
  public static getNextNumber(data: {
    highestNumber: number | null | undefined;
    numbersStartAt: number | null | undefined;
  }): number {
    const highestNumber: number = Math.max(data.highestNumber || 0, 0);

    return Math.max(highestNumber + 1, data.numbersStartAt || 0);
  }

  /*
   * A next number as typed - a number, or text that is a whole number - or
   * NaN when it is neither ("1e3", "12.5", "abc").
   */
  public static parse(value: unknown): number {
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string" && WHOLE_NUMBER_TEXT.test(value.trim())) {
      return Number(value.trim());
    }

    return Number.NaN;
  }

  /*
   * What is wrong with a next number, or null when nothing is: a whole
   * number from MIN to MAX, and - when the highest number given out is
   * known - higher than it.
   */
  public static getProblem(
    value: unknown,
    highestNumber?: number | null | undefined,
  ): NextNumberProblem | null {
    const number: number = NextNumberUtil.parse(value);

    if (!Number.isInteger(number)) {
      return NextNumberProblem.NotWholeNumber;
    }

    if (number < NextNumberUtil.MIN) {
      return NextNumberProblem.BelowOne;
    }

    if (number > NextNumberUtil.MAX) {
      return NextNumberProblem.TooLarge;
    }

    if (
      highestNumber !== null &&
      highestNumber !== undefined &&
      number <= highestNumber
    ) {
      return NextNumberProblem.NotAboveHighest;
    }

    return null;
  }

  /*
   * The message for a problem, in English. NotAboveHighest's is a template
   * with {{highestNumber}} in it (getProblemValues fills it).
   */
  public static getProblemMessage(problem: NextNumberProblem): string {
    return PROBLEM_MESSAGES[problem];
  }

  // The values a problem's message is filled with.
  public static getProblemValues(highestNumber?: number | null | undefined): {
    highestNumber: string;
  } {
    return { highestNumber: String(highestNumber || 0) };
  }

  /*
   * The start to store for a value sent to the API: a whole number from
   * MIN to MAX, or null - nothing chosen, the numbers carry on from the
   * highest given out - for null or blank text. Throws when the value is
   * anything else, naming the column by its title. Whether it is above the
   * highest number given out is checked against the project's counter
   * (ProjectService), which this does not read.
   */
  public static normalize(value: unknown, title: string): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === "string" && value.trim().length === 0) {
      return null;
    }

    if (typeof value !== "number" && typeof value !== "string") {
      throw new BadDataException(`${title} must be a whole number.`);
    }

    const problem: NextNumberProblem | null = NextNumberUtil.getProblem(value);

    if (problem === NextNumberProblem.NotWholeNumber) {
      throw new BadDataException(`${title} must be a whole number, like 1000.`);
    }

    if (problem === NextNumberProblem.BelowOne) {
      throw new BadDataException(`${title} must be 1 or more.`);
    }

    if (problem === NextNumberProblem.TooLarge) {
      throw new BadDataException(
        `${title} must be no higher than 1,000,000,000.`,
      );
    }

    return NextNumberUtil.parse(value);
  }

  /*
   * The numbering route's answer (GET /project/:id/numbering), read back:
   * one entry per kind it knows, in the order the kinds are listed. An
   * entry of a kind it does not know, or with a value of the wrong shape, is
   * left out rather than shown wrong.
   */
  public static parseNumbering(value: unknown): Array<RecordNumbering> {
    const entries: Array<unknown> =
      value && typeof value === "object" && !Array.isArray(value)
        ? ((value as Record<string, unknown>)["numbering"] as Array<unknown>)
        : [];

    if (!Array.isArray(entries)) {
      return [];
    }

    const parsed: Array<RecordNumbering> = [];

    for (const info of NUMBERED_RECORD_KINDS) {
      const entry: unknown = entries.find((candidate: unknown): boolean => {
        return (
          Boolean(candidate) &&
          typeof candidate === "object" &&
          (candidate as Record<string, unknown>)["kind"] === info.kind
        );
      });

      if (!entry) {
        continue;
      }

      const row: Record<string, unknown> = entry as Record<string, unknown>;
      const highestNumber: number | null = NextNumberUtil.toStoredNumber(
        row["highestNumber"],
      );
      const nextNumber: number | null = NextNumberUtil.toStoredNumber(
        row["nextNumber"],
      );

      if (highestNumber === null || nextNumber === null) {
        continue;
      }

      parsed.push({
        kind: info.kind,
        prefix:
          typeof row["prefix"] === "string" && row["prefix"]
            ? (row["prefix"] as string)
            : null,
        highestNumber: highestNumber,
        nextNumber: nextNumber,
        numbersStartAt: NextNumberUtil.toStoredNumber(row["numbersStartAt"]),
      });
    }

    return parsed;
  }

  /*
   * Why a start is refused once records of the kind have reached it: the
   * API's answer, which names the column and the highest number given out.
   */
  public static getNotAboveHighestError(data: {
    kind: NumberedRecordKind;
    highestNumber: number;
  }): string {
    const info: NumberedRecordKindInfo = NextNumberUtil.getKindInfo(data.kind);

    return `${info.title} must be higher than ${data.highestNumber}, the highest ${info.recordName} number used so far. A number is never used twice.`;
  }
}
