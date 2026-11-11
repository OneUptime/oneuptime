import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import { AddNotificationChannelsToOnCallDutyPolicyExecutionLogTimeline1809090065850 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809090065850-AddNotificationChannelsToOnCallDutyPolicyExecutionLogTimeline";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import OnCallDutyPolicyExecutionLogTimelineService, {
  STEP_NOTIFICATION_CHANNEL_COLUMNS,
} from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import logger from "../../../Server/Utils/Logger";
import OnCallPolicyRunMessage from "../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import ColumnType from "../../../Types/Database/ColumnType";
import Columns from "../../../Types/Database/Columns";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ObjectID from "../../../Types/ObjectID";
import {
  ON_CALL_PAGE_CHANNELS,
  OnCallPageChannel,
  OnCallPageChannelInfo,
  readOnCallPageChannels,
} from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import { getMetadataArgsStorage, QueryRunner } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * "NOTIFIED VIA" ON AN ON-CALL RUN'S EXECUTION TIMELINE (#6585).
 *
 * Each step of a run (OnCallDutyPolicyExecutionLogTimeline) keeps the
 * channels its page went out to its person by, in notificationChannels:
 * the person's own notifications (UserOnCallLogTimeline) say the same, but
 * only that person can read them, while whoever can read the run can read
 * its steps. The list is worked out again from all of the step's
 * notifications whenever one is written or changes status, with the step's
 * row held meanwhile, so notifications that change at once never leave an
 * older list behind.
 *
 * These run the real service against a database held in memory: a step
 * row, its notifications as Postgres hands them back, and a row lock that
 * makes a second `SELECT ... FOR UPDATE` of the same row wait until the
 * first transaction ends - as Postgres does.
 */

const STEP: ObjectID = new ObjectID("0f850000-0000-4000-8000-0000000000a1");
const OTHER_STEP: ObjectID = new ObjectID(
  "0f850000-0000-4000-8000-0000000000a2",
);
const RUN: ObjectID = new ObjectID("0f850000-0000-4000-8000-0000000000b1");

type AnyFunction = (...args: Array<unknown>) => Promise<unknown>;

interface StepRow {
  notificationChannels: unknown;
  deletedAt: Date | null;
}

// A notification, as Postgres hands its row back to a raw query.
type NotificationRow = Record<string, unknown> & {
  onCallDutyPolicyExecutionLogTimelineId: string;
  status: UserNotificationStatus;
  deletedAt: Date | null;
};

interface Statement {
  transaction: number;
  sql: string;
  parameters: Array<unknown>;
}

let steps: Map<string, StepRow>;
let notifications: Array<NotificationRow>;
let statements: Array<Statement>;
let transactions: number;
let locks: Map<string, Promise<void>>;
// Called once a transaction has read the notifications, before it goes on.
let afterRead: ((transaction: number) => Promise<void>) | null;

const WHITESPACE: RegExp = /\s+/g;

function squash(sql: string): string {
  return sql.replace(WHITESPACE, " ").trim();
}

function stepOf(id: ObjectID, notificationChannels: unknown = null): void {
  steps.set(id.toString(), {
    notificationChannels: notificationChannels,
    deletedAt: null,
  });
}

// One notification of a step's page, by one channel.
function notify(data: {
  channel: OnCallPageChannel;
  status: UserNotificationStatus;
  step?: ObjectID;
}): NotificationRow {
  const info: OnCallPageChannelInfo = ON_CALL_PAGE_CHANNELS.find(
    (item: OnCallPageChannelInfo) => {
      return item.channel === data.channel;
    },
  )!;

  const row: NotificationRow = {
    onCallDutyPolicyExecutionLogTimelineId: (data.step || STEP).toString(),
    status: data.status,
    deletedAt: null,
  };

  for (const column of ON_CALL_PAGE_CHANNELS) {
    row[column.field] = null;
  }

  row[info.field] = ObjectID.generate().toString();
  notifications.push(row);

  return row;
}

// What a raw SELECT of these columns hands back: only the columns named.
function selectColumns(
  sql: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  /*
   * Array.from's own map, not the iterator's: iterator helpers are newer
   * than the ES2017 Common is compiled to.
   */
  const named: Array<string> = Array.from(
    sql.split(" FROM ")[0]!.matchAll(/"([A-Za-z_]+)"/g),
    (match: RegExpMatchArray) => {
      return match[1]!;
    },
  );
  const out: Record<string, unknown> = {};

  for (const column of named) {
    out[column] = row[column];
  }

  return out;
}

