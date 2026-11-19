import Entities from "../../../../Models/DatabaseModels/Index";
import ContiguousOrder, {
  ListColumnValue,
} from "../../../../Server/Utils/Database/ContiguousOrder";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, EntityManager, QueryRunner } from "typeorm";

/*
 * A MOVE IN A NUMBERED LIST, ON POSTGRES (issue #9573).
 *
 * The five lists numbered by `order` - an on-call policy's escalation rules,
 * a schedule's layers and the people in a layer, a status page's groups and
 * resources - are written one row per write: Terraform numbers a whole list
 * that way, all at once, and every row must end at the number written. A
 * move (what the Dashboard's drag sends) is the one write of several rows:
 * ContiguousOrder.moveWithinTransaction locks every row of the list
 * (SELECT ... FOR UPDATE, in id order), works out the new numbers from the
 * rows as the lock hands them over, and writes the rows given another
 * number in one UPDATE. Only a database answers whether that SQL runs on
 * the real tables, and whether its locks hold:
 *
 *   - on each of the five tables: the list named by its columns - a group
 *     of no group by IS NULL - is numbered 1..n in its new order, only the
 *     rows whose number changes are written, and no row of another list,
 *     nor a deleted row, is read or written;
 *   - moves at once on one list run one after the other: the list ends
 *     numbered 1..n, never two rows at one number, never a row at 0;
 *   - a write of one row's order that lands while a move holds the list
 *     waits for it, then lands as written - the placement wins, as it was
 *     made last;
 *   - a row deleted by the time the move holds the list is not found;
 *   - on the drag-ordered lists (@ListOrderColumn, issue #9609) the same
 *     move runs by the list's own column - `sortOrder` and `priority` too -
 *     numbering a list whose top is its highest number n..1, and holding a
 *     list named by a text column (a public note approval step's event
 *     type) to it as it is.
 *
 * Opt in with RUN_POSTGRES_CONTIGUOUS_ORDER_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database. The five tables' STRUCTURE is cloned into a schema of the
 * suite's own (search_path holds only that schema), dropped afterwards;
 * every row is synthetic. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from CONTIGUOUS_ORDER_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from CONTIGUOUS_ORDER_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CONTIGUOUS_ORDER_TESTS"] === "true"
    ? describe
    : describe.skip;

// Short, so a statement that waits on a lock it should not fails fast.
const LOCK_TIMEOUT_MS: number = 5000;

const PROJECT_ID: string = ObjectID.generate().toString();
const OTHER_PROJECT_ID: string = ObjectID.generate().toString();

interface ListTable {
  table: string;
  // The columns naming a row's list, besides its project.
  listColumns: Array<string>;
}

const TABLES: Array<ListTable> = [
  {
    table: "OnCallDutyPolicyEscalationRule",
    listColumns: ["onCallDutyPolicyId"],
  },
  {
    table: "OnCallDutyPolicyScheduleLayer",
    listColumns: ["onCallDutyPolicyScheduleId"],
  },
  {
    table: "OnCallDutyPolicyScheduleLayerUser",
    listColumns: ["onCallDutyPolicyScheduleLayerId"],
  },
  { table: "StatusPageGroup", listColumns: ["statusPageId"] },
  {
    table: "StatusPageResource",
    listColumns: ["statusPageId", "statusPageGroupId"],
  },
];

/*
 * The drag-ordered lists (@ListOrderColumn) whose columns differ from the
 * five's: one numbered by `order` in its project alone, one by `sortOrder`
 * under a parent, one by `priority` with the highest number on top, and one
 * split by a text column.
 */
interface DragTable {
  table: string;
  orderColumn: string;
  sortOrder: SortOrder;
  // The columns naming a row's list besides its project: an id, or a text.
  listColumns: Array<{ column: string; text?: string | undefined }>;
  // Values a row must be given that no synthetic value fits (a color).
  values?: Record<string, unknown> | undefined;
}

