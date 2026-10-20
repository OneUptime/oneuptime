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
import type { SpyInstance } from "jest-mock";
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
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { JSONObject } from "../../../Types/JSON";
import Link from "../../../Types/Link";
import Permission from "../../../Types/Permission";
import ObjectID from "../../../Types/ObjectID";
import { PageBreadcrumbsContext } from "../../../UI/Components/Page/Page";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { goTo, PROJECT_ID } from "./SideMenuHarness";

/*
 * Code's pages, rendered for real over a stand-in for the Code API
 * (Components/Code/CodeApi): its first page - the question, one request box
 * with the repository and the branch picked in it, and every task under it
 * (Pages/Code/Code) - the connected repositories (Pages/Code/Repositories),
 * a repository's page where AI is asked (Pages/Code/Repository/Tasks), and a
 * task's conversation (Pages/Code/Task/Conversation).
 *
 * What each must do for the person in front of it:
 *  - Code: open on "What should AI do?" over the box, the box on the
 *    repository picked last (or the most recently active connected one),
 *    its main branch until another is picked, every task under it named by
 *    its repository; whatever stops AI in the repository picked said once
 *    at the top of the box with its one fix; examples until something is
 *    asked; with no repository, Connect GitHub; a failed read with Try
 *    again; the plan banner and nothing read on a plan without AI.
 *  - Repositories: a compact list, most recently active first, a search box
 *    once there are many, Connect repositories, and one banner - not a chip
 *    on every row - when GitHub reaches none of them.
 *  - A repository: the same box on this repository (only its branch is
 *    picked), its tasks below; a read-only member reads and is told why.
 *  - A task: its state, number, title, repository, branch, lines changed
 *    and pull request at the top; the person's messages and AI's turns;
 *    while AI works the page reads itself again and offers Stop; once done
 *    the reply box, held at the bottom of the window.
 */

const getRepositoriesMock: MockFunction = getJestMockFunction();
const getRepositoryMock: MockFunction = getJestMockFunction();
const listTasksMock: MockFunction = getJestMockFunction();
const getBranchesMock: MockFunction = getJestMockFunction();
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
        getBranches: (...args: Array<unknown>) => {
          return getBranchesMock(...args);
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

/*
 * BILLING_ENABLED is read where it is used, so it is a getter here: the
 * environment's own value unless a test sets one (CI turns billing on, a
 * local run has it off), so every other test reads as it would anyway.
 */
jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      const override: boolean | undefined = (
        globalThis as unknown as { __codePagesBilling: boolean | undefined }
      ).__codePagesBilling;

      return override === undefined
        ? Boolean(actual["BILLING_ENABLED"])
        : override;
    },
  });

  return mocked;
});

// The plans a cloud install defines (test-setup.sh), for a test that turns billing on.
const PLAN_ENV: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC:
    "Free,price_basic_monthly,price_basic_yearly,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_monthly,price_growth_yearly,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_monthly,price_scale_yearly,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_monthly,price_enterprise_yearly,-1,-1,4,14",
};

const savedPlanEnv: Record<string, string | undefined> = {};

function setBilling(enabled: boolean | undefined): void {
  (
    globalThis as unknown as { __codePagesBilling: boolean | undefined }
  ).__codePagesBilling = enabled;

  for (const key of Object.keys(PLAN_ENV)) {
    if (enabled) {
      savedPlanEnv[key] = process.env[key];
      process.env[key] = PLAN_ENV[key];
    } else if (key in savedPlanEnv) {
      if (savedPlanEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedPlanEnv[key];
      }
      delete savedPlanEnv[key];
    }
  }
}

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
  getConnectGitHubFix,
  getRepositoryNames,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Code";
import CodeRepositoriesPage, {
  isGitHubDisconnected,
  matchesRepositorySearch,
  REPOSITORY_SEARCH_THRESHOLD,
  sortRepositories,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Repositories";
import CodeRepositoryTasks from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Repository/Tasks";
import CodeTaskConversation, {
  CODE_TASK_POLL_MS,
  getTaskBaseBranch,
  STICKY_FOOTER_STYLE,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Task/Conversation";
import CodeTaskLog from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Task/Log";
import { CodeRepositoryListItem } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";
import {
  getRememberedRepositoryKey,
  pickStartingRepository,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeAskBox";
import { UseGitHubConnect } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/GitHubConnect";

const REPOSITORY_ID: string = "6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e9f";
const OTHER_REPOSITORY_ID: string = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";
const QUIET_REPOSITORY_ID: string = "4a5b6c7d-8e9f-4a0b-9c1d-2e3f4a5b6c7d";
const TASK_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";
const NEW_TASK_ID: string = "8e9f0a1b-2c3d-4e4f-9a5b-6c7d8e9f0a1b";

const translation: i18n = createInstance();
// Navigation.navigate spied on, as jest-mock's spyOn types it.
type NavigateSpy = SpyInstance<
  (
    ...args: Parameters<typeof Navigation.navigate>
  ) => ReturnType<typeof Navigation.navigate>
>;

let navigateMock: NavigateSpy;

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
    getBranchesMock,
    getTaskMock,
    createTaskMock,
    replyMock,
    retryMock,
    stopMock,
  ]) {
    mock.mockReset();
  }
  window.localStorage.clear();
  navigateMock = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((() => {}) as never);
  process.env["GITHUB_APP_NAME"] = "oneuptime-app";
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  window.localStorage.clear();
  delete process.env["GITHUB_APP_NAME"];
  setBilling(undefined);
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

/*
 * The signed-in person's permissions, as the permission snapshot hands them
 * to every gate: what decides whether Connect GitHub may be pressed.
 */
function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  });
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

// What /code-task/repository answers for a repository: who may ask, what stops AI.
function repositoryAnswer(
  data: Record<string, unknown> = {},
  repositoryData: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    repository: {
      id: REPOSITORY_ID,
      name: "checkout-api",
      organizationName: "acme",
      repositoryName: "checkout-api",
      mainBranchName: "main",
      repositoryUrl: "https://github.com/acme/checkout-api",
      description: "The checkout and payment API behind the store.",
      isConnected: true,
      ...repositoryData,
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

function tasksAnswer(
  tasks: Array<CodeTaskSummaryJSON>,
): Record<string, unknown> {
  return { tasks, count: tasks.length, skip: 0, limit: 20 };
}

// Code's repositories, as /code-task/repositories lists them.
const CHECKOUT: CodeRepositoryListItem = {
  id: REPOSITORY_ID,
  name: "checkout-api",
  organizationName: "acme",
  repositoryName: "checkout-api",
  mainBranchName: "main",
  isConnected: true,
  stats: {
    working: 1,
    waitingForYou: 0,
    openPullRequests: 1,
    taskCount: 6,
    lastActivityAt: "2026-10-19T10:10:00.000Z",
  },
};

const STOREFRONT: CodeRepositoryListItem = {
  id: OTHER_REPOSITORY_ID,
  name: "storefront-web",
  organizationName: "acme",
  repositoryName: "storefront-web",
  mainBranchName: "trunk",
  isConnected: true,
  stats: {
    working: 0,
    waitingForYou: 0,
    openPullRequests: 0,
    taskCount: 1,
    lastActivityAt: "2026-10-18T10:10:00.000Z",
  },
};

const PAYMENTS: CodeRepositoryListItem = {
  id: QUIET_REPOSITORY_ID,
  name: "payments-worker",
  organizationName: "acme",
  repositoryName: "payments-worker",
  mainBranchName: "master",
  isConnected: false,
  stats: { working: 0, waitingForYou: 0, openPullRequests: 0, taskCount: 0 },
};

// The box has read whether the reader may ask in the repository picked.
async function boxIsReady(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("code-branch-picker-button")).toBeEnabled();
  });
}

