import ScrubJsonTextUtil, {
  MAX_JSON_TEXTS_INSIDE_STRINGS,
  ScrubJsonTexts,
} from "./ScrubJsonText";
import {
  SCRUB_MAX_VALUE_DEPTH,
  ScrubNestedValuesAllowance,
} from "./ScrubNestedValues";

/*
 * A SENSITIVE ATTRIBUTE KEYS RULE OVER A JSON TEXT: THE SECRETS UNDER ITS
 * KEYS HIDDEN, EVERYTHING ELSE AS IT WAS WRITTEN.
 *
 * A Sensitive Attribute Keys rule (App/FeatureSet/Telemetry/Services/
 * LogScrubRuleService.ts and TraceScrubRuleService.ts) hides every text
 * under a key that looks secret: an attribute's own key, a key inside a
 * list or a map value (ScrubNestedValues.ts), and a key of a log body that
 * is the JSON text of a list or a map (#6513). It did not read the keys of
 * a JSON text held in a string (#8993): an attribute such as
 * `http.request.body` = `{"password":"hunter2"}`, an AI call's messages, a
 * Fluentd record's array field, or a string inside a body that is JSON of
 * its own - a Fluentd/docker `log` field, a Kubernetes object's last
 * applied configuration. The attribute's own key names no secret, so the
 * password was stored as sent, while a pattern rule did read such texts as
 * JSON (ScrubJsonText.ts, #8923).
 *
 * So the rule now reads such a text as it reads the same value sent as a
 * map: every text under a key that names a secret is hidden - a key inside
 * an OTLP {key, value} pair names its value - and numbers, true, false and
 * null stay as they are. A string that is itself the JSON text of a list or
 * a map is read the same way, MAX_JSON_TEXTS_INSIDE_STRINGS deep as a
 * pattern rule reads one.
 *
 * Only what is hidden changes. The text is not parsed and written again -
 * that would turn 12345678901234567890 into 12345678901234567000, `1.50`
 * into `1.5`, an indented text into one line, keep one of two keys written
 * twice and change every escape - it is read where it is written: each
 * hidden text replaces the string it was, written as JSON writes it, and
 * every other character stays where it was. A text with nothing to hide
 * comes back as the very same string. A text that only looks like JSON -
 * `{token}`, `[password reset] for ada`, a JSON text cut short - is plain
 * text, which this rule does not read: a pattern rule does.
 *
 * Within the record's bounds, as the rest of the record is read
 * (ScrubNestedValues.ts): each list and map counts its values against what
 * the rule has left of the record's SCRUB_MAX_NESTED_VALUES_PER_RECORD,
 * and is read value by value up to SCRUB_MAX_VALUE_DEPTH levels inside the
 * JSON text it is in. A part past them - or a JSON text held in a string
 * past MAX_JSON_TEXTS_INSIDE_STRINGS - is read as its JSON text: hidden
 * whole when that text names a secret, or sits under a key that does, and
 * kept as it is otherwise. It fails closed, as a value held as text does,
 * and keeps the rest of the text.
 */

const QUOTE: number = 0x22;
const BACKSLASH: number = 0x5c;
const OPEN_MAP: number = 0x7b;
const CLOSE_MAP: number = 0x7d;
const OPEN_LIST: number = 0x5b;
const CLOSE_LIST: number = 0x5d;
const COMMA: number = 0x2c;
const COLON: number = 0x3a;

// What JSON reads as space: a space, a tab, a line feed, a return.
function isJsonSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

// What ends a number, true, false or null.
function endsScalar(code: number): boolean {
  return (
    code === COMMA ||
    code === CLOSE_MAP ||
    code === CLOSE_LIST ||
    code === COLON ||
    code === QUOTE ||
    code === OPEN_MAP ||
    code === OPEN_LIST ||
    isJsonSpace(code)
  );
}

function skipSpace(text: string, at: number): number {
  while (at < text.length && isJsonSpace(text.charCodeAt(at))) {
    at++;
  }

  return at;
}

