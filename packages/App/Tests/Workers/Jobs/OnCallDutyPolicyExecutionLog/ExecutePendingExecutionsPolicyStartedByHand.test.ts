import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ObjectID from "Common/Types/ObjectID";
import {
  getOnCallPolicyRunRecordHandledMessage,
  getOnCallPolicyRunRecordResolvedMessage,
} from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";

/*
 * AN ON-CALL POLICY A PERSON STARTED BY HAND, ON THE WORKER'S TICK
 * (OnCallPolicyStartedByHand, issue #7596).
 *
 * Somebody presses Execute On-Call Policy - in the Dashboard, Slack or
 * Microsoft Teams - mostly on an incident somebody is on already, to bring
 * in more people. A policy's run used to be over at the worker's first tick
 * once its record was acknowledged, so such a run reached its first level's
 * first notifications only: no next level, no repeat. A policy started by
 * hand now goes on until one of the people it paged answers it (which ends
 * it where they do), or its record is resolved.
 *
 * A policy OneUptime starts on its own, an API key's and a workflow's still
 * end once anybody acknowledges the record - every policy at once, which is
 * the answer to "does acknowledging stop every policy?" - and keep paging
 * while nobody has.
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
      endDirectPageIfItsPagesAreOver: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/OnCall/OnCallEscalationAdvance", () => {
  return {
    __esModule: true,
    default: { advance: jest.fn() },
  };
});

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

        if (run["triggeredByIncidentEpisodeId"]) {
          return {
            kind: "incident episode",
            recordId: run["triggeredByIncidentEpisodeId"],
          };
        }

        if (run["triggeredByAlertEpisodeId"]) {
          return {
            kind: "alert episode",
            recordId: run["triggeredByAlertEpisodeId"],
          };
        }

        return null;
      }),
      readRecordState: jest.fn(),
    },
  };
});

import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import IncidentService from "Common/Server/Services/IncidentService";
import AlertService from "Common/Server/Services/AlertService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import OnCallAcknowledgementTimeout from "Common/Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import OnCallEscalationAdvance from "Common/Server/Utils/OnCall/OnCallEscalationAdvance";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions";

const JOB_NAME: string =
  "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions";

interface ExecutionLogServiceMock {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  endDirectPageIfItsPagesAreOver: jest.Mock;
}

const executionLogService: ExecutionLogServiceMock =
  OnCallDutyPolicyExecutionLogService as unknown as ExecutionLogServiceMock;

const isAcknowledged: Record<RecordKind, jest.Mock> = {
  incident: (
    IncidentService as unknown as { isIncidentAcknowledged: jest.Mock }
  ).isIncidentAcknowledged,
  alert: (AlertService as unknown as { isAlertAcknowledged: jest.Mock })
    .isAlertAcknowledged,
  "alert episode": (
    AlertEpisodeService as unknown as { isEpisodeAcknowledged: jest.Mock }
  ).isEpisodeAcknowledged,
  "incident episode": (
    IncidentEpisodeService as unknown as { isEpisodeAcknowledged: jest.Mock }
  ).isEpisodeAcknowledged,
};

const timeout: { readRecordState: jest.Mock } =
  OnCallAcknowledgementTimeout as unknown as { readRecordState: jest.Mock };

const advance: jest.Mock = (
  OnCallEscalationAdvance as unknown as { advance: jest.Mock }
).advance;

type RecordKind = "incident" | "alert" | "alert episode" | "incident episode";

type StartedBy =
  | "a person, by hand"
  | "OneUptime, for a new record"
  | "an API key"
  | "a workflow"
  | "a workflow, as a person";

const RECORD_KINDS: Array<RecordKind> = [
  "incident",
  "alert",
  "alert episode",
  "incident episode",
];

const EVENT_TYPE: Record<RecordKind, UserNotificationEventType> = {
  incident: UserNotificationEventType.IncidentCreated,
  alert: UserNotificationEventType.AlertCreated,
  "alert episode": UserNotificationEventType.AlertEpisodeCreated,
  "incident episode": UserNotificationEventType.IncidentEpisodeCreated,
};

const JANE: ObjectID = new ObjectID("7596b000-0000-4000-8000-000000000001");
const POLICY: ObjectID = new ObjectID("7596b000-0000-4000-8000-000000000002");
const WORKFLOW: ObjectID = new ObjectID("7596b000-0000-4000-8000-000000000003");
const LEVEL_1: ObjectID = new ObjectID("7596b000-0000-4000-8000-000000000004");

/*
 * A policy's run that paged its first level 20 minutes ago, whose rule
 * escalates after `waitInMinutes`.
 */
