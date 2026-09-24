import AllModelTypes, {
  getModelTypeByName,
} from "../../../Models/DatabaseModels/Index";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "../../../Models/DatabaseModels/DatabaseServerEndpoint";
import DatabaseServerFeed, {
  DatabaseServerFeedEventType,
} from "../../../Models/DatabaseModels/DatabaseServerFeed";
import DatabaseServerLabelRule from "../../../Models/DatabaseModels/DatabaseServerLabelRule";
import DatabaseServerOwnerRule from "../../../Models/DatabaseModels/DatabaseServerOwnerRule";
import DatabaseServerOwnerTeam from "../../../Models/DatabaseModels/DatabaseServerOwnerTeam";
import DatabaseServerOwnerUser from "../../../Models/DatabaseModels/DatabaseServerOwnerUser";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Incident from "../../../Models/DatabaseModels/Incident";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Label from "../../../Models/DatabaseModels/Label";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { OwnedThroughMetadata } from "../../../Types/Database/AccessControl/OwnedThrough";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { getUniqueColumnsBy } from "../../../Types/Database/UniqueColumnBy";
import { UniqueColumnsTogetherMetadata } from "../../../Types/Database/UniqueColumnsTogether";
import BadDataException from "../../../Types/Exception/BadDataException";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { JoinColumnMetadataArgs } from "typeorm/metadata-args/JoinColumnMetadataArgs";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import fs from "fs";
import path from "path";

/*
 * The Databases product is persisted as seven TypeORM entities: the
 * DatabaseServer root, its DatabaseServerEndpoint children (the one-owner
 * endpoint table the telemetry key set is derived from), and the feed / owner
 * / rule models cloned from the Ceph product. Plus a `databaseServers`
 * many-to-many on Incident, Alert and ScheduledMaintenance.
 *
 * What is pinned here only fails in production:
 *
 *   - registration in Models/Index.ts (no table, no API otherwise)
 *   - the table / route / display names other layers key on
 *   - the identity indexes the discovery paths rely on for race safety,
 *     including the two NAMED partial unique indexes a generated migration
 *     would otherwise drop
 *   - the column ACL contract: DatabaseService.create runs onBeforeCreate
 *     BEFORE the column permission check, so every column the service sets on
 *     a manual create must be user-creatable, and every column only discovery
 *     writes must be closed to users - checked here against the real
 *     ColumnPermission / CreatePermission code, not just the declarations
 *   - the endpoint table reusing the parent's permissions
 *   - the feed enum contract, the rule criteria fields and the permissions
 *   - Postgres's 63-character identifier limit
 *
 * Pure metadata and in-process permission checks - no Postgres connection.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

interface DatabaseModelSpec {
  name: string;
  modelType: ModelType;
  tableName: string;
  crudApiPath: string;
  singularName: string;
  pluralName: string;
  icon: IconProp;
}

const DATABASE_MODELS: Array<DatabaseModelSpec> = [
  {
    name: "DatabaseServer",
    modelType: DatabaseServer,
    tableName: "DatabaseServer",
    crudApiPath: "/database-server",
    singularName: "Database",
    pluralName: "Databases",
    icon: IconProp.Database,
  },
  {
    name: "DatabaseServerEndpoint",
    modelType: DatabaseServerEndpoint,
    tableName: "DatabaseServerEndpoint",
    crudApiPath: "/database-server-endpoint",
    singularName: "Database Endpoint",
    pluralName: "Database Endpoints",
    icon: IconProp.Link,
  },
  {
    name: "DatabaseServerFeed",
    modelType: DatabaseServerFeed,
    tableName: "DatabaseServerFeed",
    crudApiPath: "/database-server-feed",
    singularName: "Database Feed",
    pluralName: "Database Feeds",
    icon: IconProp.List,
  },
  {
    name: "DatabaseServerOwnerTeam",
    modelType: DatabaseServerOwnerTeam,
    tableName: "DatabaseServerOwnerTeam",
    crudApiPath: "/database-server-owner-team",
    singularName: "Database Team Owner",
    pluralName: "Database Team Owners",
    icon: IconProp.Cube,
  },
  {
    name: "DatabaseServerOwnerUser",
    modelType: DatabaseServerOwnerUser,
    tableName: "DatabaseServerOwnerUser",
    crudApiPath: "/database-server-owner-user",
    singularName: "Database User Owner",
    pluralName: "Database User Owners",
    icon: IconProp.Cube,
  },
  {
    name: "DatabaseServerLabelRule",
    modelType: DatabaseServerLabelRule,
    tableName: "DatabaseServerLabelRule",
    crudApiPath: "/database-server-label-rule",
    singularName: "Database Label Rule",
    pluralName: "Database Label Rules",
    icon: IconProp.Tag,
  },
  {
    name: "DatabaseServerOwnerRule",
    modelType: DatabaseServerOwnerRule,
    tableName: "DatabaseServerOwnerRule",
    crudApiPath: "/database-server-owner-rule",
    singularName: "Database Owner Rule",
    pluralName: "Database Owner Rules",
    // Every infrastructure owner rule (Ceph, VMware, Cloud) uses User.
    icon: IconProp.User,
  },
];

// Every child of DatabaseServer and the relation property it reaches it by.
const DATABASE_SERVER_CHILDREN: Array<[ModelType, string]> = [
  [DatabaseServerEndpoint, "databaseServer"],
  [DatabaseServerFeed, "databaseServer"],
  [DatabaseServerOwnerTeam, "databaseServer"],
  [DatabaseServerOwnerUser, "databaseServer"],
];

// The affected-resource relation on each event model: join table, own FK.
const AFFECTED: Array<[ModelType, string, string]> = [
  [Alert, "AlertDatabaseServer", "alertId"],
  [Incident, "IncidentDatabaseServer", "incidentId"],
  [
    ScheduledMaintenance,
    "ScheduledMaintenanceDatabaseServer",
    "scheduledMaintenanceId",
  ],
];

const DATABASE_SERVER_PERMISSIONS: Array<string> = [
  "CreateDatabaseServer",
  "DeleteDatabaseServer",
  "EditDatabaseServer",
  "ReadDatabaseServer",
  "CreateDatabaseServerOwnerTeam",
  "DeleteDatabaseServerOwnerTeam",
  "EditDatabaseServerOwnerTeam",
  "ReadDatabaseServerOwnerTeam",
  "CreateDatabaseServerOwnerUser",
  "DeleteDatabaseServerOwnerUser",
  "EditDatabaseServerOwnerUser",
  "ReadDatabaseServerOwnerUser",
  "CreateDatabaseServerLabelRule",
  "DeleteDatabaseServerLabelRule",
  "EditDatabaseServerLabelRule",
  "ReadDatabaseServerLabelRule",
  "CreateDatabaseServerOwnerRule",
  "DeleteDatabaseServerOwnerRule",
  "EditDatabaseServerOwnerRule",
  "ReadDatabaseServerOwnerRule",
  "CreateDatabaseServerFeed",
  "EditDatabaseServerFeed",
  "ReadDatabaseServerFeed",
];

// The rule criteria fields the registry, the engines and the forms share.
const RULE_CRITERIA_FIELDS: Array<string> = [
  "databaseServerLabels",
  "databaseServerNamePattern",
  "databaseServerDescriptionPattern",
];

/*
 * Every column DatabaseServerService.onBeforeCreate may set on a manual
 * (non-root) create, plus what DatabaseService itself stamps
 * (projectId, createdByUserId) and what the create form may send.
 */
const DATABASE_SERVER_USER_CREATE_COLUMNS: Array<string> = [
  "project",
  "projectId",
  "name",
  "description",
  "databaseIdentifier",
  "dbSystem",
  "serverAddress",
  "serverPort",
  "discoverySource",
  "labels",
  "retainTelemetryDataForDays",
  "telemetryRetentionConfig",
  "isArchived",
  "createdByUser",
  "createdByUserId",
];

// Columns a person may change after creation.
const DATABASE_SERVER_USER_UPDATE_COLUMNS: Array<string> = [
  "name",
  "description",
  "labels",
  "retainTelemetryDataForDays",
  "telemetryRetentionConfig",
  "isArchived",
];

