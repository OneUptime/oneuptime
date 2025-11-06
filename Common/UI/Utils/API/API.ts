import LocalStorage from "../LocalStorage";
import Navigation from "../Navigation";
import PermissionUtil from "../Permission";
import User from "../User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Headers from "../../../Types/API/Headers";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import Dictionary from "../../../Types/Dictionary";
import APIException from "../../../Types/Exception/ApiException";
import Exception from "../../../Types/Exception/Exception";
import JSONFunctions from "../../../Types/JSONFunctions";
import {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import API, { APIErrorRetryContext } from "../../../Utils/API";

type RefreshSessionHandler = () => Promise<boolean>;
type ShouldAttemptRefreshHandler = (
  error: HTTPErrorResponse,
  context: APIErrorRetryContext,
) => boolean | Promise<boolean>;
type RefreshFailureHandler = (error: HTTPErrorResponse) => void;

class BaseAPI extends API {
  private static refreshSessionHandler: RefreshSessionHandler | null = null;
  private static shouldAttemptRefreshHandler:
    | ShouldAttemptRefreshHandler
    | null = null;
  private static refreshFailureHandler: RefreshFailureHandler | null = null;
  private static refreshSessionPromise: Promise<boolean> | null = null;

  public constructor(protocol: Protocol, hostname: Hostname, route?: Route) {
    super(protocol, hostname, route);
  }

  public static fromURL(url: URL): BaseAPI {
    return new BaseAPI(url.protocol, url.hostname, url.route);
  }

  public static setRefreshSessionHandler(
    handler: RefreshSessionHandler | null,
  ): void {
    this.refreshSessionHandler = handler;
  }

  public static setShouldAttemptRefreshHandler(
    handler: ShouldAttemptRefreshHandler | null,
  ): void {
    this.shouldAttemptRefreshHandler = handler;
  }

  public static setRefreshFailureHandler(
    handler: RefreshFailureHandler | null,
  ): void {
    this.refreshFailureHandler = handler;
  }

  protected static override async onResponseSuccessHeaders(
    headers: Dictionary<string>,
  ): Promise<Dictionary<string>> {
    if (headers && headers["global-permissions"]) {
      PermissionUtil.setGlobalPermissions(
        JSONFunctions.deserialize(
          JSONFunctions.parseJSONObject(headers["global-permissions"]),
        ) as UserGlobalAccessPermission,
      );
    }

    if (headers && headers["global-permissions-hash"]) {
      LocalStorage.setItem(
        "global-permissions-hash",
        headers["global-permissions-hash"],
      );
    }

    if (headers && headers["project-permissions"]) {
      PermissionUtil.setProjectPermissions(
        JSONFunctions.deserialize(
          JSONFunctions.parseJSONObject(headers["project-permissions"]),
        ) as UserTenantAccessPermission,
      );
    }

    if (headers && headers["project-permissions-hash"]) {
      LocalStorage.setItem(
        "project-permissions-hash",
        headers["project-permissions-hash"],
      );
    }

    return Promise.resolve(headers);
  }

  protected static override getHeaders(): Headers {
    let defaultHeaders: Headers = this.getDefaultHeaders();

    const headers: Headers = {};

    const globalPermissionsHash: string = LocalStorage.getItem(
      "global-permissions-hash",
    ) as string;
    if (globalPermissionsHash) {
      headers["global-permissions-hash"] = globalPermissionsHash;
    }

    const projectPermissionsHash: string = LocalStorage.getItem(
      "project-permissions-hash",
    ) as string;

    if (projectPermissionsHash) {
      headers["project-permissions-hash"] = projectPermissionsHash;
    }

    defaultHeaders = {
      ...defaultHeaders,
      ...headers,
    };

    return defaultHeaders;
  }

  protected static logoutUser(): void {
    return User.logout();
  }

  protected static override async shouldRetryAfterError(
    error: HTTPErrorResponse,
    context: APIErrorRetryContext,
  ): Promise<boolean> {
    if (context.options?.skipAuthRefresh) {
      return false;
    }

    if (context.retryCount > 0) {
      return false;
    }

    if (!(await this.shouldAttemptAuthRefresh(error, context))) {
      return false;
    }

    const refreshed: boolean = await this.refreshAuthSession();

    if (refreshed) {
      return true;
    }

    this.handleRefreshFailure(error);
    return false;
  }

  public static override async handleError(
    error: HTTPErrorResponse | APIException,
  ): Promise<HTTPErrorResponse | APIException> {
    /*
     * 405 Status - Tenant not found. If Project was deleted.
     * 401 Status - User is not logged in.
     * 403 Status - Forbidden. If the IP address is not whitelisted (for example).
     */
    if (
      error instanceof HTTPErrorResponse &&
      (error.statusCode === 401 || error.statusCode === 405)
    ) {
      const loginRoute: Route = this.getLoginRoute();

      this.logoutUser();

      if (Navigation.getQueryStringByName("token")) {
        Navigation.navigate(loginRoute.addRouteParam("sso", "true"), {
          forceNavigate: true,
        });
      } else {
        Navigation.navigate(loginRoute, {
          forceNavigate: true,
        });
      }
    }

    if (
      error instanceof HTTPErrorResponse &&
      error.statusCode === 403 &&
      Navigation.getCurrentRoute().toString() !==
        this.getForbiddenRoute().toString()
    ) {
      Navigation.navigate(this.getForbiddenRoute(), { forceNavigate: true });
    }

    return error;
  }

  private static async shouldAttemptAuthRefresh(
    error: HTTPErrorResponse,
    context: APIErrorRetryContext,
  ): Promise<boolean> {
    if (!this.refreshSessionHandler) {
      return false;
    }

    if (this.shouldAttemptRefreshHandler) {
      try {
        return await this.shouldAttemptRefreshHandler(error, context);
      } catch {
        return false;
      }
    }

    return error.statusCode === 401 || error.statusCode === 405;
  }

  private static async refreshAuthSession(): Promise<boolean> {
    if (!this.refreshSessionHandler) {
      return false;
    }

    if (!this.refreshSessionPromise) {
      this.refreshSessionPromise = this.refreshSessionHandler()
        .then((result: boolean) => {
          return result;
        })
        .catch(() => {
          return false;
        })
        .finally(() => {
          this.refreshSessionPromise = null;
        });
    }

    try {
      return await this.refreshSessionPromise;
    } catch {
      return false;
    }
  }

  private static handleRefreshFailure(error: HTTPErrorResponse): void {
    if (this.refreshFailureHandler) {
      try {
        this.refreshFailureHandler(error);
      } catch {
        // no-op if handler throws
      }
    }
  }

  protected static getLoginRoute(): Route {
    return new Route("/accounts/login");
  }

  protected static getForbiddenRoute(): Route {
    return new Route("/accounts/forbidden");
  }

  public static getFriendlyMessage(
    err: HTTPErrorResponse | Exception | unknown,
  ): string {
    if (err instanceof HTTPErrorResponse) {
      if (err.statusCode === 502) {
        return "Error connecting to server. Please try again in few minutes.";
      }

      if (err.statusCode === 504) {
        return "Error connecting to server. Please try again in few minutes.";
      }

      return err.message;
    }

    return err?.toString() || "Server Error. Please try again";
  }
}

export default BaseAPI;
