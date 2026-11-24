import { JSONObject, JSONValue } from "../../../Types/JSON";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { REDACTED } from "../LogRedaction";

/*
 * A MONITOR SECRET'S VALUE NEVER COMES BACK IN WHAT A CHECK REPORTS
 * (OneUptime issue #10825).
 *
 * The server fills a monitor's Text secrets into its steps before it hands
 * the check to the probe: {{monitorSecrets.Token}} arrives in a Synthetic
 * script, an API request's URL, headers and body, as the value itself. And
 * a check can say that value back:
 *
 *   - a script's error quotes it: Playwright writes the URL a page failed
 *     to load ("page.goto: net::ERR_NAME_NOT_RESOLVED at
 *     https://app.example.com/?token=..."), and a script's own log lines say
 *     whatever it prints;
 *   - a response repeats the request: an API that echoes its query
 *     ({"args": {"key": "..."}}), an error page that quotes the URL, a
 *     server that returns the headers it was sent.
 *
 * What a check reports is shown on the monitor's page and summary, judged by
 * its criteria (the Error criteria reads a script's error), written into an
 * incident's root cause and the notifications a template writes, and kept in
 * the monitor's logs and a Test Monitor run's result - for everyone who can
 * read the monitor, while the secret's value is otherwise shown to nobody.
 *
 * So each value is looked for in every text of the check and written as
 * HIDDEN_SECRET_MARKER where it stands; everything around it is kept, so a
 * script's author still reads the path and the line that failed. A value is
 * found:
 *
 *   - in any case: a parser writes a host in lower case, and a value in
 *     another case is no less the secret;
 *   - with each character as it is, or escaped one or two levels deep as a
 *     URL (percent-encoding, a space as "+"), JSON or JavaScript (\" \\ \/
 *     \n é \x41), or HTML (&amp; &#39; &#x27;) writes it - one
 *     character escaped and the next not, as Chrome writes a URL, and a
 *     JSON text inside a JSON string, as an echo server returns the body it
 *     was sent;
 *   - without the tabs and line breaks a URL parser drops, without the
 *     spaces around it, and with a backslash in a URL's path written as
 *     the slash a parser writes there. (A parser also drops the "." and
 *     ".." segments of a path; a value that holds "/./" or "/../" is not
 *     looked for without them.);
 *   - in base64, where a client sends it so (an Authorization: Basic
 *     header): wherever the value starts in the encoded bytes, and with or
 *     without padding, in the standard and the URL-safe alphabets.
 *
 * Where two values overlap - or a value overlaps itself, "abab" in
 * "ababab" - the whole stretch they cover is hidden, never what one leaves of
 * the other.
 *
 * The marker is fixed: it says nothing of the value - not its length, not a
 * character of it, not a hash anyone could test a guess against - and is not
 * the {{monitorSecrets.NAME}} placeholder, which the server fills in.
 *
 * A value shorter than MINIMUM_HIDDEN_SECRET_LENGTH is left as it is: see
 * there.
 *
 * Every text is read in time in line with its length: a response body is
 * written by whatever a monitor watches.
 */

/*
 * The fewest characters a value must have, not counting spaces at either
 * end, to be hidden. One to three characters - "abc", "123", "dev" - stand
 * in ordinary text all the time (numbers, words, parts of words): hidden,
 * they would cut most of what a check says into pieces, and the marks would
 * show the value anyway, by where they stand. A value that short can be
 * guessed in a few thousand tries, so hiding it would protect nothing. Four
 * characters is where a value - a PIN, a short code - stops being part of
 * most texts, the line CircleCI draws for the secrets it masks in its logs.
 */
export const MINIMUM_HIDDEN_SECRET_LENGTH: number = 4;

// What stands where a secret's value was.
export const HIDDEN_SECRET_MARKER: string = REDACTED;

/*
 * The fewest characters a value's base64 form is looked for by: shorter
 * runs of base64 letters are in any long text by chance (one of seven
 * letters is about one in 10^11 at each place).
 */
const MINIMUM_BASE64_LENGTH: number = 7;

// How many levels of escaping a text is read through (see readEscaped).
const ESCAPE_LEVELS: number = 2;

// Deep enough for any real check, shallow enough to bound the walk.
const MAX_DEPTH: number = 64;

// A check's fields OneUptime writes itself, as the probe got them: kept.
const LEFT_AS_SENT_FIELDS: ReadonlySet<string> = new Set<string>([
  "evaluationSummary",
]);

/*
 * The fields of a check that hold what the monitored system sent: their
 * names and their numbers are its own text, read as the rest is.
 */
const CONTENT_FIELDS: ReadonlySet<string> = new Set<string>([
  "responseBody",
  "responseHeaders",
]);

// A Custom Code monitor's run, and each run of a Synthetic monitor.
const SCRIPT_RESPONSE_FIELDS: ReadonlySet<string> = new Set<string>([
  "customCodeMonitorResponse",
  "syntheticMonitorResponse",
]);

// What a script returned: the script's own data, read as a body is.
const SCRIPT_RESULT_FIELD: string = "result";

