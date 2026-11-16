import Incident from "Common/Models/DatabaseModels/Incident";
import DatabaseService from "Common/Server/Services/DatabaseService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import { HEARD_ONLY_WHERE_WATCHED_KEY } from "Common/Types/Workflow/WatchedFields";
import {
  OWNER_NOTIFICATION_PAGE_SIZE,
  OwnerNotificationBacklogResult,
} from "../../../FeatureSet/Workers/Utils/OwnerNotificationBacklog";
import OwnerReminderBacklog, {
  DueReminder,
} from "../../../FeatureSet/Workers/Utils/OwnerReminderBacklog";

/*
 * HOW A REMINDER JOB GOES THROUGH THE REMINDERS DUE (issue #9019).
 *
 * The three reminder jobs read every record with a reminder due at once,
 * with no deadline, and moved each reminder on through updateOneById: a
 * read, the write, a realtime event and an On Update workflow trigger, so a
 * workflow that watches no fields ran at every reminder. Now a run reads
 * what is due a page at a time, the longest due first, stops at its
 * deadline, and moves each reminder on with one hook-free compare-and-set
 * that expects both columns as the run read them - so of two runs at once,
 * one moves it and tells of it. A reminder an edit rescheduled since the
 * read still goes out; one whose reminders stopped since does not. Only the
 * workflows that watch the reminder's columns start.
 *
 * Pinned here against a table held in memory that answers the job's
 * statements as Postgres does: the page read (due before the run's start,
 * not left out, the longest due first, a page's worth), the compare-and-set
 * (it moves the record only while it holds every expected value, a time to
 * the millisecond) and the read again. OwnerReminderBacklogPostgres runs
 * them on Postgres.
 */

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

interface Row {
  id: ObjectID;
  projectId: ObjectID;
  nextReminderNotificationAt: Date | null;
  reminderNotificationSentCount: number | null;
}

interface PageRead {
  query: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
  skip: number;
  select: Record<string, unknown>;
}

interface Take {
  id: string;
  data: JSONObject;
  expectedData: JSONObject;
}

// How the fake reads the backlog's query (QueryHelper is spied on below).
interface LessThan {
  lessThan: Date;
}

interface NotIn {
  notIn: Array<string>;
}

const NOW: Date = new Date("2026-11-16T10:00:00.000Z");
const MINUTE: number = 60 * 1000;
const PROJECT_ID: ObjectID = new ObjectID(
  "90190000-0000-4000-8000-000000000001",
);

let rows: Array<Row> = [];
let pageReads: Array<PageRead> = [];
let takes: Array<Take> = [];
let reReads: Array<string> = [];
let workflowPosts: Array<{
  id: string;
  projectId: string;
  triggerType: string;
  miscData: JSONObject;
}> = [];
// Written between the run's read of a record and its first take.
let beforeTake: ((row: Row) => void) | null = null;

function id(index: number): ObjectID {
  return new ObjectID(
    `90190000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`,
  );
}

// Rows whose reminder came due a minute apart, the first the longest ago.
function seed(count: number, sentCount: number | null = 2): Array<Row> {
  rows = Array.from({ length: count }, (_: unknown, index: number): Row => {
    return {
      id: id(index),
      projectId: PROJECT_ID,
      nextReminderNotificationAt: new Date(
        NOW.getTime() - (count - index) * MINUTE,
      ),
      reminderNotificationSentCount: sentCount,
    };
  });

  return rows;
}

function rowOf(rowId: ObjectID | string): Row | undefined {
  return rows.find((row: Row): boolean => {
    return row.id.toString() === rowId.toString();
  });
}

function asRecord(row: Row): Incident {
  const record: Incident = new Incident(row.id);
  record.projectId = row.projectId;
  // As a read hands it: a copy, cut to the millisecond.
  record.nextReminderNotificationAt = row.nextReminderNotificationAt
    ? new Date(row.nextReminderNotificationAt.getTime())
    : (null as unknown as undefined);
  record.reminderNotificationSentCount =
    row.reminderNotificationSentCount as unknown as number;
  return record;
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }

  return (a ?? null) === (b ?? null);
}

