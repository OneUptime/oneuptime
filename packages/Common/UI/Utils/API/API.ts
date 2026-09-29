import LocalStorage from "../LocalStorage";
import Navigation from "../Navigation";
import PermissionUtil from "../Permission";
import User from "../User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Headers from "../../../Types/API/Headers";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import APIException from "../../../Types/Exception/ApiException";
import Exception from "../../../Types/Exception/Exception";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import API, { AuthRetryContext } from "../../../Utils/API";
import { IDENTITY_URL } from "../../Config";

/*
 * One in-flight refresh per session, shared by every caller in this tab: the
 * dashboard's BaseAPI, any subclass that inherits its refresh, and callers of
 * refreshSession() that are not going through a request at all (raw fetch,
 * navigations, the realtime socket). Keyed by session name rather than kept on
 * `this`, because a static field read through `this` gives every subclass its
 * own slot, and two slots for one session means two refreshes racing with the
 * same rotating refresh token.
 */
const inFlightSessionRefreshes: Map<string, Promise<boolean>> = new Map();

class BaseAPI extends API {
  /*
   * A refresh another tab finished this recently is one this tab can reuse:
   * tabs share cookies, so its new access token is already ours. Comfortably
   * longer than a refresh round trip, far shorter than the token lifetime.
   */
  public static readonly RECENT_SESSION_REFRESH_WINDOW_IN_MS: number =
    15 * 1000;

  public constructor(protocol: Protocol, hostname: Hostname, route?: Route) {
    super(protocol, hostname, route);
  }

  public static fromURL(url: URL): BaseAPI {
    return new BaseAPI(url.protocol, url.hostname, url.route);
  }

  protected static override async onResponseSuccessHeaders(
    headers: Dictionary<string>,
  ): Promise<Dictionary<string>> {
    if (headers && headers["global-permissions"]) {
      PermissionUtil.setGlobalPermissions(
        JSONFunctions.deserialize(
          JSONFunctions.parseJSONObject(headers["global-permissions"]),
        ) as UserGlobalAccessPermission,
      );
    }

    if (headers && headers["global-permissions-hash"]) {
      LocalStorage.setItem(
        "global-permissions-hash",
        headers["global-permissions-hash"],
      );
    }

    if (headers && headers["project-permissions"]) {
      PermissionUtil.setProjectPermissions(
        JSONFunctions.deserialize(
          JSONFunctions.parseJSONObject(headers["project-permissions"]),
        ) as UserTenantAccessPermission,
      );
    }

    if (headers && headers["project-permissions-hash"]) {
      LocalStorage.setItem(
        "project-permissions-hash",
        headers["project-permissions-hash"],
      );
    }

    return Promise.resolve(headers);
  }

  protected static override getHeaders(): Headers {
    let defaultHeaders: Headers = this.getDefaultHeaders();

    const headers: Headers = {};

    const globalPermissionsHash: string = LocalStorage.getItem(
      "global-permissions-hash",
    ) as string;
    if (globalPermissionsHash) {
      headers["global-permissions-hash"] = globalPermissionsHash;
    }

    const projectPermissionsHash: string = LocalStorage.getItem(
      "project-permissions-hash",
    ) as string;

    if (projectPermissionsHash) {
      headers["project-permissions-hash"] = projectPermissionsHash;
    }

    defaultHeaders = {
      ...defaultHeaders,
      ...headers,
    };

    return defaultHeaders;
  }

  protected static logoutUser(): void {
    return User.logout();
  }

  public static override handleError(
    error: HTTPErrorResponse | APIException,
  ): HTTPErrorResponse | APIException {
    /*
     * 405 Status - Tenant not found. If Project was deleted.
     * 401 Status - User is not logged in.
     * 403 Status - Forbidden. If the IP address is not whitelisted (for example).
     */
    if (
      error instanceof HTTPErrorResponse &&
      (error.statusCode === 401 || error.statusCode === 405)
    ) {
      const loginRoute: Route = this.getLoginRoute();

      this.logoutUser();

      /*
       * Already there: a forced navigation would reload the login page, whose
       * requests would fail the same way and reload it again.
       */
      if (Navigation.getCurrentRoute().toString() === loginRoute.toString()) {
        return error;
      }

      if (Navigation.getQueryStringByName("token")) {
        Navigation.navigate(loginRoute.addRouteParam("sso", "true"), {
          forceNavigate: true,
        });
      } else {
        Navigation.navigate(loginRoute, {
          forceNavigate: true,
        });
      }
    }

    if (
      error instanceof HTTPErrorResponse &&
      error.statusCode === 403 &&
      Navigation.getCurrentRoute().toString() !==
        this.getForbiddenRoute().toString()
    ) {
      Navigation.navigate(this.getForbiddenRoute(), { forceNavigate: true });
    }

    return error;
  }

  /*
   * A refresh that got no answer at all (network down, identity unreachable)
   * rejects here rather than resolving false: the request that asked for it
   * then fails with that transport error, instead of logging the user out
   * over a blip.
   */
  protected static override async tryRefreshAuth(
    _context: AuthRetryContext,
  ): Promise<boolean> {
    return await this.refreshSessionOrThrow();
  }

  /*
   * Where this client's session is refreshed, or null when it has no session
   * that can be (a public dashboard, a status page with no id yet).
   */
  protected static getRefreshSessionUrl(): URL | null {
    return URL.fromString(IDENTITY_URL.toString()).addRoute("/refresh-token");
  }

