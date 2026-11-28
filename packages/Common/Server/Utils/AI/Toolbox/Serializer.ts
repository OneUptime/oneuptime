import { JSONObject, JSONValue } from "../../../../Types/JSON";
import { scrubRegExpFromBuiltIn } from "../../../../Types/Telemetry/ScrubRule";
import PromptText from "../../../../Utils/AI/PromptText";
import { DataTypeDetector } from "../../../../Utils/DataSecurity/Detector";
import {
  EMAIL_ADDRESS_DETECTORS,
  PHONE_NUMBER_DETECTORS,
} from "../../../../Utils/DataSecurity/Detectors/ContactDetectors";
import { US_SSN_DETECTORS } from "../../../../Utils/DataSecurity/Detectors/GovernmentIdDetectors";
import { digitZeroOf } from "../../../../Utils/DataSecurity/DigitReadings";
import PercentDecodedText from "../../../../Utils/DataSecurity/PercentDecodedText";
import {
  findDetectorRanges,
  findInEveryReading,
  mergeRanges,
  TextRange,
  TextReadings,
} from "../../../../Utils/DataSecurity/TextReadings";
import { replacePrivateKeyBlocks } from "../../../../Utils/PrivateKeyBlocks";
import { getHintsOfKey } from "../../../../Utils/Telemetry/ScrubBuiltInPatterns";
import ScrubIpAddress, {
  ScrubIpAddressRange,
} from "../../../../Utils/Telemetry/ScrubIpAddress";

/*
 * Prepares tool results for the LLM prompt: redacts likely secrets/PII,
 * leaves embedded files out, truncates long fields, and caps total payload
 * size. Everything that enters the prompt (and therefore leaves for the LLM
 * provider, and is previewed in LlmLog.requestPrompt) passes through here
 * first.
 *
 * An incident's description can hold a synthetic monitor's screenshot -
 * hundreds of kilobytes of base64 in a data: URL. Left in, it filled the
 * field's MAX_FIELD_LENGTH with base64 and cut off the words after it; so
 * every value goes through redactAndOmitEmbeddedData, which puts a short
 * note where the image was ("[image omitted: PNG, 340 KB]") before it is cut.
 */

/*
 * Rows beyond this are summarized ("showing the first 50 of N rows") so the
 * model narrows the query instead of reading an unbounded table. A single
 * field keeps up to MAX_FIELD_LENGTH characters — enough for a whole stack
 * trace or a long log line, which used to be cut at 500 and lose exactly the
 * frame that mattered — and one result keeps up to MAX_PAYLOAD_BYTES.
 */
export const MAX_ROWS: number = 50;
export const MAX_FIELD_LENGTH: number = 4000;
export const MAX_PAYLOAD_BYTES: number = 64 * 1024;

/*
 * A rule is a pattern and what replaces each match, or - where one pattern
 * cannot read a text in time in line with its length - a function that
 * reads the text itself, writes the rule's placeholder where it hid a
 * value, and says how many it replaced. Each names the placeholder it
 * writes ("[redacted-ip]"): a model shown it knows a value was there, never
 * the value.
 */
type RedactionRule =
  | {
      name: string;
      placeholder: string;
      regex: RegExp;
      replacement: string;
      /*
       * How much of a match's start its replacement keeps - "password="
       * of "password=hunter2", "Bearer " - when the match is found in the
       * text with its percent-escapes read (#11031). None when left out.
       */
      keeps?: ((match: RegExpMatchArray) => number) | undefined;
    }
  | {
      name: string;
      placeholder: string;
      redact: (
        text: string,
        placeholder: string,
        context: RedactionContext,
      ) => { text: string; count: number };
    };

/*
 * What a rule that reads the text itself is handed beside it: the name of
 * the field the text is the value of, when it is one - a row's column
 * (RedactionOptions.field) - and the text's readings (TextReadings), made
 * once for the rules that read one text in turn: a rule that hides
 * nothing leaves the very text the next one reads, and a card, a phone
 * number and a Social Security number are read in the same readings.
 */
interface RedactionContext {
  field?: string | undefined;
  readingsOf: (text: string) => TextReadings;
}

// The readings of the last text a rule read, handed on while the text is the same.
class SharedReadings {
  private text: string | null = null;
  private readings: TextReadings | null = null;

  public of(text: string): TextReadings {
    if (this.readings === null || this.text !== text) {
      this.text = text;
      this.readings = new TextReadings(text);
    }

    return this.readings;
  }
}

