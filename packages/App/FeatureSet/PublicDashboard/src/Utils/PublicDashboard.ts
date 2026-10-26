import DashboardInTab from "./DashboardInTab";
import DashboardThemeUtil from "./DashboardTheme";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Route from "Common/Types/API/Route";
import { DASHBOARD_THEME_LINK_PARAMETER } from "Common/Types/Dashboard/DashboardTheme";
import ObjectID from "Common/Types/ObjectID";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Navigation from "Common/UI/Utils/Navigation";

/*
 * What the browser keeps about one dashboard, under these names followed by
 * the dashboard's id: shared by every tab showing that dashboard, and by no
 * other.
 */
export const DASHBOARD_REQUIRES_MASTER_PASSWORD_STORAGE_KEY: string =
  "dashboardRequiresMasterPassword";
export const DASHBOARD_MASTER_PASSWORD_VALIDATED_STORAGE_KEY: string =
  "dashboardMasterPasswordValidated";

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

  /*
   * Where the password prompt sends the visitor once it opens: a place on
   * this dashboard, never another site, never a prompt, and never another
   * dashboard's address (/public-dashboard/<another id>/...).
   */
  public static getSafeRedirectUrl(): string | null {
    const redirectUrl: string | null =
      Navigation.getQueryStringByName("redirectUrl");

    if (
      !redirectUrl ||
      !redirectUrl.startsWith("/") ||
      redirectUrl.startsWith("//") ||
      PublicDashboardUtil.isAuthPath(redirectUrl) ||
      DashboardInTab.isAnotherPagesPath(redirectUrl)
    ) {
      return null;
    }

    return redirectUrl;
  }

  // The dashboard this tab shows (Utils/DashboardInTab).
  public static getDashboardId(): ObjectID | null {
    return DashboardInTab.get();
  }

  /*
   * The dashboard this tab loaded: the app sets it once it has found the
   * dashboard - from the address, or from the domain on a custom domain -
   * and nothing another tab does changes it.
   */
  public static setDashboardId(id: ObjectID | null): void {
    DashboardInTab.set(id);
  }

  public static setRequiresMasterPassword(value: boolean): void {
    PublicDashboardUtil.setDashboardItem(
      DASHBOARD_REQUIRES_MASTER_PASSWORD_STORAGE_KEY,
      value,
    );

    if (!value) {
      PublicDashboardUtil.setMasterPasswordValidated(false);
    }
  }

  public static requiresMasterPassword(): boolean {
    return PublicDashboardUtil.getDashboardItem(
      DASHBOARD_REQUIRES_MASTER_PASSWORD_STORAGE_KEY,
    );
  }

  public static setMasterPasswordValidated(value: boolean): void {
    PublicDashboardUtil.setDashboardItem(
      DASHBOARD_MASTER_PASSWORD_VALIDATED_STORAGE_KEY,
      value,
    );
  }

  public static isMasterPasswordValidated(): boolean {
    return PublicDashboardUtil.getDashboardItem(
      DASHBOARD_MASTER_PASSWORD_VALIDATED_STORAGE_KEY,
    );
  }

  /*
   * The name something about this tab's dashboard is kept under: the name,
   * then the dashboard's id. Null while the tab does not know its dashboard
   * - then nothing is read or kept, as a name without an id would be every
   * dashboard's.
   */
  private static getDashboardStorageKey(baseKey: string): string | null {
    const dashboardId: ObjectID | null = PublicDashboardUtil.getDashboardId();

    if (!dashboardId) {
      return null;
    }

    return `${baseKey}-${dashboardId.toString()}`;
  }

  private static setDashboardItem(baseKey: string, value: boolean): void {
    const storageKey: string | null =
      PublicDashboardUtil.getDashboardStorageKey(baseKey);

    if (!storageKey) {
      return;
    }

    LocalStorage.setItem(storageKey, value);
  }

  private static getDashboardItem(baseKey: string): boolean {
    const storageKey: string | null =
      PublicDashboardUtil.getDashboardStorageKey(baseKey);

    if (!storageKey) {
      return false;
    }

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
