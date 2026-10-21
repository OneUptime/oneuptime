import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every list in Security Events heads its card the way every table in the
 * product does: with the table's own toolbar header (BaseModelTable), the
 * title, the search and the buttons on one line and the description under
 * them, across the card.
 *
 * The case pages, Playbooks, Detection Rules, Threat Intel and Connections
 * once set the stacked header on their tables, from before tables had a
 * header of their own. Beside the side menu that put the search and the
 * main button on a line of their own, between the title and the
 * description. This holds every table in Security to the table's header.
 */

const SOURCE_ROOT: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

// Where the Security Events pages and the lists they draw live.
const SECURITY_FOLDERS: ReadonlyArray<string> = [
  "Pages/SecurityEvents",
  "Components/SecurityCase",
  "Components/SecurityEvents",
  "Components/SecurityPlaybook",
  "Components/SecurityOverview",
];

const CARD_PROPS_START: string = "cardProps={{";

function sourceFilesIn(folder: string): Array<string> {
  const absolute: string = path.join(SOURCE_ROOT, folder);

  if (!fs.existsSync(absolute)) {
    return [];
  }

  return fs
    .readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const relative: string = path.join(folder, entry.name);

      if (entry.isDirectory()) {
        return sourceFilesIn(relative);
      }

      return entry.name.endsWith(".tsx") ? [relative] : [];
    });
}

/*
 * Each `cardProps={{ ... }}` a file hands a table, read to its closing
 * brace: the card the table draws its header on.
 */
function cardPropsBlocks(source: string): Array<string> {
  const blocks: Array<string> = [];
  let from: number = 0;

  for (;;) {
    const start: number = source.indexOf(CARD_PROPS_START, from);

    if (start === -1) {
      return blocks;
    }

    let depth: number = 0;
    let end: number = start + "cardProps=".length;

    for (; end < source.length; end++) {
      const character: string = source[end]!;

      if (character === "{") {
        depth++;
      } else if (character === "}") {
        depth--;

        if (depth === 0) {
          break;
        }
      }
    }

    blocks.push(source.slice(start, end + 1));
    from = end + 1;
  }
}

interface TableCard {
  file: string;
  block: string;
}

const TABLE_CARDS: Array<TableCard> = SECURITY_FOLDERS.flatMap(
  (folder: string): Array<TableCard> => {
    return sourceFilesIn(folder).flatMap((file: string): Array<TableCard> => {
      const source: string = fs.readFileSync(
        path.join(SOURCE_ROOT, file),
        "utf8",
      );

      return cardPropsBlocks(source).map((block: string): TableCard => {
        return { file, block };
      });
    });
  },
);

function filesWithTables(): Array<string> {
  return Array.from(
    new Set(
      TABLE_CARDS.map((card: TableCard): string => {
        return card.file.split(path.sep).join("/");
      }),
    ),
  ).sort();
}

describe("the lists in Security Events", () => {
  test("are found where the pages draw them, so the rule below reads them all", () => {
    expect(filesWithTables()).toEqual(
      expect.arrayContaining([
        "Components/SecurityCase/SecurityCasesTable.tsx",
        "Components/SecurityEvents/SecurityEventConnectionsTable.tsx",
        "Pages/SecurityEvents/DetectionRules.tsx",
        "Pages/SecurityEvents/Playbooks.tsx",
        "Pages/SecurityEvents/ThreatIntel.tsx",
      ]),
    );
    // Threat Intel draws two: its feeds and their indicators.
    expect(
      TABLE_CARDS.filter((card: TableCard): boolean => {
        return card.file.endsWith("ThreatIntel.tsx");
      }),
    ).toHaveLength(2);
  });

  test.each(
    TABLE_CARDS.map((card: TableCard): [string, string] => {
      return [card.file.split(path.sep).join("/"), card.block];
    }),
  )(
    "%s heads its table with the table's own toolbar header",
    (_file: string, block: string) => {
      expect(block).not.toContain("headerLayout");
    },
  );
});
