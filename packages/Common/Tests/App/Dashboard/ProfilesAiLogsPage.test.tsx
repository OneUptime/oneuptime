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
import ProfilesAILogs from "../../../../App/FeatureSet/Dashboard/src/Pages/Profiles/AI/Logs";
import {
  TELEMETRY_AI_LANE_COPY,
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
 * Profiler → AI → Logs, rendered on its real route with the logs call
 * stubbed: everything OneUptime AI did with the slow code it found, newest
 * first - each investigation and each pull request, with how it stands,
 * the finding it was for, who started it, and its task and pull request.
 */

const WAIT_TIMEOUT: number = 20000;

const INSIGHT_ID: string = "5092dede-0000-4000-8000-0000000000a1";
const TASK_ID: string = "5092dede-0000-4000-8000-0000000000b2";
const PERSON_TASK_ID: string = "5092dede-0000-4000-8000-0000000000b3";
const TRIAGE_ID: string = "5092dede-0000-4000-8000-0000000000c4";

function entry(overrides: JSONObject): JSONObject {
  return {
    runId: TRIAGE_ID,
    kind: TelemetryAiLogKind.Investigation,
    at: "2026-10-24T09:00:00.000Z",
    state: TelemetryAiLogState.Done,
    insight: {
      id: INSIGHT_ID,
      title: "OrderParser.parse takes 18% of the CPU time in checkout",
      serviceName: "checkout",
    },
    ...overrides,
  };
}

const AUTOMATIC_PULL_REQUEST: JSONObject = entry({
  runId: TASK_ID,
  kind: TelemetryAiLogKind.PullRequest,
  state: TelemetryAiLogState.Working,
  taskId: TASK_ID,
  repositoryName: "acme/shop",
  pullRequest: {
    state: "open",
    number: 812,
    url: "https://github.com/acme/shop/pull/812",
  },
});

const ASKED_PULL_REQUEST: JSONObject = entry({
  runId: PERSON_TASK_ID,
  kind: TelemetryAiLogKind.PullRequest,
  state: TelemetryAiLogState.NothingToChange,
  taskId: PERSON_TASK_ID,
  requestedBy: "Ada Lovelace",
});

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
  const path: string = pathOf(PageMap.PROFILES_AI_LOGS);
  goTo(path);

  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <PageRoute
          path={String(RouteMap[PageMap.PROFILES_AI_LOGS])}
          element={
            <ProfilesAILogs
              pageRoute={RouteMap[PageMap.PROFILES_AI_LOGS] as Route}
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

function hrefOf(element: HTMLElement): string {
  return element.closest("a")?.getAttribute("href") || "";
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

describe("Profiler → AI → Logs", () => {
  test("reads the Profiler lane's first page, and says what the page is", async () => {
    serve(ok({ entries: [entry({})], totalCount: 1 }));
    openPage();

    await shownEntries(1);

    expect(requests()).toEqual([{ lane: TelemetryAiLane.Profile, skip: 0 }]);
    expect(
      screen.getByText(
        TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile].logsIntro,
      ),
    ).toBeInTheDocument();
  });

  test("each entry: what it was, how it stands, its finding, who started it, its task and pull request", async () => {
    serve(
      ok({
        entries: [AUTOMATIC_PULL_REQUEST, ASKED_PULL_REQUEST, entry({})],
        totalCount: 3,
      }),
    );
    openPage();

    const [automatic, asked, investigation] = await shownEntries(3);

    // OneUptime opened it on its own.
    expect(automatic!).toHaveAttribute(
      "data-kind",
      TelemetryAiLogKind.PullRequest,
    );
    expect(within(automatic!).getByText("Pull request")).toBeInTheDocument();
    expect(within(automatic!).getByText("In progress")).toBeInTheDocument();
    expect(
      within(automatic!).getByText("Started by OneUptime"),
    ).toBeInTheDocument();
    expect(within(automatic!).getByText("acme/shop")).toBeInTheDocument();
    expect(
      hrefOf(
        within(automatic!).getByText(
          "OrderParser.parse takes 18% of the CPU time in checkout",
        ),
      ),
    ).toBe(pathOf(PageMap.PROFILES_AI_INSIGHT_VIEW, INSIGHT_ID));

    const pullRequestLink: HTMLAnchorElement | null = within(automatic!)
      .getByText("Pull request #812")
      .closest("a");

    expect(pullRequestLink?.getAttribute("href")).toBe(
      "https://github.com/acme/shop/pull/812",
    );
    expect(pullRequestLink?.getAttribute("target")).toBe("_blank");
    expect(hrefOf(within(automatic!).getByText("Open task"))).toBe(
      pathOf(PageMap.CODE_TASK_VIEW, TASK_ID),
    );

    // A person asked for it from the finding; nothing needed changing.
    expect(
      within(asked!).getByText("Asked by Ada Lovelace"),
    ).toBeInTheDocument();
    expect(within(asked!).getByText("Nothing to change")).toBeInTheDocument();
    expect(
      within(asked!).queryByText("Pull request #812"),
    ).not.toBeInTheDocument();

    // An investigation has no task of its own.
    expect(
      within(investigation!).getByText("Investigation"),
    ).toBeInTheDocument();
    expect(within(investigation!).getByText("Done")).toBeInTheDocument();
    expect(
      within(investigation!).queryByText("Open task"),
    ).not.toBeInTheDocument();
  });

  test("a pull request address that is not a web address is not linked", async () => {
    serve(
      ok({
        entries: [
          {
            ...AUTOMATIC_PULL_REQUEST,
            pullRequest: {
              state: "open",
              number: 9,
              url: "javascript:alert(1)",
            },
          },
        ],
        totalCount: 1,
      }),
    );
    openPage();

    const [row] = await shownEntries(1);

    expect(within(row!).queryByText("Pull request #9")).not.toBeInTheDocument();
    expect(row!.querySelector("a[href^='javascript']")).toBeNull();
  });

  test("Load More reads the next page after the entries already shown", async () => {
    serve(
      ok({ entries: [AUTOMATIC_PULL_REQUEST], totalCount: 2 }),
      ok({ entries: [ASKED_PULL_REQUEST], totalCount: 2 }),
    );
    openPage();

    await shownEntries(1);
    expect(document.body).toHaveTextContent("Showing 1 of 2 entries");

    fireEvent.click(screen.getByTestId(TELEMETRY_AI_TEST_IDS.logsLoadMore));

    await shownEntries(2);
    expect(requests()).toEqual([
      { lane: TelemetryAiLane.Profile, skip: 0 },
      { lane: TelemetryAiLane.Profile, skip: 1 },
    ]);
    expect(
      screen.queryByTestId(TELEMETRY_AI_TEST_IDS.logsLoadMore),
    ).not.toBeInTheDocument();
  });

  test("nothing yet: says what will show up here", async () => {
    serve(ok({ entries: [], totalCount: 0 }));
    openPage();

    const empty: HTMLElement = await screen.findByTestId(
      TELEMETRY_AI_TEST_IDS.logsEmpty,
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(empty).toHaveTextContent(
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile].logsEmptyTitle,
    );
    expect(empty).toHaveTextContent(
      TELEMETRY_AI_LANE_COPY[TelemetryAiLane.Profile].logsEmptyDescription,
    );
  });

  test("a failed read says why, and reads again on Refresh", async () => {
    serve(
      httpError(500, "The logs could not be read."),
      ok({ entries: [entry({})], totalCount: 1 }),
    );
    openPage();

    expect(
      await screen.findByText(
        "Could not load the AI logs: The logs could not be read.",
        { exact: false },
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await shownEntries(1);
    expect(requests()).toHaveLength(2);
  });
});
