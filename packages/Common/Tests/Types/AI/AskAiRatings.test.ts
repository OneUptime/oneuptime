import {
  ASK_AI_DOCS_TOOLS,
  ASK_AI_RATINGS_DAYS,
  ASK_AI_RATINGS_ROUTE,
  ASK_AI_SOURCE_OF_NO_PRODUCT_TITLES,
  AskAiSource,
  AskAiSourceOfNoProduct,
  countAskAiSources,
  getAskAiAnswerSources,
  getAskAiSourceTitle,
  isAskAiSource,
  readAskAiProjectRatings,
  readAskAiSourceCounts,
} from "../../../Types/AI/AskAiRatings";
import ProductKey from "../../../Types/Product/ProductKey";
import {
  TOOL_PRODUCTS,
  TOOLS_OF_NO_PRODUCT,
  getToolProducts,
} from "../../../Server/Utils/AI/Toolbox/ToolProducts";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT ASK AI'S ANSWERS RATED DOWN DREW ON (#7365): the products whose
 * tools an answer ran, the docs, other data or nothing - read from the
 * tools' names alone, so nobody reading the counts reads a word of a
 * conversation, which stays private to the person who had it.
 */

describe("what one answer drew on", () => {
  test("each product its tools belong to, once", () => {
    expect(
      getAskAiAnswerSources({
        toolNames: ["search_logs", "log_histogram", "query_incidents"],
        getToolProducts: getToolProducts,
      }),
    ).toEqual([ProductKey.Logs, ProductKey.Incidents]);
  });

  test("the docs, for searching or reading them, and finding a Dashboard page", () => {
    for (const tool of ASK_AI_DOCS_TOOLS) {
      expect(TOOLS_OF_NO_PRODUCT).toContain(tool);
      expect(
        getAskAiAnswerSources({
          toolNames: [tool],
          getToolProducts: getToolProducts,
        }),
      ).toEqual([AskAiSourceOfNoProduct.Docs]);
    }
  });

  test("other OneUptime data, for a tool of no one product", () => {
    expect(
      getAskAiAnswerSources({
        toolNames: ["query_probes", "get_setup_health"],
        getToolProducts: getToolProducts,
      }),
    ).toEqual([AskAiSourceOfNoProduct.OtherData]);
  });

  test("nothing, for an answer that ran no tool", () => {
    expect(
      getAskAiAnswerSources({
        toolNames: [],
        getToolProducts: getToolProducts,
      }),
    ).toEqual([AskAiSourceOfNoProduct.Nothing]);
    expect(
      getAskAiAnswerSources({
        toolNames: [""],
        getToolProducts: getToolProducts,
      }),
    ).toEqual([AskAiSourceOfNoProduct.Nothing]);
  });

  test("every tool of the toolbox lands somewhere a dashboard can name", () => {
    for (const tool of [
      ...Object.keys(TOOL_PRODUCTS),
      ...TOOLS_OF_NO_PRODUCT,
    ]) {
      for (const source of getAskAiAnswerSources({
        toolNames: [tool],
        getToolProducts: getToolProducts,
      })) {
        expect({ tool, source, isOne: isAskAiSource(source) }).toEqual({
          tool,
          source,
          isOne: true,
        });
        expect(getAskAiSourceTitle(source).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("the answers rated down, counted", () => {
  test("an answer counts once for each thing it drew on; most first, then in the products menu's order", () => {
    expect(
      countAskAiSources([
        [ProductKey.Incidents, ProductKey.Logs],
        [ProductKey.Logs],
        [AskAiSourceOfNoProduct.Docs],
        [AskAiSourceOfNoProduct.Nothing],
        [ProductKey.Monitors, ProductKey.Monitors],
      ]),
    ).toEqual([
      { source: ProductKey.Logs, answers: 2 },
      { source: ProductKey.Monitors, answers: 1 },
      { source: ProductKey.Incidents, answers: 1 },
      { source: AskAiSourceOfNoProduct.Docs, answers: 1 },
      { source: AskAiSourceOfNoProduct.Nothing, answers: 1 },
    ]);
    expect(countAskAiSources([])).toEqual([]);
  });
});

describe("the server's answer, as a dashboard reads it", () => {
  test("a project's ratings, with only the counts that are one", () => {
    expect(
      readAskAiProjectRatings({
        sinceDays: 90,
        helpful: 3,
        notHelpful: 1,
        ratedDownDrewOn: [
          { source: "logs", answers: 1 },
          { source: "made-up", answers: 4 },
          { source: "docs", answers: -1 },
          { source: "docs", answers: 1.5 },
          "logs",
        ],
      }),
    ).toEqual({
      sinceDays: 90,
      helpful: 3,
      notHelpful: 1,
      ratedDownDrewOn: [{ source: ProductKey.Logs, answers: 1 }],
    });
  });

  test("anything that is not an answer is none", () => {
    expect(readAskAiProjectRatings(null)).toBeNull();
    expect(readAskAiProjectRatings([])).toBeNull();
    expect(readAskAiProjectRatings({ helpful: 1 })).toBeNull();
    expect(
      readAskAiProjectRatings({ sinceDays: 90, helpful: -1, notHelpful: 0 }),
    ).toBeNull();
    expect(readAskAiSourceCounts("logs")).toEqual([]);
  });
});

describe("a source's name", () => {
  test("a product by its menu's word, and the rest in the dashboards' words", () => {
    const titles: Array<[AskAiSource, string]> = [
      [ProductKey.Logs, "Logs"],
      [ProductKey.OnCall, "On-Call"],
      [AskAiSourceOfNoProduct.Docs, "OneUptime docs"],
      [AskAiSourceOfNoProduct.OtherData, "Other OneUptime data"],
      [AskAiSourceOfNoProduct.Nothing, "No data read"],
    ];

    for (const [source, title] of titles) {
      expect(getAskAiSourceTitle(source)).toBe(title);
    }
    expect(Object.keys(ASK_AI_SOURCE_OF_NO_PRODUCT_TITLES).sort()).toEqual(
      Object.values(AskAiSourceOfNoProduct).sort(),
    );
  });

  test("ninety days, on the route a project's owners read", () => {
    expect(ASK_AI_RATINGS_DAYS).toBe(90);
    expect(ASK_AI_RATINGS_ROUTE).toBe("/ai-chat/ratings");
  });
});
