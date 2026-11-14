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
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskSummaryJSON,
  CodeTaskTurnJSON,
  CodeTaskTurnsNotShownJSON,
} from "../../../Types/AI/CodeTask";
import Route from "../../../Types/API/Route";
import Navigation from "../../../UI/Utils/Navigation";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import arabicLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ar.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A CODE TASK KEPT OPEN FOR WEEKS, ON ITS PAGE (issue #6529).
 *
 * The page is sent a long task's first turn and its newest, and how many
 * turns between them it does not show (CodeTaskResponse.turnsNotShown). It
 * draws the first turn - what the task is about - then one hairline that
 * says how many turns are not shown, then the newest; and the task at the
 * top still says how long AI worked on every turn, the ones not shown
 * included. In each language the Dashboard speaks.
 */

const getTaskMock: MockFunction = getJestMockFunction();
const getTurnProgressMock: MockFunction = getJestMockFunction();
const replyMock: MockFunction = getJestMockFunction();
const retryMock: MockFunction = getJestMockFunction();

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
        getTurnProgress: (...args: Array<unknown>) => {
          return getTurnProgressMock(...args);
        },
        reply: (...args: Array<unknown>) => {
          return replyMock(...args);
        },
        retry: (...args: Array<unknown>) => {
          return retryMock(...args);
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
import { CODE_TASK_TURNS_NOT_SHOWN_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskTurnsNotShown";
import { goToPageEnd } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/UseFollowLatest";

const TASK_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";
const REPOSITORY_ID: string = "6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e9f";

// Turn n's run id: the task's own for the first.
function runIdOf(n: number): string {
  return n === 1
    ? TASK_ID
    : `7d8e9f0a-1b2c-4d3e-8f4a-${n.toString(16).padStart(12, "0")}`;
}

// The marks a sentence sets a value apart with (FSI, LRI, RLI ... PDI).
const ISOLATE_MARKS: RegExp = new RegExp(
  `[${String.fromCharCode(0x2066)}-${String.fromCharCode(0x2069)}]`,
  "g",
);

// Persian's zero-width non-joiner, as in نمی‌شود.
const ZWNJ: string = String.fromCharCode(0x200c);

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
  getTurnProgressMock.mockReset();
  replyMock.mockReset();
  retryMock.mockReset();
  jest.spyOn(Navigation, "navigate").mockImplementation((() => {}) as never);
  goTo(`/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`);
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await translation.changeLanguage("en");
});

function summary(data: Partial<CodeTaskSummaryJSON> = {}): CodeTaskSummaryJSON {
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
    ...data,
  };
}

// Turn n: asked, then worked on by AI for a minute.
function turn(
  n: number,
  data: Partial<CodeTaskTurnJSON> = {},
): CodeTaskTurnJSON {
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
    ...data,
  };
}

