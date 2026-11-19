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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskEarlierTurnsJSON,
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskSummaryJSON,
  CodeTaskTurnJSON,
  CodeTaskTurnsNotShownJSON,
} from "../../../Types/AI/CodeTask";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import Navigation from "../../../UI/Utils/Navigation";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import arabicLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ar.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * SHOW EARLIER TURNS, AND JUMP TO NEWEST (#7128, #7129).
 *
 * A task kept open for weeks is sent to its page as its first turn and its
 * newest 199, with how many turns between them are not shown. Under the
 * first turn, the line that says so reads the turns just before the oldest
 * the page has, 50 at a time, and draws them there - the line pressed
 * staying where it is, saying how many are left, until none are and it
 * goes. The earlier turns are kept for the task while the Dashboard is
 * open: coming back to it keeps them, and its Log's turn picker lists them.
 *
 * The page opens at its top, and while its newest turn is out of view a
 * button over the reply box takes the reader there, and follows from
 * there; it never moves the page by itself.
 */

const getTaskMock: MockFunction = getJestMockFunction();
const getEarlierTurnsMock: MockFunction = getJestMockFunction();
const getTurnProgressMock: MockFunction = getJestMockFunction();

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
        getEarlierTurns: (...args: Array<unknown>) => {
          return getEarlierTurnsMock(...args);
        },
        getTurnProgress: (...args: Array<unknown>) => {
          return getTurnProgressMock(...args);
        },
      },
    };
  },
);

jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return React.createElement(
        "div",
        { "data-testid": "markdown" },
        props.text,
      );
    },
  };
});

import CodeTaskConversation from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Task/Conversation";
import {
  CodeTaskConversationEntry,
  CodeTaskNumberedTurnJSON,
  forgetEarlierTurns,
  getConversationEntries,
  getKeptEarlierTurns,
  keepEarlierTurns,
  keepTurnsNoLongerSent,
  MAX_TASKS_WITH_EARLIER_TURNS_KEPT,
  mergeNumberedTurns,
  numberEarlierTurns,
  numberSentTurns,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskEarlierTurns";
import { isNewestOutOfView } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskJumpToNewest";
import {
  CodeTaskLogPickerEntry,
  getCodeTaskLogPickerEntries,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskLogTurns";

const TASK_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";
const REPOSITORY_ID: string = "6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e9f";

// Turn n's run id: the task's own for the first.
function runIdOf(n: number): string {
  return n === 1
    ? TASK_ID
    : `7d8e9f0a-1b2c-4d3e-8f4a-${n.toString(16).padStart(12, "0")}`;
}

// The turn a run id is: runIdOf's inverse.
function numberOf(runId: string): number {
  return runId === TASK_ID ? 1 : parseInt(runId.slice(-12), 16);
}

// Every number from `from` to `to`, both included.
function range(from: number, to: number): Array<number> {
  const numbers: Array<number> = [];

  for (let n: number = from; n <= to; n++) {
    numbers.push(n);
  }

  return numbers;
}

// The marks a sentence sets a value apart with (FSI, LRI, RLI ... PDI).
const ISOLATE_MARKS: RegExp = new RegExp(
  `[${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2069)}]`,
  "g",
);

const translation: i18n = createInstance();

const PAGE_PROPS: {
  pageRoute: Route;
  currentProject: null;
  hasPaymentMethod: boolean;
} = {
  pageRoute: new Route("/"),
  currentProject: null,
  hasPaymentMethod: true,
};

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      de: { translation: germanLocale },
      ar: { translation: arabicLocale },
      fa: { translation: persianLocale },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  getTaskMock.mockReset();
  getEarlierTurnsMock.mockReset();
  getTurnProgressMock.mockReset();
  forgetEarlierTurns();
  jest.spyOn(Navigation, "navigate").mockImplementation((() => {}) as never);
  goTo(`/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`);
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await translation.changeLanguage("en");
});

