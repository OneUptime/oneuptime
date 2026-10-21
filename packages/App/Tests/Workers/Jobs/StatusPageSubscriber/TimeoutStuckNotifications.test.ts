import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationInterruption from "Common/Types/StatusPage/SubscriberNotificationInterruption";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import SubscriberNotificationTiming from "Common/Server/Utils/StatusPage/SubscriberNotificationTiming";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A subscriber notification is sent inside one queue job. Kill the Worker
 * holding it and the row says "Notifications being sent" forever: the jobs
 * only pick up Pending rows, and the dashboard only offers Retry on a Failed
 * one. This suite drives the sweep that ends that state, and pins what makes
 * it safe: it touches only rows In progress for longer than any live send
 * can take, and fails each with a compare-and-set, so a send that settles at
 * the last moment is never overwritten.
 *
 * The job registers itself via RunCron at import time, so the Cron util is
 * mocked to capture the handler and its options, and each test drives one
 * tick against in-memory rows.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};
const mockCapturedOptions: Record<string, unknown> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
        mockCapturedOptions[jobName] = options;
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

function mockService(): unknown {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      compareAndSetColumnsByIdWithoutHooks: jest.fn(),
    },
  };
}

jest.mock("Common/Server/Services/IncidentService", () => {
  return mockService();
});
jest.mock("Common/Server/Services/IncidentStateTimelineService", () => {
  return mockService();
});
jest.mock("Common/Server/Services/IncidentPublicNoteService", () => {
  return mockService();
});
jest.mock("Common/Server/Services/IncidentEpisodeService", () => {
  return mockService();
});
jest.mock("Common/Server/Services/IncidentEpisodeStateTimelineService", () => {
  return mockService();
});
jest.mock("Common/Server/Services/IncidentEpisodePublicNoteService", () => {
  return mockService();
});
jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return mockService();
});
jest.mock(
  "Common/Server/Services/ScheduledMaintenanceStateTimelineService",
  () => {
    return mockService();
  },
);
jest.mock(
  "Common/Server/Services/ScheduledMaintenancePublicNoteService",
  () => {
    return mockService();
  },
);
jest.mock("Common/Server/Services/StatusPageAnnouncementService", () => {
  return mockService();
});

// Imported AFTER the mocks above (jest hoists them) so the job registers into the recorder.
import {
  MAX_STUCK_NOTIFICATIONS_PER_TABLE,
  STUCK_NOTIFICATION_COLUMNS,
} from "../../../../FeatureSet/Workers/Jobs/StatusPageSubscriber/TimeoutStuckNotifications";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import IncidentPublicNoteService from "Common/Server/Services/IncidentPublicNoteService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "Common/Server/Services/IncidentEpisodeStateTimelineService";
import IncidentEpisodePublicNoteService from "Common/Server/Services/IncidentEpisodePublicNoteService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "Common/Server/Services/ScheduledMaintenanceStateTimelineService";
import ScheduledMaintenancePublicNoteService from "Common/Server/Services/ScheduledMaintenancePublicNoteService";
import StatusPageAnnouncementService from "Common/Server/Services/StatusPageAnnouncementService";
import logger from "Common/Server/Utils/Logger";

const JOB_NAME: string = "StatusPageSubscriber:TimeoutStuckNotifications";

function mock(fn: unknown): jest.Mock {
  return fn as jest.Mock;
}

/*
 * Every notification column the sweep covers, what Retry does after it (for
 * a row stored with nothing else), and the column its claim stamps, for the
 * rows other code writes while they are being sent.
 */
interface CoveredColumn {
  name: string;
  service: unknown;
  statusColumn: string;
  messageColumn: string;
  message: string;
  claimedAtColumn?: string | undefined;
}

