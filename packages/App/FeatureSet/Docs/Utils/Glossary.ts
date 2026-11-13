import { ContentPath } from "./Config";
import {
  DEFAULT_DOCS_LANGUAGE,
  isSupportedDocsLanguage,
  localizeDocsUrl,
} from "./I18n";
import { stripInlineMarkdown } from "./SearchIndex";
import { isEnglishCopy } from "./Translations";
import {
  FENCE,
  getMarkdownHeadingShape,
  readMarkdownHeadings,
} from "Common/Server/Types/MarkdownHeadings";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import LocalFile from "Common/Server/Utils/LocalFile";
import OneUptimeDate from "Common/Types/Date";

/*
 * THE GLOSSARY, AS DATA.
 *
 * The Glossary page (Content/<lang>/introduction/glossary.md) is the one
 * place a term's definition is written, once per language. The docs render
 * it like any other page, and this module reads the same Markdown back as
 * entries, served at /docs/glossary/<lang>.json, for what needs a term's
 * definition outside the page: the Dashboard's definitions where a word is
 * used (#6819) and Ask AI (#6828).
 *
 * The page is written to be read back. Each "### " heading is a term, under
 * a "## " heading that is its group. A term's last paragraph names it: the
 * other names it goes by, in bold or as code, and the docs pages that cover
 * it, as links. Every paragraph before that is its definition:
 *
 *   ### Service
 *
 *   An application or microservice you run. ...
 *
 *   Also called: **Service Catalog**, **Telemetry Service**. See
 *   [Services](/docs/telemetry/services).
 *
 * A term's id is its English heading's anchor ("service", "on-call-policy"),
 * the same in every language: a translation keeps the English page's shape,
 * so the term in a place on a translated page is the English term in that
 * place, and the page answers the English anchor there too (AnchorAliases).
 * Common/Types/Docs/GlossaryTerm.ts lists the ids for code that links to a
 * term, and the GlossaryDocs suite holds the page to that list.
 *
 * A language whose copy is missing, still English, or no longer the English
 * page's shape is served the English entries, as the page itself is.
 */

export const GLOSSARY_PAGE: string = "introduction/glossary";

export interface DocsGlossaryLink {
  // The link's text, as the page shows it.
  title: string;
  // The page it opens, in the entries' language.
  url: string;
}

export interface DocsGlossaryEntry {
  // The English heading's anchor: the same in every language.
  id: string;
  // The term, as the heading says it in the entries' language.
  term: string;
  // The heading's own anchor in the entries' language.
  anchor: string;
  // The "## " group the term is under, in the entries' language.
  group: string;
  // The definition, as plain text.
  definition: string;
  // The other names the term goes by, as plain text.
  alsoCalled: Array<string>;
  // The pages that cover the term, in the entries' language.
  links: Array<DocsGlossaryLink>;
  // The term on the Glossary page, in the entries' language.
  url: string;
}

export interface DocsGlossary {
  // The language the entries are written in: English when it has no copy.
  lang: string;
  entries: Array<DocsGlossaryEntry>;
}