function summary(): CodeTaskSummaryJSON {
  return {
    id: TASK_ID,
    taskNumber: 42,
    title: "Keep the users API fast",
    recipe: CodeFixTaskType.CodeRequest,
    state: CodeTaskState.Done,
    isQueued: false,
    createdAt: "2026-10-01T09:00:00.000Z",
    lastActivityAt: "2026-10-30T09:00:00.000Z",
    origin: { type: CodeTaskOriginType.Request, label: "Ada Lovelace" },
    turnCount: 205,
    codeRepositoryId: REPOSITORY_ID,
  };
}

// Turn n: asked, then worked on by AI for a minute.
function turn(n: number): CodeTaskTurnJSON {
  const asked: number = Date.UTC(2026, 9, 1, 9, 0, 0) + (n - 1) * 3600000;

  return {
    runId: runIdOf(n),
    recipe: CodeFixTaskType.CodeRequest,
    status: AIRunStatus.Completed,
    state: CodeTaskState.Done,
    createdAt: new Date(asked).toISOString(),
    startedAt: new Date(asked).toISOString(),
    completedAt: new Date(asked + 60000).toISOString(),
    requestedBy: { id: "ada", name: "Ada Lovelace" },
    request: { message: `Turn ${n}: keep going`, context: [] },
    outcome: { summary: `Reply to turn ${n}`, filesChanged: [] },
    steps: [],
    pullRequests: [],
    needsInput: false,
  };
}

function numbered(numbers: Array<number>): Array<CodeTaskNumberedTurnJSON> {
  return numbers.map((n: number): CodeTaskNumberedTurnJSON => {
    return { number: n, turn: turn(n) };
  });
}

/*
 * A task of 205 turns sent as its first and its newest: turns 1 and
 * `firstShown` to 205, the ones between not shown.
 */
function taskAnswer(firstShown: number = 103): Record<string, unknown> {
  const turnsNotShown: CodeTaskTurnsNotShownJSON = {
    count: firstShown - 2,
    workMilliseconds: (firstShown - 2) * 60000,
  };

  return {
    task: summary(),
    turns: [turn(1), ...range(firstShown, 205).map(turn)],
    turnsNotShown,
    repository: {
      id: REPOSITORY_ID,
      name: "users-api",
      organizationName: "acme",
      repositoryName: "users-api",
      mainBranchName: "main",
      isConnected: true,
    },
    canAsk: true,
    canSeeChanges: true,
    canReadLogContent: true,
    blocker: null,
  };
}

// What the server answers for the turns just before `before`, at most 50.
function earlierThan(before: string): CodeTaskEarlierTurnsJSON {
  const last: number = numberOf(before) - 1;
  const first: number = Math.max(2, last - 49);

  return { turns: range(first, last).map(turn), firstNumber: first };
}

function draw(): void {
  render(
    <I18nextProvider i18n={translation}>
      <CodeTaskConversation {...PAGE_PROPS} />
    </I18nextProvider>,
  );
}

// The turns the page draws, by their place: each turn's request.
function drawnTurns(): Array<number> {
  return screen
    .getAllByTestId("code-turn-request")
    .map((request: HTMLElement): number => {
      return Number((request.textContent || "").match(/Turn (\d+)/)?.[1]);
    });
}

function lineWords(): string {
  return (
    screen.getByTestId("code-task-turns-not-shown-divider").textContent || ""
  ).replace(ISOLATE_MARKS, "");
}

