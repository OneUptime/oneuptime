import BadDataException from "../../Types/Exception/BadDataException";

/*
 * Number prefixes: the short text a project puts in front of its incident,
 * alert, episode and scheduled maintenance numbers, so incident 42 shows as
 * INC-42 instead of #42.
 *
 * The rules live here so that the three things that deal in prefixes cannot
 * disagree: the server, which stores a prefix (ProjectService) and builds
 * each new number from it (the incident, alert, episode and scheduled
 * maintenance services); and the dashboard's Number Prefix pages, which
 * preview the number a prefix makes and say what is wrong with one before
 * it is saved.
 */

// The Project columns that hold a number prefix.
export type NumberPrefixColumn =
  | "incidentNumberPrefix"
  | "incidentEpisodeNumberPrefix"
  | "alertNumberPrefix"
  | "alertEpisodeNumberPrefix"
  | "scheduledMaintenanceNumberPrefix";

export interface NumberPrefixColumnInfo {
  column: NumberPrefixColumn;
  // The column's title, which names it in an error message.
  title: string;
  // What a new project starts with (ProjectService.onBeforeCreate).
  defaultForNewProjects: string;
}

export const NUMBER_PREFIX_COLUMNS: ReadonlyArray<NumberPrefixColumnInfo> = [
  {
    column: "incidentNumberPrefix",
    title: "Incident Number Prefix",
    defaultForNewProjects: "INC-",
  },
  {
    column: "incidentEpisodeNumberPrefix",
    title: "Incident Episode Number Prefix",
    defaultForNewProjects: "IE-",
  },
  {
    column: "alertNumberPrefix",
    title: "Alert Number Prefix",
    defaultForNewProjects: "ALT-",
  },
  {
    column: "alertEpisodeNumberPrefix",
    title: "Alert Episode Number Prefix",
    defaultForNewProjects: "AE-",
  },
  {
    column: "scheduledMaintenanceNumberPrefix",
    title: "Scheduled Maintenance Number Prefix",
    defaultForNewProjects: "SM-",
  },
];

export enum NumberPrefixProblem {
  TooLong = "TooLong",
  NotAllowedCharacter = "NotAllowedCharacter",
  EndsWithDigit = "EndsWithDigit",
}

/*
 * Letters and digits of any script (\p{M} keeps the vowel signs of scripts
 * such as Devanagari), plus the separators people put in a prefix. No
 * spaces, and nothing that means something in Markdown, Slack or HTML, where
 * numbers are written too.
 */
const ALLOWED_PREFIX: RegExp = /^[\p{L}\p{M}\p{Nd}_.:#/-]+$/u;

const ENDS_WITH_DIGIT: RegExp = /\p{Nd}$/u;

/*
 * What each problem says, in English. Each message is also the key the
 * dashboard's locale files translate it by, so change it there too.
 */
const PROBLEM_MESSAGES: Record<NumberPrefixProblem, string> = {
  [NumberPrefixProblem.TooLong]: "Use 20 characters or fewer.",
  [NumberPrefixProblem.NotAllowedCharacter]:
    "Use only letters, numbers and - _ . / : # (no spaces).",
  [NumberPrefixProblem.EndsWithDigit]:
    "End with a letter or a symbol such as -. A digit at the end runs into the number: SEV1 would make SEV142.",
};

export default class NumberPrefixUtil {
  public static readonly MAX_LENGTH: number = 20;

  // What a number starts with when its prefix is not set.
  public static readonly DEFAULT_PREFIX: string = "#";

  // The number the dashboard builds its examples with.
  public static readonly EXAMPLE_NUMBER: number = 42;

  public static readonly ALLOWED_CHARACTERS: string =
    "letters, numbers and - _ . / : #";

  /*
   * The number a prefix makes, exactly as the server builds it when an
   * incident, alert, episode or event is created: the prefix as stored, then
   * the number; "#" when the project has no prefix.
   */
  public static formatNumber(
    prefix: string | null | undefined,
    number: number,
  ): string {
    return prefix
      ? `${prefix}${number}`
      : `${NumberPrefixUtil.DEFAULT_PREFIX}${number}`;
  }

  // The example a prefix makes: INC- gives INC-42, no prefix gives #42.
  public static getExample(prefix: string | null | undefined): string {
    return NumberPrefixUtil.formatNumber(
      prefix,
      NumberPrefixUtil.EXAMPLE_NUMBER,
    );
  }

  /*
   * What is wrong with a prefix, or null when nothing is. Surrounding
   * whitespace does not count (it is trimmed off before the prefix is
   * stored) and an empty prefix is fine: it means "#".
   */
  public static getProblem(value: unknown): NumberPrefixProblem | null {
    if (value === null || value === undefined) {
      return null;
    }

    const prefix: string = String(value).trim();

    if (!prefix) {
      return null;
    }

    if (prefix.length > NumberPrefixUtil.MAX_LENGTH) {
      return NumberPrefixProblem.TooLong;
    }

    if (!ALLOWED_PREFIX.test(prefix)) {
      return NumberPrefixProblem.NotAllowedCharacter;
    }

    if (ENDS_WITH_DIGIT.test(prefix)) {
      return NumberPrefixProblem.EndsWithDigit;
    }

    return null;
  }

  // The message for a problem, in English.
  public static getProblemMessage(problem: NumberPrefixProblem): string {
    return PROBLEM_MESSAGES[problem];
  }

  // The message for what is wrong with a prefix, or null when nothing is.
  public static getError(value: unknown): string | null {
    const problem: NumberPrefixProblem | null =
      NumberPrefixUtil.getProblem(value);

    return problem ? NumberPrefixUtil.getProblemMessage(problem) : null;
  }

  /*
   * The prefix to store: trimmed, and null when nothing is left, which shows
   * numbers with "#". Throws when the prefix breaks a rule, naming the
   * column by its title.
   */
  public static normalize(value: unknown, title: string): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value !== "string") {
      throw new BadDataException(`${title} must be text.`);
    }

    const error: string | null = NumberPrefixUtil.getError(value);

    if (error) {
      throw new BadDataException(`${title}: ${error}`);
    }

    return value.trim() || null;
  }
}
