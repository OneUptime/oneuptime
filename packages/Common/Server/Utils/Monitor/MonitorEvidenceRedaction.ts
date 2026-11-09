import Dictionary from "../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import { MonitorEvaluationDetailsLimits } from "../../../Types/Monitor/MonitorEvaluationDetails";
import {
  REDACTED,
  isSensitiveLogKey,
  normalizeLogKey,
  redactLogString,
} from "../LogRedaction";
import JsonTextScanner, { JsonTextScan } from "./JsonTextScanner";

/*
 * WHAT AN INCIDENT OR AN ALERT MAY KEEP OF THE CHECK THAT OPENED IT.
 *
 * An incident or an alert keeps evidence of the check that opened it: the
 * evaluation details (which filter matched, on what, with a short excerpt of
 * the response) and the monitor summary. Both are read by everyone who can
 * read the record - Viewer included - and both reach places that last far
 * longer than the monitor's own one-day log. So what they keep is redacted
 * first, here, by one set of rules:
 *
 *   - Headers and JSON fields whose NAMES say they hold a credential or
 *     personal data keep their name and lose their value: Authorization,
 *     Cookie, Set-Cookie, Proxy-Authorization, X-API-Key, any *token,
 *     *secret, *password, *key, *session, and email, phone, date of birth,
 *     card number and the like. The credential names are the ones the
 *     logger and the monitor log already redact (LogRedaction's
 *     isSensitiveLogKey, which MonitorPayloadRedaction shares), so there is
 *     one list to keep current; this adds whole words that list leaves to
 *     context - "key", "session", "auth" - and the personal-data names.
 *
 *   - TEXT that looks like a credential wherever it stands: a bearer token, a
 *     JWT, a secret in "key=value" or JSON text, a provider's token (Slack,
 *     GitHub, AWS, Google), a private key, a URL's password - the logger's own
 *     text rules (redactLogString) - plus two kinds of personal data worth
 *     looking for in any text:
 *
 *       - email addresses: they are in most API responses that carry a user,
 *         they identify a person on their own, and their shape is exact
 *         enough that ordinary text is never mistaken for one;
 *       - card numbers: rare, but the costliest thing to leak. A number is
 *         taken for a card only with a card network's prefix, a card's length
 *         and a valid check digit, so timestamps and record ids - which start
 *         with 1 for decades yet - are not.
 *
 *     Phone numbers, postal addresses, names and IP addresses are not looked
 *     for in text: no pattern tells them from the ids, counts, times and
 *     hosts that are a response's actual evidence (an IP address is often
 *     the very thing a check is about), so a pattern would mask the evidence
 *     and still miss most of them. A field NAMED phone is masked.
 *
 *   - URLs keep their scheme, host and path; a password in them and the value
 *     of a query parameter whose name says secret (api_key=, token=, sig=,
 *     X-Amz-Signature=, ...) are masked.
 *
 * Over-masking is the intended failure mode, as it is for the logger: a
 * masked field costs a little context, a leaked token costs an account.
 *
 * Everything here reads text in time in line with its length - response
 * bodies and headers are written by whatever a monitor watches.
 */

// Deep enough for any real response, shallow enough to bound the walk.
const MAX_DEPTH: number = 12;

/*
 * Stands in for a [REDACTED] already in a text while the text rules read it:
 * "token=[REDACTED]" read again would mask "[REDACTED" and leave a stray "]".
 * A character of the Private Use Area, which no rule is about.
 */
const MASKED_PLACEHOLDER: string = "\u{E000}";

/*
 * A name longer than this is not a field anybody named on purpose; its
 * value is masked rather than the whole name read.
 */
const MAX_CLASSIFIED_NAME_LENGTH: number = 256;

/*
 * Whole words of a name that mark its value as a credential, beyond the
 * fragments isSensitiveLogKey already reads anywhere in a name. Whole words
 * only: "key" masks api_key, apiKey and x-api-key but not monkey or keyboard.
 */
