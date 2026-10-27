import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import ColumnPermissions from "../../../../../Server/Types/Database/Permissions/ColumnPermission";
import CreateScopeException from "../../../../../Server/Types/Database/Permissions/CreateScopeException";
import CreateScopePermission from "../../../../../Server/Types/Database/Permissions/CreateScopePermission";
import DeletePermission from "../../../../../Server/Types/Database/Permissions/DeletePermission";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import OwnerTableRegistry, {
  OwnerTablePair,
} from "../../../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import WorkflowPrincipal from "../../../../../Server/Utils/Workflow/WorkflowPrincipal";
import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { OwnedThroughMetadata } from "../../../../../Types/Database/AccessControl/OwnedThrough";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import { TableColumnMetadata } from "../../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../../Types/Database/TableColumnType";
import Dictionary from "../../../../../Types/Dictionary";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { meetsCondition } from "../../../TestingUtils/QueryConditions";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { withLabelJoinTables } from "../../../TestingUtils/LabelJoinTables";
import { isReadByEveryReader } from "../../../TestingUtils/OwnedScopeKinds";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../../../Server/Utils/Logger");

/*
 * AN OWNED-SCOPE GRANT ADDS AND REMOVES OWNERS ONLY ON RESOURCES THE MEMBER
 * OWNS.
 *
 * Who owns a resource is what the Owned scope reads to decide what a member
 * may manage. So an owner row is owned through the resource it names
 * (OwnedScopePermission.getOwnedThrough): a member whose permission to add
 * or remove owners is scoped to Owned adds and removes them only on the
 * resources they or one of their teams own, however many more they may
 * read - "see every monitor, manage your own" stays exactly that. Reading
 * owners still follows the resource's own read rule.
 *
 * This sweeps every kind the Owned scope narrows (OwnerTableRegistry), both
 * of its owner tables (people and teams):
 *
 *   - each owner table is owned through its resource, by the column the
 *     registry reads owners by, and no other model is taken for one;
 *   - a member who reads every resource of the kind and may add and remove
 *     its owners only on their own: a create goes only on a resource they
 *     own, or on the one they are creating (a create form's owners), and is
 *     refused saying so on any other; a change and a delete reach only the
 *     owner rows of the resources they own; a read reaches the owners of
 *     every resource they read - of every resource of a kind other records
 *     are set up with (a probe, a template, an on-call schedule), which its
 *     readers all read whatever their scope (TestingUtils/OwnedScopeKinds);
 *   - the same grants over the whole project, a role that cannot be scoped,
 *     a workflow step (which acts as a Project Admin) and OneUptime itself
 *     reach every resource;
 *   - an owner is added or removed, never moved: no column of any owner
 *     table can be changed;
 *   - the rule follows the registry: every owner table of the schema names
 *     a kind the registry holds (OwnedScopeEveryKindWithOwners holds the
 *     kinds themselves to it), and a kind taken out of the registry leaves
 *     its owner tables as the kind is, held to the rule again once it is
 *     back - with no other change.
 *
 * What the member owns is stubbed (the owner tables are not read here,
 * except where the lookup itself is asked); OwnedRecordsDeletePostgres runs
 * the rule against Postgres, through the routes.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

const PROJECT_ID: ObjectID = new ObjectID(
  "5b0c1d2e-3f4a-4b5c-8d6e-7f8a9b0c1d2e",
);
const USER_ID: ObjectID = new ObjectID("6c1d2e3f-4a5b-4c6d-9e7f-8a9b0c1d2e3f");
const TEAM_ID: ObjectID = new ObjectID("7d2e3f4a-5b6c-4d7e-af8a-9b0c1d2e3f4a");

// The resource the member owns, another one, and one being created.
const OWNED_ID: string = "8e3f4a5b-6c7d-4e8f-8a9b-0c1d2e3f4a5b";
const OTHER_ID: string = "9f4a5b6c-7d8e-4f9a-9b0c-1d2e3f4a5b6c";
const PENDING_ID: string = "a05b6c7d-8e9f-4a0b-8c1d-2e3f4a5b6c7d";

// The owner a row names: a person, or a team.
const OWNER_ID: string = "b16c7d8e-9f0a-4b1c-9d2e-3f4a5b6c7d8e";

// What the Owned scope narrows a query to when nothing is owned.
const ZERO_ID: string = ObjectID.getZeroObjectID().toString();

const OWNER_TABLE_NAME: RegExp = /^(.+)Owner(User|Team)$/;

// One owner table of a kind the Owned scope narrows.
interface OwnerTable {
  name: string;
  // The registry's key: "Monitor".
  kind: string;
  modelType: ModelType;
  // The resource its rows name, and the column they name it by.
  resourceType: ModelType;
  fkColumn: string;
  ownerColumn: "userId" | "teamId";
  pair: OwnerTablePair;
}

function modelNamed(name: string): ModelType | undefined {
  return MODEL_TYPES.find((modelType: ModelType): boolean => {
    return modelType.name === name;
  });
}

// The relation column an owner table names `kind` by, if any.
function resourceRelationOf(
  ownerTable: ModelType,
  kind: string,
): TableColumnMetadata | undefined {
  const model: BaseModel = new ownerTable();

  for (const column of model.getTableColumns().columns) {
    const metadata: TableColumnMetadata | undefined =
      model.getTableColumnMetadata(column);

    if (
      metadata &&
      metadata.type === TableColumnType.Entity &&
      metadata.modelType &&
      (metadata.modelType as ModelType).name === kind
    ) {
      return metadata;
    }
  }

  return undefined;
}

function ownerTablesOf(kind: string, pair: OwnerTablePair): Array<OwnerTable> {
  return [pair.ownerUserService, pair.ownerTeamService].map(
    (service: { modelType: ModelType }): OwnerTable => {
      const modelType: ModelType = service.modelType;
      const relation: TableColumnMetadata | undefined = resourceRelationOf(
        modelType,
        kind,
      );

      if (!relation || relation.manyToOneRelationColumn !== pair.fkColumn) {
        throw new Error(
          `${modelType.name} names no ${kind} by ${pair.fkColumn}.`,
        );
      }

      return {
        name: modelType.name,
        kind: kind,
        modelType: modelType,
        resourceType: relation.modelType as ModelType,
        fkColumn: pair.fkColumn,
        ownerColumn: modelType.name.endsWith("OwnerUser") ? "userId" : "teamId",
        pair: pair,
      };
    },
  );
}

const OWNER_TABLES: Array<OwnerTable> = Array.from(
  OwnerTableRegistry.entries(),
).flatMap(([kind, pair]: [string, OwnerTablePair]): Array<OwnerTable> => {
  return ownerTablesOf(kind, pair);
});

// Every owner table of the schema, found by its name, and the kind it owns.
interface AnyOwnerTable {
  modelType: ModelType;
  kind: string;
}

const ALL_OWNER_TABLES: Array<AnyOwnerTable> = MODEL_TYPES.filter(
  (modelType: ModelType): boolean => {
    return OWNER_TABLE_NAME.test(new modelType().tableName || "");
  },
).map((modelType: ModelType): AnyOwnerTable => {
  return {
    modelType: modelType,
    kind: (new modelType().tableName || "").replace(OWNER_TABLE_NAME, "$1"),
  };
});

// The permissions of a model's list for an operation that a scope limits.
function scopeable(
  modelType: ModelType,
  type: DatabaseRequestType,
): Array<Permission> {
  return TablePermission.getTablePermission(modelType, type).filter(
    (permission: Permission): boolean => {
      return PermissionHelper.isScopeApplicable(permission);
    },
  );
}

function unique(permissions: Array<Permission>): Array<Permission> {
  return Array.from(new Set<Permission>(permissions));
}

// A row of the member's team: an Owned one reaches what that team owns.
function row(permission: Permission, scope: PermissionScope): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    scope: scope,
    teamId: TEAM_ID,
  };
}

function rowsAt(
  permissions: Array<Permission>,
  scope: PermissionScope,
): Array<UserPermission> {
  return permissions.map((permission: Permission): UserPermission => {
    return row(permission, scope);
  });
}

// A member of the project whose team holds `rows`.
function memberWith(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTeamIds: [TEAM_ID],
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: rows,
      },
    },
    ...ON_HIGHEST_PLAN,
  } as DatabaseCommonInteractionProps;
}

// The permissions that let a member add, change or remove owners of a kind.
function ownerWritePermissions(table: OwnerTable): Array<Permission> {
  return unique([
    ...scopeable(table.modelType, DatabaseRequestType.Create),
    ...scopeable(table.modelType, DatabaseRequestType.Update),
    ...scopeable(table.modelType, DatabaseRequestType.Delete),
  ]);
}

/*
 * The permissions that let a member read the resources of a kind and their
 * owners, and nothing more: none that also lets them add or remove owners.
 */
