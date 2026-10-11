import { ContentPath } from "./Config";
import DocsNav, { NavGroup, NavLink } from "./Nav";
import {
  DEFAULT_DOCS_LANGUAGE,
  isSupportedDocsLanguage,
  localizeDocsUrl,
  makeT,
  TranslateFn,
} from "./I18n";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import LocalFile from "Common/Server/Utils/LocalFile";
import OneUptimeDate from "Common/Types/Date";
import { removeHtmlMarkup } from "Common/Types/HtmlMarkup";

/*
 * What docs search searches: every page in the nav, by its title, its
 * group, its section headings and the first thing it says.
 *
 * The page used to search the nav's titles alone, so "SAML" or "heartbeat"
 * found nothing unless a page happened to be named after it. Each entry
 * here also carries the page's h2 and h3 headings with their anchors, so a
 * result can take the reader to the section, not just the page.
 *
 * Built per language from that language's copy of each page (English where a
 * page is not translated yet) and cached; content is static on disk per
 * deploy.
 */

export interface DocsSearchHeading {
  // Heading text, without Markdown.
  t: string;
  // The heading's anchor: the id the renderer gives it.
  a: string;
}

export interface DocsSearchEntry {
  // Page title, as the nav shows it in this language.
  t: string;
  // The page's group, as the nav shows it in this language.
  c: string;
  // The page's URL in this language.
  u: string;
  // A one-line summary: the page's first paragraph, trimmed.
  d: string;
  h: Array<DocsSearchHeading>;
}

export interface DocsPageSummary {
  description: string;
  headings: Array<{ level: number; text: string; anchor: string }>;
}

const DESCRIPTION_LENGTH: number = 180;

