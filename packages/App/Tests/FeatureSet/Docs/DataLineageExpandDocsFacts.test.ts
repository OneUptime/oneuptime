import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { readRepoFile } from "./InventoryAndApiDocsSupport";
import { DATA_OBSERVABILITY_API_ROUTES } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import { MAX_DATA_LINEAGE_NEIGHBORS } from "Common/Types/DataObservability/DataTableLineage";

/*
 * What the Lineage and Pipelines page and the AI and API page say about
 * drawing more of a lineage diagram where it is (#6667), following one
 * column up and down it (#6665), and, on an alert's page, the column a
 * column check's alert opens with followed (#6783) and the Cause its
 * cause's pipeline says on its arrow (#6687).
 *
 * The English page says how many tables a card draws each way - the
 * number the diagram draws, MAX_DATA_LINEAGE_NEIGHBORS - and names the
 * diagram's Reset diagram button and Follow a column picker; every
 * language names them as its Dashboard draws them, on the same line as
 * English, so a reader finds the same words on the page and in the
 * product. The API page lists the route the diagram asks, at the address
 * it is served at, and the table-lineage route's withColumns, in every
 * language. The alert's Lineage paragraph says, in every language and on
 * the English line, that a cause on a pipeline says Cause - the word the
 * cause's card says - on its arrow, and that an alert from a check on one
 * column opens with it followed; the alert-lineage route's row names the
 * `column` it answers with, and the investigations bullet that the column
 * is followed through the lineage.
 */

const LINEAGE_PAGE: string = "data-observability/lineage-and-pipelines";
const API_PAGE: string = "data-observability/ai-and-api";
const EXPAND_ROUTE: string = `POST /api${DATA_OBSERVABILITY_API_ROUTES.lineageExpand}`;
const TABLE_LINEAGE_ROUTE: string = `POST /api${DATA_OBSERVABILITY_API_ROUTES.tableLineage}`;
const ALERT_LINEAGE_ROUTE: string = `POST /api${DATA_OBSERVABILITY_API_ROUTES.alertLineage("<alert ID>")}`;
const AI_SRE_LINK: string = "(/docs/ai/ai-sre)";

const NUMBER_WORDS: Readonly<Record<number, string>> = {
  5: "five",
  10: "ten",
  12: "twelve",
  15: "fifteen",
  20: "twenty",
};

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

