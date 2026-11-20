/*
 * HOW MANY VALUES A JSON BODY WILL BECOME, COUNTED BEFORE IT IS PARSED.
 *
 * JSON.parse makes an object for every object and array it reads, and a
 * string for every string: "[]," is three bytes but an array of forty on
 * the heap. 32 MiB of empty arrays parses into eleven million of them -
 * 460 MiB of heap and a second and a half of blocked event loop, measured -
 * and one object with millions of keys is slower still. So a body is walked
 * once before it is parsed, and every object, array, string (an object's
 * key too), number, true, false and null in it is counted. The walk stops
 * as soon as the count passes the limit.
 *
 * The walk reads text (what the compatible endpoints decoded) or the UTF-8
 * bytes a body arrives as (what the App's body parsers count before they
 * decode anything, and a gzip body a chunk at a time as it inflates):
 * JsonElementTally. The bytes give the count their text gives: every
 * character JSON gives meaning to is ASCII, and no byte of a character
 * beyond ASCII is.
 *
 * Nothing is allocated, and a string's contents are jumped over (indexOf),
 * not read a character at a time. The walk does not check that the text is
 * JSON: JSON.parse says that, after it. Text that is not JSON is counted as
 * far as it looks like some - an unterminated string ends the walk - so the
 * count is never less than what JSON.parse would make of it.
 */

export enum JsonElementCountOutcome {
  Counted = "counted",
  // More values than the limit: the walk stopped there.
  OverLimit = "over-limit",
}

export interface JsonElementCount {
  outcome: JsonElementCountOutcome;
  // How many were counted (when over the limit, how many before the stop).
  elements: number;
}

/*
 * What a body may hold, counted two ways. JSON.parse makes an object of its
 * own for every object, array and string; a number, true, false or null it
 * keeps in the array or object that holds it. That is why a file, which
 * travels as an array of one number for each of its bytes, can hold
 * millions of values and cost a fraction of what as many empty arrays do
 * (measured on Node 26: 50 MiB of a file's numbers parses in a quarter of a
 * second, 50 MiB of "[]," in three seconds).
 */
export interface JsonElementLimits {
  // Every value: objects, arrays, strings, numbers, true, false and null.
  values: number;
  // The objects, arrays and strings among them (an object's keys too).
  objectsArraysAndStrings: number;
}

// Which of the two limits a body passed.
export enum JsonElementLimit {
  Values = "values",
  ObjectsArraysAndStrings = "objects-arrays-and-strings",
}

export interface JsonElementTallyCount {
  values: number;
  objectsArraysAndStrings: number;
  // The limit passed, or null while the body holds no more than both.
  passed: JsonElementLimit | null;
}

const QUOTE: number = 0x22;
const BACKSLASH: number = 0x5c;
const OPEN_BRACE: number = 0x7b;
const CLOSE_BRACE: number = 0x7d;
const OPEN_BRACKET: number = 0x5b;
const CLOSE_BRACKET: number = 0x5d;
const COMMA: number = 0x2c;
const COLON: number = 0x3a;
const SPACE: number = 0x20;
const TAB: number = 0x09;
const LINE_FEED: number = 0x0a;
const CARRIAGE_RETURN: number = 0x0d;

const isWhitespace: (code: number) => boolean = (code: number): boolean => {
  return (
    code === SPACE ||
    code === LINE_FEED ||
    code === CARRIAGE_RETURN ||
    code === TAB
  );
};

// A character that separates or closes values, which counts as none.
const isSeparator: (code: number) => boolean = (code: number): boolean => {
  return (
    code === COMMA ||
    code === COLON ||
    code === CLOSE_BRACE ||
    code === CLOSE_BRACKET ||
    isWhitespace(code)
  );
};

/*
 * Whether a number, true, false or null ends before this character: at a
 * character that opens, closes or separates a value.
 */
const endsLiteral: (code: number) => boolean = (code: number): boolean => {
  return (
    isSeparator(code) ||
    code === OPEN_BRACE ||
    code === OPEN_BRACKET ||
    code === QUOTE
  );
};