const service: {
  findBy: jest.Mock;
  findOneById: jest.Mock;
  compareAndSetColumnsByIdWithoutHooks: jest.Mock;
  onTriggerWorkflow: jest.Mock;
  updateOneById: jest.Mock;
} = {
  findBy: jest.fn(async (data: PageRead): Promise<Array<Incident>> => {
    pageReads.push(data);

    const dueBefore: Date = (
      data.query["nextReminderNotificationAt"] as LessThan
    ).lessThan;
    const leftOut: Array<string> =
      (data.query["_id"] as NotIn | undefined)?.notIn || [];

    return rows
      .filter((row: Row): boolean => {
        return (
          row.nextReminderNotificationAt !== null &&
          row.nextReminderNotificationAt.getTime() < dueBefore.getTime() &&
          !leftOut.includes(row.id.toString())
        );
      })
      .sort((a: Row, b: Row): number => {
        return (
          a.nextReminderNotificationAt!.getTime() -
            b.nextReminderNotificationAt!.getTime() ||
          a.id.toString().localeCompare(b.id.toString())
        );
      })
      .slice(data.skip, data.skip + data.limit)
      .map(asRecord);
  }),
  findOneById: jest.fn(
    async (data: { id: ObjectID }): Promise<Incident | null> => {
      reReads.push(data.id.toString());
      const row: Row | undefined = rowOf(data.id);
      return row ? asRecord(row) : null;
    },
  ),
  compareAndSetColumnsByIdWithoutHooks: jest.fn(
    async (data: {
      id: ObjectID;
      data: JSONObject;
      expectedData: JSONObject;
    }): Promise<boolean> => {
      const written: Row | undefined = rowOf(data.id);

      if (written && beforeTake) {
        const write: (row: Row) => void = beforeTake;
        beforeTake = null;
        write(written);
      }

      // As the table holds it now: gone, if the write took it away.
      const row: Row | undefined = rowOf(data.id);

      takes.push({
        id: data.id.toString(),
        data: data.data,
        expectedData: data.expectedData,
      });

      // One statement: nothing can come between the check and the write.
      if (
        !row ||
        Object.entries(data.expectedData).some(
          ([column, value]: [string, unknown]): boolean => {
            return !same(
              (row as unknown as Record<string, unknown>)[column],
              value,
            );
          },
        )
      ) {
        return false;
      }

      for (const [column, value] of Object.entries(data.data)) {
        (row as unknown as Record<string, unknown>)[column] = value;
      }

      return true;
    },
  ),
  onTriggerWorkflow: jest.fn(
    async (
      recordId: ObjectID,
      projectId: ObjectID,
      triggerType: string,
      miscData: JSONObject,
    ): Promise<void> => {
      workflowPosts.push({
        id: recordId.toString(),
        projectId: projectId.toString(),
        triggerType: triggerType,
        miscData: miscData,
      });
    },
  ),
  // Never: the reminder's bookkeeping goes round the hooks.
  updateOneById: jest.fn(),
};

const incidentService: DatabaseService<Incident> =
  service as unknown as DatabaseService<Incident>;

type Remind = (input: {
  record: Incident;
  reminder: DueReminder<Incident>;
}) => Promise<void>;

function run(data: {
  remind: Remind;
  deadline?: JobDeadline | undefined;
  pageSize?: number | undefined;
}): Promise<OwnerNotificationBacklogResult> {
  return OwnerReminderBacklog.forEachDue<Incident>({
    jobName: "Test:SendUnresolvedReminderNotification",
    service: incidentService,
    select: { title: true },
    deadline: data.deadline,
    pageSize: data.pageSize,
    remind: data.remind,
  });
}

