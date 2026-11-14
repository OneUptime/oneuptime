import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import { FindOperator } from "typeorm";

/*
 * THE PERSON'S-LOG WORKER IN AN ALERT STORM, A PAGE AT A TIME.
 *
 * Every minute the worker used to read every log still paging and start
 * them all at once, each reading its record, its record's state and its
 * person's rules for itself: in a storm that pages one responder about
 * hundreds of alerts, hundreds of copies of the same reads at the same
 * moment. These pin, with the real OnCallRecordStates over mocked services:
 *
 *   1. logs are read a keyset page of USER_LOG_PAGE_SIZE at a time, and
 *      each person's membership once per run;
 *   2. a page's records are read in one query, the project's states once;
 *   3. a person's rules are read once per page for every log that pages the
 *      same person in the same project about the same kind and severity of
 *      record;
 *   4. never more than USER_LOG_CONCURRENCY logs are worked on at once;
 *   5. it stops at its deadline;
 *   6. a page whose records cannot be read waits for the next minute.
 */

type CronHandler = (deadline?: unknown) => Promise<void>;

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

jest.mock("Common/Server/Services/UserOnCallLogService", () => {
  return {
    __esModule: true,
    NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE:
      "Execution completed: this person is no longer a member of the project.",
    default: {
      findBy: jest.fn(),
      updateOneById: jest.fn(),
      getNotificationRuleType: jest.fn(),
      getPagingRulesQuery: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserNotificationRuleService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      executeNotificationRuleItem: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/TeamMember/ProjectMembership", () => {
  return {
    __esModule: true,
    default: {
      getMemberKeys: jest.fn(),
      getKey: jest.fn((projectId: ObjectID, userId: ObjectID) => {
        return `${projectId.toString()}:${userId.toString()}`;
      }),
    },
  };
});

jest.mock("Common/Server/Services/IncidentService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentStateService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import UserOnCallLogService from "Common/Server/Services/UserOnCallLogService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import ProjectMembership from "Common/Server/Utils/TeamMember/ProjectMembership";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import {
  USER_LOG_CONCURRENCY,
  USER_LOG_PAGE_SIZE,
  USER_LOG_SELECT,
} from "../../../../FeatureSet/Workers/Jobs/UserOnCallLog/ExecutePendingExecutions";

const JOB_NAME: string = "UserOnCallLog:ExecutePendingExecutions";

const logService: {
  findBy: jest.Mock;
  updateOneById: jest.Mock;
  getNotificationRuleType: jest.Mock;
  getPagingRulesQuery: jest.Mock;
} = UserOnCallLogService as unknown as {
  findBy: jest.Mock;
  updateOneById: jest.Mock;
  getNotificationRuleType: jest.Mock;
  getPagingRulesQuery: jest.Mock;
};
const ruleService: {
  findBy: jest.Mock;
  executeNotificationRuleItem: jest.Mock;
} = UserNotificationRuleService as unknown as {
  findBy: jest.Mock;
  executeNotificationRuleItem: jest.Mock;
};
const membership: { getMemberKeys: jest.Mock } =
  ProjectMembership as unknown as { getMemberKeys: jest.Mock };
const incidentService: { findBy: jest.Mock } = IncidentService as unknown as {
  findBy: jest.Mock;
};
const incidentStateService: { findBy: jest.Mock } =
  IncidentStateService as unknown as { findBy: jest.Mock };

const MINUTE: number = 60 * 1000;
const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const RESPONDER: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000002",
);

function uuid(prefix: string, index: number): ObjectID {
  return new ObjectID(
    `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
}

const CREATED_STATE: ObjectID = uuid("11111111", 1);
const ACKNOWLEDGED_STATE: ObjectID = uuid("11111111", 2);
const RESOLVED_STATE: ObjectID = uuid("11111111", 3);
const SEV_1: ObjectID = uuid("55555555", 1);
const SEV_2: ObjectID = uuid("55555555", 2);

function projectStates(): Array<IncidentState> {
  return [
    [CREATED_STATE, 1, "isCreatedState"],
    [ACKNOWLEDGED_STATE, 2, "isAcknowledgedState"],
    [RESOLVED_STATE, 3, "isResolvedState"],
  ].map(([id, order, flag]: Array<unknown>) => {
    const state: IncidentState = new IncidentState();
    state.id = id as ObjectID;
    state.projectId = PROJECT_ID;
    state.order = order as number;
    (state as unknown as Record<string, boolean>)[flag as string] = true;
    return state;
  });
}

let logs: Array<UserOnCallLog>;
let incidentById: Map<string, { stateId: ObjectID; severityId: ObjectID }>;

// A log paging RESPONDER about an incident, started `minutesAgo`.
function pagingLog(data: {
  index: number;
  minutesAgo?: number;
  incidentState?: ObjectID;
  severityId?: ObjectID;
  userId?: ObjectID;
}): UserOnCallLog {
  const log: UserOnCallLog = new UserOnCallLog();
  log.id = uuid("bbbbbbbb", data.index);
  log.projectId = PROJECT_ID;
  log.userId = data.userId || RESPONDER;
  log.status = UserNotificationExecutionStatus.Executing;
  log.createdAt = new Date(Date.now() - (data.minutesAgo ?? 3) * MINUTE);
  log.executedNotificationRules = {};
  log.userNotificationEventType = UserNotificationEventType.IncidentCreated;
  log.triggeredByIncidentId = uuid("dddddddd", data.index);

  incidentById.set(log.triggeredByIncidentId.toString(), {
    stateId: data.incidentState || CREATED_STATE,
    severityId: data.severityId || SEV_1,
  });

  return log;
}

function rule(index: number, notifyAfterMinutes: number): UserNotificationRule {
  const notificationRule: UserNotificationRule = new UserNotificationRule();
  notificationRule.id = uuid("eeeeeeee", index);
  notificationRule.notifyAfterMinutes = notifyAfterMinutes;
  return notificationRule;
}

function cursorOf(query: Record<string, unknown>): string | undefined {
  const cursor: FindOperator<ObjectID> | undefined = query["_id"] as
    | FindOperator<ObjectID>
    | undefined;

  return cursor
    ? String(Object.values(cursor.objectLiteralParameters!)[0])
    : undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
  logs = [];
  incidentById = new Map();

  logService.findBy.mockImplementation(
    async (args: {
      query: Record<string, unknown>;
      limit: number;
    }): Promise<Array<UserOnCallLog>> => {
      const after: string | undefined = cursorOf(args.query);

      return logs
        .filter((log: UserOnCallLog) => {
          return (
            log.status === UserNotificationExecutionStatus.Executing &&
            (after === undefined || log.id!.toString() > after)
          );
        })
        .sort((a: UserOnCallLog, b: UserOnCallLog) => {
          return a.id!.toString() < b.id!.toString() ? -1 : 1;
        })
        .slice(0, args.limit);
    },
  );
  logService.updateOneById.mockResolvedValue(undefined);
  logService.getNotificationRuleType.mockReturnValue(
    NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
  );
  // The query is the read's key: who, where, which kind and severity.
  logService.getPagingRulesQuery.mockImplementation(
    (data: Record<string, unknown>) => {
      return { ...data };
    },
  );

  membership.getMemberKeys.mockImplementation(
    async (
      pairs: Array<{ projectId: ObjectID; userId: ObjectID }>,
    ): Promise<Set<string>> => {
      return new Set(
        pairs.map((pair: { projectId: ObjectID; userId: ObjectID }) => {
          return `${pair.projectId.toString()}:${pair.userId.toString()}`;
        }),
      );
    },
  );

  incidentService.findBy.mockImplementation(
    async (args: {
      query: Record<string, unknown>;
    }): Promise<Array<Incident>> => {
      const predicate: FindOperator<unknown> = args.query[
        "_id"
      ] as FindOperator<unknown>;
      const ids: Array<string> = Object.values(
        predicate.objectLiteralParameters!,
      )[0] as Array<string>;

      return ids.map((id: string) => {
        const incident: Incident = new Incident();
        incident.id = new ObjectID(id);
        incident.projectId = PROJECT_ID;
        incident.currentIncidentStateId = incidentById.get(id)!.stateId;
        incident.incidentSeverityId = incidentById.get(id)!.severityId;
        return incident;
      });
    },
  );
  incidentStateService.findBy.mockResolvedValue(projectStates());

  // One rule, due five minutes in: nothing to send for a log three minutes old.
  ruleService.findBy.mockResolvedValue([rule(1, 5)]);
  ruleService.executeNotificationRuleItem.mockResolvedValue(undefined);
});

async function tick(deadline?: JobDeadline): Promise<void> {
  await mockCapturedJobs[JOB_NAME]!(deadline);
}

describe("the person's-log worker, a page at a time", () => {
  test("reads the logs still paging a keyset page at a time, and each person's membership once a run", async () => {
    for (let index: number = 0; index < USER_LOG_PAGE_SIZE * 2 + 50; index++) {
      logs.push(pagingLog({ index }));
    }

    await tick();

    expect(logService.findBy).toHaveBeenCalledTimes(3);

    const reads: Array<{
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
      limit: number;
    }> = logService.findBy.mock.calls.map((call: Array<unknown>) => {
      return call[0] as {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        sort: Record<string, unknown>;
        limit: number;
      };
    });

    for (const read of reads) {
      expect(read.query["status"]).toBe(
        UserNotificationExecutionStatus.Executing,
      );
      expect(read.sort).toEqual({ _id: SortOrder.Ascending });
      expect(read.limit).toBe(USER_LOG_PAGE_SIZE);
      expect(read.select).toBe(USER_LOG_SELECT);
    }
    expect(cursorOf(reads[1]!.query)).toBe(
      uuid("bbbbbbbb", USER_LOG_PAGE_SIZE - 1).toString(),
    );

    // One responder: membership is read for the first page and known after.
    expect(membership.getMemberKeys).toHaveBeenCalledTimes(1);
    expect(incidentService.findBy).toHaveBeenCalledTimes(3);
    expect(incidentStateService.findBy).toHaveBeenCalledTimes(1);
  });

  test("reads membership again only for a page that names somebody new", async () => {
    const otherResponder: ObjectID = new ObjectID(
      "aaaaaaaa-0000-4000-8000-000000000003",
    );

    for (let index: number = 0; index < USER_LOG_PAGE_SIZE * 2 + 10; index++) {
      logs.push(
        pagingLog({
          index,
          // Somebody else only on the last page.
          userId:
            index >= USER_LOG_PAGE_SIZE * 2 && index % 2 === 0
              ? otherResponder
              : RESPONDER,
        }),
      );
    }

    await tick();

    expect(membership.getMemberKeys).toHaveBeenCalledTimes(2);
    const secondRead: Array<{ userId: ObjectID }> = membership.getMemberKeys
      .mock.calls[1]![0] as Array<{ userId: ObjectID }>;
    expect(
      secondRead.map((pair: { userId: ObjectID }) => {
        return pair.userId.toString();
      }),
    ).toEqual([otherResponder.toString()]);
  });

  test("reads a person's rules once a page for every log that shares them", async () => {
    // One responder paged about 150 incidents of one severity, 30 of another.
    for (let index: number = 0; index < 180; index++) {
      logs.push(
        pagingLog({ index, severityId: index % 6 === 5 ? SEV_2 : SEV_1 }),
      );
    }

    await tick();

    // Two pages, two severities: at most four reads for 180 logs.
    expect(ruleService.findBy).toHaveBeenCalledTimes(4);

    const keys: Array<string> = ruleService.findBy.mock.calls.map(
      (call: Array<unknown>) => {
        const query: Record<string, unknown> = (
          call[0] as { query: Record<string, unknown> }
        ).query;
        return `${String(query["userId"])}|${String(query["incidentSeverityId"])}`;
      },
    );
    expect(new Set(keys).size).toBe(2);
    expect(
      ruleService.findBy.mock.calls.every((call: Array<unknown>) => {
        return (
          (call[0] as { query: Record<string, unknown> }).query["ruleType"] ===
          NotificationRuleType.ON_CALL_EXECUTED_INCIDENT
        );
      }),
    ).toBe(true);
  });

  test("never sends to more than its limit of logs at once", async () => {
    // Logs ten minutes old: their five-minute rule is due.
    for (let index: number = 0; index < 50; index++) {
      logs.push(pagingLog({ index, minutesAgo: 10 }));
    }

    let inFlight: number = 0;
    let mostInFlight: number = 0;

    ruleService.executeNotificationRuleItem.mockImplementation(async () => {
      inFlight++;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await new Promise<void>((resolve: () => void) => {
        setImmediate(resolve);
      });
      inFlight--;
    });

    await tick();

    expect(ruleService.executeNotificationRuleItem).toHaveBeenCalledTimes(50);
    expect(mostInFlight).toBe(USER_LOG_CONCURRENCY);
  });

  test("ends every log whose incident was acknowledged, without reading its rules", async () => {
    for (let index: number = 0; index < 40; index++) {
      logs.push(pagingLog({ index, incidentState: ACKNOWLEDGED_STATE }));
    }

    await tick();

    expect(logService.updateOneById).toHaveBeenCalledTimes(40);
    for (const call of logService.updateOneById.mock.calls) {
      expect((call[0] as { data: Record<string, unknown> }).data).toEqual({
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: "Execution completed because incident is acknowledged.",
      });
    }
    expect(ruleService.findBy).not.toHaveBeenCalled();
  });

  test("a log whose incident is gone stays paging, to be read again next minute", async () => {
    logs.push(pagingLog({ index: 1 }));
    incidentService.findBy.mockResolvedValue([]);

    await tick();

    // As reading it on its own did: a plain error, not a permanent one.
    expect(logService.updateOneById).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  test("stops at its deadline", async () => {
    for (let index: number = 0; index < USER_LOG_PAGE_SIZE * 2; index++) {
      logs.push(pagingLog({ index, minutesAgo: 10 }));
    }

    const deadline: JobDeadline = new JobDeadline();
    ruleService.executeNotificationRuleItem.mockImplementation(async () => {
      if (ruleService.executeNotificationRuleItem.mock.calls.length === 10) {
        deadline.end();
      }
    });

    await tick(deadline);

    expect(logService.findBy).toHaveBeenCalledTimes(1);
    expect(
      ruleService.executeNotificationRuleItem.mock.calls.length,
    ).toBeLessThan(10 + USER_LOG_CONCURRENCY);
  });

  test("a page whose records cannot be read waits for the next minute", async () => {
    for (let index: number = 0; index < USER_LOG_PAGE_SIZE + 5; index++) {
      logs.push(pagingLog({ index, minutesAgo: 10 }));
    }

    incidentService.findBy.mockRejectedValueOnce(
      new Error("remaining connection slots are reserved"),
    );

    await tick();

    expect(ruleService.executeNotificationRuleItem).toHaveBeenCalledTimes(5);
    expect(logService.updateOneById).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: UserNotificationExecutionStatus.Error,
        }),
      }),
    );
  });
});
