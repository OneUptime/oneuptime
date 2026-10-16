import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ObjectID from "Common/Types/ObjectID";
import { ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import PositiveNumber from "Common/Types/PositiveNumber";

/*
 * When the last escalation rule's wait runs out with nobody acknowledging,
 * an on-call policy starts again from its first rule only as its Repeat
 * Policy card says: while "Repeat if no one acknowledges" is on, as many
 * times as "Number of times to repeat". With the switch off the run ends,
 * whatever number was left behind - the card says "Repeat disabled", and
 * the run used to repeat anyway.
 *
 * The job registers itself through RunCron at import time and exports
 * nothing, so the Cron util is mocked to capture the handler and each test
 * drives one tick at the end of the policy's last rule.
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
      // findBy: who passed the run's page on - nobody, here.
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
import OnCallDutyPolicyExecutionLogTimelineService from "Common/Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
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

const timelineService: { countBy: jest.Mock } =
  OnCallDutyPolicyExecutionLogTimelineService as unknown as {
    countBy: jest.Mock;
  };

const incidentService: { isIncidentAcknowledged: jest.Mock } =
  IncidentService as unknown as { isIncidentAcknowledged: jest.Mock };

const FIRST_RULE_ID: ObjectID = ObjectID.generate();

interface RepeatSettings {
  // The policy's "Repeat if no one acknowledges"; left unset when undefined.
  repeatSwitch: boolean | undefined;
  // The policy's "Number of times to repeat".
  times: number | undefined;
  // The run's pass: 1 for the first time through the rules.
  pass: number;
}

// A run of a two-rule policy whose second, last rule's wait has run out.
function atTheEndOfTheLastRule(
  settings: RepeatSettings,
): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = ObjectID.generate();
  log.projectId = ObjectID.generate();
  log.onCallDutyPolicyId = ObjectID.generate();
  log.triggeredByIncidentId = ObjectID.generate();
  log.status = OnCallDutyPolicyStatus.Executing;
  log.lastExecutedEscalationRuleOrder = 2;
  log.executeNextEscalationRuleInMinutes = 0;
  log.lastEscalationRuleExecutedAt = new Date(Date.now() - 60 * 60 * 1000);
  log.createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
  log.onCallPolicyExecutionRepeatCount = settings.pass;

  const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
  policy.isArchived = false;

  if (settings.repeatSwitch !== undefined) {
    policy.repeatPolicyIfNoOneAcknowledges = settings.repeatSwitch;
  }

  if (settings.times !== undefined) {
    policy.repeatPolicyIfNoOneAcknowledgesNoOfTimes = settings.times;
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

// Whether the tick started the policy again from its first rule.
function startedAgain(log: OnCallDutyPolicyExecutionLog): boolean {
  const repeated: boolean = executionLogService.updateOneById.mock.calls.some(
    (call: Array<unknown>): boolean => {
      const update: {
        id: ObjectID;
        data: { onCallPolicyExecutionRepeatCount?: number };
      } = call[0] as {
        id: ObjectID;
        data: { onCallPolicyExecutionRepeatCount?: number };
      };

      return (
        String(update.id) === String(log.id) &&
        update.data.onCallPolicyExecutionRepeatCount ===
          (log.onCallPolicyExecutionRepeatCount || 0) + 1
      );
    },
  );

  const firstRuleStarted: boolean =
    ruleService.startRuleExecution.mock.calls.some(
      (call: Array<unknown>): boolean => {
        return String(call[0]) === String(FIRST_RULE_ID);
      },
    );

  expect(repeated).toBe(firstRuleStarted);

  return repeated;
}

// The status the tick closed the run with, or null when it did not close it.
function closedWith(log: OnCallDutyPolicyExecutionLog): string | null {
  for (const call of executionLogService.updateOneById.mock.calls) {
    const update: {
      id: ObjectID;
      data: { status?: string; statusMessage?: string };
    } = call[0] as {
      id: ObjectID;
      data: { status?: string; statusMessage?: string };
    };

    if (String(update.id) === String(log.id) && update.data.status) {
      return update.data.status;
    }
  }

  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  executionLogService.updateOneById.mockResolvedValue(undefined);
  executionLogService.claimEscalationAdvance.mockResolvedValue(true);
  incidentService.isIncidentAcknowledged.mockResolvedValue(false);
  ruleService.startRuleExecution.mockResolvedValue(undefined);
  // Somebody was paged on the way, so a run that ends is Completed.
  timelineService.countBy.mockResolvedValue(new PositiveNumber(2));

  // The policy has two rules: no third after the second, the first on a repeat.
  ruleService.findOneBy.mockImplementation(
    (args: {
      query: { order: number };
    }): Promise<OnCallDutyPolicyEscalationRule | null> => {
      if (args.query.order === 1) {
        const rule: OnCallDutyPolicyEscalationRule =
          new OnCallDutyPolicyEscalationRule();
        rule.id = FIRST_RULE_ID;
        return Promise.resolve(rule);
      }

      return Promise.resolve(null);
    },
  );
});

describe("a policy whose last rule went unacknowledged", () => {
  test("starts again from its first rule while its repeats are switched on", async () => {
    const log: OnCallDutyPolicyExecutionLog = atTheEndOfTheLastRule({
      repeatSwitch: true,
      times: 2,
      pass: 1,
    });
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(startedAgain(log)).toBe(true);
    expect(closedWith(log)).toBeNull();
  });

  test("repeats exactly as many times as it is set to, then ends", async () => {
    // Two repeats: passes one and two start again, the third pass ends.
    for (const pass of [1, 2]) {
      jest.clearAllMocks();
      executionLogService.updateOneById.mockResolvedValue(undefined);
      executionLogService.claimEscalationAdvance.mockResolvedValue(true);
      timelineService.countBy.mockResolvedValue(new PositiveNumber(2));

      const log: OnCallDutyPolicyExecutionLog = atTheEndOfTheLastRule({
        repeatSwitch: true,
        times: 2,
        pass: pass,
      });
      executionLogService.findAllBy.mockResolvedValue([log]);

      await tick();

      expect({ pass, again: startedAgain(log) }).toEqual({
        pass,
        again: true,
      });
    }

    jest.clearAllMocks();
    executionLogService.updateOneById.mockResolvedValue(undefined);
    executionLogService.claimEscalationAdvance.mockResolvedValue(true);
    timelineService.countBy.mockResolvedValue(new PositiveNumber(2));

    const last: OnCallDutyPolicyExecutionLog = atTheEndOfTheLastRule({
      repeatSwitch: true,
      times: 2,
      pass: 3,
    });
    executionLogService.findAllBy.mockResolvedValue([last]);

    await tick();

    expect(startedAgain(last)).toBe(false);
    expect(closedWith(last)).toBe(OnCallDutyPolicyStatus.Completed);
  });

  test("ends when its repeats are switched off, however many were left set", async () => {
    for (const times of [1, 2, 3, 10]) {
      jest.clearAllMocks();
      executionLogService.updateOneById.mockResolvedValue(undefined);
      executionLogService.claimEscalationAdvance.mockResolvedValue(true);
      timelineService.countBy.mockResolvedValue(new PositiveNumber(2));

      const log: OnCallDutyPolicyExecutionLog = atTheEndOfTheLastRule({
        repeatSwitch: false,
        times: times,
        pass: 1,
      });
      executionLogService.findAllBy.mockResolvedValue([log]);

      await tick();

      expect({ times, again: startedAgain(log) }).toEqual({
        times,
        again: false,
      });
      expect({ times, status: closedWith(log) }).toEqual({
        times,
        status: OnCallDutyPolicyStatus.Completed,
      });
    }
  });

  test("ends with the run's ordinary message when it went through every rule", async () => {
    const log: OnCallDutyPolicyExecutionLog = atTheEndOfTheLastRule({
      repeatSwitch: false,
      times: 3,
      pass: 1,
    });
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(executionLogService.updateOneById).toHaveBeenCalledWith({
      id: log.id,
      data: {
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
      },
      props: { isRoot: true },
    });
  });

  test("ends when the switch is on but no repeats are set", async () => {
    const log: OnCallDutyPolicyExecutionLog = atTheEndOfTheLastRule({
      repeatSwitch: true,
      times: 0,
      pass: 1,
    });
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(startedAgain(log)).toBe(false);
    expect(closedWith(log)).toBe(OnCallDutyPolicyStatus.Completed);
  });

  test("ends when the policy was read without the switch, as a new policy runs once", async () => {
    const log: OnCallDutyPolicyExecutionLog = atTheEndOfTheLastRule({
      repeatSwitch: undefined,
      times: 2,
      pass: 1,
    });
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(startedAgain(log)).toBe(false);
  });

  test("the sweep reads the switch with the number", async () => {
    executionLogService.findAllBy.mockResolvedValue([]);

    await tick();

    const select: Record<string, Record<string, unknown>> = (
      executionLogService.findAllBy.mock.calls[0]![0] as {
        select: Record<string, Record<string, unknown>>;
      }
    ).select;

    expect(select["onCallDutyPolicy"]!["repeatPolicyIfNoOneAcknowledges"]).toBe(
      true,
    );
    expect(
      select["onCallDutyPolicy"]!["repeatPolicyIfNoOneAcknowledgesNoOfTimes"],
    ).toBe(true);
  });
});
