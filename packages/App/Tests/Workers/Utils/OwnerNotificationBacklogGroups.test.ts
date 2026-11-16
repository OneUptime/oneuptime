import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseService from "Common/Server/Services/DatabaseService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import OwnerNotificationBacklog, {
  OWNER_NOTIFICATION_PAGE_SIZE,
  OwnerNotificationBacklogResult,
  OwnerNotificationGroup,
  OwnerNotificationGroupResult,
  OwnerNotificationGroupTable,
  OwnerNotificationPage,
} from "../../../FeatureSet/Workers/Utils/OwnerNotificationBacklog";

/*
 * WHAT A JOB TELLS OF TOGETHER, TOLD OF TOGETHER, HOWEVER THE RUN STOPS
 * (issue #8862).
 *
 * An owner-added job tells each person a record's new owner rows name once,
 * team rows and user rows alike, and an episode's members-added job tells
 * its owners of every member added since its last run in one notification.
 * Before the backlog each read every row not marked yet, every run, and
 * marked each through updateOneById and its every hook. Now
 * forEachGroupToNotify reads a page at a time, oldest first, hands the job
 * every row of a record still to tell - of each table - together, takes
 * each by one hook-free compare-and-set, and stops between groups at its
 * deadline. Pinned here against tables held in memory that answer the
 * statements as Postgres does.
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
  recordId: ObjectID | null;
  createdAt: Date;
  isOwnerNotified: boolean;
}

interface Read {
  table: string;
  query: Record<string, unknown>;
  limit: number;
  select: Record<string, unknown>;
}

// How the fakes read the query operators the backlog builds.
interface InQuery {
  in: Array<string>;
}

interface NotInQuery {
  notIn: Array<string>;
}

let reads: Array<Read> = [];
let takes: Array<{ table: string; id: string }> = [];
let takeFailsFor: Set<string> = new Set<string>();

// One table held in memory: its rows, and the two statements the backlog makes.
class FakeTable {
  public rows: Array<Row> = [];

  public readonly service: {
    findBy: jest.Mock;
    compareAndSetColumnsByIdWithoutHooks: jest.Mock;
  };

  public constructor(public readonly name: string) {
    this.service = {
      findBy: jest.fn(
        async (data: {
          query: Record<string, unknown>;
          limit: number;
          skip: number;
          select: Record<string, unknown>;
        }) => {
          reads.push({
            table: this.name,
            query: data.query,
            limit: data.limit,
            select: data.select,
          });

          return this.rows
            .filter((row: Row): boolean => {
              return this.matches(row, data.query);
            })
            .sort((a: Row, b: Row): number => {
              return (
                a.createdAt.getTime() - b.createdAt.getTime() ||
                a.id.toString().localeCompare(b.id.toString())
              );
            })
            .slice(data.skip, data.skip + data.limit)
            .map((row: Row): BaseModel => {
              const record: BaseModel = new BaseModel(row.id);
              record.createdAt = row.createdAt;
              (record as unknown as Record<string, unknown>)["recordId"] =
                row.recordId || undefined;
              return record;
            });
        },
      ),
      compareAndSetColumnsByIdWithoutHooks: jest.fn(
        async (data: {
          id: ObjectID;
          data: { isOwnerNotified: boolean };
          expectedData: { isOwnerNotified: boolean };
        }): Promise<boolean> => {
          takes.push({ table: this.name, id: data.id.toString() });

          if (takeFailsFor.has(data.id.toString())) {
            throw new Error("connection reset");
          }

          const row: Row | undefined = this.rows.find((each: Row): boolean => {
            return each.id.toString() === data.id.toString();
          });

          // One statement: nothing comes between the check and the write.
          if (
            !row ||
            row.isOwnerNotified !== data.expectedData.isOwnerNotified
          ) {
            return false;
          }

          row.isOwnerNotified = data.data.isOwnerNotified;
          return true;
        },
      ),
    };
  }

  public add(data: { recordId: ObjectID | null; at: number }): Row {
    const row: Row = {
      id: new ObjectID(
        `${this.name === "team" ? "aaaaaaaa" : "bbbbbbbb"}-0000-4000-8000-${String(
          this.rows.length,
        ).padStart(12, "0")}`,
      ),
      recordId: data.recordId,
      createdAt: new Date(START + data.at * 1000),
      isOwnerNotified: false,
    };

    this.rows.push(row);
    return row;
  }

  public table(): OwnerNotificationGroupTable {
    return {
      service: this.service as unknown as DatabaseService<BaseModel>,
      notYetNotified: { isOwnerNotified: false } as never,
      notified: { isOwnerNotified: true } as never,
      select: { teamId: true } as never,
    };
  }

  private matches(row: Row, query: Record<string, unknown>): boolean {
    if (row.isOwnerNotified !== query["isOwnerNotified"]) {
      return false;
    }

    const leftOut: Array<string> =
      (query["_id"] as NotInQuery | undefined)?.notIn || [];

    if (leftOut.includes(row.id.toString())) {
      return false;
    }

    const recordQuery: unknown = query["recordId"];

    if (recordQuery === undefined) {
      return true;
    }

    const wanted: Array<string> =
      recordQuery instanceof ObjectID
        ? [recordQuery.toString()]
        : (recordQuery as InQuery).in;

    return Boolean(row.recordId && wanted.includes(row.recordId.toString()));
  }
}

const START: number = Date.UTC(2026, 10, 16, 9, 0, 0);

const RECORD_A: ObjectID = new ObjectID("cccccccc-0000-4000-8000-00000000000a");
const RECORD_B: ObjectID = new ObjectID("cccccccc-0000-4000-8000-00000000000b");
const RECORD_C: ObjectID = new ObjectID("cccccccc-0000-4000-8000-00000000000c");

let teamTable: FakeTable;
let userTable: FakeTable;

// What a job saw of one group, and what it took of it.
interface Told {
  recordId: string;
  rows: Array<Array<string>>;
  taken: Array<Array<string>>;
}

function idsOf(rows: Array<BaseModel>): Array<string> {
  return rows.map((row: BaseModel): string => {
    return row.id!.toString();
  });
}

type Notify = (input: {
  group: OwnerNotificationGroup;
  page: OwnerNotificationPage;
  take: () => Promise<Array<Array<BaseModel>>>;
}) => Promise<void>;

// A job that plans, takes the group, and tells of the rows it took.
function telling(told: Array<Told>): Notify {
  return async (input: {
    group: OwnerNotificationGroup;
    take: () => Promise<Array<Array<BaseModel>>>;
  }): Promise<void> => {
    const taken: Array<Array<BaseModel>> = await input.take();

    told.push({
      recordId: input.group.recordId.toString(),
      rows: input.group.rows.map(idsOf),
      taken: taken.map(idsOf),
    });
  };
}

function run(data: {
  notify: Notify;
  tables?: Array<FakeTable> | undefined;
  deadline?: JobDeadline | undefined;
  pageSize?: number | undefined;
  groupRowsAtMost?: number | undefined;
  readPage?:
    | ((
        recordIds: Array<ObjectID>,
        page: OwnerNotificationPage,
      ) => Promise<void>)
    | undefined;
}): Promise<OwnerNotificationGroupResult> {
  return OwnerNotificationBacklog.forEachGroupToNotify({
    jobName: "Test:SendOwnerAddedEmail",
    recordIdColumn: "recordId",
    tables: (data.tables || [teamTable, userTable]).map(
      (table: FakeTable): OwnerNotificationGroupTable => {
        return table.table();
      },
    ),
    deadline: data.deadline,
    pageSize: data.pageSize,
    groupRowsAtMost: data.groupRowsAtMost,
    readPage: data.readPage,
    notify: data.notify,
  });
}

function unmarked(table: FakeTable): Array<string> {
  return table.rows
    .filter((row: Row): boolean => {
      return !row.isOwnerNotified;
    })
    .map((row: Row): string => {
      return row.id.toString();
    });
}

function nextTick(): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  reads = [];
  takes = [];
  takeFailsFor = new Set<string>();
  teamTable = new FakeTable("team");
  userTable = new FakeTable("user");

  jest
    .spyOn(QueryHelper, "notIn")
    .mockImplementation((values: Array<string | ObjectID>) => {
      return {
        notIn: values.map((value: string | ObjectID): string => {
          return value.toString();
        }),
      } as never;
    });

  jest
    .spyOn(QueryHelper, "any")
    .mockImplementation((values: Array<string | ObjectID | number>) => {
      return {
        in: values.map((value: string | ObjectID | number): string => {
          return value.toString();
        }),
      } as never;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a record's rows still to tell, told of together", () => {
  test("every row of a record, of each table, is handed to the job once, oldest first, and each taken once", async () => {
    const teamA: Row = teamTable.add({ recordId: RECORD_A, at: 1 });
    const teamB: Row = teamTable.add({ recordId: RECORD_B, at: 2 });
    const userA1: Row = userTable.add({ recordId: RECORD_A, at: 3 });
    const userA2: Row = userTable.add({ recordId: RECORD_A, at: 4 });
    const userC: Row = userTable.add({ recordId: RECORD_C, at: 5 });

    const told: Array<Told> = [];
    const result: OwnerNotificationGroupResult = await run({
      notify: telling(told),
    });

    expect(told).toEqual([
      {
        recordId: RECORD_A.toString(),
        rows: [
          [teamA.id.toString()],
          [userA1.id.toString(), userA2.id.toString()],
        ],
        taken: [
          [teamA.id.toString()],
          [userA1.id.toString(), userA2.id.toString()],
        ],
      },
      {
        recordId: RECORD_B.toString(),
        rows: [[teamB.id.toString()], []],
        taken: [[teamB.id.toString()], []],
      },
      // A record with user rows only is a group of the second table.
      {
        recordId: RECORD_C.toString(),
        rows: [[], [userC.id.toString()]],
        taken: [[], [userC.id.toString()]],
      },
    ]);

    // One hook-free compare-and-set per row, and none twice.
    expect(takes).toHaveLength(5);
    expect(
      new Set<string>(
        takes.map((take: { id: string }): string => {
          return take.id;
        }),
      ).size,
    ).toBe(5);
    expect(unmarked(teamTable)).toEqual([]);
    expect(unmarked(userTable)).toEqual([]);
    expect(result.groups).toBe(3);
    expect(result.stoppedAtDeadline).toBe(false);
  });

  test("the groups of a page are read with one query per table, not one per record", async () => {
    for (let index: number = 0; index < 30; index++) {
      const recordId: ObjectID = new ObjectID(
        `dddddddd-0000-4000-8000-${String(index).padStart(12, "0")}`,
      );
      teamTable.add({ recordId: recordId, at: index });
      userTable.add({ recordId: recordId, at: 100 + index });
    }

    const told: Array<Told> = [];
    await run({ notify: telling(told) });

    expect(told).toHaveLength(30);

    /*
     * The team page; its 30 records' rows of both tables, together; and the
     * user page, which finds them all taken.
     */
    expect(
      reads.map((read: Read): string => {
        return read.table;
      }),
    ).toEqual(["team", "team", "user", "user"]);
    expect((reads[1]!.query["recordId"] as InQuery).in).toHaveLength(30);
  });

  test("the rows a group took are not handed to the job again, nor taken again, though they sit on the page", async () => {
    const first: Row = teamTable.add({ recordId: RECORD_A, at: 1 });
    const second: Row = teamTable.add({ recordId: RECORD_A, at: 2 });
    const third: Row = teamTable.add({ recordId: RECORD_A, at: 3 });

    const told: Array<Told> = [];
    const result: OwnerNotificationGroupResult = await run({
      tables: [teamTable],
      notify: telling(told),
    });

    expect(told).toHaveLength(1);
    expect(told[0]!.taken).toEqual([
      [first.id.toString(), second.id.toString(), third.id.toString()],
    ]);
    expect(takes).toHaveLength(3);
    // The backlog counts each as this run's: no statement more.
    expect(result.tables[0]!.taken).toBe(3);
    expect(result.tables[0]!.takenElsewhere).toBe(0);
  });

  test("a record's rows on later pages are taken with its first row's group, and never read again", async () => {
    for (
      let index: number = 0;
      index < OWNER_NOTIFICATION_PAGE_SIZE + 20;
      index++
    ) {
      teamTable.add({ recordId: RECORD_A, at: index });
    }

    const told: Array<Told> = [];
    await run({ tables: [teamTable], notify: telling(told) });

    expect(told).toHaveLength(1);
    expect(told[0]!.taken[0]).toHaveLength(OWNER_NOTIFICATION_PAGE_SIZE + 20);
    expect(unmarked(teamTable)).toEqual([]);
  });

  test("a row that names no record is taken, and never handed to the job", async () => {
    teamTable.add({ recordId: null, at: 1 });
    const named: Row = teamTable.add({ recordId: RECORD_A, at: 2 });

    const told: Array<Told> = [];
    await run({ tables: [teamTable], notify: telling(told) });

    expect(told).toEqual([
      {
        recordId: RECORD_A.toString(),
        rows: [[named.id.toString()]],
        taken: [[named.id.toString()]],
      },
    ]);
    expect(unmarked(teamTable)).toEqual([]);
  });

  test("readPage is handed the page's records, once each, before their groups", async () => {
    teamTable.add({ recordId: RECORD_A, at: 1 });
    teamTable.add({ recordId: RECORD_A, at: 2 });
    teamTable.add({ recordId: RECORD_B, at: 3 });

    const pages: Array<Array<string>> = [];
    const order: Array<string> = [];

    await run({
      tables: [teamTable],
      readPage: async (recordIds: Array<ObjectID>) => {
        order.push("readPage");
        pages.push(
          recordIds.map((recordId: ObjectID): string => {
            return recordId.toString();
          }),
        );
      },
      notify: async (input: {
        group: OwnerNotificationGroup;
        take: () => Promise<Array<Array<BaseModel>>>;
      }) => {
        order.push(`notify ${input.group.recordId.toString()}`);
        await input.take();
      },
    });

    expect(pages).toEqual([[RECORD_A.toString(), RECORD_B.toString()]]);
    expect(order).toEqual([
      "readPage",
      `notify ${RECORD_A.toString()}`,
      `notify ${RECORD_B.toString()}`,
    ]);
  });
});

