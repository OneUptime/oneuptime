import DatabaseConfig from "../../../../Server/DatabaseConfig";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import MailService from "../../../../Server/Services/MailService";
import ProjectService from "../../../../Server/Services/ProjectService";
import UserEmailService from "../../../../Server/Services/UserEmailService";
import UserNotificationEmailRollupBatchService from "../../../../Server/Services/UserNotificationEmailRollupBatchService";
import UserNotificationEmailRollupItemService from "../../../../Server/Services/UserNotificationEmailRollupItemService";
import UserNotificationSettingService from "../../../../Server/Services/UserNotificationSettingService";
import logger from "../../../../Server/Utils/Logger";
import UserNotificationEmailRollupBatch, {
  RollupBatchStatus,
} from "../../../../Models/DatabaseModels/UserNotificationEmailRollupBatch";
import UserNotificationEmailRollupItem from "../../../../Models/DatabaseModels/UserNotificationEmailRollupItem";
import URL from "../../../../Types/API/URL";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../../Types/Dictionary";
import Email from "../../../../Types/Email";
import { JSONObject } from "../../../../Types/JSON";
import RollupCategory from "../../../../Types/NotificationSetting/NotificationEmailRollupCategory";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import { matchesQuery } from "../OnCall/OnCallResolverTestHarness";

/*
 * NOT A TEST FILE. Common/jest.config.json's testRegex only picks up
 * *.test.ts, which is exactly how the on-call harnesses live beside the suites
 * that use them.
 *
 * In-memory stand-ins for every collaborator EmailRollupFlushRunner touches,
 * so the REAL runner runs end to end - discovery, the epoch claim, the stamp,
 * the read-back, the recipient re-validation, the render and the send -
 * against rows a test can inspect afterwards.
 *
 * Two things here are not "just enough to pass", and both are the point of
 * having a harness at all rather than a pile of ad-hoc mocks:
 *
 *   1. THE BATCH TABLE ENFORCES ITS UNIQUE INDEX. A second insert for the same
 *      (projectId, userId, toEmail, claimEpochStartsAt) throws an object that
 *      PostgresErrorTranslator.isUniqueViolation recognises, exactly as
 *      Postgres would. The whole exactly-once argument rests on that insert
 *      being atomic, so a harness that let the duplicate through would make
 *      the claim tests prove nothing.
 *
 *   2. updateBy RETURNS AN HONEST AFFECTED COUNT and honours its limit. The
 *      runner branches on "did I stamp anything?" to decide Empty, and it
 *      relies on the limit to bound a batch at MAX_ITEMS_PER_ROLLUP.
 *
 * Query matching is matchesQuery from OnCallResolverTestHarness rather than a
 * second implementation: it already interprets ObjectID stringification, IS
 * NULL and the <= / >= operators QueryHelper builds, which is precisely the
 * vocabulary this runner queries in.
 *
 * `select` is honoured too, so a row handed back by discovery carries only the
 * four columns discovery asked for. A runner that started reading a column it
 * had not selected would fail here rather than in production.
 */

export type FakeRow = Record<string, unknown>;

export interface FakeItemRow {
  _id: ObjectID;
  id: ObjectID;
  projectId: ObjectID;
  userId: ObjectID;
  toEmail: Email;
  eventType: NotificationSettingEventType;
  rollupCategory: RollupCategory;
  subject: string;
  viewLink: string | null;
  sentAt: Date | null;
  rollupBatchId: ObjectID | null;
  createdAt: Date;
}

export interface FakeBatchRow {
  _id: ObjectID;
  id: ObjectID;
  projectId: ObjectID;
  userId: ObjectID;
  toEmail: Email;
  claimEpochStartsAt: Date;
  claimedAt: Date;
  sentAt: Date | null;
  itemCount: number | null;
  status: RollupBatchStatus;
  statusMessage: string | null;
  createdAt: Date;
}

