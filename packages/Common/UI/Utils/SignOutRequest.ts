import URL from "../../Types/API/URL";
import {
  IDENTITY_PROVIDER_SIGN_OUT_URL_FIELD,
  isUsableEndSessionEndpoint,
} from "../../Types/SSO/IdentityProviderSignOut";

/*
 * THE REQUEST THAT ENDS A SESSION ON THE SERVER, SENT SO THAT NO PAGE CHANGE
 * CANCELS IT (issue #9508).
 *
 * Signing out ends with a page change - the sign-in page, loaded in full -
 * and the session's cookies are HttpOnly: only the server's answer to the
 * sign-out clears them. The dashboards used to start the sign-out and change
 * the page at once. A browser cancels a request that is still on its way
 * when the page changes - Firefox as soon as the new address is set - so the
 * server never heard of the sign-out (nginx logged 499, "client closed the
 * request", or nothing at all), the cookies stayed, and the next person to
 * open OneUptime on that browser was signed in as the one who had left.
 *
 * So the sign-out is sent here, and:
 *  - the page waits for the server's answer before it changes. The browser
 *    has applied the cookies that answer clears by the time it is read, so
 *    the next page never sees the old session;
 *  - for no longer than SIGN_OUT_ANSWER_WAIT_IN_MS, so a slow server never
 *    leaves anybody on a spinner;
 *  - with keepalive: the one request the Fetch standard lets outlive its
 *    page. When the wait runs out, when something else changes the page
 *    first, or when the tab is closed, it still reaches the server, which
 *    ends the session. A sign-out that is itself a page change - a form
 *    posted to the server, which answers with a redirect - is lost to the
 *    last two before the server has read it, and keeps the person waiting
 *    for as long as the server is slow. Keepalive is also why this is fetch
 *    and not the API client: axios sends with XMLHttpRequest, which has no
 *    keepalive.
 *
 * Only the cookies go with it: the server reads which session to end from
 * them (POST /identity/logout, POST /status-page-identity-api/logout/:id).
 */

// What came of a sign-out, as far as the page waited to see.
export enum SignOutAnswer {
  /*
   * The server answered that it signed the browser out. Its answer cleared
   * the session's cookies, and the browser has applied it.
   */
  SignedOut = "SignedOut",
  // The server answered with an error.
  Refused = "Refused",
  // Nothing answered: the network, or the server, could not be reached.
  Unreachable = "Unreachable",
  /*
   * The wait ran out first. The request is still on its way, and nothing
   * the page does next cancels it (keepalive).
   */
  StillOnItsWay = "StillOnItsWay",
  // The browser has no fetch, so nothing was sent.
  NotSent = "NotSent",
}

/*
 * What came of a sign-out, and where the server said the browser goes next:
 * the identity provider's own sign-out, to end its session too (#9535,
 * Types/SSO/IdentityProviderSignOut), or null - the sign-in page, as always.
 * Only a sign-out the server answered can name one.
 */
export interface SignOutResult {
  answer: SignOutAnswer;
  identityProviderSignOutUrl: string | null;
}

/*
 * How long a page waits for the server to answer its sign-out before it
 * moves on anyway. A sign-out is answered in well under a second; this is
 * for a server that is slow, whose answer still arrives after the page has
 * changed.
 */
export const SIGN_OUT_ANSWER_WAIT_IN_MS: number = 5000;

/*
 * The sign-outs on their way, by address: every caller in this page while
 * one is on its way - a burst of requests the server refused, each signing
 * out - shares it, instead of sending one each.
 */
const signOutsOnTheirWay: Map<string, Promise<SignOutResult>> = new Map();

export default class SignOutRequest {
  /**
   * Sends the sign-out to `url`, and resolves once the server has answered
   * or once `waitInMs` (SIGN_OUT_ANSWER_WAIT_IN_MS) has passed, whichever
   * comes first. Never rejects: what follows a sign-out - the sign-in page
   * - follows it whatever came of it.
   */
  public static async send(
    url: URL,
    options?: { waitInMs?: number | undefined },
  ): Promise<SignOutAnswer> {
    return (await SignOutRequest.sendAndRead(url, options)).answer;
  }

