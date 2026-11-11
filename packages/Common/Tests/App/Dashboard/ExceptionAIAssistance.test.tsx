import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { EXCEPTION_AI_HOW_IT_WORKS_STEPS } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionAIAssistance";
import ExceptionAIAssistance, {
  AI_TASK_POLL_INTERVAL_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionAIAssistance";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";

/*
 * The Fix with AI page reads the setup checklist and the latest task of each
 * type, then leads with one task - Fix with AI, a fix of the code or better
 * handling of an expected error, by OneUptime AI's triage verdict - and folds
 * the others under Other AI tasks. These tests drive it through the API
 * boundary only.
 */

const EXCEPTION_ID: string = "50000000-0000-4000-8000-000000000001";
const TASK_ID: string = "70000000-0000-4000-8000-000000000001";

type RequestArgs = { url: { toString: () => string }; data?: JSONObject };

const getMock: Mock<(args: RequestArgs) => Promise<unknown>> =
  jest.fn<(args: RequestArgs) => Promise<unknown>>();
const postMock: Mock<(args: RequestArgs) => Promise<unknown>> =
  jest.fn<(args: RequestArgs) => Promise<unknown>>();
const navigateMock: Mock<(route: Route) => void> =
  jest.fn<(route: Route) => void>();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (args: RequestArgs): Promise<unknown> => {
        return getMock(args);
      },
      post: (args: RequestArgs): Promise<unknown> => {
        return postMock(args);
      },
      getFriendlyMessage: (error: unknown): string => {
        if (error instanceof HTTPErrorResponse) {
          return String((error.data as JSONObject)?.["message"] || "Failed");
        }
        return error instanceof Error ? error.message : "Failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (route: Route): void => {
        navigateMock(route);
      },
    },
  };
});

/*
 * Routes are populated with the current project id; the selected project is
 * not loaded (read as AI on) unless a test switches AI off.
 */
let mockCurrentProject: { enableAi?: boolean } | null = null;

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): ObjectID => {
        return new ObjectID("10000000-0000-4000-8000-000000000001");
      },
      getCurrentProject: (): { enableAi?: boolean } | null => {
        return mockCurrentProject;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): JSONObject => {
        return {};
      },
    },
  };
});

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

interface ApiState {
  ready: boolean;
  checks: Array<JSONObject>;
  tasks: Array<JSONObject>;
  readinessFails?: boolean;
  createFails?: boolean;
}

let state: ApiState;

function ok(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse(200, data, {});
}

function task(
  taskType: string,
  status: string,
  statusMessage?: string,
): JSONObject {
  return {
    _id: TASK_ID,
    taskType,
    status,
    statusTitle: status,
    statusDescription: `${status} description`,
    ...(statusMessage ? { statusMessage } : {}),
    createdAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
  };
}

const READY_CHECKS: Array<JSONObject> = [
  { id: "llmProvider", ok: true, title: "LLM provider", detail: "" },
  {
    id: "repositoryConnected",
    ok: true,
    title: "GitHub repository",
    detail: "",
  },
  { id: "agentAvailable", ok: true, title: "AI agent online", detail: "" },
];

