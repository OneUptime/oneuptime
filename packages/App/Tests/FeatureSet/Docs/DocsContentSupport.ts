import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { DOCS_CONTAINER_NAMES } from "Common/Server/Types/MarkdownDocsExtensions";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import fs from "fs";
import path from "path";

/*
 * Reading the docs' Markdown the way the renderer does, for the tests that
 * hold every page in every language to the same rules: fenced code is
 * opaque, headings become anchors through the renderer's own slugify, and
 * components open with ":::name" and close with ":::".
 */

export const DOCS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs",
);
export const CONTENT_DIR: string = path.join(DOCS_DIR, "Content");
export const STATIC_DIR: string = path.join(DOCS_DIR, "Static");

export const DOCS_LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];
export const TRANSLATED_LANGUAGES: Array<string> = DOCS_LANGUAGES.filter(
  (lang: string): boolean => {
    return lang !== "en";
  },
);

// "category/page" for every page the nav serves, in nav order.
export const NAV_PAGES: Array<string> = DocsNav.flatMap(
  (group: NavGroup): Array<string> => {
    return group.links
      .filter((link: NavLink): boolean => {
        return link.url.startsWith("/docs/");
      })
      .map((link: NavLink): string => {
        return link.url.slice("/docs/".length);
      });
  },
);

const pagesCache: Map<string, Array<string>> = new Map();

// "category/page" for every Markdown file in a language, sorted.
export const listPages: (lang: string) => Array<string> = (
  lang: string,
): Array<string> => {
  const cached: Array<string> | undefined = pagesCache.get(lang);
  if (cached) {
    return cached;
  }

  const root: string = path.join(CONTENT_DIR, lang);
  const pages: Array<string> = [];

  const walk: (dir: string) => void = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full: string = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        pages.push(
          path.relative(root, full).replace(/\\/g, "/").replace(/\.md$/, ""),
        );
      }
    }
  };

  if (fs.existsSync(root)) {
    walk(root);
  }

  pages.sort();
  pagesCache.set(lang, pages);
  return pages;
};

export const hasPage: (lang: string, page: string) => boolean = (
  lang: string,
  page: string,
): boolean => {
  return listPages(lang).includes(page);
};

const pageCache: Map<string, string> = new Map();

export const readPage: (lang: string, page: string) => string = (
  lang: string,
  page: string,
): string => {
  const key: string = `${lang}/${page}`;
  const cached: string | undefined = pageCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const markdown: string = fs.readFileSync(
    path.join(CONTENT_DIR, lang, `${page}.md`),
    "utf8",
  );
  pageCache.set(key, markdown);
  return markdown;
};

export interface DocsFence {
  // The whole info string, e.g. `bash title="install.sh"`.
  info: string;
  // Its first word, lower-cased: the language.
  lang: string;
  code: string;
  line: number;
}

export interface DocsHeading {
  level: number;
  text: string;
  slug: string;
  line: number;
}

export interface DocsLink {
  target: string;
  line: number;
  isImage: boolean;
}

export interface DocsContainerProblem {
  line: number;
  problem: string;
}

export interface DocsContainerUse {
  name: string;
  line: number;
  // For tabs: the labels of its own tabs, in order.
  tabs: Array<string>;
  // For steps: the number of headings at its top level.
  steps: number;
}

export interface ScannedPage {
  lines: Array<string>;
  fences: Array<DocsFence>;
  unclosedFence: boolean;
  headings: Array<DocsHeading>;
  links: Array<DocsLink>;
  containers: Array<DocsContainerUse>;
  containerProblems: Array<DocsContainerProblem>;
  alerts: Array<string>;
  placeholders: Array<string>;
}

const FENCE: RegExp = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CONTAINER_OPEN: RegExp =
  /^( *):{3,}[ \t]*([A-Za-z-]+)(?:[ \t]+(.*?))?[ \t]*$/;
const CONTAINER_CLOSE: RegExp = /^( *):{3,}[ \t]*$/;
const TAB: RegExp = /^ {0,3}@tab[ \t]+(.+?)[ \t]*$/;
const HEADING: RegExp = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
// [text](target "title") and ![alt](src), outside inline code.
const INLINE_LINK: RegExp =
  /(!?)\[(?:\\.|[^\]\\])*\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const REFERENCE_DEFINITION: RegExp = /^ {0,3}\[[^\]]+\]:\s+<?(\S+?)>?(?:\s|$)/;
const ALERT: RegExp = /^ {0,3}>\s*\[!([A-Za-z]+)\]/;
const PLACEHOLDER: RegExp = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

const cache: Map<string, ScannedPage> = new Map();

export const scanPage: (lang: string, page: string) => ScannedPage = (
  lang: string,
  page: string,
): ScannedPage => {
  const key: string = `${lang}/${page}`;
  const cached: ScannedPage | undefined = cache.get(key);
  if (cached) {
    return cached;
  }
  const scanned: ScannedPage = scanMarkdown(readPage(lang, page));
  cache.set(key, scanned);
  return scanned;
};

