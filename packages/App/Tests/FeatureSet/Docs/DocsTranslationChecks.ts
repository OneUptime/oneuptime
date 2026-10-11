import DocsPlaceholders from "../../../FeatureSet/Docs/Utils/Placeholders";
import DocsRender from "../../../FeatureSet/Docs/Utils/Render";
import {
  DocsFence,
  DocsLink,
  DocsPageLink,
  ScannedPage,
  anchorsOf,
  hasPage,
  parseDocsLink,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { stripHtmlTags } from "./DocsHtmlText";
import fs from "fs";
import path from "path";

/*
 * What a translated docs page must keep of its English page, as functions
 * the per-group translation suites share (IncidentDocsTranslations,
 * OnCallDocsTranslations): the code exactly, the diagrams by how they are
 * built, the inline code, the shape of the tables and lists, the cards,
 * links that land on a heading of the page they open, and no emphasis
 * marker left on the page as the reader sees it (strayMarkers).
 *
 * Each is a plain function of the Markdown, so the suites can also show that
 * it catches the break it is there for. Suites import these rather than
 * copy them: DocsTagStripGuard fails on a suite that writes its own
 * strayMarkers, or takes tags out of HTML any way but stripHtmlTags
 * (DocsHtmlText).
 */

const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;
const INLINE_CODE: RegExp = /`([^`\n]+)`/g;
const LIST_ITEM: RegExp = /^\s*(?:[-*]|\d+\.)\s/;
const CARDS_OPEN: RegExp = /^:::\s*cards\s*$/;
const CONTAINER_CLOSE: RegExp = /^:::\s*$/;
// A diagram's title, which a translation translates.
const DIAGRAM_TITLE: RegExp = /\btitle="[^"]+"/;
const PERSIAN_DIGITS: string = "۰۱۲۳۴۵۶۷۸۹";

/*
 * The text with Persian digits written as Latin ones. A number the code
 * defines is then found on a page that writes numbers as its language does:
 * the Persian Dashboard draws "30 minutes" as "۳۰ دقیقه".
 */
export function toLatinDigits(text: string): string {
  return text.replace(/[۰-۹]/g, (digit: string): string => {
    return String(PERSIAN_DIGITS.indexOf(digit));
  });
}

// A card's line: its link, then an ASCII ": " and the description.
export const CARD_LINE: RegExp = /^- \[[^\]]+\]\([^)\s]+\): \S/;

// A card's target: the page it opens, without its anchor.
export const CARD_TARGET: RegExp = /\]\(([^)#]*)/;

// The page without its fenced code blocks.
export function prose(markdown: string): string {
  return markdown.replace(/^ {0,3}```[\s\S]*?^ {0,3}```[^\n]*$/gm, "");
}

// Every bold span, once each, in order.
export function boldSpans(markdown: string): Array<string> {
  const spans: Array<string> = [];

  for (const match of Array.from(markdown.matchAll(BOLD))) {
    const span: string = (match[1] as string).trim();

    if (!spans.includes(span)) {
      spans.push(span);
    }
  }

  return spans;
}

// Every inline code span outside the code blocks, sorted: a multiset.
export function inlineCode(markdown: string): Array<string> {
  return Array.from(prose(markdown).matchAll(INLINE_CODE))
    .map((match: RegExpMatchArray): string => {
      return match[1] as string;
    })
    .sort();
}

// What a diagram says, as opposed to how it is built: labels and message text.
const DIAGRAM_QUOTED_LABEL: RegExp = /"[^"\n]*"/g;
const DIAGRAM_EDGE_LABEL: RegExp = /\|[^|\n]*\|/g;
// A participant's or an actor's display name: "actor U as Person".
const DIAGRAM_PARTICIPANT_ALIAS: RegExp =
  /^(\s*(?:participant|actor)\s+\S+)\s+as\s+.*$/;
const DIAGRAM_MESSAGE_TEXT: RegExp = /:.*$/;
/*
 * A sequence diagram's block and its label: "loop Every 10 seconds",
 * "alt The step failed". The label is words, like a message's text; the
 * block is how the diagram is built.
 */
const DIAGRAM_BLOCK_LABEL: RegExp =
  /^(\s*(?:loop|alt|else|opt|par|and|critical|break))(?:\s.*)?$/;

/*
 * A Mermaid diagram with its words taken out: node ids, shapes, arrows and
 * the order of its lines. A translation translates a diagram's labels, so a
 * diagram is compared by this; every other code block must be the English
 * one exactly.
 */
export function diagramSkeleton(code: string): string {
  const isSequence: boolean = code.trimStart().startsWith("sequenceDiagram");

  return code
    .split("\n")
    .map((line: string): string => {
      const built: string = isSequence
        ? line.replace(DIAGRAM_BLOCK_LABEL, "$1")
        : line;

      return built
        .replace(DIAGRAM_QUOTED_LABEL, '""')
        .replace(DIAGRAM_EDGE_LABEL, "||")
        .replace(DIAGRAM_PARTICIPANT_ALIAS, "$1")
        .replace(DIAGRAM_MESSAGE_TEXT, ":")
        .trimEnd();
    })
    .join("\n");
}

// A code block as a translation must keep it: code exactly, a diagram by its build.
export function comparableFence(fence: DocsFence): string {
  if (fence.lang === "mermaid") {
    // The title is translated; that there is one is not.
    const titled: boolean = DIAGRAM_TITLE.test(fence.info);

    return `mermaid titled=${titled}\n${diagramSkeleton(fence.code)}`;
  }

  return `${fence.info}\n${fence.code}`;
}

// The number of body rows of each table, in order.
export function tableShape(markdown: string): Array<number> {
  const shape: Array<number> = [];
  let rows: number = 0;

  for (const line of prose(markdown).split("\n")) {
    if (line.startsWith("|")) {
      rows++;
      continue;
    }

    if (rows > 0) {
      // Minus the header and the delimiter row.
      shape.push(rows - 2);
      rows = 0;
    }
  }

  if (rows > 0) {
    shape.push(rows - 2);
  }

  return shape;
}

export function listItemCount(markdown: string): number {
  return prose(markdown)
    .split("\n")
    .filter((line: string): boolean => {
      return LIST_ITEM.test(line);
    }).length;
}

// The lines of every :::cards block.
export function cardLines(markdown: string): Array<string> {
  const lines: Array<string> = [];
  let inCards: boolean = false;

  for (const line of markdown.split("\n")) {
    if (CARDS_OPEN.test(line)) {
      inCards = true;
      continue;
    }

    if (inCards && CONTAINER_CLOSE.test(line)) {
      inCards = false;
      continue;
    }

    if (inCards && line.trim()) {
      lines.push(line);
    }
  }

  return lines;
}

// The pages a set of card lines opens, in order.
export function cardTargets(lines: Array<string>): Array<string> {
  return lines.map((line: string): string => {
    return (CARD_TARGET.exec(line)?.[1] as string) || "";
  });
}

// A docs nav link's title in a language, as the docs' locale files name it.
export function navTitle(language: string, englishTitle: string): string {
  const locale: { navLinks: Record<string, string> } = JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../FeatureSet/Docs/Locales",
        `${language}.json`,
      ),
      "utf8",
    ),
  ) as { navLinks: Record<string, string> };

  return locale.navLinks[englishTitle] as string;
}

/*
 * Where a link's #anchor must be a heading: the page it opens, in this
 * language when the language has the page, else the English page the docs
 * serve instead.
 */
export function anchorProblems(language: string, page: string): Array<string> {
  const scanned: ScannedPage = scanMarkdown(readPage(language, page));
  const problems: Array<string> = [];

  for (const link of scanned.links) {
    const docsLink: DocsLink = link;
    let target: DocsPageLink | null = null;

    if (docsLink.target.startsWith("#")) {
      target = { page: page, anchor: docsLink.target.slice(1) };
    } else {
      target = parseDocsLink(docsLink.target);
    }

    if (!target || target.anchor === null || target.anchor === "") {
      continue;
    }

    const served: string = hasPage(language, target.page) ? language : "en";
    const anchor: string = decodeURIComponent(target.anchor);

    if (!anchorsOf(served, target.page).has(anchor)) {
      problems.push(`${page}:${docsLink.line} -> ${docsLink.target}`);
    }
  }

  return problems;
}

/*
 * What Markdown never reads, in rendered HTML: code samples, inline code and
 * a diagram's source (its caption is text, and stays). An underscore there
 * is code or a diagram's words ("con_name" in a node), not emphasis.
 */
const NOT_MARKDOWN: RegExp =
  /<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>|<div class="mermaid">[\s\S]*?<\/div>/g;

/*
 * A name written with underscores outside code, as a metric is in a details
 * title ("pve_network_receive_bytes"): CommonMark never reads an underscore
 * between two letters or digits as emphasis, so it is the name, not a
 * marker left over.
 */
const UNDERSCORED_NAME: RegExp = /[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+/g;

/*
 * A page as the docs route draws it, without its title line, and the
 * emphasis markers left in its text: a bold or italic span CommonMark did
 * not close. A bold span that ends in punctuation and runs straight into a
 * letter, as in "**リクエストタイムアウト（秒）**を", is not closed, and its
 * asterisks show. An underscore never closes inside a word, so "_之后_的"
 * shows both underscores.
 *
 * What it returns are the lines of the drawn page, as text, that show "**"
 * or an underscore (the renderer draws a run of paragraphs on one line); a
 * page that draws every span it opens returns none. Code and diagram source
 * are left out first, then the tags (stripHtmlTags), so an underscore in an
 * attribute - a link's address, an image's file name - is no marker either.
 */
export async function strayMarkers(
  markdown: string,
  language: string,
): Promise<Array<string>> {
  const html: string = await DocsRender.render(
    DocsPlaceholders.render(markdown.split("\n").slice(1).join("\n"), language),
  );

  return stripHtmlTags(html.replace(NOT_MARKDOWN, ""))
    .split("\n")
    .filter((line: string): boolean => {
      return (
        line.includes("**") || line.replace(UNDERSCORED_NAME, "").includes("_")
      );
    });
}