const COVERED: Array<CoveredColumn> = [
  {
    name: "incident created",
    service: IncidentService,
    statusColumn: "subscriberNotificationStatusOnIncidentCreated",
    messageColumn: "subscriberNotificationStatusMessage",
    /*
     * A row stored without a record of told pages: Retry sends to every
     * page. With one, it resumes after them (tested below).
     */
    message: SubscriberNotificationInterruption.resendsMessage,
    claimedAtColumn: "subscriberNotificationClaimedAtOnIncidentCreated",
  },
  {
    name: "incident postmortem",
    service: IncidentService,
    statusColumn: "subscriberNotificationStatusOnPostmortemPublished",
    messageColumn: "subscriberNotificationStatusMessageOnPostmortemPublished",
    message: SubscriberNotificationInterruption.resendsMessage,
    claimedAtColumn: "subscriberNotificationClaimedAtOnPostmortemPublished",
  },
  {
    name: "incident state change",
    service: IncidentStateTimelineService,
    statusColumn: "subscriberNotificationStatus",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
  },
  {
    name: "incident public note created",
    service: IncidentPublicNoteService,
    statusColumn: "subscriberNotificationStatusOnNoteCreated",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
  },
  {
    name: "incident public note updated",
    service: IncidentPublicNoteService,
    statusColumn: "subscriberNotificationStatusOnNoteUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnNoteUpdated",
    message: SubscriberNotificationInterruption.resendsMessage,
  },
  {
    name: "episode created",
    service: IncidentEpisodeService,
    statusColumn: "subscriberNotificationStatusOnEpisodeCreated",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
    claimedAtColumn: "subscriberNotificationClaimedAtOnEpisodeCreated",
  },
  {
    name: "episode state change",
    service: IncidentEpisodeStateTimelineService,
    statusColumn: "subscriberNotificationStatus",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
  },
  {
    name: "episode public note created",
    service: IncidentEpisodePublicNoteService,
    statusColumn: "subscriberNotificationStatusOnNoteCreated",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
  },
  {
    name: "episode public note updated",
    service: IncidentEpisodePublicNoteService,
    statusColumn: "subscriberNotificationStatusOnNoteUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnNoteUpdated",
    message: SubscriberNotificationInterruption.resendsMessage,
  },
  {
    name: "scheduled maintenance created",
    service: ScheduledMaintenanceService,
    statusColumn: "subscriberNotificationStatusOnEventScheduled",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
  },
  {
    name: "scheduled maintenance state change",
    service: ScheduledMaintenanceStateTimelineService,
    statusColumn: "subscriberNotificationStatus",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
  },
  {
    name: "scheduled maintenance public note created",
    service: ScheduledMaintenancePublicNoteService,
    statusColumn: "subscriberNotificationStatusOnNoteCreated",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
  },
  {
    name: "scheduled maintenance public note updated",
    service: ScheduledMaintenancePublicNoteService,
    statusColumn: "subscriberNotificationStatusOnNoteUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnNoteUpdated",
    message: SubscriberNotificationInterruption.resendsMessage,
  },
  {
    name: "announcement created",
    service: StatusPageAnnouncementService,
    statusColumn: "subscriberNotificationStatus",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
  },
  {
    name: "announcement updated",
    service: StatusPageAnnouncementService,
    statusColumn: "subscriberNotificationStatusOnAnnouncementUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnAnnouncementUpdated",
    message: SubscriberNotificationInterruption.resendsMessage,
  },
];

const SERVICES: Array<unknown> = Array.from(
  new Set(
    COVERED.map((column: CoveredColumn): unknown => {
      return column.service;
    }),
  ),
);

// One row as the fake table holds it.
interface StoredRow {
  _id: string;
  version: number;
  updatedAt: Date;
  [column: string]: unknown;
}

/*
 * The rows of each service's table. findBy applies the sweep's query to them
 * - the status column equal to the value asked for, a time column before
 * the cutoff its lessThan carries, a column its isNull asks to be empty - so
 * a test sees which rows the sweep's query would reach.
 */
let tables: Map<unknown, Array<StoredRow>> = new Map();

