import RouteMap from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { toFeedbackPage } from "Common/Types/ProductFeedback/ProductFeedback";
import { getProductFeedbackGitHubIssueUrl } from "Common/Types/ProductFeedback/NewGitHubIssue";
import { matchPath } from "react-router-dom";

/*
 * WHAT AN ANSWER IS SENT WITH, FROM THE DASHBOARD (issue #6832).
 *
 * The page a person was on, as the pattern of the Dashboard route it
 * matched - `/dashboard/:projectId/monitors/:id` - never the address
 * itself, which names the project and the record. A route this cannot
 * match is scrubbed instead (toFeedbackPage): every id, number and value
 * becomes `:id`. App.tsx hands this to ProductFeedback.setPageResolver.
 */

let routePatterns: Array<string> | null = null;

const getRoutePatterns: () => Array<string> = (): Array<string> => {
  if (!routePatterns) {
    routePatterns = Object.values(RouteMap)
      .filter((route: Route | undefined): route is Route => {
        return Boolean(route);
      })
      .map((route: Route): string => {
        return route.toString();
      })
      .filter((pattern: string): boolean => {
        return pattern.startsWith("/");
      });
  }

  return routePatterns;
};

const countParameters: (pattern: string) => number = (
  pattern: string,
): number => {
  return (pattern.match(/[:*]/g) || []).length;
};

/*
 * The route pattern a path matched: of the routes that match, the one with
 * the fewest parameters (so `/monitors/create` is not read as a monitor
 * whose id is "create").
 */
export const getFeedbackPageFor: (
  pathname: string,
  patterns?: ReadonlyArray<string> | undefined,
) => string = (
  pathname: string,
  patterns?: ReadonlyArray<string> | undefined,
): string => {
  const path: string = pathname.split(/[?#]/)[0] || "/";
  let best: string | null = null;

  for (const pattern of patterns || getRoutePatterns()) {
    let isMatch: boolean = false;

    try {
      isMatch = Boolean(matchPath({ path: pattern, end: true }, path));
    } catch {
      isMatch = false;
    }

    if (
      isMatch &&
      (best === null || countParameters(pattern) < countParameters(best))
    ) {
      best = pattern;
    }
  }

  return toFeedbackPage(best || path);
};

// The page this tab is on, as an answer is sent with it.
export const getCurrentFeedbackPage: () => string = (): string => {
  try {
    return getFeedbackPageFor(window.location.pathname);
  } catch {
    return "/";
  }
};

/*
 * "Also tell OneUptime on GitHub", on a self-hosted server: a new issue
 * with the person's words, the page and the version filled in, which they
 * read on GitHub before sending it, or not. The issue is GitHub's, not a
 * Dashboard page's, so its English is worded beside the issue builder
 * (getProductFeedbackGitHubIssueUrl), as the maintainers read the issues.
 */
export const getFeedbackGitHubIssueUrl: (data: {
  details: string;
  page: string;
  version: string;
}) => string = getProductFeedbackGitHubIssueUrl;