describe("a group bigger than one read", () => {
  test("holds its oldest rows, and the rest are a group of their own", async () => {
    for (let index: number = 0; index < 5; index++) {
      teamTable.add({ recordId: RECORD_A, at: index });
    }

    const told: Array<Told> = [];
    await run({
      tables: [teamTable],
      groupRowsAtMost: 3,
      notify: telling(told),
    });

    expect(
      told.map((each: Told): number => {
        return each.taken[0]!.length;
      }),
    ).toEqual([3, 2]);
    expect(told[0]!.taken[0]).toEqual(
      teamTable.rows.slice(0, 3).map((row: Row): string => {
        return row.id.toString();
      }),
    );
    expect(unmarked(teamTable)).toEqual([]);
  });

  /*
   * Regression: a row past the end of a full group, on the same page, was
   * taken as "taken by another run" - marked, and never told of.
   */
  test("a row past a full group's end is told of with the next group, never taken untold", async () => {
    for (let index: number = 0; index < 7; index++) {
      teamTable.add({ recordId: RECORD_A, at: index });
    }

    const told: Array<Told> = [];
    await run({
      tables: [teamTable],
      groupRowsAtMost: 3,
      notify: telling(told),
    });

    const toldOf: Array<string> = told.flatMap((each: Told) => {
      return each.taken.flat();
    });

    expect(
      told.map((each: Told): number => {
        return each.taken[0]!.length;
      }),
    ).toEqual([3, 3, 1]);
    expect(toldOf).toEqual(
      teamTable.rows.map((row: Row): string => {
        return row.id.toString();
      }),
    );
  });

  test("a row behind older rows whose job failed, in a full group, is left untouched for a later run", async () => {
    for (let index: number = 0; index < 5; index++) {
      teamTable.add({ recordId: RECORD_A, at: index });
    }

    await run({
      tables: [teamTable],
      groupRowsAtMost: 3,
      notify: async () => {
        throw new Error("could not read the record");
      },
    });

    // Nothing taken: not the failed group's rows, nor the two behind them.
    expect(takes).toEqual([]);
    expect(unmarked(teamTable)).toHaveLength(5);

    const told: Array<Told> = [];
    await run({
      tables: [teamTable],
      groupRowsAtMost: 3,
      notify: telling(told),
    });

    expect(
      told.flatMap((each: Told) => {
        return each.taken.flat();
      }),
    ).toHaveLength(5);
    expect(unmarked(teamTable)).toEqual([]);
  });

  test("a row another run took before its own group was read is counted as taken there, with no statement", async () => {
    teamTable.add({ recordId: RECORD_A, at: 1 });
    const takenElsewhere: Row = teamTable.add({ recordId: RECORD_B, at: 2 });

    const told: Array<Told> = [];
    const result: OwnerNotificationGroupResult = await run({
      tables: [teamTable],
      // The page's groups fill one read: each record reads its own.
      groupRowsAtMost: 2,
      notify: async (input: {
        group: OwnerNotificationGroup;
        page: OwnerNotificationPage;
        take: () => Promise<Array<Array<BaseModel>>>;
      }) => {
        await telling(told)(input);
        // Another run takes the next record's row meanwhile.
        takenElsewhere.isOwnerNotified = true;
      },
    });

    expect(
      told.map((each: Told): string => {
        return each.recordId;
      }),
    ).toEqual([RECORD_A.toString()]);
    expect(
      takes.map((take: { id: string }): string => {
        return take.id;
      }),
    ).not.toContain(takenElsewhere.id.toString());
    expect(result.tables[0]!.takenElsewhere).toBe(1);
  });

  test("a page whose groups fill one read reads each record's group on its own", async () => {
    teamTable.add({ recordId: RECORD_A, at: 1 });
    teamTable.add({ recordId: RECORD_A, at: 2 });
    teamTable.add({ recordId: RECORD_B, at: 3 });

    const told: Array<Told> = [];
    await run({
      tables: [teamTable],
      groupRowsAtMost: 3,
      notify: telling(told),
    });

    // The page, the read of every group (full), then each group's own.
    expect(reads).toHaveLength(4);
    expect(
      told.map((each: Told): number => {
        return each.taken[0]!.length;
      }),
    ).toEqual([2, 1]);
  });
});

