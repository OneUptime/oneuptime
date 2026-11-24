import ToolResultSerializer from "../AI/Toolbox/Serializer";

/*
 * Shared exception-text sanitization.
 *
 * normalizeExceptionText is the fingerprint normalizer that used to live
 * in App/FeatureSet/Telemetry/Utils/Exception.ts — it was moved here (the
 * App util now delegates) so server-side consumers in Common (the AI
 * agent data API) can sanitize exception messages before they reach LLM
 * prompts, pull-request text, and commit messages. The replacement
 * behavior MUST stay byte-for-byte stable: fingerprints are computed from
 * its output, and changing it regroups every existing exception.
 */

/**
 * Normalizes a string by replacing dynamic values with placeholders.
 * This ensures that exceptions with the same root cause but different
 * dynamic values (like IDs, timestamps, etc.) get the same fingerprint.
 *
 * @param text - The text to normalize (message or stack trace)
 * @returns The normalized text with dynamic values replaced
 */
export function normalizeExceptionText(text: string): string {
  if (!text) {
    return "";
  }

  let normalized: string = text;

  // Order matters! More specific patterns should come before generic ones.

  // 1. UUIDs (e.g., 550e8400-e29b-41d4-a716-446655440000)
  normalized = normalized.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    "<UUID>",
  );

  // 2. MongoDB ObjectIDs (24 hex characters)
  normalized = normalized.replace(/\b[0-9a-f]{24}\b/gi, "<OBJECT_ID>");

  /*
   * 3. Stripe-style IDs (e.g., sub_xxx, cus_xxx, pi_xxx, ch_xxx, etc.)
   * These have a prefix followed by underscore and alphanumeric characters
   */
  normalized = normalized.replace(
    /\b(sub|cus|pi|ch|pm|card|price|prod|inv|txn|evt|req|acct|payout|ba|btok|src|tok|seti|si|cs|link|file|dp|icr|ii|il|is|isci|mbur|or|po|qt|rcpt|re|refund|sku|tax|txi|tr|us|wh)_[A-Za-z0-9]{10,32}\b/g,
    "<STRIPE_ID>",
  );

  /*
   * 4. Generic API/Service IDs - alphanumeric strings that look like IDs
   * Matches patterns like: prefix_alphanumeric or just long alphanumeric strings
   * Common in many services (AWS, GCP, etc.)
   */
  normalized = normalized.replace(
    /\b[a-z]{2,10}_[A-Za-z0-9]{8,}\b/g,
    "<SERVICE_ID>",
  );

  /*
   * 5. JWT tokens (three base64 segments separated by dots).
   *
   * A token is looked for once per run of the characters it is made of, at
   * the first place in the run one may begin - the run's start, or just
   * after a "-" in it, the places the word boundary allowed - and the text
   * of the run before that place is put back ($1). Every later place in the
   * same run would end the same way, so this lands <JWT> on exactly the
   * tokens a search from every "eyJ" did, of any length, and fingerprints
   * are unchanged; but each run is read a bounded number of times, so a
   * long exception message is read in time in line with its length.
   */
  normalized = normalized.replace(
    /(?<![A-Za-z0-9_-])(?=((?:[A-Za-z0-9_-]*?-)??)eyJ)\1eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\b/g,
    "$1<JWT>",
  );

  // 6. Base64 encoded strings (long sequences, likely tokens or encoded data)
  normalized = normalized.replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "<BASE64>");

  // 7. IP addresses (IPv4)
  normalized = normalized.replace(
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    "<IP>",
  );

  // 8. IP addresses (IPv6) - simplified pattern
  normalized = normalized.replace(
    /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    "<IPV6>",
  );
  normalized = normalized.replace(/\b::1\b/g, "<IPV6>"); // localhost IPv6

  /*
   * 9. Email addresses. Each part is length-bounded to the sizes RFC 5321
   * allows, so reading a long exception message for an address stays in line
   * with its length. The classes are otherwise unchanged, so the <EMAIL>
   * placeholder lands on exactly the addresses it did before and fingerprints
   * are unchanged.
   */
  normalized = normalized.replace(
    /\b[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Z|a-z]{2,63}\b/g,
    "<EMAIL>",
  );

  /*
   * 10. URLs with dynamic paths/query params (normalize the dynamic parts)
   * Keep the domain but normalize path segments that look like IDs
   */
  normalized = normalized.replace(
    /\/[0-9a-f]{8,}(?=\/|$|\?|#|\s|'|")/gi,
    "/<ID>",
  );

  /*
   * 11. Timestamps in various formats
   * ISO 8601 timestamps
   */
  normalized = normalized.replace(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
    "<TIMESTAMP>",
  );
  // Unix timestamps (10 or 13 digits)
  normalized = normalized.replace(/\b1[0-9]{9,12}\b/g, "<TIMESTAMP>");

  // 12. Date formats (YYYY-MM-DD, MM/DD/YYYY, etc.)
  normalized = normalized.replace(/\b\d{4}[-/]\d{2}[-/]\d{2}\b/g, "<DATE>");
  normalized = normalized.replace(/\b\d{2}[-/]\d{2}[-/]\d{4}\b/g, "<DATE>");

  // 13. Time formats (HH:MM:SS, HH:MM)
  normalized = normalized.replace(/\b\d{2}:\d{2}(?::\d{2})?\b/g, "<TIME>");

  // 14. Memory addresses (0x followed by hex)
  normalized = normalized.replace(/\b0x[0-9a-fA-F]+\b/g, "<MEMORY_ADDR>");

  // 15. Session IDs (common patterns) - MUST come before hex ID pattern
  normalized = normalized.replace(
    /\bsession[_-]?id[=:\s]*['"]?[A-Za-z0-9_-]+['"]?/gi,
    "session_id=<SESSION>",
  );

  // 16. Request IDs (common patterns) - MUST come before hex ID pattern
  normalized = normalized.replace(
    /\brequest[_-]?id[=:\s]*['"]?[A-Za-z0-9_-]+['"]?/gi,
    "request_id=<REQUEST>",
  );

  // 17. Correlation IDs - MUST come before hex ID pattern
  normalized = normalized.replace(
    /\bcorrelation[_-]?id[=:\s]*['"]?[A-Za-z0-9_-]+['"]?/gi,
    "correlation_id=<CORRELATION>",
  );

  // 18. Transaction IDs - MUST come before hex ID pattern
  normalized = normalized.replace(
    /\btransaction[_-]?id[=:\s]*['"]?[A-Za-z0-9_-]+['"]?/gi,
    "transaction_id=<TRANSACTION>",
  );

  // 19. Hex strings that are likely IDs (8+ chars)
  normalized = normalized.replace(/\b[0-9a-f]{8,}\b/gi, "<HEX_ID>");

  /*
   * 20. Quoted strings containing IDs or dynamic values
   * Match strings in single or double quotes that look like IDs
   */
  normalized = normalized.replace(/'[A-Za-z0-9_-]{16,}'/g, "'<ID>'");
  normalized = normalized.replace(/"[A-Za-z0-9_-]{16,}"/g, '"<ID>"');

  // 21. Port numbers in URLs or connection strings
  normalized = normalized.replace(/:(\d{4,5})(?=\/|$|\s)/g, ":<PORT>");

  /*
   * 22. Line numbers in stack traces (keep for context, but normalize large numbers)
   * This normalizes specific line/column references that might vary
   */
  normalized = normalized.replace(/:\d+:\d+\)?$/gm, ":<LINE>:<COL>)");

  // 23. Process/Thread IDs
  normalized = normalized.replace(/\bPID[:\s]*\d+\b/gi, "PID:<PID>");
  normalized = normalized.replace(/\bTID[:\s]*\d+\b/gi, "TID:<TID>");

  // 24. Numeric IDs in common patterns (id=123, id: 123, etc.)
  normalized = normalized.replace(/\bid[=:\s]*['"]?\d+['"]?/gi, "id=<ID>");

  // 25. Large numbers that are likely IDs (more than 6 digits)
  normalized = normalized.replace(/\b\d{7,}\b/g, "<NUMBER>");

  return normalized;
}

/*
 * GROUPING V3'S FOLDS (#10620).
 *
 * normalizeExceptionText takes out runs of seven or more digits, but not the
 * numbers people write with separators: a card number in groups ("card
 * 4111-1111-1111-1234 declined"), a US Social Security number ("Invalid SSN
 * 123-45-6789"), a phone number ("call 555-123-4567"). An exception grouped
 * by a message that holds one became one exception per value, each setting
 * off New Exception. These are the values Data Security's Credit Card, SSN
 * and Phone Number scrub rules find, and they are found the same way: the
 * card and SSN patterns are frozen copies of SCRUB_RULE_BUILT_IN_PATTERNS'
 * (Types/Telemetry/ScrubRule.ts) as they were when grouping v3 shipped, so a
 * change there never regroups an exception. The phone pattern finds the
 * numbers the Phone Number rule finds, written as people write them, and
 * takes an area code in parentheses whole: the rule's cannot begin at "(",
 * and "(555) 222-3333" folded to "(<PHONE>" would be grouped apart from
 * "555-123-4567".
 *
 * Read over text normalizeExceptionText already normalized, so the values it
 * folds (UUIDs, hex ids, timestamps) are placeholders by then and no fold
 * here reads a piece of one. Like normalizeExceptionText, this MUST stay byte
 * for byte stable: every exception grouping v3 makes is found by its output.
 */
const GROUPED_CARD_NUMBER_PATTERN: RegExp = /\b(?:\d{4}[-\s]?){3}\d{4}\b/g;
const SOCIAL_SECURITY_NUMBER_PATTERN: RegExp = /\b\d{3}-\d{2}-\d{4}\b/g;
const PHONE_NUMBER_PATTERN: RegExp =
  /(?<![\w+(])(?:\+?1[-.\s]?)?(?:\(\d{3}\)[-.\s]?|\d{3}[-.\s]?)\d{3}[-.\s]?\d{4}(?!\w)/g;

export function foldSeparatedNumbers(normalizedText: string): string {
  if (!normalizedText) {
    return "";
  }

  return normalizedText
    .replace(GROUPED_CARD_NUMBER_PATTERN, "<CARD>")
    .replace(SOCIAL_SECURITY_NUMBER_PATTERN, "<SSN>")
    .replace(PHONE_NUMBER_PATTERN, "<PHONE>");
}

/*
 * GROUPING V4'S FOLDS (#10898).
 *
 * What grouping v3's folds leave of the numbers people write with
 * separators, each of which still made one exception per value:
 *
 *  - a 15-digit American Express card, written 4-6-5 ("3782 822463 10005");
 *  - a 19-digit card written 4-4-4-4-3, whose first sixteen digits v3
 *    already folded ("<CARD> 117");
 *  - an international phone number: a plus sign and a country code, then
 *    the number in groups ("+44 20 7946 0958", "+49 30 123456",
 *    "(+44) 20 7946 0958", "+44 (0)20 7946 0958", "+81 3-1234-5678"), 8 to
 *    15 digits in all, as E.164 allows. Its last group may be what the
 *    normalizer or v3 already made of a long one: <NUMBER> (seven digits),
 *    <HEX_ID> (eight or more), or v3's <PHONE> ("+44 207 946 0958" read
 *    "+44 <PHONE>").
 *
 * Read over text grouping v3 already folded, so two messages v3 groups as
 * one, v4 groups as one too. A phone number is found only by its plus sign,
 * set apart from its groups by a space or a hyphen - never a dot, which a
 * decimal, a version and an address are written with - and only whole: a
 * group of one digit comes right after the country code or nowhere, and a
 * number that runs on into a word or past fifteen digits is left as it is.
 * So an order number, a timestamp, a timezone (+0000, +05:30), a version
 * (1.2.3+4) or an id stays in the message.
 *
 * Not folded: a number written with no separator at all ("+442079460958"),
 * which the normalizer already made one value ("+<HEX_ID>"); a national
 * number with no plus sign ("020 7946 0958"), which reads like any other run
 * of numbers; a 14-digit Diners Club card (4-6-4), whose last ten digits v3
 * reads as a phone number.
 *
 * Like the folds above, this MUST stay byte for byte stable once grouping v4
 * ships: every exception it makes is found by its output.
 */
const AMERICAN_EXPRESS_CARD_PATTERN: RegExp =
  /\b\d{4}[-\s]?\d{6}[-\s]?\d{5}\b/g;
const NINETEEN_DIGIT_CARD_PATTERN: RegExp = /<CARD>[-\s]\d{3}\b/g;
/*
 * A plus sign and a country code - "+44", or "(+44)" - and every group
 * after it, as long as it goes: digits, a group in parentheses ("(0)20",
 * "(495)"), or a placeholder a long group was folded into. Greedy, with
 * nothing after it to fail, so it never reads a group twice; whether what it
 * found is a whole phone number is isInternationalPhoneNumber's to say.
 */
const INTERNATIONAL_PHONE_CANDIDATE_PATTERN: RegExp =
  /(?<![\w+])(?:\(\+[1-9]\d{0,2}\)|\+[1-9]\d{0,2})(?:[ \u00A0-]?\(\d{1,4}\)\d{0,6}|[ \u00A0-](?:\d{1,6}|<PHONE>|<NUMBER>|<HEX_ID>))+/g;
// A candidate's groups after its country code.
const PHONE_GROUP_PATTERN: RegExp =
  /\(\d{1,4}\)\d{0,6}|<PHONE>|<NUMBER>|<HEX_ID>|\d+/g;
// How many digits, at the least, each placeholder a group became holds.
const PHONE_GROUP_PLACEHOLDER_DIGITS: ReadonlyMap<string, number> = new Map<
  string,
  number
>([
  ["<PHONE>", 10],
  ["<NUMBER>", 7],
  ["<HEX_ID>", 8],
]);
// E.164: a country code and its national number, at most 15 digits.
const MIN_INTERNATIONAL_PHONE_DIGITS: number = 8;
const MAX_INTERNATIONAL_PHONE_DIGITS: number = 15;
// What a phone number may not run on into: a word, or a placeholder.
const RUNS_ON_PATTERN: RegExp = /^[\w<]/;

function countDigits(text: string): number {
  let digits: number = 0;

  for (const character of text) {
    if (character >= "0" && character <= "9") {
      digits++;
    }
  }

  return digits;
}

/*
 * Whether a candidate the pattern found (`candidate`, followed in the text
 * by `next`) is a whole international phone number: it does not run on into
 * a word or a placeholder, a placeholder is its last group, only its first
 * group after the country code is a single digit, and it holds 8 to 15
 * digits, a placeholder counted at the fewest it holds.
 */
export function isInternationalPhoneNumber(
  candidate: string,
  next: string,
): boolean {
  if (RUNS_ON_PATTERN.test(next)) {
    return false;
  }

  const plus: number = candidate.indexOf("+");
  let at: number = plus + 1;

  while (
    at < candidate.length &&
    candidate[at]! >= "0" &&
    candidate[at]! <= "9"
  ) {
    at++;
  }

  const groups: Array<string> =
    candidate.slice(at).match(PHONE_GROUP_PATTERN) || [];
  let digits: number = at - plus - 1;

  for (const [index, group] of groups.entries()) {
    const placeholderDigits: number | undefined =
      PHONE_GROUP_PLACEHOLDER_DIGITS.get(group);

    if (placeholderDigits !== undefined) {
      if (index !== groups.length - 1) {
        return false;
      }

      digits += placeholderDigits;
      continue;
    }

    const groupDigits: number = countDigits(group);

    if (index > 0 && !group.startsWith("(") && groupDigits < 2) {
      return false;
    }

    digits += groupDigits;
  }

  return (
    groups.length > 0 &&
    digits >= MIN_INTERNATIONAL_PHONE_DIGITS &&
    digits <= MAX_INTERNATIONAL_PHONE_DIGITS
  );
}

export function foldSeparatedNumbersV4(foldedText: string): string {
  if (!foldedText) {
    return "";
  }

  return foldedText
    .replace(AMERICAN_EXPRESS_CARD_PATTERN, "<CARD>")
    .replace(NINETEEN_DIGIT_CARD_PATTERN, "<CARD>")
    .replace(
      INTERNATIONAL_PHONE_CANDIDATE_PATTERN,
      (candidate: string, offset: number, text: string): string => {
        return isInternationalPhoneNumber(
          candidate,
          text.charAt(offset + candidate.length),
        )
          ? "<PHONE>"
          : candidate;
      },
    );
}

/**
 * Sanitize an exception message for surfaces that leave the platform:
 * LLM prompts, pull-request titles/bodies, and commit messages.
 *
 * Normalization replaces the dynamic tokens (UUIDs, emails, IPs, IDs,
 * timestamps...) that carry user data, then the secret redactor sweeps
 * whatever is left (bearer tokens, API keys, cards...). The message
 * keeps its structure — "invalid input syntax for type uuid: <HEX_ID>"
 * is still perfectly actionable for a fix.
 */
export function sanitizeExceptionMessage(message: string): string {
  if (!message) {
    return "";
  }
  return ToolResultSerializer.redact(normalizeExceptionText(message)).text;
}

/**
 * Sanitize a stack trace for the same surfaces.
 *
 * Runtimes prefix the native stack string with the exception MESSAGE
 * ("Error: <message>" in Node, "ValueError: <message>" in Python
 * headers, "Caused by: ..." in Java) — so a redact-only pass would leak
 * the very identifiers sanitizeExceptionMessage strips. Frame lines are
 * indented ("    at fn (file:42:7)", '  File "x.py", line 3', "\tat ...")
 * and must keep exact file:line references for the code agent, so the
 * split is: unindented header/message lines get full normalization,
 * indented frame lines are left intact, and the secret redactor sweeps
 * everything at the end.
 */
// Frame lines are indented; header/message lines are not.
const INDENTED_FRAME_LINE_REGEX: RegExp = /^\s/;

/*
 * ...except in Firefox and Safari, which indent nothing: SpiderMonkey and
 * JavaScriptCore write `fn@source:line:col` flush against column 0 and emit no
 * header line at all. Without this second test every browser frame takes the
 * header branch, where rule 19 rewrites the content hash in
 * `entry.a1b2c3d4.js` to `<HEX_ID>` and rule 22 rewrites `:1:98217` to
 * `:<LINE>:<COL>)` — destroying for Firefox and Safari exactly the file:line
 * references the comment above promises to keep for V8 ones.
 */
const BROWSER_FRAME_LINE_REGEX: RegExp =
  /^[^@:\n]{0,256}@(?:\[(?:native|wasm) code\]|self-hosted:\d{1,9}(?::\d{1,9})?|[A-Za-z][A-Za-z0-9+.-]{0,31}:[^\s]{1,2048}:\d{1,9}(?::\d{1,9})?)\r?$/;

export function sanitizeStackTrace(stackTrace: string): string {
  if (!stackTrace) {
    return "";
  }

  const normalized: string = stackTrace
    .split("\n")
    .map((line: string): string => {
      return INDENTED_FRAME_LINE_REGEX.test(line) ||
        BROWSER_FRAME_LINE_REGEX.test(line)
        ? line
        : normalizeExceptionText(line);
    })
    .join("\n");

  return ToolResultSerializer.redact(normalized).text;
}
