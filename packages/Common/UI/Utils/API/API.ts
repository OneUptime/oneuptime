import GlobalEvents from "../GlobalEvents";
import LocalStorage from "../LocalStorage";
import Navigation from "../Navigation";
import PermissionUtil from "../Permission";
import SessionEndReturn from "../SessionEndReturn";
import User from "../User";
import UserActivity from "../UserActivity";
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
import { isEmptyErrorPhrase } from "../../../Types/Exception/ErrorMessageRule";
import Exception from "../../../Types/Exception/Exception";
import ProjectBlockedException from "../../../Types/Exception/ProjectBlockedException";
import SessionEndedException from "../../../Types/Exception/SessionEndedException";
import {
  ERROR_REFERENCE_FIELD,
  getUnexplainedServerErrorMessage,
  isErrorReference,
  SERVER_DOWN_MESSAGE,
  UNEXPLAINED_ERROR_MESSAGES,
} from "../../../Types/Exception/UnexplainedError";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  INACTIVE_FOR_IN_SECONDS_FIELD,
  SessionEndReason,
} from "../../../Types/UserSession/SessionLength";
import API, { AuthRetryContext } from "../../../Utils/API";
import { IDENTITY_URL } from "../../Config";
import { registerPageErrorReader } from "../ErrorReader";
import BlockedProject from "../BlockedProject";

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

/*
 * Why the server ended this tab's session, once it has said so (a renewal
 * answered with SessionEndedException): every request that fails after it
 * sends the browser to the same sign-in page, which says why. Kept here, not
 * on the class, for the reason above.
 */
const sessionEnd: { reason: SessionEndReason | null } = { reason: null };

// The session name of the Dashboard's and the Admin Dashboard's sign-in.
const DASHBOARD_SESSION_NAME: string = "dashboard";

/*
 * What fetch() throws, as a TypeError, when a request gets no answer at all:
 * Chrome's, Firefox's and Safari's words for it.
 */
