import StatusPageUtil from "./StatusPage";
import Headers from "Common/Types/API/Headers";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import APIException from "Common/Types/Exception/ApiException";
import ObjectID from "Common/Types/ObjectID";
import BaseAPI from "Common/UI/Utils/API/API";
import { STATUS_PAGE_IDENTITY_API_URL } from "./Config";
import UserUtil from "./User";

/*
 * The language the reader reads the page in, as a request's Accept-Language
 * says it: what a sign-up stores, so their notifications are written in it
 * (Common/Server/Utils/StatusPage/SubscriberLanguage).
 *
 * Read from <html lang>, which the server writes in the page's default
 * language and the page keeps on the language the reader sees, on every
 * switch (Utils/i18n.ts, Common/UI/Utils/PageLanguage). Read from the page
 * rather than from i18next, so the server code that shares this module
 * needs no i18next of its own. Empty when the page names no language.
 */
export const getReaderLanguageHeaders: () => Headers = (): Headers => {
  const language: string =
    typeof document !== "undefined" && document.documentElement
      ? (document.documentElement.getAttribute("lang") || "").trim()
      : "";

  return language ? { "accept-language": language } : {};
};

export default class API extends BaseAPI {
  /*
   * Says a server message in the reader's language, when the page knows it
   * (Utils/ServerMessageWords, set by App.tsx). Set from outside rather than
   * imported, so this module stays free of i18next.
   */
  private static serverMessageWords: ((message: string) => string) | null =
    null;

  public static setServerMessageWords(
    words: ((message: string) => string) | null,
  ): void {
    API.serverMessageWords = words;
  }

  public static override getFriendlyMessage(err: unknown): string {
    const message: string = super.getFriendlyMessage(err);

    return API.serverMessageWords ? API.serverMessageWords(message) : message;
  }

  public static override getDefaultHeaders(): Headers {
    const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

    if (!statusPageId) {
      return {};
    }

    return {
      "status-page-id": statusPageId.toString(),
      tenantid: "",
      ...getReaderLanguageHeaders(),
    };
  }

  public static override handleError(
    error: HTTPErrorResponse | APIException,
  ): HTTPErrorResponse | APIException {
    /*
     * A public Status Page does not require an account session. An expired or
     * otherwise unrelated dashboard cookie must therefore not turn a public
     * request failure into either a dashboard logout or a Status Page login
     * redirect. Callers can display the response as a local inline error.
     *
     * Private Status Pages retain the existing page-scoped login behavior.
     */
    if (
      error instanceof HTTPErrorResponse &&
      !StatusPageUtil.isPrivateStatusPage() &&
      (error.statusCode === 401 || error.statusCode === 405)
    ) {
      return error;
    }

    return super.handleError(error);
  }

  public static override getLoginRoute(): Route {
    const basePath: string = StatusPageUtil.isPreviewPage()
      ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}`
      : "";

    if (
      StatusPageUtil.isPrivateStatusPage() &&
      StatusPageUtil.requiresMasterPassword() &&
      !StatusPageUtil.isMasterPasswordValidated()
    ) {
      return new Route(`${basePath}/master-password`);
    }

    return new Route(`${basePath}/login`);
  }

  /*
   * The reader's session on this page, ended on the server before the page
   * goes to its sign-in (BaseAPI.handleError waits for it, issue #9508).
   */
  public static override logoutUser(): Promise<void> {
    return UserUtil.logout(StatusPageUtil.getStatusPageId()!);
  }

  public static override getForbiddenRoute(): Route {
    return new Route(
      StatusPageUtil.isPreviewPage()
        ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/forbidden`
        : "/forbidden",
    );
  }

  /*
   * Refresh on the page's own origin. A private status page's session cookies
   * belong to the host serving the page, which on a custom domain
   * (status.example.com) is not the OneUptime host in IDENTITY_URL; refreshing
   * there sent no cookies, always failed, and logged the reader out every time
   * the 15-minute access token lapsed. /status-page-identity-api is proxied to
   * the identity service on every host, the preview host included.
   */
  protected static override getRefreshSessionUrl(): URL | null {
    const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

    if (!statusPageId) {
      return null;
    }

    return URL.fromURL(STATUS_PAGE_IDENTITY_API_URL).addRoute(
      `/refresh-token/${statusPageId.toString()}`,
    );
  }

  /*
   * A private status page's renewal (StatusPageAuthentication's
   * /refresh-token/:statuspageid) answers its reader's entity, with the
   * new access token under _miscData.token beside the cookies it sets. A
   * 200 without it is not that answer (issue #8838).
   */
  protected static override isSessionRenewalAnswer(data: unknown): boolean {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return false;
    }

    const misc: unknown = (data as Record<string, unknown>)["_miscData"];

    if (!misc || typeof misc !== "object" || Array.isArray(misc)) {
      return false;
    }

    const token: unknown = (misc as Record<string, unknown>)["token"];

    return typeof token === "string" && token.trim().length > 0;
  }

  protected static override getSessionName(): string {
    return `status-page-${StatusPageUtil.getStatusPageId()?.toString() || ""}`;
  }
}
