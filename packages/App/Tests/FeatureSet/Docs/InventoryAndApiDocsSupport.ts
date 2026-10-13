import { readPage } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import { sectionInLanguage } from "./NetworkDocsLabels";
import fs from "fs";
import path from "path";

/*
 * What InventoryDocsFacts and ApiReferenceDocsFacts read the pages and the
 * product's sources with. Kept here, not in either suite: importing a
 * .test.ts file runs its tests.
 *
 * Every helper throws a message naming what it looked for when it is not
 * there, so a renamed heading or table fails the one test that reads it,
 * with that message, and nothing runs while Jest collects the tests.
 */

export const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

// A bold span of a line.
const BOLD_SPAN: RegExp = /\*\*([^*\n]+?)\*\*/g;
// An inline code span of a line.
const CODE_SPAN: RegExp = /`([^`\n]+)`/g;

// A file of the repository's packages, by its path from packages/.
export function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

// The .ts files of a folder of packages/ and its subfolders, by their paths from packages/.
export function sourceFilesUnder(relativeFolder: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(path.join(PACKAGES_DIR, relativeFolder), {
    withFileTypes: true,
  })) {
    const child: string = `${relativeFolder}/${entry.name}`;

    if (entry.isDirectory()) {
      found.push(...sourceFilesUnder(child));
    } else if (entry.name.endsWith(".ts")) {
      found.push(child);
    }
  }

  return found;
}

export function englishPage(page: string): string {
  return readPage("en", page);
}

/*
 * The English section under a heading: from it to the next heading of its
 * level or above, code blocks read as code (a "# comment" in one ends
 * nothing).
 */
export function englishSection(page: string, heading: string): string {
  return sectionInLanguage("en", page, heading);
}

/*
 * A page's lead: the first line of text after its title, as the docs write
 * one, under the title and before the cards.
 */
export function leadOf(markdown: string): string {
  const lead: string | undefined = markdown
    .split("\n")
    .slice(1)
    .find((line: string): boolean => {
      return line.trim().length > 0;
    });

  if (lead === undefined) {
    throw new Error("The page has no lead under its title");
  }

  return lead;
}

// The line of a text that starts with `start`.
export function lineStartingWith(text: string, start: string): string {
  const line: string | undefined = text
    .split("\n")
    .find((candidate: string): boolean => {
      return candidate.startsWith(start);
    });

  if (line === undefined) {
    throw new Error(`No line starts with "${start}"`);
  }

  return line;
}

export function bold(name: string): string {
  return `**${name}**`;
}

// Every bold span of a text, in order, repeats included.
export function boldIn(text: string): Array<string> {
  return Array.from(text.matchAll(BOLD_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// Every inline code span of a text, in order.
export function codeIn(text: string): Array<string> {
  return Array.from(text.matchAll(CODE_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

/*
 * The body rows of the table of a text whose header's first cell is
 * `firstHeaderCell` ("Kind of item"), header and delimiter rows left out.
 */
export function tableWithHeader(
  text: string,
  firstHeaderCell: string,
): Array<Array<string>> {
  const table: Array<Array<string>> | undefined = tables(text).find(
    (candidate: Array<Array<string>>): boolean => {
      return candidate[0]?.[0] === firstHeaderCell;
    },
  );

  if (!table) {
    throw new Error(`No table has the header "${firstHeaderCell}"`);
  }

  return table.slice(1);
}

// The body rows of the first table of a text.
export function firstTableRows(text: string): Array<Array<string>> {
  const table: Array<Array<string>> | undefined = tables(text)[0];

  if (!table) {
    throw new Error("The text has no table");
  }

  return table.slice(1);
}

// The row of a table whose first cell is `firstCell`.
export function rowStartingWith(
  rows: Array<Array<string>>,
  firstCell: string,
): Array<string> {
  const row: Array<string> | undefined = rows.find(
    (candidate: Array<string>): boolean => {
      return candidate[0] === firstCell;
    },
  );

  if (!row) {
    throw new Error(`No row starts with "${firstCell}"`);
  }

  return row;
}

// "a, b and c" (or "a, b or c"): a list as the pages write one.
export function listOf(
  items: ReadonlyArray<string>,
  conjunction: string,
): string {
  if (items.length <= 1) {
    return items.join("");
  }

  return `${items.slice(0, -1).join(", ")} ${conjunction} ${
    items[items.length - 1]
  }`;
}
