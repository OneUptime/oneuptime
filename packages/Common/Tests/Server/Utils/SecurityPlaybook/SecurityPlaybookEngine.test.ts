import Queue from "../../../../Server/Infrastructure/Queue";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityPlaybookRunService from "../../../../Server/Services/SecurityPlaybookRunService";
import SecurityPlaybookActions, {
  PlaybookStepContext,
  PlaybookStepOutcome,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import SecurityPlaybookEngine, {
  SECURITY_PLAYBOOK_RUN_JOB,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookEngine";
import {
  SECURITY_CASE_NOTIFICATION_JOB,
  SecurityCaseNotificationKind,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import SecurityPlaybookTargets from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookTargets";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import { SecurityCaseFeedEventType } from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import ObjectID from "../../../../Types/ObjectID";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import { testPriorityId } from "../../../Helpers/SecurityCaseValues";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SecurityPlaybookStep } from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookApprovalDecision,
  SecurityPlaybookStepResult,
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
  buildPendingStepResults,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import FeedMarkdown, { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CASE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const RUN_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const CONNECTION_ID: string = "66666666-6666-4666-8666-666666666666";

// A config each action accepts: the engine reads the steps as strictly as saving them.
function configFor(action: SecurityPlaybookActionType): JSONObject {
  switch (action) {
    case SecurityPlaybookActionType.SuspendOktaUser:
      return { connectionId: CONNECTION_ID };
    case SecurityPlaybookActionType.PostToSlack:
      return { channelName: "soc" };
    case SecurityPlaybookActionType.AddCaseNote:
      return { note: "n" };
    default:
      return {};
  }
}

// A containment step a Security Admin let run without approval.
const RUNS_WITHOUT_APPROVAL: Partial<SecurityPlaybookStep> = {
  requiresApproval: false,
  approvalTurnedOff: { at: "2026-10-20T10:00:00.000Z" },
};

function step(
  action: SecurityPlaybookActionType,
  extra: Partial<SecurityPlaybookStep> = {},
): SecurityPlaybookStep {
  return {
    id: ObjectID.generate().toString(),
    action,
    config: configFor(action),
    requiresApproval: false,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
    ...extra,
  };
}

interface RunState {
  status: SecurityPlaybookRunStatus;
  steps: Array<SecurityPlaybookStep>;
  stepResults: Array<SecurityPlaybookStepResult>;
  currentStepIndex: number;
  threatIntelMatched: boolean;
  startedAt?: Date | undefined;
  completedAt?: Date | undefined;
  errorMessage?: string | undefined;
}

let state: RunState;
let executed: Array<SecurityPlaybookActionType>;
let contexts: Array<PlaybookStepContext>;
let outcomes: Array<PlaybookStepOutcome>;
let feedItems: Array<{ eventType: string; markdown: string }>;
let spies: { cas: Spy; enqueue: Spy; selectTargets: Spy };

function userTarget(
  value: string,
  state: SecurityPlaybookTargetState = SecurityPlaybookTargetState.Proposed,
): SecurityPlaybookTarget {
  return {
    type: SecurityEntityType.User,
    value,
    reason: SecurityPlaybookTargetReason.GroupedOn,
    state,
  };
}

function useRun(
  steps: Array<SecurityPlaybookStep>,
  overrides: Partial<RunState> = {},
): void {
  state = {
    status: SecurityPlaybookRunStatus.Queued,
    steps,
    stepResults: buildPendingStepResults(steps),
    currentStepIndex: 0,
    threatIntelMatched: false,
    ...overrides,
  };
}

function runModel(): SecurityPlaybookRun {
  const run: SecurityPlaybookRun = new SecurityPlaybookRun();
  run._id = RUN_ID.toString();
  run.projectId = PROJECT_ID;
  run.securityCaseId = CASE_ID;
  run.playbookName = "Triage";
  run.status = state.status;
  run.steps = state.steps as unknown as JSONArray;
  run.stepResults = state.stepResults as unknown as JSONArray;
  run.currentStepIndex = state.currentStepIndex;
  run.threatIntelMatched = state.threatIntelMatched;
  if (state.startedAt) {
    run.startedAt = state.startedAt;
  }
  return run;
}

beforeEach(() => {
  executed = [];
  contexts = [];
  outcomes = [];
  feedItems = [];

  spies = {
    // The case is about mallory: what the target rule picks unless a test says otherwise.
    selectTargets: getJestSpyOn(
      SecurityPlaybookTargets,
      "selectTargets",
    ).mockResolvedValue([userTarget("mallory@acme.com")] as never),
    cas: getJestSpyOn(
      SecurityPlaybookRunService,
      "compareAndSetColumnsByIdWithoutHooks",
    ).mockImplementation(async (input: unknown) => {
      const { data, expectedData } = input as {
        data: Partial<RunState>;
        expectedData: Partial<RunState>;
      };

      if (expectedData.status !== state.status) {
        return false as never;
      }

      Object.assign(state, data);
      return true as never;
    }),
    enqueue: getJestSpyOn(Queue, "addJob").mockResolvedValue(
      undefined as never,
    ),
  };

  getJestSpyOn(SecurityPlaybookRunService, "findOneById").mockImplementation(
    async () => {
      return runModel() as never;
    },
  );

  getJestSpyOn(SecurityPlaybookRunService, "updateOneById").mockImplementation(
    async (input: unknown) => {
      const data: JSONObject = (input as { data: JSONObject }).data;

      if (data["stepResults"]) {
        state.stepResults = data[
          "stepResults"
        ] as unknown as Array<SecurityPlaybookStepResult>;
      }

      if (typeof data["currentStepIndex"] === "number") {
        state.currentStepIndex = data["currentStepIndex"] as number;
      }

      if (typeof data["threatIntelMatched"] === "boolean") {
        state.threatIntelMatched = data["threatIntelMatched"] as boolean;
      }

      return 1 as never;
    },
  );

  getJestSpyOn(
    SecurityPlaybookRunService,
    "updateColumnsByIdWithoutHooks",
  ).mockImplementation(async (input: unknown) => {
    Object.assign(state, (input as { data: Partial<RunState> }).data);
  });

  getJestSpyOn(SecurityCaseService, "findOneBy").mockImplementation(
    async () => {
      const securityCase: SecurityCase = new SecurityCase();
      securityCase._id = CASE_ID.toString();
      securityCase.projectId = PROJECT_ID;
      securityCase.securityCasePriorityId = testPriorityId(
        SecurityCasePriorityLevel.High,
      );
      return securityCase as never;
    },
  );

  getJestSpyOn(
    SecurityCaseFeedService,
    "createSecurityCaseFeedItem",
  ).mockImplementation(async (input: unknown) => {
    const item: { eventType: string; feedInfoInMarkdown: string } = input as {
      eventType: string;
      feedInfoInMarkdown: string;
    };
    feedItems.push({
      eventType: item.eventType,
      markdown: item.feedInfoInMarkdown,
    });
  });

  getJestSpyOn(SecurityPlaybookActions, "execute").mockImplementation(
    async (context: unknown) => {
      executed.push((context as PlaybookStepContext).step.action);
      contexts.push(context as PlaybookStepContext);
      return (outcomes.shift() || {
        status: SecurityPlaybookStepStatus.Succeeded,
        summary: mdText`Done.`,
      }) as never;
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SecurityPlaybookEngine.enqueueRun", () => {
  test("queues the run on the worker queue under a job id of its own each time", async () => {
    await SecurityPlaybookEngine.enqueueRun(RUN_ID);
    await SecurityPlaybookEngine.enqueueRun(RUN_ID);

    const calls: Array<Array<unknown>> = spies.enqueue.mock.calls;

    expect(calls[0]![2]).toBe(SECURITY_PLAYBOOK_RUN_JOB);
    expect(calls[0]![3]).toEqual({ runId: RUN_ID.toString() });
    expect(String(calls[0]![1])).toContain(RUN_ID.toString());
  });
});

describe("SecurityPlaybookEngine.executeRun", () => {
  test("does nothing with a run it cannot claim", async () => {
    useRun([step(SecurityPlaybookActionType.AddCaseNote)], {
      status: SecurityPlaybookRunStatus.Running,
    });

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toEqual([]);
  });

  test("runs every step in order and finishes Succeeded", async () => {
    useRun([
      step(SecurityPlaybookActionType.CheckThreatIntel),
      step(SecurityPlaybookActionType.AddCaseNote),
    ]);

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toEqual([
      SecurityPlaybookActionType.CheckThreatIntel,
      SecurityPlaybookActionType.AddCaseNote,
    ]);
    expect(state.status).toBe(SecurityPlaybookRunStatus.Succeeded);
    expect(state.completedAt).toBeInstanceOf(Date);
    expect(state.currentStepIndex).toBe(2);
    expect(
      state.stepResults.map((result: SecurityPlaybookStepResult) => {
        return result.status;
      }),
    ).toEqual([
      SecurityPlaybookStepStatus.Succeeded,
      SecurityPlaybookStepStatus.Succeeded,
    ]);
    expect(feedItems[feedItems.length - 1]!.markdown).toContain(
      "finished: 2 steps ran",
    );
  });

  test("stops before a step that needs approval, and says so on the case", async () => {
    useRun([
      step(SecurityPlaybookActionType.CheckThreatIntel),
      step(SecurityPlaybookActionType.SuspendOktaUser, {
        requiresApproval: true,
      }),
      step(SecurityPlaybookActionType.AddCaseNote),
    ]);

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toEqual([SecurityPlaybookActionType.CheckThreatIntel]);
    expect(state.status).toBe(SecurityPlaybookRunStatus.WaitingForApproval);
    expect(state.currentStepIndex).toBe(1);
    expect(state.stepResults[1]!.status).toBe(
      SecurityPlaybookStepStatus.WaitingForApproval,
    );
    expect(
      feedItems.some((item: { eventType: string }) => {
        return item.eventType === SecurityCaseFeedEventType.ApprovalRequested;
      }),
    ).toBe(true);
  });

  test("asks the people who can approve, through a notification job", async () => {
    useRun([
      step(SecurityPlaybookActionType.SuspendOktaUser, {
        requiresApproval: true,
      }),
    ]);

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    const jobs: Array<Array<unknown>> = spies.enqueue.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return call[2] === SECURITY_CASE_NOTIFICATION_JOB;
      },
    );

    expect(jobs).toHaveLength(1);
    expect(jobs[0]![3]).toEqual({
      kind: SecurityCaseNotificationKind.ApprovalRequested,
      projectId: PROJECT_ID.toString(),
      securityCaseId: CASE_ID.toString(),
      runId: RUN_ID.toString(),
    });
  });

  test("a run cancelled as it stops for approval asks nobody", async () => {
    useRun([
      step(SecurityPlaybookActionType.SuspendOktaUser, {
        requiresApproval: true,
      }),
    ]);

    // Cancelled between the step's result and the move to Waiting for Approval.
    spies.cas.mockImplementation(async (input: unknown) => {
      const { data, expectedData } = input as {
        data: Partial<RunState>;
        expectedData: Partial<RunState>;
      };

      if (data.status === SecurityPlaybookRunStatus.WaitingForApproval) {
        state.status = SecurityPlaybookRunStatus.Cancelled;
        return false as never;
      }

      if (expectedData.status !== state.status) {
        return false as never;
      }

      Object.assign(state, data);
      return true as never;
    });

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(
      spies.enqueue.mock.calls.filter((call: Array<unknown>): boolean => {
        return call[2] === SECURITY_CASE_NOTIFICATION_JOB;
      }),
    ).toEqual([]);
  });

  test("carries on from an approved step", async () => {
    const steps: Array<SecurityPlaybookStep> = [
      step(SecurityPlaybookActionType.CheckThreatIntel),
      step(SecurityPlaybookActionType.SuspendOktaUser, {
        requiresApproval: true,
      }),
      step(SecurityPlaybookActionType.AddCaseNote),
    ];
    const results: Array<SecurityPlaybookStepResult> =
      buildPendingStepResults(steps);
    results[0]!.status = SecurityPlaybookStepStatus.Succeeded;
    results[1]!.approval = {
      decision: SecurityPlaybookApprovalDecision.Approved,
      decidedByUserId: "u1",
      decidedAt: "2026-10-14T09:00:00.000Z",
    };

    useRun(steps, { stepResults: results, currentStepIndex: 1 });

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toEqual([
      SecurityPlaybookActionType.SuspendOktaUser,
      SecurityPlaybookActionType.AddCaseNote,
    ]);
    expect(state.status).toBe(SecurityPlaybookRunStatus.Succeeded);
    // The decision stays on the step's result.
    expect(state.stepResults[1]!.approval?.decidedByUserId).toBe("u1");
  });

  test("holds a containment step for approval even when it says it needs none, unless a Security Admin stamped it off", async () => {
    useRun([
      step(SecurityPlaybookActionType.SuspendOktaUser, {
        requiresApproval: false,
      }),
    ]);

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toEqual([]);
    expect(state.status).toBe(SecurityPlaybookRunStatus.WaitingForApproval);

    useRun([
      step(SecurityPlaybookActionType.SuspendOktaUser, {
        requiresApproval: false,
        approvalTurnedOff: {
          byUserId: "77777777-7777-4777-8777-777777777777",
          at: "2026-10-20T10:00:00.000Z",
        },
      }),
    ]);

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toEqual([SecurityPlaybookActionType.SuspendOktaUser]);
    expect(state.status).toBe(SecurityPlaybookRunStatus.Succeeded);
  });

  test("picks a containment step's targets before it waits, keeps them on the step, and names them on the case", async () => {
    spies.selectTargets.mockResolvedValue([
      userTarget("mallory@acme.com"),
      userTarget("breakglass@acme.com", SecurityPlaybookTargetState.Protected),
    ] as never);

    useRun([
      step(SecurityPlaybookActionType.SuspendOktaUser, {
        requiresApproval: true,
      }),
    ]);

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(state.status).toBe(SecurityPlaybookRunStatus.WaitingForApproval);
    expect(
      state.stepResults[0]!.targets?.map(
        (target: SecurityPlaybookTarget): string => {
          return `${target.value}: ${target.state}`;
        },
      ),
    ).toEqual(["mallory@acme.com: Proposed", "breakglass@acme.com: Protected"]);
    expect(
      feedItems.find((item: { eventType: string }) => {
        return item.eventType === SecurityCaseFeedEventType.ApprovalRequested;
      })?.markdown,
    ).toContain("(Suspend the user in Okta) on `mallory@acme.com`.");
  });

  test("skips a containment step with nothing to act on, rather than ask for an approval of nothing", async () => {
    spies.selectTargets.mockResolvedValue([
      {
        ...userTarget(
          "breakglass@acme.com",
          SecurityPlaybookTargetState.Protected,
        ),
        protectedBy: "breakglass@acme.com",
      },
    ] as never);

    useRun([
      step(SecurityPlaybookActionType.SuspendOktaUser, {
        requiresApproval: true,
      }),
      step(SecurityPlaybookActionType.AddCaseNote),
    ]);

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toEqual([SecurityPlaybookActionType.AddCaseNote]);
    expect(state.status).toBe(SecurityPlaybookRunStatus.Succeeded);
    expect(state.stepResults[0]!.status).toBe(
      SecurityPlaybookStepStatus.Skipped,
    );
    expect(state.stepResults[0]!.message).toBe(
      "No user to act on: `breakglass@acme.com` is protected.",
    );
    expect(
      feedItems.some((item: { eventType: string }) => {
        return item.eventType === SecurityCaseFeedEventType.ApprovalRequested;
      }),
    ).toBe(false);
  });

  test("acts on the targets as the approver left them, and keeps what became of each", async () => {
    const steps: Array<SecurityPlaybookStep> = [
      step(SecurityPlaybookActionType.SuspendOktaUser, {
        requiresApproval: true,
      }),
    ];
    const results: Array<SecurityPlaybookStepResult> =
      buildPendingStepResults(steps);
    results[0]!.targets = [
      userTarget("mallory@acme.com"),
      userTarget("bob@acme.com", SecurityPlaybookTargetState.LeftOut),
    ];
    results[0]!.approval = {
      decision: SecurityPlaybookApprovalDecision.Approved,
      decidedByUserId: "u2",
      decidedAt: "2026-10-14T09:00:00.000Z",
      targets: ["mallory@acme.com"],
    };

    outcomes.push({
      status: SecurityPlaybookStepStatus.Succeeded,
      summary: mdText`Suspend the user in Okta: done for mallory.`,
      targets: [
        {
          ...userTarget("mallory@acme.com"),
          state: SecurityPlaybookTargetState.Done,
          detail: "suspended",
        },
        userTarget("bob@acme.com", SecurityPlaybookTargetState.LeftOut),
      ],
    });

    useRun(steps, { stepResults: results });

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    // The rule is not asked again: the approver decided on these.
    expect(spies.selectTargets).not.toHaveBeenCalled();
    expect(
      contexts[0]!.targets?.map((target: SecurityPlaybookTarget): string => {
        return `${target.value}: ${target.state}`;
      }),
    ).toEqual(["mallory@acme.com: Proposed", "bob@acme.com: Left Out"]);
    expect(state.stepResults[0]!.targets?.[0]).toMatchObject({
      value: "mallory@acme.com",
      state: SecurityPlaybookTargetState.Done,
      detail: "suspended",
    });
  });

  test("skips a step that waits on threat intel when nothing matched", async () => {
    useRun([
      step(SecurityPlaybookActionType.CheckThreatIntel),
      step(SecurityPlaybookActionType.SuspendOktaUser, {
        onlyIfThreatIntelMatched: true,
      }),
    ]);

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toEqual([SecurityPlaybookActionType.CheckThreatIntel]);
    expect(state.stepResults[1]!.status).toBe(
      SecurityPlaybookStepStatus.Skipped,
    );
    expect(state.status).toBe(SecurityPlaybookRunStatus.Succeeded);
  });

  test("runs it when an earlier step of the run found a match", async () => {
    outcomes.push({
      status: SecurityPlaybookStepStatus.Succeeded,
      summary: mdText`1 entity is known-bad.`,
      threatIntelMatched: true,
    });

    useRun([
      step(SecurityPlaybookActionType.CheckThreatIntel),
      step(SecurityPlaybookActionType.SuspendOktaUser, {
        onlyIfThreatIntelMatched: true,
        ...RUNS_WITHOUT_APPROVAL,
      }),
    ]);

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toEqual([
      SecurityPlaybookActionType.CheckThreatIntel,
      SecurityPlaybookActionType.SuspendOktaUser,
    ]);
    expect(state.threatIntelMatched).toBe(true);
  });

  test("stops at a failed step and records why", async () => {
    outcomes.push({
      status: SecurityPlaybookStepStatus.Failed,
      summary: FeedMarkdown.empty(),
      error: "Okta said no",
    });

    useRun([
      step(SecurityPlaybookActionType.SuspendOktaUser, RUNS_WITHOUT_APPROVAL),
      step(SecurityPlaybookActionType.AddCaseNote),
    ]);

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toEqual([SecurityPlaybookActionType.SuspendOktaUser]);
    expect(state.status).toBe(SecurityPlaybookRunStatus.Failed);
    expect(state.errorMessage).toContain(
      "Step 1 (Suspend the user in Okta) failed: Okta said no",
    );
    expect(state.stepResults[1]!.status).toBe(
      SecurityPlaybookStepStatus.Pending,
    );
  });

  test("goes on past a failed step that may fail", async () => {
    outcomes.push({
      status: SecurityPlaybookStepStatus.Failed,
      summary: FeedMarkdown.empty(),
      error: "Slack is down",
    });

    useRun([
      step(SecurityPlaybookActionType.PostToSlack, { continueOnFailure: true }),
      step(SecurityPlaybookActionType.AddCaseNote),
    ]);

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toHaveLength(2);
    expect(state.status).toBe(SecurityPlaybookRunStatus.Succeeded);
    expect(feedItems[feedItems.length - 1]!.markdown).toContain(
      "1 failed and the run went on",
    );
  });

  test("turns an action that throws into a failed step", async () => {
    getJestSpyOn(SecurityPlaybookActions, "execute").mockImplementation(
      async () => {
        throw new Error("boom");
      },
    );

    useRun([step(SecurityPlaybookActionType.AddCaseNote)]);

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(state.status).toBe(SecurityPlaybookRunStatus.Failed);
    expect(state.stepResults[0]!.error).toBe("boom");
  });

  test("stops between steps once somebody cancels, and keeps their Cancelled", async () => {
    getJestSpyOn(SecurityPlaybookActions, "execute").mockImplementation(
      async (context: unknown) => {
        executed.push((context as PlaybookStepContext).step.action);
        state.status = SecurityPlaybookRunStatus.Cancelled;
        return {
          status: SecurityPlaybookStepStatus.Succeeded,
          summary: mdText`Done.`,
        } as never;
      },
    );

    useRun([
      step(SecurityPlaybookActionType.CheckThreatIntel),
      step(SecurityPlaybookActionType.AddCaseNote),
    ]);

    await SecurityPlaybookEngine.executeRun(RUN_ID);

    expect(executed).toEqual([SecurityPlaybookActionType.CheckThreatIntel]);
    expect(state.status).toBe(SecurityPlaybookRunStatus.Cancelled);
  });
});
