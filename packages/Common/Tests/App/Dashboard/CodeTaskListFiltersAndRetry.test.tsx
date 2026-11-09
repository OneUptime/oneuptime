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
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskListCountsJSON,
  CodeTaskListFilter,
  CodeTaskListKind,
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskSummaryJSON,
} from "../../../Types/AI/CodeTask";
import { TransientAIFailureKind } from "../../../Types/AI/TransientAIFailure";
import PullRequestState from "../../../Types/CodeRepository/PullRequestState";
import CodeTaskList from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeTaskList";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * A repository's tasks, and Code's list of every task: filters that say
 * how many tasks each shows (in progress, waiting for you, pull request
 * open, failed, done), a search by title or number, a failed task's
 * reason on its row with Try again, failed tasks picked and tried again
 * together, and a task AI tries again by itself saying which attempt it
 * is on and when the next starts. A row is still one link to the task.
 */

const listTasksMock: MockFunction = getJestMockFunction();
const retryManyMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi",
  () => {
    return {
      __esModule: true,
      CODE_TASK_API_PATH: "/code-task",
      default: {
        listTasks: (...args: Array<unknown>) => {
          return listTasksMock(...args);
        },
        retryMany: (...args: Array<unknown>) => {
          return retryManyMock(...args);
        },
      },
    };
  },
);

const REPOSITORY_ID: string = "6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e9f";
const FAILED_TASK_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";
const STOPPED_TASK_ID: string = "8e9f0a1b-2c3d-4e4f-9a5b-6c7d8e9f0a1b";
const DONE_TASK_ID: string = "9f0a1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
const RETRYING_TASK_ID: string = "0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d";

const translation: i18n = createInstance();