// Columns only the discovery / heartbeat / archive paths write, as root.
const DATABASE_SERVER_ROOT_ONLY_COLUMNS: Array<string> = [
  "slug",
  "workloadIdentifier",
  "dbVersion",
  "kubernetesCluster",
  "kubernetesClusterId",
  "kubernetesNamespace",
  "workloadKind",
  "workloadName",
  "dockerHost",
  "dockerHostId",
  "podmanHost",
  "podmanHostId",
  "memberEntityKeys",
  "instanceCount",
  "otelCollectorStatus",
  "collectorLastSeenAt",
  "agentVersion",
  "lastSeenAt",
  "autoArchivedAt",
  "manuallyRestoredAt",
  "dbSystemSource",
  "workloadLastSeenAt",
  "automaticAssignments",
  "archivedAt",
  "archivedByUser",
  "archivedByUserId",
  "deletedByUser",
  "deletedByUserId",
];

const PERMISSION_PROPS: Array<PermissionProps> =
  PermissionHelper.getAllPermissionProps();

const PERMISSION_PROPS_BY_NAME: Map<string, PermissionProps> = new Map(
  PERMISSION_PROPS.map((props: PermissionProps) => {
    return [props.permission.toString(), props];
  }),
);

const PROJECT_ID: ObjectID = new ObjectID(
  "9e1b6b0e-0000-4000-8000-00000000d8a1",
);
const USER_ID: ObjectID = new ObjectID("9e1b6b0e-0000-4000-8000-00000000d8a2");

/*
 * DatabaseCommonInteractionPropsUtil.getUserPermissions only reads the tenant
 * bucket when props.tenantId is set, and drops every permission whose
 * isBlockPermission does not match. Getting either wrong yields an empty
 * permission set, which would make every "does not throw" below pass for the
 * wrong reason - hence the harness guard test further down.
 */
function makeProps(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

// What a manual create posts after DatabaseServerService.onBeforeCreate ran.
function manualCreateData(): DatabaseServer {
  const data: DatabaseServer = new DatabaseServer();
  data.projectId = PROJECT_ID;
  data.name = "PostgreSQL orders-db.internal:5432";
  data.description = "Orders database";
  data.dbSystem = "postgresql";
  data.serverAddress = "orders-db.internal";
  data.serverPort = 5432;
  data.databaseIdentifier = "postgresql|orders-db.internal:5432";
  data.discoverySource = "manual";
  data.createdByUserId = USER_ID;
  return data;
}

type CheckFunction = () => void;

function checkCreate(
  modelType: ModelType,
  data: BaseModel,
  permissions: Array<Permission>,
): CheckFunction {
  return () => {
    ModelPermission.checkCreatePermissions(
      modelType,
      data,
      makeProps(permissions),
    );
  };
}

function checkColumns(
  modelType: ModelType,
  data: BaseModel,
  permissions: Array<Permission>,
  requestType: DatabaseRequestType,
): CheckFunction {
  return () => {
    ColumnPermissions.checkDataColumnPermissions(
      modelType,
      data,
      makeProps(permissions),
      requestType,
    );
  };
}

function allReferencedPermissions(model: BaseModel): Array<Permission> {
  const permissions: Array<Permission> = [
    ...(model.createRecordPermissions || []),
    ...(model.readRecordPermissions || []),
    ...(model.updateRecordPermissions || []),
    ...(model.deleteRecordPermissions || []),
  ];

  for (const column of model.getTableColumns().columns) {
    const accessControl: ColumnAccessControl | undefined =
      model.getColumnAccessControlFor(column) || undefined;

    if (!accessControl) {
      continue;
    }

    permissions.push(
      ...(accessControl.create || []),
      ...(accessControl.read || []),
      ...(accessControl.update || []),
    );
  }

  return permissions;
}

/*
 * DatabaseBaseModel's own columns (_id, timestamps, version). They carry the
 * table ACL by default (or none, for version) and are never written through
 * the column check, so the per-column sweeps below skip them.
 */
const BASE_COLUMNS: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
];

function ownColumns(model: BaseModel): Array<string> {
  return model.getTableColumns().columns.filter((column: string): boolean => {
    return !BASE_COLUMNS.includes(column);
  });
}

function columnAccess(model: BaseModel, column: string): ColumnAccessControl {
  const accessControl: ColumnAccessControl | null =
    model.getColumnAccessControlFor(column);

  if (!accessControl) {
    throw new Error(`${column} has no @ColumnAccessControl`);
  }

  return accessControl;
}

function columnArgs(
  modelType: ModelType,
  property: string,
): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined = (
    getMetadataArgsStorage().columns as Array<ColumnMetadataArgs>
  ).find((candidate: ColumnMetadataArgs) => {
    return (
      candidate.target === modelType && candidate.propertyName === property
    );
  });

  if (!column) {
    throw new Error(`${modelType.name}.${property} is not a registered column`);
  }

  return column;
}

function relationArgs(
  modelType: ModelType,
  property: string,
): RelationMetadataArgs {
  const relation: RelationMetadataArgs | undefined = (
    getMetadataArgsStorage().relations as Array<RelationMetadataArgs>
  ).find((candidate: RelationMetadataArgs) => {
    return (
      candidate.target === modelType && candidate.propertyName === property
    );
  });

  if (!relation) {
    throw new Error(
      `${modelType.name}.${property} is not a registered relation`,
    );
  }

  return relation;
}

function joinColumnArgs(
  modelType: ModelType,
  property: string,
): JoinColumnMetadataArgs {
  const joinColumn: JoinColumnMetadataArgs | undefined = (
    getMetadataArgsStorage().joinColumns as Array<JoinColumnMetadataArgs>
  ).find((candidate: JoinColumnMetadataArgs) => {
    return (
      candidate.target === modelType && candidate.propertyName === property
    );
  });

  if (!joinColumn) {
    throw new Error(`${modelType.name}.${property} has no @JoinColumn`);
  }

  return joinColumn;
}

function joinTableArgs(
  modelType: ModelType,
  property: string,
): JoinTableMetadataArgs {
  const joinTable: JoinTableMetadataArgs | undefined = (
    getMetadataArgsStorage().joinTables as Array<JoinTableMetadataArgs>
  ).find((candidate: JoinTableMetadataArgs) => {
    return (
      candidate.target === modelType && candidate.propertyName === property
    );
  });

  if (!joinTable) {
    throw new Error(`${modelType.name}.${property} has no @JoinTable`);
  }

  return joinTable;
}

function classIndexes(modelType: ModelType): Array<IndexMetadataArgs> {
  return getMetadataArgsStorage().indices.filter(
    (index: IndexMetadataArgs): boolean => {
      return index.target === modelType;
    },
  );
}

function indexOnColumns(
  modelType: ModelType,
  columns: Array<string>,
): IndexMetadataArgs | undefined {
  return classIndexes(modelType).find((index: IndexMetadataArgs): boolean => {
    return (
      Array.isArray(index.columns) &&
      index.columns.length === columns.length &&
      columns.every((column: string): boolean => {
        return (index.columns as Array<string>).includes(column);
      })
    );
  });
}

function propertyIndex(
  modelType: ModelType,
  property: string,
): IndexMetadataArgs | undefined {
  // A property-level @Index() is recorded with [propertyName] as its columns.
  return classIndexes(modelType).find((index: IndexMetadataArgs): boolean => {
    return (
      Array.isArray(index.columns) &&
      index.columns.length === 1 &&
      index.columns[0] === property
    );
  });
}

function modelSource(modelName: string): string {
  return fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "Models",
      "DatabaseModels",
      `${modelName}.ts`,
    ),
    "utf8",
  );
}

