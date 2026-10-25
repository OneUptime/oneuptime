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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route as PageRoute, Routes } from "react-router-dom";
import LogsAIActivity from "../../../../App/FeatureSet/Dashboard/src/Pages/Logs/AI/Activity";
import {
  TELEMETRY_AI_LANE_COPY,
  TELEMETRY_AI_LOG_FINDINGS,
  TELEMETRY_AI_TEST_IDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiCopy";
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
 * Logs → AI → Activity, rendered on its real route with the logs call
 * stubbed: everything OneUptime AI did with the problems it found in the
 * project's logs - the section's shared AI logs page, named Activity here
 * (inside Logs, "Logs" would read as log lines). A done investigation says
 * what OneUptime AI found - the verdict its triage ended with - which is
 * why an error log got a pull request on its own, or did not: its pull
 * request waits for a fault of the code.
 */

const WAIT_TIMEOUT: number = 20000;

const INSIGHT_ID: string = "5a660000-0000-4000-8000-0000000000a1";
const TRIAGE_ID: string = "5a660000-0000-4000-8000-0000000000c1";
const TASK_ID: string = "5a660000-0000-4000-8000-0000000000b1";

const ERROR_LOG_TITLE: string =
  'checkout logged "Payment provider returned <num>: card declined" 1,240 times in an hour';

function entry(overrides: JSONObject): JSONObject {
  return {
    runId: TRIAGE_ID,
    kind: TelemetryAiLogKind.Investigation,
    at: "2026-10-24T09:00:00.000Z",
    state: TelemetryAiLogState.Done,
    insight: {
      id: INSIGHT_ID,
      title: ERROR_LOG_TITLE,
      serviceName: "checkout",
    },
    ...overrides,
  };
}

type Answer = () => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse>;

function ok(body: unknown): Answer {
  return async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(200, body as JSONObject, {});
  };
}

function httpError(statusCode: number, message: string): Answer {
  return async (): Promise<HTTPErrorResponse> => {
    return new HTTPErrorResponse(statusCode, { message }, {});
  };
}

let postSpy: ReturnType<typeof jest.spyOn>;
let answers: Array<Answer> = [];

function serve(...queue: Array<Answer>): void {
  answers = [...queue];
}

function requests(): Array<JSONObject> {
  return postSpy.mock.calls
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] || {}) as JSONObject;
    })
    .filter((request: JSONObject): boolean => {
      return String(request["url"]).endsWith(TELEMETRY_AI_LOGS_PATH);
    })
    .map((request: JSONObject): JSONObject => {
      return (request["data"] || {}) as JSONObject;
    });
}

function pathOf(page: PageMap, modelId?: string): string {
  return RouteMap[page]!.toString()
    .replace(":projectId", PROJECT_ID)
    .replace(":id", modelId || ":id");
}

