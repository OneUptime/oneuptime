import OwnedByFilter, {
  OwnerTable,
  OwnerTablesOfKind,
} from "../../../../Server/Types/Database/OwnedByFilter";
import OwnerTableRegistry, {
  OwnerTablePair,
} from "../../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Service from "../../../../Models/DatabaseModels/Service";
import Team from "../../../../Models/DatabaseModels/Team";
import OwnedBy, { OwnedByMatch } from "../../../../Types/BaseDatabase/OwnedBy";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";
import { FindOperator, getMetadataArgsStorage } from "typeorm";
import { TableMetadataArgs } from "typeorm/metadata-args/TableMetadataArgs";

/*
 * WHICH TABLES A FILTER BY OWNERS READS, for every kind with owners.
 *
 * The filter (OwnedBy) reads the kind's two owner tables by the entries of
 * OwnerTableRegistry - the same ones the Owned permission scope reads - and
 * names their columns itself: the record by the registry's key column, a
 * person by userId, a team by teamId. A table or column it names that is not
 * the real one would fail every list filtered by its owners with a database
 * error, so each is held here to the entity TypeORM builds the table from.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

const KINDS: Array<[string, OwnerTablePair]> = Array.from(
  OwnerTableRegistry.entries(),
);

const modelNamed: (name: string) => ModelType | undefined = (
  name: string,
): ModelType | undefined => {
  return MODEL_TYPES.find((modelType: ModelType): boolean => {
    return modelType.name === name;
  });
};

// The table TypeORM creates for an entity: @Entity({ name }).
const entityTableName: (modelType: ModelType) => string | undefined = (
  modelType: ModelType,
): string | undefined => {
  const table: TableMetadataArgs | undefined = getMetadataArgsStorage()
    .tables.filter((each: TableMetadataArgs): boolean => {
      return each.target === modelType;
    })
    .pop();

  return table?.name;
};

const ADA: string = "0d4c9b2e-6a3f-4e1d-9b7a-2c5e8f1a3b60";
const SRE_TEAM: string = "2f6ebd40-8c51-4a3f-9d9c-4e7a0b3c5d82";

describe("OwnedByFilter - the owner tables a filter by owners reads", () => {
  test("every kind with owners is swept (the registry is not empty)", () => {
    // Monitors, incidents, on-call schedules and some thirty more.
    expect(KINDS.length).toBeGreaterThanOrEqual(37);
    expect(
      KINDS.map(([kind]: [string, OwnerTablePair]): string => {
        return kind;
      }),
    ).toEqual(
      expect.arrayContaining([
        "Monitor",
        "Incident",
        "Alert",
        "OnCallDutyPolicy",
        "OnCallDutyPolicySchedule",
        "AlertEpisode",
        "IncidentEpisode",
        "IncidentTemplate",
        "ScheduledMaintenanceTemplate",
        "Probe",
        "Runner",
        "ServerlessFunction",
        "CloudResource",
        "RumApplication",
        "NetworkDevice",
      ]),
    );
  });

  describe.each(KINDS)("%s", (kind: string, pair: OwnerTablePair) => {
    const kindModelType: ModelType | undefined = modelNamed(kind);

    test("is a model, and its owner tables are found by it", () => {
      expect(kindModelType).toBeDefined();

      const tables: OwnerTablesOfKind | null = OwnedByFilter.getOwnerTables(
        kindModelType!,
      );

      expect(tables).not.toBeNull();
      expect(tables!.userTable.modelType).toBe(
        pair.ownerUserService.modelType,
      );
      expect(tables!.teamTable.modelType).toBe(
        pair.ownerTeamService.modelType,
      );
    });

    test.each([
      ["userTable", "userId", "user"],
      ["teamTable", "teamId", "team"],
    ] as Array<["userTable" | "teamTable", string, string]>)(
      "its %s is the real table, with the record's key and %s",
      (
        side: "userTable" | "teamTable",
        ownerColumn: string,
        ownerRelation: string,
      ) => {
        const table: OwnerTable = OwnedByFilter.getOwnerTables(
          kindModelType!,
        )![side];
        const model: BaseModel = new table.modelType();

        // The table Postgres has, as TypeORM creates it.
        expect(table.tableName).toBe(entityTableName(table.modelType));
        expect(table.tableName).toBe(
          `${kind}Owner${side === "userTable" ? "User" : "Team"}`,
        );

        // The owner: a person or a team, by its id column.
        expect(table.ownerColumnName).toBe(ownerColumn);
        expect(model.getTableColumnMetadata(ownerColumn)?.type).toBe(
          TableColumnType.ObjectID,
        );
        const owner: TableColumnMetadata =
          model.getTableColumnMetadata(ownerRelation);
        expect(owner.manyToOneRelationColumn).toBe(ownerColumn);

        // The record owned: the registry's key column, naming this kind.
        expect(table.resourceColumnName).toBe(pair.fkColumn);
        expect(model.getTableColumnMetadata(pair.fkColumn)?.type).toBe(
          TableColumnType.ObjectID,
        );
        const resourceRelation: string | undefined = model
          .getTableColumns()
          .columns.find((column: string): boolean => {
            const metadata: TableColumnMetadata =
              model.getTableColumnMetadata(column);

            return (
              metadata?.type === TableColumnType.Entity &&
              metadata.manyToOneRelationColumn === pair.fkColumn
            );
          });
        expect(resourceRelation).toBeDefined();
        expect(
          (
            model.getTableColumnMetadata(resourceRelation!).modelType as
              | ModelType
              | undefined
          )?.name,
        ).toBe(kind);

        // Owner rows a delete marks are no owners: the column exists.
        expect(model.getTableColumnMetadata("deletedAt")).toBeDefined();
      },
    );

    test("a filter by its owners becomes a condition on its records' ids", () => {
      const condition: FindOperator<unknown> = OwnedByFilter.getIdCondition(
        kindModelType!,
        new OwnedBy({ userIds: [ADA], teamIds: [SRE_TEAM] }),
      ) as FindOperator<unknown>;

      const sql: string = condition.getSql!(`${kind}._id`);

      expect(sql).toContain(`FROM "${kind}OwnerUser"`);
      expect(sql).toContain(`FROM "${kind}OwnerTeam"`);
      expect(sql).toContain(`"${kind}OwnerUser"."${pair.fkColumn}"`);
      expect(sql).toContain(`"${kind}OwnerTeam"."teamId" IN (`);
    });
  });

  test("a service's owners are read by serviceId, the column their tables have", () => {
    const tables: OwnerTablesOfKind = OwnedByFilter.getOwnerTables(Service)!;

    expect(tables.userTable.resourceColumnName).toBe("serviceId");
    expect(tables.teamTable.resourceColumnName).toBe("serviceId");

    const sql: string = (
      OwnedByFilter.getIdCondition(
        Service,
        new OwnedBy({ teamIds: [SRE_TEAM] }),
      ) as FindOperator<unknown>
    ).getSql!("Service._id");

    expect(sql).toContain('"ServiceOwnerTeam"."serviceId"');
    expect(sql).not.toContain("primaryEntityId");
  });

  test.each([Label, Team])(
    "a kind without owners (%p) has no owner tables, and a filter by them is refused",
    (modelType: ModelType) => {
      expect(OwnedByFilter.getOwnerTables(modelType)).toBeNull();

      let error: unknown = undefined;

      try {
        OwnedByFilter.getIdCondition(
          modelType,
          new OwnedBy({ match: OwnedByMatch.NoOwner }),
        );
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe(
        `${new modelType().pluralName} have no owners, so they cannot be filtered by their owners.`,
      );
    },
  );

  test("the four matches reach the SQL of each kind the same way", () => {
    for (const match of Object.values(OwnedByMatch)) {
      const namesOwners: boolean =
        match === OwnedByMatch.AnyOf || match === OwnedByMatch.NoneOf;
      const sql: string = (
        OwnedByFilter.getIdCondition(
          Monitor,
          new OwnedBy(
            namesOwners
              ? { match: match, teamIds: [SRE_TEAM] }
              : { match: match },
          ),
        ) as FindOperator<unknown>
      ).getSql!("Monitor._id");

      expect({
        match,
        exists:
          match === OwnedByMatch.NoneOf || match === OwnedByMatch.NoOwner,
      }).toEqual({ match, exists: sql.includes("NOT EXISTS") });
    }
  });
});