/*
 * The source with its comments removed. Comments may name the template a
 * model was cloned from ("like CloudResourceInstance"); code may not. A line
 * comment must start a line or follow whitespace, so the "//" of a URL inside
 * a string is left alone.
 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
}

function sorted(values: Array<Permission | string>): Array<string> {
  return values
    .map((value: Permission | string): string => {
      return value.toString();
    })
    .sort();
}

describe("Databases (DatabaseServer) models", () => {
  test("the inventory is complete", () => {
    expect(DATABASE_MODELS.length).toBe(7);
    expect(DATABASE_SERVER_PERMISSIONS.length).toBe(23);
  });

  describe("harness guard", () => {
    /*
     * Runs first on purpose. Most permission assertions below are "does not
     * throw", which a props object the permission util silently ignored
     * would also satisfy. A caller holding only a READ grant must be refused
     * a create; if it is not, makeProps is broken, not the model.
     */
    test("a read-only caller is refused a manual create", () => {
      expect(
        checkCreate(DatabaseServer, manualCreateData(), [
          Permission.ReadDatabaseServer,
        ]),
      ).toThrow();
    });

    test("a caller with no permissions at all is refused a column write", () => {
      expect(
        checkColumns(
          DatabaseServer,
          manualCreateData(),
          [],
          DatabaseRequestType.Create,
        ),
      ).toThrow(BadDataException);
    });
  });

  describe("registration and identity", () => {
    test.each(DATABASE_MODELS)(
      "$name is registered in Models/Index.ts",
      (spec: DatabaseModelSpec) => {
        /*
         * Boot-time createTables() and the migration generator both iterate
         * that array. A model missing from it type-checks, imports fine, and
         * simply has no table in Postgres.
         */
        expect(MODEL_TYPES).toContain(spec.modelType);
        expect(
          MODEL_TYPES.filter((modelType: ModelType): boolean => {
            return modelType === spec.modelType;
          }),
        ).toHaveLength(1);
      },
    );

    test.each(DATABASE_MODELS)(
      "$name resolves by its table name through getModelTypeByName",
      (spec: DatabaseModelSpec) => {
        // The generic API / workflow layers look models up by table name.
        expect(getModelTypeByName(spec.tableName)).toBe(spec.modelType);
      },
    );

    test.each(DATABASE_MODELS)(
      "$name carries its own table, route, display names and icon",
      (spec: DatabaseModelSpec) => {
        const model: BaseModel = new spec.modelType();

        expect(spec.modelType.name).toBe(spec.name);
        expect(model.tableName).toBe(spec.tableName);
        expect(model.getCrudApiPath()?.toString()).toBe(spec.crudApiPath);
        expect(model.singularName).toBe(spec.singularName);
        expect(model.pluralName).toBe(spec.pluralName);
        expect(model.icon).toBe(spec.icon);
        expect(model.getTenantColumn()).toBe("projectId");
        expect(model.enableDocumentation).toBe(true);
        expect((model.tableDescription || "").length).toBeGreaterThan(20);
      },
    );

    test("no Databases route or table name collides with another model", () => {
      const routes: Map<string, number> = new Map<string, number>();
      const tables: Map<string, number> = new Map<string, number>();

      for (const modelType of MODEL_TYPES) {
        const model: BaseModel = new modelType();
        const route: string | undefined = model.getCrudApiPath()?.toString();

        if (route) {
          routes.set(route, (routes.get(route) || 0) + 1);
        }

        if (model.tableName) {
          tables.set(model.tableName, (tables.get(model.tableName) || 0) + 1);
        }
      }

      for (const spec of DATABASE_MODELS) {
        expect(routes.get(spec.crudApiPath)).toBe(1);
        expect(tables.get(spec.tableName)).toBe(1);
      }
    });

    test("does not take the names the base service class and the Database monitor already use", () => {
      /*
       * `DatabaseService` is the base class of every service, so a model
       * called `Database` would collide with it at the service layer. No
       * model may claim the bare name either.
       */
      expect(getModelTypeByName("Database")).toBeNull();

      for (const spec of DATABASE_MODELS) {
        expect(spec.tableName).not.toBe("Database");
        expect(spec.crudApiPath.startsWith("/database-server")).toBe(true);
      }
    });

    test.each(DATABASE_MODELS)(
      "$name source carries no Ceph or CloudResource leftovers",
      (spec: DatabaseModelSpec) => {
        /*
         * The feed / owner / rule models were cloned from the Ceph product
         * and the root from CloudResource. A leftover `/ceph-cluster` route
         * or `cephClusterId` column reads fine in review and silently binds
         * the wrong table. Comments are exempt: pointing at the template a
         * decision was copied from is documentation, not a binding.
         */
        const source: string = codeOf(modelSource(spec.name));

        // Guards the stripping itself: the class must still be in there.
        expect(source).toContain(`export default class ${spec.name}`);

        for (const token of [
          "Ceph",
          "ceph",
          "CloudResource",
          "cloudResource",
          "cloud-resource",
          "fsid",
          "osdCount",
        ]) {
          expect({ token, found: source.includes(token) }).toEqual({
            token,
            found: false,
          });
        }
      },
    );
  });

  describe("DatabaseServer", () => {
    const model: DatabaseServer = new DatabaseServer();

    test("is unique per project on databaseIdentifier, the discovery join key", () => {
      /*
       * Every discovery path find-or-creates by databaseIdentifier. Several
       * ingest pods and worker runs race on the same database; only a
       * DB-level unique index collapses them into one row.
       */
      const found: IndexMetadataArgs | undefined = indexOnColumns(
        DatabaseServer,
        ["projectId", "databaseIdentifier"],
      );

      expect(found).toBeDefined();
      expect(found?.unique).toBe(true);
      // Not partial: a soft-deleted row must not let a duplicate identity in.
      expect(found?.where).toBeUndefined();
      expect(found?.name).toBeUndefined();
    });

    test("the display name is NOT unique - two engines may share a host", () => {
      const nameIndexes: Array<IndexMetadataArgs> = classIndexes(
        DatabaseServer,
      ).filter((index: IndexMetadataArgs): boolean => {
        return (
          Array.isArray(index.columns) &&
          (index.columns as Array<string>).includes("name")
        );
      });

      for (const index of nameIndexes) {
        expect(index.unique).not.toBe(true);
      }

      // Nor the app-level @UniqueColumnBy check CephCluster.name carries.
      expect(Object.keys(getUniqueColumnsBy(new DatabaseServer()))).toEqual([]);
    });

    test("declares IDX_database_server_slug by name, UNIQUE and partial", () => {
      /*
       * TypeORM's schema builder matches database indexes to entity
       * metadata by name and drops every one it cannot find, so the partial
       * slug index must be declared natively and named.
       */
      const found: IndexMetadataArgs | undefined = classIndexes(
        DatabaseServer,
      ).find((index: IndexMetadataArgs): boolean => {
        return index.name === "IDX_database_server_slug";
      });

      expect(found).toBeDefined();
      expect(found?.unique).toBe(true);
      expect(found?.columns).toEqual(["slug"]);
      expect(found?.where).toBe('"deletedAt" IS NULL');
    });

    test("declares IDX_database_server_workload by name: one row per workload, NULLs never collide", () => {
      const found: IndexMetadataArgs | undefined = classIndexes(
        DatabaseServer,
      ).find((index: IndexMetadataArgs): boolean => {
        return index.name === "IDX_database_server_workload";
      });

      expect(found).toBeDefined();
      expect(found?.unique).toBe(true);
      expect(found?.columns).toEqual(["projectId", "workloadIdentifier"]);
      /*
       * The IS NOT NULL half is what lets the many endpoint-only rows (no
       * workload) coexist; the deletedAt half lets a deleted workload row be
       * rediscovered.
       */
      expect(found?.where).toBe(
        '"workloadIdentifier" IS NOT NULL AND "deletedAt" IS NULL',
      );
    });

    test("indexes the list-page filters: (projectId, isArchived) and (projectId, dbSystem)", () => {
      const archived: IndexMetadataArgs | undefined = indexOnColumns(
        DatabaseServer,
        ["projectId", "isArchived"],
      );
      const engine: IndexMetadataArgs | undefined = indexOnColumns(
        DatabaseServer,
        ["projectId", "dbSystem"],
      );

      expect(archived).toBeDefined();
      expect(archived?.unique).not.toBe(true);
      expect(engine).toBeDefined();
      expect(engine?.unique).not.toBe(true);
    });

    test("indexes projectId, databaseIdentifier and kubernetesClusterId on their own", () => {
      for (const column of [
        "projectId",
        "databaseIdentifier",
        "kubernetesClusterId",
      ]) {
        expect({
          column,
          indexed: Boolean(propertyIndex(DatabaseServer, column)),
        }).toEqual({ column, indexed: true });
      }
    });

    test("carries every column of the SPEC schema", () => {
      const columns: Array<string> = model.getTableColumns().columns;

      for (const column of [
        ...DATABASE_SERVER_USER_CREATE_COLUMNS,
        ...DATABASE_SERVER_ROOT_ONLY_COLUMNS,
      ]) {
        expect({ column, present: columns.includes(column) }).toEqual({
          column,
          present: true,
        });
      }

      // Ceph snapshot counters and liveness shortcuts that do not apply.
      for (const column of [
        "fsid",
        "cephVersion",
        "monCount",
        "osdCount",
        "healthStatus",
        "endpoints",
        "isConnected",
        "primaryEndpoint",
      ]) {
        expect(columns).not.toContain(column);
      }
    });

    test("every declared column is accounted for as user-creatable or root-only", () => {
      /*
       * A new column must be placed in one of the two lists above on
       * purpose - which is what decides whether a manual create can set it.
       */
      const accounted: Set<string> = new Set([
        ...DATABASE_SERVER_USER_CREATE_COLUMNS,
        ...DATABASE_SERVER_ROOT_ONLY_COLUMNS,
      ]);
      const unaccounted: Array<string> = ownColumns(model).filter(
        (column: string): boolean => {
          return !accounted.has(column);
        },
      );

      expect(unaccounted).toEqual([]);
    });

    test("column types and widths follow the SPEC", () => {
      const expectations: Array<
        [string, TableColumnType, boolean, number | undefined]
      > = [
        // column, type, required, varchar length
        ["name", TableColumnType.ShortText, true, ColumnLength.ShortText],
        [
          "databaseIdentifier",
          TableColumnType.LongText,
          true,
          ColumnLength.LongText,
        ],
        [
          "workloadIdentifier",
          TableColumnType.LongText,
          false,
          ColumnLength.LongText,
        ],
        ["dbSystem", TableColumnType.ShortText, true, ColumnLength.ShortText],
        [
          "serverAddress",
          TableColumnType.LongText,
          false,
          ColumnLength.LongText,
        ],
        ["serverPort", TableColumnType.Number, false, undefined],
        ["dbVersion", TableColumnType.ShortText, false, ColumnLength.ShortText],
        [
          "discoverySource",
          TableColumnType.ShortText,
          false,
          ColumnLength.ShortText,
        ],
        [
          "kubernetesNamespace",
          TableColumnType.ShortText,
          false,
          ColumnLength.ShortText,
        ],
        [
          "workloadKind",
          TableColumnType.ShortText,
          false,
          ColumnLength.ShortText,
        ],
        [
          "workloadName",
          TableColumnType.LongText,
          false,
          ColumnLength.LongText,
        ],
        ["memberEntityKeys", TableColumnType.JSON, false, undefined],
        ["instanceCount", TableColumnType.Number, false, undefined],
        [
          "otelCollectorStatus",
          TableColumnType.ShortText,
          false,
          ColumnLength.ShortText,
        ],
        ["collectorLastSeenAt", TableColumnType.Date, false, undefined],
        [
          "agentVersion",
          TableColumnType.ShortText,
          false,
          ColumnLength.ShortText,
        ],
        ["lastSeenAt", TableColumnType.Date, false, undefined],
        ["autoArchivedAt", TableColumnType.Date, false, undefined],
        ["manuallyRestoredAt", TableColumnType.Date, false, undefined],
        [
          "dbSystemSource",
          TableColumnType.ShortText,
          false,
          ColumnLength.ShortText,
        ],
        ["workloadLastSeenAt", TableColumnType.Date, false, undefined],
        ["automaticAssignments", TableColumnType.JSON, false, undefined],
        ["kubernetesClusterId", TableColumnType.ObjectID, false, undefined],
        ["dockerHostId", TableColumnType.ObjectID, false, undefined],
        ["podmanHostId", TableColumnType.ObjectID, false, undefined],
        [
          "retainTelemetryDataForDays",
          TableColumnType.Number,
          false,
          undefined,
        ],
        ["telemetryRetentionConfig", TableColumnType.JSON, false, undefined],
      ];

      for (const [column, type, required, length] of expectations) {
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(column);
        const options: ColumnMetadataArgs["options"] = columnArgs(
          DatabaseServer,
          column,
        ).options;

        expect({ column, type: metadata.type }).toEqual({ column, type });
        expect({ column, required: Boolean(metadata.required) }).toEqual({
          column,
          required,
        });
        expect({ column, nullable: options.nullable }).toEqual({
          column,
          nullable: !required,
        });
        expect({ column, length: options.length }).toEqual({ column, length });
      }
    });

    test("serverPort is an integer column; memberEntityKeys and retention overrides are jsonb", () => {
      expect(columnArgs(DatabaseServer, "serverPort").options.type).toBe(
        "integer",
      );
      expect(columnArgs(DatabaseServer, "instanceCount").options.type).toBe(
        "integer",
      );
      expect(columnArgs(DatabaseServer, "memberEntityKeys").options.type).toBe(
        "jsonb",
      );
      expect(
        columnArgs(DatabaseServer, "automaticAssignments").options.type,
      ).toBe("jsonb");
      expect(
        columnArgs(DatabaseServer, "telemetryRetentionConfig").options.type,
      ).toBe("jsonb");
    });

    test("new rows render sensibly: 0 instances, no collector status, not archived", () => {
      expect(columnArgs(DatabaseServer, "instanceCount").options.default).toBe(
        0,
      );
      /*
       * "disconnected" means a collector reported and stopped. A row found
       * from traces, containers or by hand never had one, so it must not be
       * born claiming one "disconnected": no DB default, NULL until a
       * collector reports.
       */
      expect(
        columnArgs(DatabaseServer, "otelCollectorStatus").options.default,
      ).toBeUndefined();
      expect(
        columnArgs(DatabaseServer, "otelCollectorStatus").options.nullable,
      ).toBe(true);
      expect(new DatabaseServer().otelCollectorStatus).toBeUndefined();
      expect(columnArgs(DatabaseServer, "isArchived").options.default).toBe(
        false,
      );
      expect(columnArgs(DatabaseServer, "isArchived").options.nullable).toBe(
        false,
      );
      expect(model.isDefaultValueColumn("isArchived")).toBe(true);

      // No DB default where "unknown" must stay NULL.
      for (const column of [
        "otelCollectorStatus",
        "lastSeenAt",
        "collectorLastSeenAt",
        "autoArchivedAt",
        "manuallyRestoredAt",
        "dbSystemSource",
        "workloadLastSeenAt",
        "automaticAssignments",
        "workloadIdentifier",
        "memberEntityKeys",
        "discoverySource",
        "serverPort",
      ]) {
        expect({
          column,
          default: columnArgs(DatabaseServer, column).options.default,
        }).toEqual({ column, default: undefined });
      }
    });

    test("slug is computed from name and is never user-writable", () => {
      expect(model.getSlugifyColumn()).toBe("name");
      expect(model.getSaveSlugToColumn()).toBe("slug");
      expect(model.getTableColumnMetadata("slug").computed).toBe(true);
      expect(model.getTableColumnMetadata("slug").type).toBe(
        TableColumnType.Slug,
      );
    });

    test("table access control: Settings / project roles plus the granular DatabaseServer permissions", () => {
      const writeRoles: Array<Permission> = [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.SettingsAdmin,
        Permission.SettingsMember,
      ];

      expect(sorted(model.getCreatePermissions())).toEqual(
        sorted([...writeRoles, Permission.CreateDatabaseServer]),
      );
      expect(sorted(model.getUpdatePermissions())).toEqual(
        sorted([...writeRoles, Permission.EditDatabaseServer]),
      );
      expect(sorted(model.getDeletePermissions())).toEqual(
        sorted([...writeRoles, Permission.DeleteDatabaseServer]),
      );
      expect(sorted(model.getReadPermissions())).toEqual(
        sorted([
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.Viewer,
          Permission.SettingsAdmin,
          Permission.SettingsMember,
          Permission.SettingsViewer,
          Permission.ReadDatabaseServer,
        ]),
      );
    });

    test.each(DATABASE_SERVER_USER_CREATE_COLUMNS)(
      "%s is creatable by exactly the table's create roles (COLUMN ACL RULE)",
      (column: string) => {
        /*
         * DatabaseService.create runs onBeforeCreate BEFORE
         * ModelPermission.checkCreatePermissions. A column the service sets
         * during a manual create that the caller may not create turns every
         * manual create into "User is not allowed to create on <column>".
         */
        expect(sorted(columnAccess(model, column).create || [])).toEqual(
          sorted(model.getCreatePermissions()),
        );
      },
    );

    test.each(DATABASE_SERVER_ROOT_ONLY_COLUMNS)(
      "%s is root-only: nobody creates or updates it through the API",
      (column: string) => {
        const accessControl: ColumnAccessControl = columnAccess(model, column);

        expect(accessControl.create || []).toEqual([]);
        expect(accessControl.update || []).toEqual([]);
      },
    );

    test("identity columns are creatable but never updatable", () => {
      /*
       * Re-pointing a row at a different engine or endpoint by editing it
       * would silently hand its history to another database. The endpoints
       * table is where aliases change.
       */
      for (const column of [
        "projectId",
        "databaseIdentifier",
        "dbSystem",
        "serverAddress",
        "serverPort",
        "discoverySource",
        "createdByUserId",
      ]) {
        expect({ column, update: columnAccess(model, column).update }).toEqual({
          column,
          update: [],
        });
      }
    });

    test.each(DATABASE_SERVER_USER_UPDATE_COLUMNS)(
      "%s is updatable by exactly the table's update roles",
      (column: string) => {
        expect(sorted(columnAccess(model, column).update || [])).toEqual(
          sorted(model.getUpdatePermissions()),
        );
      },
    );

    test("no other column is user-updatable", () => {
      const updatable: Array<string> = ownColumns(model).filter(
        (column: string): boolean => {
          return (columnAccess(model, column).update || []).length > 0;
        },
      );

      expect(updatable.sort()).toEqual(
        [...DATABASE_SERVER_USER_UPDATE_COLUMNS].sort(),
      );
    });

    test("every column is readable by exactly the table's read roles", () => {
      for (const column of ownColumns(model)) {
        expect({
          column,
          read: sorted(columnAccess(model, column).read || []),
        }).toEqual({ column, read: sorted(model.getReadPermissions()) });
      }
    });

    describe("against the real permission checks", () => {
      test.each([
        ["ProjectOwner", [Permission.ProjectOwner]],
        ["ProjectMember", [Permission.ProjectMember]],
        ["SettingsAdmin", [Permission.SettingsAdmin]],
        ["SettingsMember", [Permission.SettingsMember]],
        ["CreateDatabaseServer only", [Permission.CreateDatabaseServer]],
      ])(
        "a manual create as %s passes table and column checks",
        (_label: string, permissions: Array<Permission>) => {
          expect(
            checkCreate(DatabaseServer, manualCreateData(), permissions),
          ).not.toThrow();
        },
      );

      test("a manual create with labels and retention passes too", () => {
        const data: DatabaseServer = manualCreateData();
        const label: Label = new Label();
        label._id = ObjectID.generate().toString();
        data.labels = [label];
        data.retainTelemetryDataForDays = 7;
        data.isArchived = false;

        expect(
          checkCreate(DatabaseServer, data, [Permission.CreateDatabaseServer]),
        ).not.toThrow();
      });

      test.each(
        DATABASE_SERVER_ROOT_ONLY_COLUMNS.filter((column: string): boolean => {
          // slug is a Slug column, which ColumnPermission always skips.
          return column !== "slug";
        }),
      )("a non-root create carrying %s is refused", (column: string) => {
        const data: DatabaseServer = manualCreateData();
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(column);
        let value: unknown = "value";

        if (metadata.type === TableColumnType.ObjectID) {
          value = ObjectID.generate();
        } else if (metadata.type === TableColumnType.Date) {
          value = new Date();
        } else if (metadata.type === TableColumnType.Number) {
          value = 1;
        } else if (metadata.type === TableColumnType.JSON) {
          value = { k: "2026-01-01T00:00:00.000Z" };
        } else if (metadata.type === TableColumnType.Entity) {
          value = { _id: ObjectID.generate().toString() };
        }

        (data as unknown as Record<string, unknown>)[column] = value;

        expect(
          checkColumns(
            DatabaseServer,
            data,
            [Permission.ProjectOwner],
            DatabaseRequestType.Create,
          ),
        ).toThrow(
          `User is not allowed to create on ${column} column of Database`,
        );
      });

      test("an update may rename, relabel and archive", () => {
        const data: DatabaseServer = new DatabaseServer();
        data.name = "Orders primary";
        data.description = "Renamed";
        data.isArchived = true;

        expect(
          checkColumns(
            DatabaseServer,
            data,
            [Permission.EditDatabaseServer],
            DatabaseRequestType.Update,
          ),
        ).not.toThrow();
      });

      test.each([
        "databaseIdentifier",
        "dbSystem",
        "serverAddress",
        "discoverySource",
        "workloadIdentifier",
        "otelCollectorStatus",
      ])(
        "an update of %s is refused even for a project owner",
        (column: string) => {
          const data: DatabaseServer = new DatabaseServer();
          (data as unknown as Record<string, unknown>)[column] = "x";

          expect(
            checkColumns(
              DatabaseServer,
              data,
              [Permission.ProjectOwner],
              DatabaseRequestType.Update,
            ),
          ).toThrow(
            `User is not allowed to update on ${column} column of Database`,
          );
        },
      );
    });

    test("labels drive access control through the DatabaseServerLabel join table", () => {
      expect(model.accessControlColumn).toBe("labels");

      const joinTable: JoinTableMetadataArgs = joinTableArgs(
        DatabaseServer,
        "labels",
      );

      expect(joinTable.name).toBe("DatabaseServerLabel");
      expect(joinTable.joinColumns?.[0]?.name).toBe("databaseServerId");
      expect(joinTable.inverseJoinColumns?.[0]?.name).toBe("labelId");
      expect(model.getTableColumnMetadata("labels").modelType).toBe(Label);
      expect(relationArgs(DatabaseServer, "labels").relationType).toBe(
        "many-to-many",
      );
    });

    test.each([
      ["kubernetesCluster", "kubernetesClusterId", KubernetesCluster],
      ["dockerHost", "dockerHostId", DockerHost],
      ["podmanHost", "podmanHostId", PodmanHost],
    ] as Array<[string, string, ModelType]>)(
      "%s is an optional 'runs on' link that survives its parent's deletion",
      (property: string, idColumn: string, parent: ModelType) => {
        /*
         * Deleting a monitored cluster / host must not delete the database
         * row (its history, owners and incident links): SET NULL, not
         * CASCADE.
         */
        const relation: RelationMetadataArgs = relationArgs(
          DatabaseServer,
          property,
        );

        expect(relation.relationType).toBe("many-to-one");
        expect(relation.options.onDelete).toBe("SET NULL");
        expect(relation.options.nullable).toBe(true);
        expect(joinColumnArgs(DatabaseServer, property).name).toBe(idColumn);

        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata(property);

        expect(metadata.type).toBe(TableColumnType.Entity);
        expect(metadata.modelType).toBe(parent);
        expect(metadata.manyToOneRelationColumn).toBe(idColumn);
        expect(columnArgs(DatabaseServer, idColumn).options.nullable).toBe(
          true,
        );
      },
    );

    test("the project relation cascades", () => {
      expect(relationArgs(DatabaseServer, "project").options.onDelete).toBe(
        "CASCADE",
      );
    });

    test("lastSeenAt and the identity columns can be read through a relation query", () => {
      /*
       * The affected-resources chips on incidents and the endpoint list read
       * a database through a relation select.
       */
      for (const column of [
        "projectId",
        "name",
        "databaseIdentifier",
        "dbSystem",
        "serverAddress",
        "lastSeenAt",
      ]) {
        expect({
          column,
          canRead: Boolean(
            model.getTableColumnMetadata(column).canReadOnRelationQuery,
          ),
        }).toEqual({ column, canRead: true });
      }
    });
  });

  describe("DatabaseServerEndpoint", () => {
    const model: DatabaseServerEndpoint = new DatabaseServerEndpoint();
    const parent: DatabaseServer = new DatabaseServer();

    test("one owner per endpoint per project, enforced by the database", () => {
      /*
       * Telemetry keys are derived from the endpoint, not the row. An
       * endpoint listed on two databases would show the same traffic on
       * both - this index is the invariant that prevents it.
       */
      const found: IndexMetadataArgs | undefined = indexOnColumns(
        DatabaseServerEndpoint,
        ["projectId", "endpoint"],
      );

      expect(found).toBeDefined();
      expect(found?.unique).toBe(true);
      expect(found?.where).toBeUndefined();
      expect(found?.columns).toEqual(["projectId", "endpoint"]);
    });

    test("indexes databaseServerId for the per-database endpoint list", () => {
      expect(
        indexOnColumns(DatabaseServerEndpoint, ["databaseServerId"]),
      ).toBeDefined();
    });

    test("reuses the parent's permissions: add/remove = edit the database, read = read it", () => {
      expect(sorted(model.getCreatePermissions())).toEqual(
        sorted(parent.getUpdatePermissions()),
      );
      expect(sorted(model.getDeletePermissions())).toEqual(
        sorted(parent.getUpdatePermissions()),
      );
      expect(sorted(model.getReadPermissions())).toEqual(
        sorted(parent.getReadPermissions()),
      );

      // Rows are never edited through the API: remove and re-add instead.
      expect(model.getUpdatePermissions()).toEqual([]);

      // And the catalogue has no endpoint-specific permissions to grant.
      for (const permission of allReferencedPermissions(model)) {
        expect(permission.toString()).not.toContain("DatabaseServerEndpoint");
      }
    });

    test("read access and Owned scope follow the parent database", () => {
      expect(model.canAccessIfCanReadOn).toBe("databaseServer");

      const ownedThrough: OwnedThroughMetadata | null = model.ownedThrough;

      expect(ownedThrough).toBeTruthy();
      expect(ownedThrough?.fkColumn).toBe("databaseServerId");
      expect(ownedThrough?.parentModels).toEqual([DatabaseServer]);
      expect(ownedThrough?.includeProjectScope).toBe(false);
    });

    test("carries the SPEC columns with the SPEC types", () => {
      const columns: Array<string> = model.getTableColumns().columns;

      for (const column of [
        "project",
        "projectId",
        "databaseServer",
        "databaseServerId",
        "endpoint",
        "isPrimary",
        "source",
        "lastMatchedAt",
        "createdByUser",
        "createdByUserId",
        "deletedByUser",
        "deletedByUserId",
      ]) {
        expect(columns).toContain(column);
      }

      expect(model.getTableColumnMetadata("endpoint").type).toBe(
        TableColumnType.LongText,
      );
      expect(model.getTableColumnMetadata("endpoint").required).toBe(true);
      expect(columnArgs(DatabaseServerEndpoint, "endpoint").options).toEqual(
        expect.objectContaining({
          nullable: false,
          length: ColumnLength.LongText,
        }),
      );

      expect(model.getTableColumnMetadata("databaseServerId").required).toBe(
        true,
      );
      expect(
        columnArgs(DatabaseServerEndpoint, "databaseServerId").options.nullable,
      ).toBe(false);

      expect(model.getTableColumnMetadata("isPrimary").type).toBe(
        TableColumnType.Boolean,
      );
      expect(columnArgs(DatabaseServerEndpoint, "isPrimary").options).toEqual(
        expect.objectContaining({ nullable: false, default: false }),
      );
      expect(model.isDefaultValueColumn("isPrimary")).toBe(true);

      expect(model.getTableColumnMetadata("source").type).toBe(
        TableColumnType.ShortText,
      );
      expect(model.getTableColumnMetadata("lastMatchedAt").type).toBe(
        TableColumnType.Date,
      );
    });

    test("deleting a database takes its endpoints with it", () => {
      const relation: RelationMetadataArgs = relationArgs(
        DatabaseServerEndpoint,
        "databaseServer",
      );

      expect(relation.relationType).toBe("many-to-one");
      expect(relation.options.onDelete).toBe("CASCADE");
      expect(
        joinColumnArgs(DatabaseServerEndpoint, "databaseServer").name,
      ).toBe("databaseServerId");
    });

    test("no column is ever updatable through the API", () => {
      for (const column of ownColumns(model)) {
        expect({ column, update: columnAccess(model, column).update }).toEqual({
          column,
          update: [],
        });
      }
    });

    test("the columns an alias add sets are creatable by the parent's edit roles", () => {
      /*
       * DatabaseServerEndpointService.onBeforeCreate forces source "user"
       * and isPrimary false on every non-root create; both are therefore in
       * the data the column check sees and must be creatable (the forced
       * value, not the caller's, is what survives the hook).
       */
      for (const column of [
        "project",
        "projectId",
        "databaseServer",
        "databaseServerId",
        "endpoint",
        "source",
        "isPrimary",
        "createdByUser",
        "createdByUserId",
      ]) {
        expect({
          column,
          create: sorted(columnAccess(model, column).create || []),
        }).toEqual({ column, create: sorted(model.getCreatePermissions()) });
      }

      for (const column of [
        "lastMatchedAt",
        "deletedByUser",
        "deletedByUserId",
      ]) {
        expect({ column, create: columnAccess(model, column).create }).toEqual({
          column,
          create: [],
        });
      }
    });

    test("an alias add by a database editor passes the real create check", () => {
      const data: DatabaseServerEndpoint = new DatabaseServerEndpoint();
      data.projectId = PROJECT_ID;
      data.databaseServerId = ObjectID.generate();
      data.endpoint = "orders-db.data.svc.cluster.local:5432@prod";
      data.source = "user";
      data.isPrimary = false;
      data.createdByUserId = USER_ID;

      expect(
        checkCreate(DatabaseServerEndpoint, data, [
          Permission.EditDatabaseServer,
        ]),
      ).not.toThrow();
      expect(
        checkCreate(DatabaseServerEndpoint, data, [Permission.ProjectMember]),
      ).not.toThrow();
    });

    test("a database reader may not add an alias", () => {
      const data: DatabaseServerEndpoint = new DatabaseServerEndpoint();
      data.projectId = PROJECT_ID;
      data.databaseServerId = ObjectID.generate();
      data.endpoint = "orders-db.internal:5432";

      expect(
        checkCreate(DatabaseServerEndpoint, data, [
          Permission.ReadDatabaseServer,
        ]),
      ).toThrow();
    });

    test("lastMatchedAt cannot be forged on create", () => {
      const data: DatabaseServerEndpoint = new DatabaseServerEndpoint();
      data.endpoint = "orders-db.internal:5432";
      data.lastMatchedAt = new Date();

      expect(
        checkColumns(
          DatabaseServerEndpoint,
          data,
          [Permission.ProjectOwner],
          DatabaseRequestType.Create,
        ),
      ).toThrow(
        "User is not allowed to create on lastMatchedAt column of Database Endpoint",
      );
    });

    test("an endpoint cannot be rewritten in place, even by a project owner", () => {
      const data: DatabaseServerEndpoint = new DatabaseServerEndpoint();
      data.endpoint = "somewhere-else:5432";

      expect(
        checkColumns(
          DatabaseServerEndpoint,
          data,
          [Permission.ProjectOwner],
          DatabaseRequestType.Update,
        ),
      ).toThrow(
        "User is not allowed to update on endpoint column of Database Endpoint",
      );
    });
  });

  describe("DatabaseServerFeed", () => {
    test("event enum has exactly the ten contract members with value === key", () => {
      const entries: Array<[string, string]> = Object.entries(
        DatabaseServerFeedEventType,
      );

      expect(entries.length).toBe(10);
      expect(
        entries
          .map(([key]: [string, string]) => {
            return key;
          })
          .sort(),
      ).toEqual(
        [
          "DatabaseServerCreated",
          "DatabaseServerUpdated",
          "DatabaseServerArchived",
          "DatabaseServerRestored",
          "OwnerUserAdded",
          "OwnerUserRemoved",
          "OwnerTeamAdded",
          "OwnerTeamRemoved",
          "OwnerRuleExecuted",
          "LabelRuleExecuted",
        ].sort(),
      );

      /*
       * Values are stored verbatim in a ShortText column, so a member whose
       * value drifts from its key orphans every row written under the old
       * value.
       */
      for (const [key, value] of entries) {
        expect(value).toBe(key);
      }
    });

    test("stores the event under databaseServerFeedEventType and reads through the database", () => {
      const model: DatabaseServerFeed = new DatabaseServerFeed();

      expect(model.getTableColumns().columns).toContain(
        "databaseServerFeedEventType",
      );
      expect(
        model.getTableColumnMetadata("databaseServerFeedEventType").required,
      ).toBe(true);
      // Unbounded varchar like every other feed event column.
      expect(
        columnArgs(DatabaseServerFeed, "databaseServerFeedEventType").options
          .length,
      ).toBeUndefined();
      expect(model.canAccessIfCanReadOn).toBe("databaseServer");

      const ownedThrough: OwnedThroughMetadata | null = model.ownedThrough;

      expect(ownedThrough?.fkColumn).toBe("databaseServerId");
      expect(ownedThrough?.parentModels).toEqual([DatabaseServer]);
    });

    test("is append-only and gated on its own feed permissions", () => {
      const model: DatabaseServerFeed = new DatabaseServerFeed();

      expect(model.getUpdatePermissions()).toEqual([]);
      expect(model.getDeletePermissions()).toEqual([]);
      expect(model.getCreatePermissions()).toContain(
        Permission.CreateDatabaseServerFeed,
      );
      expect(model.getReadPermissions()).toContain(
        Permission.ReadDatabaseServerFeed,
      );
    });

    test("indexes (databaseServerId, postedAt) for the feed page", () => {
      expect(
        indexOnColumns(DatabaseServerFeed, ["databaseServerId", "postedAt"]),
      ).toBeDefined();
    });
  });

  describe("children of DatabaseServer", () => {
    test.each(DATABASE_SERVER_CHILDREN)(
      "%p.%s cascades on database delete and carries a required databaseServerId",
      (modelType: ModelType, property: string) => {
        const relation: RelationMetadataArgs = relationArgs(
          modelType,
          property,
        );

        expect(relation.relationType).toBe("many-to-one");
        expect(relation.options.onDelete).toBe("CASCADE");

        const model: BaseModel = new modelType();

        expect(model.getTableColumns().columns).toContain("databaseServerId");
        expect(
          model.getTableColumnMetadata(property).manyToOneRelationColumn,
        ).toBe("databaseServerId");
        expect(model.getTableColumnMetadata(property).modelType).toBe(
          DatabaseServer,
        );
        expect(model.getTableColumnMetadata("databaseServerId").required).toBe(
          true,
        );
        expect(columnArgs(modelType, "databaseServerId").options.nullable).toBe(
          false,
        );
      },
    );

    test.each([
      [
        DatabaseServerOwnerTeam,
        "teamId",
        "This team is already an owner of this database.",
      ],
      [
        DatabaseServerOwnerUser,
        "userId",
        "This user is already an owner of this database.",
      ],
    ] as Array<[ModelType, string, string]>)(
      "%p allows one row per (database, owner, project)",
      (modelType: ModelType, ownerColumn: string, message: string) => {
        const unique: IndexMetadataArgs | undefined = indexOnColumns(
          modelType,
          ["databaseServerId", ownerColumn, "projectId"],
        );

        expect(unique).toBeDefined();
        expect(unique?.unique).toBe(true);

        const constraints: Array<UniqueColumnsTogetherMetadata> =
          new modelType().getUniqueColumnsTogether();

        expect(constraints).toHaveLength(1);
        expect(constraints[0]!.columnNames).toEqual([
          "databaseServerId",
          ownerColumn,
          "projectId",
        ]);
        expect(constraints[0]!.errorMessage).toBe(message);
      },
    );

    test("owner rows carry the isOwnerNotified flag, which only the server sets", () => {
      // Owner rule assignment stamps it (OwnerRuleAssignment.createOwner).
      for (const modelType of [
        DatabaseServerOwnerTeam,
        DatabaseServerOwnerUser,
      ] as Array<ModelType>) {
        const model: BaseModel = new modelType();

        expect(model.getTableColumns().columns).toContain("isOwnerNotified");
        expect(columnAccess(model, "isOwnerNotified").create).toEqual([]);
        expect(columnArgs(modelType, "isOwnerNotified").options.default).toBe(
          false,
        );
        expect(model.enableWorkflowOn).toBeTruthy();
      }
    });

    test.each([
      [DatabaseServerOwnerTeam, "OwnerTeam"],
      [DatabaseServerOwnerUser, "OwnerUser"],
    ] as Array<[ModelType, string]>)(
      "%p gates on its own %s permissions",
      (modelType: ModelType, kind: string) => {
        const model: BaseModel = new modelType();

        expect(model.getCreatePermissions()).toContain(
          `CreateDatabaseServer${kind}` as Permission,
        );
        expect(model.getReadPermissions()).toContain(
          `ReadDatabaseServer${kind}` as Permission,
        );
        expect(model.getUpdatePermissions()).toContain(
          `EditDatabaseServer${kind}` as Permission,
        );
        expect(model.getDeletePermissions()).toContain(
          `DeleteDatabaseServer${kind}` as Permission,
        );
      },
    );
  });

  describe("rule models", () => {
    test.each([
      [DatabaseServerLabelRule, "LabelRule"],
      [DatabaseServerOwnerRule, "OwnerRule"],
    ] as Array<[ModelType, string]>)(
      "%p is a RuleBaseModel whose criteria column follows the table ACL",
      (modelType: ModelType, kind: string) => {
        const model: BaseModel = new modelType();

        expect(model).toBeInstanceOf(RuleBaseModel);
        expect(model.getTableColumnMetadata("criteria").type).toBe(
          TableColumnType.JSON,
        );
        expect(model.getColumnAccessControlFor("criteria")).toEqual({
          create: model.getCreatePermissions(),
          read: model.getReadPermissions(),
          update: model.getUpdatePermissions(),
        });

        // Rule tables: owners and admins write, members and viewers read.
        expect(sorted(model.getCreatePermissions())).toEqual(
          sorted([
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            `CreateDatabaseServer${kind}` as Permission,
          ]),
        );
        expect(model.getReadPermissions()).toContain(
          `ReadDatabaseServer${kind}` as Permission,
        );
        expect(model.enableWorkflowOn).toBeTruthy();
      },
    );

    test.each([
      DatabaseServerLabelRule,
      DatabaseServerOwnerRule,
    ] as Array<ModelType>)(
      "%p matches on exactly the three registered criteria fields",
      (modelType: ModelType) => {
        /*
         * RuleCriteriaFieldRegistry, the rule engines' legacyFields and the
         * dashboard's match-criteria step all list these three names; a
         * rename here breaks all three silently.
         */
        const model: BaseModel = new modelType();
        const columns: Array<string> = model.getTableColumns().columns;

        for (const field of RULE_CRITERIA_FIELDS) {
          expect(columns).toContain(field);
        }

        const matchColumns: Array<string> = columns.filter(
          (column: string): boolean => {
            return column.startsWith("databaseServer");
          },
        );

        expect(matchColumns.sort()).toEqual([...RULE_CRITERIA_FIELDS].sort());

        expect(model.getTableColumnMetadata("databaseServerLabels").type).toBe(
          TableColumnType.EntityArray,
        );
        expect(
          model.getTableColumnMetadata("databaseServerLabels").modelType,
        ).toBe(Label);
        expect(
          model.getTableColumnMetadata("databaseServerNamePattern").type,
        ).toBe(TableColumnType.LongText);
        expect(
          model.getTableColumnMetadata("databaseServerDescriptionPattern").type,
        ).toBe(TableColumnType.LongText);
      },
    );

    test("label rule attaches labels through its own join tables", () => {
      const model: DatabaseServerLabelRule = new DatabaseServerLabelRule();

      for (const column of [
        "name",
        "description",
        "isEnabled",
        "labelsToAdd",
      ]) {
        expect(model.getTableColumns().columns).toContain(column);
      }

      const matchLabels: JoinTableMetadataArgs = joinTableArgs(
        DatabaseServerLabelRule,
        "databaseServerLabels",
      );

      expect(matchLabels.name).toBe(
        "DatabaseServerLabelRuleDatabaseServerLabel",
      );
      expect(matchLabels.joinColumns?.[0]?.name).toBe(
        "databaseServerLabelRuleId",
      );
      expect(matchLabels.inverseJoinColumns?.[0]?.name).toBe("labelId");

      const labelsToAdd: JoinTableMetadataArgs = joinTableArgs(
        DatabaseServerLabelRule,
        "labelsToAdd",
      );

      expect(labelsToAdd.name).toBe("DatabaseServerLabelRuleLabelToAdd");
      expect(labelsToAdd.joinColumns?.[0]?.name).toBe(
        "databaseServerLabelRuleId",
      );
    });

    test("owner rule assigns users and teams through its own join tables", () => {
      const model: DatabaseServerOwnerRule = new DatabaseServerOwnerRule();

      for (const column of [
        "name",
        "description",
        "isEnabled",
        "notifyOwners",
        "ownerUsers",
        "ownerTeams",
      ]) {
        expect(model.getTableColumns().columns).toContain(column);
      }

      expect(
        joinTableArgs(DatabaseServerOwnerRule, "databaseServerLabels").name,
      ).toBe("DatabaseServerOwnerRuleDatabaseServerLabel");
      expect(joinTableArgs(DatabaseServerOwnerRule, "ownerUsers").name).toBe(
        "DatabaseServerOwnerRuleOwnerUser",
      );
      expect(joinTableArgs(DatabaseServerOwnerRule, "ownerTeams").name).toBe(
        "DatabaseServerOwnerRuleOwnerTeam",
      );

      for (const property of [
        "databaseServerLabels",
        "ownerUsers",
        "ownerTeams",
      ]) {
        expect(
          joinTableArgs(DatabaseServerOwnerRule, property).joinColumns?.[0]
            ?.name,
        ).toBe("databaseServerOwnerRuleId");
      }
    });

    test("the name pattern tells people the engine is part of the name", () => {
      for (const modelType of [
        DatabaseServerLabelRule,
        DatabaseServerOwnerRule,
      ] as Array<ModelType>) {
        expect(
          new modelType().getTableColumnMetadata("databaseServerNamePattern")
            .description,
        ).toContain("^PostgreSQL");
      }
    });
  });

  describe("Postgres identifier limits", () => {
    /*
     * Postgres silently truncates identifiers to 63 bytes, so two long names
     * that share a prefix become the same table, and a generated migration
     * never matches its own output again.
     */
    const LIMIT: number = 63;

    test("every table, join table, join column and named index fits", () => {
      const names: Array<string> = [];
      const targets: Array<unknown> = DATABASE_MODELS.map(
        (spec: DatabaseModelSpec): unknown => {
          return spec.modelType;
        },
      );

      for (const spec of DATABASE_MODELS) {
        names.push(spec.tableName);
      }

      for (const joinTable of getMetadataArgsStorage()
        .joinTables as Array<JoinTableMetadataArgs>) {
        if (!targets.includes(joinTable.target)) {
          continue;
        }

        names.push(joinTable.name!);

        for (const column of [
          ...(joinTable.joinColumns || []),
          ...(joinTable.inverseJoinColumns || []),
        ]) {
          names.push(column.name!);
        }
      }

      for (const target of targets) {
        for (const index of classIndexes(target as ModelType)) {
          if (index.name) {
            names.push(index.name);
          }
        }
      }

      // The three affected-resource join tables live on other models.
      for (const [modelType] of AFFECTED) {
        names.push(joinTableArgs(modelType, "databaseServers").name!);
      }

      expect(names.length).toBeGreaterThan(15);

      const tooLong: Array<string> = names.filter((name: string): boolean => {
        return name.length > LIMIT;
      });

      expect(tooLong).toEqual([]);
    });

    test("every column name fits", () => {
      for (const spec of DATABASE_MODELS) {
        for (const column of new spec.modelType().getTableColumns().columns) {
          expect(column.length).toBeLessThanOrEqual(LIMIT);
        }
      }
    });
  });

  describe("permissions", () => {
    test("all 23 permissions exist in the enum and the catalogue", () => {
      const enumValues: Set<string> = new Set(Object.values(Permission));

      for (const name of DATABASE_SERVER_PERMISSIONS) {
        expect(enumValues.has(name)).toBe(true);
        expect(Permission[name as keyof typeof Permission]).toBe(name);

        const props: PermissionProps | undefined =
          PERMISSION_PROPS_BY_NAME.get(name);

        expect(props).toBeDefined();
        expect(props!.isAssignableToTenant).toBe(true);
        expect(props!.isRolePermission).toBe(false);
        expect(props!.group).toBe("Telemetry");
        expect(props!.title).toContain("Database");
        expect(props!.title).not.toContain("DatabaseServer");
        expect(props!.title).not.toContain("Ceph");
        expect(props!.description.length).toBeGreaterThan(0);
        expect(props!.description).not.toContain("Ceph");

        // The lookups the permission UI and the error messages use.
        expect(PermissionHelper.getTitle(name as Permission)).toBe(
          props!.title,
        );
        expect(PermissionHelper.getDescription(name as Permission)).toBe(
          props!.description,
        );
      }

      // No stray members - the catalogue must not sprout a 24th.
      const members: Array<string> = Array.from(enumValues).filter(
        (value: string) => {
          return value.includes("DatabaseServer");
        },
      );

      expect(members.sort()).toEqual([...DATABASE_SERVER_PERMISSIONS].sort());
    });

    test("each permission appears exactly once in the props catalogue", () => {
      for (const name of DATABASE_SERVER_PERMISSIONS) {
        expect(
          PERMISSION_PROPS.filter((props: PermissionProps): boolean => {
            return props.permission.toString() === name;
          }),
        ).toHaveLength(1);
      }
    });

    test("titles are unique among the catalogue", () => {
      for (const name of DATABASE_SERVER_PERMISSIONS) {
        const title: string = PERMISSION_PROPS_BY_NAME.get(name)!.title;

        expect(
          PERMISSION_PROPS.filter((props: PermissionProps): boolean => {
            return props.title === title;
          }),
        ).toHaveLength(1);
      }
    });

    test("database Delete/Edit/Read are label-scoped access-control permissions; nothing else is", () => {
      for (const name of DATABASE_SERVER_PERMISSIONS) {
        const props: PermissionProps = PERMISSION_PROPS_BY_NAME.get(name)!;
        const labelScoped: boolean = [
          "DeleteDatabaseServer",
          "EditDatabaseServer",
          "ReadDatabaseServer",
        ].includes(name);

        expect({ name, flag: props.isAccessControlPermission }).toEqual({
          name,
          flag: labelScoped,
        });
      }
    });

    test("feeds have no Delete permission - they are append-only", () => {
      expect(Object.values(Permission)).not.toContain(
        "DeleteDatabaseServerFeed",
      );
    });

    test.each(DATABASE_MODELS)(
      "$name references only real, catalogued permissions",
      (spec: DatabaseModelSpec) => {
        const enumValues: Set<string> = new Set(Object.values(Permission));
        const model: BaseModel = new spec.modelType();

        for (const permission of allReferencedPermissions(model)) {
          const value: string = permission.toString();

          expect(enumValues.has(value)).toBe(true);
          expect(PERMISSION_PROPS_BY_NAME.has(value)).toBe(true);
        }
      },
    );

    test.each(DATABASE_MODELS)(
      "$name gates on Database permissions, never on another product's",
      (spec: DatabaseModelSpec) => {
        const model: BaseModel = new spec.modelType();

        for (const permission of allReferencedPermissions(model)) {
          const value: string = permission.toString();

          expect(value).not.toContain("Ceph");
          expect(value).not.toContain("CloudResource");
          expect(value).not.toContain("VMware");
        }
      },
    );

    test.each(DATABASE_MODELS)(
      "$name has no column that requires a permission its table does not accept on create",
      (spec: DatabaseModelSpec) => {
        /*
         * The PermissionCatalogueCoverage sweep, scoped: a granular holder
         * that passes the table gate must not fail on a column gate.
         */
        const model: BaseModel = new spec.modelType();
        const roles: Set<string> = new Set(
          PermissionHelper.getRolePermissionProps().map(
            (props: PermissionProps): string => {
              return props.permission.toString();
            },
          ),
        );
        const tableCreate: Set<string> = new Set(
          sorted(model.getCreatePermissions()),
        );

        for (const column of ownColumns(model)) {
          for (const permission of columnAccess(model, column).create || []) {
            const value: string = permission.toString();

            expect({
              column,
              value,
              ok: roles.has(value) || tableCreate.has(value),
            }).toEqual({ column, value, ok: true });
          }
        }
      },
    );
  });

  describe("affected-resource relations", () => {
    test.each(AFFECTED)(
      "%p.databaseServers is a ManyToMany through %s",
      (modelType: ModelType, joinTableName: string, joinColumn: string) => {
        const model: BaseModel = new modelType();
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata("databaseServers");

        expect(metadata).toBeDefined();
        expect(metadata.type).toBe(TableColumnType.EntityArray);
        expect(metadata.modelType).toBe(DatabaseServer);
        expect(metadata.title).toBe("Databases");
        expect(metadata.required).toBeFalsy();

        const relation: RelationMetadataArgs = relationArgs(
          modelType,
          "databaseServers",
        );

        expect(relation.relationType).toBe("many-to-many");

        const joinTable: JoinTableMetadataArgs = joinTableArgs(
          modelType,
          "databaseServers",
        );

        expect(joinTable.name).toBe(joinTableName);
        expect(joinTable.joinColumns?.[0]?.name).toBe(joinColumn);
        expect(joinTable.inverseJoinColumns?.[0]?.name).toBe(
          "databaseServerId",
        );

        // The initialiser matters: BaseModel enumerates own properties.
        expect(
          Object.prototype.hasOwnProperty.call(model, "databaseServers"),
        ).toBe(true);
      },
    );

    test.each(AFFECTED)(
      "%p.databaseServers shares the cephClusters access-control lists",
      (modelType: ModelType) => {
        const model: BaseModel = new modelType();

        expect(model.getColumnAccessControlFor("databaseServers")).toEqual(
          model.getColumnAccessControlFor("cephClusters"),
        );
      },
    );
  });

  describe("telemetry discriminator", () => {
    test("ServiceType.DatabaseServer is the table name, like every infra type", () => {
      /*
       * Stored verbatim in ClickHouse's serviceType / primaryEntityType, so
       * the value is a contract, not a label.
       */
      expect(ServiceType.DatabaseServer).toBe("DatabaseServer");
      expect(ServiceType.DatabaseServer.toString()).toBe(
        new DatabaseServer().tableName,
      );
      expect(
        Object.values(ServiceType).filter((value: string): boolean => {
          return value === "DatabaseServer";
        }),
      ).toHaveLength(1);
    });
  });
});
