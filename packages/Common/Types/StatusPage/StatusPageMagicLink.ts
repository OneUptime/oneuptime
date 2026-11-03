import {
  getStatusPageAccess,
  StatusPageAccess,
  StatusPageAccessState,
} from "./StatusPageAccess";

/*
 * A private status page's sign-in links (magic links, #5600).
 *
 * On the page's sign-in page a private user can ask for a sign-in link
 * instead of typing a password: the page emails one to their address
 * (Identity's POST /status-page/send-magic-link), and opening it signs them
 * in (POST /status-page/login-with-magic-link/:statusPageId). A link is a
 * bearer credential for the account, so it is held the way a password
 * reset link is:
 *
 *   - its token is a random UUID from the CSPRNG, stored only as its hash
 *     (StatusPagePrivateUser.magicLinkToken), and mailed only to the
 *     address of the private user it signs in;
 *   - it signs in once: the sign-in clears it in the same write that checks
 *     it, so two tabs, or a link opened twice, cannot both sign in;
 *   - it works for STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES, and each new link
 *     replaces the last, so only the latest email's link works;
 *   - a new email address for the user, set by the page's team or by SCIM,
 *     ends it (StatusPagePrivateUserService.onBeforeUpdate);
 *   - the page that opens it is a token route (Common/UI/Utils/
 *     SensitiveUrlToken): the token leaves the address bar before anything
 *     else on the page can read it, and none of the page's custom code runs
 *     there.
 *
 * Opening the link does not sign in by itself: the page asks for one click
 * first. Mail filters that open every link in an email to scan it (Microsoft
 * Defender's Safe Links, Mimecast, Proofpoint) would otherwise spend the
 * link before its owner ever saw it.
 *
 * A page offers them where its private users sign in with an email address
 * (getStatusPageMagicLinkRefusal): every such page by default, until its
 * team turns them off (StatusPage.enableMagicLinkLogin).
 */

// How long a sign-in link works once it is sent.
export const STATUS_PAGE_MAGIC_LINK_EXPIRY_MINUTES: number = 15;

/*
 * The status page route a sign-in link opens, its last segment the link's
 * token: <status page>/magic-link-login/<token>.
 */
export const STATUS_PAGE_MAGIC_LINK_LOGIN_ROUTE: string = "magic-link-login";

// The page's route a private user asks for a sign-in link on.
export const STATUS_PAGE_MAGIC_LINK_ROUTE: string = "magic-link";

/*
 * What the person is told when a link cannot sign them in: it was never
 * one, it has been used, it expired, or a newer link replaced it. The same
 * words for each, so the answer says nothing about which.
 */
export const STATUS_PAGE_MAGIC_LINK_INVALID_MESSAGE: string =
  "This sign-in link has expired or has already been used. Please ask for a new one.";

export const STATUS_PAGE_MAGIC_LINK_SSO_REQUIRED_MESSAGE: string =
  "Status Page supports authentication by SSO. You cannot use a sign-in link for authentication.";

export const STATUS_PAGE_MAGIC_LINK_TURNED_OFF_MESSAGE: string =
  "Sign-in links are turned off for this status page. Please log in with your email and password.";

export const STATUS_PAGE_MAGIC_LINK_NOT_AVAILABLE_MESSAGE: string =
  "Sign-in links are not available for this status page.";

// What decides whether a status page takes sign-in links.
export interface StatusPageMagicLinkState extends StatusPageAccessState {
  requireSsoForLogin?: boolean | null | undefined;
  enableMagicLinkLogin?: boolean | null | undefined;
}

/*
 * Why a status page does not take sign-in links now, or null when it does.
 * Asked by both routes: when a link is asked for, and again when one is
 * used - a link sent before the team changed one of these stops working.
 *
 *   - Only a page whose visitors sign in (StatusPageAccess.SignIn): a
 *     public page has nobody to sign in, and on a page behind the master
 *     password private users do not sign in at all.
 *   - Not on a page that requires SSO: only people its SSO or OIDC
 *     provider lets in can see it, as with passwords.
 *   - Not once the page's team has turned them off. Only a page that says
 *     they are on takes them - a page read without the switch does not.
 */
export const getStatusPageMagicLinkRefusal: (
  state: StatusPageMagicLinkState,
) => string | null = (state: StatusPageMagicLinkState): string | null => {
  if (getStatusPageAccess(state) !== StatusPageAccess.SignIn) {
    return STATUS_PAGE_MAGIC_LINK_NOT_AVAILABLE_MESSAGE;
  }

  if (state.requireSsoForLogin) {
    return STATUS_PAGE_MAGIC_LINK_SSO_REQUIRED_MESSAGE;
  }

  if (state.enableMagicLinkLogin !== true) {
    return STATUS_PAGE_MAGIC_LINK_TURNED_OFF_MESSAGE;
  }

  return null;
};

// Whether a status page offers sign-in links now.
export const isStatusPageMagicLinkAvailable: (
  state: StatusPageMagicLinkState,
) => boolean = (state: StatusPageMagicLinkState): boolean => {
  return getStatusPageMagicLinkRefusal(state) === null;
};
