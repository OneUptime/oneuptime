import { DOCS_LANGUAGES, readPage } from "./DocsContentSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { readRepoFile } from "./InventoryAndApiDocsSupport";

/*
 * What the Data Observability pages say OneUptime AI can tell about a table
 * (#6663). The overview's OneUptime AI line, its line for the AI page and
 * the Lineage and Pipelines page's card for the AI page say that Ask AI,
 * Slack, Microsoft Teams and AI agents can ask what a table is built from,
 * and that a data alert's investigation reads the table's lineage.
 *
 * These hold the claims to the tools that make them true, and every
 * language's lines to the words the Dashboard draws: Ask AI as its menu
 * names it, and lineage as the table's Lineage tab names it, so a reader
 * finds the same word on the page and in the product.
 */

const OVERVIEW: string = "data-observability/index";
const LINEAGE_PAGE: string = "data-observability/lineage-and-pipelines";
const AI_PAGE: string = "data-observability/ai-and-api";
const AI_PAGE_LINK: string = "(/docs/data-observability/ai-and-api)";

type LinesFunction = (lang: string, page: string) => Array<string>;

const linesOf: LinesFunction = (lang: string, page: string): Array<string> => {
  return readPage(lang, page).split("\n");
};

type LineFunction = (lang: string) => string;

const onlyOne: (lang: string, what: string, found: Array<string>) => string = (
  lang: string,
  what: string,
  found: Array<string>,
): string => {
  if (found.length !== 1) {
    throw new Error(
      `${lang}: expected one ${what}, found ${found.length}: ${found.join(" | ")}`,
    );
  }

  return found[0] as string;
};

// The overview's bold "OneUptime AI ..." line, which ends with a link to the AI page.
const overviewAiLine: LineFunction = (lang: string): string => {
  return onlyOne(
    lang,
    "OneUptime AI line on the overview",
    linesOf(lang, OVERVIEW).filter((line: string): boolean => {
      return line.startsWith("- **") && line.includes(AI_PAGE_LINK);
    }),
  );
};

// The overview's line for the AI page in its list of pages.
const overviewPageListLine: LineFunction = (lang: string): string => {
  return onlyOne(
    lang,
    "AI page line in the overview's list of pages",
    linesOf(lang, OVERVIEW).filter((line: string): boolean => {
      return line.startsWith("- [") && line.includes(AI_PAGE_LINK);
    }),
  );
};

// The Lineage and Pipelines page's card for the AI page, under Next steps.
const lineagePageAiCard: LineFunction = (lang: string): string => {
  return onlyOne(
    lang,
    "AI page card on the Lineage and Pipelines page",
    linesOf(lang, LINEAGE_PAGE).filter((line: string): boolean => {
      return line.startsWith("- [") && line.includes(AI_PAGE_LINK);
    }),
  );
};

// The AI page's lead: the first line of text under its title.
const aiPageLead: LineFunction = (lang: string): string => {
  return onlyOne(
    lang,
    "lead on the AI page",
    linesOf(lang, AI_PAGE)
      .slice(1)
      .filter((line: string): boolean => {
        return line.trim().length > 0;
      })
      .slice(0, 1),
  );
};

/*
 * Whether a line names lineage as the language's Lineage tab does. A long
 * word may take an ending in a sentence (Russian writes "происхождения" for
 * the tab's "Происхождение"), so its last letter is left out of the match;
 * a short one (Japanese, Korean, Chinese, Persian) is matched whole.
 */
const namesLineage: (lang: string, line: string) => boolean = (
  lang: string,
  line: string,
): boolean => {
  const word: string = drawnDashboardLabel(lang, "Lineage").toLowerCase();
  const stem: string = word.length >= 8 ? word.slice(0, -1) : word;

  return line.toLowerCase().includes(stem);
};

// AIToolbox's list of tools: from its opening to the bracket that closes it.
const TOOL_LIST_START: string =
  "private static readonly tools: Array<ObservabilityTool> = [";