function taskAnswer(data: {
  turns: Array<CodeTaskTurnJSON>;
  turnsNotShown?: CodeTaskTurnsNotShownJSON | undefined;
}): Record<string, unknown> {
  return {
    task: summary(),
    turns: data.turns,
    ...(data.turnsNotShown ? { turnsNotShown: data.turnsNotShown } : {}),
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

// Turn 1, then the newest: 203, 204 and 205 of a task of 205.
const NEWEST_OF_205: Array<CodeTaskTurnJSON> = [
  turn(1),
  turn(203),
  turn(204),
  turn(205),
];

function draw(): void {
  render(
    <I18nextProvider i18n={translation}>
      <CodeTaskConversation {...PAGE_PROPS} />
    </I18nextProvider>,
  );
}

// What a line says, without the marks that set its values apart.
function wordsOf(element: HTMLElement): string {
  return (element.textContent || "").replace(ISOLATE_MARKS, "");
}

async function drawLongTask(
  turnsNotShown: CodeTaskTurnsNotShownJSON,
  turns: Array<CodeTaskTurnJSON> = NEWEST_OF_205,
): Promise<HTMLElement> {
  getTaskMock.mockResolvedValue(taskAnswer({ turns, turnsNotShown }) as never);

  draw();

  return await screen.findByTestId("code-task-turns-not-shown");
}

describe("a long task's conversation", () => {
  test("its first turn, then how many turns are not shown, then its newest - one list, in that order", async () => {
    const gap: HTMLElement = await drawLongTask({
      count: 201,
      workMilliseconds: 201 * 60000,
    });

    expect(wordsOf(gap)).toBe("201 earlier turns are not shown");

    // An item of the conversation's own list, read in its place.
    const list: HTMLElement = screen.getByTestId("code-task-turns");
    expect(gap.parentElement).toBe(list);
    expect(gap.tagName).toBe("LI");

    const items: Array<Element> = Array.from(list.children);
    const asked: Array<string> = items.map((item: Element): string => {
      if (item === gap) {
        return "gap";
      }

      return item.getAttribute("data-testid") === "code-turn-request"
        ? (item.textContent || "").match(/Turn \d+/)?.[0] || "?"
        : "reply";
    });

    expect(asked).toEqual([
      "Turn 1",
      "reply",
      "gap",
      "Turn 203",
      "reply",
      "Turn 204",
      "reply",
      "Turn 205",
      "reply",
    ]);
  });

  test("the hairline is the shared one: two lines either side of the words, hidden from a screen reader", async () => {
    const gap: HTMLElement = await drawLongTask({
      count: 5,
      workMilliseconds: 0,
    });

    const lines: Array<HTMLElement> = within(gap).getAllByTestId(
      "code-task-turns-not-shown-divider-line",
    );
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toHaveAttribute("aria-hidden", "true");
    }
    expect(
      within(gap).getByText(/earlier turns are not shown/),
    ).toHaveAttribute("dir", "auto");
  });

  test("one turn not shown is said as one", async () => {
    const gap: HTMLElement = await drawLongTask({
      count: 1,
      workMilliseconds: 60000,
    });

    expect(wordsOf(gap)).toBe("1 earlier turn is not shown");
  });

  test("a count in the thousands is written the reader's way", async () => {
    const gap: HTMLElement = await drawLongTask({
      count: 1234,
      workMilliseconds: 0,
    });

    expect(wordsOf(gap)).toBe("1,234 earlier turns are not shown");
  });

  test("negative control: a task shown whole draws no hairline at all", async () => {
    getTaskMock.mockResolvedValue(
      taskAnswer({ turns: [turn(1), turn(2), turn(3)] }) as never,
    );

    draw();

    await screen.findByTestId("code-task-turns");
    expect(screen.getAllByTestId("code-turn-request")).toHaveLength(3);
    expect(screen.queryByTestId("code-task-turns-not-shown")).toBeNull();
  });

  test("how long AI worked counts the turns not shown with the ones shown", async () => {
    await drawLongTask({ count: 201, workMilliseconds: 6 * 60000 });

    // Four turns shown, a minute each, and six minutes on the ones not shown.
    expect(screen.getByTestId("code-task-work-time")).toHaveTextContent(
      "worked 10 minutes",
    );
  });

  test("negative control: without turns not shown, only the turns shown are counted", async () => {
    getTaskMock.mockResolvedValue(
      taskAnswer({ turns: NEWEST_OF_205 }) as never,
    );

    draw();

    expect(await screen.findByTestId("code-task-work-time")).toHaveTextContent(
      "worked 4 minutes",
    );
  });

  test("AI's work on the turns not shown is said even when no turn shown was started", async () => {
    await drawLongTask({ count: 201, workMilliseconds: 7 * 60000 }, [
      turn(1, {
        status: AIRunStatus.Error,
        state: CodeTaskState.Failed,
        startedAt: undefined,
        completedAt: undefined,
        errorMessage: "The Runner never took it",
      }),
      turn(203, {
        status: AIRunStatus.Error,
        state: CodeTaskState.Failed,
        startedAt: undefined,
        completedAt: undefined,
        errorMessage: "The Runner never took it",
      }),
    ]);

    expect(screen.getByTestId("code-task-work-time")).toHaveTextContent(
      "worked 7 minutes",
    );
  });
});

/*
 * The reply box is held at the bottom of the window, so a reply can be sent
 * from anywhere on the page - from a long task's first turn, where it
 * opens. The page used to scroll the box into view after a reply, which it
 * always is, so nothing moved: in a browser, a reply sent from the top of a
 * task of 207 turns was drawn some 67,000 pixels below (Code.spec.ts). The
 * page now goes to its end once the reply is drawn there.
 */
describe("a reply sent from far up a long task", () => {
  const WINDOW_HEIGHT: number = 800;
  let scrollTop: number = 0;
  /*
   * What lays out after a commit, before the next frame: in a browser, the
   * styles the page's Tailwind writes for elements it has not drawn before,
   * or replies' Markdown drawn with the reply.
   */
  let laidOutLater: number = 0;

  /*
   * The page's height as drawn: 100 pixels for each turn up to the newest
   * one drawn, so it grows when the reply's turn is drawn.
   */
  function drawnHeight(): number {
    const requests: Array<Element> = Array.from(
      document.querySelectorAll("[data-testid='code-turn-request']"),
    );
    const newest: number = Number(
      (requests[requests.length - 1]?.textContent || "").match(
        /Turn (\d+)/,
      )?.[1] || 0,
    );

    return newest * 100 + 400 + laidOutLater;
  }

  beforeEach(() => {
    scrollTop = 0;
    laidOutLater = 0;
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
      get: drawnHeight,
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      get: (): number => {
        return WINDOW_HEIGHT;
      },
    });
  });

  afterEach(() => {
    for (const key of ["scrollTop", "scrollHeight", "clientHeight"]) {
      Reflect.deleteProperty(document.documentElement, key);
    }
  });

  // Turn 206 asked: turn 203 is not shown any more.
  const NEWEST_OF_206: Array<CodeTaskTurnJSON> = [
    turn(1),
    turn(204),
    turn(205),
    turn(206),
  ];

  async function sendReply(): Promise<void> {
    await userEvent.type(
      screen.getByTestId("code-composer-input"),
      "Keep going{Enter}",
    );
  }

  // Try again finishes after the read it waits for: its last update.
  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  test("the page goes to its end once the reply is drawn there - not before", async () => {
    await drawLongTask({ count: 201, workMilliseconds: 0 });
    // A task opens where it starts: at its first turn.
    expect(scrollTop).toBe(0);

    replyMock.mockResolvedValue(undefined as never);
    getTaskMock.mockResolvedValue(
      taskAnswer({
        turns: NEWEST_OF_206,
        turnsNotShown: { count: 202, workMilliseconds: 0 },
      }) as never,
    );

    await sendReply();

    expect(replyMock).toHaveBeenCalledWith({
      taskId: TASK_ID,
      message: "Keep going",
      context: [],
    });
    await waitFor(() => {
      expect(wordsOf(screen.getByTestId("code-task-turns-not-shown"))).toBe(
        "202 earlier turns are not shown",
      );
    });
    // The end of the page with turn 206 drawn (20,200), not of the page before it (20,100).
    expect(scrollTop).toBe(206 * 100 + 400 - WINDOW_HEIGHT);
  });

  /*
   * In a browser, a reply sent as a long task opened was drawn some 1,100
   * pixels under the window: the replies' Markdown came in with it, and
   * its styles after the page had gone to its end. The page looks at its
   * end once more on the next frame.
   */
  test("what lays out after the reply is drawn still ends in view: the page goes to its end again on the next frame", async () => {
    const frames: Array<FrameRequestCallback> = [];

    jest.spyOn(window, "requestAnimationFrame").mockImplementation(((
      callback: FrameRequestCallback,
    ): number => {
      frames.push(callback);
      return frames.length;
    }) as never);

    await drawLongTask({ count: 201, workMilliseconds: 0 });
    replyMock.mockResolvedValue(undefined as never);
    getTaskMock.mockResolvedValue(
      taskAnswer({
        turns: NEWEST_OF_206,
        turnsNotShown: { count: 202, workMilliseconds: 0 },
      }) as never,
    );

    await sendReply();
    await waitFor(() => {
      expect(scrollTop).toBe(206 * 100 + 400 - WINDOW_HEIGHT);
    });

    // Laid out after the commit: the end moves 1,100 pixels down.
    laidOutLater = 1100;
    expect(scrollTop).toBe(206 * 100 + 400 - WINDOW_HEIGHT);

    // The next frame.
    act(() => {
      for (const frame of frames.splice(0)) {
        frame(0);
      }
    });

    expect(scrollTop).toBe(206 * 100 + 400 + 1100 - WINDOW_HEIGHT);
  });

  test("negative control: a reply the server refuses leaves the reader where they are - then and at the next read", async () => {
    // The newest turn failed: Try again is offered beside the reply box.
    await drawLongTask({ count: 201, workMilliseconds: 0 }, [
      ...NEWEST_OF_205.slice(0, 3),
      turn(205, {
        status: AIRunStatus.Error,
        state: CodeTaskState.Failed,
        errorMessage: "The Runner could not clone the repository.",
      }),
    ]);
    replyMock.mockRejectedValue(
      new Error("This project used its daily AI token limit.") as never,
    );

    await sendReply();

    await waitFor(() => {
      expect(replyMock).toHaveBeenCalledTimes(1);
    });
    expect(getTaskMock).toHaveBeenCalledTimes(1);
    expect(scrollTop).toBe(0);

    // The page read again (Try again): no reply was drawn, so it stays put.
    retryMock.mockResolvedValue(undefined as never);
    getTaskMock.mockResolvedValue(
      taskAnswer({
        turns: NEWEST_OF_205,
        turnsNotShown: { count: 201, workMilliseconds: 0 },
      }) as never,
    );

    await userEvent.click(screen.getByTestId("code-turn-retry"));

    await waitFor(() => {
      expect(screen.queryByTestId("code-turn-retry")).toBeNull();
    });
    await settle();
    expect(getTaskMock).toHaveBeenCalledTimes(2);
    expect(scrollTop).toBe(0);
  });

  test("the page goes there once: a later read leaves the reader where they scrolled to", async () => {
    await drawLongTask({ count: 201, workMilliseconds: 0 });
    replyMock.mockResolvedValue(undefined as never);
    // The reply's turn failed at once, so Try again is offered on it.
    getTaskMock.mockResolvedValue(
      taskAnswer({
        turns: [
          ...NEWEST_OF_206.slice(0, 3),
          turn(206, {
            status: AIRunStatus.Error,
            state: CodeTaskState.Failed,
            errorMessage: "The Runner could not clone the repository.",
          }),
        ],
        turnsNotShown: { count: 202, workMilliseconds: 0 },
      }) as never,
    );

    await sendReply();
    await waitFor(() => {
      expect(scrollTop).toBe(206 * 100 + 400 - WINDOW_HEIGHT);
    });

    // The reader goes back up to the first turn, then tries the turn again.
    scrollTop = 0;
    window.dispatchEvent(new Event("scroll"));
    retryMock.mockResolvedValue(undefined as never);
    getTaskMock.mockResolvedValue(
      taskAnswer({
        turns: NEWEST_OF_206,
        turnsNotShown: { count: 202, workMilliseconds: 0 },
      }) as never,
    );

    await userEvent.click(screen.getByTestId("code-turn-retry"));

    await waitFor(() => {
      expect(screen.queryByTestId("code-turn-retry")).toBeNull();
    });
    await settle();
    expect(getTaskMock).toHaveBeenCalledTimes(3);
    expect(scrollTop).toBe(0);
  });
});