const PRIVATE_KEY_PLACEHOLDER: string = "[redacted-private-key]";

// What a Bearer token's replacement keeps of its match: the word and its spaces.
const BEARER_WORD: RegExp = /^Bearer\s+/i;

/*
 * THE IP ADDRESSES A MODEL IS NEVER SHOWN: EXACTLY THOSE AN IP ADDRESS SCRUB
 * RULE HIDES (#10417).
 *
 * The rule here was /\b(?:\d{1,3}\.){3}\d{1,3}\b/, so "8.8.8.8" in a log line
 * reached the model as "[redacted-ip]" while "2001:4860:4860::8888" in the
 * same line reached it as it is: which visitors' addresses left for the
 * model's provider, and stayed in AI Logs, depended on which IP version they
 * used. Now the addresses are found by ScrubIpAddress.findRanges, the very
 * function an IP Address scrub rule runs on every log and span (#10393), with
 * Data Security's own detectors, so the two can never disagree on what an
 * address is:
 *
 *  - hidden: public IPv4 and IPv6 addresses, written out or compressed, in
 *    capitals, in brackets with a port ([2001:db8::1]:443 keeps its brackets
 *    and port), with a zone, and an IPv4 address written as IPv6
 *    (::ffff:8.8.8.8, ::ffff:808:808), hidden whole; and the documentation
 *    ranges (203.0.113.7, 2001:db8::1), so a test shows the rule working;
 *  - kept: private, loopback and link-local addresses (10.0.0.12, 127.0.0.1,
 *    fe80::1, 169.254.169.254), which point at no one, and which a model
 *    needs to read a project's own infrastructure: the database at
 *    10.0.0.12:5432 that refused a connection, the cloud metadata address
 *    in a request's URL. The old rule hid them too;
 *  - never an address: a clock (12:34:56), a C++ scope (std::vector), a MAC
 *    address, a trace or span id, a version with more parts (1.3.6.1.4.1).
 *
 * In time in line with the text's length: each detector's pattern is
 * bounded and cannot start inside a longer run of its characters
 * (ScrubIpAddressLinearTime.test.ts, SerializerIpAddresses.test.ts).
 */
const redactIpAddresses: (
  text: string,
  placeholder: string,
) => { text: string; count: number } = (
  text: string,
  placeholder: string,
): { text: string; count: number } => {
  return replaceRanges(text, ScrubIpAddress.findRanges(text), placeholder);
};

// Each range of a text written over with the placeholder, and how many.
function replaceRanges(
  text: string,
  ranges: ReadonlyArray<ScrubIpAddressRange>,
  placeholder: string,
): { text: string; count: number } {
  if (ranges.length === 0) {
    return { text, count: 0 };
  }

  const parts: Array<string> = [];
  let at: number = 0;

  for (const [start, end] of ranges) {
    parts.push(text.slice(at, start), placeholder);
    at = end;
  }

  parts.push(text.slice(at));

  return { text: parts.join(""), count: ranges.length };
}

/*
 * THE EMAIL ADDRESSES A MODEL IS NEVER SHOWN.
 *
 * Each part of an address is length-bounded to the sizes RFC 5321 allows
 * (local part 64, domain 253, final label 63), so scanning a long tool
 * result for addresses stays in line with its length. The local part
 * starts with a letter, a digit, "_", "%" or "+": a lone "-" or "." before
 * an "@" is the search syntax's excluded attribute (`-@http.route:/health`,
 * a request SLO's filter), not an address. An address after a dash is
 * still found, from its first letter on: "-alice@example.com" reads
 * "-[redacted-email]".
 *
 * Read as Data Security reads an address, so a model is shown none it calls
 * one: in a percent-encoded URL too, its escapes read
 * (jane.doe%40acmecorp.io, #10935), and in any script (张伟@acmecorp.io,
 * почта@пример.рф, #10960), as the email detectors find it - each hidden
 * as written, and the rest of the URL kept - and typed in fullwidth
 * (ｊａｎｅ＠ｅｘａｍｐｌｅ．ｃｏｍ, #11385), its fullwidth letters read as
 * ASCII. An address written in ASCII alone is this pattern's, so the
 * search syntax keeps its "-@".
 */
const SERIALIZER_EMAIL_PATTERN: RegExp =
  /[A-Za-z0-9_%+][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}/g;

