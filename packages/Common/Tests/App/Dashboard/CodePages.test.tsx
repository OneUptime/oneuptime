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
import type { SpiedFunction } from "jest-mock";
import React, { ReactElement } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import {
  CodeTaskBlockerType,
  CodeTaskOriginType,
  CodeTaskState,
  CodeTaskSummaryJSON,
  CodeTaskTurnJSON,
} from "../../../Types/AI/CodeTask";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import Route from "../../../Types/API/Route";
import Navigation from "../../../UI/Utils/Navigation";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * Code's three pages, rendered for real over a stand-in for the Code API
 * (Components/Code/CodeApi): the repositories first (Pages/Code/Code), a
 * repository's page where AI is asked (Pages/Code/Repository/Tasks), and a
 * task's conversation (Pages/Code/Task/Conversation).
 *
 * What each must do for the person in front of it:
 *  - Code: the repositories, most recently active first; a search box only
 *    once there are more than fit at a glance; with none yet, one thing -
 *    Connect GitHub - or, on a server with no GitHub App, what it needs;
 *    the tasks with no repository below; a failed read with Try again.
 *  - A repository: the request box first, whatever stops AI said above it,
 *    examples on a repository with no task, the tasks below; a read-only
 *    member reads and is told why they cannot ask; sending opens the new
 *    task's conversation; a refused send says why where it was typed.
 *  - A task: its state, number, kind, repository and pull request at the
 *    top; while AI works the page reads itself again and offers Stop; once
 *    it is done the box to reply, saying where changes go; Try again on a
 *    failed request; nothing to reply in for a task with no repository or a
 *    reader who may not ask.
 */

