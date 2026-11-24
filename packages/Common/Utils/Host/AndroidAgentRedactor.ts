/*
 * The OneUptime Android agent's redaction, for text OneUptime itself sends
 * to a device (agents/AndroidAgent logs/Redactor.kt, which the agent runs
 * over every app's log lines, crashes and kernel lines before they leave
 * the device). The same patterns, written for JavaScript's regular
 * expressions, replace the same things with the same markers:
 *
 *   a payment card number (13 to 19 digits, spaces or dashes allowed,
 *     a card network's first digit, and the Luhn check passed)  [card number]
 *   an email address                                            [email]
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
 * Android's regular expressions read with every script's letters (#10835):
 * a text reads the same on the device whichever of the two redacted it.
 *
 * Bounded: each pattern is linear, and the text is cut to MAX_LENGTH first.
 */

export const REDACTOR_MAX_LENGTH: number = 256 * 1024;

export const REDACTED_CARD: string = "[card number]";
export const REDACTED_EMAIL: string = "[email]";
export const REDACTED_CREDENTIAL: string = "[credential]";
export const REDACTED_TOKEN: string = "[token]";
export const REDACTED: string = "[redacted]";

/*
 * Each place a card number may start, with the longest run of a card's
 * digits from there that ends where one may end, captured in a look-ahead:
 * 13 to 19 digits, the first a card network's (2 to 6), each group
 * separated by at most one space or dash, neither end beside an ASCII
 * letter, digit, "_" or ".". The match is empty, so each group of a longer
 * run of numbers is a place of its own, and redactCards checks the run and
 * each shorter one from the same place that ends before one of its spaces
 * or dashes: a card beside another number ("4111 1111 1111 1111 12/25",
 * "1 4111 1111 1111 1111") is taken out.
 */
const CARD_START: RegExp =
  /(?<![A-Za-z0-9_.])(?=([2-6](?:[ -]?[0-9]){12,18})(?![A-Za-z0-9_.]))/g;

const EMAIL_ADDRESS: RegExp =
  /(?<![A-Za-z0-9_.%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}(?![A-Za-z0-9_-])/g;

const AUTHORIZATION: RegExp =
  /(?<![A-Za-z0-9_])(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

const SCHEMES: ReadonlySet<string> = new Set<string>(["bearer", "basic"]);

// A card number's digits alone, and digits alone: tested whole, never searched.
const CARD_DIGITS: RegExp = /^[0-9]{13,19}$/;
const DIGITS: RegExp = /^[0-9]+$/;
const NOT_A_DIGIT: RegExp = /[^0-9]/g;

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
 * each position (Redactor.kt says why).
 */
const SECRET_ASSIGNMENT: RegExp =
  /(?<![A-Za-z0-9_-])(["']?[A-Za-z0-9_-]{0,40}?(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|session[_-]?id|cookie|authorization|credential|pin)["']?\s{0,8}[:=]\s{0,8})(\[(?:token|card number|email|credential|redacted)\]|"[^"]*"|'[^']*'|[^\s,;&)\]}]+)/gi;

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

    result = result.replace(EMAIL_ADDRESS, REDACTED_EMAIL);

    result = AndroidAgentRedactor.redactCards(result);

    return result;
  }

  /*
   * 13 to 19 digits that start as a card network's numbers do (2 to 6) and
   * pass the Luhn check: the millisecond timestamps text is full of start
   * with 1.
   */
  public static looksLikeCardNumber(digits: string): boolean {
    return (
      CARD_DIGITS.test(digits) &&
      digits[0]! >= "2" &&
      digits[0]! <= "6" &&
      AndroidAgentRedactor.passesLuhn(digits)
    );
  }

  // The Luhn check every payment card number passes, and most other long numbers do not.
  public static passesLuhn(digits: string): boolean {
    if (!DIGITS.test(digits)) {
      return false;
    }

    let sum: number = 0;
    let double: boolean = false;

    for (let index: number = digits.length - 1; index >= 0; index--) {
      let digit: number = digits.charCodeAt(index) - 48;

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

  /*
   * Every card number in the text replaced: at each place one may start
   * (CARD_START), the longest card from there. A place inside a card
   * already taken out is passed over.
   */
  private static redactCards(text: string): string {
    let result: string = "";
    let last: number = 0;

    for (const match of text.matchAll(CARD_START)) {
      const start: number = match.index;

      if (start < last) {
        continue;
      }

      const length: number = AndroidAgentRedactor.cardLength(match[1] ?? "");

      if (length > 0) {
        result += text.slice(last, start) + REDACTED_CARD;
        last = start + length;
      }
    }

    return last === 0 ? text : result + text.slice(last);
  }

  /*
   * How much of a run (a card's digits, single spaces or dashes between
   * them) from its start is a card number: the whole run, or the longest
   * part of it that ends before one of its spaces or dashes and passes.
   * Zero when none does.
   */
  private static cardLength(run: string): number {
    const digits: string = run.replace(NOT_A_DIGIT, "");
    let end: number = run.length;
    let count: number = digits.length;

    while (count >= 13) {
      if (AndroidAgentRedactor.looksLikeCardNumber(digits.slice(0, count))) {
        return end;
      }

      const separator: number = Math.max(
        run.lastIndexOf(" ", end - 1),
        run.lastIndexOf("-", end - 1),
      );

      if (separator < 0) {
        return 0;
      }

      // Everything between the separator and the end is the last group's digits.
      count -= end - separator - 1;
      end = separator;
    }

    return 0;
  }
}
