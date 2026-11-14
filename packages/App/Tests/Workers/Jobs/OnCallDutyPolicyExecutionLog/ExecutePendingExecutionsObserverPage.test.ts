import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ObjectID from "Common/Types/ObjectID";
import {
  getOnCallPolicyRunRecordHandledMessage,
  getOnCallPolicyRunRecordResolvedMessage,
} from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import { getOnCallPolicyRunEndedWhileWaitingMessage } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";

/*
 * AN OBSERVER'S PAGE, ON THE WORKER'S TICK (OnCallObserverPage).
 *
 * People paged as observers are kept informed about a record somebody else
 * responds to. The responders acknowledging it - usually before the
 * observers are told at all - is no sign the observers have seen it, so it
 * does not end their page: it goes on until one of them answers it (which
 * ends it where they do), or the record is resolved. An observer's page
 * that waits for working hours is still owed to its people when the
 * responders acknowledge: only a resolve ends it unpaged. A responder's run
 * ends on the acknowledgement, as it always did.
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

jest.mock("Common/Server/Services/OnCallDutyPolicyExecutionLogService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      updateOneById: jest.fn(),
      claimEscalationAdvance: jest.fn(),
      endDirectPageIfItsPagesAreOver: jest.fn(),
      endWaitingRun: jest.fn(),
      startWaitingRun: jest.fn(),
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
import IncidentService from "Common/Server/Services/IncidentService";
import AlertService from "Common/Server/Services/AlertService";
import OnCallAcknowledgementTimeout from "Common/Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/ExecutePendingExecutions";

const JOB_NAME: string =
  "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions";

interface ExecutionLogServiceMock {
  findBy: jest.Mock;
  updateOneById: jest.Mock;
  claimEscalationAdvance: jest.Mock;
  endDirectPageIfItsPagesAreOver: jest.Mock;
  endWaitingRun: jest.Mock;
  startWaitingRun: jest.Mock;
}

const executionLogService: ExecutionLogServiceMock =
  OnCallDutyPolicyExecutionLogService as unknown as ExecutionLogServiceMock;

const incidentService: { isIncidentAcknowledged: jest.Mock } =
  IncidentService as unknown as { isIncidentAcknowledged: jest.Mock };

const alertService: { isAlertAcknowledged: jest.Mock } =
  AlertService as unknown as { isAlertAcknowledged: jest.Mock };

const timeout: { readRecordState: jest.Mock } =
  OnCallAcknowledgementTimeout as unknown as { readRecordState: jest.Mock };

const POLICY: ObjectID = new ObjectID("9f000000-0000-4000-8000-000000000001");
const WORKFLOW: ObjectID = new ObjectID("9f000000-0000-4000-8000-000000000002");

/*
 * A policy's run that is paging: its next escalation rule an hour away, so a
 * tick that does not end it does nothing else either.
 */
function policyRun(data: {
  about: "incident" | "alert";
  isObserverPage: boolean;
}): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = ObjectID.generate();
  log.projectId = ObjectID.generate();
  log.onCallDutyPolicyId = POLICY;
  log.status = OnCallDutyPolicyStatus.Executing;
  log.executeNextEscalationRuleInMinutes = 60;
  log.lastEscalationRuleExecutedAt = new Date();
  log.createdAt = new Date();
  log.onCallPolicyExecutionRepeatCount = 1;
  log.isObserverPage = data.isObserverPage;

  if (data.about === "incident") {
    log.triggeredByIncidentId = ObjectID.generate();
  } else {
    log.triggeredByAlertId = ObjectID.generate();
  }

  return log;
}

// A run that waits to page, its moment two hours away.
function waitingRun(isObserverPage: boolean): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = policyRun({
    about: "incident",
    isObserverPage: isObserverPage,
  });
  log.status = OnCallDutyPolicyStatus.Waiting;
  log.pagingStartsAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
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
  executionLogService.endDirectPageIfItsPagesAreOver.mockResolvedValue(false);
  executionLogService.endWaitingRun.mockResolvedValue(true);
  executionLogService.startWaitingRun.mockResolvedValue(true);
  // The responders are on it: acknowledged, not resolved.
  incidentService.isIncidentAcknowledged.mockResolvedValue(true);
  alertService.isAlertAcknowledged.mockResolvedValue(true);
  timeout.readRecordState.mockResolvedValue({
    isAcknowledged: true,
    isResolved: false,
  });
});