// Whether a text holds a character beyond ASCII: what an address the email detectors alone find holds.
function holdsCharacterBeyondAscii(text: string): boolean {
  for (let index: number = 0; index < text.length; index++) {
    if (text.charCodeAt(index) > 0x7f) {
      return true;
    }
  }

  return false;
}

const redactEmailAddresses: (
  text: string,
  placeholder: string,
  context: RedactionContext,
) => { text: string; count: number } = (
  text: string,
  placeholder: string,
  context: RedactionContext,
): { text: string; count: number } => {
  if (
    text.indexOf("@") === -1 &&
    text.indexOf("%") === -1 &&
    text.indexOf("\uFF20") === -1
  ) {
    return { text, count: 0 };
  }

  const readings: TextReadings = context.readingsOf(text);
  const inScripts: Array<TextRange> = findDetectorRanges(
    EMAIL_ADDRESS_DETECTORS,
    text,
    readings,
  ).filter(([start, end]: TextRange): boolean => {
    return holdsCharacterBeyondAscii(text.slice(start, end));
  });

  return replaceRanges(
    text,
    mergeRanges([
      ...findInEveryReading({
        text,
        needs: { readsPercentEncoded: true, readsFullwidthLetters: true },
        findIn: (reading: string): Array<TextRange> => {
          return scrubRegExpFromBuiltIn(SERIALIZER_EMAIL_PATTERN).matchRanges(
            reading,
          );
        },
        readings,
      }),
      ...inScripts,
    ]),
    placeholder,
  );
};

/*
 * Payment card numbers in the classic space/dash-separated grouping
 * (e.g. "4111 1111 1111 1111"). Deliberately NOT matching bare 16-digit
 * runs: an all-numeric 16-char OTel span id would collide with those and
 * break the search_logs → get_trace pivot. In any script's digits too, each
 * read by its value, as Data Security reads a card (#10960): ４１１１ １１１１
 * １１１１ １１１１ is hidden as written. And in a URL, as Data Security reads a
 * card there (#11199): card=4111%201111%201111%201111, and
 * card=4111+1111+1111+1111 as a query string writes its spaces. And typed
 * wholly in fullwidth, as Data Security reads one too (#11115): its groups
 * apart by fullwidth hyphens or ideographic spaces,
 * ４１１１－１１１１－１１１１－１１１１ - or by another dash, as Data Security
 * reads one since #11385: 4111–1111–1111–1111, ４１１１ー１１１１ー….
 */
const SERIALIZER_CARD_PATTERN: RegExp = /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b/g;

const redactCardNumbers: (
  text: string,
  placeholder: string,
  context: RedactionContext,
) => { text: string; count: number } = (
  text: string,
  placeholder: string,
  context: RedactionContext,
): { text: string; count: number } => {
  return replaceRanges(
    text,
    findInEveryReading({
      text,
      needs: {
        readsDigitsOfEveryScript: true,
        readsPercentEncoded: true,
        readsPlusAsSpace: true,
        readsFullwidthForms: true,
        readsFullwidthLetters: true,
      },
      findIn: (reading: string): Array<TextRange> => {
        return scrubRegExpFromBuiltIn(SERIALIZER_CARD_PATTERN).matchRanges(
          reading,
        );
      },
      readings: context.readingsOf(text),
    }),
    placeholder,
  );
};

/*
 * THE PHONE NUMBERS AND SOCIAL SECURITY NUMBERS A MODEL IS NEVER SHOWN:
 * WHAT DATA SECURITY'S OWN DETECTORS FIND (#11384).
 *
 * A tool result is a log line, a span's attributes, a row of a query, and
 * a customer's phone number or Social Security number in one reached the
 * model's provider and AI Logs as it was - though Data Security calls the
 * SSN Restricted. Both are found here as Data Security finds them, by its
 * own detectors (PHONE_NUMBER_DETECTORS, US_SSN_DETECTORS) through the one
 * function every rule built on them finds with (findDetectorRanges):
 *
 *  - hidden: an international number in the groups people write it in
 *    (+44 20 7946 0958), a North American one as people write it
 *    ((415) 555-2671), a UK mobile (07700 900123), and a national number of
 *    9 to 12 digits beside a word that names it ("tel 02012345678"); an SSN
 *    in its groups (536-22-8731), and as nine digits in a row beside a word
 *    that says SSN ("SSN 536221234"). In every reading Data Security reads
 *    them in - a URL's escapes and "+"s, every script's digits, typed in
 *    fullwidth - and in a row's field with the field's name for the word
 *    they need (`phone`, `ssn`), as a scrub rule reads a value under its
 *    key (#11383);
 *  - kept: what Data Security calls neither - a run of digits no word
 *    names, which a tool result is full of and a model needs: a Unix time
 *    (1732752000), a span or trace id, an order number, a duration, a port.
 *    Not the Phone Number rule's own pattern, which takes any ten digits:
 *    it would hide those too, as the card rule below leaves a span id's
 *    sixteen digits alone.
 *
 * In time in line with the text's length: each detector is bounded, and
 * one that needs its words looks for them only around its candidates.
 */