function readPermissions(table: OwnerTable): Array<Permission> {
  const writes: Array<Permission> = ownerWritePermissions(table);

  return unique([
    ...scopeable(table.resourceType, DatabaseRequestType.Read),
    ...scopeable(table.modelType, DatabaseRequestType.Read),
  ]).filter((permission: Permission): boolean => {
    return !writes.includes(permission);
  });
}

/*
 * "See every resource, manage your own": a member whose permissions to add
 * and remove owners of the kind are scoped to Owned, beside a read of every
 * resource of the kind and of their owners over the whole project.
 */
function readsEveryManagesOwn(
  table: OwnerTable,
): DatabaseCommonInteractionProps {
  return memberWith([
    ...rowsAt(ownerWritePermissions(table), PermissionScope.Owned),
    ...rowsAt(readPermissions(table), PermissionScope.All),
  ]);
}

// The same permissions, every one of them at `scope`.
function everyGrantAt(
  table: OwnerTable,
  scope: PermissionScope,
): DatabaseCommonInteractionProps {
  return memberWith(
    rowsAt(
      unique([...ownerWritePermissions(table), ...readPermissions(table)]),
      scope,
    ),
  );
}

// An owner row of `table` naming the resource `resourceId`.
function ownerRowOn(table: OwnerTable, resourceId: string | null): BaseModel {
  const owner: BaseModel = new table.modelType();

  owner.setColumnValue("projectId", PROJECT_ID);
  owner.setColumnValue(table.ownerColumn, new ObjectID(OWNER_ID));

  if (resourceId) {
    owner.setColumnValue(table.fkColumn, new ObjectID(resourceId));
  }

  return owner;
}

