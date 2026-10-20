import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ObjectID from "Common/Types/ObjectID";
import { ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import { getOnCallPolicyRunRecordHandledMessage } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import { getOnCallPolicyRunEndedWhileWaitingMessage } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";

/*
 * A RUN THAT WAITS TO PAGE, EACH MINUTE UNTIL IT PAGES OR ENDS.
 *
 * An on-call rule that pages only during working hours holds the runs it
 * starts outside them: each is created Waiting, with the moment its paging
 * starts (pagingStartsAt), and pages nobody until then. The worker reads it
 * with the runs that are paging, and every minute:
 *
 *   - its policy was archived: it ends, having paged nobody;
 *   - its incident, alert or episode was acknowledged or resolved: it ends,
 *     having paged nobody, and says why;
 *   - its moment came: it starts, at its first escalation rule
 *     (OnCallDutyPolicyExecutionLogService.startWaitingRun);
 *   - otherwise it goes on waiting, and nothing is written.
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
      // findBy: who passed the run's page on - nobody, here.
      default: {
        create: jest.fn(),
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
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
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
const alertEpisodeService: { isEpisodeAcknowledged: jest.Mock } =
  AlertEpisodeService as unknown as { isEpisodeAcknowledged: jest.Mock };
const incidentEpisodeService: { isEpisodeAcknowledged: jest.Mock } =
  IncidentEpisodeService as unknown as { isEpisodeAcknowledged: jest.Mock };

const HOUR: number = 60 * 60 * 1000;

type RecordKind = "alert" | "incident" | "alert episode" | "incident episode";

// A run held until working hours: created at night, paging in the morning.
function waiting(data: {
  pagingStartsAt?: Date | undefined;
  recordKind?: RecordKind | undefined;
  isArchived?: boolean | undefined;
}): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = ObjectID.generate();
  log.projectId = ObjectID.generate();
  log.onCallDutyPolicyId = ObjectID.generate();
  log.status = OnCallDutyPolicyStatus.Waiting;
  log.statusMessage =
    "Waiting for working hours: paging starts at 09:00 (Europe/London).";
  log.createdAt = new Date(Date.now() - 7 * HOUR);
  log.onCallPolicyExecutionRepeatCount = 1;

  if (data.pagingStartsAt) {
    log.pagingStartsAt = data.pagingStartsAt;
  }

  switch (data.recordKind || "alert") {
    case "incident":
      log.triggeredByIncidentId = ObjectID.generate();
      break;
    case "alert episode":
      log.triggeredByAlertEpisodeId = ObjectID.generate();
      break;
    case "incident episode":
      log.triggeredByIncidentEpisodeId = ObjectID.generate();
      break;
    default:
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

// A run that is paging, on its first escalation rule, its wait run out.
function escalating(): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = ObjectID.generate();
  log.projectId = ObjectID.generate();
  log.onCallDutyPolicyId = ObjectID.generate();
  log.triggeredByAlertId = ObjectID.generate();
  log.status = OnCallDutyPolicyStatus.Executing;
  log.lastExecutedEscalationRuleOrder = 1;
  log.executeNextEscalationRuleInMinutes = 0;
  log.lastEscalationRuleExecutedAt = new Date(Date.now() - HOUR);
  log.createdAt = new Date(Date.now() - HOUR);
  log.onCallPolicyExecutionRepeatCount = 1;
  log.onCallDutyPolicy = new OnCallDutyPolicy();
  return log;
}

function markHandled(kind: RecordKind): void {
  switch (kind) {
    case "incident":
      incidentService.isIncidentAcknowledged.mockResolvedValue(true);
      break;
    case "alert episode":
      alertEpisodeService.isEpisodeAcknowledged.mockResolvedValue(true);
      break;
    case "incident episode":
      incidentEpisodeService.isEpisodeAcknowledged.mockResolvedValue(true);
      break;
    default:
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
  alertEpisodeService.isEpisodeAcknowledged.mockResolvedValue(false);
  incidentEpisodeService.isEpisodeAcknowledged.mockResolvedValue(false);
  ruleService.findOneBy.mockResolvedValue(null);
});

describe("the runs the worker reads", () => {
  test("are the ones paging and the ones waiting to, with when each starts", async () => {
    executionLogService.findAllBy.mockResolvedValue([]);

    await tick();

    const findBy: {
      query: { status: { value?: unknown; _value?: unknown } };
      select: Record<string, unknown>;
    } = executionLogService.findAllBy.mock.calls[0]![0];

    expect(JSON.stringify(findBy.query.status)).toContain(
      OnCallDutyPolicyStatus.Executing,
    );
    expect(JSON.stringify(findBy.query.status)).toContain(
      OnCallDutyPolicyStatus.Waiting,
    );
    expect(findBy.select["status"]).toBe(true);
    expect(findBy.select["pagingStartsAt"]).toBe(true);
  });
});

describe("a run that waits for working hours", () => {
  test("before its moment, pages nobody and writes nothing", async () => {
    const log: OnCallDutyPolicyExecutionLog = waiting({
      pagingStartsAt: new Date(Date.now() + 3 * HOUR),
    });
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    // Its record is still asked about: handled at 3am, it ends at 3am.
    expect(alertService.isAlertAcknowledged).toHaveBeenCalledWith({
      alertId: log.triggeredByAlertId,
    });
    expect(executionLogService.startWaitingRun).not.toHaveBeenCalled();
    expect(executionLogService.endWaitingRun).not.toHaveBeenCalled();
    expect(executionLogService.updateOneById).not.toHaveBeenCalled();
    expect(executionLogService.claimEscalationAdvance).not.toHaveBeenCalled();
    expect(ruleService.startRuleExecution).not.toHaveBeenCalled();
  });

  test("once its moment comes, starts paging at its first escalation rule", async () => {
    const log: OnCallDutyPolicyExecutionLog = waiting({
      pagingStartsAt: new Date(Date.now() - 30 * 1000),
    });
    executionLogService.findAllBy.mockResolvedValue([log]);

    const before: number = Date.now();
    await tick();

    expect(executionLogService.startWaitingRun).toHaveBeenCalledTimes(1);

    const start: { run: OnCallDutyPolicyExecutionLog; now: Date } =
      executionLogService.startWaitingRun.mock.calls[0]![0];

    expect(start.run).toBe(log);
    expect(start.now.getTime()).toBeGreaterThanOrEqual(before);
    expect(executionLogService.endWaitingRun).not.toHaveBeenCalled();
    // It is not advanced as a paging run would be: it has no rule yet.
    expect(executionLogService.claimEscalationAdvance).not.toHaveBeenCalled();
  });

  test("with no moment of its own, starts paging at once", async () => {
    const log: OnCallDutyPolicyExecutionLog = waiting({});
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(executionLogService.startWaitingRun).toHaveBeenCalledTimes(1);
  });

  test.each([
    "alert",
    "incident",
    "alert episode",
    "incident episode",
  ] as Array<RecordKind>)(
    "whose %s is acknowledged or resolved while it waits, ends, paging nobody",
    async (kind: RecordKind) => {
      const log: OnCallDutyPolicyExecutionLog = waiting({
        pagingStartsAt: new Date(Date.now() + 3 * HOUR),
        recordKind: kind,
      });
      executionLogService.findAllBy.mockResolvedValue([log]);
      markHandled(kind);

      await tick();

      expect(executionLogService.endWaitingRun).toHaveBeenCalledWith({
        executionLogId: log.id,
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: getOnCallPolicyRunEndedWhileWaitingMessage(kind),
      });
      expect(executionLogService.startWaitingRun).not.toHaveBeenCalled();
      expect(ruleService.startRuleExecution).not.toHaveBeenCalled();
    },
  );

  test("whose record was handled just as its moment came, ends rather than pages", async () => {
    const log: OnCallDutyPolicyExecutionLog = waiting({
      pagingStartsAt: new Date(Date.now() - 1000),
    });
    executionLogService.findAllBy.mockResolvedValue([log]);
    markHandled("alert");

    await tick();

    expect(executionLogService.endWaitingRun).toHaveBeenCalledTimes(1);
    expect(executionLogService.startWaitingRun).not.toHaveBeenCalled();
  });

  test("whose policy was archived while it waited, ends, paging nobody, and says so", async () => {
    const log: OnCallDutyPolicyExecutionLog = waiting({
      pagingStartsAt: new Date(Date.now() - 1000),
      isArchived: true,
    });
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(executionLogService.endWaitingRun).toHaveBeenCalledWith({
      executionLogId: log.id,
      status: OnCallDutyPolicyStatus.Error,
      statusMessage: ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
    });
    expect(executionLogService.startWaitingRun).not.toHaveBeenCalled();
    // Archived says it all: the record is not even read.
    expect(alertService.isAlertAcknowledged).not.toHaveBeenCalled();
  });

  test("that fails to start says why, as a paging run that fails does", async () => {
    const log: OnCallDutyPolicyExecutionLog = waiting({
      pagingStartsAt: new Date(Date.now() - 1000),
    });
    executionLogService.findAllBy.mockResolvedValue([log]);
    executionLogService.startWaitingRun.mockRejectedValue(
      new Error("Database is down"),
    );

    await tick();

    expect(executionLogService.updateOneById).toHaveBeenCalledWith({
      id: log.id,
      data: {
        status: OnCallDutyPolicyStatus.Error,
        statusMessage: "Database is down",
      },
      props: { isRoot: true },
    });
  });

  test("leaves a paging run in the same sweep to page on as it always has", async () => {
    const held: OnCallDutyPolicyExecutionLog = waiting({
      pagingStartsAt: new Date(Date.now() + 3 * HOUR),
    });
    const paging: OnCallDutyPolicyExecutionLog = escalating();
    executionLogService.findAllBy.mockResolvedValue([held, paging]);

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
    ).toBe(String(paging.id));
    expect(executionLogService.startWaitingRun).not.toHaveBeenCalled();
  });

  test("a paging run whose record is handled still stops as it always has", async () => {
    const paging: OnCallDutyPolicyExecutionLog = escalating();
    executionLogService.findAllBy.mockResolvedValue([paging]);
    markHandled("alert");

    await tick();

    expect(executionLogService.updateOneById).toHaveBeenCalledWith({
      id: paging.id,
      data: {
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: getOnCallPolicyRunRecordHandledMessage("alert"),
      },
      props: { isRoot: true },
    });
    expect(executionLogService.endWaitingRun).not.toHaveBeenCalled();
  });
});
