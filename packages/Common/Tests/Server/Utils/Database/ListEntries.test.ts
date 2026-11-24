import ListEntries, {
  ListEntryWrite,
} from "../../../../Server/Utils/Database/ListEntries";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../../../Models/DatabaseModels/Index";
import { beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, EntityManager, ObjectLiteral } from "typeorm";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";

/*
 * THE STATEMENTS THAT WRITE ONLY THE ENTRIES AN UPDATE ADDS TO A LIST AND
 * TAKES OFF IT (#10135), rendered as Postgres would run them, from the
 * models' own metadata - built without a connection, as TypeORM builds it
 * on start.
 *
 * An entry added is INSERTed with ON CONFLICT DO NOTHING, so one a label
 * rule added at the same moment is no error and stays one entry; an entry
 * taken off is DELETEd by the row and the entry both, so no other entry -
 * of this row or another - is touched.
 */

let dataSource: DataSource;
let manager: EntityManager;

const ROW: string = "a1000000-0000-4000-8000-000000000001";
const LABEL_1: string = "b1000000-0000-4000-8000-000000000001";
const LABEL_2: string = "b2000000-0000-4000-8000-000000000002";

beforeAll(async () => {
  dataSource = new DataSource({ type: "postgres", entities: Models });

  // Metadata only: initialize() would build it the same way, then connect.
  await (
    dataSource as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();

  manager = dataSource.manager;
});

describe("a model's lists of related records", () => {
  test("are its EntityArray fields: a monitor's labels and dependencies among them", () => {
    const lists: Array<string> = ListEntries.getListColumns(new Monitor());

    expect(lists).toEqual(
      expect.arrayContaining(["labels", "dependsOnMonitors"]),
    );
    expect(lists).not.toContain("name");
    expect(lists).not.toContain("currentMonitorStatus");
  });

  test("a model with none has none", () => {
    expect(ListEntries.getListColumns(new Label())).toEqual([]);
  });
});

describe("the INSERT of the entries added", () => {
  test("writes each entry once into the list's junction table, leaving one it has", () => {
    const [sql, parameters]: [string, Array<unknown>] = ListEntries.getInsert({
      manager,
      modelType: Monitor,
      column: "labels",
      rowId: ROW,
      ids: [LABEL_1, LABEL_2],
    })!.getQueryAndParameters();

    expect(sql).toBe(
      'INSERT INTO "MonitorLabel"("monitorId", "labelId") VALUES ($1, $2), ($3, $4) ON CONFLICT DO NOTHING',
    );
    expect(parameters).toEqual([ROW, LABEL_1, ROW, LABEL_2]);
  });

  test("a list of a monitor's own kind names the row and the entry on their own sides", () => {
    const [sql, parameters]: [string, Array<unknown>] = ListEntries.getInsert({
      manager,
      modelType: Monitor,
      column: "dependsOnMonitors",
      rowId: ROW,
      ids: [LABEL_1],
    })!.getQueryAndParameters();

    const relation: RelationMetadata = dataSource
      .getMetadata(Monitor)
      .findRelationWithPropertyPath("dependsOnMonitors")!;
    const junction: { tableName: string; owner: string; inverse: string } = {
      tableName: relation.junctionEntityMetadata!.tableName,
      owner: relation.junctionEntityMetadata!.ownerColumns[0]!.databaseName,
      inverse: relation.junctionEntityMetadata!.inverseColumns[0]!.databaseName,
    };

    expect(relation.isManyToManyOwner).toBe(true);
    expect(sql).toBe(
      `INSERT INTO "${junction.tableName}"("${junction.owner}", "${junction.inverse}") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    );
    expect(parameters).toEqual([ROW, LABEL_1]);
  });

  test("no entry, no statement", () => {
    expect(
      ListEntries.getInsert({
        manager,
        modelType: Monitor,
        column: "labels",
        rowId: ROW,
        ids: [],
      }),
    ).toBeNull();
  });
});

describe("the DELETE of the entries taken off", () => {
  test("removes only the row's entries named, from the list's junction table", () => {
    const [sql, parameters]: [string, Array<unknown>] = ListEntries.getDelete({
      manager,
      modelType: Monitor,
      column: "labels",
      rowId: ROW,
      ids: [LABEL_1, LABEL_2],
    })!.getQueryAndParameters();

    expect(sql).toBe(
      'DELETE FROM "MonitorLabel" WHERE "monitorId" = $1 AND "labelId" IN ($2, $3)',
    );
    expect(parameters).toEqual([ROW, LABEL_1, LABEL_2]);
  });

  test("no entry, no statement", () => {
    expect(
      ListEntries.getDelete({
        manager,
        modelType: Monitor,
        column: "labels",
        rowId: ROW,
        ids: [],
      }),
    ).toBeNull();
  });
});

describe("every list of related records the API writes has statements of its own", () => {
  /*
   * Each EntityArray field of every model is a many-to-many relation with a
   * junction table of one column a side: the row's, and the entry's - the
   * sides the statements name, whichever side of the relation the model is.
   */
  test("one column a side, each a side of its own", () => {
    const problems: Array<string> = [];
    let lists: number = 0;

    for (const modelType of Models as Array<{ new (): BaseModel }>) {
      const model: BaseModel = new modelType();

      for (const column of ListEntries.getListColumns(model)) {
        lists++;

        try {
          const [insert]: [string, Array<unknown>] = ListEntries.getInsert({
            manager,
            modelType,
            column,
            rowId: ROW,
            ids: [LABEL_1],
          })!.getQueryAndParameters();
          const [remove]: [string, Array<unknown>] = ListEntries.getDelete({
            manager,
            modelType,
            column,
            rowId: ROW,
            ids: [LABEL_1],
          })!.getQueryAndParameters();

          expect(insert).toMatch(
            /^INSERT INTO "\w+"\("\w+", "\w+"\) VALUES \(\$1, \$2\) ON CONFLICT DO NOTHING$/,
          );
          expect(remove).toMatch(
            /^DELETE FROM "\w+" WHERE "\w+" = \$1 AND "\w+" IN \(\$2\)$/,
          );
        } catch (err) {
          problems.push(`${model.tableName}.${column}: ${String(err)}`);
        }
      }
    }

    expect(problems).toEqual([]);
    expect(lists).toBeGreaterThan(50);
  });

  test("a list the model is the inverse side of names the row on the inverse side's column", () => {
    for (const modelType of Models as Array<{ new (): BaseModel }>) {
      const model: BaseModel = new modelType();

      for (const column of ListEntries.getListColumns(model)) {
        const relation: RelationMetadata | undefined = dataSource
          .getMetadata(modelType)
          .findRelationWithPropertyPath(column);

        if (!relation || relation.isManyToManyOwner) {
          continue;
        }

        const [sql]: [string, Array<unknown>] = ListEntries.getDelete({
          manager,
          modelType,
          column,
          rowId: ROW,
          ids: [LABEL_1],
        })!.getQueryAndParameters();

        expect(sql).toContain(
          `"${relation.junctionEntityMetadata!.inverseColumns[0]!.databaseName}" = $1`,
        );
      }
    }
  });
});

describe("a field that is not a list of related records", () => {
  test("has no statement: it is written in data", () => {
    expect(() => {
      ListEntries.getInsert({
        manager,
        modelType: Monitor,
        column: "name",
        rowId: ROW,
        ids: [LABEL_1],
      });
    }).toThrow("name is not a list of related records of Monitor.");
  });
});

describe("what a write does to a list it read", () => {
  test("adds the entries the list does not have, takes off the ones it has, and holds the whole list after", () => {
    const write: ListEntryWrite = ListEntries.getWrite({
      current: [LABEL_1],
      change: { add: [LABEL_1.toUpperCase(), LABEL_2], remove: [ROW] },
    });

    expect(write).toEqual({
      add: [LABEL_2],
      remove: [],
      list: [LABEL_1, LABEL_2],
    });
  });

  test("the IDs of a list as a record, a write or a client holds it", () => {
    const label: Label = new Label();
    label._id = LABEL_2;

    expect(
      ListEntries.getIds([
        { _id: LABEL_1 },
        label,
        LABEL_1.toUpperCase(),
        null,
      ]),
    ).toEqual([LABEL_1, LABEL_2]);
    expect(ListEntries.getIds(undefined)).toEqual([]);
  });

  test("a write that still holds the list worked out is written entry by entry; one a hook changed is not", () => {
    const write: ListEntryWrite = {
      add: [LABEL_2],
      remove: [],
      list: [LABEL_1, LABEL_2],
    };

    expect(
      ListEntries.isListAsWorkedOut(
        [{ _id: LABEL_2 }, { _id: LABEL_1 }],
        write,
      ),
    ).toBe(true);
    expect(ListEntries.isListAsWorkedOut([{ _id: LABEL_1 }], write)).toBe(
      false,
    );
    expect(
      ListEntries.isListAsWorkedOut(
        [{ _id: LABEL_1 }, { _id: LABEL_2 }, { _id: ROW }],
        write,
      ),
    ).toBe(false);
  });
});

describe("writing them", () => {
  test("runs the DELETE, then the INSERT, of each list, with the transaction's manager", async () => {
    const executed: Array<string> = [];
    const recording: EntityManager = new Proxy(manager, {
      get: (target: EntityManager, property: string | symbol): unknown => {
        if (property !== "createQueryBuilder") {
          return (target as unknown as Record<string | symbol, unknown>)[
            property
          ];
        }

        return (): unknown => {
          const builder: ObjectLiteral = target.createQueryBuilder();

          return new Proxy(builder, {
            get: (b: ObjectLiteral, name: string | symbol): unknown => {
              const value: unknown = b[name as string];

              if (typeof value !== "function") {
                return value;
              }

              return (...args: Array<unknown>): unknown => {
                const next: ObjectLiteral = (
                  value as (...a: Array<unknown>) => ObjectLiteral
                ).apply(b, args);

                // Every builder TypeORM hands back is recorded when it runs.
                next["execute"] = async (): Promise<void> => {
                  executed.push(next["getQueryAndParameters"]()[0]);
                };

                return next;
              };
            },
          });
        };
      },
    });

    await ListEntries.write({
      manager: recording,
      modelType: Monitor,
      rowId: ROW,
      writes: {
        labels: { add: [LABEL_2], remove: [LABEL_1], list: [LABEL_2] },
        dependsOnMonitors: { add: [], remove: [], list: [] },
      },
    });

    expect(executed).toEqual([
      'DELETE FROM "MonitorLabel" WHERE "monitorId" = $1 AND "labelId" IN ($2)',
      'INSERT INTO "MonitorLabel"("monitorId", "labelId") VALUES ($1, $2) ON CONFLICT DO NOTHING',
    ]);
  });
});