describe("the run's deadline", () => {
  test("stops the run between groups, never inside one; the next run tells of the rest", async () => {
    const teamA: Row = teamTable.add({ recordId: RECORD_A, at: 1 });
    teamTable.add({ recordId: RECORD_B, at: 2 });
    const userA: Row = userTable.add({ recordId: RECORD_A, at: 3 });
    const userB: Row = userTable.add({ recordId: RECORD_B, at: 4 });

    const deadline: JobDeadline = new JobDeadline();
    const told: Array<Told> = [];

    const result: OwnerNotificationGroupResult = await run({
      deadline: deadline,
      notify: async (input: {
        group: OwnerNotificationGroup;
        page: OwnerNotificationPage;
        take: () => Promise<Array<Array<BaseModel>>>;
      }) => {
        await telling(told)(input);
        // The lease is lost while the first group is told.
        deadline.end();
      },
    });

    expect(result.stoppedAtDeadline).toBe(true);
    // The first group whole: its user row too, though its table was not reached.
    expect(told).toEqual([
      {
        recordId: RECORD_A.toString(),
        rows: [[teamA.id.toString()], [userA.id.toString()]],
        taken: [[teamA.id.toString()], [userA.id.toString()]],
      },
    ]);
    expect(unmarked(userTable)).toEqual([userB.id.toString()]);

    const next: Array<Told> = [];
    await run({ notify: telling(next) });

    expect(
      next.map((each: Told): string => {
        return each.recordId;
      }),
    ).toEqual([RECORD_B.toString()]);
    // Its team row and its user row, together, once.
    expect(next[0]!.taken[1]).toEqual([userB.id.toString()]);
    expect(unmarked(teamTable)).toEqual([]);
    expect(unmarked(userTable)).toEqual([]);
  });

  test("a deadline that passed before the run reads nothing", async () => {
    teamTable.add({ recordId: RECORD_A, at: 1 });
    const deadline: JobDeadline = new JobDeadline();
    deadline.end();

    const told: Array<Told> = [];
    const result: OwnerNotificationGroupResult = await run({
      deadline: deadline,
      notify: telling(told),
    });

    expect(reads).toHaveLength(0);
    expect(told).toEqual([]);
    expect(result.stoppedAtDeadline).toBe(true);
  });
});