beforeAll(async () => {
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      fa: { translation: persianLocale },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  listTasksMock.mockReset();
  retryManyMock.mockReset();
  goTo(`/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}`);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

function task(data: Partial<CodeTaskSummaryJSON> = {}): CodeTaskSummaryJSON {
  return {
    id: DONE_TASK_ID,
    taskNumber: 12,
    title: "Retry charges when the gateway times out",
    recipe: CodeFixTaskType.CodeRequest,
    state: CodeTaskState.Done,
    isQueued: false,
    createdAt: "2026-10-19T10:00:00.000Z",
    lastActivityAt: "2026-10-19T10:10:00.000Z",
    startedAt: "2026-10-19T10:00:30.000Z",
    completedAt: "2026-10-19T10:09:30.000Z",
    origin: { type: CodeTaskOriginType.Request, label: "Ada Lovelace" },
    turnCount: 1,
    codeRepositoryId: REPOSITORY_ID,
    ...data,
  };
}

const FAILED: CodeTaskSummaryJSON = task({
  id: FAILED_TASK_ID,
  taskNumber: 14,
  title: "Add a retry budget to the payment client",
  state: CodeTaskState.Failed,
  errorMessage: "The AI could not finish: LLM completion request failed",
  retry: { attempt: 3, maxAttempts: 3 },
});

const STOPPED: CodeTaskSummaryJSON = task({
  id: STOPPED_TASK_ID,
  taskNumber: 13,
  title: "Log the card brand on declined charges",
  state: CodeTaskState.Stopped,
});

const COUNTS: CodeTaskListCountsJSON = {
  [CodeTaskListFilter.All]: 9,
  [CodeTaskListFilter.InProgress]: 2,
  [CodeTaskListFilter.WaitingForYou]: 1,
  [CodeTaskListFilter.PullRequestOpen]: 3,
  [CodeTaskListFilter.Failed]: 2,
  [CodeTaskListFilter.Done]: 1,
};

function answer(
  tasks: Array<CodeTaskSummaryJSON>,
  counts: CodeTaskListCountsJSON | undefined = COUNTS,
): Record<string, unknown> {
  return {
    tasks,
    count: tasks.length,
    skip: 0,
    limit: 20,
    ...(counts ? { counts } : {}),
  };
}

function draw(element: ReactElement): void {
  render(<I18nextProvider i18n={translation}>{element}</I18nextProvider>);
}

function drawList(data: { canRetry?: boolean; kind?: CodeTaskListKind } = {}): {
  onCount: MockFunction;
} {
  const onCount: MockFunction = getJestMockFunction();

  draw(
    <CodeTaskList
      scope={{ repositoryId: REPOSITORY_ID }}
      showFilters={true}
      canRetry={data.canRetry ?? true}
      kind={data.kind}
      onCount={onCount as unknown as (count: number) => void}
      emptyState={<p data-testid="empty-state">No tasks yet</p>}
    />,
  );

  return { onCount };
}

function lastListCall(): Record<string, unknown> {
  const calls: Array<Array<unknown>> = listTasksMock.mock.calls as Array<
    Array<unknown>
  >;
  return calls[calls.length - 1]![0] as Record<string, unknown>;
}

function rowOf(title: string): HTMLElement {
  return screen.getAllByTestId("code-task-row").find((row: HTMLElement) => {
    return row.textContent?.includes(title);
  })!;
}

describe("a task list's filters and search", () => {
  test("each filter says how many tasks it shows, and the page counts every task", async () => {
    listTasksMock.mockResolvedValue(answer([task(), FAILED]) as never);

    const { onCount } = drawList();

    const toolbar: HTMLElement = await screen.findByTestId(
      "code-task-list-toolbar",
    );
    const pills: Array<string> = within(toolbar)
      .getAllByRole("button")
      .map((pill: HTMLElement): string => {
        return pill.textContent || "";
      });

    expect(pills).toEqual([
      "All9",
      "In progress2",
      "Waiting for you1",
      "Pull request open3",
      "Failed2",
      "Done1",
    ]);
    expect(screen.getByTestId("code-task-filter-all")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(lastListCall()).toEqual({
      scope: { repositoryId: REPOSITORY_ID },
      skip: 0,
      limit: 20,
      filter: CodeTaskListFilter.All,
      search: "",
      withCounts: true,
    });
    // The page's own count is every task, not those of a filter.
    expect(onCount).toHaveBeenLastCalledWith(9);
  });

  test("a filter reads only its tasks, and says it is the one picked", async () => {
    listTasksMock.mockResolvedValue(answer([task(), FAILED]) as never);

    const { onCount } = drawList();
    await screen.findByTestId("code-task-list-toolbar");

    listTasksMock.mockResolvedValue(answer([FAILED]) as never);
    fireEvent.click(screen.getByTestId("code-task-filter-failed"));

    await waitFor(() => {
      expect(screen.getAllByTestId("code-task-row")).toHaveLength(1);
    });
    expect(lastListCall()["filter"]).toBe(CodeTaskListFilter.Failed);
    expect(screen.getByTestId("code-task-filter-failed")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("code-task-filter-all")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(onCount).toHaveBeenLastCalledWith(9);
  });

  test("the search reads once typing stops, with the filter picked", async () => {
    listTasksMock.mockResolvedValue(answer([task(), FAILED]) as never);

    drawList();
    await screen.findByTestId("code-task-list-toolbar");
    fireEvent.click(screen.getByTestId("code-task-filter-done"));
    await waitFor(() => {
      expect(lastListCall()["filter"]).toBe(CodeTaskListFilter.Done);
    });
    const callsBefore: number = listTasksMock.mock.calls.length;

    fireEvent.change(screen.getByTestId("code-task-list-search"), {
      target: { value: "  gateway " },
    });
    fireEvent.change(screen.getByTestId("code-task-list-search"), {
      target: { value: "  gateway" },
    });
    // Nothing is read while the person types.
    expect(listTasksMock.mock.calls.length).toBe(callsBefore);

    await waitFor(() => {
      expect(lastListCall()["search"]).toBe("gateway");
    });
    expect(lastListCall()["filter"]).toBe(CodeTaskListFilter.Done);
    // Typing stopped once: one read for it.
    expect(listTasksMock.mock.calls.length).toBe(callsBefore + 1);
    expect(screen.getByTestId("code-task-list-search")).toHaveAttribute(
      "aria-label",
      "Search tasks",
    );
  });

  test("nothing matches: said so with Clear filters, which shows every task again - not the empty page", async () => {
    listTasksMock.mockResolvedValue(answer([task(), FAILED]) as never);

    drawList();
    await screen.findByTestId("code-task-list-toolbar");

    listTasksMock.mockResolvedValue(answer([]) as never);
    fireEvent.click(screen.getByTestId("code-task-filter-waitingForYou"));

    const noMatch: HTMLElement = await screen.findByTestId(
      "code-task-list-no-match",
    );
    await waitFor(() => {
      expect(noMatch).toHaveTextContent("No tasks match.");
    });
    expect(screen.queryByTestId("empty-state")).toBeNull();
    // The filters stay, so another can be picked.
    expect(screen.getByTestId("code-task-list-toolbar")).toBeInTheDocument();

    listTasksMock.mockResolvedValue(answer([task(), FAILED]) as never);
    fireEvent.click(screen.getByTestId("code-task-list-clear-filters"));

    await waitFor(() => {
      expect(screen.getAllByTestId("code-task-row")).toHaveLength(2);
    });
    expect(lastListCall()["filter"]).toBe(CodeTaskListFilter.All);
    expect(lastListCall()["search"]).toBe("");
  });

  test("no task at all: the empty page, not filters over nothing", async () => {
    listTasksMock.mockResolvedValue(
      answer([], {
        ...COUNTS,
        [CodeTaskListFilter.All]: 0,
      }) as never,
    );

    drawList();

    expect(await screen.findByTestId("empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("code-task-list-toolbar")).toBeNull();
  });

  test("a failed read says why, keeps the filters, and tries again", async () => {
    listTasksMock.mockRejectedValue(new Error("The list could not be read."));

    drawList();

    expect(
      await screen.findByText("The list could not be read."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("code-task-list-toolbar")).toBeInTheDocument();

    listTasksMock.mockResolvedValue(answer([task()]) as never);
    fireEvent.click(screen.getByTestId("refresh-button"));

    expect(await screen.findByTestId("code-task-row")).toBeInTheDocument();
    expect(screen.queryByTestId("code-task-list-error")).toBeNull();
  });

  test("a list of production reviews has no filters, and asks for none", async () => {
    listTasksMock.mockResolvedValue(answer([task()], undefined) as never);

    drawList({ kind: CodeTaskListKind.ProductionReviews });

    await screen.findByTestId("code-task-row");
    expect(screen.queryByTestId("code-task-list-toolbar")).toBeNull();
    expect(lastListCall()).toEqual({
      scope: { repositoryId: REPOSITORY_ID },
      skip: 0,
      limit: 20,
      kind: CodeTaskListKind.ProductionReviews,
    });
  });
});

describe("a task list's rows", () => {
  test("a failed task says why on its row, after how many attempts - and its row is still one link", async () => {
    listTasksMock.mockResolvedValue(answer([FAILED]) as never);

    drawList();

    const row: HTMLElement = await screen.findByTestId("code-task-row");
    expect(within(row).getByTestId("code-task-row-error")).toHaveTextContent(
      "Failed after 3 attempts. The AI could not finish: LLM completion request failed",
    );
    expect(within(row).getAllByRole("link")).toHaveLength(1);
    expect(within(row).getByRole("link")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/tasks/${FAILED_TASK_ID}`,
    );
  });

  test("a task AI tries again by itself says which attempt, and when the next starts, instead of Queued", async () => {
    listTasksMock.mockResolvedValue(
      answer([
        task({
          id: RETRYING_TASK_ID,
          state: CodeTaskState.Working,
          isQueued: true,
          completedAt: undefined,
          retry: {
            attempt: 2,
            maxAttempts: 3,
            nextAttemptAt: new Date(Date.now() + 4 * 60_000).toISOString(),
            kind: TransientAIFailureKind.ProviderUnavailable,
            reason: "503 Service Unavailable",
          },
        }),
      ]) as never,
    );

    drawList();

    const row: HTMLElement = await screen.findByTestId("code-task-row");
    const note: HTMLElement = within(row).getByTestId("code-task-row-retry");
    expect(note).toHaveTextContent("Attempt 2 of 3");
    expect(note).toHaveTextContent(/Trying again in (3|4) minutes/);
    // Why, for whoever points at it.
    expect(note).toHaveAttribute(
      "title",
      "The AI model provider did not answer.",
    );
    expect(within(row).queryByTestId("code-task-row-state")).toBeNull();
    // It is not failed: nothing to try again by hand.
    expect(within(row).queryByTestId("code-task-row-retry-button")).toBeNull();
    expect(within(row).queryByTestId("code-task-row-select")).toBeNull();
  });

  test("a row says how long AI worked, and whether its pull request merged or closed", async () => {
    listTasksMock.mockResolvedValue(
      answer([
        task({
          pullRequest: {
            number: 418,
            url: "https://github.com/acme/checkout-api/pull/418",
            state: PullRequestState.Merged,
          },
        }),
        task({
          id: STOPPED_TASK_ID,
          title: "Close the idle connections",
          pullRequest: {
            number: 419,
            url: "https://github.com/acme/checkout-api/pull/419",
            state: PullRequestState.Closed,
          },
        }),
      ]) as never,
    );

    drawList();

    await screen.findAllByTestId("code-task-row");
    const merged: HTMLElement = rowOf(
      "Retry charges when the gateway times out",
    );
    expect(
      within(merged).getByTestId("code-task-row-duration"),
    ).toHaveTextContent("worked 9 minutes");
    expect(
      within(merged).getByTestId("code-task-row-pull-request"),
    ).toHaveTextContent("PR #418Merged");
    expect(
      within(rowOf("Close the idle connections")).getByTestId(
        "code-task-row-pull-request-state",
      ),
    ).toHaveTextContent("Closed");
  });

  test("in Persian, its filters and its rows count in Persian digits", async () => {
    listTasksMock.mockResolvedValue(answer([FAILED]) as never);
    await translation.changeLanguage("fa");

    try {
      drawList();

      const row: HTMLElement = await screen.findByTestId("code-task-row");
      const error: HTMLElement = within(row).getByTestId("code-task-row-error");
      expect(error).toHaveTextContent("پس از ۳ تلاش ناموفق بود.");
      // The error and the title as they were written: their stops at their ends.
      expect(
        within(error).getByText(
          "The AI could not finish: LLM completion request failed",
        ).tagName,
      ).toBe("BDI");
      expect(
        within(error).getByText(
          "The AI could not finish: LLM completion request failed",
        ),
      ).toHaveAttribute("dir", "ltr");
      expect(
        within(row).getByText("Add a retry budget to the payment client"),
      ).toHaveAttribute("dir", "ltr");
      expect(
        within(screen.getByTestId("code-task-filter-failed")).getByTestId(
          "code-task-filter-count",
        ),
      ).toHaveTextContent("۲");
    } finally {
      await translation.changeLanguage("en");
    }
  });
});

describe("trying failed tasks again from the list", () => {
  test("a failed or stopped row has Try again, which asks it again and reads the list again", async () => {
    listTasksMock.mockResolvedValue(answer([FAILED, STOPPED, task()]) as never);
    retryManyMock.mockResolvedValue({ retried: 1, failed: [] } as never);

    drawList();
    await screen.findAllByTestId("code-task-row");

    // Only the failed and the stopped one.
    expect(screen.getAllByTestId("code-task-row-retry-button")).toHaveLength(2);
    expect(screen.getAllByTestId("code-task-row-select")).toHaveLength(2);
    expect(
      within(rowOf("Retry charges when the gateway times out")).queryByTestId(
        "code-task-row-retry-button",
      ),
    ).toBeNull();

    const callsBefore: number = listTasksMock.mock.calls.length;
    fireEvent.click(
      within(rowOf("Add a retry budget to the payment client")).getByTestId(
        "code-task-row-retry-button",
      ),
    );

    expect(
      await screen.findByTestId("code-task-list-retry-result"),
    ).toHaveTextContent("Trying 1 task again.");
    expect(retryManyMock).toHaveBeenCalledWith([FAILED_TASK_ID]);
    await waitFor(() => {
      expect(listTasksMock.mock.calls.length).toBe(callsBefore + 1);
    });
  });

  test("failed tasks picked are tried again together; one that cannot be says why", async () => {
    listTasksMock.mockResolvedValue(answer([FAILED, STOPPED, task()]) as never);
    retryManyMock.mockResolvedValue({
      retried: 1,
      failed: [
        {
          taskId: STOPPED_TASK_ID,
          message: "This repository's Runner takes no AI code fixes.",
        },
      ],
    } as never);

    drawList();
    await screen.findAllByTestId("code-task-row");

    fireEvent.click(
      within(rowOf("Add a retry budget to the payment client")).getByRole(
        "checkbox",
        { name: "Select Add a retry budget to the payment client" },
      ),
    );

    const bulk: HTMLElement = screen.getByTestId("code-task-list-bulk");
    expect(bulk).toHaveTextContent("1 selected");
    fireEvent.click(within(bulk).getByTestId("code-task-list-select-all"));
    expect(bulk).toHaveTextContent("2 selected");
    // Every one that can be is picked: nothing more to select.
    expect(within(bulk).queryByTestId("code-task-list-select-all")).toBeNull();

    fireEvent.click(within(bulk).getByTestId("code-task-list-retry-selected"));

    const result: HTMLElement = await screen.findByTestId(
      "code-task-list-retry-result",
    );
    expect(retryManyMock).toHaveBeenCalledWith([
      FAILED_TASK_ID,
      STOPPED_TASK_ID,
    ]);
    expect(result).toHaveTextContent(
      "Trying 1 task again. 1 task could not be tried again: This repository's Runner takes no AI code fixes.",
    );
    // Nothing stays picked.
    expect(
      screen
        .getAllByTestId("code-task-row-select")
        .filter((box: HTMLElement): boolean => {
          return (box as HTMLInputElement).checked;
        }),
    ).toHaveLength(0);
  });

  test("Clear unpicks every task", async () => {
    listTasksMock.mockResolvedValue(answer([FAILED, STOPPED]) as never);

    drawList();
    await screen.findAllByTestId("code-task-row");

    fireEvent.click(screen.getAllByTestId("code-task-row-select")[0]!);
    fireEvent.click(
      within(screen.getByTestId("code-task-list-bulk")).getByRole("button", {
        name: "Clear",
      }),
    );

    expect(screen.queryByTestId("code-task-list-bulk")).toBeNull();
  });

  test("a failed request to try again says why", async () => {
    listTasksMock.mockResolvedValue(answer([FAILED]) as never);
    retryManyMock.mockRejectedValue(new Error("You are offline."));

    drawList();
    await screen.findByTestId("code-task-row");
    fireEvent.click(screen.getByTestId("code-task-row-retry-button"));

    expect(
      await screen.findByTestId("code-task-list-retry-result"),
    ).toHaveTextContent("1 task could not be tried again: You are offline.");
  });

  test("a reader who may not ask AI here has neither Try again nor a box to pick", async () => {
    listTasksMock.mockResolvedValue(answer([FAILED, STOPPED]) as never);

    drawList({ canRetry: false });
    await screen.findAllByTestId("code-task-row");

    expect(screen.queryByTestId("code-task-row-retry-button")).toBeNull();
    expect(screen.queryByTestId("code-task-row-select")).toBeNull();
    // The reason is still said.
    expect(screen.getByTestId("code-task-row-error")).toBeInTheDocument();
  });

  test("a task OneUptime started is not tried again from the list", async () => {
    listTasksMock.mockResolvedValue(
      answer([
        {
          ...FAILED,
          recipe: CodeFixTaskType.FixException,
          origin: { type: CodeTaskOriginType.Exception, label: "TypeError" },
        },
      ]) as never,
    );

    drawList();
    await screen.findByTestId("code-task-row");

    expect(screen.queryByTestId("code-task-row-retry-button")).toBeNull();
  });
});