async function runQuery(
  transaction: number,
  held: Array<() => void>,
  sql: string,
  parameters: Array<unknown>,
): Promise<unknown> {
  const text: string = squash(sql);

  /*
   * A statement is logged when it runs: one that asks for a row's lock,
   * once the lock is granted.
   */
  if (!text.includes("FOR UPDATE")) {
    statements.push({ transaction, sql: text, parameters });
  }

  if (text.includes('FROM "OnCallDutyPolicyExecutionLogTimeline"')) {
    const id: string = String(parameters[0]);

    // The row's lock: wait for the transaction that holds it to end.
    if (text.includes("FOR UPDATE")) {
      const before: Promise<void> = locks.get(id) || Promise.resolve();
      let release: () => void = (): void => {
        return undefined;
      };
      const mine: Promise<void> = new Promise<void>((resolve: () => void) => {
        release = resolve;
      });
      locks.set(
        id,
        before.then(() => {
          return mine;
        }),
      );
      await before;
      held.push(release);
      statements.push({ transaction, sql: text, parameters });
    }

    const step: StepRow | undefined = steps.get(id);

    if (
      !step ||
      (text.includes('"deletedAt" IS NULL') && step.deletedAt !== null)
    ) {
      return [];
    }

    return [selectColumns(text, step as unknown as Record<string, unknown>)];
  }

  if (text.includes('FROM "UserOnCallLogTimeline"')) {
    // What the statement sees: the rows as they are when it runs.
    const rows: Array<Record<string, unknown>> = notifications
      .filter((row: NotificationRow) => {
        return (
          row.onCallDutyPolicyExecutionLogTimelineId ===
            String(parameters[0]) &&
          (!text.includes('"deletedAt" IS NULL') || row.deletedAt === null)
        );
      })
      .map((row: NotificationRow) => {
        return selectColumns(text, row);
      });

    if (afterRead) {
      await afterRead(transaction);
    }

    return rows;
  }

  if (text.startsWith('UPDATE "OnCallDutyPolicyExecutionLogTimeline"')) {
    const step: StepRow | undefined = steps.get(String(parameters[1]));

    if (step) {
      step.notificationChannels = JSON.parse(String(parameters[0]));
    }

    return [];
  }

  throw new Error(`Unexpected statement: ${text}`);
}

