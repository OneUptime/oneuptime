import {
  afterEach,
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
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import InvestigationPanel, {
  InvestigationSubjectType,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel";
import { AI_INVESTIGATION_PANEL_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIInvestigationStatus";
import {
  SettingsAction,
  getInvestigationNotStartedStatus,
  getSettingsAction,
  parseInvestigationNotStartedReason,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationNotStarted";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import InvestigationNotStartedReason, {
  InvestigationNotStartedCode,
} from "../../../Types/AI/InvestigationNotStartedReason";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return postMock(...args);
      },
      getFriendlyMessage: (): string => {
        return "Request failed";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): JSONObject => {
        return { tenantid: "33333333-3333-4333-8333-333333333333" };
      },
    },
  };
});

const SUBJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NEXT_SUBJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const EVALUATED_AT: string = "2026-09-17T12:24:00.000Z";
const NEXT_EVALUATED_AT: string = "2026-09-17T12:25:00.000Z";
const AI_DISABLED_WHO_CAN_ACT: string =
  "A project owner or someone with Manage Billing can turn AI on in Project Settings → AI Features.";
const NO_CREDITS_WHO_CAN_ACT: string =
  "A project owner or someone with Manage Billing can add AI credits.";
const DAILY_LIMIT_WHO_CAN_ACT: string =
  "A project owner or someone with Manage Billing can change the project's daily AI limits in Project Settings → AI Features.";

interface ReasonExample {
  code: InvestigationNotStartedCode;
  title: string;
  description: string;
  nextStep: string;
}

const REASONS: Array<ReasonExample> = [
  {
    code: "ai_disabled",
    title: "AI is disabled for this project",
    description: "The project AI switch is off.",
    nextStep: "A project owner can enable AI for future events.",
  },
  {
    code: "automatic_investigation_disabled",
    title: "Automatic investigation is turned off",
    description:
      "The automatic investigation switch is off for this event type.",
    nextStep: "Enable automatic investigation for future events.",
  },
  {
    code: "provider_missing",
    title: "No AI provider is configured",
    description: "No project or global model provider was available.",
    nextStep: "Configure a model provider for future investigations.",
  },
  {
    code: "insufficient_ai_balance",
    title: "The project is out of AI credits",
    description:
      "The project uses OneUptime's AI provider and has no AI credits left.",
    nextStep: "Add AI credits or turn on auto-recharge.",
  },
  {
    code: "project_daily_limit_reached",
    title: "The project's daily AI limit had been reached at creation",
    description:
      "This project had reached one of its own daily AI limits when this incident was created.",
    nextStep:
      "Review the project's daily AI limits under Project Settings → AI Features → More settings.",
  },
  {
    code: "severity_below_threshold",
    title: "Severity is below the investigation threshold",
    description: "Low severity does not meet the configured High minimum.",
    nextStep: "Review the minimum severity in investigation settings.",
  },
  {
    code: "monitor_cooldown",
    title: "This monitor was recently investigated",
    description:
      "A previous investigation was started inside the 30 minute cooldown.",
    nextStep: "Review the previous investigation for this monitor.",
  },
  {
    code: "created_resolved",
    title: "This incident was created already resolved",
    description:
      "It was already resolved when it was created, so OneUptime AI did not investigate it automatically.",
    nextStep: "To look into it anyway, ask OneUptime AI below.",
  },
  {
    code: "daily_budget_exhausted",
    title: "The daily AI token limit was reached",
    description: "The daily token budget for this event type was exhausted.",
    nextStep: "Review the budget for future investigations.",
  },
  {
    code: "budget_check_failed",
    title: "The AI budget could not be checked",
    description: "The usage service could not confirm available budget.",
    nextStep: "Check the service logs to resolve the budget lookup failure.",
  },
  {
    code: "enqueue_failed",
    title: "The investigation could not be queued",
    description: "A service error prevented the investigation from starting.",
    nextStep: "Check the service logs for a queue error.",
  },
  {
    code: "eligibility_check_failed",
    title: "Investigation eligibility could not be checked",
    description:
      "The service could not evaluate automatic investigation settings.",
    nextStep: "Check the service logs for the eligibility lookup failure.",
  },
  {
    code: "no_run_recorded",
    title: "No investigation decision was recorded",
    description:
      "Current settings allow investigation, but the original reason is unknown.",
    nextStep:
      "Review AI logs; enabling AI does not investigate older events automatically.",
  },
];

function reasonFor(
  code: InvestigationNotStartedCode = "monitor_cooldown",
  overrides: Partial<InvestigationNotStartedReason> = {},
): InvestigationNotStartedReason {
  const example: ReasonExample = REASONS.find(
    (item: ReasonExample): boolean => {
      return item.code === code;
    },
  )!;
  return {
    ...example,
    source: "recorded",
    evaluatedAt: EVALUATED_AT,
    ...overrides,
  };
}

function noRunResponse(
  reason: InvestigationNotStartedReason | null = reasonFor(),
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    {
      run: null,
      events: [],
      notInvestigatedReason: reason as unknown as JSONObject | null,
    },
    {},
  );
}

function runResponse(status: AIRunStatus): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    {
      run: {
        _id: "44444444-4444-4444-8444-444444444444",
        status,
        toolCallCount: 0,
        totalTokens: 0,
      },
      events: [],
      // A run always wins, even when a stale reason is returned with it.
      notInvestigatedReason: reasonFor() as unknown as JSONObject,
    },
    {},
  );
}

