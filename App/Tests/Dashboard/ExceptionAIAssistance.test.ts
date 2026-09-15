import { describe, expect, test } from "@jest/globals";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import {
  AIFixReadiness,
  AIFixReadinessCheckId,
} from "Common/Types/AI/AIFixReadiness";
import {
  AIAgentTaskInfo,
  AITaskCardState,
  AI_TASKS_LOADING_REASON,
  AI_TASKS_PAUSED_REASON,
  AI_TASKS_SETUP_REASON,
  AI_TASK_PRESENTATION,
  EXCEPTION_AI_TASK_TYPES,
  ExceptionAITaskType,
  findLatestAITask,
  getAIReadinessProgress,
  getAITaskCardState,
  getReadinessCheckLink,
  isAITaskActive,
  isAITaskCompleted,
  isAITaskFailed,
  isAITaskNoFixFound,
  isAITaskUnsuccessful,
  parseAIAgentTask,
  parseAIAgentTasksResponse,
  parseAIFixReadinessResponse,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionAIAssistance";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";

function task(
  status: AIRunStatus,
  overrides: Partial<AIAgentTaskInfo> = {},
): AIAgentTaskInfo {
  return {
    _id: "70000000-0000-4000-8000-000000000001",
    status,
    statusMessage: undefined,
    statusTitle: status,
    statusDescription: `Description for ${status}`,
    createdAt: new Date("2026-09-14T11:42:00.000Z"),
    taskType: CodeFixTaskType.FixException,
    ...overrides,
  };
}

const ALL_STATUSES: Array<AIRunStatus> = Object.values(AIRunStatus);

describe("AI task status predicates", () => {
  test.each([
    [AIRunStatus.Queued, true, false, false, false],
    [AIRunStatus.Running, true, false, false, false],
    [AIRunStatus.WaitingForApproval, true, false, false, false],
    [AIRunStatus.Completed, false, false, false, true],
    [AIRunStatus.NoFixFound, false, false, true, false],
    [AIRunStatus.Error, false, true, false, false],
    [AIRunStatus.Stale, false, true, false, false],
    [AIRunStatus.Cancelled, false, false, false, false],
  ])(
    "%s → active=%s failed=%s noFix=%s completed=%s",
    (
      status: AIRunStatus,
      active: boolean,
      failed: boolean,
      noFix: boolean,
      completed: boolean,
    ) => {
      const value: AIAgentTaskInfo = task(status);

      expect(isAITaskActive(value)).toBe(active);
      expect(isAITaskFailed(value)).toBe(failed);
      expect(isAITaskNoFixFound(value)).toBe(noFix);
      expect(isAITaskUnsuccessful(value)).toBe(failed || noFix);
      expect(isAITaskCompleted(value)).toBe(completed);
    },
  );

  test("covers every AIRunStatus", () => {
    expect(ALL_STATUSES).toHaveLength(8);
  });
});

describe("AI task presentation", () => {
  test("renders the three task types in a stable order", () => {
    expect(EXCEPTION_AI_TASK_TYPES).toEqual([
      CodeFixTaskType.FixException,
      CodeFixTaskType.WriteRegressionTest,
      CodeFixTaskType.ImproveExceptionHandling,
    ]);
  });

  test.each(
    EXCEPTION_AI_TASK_TYPES.map((type: ExceptionAITaskType) => {
      return [type];
    }),
  )("%s has complete, distinct wording", (type: ExceptionAITaskType) => {
    const presentation: (typeof AI_TASK_PRESENTATION)[ExceptionAITaskType] =
      AI_TASK_PRESENTATION[type];

    expect(presentation.taskType).toBe(type);
    expect(presentation.title.length).toBeGreaterThan(0);
    expect(presentation.description.length).toBeGreaterThan(20);
    expect(
      new Set([
        presentation.startActionName,
        presentation.restartActionName,
        presentation.retryActionName,
      ]).size,
    ).toBe(3);
  });

  test("keeps the fix task's established title and button", () => {
    expect(AI_TASK_PRESENTATION[CodeFixTaskType.FixException].title).toBe(
      "Fix this exception with AI",
    );
    expect(
      AI_TASK_PRESENTATION[CodeFixTaskType.FixException].startActionName,
    ).toBe("Fix with AI");
  });
});

describe("parseAIAgentTask", () => {
  test("reads every field", () => {
    expect(
      parseAIAgentTask({
        _id: "t-1",
        status: "Running",
        statusMessage: "Reading files",
        statusTitle: "In Progress",
        statusDescription: "An AI agent is working on a fix.",
        createdAt: "2026-09-14T11:42:00.000Z",
        taskType: CodeFixTaskType.WriteRegressionTest,
      }),
    ).toEqual({
      _id: "t-1",
      status: AIRunStatus.Running,
      statusMessage: "Reading files",
      statusTitle: "In Progress",
      statusDescription: "An AI agent is working on a fix.",
      createdAt: new Date("2026-09-14T11:42:00.000Z"),
      taskType: CodeFixTaskType.WriteRegressionTest,
    });
  });

  test("defaults the task type to a fix for older servers", () => {
    expect(parseAIAgentTask({ _id: "t", status: "Queued" }).taskType).toBe(
      CodeFixTaskType.FixException,
    );
  });

  test("normalizes an empty status message to undefined", () => {
    expect(
      parseAIAgentTask({ _id: "t", status: "Queued", statusMessage: "" })
        .statusMessage,
    ).toBeUndefined();
  });
});

describe("parseAIAgentTasksResponse", () => {
  test("reads the per-type task list", () => {
    const tasks: Array<AIAgentTaskInfo> = parseAIAgentTasksResponse({
      aiAgentTasks: [
        { _id: "a", status: "Completed", taskType: "FixException" },
        { _id: "b", status: "Error", taskType: "WriteRegressionTest" },
      ],
    });

    expect(
      tasks.map((value: AIAgentTaskInfo) => {
        return `${value._id}:${value.status}:${value.taskType}`;
      }),
    ).toEqual(["a:Completed:FixException", "b:Error:WriteRegressionTest"]);
  });

  test("falls back to the legacy single task", () => {
    const tasks: Array<AIAgentTaskInfo> = parseAIAgentTasksResponse({
      aiAgentTasks: [],
      aiAgentTask: { _id: "legacy", status: "Running" },
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.taskType).toBe(CodeFixTaskType.FixException);
  });

  test("skips malformed entries and tolerates empty payloads", () => {
    expect(
      parseAIAgentTasksResponse({
        aiAgentTasks: [null, "nope", { _id: "ok", status: "Queued" }],
      }).map((value: AIAgentTaskInfo) => {
        return value._id;
      }),
    ).toEqual(["ok"]);
    expect(parseAIAgentTasksResponse({})).toEqual([]);
    expect(parseAIAgentTasksResponse(null)).toEqual([]);
    expect(parseAIAgentTasksResponse(undefined)).toEqual([]);
  });

  test("findLatestAITask picks the task of the requested type", () => {
    const tasks: Array<AIAgentTaskInfo> = [
      task(AIRunStatus.Completed),
      task(AIRunStatus.Queued, {
        _id: "regression",
        taskType: CodeFixTaskType.WriteRegressionTest,
      }),
    ];

    expect(
      findLatestAITask(tasks, CodeFixTaskType.WriteRegressionTest)?._id,
    ).toBe("regression");
    expect(
      findLatestAITask(tasks, CodeFixTaskType.ImproveExceptionHandling),
    ).toBeUndefined();
  });
});

describe("parseAIFixReadinessResponse", () => {
  test("reads readiness and checks", () => {
    expect(
      parseAIFixReadinessResponse({
        ready: false,
        checks: [
          { id: "llmProvider", ok: true, title: "LLM provider", detail: "" },
          {
            id: "agentAvailable",
            ok: false,
            title: "AI agent online",
            detail: "No agent",
          },
        ],
      }),
    ).toEqual({
      ready: false,
      checks: [
        { id: "llmProvider", ok: true, title: "LLM provider", detail: "" },
        {
          id: "agentAvailable",
          ok: false,
          title: "AI agent online",
          detail: "No agent",
        },
      ],
    });
  });

  test("is not ready and has no checks when the payload is empty or malformed", () => {
    expect(parseAIFixReadinessResponse(undefined)).toEqual({
      ready: false,
      checks: [],
    });
    expect(parseAIFixReadinessResponse({ ready: true, checks: "bad" })).toEqual(
      { ready: true, checks: [] },
    );
    expect(
      parseAIFixReadinessResponse({ ready: true, checks: [null, 3] }).checks,
    ).toEqual([]);
  });
});

describe("getReadinessCheckLink", () => {
  test.each([
    ["llmProvider", PageMap.SETTINGS_AI_LLM_PROVIDERS],
    ["repositoryConnected", PageMap.CODE_REPOSITORY],
    ["repositoryResolved", PageMap.CODE_REPOSITORY],
    ["agentAvailable", PageMap.SETTINGS_RUNNERS],
  ])("links %s to the page that fixes it", (id: string, pageMap: PageMap) => {
    const link: ReturnType<typeof getReadinessCheckLink> =
      getReadinessCheckLink(id as AIFixReadinessCheckId);

    expect(link?.pageMap).toBe(pageMap);
    expect(link?.title.length).toBeGreaterThan(0);
  });

  test("has no link for an unknown check", () => {
    expect(
      getReadinessCheckLink("somethingElse" as AIFixReadinessCheckId),
    ).toBeNull();
  });
});

describe("getAIReadinessProgress", () => {
  test("counts passing checks", () => {
    const readiness: AIFixReadiness = {
      ready: false,
      checks: [
        { id: "llmProvider", ok: true, title: "", detail: "" },
        { id: "repositoryConnected", ok: false, title: "", detail: "" },
        { id: "agentAvailable", ok: false, title: "", detail: "" },
      ],
    };

    expect(getAIReadinessProgress(readiness)).toEqual({
      total: 3,
      passed: 1,
      percent: 33,
    });
  });

  test("is zero without readiness data", () => {
    expect(getAIReadinessProgress(undefined)).toEqual({
      total: 0,
      passed: 0,
      percent: 0,
    });
  });
});

describe("getAITaskCardState", () => {
  const presentation: (typeof AI_TASK_PRESENTATION)[ExceptionAITaskType] =
    AI_TASK_PRESENTATION[CodeFixTaskType.FixException];

  const gates: {
    isResolved: boolean;
    isArchived: boolean;
    isTasksLoading: boolean;
    isBlockedBySetup: boolean;
  } = {
    isResolved: false,
    isArchived: false,
    isTasksLoading: false,
    isBlockedBySetup: false,
  };

  function state(
    value: AIAgentTaskInfo | undefined,
    overrides: Partial<typeof gates> = {},
  ): AITaskCardState {
    return getAITaskCardState({
      task: value,
      presentation,
      ...gates,
      ...overrides,
    });
  }

  test("a task that never ran offers to start", () => {
    expect(state(undefined)).toEqual({
      tone: "neutral",
      statusLabel: "Not started",
      message: undefined,
      isActive: false,
      canViewTask: false,
      primaryAction: {
        kind: "start",
        label: "Fix with AI",
        isDisabled: false,
        disabledReason: undefined,
      },
    });
  });

  test.each([
    [AIRunStatus.Queued, "info", "Queued"],
    [AIRunStatus.Running, "info", "In progress"],
    [AIRunStatus.WaitingForApproval, "warning", "Waiting for approval"],
  ])(
    "an active %s task shows progress and no start button",
    (status: AIRunStatus, tone: string, label: string) => {
      const result: AITaskCardState = state(
        task(status, { statusMessage: "Reading the code" }),
      );

      expect(result.tone).toBe(tone);
      expect(result.statusLabel).toBe(label);
      expect(result.isActive).toBe(true);
      expect(result.canViewTask).toBe(true);
      expect(result.primaryAction).toBeNull();
      expect(result.message).toBe("Reading the code");
    },
  );

  test.each([
    [AIRunStatus.Error, "danger", "Failed"],
    [AIRunStatus.Stale, "danger", "Stopped responding"],
    [AIRunStatus.NoFixFound, "neutral", "No change proposed"],
  ])(
    "an unsuccessful %s task offers a retry",
    (status: AIRunStatus, tone: string, label: string) => {
      const result: AITaskCardState = state(task(status));

      expect(result.tone).toBe(tone);
      expect(result.statusLabel).toBe(label);
      expect(result.primaryAction).toMatchObject({
        kind: "retry",
        label: "Retry Fix",
        isDisabled: false,
      });
      expect(result.canViewTask).toBe(true);
    },
  );

  test("a completed task can be viewed and run again", () => {
    const result: AITaskCardState = state(task(AIRunStatus.Completed));

    expect(result.tone).toBe("success");
    expect(result.statusLabel).toBe("Completed");
    expect(result.primaryAction).toMatchObject({
      kind: "restart",
      label: "Fix Again",
    });
    expect(result.canViewTask).toBe(true);
  });

  test("a cancelled task can simply be started again", () => {
    const result: AITaskCardState = state(task(AIRunStatus.Cancelled));

    expect(result.statusLabel).toBe("Cancelled");
    expect(result.primaryAction?.kind).toBe("start");
  });

  test("falls back to the status description when the agent sent no message", () => {
    expect(state(task(AIRunStatus.Error)).message).toBe(
      "Description for Error",
    );
  });

  test.each([
    ["resolved", { isResolved: true }, AI_TASKS_PAUSED_REASON],
    ["archived", { isArchived: true }, AI_TASKS_PAUSED_REASON],
    ["blocked by setup", { isBlockedBySetup: true }, AI_TASKS_SETUP_REASON],
    ["still loading tasks", { isTasksLoading: true }, AI_TASKS_LOADING_REASON],
  ])(
    "locks the start button while %s and says why",
    (_name: string, overrides: Partial<typeof gates>, reason: string) => {
      for (const value of [
        undefined,
        task(AIRunStatus.Error),
        task(AIRunStatus.Completed),
      ]) {
        expect(state(value, overrides).primaryAction).toMatchObject({
          isDisabled: true,
          disabledReason: reason,
        });
      }
    },
  );

  test("the paused reason wins over setup and loading", () => {
    expect(
      state(undefined, {
        isResolved: true,
        isBlockedBySetup: true,
        isTasksLoading: true,
      }).primaryAction?.disabledReason,
    ).toBe(AI_TASKS_PAUSED_REASON);
  });

  test("a resolved exception still lets the user open an earlier task", () => {
    expect(
      state(task(AIRunStatus.Completed), { isResolved: true }).canViewTask,
    ).toBe(true);
  });

  test("uses each task type's own button wording", () => {
    const regression: AITaskCardState = getAITaskCardState({
      task: task(AIRunStatus.NoFixFound, {
        taskType: CodeFixTaskType.WriteRegressionTest,
      }),
      presentation: AI_TASK_PRESENTATION[CodeFixTaskType.WriteRegressionTest],
      ...gates,
    });

    expect(regression.primaryAction?.label).toBe("Retry Regression Test");
  });
});