describe("two runs at once", () => {
  /*
   * A run that lost its lease goes on beside the next (CronLock). Both read
   * the same pages before either takes anything: each row is taken once
   * between them, and a group's rows are told of by the run that took them.
   */
  test("take each row once, and tell of each once between them", async () => {
    for (let index: number = 0; index < 40; index++) {
      const recordId: ObjectID = new ObjectID(
        `eeeeeeee-0000-4000-8000-${String(index % 15).padStart(12, "0")}`,
      );
      teamTable.add({ recordId: recordId, at: index });
      userTable.add({ recordId: recordId, at: 100 + index });
    }

    const told: Array<Told> = [];
    const interleaved: Notify = async (input: {
      group: OwnerNotificationGroup;
      page: OwnerNotificationPage;
      take: () => Promise<Array<Array<BaseModel>>>;
    }): Promise<void> => {
      await nextTick();
      await telling(told)(input);
    };

    await Promise.all([
      run({ notify: interleaved }),
      run({ notify: interleaved }),
    ]);

    const toldOf: Array<string> = told.flatMap((each: Told) => {
      return each.taken.flat();
    });

    expect(toldOf).toHaveLength(80);
    expect(new Set<string>(toldOf).size).toBe(80);
    expect(unmarked(teamTable)).toEqual([]);
    expect(unmarked(userTable)).toEqual([]);
  });

  test("a row another run took since its page was read is not handed to the job", async () => {
    const taken: Row = teamTable.add({ recordId: RECORD_A, at: 1 });
    const other: Row = teamTable.add({ recordId: RECORD_B, at: 2 });

    const told: Array<Told> = [];
    const result: OwnerNotificationGroupResult = await run({
      tables: [teamTable],
      readPage: async () => {
        // Another run takes it between this run's page and its groups.
        taken.isOwnerNotified = true;
      },
      notify: telling(told),
    });

    /*
     * The groups were read with the page (before readPage), so the group of
     * RECORD_A still names the row: its take finds it taken.
     */
    expect(
      told.map((each: Told): Array<Array<string>> => {
        return each.taken;
      }),
    ).toEqual([[[]], [[other.id.toString()]]]);
    expect(result.tables[0]!.takenElsewhere).toBe(1);
  });
});

