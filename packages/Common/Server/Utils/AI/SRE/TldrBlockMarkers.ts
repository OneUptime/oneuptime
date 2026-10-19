import {
  isDigitCode,
  isLineTerminatorCode,
  isWhiteSpaceCode,
} from "../../../../Utils/RegExpCharacterClasses";

/*
 * ---------------------------------------------------------------------------
 * MARKDOWN BLOCK MARKERS, TAKEN OFF EVERY LINE TO A FIXED POINT, IN TIME IN
 * LINE WITH THE TEXT'S LENGTH.
 *
 * InvestigationTldr flattens a model's answer - a TL;DR, or a section of an
 * investigation's report - to plain text. Block markers stack ("> ## cause",
 * "- - cause"), so it took them off every line with two global, multi-line
 * replaces, a heading's and a quote's or bullet's,
 *
 *   HEADING:          /^\s{0,3}#{1,6}\s*\/gm
 *   QUOTE_OR_BULLET:  /^\s{0,3}(?:[>\-+*]|\d+[.)])\s+/gm
 *
 * one after the other, over and over until a round of the two changed
 * nothing. Each round took off at most one marker per line and copied the
 * whole text, so a line of a few thousand stacked markers ("> > > ...")
 * meant a few thousand copies of the text.
 *
 * stripBlockMarkers gives exactly what those rounds gave, in the same order,
 * but each round looks only at the line starts where something can have
 * changed since that marker was last looked for there; the others are known
 * to hold no marker. What a match takes off is the same: \s spans line
 * breaks, so a marker's white space can reach into the next line, and the
 * order of the rounds still decides what is taken.
 *
 * How a round ran: a global replace finds its matches in the text as it was
 * when the round's replace began, left to right, each search starting where
 * the last match ended, and "^" holds at the start of the text and after a
 * line terminator of that text. A match at a line start is decided by what
 * follows it: at most three characters of white space, then the marker
 * ("#" to "######", or ">", "-", "+", "*", or digits and "." or ")"), then
 * white space - all of it, and for a quote or bullet at least one.
 * ---------------------------------------------------------------------------
 */

const HASH: number = 0x23;
const MAX_HASHES: number = 6;
const MAX_INDENT: number = 3;

type Marker = "heading" | "quoteOrBullet";

const MARKERS: ReadonlyArray<Marker> = ["heading", "quoteOrBullet"];

// Quote and bullet characters: > - + *
const isQuoteOrBulletCode: (code: number) => boolean = (
  code: number,
): boolean => {
  return code === 0x3e || code === 0x2d || code === 0x2b || code === 0x2a;
};

// The characters after an ordered list item's number: . )
const isOrderedListEndCode: (code: number) => boolean = (
  code: number,
): boolean => {
  return code === 0x2e || code === 0x29;
};

/*
 * The text's characters that are still there, as a list a character can be
 * taken out of: the next one still there at or after an index, and the last
 * one still there at or before it, each found in near constant time (links
 * that skip what was taken out, shortened as they are followed).
 */
class RemainingCharacters {
  private readonly length: number;
  // For a removed index: an index at or after it to look from (else itself).
  private readonly nextLink: Int32Array;
  // For a removed index: an index at or before it to look from.
  private readonly previousLink: Int32Array;
  private readonly removed: Uint8Array;

  public constructor(length: number) {
    this.length = length;
    this.nextLink = new Int32Array(length + 1);
    this.previousLink = new Int32Array(length + 1);
    this.removed = new Uint8Array(length + 1);

    for (let index: number = 0; index <= length; index++) {
      this.nextLink[index] = index;
      this.previousLink[index] = index;
    }
  }

  public isPresent(index: number): boolean {
    return index >= 0 && index < this.length && this.removed[index] === 0;
  }

  // The first index still there at or after `index`, or the length.
  public nextFrom(index: number): number {
    let root: number = index;

    while (root < this.length && this.removed[root] === 1) {
      root = this.nextLink[root]!;
    }

    // Shorten the links followed.
    let current: number = index;

    while (current < this.length && this.removed[current] === 1) {
      const next: number = this.nextLink[current]!;
      this.nextLink[current] = root;
      current = next;
    }

    return root;
  }

  // The last index still there at or before `index`, or -1.
  public previousFrom(index: number): number {
    let root: number = index;

    while (root >= 0 && this.removed[root] === 1) {
      root = this.previousLink[root]!;
    }

    let current: number = index;

    while (current >= 0 && this.removed[current] === 1) {
      const previous: number = this.previousLink[current]!;
      this.previousLink[current] = root;
      current = previous;
    }

    return root;
  }

  public remove(index: number): void {
    this.removed[index] = 1;
    this.nextLink[index] = index + 1;
    this.previousLink[index] = index - 1;
  }
}

export type StripBlockMarkersFunction = (text: string) => string;