function policyRun(data: {
  about: RecordKind;
  startedBy: StartedBy;
  waitInMinutes?: number | undefined;
}): OnCallDutyPolicyExecutionLog {
  const pagedAt: Date = new Date(Date.now() - 20 * 60 * 1000);
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = ObjectID.generate();
  log.projectId = ObjectID.generate();
  log.status = OnCallDutyPolicyStatus.Executing;
  log.onCallDutyPolicyId = POLICY;
  log.lastExecutedEscalationRuleId = LEVEL_1;
  log.lastExecutedEscalationRuleOrder = 1;
  log.executeNextEscalationRuleInMinutes = data.waitInMinutes ?? 10;
  log.lastEscalationRuleExecutedAt = pagedAt;
  log.createdAt = pagedAt;
  log.onCallPolicyExecutionRepeatCount = 1;
  log.userNotificationEventType = EVENT_TYPE[data.about];

  if (data.about === "incident") {
    log.triggeredByIncidentId = ObjectID.generate();
  } else if (data.about === "alert") {
    log.triggeredByAlertId = ObjectID.generate();
  } else if (data.about === "alert episode") {
    log.triggeredByAlertEpisodeId = ObjectID.generate();
  } else {
    log.triggeredByIncidentEpisodeId = ObjectID.generate();
  }

  if (
    data.startedBy === "a person, by hand" ||
    data.startedBy === "a workflow, as a person"
  ) {
    log.triggeredByUserId = JANE;
  }

  if (
    data.startedBy === "a workflow" ||
    data.startedBy === "a workflow, as a person"
  ) {
    log.triggeredByWorkflowId = WORKFLOW;
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

// Whether the run was ended at this tick, and with what.
function endedWith(): Array<{ status: string; statusMessage: string }> {
  return executionLogService.updateOneById.mock.calls.map(
    (call: Array<unknown>) => {
      return (call[0] as { data: { status: string; statusMessage: string } })
        .data;
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  executionLogService.updateOneById.mockResolvedValue(undefined);
  advance.mockResolvedValue({});

  // Somebody is on the record already: acknowledged, not resolved.
  for (const kind of RECORD_KINDS) {
    isAcknowledged[kind].mockResolvedValue(true);
  }

  timeout.readRecordState.mockResolvedValue({
    isAcknowledged: true,
    isResolved: false,
  });
});

describe("a policy a person started by hand on a record somebody acknowledged already (Q3)", () => {
  test.each(RECORD_KINDS)(
    "about an %s: its wait over, it moves on to its next level - it is not ended, and the acknowledgement is not even asked",
    async (about: RecordKind) => {
      const run: OnCallDutyPolicyExecutionLog = policyRun({
        about: about,
        startedBy: "a person, by hand",
      });
      executionLogService.findAllBy.mockResolvedValue([run]);

      await tick();

      expect(endedWith()).toEqual([]);
      expect(advance).toHaveBeenCalledTimes(1);
      expect(advance.mock.calls[0]![0].run).toBe(run);
      expect(isAcknowledged[about]).not.toHaveBeenCalled();
    },
  );

  test("before its level's wait is over it waits: nothing moves, nothing ends", async () => {
    executionLogService.findAllBy.mockResolvedValue([
      policyRun({
        about: "incident",
        startedBy: "a person, by hand",
        waitInMinutes: 30,
      }),
    ]);

    await tick();

    expect(endedWith()).toEqual([]);
    expect(advance).not.toHaveBeenCalled();
  });

  test("its record's state is asked of the record itself, by its kind and id", async () => {
    const run: OnCallDutyPolicyExecutionLog = policyRun({
      about: "alert episode",
      startedBy: "a person, by hand",
    });
    executionLogService.findAllBy.mockResolvedValue([run]);

    await tick();

    expect(timeout.readRecordState).toHaveBeenCalledWith({
      kind: "alert episode",
      recordId: run.triggeredByAlertEpisodeId,
    });
  });

  test("on a record nobody acknowledged yet it pages on too", async () => {
    timeout.readRecordState.mockResolvedValue({
      isAcknowledged: false,
      isResolved: false,
    });
    executionLogService.findAllBy.mockResolvedValue([
      policyRun({ about: "incident", startedBy: "a person, by hand" }),
    ]);

    await tick();

    expect(endedWith()).toEqual([]);
    expect(advance).toHaveBeenCalledTimes(1);
  });
});

describe("a policy a person started by hand whose record is resolved", () => {
  test.each(RECORD_KINDS)(
    "about an %s: over, saying the record is resolved",
    async (about: RecordKind) => {
      timeout.readRecordState.mockResolvedValue({
        isAcknowledged: true,
        isResolved: true,
      });
      executionLogService.findAllBy.mockResolvedValue([
        policyRun({ about: about, startedBy: "a person, by hand" }),
      ]);

      await tick();

      expect(endedWith()).toEqual([
        {
          status: OnCallDutyPolicyStatus.Completed,
          statusMessage: getOnCallPolicyRunRecordResolvedMessage(about),
        },
      ]);
      expect(advance).not.toHaveBeenCalled();
    },
  );

  test("a record that is gone ends it with why", async () => {
    timeout.readRecordState.mockResolvedValue(null);
    executionLogService.findAllBy.mockResolvedValue([
      policyRun({ about: "incident", startedBy: "a person, by hand" }),
    ]);

    await tick();

    expect(endedWith()).toEqual([
      {
        status: OnCallDutyPolicyStatus.Error,
        statusMessage: "The incident this page is about is gone.",
      },
    ]);
    expect(advance).not.toHaveBeenCalled();
  });
});

describe("every other policy's run ends once anybody acknowledges its record, as it always did (Q2)", () => {
  const OTHERS: Array<StartedBy> = [
    "OneUptime, for a new record",
    "an API key",
    "a workflow",
    "a workflow, as a person",
  ];

  for (const startedBy of OTHERS) {
    test.each(RECORD_KINDS)(
      `started by ${startedBy}, about an %s: ended, saying the record was handled`,
      async (about: RecordKind) => {
        executionLogService.findAllBy.mockResolvedValue([
          policyRun({ about: about, startedBy: startedBy }),
        ]);

        await tick();

        expect(endedWith()).toEqual([
          {
            status: OnCallDutyPolicyStatus.Completed,
            statusMessage: getOnCallPolicyRunRecordHandledMessage(about),
          },
        ]);
        expect(advance).not.toHaveBeenCalled();
        expect(timeout.readRecordState).not.toHaveBeenCalled();
      },
    );
  }

  test("two policies of one incident - OneUptime's - both end at the same tick once it is acknowledged", async () => {
    const first: OnCallDutyPolicyExecutionLog = policyRun({
      about: "incident",
      startedBy: "OneUptime, for a new record",
    });
    const second: OnCallDutyPolicyExecutionLog = policyRun({
      about: "incident",
      startedBy: "OneUptime, for a new record",
    });
    second.triggeredByIncidentId = first.triggeredByIncidentId!;
    second.onCallDutyPolicyId = ObjectID.generate();
    executionLogService.findAllBy.mockResolvedValue([first, second]);

    await tick();

    expect(
      executionLogService.updateOneById.mock.calls.map(
        (call: Array<unknown>) => {
          return (call[0] as { id: ObjectID }).id;
        },
      ),
    ).toEqual([first.id, second.id]);
    expect(advance).not.toHaveBeenCalled();
  });

  test("beside one a person started by hand: OneUptime's ends, the one started by hand goes on", async () => {
    const automatic: OnCallDutyPolicyExecutionLog = policyRun({
      about: "incident",
      startedBy: "OneUptime, for a new record",
    });
    const byHand: OnCallDutyPolicyExecutionLog = policyRun({
      about: "incident",
      startedBy: "a person, by hand",
    });
    byHand.triggeredByIncidentId = automatic.triggeredByIncidentId!;
    executionLogService.findAllBy.mockResolvedValue([automatic, byHand]);

    await tick();

    expect(executionLogService.updateOneById).toHaveBeenCalledTimes(1);
    expect(executionLogService.updateOneById.mock.calls[0]![0].id).toEqual(
      automatic.id,
    );
    expect(advance).toHaveBeenCalledTimes(1);
    expect(advance.mock.calls[0]![0].run).toBe(byHand);
  });
});

describe("paging is not stopped where nobody has acknowledged", () => {
  test.each(RECORD_KINDS)(
    "a policy OneUptime started about an %s nobody acknowledged moves on to its next level",
    async (about: RecordKind) => {
      isAcknowledged[about].mockResolvedValue(false);
      executionLogService.findAllBy.mockResolvedValue([
        policyRun({ about: about, startedBy: "OneUptime, for a new record" }),
      ]);

      await tick();

      expect(endedWith()).toEqual([]);
      expect(advance).toHaveBeenCalledTimes(1);
    },
  );
});

describe("the worker's tick", () => {
  test("reads each run with what tells a policy started by hand apart - who started it, the policy, and the event type a test page has", async () => {
    executionLogService.findAllBy.mockResolvedValue([]);

    await tick();

    const select: Record<string, unknown> = (
      executionLogService.findAllBy.mock.calls[0]![0] as {
        select: Record<string, unknown>;
      }
    ).select;

    expect(select["onCallDutyPolicyId"]).toBe(true);
    expect(select["triggeredByUserId"]).toBe(true);
    expect(select["triggeredByWorkflowId"]).toBe(true);
    expect(select["userNotificationEventType"]).toBe(true);
    expect(select["pageAgainNumber"]).toBe(true);
    expect(select["isObserverPage"]).toBe(true);
  });
});
