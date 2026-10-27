import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ObjectID from "Common/Types/ObjectID";
import { ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import { getOnCallPolicyRunEndedWhileWaitingMessage } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPolicyAiHoldOutcome } from "Common/Types/OnCallDutyPolicy/OnCallPolicyAiHold";

/*
 * A RUN ONEUPTIME AI HOLDS, EACH MINUTE UNTIL IT PAGES OR ENDS.
 *
 * A run an After OneUptime AI rule holds (OnCallPolicyAiHold) waits as a
 * working-hours run does, marked Holding, and the worker treats it the same
 * way. What it adds is how the hold ended, written in the claim that ends
 * or starts the run:
 *
 *   - its record was resolved or acknowledged: the outcome AiFirstResponder
 *     reads from how (classifyEndedHold) - AI's verified fix, a person, or
 *     the record recovering on its own;
 *   - its hold time ran out: Hold time ran out, and it pages;
 *   - its policy was archived: no hold any more (null), and nobody is paged.
 *
 * A working-hours run says nothing of a hold, and AI is never asked about it.
 * The job registers itself through RunCron at import time and exports
 * nothing, so the Cron util is mocked to capture the handler and each test
 * drives one tick.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/OnCallDutyPolicyExecutionLogService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
      claimEscalationAdvance: jest.fn(),
      startWaitingRun: jest.fn(),
      endWaitingRun: jest.fn(),
    },
  };
});

jest.mock(
  "Common/Server/Services/OnCallDutyPolicyEscalationRuleService",
  () => {
    return {
      __esModule: true,
      default: {
        findOneBy: jest.fn(),
        startRuleExecution: jest.fn(),
      },
    };
  },
);

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: { isIncidentAcknowledged: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: { isAlertAcknowledged: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AlertEpisodeService", () => {
  return {
    __esModule: true,
    default: { isEpisodeAcknowledged: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentEpisodeService", () => {
  return {
    __esModule: true,
    default: { isEpisodeAcknowledged: jest.fn() },
  };
});

jest.mock(
  "Common/Server/Services/OnCallDutyPolicyExecutionLogTimelineService",
  () => {
    return {
      __esModule: true,
      default: {
        create: jest.fn(),
        findBy: jest.fn(async () => {
          return [];
        }),
      },
    };
  },
);

jest.mock("Common/Server/Utils/AI/FirstResponder/AiFirstResponder", () => {
  return {
    __esModule: true,
    default: { classifyEndedHold: jest.fn() },
  };
});

import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyEscalationRuleService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import AlertService from "Common/Server/Services/AlertService";
import AiFirstResponder from "Common/Server/Utils/AI/FirstResponder/AiFirstResponder";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions";

const JOB_NAME: string =
  "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions";

const executionLogService: {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  claimEscalationAdvance: jest.Mock;
  startWaitingRun: jest.Mock;
  endWaitingRun: jest.Mock;
} = OnCallDutyPolicyExecutionLogService as unknown as {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  claimEscalationAdvance: jest.Mock;
  startWaitingRun: jest.Mock;
  endWaitingRun: jest.Mock;
};

const ruleService: {
  findOneBy: jest.Mock;
  startRuleExecution: jest.Mock;
} = OnCallDutyPolicyEscalationRuleService as unknown as {
  findOneBy: jest.Mock;
  startRuleExecution: jest.Mock;
};

const incidentService: { isIncidentAcknowledged: jest.Mock } =
  IncidentService as unknown as { isIncidentAcknowledged: jest.Mock };
const alertService: { isAlertAcknowledged: jest.Mock } =
  AlertService as unknown as { isAlertAcknowledged: jest.Mock };
const firstResponder: { classifyEndedHold: jest.Mock } =
  AiFirstResponder as unknown as { classifyEndedHold: jest.Mock };

const MINUTE: number = 60 * 1000;

type HeldRecordKind = "alert" | "incident";

/*
 * A run held while OneUptime AI works on its incident (or alert): created a
 * few minutes ago, paging at the end of its hold time.
 */
function held(data: {
  pagingStartsAt: Date;
  recordKind?: HeldRecordKind | undefined;
  aiHoldOutcome?: OnCallPolicyAiHoldOutcome | undefined;
  isArchived?: boolean | undefined;
}): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = ObjectID.generate();
  log.projectId = ObjectID.generate();
  log.onCallDutyPolicyId = ObjectID.generate();
  log.status = OnCallDutyPolicyStatus.Waiting;
  log.statusMessage =
    "Waiting for OneUptime AI. Paging starts 10:40 unless it resolves this.";
  log.createdAt = new Date(Date.now() - 4 * MINUTE);
  log.pagingStartsAt = data.pagingStartsAt;
  log.onCallPolicyExecutionRepeatCount = 1;
  log.aiHoldOutcome = data.aiHoldOutcome || OnCallPolicyAiHoldOutcome.Holding;

  if ((data.recordKind || "incident") === "incident") {
    log.triggeredByIncidentId = ObjectID.generate();
  } else {
    log.triggeredByAlertId = ObjectID.generate();
  }

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes = 0;

  if (data.isArchived !== undefined) {
    policy.isArchived = data.isArchived;
  }

  log.onCallDutyPolicy = policy;
  return log;
}

