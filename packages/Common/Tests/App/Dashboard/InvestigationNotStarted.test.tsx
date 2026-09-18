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
} from "@testing-library/react";
import React from "react";
import InvestigationPanel, {
  InvestigationSubjectType,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel";
import { AI_INVESTIGATION_PANEL_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/AIInvestigationStatus";
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
        expect(screen.queryByText("Investigation complete")).toBeNull();

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
          `/${PROJECT_ID.toString()}/${subjectType}s/settings/ai`,
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

      expect(screen.getByText("Queued — waiting for a worker…")).toBeVisible();
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

  test("links the project AI switch to AI credits settings", async () => {
    postMock.mockResolvedValue(noRunResponse(reasonFor("ai_disabled")));
    renderPanel();
    await flush();

    expect(
      screen.getByRole("link", { name: "Review project AI settings" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/${PROJECT_ID.toString()}/settings/ai-credits`),
    );
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