const getRepositoriesMock: MockFunction = getJestMockFunction();
const getRepositoryMock: MockFunction = getJestMockFunction();
const listTasksMock: MockFunction = getJestMockFunction();
const getTaskMock: MockFunction = getJestMockFunction();
const createTaskMock: MockFunction = getJestMockFunction();
const replyMock: MockFunction = getJestMockFunction();
const retryMock: MockFunction = getJestMockFunction();
const stopMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi",
  () => {
    return {
      __esModule: true,
      CODE_TASK_API_PATH: "/code-task",
      default: {
        getRepositories: (...args: Array<unknown>) => {
          return getRepositoriesMock(...args);
        },
        getRepository: (...args: Array<unknown>) => {
          return getRepositoryMock(...args);
        },
        listTasks: (...args: Array<unknown>) => {
          return listTasksMock(...args);
        },
        getTask: (...args: Array<unknown>) => {
          return getTaskMock(...args);
        },
        createTask: (...args: Array<unknown>) => {
          return createTaskMock(...args);
        },
        reply: (...args: Array<unknown>) => {
          return replyMock(...args);
        },
        retry: (...args: Array<unknown>) => {
          return retryMock(...args);
        },
        stop: (...args: Array<unknown>) => {
          return stopMock(...args);
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

import CodePage, {
  matchesRepositorySearch,
  REPOSITORY_SEARCH_THRESHOLD,
  sortRepositories,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Code";
import CodeRepositoryTasks from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Repository/Tasks";
import CodeTaskConversation, {
  CODE_TASK_POLL_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Task/Conversation";
import { CodeRepositoryListItem } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";

const REPOSITORY_ID: string = "6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e9f";
const TASK_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";
const NEW_TASK_ID: string = "8e9f0a1b-2c3d-4e4f-9a5b-6c7d8e9f0a1b";

const translation: i18n = createInstance();
let navigateMock: SpiedFunction<typeof Navigation.navigate>;

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
  for (const mock of [
    getRepositoriesMock,
    getRepositoryMock,
    listTasksMock,
    getTaskMock,
    createTaskMock,
    replyMock,
    retryMock,
    stopMock,
  ]) {
    mock.mockReset();
  }
  navigateMock = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((() => {}) as never);
  process.env["GITHUB_APP_NAME"] = "oneuptime-app";
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  navigateMock.mockRestore();
  delete process.env["GITHUB_APP_NAME"];
});

const PAGE_PROPS: {
  pageRoute: Route;
  currentProject: null;
  hasPaymentMethod: boolean;
} = {
  pageRoute: new Route("/"),
  currentProject: null,
  hasPaymentMethod: true,
};

function draw(element: ReactElement): void {
  render(<I18nextProvider i18n={translation}>{element}</I18nextProvider>);
}

function repository(
  data: Partial<CodeRepositoryListItem> & { name: string },
): CodeRepositoryListItem {
  return {
    id: `0000000${data.name.length}-0000-4000-8000-${data.name
      .padEnd(12, "0")
      .replace(/[^0-9a-f]/g, "0")
      .substring(0, 12)}`,
    isConnected: true,
    stats: { working: 0, waitingForYou: 0, openPullRequests: 0, taskCount: 0 },
    ...data,
  };
}

function summary(data: Partial<CodeTaskSummaryJSON> = {}): CodeTaskSummaryJSON {
  return {
    id: TASK_ID,
    taskNumber: 12,
    title: "Retry charges when the gateway times out",
    recipe: CodeFixTaskType.CodeRequest,
    state: CodeTaskState.Done,
    isQueued: false,
    createdAt: "2026-10-19T10:00:00.000Z",
    lastActivityAt: "2026-10-19T10:10:00.000Z",
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
    status: AIRunStatus.Completed,
    state: CodeTaskState.Done,
    createdAt: "2026-10-19T10:00:00.000Z",
    startedAt: "2026-10-19T10:00:30.000Z",
    completedAt: "2026-10-19T10:10:00.000Z",
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

describe("Code: the repositories first", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/code`);
  });

  test("while they load, placeholders hold their place", () => {
    getRepositoriesMock.mockReturnValue(new Promise(() => {}) as never);
    draw(<CodePage {...PAGE_PROPS} />);
    expect(screen.getByTestId("code-repositories-loading")).toBeInTheDocument();
  });

  test("the most recently active first, then by name, counted; Connect repositories beside them", async () => {
    getRepositoriesMock.mockResolvedValue({
      repositories: [
        repository({ name: "zeta" }),
        repository({ name: "alpha" }),
        repository({
          name: "middle",
          stats: {
            working: 1,
            waitingForYou: 0,
            openPullRequests: 0,
            taskCount: 1,
            lastActivityAt: "2026-10-19T09:00:00.000Z",
          },
        }),
      ],
      tasksWithoutRepositoryCount: 0,
    } as never);

    draw(<CodePage {...PAGE_PROPS} />);

    const cards: Array<HTMLElement> = await screen.findAllByTestId(
      "code-repository-card",
    );
    expect(
      cards.map((card: HTMLElement) => {
        return within(card).getByRole("heading").textContent;
      }),
    ).toEqual(["middle", "alpha", "zeta"]);
    expect(
      screen.getByRole("heading", { name: /Repositories/ }),
    ).toHaveTextContent("Repositories3");
    expect(screen.getByTestId("code-connect-more")).toBeInTheDocument();
    // A few repositories need no search box.
    expect(screen.queryByTestId("code-repository-search")).toBeNull();
    expect(screen.queryByTestId("code-tasks-without-repository")).toBeNull();
  });

  test(`over ${REPOSITORY_SEARCH_THRESHOLD} repositories, a search box finds one by name, full name or description`, async () => {
    getRepositoriesMock.mockResolvedValue({
      repositories: [
        repository({ name: "checkout-api", description: "Payments and carts" }),
        repository({
          name: "web",
          organizationName: "acme",
          repositoryName: "storefront",
        }),
        repository({ name: "one" }),
        repository({ name: "two" }),
        repository({ name: "three" }),
        repository({ name: "four" }),
        repository({ name: "five" }),
      ],
      tasksWithoutRepositoryCount: 0,
    } as never);

    draw(<CodePage {...PAGE_PROPS} />);

    const search: HTMLElement = await screen.findByTestId(
      "code-repository-search",
    );
    expect(screen.getAllByTestId("code-repository-card")).toHaveLength(7);

    await userEvent.type(search, "PAYMENTS");
    expect(screen.getAllByTestId("code-repository-card")).toHaveLength(1);

    await userEvent.clear(search);
    await userEvent.type(search, "acme/store");
    expect(screen.getAllByTestId("code-repository-card")).toHaveLength(1);

    await userEvent.clear(search);
    await userEvent.type(search, "nothing like it");
    expect(screen.queryAllByTestId("code-repository-card")).toHaveLength(0);
    expect(
      screen.getByTestId("code-repository-search-empty"),
    ).toHaveTextContent("No repository matches your search.");
  });

  test("no repository yet: what Code is for, and the one thing to do", async () => {
    getRepositoriesMock.mockResolvedValue({
      repositories: [],
      tasksWithoutRepositoryCount: 0,
    } as never);

    draw(<CodePage {...PAGE_PROPS} />);

    const empty: HTMLElement = await screen.findByTestId("code-connect-github");
    expect(empty).toHaveTextContent("Connect your code");
    expect(empty).toHaveTextContent(
      "Connect GitHub and ask OneUptime AI to work in your repositories",
    );
    expect(
      within(empty).getByRole("button", { name: "Connect GitHub" }),
    ).toBeEnabled();
    expect(
      within(empty).getByRole("button", {
        name: "Connect an existing installation",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("code-repositories")).toBeNull();
  });

  test("no GitHub App on this server: what it needs, not a button that cannot work", async () => {
    delete process.env["GITHUB_APP_NAME"];
    getRepositoriesMock.mockResolvedValue({
      repositories: [],
      tasksWithoutRepositoryCount: 0,
    } as never);

    draw(<CodePage {...PAGE_PROPS} />);

    expect(
      await screen.findByTestId("code-github-not-configured"),
    ).toHaveTextContent("GitHub App is not configured on this server");
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
  });

  test("tasks with no repository are listed below the repositories", async () => {
    getRepositoriesMock.mockResolvedValue({
      repositories: [repository({ name: "checkout-api" })],
      tasksWithoutRepositoryCount: 1,
    } as never);
    listTasksMock.mockResolvedValue({
      tasks: [
        summary({
          title: "ECONNRESET: socket hang up",
          codeRepositoryId: undefined,
        }),
      ],
      count: 1,
      skip: 0,
      limit: 20,
    } as never);

    draw(<CodePage {...PAGE_PROPS} />);

    const other: HTMLElement = await screen.findByTestId(
      "code-tasks-without-repository",
    );
    expect(other).toHaveTextContent("Other tasks");
    expect(
      await within(other).findByText("ECONNRESET: socket hang up"),
    ).toBeInTheDocument();
    expect(listTasksMock).toHaveBeenCalledWith({
      repositoryId: null,
      skip: 0,
      limit: 20,
    });
  });

  test("a failed read says why and tries again", async () => {
    getRepositoriesMock
      .mockRejectedValueOnce(
        new HTTPErrorResponse(
          500,
          { message: "Repositories are unavailable." },
          {},
        ) as never,
      )
      .mockResolvedValueOnce({
        repositories: [repository({ name: "checkout-api" })],
        tasksWithoutRepositoryCount: 0,
      } as never);

    draw(<CodePage {...PAGE_PROPS} />);

    expect(
      await screen.findByText("Repositories are unavailable."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByText("Refresh?"));
    expect(
      await screen.findByTestId("code-repository-card"),
    ).toBeInTheDocument();
  });

  test("sorting and searching as pure rules", () => {
    const sorted: Array<CodeRepositoryListItem> = sortRepositories([
      repository({ name: "b" }),
      repository({
        name: "c",
        stats: {
          working: 0,
          waitingForYou: 0,
          openPullRequests: 0,
          taskCount: 1,
          lastActivityAt: "2026-10-01T00:00:00.000Z",
        },
      }),
      repository({ name: "a" }),
    ]);
    expect(
      sorted.map((item: CodeRepositoryListItem) => {
        return item.name;
      }),
    ).toEqual(["c", "a", "b"]);

    expect(
      matchesRepositorySearch(repository({ name: "Checkout" }), "  check "),
    ).toBe(true);
    expect(matchesRepositorySearch(repository({ name: "x" }), "")).toBe(true);
    expect(matchesRepositorySearch(repository({ name: "x" }), "y")).toBe(false);
  });
});

describe("a repository's page: ask AI", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}`);
  });

  function repositoryAnswer(
    data: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      repository: {
        id: REPOSITORY_ID,
        name: "checkout-api",
        organizationName: "acme",
        repositoryName: "checkout-api",
        mainBranchName: "main",
        repositoryUrl: "https://github.com/acme/checkout-api",
        isConnected: true,
      },
      stats: {
        working: 0,
        waitingForYou: 0,
        openPullRequests: 0,
        taskCount: 1,
      },
      canAsk: true,
      blocker: null,
      ...data,
    };
  }

  test("the request box first, the repository's GitHub and branch above it, its tasks below", async () => {
    getRepositoryMock.mockResolvedValue(repositoryAnswer() as never);
    listTasksMock.mockResolvedValue({
      tasks: [summary()],
      count: 1,
      skip: 0,
      limit: 20,
    } as never);

    draw(<CodeRepositoryTasks {...PAGE_PROPS} />);

    const ask: HTMLElement = await screen.findByTestId("code-ask");
    expect(within(ask).getByRole("heading")).toHaveTextContent(
      "Ask AI to do something",
    );
    expect(within(ask).getByTestId("code-composer-input")).toBeEnabled();
    expect(ask).toHaveTextContent(
      "AI works on a new branch and opens a pull request for you to review when it changes code.",
    );
    expect(screen.queryByTestId("code-blocker")).toBeNull();
    expect(screen.queryByTestId("code-examples")).toBeNull();

    const header: HTMLElement = screen.getByTestId("code-repository-header");
    expect(
      within(header).getByRole("link", { name: "acme/checkout-api" }),
    ).toHaveAttribute("href", "https://github.com/acme/checkout-api");
    expect(header).toHaveTextContent("main");

    expect(await screen.findByTestId("code-task-row")).toHaveTextContent(
      "Retry charges when the gateway times out",
    );
    expect(listTasksMock).toHaveBeenCalledWith({
      repositoryId: REPOSITORY_ID,
      skip: 0,
      limit: 20,
    });
  });

  test("no task yet: examples, and no empty list beside them; an example fills the box", async () => {
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer({
        stats: {
          working: 0,
          waitingForYou: 0,
          openPullRequests: 0,
          taskCount: 0,
        },
      }) as never,
    );

    draw(<CodeRepositoryTasks {...PAGE_PROPS} />);

    const examples: HTMLElement = await screen.findByTestId("code-examples");
    expect(examples).toHaveTextContent("Try asking");
    expect(screen.queryByTestId("code-tasks")).toBeNull();
    expect(listTasksMock).not.toHaveBeenCalled();

    await userEvent.click(
      within(examples).getByRole("button", {
        name: "Explain how this repository is organized",
      }),
    );
    expect(screen.getByTestId("code-composer-input")).toHaveValue(
      "Explain how this repository is organized",
    );
  });

  test("sending starts a task and opens its conversation", async () => {
    getRepositoryMock.mockResolvedValue(repositoryAnswer() as never);
    listTasksMock.mockResolvedValue({
      tasks: [],
      count: 0,
      skip: 0,
      limit: 20,
    } as never);
    createTaskMock.mockResolvedValue(NEW_TASK_ID as never);

    draw(<CodeRepositoryTasks {...PAGE_PROPS} />);

    await userEvent.type(
      await screen.findByTestId("code-composer-input"),
      "Add an index on orders.customer_id{Enter}",
    );

    expect(createTaskMock).toHaveBeenCalledWith({
      repositoryId: REPOSITORY_ID,
      message: "Add an index on orders.customer_id",
      context: [],
    });
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalled();
    });
    expect((navigateMock.mock.calls[0]?.[0] as Route).toString()).toBe(
      `/dashboard/${PROJECT_ID}/code/tasks/${NEW_TASK_ID}`,
    );
  });

  test("a refused request is said where it was typed, and stays typed", async () => {
    getRepositoryMock.mockResolvedValue(repositoryAnswer() as never);
    listTasksMock.mockResolvedValue({
      tasks: [],
      count: 0,
      skip: 0,
      limit: 20,
    } as never);
    createTaskMock.mockRejectedValue(
      new HTTPErrorResponse(
        400,
        { message: "This project's AI credits are used up." },
        {},
      ) as never,
    );

    draw(<CodeRepositoryTasks {...PAGE_PROPS} />);
    await userEvent.type(
      await screen.findByTestId("code-composer-input"),
      "Do it{Enter}",
    );

    expect(await screen.findByTestId("code-composer-error")).toHaveTextContent(
      "This project's AI credits are used up.",
    );
    expect(screen.getByTestId("code-composer-input")).toHaveValue("Do it");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("whatever stops AI is said above the box, which waits and offers no examples", async () => {
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer({
        stats: {
          working: 0,
          waitingForYou: 0,
          openPullRequests: 0,
          taskCount: 0,
        },
        blocker: {
          type: CodeTaskBlockerType.NoAgent,
          message: "No Runner with Runs AI Code Fixes is online.",
        },
      }) as never,
    );

    draw(<CodeRepositoryTasks {...PAGE_PROPS} />);

    const notice: HTMLElement = await screen.findByTestId("code-blocker");
    expect(notice).toHaveAttribute("data-blocker", "NoAgent");
    expect(screen.getByTestId("code-composer-input")).toBeDisabled();
    expect(screen.queryByTestId("code-examples")).toBeNull();
  });

  test("a member who may only read: the reason, no box, and the tasks - or where they will show", async () => {
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer({
        canAsk: false,
        blocker: {
          type: CodeTaskBlockerType.NoPermission,
          message: "You can read this repository's tasks.",
        },
        stats: {
          working: 0,
          waitingForYou: 0,
          openPullRequests: 0,
          taskCount: 0,
        },
      }) as never,
    );
    listTasksMock.mockResolvedValue({
      tasks: [],
      count: 0,
      skip: 0,
      limit: 20,
    } as never);

    draw(<CodeRepositoryTasks {...PAGE_PROPS} />);

    expect(await screen.findByTestId("code-blocker")).toHaveAttribute(
      "data-blocker",
      "NoPermission",
    );
    expect(screen.queryByTestId("code-composer-input")).toBeNull();
    expect(await screen.findByTestId("code-tasks-empty")).toHaveTextContent(
      "When someone asks AI to work in this repository, the task shows up here.",
    );
  });

  test("a repository that cannot be read says so and tries again", async () => {
    getRepositoryMock
      .mockRejectedValueOnce(
        new HTTPErrorResponse(
          404,
          { message: "Repository not found, or you do not have access to it." },
          {},
        ) as never,
      )
      .mockResolvedValueOnce(repositoryAnswer() as never);
    listTasksMock.mockResolvedValue({
      tasks: [],
      count: 0,
      skip: 0,
      limit: 20,
    } as never);

    draw(<CodeRepositoryTasks {...PAGE_PROPS} />);

    expect(
      await screen.findByText(
        "Repository not found, or you do not have access to it.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByText("Refresh?"));
    expect(await screen.findByTestId("code-ask")).toBeInTheDocument();
  });
});