function openPage(): void {
  const path: string = pathOf(PageMap.LOGS_AI_ACTIVITY);
  goTo(path);

  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <PageRoute
          path={String(RouteMap[PageMap.LOGS_AI_ACTIVITY])}
          element={
            <LogsAIActivity
              pageRoute={RouteMap[PageMap.LOGS_AI_ACTIVITY] as Route}
              currentProject={null}
              hasPaymentMethod={true}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
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
  answers = [];

  postSpy = jest.spyOn(API, "post");
  postSpy.mockImplementation(
    async (
      request: unknown,
    ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
      const url: string = String((request as JSONObject)["url"]);

      if (url.endsWith(TELEMETRY_AI_LOGS_PATH)) {
        const answer: Answer | undefined =
          answers.length > 1 ? answers.shift() : answers[0];

        if (!answer) {
          throw new Error(`No answer queued for ${url}`);
        }

        return await answer();
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

describe("Logs → AI → Activity", () => {
  test("reads the Logs lane's first page, and says what the page is", async () => {
    serve(ok({ entries: [entry({})], totalCount: 1 }));
    openPage();

    await shownEntries(1);

    expect(requests()).toEqual([{ lane: TelemetryAiLane.Log, skip: 0 }]);
    expect(
      screen.getByText(TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Log].logsIntro),
    ).toBeInTheDocument();
  });

  test("an entry's finding opens under Logs' own AI tab", async () => {
    serve(ok({ entries: [entry({})], totalCount: 1 }));
    openPage();

    const [investigation] = await shownEntries(1);

    expect(
      within(investigation!)
        .getByText(ERROR_LOG_TITLE)
        .closest("a")
        ?.getAttribute("href"),
    ).toBe(pathOf(PageMap.LOGS_AI_INSIGHT_VIEW, INSIGHT_ID));
  });

  test.each([
    [
      ErrorClass.CodeFault,
      "OneUptime AI found that a change to the code fixes it.",
    ],
    [
      ErrorClass.UserError,
      "OneUptime AI found the code refusing bad input, as it should.",
    ],
    [
      ErrorClass.ExpectedDenial,
      "OneUptime AI found a check doing its job, such as a refused sign-in.",
    ],
    [
      ErrorClass.Infrastructure,
      "OneUptime AI found the cause outside the code, such as a dependency, the environment or its configuration.",
    ],
    [
      ErrorClass.Unknown,
      "OneUptime AI could not tell the cause from the evidence.",
    ],
  ])(
    "a done investigation whose verdict is %s says what OneUptime AI found",
    async (classification: ErrorClass, words: string) => {
      serve(ok({ entries: [entry({ classification })], totalCount: 1 }));
      openPage();

      const [investigation] = await shownEntries(1);
      const finding: HTMLElement = within(investigation!).getByTestId(
        TELEMETRY_AI_TEST_IDS.logFinding,
      );

      expect(finding).toHaveTextContent(words);
      expect(TELEMETRY_AI_LOG_FINDINGS[classification]).toBe(words);
      expect(finding).toHaveAttribute("data-classification", classification);
      // Below what the investigation was about, beside how it stands.
      expect(within(investigation!).getByText("Done")).toBeInTheDocument();
      expect(
        within(investigation!).getByText("Investigation"),
      ).toBeInTheDocument();
    },
  );

  /*
   * An error log the investigation found outside the code gets no pull
   * request on its own: the list holds the investigation alone, and its row
   * says why.
   */
  test("an error log found outside the code: the investigation alone, saying why", async () => {
    serve(
      ok({
        entries: [entry({ classification: ErrorClass.Infrastructure })],
        totalCount: 1,
      }),
    );
    openPage();

    const [investigation] = await shownEntries(1);

    expect(investigation!).toHaveAttribute(
      "data-kind",
      TelemetryAiLogKind.Investigation,
    );
    expect(investigation!).toHaveTextContent(
      "OneUptime AI found the cause outside the code",
    );
    expect(screen.queryByText("Pull request")).not.toBeInTheDocument();
    expect(screen.queryByText("Open task")).not.toBeInTheDocument();
  });

  test("an investigation still on its way, a pull request, and a verdict outside the vocabulary say nothing was found", async () => {
    serve(
      ok({
        entries: [
          entry({
            runId: "5a660000-0000-4000-8000-0000000000c2",
            state: TelemetryAiLogState.Working,
            classification: ErrorClass.CodeFault,
          }),
          entry({
            runId: TASK_ID,
            kind: TelemetryAiLogKind.PullRequest,
            state: TelemetryAiLogState.Done,
            taskId: TASK_ID,
            classification: ErrorClass.CodeFault,
          }),
          entry({
            runId: "5a660000-0000-4000-8000-0000000000c3",
            classification: "Actionable",
          }),
          entry({ runId: "5a660000-0000-4000-8000-0000000000c4" }),
        ],
        totalCount: 4,
      }),
    );
    openPage();

    await shownEntries(4);

    expect(
      screen.queryAllByTestId(TELEMETRY_AI_TEST_IDS.logFinding),
    ).toHaveLength(0);
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Open task")).toBeInTheDocument();
  });

  test("a failed read says so in the page's own name, Activity, and reads again on Refresh", async () => {
    serve(
      httpError(500, "The activity could not be read."),
      ok({ entries: [entry({})], totalCount: 1 }),
    );
    openPage();

    expect(
      await screen.findByText(
        "Could not load the AI activity: The activity could not be read.",
        { exact: false },
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Could not load the AI logs", { exact: false }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await shownEntries(1);
    expect(requests()).toHaveLength(2);
  });

  test("a failed Load More says so in the page's own name, under the entries already shown", async () => {
    serve(
      ok({ entries: [entry({})], totalCount: 2 }),
      httpError(500, "The next page could not be read."),
    );
    openPage();

    await shownEntries(1);

    fireEvent.click(screen.getByTestId(TELEMETRY_AI_TEST_IDS.logsLoadMore));

    const alert: HTMLElement = await screen.findByRole(
      "alert",
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(alert).toHaveTextContent(
      "Could not load the AI activity: The next page could not be read.",
    );
    // The entry already read stays.
    expect(
      screen.queryAllByTestId(TELEMETRY_AI_TEST_IDS.logEntry),
    ).toHaveLength(1);
  });
});