// The create permission scope's check of an owner row, as a create asks it.
async function checkOwnerCreate(data: {
  table: OwnerTable;
  resourceId: string | null;
  props: DatabaseCommonInteractionProps;
  ownedParentIds?: Array<string>;
}): Promise<void> {
  await CreateScopePermission.checkCreateScope({
    modelType: data.table.modelType,
    data: ownerRowOn(data.table, data.resourceId),
    props: data.props,
    ownedParentIds: data.ownedParentIds,
    findRecordLabels: async (): Promise<Dictionary<Array<string>>> => {
      return {};
    },
    findLabelNames: async (): Promise<Array<string>> => {
      return [];
    },
  });
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

// Whether an owner row naming `value` by `column` is one the query reaches.
function reaches(
  query: Dictionary<unknown>,
  column: string,
  value: string,
): boolean {
  // The Owned scope's "nothing": the rows' own id held to the zero id.
  if (query["_id"] !== undefined && meetsCondition(query["_id"], ZERO_ID)) {
    return false;
  }

  // No condition on the column: every row is reached.
  if (query[column] === undefined) {
    return true;
  }

  return meetsCondition(query[column], value);
}

// The query a change, a delete or a read of the owner table runs with.
async function recordScopeOf(
  table: OwnerTable,
  props: DatabaseCommonInteractionProps,
  type: DatabaseRequestType,
): Promise<Dictionary<unknown>> {
  if (type === DatabaseRequestType.Delete) {
    // The delete's own entry point: the table check, the project, the rule.
    return (await DeletePermission.checkDeletePermission(
      table.modelType,
      {},
      props,
    )) as Dictionary<unknown>;
  }

  TablePermission.checkTableLevelPermissions(table.modelType, props, type);

  return (await BasePermission.addRecordScopeToQuery(
    table.modelType,
    {},
    null,
    props,
    type,
  )) as Dictionary<unknown>;
}

// What the member owns: `id`, of every kind.
function ownsOnly(id: string): void {
  jest
    .spyOn(OwnedScopePermission as never, "getAllowedResourceIds")
    .mockResolvedValue([new ObjectID(id)] as never);
}

// Runs `run` with the registry changed, and puts it back as it was, in order.
async function withRegistryChanged(
  change: () => void,
  run: () => Promise<void>,
): Promise<void> {
  const before: Array<[string, OwnerTablePair]> = Array.from(
    OwnerTableRegistry.entries(),
  );

  change();

  try {
    await run();
  } finally {
    OwnerTableRegistry.clear();

    for (const [kind, pair] of before) {
      OwnerTableRegistry.set(kind, pair);
    }
  }
}

function ownerTableNamed(name: string): OwnerTable {
  const table: OwnerTable | undefined = OWNER_TABLES.find(
    (each: OwnerTable): boolean => {
      return each.name === name;
    },
  );

  if (!table) {
    throw new Error(`No owner table named ${name}.`);
  }

  return table;
}

beforeEach(() => {
  withLabelJoinTables();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an owner row is owned through its resource", () => {
  test("the sweep finds both owner tables of every kind the Owned scope narrows", () => {
    expect(OwnerTableRegistry.size).toBeGreaterThanOrEqual(27);
    expect(OWNER_TABLES).toHaveLength(OwnerTableRegistry.size * 2);

    for (const name of [
      "MonitorOwnerUser",
      "MonitorOwnerTeam",
      "IncidentOwnerTeam",
      "AlertOwnerUser",
      "StatusPageOwnerTeam",
      "DashboardOwnerUser",
      "OnCallDutyPolicyOwnerTeam",
      "ServiceOwnerUser",
      "HostOwnerTeam",
      "KubernetesClusterOwnerUser",
      "WorkflowOwnerTeam",
      "RunbookOwnerUser",
      "ServiceLevelObjectiveOwnerTeam",
      "ScheduledMaintenanceOwnerUser",
    ]) {
      expect(ownerTableNamed(name).name).toBe(name);
    }
  });

  test.each(OWNER_TABLES)(
    "$name is owned through its $kind, by $fkColumn",
    (table: OwnerTable) => {
      const ownedThrough: OwnedThroughMetadata | null =
        OwnedScopePermission.getOwnedThrough(table.modelType);

      expect(ownedThrough).toEqual({
        fkColumn: table.fkColumn,
        parentModels: [table.resourceType],
        includeProjectScope: false,
        onlyParentModels: true,
        includeUnattributed: false,
      });

      // The very model its relation names, which is the registry's kind.
      expect(ownedThrough!.parentModels[0]).toBe(table.resourceType);
      expect(table.resourceType.name).toBe(table.kind);
      expect(OwnedScopePermission.isOwnerTable(table.modelType)).toBe(true);

      // Asked again, the same answer.
      expect(OwnedScopePermission.getOwnedThrough(table.modelType)).toBe(
        ownedThrough,
      );
    },
  );

  /*
   * The registry knows its kinds by name, and so an owner table is known by
   * its name: a second copy of its class - a module loaded twice - is the
   * same table, held to the same rule, and never left unscoped.
   */
  test.each(OWNER_TABLES)(
    "$name is known by its name: another copy of its class is held to the rule too",
    async (table: OwnerTable) => {
      const copy: ModelType = class extends table.modelType {};

      Object.defineProperty(copy, "name", { value: table.name });

      expect(copy).not.toBe(table.modelType);
      expect(copy.name).toBe(table.name);

      expect(OwnedScopePermission.isOwnerTable(copy)).toBe(true);
      expect(OwnedScopePermission.getOwnedThrough(copy)).toEqual({
        fkColumn: table.fkColumn,
        parentModels: [table.resourceType],
        includeProjectScope: false,
        onlyParentModels: true,
        includeUnattributed: false,
      });

      ownsOnly(OWNED_ID);

      const props: DatabaseCommonInteractionProps = readsEveryManagesOwn(table);

      expect(
        OwnedScopePermission.isLimitedToOwnedRecords(
          copy,
          props,
          DatabaseRequestType.Delete,
        ),
      ).toBe(true);

      await expect(
        CreateScopePermission.checkCreateScope({
          modelType: copy,
          data: ownerRowOn(table, OTHER_ID),
          props: props,
          findRecordLabels: async (): Promise<Dictionary<Array<string>>> => {
            return {};
          },
          findLabelNames: async (): Promise<Array<string>> => {
            return [];
          },
        }),
      ).rejects.toThrow(CreateScopeException);
    },
  );

  test("a class of no name, or of another name, is no owner table", () => {
    const monitorOwners: OwnerTable = ownerTableNamed("MonitorOwnerUser");
    const unnamed: ModelType = class extends monitorOwners.modelType {};

    Object.defineProperty(unnamed, "name", { value: "" });

    const renamed: ModelType = class extends monitorOwners.modelType {};

    Object.defineProperty(renamed, "name", { value: "MonitorOwnerUserCopy" });

    for (const modelType of [unnamed, renamed]) {
      expect(OwnedScopePermission.isOwnerTable(modelType)).toBe(false);
    }
  });

  test("no other model is taken for an owner table, and every other model keeps what it declares", () => {
    const ownerTableTypes: Set<ModelType> = new Set<ModelType>(
      OWNER_TABLES.map((table: OwnerTable): ModelType => {
        return table.modelType;
      }),
    );

    let otherModels: number = 0;

    for (const modelType of MODEL_TYPES) {
      if (ownerTableTypes.has(modelType)) {
        continue;
      }

      otherModels++;

      expect([
        modelType.name,
        OwnedScopePermission.isOwnerTable(modelType),
      ]).toEqual([modelType.name, false]);
      expect([
        modelType.name,
        OwnedScopePermission.getOwnedThrough(modelType),
      ]).toEqual([modelType.name, new modelType().ownedThrough || null]);
    }

    expect(otherModels).toBeGreaterThan(300);
  });

  test.each(OWNER_TABLES)(
    "$name: what a member owns is read off the owners of the $kind",
    async (table: OwnerTable) => {
      const OWNED_BY_THEM: string = "c27d8e9f-0a1b-4c2d-8e3f-4a5b6c7d8e9f";
      const OWNED_BY_THEIR_TEAM: string =
        "d38e9f0a-1b2c-4d3e-9f4a-5b6c7d8e9f0a";

      interface FindBy {
        query: Dictionary<unknown>;
        select: Dictionary<unknown>;
        props: DatabaseCommonInteractionProps;
      }

      const asked: Array<{ owners: string; query: Dictionary<unknown> }> = [];

      const answer: (
        owners: string,
        id: string,
      ) => (findBy: FindBy) => Promise<Array<Dictionary<unknown>>> = (
        owners: string,
        id: string,
      ): ((findBy: FindBy) => Promise<Array<Dictionary<unknown>>>) => {
        return async (findBy: FindBy): Promise<Array<Dictionary<unknown>>> => {
          asked.push({ owners: owners, query: findBy.query });

          // Read by OneUptime, for the column the registry names.
          expect(findBy.props.isRoot).toBe(true);
          expect(findBy.select).toEqual({ [table.fkColumn]: true });

          return [{ [table.fkColumn]: new ObjectID(id) }];
        };
      };

      jest
        .spyOn(table.pair.ownerUserService, "findBy")
        .mockImplementation(answer("people", OWNED_BY_THEM) as never);
      jest
        .spyOn(table.pair.ownerTeamService, "findBy")
        .mockImplementation(answer("teams", OWNED_BY_THEIR_TEAM) as never);

      const ownedIds: Array<string> = (
        await OwnedScopePermission.getOwnedIds(
          table.modelType,
          readsEveryManagesOwn(table),
          [TEAM_ID],
        )
      )
        .map((id: ObjectID): string => {
          return id.toString();
        })
        .sort();

      expect(ownedIds).toEqual([OWNED_BY_THEM, OWNED_BY_THEIR_TEAM].sort());

      // The people and the team owners of the kind, in this project.
      expect(
        asked
          .map((each: { owners: string }): string => {
            return each.owners;
          })
          .sort(),
      ).toEqual(["people", "teams"]);

      for (const each of asked) {
        expect(String(each.query["projectId"])).toBe(PROJECT_ID.toString());
      }
    },
  );
});

describe("a member who reads every resource but may add and remove owners only on their own", () => {
  test.each(OWNER_TABLES)(
    "$name: the grants are what the sweep says - owner writes scoped to Owned, a read of every $kind",
    (table: OwnerTable) => {
      expect(ownerWritePermissions(table).length).toBeGreaterThan(0);

      // A read of the kind itself, not only of its owners.
      expect(
        readPermissions(table).some((permission: Permission): boolean => {
          return scopeable(
            table.resourceType,
            DatabaseRequestType.Read,
          ).includes(permission);
        }),
      ).toBe(true);
    },
  );

  test.each(OWNER_TABLES)(
    "$name: adds an owner only to a $kind they or their team own",
    async (table: OwnerTable) => {
      ownsOnly(OWNED_ID);

      const props: DatabaseCommonInteractionProps = readsEveryManagesOwn(table);

      await expect(
        checkOwnerCreate({ table, resourceId: OWNED_ID, props }),
      ).resolves.toBeUndefined();

      const refusal: unknown = await refusalOf(
        checkOwnerCreate({ table, resourceId: OTHER_ID, props }),
      );

      expect([table.name, refusal]).toEqual([
        table.name,
        expect.any(CreateScopeException),
      ]);
      expect((refusal as Error).message).toBe(
        `Your access lets you add owners only to the ${
          new table.resourceType().pluralName
        } you or your teams own.`,
      );

      // A row that names no resource at all is not one of theirs either.
      await expect(
        checkOwnerCreate({ table, resourceId: null, props }),
      ).rejects.toThrow(CreateScopeException);
    },
  );

  test.each(OWNER_TABLES)(
    "$name: adds the owners picked for a $kind they are creating, which is theirs once saved",
    async (table: OwnerTable) => {
      ownsOnly(OWNED_ID);

      for (const pendingId of [PENDING_ID, PENDING_ID.toUpperCase()]) {
        await expect(
          checkOwnerCreate({
            table,
            resourceId: PENDING_ID,
            props: readsEveryManagesOwn(table),
            ownedParentIds: [pendingId],
          }),
        ).resolves.toBeUndefined();
      }
    },
  );

  test.each(OWNER_TABLES)(
    "$name: removes and changes only the owner rows of a $kind they or their team own",
    async (table: OwnerTable) => {
      ownsOnly(OWNED_ID);

      const props: DatabaseCommonInteractionProps = readsEveryManagesOwn(table);

      for (const type of [
        DatabaseRequestType.Delete,
        DatabaseRequestType.Update,
      ]) {
        const query: Dictionary<unknown> = await recordScopeOf(
          table,
          props,
          type,
        );

        expect([
          table.name,
          type,
          reaches(query, table.fkColumn, OWNED_ID),
          reaches(query, table.fkColumn, OTHER_ID),
        ]).toEqual([table.name, type, true, false]);
      }
    },
  );

  test.each(OWNER_TABLES)(
    "$name: still reads the owners of every $kind they may read",
    async (table: OwnerTable) => {
      ownsOnly(OWNED_ID);

      const query: Dictionary<unknown> = await recordScopeOf(
        table,
        readsEveryManagesOwn(table),
        DatabaseRequestType.Read,
      );

      expect([table.name, reaches(query, table.fkColumn, OTHER_ID)]).toEqual([
        table.name,
        true,
      ]);
    },
  );

  /*
   * Who owns a resource is read through the resource: a read of owners
   * follows the resource's read, whatever scope the permission on owners
   * alone carries. A member who reads every resource of the kind by a
   * permission on the kind alone (Read Monitor), and whose every permission
   * on its owners is scoped to Owned, reads the owners of every resource.
   */
  test.each(OWNER_TABLES)(
    "$name: reads the owners of every $kind they may read, though every permission on owners is scoped to Owned",
    async (table: OwnerTable) => {
      ownsOnly(OWNED_ID);

      const onOwners: Array<Permission> = unique([
        ...ownerWritePermissions(table),
        ...scopeable(table.modelType, DatabaseRequestType.Read),
      ]);
      const onTheKindAlone: Array<Permission> = scopeable(
        table.resourceType,
        DatabaseRequestType.Read,
      ).filter((permission: Permission): boolean => {
        return !onOwners.includes(permission);
      });

      expect([table.name, onTheKindAlone.length > 0]).toEqual([
        table.name,
        true,
      ]);

      const props: DatabaseCommonInteractionProps = memberWith([
        ...rowsAt(onOwners, PermissionScope.Owned),
        ...rowsAt(onTheKindAlone, PermissionScope.All),
      ]);

      expect([
        table.name,
        reaches(
          await recordScopeOf(table, props, DatabaseRequestType.Read),
          table.fkColumn,
          OTHER_ID,
        ),
      ]).toEqual([table.name, true]);

      // And adds and removes them only on their own.
      expect([
        table.name,
        reaches(
          await recordScopeOf(table, props, DatabaseRequestType.Delete),
          table.fkColumn,
          OTHER_ID,
        ),
      ]).toEqual([table.name, false]);
      await expect(
        checkOwnerCreate({ table, resourceId: OTHER_ID, props }),
      ).rejects.toThrow(CreateScopeException);
    },
  );
});

describe("everyone else", () => {
  test.each(OWNER_TABLES)(
    "$name: a member whose every grant is scoped to Owned reads, adds and removes owners only on their own",
    async (table: OwnerTable) => {
      ownsOnly(OWNED_ID);

      const props: DatabaseCommonInteractionProps = everyGrantAt(
        table,
        PermissionScope.Owned,
      );

      for (const type of [
        DatabaseRequestType.Read,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        const query: Dictionary<unknown> = await recordScopeOf(
          table,
          props,
          type,
        );

        /*
         * Owners are read through the resource: those of every resource of
         * a kind its readers all read, whatever their scope.
         */
        const readsEvery: boolean =
          type === DatabaseRequestType.Read && isReadByEveryReader(table.kind);

        expect([
          table.name,
          type,
          reaches(query, table.fkColumn, OWNED_ID),
          reaches(query, table.fkColumn, OTHER_ID),
        ]).toEqual([table.name, type, true, readsEvery]);
      }

      await expect(
        checkOwnerCreate({ table, resourceId: OTHER_ID, props }),
      ).rejects.toThrow(CreateScopeException);
    },
  );

  test.each(OWNER_TABLES)(
    "$name: the same grants over the whole project reach every $kind",
    async (table: OwnerTable) => {
      ownsOnly(OWNED_ID);

      const props: DatabaseCommonInteractionProps = everyGrantAt(
        table,
        PermissionScope.All,
      );

      await expect(
        checkOwnerCreate({ table, resourceId: OTHER_ID, props }),
      ).resolves.toBeUndefined();

      for (const type of [
        DatabaseRequestType.Read,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        expect([
          table.name,
          type,
          reaches(
            await recordScopeOf(table, props, type),
            table.fkColumn,
            OTHER_ID,
          ),
        ]).toEqual([table.name, type, true]);
      }
    },
  );

  test.each(OWNER_TABLES)(
    "$name: one grant over the whole project beside the owned ones is the one that decides",
    async (table: OwnerTable) => {
      ownsOnly(OWNED_ID);

      // The owned grants, and one of the operation's own over the whole project.
      const besideOwned: (
        type: DatabaseRequestType,
      ) => DatabaseCommonInteractionProps = (
        type: DatabaseRequestType,
      ): DatabaseCommonInteractionProps => {
        const broader: Permission | undefined = scopeable(
          table.modelType,
          type,
        )[0];

        expect([table.name, type, Boolean(broader)]).toEqual([
          table.name,
          type,
          true,
        ]);

        return memberWith([
          ...rowsAt(ownerWritePermissions(table), PermissionScope.Owned),
          row(broader!, PermissionScope.All),
          ...rowsAt(readPermissions(table), PermissionScope.All),
        ]);
      };

      await expect(
        checkOwnerCreate({
          table,
          resourceId: OTHER_ID,
          props: besideOwned(DatabaseRequestType.Create),
        }),
      ).resolves.toBeUndefined();

      expect(
        reaches(
          await recordScopeOf(
            table,
            besideOwned(DatabaseRequestType.Delete),
            DatabaseRequestType.Delete,
          ),
          table.fkColumn,
          OTHER_ID,
        ),
      ).toBe(true);
    },
  );

  test.each(OWNER_TABLES)(
    "$name: a role that cannot be scoped reaches every $kind, whatever scope its row carries",
    async (table: OwnerTable) => {
      ownsOnly(OWNED_ID);

      for (const role of [Permission.ProjectOwner, Permission.ProjectAdmin]) {
        const props: DatabaseCommonInteractionProps = memberWith([
          row(role, PermissionScope.Owned),
        ]);

        await expect(
          checkOwnerCreate({ table, resourceId: OTHER_ID, props }),
        ).resolves.toBeUndefined();

        for (const type of [
          DatabaseRequestType.Update,
          DatabaseRequestType.Delete,
        ]) {
          expect([
            table.name,
            role,
            type,
            reaches(
              await recordScopeOf(table, props, type),
              table.fkColumn,
              OTHER_ID,
            ),
          ]).toEqual([table.name, role, type, true]);
        }
      }
    },
  );

  test.each(OWNER_TABLES)(
    "$name: a workflow step, which acts as a Project Admin, adds and removes owners of any $kind",
    async (table: OwnerTable) => {
      ownsOnly(OWNED_ID);

      const props: DatabaseCommonInteractionProps = {
        ...WorkflowPrincipal.getPropsWithoutPlan({
          projectId: PROJECT_ID,
          workflowId: ObjectID.generate(),
        }),
        ...ON_HIGHEST_PLAN,
      };

      await expect(
        checkOwnerCreate({ table, resourceId: OTHER_ID, props }),
      ).resolves.toBeUndefined();

      expect(
        reaches(
          await recordScopeOf(table, props, DatabaseRequestType.Delete),
          table.fkColumn,
          OTHER_ID,
        ),
      ).toBe(true);
    },
  );

  test("OneUptime itself, and a master admin, add and remove any owner", async () => {
    ownsOnly(OWNED_ID);

    for (const table of OWNER_TABLES) {
      for (const props of [
        { isRoot: true, tenantId: PROJECT_ID },
        { isMasterAdmin: true, tenantId: PROJECT_ID, userId: USER_ID },
      ] as Array<DatabaseCommonInteractionProps>) {
        await expect(
          checkOwnerCreate({ table, resourceId: OTHER_ID, props }),
        ).resolves.toBeUndefined();

        for (const type of [
          DatabaseRequestType.Update,
          DatabaseRequestType.Delete,
        ]) {
          expect([
            table.name,
            type,
            OwnedScopePermission.isLimitedToOwnedRecords(
              table.modelType,
              props,
              type,
            ),
          ]).toEqual([table.name, type, false]);
        }
      }
    }
  });

  test("a permission limited to labels beside the owned ones is the one that decides, as for any create", async () => {
    ownsOnly(OWNED_ID);

    const monitorOwners: OwnerTable = ownerTableNamed("MonitorOwnerUser");
    const PRODUCTION: string = "e49f0a1b-2c3d-4e4f-8a5b-6c7d8e9f0a1b";

    const props: DatabaseCommonInteractionProps = memberWith([
      row(Permission.MonitorAdmin, PermissionScope.Owned),
      {
        ...row(Permission.MonitorMember, PermissionScope.Labels),
        labelIds: [new ObjectID(PRODUCTION)],
      },
      row(Permission.MonitorViewer, PermissionScope.All),
    ]);

    const checkOn: (labelIds: Array<string>) => Promise<void> = async (
      labelIds: Array<string>,
    ): Promise<void> => {
      await CreateScopePermission.checkCreateScope({
        modelType: monitorOwners.modelType,
        data: ownerRowOn(monitorOwners, OTHER_ID),
        props: props,
        findRecordLabels: async (): Promise<Dictionary<Array<string>>> => {
          return { [OTHER_ID]: labelIds };
        },
        findLabelNames: async (): Promise<Array<string>> => {
          return ["Production"];
        },
      });
    };

    // A monitor carrying the label, owned or not.
    await expect(checkOn([PRODUCTION])).resolves.toBeUndefined();

    // One without it is refused by the labels, not by the owners.
    await expect(checkOn([])).rejects.toThrow(
      "Your access lets you create Monitor User Owners only for records with one of these labels: Production.",
    );
  });
});

describe("an owner is added or removed, never moved", () => {
  test("every owner table of the schema is found", () => {
    // Every kind that carries owners: a people table and a team table each.
    expect(ALL_OWNER_TABLES.length).toBeGreaterThanOrEqual(74);
    expect(ALL_OWNER_TABLES.length % 2).toBe(0);
  });

  test("no column of any owner table can be changed, by anyone", () => {
    const excluded: Array<string> = ColumnPermissions.getExcludedColumnNames();
    const changeable: Array<string> = [];

    for (const { modelType } of ALL_OWNER_TABLES) {
      const model: BaseModel = new modelType();

      for (const column of model.getTableColumns().columns) {
        if (excluded.includes(column)) {
          continue;
        }

        const update: Array<Permission> =
          model.getColumnAccessControlFor(column)?.update || [];

        if (update.length > 0) {
          changeable.push(`${modelType.name}.${column}: ${update.join(", ")}`);
        }
      }
    }

    expect(changeable).toEqual([]);
  });

  test.each(OWNER_TABLES)(
    "$name: even a Project Owner cannot point a row at another $kind or owner",
    (table: OwnerTable) => {
      for (const column of [table.fkColumn, table.ownerColumn, "projectId"]) {
        const change: BaseModel = new table.modelType();
        change.setColumnValue(column, ObjectID.generate());

        expect(() => {
          ColumnPermissions.checkDataColumnPermissions(
            table.modelType,
            change,
            memberWith([row(Permission.ProjectOwner, PermissionScope.All)]),
            DatabaseRequestType.Update,
          );
        }).toThrow(`${new table.modelType().singularName}`);
      }
    },
  );
});

describe("the rule follows the registry", () => {
  test("every owner table of the schema names a kind the registry holds: none is left as its kind once was", () => {
    // Both owner tables of every kind, as the sweep above takes them.
    expect(ALL_OWNER_TABLES.length).toBe(OwnerTableRegistry.size * 2);

    const unregistered: Array<string> = ALL_OWNER_TABLES.filter(
      (table: AnyOwnerTable): boolean => {
        return !OwnerTableRegistry.has(table.kind);
      },
    ).map((table: AnyOwnerTable): string => {
      return `${table.modelType.name}: its ${table.kind} is not in OwnerTableRegistry, so a grant scoped to Owned would add and remove its owners on every one`;
    });

    expect(unregistered).toEqual([]);

    for (const { modelType } of ALL_OWNER_TABLES) {
      expect([
        modelType.name,
        OwnedScopePermission.isOwnerTable(modelType),
      ]).toEqual([modelType.name, true]);
    }
  });

  test.each(Array.from(OwnerTableRegistry.keys()))(
    "%s: taken out of the registry, its owner tables are left as the kind is, and held to the rule again once it is back",
    async (kind: string) => {
      ownsOnly(OWNED_ID);

      const pair: OwnerTablePair = OwnerTableRegistry.get(kind)!;
      const tables: Array<OwnerTable> = ownerTablesOf(kind, pair);
      const kindType: ModelType = modelNamed(kind)!;

      // What the member is held to while the kind is registered.
      const expectHeld: () => Promise<void> = async (): Promise<void> => {
        for (const table of tables) {
          const props: DatabaseCommonInteractionProps =
            readsEveryManagesOwn(table);

          expect([
            table.name,
            OwnedScopePermission.isOwnerTable(table.modelType),
            OwnedScopePermission.getOwnedThrough(table.modelType)?.fkColumn,
            OwnedScopePermission.isLimitedToOwnedRecords(
              table.modelType,
              props,
              DatabaseRequestType.Delete,
            ),
          ]).toEqual([table.name, true, pair.fkColumn, true]);

          await expect(
            checkOwnerCreate({ table, resourceId: OTHER_ID, props }),
          ).rejects.toThrow(CreateScopeException);

          await expect(
            checkOwnerCreate({ table, resourceId: OWNED_ID, props }),
          ).resolves.toBeUndefined();
        }
      };

      await expectHeld();

      await withRegistryChanged(
        (): void => {
          OwnerTableRegistry.delete(kind);
        },
        async (): Promise<void> => {
          for (const table of tables) {
            const props: DatabaseCommonInteractionProps =
              readsEveryManagesOwn(table);

            expect([
              table.name,
              OwnedScopePermission.isOwnerTable(table.modelType),
              OwnedScopePermission.getOwnedThrough(table.modelType),
            ]).toEqual([table.name, false, null]);

            await expect(
              checkOwnerCreate({ table, resourceId: OTHER_ID, props }),
            ).resolves.toBeUndefined();
          }

          // Nor is the kind itself narrowed, but by a decorator of its own.
          expect([
            kind,
            OwnedScopePermission.isLimitedToOwnedRecords(
              kindType,
              memberWith(
                rowsAt(
                  scopeable(kindType, DatabaseRequestType.Delete),
                  PermissionScope.Owned,
                ),
              ),
              DatabaseRequestType.Delete,
            ),
          ]).toEqual([kind, Boolean(new kindType().isOperationalResource)]);
        },
      );

      // Back in its place, and held again.
      expect(OwnerTableRegistry.get(kind)).toBe(pair);

      await expectHeld();
    },
  );

  test("a kind taken out of the registry leaves its owner tables as it is, and they are held again once it is back", async () => {
    ownsOnly(OWNED_ID);

    const monitorOwners: OwnerTable = ownerTableNamed("MonitorOwnerTeam");
    const props: DatabaseCommonInteractionProps =
      readsEveryManagesOwn(monitorOwners);

    await expect(
      checkOwnerCreate({ table: monitorOwners, resourceId: OTHER_ID, props }),
    ).rejects.toThrow(CreateScopeException);

    await withRegistryChanged(
      (): void => {
        OwnerTableRegistry.delete("Monitor");
      },
      async (): Promise<void> => {
        expect(OwnedScopePermission.isOwnerTable(monitorOwners.modelType)).toBe(
          false,
        );

        await expect(
          checkOwnerCreate({
            table: monitorOwners,
            resourceId: OTHER_ID,
            props,
          }),
        ).resolves.toBeUndefined();
      },
    );

    // Back in its place.
    expect(Array.from(OwnerTableRegistry.keys())[0]).toBe("Monitor");

    await expect(
      checkOwnerCreate({ table: monitorOwners, resourceId: OTHER_ID, props }),
    ).rejects.toThrow(CreateScopeException);
  });
});