const FETCH_FAILED_MESSAGES: ReadonlyArray<string> = [
  "Failed to fetch",
  "NetworkError when attempting to fetch resource.",
  "Load failed",
  "Network request failed",
];

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

  /*
   * The permission snapshots an answer carries (Common/UI/Utils/Permission
   * says where they are kept). A project's snapshot is kept for the project
   * it names, with the hash sent beside it - whichever tab's request it
   * answered, and whichever project that tab shows - and the person's
   * global snapshot with its own hash. A hash is kept only with its
   * snapshot. A header that cannot be read is left out: it never fails the
   * request it came on.
   */
  protected static override async onResponseSuccessHeaders(
    headers: Dictionary<string>,
  ): Promise<Dictionary<string>> {
    try {
      BaseAPI.keepPermissionsHeaders(headers);
    } catch {
      // Not kept: the server sends them again with the next answer.
    }

    return Promise.resolve(headers);
  }

  private static keepPermissionsHeaders(headers: Dictionary<string>): void {
    if (headers && headers["global-permissions"]) {
      const globalPermissions: UserGlobalAccessPermission | null =
        BaseAPI.readPermissionsHeader<UserGlobalAccessPermission>(
          headers["global-permissions"],
        );

      if (globalPermissions) {
        PermissionUtil.setGlobalPermissions(globalPermissions, {
          hash: headers["global-permissions-hash"],
        });
      }
    }

    if (headers && headers["project-permissions"]) {
      const projectPermissions: UserTenantAccessPermission | null =
        BaseAPI.readPermissionsHeader<UserTenantAccessPermission>(
          headers["project-permissions"],
        );

      if (projectPermissions) {
        PermissionUtil.setProjectPermissions(projectPermissions, {
          hash: headers["project-permissions-hash"],
        });
      }
    }
  }

  // A permission header's snapshot, or null when it is not one.
  private static readPermissionsHeader<T extends JSONObject>(
    value: string,
  ): T | null {
    try {
      const snapshot: JSONObject = JSONFunctions.deserialize(
        JSONFunctions.parseJSONObject(value),
      );

      return snapshot && typeof snapshot === "object" ? (snapshot as T) : null;
    } catch {
      return null;
    }
  }

  /*
   * What the request tells the server about the snapshots this browser
   * keeps: the hash of the person's global one, and the hash of the one for
   * the project the request is about - the project its tenantid header
   * names, which is not always the project the tab shows (My On-Call
   * Policies asks every project of the person in turn). A request about no
   * project sends no project hash. The server then sends a snapshot again
   * only when it changed.
   */
  protected static override getHeaders(requestHeaders?: Headers): Headers {
    let defaultHeaders: Headers = this.getDefaultHeaders();

    defaultHeaders = {
      ...defaultHeaders,
      ...BaseAPI.getPermissionsHashHeaders(requestHeaders),
    };

    return defaultHeaders;
  }

  /*
   * The hashes are only a saving - the server sends a snapshot it is not
   * told the browser has - so a request goes out without them rather than
   * not at all.
   */
  private static getPermissionsHashHeaders(
    requestHeaders: Headers | undefined,
  ): Headers {
    const headers: Headers = {};

    try {
      const globalPermissionsHash: string | null =
        PermissionUtil.getGlobalPermissionsHash();

      if (globalPermissionsHash) {
        headers["global-permissions-hash"] = globalPermissionsHash;
      }

      const tenantId: string | null = BaseAPI.getTenantIdHeader(requestHeaders);

      const projectPermissionsHash: string | null = tenantId
        ? PermissionUtil.getProjectPermissionsHash(tenantId)
        : null;

      if (projectPermissionsHash) {
        headers["project-permissions-hash"] = projectPermissionsHash;
      }
    } catch {
      // Sent without them: the server answers with the snapshots instead.
    }

    return headers;
  }

  // The project a request names in its tenantid header, whatever its case.
  private static getTenantIdHeader(
    requestHeaders: Headers | undefined,
  ): string | null {
    if (!requestHeaders) {
      return null;
    }

    for (const name of Object.keys(requestHeaders)) {
      if (name.toLowerCase() !== "tenantid") {
        continue;
      }

      const value: unknown = requestHeaders[name];

      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    return null;
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

      /*
       * A person's session ended (401): the sign-in page says why when the
       * server said why - its length or its idle timeout - and the page
       * they were on waits for them to sign in again (SessionEndReturn).
       * Remembered before logoutUser forgets who they were.
       */
      const isUserSessionEnd: boolean =
        error.statusCode === 401 && this.isUserSession();

      if (isUserSessionEnd) {
        const reason: SessionEndReason | null = SessionEndedException.getReason(
          error.message,
        );

        if (reason) {
          sessionEnd.reason = reason;
        }

        const userId: string = User.getUserId().toString();

        if (userId) {
          SessionEndReturn.rememberCurrentPage(userId);
        }
      }

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
        Navigation.navigate(
          isUserSessionEnd
            ? SessionEndReturn.getSignInRoute(loginRoute, sessionEnd.reason)
            : loginRoute,
          {
            forceNavigate: true,
          },
        );
      }
    }

    /*
     * A project a master admin blocked answers every request for it with a
     * 403 that says so (ProjectBlockedException). Not the Forbidden page:
     * the browser remembers the project, so it would send the person back
     * there on every visit, even with other projects to open. The app shows
     * the project's own notice instead (BlockedProject.REFUSED_EVENT), and its
     * project picker still switches to the others.
     */
    if (
      error instanceof HTTPErrorResponse &&
      error.statusCode === 403 &&
      ProjectBlockedException.isException(error.message)
    ) {
      GlobalEvents.dispatchEvent(BlockedProject.REFUSED_EVENT);
      return error;
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
    return DASHBOARD_SESSION_NAME;
  }

  /*
   * Whether this client's session is a person's sign-in to OneUptime - the
   * Dashboard's and the Admin Dashboard's - rather than a status page's or
   * a public dashboard's, which have sessions of their own or none.
   */
  protected static isUserSession(): boolean {
    return (
      this.getSessionName() === DASHBOARD_SESSION_NAME &&
      this.getRefreshSessionUrl() !== null
    );
  }

  /*
   * What a renewal of this client's session tells the server: on the
   * Dashboard and the Admin Dashboard, how long their person has not used
   * OneUptime (UserActivity), which the server's idle timeout is counted
   * from. Nothing on a page that does not notice activity.
   */
  protected static getRefreshSessionData(): JSONObject | undefined {
    if (!this.isUserSession()) {
      return undefined;
    }

    const inactiveForInSeconds: number | null =
      UserActivity.getInactiveForInSeconds();

    if (inactiveForInSeconds === null) {
      return undefined;
    }

    return { [INACTIVE_FOR_IN_SECONDS_FIELD]: inactiveForInSeconds };
  }

  // Forgets why a session ended. For tests.
  public static resetSessionEndForTests(): void {
    sessionEnd.reason = null;
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

        const refreshData: JSONObject | undefined =
          this.getRefreshSessionData();

        const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await super.fetch<JSONObject>({
            method: HTTPMethod.POST,
            url: refreshUrl,
            ...(refreshData ? { data: refreshData } : {}),
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
    /*
     * The sentences of an error nobody explained are written here: a card
     * that puts one in a sentence of its own (errorInSentence) says it to
     * the page's reader - Cloud or not, a master admin, a visitor (#7307).
     * Told here, as a page runs: at load, API and User import each other.
     */
    registerPageErrorReader();

    if (err instanceof HTTPErrorResponse) {
      /*
       * A gateway's own 502 / 504 is a page, not a message: the server could
       * not be reached. A 504 the API itself answered is JSON whose message
       * says what happened — a read stopped at its time limit says it took
       * too long and what to try (issue #4707) — and that is what the reader
       * needs.
       */
      if (err.statusCode === 502 || err.statusCode === 504) {
        const apiMessage: string =
          err.statusCode === 504 ? BaseAPI.getJsonErrorMessage(err) : "";

        // ErrorExplanation draws SERVER_DOWN_MESSAGE as what to do next.
        return apiMessage || SERVER_DOWN_MESSAGE;
      }

      /*
       * A failure the server could not explain names a reference to its
       * log lines (Server/Utils/UnexplainedServerError): the sentence is
       * built here from the reference, so ErrorExplanation can read it back
       * and draw it in the reader's language with a copy button (#6836).
       */
      const reference: unknown = err.data
        ? (err.data as JSONObject)[ERROR_REFERENCE_FIELD]
        : undefined;

      if (isErrorReference(reference)) {
        return getUnexplainedServerErrorMessage(reference);
      }

      return BaseAPI.explainServerMessage(err.message);
    }

    if (err instanceof Error) {
      return BaseAPI.explainThrownError(err);
    }

    if (typeof err === "string") {
      return BaseAPI.explainServerMessage(err);
    }

    /*
     * Never surface a raw object as "[object Object]" — pull a message
     * out of it (gateways/proxies often send `{ message }` or `{ error }`).
     * An object with neither is not something a person can read, so it
     * gets the sentence for a page that failed.
     */
    if (err && typeof err === "object") {
      const obj: { message?: unknown; error?: unknown } = err as {
        message?: unknown;
        error?: unknown;
      };
      if (typeof obj.message === "string" && obj.message) {
        return BaseAPI.explainServerMessage(obj.message);
      }
      if (typeof obj.error === "string" && obj.error) {
        return BaseAPI.explainServerMessage(obj.error);
      }
    }

    return UNEXPLAINED_ERROR_MESSAGES.page;
  }

  /*
   * A message as the reader should see it: as it came, unless it says
   * nothing - "Server Error", "Internal Server Error", an empty body - when
   * it becomes the sentence for a failure the server did not explain.
   */
  private static explainServerMessage(message: string | undefined): string {
    if (isEmptyErrorPhrase(message)) {
      return UNEXPLAINED_ERROR_MESSAGES.server;
    }

    return message as string;
  }

  /*
   * What a thrown error says to a person (#6836). OneUptime's own
   * exceptions, and errors code threw with a message on purpose, are shown
   * as they are. These are not:
   * - a request that got no answer at all (APIException "Request failed to
   *   <url>. Network Error", fetch()'s TypeError "Failed to fetch"): the URL
   *   and the browser's words become "OneUptime could not be reached";
   * - the browser's own TypeError or ReferenceError ("Cannot read
   *   properties of undefined"): always a developer's words, so the
   *   sentence for a page that failed. A SyntaxError or RangeError is left
   *   as it is: it can be about what the person typed ("Invalid regular
   *   expression", JSON that does not parse);
   * - an error with no message: the sentence for a page that failed.
   */
  private static explainThrownError(err: Error): string {
    const message: string = (err.message || "").trim();

    if (
      err instanceof APIException &&
      (message.startsWith("Request failed to ") ||
        message === "No response received from server." ||
        message.toLowerCase().replace(/\.$/, "") === "network error")
    ) {
      return UNEXPLAINED_ERROR_MESSAGES.unreachable;
    }

    const isBrowsersOwnError: boolean =
      !(err instanceof Exception) &&
      (err.constructor === TypeError || err.constructor === ReferenceError);

    if (isBrowsersOwnError) {
      return FETCH_FAILED_MESSAGES.includes(message)
        ? UNEXPLAINED_ERROR_MESSAGES.unreachable
        : UNEXPLAINED_ERROR_MESSAGES.page;
    }

    if (!message) {
      return UNEXPLAINED_ERROR_MESSAGES.page;
    }

    return BaseAPI.explainServerMessage(message);
  }

  /*
   * The message of a JSON error body — `{ error }` from the API's error
   * handler, `{ message }` from Response.sendErrorResponse — or "" for any
   * other body. A page (a gateway's HTML) is kept under `data` by
   * HTTPResponse, so it is never read as a message here.
   */
  private static getJsonErrorMessage(err: HTTPErrorResponse): string {
    const body: JSONObject | undefined = err.data;

    if (!body) {
      return "";
    }

    for (const key of ["error", "message"]) {
      const value: unknown = body[key];

      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }

    return "";
  }
}

export default BaseAPI;
