import {
  TRANSLATED_LANGUAGES,
  hasPage,
  listPages,
  readPage,
} from "./DocsContentSupport";
import { isDashboardLabel, writtenDashboardLabel } from "./DocsDashboardLabels";
import { tables } from "./DocsPageShape";
import { describe, expect, test } from "@jest/globals";

/*
 * A TABLE CELL THAT LISTS THE DASHBOARD'S NAMES LISTS THEM ALL IN EVERY
 * LANGUAGE (#8436).
 *
 * The docs suites hold a translated page to the English page's structure:
 * its tables' shapes, its inline code, and its bold labels somewhere on the
 * page. A clause dropped from a table cell passes all of that. #8436's row
 * on the Incoming Request page dropped "and a template leaves it as
 * written" in 16 languages, and the runbook rules' table listed
 * **Incident Description** / **Alert Description** without the event's in
 * six.
 *
 * A clause dropped from prose leaves no mark a test can read without false
 * positives. Comparing a cell's length with the English cell flags faithful
 * concise translations as often as drops: an operator list in Japanese, or
 * "La requête dépasse 1 Mio, ou son entrée 512 Kio". At the threshold that
 * catches #8436's German and French cells, 422 cells are flagged, and in
 * Japanese and Chinese that row sits among 400 shorter ones. Holding every
 * bold label to its own cell instead of the page flags 1,800 cells, most of
 * them words that are labels only by coincidence, which each suite keeps
 * as prose.
 *
 * A cell made only of Dashboard labels joined by " / " does leave a mark:
 * the names themselves. In every language it lists each name as that
 * language's Dashboard draws it, and names it once where two of them are
 * drawn with the same word (Norwegian and Chinese draw an incident's labels
 * and an event's alike). Tables are matched by their order on the page and
 * rows by their order in the table, so a page whose lines shift still lines
 * up. A table whose shape differs is the structure suites' finding, not
 * this one's.
 */

// A cell that is nothing but bold names joined by " / ".
const NAME_LIST: RegExp = /^\*\*[^*]+\*\*(?: \/ \*\*[^*]+\*\*)+$/;
const BOLD: RegExp = /\*\*([^*]+)\*\*/g;

interface NameList {
  page: string;
  table: number;
  row: number;
  column: number;
  names: Array<string>;
}

type Tables = Array<Array<Array<string>>>;

function boldNames(cell: string): Array<string> {
  return Array.from(cell.matchAll(BOLD), (match: RegExpMatchArray): string => {
    return match[1] as string;
  });
}

// Every cell of the English pages that lists Dashboard labels, and where it is.
function englishNameLists(): Array<NameList> {
  const found: Array<NameList> = [];

  for (const page of listPages("en")) {
    tables(readPage("en", page)).forEach(
      (table: Array<Array<string>>, tableIndex: number): void => {
        table.forEach((row: Array<string>, rowIndex: number): void => {
          row.forEach((cell: string, column: number): void => {
            const names: Array<string> = boldNames(cell);

            if (NAME_LIST.test(cell) && names.every(isDashboardLabel)) {
              found.push({
                page,
                table: tableIndex,
                row: rowIndex,
                column,
                names,
              });
            }
          });
        });
      },
    );
  }

  return found;
}

/*
 * The names a list in this language leaves out, as its Dashboard draws
 * them, or null where its table's shape differs from the English one.
 */
function namesLeftOut(
  language: string,
  list: NameList,
  english: Tables,
  translated: Tables,
): Array<string> | null {
  const englishTable: Array<Array<string>> | undefined = english[list.table];
  const table: Array<Array<string>> | undefined = translated[list.table];

  if (
    translated.length !== english.length ||
    !englishTable ||
    !table ||
    table.length !== englishTable.length ||
    (table[list.row] || []).length !== (englishTable[list.row] || []).length
  ) {
    return null;
  }

  const listed: Array<string> = boldNames(
    (table[list.row] as Array<string>)[list.column] as string,
  );
  const drawn: Set<string> = new Set(
    list.names.map((name: string): string => {
      return writtenDashboardLabel(language, name);
    }),
  );

  return Array.from(drawn).filter((name: string): boolean => {
    return !listed.includes(name);
  });
}

const NAME_LISTS: Array<NameList> = englishNameLists();

describe("a table cell that lists the Dashboard's names (#8436)", () => {
  test("is found on the English pages, the runbook rules' table among them", () => {
    expect(NAME_LISTS.length).toBeGreaterThanOrEqual(5);
    expect(
      NAME_LISTS.map((list: NameList): string => {
        return list.names.join(" / ");
      }),
    ).toContain("Incident Description / Alert Description / Event Description");
  });

  test("leaves out a name a translation drops (negative control)", () => {
    const list: NameList = {
      page: "runbooks/rules",
      table: 0,
      row: 0,
      column: 0,
      names: ["Incident Description", "Alert Description", "Event Description"],
    };
    const english: Tables = [
      [
        [
          "**Incident Description** / **Alert Description** / **Event Description**",
        ],
      ],
    ];
    const dropped: Tables = [
      [
        [
          `**${writtenDashboardLabel("de", "Incident Description")}** / **${writtenDashboardLabel("de", "Alert Description")}**`,
        ],
      ],
    ];

    expect(namesLeftOut("de", list, english, dropped)).toEqual([
      writtenDashboardLabel("de", "Event Description"),
    ]);
    // A table of another shape is not this check's to read.
    expect(namesLeftOut("de", list, english, [])).toBeNull();
  });

  test.each(TRANSLATED_LANGUAGES)(
    "%s lists every name as its Dashboard draws it",
    (language: string) => {
      const leftOut: Array<string> = [];

      for (const list of NAME_LISTS) {
        if (!hasPage(language, list.page)) {
          continue;
        }

        const missing: Array<string> | null = namesLeftOut(
          language,
          list,
          tables(readPage("en", list.page)),
          tables(readPage(language, list.page)),
        );

        if (missing && missing.length > 0) {
          leftOut.push(
            `${list.page}, table ${list.table + 1}, row ${list.row + 1}: ${missing.join(", ")}`,
          );
        }
      }

      expect(leftOut).toEqual([]);
    },
  );
});