function redactFoundBy(
  detectors: ReadonlyArray<DataTypeDetector>,
): (
  text: string,
  placeholder: string,
  context: RedactionContext,
) => { text: string; count: number } {
  return (
    text: string,
    placeholder: string,
    context: RedactionContext,
  ): { text: string; count: number } => {
    if (!hasAnyDigit(text)) {
      return { text, count: 0 };
    }

    return replaceRanges(
      text,
      findDetectorRanges(detectors, text, context.readingsOf(text), {
        hintedDataTypeIds: context.field
          ? getHintsOfKey(context.field)
          : undefined,
      }),
      placeholder,
    );
  };
}

// Whether a text holds a digit of any script: what every phone and SSN detector needs.
function hasAnyDigit(text: string): boolean {
  for (let index: number = 0; index < text.length; index++) {
    if (digitZeroOf(text.charCodeAt(index)) >= 0) {
      return true;
    }
  }

  return false;
}

// The phone rule's name: RedactionOptions.keepPhoneNumbers keeps it out.
const PHONE_NUMBER_RULE_NAME: string = "phone-number";

/*
 * These are security redactions, not the fingerprint-normalization regexes
 * (those normalize numbers/uuids for grouping and do not cover credentials).
 */
const REDACTION_RULES: Array<RedactionRule> = [
  {
    /*
     * A JWT: three base64url segments split by dots, of any length.
     *
     * A token is looked for once per run of the characters it is made of:
     * the match may only begin where such a run begins, and the look-ahead
     * settles on the run's first "eyJ" - the one with the longest first
     * segment, so when it is no token, no later "eyJ" of the run is one
     * either. The text of the run before it is put back ($1). That replaces
     * exactly the tokens a search from every "eyJ" did, while each run is
     * read a bounded number of times, so a long tool result is read in time
     * in line with its length.
     */
    name: "jwt",
    placeholder: "[redacted-jwt]",
    regex:
      /(?<![A-Za-z0-9_-])(?=([A-Za-z0-9_-]*?)eyJ)\1eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
    replacement: "$1[redacted-jwt]",
    keeps: (match: RegExpMatchArray): number => {
      return (match[1] || "").length;
    },
  },
  {
    name: "bearer",
    placeholder: "[redacted-token]",
    regex: /Bearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
    replacement: "Bearer [redacted-token]",
    keeps: (match: RegExpMatchArray): number => {
      return BEARER_WORD.exec(match[0])?.[0].length || 0;
    },
  },
  {
    /*
     * PEM private key blocks (RSA/EC/OPENSSH/PGP…). The whole BEGIN…END
     * block, including newlines, so no key material leaks - read by
     * PrivateKeyBlocks, in time in line with the text's length however many
     * BEGIN lines it holds with no END after them.
     */
    name: "private-key",
    placeholder: PRIVATE_KEY_PLACEHOLDER,
    redact: (text: string): { text: string; count: number } => {
      return replacePrivateKeyBlocks(text, PRIVATE_KEY_PLACEHOLDER);
    },
  },
  {
    name: "aws-access-key-id",
    placeholder: "[redacted-aws-key]",
    regex: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[0-9A-Z]{16}\b/g,
    replacement: "[redacted-aws-key]",
  },
  {
    name: "github-token",
    placeholder: "[redacted-github-token]",
    regex:
      /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
    replacement: "[redacted-github-token]",
  },
  {
    name: "slack-token",
    placeholder: "[redacted-slack-token]",
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replacement: "[redacted-slack-token]",
  },
  {
    name: "google-api-key",
    placeholder: "[redacted-google-api-key]",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replacement: "[redacted-google-api-key]",
  },
  {
    // Every address Data Security calls one, encoded or in any script: see redactEmailAddresses.
    name: "email",
    placeholder: "[redacted-email]",
    redact: redactEmailAddresses,
  },
  {
    // IPv4 and IPv6, as an IP Address scrub rule finds them: see redactIpAddresses.
    name: "ip-address",
    placeholder: "[redacted-ip]",
    redact: redactIpAddresses,
  },
  {
    // Grouped card numbers, in any script's digits: see redactCardNumbers.
    name: "credit-card",
    placeholder: "[redacted-card]",
    redact: redactCardNumbers,
  },
  {
    // Phone numbers, as Data Security's phone detectors find them: see redactFoundBy.
    name: PHONE_NUMBER_RULE_NAME,
    placeholder: "[redacted-phone]",
    redact: redactFoundBy(PHONE_NUMBER_DETECTORS),
  },
  {
    // US Social Security numbers, as Data Security's SSN detectors find them.
    name: "us-ssn",
    placeholder: "[redacted-ssn]",
    redact: redactFoundBy(US_SSN_DETECTORS),
  },
  {
    /*
     * Long hex blobs are usually secrets (SHA-256 digests, 40+ char API
     * keys). But W3C/OTel trace IDs are exactly 32 hex chars and span IDs
     * exactly 16 — redacting those would break the documented
     * search_logs → get_trace pivot, since the model would never see the ID
     * it needs to pass back. So only redact runs of 33+ hex chars, which
     * preserves both ID lengths while still catching typical hash-length
     * secrets. Labeled secrets of any length are still caught by
     * key-value-secret below.
     */
    name: "hex-secret",
    placeholder: "[redacted-hex]",
    regex: /\b[0-9a-fA-F]{33,}\b/g,
    replacement: "[redacted-hex]",
  },
  {
    name: "key-value-secret",
    placeholder: "[redacted]",
    regex:
      /\b(password|passwd|secret|api[_-]?key|access[_-]?token|authorization)\b(\s*[:=]\s*)("[^"]{4,}"|'[^']{4,}'|[^\s,;&]{4,})/gi,
    replacement: "$1$2[redacted]",
    keeps: (match: RegExpMatchArray): number => {
      return (match[1] || "").length + (match[2] || "").length;
    },
  },
];