describe("a long task's turns, at their places (CodeTaskEarlierTurns)", () => {
  test("the turns a page was sent: the first is 1, the newest after the ones not shown", () => {
    expect(
      numberSentTurns([turn(1), turn(103), turn(104)], 101).map(
        (entry: CodeTaskNumberedTurnJSON): number => {
          return entry.number;
        },
      ),
    ).toEqual([1, 103, 104]);
    expect(
      numberSentTurns([turn(1), turn(2)]).map(
        (entry: CodeTaskNumberedTurnJSON): number => {
          return entry.number;
        },
      ),
    ).toEqual([1, 2]);
  });

  test("a page of earlier turns, from the place the server numbered its first", () => {
    expect(
      numberEarlierTurns({ turns: [turn(53), turn(54)], firstNumber: 53 }).map(
        (entry: CodeTaskNumberedTurnJSON): number => {
          return entry.number;
        },
      ),
    ).toEqual([53, 54]);
  });

  function kinds(entries: Array<CodeTaskConversationEntry>): Array<string> {
    return entries.map((entry: CodeTaskConversationEntry): string => {
      return entry.kind === "turn"
        ? `${entry.number}${entry.isSent ? "" : "*"}`
        : `line ${entry.count} before ${numberOf(entry.beforeRunId)}`;
    });
  }

  test("nothing asked for: the first turn, one line, then the newest", () => {
    expect(
      kinds(
        getConversationEntries({
          turns: [turn(1), turn(103), turn(104)],
          turnsNotShown: 101,
        }),
      ),
    ).toEqual(["1", "line 101 before 103", "103", "104"]);
  });

  test("earlier turns asked for: drawn between the line and the newest, the line saying what is left", () => {
    expect(
      kinds(
        getConversationEntries({
          turns: [turn(1), turn(103), turn(104)],
          turnsNotShown: 101,
          earlier: numbered(range(53, 102)),
        }),
      ),
    ).toEqual([
      "1",
      "line 51 before 53",
      ...range(53, 102).map((n: number): string => {
        return `${n}*`;
      }),
      "103",
      "104",
    ]);
  });

  test("every turn shown: no line at all", () => {
    expect(
      kinds(
        getConversationEntries({
          turns: [turn(1), turn(4)],
          turnsNotShown: 2,
          earlier: numbered([2, 3]),
        }),
      ),
    ).toEqual(["1", "2*", "3*", "4"]);
  });

  test("a gap between the earlier turns and the newest has a line of its own, which reads the turns before the newest", () => {
    expect(
      kinds(
        getConversationEntries({
          turns: [turn(1), turn(103)],
          turnsNotShown: 101,
          earlier: numbered([50, 51]),
        }),
      ),
    ).toEqual([
      "1",
      "line 48 before 50",
      "50*",
      "51*",
      "line 51 before 103",
      "103",
    ]);
  });

  test("a turn read twice is drawn once, at one place - the page's own reading wins", () => {
    const merged: Array<CodeTaskNumberedTurnJSON> = mergeNumberedTurns(
      numbered([5, 6]),
      [{ number: 7, turn: turn(6) }],
      numbered([6]),
    );

    expect(
      merged.map((entry: CodeTaskNumberedTurnJSON): string => {
        return `${entry.number}:${numberOf(entry.turn.runId)}`;
      }),
    ).toEqual(["5:5", "6:6"]);
  });

  test("a read that no longer sends the oldest turn shown keeps it with the earlier turns - never the first, never one sent", () => {
    const kept: Array<CodeTaskNumberedTurnJSON> = keepTurnsNoLongerSent({
      earlier: numbered([100, 101, 102]),
      sentBefore: numbered([1, 103, 104, 105]),
      sentNow: numbered([1, 104, 105, 106]),
    });

    expect(
      kept.map((entry: CodeTaskNumberedTurnJSON): number => {
        return entry.number;
      }),
    ).toEqual([100, 101, 102, 103]);
  });

  test("the earlier turns are kept per task, the newest tasks', a few at a time", () => {
    keepEarlierTurns(TASK_ID, numbered([2, 3]));

    expect(getKeptEarlierTurns(TASK_ID.toUpperCase())).toHaveLength(2);

    for (
      let index: number = 0;
      index < MAX_TASKS_WITH_EARLIER_TURNS_KEPT;
      index++
    ) {
      keepEarlierTurns(`other-${index}`, numbered([2]));
    }

    // The oldest kept gave way to the newest.
    expect(getKeptEarlierTurns(TASK_ID)).toEqual([]);

    keepEarlierTurns("other-3", []);
    expect(getKeptEarlierTurns("other-3")).toEqual([]);
  });
});