// A term or a group heading's line: its level and its text.
const HEADING_LINE: RegExp = /^(#{2,3})[ \t](.+)$/;
const BOLD_SPAN: RegExp = /\*\*([^*]+)\*\*/g;
const CODE_SPAN: RegExp = /`([^`]+)`/g;
const LINK: RegExp = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const DOCS_LINK: RegExp = /\]\(\/docs\//;
// A line that is not prose: a component, a list item, a quote, a table.
const NOT_PROSE: RegExp = /^\s*(?::{3,}|@tab\b|>|\||[-*+]\s|\d+[.)]\s)/;

interface ReadTerm {
  term: string;
  group: string;
  paragraphs: Array<string>;
}

// The terms of a Glossary page, in order, each with its paragraphs.
const readTerms: (markdown: string) => Array<ReadTerm> = (
  markdown: string,
): Array<ReadTerm> => {
  const terms: Array<ReadTerm> = [];
  let group: string = "";
  let current: ReadTerm | null = null;
  let paragraph: Array<string> = [];
  let fence: string | null = null;

  const endParagraph: () => void = (): void => {
    if (current && paragraph.length > 0) {
      current.paragraphs.push(paragraph.join(" "));
    }
    paragraph = [];
  };

  for (const line of markdown.split("\n")) {
    const fenceMatch: RegExpMatchArray | null = line.match(FENCE);

    if (fenceMatch || fence !== null) {
      endParagraph();

      if (fenceMatch) {
        const marker: string = fenceMatch[1]!;

        if (fence === null) {
          fence = marker;
        } else if (marker[0] === fence[0] && marker.length >= fence.length) {
          fence = null;
        }
      }
      continue;
    }

    const heading: RegExpMatchArray | null = line.match(HEADING_LINE);

    if (heading) {
      endParagraph();

      if (heading[1] === "##") {
        group = heading[2]!.trim();
        current = null;
      } else {
        current = { term: heading[2]!.trim(), group: group, paragraphs: [] };
        terms.push(current);
      }
      continue;
    }

    if (line.trim() === "" || NOT_PROSE.test(line)) {
      endParagraph();
      continue;
    }

    paragraph.push(line.trim());
  }

  endParagraph();

  return terms;
};

/*
 * The entries of a Glossary page in a language, each with the id of the
 * English term in its place. Null when the two copies are not the same
 * shape, so no term is given another's id.
 */
export const parseGlossary: (
  englishMarkdown: string,
  markdown: string,
  lang: string,
) => Array<DocsGlossaryEntry> | null = (
  englishMarkdown: string,
  markdown: string,
  lang: string,
): Array<DocsGlossaryEntry> | null => {
  if (
    getMarkdownHeadingShape(readMarkdownHeadings(englishMarkdown)) !==
    getMarkdownHeadingShape(readMarkdownHeadings(markdown))
  ) {
    return null;
  }

  // The same headings at the same levels: the same terms, in the same places.
  const englishTerms: Array<ReadTerm> = readTerms(englishMarkdown);
  const terms: Array<ReadTerm> = readTerms(markdown);
  const pageUrl: string = localizeDocsUrl(`/docs/${GLOSSARY_PAGE}`, lang);

  return terms.map((read: ReadTerm, index: number): DocsGlossaryEntry => {
    const id: string = slugifyMarkdownHeading(englishTerms[index]!.term);
    /*
     * The names line is the last paragraph, when it links to a docs page;
     * a term without one is all definition.
     */
    const last: string = read.paragraphs[read.paragraphs.length - 1] || "";
    const named: boolean = read.paragraphs.length > 1 && DOCS_LINK.test(last);
    const names: string = named ? last : "";
    const definition: Array<string> = named
      ? read.paragraphs.slice(0, -1)
      : read.paragraphs;

    return {
      id: id,
      term: stripInlineMarkdown(read.term),
      anchor: slugifyMarkdownHeading(read.term),
      group: stripInlineMarkdown(read.group),
      definition: stripInlineMarkdown(definition.join(" ")),
      alsoCalled: [
        ...Array.from(names.matchAll(BOLD_SPAN)),
        ...Array.from(names.matchAll(CODE_SPAN)),
      ]
        .sort((a: RegExpMatchArray, b: RegExpMatchArray): number => {
          return (a.index || 0) - (b.index || 0);
        })
        .map((match: RegExpMatchArray): string => {
          return match[1]!.trim();
        }),
      links: Array.from(names.matchAll(LINK)).map(
        (match: RegExpMatchArray): DocsGlossaryLink => {
          return {
            title: stripInlineMarkdown(match[1]!),
            url: localizeDocsUrl(match[2]!, lang),
          };
        },
      ),
      url: `${pageUrl}#${id}`,
    };
  });
};

const TTL_MS: number = 10 * 60 * 1000;

const cache: Map<string, { data: DocsGlossary; at: number }> = new Map();

const readCopy: (lang: string) => Promise<string | null> = async (
  lang: string,
): Promise<string | null> => {
  const file: string = `${ContentPath}/${lang}/${GLOSSARY_PAGE}.md`;

  return (await LocalFile.doesFileExist(file)) ? LocalFile.read(file) : null;
};

export default class DocsGlossaryData {
  // The entries in a language, or in English where it has no copy of its own.
  public static async getGlossary(lang: string): Promise<DocsGlossary> {
    const resolved: string = isSupportedDocsLanguage(lang)
      ? lang
      : DEFAULT_DOCS_LANGUAGE;
    const now: number = OneUptimeDate.getCurrentDate().getTime();
    const cached: { data: DocsGlossary; at: number } | undefined =
      cache.get(resolved);

    if (cached && now - cached.at < TTL_MS) {
      return cached.data;
    }

    const data: DocsGlossary = await DocsGlossaryData.build(resolved);
    cache.set(resolved, { data: data, at: now });
    return data;
  }

  public static async build(lang: string): Promise<DocsGlossary> {
    const english: string | null = await readCopy(DEFAULT_DOCS_LANGUAGE);

    if (english === null) {
      return { lang: DEFAULT_DOCS_LANGUAGE, entries: [] };
    }

    if (lang !== DEFAULT_DOCS_LANGUAGE) {
      const copy: string | null = await readCopy(lang);
      const entries: Array<DocsGlossaryEntry> | null =
        copy === null || isEnglishCopy(english, copy)
          ? null
          : parseGlossary(english, copy, lang);

      if (entries !== null) {
        return { lang: lang, entries: entries };
      }
    }

    return {
      lang: DEFAULT_DOCS_LANGUAGE,
      entries: parseGlossary(english, english, DEFAULT_DOCS_LANGUAGE) || [],
    };
  }

  // Forgets what was read, for tests that change the content they read.
  public static clearCache(): void {
    cache.clear();
  }
}
