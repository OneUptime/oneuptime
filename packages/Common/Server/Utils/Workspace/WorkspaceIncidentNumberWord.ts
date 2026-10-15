import NumberPrefixUtil from "../../../Utils/Project/NumberPrefix";

/*
 * AN INCIDENT NAMED BY ITS NUMBER, AFTER `incident` IN A CHAT.
 *
 * `/oneuptime incident 42` in Slack - `incident 42` typed to the Microsoft
 * Teams bot - shows incident 42 with its buttons, instead of opening the
 * incident form with "42" as its title (WorkspaceIncidentActions). The
 * number may be written as OneUptime shows it: "#42", or with the project's
 * prefix, "INC-42" (in any case). Anything else - "Checkout is down",
 * "500 errors" - is a title, as it always was.
 *
 * Kept apart from WorkspaceIncidentActions, which reads incidents, so a
 * command's text is read with nothing but this.
 */

// An incident named by its number: "42", "#42", "INC-42".
export interface WorkspaceIncidentNumberWord {
  // As typed.
  word: string;
  number: number;
  // "42" or "#42": any incident of that number. "INC-42" names its prefix too.
  isPlainNumber: boolean;
}

// A word naming an incident is at most this long.
const MAX_NUMBER_WORD_LENGTH: number = 40;

// Its number holds at most this many digits: a safe integer.
const MAX_NUMBER_DIGITS: number = 9;

const WHITESPACE: RegExp = /\s/;

export default class WorkspaceIncidentNumberWordReader {
  /*
   * A word naming an incident by its number: one word, its last characters
   * the number, before them nothing, "#", or what a number prefix may be
   * (NumberPrefixUtil: letters, digits and - _ . / : #, never ending in a
   * digit). Null for anything else. Read a character at a time.
   */
  public static read(
    text: string | null | undefined,
  ): WorkspaceIncidentNumberWord | null {
    const word: string = (text || "").trim();

    if (!word || word.length > MAX_NUMBER_WORD_LENGTH) {
      return null;
    }

    for (const character of word) {
      if (WHITESPACE.test(character)) {
        return null;
      }
    }

    let start: number = word.length;

    while (start > 0 && word[start - 1]! >= "0" && word[start - 1]! <= "9") {
      start--;
    }

    const digits: string = word.substring(start);

    if (!digits || digits.length > MAX_NUMBER_DIGITS) {
      return null;
    }

    const prefix: string = word.substring(0, start);

    if (
      prefix &&
      prefix !== NumberPrefixUtil.DEFAULT_PREFIX &&
      NumberPrefixUtil.getProblem(prefix) !== null
    ) {
      return null;
    }

    return {
      word: word,
      number: Number(digits),
      isPlainNumber: !prefix || prefix === NumberPrefixUtil.DEFAULT_PREFIX,
    };
  }
}
