import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ObjectID from "Common/Types/ObjectID";
import {
  getOnCallPolicyRunRecordHandledMessage,
  getOnCallPolicyRunRecordResolvedMessage,
} from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";

/*
 * A PAGE A PERSON ASKED FOR, ON THE WORKER'S TICK (OnCallPersonPage).
 *
 * Somebody pages a colleague from an incident's own Slack or Teams channel
 * - mostly into an incident that is being worked on, acknowledged already.
 * A direct page is over once its record is acknowledged: that ended such a
 * page at the first tick, after the notifications its people's rules send
 * straight away - no call ten minutes later, no push that repeats. A page a
 * person asked for goes on until somebody it paged answers it (which ends
 * it where they do), or its record is resolved. A workflow's direct page,
 * and every policy's run, end on the acknowledgement as they always did.
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
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  claimEscalationAdvance: jest.Mock;
  endDirectPageIfItsPagesAreOver: jest.Mock;
}

const executionLogService: ExecutionLogServiceMock =
  OnCallDutyPolicyExecutionLogService as unknown as ExecutionLogServiceMock;

const incidentService: { isIncidentAcknowledged: jest.Mock } =
  IncidentService as unknown as { isIncidentAcknowledged: jest.Mock };

const alertService: { isAlertAcknowledged: jest.Mock } =
  AlertService as unknown as { isAlertAcknowledged: jest.Mock };

const timeout: { readRecordState: jest.Mock } =
  OnCallAcknowledgementTimeout as unknown as { readRecordState: jest.Mock };

const JANE: ObjectID = new ObjectID("9e000000-0000-4000-8000-000000000001");
const WORKFLOW: ObjectID = new ObjectID("9e000000-0000-4000-8000-000000000002");
const PAGING_STARTED_AT: Date = new Date(Date.now() - 20 * 60 * 1000);

// A direct page that is paging: a person's, unless a workflow is named.
function directPage(data: {
  about: "incident" | "alert";
  startedBy: "person" | "workflow" | "workflow as a person";
}): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = ObjectID.generate();
  log.projectId = ObjectID.generate();
  log.status = OnCallDutyPolicyStatus.Executing;
  log.executeNextEscalationRuleInMinutes = 0;
  log.lastEscalationRuleExecutedAt = PAGING_STARTED_AT;
  log.createdAt = PAGING_STARTED_AT;
  log.onCallPolicyExecutionRepeatCount = 1;

  if (data.about === "incident") {
    log.triggeredByIncidentId = ObjectID.generate();
  } else {
    log.triggeredByAlertId = ObjectID.generate();
  }

  if (data.startedBy !== "workflow") {
    log.triggeredByUserId = JANE;
  }

  if (data.startedBy !== "person") {
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

beforeEach(() => {
  jest.clearAllMocks();
  executionLogService.updateOneById.mockResolvedValue(undefined);
  executionLogService.endDirectPageIfItsPagesAreOver.mockResolvedValue(false);
  // Somebody else is on the record: it is acknowledged, not resolved.
  incidentService.isIncidentAcknowledged.mockResolvedValue(true);
  alertService.isAlertAcknowledged.mockResolvedValue(true);
  timeout.readRecordState.mockResolvedValue({
    isAcknowledged: true,
    isResolved: false,
  });
});

describe("a person's page about a record somebody else acknowledged", () => {
  test.each(["incident", "alert"] as const)(
    "about an %s: it goes on - handed to the service that ends it once its pages are over - and the acknowledgement is not even asked",
    async (about: "incident" | "alert") => {
      const log: OnCallDutyPolicyExecutionLog = directPage({
        about: about,
        startedBy: "person",
      });
      executionLogService.findAllBy.mockResolvedValue([log]);

      await tick();

      expect(executionLogService.updateOneById).not.toHaveBeenCalled();
      expect(
        executionLogService.endDirectPageIfItsPagesAreOver,
      ).toHaveBeenCalledWith({
        executionLogId: log.id,
        pagingStartedAt: PAGING_STARTED_AT,
      });
      expect(incidentService.isIncidentAcknowledged).not.toHaveBeenCalled();
      expect(alertService.isAlertAcknowledged).not.toHaveBeenCalled();
    },
  );

  test("its record's state is asked of the record itself, by its kind and id", async () => {
    const log: OnCallDutyPolicyExecutionLog = directPage({
      about: "incident",
      startedBy: "person",
    });
    executionLogService.findAllBy.mockResolvedValue([log]);

    await tick();

    expect(timeout.readRecordState).toHaveBeenCalledWith({
      kind: "incident",
      recordId: log.triggeredByIncidentId,
    });
  });
});

describe("a person's page whose record is resolved", () => {
  test.each(["incident", "alert"] as const)(
    "about an %s: over, saying the record is resolved - the words a page again ends with",
    async (about: "incident" | "alert") => {
      const log: OnCallDutyPolicyExecutionLog = directPage({
        about: about,
        startedBy: "person",
      });
      executionLogService.findAllBy.mockResolvedValue([log]);
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
      expect(
        executionLogService.endDirectPageIfItsPagesAreOver,
      ).not.toHaveBeenCalled();
    },
  );

  test("a record that is gone ends it with why, as a page again's does", async () => {
    const log: OnCallDutyPolicyExecutionLog = directPage({
      about: "incident",
      startedBy: "person",
    });
    executionLogService.findAllBy.mockResolvedValue([log]);
    timeout.readRecordState.mockResolvedValue(null);

    await tick();

    expect(executionLogService.updateOneById).toHaveBeenCalledWith({
      id: log.id,
      data: {
        status: OnCallDutyPolicyStatus.Error,
        statusMessage: "The incident this page is about is gone.",
      },
      props: { isRoot: true },
    });
  });
});

describe("a workflow's direct page is no person's page", () => {
  test.each(["workflow", "workflow as a person"] as const)(
    "started by a %s: ended by its record's acknowledgement, as it always was",
    async (startedBy: "workflow" | "workflow as a person") => {
      const log: OnCallDutyPolicyExecutionLog = directPage({
        about: "incident",
        startedBy: startedBy,
      });
      executionLogService.findAllBy.mockResolvedValue([log]);

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
    },
  );
});

describe("the worker's tick", () => {
  test("reads each run with who started it, which tells a person's page apart", async () => {
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
  });
});
