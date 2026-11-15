import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallTestPageRecordKind } from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";

/*
 * A TEST PAGE ON THE WORKER'S TICK (OnCallTestPage).
 *
 * Every minute the job looks at each run that is paging. A test page has no
 * record: nothing about one is read, and it is handed to OnCallTestPageRuns,
 * which ends it once its answer window is over and moves a test that walks
 * every level on after a short wait. What must never happen: a test read as
 * a direct page whose record is gone, or as a policy's run whose next rule
 * is due after the policy's own wait.
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

/*
 * Where each run's record stands, answered one record at a time by the
 * per-record reads this suite mocks, as the worker read them before it read
 * a page's records together (Fixtures/OnCallRecordStatesPerRecord).
 */
jest.mock("Common/Server/Utils/OnCall/OnCallRecordStates", () => {
  return jest
    .requireActual("../Fixtures/OnCallRecordStatesPerRecord")
    .onCallRecordStatesReadPerRecord();
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

jest.mock("Common/Server/Utils/OnCall/OnCallTestPageRuns", () => {
  return {
    __esModule: true,
    default: { tick: jest.fn() },
  };
});

jest.mock("Common/Server/Services/OnCallDutyPolicyExecutionLogService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
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
import OnCallTestPageRuns from "Common/Server/Utils/OnCall/OnCallTestPageRuns";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions";

const JOB_NAME: string =
  "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions";

const executionLogService: {
  findBy: jest.Mock;
  updateOneById: jest.Mock;
  claimEscalationAdvance: jest.Mock;
  endDirectPageIfItsPagesAreOver: jest.Mock;
} = OnCallDutyPolicyExecutionLogService as unknown as {
  findBy: jest.Mock;
  updateOneById: jest.Mock;
  claimEscalationAdvance: jest.Mock;
  endDirectPageIfItsPagesAreOver: jest.Mock;
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

const runs: { tick: jest.Mock } = OnCallTestPageRuns as unknown as {
  tick: jest.Mock;
};

const LEVEL_STARTED_AT: Date = new Date(Date.now() - 60 * 60 * 1000);

function testRun(withPolicy: boolean): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = ObjectID.generate();
  log.projectId = ObjectID.generate();
  log.status = OnCallDutyPolicyStatus.Executing;
  log.userNotificationEventType = UserNotificationEventType.TestPage;
  log.testPageRecordKind = OnCallTestPageRecordKind.Incident;
  log.testPageWalksEscalation = withPolicy;
  log.executeNextEscalationRuleInMinutes = 30;
  log.lastEscalationRuleExecutedAt = LEVEL_STARTED_AT;
  log.lastExecutedEscalationRuleOrder = 1;
  log.createdAt = LEVEL_STARTED_AT;
  log.onCallPolicyExecutionRepeatCount = 1;

  if (withPolicy) {
    log.onCallDutyPolicyId = ObjectID.generate();
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes = 3;
    policy.isArchived = false;
    log.onCallDutyPolicy = policy;
  }

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
  runs.tick.mockResolvedValue("Waiting");
  executionLogService.updateOneById.mockResolvedValue(undefined);
  executionLogService.claimEscalationAdvance.mockResolvedValue(true);
  executionLogService.endDirectPageIfItsPagesAreOver.mockResolvedValue(false);
  incidentService.isIncidentAcknowledged.mockResolvedValue(false);
  ruleService.findOneBy.mockResolvedValue(null);
});

describe("a test page that is paging", () => {
  test.each([
    ["a test of people", false],
    ["a test of a policy that walks every level", true],
  ])(
    "%s is handed to OnCallTestPageRuns, with the run and now",
    async (_name: string, withPolicy: boolean) => {
      const run: OnCallDutyPolicyExecutionLog = testRun(withPolicy);
      executionLogService.findBy.mockResolvedValue([run]);

      await tick();

      expect(runs.tick).toHaveBeenCalledTimes(1);
      expect(runs.tick.mock.calls[0]![0].run).toBe(run);
      expect(runs.tick.mock.calls[0]![0].now).toBeInstanceOf(Date);
    },
  );

  test("nothing else is done with it: no record, no direct page's end, no policy's next rule", async () => {
    executionLogService.findBy.mockResolvedValue([
      testRun(false),
      testRun(true),
    ]);

    await tick();

    expect(incidentService.isIncidentAcknowledged).not.toHaveBeenCalled();
    expect(
      executionLogService.endDirectPageIfItsPagesAreOver,
    ).not.toHaveBeenCalled();
    expect(executionLogService.claimEscalationAdvance).not.toHaveBeenCalled();
    expect(ruleService.findOneBy).not.toHaveBeenCalled();
    expect(ruleService.startRuleExecution).not.toHaveBeenCalled();
    expect(executionLogService.updateOneById).not.toHaveBeenCalled();
  });

  test("the job reads whether a test walks every level, and what kind of run each is", async () => {
    executionLogService.findBy.mockResolvedValue([]);

    await tick();

    expect(executionLogService.findBy.mock.calls[0]![0].select).toMatchObject({
      userNotificationEventType: true,
      testPageWalksEscalation: true,
    });
  });
});

describe("a real direct page is as it was", () => {
  test("it is handed to the service that ends it, and never to OnCallTestPageRuns", async () => {
    const run: OnCallDutyPolicyExecutionLog = testRun(false);
    run.userNotificationEventType = UserNotificationEventType.IncidentCreated;
    run.triggeredByIncidentId = ObjectID.generate();
    executionLogService.findBy.mockResolvedValue([run]);

    await tick();

    expect(runs.tick).not.toHaveBeenCalled();
    expect(
      executionLogService.endDirectPageIfItsPagesAreOver,
    ).toHaveBeenCalledTimes(1);
  });
});
