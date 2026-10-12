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

// A component's opening line, ":::tabs" or ":::details Summary", and its name.
const CONTAINER_OPENING: RegExp = /^:::([a-z]+)(?:\s+(.*))?$/;

export interface DocsTabPanel {
  label: string;
  // The panel's lines, between its @tab line and the next @tab or the close.
  body: string;
}

export interface DocsDetailsBlock {
  summary: string;
  // The block's lines, between its :::details line and its closing :::.
  body: string;
}

interface OpenContainer {
  name: string;
  summary: string;
  start: number;
  lines: Array<string>;
  // The open panel of a :::tabs container.
  panel: { label: string; start: number; lines: Array<string> } | null;
}

interface FoundPanel extends DocsTabPanel {
  start: number;
}

interface FoundDetails extends DocsDetailsBlock {
  start: number;
}

/*
 * Walk a page's components: every tab panel and every :::details block,
 * each with the lines inside it (a nested component's lines included), in
 * the order they open. Lines in code blocks are content, never components.
 */
function walkComponents(markdown: string): {
  panels: Array<FoundPanel>;
  details: Array<FoundDetails>;
} {
  const panels: Array<FoundPanel> = [];
  const details: Array<FoundDetails> = [];
  const open: Array<OpenContainer> = [];
  let inFence: boolean = false;

  const append: (line: string) => void = (line: string): void => {
    for (const container of open) {
      container.lines.push(line);
      container.panel?.lines.push(line);
    }
  };

  const closePanel: (container: OpenContainer) => void = (
    container: OpenContainer,
  ): void => {
    if (container.panel) {
      panels.push({
        label: container.panel.label,
        start: container.panel.start,
        body: container.panel.lines.join("\n"),
      });
      container.panel = null;
    }
  };

  markdown.split("\n").forEach((line: string, index: number): void => {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      append(line);
      return;
    }

    if (inFence) {
      append(line);
      return;
    }

    const trimmed: string = line.trim();
    const innermost: OpenContainer | undefined = open[open.length - 1];
    const tab: RegExpMatchArray | null = trimmed.match(TAB_LINE);

    if (tab && innermost?.name === "tabs") {
      closePanel(innermost);
      innermost.panel = {
        label: (tab[1] as string).trim(),
        start: index,
        lines: [],
      };
      return;
    }

    if (trimmed === ":::" && innermost) {
      open.pop();
      closePanel(innermost);

      if (innermost.name === "details") {
        details.push({
          summary: innermost.summary,
          start: innermost.start,
          body: innermost.lines.join("\n"),
        });
      }

      append(line);
      return;
    }

    const opening: RegExpMatchArray | null = trimmed.match(CONTAINER_OPENING);

    if (opening) {
      append(line);
      open.push({
        name: opening[1] as string,
        summary: (opening[2] || "").trim(),
        start: index,
        lines: [],
        panel: null,
      });
      return;
    }

    append(line);
  });

  const byStart: (a: { start: number }, b: { start: number }) => number = (
    a: { start: number },
    b: { start: number },
  ): number => {
    return a.start - b.start;
  };

  return { panels: panels.sort(byStart), details: details.sort(byStart) };
}

// Every tab panel of a page, in order: its label and the lines inside it.
export function tabPanels(markdown: string): Array<DocsTabPanel> {
  return walkComponents(markdown).panels.map(
    (panel: FoundPanel): DocsTabPanel => {
      return { label: panel.label, body: panel.body };
    },
  );
}

/*
 * The lines inside a page's tab panel with this label: the first such
 * panel, or the one at `index` among the panels with that label. A page
 * that has no such panel fails the test that asks for it.
 */
export function tabPanel(
  markdown: string,
  label: string,
  index: number = 0,
): string {
  const found: DocsTabPanel | undefined = tabPanels(markdown).filter(
    (panel: DocsTabPanel): boolean => {
      return panel.label === label;
    },
  )[index];

  if (!found) {
    throw new Error(`No tab panel "${label}" (number ${index + 1}) on the page`);
  }

  return found.body;
}

// Every :::details block of a page, in order: its summary and its lines.
export function detailsBlocks(markdown: string): Array<DocsDetailsBlock> {
  return walkComponents(markdown).details.map(
    (block: FoundDetails): DocsDetailsBlock => {
      return { summary: block.summary, body: block.body };
    },
  );
}

/*
 * The lines inside the :::details block whose summary is this text. A page
 * that has none fails the test that asks for it.
 */
export function detailsBody(markdown: string, summary: string): string {
  const found: DocsDetailsBlock | undefined = detailsBlocks(markdown).find(
    (block: DocsDetailsBlock): boolean => {
      return block.summary === summary;
    },
  );

  if (!found) {
    throw new Error(`No :::details block "${summary}" on the page`);
  }

  return found.body;
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