  /**
   * Sends the sign-out as send does, and resolves with what came of it and
   * where the server said the browser goes next (SignOutResult). Never
   * rejects.
   */
  public static async sendAndRead(
    url: URL,
    options?: { waitInMs?: number | undefined },
  ): Promise<SignOutResult> {
    const signOut: Promise<SignOutResult> | null = SignOutRequest.start(
      url.toString(),
    );

    if (!signOut) {
      return {
        answer: SignOutAnswer.NotSent,
        identityProviderSignOutUrl: null,
      };
    }

    return await SignOutRequest.waitFor(
      signOut,
      options?.waitInMs ?? SIGN_OUT_ANSWER_WAIT_IN_MS,
    );
  }

  /*
   * Where the server's answer says the browser goes next, or null: an
   * http(s) address it names in IDENTITY_PROVIDER_SIGN_OUT_URL_FIELD, and
   * nothing else - no other scheme, whatever the answer holds. An answer
   * with no body, or one that is not JSON, names none.
   */
  public static async readIdentityProviderSignOutUrl(
    response: Response,
  ): Promise<string | null> {
    try {
      const body: unknown = await response.json();

      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return null;
      }

      const address: unknown = (body as Record<string, unknown>)[
        IDENTITY_PROVIDER_SIGN_OUT_URL_FIELD
      ];

      return isUsableEndSessionEndpoint(address) ? address : null;
    } catch {
      return null;
    }
  }

  // Forgets the sign-outs on their way. For tests.
  public static forgetSignOutsOnTheirWayForTests(): void {
    signOutsOnTheirWay.clear();
  }

  // The sign-out to `address` on its way, sent now if none is; null when nothing can send it.
  private static start(address: string): Promise<SignOutResult> | null {
    const onItsWay: Promise<SignOutResult> | undefined =
      signOutsOnTheirWay.get(address);

    if (onItsWay) {
      return onItsWay;
    }

    /*
     * The page's own fetch, as window's: what the browser offers. A page
     * without one (an embedded browser of years ago, a test's) sends nothing.
     */
    if (typeof window === "undefined" || typeof window.fetch !== "function") {
      return null;
    }

    let answered: Promise<SignOutResult>;

    try {
      answered = window
        .fetch(address, {
          method: "POST",
          keepalive: true,
          // The page's own cookies, which name the session, as the API client sends them.
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        })
        .then(
          async (response: Response): Promise<SignOutResult> => {
            if (!response.ok) {
              return {
                answer: SignOutAnswer.Refused,
                identityProviderSignOutUrl: null,
              };
            }

            return {
              answer: SignOutAnswer.SignedOut,
              identityProviderSignOutUrl:
                await SignOutRequest.readIdentityProviderSignOutUrl(response),
            };
          },
          (): SignOutResult => {
            return {
              answer: SignOutAnswer.Unreachable,
              identityProviderSignOutUrl: null,
            };
          },
        );
    } catch {
      // A fetch that throws before it sends anything (an address it refuses).
      return Promise.resolve({
        answer: SignOutAnswer.Unreachable,
        identityProviderSignOutUrl: null,
      });
    }

    const signOut: Promise<SignOutResult> = answered.finally((): void => {
      if (signOutsOnTheirWay.get(address) === signOut) {
        signOutsOnTheirWay.delete(address);
      }
    });

    signOutsOnTheirWay.set(address, signOut);

    return signOut;
  }

  /*
   * The sign-out's answer, or StillOnItsWay once `waitInMs` has passed. The
   * request is never cancelled: it carries on after the wait, keepalive.
   */
  private static async waitFor(
    signOut: Promise<SignOutResult>,
    waitInMs: number,
  ): Promise<SignOutResult> {
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const waitIsOver: Promise<SignOutResult> = new Promise<SignOutResult>(
      (resolve: (result: SignOutResult) => void): void => {
        timer = setTimeout(
          (): void => {
            resolve({
              answer: SignOutAnswer.StillOnItsWay,
              identityProviderSignOutUrl: null,
            });
          },
          Math.max(0, waitInMs),
        );
      },
    );

    try {
      return await Promise.race([signOut, waitIsOver]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}
