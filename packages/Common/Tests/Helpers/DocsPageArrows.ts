import Markdown, { MarkdownContentType } from "../../Server/Types/Markdown";
import { replaceHtmlMarkup } from "../../Types/HtmlMarkup";
import { ParagraphDirection } from "./BidiLayout";
import { decodeHtmlEntities } from "./HtmlText";
import {
  LEFTWARDS_ARROW,
  PathArrow,
  RIGHTWARDS_ARROW,
  getPathArrows,
} from "./PathArrows";

/*
 * A DOCS PAGE'S ARROWS AS ITS READER SEES THEM, AND WHERE IN ITS MARKDOWN
 * EACH ONE IS WRITTEN.
 *
 * The docs draw a page from its Markdown with the shared renderer
 * (Markdown.convertToHTML with MarkdownContentType.Docs, as
 * App/FeatureSet/Docs/Utils/Render.ts does). A browser lays out each block
 * of the HTML - a paragraph, a list item, a heading, a table cell, the text
 * before a line break - as a paragraph of the bidi algorithm of its own, in
 * the page's direction. The docs stylesheet sets inline code apart, drawn
 * from the left (.docs-code-inline: direction ltr, unicode-bidi isolate),
 * and draws a code block from the left on its own: its arrows are code's,
 * never a path's.
 *
 * drawnBlocks reads the HTML that way: each block's text with its markup
 * taken out, its inline code in an LRI ... PDI isolate, its references
 * decoded, and no code block. markdownArrows finds the arrows a reader
 * sees in the Markdown - outside fenced code, a link's address and an
 * image's text - in the order the page draws them, so that each drawn
 * arrow is told by the line and column it is written at.
 */

const LRI: string = String.fromCharCode(0x2066);
const PDI: string = String.fromCharCode(0x2069);

// A code block: drawn from the left, on its own, never read as prose.
const CODE_BLOCK: RegExp = /<pre\b[^>]*>[\s\S]*?<\/pre>/gi;

// The elements a browser lays out as blocks: each starts a paragraph.
const BLOCK_ELEMENT: RegExp =
  /^<\/?(?:address|article|aside|blockquote|br|dd|details|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)\b/i;

// The inline elements the docs draw from the left, set apart from the prose.
const CODE_ELEMENT: RegExp = /^<(\/?)(?:code|kbd|samp)\b/i;

const isArrowCharacter: (character: string) => boolean = (
  character: string,
): boolean => {
  return character === RIGHTWARDS_ARROW || character === LEFTWARDS_ARROW;
};

/*
 * The text of each block of a docs page's HTML, as the bidi algorithm
 * reads it.
 */
export const drawnBlocks: (html: string) => Array<string> = (
  html: string,
): Array<string> => {
  const withoutCodeBlocks: string = html
    .replace(CODE_BLOCK, "<p></p>")
    .replace(/[\r\n\t]/g, " ");

  return decodeHtmlEntities(
    replaceHtmlMarkup(withoutCodeBlocks, (markup: string): string => {
      if (BLOCK_ELEMENT.test(markup)) {
        return "\n";
      }

      const code: RegExpExecArray | null = CODE_ELEMENT.exec(markup);

      if (code) {
        return code[1] ? PDI : LRI;
      }

      return "";
    }),
  )
    .split("\n")
    .map((block: string): string => {
      return block.trim();
    })
    .filter((block: string): boolean => {
      return block.length > 0;
    });
};

export interface MarkdownArrow {
  // 1-based, as an editor counts lines.
  line: number;
  // Where the arrow is in its line (a UTF-16 index).
  column: number;
  arrow: string;
  // Inside an inline code span.
  inCode: boolean;
}

const FENCE: RegExp = /^ *(`{3,}|~{3,})/;
const REFERENCE_DEFINITION: RegExp = /^ {0,3}\[[^\]]+\]:\s/;

/*
 * Where an inline code span that opens at `from` (a run of backticks) ends:
 * the index after the run of as many backticks that closes it, or -1 when
 * no run closes it on the line (CommonMark then reads the backticks as
 * text).
 */
const codeSpanEnd: (line: string, from: number) => number = (
  line: string,
  from: number,
): number => {
  let run: number = 0;

  while (line.charAt(from + run) === "`") {
    run++;
  }

  let at: number = from + run;

  while (at < line.length) {
    if (line.charAt(at) !== "`") {
      at++;
      continue;
    }

    let closing: number = 0;

    while (line.charAt(at + closing) === "`") {
      closing++;
    }

    if (closing === run) {
      return at + closing;
    }

    at += closing;
  }

  return -1;
};

// Where a link's address that opens at `from` ("(") ends: after its ")".
const linkAddressEnd: (line: string, from: number) => number = (
  line: string,
  from: number,
): number => {
  let depth: number = 0;

  for (let at: number = from; at < line.length; at++) {
    const character: string = line.charAt(at);

    if (character === "\\") {
      at++;
    } else if (character === "(") {
      depth++;
    } else if (character === ")") {
      depth--;

      if (depth === 0) {
        return at + 1;
      }
    }
  }

  return line.length;
};

