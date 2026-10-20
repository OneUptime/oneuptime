import DashboardThemeUtil from "./DashboardTheme";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Route from "Common/Types/API/Route";
import { DASHBOARD_THEME_LINK_PARAMETER } from "Common/Types/Dashboard/DashboardTheme";
import ObjectID from "Common/Types/ObjectID";
import Typeof from "Common/Types/Typeof";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Navigation from "Common/UI/Utils/Navigation";

export default class PublicDashboardUtil {
  private static readonly AUTH_PATHS: Array<string> = [
    "/master-password",
    "/forbidden",
  ];

  public static isAuthPath(path: string): boolean {
    const normalizedPath: string = path.toLowerCase().split("?")[0] || "";

    return PublicDashboardUtil.AUTH_PATHS.some((authPath: string) => {
      return normalizedPath === authPath || normalizedPath.endsWith(authPath);
    });
  }

  public static getSafeRedirectUrl(): string | null {
    const redirectUrl: string | null =
      Navigation.getQueryStringByName("redirectUrl");

    if (
      !redirectUrl ||
      !redirectUrl.startsWith("/") ||
      redirectUrl.startsWith("//") ||
      PublicDashboardUtil.isAuthPath(redirectUrl)
    ) {
      return null;
    }

    return redirectUrl;
  }

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
    const storageKey: string =
      PublicDashboardUtil.getRequiresMasterPasswordStorageKey();
    LocalStorage.setItem(storageKey, value);

    if (!value) {
      PublicDashboardUtil.setMasterPasswordValidated(false);
    }
  }

  public static requiresMasterPassword(): boolean {
    const storageKey: string =
      PublicDashboardUtil.getRequiresMasterPasswordStorageKey();
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

  /*
   * An address of this app with the link's own theme (?theme=) kept on it,
   * for a page the app loads anew - the password prompt, and the dashboard
   * after it - so the link's theme holds there from the first paint, as it
   * held on the page the visitor opened (Types/Dashboard/DashboardTheme).
   * An address that names a theme of its own keeps it.
   */
  public static withLinkTheme(address: string): string {
    const linkTheme: string | null = DashboardThemeUtil.getLinkTheme();

    if (!linkTheme) {
      return address;
    }

    const queryStart: number = address.indexOf("?");
    const path: string =
      queryStart === -1 ? address : address.slice(0, queryStart);
    const params: URLSearchParams = new URLSearchParams(
      queryStart === -1 ? "" : address.slice(queryStart + 1),
    );

    if (params.has(DASHBOARD_THEME_LINK_PARAMETER)) {
      return address;
    }

    params.set(DASHBOARD_THEME_LINK_PARAMETER, linkTheme);

    return `${path}?${params.toString()}`;
  }

  public static navigateToMasterPasswordPage(): void {
    if (Navigation.getCurrentRoute().toString().includes("master-password")) {
      return;
    }

    const currentPath: string = Navigation.getCurrentPath().toString();
    const shouldIncludeRedirect: boolean =
      !PublicDashboardUtil.isAuthPath(currentPath);
    const basePath: string = PublicDashboardUtil.isPreviewPage()
      ? `/public-dashboard/${PublicDashboardUtil.getDashboardId()?.toString()}`
      : "";

    /*
     * Back to the address the visitor came to, its query included: what
     * the link says - its own theme, the variables it picks - holds on the
     * dashboard once the password opens it. An address no route could hold
     * goes back to its path alone, as before.
     */
    const currentAddress: string = `${currentPath}${Navigation.getQueryString()}`;
    const redirectUrl: string = Navigation.isSafeInternalRoute(currentAddress)
      ? currentAddress
      : currentPath;

    const route: Route = new Route(
      PublicDashboardUtil.withLinkTheme(
        shouldIncludeRedirect
          ? `${basePath}/master-password?redirectUrl=${encodeURIComponent(
              redirectUrl,
            )}`
          : `${basePath}/master-password`,
      ),
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
