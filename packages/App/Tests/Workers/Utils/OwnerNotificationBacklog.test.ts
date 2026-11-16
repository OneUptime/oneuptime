import MonitorStatusTimeline from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import DatabaseService from "Common/Server/Services/DatabaseService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import OwnerNotificationBacklog, {
  OWNER_NOTIFICATION_LEFT_OUT_AT_MOST,
  OWNER_NOTIFICATION_PAGE_SIZE,
  OwnerNotificationBacklogResult,
  OwnerNotificationPage,
} from "../../../FeatureSet/Workers/Utils/OwnerNotificationBacklog";

/*
 * HOW AN OWNER NOTIFICATION JOB GOES THROUGH WHAT IT HAS STILL TO TELL
 * (issue #7974).
 *
 * The state change jobs read every record not marked notified, every run,
 * and marked each through updateOneById and its every hook. Now each run
 * reads a page at a time, oldest first, takes each record with one
 * hook-free compare-and-set - between planning whom it tells and telling
 * them - and stops at its deadline. Pinned here against a table held in
 * memory that answers the two statements as Postgres does: the page read
 * (not marked, not left out, oldest first, a page's worth) and the
 * compare-and-set (it moves the mark only if it was not moved yet).
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
  createdAt: Date;
  isOwnerNotified: boolean;
}

interface PageRead {
  query: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
  skip: number;
  select: Record<string, unknown>;
}

// The query the backlog leaves records out by, as the fake reads it.
interface LeftOutQuery {
  notIn: Array<string>;
}

let rows: Array<Row> = [];
let pageReads: Array<PageRead> = [];
let takes: Array<{ id: string; data: unknown; expectedData: unknown }> = [];
let takeFailsFor: Set<string> = new Set<string>();

function ids(count: number): Array<ObjectID> {
  return Array.from({ length: count }, (_: unknown, index: number) => {
    return new ObjectID(
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
  });
}

// Rows created one second apart, in the order given.
function seed(count: number): Array<Row> {
  const start: number = Date.UTC(2026, 10, 16, 9, 0, 0);

  rows = ids(count).map((id: ObjectID, index: number): Row => {
    return {
      id: id,
      createdAt: new Date(start + index * 1000),
      isOwnerNotified: false,
    };
  });

  return rows;
}

function rowOf(id: ObjectID | string): Row {
  return rows.find((row: Row): boolean => {
    return row.id.toString() === id.toString();
  })!;
}

const service: {
  findBy: jest.Mock;
  compareAndSetColumnsByIdWithoutHooks: jest.Mock;
  updateOneById: jest.Mock;
} = {
  findBy: jest.fn(async (data: PageRead) => {
    pageReads.push(data);

    const leftOut: Array<string> =
      (data.query["_id"] as LeftOutQuery | undefined)?.notIn || [];

    return rows
      .filter((row: Row): boolean => {
        return (
          row.isOwnerNotified === data.query["isOwnerNotified"] &&
          !leftOut.includes(row.id.toString())
        );
      })
      .sort((a: Row, b: Row): number => {
        return (
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.toString().localeCompare(b.id.toString())
        );
      })
      .slice(data.skip, data.skip + data.limit)
      .map((row: Row): MonitorStatusTimeline => {
        const record: MonitorStatusTimeline = new MonitorStatusTimeline(row.id);
        record.createdAt = row.createdAt;
        return record;
      });
  }),
  compareAndSetColumnsByIdWithoutHooks: jest.fn(
    async (data: {
      id: ObjectID;
      data: { isOwnerNotified: boolean };
      expectedData: { isOwnerNotified: boolean };
    }): Promise<boolean> => {
      takes.push({
        id: data.id.toString(),
        data: data.data,
        expectedData: data.expectedData,
      });

      if (takeFailsFor.has(data.id.toString())) {
        throw new Error("connection reset");
      }

      const row: Row | undefined = rows.find((each: Row): boolean => {
        return each.id.toString() === data.id.toString();
      });

      // One statement: nothing can come between the check and the write.
      if (!row || row.isOwnerNotified !== data.expectedData.isOwnerNotified) {
        return false;
      }

      row.isOwnerNotified = data.data.isOwnerNotified;
      return true;
    },
  ),
  updateOneById: jest.fn(),
};

const timelineService: DatabaseService<MonitorStatusTimeline> =
  service as unknown as DatabaseService<MonitorStatusTimeline>;

type Notify = (input: {
  record: MonitorStatusTimeline;
  page: OwnerNotificationPage;
  take: () => Promise<boolean>;
}) => Promise<void>;

function run(data: {
  notify: Notify;
  deadline?: JobDeadline | undefined;
  pageSize?: number | undefined;
  readPage?:
    | ((
        records: Array<MonitorStatusTimeline>,
        page: OwnerNotificationPage,
      ) => Promise<void>)
    | undefined;
}): Promise<OwnerNotificationBacklogResult> {
  return OwnerNotificationBacklog.forEachToNotify<MonitorStatusTimeline>({
    jobName: "Test:SendStatusChangeEmail",
    service: timelineService,
    notYetNotified: { isOwnerNotified: false },
    notified: { isOwnerNotified: true },
    select: { monitorId: true },
    deadline: data.deadline,
    pageSize: data.pageSize,
    readPage: data.readPage,
    notify: data.notify,
  });
}

// What a job does: plan, take, and tell only what it took.
function telling(told: Array<string>): Notify {
  return async (input: {
    record: MonitorStatusTimeline;
    take: () => Promise<boolean>;
  }): Promise<void> => {
    if (await input.take()) {
      told.push(input.record.id!.toString());
    }
  };
}

function nextTick(): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  rows = [];
  pageReads = [];
  takes = [];
  takeFailsFor = new Set<string>();

  jest
    .spyOn(QueryHelper, "notIn")
    .mockImplementation((values: Array<string | ObjectID>) => {
      return {
        notIn: values.map((value: string | ObjectID): string => {
          return value.toString();
        }),
      } as never;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("reading what is still to tell", () => {
  test("reads only what is not marked yet, oldest first, a page at a time", async () => {
    // Created out of the order they are stored in.
    seed(250);
    rows.reverse();

    const told: Array<string> = [];
    const result: OwnerNotificationBacklogResult = await run({
      notify: telling(told),
    });

    expect(pageReads).toHaveLength(3);

    for (const read of pageReads) {
      expect(read.query["isOwnerNotified"]).toBe(false);
      expect(read.sort).toEqual({ createdAt: SortOrder.Ascending });
      expect(read.limit).toBe(OWNER_NOTIFICATION_PAGE_SIZE);
      expect(read.skip).toBe(0);
      // The job's columns, and the id the take needs.
      expect(read.select).toEqual({ monitorId: true, _id: true });
    }

    // Each page is what the pages before it left: nothing read twice.
    const oldestFirst: Array<string> = [...rows]
      .sort((a: Row, b: Row): number => {
        return a.createdAt.getTime() - b.createdAt.getTime();
      })
      .map((row: Row): string => {
        return row.id.toString();
      });

    expect(told).toEqual(oldestFirst);
    expect(result).toEqual({
      pages: 3,
      read: 250,
      taken: 250,
      takenElsewhere: 0,
      failed: 0,
      stoppedAtDeadline: false,
    });
  });

  test("a run with nothing to tell reads one page and writes nothing", async () => {
    const result: OwnerNotificationBacklogResult = await run({
      notify: telling([]),
    });

    expect(pageReads).toHaveLength(1);
    expect(takes).toHaveLength(0);
    expect(result.read).toBe(0);
  });

  test("a short page is the last: no further read", async () => {
    seed(OWNER_NOTIFICATION_PAGE_SIZE - 1);

    await run({ notify: telling([]) });

    expect(pageReads).toHaveLength(1);
  });

  test("a full page is followed by one more read", async () => {
    seed(OWNER_NOTIFICATION_PAGE_SIZE);

    await run({ notify: telling([]) });

    expect(pageReads).toHaveLength(2);
  });
});

describe("taking a record", () => {
  test("is one hook-free compare-and-set of the mark, never updateOneById", async () => {
    const [row] = seed(1);
    const told: Array<string> = [];

    await run({ notify: telling(told) });

    expect(takes).toEqual([
      {
        id: row!.id.toString(),
        data: { isOwnerNotified: true },
        expectedData: { isOwnerNotified: false },
      },
    ]);
    expect(service.updateOneById).not.toHaveBeenCalled();
    expect(rowOf(row!.id).isOwnerNotified).toBe(true);
    expect(told).toEqual([row!.id.toString()]);
  });

  test("is made after the job has planned, and before it tells", async () => {
    seed(1);
    const order: Array<string> = [];

    await run({
      notify: async (input: { take: () => Promise<boolean> }) => {
        order.push("plan");
        const isTaken: boolean = await input.take();
        order.push(isTaken ? "tell" : "skip");
      },
    });

    expect(order).toEqual(["plan", "tell"]);
    expect(
      service.compareAndSetColumnsByIdWithoutHooks.mock.invocationCallOrder,
    ).toHaveLength(1);
  });

  test("asked for twice by one job, is one statement and one answer", async () => {
    seed(1);
    const answers: Array<boolean> = [];

    await run({
      notify: async (input: { take: () => Promise<boolean> }) => {
        answers.push(await input.take());
        answers.push(await input.take());
      },
    });

    expect(takes).toHaveLength(1);
    expect(answers).toEqual([true, true]);
  });

  test("a record another run marked first is not this run's to tell", async () => {
    const [row] = seed(1);
    const told: Array<string> = [];

    const result: OwnerNotificationBacklogResult = await run({
      notify: async (input: {
        record: MonitorStatusTimeline;
        take: () => Promise<boolean>;
      }) => {
        // Another run takes it between this run's read and its take.
        rowOf(row!.id).isOwnerNotified = true;
        await telling(told)(input as never);
      },
    });

    expect(told).toEqual([]);
    expect(result.taken).toBe(0);
    expect(result.takenElsewhere).toBe(1);
  });
});

describe("two runs at once", () => {
  /*
   * A run that lost its lease goes on beside the next one (CronLock). Both
   * read the same page before either takes anything: each record is taken
   * once between them, and only the run that took it tells its owners.
   */
  test("take each record once, and tell each once between them", async () => {
    seed(250);
    const told: Array<string> = [];

    // Each job yields between its plan and its take, so the runs interleave.
    const interleaved: Notify = async (input: {
      record: MonitorStatusTimeline;
      page: OwnerNotificationPage;
      take: () => Promise<boolean>;
    }): Promise<void> => {
      await nextTick();
      await telling(told)(input);
    };

    const [first, second] = await Promise.all([
      run({ notify: interleaved }),
      run({ notify: interleaved }),
    ]);

    const once: Map<string, number> = new Map<string, number>();

    for (const id of told) {
      once.set(id, (once.get(id) || 0) + 1);
    }

    expect(told).toHaveLength(250);
    expect(
      Array.from(once.values()).every((count: number) => {
        return count === 1;
      }),
    ).toBe(true);
    expect(first!.taken + second!.taken).toBe(250);
    expect(
      rows.every((row: Row): boolean => {
        return row.isOwnerNotified;
      }),
    ).toBe(true);
    // They did read the same records: the loser of each found it taken.
    expect(first!.takenElsewhere + second!.takenElsewhere).toBeGreaterThan(0);
  });
});

