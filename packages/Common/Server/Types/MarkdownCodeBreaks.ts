/*
 * WHERE A LONG CODE SPAN IN THE DOCS MAY WRAP.
 *
 * A browser finds no place to break `vapid.existingSecret.privateKeyKey` or
 * `MICROSOFT_TEAMS_APP_CLIENT_SECRET`: dots and underscores join a word to
 * the next. So on a phone such a span broke wherever the line ended,
 * mid-word ("privat" / "eKeyKey", #5090's review), and in a table it could
 * not get narrower than its whole length: the environment-variable tables of
 * the Microsoft Teams, Slack and GitHub guides, two columns of such names,
 * scrolled 26px sideways at 1280px and squeezed their Value column to a few
 * words a line (#5220's review).
 *
 * The docs renderer gives every long run of a code span a <wbr> - a place the
 * line may break, which adds no character, so copying the code copies it as
 * written - where people expect code to break:
 *
 *   - before a dot between two names: `vapid` `.existingSecret` `.privateKeyKey`,
 *     the way references break a long member chain;
 *   - after an underscore between two words: `MICROSOFT_` `TEAMS_` `APP_` ...;
 *   - after a slash before a name: `/api/` `microsoft-bot/` `messages`, and
 *     after the `//` of an address.
 *
 * A hyphen needs nothing: browsers already break after one.
 *
 * Only a run of CODE_BREAK_MIN_RUN characters or more without a space gets
 * them. A shorter one fits a phone's line and a table's column whole, and a
 * break in it would read as a mistake.
 *
 * The code comes in as marked escaped it: an entity ("&lt;", "&#39;") is one
 * character of the run and is never split.
 */

// The shortest run of a code span, without a space, that gets places to break.
export const CODE_BREAK_MIN_RUN: number = 20;

// The element that marks a place a line may break.
export const CODE_BREAK: string = "<wbr>";

// A letter or a digit, in any script.
const WORD_CHARACTER: RegExp = /^[\p{L}\p{N}]$/u;

// The longest entity marked writes ("&quot;"), with room to spare.
const LONGEST_ENTITY: number = 10;

const isWhitespace: (character: string) => boolean = (
  character: string,
): boolean => {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r" ||
    character === "\f" ||
    character === " "
  );
};

const isWord: (unit: string | undefined) => boolean = (
  unit: string | undefined,
): boolean => {
  return unit !== undefined && WORD_CHARACTER.test(unit);
};

/*
 * A run as the characters a reader sees: an entity is one, a character
 * outside the Basic Multilingual Plane is one.
 */
const unitsOf: (run: string) => Array<string> = (
  run: string,
): Array<string> => {
  const units: Array<string> = [];
  const characters: Array<string> = Array.from(run);
  let index: number = 0;

  while (index < characters.length) {
    const character: string = characters[index]!;

    if (character === "&") {
      let end: number = index + 1;

      while (
        end < characters.length &&
        end - index <= LONGEST_ENTITY &&
        characters[end] !== ";" &&
        characters[end] !== "&"
      ) {
        end++;
      }

      if (characters[end] === ";" && end > index + 1) {
        units.push(characters.slice(index, end + 1).join(""));
        index = end + 1;
        continue;
      }
    }

    units.push(character);
    index++;
  }

  return units;
};

const breakRun: (run: string) => string = (run: string): string => {
  const units: Array<string> = unitsOf(run);

  if (units.length < CODE_BREAK_MIN_RUN) {
    return run;
  }

  let result: string = "";

  for (let index: number = 0; index < units.length; index++) {
    const unit: string = units[index]!;
    const before: string | undefined = units[index - 1];
    const after: string | undefined = units[index + 1];

    if (unit === "." && isWord(before) && isWord(after)) {
      result += CODE_BREAK + unit;
      continue;
    }

    result += unit;

    if (unit === "_" && isWord(before) && isWord(after)) {
      result += CODE_BREAK;
    } else if (
      unit === "/" &&
      (isWord(before) || before === "/") &&
      isWord(after)
    ) {
      result += CODE_BREAK;
    }
  }

  return result;
};

/*
 * A code span's escaped text with a <wbr> wherever a long run of it may
 * break (see above). Linear in the text: one pass, no pattern over the run.
 */
export const addCodeBreakOpportunities: (escapedCode: string) => string = (
  escapedCode: string,
): string => {
  let result: string = "";
  let run: string = "";

  for (const character of escapedCode) {
    if (isWhitespace(character)) {
      if (run) {
        result += breakRun(run);
        run = "";
      }
      result += character;
    } else {
      run += character;
    }
  }

  if (run) {
    result += breakRun(run);
  }

  return result;
};

export default addCodeBreakOpportunities;