async function flush(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(milliseconds: number = 2500): Promise<void> {
  await act(async (): Promise<void> => {
    jest.advanceTimersByTime(milliseconds);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderPanel(
  subjectType: InvestigationSubjectType = "alert",
): ReturnType<typeof render> {
  return render(
    <InvestigationPanel subjectType={subjectType} subjectId={SUBJECT_ID} />,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(EVALUATED_AT));
  postMock.mockReset();
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectOwner]);
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe.each<[InvestigationSubjectType]>([["alert"], ["incident"]])(
  "%s investigation explanation",
  (subjectType: InvestigationSubjectType) => {
    test.each(REASONS)(
      "shows the server's $code decision and next step",
      async (example: ReasonExample) => {
        postMock.mockResolvedValue(noRunResponse(reasonFor(example.code)));

        renderPanel(subjectType);
        await flush();

        const panel: HTMLElement = screen.getByRole("region", {
          name: "AI Investigation",
        });
        expect(panel).toHaveAttribute("id", AI_INVESTIGATION_PANEL_ID);
        expect(panel).toHaveAttribute("tabindex", "-1");
        expect(panel).toHaveAttribute("aria-busy", "false");
        expect(screen.getByLabelText("Investigation status")).toHaveTextContent(
          "Not investigated",
        );
        expect(
          screen.getByRole("heading", { name: example.title }),
        ).toBeVisible();
        expect(screen.getByText(example.description)).toBeVisible();
        expect(screen.getByText(example.nextStep)).toBeVisible();
        expect(screen.getByText("Decision recorded at creation")).toBeVisible();
        expect(panel.querySelector("time")).toHaveAttribute(
          "datetime",
          EVALUATED_AT,
        );
        expect(screen.queryByText("Completed")).toBeNull();

        const request: {
          url: { toString: () => string };
          data: JSONObject;
          headers: JSONObject;
        } = postMock.mock.calls[0]![0] as {
          url: { toString: () => string };
          data: JSONObject;
          headers: JSONObject;
        };
        expect(request.url.toString()).toContain(
          `/ai-investigation/${subjectType}`,
        );
        expect(request.data).toEqual({
          [`${subjectType}Id`]: SUBJECT_ID.toString(),
        });
        expect(request.headers).toEqual({ tenantid: PROJECT_ID.toString() });
      },
    );

    test("links investigation limits to this subject's AI settings", async () => {
      postMock.mockResolvedValue(
        noRunResponse(reasonFor("daily_budget_exhausted")),
      );
      renderPanel(subjectType);
      await flush();

      expect(
        screen.getByRole("link", { name: `Review ${subjectType} AI settings` }),
      ).toHaveAttribute(
        "href",
        expect.stringContaining(
          `/${PROJECT_ID.toString()}/${subjectType}s/ai/settings`,
        ),
      );
    });

    test("replaces an explanation when an investigation is queued later", async () => {
      postMock
        .mockResolvedValueOnce(
          noRunResponse(reasonFor("no_run_recorded", { source: "unknown" })),
        )
        .mockResolvedValue(runResponse(AIRunStatus.Queued));
      renderPanel(subjectType);
      await flush();
      expect(screen.getByText("No recorded decision")).toBeVisible();

      await advance();

      expect(screen.getByText("Queued")).toBeVisible();
      expect(screen.queryByText("Not investigated")).toBeNull();
      expect(
        screen.queryByText("No investigation decision was recorded"),
      ).toBeNull();
      expect(
        screen.queryByText("This monitor was recently investigated"),
      ).toBeNull();
      expect(
        screen.getAllByRole("region", { name: "AI Investigation" }),
      ).toHaveLength(1);
    });
  },
);

describe("investigation reason freshness and uncertainty", () => {
  test("renders a recorded decision without invalid HTML nesting", async () => {
    const consoleError: ReturnType<typeof jest.spyOn> = jest.spyOn(
      console,
      "error",
    );
    postMock.mockResolvedValue(noRunResponse());
    renderPanel();
    await flush();

    expect(screen.getByText("Decision recorded at creation")).toBeVisible();
    expect(
      consoleError.mock.calls.some((args: Array<unknown>): boolean => {
        return args.some((value: unknown): boolean => {
          return (
            typeof value === "string" && value.includes("validateDOMNesting")
          );
        });
      }),
    ).toBe(false);
  });

  test("shows a distinct loading state without guessing a skip reason", async () => {
    postMock.mockReturnValue(new Promise<never>(() => {}));
    renderPanel();

    expect(
      screen.getByRole("region", { name: "AI Investigation" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Checking investigation status…")).toBeVisible();
    expect(screen.queryByText("Not investigated")).toBeNull();
    expect(screen.queryByText("No investigation has been recorded")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("labels current settings as current and never as the creation decision", async () => {
    postMock.mockResolvedValue(
      noRunResponse(
        reasonFor("automatic_investigation_disabled", {
          source: "current_configuration",
        }),
      ),
    );
    renderPanel();
    await flush();

    expect(screen.getByText("Based on current settings")).toBeVisible();
    expect(
      screen.getByText(
        /Settings may have changed since this alert was created/,
      ),
    ).toBeVisible();
    expect(screen.queryByText("Decision recorded at creation")).toBeNull();
  });

  test("keeps unknown historical reasons honest when settings allow investigation now", async () => {
    postMock.mockResolvedValue(
      noRunResponse(reasonFor("no_run_recorded", { source: "unknown" })),
    );
    renderPanel();
    await flush();

    expect(screen.getByText("No recorded decision")).toBeVisible();
    expect(
      screen.getByText(
        /Current settings allow investigation, but the original reason is unknown/,
      ),
    ).toBeVisible();
    expect(screen.queryByText("AI is disabled for this project")).toBeNull();
  });

  test("a legacy no-run payload shows a useful fallback without inventing a blocker", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { run: null, events: [] }, {}),
    );
    renderPanel();
    await flush();

    expect(
      screen.getByText("No investigation has been recorded"),
    ).toBeVisible();
    expect(
      screen.getByText(/no recorded explanation is available/),
    ).toBeVisible();
    expect(
      screen.getByText(/does not automatically investigate older ones/),
    ).toBeVisible();
    expect(screen.queryByText("Decision recorded at creation")).toBeNull();
    expect(screen.queryByText("AI is disabled for this project")).toBeNull();
  });

  test.each([
    null,
    "ai_disabled",
    { code: "ai_disabled" },
    { ...reasonFor(), code: "future_reason" },
    { ...reasonFor(), title: "  " },
    { ...reasonFor(), nextStep: 3 },
    { ...reasonFor(), source: "guessed" },
    { ...reasonFor(), evaluatedAt: "not a date" },
  ])(
    "safely falls back when explanation data is malformed: %j",
    async (reason: unknown) => {
      postMock.mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          {
            run: null,
            events: [],
            notInvestigatedReason: reason as JSONObject,
          },
          {},
        ),
      );
      renderPanel();
      await flush();

      expect(
        screen.getByText("No investigation has been recorded"),
      ).toBeVisible();
      expect(screen.queryByText("Decision recorded at creation")).toBeNull();
    },
  );

  test("renders explanation strings as text instead of executable markup", async () => {
    const title: string = '<img src=x onerror="alert(1)">';
    const nextStep: string = "[Open settings](javascript:alert(1))";
    postMock.mockResolvedValue(
      noRunResponse(
        reasonFor("enqueue_failed", {
          title,
          description: "<script>window.compromised = true</script>",
          nextStep,
        }),
      ),
    );
    const view: ReturnType<typeof render> = renderPanel();
    await flush();

    expect(screen.getByText(title)).toBeVisible();
    expect(screen.getByText(nextStep)).toBeVisible();
    expect(view.container.querySelector("script")).toBeNull();
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  test("refreshes changed explanations even while no run exists", async () => {
    postMock
      .mockResolvedValueOnce(
        noRunResponse(
          reasonFor("provider_missing", { source: "current_configuration" }),
        ),
      )
      .mockResolvedValue(
        noRunResponse(
          reasonFor("severity_below_threshold", {
            source: "current_configuration",
            evaluatedAt: NEXT_EVALUATED_AT,
          }),
        ),
      );
    const view: ReturnType<typeof render> = renderPanel();
    await flush();
    expect(screen.getByText("No AI provider is configured")).toBeVisible();

    await advance();

    expect(screen.queryByText("No AI provider is configured")).toBeNull();
    expect(
      screen.getByText("Severity is below the investigation threshold"),
    ).toBeVisible();
    expect(view.container.querySelector("time")).toHaveAttribute(
      "datetime",
      NEXT_EVALUATED_AT,
    );
  });

  test("continues to discover queued work at the settled cadence after the initial checks", async () => {
    postMock.mockResolvedValue(noRunResponse());
    renderPanel();
    await flush();
    for (let count: number = 0; count < 4; count++) {
      await advance();
    }
    expect(postMock).toHaveBeenCalledTimes(5);

    postMock.mockResolvedValue(runResponse(AIRunStatus.Running));
    await advance(29_999);
    expect(postMock).toHaveBeenCalledTimes(5);
    await advance(1);

    expect(postMock).toHaveBeenCalledTimes(6);
    expect(screen.getByText("Investigating…")).toBeVisible();
    expect(screen.queryByText("Not investigated")).toBeNull();
  });

  test("clears the previous subject's explanation while a new subject loads", async () => {
    let resolveNext: ((value: HTTPResponse<JSONObject>) => void) | undefined;
    const nextResponse: Promise<HTTPResponse<JSONObject>> = new Promise(
      (resolve: (value: HTTPResponse<JSONObject>) => void) => {
        resolveNext = resolve;
      },
    );
    postMock
      .mockResolvedValueOnce(noRunResponse(reasonFor("monitor_cooldown")))
      .mockReturnValueOnce(nextResponse);
    const view: ReturnType<typeof render> = renderPanel();
    await flush();
    expect(
      screen.getByText("This monitor was recently investigated"),
    ).toBeVisible();

    view.rerender(
      <InvestigationPanel subjectType="incident" subjectId={NEXT_SUBJECT_ID} />,
    );
    expect(screen.getByText("Checking investigation status…")).toBeVisible();
    expect(
      screen.queryByText("This monitor was recently investigated"),
    ).toBeNull();

    resolveNext!(noRunResponse(reasonFor("provider_missing")));
    await flush();
    expect(screen.getByText("No AI provider is configured")).toBeVisible();
    expect(
      screen.queryByText("This monitor was recently investigated"),
    ).toBeNull();
  });

  test("ignores a late explanation from the previous subject", async () => {
    let resolveFirst: ((value: HTTPResponse<JSONObject>) => void) | undefined;
    const firstResponse: Promise<HTTPResponse<JSONObject>> = new Promise(
      (resolve: (value: HTTPResponse<JSONObject>) => void) => {
        resolveFirst = resolve;
      },
    );
    postMock
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(noRunResponse(reasonFor("provider_missing")));
    const view: ReturnType<typeof render> = renderPanel();
    view.rerender(
      <InvestigationPanel subjectType="incident" subjectId={NEXT_SUBJECT_ID} />,
    );
    await flush();

    resolveFirst!(noRunResponse(reasonFor("monitor_cooldown")));
    await flush();

    expect(screen.getByText("No AI provider is configured")).toBeVisible();
    expect(
      screen.queryByText("This monitor was recently investigated"),
    ).toBeNull();
  });
});

describe("investigation status failures and recovery", () => {
  test.each(["http", "network"])(
    "shows uncertainty and offers retry on an initial %s failure",
    async (failure: string) => {
      if (failure === "http") {
        postMock.mockResolvedValueOnce(
          new HTTPErrorResponse(
            503,
            { message: "Internal configuration secret" },
            {},
          ),
        );
      } else {
        postMock.mockRejectedValueOnce(
          new Error("Network failure with internal details"),
        );
      }
      postMock.mockResolvedValue(noRunResponse(reasonFor("monitor_cooldown")));
      renderPanel();
      await flush();

      expect(
        screen.getByText("Investigation status is unavailable"),
      ).toBeVisible();
      expect(
        screen.getByText(/This does not mean AI is disabled/),
      ).toBeVisible();
      expect(screen.queryByText("Not investigated")).toBeNull();
      expect(screen.queryByText(/Internal configuration secret/)).toBeNull();

      fireEvent.click(
        screen.getByRole("button", { name: "Retry investigation status" }),
      );
      await flush();

      expect(
        screen.getByText("This monitor was recently investigated"),
      ).toBeVisible();
      expect(
        screen.queryByText("Investigation status is unavailable"),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Retry investigation status" }),
      ).toBeNull();
    },
  );

  test("preserves a known explanation through a transient failure, then clears the warning on recovery", async () => {
    postMock
      .mockResolvedValueOnce(noRunResponse())
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue(noRunResponse());
    renderPanel();
    await flush();
    await advance();

    expect(
      screen.getByText("This monitor was recently investigated"),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Could not refresh this status. Showing the last successful check.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText("Investigation status is unavailable"),
    ).toBeNull();

    await advance();

    expect(
      screen.getByText("This monitor was recently investigated"),
    ).toBeVisible();
    expect(screen.queryByText(/Could not refresh this status/)).toBeNull();
  });

  test("prevents repeated retry clicks from overlapping status requests", async () => {
    let resolveRetry: ((value: HTTPResponse<JSONObject>) => void) | undefined;
    const retryResponse: Promise<HTTPResponse<JSONObject>> = new Promise(
      (resolve: (value: HTTPResponse<JSONObject>) => void) => {
        resolveRetry = resolve;
      },
    );
    postMock
      .mockRejectedValueOnce(new Error("Offline"))
      .mockReturnValueOnce(retryResponse);
    renderPanel();
    await flush();

    const retry: HTMLElement = screen.getByRole("button", {
      name: "Retry investigation status",
    });
    fireEvent.click(retry);
    fireEvent.click(retry);
    await advance();

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(retry).toBeDisabled();

    resolveRetry!(noRunResponse());
    await flush();
    expect(
      screen.getByText("This monitor was recently investigated"),
    ).toBeVisible();
  });
});

describe("investigation settings actions", () => {
  test("links provider failures to provider configuration", async () => {
    postMock.mockResolvedValue(noRunResponse(reasonFor("provider_missing")));
    renderPanel();
    await flush();

    expect(
      screen.getByRole("link", { name: "Configure an AI provider" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(
        `/${PROJECT_ID.toString()}/settings/llm-providers`,
      ),
    );
  });

  /*
   * The switch moved to Project Settings → AI Features, which every install
   * shows. AI Credits is listed only when billing is on, so on a self-hosted
   * install the old link led to a page the menu never offered.
   */
  test("links the project AI switch to the AI Features settings page", async () => {
    postMock.mockResolvedValue(noRunResponse(reasonFor("ai_disabled")));
    renderPanel();
    await flush();

    const link: HTMLElement = screen.getByRole("link", {
      name: "Go to Project Settings → AI Features",
    });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining(`/${PROJECT_ID.toString()}/settings/ai-features`),
    );
    expect(link.getAttribute("href")).not.toContain("ai-credits");
  });

  test("links an empty AI balance to AI credits", async () => {
    postMock.mockResolvedValue(
      noRunResponse(reasonFor("insufficient_ai_balance")),
    );
    renderPanel("incident");
    await flush();

    expect(screen.getByText("The project is out of AI credits")).toBeVisible();
    expect(
      screen.getByText("Add AI credits or turn on auto-recharge."),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Add AI credits" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/${PROJECT_ID.toString()}/settings/ai-credits`),
    );
  });

  test.each([
    [Permission.ProjectOwner, true],
    [Permission.ManageProjectBilling, true],
    [Permission.ProjectAdmin, false],
    [Permission.ProjectMember, false],
  ])(
    "offers the AI Features link to %s only when they can flip the switch (%s)",
    async (permission: Permission, offered: boolean) => {
      jest
        .mocked(PermissionUtil.getAllPermissions)
        .mockReturnValue([permission]);
      postMock.mockResolvedValue(noRunResponse(reasonFor("ai_disabled")));
      renderPanel();
      await flush();

      expect(
        screen.queryByRole("link", {
          name: "Go to Project Settings → AI Features",
        }) !== null,
      ).toBe(offered);
      expect(screen.queryByText(AI_DISABLED_WHO_CAN_ACT) !== null).toBe(
        !offered,
      );
    },
  );

  /*
   * Only a project owner or Manage Billing may flip Project.enableAi, so a
   * Project Admin who cannot use the link must not be told "a project
   * administrator" can fix it — that sends them to ask themselves.
   */
  test("tells a Project Admin who can turn AI on, without claiming an administrator can", async () => {
    jest
      .mocked(PermissionUtil.getAllPermissions)
      .mockReturnValue([Permission.ProjectAdmin]);
    postMock.mockResolvedValue(noRunResponse(reasonFor("ai_disabled")));
    renderPanel();
    await flush();

    expect(screen.getByText(AI_DISABLED_WHO_CAN_ACT)).toBeVisible();
    expect(screen.queryByText(/project administrator/i)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test.each([
    [Permission.ProjectOwner, true],
    [Permission.ManageProjectBilling, true],
    [Permission.ProjectAdmin, false],
    [Permission.Viewer, false],
  ])(
    "offers the AI credits link to %s only when they can recharge (%s)",
    async (permission: Permission, offered: boolean) => {
      jest
        .mocked(PermissionUtil.getAllPermissions)
        .mockReturnValue([permission]);
      postMock.mockResolvedValue(
        noRunResponse(reasonFor("insufficient_ai_balance")),
      );
      renderPanel();
      await flush();

      expect(
        screen.queryByRole("link", { name: "Add AI credits" }) !== null,
      ).toBe(offered);
      expect(screen.queryByText(NO_CREDITS_WHO_CAN_ACT) !== null).toBe(
        !offered,
      );
    },
  );

  test("tells a Project Admin who can add AI credits, without claiming an administrator can", async () => {
    jest
      .mocked(PermissionUtil.getAllPermissions)
      .mockReturnValue([Permission.ProjectAdmin]);
    postMock.mockResolvedValue(
      noRunResponse(reasonFor("insufficient_ai_balance")),
    );
    renderPanel();
    await flush();

    expect(screen.getByText(NO_CREDITS_WHO_CAN_ACT)).toBeVisible();
    expect(screen.queryByText(/project administrator/i)).toBeNull();
  });

  test("still sends a viewer who cannot configure a provider to an administrator", async () => {
    jest
      .mocked(PermissionUtil.getAllPermissions)
      .mockReturnValue([Permission.Viewer]);
    postMock.mockResolvedValue(noRunResponse(reasonFor("provider_missing")));
    renderPanel();
    await flush();

    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByText("A project administrator can review these settings."),
    ).toBeVisible();
  });

  test("shows no who-can-act sentence to someone who has the link", async () => {
    jest
      .mocked(PermissionUtil.getAllPermissions)
      .mockReturnValue([Permission.ProjectOwner]);
    postMock.mockResolvedValue(noRunResponse(reasonFor("ai_disabled")));
    renderPanel();
    await flush();

    expect(
      screen.getByRole("link", {
        name: "Go to Project Settings → AI Features",
      }),
    ).toBeVisible();
    expect(screen.queryByText(AI_DISABLED_WHO_CAN_ACT)).toBeNull();
  });

  test("keeps the reason available to viewers without offering settings they cannot change", async () => {
    jest
      .mocked(PermissionUtil.getAllPermissions)
      .mockReturnValue([Permission.Viewer]);
    postMock.mockResolvedValue(
      noRunResponse(reasonFor("severity_below_threshold")),
    );
    renderPanel();
    await flush();

    expect(
      screen.getByText("Severity is below the investigation threshold"),
    ).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByText("A project administrator can review these settings."),
    ).toBeVisible();
  });

  test("respects a provider-specific permission without requiring project administrator access", async () => {
    jest
      .mocked(PermissionUtil.getAllPermissions)
      .mockReturnValue([Permission.CreateProjectLlm]);
    postMock.mockResolvedValue(noRunResponse(reasonFor("provider_missing")));
    renderPanel();
    await flush();

    expect(
      screen.getByRole("link", { name: "Configure an AI provider" }),
    ).toBeVisible();
    expect(
      screen.queryByText("A project administrator can review these settings."),
    ).toBeNull();
  });
});

describe("which settings page each reason points at", () => {
  function actionFor(
    code: InvestigationNotStartedCode,
    subjectType: "incident" | "alert" = "incident",
  ): SettingsAction | null {
    return getSettingsAction(code, subjectType);
  }

  /*
   * whoCanAct names the roles by hand, so this pins the column's update list:
   * if it changes, the sentence has to change with it.
   */
  test("the AI switch: AI Features, for whoever may update Project.enableAi", () => {
    expect(actionFor("ai_disabled")).toEqual({
      label: "Go to Project Settings → AI Features",
      page: PageMap.SETTINGS_AI_FEATURES,
      permissions:
        new Project().getColumnAccessControlFor("enableAi")?.update || [],
      whoCanAct: AI_DISABLED_WHO_CAN_ACT,
    });
    expect(actionFor("ai_disabled")!.permissions).toEqual([
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
    ]);
  });

  /*
   * The project's own daily AI limits are on Project Settings → AI Features
   * (More settings), which every install shows, and take what the limit
   * columns take - not the incident AI settings a project admin may edit.
   */
  test("the project's daily AI limit: AI Features, for whoever may change the limits", () => {
    for (const subjectType of ["incident", "alert"] as const) {
      expect(actionFor("project_daily_limit_reached", subjectType)).toEqual({
        label: "Go to Project Settings → AI Features",
        page: PageMap.SETTINGS_AI_FEATURES,
        permissions:
          new Project().getColumnAccessControlFor("aiDailyTokenLimit")
            ?.update || [],
        whoCanAct: DAILY_LIMIT_WHO_CAN_ACT,
      });
    }

    expect(actionFor("project_daily_limit_reached")!.permissions).toEqual([
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
    ]);
    // Both limits take the same people.
    expect(
      new Project().getColumnAccessControlFor("aiDailySpendLimitInUSD")?.update,
    ).toEqual(actionFor("project_daily_limit_reached")!.permissions);
  });

  test("no AI credits: AI Credits, for whoever may recharge", () => {
    expect(actionFor("insufficient_ai_balance")).toEqual({
      label: "Add AI credits",
      page: PageMap.SETTINGS_AI_CREDITS,
      permissions: [Permission.ProjectOwner, Permission.ManageProjectBilling],
      whoCanAct: NO_CREDITS_WHO_CAN_ACT,
    });
  });

  test.each<[InvestigationNotStartedCode]>([
    ["ai_disabled"],
    ["insufficient_ai_balance"],
    ["project_daily_limit_reached"],
    ["provider_missing"],
    ["automatic_investigation_disabled"],
    ["severity_below_threshold"],
    ["monitor_cooldown"],
    ["daily_budget_exhausted"],
    ["no_run_recorded"],
  ])(
    "%s: the no-link sentence only credits an administrator when an administrator can act",
    (code: InvestigationNotStartedCode) => {
      const action: SettingsAction = actionFor(code)!;

      expect(action.whoCanAct.trim()).not.toBe("");
      const creditsAdministrator: boolean = action.whoCanAct
        .toLowerCase()
        .includes("project administrator");

      expect(creditsAdministrator).toBe(
        action.permissions.includes(Permission.ProjectAdmin),
      );
    },
  );

  test("the AI switch's no-link sentence says where the switch is", () => {
    expect(actionFor("ai_disabled")!.whoCanAct).toContain(
      "Project Settings → AI Features",
    );
  });

  test("no provider: LLM providers", () => {
    expect(actionFor("provider_missing")!.page).toBe(
      PageMap.SETTINGS_AI_LLM_PROVIDERS,
    );
  });

  test.each<[InvestigationNotStartedCode]>([
    ["automatic_investigation_disabled"],
    ["severity_below_threshold"],
    ["monitor_cooldown"],
    ["daily_budget_exhausted"],
    ["no_run_recorded"],
  ])(
    "%s: the subject's own AI settings",
    (code: InvestigationNotStartedCode) => {
      expect(actionFor(code, "incident")!.page).toBe(
        PageMap.INCIDENTS_SETTINGS_AI,
      );
      expect(actionFor(code, "alert")!.page).toBe(PageMap.ALERTS_SETTINGS_AI);
    },
  );

  test.each<[InvestigationNotStartedCode]>([
    ["budget_check_failed"],
    ["enqueue_failed"],
    ["eligibility_check_failed"],
  ])(
    "%s: no settings page fixes a service error",
    (code: InvestigationNotStartedCode) => {
      expect(actionFor(code)).toBeNull();
    },
  );

  test("created already resolved: no setting would have changed it, so no settings page is offered", () => {
    expect(actionFor("created_resolved", "incident")).toBeNull();
    expect(actionFor("created_resolved", "alert")).toBeNull();
  });

  test("no reason sends anyone to AI Credits to turn AI on", () => {
    const codes: Array<InvestigationNotStartedCode> = REASONS.map(
      (example: ReasonExample): InvestigationNotStartedCode => {
        return example.code;
      },
    );

    for (const code of codes) {
      const action: SettingsAction | null = actionFor(code);
      if (action?.page === PageMap.SETTINGS_AI_CREDITS) {
        expect(code).toBe("insufficient_ai_balance");
      }
    }
  });
});

/*
 * The card treats a code it does not know as "no explanation", so a reason
 * the server learns to send (insufficient_ai_balance was the latest) must be
 * added to the card's list at the same time — or every such incident shows
 * the generic fallback. Read from the type's source so a new code cannot be
 * added there alone.
 */
describe("the card knows every reason the server can send", () => {
  const typeSource: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Types",
      "AI",
      "InvestigationNotStartedReason.ts",
    ),
    "utf8",
  );
  const unionSource: string = (typeSource.match(
    /export type InvestigationNotStartedCode =([\s\S]*?);/,
  ) || [])[1] as string;
  const codes: Array<string> = Array.from(
    (unionSource || "").matchAll(/\|\s*"([a-z_]+)"/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });

  test("reads the union from the type's source", () => {
    expect(codes).toContain("ai_disabled");
    expect(codes).toContain("insufficient_ai_balance");
    expect(codes.length).toBe(REASONS.length);
  });

  test.each(
    codes.map((code: string): [string] => {
      return [code];
    }),
  )("parses %s", (code: string) => {
    expect(
      parseInvestigationNotStartedReason({
        code,
        title: "Title",
        description: "Description",
        nextStep: "Next step",
        source: "current_configuration",
        evaluatedAt: EVALUATED_AT,
      }),
    ).not.toBeNull();
  });

  test("every reason has an example in this suite", () => {
    expect(
      REASONS.map((example: ReasonExample): string => {
        return example.code;
      }).sort(),
    ).toEqual([...codes].sort());
  });
});

/*
 * The not-started state used to be built differently from a run's panel: its
 * own icon tile and header, a tinted body, a second "What you can do" column
 * behind a rule and an amber retry box. It now uses the same card, header
 * and status pill as a run, with plain sections inside.
 */
describe("the not-started card's layout", () => {
  const PANEL_CLASS: RegExp =
    /^(rounded-xl|rounded-2xl|shadow|shadow-(sm|md|lg)|bg-gradient-to-[a-z]+|bg-(indigo|amber|emerald|red|green|rose|violet)-50(\/\d+)?|bg-gray-50(\/\d+)?|lg:border-l|border-l)$/;

  function panelsInsideTheCard(): Array<string> {
    const region: HTMLElement = screen.getByRole("region", {
      name: "AI Investigation",
    });

    return Array.from(region.querySelectorAll("*"))
      .filter((element: Element): boolean => {
        if (element.closest("button") || element.closest("a")) {
          return false;
        }

        const tokens: Array<string> = (element.getAttribute("class") || "")
          .split(/\s+/)
          .filter(Boolean);
        const isFramedBox: boolean =
          tokens.includes("border") &&
          tokens.some((token: string): boolean => {
            return token.startsWith("rounded");
          });

        return (
          isFramedBox ||
          tokens.some((token: string): boolean => {
            return PANEL_CLASS.test(token);
          })
        );
      })
      .map((element: Element): string => {
        return `<${element.tagName.toLowerCase()} class="${element.getAttribute("class")}">`;
      });
  }

  test("sits in the same card as a run, under the same title", async () => {
    postMock.mockResolvedValue(noRunResponse());
    renderPanel();
    await flush();

    const cards: Array<HTMLElement> = screen.getAllByTestId("card");
    expect(cards).toHaveLength(1);
    expect(
      within(cards[0]!).getByRole("heading", {
        level: 2,
        name: "AI Investigation",
      }),
    ).toBeVisible();
    expect(cards[0]).toContainElement(
      screen.getByRole("region", { name: "AI Investigation" }),
    );
    expect(screen.getByTestId("card-description")).toHaveTextContent(
      "OneUptime AI's root-cause investigation for this alert.",
    );
  });

  test.each([
    [
      "while it checks",
      "Checking",
      "checking",
      (): void => {
        postMock.mockReturnValue(new Promise<never>(() => {}));
      },
    ],
    [
      "when nothing ran",
      "Not investigated",
      "idle",
      (): void => {
        postMock.mockResolvedValue(noRunResponse());
      },
    ],
    [
      "when the status cannot be loaded",
      "Unable to check",
      "attention",
      (): void => {
        postMock.mockRejectedValue(new Error("Offline"));
      },
    ],
  ])(
    "shows the run panel's neutral pill %s",
    async (
      _when: string,
      text: string,
      indicator: string,
      arrange: () => void,
    ) => {
      arrange();
      renderPanel();
      await flush();

      const badge: HTMLElement = screen.getByLabelText("Investigation status");
      expect(badge).toHaveTextContent(text);
      expect(badge).toHaveAttribute("data-indicator", indicator);
      expect(badge).toHaveClass("bg-gray-50", "text-gray-700", "ring-gray-200");
      expect(badge.className).not.toMatch(/amber|indigo/);
    },
  );

  test("its pill is exactly the one a run's panel shows", async () => {
    postMock.mockResolvedValue(noRunResponse());
    const view: ReturnType<typeof render> = renderPanel();
    await flush();
    const notStartedClass: string = screen.getByLabelText(
      "Investigation status",
    ).className;
    view.unmount();

    postMock.mockReset();
    postMock.mockResolvedValue(runResponse(AIRunStatus.Running));
    renderPanel();
    await flush();

    expect(screen.getByLabelText("Investigation status").className).toBe(
      notStartedClass,
    );
  });

  test("lays the reason and what to do out as plain sections, one after the other", async () => {
    postMock.mockResolvedValue(
      noRunResponse(reasonFor("daily_budget_exhausted")),
    );
    renderPanel();
    await flush();

    const example: ReasonExample = REASONS.find(
      (item: ReasonExample): boolean => {
        return item.code === "daily_budget_exhausted";
      },
    )!;
    const reasonHeading: HTMLElement = screen.getByRole("heading", {
      level: 3,
      name: example.title,
    });
    const nextStepHeading: HTMLElement = screen.getByRole("heading", {
      level: 3,
      name: "What you can do",
    });
    expect(reasonHeading.className).toBe(nextStepHeading.className);
    expect(
      reasonHeading.compareDocumentPosition(nextStepHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(panelsInsideTheCard()).toEqual([]);
  });

  test("offers Retry on a hairline row, not in an amber box", async () => {
    postMock.mockRejectedValue(new Error("Offline"));
    renderPanel();
    await flush();

    const retry: HTMLElement = screen.getByRole("button", {
      name: "Retry investigation status",
    });
    const row: HTMLElement = retry.parentElement!;
    expect(row).toHaveClass("border-t", "border-gray-200");
    expect(row.className).not.toMatch(/amber|rounded|(^|\s)border(\s|$)/);
    expect(row).toHaveTextContent("Try again to check this investigation.");
    expect(panelsInsideTheCard()).toEqual([]);
  });

  test("keeps a failed refresh's warning free of invalid nesting", async () => {
    const consoleError: ReturnType<typeof jest.spyOn> = jest.spyOn(
      console,
      "error",
    );
    postMock
      .mockResolvedValueOnce(noRunResponse())
      .mockRejectedValueOnce(new Error("Offline"));
    renderPanel();
    await flush();
    await advance();

    expect(
      screen.getByText(
        "Could not refresh this status. Showing the last successful check.",
      ),
    ).toBeVisible();
    expect(
      screen
        .getByRole("region", { name: "AI Investigation" })
        .querySelectorAll("p div"),
    ).toHaveLength(0);
    expect(
      consoleError.mock.calls.some((args: Array<unknown>): boolean => {
        return args.some((value: unknown): boolean => {
          return (
            typeof value === "string" && value.includes("validateDOMNesting")
          );
        });
      }),
    ).toBe(false);
  });
});

/*
 * The explanation is the AI Investigation card's body, not a card. With no
 * run the page used to show two cards (this explanation in one, the
 * conversation in a second under it); the panel now draws one card for every
 * state, so this component must never bring a header, a status pill or a
 * card of its own back.
 */
describe("the not-started state is the card's body", () => {
  test.each([
    [
      "still asking",
      { isLoading: true, hasError: false, hasSuccessfulResponse: false },
      { text: "Checking", indicator: "checking" },
    ],
    [
      "still asking after an earlier failure",
      { isLoading: true, hasError: true, hasSuccessfulResponse: false },
      { text: "Checking", indicator: "checking" },
    ],
    [
      "never loaded",
      { isLoading: false, hasError: true, hasSuccessfulResponse: false },
      { text: "Unable to check", indicator: "attention" },
    ],
    [
      "a refresh failed after a successful check",
      { isLoading: false, hasError: true, hasSuccessfulResponse: true },
      { text: "Not investigated", indicator: "idle" },
    ],
    [
      "nothing ran",
      { isLoading: false, hasError: false, hasSuccessfulResponse: true },
      { text: "Not investigated", indicator: "idle" },
    ],
  ] as Array<
    [
      string,
      { isLoading: boolean; hasError: boolean; hasSuccessfulResponse: boolean },
      { text: string; indicator: string },
    ]
  >)(
    "the status pill for %s",
    (
      _when: string,
      state: {
        isLoading: boolean;
        hasError: boolean;
        hasSuccessfulResponse: boolean;
      },
      expected: { text: string; indicator: string },
    ) => {
      expect(getInvestigationNotStartedStatus(state)).toEqual(expected);
    },
  );

  test("is one block inside the card's region, with no header or pill of its own", async () => {
    postMock.mockResolvedValue(noRunResponse());
    renderPanel();
    await flush();

    const region: HTMLElement = screen.getByRole("region", {
      name: "AI Investigation",
    });
    const body: HTMLElement = screen.getByTestId("investigation-not-started");

    expect(body.parentElement).toBe(region);
    // The card's title and pill belong to the card, above the region.
    expect(within(body).queryByRole("heading", { level: 2 })).toBeNull();
    expect(within(body).queryByLabelText("Investigation status")).toBeNull();
    expect(within(body).queryByTestId("card")).toBeNull();
    expect(screen.getAllByLabelText("Investigation status")).toHaveLength(1);
    expect(screen.getAllByTestId("card")).toHaveLength(1);
  });

  test("announces its changes politely and marks the region busy only while checking", async () => {
    let resolveStatus: (response: HTTPResponse<JSONObject>) => void = () => {};
    postMock.mockReturnValue(
      new Promise<HTTPResponse<JSONObject>>(
        (resolve: (response: HTTPResponse<JSONObject>) => void) => {
          resolveStatus = resolve;
        },
      ),
    );
    renderPanel();
    await flush();

    const region: HTMLElement = screen.getByRole("region", {
      name: "AI Investigation",
    });
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("investigation-not-started")).toHaveAttribute(
      "aria-live",
      "polite",
    );

    await act(async (): Promise<void> => {
      resolveStatus(noRunResponse());
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(region).toHaveAttribute("aria-busy", "false");
  });

  test("a run that appears takes the body's place in the same card", async () => {
    postMock
      .mockResolvedValueOnce(noRunResponse())
      .mockResolvedValue(runResponse(AIRunStatus.Running));
    renderPanel();
    await flush();

    const card: HTMLElement = screen.getByTestId("card");
    const region: HTMLElement = screen.getByRole("region", {
      name: "AI Investigation",
    });
    expect(screen.getByTestId("investigation-not-started")).toBeVisible();

    await advance();

    // The same card and region elements, not a second pair.
    expect(screen.getByTestId("card")).toBe(card);
    expect(screen.getByRole("region", { name: "AI Investigation" })).toBe(
      region,
    );
    expect(screen.queryByTestId("investigation-not-started")).toBeNull();
    expect(
      screen.getByRole("region", { name: "Live investigation" }),
    ).toBeVisible();
  });
});
