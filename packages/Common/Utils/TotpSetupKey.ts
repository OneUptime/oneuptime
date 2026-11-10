/*
 * The setup key of an authenticator app's enrolment: the secret its
 * otpauth:// URL carries, for someone who cannot scan the URL's QR code - a
 * camera that will not focus, an authenticator on the phone the page is open
 * on, or a code that could not be drawn at all (issue #6638) - to type or
 * paste into the app instead. The QR code holds the same secret, so showing
 * it to whoever is looking at the code gives them nothing more.
 *
 * The server writes the URL (Common/Server/Utils/TotpAuth.generateUri):
 *
 *   otpauth://totp/OneUptime:ada%40example.com?issuer=OneUptime
 *     &secret=MTEA5EMEV46EOK5MXD7E3ES7YSRRR6LQ&algorithm=SHA1&digits=6&period=30
 *
 * The mobile app reads the same parameter for its enrolment screen
 * (packages/MobileApp/src/auth/otpUrl.ts).
 */

// A secret as base32 writes it (RFC 4648): A-Z and 2-7, padded with "=".
const BASE32_SECRET: RegExp = /^[A-Z2-7]+=*$/;

const PADDING: RegExp = /[=]+$/;

// How many characters a group of the key holds, as it is shown.
export const TOTP_SETUP_KEY_GROUP_LENGTH: number = 4;

/*
 * The setup key in an otpauth:// URL: its `secret`, in capitals and without
 * the padding authenticator apps do not want - or "" when the URL has none
 * that is base32, so a page shows no key rather than one that cannot work.
 */
export function getTotpSetupKey(otpUrl: string | undefined | null): string {
  if (typeof otpUrl !== "string") {
    return "";
  }

  const url: string = otpUrl.trim();

  if (!url.toLowerCase().startsWith("otpauth://")) {
    return "";
  }

  const queryStart: number = url.indexOf("?");

  if (queryStart < 0) {
    return "";
  }

  const fragmentStart: number = url.indexOf("#", queryStart);
  const query: string = url.slice(
    queryStart + 1,
    fragmentStart < 0 ? url.length : fragmentStart,
  );

  /*
   * The parameter named exactly `secret`: never one that only ends in it,
   * such as a `client_secret`. Its escapes are decoded; a base32 secret has
   * none, so anything they would put in it is caught below.
   */
  const secret: string | null = new URLSearchParams(query).get("secret");

  if (!secret) {
    return "";
  }

  const key: string = secret.toUpperCase();

  if (!BASE32_SECRET.test(key)) {
    return "";
  }

  return key.replace(PADDING, "");
}

/*
 * The key in groups of four, as it is shown: MTEA 5EME V46E OK5M ... Easier to
 * read off a screen and type in than thirty-two letters at once. It is copied
 * whole, without the gaps.
 */
export function getTotpSetupKeyGroups(key: string): Array<string> {
  const groups: Array<string> = [];

  for (
    let start: number = 0;
    start < key.length;
    start += TOTP_SETUP_KEY_GROUP_LENGTH
  ) {
    groups.push(key.slice(start, start + TOTP_SETUP_KEY_GROUP_LENGTH));
  }

  return groups;
}
