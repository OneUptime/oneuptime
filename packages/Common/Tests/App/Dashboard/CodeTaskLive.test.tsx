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
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskStepJSON,
  CodeTaskStepKind,
  CodeTaskSummaryJSON,
  CodeTaskTurnJSON,
  CodeTaskTurnProgressJSON,
} from "../../../Types/AI/CodeTask";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelEventType from "../../../Types/Realtime/ModelEventType";
import API from "../../../UI/Utils/API/API";
import type { Mock, SpyInstance } from "jest-mock";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A TURN'S STEPS REACH THE PAGE AS THEY HAPPEN (Components/Code/CodeTaskLive,
 * UseCodeTaskLive, UseFollowLatest, Pages/Code/Task/Conversation).
 *
 * The server announces every change of a task's turns in the task's own
 * room; the conversation hears it on the live connection the Dashboard
 * keeps open and reads the working turn's new steps at once - only those,
 * never the whole task, until the turn is done. It also reads on its own
 * while AI works: every three seconds until an announcement is heard,
 * every fifteen while they come. A reader at the end of the page keeps the
 * newest step in view.
 */

const getTaskMock: MockFunction = getJestMockFunction();
const getTurnProgressMock: MockFunction = getJestMockFunction();
const stopMock: MockFunction = getJestMockFunction();

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
        stop: (...args: Array<unknown>) => {
          return stopMock(...args);
        },
      },
    };
  },
);

// The live connection: whether the Dashboard opened it, and who listens.
interface Subscription {
  request: {
    modelType: { new (): unknown };
    eventType: ModelEventType;
    tenantId: ObjectID;
    modelId?: ObjectID | undefined;
  };
  onEvent: (modelId: ObjectID) => void;
  isStopped: boolean;
}

const mockLive: { isStarted: boolean; subscriptions: Array<Subscription> } = {
  isStarted: true,
  subscriptions: [],
};

