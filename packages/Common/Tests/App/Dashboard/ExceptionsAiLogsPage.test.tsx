import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import ExceptionsAILogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Exceptions/AI/Logs";
import ProfilesAILogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Profiles/AI/Logs";
import {
  TELEMETRY_AI_LANE_COPY,
  TELEMETRY_AI_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { TelemetryAiLane } from "../../../Types/AI/TelemetryAi";
import {
  TELEMETRY_AI_LOGS_PATH,
  TelemetryAiLogKind,
  TelemetryAiLogState,
} from "../../../Types/AI/TelemetryAiActivity";
import { JSONObject } from "../../../Types/JSON";
import ErrorClass from "../../../Types/Telemetry/ErrorClass";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

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

/*
 * Exceptions → AI → Logs, rendered on its real route with the logs call
 * stubbed: everything OneUptime AI did with the exceptions it found - and,
 * under each investigation, what it found. That verdict decides a new or
 * rising exception's pull request (a fix for a fault of the code, better
 * handling for an expected error, none on its own for the rest), so the
 * row says it in the lane's words. The Profiler's Logs, whose lane has no
 * such words, say nothing of a verdict: the line is the Exceptions lane's
 * to opt in to (TelemetryAiLaneCopy.investigationVerdicts).
 */

const WAIT_TIMEOUT: number = 20000;

const INSIGHT_ID: string = "5240eded-0000-4000-8000-0000000000a1";
const TASK_ID: string = "5240eded-0000-4000-8000-0000000000b2";
const TRIAGE_ID: string = "5240eded-0000-4000-8000-0000000000c3";

const VERDICTS: Record<ErrorClass, string> = {
  [ErrorClass.CodeFault]: "Found a fault in the code",
  [ErrorClass.UserError]: "Found an expected error: invalid input",
  [ErrorClass.ExpectedDenial]: "Found an expected error: a check doing its job",
  [ErrorClass.Infrastructure]: "Found a cause outside the code",
  [ErrorClass.Unknown]: "Could not tell the cause",
};

function entry(overrides: JSONObject): JSONObject {
  return {
    runId: TRIAGE_ID,
    kind: TelemetryAiLogKind.Investigation,
    at: "2026-10-24T09:00:00.000Z",
    state: TelemetryAiLogState.Done,
    insight: {
      id: INSIGHT_ID,
      title: "New exception: TypeError: Cannot read properties of undefined",
      serviceName: "checkout",
    },
    ...overrides,
  };
}

// The exception's own fix task, opened on its own after a code fault.
const FIX: JSONObject = entry({
  runId: TASK_ID,
  kind: TelemetryAiLogKind.PullRequest,
  state: TelemetryAiLogState.Working,
  taskId: TASK_ID,
  repositoryName: "acme/checkout",
  repositoryHostedAt: "GitHub",
  pullRequest: {
    state: "open",
    number: 2210,
    url: "https://github.com/acme/checkout/pull/2210",
  },
});

let body: JSONObject = { entries: [], totalCount: 0 };
let postSpy: ReturnType<typeof jest.spyOn>;

function serve(entries: Array<JSONObject>): void {
  body = { entries, totalCount: entries.length };
}

function lanesRead(): Array<unknown> {
  return postSpy.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] || {}) as JSONObject;
    })
    .filter((request: JSONObject): boolean => {
      return String(request["url"]).endsWith(TELEMETRY_AI_LOGS_PATH);
    })
    .map((request: JSONObject): unknown => {
      return ((request["data"] || {}) as JSONObject)["lane"];
    });
}

function pathOf(page: PageMap): string {
  return RouteMap[page]!.toString().replace(":projectId", PROJECT_ID);
}

