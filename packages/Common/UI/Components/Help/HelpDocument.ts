/*
 * A HELP DOCUMENT, READ AS A LEAD AND ITS TOPICS (#8889).
 *
 * A help dialog drew its markdown as one page: six headings, a rule
 * between each and paragraph after paragraph of bold, with no way to see
 * what was in it short of scrolling to the end. The dialog now draws the
 * same markdown as what it says in short, then a list of its topics, each
 * opened on its own (HelpModal). This reads the markdown into those parts.
 *
 *   - The topics are the document's top headings: the shallowest level it
 *     uses ("##" in every help OneUptime writes; "###" in older text).
 *     Deeper headings stay inside their topic.
 *   - The lead is what comes before the first topic: "In short".
 *   - A line drawn between topics ("---") goes: the dialog draws its own.
 *   - A heading inside a fenced code block is code, never a topic.
 *
 * Pure and React-free, so it is tested on its own and the guard that holds
 * every page's help to its shape (HelpDialogsGuard) reads it too.
 */

export interface HelpSection {
  // Unique in its document, made from the title: "match-criteria".
  id: string;
  // The heading's words, without their markdown ("Match Criteria").
  title: string;
  // Everything under the heading, up to the next topic.
  markdown: string;
}

export interface HelpDocument {
  // What the document says before its first topic; "" when nothing.
  summary: string;
  sections: Array<HelpSection>;
}

const HEADING: RegExp = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const THEMATIC_BREAK: RegExp = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE_OPENING: RegExp = /^ {0,3}(`{3,}|~{3,})/;

interface HeadingLine {
  index: number;
  level: number;
  text: string;
}

/*
 * The heading lines of a document, with the lines inside fenced code left
 * out: a shell comment ("# install the agent") in a code sample is not a
 * heading.
 */
export const findHelpHeadings: (lines: Array<string>) => Array<HeadingLine> = (
  lines: Array<string>,
): Array<HeadingLine> => {
  const headings: Array<HeadingLine> = [];
  let openFence: string | null = null;

  for (let index: number = 0; index < lines.length; index++) {
    const line: string = lines[index] || "";

    if (openFence) {
      const closing: RegExpMatchArray | null = line.match(FENCE_OPENING);

      if (
        closing &&
        closing[1]![0] === openFence[0] &&
        closing[1]!.length >= openFence.length &&
        line.trim() === closing[1]
      ) {
        openFence = null;
      }

      continue;
    }

    const opening: RegExpMatchArray | null = line.match(FENCE_OPENING);

    if (opening) {
      openFence = opening[1]!;
      continue;
    }

    const heading: RegExpMatchArray | null = line.match(HEADING);

    if (heading && heading[2]!.trim().length > 0) {
      headings.push({
        index: index,
        level: heading[1]!.length,
        text: heading[2]!.trim(),
      });
    }
  }

  return headings;
};

// A heading's words as they read: "**Match** `Criteria`" is "Match Criteria".
export const getHelpHeadingText: (heading: string) => string = (
  heading: string,
): string => {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])[*_]([^*_]+)[*_](?=[^\w*]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
};

/*
 * The text between two topics, without the blank lines and the drawn lines
 * ("---") at either end. A line in the middle of a topic stays.
 */
export const trimHelpText: (lines: Array<string>) => string = (
  lines: Array<string>,
): string => {
  let start: number = 0;
  let end: number = lines.length;

  const isEdge: (line: string) => boolean = (line: string): boolean => {
    return line.trim().length === 0 || THEMATIC_BREAK.test(line);
  };

  while (start < end && isEdge(lines[start] || "")) {
    start++;
  }

  while (end > start && isEdge(lines[end - 1] || "")) {
    end--;
  }

  return lines.slice(start, end).join("\n");
};

/*
 * "Match Criteria" -> "match-criteria", "Règles" -> "regles"; a title of no
 * letters -> "". A Latin accent goes; every other script is kept whole.
 */
const toSlug: (text: string) => string = (text: string): string => {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
};

export const readHelpDocument: (markdown: string) => HelpDocument = (
  markdown: string,
): HelpDocument => {
  const lines: Array<string> = (markdown || "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const headings: Array<HeadingLine> = findHelpHeadings(lines);

  if (headings.length === 0) {
    return { summary: trimHelpText(lines), sections: [] };
  }

  const topLevel: number = Math.min(
    ...headings.map((heading: HeadingLine): number => {
      return heading.level;
    }),
  );

  const topics: Array<HeadingLine> = headings.filter(
    (heading: HeadingLine): boolean => {
      return heading.level === topLevel;
    },
  );

  const usedIds: Set<string> = new Set<string>();
  const sections: Array<HelpSection> = [];

  topics.forEach((topic: HeadingLine, position: number): void => {
    const next: HeadingLine | undefined = topics[position + 1];
    const body: string = trimHelpText(
      lines.slice(topic.index + 1, next ? next.index : lines.length),
    );
    const title: string = getHelpHeadingText(topic.text);

    // A heading with nothing under it has nothing to open.
    if (!body || !title) {
      return;
    }

    const baseId: string = toSlug(title) || `topic-${sections.length + 1}`;
    let id: string = baseId;
    let copy: number = 2;

    while (usedIds.has(id)) {
      id = `${baseId}-${copy}`;
      copy++;
    }

    usedIds.add(id);
    sections.push({ id: id, title: title, markdown: body });
  });

  return {
    summary: trimHelpText(lines.slice(0, topics[0]!.index)),
    sections: sections,
  };
};

export default readHelpDocument;
