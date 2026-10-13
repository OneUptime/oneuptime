import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ObjectID from "Common/Types/ObjectID";
import {
  ON_CALL_DIRECT_PAGE_NEVER_STARTED_MESSAGE,
  ON_CALL_DIRECT_PAGE_TIMED_OUT_MESSAGE,
} from "Common/Types/OnCallDutyPolicy/OnCallDirectPage";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";

/*
 * A RUN THAT STANDS STILL IS STOPPED, AND TOLD WHAT IT IS.
 *
 * A run moves from Scheduled to Started to Executing in seconds. One that
 * is still Scheduled or Started after five minutes is stuck - the process
 * that was paging died - and the job ends it as an error, so "why was nobody
 * paged?" has an answer. A policy's run is told "Policy Execution timed
 * out."; a direct page has no policy, and its run's words are shown in the
 * record's feed and its Slack and Microsoft Teams message, so it is told its
 * paging timed out instead.
 *
 * The job registers itself through RunCron at import time and exports
 * nothing, so the Cron util is mocked to capture the handler.
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

jest.mock("Common/Server/Services/OnCallDutyPolicyExecutionLogService", () => {
  return {
    __esModule: true,
    default: {
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/TimeoutStuckExecutions";

const JOB_NAME: string = "OnCallDutyPolicyExecutionLog:TimeoutStuckExecutions";

const executionLogService: {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
} = OnCallDutyPolicyExecutionLogService as unknown as {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
};

function run(isDirectPage: boolean): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = ObjectID.generate();
  log.createdAt = new Date(Date.now() - 60 * 60 * 1000);

  if (!isDirectPage) {
    log.onCallDutyPolicyId = ObjectID.generate();
  }

  return log;
}

// What the job reads: the runs stuck in Started, then those stuck in Scheduled.
function stuck(data: {
  started?: Array<OnCallDutyPolicyExecutionLog>;
  scheduled?: Array<OnCallDutyPolicyExecutionLog>;
}): void {
  executionLogService.findAllBy.mockImplementation(
    async (findBy: {
      query: { status: OnCallDutyPolicyStatus };
    }): Promise<Array<OnCallDutyPolicyExecutionLog>> => {
      if (findBy.query.status === OnCallDutyPolicyStatus.Started) {
        return data.started || [];
      }

      if (findBy.query.status === OnCallDutyPolicyStatus.Scheduled) {
        return data.scheduled || [];
      }

      return [];
    },
  );
}

function messageGivenTo(log: OnCallDutyPolicyExecutionLog): unknown {
  const call: Array<unknown> | undefined =
    executionLogService.updateOneById.mock.calls.find(
      (candidate: Array<unknown>): boolean => {
        return (
          (candidate[0] as { id: ObjectID }).id.toString() ===
          log.id!.toString()
        );
      },
    );

  return (
    call?.[0] as
      | { data: { status: OnCallDutyPolicyStatus; statusMessage: string } }
      | undefined
  )?.data;
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
});

describe("a run stuck while paging", () => {
  test("a direct page is told its paging timed out", async () => {
    const page: OnCallDutyPolicyExecutionLog = run(true);
    stuck({ started: [page] });

    await tick();

    expect(messageGivenTo(page)).toEqual({
      status: OnCallDutyPolicyStatus.Error,
      statusMessage: ON_CALL_DIRECT_PAGE_TIMED_OUT_MESSAGE,
    });
  });

  test("a policy's run is told what it always was", async () => {
    const policyRun: OnCallDutyPolicyExecutionLog = run(false);
    stuck({ started: [policyRun] });

    await tick();

    expect(messageGivenTo(policyRun)).toEqual({
      status: OnCallDutyPolicyStatus.Error,
      statusMessage: "Policy Execution timed out.",
    });
  });
});

describe("a run that never started", () => {
  test("a direct page is told its paging never started", async () => {
    const page: OnCallDutyPolicyExecutionLog = run(true);
    stuck({ scheduled: [page] });

    await tick();

    expect(messageGivenTo(page)).toEqual({
      status: OnCallDutyPolicyStatus.Error,
      statusMessage: ON_CALL_DIRECT_PAGE_NEVER_STARTED_MESSAGE,
    });
  });

  test("a policy's run is told what it always was", async () => {
    const policyRun: OnCallDutyPolicyExecutionLog = run(false);
    stuck({ scheduled: [policyRun] });

    await tick();

    expect(messageGivenTo(policyRun)).toEqual({
      status: OnCallDutyPolicyStatus.Error,
      statusMessage:
        "Policy Execution never started (stuck in Scheduled) and was timed out.",
    });
  });
});

describe("what the job reads and writes", () => {
  test("each stuck run is read with its policy id, which tells a direct page apart", async () => {
    stuck({});

    await tick();

    expect(executionLogService.findAllBy).toHaveBeenCalledTimes(2);

    for (const call of executionLogService.findAllBy.mock.calls) {
      const select: Record<string, unknown> = (
        call[0] as { select: Record<string, unknown> }
      ).select;

      expect(select["onCallDutyPolicyId"]).toBe(true);
    }
  });

  test("runs of both kinds on one tick are each told their own words, as OneUptime", async () => {
    const page: OnCallDutyPolicyExecutionLog = run(true);
    const policyRun: OnCallDutyPolicyExecutionLog = run(false);
    const pageNeverStarted: OnCallDutyPolicyExecutionLog = run(true);

    stuck({ started: [page, policyRun], scheduled: [pageNeverStarted] });

    await tick();

    expect(executionLogService.updateOneById).toHaveBeenCalledTimes(3);

    for (const call of executionLogService.updateOneById.mock.calls) {
      expect((call[0] as { props: unknown }).props).toEqual({ isRoot: true });
    }

    expect(
      (messageGivenTo(page) as { statusMessage: string }).statusMessage,
    ).toBe("Paging timed out.");
    expect(
      (messageGivenTo(policyRun) as { statusMessage: string }).statusMessage,
    ).toBe("Policy Execution timed out.");
    expect(
      (messageGivenTo(pageNeverStarted) as { statusMessage: string })
        .statusMessage,
    ).toBe("Paging never started and was timed out.");
  });
});