/*
 * The placeholders redaction writes in place of what it hides, one per
 * rule, in the rules' order. A model shown "[redacted-ip]" never saw the
 * address, so a file it writes whole with a placeholder in it - one the
 * file did not have - writes the placeholder over the value it stood for
 * (issue #6364, CodeFilesSeen).
 */
export const REDACTION_PLACEHOLDERS: ReadonlyArray<string> =
  REDACTION_RULES.map((rule: RedactionRule): string => {
    return rule.placeholder;
  });

export interface SerializedResult {
  text: string;
  rowCount: number;
  redactionCount: number;
  isTruncated: boolean;
  bytes: number;
}

/*
 * The rules a security result keeps out of redaction: the observables
 * security work is about. A triage cannot judge "a sign-in from
 * 203.0.113.7" when it reads "a sign-in from [redacted-ip]", nor look a
 * file's SHA-256 up in threat intel when the digest reads [redacted-hex].
 * An IPv6 address is kept as an IPv4 one is (#10417). A phone number is
 * kept as an email address is (#11384): an account signs in by one, a
 * one-time code is sent to one, and a burst of texts to one country's
 * numbers is the attack - Confidential data that names the account or the
 * target a security question is about. Secrets - tokens, keys, private
 * keys, card numbers, "password=..." - and a Social Security number,
 * which is Restricted and names no account a sign-in uses, are redacted in
 * a security result as in every other.
 */
export const SECURITY_OBSERVABLE_RULE_NAMES: ReadonlyArray<string> = [
  "email",
  "ip-address",
  "phone-number",
  "hex-secret",
];

export interface RedactionOptions {
  /*
   * Keep IP addresses (IPv4 and IPv6), email addresses, phone numbers and
   * long hex digests (file hashes): for the security tools, whose results
   * are those observables (SecurityEventTools, SecurityCaseTools) and the
   * security case triage's context.
   */
  keepSecurityObservables?: boolean | undefined;
  /*
   * Keep phone numbers, and hide everything else as for a model: for the
   * name an audit log entry gives a call policy's number, which is the
   * number (AuditLogResourceNames, #6301) - the project's own line, which
   * the phone rule, written for what reaches a model (#11384), would make
   * "[redacted-phone]".
   */
  keepPhoneNumbers?: boolean | undefined;
  /*
   * The name of the field the text is the value of: a row's column
   * (serializeRows). A phone number or a Social Security number needs no
   * word beside it under a name that names it - 02012345678 as a row's
   * `phone`, 536221234 as its `ssn` - as Data Security reads a field and a
   * scrub rule reads a value under its key (#11383, #11384).
   */
  field?: string | undefined;
}