describe("Show earlier turns", () => {
  test("reads the 50 just before the oldest turn shown, and draws them between the line and it, the line saying what is left", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(103) as never);
    getEarlierTurnsMock.mockImplementation((async (data: {
      before: string;
    }) => {
      return earlierThan(data.before);
    }) as never);

    draw();

    expect(await screen.findByTestId("code-task-turns-not-shown")).toBeTruthy();
    expect(lineWords()).toBe("101 earlier turns are not shown");

    await userEvent.click(screen.getByTestId("code-task-show-earlier-turns"));

    await waitFor(() => {
      expect(lineWords()).toBe("51 earlier turns are not shown");
    });
    expect(getEarlierTurnsMock).toHaveBeenCalledWith({
      taskId: TASK_ID,
      before: runIdOf(103),
    });
    expect(drawnTurns()).toEqual([1, ...range(53, 205)]);

    // Drawn where a screen reader is not told each as it arrives.
    const earlier: HTMLElement = screen.getByTestId("code-task-earlier-turns");
    expect(earlier.firstElementChild).toHaveAttribute("aria-live", "off");
    expect(within(earlier).getAllByTestId("code-turn-request")).toHaveLength(
      50,
    );
    // The line keeps its place, above them, and its button the focus.
    const list: HTMLElement = screen.getByTestId("code-task-turns");
    expect(
      Array.from(list.children).indexOf(
        screen.getByTestId("code-task-turns-not-shown"),
      ),
    ).toBe(2);
    expect(Array.from(list.children).indexOf(earlier)).toBe(3);
  });

  test("read again and again, back to the first turn: the line goes, and the focus goes to the first turn it drew", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(103) as never);
    getEarlierTurnsMock.mockImplementation((async (data: {
      before: string;
    }) => {
      return earlierThan(data.before);
    }) as never);

    draw();
    await screen.findByTestId("code-task-turns-not-shown");

    await userEvent.click(screen.getByTestId("code-task-show-earlier-turns"));
    await waitFor(() => {
      expect(lineWords()).toBe("51 earlier turns are not shown");
    });

    await userEvent.click(screen.getByTestId("code-task-show-earlier-turns"));
    await waitFor(() => {
      expect(lineWords()).toBe("1 earlier turn is not shown");
    });
    expect(getEarlierTurnsMock).toHaveBeenLastCalledWith({
      taskId: TASK_ID,
      before: runIdOf(53),
    });

    await userEvent.click(screen.getByTestId("code-task-show-earlier-turns"));
    await waitFor(() => {
      expect(screen.queryByTestId("code-task-turns-not-shown")).toBeNull();
    });

    expect(drawnTurns()).toEqual(
      range(1, 205).filter((n: number) => {
        return n !== 0;
      }),
    );
    // The turn that took the line's place holds the focus, not the page.
    expect(document.activeElement).toBe(
      screen
        .getAllByTestId("code-turn-request")
        .find((request: HTMLElement): boolean => {
          return request.getAttribute("data-turn-id") === runIdOf(2);
        }),
    );
  });

  test("the page does not move: nothing scrolls when the earlier turns are drawn", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(103) as never);
    getEarlierTurnsMock.mockImplementation((async (data: {
      before: string;
    }) => {
      return earlierThan(data.before);
    }) as never);
    let scrollTop: number = 1234;
    Object.defineProperty(document.documentElement, "scrollTop", {
      configurable: true,
      get: (): number => {
        return scrollTop;
      },
      set: (value: number): void => {
        scrollTop = value;
      },
    });

    try {
      draw();
      await screen.findByTestId("code-task-turns-not-shown");
      await userEvent.click(screen.getByTestId("code-task-show-earlier-turns"));
      await waitFor(() => {
        expect(lineWords()).toBe("51 earlier turns are not shown");
      });

      expect(scrollTop).toBe(1234);
    } finally {
      Reflect.deleteProperty(document.documentElement, "scrollTop");
    }
  });

  test("how long AI worked still counts every turn once: the ones drawn now are not counted twice", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(103) as never);
    getEarlierTurnsMock.mockImplementation((async (data: {
      before: string;
    }) => {
      return earlierThan(data.before);
    }) as never);

    draw();
    await screen.findByTestId("code-task-turns-not-shown");

    // 205 turns, a minute each.
    expect(screen.getByTestId("code-task-work-time")).toHaveTextContent(
      "worked 3 hours, 25 minutes",
    );

    await userEvent.click(screen.getByTestId("code-task-show-earlier-turns"));
    await waitFor(() => {
      expect(lineWords()).toBe("51 earlier turns are not shown");
    });

    expect(screen.getByTestId("code-task-work-time")).toHaveTextContent(
      "worked 3 hours, 25 minutes",
    );
  });

  test("a read that fails says why under the line, which stays to try again", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(103) as never);
    getEarlierTurnsMock.mockRejectedValueOnce(
      new HTTPErrorResponse(
        404,
        { message: "Task not found, or you do not have access to it." },
        {},
      ) as never,
    );

    draw();
    await screen.findByTestId("code-task-turns-not-shown");
    await userEvent.click(screen.getByTestId("code-task-show-earlier-turns"));

    expect(
      await screen.findByTestId("code-task-show-earlier-turns-error"),
    ).toHaveTextContent("Task not found, or you do not have access to it.");
    expect(lineWords()).toBe("101 earlier turns are not shown");
    expect(drawnTurns()).toEqual([1, ...range(103, 205)]);

    getEarlierTurnsMock.mockImplementation((async (data: {
      before: string;
    }) => {
      return earlierThan(data.before);
    }) as never);
    await userEvent.click(screen.getByTestId("code-task-show-earlier-turns"));

    await waitFor(() => {
      expect(lineWords()).toBe("51 earlier turns are not shown");
    });
    expect(
      screen.queryByTestId("code-task-show-earlier-turns-error"),
    ).toBeNull();
  });

  test("coming back to the task keeps the earlier turns it drew, with nothing read again", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(103) as never);
    getEarlierTurnsMock.mockImplementation((async (data: {
      before: string;
    }) => {
      return earlierThan(data.before);
    }) as never);

    draw();
    await screen.findByTestId("code-task-turns-not-shown");
    await userEvent.click(screen.getByTestId("code-task-show-earlier-turns"));
    await waitFor(() => {
      expect(lineWords()).toBe("51 earlier turns are not shown");
    });

    cleanup();
    draw();

    await waitFor(() => {
      expect(lineWords()).toBe("51 earlier turns are not shown");
    });
    expect(drawnTurns()).toEqual([1, ...range(53, 205)]);
    expect(getEarlierTurnsMock).toHaveBeenCalledTimes(1);
  });

  test("a task shown whole has no line, and nothing to read", async () => {
    getTaskMock.mockResolvedValue({
      ...taskAnswer(103),
      turns: [turn(1), turn(2), turn(3)],
      turnsNotShown: undefined,
    } as never);

    draw();
    await screen.findByTestId("code-task-turns");

    expect(screen.queryByTestId("code-task-show-earlier-turns")).toBeNull();
    expect(getEarlierTurnsMock).not.toHaveBeenCalled();
  });

  test.each([
    ["de", "Frühere Durchgänge anzeigen"],
    ["fa", "نمایش نوبت‌های قبلی"],
    ["ar", "عرض الجولات السابقة"],
  ])(
    "in %s, the button reads in the page's language",
    async (language: string, words: string) => {
      await translation.changeLanguage(language);
      getTaskMock.mockResolvedValue(taskAnswer(103) as never);

      draw();

      expect(
        await screen.findByTestId("code-task-show-earlier-turns"),
      ).toHaveTextContent(words);
    },
  );
});