describe("the run's deadline", () => {
  test("stops it between records; what it did not reach stays unmarked, and the next run starts with it", async () => {
    seed(30);
    const deadline: JobDeadline = new JobDeadline();
    const told: Array<string> = [];

    const result: OwnerNotificationBacklogResult = await run({
      deadline: deadline,
      notify: async (input: {
        record: MonitorStatusTimeline;
        page: OwnerNotificationPage;
        take: () => Promise<boolean>;
      }) => {
        await telling(told)(input);

        if (told.length === 12) {
          deadline.end();
        }
      },
    });

    expect(told).toEqual(
      rows.slice(0, 12).map((row: Row): string => {
        return row.id.toString();
      }),
    );
    expect(result.stoppedAtDeadline).toBe(true);
    expect(result.taken).toBe(12);
    // Nothing after the deadline was taken, or even asked about.
    expect(takes).toHaveLength(12);
    expect(
      rows.slice(12).every((row: Row): boolean => {
        return !row.isOwnerNotified;
      }),
    ).toBe(true);

    // The next run takes up exactly the rest, oldest first, each once.
    const next: Array<string> = [];
    await run({ notify: telling(next) });

    expect(next).toEqual(
      rows.slice(12).map((row: Row): string => {
        return row.id.toString();
      }),
    );
  });

  test("a deadline that passed before the run reads nothing at all", async () => {
    seed(5);
    const deadline: JobDeadline = new JobDeadline();
    deadline.end();

    const result: OwnerNotificationBacklogResult = await run({
      deadline: deadline,
      notify: telling([]),
    });

    expect(pageReads).toHaveLength(0);
    expect(takes).toHaveLength(0);
    expect(result.stoppedAtDeadline).toBe(true);
  });

  test("a deadline that passes mid-page leaves the rest of the page, and reads no next page", async () => {
    seed(OWNER_NOTIFICATION_PAGE_SIZE + 10);
    const deadline: JobDeadline = new JobDeadline();
    let notified: number = 0;

    await run({
      deadline: deadline,
      notify: async (input: { take: () => Promise<boolean> }) => {
        notified++;
        await input.take();

        if (notified === 40) {
          deadline.end();
        }
      },
    });

    expect(pageReads).toHaveLength(1);
    expect(notified).toBe(40);
  });
});

