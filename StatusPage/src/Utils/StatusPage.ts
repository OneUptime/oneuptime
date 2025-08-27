import UserUtil from "./User";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Typeof from "Common/Types/Typeof";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Navigation from "Common/UI/Utils/Navigation";

export default class StatusPageUtil {
  public static getStatusPageId(): ObjectID | null {
    const value: ObjectID | null = LocalStorage.getItem(
      "statusPageId",
    ) as ObjectID | null;

    if (value && typeof value === Typeof.String) {
      return new ObjectID(value.toString());
    }

    return value;
  }

  public static setStatusPageId(id: ObjectID | null): void {
    LocalStorage.setItem("statusPageId", id);
  }

  public static setIsPrivateStatusPage(isPrivate: boolean): void {
    LocalStorage.setItem("isPrivateStatusPage", isPrivate);
  }

  public static isPrivateStatusPage(): boolean {
    return Boolean(LocalStorage.getItem("isPrivateStatusPage"));
  }

  public static isPreviewPage(): boolean {
    return Navigation.containsInPath("/status-page/");
  }

  public static navigateToLoginPage(): void {
    const route: Route = new Route(
      StatusPageUtil.isPreviewPage()
        ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/login?redirectUrl=${Navigation.getCurrentPath()}`
        : `/login?redirectUrl=${Navigation.getCurrentPath()}`,
    );

    Navigation.navigate(route, { forceNavigate: true });
  }

  public static checkIfUserHasLoggedIn(): void {
    const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

    if (
      statusPageId &&
      StatusPageUtil.isPrivateStatusPage() &&
      !UserUtil.isLoggedIn(statusPageId)
    ) {
      StatusPageUtil.navigateToLoginPage();
    }
  }

  public static async checkIfTheUserIsAuthenticated(
    errorResponse: HTTPErrorResponse,
  ): Promise<void> {
    if (
      errorResponse instanceof HTTPErrorResponse &&
      errorResponse.statusCode === 401
    ) {
      await UserUtil.logout(StatusPageUtil.getStatusPageId()!);
      StatusPageUtil.navigateToLoginPage();
    }
  }
}