export default class ToolResultSerializer {
  /*
   * Single pass per rule: count and substitute ($1/$2 groups) together.
   * `context`: the name of the field the text is the value of
   * (RedactionOptions.field), and the readings the rules share.
   */
  private static applyRedactionRule(
    text: string,
    rule: RedactionRule,
    context: RedactionContext,
  ): { text: string; count: number } {
    if ("redact" in rule) {
      return rule.redact(text, rule.placeholder, context);
    }

    let count: number = 0;

    const result: string = text.replace(
      rule.regex,
      (...matchArgs: Array<unknown>): string => {
        count++;
        return rule.replacement.replace(
          /\$(\d)/g,
          (_full: string, groupIndex: string): string => {
            return String(matchArgs[Number(groupIndex)] ?? "");
          },
        );
      },
    );
    const decoded: { text: string; count: number } =
      ToolResultSerializer.redactWithEscapesRead(result, rule);

    return { text: decoded.text, count: count + decoded.count };
  }

  /*
   * A SECRET IN A PERCENT-ENCODED URL, HIDDEN AS IT IS WRITTEN (#11031).
   *
   * A rule's pattern reads the text as written, so a redirect's token after
   * an encoded "=" (?next=...%3Ftoken%3Dghp_...) or "password%3Dhunter2"
   * reached the model as it was. So each pattern rule also reads the text
   * with its escapes read (PercentDecodedText), as Data Security's
   * detectors and its scrub rules do, and hides what it finds there on the
   * characters it is written with, escapes and all, keeping what its
   * replacement keeps ("password%3D[redacted]"). What the text as written
   * already hid is a placeholder now, never matched again.
   */
  private static redactWithEscapesRead(
    text: string,
    rule: Extract<RedactionRule, { regex: RegExp }>,
  ): { text: string; count: number } {
    const read: PercentDecodedText | null =
      text.indexOf("%") === -1 ? null : PercentDecodedText.read(text);

    if (!read) {
      return { text, count: 0 };
    }

    const ranges: Array<TextRange> = [];
    const regex: RegExp = new RegExp(rule.regex.source, rule.regex.flags);

    for (const match of read.readable.matchAll(regex)) {
      const start: number = match.index! + (rule.keeps ? rule.keeps(match) : 0);
      const end: number = match.index! + match[0].length;

      // Hidden already: the written text's own placeholder, read again.
      if (
        end <= start ||
        read.readable.slice(start, end) === rule.placeholder
      ) {
        continue;
      }

      ranges.push(read.rangeToWritten([start, end]));
    }

    return replaceRanges(text, mergeRanges(ranges), rule.placeholder);
  }

  public static redact(
    text: string,
    options?: RedactionOptions,
  ): { text: string; count: number } {
    let redacted: string = text;
    let count: number = 0;
    const shared: SharedReadings = new SharedReadings();
    const context: RedactionContext = {
      field: options?.field,
      readingsOf: (read: string): TextReadings => {
        return shared.of(read);
      },
    };

    for (const rule of REDACTION_RULES) {
      if (
        options?.keepSecurityObservables &&
        SECURITY_OBSERVABLE_RULE_NAMES.includes(rule.name)
      ) {
        continue;
      }

      if (options?.keepPhoneNumbers && rule.name === PHONE_NUMBER_RULE_NAME) {
        continue;
      }

      const applied: { text: string; count: number } = this.applyRedactionRule(
        redacted,
        rule,
        context,
      );
      redacted = applied.text;
      count += applied.count;
    }

    return { text: redacted, count };
  }

  /*
   * Redaction, with the data embedded in the text left out around it
   * (PromptText): data: URLs first, so a screenshot's megabytes of base64
   * never reach the rules - they read everything else exactly as it was -
   * and any long run of base64 last, because a secret glued to one would
   * otherwise lose its first part, and with it the shape a rule knows it by.
   * Every caller that redacts text for a model goes through here.
   */
  public static redactAndOmitEmbeddedData(
    text: string,
    options?: RedactionOptions,
  ): {
    text: string;
    count: number;
  } {
    const redacted: { text: string; count: number } = this.redact(
      PromptText.omitDataUrls(text).text,
      options,
    );

    return {
      text: PromptText.omitEncodedRuns(redacted.text).text,
      count: redacted.count,
    };
  }

