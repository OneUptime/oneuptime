import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { readRepoFile } from "./InventoryAndApiDocsSupport";
import { DATA_OBSERVABILITY_API_ROUTES } from "Common/Types/DataObservability/DataObservabilityApiTypes";

/*
 * What the Lineage and Pipelines page, the AI and API page and the
 * in-product documentation say of lineage's newest promises, in every
 * language, on the English lines:
 *
 *  - every lineage view shows only the tables and pipelines the reader's
 *    role may read, never another by name or in a count (#9526);
 *  - the Lineage Map says how many tables it left out, and starts from a
 *    database or a search of the whole project - Search Whole Project, and
 *    Show Whole Map back - as its route does with dataStoreId or search
 *    (#6547);
 *  - a pipeline's page follows a column across the pipeline, as its route
 *    does with withColumns (#6854);
 *  - an alert's arrow of a pipeline an alert it caused is on says
 *    Consequence, in the word its card says (#6853);
 *  - on a table's page Ask AI knows which table "this table" is, and the
 *    lineage answer counts the tables further away once each (#6735,
 *    #6734).
 *
 * Every language names what the Dashboard draws as its Dashboard draws it.
 */

const LINEAGE_PAGE: string = "data-observability/lineage-and-pipelines";
const API_PAGE: string = "data-observability/ai-and-api";
const MAP_ROUTE: string = `POST /api${DATA_OBSERVABILITY_API_ROUTES.lineageMap}`;
const PIPELINE_ROUTE: string = `POST /api${DATA_OBSERVABILITY_API_ROUTES.pipelineLineage}`;
const DATABASE_BODY: string = '`{ "dataStoreId": "<database ID>" }`';
const SEARCH_BODY: string = '`{ "search": "orders" }`';
const WITH_COLUMNS: string = '`"withColumns": true`';

type LinesFunction = (lang: string, page: string) => Array<string>;

const linesOf: LinesFunction = (lang: string, page: string): Array<string> => {
  return readPage(lang, page).split("\n");
};

// The one line of a page that holds all of these, or a failure naming what was looked for.
const lineWith: (
  lang: string,
  page: string,
  parts: Array<string>,
) => { line: string; index: number } = (
  lang: string,
  page: string,
  parts: Array<string>,
): { line: string; index: number } => {
  const found: Array<{ line: string; index: number }> = linesOf(lang, page)
    .map((line: string, index: number): { line: string; index: number } => {
      return { line, index };
    })
    .filter((candidate: { line: string; index: number }): boolean => {
      return parts.every((part: string): boolean => {
        return candidate.line.includes(part);
      });
    });

  if (found.length !== 1) {
    throw new Error(
      `${lang}/${page}: expected one line with ${parts.join(" + ")}, found ${found.length}`,
    );
  }

  return found[0]!;
};

// How often a bold label is on a line.
const timesNamed: (line: string, label: string) => number = (
  line: string,
  label: string,
): number => {
  return line.split(`**${label}**`).length - 1;
};

