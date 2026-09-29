import Hostname from "../../Types/API/Hostname";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import {
  Location,
  NavigateFunction,
  Params,
  matchRoutes,
} from "react-router-dom";

abstract class Navigation {
  private static navigateHook: NavigateFunction;
  private static location: Location;
  private static params: Params;

  public static setNavigateHook(navigateHook: NavigateFunction): void {
    this.navigateHook = navigateHook;
  }

  public static setLocation(location: Location): void {
    this.location = location;
  }

  public static setParams(params: Params): void {
    this.params = params;
  }

  public static getParams(): Params {
    return this.params;
  }

  public static getCurrentPath(): Route {
    return new Route(window.location.pathname);
  }

  public static getBreadcrumbRoute(level: number): Route {
    const paths: Array<string> = this.location.pathname.split("/");
    // +2 because we want to include the first 2 paths which are empty, dashboard and project id
    const indexToSplice: number = level + 2;
    return new Route(paths.splice(0, indexToSplice).join("/"));
  }

  public static getRoutePath(routes: Array<{ path: string }>): string {
    const pathes: ReturnType<typeof matchRoutes> = matchRoutes(
      routes,
      this.location.pathname,
    );
    return pathes?.[0]?.route.path || "";
  }

  /**
   * The raw query string of the current URL, including the leading "?" when
   * non-empty (i.e. exactly `window.location.search`). Reading it through
   * Navigation keeps callers testable and consistent with
   * {@link setQueryString}, which also works off `window.location`.
   */
  public static getQueryString(): string {
    return window.location.search;
  }

  public static getQueryStringByName(paramName: string): string | null {
    const urlSearchParams: URLSearchParams = new URLSearchParams(
      window.location.search,
    );
    const params: Dictionary<string> = Object.fromEntries(
      urlSearchParams.entries(),
    );
    if (params && params[paramName]) {
      return params[paramName] as string;
    }

    return null;
  }

  /**
   * Update (or remove) query-string params on the current URL *in place*,
   * without pushing a new browser-history entry and without triggering a
   * react-router navigation/re-render. Pass `null` (or "") as a value to
   * delete that param.
   *
   * This is used to keep table filter/facet state in the URL so it survives
   * navigating to a detail page and back, and so a filtered view is
   * shareable/bookmarkable. We use `replaceState` (not push) so changing a
   * filter doesn't flood the back-button history.
   */
  public static setQueryString(params: Dictionary<string | null>): void {
    const urlSearchParams: URLSearchParams = new URLSearchParams(
      window.location.search,
    );

    for (const paramName in params) {
      const value: string | null =
        params[paramName] === undefined
          ? null
          : (params[paramName] as string | null);

      if (value === null || value === "") {
        urlSearchParams.delete(paramName);
      } else {
        urlSearchParams.set(paramName, value);
      }
    }

    const queryString: string = urlSearchParams.toString();

    const newRelativeUrl: string =
      window.location.pathname +
      (queryString ? `?${queryString}` : "") +
      window.location.hash;

    try {
      window.history.replaceState(window.history.state, "", newRelativeUrl);
    } catch {
      /*
       * Safari throws SecurityError when replaceState is called >100
       * times / 30s (e.g. fast typing into a URL-synced search box).
       * React state stays authoritative; the URL re-syncs on the next
       * successful write.
       */
    }
  }

  public static getParamByName(
    paramName: string,
    routeTemplate: Route,
  ): string | null {
    const currentPath: Array<string> = this.location.pathname.split("/");

    if (!paramName.startsWith(":")) {
      paramName = ":" + paramName;
    }

    const routeParamTemplateIndex: number = routeTemplate
      .toString()
      .split("/")
      .indexOf(paramName);

    if (routeParamTemplateIndex === -1) {
      throw new BadDataException(
        `Param ${paramName} not found in template ${routeTemplate.toString()}`,
      );
    }

    if (currentPath[routeParamTemplateIndex]) {
      return currentPath[routeParamTemplateIndex] as string;
    }

    return null;
  }

  public static getLastParam(getFromLastRoute?: number): Route | null {
    return URL.fromString(window.location.href).getLastRoute(getFromLastRoute);
  }

  public static getFirstParam(getFromFirstRoute?: number): string | undefined {
    const pathname: string = window.location.pathname;

    return pathname.split("/")[getFromFirstRoute || 1];
  }

  public static getLastParamAsString(getFromLastRoute?: number): string {
    const param: Route | null = URL.fromString(
      window.location.href,
    ).getLastRoute(getFromLastRoute);

    return param?.toString().replace("/", "") || "";
  }

  public static getLastParamAsObjectID(getFromLastRoute?: number): ObjectID {
    return new ObjectID(this.getLastParamAsString(getFromLastRoute));
  }

  public static getCurrentRoute(): Route {
    /*
     * The router hands us its location once it has rendered. An API error can
     * be handled before that (or outside a router altogether), and the address
     * bar is the same answer then.
     */
    if (!this.location) {
      return new Route(window.location.pathname);
    }

    return new Route(this.location.pathname);
  }

  public static getHostname(): Hostname {
    return new Hostname(window.location.hostname);
  }

  public static getCurrentURL(): URL {
    return URL.fromString(window.location.href);
  }

  public static reload(): void {
    window.location.reload();
  }

  public static containsInPath(text: string): boolean {
    return window.location.pathname.includes(text);
  }