const SENSITIVE_NAME_WORDS: ReadonlySet<string> = new Set<string>([
  "key",
  "keys",
  "session",
  "sessions",
  "auth",
  "sig",
  "pin",
  "pwd",
  "pass",
  "cvv",
  "cvc",
  "ssn",
  "iban",
  "dob",
  "email",
  "emails",
  "phone",
  "phones",
  "mobile",
  "passport",
]);

/*
 * Personal data whose names run several words together, read anywhere in
 * the name with separators and case dropped (normalizeLogKey).
 */
const PERSONAL_DATA_NAME_FRAGMENTS: ReadonlyArray<string> = [
  "emailaddress",
  "phonenumber",
  "mobilenumber",
  "telephone",
  "dateofbirth",
  "birthdate",
  "birthday",
  "cardnumber",
  "creditcard",
  "debitcard",
  "securitycode",
  "socialsecurity",
  "taxid",
  "nationalid",
  "passportnumber",
];

/*
 * "code" is decided by its value in the logger: digits are a TOTP there.
 * In a response, a numeric code is an error code - the evidence itself - so
 * a field named only code keeps its value here. A credential that is text
 * under it is still caught by the text rules.
 */
const RESPONSE_CODE_NAMES: ReadonlySet<string> = new Set<string>([
  "code",
  "codes",
]);

/*
 * Query parameters that carry a signature or a credential under a name no
 * rule above reads as one: AWS presigned URLs (X-Amz-Signature,
 * X-Amz-Credential, X-Amz-Security-Token), Azure shared access signatures
 * (sig), Google signed URLs (X-Goog-Signature) and OAuth codes.
 */
const SENSITIVE_QUERY_PARAMETER_NAMES: ReadonlySet<string> = new Set<string>([
  "sig",
  "code",
  "xamzsignature",
  "xamzcredential",
  "xamzsecuritytoken",
  "xgoogsignature",
  "xgoogcredential",
  "awsaccesskeyid",
]);

// Splits a name into its lowercase words: X-API-Key -> x, api, key.
const splitNameIntoWords: (name: string) => Array<string> = (
  name: string,
): Array<string> => {
  const words: Array<string> = [];
  let current: string = "";

  const isUpper: (c: string) => boolean = (c: string): boolean => {
    return c >= "A" && c <= "Z";
  };

  const isLower: (c: string) => boolean = (c: string): boolean => {
    return c >= "a" && c <= "z";
  };

  const isDigit: (c: string) => boolean = (c: string): boolean => {
    return c >= "0" && c <= "9";
  };

  for (let index: number = 0; index < name.length; index++) {
    const character: string = name.charAt(index);

    if (!isUpper(character) && !isLower(character) && !isDigit(character)) {
      if (current) {
        words.push(current.toLowerCase());
      }
      current = "";
      continue;
    }

    const previous: string = index > 0 ? name.charAt(index - 1) : "";
    const next: string = index + 1 < name.length ? name.charAt(index + 1) : "";

    /*
     * A word starts at an upper-case letter after a lower-case one
     * (sessionToken), and at the last capital of a run of them that a
     * lower-case letter follows (APIKey -> API, Key).
     */
    const startsWord: boolean =
      Boolean(current) &&
      isUpper(character) &&
      (isLower(previous) || isDigit(previous) || isLower(next));

    if (startsWord) {
      words.push(current.toLowerCase());
      current = "";
    }

    current += character;
  }

  if (current) {
    words.push(current.toLowerCase());
  }

  return words;
};

export default class MonitorEvidenceRedaction {
  public static readonly REDACTED: string = REDACTED;