export const scanMarkdown: (markdown: string) => ScannedPage = (
  markdown: string,
): ScannedPage => {
  const lines: Array<string> = markdown.split("\n");
  const fences: Array<DocsFence> = [];
  const headings: Array<DocsHeading> = [];
  const links: Array<DocsLink> = [];
  const containers: Array<DocsContainerUse> = [];
  const containerProblems: Array<DocsContainerProblem> = [];
  const alerts: Array<string> = [];
  const placeholders: Array<string> = [];
  const stack: Array<DocsContainerUse> = [];

  let fence: {
    marker: string;
    length: number;
    start: number;
    info: string;
  } | null = null;
  let fenceBody: Array<string> = [];

  lines.forEach((line: string, index: number): void => {
    const number: number = index + 1;

    if (fence) {
      const closing: RegExpMatchArray | null = line.match(
        /^ {0,3}(`{3,}|~{3,})[ \t]*$/,
      );
      if (
        closing &&
        closing[1]![0] === fence.marker &&
        closing[1]!.length >= fence.length
      ) {
        fences.push({
          info: fence.info,
          lang: (fence.info.split(/\s+/)[0] || "").toLowerCase(),
          code: fenceBody.join("\n"),
          line: fence.start,
        });
        fence = null;
        fenceBody = [];
      } else {
        fenceBody.push(line);
      }
      return;
    }

    const opening: RegExpMatchArray | null = line.match(FENCE);
    if (opening) {
      fence = {
        marker: opening[1]![0]!,
        length: opening[1]!.length,
        start: number,
        info: opening[2]!.trim(),
      };
      return;
    }

    for (const match of line.matchAll(PLACEHOLDER)) {
      placeholders.push(match[1]!);
    }

    const containerOpen: RegExpMatchArray | null = line.match(CONTAINER_OPEN);
    const containerClose: RegExpMatchArray | null = line.match(CONTAINER_CLOSE);

    if (containerOpen) {
      const name: string = containerOpen[2]!;
      if (containerOpen[1]!.length > 3) {
        containerProblems.push({
          line: number,
          problem: `":::${name}" is indented ${containerOpen[1]!.length} spaces; components are only read at the start of a line (up to 3 spaces)`,
        });
      }
      if (!DOCS_CONTAINER_NAMES.includes(name)) {
        containerProblems.push({
          line: number,
          problem: `":::${name}" is not a component (known: ${DOCS_CONTAINER_NAMES.join(", ")})`,
        });
      }
      const use: DocsContainerUse = {
        name: name,
        line: number,
        tabs: [],
        steps: 0,
      };
      containers.push(use);
      stack.push(use);
      return;
    }

    if (containerClose) {
      if (stack.length === 0) {
        containerProblems.push({
          line: number,
          problem: `":::" closes nothing`,
        });
      } else {
        stack.pop();
      }
      return;
    }

    const tab: RegExpMatchArray | null = line.match(TAB);
    if (tab) {
      const top: DocsContainerUse | undefined = stack[stack.length - 1];
      if (!top || top.name !== "tabs") {
        containerProblems.push({
          line: number,
          problem: `"@tab ${tab[1]}" is not directly inside a :::tabs`,
        });
      } else {
        top.tabs.push(tab[1]!);
      }
      return;
    }

    const heading: RegExpMatchArray | null = line.match(HEADING);
    if (heading) {
      const text: string = heading[2]!.trim();
      headings.push({
        level: heading[1]!.length,
        text: text,
        slug: slugifyMarkdownHeading(text),
        line: number,
      });
      const top: DocsContainerUse | undefined = stack[stack.length - 1];
      if (top && top.name === "steps") {
        top.steps++;
      }
    }

    const alert: RegExpMatchArray | null = line.match(ALERT);
    if (alert) {
      alerts.push(alert[1]!.toUpperCase());
    }

    const definition: RegExpMatchArray | null =
      line.match(REFERENCE_DEFINITION);
    if (definition) {
      links.push({ target: definition[1]!, line: number, isImage: false });
      return;
    }

    const withoutCode: string = line.replace(/`+[^`]*`+/g, "");
    for (const match of withoutCode.matchAll(INLINE_LINK)) {
      links.push({
        target: match[2]!,
        line: number,
        isImage: match[1] === "!",
      });
    }
  });

  for (const open of stack) {
    containerProblems.push({
      line: open.line,
      problem: `":::${open.name}" is never closed`,
    });
  }

  for (const use of containers) {
    if (use.name === "tabs" && use.tabs.length < 2) {
      containerProblems.push({
        line: use.line,
        problem: `":::tabs" has ${use.tabs.length} tab(s); a tab set needs at least two`,
      });
    }
  }

  return {
    lines: lines,
    fences: fences,
    unclosedFence: fence !== null,
    headings: headings,
    links: links,
    containers: containers,
    containerProblems: containerProblems,
    alerts: alerts,
    placeholders: placeholders,
  };
};

// The anchors a page's headings produce.
export const anchorsOf: (lang: string, page: string) => Set<string> = (
  lang: string,
  page: string,
): Set<string> => {
  return new Set(
    scanPage(lang, page).headings.map((heading: DocsHeading): string => {
      return heading.slug;
    }),
  );
};

export interface DocsPageLink {
  page: string;
  anchor: string | null;
}

/*
 * A link to a docs page, as "category/page" and its anchor; null when the
 * target is not a docs page.
 */
export const parseDocsLink: (target: string) => DocsPageLink | null = (
  target: string,
): DocsPageLink | null => {
  const match: RegExpMatchArray | null = target.match(
    /^\/docs\/([^/?#]+)\/([^/?#]+)\/?(?:\?[^#]*)?(?:#(.*))?$/,
  );

  if (!match) {
    return null;
  }

  if (["static", "as-markdown"].includes(match[1]!)) {
    return null;
  }

  return {
    page: `${match[1]}/${match[2]}`,
    anchor: match[3] === undefined ? null : decodeAnchor(match[3]),
  };
};

/*
 * An anchor as the heading slug it names. Anchors are percent-encoded in
 * links; one that is not valid percent-encoding ("#100%") is kept as written,
 * so the link is reported as broken instead of throwing.
 */
export const decodeAnchor: (raw: string) => string = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};
