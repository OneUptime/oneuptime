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
 * Bounded: each pattern is linear, and the text is cut to MAX_LENGTH first.
 */

export const REDACTOR_MAX_LENGTH: number = 256 * 1024;

export const REDACTED_CARD: string = "[card number]";
export const REDACTED_EMAIL: string = "[email]";
export const REDACTED_CREDENTIAL: string = "[credential]";
export const REDACTED_TOKEN: string = "[token]";
export const REDACTED: string = "[redacted]";

// 13 to 19 digits, each group separated by at most one space or dash, not inside a longer number or word.
const CARD_CANDIDATE: RegExp = /(?<![\w.])\d(?:[ -]?\d){12,18}(?![\w.])/g;

const EMAIL_ADDRESS: RegExp =
  /(?<![\w.%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}(?![\w-])/g;

const AUTHORIZATION: RegExp = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

const SCHEMES: ReadonlySet<string> = new Set<string>(["bearer", "basic"]);

// A card number's digits alone, and digits alone: tested whole, never searched.
const CARD_DIGITS: RegExp = /^\d{13,19}$/;
const DIGITS: RegExp = /^\d+$/;

/*
 * A JSON Web Token, the agent's \beyJ... looked for once per run of the
 * characters a token is made of (as Server/Utils/LogRedaction does): the
 * match begins only where such a run begins, the look-ahead settles on the
 * first place in the run a token may begin (the run's start, or just after
 * a "-" in it - where the word boundary allowed one), and the run's text
 * before that place comes back as the first group, which the replacement
 * puts back. A later place in the same run has a shorter first segment and
 * ends no better, so the same tokens are taken out as by a search from
 * every word boundary, while a long run is read a bounded number of times
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
  /((?<![\w-])["']?[\w-]{0,40}?(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|session[_-]?id|cookie|authorization|credential|pin)["']?\s{0,8}[:=]\s{0,8})(\[(?:token|card number|email|credential|redacted)\]|"[^"]*"|'[^']*'|[^\s,;&)\]}]+)/gi;

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

    result = result.replace(CARD_CANDIDATE, (match: string): string => {
      const digits: string = match.replace(/\D/g, "");

      return AndroidAgentRedactor.looksLikeCardNumber(digits)
        ? REDACTED_CARD
        : match;
    });

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
}
