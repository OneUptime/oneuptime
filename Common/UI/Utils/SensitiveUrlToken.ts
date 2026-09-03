/*
 * Client half of the sensitive-URL-token handoff.
 *
 * Common/Server/Views/Partials/SensitiveUrlToken.ejs runs in <head>, moves the
 * bearer token out of the path into sessionStorage and rewrites the address bar
 * to the token-free route. By the time React mounts, the token is no longer a
 * route parameter, so pages read it from here instead of from the router.
 *
 * Deliberately not routed through Common/UI/Utils/Navigation: this is read
 * during the reset and verification flows, where the value has to be available
 * whether or not the bootstrap managed to clean the URL, and Navigation only
 * ever sees whatever the router was given.
 *
 * TOKEN_ROUTES is duplicated in the partial. The two lists have to agree about
 * which routes carry a token; Common/Tests/App/SensitiveUrlTokenBootstrap.test.ts
 * asserts that they do.
 */

const STORAGE_KEY: string = "oneuptime-sensitive-url-token";

/*
 * Route segments whose NEXT path segment is a single-use bearer token. Matched
 * against the second-to-last segment, so this covers
 * /accounts/reset-password/<token>, /reset-password/<token> and
 * /status-page/<id>/reset-password/<token> alike.
 */
const TOKEN_ROUTES: Array<string> = ["reset-password", "verify-email"];

interface HandoffWindow extends Window {
  __ONEUPTIME_SENSITIVE_URL_TOKEN__?: string | undefined;
}

export default class SensitiveUrlToken {
  /*
   * The token for the current page, or "" when there is none.
   *
   * Order matters. sessionStorage is where the bootstrap normally puts it and
   * is the only source that survives a reload of the cleaned URL. The in-memory
   * handoff covers blocked storage. The path is the last resort: it only holds
   * a token when the bootstrap could not run, and reading it keeps the flow
   * working on the browsers where that happens.
   */
  public static read(): string {
    try {
      const stored: string | null = window.sessionStorage.getItem(STORAGE_KEY);

      if (stored) {
        return stored;
      }
    } catch {
      /* Private mode or storage disabled; fall through. */
    }

    const handedOff: string | undefined = (window as HandoffWindow)
      .__ONEUPTIME_SENSITIVE_URL_TOKEN__;

    if (handedOff) {
      return handedOff;
    }

    return SensitiveUrlToken.readFromPath(window.location.pathname);
  }

  /*
   * Pull the token out of a path, if that path is a token-bearing route.
   * Returns "" for the cleaned form of the same route, which is what the
   * address bar holds once the bootstrap has run.
   */
  public static readFromPath(pathname: string): string {
    const segments: Array<string> = SensitiveUrlToken.segmentsOf(pathname);

    if (segments.length < 2) {
      return "";
    }

    if (!TOKEN_ROUTES.includes(segments[segments.length - 2]!)) {
      return "";
    }

    const token: string = segments[segments.length - 1]!;

    try {
      return decodeURIComponent(token);
    } catch {
      // A malformed escape sequence is handed on verbatim.
      return token;
    }
  }

  /*
   * Drop the stashed token once the flow that needed it has completed.
   *
   * Only call this on success. A failed reset (an expired token, a password the
   * server rejected) has to leave the stash intact, or the retry — and any
   * reload of the now token-free URL — has nothing to submit.
   */
  public static clear(): void {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Nothing was stored, so nothing to remove. */
    }

    delete (window as HandoffWindow).__ONEUPTIME_SENSITIVE_URL_TOKEN__;
  }

  private static segmentsOf(pathname: string): Array<string> {
    return (pathname || "").split("/").filter((segment: string): boolean => {
      return segment !== "";
    });
  }
}
