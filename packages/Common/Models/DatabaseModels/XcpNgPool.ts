import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnBillingAccessControl from "../../Types/Database/AccessControl/ColumnBillingAccessControl";
import Label from "./Label";
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
import ServerOwned from "../../Types/Database/ServerOwned";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import TelemetryRetentionConfig from "../../Types/Telemetry/TelemetryRetentionConfig";
import {
  XcpNgPoolBackupJob,
  XcpNgPoolEventReadStatus,
  XcpNgPoolEventState,
} from "../../Types/XcpNg/XcpNgPoolEventState";
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
 * ------------------------------------------------------------------
 *                            XcpNgPool
 * ------------------------------------------------------------------
 *
 * An XCP-ng pool: the unit the XCP-ng product is built around, as a
 * Proxmox cluster or a vCenter is for theirs. A pool is read from the Xen
 * Orchestra that manages it, and one Xen Orchestra reports every pool it
 * manages through one OpenMetrics endpoint, so one XCP-ng Agent adds as
 * many pools as its Xen Orchestra has - each its own row, with its own
 * pages, owners, labels, monitors and retention. Unrelated pools never
 * share a page because they share a Xen Orchestra.
 *
 * Identity is the pool's XAPI UUID (poolIdentifier, from the agent's
 * xcp_ng.pool.id resource attribute), never its name: a pool's name_label
 * can be empty, can change, and two Xen Orchestras can each manage a pool
 * named "Production". The name is OneUptime's, seeded from Xen
 * Orchestra's (reportedName) and kept in step with it until someone
 * renames the pool here.
 *
 * What the next parts of the XCP-ng epic (#10992) add here:
 *   - #10996 (a probe reads Xen Orchestra without an agent): the probe
 *     sends the same OTLP shape the agent does (XcpNgTelemetry), so a pool
 *     keeps its row and its history whichever reads it. The connection to
 *     a Xen Orchestra (address, secrets, probe, certificate) is a model of
 *     its own (one per Xen Orchestra, not per pool), which a pool links to
 *     beside xenOrchestraName.
 *   - #10997 (alarms, HA, patches and backups from Xen Orchestra's REST
 *     API): new event types on XcpNgPoolFeed, and inventory facts on
 *     XcpNgResource rows, which are keyed by the same XAPI UUIDs the REST
 *     API returns.
 *   - #10998 (OneUptime AI): the AI access columns every other resource
 *     with an AI agent has (isAiInvestigationEnabled, aiRemediationMode,
 *     ...), with AiResourceType.XcpNgPool.
 * ------------------------------------------------------------------
 */
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
    Permission.CreateXcpNgPool,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.SettingsViewer,
    Permission.ReadXcpNgPool,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.DeleteXcpNgPool,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.EditXcpNgPool,
  ],
})
@CrudApiEndpoint(new Route("/xcp-ng-pool"))
@SlugifyColumn("name", "slug")
/*
 * DB-level unique indexes on (projectId, poolIdentifier) and (projectId,
 * name). The @UniqueColumnBy decorators are app-level only and do not defuse
 * the concurrent find-or-create race at ingest (two agents, or an agent and a
 * probe, discovering the same pool at once): the first index is what makes
 * the loser of that race find the winner's row. Mirrors KubernetesCluster's
 * (projectId, clusterIdentifier) unique index.
 */
@Index(["projectId", "poolIdentifier"], { unique: true })
@Index(["projectId", "name"], { unique: true })
@Index(["projectId", "isArchived"])
/*
 * The slug is unique among the pools that are not deleted, declared and named
 * here as every product's is, so the schema builder keeps it.
 */