describe("a record whose job fails", () => {
  test("before the take: logged, left out of the run's next pages, and the next run tells it", async () => {
    seed(OWNER_NOTIFICATION_PAGE_SIZE + 5);
    const failing: Row = rows[3]!;
    const told: Array<string> = [];

    const result: OwnerNotificationBacklogResult = await run({
      notify: async (input: {
        record: MonitorStatusTimeline;
        page: OwnerNotificationPage;
        take: () => Promise<boolean>;
      }) => {
        if (input.record.id!.toString() === failing.id.toString()) {
          throw new Error("could not read its owners");
        }

        await telling(told)(input);
      },
    });

    expect(result.failed).toBe(1);
    expect(logger.error).toHaveBeenCalled();
    expect(failing.isOwnerNotified).toBe(false);
    expect(told).not.toContain(failing.id.toString());
    expect(told).toHaveLength(OWNER_NOTIFICATION_PAGE_SIZE + 4);

    // The second page left it out, by id.
    expect(pageReads[1]!.query["_id"]).toEqual({
      notIn: [failing.id.toString()],
    });

    const next: Array<string> = [];
    await run({ notify: telling(next) });

    expect(next).toEqual([failing.id.toString()]);
  });

  test("in the take itself: logged, left out, and taken by the next run", async () => {
    const [failing, other] = seed(2);
    takeFailsFor.add(failing!.id.toString());
    const told: Array<string> = [];

    const result: OwnerNotificationBacklogResult = await run({
      notify: telling(told),
    });

    expect(result.failed).toBe(1);
    expect(result.taken).toBe(1);
    expect(told).toEqual([other!.id.toString()]);

    takeFailsFor.clear();
    const next: Array<string> = [];
    await run({ notify: telling(next) });

    expect(next).toEqual([failing!.id.toString()]);
  });

  test("after the take: still taken, so no run tells it again", async () => {
    const [row] = seed(1);

    const result: OwnerNotificationBacklogResult = await run({
      notify: async (input: { take: () => Promise<boolean> }) => {
        await input.take();
        throw new Error("the email provider is down");
      },
    });

    expect(result.taken).toBe(1);
    expect(result.failed).toBe(1);
    expect(row!.isOwnerNotified).toBe(true);

    const next: Array<string> = [];
    await run({ notify: telling(next) });
    expect(next).toEqual([]);
  });

  test("on every record: the run stops once too many were left out", async () => {
    seed(OWNER_NOTIFICATION_LEFT_OUT_AT_MOST + 300);

    const result: OwnerNotificationBacklogResult = await run({
      notify: async () => {
        throw new Error("the database is down");
      },
    });

    expect(result.read).toBe(OWNER_NOTIFICATION_LEFT_OUT_AT_MOST);
    expect(result.failed).toBe(OWNER_NOTIFICATION_LEFT_OUT_AT_MOST);
    expect(takes).toHaveLength(0);
  });
});

