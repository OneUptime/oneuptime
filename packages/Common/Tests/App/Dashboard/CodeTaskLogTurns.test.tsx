import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import type { SpyInstance } from "jest-mock";
import React, { ReactElement } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskTurnJSON,
} from "../../../Types/AI/CodeTask";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A task's Log page in Code shows the verbatim record of ONE of its turns;
 * the `turn` query parameter names it. A task of more than one turn lists
 * them in a picker at the top (Components/Code/CodeTaskLogTurns), so the
 * record of another turn is one pick away rather than a trip back to the
 * conversation and down to that turn's Log link.
 *
 *   - each turn is named by its place and how it ended - "Turn 2 · Failed"
 *     - with what was asked under it, or what started it;
 *   - the turn shown is the one the address names, when it is one of the
 *     task's; anything else shows the task's first turn;
 *   - picking another opens the page at it, and nothing of the turn before
 *     stays on the page - not even an answer that comes back late;
 *   - a task of one turn shows no picker.
 */

const getTaskMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi",
  () => {
    return {
      __esModule: true,
      CODE_TASK_API_PATH: "/code-task",
      default: {
        getTask: (...args: Array<unknown>) => {
          return getTaskMock(...args);
        },
      },
    };
  },
);

import CodeTaskLog, {
  CODE_TASK_LOG_TURN_PICKER_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Task/Log";
import {
  CODE_TASK_LOG_TURN_COPY,
  CodeTaskLogTurn,
  MAX_TURN_SUMMARY_LENGTH,
  getCodeTaskLogTurnRoute,
  getCodeTaskLogTurns,
  getShownTurnRunId,
  getTurnSummaryLine,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskLogTurns";

const TASK_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";
const SECOND_RUN_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0b";
const THIRD_RUN_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0c";
const OTHER_TASK_RUN_ID: string = "9a8b7c6d-1b2c-4d3e-8f4a-5b6c7d8e9f0d";

const translation: i18n = createInstance();

type NavigateSpy = SpyInstance<
  (
    ...args: Parameters<typeof Navigation.navigate>
  ) => ReturnType<typeof Navigation.navigate>
>;

let navigateMock: NavigateSpy;

const PAGE_PROPS: {
  pageRoute: Route;
  currentProject: null;
  hasPaymentMethod: boolean;
} = {
  pageRoute: new Route("/"),
  currentProject: null,
  hasPaymentMethod: true,
};

function turn(data: Partial<CodeTaskTurnJSON> = {}): CodeTaskTurnJSON {
  return {
    runId: TASK_ID,
    recipe: CodeFixTaskType.CodeRequest,
    status: AIRunStatus.Completed,
    state: CodeTaskState.Done,
    createdAt: "2026-10-19T10:00:00.000Z",
    requestedBy: { id: "ada", name: "Ada Lovelace" },
    request: {
      message: "Retry charges when the gateway times out",
      context: [],
    },
    steps: [],
    pullRequests: [],
    needsInput: false,
    ...data,
  };
}

// A task of three turns: done, failed, still working.
const THREE_TURNS: Array<CodeTaskTurnJSON> = [
  turn(),
  turn({
    runId: SECOND_RUN_ID,
    status: AIRunStatus.Error,
    state: CodeTaskState.Failed,
    request: {
      message: "Add a test for it\nand keep the old behaviour behind a flag",
      context: [],
    },
  }),
  turn({
    runId: THIRD_RUN_ID,
    status: AIRunStatus.Running,
    state: CodeTaskState.Working,
    request: { message: "Try again with a smaller change", context: [] },
  }),
];

function taskAnswer(turns: Array<CodeTaskTurnJSON>): Record<string, unknown> {
  return {
    task: {
      id: TASK_ID,
      taskNumber: 12,
      title: "Retry charges when the gateway times out",
      recipe: CodeFixTaskType.CodeRequest,
      state: CodeTaskState.Done,
      isQueued: false,
      createdAt: "2026-10-19T10:00:00.000Z",
      lastActivityAt: "2026-10-19T10:10:00.000Z",
      origin: { type: CodeTaskOriginType.Request, label: "Ada Lovelace" },
      turnCount: turns.length,
    },
    turns,
    repository: null,
    canAsk: true,
    canSeeChanges: true,
    canReadLogContent: true,
    blocker: null,
  };
}

// What /code-fix-run/logs/:id answers: the steps given, in order.
function logAnswer(...steps: Array<string>): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    {
      run: { _id: TASK_ID, status: AIRunStatus.Completed },
      events: steps.map((step: string, index: number): JSONObject => {
        return {
          _id: `event-${step}`,
          sequence: index + 1,
          eventType: "ProgressLog",
          resultSummary: { message: step },
          createdAt: "2026-10-19T10:01:00.000Z",
        };
      }),
      llmLogs: [],
      canReadContent: true,
    },
    {},
  );
}