beforeEach(() => {
  steps = new Map<string, StepRow>();
  notifications = [];
  statements = [];
  transactions = 0;
  locks = new Map<string, Promise<void>>();
  afterRead = null;

  stepOf(STEP);

  jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);

  jest
    .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "executeTransaction")
    .mockImplementation((async (
      run: (entityManager: unknown) => Promise<unknown>,
    ): Promise<unknown> => {
      const transaction: number = ++transactions;
      const held: Array<() => void> = [];

      try {
        return await run({
          query: (sql: string, parameters: Array<unknown>) => {
            return runQuery(transaction, held, sql, parameters);
          },
        });
      } finally {
        // Commit or roll back: the row's lock goes with the transaction.
        for (const release of held) {
          release();
        }
      }
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function refresh(step: ObjectID = STEP): Promise<void> {
  await OnCallDutyPolicyExecutionLogTimelineService.refreshNotificationChannels(
    step,
  );
}

function channelsOf(step: ObjectID = STEP): unknown {
  return steps.get(step.toString())!.notificationChannels;
}

function writes(): Array<Statement> {
  return statements.filter((statement: Statement) => {
    return statement.sql.startsWith("UPDATE");
  });
}

describe("the step keeps the channels its page went out by", () => {
  test("stored when the page goes out: each channel once, in the order the run's message lists them", async () => {
    notify({
      channel: OnCallPageChannel.Email,
      status: UserNotificationStatus.Sent,
    });
    notify({
      channel: OnCallPageChannel.SMS,
      status: UserNotificationStatus.Sending,
    });
    notify({
      channel: OnCallPageChannel.SMS,
      status: UserNotificationStatus.Sent,
    });

    await refresh();

    expect(channelsOf()).toEqual([
      OnCallPageChannel.SMS,
      OnCallPageChannel.Email,
    ]);
  });

  test("grows when a later notification goes out by a new channel", async () => {
    notify({
      channel: OnCallPageChannel.SMS,
      status: UserNotificationStatus.Sent,
    });
    await refresh();
    expect(channelsOf()).toEqual([OnCallPageChannel.SMS]);

    // The person's own On-Call Rules call them ten minutes on.
    notify({
      channel: OnCallPageChannel.Call,
      status: UserNotificationStatus.Sending,
    });
    await refresh();

    expect(channelsOf()).toEqual([
      OnCallPageChannel.Call,
      OnCallPageChannel.SMS,
    ]);
  });

  test("a notification that could not be sent does not add its channel", async () => {
    notify({
      channel: OnCallPageChannel.Push,
      status: UserNotificationStatus.Sent,
    });
    notify({
      channel: OnCallPageChannel.Telegram,
      status: UserNotificationStatus.Error,
    });
    notify({
      channel: OnCallPageChannel.WhatsApp,
      status: UserNotificationStatus.Skipped,
    });

    await refresh();

    expect(channelsOf()).toEqual([OnCallPageChannel.Push]);
  });

  test("one that fails after it went out leaves the list", async () => {
    const sms: NotificationRow = notify({
      channel: OnCallPageChannel.SMS,
      status: UserNotificationStatus.Sent,
    });
    notify({
      channel: OnCallPageChannel.Email,
      status: UserNotificationStatus.Sent,
    });
    await refresh();
    expect(channelsOf()).toEqual([
      OnCallPageChannel.SMS,
      OnCallPageChannel.Email,
    ]);

    // The carrier reports it undelivered.
    sms.status = UserNotificationStatus.Error;
    await refresh();

    expect(channelsOf()).toEqual([OnCallPageChannel.Email]);
  });

  test("a call nobody answered still reached the person, as do the notifications they answered or escalated from", async () => {
    notify({
      channel: OnCallPageChannel.Call,
      status: UserNotificationStatus.NotAnswered,
    });
    notify({
      channel: OnCallPageChannel.Push,
      status: UserNotificationStatus.Acknowledged,
    });
    notify({
      channel: OnCallPageChannel.Slack,
      status: UserNotificationStatus.PassedOn,
    });

    await refresh();

    expect(channelsOf()).toEqual([
      OnCallPageChannel.Call,
      OnCallPageChannel.Push,
      OnCallPageChannel.Slack,
    ]);
  });

  test("a page that reached nobody keeps an empty list - known to be none, unlike a step that keeps no list at all", async () => {
    notify({
      channel: OnCallPageChannel.SMS,
      status: UserNotificationStatus.Error,
    });

    await refresh();

    expect(channelsOf()).toEqual([]);
  });

  test("only this step's notifications count, and not deleted ones", async () => {
    stepOf(OTHER_STEP);
    notify({
      channel: OnCallPageChannel.Email,
      status: UserNotificationStatus.Sent,
    });
    notify({
      channel: OnCallPageChannel.Call,
      status: UserNotificationStatus.Sent,
      step: OTHER_STEP,
    });
    notify({
      channel: OnCallPageChannel.SMS,
      status: UserNotificationStatus.Sent,
    }).deletedAt = new Date();

    await refresh();

    expect(channelsOf()).toEqual([OnCallPageChannel.Email]);
    expect(channelsOf(OTHER_STEP)).toBeNull();
  });

  test("the list the step already has is not written again", async () => {
    stepOf(STEP, [OnCallPageChannel.SMS]);
    notify({
      channel: OnCallPageChannel.SMS,
      status: UserNotificationStatus.Sent,
    });

    await refresh();

    expect(writes()).toEqual([]);
    expect(channelsOf()).toEqual([OnCallPageChannel.SMS]);
  });

  test("a step that is gone is left alone: nothing read, nothing written", async () => {
    steps.get(STEP.toString())!.deletedAt = new Date();
    notify({
      channel: OnCallPageChannel.SMS,
      status: UserNotificationStatus.Sent,
    });

    await refresh();

    expect(statements).toHaveLength(1);
    expect(writes()).toEqual([]);
  });

  test("never throws: a failed write costs the list, never the notification", async () => {
    jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "executeTransaction")
      .mockRejectedValue(new Error("connection reset") as never);

    await expect(refresh()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(String(jest.mocked(logger.error).mock.calls[0]![0])).toContain(
      STEP.toString(),
    );
  });
});

describe("how it reads and writes", () => {
  test("in one transaction: the step's row held first, then the notifications read, then the list written", async () => {
    notify({
      channel: OnCallPageChannel.SMS,
      status: UserNotificationStatus.Sent,
    });

    await refresh();

    expect(
      statements.map((statement: Statement) => {
        return statement.transaction;
      }),
    ).toEqual([1, 1, 1]);
    expect(statements[0]!.sql).toBe(
      'SELECT "notificationChannels" FROM "OnCallDutyPolicyExecutionLogTimeline" WHERE "_id" = $1 AND "deletedAt" IS NULL FOR UPDATE',
    );
    expect(statements[1]!.sql).toContain('FROM "UserOnCallLogTimeline"');
    expect(statements[1]!.sql).toContain(
      'WHERE "onCallDutyPolicyExecutionLogTimelineId" = $1 AND "deletedAt" IS NULL',
    );
    expect(statements[2]!.sql).toBe(
      'UPDATE "OnCallDutyPolicyExecutionLogTimeline" SET "notificationChannels" = $1::jsonb WHERE "_id" = $2',
    );
  });

  test("binds every value: the step's id is a parameter, never part of the SQL", async () => {
    notify({
      channel: OnCallPageChannel.SMS,
      status: UserNotificationStatus.Sent,
    });

    await refresh();

    for (const statement of statements) {
      expect(statement.sql).not.toContain(STEP.toString());
    }

    expect(statements[0]!.parameters).toEqual([STEP.toString()]);
    expect(statements[1]!.parameters).toEqual([STEP.toString()]);
    expect(statements[2]!.parameters).toEqual([
      JSON.stringify([OnCallPageChannel.SMS]),
      STEP.toString(),
    ]);
  });

  test("reads each notification's status and every channel's own column, so a channel added to the list is read too", () => {
    expect(STEP_NOTIFICATION_CHANNEL_COLUMNS).toEqual([
      "status",
      ...ON_CALL_PAGE_CHANNELS.map((info: OnCallPageChannelInfo) => {
        return info.field;
      }),
    ]);

    // Each is a column of the notification, under that very name.
    const columns: Array<string> = getMetadataArgsStorage()
      .columns.filter((args: ColumnMetadataArgs) => {
        return args.target === UserOnCallLogTimeline;
      })
      .map((args: ColumnMetadataArgs) => {
        return args.options.name || args.propertyName;
      });

    for (const column of STEP_NOTIFICATION_CHANNEL_COLUMNS) {
      expect(columns).toContain(column);
    }
  });

  test("notifications that change at once take turns: a refresh that starts while another is between its read and its write writes after it, from what is there then", async () => {
    notify({
      channel: OnCallPageChannel.SMS,
      status: UserNotificationStatus.Sent,
    });

    // The first refresh reads the SMS alone, then is held up.
    let firstHasRead: () => void = (): void => {
      return undefined;
    };
    const firstRead: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        firstHasRead = resolve;
      },
    );
    let letFirstGoOn: () => void = (): void => {
      return undefined;
    };
    const firstMayGoOn: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        letFirstGoOn = resolve;
      },
    );

    afterRead = async (transaction: number): Promise<void> => {
      if (transaction === 1) {
        firstHasRead();
        await firstMayGoOn;
      }
    };

    const first: Promise<void> = refresh();
    await firstRead;

    // Meanwhile the email goes out, and its own refresh starts.
    notify({
      channel: OnCallPageChannel.Email,
      status: UserNotificationStatus.Sending,
    });
    const second: Promise<void> = refresh();

    // However long the second is given, it waits for the step's row.
    for (let tick: number = 0; tick < 20; tick++) {
      await Promise.resolve();
    }

    expect(writes()).toEqual([]);

    letFirstGoOn();
    await Promise.all([first, second]);

    expect(
      statements.map((statement: Statement) => {
        return `${statement.transaction}:${statement.sql.split(" ")[0]}`;
      }),
    ).toEqual([
      "1:SELECT",
      "1:SELECT",
      "1:UPDATE",
      "2:SELECT",
      "2:SELECT",
      "2:UPDATE",
    ]);
    expect(channelsOf()).toEqual([
      OnCallPageChannel.SMS,
      OnCallPageChannel.Email,
    ]);
  });
});

