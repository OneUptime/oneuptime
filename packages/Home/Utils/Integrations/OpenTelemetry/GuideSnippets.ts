import {
  GuideQuestion,
  GuideSnippet,
  GuideStep,
  GuideTab,
  GuideTabs,
  OpenTelemetryGuide,
} from "./GuideTypes";

/*
 * How many characters of a code line a guide's page shows before the line
 * scrolls, on a laptop and wider: the article is 48rem wide and its code
 * 13px of a monospace font about 0.6em a character. A block in a section
 * shows 94; one inside a numbered step or an answer, which sit further in,
 * shows 87.
 */
export const SECTION_CODE_COLUMNS: number = 94;
export const INDENTED_CODE_COLUMNS: number = 87;

/*
 * The columns a tab takes in a code block (the guides' stylesheet sets
 * tab-size: 2): Go's code is indented with tabs, as gofmt writes it.
 */
export const CODE_TAB_SIZE: number = 2;

// How many columns a line takes on the page, its tabs as wide as they are drawn.
export function lineColumns(line: string): number {
  let columns: number = 0;

  for (const character of line) {
    columns +=
      character === "\t" ? CODE_TAB_SIZE - (columns % CODE_TAB_SIZE) : 1;
  }

  return columns;
}

// A snippet, and how wide its page shows it.
export interface PlacedSnippet {
  snippet: GuideSnippet;
  // The characters of a line the block shows before the line scrolls.
  columns: number;
}

function placed(
  snippets: Array<GuideSnippet>,
  columns: number,
): Array<PlacedSnippet> {
  return snippets.map((snippet: GuideSnippet): PlacedSnippet => {
    return { snippet: snippet, columns: columns };
  });
}

function tabSnippets(tabs: GuideTabs | undefined): Array<GuideSnippet> {
  return tabs
    ? tabs.tabs.flatMap((tab: GuideTab): Array<GuideSnippet> => {
        return tab.snippets;
      })
    : [];
}

function stepSnippets(steps: Array<GuideStep>): Array<PlacedSnippet> {
  return steps.flatMap((step: GuideStep): Array<PlacedSnippet> => {
    return placed(
      [...(step.snippets || []), ...tabSnippets(step.tabs)],
      INDENTED_CODE_COLUMNS,
    );
  });
}

function questionSnippets(
  questions: Array<GuideQuestion>,
): Array<PlacedSnippet> {
  return questions.flatMap((question: GuideQuestion): Array<PlacedSnippet> => {
    return placed(question.snippets || [], INDENTED_CODE_COLUMNS);
  });
}

// Every snippet a guide's page shows, in the page's order, with its width.
export function placedGuideSnippets(
  guide: OpenTelemetryGuide,
): Array<PlacedSnippet> {
  return [
    ...placed(guide.install.snippets, SECTION_CODE_COLUMNS),
    ...placed(tabSnippets(guide.install.tabs), SECTION_CODE_COLUMNS),
    ...placed(tabSnippets(guide.configure.tabs), SECTION_CODE_COLUMNS),
    ...stepSnippets(guide.setup.steps),
    ...placed(guide.autoInstrumentation.snippets, SECTION_CODE_COLUMNS),
    ...placed(guide.manualSpans.snippets, SECTION_CODE_COLUMNS),
    ...placed(guide.logs.snippets, SECTION_CODE_COLUMNS),
    ...placed(guide.metrics.snippets, SECTION_CODE_COLUMNS),
    ...placed(guide.sampling.snippets, SECTION_CODE_COLUMNS),
    ...placed(guide.deploy.snippets, SECTION_CODE_COLUMNS),
    ...stepSnippets(guide.verify.steps),
    ...questionSnippets(guide.troubleshooting),
    ...questionSnippets(guide.faq),
  ];
}

// Every snippet a guide's page shows, in the page's order.
export function guideSnippets(guide: OpenTelemetryGuide): Array<GuideSnippet> {
  return placedGuideSnippets(guide).map(
    (placedSnippet: PlacedSnippet): GuideSnippet => {
      return placedSnippet.snippet;
    },
  );
}

/*
 * The lines of a snippet that run past the width its page shows, so a
 * reader on a laptop has to scroll the block sideways to read them. A line
 * one word makes too long is left alone: a web address or a package's
 * coordinates that would not fit on a line of their own either.
 */
export function linesPastColumns(code: string, columns: number): Array<string> {
  return code.split("\n").filter((line: string): boolean => {
    if (lineColumns(line) <= columns) {
      return false;
    }

    const indentation: number = lineColumns(
      line.slice(0, line.length - line.trimStart().length),
    );

    return !line
      .trim()
      .split(" ")
      .some((word: string): boolean => {
        return indentation + word.length > columns;
      });
  });
}

/*
 * One block of a file, word for word as the file the end-to-end check ran
 * holds it: from the line that starts with `firstLine` (after its
 * indentation) to the first line after it that is `closing` at that same
 * indentation - a Ruby or Elixir method and its `end`, a PHP or Rust
 * function and its `}`, a call and its `)`. A guide shows a fragment of a
 * file this way, so the fragment cannot drift from the file.
 */
export function blockOf(
  source: string,
  firstLine: string,
  closing: string,
): string {
  const lines: Array<string> = source.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trimStart().startsWith(firstLine);
  });
  const indentation: string =
    start >= 0
      ? lines[start]!.slice(
          0,
          lines[start]!.length - lines[start]!.trimStart().length,
        )
      : "";
  const end: number = lines.findIndex(
    (line: string, index: number): boolean => {
      return start >= 0 && index > start && line === `${indentation}${closing}`;
    },
  );

  if (start < 0 || end < 0) {
    throw new Error(
      `No block starts with ${firstLine} and ends with ${closing}`,
    );
  }

  return lines.slice(start, end + 1).join("\n");
}

export function findGuideSnippet(
  guide: OpenTelemetryGuide,
  id: string,
): GuideSnippet | undefined {
  return guideSnippets(guide).find((snippet: GuideSnippet): boolean => {
    return snippet.id === id;
  });
}
