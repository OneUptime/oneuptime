import RouteMap from "../../Utils/RouteMap";
import RouteParams from "../../Utils/RouteParams";
import Route from "Common/Types/API/Route";
import {
  AIChatCitation,
  AIChatCitationTarget,
  AIChatCitationTargetType,
} from "Common/Types/AI/AIChatTypes";
import ObjectID from "Common/Types/ObjectID";
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
 * A page of one record (#7065) - this status page's Custom Domains - is a
 * route that also waits for the record's id: the citation carries the id
 * the server read the record by, with the person's own permissions, and
 * the route is opened only with an id that is one.
 *
 * React-free, so App's tests read the same rules.
 */

// What a query string or an anchor a page link carries may hold.
const SAFE_SUFFIX: RegExp = /^[\w\-.=&%]*$/;
const DOCS_PAGE: RegExp = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;
const DOCS_ANCHOR: RegExp = /^[\p{L}\p{N}_-]+$/u;

// The most of a record's name a button draws.
const MAX_RECORD_TITLE_CHARS: number = 200;

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

// Whether `value` is a record's id: an ObjectID, never a word a route could read.
const isRecordId: (value: unknown) => value is string = (
  value: unknown,
): value is string => {
  return typeof value === "string" && ObjectID.isValidUUID(value);
};

/*
 * Whether `path` is one of the Dashboard's own pages: a route template of
 * RouteMap that waits for nothing but the project, with at most a plain
 * query string and anchor. Given a record's id, a page of that record is
 * one too: a route that waits for the project and the record's id once
 * each (RouteParams.ModelID), and nothing else.
 */
export const isDashboardRouteTemplate: (
  path: unknown,
  options?: { recordId?: unknown } | undefined,
) => boolean = (
  path: unknown,
  options?: { recordId?: unknown } | undefined,
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
  const params: Array<string> = route
    .split("/")
    .filter((segment: string): boolean => {
      return segment.includes(":");
    });
  const allowed: Array<string> = isRecordId(options?.recordId)
    ? [RouteParams.ProjectID, RouteParams.ModelID]
    : [RouteParams.ProjectID];
  const waitsForAllowedOnly: boolean =
    params.every((param: string): boolean => {
      return allowed.includes(param);
    }) && new Set<string>(params).size === params.length;

  return (
    getRouteTemplates().has(route) &&
    waitsForAllowedOnly &&
    SAFE_SUFFIX.test(query) &&
    SAFE_SUFFIX.test(anchor)
  );
};

/*
 * The record a DashboardPage citation opens a page of (#7065), by its id,
 * or undefined: only for a route that waits for one, and an id that is one.
 */
export const getDashboardPageRecordId: (
  target: AIChatCitationTarget | undefined,
) => string | undefined = (
  target: AIChatCitationTarget | undefined,
): string | undefined => {
  if (target?.type !== AIChatCitationTargetType.DashboardPage) {
    return undefined;
  }

  const path: string | undefined = target.params?.["path"];
  const recordId: string | undefined = target.params?.["recordId"];

  if (
    typeof path !== "string" ||
    !path.split(/[?#]/)[0]!.split("/").includes(RouteParams.ModelID) ||
    !isRecordId(recordId)
  ) {
    return undefined;
  }

  return recordId;
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

  return isDashboardRouteTemplate(path, {
    recordId: getDashboardPageRecordId(target),
  })
    ? path
    : undefined;
};

/*
 * The name of the record a DashboardPage citation opens a page of, as the
 * server read it for the person (#7065), trimmed, or undefined.
 */
export const getDashboardPageRecordTitle: (
  target: AIChatCitationTarget | undefined,
) => string | undefined = (
  target: AIChatCitationTarget | undefined,
): string | undefined => {
  if (!getDashboardPageRecordId(target)) {
    return undefined;
  }

  const title: unknown = target?.params?.["recordTitle"];

  if (typeof title !== "string") {
    return undefined;
  }

  const trimmed: string = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_RECORD_TITLE_CHARS);

  return trimmed || undefined;
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
  // The page's English title, as Search names it.
  title: string;
  /*
   * The locale key the button draws its title by, in the reader's
   * language: the citation's titleKey, where the page's key names its
   * meaning ("Insights (explorer analytics)", #8817), or its title.
   */
  titleKey: string;
  /*
   * Where titleKey is a template, what fills it once it is translated:
   * another product's name, as written ("Import from {{tool}}" with {
   * tool: "PagerDuty" }, #8834).
   */
  titleValues?: Record<string, string> | undefined;
  /*
   * For a page of one record (#7065), the record's name as the server
   * read it for the person: "Acme Status", drawn beside the page's name.
   */
  recordTitle?: string | undefined;
  target: AIChatCitationTarget;
}

const CITATION_MARK: RegExp = /\[(C\d+)\]/g;

// The most values a title's template takes, and how long each may be.
const MAX_TITLE_VALUES: number = 5;
const MAX_TITLE_VALUE_CHARS: number = 100;
// A value's name, as a template's {{placeholder}} names it.
const TITLE_VALUE_NAME: RegExp = /^\w+$/;

/*
 * The values a citation's titleValues names, as JSON, when it is an
 * object of a few short texts; otherwise none, and the button draws the
 * English title.
 */
export const readTitleValues: (
  json: string | undefined,
) => Record<string, string> | undefined = (
  json: string | undefined,
): Record<string, string> | undefined => {
  if (!json || json.length > 1024) {
    return undefined;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  const entries: Array<[string, unknown]> = Object.entries(parsed);

  if (
    entries.length === 0 ||
    entries.length > MAX_TITLE_VALUES ||
    !entries.every((entry: [string, unknown]): boolean => {
      return (
        TITLE_VALUE_NAME.test(entry[0]) &&
        typeof entry[1] === "string" &&
        entry[1].trim().length > 0 &&
        entry[1].length <= MAX_TITLE_VALUE_CHARS
      );
    })
  ) {
    return undefined;
  }

  return Object.fromEntries(entries) as Record<string, string>;
};

/*
 * The Dashboard pages an answer sends the reader to: each DashboardPage
 * citation the answer's text cites, that opens one of the Dashboard's own
 * pages, once, in the order the answer names them - drawn under it as
 * buttons. A page the model looked up but did not cite is not one. The
 * same page of two records is two pages.
 */
export const getAnswerPageLinks: (
  text: string,
  citations: ReadonlyArray<AIChatCitation>,
) => Array<AskAiAnswerPageLink> = (
  text: string,
  citations: ReadonlyArray<AIChatCitation>,
): Array<AskAiAnswerPageLink> => {
  const links: Array<AskAiAnswerPageLink> = [];
  const seenPages: Set<string> = new Set<string>();

  for (const match of text.matchAll(CITATION_MARK)) {
    const citation: AIChatCitation | undefined = citations.find(
      (candidate: AIChatCitation): boolean => {
        return candidate.id === match[1];
      },
    );
    const path: string | undefined = getDashboardPageTemplate(citation?.target);
    const recordId: string | undefined = getDashboardPageRecordId(
      citation?.target,
    );
    const pageKey: string = `${path || ""} ${recordId || ""}`;

    if (!citation || !path || seenPages.has(pageKey)) {
      continue;
    }

    seenPages.add(pageKey);

    const title: string = citation.target?.params?.["title"] || citation.label;
    const titleKey: string | undefined = citation.target?.params?.["titleKey"];
    const titleValues: Record<string, string> | undefined = titleKey
      ? readTitleValues(citation.target?.params?.["titleValues"])
      : undefined;
    const recordTitle: string | undefined = getDashboardPageRecordTitle(
      citation.target,
    );

    links.push({
      citationId: citation.id,
      title,
      titleKey: titleKey || title,
      ...(titleValues ? { titleValues } : {}),
      ...(recordTitle ? { recordTitle } : {}),
      target: citation.target!,
    });
  }

  return links;
};
