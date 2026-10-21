import AllModelTypes from "../../../Models/DatabaseModels/Index";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StorageArray from "../../../Models/DatabaseModels/StorageArray";
import StorageArrayFeed, {
  StorageArrayFeedEventType,
} from "../../../Models/DatabaseModels/StorageArrayFeed";
import StorageArrayLabelRule from "../../../Models/DatabaseModels/StorageArrayLabelRule";
import StorageArrayOwnerRule from "../../../Models/DatabaseModels/StorageArrayOwnerRule";
import StorageArrayOwnerTeam from "../../../Models/DatabaseModels/StorageArrayOwnerTeam";
import StorageArrayOwnerUser from "../../../Models/DatabaseModels/StorageArrayOwnerUser";
import StorageArrayResource from "../../../Models/DatabaseModels/StorageArrayResource";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";

/*
 * The Storage Arrays product is persisted as seven TypeORM entities cloned
 * from the Ceph product. A clone is exactly the kind of change that passes
 * review while being wrong: a leftover `/ceph-...` route silently shadows the
 * Ceph API, a permission referenced by a model but missing from the
 * catalogue can never be granted, a bigint column without its transformer
 * overflows past 2^53, and a copied AI-agent column offers a feature this
 * product deliberately does not have.
 *
 * Everything pinned here is a property that only fails in production:
 *
 *   - registration in Models/Index.ts (no table, no API otherwise)
 *   - the table / route / display names other layers key on
 *   - the unique indexes the ingest upsert paths rely on for race safety
 *   - the write-locked inventory table (ingest writes as root, nobody else)
 *   - the feed event enum contract the feed service and UI share
 *   - the bigint / decimal transformers on every byte and ratio column
 *   - the affected-resource relations on Alert / Incident /
 *     ScheduledMaintenance / Monitor
 *   - NO AI-agent columns on StorageArray
 *
 * Pure metadata — no Postgres connection anywhere.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

interface StorageArrayModelSpec {
  name: string;
  modelType: ModelType;
  tableName: string;
  crudApiPath: string;
  singularName: string;
  pluralName: string;
}

const STORAGE_ARRAY_MODELS: Array<StorageArrayModelSpec> = [
  {
    name: "StorageArray",
    modelType: StorageArray,
    tableName: "StorageArray",
    crudApiPath: "/storage-array",
    singularName: "Storage Array",
    pluralName: "Storage Arrays",
  },
  {
    name: "StorageArrayResource",
    modelType: StorageArrayResource,
    tableName: "StorageArrayResource",
    crudApiPath: "/storage-array-resource",
    singularName: "Storage Array Resource",
    pluralName: "Storage Array Resources",
  },
  {
    name: "StorageArrayFeed",
    modelType: StorageArrayFeed,
    tableName: "StorageArrayFeed",
    crudApiPath: "/storage-array-feed",
    singularName: "Storage Array Feed",
    pluralName: "Storage Array Feeds",
  },
  {
    name: "StorageArrayLabelRule",
    modelType: StorageArrayLabelRule,
    tableName: "StorageArrayLabelRule",
    crudApiPath: "/storage-array-label-rule",
    singularName: "Storage Array Label Rule",
    pluralName: "Storage Array Label Rules",
  },
  {
    name: "StorageArrayOwnerRule",
    modelType: StorageArrayOwnerRule,
    tableName: "StorageArrayOwnerRule",
    crudApiPath: "/storage-array-owner-rule",
    singularName: "Storage Array Owner Rule",
    pluralName: "Storage Array Owner Rules",
  },
  {
    name: "StorageArrayOwnerTeam",
    modelType: StorageArrayOwnerTeam,
    tableName: "StorageArrayOwnerTeam",
    crudApiPath: "/storage-array-owner-team",
    singularName: "Storage Array Team Owner",
    pluralName: "Storage Array Team Owners",
  },
  {
    name: "StorageArrayOwnerUser",
    modelType: StorageArrayOwnerUser,
    tableName: "StorageArrayOwnerUser",
    crudApiPath: "/storage-array-owner-user",
    singularName: "Storage Array User Owner",
    pluralName: "Storage Array User Owners",
  },
];

/** Every child of StorageArray and the relation property it reaches it by. */
const ARRAY_CHILDREN: Array<[ModelType, string]> = [
  [StorageArrayResource, "storageArray"],
  [StorageArrayFeed, "storageArray"],
  [StorageArrayOwnerTeam, "storageArray"],
  [StorageArrayOwnerUser, "storageArray"],
];

