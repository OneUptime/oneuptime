import Entities from "../../Models/DatabaseModels/Index";
import InventoryItem from "../../Models/DatabaseModels/InventoryItem";
import QueryUtil from "../../Server/Types/Database/QueryUtil";
import Query from "../../Types/BaseDatabase/Query";
import Includes from "../../Types/BaseDatabase/Includes";
import IncludesNone from "../../Types/BaseDatabase/IncludesNone";
import LessThan from "../../Types/BaseDatabase/LessThan";
import { getColumnAccessControlForAllColumns } from "../../Types/Database/AccessControl/ColumnAccessControl";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../Types/Database/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import ObjectID from "../../Types/ObjectID";
import EntitySource from "../../Types/Telemetry/EntitySource";
import EntityType from "../../Types/Telemetry/EntityType";
import { InventoryLiveness } from "../../Types/Telemetry/InventoryLiveness";
import { DataSource, FindOptionsWhere } from "typeorm";
import { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";

describe("inventory status is a read-only computed query column", () => {
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      entities: Entities,
      synchronize: false,
    });
    await (
      database as unknown as { buildMetadatas: () => Promise<void> }
    ).buildMetadatas();
  });

  function buildQuery(query: Query<InventoryItem>): [string, Array<unknown>] {
    return database
      .getRepository(InventoryItem)
      .createQueryBuilder("inventory")
      .setFindOptions({
        select: { _id: true, inventoryStatus: true },
        where: QueryUtil.serializeQuery(
          InventoryItem,
          query,
        ) as unknown as FindOptionsWhere<InventoryItem>,
      })
      .getQueryAndParameters();
  }

  test("TypeORM excludes status from inserts, updates and physical schema columns", () => {
    const column: ColumnMetadata = database
      .getMetadata(InventoryItem)
      .findColumnWithPropertyName("inventoryStatus")!;
    expect(column.isVirtualProperty).toBe(true);
    expect(column.isInsert).toBe(false);
    expect(column.isUpdate).toBe(false);
    expect(column.query).toBeDefined();
  });

  test("model metadata allows reads and filtering but rejects client writes", () => {
    const model: InventoryItem = new InventoryItem();
    expect(model.getTableColumnMetadata("inventoryStatus").type).toBe(
      TableColumnType.ShortText,
    );
    const control: ColumnAccessControl =
      getColumnAccessControlForAllColumns(model)["inventoryStatus"]!;
    expect(control.read.length).toBeGreaterThan(0);
    expect(control.create).toEqual([]);
    expect(control.update).toEqual([]);
  });

  test.each([false, true])(
    "the real query compiler uses CASE for a status selection (negated: %s)",
    (negated: boolean) => {
      const values: Array<string> = [
        InventoryLiveness.Live,
        InventoryLiveness.Never,
      ];
      const [sql, parameters]: [string, Array<unknown>] = buildQuery({
        inventoryStatus: negated
          ? new IncludesNone(values)
          : new Includes(values),
      });
      const where: string = sql.slice(sql.indexOf("WHERE"));
      expect(where).toContain("CASE");
      expect(where).toContain('"inventory"."source"');
      expect(where).toContain('"inventory"."lastSeenAt"');
      expect(where).not.toContain('"inventory"."inventoryStatus"');
      expect(where).toContain(negated ? "NOT IN" : " IN");
      expect(parameters).toEqual(values);
      expect(sql).toContain('AS "inventory_inventoryStatus"');
    },
  );

  test("status composes with type, source, dates, project and archive filters", () => {
    const projectId: ObjectID = ObjectID.generate();
    const before: Date = new Date("2026-09-06T12:00:00.000Z");
    const [sql, parameters]: [string, Array<unknown>] = buildQuery({
      projectId,
      entityType: new Includes([EntityType.Service]),
      source: EntitySource.Discovered,
      lastSeenAt: new LessThan(before.toISOString()),
      isArchived: false,
      inventoryStatus: new Includes([InventoryLiveness.Stale]),
    });
    for (const column of [
      "projectId",
      "entityType",
      "source",
      "lastSeenAt",
      "isArchived",
    ]) {
      expect(sql).toContain(`"inventory"."${column}"`);
    }
    expect(parameters).toEqual(
      expect.arrayContaining([
        projectId.toString(),
        EntityType.Service,
        EntitySource.Discovered,
        before.toISOString(),
        false,
        InventoryLiveness.Stale,
      ]),
    );
  });

  test("API serialization preserves status negation and multiple values", () => {
    const payload: JSONObject = JSON.parse(
      JSON.stringify(
        JSONFunctions.serialize({
          inventoryStatus: new IncludesNone([
            InventoryLiveness.Stale,
            InventoryLiveness.Never,
          ]),
        }),
      ),
    );
    const query: Query<InventoryItem> = JSONFunctions.deserialize(
      payload,
    ) as Query<InventoryItem>;
    expect(query.inventoryStatus).toBeInstanceOf(IncludesNone);
    const [sql, parameters]: [string, Array<unknown>] = buildQuery(query);
    expect(sql).toContain("NOT IN");
    expect(parameters).toEqual([
      InventoryLiveness.Stale,
      InventoryLiveness.Never,
    ]);
  });
});
