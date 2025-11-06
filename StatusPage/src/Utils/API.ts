import StatusPageUtil from "./StatusPage";
import Headers from "Common/Types/API/Headers";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { IDENTITY_URL } from "Common/UI/Config";
import BaseAPI from "Common/UI/Utils/API/API";
import { Logger } from "Common/UI/Utils/Logger";
import UserUtil from "./User";

export default class API extends BaseAPI {
  public static override getDefaultHeaders(statusPageId: ObjectID): Headers {
    if (!statusPageId) {
      return {};
    }

    return {
      "status-page-id": statusPageId.toString(),
    };
  }

  public static override getLoginRoute(): Route {
    return new Route(
      StatusPageUtil.isPreviewPage()
        ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/login`
        : "/login",
    );
  }

  public static override logoutUser(): void {
    const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

    if (!statusPageId) {
      return;
    }

    void UserUtil.logout(statusPageId);
  }

  public static override getForbiddenRoute(): Route {
    return new Route(
      StatusPageUtil.isPreviewPage()
        ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/forbidden`
        : "/forbidden",
    );
  }
}

const registerStatusPageAuthRefresh = (): void => {
  const refreshSession = async (): Promise<boolean> => {
    const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

    if (!statusPageId) {
      Logger.warn("Skipping status page session refresh: missing status page id.");
      return false;
    }

    try {
      const response = await API.post<JSONObject>({
        url: URL.fromURL(IDENTITY_URL)
          .addRoute("/status-page/refresh-session")
          .addRoute(`/${statusPageId.toString()}`),
        options: {
          skipAuthRefresh: true,
        },
      });

      if (response instanceof HTTPErrorResponse) {
        Logger.warn(
          `Status page session refresh failed with status ${response.statusCode}.`,
        );
        return false;
      }

      return response.isSuccess();
    } catch (err) {
      Logger.error("Status page session refresh request failed.");
      Logger.error(err as Error);
      return false;
    }
  };

  API.setRefreshSessionHandler(refreshSession);

  API.setRefreshFailureHandler(() => {
    const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

    if (statusPageId) {
      void UserUtil.logout(statusPageId);
    }
  });
};

registerStatusPageAuthRefresh();