function pickerOptions(testId: string): Array<HTMLElement> {
  return screen.queryAllByTestId(`${testId}-option`);
}

describe("Code's first page: the question, one box, and every task", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/code`);
  });

  function repositoriesAre(
    repositories: Array<CodeRepositoryListItem>,
    tasksWithoutRepositoryCount: number = 0,
  ): void {
    getRepositoriesMock.mockResolvedValue({
      repositories,
      tasksWithoutRepositoryCount,
    } as never);
  }

  test("while it loads, a box and rows in the making - and a screen reader hears Loading", () => {
    getRepositoriesMock.mockReturnValue(new Promise(() => {}) as never);
    draw(<CodePage {...PAGE_PROPS} />);

    const loading: HTMLElement = screen.getByTestId("code-home-loading");
    expect(loading).toHaveAttribute("role", "status");
    expect(loading).toHaveTextContent("Loading…");
    expect(loading.querySelectorAll("[aria-hidden='true']").length).toBe(3);
  });

  test("opens on the question over one box, on the most recently active connected repository and its main branch, with every task under it", async () => {
    repositoriesAre([STOREFRONT, PAYMENTS, CHECKOUT]);
    getRepositoryMock.mockResolvedValue(repositoryAnswer() as never);
    listTasksMock.mockResolvedValue(
      tasksAnswer([
        summary(),
        summary({
          id: NEW_TASK_ID,
          title: "Add a dark theme",
          codeRepositoryId: OTHER_REPOSITORY_ID,
        }),
      ]) as never,
    );

    draw(<CodePage {...PAGE_PROPS} />);

    expect(await screen.findByTestId("code-home-heading")).toHaveTextContent(
      "What should AI do?",
    );
    // The page is about asking: the heading is its one h1.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "What should AI do?",
    );

    const ask: HTMLElement = screen.getByTestId("code-ask");
    expect(
      within(ask).getByTestId("code-repository-picker-button"),
    ).toHaveTextContent("checkout-api");
    expect(
      within(ask).getByTestId("code-repository-picker-button"),
    ).toHaveAttribute("aria-label", "Repository: checkout-api");
    expect(
      within(ask).getByTestId("code-branch-picker-button"),
    ).toHaveTextContent("main");
    await waitFor(() => {
      expect(getRepositoryMock).toHaveBeenCalledWith(REPOSITORY_ID);
    });
    await boxIsReady();
    expect(within(ask).getByTestId("code-composer-input")).toBeEnabled();
    expect(within(ask).getByTestId("code-composer-input")).toHaveAttribute(
      "aria-label",
      "What should AI do?",
    );
    expect(screen.getByTestId("code-ask-footer")).toHaveTextContent(
      "AI works on a new branch and opens a pull request for you to review when it changes code.",
    );

    // Every task the reader may read, each named by its repository.
    const rows: Array<HTMLElement> =
      await screen.findAllByTestId("code-task-row");
    expect(rows).toHaveLength(2);
    expect(
      rows.map((row: HTMLElement) => {
        return within(row).getByTestId("code-task-row-repository").textContent;
      }),
    ).toEqual(["checkout-api", "storefront-web"]);
    expect(listTasksMock).toHaveBeenCalledWith({
      scope: { allRepositories: true },
      skip: 0,
      limit: 20,
    });
    expect(screen.getByTestId("code-tasks-count")).toHaveTextContent("2");
    // Something has been asked: no examples.
    expect(screen.queryByTestId("code-examples")).toBeNull();
    // The repositories are something to pick here, not cards to scroll past.
    expect(screen.queryByTestId("code-repository-row")).toBeNull();
  });

  test("picking another repository reads whether the reader may ask there, starts it on its own main branch, and remembers it", async () => {
    repositoriesAre([CHECKOUT, STOREFRONT, PAYMENTS]);
    getRepositoryMock.mockImplementation(((id: string) => {
      return Promise.resolve(
        id === OTHER_REPOSITORY_ID
          ? repositoryAnswer(
              {},
              {
                id: OTHER_REPOSITORY_ID,
                name: "storefront-web",
                mainBranchName: "trunk",
              },
            )
          : repositoryAnswer(),
      );
    }) as never);
    listTasksMock.mockResolvedValue(tasksAnswer([summary()]) as never);

    draw(<CodePage {...PAGE_PROPS} />);
    await boxIsReady();

    await userEvent.click(screen.getByTestId("code-repository-picker-button"));
    const options: Array<HTMLElement> = pickerOptions("code-repository-picker");
    expect(
      options.map((option: HTMLElement) => {
        return option.getAttribute("data-value");
      }),
    ).toEqual([REPOSITORY_ID, OTHER_REPOSITORY_ID, QUIET_REPOSITORY_ID]);
    // The picked one is checked; one AI cannot reach says so, quieter.
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[2]).toHaveTextContent("Not connected");

    await userEvent.click(options[1]!);

    expect(
      screen.getByTestId("code-repository-picker-button"),
    ).toHaveTextContent("storefront-web");
    await waitFor(() => {
      expect(getRepositoryMock).toHaveBeenCalledWith(OTHER_REPOSITORY_ID);
    });
    await boxIsReady();
    expect(screen.getByTestId("code-branch-picker-button")).toHaveTextContent(
      "trunk",
    );
    expect(
      window.localStorage.getItem(getRememberedRepositoryKey(PROJECT_ID)),
    ).toContain(OTHER_REPOSITORY_ID);

    // Back to the first: already read, so nothing is asked again.
    await userEvent.click(screen.getByTestId("code-repository-picker-button"));
    await userEvent.click(pickerOptions("code-repository-picker")[0]!);
    expect(
      getRepositoryMock.mock.calls.filter((call: Array<unknown>) => {
        return call[0] === REPOSITORY_ID;
      }),
    ).toHaveLength(1);
  });

  test("the repository picked last is where the box starts next time", async () => {
    window.localStorage.setItem(
      getRememberedRepositoryKey(PROJECT_ID),
      JSON.stringify(OTHER_REPOSITORY_ID),
    );
    repositoriesAre([CHECKOUT, STOREFRONT]);
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer(
        {},
        { id: OTHER_REPOSITORY_ID, name: "storefront-web" },
      ) as never,
    );
    listTasksMock.mockResolvedValue(tasksAnswer([summary()]) as never);

    draw(<CodePage {...PAGE_PROPS} />);

    expect(
      await screen.findByTestId("code-repository-picker-button"),
    ).toHaveTextContent("storefront-web");
    await waitFor(() => {
      expect(getRepositoryMock).toHaveBeenCalledWith(OTHER_REPOSITORY_ID);
    });
    expect(getRepositoryMock).not.toHaveBeenCalledWith(REPOSITORY_ID);
  });

  test("the branch picker reads the repository's branches the first time it opens; a branch picked goes with the request", async () => {
    repositoriesAre([CHECKOUT]);
    getRepositoryMock.mockResolvedValue(repositoryAnswer() as never);
    listTasksMock.mockResolvedValue(tasksAnswer([summary()]) as never);
    getBranchesMock.mockResolvedValue({
      branches: ["main", "release/2026-10", "fix/gateway-timeout"],
      defaultBranch: "main",
      isComplete: true,
    } as never);
    createTaskMock.mockResolvedValue(NEW_TASK_ID as never);

    draw(<CodePage {...PAGE_PROPS} />);
    await boxIsReady();
    // Nothing is read before the picker opens.
    expect(getBranchesMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId("code-branch-picker-button"));
    await waitFor(() => {
      expect(pickerOptions("code-branch-picker")).toHaveLength(3);
    });
    expect(getBranchesMock).toHaveBeenCalledWith({
      repositoryId: REPOSITORY_ID,
      search: undefined,
    });
    const main: HTMLElement = pickerOptions("code-branch-picker")[0]!;
    expect(main).toHaveTextContent("main");
    expect(main).toHaveTextContent("Default");
    expect(main).toHaveAttribute("aria-selected", "true");

    await userEvent.click(pickerOptions("code-branch-picker")[1]!);
    expect(screen.getByTestId("code-branch-picker-button")).toHaveTextContent(
      "release/2026-10",
    );

    await userEvent.type(
      screen.getByTestId("code-composer-input"),
      "Backport the retry fix{Enter}",
    );

    expect(createTaskMock).toHaveBeenCalledWith({
      repositoryId: REPOSITORY_ID,
      message: "Backport the retry fix",
      context: [],
      branch: "release/2026-10",
    });
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalled();
    });
    expect((navigateMock.mock.calls[0]?.[0] as Route).toString()).toBe(
      `/dashboard/${PROJECT_ID}/code/tasks/${NEW_TASK_ID}`,
    );

    // Opened again, the branches are not read again.
    await userEvent.click(screen.getByTestId("code-branch-picker-button"));
    expect(getBranchesMock).toHaveBeenCalledTimes(1);
  });

  test("picking the main branch again sends no branch - the task starts where it would anyway", async () => {
    repositoriesAre([CHECKOUT]);
    getRepositoryMock.mockResolvedValue(repositoryAnswer() as never);
    listTasksMock.mockResolvedValue(tasksAnswer([summary()]) as never);
    getBranchesMock.mockResolvedValue({
      branches: ["main", "release/2026-10"],
      defaultBranch: "main",
      isComplete: true,
    } as never);
    createTaskMock.mockResolvedValue(NEW_TASK_ID as never);

    draw(<CodePage {...PAGE_PROPS} />);
    await boxIsReady();

    await userEvent.click(screen.getByTestId("code-branch-picker-button"));
    await waitFor(() => {
      expect(pickerOptions("code-branch-picker")).toHaveLength(2);
    });
    await userEvent.click(pickerOptions("code-branch-picker")[1]!);
    await userEvent.click(screen.getByTestId("code-branch-picker-button"));
    await userEvent.click(pickerOptions("code-branch-picker")[0]!);

    await userEvent.type(
      screen.getByTestId("code-composer-input"),
      "Add retries{Enter}",
    );

    expect(createTaskMock).toHaveBeenCalledWith({
      repositoryId: REPOSITORY_ID,
      message: "Add retries",
      context: [],
      branch: undefined,
    });
  });

  test("another repository picked: the branch picked for the last one is forgotten", async () => {
    repositoriesAre([CHECKOUT, STOREFRONT]);
    getRepositoryMock.mockImplementation(((id: string) => {
      return Promise.resolve(
        id === OTHER_REPOSITORY_ID
          ? repositoryAnswer(
              {},
              {
                id: OTHER_REPOSITORY_ID,
                name: "storefront-web",
                mainBranchName: "trunk",
              },
            )
          : repositoryAnswer(),
      );
    }) as never);
    listTasksMock.mockResolvedValue(tasksAnswer([summary()]) as never);
    getBranchesMock.mockResolvedValue({
      branches: ["main", "release/2026-10"],
      defaultBranch: "main",
      isComplete: true,
    } as never);
    createTaskMock.mockResolvedValue(NEW_TASK_ID as never);

    draw(<CodePage {...PAGE_PROPS} />);
    await boxIsReady();
    await userEvent.click(screen.getByTestId("code-branch-picker-button"));
    await waitFor(() => {
      expect(pickerOptions("code-branch-picker")).toHaveLength(2);
    });
    await userEvent.click(pickerOptions("code-branch-picker")[1]!);

    await userEvent.click(screen.getByTestId("code-repository-picker-button"));
    await userEvent.click(pickerOptions("code-repository-picker")[1]!);
    await boxIsReady();

    expect(screen.getByTestId("code-branch-picker-button")).toHaveTextContent(
      "trunk",
    );
    await userEvent.type(
      screen.getByTestId("code-composer-input"),
      "Add a dark theme{Enter}",
    );
    expect(createTaskMock).toHaveBeenCalledWith({
      repositoryId: OTHER_REPOSITORY_ID,
      message: "Add a dark theme",
      context: [],
      branch: undefined,
    });
  });

  test("nothing asked yet: requests to try under the box, no empty list - and one fills the box", async () => {
    repositoriesAre([CHECKOUT]);
    getRepositoryMock.mockResolvedValue(repositoryAnswer() as never);
    listTasksMock.mockResolvedValue(tasksAnswer([]) as never);

    draw(<CodePage {...PAGE_PROPS} />);

    const examples: HTMLElement = await screen.findByTestId("code-examples");
    expect(examples).toHaveTextContent("Try asking");
    expect(screen.getByTestId("code-tasks").className).toContain("hidden");

    await userEvent.click(
      within(examples).getByRole("button", {
        name: "Add tests for the code that has none",
      }),
    );
    expect(screen.getByTestId("code-composer-input")).toHaveValue(
      "Add tests for the code that has none",
    );
    expect(screen.getByTestId("code-composer-input")).toHaveFocus();
  });

  test("whatever stops AI in the repository picked is said once, at the top of the box, which then sends nothing", async () => {
    grant([Permission.ProjectUser, Permission.ProjectOwner]);
    repositoriesAre([CHECKOUT]);
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer({
        blocker: {
          type: CodeTaskBlockerType.AiDisabled,
          message: "AI is turned off for this project.",
        },
      }) as never,
    );
    listTasksMock.mockResolvedValue(tasksAnswer([]) as never);

    draw(<CodePage {...PAGE_PROPS} />);

    const notice: HTMLElement = await screen.findByTestId(
      "code-composer-notice",
    );
    const blocker: HTMLElement = within(notice).getByTestId("code-blocker");
    expect(blocker).toHaveAttribute("data-blocker", "AiDisabled");
    expect(within(blocker).getByTestId("code-blocker-fix")).toHaveTextContent(
      "Turn AI on",
    );
    expect(screen.getAllByTestId("code-blocker")).toHaveLength(1);
    expect(screen.getByTestId("code-composer-input")).toBeDisabled();
    expect(screen.getByTestId("code-branch-picker-button")).toBeDisabled();
    // Nothing to try while nothing can be sent, and no word on how to send.
    expect(screen.queryByTestId("code-examples")).toBeNull();
    expect(screen.queryByTestId("code-ask-footer")).toBeNull();
    expect(screen.queryByTestId("code-composer-keys")).toBeNull();
    // Another repository can still be picked.
    expect(screen.getByTestId("code-repository-picker-button")).toBeEnabled();
  });

  test("a repository GitHub does not reach: Connect GitHub right in the box starts GitHub's install", async () => {
    grant([Permission.ProjectUser, Permission.ProjectOwner]);
    repositoriesAre([PAYMENTS]);
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer(
        {
          blocker: {
            type: CodeTaskBlockerType.RepositoryNotConnected,
            message: "Not connected.",
          },
        },
        {
          id: QUIET_REPOSITORY_ID,
          name: "payments-worker",
          mainBranchName: "master",
          isConnected: false,
        },
      ) as never,
    );
    listTasksMock.mockResolvedValue(tasksAnswer([]) as never);
    const getSpy: SpyInstance<typeof API.get> = jest
      .spyOn(API, "get")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          {
            installUrl:
              "https://github.com/apps/oneuptime-app/installations/new?state=x",
          },
          {},
        ) as never,
      );

    draw(<CodePage {...PAGE_PROPS} />);

    const fix: HTMLElement = await screen.findByTestId("code-blocker-fix");
    expect(fix.tagName).toBe("BUTTON");
    expect(fix).toHaveTextContent("Connect GitHub");
    // The branch of a repository GitHub does not reach cannot be read: its main one, fixed.
    expect(screen.getByTestId("code-branch-picker-button")).toBeDisabled();
    expect(screen.getByTestId("code-branch-picker-button")).toHaveTextContent(
      "master",
    );

    await userEvent.click(fix);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalled();
    });
    expect(String(getSpy.mock.calls[0]?.[0]?.url)).toContain(
      "/github/install-url",
    );
    expect((navigateMock.mock.calls[0]?.[0] as URL).toString()).toBe(
      "https://github.com/apps/oneuptime-app/installations/new?state=x",
    );
  });

  test("a member who may only read: told why at the top of the box, which sends nothing - and the tasks", async () => {
    repositoriesAre([CHECKOUT]);
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer({
        canAsk: false,
        blocker: {
          type: CodeTaskBlockerType.NoPermission,
          message: "You can read this repository's tasks.",
        },
      }) as never,
    );
    listTasksMock.mockResolvedValue(tasksAnswer([summary()]) as never);

    draw(<CodePage {...PAGE_PROPS} />);

    const notice: HTMLElement = await screen.findByTestId(
      "code-composer-notice",
    );
    expect(within(notice).getByTestId("code-blocker")).toHaveAttribute(
      "data-blocker",
      "NoPermission",
    );
    expect(within(notice).getByTestId("code-blocker")).toHaveTextContent(
      "You can read this repository's tasks.",
    );
    expect(screen.getByTestId("code-composer-input")).toBeDisabled();
    expect(screen.getByTestId("code-composer-send")).toBeDisabled();
    expect(await screen.findByTestId("code-task-row")).toBeInTheDocument();
  });

  test("a request the server refuses is said where it was typed, and stays typed", async () => {
    repositoriesAre([CHECKOUT]);
    getRepositoryMock.mockResolvedValue(repositoryAnswer() as never);
    listTasksMock.mockResolvedValue(tasksAnswer([summary()]) as never);
    createTaskMock.mockRejectedValue(
      new HTTPErrorResponse(
        400,
        {
          message:
            "That branch is not in the repository on GitHub any more. Pick another branch.",
        },
        {},
      ) as never,
    );

    draw(<CodePage {...PAGE_PROPS} />);
    await boxIsReady();
    await userEvent.type(
      screen.getByTestId("code-composer-input"),
      "Do it{Enter}",
    );

    expect(await screen.findByTestId("code-composer-error")).toHaveTextContent(
      "That branch is not in the repository on GitHub any more.",
    );
    expect(screen.getByTestId("code-composer-input")).toHaveValue("Do it");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test("the box sends nothing while the repository picked is still being read", async () => {
    repositoriesAre([CHECKOUT]);
    getRepositoryMock.mockReturnValue(new Promise(() => {}) as never);
    listTasksMock.mockResolvedValue(tasksAnswer([summary()]) as never);

    draw(<CodePage {...PAGE_PROPS} />);

    const input: HTMLElement = await screen.findByTestId("code-composer-input");
    // The words can be written meanwhile.
    expect(input).toBeEnabled();
    await userEvent.type(input, "Add retries{Enter}");
    expect(input).toHaveValue("Add retries");
    expect(screen.getByTestId("code-composer-send")).toBeDisabled();
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  test("no repository yet: what Code is for, and the one thing to do", async () => {
    repositoriesAre([]);

    draw(<CodePage {...PAGE_PROPS} />);

    const empty: HTMLElement = await screen.findByTestId("code-connect-github");
    expect(empty).toHaveTextContent("Connect your code");
    expect(
      within(empty).getByRole("button", { name: "Connect GitHub" }),
    ).toBeEnabled();
    expect(
      within(empty).getByRole("button", {
        name: "Connect an existing installation",
      }),
    ).toBeInTheDocument();
    // No box to write in before there is anywhere for AI to work.
    expect(screen.queryByTestId("code-ask")).toBeNull();
    expect(screen.queryByTestId("code-home-heading")).toBeNull();
    expect(listTasksMock).not.toHaveBeenCalled();
  });

  test("no repository, but tasks that never found one: they stay readable under Connect GitHub", async () => {
    repositoriesAre([], 1);
    listTasksMock.mockResolvedValue(
      tasksAnswer([
        summary({
          title: "ECONNRESET: socket hang up",
          codeRepositoryId: undefined,
          recipe: CodeFixTaskType.FixException,
        }),
      ]) as never,
    );

    draw(<CodePage {...PAGE_PROPS} />);

    expect(await screen.findByTestId("code-connect-github")).toBeVisible();
    const row: HTMLElement = await screen.findByTestId("code-task-row");
    expect(row).toHaveTextContent("ECONNRESET: socket hang up");
    // A task with no repository names none.
    expect(within(row).queryByTestId("code-task-row-repository")).toBeNull();
  });

  test("no GitHub App on this server: what it needs, not a button that cannot work", async () => {
    delete process.env["GITHUB_APP_NAME"];
    repositoriesAre([]);

    draw(<CodePage {...PAGE_PROPS} />);

    expect(
      await screen.findByTestId("code-github-not-configured"),
    ).toHaveTextContent("GitHub App is not configured on this server");
    expect(screen.queryByRole("button", { name: "Connect GitHub" })).toBeNull();
  });

  test("on a plan without AI: the plan banner, and nothing read", async () => {
    setBilling(true);
    const planSpy: SpyInstance<() => PlanType | null> = jest
      .spyOn(ProjectUtil, "getCurrentPlan")
      .mockReturnValue(PlanType.Free);

    try {
      draw(<CodePage {...PAGE_PROPS} />);

      expect(
        await screen.findByText("AI requires the Growth plan"),
      ).toBeInTheDocument();
      expect(getRepositoriesMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId("code-home-loading")).toBeNull();
      expect(screen.queryByTestId("code-ask")).toBeNull();
    } finally {
      planSpy.mockRestore();
    }
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
        repositories: [CHECKOUT],
        tasksWithoutRepositoryCount: 0,
      } as never);
    getRepositoryMock.mockResolvedValue(repositoryAnswer() as never);
    listTasksMock.mockResolvedValue(tasksAnswer([]) as never);

    draw(<CodePage {...PAGE_PROPS} />);

    expect(
      await screen.findByText("Repositories are unavailable."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByText("Refresh?"));
    expect(await screen.findByTestId("code-ask")).toBeInTheDocument();
  });

  test("GitHub sent the browser back with a new installation: GitHub connected, and the repositories read again", async () => {
    window.history.pushState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/code?installation_id=51234567`,
    );
    repositoriesAre([CHECKOUT]);
    getRepositoryMock.mockResolvedValue(repositoryAnswer() as never);
    listTasksMock.mockResolvedValue(tasksAnswer([]) as never);

    draw(<CodePage {...PAGE_PROPS} />);

    expect(
      await screen.findByTestId("github-connected-notice"),
    ).toHaveTextContent("GitHub connected");
    await waitFor(() => {
      expect(getRepositoriesMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    // The address is cleaned, so a refresh does not say it again.
    expect(window.location.search).toBe("");
  });

  describe("as pure rules", () => {
    test("the box starts on the repository picked last, while it is there; else the most recently active connected one", () => {
      const quiet: CodeRepositoryListItem = {
        ...CHECKOUT,
        stats: { ...CHECKOUT.stats },
      };
      delete quiet.stats.lastActivityAt;

      expect(
        pickStartingRepository(
          [STOREFRONT, CHECKOUT, PAYMENTS],
          QUIET_REPOSITORY_ID,
        ),
      ).toBe(QUIET_REPOSITORY_ID);
      // Remembered, but gone: the most recently active connected one.
      expect(
        pickStartingRepository(
          [STOREFRONT, CHECKOUT, PAYMENTS],
          "11111111-1111-4111-8111-111111111111",
        ),
      ).toBe(REPOSITORY_ID);
      expect(
        pickStartingRepository([PAYMENTS, STOREFRONT, CHECKOUT], null),
      ).toBe(REPOSITORY_ID);
      // A repository AI cannot reach comes last, however recent.
      expect(
        pickStartingRepository(
          [
            {
              ...PAYMENTS,
              stats: {
                ...PAYMENTS.stats,
                lastActivityAt: "2026-10-20T00:00:00.000Z",
              },
            },
            STOREFRONT,
          ],
          null,
        ),
      ).toBe(OTHER_REPOSITORY_ID);
      // None reached: still one, so the box can say what connects it.
      expect(pickStartingRepository([PAYMENTS], null)).toBe(
        QUIET_REPOSITORY_ID,
      );
      // Equally quiet: by name.
      expect(
        pickStartingRepository(
          [
            { ...quiet, id: OTHER_REPOSITORY_ID, name: "zeta" },
            { ...quiet, name: "alpha" },
          ],
          null,
        ),
      ).toBe(REPOSITORY_ID);
      expect(pickStartingRepository([], null)).toBeNull();
    });

    test("the repository is remembered per project", () => {
      expect(getRememberedRepositoryKey(PROJECT_ID)).toBe(
        `oneuptime.code.repository.${PROJECT_ID}`,
      );
      expect(getRememberedRepositoryKey("a")).not.toBe(
        getRememberedRepositoryKey("b"),
      );
    });

    test("task rows across repositories are named from the repositories read", () => {
      expect(
        Array.from(getRepositoryNames([CHECKOUT, STOREFRONT]).entries()),
      ).toEqual([
        [REPOSITORY_ID, "checkout-api"],
        [OTHER_REPOSITORY_ID, "storefront-web"],
      ]);
    });

    test("connecting GitHub from the box: the install, why not, or nothing on a server with no GitHub App", () => {
      const connect: () => void = (): void => {};
      const connection: UseGitHubConnect = {
        isGitHubAppConfigured: true,
        connectLock: { isLocked: false },
        connect,
        connectExisting: () => {},
        notices: <></>,
      };

      expect(getConnectGitHubFix(connection)).toEqual({
        onConnect: connect,
        lockReason: undefined,
      });
      expect(
        getConnectGitHubFix({
          ...connection,
          connectLock: { isLocked: true, reason: "Not for you." },
        }),
      ).toEqual({ onConnect: connect, lockReason: "Not for you." });
      expect(
        getConnectGitHubFix({ ...connection, isGitHubAppConfigured: false }),
      ).toBeUndefined();
    });
  });
});