export interface SentRollupMail {
  toEmail: string;
  subject: string;
  templateType: string | undefined;
  vars: Dictionary<string | JSONObject>;
  options: Record<string, unknown> | undefined;
}

export interface RollupHarness {
  items: Array<FakeItemRow>;
  batches: Array<FakeBatchRow>;
  // UserEmail rows: { _id, id, userId, projectId, isVerified, email }.
  userEmails: Array<FakeRow>;
  // Current event preferences; queued events start enabled at enqueue time.
  notificationSettings: Array<FakeRow>;
  // Project rows: { _id, id, name }.
  projects: Array<FakeRow>;

  /*
   * Every sendMail the runner attempted, including the ones that threw;
   * `sent` is the subset that was delivered.
   */
  sendAttempts: Array<SentRollupMail>;
  sent: Array<SentRollupMail>;

  /*
   * An ordered trace of the collaborator calls whose ORDER is load-bearing.
   * "preferences" is pushed by the settings read, "stamp" by the item
   * updateBy, and "send" by MailService.sendMail:
   * stamp-before-send is the property that stops a permanently failing send
   * re-spamming an address every epoch, and it is only observable as an
   * ordering.
   */
  callLog: Array<string>;

  lockAvailable: boolean;
  lockCalls: Array<Record<string, unknown>>;
  releasedMutexes: Array<SemaphoreMutex>;

  /*
   * Added to the real Date.now() the runner sees, so a test can make wall
   * clock jump forward mid-sweep (the sweep budget) without freezing time for
   * jest itself.
   */
  clockOffsetMs: number;

  // Return an Error to make that send throw; null to deliver.
  failSend: (mail: SentRollupMail) => Error | null;
  /*
   * Return an Error to make that claim insert throw something that is NOT a
   * unique violation; null to insert normally (the unique index still
   * applies).
   */
  failBatchCreate: (batch: FakeBatchRow) => Error | null;
  // Runs immediately before a claim insert; lets a test inject a racing write.
  beforeBatchCreate: (() => void) | null;

  itemFindByCalls: number;
  // Every argument object the item findBy was handed, in call order.
  itemFindByArgs: Array<Record<string, unknown>>;
  itemUpdateByCalls: number;
  batchCreateCalls: number;

  debugs: Array<string>;
  warnings: Array<string>;
  errors: Array<unknown>;

  nextItemId: number;
  nextBatchId: number;
}

export const HARNESS_DASHBOARD_URL: string =
  "https://oneuptime.example.com/dashboard";

export function emptyRollupHarness(): RollupHarness {
  return {
    items: [],
    batches: [],
    userEmails: [],
    notificationSettings: [],
    projects: [],
    sendAttempts: [],
    sent: [],
    callLog: [],
    lockAvailable: true,
    lockCalls: [],
    releasedMutexes: [],
    clockOffsetMs: 0,
    failSend: (): Error | null => {
      return null;
    },
    failBatchCreate: (): Error | null => {
      return null;
    },
    beforeBatchCreate: null,
    itemFindByCalls: 0,
    itemFindByArgs: [],
    itemUpdateByCalls: 0,
    batchCreateCalls: 0,
    debugs: [],
    warnings: [],
    errors: [],
    nextItemId: 1,
    nextBatchId: 1,
  };
}

type ToKeyFunction = (value: unknown) => string;

const toKey: ToKeyFunction = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
};

type ToLimitFunction = (value: unknown, fallback: number) => number;

/*
 * FindBy.limit and UpdateBy.limit are `PositiveNumber | number`, and the
 * limit is load-bearing in both places (a bounded scan, and a batch capped at
 * MAX_ITEMS_PER_ROLLUP), so both shapes are honoured rather than assumed.
 */
const toLimit: ToLimitFunction = (value: unknown, fallback: number): number => {
  if (value instanceof PositiveNumber) {
    return value.toNumber();
  }

  if (typeof value === "number") {
    return value;
  }

  return fallback;
};

type ToComparableFunction = (value: unknown) => number;

