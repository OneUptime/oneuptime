import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "Common/Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import PositiveNumber from "Common/Types/PositiveNumber";

/*
 * THE WORKER, AND PAGES PASSED ON.
 *
 * A person who cannot take a page passes it on (OnCallPagePassOn); the run
 * moves on at once when nobody else on its rule is left. The rest of the
 * time the worker moves runs on, once a rule's wait has run out - in the
 * same one way (OnCallEscalationAdvance), so the run it moves on still
 * passes over everybody who passed its page on, and moves past a rule only
 * they were on. These drive one tick with the services stubbed, as the
 * other worker suites do.
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
      findOneById: jest.fn(),
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
      default: { create: jest.fn(), countBy: jest.fn(), findBy: jest.fn() },
    };
  },
);

import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyEscalationRuleService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogTimelineService from "Common/Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import IncidentService from "Common/Server/Services/IncidentService";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions";

const JOB_NAME: string =
  "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions";

const executionLogService: {
  findAllBy: jest.Mock;
  findOneById: jest.Mock;
  updateOneById: jest.Mock;
  claimEscalationAdvance: jest.Mock;
} = OnCallDutyPolicyExecutionLogService as unknown as {
  findAllBy: jest.Mock;
  findOneById: jest.Mock;
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

const timelineService: { countBy: jest.Mock; findBy: jest.Mock } =
  OnCallDutyPolicyExecutionLogTimelineService as unknown as {
    countBy: jest.Mock;
    findBy: jest.Mock;
  };

const incidentService: { isIncidentAcknowledged: jest.Mock } =
  IncidentService as unknown as { isIncidentAcknowledged: jest.Mock };

const ANA: ObjectID = new ObjectID("0fc00000-0000-4000-8000-0000000000a1");
const RULE_IDS: Array<ObjectID> = [1, 2, 3].map((order: number): ObjectID => {
  return new ObjectID(`0fc00000-0000-4000-8000-00000000010${order}`);
});

const STARTED: Date = new Date(Date.now() - 31 * 60 * 1000);

// A run on Level 1, whose 30 minutes ran out a minute ago.
function runOnLevel1(): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = new ObjectID("0fc00000-0000-4000-8000-000000000001");
  log.projectId = new ObjectID("0fc00000-0000-4000-8000-000000000002");
  log.onCallDutyPolicyId = new ObjectID("0fc00000-0000-4000-8000-000000000003");
  log.triggeredByIncidentId = new ObjectID(
    "0fc00000-0000-4000-8000-000000000004",
  );
  log.status = OnCallDutyPolicyStatus.Executing;
  log.lastExecutedEscalationRuleOrder = 1;
  log.executeNextEscalationRuleInMinutes = 30;
  log.lastEscalationRuleExecutedAt = STARTED;
  log.createdAt = STARTED;
  log.onCallPolicyExecutionRepeatCount = 1;

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.isArchived = false;
  log.onCallDutyPolicy = policy;

  return log;
}

function passedOn(userId: ObjectID): OnCallDutyPolicyExecutionLogTimeline {
  const line: OnCallDutyPolicyExecutionLogTimeline =
    new OnCallDutyPolicyExecutionLogTimeline();
  line.alertSentToUserId = userId;
  line.status = OnCallDutyExecutionLogTimelineStatus.PassedOn;
  return line;
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
  executionLogService.findOneById.mockResolvedValue({
    status: OnCallDutyPolicyStatus.Executing,
    lastEscalationRuleExecutedAt: new Date(),
  });
  incidentService.isIncidentAcknowledged.mockResolvedValue(false);
  timelineService.countBy.mockResolvedValue(new PositiveNumber(1));
  timelineService.findBy.mockResolvedValue([]);
  ruleService.startRuleExecution.mockResolvedValue({
    paged: [],
    notPaged: [],
    hadScheduleGap: false,
    movesOnAtOnce: false,
  });
  ruleService.findOneBy.mockImplementation(
    (args: {
      query: { order: number };
    }): Promise<OnCallDutyPolicyEscalationRule | null> => {
      const id: ObjectID | undefined = RULE_IDS[args.query.order - 1];

      if (!id) {
        return Promise.resolve(null);
      }

      const rule: OnCallDutyPolicyEscalationRule =
        new OnCallDutyPolicyEscalationRule();
      rule.id = id;
      rule.order = args.query.order;
      return Promise.resolve(rule);
    },
  );
});

describe("a tick once a rule's wait has run out", () => {
  test("claims the move from the time the run was read with", async () => {
    executionLogService.findAllBy.mockResolvedValue([runOnLevel1()]);

    await tick();

    expect(executionLogService.claimEscalationAdvance).toHaveBeenCalledTimes(1);
    expect(
      executionLogService.claimEscalationAdvance.mock.calls[0][0]
        .previousLastEscalationRuleExecutedAt,
    ).toEqual(STARTED);
  });

  test("hands the next rule the people who passed the run's page on", async () => {
    timelineService.findBy.mockResolvedValue([passedOn(ANA)]);
    executionLogService.findAllBy.mockResolvedValue([runOnLevel1()]);

    await tick();

    expect(ruleService.startRuleExecution).toHaveBeenCalledTimes(1);
    expect(String(ruleService.startRuleExecution.mock.calls[0][0])).toBe(
      RULE_IDS[1]!.toString(),
    );
    expect(
      ruleService.startRuleExecution.mock.calls[0][1].passedOnUserIds.map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([ANA.toString()]);
  });

  test("moves straight past a rule only people who passed it on were on", async () => {
    ruleService.startRuleExecution
      .mockResolvedValueOnce({
        paged: [],
        notPaged: [],
        hadScheduleGap: false,
        movesOnAtOnce: true,
      })
      .mockResolvedValueOnce({
        paged: [],
        notPaged: [],
        hadScheduleGap: false,
        movesOnAtOnce: false,
      });
    executionLogService.findAllBy.mockResolvedValue([runOnLevel1()]);

    await tick();

    expect(
      ruleService.startRuleExecution.mock.calls.map(
        (call: Array<unknown>): string => {
          return String(call[0]);
        },
      ),
    ).toEqual([RULE_IDS[1]!.toString(), RULE_IDS[2]!.toString()]);
    // Each move is claimed.
    expect(executionLogService.claimEscalationAdvance).toHaveBeenCalledTimes(2);
  });

  test("does nothing when a page passed on moved the run on first", async () => {
    executionLogService.claimEscalationAdvance.mockResolvedValue(false);
    executionLogService.findAllBy.mockResolvedValue([runOnLevel1()]);

    await tick();

    expect(ruleService.startRuleExecution).not.toHaveBeenCalled();
    expect(executionLogService.updateOneById).not.toHaveBeenCalled();
  });

  test("leaves a run whose wait has not run out to wait", async () => {
    const log: OnCallDutyPolicyExecutionLog = runOnLevel1();
    log.lastEscalationRuleExecutedAt = new Date();
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(executionLogService.claimEscalationAdvance).not.toHaveBeenCalled();
    expect(ruleService.startRuleExecution).not.toHaveBeenCalled();
  });
});