  // Byte-accurate truncation (substring counts UTF-16 units, not bytes).
  private static truncateToBytes(text: string, maxBytes: number): string {
    if (Buffer.byteLength(text, "utf8") <= maxBytes) {
      return text;
    }
    return Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8");
  }

  private static truncateField(value: string): {
    value: string;
    truncated: boolean;
  } {
    if (value.length <= MAX_FIELD_LENGTH) {
      return { value, truncated: false };
    }
    return {
      value: `${value.substring(0, MAX_FIELD_LENGTH)}… [truncated]`,
      truncated: true,
    };
  }

  private static serializeValue(value: JSONValue): string {
    if (value === null || value === undefined) {
      return "";
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  }

  /*
   * Serialize rows as a compact markdown-ish record list. Applies row cap,
   * per-field truncation, redaction and total payload cap.
   */
  public static serializeRows(
    rows: Array<JSONObject>,
    totalRowCount?: number,
    options?: RedactionOptions,
  ): SerializedResult {
    let isTruncated: boolean = false;
    let redactionCount: number = 0;

    let rowsToSerialize: Array<JSONObject> = rows;
    if (rows.length > MAX_ROWS) {
      rowsToSerialize = rows.slice(0, MAX_ROWS);
      isTruncated = true;
    }

    const lines: Array<string> = [];

    for (const row of rowsToSerialize) {
      const parts: Array<string> = [];

      for (const key of Object.keys(row)) {
        const rawValue: string = this.serializeValue(row[key] as JSONValue);
        if (!rawValue) {
          continue;
        }

        // Read as the row's field it is: its name is the words a value may need (#11384).
        const redacted: { text: string; count: number } =
          this.redactAndOmitEmbeddedData(rawValue, { ...options, field: key });
        redactionCount += redacted.count;

        const truncated: { value: string; truncated: boolean } =
          this.truncateField(redacted.text);
        if (truncated.truncated) {
          isTruncated = true;
        }

        parts.push(`${key}=${truncated.value}`);
      }

      lines.push(`- ${parts.join(" | ")}`);
    }

    let text: string = lines.join("\n");

    if (Buffer.byteLength(text, "utf8") > MAX_PAYLOAD_BYTES) {
      isTruncated = true;
      while (
        lines.length > 1 &&
        Buffer.byteLength(lines.join("\n"), "utf8") > MAX_PAYLOAD_BYTES
      ) {
        lines.pop();
      }
      // A single oversized row can still exceed the cap — hard-slice it.
      text = `${this.truncateToBytes(lines.join("\n"), MAX_PAYLOAD_BYTES)}\n… [payload truncated]`;
    }

    const rowCount: number = totalRowCount ?? rows.length;

    if (rows.length === 0) {
      text = "(no rows found)";
    }

    /*
     * Tell the model when it is only seeing a slice. Without this marker a
     * capped result looks complete, and the model reports partial data as if it
     * were the whole picture.
     */
    if (rows.length > MAX_ROWS) {
      text = `${text}\n… [showing the first ${MAX_ROWS} of ${rowCount} rows; narrow the query — a shorter time range or more filters — to see the rest]`;
    }

    return {
      text,
      rowCount,
      redactionCount,
      isTruncated,
      bytes: Buffer.byteLength(text, "utf8"),
    };
  }

  // Serialize free-form text (e.g. a rendered trace tree).
  public static serializeText(
    text: string,
    rowCount: number,
  ): SerializedResult {
    const redacted: { text: string; count: number } =
      this.redactAndOmitEmbeddedData(text);
    let output: string = redacted.text;
    let isTruncated: boolean = false;

    if (Buffer.byteLength(output, "utf8") > MAX_PAYLOAD_BYTES) {
      output = `${this.truncateToBytes(output, MAX_PAYLOAD_BYTES)}… [payload truncated]`;
      isTruncated = true;
    }

    if (!output) {
      output = "(no data found)";
    }

    return {
      text: output,
      rowCount,
      redactionCount: redacted.count,
      isTruncated,
      bytes: Buffer.byteLength(output, "utf8"),
    };
  }
}