/*
 * goToPageEnd: the page to its end now, and once more on the next frame,
 * unless what asked for it is gone by then.
 */
describe("going to the end of the page", () => {
  let scrollTop: number = 0;
  let scrollHeight: number = 5000;

  beforeEach(() => {
    scrollTop = 0;
    scrollHeight = 5000;
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
        return scrollHeight;
      },
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      get: (): number => {
        return 800;
      },
    });
  });

  afterEach(() => {
    for (const key of ["scrollTop", "scrollHeight", "clientHeight"]) {
      Reflect.deleteProperty(document.documentElement, key);
    }
  });

  function holdFrames(): Array<FrameRequestCallback> {
    const frames: Array<FrameRequestCallback> = [];

    jest.spyOn(window, "requestAnimationFrame").mockImplementation(((
      callback: FrameRequestCallback,
    ): number => {
      frames.push(callback);
      return frames.length;
    }) as never);

    return frames;
  }

  test("goes there at once, and again on the next frame, to the end as it is then", () => {
    const frames: Array<FrameRequestCallback> = holdFrames();

    goToPageEnd();
    expect(scrollTop).toBe(4200);
    expect(frames).toHaveLength(1);

    scrollHeight = 6100;
    frames[0]!(0);

    expect(scrollTop).toBe(5300);
  });

  test("negative control: a reader who went back up before the next frame is left there", () => {
    const frames: Array<FrameRequestCallback> = holdFrames();

    goToPageEnd();
    expect(scrollTop).toBe(4200);

    scrollHeight = 6100;
    scrollTop = 1000;
    frames[0]!(0);

    expect(scrollTop).toBe(1000);
  });

  test("negative control: what it returns cancels the second look", () => {
    const frames: Array<FrameRequestCallback> = holdFrames();
    const cancelSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((() => {}) as never);

    const cancel: () => void = goToPageEnd();
    cancel();

    expect(cancelSpy).toHaveBeenCalledWith(1);
    expect(frames).toHaveLength(1);
  });

  test("a page shorter than its window stays at its top", () => {
    holdFrames();
    scrollHeight = 600;

    goToPageEnd();

    expect(scrollTop).toBe(0);
  });
});

