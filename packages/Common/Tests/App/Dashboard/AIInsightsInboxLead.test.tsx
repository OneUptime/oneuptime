import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The AI Insights inbox (AI → Insights), rendered for real: it leads with
 * what to look at first (InsightHighlights) above its status strip, its
 * filters and its list - and when the highlights cannot be read, the inbox
 * is the page as before. The list's own order and filters are pinned by
 * AIInsightsListOrdering.test.tsx.
 */

let rows: Array<unknown> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (request: {
        skip: number;
        limit: number;
      }): Promise<unknown> => {
        return {
          data: rows.slice(request.skip, request.skip + request.limit),
          count: rows.length,
          skip: request.skip,
          limit: request.limit,
        };
      },
      count: async (): Promise<number> => {
        return rows.length;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import AIInsightsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/AIInsights/Insights";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";

const WAIT_TIMEOUT: number = 20000;

const ROW_TITLE: string = "Metric drift: metric.1 +80% week-over-week";

function insightRow(index: number): AIInsight {
  const insight: AIInsight = new AIInsight();
  insight.id = new ObjectID(
    `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
  insight.title = `Metric drift: metric.${index} +80% week-over-week`;
  insight.insightType = AIInsightType.MetricDrift;
  insight.severity = AIInsightSeverity.Low;
  insight.status = AIInsightStatus.ActionRequired;
  insight.occurrenceCount = index;
  insight.firstSeenAt = new Date("2026-10-01T00:00:00.000Z");
  insight.lastSeenAt = new Date("2026-10-08T11:48:00.000Z");
  return insight;
}

const HIGHLIGHTS: JSONObject = {
  openCount: 2,
  topFinding: {
    id: "00000000-0000-4000-8000-000000000002",
    title: "Metric drift: metric.2 +80% week-over-week",
    insightType: AIInsightType.MetricDrift,
    severity: AIInsightSeverity.Low,
    occurrenceCount: 2,
    triageSummary: "The nightly batch job doubled its writes.",
  },
  newCount: 0,
  isPartial: false,
};

let postSpy: ReturnType<typeof jest.spyOn>;
let highlightsAnswer: () => Promise<
  HTTPResponse<JSONObject> | HTTPErrorResponse
>;

function follows(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function renderInbox(): void {
  render(
    <MemoryRouter>
      <AIInsightsPage {...({} as any)} />
    </MemoryRouter>,
  );
}

async function waitForRows(): Promise<void> {
  await waitFor(
    () => {
      return expect(screen.getByText(ROW_TITLE)).toBeInTheDocument();
    },
    { timeout: WAIT_TIMEOUT },
  );
}

beforeEach(() => {
  window.history.replaceState(
    window.history.state,
    "",
    "/dashboard/00000000-0000-4000-8000-000000000001/ai-insights",
  );
  rows = [insightRow(1), insightRow(2)];
  highlightsAnswer = async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(200, HIGHLIGHTS, {});
  };
  postSpy = jest.spyOn(API, "post");
  postSpy.mockImplementation(
    async (
      request: unknown,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = String((request as JSONObject)["url"]);

      if (url.endsWith("/ai-insight/highlights")) {
        return await highlightsAnswer();
      }

      throw new Error(`Unexpected request to ${url}`);
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the AI Insights inbox", () => {
  test("says what OneUptime AI watches for, in plain words", async () => {
    renderInbox();
    await waitForRows();

    expect(
      screen.getByText(
        /^OneUptime AI watches your telemetry around the clock and tells you about problems before anyone is paged: new or spiking exceptions, error-log spikes, slower requests and metrics that drift\. Insights never page and never open incidents\./,
      ),
    ).toBeInTheDocument();
  });

  test("leads with what to look at first, above its filters and its list", async () => {
    renderInbox();
    await waitForRows();

    const lead: HTMLElement = await screen.findByTestId(
      "ai-insight-highlights",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(lead).toHaveTextContent("What to look at first");
    expect(lead).toHaveTextContent("The nightly batch job doubled its writes.");
    expect(
      follows(
        lead,
        screen.getByRole("combobox", { name: "Sort insights" }),
      ),
    ).toBe(true);
    expect(
      follows(lead, screen.getAllByText(ROW_TITLE).slice(-1)[0]!),
    ).toBe(true);
    expect(
      postSpy.mock.calls.filter((call: Array<unknown>): boolean => {
        return String((call[0] as JSONObject)["url"]).endsWith(
          "/ai-insight/highlights",
        );
      }),
    ).toHaveLength(1);
  });

  test("when the highlights cannot be read, the inbox is the page as before", async () => {
    highlightsAnswer = async (): Promise<HTTPErrorResponse> => {
      return new HTTPErrorResponse(500, { message: "down" }, {});
    };
    renderInbox();
    await waitForRows();

    await waitFor(
      () => {
        expect(postSpy).toHaveBeenCalled();
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(
      screen.queryByTestId("ai-insight-highlights"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Sort insights" }),
    ).toBeInTheDocument();
  });
});