const STORAGE_ARRAY_PERMISSIONS: Array<string> = [
  "CreateStorageArray",
  "ReadStorageArray",
  "EditStorageArray",
  "DeleteStorageArray",
  "CreateStorageArrayOwnerTeam",
  "ReadStorageArrayOwnerTeam",
  "EditStorageArrayOwnerTeam",
  "DeleteStorageArrayOwnerTeam",
  "CreateStorageArrayOwnerUser",
  "ReadStorageArrayOwnerUser",
  "EditStorageArrayOwnerUser",
  "DeleteStorageArrayOwnerUser",
  "CreateStorageArrayOwnerRule",
  "ReadStorageArrayOwnerRule",
  "EditStorageArrayOwnerRule",
  "DeleteStorageArrayOwnerRule",
  "CreateStorageArrayLabelRule",
  "ReadStorageArrayLabelRule",
  "EditStorageArrayLabelRule",
  "DeleteStorageArrayLabelRule",
  "CreateStorageArrayFeed",
  "EditStorageArrayFeed",
  "ReadStorageArrayFeed",
];

// The StorageArray columns the snapshot scan and the discovery path write.
const ARRAY_SNAPSHOT_COLUMNS: Array<string> = [
  "storageSystem",
  "reportedName",
  "systemId",
  "osName",
  "osVersion",
  "capacityBytes",
  "usedBytes",
  "capacityUsedPercent",
  "dataReductionRatio",
  "openAlertCount",
  "criticalAlertCount",
  "warningAlertCount",
  "volumeCount",
  "hostCount",
  "podCount",
  "fileSystemCount",
  "bucketCount",
  "hardwareComponentCount",
  "unhealthyHardwareCount",
  "healthStatus",
];

const ARRAY_COUNTER_COLUMNS: Array<string> = [
  "openAlertCount",
  "criticalAlertCount",
  "warningAlertCount",
  "volumeCount",
  "hostCount",
  "podCount",
  "fileSystemCount",
  "bucketCount",
  "hardwareComponentCount",
  "unhealthyHardwareCount",
];