// A Synthetic monitor's screenshots: images, which no text rule can read.
const SCREENSHOTS_FIELD: string = "screenshots";

// Where the check went: the step's configured destination, filled in.
const DESTINATION_FIELD: string = "monitorDestination";

/*
 * The base64 form of a value, from one place in the encoded bytes: the
 * letters only its own bytes make, and what follows them when the value
 * ends the encoded text (padding and all, or none).
 */
interface Base64Form {
  core: string;
  // The longest first.
  tails: ReadonlyArray<string>;
}

/*
 * A text as it is looked in: folded (see fold), and where each of its
 * characters stands in the text it was read from.
 */
interface TextReading {
  text: string;
  /*
   * Where character i starts in the original text, and the original's
   * length last; null when the reading is the original, character for
   * character.
   */
  starts: Int32Array | null;
}

/*
 * The values a check's texts are read for, each in every form it is looked
 * for in. Made once per check (MonitorSecretValueRedaction.compile).
 */
export class HiddenSecretValues {
  // Each value folded, as written and without what a parser drops.
  public readonly texts: ReadonlyArray<string>;
  public readonly base64: ReadonlyArray<Base64Form>;
  /*
   * Of each form, its longest run of letters and digits: no escaper
   * writes one otherwise, so a text whose own letters hold none of these
   * holds no form however it escapes, and is never read through its
   * escapes. Empty when a form has no letter or digit at all.
   */
  public readonly anchors: ReadonlyArray<string>;
  // The fewest characters a form takes: a shorter text holds none.
  public readonly shortest: number;
  // How often each form repeats itself (getPeriod), worked out once.
  private readonly periods: Map<string, number> = new Map<string, number>();

  public constructor(data: {
    texts: ReadonlyArray<string>;
    base64: ReadonlyArray<Base64Form>;
  }) {
    this.texts = data.texts;
    this.base64 = data.base64;

    const needles: Array<string> = [
      ...data.texts,
      ...data.base64.map((form: Base64Form): string => {
        return form.core;
      }),
    ];

    const anchors: Array<string> = [];

    for (const needle of needles) {
      const anchor: string = HiddenSecretValues.getAnchor(needle);

      if (!anchors.includes(anchor)) {
        anchors.push(anchor);
      }

      this.periods.set(needle, HiddenSecretValues.findPeriod(needle));
    }

    this.anchors = anchors;
    this.shortest = Math.min(
      ...needles.map((needle: string): number => {
        return needle.length;
      }),
    );
  }

  /*
   * The fewest characters a form repeats after: "abcab" every 3, "aaaa"
   * every 1, a form that does not repeat itself its own length.
   */
  public getPeriod(needle: string): number {
    return this.periods.get(needle) ?? HiddenSecretValues.findPeriod(needle);
  }

  // Read in time in line with its length (Knuth, Morris and Pratt's prefix function).
  private static findPeriod(text: string): number {
    if (text.length < 2) {
      return text.length;
    }

    const border: Int32Array = new Int32Array(text.length);
    let matched: number = 0;

    for (let index: number = 1; index < text.length; index++) {
      while (
        matched > 0 &&
        text.charCodeAt(index) !== text.charCodeAt(matched)
      ) {
        matched = border[matched - 1] as number;
      }

      if (text.charCodeAt(index) === text.charCodeAt(matched)) {
        matched++;
      }

      border[index] = matched;
    }

    return text.length - (border[text.length - 1] as number);
  }

  // A folded text's longest run of ASCII letters and digits.
  private static getAnchor(needle: string): string {
    let longest: string = "";
    let start: number = -1;

    for (let index: number = 0; index <= needle.length; index++) {
      const character: number =
        index < needle.length ? needle.charCodeAt(index) : -1;
      const isLetterOrDigit: boolean =
        (character >= 97 && character <= 122) ||
        (character >= 48 && character <= 57);

      if (isLetterOrDigit) {
        if (start === -1) {
          start = index;
        }

        continue;
      }

      if (start !== -1 && index - start > longest.length) {
        longest = needle.slice(start, index);
      }

      start = -1;
    }

    return longest;
  }
}

export default class MonitorSecretValueRedaction {
  public static readonly MARKER: string = HIDDEN_SECRET_MARKER;

  /*
   * Is this value long enough to be hidden (MINIMUM_HIDDEN_SECRET_LENGTH)?
   * Counted in characters as people count them, not in UTF-16 units.
   */
  public static isLongEnoughToHide(value: unknown): boolean {
    if (typeof value !== "string") {
      return false;
    }

    return Array.from(value.trim()).length >= MINIMUM_HIDDEN_SECRET_LENGTH;
  }

