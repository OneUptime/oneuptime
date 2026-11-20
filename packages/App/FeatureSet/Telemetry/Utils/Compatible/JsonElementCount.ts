/*
 * HOW MANY VALUES A JSON BODY WILL BECOME, COUNTED BEFORE IT IS PARSED.
 *
 * JSON.parse makes an object for every object and array it reads, and a
 * string for every string: "[]," is three bytes but an array of forty on
 * the heap. 32 MiB of empty arrays parses into eleven million of them -
 * 460 MiB of heap and a second and a half of blocked event loop, measured -
 * and one object with millions of keys is slower still. The compatible
 * endpoints parse their bodies on the App's request thread (an OTLP/HTTP
 * export's JSON is parsed by the worker), so a body is walked once first,
 * and every object, array, string (an object's key too), number, true,
 * false and null in it is counted. The walk stops as soon as the count
 * passes the limit.
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
    const stop: number = Math.min(end ?? text.length, text.length);
    let index: number = Math.max(start ?? 0, 0);
    let elements: number = 0;

    while (index < stop) {
      const code: number = text.charCodeAt(index);

      if (code === QUOTE) {
        elements++;

        if (elements > limit) {
          return JsonElementCounter.overLimit(elements);
        }

        const closing: number = JsonElementCounter.endOfString(
          text,
          index,
          stop,
        );

        if (closing === -1) {
          break;
        }

        index = closing + 1;
        continue;
      }

      if (
        code === COMMA ||
        code === COLON ||
        code === CLOSE_BRACE ||
        code === CLOSE_BRACKET ||
        JsonElementCounter.isWhitespace(code)
      ) {
        index++;
        continue;
      }

      elements++;

      if (elements > limit) {
        return JsonElementCounter.overLimit(elements);
      }

      if (code === OPEN_BRACE || code === OPEN_BRACKET) {
        index++;
        continue;
      }

      // A number, true, false or null: up to the next structural character.
      index++;

      while (index < stop) {
        const next: number = text.charCodeAt(index);

        if (
          next === COMMA ||
          next === COLON ||
          next === CLOSE_BRACE ||
          next === CLOSE_BRACKET ||
          next === OPEN_BRACE ||
          next === OPEN_BRACKET ||
          next === QUOTE ||
          JsonElementCounter.isWhitespace(next)
        ) {
          break;
        }

        index++;
      }
    }

    return { outcome: JsonElementCountOutcome.Counted, elements: elements };
  }

  /*
   * What a refusal over the limit says, before the endpoint's own advice
   * on sending less.
   */
  public static tooManyValuesMessage(limit: number): string {
    return `The request holds more than ${limit} JSON values (objects, arrays, strings and numbers).`;
  }

  private static overLimit(elements: number): JsonElementCount {
    return { outcome: JsonElementCountOutcome.OverLimit, elements: elements };
  }

  private static isWhitespace(code: number): boolean {
    return (
      code === SPACE ||
      code === LINE_FEED ||
      code === CARRIAGE_RETURN ||
      code === TAB
    );
  }

  /*
   * The index of the quote that closes the string opening at `start`, or
   * -1 when none does before `stop`: the first quote after it that an even
   * run of backslashes (none, or escaped backslashes) comes before.
   */
  private static endOfString(
    text: string,
    start: number,
    stop: number,
  ): number {
    let quote: number = text.indexOf('"', start + 1);

    while (quote !== -1 && quote < stop) {
      let backslashes: number = 0;

      for (
        let index: number = quote - 1;
        index > start && text.charCodeAt(index) === BACKSLASH;
        index--
      ) {
        backslashes++;
      }

      if (backslashes % 2 === 0) {
        return quote;
      }

      quote = text.indexOf('"', quote + 1);
    }

    return -1;
  }
}
