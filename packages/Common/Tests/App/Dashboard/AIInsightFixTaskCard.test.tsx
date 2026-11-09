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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskSummaryJSON,
} from "../../../Types/AI/CodeTask";
import { CodeTaskStage } from "../../../Types/AI/CodeTaskStage";
import { TransientAIFailureKind } from "../../../Types/AI/TransientAIFailure";
import PullRequestState from "../../../Types/CodeRepository/PullRequestState";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import InsightFixTask from "../../../../App/FeatureSet/Dashboard/src/Components/AIInsights/InsightFixTask";
import { getStatusElement } from "../../../../App/FeatureSet/Dashboard/src/Components/AIInsights/InsightPresentation";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * An insight's Fix Task card, and its status, from the fix task's real
 * state: "Task in progress" until there is a pull request, "Task failed"
 * when there will be none - never "Fix opened" before any pull request. The
 * card says what the task is, what AI last said, its pull request and its
 * state, how much it changed; when AI tries it again by itself, which
 * attempt it is on and when the next starts (Retry now); when it failed,
 * why, with Try again. A task the reader may not read still links to it.
 */

const retryMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi",
  () => {
    return {
      __esModule: true,
      CODE_TASK_API_PATH: "/code-task",
      default: {
        retry: (...args: Array<unknown>) => {
          return retryMock(...args);
        },
      },
    };
  },
);

const TASK_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";
const PULL_REQUEST_URL: string =
  "https://github.com/acme/checkout-api/pull/418";

const translation: i18n = createInstance();

beforeAll(async () => {
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      de: { translation: germanLocale },
      fa: { translation: persianLocale },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  retryMock.mockReset();
  goTo(`/dashboard/${PROJECT_ID}/ai-insights`);
  await translation.changeLanguage("en");
});

afterEach(() => {
  cleanup();
});

function task(data: Partial<CodeTaskSummaryJSON> = {}): CodeTaskSummaryJSON {
  return {
    id: TASK_ID,
    taskNumber: 7,
    title: "Fix the null check in the checkout total",
    recipe: CodeFixTaskType.CodeRequest,
    state: CodeTaskState.Done,
    isQueued: false,
    createdAt: "2026-11-09T10:00:00.000Z",
    lastActivityAt: "2026-11-09T10:10:00.000Z",
    origin: { type: CodeTaskOriginType.Insight, label: "New exception" },
    turnCount: 1,
    ...data,
  };
}

const OPEN_PULL_REQUEST: CodeTaskSummaryJSON["pullRequest"] = {
  number: 418,
  url: PULL_REQUEST_URL,
  state: PullRequestState.Open,
};

function draw(element: ReactElement): void {
  render(<I18nextProvider i18n={translation}>{element}</I18nextProvider>);
}

function drawCard(
  data: {
    task?: CodeTaskSummaryJSON | undefined;
    isLoaded?: boolean;
  } = {},
): { onChanged: MockFunction } {
  const onChanged: MockFunction = getJestMockFunction();

  draw(
    <InsightFixTask
      taskId={TASK_ID}
      task={data.task}
      isLoaded={data.isLoaded ?? true}
      onChanged={onChanged as unknown as () => void}
    />,
  );

  return { onChanged };
}

// Each stage a fix task can be at, the task that is at it, and its words.
const STAGES: Array<[CodeTaskStage, CodeTaskSummaryJSON, string]> = [
  [
    CodeTaskStage.Queued,
    task({ state: CodeTaskState.Working, isQueued: true }),
    "Task queued",
  ],
  [
    CodeTaskStage.Working,
    task({ state: CodeTaskState.Working }),
    "Task in progress",
  ],
  [
    CodeTaskStage.Retrying,
    task({
      state: CodeTaskState.Working,
      isQueued: true,
      retry: {
        attempt: 2,
        maxAttempts: 3,
        nextAttemptAt: new Date(Date.now() + 4 * 60_000).toISOString(),
      },
    }),
    "Retrying",
  ],
  [
    CodeTaskStage.WaitingForYou,
    task({ state: CodeTaskState.WaitingForYou }),
    "Waiting for you",
  ],
  [
    CodeTaskStage.PullRequestOpen,
    task({ pullRequest: OPEN_PULL_REQUEST }),
    "Pull request open",
  ],
  [
    CodeTaskStage.Merged,
    task({
      pullRequest: { ...OPEN_PULL_REQUEST, state: PullRequestState.Merged },
    }),
    "Fix merged",
  ],
  [
    CodeTaskStage.PullRequestClosed,
    task({
      pullRequest: { ...OPEN_PULL_REQUEST, state: PullRequestState.Closed },
    }),
    "Pull request closed",
  ],
  [
    CodeTaskStage.Done,
    task({ changes: { files: 2, additions: 14, deletions: 3 } }),
    "Task done",
  ],
  [CodeTaskStage.NoChange, task(), "No change made"],
  [CodeTaskStage.Failed, task({ state: CodeTaskState.Failed }), "Task failed"],
  [
    CodeTaskStage.Stopped,
    task({ state: CodeTaskState.Stopped }),
    "Task stopped",
  ],
];