  /*
   * Does a JSON field or a header with this name hold a credential or
   * personal data? `value` is what it holds, for the logger's few
   * value-dependent names.
   */
  public static isSensitiveName(name: string, value?: unknown): boolean {
    if (typeof name !== "string" || !name) {
      return false;
    }

    if (name.length > MAX_CLASSIFIED_NAME_LENGTH) {
      return true;
    }

    const normalized: string = normalizeLogKey(name);

    if (!normalized) {
      return false;
    }

    if (
      !RESPONSE_CODE_NAMES.has(normalized) &&
      isSensitiveLogKey(name, value)
    ) {
      return true;
    }

    const words: Array<string> = splitNameIntoWords(name);

    if (
      words.some((word: string) => {
        return SENSITIVE_NAME_WORDS.has(word);
      })
    ) {
      return true;
    }

    return PERSONAL_DATA_NAME_FRAGMENTS.some((fragment: string) => {
      return normalized.includes(fragment);
    });
  }

  // A header's value is kept only when its name says nothing secret.
  public static isSensitiveHeaderName(name: string): boolean {
    return MonitorEvidenceRedaction.isSensitiveName(name);
  }

  /*
   * Masks what text says that looks like a credential or personal data,
   * wherever it stands, and leaves the rest as written. Reading a text it
   * already redacted changes nothing.
   */
  public static redactText(text: string): string {
    if (typeof text !== "string" || !text) {
      return text;
    }

    const hasMasks: boolean = text.indexOf(REDACTED) !== -1;
    const protectedText: string = hasMasks
      ? text.split(REDACTED).join(MASKED_PLACEHOLDER)
      : text;

    const redacted: string = MonitorEvidenceRedaction.maskCardNumbers(
      MonitorEvidenceRedaction.maskEmailAddresses(
        MonitorEvidenceRedaction.closeMarkersOnce(
          protectedText,
          redactLogString(protectedText),
        ),
      ),
    );

    return redacted.indexOf(MASKED_PLACEHOLDER) === -1
      ? redacted
      : redacted.split(MASKED_PLACEHOLDER).join(REDACTED);
  }

  /*
   * The logger's rules run one after another, and a later one can read the
   * [REDACTED] an earlier one wrote as the start of a value of its own:
   * "Authorization: Bearer x" becomes "Authorization: Bearer [REDACTED]",
   * then "Authorization: [REDACTED]]" - the stray "]" the first marker's.
   * Every rule writes whole markers, so each such "]" is one more closing
   * bracket than the text had: as many as there are extra are taken away,
   * each from after a marker.
   */
  private static closeMarkersOnce(before: string, after: string): string {
    const extra: number =
      MonitorEvidenceRedaction.countBracketBalance(after) -
      MonitorEvidenceRedaction.countBracketBalance(before);

    if (extra <= 0) {
      return after;
    }

    const doubled: string = `${REDACTED}]`;
    let result: string = "";
    let cursor: number = 0;
    let left: number = extra;
    let index: number = after.indexOf(doubled);

    while (index !== -1 && left > 0) {
      result += after.slice(cursor, index) + REDACTED;
      cursor = index + doubled.length;
      left--;
      index = after.indexOf(doubled, cursor);
    }

    return result + after.slice(cursor);
  }

  // How many more "]" than "[" a text holds.
  private static countBracketBalance(text: string): number {
    let balance: number = 0;

    for (let index: number = 0; index < text.length; index++) {
      const character: string = text.charAt(index);

      if (character === "]") {
        balance++;
      } else if (character === "[") {
        balance--;
      }
    }

    return balance;
  }

  /*
   * A copy of a parsed JSON value with the values of sensitive fields
   * masked and every string swept by redactText. Never mutates its input:
   * the caller is still evaluating it. Past MAX_DEPTH a subtree is dropped
   * rather than passed through unread.
   */
  public static redactJson(value: JSONValue, depth: number = 0): JSONValue {
    if (depth > MAX_DEPTH) {
      return null;
    }

    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === "string") {
      return MonitorEvidenceRedaction.redactText(value);
    }

    if (Array.isArray(value)) {
      return value.map((item: JSONValue) => {
        return MonitorEvidenceRedaction.redactJson(item, depth + 1);
      });
    }