  /*
   * The values to hide, ready to look for; null when none is long enough
   * to be hidden, and nothing need be read at all.
   */
  public static compile(
    values: Iterable<string | null | undefined>,
  ): HiddenSecretValues | null {
    const texts: Set<string> = new Set<string>();
    const base64: Map<string, Base64Form> = new Map<string, Base64Form>();

    for (const value of Array.from(values)) {
      if (
        typeof value !== "string" ||
        !MonitorSecretValueRedaction.isLongEnoughToHide(value)
      ) {
        continue;
      }

      for (const written of MonitorSecretValueRedaction.getTextForms(value)) {
        texts.add(written);
      }

      for (const form of MonitorSecretValueRedaction.getBase64Forms(value)) {
        base64.set(`${form.core}\u0000${form.tails.join("\u0000")}`, form);
      }
    }

    if (texts.size === 0) {
      return null;
    }

    return new HiddenSecretValues({
      // The longest first: no shorter one is ever looked for where a longer one stands.
      texts: Array.from(texts).sort((a: string, b: string): number => {
        return b.length - a.length;
      }),
      base64: Array.from(base64.values()),
    });
  }

  /*
   * A text with every value written as HIDDEN_SECRET_MARKER wherever it
   * stands, in any of its forms; the rest of the text as it was. The same
   * text, when it holds none.
   */
  public static redactText(
    text: string,
    values: HiddenSecretValues | null,
  ): string {
    if (typeof text !== "string" || !text || !values) {
      return text;
    }

    const found: Array<number> = MonitorSecretValueRedaction.findValues(
      text,
      values,
    );

    if (found.length === 0) {
      return text;
    }

    return MonitorSecretValueRedaction.writeMarkers(text, found);
  }

  /*
   * A text as redactText writes it, still the JSON it was: a value that
   * stood outside a JSON string - a number, or across the text's own
   * quotes - is written as the string "[REDACTED]" instead, so a criteria
   * or a template that reads the body as JSON still can. A text that was
   * no JSON is as redactText writes it.
   */
  public static redactTextKeepingJson(
    text: string,
    values: HiddenSecretValues | null,
  ): string {
    const redacted: string = MonitorSecretValueRedaction.redactText(
      text,
      values,
    );

    if (
      !values ||
      redacted === text ||
      !MonitorSecretValueRedaction.looksLikeJsonContainer(text)
    ) {
      return redacted;
    }

    let parsed: JSONValue;

    try {
      parsed = JSON.parse(text) as JSONValue;
    } catch {
      return redacted;
    }

    try {
      JSON.parse(redacted);
      return redacted;
    } catch {
      // Read again by its values, below.
    }

    const rewritten: string = JSON.stringify(
      MonitorSecretValueRedaction.redactValue(parsed, values, true, 0),
    );

    /*
     * A value that ran across the text's own quotes is hidden still,
     * whether or not the text stays JSON: a secret is worth more than a
     * body a criteria can parse.
     */
    return MonitorSecretValueRedaction.redactText(rewritten, values);
  }

  /*
   * What a probe reports of a check, with every value hidden wherever it
   * stands: a script's error, log lines, returned data and metrics, a
   * response's body and headers, the failure cause, each attempt's, why the
   * request failed, and every other text a monitor type reports. A copy:
   * the check it is handed is never changed, and what holds no value is
   * the very object it was.
   *
   * Left as they are: the fields OneUptime writes itself (the ids, the
   * times, the evaluation it adds), the check's numbers, which the probe
   * measured, and a Synthetic monitor's screenshots, which are images. The
   * names and numbers of a response's body and headers and of a script's
   * returned data are the monitored system's own, read as its text is.
   *
   * The destination the probe echoes is the one the server filled the
   * secrets into: when it holds a value, it is the step's as it was
   * configured, {{monitorSecrets.NAME}} by name (configuredDestination),
   * or none.
   */
  public static redactCheck(
    check: ProbeMonitorResponse,
    values: HiddenSecretValues | null,
    options?: { configuredDestination?: unknown } | undefined,
  ): ProbeMonitorResponse {
    if (!values || !MonitorSecretValueRedaction.isPlainObject(check)) {
      return check;
    }

    const source: JSONObject = check as unknown as JSONObject;
    let result: JSONObject | null = null;

    for (const key of Object.keys(source)) {
      const value: JSONValue = source[key] as JSONValue;
      let redacted: JSONValue | undefined = value;

      if (LEFT_AS_SENT_FIELDS.has(key)) {
        continue;
      }

      if (key === DESTINATION_FIELD) {
        redacted = MonitorSecretValueRedaction.holdsValue(
          MonitorSecretValueRedaction.toText(value),
          values,
        )
          ? (options?.configuredDestination as JSONValue | undefined)
          : value;
      } else if (CONTENT_FIELDS.has(key)) {
        redacted = MonitorSecretValueRedaction.redactValue(
          value,
          values,
          true,
          1,
        );
      } else if (SCRIPT_RESPONSE_FIELDS.has(key)) {
        redacted = Array.isArray(value)
          ? MonitorSecretValueRedaction.mapKeepingSame(
              value as Array<JSONValue>,
              (item: JSONValue): JSONValue => {
                return MonitorSecretValueRedaction.redactScriptResponse(
                  item,
                  values,
                );
              },
            )
          : MonitorSecretValueRedaction.redactScriptResponse(value, values);
      } else {
        redacted = MonitorSecretValueRedaction.redactValue(
          value,
          values,
          false,
          1,
        );
      }

      if (redacted !== value) {
        result = result || { ...source };

        if (redacted === undefined) {
          delete result[key];
        } else {
          MonitorSecretValueRedaction.writeOwn(result, key, redacted);
        }
      }
    }

    return (result || check) as unknown as ProbeMonitorResponse;
  }

