import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import ObjectID from "Common/Types/ObjectID";
import {
  getOnCallPageRecordDeletedMessage,
  ON_CALL_PAGE_NAMES_NO_RECORD_MESSAGE,
} from "Common/Types/OnCallDutyPolicy/OnCallPageRecordGone";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";

/*
 * A PERSON'S LOG WHOSE INCIDENT, ALERT OR EPISODE WAS DELETED ENDS
 * (issue #8106).
 *
 * The worker threw a plain Error - "Incident, Alert, Alert Episode, or
 * Incident Episode not found." - for a log none of whose records could be
 * read. Its catch reads a plain Error as a failure a retry can fix and
 * leaves the log Executing, so the log was read again the next minute,
 * failed again and logged an error again, forever: nothing else ends an
 * Executing log. A deleted record does not come back, so the log ends now:
 * Completed, saying which record was deleted (OnCallPageRecordGone),
 * without reading the person's rules or sending anything.
 *
 * Driven here through the tick RunCron registered, with the real
 * OnCallRecordStates over mocked services, and the logs kept in a table
 * the way the database keeps them: the tick reads only the logs still
 * Executing, and a log it ends is Completed from then on.
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
      "Stopped because this user is no longer a member of the project. Their remaining notification rules were not run.",
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

/*
 * The four kinds of record and their states, read by the page's one read
 * of each (OnCallRecordStates). Nothing reads a record on its own: a
 * findOneById here would be undefined, and fail the log it was read for.
 */
