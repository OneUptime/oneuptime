import StatusPageUtil from "./StatusPage";
import Headers from "Common/Types/API/Headers";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import BaseAPI from "Common/UI/Utils/API/API";
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
    UserUtil.logout(StatusPageUtil.getStatusPageId()!);
  }

  public static override getForbiddenRoute(): Route {
    return new Route(
      StatusPageUtil.isPreviewPage()
        ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/forbidden`
        : "/forbidden",
    );
  }
}