describe("what a page reads once", () => {
  test("readPage runs once per page, before its records, and what it primes the records get without a read of their own", async () => {
    seed(OWNER_NOTIFICATION_PAGE_SIZE + 20);
    const pages: Array<number> = [];
    const ownReads: Array<string> = [];

    await run({
      readPage: async (
        records: Array<MonitorStatusTimeline>,
        page: OwnerNotificationPage,
      ) => {
        pages.push(records.length);

        for (const record of records) {
          page.prime(`monitor:${record.id!.toString()}`, "read with the page");
        }
      },
      notify: async (input: {
        record: MonitorStatusTimeline;
        page: OwnerNotificationPage;
        take: () => Promise<boolean>;
      }) => {
        const answer: string = await input.page.once(
          `monitor:${input.record.id!.toString()}`,
          async () => {
            ownReads.push(input.record.id!.toString());
            return "read on its own";
          },
        );

        expect(answer).toBe("read with the page");
        await input.take();
      },
    });

    expect(pages).toEqual([OWNER_NOTIFICATION_PAGE_SIZE, 20]);
    expect(ownReads).toEqual([]);
  });

  test("a readPage that fails leaves each record to read its own", async () => {
    seed(3);
    const ownReads: Array<string> = [];

    const result: OwnerNotificationBacklogResult = await run({
      readPage: async () => {
        throw new Error("too many ids");
      },
      notify: async (input: {
        record: MonitorStatusTimeline;
        page: OwnerNotificationPage;
        take: () => Promise<boolean>;
      }) => {
        await input.page.once(`monitor:${input.record.id!.toString()}`, () => {
          ownReads.push(input.record.id!.toString());
          return Promise.resolve(null);
        });
        await input.take();
      },
    });

    expect(ownReads).toHaveLength(3);
    expect(result.taken).toBe(3);
  });

  test("each page reads afresh: what one page read is not handed to the next", async () => {
    seed(OWNER_NOTIFICATION_PAGE_SIZE + 1);
    let ownerReads: number = 0;

    await run({
      notify: async (input: {
        page: OwnerNotificationPage;
        take: () => Promise<boolean>;
      }) => {
        // Every record of the table is of one monitor.
        await input.page.once("owners:monitor-1", async () => {
          ownerReads++;
          return [];
        });
        await input.take();
      },
    });

    expect(ownerReads).toBe(2);
  });
});

