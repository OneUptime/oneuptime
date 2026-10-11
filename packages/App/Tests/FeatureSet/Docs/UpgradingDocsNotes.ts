import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import fs from "fs";
import path from "path";

/*
 * The upgrade guide (installation/upgrading) in every docs language, read
 * the way the suites that pin one of its notes need it.
 *
 * Every translation has the English page's shape: the same headings in the
 * same places, and the "Other changes in 14" list with the English notes in
 * the English order. So a note is found in a translation by where its
 * English note is - the n-th item of that list - and a section by where its
 * English heading is, never by words a translation words its own way.
 */

export const UPGRADING_PAGE: string = "installation/upgrading";

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const FENCE: RegExp = /^\s*```/;
const HEADING: RegExp = /^(#{1,6})\s+(.+?)\s*$/;
const DETAILS_OPEN: RegExp = /^:::details\s/;
const CONTAINER_CLOSE: RegExp = /^:::\s*$/;
const TOP_LEVEL_ITEM: RegExp = /^- /;
const WHITESPACE: RegExp = /\s+/g;

export interface UpgradingHeading {
  level: number;
  text: string;
  // The heading's anchor, as the docs make it from the heading's Markdown.
  slug: string;
  // 0-based line of the page.
  line: number;
}

// The upgrade guide's Markdown in a language.
export function upgradingPage(language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${UPGRADING_PAGE}.md`),
    "utf8",
  );
}

// Line breaks and runs of spaces read as one space.
export function flattened(text: string): string {
  return text.replace(WHITESPACE, " ").trim();
}

// The headings below the title, in order, outside code samples.
export function upgradingHeadings(language: string): Array<UpgradingHeading> {
  const headings: Array<UpgradingHeading> = [];
  let inFence: boolean = false;

  upgradingPage(language)
    .split("\n")
    .forEach((line: string, index: number) => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return;
      }

      if (inFence || index === 0) {
        return;
      }

      const match: RegExpExecArray | null = HEADING.exec(line);

      if (match) {
        headings.push({
          level: match[1]!.length,
          text: match[2]!,
          slug: slugifyMarkdownHeading(match[2]!),
          line: index,
        });
      }
    });

  return headings;
}

/*
 * The heading of a language's page in the place of the English heading with
 * this text (the English Markdown, without its #s).
 */
export function headingAtEnglishPlace(
  language: string,
  englishText: string,
): UpgradingHeading {
  const index: number = upgradingHeadings("en").findIndex(
    (heading: UpgradingHeading): boolean => {
      return heading.text === englishText;
    },
  );

  if (index < 0) {
    throw new Error(`The English upgrade guide has no heading "${englishText}"`);
  }

  const heading: UpgradingHeading | undefined =
    upgradingHeadings(language)[index];

  if (!heading) {
    throw new Error(
      `The ${language} upgrade guide has no heading in the place of "${englishText}"`,
    );
  }

  return heading;
}

/*
 * A section of a language's page: the heading in the place of the English
 * one, and every line up to the next heading of its level or above.
 */
export function sectionAtEnglishPlace(
  language: string,
  englishText: string,
): string {
  const heading: UpgradingHeading = headingAtEnglishPlace(
    language,
    englishText,
  );
  const next: UpgradingHeading | undefined = upgradingHeadings(language).find(
    (candidate: UpgradingHeading): boolean => {
      return candidate.line > heading.line && candidate.level <= heading.level;
    },
  );
  const lines: Array<string> = upgradingPage(language).split("\n");

  return lines.slice(heading.line, next ? next.line : lines.length).join("\n");
}

/*
 * The top-level list items of some Markdown, in order, each on one line with
 * the lines it wraps onto.
 */
export function listItems(markdown: string): Array<string> {
  const items: Array<string> = [];

  for (const line of markdown.split("\n")) {
    if (TOP_LEVEL_ITEM.test(line)) {
      items.push(line);
      continue;
    }

    if (items.length > 0 && line.startsWith("  ")) {
      items[items.length - 1] = `${items[items.length - 1]} ${line.trim()}`;
      continue;
    }

    if (items.length > 0 && line.trim() !== "") {
      break;
    }
  }

  return items;
}

/*
 * The numbers some text states, as Latin digits: the Persian pages write
 * numbers in Persian digits.
 */
export function statedNumbers(text: string): Array<number> {
  const latin: string = text.replace(/[۰-۹]/g, (digit: string): string => {
    return String(digit.charCodeAt(0) - "۰".charCodeAt(0));
  });

  return Array.from(
    latin.matchAll(/(?<![\d.])\d+(?![\d.])/g),
    (match: RegExpMatchArray): number => {
      return Number(match[0]);
    },
  );
}

/*
 * The notes of the "Other changes in 14" list - the first collapsible block
 * of the page - one entry a top-level item, with its continuation lines,
 * nested items and paragraphs, in order.
 */
export function otherChangesItems(language: string): Array<string> {
  const lines: Array<string> = upgradingPage(language).split("\n");
  const open: number = lines.findIndex((line: string): boolean => {
    return DETAILS_OPEN.test(line);
  });

  if (open < 0) {
    throw new Error(`The ${language} upgrade guide has no collapsible block`);
  }

  const items: Array<Array<string>> = [];

  for (const line of lines.slice(open + 1)) {
    if (CONTAINER_CLOSE.test(line)) {
      break;
    }

    if (TOP_LEVEL_ITEM.test(line)) {
      items.push([line]);
      continue;
    }

    items[items.length - 1]?.push(line);
  }

  return items.map((item: Array<string>): string => {
    return item.join("\n").trimEnd();
  });
}

/*
 * The note of a language's "Other changes in 14" list in the place of the
 * English note that opens with this bold lead (its first words will do).
 */
export function otherChangesItemAtEnglishPlace(
  language: string,
  englishLead: string,
): string {
  const index: number = otherChangesItems("en").findIndex(
    (item: string): boolean => {
      return flattened(item).startsWith(`- **${englishLead}`);
    },
  );

  if (index < 0) {
    throw new Error(
      `The English "Other changes in 14" list has no note opening "${englishLead}"`,
    );
  }

  const item: string | undefined = otherChangesItems(language)[index];

  if (item === undefined) {
    throw new Error(
      `The ${language} "Other changes in 14" list has no note in the place of "${englishLead}"`,
    );
  }

  return item;
}