/*
 * A body's values, counted as it comes: add each piece in turn, and the
 * count is the one the whole body gives, wherever the pieces were cut -
 * inside a string, between a backslash and the quote it escapes, or in the
 * middle of a number. add and addText answer false as soon as a limit is
 * passed, and read nothing more.
 */
export class JsonElementTally {
  public readonly limits: JsonElementLimits;

  private values: number = 0;
  private objectsArraysAndStrings: number = 0;
  private passed: JsonElementLimit | null = null;

  // Inside a string, whose closing quote is still to come.
  private inString: boolean = false;
  /*
   * Inside a string: how many backslashes come just before the next
   * character. An odd run escapes the quote after it.
   */
  private backslashes: number = 0;
  // Inside a number, true, false or null.
  private inLiteral: boolean = false;

  public constructor(limits: JsonElementLimits) {
    this.limits = limits;
  }

  // Counts bytes[start, end); false once the body holds more than a limit.
  public add(
    bytes: Uint8Array,
    start?: number | undefined,
    end?: number | undefined,
  ): boolean {
    if (this.passed) {
      return false;
    }

    const stop: number = Math.min(end ?? bytes.length, bytes.length);
    let index: number = Math.max(start ?? 0, 0);

    while (index < stop) {
      if (this.inString) {
        index = this.skipStringBytes(bytes, index, stop);
        continue;
      }

      const code: number = bytes[index]!;

      if (this.inLiteral) {
        if (!endsLiteral(code)) {
          index++;
          continue;
        }

        this.inLiteral = false;
      }

      if (!this.countCharacter(code)) {
        return false;
      }

      index++;
    }

    return true;
  }

  // The same over text[start, end).
  public addText(
    text: string,
    start?: number | undefined,
    end?: number | undefined,
  ): boolean {
    if (this.passed) {
      return false;
    }

    const stop: number = Math.min(end ?? text.length, text.length);
    let index: number = Math.max(start ?? 0, 0);

    while (index < stop) {
      if (this.inString) {
        index = this.skipStringText(text, index, stop);
        continue;
      }

      const code: number = text.charCodeAt(index);

      if (this.inLiteral) {
        if (!endsLiteral(code)) {
          index++;
          continue;
        }

        this.inLiteral = false;
      }

      if (!this.countCharacter(code)) {
        return false;
      }

      index++;
    }

    return true;
  }

  public getCount(): JsonElementTallyCount {
    return {
      values: this.values,
      objectsArraysAndStrings: this.objectsArraysAndStrings,
      passed: this.passed,
    };
  }

  /*
   * One character outside a string and outside a literal: a separator, or
   * the start of a value. False once the value is one past a limit.
   */
  private countCharacter(code: number): boolean {
    if (isSeparator(code)) {
      return true;
    }

    if (code === QUOTE) {
      this.inString = true;
      this.backslashes = 0;
      return this.countValue(true);
    }

    if (code === OPEN_BRACE || code === OPEN_BRACKET) {
      return this.countValue(true);
    }

    // A number, true, false or null: up to the next structural character.
    this.inLiteral = true;
    return this.countValue(false);
  }

  private countValue(isObjectArrayOrString: boolean): boolean {
    this.values++;

    if (isObjectArrayOrString) {
      this.objectsArraysAndStrings++;
    }

    if (this.values > this.limits.values) {
      this.passed = JsonElementLimit.Values;
      return false;
    }

    if (this.objectsArraysAndStrings > this.limits.objectsArraysAndStrings) {
      this.passed = JsonElementLimit.ObjectsArraysAndStrings;
      return false;
    }

    return true;
  }

  /*
   * Where a quote at `quote` leaves the string: `run` backslashes come just
   * before it, all of them since `from` when `run` is `quote - from`, after
   * the ones carried in from before. An even run closes the string.
   */
  private closesString(quote: number, from: number, run: number): boolean {
    const total: number = run === quote - from ? this.backslashes + run : run;

    this.backslashes = 0;

    if (total % 2 === 0) {
      this.inString = false;
      return true;
    }

    return false;
  }

  // Still open at `stop`: carry the backslashes it ends with on.
  private carryBackslashes(stop: number, from: number, run: number): void {
    this.backslashes = run === stop - from ? this.backslashes + run : run;
  }