describe("Data Observability docs: drawing more of a lineage diagram, and following a column", () => {
  it("the English page says how many tables a card draws, as the diagram draws them", () => {
    const words: string | undefined = NUMBER_WORDS[MAX_DATA_LINEAGE_NEIGHBORS];

    expect(words).toBeDefined();

    const line: string = lineWith("en", LINEAGE_PAGE, ["**+14**"]).line;

    expect(line).toContain(
      `A card draws at most ${words} tables each way and counts the rest, such as **+14**.`,
    );
    expect(line).toContain(`draw up to ${words} more of them where they are`);
    expect(line).toContain("**Reset diagram**");
  });

  it("the English page says a column is followed on the Lineage tab, renamed or not, and when it may go further", () => {
    const line: string = lineWith("en", LINEAGE_PAGE, [
      "**Follow a column**",
    ]).line;

    expect(line).toContain("On the **Lineage** tab");
    expect(line).toContain("even where it was renamed on the way");
    expect(line).toContain(
      "An arrow whose sources name no columns may carry it further than is highlighted",
    );
  });

  it("the English alert paragraph says the cause's pipeline says Cause on its arrow, and a column check's alert opens with its column followed", () => {
    const line: string = lineWith("en", LINEAGE_PAGE, [
      "**Explore Lineage**",
    ]).line;

    expect(line).toContain(
      "When the cause is on a pipeline drawn on an arrow, the arrow says **Cause** under the pipeline's name.",
    );
    expect(line).toContain(
      "An alert from a check on one column, such as a Null Percent check on `customer_id`, opens with that column followed beside these ways, as on the table's **Lineage** tab",
    );
    expect(line).toContain(
      "Pick another of the table's columns there, or clear it to see the ways alone.",
    );
    // The picker is named once on the page, where the table's Lineage tab is.
    expect(line).not.toContain("**Follow a column**");
  });

  it("the English AI page says what the route and an investigation tell of a column check's column", () => {
    expect(
      lineWith("en", API_PAGE, [`| \`${ALERT_LINEAGE_ROUTE}\` |`]).line,
    ).toContain(
      "and for an alert from a check on one column, its `column` and the columns each arrow carries",
    );
    expect(lineWith("en", API_PAGE, [AI_SRE_LINK]).line).toContain(
      "For an alert from a check on one column, it also follows that column through the lineage: the columns it is built from upstream and the columns built from it downstream, table by table",
    );
  });

  it("the in-product documentation says the same, with both routes", () => {
    const page: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Pages/DataObservability/Documentation.tsx",
    );

    expect(page).toContain(
      `A card draws at most ${NUMBER_WORDS[MAX_DATA_LINEAGE_NEIGHBORS]} tables each way and counts the rest, such as **+14**`,
    );
    expect(page).toContain("**Reset diagram**");
    expect(page).toContain("**Follow a column**");
    expect(page).toContain(`\\\`${EXPAND_ROUTE}\\\``);
    expect(page).toContain('\\`"withColumns": true\\`');
    // An alert's page: the cause's pipeline on its arrow, and a column check's column followed.
    expect(page).toContain(
      "When the cause is on a pipeline drawn on an arrow, the arrow says **Cause** under the pipeline's name.",
    );
    expect(page).toContain(
      "An alert from a check on one column, such as a Null Percent check on \\`customer_id\\`, opens with that column followed",
    );
    expect(page).toContain(
      "with the \\`column\\` a column check's alert reads and the columns each arrow carries",
    );
    expect(page).toContain(
      "For an alert from a check on one column, it also follows that column through the lineage",
    );
  });

  it("the Dashboard draws the button and the picker the pages name", () => {
    const shell: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Components/DataObservability/LineageDiagram.tsx",
    );

    expect(shell).toContain('title="Reset diagram"');
    expect(shell).toContain('placeholder={translationKey("Follow a column")}');
    // And the alert's card the Explore Lineage the paragraph names.
    expect(
      readRepoFile(
        "App/FeatureSet/Dashboard/src/Components/DataObservability/AlertLineageDiagram.tsx",
      ),
    ).toContain('title: "Explore Lineage",');
  });

  describe.each(DOCS_LANGUAGES)("%s", (lang: string) => {
    it("names Reset diagram as its Dashboard draws it, on the English line", () => {
      const english: number = lineWith("en", LINEAGE_PAGE, ["**+14**"]).index;
      const own: { line: string; index: number } = lineWith(
        lang,
        LINEAGE_PAGE,
        [lang === "fa" ? "**+۱۴**" : "**+14**"],
      );

      expect({
        lang,
        index: own.index,
        named: own.line.includes(
          `**${drawnDashboardLabel(lang, "Reset diagram")}**`,
        ),
      }).toEqual({ lang, index: english, named: true });
    });

    it("names Follow a column and the Lineage tab as its Dashboard draws them, on the English line", () => {
      const english: number = lineWith("en", LINEAGE_PAGE, [
        "**Follow a column**",
      ]).index;
      const own: { line: string; index: number } = lineWith(
        lang,
        LINEAGE_PAGE,
        [`**${drawnDashboardLabel(lang, "Follow a column")}**`],
      );

      expect({
        lang,
        index: own.index,
        namesLineageTab: own.line.includes(
          `**${drawnDashboardLabel(lang, "Lineage")}**`,
        ),
      }).toEqual({ lang, index: english, namesLineageTab: true });
    });

    it("says on the English line that the cause's pipeline says Cause on its arrow, in the card's word, and that a column check's alert opens with its column followed", () => {
      const english: number = lineWith("en", LINEAGE_PAGE, [
        "**Explore Lineage**",
      ]).index;
      const own: { line: string; index: number } = lineWith(
        lang,
        LINEAGE_PAGE,
        [`**${drawnDashboardLabel(lang, "Explore Lineage")}**`],
      );
      const cause: string = `**${drawnDashboardLabel(lang, "Cause")}**`;

      expect({
        lang,
        index: own.index,
        // Once for the cause's card, once for its pipeline's arrow.
        causeNamed: own.line.split(cause).length - 1,
        namesLineageTab: own.line.includes(
          `**${drawnDashboardLabel(lang, "Lineage")}**`,
        ),
        namesTheColumn: own.line.includes("`customer_id`"),
        // The check as its Dashboard names it (#7223): Anteil NULL-Werte in German.
        namesTheCheck: own.line.includes(
          drawnDashboardLabel(lang, "Null Percent"),
        ),
        namesThePicker: own.line.includes(
          `**${drawnDashboardLabel(lang, "Follow a column")}**`,
        ),
      }).toEqual({
        lang,
        index: english,
        causeNamed: 2,
        namesLineageTab: true,
        namesTheColumn: true,
        namesTheCheck: true,
        namesThePicker: false,
      });
    });

    it("names the column the alert-lineage route answers with, and an investigation's column, on the English lines", () => {
      const route: { line: string; index: number } = lineWith(lang, API_PAGE, [
        `| \`${ALERT_LINEAGE_ROUTE}\` |`,
      ]);
      const investigations: { line: string; index: number } = lineWith(
        lang,
        API_PAGE,
        [AI_SRE_LINK],
      );
      const englishInvestigations: string = lineWith("en", API_PAGE, [
        AI_SRE_LINK,
      ]).line;

      expect({
        lang,
        namesColumn: route.line.includes("`column`"),
        investigationsLine: investigations.index,
        // The investigations bullet grew by its sentence, as the English one did.
        isLonger: investigations.line.length > englishInvestigations.length / 3,
      }).toEqual({
        lang,
        namesColumn: true,
        investigationsLine: lineWith("en", API_PAGE, [AI_SRE_LINK]).index,
        isLonger: true,
      });
    });

    it("lists the route that draws more, after the alert's lineage, and the table lineage's withColumns", () => {
      const lines: Array<string> = linesOf(lang, API_PAGE);
      const expand: { line: string; index: number } = lineWith(lang, API_PAGE, [
        `| \`${EXPAND_ROUTE}\` |`,
      ]);

      expect(lines[expand.index - 1]).toContain(
        "| `POST /api/data-observability/alerts/<alert ID>/lineage` |",
      );

      for (const field of [
        "`nodeId`",
        "`side`",
        "`focusNodeId`",
        "`tables`",
        "`dataDashboardIds`",
      ]) {
        expect({ lang, field, named: expand.line.includes(field) }).toEqual({
          lang,
          field,
          named: true,
        });
      }

      expect(
        lineWith(lang, API_PAGE, [`| \`${TABLE_LINEAGE_ROUTE}\` |`]).line,
      ).toContain('`"withColumns": true`');
    });
  });
});
