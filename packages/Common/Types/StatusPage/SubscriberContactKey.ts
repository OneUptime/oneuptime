import URL from "../API/URL";
import Email from "../Email";
import Phone from "../Phone";

/*
 * ONE CONTACT, HOWEVER IT IS WRITTEN.
 *
 * A subscriber's contact is stored as it was typed, and the same phone, the
 * same webhook, can be typed many ways: "+1 415 555 0100", "14155550100"
 * and "0014155550100" ring one phone, and "https://Hooks.Example.com:443/a"
 * and "https://hooks.example.com/%61" call one endpoint. A status page
 * takes each contact once (StatusPageSubscriberService), and the limits on
 * what is sent to a contact count it once (PublicMessageRateLimit), so both
 * ask here what the contact is, rather than how it was written:
 *
 *  - a phone number is its line: its digits, with a leading "00" - how most
 *    of the world dials out of its country - read as the "+" it stands for.
 *    A number written with its country code and one written without are
 *    different digits, and are not matched (Phone.isSameNumber holds the
 *    same rule): which country a bare number is in cannot be known here;
 *  - a webhook - a subscriber's own, or a Slack or Microsoft Teams channel's
 *    - is the address it is sent to: its scheme, host and port as URL
 *    parsing writes them (lower case, no default port), its path and query
 *    with every percent-encoded letter, digit, "-", ".", "_" and "~"
 *    written as itself (RFC 3986 6.2.2.2) and every other octet's hex in
 *    upper case, and without the credentials and fragment, which do not
 *    change where it is sent. Path and query are otherwise kept: they are
 *    what tells one channel, or one user of a shared webhook service, from
 *    another;
 *  - an email address is the address in lower case: Email stores it so.
 *
 * Pure and free of database dependencies, so the server and its tests read
 * the same rules. Every pattern here is linear in its input.
 */

const NOT_A_DIGIT: RegExp = /\D/g;

// "00" before a number written for another country: the "+" it stands for.
const INTERNATIONAL_CALL_PREFIX: string = "00";

const PERCENT_ENCODED_OCTET: RegExp = /%([0-9A-Fa-f]{2})/g;

// The characters RFC 3986 calls unreserved: never different percent-encoded.
const UNRESERVED_CHARACTER: RegExp = /^[A-Za-z0-9\-._~]$/;

export default class SubscriberContactKey {
  // A phone number's line: its digits, a leading "00" read as "+".
  public static forPhone(phone: Phone | string): string {
    const digits: string = phone.toString().replace(NOT_A_DIGIT, "");

    if (digits.startsWith(INTERNATIONAL_CALL_PREFIX)) {
      return digits.slice(INTERNATIONAL_CALL_PREFIX.length);
    }

    return digits;
  }

  // An email address, as Email stores it: trimmed, in lower case.
  public static forEmail(email: Email | string): string {
    return email.toString().trim().toLowerCase();
  }

  /*
   * A webhook as the address it is sent to (see above). Text that is not an
   * absolute URL is kept as written, trimmed and in lower case: nothing is
   * ever sent to it.
   */
  public static forUrl(url: URL | string): string {
    const value: string = url.toString().trim();

    let parsed: globalThis.URL;

    try {
      parsed = new globalThis.URL(value);
    } catch {
      return value.toLowerCase();
    }

    return `${parsed.protocol}//${parsed.host}${SubscriberContactKey.normalizePercentEncoding(
      parsed.pathname,
    )}${SubscriberContactKey.normalizePercentEncoding(parsed.search)}`;
  }

  // Whether two phone numbers are one line (see forPhone).
  public static isSamePhone(
    first: Phone | string | undefined | null,
    second: Phone | string | undefined | null,
  ): boolean {
    if (!first || !second) {
      return false;
    }

    const firstLine: string = SubscriberContactKey.forPhone(first);

    return (
      firstLine.length > 0 &&
      firstLine === SubscriberContactKey.forPhone(second)
    );
  }

  // Whether two webhooks are sent to one address (see forUrl).
  public static isSameUrl(
    first: URL | string | undefined | null,
    second: URL | string | undefined | null,
  ): boolean {
    if (!first || !second) {
      return false;
    }

    const firstAddress: string = SubscriberContactKey.forUrl(first);

    return (
      firstAddress.length > 0 &&
      firstAddress === SubscriberContactKey.forUrl(second)
    );
  }

  /*
   * A path or a query with each percent-encoded unreserved character written
   * as itself, and the hex of every other percent-encoded octet in upper
   * case: the spellings RFC 3986 calls equivalent read alike.
   */
  private static normalizePercentEncoding(text: string): string {
    return text.replace(
      PERCENT_ENCODED_OCTET,
      (_match: string, hex: string): string => {
        const character: string = String.fromCharCode(parseInt(hex, 16));

        if (UNRESERVED_CHARACTER.test(character)) {
          return character;
        }

        return `%${hex.toUpperCase()}`;
      },
    );
  }
}
