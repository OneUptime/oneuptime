import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertService from "Common/Server/Services/AlertService";
import AlertStateService from "Common/Server/Services/AlertStateService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import UserNotificationRuleService, {
  ExecuteNotificationRuleOptions,
} from "Common/Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "Common/Server/Services/UserOnCallLogService";
import logger from "Common/Server/Utils/Logger";
import ProjectMembership from "Common/Server/Utils/TeamMember/ProjectMembership";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import {
  getOnCallPageRecordDeletedMessage,
  ON_CALL_PAGE_RECORD_NOT_FOUND_MESSAGE,
} from "Common/Types/OnCallDutyPolicy/OnCallPageRecordGone";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";
import "../../../../FeatureSet/Workers/Jobs/UserOnCallLog/ExecutePendingExecutions";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PERSON'S NOTIFICATION RULE DELETED WHILE THEY ARE BEING PAGED
 * (issue #8168).
 *
 * Every minute the person's-log worker reads the person's On-Call Rules for
 * each log still paging, and runs each one that is due through
 * UserNotificationRuleService.executeNotificationRuleItem, which claims the
 * rule on the log, then reads it by its id. A rule deleted between the
 * worker's read and the send was "not found": a BadDataException, and the
 * worker's catch ends the whole log in Error for one. Every rule of the
 * person's still due was dropped - they removed "SMS after 5 minutes", and
 * "call me after 10 minutes" never rang.
 *
 * Now the deleted rule sends nothing and the others run. And a record
 * deleted between the worker's read of where it stands and a rule's send -
 * found gone by the send itself - ends the log Completed, saying it was
 * deleted (OnCallPageRecordGone), as a log whose record the worker finds
 * gone does, rather than in Error with the send's words.
 *
 * Driven through the tick RunCron registered and the REAL
 * executeNotificationRuleItem and delivery half (deliverNotificationForRule),
 * with the logs, the rules and the records kept in memory the way the
 * database keeps them. A rule that is there is "sent" by a stand-in for the
 * delivery half, which records it; a record found gone is found by the real
 * delivery half's own read.
 */

/*
 * RunCron schedules nothing here: the job the worker registers as it is
 * imported is read off its calls below, and run by hand. (jest hoists
 * jest.mock above the imports.)
 */
jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

/*
 * The part of typeorm's FindOperator the record reads are answered from.
 * typeorm is Common's dependency, not App's, so its type cannot be imported
 * here (TestImportsResolveFromApp.test.ts).
 */
interface ReadFindOperator {
  objectLiteralParameters?: Record<string, unknown> | undefined;
}

type RecordKind = "incident" | "alert" | "incident episode" | "alert episode";

type AnyFunction = (...args: Array<any>) => any;

const JOB_NAME: string = "UserOnCallLog:ExecutePendingExecutions";

// The tick itself: what the worker registered with RunCron as it was imported.
const runTick: () => Promise<void> = (
  RunCron as unknown as jest.Mock
).mock.calls.find((call: Array<unknown>): boolean => {
  return call[0] === JOB_NAME;
})![2] as () => Promise<void>;

const MINUTE: number = 60 * 1000;
const START: Date = new Date("2026-11-15T03:00:00.000Z");

const PROJECT_ID: ObjectID = new ObjectID(
  "81680000-0000-4000-8000-000000000001",
);
const RESPONDER: ObjectID = new ObjectID(
  "81680000-0000-4000-8000-000000000002",
);
const SEVERITY: ObjectID = new ObjectID("81680000-0000-4000-8000-000000000003");

function uuid(prefix: string, index: number): ObjectID {
  return new ObjectID(
    `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
}

const CREATED_STATE: ObjectID = uuid("81681111", 1);

// Each kind of record: the log column that names it, its event type and its service.
const KINDS: Array<{
  kind: RecordKind;
  column:
    | "triggeredByIncidentId"
    | "triggeredByAlertId"
    | "triggeredByIncidentEpisodeId"
    | "triggeredByAlertEpisodeId";
  eventType: UserNotificationEventType;
  service: unknown;
}> = [
  {
    kind: "incident",
    column: "triggeredByIncidentId",
    eventType: UserNotificationEventType.IncidentCreated,
    service: IncidentService,
  },
  {
    kind: "alert",
    column: "triggeredByAlertId",
    eventType: UserNotificationEventType.AlertCreated,
    service: AlertService,
  },
  {
    kind: "incident episode",
    column: "triggeredByIncidentEpisodeId",
    eventType: UserNotificationEventType.IncidentEpisodeCreated,
    service: IncidentEpisodeService,
  },
  {
    kind: "alert episode",
    column: "triggeredByAlertEpisodeId",
    eventType: UserNotificationEventType.AlertEpisodeCreated,
    service: AlertEpisodeService,
  },
];

// The world, as the database holds it.
let clock: Date;
let logs: Array<UserOnCallLog>;
// The person's rules that still exist, in the order they were made.
let rules: Array<UserNotificationRule>;
/*
 * What the worker's read of the person's rules hands back, when it is not
 * the rules that exist: a read made just before a rule was deleted.
 */
let staleRulesRead: Array<UserNotificationRule> | null;
// The records that still exist, by kind and id.
let records: Map<RecordKind, Set<string>>;
// The records the page read as there, and the delivery half then finds gone.
let goneBySend: Set<string>;
// Every delivery the stand-in for the delivery half made: which rule, about what.
let sent: Array<{ ruleId: string; logId: string }>;
// Every status written to a log, in order.
let statusWrites: Array<{
  logId: string;
  status: UserNotificationExecutionStatus;
  statusMessage?: string | undefined;
}>;
// A status write the database refuses, once.
let failNextStatusWrite: boolean;
let loggedErrors: Array<string>;
// How many times a send read its rule by its id.
let ruleReads: number;

function rule(index: number, notifyAfterMinutes: number): UserNotificationRule {
  const notificationRule: UserNotificationRule = new UserNotificationRule();
  notificationRule.id = uuid("81682222", index);
  notificationRule.userId = RESPONDER;
  notificationRule.projectId = PROJECT_ID;
  notificationRule.notifyAfterMinutes = notifyAfterMinutes;
  return notificationRule;
}

function deleteRule(deleted: UserNotificationRule): void {
  rules = rules.filter((candidate: UserNotificationRule) => {
    return candidate.id!.toString() !== deleted.id!.toString();
  });
}

// A log paging RESPONDER about a record of `kind`, started `minutesAgo` ago.
function pagingLog(data: {
  index: number;
  kind?: RecordKind;
  minutesAgo?: number;
  eventType?: UserNotificationEventType;
}): UserOnCallLog {
  const kind: (typeof KINDS)[number] = KINDS.find(
    (entry: (typeof KINDS)[number]) => {
      return entry.kind === (data.kind || "incident");
    },
  )!;
  const recordId: ObjectID = uuid("81683333", data.index);

  const log: UserOnCallLog = new UserOnCallLog();
  log.id = uuid("81684444", data.index);
  log.projectId = PROJECT_ID;
  log.userId = RESPONDER;
  log.status = UserNotificationExecutionStatus.Executing;
  log.createdAt = new Date(clock.getTime() - (data.minutesAgo ?? 1) * MINUTE);
  log.executedNotificationRules = {};
  log.userNotificationEventType = data.eventType || kind.eventType;
  (log as unknown as Record<string, ObjectID>)[kind.column] = recordId;

  records.get(kind.kind)!.add(recordId.toString());
  logs.push(log);

  return log;
}

function logById(id: unknown): UserOnCallLog | undefined {
  return logs.find((candidate: UserOnCallLog) => {
    return candidate.id!.toString() === String(id);
  });
}

function idsOf(query: Record<string, unknown>): Array<string> {
  const predicate: ReadFindOperator = query["_id"] as ReadFindOperator;

  return Object.values(predicate.objectLiteralParameters!)[0] as Array<string>;
}

function spy(
  target: unknown,
  method: string,
  implementation: AnyFunction,
): void {
  jest
    .spyOn(target as never, method as never)
    .mockImplementation(implementation as never);
}

// A page's one read of each kind of record: those of it that still exist.
function readOfKind(kind: RecordKind): AnyFunction {
  return async (args: {
    query: Record<string, unknown>;
  }): Promise<Array<unknown>> => {
    const existing: Set<string> = records.get(kind)!;

    return idsOf(args.query)
      .filter((id: string) => {
        return existing.has(id);
      })
      .map((id: string) => {
        const isIncidentList: boolean =
          kind === "incident" || kind === "incident episode";
        const record: Record<string, unknown> = (kind === "incident"
          ? new Incident()
          : kind === "alert"
            ? new Alert()
            : kind === "incident episode"
              ? new IncidentEpisode()
              : new AlertEpisode()) as unknown as Record<string, unknown>;

        record["id"] = new ObjectID(id);
        record["projectId"] = PROJECT_ID;

        if (isIncidentList) {
          record["currentIncidentStateId"] = CREATED_STATE;
          record["incidentSeverityId"] = SEVERITY;
        } else {
          record["currentAlertStateId"] = CREATED_STATE;
          record["alertSeverityId"] = SEVERITY;
        }

        return record;
      });
  };
}

// The record a send reads on its own: gone, if it was deleted after the page read it.
function readOneOfKind(kind: RecordKind): AnyFunction {
  return async (args: { id: ObjectID }): Promise<unknown> => {
    const id: string = args.id.toString();

    if (goneBySend.has(id) || !records.get(kind)!.has(id)) {
      return null;
    }

    const record: Record<string, unknown> = {
      id: args.id,
      projectId: PROJECT_ID,
      title: "Checkout is down",
    };

    return record;
  };
}

function states<T extends IncidentState | AlertState>(
  makeState: () => T,
): Array<T> {
  const state: T = makeState();
  state.id = CREATED_STATE;
  state.projectId = PROJECT_ID;
  state.order = 1;
  (state as unknown as Record<string, boolean>)["isCreatedState"] = true;
  return [state];
}

/*
 * The delivery half, standing in for the senders: a rule that reaches it is
 * sent. Its record reads are the real ones' answers: a record the page read
 * as there but that is gone now is found gone here, by the real delivery
 * half (callThrough).
 */
const realDeliver: AnyFunction = (
  UserNotificationRuleService as unknown as Record<string, AnyFunction>
)["deliverNotificationForRule"]!;

async function tick(minutes: number = 0): Promise<void> {
  clock = new Date(clock.getTime() + minutes * MINUTE);
  await runTick();
}

beforeEach(() => {
  clock = new Date(START);
  logs = [];
  rules = [];
  staleRulesRead = null;
  records = new Map(
    KINDS.map(({ kind }: { kind: RecordKind }) => {
      return [kind, new Set<string>()];
    }),
  );
  goneBySend = new Set<string>();
  sent = [];
  statusWrites = [];
  failNextStatusWrite = false;
  loggedErrors = [];
  ruleReads = 0;

  spy(OneUptimeDate, "getCurrentDate", () => {
    return new Date(clock);
  });

  for (const level of ["debug", "info", "warn"] as const) {
    spy(logger, level, () => {
      return undefined;
    });
  }

  spy(logger, "error", (message: unknown) => {
    loggedErrors.push(
      message instanceof Error ? message.message : String(message),
    );
  });

  // The logs still Executing, in _id order: the worker's own read.
  spy(UserOnCallLogService, "findBy", async (args: { limit: number }) => {
    return logs
      .filter((log: UserOnCallLog) => {
        return log.status === UserNotificationExecutionStatus.Executing;
      })
      .sort((a: UserOnCallLog, b: UserOnCallLog) => {
        return a.id!.toString() < b.id!.toString() ? -1 : 1;
      })
      .slice(0, args.limit)
      .map((log: UserOnCallLog) => {
        const copy: UserOnCallLog = Object.assign(new UserOnCallLog(), log);
        copy.executedNotificationRules = {
          ...(log.executedNotificationRules || {}),
        };
        return copy;
      });
  });

  // A write lands on the table, as the database's would - or is refused.
  spy(
    UserOnCallLogService,
    "updateOneById",
    async (args: {
      id: ObjectID;
      data: {
        status?: UserNotificationExecutionStatus;
        statusMessage?: string;
      };
    }) => {
      if (args.data.status && failNextStatusWrite) {
        failNextStatusWrite = false;
        throw new Error("Connection terminated unexpectedly");
      }

      const log: UserOnCallLog | undefined = logById(args.id);

      if (log && args.data.status) {
        log.status = args.data.status;
        log.statusMessage = args.data.statusMessage || "";
        statusWrites.push({
          logId: args.id.toString(),
          status: args.data.status,
          ...(args.data.statusMessage !== undefined
            ? { statusMessage: args.data.statusMessage }
            : {}),
        });
      }
    },
  );

  // One atomic claim of a rule's delivery on a log, as the real UPDATE is.
  spy(
    UserOnCallLogService,
    "claimNotificationRuleExecution",
    async (data: {
      userOnCallLogId: ObjectID;
      userNotificationRuleId: ObjectID;
    }) => {
      const log: UserOnCallLog | undefined = logById(data.userOnCallLogId);
      const key: string = data.userNotificationRuleId.toString();

      if (!log || (log.executedNotificationRules || {})[key]) {
        return false;
      }

      log.executedNotificationRules = {
        ...(log.executedNotificationRules || {}),
        [key]: { claimedAt: new Date(clock).toISOString() },
      };

      return true;
    },
  );

  // Everybody here is a member of the project.
  spy(
    ProjectMembership,
    "getMemberKeys",
    async (pairs: Array<{ projectId: ObjectID; userId: ObjectID }>) => {
      return new Set(
        pairs.map((pair: { projectId: ObjectID; userId: ObjectID }) => {
          return ProjectMembership.getKey(pair.projectId, pair.userId);
        }),
      );
    },
  );

  // The worker's read of the person's rules, once per page.
  spy(UserNotificationRuleService, "findBy", async () => {
    return (staleRulesRead || rules).map((row: UserNotificationRule) => {
      return Object.assign(new UserNotificationRule(), row);
    });
  });

  // The send's own read of its rule, by id: null once it was deleted.
  spy(
    UserNotificationRuleService,
    "findOneById",
    async (args: { id: ObjectID }) => {
      ruleReads++;

      const found: UserNotificationRule | undefined = rules.find(
        (candidate: UserNotificationRule) => {
          return candidate.id!.toString() === args.id.toString();
        },
      );

      return found ? Object.assign(new UserNotificationRule(), found) : null;
    },
  );

  spy(
    UserNotificationRuleService,
    "deliverNotificationForRule",
    async (
      notificationRule: UserNotificationRule,
      options: ExecuteNotificationRuleOptions,
    ) => {
      // The record the page names for its event type, as the real one reads it.
      const recordId: string | undefined = (
        {
          [UserNotificationEventType.IncidentCreated]:
            options.triggeredByIncidentId,
          [UserNotificationEventType.AlertCreated]: options.triggeredByAlertId,
          [UserNotificationEventType.IncidentEpisodeCreated]:
            options.triggeredByIncidentEpisodeId,
          [UserNotificationEventType.AlertEpisodeCreated]:
            options.triggeredByAlertEpisodeId,
        } as Record<string, ObjectID | undefined>
      )[options.userNotificationEventType]?.toString();

      if (!recordId || goneBySend.has(recordId)) {
        // The real delivery half reads the record, and finds it gone.
        return await realDeliver.call(
          UserNotificationRuleService,
          notificationRule,
          options,
        );
      }

      sent.push({
        ruleId: notificationRule.id!.toString(),
        logId: options.userNotificationLogId.toString(),
      });

      return true;
    },
  );

  spy(
    ProjectCallSMSConfigService,
    "getProjectDefaultTwilioConfig",
    async () => {
      return undefined;
    },
  );

  // Each kind's read of a page's records, and its read of one record.
  for (const { kind, service } of KINDS) {
    spy(service, "findBy", readOfKind(kind));
    spy(service, "findOneById", readOneOfKind(kind));
  }

  spy(IncidentStateService, "findBy", async () => {
    return states(() => {
      return new IncidentState();
    });
  });
  spy(AlertStateService, "findBy", async () => {
    return states(() => {
      return new AlertState();
    });
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function sentRules(): Array<string> {
  return sent.map((delivery: { ruleId: string }) => {
    return delivery.ruleId;
  });
}

describe("a notification rule deleted while its owner is being paged", () => {
  test("REGRESSION: it is skipped, and the rule due after it still rings", async () => {
    const sms: UserNotificationRule = rule(1, 0);
    const call: UserNotificationRule = rule(2, 10);
    rules = [sms, call];
    const log: UserOnCallLog = pagingLog({ index: 1 });

    // They delete "SMS at once" just after the worker read their rules.
    staleRulesRead = [sms, call];
    deleteRule(sms);

    await tick();

    // Nothing for the deleted rule, and the page goes on.
    expect(sent).toEqual([]);
    expect(statusWrites).toEqual([]);
    expect(logById(log.id)!.status).toBe(
      UserNotificationExecutionStatus.Executing,
    );
    // Its claim is taken: nothing is sent for it again.
    expect(
      Object.keys(logById(log.id)!.executedNotificationRules || {}),
    ).toEqual([sms.id!.toString()]);

    // The next reads no longer list it; ten minutes in, the call rings.
    staleRulesRead = null;
    await tick(10);

    expect(sentRules()).toEqual([call.id!.toString()]);

    // Everything the person still had is sent: the page is complete.
    await tick(1);

    expect(statusWrites).toEqual([
      {
        logId: log.id!.toString(),
        status: UserNotificationExecutionStatus.Completed,
      },
    ]);
    expect(sentRules()).toEqual([call.id!.toString()]);
    expect(loggedErrors).toEqual([]);
  });

  test("the person's other rules due in the same minute are sent in that minute", async () => {
    const email: UserNotificationRule = rule(1, 0);
    const sms: UserNotificationRule = rule(2, 0);
    const push: UserNotificationRule = rule(3, 0);
    rules = [email, sms, push];
    pagingLog({ index: 1 });

    staleRulesRead = [email, sms, push];
    deleteRule(sms);

    await tick();

    expect(sentRules()).toEqual([email.id!.toString(), push.id!.toString()]);
    expect(statusWrites).toEqual([]);
  });

  test("a read that still lists the deleted rule sends nothing for it again", async () => {
    const sms: UserNotificationRule = rule(1, 0);
    rules = [sms];
    const log: UserOnCallLog = pagingLog({ index: 1 });

    staleRulesRead = [sms];
    deleteRule(sms);

    await tick();
    await tick(1);

    /*
     * Read once, by the send that claimed it. The next tick finds its claim
     * taken - the rule counts as done - so it is not sent, nor read, again,
     * and with nothing else left the page is complete.
     */
    expect(ruleReads).toBe(1);
    expect(sent).toEqual([]);
    expect(statusWrites).toEqual([
      {
        logId: log.id!.toString(),
        status: UserNotificationExecutionStatus.Completed,
      },
    ]);
  });

  test("a page whose only rule still due was deleted completes", async () => {
    const sms: UserNotificationRule = rule(1, 0);
    rules = [sms];
    const log: UserOnCallLog = pagingLog({ index: 1 });

    staleRulesRead = [sms];
    deleteRule(sms);

    await tick();
    staleRulesRead = null;
    await tick(1);

    expect(statusWrites).toEqual([
      {
        logId: log.id!.toString(),
        status: UserNotificationExecutionStatus.Completed,
      },
    ]);
    expect(sent).toEqual([]);
  });

  test("a rule deleted while two pages of its owner are going is skipped on both, and both go on", async () => {
    const sms: UserNotificationRule = rule(1, 0);
    const call: UserNotificationRule = rule(2, 0);
    rules = [sms, call];
    const incidentPage: UserOnCallLog = pagingLog({ index: 1 });
    const alertPage: UserOnCallLog = pagingLog({ index: 2, kind: "alert" });

    staleRulesRead = [sms, call];
    deleteRule(sms);

    await tick();

    // Each page sends the call once, and nothing for the deleted rule.
    expect(
      sent.map((delivery: { ruleId: string; logId: string }) => {
        return `${delivery.logId}:${delivery.ruleId}`;
      }),
    ).toEqual([
      `${incidentPage.id!.toString()}:${call.id!.toString()}`,
      `${alertPage.id!.toString()}:${call.id!.toString()}`,
    ]);
    expect(statusWrites).toEqual([]);
  });

  test.each(
    KINDS.map((entry: (typeof KINDS)[number]): RecordKind => {
      return entry.kind;
    }),
  )(
    "a page about an %s skips a deleted rule the same way",
    async (kind: RecordKind) => {
      const sms: UserNotificationRule = rule(1, 0);
      const call: UserNotificationRule = rule(2, 0);
      rules = [sms, call];
      const log: UserOnCallLog = pagingLog({ index: 1, kind: kind });

      staleRulesRead = [sms, call];
      deleteRule(sms);

      await tick();

      expect(sentRules()).toEqual([call.id!.toString()]);
      expect(logById(log.id)!.status).toBe(
        UserNotificationExecutionStatus.Executing,
      );
    },
  );
});

describe("a record deleted between the page's read and a rule's send", () => {
  test.each(
    KINDS.map((entry: (typeof KINDS)[number]): RecordKind => {
      return entry.kind;
    }),
  )(
    "REGRESSION: the page about the %s ends Completed, saying it was deleted, not in Error",
    async (kind: RecordKind) => {
      const sms: UserNotificationRule = rule(1, 0);
      const call: UserNotificationRule = rule(2, 0);
      rules = [sms, call];
      const log: UserOnCallLog = pagingLog({ index: 1, kind: kind });

      // The page read it as there; the send finds it gone.
      goneBySend.add(
        String(
          (log as unknown as Record<string, ObjectID>)[
            KINDS.find((entry: (typeof KINDS)[number]) => {
              return entry.kind === kind;
            })!.column
          ],
        ),
      );

      await tick();

      expect(statusWrites).toEqual([
        {
          logId: log.id!.toString(),
          status: UserNotificationExecutionStatus.Completed,
          statusMessage: getOnCallPageRecordDeletedMessage(kind),
        },
      ]);
      expect(statusWrites[0]!.statusMessage).toBe(
        `Execution completed because ${kind} is deleted.`,
      );
      // Nothing more is tried for a record that is gone.
      expect(sent).toEqual([]);
      expect(loggedErrors).toEqual([]);

      // And the next minute reads nothing for it.
      await tick(1);

      expect(statusWrites).toHaveLength(1);
    },
  );

  test("an ending whose write fails is written the next minute, in the same words", async () => {
    rules = [rule(1, 0)];
    const log: UserOnCallLog = pagingLog({ index: 1 });
    const recordId: string = log.triggeredByIncidentId!.toString();

    goneBySend.add(recordId);
    failNextStatusWrite = true;

    await tick();

    expect(statusWrites).toEqual([]);
    expect(logById(log.id)!.status).toBe(
      UserNotificationExecutionStatus.Executing,
    );

    // By the next minute the page's own read finds it gone too.
    records.get("incident")!.delete(recordId);
    await tick(1);

    expect(statusWrites).toEqual([
      {
        logId: log.id!.toString(),
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: "Execution completed because incident is deleted.",
      },
    ]);
  });

  test("a page whose event type names no record of its kind is still bad data, and ends in Error", async () => {
    rules = [rule(1, 0)];
    // An alert's page whose event type says incident: nothing to send it about.
    const log: UserOnCallLog = pagingLog({
      index: 1,
      kind: "alert",
      eventType: UserNotificationEventType.IncidentCreated,
    });

    await tick();

    expect(statusWrites).toEqual([
      {
        logId: log.id!.toString(),
        status: UserNotificationExecutionStatus.Error,
        statusMessage: ON_CALL_PAGE_RECORD_NOT_FOUND_MESSAGE,
      },
    ]);
  });
});
