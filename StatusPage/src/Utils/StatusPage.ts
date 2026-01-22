import UserUtil from "./User";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Typeof from "Common/Types/Typeof";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import Navigation from "Common/UI/Utils/Navigation";

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
    const normalizedPath: string = path.toLowerCase().split("?")[0] || "";
    return StatusPageUtil.AUTH_PATHS.some((authPath: string) => {
      return (
        normalizedPath === authPath ||
        normalizedPath.endsWith(authPath) ||
        normalizedPath.includes(authPath + "?")
      );
    });
  }

  // Get a safe redirect URL, returning null if the URL is an auth page
  public static getSafeRedirectUrl(): string | null {
    const redirectUrl: string | null =
      Navigation.getQueryStringByName("redirectUrl");
    if (!redirectUrl || StatusPageUtil.isAuthPath(redirectUrl)) {
      return null;
    }
    return redirectUrl;
  }

  // Get the default redirect path (overview page)
  public static getDefaultRedirectRoute(): Route {
    return new Route(
      StatusPageUtil.isPreviewPage()
        ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/`
        : "/",
    );
  }

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
    const storageKey: string =
      StatusPageUtil.getIsPrivateStatusPageStorageKey();

    LocalStorage.setItem(storageKey, isPrivate);
  }

  public static isPrivateStatusPage(): boolean {
    const storageKey: string =
      StatusPageUtil.getIsPrivateStatusPageStorageKey();

    return Boolean(LocalStorage.getItem(storageKey));
  }

  public static setRequiresMasterPassword(value: boolean): void {
    const storageKey: string =
      StatusPageUtil.getRequiresMasterPasswordStorageKey();

    LocalStorage.setItem(storageKey, value);

    if (!value) {
      StatusPageUtil.setMasterPasswordValidated(false);
    }
  }

  public static requiresMasterPassword(): boolean {
    const storageKey: string =
      StatusPageUtil.getRequiresMasterPasswordStorageKey();

    return Boolean(LocalStorage.getItem(storageKey));
  }

  private static getStatusPageScopedStorageKey(baseKey: string): string {
    const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

    if (!statusPageId) {
      return baseKey;
    }

    return `${baseKey}-${statusPageId.toString()}`;
  }

  private static getIsPrivateStatusPageStorageKey(): string {
    return StatusPageUtil.getStatusPageScopedStorageKey("isPrivateStatusPage");
  }

  private static getRequiresMasterPasswordStorageKey(): string {
    return StatusPageUtil.getStatusPageScopedStorageKey(
      "requiresMasterPassword",
    );
  }

  private static getMasterPasswordValidationStorageKey(): string {
    const statusPageId: ObjectID | null = StatusPageUtil.getStatusPageId();

    if (!statusPageId) {
      return "masterPasswordValidated";
    }

    return `masterPasswordValidated-${statusPageId.toString()}`;
  }

  public static setMasterPasswordValidated(value: boolean): void {
    const storageKey: string =
      StatusPageUtil.getMasterPasswordValidationStorageKey();

    LocalStorage.setItem(storageKey, value);

    if (storageKey !== "masterPasswordValidated") {
      LocalStorage.removeItem("masterPasswordValidated");
    }
  }

  public static isMasterPasswordValidated(): boolean {
    const storageKey: string =
      StatusPageUtil.getMasterPasswordValidationStorageKey();

    const currentValue: boolean = Boolean(LocalStorage.getItem(storageKey));

    if (currentValue) {
      return true;
    }

    if (storageKey === "masterPasswordValidated") {
      return false;
    }

    const legacyValue: boolean = Boolean(
      LocalStorage.getItem("masterPasswordValidated"),
    );

    LocalStorage.removeItem("masterPasswordValidated");

    if (legacyValue) {
      LocalStorage.setItem(storageKey, legacyValue);
      return true;
    }

    return false;
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
    const shouldIncludeRedirect: boolean = !StatusPageUtil.isAuthPath(currentPath);

    const basePath: string = StatusPageUtil.isPreviewPage()
      ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}/login`
      : "/login";

    const route: Route = new Route(
      shouldIncludeRedirect ? `${basePath}?redirectUrl=${currentPath}` : basePath,
    );

    Navigation.navigate(route, { forceNavigate: true });
  }

  public static navigateToMasterPasswordPage(): void {
    if (Navigation.getCurrentRoute().toString().includes("master-password")) {
      return;
    }

    const currentPath: string = Navigation.getCurrentPath().toString();
    const shouldIncludeRedirect: boolean = !StatusPageUtil.isAuthPath(currentPath);

    const basePath: string = StatusPageUtil.isPreviewPage()
      ? `/status-page/${StatusPageUtil.getStatusPageId()?.toString()}`
      : "";

    const route: Route = new Route(
      shouldIncludeRedirect
        ? `${basePath}/master-password?redirectUrl=${currentPath}`
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