describe("the turns not shown, in the reader's language", () => {
  test("German", async () => {
    await translation.changeLanguage("de");

    const gap: HTMLElement = await drawLongTask({
      count: 1234,
      workMilliseconds: 0,
    });

    expect(wordsOf(gap)).toBe(
      "1.234 frühere Durchgänge werden nicht angezeigt",
    );
  });

  test("German, one", async () => {
    await translation.changeLanguage("de");

    const gap: HTMLElement = await drawLongTask({
      count: 1,
      workMilliseconds: 0,
    });

    expect(wordsOf(gap)).toBe("1 früherer Durchgang wird nicht angezeigt");
  });

  test("Arabic: the words, then the count - right for any count - in Latin digits", async () => {
    await translation.changeLanguage("ar");

    const gap: HTMLElement = await drawLongTask({
      count: 5,
      workMilliseconds: 0,
    });

    expect(wordsOf(gap)).toBe("جولات سابقة غير معروضة: 5");
  });

  test("Arabic, one", async () => {
    await translation.changeLanguage("ar");

    const gap: HTMLElement = await drawLongTask({
      count: 1,
      workMilliseconds: 0,
    });

    expect(wordsOf(gap)).toBe("1 جولة سابقة غير معروضة");
  });

  test("Persian, in Persian digits", async () => {
    await translation.changeLanguage("fa");

    const gap: HTMLElement = await drawLongTask({
      count: 5,
      workMilliseconds: 0,
    });

    expect(wordsOf(gap)).toBe(`۵ نوبت قبلی نمایش داده نمی${ZWNJ}شود`);
  });

  test("the words are the component's own plural, in English", () => {
    expect(CODE_TASK_TURNS_NOT_SHOWN_COPY).toEqual({
      one: "{{count}} earlier turn is not shown",
      other: "{{count}} earlier turns are not shown",
    });
  });
});