/*
 * What the sweep's lessThan and isNull build (typeorm Raw FindOperators), as
 * far as these tests read them: typeorm is Common's, not App's
 * (TestImportsResolveFromApp). A lessThan carries its value as a parameter;
 * an isNull carries none.
 */
interface QueryOperator {
  objectLiteralParameters?: Record<string, unknown> | undefined;
}

function isOperator(value: unknown): value is QueryOperator {
  return typeof value === "object" && value !== null;
}

function lessThanOf(value: unknown): Date | null {
  if (!isOperator(value)) {
    return null;
  }

  const parameters: Array<unknown> = Object.values(
    value.objectLiteralParameters || {},
  );

  return parameters[0] instanceof Date ? parameters[0] : null;
}

// The cutoff of the query's time condition, whichever column it is on.
function cutoffOf(query: JSONObject): Date {
  for (const value of Object.values(query)) {
    const cutoff: Date | null = lessThanOf(value);

    if (cutoff) {
      return cutoff;
    }
  }

  throw new Error("The query has no time condition.");
}

function matches(row: StoredRow, key: string, value: unknown): boolean {
  if (!isOperator(value)) {
    return row[key] === value;
  }

  const cutoff: Date | null = lessThanOf(value);

  if (cutoff) {
    return (
      row[key] instanceof Date &&
      (row[key] as Date).getTime() < cutoff.getTime()
    );
  }

  // isNull
  return row[key] === undefined || row[key] === null;
}

function fakeFindBy(service: unknown) {
  return async (args: unknown): Promise<Array<unknown>> => {
    const findBy: {
      query: JSONObject;
      limit: number;
      select: JSONObject;
    } = args as { query: JSONObject; limit: number; select: JSONObject };

    return (tables.get(service) || [])
      .filter((row: StoredRow): boolean => {
        return Object.entries(findBy.query).every(
          ([key, value]: [string, unknown]): boolean => {
            return matches(row, key, value);
          },
        );
      })
      .slice(0, findBy.limit)
      .map((row: StoredRow): unknown => {
        const read: JSONObject = {
          _id: row._id,
          id: new ObjectID(row._id),
          version: row.version,
        } as unknown as JSONObject;

        for (const key of Object.keys(findBy.select || {})) {
          if (!(key in read) && key in row) {
            read[key] = row[key] as never;
          }
        }

        return read;
      });
  };
}

