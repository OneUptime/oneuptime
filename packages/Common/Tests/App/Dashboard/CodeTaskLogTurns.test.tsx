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
import React from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import {
  MemoryRouter,
  NavigateFunction,
  Route as RouterRoute,
  Routes,
  useNavigate,
} from "react-router-dom";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskTurnJSON,
} from "../../../Types/AI/CodeTask";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import arabicLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ar.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
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
 *     task's - a long task's turn its page does not show too: the page
 *     asks for it by name and lists it at its place (issue #7130);
 *     another task's run shows the task's first turn, and says so;
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
  CODE_TASK_LOG_TURN_NOT_OF_TASK_TEST_ID,
  CODE_TASK_LOG_TURN_PICKER_TEST_ID,
  CODE_TASK_LOG_TURNS_NOT_SHOWN_VALUE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Task/Log";
import {
  CODE_TASK_LOG_TASK_RECORD_COPY,
  CODE_TASK_LOG_TURN_COPY,
  CODE_TASK_LOG_TURN_RECORD_COPY,
  CodeTaskLogPickerEntry,
  CodeTaskLogRecordCopy,
  CodeTaskLogTurn,
  MAX_TURN_SUMMARY_LENGTH,
  getCodeTaskLogPickerEntries,
  getCodeTaskLogRecordCopy,
  getCodeTaskLogShownTurn,
  getCodeTaskLogTurnKey,
  getCodeTaskLogTurnRoute,
  getCodeTaskLogTurns,
  getTurnSummaryLine,
  isCodeTaskLogTurnOf,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskLogTurns";

const TASK_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";
const SECOND_RUN_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0b";
const THIRD_RUN_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0c";
const OTHER_TASK_RUN_ID: string = "9a8b7c6d-1b2c-4d3e-8f4a-5b6c7d8e9f0d";
// A long task's fifth turn: one its page does not show.
const LINKED_RUN_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f05";
// Its sixth: not shown either.
const SIXTH_RUN_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f06";
// Another task, whose second turn is OTHER_TASK_RUN_ID.
const OTHER_TASK_ID: string = "9a8b7c6d-1b2c-4d3e-8f4a-5b6c7d8e9f0e";

const NOT_OF_TASK_TITLE: string = "That turn is not part of this task";
const NOT_OF_TASK_BODY: string = "The task's first turn is shown instead.";

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

/*
 * A long task as its page reads it: its first turn and newest two, with
 * the 197 between them not shown (turns 1, 199 and 200) - and, when the
 * address named it, its fifth turn on its own.
 */
function longTaskAnswer(withLinkedTurn: boolean): Record<string, unknown> {
  return {
    ...taskAnswer(THREE_TURNS),
    turnsNotShown: { count: 197, workMilliseconds: 0 },
    ...(withLinkedTurn
      ? {
          linkedTurn: {
            number: 5,
            turn: turn({
              runId: LINKED_RUN_ID,
              status: AIRunStatus.Error,
              state: CodeTaskState.Failed,
              request: {
                message: "Handle the orders API too",
                context: [],
              },
            }),
          },
        }
      : {}),
  };
}

// What /code-fix-run/logs/:id answers each run: a step naming it.
function logOfEachRun(): (data: {
  url: URL;
}) => Promise<HTTPResponse<JSONObject>> {
  return async (data: { url: URL }): Promise<HTTPResponse<JSONObject>> => {
    const runId: string =
      data.url.toString().split("/code-fix-run/logs/")[1] || "";

    return logAnswer(`step of ${runId}`);
  };
}

function notOfTask(): HTMLElement | null {
  return screen.queryByTestId(CODE_TASK_LOG_TURN_NOT_OF_TASK_TEST_ID);
}

function pickerTexts(): Array<string> {
  return openPicker().map((option: HTMLElement): string => {
    return option.textContent || "";
  });
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

/*
 * The address moved on to another turn of the task (a pick, or the
 * browser's Back): the same page, drawn again at it.
 */
function redrawLog(view: RenderResult, search: string): void {
  goTo(`${LOG_PATH}${search}`);
  view.rerender(
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
    resources: {
      en: { translation: englishLocale },
      de: { translation: germanLocale },
      fa: { translation: persianLocale },
      ar: { translation: arabicLocale },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  getTaskMock.mockReset();
  navigateMock = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((() => {}) as never);
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  goTo("/");
  await translation.changeLanguage("en");
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

  /*
   * A long task's page holds its first turn and its newest (issue #6529):
   * the turns not shown between them still count, so each newer turn keeps
   * its place in the conversation.
   */
  test("a long task's newer turns keep their places past the turns not shown", () => {
    const turns: Array<CodeTaskLogTurn> = getCodeTaskLogTurns(THREE_TURNS, 5);

    expect(
      turns.map((each: CodeTaskLogTurn): number => {
        return each.number;
      }),
    ).toEqual([1, 7, 8]);
    // Only the numbers move: each turn is still itself.
    expect(
      turns.map((each: CodeTaskLogTurn): string => {
        return each.runId;
      }),
    ).toEqual([TASK_ID, SECOND_RUN_ID, THIRD_RUN_ID]);
  });

  test("none not shown, or nonsense, numbers every turn in order", () => {
    for (const notShown of [undefined, 0, -3, 2.5, Number.NaN]) {
      expect(
        getCodeTaskLogTurns(THREE_TURNS, notShown as never).map(
          (each: CodeTaskLogTurn): number => {
            return each.number;
          },
        ),
      ).toEqual([1, 2, 3]);
    }
  });

  test("a long first line is cut to fit, with an ellipsis", () => {
    const long: string = "a".repeat(MAX_TURN_SUMMARY_LENGTH + 40);

    expect(getTurnSummaryLine(long)).toHaveLength(MAX_TURN_SUMMARY_LENGTH);
    expect(getTurnSummaryLine(long).endsWith("…")).toBe(true);
    expect(getTurnSummaryLine("  short  \n second")).toBe("short");
    expect(getTurnSummaryLine("")).toBe("");
  });

  test("the turn shown: the one the address names, once the task's read says it is the task's - else the first, said so", () => {
    const task: { turns: Array<{ runId: string }> } = { turns: THREE_TURNS };

    // One of the turns read.
    expect(
      getCodeTaskLogShownTurn({
        taskId: TASK_ID,
        turnParam: SECOND_RUN_ID,
        task,
        taskReadFor: SECOND_RUN_ID,
      }),
    ).toEqual({ runId: SECOND_RUN_ID, isKnown: true, isNotOfTask: false });

    // Before the task is read: the address's turn, not to be shown yet.
    expect(
      getCodeTaskLogShownTurn({ taskId: TASK_ID, turnParam: SECOND_RUN_ID }),
    ).toEqual({ runId: SECOND_RUN_ID, isKnown: false, isNotOfTask: false });

    // Read for this address, and not the task's: the first turn, said so.
    expect(
      getCodeTaskLogShownTurn({
        taskId: TASK_ID,
        turnParam: OTHER_TASK_RUN_ID,
        task,
        taskReadFor: OTHER_TASK_RUN_ID,
      }),
    ).toEqual({ runId: TASK_ID, isKnown: true, isNotOfTask: true });

    // Read for another address (the picker's last pick): it is read again first.
    expect(
      getCodeTaskLogShownTurn({
        taskId: TASK_ID,
        turnParam: OTHER_TASK_RUN_ID,
        task,
        taskReadFor: "",
      }),
    ).toEqual({ runId: OTHER_TASK_RUN_ID, isKnown: false, isNotOfTask: false });

    // A task that could not be read: the address's turn, as before.
    expect(
      getCodeTaskLogShownTurn({
        taskId: TASK_ID,
        turnParam: OTHER_TASK_RUN_ID,
        hasTaskReadFailed: true,
      }),
    ).toEqual({ runId: OTHER_TASK_RUN_ID, isKnown: true, isNotOfTask: false });

    // No turn named: the task's first turn, nothing to ask or say.
    for (const turnParam of [null, undefined, "", "  "]) {
      expect(
        getCodeTaskLogShownTurn({ taskId: TASK_ID, turnParam, task }),
      ).toEqual({ runId: TASK_ID, isKnown: true, isNotOfTask: false });
    }

    /*
     * Something that is no run's id at all - a link cut short when it was
     * pasted, a typo, a turn's number: no turn of any task. The first
     * turn, said so at once - before any read, and with none to wait for.
     */
    for (const turnParam of [
      "turn-2",
      "5",
      SECOND_RUN_ID.slice(0, 23),
      `${SECOND_RUN_ID}x`,
    ]) {
      expect(getCodeTaskLogShownTurn({ taskId: TASK_ID, turnParam })).toEqual({
        runId: TASK_ID,
        isKnown: true,
        isNotOfTask: true,
      });
      expect(
        getCodeTaskLogShownTurn({ taskId: TASK_ID, turnParam, task }),
      ).toEqual({ runId: TASK_ID, isKnown: true, isNotOfTask: true });
    }

    // The task's own id names its first turn: nothing to ask.
    expect(
      getCodeTaskLogShownTurn({ taskId: TASK_ID, turnParam: TASK_ID }),
    ).toEqual({ runId: TASK_ID, isKnown: true, isNotOfTask: false });

    // Named in another case, it is still that turn.
    expect(
      getCodeTaskLogShownTurn({
        taskId: TASK_ID,
        turnParam: SECOND_RUN_ID.toUpperCase(),
        task,
        taskReadFor: SECOND_RUN_ID,
      }),
    ).toEqual({
      runId: SECOND_RUN_ID.toUpperCase(),
      isKnown: true,
      isNotOfTask: false,
    });
  });

  test("a turn not shown that the task's read was asked for is the task's - as the read names it", () => {
    const task: {
      turns: Array<{ runId: string }>;
      linkedTurn: { turn: { runId: string } };
    } = { turns: THREE_TURNS, linkedTurn: { turn: { runId: LINKED_RUN_ID } } };

    expect(isCodeTaskLogTurnOf(task, LINKED_RUN_ID)).toBe(true);
    expect(isCodeTaskLogTurnOf(task, THIRD_RUN_ID)).toBe(true);
    // No turn named: the first, which every task has.
    expect(isCodeTaskLogTurnOf(task, "")).toBe(true);
    expect(isCodeTaskLogTurnOf(task, OTHER_TASK_RUN_ID)).toBe(false);
    expect(
      getCodeTaskLogShownTurn({
        taskId: TASK_ID,
        turnParam: LINKED_RUN_ID,
        task,
        taskReadFor: LINKED_RUN_ID,
      }),
    ).toEqual({ runId: LINKED_RUN_ID, isKnown: true, isNotOfTask: false });
  });

  test("the address's turn, as the task is asked for it: an id in lower case, or none", () => {
    expect(getCodeTaskLogTurnKey(` ${SECOND_RUN_ID.toUpperCase()} `)).toBe(
      SECOND_RUN_ID,
    );
    for (const turnParam of [null, undefined, "", "turn-2", "42"]) {
      expect(getCodeTaskLogTurnKey(turnParam)).toBe("");
    }
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

/*
 * The page's own sentences about the record under the picker: "this task"
 * on a task of one turn, whose record is the task's; "this turn" once the
 * picker lists more than one, whose record is the turn picked - never
 * "Every step this task took" over the record of its second turn alone.
 */
describe("the Log's own words, for the record it shows", () => {
  test("a task of one turn speaks of the task; one of more, of the turn", () => {
    expect(getCodeTaskLogRecordCopy(0)).toBe(CODE_TASK_LOG_TASK_RECORD_COPY);
    expect(getCodeTaskLogRecordCopy(1)).toBe(CODE_TASK_LOG_TASK_RECORD_COPY);
    expect(getCodeTaskLogRecordCopy(2)).toBe(CODE_TASK_LOG_TURN_RECORD_COPY);
    expect(getCodeTaskLogRecordCopy(3)).toBe(CODE_TASK_LOG_TURN_RECORD_COPY);
  });

  test("the two say the same, but for the task or the turn", () => {
    const keys: Array<keyof CodeTaskLogRecordCopy> = Object.keys(
      CODE_TASK_LOG_TASK_RECORD_COPY,
    ) as Array<keyof CodeTaskLogRecordCopy>;

    expect(keys.sort()).toEqual(
      ["calls", "nothing", "nothingYet", "steps", "stepsSoFar"].sort(),
    );

    for (const key of keys) {
      const task: string = CODE_TASK_LOG_TASK_RECORD_COPY[key];
      const each: string = CODE_TASK_LOG_TURN_RECORD_COPY[key];

      expect(task.toLowerCase()).toContain("this task");
      expect(each.toLowerCase()).not.toContain("task");
      expect(each).toBe(
        task
          .replace("this task", "this turn")
          .replace("This task", "This turn"),
      );
    }
  });

  test("the record of a turn of three says 'this turn'", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(THREE_TURNS) as never);
    jest
      .spyOn(API, "post")
      .mockResolvedValue(logAnswer("read src/checkout.ts") as never);

    drawLog(`?turn=${SECOND_RUN_ID}`);

    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 2 · Failed");
    });

    expect(
      screen.getByText(CODE_TASK_LOG_TURN_RECORD_COPY.steps),
    ).toBeInTheDocument();
    expect(screen.queryByText(CODE_TASK_LOG_TASK_RECORD_COPY.steps)).toBeNull();
  });

  test("negative control: the record of a task of one turn says 'this task'", async () => {
    getTaskMock.mockResolvedValue(taskAnswer([turn()]) as never);
    jest
      .spyOn(API, "post")
      .mockResolvedValue(logAnswer("read src/checkout.ts") as never);

    drawLog();

    expect(await screen.findByText("read src/checkout.ts")).toBeInTheDocument();
    await waitFor(() => {
      expect(getTaskMock).toHaveBeenCalled();
    });

    expect(
      screen.getByText(CODE_TASK_LOG_TASK_RECORD_COPY.steps),
    ).toBeInTheDocument();
    expect(screen.queryByText(CODE_TASK_LOG_TURN_RECORD_COPY.steps)).toBeNull();
  });

  /*
   * A record that could not be read: said under the way back and the
   * picker, which stay, with Refresh - a finished turn's page does not
   * poll, so nothing else would read it again.
   */
  test("a record that could not be read keeps the way back and the picker, and reads again on Refresh", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(THREE_TURNS) as never);
    const postSpy: SpyInstance<typeof API.post> = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          500,
          { message: "The log could not be read." },
          {},
        ) as never,
      )
      .mockResolvedValue(
        logAnswer("read src/checkout.ts") as never,
      ) as unknown as SpyInstance<typeof API.post>;

    drawLog(`?turn=${SECOND_RUN_ID}`);

    expect(
      await screen.findByText("The log could not be read."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 2 · Failed");
    });
    expect(screen.getByTestId("code-task-log-back")).toBeInTheDocument();
    expect(screen.queryByText("read src/checkout.ts")).toBeNull();

    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(await screen.findByText("read src/checkout.ts")).toBeInTheDocument();
    expect(screen.queryByText("The log could not be read.")).toBeNull();
    // The same turn's record, read again.
    expect(logReads(postSpy)).toEqual([SECOND_RUN_ID, SECOND_RUN_ID]);
  });

  /*
   * On a phone the time and the tool's pill fill a line on their own, so a
   * step's words go on the next line, lined up with the time - before, the
   * row kept one line and cut the words to nothing. jsdom lays nothing out:
   * the classes are what is checked here, the drawn row in the browser
   * suite (packages/E2E/Code).
   */
  test("a step's words take a line of their own on a phone, and stay on the time's line on a wider screen", async () => {
    getTaskMock.mockResolvedValue(taskAnswer([turn()]) as never);
    jest
      .spyOn(API, "post")
      .mockResolvedValue(logAnswer("read src/checkout.ts") as never);

    drawLog();

    const words: HTMLElement = await screen.findByText("read src/checkout.ts");

    // The Runner's words, set apart in the direction they are written in.
    expect(words.tagName).toBe("BDI");
    const message: HTMLElement = words.closest(
      "[data-testid='code-task-log-entry-message']",
    ) as HTMLElement;
    expect(message).not.toBeNull();
    expect(message.className).toContain("max-sm:order-last");
    expect(message.className).toContain("max-sm:basis-full");
    expect(message.className).toContain("truncate");
    // The time, the pill and the words wrap together, beside the marker.
    const row: HTMLElement = message.parentElement!;
    expect(row.className).toContain("max-sm:flex-wrap");
    expect(row.className).toContain("min-w-0");
    // ... only on a phone: one line on a wider screen.
    expect(row.className.split(" ")).not.toContain("flex-wrap");
  });
});

