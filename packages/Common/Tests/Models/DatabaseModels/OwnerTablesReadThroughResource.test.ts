import OwnerTableRegistry, {
  OwnerTablePair,
} from "../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dictionary from "../../../Types/Dictionary";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";

/*
 * WHO OWNS A RECORD IS READ THROUGH THE RECORD.
 *
 * The people and the teams who own a monitor, a host, a cluster, an on-call
 * policy, a dashboard or any other resource are rows of its owner tables
 * (<Resource>OwnerUser, <Resource>OwnerTeam). Every owner table is read,
 * created and deleted through the resource it owns (@CanAccessIfCanReadOn):
 * a caller sees the owners of a resource only when they may read the
 * resource itself - its labels, its owners, a private record's people, a
 * block on reading it - and adds or removes owners only of a resource they
 * may read. A caller who may read none of the resource's table reaches none
 * of its owners. Without it, a caller whose read of resources is limited to
 * some of them would list the owners of every one, and learn the others are
 * there.
 *
 * This sweeps every model. Each owner table is found by its name and has
 * exactly one relation besides its project, its owner (a user or a team) and
 * who made or removed the row: the resource it owns. It must be read through
 * that resource, and never without a read of it. The Owned scope reads the
 * same rows to decide what a caller owns (OwnerTableRegistry), so every
 * owner table it reads is one of them, under the key of the resource, by the
 * column the resource is named by here.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

const OWNER_TABLE_NAME: RegExp = /Owner(User|Team)$/;

// The relations every owner row has besides the resource it owns.
const NOT_THE_RESOURCE: Array<string> = [
  "project",
  "user",
  "team",
  "createdByUser",
  "deletedByUser",
];

interface OwnerTable {
  name: string;
  modelType: ModelType;
  // The relation to the resource it owns, and its ID column.
  resourceRelation: string;
  resourceIdColumn: string;
  resourceModelType: ModelType | undefined;
  // "user" or "team": who owns it.
  ownerRelation: string | null;
}

function getOwnerTables(): Array<OwnerTable> {
  const tables: Array<OwnerTable> = [];

  for (const modelType of MODEL_TYPES) {
    const model: BaseModel = new modelType();
    const name: string = model.tableName || modelType.name;

    if (!OWNER_TABLE_NAME.test(name)) {
      continue;
    }

    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

    const relations: Array<string> = Object.keys(columns).filter(
      (column: string): boolean => {
        return columns[column]?.type === TableColumnType.Entity;
      },
    );

    const resourceRelations: Array<string> = relations.filter(
      (relation: string): boolean => {
        return !NOT_THE_RESOURCE.includes(relation);
      },
    );

    // One resource each: the sweep below would hide a second one.
    expect([name, resourceRelations.length]).toEqual([name, 1]);

    const resourceRelation: string = resourceRelations[0]!;
    const resource: TableColumnMetadata = columns[resourceRelation]!;

    tables.push({
      name: name,
      modelType: modelType,
      resourceRelation: resourceRelation,
      resourceIdColumn: resource.manyToOneRelationColumn || "",
      resourceModelType: resource.modelType as ModelType | undefined,
      ownerRelation: name.endsWith("OwnerUser")
        ? relations.includes("user")
          ? "user"
          : null
        : relations.includes("team")
          ? "team"
          : null,
    });
  }

  return tables;
}

const OWNER_TABLES: Array<OwnerTable> = getOwnerTables();

const ownerTableNamed: (name: string) => OwnerTable | undefined = (
  name: string,
): OwnerTable | undefined => {
  return OWNER_TABLES.find((table: OwnerTable): boolean => {
    return table.name === name;
  });
};

describe("every owner table is read through the resource it owns", () => {
  test("the sweep finds the owner tables of every kind of resource", () => {
    // 37 kinds of resource carry owners, a user table and a team table each.
    expect(OWNER_TABLES.length).toBeGreaterThanOrEqual(74);

    for (const name of [
      "MonitorOwnerUser",
      "HostOwnerTeam",
      "KubernetesClusterOwnerUser",
      "OnCallDutyPolicyOwnerTeam",
      "OnCallDutyPolicyScheduleOwnerUser",
      "IncomingCallPolicyOwnerTeam",
      "DashboardOwnerUser",
      "ServiceOwnerTeam",
      "WorkflowOwnerUser",
      "ProbeOwnerTeam",
      "AIAgentOwnerUser",
      "AlertEpisodeOwnerTeam",
    ]) {
      expect([name, Boolean(ownerTableNamed(name))]).toEqual([name, true]);
    }
  });

  test("each names who owns the resource: a user or a team", () => {
    for (const table of OWNER_TABLES) {
      expect([table.name, table.ownerRelation]).toEqual([
        table.name,
        table.name.endsWith("OwnerUser") ? "user" : "team",
      ]);
    }
  });

  test("each is read through the resource it owns", () => {
    const notReadThrough: Array<string> = OWNER_TABLES.filter(
      (table: OwnerTable): boolean => {
        return (
          new table.modelType().canAccessIfCanReadOn !== table.resourceRelation
        );
      },
    ).map((table: OwnerTable): string => {
      return `${table.name} (owns its ${table.resourceRelation})`;
    });

    expect(notReadThrough).toEqual([]);
  });

  test("none is read without a read of the resource", () => {
    for (const table of OWNER_TABLES) {
      expect([
        table.name,
        Boolean(new table.modelType().isParentReadOptional),
      ]).toEqual([table.name, false]);
    }
  });

  test("the resource is named by its model, and by the ID column beside it", () => {
    for (const table of OWNER_TABLES) {
      expect([table.name, Boolean(table.resourceModelType)]).toEqual([
        table.name,
        true,
      ]);
      expect([table.name, table.resourceIdColumn]).toEqual([
        table.name,
        `${table.resourceRelation}Id`,
      ]);
    }
  });

  test("the user and the team owner tables of a resource own the same kind of resource", () => {
    const byResource: Map<string, Array<OwnerTable>> = new Map<
      string,
      Array<OwnerTable>
    >();

    for (const table of OWNER_TABLES) {
      const resource: string = table.name.replace(OWNER_TABLE_NAME, "");
      byResource.set(resource, [...(byResource.get(resource) || []), table]);
    }

    for (const [resource, tables] of byResource) {
      expect([resource, tables.length]).toEqual([resource, 2]);
      expect([resource, tables[0]!.resourceModelType]).toEqual([
        resource,
        tables[1]!.resourceModelType,
      ]);
      expect([
        resource,
        new tables[0]!.resourceModelType!().tableName || "",
      ]).toEqual([resource, resource]);
    }
  });
});

describe("the owner tables the Owned scope reads are these", () => {
  const entries: Array<[string, OwnerTablePair]> = Array.from(
    OwnerTableRegistry.entries(),
  );

  test("the registry is read", () => {
    expect(entries.length).toBeGreaterThan(20);
  });

  test.each(entries)(
    "%s: its owner tables are read through it, by the column the Owned scope reads",
    (resource: string, pair: OwnerTablePair) => {
      for (const service of [pair.ownerUserService, pair.ownerTeamService]) {
        const modelType: ModelType = service.modelType as ModelType;
        const table: OwnerTable | undefined = ownerTableNamed(
          new modelType().tableName || "",
        );

        expect(table).toBeDefined();
        expect(table!.resourceIdColumn).toBe(pair.fkColumn);
        expect(table!.resourceModelType?.name).toBe(resource);
        expect(new modelType().canAccessIfCanReadOn).toBe(
          table!.resourceRelation,
        );
      }
    },
  );
});