describe("the Log page's turn picker lists the earlier turns shown", () => {
  function listed(entries: Array<CodeTaskLogPickerEntry>): Array<string> {
    return entries.map((entry: CodeTaskLogPickerEntry): string => {
      return entry.kind === "turn"
        ? `Turn ${entry.turn.number}`
        : `${entry.count} not shown`;
    });
  }

  test("at their places, between the first turn and the newest", () => {
    expect(
      listed(
        getCodeTaskLogPickerEntries({
          turns: [turn(1), turn(103), turn(104)],
          turnsNotShown: 101,
          earlierTurns: numbered([101, 102]),
        }),
      ),
    ).toEqual([
      "Turn 1",
      "99 not shown",
      "Turn 101",
      "Turn 102",
      "Turn 103",
      "Turn 104",
    ]);
  });

  test("a turn both shown earlier and named by the address is listed once, the line split around the rest", () => {
    expect(
      listed(
        getCodeTaskLogPickerEntries({
          turns: [turn(1), turn(103)],
          turnsNotShown: 101,
          earlierTurns: numbered([50, 51]),
          linkedTurn: { number: 51, turn: turn(51) },
        }),
      ),
    ).toEqual([
      "Turn 1",
      "48 not shown",
      "Turn 50",
      "Turn 51",
      "51 not shown",
      "Turn 103",
    ]);
  });

  test("a turn named by the address and not shown earlier is listed at its place too", () => {
    expect(
      listed(
        getCodeTaskLogPickerEntries({
          turns: [turn(1), turn(103)],
          turnsNotShown: 101,
          earlierTurns: numbered([100, 101, 102]),
          linkedTurn: { number: 20, turn: turn(20) },
        }),
      ),
    ).toEqual([
      "Turn 1",
      "18 not shown",
      "Turn 20",
      "79 not shown",
      "Turn 100",
      "Turn 101",
      "Turn 102",
      "Turn 103",
    ]);
  });
});