  // Names the session for the in-tab single flight, the cross-tab lock and the "recently refreshed" marker.
  protected static getSessionName(): string {
    return "dashboard";
  }

  /*
   * Refresh the session now, and say whether it worked.
   *
   * Requests made through this class already do this for themselves when they
   * come back 401. This is for the paths that cannot: a raw fetch() (binary
   * responses), a navigation or new tab pointed at an authenticated route, the
   * realtime socket's handshake. Those call it before (or after) and carry on.
   *
   * Concurrent callers share one refresh, in this tab and across tabs. The
   * server rotates the refresh token on every use, and a token that has
   * already been rotated no longer matches a session: that refresh gets a 401
   * and a response that clears every session cookie, including the ones the
   * winning refresh just set. So two tabs that both notice an expired session
   * and both refresh would log each other out. The refresh therefore runs
   * under a cross-tab lock, and a tab that gets the lock just after another
   * tab refreshed reuses that result instead of spending the stale token.
   */
  public static async refreshSession(): Promise<boolean> {
    try {
      return await this.refreshSessionOrThrow();
    } catch {
      // No answer at all; callers outside a request just carry on.
      return false;
    }
  }

  private static async refreshSessionOrThrow(): Promise<boolean> {
    const refreshUrl: URL | null = this.getRefreshSessionUrl();

    if (!refreshUrl) {
      return false;
    }

    const sessionName: string = this.getSessionName();

    const inFlight: Promise<boolean> | undefined =
      inFlightSessionRefreshes.get(sessionName);

    if (inFlight) {
      return await inFlight;
    }

    const refresh: Promise<boolean> = this.runWithSessionLock(
      sessionName,
      async (): Promise<boolean> => {
        if (this.wasSessionRefreshedRecently(sessionName)) {
          return true;
        }

        const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await super.fetch<JSONObject>({
            method: HTTPMethod.POST,
            url: refreshUrl,
            options: {
              skipAuthRefresh: true,
              hasAttemptedAuthRefresh: true,
              /*
               * A refresh that fails because the identity service is
               * restarting is not a dead session, and treating it as one logs
               * the user out. Retry what a retry can fix; a 401 is final.
               */
              retries: 2,
              exponentialBackoff: true,
              retryOnlyOnRetryableErrors: true,
            },
          });

        const refreshed: boolean =
          result instanceof HTTPResponse && result.isSuccess();

        if (refreshed) {
          this.markSessionRefreshed(sessionName);
        }

        return refreshed;
      },
    ).finally(() => {
      inFlightSessionRefreshes.delete(sessionName);
    });

    inFlightSessionRefreshes.set(sessionName, refresh);

    return await refresh;
  }

  private static getSessionRefreshedAtKey(sessionName: string): string {
    return `session-refreshed-at:${sessionName}`;
  }

  private static wasSessionRefreshedRecently(sessionName: string): boolean {
    try {
      const refreshedAt: number = Number(
        LocalStorage.getItem(this.getSessionRefreshedAtKey(sessionName)),
      );

      if (!refreshedAt) {
        return false;
      }

      const ageInMs: number = Date.now() - refreshedAt;

      return (
        ageInMs >= 0 && ageInMs < BaseAPI.RECENT_SESSION_REFRESH_WINDOW_IN_MS
      );
    } catch {
      // Storage can be unavailable (privacy modes); then every tab refreshes.
      return false;
    }
  }

  private static markSessionRefreshed(sessionName: string): void {
    try {
      LocalStorage.setItem(
        this.getSessionRefreshedAtKey(sessionName),
        Date.now().toString(),
      );
    } catch {
      // Best effort, as above.
    }
  }

  /*
   * Web Locks serialise the refresh across every tab of this origin. Where
   * they are unavailable the refresh simply runs, which is what happened
   * before this lock existed.
   */
  private static async runWithSessionLock(
    sessionName: string,
    work: () => Promise<boolean>,
  ): Promise<boolean> {
    const locks: LockManager | undefined =
      typeof navigator !== "undefined" ? navigator.locks : undefined;

    if (!locks || typeof locks.request !== "function") {
      return await work();
    }

    return await locks.request(
      `oneuptime-session-refresh:${sessionName}`,
      work,
    );
  }

  protected static getLoginRoute(): Route {
    return new Route("/accounts/login");
  }

  protected static getForbiddenRoute(): Route {
    return new Route("/accounts/forbidden");
  }

  public static getFriendlyMessage(
    err: HTTPErrorResponse | Exception | unknown,
  ): string {
    if (err instanceof HTTPErrorResponse) {
      if (err.statusCode === 502 || err.statusCode === 504) {
        return "Error connecting to server. Please try again in few minutes.";
      }

      return err.message || "Server Error. Please try again";
    }

    if (err instanceof Error) {
      return err.message || "Server Error. Please try again";
    }

    if (typeof err === "string") {
      return err || "Server Error. Please try again";
    }

    /*
     * Never surface a raw object as "[object Object]" — pull a message
     * out of it (gateways/proxies often send `{ message }` or `{ error }`)
     * or stringify it so the UI shows something actionable.
     */
    if (err && typeof err === "object") {
      const obj: { message?: unknown; error?: unknown } = err as {
        message?: unknown;
        error?: unknown;
      };
      if (typeof obj.message === "string" && obj.message) {
        return obj.message;
      }
      if (typeof obj.error === "string" && obj.error) {
        return obj.error;
      }
      try {
        return JSON.stringify(err);
      } catch {
        return "Server Error. Please try again";
      }
    }

    return "Server Error. Please try again";
  }
}

export default BaseAPI;