// The compare-and-set, applied to the fake table as Postgres would.
function fakeCompareAndSet(service: unknown) {
  return async (args: unknown): Promise<boolean> => {
    const input: { id: ObjectID; data: JSONObject; expectedData: JSONObject } =
      args as { id: ObjectID; data: JSONObject; expectedData: JSONObject };

    const row: StoredRow | undefined = (tables.get(service) || []).find(
      (item: StoredRow): boolean => {
        return item._id === input.id.toString();
      },
    );

    if (
      !row ||
      !Object.entries(input.expectedData).every(
        ([key, value]: [string, unknown]): boolean => {
          return row[key] === value;
        },
      )
    ) {
      return false;
    }

    Object.assign(row, input.data);
    return true;
  };
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

let nextRowNumber: number = 1;

function storeRow(
  column: CoveredColumn,
  data: {
    status: StatusPageSubscriberNotificationStatus;
    updatedAt: Date;
    version?: number;
    // When the claim stamped the column's claimed-at time, if it has one.
    claimedAt?: Date;
    extra?: Record<string, unknown>;
  },
): StoredRow {
  const row: StoredRow = {
    _id: `00000000-0000-4000-8000-${(nextRowNumber++).toString().padStart(12, "0")}`,
    version: data.version ?? 3,
    updatedAt: data.updatedAt,
    [column.statusColumn]: data.status,
    ...(data.claimedAt && column.claimedAtColumn
      ? { [column.claimedAtColumn]: data.claimedAt }
      : {}),
    ...(data.extra || {}),
  };

  const table: Array<StoredRow> = tables.get(column.service) || [];
  table.push(row);
  tables.set(column.service, table);

  return row;
}

const JUST_PAST_STUCK: number =
  SubscriberNotificationTiming.STUCK_AFTER_IN_MS / 60_000 + 1;

function runTick(): Promise<void> {
  return mockCapturedJobs[JOB_NAME]!();
}

beforeEach(() => {
  jest.clearAllMocks();
  tables = new Map();

  for (const service of SERVICES) {
    const target: {
      findBy: unknown;
      compareAndSetColumnsByIdWithoutHooks: unknown;
    } = service as {
      findBy: unknown;
      compareAndSetColumnsByIdWithoutHooks: unknown;
    };
    mock(target.findBy).mockImplementation(fakeFindBy(service) as never);
    mock(target.compareAndSetColumnsByIdWithoutHooks).mockImplementation(
      fakeCompareAndSet(service) as never,
    );
  }
});

describe("StatusPageSubscriber:TimeoutStuckNotifications", () => {
  test("runs every five minutes", () => {
    expect(mockCapturedOptions[JOB_NAME]).toEqual(
      expect.objectContaining({
        schedule: EVERY_FIVE_MINUTE,
        runOnStartup: false,
      }),
    );
  });

  test("App/FeatureSet/Workers/Index.ts carries the side-effect import, without which nothing schedules it", () => {
    const indexSource: string = fs.readFileSync(
      path.join(__dirname, "../../../../FeatureSet/Workers/Index.ts"),
      { encoding: "utf-8" },
    );

    expect(indexSource).toContain(
      'import "./Jobs/StatusPageSubscriber/TimeoutStuckNotifications";',
    );
  });

  test("takes a notification to be stuck only well after the job timeout", () => {
    // Longer than any live send: its window, its last answers and its settle.
    expect(SubscriberNotificationTiming.STUCK_AFTER_IN_MS).toBeGreaterThan(
      SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS,
    );
    expect(SubscriberNotificationTiming.STUCK_AFTER_IN_MS).toBeGreaterThan(
      SubscriberNotificationTiming.NOTIFICATION_MAX_IN_MS,
    );
  });

  test("covers every notification column, each once", () => {
    expect(
      STUCK_NOTIFICATION_COLUMNS.map((column: { name: string }): string => {
        return column.name;
      }),
    ).toEqual(
      COVERED.map((column: CoveredColumn): string => {
        return column.name;
      }),
    );
  });

  describe.each(COVERED)("the $name notification", (column: CoveredColumn) => {
    test("a stale In progress one becomes Failed, with the interruption and what Retry does", async () => {
      const row: StoredRow = storeRow(column, {
        status: StatusPageSubscriberNotificationStatus.InProgress,
        updatedAt: minutesAgo(JUST_PAST_STUCK),
        version: 9,
      });

      await runTick();

      expect(row[column.statusColumn]).toBe(
        StatusPageSubscriberNotificationStatus.Failed,
      );
      expect(row[column.messageColumn]).toBe(column.message);
      expect(
        SubscriberNotificationInterruption.isInterruptedMessage(
          row[column.messageColumn] as string,
        ),
      ).toBe(true);

      // Failed with a compare-and-set on its status and the version read.
      const writes: Array<JSONObject> = mock(
        (
          column.service as {
            compareAndSetColumnsByIdWithoutHooks: unknown;
          }
        ).compareAndSetColumnsByIdWithoutHooks,
      ).mock.calls.map((call: Array<unknown>): JSONObject => {
        return call[0] as JSONObject;
      });
      const write: JSONObject | undefined = writes.find(
        (item: JSONObject): boolean => {
          return (item["id"] as ObjectID).toString() === row._id;
        },
      );

      expect(write).toEqual({
        id: new ObjectID(row._id),
        data: {
          [column.statusColumn]: StatusPageSubscriberNotificationStatus.Failed,
          [column.messageColumn]: column.message,
        },
        expectedData: {
          [column.statusColumn]:
            StatusPageSubscriberNotificationStatus.InProgress,
          version: 9,
        },
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`The ${column.name} subscriber notification`),
        expect.anything(),
      );
    });

    test("a fresh In progress one is left alone: its send may still be running", async () => {
      const row: StoredRow = storeRow(column, {
        status: StatusPageSubscriberNotificationStatus.InProgress,
        // Past the job timeout, but not past the margin.
        updatedAt: minutesAgo(
          SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS / 60_000 + 1,
        ),
      });

      await runTick();

      expect(row[column.statusColumn]).toBe(
        StatusPageSubscriberNotificationStatus.InProgress,
      );
      expect(row[column.messageColumn]).toBeUndefined();
    });

    test.each([
      StatusPageSubscriberNotificationStatus.Pending,
      StatusPageSubscriberNotificationStatus.Success,
      StatusPageSubscriberNotificationStatus.Failed,
      StatusPageSubscriberNotificationStatus.Skipped,
    ])("an old %s one is left alone", async (status: string) => {
      const row: StoredRow = storeRow(column, {
        status: status as StatusPageSubscriberNotificationStatus,
        updatedAt: minutesAgo(JUST_PAST_STUCK * 10),
      });

      await runTick();

      expect(row[column.statusColumn]).toBe(status);
      expect(row[column.messageColumn]).toBeUndefined();
    });
  });

  test("asks each table for In progress rows claimed, or last updated, before the job timeout plus the margin", async () => {
    const before: number = Date.now();
    await runTick();
    const after: number = Date.now();

    for (const column of COVERED) {
      const queries: Array<JSONObject> = mock(
        (column.service as { findBy: unknown }).findBy,
      )
        .mock.calls.map((call: Array<unknown>): JSONObject => {
          return call[0] as JSONObject;
        })
        .filter((call: JSONObject): boolean => {
          return column.statusColumn in (call["query"] as JSONObject);
        });

      expect(queries.length).toBeGreaterThanOrEqual(1);

      const query: JSONObject = queries[0]!["query"] as JSONObject;
      expect(query[column.statusColumn]).toBe(
        StatusPageSubscriberNotificationStatus.InProgress,
      );

      // Timed from the claim where the claim stamps a column, else updatedAt.
      expect(Object.keys(query).sort()).toEqual(
        [column.statusColumn, column.claimedAtColumn || "updatedAt"].sort(),
      );

      const cutoff: number = cutoffOf(query).getTime();
      expect(cutoff).toBeGreaterThanOrEqual(
        before - SubscriberNotificationTiming.STUCK_AFTER_IN_MS,
      );
      expect(cutoff).toBeLessThanOrEqual(
        after - SubscriberNotificationTiming.STUCK_AFTER_IN_MS,
      );

      expect(queries[0]!["limit"]).toBe(MAX_STUCK_NOTIFICATIONS_PER_TABLE);
      expect(queries[0]!["props"]).toEqual({ isRoot: true });
      expect(queries[0]!["select"]).toEqual(
        expect.objectContaining({ _id: true, version: true }),
      );
    }
  });

  /*
   * The incident and episode rows are written on a schedule by other code
   * while they are open - the owners' reminder job every interval, state
   * changes, incidents joining an episode - so updatedAt keeps moving. A
   * send cut off by a redeploy must still be failed on time, so Retry,
   * Resend and the added-pages notification are not held up until the
   * incident goes quiet.
   */
  describe.each(
    COVERED.filter((column: CoveredColumn): boolean => {
      return Boolean(column.claimedAtColumn);
    }),
  )(
    "the $name notification, which other code writes while it is sent",
    (column: CoveredColumn) => {
      test("is timed from its claim, not from updatedAt: one claimed long ago is failed although the row was written a minute ago", async () => {
        const row: StoredRow = storeRow(column, {
          status: StatusPageSubscriberNotificationStatus.InProgress,
          // The reminder job wrote the incident a minute ago.
          updatedAt: minutesAgo(1),
          claimedAt: minutesAgo(JUST_PAST_STUCK),
        });

        await runTick();

        expect(row[column.statusColumn]).toBe(
          StatusPageSubscriberNotificationStatus.Failed,
        );
      });

      test("one claimed recently is left alone, however long ago the row was last written", async () => {
        const row: StoredRow = storeRow(column, {
          status: StatusPageSubscriberNotificationStatus.InProgress,
          updatedAt: minutesAgo(JUST_PAST_STUCK * 3),
          claimedAt: minutesAgo(5),
        });

        await runTick();

        expect(row[column.statusColumn]).toBe(
          StatusPageSubscriberNotificationStatus.InProgress,
        );
      });

      test("one claimed before the column existed is timed from updatedAt, as before", async () => {
        const stale: StoredRow = storeRow(column, {
          status: StatusPageSubscriberNotificationStatus.InProgress,
          updatedAt: minutesAgo(JUST_PAST_STUCK),
        });
        const fresh: StoredRow = storeRow(column, {
          status: StatusPageSubscriberNotificationStatus.InProgress,
          updatedAt: minutesAgo(5),
        });

        await runTick();

        expect(stale[column.statusColumn]).toBe(
          StatusPageSubscriberNotificationStatus.Failed,
        );
        expect(fresh[column.statusColumn]).toBe(
          StatusPageSubscriberNotificationStatus.InProgress,
        );
      });
    },
  );

  /*
   * Retry resumes the incident created notification after the pages its
   * record lists. A row with no record - the send stopped before it
   * finished a page, or a version before the record left it stuck - is sent
   * again to every page, and its message must say that, not promise Retry
   * skips the pages already told.
   */
  describe("what the incident created notification says Retry will do", () => {
    const column: CoveredColumn = COVERED[0]!;

    test("with a record of the pages it told, Retry resumes after them", async () => {
      const row: StoredRow = storeRow(column, {
        status: StatusPageSubscriberNotificationStatus.InProgress,
        updatedAt: minutesAgo(JUST_PAST_STUCK),
        extra: {
          statusPagesNotifiedOnCreation: [
            "5b000000-0000-4000-8000-000000000003",
          ],
        },
      });

      await runTick();

      expect(row[column.messageColumn]).toBe(
        SubscriberNotificationInterruption.resumesMessage,
      );
    });

    test("with an empty record, Retry still resumes: nobody was recorded as told", async () => {
      const row: StoredRow = storeRow(column, {
        status: StatusPageSubscriberNotificationStatus.InProgress,
        updatedAt: minutesAgo(JUST_PAST_STUCK),
        claimedAt: minutesAgo(JUST_PAST_STUCK),
        extra: { statusPagesNotifiedOnCreation: [] },
      });

      await runTick();

      expect(row[column.messageColumn]).toBe(
        SubscriberNotificationInterruption.resumesMessage,
      );
    });

    test("with no record at all, Retry sends to every page, and the message says so", async () => {
      const row: StoredRow = storeRow(column, {
        status: StatusPageSubscriberNotificationStatus.InProgress,
        updatedAt: minutesAgo(JUST_PAST_STUCK),
        extra: { statusPagesNotifiedOnCreation: null },
      });

      await runTick();

      expect(row[column.messageColumn]).toBe(
        SubscriberNotificationInterruption.resendsMessage,
      );
    });

    test("reads the record with the stuck rows", async () => {
      await runTick();

      const select: JSONObject = mock(
        (column.service as { findBy: unknown }).findBy,
      )
        .mock.calls.map((call: Array<unknown>): JSONObject => {
          return call[0] as JSONObject;
        })
        .find((call: JSONObject): boolean => {
          return column.statusColumn in (call["query"] as JSONObject);
        })!["select"] as JSONObject;

      expect(select["statusPagesNotifiedOnCreation"]).toBe(true);
    });
  });

  test("a send that settles just before the write keeps its outcome", async () => {
    const column: CoveredColumn = COVERED[0]!;
    const row: StoredRow = storeRow(column, {
      status: StatusPageSubscriberNotificationStatus.InProgress,
      updatedAt: minutesAgo(JUST_PAST_STUCK),
      version: 4,
    });

    // The send settles between the sweep's read and its write.
    const service: { findBy: unknown } = column.service as {
      findBy: unknown;
    };
    const read: (args: unknown) => Promise<Array<unknown>> = fakeFindBy(
      column.service,
    );
    mock(service.findBy).mockImplementation((async (args: unknown) => {
      const rows: Array<unknown> = await read(args);
      row[column.statusColumn] = StatusPageSubscriberNotificationStatus.Success;
      row.version = 5;
      return rows;
    }) as never);

    await runTick();

    expect(row[column.statusColumn]).toBe(
      StatusPageSubscriberNotificationStatus.Success,
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("a table that cannot be read does not stop the sweep of the others", async () => {
    const broken: CoveredColumn = COVERED[2]!;
    mock((broken.service as { findBy: unknown }).findBy).mockRejectedValue(
      new Error("relation does not exist") as never,
    );

    const rows: Array<[CoveredColumn, StoredRow]> = [
      COVERED[0]!,
      COVERED[5]!,
    ].map((column: CoveredColumn): [CoveredColumn, StoredRow] => {
      return [
        column,
        storeRow(column, {
          status: StatusPageSubscriberNotificationStatus.InProgress,
          updatedAt: minutesAgo(JUST_PAST_STUCK),
        }),
      ];
    });

    await runTick();

    for (const [column, row] of rows) {
      expect(row[column.statusColumn]).toBe(
        StatusPageSubscriberNotificationStatus.Failed,
      );
    }
    expect(logger.error).toHaveBeenCalled();
  });

  test("a row that cannot be written does not stop the others", async () => {
    const column: CoveredColumn = COVERED[3]!;
    const first: StoredRow = storeRow(column, {
      status: StatusPageSubscriberNotificationStatus.InProgress,
      updatedAt: minutesAgo(JUST_PAST_STUCK),
    });
    const second: StoredRow = storeRow(column, {
      status: StatusPageSubscriberNotificationStatus.InProgress,
      updatedAt: minutesAgo(JUST_PAST_STUCK),
    });

    const write: (args: unknown) => Promise<boolean> = fakeCompareAndSet(
      column.service,
    );
    mock(
      (column.service as { compareAndSetColumnsByIdWithoutHooks: unknown })
        .compareAndSetColumnsByIdWithoutHooks,
    ).mockImplementation((async (args: unknown) => {
      if ((args as { id: ObjectID }).id.toString() === first._id) {
        throw new Error("deadlock detected");
      }

      return await write(args);
    }) as never);

    await runTick();

    expect(first[column.statusColumn]).toBe(
      StatusPageSubscriberNotificationStatus.InProgress,
    );
    expect(second[column.statusColumn]).toBe(
      StatusPageSubscriberNotificationStatus.Failed,
    );
  });

  test("sweeps at most a bounded number of rows per table per tick", async () => {
    const column: CoveredColumn = COVERED[0]!;

    for (let i: number = 0; i < MAX_STUCK_NOTIFICATIONS_PER_TABLE + 5; i++) {
      storeRow(column, {
        status: StatusPageSubscriberNotificationStatus.InProgress,
        updatedAt: minutesAgo(JUST_PAST_STUCK),
      });
    }

    await runTick();

    const failed: number = (tables.get(column.service) || []).filter(
      (row: StoredRow): boolean => {
        return (
          row[column.statusColumn] ===
          StatusPageSubscriberNotificationStatus.Failed
        );
      },
    ).length;

    expect(failed).toBe(MAX_STUCK_NOTIFICATIONS_PER_TABLE);
  });
});
