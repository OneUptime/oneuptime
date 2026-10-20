import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { BrowserRouter } from "react-router-dom";
import ErrorPatternDetail from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/ErrorPatternDetail";
import {
  ErrorPatternCorrelation,
  TopErrorPatternRow,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/LogsInsights";
import EventName from "../../../../App/FeatureSet/Dashboard/src/Utils/EventName";
import Project from "../../../Models/DatabaseModels/Project";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * A log error pattern's panel offers "Explain with AI" - Ask AI opened with
 * the pattern and its evidence as an editable prompt - only where AI can
 * run: with the project's one AI switch off it is not drawn at all
 * (Common/Utils/Suggestions/AiSuggestion), and the rest of the panel - the
 * likely cause, what to check, the matching logs - is unchanged.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

const mockCorrelation: ErrorPatternCorrelation = {
  pattern: "connection refused",
  bucketSizeInMinutes: 5,
  timeline: [],
  coOccurringPatterns: [],
  attributes: [],
  resources: [],
  traces: [],
  samples: [],
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsInsightsApi",
  () => {
    return {
      fetchErrorPatternCorrelation: async (): Promise<unknown> => {
        return mockCorrelation;
      },
    };
  },
);

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return new Map();
    },
  };
});

const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-09-01T10:00:00.000Z"),
  new Date("2026-09-01T11:00:00.000Z"),
);

const PATTERN: TopErrorPatternRow = {
  pattern: "connection refused",
  sampleBody: "connection refused to 10.0.0.5:5432",
  count: 12,
  firstSeenAt: null,
  lastSeenAt: null,
  resourceCount: 1,
  traceCount: 0,
  resourceIds: [],
  severities: ["Error"],
  sampleTraceIds: [],
};

function withProject(enableAi: boolean | undefined): void {
  jest
    .spyOn(ProjectUtil, "getCurrentProject")
    .mockReturnValue(
      enableAi === undefined
        ? null
        : (Object.assign(new Project(), { enableAi }) as Project),
    );
}

async function renderPattern(): Promise<void> {
  render(
    <BrowserRouter>
      <ErrorPatternDetail
        pattern={PATTERN}
        scope={{
          timeRange: { range: TimeRange.CUSTOM, startAndEndDate: WINDOW },
        }}
        serviceNameById={new Map()}
        onClose={() => {
          return;
        }}
      />
    </BrowserRouter>,
  );

  await screen.findByText("Likely cause and what to check");
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Explain with AI on a log error pattern", () => {
  test("AI on: offered, and it opens Ask AI with the pattern's evidence as the prompt", async () => {
    withProject(true);
    const dispatch: ReturnType<typeof jest.spyOn> = jest.spyOn(
      GlobalEvents,
      "dispatchEvent",
    );

    await renderPattern();
    fireEvent.click(screen.getByTestId("error-pattern-explain-with-ai"));

    const opened: Array<Array<unknown>> = (
      dispatch.mock.calls as Array<Array<unknown>>
    ).filter((call: Array<unknown>): boolean => {
      return call[0] === EventName.AI_CHAT_TOGGLE;
    });
    expect(opened).toHaveLength(1);
    expect((opened[0]![1] as Record<string, string>)["prompt"]).toContain(
      "connection refused",
    );
  });

  test("a project not loaded yet reads as AI on: offered", async () => {
    withProject(undefined);

    await renderPattern();

    expect(
      screen.getByTestId("error-pattern-explain-with-ai"),
    ).toHaveTextContent("Explain with AI");
  });

  test("AI switched off: not drawn, and the rest of the panel is unchanged", async () => {
    withProject(false);

    await renderPattern();

    expect(screen.queryByTestId("error-pattern-explain-with-ai")).toBeNull();
    expect(screen.queryByText("Explain with AI")).toBeNull();
    expect(
      screen.getByText("Likely cause and what to check"),
    ).toBeInTheDocument();
  });
});