// Where the string that opens at `at` ends: after its closing quote.
function stringEnd(text: string, at: number): number {
  let from: number = at + 1;

  for (;;) {
    const quote: number = text.indexOf('"', from);

    if (quote === -1) {
      return text.length;
    }

    // A quote after an odd run of backslashes is escaped.
    let backslashes: number = 0;

    while (text.charCodeAt(quote - 1 - backslashes) === BACKSLASH) {
      backslashes++;
    }

    if (backslashes % 2 === 0) {
      return quote + 1;
    }

    from = quote + 1;
  }
}

function scalarEnd(text: string, at: number): number {
  let end: number = at + 1;

  while (end < text.length && !endsScalar(text.charCodeAt(end))) {
    end++;
  }

  return end;
}

// The text a string token stands for: its escapes read.
function readString(text: string, start: number, end: number): string {
  const written: string = text.slice(start + 1, end - 1);

  return written.indexOf("\\") === -1
    ? written
    : (JSON.parse(text.slice(start, end)) as string);
}

/*
 * Whether the string token at `start` may stand for the JSON text of a
 * list or a map: past the spaces it opens with, it opens one - or an escape
 * comes first, which may stand for a space or a bracket. Cheap, and a
 * string it says no to is not one.
 */
function mayHoldJsonListOrMap(
  text: string,
  start: number,
  end: number,
): boolean {
  let at: number = start + 1;

  while (at < end - 1 && text.charCodeAt(at) === 0x20) {
    at++;
  }

  const code: number = text.charCodeAt(at);

  return code === OPEN_MAP || code === OPEN_LIST || code === BACKSLASH;
}

/*
 * The lists and maps of a JSON text, in the order they open: where each
 * starts, where it ends (after its closing bracket) and how many values it
 * holds - a list's items, a map's entries. Read once, in one pass and
 * without recursion, so a rule knows a list or map's size before it reads
 * inside it, and steps over one it does not read. One nested deeper than a
 * rule reads value by value is not kept: nothing asks about it.
 */
class JsonTextStructure {
  public count: number = 0;
  public starts: Int32Array = new Int32Array(16);
  public ends: Int32Array = new Int32Array(16);
  public sizes: Int32Array = new Int32Array(16);

  // Only from a JSON text JSON.parse takes: the text of a list or a map.
  public constructor(jsonText: string) {
    const length: number = jsonText.length;
    // The lists and maps open around `at`: each one's number, or -1 unkept.
    const open: Array<number> = [];
    let at: number = 0;

    while (at < length) {
      const code: number = jsonText.charCodeAt(at);

      if (isJsonSpace(code) || code === COLON) {
        at++;
        continue;
      }

      if (code === COMMA) {
        this.countAnother(open);
        at++;
        continue;
      }

      if (code === CLOSE_MAP || code === CLOSE_LIST) {
        const closed: number | undefined = open.pop();

        if (closed !== undefined && closed >= 0) {
          this.ends[closed] = at + 1;
        }

        at++;
        continue;
      }

      // A value starts here - or a key, which starts its map's entry.
      this.countFirst(open);

      if (code === OPEN_MAP || code === OPEN_LIST) {
        // Its level: how many lists and maps it sits inside.
        open.push(open.length <= SCRUB_MAX_VALUE_DEPTH ? this.keep(at) : -1);
        at++;
        continue;
      }

      at = code === QUOTE ? stringEnd(jsonText, at) : scalarEnd(jsonText, at);
    }
  }