describe("OwnerNotificationPage", () => {
  test("reads each key once, however many ask, at once or after", async () => {
    const page: OwnerNotificationPage = new OwnerNotificationPage();
    const read: jest.Mock = jest.fn(async () => {
      await nextTick();
      return ["owner-1"];
    });

    const answers: Array<Array<string>> = await Promise.all([
      page.once("owners:1", read),
      page.once("owners:1", read),
    ]);

    expect(await page.once("owners:1", read)).toEqual(["owner-1"]);
    expect(answers).toEqual([["owner-1"], ["owner-1"]]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("keeps keys apart", async () => {
    const page: OwnerNotificationPage = new OwnerNotificationPage();

    expect(
      await page.once("owners:1", async () => {
        return 1;
      }),
    ).toBe(1);
    expect(
      await page.once("owners:2", async () => {
        return 2;
      }),
    ).toBe(2);
  });

  test("does not keep a read that failed: the next to ask reads again", async () => {
    const page: OwnerNotificationPage = new OwnerNotificationPage();
    const read: jest.Mock = jest
      .fn()
      .mockRejectedValueOnce(new Error("timeout") as never)
      .mockResolvedValueOnce("owners" as never);

    await expect(page.once("owners:1", read as never)).rejects.toThrow(
      "timeout",
    );
    await nextTick();

    expect(await page.once("owners:1", read as never)).toBe("owners");
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("hands what was primed without reading", async () => {
    const page: OwnerNotificationPage = new OwnerNotificationPage();
    const read: jest.Mock = jest.fn();

    page.prime("monitor:1", { name: "Checkout API" });

    expect(await page.once("monitor:1", read as never)).toEqual({
      name: "Checkout API",
    });
    expect(read).not.toHaveBeenCalled();
    expect(page.has("monitor:1")).toBe(true);
    expect(page.has("monitor:2")).toBe(false);
  });
});
