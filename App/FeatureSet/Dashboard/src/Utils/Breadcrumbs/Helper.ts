import RouteMap, { RouteUtil } from "../RouteMap";
import Route from "Common/Types/API/Route";
import Dictionary from "Common/Types/Dictionary";
import Link from "Common/Types/Link";
import Navigation from "Common/UI/Utils/Navigation";
import {
  BreadcrumbTarget,
  BreadcrumbTargetKind,
  normalizeRoutePath,
  resolveBreadcrumbTarget,
} from "Common/UI/Utils/Breadcrumb/BreadcrumbTrailResolver";

export function BuildBreadcrumbLinks(
  key: string,
  breadcrumpLinks: Link[],
): Dictionary<Link[]> {
  return {
    [RouteUtil.getRouteString(key)]: breadcrumpLinks,
  };
}

/*
 * All real, navigable route patterns (with `:param` placeholders), in
 * declaration order. Mount points that only exist to nest child routers (their
 * path ends in `/*`) are not pages themselves and are excluded — navigating to
 * one renders nothing. Computed once; RouteMap is static.
 */
let cachedRealRoutePatterns: Array<string> | undefined;

function getRealRoutePatterns(): Array<string> {
  if (!cachedRealRoutePatterns) {
    cachedRealRoutePatterns = Object.values(RouteMap)
      .map((route: Route) => {
        return route.toString();
      })
      .filter((pattern: string) => {
        return !pattern.endsWith("/*");
      })
      .map(normalizeRoutePath);
  }
  return cachedRealRoutePatterns;
}

/*
 * Translate a resolved breadcrumb target descriptor into a concrete, navigable
 * route in the live location. See BreadcrumbTrailResolver for the decision
 * logic — this only maps the descriptor to a Route.
 */
function breadcrumbTargetToRoute(target: BreadcrumbTarget): Route {
  switch (target.kind) {
    case BreadcrumbTargetKind.Home:
      // Project home: URL truncated to its first 3 segments.
      return Navigation.getBreadcrumbRoute(1);

    case BreadcrumbTargetKind.CurrentPage:
      /*
       * The current page. Returned as the live path so the Breadcrumbs
       * component recognizes it as the current page and renders it as plain
       * text rather than a link.
       */
      return Navigation.getCurrentPath();

    case BreadcrumbTargetKind.Ancestor:
      // depth is the number of URL segments to keep (level = depth - 2).
      return Navigation.getBreadcrumbRoute((target.depth ?? 3) - 2);

    case BreadcrumbTargetKind.SectionLanding: {
      /*
       * A real page on a different branch. Fill the project id from the current
       * context. If any other param is left unresolved the target would be
       * broken, so fall back to plain text (the current page) instead.
       */
      if (!target.routePattern) {
        return Navigation.getCurrentPath();
      }
      const populated: Route = RouteUtil.populateRouteParams(
        new Route(target.routePattern),
      );
      if (populated.toString().includes(":")) {
        return Navigation.getCurrentPath();
      }
      return populated;
    }

    default:
      return Navigation.getCurrentPath();
  }
}

/*
 * Build breadcrumb links from a list of titles, resolving each crumb's
 * destination so it always points at a real, navigable route (never a bare
 * section prefix that would render a blank page).
 */
export function BuildBreadcrumbLinksByTitles(
  key: string,
  titles: Array<string>,
): Dictionary<Link[]> {
  const pagePattern: string = RouteUtil.getRouteString(key);
  const realRoutePatterns: Array<string> = getRealRoutePatterns();

  return {
    [RouteUtil.getRouteString(key)]: titles.map(
      (title: string, index: number): Link => {
        const target: BreadcrumbTarget = resolveBreadcrumbTarget({
          index,
          crumbCount: titles.length,
          pagePattern,
          realRoutePatterns,
        });
        return {
          title,
          to: breadcrumbTargetToRoute(target),
        };
      },
    ),
  };
}
