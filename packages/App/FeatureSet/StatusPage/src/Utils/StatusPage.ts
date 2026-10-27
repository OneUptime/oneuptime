import StatusPageInTab from "./StatusPageInTab";
import UserUtil from "./User";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Navigation from "Common/UI/Utils/Navigation";

/*
 * What the browser keeps about one status page, under these names followed
 * by the page's id: shared by every tab showing that page, and by no other.
 */
export const IS_PRIVATE_STATUS_PAGE_STORAGE_KEY: string = "isPrivateStatusPage";
export const REQUIRES_MASTER_PASSWORD_STORAGE_KEY: string =
  "requiresMasterPassword";
export const MASTER_PASSWORD_VALIDATED_STORAGE_KEY: string =
  "masterPasswordValidated";

/*
 * Where single sign-on takes the visitor once they are signed in, kept in
 * this tab's session storage under this name followed by the page's id.
 */
export const SIGN_IN_REDIRECT_STORAGE_KEY: string =
  "status-page-sign-in-redirect";

export default class StatusPageUtil {
  // List of authentication-related paths that should not be used as redirect URLs
  private static readonly AUTH_PATHS: string[] = [
    "/login",
    "/sso",
    "/master-password",
    "/forgot-password",
    "/reset-password",
  ];

  // Check if a path is an authentication-related page
  public static isAuthPath(path: string): boolean {
    const normalizedPath: string = path.toLowerCase().split(/[?#]/)[0] || "";
    return StatusPageUtil.AUTH_PATHS.some((authPath: string) => {
      return normalizedPath === authPath || normalizedPath.endsWith(authPath);
    });
  }

  /*
   * A place on this status page to go to once signed in, or null: never
   * another site, never a sign-in page, and never another status page's
   * address (/status-page/<another id>/..., however it is written:
   * /status-page/<id>/../<another id> opens the other page too) - signing in
   * to one page leads to that page, not to the page another tab or another
   * link named.
   */
  public static getSafeRedirectPath(redirectUrl: string | null): string | null {
    if (
      !redirectUrl ||
      !Navigation.isSafeInternalRoute(redirectUrl) ||
      StatusPageUtil.isAuthPath(redirectUrl) ||
      StatusPageInTab.isAnotherPagesPath(redirectUrl)
    ) {
      return null;
    }

    return redirectUrl;
  }

  // Get a same-origin path redirect, returning null for unsafe or auth pages.
  public static getSafeRedirectUrl(): string | null {
    return StatusPageUtil.getSafeRedirectPath(
      Navigation.getQueryStringByName("redirectUrl"),
    );
  }

  /*
   * One of the page's sign-in pages - the password form or single sign-on -
   * carrying on the page the visitor is to land on once signed in: moving
   * between the two ways in keeps where they were going.
   */
  public static getSignInRoute(data: {
    path: string;
    redirectUrl: string | null;
  }): Route {
    const redirectUrl: string | null = StatusPageUtil.getSafeRedirectPath(
      data.redirectUrl,
    );

    return new Route(
      redirectUrl
        ? `${data.path}?redirectUrl=${encodeURIComponent(redirectUrl)}`
        : data.path,
    );
  }

  // Get the default redirect path (overview page)
  public static getDefaultRedirectRoute(): Route {
    return new Route(
      StatusPageUtil.isPreviewPage()
        ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/`
        : "/",
    );
  }

  // The status page this tab shows (Utils/StatusPageInTab).
  public static getStatusPageId(): ObjectID | null {
    return StatusPageInTab.get();
  }

  // The status page this tab's address names, if it names one.
  public static getStatusPageIdInAddress(): ObjectID | null {
    return StatusPageInTab.getIdInAddress();
  }

  /*
   * The status page this tab loaded: the master page sets it once it has
   * found the page - from the address, or from the domain on a custom
   * domain - and nothing another tab does changes it.
   */
  public static setStatusPageId(id: ObjectID | null): void {
    StatusPageInTab.set(id);
  }

  /*
   * Whether this tab's address names another status page than the one the
   * tab loaded: after a move inside the app to another page's address. The
   * tab then opens that address in full, its own master page and all,
   * instead of showing one page's name and navigation over another's
   * content.
   */
  public static isAddressOfAnotherStatusPage(): boolean {
    const idInAddress: ObjectID | null = StatusPageInTab.getIdInAddress();
    const loadedId: ObjectID | null = StatusPageInTab.getResolved();

    return Boolean(
      idInAddress && loadedId && idInAddress.toString() !== loadedId.toString(),
    );
  }

  public static setIsPrivateStatusPage(isPrivate: boolean): void {
    StatusPageUtil.setPageItem(IS_PRIVATE_STATUS_PAGE_STORAGE_KEY, isPrivate);
  }

  public static isPrivateStatusPage(): boolean {
    return StatusPageUtil.getPageItem(IS_PRIVATE_STATUS_PAGE_STORAGE_KEY);
  }

  public static setRequiresMasterPassword(value: boolean): void {
    StatusPageUtil.setPageItem(REQUIRES_MASTER_PASSWORD_STORAGE_KEY, value);

    if (!value) {
      StatusPageUtil.setMasterPasswordValidated(false);
    }
  }

  public static requiresMasterPassword(): boolean {
    return StatusPageUtil.getPageItem(REQUIRES_MASTER_PASSWORD_STORAGE_KEY);
  }

  public static setMasterPasswordValidated(value: boolean): void {
    /*
     * The one name every page shared before names ended in their page's id.
     * It cannot say which page it was for, so it is never read: it goes.
     */
    LocalStorage.removeItem(MASTER_PASSWORD_VALIDATED_STORAGE_KEY);

    StatusPageUtil.setPageItem(MASTER_PASSWORD_VALIDATED_STORAGE_KEY, value);
  }

  public static isMasterPasswordValidated(): boolean {
    return StatusPageUtil.getPageItem(MASTER_PASSWORD_VALIDATED_STORAGE_KEY);
  }

  /*
   * Where single sign-on takes the visitor once they are signed in: the
   * place on this page they were sent to sign in from. It has to outlast the
   * round trip to their identity provider and back, so it is kept - in this
   * tab's session storage, and for this page alone. It was kept in
   * localStorage under one name for every page, and whichever tab's overview
   * drew next took it: a visitor signing in to one status page could send
   * another tab, showing another page, to the first one.
   */
  public static rememberSignInRedirect(redirectPath: string | null): void {
    const storageKey: string | null = StatusPageUtil.getPageStorageKey(
      SIGN_IN_REDIRECT_STORAGE_KEY,
    );

    if (!storageKey) {
      return;
    }

    const safeRedirectPath: string | null =
      StatusPageUtil.getSafeRedirectPath(redirectPath);

    try {
      if (safeRedirectPath) {
        window.sessionStorage.setItem(storageKey, safeRedirectPath);
      } else {
        window.sessionStorage.removeItem(storageKey);
      }
    } catch {
      // Storage can be blocked: the visitor then lands on the overview.
    }
  }

  // The place rememberSignInRedirect kept for this page, taken once.
  public static takeSignInRedirect(): string | null {
    const storageKey: string | null = StatusPageUtil.getPageStorageKey(
      SIGN_IN_REDIRECT_STORAGE_KEY,
    );

    if (!storageKey) {
      return null;
    }

    let redirectPath: string | null = null;

    try {
      redirectPath = window.sessionStorage.getItem(storageKey);

      if (redirectPath !== null) {
        window.sessionStorage.removeItem(storageKey);
      }
    } catch {
      return null;
    }

    return StatusPageUtil.getSafeRedirectPath(redirectPath);
  }

  /*
   * The name something about this tab's page is kept under: the name, then
   * the page's id. Null while the tab does not know its page - then nothing
   * is read or kept, as a name without an id would be every page's.
   */
  private static getPageStorageKey(baseKey: string): string | null {
    const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

    if (!statusPageId) {
      return null;
    }

    return `${baseKey}-${statusPageId.toString()}`;
  }

  private static setPageItem(baseKey: string, value: boolean): void {
    const storageKey: string | null = StatusPageUtil.getPageStorageKey(baseKey);

    if (!storageKey) {
      return;
    }

    LocalStorage.setItem(storageKey, value);
  }

  private static getPageItem(baseKey: string): boolean {
    const storageKey: string | null = StatusPageUtil.getPageStorageKey(baseKey);

    if (!storageKey) {
      return false;
    }

    return Boolean(LocalStorage.getItem(storageKey));
  }

  public static isPreviewPage(): boolean {
    return Navigation.containsInPath("/status-page/");
  }

  public static navigateToLoginPage(): void {
    if (
      StatusPageUtil.isPrivateStatusPage() &&
      StatusPageUtil.requiresMasterPassword() &&
      !StatusPageUtil.isMasterPasswordValidated()
    ) {
      StatusPageUtil.navigateToMasterPasswordPage();
      return;
    }

    const currentPath: string = Navigation.getCurrentPath().toString();
    const shouldIncludeRedirect: boolean =
      !StatusPageUtil.isAuthPath(currentPath);

    const basePath: string = StatusPageUtil.isPreviewPage()
      ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/login`
      : "/login";

    const route: Route = new Route(
      shouldIncludeRedirect
        ? `${basePath}?redirectUrl=${encodeURIComponent(currentPath)}`
        : basePath,
    );

    Navigation.navigate(route, { forceNavigate: true });
  }

  public static navigateToMasterPasswordPage(): void {
    if (Navigation.getCurrentRoute().toString().includes("master-password")) {
      return;
    }

    const currentPath: string = Navigation.getCurrentPath().toString();
    const shouldIncludeRedirect: boolean =
      !StatusPageUtil.isAuthPath(currentPath);

    const basePath: string = StatusPageUtil.isPreviewPage()
      ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}`
      : "";

    const route: Route = new Route(
      shouldIncludeRedirect
        ? `${basePath}/master-password?redirectUrl=${encodeURIComponent(
            currentPath,
          )}`
        : `${basePath}/master-password`,
    );

    Navigation.navigate(route, { forceNavigate: true });
  }

  public static checkIfUserHasLoggedIn(): void {
    const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

    if (
      statusPageId &&
      StatusPageUtil.isPrivateStatusPage() &&
      StatusPageUtil.requiresMasterPassword() &&
      !UserUtil.isLoggedIn(statusPageId)
    ) {
      if (!StatusPageUtil.isMasterPasswordValidated()) {
        StatusPageUtil.navigateToMasterPasswordPage();
      }
      return;
    }

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
      if (
        StatusPageUtil.isPrivateStatusPage() &&
        StatusPageUtil.requiresMasterPassword() &&
        !StatusPageUtil.isMasterPasswordValidated()
      ) {
        StatusPageUtil.navigateToMasterPasswordPage();
        return;
      }

      await UserUtil.logout(StatusPageUtil.getStatusPageId()!);
      StatusPageUtil.navigateToLoginPage();
    }
  }
}
