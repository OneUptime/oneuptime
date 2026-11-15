/*
 * A CALL'S ARGUMENTS AND ITS RECEIVER, READ FROM SOURCE TEXT.
 *
 * For guards that refuse a call by how it is made rather than by its name
 * alone: a calendar step given no zone (DaysAsLengthsOfTimeGuard), a date
 * written by the browser with no options (DatesOnTheReadersClockGuard).
 * Brackets and strings are skipped, so `fn(a, b)` or `"a, b"` inside an
 * argument is one argument.
 */

const WHITESPACE: RegExp = /\s/;
const NAME_CHARACTER: RegExp = /[A-Za-z0-9_$.?!]/;
// `new` just before a receiver: `new Date(value)`.
const NEW_BEFORE: RegExp = /\bnew\s+$/;
const OPENING: string = "([{";
const CLOSING: string = ")]}";
const QUOTES: string = "\"'`";

export interface CallArguments {
  // How many: 0 for `()`; a trailing comma, as prettier writes one, is none.
  count: number;
  // The text between the brackets.
  text: string;
}

/*
 * The arguments of the call that opens at `openIndex` (its "("), or null
 * when the call never closes.
 */
export function readCallArguments(
  text: string,
  openIndex: number,
): CallArguments | null {
  let depth: number = 0;
  let commas: number = 0;
  let quote: string | null = null;
  let lastSignificant: string = "(";

  for (let index: number = openIndex; index < text.length; index++) {
    const character: string = text[index]!;

    if (quote) {
      if (character === "\\") {
        index++;
      } else if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (QUOTES.includes(character)) {
      quote = character;
      lastSignificant = character;
      continue;
    }

    if (OPENING.includes(character)) {
      depth++;
    } else if (CLOSING.includes(character)) {
      depth--;

      if (depth === 0) {
        const inner: string = text.slice(openIndex + 1, index);

        if (lastSignificant === "(") {
          return { count: 0, text: inner };
        }

        return {
          count: commas + 1 - (lastSignificant === "," ? 1 : 0),
          text: inner,
        };
      }
    } else if (character === "," && depth === 1) {
      commas++;
    }

    if (!WHITESPACE.test(character)) {
      lastSignificant = character;
    }
  }

  return null;
}

/*
 * What a method is called on, read back from the "." at `dotIndex`:
 * `point.date` in `point.date.toLocaleString(`, `new Date(item.since)` in
 * `new Date(item.since).toLocaleDateString(`, `(a || b)` for a bracketed
 * expression.
 */
export function readReceiver(text: string, dotIndex: number): string {
  let index: number = dotIndex - 1;

  while (index >= 0 && WHITESPACE.test(text[index]!)) {
    index--;
  }

  const end: number = index + 1;

  while (index >= 0) {
    const character: string = text[index]!;

    if (character === ")" || character === "]") {
      let depth: number = 0;

      for (; index >= 0; index--) {
        const inner: string = text[index]!;

        if (inner === ")" || inner === "]") {
          depth++;
        } else if (inner === "(" || inner === "[") {
          depth--;

          if (depth === 0) {
            index--;
            break;
          }
        }
      }

      continue;
    }

    if (NAME_CHARACTER.test(character)) {
      index--;
      continue;
    }

    break;
  }

  const start: number = index + 1;
  const receiver: string = text.slice(start, end).trim();

  return NEW_BEFORE.test(text.slice(Math.max(0, start - 8), start))
    ? `new ${receiver}`
    : receiver;
}

// The line `index` is on, counted from 1.
export function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}