// The run each /code-fix-run/logs read asked for.
function logReads(postSpy: SpyInstance<typeof API.post>): Array<string> {
  return postSpy.mock.calls.map((call: Parameters<typeof API.post>): string => {
    const url: URL = call[0].url as URL;
    return url.toString().split("/code-fix-run/logs/")[1] || "";
  });
}

const LOG_PATH: string = `/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}/log`;

function drawLog(search: string = ""): RenderResult {
  goTo(`${LOG_PATH}${search}`);

  return render(
    <I18nextProvider i18n={translation}>
      <MemoryRouter initialEntries={[`${LOG_PATH}${search}`]}>
        <Routes>
          <RouterRoute
            path="/dashboard/:projectId/code/tasks/:id/log"
            element={<CodeTaskLog {...PAGE_PROPS} />}
          />
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function picker(): HTMLElement {
  return screen.getByTestId(CODE_TASK_LOG_TURN_PICKER_TEST_ID);
}

function shownTurn(): string {
  return picker().querySelector(".ou-select__single-value")?.textContent || "";
}

function openPicker(): Array<HTMLElement> {
  fireEvent.keyDown(within(picker()).getByRole("combobox"), {
    key: "ArrowDown",
    code: "ArrowDown",
  });

  return screen.getAllByRole("option");
}

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: englishLocale } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  getTaskMock.mockReset();
  navigateMock = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((() => {}) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  goTo("/");
});

describe("a task's turns, as the Log page lists them", () => {
  test("each by its place and how it stands, with what was asked under it", () => {
    const turns: Array<CodeTaskLogTurn> = getCodeTaskLogTurns(THREE_TURNS);

    expect(turns).toEqual([
      {
        runId: TASK_ID,
        number: 1,
        stateLabel: "Done",
        summary: "Retry charges when the gateway times out",
        isSummaryTranslated: false,
      },
      {
        runId: SECOND_RUN_ID,
        number: 2,
        stateLabel: "Failed",
        // Its first line only.
        summary: "Add a test for it",
        isSummaryTranslated: false,
      },
      {
        runId: THIRD_RUN_ID,
        number: 3,
        stateLabel: "Working…",
        summary: "Try again with a smaller change",
        isSummaryTranslated: false,
      },
    ]);
  });

  test("a queued turn says Queued; a turn nobody asked for in Code, what started it", () => {
    const [queued, started] = getCodeTaskLogTurns([
      turn({ status: AIRunStatus.Queued, state: CodeTaskState.Working }),
      turn({
        runId: SECOND_RUN_ID,
        recipe: CodeFixTaskType.FixException,
        request: undefined,
      }),
    ]);

    expect(queued!.stateLabel).toBe("Queued");
    expect(started!.summary).toBe("Fix Exception");
    // The recipe's name is the product's words, looked up as such.
    expect(started!.isSummaryTranslated).toBe(true);
  });

  test("a long first line is cut to fit, with an ellipsis", () => {
    const long: string = "a".repeat(MAX_TURN_SUMMARY_LENGTH + 40);

    expect(getTurnSummaryLine(long)).toHaveLength(MAX_TURN_SUMMARY_LENGTH);
    expect(getTurnSummaryLine(long).endsWith("…")).toBe(true);
    expect(getTurnSummaryLine("  short  \n second")).toBe("short");
    expect(getTurnSummaryLine("")).toBe("");
  });

  test("the turn shown: the one the address names, when it is one of the task's - else the first", () => {
    const turns: Array<{ runId: string }> = THREE_TURNS;

    expect(
      getShownTurnRunId({ taskId: TASK_ID, turnParam: SECOND_RUN_ID, turns }),
    ).toBe(SECOND_RUN_ID);
    // Before the turns are read, the address is taken as it is.
    expect(
      getShownTurnRunId({ taskId: TASK_ID, turnParam: SECOND_RUN_ID }),
    ).toBe(SECOND_RUN_ID);
    // Another task's run, nothing, or not an id: the task's first turn.
    for (const turnParam of [OTHER_TASK_RUN_ID, null, "", "turn-2"]) {
      expect(getShownTurnRunId({ taskId: TASK_ID, turnParam, turns })).toBe(
        TASK_ID,
      );
    }
    // Named in another case, it is still that turn.
    expect(
      getShownTurnRunId({
        taskId: TASK_ID,
        turnParam: SECOND_RUN_ID.toUpperCase(),
        turns,
      }),
    ).toBe(SECOND_RUN_ID.toUpperCase());
  });

  test("a turn's Log, by its address", () => {
    goTo(LOG_PATH);

    expect(
      getCodeTaskLogTurnRoute({
        taskId: TASK_ID,
        runId: THIRD_RUN_ID,
      }).toString(),
    ).toBe(`${LOG_PATH}?turn=${THIRD_RUN_ID}`);
  });

  test("the picker's words", () => {
    expect(CODE_TASK_LOG_TURN_COPY).toEqual({
      label: "Turn",
      option: "Turn {{number}}",
    });
  });
});

