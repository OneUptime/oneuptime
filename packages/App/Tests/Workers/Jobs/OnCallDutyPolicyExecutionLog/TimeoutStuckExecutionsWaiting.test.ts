import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ObjectID from "Common/Types/ObjectID";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";

/*
 * A RUN THAT WAITS IS NOT STUCK.
 *
 * A run moves from Scheduled to Started to Executing in seconds, so one
 * still Scheduled or Started five minutes after it was created is stuck and
 * is ended as an error (TimeoutStuckExecutions). A run an on-call rule holds
 * until working hours waits for hours, or over a weekend - in a status of
 * its own, Waiting, which the job never reads, so nothing times it out.
 *
 * Once its moment comes it is started from Waiting, hours after it was
 * created, and moves through Started like any run: it is stuck only if it
 * is still there five minutes after its paging started (its pagingStartsAt,
 * which the start moves to that moment), not because it was created long
 * ago.
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

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

// A policy's run, created hours ago - at 2am, say, held until 9am.
function run(data: {
  status: OnCallDutyPolicyStatus;
  pagingStartsAt?: Date | undefined;
}): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log.id = ObjectID.generate();
  log.onCallDutyPolicyId = ObjectID.generate();
  log.status = data.status;
  log.createdAt = new Date(Date.now() - 7 * HOUR);

  if (data.pagingStartsAt) {
    log.pagingStartsAt = data.pagingStartsAt;
  }

  return log;
}

/*
 * What the job reads, by the status it asks for - as the database would
 * answer: only runs in that status.
 */
function stored(runs: Array<OnCallDutyPolicyExecutionLog>): void {
  executionLogService.findAllBy.mockImplementation(
    async (findBy: {
      query: { status: OnCallDutyPolicyStatus };
    }): Promise<Array<OnCallDutyPolicyExecutionLog>> => {
      return runs.filter((log: OnCallDutyPolicyExecutionLog): boolean => {
        return log.status === findBy.query.status;
      });
    },
  );
}

function timedOut(): Array<string> {
  return executionLogService.updateOneById.mock.calls.map(
    (call: Array<unknown>): string => {
      return (call[0] as { id: ObjectID }).id.toString();
    },
  );
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

describe("a run waiting for working hours", () => {
  test("is never read, however long ago it was created", async () => {
    const held: OnCallDutyPolicyExecutionLog = run({
      status: OnCallDutyPolicyStatus.Waiting,
      pagingStartsAt: new Date(Date.now() + 2 * HOUR),
    });
    stored([held]);

    await tick();

    expect(timedOut()).toEqual([]);

    for (const call of executionLogService.findAllBy.mock.calls) {
      expect(
        (call[0] as { query: { status: OnCallDutyPolicyStatus } }).query.status,
      ).not.toBe(OnCallDutyPolicyStatus.Waiting);
    }
  });

  test("whose paging started a moment ago is left to finish starting", async () => {
    const starting: OnCallDutyPolicyExecutionLog = run({
      status: OnCallDutyPolicyStatus.Started,
      pagingStartsAt: new Date(Date.now() - 30 * 1000),
    });
    stored([starting]);

    await tick();

    expect(timedOut()).toEqual([]);
  });

  test("is read with the moment its paging started", async () => {
    stored([]);

    await tick();

    const startedRead: { select: Record<string, unknown> } | undefined =
      executionLogService.findAllBy.mock.calls
        .map((call: Array<unknown>) => {
          return call[0] as {
            query: { status: OnCallDutyPolicyStatus };
            select: Record<string, unknown>;
          };
        })
        .find(
          (findBy: { query: { status: OnCallDutyPolicyStatus } }): boolean => {
            return findBy.query.status === OnCallDutyPolicyStatus.Started;
          },
        );

    expect(startedRead?.select["pagingStartsAt"]).toBe(true);
  });

  test("still starting five minutes after its paging started is stuck, as any run", async () => {
    const stuck: OnCallDutyPolicyExecutionLog = run({
      status: OnCallDutyPolicyStatus.Started,
      pagingStartsAt: new Date(Date.now() - 6 * MINUTE),
    });
    stored([stuck]);

    await tick();

    expect(timedOut()).toEqual([stuck.id!.toString()]);
    expect(executionLogService.updateOneById).toHaveBeenCalledWith({
      id: stuck.id,
      data: {
        status: OnCallDutyPolicyStatus.Error,
        statusMessage: "Policy Execution timed out.",
      },
      props: { isRoot: true },
    });
  });
});

describe("a run that never waited", () => {
  test("is stuck five minutes after it was created, as it always was", async () => {
    const stuck: OnCallDutyPolicyExecutionLog = run({
      status: OnCallDutyPolicyStatus.Started,
    });
    stored([stuck]);

    await tick();

    expect(timedOut()).toEqual([stuck.id!.toString()]);
  });

  test("of the two in Started on one tick, only the stuck one is timed out", async () => {
    const stuck: OnCallDutyPolicyExecutionLog = run({
      status: OnCallDutyPolicyStatus.Started,
    });
    const starting: OnCallDutyPolicyExecutionLog = run({
      status: OnCallDutyPolicyStatus.Started,
      pagingStartsAt: new Date(Date.now() - MINUTE),
    });
    stored([stuck, starting]);

    await tick();

    expect(timedOut()).toEqual([stuck.id!.toString()]);
  });
});