export const stripBlockMarkers: StripBlockMarkersFunction = (
  text: string,
): string => {
  const length: number = text.length;
  const remaining: RemainingCharacters = new RemainingCharacters(length);

  const codeAt: (index: number) => number = (index: number): number => {
    return text.charCodeAt(index);
  };

  // Whether the character still before `index` ends a line (or none is).
  const isLineStartNow: (index: number) => boolean = (
    index: number,
  ): boolean => {
    const previous: number = remaining.previousFrom(index - 1);

    return previous === -1 || isLineTerminatorCode(codeAt(previous));
  };

  /*
   * Where a marker at `start` ends (the index after its last character), or
   * -1 when there is none: read in the text as it is now, which from `start`
   * on is the text the round's replace began with.
   */
  const markerEnd: (marker: Marker, start: number) => number = (
    marker: Marker,
    start: number,
  ): number => {
    let index: number = start;
    let indent: number = 0;

    while (
      index < length &&
      isWhiteSpaceCode(codeAt(index)) &&
      indent <= MAX_INDENT
    ) {
      indent++;
      index = remaining.nextFrom(index + 1);
    }

    if (indent > MAX_INDENT || index >= length) {
      return -1;
    }

    if (marker === "heading") {
      if (codeAt(index) !== HASH) {
        return -1;
      }

      let hashes: number = 0;

      while (index < length && codeAt(index) === HASH && hashes < MAX_HASHES) {
        hashes++;
        index = remaining.nextFrom(index + 1);
      }
    } else {
      const code: number = codeAt(index);

      if (isQuoteOrBulletCode(code)) {
        index = remaining.nextFrom(index + 1);
      } else if (isDigitCode(code)) {
        while (index < length && isDigitCode(codeAt(index))) {
          index = remaining.nextFrom(index + 1);
        }

        if (index >= length || !isOrderedListEndCode(codeAt(index))) {
          return -1;
        }

        index = remaining.nextFrom(index + 1);
      } else {
        return -1;
      }

      // At least one character of white space after a quote or bullet.
      if (index >= length || !isWhiteSpaceCode(codeAt(index))) {
        return -1;
      }
    }

    while (index < length && isWhiteSpaceCode(codeAt(index))) {
      index = remaining.nextFrom(index + 1);
    }

    return index;
  };

  /*
   * Where each marker may have to be looked for again: line starts never
   * looked at, or whose text, or the character before them, changed since.
   * Every other line start is known to hold no such marker.
   */
  const toLookAt: Record<Marker, Set<number>> = {
    heading: new Set<number>(),
    quoteOrBullet: new Set<number>(),
  };

  const lookAgain: (index: number) => void = (index: number): void => {
    if (remaining.isPresent(index)) {
      toLookAt.heading.add(index);
      toLookAt.quoteOrBullet.add(index);
    }
  };

  for (let index: number = 0; index < length; index++) {
    if (index === 0 || isLineTerminatorCode(codeAt(index - 1))) {
      lookAgain(index);
    }
  }

  /*
   * After characters were taken out ending just before `next`, with the
   * first of them at `first`: the character now after the gap (the
   * character before it changed, so whether a line starts there may have)
   * and the line starts whose looking-for-a-marker read into the gap.
   *
   * Those are only the line starts in the white space right before the gap:
   * the gap began at a line start, so a line terminator comes right before
   * it, and a marker before that terminator would have been followed by
   * white space - a match, never a line start known to hold none. Looking
   * for a marker reads at most four characters of white space (a fourth
   * means none), so four back is all a reading can reach from.
   */
  const afterRemoval: (first: number, next: number) => void = (
    first: number,
    next: number,
  ): void => {
    lookAgain(next);

    let index: number = remaining.previousFrom(first - 1);

    for (
      let read: number = 0;
      read <= MAX_INDENT && index >= 0 && isWhiteSpaceCode(codeAt(index));
      read++
    ) {
      lookAgain(index);
      index = remaining.previousFrom(index - 1);
    }
  };

  for (;;) {
    let changed: boolean = false;

    for (const marker of MARKERS) {
      const candidates: Array<number> = Array.from(toLookAt[marker]).sort(
        (left: number, right: number): number => {
          return left - right;
        },
      );

      toLookAt[marker].clear();

      // Where the round's next search starts, and the last character it took.
      let searchFrom: number = 0;
      let lastTaken: number = -1;
      let afterLastTaken: number = -1;

      for (const start of candidates) {
        if (start < searchFrom || !remaining.isPresent(start)) {
          continue;
        }

        // "^" in the text this round began with.
        const isLineStart: boolean =
          start === afterLastTaken
            ? isLineTerminatorCode(codeAt(lastTaken))
            : isLineStartNow(start);

        if (!isLineStart) {
          continue;
        }

        const end: number = markerEnd(marker, start);

        if (end === -1) {
          continue;
        }

        // Take the match out: the characters still there from start to end.
        let last: number = start;

        for (
          let index: number = start;
          index < end;
          index = remaining.nextFrom(index + 1)
        ) {
          last = index;
          remaining.remove(index);
        }

        changed = true;
        searchFrom = end;
        lastTaken = last;
        afterLastTaken = remaining.nextFrom(end);
        afterRemoval(start, afterLastTaken);
      }
    }

    if (!changed) {
      break;
    }
  }

  let result: string = "";
  let pieceStart: number = -1;

  for (let index: number = 0; index <= length; index++) {
    const present: boolean = index < length && remaining.isPresent(index);

    if (present && pieceStart === -1) {
      pieceStart = index;
    } else if (!present && pieceStart !== -1) {
      result += text.slice(pieceStart, index);
      pieceStart = -1;
    }
  }

  return result;
};