const FENCE_LINE: RegExp = /^\s*(```|~~~)/;

// Lines that start something other than prose: components, quotes, tables, lists, images.
const NOT_PROSE: RegExp = /^\s*(?::{3,}|@tab\b|>|\||[-*+]\s|\d+[.)]\s|!\[|<)/;
const TTL_MS: number = 10 * 60 * 1000;

const cache: Map<string, { data: Array<DocsSearchEntry>; at: number }> =
  new Map();

const INLINE_CODE: RegExp = /`+([^`]*)`+/g;
// Marks where a code span was set aside: a private-use character no page uses.
const CODE_MARK: string = "";
const CODE_PLACEHOLDER: RegExp = /(\d+)/g;

// A run of "<", and the characters a tag, a comment or a declaration starts with.
const LESS_THAN_RUN: RegExp = /<+/g;
const STARTS_MARKUP: RegExp = /[A-Za-z/!?]/;
// Marks a "<" that is text while markup is taken out: private use, as CODE_MARK.
const TEXT_LESS_THAN_MARK: string = "";

/*
 * Every "<" in `text` that Markdown reads as text rather than as the start
 * of a tag, a comment or a declaration - one before whitespace, a digit or
 * any other character none of those starts with, or at the end: "LCP <
 * 2.5 s", "<= 5", "<->" - as TEXT_LESS_THAN_MARK. A run of them ("<<") goes
 * with the character after its last one. A "<" before a letter, "/", "!",
 * "?" or a code span is left for removeHtmlMarkup: what follows it could
 * make a tag, so it must not stay. That includes one no ">" ever closes -
 * "p99<threshold" is text to Markdown, and is indexed "p99threshold" - so
 * that nothing in the index can open a tag, whatever is put after it.
 */
const markTextLessThans: (text: string) => string = (text: string): string => {
  return text.replace(
    LESS_THAN_RUN,
    (run: string, offset: number, whole: string): string => {
      const next: string = whole.charAt(offset + run.length);

      return next === CODE_MARK || STARTS_MARKUP.test(next)
        ? run
        : TEXT_LESS_THAN_MARK.repeat(run.length);
    },
  );
};

/*
 * Markdown inline syntax off a line of text: links, emphasis, code, images,
 * and HTML tags and comments.
 *
 * Tags and comments are read out with removeHtmlMarkup (Common/Types/
 * HtmlMarkup): one walk that drops each whole - a quoted attribute value
 * holding ">" and a comment holding ">" included - and drops a "<" that
 * never closes on its own, so no tag is left in the text around the code
 * and none can form from what is left. It used to be one pass of a tag
 * pattern, which kept an unclosed "<img" or "<script" as it was, and the end
 * of a value or a comment after its first ">". A "<" that Markdown reads as
 * text ("LCP < 2.5 s") is set aside first and kept, as the page shows it.
 * The search box and the page's meta description escape what they show, so
 * this is about the index holding text, not markup.
 */
export const stripInlineMarkdown: (text: string) => string = (
  text: string,
): string => {
  /*
   * Inline code is kept as written - "`oneuptime <resource> list`" reads
   * "oneuptime <resource> list", as on the page - so it is set aside before
   * links, emphasis and tags are taken out, and put back after. The marks
   * are private-use characters no page has; any in the text are dropped
   * first, so only the ones set here are read back.
   */
  const code: Array<string> = [];
  const withoutCode: string = text
    .split(CODE_MARK)
    .join("")
    .split(TEXT_LESS_THAN_MARK)
    .join("")
    .replace(INLINE_CODE, (_whole: string, inner: string): string => {
      code.push(inner);
      return `${CODE_MARK}${code.length - 1}${CODE_MARK}`;
    });

  const withoutMarkup: string = removeHtmlMarkup(
    markTextLessThans(
      withoutCode
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
        .replace(/(\*\*|__)(.*?)\1/g, "$2")
        .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, "$1$2"),
    ),
  );

  return withoutMarkup
    .split(TEXT_LESS_THAN_MARK)
    .join("<")
    .replace(/\s+/g, " ")
    .replace(CODE_PLACEHOLDER, (_whole: string, position: string): string => {
      return code[Number(position)] ?? "";
    })
    .trim();
};

/*
 * A page's search material: its headings (h2 to h3) with their anchors, and
 * its first paragraph of prose as a description. Fenced code and the
 * components' own syntax lines are skipped.
 */
export const summarizeDocsPage: (markdown: string) => DocsPageSummary = (
  markdown: string,
): DocsPageSummary => {
  const lines: Array<string> = markdown.split("\n");
  const headings: Array<{ level: number; text: string; anchor: string }> = [];
  let description: string = "";
  let paragraph: Array<string> = [];
  let inFence: boolean = false;

  const flushParagraph: () => void = (): void => {
    if (!description && paragraph.length > 0) {
      const text: string = stripInlineMarkdown(paragraph.join(" "));
      if (text.length > 0) {
        description =
          text.length > DESCRIPTION_LENGTH
            ? `${text.slice(0, DESCRIPTION_LENGTH - 1).replace(/\s+\S*$/, "")}…`
            : text;
      }
    }
    paragraph = [];
  };

  // The first line is the page's title.
  for (const line of lines.slice(1)) {
    if (FENCE_LINE.test(line)) {
      flushParagraph();
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    const heading: RegExpMatchArray | null = line.match(
      /^(#{1,6})\s+(.+?)\s*#*\s*$/,
    );
    if (heading) {
      flushParagraph();
      const level: number = heading[1]!.length;
      if (level >= 2 && level <= 3) {
        headings.push({
          level: level,
          text: stripInlineMarkdown(heading[2]!),
          anchor: slugifyMarkdownHeading(heading[2]!.trim()),
        });
      }
      continue;
    }

    const isProse: boolean = line.trim().length > 0 && !NOT_PROSE.test(line);

    if (isProse) {
      paragraph.push(line.trim());
    } else {
      flushParagraph();
    }
  }
  flushParagraph();

  return { description: description, headings: headings };
};

const readPage: (lang: string, page: string) => Promise<string | null> = async (
  lang: string,
  page: string,
): Promise<string | null> => {
  for (const candidate of [
    `${ContentPath}/${lang}/${page}.md`,
    `${ContentPath}/${DEFAULT_DOCS_LANGUAGE}/${page}.md`,
  ]) {
    if (await LocalFile.doesFileExist(candidate)) {
      return LocalFile.read(candidate);
    }
  }
  return null;
};

export default class DocsSearchIndex {
  public static async getIndex(lang: string): Promise<Array<DocsSearchEntry>> {
    const resolved: string = isSupportedDocsLanguage(lang)
      ? lang
      : DEFAULT_DOCS_LANGUAGE;
    const now: number = OneUptimeDate.getCurrentDate().getTime();
    const cached: { data: Array<DocsSearchEntry>; at: number } | undefined =
      cache.get(resolved);

    if (cached && now - cached.at < TTL_MS) {
      return cached.data;
    }

    const data: Array<DocsSearchEntry> = await DocsSearchIndex.build(resolved);
    cache.set(resolved, { data: data, at: now });
    return data;
  }

  public static async build(lang: string): Promise<Array<DocsSearchEntry>> {
    const t: TranslateFn = makeT(lang);
    const entries: Array<DocsSearchEntry> = [];

    for (const group of DocsNav as Array<NavGroup>) {
      for (const link of group.links as Array<NavLink>) {
        const entry: DocsSearchEntry = {
          t: t(`navLinks.${link.title}`),
          c: t(`navGroups.${group.title}`),
          u: localizeDocsUrl(link.url, lang),
          d: "",
          h: [],
        };

        if (link.url.startsWith("/docs/")) {
          const markdown: string | null = await readPage(
            lang,
            link.url.slice("/docs/".length),
          );
          if (markdown !== null) {
            const summary: DocsPageSummary = summarizeDocsPage(markdown);
            entry.d = summary.description;
            entry.h = summary.headings.map(
              (heading: {
                text: string;
                anchor: string;
              }): DocsSearchHeading => {
                return { t: heading.text, a: heading.anchor };
              },
            );
          }
        }

        entries.push(entry);
      }
    }

    return entries;
  }

  public static clearCache(): void {
    cache.clear();
  }
}