describe("the notification's own hooks keep it", () => {
  let refreshed: Array<string>;

  beforeEach(() => {
    refreshed = [];

    jest.spyOn(OnCallPolicyRunMessage, "refresh").mockImplementation(() => {
      return undefined;
    });

    jest
      .spyOn(
        OnCallDutyPolicyExecutionLogTimelineService,
        "addNotificationToFeed",
      )
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(
        OnCallDutyPolicyExecutionLogTimelineService,
        "refreshNotificationChannels",
      )
      .mockImplementation((async (step: ObjectID) => {
        refreshed.push(step.toString());
      }) as never);
  });

  function hook(name: string): AnyFunction {
    return (
      UserOnCallLogTimelineService as unknown as Record<string, AnyFunction>
    )[name]!.bind(UserOnCallLogTimelineService) as AnyFunction;
  }

  function delivery(data: {
    step?: ObjectID | undefined;
    status: UserNotificationStatus;
    channel?: keyof UserOnCallLogTimeline;
  }): UserOnCallLogTimeline {
    const row: UserOnCallLogTimeline = new UserOnCallLogTimeline();
    row.id = ObjectID.generate();
    row.onCallDutyPolicyExecutionLogId = RUN;
    row.status = data.status;

    if (data.step) {
      row.onCallDutyPolicyExecutionLogTimelineId = data.step;
    }

    if (data.channel) {
      (row as unknown as Record<string, unknown>)[data.channel] =
        ObjectID.generate();
    }

    return row;
  }

  async function created(row: UserOnCallLogTimeline): Promise<void> {
    await hook("onCreateSuccess")(
      { createBy: { data: row, props: { isRoot: true } }, carryForward: null },
      row,
    );
  }

  async function updated(
    rows: Array<UserOnCallLogTimeline>,
    data: Record<string, unknown>,
  ): Promise<void> {
    jest
      .spyOn(UserOnCallLogTimelineService, "findBy")
      .mockResolvedValue(rows as never);

    await hook("onUpdateSuccess")(
      {
        updateBy: {
          query: { _id: rows[0]!.id!.toString() },
          data: data,
          props: { isRoot: true },
        },
        carryForward: null,
      },
      rows.map((row: UserOnCallLogTimeline) => {
        return row.id;
      }),
    );
  }

  test("written: its step's list is worked out again - the way a channel joins it", async () => {
    await created(
      delivery({
        step: STEP,
        status: UserNotificationStatus.Sending,
        channel: "userSmsId",
      }),
    );

    expect(refreshed).toEqual([STEP.toString()]);
  });

  test("written as not sent: worked out again too, and leaves it as it was", async () => {
    await created(
      delivery({
        step: STEP,
        status: UserNotificationStatus.Error,
        channel: "userTelegramId",
      }),
    );

    expect(refreshed).toEqual([STEP.toString()]);
  });

  test("given a status - sent, not sent after all, answered: worked out again, once a step", async () => {
    await updated(
      [
        delivery({
          step: STEP,
          status: UserNotificationStatus.Error,
          channel: "userSmsId",
        }),
        delivery({
          step: STEP,
          status: UserNotificationStatus.Error,
          channel: "userEmailId",
        }),
        delivery({
          step: OTHER_STEP,
          status: UserNotificationStatus.Error,
          channel: "userCallId",
        }),
      ],
      { status: UserNotificationStatus.Error },
    );

    expect(refreshed).toEqual([STEP.toString(), OTHER_STEP.toString()]);
  });

  test("a notification of no page, or by no channel, asks for nothing", async () => {
    await created(
      delivery({
        status: UserNotificationStatus.Sending,
        channel: "userSmsId",
      }),
    );
    await created(
      delivery({ step: STEP, status: UserNotificationStatus.Error }),
    );

    expect(refreshed).toEqual([]);
  });

  test("an update that writes no status asks for nothing: no channel comes or goes", async () => {
    await updated(
      [
        delivery({
          step: STEP,
          status: UserNotificationStatus.Sent,
          channel: "userSmsId",
        }),
      ],
      { statusMessage: "Delivered" },
    );

    expect(refreshed).toEqual([]);
  });
});