const DRAG_TABLES: Array<DragTable> = [
  {
    table: "IncidentSeverity",
    orderColumn: "order",
    sortOrder: SortOrder.Ascending,
    listColumns: [],
    values: { color: "#E74C3C" },
  },
  {
    table: "LogPipelineProcessor",
    orderColumn: "sortOrder",
    sortOrder: SortOrder.Ascending,
    listColumns: [{ column: "logPipelineId" }],
  },
  {
    table: "NetworkSiteAssignmentRule",
    orderColumn: "priority",
    sortOrder: SortOrder.Descending,
    listColumns: [],
  },
  {
    table: "PublicNoteApprovalStep",
    orderColumn: "order",
    sortOrder: SortOrder.Ascending,
    listColumns: [{ column: "eventType", text: "Incident" }],
  },
];

interface FillColumn {
  name: string;
  dataType: string;
  udtName: string;
}

describePostgres("a move in a numbered list, on Postgres (issue #9573)", () => {
  const schema: string = `contiguous_order_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;

  // The columns a row of each table must be given, when no default fills them.
  const fills: Map<string, Array<FillColumn>> = new Map();
  // The first label of each enum type a column needs.
  const enumLabels: Map<string, string> = new Map();

  // A value for a column a row must have, of the column's type.
  const fillFor: (column: FillColumn) => unknown = (
    column: FillColumn,
  ): unknown => {
    switch (column.dataType) {
      case "uuid":
        return ObjectID.generate().toString();
      case "integer":
      case "bigint":
      case "smallint":
      case "numeric":
      case "double precision":
      case "real":
        return 0;
      case "boolean":
        return false;
      case "timestamp with time zone":
      case "timestamp without time zone":
        return new Date();
      case "json":
      case "jsonb":
        return {};
      case "ARRAY":
        return [];
      case "USER-DEFINED":
        return enumLabels.get(column.udtName) || "";
      default:
        return `synthetic-${ObjectID.generate().toString().slice(0, 8)}`;
    }
  };

  // A row of `table`, with what it is given and whatever else it must have.
  const insert: (
    table: string,
    values: Record<string, unknown>,
  ) => Promise<string> = async (
    table: string,
    values: Record<string, unknown>,
  ): Promise<string> => {
    const row: Record<string, unknown> = {
      _id: ObjectID.generate().toString(),
      ...values,
    };

    for (const column of fills.get(table) || []) {
      if (!(column.name in row)) {
        row[column.name] = fillFor(column);
      }
    }

    const columns: Array<string> = Object.keys(row);

    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number): string => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string): unknown => {
        const value: unknown = row[column];
        return value && typeof value === "object" && !(value instanceof Date)
          ? JSON.stringify(value)
          : value;
      }),
    );

    return String(row["_id"]);
  };

  // A list's rows: `count` rows numbered 1..count, in its own list.
  const seedList: (data: {
    listTable: ListTable;
    count: number;
    projectId?: string;
    listValues?: Record<string, string | null>;
  }) => Promise<{
    ids: Array<string>;
    list: Array<ListColumnValue>;
  }> = async (data: {
    listTable: ListTable;
    count: number;
    projectId?: string;
    listValues?: Record<string, string | null>;
  }): Promise<{ ids: Array<string>; list: Array<ListColumnValue> }> => {
    const projectId: string = data.projectId || PROJECT_ID;
    const listValues: Record<string, string | null> = {};

    for (const column of data.listTable.listColumns) {
      listValues[column] =
        data.listValues && column in data.listValues
          ? data.listValues[column]!
          : ObjectID.generate().toString();
    }

    const ids: Array<string> = [];

    for (let order: number = 1; order <= data.count; order++) {
      ids.push(
        await insert(data.listTable.table, {
          projectId: projectId,
          ...listValues,
          order: order,
        }),
      );
    }

    return {
      ids: ids,
      list: [
        ...data.listTable.listColumns.map((column: string): ListColumnValue => {
          return { column: column, value: listValues[column] ?? null };
        }),
        { column: "projectId", value: projectId },
      ],
    };
  };

  const ordersOf: (
    table: string,
    ids: Array<string>,
  ) => Promise<Array<number>> = async (
    table: string,
    ids: Array<string>,
  ): Promise<Array<number>> => {
    const rows: Array<{ _id: string; order: number }> = await database.query(
      `SELECT "_id", "order" FROM "${schema}"."${table}" WHERE "_id" = ANY($1::uuid[])`,
      [ids],
    );

    return ids.map((id: string): number => {
      return Number(
        rows.find((row: { _id: string }): boolean => {
          return row._id === id;
        })?.order,
      );
    });
  };

  const versionsOf: (
    table: string,
    ids: Array<string>,
  ) => Promise<Array<number>> = async (
    table: string,
    ids: Array<string>,
  ): Promise<Array<number>> => {
    const rows: Array<{ _id: string; version: number }> = await database.query(
      `SELECT "_id", "version" FROM "${schema}"."${table}" WHERE "_id" = ANY($1::uuid[])`,
      [ids],
    );

    return ids.map((id: string): number => {
      return Number(
        rows.find((row: { _id: string }): boolean => {
          return row._id === id;
        })?.version,
      );
    });
  };

  const move: (data: {
    table: string;
    list: Array<ListColumnValue>;
    rowId: string;
    placeOfId: string;
  }) => Promise<Array<{ id: string; order: number }>> = async (data: {
    table: string;
    list: Array<ListColumnValue>;
    rowId: string;
    placeOfId: string;
  }): Promise<Array<{ id: string; order: number }>> => {
    return (
      await database.transaction(
        async (
          manager: EntityManager,
        ): Promise<{ changedRows: Array<{ id: string; order: number }> }> => {
          return await ContiguousOrder.moveWithinTransaction({
            manager: manager,
            tableName: data.table,
            list: data.list,
            rowId: new ObjectID(data.rowId),
            placeOfId: new ObjectID(data.placeOfId),
            name: "row",
          });
        },
      )
    ).changedRows;
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["CONTIGUOUS_ORDER_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["CONTIGUOUS_ORDER_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["CONTIGUOUS_ORDER_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const listTable of [...TABLES, ...DRAG_TABLES]) {
      await database.query(
        `CREATE TABLE "${schema}"."${listTable.table}" (LIKE public."${listTable.table}" INCLUDING ALL)`,
      );

      const columns: Array<{
        column_name: string;
        data_type: string;
        udt_name: string;
      }> = await database.query(
        `SELECT "column_name", "data_type", "udt_name" FROM information_schema.columns WHERE "table_schema" = $1 AND "table_name" = $2 AND "is_nullable" = 'NO' AND "column_default" IS NULL`,
        [schema, listTable.table],
      );

      fills.set(
        listTable.table,
        columns.map((column: (typeof columns)[number]): FillColumn => {
          return {
            name: column.column_name,
            dataType: column.data_type,
            udtName: column.udt_name,
          };
        }),
      );

      for (const column of columns) {
        if (column.data_type === "USER-DEFINED") {
          const labels: Array<{ enumlabel: string }> = await database.query(
            `SELECT e."enumlabel" FROM pg_enum e JOIN pg_type t ON t."oid" = e."enumtypid" WHERE t."typname" = $1 ORDER BY e."enumsortorder" LIMIT 1`,
            [column.udt_name],
          );
          enumLabels.set(column.udt_name, labels[0]?.enumlabel || "");
        }
      }
    }
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  describe.each(TABLES)("on $table", (listTable: ListTable) => {
    test("the last row moved to the first's place: the list numbered 1..n, only the rows passed written", async () => {
      const seeded: { ids: Array<string>; list: Array<ListColumnValue> } =
        await seedList({ listTable, count: 5 });
      const [a, b, c, d, e] = seeded.ids as [
        string,
        string,
        string,
        string,
        string,
      ];
      const before: Array<number> = await versionsOf(
        listTable.table,
        seeded.ids,
      );

      // D (at 4) to B's place (2): B and C step down, A and E are not written.
      const changed: Array<{ id: string; order: number }> = await move({
        table: listTable.table,
        list: seeded.list,
        rowId: d,
        placeOfId: b,
      });

      expect(await ordersOf(listTable.table, [a, d, b, c, e])).toEqual([
        1, 2, 3, 4, 5,
      ]);
      expect(
        changed
          .map((row: { id: string }): string => {
            return row.id;
          })
          .sort(),
      ).toEqual([b, c, d].sort());

      const after: Array<number> = await versionsOf(
        listTable.table,
        seeded.ids,
      );

      // A and E untouched; B, C and D each written once.
      expect(after[0]).toBe(before[0]);
      expect(after[4]).toBe(before[4]);
      expect(after[1]).toBe(before[1]! + 1);
      expect(after[2]).toBe(before[2]! + 1);
      expect(after[3]).toBe(before[3]! + 1);
    });

    test("no row of another list, of another project, or deleted is read or written", async () => {
      const seeded: { ids: Array<string>; list: Array<ListColumnValue> } =
        await seedList({ listTable, count: 3 });
      const sameValues: Record<string, string | null> = {};

      for (const entry of seeded.list) {
        if (entry.column !== "projectId") {
          sameValues[entry.column] = entry.value;
        }
      }

      const otherList: { ids: Array<string> } = await seedList({
        listTable,
        count: 3,
      });
      // The same list's columns in another project: no row of this list.
      const otherProject: { ids: Array<string> } = await seedList({
        listTable,
        count: 2,
        projectId: OTHER_PROJECT_ID,
        listValues: sameValues,
      });
      const deletedId: string = await insert(listTable.table, {
        projectId: PROJECT_ID,
        ...sameValues,
        order: 1,
        deletedAt: new Date(),
      });

      await move({
        table: listTable.table,
        list: seeded.list,
        rowId: seeded.ids[2]!,
        placeOfId: seeded.ids[0]!,
      });

      expect(await ordersOf(listTable.table, seeded.ids)).toEqual([2, 3, 1]);
      expect(await ordersOf(listTable.table, otherList.ids)).toEqual([1, 2, 3]);
      expect(await ordersOf(listTable.table, otherProject.ids)).toEqual([1, 2]);
      expect(await ordersOf(listTable.table, [deletedId])).toEqual([1]);
    });

    test("a row deleted by the time the move holds the list is not found, and nothing is written", async () => {
      const seeded: { ids: Array<string>; list: Array<ListColumnValue> } =
        await seedList({ listTable, count: 3 });

      await database.query(
        `UPDATE "${schema}"."${listTable.table}" SET "deletedAt" = now() WHERE "_id" = $1`,
        [seeded.ids[2]],
      );

      await expect(
        move({
          table: listTable.table,
          list: seeded.list,
          rowId: seeded.ids[2]!,
          placeOfId: seeded.ids[0]!,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(await ordersOf(listTable.table, seeded.ids)).toEqual([1, 2, 3]);
    });
  });

  test("a status page's resources in no group are a list of their own, named by IS NULL", async () => {
    const statusPageId: string = ObjectID.generate().toString();
    const listTable: ListTable = TABLES.find((each: ListTable): boolean => {
      return each.table === "StatusPageResource";
    })!;

    const ungrouped: { ids: Array<string>; list: Array<ListColumnValue> } =
      await seedList({
        listTable,
        count: 3,
        listValues: { statusPageId: statusPageId, statusPageGroupId: null },
      });
    const grouped: { ids: Array<string> } = await seedList({
      listTable,
      count: 3,
      listValues: { statusPageId: statusPageId },
    });

    await move({
      table: "StatusPageResource",
      list: ungrouped.list,
      rowId: ungrouped.ids[0]!,
      placeOfId: ungrouped.ids[2]!,
    });

    expect(await ordersOf("StatusPageResource", ungrouped.ids)).toEqual([
      3, 1, 2,
    ]);
    expect(await ordersOf("StatusPageResource", grouped.ids)).toEqual([
      1, 2, 3,
    ]);
  });

  test("moves at once on one list run one after the other, and leave it numbered 1..n", async () => {
    const listTable: ListTable = TABLES[3]!;
    const seeded: { ids: Array<string>; list: Array<ListColumnValue> } =
      await seedList({ listTable, count: 6 });

    // Twenty moves at once, each of one row to another's place.
    const moves: Array<Promise<Array<{ id: string; order: number }>>> = [];

    for (let index: number = 0; index < 20; index++) {
      moves.push(
        move({
          table: listTable.table,
          list: seeded.list,
          rowId: seeded.ids[(index * 5) % 6]!,
          placeOfId: seeded.ids[(index * 7 + 3) % 6]!,
        }),
      );
    }

    await Promise.all(moves);

    const orders: Array<number> = await ordersOf(listTable.table, seeded.ids);

    expect(
      [...orders].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  /*
   * The race the lock is for, made to happen every time: one move is held
   * right after it has read the list. A second move reads the list only
   * once the first has written it and let go - so it moves the rows where
   * the first left them. Read before the first wrote, it would write
   * numbers worked out from the list as it was, over the first move's, and
   * leave two rows at one number.
   */
  test("a move that reads the list while another move holds it waits for it, and moves the rows where it left them", async () => {
    const listTable: ListTable = TABLES[4]!;
    const seeded: { ids: Array<string>; list: Array<ListColumnValue> } =
      await seedList({ listTable, count: 4 });
    const [a, b, c, d] = seeded.ids as [string, string, string, string];

    let releaseFirst: () => void = (): void => {};
    const firstMayWrite: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        releaseFirst = resolve;
      },
    );
    let firstHasRead: () => void = (): void => {};
    const firstRead: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        firstHasRead = resolve;
      },
    );

    const runner: QueryRunner = database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    // The first move's manager: held once the list is read and locked.
    const heldManager: EntityManager = {
      query: async (sql: string, parameters: Array<unknown>) => {
        const result: unknown = await runner.manager.query(sql, parameters);

        if (sql.startsWith("SELECT")) {
          firstHasRead();
          await firstMayWrite;
        }

        return result;
      },
    } as unknown as EntityManager;

    let secondDone: boolean = false;
    let second: Promise<Array<{ id: string; order: number }>> | null = null;

    try {
      // First: D to A's place.
      const first: Promise<unknown> = ContiguousOrder.moveWithinTransaction({
        manager: heldManager,
        tableName: listTable.table,
        list: seeded.list,
        rowId: new ObjectID(d),
        placeOfId: new ObjectID(a),
        name: "status page resource",
      });

      await firstRead;

      // Second, while the first holds the list: A to C's place.
      second = move({
        table: listTable.table,
        list: seeded.list,
        rowId: a,
        placeOfId: c,
      }).then((changed: Array<{ id: string; order: number }>) => {
        secondDone = true;
        return changed;
      });

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 500);
      });

      expect(secondDone).toBe(false);

      releaseFirst();
      await first;
      await runner.commitTransaction();
    } catch (err) {
      releaseFirst();
      await runner.rollbackTransaction();
      throw err;
    } finally {
      await runner.release();
    }

    await second;

    /*
     * The first left D, A, B, C; the second took A to C's place then:
     * D, B, C, A - each move as if the other had not been at the same time.
     */
    expect(await ordersOf(listTable.table, [d, b, c, a])).toEqual([1, 2, 3, 4]);
  });

  /*
   * A write of one row of the list - Terraform placing it - that lands while
   * a move holds the list is made after the move, and stands.
   */
  test("a write of one row's order waits for a move holding the list, then lands as written", async () => {
    const listTable: ListTable = TABLES[0]!;
    const seeded: { ids: Array<string>; list: Array<ListColumnValue> } =
      await seedList({ listTable, count: 3 });

    const runner: QueryRunner = database.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    let placementLanded: boolean = false;
    let placement: Promise<void> | null = null;

    try {
      // The move holds the list: C to A's place, not committed yet.
      await ContiguousOrder.moveWithinTransaction({
        manager: runner.manager,
        tableName: listTable.table,
        list: seeded.list,
        rowId: new ObjectID(seeded.ids[2]!),
        placeOfId: new ObjectID(seeded.ids[0]!),
        name: "escalation rule",
      });

      // Terraform's write of A's order, from another connection.
      placement = database
        .query(
          `UPDATE "${schema}"."${listTable.table}" SET "order" = 7 WHERE "_id" = $1`,
          [seeded.ids[0]],
        )
        .then((): void => {
          placementLanded = true;
        });

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 500);
      });

      // It waits for the move.
      expect(placementLanded).toBe(false);

      await runner.commitTransaction();
    } catch (err) {
      await runner.rollbackTransaction();
      throw err;
    } finally {
      await runner.release();
    }

    await placement;

    expect(placementLanded).toBe(true);
    // C, moved to the top; B, stepped down; A, at the number written last.
    expect(await ordersOf(listTable.table, seeded.ids)).toEqual([7, 3, 1]);
  });
  describe.each(DRAG_TABLES)(
    "on $table, a drag-ordered list (issue #9609)",
    (dragTable: DragTable) => {
      // The number of the row at `position` (1 = the top) of a list of `count`.
      const numberAt: (position: number, count: number) => number = (
        position: number,
        count: number,
      ): number => {
        return dragTable.sortOrder === SortOrder.Descending
          ? count - position + 1
          : position;
      };

      /*
       * A list of `count` rows, top first, numbered from scratch - in a
       * project of its own unless one is named: a list of a project alone
       * is every row of it.
       */
      const seedDragList: (data: {
        count: number;
        projectId?: string;
        listValues?: Record<string, string>;
      }) => Promise<{
        ids: Array<string>;
        list: Array<ListColumnValue>;
        projectId: string;
      }> = async (data: {
        count: number;
        projectId?: string;
        listValues?: Record<string, string>;
      }): Promise<{
        ids: Array<string>;
        list: Array<ListColumnValue>;
        projectId: string;
      }> => {
        const projectId: string =
          data.projectId || ObjectID.generate().toString();
        const listValues: Record<string, string> = {};

        for (const entry of dragTable.listColumns) {
          listValues[entry.column] =
            data.listValues?.[entry.column] ||
            entry.text ||
            ObjectID.generate().toString();
        }

        const ids: Array<string> = [];

        for (let position: number = 1; position <= data.count; position++) {
          ids.push(
            await insert(dragTable.table, {
              ...(dragTable.values || {}),
              projectId: projectId,
              ...listValues,
              [dragTable.orderColumn]: numberAt(position, data.count),
            }),
          );
        }

        return {
          ids: ids,
          projectId: projectId,
          list: [
            ...dragTable.listColumns.map(
              (entry: { column: string; text?: string }): ListColumnValue => {
                return {
                  column: entry.column,
                  value: listValues[entry.column]!,
                  isId: entry.text === undefined,
                };
              },
            ),
            { column: "projectId", value: projectId, isId: true },
          ],
        };
      };

      const numbersOf: (ids: Array<string>) => Promise<Array<number>> = async (
        ids: Array<string>,
      ): Promise<Array<number>> => {
        const rows: Array<Record<string, unknown>> = await database.query(
          `SELECT "_id", "${dragTable.orderColumn}" AS "number" FROM "${schema}"."${dragTable.table}" WHERE "_id" = ANY($1::uuid[])`,
          [ids],
        );

        return ids.map((id: string): number => {
          return Number(
            rows.find((row: Record<string, unknown>): boolean => {
              return row["_id"] === id;
            })?.["number"],
          );
        });
      };

      const dragMove: (data: {
        list: Array<ListColumnValue>;
        rowId: string;
        placeOfId: string;
      }) => Promise<Array<{ id: string; order: number }>> = async (data: {
        list: Array<ListColumnValue>;
        rowId: string;
        placeOfId: string;
      }): Promise<Array<{ id: string; order: number }>> => {
        return (
          await database.transaction(
            async (
              manager: EntityManager,
            ): Promise<{
              changedRows: Array<{ id: string; order: number }>;
            }> => {
              return await ContiguousOrder.moveWithinTransaction({
                manager: manager,
                tableName: dragTable.table,
                list: data.list,
                rowId: new ObjectID(data.rowId),
                placeOfId: new ObjectID(data.placeOfId),
                name: "row",
                orderColumn: dragTable.orderColumn,
                sortOrder: dragTable.sortOrder,
              });
            },
          )
        ).changedRows;
      };

      test("the fourth row moved to the second's place: numbered from scratch by the list's own column, only the rows passed written", async () => {
        const seeded: { ids: Array<string>; list: Array<ListColumnValue> } =
          await seedDragList({ count: 5 });
        const [a, b, c, d, e] = seeded.ids as [
          string,
          string,
          string,
          string,
          string,
        ];
        const before: Array<number> = await versionsOf(
          dragTable.table,
          seeded.ids,
        );

        const changed: Array<{ id: string; order: number }> = await dragMove({
          list: seeded.list,
          rowId: d,
          placeOfId: b,
        });

        // Top first: A, D, B, C, E.
        expect(await numbersOf([a, d, b, c, e])).toEqual(
          [1, 2, 3, 4, 5].map((position: number) => {
            return numberAt(position, 5);
          }),
        );
        expect(
          changed
            .map((row: { id: string }): string => {
              return row.id;
            })
            .sort(),
        ).toEqual([b, c, d].sort());

        const after: Array<number> = await versionsOf(
          dragTable.table,
          seeded.ids,
        );

        expect(after[0]).toBe(before[0]);
        expect(after[4]).toBe(before[4]);
        expect(after[1]).toBe(before[1]! + 1);
        expect(after[2]).toBe(before[2]! + 1);
        expect(after[3]).toBe(before[3]! + 1);
      });

      test("a list with gaps and twins is read top first, twins by id, and numbered from scratch", async () => {
        const seeded: { ids: Array<string>; list: Array<ListColumnValue> } =
          await seedDragList({ count: 3 });
        const sorted: Array<string> = [...seeded.ids].sort();
        const descending: boolean =
          dragTable.sortOrder === SortOrder.Descending;

        // The first two by id share the top number; the third is far below.
        await database.query(
          `UPDATE "${schema}"."${dragTable.table}" SET "${dragTable.orderColumn}" = $2 WHERE "_id" = ANY($1::uuid[])`,
          [[sorted[0], sorted[1]], descending ? 50 : 10],
        );
        await database.query(
          `UPDATE "${schema}"."${dragTable.table}" SET "${dragTable.orderColumn}" = $2 WHERE "_id" = $1::uuid`,
          [sorted[2], descending ? -40 : 90],
        );

        await dragMove({
          list: seeded.list,
          rowId: sorted[2]!,
          placeOfId: sorted[1]!,
        });

        expect(await numbersOf([sorted[0]!, sorted[2]!, sorted[1]!])).toEqual(
          [1, 2, 3].map((position: number) => {
            return numberAt(position, 3);
          }),
        );
      });

      test("no row of another list - another parent, another project, another kind - is read or written", async () => {
        const seeded: {
          ids: Array<string>;
          list: Array<ListColumnValue>;
          projectId: string;
        } = await seedDragList({ count: 3 });
        const sameValues: Record<string, string> = {};

        for (const entry of seeded.list) {
          if (entry.column !== "projectId" && entry.value) {
            sameValues[entry.column] = entry.value;
          }
        }

        // The same list's columns in another project.
        const otherProject: { ids: Array<string> } = await seedDragList({
          count: 3,
          listValues: sameValues,
        });

        // Another list of the same project: another parent, or another kind.
        const otherValues: Record<string, string> = {};

        for (const entry of dragTable.listColumns) {
          otherValues[entry.column] =
            entry.text !== undefined
              ? "ScheduledMaintenance"
              : ObjectID.generate().toString();
        }

        const otherList: { ids: Array<string> } | null =
          dragTable.listColumns.length > 0
            ? await seedDragList({
                count: 3,
                projectId: seeded.projectId,
                listValues: otherValues,
              })
            : null;

        const untouched: Array<string> = [
          ...otherProject.ids,
          ...(otherList?.ids || []),
        ];
        const before: Array<number> = await versionsOf(
          dragTable.table,
          untouched,
        );

        await dragMove({
          list: seeded.list,
          rowId: seeded.ids[2]!,
          placeOfId: seeded.ids[0]!,
        });

        expect(await versionsOf(dragTable.table, untouched)).toEqual(before);

        await expect(
          dragMove({
            list: seeded.list,
            rowId: seeded.ids[0]!,
            placeOfId: otherProject.ids[0]!,
          }),
        ).rejects.toThrow("is not in the same list");
      });
    },
  );
});