  // The number of the list or map that opens at `start`.
  public at(start: number): number {
    let low: number = 0;
    let high: number = this.count - 1;

    while (low < high) {
      const middle: number = (low + high) >> 1;

      if (this.starts[middle]! < start) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
  }

  private keep(start: number): number {
    if (this.count === this.starts.length) {
      this.starts = grown(this.starts);
      this.ends = grown(this.ends);
      this.sizes = grown(this.sizes);
    }

    const kept: number = this.count++;

    this.starts[kept] = start;
    this.ends[kept] = start + 1;
    this.sizes[kept] = 0;

    return kept;
  }

  // The first value of the list or map around: it holds one.
  private countFirst(open: Array<number>): void {
    const around: number | undefined = open[open.length - 1];

    if (around !== undefined && around >= 0 && this.sizes[around] === 0) {
      this.sizes[around] = 1;
    }
  }

  // A comma: one more value in the list or map around.
  private countAnother(open: Array<number>): void {
    const around: number | undefined = open[open.length - 1];

    if (around !== undefined && around >= 0) {
      this.sizes[around]!++;
    }
  }
}

function grown(list: Int32Array): Int32Array {
  const larger: Int32Array = new Int32Array(list.length * 2);

  larger.set(list);

  return larger;
}

export interface ScrubJsonKeysRule {
  // Whether a key names a secret: the rule's key pattern.
  isSensitiveKey: (key: string) => boolean;
  // What the rule makes of a text under such a key: its scrub action.
  hideText: (text: string) => string;
  /*
   * What the rule has left of its record's allowance
   * (SCRUB_MAX_NESTED_VALUES_PER_RECORD), counted down as it reads: one for
   * each rule and record, shared by every JSON text of the record it reads.
   */
  allowance: ScrubNestedValuesAllowance;
  // The record's: which of its texts are JSON, worked out once.
  jsonTexts: ScrubJsonTexts;
}

/*
 * One rule over one JSON text: what it hides, as replacements of the parts
 * of the text they hide - in the order of the text, none inside another.
 */
class JsonKeysReading {
  private readonly jsonText: string;
  private readonly structure: JsonTextStructure;
  private readonly rule: ScrubJsonKeysRule;
  // How many JSON texts, each a string of the one around it, this one is in.
  private readonly jsonDepth: number;
  private readonly starts: Array<number> = [];
  private readonly ends: Array<number> = [];
  private readonly hidden: Array<string> = [];

  public constructor(data: {
    jsonText: string;
    structure: JsonTextStructure;
    rule: ScrubJsonKeysRule;
    jsonDepth: number;
  }) {
    this.jsonText = data.jsonText;
    this.structure = data.structure;
    this.rule = data.rule;
    this.jsonDepth = data.jsonDepth;
  }

  // The JSON text with each part this read hides replaced.
  public written(): string {
    if (this.starts.length === 0) {
      return this.jsonText;
    }

    const pieces: Array<string> = [];
    let copiedUpTo: number = 0;

    for (let index: number = 0; index < this.starts.length; index++) {
      pieces.push(
        this.jsonText.slice(copiedUpTo, this.starts[index]),
        // Written as JSON writes a string: still JSON, whatever it holds.
        JSON.stringify(this.hidden[index]),
      );
      copiedUpTo = this.ends[index]!;
    }

    pieces.push(this.jsonText.slice(copiedUpTo));

    return pieces.join("");
  }

  /*
   * The value at `at`, `depth` levels inside the JSON text: read, and its
   * end returned. `underSecret`: it sits under a key that names a secret.
   */
  public readValue(at: number, depth: number, underSecret: boolean): number {
    const text: string = this.jsonText;
    const code: number = text.charCodeAt(at);

    if (code === QUOTE) {
      const end: number = stringEnd(text, at);

      if (underSecret) {
        this.replace(at, end, this.rule.hideText(readString(text, at, end)));
      } else {
        this.readStringAsJsonText(at, end);
      }

      return end;
    }

    if (code === OPEN_MAP || code === OPEN_LIST) {
      return this.readListOrMap(at, depth, underSecret);
    }

    // A number, true, false or null: kept, under a secret key too.
    return scalarEnd(text, at);
  }

  private replace(start: number, end: number, hidden: string): void {
    this.starts.push(start);
    this.ends.push(end);
    this.hidden.push(hidden);
  }