describe("an observer's page about a record its responders acknowledged", () => {
  test.each(["incident", "alert"] as const)(
    "about an %s: it goes on, and the acknowledgement is not even asked",
    async (about: "incident" | "alert") => {
      const log: OnCallDutyPolicyExecutionLog = policyRun({
        about: about,
        isObserverPage: true,
      });
      executionLogService.findBy.mockResolvedValue([log]);

      await tick();

      expect(executionLogService.updateOneById).not.toHaveBeenCalled();
      expect(incidentService.isIncidentAcknowledged).not.toHaveBeenCalled();
      expect(alertService.isAlertAcknowledged).not.toHaveBeenCalled();
      expect(timeout.readRecordState).toHaveBeenCalledWith({
        kind: about,
        recordId:
          about === "incident"
            ? log.triggeredByIncidentId
            : log.triggeredByAlertId,
      });
    },
  );

  test("a workflow's direct page as observers goes on too, handed to the service that ends it once its pages are over", async () => {
    const log: OnCallDutyPolicyExecutionLog = policyRun({
      about: "incident",
      isObserverPage: true,
    });
    // A direct page has no policy.
    delete log.onCallDutyPolicyId;
    log.triggeredByWorkflowId = WORKFLOW;
    executionLogService.findBy.mockResolvedValue([log]);

    await tick();

    expect(executionLogService.updateOneById).not.toHaveBeenCalled();
    expect(
      executionLogService.endDirectPageIfItsPagesAreOver,
    ).toHaveBeenCalledTimes(1);
    expect(incidentService.isIncidentAcknowledged).not.toHaveBeenCalled();
  });
});

describe("an observer's page whose record is resolved", () => {
  test.each(["incident", "alert"] as const)(
    "about an %s: over, saying the record is resolved",
    async (about: "incident" | "alert") => {
      const log: OnCallDutyPolicyExecutionLog = policyRun({
        about: about,
        isObserverPage: true,
      });
      executionLogService.findBy.mockResolvedValue([log]);
      timeout.readRecordState.mockResolvedValue({
        isAcknowledged: true,
        isResolved: true,
      });

      await tick();

      expect(executionLogService.updateOneById).toHaveBeenCalledWith({
        id: log.id,
        data: {
          status: OnCallDutyPolicyStatus.Completed,
          statusMessage: getOnCallPolicyRunRecordResolvedMessage(about),
        },
        props: { isRoot: true },
      });
    },
  );
});

describe("a responder's run, beside it, is ended by the acknowledgement as it always was", () => {
  test("its record acknowledged: over, saying so", async () => {
    const log: OnCallDutyPolicyExecutionLog = policyRun({
      about: "incident",
      isObserverPage: false,
    });
    executionLogService.findBy.mockResolvedValue([log]);

    await tick();

    expect(executionLogService.updateOneById).toHaveBeenCalledWith({
      id: log.id,
      data: {
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: getOnCallPolicyRunRecordHandledMessage("incident"),
      },
      props: { isRoot: true },
    });
    expect(timeout.readRecordState).not.toHaveBeenCalled();
  });
});

describe("an observer's page that waits for working hours", () => {
  test("its record acknowledged by its responders: it goes on waiting, still owed to its people", async () => {
    executionLogService.findBy.mockResolvedValue([waitingRun(true)]);

    await tick();

    expect(executionLogService.endWaitingRun).not.toHaveBeenCalled();
    expect(executionLogService.startWaitingRun).not.toHaveBeenCalled();
    expect(incidentService.isIncidentAcknowledged).not.toHaveBeenCalled();
  });

  test("its record resolved: it ends, having paged nobody", async () => {
    const log: OnCallDutyPolicyExecutionLog = waitingRun(true);
    executionLogService.findBy.mockResolvedValue([log]);
    timeout.readRecordState.mockResolvedValue({
      isAcknowledged: true,
      isResolved: true,
    });

    await tick();

    expect(executionLogService.endWaitingRun).toHaveBeenCalledWith(
      expect.objectContaining({
        executionLogId: log.id,
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: getOnCallPolicyRunEndedWhileWaitingMessage("incident"),
      }),
    );
  });

  test("a responder's waiting run, its record acknowledged, ends unpaged as it always did", async () => {
    const log: OnCallDutyPolicyExecutionLog = waitingRun(false);
    executionLogService.findBy.mockResolvedValue([log]);

    await tick();

    expect(executionLogService.endWaitingRun).toHaveBeenCalledWith(
      expect.objectContaining({
        executionLogId: log.id,
        status: OnCallDutyPolicyStatus.Completed,
      }),
    );
  });
});

describe("the worker's tick", () => {
  test("reads each run with whether it pages observers", async () => {
    executionLogService.findBy.mockResolvedValue([]);

    await tick();

    const select: Record<string, unknown> = (
      executionLogService.findBy.mock.calls[0]![0] as {
        select: Record<string, unknown>;
      }
    ).select;

    expect(select["isObserverPage"]).toBe(true);
  });
});
