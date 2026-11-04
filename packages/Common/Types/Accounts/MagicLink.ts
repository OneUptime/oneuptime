import ObjectID from "../ObjectID";

/*
 * SIGN-IN LINKS (magic links) FOR ONEUPTIME ACCOUNTS.
 *
 * On the sign-in page anybody can ask for a sign-in link instead of typing
 * their password: OneUptime emails one to the address
 * (Identity's POST /identity/send-magic-link), and opening it signs them in
 * (POST /identity/login-with-magic-link). The link stands in for the
 * PASSWORD, and for nothing else:
 *
 *   - an account with two factor authentication still has to give its
 *     second factor - an authenticator code, a security key or a backup
 *     code - or enrol one when an admin requires it. The second step sends
 *     the link's token again where a password sign-in sends the password
 *     (Authentication.ts login()), and the link is spent only once the
 *     whole sign-in has succeeded;
 *   - a blocked account is refused, and while the whole server requires
 *     single sign-on only master admins may use one (SsoRequiredSignIn),
 *     exactly as with a password.
 *
 * Someone who can read the account's email can already reset its password,
 * so a link gives nothing a password reset does not - and it costs that
 * person no new password, and their sessions elsewhere.
 *
 * A link is a bearer credential for the account, so it is held the way a
 * password reset link is (and a private status page's sign-in link is,
 * Types/StatusPage/StatusPageMagicLink):
 *
 *   - its token is a random UUID from the CSPRNG, stored only as its hash
 *     (User.magicLinkToken), and mailed only to the account's own address;
 *   - it signs in once: the sign-in clears it in the same write that checks
 *     it, so two tabs, or a link opened twice, cannot both sign in;
 *   - it works for MAGIC_LINK_EXPIRY_MINUTES, and each new link replaces the
 *     last, so only the latest email's link works;
 *   - a new email address for the account ends it, and so does a password
 *     reset (UserService);
 *   - asking for one says nothing about whether an account exists: the
 *     answer is the same either way, and the request is counted per caller
 *     and per address (PublicMessageRateLimit) before the address is looked
 *     up;
 *   - the page that opens it is a token route (Common/UI/Utils/
 *     SensitiveUrlToken): the token leaves the address bar before anything
 *     else on the page can read it.
 *
 * Opening the link does not sign in by itself: the page asks for one click
 * first. Mail filters that open every link in an email to scan it (Microsoft
 * Defender's Safe Links, Mimecast, Proofpoint) would otherwise spend the
 * link before its owner ever saw it.
 *
 * Following a link proves the mailbox, so it verifies the account's address
 * on the way, as a password reset does.
 *
 * Every server offers them until a master admin turns them off (Admin
 * Dashboard > Settings > Authentication, GlobalConfig.disableMagicLinkLogin).
 */

// How long a sign-in link works once it is sent.
export const MAGIC_LINK_EXPIRY_MINUTES: number = 15;

/*
 * The Accounts route a sign-in link opens, its last segment the link's
 * token: /accounts/magic-link-login/<token>. The same segment as a private
 * status page's sign-in links, so the SensitiveUrlToken bootstrap already
 * takes the token out of the address bar.
 */
export const MAGIC_LINK_LOGIN_ROUTE: string = "magic-link-login";

// The Accounts route where somebody asks for a sign-in link.
export const MAGIC_LINK_ROUTE: string = "magic-link";

/*
 * The field of a sign-in request's `data` that carries the link's token: on
 * POST /identity/login-with-magic-link, and on every second step that
 * finishes a sign-in begun with a link, in place of the password.
 */
export const MAGIC_LINK_TOKEN_FIELD: string = "magicLinkToken";

/*
 * What the person is told when a link cannot sign them in: it was never
 * one, it has been used, it expired, or a newer link replaced it. The same
 * words for each, so the answer says nothing about which.
 */
export const MAGIC_LINK_INVALID_MESSAGE: string =
  "This sign-in link has expired or has already been used. Please ask for a new one.";

// What asking for, or using, a link is told while a master admin has turned them off.
export const MAGIC_LINK_TURNED_OFF_MESSAGE: string =
  "Sign-in links are turned off on this server. Please sign in with your email and password.";

export default class MagicLink {
  /*
   * The token a request carries, or null when it carries none: the field is
   * absent. Anything present that is not a link's token - every token is a
   * UUID - is "" (no link at all), so a request that meant to finish a
   * sign-in begun with a link is answered as a link that does not work,
   * never taken for a password sign-in.
   */
  public static readToken(data: unknown): string | null {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return null;
    }

    if (!Object.prototype.hasOwnProperty.call(data, MAGIC_LINK_TOKEN_FIELD)) {
      return null;
    }

    const value: unknown = (data as Record<string, unknown>)[
      MAGIC_LINK_TOKEN_FIELD
    ];

    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== "string") {
      return "";
    }

    const token: string = value.trim();

    return ObjectID.isValidUUID(token) ? token.toLowerCase() : "";
  }
}