// The same run, held for working hours instead: no AI hold on it.
function heldForWorkingHours(
  pagingStartsAt: Date,
): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = held({
    pagingStartsAt: pagingStartsAt,
  });
  (log as unknown as Record<string, unknown>)["aiHoldOutcome"] = undefined;
  log.statusMessage =
    "Waiting for working hours. Paging starts Tue 09:00 (Europe/London).";
  return log;
}

function markHandled(kind: HeldRecordKind): void {
  if (kind === "incident") {
    incidentService.isIncidentAcknowledged.mockResolvedValue(true);
  } else {
    alertService.isAlertAcknowledged.mockResolvedValue(true);
  }
}

async function tick(): Promise<void> {
  const handler: CronHandler | undefined = mockCapturedJobs[JOB_NAME];

  if (!handler) {
    throw new Error(`${JOB_NAME} did not register`);
  }

  await handler();
}

beforeEach(() => {
  jest.clearAllMocks();
  executionLogService.updateOneById.mockResolvedValue(undefined);
  executionLogService.claimEscalationAdvance.mockResolvedValue(true);
  executionLogService.startWaitingRun.mockResolvedValue(true);
  executionLogService.endWaitingRun.mockResolvedValue(true);
  incidentService.isIncidentAcknowledged.mockResolvedValue(false);
  alertService.isAlertAcknowledged.mockResolvedValue(false);
  ruleService.findOneBy.mockResolvedValue(null);
  firstResponder.classifyEndedHold.mockResolvedValue(
    OnCallPolicyAiHoldOutcome.ResolvedByAI,
  );
});

describe("the runs the worker reads", () => {
  test("say whether OneUptime AI holds them", async () => {
    executionLogService.findAllBy.mockResolvedValue([]);

    await tick();

    const findBy: { select: Record<string, unknown> } =
      executionLogService.findAllBy.mock.calls[0]![0];

    expect(findBy.select["aiHoldOutcome"]).toBe(true);
  });
});

