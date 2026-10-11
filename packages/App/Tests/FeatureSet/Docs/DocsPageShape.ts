import { boldSpans, prose } from "./DocsTranslationChecks";

/*
 * How a translated docs page lies beside its English page, as plain
 * functions of the Markdown: what each line is, the steps and tab labels of
 * its components, its bold labels and menu paths, and spans it opens but
 * never closes. The translation suites of docs task 18b (ProbeDocs-
 * Translations, StatusPageDocsTranslations) hold every language to these;
 * a later suite imports them rather than copying them.
 */

// How the docs write a path through the product's menus: "A → B → C".
export const PATH_SEPARATOR: string = " → ";

const HEADING_LINE: RegExp = /^(#{1,6})\s/;
const FENCE_LINE: RegExp = /^\s*```/;
const TAB_LINE: RegExp = /^@tab\s+(.+)$/;
const CONTAINER_LINE: RegExp = /^:::/;
// An inline code span, which may hold asterisks of its own.
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
// The row under a table's header: "| --- | :---: |".
const TABLE_DELIMITER_ROW: RegExp = /^\|\s*:?-/;

/*
 * What each line is, where it matters for laying a translation beside its
 * English page: a heading of a level, a table row, a fence, a component's
 * opening or closing line, a tab, or text. A translation with the same shape
 * has every one of them on the English one's line, so a later English edit
 * shows where it lands in every language.
 */
export function lineShape(markdown: string): Array<string> {
  return markdown.split("\n").map((line: string): string => {
    const heading: RegExpMatchArray | null = line.match(HEADING_LINE);

    if (FENCE_LINE.test(line)) {
      return "```";
    }

    if (heading) {
      return heading[1] as string;
    }

    if (line.startsWith("|")) {
      return "|";
    }

    if (TAB_LINE.test(line)) {
      return "@tab";
    }

    if (CONTAINER_LINE.test(line)) {
      return ":::";
    }

    return line.trim() ? "text" : "";
  });
}

// The number of :::steps steps on a page: the headings that start a step.
export function stepCount(markdown: string): number {
  let depth: number = 0;
  let stepDepth: number | null = null;
  let inFence: boolean = false;
  let steps: number = 0;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    if (line.trim() === ":::steps") {
      depth = 1;
      stepDepth = null;
      continue;
    }

    if (depth > 0 && CONTAINER_LINE.test(line.trim())) {
      // A component nested in a step opens, or one closes.
      depth += line.trim() === ":::" ? -1 : 1;
      continue;
    }

    const heading: RegExpMatchArray | null = line.match(HEADING_LINE);

    if (depth === 1 && heading) {
      const level: number = (heading[1] as string).length;

      // The highest heading level inside a :::steps block starts each step.
      if (stepDepth === null || level < stepDepth) {
        stepDepth = level;
      }

      if (level === stepDepth) {
        steps++;
      }
    }
  }

  return steps;
}

// The label of every @tab, in order.
export function tabLabels(markdown: string): Array<string> {
  return markdown
    .split("\n")
    .map((line: string): string | null => {
      return line.match(TAB_LINE)?.[1]?.trim() || null;
    })
    .filter((label: string | null): label is string => {
      return label !== null;
    });
}

// The bold spans of a page that are one label, not a path.
export function boldLabels(markdown: string): Array<string> {
  return boldSpans(prose(markdown)).filter((span: string): boolean => {
    return !span.includes(PATH_SEPARATOR);
  });
}

// The bold spans of a page that are a path, as their parts.
export function boldPaths(markdown: string): Array<Array<string>> {
  return boldSpans(prose(markdown))
    .filter((span: string): boolean => {
      return span.includes(PATH_SEPARATOR);
    })
    .map((span: string): Array<string> => {
      return span.split(PATH_SEPARATOR).map((segment: string): string => {
        return segment.trim();
      });
    });
}

/*
 * The prose lines that open a bold span or an inline code span and never
 * close it.
 */
export function unbalancedLines(markdown: string): Array<string> {
  return prose(markdown)
    .split("\n")
    .filter((line: string): boolean => {
      const ticks: number = line.split("`").length - 1;
      const outsideCode: string = line.replace(INLINE_CODE_SPAN, "");
      const stars: number = outsideCode.split("**").length - 1;

      return ticks % 2 !== 0 || stars % 2 !== 0;
    });
}

/*
 * Every table of a page, in order, as rows of trimmed cells (the header
 * first, without the delimiter row).
 */
export function tables(markdown: string): Array<Array<Array<string>>> {
  const found: Array<Array<Array<string>>> = [];
  let current: Array<Array<string>> | null = null;

  for (const line of prose(markdown).split("\n")) {
    if (!line.startsWith("|")) {
      current = null;
      continue;
    }

    if (!current) {
      current = [];
      found.push(current);
    }

    if (TABLE_DELIMITER_ROW.test(line)) {
      continue;
    }

    current.push(
      line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        }),
    );
  }

  return found;
}
