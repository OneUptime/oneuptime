import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ObjectID from "Common/Types/ObjectID";
import { getOnCallPolicyRunRecordHandledMessage } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";

/*
 * A DIRECT PAGE ON THE WORKER'S TICK.
 *
 * Every minute the job looks at each run that is paging. A policy's run is
 * moved on to its next escalation rule when the one it is on has waited. A
 * direct page - people, a team or a schedule paged with no policy behind the
 * page - has no rules: it paged everybody when it started. So on a tick it
 * ends when the record is acknowledged or resolved, as a policy's run does,
 * and otherwise is handed to the service that ends it once it has waited
 * and its pages are over (endDirectPageIfItsPagesAreOver).
 *
 * What must never happen: the job looking for "the next escalation rule" of
 * a run with no policy. With no policy to match on, that read would find
 * some other policy's rule - and page that policy's people.
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
      endDirectPageIfItsPagesAreOver: jest.fn(),
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
        startDirectPage: jest.fn(),
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
      default: { create: jest.fn(), countBy: jest.fn() },
    };
  },
);

import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyEscalationRuleService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import AlertService from "Common/Server/Services/AlertService";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions";

const JOB_NAME: string =
  "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions";

interface ExecutionLogServiceMock {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  claimEscalationAdvance: jest.Mock;
  endDirectPageIfItsPagesAreOver: jest.Mock;
}

interface RuleServiceMock {
  findOneBy: jest.Mock;
  startRuleExecution: jest.Mock;
  startDirectPage: jest.Mock;
}

const executionLogService: ExecutionLogServiceMock =
  OnCallDutyPolicyExecutionLogService as unknown as ExecutionLogServiceMock;

const ruleService: RuleServiceMock =
  OnCallDutyPolicyEscalationRuleService as unknown as RuleServiceMock;

const incidentService: { isIncidentAcknowledged: jest.Mock } =
  IncidentService as unknown as { isIncidentAcknowledged: jest.Mock };

const alertService: { isAlertAcknowledged: jest.Mock } =
  AlertService as unknown as { isAlertAcknowledged: jest.Mock };

const PAGING_STARTED_AT: Date = new Date(Date.now() - 2 * 60 * 60 * 1000);
const CREATED_AT: Date = new Date(Date.now() - 3 * 60 * 60 * 1000);

// A direct page that is paging, as the job reads it: no policy at all.
function directPage(about: "incident" | "alert"): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = ObjectID.generate();
  log.projectId = ObjectID.generate();
  log.status = OnCallDutyPolicyStatus.Executing;
  log.executeNextEscalationRuleInMinutes = 0;
  log.lastEscalationRuleExecutedAt = PAGING_STARTED_AT;
  log.createdAt = CREATED_AT;
  log.onCallPolicyExecutionRepeatCount = 1;

  if (about === "incident") {
    log.triggeredByIncidentId = ObjectID.generate();
  } else {
    log.triggeredByAlertId = ObjectID.generate();
  }

  return log;
}

// A policy's run on its first rule, whose wait is over.
function policyRun(): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = directPage("incident");
  log.onCallDutyPolicyId = ObjectID.generate();
  log.lastExecutedEscalationRuleOrder = 1;

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes = 0;
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

beforeEach(() => {
  jest.clearAllMocks();
  executionLogService.updateOneById.mockResolvedValue(undefined);
  executionLogService.claimEscalationAdvance.mockResolvedValue(true);
  executionLogService.endDirectPageIfItsPagesAreOver.mockResolvedValue(false);
  incidentService.isIncidentAcknowledged.mockResolvedValue(false);
  alertService.isAlertAcknowledged.mockResolvedValue(false);
  ruleService.findOneBy.mockResolvedValue(null);
});

describe("a direct page that nobody has answered", () => {
  test.each(["incident", "alert"] as const)(
    "about an %s: it is handed to the service that ends it, with when its paging started",
    async (about: "incident" | "alert") => {
      const log: OnCallDutyPolicyExecutionLog = directPage(about);
      executionLogService.findAllBy.mockResolvedValue([log]);

      await tick();

      expect(
        executionLogService.endDirectPageIfItsPagesAreOver,
      ).toHaveBeenCalledTimes(1);
      expect(
        executionLogService.endDirectPageIfItsPagesAreOver,
      ).toHaveBeenCalledWith({
        executionLogId: log.id,
        pagingStartedAt: PAGING_STARTED_AT,
      });
    },
  );

  test("no escalation rule is looked for, claimed or started: it has no policy to match one on", async () => {
    executionLogService.findAllBy.mockResolvedValue([directPage("incident")]);

    await tick();

    expect(ruleService.findOneBy).not.toHaveBeenCalled();
    expect(ruleService.startRuleExecution).not.toHaveBeenCalled();
    expect(ruleService.startDirectPage).not.toHaveBeenCalled();
    expect(executionLogService.claimEscalationAdvance).not.toHaveBeenCalled();
  });

  test("the job itself writes nothing to the run: whether it is over is the service's to say", async () => {
    executionLogService.findAllBy.mockResolvedValue([directPage("incident")]);

    await tick();

    expect(executionLogService.updateOneById).not.toHaveBeenCalled();
  });

  test("a run that never recorded when its paging started is asked about from when it was created", async () => {
    const log: OnCallDutyPolicyExecutionLog = directPage("incident");
    delete (log as { lastEscalationRuleExecutedAt?: Date })
      .lastEscalationRuleExecutedAt;
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(
      executionLogService.endDirectPageIfItsPagesAreOver,
    ).toHaveBeenCalledWith({
      executionLogId: log.id,
      pagingStartedAt: CREATED_AT,
    });
  });

  test("the run is read with its policy id, which is what tells a direct page apart", async () => {
    executionLogService.findAllBy.mockResolvedValue([]);

    await tick();

    const select: Record<string, unknown> = (
      executionLogService.findAllBy.mock.calls[0]![0] as {
        select: Record<string, unknown>;
      }
    ).select;

    expect(select["onCallDutyPolicyId"]).toBe(true);
    expect(select["lastEscalationRuleExecutedAt"]).toBe(true);
    expect(select["createdAt"]).toBe(true);
  });

  test("a failure to end one page does not stop the tick's other runs", async () => {
    const failing: OnCallDutyPolicyExecutionLog = directPage("incident");
    const other: OnCallDutyPolicyExecutionLog = directPage("alert");

    executionLogService.findAllBy.mockResolvedValue([failing, other]);
    executionLogService.endDirectPageIfItsPagesAreOver.mockImplementation(
      async (data: { executionLogId: ObjectID }): Promise<boolean> => {
        if (data.executionLogId.toString() === failing.id!.toString()) {
          throw new Error("The pages could not be counted.");
        }

        return true;
      },
    );

    await expect(tick()).resolves.toBeUndefined();

    expect(
      executionLogService.endDirectPageIfItsPagesAreOver,
    ).toHaveBeenCalledTimes(2);
  });
});

describe("a direct page whose record somebody is on", () => {
  test("an acknowledged incident ends it, in the words a policy's run is given", async () => {
    const log: OnCallDutyPolicyExecutionLog = directPage("incident");
    executionLogService.findAllBy.mockResolvedValue([log]);
    incidentService.isIncidentAcknowledged.mockResolvedValue(true);

    await tick();

    expect(incidentService.isIncidentAcknowledged).toHaveBeenCalledWith({
      incidentId: log.triggeredByIncidentId,
    });
    expect(executionLogService.updateOneById).toHaveBeenCalledWith({
      id: log.id,
      data: {
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: getOnCallPolicyRunRecordHandledMessage("incident"),
      },
      props: { isRoot: true },
    });
    // It is over: nobody asks whether its pages are.
    expect(
      executionLogService.endDirectPageIfItsPagesAreOver,
    ).not.toHaveBeenCalled();
    expect(ruleService.findOneBy).not.toHaveBeenCalled();
  });

  test("an acknowledged alert ends it", async () => {
    const log: OnCallDutyPolicyExecutionLog = directPage("alert");
    executionLogService.findAllBy.mockResolvedValue([log]);
    alertService.isAlertAcknowledged.mockResolvedValue(true);

    await tick();

    expect(alertService.isAlertAcknowledged).toHaveBeenCalledWith({
      alertId: log.triggeredByAlertId,
    });
    expect(executionLogService.updateOneById).toHaveBeenCalledWith({
      id: log.id,
      data: {
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: getOnCallPolicyRunRecordHandledMessage("alert"),
      },
      props: { isRoot: true },
    });
    expect(
      executionLogService.endDirectPageIfItsPagesAreOver,
    ).not.toHaveBeenCalled();
  });
});

describe("a policy's run on the same tick is still a policy's", () => {
  test("it is never handed to the direct page's ending", async () => {
    const run: OnCallDutyPolicyExecutionLog = policyRun();
    executionLogService.findAllBy.mockResolvedValue([run]);

    await tick();

    expect(
      executionLogService.endDirectPageIfItsPagesAreOver,
    ).not.toHaveBeenCalled();
  });

  test("its next escalation rule is looked up under its own policy, and started", async () => {
    const run: OnCallDutyPolicyExecutionLog = policyRun();
    const nextRule: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    nextRule.id = ObjectID.generate();

    executionLogService.findAllBy.mockResolvedValue([run]);
    ruleService.findOneBy.mockResolvedValue(nextRule);

    await tick();

    expect(executionLogService.claimEscalationAdvance).toHaveBeenCalledTimes(1);
    expect(ruleService.findOneBy).toHaveBeenCalledTimes(1);

    const query: Record<string, unknown> = (
      ruleService.findOneBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
      }
    ).query;

    expect(query["onCallDutyPolicyId"]).toBe(run.onCallDutyPolicyId);
    expect(query["projectId"]).toBe(run.projectId);
    expect(query["order"]).toBe(2);
    expect(ruleService.startRuleExecution).toHaveBeenCalledTimes(1);
    expect(
      (ruleService.startRuleExecution.mock.calls[0]![0] as ObjectID).toString(),
    ).toBe(nextRule.id!.toString());
  });

  test("a direct page and a policy's run on one tick each go their own way", async () => {
    const page: OnCallDutyPolicyExecutionLog = directPage("alert");
    const run: OnCallDutyPolicyExecutionLog = policyRun();

    executionLogService.findAllBy.mockResolvedValue([page, run]);

    await tick();

    expect(
      executionLogService.endDirectPageIfItsPagesAreOver,
    ).toHaveBeenCalledTimes(1);
    expect(
      (
        executionLogService.endDirectPageIfItsPagesAreOver.mock
          .calls[0]![0] as { executionLogId: ObjectID }
      ).executionLogId.toString(),
    ).toBe(page.id!.toString());

    // Only the policy's run looked for a rule, and under its own policy.
    expect(ruleService.findOneBy).toHaveBeenCalledTimes(1);
    expect(
      (
        ruleService.findOneBy.mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query["onCallDutyPolicyId"],
    ).toBe(run.onCallDutyPolicyId);
  });
});
