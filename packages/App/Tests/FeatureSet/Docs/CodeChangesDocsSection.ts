import { readPage } from "./DocsContentSupport";
import { dashboardLocale, readAsTheDocsWriteIt } from "./DocsDashboardLabels";
import {
  AI_ACTION_CODE_FILE,
  AIActionSentence,
  aiActionList,
  aiActionPluralSentence,
  aiActionSentence,
} from "Common/Types/AI/AIActionWords";
import {
  createTranslator,
  PluralTemplate,
  Translator,
} from "Common/Types/Translator";

/*
 * THE ASK AI PAGE'S "CODE CHANGES" SECTION (issue #6983), as the code docs
 * suites read it: every caution a code change's card can show is a list
 * item of its own there, quoting the card's line, in the card's order, in
 * every docs language - where they once were sentences of one long bullet
 * in the list of actions. The section sits at the same line in every
 * language, so each is found by the English page's own.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export const ASK_AI_PAGE: string = "ai/ask-ai";

// The English heading, which finds the section in every language.
const ENGLISH_HEADING: string = "## Code changes";

// The files the section's examples name.
export const CODE_DOCS_FILE: string = "src/billing/charge.ts";
export const CODE_DOCS_HIDDEN_FILE: string = "config/servers.ts";
export const CODE_DOCS_BRANCH: string = "fix/login";
export const CODE_DOCS_READ_BRANCH: string = "main";

const linesOf: (language: string) => Array<string> = (
  language: string,
): Array<string> => {
  return readPage(language, ASK_AI_PAGE).split("\n");
};

// Where the section starts and ends on the page: its heading, and the next one.
export const codeChangesSectionRangeOf: (language: string) => {
  start: number;
  end: number;
} = (language: string): { start: number; end: number } => {
  const start: number = linesOf("en").indexOf(ENGLISH_HEADING);
  const lines: Array<string> = linesOf(language);

  if (start < 0 || !lines[start]?.startsWith("## ")) {
    return { start: -1, end: -1 };
  }

  let end: number = start + 1;

  while (end < lines.length && !lines[end]!.startsWith("## ")) {
    end++;
  }

  return { start, end };
};

// The section's lines, its heading first.
export const codeChangesSectionLinesOf: (language: string) => Array<string> = (
  language: string,
): Array<string> => {
  const range: { start: number; end: number } =
    codeChangesSectionRangeOf(language);

  return range.start < 0 ? [] : linesOf(language).slice(range.start, range.end);
};

// The section as one text.
export const codeChangesSectionOf: (language: string) => string = (
  language: string,
): string => {
  return codeChangesSectionLinesOf(language).join("\n");
};

// The cautions the card can show: the items of the section's one nested list.
export const codeChangeCautionsOf: (language: string) => Array<string> = (
  language: string,
): Array<string> => {
  return codeChangesSectionLinesOf(language).filter((line: string) => {
    return line.startsWith("  - ");
  });
};

// The caution item that quotes `line`, or undefined.
export const codeChangeCautionQuoting: (
  language: string,
  line: string,
) => string | undefined = (
  language: string,
  line: string,
): string | undefined => {
  return codeChangeCautionsOf(language).find((item: string) => {
    return item.includes(line);
  });
};

// Where in the card's order the caution quoting `line` is: -1 for none.
export const codeChangeCautionIndex: (
  language: string,
  line: string,
) => number = (language: string, line: string): number => {
  return codeChangeCautionsOf(language).findIndex((item: string) => {
    return item.includes(line);
  });
};

// The section's bullet that starts with `lead` (its bold lead-in, as the language writes it).
export const codeChangesBulletStartingWith: (
  language: string,
  lead: string,
) => string = (language: string, lead: string): string => {
  return (
    codeChangesSectionLinesOf(language).find((line: string) => {
      return line.startsWith(`- ${lead}`);
    }) || ""
  );
};

// The actions list's code-change bullet: the one that points to the section.
export const codeChangeActionBulletOf: (language: string) => string = (
  language: string,
): string => {
  const heading: string = (codeChangesSectionLinesOf(language)[0] || "")
    .replace(/^## /, "")
    .trim();

  return (
    linesOf(language).find((line: string) => {
      return line.startsWith("- ") && line.includes(`[${heading}](#`);
    }) || ""
  );
};

// What a language's Dashboard draws, as a docs page writes it (asTheDocsWriteIt).
export const codeDocsTranslatorFor: (language: string) => Translator = (
  language: string,
): Translator => {
  const words: Record<string, unknown> = dashboardLocale(language);

  return readAsTheDocsWriteIt(
    createTranslator((text: string): string | undefined => {
      const value: unknown = words[text];
      return typeof value === "string" ? value : undefined;
    }, language),
  );
};

// A card's line about one file, as the section quotes it.
export const codeDocsCautionLine: (
  template: PluralTemplate,
  file?: string | undefined,
) => AIActionSentence = (
  template: PluralTemplate,
  file: string = CODE_DOCS_FILE,
): AIActionSentence => {
  return aiActionPluralSentence(template, 1, {
    branch: CODE_DOCS_BRANCH,
    readBranch: CODE_DOCS_READ_BRANCH,
    files: aiActionList([aiActionSentence(AI_ACTION_CODE_FILE, { file })]),
  });
};
