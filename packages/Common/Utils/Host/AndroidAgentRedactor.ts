/*
 * The OneUptime Android agent's redaction, for text OneUptime itself sends
 * to a device (agents/AndroidAgent logs/Redactor.kt, which the agent runs
 * over every app's log lines, crashes and kernel lines before they leave
 * the device). The same patterns, written for JavaScript's regular
 * expressions, replace the same things with the same markers:
 *
 *   a payment card number (13 to 19 digits of any script, spaces or
 *     dashes allowed, a card network's first digit, and the Luhn
 *     check passed)                                             [card number]
 *   an email address, in any script                             [email]
 *   a bearer or basic credential                                Bearer [credential]
 *   a JSON Web Token                                            [token]
 *   the value of a secret-sounding name:
 *     password=..., "token": "...", api_key: ...                password=[redacted]
 *
 * A device shows what OneUptime sends it to whoever is in front of it - a
 * kiosk's customer, a store's staff - so a log session's note (#9966) goes
 * through it before it is kept and sent. Kept narrow, as the agent's: a
 * device's serial number or an IP address is no secret in a fleet tool.
 *
 * A secret inside a longer word is left, and a word is made of ASCII
 * letters, digits and "_": a letter of another script beside a secret (as
 * in 卡号4111111111111111) makes it no part of one. Each pattern writes those
 * characters out as the agent's does, rather than say \w, \b or \d, which
 * Android's regular expressions read with every script's letters (#10835),
 * and a space as the characters Android's \s takes, where JavaScript's
 * takes U+FEFF and not U+0085 (#10876). What reaches beyond ASCII on purpose
 * says so with Unicode's own classes, under the u flag: a card's digits are
 * any script's (#10877), an address's letters too (#10878). A text reads the
 * same on the device whichever of the two redacted it.
 *
 * Bounded: each pattern is linear, and the text is cut to MAX_LENGTH first.
 */

export const REDACTOR_MAX_LENGTH: number = 256 * 1024;

export const REDACTED_CARD: string = "[card number]";
export const REDACTED_EMAIL: string = "[email]";
export const REDACTED_CREDENTIAL: string = "[credential]";
export const REDACTED_TOKEN: string = "[token]";
export const REDACTED: string = "[redacted]";

const MIN_CARD_DIGITS: number = 13;
const MAX_CARD_DIGITS: number = 19;

/*
 * Each place a card number may start, with the run of a card's digits from
 * there captured in a look-ahead: 13 to 19 decimal digits of any script,
 * each group separated by at most one space or dash, not right after an
 * ASCII letter, "_" or "." (nor after an ASCII digit, unless the card is in
 * another script's digits). The match is empty, so each group of a longer
 * run of numbers is a place of its own, and redactCards checks the run and
 * each shorter one from the same place that ends before one of its spaces
 * or dashes: a card beside another number ("4111 1111 1111 1111 12/25",
 * "1 4111 1111 1111 1111") is taken out. cardLength reads each digit by its
 * value, and only the Basic Multilingual Plane's (DIGIT_ZEROS).
 */
const CARD_START: RegExp =
  /(?:(?<![A-Za-z0-9_.])|(?<=[0-9])(?![0-9]))(?=(\p{Nd}(?:[ -]?\p{Nd}){12,18}))/gu;

/*
 * The first of each script's ten decimal digits in Unicode's Basic
 * Multilingual Plane (its zero), in order: ASCII, Arabic-Indic, Persian
 * (Extended Arabic-Indic), NKo, Devanagari, Bengali, Gurmukhi, Gujarati,
 * Oriya, Tamil, Telugu, Kannada, Malayalam, Sinhala, Thai, Lao, Tibetan,
 * Myanmar and Myanmar Shan, Khmer, Mongolian, Limbu, New Tai Lue, Tai Tham
 * (two), Balinese, Sundanese, Lepcha, Ol Chiki, Vai, Saurashtra, Kayah Li,
 * Javanese, Myanmar Tai Laing, Cham, Meetei Mayek and fullwidth. A digit's
 * value is how far it is from its zero, as Kotlin's Character.digit reads
 * it on the device. None has changed since Unicode 7 (Redactor.kt says why
 * these alone).
 */
const DIGIT_ZEROS: ReadonlyArray<number> = [
  0x0030, 0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66,
  0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040,
  0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0,
  0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0,
  0xff10,
];

/*
 * An email address written in ASCII, as the agent has read one since
 * #10835. Kept as it was, beside EMAIL_ADDRESS, so that no address it took
 * out is kept (redactAddresses says how).
 */