const toComparable: ToComparableFunction = (value: unknown): number => {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "number") {
    return value;
  }

  return new Date(String(value)).getTime();
};

type ApplySortFunction = (
  rows: Array<FakeRow>,
  sort: Record<string, unknown> | undefined,
) => Array<FakeRow>;

const applySort: ApplySortFunction = (
  rows: Array<FakeRow>,
  sort: Record<string, unknown> | undefined,
): Array<FakeRow> => {
  if (!sort) {
    return rows;
  }

  const entry: [string, unknown] | undefined = Object.entries(sort)[0];

  if (!entry) {
    return rows;
  }

  const key: string = entry[0];
  const descending: boolean = String(entry[1]).toLowerCase().startsWith("desc");

  return [...rows].sort((a: FakeRow, b: FakeRow): number => {
    const left: number = toComparable(a[key]);
    const right: number = toComparable(b[key]);
    return descending ? right - left : left - right;
  });
};

type ApplySelectFunction = (
  row: FakeRow,
  select: Record<string, unknown> | undefined,
) => FakeRow;

/*
 * Project a row the way the database would: the selected columns, plus the id
 * columns DatabaseService always returns. A runner that reads a column it did
 * not select gets undefined here, which is what it would get in production.
 */
const applySelect: ApplySelectFunction = (
  row: FakeRow,
  select: Record<string, unknown> | undefined,
): FakeRow => {
  if (!select) {
    return { ...row };
  }

  const projected: FakeRow = {
    _id: row["_id"],
    id: row["id"],
  };

  for (const key of Object.keys(select)) {
    projected[key] = row[key];
  }

  return projected;
};

/*
 * What Postgres throws on 23505. PostgresErrorTranslator.isUniqueViolation
 * recognises this shape, which is the point: the runner must recover through
 * the translator rather than by sniffing the code itself.
 */
export class RollupUniqueViolationError extends Error {
  public postgresErrorCode: string = "23505";

  public constructor() {
    super(
      'duplicate key value violates unique constraint "UserNotificationEmailRollupBatch_claim_unique"',
    );
  }
}

type BatchUniqueKeyFunction = (row: {
  projectId: ObjectID;
  userId: ObjectID;
  toEmail: Email;
  claimEpochStartsAt: Date;
}) => string;

const batchUniqueKey: BatchUniqueKeyFunction = (row: {
  projectId: ObjectID;
  userId: ObjectID;
  toEmail: Email;
  claimEpochStartsAt: Date;
}): string => {
  return [
    toKey(row.projectId),
    toKey(row.userId),
    toKey(row.toEmail),
    row.claimEpochStartsAt.getTime(),
  ].join("|");
};

// -- Row builders ----------------------------------------------------------

export function seedItem(
  harness: RollupHarness,
  data: {
    projectId: ObjectID;
    userId: ObjectID;
    toEmail: Email;
    createdAt: Date;
    subject?: string | undefined;
    eventType?: NotificationSettingEventType | undefined;
    rollupCategory?: RollupCategory | undefined;
    viewLink?: string | null | undefined;
    sentAt?: Date | null | undefined;
    rollupBatchId?: ObjectID | null | undefined;
  },
): FakeItemRow {
  const id: ObjectID = new ObjectID(`item-${harness.nextItemId++}`);
  const row: FakeItemRow = {
    _id: id,
    id: id,
    projectId: data.projectId,
    userId: data.userId,
    toEmail: data.toEmail,
    eventType:
      data.eventType ??
      NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
    rollupCategory: data.rollupCategory ?? RollupCategory.Incidents,
    subject: data.subject ?? `Incident created ${id.toString()}`,
    viewLink: data.viewLink ?? null,
    sentAt: data.sentAt ?? null,
    rollupBatchId: data.rollupBatchId ?? null,
    createdAt: data.createdAt,
  };

  harness.items.push(row);

  /*
   * An owner email only enters the queue when its event is enabled. Seed that
   * initial preference once; tests can then disable or remove it before the
   * flush to exercise changes made while the email was waiting.
   */
  const hasSetting: boolean = harness.notificationSettings.some(
    (setting: FakeRow): boolean => {
      return (
        toKey(setting["projectId"]) === toKey(row.projectId) &&
        toKey(setting["userId"]) === toKey(row.userId) &&
        setting["eventType"] === row.eventType
      );
    },
  );

  if (!hasSetting) {
    seedNotificationSetting(harness, {
      projectId: row.projectId,
      userId: row.userId,
      eventType: row.eventType,
    });
  }

  return row;
}

