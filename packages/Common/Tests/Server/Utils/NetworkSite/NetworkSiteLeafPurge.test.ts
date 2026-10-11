import NetworkSiteLeafPurge, {
  LeafPurgeBatch,
  LeafPurgeShape,
  ROWS_NAMED_IN_LOG,
  findCycles,
} from "../../../../Server/Utils/NetworkSite/NetworkSiteLeafPurge";
import NetworkSiteHierarchyLock from "../../../../Server/Utils/NetworkSite/NetworkSiteHierarchyLock";
import FindBy from "../../../../Server/Types/Database/FindBy";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import logger from "../../../../Server/Utils/Logger";
import NetworkSite from "../../../../Models/DatabaseModels/NetworkSite";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { FindOperator } from "typeorm";

/*
 * THE RETENTION PURGE'S CHOICE OF ROWS, FOR NETWORK SITES AND SITE TYPES.
 *
 * NetworkSiteLeafPurge chooses, for one call of the retention job, the due
 * rows nothing names - the leaves, in one query - or, when no leaf is left,
 * the closed cycles of due rows; it deletes them by their ids in the lock of
 * their projects, or, when nothing can go, logs the due rows that stay. Here
 * the reads are answered by hand, by which read is asked; the queries
 * themselves run against Postgres in NetworkSitePurgePostgres.
 */

const SITE_SHAPE: LeafPurgeShape = {
  rowsName: "network sites",
  parentColumn: "parentSiteId",
  namedBy: [{ table: "NetworkSite", column: "parentSiteId" }],
};

const TYPE_SHAPE: LeafPurgeShape = {
  rowsName: "network site types",
  parentColumn: "parentNetworkSiteTypeId",
  namedBy: [
    { table: "NetworkSiteType", column: "parentNetworkSiteTypeId" },
    { table: "NetworkSite", column: "networkSiteTypeId" },
  ],
};

// The retention job's own condition: what every read keeps.
const DUE: { deletedAt: unknown } = {
  deletedAt: QueryHelper.lessThan(new Date("2026-09-01T00:00:00.000Z")),
};

const PROJECT_A: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const PROJECT_B: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000002",
);

function siteId(index: number): ObjectID {
  return new ObjectID(
    `11111111-1111-4111-8111-${index.toString().padStart(12, "0")}`,
  );
}

function site(data: {
  index: number;
  projectId?: ObjectID | null;
  parentIndex?: number | undefined;
}): NetworkSite {
  return {
    id: siteId(data.index),
    _id: siteId(data.index).toString(),
    projectId: data.projectId === undefined ? PROJECT_A : data.projectId,
    parentSiteId:
      data.parentIndex === undefined ? undefined : siteId(data.parentIndex),
  } as unknown as NetworkSite;
}

// Which of the purge's three reads a read is, by what it selects.
type ReadKind = "leaves" | "cycles" | "stay";

function kindOf(findBy: FindBy<NetworkSite>): ReadKind {
  const selected: Array<string> = Object.keys(findBy.select || {}).sort();

  if (selected.join(",") === "_id,projectId") {
    return "leaves";
  }

  // The leaves' columns and the row's parent, whatever the table calls it.
  if (
    selected.length === 3 &&
    selected.includes("_id") &&
    selected.includes("projectId")
  ) {
    return "cycles";
  }

  if (selected.join(",") === "_id") {
    return "stay";
  }

  throw new Error(`An unexpected read: ${selected.join(",")}`);
}

// The SQL a condition on the row id writes for the row `alias`.
function sqlOf(condition: unknown, alias: string): string {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  if (operator.type === "and") {
    return (operator.value as unknown as Array<FindOperator<unknown>>)
      .map((each: FindOperator<unknown>): string => {
        return sqlOf(each, alias);
      })
      .join(" AND ");
  }

  return (operator.getSql as (alias: string) => string)(alias);
}

interface World {
  batch: LeafPurgeBatch<NetworkSite>;
  reads: Array<FindBy<NetworkSite>>;
  deleted: Array<Array<string>>;
  lockedProjects: Array<Array<string>>;
}

/*
 * A purge call's world: what each read answers, and a delete that removes
 * as many rows as it is handed. The lock runs its operation and records the
 * projects it was asked for.
 */
