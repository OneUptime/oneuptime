import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { readRepoFile } from "./InventoryAndApiDocsSupport";

/*
 * What the Data Observability pages say an investigation of a data alert,
 * and a table alert's Data card, read (#9562), in every language:
 *
 *  - the investigation's report is read by everyone who may see the alert,
 *    so it reads only the tables and pipelines nobody set apart with
 *    Owners or Labels, beside the alert's own, and never names or counts
 *    another (DataAlertContext, DataObservabilityReadScope
 *    .nobodyInParticular, and the data tools it calls);
 *  - the Data card tells only of what the reader's role lets them read, as
 *    the alert's Lineage card does (DataAlertExplanation).
 *
 * The English lines are held to their words; every language's lines to
 * naming Owners, Labels and Lineage as its Dashboard draws them.
 */

const AI_PAGE: string = "data-observability/ai-and-api";
const TABLE_HEALTH_PAGE: string = "data-observability/table-health";
const AI_SRE_LINK: string = "(/docs/ai/ai-sre)";

const INVESTIGATION_SCOPE: string =
  "Everyone who may see the alert reads its report, so it reads only the tables and pipelines nobody has set apart with **Owners** or **Labels**, and the alert's own table or pipeline. It never names or counts any other, in what it starts from or in what it asks along the way.";
const DATA_CARD_SCOPE: string =
  "Like the alert's **Lineage** card, it tells only of the tables and pipelines your role lets you read.";

// The one line of a page that holds all of these, or a failure naming what was looked for.
const lineWith: (lang: string, page: string, parts: Array<string>) => string = (
  lang: string,
  page: string,
  parts: Array<string>,
): string => {
  const found: Array<string> = readPage(lang, page)
    .split("\n")
    .filter((line: string): boolean => {
      return parts.every((part: string): boolean => {
        return line.includes(part);
      });
    });

  if (found.length !== 1) {
    throw new Error(
      `${lang}/${page}: expected one line with ${parts.join(" + ")}, found ${found.length}`,
    );
  }

  return found[0]!;
};

// The investigations bullet: the AI page's one bullet linking to AI SRE.
const investigationsBullet: (lang: string) => string = (
  lang: string,
): string => {
  return lineWith(lang, AI_PAGE, ["- **", AI_SRE_LINK]);
};

// The Data card's paragraph on the table health page.
const dataCardParagraph: (lang: string) => string = (lang: string): string => {
  return lineWith(lang, TABLE_HEALTH_PAGE, [
    `**${drawnDashboardLabel(lang, "Data")}**`,
    `**${drawnDashboardLabel(lang, "Lineage")}**`,
  ]);
};

describe("Data Observability docs: what an investigation and a Data card read (#9562)", () => {
  it("the English investigations bullet says it reads only what nobody set apart, and the alert's own", () => {
    expect(investigationsBullet("en")).toContain(INVESTIGATION_SCOPE);
  });

  it("the English Data card paragraph says it tells only of what the role lets you read", () => {
    expect(dataCardParagraph("en")).toContain(
      "A table's alert has a **Data** card that says why it most likely happened",
    );
    expect(dataCardParagraph("en")).toContain(DATA_CARD_SCOPE);
  });

  it("the in-product documentation says the same", () => {
    const page: string = readRepoFile(
      "App/FeatureSet/Dashboard/src/Pages/DataObservability/Documentation.tsx",
    );

    expect(page).toContain(INVESTIGATION_SCOPE);
    expect(page).toContain(
      `Below that is what depends on it: tables, dashboards, services and the people who own them. ${DATA_CARD_SCOPE}`,
    );
  });

  it("the investigation's scope is OneUptime's: the context and the tools read as nobody in particular", () => {
    const context: string = readRepoFile(
      "Common/Server/Utils/DataObservability/DataAlertContext.ts",
    );
    const tools: string = readRepoFile(
      "Common/Server/Utils/AI/Toolbox/DataObservabilityTools.ts",
    );

    expect(context).toContain("DataObservabilityReadScope.nobodyInParticular");
    expect(tools).toContain("DataObservabilityReadScope.nobodyInParticular");
  });

  describe.each(DOCS_LANGUAGES)("%s", (lang: string) => {
    it("the investigations bullet names Owners and Labels as its Dashboard draws them", () => {
      const bullet: string = investigationsBullet(lang);

      expect({
        lang,
        owners: bullet.includes(`**${drawnDashboardLabel(lang, "Owners")}**`),
        labels: bullet.includes(`**${drawnDashboardLabel(lang, "Labels")}**`),
      }).toEqual({ lang, owners: true, labels: true });
    });

    it("the Data card paragraph names the alert's Lineage card as its Dashboard draws it", () => {
      expect({ lang, paragraph: dataCardParagraph(lang).length > 0 }).toEqual({
        lang,
        paragraph: true,
      });
    });
  });
});