describe("the Log page's turn picker", () => {
  test("a task of three turns lists them; the one the address names is shown", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(THREE_TURNS) as never);
    const postSpy: SpyInstance<typeof API.post> = jest
      .spyOn(API, "post")
      .mockResolvedValue(logAnswer("read src/checkout.ts") as never);

    drawLog(`?turn=${SECOND_RUN_ID}`);

    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 2 · Failed");
    });

    expect(logReads(postSpy)).toEqual([SECOND_RUN_ID]);

    const options: Array<HTMLElement> = openPicker();

    expect(
      options.map((option: HTMLElement): string => {
        return option.textContent || "";
      }),
    ).toEqual([
      expect.stringContaining("Turn 1 · Done"),
      expect.stringContaining("Turn 2 · Failed"),
      expect.stringContaining("Turn 3 · Working…"),
    ]);
    // What was asked, under each.
    expect(options[0]).toHaveTextContent(
      "Retry charges when the gateway times out",
    );
    expect(options[1]).toHaveTextContent("Add a test for it");
    expect(options[1]).not.toHaveTextContent("behind a flag");
  });

  test("picking another turn opens the page at it", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(THREE_TURNS) as never);
    jest
      .spyOn(API, "post")
      .mockResolvedValue(logAnswer("read src/checkout.ts") as never);

    drawLog();

    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 1 · Done");
    });

    fireEvent.click(openPicker()[2]!);

    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(String(navigateMock.mock.calls[0]![0])).toBe(
      `${LOG_PATH}?turn=${THIRD_RUN_ID}`,
    );
  });

  test("picking the turn already shown goes nowhere", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(THREE_TURNS) as never);
    jest
      .spyOn(API, "post")
      .mockResolvedValue(logAnswer("read src/checkout.ts") as never);

    drawLog();

    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 1 · Done");
    });

    fireEvent.click(openPicker()[0]!);

    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("a task of one turn shows no picker", async () => {
    getTaskMock.mockResolvedValue(taskAnswer([turn()]) as never);
    jest
      .spyOn(API, "post")
      .mockResolvedValue(logAnswer("read src/checkout.ts") as never);

    drawLog();

    expect(await screen.findByText("read src/checkout.ts")).toBeInTheDocument();
    expect(screen.queryByTestId(CODE_TASK_LOG_TURN_PICKER_TEST_ID)).toBeNull();
  });

  test("an address that names another task's run shows this task's first turn", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(THREE_TURNS) as never);
    const postSpy: SpyInstance<typeof API.post> = jest
      .spyOn(API, "post")
      .mockResolvedValue(logAnswer("read src/checkout.ts") as never);

    drawLog(`?turn=${OTHER_TASK_RUN_ID}`);

    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 1 · Done");
    });

    // Once the turns are known, the first turn's record is the one read.
    await waitFor(() => {
      expect(logReads(postSpy)).toContain(TASK_ID);
    });
  });

  /*
   * The record of the turn before never stays on the page: not while the
   * next one is read, and not when its answer comes back after the next
   * turn was picked.
   */
  test("another turn's record starts from nothing, and a late answer of the turn before is dropped", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(THREE_TURNS) as never);

    let answerSecond: (value: HTTPResponse<JSONObject>) => void = () => {};
    const secondAnswer: Promise<HTTPResponse<JSONObject>> = new Promise(
      (resolve: (value: HTTPResponse<JSONObject>) => void) => {
        answerSecond = resolve;
      },
    );

    jest.spyOn(API, "post").mockImplementation((async (data: {
      url: URL;
    }): Promise<HTTPResponse<JSONObject>> => {
      const runId: string =
        data.url.toString().split("/code-fix-run/logs/")[1] || "";

      if (runId === SECOND_RUN_ID) {
        return secondAnswer;
      }

      return logAnswer(`step of ${runId}`);
    }) as never);

    const view: RenderResult = drawLog(`?turn=${SECOND_RUN_ID}`);

    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 2 · Failed");
    });

    // The third turn is picked before the second's record comes back.
    goTo(`${LOG_PATH}?turn=${THIRD_RUN_ID}`);
    view.rerender(
      <I18nextProvider i18n={translation}>
        <MemoryRouter initialEntries={[`${LOG_PATH}?turn=${THIRD_RUN_ID}`]}>
          <Routes>
            <RouterRoute
              path="/dashboard/:projectId/code/tasks/:id/log"
              element={<CodeTaskLog {...PAGE_PROPS} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(
      await screen.findByText(`step of ${THIRD_RUN_ID}`),
    ).toBeInTheDocument();

    /*
     * Two steps: a record unlike the shown one's, so nothing but the turn
     * it is of keeps it off the page.
     */
    await act(async () => {
      answerSecond(
        logAnswer("a step of the second turn", "another step of it"),
      );
      await secondAnswer;
    });

    expect(screen.queryByText("a step of the second turn")).toBeNull();
    expect(screen.getByText(`step of ${THIRD_RUN_ID}`)).toBeInTheDocument();
    expect(shownTurn()).toBe("Turn 3 · Working…");
  });
});