beforeEach(() => {
  state = { ready: true, checks: READY_CHECKS, tasks: [] };
  // A project member: they may edit the repositories AI tasks work in.
  grant([Permission.ProjectUser, Permission.ProjectMember]);
  getMock.mockReset();
  postMock.mockReset();
  navigateMock.mockReset();

  getMock.mockImplementation(async (args: RequestArgs): Promise<unknown> => {
    const url: string = args.url.toString();

    if (url.includes("/ai-fix-readiness/")) {
      if (state.readinessFails) {
        throw new Error("readiness down");
      }
      return ok({ ready: state.ready, checks: state.checks });
    }

    if (url.includes("/get-ai-agent-task/")) {
      return ok({ aiAgentTasks: state.tasks });
    }

    throw new Error(`Unexpected GET ${url}`);
  });

  postMock.mockImplementation(async (args: RequestArgs): Promise<unknown> => {
    const url: string = args.url.toString();

    if (url.includes("/create-ai-agent-task/")) {
      if (state.createFails) {
        return new HTTPErrorResponse(
          400,
          { message: "No AI agent is online for this project." },
          {},
        );
      }
      return ok({ aiAgentTaskId: TASK_ID });
    }

    throw new Error(`Unexpected POST ${url}`);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/*
 * The signed-in person's permissions, as the permission snapshot hands them
 * to every gate - or (null) a snapshot that has not arrived yet.
 */
function grant(permissions: Array<Permission> | null): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue(permissions || []);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(
    permissions
      ? {
          projectId: new ObjectID("10000000-0000-4000-8000-000000000001"),
          userId: ObjectID.generate(),
          permissions: permissions.map((permission: Permission) => {
            return {
              permission: permission,
              labelIds: [],
              _type: "UserPermission",
            };
          }),
          _type: "UserTenantAccessPermission",
        }
      : null,
  );
}

async function renderAssistance(
  props: {
    isResolved?: boolean;
    isArchived?: boolean;
    errorClass?: string;
  } = {},
): Promise<void> {
  render(
    <MemoryRouter>
      <ExceptionAIAssistance
        telemetryExceptionId={new ObjectID(EXCEPTION_ID)}
        isResolved={Boolean(props.isResolved)}
        isArchived={Boolean(props.isArchived)}
        errorClass={props.errorClass}
      />
    </MemoryRouter>,
  );

  await screen.findByTestId("exception-ai-assistance");
}

// A task, by its type: Fix with AI's section, or a row of Other AI tasks.
function card(taskType: string): HTMLElement {
  return screen.getByTestId(`exception-ai-task-${taskType}`);
}

function otherTasks(): HTMLElement {
  return screen.getByTestId("exception-ai-other-tasks");
}

// Opens Other AI tasks, as a reader does, when it is folded.
function openOtherTasks(): void {
  if (otherTasks().getAttribute("data-collapsed") === "true") {
    fireEvent.click(within(otherTasks()).getByTestId("folded-section-header"));
  }

  expect(otherTasks()).toHaveAttribute("data-collapsed", "false");
}

describe("ExceptionAIAssistance", () => {
  /*
   * With the project's AI switched off the page says so as Code does (the
   * tasks it starts are Code's), with the one step that changes it, and
   * nothing else: no task cards, nothing to start.
   */
  describe("with the project's AI switched off", () => {
    afterEach(() => {
      mockCurrentProject = null;
    });

    function expectNothingToStart(): void {
      expect(screen.queryByTestId("exception-ai-ready")).toBeNull();
      expect(screen.queryByTestId("exception-ai-task-FixException")).toBeNull();
      expect(screen.queryByTestId("exception-ai-task-start")).toBeNull();
    }

    test("someone who may turn AI on is offered Turn AI on, to AI Features", async () => {
      mockCurrentProject = { enableAi: false };
      grant([Permission.ProjectUser, Permission.ProjectOwner]);
      await renderAssistance();

      const notice: HTMLElement = screen.getByTestId("exception-ai-off");
      expect(notice).toHaveTextContent("AI is turned off for this project.");
      const link: HTMLElement = within(notice).getByTestId("code-blocker-fix");
      expect(link).toHaveTextContent("Turn AI on");
      expect(
        (link.getAttribute("href") || "").endsWith("/settings/ai-features"),
      ).toBe(true);
      expect(within(notice).queryByTestId("code-blocker-who-can")).toBeNull();
      expectNothingToStart();
    });

    test("everyone else is told who can turn it on", async () => {
      mockCurrentProject = { enableAi: false };
      grant([Permission.ProjectUser, Permission.ProjectMember]);
      await renderAssistance();

      const notice: HTMLElement = screen.getByTestId("exception-ai-off");
      expect(notice).toHaveTextContent("AI is turned off for this project.");
      expect(within(notice).queryByTestId("code-blocker-fix")).toBeNull();
      expect(
        within(notice).getByTestId("code-blocker-who-can"),
      ).toHaveTextContent(
        "A project owner or someone with Manage Billing can turn AI on in Project Settings → AI → AI Features.",
      );
      expectNothingToStart();
    });

    test("before the permissions arrive, the sentence alone", async () => {
      mockCurrentProject = { enableAi: false };
      grant(null);
      await renderAssistance();

      const notice: HTMLElement = screen.getByTestId("exception-ai-off");
      expect(notice).toHaveTextContent("AI is turned off for this project.");
      expect(within(notice).queryByTestId("code-blocker-fix")).toBeNull();
      expect(within(notice).queryByTestId("code-blocker-who-can")).toBeNull();
      expectNothingToStart();
    });
  });

  /*
   * One task, not three (#6855): "Fix with AI", with what it will do and
   * how it works said right there, and the other tasks folded under it.
   */
  test("leads with one task, Fix with AI, ready to start, and says how it works", async () => {
    await renderAssistance();

    const fix: HTMLElement = card("FixException");

    expect(fix).toHaveAttribute("data-primary", "true");
    expect(fix.tagName).toBe("SECTION");
    expect(fix).toHaveAttribute("aria-label", "Fix with AI");
    expect(
      within(fix).getByRole("heading", { level: 2, name: "Fix with AI" }),
    ).toBeInTheDocument();
    expect(
      within(fix).getByTestId("exception-ai-task-status"),
    ).toHaveTextContent("Not started");
    expect(
      within(fix).getByTestId("exception-ai-task-description"),
    ).toHaveTextContent(
      "OneUptime AI finds the root cause of this exception in your code, fixes it, and opens a pull request for you to review.",
    );

    const start: HTMLElement = within(fix).getByTestId(
      "exception-ai-task-start",
    );

    expect(start).toHaveTextContent("Fix with AI");
    expect(start).not.toBeDisabled();
    expect(
      within(fix).queryByTestId("exception-ai-task-view"),
    ).not.toBeInTheDocument();

    // How it works: three steps, in order, under the task.
    const howItWorks: HTMLElement = within(fix).getByTestId(
      "exception-ai-how-it-works",
    );

    const steps: HTMLElement = howItWorks.querySelector("ol") as HTMLElement;

    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((step: HTMLElement) => {
          return step.textContent;
        }),
    ).toEqual(
      EXCEPTION_AI_HOW_IT_WORKS_STEPS.map((step: string, index: number) => {
        return `${index + 1}${step}`;
      }),
    );
    // Everything set up: one quiet line under it, not a card of its own.
    expect(
      within(howItWorks).getByTestId("exception-ai-ready"),
    ).toHaveTextContent("AI is ready to work on this exception");

    // Only one task leads: one primary button on the page.
    expect(screen.getAllByTestId("exception-ai-task-start")).toHaveLength(3);
    expect(
      screen
        .queryAllByTestId(/^exception-ai-task-/)
        .filter((element: HTMLElement) => {
          return element.getAttribute("data-primary") === "true";
        }),
    ).toEqual([fix]);

    expect(getMock).toHaveBeenCalledTimes(2);
  });

  test("the other tasks wait, folded, under Other AI tasks, each with a plain Start", async () => {
    await renderAssistance();

    expect(otherTasks()).toHaveAttribute("data-collapsed", "true");
    expect(
      within(otherTasks()).getByTestId("folded-section-title"),
    ).toHaveTextContent("Other AI tasks");

    openOtherTasks();

    for (const [taskType, title] of [
      ["ImproveExceptionHandling", "Handle the error better"],
      ["WriteRegressionTest", "Write a regression test"],
    ] as Array<[string, string]>) {
      const row: HTMLElement = card(taskType);

      expect(otherTasks()).toContainElement(row);
      expect(row).not.toHaveAttribute("data-primary");
      expect(
        within(row).getByRole("heading", { level: 3, name: title }),
      ).toBeInTheDocument();
      // Not started: no pill for a task that never ran.
      expect(within(row).queryByTestId("exception-ai-task-status")).toBeNull();
      expect(
        within(row).getByTestId("exception-ai-task-start"),
      ).toHaveTextContent("Start");
    }

    // The other fix first, then the test.
    expect(
      within(otherTasks())
        .getAllByRole("listitem")
        .map((row: HTMLElement) => {
          return row.getAttribute("data-testid");
        }),
    ).toEqual([
      "exception-ai-task-ImproveExceptionHandling",
      "exception-ai-task-WriteRegressionTest",
    ]);
  });

  test.each([
    ["user-error", "an expected error"],
    ["expected-denial", "an intentional denial"],
  ])(
    "for %s (%s) Fix with AI handles the error better, and fixing the code waits in the fold",
    async (errorClass: string) => {
      await renderAssistance({ errorClass });

      const fix: HTMLElement = card("ImproveExceptionHandling");

      expect(fix).toHaveAttribute("data-primary", "true");
      expect(
        within(fix).getByRole("heading", { level: 2, name: "Fix with AI" }),
      ).toBeInTheDocument();
      expect(
        within(fix).getByTestId("exception-ai-task-description"),
      ).toHaveTextContent(/expected error/);
      expect(
        within(fix).getByTestId("exception-ai-task-start"),
      ).toHaveTextContent("Fix with AI");

      openOtherTasks();

      expect(otherTasks()).toContainElement(card("FixException"));
      expect(
        within(card("FixException")).getByRole("heading", {
          name: "Fix the code",
        }),
      ).toBeInTheDocument();
    },
  );

  test.each([["code-fault"], ["infrastructure"], ["unknown"], [""]])(
    "for any other verdict (%j) Fix with AI fixes the code",
    async (errorClass: string) => {
      await renderAssistance({ errorClass });

      expect(card("FixException")).toHaveAttribute("data-primary", "true");
      expect(card("ImproveExceptionHandling")).not.toHaveAttribute(
        "data-primary",
      );
    },
  );

  test("Fix with AI's confirmation says what it will do, and starts it", async () => {
    await renderAssistance();

    fireEvent.click(
      within(card("FixException")).getByTestId("exception-ai-task-start"),
    );

    expect(screen.getByTestId("modal-title")).toHaveTextContent("Fix with AI");
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "OneUptime AI finds the root cause of this exception in your code",
    );
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Fix with AI",
    );

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledTimes(1);
    });
    expect(postMock.mock.calls[0]![0].data).toEqual({});
  });

  test("starting a task asks for confirmation, sends the task type and opens the task", async () => {
    await renderAssistance();

    openOtherTasks();

    fireEvent.click(
      within(card("WriteRegressionTest")).getByTestId(
        "exception-ai-task-start",
      ),
    );

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Write a regression test",
    );
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Start",
    );
    expect(postMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledTimes(1);
    });

    expect(postMock.mock.calls[0]![0].url.toString()).toContain(
      `/telemetry-exception/create-ai-agent-task/${EXCEPTION_ID}`,
    );
    expect(postMock.mock.calls[0]![0].data).toEqual({
      taskType: "WriteRegressionTest",
    });
    expect(navigateMock.mock.calls[0]![0].toString()).toContain(TASK_ID);
  });

  test("a fix task is created with an empty body for older servers", async () => {
    await renderAssistance();

    fireEvent.click(
      within(card("FixException")).getByTestId("exception-ai-task-start"),
    );
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });
    expect(postMock.mock.calls[0]![0].data).toEqual({});
  });

  test("cancelling the confirmation creates nothing", async () => {
    await renderAssistance();

    fireEvent.click(
      within(card("FixException")).getByTestId("exception-ai-task-start"),
    );
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    expect(postMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("modal-footer-submit-button"),
    ).not.toBeInTheDocument();
  });

  test("a failed create shows the reason inline and re-reads the checklist", async () => {
    state.createFails = true;
    await renderAssistance();

    fireEvent.click(
      within(card("FixException")).getByTestId("exception-ai-task-start"),
    );
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    expect(
      await screen.findByText("No AI agent is online for this project."),
    ).toBeInTheDocument();
    expect(screen.getByText("Could not start AI task")).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();

    const readinessCalls: number = getMock.mock.calls.filter(
      (call: [RequestArgs]) => {
        return call[0].url.toString().includes("/ai-fix-readiness/");
      },
    ).length;
    expect(readinessCalls).toBe(2);
  });

  test("an incomplete setup shows the checklist with fix links and locks the start buttons", async () => {
    state.ready = false;
    state.checks = [
      { id: "llmProvider", ok: true, title: "LLM provider", detail: "" },
      {
        id: "repositoryConnected",
        ok: false,
        title: "GitHub repository",
        detail: "Connect a repository through the GitHub App.",
      },
      {
        id: "agentAvailable",
        ok: false,
        title: "AI agent online",
        detail: "No agent is available for this project.",
      },
    ];
    await renderAssistance();

    expect(
      screen.getByRole("heading", { name: "Set up AI for this exception" }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("exception-ai-readiness-progress"),
    ).toHaveTextContent("1 of 3 ready");
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "1",
    );

    const repository: HTMLElement = screen.getByTestId(
      "exception-ai-readiness-repositoryConnected",
    );
    expect(repository).toHaveAttribute("data-ok", "false");
    expect(repository).toHaveTextContent(
      "Connect a repository through the GitHub App.",
    );
    expect(
      within(repository).getByRole("link", {
        name: "Connect a Code Repository",
      }),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByTestId("exception-ai-readiness-agentAvailable"),
      ).getByRole("link", { name: "Set up a Runner" }),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByTestId("exception-ai-readiness-llmProvider"),
      ).queryByRole("link"),
    ).not.toBeInTheDocument();

    for (const taskType of [
      "FixException",
      "WriteRegressionTest",
      "ImproveExceptionHandling",
    ]) {
      expect(
        within(card(taskType)).getByTestId("exception-ai-task-start"),
      ).toBeDisabled();
    }
  });

  test("fails open when the checklist cannot be read", async () => {
    state.readinessFails = true;
    await renderAssistance();

    expect(screen.queryByTestId("exception-ai-ready")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Set up AI for this exception" }),
    ).not.toBeInTheDocument();
    expect(
      within(card("FixException")).getByTestId("exception-ai-task-start"),
    ).not.toBeDisabled();
  });

  test("a failed task offers a retry and a link to the task, its fold open by itself", async () => {
    state.tasks = [
      task(
        "ImproveExceptionHandling",
        "Error",
        "The agent stopped responding after 20 minutes.",
      ),
    ];
    await renderAssistance();

    // A task of the fold ran: the fold is open, and says how it went.
    expect(otherTasks()).toHaveAttribute("data-collapsed", "false");

    const taskCard: HTMLElement = card("ImproveExceptionHandling");
    expect(
      within(taskCard).getByTestId("exception-ai-task-status"),
    ).toHaveTextContent("Failed");
    expect(
      within(taskCard).getByTestId("exception-ai-task-message"),
    ).toHaveTextContent("The agent stopped responding after 20 minutes.");
    expect(
      within(taskCard).getByTestId("exception-ai-task-message"),
    ).toHaveTextContent("Latest task started 18 minutes ago");
    expect(
      within(taskCard).getByTestId("exception-ai-task-start"),
    ).toHaveTextContent("Try again");

    fireEvent.click(within(taskCard).getByTestId("exception-ai-task-view"));
    expect(navigateMock.mock.calls[0]![0].toString()).toContain(TASK_ID);
  });

  test("a completed task can be viewed and run again", async () => {
    state.tasks = [task("FixException", "Completed")];
    await renderAssistance();

    const taskCard: HTMLElement = card("FixException");
    expect(
      within(taskCard).getByTestId("exception-ai-task-status"),
    ).toHaveTextContent("Completed");
    expect(
      within(taskCard).getByTestId("exception-ai-task-start"),
    ).toHaveTextContent("Fix again");
    expect(
      within(taskCard).getByTestId("exception-ai-task-view"),
    ).toBeInTheDocument();
    // Its own task does not open the fold: the others never ran.
    expect(otherTasks()).toHaveAttribute("data-collapsed", "true");
  });

  test("a fold whose task ran names its status while it is folded", async () => {
    state.tasks = [
      { ...task("WriteRegressionTest", "Completed"), _id: TASK_ID },
    ];
    await renderAssistance();

    // Open by itself, so fold it to read what it says folded.
    fireEvent.click(within(otherTasks()).getByTestId("folded-section-header"));

    expect(otherTasks()).toHaveAttribute("data-collapsed", "true");

    const header: HTMLElement = within(otherTasks()).getByTestId(
      "folded-section-header",
    );

    expect(header).toHaveTextContent("Write a regression test");
    expect(header).toHaveTextContent("Completed");
  });

  /*
   * Merged is not fixed: a completed fix says what production showed once
   * it shipped - fixed (green), still happening (red), or not yet known.
   */
  test("a merged fix says whether production showed it fixed", async () => {
    state.tasks = [
      {
        ...task("FixException", "Completed"),
        production: {
          status: "Verified",
          summary:
            "No occurrence in the 24 hours since version 2.3.2 shipped the fix; before the fix it happened 21 times in 7 days.",
          statusAt: new Date().toISOString(),
          deployedVersion: "2.3.2",
        },
      },
    ];
    await renderAssistance();

    const production: HTMLElement = within(card("FixException")).getByTestId(
      "exception-ai-task-production",
    );
    expect(production).toHaveTextContent("Fixed in production");
    expect(production).toHaveTextContent(
      "No occurrence in the 24 hours since version 2.3.2 shipped the fix",
    );
    expect(production.className).toContain("bg-emerald-50");
  });

  test("a fix that did not stop the exception says so, in red", async () => {
    state.tasks = [
      {
        ...task("FixException", "Completed"),
        production: {
          status: "Regressed",
          summary:
            "The exception happened 3 times after version 2.3.2 shipped the fix, so the fix did not stop it.",
        },
      },
    ];
    await renderAssistance();

    const production: HTMLElement = within(card("FixException")).getByTestId(
      "exception-ai-task-production",
    );
    expect(production).toHaveTextContent("Still happening after the fix");
    expect(production.className).toContain("bg-red-50");
  });

  test("a task with no production verdict shows none", async () => {
    state.tasks = [task("FixException", "Completed")];
    await renderAssistance();

    expect(
      within(card("FixException")).queryByTestId(
        "exception-ai-task-production",
      ),
    ).toBeNull();
  });

  test("polls while a task is active and stops once it finishes", async () => {
    jest.useFakeTimers();
    state.tasks = [task("FixException", "Running", "Reading the code")];
    await renderAssistance();

    const taskCard: HTMLElement = card("FixException");
    expect(
      within(taskCard).getByTestId("exception-ai-task-status"),
    ).toHaveTextContent("In progress");
    expect(
      within(taskCard).queryByTestId("exception-ai-task-start"),
    ).not.toBeInTheDocument();

    const taskReads: () => number = (): number => {
      return getMock.mock.calls.filter((call: [RequestArgs]) => {
        return call[0].url.toString().includes("/get-ai-agent-task/");
      }).length;
    };

    expect(taskReads()).toBe(1);

    state.tasks = [task("FixException", "Completed")];

    await act(async () => {
      jest.advanceTimersByTime(AI_TASK_POLL_INTERVAL_MS);
    });

    await waitFor(() => {
      expect(
        within(card("FixException")).getByTestId("exception-ai-task-status"),
      ).toHaveTextContent("Completed");
    });
    expect(taskReads()).toBe(2);

    await act(async () => {
      jest.advanceTimersByTime(AI_TASK_POLL_INTERVAL_MS * 3);
    });
    expect(taskReads()).toBe(2);
  });

  test("a resolved exception pauses AI tasks and skips the checklist", async () => {
    state.tasks = [task("FixException", "Completed")];
    await renderAssistance({ isResolved: true });

    expect(screen.getByText("AI assistance is paused")).toBeInTheDocument();
    expect(
      within(card("FixException")).getByTestId("exception-ai-task-start"),
    ).toBeDisabled();
    // Earlier work stays reachable.
    expect(
      within(card("FixException")).getByTestId("exception-ai-task-view"),
    ).toBeInTheDocument();

    const readinessCalls: number = getMock.mock.calls.filter(
      (call: [RequestArgs]) => {
        return call[0].url.toString().includes("/ai-fix-readiness/");
      },
    ).length;
    expect(readinessCalls).toBe(0);
  });

  test("reopening from the header while the page is open loads the checklist", async () => {
    state.ready = false;
    state.checks = [
      { id: "llmProvider", ok: true, title: "LLM provider", detail: "" },
      {
        id: "agentAvailable",
        ok: false,
        title: "AI agent online",
        detail: "No agent is available for this project.",
      },
    ];

    const view: (isResolved: boolean) => React.ReactElement = (
      isResolved: boolean,
    ): React.ReactElement => {
      return (
        <MemoryRouter>
          <ExceptionAIAssistance
            telemetryExceptionId={new ObjectID(EXCEPTION_ID)}
            isResolved={isResolved}
            isArchived={false}
          />
        </MemoryRouter>
      );
    };

    const { rerender } = render(view(true));
    await screen.findByTestId("exception-ai-assistance");

    expect(
      screen.queryByRole("heading", { name: "Set up AI for this exception" }),
    ).not.toBeInTheDocument();

    rerender(view(false));

    expect(
      await screen.findByRole("heading", {
        name: "Set up AI for this exception",
      }),
    ).toBeInTheDocument();
    expect(
      getMock.mock.calls.filter((call: [RequestArgs]) => {
        return call[0].url.toString().includes("/ai-fix-readiness/");
      }),
    ).toHaveLength(1);
    // Tasks are not re-read just because the status changed.
    expect(
      getMock.mock.calls.filter((call: [RequestArgs]) => {
        return call[0].url.toString().includes("/get-ai-agent-task/");
      }),
    ).toHaveLength(1);
  });

  /*
   * A task works in the exception's repository, and the server refuses a
   * person who may not edit it: the card says so before they try. They
   * still see the tasks.
   */
  test("someone who may only read sees the tasks and cannot start one", async () => {
    grant([Permission.ProjectUser, Permission.Viewer]);
    state.tasks = [task("FixException", "Completed")];
    await renderAssistance();

    for (const taskType of ["FixException", "WriteRegressionTest"]) {
      expect(
        within(card(taskType)).getByTestId("exception-ai-task-start"),
      ).toBeDisabled();
      // Locked, with its reason on hover or a press.
      expect(
        within(card(taskType)).getByTestId(
          "exception-ai-task-start-disabled-wrapper",
        ),
      ).toBeInTheDocument();
    }
    expect(
      within(card("FixException")).getByTestId("exception-ai-task-view"),
    ).toBeInTheDocument();
  });

  test("Edit Code Repository is enough to start one", async () => {
    grant([
      Permission.ProjectUser,
      Permission.Viewer,
      Permission.EditCodeRepository,
    ]);
    await renderAssistance();

    expect(
      within(card("FixException")).getByTestId("exception-ai-task-start"),
    ).not.toBeDisabled();
  });

  test("an archived exception is paused too", async () => {
    await renderAssistance({ isArchived: true });

    expect(screen.getByText("AI assistance is paused")).toBeInTheDocument();
    expect(
      within(card("WriteRegressionTest")).getByTestId(
        "exception-ai-task-start",
      ),
    ).toBeDisabled();
  });

  test("reads the legacy single-task response from older servers", async () => {
    getMock.mockImplementation(async (args: RequestArgs): Promise<unknown> => {
      const url: string = args.url.toString();
      if (url.includes("/ai-fix-readiness/")) {
        return ok({ ready: true, checks: READY_CHECKS });
      }
      return ok({ aiAgentTask: task("", "Queued") });
    });

    await renderAssistance();

    expect(
      within(card("FixException")).getByTestId("exception-ai-task-status"),
    ).toHaveTextContent("Queued");
  });
});