function world(data: {
  shape?: LeafPurgeShape | undefined;
  leaves?: Array<NetworkSite> | undefined;
  cycleCandidates?: Array<NetworkSite> | undefined;
  stay?: Array<NetworkSite> | undefined;
  limit?: number | undefined;
  skip?: number | undefined;
  due?: Record<string, unknown> | undefined;
}): World {
  const reads: Array<FindBy<NetworkSite>> = [];
  const deleted: Array<Array<string>> = [];
  const lockedProjects: Array<Array<string>> = [];

  jest
    .spyOn(NetworkSiteHierarchyLock, "runExclusive")
    .mockImplementation((async (lock: {
      projectIds: Array<ObjectID | string>;
      operation: () => Promise<unknown>;
    }): Promise<unknown> => {
      lockedProjects.push(
        lock.projectIds.map((projectId: ObjectID | string): string => {
          return projectId.toString();
        }),
      );

      return await lock.operation();
    }) as never);

  const batch: LeafPurgeBatch<NetworkSite> = {
    shape: data.shape || SITE_SHAPE,
    due: (data.due || DUE) as never,
    limit: data.limit === undefined ? 10_000 : data.limit,
    skip: data.skip || 0,
    read: async (findBy: FindBy<NetworkSite>): Promise<Array<NetworkSite>> => {
      reads.push(findBy);

      const kind: ReadKind = kindOf(findBy);

      if (kind === "leaves") {
        return data.leaves || [];
      }

      if (kind === "cycles") {
        return data.cycleCandidates || [];
      }

      return (data.stay || []).slice(0, findBy.limit as number);
    },
    hardDeleteByIds: async (ids: Array<ObjectID>): Promise<number> => {
      deleted.push(
        ids.map((id: ObjectID): string => {
          return id.toString();
        }),
      );

      return ids.length;
    },
  };

  return { batch, reads, deleted, lockedProjects };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("findCycles", () => {
  it("finds a row that names itself", () => {
    expect(findCycles(new Map<string, string>([["a", "a"]]))).toEqual([["a"]]);
  });

  it("finds each cycle once, from its smallest row", () => {
    expect(
      findCycles(
        new Map<string, string>([
          ["e", "c"],
          ["b", "a"],
          ["c", "d"],
          ["a", "b"],
          ["d", "e"],
        ]),
      ),
    ).toEqual([
      ["a", "b"],
      ["c", "d", "e"],
    ]);
  });

  it("finds no cycle in a chain that leaves the map", () => {
    expect(
      findCycles(
        new Map<string, string>([
          ["a", "b"],
          ["b", "c"],
        ]),
      ),
    ).toEqual([]);
  });

  it("leaves out the rows that only lead into a cycle", () => {
    expect(
      findCycles(
        new Map<string, string>([
          ["x", "a"],
          ["a", "b"],
          ["b", "a"],
          ["y", "x"],
        ]),
      ),
    ).toEqual([["a", "b"]]);
  });

  it("walks a long chain and a long cycle once each", () => {
    const parentOf: Map<string, string> = new Map<string, string>();
    const size: number = 20_000;

    for (let index: number = 0; index < size; index++) {
      const id: string = `chain-${index.toString().padStart(6, "0")}`;
      parentOf.set(id, `chain-${(index + 1).toString().padStart(6, "0")}`);
    }

    for (let index: number = 0; index < size; index++) {
      const id: string = `ring-${index.toString().padStart(6, "0")}`;
      parentOf.set(
        id,
        `ring-${((index + 1) % size).toString().padStart(6, "0")}`,
      );
    }

    const cycles: Array<Array<string>> = findCycles(parentOf);

    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(size);
    expect(cycles[0]![0]).toBe("ring-000000");
  });
});

describe("the conditions the purge reads rows by", () => {
  it("chooses a leaf by NOT EXISTS for every column that can name it, deleted rows included", () => {
    expect(
      sqlOf(
        NetworkSiteLeafPurge.namedByNoRow(TYPE_SHAPE.namedBy),
        "NetworkSiteType._id",
      ),
    ).toBe(
      '(NOT EXISTS (SELECT 1 FROM "NetworkSiteType" AS "leafPurgeNamingRow0" WHERE "leafPurgeNamingRow0"."parentNetworkSiteTypeId" = NetworkSiteType._id) AND NOT EXISTS (SELECT 1 FROM "NetworkSite" AS "leafPurgeNamingRow1" WHERE "leafPurgeNamingRow1"."networkSiteTypeId" = NetworkSiteType._id))',
    );
    expect(
      sqlOf(
        NetworkSiteLeafPurge.namedByNoRow(SITE_SHAPE.namedBy),
        "NetworkSite._id",
      ),
    ).toBe(
      '(NOT EXISTS (SELECT 1 FROM "NetworkSite" AS "leafPurgeNamingRow0" WHERE "leafPurgeNamingRow0"."parentSiteId" = NetworkSite._id))',
    );
  });

  it("finds the rows a cycle can hold by the one row that names them, counted once for the table", () => {
    expect(
      sqlOf(
        NetworkSiteLeafPurge.namedByOneRow(TYPE_SHAPE.namedBy),
        "NetworkSiteType._id",
      ),
    ).toBe(
      '(NetworkSiteType._id IN (SELECT "named"."namedId" FROM (SELECT "leafPurgeNamingRow0"."parentNetworkSiteTypeId" AS "namedId" FROM "NetworkSiteType" AS "leafPurgeNamingRow0" WHERE "leafPurgeNamingRow0"."parentNetworkSiteTypeId" IS NOT NULL UNION ALL SELECT "leafPurgeNamingRow1"."networkSiteTypeId" AS "namedId" FROM "NetworkSite" AS "leafPurgeNamingRow1" WHERE "leafPurgeNamingRow1"."networkSiteTypeId" IS NOT NULL) AS "named" GROUP BY "named"."namedId" HAVING COUNT(*) = 1))',
    );
  });

  it("counts every row that names one, never only the live ones", () => {
    for (const sql of [
      sqlOf(
        NetworkSiteLeafPurge.namedByNoRow(TYPE_SHAPE.namedBy),
        "NetworkSiteType._id",
      ),
      sqlOf(
        NetworkSiteLeafPurge.namedByOneRow(TYPE_SHAPE.namedBy),
        "NetworkSiteType._id",
      ),
    ]) {
      expect(sql).not.toContain("deletedAt");
    }
  });

  it.each([
    [{ table: 'NetworkSite" WHERE TRUE --', column: "parentSiteId" }],
    [{ table: "NetworkSite", column: "parentSiteId; DROP TABLE x" }],
    [{ table: "", column: "parentSiteId" }],
  ])(
    "refuses a table or column name it cannot write into SQL as it is: %j",
    (naming: { table: string; column: string }) => {
      expect(() => {
        NetworkSiteLeafPurge.namedByNoRow([naming]);
      }).toThrow(BadDataException);
      expect(() => {
        NetworkSiteLeafPurge.namedByOneRow([naming]);
      }).toThrow(BadDataException);
    },
  );
});

describe("withIdCondition", () => {
  const condition: FindOperator<unknown> = NetworkSiteLeafPurge.namedByNoRow(
    SITE_SHAPE.namedBy,
  );

  it("puts the condition on the row id, and keeps the rest of the query", () => {
    const query: Record<string, unknown> = NetworkSiteLeafPurge.withIdCondition(
      DUE as never,
      condition,
    ) as Record<string, unknown>;

    expect(query["deletedAt"]).toBe(DUE.deletedAt);
    expect(query["_id"]).toBe(condition);
  });

  it("keeps a condition the query already puts on the row id beside its own", () => {
    const asked: unknown = QueryHelper.any([siteId(1), siteId(2)]);
    const query: Record<string, unknown> = NetworkSiteLeafPurge.withIdCondition(
      { ...DUE, _id: asked } as never,
      condition,
    ) as Record<string, unknown>;
    const both: FindOperator<unknown> = query["_id"] as FindOperator<unknown>;

    expect(both.type).toBe("and");
    expect(both.value as unknown as Array<unknown>).toEqual([asked, condition]);
    expect(sqlOf(both, "NetworkSite._id")).toContain("NOT EXISTS");
  });

  it("keeps a row id written as a string beside its own", () => {
    const query: Record<string, unknown> = NetworkSiteLeafPurge.withIdCondition(
      { ...DUE, _id: siteId(3).toString() } as never,
      condition,
    ) as Record<string, unknown>;
    const both: FindOperator<unknown> = query["_id"] as FindOperator<unknown>;
    const [equal, own] = both.value as unknown as Array<FindOperator<unknown>>;

    expect(both.type).toBe("and");
    expect(sqlOf(equal, "NetworkSite._id")).toMatch(
      /^\(NetworkSite\._id = :\w+\)$/,
    );
    expect(Object.values(equal!.objectLiteralParameters || {})).toEqual([
      siteId(3).toString(),
    ]);
    expect(own).toBe(condition);
  });

  it("refuses a row id condition it cannot combine, rather than drop it", () => {
    for (const asked of [siteId(4), [siteId(4).toString()], null]) {
      expect(() => {
        NetworkSiteLeafPurge.withIdCondition(
          { ...DUE, _id: asked } as never,
          condition,
        );
      }).toThrow(BadDataException);
    }
  });
});

describe("NetworkSiteLeafPurge.purgeBatch", () => {
  it("deletes the leaves by their ids, in the lock of their projects, and reads nothing more", async () => {
    const purge: World = world({
      leaves: [
        site({ index: 1, projectId: PROJECT_A }),
        site({ index: 2, projectId: PROJECT_B }),
      ],
      limit: 500,
      skip: 0,
    });

    await expect(NetworkSiteLeafPurge.purgeBatch(purge.batch)).resolves.toBe(2);

    expect(purge.deleted).toEqual([
      [siteId(1).toString(), siteId(2).toString()],
    ]);
    expect(purge.lockedProjects).toEqual([
      [PROJECT_A.toString(), PROJECT_B.toString()],
    ]);

    // One read chose them: no cycle read, no log read.
    expect(purge.reads).toHaveLength(1);

    const leafRead: FindBy<NetworkSite> = purge.reads[0]!;
    const query: Record<string, unknown> = leafRead.query as Record<
      string,
      unknown
    >;

    expect(query["deletedAt"]).toBe(DUE.deletedAt);
    expect(sqlOf(query["_id"], "NetworkSite._id")).toBe(
      '(NOT EXISTS (SELECT 1 FROM "NetworkSite" AS "leafPurgeNamingRow0" WHERE "leafPurgeNamingRow0"."parentSiteId" = NetworkSite._id))',
    );
    expect(leafRead.select).toEqual({ _id: true, projectId: true });
    expect(leafRead.sort).toEqual({ _id: SortOrder.Ascending });
    expect(leafRead.limit).toBe(500);
    expect(leafRead.skip).toBe(0);
    expect(leafRead.props).toEqual({ isRoot: true });
  });

  it("asks for at most its limit, from the row the job skips to", async () => {
    const purge: World = world({ leaves: [site({ index: 1 })], limit: 7 });
    purge.batch.skip = 3;

    await NetworkSiteLeafPurge.purgeBatch(purge.batch);

    expect(purge.reads[0]!.limit).toBe(7);
    expect(purge.reads[0]!.skip).toBe(3);
  });

  it("leaves out a row without a project: no lock can hold it", async () => {
    const purge: World = world({
      leaves: [
        site({ index: 1, projectId: null }),
        site({ index: 2, projectId: PROJECT_B }),
      ],
    });

    await expect(NetworkSiteLeafPurge.purgeBatch(purge.batch)).resolves.toBe(1);
    expect(purge.deleted).toEqual([[siteId(2).toString()]]);
    expect(purge.lockedProjects).toEqual([[PROJECT_B.toString()]]);
  });

  it("removes a closed cycle whole, in one delete, when no leaf is left", async () => {
    const purge: World = world({
      leaves: [],
      cycleCandidates: [
        // 1 and 2 name each other; 3 heads up a chain that leaves the read.
        site({ index: 1, projectId: PROJECT_A, parentIndex: 2 }),
        site({ index: 2, projectId: PROJECT_B, parentIndex: 1 }),
        site({ index: 3, parentIndex: 9 }),
        // A root named by one row: no parent, so in no cycle.
        site({ index: 4 }),
      ],
    });

    await expect(NetworkSiteLeafPurge.purgeBatch(purge.batch)).resolves.toBe(2);

    expect(purge.deleted).toEqual([
      [siteId(1).toString(), siteId(2).toString()],
    ]);
    expect(purge.lockedProjects).toEqual([
      [PROJECT_A.toString(), PROJECT_B.toString()],
    ]);
    expect(
      purge.reads.map((read: FindBy<NetworkSite>): ReadKind => {
        return kindOf(read);
      }),
    ).toEqual(["leaves", "cycles"]);

    // The cycle read: the due rows named by exactly one row, with their parent.
    const cycleRead: FindBy<NetworkSite> = purge.reads[1]!;
    const query: Record<string, unknown> = cycleRead.query as Record<
      string,
      unknown
    >;

    expect(query["deletedAt"]).toBe(DUE.deletedAt);
    expect(sqlOf(query["_id"], "NetworkSite._id")).toContain(
      'GROUP BY "named"."namedId" HAVING COUNT(*) = 1',
    );
    expect(cycleRead.select).toEqual({
      _id: true,
      projectId: true,
      parentSiteId: true,
    });
    expect(cycleRead.skip).toBe(0);
    expect(cycleRead.limit).toBe(purge.batch.limit);
    expect(cycleRead.props).toEqual({ isRoot: true });
  });

  it("removes a site that names itself", async () => {
    const purge: World = world({
      cycleCandidates: [site({ index: 5, parentIndex: 5 })],
    });

    await expect(NetworkSiteLeafPurge.purgeBatch(purge.batch)).resolves.toBe(1);
    expect(purge.deleted).toEqual([[siteId(5).toString()]]);
  });

  it("removes only whole cycles, as many as fit in the limit", async () => {
    const purge: World = world({
      limit: 3,
      cycleCandidates: [
        site({ index: 1, parentIndex: 2 }),
        site({ index: 2, parentIndex: 1 }),
        site({ index: 3, parentIndex: 4 }),
        site({ index: 4, parentIndex: 3 }),
        site({ index: 5, parentIndex: 5 }),
      ],
    });

    await expect(NetworkSiteLeafPurge.purgeBatch(purge.batch)).resolves.toBe(3);

    // 1-2 fits, 3-4 would pass the limit, 5 fits after it.
    expect(purge.deleted).toEqual([
      [siteId(1).toString(), siteId(2).toString(), siteId(5).toString()],
    ]);
  });

  it("keeps a cycle bigger than its limit, and logs its rows as staying", async () => {
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {
        return undefined;
      });
    const ring: Array<NetworkSite> = [
      site({ index: 1, parentIndex: 2 }),
      site({ index: 2, parentIndex: 3 }),
      site({ index: 3, parentIndex: 1 }),
    ];
    const purge: World = world({
      limit: 2,
      cycleCandidates: ring,
      stay: ring,
    });

    await expect(NetworkSiteLeafPurge.purgeBatch(purge.batch)).resolves.toBe(0);

    expect(purge.deleted).toEqual([]);
    expect(purge.lockedProjects).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(siteId(3).toString());
  });

  it("logs the due rows that stay, once, by their ids, and removes nothing", async () => {
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {
        return undefined;
      });
    const purge: World = world({
      shape: TYPE_SHAPE,
      stay: [site({ index: 7 }), site({ index: 8 })],
    });

    await expect(NetworkSiteLeafPurge.purgeBatch(purge.batch)).resolves.toBe(0);

    expect(purge.deleted).toEqual([]);
    expect(purge.lockedProjects).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);

    const message: string = String(warn.mock.calls[0]![0]);

    expect(message).toContain(
      "Retention purge kept the network site types due for purge that other rows still name",
    );
    expect(message).toContain(
      `Count: 2. Ids: ${siteId(7).toString()}, ${siteId(8).toString()}`,
    );

    // The log read: the job's own due rows, a page of them.
    const stayRead: FindBy<NetworkSite> = purge.reads[2]!;

    expect(stayRead.query).toBe(purge.batch.due);
    expect(stayRead.limit).toBe(ROWS_NAMED_IN_LOG + 1);
    expect(stayRead.skip).toBe(0);
    expect(stayRead.props).toEqual({ isRoot: true });
  });

  it("names at most a page of the rows that stay, and says there are more", async () => {
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {
        return undefined;
      });
    const stay: Array<NetworkSite> = Array.from(
      { length: ROWS_NAMED_IN_LOG + 5 },
      (_value: unknown, index: number): NetworkSite => {
        return site({ index: index + 1 });
      },
    );

    await NetworkSiteLeafPurge.purgeBatch(world({ stay }).batch);

    const message: string = String(warn.mock.calls[0]![0]);

    expect(message).toContain(`Count: more than ${ROWS_NAMED_IN_LOG}.`);
    expect(message).toContain(siteId(ROWS_NAMED_IN_LOG).toString());
    expect(message).not.toContain(siteId(ROWS_NAMED_IN_LOG + 1).toString());
  });

  it("logs nothing when nothing is due", async () => {
    const warn: SpyInstance<typeof logger.warn> = jest.spyOn(logger, "warn");
    const purge: World = world({});

    await expect(NetworkSiteLeafPurge.purgeBatch(purge.batch)).resolves.toBe(0);

    expect(warn).not.toHaveBeenCalled();
    expect(purge.reads).toHaveLength(3);
  });

  it("reads nothing for a limit of zero", async () => {
    const purge: World = world({ leaves: [site({ index: 1 })], limit: 0 });

    await expect(NetworkSiteLeafPurge.purgeBatch(purge.batch)).resolves.toBe(0);
    expect(purge.reads).toEqual([]);
  });

  it("lets a refused delete fail the call, and logs nothing", async () => {
    const warn: SpyInstance<typeof logger.warn> = jest.spyOn(logger, "warn");
    const purge: World = world({ leaves: [site({ index: 1 })] });
    purge.batch.hardDeleteByIds = async (): Promise<number> => {
      throw new BadDataException(
        "A network site with child sites cannot be deleted. Move or delete its child sites first.",
      );
    };

    await expect(NetworkSiteLeafPurge.purgeBatch(purge.batch)).rejects.toThrow(
      "A network site with child sites cannot be deleted",
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