  private readListOrMap(
    at: number,
    depth: number,
    underSecret: boolean,
  ): number {
    const text: string = this.jsonText;
    const index: number = this.structure.at(at);
    const end: number = this.structure.ends[index]!;
    const size: number = this.structure.sizes[index]!;

    if (size === 0) {
      return end;
    }

    if (
      depth >= SCRUB_MAX_VALUE_DEPTH ||
      size > this.rule.allowance.remaining
    ) {
      // Past the bounds: read as its JSON text, as it is written here.
      const written: string = text.slice(at, end);

      if (underSecret || namesSecret(written, this.rule)) {
        this.replace(at, end, this.rule.hideText(written));
      }

      return end;
    }

    this.rule.allowance.remaining -= size;

    if (text.charCodeAt(at) === OPEN_LIST) {
      let next: number = at + 1;

      for (let item: number = 0; item < size; item++) {
        next = this.readValue(skipSpace(text, next), depth + 1, underSecret);
        // Past the comma, or the closing bracket after the last.
        next = skipSpace(text, next) + 1;
      }

      return end;
    }

    // A map: its keys first, so a pair's key is known before its value.
    const keys: Array<string> = [];
    const valueStarts: Array<number> = [];
    let next: number = at + 1;

    for (let entry: number = 0; entry < size; entry++) {
      const keyStart: number = skipSpace(text, next);
      const keyEnd: number = stringEnd(text, keyStart);
      // Past the colon.
      const valueStart: number = skipSpace(text, skipSpace(text, keyEnd) + 1);

      keys.push(readString(text, keyStart, keyEnd));
      valueStarts.push(valueStart);
      next = skipSpace(text, this.valueEnd(valueStart)) + 1;
    }

    const isSensitivePair: boolean =
      !underSecret && this.isSensitivePair(keys, valueStarts);

    for (let entry: number = 0; entry < size; entry++) {
      const key: string = keys[entry]!;

      this.readValue(
        valueStarts[entry]!,
        depth + 1,
        underSecret ||
          (isSensitivePair && key === "value") ||
          this.rule.isSensitiveKey(key),
      );
    }

    return end;
  }

  private valueEnd(at: number): number {
    const code: number = this.jsonText.charCodeAt(at);

    if (code === QUOTE) {
      return stringEnd(this.jsonText, at);
    }

    if (code === OPEN_MAP || code === OPEN_LIST) {
      return this.structure.ends[this.structure.at(at)]!;
    }

    return scalarEnd(this.jsonText, at);
  }

  /*
   * A key-value pair as OTLP writes one - {"key": "db.password", "value":
   * {...}} - whose `key` names a secret: its `value` is the secret. A key
   * written twice is read both times.
   */
  private isSensitivePair(
    keys: Array<string>,
    valueStarts: Array<number>,
  ): boolean {
    let hasValue: boolean = false;
    let keyNamesSecret: boolean = false;

    for (let entry: number = 0; entry < keys.length; entry++) {
      const key: string = keys[entry]!;
      const valueStart: number = valueStarts[entry]!;

      if (key === "value") {
        hasValue = true;
      } else if (
        key === "key" &&
        this.jsonText.charCodeAt(valueStart) === QUOTE &&
        this.rule.isSensitiveKey(
          readString(
            this.jsonText,
            valueStart,
            stringEnd(this.jsonText, valueStart),
          ),
        )
      ) {
        keyNamesSecret = true;
      }
    }

    return hasValue && keyNamesSecret;
  }