jest.mock("Common/Server/Services/IncidentService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/AlertService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentEpisodeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/AlertEpisodeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/IncidentStateService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/AlertStateService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import UserOnCallLogService from "Common/Server/Services/UserOnCallLogService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import AlertService from "Common/Server/Services/AlertService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import AlertStateService from "Common/Server/Services/AlertStateService";
import ProjectMembership from "Common/Server/Utils/TeamMember/ProjectMembership";
import logger from "Common/Server/Utils/Logger";
import { executePendingNotificationLog } from "../../../../FeatureSet/Workers/Jobs/UserOnCallLog/ExecutePendingExecutions";

/*
 * The part of typeorm's FindOperator the record reads are answered from.
 * typeorm is Common's dependency, not App's, so its type cannot be imported
 * here (TestImportsResolveFromApp.test.ts).
 */
interface ReadFindOperator {
  objectLiteralParameters?: Record<string, unknown> | undefined;
}

type RecordKind = "incident" | "alert" | "incident episode" | "alert episode";

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
const loggerError: jest.Mock = logger.error as unknown as jest.Mock;

const MINUTE: number = 60 * 1000;
const PROJECT_ID: ObjectID = new ObjectID(
  "81060000-0000-4000-8000-000000000001",
);
const RESPONDER: ObjectID = new ObjectID(
  "81060000-0000-4000-8000-000000000002",
);
const FORMER_MEMBER: ObjectID = new ObjectID(
  "81060000-0000-4000-8000-000000000003",
);

function uuid(prefix: string, index: number): ObjectID {
  return new ObjectID(
    `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
}

const CREATED_STATE: ObjectID = uuid("81061111", 1);
const ACKNOWLEDGED_STATE: ObjectID = uuid("81061111", 2);
const RESOLVED_STATE: ObjectID = uuid("81061111", 3);
const SEVERITY: ObjectID = uuid("81065555", 1);

// Each kind of record: the log column that names it, its event type and its service.
const KINDS: Array<{
  kind: RecordKind;
  column:
    | "triggeredByIncidentId"
    | "triggeredByAlertId"
    | "triggeredByIncidentEpisodeId"
    | "triggeredByAlertEpisodeId";
  eventType: UserNotificationEventType;
  ruleType: NotificationRuleType;
  service: { findBy: jest.Mock };
}> = [
  {
    kind: "incident",
    column: "triggeredByIncidentId",
    eventType: UserNotificationEventType.IncidentCreated,
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    service: IncidentService as unknown as { findBy: jest.Mock },
  },
  {
    kind: "alert",
    column: "triggeredByAlertId",
    eventType: UserNotificationEventType.AlertCreated,
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    service: AlertService as unknown as { findBy: jest.Mock },
  },
  {
    kind: "incident episode",
    column: "triggeredByIncidentEpisodeId",
    eventType: UserNotificationEventType.IncidentEpisodeCreated,
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    service: IncidentEpisodeService as unknown as { findBy: jest.Mock },
  },
  {
    kind: "alert episode",
    column: "triggeredByAlertEpisodeId",
    eventType: UserNotificationEventType.AlertEpisodeCreated,
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    service: AlertEpisodeService as unknown as { findBy: jest.Mock },
  },
];

// The logs, as the table holds them.
let logs: Array<UserOnCallLog>;

// The records that still exist, by kind and id, with the state each is in.
let records: Map<RecordKind, Map<string, ObjectID>>;

function keep(kind: RecordKind, id: ObjectID, stateId?: ObjectID): void {
  records.get(kind)!.set(id.toString(), stateId || CREATED_STATE);
}

function states<T extends IncidentState | AlertState>(
  makeState: () => T,
): Array<T> {
  return [
    [CREATED_STATE, 1, "isCreatedState"],
    [ACKNOWLEDGED_STATE, 2, "isAcknowledgedState"],
    [RESOLVED_STATE, 3, "isResolvedState"],
  ].map(([id, order, flag]: Array<unknown>) => {
    const state: T = makeState();
    state.id = id as ObjectID;
    state.projectId = PROJECT_ID;
    state.order = order as number;
    (state as unknown as Record<string, boolean>)[flag as string] = true;
    return state;
  });
}

/*
 * A log paging RESPONDER, three minutes old, about the records `names`
 * names - none, for a log that names none.
 */
function pagingLog(data: {
  index: number;
  names?: Partial<Record<RecordKind, ObjectID>>;
  eventType?: UserNotificationEventType;
  userId?: ObjectID;
  run?: Partial<OnCallDutyPolicyExecutionLog>;
}): UserOnCallLog {
  const log: UserOnCallLog = new UserOnCallLog();
  log.id = uuid("81062222", data.index);
  log.projectId = PROJECT_ID;
  log.userId = data.userId || RESPONDER;
  log.status = UserNotificationExecutionStatus.Executing;
  log.createdAt = new Date(Date.now() - 3 * MINUTE);
  log.executedNotificationRules = {};
  log.userNotificationEventType =
    data.eventType || UserNotificationEventType.IncidentCreated;

  for (const { kind, column } of KINDS) {
    const recordId: ObjectID | undefined = data.names?.[kind];

    if (recordId) {
      (log as unknown as Record<string, ObjectID>)[column] = recordId;
    }
  }

  if (data.run) {
    log.onCallDutyPolicyExecutionLog = Object.assign(
      new OnCallDutyPolicyExecutionLog(),
      data.run,
    );
  }

  logs.push(log);

  return log;
}

function rule(index: number, notifyAfterMinutes: number): UserNotificationRule {
  const notificationRule: UserNotificationRule = new UserNotificationRule();
  notificationRule.id = uuid("81063333", index);
  notificationRule.notifyAfterMinutes = notifyAfterMinutes;
  return notificationRule;
}

function idsOf(query: Record<string, unknown>): Array<string> {
  const predicate: ReadFindOperator = query["_id"] as ReadFindOperator;

  return Object.values(predicate.objectLiteralParameters!)[0] as Array<string>;
}

// What each log was ended with, as updateOneById was asked to write it.
function endings(): Array<{
  logId: string;
  status: UserNotificationExecutionStatus;
  statusMessage?: string | undefined;
}> {
  return logService.updateOneById.mock.calls.map((call: Array<unknown>) => {
    const update: {
      id: ObjectID;
      data: {
        status: UserNotificationExecutionStatus;
        statusMessage?: string;
      };
    } = call[0] as {
      id: ObjectID;
      data: {
        status: UserNotificationExecutionStatus;
        statusMessage?: string;
      };
    };

    return {
      logId: update.id.toString(),
      status: update.data.status,
      ...(update.data.statusMessage !== undefined
        ? { statusMessage: update.data.statusMessage }
        : {}),
    };
  });
}

async function tick(): Promise<void> {
  await mockCapturedJobs[JOB_NAME]!();
}

type RecordRead = (args: {
  query: Record<string, unknown>;
}) => Promise<Array<Incident | Alert | IncidentEpisode | AlertEpisode>>;

// A kind's one read of a page's records: those of it that still exist.
function readOfKind(kind: RecordKind): RecordRead {
  return async (args: {
    query: Record<string, unknown>;
  }): Promise<Array<Incident | Alert | IncidentEpisode | AlertEpisode>> => {
    const existing: Map<string, ObjectID> = records.get(kind)!;

    return idsOf(args.query)
      .filter((id: string) => {
        return existing.has(id);
      })
      .map((id: string) => {
        const stateId: ObjectID = existing.get(id)!;
        const isIncidentList: boolean =
          kind === "incident" || kind === "incident episode";
        const record: Record<string, unknown> =
          kind === "incident"
            ? new Incident()
            : kind === "alert"
              ? new Alert()
              : kind === "incident episode"
                ? new IncidentEpisode()
                : new AlertEpisode();

        record["id"] = new ObjectID(id);
        record["projectId"] = PROJECT_ID;

        if (isIncidentList) {
          record["currentIncidentStateId"] = stateId;
          record["incidentSeverityId"] = SEVERITY;
        } else {
          record["currentAlertStateId"] = stateId;
          record["alertSeverityId"] = SEVERITY;
        }

        return record as unknown as
          | Incident
          | Alert
          | IncidentEpisode
          | AlertEpisode;
      });
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  logs = [];
  records = new Map(
    KINDS.map(({ kind }: { kind: RecordKind }) => {
      return [kind, new Map()];
    }),
  );

  // The logs still Executing, in _id order - the worker's own read.
  logService.findBy.mockImplementation(
    async (args: { limit: number }): Promise<Array<UserOnCallLog>> => {
      return logs
        .filter((log: UserOnCallLog) => {
          return log.status === UserNotificationExecutionStatus.Executing;
        })
        .sort((a: UserOnCallLog, b: UserOnCallLog) => {
          return a.id!.toString() < b.id!.toString() ? -1 : 1;
        })
        .slice(0, args.limit);
    },
  );

  // A write lands on the table, as the database's would.
  logService.updateOneById.mockImplementation(
    async (args: {
      id: ObjectID;
      data: { status?: UserNotificationExecutionStatus };
    }): Promise<void> => {
      const log: UserOnCallLog | undefined = logs.find(
        (candidate: UserOnCallLog) => {
          return candidate.id!.toString() === args.id.toString();
        },
      );

      if (log && args.data.status) {
        log.status = args.data.status;
      }
    },
  );

  logService.getNotificationRuleType.mockImplementation(
    (eventType: UserNotificationEventType): NotificationRuleType => {
      return KINDS.find((entry: { eventType: UserNotificationEventType }) => {
        return entry.eventType === eventType;
      })!.ruleType;
    },
  );
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
        pairs
          .filter((pair: { userId: ObjectID }) => {
            return pair.userId.toString() !== FORMER_MEMBER.toString();
          })
          .map((pair: { projectId: ObjectID; userId: ObjectID }) => {
            return `${pair.projectId.toString()}:${pair.userId.toString()}`;
          }),
      );
    },
  );

  // Each kind's read answers with the records of it that still exist.
  for (const { kind, service } of KINDS) {
    service.findBy.mockImplementation(readOfKind(kind));
  }

  (
    IncidentStateService as unknown as { findBy: jest.Mock }
  ).findBy.mockResolvedValue(
    states(() => {
      return new IncidentState();
    }),
  );
  (
    AlertStateService as unknown as { findBy: jest.Mock }
  ).findBy.mockResolvedValue(
    states(() => {
      return new AlertState();
    }),
  );

  // One rule, due now: a log that goes on sends it.
  ruleService.findBy.mockResolvedValue([rule(1, 0)]);
  ruleService.executeNotificationRuleItem.mockResolvedValue(undefined);
});

describe("a person's log whose record was deleted", () => {
  for (const { kind, eventType } of KINDS) {
    test(`REGRESSION: a log whose ${kind} was deleted ends Completed, saying so - and the next minute reads nothing`, async () => {
      const log: UserOnCallLog = pagingLog({
        index: 1,
        names: { [kind]: uuid("81064444", 1) },
        eventType: eventType,
      });

      await tick();

      expect(endings()).toEqual([
        {
          logId: log.id!.toString(),
          status: UserNotificationExecutionStatus.Completed,
          statusMessage: `Execution completed because ${kind} is deleted.`,
        },
      ]);
      expect(log.status).toBe(UserNotificationExecutionStatus.Completed);

      // Nothing is paged about a record that is gone, and nothing failed.
      expect(ruleService.findBy).not.toHaveBeenCalled();
      expect(ruleService.executeNotificationRuleItem).not.toHaveBeenCalled();
      expect(loggerError).not.toHaveBeenCalled();

      // The next minute: the log is not Executing any more, so it is not read.
      await tick();
      await tick();

      expect(logService.updateOneById).toHaveBeenCalledTimes(1);
      expect(loggerError).not.toHaveBeenCalled();
    });
  }

  test("a log that names no record at all ends the same way, saying it names none", async () => {
    const log: UserOnCallLog = pagingLog({ index: 1 });

    await tick();

    expect(endings()).toEqual([
      {
        logId: log.id!.toString(),
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: ON_CALL_PAGE_NAMES_NO_RECORD_MESSAGE,
      },
    ]);

    // No record was asked for: there was none to ask for.
    for (const { service } of KINDS) {
      expect(service.findBy).not.toHaveBeenCalled();
    }

    expect(ruleService.findBy).not.toHaveBeenCalled();
    expect(loggerError).not.toHaveBeenCalled();

    await tick();
    expect(logService.updateOneById).toHaveBeenCalledTimes(1);
  });

  test("its message is the one OnCallPageRecordGone writes", async () => {
    pagingLog({
      index: 1,
      names: { alert: uuid("81064444", 1) },
      eventType: UserNotificationEventType.AlertCreated,
    });

    await tick();

    expect(endings()[0]!.statusMessage).toBe(
      getOnCallPageRecordDeletedMessage("alert"),
    );
  });

  test("only that log ends: the page's other logs, whose records are there, page on", async () => {
    const goneIncident: ObjectID = uuid("81064444", 1);
    const liveIncident: ObjectID = uuid("81064444", 2);
    keep("incident", liveIncident);

    const gone: UserOnCallLog = pagingLog({
      index: 1,
      names: { incident: goneIncident },
    });
    const live: UserOnCallLog = pagingLog({
      index: 2,
      names: { incident: liveIncident },
    });

    await tick();

    // Both records were read in the page's one read of incidents.
    const incidentReads: jest.Mock = (
      IncidentService as unknown as { findBy: jest.Mock }
    ).findBy;
    expect(incidentReads).toHaveBeenCalledTimes(1);
    expect([...idsOf(incidentReads.mock.calls[0]![0].query)].sort()).toEqual(
      [goneIncident.toString(), liveIncident.toString()].sort(),
    );

    expect(endings()).toEqual([
      {
        logId: gone.id!.toString(),
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: "Execution completed because incident is deleted.",
      },
    ]);

    // The live log's rule went out, about its own incident.
    expect(ruleService.executeNotificationRuleItem).toHaveBeenCalledTimes(1);
    const [ruleId, options] = ruleService.executeNotificationRuleItem.mock
      .calls[0] as [
      ObjectID,
      { userNotificationLogId: ObjectID; triggeredByIncidentId?: ObjectID },
    ];
    expect(ruleId.toString()).toBe(rule(1, 0).id!.toString());
    expect(options.userNotificationLogId.toString()).toBe(live.id!.toString());
    expect(options.triggeredByIncidentId?.toString()).toBe(
      liveIncident.toString(),
    );

    expect(live.status).toBe(UserNotificationExecutionStatus.Executing);
    expect(loggerError).not.toHaveBeenCalled();
  });

  test("a log goes on while one of the records it names is left", async () => {
    const goneIncident: ObjectID = uuid("81064444", 1);
    const liveEpisode: ObjectID = uuid("81064444", 2);
    keep("incident episode", liveEpisode);

    const log: UserOnCallLog = pagingLog({
      index: 1,
      names: { incident: goneIncident, "incident episode": liveEpisode },
      eventType: UserNotificationEventType.IncidentEpisodeCreated,
    });

    await tick();

    expect(endings()).toEqual([]);
    expect(ruleService.executeNotificationRuleItem).toHaveBeenCalledTimes(1);
    expect(log.status).toBe(UserNotificationExecutionStatus.Executing);
    expect(loggerError).not.toHaveBeenCalled();
  });

  test("a log whose record is there and acknowledged still ends as acknowledged, not as deleted", async () => {
    const incident: ObjectID = uuid("81064444", 1);
    keep("incident", incident, ACKNOWLEDGED_STATE);

    const log: UserOnCallLog = pagingLog({
      index: 1,
      names: { incident: incident },
    });

    await tick();

    expect(endings()).toEqual([
      {
        logId: log.id!.toString(),
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: "Execution completed because incident is acknowledged.",
      },
    ]);
  });

  test("a page again whose record was deleted ends with the same words, without reading its record on its own", async () => {
    const log: UserOnCallLog = pagingLog({
      index: 1,
      names: { incident: uuid("81064444", 1) },
      run: { pageAgainNumber: 1 },
    });

    await tick();

    /*
     * A page again ends only once its record is resolved or it is answered
     * (OnCallAcknowledgementTimeout.getPageAgainOverReason, which reads the
     * record on its own): a deleted record ends it first, in the words that
     * reading would have given - "incident is deleted".
     */
    expect(endings()).toEqual([
      {
        logId: log.id!.toString(),
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: "Execution completed because incident is deleted.",
      },
    ]);
    expect(loggerError).not.toHaveBeenCalled();
  });

  test("a page a person asked for, whose record was deleted, ends too", async () => {
    const log: UserOnCallLog = pagingLog({
      index: 1,
      names: { alert: uuid("81064444", 1) },
      eventType: UserNotificationEventType.AlertCreated,
      run: { triggeredByUserId: uuid("81066666", 1) },
    });

    await tick();

    expect(endings()).toEqual([
      {
        logId: log.id!.toString(),
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: "Execution completed because alert is deleted.",
      },
    ]);
  });

  test("somebody who left the project is ended as a former member, whatever became of the record", async () => {
    const log: UserOnCallLog = pagingLog({
      index: 1,
      names: { incident: uuid("81064444", 1) },
      userId: FORMER_MEMBER,
    });

    await tick();

    expect(endings()).toEqual([
      {
        logId: log.id!.toString(),
        status: UserNotificationExecutionStatus.Completed,
        statusMessage:
          "Stopped because this user is no longer a member of the project. Their remaining notification rules were not run.",
      },
    ]);
  });

  test("an ending that could not be written is tried again the next minute, and the log ends then", async () => {
    const log: UserOnCallLog = pagingLog({
      index: 1,
      names: { incident: uuid("81064444", 1) },
    });

    logService.updateOneById.mockRejectedValueOnce(
      new Error("connection reset"),
    );

    await tick();

    // The write failed: the log is still Executing, and the failure was logged.
    expect(log.status).toBe(UserNotificationExecutionStatus.Executing);
    expect(loggerError).toHaveBeenCalled();
    // A failed write is no reason to end the log in error.
    expect(
      endings().filter(
        (ending: { status: UserNotificationExecutionStatus }) => {
          return ending.status === UserNotificationExecutionStatus.Error;
        },
      ),
    ).toEqual([]);

    loggerError.mockClear();
    await tick();

    expect(log.status).toBe(UserNotificationExecutionStatus.Completed);
    expect(endings()[1]).toEqual({
      logId: log.id!.toString(),
      status: UserNotificationExecutionStatus.Completed,
      statusMessage: "Execution completed because incident is deleted.",
    });
    expect(loggerError).not.toHaveBeenCalled();
  });

  test("a page whose records cannot be read at all is not ended: it waits for the next minute", async () => {
    const log: UserOnCallLog = pagingLog({
      index: 1,
      names: { incident: uuid("81064444", 1) },
    });

    (
      IncidentService as unknown as { findBy: jest.Mock }
    ).findBy.mockRejectedValueOnce(new Error("database unavailable"));

    await tick();

    // A read that failed says nothing about the record: nothing is ended.
    expect(endings()).toEqual([]);
    expect(log.status).toBe(UserNotificationExecutionStatus.Executing);
    expect(loggerError).toHaveBeenCalled();

    // The next minute reads the page again, and finds the incident gone.
    await tick();

    expect(endings()).toEqual([
      {
        logId: log.id!.toString(),
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: "Execution completed because incident is deleted.",
      },
    ]);
  });

  test("a log run on its own reads its records itself, and ends the same way", async () => {
    const log: UserOnCallLog = pagingLog({
      index: 1,
      names: { "alert episode": uuid("81064444", 1) },
      eventType: UserNotificationEventType.AlertEpisodeCreated,
    });

    await executePendingNotificationLog(log, { isProjectMember: true });

    expect(endings()).toEqual([
      {
        logId: log.id!.toString(),
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: "Execution completed because alert episode is deleted.",
      },
    ]);
    expect(loggerError).not.toHaveBeenCalled();
  });
});
