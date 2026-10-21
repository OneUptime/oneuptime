import Markdown, { MarkdownContentType } from "Common/Server/Types/Markdown";
import DocsNav, { NavGroup, NavLink } from "./Nav";
import {
  DOCS_DEFAULT_ICON,
  DOCS_EXTERNAL_LINK_ICON,
  getDocsNavIcon,
} from "./NavIcons";
import {
  DEFAULT_DOCS_LANGUAGE,
  isSupportedDocsLanguage,
  makeT,
  TranslateFn,
} from "./I18n";

export interface DocsRenderOptions {
  // The language the page is served in: in-content links stay in it.
  lang?: string | undefined;
  /*
   * The language the markdown is written in: English when the page has no
   * translation yet. Labels the renderer adds (a callout's "Note") follow
   * the text around them.
   */
  contentLang?: string | undefined;
}

/*
 * Which UI string replaces a default label the renderer marked with
 * data-docs-label (see Common/Server/Types/MarkdownDocsExtensions.ts).
 */
const LABEL_KEYS: Record<string, string> = {
  note: "calloutNote",
  tip: "calloutTip",
  info: "calloutInfo",
  important: "calloutImportant",
  warning: "calloutWarning",
  caution: "calloutCaution",
  danger: "calloutDanger",
  details: "detailsSummary",
};

// A link that leaves this site.
const EXTERNAL_URL: RegExp = /^https?:\/\//i;

// First path segments under /docs/ that are not pages.
const NON_PAGE_SEGMENTS: Array<string> = [
  "static",
  "as-markdown",
  "llms.txt",
  "llms-full.txt",
];

const escapeHtml: (text: string) => string = (text: string): string => {
  return Markdown.escapeHtml(text);
};

/*
 * "/docs/<category>/<page>" for a link to a docs page written without a
 * language, with any #anchor or ?query split off; null for anything else.
 */
const parseDocsPageHref: (
  href: string,
) => { category: string; page: string; rest: string } | null = (
  href: string,
): { category: string; page: string; rest: string } | null => {
  const match: RegExpMatchArray | null = href.match(
    /^\/docs\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/?([?#].*)?$/i,
  );

  if (!match) {
    return null;
  }

  const category: string = match[1]!;

  if (
    isSupportedDocsLanguage(category) ||
    NON_PAGE_SEGMENTS.includes(category.toLowerCase())
  ) {
    return null;
  }

  return { category: category, page: match[2]!, rest: match[3] || "" };
};

/*
 * The nav group a docs URL belongs to: the group listing that exact page, or
 * failing that the first group with a page in the same category.
 */
export const findDocsNavGroupForUrl: (url: string) => NavGroup | null = (
  url: string,
): NavGroup | null => {
  const parsed: { category: string; page: string; rest: string } | null =
    parseDocsPageHref(url);

  if (!parsed) {
    return null;
  }

  const target: string =
    `/docs/${parsed.category}/${parsed.page}`.toLowerCase();

  const exact: NavGroup | undefined = DocsNav.find(
    (group: NavGroup): boolean => {
      return group.links.some((link: NavLink): boolean => {
        return link.url.toLowerCase() === target;
      });
    },
  );

  if (exact) {
    return exact;
  }

  const prefix: string = `/docs/${parsed.category.toLowerCase()}/`;

  return (
    DocsNav.find((group: NavGroup): boolean => {
      return group.links.some((link: NavLink): boolean => {
        return link.url.toLowerCase().startsWith(prefix);
      });
    }) || null
  );
};

const iconForCard: (href: string | null) => string = (
  href: string | null,
): string => {
  if (!href) {
    return DOCS_DEFAULT_ICON;
  }

  if (EXTERNAL_URL.test(href)) {
    return DOCS_EXTERNAL_LINK_ICON;
  }

  const group: NavGroup | null = findDocsNavGroupForUrl(href);

  return group ? getDocsNavIcon(group.title) : DOCS_DEFAULT_ICON;
};

const svgIcon: (paths: string) => string = (paths: string): string => {
  return `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
};

// This class is responsible for rendering markdown content to HTML
export default class DocsRender {
  // Render markdown content to HTML and return the result as a promise
  public static async render(
    markdownContent: string,
    options: DocsRenderOptions = {},
  ): Promise<string> {
    // Use the Markdown library to convert markdown content to HTML
    const html: string = await Markdown.convertToHTML(
      markdownContent,
      MarkdownContentType.Docs,
    );

    return DocsRender.localize(html, options);
  }

  /*
   * What the shared renderer cannot do, because it knows nothing about the
   * docs site: put its default labels into the reader's language, keep links
   * between docs pages in the language the reader is reading, and give each
   * card the icon of the section it points into.
   */
  public static localize(
    html: string,
    options: DocsRenderOptions = {},
  ): string {
    const lang: string = DocsRender.resolveLanguage(options.lang);
    const contentLang: string = DocsRender.resolveLanguage(
      options.contentLang || options.lang,
    );
    const t: TranslateFn = makeT(contentLang);

    let result: string = html.replace(
      /(<span\b[^>]*\bdata-docs-label="([a-z]+)"[^>]*>)([^<]*)(<\/span>)/g,
      (
        whole: string,
        open: string,
        key: string,
        _text: string,
        close: string,
      ): string => {
        const uiKey: string | undefined = LABEL_KEYS[key];
        return uiKey ? `${open}${escapeHtml(t(`ui.${uiKey}`))}${close}` : whole;
      },
    );

    // Cards first: the icon is chosen from the link as the author wrote it.
    result = result.replace(
      /(<a class="docs-card" href="([^"]*)"[^>]*>)<span class="docs-card__icon" aria-hidden="true"><\/span>/g,
      (_whole: string, open: string, href: string): string => {
        return `${open}<span class="docs-card__icon" aria-hidden="true">${svgIcon(iconForCard(DocsRender.unescapeAttribute(href)))}</span>`;
      },
    );

    result = result.replace(
      /(<div class="docs-card docs-card--static">)<span class="docs-card__icon" aria-hidden="true"><\/span>/g,
      (_whole: string, open: string): string => {
        return `${open}<span class="docs-card__icon" aria-hidden="true">${svgIcon(DOCS_DEFAULT_ICON)}</span>`;
      },
    );

    /*
     * A page links to another as /docs/<category>/<page>, with no language.
     * Served as written, that address redirects by the browser's language,
     * so a reader who picked German with an English browser was sent to
     * English by every link in the text. The link goes to the page in the
     * language being read instead.
     */
    if (options.lang) {
      result = result.replace(
        /(<a\b[^>]*?\bhref=")(\/docs\/[^"]*)(")/g,
        (whole: string, before: string, href: string, after: string) => {
          const parsed: {
            category: string;
            page: string;
            rest: string;
          } | null = parseDocsPageHref(DocsRender.unescapeAttribute(href));

          if (!parsed) {
            return whole;
          }

          return `${before}${escapeHtml(`/docs/${lang}/${parsed.category}/${parsed.page}${parsed.rest}`)}${after}`;
        },
      );
    }

    return result;
  }

  private static resolveLanguage(lang: string | undefined): string {
    return lang && isSupportedDocsLanguage(lang) ? lang : DEFAULT_DOCS_LANGUAGE;
  }

  private static unescapeAttribute(value: string): string {
    return value
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  }
}
