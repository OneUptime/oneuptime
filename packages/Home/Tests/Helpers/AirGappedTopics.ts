import {
  getAirGappedContent,
  getAirGappedTopicContent,
} from "../../Utils/AirGapped";
import { AirGappedTopicSlug } from "../../Utils/AirGappedPages";
import { getPageSEO, PageSEOData } from "../../Utils/PageSEO";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import ejs from "ejs";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * The air-gapped product pages (Views/air-gapped-topic.ejs) rendered with the
 * locals Routes.ts hands them, and what their tests read them with: the words
 * and code of an element, and whether a link goes somewhere real.
 */

const HOME: string = path.join(__dirname, "..", "..");
const VIEWS_ROOT: string = path.join(HOME, "Views");
const DOCS_CONTENT: string = path.join(
  HOME,
  "..",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
);

export const HOME_URL: string = "https://oneuptime.com";

export const routesSource: string = fs.readFileSync(
  path.join(HOME, "Routes.ts"),
  "utf8",
);

export type SEOForTemplate = PageSEOData & { fullCanonicalUrl: string };

export const seoFor: (pagePath: string) => SEOForTemplate = (
  pagePath: string,
): SEOForTemplate => {
  const seo: PageSEOData = getPageSEO(pagePath);

  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
};

export const renderView: (
  template: string,
  locals: Record<string, unknown>,
) => Promise<string> = async (
  template: string,
  locals: Record<string, unknown>,
): Promise<string> => {
  return (await ejs.renderFile(path.join(VIEWS_ROOT, template), locals, {
    views: [VIEWS_ROOT],
  })) as string;
};

// Exactly the locals Routes.ts hands a page, plus homeUrl.
export const renderTopic: (
  slug: AirGappedTopicSlug,
) => Promise<string> = async (slug: AirGappedTopicSlug): Promise<string> => {
  const content: ReturnType<typeof getAirGappedTopicContent> =
    getAirGappedTopicContent(slug);

  return renderView("air-gapped-topic.ejs", {
    enableGoogleTagManager: false,
    seo: seoFor(content.path),
    airGappedTopic: content,
    homeUrl: HOME_URL,
  });
};

// The locals Routes.ts hands the hub, plus homeUrl.
export const renderHub: () => Promise<string> = async (): Promise<string> => {
  return renderView("air-gapped.ejs", {
    enableGoogleTagManager: false,
    seo: seoFor("/enterprise/air-gapped"),
    airGapped: getAirGappedContent(),
    homeUrl: HOME_URL,
  });
};

export const documentOf: (html: string) => Document = (
  html: string,
): Document => {
  return new JSDOM(html).window.document;
};

export const textOf: (element: Element | null | undefined) => string = (
  element: Element | null | undefined,
): string => {
  return (element?.textContent || "").split(/\s+/).join(" ").trim();
};

export const all: (root: ParentNode, selector: string) => Array<Element> = (
  root: ParentNode,
  selector: string,
): Array<Element> => {
  return Array.from(root.querySelectorAll(selector));
};

// What an element draws as code, in order.
export const codeIn: (element: Element | null | undefined) => Array<string> = (
  element: Element | null | undefined,
): Array<string> => {
  return element ? all(element, "code").map(textOf) : [];
};

// The words a string writes as code: those between each pair of backticks.
export const codeSpansOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return text.split("`").filter((_part: string, index: number): boolean => {
    return index % 2 === 1;
  });
};

// Every string in a value, wherever it sits in it.
export const stringsOf: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap(stringsOf);
  }

  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(stringsOf);
  }

  return [];
};

// The source of the app.get( that registers a path, up to the next app.get(.
export const bodyOfGetRoute: (routePath: string) => string | null = (
  routePath: string,
): string | null => {
  const declaration: string = `"${routePath}"`;
  let searchFrom: number = 0;

  while (searchFrom < routesSource.length) {
    const index: number = routesSource.indexOf(declaration, searchFrom);

    if (index === -1) {
      return null;
    }

    if (
      routesSource
        .slice(Math.max(0, index - 40), index)
        .trim()
        .endsWith("app.get(")
    ) {
      const rest: string = routesSource.slice(index + declaration.length);
      const next: number = rest.indexOf("app.get(");

      return next === -1 ? rest : rest.slice(0, next);
    }

    searchFrom = index + declaration.length;
  }

  return null;
};

/*
 * A markdown heading's text, or null for a line that is no heading: string
 * steps rather than a pattern, so it stays linear in the line's length.
 */
const headingText: (line: string) => string | null = (
  line: string,
): string | null => {
  let level: number = 0;

  while (level < line.length && line[level] === "#") {
    level++;
  }

  if (level === 0 || level > 6 || line[level] !== " ") {
    return null;
  }

  return line.slice(level).trim() || null;
};

// The anchors a docs page answers to: its headings, slugged as the docs do.
const docsAnchors: (markdownFile: string) => Set<string> = (
  markdownFile: string,
): Set<string> => {
  const anchors: Set<string> = new Set<string>();
  let inFence: boolean = false;

  for (const line of fs.readFileSync(markdownFile, "utf8").split("\n")) {
    const trimmed: string = line.trimStart();

    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }

    const heading: string | null = inFence ? null : headingText(line);

    if (heading) {
      anchors.add(slugifyMarkdownHeading(heading));
    }
  }

  return anchors;
};

/*
 * Where a link goes, checked: a docs page at a heading it has, a route of this
 * site, an anchor of the page it is on, or an address the hub answers. Null
 * when it goes somewhere real, otherwise what is wrong with it.
 */
export const problemWithLink: (
  page: Document,
  href: string,
  hub?: Document,
) => string | null = (
  page: Document,
  href: string,
  hub?: Document,
): string | null => {
  if (href.startsWith("#")) {
    return page.getElementById(href.slice(1)) ? null : "no such anchor";
  }

  if (href.startsWith("mailto:")) {
    return null;
  }

  const [address, anchor] = href.split("#") as [string, string | undefined];

  if (address.startsWith("/docs/")) {
    const file: string = path.join(
      DOCS_CONTENT,
      `${address.slice("/docs/".length)}.md`,
    );

    if (!fs.existsSync(file)) {
      return "no such docs page";
    }

    return anchor && !docsAnchors(file).has(anchor)
      ? "no such heading on the docs page"
      : null;
  }

  if (bodyOfGetRoute(address) === null) {
    return "no route";
  }

  if (anchor && address === "/enterprise/air-gapped") {
    return hub?.getElementById(anchor) ? null : "no such anchor on the hub";
  }

  return null;
};