  public static isStartWith(route: Route): boolean {
    const current: Route = this.getCurrentRoute();
    const routeItems: Array<string> = route.toString().split("/");
    let anotherRouteItems: Array<string> = current.toString().split("/");

    if (routeItems.length > anotherRouteItems.length) {
      return false;
    }

    anotherRouteItems = anotherRouteItems.splice(0, routeItems.length);

    let start: number = 0;
    let startsWith: boolean = true;
    for (const item of anotherRouteItems) {
      if (routeItems[start]?.startsWith(":") && item) {
        start++;
        continue;
      }

      if (
        !this.isSameSegment(routeItems[start], item, { caseSensitive: false })
      ) {
        startsWith = false;
        break;
      }

      start++;
    }
    return startsWith;
  }

  public static isOnThisPage(route: Route | URL): boolean {
    if (route instanceof Route) {
      return this.isCurrentRoute(route, { caseSensitive: false });
    }

    if (route instanceof URL) {
      const current: URL = this.getCurrentURL();

      if (current.toString() === route.toString()) {
        return true;
      }

      return false;
    }

    return false;
  }

  /*
   * React Router matches paths case-insensitively (a <Route> is case
   * sensitive only when it opts in, and none of ours do), so
   * `/dashboard/<id>/SSO` renders the SSO page. Questions like "is the user
   * on that page?" (hide the nav bar there, mark a side-menu entry active)
   * must agree with the page the router rendered, so they compare segments
   * the same way. Route validation only admits ASCII, so toLowerCase() is
   * exact here.
   *
   * A Route whose parameters are already filled in carries no ":" segments,
   * so its parameter values are compared without case too. The values
   * checked this way today are ids, where case does not matter, but these
   * checks cannot tell apart two resources whose names differ only by case.
   * navigate() keeps the exact comparison for that reason.
   */
  private static isSameSegment(
    routeSegment: string | undefined,
    currentSegment: string,
    options: { caseSensitive: boolean },
  ): boolean {
    if (routeSegment === undefined) {
      return false;
    }

    if (options.caseSensitive) {
      return routeSegment === currentSegment;
    }

    return routeSegment.toLowerCase() === currentSegment.toLowerCase();
  }

  private static isCurrentRoute(
    route: Route,
    options: { caseSensitive: boolean },
  ): boolean {
    const current: Route = this.getCurrentRoute();

    /*
     * React Router resolves `/page` and `/page/` to the same route. Match
     * that behavior here so side-menu selection and the compact mobile
     * label do not disappear when a bookmarked URL carries a trailing
     * slash. Keep `/` intact so the root route still has a segment.
     */
    const trimTrailingSlashes: (path: string) => string = (
      path: string,
    ): string => {
      return path.length > 1 ? path.replace(/\/+$/, "") : path;
    };
    const routeItems: Array<string> = trimTrailingSlashes(
      route.toString(),
    ).split("/");
    const currentPathItems: Array<string> = trimTrailingSlashes(
      current.toString(),
    ).split("/");
    if (routeItems.length !== currentPathItems.length) {
      return false;
    }

    let start: number = 0;
    for (const item of currentPathItems) {
      if (routeItems[start]?.startsWith(":") && item) {
        start++;
        continue;
      }

      if (!this.isSameSegment(routeItems[start], item, options)) {
        return false;
      }

      start++;
    }

    return true;
  }

  public static goBack(): void {
    this.navigateHook(-1);
  }

  /**
   * Return whether a value is an unambiguous same-origin path. Redirect
   * targets must be paths rather than URLs so schemes, protocol-relative
   * values, and backslash authority tricks can never reach a browser
   * navigation sink.
   */
  public static isSafeInternalRoute(route: Route | string): boolean {
    const routeValue: string = route.toString();

    if (
      !routeValue.startsWith("/") ||
      routeValue.startsWith("//") ||
      routeValue.includes("\\")
    ) {
      return false;
    }

    try {
      /*
       * URL accepts characters that Route deliberately rejects. Validate the
       * exact sink contract here so a value marked safe cannot crash later
       * when a caller constructs the Route used for navigation.
       */
      new Route(routeValue);

      const parsedUrl: globalThis.URL = new window.URL(
        routeValue,
        window.location.origin,
      );

      return parsedUrl.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  public static navigate(
    to: Route | URL,
    options?: {
      openInNewTab?: boolean | undefined;
      forceNavigate?: boolean | undefined;
    },
  ): void {
    const finalUrl: string = to.toString();

    // add query params if they exist.

    if (options?.openInNewTab) {
      // open in new tab
      window.open(finalUrl, "_blank");
      return;
    }

    if (options?.forceNavigate && to instanceof Route) {
      if (!this.isSafeInternalRoute(to)) {
        throw new BadDataException(
          `Cannot force navigate to a non-internal route: ${finalUrl}`,
        );
      }

      window.location.href = finalUrl;
      return;
    }

    /*
     * Exact, unlike isOnThisPage: a target can differ from the current path
     * only in the case of a parameter value (a container named "Web" vs
     * "web"), which React Router passes through as-is, so it is a different
     * page, and dropping that navigation would strand the user.
     */
    if (
      this.navigateHook &&
      to instanceof Route &&
      !this.isCurrentRoute(to, { caseSensitive: true })
    ) {
      this.navigateHook(finalUrl);
    }

    // if its an external link outside of react.
    if (to instanceof URL) {
      window.location.href = finalUrl;
    }
  }
}

export default Navigation;
