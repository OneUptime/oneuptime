import AllModelTypes from "../../../Models/DatabaseModels/Index";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import XcpNgPool from "../../../Models/DatabaseModels/XcpNgPool";
import XcpNgPoolFeed, {
  XcpNgPoolFeedEventType,
} from "../../../Models/DatabaseModels/XcpNgPoolFeed";
import XcpNgPoolLabelRule from "../../../Models/DatabaseModels/XcpNgPoolLabelRule";
import XcpNgPoolOwnerRule from "../../../Models/DatabaseModels/XcpNgPoolOwnerRule";
import XcpNgPoolOwnerTeam from "../../../Models/DatabaseModels/XcpNgPoolOwnerTeam";
import XcpNgPoolOwnerUser from "../../../Models/DatabaseModels/XcpNgPoolOwnerUser";
import XcpNgResource from "../../../Models/DatabaseModels/XcpNgResource";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import ProductKey from "../../../Types/Product/ProductKey";
import { PRODUCT_OF_TABLE } from "../../../Types/Product/ProductOfTable";
import { PRODUCT_RECORD_TABLES } from "../../../Types/Product/ProductRecordTables";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";

/*
 * The XCP-ng product is persisted as seven TypeORM entities cloned from the
 * Proxmox product. A clone is exactly the kind of change that passes review
 * while being wrong: a leftover `/proxmox-...` route shadows the Proxmox API,
 * a permission a model names but the catalogue lacks can never be granted, a
 * bigint column without its transformer overflows past 2^53, and a copied
 * AI-agent column offers a feature this product does not have yet (#10998).
 *
 * Pinned here, all of it only failing in production otherwise:
 *
 *   - registration in Models/Index.ts (no table, no API otherwise) and in
 *     the product's record tables;
 *   - the table, route and display names the other layers key on;
 *   - the pool's identity: unique per project on its XAPI UUID
 *     (poolIdentifier), the column ingest matches on, never on its name;
 *   - the write-locked inventory table (ingest writes as root, nobody else);
 *   - the feed's event types, and that the feed has no Edit permission;
 *   - the bigint transformers on every byte column;
 *   - the affected-resource relations on Alert / Incident /
 *     ScheduledMaintenance / Monitor;
 *   - NO AI-agent columns on XcpNgPool.
 *
 * Pure metadata - no Postgres connection anywhere.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

interface XcpNgModelSpec {
  name: string;
  modelType: ModelType;
  tableName: string;
  crudApiPath: string;
}

const XCP_NG_MODELS: Array<XcpNgModelSpec> = [
  {
    name: "XcpNgPool",
    modelType: XcpNgPool,
    tableName: "XcpNgPool",
    crudApiPath: "/xcp-ng-pool",
  },
  {
    name: "XcpNgResource",
    modelType: XcpNgResource,
    tableName: "XcpNgResource",
    crudApiPath: "/xcp-ng-resource",
  },
  {
    name: "XcpNgPoolFeed",
    modelType: XcpNgPoolFeed,
    tableName: "XcpNgPoolFeed",
    crudApiPath: "/xcp-ng-pool-feed",
  },
  {
    name: "XcpNgPoolLabelRule",
    modelType: XcpNgPoolLabelRule,
    tableName: "XcpNgPoolLabelRule",
    crudApiPath: "/xcp-ng-pool-label-rule",
  },
  {
    name: "XcpNgPoolOwnerRule",
    modelType: XcpNgPoolOwnerRule,
    tableName: "XcpNgPoolOwnerRule",
    crudApiPath: "/xcp-ng-pool-owner-rule",
  },
  {
    name: "XcpNgPoolOwnerTeam",
    modelType: XcpNgPoolOwnerTeam,
    tableName: "XcpNgPoolOwnerTeam",
    crudApiPath: "/xcp-ng-pool-owner-team",
  },
  {
    name: "XcpNgPoolOwnerUser",
    modelType: XcpNgPoolOwnerUser,
    tableName: "XcpNgPoolOwnerUser",
    crudApiPath: "/xcp-ng-pool-owner-user",
  },
];

// Every child of XcpNgPool and the relation property it reaches it by.
const POOL_CHILDREN: Array<[ModelType, string]> = [
  [XcpNgResource, "xcpNgPool"],
  [XcpNgPoolFeed, "xcpNgPool"],
  [XcpNgPoolOwnerTeam, "xcpNgPool"],
  [XcpNgPoolOwnerUser, "xcpNgPool"],
];

const XCP_NG_PERMISSIONS: Array<string> = [
  "XcpNgAdmin",
  "XcpNgMember",
  "XcpNgViewer",
  "CreateXcpNgPool",
  "ReadXcpNgPool",
  "EditXcpNgPool",
  "DeleteXcpNgPool",
  "CreateXcpNgPoolOwnerTeam",
  "ReadXcpNgPoolOwnerTeam",
  "EditXcpNgPoolOwnerTeam",
  "DeleteXcpNgPoolOwnerTeam",
  "CreateXcpNgPoolOwnerUser",
  "ReadXcpNgPoolOwnerUser",
  "EditXcpNgPoolOwnerUser",
  "DeleteXcpNgPoolOwnerUser",
  "CreateXcpNgPoolOwnerRule",
  "ReadXcpNgPoolOwnerRule",
  "EditXcpNgPoolOwnerRule",
  "DeleteXcpNgPoolOwnerRule",
  "CreateXcpNgPoolLabelRule",
  "ReadXcpNgPoolLabelRule",
  "EditXcpNgPoolLabelRule",
  "DeleteXcpNgPoolLabelRule",
  "CreateXcpNgPoolFeed",
  "ReadXcpNgPoolFeed",
];

// The counts and capacity the snapshot flush writes on the pool.
const POOL_SNAPSHOT_COLUMNS: Array<string> = [
  "hostCount",
  "runningHostCount",
  "disabledHostCount",
  "vmCount",
  "runningVmCount",
  "storageRepositoryCount",
  "vdiCount",
  "storageCapacityBytes",
  "storageUsedBytes",
];

// What only OneUptime writes on a pool: never a person's create.
const POOL_INGEST_COLUMNS: Array<string> = [
  "reportedName",
  "xenOrchestraName",
  "otelCollectorStatus",
  "agentVersion",
  "lastSeenAt",
  "agentLastSeenAt",
  "slug",
  "archivedAt",
  "archivedByUserId",
  ...POOL_SNAPSHOT_COLUMNS,
];

const POOL_BYTE_COLUMNS: Array<string> = [
  "storageCapacityBytes",
  "storageUsedBytes",
];

const RESOURCE_BYTE_COLUMNS: Array<string> = [
  "latestMemoryBytes",
  "maxMemoryBytes",
  "latestDiskBytes",
  "maxDiskBytes",
  "virtualAllocationBytes",
];

const RESOURCE_DECIMAL_COLUMNS: Array<string> = [
  "latestCpuPercent",
  "loadAverage",
  "latestMemoryPercent",
  "latestDiskPercent",
  "powerWatts",
];

const PERMISSION_PROPS: Array<PermissionProps> =
  PermissionHelper.getAllPermissionProps();

const PERMISSION_PROPS_BY_NAME: Map<string, PermissionProps> = new Map(
  PERMISSION_PROPS.map((props: PermissionProps) => {
    return [props.permission.toString(), props];
  }),
);

function allReferencedPermissions(model: BaseModel): Array<Permission> {
  const permissions: Array<Permission> = [
    ...(model.createRecordPermissions || []),
    ...(model.readRecordPermissions || []),
    ...(model.updateRecordPermissions || []),
    ...(model.deleteRecordPermissions || []),
  ];

  for (const column of model.getTableColumns().columns) {
    const accessControl: ReturnType<BaseModel["getColumnAccessControlFor"]> =
      model.getColumnAccessControlFor(column);

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

function transformerOf(
  modelType: ModelType,
  property: string,
): ValueTransformer {
  const transformer: ValueTransformer | Array<ValueTransformer> | undefined =
    columnArgs(modelType, property).options.transformer;

  if (!transformer) {
    throw new Error(`${modelType.name}.${property} has no transformer`);
  }

  return Array.isArray(transformer)
    ? (transformer[transformer.length - 1] as ValueTransformer)
    : transformer;
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

function findIndex(
  modelType: ModelType,
  columns: Array<string>,
): IndexMetadataArgs | undefined {
  return getMetadataArgsStorage().indices.find((index: IndexMetadataArgs) => {
    return (
      index.target === modelType &&
      Array.isArray(index.columns) &&
      index.columns.length === columns.length &&
      columns.every((column: string) => {
        return (index.columns as Array<string>).includes(column);
      })
    );
  });
}

describe("XCP-ng database models", () => {
  test("the product has the seven models of the design", () => {
    expect(XCP_NG_MODELS.length).toBe(7);
  });

  describe("registration and identity", () => {
    test.each(XCP_NG_MODELS)(
      "$name is registered in Models/Index.ts",
      (spec: XcpNgModelSpec) => {
        /*
         * Boot-time createTables() and the migration generator both iterate
         * that array. A model missing from it type-checks, imports fine,
         * and simply has no table in Postgres.
         */
        expect(MODEL_TYPES).toContain(spec.modelType);
      },
    );

    test.each(XCP_NG_MODELS)(
      "$name carries its own table and route, and is tenant-scoped by project",
      (spec: XcpNgModelSpec) => {
        const model: BaseModel = new spec.modelType();

        expect(model.tableName).toBe(spec.tableName);
        expect(model.getCrudApiPath()?.toString()).toBe(spec.crudApiPath);
        expect(model.getTenantColumn()).toBe("projectId");
        expect(model.singularName?.startsWith("XCP-ng ")).toBe(true);
        expect(model.pluralName?.startsWith("XCP-ng ")).toBe(true);
      },
    );

    test("the pool is named the way the product names it", () => {
      const pool: XcpNgPool = new XcpNgPool();

      expect(pool.singularName).toBe("XCP-ng Pool");
      expect(pool.pluralName).toBe("XCP-ng Pools");
    });

    test("no XCP-ng route or table name collides with another model", () => {
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

      for (const spec of XCP_NG_MODELS) {
        expect(routes.get(spec.crudApiPath)).toBe(1);
        expect(tables.get(spec.tableName)).toBe(1);
      }
    });

    test.each(XCP_NG_MODELS)(
      "$name gates on XCP-ng permissions, never on the cloned product's",
      (spec: XcpNgModelSpec) => {
        const model: BaseModel = new spec.modelType();

        for (const permission of allReferencedPermissions(model)) {
          expect(permission.toString()).not.toMatch(
            /Proxmox|Ceph|VMware|StorageArray/,
          );
        }
        expect(model.getCrudApiPath()?.toString()).not.toMatch(
          /proxmox|ceph|vmware|storage-array/,
        );
      },
    );

    test("every table is one of the XCP-ng product's records", () => {
      expect(
        [...(PRODUCT_RECORD_TABLES[ProductKey.XcpNg] || [])].sort(),
      ).toEqual(
        XCP_NG_MODELS.map((spec: XcpNgModelSpec) => {
          return spec.tableName;
        }).sort(),
      );
      expect(PRODUCT_OF_TABLE["XcpNgPool"]).toBe(ProductKey.XcpNg);
    });
  });

  describe("permissions", () => {
    test.each(XCP_NG_PERMISSIONS)(
      "%s exists in the permission catalogue",
      (permission: string) => {
        expect(PERMISSION_PROPS_BY_NAME.has(permission)).toBe(true);
      },
    );

    test("the feed has no Edit permission: feed items are never edited", () => {
      expect(PERMISSION_PROPS_BY_NAME.has("EditXcpNgPoolFeed")).toBe(false);
      expect(
        (Permission as unknown as Record<string, string>)["EditXcpNgPoolFeed"],
      ).toBeUndefined();
    });

    test.each(XCP_NG_MODELS)(
      "every permission $name names is a real, grantable one",
      (spec: XcpNgModelSpec) => {
        for (const permission of allReferencedPermissions(
          new spec.modelType(),
        )) {
          expect({
            permission: permission.toString(),
            known: PERMISSION_PROPS_BY_NAME.has(permission.toString()),
          }).toEqual({ permission: permission.toString(), known: true });
        }
      },
    );

    test("reading a pool is open to XCP-ng readers, and editing it to its editors", () => {
      const pool: XcpNgPool = new XcpNgPool();

      expect(pool.readRecordPermissions).toEqual(
        expect.arrayContaining([Permission.ReadXcpNgPool]),
      );
      expect(pool.createRecordPermissions).toEqual(
        expect.arrayContaining([Permission.CreateXcpNgPool]),
      );
      expect(pool.updateRecordPermissions).toEqual(
        expect.arrayContaining([Permission.EditXcpNgPool]),
      );
      expect(pool.deleteRecordPermissions).toEqual(
        expect.arrayContaining([Permission.DeleteXcpNgPool]),
      );
    });

    test("the inventory is read-only to everyone: ingest writes it as root", () => {
      const resource: XcpNgResource = new XcpNgResource();

      expect(resource.createRecordPermissions).toEqual([]);
      expect(resource.updateRecordPermissions).toEqual([]);
      expect(resource.deleteRecordPermissions).toEqual([]);
      expect(resource.readRecordPermissions).toEqual(
        expect.arrayContaining([Permission.ReadXcpNgPool]),
      );
    });
  });

  describe("XcpNgPool", () => {
    test("is unique per project on its XAPI UUID, the column telemetry is matched on", () => {
      /*
       * The @UniqueColumnBy decorators are app-level only. Two ingest
       * workers (or an agent and a probe) discovering one pool at once race
       * find-or-create; only the DB-level unique index makes the loser find
       * the winner's row.
       */
      const found: IndexMetadataArgs | undefined = findIndex(XcpNgPool, [
        "projectId",
        "poolIdentifier",
      ]);

      expect(found).toBeDefined();
      expect(found?.unique).toBe(true);
    });

    test("is unique per project on its name too, which ingest makes unique by the UUID's start", () => {
      const found: IndexMetadataArgs | undefined = findIndex(XcpNgPool, [
        "projectId",
        "name",
      ]);

      expect(found).toBeDefined();
      expect(found?.unique).toBe(true);
    });

    test("declares IDX_xcp_ng_pool_slug by name, UNIQUE and partial", () => {
      const found: IndexMetadataArgs | undefined =
        getMetadataArgsStorage().indices.find((index: IndexMetadataArgs) => {
          return (
            index.target === XcpNgPool && index.name === "IDX_xcp_ng_pool_slug"
          );
        });

      expect(found).toBeDefined();
      expect(found?.unique).toBe(true);
      expect(found?.columns).toEqual(["slug"]);
      expect(found?.where).toBe('"deletedAt" IS NULL');
    });

    test("indexes (projectId, isArchived) for the list and archived pages", () => {
      expect(findIndex(XcpNgPool, ["projectId", "isArchived"])).toBeDefined();
    });

    test("carries the standard resource columns and every snapshot column of the design", () => {
      const columns: Array<string> = new XcpNgPool().getTableColumns().columns;

      for (const column of [
        "projectId",
        "name",
        "slug",
        "description",
        "poolIdentifier",
        "reportedName",
        "xenOrchestraName",
        "otelCollectorStatus",
        "agentVersion",
        "lastSeenAt",
        "agentLastSeenAt",
        "createdByUserId",
        "isArchived",
        "archivedAt",
        "archivedByUserId",
        "labels",
        "retainTelemetryDataForDays",
        "telemetryRetentionConfig",
        ...POOL_SNAPSHOT_COLUMNS,
      ]) {
        expect(columns).toContain(column);
      }
    });

    test("has NO AI-agent columns yet (#10998), nor the cloned product's own", () => {
      const columns: Array<string> = new XcpNgPool().getTableColumns().columns;

      for (const column of [
        "isAiInvestigationEnabled",
        "aiRemediationMode",
        "aiCommandAllowlist",
        "aiAccessLastVerifiedAt",
        "aiAccessLastError",
        "aiAccessConfiguredAt",
      ]) {
        expect(columns).not.toContain(column);
      }
      for (const column of columns) {
        expect(column).not.toMatch(/^ai[A-Z]|^isAi|Ai[A-Z]/);
      }

      for (const column of [
        "nodeCount",
        "onlineNodeCount",
        "guestCount",
        "guestsWithoutBackupCount",
        "pveVersion",
        "fsid",
        "cephVersion",
      ]) {
        expect(columns).not.toContain(column);
      }
    });

    test("what only OneUptime writes cannot be set on create", () => {
      const model: XcpNgPool = new XcpNgPool();

      for (const column of POOL_INGEST_COLUMNS) {
        expect({
          column,
          create: model.getColumnAccessControlFor(column)?.create,
        }).toEqual({ column, create: [] });
      }
    });

    test("what Xen Orchestra reports is never edited by a person", () => {
      const model: XcpNgPool = new XcpNgPool();

      for (const column of [
        "reportedName",
        "xenOrchestraName",
        "agentLastSeenAt",
        "slug",
        "archivedAt",
        "archivedByUserId",
      ]) {
        expect({
          column,
          update: model.getColumnAccessControlFor(column)?.update,
        }).toEqual({ column, update: [] });
      }
    });

    test("a person names the pool, describes it, labels it, archives it and may set its UUID", () => {
      const model: XcpNgPool = new XcpNgPool();

      for (const column of [
        "name",
        "description",
        "poolIdentifier",
        "labels",
        "isArchived",
        "retainTelemetryDataForDays",
        "telemetryRetentionConfig",
      ]) {
        expect({
          column,
          create: model.getColumnAccessControlFor(column)?.create,
          update: model.getColumnAccessControlFor(column)?.update,
        }).toEqual({
          column,
          create: expect.arrayContaining([Permission.CreateXcpNgPool]),
          update: expect.arrayContaining([Permission.EditXcpNgPool]),
        });
      }
    });

    test.each(POOL_BYTE_COLUMNS)(
      "%s round-trips past 2^53 as a number through its bigint transformer",
      (column: string) => {
        const metadata: TableColumnMetadata =
          new XcpNgPool().getTableColumnMetadata(column);

        expect(metadata.type).toBe(TableColumnType.BigPositiveNumber);

        const transformer: ValueTransformer = transformerOf(XcpNgPool, column);
        const fromDatabase: unknown = transformer.from("9007199254740993");

        expect(typeof fromDatabase).toBe("number");
        expect(transformer.from(null)).toBeNull();
      },
    );

    test("counts are numbers", () => {
      const pool: XcpNgPool = new XcpNgPool();

      for (const column of POOL_SNAPSHOT_COLUMNS.filter((column: string) => {
        return !POOL_BYTE_COLUMNS.includes(column);
      })) {
        expect({
          column,
          type: pool.getTableColumnMetadata(column).type,
        }).toEqual({ column, type: TableColumnType.Number });
      }
    });

    test("labels are what access control reads", () => {
      expect(new XcpNgPool().getAccessControlColumn()).toBe("labels");
    });
  });

  describe("XcpNgResource", () => {
    test("is unique per pool on (kind, externalId) - what the bulk upsert ON CONFLICTs on", () => {
      const found: IndexMetadataArgs | undefined = findIndex(XcpNgResource, [
        "projectId",
        "xcpNgPoolId",
        "kind",
        "externalId",
      ]);

      expect(found).toBeDefined();
      expect(found?.unique).toBe(true);
    });

    test.each(RESOURCE_BYTE_COLUMNS)(
      "%s is a bigint that reads back as a number",
      (column: string) => {
        expect(new XcpNgResource().getTableColumnMetadata(column).type).toBe(
          TableColumnType.BigPositiveNumber,
        );

        const transformer: ValueTransformer = transformerOf(
          XcpNgResource,
          column,
        );

        expect(typeof transformer.from("1099511627776")).toBe("number");
        expect(transformer.from(null)).toBeNull();
      },
    );

    test.each(RESOURCE_DECIMAL_COLUMNS)(
      "%s has a transformer, so a decimal reads back as a number",
      (column: string) => {
        const transformer: ValueTransformer = transformerOf(
          XcpNgResource,
          column,
        );

        expect(transformer.from("12.5")).toBe(12.5);
      },
    );

    test("belongs to its pool, and goes when the pool does", () => {
      const relation: RelationMetadataArgs = relationArgs(
        XcpNgResource,
        "xcpNgPool",
      );

      expect(relation.relationType).toBe("many-to-one");
      expect(
        (relation.options as { onDelete?: string } | undefined)?.onDelete,
      ).toBe("CASCADE");
    });

    test("carries the inventory columns of the design", () => {
      const columns: Array<string> = new XcpNgResource().getTableColumns()
        .columns;

      for (const column of [
        "kind",
        "externalId",
        "name",
        "powerState",
        "isUp",
        "isEnabled",
        "isControlDomain",
        "parentHostExternalId",
        "parentHostName",
        "storageRepositoryExternalId",
        "storageRepositoryName",
        "vmExternalId",
        "vmName",
        "uptimeSeconds",
        "lastRunningAt",
        "srType",
        "contentType",
        "isShared",
        "tags",
        "metricsUpdatedAt",
        "lastSeenAt",
        ...RESOURCE_BYTE_COLUMNS,
        ...RESOURCE_DECIMAL_COLUMNS,
      ]) {
        expect(columns).toContain(column);
      }
    });
  });

  describe("children of the pool", () => {
    test.each(POOL_CHILDREN)(
      "%p reaches its pool and is deleted with it",
      (modelType: ModelType, property: string) => {
        const relation: RelationMetadataArgs = relationArgs(
          modelType,
          property,
        );

        expect(relation.relationType).toBe("many-to-one");
        expect(
          (relation.options as { onDelete?: string } | undefined)?.onDelete,
        ).toBe("CASCADE");
        expect(new modelType().getTableColumns().columns).toContain(
          "xcpNgPoolId",
        );
      },
    );

    test("an owner team and an owner user are each listed once per pool", () => {
      const team: IndexMetadataArgs | undefined = findIndex(
        XcpNgPoolOwnerTeam,
        ["xcpNgPoolId", "teamId", "projectId"],
      );
      const user: IndexMetadataArgs | undefined = findIndex(
        XcpNgPoolOwnerUser,
        ["xcpNgPoolId", "userId", "projectId"],
      );

      expect(team?.unique).toBe(true);
      expect(user?.unique).toBe(true);
    });

    test("owners say whether they were told, for the owner-added job", () => {
      for (const modelType of [XcpNgPoolOwnerTeam, XcpNgPoolOwnerUser]) {
        expect(new modelType().getTableColumns().columns).toContain(
          "isOwnerNotified",
        );
      }
    });
  });

  describe("XcpNgPoolFeed", () => {
    test("names every event the services write, by value", () => {
      expect(Object.values(XcpNgPoolFeedEventType).sort()).toEqual(
        [
          "XcpNgPoolCreated",
          "XcpNgPoolUpdated",
          "XcpNgPoolArchived",
          "XcpNgPoolRestored",
          "OwnerUserAdded",
          "OwnerUserRemoved",
          "OwnerTeamAdded",
          "OwnerTeamRemoved",
          "OwnerRuleExecuted",
          "LabelRuleExecuted",
        ].sort(),
      );
    });

    test("is listed by pool, newest first, from an index", () => {
      expect(
        findIndex(XcpNgPoolFeed, ["xcpNgPoolId", "postedAt"]),
      ).toBeDefined();
    });

    test("is never edited: no update permission on the table", () => {
      expect(new XcpNgPoolFeed().updateRecordPermissions).toEqual([]);
    });
  });

  describe("rules", () => {
    test("a label rule matches on the pool's labels, name and description and adds labels", () => {
      const columns: Array<string> = new XcpNgPoolLabelRule().getTableColumns()
        .columns;

      for (const column of [
        "name",
        "description",
        "isEnabled",
        "xcpNgPoolLabels",
        "xcpNgPoolNamePattern",
        "xcpNgPoolDescriptionPattern",
        "labelsToAdd",
      ]) {
        expect(columns).toContain(column);
      }
    });

    test("an owner rule matches the same way, adds owners and may tell them", () => {
      const columns: Array<string> = new XcpNgPoolOwnerRule().getTableColumns()
        .columns;

      for (const column of [
        "name",
        "description",
        "isEnabled",
        "notifyOwners",
        "xcpNgPoolLabels",
        "xcpNgPoolNamePattern",
        "xcpNgPoolDescriptionPattern",
        "ownerUsers",
        "ownerTeams",
      ]) {
        expect(columns).toContain(column);
      }
    });
  });

  describe("the records a pool can be affected by", () => {
    const AFFECTED_BY: Array<[ModelType, string, string]> = [
      [Alert, "AlertXcpNgPool", "alertId"],
      [Incident, "IncidentXcpNgPool", "incidentId"],
      [Monitor, "MonitorXcpNgPool", "monitorId"],
      [
        ScheduledMaintenance,
        "ScheduledMaintenanceXcpNgPool",
        "scheduledMaintenanceId",
      ],
    ];

    test.each(AFFECTED_BY)(
      "%p lists its XCP-ng pools in %s",
      (modelType: ModelType, joinTableName: string, joinColumn: string) => {
        const metadata: TableColumnMetadata =
          new modelType().getTableColumnMetadata("xcpNgPools");

        expect(metadata.type).toBe(TableColumnType.EntityArray);
        expect(metadata.modelType).toBe(XcpNgPool);

        const relation: RelationMetadataArgs = relationArgs(
          modelType,
          "xcpNgPools",
        );
        expect(relation.relationType).toBe("many-to-many");

        const joinTable: JoinTableMetadataArgs = joinTableArgs(
          modelType,
          "xcpNgPools",
        );
        expect(joinTable.name).toBe(joinTableName);
        expect(
          (joinTable.joinColumns as Array<{ name?: string }> | undefined)?.[0]
            ?.name,
        ).toBe(joinColumn);
        expect(
          (
            joinTable.inverseJoinColumns as Array<{ name?: string }> | undefined
          )?.[0]?.name,
        ).toBe("xcpNgPoolId");
      },
    );
  });
});
