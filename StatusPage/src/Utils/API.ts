import StatusPageUtil from "./StatusPage";
import Headers from "Common/Types/API/Headers";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import BaseAPI from "Common/UI/Utils/API/API";
import { IDENTITY_URL } from "Common/UI/Config";
import UserUtil from "./User";
import { AuthRetryContext } from "Common/Utils/API";

export default class API extends BaseAPI {
  private static statusPageRefreshPromise: Promise<boolean> | null = null;

  public static override getDefaultHeaders(): Headers {
    const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

    if (!statusPageId) {
      return {};
    }

    return {
      "status-page-id": statusPageId.toString(),
      tenantid: ""
    };
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

  protected static override async tryRefreshAuth(
    _context: AuthRetryContext,
  ): Promise<boolean> {
    const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

    if (!statusPageId) {
      return false;
    }

    if (!this.statusPageRefreshPromise) {
      this.statusPageRefreshPromise = (async () => {
        const refreshUrl: URL = URL.fromString(IDENTITY_URL.toString())
          .addRoute("/status-page/refresh-token")
          .addRoute(`/${statusPageId.toString()}`);

        const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await super.fetch<JSONObject>({
            method: HTTPMethod.POST,
            url: refreshUrl,
            options: {
              skipAuthRefresh: true,
              hasAttemptedAuthRefresh: true,
            },
          });

        return result instanceof HTTPResponse && result.isSuccess();
      })().finally(() => {
        this.statusPageRefreshPromise = null;
      });
    }

    return await this.statusPageRefreshPromise;
  }
}