  /*
   * Inside a string, from index: where the walk goes on - past the quote
   * that closes it, or the end of these bytes when it does not close here.
   */
  private skipStringBytes(
    bytes: Uint8Array,
    index: number,
    stop: number,
  ): number {
    let from: number = index;

    for (;;) {
      const quote: number = bytes.indexOf(QUOTE, from);

      if (quote === -1 || quote >= stop) {
        this.carryBackslashes(
          stop,
          from,
          JsonElementTally.backslashBytesBefore(bytes, stop, from),
        );
        return stop;
      }

      if (
        this.closesString(
          quote,
          from,
          JsonElementTally.backslashBytesBefore(bytes, quote, from),
        )
      ) {
        return quote + 1;
      }

      // An escaped quote: the string goes on after it.
      from = quote + 1;
    }
  }

  // The same over text.
  private skipStringText(text: string, index: number, stop: number): number {
    let from: number = index;

    for (;;) {
      const quote: number = text.indexOf('"', from);

      if (quote === -1 || quote >= stop) {
        this.carryBackslashes(
          stop,
          from,
          JsonElementTally.backslashCharactersBefore(text, stop, from),
        );
        return stop;
      }

      if (
        this.closesString(
          quote,
          from,
          JsonElementTally.backslashCharactersBefore(text, quote, from),
        )
      ) {
        return quote + 1;
      }

      from = quote + 1;
    }
  }

  // How many backslashes come just before position, back to floor at most.
  private static backslashBytesBefore(
    bytes: Uint8Array,
    position: number,
    floor: number,
  ): number {
    let run: number = 0;

    for (
      let index: number = position - 1;
      index >= floor && bytes[index] === BACKSLASH;
      index--
    ) {
      run++;
    }

    return run;
  }

  private static backslashCharactersBefore(
    text: string,
    position: number,
    floor: number,
  ): number {
    let run: number = 0;

    for (
      let index: number = position - 1;
      index >= floor && text.charCodeAt(index) === BACKSLASH;
      index--
    ) {
      run++;
    }

    return run;
  }
}

/*
 * One limit shared by the several JSON documents one request is parsed as -
 * a Sentry envelope's header lines and items: each is counted before it is
 * parsed, against what the ones before it left.
 */
export class JsonValueBudget {
  private used: number = 0;
  public readonly limit: number;

  public constructor(limit: number) {
    this.limit = limit;
  }

  // Counts text; false once the request holds more than the limit.
  public take(text: string): boolean {
    const count: JsonElementCount = JsonElementCounter.count(
      text,
      this.limit - this.used,
    );

    this.used += count.elements;

    return count.outcome === JsonElementCountOutcome.Counted;
  }
}

export default class JsonElementCounter {
  /*
   * The values in text[start, end): by default the whole text. A body of
   * several JSON documents - Splunk's concatenated events, NDJSON - is
   * counted as one.
   */
  public static count(
    text: string,
    limit: number,
    start?: number | undefined,
    end?: number | undefined,
  ): JsonElementCount {
    const tally: JsonElementTally = new JsonElementTally({
      values: limit,
      objectsArraysAndStrings: Number.POSITIVE_INFINITY,
    });

    const isCounted: boolean = tally.addText(text, start, end);

    return {
      outcome: isCounted
        ? JsonElementCountOutcome.Counted
        : JsonElementCountOutcome.OverLimit,
      elements: tally.getCount().values,
    };
  }

  // The values in a body's UTF-8 bytes, held to both limits at once.
  public static countBytes(
    bytes: Uint8Array,
    limits: JsonElementLimits,
  ): JsonElementTallyCount {
    const tally: JsonElementTally = new JsonElementTally(limits);

    tally.add(bytes);

    return tally.getCount();
  }

  // The same over text.
  public static countText(
    text: string,
    limits: JsonElementLimits,
  ): JsonElementTallyCount {
    const tally: JsonElementTally = new JsonElementTally(limits);

    tally.addText(text);

    return tally.getCount();
  }

  /*
   * What a refusal over the limit says, before the endpoint's own advice
   * on sending less.
   */
  public static tooManyValuesMessage(limit: number): string {
    return `The request holds more than ${limit} JSON values (objects, arrays, strings and numbers).`;
  }
}
