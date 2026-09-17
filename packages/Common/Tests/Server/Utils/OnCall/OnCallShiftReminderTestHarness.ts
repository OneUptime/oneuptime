import { jest } from "@jest/globals";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import UserNotificationSettingService from "../../../../Server/Services/UserNotificationSettingService";
import UserOnCallShiftReminderLogService from "../../../../Server/Services/UserOnCallShiftReminderLogService";
import UserOnCallShiftReminderService from "../../../../Server/Services/UserOnCallShiftReminderService";
import UserService from "../../../../Server/Services/UserService";
import logger from "../../../../Server/Utils/Logger";
import Telemetry from "../../../../Server/Utils/Telemetry";
import OnCallShiftMaterializer, {
  MaterializeResult,
  MaterializedScheduleInfo,
  MaterializedUserInfo,
} from "../../../../Server/Utils/OnCall/OnCallShiftMaterializer";
import UserOnCallShiftReminderLog, {
  UserOnCallShiftReminderLogKind,
} from "../../../../Models/DatabaseModels/UserOnCallShiftReminderLog";
import URL from "../../../../Types/API/URL";
import OneUptimeDate from "../../../../Types/Date";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import {
  MaterializedShift,
  MaterializedShiftPolicy,
} from "../../../../Types/OnCallDutyPolicy/MaterializedShift";
import { matchesQuery } from "./OnCallResolverTestHarness";

/*
 * In-memory stand-ins for everything OnCallShiftReminderRunner touches, so
 * the REAL runner code runs end to end (watermark, lateness cap, claim ->
 * send -> stamp, change pass) against rows the tests can inspect:
 *
 *   - UserOnCallShiftReminder rows (the configured lead times),
 *   - the UserOnCallShiftReminderLog ledger, with the UNIQUE index enforced
 *     the way Postgres would (a duplicate insert throws a unique violation),
 *   - the materializer (answered from fixture MaterializedShifts),
 *   - UserNotificationSetting rows (present / absent per event type) and
 *     sendUserNotification (recorded, optionally failing),
 *   - GlobalCache (the watermark), Semaphore (the sweep lock), the dashboard
 *     URL and the telemetry counter.
 *
 * Every collaborator is a jest.spyOn on the module singleton; restore with
 * jest.restoreAllMocks().
 */

export interface FakeReminder {
  projectId: ObjectID;
  userId: ObjectID;
  minutesBeforeShift: number;
}

export interface FakeLedgerRow {
  _id: ObjectID;
  id: ObjectID;
  projectId: ObjectID;
  userId: ObjectID;
  onCallDutyPolicyScheduleId: ObjectID;
  shiftStartsAt: Date;
  minutesBeforeShift: number;
  kind: UserOnCallShiftReminderLogKind;
  claimedAt: Date;
  sentAt: Date | null;
}

export interface SentNotification {
  userId: string;
  projectId: string;
  eventType: NotificationSettingEventType;
  templateType: string;
  subject: string;
  vars: Record<string, string>;
  smsText: string;
  pushTitle: string;
  pushBody: string;
  // undefined when the runner sent no WhatsApp payload at all.
  whatsAppTemplateKey: string | undefined;
  whatsAppBody: string | undefined;
  onCallScheduleId: string | undefined;
  onCallPolicyId: string | undefined;
  onCallPolicyEscalationRuleId: string | undefined;
}

export interface MaterializeCall {
  scheduleIds: Array<string>;
  windowStart: Date;
  windowEnd: Date;
  now: Date | undefined;
}

export interface MetricRecord {
  value: number;
  attributes: Record<string, unknown>;
}

