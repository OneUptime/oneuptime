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

export default class API extends BaseAPI {
  public static override getDefaultHeaders(): Headers {
    const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

    if (!statusPageId) {
      return {};
    }

    return {
      "status-page-id": statusPageId.toString(),
      tenantid: "",
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

  public static override logoutUser(): void {
    void UserUtil.logout(StatusPageUtil.getStatusPageId()!);
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

  protected static override getSessionName(): string {
    return `status-page-${StatusPageUtil.getStatusPageId()?.toString() || ""}`;
  }
}