// What a job does with a reminder it is to send: send it, and tell only if it moved it.
function sending(told: Array<string>, intervalInMinutes: number = 30): Remind {
  return async (input: {
    record: Incident;
    reminder: DueReminder<Incident>;
  }): Promise<void> => {
    if (await input.reminder.send(intervalInMinutes)) {
      told.push(input.record.id!.toString());
    }
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  rows = [];
  pageReads = [];
  takes = [];
  reReads = [];
  workflowPosts = [];
  beforeTake = null;

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });

  jest
    .spyOn(QueryHelper, "notIn")
    .mockImplementation((values: Array<string | ObjectID>) => {
      return {
        notIn: values.map((value: string | ObjectID): string => {
          return value.toString();
        }),
      } as never;
    });

  jest.spyOn(QueryHelper, "lessThan").mockImplementation((value: unknown) => {
    return { lessThan: value } as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("reading the reminders due", () => {
  test("reads what is due as of the run's start, the longest due first, a page at a time", async () => {
    // Stored out of the order they came due in.
    seed(250);
    rows.reverse();

    // Due a moment after the run started: the next run's.
    rows.push({
      id: id(900),
      projectId: PROJECT_ID,
      nextReminderNotificationAt: new Date(NOW.getTime() + 1),
      reminderNotificationSentCount: 0,
    });

    const told: Array<string> = [];
    const result: OwnerNotificationBacklogResult = await run({
      remind: sending(told),
    });

    expect(pageReads).toHaveLength(3);

    for (const read of pageReads) {
      expect(
        (read.query["nextReminderNotificationAt"] as LessThan).lessThan,
      ).toEqual(NOW);
      expect(read.sort).toEqual({
        nextReminderNotificationAt: SortOrder.Ascending,
      });
      expect(read.limit).toBe(OWNER_NOTIFICATION_PAGE_SIZE);
      expect(read.skip).toBe(0);
      // The job's columns, and the ones a move compares and names.
      expect(read.select).toEqual({
        title: true,
        projectId: true,
        nextReminderNotificationAt: true,
        reminderNotificationSentCount: true,
        _id: true,
      });
    }

    // Told the longest due first, each once.
    const longestDueFirst: Array<string> = [...rows]
      .filter((row: Row): boolean => {
        return row.id.toString() !== id(900).toString();
      })
      .map((row: Row): string => {
        return row.id.toString();
      })
      .sort();

    expect([...told].sort()).toEqual(longestDueFirst);
    expect(told[0]).toBe(id(0).toString());
    expect(told[249]).toBe(id(249).toString());

    expect(result).toEqual({
      pages: 3,
      read: 250,
      taken: 250,
      takenElsewhere: 0,
      failed: 0,
      stoppedAtDeadline: false,
    });

    // The one due after the run's start is still due.
    expect(rowOf(id(900))!.reminderNotificationSentCount).toBe(0);
    expect(service.updateOneById).not.toHaveBeenCalled();
  });

  test("REGRESSION: a run whose deadline passed reads nothing and moves nothing", async () => {
    seed(10);

    const deadline: JobDeadline = new JobDeadline();
    deadline.end();

    const told: Array<string> = [];
    const result: OwnerNotificationBacklogResult = await run({
      remind: sending(told),
      deadline: deadline,
    });

    expect(result.stoppedAtDeadline).toBe(true);
    expect(pageReads).toHaveLength(0);
    expect(takes).toHaveLength(0);
    expect(told).toEqual([]);
  });

  test("REGRESSION: a deadline that passes part way stops between reminders; the next run sends the rest, each once", async () => {
    seed(30);

    const deadline: JobDeadline = new JobDeadline();
    const told: Array<string> = [];

    const first: OwnerNotificationBacklogResult = await run({
      deadline: deadline,
      remind: async (input: {
        record: Incident;
        reminder: DueReminder<Incident>;
      }): Promise<void> => {
        await sending(told)(input);

        if (told.length === 12) {
          // Its lease is lost as the twelfth reminder goes out.
          deadline.end();
        }
      },
    });

    expect(first.stoppedAtDeadline).toBe(true);
    expect(told).toHaveLength(12);

    // The rest are still due, as they were.
    const stillDue: Array<Row> = rows.filter((row: Row): boolean => {
      return row.reminderNotificationSentCount === 2;
    });
    expect(stillDue).toHaveLength(18);

    const second: OwnerNotificationBacklogResult = await run({
      remind: sending(told),
    });

    expect(second.stoppedAtDeadline).toBe(false);
    expect(told).toHaveLength(30);
    expect(new Set(told).size).toBe(30);

    for (const row of rows) {
      expect(row.reminderNotificationSentCount).toBe(3);
      expect(row.nextReminderNotificationAt).toEqual(
        new Date(NOW.getTime() + 30 * MINUTE),
      );
    }
  });

  test("REGRESSION: two runs at once send each reminder once between them", async () => {
    seed(40);

    const told: Array<string> = [];

    await Promise.all([
      run({ remind: sending(told) }),
      run({ remind: sending(told) }),
    ]);

    expect([...told].sort()).toEqual(
      rows
        .map((row: Row): string => {
          return row.id.toString();
        })
        .sort(),
    );

    for (const row of rows) {
      expect(row.reminderNotificationSentCount).toBe(3);
    }
  });

  test("a reminder this run did not move is left out of the pages after it, and the next run reads it again", async () => {
    seed(5);

    const told: Array<string> = [];
    const result: OwnerNotificationBacklogResult = await run({
      pageSize: 2,
      remind: async (input: {
        record: Incident;
        reminder: DueReminder<Incident>;
      }): Promise<void> => {
        if (input.record.id!.toString() === id(1).toString()) {
          throw new Error("the rule could not be read");
        }

        await sending(told)(input);
      },
    });

    expect(result.failed).toBe(1);
    expect(result.taken).toBe(4);
    // Read once: left out of every page after its own.
    expect(
      pageReads.map((read: PageRead): Array<string> => {
        return (read.query["_id"] as NotIn | undefined)?.notIn || [];
      }),
    ).toEqual([[], [id(1).toString()], [id(1).toString()]]);

    // Still due for the next run.
    expect(rowOf(id(1))!.reminderNotificationSentCount).toBe(2);

    await run({ remind: sending(told) });

    expect(told).toContain(id(1).toString());
    expect(rowOf(id(1))!.reminderNotificationSentCount).toBe(3);
  });
});

describe("moving a reminder on", () => {
  test("REGRESSION: one compare-and-set, expecting both columns as read: the next reminder an interval on, counted", async () => {
    seed(1, 4);
    const dueAt: Date = rows[0]!.nextReminderNotificationAt!;

    const told: Array<string> = [];
    await run({ remind: sending(told, 45) });

    expect(takes).toEqual([
      {
        id: id(0).toString(),
        data: {
          nextReminderNotificationAt: new Date(NOW.getTime() + 45 * MINUTE),
          reminderNotificationSentCount: 5,
        },
        expectedData: {
          nextReminderNotificationAt: dueAt,
          reminderNotificationSentCount: 4,
        },
      },
    ]);
    expect(told).toEqual([id(0).toString()]);
    // Nothing read again: it moved.
    expect(reReads).toEqual([]);
  });

  test("a record never reminded counts from nothing: its first reminder is number 1", async () => {
    seed(1, null);

    const numbers: Array<number> = [];
    await run({
      remind: async (input: {
        record: Incident;
        reminder: DueReminder<Incident>;
      }): Promise<void> => {
        numbers.push(input.reminder.number);
        await input.reminder.send(30);
      },
    });

    expect(numbers).toEqual([1]);
    expect(takes[0]!.expectedData["reminderNotificationSentCount"]).toBeNull();
    expect(rowOf(id(0))!.reminderNotificationSentCount).toBe(1);
  });

  test("REGRESSION: sent by another run since the read, it is not sent again", async () => {
    seed(1, 2);

    beforeTake = (row: Row): void => {
      // The other run moved it first.
      row.reminderNotificationSentCount = 3;
      row.nextReminderNotificationAt = new Date(NOW.getTime() + 30 * MINUTE);
    };

    const told: Array<string> = [];
    const result: OwnerNotificationBacklogResult = await run({
      remind: sending(told),
    });

    expect(told).toEqual([]);
    expect(result.takenElsewhere).toBe(1);
    // Read again, found sent, and left as the other run left it.
    expect(reReads).toEqual([id(0).toString()]);
    expect(takes).toHaveLength(1);
    expect(rowOf(id(0))!.reminderNotificationSentCount).toBe(3);
  });

  test("rescheduled by an edit since the read, with no reminder sent: read again, and sent", async () => {
    seed(1, 2);

    const rescheduledTo: Date = new Date(NOW.getTime() + 15 * MINUTE + 123);

    beforeTake = (row: Row): void => {
      // A new severity matched the reminder rule again, which started the interval over.
      row.nextReminderNotificationAt = rescheduledTo;
    };

    const told: Array<string> = [];
    const result: OwnerNotificationBacklogResult = await run({
      remind: sending(told),
    });

    expect(told).toEqual([id(0).toString()]);
    expect(result.taken).toBe(1);
    expect(takes).toHaveLength(2);
    expect(takes[1]!.expectedData).toEqual({
      nextReminderNotificationAt: rescheduledTo,
      reminderNotificationSentCount: 2,
    });
    expect(rowOf(id(0))!).toEqual({
      id: id(0),
      projectId: PROJECT_ID,
      nextReminderNotificationAt: new Date(NOW.getTime() + 30 * MINUTE),
      reminderNotificationSentCount: 3,
    });
  });

  test("REGRESSION: its reminders stopped since the read - switched off, or no rule matches - it is not sent", async () => {
    seed(1, 2);

    beforeTake = (row: Row): void => {
      row.nextReminderNotificationAt = null;
    };

    const told: Array<string> = [];
    await run({ remind: sending(told) });

    expect(told).toEqual([]);
    expect(takes).toHaveLength(1);
    expect(rowOf(id(0))!.nextReminderNotificationAt).toBeNull();
    expect(rowOf(id(0))!.reminderNotificationSentCount).toBe(2);
  });

  test("gone since the read: nobody is told", async () => {
    seed(1, 2);

    beforeTake = (): void => {
      rows = [];
    };

    const told: Array<string> = [];
    await run({ remind: sending(told) });

    expect(told).toEqual([]);
  });

  test("stopped: the next reminder taken away, from what was read; an edit since stands", async () => {
    seed(2, 2);
    const dueAt: Date = rows[0]!.nextReminderNotificationAt!;
    const edited: Date = new Date(NOW.getTime() + 60 * MINUTE);

    let stops: Array<boolean> = [];

    await run({
      remind: async (input: {
        record: Incident;
        reminder: DueReminder<Incident>;
      }): Promise<void> => {
        if (input.record.id!.toString() === id(1).toString()) {
          beforeTake = (row: Row): void => {
            row.nextReminderNotificationAt = edited;
          };
        }

        stops = [...stops, await input.reminder.stop()];
      },
    });

    expect(stops).toEqual([true, false]);
    expect(takes[0]).toEqual({
      id: id(0).toString(),
      data: { nextReminderNotificationAt: null },
      expectedData: {
        nextReminderNotificationAt: dueAt,
        reminderNotificationSentCount: 2,
      },
    });
    expect(rowOf(id(0))!.nextReminderNotificationAt).toBeNull();
    // The edit that rescheduled it stands; nothing was read again.
    expect(rowOf(id(1))!.nextReminderNotificationAt).toEqual(edited);
    expect(reReads).toEqual([]);
  });

  test("put off: the next reminder later, none sent and none counted", async () => {
    seed(1, 2);
    const startsAt: Date = new Date(NOW.getTime() + 120 * MINUTE);

    await run({
      remind: async (input: {
        record: Incident;
        reminder: DueReminder<Incident>;
      }): Promise<void> => {
        await input.reminder.putOffUntil(startsAt);
      },
    });

    expect(rowOf(id(0))!).toEqual({
      id: id(0),
      projectId: PROJECT_ID,
      nextReminderNotificationAt: startsAt,
      reminderNotificationSentCount: 2,
    });
  });
});

describe("the record's On Update workflows", () => {
  test("REGRESSION: a reminder moved on starts only the workflows that watch its columns", async () => {
    seed(1, 2);

    await run({ remind: sending([]) });

    expect(workflowPosts).toEqual([
      {
        id: id(0).toString(),
        projectId: PROJECT_ID.toString(),
        triggerType: "on-update",
        miscData: {
          // As an update reports the columns it changed (DatabaseService).
          updatedFields: JSONFunctions.serialize({
            nextReminderNotificationAt: new Date(NOW.getTime() + 30 * MINUTE),
            reminderNotificationSentCount: 3,
          } as unknown as JSONObject),
          [HEARD_ONLY_WHERE_WATCHED_KEY]: true,
        },
      },
    ]);
  });

  test("stopped, its watchers hear the next reminder taken away", async () => {
    seed(1, 2);

    await run({
      remind: async (input: {
        record: Incident;
        reminder: DueReminder<Incident>;
      }): Promise<void> => {
        await input.reminder.stop();
      },
    });

    expect(workflowPosts).toHaveLength(1);
    expect(workflowPosts[0]!.miscData).toEqual({
      updatedFields: { nextReminderNotificationAt: null },
      [HEARD_ONLY_WHERE_WATCHED_KEY]: true,
    });
  });

  test("a move another run made first starts nothing: that run started them", async () => {
    seed(1, 2);

    beforeTake = (row: Row): void => {
      row.reminderNotificationSentCount = 3;
    };

    await run({ remind: sending([]) });

    expect(workflowPosts).toEqual([]);
  });

  test("a workflow that cannot be started does not stop the reminder", async () => {
    seed(1, 2);
    service.onTriggerWorkflow.mockRejectedValueOnce(new Error("Redis away"));

    const told: Array<string> = [];
    await run({ remind: sending(told) });

    expect(told).toEqual([id(0).toString()]);
  });
});