describe("the Log page's turn picker", () => {
  test("a task of three turns lists them; the one the address names is shown", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(THREE_TURNS) as never);
    const postSpy: SpyInstance<typeof API.post> = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        logAnswer("read src/checkout.ts") as never,
      ) as unknown as SpyInstance<typeof API.post>;

    drawLog(`?turn=${SECOND_RUN_ID}`);

    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 2 · Failed");
    });

    expect(logReads(postSpy)).toEqual([SECOND_RUN_ID]);

    // A turn is always shown: the picker has nothing to clear it to.
    expect(picker().querySelector(".ou-select__clear-indicator")).toBeNull();

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

  test("a long task's picker numbers its newer turns past the ones its page does not show", async () => {
    getTaskMock.mockResolvedValue({
      ...taskAnswer(THREE_TURNS),
      turnsNotShown: { count: 197, workMilliseconds: 0 },
    } as never);
    jest
      .spyOn(API, "post")
      .mockResolvedValue(logAnswer("read src/checkout.ts") as never);

    drawLog(`?turn=${THIRD_RUN_ID}`);

    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 200 · Working…");
    });

    /*
     * Between the first turn and the newest, the conversation's own words
     * for the turns it does not show: Turn 1, then Turn 199, reads as the
     * task's numbering, not as turns gone missing.
     */
    expect(
      openPicker().map((option: HTMLElement): string => {
        return option.textContent || "";
      }),
    ).toEqual([
      expect.stringContaining("Turn 1 · Done"),
      "197 earlier turns are not shown",
      expect.stringContaining("Turn 199 · Failed"),
      expect.stringContaining("Turn 200 · Working…"),
    ]);
  });

  test("the line where turns are not shown is never picked: it reads as unavailable, and clicking it goes nowhere", async () => {
    getTaskMock.mockResolvedValue({
      ...taskAnswer(THREE_TURNS),
      turnsNotShown: { count: 1, workMilliseconds: 0 },
    } as never);
    jest
      .spyOn(API, "post")
      .mockResolvedValue(logAnswer("read src/checkout.ts") as never);

    drawLog();

    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 1 · Done");
    });

    const line: HTMLElement = openPicker()[1]!;

    // One turn not shown is said as one.
    expect(line).toHaveTextContent(/^1 earlier turn is not shown$/);
    expect(line).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(line);

    expect(navigateMock).not.toHaveBeenCalled();
    expect(shownTurn()).toBe("Turn 1 · Done");
    // Never a turn: its value is no run's.
    expect(CODE_TASK_LOG_TURNS_NOT_SHOWN_VALUE).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-/,
    );
  });

  test("negative control: a task listed whole has no such line", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(THREE_TURNS) as never);
    jest
      .spyOn(API, "post")
      .mockResolvedValue(logAnswer("read src/checkout.ts") as never);

    drawLog();

    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 1 · Done");
    });

    const options: Array<HTMLElement> = openPicker();

    expect(options).toHaveLength(3);
    for (const option of options) {
      expect(option).not.toHaveTextContent("not shown");
      expect(option).not.toHaveAttribute("aria-disabled", "true");
    }
  });

  test("the line in German, and in Persian the page's way, as the conversation says it", async () => {
    getTaskMock.mockResolvedValue({
      ...taskAnswer(THREE_TURNS),
      turnsNotShown: { count: 197, workMilliseconds: 0 },
    } as never);
    jest
      .spyOn(API, "post")
      .mockResolvedValue(logAnswer("read src/checkout.ts") as never);

    await act(async () => {
      await translation.changeLanguage("de");
    });

    const { unmount }: RenderResult = drawLog();

    await waitFor(() => {
      expect(shownTurn()).toBe("Durchgang 1 · Fertig");
    });

    expect(openPicker()[1]).toHaveTextContent(
      /^197 frühere Durchgänge werden nicht angezeigt$/,
    );

    unmount();

    await act(async () => {
      await translation.changeLanguage("fa");
    });

    drawLog();

    await waitFor(() => {
      expect(shownTurn()).toMatch(/^نوبت ۱ · /);
    });

    const line: HTMLElement = openPicker()[1]!;
    const words: HTMLElement = within(line).getByTestId(
      "dropdown-option-label",
    );

    expect(words).toHaveTextContent(/^۱۹۷ نوبت قبلی نمایش داده نمی/);
    // The product's own words: no direction of their own, the page's.
    expect(words).not.toHaveAttribute("dir");
  });

  /*
   * What was asked under each turn is as its person wrote it - in
   * English, say, on an Arabic page. Laid out right to left with the page,
   * "Retry charges when the gateway times out." came out with its full
   * stop first, and a long request ended its line with "…" on the left.
   * It reads the way it was written now; what started a turn nobody asked
   * for is the product's words in the reader's language, and reads the
   * page's way.
   */
  test("in Arabic, what was asked reads the way it was written; what started a turn, the page's way", async () => {
    const asked: string = "Retry charges when the gateway times out.";
    getTaskMock.mockResolvedValue(
      taskAnswer([
        turn({ request: { message: asked, context: [] } }),
        turn({
          runId: SECOND_RUN_ID,
          recipe: CodeFixTaskType.FixException,
          request: undefined,
        }),
        THREE_TURNS[2]!,
      ]) as never,
    );
    jest.spyOn(API, "post").mockImplementation(logOfEachRun() as never);

    await act(async () => {
      await translation.changeLanguage("ar");
    });

    drawLog();

    await waitFor(() => {
      expect(shownTurn()).toMatch(/^الجولة 1 · /);
    });

    const descriptions: Array<HTMLElement> = openPicker().map(
      (option: HTMLElement): HTMLElement => {
        return within(option).getByTestId("dropdown-option-description");
      },
    );

    // Drawn as written, never looked up: an English request reads left to right.
    expect(descriptions[0]).toHaveTextContent(asked);
    expect(descriptions[0]).toHaveAttribute("dir", "ltr");
    expect(descriptions[2]).toHaveTextContent(
      "Try again with a smaller change",
    );
    expect(descriptions[2]).toHaveAttribute("dir", "ltr");
    // What started it, in Arabic: the page's way, with no direction of its own.
    expect(descriptions[1]).toHaveTextContent("إصلاح الاستثناء");
    expect(descriptions[1]).not.toHaveAttribute("dir");
  });

  test("negative control: in English, what was asked reads the page's way - no direction of its own", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(THREE_TURNS) as never);
    jest.spyOn(API, "post").mockImplementation(logOfEachRun() as never);

    drawLog();

    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 1 · Done");
    });

    for (const option of openPicker()) {
      expect(
        within(option).getByTestId("dropdown-option-description"),
      ).not.toHaveAttribute("dir");
    }
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

