import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";

/*
 * A PAGE AGAIN, AS THE WORKER THAT MOVES RUNS ON SEES IT.
 *
 * A run is over once its record is acknowledged or resolved: nobody else
 * needs paging. A page again (OnCallAcknowledgementTimeout) pages about a
 * record that was acknowledged all along - ending it for that would end it
 * at its first tick, before any later escalation rule paged anybody. It is
 * over once the record is resolved (or somebody acknowledges the page again
 * itself, which ends it where they do). Until then it moves on through the
 * policy's rules like any run. Every other run is ended by its record's
 * acknowledgement, as it always was.
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

jest.mock("Common/Server/Utils/OnCall/OnCallAcknowledgementTimeout", () => {
  return {
    __esModule: true,
    default: {
      getRunRecord: jest.fn((run: Record<string, unknown>) => {
        if (run["triggeredByIncidentId"]) {
          return { kind: "incident", recordId: run["triggeredByIncidentId"] };
        }

        if (run["triggeredByAlertId"]) {
          return { kind: "alert", recordId: run["triggeredByAlertId"] };
        }

        return null;
      }),
      readRecordState: jest.fn(),
    },
  };
});

jest.mock(
  "Common/Server/Services/OnCallDutyPolicyExecutionLogTimelineService",
  () => {
    return {
      __esModule: true,
      default: {
        create: jest.fn(),
        countBy: jest.fn(),
        findBy: jest.fn(async () => {
          return [];
        }),
      },
    };
  },
);

import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyEscalationRuleService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import AlertService from "Common/Server/Services/AlertService";
import OnCallAcknowledgementTimeout from "Common/Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions";

const JOB_NAME: string =
  "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions";

const executionLogService: {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  claimEscalationAdvance: jest.Mock;
} = OnCallDutyPolicyExecutionLogService as unknown as {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  claimEscalationAdvance: jest.Mock;
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

const timeout: { readRecordState: jest.Mock } =
  OnCallAcknowledgementTimeout as unknown as { readRecordState: jest.Mock };

const LEVEL_2_ID: ObjectID = new ObjectID(
  "9d000000-0000-4000-8000-000000000002",
);

// A run on Level 1 of a two-level policy, its 30-minute wait over.
function runOnLevelOne(data: {
  pageAgainNumber?: number | undefined;
  alert?: boolean | undefined;
}): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = new ObjectID("9d000000-0000-4000-8000-000000000010");
  log.projectId = new ObjectID("9d000000-0000-4000-8000-000000000011");
  log.onCallDutyPolicyId = new ObjectID("9d000000-0000-4000-8000-000000000012");

  if (data.alert) {
    log.triggeredByAlertId = new ObjectID(
      "9d000000-0000-4000-8000-000000000013",
    );
  } else {
    log.triggeredByIncidentId = new ObjectID(
      "9d000000-0000-4000-8000-000000000013",
    );
  }

  log.status = OnCallDutyPolicyStatus.Executing;
  log.lastExecutedEscalationRuleOrder = 1;
  log.executeNextEscalationRuleInMinutes = 30;
  log.lastEscalationRuleExecutedAt = new Date(Date.now() - 31 * 60 * 1000);
  log.createdAt = new Date(Date.now() - 31 * 60 * 1000);
  log.onCallPolicyExecutionRepeatCount = 1;

  if (data.pageAgainNumber !== undefined) {
    log.pageAgainNumber = data.pageAgainNumber;
  }

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.isArchived = false;
  log.onCallDutyPolicy = policy;

  return log;
}

async function tick(): Promise<void> {
  const handler: CronHandler | undefined = mockCapturedJobs[JOB_NAME];

  if (!handler) {
    throw new Error(`${JOB_NAME} did not register`);
  }

  await handler();
}

function statusUpdates(): Array<{ status?: string; statusMessage?: string }> {
  return executionLogService.updateOneById.mock.calls
    .map((call: Array<unknown>) => {
      return (call[0] as { data: { status?: string; statusMessage?: string } })
        .data;
    })
    .filter((data: { status?: string }) => {
      return Boolean(data.status);
    });
}

beforeEach(() => {
  jest.clearAllMocks();
  executionLogService.updateOneById.mockResolvedValue(undefined);
  executionLogService.claimEscalationAdvance.mockResolvedValue(true);
  ruleService.startRuleExecution.mockResolvedValue(undefined);

  // The record is acknowledged, not resolved.
  incidentService.isIncidentAcknowledged.mockResolvedValue(true);
  alertService.isAlertAcknowledged.mockResolvedValue(true);
  timeout.readRecordState.mockResolvedValue({
    isAcknowledged: true,
    isResolved: false,
  });

  ruleService.findOneBy.mockImplementation(
    (args: {
      query: { order: number };
    }): Promise<OnCallDutyPolicyEscalationRule | null> => {
      if (args.query.order === 2) {
        const rule: OnCallDutyPolicyEscalationRule =
          new OnCallDutyPolicyEscalationRule();
        rule.id = LEVEL_2_ID;
        rule.order = 2;
        return Promise.resolve(rule);
      }

      return Promise.resolve(null);
    },
  );
});

describe("a page again whose incident is acknowledged, as it was all along", () => {
  test("is not ended: its wait over, it moves on to Level 2", async () => {
    const log: OnCallDutyPolicyExecutionLog = runOnLevelOne({
      pageAgainNumber: 1,
    });
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(statusUpdates()).toEqual([]);
    expect(ruleService.startRuleExecution).toHaveBeenCalledTimes(1);
    expect(String(ruleService.startRuleExecution.mock.calls[0]![0])).toBe(
      LEVEL_2_ID.toString(),
    );
    // Its record's acknowledgement is not what is asked.
    expect(incidentService.isIncidentAcknowledged).not.toHaveBeenCalled();
  });

  test("an alert's page again too", async () => {
    const log: OnCallDutyPolicyExecutionLog = runOnLevelOne({
      pageAgainNumber: 3,
      alert: true,
    });
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(statusUpdates()).toEqual([]);
    expect(alertService.isAlertAcknowledged).not.toHaveBeenCalled();
    expect(ruleService.startRuleExecution).toHaveBeenCalledTimes(1);
  });
});

describe("a page again whose record is resolved", () => {
  test("ends, saying the incident is resolved", async () => {
    timeout.readRecordState.mockResolvedValue({
      isAcknowledged: true,
      isResolved: true,
    });

    const log: OnCallDutyPolicyExecutionLog = runOnLevelOne({
      pageAgainNumber: 1,
    });
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(statusUpdates()).toEqual([
      {
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: "Execution completed because incident is resolved.",
      },
    ]);
    expect(ruleService.startRuleExecution).not.toHaveBeenCalled();
  });

  test("an alert's says the alert is resolved", async () => {
    timeout.readRecordState.mockResolvedValue({
      isAcknowledged: true,
      isResolved: true,
    });

    executionLogService.findAllBy.mockResolvedValue([
      runOnLevelOne({ pageAgainNumber: 1, alert: true }),
    ]);

    await tick();

    expect(statusUpdates()[0]!.statusMessage).toBe(
      "Execution completed because alert is resolved.",
    );
  });
});

describe("a page again whose record is gone", () => {
  test("ends with an error that says so", async () => {
    timeout.readRecordState.mockResolvedValue(null);

    executionLogService.findAllBy.mockResolvedValue([
      runOnLevelOne({ pageAgainNumber: 1 }),
    ]);

    await tick();

    expect(statusUpdates()).toEqual([
      {
        status: OnCallDutyPolicyStatus.Error,
        statusMessage: "The incident this page is about is gone.",
      },
    ]);
  });
});

describe("every other run", () => {
  test("is ended by its record's acknowledgement, as it always was", async () => {
    executionLogService.findAllBy.mockResolvedValue([runOnLevelOne({})]);

    await tick();

    expect(statusUpdates()).toEqual([
      {
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage:
          "Execution completed because incident is acknowledged or resolved.",
      },
    ]);
    expect(ruleService.startRuleExecution).not.toHaveBeenCalled();
    expect(timeout.readRecordState).not.toHaveBeenCalled();
  });
});

describe("the sweep", () => {
  test("reads whether each run is a page again", async () => {
    executionLogService.findAllBy.mockResolvedValue([]);

    await tick();

    const select: Record<string, unknown> = (
      executionLogService.findAllBy.mock.calls[0]![0] as {
        select: Record<string, unknown>;
      }
    ).select;

    expect(select["pageAgainNumber"]).toBe(true);
  });
});