    if (
      typeof value !== "object" ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      return value;
    }

    const source: JSONObject = value as JSONObject;
    const result: JSONObject = {};

    for (const key of Object.keys(source)) {
      const child: JSONValue = source[key] as JSONValue;

      if (MonitorEvidenceRedaction.isSensitiveName(key, child)) {
        result[key] = REDACTED;
        continue;
      }

      result[key] = MonitorEvidenceRedaction.redactJson(child, depth + 1);
    }

    return result;
  }

  /*
   * A JSON text - a body kept as text, as an API monitor's is, or a script's
   * result returned as one - with the values of the fields whose names say
   * credential or personal data masked where they sit in the text, as an
   * incident's excerpt finds them (JsonTextScanner, ResponseExcerpt.readText).
   * Each becomes the JSON string "[REDACTED]", so the rest is kept as written
   * and the text still parses. A text that is not one whole JSON object or
   * array, or is longer than MonitorEvaluationDetailsLimits.scannedBodyChars,
   * is returned as it is, for the text rules alone - as the excerpt reads it.
   * Linear in the text's length.
   */
  public static maskSensitiveJsonTextValues(text: string): string {
    if (
      typeof text !== "string" ||
      !text ||
      text.length > MonitorEvaluationDetailsLimits.scannedBodyChars
    ) {
      return text;
    }

    const firstCharacter: string = text.trimStart().charAt(0);

    if (firstCharacter !== "{" && firstCharacter !== "[") {
      return text;
    }

    const scan: JsonTextScan | null = JsonTextScanner.scan({
      text: text,
      isSensitiveName: (name: string): boolean => {
        return MonitorEvidenceRedaction.isSensitiveName(name);
      },
    });

    if (!scan || scan.sensitiveSpans.length === 0) {
      return text;
    }

    const masked: string = JSON.stringify(REDACTED);
    let result: string = "";
    let cursor: number = 0;

    // In text order and never overlapping.
    for (const span of scan.sensitiveSpans) {
      result += text.slice(cursor, span.start) + masked;
      cursor = span.end;
    }

    return result + text.slice(cursor);
  }

  /*
   * Headers as an incident or alert may keep them: every name, the value of
   * a sensitive one masked, the others swept for credential-shaped text (a
   * Location header with a token in its query, say).
   */
  public static redactHeaders(
    headers: Dictionary<string> | null | undefined,
  ): Dictionary<string> | undefined {
    if (!headers || typeof headers !== "object") {
      return undefined;
    }

    const result: Dictionary<string> = {};

    for (const name of Object.keys(headers)) {
      const value: unknown = headers[name];

      if (MonitorEvidenceRedaction.isSensitiveHeaderName(name)) {
        result[name] = REDACTED;
        continue;
      }

      result[name] =
        typeof value === "string"
          ? MonitorEvidenceRedaction.redactUrlsInText(
              MonitorEvidenceRedaction.redactText(value),
            )
          : (value as string);
    }

    return result;
  }

  /*
   * A URL as an incident or alert may keep it. Read as written, not through
   * a URL parser: a parser re-encodes it ({{monitorSecrets.ApiKey}} would
   * come back as %7B%7B...), and the reader should see the address they
   * configured. Masks a password in the authority and the value of every
   * sensitive query parameter, then sweeps what is left for credential-
   * shaped text (a JWT in the path, a Telegram bot token).
   */
  public static redactUrl(url: string): string {
    if (typeof url !== "string" || !url) {
      return url;
    }

    // What looks like a credential first, then what the URL's parts say.
    let result: string = MonitorEvidenceRedaction.redactText(url);

    // The authority's userinfo: scheme://user:password@host
    const schemeEnd: number = result.indexOf("://");

    if (schemeEnd !== -1) {
      const authorityStart: number = schemeEnd + 3;
      let authorityEnd: number = result.length;

      for (const terminator of ["/", "?", "#"]) {
        const position: number = result.indexOf(terminator, authorityStart);

        if (position !== -1 && position < authorityEnd) {
          authorityEnd = position;
        }
      }

      const authority: string = result.slice(authorityStart, authorityEnd);
      const atSign: number = authority.lastIndexOf("@");

      if (atSign !== -1) {
        const userInfo: string = authority.slice(0, atSign);
        const colon: number = userInfo.indexOf(":");
        const maskedUserInfo: string =
          colon === -1 ? REDACTED : `${userInfo.slice(0, colon)}:${REDACTED}`;

        result =
          result.slice(0, authorityStart) +
          maskedUserInfo +
          authority.slice(atSign) +
          result.slice(authorityEnd);
      }
    }

    // The query: name=value pairs up to the fragment.
    const queryStart: number = result.indexOf("?");

    if (queryStart !== -1) {
      const fragmentStart: number = result.indexOf("#", queryStart);
      const queryEnd: number =
        fragmentStart === -1 ? result.length : fragmentStart;
      const query: string = result.slice(queryStart + 1, queryEnd);

      const maskedQuery: string = query
        .split("&")
        .map((pair: string): string => {
          const equals: number = pair.indexOf("=");

          if (equals === -1) {
            return pair;
          }

          const rawName: string = pair.slice(0, equals);

          return MonitorEvidenceRedaction.isSensitiveQueryParameter(rawName)
            ? `${rawName}=${REDACTED}`
            : pair;
        })
        .join("&");

      result =
        result.slice(0, queryStart + 1) + maskedQuery + result.slice(queryEnd);
    }

    return result;
  }

  /*
   * Every http(s) URL inside a text, redacted as redactUrl does. A URL runs
   * to whitespace, a quote or a bracket.
   */
  public static redactUrlsInText(input: string): string {
    if (typeof input !== "string" || input.indexOf("://") === -1) {
      return input;
    }

    /*
     * A [REDACTED] already in the text is read as one character, so a URL
     * runs on through it rather than ending at its "]".
     */
    const hasMasks: boolean = input.indexOf(REDACTED) !== -1;
    const text: string = hasMasks
      ? input.split(REDACTED).join(MASKED_PLACEHOLDER)
      : input;

    let result: string = "";
    let cursor: number = 0;
    let schemeEnd: number = text.indexOf("://");

    while (schemeEnd !== -1) {
      // Back to the scheme's start: letters, digits, + . - (bounded).
      let start: number = schemeEnd;

      while (
        start > cursor &&
        schemeEnd - start < 32 &&
        MonitorEvidenceRedaction.isSchemeCharacter(text.charAt(start - 1))
      ) {
        start--;
      }

      if (start === schemeEnd) {
        schemeEnd = text.indexOf("://", schemeEnd + 3);
        continue;
      }

      let end: number = schemeEnd + 3;

      while (
        end < text.length &&
        !MonitorEvidenceRedaction.endsUrl(text.charAt(end))
      ) {
        end++;
      }

      result +=
        text.slice(cursor, start) +
        MonitorEvidenceRedaction.redactUrl(text.slice(start, end));
      cursor = end;
      schemeEnd = text.indexOf("://", end);
    }

    result += text.slice(cursor);

    return result.indexOf(MASKED_PLACEHOLDER) === -1
      ? result
      : result.split(MASKED_PLACEHOLDER).join(REDACTED);
  }

  /*
   * Masks every email address in a text. Found from each "@": the local part
   * before it (at most 64 characters) and the domain after it (at most 253),
   * so each "@" is read a bounded number of characters either way.
   */
  public static maskEmailAddresses(text: string): string {
    if (typeof text !== "string" || text.indexOf("@") === -1) {
      return text;
    }

    let result: string = "";
    let cursor: number = 0;
    let at: number = text.indexOf("@");

    while (at !== -1) {
      let start: number = at;

      while (
        start > cursor &&
        at - start < 64 &&
        MonitorEvidenceRedaction.isLocalPartCharacter(text.charAt(start - 1))
      ) {
        start--;
      }

      // A local part does not start with a dot.
      while (start < at && text.charAt(start) === ".") {
        start++;
      }

      let end: number = at + 1;

      while (
        end < text.length &&
        end - at - 1 < 253 &&
        MonitorEvidenceRedaction.isDomainCharacter(text.charAt(end))
      ) {
        end++;
      }

      // A domain does not end with a dot or a hyphen: "mail me at a@b.com."
      while (
        end > at + 1 &&
        (text.charAt(end - 1) === "." || text.charAt(end - 1) === "-")
      ) {
        end--;
      }

      if (
        start < at &&
        MonitorEvidenceRedaction.isEmailDomain(text.slice(at + 1, end))
      ) {
        result += text.slice(cursor, start) + REDACTED;
        cursor = end;
        at = text.indexOf("@", end);
        continue;
      }

      at = text.indexOf("@", at + 1);
    }

    return result + text.slice(cursor);
  }

  /*
   * Masks every card number in a text: 13 to 19 digits, written together or
   * in groups split by single spaces or hyphens, that start with a card
   * network's prefix and carry a valid Luhn check digit. Each run of digits
   * is read once.
   */
  public static maskCardNumbers(text: string): string {
    if (typeof text !== "string" || text.length < 13) {
      return text;
    }

    let result: string = "";
    let cursor: number = 0;
    let index: number = 0;

    while (index < text.length) {
      const character: string = text.charAt(index);

      if (
        !MonitorEvidenceRedaction.isDigit(character) ||
        (index > 0 &&
          MonitorEvidenceRedaction.isWordCharacter(text.charAt(index - 1)))
      ) {
        index++;
        continue;
      }

      let end: number = index;
      let digits: string = "";

      while (end < text.length) {
        const current: string = text.charAt(end);

        if (MonitorEvidenceRedaction.isDigit(current)) {
          digits += current;
          end++;

          if (digits.length > 19) {
            break;
          }

          continue;
        }

        const isSeparator: boolean = current === " " || current === "-";

        if (
          isSeparator &&
          end + 1 < text.length &&
          MonitorEvidenceRedaction.isDigit(text.charAt(end + 1)) &&
          MonitorEvidenceRedaction.isDigit(text.charAt(end - 1))
        ) {
          end++;
          continue;
        }

        break;
      }

      const isWholeNumber: boolean =
        digits.length <= 19 &&
        !(
          end < text.length &&
          MonitorEvidenceRedaction.isWordCharacter(text.charAt(end))
        );

      if (isWholeNumber && MonitorEvidenceRedaction.isCardNumber(digits)) {
        result += text.slice(cursor, index) + REDACTED;
        cursor = end;
      }

      /*
       * Past the whole run, digits beyond 19 included, so no later start
       * inside it is tried again.
       */
      while (
        end < text.length &&
        MonitorEvidenceRedaction.isDigit(text.charAt(end))
      ) {
        end++;
      }

      index = Math.max(end, index + 1);
    }

    return result + text.slice(cursor);
  }

  /*
   * A card number: a network's prefix (Visa, Mastercard, American Express,
   * Discover, JCB, Diners Club, UnionPay, Maestro), a length that network
   * issues, and a valid Luhn check digit.
   */
  public static isCardNumber(digits: string): boolean {
    if (digits.length < 13 || digits.length > 19) {
      return false;
    }

    const prefixOf: (length: number) => number = (length: number): number => {
      return Number(digits.slice(0, length));
    };

    const hasNetworkPrefix: boolean =
      // Visa
      (digits.charAt(0) === "4" && [13, 16, 19].includes(digits.length)) ||
      // Mastercard
      (digits.length === 16 &&
        ((prefixOf(2) >= 51 && prefixOf(2) <= 55) ||
          (prefixOf(4) >= 2221 && prefixOf(4) <= 2720))) ||
      // American Express
      (digits.length === 15 && (prefixOf(2) === 34 || prefixOf(2) === 37)) ||
      // Diners Club
      (digits.length === 14 &&
        ((prefixOf(3) >= 300 && prefixOf(3) <= 305) ||
          prefixOf(2) === 36 ||
          prefixOf(2) === 38)) ||
      // Discover
      (digits.length >= 16 &&
        (prefixOf(4) === 6011 ||
          prefixOf(2) === 65 ||
          (prefixOf(3) >= 644 && prefixOf(3) <= 649))) ||
      // JCB
      (digits.length >= 16 && prefixOf(4) >= 3528 && prefixOf(4) <= 3589) ||
      // UnionPay
      (digits.length >= 16 && prefixOf(2) === 62) ||
      // Maestro
      prefixOf(2) === 50 ||
      (prefixOf(2) >= 56 && prefixOf(2) <= 69);

    if (!hasNetworkPrefix) {
      return false;
    }

    let sum: number = 0;
    let shouldDouble: boolean = false;

    for (let index: number = digits.length - 1; index >= 0; index--) {
      let digit: number = Number(digits.charAt(index));

      if (shouldDouble) {
        digit = digit * 2;

        if (digit > 9) {
          digit = digit - 9;
        }
      }

      sum += digit;
      shouldDouble = !shouldDouble;
    }

    return sum % 10 === 0;
  }

  private static isSensitiveQueryParameter(rawName: string): boolean {
    let name: string = rawName;

    try {
      name = decodeURIComponent(rawName.split("+").join(" "));
    } catch {
      name = rawName;
    }

    if (SENSITIVE_QUERY_PARAMETER_NAMES.has(normalizeLogKey(name))) {
      return true;
    }

    return MonitorEvidenceRedaction.isSensitiveName(name);
  }

  private static isEmailDomain(domain: string): boolean {
    if (!domain || domain.length > 253) {
      return false;
    }

    const labels: Array<string> = domain.split(".");

    if (labels.length < 2) {
      return false;
    }

    if (
      labels.some((label: string) => {
        return !label || label.length > 63;
      })
    ) {
      return false;
    }

    const topLevel: string = labels[labels.length - 1] || "";

    if (topLevel.length < 2) {
      return false;
    }

    for (let index: number = 0; index < topLevel.length; index++) {
      const character: string = topLevel.charAt(index).toLowerCase();

      if (character < "a" || character > "z") {
        return false;
      }
    }

    return true;
  }

  private static isDigit(character: string): boolean {
    return character >= "0" && character <= "9";
  }

  private static isWordCharacter(character: string): boolean {
    return (
      MonitorEvidenceRedaction.isDigit(character) ||
      (character >= "a" && character <= "z") ||
      (character >= "A" && character <= "Z") ||
      character === "_"
    );
  }

  private static isLocalPartCharacter(character: string): boolean {
    return (
      MonitorEvidenceRedaction.isWordCharacter(character) ||
      character === "." ||
      character === "%" ||
      character === "+" ||
      character === "-"
    );
  }

  private static isDomainCharacter(character: string): boolean {
    return (
      MonitorEvidenceRedaction.isDigit(character) ||
      (character >= "a" && character <= "z") ||
      (character >= "A" && character <= "Z") ||
      character === "." ||
      character === "-"
    );
  }

  private static isSchemeCharacter(character: string): boolean {
    return (
      MonitorEvidenceRedaction.isDigit(character) ||
      (character >= "a" && character <= "z") ||
      (character >= "A" && character <= "Z") ||
      character === "+" ||
      character === "." ||
      character === "-"
    );
  }

  private static endsUrl(character: string): boolean {
    return (
      character === " " ||
      character === "\t" ||
      character === "\n" ||
      character === "\r" ||
      character === '"' ||
      character === "'" ||
      character === "<" ||
      character === ">" ||
      character === "`" ||
      character === ")" ||
      character === "]" ||
      character === "}"
    );
  }
}