describe("Jump to newest", () => {
  const WINDOW_HEIGHT: number = 800;
  let scrollTop: number = 0;
  // Where the newest turn's reply starts, in the window.
  let newestTop: number = 0;
  let pageHeight: number = 60000;
  let frames: Array<FrameRequestCallback> = [];

  beforeEach(() => {
    scrollTop = 0;
    newestTop = 40000;
    pageHeight = 60000;
    frames = [];

    Object.defineProperty(document.documentElement, "scrollTop", {
      configurable: true,
      get: (): number => {
        return scrollTop;
      },
      set: (value: number): void => {
        scrollTop = value;
      },
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      get: (): number => {
        return pageHeight;
      },
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      get: (): number => {
        return WINDOW_HEIGHT;
      },
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: WINDOW_HEIGHT,
    });

    const original: () => DOMRect = HTMLElement.prototype.getBoundingClientRect;

    jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement): DOMRect {
        if (this.getAttribute("data-testid") === "code-turn-reply") {
          const isNewest: boolean =
            this.parentElement?.lastElementChild === this;

          if (isNewest) {
            return { top: newestTop, height: 200 } as DOMRect;
          }
        }

        if (this.getAttribute("data-testid") === "code-task-footer") {
          return { top: WINDOW_HEIGHT - 150, height: 150 } as DOMRect;
        }

        return original.call(this);
      });

    jest.spyOn(window, "requestAnimationFrame").mockImplementation(((
      callback: FrameRequestCallback,
    ): number => {
      frames.push(callback);
      return frames.length;
    }) as never);
  });

  afterEach(() => {
    for (const key of ["scrollTop", "scrollHeight", "clientHeight"]) {
      Reflect.deleteProperty(document.documentElement, key);
    }
  });

  function nextFrame(): void {
    act(() => {
      for (const frame of frames.splice(0)) {
        frame(0);
      }
    });
  }

  test("out of view below what the reply box leaves: the newest turn is far off", () => {
    expect(
      isNewestOutOfView({
        newestTop: 651,
        windowHeight: 800,
        footerHeight: 150,
      }),
    ).toBe(true);
    expect(
      isNewestOutOfView({
        newestTop: 650,
        windowHeight: 800,
        footerHeight: 150,
      }),
    ).toBe(false);
    // Read into, or above the window: in view.
    expect(
      isNewestOutOfView({
        newestTop: -400,
        windowHeight: 800,
        footerHeight: 150,
      }),
    ).toBe(false);
    expect(
      isNewestOutOfView({
        newestTop: null,
        windowHeight: 800,
        footerHeight: 150,
      }),
    ).toBe(false);
  });

  // The task's newest turn at work: the page follows it to its end.
  function workingTaskAnswer(): Record<string, unknown> {
    const answer: Record<string, unknown> = taskAnswer(103);
    const turns: Array<CodeTaskTurnJSON> = answer[
      "turns"
    ] as Array<CodeTaskTurnJSON>;

    turns[turns.length - 1] = {
      ...turn(205),
      status: AIRunStatus.Running,
      state: CodeTaskState.Working,
      completedAt: undefined,
      outcome: undefined,
    };

    return {
      ...answer,
      task: { ...summary(), state: CodeTaskState.Working },
    };
  }

  test("a long task opens at its top, with the button to its newest turn - which takes the reader to that reply's first line, focus and all", async () => {
    getTaskMock.mockResolvedValue(taskAnswer(103) as never);

    draw();

    const button: HTMLElement = await screen.findByTestId(
      "code-task-jump-to-newest-button",
    );
    nextFrame();

    // Opening a task never moves the page.
    expect(scrollTop).toBe(0);
    expect(button).toHaveTextContent("Jump to newest");
    // Over the reply box, held at the bottom of the window.
    expect(screen.getByTestId("code-task-footer")).toContainElement(button);

    await userEvent.click(button);

    // Its turn is done: read from its reply's first line, never past it.
    expect(scrollTop).toBe(40000 - 24);
    // Its reply holds the focus: the reader reads on from there.
    expect(document.activeElement).toBe(
      screen.getByTestId("code-task-turns").lastElementChild,
    );
    expect(screen.queryByTestId("code-task-jump-to-newest-button")).toBeNull();
  });

  test("while AI works, it takes the reader to the end - even when the page grows after it, the second look", async () => {
    getTaskMock.mockResolvedValue(workingTaskAnswer() as never);
    getTurnProgressMock.mockReturnValue(new Promise(() => {}) as never);

    draw();
    await userEvent.click(
      await screen.findByTestId("code-task-jump-to-newest-button"),
    );
    expect(scrollTop).toBe(60000 - WINDOW_HEIGHT);

    // What lays out a moment after: the end moves down.
    pageHeight = 61100;
    nextFrame();

    expect(scrollTop).toBe(61100 - WINDOW_HEIGHT);
  });

  test("at the newest turn there is no button", async () => {
    newestTop = 300;
    getTaskMock.mockResolvedValue(taskAnswer(103) as never);

    draw();
    await screen.findByTestId("code-task-turns");
    nextFrame();

    expect(screen.queryByTestId("code-task-jump-to-newest-button")).toBeNull();
  });

  test("a reader who scrolls up is never pulled back: the button comes back, and the page stays", async () => {
    newestTop = 300;
    getTaskMock.mockResolvedValue(taskAnswer(103) as never);

    draw();
    await screen.findByTestId("code-task-turns");
    nextFrame();

    // Up to read: the newest is now far below.
    scrollTop = 2000;
    newestTop = 30000;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    nextFrame();

    expect(
      await screen.findByTestId("code-task-jump-to-newest-button"),
    ).toBeInTheDocument();
    expect(scrollTop).toBe(2000);
  });
});