/*
 * The arrows of a docs page's Markdown that its reader sees, in order:
 * those in fenced code blocks, a link's or an image's address, an image's
 * text and a reference definition are not drawn as text.
 */
export const markdownArrows: (markdown: string) => Array<MarkdownArrow> = (
  markdown: string,
): Array<MarkdownArrow> => {
  const arrows: Array<MarkdownArrow> = [];
  let fence: string | null = null;

  markdown.split("\n").forEach((line: string, index: number): void => {
    const opensOrCloses: RegExpExecArray | null = FENCE.exec(line);

    if (fence !== null) {
      if (
        opensOrCloses &&
        (opensOrCloses[1] as string).charAt(0) === fence.charAt(0) &&
        (opensOrCloses[1] as string).length >= fence.length &&
        line.trim() === (opensOrCloses[1] as string)
      ) {
        fence = null;
      }

      return;
    }

    if (opensOrCloses) {
      fence = opensOrCloses[1] as string;
      return;
    }

    // A reference definition ("[docs]: /docs/...") draws nothing.
    if (REFERENCE_DEFINITION.test(line)) {
      return;
    }

    let imageTextDepth: number = 0;
    let at: number = 0;

    while (at < line.length) {
      const character: string = line.charAt(at);

      if (character === "\\") {
        at += 2;
        continue;
      }

      if (character === "`") {
        const end: number = codeSpanEnd(line, at);

        if (end > 0) {
          for (let inside: number = at; inside < end; inside++) {
            if (isArrowCharacter(line.charAt(inside))) {
              arrows.push({
                line: index + 1,
                column: inside,
                arrow: line.charAt(inside),
                inCode: true,
              });
            }
          }

          at = end;
          continue;
        }

        while (line.charAt(at) === "`") {
          at++;
        }

        continue;
      }

      if (character === "!" && line.charAt(at + 1) === "[") {
        imageTextDepth++;
        at += 2;
        continue;
      }

      if (character === "[" && imageTextDepth > 0) {
        imageTextDepth++;
      } else if (character === "]" && imageTextDepth > 0) {
        imageTextDepth--;
      }

      if (character === "]" && line.charAt(at + 1) === "(") {
        at = linkAddressEnd(line, at + 1);
        continue;
      }

      if (isArrowCharacter(character) && imageTextDepth === 0) {
        arrows.push({
          line: index + 1,
          column: at,
          arrow: character,
          inCode: false,
        });
      }

      at++;
    }
  });

  return arrows;
};

export interface DocsPageArrow extends MarkdownArrow {
  // The text of the block it is drawn in.
  block: string;
  // As an arrow between two steps of a path, or null where it is none.
  path: PathArrow | null;
}

export interface DocsPageArrows {
  arrows: Array<DocsPageArrow>;
  // Each drawn arrow found where the Markdown writes it.
  isLinedUp: boolean;
  drawn: number;
  written: number;
}

/*
 * A docs page's arrows: each drawn arrow, in a block laid out in a
 * paragraph read `direction`, with the line and column the Markdown writes
 * it at.
 */
export const getDocsPageArrows: (
  markdown: string,
  direction: ParagraphDirection,
) => Promise<DocsPageArrows> = async (
  markdown: string,
  direction: ParagraphDirection,
): Promise<DocsPageArrows> => {
  const html: string = await Markdown.convertToHTML(
    markdown,
    MarkdownContentType.Docs,
  );
  const drawn: Array<{
    block: string;
    arrow: string;
    path: PathArrow | null;
  }> = [];

  for (const block of drawnBlocks(html)) {
    const paths: Array<PathArrow> = getPathArrows(block, direction);

    for (let index: number = 0; index < block.length; index++) {
      const character: string = block.charAt(index);

      if (isArrowCharacter(character)) {
        drawn.push({
          block,
          arrow: character,
          path:
            paths.find((path: PathArrow): boolean => {
              return path.index === index;
            }) || null,
        });
      }
    }
  }

  // The same arrows, in the same order: each drawn one is the one written.
  const written: Array<MarkdownArrow> = markdownArrows(markdown);
  const isLinedUp: boolean =
    drawn.length === written.length &&
    drawn.every((arrow: { arrow: string }, nth: number): boolean => {
      return arrow.arrow === (written[nth] as MarkdownArrow).arrow;
    });

  return {
    arrows: isLinedUp
      ? written.map((arrow: MarkdownArrow, nth: number): DocsPageArrow => {
          const seen: { block: string; path: PathArrow | null } = drawn[
            nth
          ] as { block: string; path: PathArrow | null };

          return { ...arrow, block: seen.block, path: seen.path };
        })
      : [],
    isLinedUp,
    drawn: drawn.length,
    written: written.length,
  };
};
