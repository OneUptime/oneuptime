import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
 * Profiler → AI → Insights: AI Insights' inbox, scoped to the slow code
 * OneUptime found in the project's profiles - only that kind of finding,
 * each opening under the Profiler, in the Profiler's words, with its AI
 * Settings as the way on. The highlights across every kind of finding, and
 * a type filter that would offer one type, are AI Insights' alone.
 */

interface ListRequest {
  query: Record<string, unknown>;
  sort: Record<string, unknown>;
  skip: number;
  limit: number;
}

let listRequests: Array<ListRequest> = [];
let countQueries: Array<Record<string, unknown>> = [];
let rows: Array<unknown> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (request: ListRequest): Promise<unknown> => {
        listRequests.push(request);
        return {
          data: rows.slice(request.skip, request.skip + request.limit),
          count: rows.length,
          skip: request.skip,
          limit: request.limit,
        };
      },
      count: async (request: {
        query: Record<string, unknown>;
      }): Promise<number> => {
        countQueries.push(request.query);
        return rows.length;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import ProfilesAIInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Profiles/AI/Insights";
import { TELEMETRY_AI_LANE_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiCopy";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import AIInsight from "../../../Models/DatabaseModels/AIInsight";
import AIInsightSeverity from "../../../Types/AI/AIInsightSeverity";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import { TelemetryAiLane } from "../../../Types/AI/TelemetryAi";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const ROW_ID: string = "5092efef-0000-4000-8000-000000000001";
const SERVICE_ID: string = "5092efef-0000-4000-8000-0000000000aa";

function slowCode(): AIInsight {
  const insight: AIInsight = new AIInsight();
  insight.id = new ObjectID(ROW_ID);
  insight.title = "OrderParser.parse takes 18% of the CPU time in checkout";
  insight.insightType = AIInsightType.ProfileHotspot;
  insight.serviceName = "checkout";
  insight.telemetryServiceId = new ObjectID(SERVICE_ID);
  insight.severity = AIInsightSeverity.Medium;
  insight.status = AIInsightStatus.ActionRequired;
  insight.occurrenceCount = 3;
  insight.firstSeenAt = new Date("2026-10-24T07:00:00.000Z");
  insight.lastSeenAt = new Date("2026-10-24T09:00:00.000Z");
  return insight;
}

function pathOf(page: PageMap, modelId?: string): string {
  return RouteMap[page]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", modelId || ":id");
}

async function renderPage(): Promise<void> {
  goTo(pathOf(PageMap.PROFILES_AI_INSIGHTS));

  await act(async () => {
    render(
      <MemoryRouter>
        <ProfilesAIInsights
          pageRoute={new Route("/")}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
}

function insightTypeOf(query: Record<string, unknown>): Array<unknown> {
  const filter: unknown = query["insightType"];

  expect(filter).toBeInstanceOf(Includes);

  return [...((filter as Includes).values as Array<unknown>)];
}

beforeEach(() => {
  listRequests = [];
  countQueries = [];
  rows = [slowCode()];
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Profiler → AI → Insights", () => {
  test("lists only slow code, and counts only slow code", async () => {
    await renderPage();

    await screen.findByText(
      "OrderParser.parse takes 18% of the CPU time in checkout",
    );

    expect(insightTypeOf(listRequests[0]!.query)).toEqual([
      AIInsightType.ProfileHotspot,
    ]);

    await waitFor(() => {
      expect(countQueries.length).toBeGreaterThan(0);
    });

    for (const query of countQueries) {
      expect(insightTypeOf(query)).toEqual([AIInsightType.ProfileHotspot]);
    }
  });

  test("says what it is in the Profiler's words, with no type filter of one type and no highlights of every kind", async () => {
    await renderPage();

    await screen.findByText(
      "OrderParser.parse takes 18% of the CPU time in checkout",
    );

    expect(
      screen.getByText(
        TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile].insightsIntro,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Filter by insight type" }),
    ).not.toBeInTheDocument();
    // The severity filter is still there.
    expect(
      screen.getByRole("combobox", { name: "Filter by severity" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "To be alerted when a finding happens again, open it and choose Create Monitor.",
        { exact: false },
      ),
    ).not.toBeInTheDocument();
  });

  test("a finding opens under the Profiler, and its quick link opens the Profiler on its service", async () => {
    await renderPage();

    const title: HTMLElement = await screen.findByText(
      "OrderParser.parse takes 18% of the CPU time in checkout",
    );

    expect(title.closest("a")?.getAttribute("href")).toBe(
      pathOf(PageMap.PROFILES_AI_INSIGHT_VIEW, ROW_ID),
    );

    const profilerLink: HTMLElement | undefined = Array.from(
      document.querySelectorAll("a[title]"),
    ).find((element: Element): boolean => {
      return (element.getAttribute("title") || "").startsWith(
        "Open in Profiler",
      );
    }) as HTMLElement | undefined;

    expect(profilerLink?.getAttribute("href")).toBe(
      `${pathOf(PageMap.PROFILES)}?serviceId=${SERVICE_ID}`,
    );
  });

  test("with none found yet: the Profiler's empty state, and the way to its AI Settings", async () => {
    rows = [];
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        return undefined;
      });

    await renderPage();

    expect(
      await screen.findByText(
        TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile].insightsEmptyTitle,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile]
          .insightsEmptyDescription,
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Go to AI Settings" }));

    expect(String(navigate.mock.calls[0]![0])).toBe(
      pathOf(PageMap.PROFILES_AI_SETTINGS),
    );
  });
});