const toolListOf: (source: string) => string = (source: string): string => {
  const start: number = source.indexOf(TOOL_LIST_START);

  if (start < 0) {
    throw new Error(`AIToolbox has no "${TOOL_LIST_START}"`);
  }

  const end: number = source.indexOf("\n  ];", start);

  if (end < 0) {
    throw new Error("AIToolbox's list of tools never closes");
  }

  return source.slice(start, end + 1);
};

describe("Data Observability docs: what OneUptime AI tells about a table's lineage", () => {
  it("the tools the pages promise are the ones Ask AI and the MCP server serve", () => {
    const tools: string = readRepoFile(
      "Common/Server/Utils/AI/Toolbox/DataObservabilityTools.ts",
    );
    // The tools Ask AI, Slack, Microsoft Teams and investigations may call.
    const toolboxList: string = toolListOf(
      readRepoFile("Common/Server/Utils/AI/Toolbox/Index.ts"),
    );
    const mcp: string = readRepoFile(
      "App/FeatureSet/MCP/Tools/WorkflowTools.ts",
    );

    for (const [name, className] of [
      ["get_data_table_freshness", "GetDataTableFreshnessTool"],
      ["get_data_table_lineage", "GetDataTableLineageTool"],
    ] as Array<[string, string]>) {
      expect({ name, defined: tools.includes(`name: "${name}"`) }).toEqual({
        name,
        defined: true,
      });
      expect({
        className,
        listed: toolboxList.includes(`\n    ${className},\n`),
      }).toEqual({ className, listed: true });
      expect({ name, served: mcp.includes(`name: "${name}"`) }).toEqual({
        name,
        served: true,
      });
    }
  });

  it("the English lines say what the lineage tool answers", () => {
    expect(overviewAiLine("en")).toContain(
      "Investigations of data alerts start from the table's writers, runs and lineage;",
    );
    expect(overviewAiLine("en")).toContain(
      "Ask AI, Slack, Microsoft Teams and AI agents can ask whether a table is fresh and what it is built from;",
    );
    expect(overviewPageListLine("en")).toContain(
      "freshness and lineage for AI agents",
    );
    expect(lineagePageAiCard("en")).toContain(
      "Ask AI and AI agents can ask what a table is built from.",
    );
  });

  it("the website's Data Observability page says it too", () => {
    const page: string = readRepoFile("Home/Views/data-observability.ejs");

    expect(page.replace(/\s+/g, " ")).toContain(
      "Investigations of data alerts start from the table's writers, runs and lineage. Ask in Slack or Microsoft Teams whether a table is fresh and what it is built from,",
    );
  });

  describe.each(DOCS_LANGUAGES)("%s", (lang: string) => {
    it("the AI page's lead names lineage as the Lineage tab does", () => {
      expect({ lang, lead: namesLineage(lang, aiPageLead(lang)) }).toEqual({
        lang,
        lead: true,
      });
    });

    it("the overview's OneUptime AI line names Ask AI as its menu does, and lineage as its tab does", () => {
      const line: string = overviewAiLine(lang);

      expect({
        lang,
        askAi: line.includes(drawnDashboardLabel(lang, "Ask AI")),
        lineage: namesLineage(lang, line),
      }).toEqual({ lang, askAi: true, lineage: true });
    });

    it("the overview's line for the AI page names lineage", () => {
      expect({
        lang,
        lineage: namesLineage(lang, overviewPageListLine(lang)),
      }).toEqual({ lang, lineage: true });
    });

    it("the Lineage and Pipelines page's card for the AI page names Ask AI as its menu does", () => {
      expect({
        lang,
        askAi: lineagePageAiCard(lang).includes(
          drawnDashboardLabel(lang, "Ask AI"),
        ),
      }).toEqual({ lang, askAi: true });
    });
  });
});