export function seedNotificationSetting(
  harness: RollupHarness,
  data: {
    projectId: ObjectID;
    userId: ObjectID;
    eventType: NotificationSettingEventType;
    alertByEmail?: boolean | undefined;
  },
): FakeRow {
  const id: ObjectID = ObjectID.generate();
  const setting: FakeRow = {
    _id: id,
    id: id,
    projectId: data.projectId,
    userId: data.userId,
    eventType: data.eventType,
    alertByEmail: data.alertByEmail ?? true,
  };

  harness.notificationSettings.push(setting);
  return setting;
}

export function seedVerifiedEmail(
  harness: RollupHarness,
  data: {
    projectId: ObjectID;
    userId: ObjectID;
    email: Email;
    isVerified?: boolean | undefined;
  },
): void {
  const id: ObjectID = ObjectID.generate();

  harness.userEmails.push({
    _id: id,
    id: id,
    projectId: data.projectId,
    userId: data.userId,
    email: data.email,
    isVerified: data.isVerified ?? true,
  });
}

export function seedProject(
  harness: RollupHarness,
  data: { projectId: ObjectID; name: string },
): void {
  harness.projects.push({
    _id: data.projectId,
    id: data.projectId,
    name: data.name,
  });
}

export function batchesOfStatus(
  harness: RollupHarness,
  status: RollupBatchStatus,
): Array<FakeBatchRow> {
  return harness.batches.filter((row: FakeBatchRow): boolean => {
    return row.status === status;
  });
}

export function pendingItems(harness: RollupHarness): Array<FakeItemRow> {
  return harness.items.filter((row: FakeItemRow): boolean => {
    return row.sentAt === null;
  });
}

// -- Installation ----------------------------------------------------------

/**
 * Spy every collaborator of EmailRollupFlushRunner and answer from `harness`.
 * Call in a test or beforeEach; restore with jest.restoreAllMocks().
 */