describe("who can read it", () => {
  function userPermissions(
    permissions: Array<Permission>,
  ): Array<UserPermission> {
    return permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      } as UserPermission;
    });
  }

  function readable(
    modelType:
      | { new (): OnCallDutyPolicyExecutionLogTimeline }
      | {
          new (): UserOnCallLogTimeline;
        },
    permissions: Array<Permission>,
  ): Array<string> {
    const columns: Columns = ColumnPermissions.getModelColumnsByPermissions(
      modelType as never,
      userPermissions(permissions),
      DatabaseRequestType.Read,
    );

    return columns.columns;
  }

  test.each([
    [Permission.ProjectMember],
    [Permission.Viewer],
    [Permission.OnCallViewer],
    [Permission.ReadProjectOnCallDutyPolicyExecutionLogTimeline],
  ])(
    "a project member who cannot read the person's own notifications still reads the step's channels (%s)",
    (permission: Permission) => {
      // The person's own notifications: not theirs to read.
      expect(readable(UserOnCallLogTimeline, [permission])).not.toContain(
        "userSmsId",
      );

      // The step's channels, with the step's other columns.
      const columns: Array<string> = readable(
        OnCallDutyPolicyExecutionLogTimeline,
        [permission],
      );
      expect(columns).toContain("status");
      expect(columns).toContain("notificationChannels");
    },
  );

  test("read as the step's other columns are, and written by OneUptime alone", () => {
    const step: OnCallDutyPolicyExecutionLogTimeline =
      new OnCallDutyPolicyExecutionLogTimeline();
    const access: {
      create: Array<Permission>;
      read: Array<Permission>;
      update: Array<Permission>;
    } = step.getColumnAccessControlFor("notificationChannels")! as never;

    expect(access.read).toEqual(step.getColumnAccessControlFor("status")!.read);
    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
  });

  test("a nullable JSON column, as the migration adds it", () => {
    const step: OnCallDutyPolicyExecutionLogTimeline =
      new OnCallDutyPolicyExecutionLogTimeline();
    expect(step.getTableColumnMetadata("notificationChannels").type).toBe(
      TableColumnType.JSON,
    );

    const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
      .columns.filter((args: ColumnMetadataArgs) => {
        return (
          args.target === OnCallDutyPolicyExecutionLogTimeline &&
          args.propertyName === "notificationChannels"
        );
      })
      .pop();

    expect(column?.options.type).toBe(ColumnType.JSON);
    expect(column?.options.nullable).toBe(true);
    expect(column?.options.default).toBeUndefined();
  });
});