jest.mock("../../../UI/Utils/Realtime", () => {
  return {
    __esModule: true,
    default: {
      isStarted: (): boolean => {
        return mockLive.isStarted;
      },
      listenToModelEvent: (
        request: Subscription["request"],
        onEvent: Subscription["onEvent"],
      ): (() => void) => {
        const subscription: Subscription = {
          request,
          onEvent,
          isStopped: false,
        };

        mockLive.subscriptions.push(subscription);

        return (): void => {
          subscription.isStopped = true;
        };
      },
    },
  };
});

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
import CodeTaskLog, {
  CODE_TASK_LOG_LIVE_MIN_INTERVAL_MS,
  CODE_TASK_LOG_POLL_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Task/Log";
import {
  CODE_TASK_LOG_TASK_RECORD_COPY,
  CODE_TASK_LOG_TURN_RECORD_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskLogTurns";
import {
  CODE_TASK_LIVE_HEARD_WITHIN_MS,
  CODE_TASK_LIVE_MIN_INTERVAL_MS,
  CODE_TASK_LIVE_POLL_MS,
  CODE_TASK_POLL_MS,
  getCodeTaskPollInterval,
  getConversationGrowthKey,
  getLastStepSequence,
  getLiveTurn,
  MAX_LIVE_STEPS_PER_TURN,
  mergeTurnProgress,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskLive";
import useCodeTaskLive, {
  UseCodeTaskLiveOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/UseCodeTaskLive";
import useFollowLatest, {
  FOLLOW_LATEST_SLACK_PX,
  FOLLOW_LATEST_START_GAP_PX,
  getFollowTarget,
  isScrolledToEnd,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/UseFollowLatest";
import { CodeTaskResponse } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";

const REPOSITORY_ID: string = "6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e9f";
const TASK_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";
const REPLY_ID: string = "8e9f0a1b-2c3d-4e4f-9a5b-6c7d8e9f0a1b";

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

function step(
  sequence: number,
  kind: CodeTaskStepKind,
  subject: string,
): CodeTaskStepJSON {
  return { sequence, kind, subject, isError: false };
}

function summary(data: Partial<CodeTaskSummaryJSON> = {}): CodeTaskSummaryJSON {
  return {
    id: TASK_ID,
    taskNumber: 12,
    title: "Retry charges when the gateway times out",
    recipe: CodeFixTaskType.CodeRequest,
    state: CodeTaskState.Working,
    isQueued: false,
    createdAt: "2026-11-03T10:00:00.000Z",
    lastActivityAt: "2026-11-03T10:00:30.000Z",
    origin: { type: CodeTaskOriginType.Request, label: "Ada Lovelace" },
    turnCount: 1,
    codeRepositoryId: REPOSITORY_ID,
    ...data,
  };
}

function turn(data: Partial<CodeTaskTurnJSON> = {}): CodeTaskTurnJSON {
  return {
    runId: TASK_ID,
    recipe: CodeFixTaskType.CodeRequest,
    status: AIRunStatus.Running,
    state: CodeTaskState.Working,
    createdAt: "2026-11-03T10:00:00.000Z",
    startedAt: "2026-11-03T10:00:10.000Z",
    requestedBy: { id: "ada", name: "Ada Lovelace" },
    request: {
      message: "Retry charges when the gateway times out",
      context: [],
    },
    steps: [
      step(0, CodeTaskStepKind.Listed, "src"),
      step(1, CodeTaskStepKind.Read, "src/payments/client.ts"),
    ],
    pullRequests: [],
    needsInput: false,
    ...data,
  };
}

function working(data: Partial<CodeTaskResponse> = {}): CodeTaskResponse {
  return {
    task: summary(),
    turns: [turn()],
    repository: {
      id: REPOSITORY_ID,
      name: "checkout-api",
      organizationName: "acme",
      repositoryName: "checkout-api",
      mainBranchName: "main",
      isConnected: true,
    },
    canAsk: true,
    canSeeChanges: true,
    canReadLogContent: true,
    blocker: null,
    ...data,
  };
}

function done(): CodeTaskResponse {
  return working({
    task: summary({ state: CodeTaskState.Done }),
    turns: [
      turn({
        status: AIRunStatus.Completed,
        state: CodeTaskState.Done,
        completedAt: "2026-11-03T10:05:00.000Z",
        outcome: {
          summary: "Charges now retry twice when the gateway times out.",
          filesChanged: [],
        },
      }),
    ],
  });
}

function progress(
  data: Partial<CodeTaskTurnProgressJSON> = {},
): CodeTaskTurnProgressJSON {
  return {
    runId: TASK_ID,
    status: AIRunStatus.Running,
    state: CodeTaskState.Working,
    isQueued: false,
    startedAt: "2026-11-03T10:00:10.000Z",
    steps: [],
    hasMore: false,
    ...data,
  };
}

function draw(element: ReactElement): void {
  render(<I18nextProvider i18n={translation}>{element}</I18nextProvider>);
}

// The live connection's subscriptions still held.
function heldSubscriptions(): Array<Subscription> {
  return mockLive.subscriptions.filter((subscription: Subscription) => {
    return !subscription.isStopped;
  });
}

// The server announces a change of the run whose room was joined.
function announce(): void {
  for (const subscription of heldSubscriptions()) {
    subscription.onEvent(subscription.request.modelId!);
  }
}

function stepSubjects(): Array<string> {
  return screen
    .queryAllByTestId("code-task-step")
    .map((element: HTMLElement) => {
      return element.textContent || "";
    });
}

let visibility: DocumentVisibilityState = "visible";

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: (): DocumentVisibilityState => {
      return visibility;
    },
  });
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: englishLocale } },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  getTaskMock.mockReset();
  getTurnProgressMock.mockReset();
  stopMock.mockReset();
  mockLive.isStarted = true;
  mockLive.subscriptions = [];
  visibility = "visible";
  goTo(`/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the page's own pace while AI works (getCodeTaskPollInterval)", () => {
  test("every three seconds until an announcement is heard", () => {
    expect(CODE_TASK_POLL_MS).toBe(3000);
    expect(getCodeTaskPollInterval({ lastHeardAt: null, now: 1_000_000 })).toBe(
      CODE_TASK_POLL_MS,
    );
  });

  test("every fifteen while they come - a safety net for one that is missed", () => {
    expect(CODE_TASK_LIVE_POLL_MS).toBe(15000);
    expect(
      getCodeTaskPollInterval({ lastHeardAt: 1_000_000, now: 1_000_000 }),
    ).toBe(CODE_TASK_LIVE_POLL_MS);
    expect(
      getCodeTaskPollInterval({
        lastHeardAt: 1_000_000,
        now: 1_000_000 + CODE_TASK_LIVE_HEARD_WITHIN_MS,
      }),
    ).toBe(CODE_TASK_LIVE_POLL_MS);
  });

  test("every three again once none was heard for a minute (a long command, a dropped connection)", () => {
    expect(CODE_TASK_LIVE_HEARD_WITHIN_MS).toBe(60000);
    expect(
      getCodeTaskPollInterval({
        lastHeardAt: 1_000_000,
        now: 1_000_000 + CODE_TASK_LIVE_HEARD_WITHIN_MS + 1,
      }),
    ).toBe(CODE_TASK_POLL_MS);
  });

  test("a clock that went back counts as nothing heard", () => {
    expect(
      getCodeTaskPollInterval({ lastHeardAt: 2_000_000, now: 1_000_000 }),
    ).toBe(CODE_TASK_POLL_MS);
  });

  test("a page may set its own paces", () => {
    expect(
      getCodeTaskPollInterval({
        lastHeardAt: null,
        now: 0,
        pollMs: 5000,
        livePollMs: 20000,
      }),
    ).toBe(5000);
    expect(
      getCodeTaskPollInterval({
        lastHeardAt: 0,
        now: 10,
        pollMs: 5000,
        livePollMs: 20000,
      }),
    ).toBe(20000);
  });
});

describe("which turn a read brings, and how far the page has it", () => {
  test("the task's latest turn, while AI works on it", () => {
    const reply: CodeTaskTurnJSON = turn({ runId: REPLY_ID });

    expect(
      getLiveTurn({
        recipe: CodeFixTaskType.CodeRequest,
        turns: [
          turn({ status: AIRunStatus.Completed, state: CodeTaskState.Done }),
          reply,
        ],
      }),
    ).toBe(reply);
  });

  test("none once it is done, and none for a production review, which is read whole", () => {
    expect(
      getLiveTurn({
        recipe: CodeFixTaskType.CodeRequest,
        turns: [turn({ state: CodeTaskState.Done })],
      }),
    ).toBeNull();
    expect(
      getLiveTurn({
        recipe: CodeFixTaskType.GitHubPullRequestProductionReview,
        turns: [turn()],
      }),
    ).toBeNull();
    expect(
      getLiveTurn({ recipe: CodeFixTaskType.CodeRequest, turns: [] }),
    ).toBeNull();
  });

  test("the last step the turn shows, -1 for none - whatever order they came in", () => {
    expect(getLastStepSequence(turn({ steps: [] }))).toBe(-1);
    expect(
      getLastStepSequence(
        turn({
          steps: [
            step(9, CodeTaskStepKind.Read, "b.ts"),
            step(4, CodeTaskStepKind.Read, "a.ts"),
          ],
        }),
      ),
    ).toBe(9);
  });
});

describe("what a read of the working turn changes (mergeTurnProgress)", () => {
  test("appends the steps the page did not have, in order, and nothing twice", () => {
    const merged: CodeTaskResponse | null = mergeTurnProgress(
      working(),
      progress({
        steps: [
          // Already shown: a read that overlapped another.
          step(1, CodeTaskStepKind.Read, "src/payments/client.ts"),
          step(2, CodeTaskStepKind.Searched, "timeout"),
          step(3, CodeTaskStepKind.Edited, "src/payments/client.ts"),
        ],
      }),
    );

    expect(
      merged?.turns[0]?.steps.map((item: CodeTaskStepJSON) => {
        return item.sequence;
      }),
    ).toEqual([0, 1, 2, 3]);
  });

  test("a turn a Runner just picked up stops being queued, from when it started", () => {
    const queued: CodeTaskResponse = working({
      task: summary({ isQueued: true }),
      turns: [
        turn({ status: AIRunStatus.Queued, startedAt: undefined, steps: [] }),
      ],
    });

    const merged: CodeTaskResponse | null = mergeTurnProgress(
      queued,
      progress({ startedAt: "2026-11-03T10:00:40.000Z" }),
    );

    expect(merged?.task.isQueued).toBe(false);
    expect(merged?.turns[0]?.status).toBe(AIRunStatus.Running);
    expect(merged?.turns[0]?.startedAt).toBe("2026-11-03T10:00:40.000Z");
  });

  test("a read that brought nothing new changes nothing: the same page, not a copy", () => {
    const data: CodeTaskResponse = working();

    expect(mergeTurnProgress(data, progress())).toBe(data);
    expect(
      mergeTurnProgress(
        data,
        progress({
          steps: [step(1, CodeTaskStepKind.Read, "src/payments/client.ts")],
        }),
      ),
    ).toBe(data);
  });

  test("the whole task is read instead once the turn is done, when more steps came than one read sends, or for another turn", () => {
    expect(
      mergeTurnProgress(
        working(),
        progress({ state: CodeTaskState.Done, status: AIRunStatus.Completed }),
      ),
    ).toBeNull();
    expect(
      mergeTurnProgress(working(), progress({ hasMore: true })),
    ).toBeNull();
    expect(
      mergeTurnProgress(working(), progress({ runId: REPLY_ID })),
    ).toBeNull();
    // The page has moved on: its latest turn is done already.
    expect(mergeTurnProgress(done(), progress())).toBeNull();
  });

  test("a turn keeps its newest steps, as many as the server sends at most", () => {
    const many: Array<CodeTaskStepJSON> = Array.from(
      { length: MAX_LIVE_STEPS_PER_TURN },
      (_value: unknown, index: number): CodeTaskStepJSON => {
        return step(index, CodeTaskStepKind.Read, `src/${index}.ts`);
      },
    );

    const merged: CodeTaskResponse | null = mergeTurnProgress(
      working({ turns: [turn({ steps: many })] }),
      progress({
        steps: [
          step(MAX_LIVE_STEPS_PER_TURN, CodeTaskStepKind.Ran, "npm test"),
        ],
      }),
    );

    const steps: Array<CodeTaskStepJSON> = merged!.turns[0]!.steps;

    expect(steps).toHaveLength(MAX_LIVE_STEPS_PER_TURN);
    expect(steps[0]?.sequence).toBe(1);
    expect(steps[steps.length - 1]?.subject).toBe("npm test");
  });

  test("the conversation's growth is told by its latest turn: a step, a turn, a state, a reply", () => {
    const keys: Set<string> = new Set<string>([
      getConversationGrowthKey(working().turns),
      getConversationGrowthKey(
        working({
          turns: [
            turn({
              steps: [...turn().steps, step(2, CodeTaskStepKind.Ran, "x")],
            }),
          ],
        }).turns,
      ),
      getConversationGrowthKey(done().turns),
      getConversationGrowthKey([...done().turns, turn({ runId: REPLY_ID })]),
    ]);

    expect(keys.size).toBe(4);
    expect(getConversationGrowthKey([])).toBe("");
    expect(getConversationGrowthKey(working().turns)).toBe(
      getConversationGrowthKey(working().turns),
    );
  });
});

describe("a task's conversation while AI works", () => {
  test("listens on the live connection to its task's own room, which hears every turn of it", async () => {
    getTaskMock.mockResolvedValue(working() as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);
    await screen.findByTestId("code-task-header");

    expect(heldSubscriptions()).toHaveLength(1);
    const request: Subscription["request"] = heldSubscriptions()[0]!.request;
    expect(request.modelType).toBe(AIRun);
    expect(request.eventType).toBe(ModelEventType.Update);
    expect(request.tenantId.toString()).toBe(PROJECT_ID);
    expect(request.modelId?.toString()).toBe(TASK_ID);
  });

  /*
   * The UI review: a reader who hears the page rather than sees it is told
   * what the others watch come in - each step, and the reply - as Ask AI's
   * conversation tells it.
   */
  test("is a log a screen reader follows: each step as it arrives, and the reply", async () => {
    getTaskMock.mockResolvedValue(working() as never);
    getTurnProgressMock.mockResolvedValue(
      progress({
        steps: [step(2, CodeTaskStepKind.Ran, "npm test")],
      }) as never,
    );

    draw(<CodeTaskConversation {...PAGE_PROPS} />);
    await screen.findByTestId("code-task-header");

    const log: HTMLElement = screen.getByRole("log", { name: "Conversation" });
    expect(log).toBe(screen.getByTestId("code-task-turns"));
    expect(log).toHaveAttribute("aria-live", "polite");
    // What is added is said; a step folded away out of the six is not.
    expect(log).toHaveAttribute("aria-relevant", "additions");

    await act(async () => {
      announce();
    });

    await waitFor(() => {
      expect(stepSubjects()).toHaveLength(3);
    });
    expect(log).toContainElement(
      screen.getAllByTestId("code-task-step")[2] as HTMLElement,
    );
  });

  test("the task's title is someone's words, read the way they are written", async () => {
    getTaskMock.mockResolvedValue(working() as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    const title: HTMLElement = await screen.findByTestId("code-task-title");
    const isolate: Element | null = title.querySelector("bdi");
    expect(isolate).not.toBeNull();
    expect(isolate).toHaveTextContent(
      "Retry charges when the gateway times out",
    );
    expect(isolate).toHaveAttribute("dir", "ltr");
  });

  test("an old link to one of its replies listens to the task's room, which hears every turn", async () => {
    goTo(`/dashboard/${PROJECT_ID}/code/tasks/${REPLY_ID}`);
    getTaskMock.mockResolvedValue(working() as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);
    await screen.findByTestId("code-task-header");

    await waitFor(() => {
      expect(heldSubscriptions()).toHaveLength(1);
      expect(heldSubscriptions()[0]!.request.modelId?.toString()).toBe(TASK_ID);
    });
  });

  test("an announced step shows at once - read as the turn's new steps, never the whole task again", async () => {
    getTaskMock.mockResolvedValue(working() as never);
    getTurnProgressMock.mockResolvedValue(
      progress({
        steps: [step(2, CodeTaskStepKind.Ran, "npm test")],
      }) as never,
    );

    draw(<CodeTaskConversation {...PAGE_PROPS} />);
    await screen.findByTestId("code-task-header");
    expect(stepSubjects()).toHaveLength(2);

    await act(async () => {
      announce();
    });

    await waitFor(() => {
      expect(stepSubjects()).toHaveLength(3);
    });
    expect(stepSubjects()[2]).toBe("Ran npm test");
    expect(getTurnProgressMock).toHaveBeenCalledWith({
      taskId: TASK_ID,
      runId: TASK_ID,
      afterSequence: 1,
    });
    expect(getTaskMock).toHaveBeenCalledTimes(1);
    // Still working: the next step will show where it says so.
    expect(screen.getByTestId("code-task-steps-working")).toBeInTheDocument();
  });

  test("a reply's turn is read as its own run, from its last step", async () => {
    getTaskMock.mockResolvedValue(
      working({
        task: summary({ turnCount: 2 }),
        turns: [
          turn({
            status: AIRunStatus.Completed,
            state: CodeTaskState.Done,
            outcome: { summary: "Done.", filesChanged: [] },
          }),
          turn({
            runId: REPLY_ID,
            steps: [step(7, CodeTaskStepKind.Read, "README.md")],
          }),
        ],
      }) as never,
    );
    getTurnProgressMock.mockResolvedValue(
      progress({ runId: REPLY_ID }) as never,
    );

    draw(<CodeTaskConversation {...PAGE_PROPS} />);
    await screen.findByTestId("code-task-header");

    await act(async () => {
      announce();
    });

    await waitFor(() => {
      expect(getTurnProgressMock).toHaveBeenCalledWith({
        taskId: TASK_ID,
        runId: REPLY_ID,
        afterSequence: 7,
      });
    });
  });

  test("a turn that ends is read whole: its reply shows, and the page stops reading on its own", async () => {
    jest.useFakeTimers();
    getTaskMock
      .mockResolvedValueOnce(working() as never)
      .mockResolvedValue(done() as never);
    getTurnProgressMock.mockResolvedValue(
      progress({
        state: CodeTaskState.Done,
        status: AIRunStatus.Completed,
      }) as never,
    );

    draw(<CodeTaskConversation {...PAGE_PROPS} />);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      announce();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      jest.advanceTimersByTime(10);
      await Promise.resolve();
    });

    expect(getTaskMock).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText(
        "Charges now retry twice when the gateway times out.",
      ),
    ).toBeInTheDocument();

    // Done: nothing more is read, however long the page stays open.
    getTurnProgressMock.mockClear();
    await act(async () => {
      jest.advanceTimersByTime(CODE_TASK_LIVE_POLL_MS * 4);
      await Promise.resolve();
    });
    expect(getTurnProgressMock).not.toHaveBeenCalled();
    expect(getTaskMock).toHaveBeenCalledTimes(2);
  });

  test("hearing nothing, it reads the turn's new steps every three seconds", async () => {
    jest.useFakeTimers();
    getTaskMock.mockResolvedValue(working() as never);
    getTurnProgressMock.mockResolvedValue(progress() as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      jest.advanceTimersByTime(CODE_TASK_POLL_MS - 1);
      await Promise.resolve();
    });
    expect(getTurnProgressMock).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(getTurnProgressMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(CODE_TASK_POLL_MS);
      await Promise.resolve();
    });
    expect(getTurnProgressMock).toHaveBeenCalledTimes(2);
    // Only the working turn's steps, never the whole task.
    expect(getTaskMock).toHaveBeenCalledTimes(1);
  });

  test("an announcement in a burst of them is read once - and the last of them still is", async () => {
    jest.useFakeTimers();
    getTaskMock.mockResolvedValue(working() as never);
    getTurnProgressMock.mockResolvedValue(progress() as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      for (let index: number = 0; index < 10; index++) {
        announce();
      }
      await Promise.resolve();
    });

    // The first at once; the rest of the burst in one more read.
    expect(getTurnProgressMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(CODE_TASK_LIVE_MIN_INTERVAL_MS);
      await Promise.resolve();
    });

    expect(getTurnProgressMock).toHaveBeenCalledTimes(2);
  });

  test("a read that failed keeps the page as it is", async () => {
    getTaskMock.mockResolvedValue(working() as never);
    // An async function's own promise: rejected only once it is awaited.
    getTurnProgressMock.mockImplementation((async (): Promise<never> => {
      throw new Error("offline");
    }) as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);
    await screen.findByTestId("code-task-header");

    await act(async () => {
      announce();
    });

    await waitFor(() => {
      expect(getTurnProgressMock).toHaveBeenCalledTimes(1);
    });
    expect(stepSubjects()).toHaveLength(2);
    expect(screen.getByTestId("code-task-working-footer")).toBeInTheDocument();
  });

  test("a read of steps that arrives after the task was read again is dropped: a stopped turn stays stopped", async () => {
    let answerProgress: (
      value: CodeTaskTurnProgressJSON,
    ) => void = (): void => {};

    getTaskMock.mockResolvedValueOnce(working() as never).mockResolvedValue(
      working({
        task: summary({ state: CodeTaskState.Stopped }),
        turns: [
          turn({
            status: AIRunStatus.Cancelled,
            state: CodeTaskState.Stopped,
            errorMessage: "Stopped by Ada Lovelace.",
          }),
        ],
      }) as never,
    );
    getTurnProgressMock.mockImplementation((() => {
      return new Promise<CodeTaskTurnProgressJSON>(
        (resolve: (value: CodeTaskTurnProgressJSON) => void) => {
          answerProgress = resolve;
        },
      );
    }) as never);
    stopMock.mockResolvedValue(undefined as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);
    await screen.findByTestId("code-task-header");

    // A step is announced, and its read is on its way...
    await act(async () => {
      announce();
    });
    expect(getTurnProgressMock).toHaveBeenCalledTimes(1);

    // ...when the reader stops the turn, and the task is read again.
    await act(async () => {
      await userEvent.click(screen.getByTestId("code-task-stop"));
    });
    expect(await screen.findByTestId("code-turn-stopped")).toBeInTheDocument();

    // The late answer still says working: it is not the page's any more.
    await act(async () => {
      answerProgress(
        progress({ steps: [step(2, CodeTaskStepKind.Ran, "npm test")] }),
      );
    });

    expect(screen.getByTestId("code-turn-stopped")).toBeInTheDocument();
    expect(screen.queryByTestId("code-task-working-footer")).toBeNull();
    expect(stepSubjects()).not.toContain("Ran npm test");
    // Dropped as it arrived: not even a read of the whole task again for it.
    expect(getTaskMock).toHaveBeenCalledTimes(2);
  });

  test("a hidden tab reads nothing, and reads once when it is looked at again", async () => {
    getTaskMock.mockResolvedValue(working() as never);
    getTurnProgressMock.mockResolvedValue(progress() as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);
    await screen.findByTestId("code-task-header");

    visibility = "hidden";
    await act(async () => {
      announce();
      announce();
    });
    expect(getTurnProgressMock).not.toHaveBeenCalled();

    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => {
      expect(getTurnProgressMock).toHaveBeenCalledTimes(1);
    });
  });

  test("a done task still hears its room: a turn someone else starts is read whole", async () => {
    getTaskMock.mockResolvedValueOnce(done() as never).mockResolvedValue(
      working({
        task: summary({ turnCount: 2 }),
        turns: [...done().turns, turn({ runId: REPLY_ID, steps: [] })],
      }) as never,
    );

    draw(<CodeTaskConversation {...PAGE_PROPS} />);
    await screen.findByTestId("code-task-header");
    expect(heldSubscriptions()).toHaveLength(1);

    await act(async () => {
      announce();
    });

    await waitFor(() => {
      expect(getTaskMock).toHaveBeenCalledTimes(2);
    });
    expect(getTurnProgressMock).not.toHaveBeenCalled();
    expect(
      await screen.findByTestId("code-task-working-footer"),
    ).toBeInTheDocument();
  });

  test("leaving the task stops listening to it", async () => {
    getTaskMock.mockResolvedValue(working() as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);
    await screen.findByTestId("code-task-header");
    expect(heldSubscriptions()).toHaveLength(1);

    cleanup();

    expect(heldSubscriptions()).toHaveLength(0);
  });

  test("without the live connection (a page drawn on its own) it opens none, and reads on its own", async () => {
    jest.useFakeTimers();
    mockLive.isStarted = false;
    getTaskMock.mockResolvedValue(working() as never);
    getTurnProgressMock.mockResolvedValue(progress() as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockLive.subscriptions).toHaveLength(0);

    await act(async () => {
      jest.advanceTimersByTime(CODE_TASK_POLL_MS);
      await Promise.resolve();
    });

    expect(getTurnProgressMock).toHaveBeenCalledTimes(1);
  });
});

describe("a turn's Log while AI works", () => {
  const LOG_PATH: string = `/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}/log`;

  // What /code-fix-run/logs/:id answers: the run working, its steps so far.
  function logAnswer(...steps: Array<string>): HTTPResponse<JSONObject> {
    return new HTTPResponse<JSONObject>(
      200,
      {
        run: { _id: REPLY_ID, status: AIRunStatus.Running },
        events: steps.map((line: string, index: number): JSONObject => {
          return {
            _id: `event-${index}`,
            sequence: index + 1,
            eventType: "ProgressLog",
            resultSummary: { message: line },
            createdAt: "2026-11-03T10:01:00.000Z",
          };
        }),
        llmLogs: [],
        canReadContent: true,
      },
      {},
    );
  }

  function logReads(postSpy: SpyInstance<typeof API.post>): Array<string> {
    return postSpy.mock.calls.map(
      (call: Parameters<typeof API.post>): string => {
        const url: URL = call[0].url as URL;
        return url.toString().split("/code-fix-run/logs/")[1] || "";
      },
    );
  }

  function drawLog(search: string): void {
    goTo(`${LOG_PATH}${search}`);

    render(
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

  beforeEach(() => {
    getTaskMock.mockResolvedValue(
      working({
        task: summary({ turnCount: 2 }),
        turns: [
          turn({
            status: AIRunStatus.Completed,
            state: CodeTaskState.Done,
            outcome: { summary: "Done.", filesChanged: [] },
          }),
          turn({ runId: REPLY_ID, steps: [] }),
        ],
      }) as never,
    );
  });

  test("hears its own turn's room - a reply's run, not the task's - and reads the record again when it is announced", async () => {
    const postSpy: SpyInstance<typeof API.post> = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(logAnswer("read src/checkout.ts") as never)
      .mockResolvedValue(
        logAnswer("read src/checkout.ts", "ran npm test") as never,
      ) as unknown as SpyInstance<typeof API.post>;

    drawLog(`?turn=${REPLY_ID}`);

    expect(await screen.findByText("read src/checkout.ts")).toBeInTheDocument();

    expect(heldSubscriptions()).toHaveLength(1);
    const request: Subscription["request"] = heldSubscriptions()[0]!.request;
    expect(request.modelType).toBe(AIRun);
    expect(request.eventType).toBe(ModelEventType.Update);
    expect(request.modelId?.toString()).toBe(REPLY_ID);

    await act(async () => {
      announce();
    });

    expect(await screen.findByText("ran npm test")).toBeInTheDocument();
    expect(logReads(postSpy)).toEqual([REPLY_ID, REPLY_ID]);
  });

  test("a step's words are set apart in their own direction: on a Persian page isExpired( keeps its bracket at its end", async () => {
    jest.spyOn(API, "post").mockResolvedValue(logAnswer("isExpired(") as never);

    drawLog(`?turn=${REPLY_ID}`);

    const words: HTMLElement = await screen.findByText("isExpired(");
    expect(words.tagName).toBe("BDI");
    expect(words).toHaveAttribute("dir", "ltr");
    expect(
      words.closest("[data-testid='code-task-log-entry-message']"),
    ).not.toBeNull();
  });

  test("says its steps show as they happen, not every five seconds", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(logAnswer("read src/checkout.ts") as never);

    drawLog(`?turn=${REPLY_ID}`);

    expect(
      await screen.findByText(CODE_TASK_LOG_TURN_RECORD_COPY.stepsSoFar),
    ).toBeInTheDocument();
    expect(CODE_TASK_LOG_TURN_RECORD_COPY.stepsSoFar).toBe(
      "Every step this turn has taken so far. New steps show as they happen.",
    );
    expect(CODE_TASK_LOG_TASK_RECORD_COPY.stepsSoFar).toBe(
      "Every step this task has taken so far. New steps show as they happen.",
    );
    expect(screen.queryByText(/every 5 seconds/i)).toBeNull();
  });

  test("reads its whole record at most once a second however many steps are announced, and every five seconds when it hears none", async () => {
    expect(CODE_TASK_LOG_LIVE_MIN_INTERVAL_MS).toBe(1000);
    expect(CODE_TASK_LOG_POLL_MS).toBe(5000);

    jest.useFakeTimers();
    const postSpy: SpyInstance<typeof API.post> = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        logAnswer("read src/checkout.ts") as never,
      ) as unknown as SpyInstance<typeof API.post>;

    drawLog(`?turn=${REPLY_ID}`);

    await act(async () => {
      for (let index: number = 0; index < 5; index++) {
        await Promise.resolve();
      }
    });
    const first: number = postSpy.mock.calls.length;
    expect(first).toBeGreaterThanOrEqual(1);

    // A burst: one read now, one more a second later.
    await act(async () => {
      for (let index: number = 0; index < 6; index++) {
        announce();
      }
      await Promise.resolve();
    });
    expect(postSpy.mock.calls.length).toBe(first + 1);

    await act(async () => {
      jest.advanceTimersByTime(CODE_TASK_LOG_LIVE_MIN_INTERVAL_MS);
      await Promise.resolve();
    });
    expect(postSpy.mock.calls.length).toBe(first + 2);
  });
});

describe("useCodeTaskLive: the reader behind a Code page", () => {
  type RefreshMock = Mock<() => Promise<void>>;

  function hear(options: Partial<UseCodeTaskLiveOptions> = {}): {
    refresh: RefreshMock;
    rerender: (next: Partial<UseCodeTaskLiveOptions>) => void;
    unmount: () => void;
  } {
    const refresh: RefreshMock = jest.fn(async (): Promise<void> => {});

    const initial: UseCodeTaskLiveOptions = {
      projectId: new ObjectID(PROJECT_ID),
      recordId: TASK_ID,
      isWorking: true,
      refresh,
      ...options,
    };

    const hook: {
      rerender: (props: UseCodeTaskLiveOptions) => void;
      unmount: () => void;
    } = renderHook(
      (props: UseCodeTaskLiveOptions) => {
        useCodeTaskLive(props);
      },
      { initialProps: initial },
    );

    return {
      refresh,
      rerender: (next: Partial<UseCodeTaskLiveOptions>): void => {
        hook.rerender({ ...initial, ...next });
      },
      unmount: hook.unmount,
    };
  }

  test("after an announcement it reads on its own only every fifteen seconds - and every three again after a minute without one", async () => {
    jest.useFakeTimers();
    const { refresh } = hear();

    // Heard right away: read at once.
    await act(async () => {
      announce();
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    // The page's own read that was due at three seconds still comes once...
    await act(async () => {
      jest.advanceTimersByTime(CODE_TASK_POLL_MS);
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledTimes(2);

    // ...then none for fifteen seconds while announcements are heard.
    await act(async () => {
      jest.advanceTimersByTime(CODE_TASK_LIVE_POLL_MS - 1);
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledTimes(3);

    // A minute and more without one: back to every three seconds.
    await act(async () => {
      jest.advanceTimersByTime(CODE_TASK_LIVE_HEARD_WITHIN_MS);
      await Promise.resolve();
    });
    const before: number = refresh.mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(CODE_TASK_POLL_MS * 2);
      await Promise.resolve();
    });
    expect(refresh.mock.calls.length - before).toBeGreaterThanOrEqual(1);
  });

  test("not working: no read on its own, but an announcement is still read", async () => {
    jest.useFakeTimers();
    const { refresh } = hear({ isWorking: false });

    await act(async () => {
      jest.advanceTimersByTime(CODE_TASK_POLL_MS * 10);
      await Promise.resolve();
    });
    expect(refresh).not.toHaveBeenCalled();

    await act(async () => {
      announce();
      await Promise.resolve();
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("another record is a new subscription; the old one is let go", () => {
    const { rerender } = hear();

    expect(heldSubscriptions()).toHaveLength(1);

    rerender({ recordId: REPLY_ID });

    expect(heldSubscriptions()).toHaveLength(1);
    expect(heldSubscriptions()[0]!.request.modelId?.toString()).toBe(REPLY_ID);
  });

  test("no record, no project or a record that is not an id: nothing is listened to", () => {
    hear({ recordId: null });
    hear({ recordId: "task-12" });
    hear({ projectId: null });

    expect(mockLive.subscriptions).toHaveLength(0);
  });

  test("gone: no read after it, by timer or announcement", async () => {
    jest.useFakeTimers();
    const { refresh, unmount } = hear();
    const subscription: Subscription = heldSubscriptions()[0]!;

    unmount();

    await act(async () => {
      subscription.onEvent(new ObjectID(TASK_ID));
      jest.advanceTimersByTime(CODE_TASK_LIVE_POLL_MS * 2);
      await Promise.resolve();
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(subscription.isStopped).toBe(true);
  });
});

describe("useFollowLatest: the newest step stays in view for a reader at the end", () => {
  const scroller: {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  } = { scrollTop: 0, scrollHeight: 1000, clientHeight: 800 };

  beforeEach(() => {
    scroller.scrollTop = 0;
    scroller.scrollHeight = 1000;
    scroller.clientHeight = 800;

    for (const key of ["scrollTop", "scrollHeight", "clientHeight"] as const) {
      Object.defineProperty(document.documentElement, key, {
        configurable: true,
        get: (): number => {
          return scroller[key];
        },
        set: (value: number): void => {
          scroller[key] = value;
        },
      });
    }

    jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback): number => {
        callback(0);
        return 1;
      });
  });

  function follow(initial: { growthKey: string; isLive: boolean }): {
    rerender: (next: { growthKey: string; isLive: boolean }) => void;
  } {
    const hook: {
      rerender: (props: { growthKey: string; isLive: boolean }) => void;
    } = renderHook(
      (props: { growthKey: string; isLive: boolean }) => {
        useFollowLatest(props);
      },
      { initialProps: initial },
    );

    return hook;
  }

  function scrollTo(scrollTop: number): void {
    scroller.scrollTop = scrollTop;
    window.dispatchEvent(new Event("scroll"));
  }

  test("the end, near enough: within the slack", () => {
    expect(FOLLOW_LATEST_SLACK_PX).toBe(96);
    expect(
      isScrolledToEnd({
        scrollTop: 200,
        scrollHeight: 1000,
        clientHeight: 800,
      }),
    ).toBe(true);
    expect(
      isScrolledToEnd({
        scrollTop: 104,
        scrollHeight: 1000,
        clientHeight: 800,
      }),
    ).toBe(true);
    expect(
      isScrolledToEnd({
        scrollTop: 103,
        scrollHeight: 1000,
        clientHeight: 800,
      }),
    ).toBe(false);
  });

  test("opening a task never moves the page", () => {
    follow({ growthKey: "1:a:Working:2", isLive: true });

    expect(scroller.scrollTop).toBe(0);
  });

  test("a reader at the end keeps seeing the newest step as the page grows", () => {
    const { rerender } = follow({ growthKey: "1:a:Working:2", isLive: true });

    scrollTo(200);
    scroller.scrollHeight = 1240;
    rerender({ growthKey: "1:a:Working:3", isLive: true });

    // The page's end: as far down as it scrolls.
    expect(scroller.scrollTop).toBe(1240 - 800);
  });

  test("a reader who scrolled up to read is left where they are", () => {
    const { rerender } = follow({ growthKey: "1:a:Working:2", isLive: true });

    scrollTo(40);
    scroller.scrollHeight = 1240;
    rerender({ growthKey: "1:a:Working:3", isLive: true });

    expect(scroller.scrollTop).toBe(40);
  });

  /*
   * The browser sends a scroll's event with the next frame, and a step can
   * be drawn before it comes. The reader's place is read from the page, not
   * from the last event: a reader who had just come to the end was left
   * short of the newest step (Code.spec.ts, on a busy runner).
   */
  test("a reader who has just come to the end is followed, before the browser has said they scrolled", () => {
    const { rerender } = follow({ growthKey: "1:a:Working:2", isLive: true });

    // From the top to the end; its scroll event is not sent yet.
    scroller.scrollTop = 200;
    scroller.scrollHeight = 1240;
    rerender({ growthKey: "1:a:Working:3", isLive: true });

    expect(scroller.scrollTop).toBe(1240 - 800);
  });

  test("a reader who has just scrolled up is left there, before the browser has said they scrolled", () => {
    const { rerender } = follow({ growthKey: "1:a:Working:2", isLive: true });

    // At the end, then up to read; that scroll's event is not sent yet.
    scrollTo(200);
    scroller.scrollTop = 40;
    scroller.scrollHeight = 1240;
    rerender({ growthKey: "1:a:Working:3", isLive: true });

    expect(scroller.scrollTop).toBe(40);
  });

  describe("the second look, on the next frame", () => {
    let frames: Array<FrameRequestCallback> = [];

    beforeEach(() => {
      frames = [];
      jest.spyOn(window, "requestAnimationFrame").mockImplementation(((
        callback: FrameRequestCallback,
      ): number => {
        frames.push(callback);
        return frames.length;
      }) as never);
    });

    function nextFrame(): void {
      act(() => {
        for (const frame of frames.splice(0)) {
          frame(0);
        }
      });
    }

    test("what laid out after the step was drawn still ends in view", () => {
      const { rerender } = follow({
        growthKey: "1:a:Working:2",
        isLive: true,
      });

      scrollTo(200);
      scroller.scrollHeight = 1240;
      rerender({ growthKey: "1:a:Working:3", isLive: true });
      expect(scroller.scrollTop).toBe(1240 - 800);

      // Laid out after the step was drawn: the end moves 300 pixels down.
      scroller.scrollHeight = 1540;
      nextFrame();

      expect(scroller.scrollTop).toBe(1540 - 800);
    });

    test("negative control: a reader who scrolled up before it is left there, before the browser has said they scrolled", () => {
      const { rerender } = follow({
        growthKey: "1:a:Working:2",
        isLive: true,
      });

      scrollTo(200);
      scroller.scrollHeight = 1240;
      rerender({ growthKey: "1:a:Working:3", isLive: true });
      expect(scroller.scrollTop).toBe(1240 - 800);

      // Up to read, its scroll event not sent yet; more lays out below.
      scroller.scrollTop = 100;
      scroller.scrollHeight = 1540;
      nextFrame();

      expect(scroller.scrollTop).toBe(100);
    });
  });

  test("the reply that ends the turn still comes into view; a page nobody works on never moves", () => {
    const { rerender } = follow({ growthKey: "1:a:Working:2", isLive: true });

    scrollTo(200);
    scroller.scrollHeight = 1600;
    rerender({ growthKey: "1:a:Done:2:1", isLive: false });
    expect(scroller.scrollTop).toBe(1600 - 800);

    // Done and read again (someone else's change): nothing moves.
    scroller.scrollHeight = 2000;
    rerender({ growthKey: "1:a:Done:2:1:x", isLive: false });
    expect(scroller.scrollTop).toBe(800);
  });

  /*
   * The UI review: a reply that ends the turn comes in at once, and a long
   * one ran past the window - followed to the end of the page, the reader
   * saw its pull request and had to scroll back up for its first words.
   */
  test("where a following page goes: its end - and once the turn ends, never past the reply's first line", () => {
    expect(FOLLOW_LATEST_START_GAP_PX).toBe(24);

    // While AI works the newest step is watched: the end.
    expect(
      getFollowTarget({
        scrollHeight: 3000,
        clientHeight: 800,
        latestStartTop: null,
      }),
    ).toBe(2200);
    // A reply that fits under its first line: the end, the box with it.
    expect(
      getFollowTarget({
        scrollHeight: 3000,
        clientHeight: 800,
        latestStartTop: 2600,
        headerHeight: 64,
      }),
    ).toBe(2200);
    // A long one: its first line under the sticky header, with room above.
    expect(
      getFollowTarget({
        scrollHeight: 3000,
        clientHeight: 800,
        latestStartTop: 1500,
        headerHeight: 64,
      }),
    ).toBe(1500 - 64 - 24);
    // Never above the page's top, never past its end.
    expect(
      getFollowTarget({
        scrollHeight: 3000,
        clientHeight: 800,
        latestStartTop: 30,
        headerHeight: 64,
      }),
    ).toBe(0);
    expect(
      getFollowTarget({
        scrollHeight: 600,
        clientHeight: 800,
        latestStartTop: null,
      }),
    ).toBe(0);
  });

  describe("with the reply's first line to keep in view", () => {
    let replyTop: number = 0;
    const reply: HTMLElement = document.createElement("li");

    reply.getBoundingClientRect = (): DOMRect => {
      return {
        top: replyTop,
        bottom: replyTop + 1400,
        left: 0,
        right: 600,
        width: 600,
        height: 1400,
        x: 0,
        y: replyTop,
        toJSON: (): JSONObject => {
          return {};
        },
      } as DOMRect;
    };

    function followReply(initial: { growthKey: string; isLive: boolean }): {
      rerender: (next: { growthKey: string; isLive: boolean }) => void;
    } {
      return renderHook(
        (props: { growthKey: string; isLive: boolean }) => {
          useFollowLatest({
            ...props,
            getLatestStart: (): Element => {
              return reply;
            },
          });
        },
        { initialProps: initial },
      );
    }

    beforeEach(() => {
      replyTop = 0;
      document.documentElement.style.setProperty("--app-header-height", "64px");
    });

    afterEach(() => {
      document.documentElement.style.removeProperty("--app-header-height");
    });

    test("a long reply that ends the turn is read from its first line, under the sticky header", () => {
      const { rerender } = followReply({
        growthKey: "1:a:Working:5",
        isLive: true,
      });

      // Watching at the end while AI works.
      scrollTo(200);

      // The reply comes, 300 pixels down the window and 1,400 tall.
      replyTop = 300;
      scroller.scrollHeight = 2400;
      rerender({ growthKey: "1:a:Done:0:1", isLive: false });

      expect(scroller.scrollTop).toBe(
        200 + 300 - 64 - FOLLOW_LATEST_START_GAP_PX,
      );

      // Reading it, not at the end: someone else's change pulls nothing.
      scroller.scrollHeight = 2600;
      rerender({ growthKey: "1:a:Done:0:1:x", isLive: false });
      expect(scroller.scrollTop).toBe(412);
    });

    test("while AI works the newest step is followed, wherever the reply began", () => {
      const { rerender } = followReply({
        growthKey: "1:a:Working:5",
        isLive: true,
      });

      scrollTo(200);
      replyTop = -900;
      scroller.scrollHeight = 2400;
      rerender({ growthKey: "1:a:Working:6", isLive: true });

      expect(scroller.scrollTop).toBe(2400 - 800);
    });

    /*
     * A page that gets shorter (a turn's steps fold as it ends) brings its
     * end up to a reader there: the browser keeps them at its new end,
     * further from the end they saw than the slack, and still at the end.
     */
    test("a turn that ends shorter than it worked still takes a reader at the end to the reply's first line", () => {
      const { rerender } = followReply({
        growthKey: "1:a:Working:5",
        isLive: true,
      });

      // Watching at the end of a page 2,000 pixels tall.
      scroller.scrollHeight = 2000;
      scrollTo(1200);

      // It ends 200 pixels shorter, the reply's first line above the window.
      scroller.scrollHeight = 1800;
      scroller.scrollTop = 1000;
      replyTop = -300;
      rerender({ growthKey: "1:a:Done:0:1", isLive: false });

      expect(scroller.scrollTop).toBe(
        1000 - 300 - 64 - FOLLOW_LATEST_START_GAP_PX,
      );
    });
  });

  test("a page that grew while the reader was not following is no longer at its end for the next step", () => {
    const { rerender } = follow({ growthKey: "k0", isLive: false });

    // At the end, but nobody is working: the growth does not follow...
    scrollTo(200);
    scroller.scrollHeight = 2000;
    rerender({ growthKey: "k1", isLive: false });
    expect(scroller.scrollTop).toBe(200);

    // ...and a turn starting later does not pull the reader down.
    scroller.scrollHeight = 2200;
    rerender({ growthKey: "k2", isLive: true });
    expect(scroller.scrollTop).toBe(200);
  });

  test("a reader who scrolls on a page that grew since it was drawn is judged on the page as they scroll it", () => {
    const { rerender } = follow({ growthKey: "1:a:Working:2", isLive: true });

    scrollTo(200);
    // Earlier steps shown: the page grows with nothing new from AI.
    scroller.scrollHeight = 2000;
    // A little further down, still 900 pixels from its end.
    scrollTo(300);

    scroller.scrollHeight = 2024;
    rerender({ growthKey: "1:a:Working:3", isLive: true });

    expect(scroller.scrollTop).toBe(300);
  });
});
