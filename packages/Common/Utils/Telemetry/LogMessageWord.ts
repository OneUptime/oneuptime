import escapeRegExp from "../RegExpEscape";
import { toExcludeFacetKey } from "../../Types/Telemetry/FacetExcludeKey";
import {
  MAX_URL_LENGTH,
  canonicalAddress,
} from "../SecurityCase/SecurityConnectionMatch";

/*
 * A WORD A LOG LINE'S MESSAGE HOLDS WHOLE.
 *
 * The Logs explorer's message search is a substring search ("Message
 * contains"): `10.0.0.1` finds `10.0.0.12` and `110.0.0.1` too. This is its
 * other reading, the one Connected Signals counts a value in a message by
 * ("In the message", SecurityTelemetrySearch): the word as a whole, whatever
 * its case -
 *
 *   no letter, digit, "_", "-" or "." on either side of it, so 10.0.0.1 is
 *   held by "from 10.0.0.1:52144" and "10.0.0.1." but not by "10.0.0.12" or
 *   "110.0.0.1", and evil.example by "https://evil.example/x" but not by
 *   "evil.example.net" or "sub.evil.example". A side the word itself ends
 *   with something else on ("https://evil.example/") has no edge: every
 *   longer text there holds it. For an IPv6 address a ":" runs on too, so
 *   2001:db8::7 is not held by "2001:db8::7:1".
 *
 * An address is also held in its other spellings: an IPv4 address as its one
 * spelling (canonicalAddress), an IPv6 address in its short form (RFC 5952),
 * so a case naming 2001:0DB8:0:0:0:0:0:7 finds the lines that log 2001:db8::7.
 *
 * Both readers build their test from the functions here - Connected Signals'
 * count (SecurityTelemetrySearch, SecurityTelemetryStatements) and the Logs
 * explorer's "Word in message" chip with the chart and the facet counts
 * beside it (Server/Utils/Telemetry/LogMessageWordStatement) - so the lines a
 * count names are the lines its link opens, and never others.
 *
 * Every word is text somebody wrote, so it is read with loops over its
 * characters, and the pattern is built with every character escaped
 * (escapeRegExp). It runs in ClickHouse's RE2, whose time grows in line with
 * the text it reads.
 */

// The Logs explorer chip that holds a word: `["bodyWord", ["10.0.0.1"]]`.
export const LOG_MESSAGE_WORD_CHIP_KEY: string = "bodyWord";

/*
 * The list query's key, and the histogram / facets / analytics / export
 * requests' field, for the words a message must hold - and the one for the
 * words it must not. Not columns: StatementGenerator and
 * LogAggregationService compile them (LogMessageWordStatement), and a
 * reader's permission on them is the permission on the message (`body`).
 */
export const LOG_MESSAGE_WORDS_FIELD: string = "bodyWords";
export const EXCLUDED_LOG_MESSAGE_WORDS_FIELD: string = "excludedBodyWords";

// The column the words are read in.
export const LOG_MESSAGE_WORD_COLUMN: string = "body";

/*
 * At most this many words a filter holds, and this long each: as long as the
 * longest value Connected Signals searches a message for (a URL).
 */
export const MAX_LOG_MESSAGE_WORDS: number = 10;
export const MAX_LOG_MESSAGE_WORD_LENGTH: number = MAX_URL_LENGTH;

// The flag that makes an RE2 pattern match whatever the case.
export const RE2_CASE_INSENSITIVE_FLAG: string = "(?i)";

// What a message must not hold beside a word: what it would run on into.
const RUN_ON_CHARACTERS: string = "0-9A-Za-z_.-";
const IPV6_RUN_ON_CHARACTERS: string = "0-9A-Za-z_:.-";
// After a word, a dot ends it unless a letter, digit, "_" or "-" follows.
const AFTER_DOT_RUN_ON_CHARACTERS: string = "0-9A-Za-z_-";

