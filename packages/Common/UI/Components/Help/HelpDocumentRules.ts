import readHelpDocument, {
  findHelpHeadings,
  getHelpHeadingText,
  HelpDocument,
} from "./HelpDocument";

/*
 * WHAT A HELP DOCUMENT HAS TO BE (#8889, Docs/ux/README.md#help-dialogs).
 *
 * The shape every help dialog is read in (HelpContent): a lead, which the
 * dialog shows as "In short", then "##" topics. A document that strays from
 * it still opens, but reads worse: with no lead there is nothing to read in
 * ten seconds, a "###" document's topics are the wrong level, a heading
 * that repeats the dialog's title is the title twice, a drawn line ("---")
 * splits a topic the dialog already sets apart, and a lead of a paragraph
 * is not "in short". HelpDialogsGuard holds every page's help to this.
 */

// About three sentences: the most a lead says before it is a topic.
export const HELP_LEAD_MAX_LENGTH: number = 400;

export const HELP_TOPIC_HEADING_LEVEL: number = 2;

const THEMATIC_BREAK: RegExp = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE_OPENING: RegExp = /^ {0,3}(`{3,}|~{3,})/;

export enum HelpDocumentProblem {
  NoLead = "It has no lead: say what the thing is before the first topic.",
  LongLead = "Its lead is longer than three sentences: move the rest into a topic.",
  TopicsNotLevelTwo = "Its topics are not ## headings.",
  HeadingRepeatsTitle = "A heading repeats the dialog's title.",
  DrawnLine = "It draws a line (---) between parts: the dialog sets its topics apart itself.",
}

const normalize: (text: string) => string = (text: string): string => {
  return getHelpHeadingText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
};

// The lines outside fenced code: a "---" in a YAML sample is code.
const linesOutsideCode: (lines: Array<string>) => Array<string> = (
  lines: Array<string>,
): Array<string> => {
  const result: Array<string> = [];
  let openFence: string | null = null;

  for (const line of lines) {
    const fence: RegExpMatchArray | null = line.match(FENCE_OPENING);

    if (openFence) {
      if (
        fence &&
        fence[1]![0] === openFence[0] &&
        fence[1]!.length >= openFence.length &&
        line.trim() === fence[1]
      ) {
        openFence = null;
      }

      continue;
    }

    if (fence) {
      openFence = fence[1]!;
      continue;
    }

    result.push(line);
  }

  return result;
};

export const getHelpDocumentProblems: (
  markdown: string,
  options?: { title?: string | undefined },
) => Array<HelpDocumentProblem> = (
  markdown: string,
  options?: { title?: string | undefined },
): Array<HelpDocumentProblem> => {
  const problems: Array<HelpDocumentProblem> = [];
  const lines: Array<string> = (markdown || "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const document: HelpDocument = readHelpDocument(markdown);
  const headings: Array<{ index: number; level: number; text: string }> =
    findHelpHeadings(lines);

  if (!document.summary) {
    problems.push(HelpDocumentProblem.NoLead);
  } else if (
    document.sections.length > 0 &&
    document.summary.length > HELP_LEAD_MAX_LENGTH
  ) {
    problems.push(HelpDocumentProblem.LongLead);
  }

  if (headings.length > 0) {
    const topLevel: number = Math.min(
      ...headings.map((heading: { level: number }): number => {
        return heading.level;
      }),
    );

    if (topLevel !== HELP_TOPIC_HEADING_LEVEL) {
      problems.push(HelpDocumentProblem.TopicsNotLevelTwo);
    }
  }

  if (options?.title) {
    const title: string = normalize(options.title);

    if (
      headings.some((heading: { text: string }): boolean => {
        return normalize(heading.text) === title;
      })
    ) {
      problems.push(HelpDocumentProblem.HeadingRepeatsTitle);
    }
  }

  if (
    linesOutsideCode(lines).some((line: string): boolean => {
      return THEMATIC_BREAK.test(line);
    })
  ) {
    problems.push(HelpDocumentProblem.DrawnLine);
  }

  return problems;
};

export default getHelpDocumentProblems;
