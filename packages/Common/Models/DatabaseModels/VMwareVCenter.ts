import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnBillingAccessControl from "../../Types/Database/AccessControl/ColumnBillingAccessControl";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import Label from "./Label";
import Probe from "./Probe";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import AccessControlColumn from "../../Types/Database/AccessControlColumn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { ResourceAiRemediationMode } from "../../Types/ResourceAiAgent/ResourceAiAccess";
import TelemetryRetentionConfig from "../../Types/Telemetry/TelemetryRetentionConfig";
import VMwareCollectionErrorCode from "../../Types/VMware/VMwareCollectionError";
import VMwareCollectionMethod from "../../Types/VMware/VMwareCollectionMethod";
import VMwareCollectionStatus from "../../Types/VMware/VMwareCollectionStatus";
import {
  VMwareCollectionSummary,
  VMwarePresentedCertificate,
} from "../../Types/VMware/VMwareProbeCollection";
import { DEFAULT_VMWARE_COLLECTION_INTERVAL_IN_MINUTES } from "../../Utils/VMware/VMwareCollectionSettings";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

/*
 * Who reads, creates and edits a vCenter - the lists of the table below,
 * named for the probe collection columns, which hold to them too.
 */
const VCENTER_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadVMwareVCenter,
];

const VCENTER_CREATORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateVMwareVCenter,
];

const VCENTER_EDITORS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditVMwareVCenter,
];

/*
 * The columns ingest and the probe rewrite on their own, every collection.
 * The audit log records what people change; recording these would bury it.
 */
export const VMWARE_VCENTER_BOOKKEEPING_COLUMNS: Array<string> = [
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
  "aiAccessLastVerifiedAt",
  "aiAccessLastError",
  "collectionStatus",
  "collectionErrorCode",
  "collectionError",
  "presentedCertificate",
  "collectionSummary",
  "nextCollectionAt",
  "lastCollectionAt",
  "lastSuccessfulCollectionAt",
  "collectionSettingsVersion",
];

@EnableAuditLog({
  create: true,
  update: true,
  delete: true,
  ignoreColumns: VMWARE_VCENTER_BOOKKEEPING_COLUMNS,
})
@AccessControlColumn("labels")
@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.CreateVMwareVCenter,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.SettingsViewer,
    Permission.ReadVMwareVCenter,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.DeleteVMwareVCenter,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.EditVMwareVCenter,
  ],
})
@CrudApiEndpoint(new Route("/vmware-vcenter"))
@SlugifyColumn("name", "slug")
/*
 * DB-level unique index on (projectId, name) — the @UniqueColumnBy decorator
 * on `name` is app-level only and does not defuse the concurrent
 * find-or-create race at ingest (multiple agent containers discovering the
 * same vCenter simultaneously). Mirrors KubernetesCluster's
 * (projectId, clusterIdentifier) unique index.
 */
@Index(["projectId", "name"], { unique: true })
@Index(["projectId", "isArchived"])
/*
 * The probe's claim: "the vCenters I collect whose next collection is due".
 * Only probe-collected vCenters name a probe, so this stays small.
 */
@Index(["collectionProbeId", "nextCollectionAt"])
/*
 * Partial UNIQUE slug index, declared natively and NAMED.
 *
 * TypeORM's schema builder matches database indexes to entity metadata by
 * name and drops every one it cannot find — older infra products lost their
 * slug index to an autogenerated migration that way (it existed only in a
 * migration, so entity metadata never mentioned it). Declaring it here lets
 * the generator emit it, and lets the builder match, compare uniqueness and
 * columns, and keep it.
 */