describe("an insight's fix task, where the insight is read", () => {
  test.each(STAGES)(
    "%s: said in its own words, on the card and as the insight's status",
    (stage: CodeTaskStage, summary: CodeTaskSummaryJSON, words: string) => {
      drawCard({ task: summary });

      const badge: HTMLElement = screen.getByTestId("ai-insight-fix-stage");
      expect(badge).toHaveTextContent(words);
      expect(badge).toHaveAttribute("data-stage", stage);
      cleanup();

      draw(getStatusElement(AIInsightStatus.FixOpened, summary));
      expect(screen.getByTestId("ai-insight-fix-status")).toHaveTextContent(
        words,
      );
      // Never that a fix was opened while there is no pull request.
      expect(document.body).not.toHaveTextContent("Fix Opened");
    },
  );

  test("its number, title, what AI last said, and how much it changed", () => {
    drawCard({
      task: task({
        latestReply:
          "Added a guard for an empty cart, and a test for it. The total is now zero, not NaN.",
        changes: { files: 2, additions: 14, deletions: 3 },
      }),
    });

    const card: HTMLElement = screen.getByTestId("ai-insight-fix-task");
    expect(card).toHaveTextContent("#7");
    expect(screen.getByTestId("ai-insight-fix-title")).toHaveTextContent(
      "Fix the null check in the checkout total",
    );
    expect(screen.getByTestId("ai-insight-fix-reply")).toHaveTextContent(
      "Added a guard for an empty cart",
    );
    expect(card).toHaveTextContent("2 files changed");
    expect(card).toHaveTextContent("+14");
    // Nothing failed, nothing to try again.
    expect(screen.queryByTestId("ai-insight-fix-failed")).toBeNull();
    expect(screen.queryByTestId("ai-insight-fix-try-again")).toBeNull();
  });

  test("its pull request opens in a new tab, by its number", () => {
    drawCard({ task: task({ pullRequest: OPEN_PULL_REQUEST }) });

    const link: HTMLElement = screen.getByTestId("ai-insight-fix-pull-request");
    expect(link).toHaveAttribute("href", PULL_REQUEST_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveTextContent("#418");
  });

  test("always a link to the task itself", () => {
    drawCard({ task: task() });

    expect(screen.getByRole("link", { name: "View the task" })).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`,
    );
  });

  test("while it is read: Loading; a task that cannot be read: its link, and nothing more", () => {
    drawCard({ isLoaded: false });

    expect(screen.getByTestId("ai-insight-fix-loading")).toHaveTextContent(
      "Loading…",
    );
    cleanup();

    drawCard({ isLoaded: true });

    expect(screen.queryByTestId("ai-insight-fix-loading")).toBeNull();
    expect(screen.queryByTestId("ai-insight-fix-stage")).toBeNull();
    expect(
      screen.getByRole("link", { name: "View the task" }),
    ).toBeInTheDocument();
  });

  test("an insight whose task cannot be read says it has a fix task - not that one was opened", () => {
    draw(getStatusElement(AIInsightStatus.FixOpened, undefined));

    expect(document.body).toHaveTextContent("Fix task");
    expect(screen.queryByTestId("ai-insight-fix-status")).toBeNull();
    cleanup();

    // Any other status is as it was.
    draw(getStatusElement(AIInsightStatus.ActionRequired, task()));
    expect(document.body).toHaveTextContent("Needs Attention");
    expect(screen.queryByTestId("ai-insight-fix-status")).toBeNull();
  });
});

describe("a fix task that fails, or that AI tries again", () => {
  test("AI trying it again by itself: which attempt, why, and when the next starts - Retry now starts it", async () => {
    retryMock.mockResolvedValue(undefined as never);

    const { onChanged } = drawCard({
      task: task({
        state: CodeTaskState.Working,
        isQueued: true,
        retry: {
          attempt: 2,
          maxAttempts: 3,
          nextAttemptAt: new Date(Date.now() + 4 * 60_000).toISOString(),
          kind: TransientAIFailureKind.ProviderUnavailable,
          reason: "503 Service Unavailable",
        },
      }),
    });

    const note: HTMLElement = screen.getByTestId("ai-insight-fix-retry");
    expect(note).toHaveTextContent("Attempt 2 of 3");
    expect(note).toHaveTextContent(/Trying again in (3|4) minutes/);
    expect(note).toHaveTextContent("The AI model provider did not answer.");

    fireEvent.click(within(note).getByTestId("code-task-retry-now"));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
    expect(retryMock).toHaveBeenCalledWith(TASK_ID);
  });

  test("failed: why, after how many attempts - and Try again asks again, then reads it again", async () => {
    retryMock.mockResolvedValue(undefined as never);

    const { onChanged } = drawCard({
      task: task({
        state: CodeTaskState.Failed,
        errorMessage: "LLM completion request failed",
        retry: { attempt: 3, maxAttempts: 3 },
      }),
    });

    const failed: HTMLElement = screen.getByTestId("ai-insight-fix-failed");
    /*
     * As the page's other AI cards say a run that did not finish: one
     * sentence, then why and how many times AI tried, in a quieter line.
     */
    expect(failed).toHaveTextContent("AI could not finish.");
    expect(
      within(failed).getByTestId("ai-insight-fix-failed-reason"),
    ).toHaveTextContent(/^LLM completion request failed$/);
    expect(
      within(failed).getByTestId("ai-insight-fix-failed-tries"),
    ).toHaveTextContent(/^OneUptime tried 3 times\.$/);
    // Its Try again is under them, the notice's one action.
    const tryAgain: HTMLElement = within(
      screen.getByTestId("ai-insight-fix-failed-actions"),
    ).getByTestId("ai-insight-fix-try-again");
    expect(tryAgain).toHaveTextContent(/^Try again$/);

    fireEvent.click(tryAgain);

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });
    expect(retryMock).toHaveBeenCalledWith(TASK_ID);
  });

  test("a failure on its one attempt says only that AI could not finish, and why", () => {
    drawCard({
      task: task({
        state: CodeTaskState.Failed,
        errorMessage: "The repository could not be cloned.",
      }),
    });

    const failed: HTMLElement = screen.getByTestId("ai-insight-fix-failed");
    expect(failed).toHaveTextContent(
      /^AI could not finish\.The repository could not be cloned\./,
    );
    expect(
      within(failed).queryByTestId("ai-insight-fix-failed-tries"),
    ).toBeNull();
  });

  test("a failure is a notice, as on the page's other AI cards - never a box; a retry note stacks in the card's narrow column", () => {
    drawCard({
      task: task({
        state: CodeTaskState.Failed,
        errorMessage: "LLM completion request failed",
        retry: { attempt: 3, maxAttempts: 3 },
      }),
    });

    // A red mark, a sentence and a quieter line: no tinted panel around them.
    const failed: HTMLElement = screen.getByTestId("ai-insight-fix-failed");
    expect(failed).not.toHaveClass("rounded-lg");
    expect(failed.querySelector("[class*='bg-red-']")).toBeNull();
    expect(failed.querySelector("svg")).not.toBeNull();
    // Its actions are a row of their own under the words, which wraps.
    expect(screen.getByTestId("ai-insight-fix-failed-actions")).toHaveClass(
      "flex-wrap",
    );
    cleanup();

    drawCard({
      task: task({
        state: CodeTaskState.Working,
        isQueued: true,
        retry: {
          attempt: 2,
          maxAttempts: 3,
          nextAttemptAt: new Date(Date.now() + 4 * 60_000).toISOString(),
        },
      }),
    });
    const note: HTMLElement = screen.getByTestId("ai-insight-fix-retry");
    expect(note).toHaveClass("[container-type:inline-size]");
    expect(
      within(note).getByTestId("code-task-retry-now").parentElement,
    ).toHaveClass("flex-col", "[@container(min-width:28rem)]:flex-row");
  });

  test("how long AI has worked on it: so far while it works, in all once it ended", () => {
    drawCard({
      task: task({
        state: CodeTaskState.Working,
        startedAt: new Date(Date.now() - 3 * 60_000).toISOString(),
      }),
    });
    expect(screen.getByTestId("ai-insight-fix-duration")).toHaveTextContent(
      /^3 minutes so far$/,
    );
    // Among the card's facts, after its number and when it last moved.
    expect(
      within(screen.getByTestId("ai-insight-fix-facts")).getByTestId(
        "ai-insight-fix-duration",
      ),
    ).toBeInTheDocument();
    cleanup();

    drawCard({
      task: task({
        startedAt: "2026-11-09T10:00:00.000Z",
        completedAt: "2026-11-09T10:09:00.000Z",
      }),
    });
    expect(screen.getByTestId("ai-insight-fix-duration")).toHaveTextContent(
      /^worked 9 minutes$/,
    );
    cleanup();

    // Not started: nothing said.
    drawCard({ task: task({ state: CodeTaskState.Working, isQueued: true }) });
    expect(screen.queryByTestId("ai-insight-fix-duration")).toBeNull();
  });

  test("a stopped request can be tried again too", () => {
    drawCard({ task: task({ state: CodeTaskState.Stopped }) });

    expect(screen.getByTestId("ai-insight-fix-try-again")).toBeEnabled();
    // Nothing failed: its Try again stands with the task's link.
    expect(screen.queryByTestId("ai-insight-fix-failed")).toBeNull();
  });

  test("a Try again the server refuses says why", async () => {
    retryMock.mockRejectedValue(
      new HTTPErrorResponse(
        400,
        { message: "This project's AI credits are used up." },
        {},
      ) as never,
    );

    const { onChanged } = drawCard({
      task: task({ state: CodeTaskState.Failed }),
    });

    fireEvent.click(screen.getByTestId("ai-insight-fix-try-again"));

    const refusal: HTMLElement = await screen.findByRole("alert");
    expect(refusal).toHaveTextContent("This project's AI credits are used up.");
    // Said under the button, among the failure's actions.
    expect(
      within(screen.getByTestId("ai-insight-fix-failed-actions")).getByRole(
        "alert",
      ),
    ).toBe(refusal);
    expect(onChanged).not.toHaveBeenCalled();
  });

  test("a task OneUptime started that failed is opened, not tried again from here", () => {
    drawCard({
      task: task({
        state: CodeTaskState.Failed,
        recipe: CodeFixTaskType.FixException,
      }),
    });

    expect(screen.getByTestId("ai-insight-fix-failed")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-insight-fix-try-again")).toBeNull();
  });
});

describe("in the reader's language", () => {
  test("German and Persian say where the task stands in their own words", async () => {
    await translation.changeLanguage("de");
    draw(
      getStatusElement(
        AIInsightStatus.FixOpened,
        task({ state: CodeTaskState.Failed }),
      ),
    );
    expect(screen.getByTestId("ai-insight-fix-status")).toHaveTextContent(
      "Aufgabe fehlgeschlagen",
    );
    cleanup();

    draw(getStatusElement(AIInsightStatus.FixOpened, undefined));
    expect(document.body).toHaveTextContent("Korrekturaufgabe");
    cleanup();

    await translation.changeLanguage("fa");
    drawCard({
      task: task({
        state: CodeTaskState.Working,
        isQueued: true,
        retry: {
          attempt: 2,
          maxAttempts: 3,
          nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
          kind: TransientAIFailureKind.RateLimited,
        },
      }),
    });
    expect(screen.getByTestId("ai-insight-fix-stage")).toHaveTextContent(
      "در حال تلاش مجدد",
    );
    // Which attempt, in the reader's own digits.
    expect(screen.getByTestId("ai-insight-fix-retry")).toHaveTextContent(
      "تلاش ۲ از ۳",
    );
    cleanup();

    drawCard({
      task: task({
        state: CodeTaskState.Failed,
        errorMessage: "LLM completion request failed.",
        latestReply: "The model provider did not answer.",
        retry: { attempt: 3, maxAttempts: 3 },
      }),
    });
    // How many times AI tried, in Persian.
    expect(screen.getByTestId("ai-insight-fix-failed-tries")).toHaveTextContent(
      "بار تلاش کرد",
    );
    // What was written reads as it was written: its stops at its ends.
    for (const written of [
      "Fix the null check in the checkout total",
      "LLM completion request failed.",
      "The model provider did not answer.",
    ]) {
      const element: HTMLElement = screen.getByText(written);
      expect(element.tagName).toBe("BDI");
      expect(element).toHaveAttribute("dir", "ltr");
    }
  });
});