// How a message is tested for one word.
export interface LogMessageWordMatch {
  // Lower case text the message must hold one of (read first, and fast).
  needles: Array<string>;
  // The RE2 pattern the message holds the word whole by.
  pattern: string;
}

function isAsciiLetterOrDigit(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

// A character a word runs on through: letters, digits and "_".
function isWordCharacter(code: number): boolean {
  return isAsciiLetterOrDigit(code) || code === 95;
}

// A control character: never part of a word anybody searches for.
function isControlCharacter(code: number): boolean {
  return code < 32 || code === 127;
}

// Each text once, compared as written, in the order first met.
function unique(values: Array<string>): Array<string> {
  const seen: Set<string> = new Set();
  const result: Array<string> = [];

  for (const value of values) {
    if (value && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

/*
 * An IPv6 address in its short form (RFC 5952), from its one spelling
 * (canonicalAddress: eight groups, lower case, no leading zeros): the
 * longest run of two or more zero groups, the first of equal ones, as "::".
 * 2001:db8:0:0:0:0:0:7 is 2001:db8::7.
 */
export function getShortIpv6Address(canonical: string): string {
  const groups: Array<string> = canonical.split(":");

  if (groups.length !== 8) {
    return canonical;
  }

  let bestStart: number = -1;
  let bestLength: number = 0;
  let runStart: number = -1;

  for (let index: number = 0; index <= groups.length; index++) {
    if (index < groups.length && groups[index] === "0") {
      if (runStart === -1) {
        runStart = index;
      }
      continue;
    }

    if (runStart !== -1) {
      const length: number = index - runStart;

      if (length >= 2 && length > bestLength) {
        bestStart = runStart;
        bestLength = length;
      }

      runStart = -1;
    }
  }

  if (bestStart === -1) {
    return groups.join(":");
  }

  return `${groups.slice(0, bestStart).join(":")}::${groups
    .slice(bestStart + bestLength)
    .join(":")}`;
}

// Whether a word is an IPv6 address (not one an IPv4 address maps to).
export function isIpv6AddressWord(word: string): boolean {
  const address: string | null = canonicalAddress((word || "").trim());

  return Boolean(address && address.includes(":"));
}

/*
 * The spellings a message may write a word in: as written, and an address
 * also in its other spellings - an IPv4 address in its one spelling, an IPv6
 * address in lower case and in its short form.
 */
export function getLogMessageWordSpellings(word: string): Array<string> {
  const text: string = (word || "").trim();

  if (!text) {
    return [];
  }

  const address: string | null = canonicalAddress(text);

  if (!address) {
    return [text];
  }

  if (!address.includes(":")) {
    return unique([text, address]);
  }

  return unique([text, text.toLowerCase(), getShortIpv6Address(address)]);
}

// What a message is first read for: each spelling once, in lower case.
export function getLogMessageWordNeedles(word: string): Array<string> {
  return unique(
    getLogMessageWordSpellings(word).map((spelling: string): string => {
      return spelling.toLowerCase();
    }),
  );
}

/*
 * The RE2 pattern a message holds a word whole by: any of its spellings
 * (the needles), whatever the case, with nothing it would run on into beside
 * it - on a side the word itself ends with a letter, a digit or "_".
 * `isIpv6Address` adds ":" to what runs on. The one builder of the pattern:
 * Connected Signals' count reads with it too (getTelemetryMessagePattern).
 */
export function buildLogMessageWordPattern(data: {
  word: string;
  needles: Array<string>;
  isIpv6Address: boolean;
}): string {
  const text: string = (data.word || "").trim();
  const runOn: string = data.isIpv6Address
    ? IPV6_RUN_ON_CHARACTERS
    : RUN_ON_CHARACTERS;
  const startsWithWord: boolean =
    text.length > 0 && isWordCharacter(text.charCodeAt(0));
  const endsWithWord: boolean =
    text.length > 0 && isWordCharacter(text.charCodeAt(text.length - 1));
  const before: string = startsWithWord ? `(?:^|[^${runOn}])` : "";
  const after: string = endsWithWord
    ? `(?:$|[^${runOn}]|\\.(?:$|[^${AFTER_DOT_RUN_ON_CHARACTERS}]))`
    : "";

  return `${RE2_CASE_INSENSITIVE_FLAG}${before}(?:${data.needles
    .map((needle: string): string => {
      return escapeRegExp(needle);
    })
    .join("|")})${after}`;
}

// The pattern a message holds one word whole by.
export function getLogMessageWordPattern(word: string): string {
  return buildLogMessageWordPattern({
    word,
    needles: getLogMessageWordNeedles(word),
    isIpv6Address: isIpv6AddressWord(word),
  });
}

/*
 * Whether a text can be searched for as a word: something besides white
 * space, no control character, and at most MAX_LOG_MESSAGE_WORD_LENGTH long.
 */
export function isLogMessageWord(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const text: string = value.trim();

  if (!text || text.length > MAX_LOG_MESSAGE_WORD_LENGTH) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    if (isControlCharacter(text.charCodeAt(index))) {
      return false;
    }
  }

  return true;
}

// How a message is tested for one word, or null when it is not one.
export function getLogMessageWordMatch(
  word: string,
): LogMessageWordMatch | null {
  if (!isLogMessageWord(word)) {
    return null;
  }

  const needles: Array<string> = getLogMessageWordNeedles(word);

  if (needles.length === 0) {
    return null;
  }

  return {
    needles,
    pattern: buildLogMessageWordPattern({
      word,
      needles,
      isIpv6Address: isIpv6AddressWord(word),
    }),
  };
}

/*
 * The words a list query, a request or a link holds - text somebody may have
 * written - as a filter reads them: each a word (isLogMessageWord), trimmed,
 * once whatever its case (a message holds both or neither), at most
 * MAX_LOG_MESSAGE_WORDS. A lone string is one word. Anything else is no
 * word, which filters nothing, never everything away.
 */
export function readLogMessageWords(raw: unknown): Array<string> {
  const values: Array<unknown> = Array.isArray(raw)
    ? raw
    : raw === undefined || raw === null
      ? []
      : [raw];

  const seen: Set<string> = new Set();
  const words: Array<string> = [];

  for (const value of values) {
    if (words.length >= MAX_LOG_MESSAGE_WORDS) {
      break;
    }

    if (!isLogMessageWord(value)) {
      continue;
    }

    const word: string = value.trim();
    const key: string = word.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    words.push(word);
  }

  return words;
}

/*
 * The words a chip set keeps and leaves out (`bodyWord`, `!bodyWord`), as
 * the list query's keys and the requests' fields hold them: only the ones
 * that hold a word are set. The one reading of the chip, for the list and
 * every request beside it.
 */
export function getLogMessageWordChipFields(
  facetFilters: ReadonlyMap<string, Iterable<string>>,
): { bodyWords?: Array<string>; excludedBodyWords?: Array<string> } {
  const words: Array<string> = readLogMessageWords(
    Array.from(facetFilters.get(LOG_MESSAGE_WORD_CHIP_KEY) || []),
  );
  const excludedWords: Array<string> = readLogMessageWords(
    Array.from(
      facetFilters.get(toExcludeFacetKey(LOG_MESSAGE_WORD_CHIP_KEY)) || [],
    ),
  );

  return {
    ...(words.length > 0 ? { [LOG_MESSAGE_WORDS_FIELD]: words } : {}),
    ...(excludedWords.length > 0
      ? { [EXCLUDED_LOG_MESSAGE_WORDS_FIELD]: excludedWords }
      : {}),
  };
}

// Whether a query or a request holds a word to keep or to leave out.
export function hasLogMessageWords(
  query: Record<string, unknown> | null | undefined,
): boolean {
  return (
    readLogMessageWords(query?.[LOG_MESSAGE_WORDS_FIELD]).length > 0 ||
    readLogMessageWords(query?.[EXCLUDED_LOG_MESSAGE_WORDS_FIELD]).length > 0
  );
}