describe("a run OneUptime AI holds", () => {
  test("while AI works, pages nobody, writes nothing and asks AI nothing", async () => {
    const log: OnCallDutyPolicyExecutionLog = held({
      pagingStartsAt: new Date(Date.now() + 6 * MINUTE),
    });
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    // Its incident is still asked about: resolved now, it ends now.
    expect(incidentService.isIncidentAcknowledged).toHaveBeenCalledWith({
      incidentId: log.triggeredByIncidentId,
    });
    expect(executionLogService.startWaitingRun).not.toHaveBeenCalled();
    expect(executionLogService.endWaitingRun).not.toHaveBeenCalled();
    expect(executionLogService.updateOneById).not.toHaveBeenCalled();
    expect(firstResponder.classifyEndedHold).not.toHaveBeenCalled();
    expect(ruleService.startRuleExecution).not.toHaveBeenCalled();
  });

  test("once its hold time runs out, pages, saying the hold time ran out", async () => {
    const log: OnCallDutyPolicyExecutionLog = held({
      pagingStartsAt: new Date(Date.now() - 20 * 1000),
    });
    executionLogService.findAllBy.mockResolvedValue([log]);

    const before: number = Date.now();
    await tick();

    expect(executionLogService.startWaitingRun).toHaveBeenCalledTimes(1);

    const start: {
      run: OnCallDutyPolicyExecutionLog;
      now: Date;
      aiHoldOutcome?: OnCallPolicyAiHoldOutcome;
    } = executionLogService.startWaitingRun.mock.calls[0]![0];

    expect(start.run).toBe(log);
    expect(start.now.getTime()).toBeGreaterThanOrEqual(before);
    expect(start.aiHoldOutcome).toBe(OnCallPolicyAiHoldOutcome.HoldTimeRanOut);
    expect(executionLogService.endWaitingRun).not.toHaveBeenCalled();
    expect(firstResponder.classifyEndedHold).not.toHaveBeenCalled();
  });

  test.each([
    OnCallPolicyAiHoldOutcome.ResolvedByAI,
    OnCallPolicyAiHoldOutcome.RecoveredOnItsOwn,
    OnCallPolicyAiHoldOutcome.HandledByPerson,
  ])(
    "whose incident is resolved while held, ends unpaged, saying how (%s)",
    async (outcome: OnCallPolicyAiHoldOutcome) => {
      const log: OnCallDutyPolicyExecutionLog = held({
        pagingStartsAt: new Date(Date.now() + 6 * MINUTE),
      });
      executionLogService.findAllBy.mockResolvedValue([log]);
      markHandled("incident");
      firstResponder.classifyEndedHold.mockResolvedValue(outcome);

      await tick();

      expect(firstResponder.classifyEndedHold).toHaveBeenCalledWith(log);
      expect(executionLogService.endWaitingRun).toHaveBeenCalledWith({
        executionLogId: log.id,
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: getOnCallPolicyRunEndedWhileWaitingMessage("incident"),
        aiHoldOutcome: outcome,
      });
      expect(executionLogService.startWaitingRun).not.toHaveBeenCalled();
      expect(ruleService.startRuleExecution).not.toHaveBeenCalled();
    },
  );

  test("whose alert is resolved while held, ends unpaged, saying how", async () => {
    const log: OnCallDutyPolicyExecutionLog = held({
      pagingStartsAt: new Date(Date.now() + 6 * MINUTE),
      recordKind: "alert",
    });
    executionLogService.findAllBy.mockResolvedValue([log]);
    markHandled("alert");

    await tick();

    expect(executionLogService.endWaitingRun).toHaveBeenCalledWith({
      executionLogId: log.id,
      status: OnCallDutyPolicyStatus.Completed,
      statusMessage: getOnCallPolicyRunEndedWhileWaitingMessage("alert"),
      aiHoldOutcome: OnCallPolicyAiHoldOutcome.ResolvedByAI,
    });
  });

  test("whose incident was resolved just as its hold time ran out, ends rather than pages", async () => {
    const log: OnCallDutyPolicyExecutionLog = held({
      pagingStartsAt: new Date(Date.now() - 1000),
    });
    executionLogService.findAllBy.mockResolvedValue([log]);
    markHandled("incident");

    await tick();

    expect(executionLogService.endWaitingRun).toHaveBeenCalledTimes(1);
    expect(executionLogService.startWaitingRun).not.toHaveBeenCalled();
  });

  test("whose policy was archived while held, ends unpaged and is no hold any more", async () => {
    const log: OnCallDutyPolicyExecutionLog = held({
      pagingStartsAt: new Date(Date.now() - 1000),
      isArchived: true,
    });
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(executionLogService.endWaitingRun).toHaveBeenCalledWith({
      executionLogId: log.id,
      status: OnCallDutyPolicyStatus.Error,
      statusMessage: ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
      aiHoldOutcome: null,
    });
    expect(executionLogService.startWaitingRun).not.toHaveBeenCalled();
    expect(firstResponder.classifyEndedHold).not.toHaveBeenCalled();
  });

  test("counts as held only while marked Holding", async () => {
    const log: OnCallDutyPolicyExecutionLog = held({
      pagingStartsAt: new Date(Date.now() - 1000),
      aiHoldOutcome: OnCallPolicyAiHoldOutcome.HandedOff,
    });
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(executionLogService.startWaitingRun).toHaveBeenCalledTimes(1);
    expect(
      executionLogService.startWaitingRun.mock.calls[0]![0].aiHoldOutcome,
    ).toBeUndefined();
  });

  test("whose hold cannot be classified fails as any run that fails does, paging nobody", async () => {
    const log: OnCallDutyPolicyExecutionLog = held({
      pagingStartsAt: new Date(Date.now() + 6 * MINUTE),
    });
    executionLogService.findAllBy.mockResolvedValue([log]);
    markHandled("incident");
    firstResponder.classifyEndedHold.mockRejectedValue(
      new Error("Database is down"),
    );

    await tick();

    // The tick says what went wrong on the run, as for any run that fails.
    expect(executionLogService.endWaitingRun).not.toHaveBeenCalled();
    expect(executionLogService.updateOneById).toHaveBeenCalledWith({
      id: log.id,
      data: {
        status: OnCallDutyPolicyStatus.Error,
        statusMessage: "Database is down",
      },
      props: { isRoot: true },
    });
    expect(ruleService.startRuleExecution).not.toHaveBeenCalled();
  });
});

describe("a run held for working hours", () => {
  test("once its moment comes, pages with no hold outcome", async () => {
    const log: OnCallDutyPolicyExecutionLog = heldForWorkingHours(
      new Date(Date.now() - 1000),
    );
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(executionLogService.startWaitingRun).toHaveBeenCalledTimes(1);
    expect(
      executionLogService.startWaitingRun.mock.calls[0]![0].aiHoldOutcome,
    ).toBeUndefined();
  });

  test("handled while it waits, ends without asking OneUptime AI anything", async () => {
    const log: OnCallDutyPolicyExecutionLog = heldForWorkingHours(
      new Date(Date.now() + 3 * 60 * MINUTE),
    );
    executionLogService.findAllBy.mockResolvedValue([log]);
    markHandled("incident");

    await tick();

    expect(firstResponder.classifyEndedHold).not.toHaveBeenCalled();
    expect(
      executionLogService.endWaitingRun.mock.calls[0]![0].aiHoldOutcome,
    ).toBeUndefined();
  });

  test("whose policy was archived, ends without touching a hold it never had", async () => {
    const log: OnCallDutyPolicyExecutionLog = heldForWorkingHours(
      new Date(Date.now() - 1000),
    );
    log.onCallDutyPolicy!.isArchived = true;
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(
      executionLogService.endWaitingRun.mock.calls[0]![0].aiHoldOutcome,
    ).toBeUndefined();
  });
});
