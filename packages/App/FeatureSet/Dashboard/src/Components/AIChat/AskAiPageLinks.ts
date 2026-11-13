import RouteMap from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  AIChatCitation,
  AIChatCitationTarget,
  AIChatCitationTargetType,
} from "Common/Types/AI/AIChatTypes";
import { getDocsPagePath } from "Common/Types/Docs/DocsLanguage";

/*
 * WHERE AN ASK AI ANSWER TAKES YOU (issue #6828).
 *
 * An answer to "how do I...?" cites the docs page it was read from and
 * ends with the page of this project where it is done. Both are citations
 * the server minted from its own lists - the docs it serves, the catalog
 * generated from Search's page index - never an address the model wrote.
 * Still, nothing here opens what it has not checked itself: a Dashboard
 * page only when its route is one of RouteMap's, in this project, and a
 * docs page only when its address is a docs page's shape.
 *
 * React-free, so App's tests read the same rules.
 */

// What a query string or an anchor a page link carries may hold.
const SAFE_SUFFIX: RegExp = /^[\w\-.=&%]*$/;
const DOCS_PAGE: RegExp = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;
const DOCS_ANCHOR: RegExp = /^[\p{L}\p{N}_-]+$/u;

let routeTemplates: Set<string> | null = null;

const getRouteTemplates: () => Set<string> = (): Set<string> => {
  if (!routeTemplates) {
    routeTemplates = new Set<string>(
      Object.values(RouteMap).map((route: Route): string => {
        return route.toString();
      }),
    );
  }
  return routeTemplates;
};

/*
 * Whether `path` is one of the Dashboard's own pages: a route template of
 * RouteMap that waits for nothing but the project, with at most a plain
 * query string and anchor.
 */
export const isDashboardRouteTemplate: (path: unknown) => boolean = (
  path: unknown,
): boolean => {
  if (typeof path !== "string" || path.length === 0 || path.length > 512) {
    return false;
  }

  const match: RegExpMatchArray | null = path.match(
    /^([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/,
  );

  if (!match) {
    return false;
  }

  const route: string = match[1] || "";
  const query: string = match[2] || "";
  const anchor: string = match[3] || "";

  return (
    getRouteTemplates().has(route) &&
    !route.replace(":projectId", "").includes(":") &&
    SAFE_SUFFIX.test(query) &&
    SAFE_SUFFIX.test(anchor)
  );
};

// The Dashboard page a DashboardPage citation opens, as a route template, or undefined.
export const getDashboardPageTemplate: (
  target: AIChatCitationTarget | undefined,
) => string | undefined = (
  target: AIChatCitationTarget | undefined,
): string | undefined => {
  if (target?.type !== AIChatCitationTargetType.DashboardPage) {
    return undefined;
  }

  const path: string | undefined = target.params?.["path"];

  return isDashboardRouteTemplate(path) ? path : undefined;
};

/*
 * The docs page a DocsPage citation opens, as its address under the docs
 * ("/docs/de/monitor/website-monitor#test-it"), or undefined.
 */
export const getDocsPageAddress: (
  target: AIChatCitationTarget | undefined,
) => string | undefined = (
  target: AIChatCitationTarget | undefined,
): string | undefined => {
  if (target?.type !== AIChatCitationTargetType.DocsPage) {
    return undefined;
  }

  const page: string | undefined = target.params?.["page"];
  const anchor: string | undefined = target.params?.["anchor"];

  if (!page || !DOCS_PAGE.test(page) || page.length > 256) {
    return undefined;
  }

  const address: string = getDocsPagePath(page, target.params?.["language"]);

  return anchor && DOCS_ANCHOR.test(anchor) && anchor.length <= 256
    ? `${address}#${anchor}`
    : address;
};

export interface AskAiAnswerPageLink {
  citationId: string;
  // The page's English title, as Search names it; translated where it is drawn.
  title: string;
  target: AIChatCitationTarget;
}

const CITATION_MARK: RegExp = /\[(C\d+)\]/g;

/*
 * The Dashboard pages an answer sends the reader to: each DashboardPage
 * citation the answer's text cites, that opens one of the Dashboard's own
 * pages, once, in the order the answer names them - drawn under it as
 * buttons. A page the model looked up but did not cite is not one.
 */
export const getAnswerPageLinks: (
  text: string,
  citations: ReadonlyArray<AIChatCitation>,
) => Array<AskAiAnswerPageLink> = (
  text: string,
  citations: ReadonlyArray<AIChatCitation>,
): Array<AskAiAnswerPageLink> => {
  const links: Array<AskAiAnswerPageLink> = [];
  const seenPaths: Set<string> = new Set<string>();

  for (const match of text.matchAll(CITATION_MARK)) {
    const citation: AIChatCitation | undefined = citations.find(
      (candidate: AIChatCitation): boolean => {
        return candidate.id === match[1];
      },
    );
    const path: string | undefined = getDashboardPageTemplate(citation?.target);

    if (!citation || !path || seenPaths.has(path)) {
      continue;
    }

    seenPaths.add(path);
    links.push({
      citationId: citation.id,
      title: citation.target?.params?.["title"] || citation.label,
      target: citation.target!,
    });
  }

  return links;
};
