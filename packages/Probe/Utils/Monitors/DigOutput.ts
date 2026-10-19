import { isWhiteSpaceCode } from "Common/Utils/RegExpCharacterClasses";

/*
 * ---------------------------------------------------------------------------
 * WHAT DIG PRINTED, READ IN TIME IN LINE WITH ITS LENGTH.
 *
 * dig prints the answer a DNS server sent - TXT records and all - and the
 * server is whichever one a monitor asks: the domain's own, or a custom one
 * a project names. Over TCP an answer can fill 64 KB, which dig prints as up
 * to about 255,000 characters on one line. These readers are asked of every
 * DNS and DNSSEC check, on probes that run every project's monitors, so
 * each reads dig's output a fixed number of times and answers exactly as
 * the pattern named above it did.
 * ---------------------------------------------------------------------------
 */

// The labels, in any case, as the case-insensitive patterns read them.
const FLAGS_LABEL: RegExp = /flags:/gi;
const FLAGS_LABEL_LENGTH: number = 6;

// The AD (Authenticated Data) flag: "ad" in any case, a word on its own.
const AUTHENTICATED_DATA_FLAG: RegExp = /\bad\b/gi;

// What "." does not match: where a line of dig's output ends.
const LINE_TERMINATOR: RegExp = /[\n\r\u2028\u2029]/g;

/*
 * Where the next match of a global pattern starts at or after a point, for
 * points that only ever move forward: what was found is kept, and the search
 * goes on from where it stopped, so the text is read once however often it
 * is asked. -1 when there is none.
 */
class NextMatch {
  private readonly text: string;
  private readonly pattern: RegExp;
  private found: number = -1;
  private searchedFrom: number = -1;

  // A global pattern of the module: its lastIndex is set before each search.
  public constructor(text: string, pattern: RegExp) {
    this.text = text;
    this.pattern = pattern;
  }

  public atOrAfter(from: number): number {
    if (this.searchedFrom !== -1 && this.searchedFrom <= from) {
      if (this.found === -1 || this.found >= from) {
        return this.found;
      }
    }

    this.pattern.lastIndex = from;

    const match: RegExpExecArray | null = this.pattern.exec(this.text);

    this.searchedFrom = from;
    this.found = match ? match.index : -1;

    return this.found;
  }
}

/*
 * /flags:.*\bad\b/i - whether a line holds "flags:" and, after it on the
 * same line, the AD flag: whether the resolver vouched for the answer.
 *
 * Only a line's first "flags:" is asked about: what follows a later one on
 * the line follows the first too.
 */
export const digOutputHasAuthenticatedData: (stdout: string) => boolean = (
  stdout: string,
): boolean => {
  const labels: RegExp = FLAGS_LABEL;
  const flags: NextMatch = new NextMatch(stdout, AUTHENTICATED_DATA_FLAG);
  const lineEnds: NextMatch = new NextMatch(stdout, LINE_TERMINATOR);

  // The end of the line whose first label was asked about.
  let askedLineEnd: number = -1;
  let label: RegExpExecArray | null;

  labels.lastIndex = 0;

  while ((label = labels.exec(stdout)) !== null) {
    if (label.index < askedLineEnd) {
      continue;
    }

    const lineEnd: number = lineEnds.atOrAfter(label.index);

    askedLineEnd = lineEnd === -1 ? stdout.length : lineEnd;

    const flag: number = flags.atOrAfter(label.index + FLAGS_LABEL_LENGTH);

    if (flag !== -1 && flag < askedLineEnd) {
      return true;
    }
  }

  return false;
};

/*
 * /flags:\s*([^;]+);/i - what the first "flags:" with something before the
 * next ";" holds (white space before it set aside), or null: the header's
 * flags, ";; flags: qr rd ra ad;".
 *
 * A "flags:" with a ";" right after it holds nothing, and the next one is
 * asked; when no ";" follows one at all, none follows any later one.
 */
export const readDigFlagsField: (stdout: string) => string | null = (
  stdout: string,
): string | null => {
  const labels: RegExp = FLAGS_LABEL;
  let label: RegExpExecArray | null;

  labels.lastIndex = 0;

  while ((label = labels.exec(stdout)) !== null) {
    const fieldStart: number = label.index + FLAGS_LABEL_LENGTH;
    const semicolon: number = stdout.indexOf(";", fieldStart);

    if (semicolon === -1) {
      return null;
    }

    if (semicolon === fieldStart) {
      continue;
    }

    // The white space after the label, as \s* takes it.
    let valueStart: number = fieldStart;

    while (
      valueStart < semicolon &&
      isWhiteSpaceCode(stdout.charCodeAt(valueStart))
    ) {
      valueStart++;
    }

    /*
     * When only white space comes before the ";", the field still holds one
     * character: the pattern gave the last one back.
     */
    return stdout.slice(Math.min(valueStart, semicolon - 1), semicolon);
  }

  return null;
};
