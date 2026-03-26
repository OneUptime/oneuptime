import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Typeof from "Common/Types/Typeof";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Navigation from "Common/UI/Utils/Navigation";

export default class PublicDashboardUtil {
  public static getDashboardId(): ObjectID | null {
    const value: ObjectID | null = LocalStorage.getItem(
      "dashboardId",
    ) as ObjectID | null;

    if (value && typeof value === Typeof.String) {
      return new ObjectID(value.toString());
    }

    return value;
  }

  public static setDashboardId(id: ObjectID | null): void {
    LocalStorage.setItem("dashboardId", id);
  }

  public static setRequiresMasterPassword(value: boolean): void {
    const storageKey: string = PublicDashboardUtil.getRequiresMasterPasswordStorageKey();
    LocalStorage.setItem(storageKey, value);

    if (!value) {
      PublicDashboardUtil.setMasterPasswordValidated(false);
    }
  }

  public static requiresMasterPassword(): boolean {
    const storageKey: string = PublicDashboardUtil.getRequiresMasterPasswordStorageKey();
    return Boolean(LocalStorage.getItem(storageKey));
  }

  private static getDashboardScopedStorageKey(baseKey: string): string {
    const dashboardId: ObjectID | null = PublicDashboardUtil.getDashboardId();

    if (!dashboardId) {
      return baseKey;
    }

    return `${baseKey}-${dashboardId.toString()}`;
  }

  private static getRequiresMasterPasswordStorageKey(): string {
    return PublicDashboardUtil.getDashboardScopedStorageKey(
      "dashboardRequiresMasterPassword",
    );
  }

  private static getMasterPasswordValidationStorageKey(): string {
    const dashboardId: ObjectID | null = PublicDashboardUtil.getDashboardId();

    if (!dashboardId) {
      return "dashboardMasterPasswordValidated";
    }

    return `dashboardMasterPasswordValidated-${dashboardId.toString()}`;
  }

  public static setMasterPasswordValidated(value: boolean): void {
    const storageKey: string =
      PublicDashboardUtil.getMasterPasswordValidationStorageKey();
    LocalStorage.setItem(storageKey, value);
  }

  public static isMasterPasswordValidated(): boolean {
    const storageKey: string =
      PublicDashboardUtil.getMasterPasswordValidationStorageKey();
    return Boolean(LocalStorage.getItem(storageKey));
  }

  public static isPreviewPage(): boolean {
    return Navigation.containsInPath("/public-dashboard/");
  }

  public static navigateToMasterPasswordPage(): void {
    if (Navigation.getCurrentRoute().toString().includes("master-password")) {
      return;
    }

    const currentPath: string = Navigation.getCurrentPath().toString();
    const basePath: string = PublicDashboardUtil.isPreviewPage()
      ? `/public-dashboard/${PublicDashboardUtil.getDashboardId()?.toString()}`
      : "";

    const route: Route = new Route(
      `${basePath}/master-password?redirectUrl=${currentPath}`,
    );

    Navigation.navigate(route, { forceNavigate: true });
  }

  public static async checkIfTheUserIsAuthenticated(
    errorResponse: HTTPErrorResponse,
  ): Promise<void> {
    if (
      errorResponse instanceof HTTPErrorResponse &&
      errorResponse.statusCode === 401
    ) {
      if (
        PublicDashboardUtil.requiresMasterPassword() &&
        !PublicDashboardUtil.isMasterPasswordValidated()
      ) {
        PublicDashboardUtil.navigateToMasterPasswordPage();
      }
    }
  }
}
