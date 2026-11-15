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
      handStartedRunToEscalation: jest.fn(),
    },
  };
});

import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import "../../../../FeatureSet/Workers/Jobs/OnCallDutyPolicyExecutionLog/TimeoutStuckExecutions";

const JOB_NAME: string = "OnCallDutyPolicyExecutionLog:TimeoutStuckExecutions";

const executionLogService: {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  handStartedRunToEscalation: jest.Mock;
} = OnCallDutyPolicyExecutionLogService as unknown as {
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  handStartedRunToEscalation: jest.Mock;
};

// The runs handed to their escalation, and the status each was handed over from.
function handedOver(): Array<string> {
  return executionLogService.handStartedRunToEscalation.mock.calls.map(
    (call: Array<unknown>): string => {
      const handOver: {
        executionLogId: ObjectID;
        fromStatuses: Array<OnCallDutyPolicyStatus>;
      } = call[0] as {
        executionLogId: ObjectID;
        fromStatuses: Array<OnCallDutyPolicyStatus>;
      };

      return `${handOver.executionLogId.toString()} from ${handOver.fromStatuses.join(", ")}`;
    },
  );
}

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
  executionLogService.handStartedRunToEscalation.mockResolvedValue(true);
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
    expect(handedOver()).toEqual([]);

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
    expect(handedOver()).toEqual([]);
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

  /*
   * Stuck, it is handed to its escalation (issue #8405), its page due when
   * its paging started - not when it was created, hours before.
   */
  test("still starting five minutes after its paging started is stuck, as any run, and handed to its escalation", async () => {
    const pagingStartsAt: Date = new Date(Date.now() - 6 * MINUTE);
    const stuck: OnCallDutyPolicyExecutionLog = run({
      status: OnCallDutyPolicyStatus.Started,
      pagingStartsAt: pagingStartsAt,
    });
    stored([stuck]);

    await tick();

    expect(timedOut()).toEqual([]);
    expect(executionLogService.handStartedRunToEscalation).toHaveBeenCalledWith(
      {
        executionLogId: stuck.id,
        dueAt: pagingStartsAt,
        fromStatuses: [OnCallDutyPolicyStatus.Started],
      },
    );
  });
});

describe("a run that never waited", () => {
  test("is stuck five minutes after it was created, as it always was, and its page was due then", async () => {
    const stuck: OnCallDutyPolicyExecutionLog = run({
      status: OnCallDutyPolicyStatus.Started,
    });
    stored([stuck]);

    await tick();

    expect(handedOver()).toEqual([
      `${stuck.id!.toString()} from ${OnCallDutyPolicyStatus.Started}`,
    ]);
    expect(
      (
        executionLogService.handStartedRunToEscalation.mock.calls[0]![0] as {
          dueAt: Date;
        }
      ).dueAt,
    ).toEqual(stuck.createdAt);
  });

  test("of the two in Started on one tick, only the stuck one is handed over", async () => {
    const stuck: OnCallDutyPolicyExecutionLog = run({
      status: OnCallDutyPolicyStatus.Started,
    });
    const starting: OnCallDutyPolicyExecutionLog = run({
      status: OnCallDutyPolicyStatus.Started,
      pagingStartsAt: new Date(Date.now() - MINUTE),
    });
    stored([stuck, starting]);

    await tick();

    expect(handedOver()).toEqual([
      `${stuck.id!.toString()} from ${OnCallDutyPolicyStatus.Started}`,
    ]);
    expect(timedOut()).toEqual([]);
  });
});