describe("Code's Repositories", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/code/repositories`);
  });

  test("while they load, rows in the making, and a screen reader hears Loading", () => {
    getRepositoriesMock.mockReturnValue(new Promise(() => {}) as never);
    draw(<CodeRepositoriesPage {...PAGE_PROPS} />);

    const loading: HTMLElement = screen.getByTestId(
      "code-repositories-loading",
    );
    expect(loading).toHaveAttribute("role", "status");
    expect(loading).toHaveTextContent("Loading…");
    expect(loading.querySelectorAll("[aria-hidden='true']")).toHaveLength(3);
  });

  test("a list, the most recently active first, then by name, counted - with Connect repositories", async () => {
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

    draw(<CodeRepositoriesPage {...PAGE_PROPS} />);

    const rows: Array<HTMLElement> = await screen.findAllByTestId(
      "code-repository-row",
    );
    expect(
      rows.map((row: HTMLElement) => {
        return within(row).getByTestId("code-repository-name").textContent;
      }),
    ).toEqual(["middle", "alpha", "zeta"]);
    expect(screen.getByTestId("code-repositories-count")).toHaveTextContent(
      "3 repositories",
    );
    expect(screen.getByTestId("code-connect-more")).toBeInTheDocument();
    // A few repositories need no search box, and GitHub reaches them.
    expect(screen.queryByTestId("code-repository-search")).toBeNull();
    expect(screen.queryByTestId("code-github-disconnected")).toBeNull();
  });

  test("one repository is counted as one", async () => {
    getRepositoriesMock.mockResolvedValue({
      repositories: [CHECKOUT],
      tasksWithoutRepositoryCount: 0,
    } as never);

    draw(<CodeRepositoriesPage {...PAGE_PROPS} />);

    expect(
      await screen.findByTestId("code-repositories-count"),
    ).toHaveTextContent(/^1 repository$/);
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

    draw(<CodeRepositoriesPage {...PAGE_PROPS} />);

    const search: HTMLElement = await screen.findByTestId(
      "code-repository-search",
    );
    expect(screen.getAllByTestId("code-repository-row")).toHaveLength(7);

    await userEvent.type(search, "PAYMENTS");
    expect(screen.getAllByTestId("code-repository-row")).toHaveLength(1);

    await userEvent.clear(search);
    await userEvent.type(search, "acme/store");
    expect(screen.getAllByTestId("code-repository-row")).toHaveLength(1);

    await userEvent.clear(search);
    await userEvent.type(search, "nothing like it");
    expect(screen.queryAllByTestId("code-repository-row")).toHaveLength(0);
    expect(
      screen.getByTestId("code-repository-search-empty"),
    ).toHaveTextContent("No repository matches your search.");
  });

  test("GitHub reaches none of them: said once over the list with Connect GitHub - not on every row", async () => {
    grant([Permission.ProjectUser, Permission.ProjectOwner]);
    getRepositoriesMock.mockResolvedValue({
      repositories: [
        { ...CHECKOUT, isConnected: false },
        { ...STOREFRONT, isConnected: false },
        PAYMENTS,
      ],
      tasksWithoutRepositoryCount: 0,
    } as never);
    const getSpy: SpyInstance<typeof API.get> = jest
      .spyOn(API, "get")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          {
            installUrl:
              "https://github.com/apps/oneuptime-app/installations/new",
          },
          {},
        ) as never,
      );

    draw(<CodeRepositoriesPage {...PAGE_PROPS} />);

    const banner: HTMLElement = await screen.findByTestId(
      "code-github-disconnected",
    );
    expect(banner).toHaveTextContent(
      "GitHub is not connected to this project, so AI cannot work in these repositories. Connect GitHub again to use them.",
    );
    expect(screen.getAllByTestId("code-repository-row")).toHaveLength(3);
    expect(screen.queryByTestId("code-repository-not-connected")).toBeNull();
    // One way to connect: the banner's, not a second button beside the count.
    expect(screen.queryByTestId("code-connect-more")).toBeNull();

    await userEvent.click(within(banner).getByTestId("code-github-reconnect"));
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalled();
    });
    expect(String(getSpy.mock.calls[0]?.[0]?.url)).toContain(
      "/github/install-url",
    );
  });

  test("someone who may not connect GitHub reads why, with no button", async () => {
    grant([Permission.ProjectUser, Permission.ReadCodeRepository]);
    getRepositoriesMock.mockResolvedValue({
      repositories: [PAYMENTS],
      tasksWithoutRepositoryCount: 0,
    } as never);

    draw(<CodeRepositoriesPage {...PAGE_PROPS} />);

    const banner: HTMLElement = await screen.findByTestId(
      "code-github-disconnected",
    );
    expect(within(banner).queryByTestId("code-github-reconnect")).toBeNull();
    expect(
      within(banner).getByTestId("code-github-disconnected-lock"),
    ).toHaveTextContent(
      "Connecting GitHub needs permission to create code repositories.",
    );
  });

  test("some repositories GitHub does not reach: each says so on its row", async () => {
    getRepositoriesMock.mockResolvedValue({
      repositories: [CHECKOUT, PAYMENTS],
      tasksWithoutRepositoryCount: 0,
    } as never);

    draw(<CodeRepositoriesPage {...PAGE_PROPS} />);

    await screen.findAllByTestId("code-repository-row");
    expect(screen.queryByTestId("code-github-disconnected")).toBeNull();
    expect(screen.getAllByTestId("code-repository-not-connected")).toHaveLength(
      1,
    );
  });

  test("no repository yet: what Code is for, and Connect GitHub", async () => {
    getRepositoriesMock.mockResolvedValue({
      repositories: [],
      tasksWithoutRepositoryCount: 0,
    } as never);

    draw(<CodeRepositoriesPage {...PAGE_PROPS} />);

    expect(await screen.findByTestId("code-connect-github")).toHaveTextContent(
      "Connect your code",
    );
    expect(screen.queryByTestId("code-repositories")).toBeNull();
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
        repositories: [CHECKOUT],
        tasksWithoutRepositoryCount: 0,
      } as never);

    draw(<CodeRepositoriesPage {...PAGE_PROPS} />);

    expect(
      await screen.findByText("Repositories are unavailable."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByText("Refresh?"));
    expect(
      await screen.findByTestId("code-repository-row"),
    ).toBeInTheDocument();
  });

  test("sorting, searching and the disconnected banner as pure rules", () => {
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

    expect(isGitHubDisconnected([])).toBe(false);
    expect(isGitHubDisconnected([PAYMENTS])).toBe(true);
    expect(isGitHubDisconnected([PAYMENTS, CHECKOUT])).toBe(false);
  });
});

describe("a repository's page: ask AI", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}`);
  });

  test("the same box, on this repository - only its branch is picked - its GitHub and branch above, its tasks below", async () => {
    getRepositoryMock.mockResolvedValue(repositoryAnswer() as never);
    listTasksMock.mockResolvedValue(tasksAnswer([summary()]) as never);

    draw(<CodeRepositoryTasks {...PAGE_PROPS} />);

    const ask: HTMLElement = await screen.findByTestId("code-ask");
    expect(within(ask).getByTestId("code-composer-input")).toBeEnabled();
    expect(
      within(ask).queryByTestId("code-repository-picker-button"),
    ).toBeNull();
    expect(
      within(ask).getByTestId("code-branch-picker-button"),
    ).toHaveTextContent("main");
    expect(ask).toHaveTextContent(
      "AI works on a new branch and opens a pull request for you to review when it changes code.",
    );
    expect(screen.queryByTestId("code-blocker")).toBeNull();
    expect(screen.queryByTestId("code-examples")).toBeNull();
    // The page read the repository once; the box asks nothing more.
    expect(getRepositoryMock).toHaveBeenCalledTimes(1);

    const header: HTMLElement = screen.getByTestId("code-repository-header");
    expect(
      within(header).getByRole("link", { name: "acme/checkout-api" }),
    ).toHaveAttribute("href", "https://github.com/acme/checkout-api");
    expect(header).toHaveTextContent("main");
    expect(screen.getByTestId("code-repository-description")).toHaveTextContent(
      "The checkout and payment API behind the store.",
    );

    const row: HTMLElement = await screen.findByTestId("code-task-row");
    expect(row).toHaveTextContent("Retry charges when the gateway times out");
    // Every row here is this repository's: none names it again.
    expect(within(row).queryByTestId("code-task-row-repository")).toBeNull();
    expect(listTasksMock).toHaveBeenCalledWith({
      scope: { repositoryId: REPOSITORY_ID },
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

  test("sending starts a task from the branch picked and opens its conversation", async () => {
    getRepositoryMock.mockResolvedValue(repositoryAnswer() as never);
    listTasksMock.mockResolvedValue(tasksAnswer([]) as never);
    getBranchesMock.mockResolvedValue({
      branches: ["main", "release/2026-10"],
      defaultBranch: "main",
      isComplete: true,
    } as never);
    createTaskMock.mockResolvedValue(NEW_TASK_ID as never);

    draw(<CodeRepositoryTasks {...PAGE_PROPS} />);

    await userEvent.click(
      await screen.findByTestId("code-branch-picker-button"),
    );
    await waitFor(() => {
      expect(pickerOptions("code-branch-picker")).toHaveLength(2);
    });
    await userEvent.click(pickerOptions("code-branch-picker")[1]!);
    await userEvent.type(
      screen.getByTestId("code-composer-input"),
      "Add an index on orders.customer_id{Enter}",
    );

    expect(createTaskMock).toHaveBeenCalledWith({
      repositoryId: REPOSITORY_ID,
      message: "Add an index on orders.customer_id",
      context: [],
      branch: "release/2026-10",
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
    listTasksMock.mockResolvedValue(tasksAnswer([]) as never);
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

  test("whatever stops AI is said at the top of the box, which waits and offers no examples", async () => {
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
          message:
            "No global Runner is online to work in this repository. Pick one of your Runners for it in the repository's settings in Code, or try again once the global Runner is back.",
        },
      }) as never,
    );

    draw(<CodeRepositoryTasks {...PAGE_PROPS} />);

    const notice: HTMLElement = await screen.findByTestId(
      "code-composer-notice",
    );
    expect(within(notice).getByTestId("code-blocker")).toHaveAttribute(
      "data-blocker",
      "NoAgent",
    );
    expect(screen.getByTestId("code-composer-input")).toBeDisabled();
    expect(screen.queryByTestId("code-examples")).toBeNull();
  });

  test("on a plan without AI, the plan is said once - in the box, with the link that upgrades it", async () => {
    setBilling(true);
    const planSpy: SpyInstance<() => PlanType | null> = jest
      .spyOn(ProjectUtil, "getCurrentPlan")
      .mockReturnValue(PlanType.Free);
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer({
        blocker: {
          type: CodeTaskBlockerType.PlanRequired,
          message: "AI in Code needs the Growth plan or above.",
        },
      }) as never,
    );
    listTasksMock.mockResolvedValue(tasksAnswer([summary()]) as never);

    try {
      draw(<CodeRepositoryTasks {...PAGE_PROPS} />);

      const notice: HTMLElement = await screen.findByTestId("code-blocker");
      expect(notice).toHaveAttribute("data-blocker", "PlanRequired");
      expect(within(notice).getByTestId("code-blocker-fix")).toHaveTextContent(
        "Upgrade the plan",
      );
      // No plan banner above it saying the same again.
      expect(screen.queryByText("AI requires the Growth plan")).toBeNull();
      expect(screen.getAllByText(/Growth plan/)).toHaveLength(1);
    } finally {
      planSpy.mockRestore();
    }
  });

  test("a box that cannot send says nothing about how to send", async () => {
    getRepositoryMock.mockResolvedValue(
      repositoryAnswer({
        blocker: {
          type: CodeTaskBlockerType.DailyLimitReached,
          message: "This project used its daily AI token limit.",
        },
      }) as never,
    );
    listTasksMock.mockResolvedValue(tasksAnswer([summary()]) as never);

    draw(<CodeRepositoryTasks {...PAGE_PROPS} />);

    expect(await screen.findByTestId("code-blocker")).toHaveTextContent(
      "This project used its daily AI token limit.",
    );
    expect(screen.getByTestId("code-composer-input")).toBeDisabled();
    expect(screen.queryByTestId("code-composer-keys")).toBeNull();
    expect(screen.queryByTestId("code-ask-footer")).toBeNull();
  });

  test("a member who may only read: the reason on its own, no box, and the tasks - or where they will show", async () => {
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
    listTasksMock.mockResolvedValue(tasksAnswer([]) as never);

    draw(<CodeRepositoryTasks {...PAGE_PROPS} />);

    const ask: HTMLElement = await screen.findByTestId("code-ask");
    expect(within(ask).getByTestId("code-blocker")).toHaveAttribute(
      "data-blocker",
      "NoPermission",
    );
    expect(screen.queryByTestId("code-composer-input")).toBeNull();
    expect(screen.queryByTestId("code-branch-picker-button")).toBeNull();
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
    listTasksMock.mockResolvedValue(tasksAnswer([]) as never);

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

  test("its state, number, title, repository, branch and pull request; then the conversation; then the box to reply", async () => {
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
    expect(within(header).getByTestId("code-task-repository")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/repositories/${REPOSITORY_ID}`,
    );
    expect(
      within(header).getByTestId("code-task-repository"),
    ).toHaveTextContent("acme/checkout-api");
    // The branch it works from: the repository's main one, none picked.
    expect(within(header).getByTestId("code-task-branch")).toHaveTextContent(
      "main",
    );
    const pullRequest: HTMLElement = screen.getByTestId(
      "code-task-pull-request",
    );
    expect(pullRequest).toHaveAttribute(
      "href",
      "https://github.com/acme/checkout-api/pull/418",
    );
    expect(pullRequest).toHaveTextContent("Pull request #418");
    expect(pullRequest).toHaveAttribute("target", "_blank");
    // A request has no kind pill: its title is what was asked.
    expect(header).not.toHaveTextContent("Request");
    // A task that changed nothing says nothing about lines.
    expect(screen.queryByTestId("code-task-changes-stat")).toBeNull();

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
    // A reply goes to this task: no repository or branch to pick.
    expect(
      within(composer).queryByTestId("code-repository-picker-button"),
    ).toBeNull();
    expect(
      within(composer).queryByTestId("code-branch-picker-button"),
    ).toBeNull();
  });

  test("how much it changed is said at the top, in lines added and removed", async () => {
    getTaskMock.mockResolvedValue(
      taskAnswer({
        task: summary({ changes: { files: 3, additions: 27, deletions: 1 } }),
      }) as never,
    );

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    const stat: HTMLElement = await screen.findByTestId(
      "code-task-changes-stat",
    );
    expect(stat).toHaveTextContent("+27−1");
    expect(stat).toHaveAttribute(
      "aria-label",
      "Lines added: 27, lines removed: 1",
    );
    expect(screen.getByTestId("code-task-facts")).toContainElement(stat);
  });

  test("a task started from a branch the person picked works from that branch, and says so", async () => {
    getTaskMock.mockResolvedValue(
      taskAnswer({
        turns: [
          turn({
            request: {
              message: "Backport the retry fix",
              context: [],
              baseBranch: "release/2026-10",
            },
          }),
        ],
      }) as never,
    );

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    expect(await screen.findByTestId("code-task-branch")).toHaveTextContent(
      "release/2026-10",
    );
  });

  test("the branch a task works from, as a pure rule", () => {
    expect(getTaskBaseBranch(taskAnswer() as never)).toBe("main");
    expect(
      getTaskBaseBranch({
        turns: [
          turn({
            request: { message: "x", context: [], baseBranch: "dev" },
          }),
          turn({
            request: { message: "y", context: [], baseBranch: "other" },
          }),
        ],
        repository: null,
      }),
    ).toBe("dev");
    expect(getTaskBaseBranch({ turns: [], repository: null })).toBe("");
  });

  test("a merged pull request says so at the top, and replies go to a new one", async () => {
    getTaskMock.mockResolvedValue(
      taskAnswer({
        task: summary({
          pullRequest: {
            number: 402,
            url: "https://github.com/acme/checkout-api/pull/402",
            state: "merged",
          },
        }),
      }) as never,
    );

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    const header: HTMLElement = await screen.findByTestId("code-task-header");
    expect(
      within(header).getByTestId("code-task-pull-request-state"),
    ).toHaveTextContent("Merged");
    expect(screen.getByTestId("code-task-pull-request")).toHaveAttribute(
      "href",
      "https://github.com/acme/checkout-api/pull/402",
    );

    const footer: HTMLElement = screen.getByTestId("code-task-composer-footer");
    expect(footer).toHaveTextContent(
      "AI works on a new branch and opens a pull request for you to review when it changes code.",
    );
    expect(footer).not.toHaveTextContent("#402");
  });

  test("an open pull request needs no word for its state", async () => {
    getTaskMock.mockResolvedValue(taskAnswer() as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    await screen.findByTestId("code-task-pull-request");
    expect(screen.queryByTestId("code-task-pull-request-state")).toBeNull();
  });

  test("a task with no pull request has no pull request button", async () => {
    getTaskMock.mockResolvedValue(taskAnswer({ task: summary() }) as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    await screen.findByTestId("code-task-header");
    expect(screen.queryByTestId("code-task-pull-request")).toBeNull();
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

  test("the reply box is held at the bottom of the window, on the page's own ground", async () => {
    getTaskMock.mockResolvedValue(taskAnswer() as never);

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    const footer: HTMLElement = await screen.findByTestId("code-task-footer");
    expect(footer.className.split(" ")).toEqual(
      expect.arrayContaining(["sticky", "bottom-0"]),
    );
    /*
     * The theme's canvas, light or dark - not a gray of its own (jsdom drops
     * a var() colour, so the style itself is read; the browser suite reads
     * the colour drawn).
     */
    expect(STICKY_FOOTER_STYLE).toEqual({
      backgroundColor: "var(--ou-background-primary)",
    });
    expect(footer).toContainElement(screen.getByTestId("code-task-composer"));
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
    // Stop stays in reach while the conversation scrolls.
    expect(screen.getByTestId("code-task-footer")).toContainElement(footer);

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

  test("a failed Stop or Try again says why, above the conversation", async () => {
    getTaskMock.mockResolvedValue(
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
    );
    retryMock.mockRejectedValue(
      new HTTPErrorResponse(
        400,
        { message: "This project's AI credits are used up." },
        {},
      ) as never,
    );

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    await userEvent.click(await screen.findByTestId("code-turn-retry"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This project's AI credits are used up.",
    );
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

  test("whatever stops AI is said at the top of the reply box, which waits", async () => {
    getTaskMock.mockResolvedValue(
      taskAnswer({
        blocker: {
          type: CodeTaskBlockerType.AiDisabled,
          message: "AI is off.",
        },
      }) as never,
    );

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    const notice: HTMLElement = await screen.findByTestId(
      "code-composer-notice",
    );
    expect(within(notice).getByTestId("code-blocker")).toHaveAttribute(
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

    const notice: HTMLElement = await screen.findByTestId(
      "code-task-no-repository",
    );
    expect(notice).toHaveTextContent(
      "This task is not linked to a repository, so AI cannot continue it.",
    );
    // A box of its own on the page's gray, not gray on gray.
    expect(notice.className).toContain("border");
    expect(notice.className).toContain("bg-white");
    expect(screen.queryByTestId("code-composer-input")).toBeNull();
    // No repository, so no repository or branch at the top.
    expect(screen.queryByTestId("code-task-repository")).toBeNull();
    expect(screen.queryByTestId("code-task-branch")).toBeNull();
  });

  test("while AI works, the box's place says what that means - one spinner on the page, in the turn", async () => {
    getTaskMock.mockResolvedValue(
      taskAnswer({
        task: summary({ state: CodeTaskState.Working }),
        turns: [
          turn({
            status: AIRunStatus.Running,
            state: CodeTaskState.Working,
            completedAt: undefined,
            steps: [
              {
                sequence: 1,
                kind: "Read" as never,
                subject: "src/a.ts",
                isError: false,
              },
            ],
          }),
        ],
      }) as never,
    );

    draw(<CodeTaskConversation {...PAGE_PROPS} />);

    const footer: HTMLElement = await screen.findByTestId(
      "code-task-working-footer",
    );
    expect(footer).toHaveTextContent(
      "AI is working on this. You can reply when it finishes.",
    );
    expect(footer.querySelector(".motion-safe\\:animate-spin")).toBeNull();
    expect(
      document.querySelectorAll(".motion-safe\\:animate-spin"),
    ).toHaveLength(1);
  });

  test("a turn's Log: the trail names the repository and the task, then Log - and each model call's tokens count as the AI Logs count them", async () => {
    getTaskMock.mockResolvedValue(taskAnswer() as never);
    const postSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          {
            run: { _id: TASK_ID, status: AIRunStatus.Completed },
            events: [],
            llmLogs: [
              {
                _id: "9e8d7c6b-5a49-4382-9716-a5b4c3d2e1f0",
                modelName: "claude-opus-5-5",
                llmProviderName: "Anthropic",
                status: "Success",
                // 10,000 in all: 8,000 read from the cache, 1,000 written to it.
                totalTokens: 10000,
                cachedInputTokens: 8000,
                cacheCreationTokens: 1000,
                durationMs: 1200,
              },
            ],
            canReadContent: true,
          },
          {},
        ) as never,
      );
    const trails: Array<Array<Link> | null> = [];

    try {
      render(
        <I18nextProvider i18n={translation}>
          <PageBreadcrumbsContext.Provider
            value={(links: Array<Link> | null) => {
              trails.push(links);
            }}
          >
            <MemoryRouter
              initialEntries={[
                `/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}/log`,
              ]}
            >
              <Routes>
                <RouterRoute
                  path="/dashboard/:projectId/code/tasks/:id/log"
                  element={<CodeTaskLog {...PAGE_PROPS} />}
                />
              </Routes>
            </MemoryRouter>
          </PageBreadcrumbsContext.Provider>
        </I18nextProvider>,
      );

      await waitFor(() => {
        expect(
          (trails[trails.length - 1] || []).map((link: Link) => {
            return link.title;
          }),
        ).toEqual(["Project", "Code", "checkout-api", "Task #12", "Log"]);
      });
      expect(getTaskMock).toHaveBeenCalledWith(TASK_ID);
      const trail: Array<Link> = trails[trails.length - 1] || [];
      expect(trail[1]?.to.toString()).toBe(`/dashboard/${PROJECT_ID}/code`);
      expect(trail[3]?.to.toString()).toBe(
        `/dashboard/${PROJECT_ID}/code/tasks/${TASK_ID}`,
      );
      expect(trail[2]?.isRecordName).toBe(true);

      /*
       * 1,000 fresh + a tenth of 8,000 read from the cache + one and a
       * quarter of 1,000 written to it: 1,000 + 800 + 1,250.
       */
      expect(
        await screen.findByTestId("code-log-call-tokens"),
      ).toHaveTextContent("3,050 tokens");
    } finally {
      postSpy.mockRestore();
    }
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
