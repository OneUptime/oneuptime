import { describe, expect, test } from "@jest/globals";
import DataConfidence from "../../../Types/DataSecurity/DataConfidence";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "../../../Types/DataSecurity/DataTypeCatalog";
import {
  DataTypeDetector,
  matchesFieldShape,
} from "../../../Utils/DataSecurity/Detector";
import BUILT_IN_DETECTORS, {
  getBuiltInDetectorsOf,
} from "../../../Utils/DataSecurity/Detectors/Index";
import { getHintedDataTypeIds } from "../../../Utils/DataSecurity/FieldNameHints";
import {
  FULLWIDTH_FORMS,
  NUMBER_DASHES,
} from "../../../Utils/DataSecurity/FullwidthForms";
import { QUERY_NAME_DATA_TYPE_ID } from "../../../Utils/DataSecurity/QueryStringNames";
import { sha256 } from "../../../Utils/DataSecurity/Sha256";
import {
  findDetectorRanges,
  TextRange,
} from "../../../Utils/DataSecurity/TextReadings";
import {
  findSensitiveValues,
  TextMatch,
  TextScanOptions,
} from "../../../Utils/DataSecurity/TextScanner";
import CharacterSet from "../../../Utils/LinearRegExp/CharacterSet";
import { parsePattern } from "../../../Utils/LinearRegExp/Parser";
import { SyntaxNode } from "../../../Utils/LinearRegExp/Syntax";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * HOW OFTEN THE SCANNER IS RIGHT: A LABELLED CORPUS OF EVERY TYPE.
 *
 * For every built-in type found by value, two values in realistic text (a
 * log line and a JSON document) and two near misses: the same text with the
 * value a check digit off, a character longer, inside a longer token, or
 * without the words it needs. Every built-in detector then scans every
 * text, and each High or Medium finding is right only when it is the
 * labelled type on the labelled value. Per type, precision - right findings
 * over all High and Medium findings of that type - must be at least 0.95;
 * over the corpus, recall - labelled values found as their type - at least
 * 0.9.
 *
 * Values are made here, never copied from anyone: drawn at random from the
 * shape of a type's own detector, with the check characters its validator
 * asks for found by trying them, and the structured ones (IBANs, Bitcoin
 * keys, JWTs, connection strings, passport numbers...) put together from
 * random parts. No secret is written in this file; each is assembled when
 * the test runs, so no scanner reading the source sees one.
 *
 * Each type draws from a stream of its own, seeded from its id (#10468).
 * All types once shared one stream, so a change to one detector - how many
 * draws its type took - redrew every type after it in the catalog, and
 * checks failed in types the change never touched. And a near miss whose
 * characters happen to pass another type's checks - a PESEL a check digit
 * off that passes CUIT's mod 11 - is a real value of that type, not a
 * precision fault: it is drawn again (isTakenByAnotherType). A change to a
 * detector now redraws its own type alone, and every type holds whatever
 * the corpus seed: of the seeds 1 to 100, 99 pass every check here, and the
 * last a UK passport value whose digits pass a Hong Kong ID's check digit.
 */

interface Labelled {
  dataTypeId: string;
  text: string;
  value: string;
  /*
   * The field the text is the value of, when it is one - an attribute's
   * key: Data Security reads its name as the words a value needs, and a
   * whole value by the shape its type takes there (#11383, findAsRead).
   */
  field?: string | undefined;
}

interface CorpusEntry {
  positives: Array<Labelled>;
  nearMisses: Array<Labelled>;
}

/*
 * The seed the corpus is drawn from. Each type draws from a stream of its
 * own, seeded from this and the type's id (seedOf), so a change to one
 * detector - its pattern's shape, what its validator takes - changes how
 * many draws that type uses and redraws no other type's values (#10468).
 */
const CORPUS_SEED: number = 20_261_027;

// The seed of one type's stream: the first 32 bits of a hash of the corpus seed and the type's id.
function seedOf(corpusSeed: number, dataTypeId: string): number {
  const digest: Uint8Array = sha256(
    new TextEncoder().encode(`${corpusSeed}:${dataTypeId}`),
  );

  return (
    ((digest[0]! << 24) |
      (digest[1]! << 16) |
      (digest[2]! << 8) |
      digest[3]!) >>>
    0
  );
}

// The stream of the type being drawn: buildEntry starts a new one for each type.
let random: SeededRandom = seededRandom(CORPUS_SEED);

// How many values a drawn type draws, at most, to find two with a near miss each.
const DRAW_ATTEMPTS: number = 400;

// How many times, at most, a built type is put together from new parts.
const BUILD_ATTEMPTS: number = 20;

const DIGITS: string = "0123456789";
const UPPER: string = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER: string = "abcdefghijklmnopqrstuvwxyz";
const ALNUM: string = UPPER + LOWER + DIGITS;
const URL_SAFE: string = ALNUM + "-_";
const BASE64_ALPHABET: string = ALNUM + "+/";
const HEX: string = "0123456789abcdef";
const ALPHANUMERIC_CHARACTER: RegExp = /[A-Za-z0-9]/;
const KEYWORD_OF_WORDS: RegExp = /^[a-z][a-z ]*[a-z]$/;
const BASE58_ALPHABET: string =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function fake(alphabet: string, length: number): string {
  let text: string = "";

  for (let index: number = 0; index < length; index++) {
    text += alphabet[random(alphabet.length)];
  }

  return text;
}

function randomBytes(length: number): Uint8Array {
  const bytes: Uint8Array = new Uint8Array(length);

  for (let index: number = 0; index < length; index++) {
    bytes[index] = random(256);
  }

  return bytes;
}

function base64Url(text: string): string {
  return btoa(text)
    .split("+")
    .join("-")
    .split("/")
    .join("_")
    .split("=")
    .join("");
}

function base58(bytes: Uint8Array): string {
  const digits: Array<number> = [];

  for (const byte of bytes) {
    let carry: number = byte;

    for (let index: number = 0; index < digits.length; index++) {
      carry += digits[index]! * 256;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }

    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let text: string = "";

  for (
    let index: number = 0;
    index < bytes.length && bytes[index] === 0;
    index++
  ) {
    text += "1";
  }

  for (let index: number = digits.length - 1; index >= 0; index--) {
    text += BASE58_ALPHABET[digits[index]!];
  }

  return text;
}

// Base58Check: the payload and the first four bytes of its double SHA-256.
function base58Check(payload: Uint8Array): string {
  const checksum: Uint8Array = sha256(sha256(payload)).slice(0, 4);

  return base58(
    Uint8Array.from([...Array.from(payload), ...Array.from(checksum)]),
  );
}

// A country's IBAN with the check digits ISO 13616 gives its BBAN.
function iban(country: string, bban: string): string {
  let digits: string = "";

  for (const character of bban + country + "00") {
    const code: number = character.charCodeAt(0);

    digits += code >= 65 && code <= 90 ? String(code - 55) : character;
  }

  let remainder: number = 0;

  for (const digit of digits) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }

  return country + String(98 - remainder).padStart(2, "0") + bban;
}

function percentEncoded(base64: string): string {
  return base64
    .split("+")
    .join("%2B")
    .split("/")
    .join("%2F")
    .split("=")
    .join("%3D");
}

function logLine(key: string, value: string): string {
  return `2026-10-27T10:15:02Z INFO record updated ${key}=${value} status=ok`;
}

function jsonDocument(key: string, value: string): string {
  return `{"${key}": "${value}", "batch": "nightly"}`;
}

function labelled(
  dataTypeId: string,
  text: string,
  value: string,
  field?: string | undefined,
): Labelled {
  return field === undefined
    ? { dataTypeId, text, value }
    : { dataTypeId, text, value, field };
}

/*
 * What Data Security finds in a text: as it is, or as a field's value when
 * it is one (#11383) - with the field's name for the words a value needs
 * (TextScanOptions.hintedDataTypeIds), and, for a type the name hints that
 * no detector found in it, the whole value when it has the shape the type
 * takes in such a field (matchesFieldShape), Medium, as FieldClassifier
 * counts it.
 */
function findAsRead(
  text: string,
  options: TextScanOptions = {},
  field?: string | undefined,
): Array<TextMatch> {
  if (field === undefined) {
    return findSensitiveValues(text, options);
  }

  const hinted: ReadonlySet<string> = getHintedDataTypeIds(field);
  const matches: Array<TextMatch> = findSensitiveValues(text, {
    ...options,
    hintedDataTypeIds: hinted,
  });
  const whole: string = text.trim();
  const start: number = text.length - text.trimStart().length;

  for (const detector of (options.detectors ||
    BUILT_IN_DETECTORS) as ReadonlyArray<DataTypeDetector>) {
    if (
      !hinted.has(detector.dataTypeId) ||
      !detector.fieldValuePattern ||
      matches.some((match: TextMatch): boolean => {
        return match.dataTypeId === detector.dataTypeId;
      })
    ) {
      continue;
    }

    const normalized: string | null = matchesFieldShape(detector, whole);

    if (normalized !== null) {
      matches.push({
        dataTypeId: detector.dataTypeId,
        start,
        end: start + whole.length,
        normalized,
        confidence: DataConfidence.Medium,
        isTestValue: Boolean(detector.isTestValue?.(normalized)),
      });
    }
  }

  return matches;
}

/*
 * A random string of the shape a pattern matches. Look-arounds and
 * assertions add nothing - the detector itself then says whether the
 * string, in its text, is the thing.
 */
const PREFERRED_CHARACTERS: string = ALNUM;

function charactersOf(set: CharacterSet, negate: boolean): Array<string> {
  const has: (code: number) => boolean = (code: number): boolean => {
    return set.has(code) !== negate;
  };
  const preferred: Array<string> = PREFERRED_CHARACTERS.split("").filter(
    (character: string) => {
      return has(character.charCodeAt(0));
    },
  );

  if (preferred.length > 0) {
    return preferred;
  }

  const printable: Array<string> = [];

  for (let code: number = 0x20; code < 0x7f; code++) {
    if (has(code)) {
      printable.push(String.fromCharCode(code));
    }
  }

  return printable;
}

function draw(node: SyntaxNode): string {
  switch (node.kind) {
    case "Empty":
    case "Assertion":
    case "Lookaround":
      return "";
    case "Character":
      return String.fromCharCode(node.codeUnit);
    case "Set": {
      const characters: Array<string> = charactersOf(node.set, node.negate);

      return characters.length > 0
        ? characters[random(characters.length)]!
        : "";
    }
    case "Group":
      return draw(node.body);
    case "Repeat": {
      const most: number = Number.isFinite(node.max) ? node.max : node.min + 8;
      const times: number = node.min + random(most - node.min + 1);
      let text: string = "";

      for (let index: number = 0; index < times; index++) {
        text += draw(node.body);
      }

      return text;
    }
    case "Alternation":
      return draw(node.options[random(node.options.length)]!);
    case "Sequence":
      return node.items.map(draw).join("");
  }

  return "";
}

// Whether the type's own detectors find exactly this value, sure enough to count.
/*
 * A type's own reading of a text: its detectors - and for a person's name,
 * which has none, a URL's query parameter named for one (#11034).
 */
function ownReadingOf(dataTypeId: string): TextScanOptions {
  return {
    detectors: getBuiltInDetectorsOf(dataTypeId),
    readsQueryStringNames: dataTypeId === QUERY_NAME_DATA_TYPE_ID,
  };
}

function isFoundAlone(
  dataTypeId: string,
  text: string,
  value: string,
  field?: string | undefined,
): boolean {
  const start: number = text.indexOf(value);

  return findAsRead(text, ownReadingOf(dataTypeId), field).some(
    (match: TextMatch) => {
      return (
        match.dataTypeId === dataTypeId &&
        match.start <= start &&
        match.end >= start + value.length &&
        match.confidence !== DataConfidence.Low &&
        !match.isTestValue
      );
    },
  );
}

// Whether the type's own detectors find anything at all in the text.
function isRefusedAlone(
  dataTypeId: string,
  text: string,
  field?: string | undefined,
): boolean {
  return findAsRead(text, ownReadingOf(dataTypeId), field).every(
    (match: TextMatch) => {
      return match.dataTypeId !== dataTypeId || match.isTestValue;
    },
  );
}

function isSure(match: TextMatch): boolean {
  return match.confidence !== DataConfidence.Low && !match.isTestValue;
}

/*
 * Types the engine cannot tell apart by design - the same shape next to
 * the same words. A finding of `found` on an example labelled `label`
 * counts neither for nor against `found`; the label's own recall still
 * counts the example as missed. Each is a known limit, with why.
 */
const KNOWN_CONFUSIONS: ReadonlyArray<{
  found: string;
  label: string;
  reason: string;
}> = [
  {
    found: "phone-number",
    label: "uk-nhs-number",
    reason:
      "An NHS number written 3-3-4 with dashes has a North American phone number's shape, so one whose check digit fails is still that shape.",
  },
  {
    found: "passport-number",
    label: "uk-passport",
    reason:
      'A passport number of no country is letters and digits beside the word passport, which "uk passport" holds, so a UK passport number a digit short is still one.',
  },
];

function isKnownConfusion(found: string, label: string): boolean {
  return KNOWN_CONFUSIONS.some(
    (confusion: { found: string; label: string }) => {
      return confusion.found === found && confusion.label === label;
    },
  );
}

/*
 * Whether the scanner, every detector running, finds another type in the
 * text, sure enough to count. A near miss whose characters happen to pass
 * another type's checks - a PESEL a check digit off that passes CUIT's mod
 * 11, a CNP that passes Luhn, a token whose digits are a card number's - is
 * a real value of that type, not a precision fault, so it is drawn again
 * (#10468). A type another type takes every near miss of is then short of
 * them, and a near miss built that way every time is kept, for the
 * precision test to say.
 */
function isTakenByAnotherType(
  dataTypeId: string,
  text: string,
  field?: string | undefined,
): boolean {
  return findAsRead(text, {}, field).some((match: TextMatch) => {
    return (
      isSure(match) &&
      match.dataTypeId !== dataTypeId &&
      !isKnownConfusion(match.dataTypeId, dataTypeId)
    );
  });
}

function classOf(character: string): string {
  if (DIGITS.includes(character)) {
    return DIGITS;
  }

  return UPPER.includes(character) ? UPPER : LOWER;
}

// The value, and the value with its last one or two characters tried in turn.
function withCheckCharacters(value: string): Array<string> {
  const places: Array<number> = [];

  for (
    let index: number = value.length - 1;
    index >= 0 && places.length < 2;
    index--
  ) {
    if (ALPHANUMERIC_CHARACTER.test(value[index]!)) {
      places.push(index);
    }
  }

  const tried: Array<string> = [value];
  const last: number | undefined = places[0];
  const before: number | undefined = places[1];

  if (last === undefined) {
    return tried;
  }

  for (const character of classOf(value[last]!)) {
    tried.push(value.slice(0, last) + character + value.slice(last + 1));
  }

  if (
    before !== undefined &&
    DIGITS.includes(value[last]!) &&
    DIGITS.includes(value[before]!)
  ) {
    for (const first of DIGITS) {
      for (const second of DIGITS) {
        const characters: Array<string> = value.split("");

        characters[before] = first;
        characters[last] = second;
        tried.push(characters.join(""));
      }
    }
  }

  return tried;
}

// A keyword its detectors look for, written as words; "value" for one with none.
const KEYWORD_OVERRIDES: Readonly<Record<string, string>> = {
  // Its pattern needs one of these words right before the date.
  "card-expiration-date": "expiry",
};

function keywordOf(dataTypeId: string): string {
  if (KEYWORD_OVERRIDES[dataTypeId]) {
    return KEYWORD_OVERRIDES[dataTypeId]!;
  }

  for (const detector of getBuiltInDetectorsOf(dataTypeId)) {
    for (const keyword of detector.keywords || []) {
      if (KEYWORD_OF_WORDS.test(keyword)) {
        return keyword;
      }
    }
  }

  return "value";
}

const TEXT_FORMS: Array<(key: string, value: string) => string> = [
  logLine,
  jsonDocument,
];

// The shapes of a type's detectors' patterns, to draw values from.
function shapesOf(dataTypeId: string): Array<SyntaxNode> {
  const shapes: Array<SyntaxNode> = [];

  for (const detector of getBuiltInDetectorsOf(dataTypeId)) {
    /*
     * A pattern of Unicode classes (the u flag) is one LinearRegExp's parser
     * reads as ASCII: \p{L} as the letters "p{L}". What it finds is labelled
     * apart (READING_CASES).
     */
    if (detector.pattern.unicode) {
      continue;
    }

    try {
      shapes.push(
        parsePattern(detector.pattern.source, {
          ignoreCase: detector.pattern.ignoreCase,
          multiline: detector.pattern.multiline,
          dotAll: detector.pattern.dotAll,
        }).root,
      );
    } catch {
      // A back-reference LinearRegExp cannot read: the other shapes serve.
    }
  }

  return shapes;
}

// The next character of the same kind, so a check digit is off by one.
function nextOfClass(character: string, step: number): string {
  const kind: string = classOf(character);

  return kind[(kind.indexOf(character) + step) % kind.length]!;
}

/*
 * Near misses a type's checks are about, tried before the general ones:
 * an email on an image asset's "domain", a coordinate too imprecise to
 * find a building, a webhook missing its secret, an IP address that points
 * at no one.
 */
const NEAR_MISSES_OF: Readonly<
  Record<string, (value: string) => Array<string>>
> = {
  /*
   * A private IPv4 address; a link-local IPv6 one, any IPv4 address it ends
   * in private too. A character off is mostly another public address:
   * "b45:2::3fe" is as much an address as "b45:2::3fd".
   */
  "ip-address": (value: string): Array<string> => {
    if (!value.includes(":")) {
      return [value.replace(/^[0-9]{1,3}/, "10")];
    }

    return [
      value
        .replace(/^[0-9A-Fa-f]{0,4}(?=:)/, "fe80")
        .replace(/(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/, "10.0.0.1"),
    ];
  },
  // The URL without its password: a user name alone is no secret.
  "password-in-url": (value: string): Array<string> => {
    const scheme: number = value.indexOf("://");
    const colon: number = scheme < 0 ? -1 : value.indexOf(":", scheme + 3);
    const at: number = colon < 0 ? -1 : value.indexOf("@", colon);

    return at < 0 ? [] : [value.slice(0, colon) + value.slice(at)];
  },
  // A birth month no century's PESEL has: 13 is no month, 33 or 93 either.
  "pl-pesel": (value: string): Array<string> => {
    return [value.slice(0, 2) + "13" + value.slice(4)];
  },
  // A birth month no calendar has.
  "ro-cnp": (value: string): Array<string> => {
    return [value.slice(0, 3) + "13" + value.slice(5)];
  },
  "email-address": (value: string): Array<string> => {
    return [
      value.replace(/\.[A-Za-z]{2,24}$/, ".png"),
      value[0] + ".." + value.slice(1),
    ];
  },
  geolocation: (value: string): Array<string> => {
    return [
      value.replace(/\.([0-9]{2})[0-9]{2,8}/g, ".$1"),
      value.replace(/^-?[0-9]{1,3}/, "91"),
    ];
  },
  "slack-webhook-url": (value: string): Array<string> => {
    return [
      value.replace(/\/[A-Za-z0-9]{20,120}$/, "/" + "x".repeat(8)),
      value.replace("hooks.slack.com", "hooks.slack.example"),
    ];
  },
};

/*
 * Near misses of a drawn value, in a fixed order: the type's own, a check
 * character off, one character longer, inside a longer token, one shorter,
 * and - for a type that needs them - without its words.
 */
function nearMissCandidates(
  info: DataTypeInfo,
  value: string,
  form: (key: string, value: string) => string,
): Array<string> {
  const keyword: string = keywordOf(info.id);
  const needsWords: boolean = getBuiltInDetectorsOf(info.id).some(
    (detector: DataTypeDetector) => {
      return Boolean(detector.requiresContext);
    },
  );
  const lastPlace: number = value.search(/[A-Za-z0-9][^A-Za-z0-9]*$/);
  const last: string = value[lastPlace] || "0";
  const candidates: Array<string> = (
    NEAR_MISSES_OF[info.id]?.(value) || []
  ).map((nearMiss: string) => {
    return form(keyword, nearMiss);
  });

  for (let step: number = 1; step < classOf(last).length; step++) {
    candidates.push(
      form(
        keyword,
        value.slice(0, lastPlace) +
          nextOfClass(last, step) +
          value.slice(lastPlace + 1),
      ),
    );
  }

  candidates.push(form(keyword, value + nextOfClass(last, 3)));
  candidates.push(form(keyword, nextOfClass(value[0] || "0", 5) + value));
  candidates.push(
    form(keyword, value.slice(0, lastPlace) + value.slice(lastPlace + 1)),
  );

  if (needsWords) {
    candidates.push(form("ref", value));
  }

  return candidates;
}

/*
 * The near miss of a drawn value: the first candidate its type's own
 * detectors refuse and no other type takes - or none, when every candidate
 * its own detectors refuse is another type's value.
 */
function nearMissOf(
  info: DataTypeInfo,
  value: string,
  form: (key: string, value: string) => string,
): string | undefined {
  return nearMissCandidates(info, value, form).find((text: string) => {
    return (
      isRefusedAlone(info.id, text) && !isTakenByAnotherType(info.id, text)
    );
  });
}

/*
 * Two values of the type drawn from its detectors' shapes, each in its
 * text form, with a near miss of each. A value with no near miss - every
 * candidate its own detectors refuse is another type's value, or none is
 * refused - is drawn again, so the type is short of values only when its
 * detectors take every near miss, or another type takes every one: what
 * "has two values and two near misses of every type" says.
 */
function drawnEntry(info: DataTypeInfo): CorpusEntry {
  const keyword: string = keywordOf(info.id);
  const shapes: Array<SyntaxNode> = shapesOf(info.id);
  const entry: CorpusEntry = { positives: [], nearMisses: [] };

  for (
    let attempt: number = 0;
    attempt < DRAW_ATTEMPTS && entry.positives.length < 2 && shapes.length > 0;
    attempt++
  ) {
    const drawn: string = draw(shapes[random(shapes.length)]!);
    const form: (key: string, value: string) => string =
      TEXT_FORMS[entry.positives.length]!;

    if (drawn.length === 0) {
      continue;
    }

    for (const value of withCheckCharacters(drawn)) {
      const text: string = form(keyword, value);

      if (
        entry.positives.some((positive: Labelled) => {
          return positive.value === value;
        }) ||
        !isFoundAlone(info.id, text, value)
      ) {
        continue;
      }

      const nearMiss: string | undefined = nearMissOf(info, value, form);

      if (nearMiss !== undefined) {
        entry.positives.push(labelled(info.id, text, value));
        entry.nearMisses.push(labelled(info.id, nearMiss, ""));
      }

      break;
    }
  }

  return entry;
}

/*
 * The types whose values have structure a random draw cannot hit - a
 * checksum over the whole value, JSON inside base64 - put together from
 * random parts, with near misses that break exactly that structure.
 */
const BUILT: Readonly<Record<string, () => CorpusEntry>> = {
  /*
   * A passport number of no country: two letters and seven digits, or a
   * letter and eight, beside the word. Drawn from the detector's shape -
   * six to nine letters and digits - a value almost never had the five
   * digits it asks for, so the type drew none in most streams (#10468).
   * Its near misses: the number without the word, which is all that says
   * what it is (no country's number has a check digit), and more letters
   * than a passport number has.
   */
  "passport-number": (): CorpusEntry => {
    const first: string = fake(UPPER, 2) + fake(DIGITS, 7);
    const second: string = fake(UPPER, 1) + fake(DIGITS, 8);

    return {
      positives: [
        labelled("passport-number", logLine("passport", first), first),
        labelled("passport-number", jsonDocument("passport", second), second),
      ],
      nearMisses: [
        labelled("passport-number", logLine("ref", first), ""),
        labelled(
          "passport-number",
          jsonDocument("passport", fake(UPPER, 4) + fake(DIGITS, 4)),
          "",
        ),
      ],
    };
  },
  "credit-card-number": (): CorpusEntry => {
    const card: (prefix: string) => string = (prefix: string): string => {
      const digits: string = prefix + fake(DIGITS, 15 - prefix.length);

      for (const check of DIGITS) {
        const number: string = digits + check;
        let sum: number = 0;

        for (let index: number = 0; index < 16; index++) {
          let digit: number = Number(number[15 - index]);

          if (index % 2 === 1) {
            digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
          }

          sum += digit;
        }

        if (sum % 10 === 0) {
          return number;
        }
      }

      return digits + "0";
    };
    const visa: string = card("4");
    const mastercard: string = card("53");
    const grouped: string = visa.replace(/([0-9]{4})(?=[0-9])/g, "$1 ");
    const off: string = visa.slice(0, 15) + String((Number(visa[15]) + 1) % 10);

    return {
      positives: [
        labelled(
          "credit-card-number",
          `2026-10-27T10:15:02Z INFO charged card ${grouped} amount=42.50`,
          grouped,
        ),
        labelled(
          "credit-card-number",
          jsonDocument("pan", mastercard),
          mastercard,
        ),
      ],
      nearMisses: [
        labelled(
          "credit-card-number",
          `2026-10-27T10:15:02Z INFO charged card ${off} amount=42.50`,
          "",
        ),
        labelled(
          "credit-card-number",
          jsonDocument("pan", "9" + mastercard),
          "",
        ),
      ],
    };
  },
  iban: (): CorpusEntry => {
    const german: string = iban("DE", fake(DIGITS, 18));
    const british: string = iban("GB", fake(UPPER, 4) + fake(DIGITS, 14));
    const offCheck: string =
      german.slice(0, 2) +
      String((Number(german.slice(2, 4)) + 1) % 100).padStart(2, "0") +
      german.slice(4);

    return {
      positives: [
        labelled("iban", logLine("iban", german), german),
        labelled("iban", jsonDocument("iban", british), british),
      ],
      nearMisses: [
        labelled("iban", logLine("iban", offCheck), ""),
        labelled("iban", jsonDocument("iban", british.slice(0, -1)), ""),
      ],
    };
  },
  "bitcoin-address": (): CorpusEntry => {
    const legacy: string = base58Check(
      Uint8Array.from([0, ...Array.from(randomBytes(20))]),
    );
    const script: string = base58Check(
      Uint8Array.from([5, ...Array.from(randomBytes(20))]),
    );
    const middle: number = Math.floor(legacy.length / 2);
    const corrupted: string =
      legacy.slice(0, middle) +
      (legacy[middle] === "z" ? "y" : "z") +
      legacy.slice(middle + 1);

    return {
      positives: [
        labelled("bitcoin-address", logLine("btc", legacy), legacy),
        labelled("bitcoin-address", jsonDocument("wallet", script), script),
      ],
      nearMisses: [
        labelled("bitcoin-address", logLine("btc", corrupted), ""),
        labelled("bitcoin-address", jsonDocument("wallet", "x" + script), ""),
      ],
    };
  },
  "google-service-account-key": (): CorpusEntry => {
    const keyId: string = fake(HEX, 40);
    const keyFile: (id: string) => string = (id: string): string => {
      return JSON.stringify({
        type: "service_account",
        project_id: "demo-project",
        private_key_id: id,
      });
    };
    const secondId: string = fake(HEX, 40);

    return {
      positives: [
        labelled("google-service-account-key", keyFile(keyId), keyId),
        labelled(
          "google-service-account-key",
          JSON.stringify({ credentials: keyFile(secondId) }),
          secondId,
        ),
      ],
      nearMisses: [
        labelled("google-service-account-key", keyFile(keyId.slice(0, 39)), ""),
        labelled(
          "google-service-account-key",
          keyFile(keyId.toUpperCase().replace(/[0-9]/g, "G")),
          "",
        ),
      ],
    };
  },
  "azure-sas-token": (): CorpusEntry => {
    const token: (date: string, signature: string) => string = (
      date: string,
      signature: string,
    ): string => {
      return `sv=${date}&ss=b&srt=o&sp=r&se=2030-01-01T00%3A00%3A00Z&spr=https&sig=${signature}`;
    };
    const first: string = token(
      "2022-11-02",
      percentEncoded(fake(BASE64_ALPHABET, 43) + "="),
    );
    const second: string = token(
      "2021-06-08",
      percentEncoded(fake(BASE64_ALPHABET, 43) + "="),
    );
    const url: (query: string) => string = (query: string): string => {
      return `GET https://demostore.blob.core.windows.net/backups/db.bak?${query} 200`;
    };

    return {
      positives: [
        labelled("azure-sas-token", url(first), first),
        labelled(
          "azure-sas-token",
          `{"sasUrl": "https://demostore.blob.core.windows.net/c?${second}"}`,
          second,
        ),
      ],
      nearMisses: [
        labelled(
          "azure-sas-token",
          url(
            token(
              "2022-13-02",
              percentEncoded(fake(BASE64_ALPHABET, 43) + "="),
            ),
          ),
          "",
        ),
        labelled(
          "azure-sas-token",
          url(
            token(
              "2022-11-02",
              percentEncoded(fake(BASE64_ALPHABET, 22) + "=="),
            ),
          ),
          "",
        ),
      ],
    };
  },
  "openai-api-key": (): CorpusEntry => {
    const marker: string = ["T3Blbk", "FJ"].join("");
    const legacy: string = `sk-${fake(ALNUM, 20)}${marker}${fake(ALNUM, 20)}`;
    const project: string = `sk-proj-${fake(URL_SAFE, 74)}${marker}${fake(URL_SAFE, 74)}`;

    return {
      positives: [
        labelled("openai-api-key", logLine("openai", legacy), legacy),
        labelled("openai-api-key", jsonDocument("openai", project), project),
      ],
      nearMisses: [
        labelled("openai-api-key", logLine("ref", `sk-${fake(ALNUM, 48)}`), ""),
        labelled(
          "openai-api-key",
          jsonDocument("ref", `sk-proj-${fake(URL_SAFE, 20)}`),
          "",
        ),
      ],
    };
  },
  "json-web-token": (): CorpusEntry => {
    const header: string = base64Url('{"alg":"HS256","typ":"JWT"}');
    const jwt: (subject: string) => string = (subject: string): string => {
      return `${header}.${base64Url(`{"sub":"${subject}","iat":1700000000}`)}.${fake(URL_SAFE, 43)}`;
    };
    const first: string = jwt("user-42");
    const second: string = jwt("user-77");

    return {
      positives: [
        labelled(
          "json-web-token",
          `{"id_token":"${first}","expires_in":3600}`,
          first,
        ),
        labelled(
          "json-web-token",
          `Set-Cookie: session=${second}; HttpOnly; Secure`,
          second,
        ),
      ],
      nearMisses: [
        labelled(
          "json-web-token",
          `{"id_token":"${base64Url('{"typ":"JWT"}')}.${base64Url('{"sub":"user-42"}')}.${fake(URL_SAFE, 43)}","expires_in":3600}`,
          "",
        ),
        labelled(
          "json-web-token",
          `Set-Cookie: session=${header}.${base64Url('{"sub":"user-77"}')}.${fake(URL_SAFE, 10)}; HttpOnly`,
          "",
        ),
      ],
    };
  },
  "private-key": (): CorpusEntry => {
    const body: string = `MIIEpAIBAAKCAQEA${fake(BASE64_ALPHABET, 48)}`;
    const block: (kind: string) => string = (kind: string): string => {
      return `-----BEGIN ${kind}-----\n${body}\n-----END ${kind}-----`;
    };

    return {
      positives: [
        labelled(
          "private-key",
          block("RSA PRIVATE KEY"),
          "-----BEGIN RSA PRIVATE KEY-----",
        ),
        labelled(
          "private-key",
          `{"private_key": "-----BEGIN PRIVATE KEY-----\\n${body}\\n-----END PRIVATE KEY-----\\n"}`,
          "-----BEGIN PRIVATE KEY-----",
        ),
      ],
      nearMisses: [
        labelled("private-key", block("PUBLIC KEY"), ""),
        labelled("private-key", block("CERTIFICATE"), ""),
      ],
    };
  },
  "connection-string-password": (): CorpusEntry => {
    const first: string = `${fake(ALNUM, 14)}!`;
    const second: string = `${fake(ALNUM, 12)}#7`;

    return {
      positives: [
        labelled(
          "connection-string-password",
          `Server=sql.internal;Database=orders;User Id=svc_orders;Password=${first};Encrypt=True`,
          first,
        ),
        labelled(
          "connection-string-password",
          `Driver={ODBC Driver 18 for SQL Server};Server=tcp:sql.internal,1433;Uid=svc;Pwd={${second}};`,
          second,
        ),
      ],
      nearMisses: [
        labelled(
          "connection-string-password",
          "Server=sql.internal;Database=orders;User Id=svc_orders;Password=;Encrypt=True",
          "",
        ),
        labelled(
          "connection-string-password",
          "Server=sql.internal;Database=orders;User Id=svc_orders;Password=<password>;Encrypt=True",
          "",
        ),
      ],
    };
  },
  "authorization-header": (): CorpusEntry => {
    const basic: string = btoa(`svc-backup:${fake(ALNUM, 18)}`);
    const bearer: string = fake(URL_SAFE, 40);

    return {
      positives: [
        labelled(
          "authorization-header",
          `Authorization: Basic ${basic}`,
          basic,
        ),
        labelled(
          "authorization-header",
          `curl -H 'Authorization: Bearer ${bearer}' https://api.acme.io/v1/orders`,
          bearer,
        ),
      ],
      nearMisses: [
        labelled("authorization-header", "Authorization: Basic notbase64", ""),
        labelled(
          "authorization-header",
          "curl -H 'Authorization: Bearer <token>' https://api.acme.io/v1/orders",
          "",
        ),
      ],
    };
  },
  "generic-secret": (): CorpusEntry => {
    const password: string = `${fake(ALNUM, 12)}#${fake(DIGITS, 3)}`;
    const apiKey: string = fake(ALNUM, 24);

    return {
      positives: [
        labelled("generic-secret", `DB_PASSWORD=${password}`, password),
        labelled(
          "generic-secret",
          `{"name": "billing", "api_key": "${apiKey}"}`,
          apiKey,
        ),
      ],
      nearMisses: [
        labelled("generic-secret", "DB_PASSWORD=${DB_PASSWORD}", ""),
        labelled(
          "generic-secret",
          '{"name": "billing", "api_key": "your-api-key-here"}',
          "",
        ),
      ],
    };
  },
  "bitcoin-private-key": (): CorpusEntry => {
    const key: Uint8Array = randomBytes(32);
    const uncompressed: string = base58Check(
      Uint8Array.from([0x80, ...Array.from(key)]),
    );
    const compressed: string = base58Check(
      Uint8Array.from([0x80, ...Array.from(randomBytes(32)), 0x01]),
    );
    const middle: number = Math.floor(uncompressed.length / 2);
    const corrupted: string =
      uncompressed.slice(0, middle) +
      (uncompressed[middle] === "z" ? "y" : "z") +
      uncompressed.slice(middle + 1);
    const otherCoin: string = base58Check(
      Uint8Array.from([0xb0, ...Array.from(key)]),
    );

    return {
      positives: [
        labelled(
          "bitcoin-private-key",
          `wallet.importPrivKey("${uncompressed}")`,
          uncompressed,
        ),
        labelled("bitcoin-private-key", `wif: ${compressed}`, compressed),
      ],
      nearMisses: [
        labelled(
          "bitcoin-private-key",
          `wallet.importPrivKey("${corrupted}")`,
          "",
        ),
        labelled("bitcoin-private-key", `wif: ${otherCoin}`, ""),
      ],
    };
  },
};

const VALUE_TYPES: Array<DataTypeInfo> = DATA_TYPE_CATALOG.filter(
  (info: DataTypeInfo) => {
    return info.foundBy === "value";
  },
);

/*
 * Whether a built entry is as the corpus means it: each value found by its
 * type's own detectors, and each near miss refused by them and taken by no
 * other type.
 */
function isSound(dataTypeId: string, entry: CorpusEntry): boolean {
  return (
    entry.positives.every((positive: Labelled) => {
      return isFoundAlone(dataTypeId, positive.text, positive.value);
    }) &&
    entry.nearMisses.every((nearMiss: Labelled) => {
      return (
        isRefusedAlone(dataTypeId, nearMiss.text) &&
        !isTakenByAnotherType(dataTypeId, nearMiss.text)
      );
    })
  );
}

/*
 * A built type's entry, put together again from new parts while its parts
 * fell badly - a random key that reads as a placeholder, an IBAN a
 * character short whose digits are a card number's. One that is never
 * sound is kept as it is last built, for the tests to say what is wrong.
 */
function builtEntry(info: DataTypeInfo): CorpusEntry {
  let entry: CorpusEntry = BUILT[info.id]!();

  for (
    let attempt: number = 1;
    attempt < BUILD_ATTEMPTS && !isSound(info.id, entry);
    attempt++
  ) {
    entry = BUILT[info.id]!();
  }

  return entry;
}

// One type's values and near misses, drawn from its own stream.
function buildEntry(info: DataTypeInfo, corpusSeed: number): CorpusEntry {
  random = seededRandom(seedOf(corpusSeed, info.id));

  return BUILT[info.id] ? builtEntry(info) : drawnEntry(info);
}

function buildCorpus(
  corpusSeed: number,
  types: ReadonlyArray<DataTypeInfo> = VALUE_TYPES,
): Record<string, CorpusEntry> {
  const corpus: Record<string, CorpusEntry> = {};

  for (const info of types) {
    corpus[info.id] = buildEntry(info, corpusSeed);
  }

  return corpus;
}

const CORPUS: Record<string, CorpusEntry> = buildCorpus(CORPUS_SEED);

/*
 * VALUES WRITTEN THE WAYS THE DETECTORS NOW READ THEM TOO.
 *
 * An IPv6 address right after a key's colon (peer ip:2a00:..., #10936), an
 * email address in a percent-encoded URL (jane.doe%40acmecorp.io, #10935),
 * an email address in another script (张伟@acmecorp.io, почта@пример.рф,
 * #10960) and a card number in fullwidth, Arabic-Indic or Persian digits,
 * or two scripts at once (#10960); a phone number in a percent-encoded URL
 * or in another script's digits, and an international one in parentheses,
 * after its trunk prefix or typeset with no-break spaces, and a Social
 * Security number in another script's digits (#11025, #11030) - each with
 * near misses of the same writing that are no value: a clock or a
 * link-local address after a key, an image asset's name encoded, an
 * address with no top-level domain, a card a check digit off, a decimal, a
 * count, a time zone beside a date, an SSN's area no one is issued or a
 * longer chain of groups. And a phone or Social Security number typed
 * wholly in fullwidth, its signs and separators too (#11115), and a
 * national number or nine digits beside the words that name them, with
 * the same digits beside no such word as their near misses (#11114). And
 * a national number or nine digits alone under a key that names them,
 * read as Data Security reads a field (#11383: the same digits under a key
 * that names nothing are their near misses); a number whose groups are set
 * apart by another dash, and a value - an address, an IBAN, a postcode, a
 * number's words - typed in fullwidth letters (#11385: a katakana word's
 * ー beside a digit, a range, CJK prose with fullwidth letters as near
 * misses). Labelled apart from the corpus, which draws two
 * values of each type from its detectors' shapes, and held to a precision
 * and a recall of 1: every value found as its type, and nothing else found.
 * Each case draws from a stream of its own, so the corpus draws as before.
 */
const HAN: string = "张伟王芳李娜刘洋陈静杨磊赵敏黄勇周杰吴霞徐涛孙丽";
const CYRILLIC: string = "абвгдежзиклмнопрстуфхцчшэюя";
const LATIN_ACCENTED: string = "áéíóúüñçøåäöß";
const FULLWIDTH_ZERO: number = 0xff10;
const ARABIC_INDIC_ZERO: number = 0x0660;
const PERSIAN_ZERO: number = 0x06f0;

// A digit string written in the digits of the script whose zero is given.
function inScript(digits: string, zero: number): string {
  return digits.replace(/[0-9]/g, (digit: string): string => {
    return String.fromCharCode(zero + Number(digit));
  });
}

const IDEOGRAPHIC_SPACE: string = "　";

// The characters a number is typed with in fullwidth: its digits, signs and separators.
const NUMBER_CHARACTERS: string = "0123456789+-()./";

// Whether a run of a number's characters holds a digit: is a number.
const HOLDS_A_DIGIT: RegExp = /[0-9]/;

// A character as an input method in fullwidth mode types it (#11115).
function fullwidthOf(character: string): string {
  return character === " "
    ? IDEOGRAPHIC_SPACE
    : NUMBER_CHARACTERS.includes(character)
      ? String.fromCharCode(character.charCodeAt(0) - 0x20 + 0xff00)
      : character;
}

// A number typed wholly in fullwidth: every digit, sign, separator and space of it.
function toFullwidth(number: string): string {
  return Array.from(number).map(fullwidthOf).join("");
}

/*
 * The other dashes a number's groups are set apart by, read as hyphens
 * between two digits (#11385): ー, ｰ, ‐, ‑, ‒, – and −.
 */
const OTHER_DASHES: ReadonlyArray<string> = NUMBER_DASHES.map(
  (dash: number): string => {
    return String.fromCharCode(dash);
  },
);

// Whether the character at `at` is an ASCII digit.
function isAsciiDigitAt(text: string, at: number): boolean {
  return at >= 0 && at < text.length && ASCII_DIGIT_CHARACTER.test(text[at]!);
}

const ASCII_DIGIT_CHARACTER: RegExp = /^[0-9]$/;

/*
 * A text with each hyphen between two digits written as another dash, in
 * turn from `first` (#11385): 536-22-8731 as 536–22−8731. One character for
 * one, so a value is where it was.
 */
function withOtherDashes(text: string, first: number = 0): string {
  let written: string = "";
  let next: number = first;

  for (let index: number = 0; index < text.length; index++) {
    if (
      text[index] === "-" &&
      isAsciiDigitAt(text, index - 1) &&
      isAsciiDigitAt(text, index + 1)
    ) {
      written += OTHER_DASHES[next % OTHER_DASHES.length];
      next++;
    } else {
      written += text[index];
    }
  }

  return written;
}

/*
 * A text typed wholly in fullwidth, as an input method in fullwidth mode
 * types every character (#11385): each of ASCII's printable characters as
 * its fullwidth form, letters too, a space as an ideographic space. One
 * character for one.
 */
function allInFullwidth(text: string): string {
  return Array.from(text)
    .map((character: string): string => {
      const code: number = character.charCodeAt(0);

      if (character === " ") {
        return IDEOGRAPHIC_SPACE;
      }

      return code >= 0x21 && code <= 0x7e
        ? String.fromCharCode(code + 0xfee0)
        : character;
    })
    .join("");
}

// Whether a value holds one of the other dashes.
function holdsOtherDash(value: string): boolean {
  return OTHER_DASHES.some((dash: string): boolean => {
    return value.includes(dash);
  });
}

// Whether a value is typed in fullwidth letters: it holds one.
function holdsFullwidthLetter(value: string): boolean {
  return Array.from(value).some((character: string): boolean => {
    const code: number = character.charCodeAt(0);

    return (code >= 0xff21 && code <= 0xff3a) || (code >= 0xff41 && code <= 0xff5a);
  });
}

// Whether a value holds a number's fullwidth sign or separator, an ideographic space among them.
function holdsFullwidthSeparator(value: string): boolean {
  return Array.from(value).some((character: string): boolean => {
    return (
      character === IDEOGRAPHIC_SPACE ||
      (character.charCodeAt(0) >= 0xff08 && character.charCodeAt(0) <= 0xff0f)
    );
  });
}

/*
 * A text with every number in it typed wholly in fullwidth, and every
 * other character as it was (#11115): each run of digits, signs,
 * separators and spaces that holds a digit, its spaces at either end left
 * as they were - so a log line's words keep their ASCII spaces, as they
 * do in Japanese text a number is typed into in fullwidth mode. One
 * character for one, so a value is where it was.
 */
function numbersInFullwidth(text: string): string {
  let written: string = "";
  let index: number = 0;

  while (index < text.length) {
    let end: number = index;

    while (
      end < text.length &&
      (NUMBER_CHARACTERS.includes(text[end]!) || text[end] === " ")
    ) {
      end++;
    }

    if (end === index) {
      written += text[index]!;
      index++;
      continue;
    }

    const run: string = text.slice(index, end);
    const inner: string = run.trim();

    if (!HOLDS_A_DIGIT.test(inner)) {
      written += run;
    } else {
      const leading: number = run.indexOf(inner);

      written +=
        run.slice(0, leading) +
        toFullwidth(inner) +
        run.slice(leading + inner.length);
    }

    index = end;
  }

  return written;
}

// A Visa number that passes the Luhn check, no test number nor placeholder.
function drawnCard(): string {
  for (;;) {
    const body: string = "4" + fake(DIGITS, 14);

    for (const check of DIGITS) {
      const number: string = body + check;
      let sum: number = 0;

      for (let index: number = 0; index < 16; index++) {
        let digit: number = Number(number[15 - index]);

        if (index % 2 === 1) {
          digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
        }

        sum += digit;
      }

      if (sum % 10 === 0 && findSensitiveValues(number).some(isSure)) {
        return number;
      }
    }
  }
}

// A public IPv6 address of the global range, no documentation one.
function drawnIpv6(): string {
  for (;;) {
    const address: string = `2${fake(HEX, 3)}:${fake(HEX, 4)}:${fake(HEX, 4)}::${fake(HEX, 1 + random(4))}`;

    if (!address.startsWith("2001:") && !address.startsWith("2002:")) {
      return address;
    }
  }
}

function drawnDomain(): string {
  return `${fake(LOWER, 5 + random(5))}.${["io", "com", "net", "de"][random(4)]}`;
}

/*
 * A national number of `digits` digits that is no placeholder (no digit run
 * all alike, no counting up or down) and no number set aside for fiction.
 */
function drawnDigitsOf(digits: number, first: string = ""): string {
  for (;;) {
    const drawn: string = first + fake(DIGITS, digits - first.length);

    if (
      drawn.split("").some((digit: string): boolean => {
        return digit !== drawn[0];
      }) &&
      !"01234567890".includes(drawn) &&
      !"98765432109".includes(drawn) &&
      !drawn.startsWith("555")
    ) {
      return drawn;
    }
  }
}

// A North American exchange: 200 to 999, no N11 service code, no 555.
function drawnExchange(): string {
  for (;;) {
    const exchange: string = String(200 + random(800));

    if (!exchange.endsWith("11") && exchange !== "555") {
      return exchange;
    }
  }
}

// A Social Security number by the SSA's rules: area, group and serial.
function drawnSsn(): string {
  const area: number = 1 + random(665);
  const group: number = 1 + random(99);
  const serial: number = 1 + random(9999);

  return `${String(area).padStart(3, "0")}-${String(group).padStart(2, "0")}-${String(serial).padStart(4, "0")}`;
}

/*
 * A value drawn again until the near miss written of it is no other
 * type's value either (isTakenByAnotherType): eleven digits beside no
 * phone word can be a Greek AMKA, a birth date and a check digit that
 * happen to hold.
 */
function drawnUntaken(
  dataTypeId: string,
  draw: () => string,
  nearMissOf: (drawn: string) => string,
): string {
  for (let attempt: number = 0; attempt < BUILD_ATTEMPTS; attempt++) {
    const drawn: string = draw();

    if (!isTakenByAnotherType(dataTypeId, nearMissOf(drawn))) {
      return drawn;
    }
  }

  return draw();
}

// A Visa number's sixteen digits in its four groups, apart by `separator`.
function inGroupsOfFour(card: string, separator: string): string {
  return card.replace(/([0-9]{4})(?=[0-9])/g, `$1${separator}`);
}

// The last digit of a number one more: a check digit off.
function checkDigitOff(number: string): string {
  return number.slice(0, -1) + String((Number(number.slice(-1)) + 1) % 10);
}

// An IBAN of a country whose BBAN is all digits, drawn, in its groups of four apart by `separator`.
function drawnIban(): string {
  const country: string = ["DE", "BE", "PL", "HU"][random(4)]!;
  const lengths: Readonly<Record<string, number>> = {
    DE: 18,
    BE: 12,
    PL: 24,
    HU: 24,
  };

  return iban(country, drawnDigitsOf(lengths[country]!));
}

function ibanInGroups(value: string, separator: string): string {
  return value.replace(/(.{4})(?=.)/g, `$1${separator}`);
}

// A plausible birth date's parts: a year from 1950 to 2000, a month, a day every month has.
function drawnBirthDate(): { year: string; month: string; day: string } {
  return {
    year: String(1950 + random(51)),
    month: String(1 + random(12)).padStart(2, "0"),
    day: String(1 + random(28)).padStart(2, "0"),
  };
}

// A UK postcode: an area, a district digit, a space, a digit and two of the letters an inward code takes.
function drawnUkPostcode(): string {
  return `${fake("ABCDEFGHKLMNOPRSTUWYZ", 1 + random(2))}${random(10)} ${random(10)}${fake("ABDEFGHJLNPQRSTUWXYZ", 2)}`;
}

const MONTH_NAMES: ReadonlyArray<string> = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const READING_CASES_OF: Readonly<
  Record<string, (corpus: Record<string, CorpusEntry>) => CorpusEntry>
> = {
  /*
   * #11199, #11200: a date of birth in a URL - its slashes escaped, its
   * words before it typed into a form, its month's name and spaces "+" -
   * and in Arabic-Indic digits typed into one; and what is none written
   * so: no real date, a date with no word that says it is a birth.
   */
  "date-of-birth: in a URL, its slashes escaped or its words typed into a form":
    (): CorpusEntry => {
      const first: { year: string; month: string; day: string } =
        drawnBirthDate();
      const second: { year: string; month: string; day: string } =
        drawnBirthDate();
      const third: { year: string; month: string; day: string } =
        drawnBirthDate();
      const escaped: string = `${first.day}%2F${first.month}%2F${first.year}`;
      const iso: string = `${second.year}-${second.month}-${second.day}`;
      const written: string = `${Number(third.day)}+${MONTH_NAMES[Number(third.month) - 1]}+${third.year}`;
      // The date's own digits in Arabic-Indic ones, its escaped slashes as a URL writes them.
      const arabic: string = [third.day, third.month, third.year]
        .map((part: string): string => {
          return inScript(part, ARABIC_INDIC_ZERO);
        })
        .join("%2F");

      return {
        positives: [
          labelled(
            "date-of-birth",
            `2026-10-27T10:15:02Z INFO GET /verify?dob=${escaped}&step=2 HTTP/1.1 200`,
            escaped,
          ),
          labelled(
            "date-of-birth",
            `{"url": "/apply?date+of+birth=${iso}&source=form", "batch": "nightly"}`,
            iso,
          ),
          labelled(
            "date-of-birth",
            `2026-10-27T10:15:02Z INFO GET /signup?born=${written}&step=2 HTTP/1.1 200`,
            written,
          ),
          labelled(
            "date-of-birth",
            `2026-10-27T10:15:02Z INFO GET /verify?dob=${arabic}&step=2 HTTP/1.1 200`,
            arabic,
          ),
        ],
        nearMisses: [
          labelled(
            "date-of-birth",
            `2026-10-27T10:15:02Z INFO GET /verify?dob=31%2F02%2F${first.year}&step=2 HTTP/1.1 200`,
            "",
          ),
          labelled(
            "date-of-birth",
            `{"url": "/search?q=${iso}&source=form", "batch": "nightly"}`,
            "",
          ),
        ],
      };
    },
  // #11199, #11200: a UK postcode typed into a form, and with %20 for its space.
  "postal-code: typed into a form, or with %20 for its space":
    (): CorpusEntry => {
      const typed: string = drawnUkPostcode().split(" ").join("+");
      const escaped: string = drawnUkPostcode().split(" ").join("%20");

      return {
        positives: [
          labelled(
            "postal-code",
            `2026-10-27T10:15:02Z INFO GET /lookup?postcode=${typed}&step=2 HTTP/1.1 200`,
            typed,
          ),
          labelled(
            "postal-code",
            `{"url": "/stores?near=${escaped}&radius=5", "batch": "nightly"}`,
            escaped,
          ),
        ],
        nearMisses: [
          labelled(
            "postal-code",
            `2026-10-27T10:15:02Z INFO GET /lookup?postcode=${typed.slice(0, -1)}C&step=2 HTTP/1.1 200`,
            "",
          ),
          labelled(
            "postal-code",
            `{"url": "/stores?near=${escaped.slice(0, -1)}&radius=5", "batch": "nightly"}`,
            "",
          ),
        ],
      };
    },
  // #11199: a street address a form wrote, its words apart by "+" or %20.
  "postal-address: typed into a form, or with %20 between its words":
    (): CorpusEntry => {
      const name: string = `${fake(UPPER, 1)}${fake(LOWER, 4 + random(5))}`;
      const typed: string = `${10 + random(900)}+${name}+Street`;
      const escaped: string = `${10 + random(900)}%20${fake(UPPER, 1)}${fake(LOWER, 5)}%20Avenue`;

      return {
        positives: [
          labelled(
            "postal-address",
            `2026-10-27T10:15:02Z INFO GET /delivery?address=${typed}&step=2 HTTP/1.1 200`,
            typed,
          ),
          labelled(
            "postal-address",
            `{"url": "/checkout?ship_to=${escaped}&step=3", "batch": "nightly"}`,
            escaped,
          ),
        ],
        nearMisses: [
          labelled(
            "postal-address",
            `2026-10-27T10:15:02Z INFO GET /search?q=${10 + random(90)}+apples+on+${name}+shelves HTTP/1.1 200`,
            "",
          ),
          labelled(
            "postal-address",
            `{"url": "/checkout?ship_to=${10 + random(900)}%20${name.toLowerCase()}%20street&step=3", "batch": "nightly"}`,
            "",
          ),
        ],
      };
    },
  /*
   * #11199: a card in a URL's query string, its groups apart by an
   * escaped space, by the "+" a form writes a space as, or by that "+"
   * escaped again in a URL inside a query string - and in another
   * script's digits typed into a form.
   */
  "credit-card-number: in a URL, %20 or '+' between its groups":
    (): CorpusEntry => {
      const card: string = drawnCard();
      const encoded: string = inGroupsOfFour(card, "%20");
      const typed: string = inGroupsOfFour(card, "+");
      const nested: string = inGroupsOfFour(card, "%2B");
      const arabic: string = inScript(typed, ARABIC_INDIC_ZERO);

      return {
        positives: [
          labelled(
            "credit-card-number",
            `2026-10-27T10:15:02Z INFO GET /pay?card=${encoded}&step=2 HTTP/1.1 200`,
            encoded,
          ),
          labelled(
            "credit-card-number",
            `{"url": "/checkout?number=${typed}&cvc_check=pass", "batch": "nightly"}`,
            typed,
          ),
          labelled(
            "credit-card-number",
            `2026-10-27T10:15:02Z INFO GET /login?next=%2Fpay%3Fcard%3D${nested} HTTP/1.1 302`,
            nested,
          ),
          labelled(
            "credit-card-number",
            `2026-10-27T10:15:02Z INFO GET /pay?card=${arabic}&step=2 HTTP/1.1 200`,
            arabic,
          ),
        ],
        nearMisses: [
          labelled(
            "credit-card-number",
            `2026-10-27T10:15:02Z INFO GET /pay?card=${inGroupsOfFour(checkDigitOff(card), "%20")}&step=2 HTTP/1.1 200`,
            "",
          ),
          labelled(
            "credit-card-number",
            `{"url": "/checkout?number=${inGroupsOfFour(checkDigitOff(card), "+")}&cvc_check=pass", "batch": "nightly"}`,
            "",
          ),
          labelled(
            "credit-card-number",
            `2026-10-27T10:15:02Z INFO GET /pay?card=${inGroupsOfFour(card, "+")}${random(10)}&step=2 HTTP/1.1 200`,
            "",
          ),
        ],
      };
    },
  /*
   * #11199: an IBAN in a URL's query string, its groups apart as a card's
   * are - each drawn again while its near miss is another type's value: a
   * BBAN's sixteen digits in four groups pass a card's Luhn check one time
   * in ten, and an IBAN a digit off is that card.
   */
  "iban: in a URL, %20 or '+' between its groups": (): CorpusEntry => {
    const drawn: (separator: string) => [string, string] = (
      separator: string,
    ): [string, string] => {
      for (;;) {
        const value: string = drawnIban();
        const nearMiss: string = ibanInGroups(checkDigitOff(value), separator);

        if (
          !isTakenByAnotherType("iban", `iban=${nearMiss}`) &&
          !isTakenByAnotherType(
            "iban",
            `iban=${ibanInGroups(value, separator)}`,
          )
        ) {
          return [ibanInGroups(value, separator), nearMiss];
        }
      }
    };
    const [encoded, encodedOff] = drawn("%20");
    const [typed, typedOff] = drawn("+");

    return {
      positives: [
        labelled(
          "iban",
          `2026-10-27T10:15:02Z INFO GET /payout?iban=${encoded}&step=2 HTTP/1.1 200`,
          encoded,
        ),
        labelled(
          "iban",
          `{"url": "/sepa/mandate?account=${typed}&source=form", "batch": "nightly"}`,
          typed,
        ),
      ],
      nearMisses: [
        labelled(
          "iban",
          `2026-10-27T10:15:02Z INFO GET /payout?iban=${encodedOff}&step=2 HTTP/1.1 200`,
          "",
        ),
        labelled(
          "iban",
          `{"url": "/sepa/mandate?account=${typedOff}&source=form", "batch": "nightly"}`,
          "",
        ),
      ],
    };
  },
  /*
   * #11199: a phone number a form wrote - its spaces "+", its own "+"
   * escaped, or written as it is before its digits - and what only looks
   * like one written so: a count, a decimal.
   */
  "phone-number: as a form writes it": (): CorpusEntry => {
    const berlin: string = `%2B49+30+${drawnDigitsOf(8, "2")}`;
    const paris: string = `+33+6+${drawnDigitsOf(2)}+${drawnDigitsOf(2)}+${drawnDigitsOf(2)}+${drawnDigitsOf(2)}`;
    const sanFrancisco: string = `%28415%29+${drawnExchange()}-${drawnDigitsOf(4)}`;

    return {
      positives: [
        labelled(
          "phone-number",
          `2026-10-27T10:15:02Z INFO GET /callback?phone=${berlin} HTTP/1.1 200`,
          berlin,
        ),
        labelled(
          "phone-number",
          `{"url": "/notify?mobile=${paris}&step=2", "batch": "nightly"}`,
          paris,
        ),
        labelled(
          "phone-number",
          `2026-10-27T10:15:02Z INFO POST /contact body=name%3Dx%26tel%3D${sanFrancisco} HTTP/1.1 200`,
          sanFrancisco,
        ),
      ],
      nearMisses: [
        labelled(
          "phone-number",
          `2026-10-27T10:15:02Z INFO GET /search?q=%2B1+2+3+4+5+6+7+8 HTTP/1.1 200`,
          "",
        ),
        labelled(
          "phone-number",
          `{"url": "/search?delta=%2B${10 + random(80)}.${drawnDigitsOf(6)}+units&step=2", "batch": "nightly"}`,
          "",
        ),
      ],
    };
  },
  // #11199: a Social Security number in a URL, its groups apart by %20 or "+".
  "us-ssn: in a URL, %20 or '+' between its groups": (): CorpusEntry => {
    const encoded: string = drawnSsn().split("-").join("%20");
    const typed: string = drawnSsn().split("-").join("+");

    return {
      positives: [
        labelled(
          "us-ssn",
          `2026-10-27T10:15:02Z INFO GET /verify?ssn=${encoded}&step=2 HTTP/1.1 200`,
          encoded,
        ),
        labelled(
          "us-ssn",
          `{"url": "/apply?ssn=${typed}&source=form", "batch": "nightly"}`,
          typed,
        ),
      ],
      nearMisses: [
        labelled(
          "us-ssn",
          `2026-10-27T10:15:02Z INFO GET /verify?ssn=666%20${drawnSsn().slice(4).split("-").join("%20")}&step=2 HTTP/1.1 200`,
          "",
        ),
        labelled(
          "us-ssn",
          `{"url": "/apply?ssn=${drawnSsn().split("-").join("+")}+${drawnDigitsOf(2)}&source=form", "batch": "nightly"}`,
          "",
        ),
      ],
    };
  },
  // #11030
  "phone-number: in a percent-encoded URL": (): CorpusEntry => {
    const berlin: string = `%2B49%2030%20${drawnDigitsOf(8, "2")}`;
    const paris: string = `%2B33%206%20${drawnDigitsOf(2)}%20${drawnDigitsOf(2)}%20${drawnDigitsOf(2)}%20${drawnDigitsOf(2)}`;

    return {
      positives: [
        labelled(
          "phone-number",
          `2026-10-27T10:15:02Z INFO GET /callback?phone=${berlin} HTTP/1.1 200`,
          berlin,
        ),
        labelled(
          "phone-number",
          `{"url": "/notify?mobile=${paris}&step=2", "batch": "nightly"}`,
          paris,
        ),
      ],
      nearMisses: [
        labelled(
          "phone-number",
          `2026-10-27T10:15:02Z INFO GET /assets/${fake(LOWER, 6)}%2B2x.png HTTP/1.1 200`,
          "",
        ),
        labelled(
          "phone-number",
          `{"url": "/search?delta=%2B${10 + random(80)}.${drawnDigitsOf(6)}&step=2", "batch": "nightly"}`,
          "",
        ),
      ],
    };
  },
  // #11030
  "phone-number: in another script's digits": (): CorpusEntry => {
    const berlin: string = inScript(
      `+49 30 ${drawnDigitsOf(8, "2")}`,
      ARABIC_INDIC_ZERO,
    );
    const london: string = inScript(
      `+44 161 ${drawnDigitsOf(3, "3")} ${drawnDigitsOf(4)}`,
      PERSIAN_ZERO,
    );
    const sanFrancisco: string = inScript(
      `(415) ${drawnExchange()}-${drawnDigitsOf(4)}`,
      FULLWIDTH_ZERO,
    );

    return {
      positives: [
        labelled("phone-number", `رقم الهاتف ${berlin}`, berlin),
        labelled("phone-number", `شماره تلفن ${london}`, london),
        labelled("phone-number", `電話番号：${sanFrancisco}`, sanFrancisco),
      ],
      nearMisses: [
        labelled(
          "phone-number",
          `دلتا ${inScript(`+${10 + random(80)}.${drawnDigitsOf(6)}`, ARABIC_INDIC_ZERO)}`,
          "",
        ),
        labelled(
          "phone-number",
          `العدد ${inScript("+1 2 3 4 5 6 7 8", ARABIC_INDIC_ZERO)}`,
          "",
        ),
      ],
    };
  },
  // #11025
  "phone-number: international, as people write them": (): CorpusEntry => {
    const inParentheses: string = `(+44) 20 ${drawnDigitsOf(4, "8")} ${drawnDigitsOf(4)}`;
    const withTrunk: string = `+44 (0)20 ${drawnDigitsOf(4, "8")} ${drawnDigitsOf(4)}`;
    const typeset: string = `+33\u00A06\u00A0${drawnDigitsOf(2)}\u00A0${drawnDigitsOf(2)}\u00A0${drawnDigitsOf(2)}\u00A0${drawnDigitsOf(2)}`;

    return {
      positives: [
        labelled(
          "phone-number",
          `2026-10-27T10:15:02Z INFO sms sent to ${inParentheses} ok`,
          inParentheses.slice(1),
        ),
        labelled(
          "phone-number",
          `{"contact": "${withTrunk}", "batch": "nightly"}`,
          withTrunk,
        ),
        labelled(
          "phone-number",
          `2026-10-27T10:15:02Z INFO call forwarded to ${typeset} ok`,
          typeset,
        ),
      ],
      nearMisses: [
        labelled(
          "phone-number",
          `2026-10-27T10:15:02Z INFO tick at UTC +1 2026-11-${10 + random(18)} ${10 + random(13)}:${10 + random(50)}:00 ok`,
          "",
        ),
        labelled(
          "phone-number",
          `2026-10-27T10:15:02Z INFO delta +${10 + random(80)}.${drawnDigitsOf(6)} out of range`,
          "",
        ),
        labelled(
          "phone-number",
          `2026-10-27T10:15:02Z INFO counted +1 2 3 4 5 6 7 8 ok`,
          "",
        ),
      ],
    };
  },
  // #11030
  "us-ssn: in another script's digits": (): CorpusEntry => {
    const arabic: string = inScript(drawnSsn(), ARABIC_INDIC_ZERO);
    const fullwidth: string = inScript(
      drawnSsn().split("-").join(" "),
      FULLWIDTH_ZERO,
    );

    return {
      positives: [
        labelled("us-ssn", `SSN: ${arabic}`, arabic),
        labelled(
          "us-ssn",
          `{"ssn": "${fullwidth}", "batch": "nightly"}`,
          fullwidth,
        ),
      ],
      nearMisses: [
        labelled(
          "us-ssn",
          `SSN: ${inScript(`666-${drawnSsn().slice(4)}`, ARABIC_INDIC_ZERO)}`,
          "",
        ),
        labelled(
          "us-ssn",
          `SSN: ${inScript(`${drawnSsn()}-${drawnDigitsOf(2)}`, ARABIC_INDIC_ZERO)}`,
          "",
        ),
      ],
    };
  },
  /*
   * #11115: a phone number typed wholly in fullwidth, as Japanese and
   * Chinese text writes one - its plus sign, hyphens, parentheses and
   * ideographic spaces too, or its digits in ASCII and its signs in
   * fullwidth - and what only looks like one typed so: a decimal, a time
   * zone's offset beside a date, a count.
   */
  "phone-number: typed wholly in fullwidth": (): CorpusEntry => {
    const tokyo: string = toFullwidth(
      `+81 3-${drawnDigitsOf(4, "2")}-${drawnDigitsOf(4)}`,
    );
    const beijing: string = toFullwidth(
      `+86 138 ${drawnDigitsOf(4)} ${drawnDigitsOf(4)}`,
    );
    const sanFrancisco: string = toFullwidth(
      `(415) ${drawnExchange()}-${drawnDigitsOf(4)}`,
    );
    const mixed: string = `＋81 3－${drawnDigitsOf(4, "2")}－${drawnDigitsOf(4)}`;

    return {
      positives: [
        labelled("phone-number", `電話番号：${tokyo} まで`, tokyo),
        labelled(
          "phone-number",
          `{"contact": "${beijing}", "batch": "nightly"}`,
          beijing,
        ),
        labelled("phone-number", `連絡先 ${sanFrancisco} まで`, sanFrancisco),
        labelled(
          "phone-number",
          `2026-10-27T10:15:02Z INFO sms sent to ${mixed} ok`,
          mixed,
        ),
      ],
      nearMisses: [
        labelled(
          "phone-number",
          `差分 ${toFullwidth(`+${10 + random(80)}.${drawnDigitsOf(6)}`)} の範囲外`,
          "",
        ),
        labelled(
          "phone-number",
          `時刻 UTC ${toFullwidth(`+1 2026-11-${10 + random(18)}`)} 10:15:00`,
          "",
        ),
        labelled(
          "phone-number",
          `件数 ${toFullwidth("+1 2 3 4 5 6 7 8")} 件`,
          "",
        ),
      ],
    };
  },
  // #11115: a Social Security number typed wholly in fullwidth, and what is none typed so.
  "us-ssn: typed wholly in fullwidth": (): CorpusEntry => {
    const dashed: string = toFullwidth(drawnSsn());
    const dotted: string = toFullwidth(drawnSsn().split("-").join("."));
    const spaced: string = toFullwidth(drawnSsn().split("-").join(" "));

    return {
      positives: [
        labelled("us-ssn", `SSN：${dashed}`, dashed),
        labelled("us-ssn", `{"ssn": "${dotted}", "batch": "nightly"}`, dotted),
        labelled(
          "us-ssn",
          `2026-10-27T10:15:02Z INFO verified ssn ${spaced} ok`,
          spaced,
        ),
      ],
      nearMisses: [
        labelled(
          "us-ssn",
          `SSN：${toFullwidth(`666.${drawnSsn().slice(4).split("-").join(".")}`)}`,
          "",
        ),
        labelled(
          "us-ssn",
          `SSN：${toFullwidth(`${drawnSsn().split("-").join(".")}.${drawnDigitsOf(2)}`)}`,
          "",
        ),
      ],
    };
  },
  /*
   * #11114: a national phone number of no other shape beside the word that
   * names it - as written, in a URL with its "=" escaped, in fullwidth
   * digits - and the same digits beside no such word, or a word that only
   * holds one.
   */
  "phone-number: a national number beside the word that names it":
    (): CorpusEntry => {
      const london: string = drawnUntaken(
        "phone-number",
        (): string => {
          return `020${drawnDigitsOf(8, "7")}`;
        },
        (drawn: string): string => {
          return `2026-10-27T10:15:02Z INFO order ${drawn} shipped ok`;
        },
      );
      const paris: string = drawnUntaken(
        "phone-number",
        (): string => {
          return drawnDigitsOf(9, "6");
        },
        (drawn: string): string => {
          return `{"telemetry": "${drawn}", "batch": "nightly"}`;
        },
      );
      const encoded: string = `0${drawnDigitsOf(10, "3")}`;
      const fullwidth: string = toFullwidth(`0${drawnDigitsOf(10, "8")}`);

      return {
        positives: [
          labelled(
            "phone-number",
            `2026-10-27T10:15:02Z INFO callback queued tel ${london} ok`,
            london,
          ),
          labelled(
            "phone-number",
            `{"mobile": "${paris}", "batch": "nightly"}`,
            paris,
          ),
          labelled(
            "phone-number",
            `2026-10-27T10:15:02Z INFO GET /contact?phone%3D${encoded} HTTP/1.1 200`,
            encoded,
          ),
          labelled("phone-number", `連絡先 tel：${fullwidth}`, fullwidth),
        ],
        nearMisses: [
          labelled(
            "phone-number",
            `2026-10-27T10:15:02Z INFO order ${london} shipped ok`,
            "",
          ),
          labelled(
            "phone-number",
            `{"telemetry": "${paris}", "batch": "nightly"}`,
            "",
          ),
        ],
      };
    },
  /*
   * #11114: nine digits in a row beside the words that name a Social
   * Security number - as written, typed into a form, in fullwidth digits -
   * and nine digits no such word names, or an area no one is issued.
   */
  "us-ssn: nine digits beside the word that names them": (): CorpusEntry => {
    const first: string = drawnUntaken(
      "us-ssn",
      (): string => {
        return drawnSsn().split("-").join("");
      },
      (drawn: string): string => {
        return `{"ssn": "666${drawn.slice(3)}", "batch": "nightly"}`;
      },
    );
    const second: string = drawnUntaken(
      "us-ssn",
      (): string => {
        return drawnSsn().split("-").join("");
      },
      (drawn: string): string => {
        return `2026-10-27T10:15:02Z INFO applicant ref ${drawn} verified`;
      },
    );
    const third: string = drawnSsn().split("-").join("");
    const fullwidth: string = toFullwidth(drawnSsn().split("-").join(""));

    return {
      positives: [
        labelled(
          "us-ssn",
          `2026-10-27T10:15:02Z INFO applicant ssn ${first} verified`,
          first,
        ),
        labelled(
          "us-ssn",
          `{"social security number": "${second}", "batch": "nightly"}`,
          second,
        ),
        labelled(
          "us-ssn",
          `2026-10-27T10:15:02Z INFO GET /apply?social+security+number=${third} HTTP/1.1 200`,
          third,
        ),
        labelled("us-ssn", `SSN：${fullwidth}`, fullwidth),
      ],
      nearMisses: [
        labelled(
          "us-ssn",
          `2026-10-27T10:15:02Z INFO applicant ref ${second} verified`,
          "",
        ),
        labelled(
          "us-ssn",
          `{"ssn": "666${first.slice(3)}", "batch": "nightly"}`,
          "",
        ),
      ],
    };
  },
  /*
   * #11383: a national phone number of no other shape alone under a key
   * that names a phone - user.phone, customer.mobile, msisdn - as Data
   * Security reads a field: the key's name is the word it needs, and a
   * whole value of a phone's shape there is one. The same digits under a
   * key that names nothing, and a placeholder of a phone's shape, are none.
   */
  "phone-number: a national number alone under a key that names it":
    (): CorpusEntry => {
      const london: string = drawnUntaken(
        "phone-number",
        (): string => {
          return `020${drawnDigitsOf(8, "7")}`;
        },
        (drawn: string): string => {
          return drawn;
        },
      );
      const mobile: string = drawnUntaken(
        "phone-number",
        (): string => {
          return drawnDigitsOf(9, "6");
        },
        (drawn: string): string => {
          return drawn;
        },
      );
      const msisdn: string = drawnUntaken(
        "phone-number",
        (): string => {
          return `447${drawnDigitsOf(9, "7")}`;
        },
        (drawn: string): string => {
          return drawn;
        },
      );
      const grouped: string = `020 ${drawnDigitsOf(4, "7")} ${drawnDigitsOf(4)}`;
      const fullwidth: string = toFullwidth(`0${drawnDigitsOf(10, "8")}`);

      return {
        positives: [
          labelled("phone-number", london, london, "user.phone"),
          labelled("phone-number", mobile, mobile, "customer.mobile"),
          labelled("phone-number", msisdn, msisdn, "msisdn"),
          labelled("phone-number", grouped, grouped, "phone_number"),
          labelled("phone-number", fullwidth, fullwidth, "contact.telephone"),
        ],
        nearMisses: [
          labelled("phone-number", london, "", "order.id"),
          labelled("phone-number", msisdn, "", "request.number"),
          labelled("phone-number", "000000000", "", "user.phone"),
        ],
      };
    },
  /*
   * #11383: nine digits in a row alone under a key that names a Social
   * Security number - customer.ssn, applicant.social_security_number,
   * ss.number - and the same digits under a key that names nothing, or an
   * area no one is issued under the key that names one.
   */
  "us-ssn: nine digits alone under a key that names an SSN": (): CorpusEntry => {
    const first: string = drawnUntaken(
      "us-ssn",
      (): string => {
        return drawnSsn().split("-").join("");
      },
      (drawn: string): string => {
        return drawn;
      },
    );
    const second: string = drawnUntaken(
      "us-ssn",
      (): string => {
        return drawnSsn().split("-").join("");
      },
      (drawn: string): string => {
        return `666${drawn.slice(3)}`;
      },
    );
    const third: string = drawnUntaken(
      "us-ssn",
      (): string => {
        return drawnSsn().split("-").join("");
      },
      (drawn: string): string => {
        return `ref ${drawn}`;
      },
    );
    const fullwidth: string = toFullwidth(drawnSsn().split("-").join(""));

    return {
      positives: [
        labelled("us-ssn", first, first, "customer.ssn"),
        labelled("us-ssn", second, second, "applicant.social_security_number"),
        labelled("us-ssn", `ref ${third}`, third, "ss.number"),
        labelled("us-ssn", fullwidth, fullwidth, "ssn"),
      ],
      nearMisses: [
        labelled("us-ssn", first, "", "order.id"),
        labelled("us-ssn", `666${second.slice(3)}`, "", "customer.ssn"),
      ],
    };
  },
  /*
   * #11385: a phone number whose groups are set apart by another dash -
   * the prolonged sound mark of a number typed in Japanese, a non-breaking
   * hyphen, an en dash, a figure dash - and what reads as no phone number
   * so: a katakana word's ー beside a digit, a range, a time zone and a
   * date.
   */
  "phone-number: its groups set apart by a typeset dash or a prolonged sound mark": (): CorpusEntry => {
    const tokyo: string = toFullwidth(
      `+81 3-${drawnDigitsOf(4, "1")}-${drawnDigitsOf(4)}`,
    )
      .split("－")
      .join("ー");
    const london: string = `+44 20 ${drawnDigitsOf(4, "7")}‑${drawnDigitsOf(4)}`;
    const sanFrancisco: string = `(${drawnExchange()}) ${drawnExchange()}–${drawnDigitsOf(4)}`;
    const paris: string = `+33 1‒${drawnDigitsOf(2)}‒${drawnDigitsOf(2)}‒${drawnDigitsOf(2)}‒${drawnDigitsOf(2)}`;
    // Halfwidth katakana text writes the halfwidth prolonged sound mark.
    const osaka: string = `+81 6ｰ${drawnDigitsOf(4, "1")}ｰ${drawnDigitsOf(4)}`;

    return {
      positives: [
        labelled("phone-number", `電話 ${tokyo}`, tokyo),
        labelled("phone-number", `ﾃﾞﾝﾜ ${osaka}`, osaka),
        labelled(
          "phone-number",
          `2026-10-27T10:15:02Z INFO call ${london} queued`,
          london,
        ),
        labelled("phone-number", `{"tel": "${sanFrancisco}"}`, sanFrancisco),
        labelled("phone-number", `fax ${paris}`, paris),
      ],
      nearMisses: [
        labelled("phone-number", `サーバー3台 データ2ー${1 + random(8)}件`, ""),
        labelled(
          "phone-number",
          `pages 10–20 of 2020–2026 call later`,
          "",
        ),
        labelled(
          "phone-number",
          `at UTC +1 2026−11−${10 + random(18)} 10:15:00`,
          "",
        ),
      ],
    };
  },
  // #11385: a Social Security number whose groups are set apart by another dash, and what is none so.
  "us-ssn: its groups set apart by a typeset dash or a prolonged sound mark": (): CorpusEntry => {
    const typed: string = toFullwidth(drawnSsn()).split("－").join("ー");
    const enDash: string = drawnSsn().split("-").join("–");
    const minus: string = drawnSsn().split("-").join("−");

    return {
      positives: [
        labelled("us-ssn", `SSN：${typed}`, typed),
        labelled(
          "us-ssn",
          `2026-10-27T10:15:02Z INFO applicant ssn ${enDash} verified`,
          enDash,
        ),
        labelled("us-ssn", `{"ssn": "${minus}"}`, minus),
      ],
      nearMisses: [
        labelled(
          "us-ssn",
          `SSN 666–${drawnSsn().slice(4).split("-").join("–")}`,
          "",
        ),
        labelled("us-ssn", `ref ${enDash}–${drawnDigitsOf(2)}`, ""),
      ],
    };
  },
  // #11385: a card whose groups are set apart by another dash, and a check digit off so.
  "credit-card-number: its groups set apart by a typeset dash or a prolonged sound mark": (): CorpusEntry => {
    // Drawn again while a near miss of it is another type's value.
    const card: string = drawnUntaken(
      "credit-card-number",
      drawnCard,
      (drawn: string): string => {
        return `card ${inGroupsOfFour(checkDigitOff(drawn), "–")} order ${inGroupsOfFour(drawn, "‒").slice(0, 14)}`;
      },
    );
    const other: string = drawnCard();
    const enDashed: string = inGroupsOfFour(card, "–");
    const typed: string = toFullwidth(inGroupsOfFour(other, "-"))
      .split("－")
      .join("ー");

    return {
      positives: [
        labelled(
          "credit-card-number",
          `2026-10-27T10:15:02Z INFO card ${enDashed} charged`,
          enDashed,
        ),
        labelled("credit-card-number", `カード番号：${typed}`, typed),
      ],
      nearMisses: [
        labelled(
          "credit-card-number",
          `2026-10-27T10:15:02Z INFO card ${inGroupsOfFour(checkDigitOff(card), "–")} charged`,
          "",
        ),
        labelled(
          "credit-card-number",
          `order ${inGroupsOfFour(card, "‒").slice(0, 14)} shipped`,
          "",
        ),
      ],
    };
  },
  /*
   * #11385: an email address typed in fullwidth, as an input method in
   * fullwidth mode types one - and one with its "@" alone in fullwidth -
   * and what is none typed so: CJK prose with fullwidth letters and an
   * "@", an address with no top-level domain.
   */
  "email-address: typed in fullwidth": (): CorpusEntry => {
    const typed: string = allInFullwidth(
      `${fake(LOWER, 4 + random(5))}.${fake(LOWER, 3 + random(5))}@${drawnDomain()}`,
    );
    const atOnly: string = `${fake(LOWER, 5 + random(5))}＠${drawnDomain()}`;

    return {
      positives: [
        labelled("email-address", `メール ${typed} に送信しました`, typed),
        labelled("email-address", `連絡先：${atOnly}`, atOnly),
      ],
      nearMisses: [
        labelled("email-address", "ＩＴ部門＠本社 へ連絡してください", ""),
        labelled(
          "email-address",
          `メール ${allInFullwidth(`${fake(LOWER, 6)}@localhost`)} に送信`,
          "",
        ),
      ],
    };
  },
  // #11385: an IBAN typed in fullwidth letters and digits, its groups apart by ideographic spaces, and one a digit off.
  "iban: typed in fullwidth letters": (): CorpusEntry => {
    // Drawn again while its groups, or its near miss's, are another type's value: a card's.
    const groupedOf: (iban: string) => string = (iban: string): string => {
      return `振込先 IBAN：${allInFullwidth(ibanInGroups(iban, " "))}`;
    };
    const wholeOf: (iban: string) => string = (iban: string): string => {
      return `口座 ${allInFullwidth(iban)} へ`;
    };
    const first: string = drawnUntaken(
      "iban",
      drawnIban,
      (drawn: string): string => {
        return `${groupedOf(drawn)} ${groupedOf(checkDigitOff(drawn))}`;
      },
    );
    const second: string = drawnUntaken(
      "iban",
      drawnIban,
      (drawn: string): string => {
        return `${wholeOf(drawn)} ${wholeOf(drawn.slice(0, -1))}`;
      },
    );
    const grouped: string = allInFullwidth(ibanInGroups(first, " "));
    const whole: string = allInFullwidth(second);

    return {
      positives: [
        labelled("iban", groupedOf(first), grouped),
        labelled("iban", wholeOf(second), whole),
      ],
      nearMisses: [
        labelled("iban", groupedOf(checkDigitOff(first)), ""),
        labelled("iban", wholeOf(second.slice(0, -1)), ""),
      ],
    };
  },
  // #11385: a UK postcode typed in fullwidth, and letters no inward code takes typed so.
  "postal-code: a UK postcode typed in fullwidth": (): CorpusEntry => {
    const first: string = allInFullwidth(drawnUkPostcode());
    const second: string = allInFullwidth(drawnUkPostcode());

    return {
      positives: [
        labelled("postal-code", `postcode ${first}`, first),
        labelled("postal-code", `{"address": "${second}"}`, second),
      ],
      nearMisses: [
        labelled(
          "postal-code",
          `postcode ${allInFullwidth(`SW${1 + random(9)}A ${random(10)}CI`)}`,
          "",
        ),
        labelled(
          "postal-code",
          `postcode ${allInFullwidth(`SW${1 + random(9)}A${random(10)}AA`)}`,
          "",
        ),
      ],
    };
  },
  /*
   * #11385: a national phone number and nine digits in a row beside the
   * words that name them typed in fullwidth - ＴＥＬ, ＳＳＮ - and the same
   * digits beside words that name neither, or a word inside another.
   */
  "phone-number and us-ssn: their words typed in fullwidth": (): CorpusEntry => {
    const national: string = toFullwidth(`0${drawnDigitsOf(10, "3")}`);
    const ssn: string = toFullwidth(drawnSsn().split("-").join(""));

    return {
      positives: [
        labelled("phone-number", `ＴＥＬ　${national}`, national),
        labelled("us-ssn", `ＳＳＮ：${ssn}`, ssn),
      ],
      nearMisses: [
        labelled("phone-number", `ＩＤ　${national}`, ""),
        labelled("phone-number", `ＴＥＬＥＭＥＴＲＹ　${national}`, ""),
        labelled("us-ssn", `ＲＥＦ　${ssn}`, ""),
      ],
    };
  },
  // #10936
  "ip-address: right after a key's colon": (): CorpusEntry => {
    const first: string = drawnIpv6();
    const second: string = drawnIpv6();

    return {
      positives: [
        labelled(
          "ip-address",
          `2026-10-27T10:15:02Z INFO connection accepted peer ip:${first} port=443`,
          first,
        ),
        labelled(
          "ip-address",
          `level=info msg="accepted" remote:${second} user=svc`,
          second,
        ),
      ],
      nearMisses: [
        labelled(
          "ip-address",
          `2026-10-27T10:15:02Z INFO tick time:${10 + random(13)}:${10 + random(50)}:${10 + random(50)} ok`,
          "",
        ),
        labelled(
          "ip-address",
          `level=info msg="local" peer ip:fe80::${fake(HEX, 4)} user=svc`,
          "",
        ),
      ],
    };
  },
  // #10935
  "email-address: in a percent-encoded URL": (): CorpusEntry => {
    const first: string = `${fake(LOWER, 4 + random(4))}.${fake(LOWER, 3 + random(5))}%40${drawnDomain()}`;
    const second: string = `${fake(LOWER, 5 + random(4))}%2Bnews%40${drawnDomain()}`;

    return {
      positives: [
        labelled(
          "email-address",
          `2026-10-27T10:15:02Z INFO GET /signup?email=${first} HTTP/1.1 200`,
          first,
        ),
        labelled(
          "email-address",
          `{"url": "/welcome?to=${second}&step=2", "batch": "nightly"}`,
          second,
        ),
      ],
      nearMisses: [
        labelled(
          "email-address",
          `2026-10-27T10:15:02Z INFO GET /assets/${fake(LOWER, 6)}%402x.png HTTP/1.1 200`,
          "",
        ),
        labelled(
          "email-address",
          `{"url": "/search?q=${fake(LOWER, 6)}%40&step=2", "batch": "nightly"}`,
          "",
        ),
      ],
    };
  },
  // #11031: each the corpus's own drawn value, written into a redirect's encoded URL.
  "secrets: in a percent-encoded URL": (
    corpus: Record<string, CorpusEntry>,
  ): CorpusEntry => {
    const valueOf: (dataTypeId: string) => string = (
      dataTypeId: string,
    ): string => {
      return corpus[dataTypeId]!.positives[0]!.value;
    };
    const github: string = valueOf("github-token");
    const stripe: string = valueOf("stripe-secret-key");
    const slack: string = valueOf("slack-token");
    const awsKey: string = valueOf("aws-access-key-id");
    const jwt: string = valueOf("json-web-token");

    return {
      positives: [
        labelled(
          "github-token",
          `2026-10-27T10:15:02Z INFO GET /login?next=https%3A%2F%2Fapp.example.com%2Fcb%3Ftoken%3D${github} HTTP/1.1 302`,
          github,
        ),
        labelled(
          "stripe-secret-key",
          `{"url": "/pay?return=%2Fdone%3Fkey%3D${stripe}&step=2", "batch": "nightly"}`,
          stripe,
        ),
        labelled(
          "slack-token",
          `2026-10-27T10:15:02Z INFO GET /hook?next=%2Fapi%3Ftoken%3D${slack} HTTP/1.1 200`,
          slack,
        ),
        labelled(
          "aws-access-key-id",
          `{"url": "/s3?credential%3D${awsKey}%2F20261027%2Feu-west-1", "batch": "nightly"}`,
          awsKey,
        ),
        labelled(
          "json-web-token",
          `2026-10-27T10:15:02Z INFO GET /sso?next=%2Fcb%3Fid_token%3D${jwt} HTTP/1.1 302`,
          jwt,
        ),
      ],
      nearMisses: [
        labelled(
          "github-token",
          `2026-10-27T10:15:02Z INFO GET /login?next=%2Fcb%3Ftoken%3D${github.slice(0, 12)} HTTP/1.1 302`,
          "",
        ),
        labelled(
          "stripe-secret-key",
          `{"url": "/assets/sk%5Flive%5F${fake(LOWER, 6)}.png", "batch": "nightly"}`,
          "",
        ),
        labelled(
          "aws-access-key-id",
          `{"url": "/s3?credential%3D${awsKey.slice(0, 12)}%2F20261027", "batch": "nightly"}`,
          "",
        ),
      ],
    };
  },
  // #11032
  "email-address: its characters' UTF-8 bytes percent-encoded":
    (): CorpusEntry => {
      const accented: string = `${fake(LOWER, 3)}${encodeURIComponent(fake(LATIN_ACCENTED, 1))}${fake(LOWER, 3)}%40${drawnDomain()}`;
      const han: string = `${encodeURIComponent(fake(HAN, 2 + random(2)))}%40${drawnDomain()}`;
      const domain: string = `${fake(LOWER, 5)}@${encodeURIComponent(fake(HAN, 2 + random(2)))}.jp`;

      return {
        positives: [
          labelled(
            "email-address",
            `2026-10-27T10:15:02Z INFO GET /signup?email=${accented} HTTP/1.1 200`,
            accented,
          ),
          labelled(
            "email-address",
            `{"url": "/invite?to=${han}&step=2", "batch": "nightly"}`,
            han,
          ),
          labelled(
            "email-address",
            `2026-10-27T10:15:02Z INFO GET /verify?address=${domain} HTTP/1.1 200`,
            domain,
          ),
        ],
        nearMisses: [
          labelled(
            "email-address",
            `2026-10-27T10:15:02Z INFO GET /assets/${encodeURIComponent(fake(HAN, 2))}%402x.png HTTP/1.1 200`,
            "",
          ),
          labelled(
            "email-address",
            `{"url": "/search?q=${encodeURIComponent(fake(HAN, 3))}%40&step=2", "batch": "nightly"}`,
            "",
          ),
          labelled(
            "email-address",
            `2026-10-27T10:15:02Z INFO GET /q?name=caf%C3%A9%40%C3 HTTP/1.1 200`,
            "",
          ),
        ],
      };
    },
  // #10960
  "email-address: in another script": (): CorpusEntry => {
    const han: string = `${fake(HAN, 2 + random(2))}@${drawnDomain()}`;
    const cyrillic: string = `${fake(CYRILLIC, 5 + random(4))}@${fake(CYRILLIC, 6 + random(4))}.рф`;
    const latin: string = `${fake(LOWER, 3)}${fake(LATIN_ACCENTED, 1)}${fake(LOWER, 3)}@${drawnDomain()}`;

    return {
      positives: [
        labelled(
          "email-address",
          `2026-10-27T10:15:02Z INFO invite sent to ${han} ok`,
          han,
        ),
        labelled(
          "email-address",
          `{"email": "${cyrillic}", "batch": "nightly"}`,
          cyrillic,
        ),
        labelled(
          "email-address",
          `2026-10-27T10:15:02Z INFO invite sent to ${latin} ok`,
          latin,
        ),
      ],
      nearMisses: [
        labelled(
          "email-address",
          `2026-10-27T10:15:02Z INFO mention ${fake(HAN, 2)}@${fake(HAN, 3)} ok`,
          "",
        ),
        labelled(
          "email-address",
          `{"handle": "${fake(CYRILLIC, 5)}@${fake(CYRILLIC, 6)}.р", "batch": "nightly"}`,
          "",
        ),
      ],
    };
  },
  // #10960
  "credit-card-number: in another script's digits": (): CorpusEntry => {
    const card: string = drawnCard();
    const off: string = card.slice(0, 15) + String((Number(card[15]) + 1) % 10);
    const grouped: (digits: string, separator: string) => string = (
      digits: string,
      separator: string,
    ): string => {
      return digits.replace(/([0-9]{4})(?=[0-9])/g, `$1${separator}`);
    };
    const fullwidth: string = inScript(grouped(card, " "), FULLWIDTH_ZERO);
    const arabic: string = inScript(card, ARABIC_INDIC_ZERO);
    const persian: string = inScript(grouped(card, "-"), PERSIAN_ZERO);
    const mixed: string =
      inScript(card.slice(0, 4), FULLWIDTH_ZERO) +
      " " +
      grouped(card.slice(4), " ");

    return {
      positives: [
        labelled("credit-card-number", `カード番号：${fullwidth}`, fullwidth),
        labelled("credit-card-number", `رقم البطاقة ${arabic}`, arabic),
        labelled("credit-card-number", `شماره کارت ${persian}`, persian),
        labelled("credit-card-number", `card ${mixed} declined`, mixed),
      ],
      nearMisses: [
        labelled(
          "credit-card-number",
          `カード番号：${inScript(grouped(off, " "), FULLWIDTH_ZERO)}`,
          "",
        ),
        labelled(
          "credit-card-number",
          `رقم البطاقة ${inScript(off, ARABIC_INDIC_ZERO)}`,
          "",
        ),
      ],
    };
  },
  /*
   * #11034: a person's name in a URL's query string, under a parameter
   * named as a column of names would be, written as a URL writes it -
   * escaped, a character's UTF-8 bytes too, a "+" for a space, in another
   * script. Not under a parameter named "name" alone, a product's, nor a
   * value no one is called: the model reads those.
   */
  "person-name: in a URL's query string, by the parameter's name":
    (): CorpusEntry => {
      const given: string = `${fake(UPPER, 1)}${fake(LOWER, 4 + random(4))}`;
      const family: string = `${fake(UPPER, 1)}${fake(LOWER, 5 + random(5))}`;
      const accented: string = `${given}%20${fake(UPPER, 1)}${fake(LOWER, 3)}${encodeURIComponent(fake(LATIN_ACCENTED, 1))}${fake(LOWER, 2)}`;
      const plus: string = `${given}+${family}`;
      const han: string = encodeURIComponent(fake(HAN, 2 + random(2)));

      return {
        positives: [
          labelled(
            "person-name",
            `2026-10-27T10:15:02Z INFO GET /profile?full_name=${accented}&tab=orders HTTP/1.1 200`,
            accented,
          ),
          labelled(
            "person-name",
            `{"url": "/api/contacts?customer_name=${plus}&source=import", "batch": "nightly"}`,
            plus,
          ),
          labelled(
            "person-name",
            `2026-10-27T10:15:02Z INFO GET /patients?patient_name=${han}&page=2 HTTP/1.1 200`,
            han,
          ),
        ],
        nearMisses: [
          labelled(
            "person-name",
            `2026-10-27T10:15:02Z INFO GET /profile?name=${accented}&tab=orders HTTP/1.1 200`,
            "",
          ),
          labelled(
            "person-name",
            `{"url": "/shop?product_name=${given}%20${family}&sort[last_name]=desc", "batch": "nightly"}`,
            "",
          ),
          labelled(
            "person-name",
            `2026-10-27T10:15:02Z INFO GET /download?fname=${fake(LOWER, 6)}.pdf&first_name=null HTTP/1.1 200`,
            "",
          ),
        ],
      };
    },
};

/*
 * #11033: every type whose detectors read every script's digits, its own
 * drawn values and near misses written in another script's digits -
 * Arabic-Indic and fullwidth for the values, Persian for the near misses,
 * the words around them as they were. A number is the same number in any
 * script's digits, so each value is found as its type, and each near miss
 * - a check digit off, a digit too many - refused, as in ASCII.
 */
const ASCII_DIGIT: RegExp = /[0-9]/;

const EVERY_SCRIPT_TYPES: ReadonlyArray<string> = Array.from(
  new Set(
    BUILT_IN_DETECTORS.filter((detector: DataTypeDetector): boolean => {
      return detector.readsDigitsOfEveryScript === true;
    }).map((detector: DataTypeDetector): string => {
      return detector.dataTypeId;
    }),
  ),
).sort();

function everyScriptCases(
  corpus: Record<string, CorpusEntry>,
): Record<string, CorpusEntry> {
  const cases: Record<string, CorpusEntry> = {};
  const valueZeros: ReadonlyArray<number> = [ARABIC_INDIC_ZERO, FULLWIDTH_ZERO];

  for (const dataTypeId of EVERY_SCRIPT_TYPES) {
    const entry: CorpusEntry | undefined = corpus[dataTypeId];

    if (!entry) {
      continue;
    }

    cases[`${dataTypeId}: its values in another script's digits`] = {
      positives: entry.positives.map(
        (positive: Labelled, index: number): Labelled => {
          const zero: number = valueZeros[index % valueZeros.length]!;

          return labelled(
            positive.dataTypeId,
            inScript(positive.text, zero),
            inScript(positive.value, zero),
          );
        },
      ),
      nearMisses: entry.nearMisses.map((nearMiss: Labelled): Labelled => {
        return labelled(
          nearMiss.dataTypeId,
          inScript(nearMiss.text, PERSIAN_ZERO),
          "",
        );
      }),
    };
  }

  return cases;
}

/*
 * #11199: every type whose detectors read a text as a URL's query string
 * writes it - a "+" for each space - its own drawn values and near misses
 * as a URL holds them: the log line or the JSON text each is written in,
 * sent as a query parameter's value, percent-encoded as encodeURIComponent
 * writes it (a space %20, a colon %3A) and as a form writes it
 * (URLSearchParams: a space "+", a "+" %2B). A value is the same value
 * however a URL writes it - its check digit and the words around it prove
 * it the same way - so each is found as its type, on the characters the
 * URL writes it with, and each near miss refused, as when written plainly.
 */
const PLUS_AS_SPACE_TYPES: ReadonlyArray<string> = Array.from(
  new Set(
    BUILT_IN_DETECTORS.filter((detector: DataTypeDetector): boolean => {
      return detector.readsPlusAsSpace === true;
    }).map((detector: DataTypeDetector): string => {
      return detector.dataTypeId;
    }),
  ),
).sort();

// A text as a form writes it into a query string: a space "+", a "+" %2B, the rest escaped.
function asAFormWritesIt(text: string): string {
  return new URLSearchParams({ line: text }).toString().slice("line=".length);
}

// The ways a URL writes a text: each value's two, in turn.
const URL_WRITINGS: ReadonlyArray<(text: string) => string> = [
  encodeURIComponent,
  asAFormWritesIt,
];

function inAUrl(text: string, write: (text: string) => string): string {
  return `2026-10-27T10:15:02Z INFO GET /records?line=${write(text)}&page=2 HTTP/1.1 200`;
}

/*
 * Each value and each near miss written both ways. A near miss whose URL
 * writing is another type's value as written is left out, as the corpus
 * leaves out such a near miss of its own (isTakenByAnotherType): a form's
 * "+" for a space can spell another type's own writing - a South African
 * ID's 051214 2647 143 is 051214+2647+143, and 051214+2647 is a Swedish
 * personnummer as a centenarian's is written.
 */
function inAUrlCases(
  corpus: Record<string, CorpusEntry>,
): Record<string, CorpusEntry> {
  const cases: Record<string, CorpusEntry> = {};

  for (const dataTypeId of PLUS_AS_SPACE_TYPES) {
    const entry: CorpusEntry | undefined = corpus[dataTypeId];

    if (!entry) {
      continue;
    }

    const positives: Array<Labelled> = [];
    const nearMisses: Array<Labelled> = [];

    for (const write of URL_WRITINGS) {
      for (const positive of entry.positives) {
        positives.push(
          labelled(
            positive.dataTypeId,
            inAUrl(positive.text, write),
            write(positive.value),
          ),
        );
      }

      for (const nearMiss of entry.nearMisses) {
        const text: string = inAUrl(nearMiss.text, write);

        if (!isTakenByAnotherType(dataTypeId, text)) {
          nearMisses.push(labelled(nearMiss.dataTypeId, text, ""));
        }
      }
    }

    cases[`${dataTypeId}: its values in a URL's query string`] = {
      positives,
      nearMisses,
    };
  }

  return cases;
}

/*
 * #11115: every type whose detectors read a number's fullwidth forms - as
 * every one of every script's digits does - its own drawn values and near
 * misses with their numbers typed wholly in fullwidth (numbersInFullwidth):
 * the digits, the plus signs, hyphens, parentheses, full stops and solidi,
 * the spaces between a number's groups ideographic ones, the words around
 * them as they were. A number is the same number however it is typed, so
 * each value is found as its type, and each near miss refused, as in
 * ASCII.
 */
const FULLWIDTH_TYPES: ReadonlyArray<string> = Array.from(
  new Set(
    BUILT_IN_DETECTORS.filter((detector: DataTypeDetector): boolean => {
      return detector.readsFullwidthForms === true;
    }).map((detector: DataTypeDetector): string => {
      return detector.dataTypeId;
    }),
  ),
).sort();

function fullwidthCases(
  corpus: Record<string, CorpusEntry>,
): Record<string, CorpusEntry> {
  const cases: Record<string, CorpusEntry> = {};

  for (const dataTypeId of FULLWIDTH_TYPES) {
    const entry: CorpusEntry | undefined = corpus[dataTypeId];

    if (!entry) {
      continue;
    }

    const positives: Array<Labelled> = entry.positives.map(
      (positive: Labelled): Labelled => {
        const text: string = numbersInFullwidth(positive.text);
        const start: number = positive.text.indexOf(positive.value);

        // One character for one: the value is where it was, typed in fullwidth.
        return labelled(
          positive.dataTypeId,
          text,
          text.slice(start, start + positive.value.length),
        );
      },
    );
    const nearMisses: Array<Labelled> = [];

    for (const nearMiss of entry.nearMisses) {
      const text: string = numbersInFullwidth(nearMiss.text);

      if (!isTakenByAnotherType(dataTypeId, text)) {
        nearMisses.push(labelled(nearMiss.dataTypeId, text, ""));
      }
    }

    cases[`${dataTypeId}: its values typed wholly in fullwidth`] = {
      positives,
      nearMisses,
    };
  }

  return cases;
}

/*
 * #11385: every type whose detectors read a number's fullwidth forms - and
 * so the other dashes between two digits - its own drawn values and near
 * misses with each hyphen between two digits written as another dash, in
 * turn (withOtherDashes): 536-22-8731 as 536–22−8731. A number is the same
 * number whatever dash sets its groups apart, so each value is found as
 * its type, and each near miss refused, as with hyphens. A type whose
 * values a draw writes with no hyphen between digits reads as it is.
 */
function otherDashCases(
  corpus: Record<string, CorpusEntry>,
): Record<string, CorpusEntry> {
  const cases: Record<string, CorpusEntry> = {};

  for (const dataTypeId of FULLWIDTH_TYPES) {
    const entry: CorpusEntry | undefined = corpus[dataTypeId];

    if (!entry) {
      continue;
    }

    const positives: Array<Labelled> = entry.positives.map(
      (positive: Labelled, index: number): Labelled => {
        const text: string = withOtherDashes(positive.text, index * 3);
        const start: number = positive.text.indexOf(positive.value);

        return labelled(
          positive.dataTypeId,
          text,
          text.slice(start, start + positive.value.length),
        );
      },
    );

    const nearMisses: Array<Labelled> = [];

    entry.nearMisses.forEach((nearMiss: Labelled, index: number): void => {
      const text: string = withOtherDashes(nearMiss.text, index * 3 + 1);

      if (!isTakenByAnotherType(dataTypeId, text)) {
        nearMisses.push(labelled(nearMiss.dataTypeId, text, ""));
      }
    });

    cases[`${dataTypeId}: its groups set apart by another dash`] = {
      positives,
      nearMisses,
    };
  }

  return cases;
}

/*
 * #11385: every type whose detectors read a value typed in fullwidth
 * letters, its own drawn values and near misses typed wholly in fullwidth
 * (allInFullwidth): every letter, digit, sign and punctuation mark of the
 * log line or the JSON text each is written in, its spaces ideographic
 * ones - so the words beside each value are typed in fullwidth too. A value
 * is the same value however it is typed, so each is found as its type, on
 * the characters it is typed with, and each near miss refused, as in
 * ASCII.
 */
const FULLWIDTH_LETTERS_TYPES: ReadonlyArray<string> = Array.from(
  new Set(
    BUILT_IN_DETECTORS.filter((detector: DataTypeDetector): boolean => {
      return detector.readsFullwidthLetters === true;
    }).map((detector: DataTypeDetector): string => {
      return detector.dataTypeId;
    }),
  ),
).sort();

function fullwidthLettersCases(
  corpus: Record<string, CorpusEntry>,
): Record<string, CorpusEntry> {
  const cases: Record<string, CorpusEntry> = {};

  for (const dataTypeId of FULLWIDTH_LETTERS_TYPES) {
    const entry: CorpusEntry | undefined = corpus[dataTypeId];

    if (!entry) {
      continue;
    }

    const positives: Array<Labelled> = entry.positives.map(
      (positive: Labelled): Labelled => {
        const text: string = allInFullwidth(positive.text);
        const start: number = positive.text.indexOf(positive.value);

        return labelled(
          positive.dataTypeId,
          text,
          text.slice(start, start + positive.value.length),
        );
      },
    );
    const nearMisses: Array<Labelled> = [];

    for (const nearMiss of entry.nearMisses) {
      const text: string = allInFullwidth(nearMiss.text);

      if (!isTakenByAnotherType(dataTypeId, text)) {
        nearMisses.push(labelled(nearMiss.dataTypeId, text, ""));
      }
    }

    cases[`${dataTypeId}: its values typed wholly in fullwidth, letters too`] =
      { positives, nearMisses };
  }

  return cases;
}

function buildReadingCases(corpusSeed: number): Record<string, CorpusEntry> {
  const cases: Record<string, CorpusEntry> = {};
  // The corpus of this seed: what the cases built from its values read.
  const corpus: Record<string, CorpusEntry> =
    corpusSeed === CORPUS_SEED ? CORPUS : buildCorpus(corpusSeed);

  for (const [name, build] of Object.entries(READING_CASES_OF)) {
    random = seededRandom(seedOf(corpusSeed, `readings:${name}`));
    cases[name] = build(corpus);
  }

  return {
    ...cases,
    ...everyScriptCases(corpus),
    ...inAUrlCases(corpus),
    ...fullwidthCases(corpus),
    ...otherDashCases(corpus),
    ...fullwidthLettersCases(corpus),
  };
}

// The seeds besides the corpus's own the reading cases are held to (#11199, #11200).
const OTHER_READING_SEEDS: ReadonlyArray<number> = [1, 2, 3, 50, 77];

const READING_CASES: Record<string, CorpusEntry> =
  buildReadingCases(CORPUS_SEED);

interface Tally {
  right: number;
  wrong: Array<string>;
}

interface Scores {
  byType: Map<string, Tally>;
  found: number;
  positives: number;
  missed: Array<string>;
}

function score(corpus: Record<string, CorpusEntry>): Scores {
  const byType: Map<string, Tally> = new Map();
  const tallyOf: (dataTypeId: string) => Tally = (
    dataTypeId: string,
  ): Tally => {
    let tally: Tally | undefined = byType.get(dataTypeId);

    if (!tally) {
      tally = { right: 0, wrong: [] };
      byType.set(dataTypeId, tally);
    }

    return tally;
  };
  const scores: Scores = { byType, found: 0, positives: 0, missed: [] };

  for (const entry of Object.values(corpus)) {
    for (const positive of entry.positives) {
      const start: number = positive.text.indexOf(positive.value);
      const end: number = start + positive.value.length;
      let found: boolean = false;

      scores.positives++;

      for (const match of findAsRead(
        positive.text,
        {},
        positive.field,
      ).filter(isSure)) {
        if (
          match.dataTypeId === positive.dataTypeId &&
          match.start < end &&
          start < match.end
        ) {
          tallyOf(match.dataTypeId).right++;
          found = true;
        } else if (!isKnownConfusion(match.dataTypeId, positive.dataTypeId)) {
          tallyOf(match.dataTypeId).wrong.push(
            `${positive.dataTypeId} example: ${positive.text}`,
          );
        }
      }

      if (found) {
        scores.found++;
      } else {
        scores.missed.push(`${positive.dataTypeId}: ${positive.text}`);
      }
    }

    for (const nearMiss of entry.nearMisses) {
      for (const match of findAsRead(nearMiss.text, {}, nearMiss.field).filter(
        isSure,
      )) {
        if (!isKnownConfusion(match.dataTypeId, nearMiss.dataTypeId)) {
          tallyOf(match.dataTypeId).wrong.push(
            `${nearMiss.dataTypeId} near miss: ${nearMiss.text}`,
          );
        }
      }
    }
  }

  return scores;
}

describe("the accuracy corpus", () => {
  test("has two values and two near misses of every type found by value", () => {
    const short: Array<string> = VALUE_TYPES.filter((info: DataTypeInfo) => {
      return (
        CORPUS[info.id]!.positives.length < 2 ||
        CORPUS[info.id]!.nearMisses.length < 2
      );
    }).map((info: DataTypeInfo) => {
      return `${info.id}: ${CORPUS[info.id]!.positives.length} values, ${CORPUS[info.id]!.nearMisses.length} near misses`;
    });

    expect(short).toEqual([]);
  });

  test("writes down why each confusion it forgives is one the engine cannot avoid", () => {
    for (const confusion of KNOWN_CONFUSIONS) {
      expect(confusion.reason.length).toBeGreaterThan(60);
      expect(
        VALUE_TYPES.map((info: DataTypeInfo) => {
          return info.id;
        }),
      ).toEqual(expect.arrayContaining([confusion.found, confusion.label]));
    }
  });

  test("is made of values each type's own detectors take, and near misses they refuse", () => {
    const wrong: Array<string> = [];

    for (const [dataTypeId, entry] of Object.entries(CORPUS)) {
      for (const positive of entry.positives) {
        if (!isFoundAlone(dataTypeId, positive.text, positive.value)) {
          wrong.push(`not found alone: ${positive.text}`);
        }
      }

      for (const nearMiss of entry.nearMisses) {
        if (!isRefusedAlone(dataTypeId, nearMiss.text)) {
          wrong.push(`found alone: ${nearMiss.text}`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  /*
   * #10468: each type draws from its own stream, so what one type draws
   * cannot depend on any other's - drawn alone, or with the catalog read the
   * other way round, every type draws the same values and near misses.
   */
  test("draws each type from a stream of its own, whatever the other types draw", () => {
    const reversed: Record<string, CorpusEntry> = buildCorpus(
      CORPUS_SEED,
      [...VALUE_TYPES].reverse(),
    );
    const differ: Array<string> = VALUE_TYPES.filter((info: DataTypeInfo) => {
      return (
        JSON.stringify(reversed[info.id]) !== JSON.stringify(CORPUS[info.id])
      );
    }).map((info: DataTypeInfo) => {
      return info.id;
    });

    expect(differ).toEqual([]);

    for (const id of ["ip-address", "passport-number", "credit-card-number"]) {
      const info: DataTypeInfo = VALUE_TYPES.find((type: DataTypeInfo) => {
        return type.id === id;
      })!;

      expect(buildCorpus(CORPUS_SEED, [info])[id]).toEqual(CORPUS[id]);
    }
  });

  test("seeds each type's stream from the corpus seed and the type's id", () => {
    expect(seedOf(CORPUS_SEED, "ip-address")).toBe(
      seedOf(CORPUS_SEED, "ip-address"),
    );
    expect(seedOf(CORPUS_SEED, "ip-address")).not.toBe(
      seedOf(CORPUS_SEED, "email-address"),
    );
    expect(seedOf(CORPUS_SEED, "ip-address")).not.toBe(
      seedOf(CORPUS_SEED + 1, "ip-address"),
    );

    const seeds: Set<number> = new Set(
      VALUE_TYPES.map((info: DataTypeInfo) => {
        return seedOf(CORPUS_SEED, info.id);
      }),
    );

    expect(seeds.size).toBe(VALUE_TYPES.length);

    for (const seed of seeds) {
      expect(Number.isSafeInteger(seed) && seed >= 0 && seed < 2 ** 32).toBe(
        true,
      );
    }
  });

  test("keeps no near miss another type takes as its own value", () => {
    const taken: Array<string> = [];

    for (const [dataTypeId, entry] of Object.entries(CORPUS)) {
      for (const nearMiss of entry.nearMisses) {
        if (isTakenByAnotherType(dataTypeId, nearMiss.text)) {
          taken.push(`${dataTypeId} near miss: ${nearMiss.text}`);
        }
      }
    }

    expect(taken).toEqual([]);
  });

  test("builds passport numbers from parts, beside the word, and refuses them without it", () => {
    const entry: CorpusEntry = CORPUS["passport-number"]!;

    expect(entry.positives).toHaveLength(2);
    expect(entry.nearMisses).toHaveLength(2);

    for (const positive of entry.positives) {
      expect(positive.value).toMatch(/^[A-Z]{1,2}[0-9]{7,8}$/);
      expect(positive.value).toHaveLength(9);
      expect(positive.text).toContain("passport");
    }

    expect(entry.nearMisses[0]!.text).not.toContain("passport");
    expect(entry.nearMisses[0]!.text).toContain(entry.positives[0]!.value);
  });

  const scores: Scores = score(CORPUS);

  test("finds what every type finds with a precision of at least 0.95", () => {
    const belowThreshold: Array<string> = [];

    for (const [dataTypeId, tally] of scores.byType) {
      const all: number = tally.right + tally.wrong.length;
      const precision: number = tally.right / all;

      if (precision < 0.95) {
        belowThreshold.push(
          `${dataTypeId}: precision ${precision.toFixed(2)} (${tally.right} right of ${all}); wrong in ${tally.wrong.join(" | ")}`,
        );
      }
    }

    expect(belowThreshold).toEqual([]);
  });

  test("finds at least 90% of the labelled values as their type", () => {
    const recall: number = scores.found / scores.positives;

    expect({
      recall: Number(recall.toFixed(3)),
      found: scores.found,
      positives: scores.positives,
      missed: recall >= 0.9 ? [] : scores.missed,
    }).toEqual({
      recall: expect.any(Number),
      found: expect.any(Number),
      positives: VALUE_TYPES.length * 2,
      missed: [],
    });
    expect([
      `recall ${recall.toFixed(3)}: missed ${scores.missed.join(" | ")}`,
      recall >= 0.9,
    ]).toEqual([expect.any(String), true]);
  });
});

describe("values written the ways the detectors now read them too", () => {
  test("each case has values its type's own detectors take, and near misses they refuse", () => {
    const wrong: Array<string> = [];

    for (const [name, entry] of Object.entries(READING_CASES)) {
      expect([name, entry.positives.length >= 2]).toEqual([name, true]);
      expect([name, entry.nearMisses.length >= 2]).toEqual([name, true]);

      for (const positive of entry.positives) {
        if (
          !isFoundAlone(
            positive.dataTypeId,
            positive.text,
            positive.value,
            positive.field,
          )
        ) {
          wrong.push(`not found alone: ${positive.text}`);
        }
      }

      for (const nearMiss of entry.nearMisses) {
        if (
          !isRefusedAlone(nearMiss.dataTypeId, nearMiss.text, nearMiss.field)
        ) {
          wrong.push(`found alone: ${nearMiss.text}`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  /*
   * A precision and a recall of 1: every labelled value found as its type,
   * and nothing else - no near miss, no other type - found in any of them.
   */
  test("finds every value, and nothing else, with every built-in detector (#10935, #10936, #10960, #11025, #11030 to #11034, #11114, #11115, #11199, #11200, #11383, #11385)", () => {
    const readingScores: Scores = score(READING_CASES);
    const wrong: Array<string> = [];

    for (const tally of readingScores.byType.values()) {
      wrong.push(...tally.wrong);
    }

    expect({ wrong, missed: readingScores.missed }).toEqual({
      wrong: [],
      missed: [],
    });
    expect(readingScores.found).toBe(readingScores.positives);
  });

  /*
   * The same at other seeds: every case drawn again - its values, its near
   * misses, the corpus its every-script and URL cases are written from -
   * and still every value found as its type and nothing else.
   */
  test.each(
    OTHER_READING_SEEDS.map((seed: number): [number] => {
      return [seed];
    }),
  )(
    "finds every value, and nothing else, at seed %i too (#11114, #11115, #11199, #11200, #11383, #11385)",
    (seed: number) => {
      const cases: Record<string, CorpusEntry> = buildReadingCases(seed);
      const readingScores: Scores = score(cases);
      const wrong: Array<string> = [];

      for (const tally of readingScores.byType.values()) {
        wrong.push(...tally.wrong);
      }

      expect({ seed, wrong, missed: readingScores.missed }).toEqual({
        seed,
        wrong: [],
        missed: [],
      });
      expect(readingScores.found).toBe(readingScores.positives);
      expect(Object.keys(cases)).toEqual(Object.keys(READING_CASES));
    },
  );

  test("writes every type read as a query string writes it in a URL, its values in a URL (#11199)", () => {
    expect(PLUS_AS_SPACE_TYPES).toEqual(
      expect.arrayContaining([
        "credit-card-number",
        "iban",
        "us-bank-routing-number",
        "us-ssn",
        "phone-number",
        "br-cpf",
        "in-aadhaar",
        "uk-nhs-number",
        "passport-number",
        "date-of-birth",
        "postal-code",
        "postal-address",
        "bank-account-number",
        "uk-sort-code",
        "card-verification-code",
        "card-expiration-date",
      ]),
    );

    const written: Array<string> = PLUS_AS_SPACE_TYPES.filter(
      (dataTypeId: string): boolean => {
        return Boolean(CORPUS[dataTypeId]);
      },
    );

    expect(written.length).toBeGreaterThan(60);

    for (const dataTypeId of written) {
      const entry: CorpusEntry =
        READING_CASES[`${dataTypeId}: its values in a URL's query string`]!;

      expect([dataTypeId, entry.positives.length]).toEqual([dataTypeId, 4]);

      // In a URL indeed: each value's text percent-encoded, then as a form writes it.
      for (const positive of entry.positives.slice(0, 2)) {
        expect([dataTypeId, positive.text]).toEqual([
          dataTypeId,
          expect.stringContaining("%20"),
        ]);
      }

      for (const positive of entry.positives.slice(2)) {
        expect([
          dataTypeId,
          positive.text.includes("%20"),
          positive.text.includes("+"),
        ]).toEqual([dataTypeId, false, true]);
      }
    }
  });

  test("writes every type read in every script's digits in another script's digits (#11033, #11200)", () => {
    expect(EVERY_SCRIPT_TYPES).toEqual(
      expect.arrayContaining([
        "iban",
        "us-bank-routing-number",
        "us-ssn",
        "phone-number",
        "credit-card-number",
        "br-cpf",
        "tr-tckn",
        "in-aadhaar",
        "es-dni",
        "uk-nhs-number",
        "us-npi",
        "passport-number",
        // #11200
        "date-of-birth",
        "postal-code",
        "bank-account-number",
        "uk-sort-code",
        "au-bsb",
        "swift-bic",
        "in-ifsc",
        "card-verification-code",
        "card-expiration-date",
      ]),
    );

    const written: Array<string> = EVERY_SCRIPT_TYPES.filter(
      (dataTypeId: string): boolean => {
        return Boolean(CORPUS[dataTypeId]);
      },
    );

    expect(written.length).toBeGreaterThan(60);

    for (const dataTypeId of written) {
      const entry: CorpusEntry =
        READING_CASES[`${dataTypeId}: its values in another script's digits`]!;

      expect([dataTypeId, entry.positives.length >= 2]).toEqual([
        dataTypeId,
        true,
      ]);
      // In another script's digits indeed: no ASCII digit is left in a value.
      for (const positive of entry.positives) {
        expect([dataTypeId, ASCII_DIGIT.test(positive.value)]).toEqual([
          dataTypeId,
          false,
        ]);
      }
    }
  });

  test("writes every type read in fullwidth with its numbers typed wholly in fullwidth (#11115)", () => {
    // Every detector of every script's digits reads a number's fullwidth forms too.
    expect(FULLWIDTH_TYPES).toEqual(EVERY_SCRIPT_TYPES);

    const written: Array<string> = FULLWIDTH_TYPES.filter(
      (dataTypeId: string): boolean => {
        return Boolean(CORPUS[dataTypeId]);
      },
    );

    expect(written.length).toBeGreaterThan(60);

    let withAForm: number = 0;

    for (const dataTypeId of written) {
      const entry: CorpusEntry =
        READING_CASES[`${dataTypeId}: its values typed wholly in fullwidth`]!;

      expect([dataTypeId, entry.positives.length >= 2]).toEqual([
        dataTypeId,
        true,
      ]);

      for (let index: number = 0; index < entry.positives.length; index++) {
        const positive: Labelled = entry.positives[index]!;
        const asWritten: Labelled = CORPUS[dataTypeId]!.positives[index]!;

        // Typed in fullwidth indeed: no ASCII digit is left in a value.
        expect([dataTypeId, ASCII_DIGIT.test(positive.value)]).toEqual([
          dataTypeId,
          false,
        ]);
        // One character for one: as long as the text and the value it was written from.
        expect([
          dataTypeId,
          positive.text.length,
          positive.value.length,
        ]).toEqual([dataTypeId, asWritten.text.length, asWritten.value.length]);

        if (holdsFullwidthSeparator(positive.value)) {
          withAForm++;
        }
      }
    }

    // Values set apart by a fullwidth hyphen, full stop, solidus or ideographic space.
    expect(withAForm).toBeGreaterThan(20);
  });

  // #11385: every number written with hyphens is written with the other dashes too.
  test("writes every type read with its fullwidth forms with its groups set apart by another dash (#11385)", () => {
    let withADash: number = 0;

    for (const dataTypeId of FULLWIDTH_TYPES) {
      if (!CORPUS[dataTypeId]) {
        continue;
      }

      const written: CorpusEntry =
        READING_CASES[`${dataTypeId}: its groups set apart by another dash`]!;

      expect([dataTypeId, written.positives.length]).toEqual([
        dataTypeId,
        CORPUS[dataTypeId]!.positives.length,
      ]);

      for (const positive of written.positives) {
        // No hyphen between digits is left: each is another dash now.
        expect([dataTypeId, /[0-9]-[0-9]/.test(positive.value)]).toEqual([
          dataTypeId,
          false,
        ]);

        if (holdsOtherDash(positive.value)) {
          withADash++;
        }
      }
    }

    // Every one of the dashes sets a value's groups apart somewhere.
    expect(withADash).toBeGreaterThan(10);

    for (const dash of OTHER_DASHES) {
      const codePoint: string = dash.charCodeAt(0).toString(16);

      expect([
        codePoint,
        Object.values(READING_CASES).some((entry: CorpusEntry): boolean => {
          return entry.positives.some((positive: Labelled): boolean => {
            return positive.value.includes(dash);
          });
        }),
      ]).toEqual([codePoint, true]);
    }
  });

  // #11385: every type that reads fullwidth letters has its values typed wholly in fullwidth.
  test("writes every type read in fullwidth letters with its values typed wholly in fullwidth, letters too (#11385)", () => {
    let withALetter: number = 0;

    for (const dataTypeId of FULLWIDTH_LETTERS_TYPES) {
      if (!CORPUS[dataTypeId]) {
        continue;
      }

      const written: CorpusEntry =
        READING_CASES[
          `${dataTypeId}: its values typed wholly in fullwidth, letters too`
        ]!;

      expect([dataTypeId, written.positives.length]).toEqual([
        dataTypeId,
        CORPUS[dataTypeId]!.positives.length,
      ]);

      for (const positive of written.positives) {
        // Typed in fullwidth indeed: no printable ASCII is left in its text.
        expect([
          dataTypeId,
          Array.from(positive.text).some((character: string): boolean => {
            const code: number = character.charCodeAt(0);

            return code > 0x20 && code < 0x7f;
          }),
        ]).toEqual([dataTypeId, false]);

        if (holdsFullwidthLetter(positive.value)) {
          withALetter++;
        }
      }
    }

    // Values with letters - IBANs, postcodes, IDs, addresses - many of them.
    expect(withALetter).toBeGreaterThan(30);
    expect(FULLWIDTH_LETTERS_TYPES).toEqual(
      expect.arrayContaining(["email-address", "iban", "postal-code"]),
    );
    // Every type that reads a number's fullwidth forms reads its letters too.
    expect(FULLWIDTH_LETTERS_TYPES).toEqual(
      expect.arrayContaining([...FULLWIDTH_TYPES]),
    );
  });

  /*
   * #11383: a value under a key that names its type is found by the key's
   * name - and not without it: each such value is refused as the text it
   * is, read under no key.
   */
  test("reads a field's value with the field's name for the words it needs, and without it finds none (#11383)", () => {
    let keyed: number = 0;

    for (const [name, entry] of Object.entries(READING_CASES)) {
      for (const positive of entry.positives) {
        if (positive.field === undefined) {
          continue;
        }

        keyed++;
        expect([name, positive.field, isRefusedAlone(positive.dataTypeId, positive.text)]).toEqual([
          name,
          positive.field,
          true,
        ]);
      }
    }

    expect(keyed).toBeGreaterThan(6);
  });

  /*
   * #11114, #11115: a Phone Number or SSN rule hides what Data Security
   * finds (TextReadings.findDetectorRanges): over every case written for
   * those types - in fullwidth, beside the words that name them, in a URL,
   * in any script's digits, under a key that names them (#11383, read as
   * the rule reads a value under its key), set apart by another dash or
   * beside their words typed in fullwidth (#11385) - each finding of the
   * type is hidden, and nothing the type's detectors do not find, near
   * misses included.
   */
  test("a Phone Number or SSN rule hides exactly what Data Security finds of its type, in every case of it", () => {
    let texts: number = 0;

    for (const [name, entry] of Object.entries(READING_CASES)) {
      for (const labelled of [...entry.positives, ...entry.nearMisses]) {
        if (
          labelled.dataTypeId !== "phone-number" &&
          labelled.dataTypeId !== "us-ssn"
        ) {
          continue;
        }

        const detectors: ReadonlyArray<DataTypeDetector> =
          getBuiltInDetectorsOf(labelled.dataTypeId);
        // A field's value read as the rule reads it under its key (#11383).
        const ranges: Array<TextRange> = findDetectorRanges(
          detectors,
          labelled.text,
          undefined,
          {
            hintedDataTypeIds:
              labelled.field === undefined
                ? undefined
                : getHintedDataTypeIds(labelled.field),
          },
        );
        const found: Array<TextMatch> = findAsRead(
          labelled.text,
          { detectors },
          labelled.field,
        );

        texts++;

        for (const match of found) {
          expect([
            name,
            labelled.text.slice(match.start, match.end),
            ranges.some(([start, end]: TextRange): boolean => {
              return start <= match.start && match.end <= end;
            }),
          ]).toEqual([name, labelled.text.slice(match.start, match.end), true]);
        }

        for (const [start, end] of ranges) {
          expect([
            name,
            labelled.text.slice(start, end),
            found.some((match: TextMatch): boolean => {
              return start <= match.start && match.end <= end;
            }),
          ]).toEqual([name, labelled.text.slice(start, end), true]);
        }

        // A value Data Security calls its type is hidden by the type's rule.
        if (labelled.value) {
          const at: number = labelled.text.indexOf(labelled.value);

          expect([
            name,
            labelled.value,
            ranges.some(([start, end]: TextRange): boolean => {
              return start < at + labelled.value.length && at < end;
            }),
          ]).toEqual([name, labelled.value, true]);
        }
      }
    }

    expect(texts).toBeGreaterThan(60);
  });

  // A generated case of a hand-written case's name would put it out of the corpus, unseen.
  test("no generated case takes the name of a hand-written one", () => {
    const generated: Array<string> = [
      ...Object.keys(everyScriptCases(CORPUS)),
      ...Object.keys(inAUrlCases(CORPUS)),
      ...Object.keys(fullwidthCases(CORPUS)),
      ...Object.keys(otherDashCases(CORPUS)),
      ...Object.keys(fullwidthLettersCases(CORPUS)),
    ];

    expect(
      generated.filter((name: string): boolean => {
        return Object.prototype.hasOwnProperty.call(READING_CASES_OF, name);
      }),
    ).toEqual([]);
    expect(new Set(generated).size).toBe(generated.length);
    expect(Object.keys(READING_CASES)).toHaveLength(
      Object.keys(READING_CASES_OF).length + generated.length,
    );
  });

  test("draws each case from a stream of its own, the same for the same seed", () => {
    expect(buildReadingCases(CORPUS_SEED)).toEqual(READING_CASES);
    expect(buildReadingCases(CORPUS_SEED + 1)).not.toEqual(READING_CASES);
  });
});