describe("a task's conversation", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`);
  });

  function taskAnswer(
    data: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      task: summary({
        pullRequest: {
          number: 418,
          url: "https://github.com/acme/checkout-api/pull/418",
          state: "open",
        },
      }),
      turns: [turn()],
      repository: {
        id: REPOSITORY_ID,
        name: "checkout-api",
        organizationName: "acme",
        repositoryName: "checkout-api",
        isConnected: true,
      },
      canAsk: true,
      canSeeChanges: true,
      canReadLogContent: true,
      blocker: null,
      ...data,
    };
  }

  test("its state, number, title, repository and pull request; then the conversation; then the box to reply", async () => {
    getTaskMock.mockResolvedValue(taskAnswer() as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    const header: HTMLElement = await screen.findByTestId("code-task-header");
    expect(within(header).getByTestId("code-task-state")).toHaveTextContent(
      "Done",
    );
    expect(header).toHaveTextContent("#12");
    expect(screen.getByTestId("code-task-title")).toHaveTextContent(
      "Retry charges when the gateway times out",
    );
    expect(
      within(header).getByRole("link", { name: "acme/checkout-api" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}`,
    );
    expect(screen.getByTestId("code-task-pull-request")).toHaveAttribute(
      "href",
      "https://github.com/acme/checkout-api/pull/418",
    );
    // A request has no kind pill: its title is what was asked.
    expect(header).not.toHaveTextContent("Request");

    expect(screen.getByTestId("code-turn-request")).toHaveTextContent(
      "Ada Lovelace",
    );
    const composer: HTMLElement = screen.getByTestId("code-task-composer");
    expect(within(composer).getByTestId("code-composer-input")).toHaveAttribute(
      "placeholder",
      "Ask for changes, add context, or ask a question…",
    );
    expect(composer).toHaveTextContent(
      "Changes you ask for are pushed to pull request #418.",
    );
  });

  test("a reply continues the same task, then the page reads it again", async () => {
    getTaskMock.mockResolvedValue(taskAnswer() as never);
    replyMock.mockResolvedValue(undefined as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    await userEvent.type(
      await screen.findByTestId("code-composer-input"),
      "Make the backoff 300 ms{Enter}",
    );

    expect(replyMock).toHaveBeenCalledWith({
      taskId: TASK_ID,
      message: "Make the backoff 300 ms",
      context: [],
    });
    await waitFor(() => {
      expect(getTaskMock).toHaveBeenCalledTimes(2);
    });
  });

  test("waiting for you: the box asks for an answer, and takes the focus", async () => {
    getTaskMock.mockResolvedValue(
      taskAnswer({
        task: summary({ state: CodeTaskState.WaitingForYou }),
        turns: [
          turn({
            state: CodeTaskState.WaitingForYou,
            needsInput: true,
            outcome: { summary: "Which do you prefer?", filesChanged: [] },
          }),
        ],
      }) as never,
    );

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    const input: HTMLElement = await screen.findByTestId("code-composer-input");
    expect(input).toHaveAttribute(
      "placeholder",
      "Answer the question, add context, or ask for changes…",
    );
    expect(input).toHaveFocus();
  });

  test("while AI works: no box, Stop - which stops it and reads the task again", async () => {
    getTaskMock
      .mockResolvedValueOnce(
        taskAnswer({
          task: summary({ state: CodeTaskState.Working }),
          turns: [
            turn({
              status: AIRunStatus.Running,
              state: CodeTaskState.Working,
              completedAt: undefined,
            }),
          ],
        }) as never,
      )
      .mockResolvedValue(
        taskAnswer({
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
    stopMock.mockResolvedValue(undefined as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    const footer: HTMLElement = await screen.findByTestId(
      "code-task-working-footer",
    );
    expect(footer).toHaveTextContent(
      "AI is working on this. You can reply when it finishes.",
    );
    expect(screen.queryByTestId("code-composer-input")).toBeNull();

    await userEvent.click(within(footer).getByTestId("code-task-stop"));
    expect(stopMock).toHaveBeenCalledWith(TASK_ID);
    expect(await screen.findByTestId("code-turn-stopped")).toHaveTextContent(
      "Stopped by Ada Lovelace.",
    );
  });

  test(`while AI works, the page reads the task again every ${CODE_TASK_POLL_MS / 1000} seconds - and stops once it is done`, async () => {
    jest.useFakeTimers();
    getTaskMock
      .mockResolvedValueOnce(
        taskAnswer({
          task: summary({ state: CodeTaskState.Working, isQueued: true }),
          turns: [
            turn({
              status: AIRunStatus.Queued,
              state: CodeTaskState.Working,
              startedAt: undefined,
              completedAt: undefined,
            }),
          ],
        }) as never,
      )
      .mockResolvedValue(taskAnswer() as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(getTaskMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(CODE_TASK_POLL_MS);
      await Promise.resolve();
    });
    expect(getTaskMock).toHaveBeenCalledTimes(2);

    // Done now: no more reads.
    await act(async () => {
      jest.advanceTimersByTime(CODE_TASK_POLL_MS * 3);
      await Promise.resolve();
    });
    expect(getTaskMock).toHaveBeenCalledTimes(2);
  });

  test("a reader who may only read: no Stop while AI works, and no box after", async () => {
    getTaskMock.mockResolvedValue(
      taskAnswer({
        task: summary({ state: CodeTaskState.Working }),
        turns: [
          turn({ status: AIRunStatus.Running, state: CodeTaskState.Working }),
        ],
        canAsk: false,
        canSeeChanges: false,
        blocker: { type: CodeTaskBlockerType.NoPermission, message: "x" },
      }) as never,
    );

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    // The reason comes before anything else in the footer.
    expect(await screen.findByTestId("code-blocker")).toHaveAttribute(
      "data-blocker",
      "NoPermission",
    );
    expect(screen.queryByTestId("code-task-stop")).toBeNull();
    expect(screen.queryByTestId("code-composer-input")).toBeNull();
  });

  test("a failed request: Try again asks the same again", async () => {
    getTaskMock
      .mockResolvedValueOnce(
        taskAnswer({
          task: summary({ state: CodeTaskState.Failed }),
          turns: [
            turn({
              status: AIRunStatus.Error,
              state: CodeTaskState.Failed,
              errorMessage: "Build failed.",
            }),
          ],
        }) as never,
      )
      .mockResolvedValue(taskAnswer() as never);
    retryMock.mockResolvedValue(undefined as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    await userEvent.click(await screen.findByTestId("code-turn-retry"));
    expect(retryMock).toHaveBeenCalledWith(TASK_ID);
    await waitFor(() => {
      expect(getTaskMock).toHaveBeenCalledTimes(2);
    });
  });

  test("Try again is not offered while something stops AI, nor for a turn nobody asked for in Code", async () => {
    getTaskMock.mockResolvedValue(
      taskAnswer({
        task: summary({
          state: CodeTaskState.Failed,
          recipe: CodeFixTaskType.FixException,
          title: "TypeError",
        }),
        turns: [
          turn({
            recipe: CodeFixTaskType.FixException,
            request: undefined,
            status: AIRunStatus.Error,
            state: CodeTaskState.Failed,
          }),
        ],
      }) as never,
    );

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    expect(await screen.findByTestId("code-turn-failed")).toBeInTheDocument();
    expect(screen.queryByTestId("code-turn-retry")).toBeNull();
    // Its kind is said beside its number.
    expect(screen.getByTestId("code-task-header")).toHaveTextContent(
      "Fix Exception",
    );
  });

  test("whatever stops AI is said above the box, which waits", async () => {
    getTaskMock.mockResolvedValue(
      taskAnswer({
        blocker: {
          type: CodeTaskBlockerType.AiDisabled,
          message: "AI is off.",
        },
      }) as never,
    );

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    expect(await screen.findByTestId("code-blocker")).toHaveAttribute(
      "data-blocker",
      "AiDisabled",
    );
    expect(screen.getByTestId("code-composer-input")).toBeDisabled();
  });

  test("a task with no repository: nothing to continue in, and why", async () => {
    getTaskMock.mockResolvedValue(
      taskAnswer({
        repository: null,
        canAsk: false,
        canSeeChanges: false,
      }) as never,
    );

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    expect(
      await screen.findByTestId("code-task-no-repository"),
    ).toHaveTextContent(
      "This task is not linked to a repository, so AI cannot continue it.",
    );
    expect(screen.queryByTestId("code-composer-input")).toBeNull();
  });

  test("a task that cannot be read says so and tries again", async () => {
    getTaskMock
      .mockRejectedValueOnce(
        new HTTPErrorResponse(
          404,
          { message: "Task not found, or you do not have access to it." },
          {},
        ) as never,
      )
      .mockResolvedValueOnce(taskAnswer() as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    expect(
      await screen.findByText(
        "Task not found, or you do not have access to it.",
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByText("Refresh?"));
    expect(await screen.findByTestId("code-task-header")).toBeInTheDocument();
  });
});