/*
 * A LINK TO A TURN A LONG TASK'S PAGE DOES NOT SHOW (issue #7130).
 *
 * A long task's page reads its first turn and its newest. A link can name
 * a turn between them - shared in chat, or bookmarked when the task was
 * shorter. The page asks for that turn by name: when it is one of the
 * task's, its record is shown and the picker lists it at its place, with a
 * line on each side of it for the turns still not listed. A run that is not
 * one of the task's turns shows the task's first turn, and the page says
 * so - never silently.
 */
describe("a link to a turn a long task's page does not show", () => {
  function numbersOf(entries: Array<CodeTaskLogPickerEntry>): Array<string> {
    return entries.map((entry: CodeTaskLogPickerEntry): string => {
      return entry.kind === "turn"
        ? `Turn ${entry.turn.number}`
        : `${entry.count} not listed`;
    });
  }

  test("the picker lists the linked turn at its place, the turns not listed split around it", () => {
    const linkedTurn: { number: number; turn: CodeTaskTurnJSON } = {
      number: 5,
      turn: turn({ runId: LINKED_RUN_ID }),
    };

    expect(
      numbersOf(
        getCodeTaskLogPickerEntries({
          turns: THREE_TURNS,
          turnsNotShown: 197,
          linkedTurn,
        }),
      ),
    ).toEqual([
      "Turn 1",
      "3 not listed",
      "Turn 5",
      "193 not listed",
      "Turn 199",
      "Turn 200",
    ]);

    // Right after the first turn, and right before the newest: one line.
    expect(
      numbersOf(
        getCodeTaskLogPickerEntries({
          turns: THREE_TURNS,
          turnsNotShown: 197,
          linkedTurn: { ...linkedTurn, number: 2 },
        }),
      ),
    ).toEqual(["Turn 1", "Turn 2", "196 not listed", "Turn 199", "Turn 200"]);
    expect(
      numbersOf(
        getCodeTaskLogPickerEntries({
          turns: THREE_TURNS,
          turnsNotShown: 197,
          linkedTurn: { ...linkedTurn, number: 198 },
        }),
      ),
    ).toEqual(["Turn 1", "196 not listed", "Turn 198", "Turn 199", "Turn 200"]);
  });

  test("negative control: without a linked turn, one line between the first turn and the newest", () => {
    expect(
      numbersOf(
        getCodeTaskLogPickerEntries({ turns: THREE_TURNS, turnsNotShown: 197 }),
      ),
    ).toEqual(["Turn 1", "197 not listed", "Turn 199", "Turn 200"]);
    // A task listed whole has no line at all.
    expect(
      numbersOf(getCodeTaskLogPickerEntries({ turns: THREE_TURNS })),
    ).toEqual(["Turn 1", "Turn 2", "Turn 3"]);
  });

  test("a linked turn already listed, or with no place after the first, is not listed twice", () => {
    for (const linkedTurn of [
      // One the page shows, named in capitals.
      { number: 199, turn: turn({ runId: SECOND_RUN_ID.toUpperCase() }) },
      // No place after the first turn: nonsense.
      { number: 1, turn: turn({ runId: LINKED_RUN_ID }) },
      { number: 4.5, turn: turn({ runId: LINKED_RUN_ID }) },
      { number: Number.NaN, turn: turn({ runId: LINKED_RUN_ID }) },
    ]) {
      expect(
        numbersOf(
          getCodeTaskLogPickerEntries({
            turns: THREE_TURNS,
            turnsNotShown: 197,
            linkedTurn,
          }),
        ),
      ).toEqual(["Turn 1", "197 not listed", "Turn 199", "Turn 200"]);
    }
  });

  test("a link to turn 5 of 200 opens turn 5: its record, its place in the picker, nothing said", async () => {
    getTaskMock.mockResolvedValue(longTaskAnswer(true) as never);
    const postSpy: SpyInstance<typeof API.post> = jest
      .spyOn(API, "post")
      .mockImplementation(logOfEachRun() as never) as unknown as SpyInstance<
      typeof API.post
    >;

    drawLog(`?turn=${LINKED_RUN_ID}`);

    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 5 · Failed");
    });

    expect(
      await screen.findByText(`step of ${LINKED_RUN_ID}`),
    ).toBeInTheDocument();
    // The task was asked for the address's turn by name.
    expect(getTaskMock).toHaveBeenCalledWith(TASK_ID, { turn: LINKED_RUN_ID });
    // Its record, never the first turn's.
    expect(logReads(postSpy)).toEqual([LINKED_RUN_ID]);
    expect(notOfTask()).toBeNull();

    expect(pickerTexts()).toEqual([
      expect.stringContaining("Turn 1 · Done"),
      "3 earlier turns are not shown",
      expect.stringContaining("Turn 5 · Failed"),
      "193 earlier turns are not shown",
      expect.stringContaining("Turn 199 · Failed"),
      expect.stringContaining("Turn 200 · Working…"),
    ]);
  });

  test("negative control: a read that does not hold the linked turn shows turn 1 - and says so, never silently", async () => {
    getTaskMock.mockResolvedValue(longTaskAnswer(false) as never);
    jest.spyOn(API, "post").mockImplementation(logOfEachRun() as never);

    drawLog(`?turn=${LINKED_RUN_ID}`);

    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 1 · Done");
    });

    expect(notOfTask()).toHaveTextContent(NOT_OF_TASK_TITLE);
  });

  test("a link cut short when it was pasted - no run's id at all - shows turn 1, and says so: never silently", async () => {
    getTaskMock.mockResolvedValue(longTaskAnswer(false) as never);
    const postSpy: SpyInstance<typeof API.post> = jest
      .spyOn(API, "post")
      .mockImplementation(logOfEachRun() as never) as unknown as SpyInstance<
      typeof API.post
    >;

    // The fifth turn's id, its last part lost.
    drawLog(`?turn=${LINKED_RUN_ID.slice(0, 23)}`);

    expect(await screen.findByText(`step of ${TASK_ID}`)).toBeInTheDocument();
    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 1 · Done");
    });

    const notice: HTMLElement = notOfTask()!;

    expect(notice).toHaveTextContent(NOT_OF_TASK_TITLE);
    expect(notice).toHaveTextContent(NOT_OF_TASK_BODY);
    // Nothing to ask the server for: the task is read for no turn.
    expect(getTaskMock).toHaveBeenCalledTimes(1);
    expect(getTaskMock).toHaveBeenCalledWith(TASK_ID, {});
    // Only the first turn's record is read - nothing by the broken id.
    expect(logReads(postSpy)).toEqual([TASK_ID]);
  });

  test("negative control: an empty turn in the address names none - turn 1, and nothing said", async () => {
    getTaskMock.mockResolvedValue(longTaskAnswer(false) as never);
    jest.spyOn(API, "post").mockImplementation(logOfEachRun() as never);

    drawLog("?turn=");

    expect(await screen.findByText(`step of ${TASK_ID}`)).toBeInTheDocument();
    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 1 · Done");
    });
    expect(notOfTask()).toBeNull();
  });

  test("the lines around the linked turn are never picked; picking the newest turn opens it, and the task is not read again", async () => {
    getTaskMock.mockResolvedValue(longTaskAnswer(true) as never);
    jest.spyOn(API, "post").mockImplementation(logOfEachRun() as never);

    const view: RenderResult = drawLog(`?turn=${LINKED_RUN_ID}`);

    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 5 · Failed");
    });

    const options: Array<HTMLElement> = openPicker();

    expect(options[1]).toHaveAttribute("aria-disabled", "true");
    expect(options[3]).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(options[3]!);
    expect(navigateMock).not.toHaveBeenCalled();

    fireEvent.click(openPicker()[5]!);

    expect(String(navigateMock.mock.calls[0]![0])).toBe(
      `${LOG_PATH}?turn=${THIRD_RUN_ID}`,
    );

    // The address now names the newest turn: the read the page has holds it.
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
    expect(shownTurn()).toBe("Turn 200 · Working…");
    expect(getTaskMock).toHaveBeenCalledTimes(1);
    // The linked turn keeps its place in the picker.
    expect(pickerTexts()[2]).toEqual(
      expect.stringContaining("Turn 5 · Failed"),
    );
  });

  test("an address that names another task's run shows this task's first turn, and says so - that run's record never on the page", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(THREE_TURNS) as never);
    const postSpy: SpyInstance<typeof API.post> = jest
      .spyOn(API, "post")
      .mockImplementation(logOfEachRun() as never) as unknown as SpyInstance<
      typeof API.post
    >;

    drawLog(`?turn=${OTHER_TASK_RUN_ID}`);

    expect(await screen.findByText(`step of ${TASK_ID}`)).toBeInTheDocument();
    expect(shownTurn()).toBe("Turn 1 · Done");
    expect(getTaskMock).toHaveBeenCalledWith(TASK_ID, {
      turn: OTHER_TASK_RUN_ID,
    });

    const notice: HTMLElement = notOfTask()!;

    expect(notice).toHaveTextContent(NOT_OF_TASK_TITLE);
    expect(notice).toHaveTextContent(NOT_OF_TASK_BODY);
    expect(screen.queryByText(`step of ${OTHER_TASK_RUN_ID}`)).toBeNull();
    // The first turn's record is the one shown.
    expect(logReads(postSpy)).toContain(TASK_ID);
  });

  test("while the task is read, the address's run's record is not shown - not even another task's", async () => {
    let answerTask: (value: unknown) => void = () => {};
    getTaskMock.mockImplementation(() => {
      return new Promise((resolve: (value: unknown) => void) => {
        answerTask = resolve;
      });
    });
    const postSpy: SpyInstance<typeof API.post> = jest
      .spyOn(API, "post")
      .mockImplementation(logOfEachRun() as never) as unknown as SpyInstance<
      typeof API.post
    >;

    drawLog(`?turn=${OTHER_TASK_RUN_ID}`);

    // Its record is read meanwhile, and comes back: still not on the page.
    await waitFor(() => {
      expect(logReads(postSpy)).toEqual([OTHER_TASK_RUN_ID]);
    });
    /*
     * The answer in, and taken in by the page: the read's promise, then a
     * turn of the event loop for everything chained on it.
     */
    await act(async () => {
      await postSpy.mock.results[0]!.value;
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 20);
      });
    });
    expect(getTaskMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(`step of ${OTHER_TASK_RUN_ID}`)).toBeNull();
    expect(screen.getByTestId("code-task-log-back")).toBeInTheDocument();

    await act(async () => {
      answerTask(taskAnswer(THREE_TURNS));
    });

    expect(await screen.findByText(`step of ${TASK_ID}`)).toBeInTheDocument();
    expect(screen.queryByText(`step of ${OTHER_TASK_RUN_ID}`)).toBeNull();
    expect(notOfTask()).not.toBeNull();
  });

  /*
   * Stricter: not even for one render. The other run's record is in by
   * the time the task's read says it is not the task's, and the page then
   * shows the task's first turn: drawn once with the record it held, before
   * an effect cleared it, the other task's steps were on the screen for a
   * frame, under this task's name and the notice. Everything ever added to
   * the page is watched.
   */
  test("another task's run's record never reaches the page - not even for one render as the first turn takes its place", async () => {
    let answerTask: (value: unknown) => void = () => {};
    getTaskMock.mockImplementation(() => {
      return new Promise((resolve: (value: unknown) => void) => {
        answerTask = resolve;
      });
    });
    const postSpy: SpyInstance<typeof API.post> = jest
      .spyOn(API, "post")
      .mockImplementation(logOfEachRun() as never) as unknown as SpyInstance<
      typeof API.post
    >;

    const drawn: Array<string> = [];
    const observer: MutationObserver = new MutationObserver(
      (records: Array<MutationRecord>): void => {
        for (const record of records) {
          record.addedNodes.forEach((node: Node): void => {
            drawn.push(node.textContent || "");
          });
        }
      },
    );
    observer.observe(document.body, { childList: true, subtree: true });

    try {
      drawLog(`?turn=${OTHER_TASK_RUN_ID}`);

      await waitFor(() => {
        expect(logReads(postSpy)).toEqual([OTHER_TASK_RUN_ID]);
      });
      await act(async () => {
        await postSpy.mock.results[0]!.value;
        await new Promise((resolve: (value: unknown) => void) => {
          setTimeout(resolve, 20);
        });
      });

      await act(async () => {
        answerTask(taskAnswer(THREE_TURNS));
      });

      expect(await screen.findByText(`step of ${TASK_ID}`)).toBeInTheDocument();
      expect(notOfTask()).not.toBeNull();
    } finally {
      observer.disconnect();
    }

    // The first turn's record was drawn; the other run's, never.
    expect(
      drawn.some((text: string): boolean => {
        return text.includes(`step of ${TASK_ID}`);
      }),
    ).toBe(true);
    expect(
      drawn.filter((text: string): boolean => {
        return text.includes(`step of ${OTHER_TASK_RUN_ID}`);
      }),
    ).toEqual([]);
  });

  test("the notice is said as soon as the task's read says so, while the first turn's record is still on its way", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(THREE_TURNS) as never);

    let answerFirst: (value: HTTPResponse<JSONObject>) => void = () => {};
    const firstAnswer: Promise<HTTPResponse<JSONObject>> = new Promise(
      (resolve: (value: HTTPResponse<JSONObject>) => void) => {
        answerFirst = resolve;
      },
    );

    jest.spyOn(API, "post").mockImplementation((async (data: {
      url: URL;
    }): Promise<HTTPResponse<JSONObject>> => {
      const runId: string =
        data.url.toString().split("/code-fix-run/logs/")[1] || "";

      if (runId === TASK_ID) {
        return firstAnswer;
      }

      return logAnswer(`step of ${runId}`);
    }) as never);

    drawLog(`?turn=${OTHER_TASK_RUN_ID}`);

    await waitFor(() => {
      expect(notOfTask()).not.toBeNull();
    });
    expect(shownTurn()).toBe("Turn 1 · Done");
    // Nothing of a record yet: neither the other run's nor the first turn's.
    expect(screen.queryByText(`step of ${OTHER_TASK_RUN_ID}`)).toBeNull();
    expect(screen.queryByText("Session Log")).toBeNull();

    await act(async () => {
      answerFirst(logAnswer(`step of ${TASK_ID}`));
      await firstAnswer;
    });

    expect(await screen.findByText(`step of ${TASK_ID}`)).toBeInTheDocument();
    expect(notOfTask()).toHaveTextContent(NOT_OF_TASK_TITLE);
  });

  /*
   * Back and forth between two links before a read is in: turn 5 (held),
   * then turn 6 (asked for), then turn 5 again. Turn 6's answer, coming in
   * last, is not the page's any more - taken in, it would leave the page
   * waiting on a read that holds neither turn.
   */
  test("an answer for a turn the address has moved on from is dropped: the page keeps the turn it shows", async () => {
    let answerSixth: (value: unknown) => void = () => {};
    getTaskMock
      .mockResolvedValueOnce(longTaskAnswer(true) as never)
      .mockImplementationOnce(() => {
        return new Promise((resolve: (value: unknown) => void) => {
          answerSixth = resolve;
        });
      });
    jest.spyOn(API, "post").mockImplementation(logOfEachRun() as never);

    const view: RenderResult = drawLog(`?turn=${LINKED_RUN_ID}`);

    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 5 · Failed");
    });

    // Turn 6: not in the read the page has, so asked for.
    redrawLog(view, `?turn=${SIXTH_RUN_ID}`);
    await waitFor(() => {
      expect(getTaskMock).toHaveBeenCalledTimes(2);
    });
    expect(getTaskMock).toHaveBeenLastCalledWith(TASK_ID, {
      turn: SIXTH_RUN_ID,
    });

    // Back to turn 5 before that answer is in: the read the page has holds it.
    redrawLog(view, `?turn=${LINKED_RUN_ID}`);
    expect(
      await screen.findByText(`step of ${LINKED_RUN_ID}`),
    ).toBeInTheDocument();

    await act(async () => {
      answerSixth({
        ...longTaskAnswer(false),
        linkedTurn: {
          number: 6,
          turn: turn({
            runId: SIXTH_RUN_ID,
            request: { message: "And the refunds API", context: [] },
          }),
        },
      });
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 20);
      });
    });

    expect(shownTurn()).toBe("Turn 5 · Failed");
    expect(screen.getByText(`step of ${LINKED_RUN_ID}`)).toBeInTheDocument();
    expect(getTaskMock).toHaveBeenCalledTimes(2);
  });

  /*
   * The page stays on the screen when a link opens another task's Log: the
   * read it has is of the task before, and says nothing of the new one -
   * not even that a turn of the task before, named in the new address, is
   * the new task's. The new task is read, and its own turns listed.
   */
  test("another task's Log opened while the page is on the screen: that task is read, and its own turns listed", async () => {
    // The new task's Log, naming a turn of the task before.
    const otherTaskPath: string = `/dashboard/${PROJECT_ID}/code/tasks/${OTHER_TASK_ID}/log?turn=${SECOND_RUN_ID}`;

    let answerOtherTask: (value: unknown) => void = () => {};
    getTaskMock.mockImplementation((taskId: unknown) => {
      if (taskId !== OTHER_TASK_ID) {
        return Promise.resolve(taskAnswer(THREE_TURNS));
      }

      return new Promise((resolve: (value: unknown) => void) => {
        answerOtherTask = resolve;
      });
    });
    const postSpy: SpyInstance<typeof API.post> = jest
      .spyOn(API, "post")
      .mockImplementation(logOfEachRun() as never) as unknown as SpyInstance<
      typeof API.post
    >;

    let navigate: NavigateFunction | null = null;

    function RouterNavigate(): null {
      navigate = useNavigate();
      return null;
    }

    goTo(LOG_PATH);
    render(
      <I18nextProvider i18n={translation}>
        <MemoryRouter initialEntries={[LOG_PATH]}>
          <RouterNavigate />
          <Routes>
            <RouterRoute
              path="/dashboard/:projectId/code/tasks/:id/log"
              element={<CodeTaskLog {...PAGE_PROPS} />}
            />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>,
    );

    await waitFor(() => {
      expect(shownTurn()).toBe("Turn 1 · Done");
    });
    expect(pickerTexts()).toHaveLength(3);
    fireEvent.keyDown(within(picker()).getByRole("combobox"), {
      key: "Escape",
      code: "Escape",
    });

    await act(async () => {
      goTo(otherTaskPath);
      navigate!(otherTaskPath);
    });

    // Asked for by name, of the new task.
    await waitFor(() => {
      expect(getTaskMock).toHaveBeenLastCalledWith(OTHER_TASK_ID, {
        turn: SECOND_RUN_ID,
      });
    });
    await waitFor(() => {
      expect(logReads(postSpy)).toContain(SECOND_RUN_ID);
    });
    // Every answer in but the new task's: nothing of the task before shown.
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 20);
      });
    });
    expect(screen.queryByText(`step of ${SECOND_RUN_ID}`)).toBeNull();
    expect(screen.queryByTestId(CODE_TASK_LOG_TURN_PICKER_TEST_ID)).toBeNull();

    await act(async () => {
      answerOtherTask(
        taskAnswer([
          turn({
            runId: OTHER_TASK_ID,
            request: { message: "Cache the exchange rates", context: [] },
          }),
          turn({
            runId: OTHER_TASK_RUN_ID,
            request: { message: "Expire them hourly", context: [] },
          }),
        ]),
      );
    });

    // The turn is not the new task's: its first turn, and the page says so.
    expect(
      await screen.findByText(`step of ${OTHER_TASK_ID}`),
    ).toBeInTheDocument();
    expect(notOfTask()).not.toBeNull();
    expect(screen.queryByText(`step of ${SECOND_RUN_ID}`)).toBeNull();

    await waitFor(() => {
      expect(pickerTexts()).toEqual([
        expect.stringContaining("Cache the exchange rates"),
        expect.stringContaining("Expire them hourly"),
      ]);
    });
  });

  test.each([
    ["no turn", "", {}],
    [
      "a turn the task shows",
      `?turn=${SECOND_RUN_ID}`,
      { turn: SECOND_RUN_ID },
    ],
  ])(
    "negative control: an address with %s says nothing of the sort",
    async (_name: string, search: string, asked: Record<string, string>) => {
      getTaskMock.mockResolvedValue(taskAnswer(THREE_TURNS) as never);
      jest.spyOn(API, "post").mockImplementation(logOfEachRun() as never);

      drawLog(search);

      await waitFor(() => {
        expect(shownTurn()).toMatch(/^Turn [12] · /);
      });

      expect(getTaskMock).toHaveBeenCalledWith(TASK_ID, asked);
      expect(notOfTask()).toBeNull();
      expect(screen.queryByText(NOT_OF_TASK_TITLE)).toBeNull();
    },
  );

  test("a task that could not be read shows the address's turn, as before, and says nothing", async () => {
    getTaskMock.mockRejectedValue(new Error("The task could not be read."));
    jest.spyOn(API, "post").mockImplementation(logOfEachRun() as never);

    drawLog(`?turn=${SECOND_RUN_ID}`);

    expect(
      await screen.findByText(`step of ${SECOND_RUN_ID}`),
    ).toBeInTheDocument();
    expect(notOfTask()).toBeNull();
  });

  test("the notice in German and in Arabic, the page's way - never in English", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(THREE_TURNS) as never);
    jest.spyOn(API, "post").mockImplementation(logOfEachRun() as never);

    await act(async () => {
      await translation.changeLanguage("de");
    });

    const { unmount }: RenderResult = drawLog(`?turn=${OTHER_TASK_RUN_ID}`);

    await waitFor(() => {
      expect(notOfTask()).not.toBeNull();
    });

    expect(notOfTask()).toHaveTextContent(
      "Dieser Durchgang gehört nicht zu dieser Aufgabe",
    );
    expect(notOfTask()).toHaveTextContent(
      "Stattdessen wird der erste Durchgang der Aufgabe angezeigt.",
    );
    expect(notOfTask()).not.toHaveTextContent(NOT_OF_TASK_TITLE);
    expect(shownTurn()).toBe("Durchgang 1 · Fertig");

    unmount();

    await act(async () => {
      await translation.changeLanguage("ar");
    });

    drawLog(`?turn=${OTHER_TASK_RUN_ID}`);

    await waitFor(() => {
      expect(notOfTask()).not.toBeNull();
    });

    expect(notOfTask()).toHaveTextContent(
      "تلك الجولة ليست جزءًا من هذه المهمة",
    );
    expect(notOfTask()).toHaveTextContent(
      "تُعرض الجولة الأولى من المهمة بدلًا منها.",
    );
    expect(notOfTask()).not.toHaveTextContent(NOT_OF_TASK_BODY);
    // Latin digits, as Arabic in OneUptime writes them.
    expect(shownTurn()).toMatch(/^الجولة 1 · /);
  });
});