  // Does this text hold one of the values, in any of its forms?
  public static holdsValue(
    text: string,
    values: HiddenSecretValues | null,
  ): boolean {
    return (
      Boolean(values) &&
      typeof text === "string" &&
      text.length > 0 &&
      MonitorSecretValueRedaction.findValues(text, values!).length > 0
    );
  }

  // A script's run: its returned data read as a body is, the rest as text.
  private static redactScriptResponse(
    value: JSONValue,
    values: HiddenSecretValues,
  ): JSONValue {
    if (!MonitorSecretValueRedaction.isPlainObject(value)) {
      return MonitorSecretValueRedaction.redactValue(value, values, false, 1);
    }

    const source: JSONObject = value as JSONObject;
    let result: JSONObject | null = null;

    for (const key of Object.keys(source)) {
      const child: JSONValue = source[key] as JSONValue;

      if (key === SCREENSHOTS_FIELD) {
        continue;
      }

      const redacted: JSONValue = MonitorSecretValueRedaction.redactValue(
        child,
        values,
        key === SCRIPT_RESULT_FIELD,
        2,
      );

      if (redacted !== child) {
        result = result || { ...source };
        MonitorSecretValueRedaction.writeOwn(result, key, redacted);
      }
    }

    return result || value;
  }

  /*
   * A value with every text in it read for the values. In the monitored
   * system's own data (isContent) a name is read too, and a number or
   * true/false that is one is written as the marker. Objects and arrays
   * are copied only where something in them changes. Past MAX_DEPTH a
   * subtree is dropped rather than passed through unread.
   */
  private static redactValue(
    value: JSONValue,
    values: HiddenSecretValues,
    isContent: boolean,
    depth: number,
  ): JSONValue {
    if (depth > MAX_DEPTH) {
      return null;
    }

    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === "string") {
      return MonitorSecretValueRedaction.redactTextKeepingJson(value, values);
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return isContent &&
        MonitorSecretValueRedaction.holdsValue(String(value), values)
        ? HIDDEN_SECRET_MARKER
        : value;
    }

    if (Array.isArray(value)) {
      return MonitorSecretValueRedaction.mapKeepingSame(
        value as Array<JSONValue>,
        (item: JSONValue): JSONValue => {
          return MonitorSecretValueRedaction.redactValue(
            item,
            values,
            isContent,
            depth + 1,
          );
        },
      );
    }

    if (!MonitorSecretValueRedaction.isPlainObject(value)) {
      /*
       * A value of a type OneUptime reads back (an id, a date, a URL): its
       * own fields are OneUptime's. In the monitored system's data it is
       * what a body happened to spell as one - its text read as text.
       */
      if (!isContent) {
        return value;
      }

      const text: string = MonitorSecretValueRedaction.toText(value);

      return MonitorSecretValueRedaction.holdsValue(text, values)
        ? MonitorSecretValueRedaction.redactText(text, values)
        : value;
    }

    const source: JSONObject = value as JSONObject;
    let result: JSONObject | null = null;
    const keys: Array<string> = Object.keys(source);

    for (const key of keys) {
      const child: JSONValue = source[key] as JSONValue;
      const redactedKey: string = isContent
        ? MonitorSecretValueRedaction.redactText(key, values)
        : key;
      const redactedChild: JSONValue = MonitorSecretValueRedaction.redactValue(
        child,
        values,
        isContent,
        depth + 1,
      );

      if (redactedKey !== key || redactedChild !== child) {
        if (!result) {
          // Copied in the order it was written, up to here.
          result = {};

          for (const earlier of keys) {
            if (earlier === key) {
              break;
            }

            MonitorSecretValueRedaction.writeOwn(
              result,
              earlier,
              source[earlier] as JSONValue,
            );
          }
        }
      }

      if (result) {
        MonitorSecretValueRedaction.writeOwn(
          result,
          redactedKey,
          redactedChild,
        );
      }
    }