@Index("IDX_vmware_vcenter_slug", ["slug"], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@TableMetadata({
  tableName: "VMwareVCenter",
  singularName: "vCenter",
  pluralName: "vCenters",
  icon: IconProp.VMware,
  tableDescription:
    "vSphere endpoints (a vCenter Server, or a standalone ESXi host) that are being monitored in this project. A vCenter is collected by one of your OneUptime probes with a read-only account saved on it (no agent to run), or auto-discovered when the OneUptime VMware Agent sends its metrics.",
})
@Entity({
  name: "VMwareVCenter",
})
export default class VMwareVCenter extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateVMwareVCenter,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateVMwareVCenter,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of your OneUptime Project in which this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateVMwareVCenter,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditVMwareVCenter,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "Name of this vCenter (a vCenter Server, or a standalone ESXi host). This is the join key — it must match the vmware.vcenter.name OTel resource attribute stamped by the OneUptime VMware Agent (VMWARE_VCENTER_NAME).",
    example: "vcenter-prod",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    unique: true,
    type: TableColumnType.Slug,
    computed: true,
    title: "Slug",
    description: "Friendly globally unique name for your object",
  })
  @Column({
    nullable: false,
    type: ColumnType.Slug,
    length: ColumnLength.Slug,
  })
  public slug?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateVMwareVCenter,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Description",
    description: "Friendly description for this vCenter",
    example: "Production vCenter Server for the US East datacenter",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "OTel Collector Status",
    description:
      "Connection status of the OTel Collector agent (connected or disconnected)",
    example: "connected",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: "disconnected",
  })
  public otelCollectorStatus?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Agent Version",
    description:
      "Version of the OneUptime VMware Agent reporting telemetry, as self-reported via the oneuptime.agent.version resource attribute",
    example: "1.0.0",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public agentVersion?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Last Seen At",
    description: "When metrics were last received from this vCenter",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public lastSeenAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Datacenter Count",
    description:
      "Cached count of vSphere datacenters reported through this vCenter. Written by the ingest snapshot scan; only updated when a batch carries datacenter metrics.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public datacenterCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Cluster Count",
    description:
      "Cached count of vSphere clusters reported through this vCenter. Written by the ingest snapshot scan; only updated when a batch carries cluster metrics.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public clusterCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Host Count",
    description:
      "Cached count of ESXi hosts reported through this vCenter. Written by the ingest snapshot scan; only updated when a batch carries host metrics.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public hostCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "VM Count",
    description:
      "Cached count of virtual machines (excluding VM templates) reported through this vCenter. Written by the ingest snapshot scan; only updated when a batch carries virtual machine metrics.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public vmCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Powered On VM Count",
    description:
      "Cached count of virtual machines inferred to be powered on (the vcenter receiver emits CPU metrics only for powered-on VMs). Rendered as 'VMs X/Y powered on' next to vmCount.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public poweredOnVmCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Datastore Count",
    description:
      "Cached count of datastores reported through this vCenter. Written by the ingest snapshot scan; only updated when a batch carries datastore metrics.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public datastoreCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Resource Pool Count",
    description:
      "Cached count of resource pools reported through this vCenter. Written by the ingest snapshot scan; only updated when a batch carries resource pool metrics.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    default: 0,
  })
  public resourcePoolCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    type: TableColumnType.BigPositiveNumber,
    title: "Datastore Capacity Bytes",
    description:
      "Cached total capacity in bytes summed over every datastore reported through this vCenter (used + available vcenter.datastore.disk.usage). The denominator for the storage-used bar on the overview page. Stored as bigint.",
  })
  @Column({
    type: ColumnType.BigPositiveNumber,
    nullable: true,
    transformer: {
      to: (value: number | null | undefined): string | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return Math.trunc(value).toString();
      },
      from: (value: string | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        const parsed: number = parseInt(value, 10);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public datastoreCapacityBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    type: TableColumnType.BigPositiveNumber,
    title: "Datastore Used Bytes",
    description:
      "Cached used space in bytes summed over every datastore reported through this vCenter (vcenter.datastore.disk.usage{disk_state=used}). Stored as bigint.",
  })
  @Column({
    type: ColumnType.BigPositiveNumber,
    nullable: true,
    transformer: {
      to: (value: number | null | undefined): string | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return Math.trunc(value).toString();
      },
      from: (value: string | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        const parsed: number = parseInt(value, 10);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public datastoreUsedBytes?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateVMwareVCenter,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateVMwareVCenter,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateVMwareVCenter,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Archived",
    description:
      "Is this vCenter archived? Archived vCenters are hidden from lists but keep collecting telemetry.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isArchived?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Archived At",
    description: "When was this vCenter archived?",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public archivedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "archivedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Archived by User",
    description:
      "Relation to User who archived this object (if this object was archived by a User)",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "archivedByUserId" })
  public archivedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Archived by User ID",
    description:
      "User ID who archived this object (if this object was archived by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public archivedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
    modelType: User,
    description:
      "Relation to User who deleted this object (if this object was deleted by a User)",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      cascade: false,
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateVMwareVCenter,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description:
      "Relation to Labels Array where this object is categorized in.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "VMwareVCenterLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "vmwareVCenterId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateVMwareVCenter,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Retain Telemetry Data For Days",
    description:
      "Number of days to retain telemetry data for this vCenter. Leave blank to use the project-wide default.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
    unique: false,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Scale,
    create: PlanType.Scale,
  })
  public retainTelemetryDataForDays?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateVMwareVCenter,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Telemetry Data Retention Overrides",
    description:
      "Per-pillar retention overrides for this vCenter (logs by severity, traces by status, metrics, profiles). Unset fields fall back to the vCenter default, then the project's retention settings.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  @ColumnBillingAccessControl({
    read: PlanType.Free,
    update: PlanType.Scale,
    create: PlanType.Scale,
  })
  public telemetryRetentionConfig?: TelemetryRetentionConfig = undefined;

  /*
   * OneUptime AI access to this vCenter through its VMware AI agent (a resource AI
   * agent, ResourceAiAgent). The settings are plain columns written through
   * ordinary CRUD, so they exist before any agent registers. The columns
   * keep the vCenter's own update ACL: anyone who may edit the vCenter may make
   * AI do LESS; making it do MORE is refused by the service unless the
   * caller may author a FullAuto auto-remediation rule. The aiAccess*
   * columns are written only by the server.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Let AI Investigate With Read-Only Commands",
    description:
      "When on, OneUptime AI runs read-only commands (govc about, ls, vm.info, host.info, events) on this vCenter, through its VMware AI agent, while investigating incidents and alerts linked to it, and uses their output, with secret values redacted, as evidence. Nothing is ever changed by an investigation. On by default. Anyone who may edit the vCenter can turn it on or off.",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isAiInvestigationEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.ShortText,
    title: "AI Remediation Mode",
    /*
     * The API and Terraform docs for the mode: the same semantics as the
     * ResourceAiRemediationMode doc comment in
     * Types/ResourceAiAgent/ResourceAiAccess.ts (the canonical text).
     */
    description:
      "Disabled: AI never proposes or runs a change on this vCenter. RequireApproval: AI composes a command plan and a human approves it with one click before anything runs. Automatic: safe changes (SafeWrite) run without a human; a riskier change is proposed for approval unless the vCenter's allowlist names its exact shape. BypassApproval: every change the policy allows — safe AND riskier — runs on its own, except what always needs a human. In EVERY mode: Denied commands never run, commands the policy marks requiresHuman always ask, and the agent itself refuses every write unless it was started with ONEUPTIME_AI_ALLOW_WRITES=true (and then only on the targets ONEUPTIME_AI_WRITE_TARGETS allows, never its protected targets). Anyone who may edit the vCenter can lower the mode; raising it needs Project Owner, Project Admin or Edit Auto Remediation Rule.",
    defaultValue: ResourceAiRemediationMode.Disabled,
    example: ResourceAiRemediationMode.RequireApproval,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: ResourceAiRemediationMode.Disabled,
  })
  public aiRemediationMode?: ResourceAiRemediationMode = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditVMwareVCenter,
    ],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "AI Command Allowlist",
    description:
      "Optional JSON array of command patterns that Automatic mode may run on this vCenter without approval even though they are riskier changes. Each pattern is one command line for this vCenter's agent (govc) and is compared with the command word by word: * stands for exactly one word (a name, an id), never for extra words or flags, and every flag the command uses must be written out in the pattern. At most 50 patterns of at most 500 characters each; a pattern that is not one valid write command for this vCenter is refused. Destructive commands (Denied tier) never run regardless, and a command that always needs a human still asks. Adding a pattern needs Project Owner, Project Admin or Edit Auto Remediation Rule; anyone who may edit the vCenter can remove patterns or clear the list.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public aiCommandAllowlist?: Array<string> = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "AI Access Last Verified At",
    description:
      "When a command from OneUptime AI last succeeded on this vCenter through its VMware AI agent. Set by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public aiAccessLastVerifiedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "AI Access Last Error",
    description:
      "The most recent failure OneUptime AI hit while running a command on this vCenter, kept until the next successful command. Set by the server.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
  })
  public aiAccessLastError?: string = undefined;

  /*
   * When this vCenter's AI access was first configured — by anyone writing an
   * AI access setting. Only the server writes it, and nothing ever clears
   * it. A registering VMware AI agent reads it to tell "never configured" (it may
   * apply its first-connection defaults) from "an operator chose settings,
   * perhaps before installing the agent" (every setting stays as chosen).
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadVMwareVCenter,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "AI Access Configured At",
    description:
      "When OneUptime AI access to this vCenter was first configured by anyone saving an AI access setting. Set by the server; never cleared, so a VMware AI agent that registers later never overwrites a setting an operator chose.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public aiAccessConfiguredAt?: Date = undefined;

  /*
   * ---------------------------------------------------------------------
   * Probe collection: no agent - a OneUptime probe logs in to vCenter.
   * ---------------------------------------------------------------------
   *
   * A person saves vCenter's address, a read-only account and the probe that
   * can reach vCenter. That probe collects the same data the VMware agent's
   * vcenter receiver sends, every collectionIntervalInMinutes, and ingest
   * treats it exactly like the agent's (VMwareSnapshotScan, the metric
   * catalog, the alert templates, the AI tools).
   *
   * The settings are edited by whoever may edit the vCenter. The password is
   * write-only - nobody reads it back and the API never returns it - and is
   * only ever sent to the address, through the probe, and to the certificate
   * it was entered for (VMwareCollectionSettings.getPasswordRebindRefusal).
   * The status columns after the settings are written by the server and the
   * probe only.
   */
  @ColumnAccessControl({
    create: VCENTER_CREATORS,
    read: VCENTER_READERS,
    update: VCENTER_EDITORS,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Collection Method",
    description:
      "How this vCenter's data reaches OneUptime. Probe: one of your OneUptime probes logs in to vCenter with the read-only account saved here and collects it - no agent to install. Agent: the OneUptime VMware Agent you run sends it. Switching to Agent forgets the saved password.",
    defaultValue: VMwareCollectionMethod.Agent,
    example: VMwareCollectionMethod.Probe,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: VMwareCollectionMethod.Agent,
  })
  public collectionMethod?: VMwareCollectionMethod = undefined;

  @ColumnAccessControl({
    create: VCENTER_CREATORS,
    read: VCENTER_READERS,
    update: VCENTER_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "vCenter Address",
    description:
      "The HTTPS address of vCenter Server (or a standalone ESXi host) the probe connects to, such as https://vcsa.example.com. Stored as https://host[:port]; a path such as /ui or /sdk is dropped. Changing it asks for the password again.",
    example: "https://vcsa.example.com",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public vcenterUrl?: string = undefined;

  @ColumnAccessControl({
    create: VCENTER_CREATORS,
    read: VCENTER_READERS,
    update: VCENTER_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "vCenter User Name",
    description:
      "The vSphere user the probe logs in as, with its domain - such as oneuptime@vsphere.local. Give it the built-in Read-Only role on the top-level vCenter object, propagated to children.",
    example: "oneuptime@vsphere.local",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public vcenterUsername?: string = undefined;

  @ColumnAccessControl({
    create: VCENTER_CREATORS,
    read: [],
    update: VCENTER_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    encrypted: true,
    title: "vCenter Password",
    description:
      "The password of the vCenter user. Write-only: encrypted at rest, never returned by the API, and sent only to the probe that collects this vCenter. Leave it out of an update to keep the saved one; changing the address, the probe or the trusted certificate needs it again.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public vcenterPassword?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: VCENTER_READERS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Password Saved",
    description:
      "Whether a vCenter password is saved. Set by the server from the password itself.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isVCenterPasswordSet?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: VCENTER_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Credentials Changed At",
    description:
      "When the vCenter user name or password was last changed. Set by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public vcenterCredentialsUpdatedAt?: Date = undefined;

  @ColumnAccessControl({
    create: VCENTER_CREATORS,
    read: VCENTER_READERS,
    update: VCENTER_EDITORS,
  })
  @TableColumn({
    manyToOneRelationColumn: "collectionProbeId",
    type: TableColumnType.Entity,
    modelType: Probe,
    title: "Collection Probe",
    description:
      "The OneUptime probe that collects this vCenter: one of this project's own probes, in a network that can reach vCenter on TCP 443 (on a self-hosted install, the instance's own probes may be picked too).",
  })
  @ManyToOne(
    () => {
      return Probe;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "collectionProbeId" })
  public collectionProbe?: Probe = undefined;

  @ColumnAccessControl({
    create: VCENTER_CREATORS,
    read: VCENTER_READERS,
    update: VCENTER_EDITORS,
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Collection Probe ID",
    description:
      "ID of the OneUptime probe that collects this vCenter. Changing it asks for the password again.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public collectionProbeId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: VCENTER_CREATORS,
    read: VCENTER_READERS,
    update: VCENTER_EDITORS,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Trusted Certificate Fingerprint",
    description:
      "The SHA-256 fingerprint of the one certificate the probe accepts from this vCenter, for a vCenter whose certificate is not from a public authority (vCenter's own VMCA certificate, by default). Empty: the certificate must be signed by an authority the probe's machine trusts. Verification is never skipped. Trusting a different certificate asks for the password again.",
    example:
      "3A:7F:12:9C:4B:D0:55:E1:08:6A:B2:C3:91:F4:27:8E:6D:0B:A5:C8:13:4E:F9:72:B6:5D:0A:E3:29:C1:7B:44",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public trustedCertificateFingerprint?: string = undefined;

  @ColumnAccessControl({
    create: VCENTER_CREATORS,
    read: VCENTER_READERS,
    update: VCENTER_EDITORS,
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Number,
    title: "Collection Interval (Minutes)",
    description:
      "How often the probe collects this vCenter, in whole minutes from 1 to 60. Two minutes is the VMware agent's own default; collect large vCenters less often to go easier on vCenter.",
    defaultValue: DEFAULT_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
    example: DEFAULT_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: DEFAULT_VMWARE_COLLECTION_INTERVAL_IN_MINUTES,
  })
  public collectionIntervalInMinutes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: VCENTER_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Collection Status",
    description:
      "Where probe collection stands: Pending (the probe has not tried the current settings yet), Succeeded or Failed. Written by the server and the probe.",
    example: VMwareCollectionStatus.Succeeded,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public collectionStatus?: VMwareCollectionStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: VCENTER_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Collection Error Code",
    description:
      "Why the last collection failed, as a code the dashboard turns into a next step (InvalidLogin, UntrustedCertificate, ConnectionTimedOut, ...). Written by the probe.",
    example: VMwareCollectionErrorCode.InvalidLogin,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public collectionErrorCode?: VMwareCollectionErrorCode = undefined;

  @ColumnAccessControl({
    create: [],
    read: VCENTER_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Collection Error",
    description:
      "What went wrong in the last collection, in words. Written by the probe.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public collectionError?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: VCENTER_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Presented Certificate",
    description:
      "The certificate vCenter presented when the last collection did not trust it: its SHA-256 fingerprint, subject, issuer and validity, so a person can check it and trust exactly that certificate. Written by the probe.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public presentedCertificate?: VMwarePresentedCertificate = undefined;

  @ColumnAccessControl({
    create: [],
    read: VCENTER_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Collection Summary",
    description:
      "What the last successful collection found: vCenter's product and version, and how many datacenters, clusters, hosts, virtual machines, datastores and resource pools it reported. Written by the probe.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public collectionSummary?: VMwareCollectionSummary = undefined;

  @ColumnAccessControl({
    create: [],
    read: VCENTER_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Next Collection At",
    description:
      "When the probe collects this vCenter next. Written by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public nextCollectionAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: VCENTER_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Collection At",
    description:
      "When the probe last tried to collect this vCenter, whether it worked or not. Written by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastCollectionAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: VCENTER_READERS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Successful Collection At",
    description:
      "When the probe last collected this vCenter successfully. Written by the server.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastSuccessfulCollectionAt?: Date = undefined;

  /*
   * Counts every change to the connection settings. A probe is handed the
   * version it collects with and reports it back, so a collection that
   * started before a person fixed the password cannot report the old
   * failure over the new settings.
   */
  @ColumnAccessControl({
    create: [],
    read: VCENTER_READERS,
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Number,
    title: "Collection Settings Version",
    description:
      "Counts changes to the probe collection settings, so a report from a collection that started before a change is not shown as the current status. Written by the server.",
    defaultValue: 0,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public collectionSettingsVersion?: number = undefined;
}