@Index("IDX_xcp_ng_pool_slug", ["slug"], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@TableMetadata({
  tableName: "XcpNgPool",
  singularName: "XCP-ng Pool",
  pluralName: "XCP-ng Pools",
  icon: IconProp.XcpNg,
  tableDescription:
    "XCP-ng pools that are being monitored in this project, read from Xen Orchestra. Each pool is added on its own when the OneUptime XCP-ng Agent first reports it, one per pool the Xen Orchestra manages, or can be added ahead by its UUID.",
})
@Entity({
  name: "XcpNgPool",
})
export default class XcpNgPool extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateXcpNgPool,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadXcpNgPool,
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
      Permission.CreateXcpNgPool,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadXcpNgPool,
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
      Permission.CreateXcpNgPool,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditXcpNgPool,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "Name of this XCP-ng pool in OneUptime. Taken from its name in Xen Orchestra when it is first seen, and kept in step with it until someone renames it here. The pool's telemetry is matched on its UUID, so a rename splits nothing.",
    example: "Production",
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
      Permission.ReadXcpNgPool,
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
      Permission.CreateXcpNgPool,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditXcpNgPool,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Description",
    description: "Friendly description for this XCP-ng pool",
    example: "Production XCP-ng 8.3 pool in the Paris data centre",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  /*
   * What the pool's telemetry is matched on (xcp_ng.pool.id, from Xen Orchestra's
   * pool_id label): the pool's XAPI UUID, lower case. Unlike a Proxmox cluster's
   * name it is not chosen by anyone, so it never changes, and two pools with the
   * same name behind two Xen Orchestras stay two pools. Edited only under
   * Advanced on the pool's Settings (DiscoveredResourceUpdate holds a write of it
   * to what creating a pool holds it to).
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateXcpNgPool,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditXcpNgPool,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Pool UUID",
    description:
      "The pool's XAPI UUID, as Xen Orchestra reports it in the pool_id label. OneUptime matches the pool's telemetry on it, so renaming the pool in Xen Orchestra or here never splits its history.",
    example: "b7569d99-30f8-178a-7d94-801de3e29b5b",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public poolIdentifier?: string = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name in Xen Orchestra",
    description:
      "The pool's name as Xen Orchestra last reported it (pool_name). Empty when the pool has no name in XAPI. The pool's own name follows it until someone renames the pool here.",
    example: "Production",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public reportedName?: string = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Xen Orchestra",
    description:
      "The Xen Orchestra this pool is read from, by the name the XCP-ng Agent was given (XO_NAME). One Xen Orchestra can report many pools.",
    example: "xo-paris",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public xenOrchestraName?: string = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditXcpNgPool,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "OTel Collector Status",
    description:
      "Whether the pool is being read: connected while Xen Orchestra reported it in the last 15 minutes, disconnected once it has not",
    example: "connected",
    serverOwned: ServerOwned.Always,
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
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditXcpNgPool,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Agent Version",
    description:
      "Version of the OneUptime XCP-ng Agent reporting this pool, as it reports itself in the oneuptime.agent.version resource attribute",
    example: "1.0.0",
    serverOwned: ServerOwned.Always,
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
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditXcpNgPool,
    ],
  })
  /*
   * When the pool was last READ: when a batch carried what Xen Orchestra says
   * about the pool (its hosts, VMs, storage repositories or its connection) and
   * reached the inventory flush. Xen Orchestra stops reporting a pool it lost
   * the connection to, so this goes stale while the agent keeps reporting the
   * other pools of the same Xen Orchestra: the pool turns Disconnected 15
   * minutes after its last read (XcpNgPoolService.markDisconnectedPools), and
   * the stale-inventory prune, anchored here, stops with it.
   */
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Last Seen At",
    description:
      "When the pool was last read: when Xen Orchestra last reported its hosts, VMs, storage repositories or its connection",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public lastSeenAt?: Date = undefined;

  /*
   * When the XCP-ng Agent last sent anything that names this pool, written by
   * the ingest heartbeat (XcpNgPoolService.updateAgentLastSeen), never by a
   * person. NULL until the agent first reports. Every block the agent sends
   * for a pool is a read of it, so it follows lastSeenAt closely; it is kept
   * apart so a probe (#10996) can say it reached Xen Orchestra while a pool is
   * missing from it.
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
      Permission.ReadXcpNgPool,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Agent Last Seen At",
    description:
      "When the OneUptime XCP-ng Agent last sent anything for this pool",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public agentLastSeenAt?: Date = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditXcpNgPool,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Host Count",
    description:
      "How many hosts the pool has, as Xen Orchestra last reported them.",
    isDefaultValueColumn: true,
    defaultValue: 0,
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
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
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditXcpNgPool,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Running Host Count",
    description:
      "How many of the pool's hosts Xen Orchestra last reported Running. Shown as 'Hosts X/Y running' beside hostCount.",
    isDefaultValueColumn: true,
    defaultValue: 0,
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
    default: 0,
  })
  public runningHostCount?: number = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditXcpNgPool,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Disabled Host Count",
    description:
      "How many of the pool's hosts are disabled: in maintenance mode or being evacuated.",
    isDefaultValueColumn: true,
    defaultValue: 0,
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
    default: 0,
  })
  public disabledHostCount?: number = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditXcpNgPool,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "VM Count",
    description:
      "How many VMs the pool has, control domains (dom0) and templates left out.",
    isDefaultValueColumn: true,
    defaultValue: 0,
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
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
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditXcpNgPool,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Running VM Count",
    description: "How many of the pool's VMs are Running.",
    isDefaultValueColumn: true,
    defaultValue: 0,
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
    default: 0,
  })
  public runningVmCount?: number = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditXcpNgPool,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Storage Repository Count",
    description:
      "How many storage repositories the pool has, shared and local.",
    isDefaultValueColumn: true,
    defaultValue: 0,
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
    default: 0,
  })
  public storageRepositoryCount?: number = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditXcpNgPool,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Virtual Disk Count",
    description:
      "How many virtual disks (VDIs) the pool's storage repositories hold, snapshots left out.",
    isDefaultValueColumn: true,
    defaultValue: 0,
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
    default: 0,
  })
  public vdiCount?: number = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditXcpNgPool,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    title: "Storage Capacity Bytes",
    description:
      "The physical size of the pool's storage repositories that hold VM disks, added up (xcp_sr_physical_size_bytes; ISO libraries left out). Stored as bigint.",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.BigPositiveNumber,
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
  public storageCapacityBytes?: number = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditXcpNgPool,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    title: "Storage Used Bytes",
    description:
      "The space used on those storage repositories, added up (xcp_sr_physical_usage_bytes). Stored as bigint.",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.BigPositiveNumber,
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
  public storageUsedBytes?: number = undefined;

  /*
   * ---- #10997: high availability, the master, alarms, patches, backups ----
   *
   * Read by a probe - through Xen Orchestra's REST API with a Read only
   * token, or straight from the pool's XAPI - never by the XCP-ng Agent,
   * whose OpenMetrics plugin carries none of it: every column below stays
   * empty for a pool only the agent reads, and the pool's pages say so.
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
      Permission.ReadXcpNgPool,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "HA Enabled",
    description:
      "Whether the pool's high availability is on, as a probe last read it from Xen Orchestra or XAPI. Empty until read.",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public isHaEnabled?: boolean = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "HA Host Failures To Tolerate",
    description:
      "How many host failures HA is set to tolerate (ha_host_failures_to_tolerate). Read straight from XAPI only: Xen Orchestra's REST API does not report it.",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public haHostFailuresToTolerate?: number = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "HA Plan Exists For",
    description:
      "How many host failures HA's current plan can still survive with every protected VM restarted (ha_plan_exists_for). Read straight from XAPI only.",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public haPlanExistsFor?: number = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "HA Overcommitted",
    description:
      "Whether HA can no longer guarantee to restart the protected VMs after the host failures it is set to tolerate (ha_overcommitted). Read straight from XAPI only.",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public isHaOvercommitted?: boolean = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Pool Master UUID",
    description:
      "The XAPI UUID of the host that is the pool master, as a probe last read it. A change of master lands on the pool's feed.",
    example: "b61a5c92-700e-4966-a13b-00633f03eea8",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public masterHostExternalId?: string = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Alarms Read At",
    description:
      "When a probe last read the pool's alarms, HA and master. Empty while nothing reads them (the XCP-ng Agent cannot).",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public eventsReadAt?: Date = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Backups Read At",
    description:
      "When a probe last read Xen Orchestra's backup logs for the pool. Empty while nothing reads them: XAPI knows nothing of Xen Orchestra's backups.",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public backupsReadAt?: Date = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Patches Checked At",
    description:
      "When a probe last asked Xen Orchestra which patches the pool's hosts miss, every six hours.",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public patchesCheckedAt?: Date = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Event Read Status",
    description:
      "How the pool's alarms and backups are read (Xen Orchestra or XAPI) and what the last read could not read, in words.",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public eventReadStatus?: XcpNgPoolEventReadStatus = undefined;

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
      Permission.ReadXcpNgPool,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Backup Jobs",
    description:
      "Each Xen Orchestra backup job that backs up this pool's VMs, with how often it runs and its last runs for this pool: succeeded, failed, skipped or interrupted, and the VMs that failed and why.",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public backupJobs?: Array<XcpNgPoolBackupJob> = undefined;

  /*
   * Where reading the pool's events stands - the watermarks a probe starts
   * from, the messages whose alerts are open - kept by the server so a
   * probe that restarts neither loses nor repeats one. Never served.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Event State",
    description:
      "Internal: where reading the pool's alarms and backups stands. Written and read by OneUptime only.",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public eventState?: XcpNgPoolEventState = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateXcpNgPool,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadXcpNgPool,
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
      Permission.CreateXcpNgPool,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadXcpNgPool,
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
      Permission.CreateXcpNgPool,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditXcpNgPool,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Archived",
    description:
      "Is this XCP-ng pool archived? Archived XCP-ng pools are hidden from lists but keep collecting telemetry.",
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
      Permission.ReadXcpNgPool,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Archived At",
    description: "When was this XCP-ng pool archived?",
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
      Permission.ReadXcpNgPool,
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
      Permission.ReadXcpNgPool,
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
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateXcpNgPool,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditXcpNgPool,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description: "Labels to group and filter by.",
    serverOwned: ServerOwned.Shared,
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "XcpNgPoolLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "xcpNgPoolId",
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
      Permission.CreateXcpNgPool,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditXcpNgPool,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    title: "Retain Telemetry Data For Days",
    description:
      "Number of days to retain telemetry data for this XCP-ng pool. Leave blank to use the project-wide default.",
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
      Permission.CreateXcpNgPool,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadXcpNgPool,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditXcpNgPool,
    ],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Telemetry Data Retention Overrides",
    description:
      "Per-pillar retention overrides for this XCP-ng pool (logs by severity, traces by status, metrics, profiles). Unset fields fall back to the XCP-ng pool default, then the project's retention settings.",
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
}