    return result || value;
  }

  /*
   * A key written as the object's own: a body's "__proto__" key stays a
   * key, as JSON.parse and JSONFunctions.deserialize keep it, and never
   * reaches the object's prototype.
   */
  private static writeOwn(
    target: JSONObject,
    key: string,
    value: JSONValue,
  ): void {
    Object.defineProperty(target, key, {
      value: value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  // An array with each item mapped: the same array when none changes.
  private static mapKeepingSame(
    items: Array<JSONValue>,
    map: (item: JSONValue) => JSONValue,
  ): Array<JSONValue> {
    let result: Array<JSONValue> | null = null;

    for (let index: number = 0; index < items.length; index++) {
      const item: JSONValue = items[index] as JSONValue;
      const mapped: JSONValue = map(item);

      if (mapped !== item && !result) {
        result = items.slice(0, index);
      }

      if (result) {
        result.push(mapped);
      }
    }

    return result || items;
  }

  /*
   * Where the values stand in a text: [start, end, start, end, ...], in
   * the text's own characters, in no order. Read as written, and through
   * each level of escaping a text holds.
   */
  private static findValues(
    text: string,
    values: HiddenSecretValues,
  ): Array<number> {
    const found: Array<number> = [];

    if (text.length < values.shortest) {
      return found;
    }

    const readings: Array<TextReading> =
      MonitorSecretValueRedaction.getReadings(text, values);

    for (const reading of readings) {
      for (const written of values.texts) {
        MonitorSecretValueRedaction.findAll({
          reading: reading,
          needle: written,
          period: values.getPeriod(written),
          tails: [],
          found: found,
        });
      }

      for (const form of values.base64) {
        MonitorSecretValueRedaction.findAll({
          reading: reading,
          needle: form.core,
          period: values.getPeriod(form.core),
          tails: form.tails,
          found: found,
        });
      }
    }

    return found;
  }

  /*
   * Every place a needle stands in a reading, as a stretch of the original
   * text - where it overlaps itself included - each run on over the
   * longest of the tails that follows it there.
   *
   * A needle that repeats itself every few characters ("abab", every two)
   * overlaps itself in a text that repeats so too: found once, it is run on
   * over each repeat that follows, a repeat's length at a time, and looked
   * for again only past that run. Each character is read a bounded number
   * of times, however the text and the needle are made.
   */
  private static findAll(input: {
    reading: TextReading;
    needle: string;
    // The fewest characters the needle repeats after (getPeriod).
    period: number;
    tails: ReadonlyArray<string>;
    found: Array<number>;
  }): void {
    const haystack: string = input.reading.text;
    const starts: Int32Array | null = input.reading.starts;
    const length: number = input.needle.length;
    const period: number = Math.max(1, Math.min(length, input.period));
    const repeat: string = input.needle.slice(length - period);
    let index: number = haystack.indexOf(input.needle);

    while (index !== -1) {
      let end: number = index + length;

      if (period < length) {
        while (haystack.startsWith(repeat, end)) {
          end += period;
        }
      }

      for (const tail of input.tails) {
        if (tail && haystack.startsWith(tail, end)) {
          end += tail.length;
          break;
        }
      }

      input.found.push(
        starts ? (starts[index] as number) : index,
        starts ? (starts[end] as number) : end,
      );

      index = haystack.indexOf(
        input.needle,
        Math.max(index + 1, end - length + 1),
      );
    }
  }

  /*
   * The text with each stretch written as one marker: stretches that
   * overlap or touch are one.
   */
  private static writeMarkers(text: string, found: Array<number>): string {
    const stretches: Array<[number, number]> = [];

    for (let index: number = 0; index + 1 < found.length; index += 2) {
      const start: number = found[index] as number;
      const end: number = found[index + 1] as number;

      if (end > start) {
        stretches.push([start, end]);
      }
    }

    if (stretches.length === 0) {
      return text;
    }

    stretches.sort((a: [number, number], b: [number, number]): number => {
      return a[0] - b[0] || b[1] - a[1];
    });

    let written: string = "";
    let cursor: number = 0;
    let open: [number, number] | null = null;

    for (const stretch of stretches) {
      if (open && stretch[0] <= open[1]) {
        open[1] = Math.max(open[1], stretch[1]);
        continue;
      }

      if (open) {
        written += text.slice(cursor, open[0]) + HIDDEN_SECRET_MARKER;
        cursor = open[1];
      }

      open = [stretch[0], stretch[1]];
    }

    if (open) {
      written += text.slice(cursor, open[0]) + HIDDEN_SECRET_MARKER;
      cursor = open[1];
    }

    return written + text.slice(cursor);
  }

  /*
   * The text as it is looked in: folded, then read through one level of
   * escaping and through a second, each only when the one before holds an
   * escape - and only when the text's own letters hold a form's anchor
   * (HiddenSecretValues.anchors). Each reading says where its characters
   * stand in the text.
   */
  private static getReadings(
    text: string,
    values: HiddenSecretValues,
  ): Array<TextReading> {
    const folded: string = MonitorSecretValueRedaction.fold(text);
    const readings: Array<TextReading> = [{ text: folded, starts: null }];

    const mayHoldEscapedForm: boolean = values.anchors.some(
      (anchor: string): boolean => {
        return !anchor || folded.indexOf(anchor) !== -1;
      },
    );

    if (!mayHoldEscapedForm) {
      return readings;
    }

    for (let level: number = 0; level < ESCAPE_LEVELS; level++) {
      const previous: TextReading = readings[readings.length - 1]!;
      const read: TextReading | null = MonitorSecretValueRedaction.readEscaped(
        previous.text,
      );

      if (!read) {
        break;
      }

      // Where each character stands in the original text.
      if (previous.starts && read.starts) {
        const composed: Int32Array = new Int32Array(read.starts.length);

        for (let index: number = 0; index < read.starts.length; index++) {
          composed[index] = previous.starts[
            read.starts[index] as number
          ] as number;
        }

        read.starts = composed;
      }

      readings.push(read);
    }

    return readings;
  }

  /*
   * A text with every escape it holds read as the character it stands for,
   * one level deep: a URL's %xx (UTF-8, or one byte as Latin-1 where the
   * bytes are no UTF-8), JSON's and JavaScript's \" \\ \/ \' \b \f \n \r
   * \t \v \0 \uXXXX \u{X} \xXX, and HTML's &amp; &lt; &gt; &quot; &apos;
   * &#NN; &#xNN;. Everything else as it is. The text is folded already, and
   * so is what an escape stands for. Null when the text holds no escape.
   */
  private static readEscaped(text: string): TextReading | null {
    if (
      text.indexOf("%") === -1 &&
      text.indexOf("\\") === -1 &&
      text.indexOf("&") === -1
    ) {
      return null;
    }

    // An escape is never shorter than what it stands for.
    const units: Uint16Array = new Uint16Array(text.length);
    const starts: Int32Array = new Int32Array(text.length + 1);
    let length: number = 0;
    let isEscapeRead: boolean = false;

    const write: (codePoint: number, start: number) => void = (
      codePoint: number,
      start: number,
    ): void => {
      const folded: string = MonitorSecretValueRedaction.fold(
        String.fromCodePoint(codePoint),
      );

      for (let index: number = 0; index < folded.length; index++) {
        units[length] = folded.charCodeAt(index);
        starts[length] = start;
        length++;
      }
    };

    let index: number = 0;

    while (index < text.length) {
      const character: number = text.charCodeAt(index);

      if (character === 37) {
        // "%": a run of %xx, read as UTF-8.
        const bytes: Array<number> = [];
        const byteStarts: Array<number> = [];
        let cursor: number = index;

        while (
          cursor + 2 < text.length &&
          text.charCodeAt(cursor) === 37 &&
          MonitorSecretValueRedaction.hexValue(text.charCodeAt(cursor + 1)) >=
            0 &&
          MonitorSecretValueRedaction.hexValue(text.charCodeAt(cursor + 2)) >= 0
        ) {
          bytes.push(
            MonitorSecretValueRedaction.hexValue(text.charCodeAt(cursor + 1)) *
              16 +
              MonitorSecretValueRedaction.hexValue(text.charCodeAt(cursor + 2)),
          );
          byteStarts.push(cursor);
          cursor += 3;
        }

        if (bytes.length === 0) {
          units[length] = character;
          starts[length] = index;
          length++;
          index++;
          continue;
        }

        let byteIndex: number = 0;

        while (byteIndex < bytes.length) {
          const decoded: [number, number] =
            MonitorSecretValueRedaction.readUtf8(bytes, byteIndex);

          if (decoded[1] === 0) {
            // No UTF-8: the byte as Latin-1, as an older system encodes é.
            write(bytes[byteIndex] as number, byteStarts[byteIndex] as number);
            byteIndex++;
            continue;
          }

          write(decoded[0], byteStarts[byteIndex] as number);
          byteIndex += decoded[1];
        }

        isEscapeRead = true;
        index = cursor;
        continue;
      }

      if (character === 92) {
        // "\": a JSON or JavaScript escape.
        const escape: [number, number] | null =
          MonitorSecretValueRedaction.readBackslashEscape(text, index);

        if (escape) {
          write(escape[0], index);
          isEscapeRead = true;
          index += escape[1];
          continue;
        }
      }

      if (character === 38) {
        // "&": an HTML character reference.
        const reference: [number, number] | null =
          MonitorSecretValueRedaction.readHtmlReference(text, index);

        if (reference) {
          write(reference[0], index);
          isEscapeRead = true;
          index += reference[1];
          continue;
        }
      }

      units[length] = character;
      starts[length] = index;
      length++;
      index++;
    }

    if (!isEscapeRead) {
      return null;
    }

    starts[length] = text.length;

    return {
      text: MonitorSecretValueRedaction.unitsToString(units, length),
      starts: starts.slice(0, length + 1),
    };
  }

  /*
   * The code point a backslash escape at `index` stands for, and how many
   * characters it takes; null when what follows the backslash is no escape.
   */
  private static readBackslashEscape(
    text: string,
    index: number,
  ): [number, number] | null {
    const next: string = text.charAt(index + 1);

    switch (next) {
      case '"':
      case "\\":
      case "/":
      case "'":
      case "`":
        return [next.charCodeAt(0), 2];
      case "b":
        return [8, 2];
      case "f":
        return [12, 2];
      case "n":
        return [10, 2];
      case "r":
        return [13, 2];
      case "t":
        return [9, 2];
      case "v":
        return [11, 2];
      case "0":
        return [0, 2];
      case "x": {
        const value: number = MonitorSecretValueRedaction.readHexDigits(
          text,
          index + 2,
          2,
        );

        return value >= 0 ? [value, 4] : null;
      }
      case "u": {
        if (text.charAt(index + 2) === "{") {
          const close: number = text.indexOf("}", index + 3);

          if (close === -1 || close - (index + 3) < 1 || close - index > 9) {
            return null;
          }

          const value: number = MonitorSecretValueRedaction.readHexDigits(
            text,
            index + 3,
            close - (index + 3),
          );

          return value >= 0 && value <= 0x10ffff
            ? [value, close - index + 1]
            : null;
        }

        const value: number = MonitorSecretValueRedaction.readHexDigits(
          text,
          index + 2,
          4,
        );

        return value >= 0 ? [value, 6] : null;
      }
      default:
        return null;
    }
  }

  // HTML's character references that stand for the characters an escaper writes.
  private static readonly NAMED_REFERENCES: Readonly<Record<string, number>> = {
    "&amp;": 38,
    "&lt;": 60,
    "&gt;": 62,
    "&quot;": 34,
    "&apos;": 39,
    "&nbsp;": 160,
  };

  /*
   * The code point an HTML character reference at `index` stands for, and
   * how many characters it takes; null when it is none.
   */
  private static readHtmlReference(
    text: string,
    index: number,
  ): [number, number] | null {
    if (text.charAt(index + 1) !== "#") {
      for (const name of Object.keys(
        MonitorSecretValueRedaction.NAMED_REFERENCES,
      )) {
        if (text.startsWith(name, index)) {
          return [
            MonitorSecretValueRedaction.NAMED_REFERENCES[name] as number,
            name.length,
          ];
        }
      }

      return null;
    }

    const isHex: boolean = text.charAt(index + 2) === "x";
    const digitsStart: number = index + (isHex ? 3 : 2);
    let cursor: number = digitsStart;

    while (
      cursor < text.length &&
      cursor - digitsStart < 7 &&
      (isHex
        ? MonitorSecretValueRedaction.hexValue(text.charCodeAt(cursor)) >= 0
        : text.charCodeAt(cursor) >= 48 && text.charCodeAt(cursor) <= 57)
    ) {
      cursor++;
    }

    if (cursor === digitsStart || text.charAt(cursor) !== ";") {
      return null;
    }

    const value: number = parseInt(
      text.slice(digitsStart, cursor),
      isHex ? 16 : 10,
    );

    return value >= 0 && value <= 0x10ffff ? [value, cursor - index + 1] : null;
  }

  // `count` hex digits at `index` as a number; -1 when they are not all there.
  private static readHexDigits(
    text: string,
    index: number,
    count: number,
  ): number {
    if (index + count > text.length) {
      return -1;
    }

    let value: number = 0;

    for (let offset: number = 0; offset < count; offset++) {
      const digit: number = MonitorSecretValueRedaction.hexValue(
        text.charCodeAt(index + offset),
      );

      if (digit < 0) {
        return -1;
      }

      value = value * 16 + digit;
    }

    return value;
  }

  private static hexValue(character: number): number {
    if (character >= 48 && character <= 57) {
      return character - 48;
    }

    if (character >= 97 && character <= 102) {
      return character - 87;
    }

    if (character >= 65 && character <= 70) {
      return character - 55;
    }

    return -1;
  }

  /*
   * The code point the UTF-8 bytes at `index` encode, and how many bytes
   * it takes; [0, 0] when they are no well-formed UTF-8.
   */
  private static readUtf8(
    bytes: Array<number>,
    index: number,
  ): [number, number] {
    const first: number = bytes[index] as number;

    if (first < 0x80) {
      return [first, 1];
    }

    let count: number = 0;
    let codePoint: number = 0;
    let lowest: number = 0;

    if (first >= 0xc2 && first <= 0xdf) {
      count = 2;
      codePoint = first & 0x1f;
      lowest = 0x80;
    } else if (first >= 0xe0 && first <= 0xef) {
      count = 3;
      codePoint = first & 0x0f;
      lowest = 0x800;
    } else if (first >= 0xf0 && first <= 0xf4) {
      count = 4;
      codePoint = first & 0x07;
      lowest = 0x10000;
    } else {
      return [0, 0];
    }

    if (index + count > bytes.length) {
      return [0, 0];
    }

    for (let offset: number = 1; offset < count; offset++) {
      const next: number = bytes[index + offset] as number;

      if ((next & 0xc0) !== 0x80) {
        return [0, 0];
      }

      codePoint = (codePoint << 6) | (next & 0x3f);
    }

    if (
      codePoint < lowest ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return [0, 0];
    }

    return [codePoint, count];
  }

  private static unitsToString(units: Uint16Array, length: number): string {
    let text: string = "";
    const chunk: number = 8192;

    for (let start: number = 0; start < length; start += chunk) {
      text += String.fromCharCode.apply(
        null,
        Array.from(units.subarray(start, Math.min(length, start + chunk))),
      );
    }

    return text;
  }

  /*
   * A text as values are looked for in it: in lower case - a parser writes
   * a host so, and a value in another case is no less the secret - and a
   * space as "+", as a form writes it, character for character, so a place
   * in it is the same place in the text. A character whose lower case is
   * longer (İ) is kept as it is.
   */
  private static fold(text: string): string {
    let lowered: string = text.toLowerCase();

    if (lowered.length !== text.length) {
      lowered = "";

      for (let index: number = 0; index < text.length; index++) {
        const unit: string = text.charAt(index);
        const lower: string = unit.toLowerCase();

        lowered += lower.length === 1 ? lower : unit;
      }
    }

    return lowered.indexOf(" ") === -1 ? lowered : lowered.split(" ").join("+");
  }

  /*
   * A value as it is looked for in a text: as it was written, and as a URL
   * parser leaves it - without tabs and line breaks, without what surrounds
   * it, and with each backslash a slash, as it writes one in the path of an
   * http or https URL - each folded, each long enough to be hidden.
   *
   * And each as the readings of a text read it (readEscaped), one level and
   * two: a value that holds what reads as an escape ("%19", "\n", "&amp;")
   * keeps it as written where a URL leaves it so, while a character beside
   * it is escaped ("Zq%20%19"), and the reading of that text reads both.
   */
  private static getTextForms(value: string): Array<string> {
    const forms: Array<string> = [];

    const add: (form: string) => void = (form: string): void => {
      if (
        MonitorSecretValueRedaction.isLongEnoughToHide(form) &&
        !forms.includes(form)
      ) {
        forms.push(form);
      }
    };

    const asParsed: string = value.replace(/[\t\n\r]/g, "");
    // A path ends at its query or fragment: a backslash after it stays.
    const pathEnd: number = asParsed.search(/[?#]/);
    const asPath: string =
      pathEnd === -1
        ? asParsed.split("\\").join("/")
        : asParsed.slice(0, pathEnd).split("\\").join("/") +
          asParsed.slice(pathEnd);

    for (const written of [
      value,
      value.trim(),
      asParsed,
      asParsed.trim(),
      asPath,
      asPath.trim(),
      asParsed.split("\\").join("/"),
    ]) {
      if (!MonitorSecretValueRedaction.isLongEnoughToHide(written)) {
        continue;
      }

      const folded: string = MonitorSecretValueRedaction.fold(written);

      add(folded);

      let read: string = folded;

      for (let level: number = 0; level < ESCAPE_LEVELS; level++) {
        const reading: TextReading | null =
          MonitorSecretValueRedaction.readEscaped(read);

        if (!reading) {
          break;
        }

        read = reading.text;
        add(read);
      }
    }

    return forms;
  }

  /*
   * A value's base64 forms, wherever it starts in the encoded bytes - at
   * the start, or one or two bytes in, as "user:" before a password puts
   * it - in the standard and the URL-safe alphabets. Of each, the letters
   * only the value's own bytes make (the first and last can carry a
   * neighbour's bits), and what follows them when the value ends the
   * encoded text, with its padding or without.
   */
  private static getBase64Forms(value: string): Array<Base64Form> {
    const bytes: Buffer = Buffer.from(value, "utf8");
    const forms: Array<Base64Form> = [];

    for (let shift: number = 0; shift < 3; shift++) {
      const encoded: string = Buffer.concat([
        Buffer.alloc(shift),
        bytes,
      ]).toString("base64");
      const start: number = Math.ceil((8 * shift) / 6);
      const end: number = Math.floor((8 * (shift + bytes.length)) / 6);

      if (end - start < MINIMUM_BASE64_LENGTH) {
        continue;
      }

      for (const alphabet of [
        encoded,
        MonitorSecretValueRedaction.urlSafe(encoded),
      ]) {
        const tail: string = alphabet.slice(end);
        const unpadded: string = tail.replace(/[=]+$/, "");
        const tails: Array<string> = [];

        for (const candidate of [tail, unpadded]) {
          const folded: string = MonitorSecretValueRedaction.fold(candidate);

          if (folded && !tails.includes(folded)) {
            tails.push(folded);
          }
        }

        const form: Base64Form = {
          core: MonitorSecretValueRedaction.fold(alphabet.slice(start, end)),
          tails: tails,
        };

        if (
          !forms.some((known: Base64Form): boolean => {
            return (
              known.core === form.core &&
              known.tails.join("\u0000") === form.tails.join("\u0000")
            );
          })
        ) {
          forms.push(form);
        }
      }
    }

    return forms;
  }

  private static urlSafe(encoded: string): string {
    return encoded.split("+").join("-").split("/").join("_");
  }

  // A value as text: a string, or a URL, host or address OneUptime holds.
  private static toText(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "object") {
      const envelope: JSONObject = value as JSONObject;

      if (envelope["_type"] && typeof envelope["value"] === "string") {
        return envelope["value"] as string;
      }

      const text: string = String(value);

      return text === "[object Object]" ? "" : text;
    }

    return String(value);
  }

  // A text that is a JSON object or array, by its first character.
  private static looksLikeJsonContainer(text: string): boolean {
    const first: string = text.trimStart().charAt(0);

    return first === "{" || first === "[";
  }

  private static isPlainObject(value: unknown): boolean {
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  }
}
