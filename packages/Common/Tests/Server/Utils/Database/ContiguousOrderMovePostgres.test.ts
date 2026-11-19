import Entities from "../../../../Models/DatabaseModels/Index";
import ContiguousOrder, {
  ListColumnValue,
} from "../../../../Server/Utils/Database/ContiguousOrder";
import ListOrderMaintainer from "../../../../Server/Utils/Database/ListOrderMaintainer";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import LogPipeline from "../../../../Models/DatabaseModels/LogPipeline";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import NetworkSiteAssignmentRule from "../../../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import PublicNoteApprovalStep from "../../../../Models/DatabaseModels/PublicNoteApprovalStep";
import { ListOrderSettings } from "../../../../Types/Database/ListOrderColumn";
import {
  ListPlace,
  MoveInListChanges,
} from "../../../../Types/Database/MoveInList";
import { PublicNoteApprovalEventType } from "../../../../Types/StatusPage/PublicNoteApproval";
import { getListOrderValue } from "../../../../Utils/ListOrder";
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
 *   - a drag-ordered list (@ListOrderColumn, issue #9609) is moved by the
 *     same SQL: by its own number column (a smallint for a state, priority,
 *     sortOrder), named by a kind as well as ids (a public note approval
 *     step's event type, compared as text), its twins put the older first,
 *     and a list that counts down numbered from its top.
 *
 * Synthetic text is cut to the length its column holds.
 *
 * Opt in with RUN_POSTGRES_CONTIGUOUS_ORDER_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database. The tables' STRUCTURE is cloned into a schema of the
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
 * Drag-ordered lists (@ListOrderColumn) of each kind: a state (its number a
 * smallint), a monitor status (priority), a pipeline (sortOrder), a list
 * named by a kind (an approval step's event type) and one that counts down.
 */
const DRAG_ORDERED_MODELS: Array<{ new (): BaseModel }> = [
  IncidentState,
  MonitorStatus,
  LogPipeline,
  PublicNoteApprovalStep,
  NetworkSiteAssignmentRule,
];

interface FillColumn {
  name: string;
  dataType: string;
  udtName: string;
  // The longest text the column holds (a colour's varchar(10)), when it says.
  maxLength: number | null;
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
        return `synthetic-${ObjectID.generate().toString().slice(0, 8)}`.slice(
          0,
          column.maxLength || undefined,
        );
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

    for (const listTable of [
      ...TABLES,
      ...DRAG_ORDERED_MODELS.map((modelType: { new (): BaseModel }) => {
        return { table: new modelType().tableName!, listColumns: [] };
      }),
    ]) {
      await database.query(
        `CREATE TABLE "${schema}"."${listTable.table}" (LIKE public."${listTable.table}" INCLUDING ALL)`,
      );

      const columns: Array<{
        column_name: string;
        data_type: string;
        udt_name: string;
        character_maximum_length: number | null;
      }> = await database.query(
        `SELECT "column_name", "data_type", "udt_name", "character_maximum_length" FROM information_schema.columns WHERE "table_schema" = $1 AND "table_name" = $2 AND "is_nullable" = 'NO' AND "column_default" IS NULL`,
        [schema, listTable.table],
      );

      fills.set(
        listTable.table,
        columns.map((column: (typeof columns)[number]): FillColumn => {
          return {
            name: column.column_name,
            dataType: column.data_type,
            udtName: column.udt_name,
            maxLength:
              column.character_maximum_length === null
                ? null
                : Number(column.character_maximum_length),
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

  describe.each(
    DRAG_ORDERED_MODELS.map((modelType: { new (): BaseModel }) => {
      return [new modelType().tableName!, new modelType()] as [
        string,
        BaseModel,
      ];
    }),
  )("a drag-ordered list, on %s", (table: string, model: BaseModel) => {
    const settings: ListOrderSettings = model.getListOrder()!;
    const column: string = settings.column;

    // The list's columns besides the project: a parent's id, or a kind.
    const listValuesOf: () => Record<string, string> = (): Record<
      string,
      string
    > => {
      const values: Record<string, string> = {};

      for (const scopeColumn of settings.scopeColumns) {
        if (scopeColumn !== "projectId") {
          values[scopeColumn] =
            scopeColumn === "eventType"
              ? PublicNoteApprovalEventType.Incident
              : ObjectID.generate().toString();
        }
      }

      return values;
    };

    /*
     * `numbers.length` rows of one list, created a minute apart in that
     * order. Most of these lists are a whole project's rows, so each test
     * seeds a project of its own.
     */
    const seed: (data: {
      numbers: Array<number | null>;
      listValues: Record<string, string>;
      projectId: string;
    }) => Promise<{
      ids: Array<string>;
      list: Array<ListColumnValue>;
    }> = async (data: {
      numbers: Array<number | null>;
      listValues: Record<string, string>;
      projectId: string;
    }): Promise<{ ids: Array<string>; list: Array<ListColumnValue> }> => {
      const projectId: string = data.projectId;
      const ids: Array<string> = [];

      for (let index: number = 0; index < data.numbers.length; index++) {
        ids.push(
          await insert(table, {
            projectId: projectId,
            ...data.listValues,
            [column]: data.numbers[index],
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
          }),
        );
      }

      return {
        ids: ids,
        list: [
          ...Object.entries(data.listValues).map(
            ([listColumn, value]: [string, string]): ListColumnValue => {
              return {
                column: listColumn,
                value: value,
                isText: listColumn === "eventType",
              };
            },
          ),
          { column: "projectId", value: projectId },
        ],
      };
    };

    const numbersOf: (ids: Array<string>) => Promise<Array<number>> = async (
      ids: Array<string>,
    ): Promise<Array<number>> => {
      const rows: Array<Record<string, unknown>> = await database.query(
        `SELECT "_id", "${column}" AS "number" FROM "${schema}"."${table}" WHERE "_id" = ANY($1::uuid[])`,
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

    const moveIn: (data: {
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
          ): Promise<{ changedRows: Array<{ id: string; order: number }> }> => {
            return await ContiguousOrder.moveWithinTransaction({
              manager: manager,
              tableName: table,
              list: data.list,
              rowId: new ObjectID(data.rowId),
              placeOfId: new ObjectID(data.placeOfId),
              name: "row",
              orderColumn: column,
              getChanges: (move: {
                places: Array<ListPlace>;
                rowId: string;
                placeOfId: string;
              }): MoveInListChanges => {
                return ListOrderMaintainer.getMoveChanges({
                  settings: settings,
                  places: move.places,
                  rowId: move.rowId,
                  placeOfId: move.placeOfId,
                });
              },
            });
          },
        )
      ).changedRows;
    };

    // The numbers a list shown in this order holds, from its top.
    const fromTheTop: (count: number) => Array<number> = (
      count: number,
    ): Array<number> => {
      return Array.from({ length: count }, (_value: unknown, index: number) => {
        return getListOrderValue({
          position: index + 1,
          count: count,
          sortOrder: settings.sortOrder,
        });
      });
    };

    test("the bottom row moved to the top row's place: the list numbered from the top, by its own column", async () => {
      // Numbered from the top already: 1..4, or 4..1 for a list that counts down.
      const seeded: { ids: Array<string>; list: Array<ListColumnValue> } =
        await seed({
          numbers: fromTheTop(4),
          listValues: listValuesOf(),
          projectId: ObjectID.generate().toString(),
        });
      const [top, second, third, bottom] = seeded.ids as [
        string,
        string,
        string,
        string,
      ];

      const changed: Array<{ id: string; order: number }> = await moveIn({
        list: seeded.list,
        rowId: bottom,
        placeOfId: top,
      });

      expect(await numbersOf([bottom, top, second, third])).toEqual(
        fromTheTop(4),
      );
      expect(changed).toHaveLength(4);
    });

    /*
     * Twins as a Terraform apply can leave them, read the older first. (A
     * row without a number cannot be stored here - these columns are NOT
     * NULL - and the unit suites move such rows.)
     */
    test("twins are put the older first, and the list comes out numbered", async () => {
      const top: number = fromTheTop(4)[0]!;
      const seeded: { ids: Array<string>; list: Array<ListColumnValue> } =
        await seed({
          // Two at the top number (the older first), then two others.
          numbers: [top, top, fromTheTop(4)[2]!, fromTheTop(4)[3]!],
          listValues: listValuesOf(),
          projectId: ObjectID.generate().toString(),
        });
      const [older, younger, third, last] = seeded.ids as [
        string,
        string,
        string,
        string,
      ];

      // The last row moved to the younger twin's place: just above it.
      await moveIn({
        list: seeded.list,
        rowId: last,
        placeOfId: younger,
      });

      expect(await numbersOf([older, last, younger, third])).toEqual(
        fromTheTop(4),
      );
    });

    test("no row of another list, another project or deleted is read or written", async () => {
      const projectId: string = ObjectID.generate().toString();
      const listValues: Record<string, string> = listValuesOf();
      const seeded: { ids: Array<string>; list: Array<ListColumnValue> } =
        await seed({
          numbers: fromTheTop(3),
          listValues: listValues,
          projectId: projectId,
        });
      const otherProject: { ids: Array<string> } = await seed({
        numbers: fromTheTop(2),
        listValues: listValues,
        projectId: ObjectID.generate().toString(),
      });
      /*
       * Another list of the same project: another parent's, or another
       * kind's. A list that is a whole project's rows has no other.
       */
      const otherList: { ids: Array<string> } =
        Object.keys(listValues).length > 0
          ? await seed({
              numbers: fromTheTop(2),
              listValues:
                "eventType" in listValues
                  ? {
                      eventType:
                        PublicNoteApprovalEventType.ScheduledMaintenance,
                    }
                  : listValuesOf(),
              projectId: projectId,
            })
          : { ids: [] };
      const deletedId: string = await insert(table, {
        projectId: projectId,
        ...listValues,
        [column]: fromTheTop(3)[0],
        deletedAt: new Date(),
      });

      await moveIn({
        list: seeded.list,
        rowId: seeded.ids[2]!,
        placeOfId: seeded.ids[0]!,
      });

      expect(
        await numbersOf([seeded.ids[2]!, seeded.ids[0]!, seeded.ids[1]!]),
      ).toEqual(fromTheTop(3));
      expect(await numbersOf(otherProject.ids)).toEqual(fromTheTop(2));
      expect(await numbersOf(otherList.ids)).toEqual(
        otherList.ids.length > 0 ? fromTheTop(2) : [],
      );
      expect(await numbersOf([deletedId])).toEqual([fromTheTop(3)[0]]);
    });
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
});
