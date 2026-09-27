import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationInterruption from "Common/Types/StatusPage/SubscriberNotificationInterruption";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import SubscriberNotificationTiming from "Common/Server/Utils/StatusPage/SubscriberNotificationTiming";
import fs from "fs";
import path from "path";
import { FindOperator } from "typeorm";
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

// Every notification column the sweep covers, and what Retry does after it.
interface CoveredColumn {
  name: string;
  service: unknown;
  statusColumn: string;
  messageColumn: string;
  message: string;
}

const COVERED: Array<CoveredColumn> = [
  {
    name: "incident created",
    service: IncidentService,
    statusColumn: "subscriberNotificationStatusOnIncidentCreated",
    messageColumn: "subscriberNotificationStatusMessage",
    // Resumes after the pages it recorded as told.
    message: SubscriberNotificationInterruption.resumesMessage,
  },
  {
    name: "incident postmortem",
    service: IncidentService,
    statusColumn: "subscriberNotificationStatusOnPostmortemPublished",
    messageColumn: "subscriberNotificationStatusMessageOnPostmortemPublished",
    message: SubscriberNotificationInterruption.resendsMessage,
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
 * - the status column equal to the value asked for, and updatedAt before the
 * cutoff its lessThan carries - so a test sees which rows the sweep's query
 * would reach.
 */
let tables: Map<unknown, Array<StoredRow>> = new Map();

function cutoffOf(query: JSONObject): Date {
  const operator: FindOperator<unknown> = query[
    "updatedAt"
  ] as unknown as FindOperator<unknown>;
  const parameters: Array<unknown> = Object.values(
    operator.objectLiteralParameters || {},
  );

  return parameters[0] as Date;
}

function fakeFindBy(service: unknown) {
  return async (args: unknown): Promise<Array<unknown>> => {
    const findBy: {
      query: JSONObject;
      limit: number;
      select: JSONObject;
    } = args as { query: JSONObject; limit: number; select: JSONObject };
    const cutoff: Date = cutoffOf(findBy.query);

    const statusQuery: Array<[string, unknown]> = Object.entries(
      findBy.query,
    ).filter(([key]: [string, unknown]): boolean => {
      return key !== "updatedAt";
    });

    return (tables.get(service) || [])
      .filter((row: StoredRow): boolean => {
        return (
          row.updatedAt.getTime() < cutoff.getTime() &&
          statusQuery.every(([key, value]: [string, unknown]): boolean => {
            return row[key] === value;
          })
        );
      })
      .slice(0, findBy.limit)
      .map((row: StoredRow): unknown => {
        return {
          _id: row._id,
          id: new ObjectID(row._id),
          version: row.version,
        };
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
  },
): StoredRow {
  const row: StoredRow = {
    _id: `00000000-0000-4000-8000-${(nextRowNumber++).toString().padStart(12, "0")}`,
    version: data.version ?? 3,
    updatedAt: data.updatedAt,
    [column.statusColumn]: data.status,
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

  test("asks each table for In progress rows last updated before the job timeout plus the margin", async () => {
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

      const cutoff: number = cutoffOf(query).getTime();
      expect(cutoff).toBeGreaterThanOrEqual(
        before - SubscriberNotificationTiming.STUCK_AFTER_IN_MS,
      );
      expect(cutoff).toBeLessThanOrEqual(
        after - SubscriberNotificationTiming.STUCK_AFTER_IN_MS,
      );

      expect(queries[0]!["limit"]).toBe(MAX_STUCK_NOTIFICATIONS_PER_TABLE);
      expect(queries[0]!["props"]).toEqual({ isRoot: true });
      expect(queries[0]!["select"]).toEqual({ _id: true, version: true });
    }
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