export function installRollupHarness(harness: RollupHarness): void {
  // Logger: silent, but captured.
  jest.spyOn(logger, "debug").mockImplementation((message: unknown): void => {
    harness.debugs.push(toKey(message));
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

  /*
   * Real elapsed time plus a test-controlled offset, rather than a frozen
   * clock: the sweep's budget check is the only thing in the runner that reads
   * Date.now, and freezing it outright would also freeze it for jest.
   */
  const realNow: () => number = Date.now.bind(Date);

  jest.spyOn(Date, "now").mockImplementation((): number => {
    return realNow() + harness.clockOffsetMs;
  });

  // -- The item table ------------------------------------------------------

  jest
    .spyOn(UserNotificationEmailRollupItemService, "findBy")
    .mockImplementation(((args: {
      query?: Record<string, unknown>;
      select?: Record<string, unknown>;
      sort?: Record<string, unknown>;
      limit?: unknown;
    }) => {
      harness.itemFindByCalls = harness.itemFindByCalls + 1;
      harness.itemFindByArgs.push(args as Record<string, unknown>);

      const matched: Array<FakeRow> = harness.items
        .map((row: FakeItemRow): FakeRow => {
          return row as unknown as FakeRow;
        })
        .filter((row: FakeRow): boolean => {
          return matchesQuery(args.query, row);
        });

      const sorted: Array<FakeRow> = applySort(matched, args.sort);
      const limited: Array<FakeRow> = sorted.slice(
        0,
        toLimit(args.limit, sorted.length),
      );

      return Promise.resolve(
        limited.map((row: FakeRow): UserNotificationEmailRollupItem => {
          return applySelect(
            row,
            args.select,
          ) as unknown as UserNotificationEmailRollupItem;
        }),
      );
    }) as never);

  /*
   * Used only on the failure path, where flushBucket counts how many rows it
   * had already stamped into the batch so the Failed row can say how many
   * notifications went with it. Modelled on findBy so the same query matcher
   * decides membership; an unmocked countBy would throw inside the catch that
   * records the failure and leave the batch stuck on Claimed, which is exactly
   * the state the recording exists to avoid.
   */
  jest
    .spyOn(UserNotificationEmailRollupItemService, "countBy")
    .mockImplementation(((args: { query?: Record<string, unknown> }) => {
      const matched: Array<FakeRow> = harness.items
        .map((row: FakeItemRow): FakeRow => {
          return row as unknown as FakeRow;
        })
        .filter((row: FakeRow): boolean => {
          return matchesQuery(args.query, row);
        });

      return Promise.resolve(new PositiveNumber(matched.length));
    }) as never);

  jest
    .spyOn(UserNotificationEmailRollupItemService, "updateBy")
    .mockImplementation(((args: {
      query?: Record<string, unknown>;
      data: Record<string, unknown>;
      limit?: unknown;
    }) => {
      harness.itemUpdateByCalls = harness.itemUpdateByCalls + 1;
      harness.callLog.push("stamp");

      const limit: number = toLimit(args.limit, harness.items.length);

      /*
       * updateBy RESOLVES ITS ROWS NEWEST-FIRST, exactly as DatabaseService
       * does, and that is not a detail this harness may round off.
       *
       * _updateBy loads the rows it is about to write with an internal _findBy
       * that takes no sort from the caller - UpdateBy has no sort field - so
       * it gets _findBy's default of createdAt DESCENDING. The default is
       * invisible until an update is LIMITED, and then it decides WHICH rows
       * win: a bare `updateBy(..., limit: MAX_ITEMS_PER_ROLLUP)` over an
       * over-full bucket stamps the NEWEST rows and starves the oldest.
       *
       * Iterating insertion order here instead would make a LIFO drain look
       * FIFO whenever a fixture happened to be seeded oldest-first, which is
       * every fixture - so the flush runner's explicit oldest-first select
       * could be deleted with the suite still green.
       */
      const candidates: Array<FakeItemRow> = applySort(
        harness.items as unknown as Array<FakeRow>,
        { createdAt: SortOrder.Descending },
      ) as unknown as Array<FakeItemRow>;

      let affected: number = 0;

      for (const row of candidates) {
        if (affected >= limit) {
          break;
        }

        if (!matchesQuery(args.query, row as unknown as FakeRow)) {
          continue;
        }

        Object.assign(row, args.data);
        affected = affected + 1;
      }

      return Promise.resolve(affected);
    }) as never);

  // -- The batch table -----------------------------------------------------

  jest
    .spyOn(UserNotificationEmailRollupBatchService, "create")
    .mockImplementation(((args: { data: UserNotificationEmailRollupBatch }) => {
      harness.batchCreateCalls = harness.batchCreateCalls + 1;

      const data: UserNotificationEmailRollupBatch = args.data;

      if (
        !data.projectId ||
        !data.userId ||
        !data.toEmail ||
        !data.claimEpochStartsAt ||
        !data.claimedAt ||
        !data.status
      ) {
        return Promise.reject(
          new Error("fake rollup batch: missing required column"),
        );
      }

      const id: ObjectID = new ObjectID(`batch-${harness.nextBatchId++}`);
      const row: FakeBatchRow = {
        _id: id,
        id: id,
        projectId: data.projectId,
        userId: data.userId,
        toEmail: data.toEmail,
        claimEpochStartsAt: data.claimEpochStartsAt,
        claimedAt: data.claimedAt,
        sentAt: null,
        itemCount: null,
        status: data.status,
        statusMessage: null,
        createdAt: data.claimedAt,
      };

      if (harness.beforeBatchCreate) {
        harness.beforeBatchCreate();
      }

      const failure: Error | null = harness.failBatchCreate(row);

      if (failure) {
        return Promise.reject(failure);
      }

      const key: string = batchUniqueKey(row);

      for (const existing of harness.batches) {
        if (batchUniqueKey(existing) === key) {
          return Promise.reject(new RollupUniqueViolationError());
        }
      }

      harness.batches.push(row);

      const created: UserNotificationEmailRollupBatch =
        new UserNotificationEmailRollupBatch();
      created.id = id;

      return Promise.resolve(created);
    }) as never);

  jest
    .spyOn(UserNotificationEmailRollupBatchService, "updateOneById")
    .mockImplementation(((args: {
      id: ObjectID;
      data: Record<string, unknown>;
    }) => {
      let affected: number = 0;

      for (const row of harness.batches) {
        if (toKey(row._id) !== toKey(args.id)) {
          continue;
        }

        Object.assign(row, args.data);
        affected = affected + 1;
      }

      return Promise.resolve(affected);
    }) as never);

  // -- The recipient re-validation ----------------------------------------

  jest
    .spyOn(UserNotificationSettingService, "findBy")
    .mockImplementation(((args: {
      query?: Record<string, unknown>;
      select?: Record<string, unknown>;
      limit?: unknown;
      skip?: number;
    }) => {
      harness.callLog.push("preferences");
      const matched: Array<FakeRow> = harness.notificationSettings.filter(
        (row: FakeRow): boolean => {
          return matchesQuery(args.query, row);
        },
      );
      const skip: number = args.skip ?? 0;

      return Promise.resolve(
        matched
          .slice(skip, skip + toLimit(args.limit, matched.length))
          .map((row: FakeRow): FakeRow => {
            return applySelect(row, args.select);
          }),
      );
    }) as never);

  jest.spyOn(UserEmailService, "findBy").mockImplementation(((args: {
    query?: Record<string, unknown>;
    select?: Record<string, unknown>;
  }) => {
    const matched: Array<FakeRow> = harness.userEmails.filter(
      (row: FakeRow): boolean => {
        return matchesQuery(args.query, row);
      },
    );

    return Promise.resolve(
      matched.map((row: FakeRow): FakeRow => {
        return applySelect(row, args.select);
      }),
    );
  }) as never);

  // -- The project name ----------------------------------------------------

  jest.spyOn(ProjectService, "findOneById").mockImplementation(((args: {
    id: ObjectID;
    select?: Record<string, unknown>;
  }) => {
    const row: FakeRow | undefined = harness.projects.find(
      (candidate: FakeRow): boolean => {
        return toKey(candidate["_id"]) === toKey(args.id);
      },
    );

    if (!row) {
      return Promise.resolve(null);
    }

    return Promise.resolve(applySelect(row, args.select));
  }) as never);

  // -- Dashboard URL -------------------------------------------------------

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockImplementation((): Promise<URL> => {
      return Promise.resolve(URL.fromString(HARNESS_DASHBOARD_URL));
    });

  // -- The sweep lock ------------------------------------------------------

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

  // -- The send ------------------------------------------------------------

  jest.spyOn(MailService, "sendMail").mockImplementation(((
    mail: {
      toEmail: Email;
      subject: string;
      templateType?: string | undefined;
      vars: Dictionary<string | JSONObject>;
    },
    options?: Record<string, unknown>,
  ) => {
    const call: SentRollupMail = {
      toEmail: toKey(mail.toEmail),
      subject: mail.subject,
      templateType: mail.templateType,
      vars: mail.vars,
      options: options,
    };

    harness.callLog.push("send");
    harness.sendAttempts.push(call);

    const failure: Error | null = harness.failSend(call);

    if (failure) {
      return Promise.reject(failure);
    }

    harness.sent.push(call);

    return Promise.resolve(undefined);
  }) as never);
}