const RESOURCE_DECIMAL_COLUMNS: Array<string> = [
  "dataReductionRatio",
  "readLatencyUsec",
  "writeLatencyUsec",
  "readIops",
  "writeIops",
  "readBytesPerSec",
  "writeBytesPerSec",
  "temperatureCelsius",
  "replicationLagMs",
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

describe("Storage Array database models", () => {
  test("the inventory has the seven models of the design", () => {
    expect(STORAGE_ARRAY_MODELS.length).toBe(7);
  });

  describe("registration and identity", () => {
    test.each(STORAGE_ARRAY_MODELS)(
      "$name is registered in Models/Index.ts",
      (spec: StorageArrayModelSpec) => {
        /*
         * Boot-time createTables() and the migration generator both iterate
         * that array. A model missing from it type-checks, imports fine, and
         * simply has no table in Postgres.
         */
        expect(MODEL_TYPES).toContain(spec.modelType);
      },
    );

    test.each(STORAGE_ARRAY_MODELS)(
      "$name carries its own table, route and display names",
      (spec: StorageArrayModelSpec) => {
        const model: BaseModel = new spec.modelType();

        expect(model.tableName).toBe(spec.tableName);
        expect(model.getCrudApiPath()?.toString()).toBe(spec.crudApiPath);
        expect(model.singularName).toBe(spec.singularName);
        expect(model.pluralName).toBe(spec.pluralName);
        expect(model.getTenantColumn()).toBe("projectId");
      },
    );

    test("no storage array route or table name collides with another model", () => {
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

      for (const spec of STORAGE_ARRAY_MODELS) {
        expect(routes.get(spec.crudApiPath)).toBe(1);
        expect(tables.get(spec.tableName)).toBe(1);
      }
    });

    test.each(STORAGE_ARRAY_MODELS)(
      "$name gates on storage array permissions, never on the cloned product's",
      (spec: StorageArrayModelSpec) => {
        const model: BaseModel = new spec.modelType();

        for (const permission of allReferencedPermissions(model)) {
          expect(permission.toString()).not.toMatch(/Ceph|Proxmox|VMware/);
        }
        expect(model.getCrudApiPath()?.toString()).not.toMatch(
          /ceph|proxmox|vmware/,
        );
      },
    );
  });

  describe("StorageArray", () => {
    test("is unique per project on name, the storage.array.name join key", () => {
      /*
       * The @UniqueColumnBy decorator is app-level only. The array, volumes
       * and hosts scrapes of one agent arrive at once and race
       * find-or-create at ingest; only the DB-level unique index defuses
       * that.
       */
      const found: IndexMetadataArgs | undefined = findIndex(StorageArray, [
        "projectId",
        "name",
      ]);

      expect(found).toBeDefined();
      expect(found?.unique).toBe(true);
      expect(new StorageArray().getTableColumnMetadata("name").example).toBe(
        "pure-prod-01",
      );
    });

    test("declares IDX_storage_array_slug by name, UNIQUE and partial", () => {
      const found: IndexMetadataArgs | undefined =
        getMetadataArgsStorage().indices.find((index: IndexMetadataArgs) => {
          return (
            index.target === StorageArray &&
            index.name === "IDX_storage_array_slug"
          );
        });

      expect(found).toBeDefined();
      expect(found?.unique).toBe(true);
      expect(found?.columns).toEqual(["slug"]);
      expect(found?.where).toBe('"deletedAt" IS NULL');
    });

    test("indexes (projectId, isArchived) for the list and archived pages", () => {
      expect(
        findIndex(StorageArray, ["projectId", "isArchived"]),
      ).toBeDefined();
    });

    test("carries the standard resource columns and every snapshot column of the design", () => {
      const columns: Array<string> = new StorageArray().getTableColumns()
        .columns;

      for (const column of [
        "projectId",
        "name",
        "slug",
        "description",
        "otelCollectorStatus",
        "agentVersion",
        "lastSeenAt",
        "createdByUserId",
        "isArchived",
        "archivedAt",
        "archivedByUserId",
        "deletedByUserId",
        "labels",
        "retainTelemetryDataForDays",
        "telemetryRetentionConfig",
        ...ARRAY_SNAPSHOT_COLUMNS,
      ]) {
        expect(columns).toContain(column);
      }
    });

    test("has NO AI-agent columns: this product deliberately has no resource AI agent", () => {
      const columns: Array<string> = new StorageArray().getTableColumns()
        .columns;

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

      // Nor the Ceph-only columns the model was cloned next to.
      for (const column of [
        "fsid",
        "cephVersion",
        "monCount",
        "osdCount",
        "osdUpCount",
        "osdInCount",
        "poolCount",
      ]) {
        expect(columns).not.toContain(column);
      }
    });

    test("ingest-written columns cannot be set on create", () => {
      const model: StorageArray = new StorageArray();

      for (const column of [
        "otelCollectorStatus",
        "agentVersion",
        "lastSeenAt",
        "slug",
        "archivedAt",
        "archivedByUserId",
        ...ARRAY_SNAPSHOT_COLUMNS,
      ]) {
        expect({
          column,
          create: model.getColumnAccessControlFor(column)?.create,
        }).toEqual({ column, create: [] });
      }
    });

    test("every snapshot column is readable with ReadStorageArray", () => {
      const model: StorageArray = new StorageArray();
      for (const column of ARRAY_SNAPSHOT_COLUMNS) {
        expect(model.getColumnAccessControlFor(column)?.read).toContain(
          Permission.ReadStorageArray,
        );
      }
    });

    test("snapshot column types: text identity, bigint bytes, decimal percent and ratio, integer counts", () => {
      const model: StorageArray = new StorageArray();

      for (const column of [
        "storageSystem",
        "reportedName",
        "systemId",
        "osName",
        "osVersion",
      ]) {
        expect(model.getTableColumnMetadata(column).type).toBe(
          TableColumnType.ShortText,
        );
        expect(model.getTableColumnMetadata(column).required).toBeFalsy();
      }
      for (const column of ["capacityBytes", "usedBytes"]) {
        expect(model.getTableColumnMetadata(column).type).toBe(
          TableColumnType.BigPositiveNumber,
        );
        expect(columnArgs(StorageArray, column).options.type).toBe("bigint");
      }
      for (const column of ["capacityUsedPercent", "dataReductionRatio"]) {
        expect(model.getTableColumnMetadata(column).type).toBe(
          TableColumnType.Number,
        );
        expect(columnArgs(StorageArray, column).options.type).toBe("decimal");
      }
      for (const column of [...ARRAY_COUNTER_COLUMNS, "healthStatus"]) {
        expect(model.getTableColumnMetadata(column).type).toBe(
          TableColumnType.Number,
        );
        expect(columnArgs(StorageArray, column).options.type).toBe("integer");
      }
    });

    test("counter columns default to zero so a freshly discovered array never renders blank", () => {
      for (const column of ARRAY_COUNTER_COLUMNS) {
        const options: ColumnMetadataArgs["options"] = columnArgs(
          StorageArray,
          column,
        ).options;

        expect(options.nullable).toBe(true);
        expect(options.default).toBe(0);
      }
    });

    test("healthStatus has no default: null until the first array batch says OK, Warning or Critical", () => {
      const options: ColumnMetadataArgs["options"] = columnArgs(
        StorageArray,
        "healthStatus",
      ).options;
      expect(options.nullable).toBe(true);
      expect(options.default).toBeUndefined();
    });

    test("labels drive access control through the StorageArrayLabel join table", () => {
      expect(new StorageArray().accessControlColumn).toBe("labels");
      expect(joinTableArgs(StorageArray, "labels").name).toBe(
        "StorageArrayLabel",
      );
    });
  });

  describe("StorageArrayResource", () => {
    test("is write-locked: ingest writes as root, nobody else writes at all", () => {
      const model: StorageArrayResource = new StorageArrayResource();

      expect(model.getCreatePermissions()).toEqual([]);
      expect(model.getUpdatePermissions()).toEqual([]);
      expect(model.getDeletePermissions()).toEqual([]);
      expect(model.getReadPermissions()).toContain(Permission.ReadStorageArray);

      for (const column of model.getTableColumns().columns) {
        const accessControl: ReturnType<
          BaseModel["getColumnAccessControlFor"]
        > = model.getColumnAccessControlFor(column);

        if (!accessControl) {
          continue;
        }

        expect(accessControl.create).toEqual([]);
        expect(accessControl.update).toEqual([]);
      }
    });

    test("is unique on (projectId, storageArrayId, kind, externalId) — the upsert's ON CONFLICT target", () => {
      const found: IndexMetadataArgs | undefined =
        getMetadataArgsStorage().indices.find((index: IndexMetadataArgs) => {
          return (
            index.target === StorageArrayResource &&
            Array.isArray(index.columns) &&
            index.columns.length === 4
          );
        });

      expect(found).toBeDefined();
      expect(found?.unique).toBe(true);
      expect(found?.columns).toEqual([
        "projectId",
        "storageArrayId",
        "kind",
        "externalId",
      ]);
    });

    test("carries every column of the design's inventory schema", () => {
      const columns: Array<string> =
        new StorageArrayResource().getTableColumns().columns;

      for (const column of [
        "projectId",
        "storageArrayId",
        "kind",
        "externalId",
        "name",
        "status",
        "statusDetail",
        "componentType",
        "model",
        "firmwareVersion",
        "groupName",
        "capacityBytes",
        "usedBytes",
        "connectionCount",
        "details",
        "metricsUpdatedAt",
        "lastSeenAt",
        "createdByUserId",
        "deletedByUserId",
        ...RESOURCE_DECIMAL_COLUMNS,
      ]) {
        expect(columns).toContain(column);
      }

      // Ceph counter columns that have no storage array analogue.
      for (const column of [
        "readOpsCounter",
        "writeOpsCounter",
        "hostname",
        "deviceClass",
        "isUp",
        "isIn",
        "inQuorum",
      ]) {
        expect(columns).not.toContain(column);
      }
    });

    test("required columns are the identity and lastSeenAt; everything else is nullable", () => {
      const model: StorageArrayResource = new StorageArrayResource();

      for (const column of ["kind", "externalId", "lastSeenAt"]) {
        expect(model.getTableColumnMetadata(column).required).toBe(true);
        expect(columnArgs(StorageArrayResource, column).options.nullable).toBe(
          false,
        );
      }

      for (const column of [
        "name",
        "status",
        "statusDetail",
        "groupName",
        "capacityBytes",
        "connectionCount",
        "details",
        "metricsUpdatedAt",
        ...RESOURCE_DECIMAL_COLUMNS,
      ]) {
        expect(columnArgs(StorageArrayResource, column).options.nullable).toBe(
          true,
        );
      }
    });

    test("column types: names are LongText, states ShortText, bytes bigint, rates decimal, details JSON", () => {
      const model: StorageArrayResource = new StorageArrayResource();

      // Directory and pod-qualified volume names run long.
      for (const column of ["externalId", "name", "groupName"]) {
        expect(model.getTableColumnMetadata(column).type).toBe(
          TableColumnType.LongText,
        );
      }
      for (const column of [
        "kind",
        "status",
        "statusDetail",
        "componentType",
        "model",
        "firmwareVersion",
      ]) {
        expect(model.getTableColumnMetadata(column).type).toBe(
          TableColumnType.ShortText,
        );
      }
      for (const column of ["capacityBytes", "usedBytes"]) {
        expect(model.getTableColumnMetadata(column).type).toBe(
          TableColumnType.BigPositiveNumber,
        );
        expect(columnArgs(StorageArrayResource, column).options.type).toBe(
          "bigint",
        );
      }
      for (const column of RESOURCE_DECIMAL_COLUMNS) {
        expect(columnArgs(StorageArrayResource, column).options.type).toBe(
          "decimal",
        );
      }
      expect(
        columnArgs(StorageArrayResource, "connectionCount").options.type,
      ).toBe("integer");
      expect(model.getTableColumnMetadata("details").type).toBe(
        TableColumnType.JSON,
      );
    });
  });

  describe("column transformers", () => {
    const BIGINT_COLUMNS: Array<[ModelType, string]> = [
      [StorageArray, "capacityBytes"],
      [StorageArray, "usedBytes"],
      [StorageArrayResource, "capacityBytes"],
      [StorageArrayResource, "usedBytes"],
    ];

    const DECIMAL_COLUMNS: Array<[ModelType, string]> = [
      [StorageArray, "capacityUsedPercent"],
      [StorageArray, "dataReductionRatio"],
      ...RESOURCE_DECIMAL_COLUMNS.map((column: string): [ModelType, string] => {
        return [StorageArrayResource, column];
      }),
    ];

    test.each(BIGINT_COLUMNS)(
      "%p.%s round-trips through the bigint transformer",
      (modelType: ModelType, column: string) => {
        const transformer: ValueTransformer = transformerOf(modelType, column);

        /*
         * Postgres returns bigint as a string (values may exceed 2^53), so
         * the write side must serialize to a digit string and the read side
         * must parse it back — including a multi-PiB FlashBlade.
         */
        const fivePiB: number = 5 * 1024 ** 5;

        expect(transformer.to!(fivePiB)).toBe(fivePiB.toString());
        expect(transformer.from!(fivePiB.toString())).toBe(fivePiB);

        expect(transformer.to!(1234.9)).toBe("1234");
        expect(transformer.to!(0)).toBe("0");
        expect(transformer.to!(null)).toBeNull();
        expect(transformer.to!(undefined)).toBeNull();
        expect(transformer.from!(null)).toBeNull();
        expect(transformer.from!(undefined)).toBeNull();
        expect(transformer.from!("not-a-number")).toBeNull();
      },
    );

    test.each(DECIMAL_COLUMNS)(
      "%p.%s round-trips through the decimal transformer",
      (modelType: ModelType, column: string) => {
        const transformer: ValueTransformer = transformerOf(modelType, column);

        expect(transformer.to!(4.26)).toBe(4.26);
        expect(transformer.to!(0)).toBe(0);
        expect(transformer.to!(null)).toBeNull();
        expect(transformer.to!(undefined)).toBeNull();

        // Postgres returns numeric as a string.
        expect(transformer.from!("70.25")).toBe(70.25);
        expect(transformer.from!(99.9)).toBe(99.9);
        expect(transformer.from!(null)).toBeNull();
        expect(transformer.from!(undefined)).toBeNull();
        expect(transformer.from!("NaN")).toBeNull();
      },
    );

    test.each([...BIGINT_COLUMNS, ...DECIMAL_COLUMNS])(
      "%p.%s is nullable with no DEFAULT, so folding undefined to null is safe",
      (modelType: ModelType, column: string) => {
        /*
         * TypeORM runs the transformer before deciding whether the caller
         * supplied the column. On a NOT NULL DEFAULT column, answering null
         * for undefined would make the DEFAULT unreachable and 500 every
         * insert that omits the column (issue #3026).
         */
        const options: ColumnMetadataArgs["options"] = columnArgs(
          modelType,
          column,
        ).options;

        expect(options.nullable).toBe(true);
        expect(options.default).toBeUndefined();
      },
    );
  });

  describe("StorageArrayFeed", () => {
    test("event enum has exactly the ten contract members with value === key", () => {
      const entries: Array<[string, string]> = Object.entries(
        StorageArrayFeedEventType,
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
          "StorageArrayCreated",
          "StorageArrayUpdated",
          "StorageArrayArchived",
          "StorageArrayRestored",
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

    test("stores the event under storageArrayFeedEventType and reads through the array", () => {
      const model: StorageArrayFeed = new StorageArrayFeed();

      expect(model.getTableColumns().columns).toContain(
        "storageArrayFeedEventType",
      );
      expect(model.canAccessIfCanReadOn).toBe("storageArray");
      expect(model.getUpdatePermissions()).toEqual([]);
      expect(model.getDeletePermissions()).toEqual([]);
      expect(
        findIndex(StorageArrayFeed, ["storageArrayId", "postedAt"]),
      ).toBeDefined();
    });
  });

  describe("children of StorageArray", () => {
    test.each(ARRAY_CHILDREN)(
      "%p.%s cascades on array delete and carries the storageArrayId FK",
      (modelType: ModelType, property: string) => {
        /*
         * Deleting an array must take its inventory, feed and owners with it
         * — an orphaned StorageArrayResource row with a dangling FK is the
         * failure that surfaces as a 500 on the next ingest upsert.
         */
        const relation: RelationMetadataArgs = relationArgs(
          modelType,
          property,
        );

        expect(relation.relationType).toBe("many-to-one");
        expect(relation.options.onDelete).toBe("CASCADE");

        const model: BaseModel = new modelType();

        expect(model.getTableColumns().columns).toContain("storageArrayId");
        expect(
          model.getTableColumnMetadata(property).manyToOneRelationColumn,
        ).toBe("storageArrayId");
        expect(model.getTableColumnMetadata(property).modelType).toBe(
          StorageArray,
        );
        expect(model.getTableColumnMetadata("storageArrayId").required).toBe(
          true,
        );
      },
    );

    test("owner rows are unique per (array, owner, project) and start un-notified", () => {
      for (const [modelType, ownerColumn] of [
        [StorageArrayOwnerTeam, "teamId"],
        [StorageArrayOwnerUser, "userId"],
      ] as Array<[ModelType, string]>) {
        const model: BaseModel = new modelType();

        expect(model.getTableColumns().columns).toContain(ownerColumn);
        expect(model.getTableColumns().columns).toContain("isOwnerNotified");
        expect(
          model.getColumnAccessControlFor("isOwnerNotified")?.create,
        ).toEqual([]);
        expect(columnArgs(modelType, "isOwnerNotified").options.default).toBe(
          false,
        );

        const unique: IndexMetadataArgs | undefined = findIndex(modelType, [
          "storageArrayId",
          ownerColumn,
          "projectId",
        ]);
        expect(unique).toBeDefined();
        expect(unique?.unique).toBe(true);
      }
    });
  });

  describe("rule engines", () => {
    test("label rule matches on array name / description patterns and labels", () => {
      const columns: Array<string> =
        new StorageArrayLabelRule().getTableColumns().columns;

      for (const column of [
        "name",
        "isEnabled",
        "criteria",
        "storageArrayLabels",
        "storageArrayNamePattern",
        "storageArrayDescriptionPattern",
        "labelsToAdd",
      ]) {
        expect(columns).toContain(column);
      }

      expect(
        joinTableArgs(StorageArrayLabelRule, "storageArrayLabels").name,
      ).toBe("StorageArrayLabelRuleStorageArrayLabel");
      expect(joinTableArgs(StorageArrayLabelRule, "labelsToAdd").name).toBe(
        "StorageArrayLabelRuleLabelToAdd",
      );
    });

    test("owner rule matches on array name / description patterns and assigns users and teams", () => {
      const columns: Array<string> =
        new StorageArrayOwnerRule().getTableColumns().columns;

      for (const column of [
        "name",
        "isEnabled",
        "criteria",
        "notifyOwners",
        "storageArrayLabels",
        "storageArrayNamePattern",
        "storageArrayDescriptionPattern",
        "ownerUsers",
        "ownerTeams",
      ]) {
        expect(columns).toContain(column);
      }

      expect(
        joinTableArgs(StorageArrayOwnerRule, "storageArrayLabels").name,
      ).toBe("StorageArrayOwnerRuleStorageArrayLabel");
      expect(joinTableArgs(StorageArrayOwnerRule, "ownerUsers").name).toBe(
        "StorageArrayOwnerRuleOwnerUser",
      );
      expect(joinTableArgs(StorageArrayOwnerRule, "ownerTeams").name).toBe(
        "StorageArrayOwnerRuleOwnerTeam",
      );
    });

    test("every join table name fits Postgres's 63-character identifier limit", () => {
      const joinTables: Array<JoinTableMetadataArgs> = (
        getMetadataArgsStorage().joinTables as Array<JoinTableMetadataArgs>
      ).filter((joinTable: JoinTableMetadataArgs) => {
        return STORAGE_ARRAY_MODELS.some((spec: StorageArrayModelSpec) => {
          return spec.modelType === joinTable.target;
        });
      });

      expect(joinTables.length).toBeGreaterThan(0);

      for (const joinTable of joinTables) {
        expect(joinTable.name).toBeDefined();
        expect(joinTable.name!.length).toBeLessThan(63);
      }
    });
  });

  describe("permissions", () => {
    test("all 23 storage array permissions exist in the enum and the catalogue", () => {
      const enumValues: Set<string> = new Set(Object.values(Permission));

      for (const name of STORAGE_ARRAY_PERMISSIONS) {
        expect(enumValues.has(name)).toBe(true);
        expect(Permission[name as keyof typeof Permission]).toBe(name);

        const props: PermissionProps | undefined =
          PERMISSION_PROPS_BY_NAME.get(name);

        expect(props).toBeDefined();
        expect(props!.isAssignableToTenant).toBe(true);
        expect(props!.isRolePermission).toBe(false);
        expect(props!.group).toBe("Telemetry");
        expect(props!.title).toContain("Storage Array");
        expect(props!.description.length).toBeGreaterThan(0);
        expect(props!.title).not.toMatch(/Ceph|Proxmox|vCenter/);
        expect(props!.description).not.toMatch(/Ceph|Proxmox|vCenter/);
      }

      // No stray extra members — the catalogue must not sprout a 24th.
      const storageArrayEnumMembers: Array<string> = Array.from(
        enumValues,
      ).filter((value: string) => {
        return value.includes("StorageArray");
      });

      expect(storageArrayEnumMembers.sort()).toEqual(
        [...STORAGE_ARRAY_PERMISSIONS].sort(),
      );
    });

    test("array Delete/Edit/Read are label-scoped access-control permissions; everything else is not", () => {
      for (const name of STORAGE_ARRAY_PERMISSIONS) {
        const props: PermissionProps = PERMISSION_PROPS_BY_NAME.get(name)!;
        const labelScoped: boolean = [
          "DeleteStorageArray",
          "EditStorageArray",
          "ReadStorageArray",
        ].includes(name);

        expect({ name, scoped: props.isAccessControlPermission }).toEqual({
          name,
          scoped: labelScoped,
        });
      }
    });

    test.each(STORAGE_ARRAY_MODELS)(
      "$name references only real, catalogued permissions",
      (spec: StorageArrayModelSpec) => {
        const enumValues: Set<string> = new Set(Object.values(Permission));
        const model: BaseModel = new spec.modelType();

        for (const permission of allReferencedPermissions(model)) {
          const value: string = permission.toString();

          expect(enumValues.has(value)).toBe(true);
          expect(PERMISSION_PROPS_BY_NAME.has(value)).toBe(true);
        }
      },
    );
  });

  describe("affected-resource relations", () => {
    const AFFECTED: Array<[ModelType, string, string]> = [
      [Alert, "AlertStorageArray", "alertId"],
      [Incident, "IncidentStorageArray", "incidentId"],
      [
        ScheduledMaintenance,
        "ScheduledMaintenanceStorageArray",
        "scheduledMaintenanceId",
      ],
      [Monitor, "MonitorStorageArray", "monitorId"],
    ];

    test.each(AFFECTED)(
      "%p.storageArrays is a ManyToMany through %s",
      (modelType: ModelType, joinTableName: string, joinColumn: string) => {
        const model: BaseModel = new modelType();
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata("storageArrays");

        expect(metadata).toBeDefined();
        expect(metadata.type).toBe(TableColumnType.EntityArray);
        expect(metadata.modelType).toBe(StorageArray);
        expect(metadata.title).toBe("Storage Arrays");

        const relation: RelationMetadataArgs = relationArgs(
          modelType,
          "storageArrays",
        );

        expect(relation.relationType).toBe("many-to-many");

        const joinTable: JoinTableMetadataArgs = joinTableArgs(
          modelType,
          "storageArrays",
        );

        expect(joinTable.name).toBe(joinTableName);
        expect(joinTable.joinColumns?.[0]?.name).toBe(joinColumn);
        expect(joinTable.inverseJoinColumns?.[0]?.name).toBe("storageArrayId");

        // The initialiser matters: BaseModel enumerates own properties.
        expect(
          Object.prototype.hasOwnProperty.call(model, "storageArrays"),
        ).toBe(true);
      },
    );

    test.each(AFFECTED)(
      "%p.storageArrays shares the cephClusters access-control lists",
      (modelType: ModelType) => {
        const model: BaseModel = new modelType();

        expect(model.getColumnAccessControlFor("storageArrays")).toEqual(
          model.getColumnAccessControlFor("cephClusters"),
        );
      },
    );
  });
});
