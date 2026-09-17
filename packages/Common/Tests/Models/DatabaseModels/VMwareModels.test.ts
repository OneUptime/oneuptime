import AllModelTypes from "../../../Models/DatabaseModels/Index";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import VMwareResource from "../../../Models/DatabaseModels/VMwareResource";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import VMwareVCenterFeed, {
  VMwareVCenterFeedEventType,
} from "../../../Models/DatabaseModels/VMwareVCenterFeed";
import VMwareVCenterLabelRule from "../../../Models/DatabaseModels/VMwareVCenterLabelRule";
import VMwareVCenterOwnerRule from "../../../Models/DatabaseModels/VMwareVCenterOwnerRule";
import VMwareVCenterOwnerTeam from "../../../Models/DatabaseModels/VMwareVCenterOwnerTeam";
import VMwareVCenterOwnerUser from "../../../Models/DatabaseModels/VMwareVCenterOwnerUser";
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
import fs from "fs";
import path from "path";

/*
 * The VMware product is persisted as seven TypeORM entities cloned from the
 * Proxmox product. A clone is exactly the kind of change that passes review
 * while being wrong: a leftover `/proxmox-...` route silently shadows the
 * Proxmox API, a permission referenced by a model but missing from the
 * catalogue can never be granted, and a bigint column without its transformer
 * overflows the moment a datastore passes 2 GiB.
 *
 * Everything pinned here is a property that only fails in production:
 *
 *   - registration in Models/Index.ts (no table, no API otherwise)
 *   - the table / route / display names other layers key on
 *   - the unique indexes the ingest upsert paths rely on for race safety
 *   - the write-locked inventory table (ingest writes as root, nobody else)
 *   - the feed event enum contract the feed service and UI share
 *   - the bigint / decimal transformers on every byte and percent column
 *   - the affected-resource relations on Alert / Incident / ScheduledMaintenance
 *
 * Pure metadata — no Postgres connection anywhere.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

interface VMwareModelSpec {
  name: string;
  modelType: ModelType;
  tableName: string;
  crudApiPath: string;
  singularName: string;
  pluralName: string;
}

const VMWARE_MODELS: Array<VMwareModelSpec> = [
  {
    name: "VMwareVCenter",
    modelType: VMwareVCenter,
    tableName: "VMwareVCenter",
    crudApiPath: "/vmware-vcenter",
    singularName: "vCenter",
    pluralName: "vCenters",
  },
  {
    name: "VMwareResource",
    modelType: VMwareResource,
    tableName: "VMwareResource",
    crudApiPath: "/vmware-resource",
    singularName: "VMware Resource",
    pluralName: "VMware Resources",
  },
  {
    name: "VMwareVCenterFeed",
    modelType: VMwareVCenterFeed,
    tableName: "VMwareVCenterFeed",
    crudApiPath: "/vmware-vcenter-feed",
    singularName: "vCenter Feed",
    pluralName: "vCenter Feeds",
  },
  {
    name: "VMwareVCenterLabelRule",
    modelType: VMwareVCenterLabelRule,
    tableName: "VMwareVCenterLabelRule",
    crudApiPath: "/vmware-vcenter-label-rule",
    singularName: "vCenter Label Rule",
    pluralName: "vCenter Label Rules",
  },
  {
    name: "VMwareVCenterOwnerRule",
    modelType: VMwareVCenterOwnerRule,
    tableName: "VMwareVCenterOwnerRule",
    crudApiPath: "/vmware-vcenter-owner-rule",
    singularName: "vCenter Owner Rule",
    pluralName: "vCenter Owner Rules",
  },
  {
    name: "VMwareVCenterOwnerTeam",
    modelType: VMwareVCenterOwnerTeam,
    tableName: "VMwareVCenterOwnerTeam",
    crudApiPath: "/vmware-vcenter-owner-team",
    singularName: "vCenter Team Owner",
    pluralName: "vCenter Team Owners",
  },
  {
    name: "VMwareVCenterOwnerUser",
    modelType: VMwareVCenterOwnerUser,
    tableName: "VMwareVCenterOwnerUser",
    crudApiPath: "/vmware-vcenter-owner-user",
    singularName: "vCenter User Owner",
    pluralName: "vCenter User Owners",
  },
];

/** Every child of VMwareVCenter and the relation property it reaches it by. */
const VCENTER_CHILDREN: Array<[ModelType, string]> = [
  [VMwareResource, "vmwareVCenter"],
  [VMwareVCenterFeed, "vmwareVCenter"],
  [VMwareVCenterOwnerTeam, "vmwareVCenter"],
  [VMwareVCenterOwnerUser, "vmwareVCenter"],
];