  /*
   * A string under no secret key, which may be a JSON text of its own: read
   * as one, a level deeper, and written back when the rule hid something
   * in it.
   */
  private readStringAsJsonText(start: number, end: number): void {
    const text: string = this.jsonText;

    if (!mayHoldJsonListOrMap(text, start, end)) {
      return;
    }

    const inside: string = readString(text, start, end);

    if (this.jsonDepth >= MAX_JSON_TEXTS_INSIDE_STRINGS) {
      /*
       * Deeper than a rule reads as JSON: read as its JSON text, hidden
       * whole when that text names a secret.
       */
      if (
        ScrubJsonTextUtil.mayBeJsonListOrMap(inside) &&
        this.rule.jsonTexts.isJsonListOrMap(inside) &&
        namesSecret(inside, this.rule)
      ) {
        this.replace(start, end, this.rule.hideText(inside));
      }

      return;
    }

    const scrubbed: string = hideInJsonText(
      inside,
      this.rule,
      this.jsonDepth + 1,
    );

    if (scrubbed !== inside) {
      this.replace(start, end, scrubbed);
    }
  }
}

/*
 * Whether a JSON text read as one text - a part past the bounds - names a
 * secret anywhere: its words as written, or, when it holds an escape, as
 * they read (`pass\u0077ord`), as the same value would be written as JSON
 * - a value held as its JSON text is (ScrubNestedValues.ts).
 */
function namesSecret(jsonText: string, rule: ScrubJsonKeysRule): boolean {
  if (rule.isSensitiveKey(jsonText)) {
    return true;
  }

  if (jsonText.indexOf("\\") === -1) {
    return false;
  }

  try {
    return rule.isSensitiveKey(JSON.stringify(JSON.parse(jsonText)));
  } catch {
    // Not a JSON text: none reaches here.
    return false;
  }
}

/*
 * Whether a text may be the JSON text of a list or a map with a key that
 * names a secret. A key is written as it is but for its escapes - JSON
 * escapes none of the letters a secret is named by - so a text with no
 * escape that names no secret anywhere holds no such key, nor a JSON text
 * in a string, which would need escaped quotes: most texts, read no
 * further.
 */
function couldNameSecret(text: string, rule: ScrubJsonKeysRule): boolean {
  return (
    ScrubJsonTextUtil.mayBeJsonListOrMap(text) &&
    (text.indexOf("\\") !== -1 || rule.isSensitiveKey(text))
  );
}

/*
 * One rule over a text a record stores, `jsonDepth` JSON texts inside the
 * one it was handed: the JSON text of a list or a map read key by key,
 * anything else kept.
 */
function hideInJsonText(
  text: string,
  rule: ScrubJsonKeysRule,
  jsonDepth: number,
): string {
  if (!couldNameSecret(text, rule) || !rule.jsonTexts.isJsonListOrMap(text)) {
    return text;
  }

  const structure: JsonTextStructure = new JsonTextStructure(text);
  // The list or map the text is: the first one in it.
  const size: number = structure.sizes[0]!;

  if (size === 0) {
    return text;
  }

  if (size > rule.allowance.remaining) {
    /*
     * Past what the record has left: read as one text, hidden whole when
     * it names a secret.
     */
    return namesSecret(text, rule) ? rule.hideText(text) : text;
  }

  const reading: JsonKeysReading = new JsonKeysReading({
    jsonText: text,
    structure: structure,
    rule: rule,
    jsonDepth: jsonDepth,
  });

  reading.readValue(structure.starts[0]!, 0, false);

  const scrubbed: string = reading.written();

  if (scrubbed !== text) {
    // Still JSON: the rules after this read it without parsing it again.
    rule.jsonTexts.rememberJson(scrubbed);
  }

  return scrubbed;
}

export default class ScrubJsonKeysUtil {
  /*
   * A Sensitive Attribute Keys rule over one text a record stores that no
   * secret key names - an attribute's value, a text inside a list or a map
   * value, a log body: when it is the JSON text of a list or a map, the
   * texts under each key inside it that names a secret are hidden, the JSON
   * texts its strings hold read the same way, as the module comment says.
   * Any other text is kept: this rule reads no free text. The very text
   * comes back when nothing was hidden.
   */
  public static hideUnderSensitiveKeys(
    text: string,
    rule: ScrubJsonKeysRule,
  ): string {
    return hideInJsonText(text, rule, 0);
  }
}