describe("Data Observability docs: who sees lineage, the map's starting points, a pipeline's columns", () => {
  it("the English page says every lineage view shows only what the reader's role may read, never another table or pipeline, nor counted", () => {
    const line: string = lineWith("en", LINEAGE_PAGE, [
      "shows only the tables and pipelines your role lets you read",
    ]).line;

    expect(line).toContain("**Lineage Map**");
    expect(line).toContain("what OneUptime AI and the API tell");
    expect(line).toContain(
      "A role limited to what its members own, or to some labels, never sees another table or pipeline",
    );
    expect(line).toContain("not counted among the tables further away");
  });

  it("the English map paragraph says how many tables a map leaves out, and where else it starts, with the route's bodies", () => {
    const line: string = lineWith("en", LINEAGE_PAGE, [
      `\`${MAP_ROUTE}\``,
    ]).line;

    expect(line).toContain(
      "A map with more says how many tables it left out, each counted once",
    );
    expect(line).toContain("pick a database to map the flows of its tables");
    expect(line).toContain("**Search Whole Project**");
    expect(line).toContain("**Show Whole Map** goes back.");
    expect(line).toContain(DATABASE_BODY);
    expect(line).toContain(SEARCH_BODY);
  });

  it("the English pipeline paragraph says a column it writes is followed across it", () => {
    const line: string = lineWith("en", LINEAGE_PAGE, [
      "A pipeline's page draws its **Lineage**",
    ]).line;

    expect(line).toContain(
      "Pick one of the columns it writes to follow it across the pipeline: up to the column of each table it reads that it was built from, and down to each table it writes it to.",
    );
  });

  it("the English alert paragraph says a consequence's pipeline on an arrow says Consequence, and the picker's order", () => {
    const line: string = lineWith("en", LINEAGE_PAGE, [
      "**Explore Lineage**",
    ]).line;

    expect(line).toContain(
      "An alert it caused on a pipeline drawn on an arrow says **Consequence** there in the same way",
    );
    expect(line).toContain(
      "the column picker offers the check's column first, then the table's other columns in its own order",
    );
  });

  it("the English AI page says the answer counts once, knows the page's table, and tells only of what may be read; its routes take the new bodies", () => {
    const bullet: string = lineWith("en", API_PAGE, [
      "- **What is this table built from?**",
    ]).line;

    expect(bullet).toContain(
      "It counts the tables further than it tells once each",
    );
    expect(bullet).toContain(
      'Opened on a table\'s page, Ask AI knows which table "this table" is and asks about that one',
    );
    expect(bullet).toContain(
      "it tells only of the tables and pipelines the person who asks may read",
    );
    expect(
      lineWith("en", API_PAGE, [`| \`${PIPELINE_ROUTE}\` |`]).line,
    ).toContain(`${WITH_COLUMNS} for the columns its runs moved`);

    const map: string = lineWith("en", API_PAGE, [`| \`${MAP_ROUTE}\` |`]).line;

    expect(map).toContain(DATABASE_BODY);
    expect(map).toContain(SEARCH_BODY);
  });

  it("the in-product documentation says the same", () => {
    const page: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Pages/DataObservability/Documentation.tsx",
    );

    expect(page).toContain(
      "Pick one of the columns it writes to follow it across the pipeline",
    );
    expect(page).toContain(
      'send \\`"withColumns": true\\` for the columns its runs moved',
    );
    expect(page).toContain(
      "Lineage shows only the tables and pipelines your role lets you read: one you may not read is never drawn, named on an arrow, or counted.",
    );
    expect(page).toContain(
      "An alert it caused on a pipeline drawn on an arrow says **Consequence** there in the same way",
    );
    expect(page).toContain(
      'Opened on a table\'s page, Ask AI knows which table "this table" is',
    );
  });

  it("the Dashboard draws the buttons the pages name", () => {
    const map: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Pages/DataObservability/LineageMap.tsx",
    );

    expect(map).toContain('title="Search Whole Project"');
    expect(map).toContain('title="Show Whole Map"');
  });

  describe.each(DOCS_LANGUAGES)("%s", (lang: string) => {
    it("says on the English line, naming the Lineage Map as its Dashboard does, that every lineage view shows only what the role may read", () => {
      const english: number = lineWith("en", LINEAGE_PAGE, [
        "shows only the tables and pipelines your role lets you read",
      ]).index;
      const own: { line: string; index: number } = lineWith(
        lang,
        LINEAGE_PAGE,
        [`**${drawnDashboardLabel(lang, "Lineage Map")}**`, "OneUptime AI"],
      );

      expect({
        lang,
        index: own.index,
        namesLineageTab: own.line.includes(
          `**${drawnDashboardLabel(lang, "Lineage")}**`,
        ),
      }).toEqual({ lang, index: english, namesLineageTab: true });
    });

    it("names Search Whole Project and Show Whole Map as its Dashboard draws them, with the route's bodies, on the English map line", () => {
      const english: number = lineWith("en", LINEAGE_PAGE, [
        `\`${MAP_ROUTE}\``,
      ]).index;
      const own: { line: string; index: number } = lineWith(
        lang,
        LINEAGE_PAGE,
        [`\`${MAP_ROUTE}\``],
      );

      expect({
        lang,
        index: own.index,
        search: own.line.includes(
          `**${drawnDashboardLabel(lang, "Search Whole Project")}**`,
        ),
        back: own.line.includes(
          `**${drawnDashboardLabel(lang, "Show Whole Map")}**`,
        ),
        database: own.line.includes(DATABASE_BODY),
        words: own.line.includes(SEARCH_BODY),
      }).toEqual({
        lang,
        index: english,
        search: true,
        back: true,
        database: true,
        words: true,
      });
    });

    it("says on the English alert line that a consequence's pipeline on an arrow says Consequence: once for its card, once for its arrow", () => {
      const own: string = lineWith(lang, LINEAGE_PAGE, [
        `**${drawnDashboardLabel(lang, "Explore Lineage")}**`,
      ]).line;

      expect({
        lang,
        consequence: timesNamed(own, drawnDashboardLabel(lang, "Consequence")),
      }).toEqual({ lang, consequence: 2 });
    });

    it("says a pipeline's column is followed across it, on the English pipeline line", () => {
      const englishLines: Array<string> = linesOf("en", LINEAGE_PAGE);
      const index: number = englishLines.findIndex((line: string): boolean => {
        return line.startsWith("A pipeline's page draws its **Lineage**");
      });
      const own: string = linesOf(lang, LINEAGE_PAGE)[index] || "";

      expect(index).toBeGreaterThan(-1);
      // The paragraph of the pipeline's Lineage, grown by its sentence as the English one did.
      expect({
        lang,
        namesLineage: own.includes(
          `**${drawnDashboardLabel(lang, "Lineage")}**`,
        ),
        // Chinese and Japanese say it in about a quarter of the characters.
        isLonger: own.length > englishLines[index]!.length / 4,
      }).toEqual({ lang, namesLineage: true, isLonger: true });
    });

    it("lists the routes' new bodies on the AI page", () => {
      expect(
        lineWith(lang, API_PAGE, [`| \`${PIPELINE_ROUTE}\` |`]).line,
      ).toContain(WITH_COLUMNS);

      const map: string = lineWith(lang, API_PAGE, [
        `| \`${MAP_ROUTE}\` |`,
      ]).line;

      expect({
        lang,
        database: map.includes(DATABASE_BODY),
        words: map.includes(SEARCH_BODY),
      }).toEqual({ lang, database: true, words: true });
    });
  });
});