const VMWARE_PERMISSIONS: Array<string> = [
  "CreateVMwareVCenter",
  "ReadVMwareVCenter",
  "EditVMwareVCenter",
  "DeleteVMwareVCenter",
  "CreateVMwareVCenterOwnerTeam",
  "ReadVMwareVCenterOwnerTeam",
  "EditVMwareVCenterOwnerTeam",
  "DeleteVMwareVCenterOwnerTeam",
  "CreateVMwareVCenterOwnerUser",
  "ReadVMwareVCenterOwnerUser",
  "EditVMwareVCenterOwnerUser",
  "DeleteVMwareVCenterOwnerUser",
  "CreateVMwareVCenterOwnerRule",
  "ReadVMwareVCenterOwnerRule",
  "EditVMwareVCenterOwnerRule",
  "DeleteVMwareVCenterOwnerRule",
  "CreateVMwareVCenterLabelRule",
  "ReadVMwareVCenterLabelRule",
  "EditVMwareVCenterLabelRule",
  "DeleteVMwareVCenterLabelRule",
  "CreateVMwareVCenterFeed",
  "EditVMwareVCenterFeed",
  "ReadVMwareVCenterFeed",
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

describe("VMware database models", () => {
  test("the inventory is not empty", () => {
    expect(VMWARE_MODELS.length).toBe(7);
  });

  describe("registration and identity", () => {
    test.each(VMWARE_MODELS)(
      "$name is registered in Models/Index.ts",
      (spec: VMwareModelSpec) => {
        /*
         * Boot-time createTables() and the migration generator both iterate
         * that array. A model missing from it type-checks, imports fine, and
         * simply has no table in Postgres.
         */
        expect(MODEL_TYPES).toContain(spec.modelType);
      },
    );

    test.each(VMWARE_MODELS)(
      "$name carries its own table, route and display names",
      (spec: VMwareModelSpec) => {
        const model: BaseModel = new spec.modelType();

        expect(model.tableName).toBe(spec.tableName);
        expect(model.getCrudApiPath()?.toString()).toBe(spec.crudApiPath);
        expect(model.singularName).toBe(spec.singularName);
        expect(model.pluralName).toBe(spec.pluralName);
        expect(model.getTenantColumn()).toBe("projectId");
      },
    );

    test("no VMware route or table name collides with another model", () => {
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

      for (const spec of VMWARE_MODELS) {
        expect(routes.get(spec.crudApiPath)).toBe(1);
        expect(tables.get(spec.tableName)).toBe(1);
      }
    });

    test.each(VMWARE_MODELS)(
      "$name source carries no Proxmox-only concepts",
      (spec: VMwareModelSpec) => {
        /*
         * The models were cloned from the Proxmox product. A leftover
         * `/proxmox-cluster` route or `pve_up` description is the kind of
         * thing that reads fine in review and misleads a customer later.
         */
        const source: string = modelSource(spec.name);

        for (const token of [
          "proxmox",
          "Proxmox",
          "pve",
          "PVE",
          "Ceph",
          "QEMU",
          "quorum",
          "replication",
          "haState",
          "isBackedUp",
        ]) {
          expect(source).not.toContain(token);
        }
      },
    );
  });

  describe("VMwareVCenter", () => {
    test("is unique per project on name, the vmware.vcenter.name join key", () => {
      /*
       * The @UniqueColumnBy decorator is app-level only. Concurrent agent
       * containers discovering the same vCenter race find-or-create at
       * ingest; only the DB-level unique index defuses that.
       */
      const found: IndexMetadataArgs | undefined =
        getMetadataArgsStorage().indices.find((index: IndexMetadataArgs) => {
          return (
            index.target === VMwareVCenter &&
            Array.isArray(index.columns) &&
            index.columns.length === 2 &&
            index.columns.includes("projectId") &&
            index.columns.includes("name")
          );
        });

      expect(found).toBeDefined();
      expect(found?.unique).toBe(true);

      expect(new VMwareVCenter().getTableColumnMetadata("name").example).toBe(
        "vcenter-prod",
      );
    });

    test("declares IDX_vmware_vcenter_slug by name, UNIQUE and partial", () => {
      /*
       * TypeORM's schema builder matches database indexes to entity
       * metadata by name and drops every one it cannot find. Declaring the
       * slug index natively (name, uniqueness, partial predicate) lets the
       * migration generator emit it and the drift check police it.
       */
      const found: IndexMetadataArgs | undefined =
        getMetadataArgsStorage().indices.find((index: IndexMetadataArgs) => {
          return (
            index.target === VMwareVCenter &&
            index.name === "IDX_vmware_vcenter_slug"
          );
        });

      expect(found).toBeDefined();
      expect(found?.unique).toBe(true);
      expect(found?.columns).toEqual(["slug"]);
      expect(found?.where).toBe('"deletedAt" IS NULL');
    });

    test("indexes (projectId, isArchived) for the list and archived pages", () => {
      const found: IndexMetadataArgs | undefined =
        getMetadataArgsStorage().indices.find((index: IndexMetadataArgs) => {
          return (
            index.target === VMwareVCenter &&
            Array.isArray(index.columns) &&
            index.columns.length === 2 &&
            index.columns.includes("projectId") &&
            index.columns.includes("isArchived")
          );
        });

      expect(found).toBeDefined();
    });

    test("carries the snapshot counters and storage totals the ingest scan writes", () => {
      const model: VMwareVCenter = new VMwareVCenter();
      const columns: Array<string> = model.getTableColumns().columns;

      for (const column of [
        "name",
        "slug",
        "description",
        "otelCollectorStatus",
        "agentVersion",
        "lastSeenAt",
        "datacenterCount",
        "clusterCount",
        "hostCount",
        "vmCount",
        "poweredOnVmCount",
        "datastoreCount",
        "resourcePoolCount",
        "datastoreCapacityBytes",
        "datastoreUsedBytes",
        "isArchived",
        "archivedAt",
        "archivedByUserId",
        "labels",
        "retainTelemetryDataForDays",
        "telemetryRetentionConfig",
      ]) {
        expect(columns).toContain(column);
      }

      // Proxmox-only columns the spec explicitly forbids.
      for (const column of [
        "pveVersion",
        "vcenterVersion",
        "cephClusterId",
        "nodeCount",
        "guestCount",
        "storageCount",
        "guestsWithoutBackupCount",
      ]) {
        expect(columns).not.toContain(column);
      }

      expect(model.getTableColumnMetadata("agentVersion").title).toBe(
        "Agent Version",
      );
      expect(model.getTableColumnMetadata("datastoreCapacityBytes").type).toBe(
        TableColumnType.BigPositiveNumber,
      );
      expect(model.getTableColumnMetadata("datastoreUsedBytes").type).toBe(
        TableColumnType.BigPositiveNumber,
      );
    });

    test("ingest-written columns cannot be set on create", () => {
      const model: VMwareVCenter = new VMwareVCenter();

      for (const column of [
        "otelCollectorStatus",
        "agentVersion",
        "lastSeenAt",
        "datacenterCount",
        "clusterCount",
        "hostCount",
        "vmCount",
        "poweredOnVmCount",
        "datastoreCount",
        "resourcePoolCount",
        "datastoreCapacityBytes",
        "datastoreUsedBytes",
        "slug",
        "archivedAt",
        "archivedByUserId",
      ]) {
        expect(model.getColumnAccessControlFor(column)?.create).toEqual([]);
      }
    });

    test("labels drive access control through the VMwareVCenterLabel join table", () => {
      expect(new VMwareVCenter().accessControlColumn).toBe("labels");
      expect(joinTableArgs(VMwareVCenter, "labels").name).toBe(
        "VMwareVCenterLabel",
      );
    });

    test("counter columns default to zero so a freshly discovered vCenter never renders blank", () => {
      for (const column of [
        "datacenterCount",
        "clusterCount",
        "hostCount",
        "vmCount",
        "poweredOnVmCount",
        "datastoreCount",
        "resourcePoolCount",
      ]) {
        const options: ColumnMetadataArgs["options"] = columnArgs(
          VMwareVCenter,
          column,
        ).options;

        expect(options.nullable).toBe(true);
        expect(options.default).toBe(0);
      }
    });
  });

  describe("VMwareResource", () => {
    test("is write-locked: ingest writes as root, nobody else writes at all", () => {
      const model: VMwareResource = new VMwareResource();

      expect(model.getCreatePermissions()).toEqual([]);
      expect(model.getUpdatePermissions()).toEqual([]);
      expect(model.getDeletePermissions()).toEqual([]);
      expect(model.getReadPermissions()).toContain(
        Permission.ReadVMwareVCenter,
      );

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

    test("is unique on (projectId, vmwareVCenterId, kind, externalId)", () => {
      /*
       * The identity index the bulk upsert's ON CONFLICT clause targets. Two
       * VMs with the same name on different hosts share neither kind nor
       * externalId, so this is the only thing standing between a scrape and
       * duplicate rows.
       */
      const found: IndexMetadataArgs | undefined =
        getMetadataArgsStorage().indices.find((index: IndexMetadataArgs) => {
          return (
            index.target === VMwareResource &&
            Array.isArray(index.columns) &&
            index.columns.length === 4
          );
        });

      expect(found).toBeDefined();
      expect(found?.unique).toBe(true);
      expect(found?.columns).toEqual([
        "projectId",
        "vmwareVCenterId",
        "kind",
        "externalId",
      ]);
    });

    test("carries every column of the spec's inventory schema", () => {
      const model: VMwareResource = new VMwareResource();
      const columns: Array<string> = model.getTableColumns().columns;

      for (const column of [
        "projectId",
        "vmwareVCenterId",
        "kind",
        "externalId",
        "name",
        "datacenterName",
        "clusterName",
        "hostName",
        "resourcePoolName",
        "resourcePoolPath",
        "virtualAppName",
        "vmInstanceUuid",
        "isTemplate",
        "isPoweredOn",
        "latestCpuPercent",
        "latestCpuMhz",
        "cpuCapacityMhz",
        "cpuEffectiveMhz",
        "latestMemoryBytes",
        "maxMemoryBytes",
        "memoryEffectiveBytes",
        "latestMemoryPercent",
        "latestDiskBytes",
        "maxDiskBytes",
        "latestDiskPercent",
        "cpuReadinessPercent",
        "memoryBalloonedBytes",
        "memorySwappedBytes",
        "hostCount",
        "effectiveHostCount",
        "poweredOnHostCount",
        "vmCount",
        "poweredOnVmCount",
        "vmTemplateCount",
        "datastoreCount",
        "clusterCount",
        "metricsUpdatedAt",
        "lastSeenAt",
        "createdByUserId",
        "deletedByUserId",
      ]) {
        expect(columns).toContain(column);
      }

      // pve-exporter columns that have no vSphere analogue.
      for (const column of [
        "vmid",
        "guestType",
        "parentNodeName",
        "isUp",
        "haState",
        "onboot",
        "isBackedUp",
        "uptimeSeconds",
      ]) {
        expect(columns).not.toContain(column);
      }
    });

    test("required columns are kind, externalId and lastSeenAt; everything else is nullable", () => {
      const model: VMwareResource = new VMwareResource();

      for (const column of ["kind", "externalId", "lastSeenAt"]) {
        expect(model.getTableColumnMetadata(column).required).toBe(true);
        expect(columnArgs(VMwareResource, column).options.nullable).toBe(false);
      }

      for (const column of [
        "name",
        "isPoweredOn",
        "latestCpuPercent",
        "latestMemoryBytes",
        "hostCount",
        "metricsUpdatedAt",
      ]) {
        expect(columnArgs(VMwareResource, column).options.nullable).toBe(true);
      }

      // Inventory paths regularly exceed 100 characters.
      expect(model.getTableColumnMetadata("resourcePoolPath").type).toBe(
        TableColumnType.LongText,
      );
    });

    test("byte columns are bigint and percent columns are decimal", () => {
      const model: VMwareResource = new VMwareResource();

      for (const column of [
        "latestMemoryBytes",
        "maxMemoryBytes",
        "memoryEffectiveBytes",
        "latestDiskBytes",
        "maxDiskBytes",
        "memoryBalloonedBytes",
        "memorySwappedBytes",
      ]) {
        expect(model.getTableColumnMetadata(column).type).toBe(
          TableColumnType.BigPositiveNumber,
        );
        expect(columnArgs(VMwareResource, column).options.type).toBe("bigint");
      }

      for (const column of [
        "latestCpuPercent",
        "latestMemoryPercent",
        "latestDiskPercent",
        "cpuReadinessPercent",
      ]) {
        expect(model.getTableColumnMetadata(column).type).toBe(
          TableColumnType.Number,
        );
        expect(columnArgs(VMwareResource, column).options.type).toBe("decimal");
      }

      for (const column of [
        "latestCpuMhz",
        "cpuCapacityMhz",
        "cpuEffectiveMhz",
        "hostCount",
        "effectiveHostCount",
        "poweredOnHostCount",
        "vmCount",
        "poweredOnVmCount",
        "vmTemplateCount",
        "datastoreCount",
        "clusterCount",
      ]) {
        expect(model.getTableColumnMetadata(column).type).toBe(
          TableColumnType.Number,
        );
        expect(columnArgs(VMwareResource, column).options.type).toBe("integer");
      }
    });
  });

  describe("column transformers", () => {
    const BIGINT_COLUMNS: Array<[ModelType, string]> = [
      [VMwareVCenter, "datastoreCapacityBytes"],
      [VMwareVCenter, "datastoreUsedBytes"],
      [VMwareResource, "latestMemoryBytes"],
      [VMwareResource, "maxMemoryBytes"],
      [VMwareResource, "memoryEffectiveBytes"],
      [VMwareResource, "latestDiskBytes"],
      [VMwareResource, "maxDiskBytes"],
      [VMwareResource, "memoryBalloonedBytes"],
      [VMwareResource, "memorySwappedBytes"],
    ];

    const DECIMAL_COLUMNS: Array<[ModelType, string]> = [
      [VMwareResource, "latestCpuPercent"],
      [VMwareResource, "latestMemoryPercent"],
      [VMwareResource, "latestDiskPercent"],
      [VMwareResource, "cpuReadinessPercent"],
    ];

    test.each(BIGINT_COLUMNS)(
      "%p.%s round-trips through the bigint transformer",
      (modelType: ModelType, column: string) => {
        const transformer: ValueTransformer = transformerOf(modelType, column);

        /*
         * Postgres returns bigint as a string (values may exceed 2^53), so
         * the write side must serialize to a digit string and the read side
         * must parse it back — including a 4 TiB datastore.
         */
        const fourTiB: number = 4 * 1024 * 1024 * 1024 * 1024;

        expect(transformer.to!(fourTiB)).toBe(fourTiB.toString());
        expect(transformer.from!(fourTiB.toString())).toBe(fourTiB);

        // Fractional MiB-to-bytes conversions must never reach Postgres.
        expect(transformer.to!(1234.9)).toBe("1234");
        expect(transformer.to!(0)).toBe("0");
        expect(transformer.to!(1)).toBe("1");

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

        expect(transformer.to!(12.345)).toBe(12.345);
        expect(transformer.to!(0)).toBe(0);
        expect(transformer.to!(1)).toBe(1);
        expect(transformer.to!(null)).toBeNull();
        expect(transformer.to!(undefined)).toBeNull();

        // Postgres returns numeric as a string.
        expect(transformer.from!("12.345")).toBe(12.345);
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
         * insert that omits the column (issue #3026). These transformers do
         * fold undefined to null, so the columns MUST stay nullable without
         * a default.
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

  describe("VMwareVCenterFeed", () => {
    test("event enum has exactly the ten contract members with value === key", () => {
      const entries: Array<[string, string]> = Object.entries(
        VMwareVCenterFeedEventType,
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
          "VMwareVCenterCreated",
          "VMwareVCenterUpdated",
          "VMwareVCenterArchived",
          "VMwareVCenterRestored",
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

    test("stores the event under vmwareVCenterFeedEventType and reads through the vCenter", () => {
      const model: VMwareVCenterFeed = new VMwareVCenterFeed();

      expect(model.getTableColumns().columns).toContain(
        "vmwareVCenterFeedEventType",
      );
      expect(model.canAccessIfCanReadOn).toBe("vmwareVCenter");
      expect(model.getUpdatePermissions()).toEqual([]);
      expect(model.getDeletePermissions()).toEqual([]);

      const found: IndexMetadataArgs | undefined =
        getMetadataArgsStorage().indices.find((index: IndexMetadataArgs) => {
          return (
            index.target === VMwareVCenterFeed &&
            Array.isArray(index.columns) &&
            index.columns.includes("vmwareVCenterId") &&
            index.columns.includes("postedAt")
          );
        });

      expect(found).toBeDefined();
    });
  });

  describe("children of VMwareVCenter", () => {
    test.each(VCENTER_CHILDREN)(
      "%p.%s cascades on vCenter delete and carries the vmwareVCenterId FK",
      (modelType: ModelType, property: string) => {
        /*
         * Deleting a vCenter must take its inventory, feed and owners with
         * it — an orphaned VMwareResource row with a dangling FK is the
         * failure that surfaces as a 500 on the next ingest upsert.
         */
        const relation: RelationMetadataArgs = relationArgs(
          modelType,
          property,
        );

        expect(relation.relationType).toBe("many-to-one");
        expect(relation.options.onDelete).toBe("CASCADE");

        const model: BaseModel = new modelType();

        expect(model.getTableColumns().columns).toContain("vmwareVCenterId");
        expect(
          model.getTableColumnMetadata(property).manyToOneRelationColumn,
        ).toBe("vmwareVCenterId");
        expect(model.getTableColumnMetadata(property).modelType).toBe(
          VMwareVCenter,
        );
        expect(model.getTableColumnMetadata("vmwareVCenterId").required).toBe(
          true,
        );
      },
    );

    test("owner rows index the columns the notification worker scans", () => {
      for (const modelType of [
        VMwareVCenterOwnerTeam,
        VMwareVCenterOwnerUser,
      ]) {
        const model: BaseModel = new modelType();

        expect(model.getTableColumns().columns).toContain("isOwnerNotified");
        expect(
          model.getColumnAccessControlFor("isOwnerNotified")?.create,
        ).toEqual([]);
        expect(columnArgs(modelType, "isOwnerNotified").options.default).toBe(
          false,
        );
      }

      expect(new VMwareVCenterOwnerTeam().getTableColumns().columns).toContain(
        "teamId",
      );
      expect(new VMwareVCenterOwnerUser().getTableColumns().columns).toContain(
        "userId",
      );
    });
  });

  describe("rule engines", () => {
    test("label rule matches on vCenter name / description patterns and labels", () => {
      const model: VMwareVCenterLabelRule = new VMwareVCenterLabelRule();
      const columns: Array<string> = model.getTableColumns().columns;

      for (const column of [
        "name",
        "isEnabled",
        "vmwareVCenterLabels",
        "vmwareVCenterNamePattern",
        "vmwareVCenterDescriptionPattern",
        "labelsToAdd",
      ]) {
        expect(columns).toContain(column);
      }

      expect(
        joinTableArgs(VMwareVCenterLabelRule, "vmwareVCenterLabels").name,
      ).toBe("VMwareVCenterLabelRuleVMwareVCenterLabel");
      expect(joinTableArgs(VMwareVCenterLabelRule, "labelsToAdd").name).toBe(
        "VMwareVCenterLabelRuleLabelToAdd",
      );
    });

    test("owner rule matches on vCenter name / description patterns and assigns users and teams", () => {
      const model: VMwareVCenterOwnerRule = new VMwareVCenterOwnerRule();
      const columns: Array<string> = model.getTableColumns().columns;

      for (const column of [
        "name",
        "isEnabled",
        "notifyOwners",
        "vmwareVCenterLabels",
        "vmwareVCenterNamePattern",
        "vmwareVCenterDescriptionPattern",
        "ownerUsers",
        "ownerTeams",
      ]) {
        expect(columns).toContain(column);
      }

      expect(
        joinTableArgs(VMwareVCenterOwnerRule, "vmwareVCenterLabels").name,
      ).toBe("VMwareVCenterOwnerRuleVMwareVCenterLabel");
      expect(joinTableArgs(VMwareVCenterOwnerRule, "ownerUsers").name).toBe(
        "VMwareVCenterOwnerRuleOwnerUser",
      );
      expect(joinTableArgs(VMwareVCenterOwnerRule, "ownerTeams").name).toBe(
        "VMwareVCenterOwnerRuleOwnerTeam",
      );
    });

    test("every join table name fits Postgres's 63-character identifier limit", () => {
      const joinTables: Array<JoinTableMetadataArgs> = (
        getMetadataArgsStorage().joinTables as Array<JoinTableMetadataArgs>
      ).filter((joinTable: JoinTableMetadataArgs) => {
        return VMWARE_MODELS.some((spec: VMwareModelSpec) => {
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
    test("all 23 VMware permissions exist in the enum and the catalogue", () => {
      const enumValues: Set<string> = new Set(Object.values(Permission));

      for (const name of VMWARE_PERMISSIONS) {
        expect(enumValues.has(name)).toBe(true);
        expect(Permission[name as keyof typeof Permission]).toBe(name);

        const props: PermissionProps | undefined =
          PERMISSION_PROPS_BY_NAME.get(name);

        expect(props).toBeDefined();
        expect(props!.isAssignableToTenant).toBe(true);
        expect(props!.isRolePermission).toBe(false);
        expect(props!.group).toBe("Telemetry");
        expect(props!.title.length).toBeGreaterThan(0);
        expect(props!.description.length).toBeGreaterThan(0);

        // Titles are vSphere wording, not the Proxmox family's.
        expect(props!.title).toContain("vCenter");
        expect(props!.title).not.toContain("Proxmox");
        expect(props!.description).not.toContain("Proxmox");
      }

      // No stray extra members — the catalogue must not sprout a 24th.
      const vmwareEnumMembers: Array<string> = Array.from(enumValues).filter(
        (value: string) => {
          return value.includes("VMware");
        },
      );

      expect(vmwareEnumMembers.sort()).toEqual([...VMWARE_PERMISSIONS].sort());
    });

    test("vCenter Delete/Edit/Read are label-scoped access-control permissions; everything else is not", () => {
      for (const name of VMWARE_PERMISSIONS) {
        const props: PermissionProps = PERMISSION_PROPS_BY_NAME.get(name)!;
        const labelScoped: boolean = [
          "DeleteVMwareVCenter",
          "EditVMwareVCenter",
          "ReadVMwareVCenter",
        ].includes(name);

        expect(props.isAccessControlPermission).toBe(labelScoped);
      }
    });

    test.each(VMWARE_MODELS)(
      "$name references only real, catalogued permissions",
      (spec: VMwareModelSpec) => {
        const enumValues: Set<string> = new Set(Object.values(Permission));
        const model: BaseModel = new spec.modelType();

        for (const permission of allReferencedPermissions(model)) {
          const value: string = permission.toString();

          expect(enumValues.has(value)).toBe(true);
          expect(PERMISSION_PROPS_BY_NAME.has(value)).toBe(true);
        }
      },
    );

    test.each(VMWARE_MODELS)(
      "$name gates on VMware permissions, never on Proxmox ones",
      (spec: VMwareModelSpec) => {
        const model: BaseModel = new spec.modelType();

        for (const permission of allReferencedPermissions(model)) {
          expect(permission.toString()).not.toContain("Proxmox");
        }
      },
    );
  });

  describe("affected-resource relations", () => {
    const AFFECTED: Array<[ModelType, string, string]> = [
      [Alert, "AlertVMwareVCenter", "alertId"],
      [Incident, "IncidentVMwareVCenter", "incidentId"],
      [
        ScheduledMaintenance,
        "ScheduledMaintenanceVMwareVCenter",
        "scheduledMaintenanceId",
      ],
    ];

    test.each(AFFECTED)(
      "%p.vmwareVCenters is a ManyToMany through %s",
      (modelType: ModelType, joinTableName: string, joinColumn: string) => {
        const model: BaseModel = new modelType();
        const metadata: TableColumnMetadata =
          model.getTableColumnMetadata("vmwareVCenters");

        expect(metadata).toBeDefined();
        expect(metadata.type).toBe(TableColumnType.EntityArray);
        expect(metadata.modelType).toBe(VMwareVCenter);
        expect(metadata.title).toBe("vCenters");

        const relation: RelationMetadataArgs = relationArgs(
          modelType,
          "vmwareVCenters",
        );

        expect(relation.relationType).toBe("many-to-many");

        const joinTable: JoinTableMetadataArgs = joinTableArgs(
          modelType,
          "vmwareVCenters",
        );

        expect(joinTable.name).toBe(joinTableName);
        expect(joinTable.joinColumns?.[0]?.name).toBe(joinColumn);
        expect(joinTable.inverseJoinColumns?.[0]?.name).toBe("vmwareVCenterId");

        // The initialiser matters: BaseModel enumerates own properties.
        expect(
          Object.prototype.hasOwnProperty.call(model, "vmwareVCenters"),
        ).toBe(true);
      },
    );

    test.each(AFFECTED)(
      "%p.vmwareVCenters shares the proxmoxClusters access-control lists",
      (modelType: ModelType) => {
        const model: BaseModel = new modelType();

        expect(model.getColumnAccessControlFor("vmwareVCenters")).toEqual(
          model.getColumnAccessControlFor("proxmoxClusters"),
        );
      },
    );
  });
});