describe("a group whose job fails", () => {
  test("before the take: logged, every row of the group left as it was, and the next run tells of them together", async () => {
    const teamA: Row = teamTable.add({ recordId: RECORD_A, at: 1 });
    const userA: Row = userTable.add({ recordId: RECORD_A, at: 2 });

    const result: OwnerNotificationGroupResult = await run({
      notify: async () => {
        throw new Error("could not read the incident");
      },
    });

    expect(logger.error).toHaveBeenCalled();
    expect(takes).toEqual([]);
    expect(result.tables[0]!.failed).toBe(1);
    expect(unmarked(teamTable)).toEqual([teamA.id.toString()]);
    expect(unmarked(userTable)).toEqual([userA.id.toString()]);

    const next: Array<Told> = [];
    await run({ notify: telling(next) });

    expect(next).toEqual([
      {
        recordId: RECORD_A.toString(),
        rows: [[teamA.id.toString()], [userA.id.toString()]],
        taken: [[teamA.id.toString()], [userA.id.toString()]],
      },
    ]);
  });

  test("a row whose take fails is not told of, and is left for a later group; the rest are taken", async () => {
    const teamA: Row = teamTable.add({ recordId: RECORD_A, at: 1 });
    const userA: Row = userTable.add({ recordId: RECORD_A, at: 2 });
    takeFailsFor.add(userA.id.toString());

    const told: Array<Told> = [];
    await run({ notify: telling(told) });

    expect(told[0]!.taken).toEqual([[teamA.id.toString()], []]);
    expect(unmarked(userTable)).toEqual([userA.id.toString()]);

    takeFailsFor.clear();
    const next: Array<Told> = [];
    await run({ notify: telling(next) });

    expect(next).toEqual([
      {
        recordId: RECORD_A.toString(),
        rows: [[], [userA.id.toString()]],
        taken: [[], [userA.id.toString()]],
      },
    ]);
  });

  test("after the take: its rows stay taken, so no run tells of them again", async () => {
    teamTable.add({ recordId: RECORD_A, at: 1 });
    userTable.add({ recordId: RECORD_A, at: 2 });

    await run({
      notify: async (input: {
        take: () => Promise<Array<Array<BaseModel>>>;
      }) => {
        await input.take();
        throw new Error("the email provider is down");
      },
    });

    const next: Array<Told> = [];
    await run({ notify: telling(next) });

    expect(next).toEqual([]);
  });

  test("the take asked for twice is made once", async () => {
    teamTable.add({ recordId: RECORD_A, at: 1 });
    userTable.add({ recordId: RECORD_A, at: 2 });

    await run({
      notify: async (input: {
        take: () => Promise<Array<Array<BaseModel>>>;
      }) => {
        const first: Array<Array<BaseModel>> = await input.take();
        const second: Array<Array<BaseModel>> = await input.take();
        expect(second).toBe(first);
      },
    });

    expect(takes).toHaveLength(2);
  });
});

describe("a record taken already, said without a statement", () => {
  test("alreadyTaken counts the record as the run says, and take() answers the same after it", async () => {
    const [row] = [teamTable.add({ recordId: RECORD_A, at: 1 })];
    const answers: Array<boolean> = [];

    const result: OwnerNotificationBacklogResult =
      await OwnerNotificationBacklog.forEachToNotify<BaseModel>({
        jobName: "Test:AlreadyTaken",
        service: teamTable.service as unknown as DatabaseService<BaseModel>,
        notYetNotified: { isOwnerNotified: false } as never,
        notified: { isOwnerNotified: true } as never,
        select: {},
        notify: async (input: {
          take: () => Promise<boolean>;
          alreadyTaken?: ((byThisRun: boolean) => void) | undefined;
        }) => {
          input.alreadyTaken!(false);
          answers.push(await input.take());
        },
      });

    expect(answers).toEqual([false]);
    expect(takes).toEqual([]);
    expect(row!.isOwnerNotified).toBe(false);
    expect(result.takenElsewhere).toBe(1);
    expect(result.taken).toBe(0);
  });
});