const ASCII_EMAIL_ADDRESS: RegExp =
  /(?<![A-Za-z0-9_.%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}(?![A-Za-z0-9_-])/g;

/*
 * An email address in any script (josé@example.com, 张伟@example.com,
 * user@例え.jp, почта@пример.рф). Its name is Latin, in ASCII or not, or in
 * the letters of other scripts, not both, so that a letter of another
 * script beside an ASCII address is still no part of it
 * ("邮箱jane@example.com" is "邮箱[email]"); its domain's labels hold any
 * script's letters, or punycode; its top-level domain is ASCII letters,
 * punycode or another script's letters. Redactor.kt says why each piece is
 * as it is.
 */
const EMAIL_ADDRESS: RegExp =
  /(?!(?<=\p{Nd} )\p{Nd})(?:(?<![\p{sc=Latin}\p{M}\p{Nd}._%+-])[\p{sc=Latin}\p{M}\p{Nd}._%+-]{1,64}|(?<![\p{M}\p{Nd}._%+-]|[^\P{L}\p{sc=Latin}])(?=[\p{M}\p{Nd}._%+-]{0,63}[^\P{L}\p{sc=Latin}])(?:[^\P{L}\p{sc=Latin}]|[\p{M}\p{Nd}._%+-]){1,64})@[\p{L}\p{M}\p{Nd}-]{1,63}(?:\.[\p{L}\p{M}\p{Nd}-]{1,63})*\.(?:[A-Za-z]{2,24}|[Xx][Nn]--(?=[A-Za-z0-9-]{0,58}[A-Za-z])[A-Za-z0-9-]{1,59}|[\p{L}\p{M}]{2,24})(?![A-Za-z0-9_-])/gu;

/*
 * A space is one of the characters Android's \s takes, written out:
 * JavaScript's \s takes U+FEFF and not U+0085. The vertical tab is \x0B, as
 * the agent's Kotlin writes it (a test holds the two to the same text).
 */
/* eslint-disable no-control-regex */
const AUTHORIZATION: RegExp =
  /(?<![A-Za-z0-9_])(bearer|basic)[\t\n\x0B\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+[A-Za-z0-9._~+/=-]{8,}/gi;
/* eslint-enable no-control-regex */

const SCHEMES: ReadonlySet<string> = new Set<string>(["bearer", "basic"]);

/*
 * A JSON Web Token, the agent's looked for once per run of the characters a
 * token is made of (as Server/Utils/LogRedaction does): the match begins
 * only where such a run begins, the look-ahead settles on the first place in
 * the run a token may begin (the run's start, or just after a "-" in it -
 * where "eyJ" is inside no longer word), and the run's text before that
 * place comes back as the first group, which the replacement puts back. A
 * later place in the same run has a shorter first segment and ends no
 * better, so the same tokens are taken out as by a search from every place
 * not inside a word, while a long run is read a bounded number of times
 * rather than once more from each "eyJ" in it.
 */
const JWT: RegExp =
  /(?<![A-Za-z0-9_-])(?=((?:[A-Za-z0-9_-]*?-)??)eyJ)\1eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;

/*
 * A secret-sounding name, then = or :, then its value: a quoted string, or
 * everything up to a space, a comma, a semicolon, an ampersand or a closing
 * bracket. The name may be quoted, as in JSON, and may end in one of the
 * words ("db_password", "x-api-key", "accessToken"). What comes before the
 * word is at most 40 characters, so a long word costs at most 40 steps at
 * each position (Redactor.kt says why). A space is one of Android's, as in
 * AUTHORIZATION.
 */
/* eslint-disable no-control-regex */
const SECRET_ASSIGNMENT: RegExp =
  /(?<![A-Za-z0-9_-])(["']?[A-Za-z0-9_-]{0,40}?(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|session[_-]?id|cookie|authorization|credential|pin)["']?[\t\n\x0B\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]{0,8}[:=][\t\n\x0B\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]{0,8})(\[(?:token|card number|email|credential|redacted)\]|"[^"]*"|'[^']*'|[^\t\n\x0B\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000,;&)\]}]+)/gi;
/* eslint-enable no-control-regex */

export default class AndroidAgentRedactor {
  public static redact(text: string | null | undefined): string {
    if (!text) {
      return "";
    }

    let result: string =
      text.length > REDACTOR_MAX_LENGTH
        ? text.substring(0, REDACTOR_MAX_LENGTH)
        : text;

    result = result.replace(JWT, `$1${REDACTED_TOKEN}`);

    result = result.replace(
      AUTHORIZATION,
      (_match: string, scheme: string): string => {
        return `${scheme} ${REDACTED_CREDENTIAL}`;
      },
    );

    result = result.replace(
      SECRET_ASSIGNMENT,
      (match: string, name: string, value: string): string => {
        // A value already taken out, or a scheme whose credential was just taken out, is left.
        const isMarker: boolean = value.startsWith("[") && value.endsWith("]");

        if (
          !value ||
          isMarker ||
          value === `"${REDACTED}"` ||
          SCHEMES.has(value.toLowerCase())
        ) {
          return match;
        }

        const quote: string =
          value.length >= 2 && (value[0] === '"' || value[0] === "'")
            ? value[0]
            : "";

        return `${name}${quote}${REDACTED}${quote}`;
      },
    );

    result = AndroidAgentRedactor.redactAddresses(result);

    result = AndroidAgentRedactor.redactCards(result);

    return result;
  }

  /*
   * 13 to 19 digits that start as a card network's numbers do (2 to 6) and
   * pass the Luhn check, each read by its value, of whatever script: the
   * millisecond timestamps text is full of start with 1.
   */
  public static looksLikeCardNumber(digits: string): boolean {
    const values: Array<number> | null = AndroidAgentRedactor.valuesOf(digits);

    return (
      values !== null &&
      AndroidAgentRedactor.isCardNumber(values, values.length)
    );
  }

  /*
   * The Luhn check every payment card number passes, and most other long
   * numbers do not. Each digit is read by its value, whatever its script
   * ("٤" is 4); anything else is no digit, and a digit beyond the Basic
   * Multilingual Plane is none either.
   */
  public static passesLuhn(digits: string): boolean {
    const values: Array<number> | null = AndroidAgentRedactor.valuesOf(digits);

    return (
      values !== null &&
      AndroidAgentRedactor.passesLuhnOf(values, values.length)
    );
  }

  /*
   * Every email address replaced: each character ASCII_EMAIL_ADDRESS or
   * EMAIL_ADDRESS takes out, where the two overlap as one address. Read as
   * one pattern, an address in another script found sooner could take the
   * first part of an ASCII address right after it and leave the rest; read
   * apart, the ASCII address is taken out whole, as before.
   */
  private static redactAddresses(text: string): string {
    if (!text.includes("@")) {
      return text;
    }

    const spans: Array<[number, number]> = [
      ...AndroidAgentRedactor.spansOf(ASCII_EMAIL_ADDRESS, text),
      ...AndroidAgentRedactor.spansOf(EMAIL_ADDRESS, text),
    ].sort((a: [number, number], b: [number, number]): number => {
      return a[0] - b[0];
    });

    if (spans.length === 0) {
      return text;
    }

    let result: string = "";
    let last: number = 0;
    let [start, end] = spans[0]!;

    for (const [spanStart, spanEnd] of spans) {
      if (spanStart < end) {
        end = Math.max(end, spanEnd);
        continue;
      }

      result += text.slice(last, start) + REDACTED_EMAIL;
      last = end;
      start = spanStart;
      end = spanEnd;
    }

    return result + text.slice(last, start) + REDACTED_EMAIL + text.slice(end);
  }

  // Where each match of a pattern is.
  private static spansOf(
    pattern: RegExp,
    text: string,
  ): Array<[number, number]> {
    return Array.from(
      text.matchAll(pattern),
      (match: RegExpExecArray): [number, number] => {
        return [match.index, match.index + match[0].length];
      },
    );
  }

  /*
   * Every card number replaced: first in one script's digits, as #10835
   * read an ASCII card (a digit of another script beside it is no part of
   * it), then, among the digits left, a number that mixes scripts, read
   * whole. Looked for second, such a number cannot take the place of a card
   * in one script's digits.
   */
  private static redactCards(text: string): string {
    return AndroidAgentRedactor.redactCardsIn(
      AndroidAgentRedactor.redactCardsIn(text, false),
      true,
    );
  }

  /*
   * At each place a card may start (CARD_START), the longest card from
   * there. A place inside a card already taken out is passed over, and so
   * is one inside a longer number: right after a digit of its own script,
   * or after any digit when scripts may mix.
   */
  private static redactCardsIn(text: string, mixed: boolean): string {
    let result: string = "";
    let last: number = 0;

    for (const match of text.matchAll(CARD_START)) {
      const start: number = match.index;

      if (
        start < last ||
        (start > 0 &&
          AndroidAgentRedactor.isDigitOf(
            text.charCodeAt(start - 1),
            AndroidAgentRedactor.zeroOf(text.charCodeAt(start)),
            mixed,
          ))
      ) {
        continue;
      }

      const length: number = AndroidAgentRedactor.cardLength(
        text,
        start,
        start + (match[1] ?? "").length,
        mixed,
      );

      if (length > 0) {
        result += text.slice(last, start) + REDACTED_CARD;
        last = start + length;
      }
    }

    return last === 0 ? text : result + text.slice(last);
  }

  /*
   * How much of the text from a place is a card number: the run of a
   * card's digits there, up to where CARD_START's capture ends, or the
   * longest part of it that ends before one of its spaces or dashes and
   * passes. Unless scripts may mix, the run is one script's digits, and
   * ends where another script's begin. The whole run counts only when what
   * comes right after it does not carry it on. Zero when none passes.
   */
  private static cardLength(
    text: string,
    start: number,
    end: number,
    mixed: boolean,
  ): number {
    const zero: number = AndroidAgentRedactor.zeroOf(text.charCodeAt(start));

    if (zero < 0) {
      return 0;
    }

    const values: Array<number> = [];
    // Where each part that ends before a space or a dash ends, and how many digits it holds.
    const parts: Array<[number, number]> = [];
    let runEnd: number = start;

    for (let index: number = start; index < end; index++) {
      const code: number = text.charCodeAt(index);

      if (code === 0x20 || code === 0x2d) {
        continue;
      }

      const codeZero: number = AndroidAgentRedactor.zeroOf(code);

      if (codeZero < 0 || (!mixed && codeZero !== zero)) {
        break;
      }

      if (index > runEnd) {
        // A space or a dash came between this digit and the last.
        parts.push([runEnd, values.length]);
      }

      values.push(code - codeZero);
      runEnd = index + 1;
    }

    if (
      !AndroidAgentRedactor.carriesOn(text, runEnd, zero, mixed) &&
      AndroidAgentRedactor.isCardNumber(values, values.length)
    ) {
      return runEnd - start;
    }

    for (let part: number = parts.length - 1; part >= 0; part--) {
      const [partEnd, digits] = parts[part]!;

      if (AndroidAgentRedactor.isCardNumber(values, digits)) {
        return partEnd - start;
      }
    }

    return 0;
  }

  // Whether the character at a place carries on a number of a script's digits: an ASCII letter, "_" or ".", or such a digit.
  private static carriesOn(
    text: string,
    index: number,
    zero: number,
    mixed: boolean,
  ): boolean {
    if (index >= text.length) {
      return false;
    }

    const char: string = text[index]!;

    return (
      (char >= "A" && char <= "Z") ||
      (char >= "a" && char <= "z") ||
      char === "_" ||
      char === "." ||
      AndroidAgentRedactor.isDigitOf(text.charCodeAt(index), zero, mixed)
    );
  }

  // Whether a character is a digit of the number whose digits start at a zero: one of the same script, or any when scripts may mix.
  private static isDigitOf(
    code: number,
    zero: number,
    mixed: boolean,
  ): boolean {
    const codeZero: number = AndroidAgentRedactor.zeroOf(code);

    return codeZero >= 0 && (mixed || codeZero === zero);
  }

  // The zero of the script whose ten decimal digits a UTF-16 unit is one of, or -1 when it is none of DIGIT_ZEROS' digits.
  private static zeroOf(code: number): number {
    let low: number = 0;
    let high: number = DIGIT_ZEROS.length - 1;

    // The last zero at or before the code.
    while (low < high) {
      const middle: number = Math.ceil((low + high) / 2);

      if (DIGIT_ZEROS[middle]! <= code) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }

    const zero: number = DIGIT_ZEROS[low]!;

    return code >= zero && code - zero <= 9 ? zero : -1;
  }

  private static isCardNumber(values: Array<number>, count: number): boolean {
    return (
      count >= MIN_CARD_DIGITS &&
      count <= MAX_CARD_DIGITS &&
      values[0]! >= 2 &&
      values[0]! <= 6 &&
      AndroidAgentRedactor.passesLuhnOf(values, count)
    );
  }

  // The Luhn check over the first digits of a number's values.
  private static passesLuhnOf(values: Array<number>, count: number): boolean {
    let sum: number = 0;
    let double: boolean = false;

    for (let index: number = count - 1; index >= 0; index--) {
      let digit: number = values[index]!;

      if (double) {
        digit *= 2;

        if (digit > 9) {
          digit -= 9;
        }
      }

      sum += digit;
      double = !double;
    }

    return sum % 10 === 0;
  }

  // The value of each digit of a text, or null when it is empty or holds anything else.
  private static valuesOf(digits: string): Array<number> | null {
    if (!digits) {
      return null;
    }

    const values: Array<number> = [];

    for (let index: number = 0; index < digits.length; index++) {
      const code: number = digits.charCodeAt(index);
      const zero: number = AndroidAgentRedactor.zeroOf(code);

      if (zero < 0) {
        return null;
      }

      values.push(code - zero);
    }

    return values;
  }
}