describe("AddNotificationChannelsToOnCallDutyPolicyExecutionLogTimeline1809090065850", () => {
  async function statementsOf(
    run: (runner: QueryRunner) => Promise<void>,
  ): Promise<Array<string>> {
    const sql: Array<string> = [];

    await run({
      query: (text: string): Promise<undefined> => {
        sql.push(text);
        return Promise.resolve(undefined);
      },
    } as unknown as QueryRunner);

    return sql;
  }

  const migration: AddNotificationChannelsToOnCallDutyPolicyExecutionLogTimeline1809090065850 =
    new AddNotificationChannelsToOnCallDutyPolicyExecutionLogTimeline1809090065850();

  test("adds a nullable jsonb column with no default, so no row is rewritten and older steps read as not set", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([
      'ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD "notificationChannels" jsonb',
    ]);
    expect(ColumnType.JSON).toBe("jsonb");
  });

  test("takes it away again", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.down(runner);
      }),
    ).toEqual([
      'ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP COLUMN "notificationChannels"',
    ]);
  });

  test("is named for its class, and registered after every migration before it", () => {
    expect(migration.name).toBe(
      "AddNotificationChannelsToOnCallDutyPolicyExecutionLogTimeline1809090065850",
    );

    const names: Array<string> = SchemaMigrations.map(
      (item: { name: string }) => {
        return item.name;
      },
    );
    const index: number = names.indexOf(
      "AddNotificationChannelsToOnCallDutyPolicyExecutionLogTimeline1809090065850",
    );

    expect(index).toBeGreaterThan(
      names.indexOf("AddCallOutcomeTrackingToCallLog1809090000000"),
    );
    expect(index).toBeGreaterThan(-1);
  });
});

describe("readOnCallPageChannels: the list as a reader takes it from the API", () => {
  test("each known channel once, in the list's order", () => {
    expect(
      readOnCallPageChannels([
        OnCallPageChannel.Email,
        OnCallPageChannel.Call,
        OnCallPageChannel.Email,
      ]),
    ).toEqual([OnCallPageChannel.Call, OnCallPageChannel.Email]);
  });

  test("a channel this build does not know, or anything that is not one, is left out", () => {
    expect(
      readOnCallPageChannels([
        "Carrier Pigeon",
        7,
        null,
        OnCallPageChannel.SMS,
      ]),
    ).toEqual([OnCallPageChannel.SMS]);
  });

  test("an empty list is a page that reached nobody; no list at all is a step that kept none", () => {
    expect(readOnCallPageChannels([])).toEqual([]);
    expect(readOnCallPageChannels(null)).toBeNull();
    expect(readOnCallPageChannels(undefined)).toBeNull();
    expect(readOnCallPageChannels("SMS")).toBeNull();
  });
});
