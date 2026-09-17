/**
 * Pull the shared secret out of an `otpauth://` enrolment URL.
 *
 * The web sign-in never needs this: it draws the URL as a QR code and the
 * camera does the rest. A handset cannot scan its own screen, so the mobile
 * enrolment offers the URL as a tappable link AND prints the secret for a user
 * whose authenticator lives on another device -- and printing it means
 * extracting it.
 *
 * WHY NOT A URL PARSER. React Native's `URL` is a partial polyfill whose
 * `searchParams` support has differed between releases and platforms, and this
 * runs on the one screen where being wrong means the user cannot finish
 * enrolling and cannot sign in. A bounded regex over a value the server
 * generated is smaller than the thing it would replace.
 *
 * Returns "" for anything it cannot read, which the screen renders as "no
 * setup key" rather than as an empty box the user is invited to copy. The
 * tappable link still works in that case; this is the fallback, not the path.
 */
/*
 * Declared once, at module scope, rather than inline at the test site: the
 * lint rules here want a regexp literal in a condition parenthesised, and a
 * named constant says what it is looking for better than either form.
 */
const SEPARATOR_OR_SPACE: RegExp = /[&#\s]/;

export function secretFromOtpUrl(otpUrl: string): string {
  if (!otpUrl) {
    return "";
  }

  /*
   * Anchored on `secret=` preceded by a delimiter so a parameter that merely
   * ENDS in "secret" -- `client_secret=`, say -- cannot match and hand the
   * user a string that is not their key. Terminated on & or # because the
   * server appends `issuer` and `algorithm` after it.
   */
  const match: RegExpMatchArray | null = otpUrl.match(/[?&]secret=([^&#\s]+)/i);

  if (!match || !match[1]) {
    return "";
  }

  const raw: string = match[1];

  let decoded: string = raw;

  try {
    /*
     * Base32 has no characters that need escaping, so this is almost always a
     * no-op -- but a `%` that survived into the value would otherwise be shown
     * to the user as part of their key, and decoding it is cheaper than
     * explaining it. A malformed escape throws rather than returning garbage,
     * which is why it is caught.
     */
    decoded = decodeURIComponent(raw);
  } catch {
    return raw;
  }

  /*
   * Decoding can put back the very characters the match excluded: `%26`
   * becomes `&`, `%20` becomes a space. A real secret is base32 and contains
   * neither, so a decoded value carrying one is not a secret -- it is a
   * malformed URL, and printing it would have the user typing a separator into
   * their authenticator app and blaming the app when the codes do not match.
   * The undecoded value is the more honest answer in that case.
   */
  const decodedHasSeparator: boolean = SEPARATOR_OR_SPACE.test(decoded);

  if (decodedHasSeparator) {
    return raw;
  }

  return decoded;
}
