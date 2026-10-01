import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ObjectID from "Common/Types/ObjectID";
import { ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";

/*
 * An on-call policy archived while one of its executions is escalating stops
 * at the next step: whoever the earlier rules paged was paged, nobody else is.
 * The execution is closed as Completed with a message saying why, rather than
 * left Executing - the job would otherwise keep escalating, and repeating, a
 * policy that pages no one.
 *
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
      default: { create: jest.fn() },
    };
  },
);

import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyEscalationRuleService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
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

function escalating(
  isArchived: boolean | undefined,
): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = ObjectID.generate();
  log.projectId = ObjectID.generate();
  log.onCallDutyPolicyId = ObjectID.generate();
  log.triggeredByIncidentId = ObjectID.generate();
  log.status = OnCallDutyPolicyStatus.Executing;
  log.lastExecutedEscalationRuleOrder = 1;
  log.executeNextEscalationRuleInMinutes = 0;
  log.lastEscalationRuleExecutedAt = new Date(Date.now() - 60 * 60 * 1000);
  log.createdAt = new Date(Date.now() - 60 * 60 * 1000);
  log.onCallPolicyExecutionRepeatCount = 1;

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes = 0;

  if (isArchived !== undefined) {
    policy.isArchived = isArchived;
  }

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

beforeEach(() => {
  jest.clearAllMocks();
  executionLogService.updateOneById.mockResolvedValue(undefined);
  executionLogService.claimEscalationAdvance.mockResolvedValue(true);
  incidentService.isIncidentAcknowledged.mockResolvedValue(false);
  ruleService.findOneBy.mockResolvedValue(null);
});

describe("an execution of an on-call policy that has been archived", () => {
  test("is closed as Completed with the reason, and pages nobody else", async () => {
    const log: OnCallDutyPolicyExecutionLog = escalating(true);
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(executionLogService.updateOneById).toHaveBeenCalledWith({
      id: log.id,
      data: {
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE,
      },
      props: { isRoot: true },
    });
    // Stopped before anything that escalates: no claim, no next rule.
    expect(executionLogService.claimEscalationAdvance).not.toHaveBeenCalled();
    expect(ruleService.findOneBy).not.toHaveBeenCalled();
    expect(ruleService.startRuleExecution).not.toHaveBeenCalled();
    // Not even the acknowledgement check is needed.
    expect(incidentService.isIncidentAcknowledged).not.toHaveBeenCalled();
  });

  test("the sweep reads whether each execution's policy is archived", async () => {
    executionLogService.findAllBy.mockResolvedValue([]);

    await tick();

    const select: Record<string, Record<string, unknown>> = (
      executionLogService.findAllBy.mock.calls[0]![0] as {
        select: Record<string, Record<string, unknown>>;
      }
    ).select;

    expect(select["onCallDutyPolicy"]!["isArchived"]).toBe(true);
  });

  test("an execution of a live policy carries on escalating", async () => {
    const log: OnCallDutyPolicyExecutionLog = escalating(false);
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(incidentService.isIncidentAcknowledged).toHaveBeenCalled();
    expect(executionLogService.claimEscalationAdvance).toHaveBeenCalled();
    expect(executionLogService.updateOneById).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          statusMessage: ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE,
        }),
      }),
    );
  });

  test("a policy read without the flag counts as live", async () => {
    const log: OnCallDutyPolicyExecutionLog = escalating(undefined);
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(executionLogService.claimEscalationAdvance).toHaveBeenCalled();
  });

  test("one archived policy does not stop another policy's execution", async () => {
    const archived: OnCallDutyPolicyExecutionLog = escalating(true);
    const live: OnCallDutyPolicyExecutionLog = escalating(false);
    executionLogService.findAllBy.mockResolvedValue([archived, live]);

    await tick();

    expect(executionLogService.claimEscalationAdvance).toHaveBeenCalledTimes(1);
    expect(
      String(
        (
          executionLogService.claimEscalationAdvance.mock.calls[0]![0] as {
            executionLogId: ObjectID;
          }
        ).executionLogId,
      ),
    ).toBe(String(live.id));
  });
});