function openPage(
  page: PageMap,
  Page: React.FunctionComponent<PageComponentProps>,
): void {
  const path: string = pathOf(page);
  goTo(path);

  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <PageRoute
          path={String(RouteMap[page])}
          element={
            <Page
              pageRoute={RouteMap[page] as Route}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function openExceptionsLogs(): void {
  openPage(PageMap.EXCEPTIONS_AI_LOGS, ExceptionsAILogs);
}

async function shownEntries(count: number): Promise<Array<HTMLElement>> {
  await waitFor(
    () => {
      expect(
        screen.queryAllByTestId(TELEMETRY_AI_TEST_IDS.logEntry),
      ).toHaveLength(count);
    },
    { timeout: WAIT_TIMEOUT },
  );

  return screen.queryAllByTestId(TELEMETRY_AI_TEST_IDS.logEntry);
}

beforeEach(() => {
  window.localStorage.clear();
  serve([]);

  postSpy = jest.spyOn(API, "post");
  postSpy.mockImplementation(
    async (
      request: unknown,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = String((request as JSONObject)["url"]);

      if (url.endsWith(TELEMETRY_AI_LOGS_PATH)) {
        return new HTTPResponse<JSONObject>(200, body, {});
      }

      throw new Error(`Unexpected request to ${url}`);
    },
  );
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Exceptions → AI → Logs", () => {
  test("reads the Exceptions lane, and says what the page is", async () => {
    serve([entry({})]);
    openExceptionsLogs();

    await shownEntries(1);

    expect(lanesRead()).toEqual([TelemetryAiLane.Exception]);
    expect(
      screen.getByText(
        TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Exception].logsIntro,
      ),
    ).toBeInTheDocument();
  });

  test.each(Object.values(ErrorClass))(
    "an investigation that found %s says what it found, in the lane's words",
    async (verdict: ErrorClass) => {
      serve([entry({ classification: verdict })]);
      openExceptionsLogs();

      const [row] = await shownEntries(1);
      const line: HTMLElement = within(row!).getByTestId(
        TELEMETRY_AI_TEST_IDS.logVerdict,
      );

      expect(line).toHaveTextContent(VERDICTS[verdict]);
      expect(
        TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Exception]
          .investigationVerdicts?.[verdict],
      ).toBe(VERDICTS[verdict]);
      // Under the investigation's finding, beside how it stands.
      expect(within(row!).getByText("Investigation")).toBeInTheDocument();
      expect(within(row!).getByText("Done")).toBeInTheDocument();
    },
  );

  test("an investigation with no verdict yet, or a verdict it has no words for, says none", async () => {
    serve([
      entry({ runId: "5240eded-0000-4000-8000-0000000000d1" }),
      entry({
        runId: "5240eded-0000-4000-8000-0000000000d2",
        state: TelemetryAiLogState.Working,
      }),
      entry({
        runId: "5240eded-0000-4000-8000-0000000000d3",
        classification: "something-else",
      }),
    ]);
    openExceptionsLogs();

    await shownEntries(3);

    expect(
      screen.queryByTestId(TELEMETRY_AI_TEST_IDS.logVerdict),
    ).not.toBeInTheDocument();
  });

  test("a pull request says its pull request and task, never a verdict", async () => {
    serve([
      { ...FIX, classification: ErrorClass.CodeFault },
      entry({ classification: ErrorClass.CodeFault }),
    ]);
    openExceptionsLogs();

    const [fix, investigation] = await shownEntries(2);

    expect(
      within(fix!).queryByTestId(TELEMETRY_AI_TEST_IDS.logVerdict),
    ).not.toBeInTheDocument();
    expect(within(fix!).getByText("Pull request #2210")).toBeInTheDocument();
    expect(within(fix!).getByText("Open task")).toBeInTheDocument();
    expect(
      within(investigation!).getByTestId(TELEMETRY_AI_TEST_IDS.logVerdict),
    ).toHaveTextContent("Found a fault in the code");
  });

  test("the Profiler's Logs say no verdict: the line is the Exceptions lane's", async () => {
    expect(
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile].investigationVerdicts,
    ).toBeUndefined();

    serve([entry({ classification: ErrorClass.CodeFault })]);
    openPage(PageMap.PROFILES_AI_LOGS, ProfilesAILogs);

    await shownEntries(1);

    expect(lanesRead()).toEqual([TelemetryAiLane.Profile]);
    expect(
      screen.queryByTestId(TELEMETRY_AI_TEST_IDS.logVerdict),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Found a fault in the code"),
    ).not.toBeInTheDocument();
  });
});
