import {
  MarkdownHeading,
  getMarkdownHeadingShape,
  readMarkdownHeadings,
} from "Common/Server/Types/MarkdownHeadings";

/*
 * ENGLISH ANCHORS ON A TRANSLATED PAGE.
 *
 * The product links to a docs heading by its English anchor
 * (/docs/telemetry/queues#broker-health-metrics), and so do addresses
 * people share and the docs' own links into a page whose translation was
 * stale when they were written. A translated heading's anchor is made of its
 * own words (#ブローカーのヘルスメトリクス), so the same address in another
 * language - the reader picking their language from the page, a link moved
 * into it - opened that page at its top.
 *
 * A translation keeps its English page's shape (MarkdownHeadings), so each
 * translated heading's English twin is the heading in the same place on the
 * English page. Each translated heading answers that English anchor too:
 * data-english-anchor on the heading, which the language switcher reads to
 * keep the reader's place, and, where the two anchors differ, an empty mark
 * with the English id at the heading's top. A page whose shape is not the
 * English page's - a stale translation - gets none rather than wrong ones,
 * the way docs:localize-anchors leaves its links alone; and an English
 * anchor that is already another element's id on the page is left to it.
 */

/*
 * A rendered heading's opening tag, as the docs renderer writes it
 * (Common/Server/Types/Markdown.ts, renderer.heading).
 */
const RENDERED_HEADING: RegExp =
  /<h([1-6]) id="([^"]*)" class="docs-heading docs-h\1">/g;
const RENDERED_ID: RegExp = /\sid="([^"]*)"/g;

export interface DocsAnchorAlias {
  // The translated heading's own anchor.
  anchor: string;
  // The anchor of the English heading in its place.
  englishAnchor: string;
}

/*
 * Each translated heading with the English heading in its place, in order;
 * none when the two copies are not the same shape.
 */
export const getEnglishAnchorAliases: (
  englishMarkdown: string,
  translatedMarkdown: string,
) => Array<DocsAnchorAlias> = (
  englishMarkdown: string,
  translatedMarkdown: string,
): Array<DocsAnchorAlias> => {
  const english: Array<MarkdownHeading> = readMarkdownHeadings(englishMarkdown);
  const translated: Array<MarkdownHeading> =
    readMarkdownHeadings(translatedMarkdown);

  if (
    english.length === 0 ||
    getMarkdownHeadingShape(english) !== getMarkdownHeadingShape(translated)
  ) {
    return [];
  }

  return translated.map(
    (heading: MarkdownHeading, index: number): DocsAnchorAlias => {
      return {
        anchor: heading.anchor,
        englishAnchor: english[index]!.anchor,
      };
    },
  );
};

/*
 * A translated page's HTML, with its headings answering their English
 * anchors. The headings are drawn in the order they were read, so each takes
 * the next pair with its anchor; a heading with none (one the Markdown's
 * lines did not show, such as one inside a quote) is left as it is. Anchors
 * are slugs, letters, digits, "_" and "-" only (MarkdownSlugify), so they go
 * into the attributes as they are.
 */
export const addEnglishAnchorAliases: (
  html: string,
  aliases: Array<DocsAnchorAlias>,
) => string = (html: string, aliases: Array<DocsAnchorAlias>): string => {
  if (aliases.length === 0) {
    return html;
  }

  const ids: Set<string> = new Set<string>();

  for (const match of html.matchAll(RENDERED_ID)) {
    ids.add(match[1]!);
  }

  let next: number = 0;

  return html.replace(
    RENDERED_HEADING,
    (tag: string, level: string, anchor: string): string => {
      let at: number = next;

      while (at < aliases.length && aliases[at]!.anchor !== anchor) {
        at++;
      }

      if (at >= aliases.length) {
        return tag;
      }

      next = at + 1;

      const englishAnchor: string = aliases[at]!.englishAnchor;

      if (!englishAnchor) {
        return tag;
      }

      const opening: string = `<h${level} id="${anchor}" data-english-anchor="${englishAnchor}" class="docs-heading docs-h${level}">`;

      if (englishAnchor === anchor || ids.has(englishAnchor)) {
        return opening;
      }

      ids.add(englishAnchor);

      return `${opening}<span id="${englishAnchor}" class="docs-heading__alias" aria-hidden="true"></span>`;
    },
  );
};
