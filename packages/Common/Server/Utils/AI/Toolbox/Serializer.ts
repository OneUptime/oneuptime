import { JSONObject, JSONValue } from "../../../../Types/JSON";
import { scrubRegExpFromBuiltIn } from "../../../../Types/Telemetry/ScrubRule";
import PromptText from "../../../../Utils/AI/PromptText";
import { EMAIL_ADDRESS_DETECTORS } from "../../../../Utils/DataSecurity/Detectors/ContactDetectors";
import PercentDecodedText from "../../../../Utils/DataSecurity/PercentDecodedText";
import {
  findDetectorRanges,
  findInEveryReading,
  mergeRanges,
  TextRange,
} from "../../../../Utils/DataSecurity/TextReadings";
import { replacePrivateKeyBlocks } from "../../../../Utils/PrivateKeyBlocks";
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
      ) => { text: string; count: number };
    };

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
 * as written, and the rest of the URL kept. An address written in ASCII
 * alone is this pattern's, so the search syntax keeps its "-@".
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
) => { text: string; count: number } = (
  text: string,
  placeholder: string,
): { text: string; count: number } => {
  if (text.indexOf("@") === -1 && text.indexOf("%") === -1) {
    return { text, count: 0 };
  }

  const inScripts: Array<TextRange> = findDetectorRanges(
    EMAIL_ADDRESS_DETECTORS,
    text,
  ).filter(([start, end]: TextRange): boolean => {
    return holdsCharacterBeyondAscii(text.slice(start, end));
  });

  return replaceRanges(
    text,
    mergeRanges([
      ...findInEveryReading({
        text,
        needs: { readsPercentEncoded: true },
        findIn: (reading: string): Array<TextRange> => {
          return scrubRegExpFromBuiltIn(SERIALIZER_EMAIL_PATTERN).matchRanges(
            reading,
          );
        },
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
 * １１１１ １１１１ is hidden as written.
 */
const SERIALIZER_CARD_PATTERN: RegExp = /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}\b/g;

const redactCardNumbers: (
  text: string,
  placeholder: string,
) => { text: string; count: number } = (
  text: string,
  placeholder: string,
): { text: string; count: number } => {
  return replaceRanges(
    text,
    findInEveryReading({
      text,
      needs: { readsDigitsOfEveryScript: true },
      findIn: (reading: string): Array<TextRange> => {
        return scrubRegExpFromBuiltIn(SERIALIZER_CARD_PATTERN).matchRanges(
          reading,
        );
      },
    }),
    placeholder,
  );
};

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
 * An IPv6 address is kept as an IPv4 one is (#10417). Secrets - tokens,
 * keys, private keys, card numbers, "password=..." - are redacted in a
 * security result as in every other.
 */
export const SECURITY_OBSERVABLE_RULE_NAMES: ReadonlyArray<string> = [
  "email",
  "ip-address",
  "hex-secret",
];

export interface RedactionOptions {
  /*
   * Keep IP addresses (IPv4 and IPv6), email addresses and long hex
   * digests (file hashes): for the security tools, whose results are those
   * observables (SecurityEventTools, SecurityCaseTools) and the security
   * case triage's context.
   */
  keepSecurityObservables?: boolean | undefined;
}

export default class ToolResultSerializer {
  // Single pass per rule: count and substitute ($1/$2 groups) together.
  private static applyRedactionRule(
    text: string,
    rule: RedactionRule,
  ): { text: string; count: number } {
    if ("redact" in rule) {
      return rule.redact(text, rule.placeholder);
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

    for (const rule of REDACTION_RULES) {
      if (
        options?.keepSecurityObservables &&
        SECURITY_OBSERVABLE_RULE_NAMES.includes(rule.name)
      ) {
        continue;
      }

      const applied: { text: string; count: number } = this.applyRedactionRule(
        redacted,
        rule,
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

        const redacted: { text: string; count: number } =
          this.redactAndOmitEmbeddedData(rawValue, options);
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
