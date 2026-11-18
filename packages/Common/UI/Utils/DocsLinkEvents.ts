import Navigation from "./Navigation";
import ProductEvents from "./ProductEvents";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import { ProductEventName } from "../../Types/Analytics/ProductEvent";
import { isSupportedDocsLanguage } from "../../Types/Docs/DocsLanguage";

/*
 * A DOCS PAGE OPENED FROM THE PRODUCT (issue #7207): which pages of the
 * product send people to the docs, and to which docs page.
 *
 * Sent as `docs/link_opened` (Types/Analytics/ProductEvent) by the three
 * ways the Dashboard opens the docs: a form's "Learn more" (LearnMoreLink,
 * source learn_more), a list's or a card's View Documentation
 * (view_documentation) and a docs result of Search, Cmd/Ctrl+K (search).
 * It carries the docs page and where it was opened from, nothing else, and
 * goes where every Dashboard event goes: to product analytics only where it
 * is set up (OneUptime Cloud), with the visitor's consent
 * (Utils/ProductEvents). A self-hosted server sends nothing.
 */

export enum DocsLinkSource {
  LearnMore = "learn_more",
  ViewDocumentation = "view_documentation",
  Search = "search",
}

const DOCS_PATH_START: string = "/docs/";

/*
 * The docs page an address opens - its path under /docs/, without the
 * language, the anchor or the query: "on-call/escalation-rules" - or null
 * for an address that opens no docs page.
 */
export const getDocsPageOfLink: (href: string) => string | null = (
  href: string,
): string | null => {
  /*
   * The docs are served at /docs on this OneUptime's own host (Config's
   * DOCS_URL), which may be written without one: the path is read from
   * where /docs/ starts.
   */
  const start: number = href.indexOf(DOCS_PATH_START);

  if (start < 0) {
    return null;
  }

  const path: string =
    href.slice(start + DOCS_PATH_START.length).split(/[?#]/)[0] || "";

  const segments: Array<string> = path
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });

  if (segments.length > 0 && isSupportedDocsLanguage(segments[0]!)) {
    segments.shift();
  }

  return segments.length > 0 ? segments.join("/") : null;
};

// Sends docs/link_opened for an address that opens a docs page; nothing else.
export const recordDocsLinkOpened: (data: {
  href: string;
  source: DocsLinkSource;
}) => void = (data: { href: string; source: DocsLinkSource }): void => {
  const page: string | null = getDocsPageOfLink(data.href);

  if (!page) {
    return;
  }

  ProductEvents.send(ProductEventName.DocsLinkOpened, {
    page: page,
    source: data.source,
  });
};

/*
 * A list's or a card's View Documentation (ModelTable, CardModelDetail):
 * opens its docs page in a new tab, and says which (view_documentation).
 */
export const openDocumentationLink: (link: Route | URL) => void = (
  link: Route | URL,
): void => {
  recordDocsLinkOpened({
    href: link.toString(),
    source: DocsLinkSource.ViewDocumentation,
  });

  Navigation.navigate(link, {
    openInNewTab: true,
  });
};