export interface ReminderHarness {
  reminders: Array<FakeReminder>;
  ledger: Array<FakeLedgerRow>;
  shifts: Array<MaterializedShift>;
  schedules: Map<string, MaterializedScheduleInfo>;
  users: Array<MaterializedUserInfo>;
  // userId -> candidate schedule ids; absent = derived from `shifts`.
  candidateSchedules: Map<string, Array<string>>;
  // "userId|projectId|eventType" for every settings row that exists.
  settings: Set<string>;
  cache: Map<string, string>;
  sent: Array<SentNotification>;
  materializeCalls: Array<MaterializeCall>;
  candidateCalls: Array<{ userIds: Array<string>; projectIds: Array<string> }>;
  /*
   * Users UserService can resolve that materialization does NOT return —
   * somebody just removed from the layer, or from the project. The change
   * pass looks them up so their notice is formatted in their own timezone.
   */
  directory: Array<MaterializedUserInfo>;
  // One entry per UserService.findBy the runner made, with the ids it asked for.
  userLookupCalls: Array<Array<string>>;
  metrics: Array<MetricRecord>;
  // Return an Error to make the NEXT send throw; null to deliver.
  failSend: (call: SentNotification) => Error | null;
  // Throw from every reminder-table read.
  remindersReadError: Error | null;
  // Throw from materializeForSchedules for these schedule ids.
  materializeErrorForSchedules: Set<string>;
  // Whether Semaphore.lock succeeds.
  lockAvailable: boolean;
  lockCalls: Array<Record<string, unknown>>;
  releasedMutexes: Array<SemaphoreMutex>;
  cacheReadError: Error | null;
  cacheWriteError: Error | null;
  // Schedules known to OnCallDutyPolicyScheduleService (id -> projectId).
  scheduleProjects: Map<string, ObjectID>;
  warnings: Array<string>;
  errors: Array<unknown>;
  nextLedgerId: number;
  // Runs before the fake ledger insert; lets a test inject a concurrent row.
  beforeLedgerInsert: (() => void) | null;
  reclaimUpdateOverride: number | null;
}

export const HARNESS_DASHBOARD_URL: string =
  "https://oneuptime.example.com/dashboard";

/*
 * The runner caches its telemetry counter in a static field the first time
 * it records anything, so the fake counter must resolve the CURRENT harness
 * on every add rather than closing over the one that happened to be
 * installed when the counter was created.
 */
let activeHarness: ReminderHarness | null = null;

export function settingsKey(data: {
  userId: ObjectID | string;
  projectId: ObjectID | string;
  eventType: NotificationSettingEventType;
}): string {
  return `${data.userId.toString()}|${data.projectId.toString()}|${data.eventType}`;
}

export function scheduleInfo(data: {
  scheduleId: string;
  scheduleName?: string | undefined;
  projectId: string;
  scheduleTimezone?: string | undefined;
  truncated?: boolean | undefined;
  attachedPolicies?: Array<MaterializedShiftPolicy> | undefined;
}): MaterializedScheduleInfo {
  const info: MaterializedScheduleInfo = {
    scheduleId: data.scheduleId,
    scheduleName: data.scheduleName ?? "Payments",
    projectId: data.projectId,
    shiftConfigVersion: 1,
    lastModifiedAt: OneUptimeDate.fromString("2026-08-01T10:00:00Z"),
    truncated: data.truncated ?? false,
    attachedPolicies: data.attachedPolicies ?? [],
    layerProps: [],
    scheduleUserIds: [],
  };

  if (data.scheduleTimezone !== undefined) {
    info.scheduleTimezone = data.scheduleTimezone;
  }

  return info;
}

export function emptyHarness(): ReminderHarness {
  return {
    reminders: [],
    ledger: [],
    shifts: [],
    schedules: new Map<string, MaterializedScheduleInfo>(),
    users: [],
    candidateSchedules: new Map<string, Array<string>>(),
    settings: new Set<string>(),
    cache: new Map<string, string>(),
    sent: [],
    materializeCalls: [],
    candidateCalls: [],
    directory: [],
    userLookupCalls: [],
    metrics: [],
    failSend: (): Error | null => {
      return null;
    },
    remindersReadError: null,
    materializeErrorForSchedules: new Set<string>(),
    lockAvailable: true,
    lockCalls: [],
    releasedMutexes: [],
    cacheReadError: null,
    cacheWriteError: null,
    scheduleProjects: new Map<string, ObjectID>(),
    warnings: [],
    errors: [],
    nextLedgerId: 1,
    beforeLedgerInsert: null,
    reclaimUpdateOverride: null,
  };
}

