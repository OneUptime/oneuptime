import { slugifyMarkdownHeading } from "./MarkdownSlugify";

/*
 * A docs page's headings, read from its Markdown, and the shape its
 * translations keep.
 *
 * A translation keeps its English page's shape - the same headings at the
 * same levels, with the same code samples under them, in the same order (the
 * docs translation tests hold it to that) - so the heading in a place on a
 * translated page is the English heading in that place. Two things pair a
 * translated page's headings with the English page's by it:
 * docs:localize-anchors (Scripts/Docs/LocalizeAnchors.ts), which points a
 * translated page's English #anchors at the translated headings, and the
 * docs site (App/FeatureSet/Docs/Utils/AnchorAliases.ts), which has each
 * translated heading answer its English anchor too. Both read a page here,
 * so they never pair one differently.
 *
 * Like MarkdownSlugify, it imports nothing a package's own install is
 * needed for: the scripts load it with the root npm install alone.
 */

// The fence's run is taken whole, so a line is read once (see FENCE_LINE_PATTERN in FeedMarkdown).
export const FENCE: RegExp = /^ {0,3}(`{3,}(?!`)|~{3,}(?!~))(.*)$/;
const HEADING: RegExp = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

export interface MarkdownHeading {
  // The heading's id on the page (MarkdownSlugify).
  anchor: string;
  level: number;
  // The languages of the code samples between this heading and the next.
  code: Array<string>;
}

// A page's headings, in order, outside fenced code.
export const readMarkdownHeadings: (
  markdown: string,
) => Array<MarkdownHeading> = (markdown: string): Array<MarkdownHeading> => {
  const headings: Array<MarkdownHeading> = [];
  let fence: string | null = null;

  for (const line of markdown.split("\n")) {
    const fenceMatch: RegExpMatchArray | null = line.match(FENCE);
    if (fenceMatch) {
      const marker: string = fenceMatch[1]!;
      if (fence === null) {
        fence = marker;
        const language: string =
          (fenceMatch[2] || "").trim().split(/\s+/)[0] || "";
        if (headings.length > 0) {
          headings[headings.length - 1]!.code.push(language.toLowerCase());
        }
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      continue;
    }
    const heading: RegExpMatchArray | null = line.match(HEADING);
    if (heading) {
      headings.push({
        anchor: slugifyMarkdownHeading(heading[2]!.trim()),
        level: heading[1]!.length,
        code: [],
      });
    }
  }

  return headings;
};

// What two copies of a page must share for their headings to line up.
export const getMarkdownHeadingShape: (
  headings: Array<MarkdownHeading>,
) => string = (headings: Array<MarkdownHeading>): string => {
  return headings
    .map((heading: MarkdownHeading): string => {
      return `${heading.level}[${heading.code.join(",")}]`;
    })
    .join(" ");
};