function toKey(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function truncateToMinute(date: Date): Date {
  const copy: Date = new Date(date.getTime());
  copy.setUTCSeconds(0, 0);
  return copy;
}

function uniqueKeyOf(row: {
  userId: ObjectID | string;
  onCallDutyPolicyScheduleId: ObjectID | string;
  shiftStartsAt: Date;
  minutesBeforeShift: number;
  kind: string;
}): string {
  return [
    toKey(row.userId),
    toKey(row.onCallDutyPolicyScheduleId),
    truncateToMinute(row.shiftStartsAt).getTime(),
    row.minutesBeforeShift,
    row.kind,
  ].join("|");
}

export class UniqueViolationError extends Error {
  public postgresErrorCode: string = "23505";

  public constructor() {
    super("duplicate key value violates unique constraint");
  }
}

/** Inserts a ledger row directly (a pre-existing claim, another replica's work). */
export function seedLedgerRow(
  harness: ReminderHarness,
  data: {
    projectId: ObjectID;
    userId: ObjectID;
    scheduleId: ObjectID | string;
    shiftStartsAt: Date;
    minutesBeforeShift: number;
    kind: UserOnCallShiftReminderLogKind;
    claimedAt: Date;
    sentAt: Date | null;
  },
): FakeLedgerRow {
  const id: ObjectID = new ObjectID(`ledger-${harness.nextLedgerId++}`);
  const row: FakeLedgerRow = {
    _id: id,
    id,
    projectId: data.projectId,
    userId: data.userId,
    onCallDutyPolicyScheduleId: new ObjectID(data.scheduleId.toString()),
    shiftStartsAt: truncateToMinute(data.shiftStartsAt),
    minutesBeforeShift: data.minutesBeforeShift,
    kind: data.kind,
    claimedAt: data.claimedAt,
    sentAt: data.sentAt,
  };

  const key: string = uniqueKeyOf(row);

  for (const existing of harness.ledger) {
    if (uniqueKeyOf(existing) === key) {
      throw new UniqueViolationError();
    }
  }

  harness.ledger.push(row);

  return row;
}

function fakeCreate(
  harness: ReminderHarness,
): (args: {
  data: UserOnCallShiftReminderLog;
}) => Promise<UserOnCallShiftReminderLog> {
  return (args: {
    data: UserOnCallShiftReminderLog;
  }): Promise<UserOnCallShiftReminderLog> => {
    const data: UserOnCallShiftReminderLog = args.data;

    if (
      !data.projectId ||
      !data.userId ||
      !data.onCallDutyPolicyScheduleId ||
      !data.shiftStartsAt ||
      !data.kind
    ) {
      return Promise.reject(new Error("fake ledger: missing required column"));
    }

    if (harness.beforeLedgerInsert) {
      harness.beforeLedgerInsert();
    }

    try {
      const row: FakeLedgerRow = seedLedgerRow(harness, {
        projectId: data.projectId,
        userId: data.userId,
        scheduleId: data.onCallDutyPolicyScheduleId,
        shiftStartsAt: data.shiftStartsAt,
        minutesBeforeShift: data.minutesBeforeShift ?? 0,
        kind: data.kind,
        claimedAt: data.claimedAt || new Date(),
        sentAt: null,
      });

      const created: UserOnCallShiftReminderLog =
        new UserOnCallShiftReminderLog();
      created.id = row.id;

      return Promise.resolve(created);
    } catch (err) {
      return Promise.reject(err);
    }
  };
}

function fakeLedgerFindBy(
  harness: ReminderHarness,
): (args: {
  query?: Record<string, unknown>;
}) => Promise<Array<UserOnCallShiftReminderLog>> {
  return (args: {
    query?: Record<string, unknown>;
  }): Promise<Array<UserOnCallShiftReminderLog>> => {
    const rows: Array<FakeLedgerRow> = harness.ledger.filter(
      (row: FakeLedgerRow) => {
        return matchesQuery(
          args.query,
          row as unknown as Record<string, unknown>,
        );
      },
    );

    // Copies: the runner must not be able to mutate the "database" by reference.
    return Promise.resolve(
      rows.map((row: FakeLedgerRow) => {
        return { ...row } as unknown as UserOnCallShiftReminderLog;
      }),
    );
  };
}

function fakeUpdateOneBy(
  harness: ReminderHarness,
): (args: {
  query: Record<string, unknown>;
  data: Record<string, unknown>;
}) => Promise<number> {
  return (args: {
    query: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<number> => {
    if (harness.reclaimUpdateOverride !== null) {
      return Promise.resolve(harness.reclaimUpdateOverride);
    }

    let count: number = 0;

    for (const row of harness.ledger) {
      if (matchesQuery(args.query, row as unknown as Record<string, unknown>)) {
        Object.assign(row, args.data);
        count++;
      }
    }

    return Promise.resolve(count);
  };
}

function fakeUpdateOneById(
  harness: ReminderHarness,
): (args: { id: ObjectID; data: Record<string, unknown> }) => Promise<void> {
  return (args: {
    id: ObjectID;
    data: Record<string, unknown>;
  }): Promise<void> => {
    for (const row of harness.ledger) {
      if (toKey(row._id) === toKey(args.id)) {
        Object.assign(row, args.data);
      }
    }

    return Promise.resolve();
  };
}

function fakeDeleteOneBy(
  harness: ReminderHarness,
): (args: { query: Record<string, unknown> }) => Promise<void> {
  return (args: { query: Record<string, unknown> }): Promise<void> => {
    harness.ledger = harness.ledger.filter((row: FakeLedgerRow) => {
      return !matchesQuery(
        args.query,
        row as unknown as Record<string, unknown>,
      );
    });

    return Promise.resolve();
  };
}

function fakeDeleteBy(
  harness: ReminderHarness,
): (args: {
  query: Record<string, unknown>;
  limit?: number;
}) => Promise<number> {
  return (args: {
    query: Record<string, unknown>;
    limit?: number;
  }): Promise<number> => {
    const limit: number = args.limit ?? Number.MAX_SAFE_INTEGER;
    let deleted: number = 0;

    harness.ledger = harness.ledger.filter((row: FakeLedgerRow) => {
      if (
        deleted < limit &&
        matchesQuery(args.query, row as unknown as Record<string, unknown>)
      ) {
        deleted++;
        return false;
      }

      return true;
    });

    return Promise.resolve(deleted);
  };
}

function fakeMaterialize(
  harness: ReminderHarness,
): (args: {
  scheduleIds: Array<ObjectID>;
  windowStart: Date;
  windowEnd: Date;
  now?: Date | undefined;
}) => Promise<MaterializeResult> {
  return (args: {
    scheduleIds: Array<ObjectID>;
    windowStart: Date;
    windowEnd: Date;
    now?: Date | undefined;
  }): Promise<MaterializeResult> => {
    const ids: Array<string> = args.scheduleIds.map((id: ObjectID) => {
      return id.toString();
    });

    harness.materializeCalls.push({
      scheduleIds: ids,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      now: args.now,
    });

    for (const id of ids) {
      if (harness.materializeErrorForSchedules.has(id)) {
        return Promise.reject(new Error(`materialize failed for ${id}`));
      }
    }

    const shifts: Array<MaterializedShift> = harness.shifts.filter(
      (shift: MaterializedShift) => {
        return (
          ids.includes(shift.scheduleId) &&
          shift.start.getTime() < args.windowEnd.getTime() &&
          shift.end.getTime() > args.windowStart.getTime()
        );
      },
    );

    const schedules: Array<MaterializedScheduleInfo> = [];

    for (const id of ids) {
      const info: MaterializedScheduleInfo | undefined =
        harness.schedules.get(id);

      if (info) {
        schedules.push(info);
      }
    }

    return Promise.resolve({
      shifts,
      truncated: schedules.some((schedule: MaterializedScheduleInfo) => {
        return schedule.truncated;
      }),
      schedules,
      users: harness.users,
      generatedAt: args.now || new Date(),
    });
  };
}

function candidatesOf(
  harness: ReminderHarness,
  userKey: string,
): Array<ObjectID> {
  const explicit: Array<string> | undefined =
    harness.candidateSchedules.get(userKey);

  if (explicit) {
    return explicit.map((id: string) => {
      return new ObjectID(id);
    });
  }

  const derived: Set<string> = new Set<string>();

  for (const shift of harness.shifts) {
    if (shift.userId === userKey) {
      derived.add(shift.scheduleId);
    }
  }

  return Array.from(derived).map((id: string) => {
    return new ObjectID(id);
  });
}

/*
 * The batched lookup the runner uses: ONE call per project, every reminded
 * user in it. `candidateCalls` records what it was asked for so the tests can
 * pin that the sweep never goes back to a per-user query.
 */
function fakeCandidatesForUsers(
  harness: ReminderHarness,
): (args: {
  userIds: Array<ObjectID>;
  projectIds?: Array<ObjectID> | undefined;
}) => Promise<Map<string, Array<ObjectID>>> {
  return (args: {
    userIds: Array<ObjectID>;
    projectIds?: Array<ObjectID> | undefined;
  }): Promise<Map<string, Array<ObjectID>>> => {
    const userKeys: Array<string> = args.userIds.map((id: ObjectID) => {
      return id.toString();
    });

    harness.candidateCalls.push({
      userIds: userKeys,
      projectIds: (args.projectIds || []).map((id: ObjectID) => {
        return id.toString();
      }),
    });

    const result: Map<string, Array<ObjectID>> = new Map<
      string,
      Array<ObjectID>
    >();

    for (const userKey of userKeys) {
      result.set(userKey, candidatesOf(harness, userKey));
    }

    return Promise.resolve(result);
  };
}

function reminderRows(
  harness: ReminderHarness,
  query: Record<string, unknown> | undefined,
): Array<Record<string, unknown>> {
  return harness.reminders
    .map((reminder: FakeReminder, index: number) => {
      return {
        _id: new ObjectID(`reminder-${index}`),
        id: new ObjectID(`reminder-${index}`),
        projectId: reminder.projectId,
        userId: reminder.userId,
        minutesBeforeShift: reminder.minutesBeforeShift,
      };
    })
    .filter((row: Record<string, unknown>) => {
      return matchesQuery(query, row);
    });
}

function fakeSend(
  harness: ReminderHarness,
): (args: Record<string, unknown>) => Promise<void> {
  return (args: Record<string, unknown>): Promise<void> => {
    const emailEnvelope: Record<string, unknown> = (args["emailEnvelope"] ||
      {}) as Record<string, unknown>;
    const smsMessage: Record<string, unknown> = (args["smsMessage"] ||
      {}) as Record<string, unknown>;
    const push: Record<string, unknown> = (args["pushNotificationMessage"] ||
      {}) as Record<string, unknown>;
    const whatsApp: Record<string, unknown> | undefined = args[
      "whatsAppMessage"
    ] as Record<string, unknown> | undefined;

    const call: SentNotification = {
      userId: toKey(args["userId"]),
      projectId: toKey(args["projectId"]),
      eventType: args["eventType"] as NotificationSettingEventType,
      templateType: toKey(emailEnvelope["templateType"]),
      subject: toKey(emailEnvelope["subject"]),
      vars: (emailEnvelope["vars"] || {}) as Record<string, string>,
      smsText: toKey(smsMessage["message"]),
      pushTitle: toKey(push["title"]),
      pushBody: toKey(push["body"]),
      whatsAppTemplateKey: whatsApp
        ? toKey(whatsApp["templateKey"])
        : undefined,
      whatsAppBody: whatsApp ? toKey(whatsApp["body"]) : undefined,
      onCallScheduleId: args["onCallScheduleId"]
        ? toKey(args["onCallScheduleId"])
        : undefined,
      onCallPolicyId: args["onCallPolicyId"]
        ? toKey(args["onCallPolicyId"])
        : undefined,
      onCallPolicyEscalationRuleId: args["onCallPolicyEscalationRuleId"]
        ? toKey(args["onCallPolicyEscalationRuleId"])
        : undefined,
    };

    const failure: Error | null = harness.failSend(call);

    if (failure) {
      return Promise.reject(failure);
    }

    harness.sent.push(call);

    return Promise.resolve();
  };
}

/**
 * Spy every collaborator of the runner and answer from `harness`. Call in a
 * test or beforeEach; restore with jest.restoreAllMocks().
 */
export function installReminderHarness(harness: ReminderHarness): void {
  // Logger: silent, but captured.
  jest.spyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((message: unknown): void => {
    harness.warnings.push(toKey(message));
    return undefined;
  });
  jest.spyOn(logger, "error").mockImplementation((message: unknown): void => {
    harness.errors.push(message);
    return undefined;
  });

  // Reminder lead times.
  jest
    .spyOn(UserOnCallShiftReminderService, "findAllBy")
    .mockImplementation(((args: { query?: Record<string, unknown> }) => {
      if (harness.remindersReadError) {
        return Promise.reject(harness.remindersReadError);
      }

      return Promise.resolve(reminderRows(harness, args.query));
    }) as never);

  jest
    .spyOn(UserOnCallShiftReminderService, "findBy")
    .mockImplementation(((args: { query?: Record<string, unknown> }) => {
      if (harness.remindersReadError) {
        return Promise.reject(harness.remindersReadError);
      }

      return Promise.resolve(reminderRows(harness, args.query));
    }) as never);

  // The ledger.
  jest
    .spyOn(UserOnCallShiftReminderLogService, "create")
    .mockImplementation(fakeCreate(harness) as never);
  jest
    .spyOn(UserOnCallShiftReminderLogService, "findBy")
    .mockImplementation(fakeLedgerFindBy(harness) as never);
  jest
    .spyOn(UserOnCallShiftReminderLogService, "updateOneBy")
    .mockImplementation(fakeUpdateOneBy(harness) as never);
  jest
    .spyOn(UserOnCallShiftReminderLogService, "updateOneById")
    .mockImplementation(fakeUpdateOneById(harness) as never);
  jest
    .spyOn(UserOnCallShiftReminderLogService, "deleteOneBy")
    .mockImplementation(fakeDeleteOneBy(harness) as never);
  jest
    .spyOn(UserOnCallShiftReminderLogService, "deleteBy")
    .mockImplementation(fakeDeleteBy(harness) as never);

  // The materializer.
  jest
    .spyOn(OnCallShiftMaterializer, "materializeForSchedules")
    .mockImplementation(fakeMaterialize(harness) as never);
  jest
    .spyOn(OnCallShiftMaterializer, "getCandidateScheduleIdsForUsers")
    .mockImplementation(fakeCandidatesForUsers(harness) as never);
  jest
    .spyOn(OnCallShiftMaterializer, "getCandidateScheduleIdsForUser")
    .mockImplementation(((args: { userId: ObjectID }) => {
      return Promise.resolve(candidatesOf(harness, args.userId.toString()));
    }) as never);

  // The user directory, for recipients materialization does not return.
  jest.spyOn(UserService, "findBy").mockImplementation(((args: {
    query?: Record<string, unknown>;
  }) => {
    const rows: Array<Record<string, unknown>> = harness.directory.map(
      (user: MaterializedUserInfo) => {
        return {
          _id: new ObjectID(user.userId),
          id: new ObjectID(user.userId),
          name: user.userName,
          email: user.email,
          timezone: user.timezone,
        };
      },
    );

    const matched: Array<Record<string, unknown>> = rows.filter(
      (row: Record<string, unknown>) => {
        return matchesQuery(args.query, row);
      },
    );

    harness.userLookupCalls.push(
      matched.map((row: Record<string, unknown>) => {
        return toKey(row["_id"]);
      }),
    );

    return Promise.resolve(matched);
  }) as never);

  // Notification settings + delivery.
  jest
    .spyOn(UserNotificationSettingService, "findOneBy")
    .mockImplementation(((args: { query: Record<string, unknown> }) => {
      const key: string = settingsKey({
        userId: toKey(args.query["userId"]),
        projectId: toKey(args.query["projectId"]),
        eventType: args.query["eventType"] as NotificationSettingEventType,
      });

      if (harness.settings.has(key)) {
        return Promise.resolve({ _id: "setting", id: new ObjectID("setting") });
      }

      return Promise.resolve(null);
    }) as never);
  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation(fakeSend(harness) as never);

  // Watermark.
  jest.spyOn(GlobalCache, "getString").mockImplementation(((
    namespace: string,
    key: string,
  ) => {
    if (harness.cacheReadError) {
      return Promise.reject(harness.cacheReadError);
    }

    return Promise.resolve(harness.cache.get(`${namespace}:${key}`) ?? null);
  }) as never);
  jest.spyOn(GlobalCache, "setString").mockImplementation(((
    namespace: string,
    key: string,
    value: string,
  ) => {
    if (harness.cacheWriteError) {
      return Promise.reject(harness.cacheWriteError);
    }

    harness.cache.set(`${namespace}:${key}`, value);
    return Promise.resolve();
  }) as never);

  // Sweep lock.
  jest.spyOn(Semaphore, "lock").mockImplementation(((
    options: Record<string, unknown>,
  ) => {
    harness.lockCalls.push(options);

    if (!harness.lockAvailable) {
      return Promise.reject(new Error("lock held"));
    }

    return Promise.resolve({
      fake: true,
      key: options["key"],
    } as unknown as SemaphoreMutex);
  }) as never);
  jest.spyOn(Semaphore, "release").mockImplementation(((
    mutex: SemaphoreMutex,
  ) => {
    harness.releasedMutexes.push(mutex);
    return Promise.resolve();
  }) as never);

  // Dashboard URL.
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockImplementation((): Promise<URL> => {
      return Promise.resolve(URL.fromString(HARNESS_DASHBOARD_URL));
    });

  // Schedule -> project lookup (change pass without a project id).
  jest
    .spyOn(OnCallDutyPolicyScheduleService, "findBy")
    .mockImplementation(((args: { query?: Record<string, unknown> }) => {
      const rows: Array<Record<string, unknown>> = [];

      for (const [scheduleId, projectId] of harness.scheduleProjects) {
        rows.push({
          _id: new ObjectID(scheduleId),
          id: new ObjectID(scheduleId),
          projectId,
        });
      }

      return Promise.resolve(
        rows.filter((row: Record<string, unknown>) => {
          return matchesQuery(args.query, row);
        }),
      );
    }) as never);

  // Metrics.
  activeHarness = harness;
  jest.spyOn(Telemetry, "getCounter").mockImplementation(((): unknown => {
    return {
      add: (value: number, attributes: Record<string, unknown>): void => {
        if (activeHarness) {
          activeHarness.metrics.push({ value, attributes });
        }
      },
    };
  }) as never);
}

export function ledgerRowsOfKind(
  harness: ReminderHarness,
  kind: UserOnCallShiftReminderLogKind,
): Array<FakeLedgerRow> {
  return harness.ledger.filter((row: FakeLedgerRow) => {
    return row.kind === kind;
  });
}

export function watermarkOf(harness: ReminderHarness): string | undefined {
  return harness.cache.get("OnCallShiftReminders:watermark");
}

export function grantSettings(
  harness: ReminderHarness,
  data: { userId: ObjectID; projectId: ObjectID },
): void {
  harness.settings.add(
    settingsKey({
      userId: data.userId,
      projectId: data.projectId,
      eventType:
        NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
    }),
  );
  harness.settings.add(
    settingsKey({
      userId: data.userId,
      projectId: data.projectId,
      eventType:
        NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
    }),
  );
}
