import Host from "./Host";
import KubernetesCluster from "./KubernetesCluster";
import DockerHost from "./DockerHost";
import PodmanHost from "./PodmanHost";
import ProxmoxCluster from "./ProxmoxCluster";
import OpenStackCloud from "./OpenStackCloud";
import VMwareVCenter from "./VMwareVCenter";
import CephCluster from "./CephCluster";
import StorageArray from "./StorageArray";
import CloudResource from "./CloudResource";
import DockerSwarmCluster from "./DockerSwarmCluster";
import IoTFleet from "./IoTFleet";
import DatabaseServer from "./DatabaseServer";
import Service from "./Service";
import Label from "./Label";
import MonitorStatus from "./MonitorStatus";
import MonitorTemplate from "./MonitorTemplate";
import NetworkDevice from "./NetworkDevice";
import NetworkDeviceTieSource from "../../Types/NetworkDevice/NetworkDeviceTieSource";
import NetworkAlertPolicy from "./NetworkAlertPolicy";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OperationalResource from "../../Types/Database/AccessControl/OperationalResource";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import AccessControlColumn from "../../Types/Database/AccessControlColumn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import ServerOwned from "../../Types/Database/ServerOwned";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableMCP from "../../Types/Database/EnableMCP";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import IncomingEmailMonitorRequest from "../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import IncomingMonitorRequest from "../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import { IncomingRequestSecretProblem } from "../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";
import MonitorStepsColumnTransformer from "../../Types/Monitor/MonitorStepsColumnTransformer";
import MonitorType from "../../Types/Monitor/MonitorType";
import ServerMonitorResponse from "../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import HashedString from "../../Types/HashedString";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";

@OperationalResource()
@EnableDocumentation()
@EnableMCP()
@AccessControlColumn("labels")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.MonitorAdmin,
    Permission.MonitorMember,
    Permission.CreateProjectMonitor,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.MonitorAdmin,
    Permission.MonitorMember,
    Permission.MonitorViewer,
    Permission.ReadProjectMonitor,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.MonitorAdmin,
    Permission.MonitorMember,
    Permission.DeleteProjectMonitor,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.MonitorAdmin,
    Permission.MonitorMember,
    Permission.EditProjectMonitor,
  ],
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
/*
 * The keys a server agent, an incoming request and an incoming email
 * present are secrets: the audit log records who changed one, never the key.
 */
@EnableAuditLog({
  redactColumns: [
    "serverMonitorSecretKey",
    "incomingRequestSecretKey",
    "incomingEmailSecretKey",
  ],
})
@CrudApiEndpoint(new Route("/monitor"))
@SlugifyColumn("name", "slug")
@Index(
  "IDX_monitor_auto_provisioned_device_template_unique",
  ["autoProvisionedNetworkDeviceId", "monitorTemplateId"],
  {
    unique: true,
    where:
      '"deletedAt" IS NULL AND "autoProvisionedNetworkDeviceId" IS NOT NULL AND "monitorTemplateId" IS NOT NULL',
  },
)
/*
 * INDEXES. Heartbeats, telemetry sweeps, server reports and status changes
 * rewrite rows here all the time, and an update can only be HOT (no index
 * entry at all) when it changes no column an index names, in its key or its
 * WHERE. So an index is here because a read needs it, and a column that a
 * frequent write moves is named by none: telemetryMonitorLastMonitorAt and
 * NextMonitorAt (every minute), the incoming request and email heartbeat
 * stamps (every 30 seconds), serverMonitorRequestReceivedAt (every report).
 * Their sweeps find their monitors by type, below. A partial index holds,
 * and costs a write, only for the rows its WHERE matches.
 *
 * Every list of this resource pins `isArchived` inside a project (the main
 * list hides archived rows, the Archived page shows only them), so the pair
 * leads, like every other archivable resource. createdAt follows: a list
 * nobody sorted comes newest first (DatabaseService.getReadSort), and this
 * hands it the first page without sorting the whole project. It also serves
 * every other read by project, and the project's foreign key.
 */
@Index(["projectId", "isArchived", "createdAt"])
/*
 * The monitors made for a network device: the device's pages, the alert
 * policy engine, and the device delete - its count of them and its foreign
 * key (ON DELETE RESTRICT), which looks for them with no deletedAt and no
 * template. The unique index above requires a template, which none of these
 * imply. (A device poll and trap find their monitors through
 * MonitorNetworkDevice.)
 */
@Index(["autoProvisionedNetworkDeviceId"], {
  where: '"autoProvisionedNetworkDeviceId" IS NOT NULL',
})
/*
 * The monitors a person tied to a network device (networkDeviceId, issue
 * #9545): the device's pages, the duplicate check an import runs for each
 * device, and the device delete, whose foreign key unties them (SET NULL)
 * and would otherwise read the whole table to find them. Partial, so it
 * holds - and costs a write for - only the monitors that are tied.
 */
@Index("IDX_monitor_network_device", ["networkDeviceId"], {
  where: '"networkDeviceId" IS NOT NULL',
})
/*
 * A type's monitors in id order: the heartbeat and server sweeps
 * (Workers/Utils/MonitorSweep) page through one type by id, and the
 * telemetry sweep reads its types.
 */
@Index(["monitorType", "_id"])
/*
 * The Monitors menu's Probes Disconnected, No Probe Enabled and Disabled
 * counts (Pages/Monitor/SideMenu.tsx), counted again on every change to a
 * monitor, and their pages: each holds only the monitors it counts.
 */
@Index(["projectId"], {
  where:
    '"isAllProbesDisconnectedFromThisMonitor" = true AND "isArchived" = false AND "deletedAt" IS NULL',
})
@Index(["projectId"], {
  where:
    '"isNoProbeEnabledOnThisMonitor" = true AND "isArchived" = false AND "deletedAt" IS NULL',
})
@Index(["projectId"], {
  where:
    '"disableActiveMonitoring" = true AND "isArchived" = false AND "deletedAt" IS NULL',
})
@Entity({
  name: "Monitor",
})
@TableMetadata({
  tableName: "Monitor",
  singularName: "Monitor",
  pluralName: "Monitors",
  icon: IconProp.AltGlobe,
  tableDescription:
    "Monitor is anything that monitors your API, Websites, IP, Network or more. You can also create static monitor that does not monitor anything.",
  /*
   * A monitor changes on its own: a check fails and its status moves, every
   * probe watching it disconnects, a maintenance event turns its monitoring
   * off. The Monitors menu counts what needs attention (Not Operational,
   * Disabled, Probes Disconnected, No Probe Enabled) beside the lists that show
   * them, and both follow these announcements at once (UseLiveCount,
   * UseLiveRows) instead of waiting for a reload (#6918).
   *
   * What is announced is what the service writes (DatabaseService): a status
   * change, a probe's flags, an edit, an archive - and an update only when
   * it changed the row. The bookkeeping a probe's result, a heartbeat or a
   * telemetry sweep stamps on a monitor every minute is written without
   * hooks (updateColumnsByIdWithoutHooks), and announces nothing: no count
   * or list is waiting on it (HeartbeatWriteFastPathSafety).
   */
  enableRealtimeEventsOn: {
    create: true,
    update: true,
    delete: true,
  },
})
export default class Monitor extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
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
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of your OneUptime Project in which this object belongs",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Name",
    description: "Any friendly name for this monitor",
    canReadOnRelationQuery: true,
    example: "Production API Server",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.VeryLongText,
    title: "Description",
    description: "Friendly description that will help you remember",
    example:
      "Monitors the health and availability of our main production API server",
  })
  @Column({
    nullable: true,
    type: ColumnType.VeryLongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
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
    example: "production-api-server",
  })
  @Column({
    nullable: false,
    type: ColumnType.Slug,
    length: ColumnLength.Slug,
    unique: true,
  })
  public slug?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
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
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
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

  /*
   * Archiving retires a monitor without deleting its history: it leaves
   * the monitor lists and status pages, probes and workers stop checking
   * it, and no result is processed for it, so it opens no incidents or
   * alerts (MonitorService.getEnabledMonitorQuery and MonitorCheckState).
   * Deliberately separate from `disableActiveMonitoring`: unarchiving
   * must not re-enable a monitor somebody had disabled, and enabling
   * must not pull it back out of the archive.
   *
   * No dedicated permission: archiving is an update, so it is gated by Edit.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    required: true,
    type: TableColumnType.Boolean,
    /*
     * Read with a record that names the monitor - a network device bound to
     * it, a network link it watches - as with its current status: an
     * archived monitor's status is frozen, and what reads the record must be
     * able to tell (Utils/Monitor/MonitoringOff.isMonitored).
     */
    canReadOnRelationQuery: true,
    title: "Is Archived",
    description:
      "Archived monitors are hidden from monitor lists and status pages, are not checked, and open no incidents or alerts. Unarchiving resumes monitoring.",
    defaultValue: false,
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isArchived?: boolean = undefined;

  /*
   * Stamped server-side from the `isArchived` write (see
   * DatabaseService.sanitizeCreateOrUpdate), which is why these are read-only
   * to the client: "who archived this and when" cannot be spoofed.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Archived At",
    description:
      "When this monitor was archived. Empty while it is not archived.",
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
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
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
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
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
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
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
    name: "MonitorLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Monitor,
    title: "Depends On Monitors",
    description:
      "Parent monitors this monitor depends on. When a parent is offline (or in one of the configured suppression statuses), alerts and incidents from this monitor are suppressed at creation time — the monitor keeps evaluating and its status timeline still updates.",
    serverOwned: ServerOwned.Shared,
  })
  @ManyToMany(
    () => {
      return Monitor;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MonitorDependency",
    inverseJoinColumn: {
      name: "dependsOnMonitorId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public dependsOnMonitors?: Array<Monitor> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: MonitorStatus,
    title: "Suppress Alerts When Parent Monitor Status Is",
    description:
      "Parent monitor statuses that suppress this monitor's alerts and incidents. When empty, statuses flagged as offline suppress (the default). Only used when Depends On Monitors is set.",
  })
  @ManyToMany(
    () => {
      return MonitorStatus;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MonitorDependencySuppressionStatus",
    inverseJoinColumn: {
      name: "monitorStatusId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public suppressAlertsWhenParentMonitorStatuses?: Array<MonitorStatus> =
    undefined;

  /*
   * What this monitor watches, beyond what its own configuration names: the
   * hosts, clusters, databases and services an incident or alert from it is
   * about. A website or API monitor's configuration names none of them, so
   * without these a "site is down" incident was linked to nothing, and
   * neither OneUptime AI's investigation nor a cluster's or resource's AI
   * fix could reach the system actually serving the site. Every incident
   * and alert the monitor creates is linked to these (MonitorResourceContext),
   * and the dashboard prefills them when someone declares an incident,
   * creates an alert or schedules maintenance for the monitor. The same
   * resource types as an incident's Other Affected Resources.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Host,
    title: "Hosts",
    description:
      "Hosts this monitor watches. Incidents and alerts it creates are linked to them, so OneUptime AI can investigate and fix them there.",
  })
  @ManyToMany(
    () => {
      return Host;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MonitorHost",
    inverseJoinColumn: {
      name: "hostId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public hosts?: Array<Host> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: KubernetesCluster,
    title: "Kubernetes Clusters",
    description:
      "Kubernetes clusters this monitor watches. Incidents and alerts it creates are linked to them, so OneUptime AI can investigate and fix them there.",
  })
  @ManyToMany(
    () => {
      return KubernetesCluster;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MonitorKubernetesCluster",
    inverseJoinColumn: {
      name: "kubernetesClusterId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public kubernetesClusters?: Array<KubernetesCluster> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: DockerHost,
    title: "Docker Hosts",
    description:
      "Docker hosts this monitor watches. Incidents and alerts it creates are linked to them, so OneUptime AI can investigate and fix them there.",
  })
  @ManyToMany(
    () => {
      return DockerHost;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MonitorDockerHost",
    inverseJoinColumn: {
      name: "dockerHostId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public dockerHosts?: Array<DockerHost> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: PodmanHost,
    title: "Podman Hosts",
    description:
      "Podman hosts this monitor watches. Incidents and alerts it creates are linked to them, so OneUptime AI can investigate and fix them there.",
  })
  @ManyToMany(
    () => {
      return PodmanHost;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MonitorPodmanHost",
    inverseJoinColumn: {
      name: "podmanHostId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public podmanHosts?: Array<PodmanHost> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: ProxmoxCluster,
    title: "Proxmox Clusters",
    description:
      "Proxmox clusters this monitor watches. Incidents and alerts it creates are linked to them, so OneUptime AI can investigate and fix them there.",
  })
  @ManyToMany(
    () => {
      return ProxmoxCluster;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MonitorProxmoxCluster",
    inverseJoinColumn: {
      name: "proxmoxClusterId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public proxmoxClusters?: Array<ProxmoxCluster> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: OpenStackCloud,
    title: "OpenStack Clouds",
    description:
      "OpenStack clouds this monitor watches. Incidents and alerts it creates are linked to them, so OneUptime AI can investigate and fix them there.",
  })
  @ManyToMany(
    () => {
      return OpenStackCloud;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MonitorOpenStackCloud",
    inverseJoinColumn: {
      name: "openStackCloudId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public openStackClouds?: Array<OpenStackCloud> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: VMwareVCenter,
    title: "vCenters",
    description:
      "VMware vCenters this monitor watches. Incidents and alerts it creates are linked to them, so OneUptime AI can investigate and fix them there.",
  })
  @ManyToMany(
    () => {
      return VMwareVCenter;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MonitorVMwareVCenter",
    inverseJoinColumn: {
      name: "vmwareVCenterId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public vmwareVCenters?: Array<VMwareVCenter> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: CephCluster,
    title: "Ceph Clusters",
    description:
      "Ceph clusters this monitor watches. Incidents and alerts it creates are linked to them, so OneUptime AI can investigate and fix them there.",
  })
  @ManyToMany(
    () => {
      return CephCluster;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MonitorCephCluster",
    inverseJoinColumn: {
      name: "cephClusterId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public cephClusters?: Array<CephCluster> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: StorageArray,
    title: "Storage Arrays",
    description:
      "Storage arrays this monitor watches. Incidents and alerts it creates are linked to them.",
  })
  @ManyToMany(
    () => {
      return StorageArray;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MonitorStorageArray",
    inverseJoinColumn: {
      name: "storageArrayId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public storageArrays?: Array<StorageArray> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: CloudResource,
    title: "Cloud Resources",
    description:
      "Cloud resources this monitor watches. Incidents and alerts it creates are linked to them.",
  })
  @ManyToMany(
    () => {
      return CloudResource;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MonitorCloudResource",
    inverseJoinColumn: {
      name: "cloudResourceId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public cloudResources?: Array<CloudResource> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: DockerSwarmCluster,
    title: "Docker Swarm Clusters",
    description:
      "Docker Swarm clusters this monitor watches. Incidents and alerts it creates are linked to them, so OneUptime AI can investigate and fix them there.",
  })
  @ManyToMany(
    () => {
      return DockerSwarmCluster;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MonitorDockerSwarmCluster",
    inverseJoinColumn: {
      name: "dockerSwarmClusterId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public dockerSwarmClusters?: Array<DockerSwarmCluster> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: IoTFleet,
    title: "IoT Fleets",
    description:
      "IoT fleets this monitor watches. Incidents and alerts it creates are linked to them, so OneUptime AI can investigate and fix them there.",
  })
  @ManyToMany(
    () => {
      return IoTFleet;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MonitorIoTFleet",
    inverseJoinColumn: {
      name: "iotFleetId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public iotFleets?: Array<IoTFleet> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: DatabaseServer,
    title: "Databases",
    description:
      "Databases this monitor watches. Incidents and alerts it creates are linked to them, so OneUptime AI can investigate and fix them there.",
  })
  @ManyToMany(
    () => {
      return DatabaseServer;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MonitorDatabaseServer",
    inverseJoinColumn: {
      name: "databaseServerId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public databaseServers?: Array<DatabaseServer> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Service,
    title: "Services",
    description:
      "Services this monitor watches. Incidents and alerts it creates are linked to them, so OneUptime AI can investigate and fix them there.",
  })
  @ManyToMany(
    () => {
      return Service;
    },
    { eager: false },
  )
  @JoinTable({
    name: "MonitorService",
    inverseJoinColumn: {
      name: "serviceId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
  })
  public services?: Array<Service> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "monitorTemplateId",
    type: TableColumnType.Entity,
    modelType: MonitorTemplate,
    title: "Monitor Template",
    description:
      "Template this monitor was created from. Used to sync configuration changes from the template to monitors created from it.",
  })
  @ManyToOne(
    () => {
      return MonitorTemplate;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "monitorTemplateId" })
  public monitorTemplate?: MonitorTemplate = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Monitor Template ID",
    description:
      "ID of the Monitor Template this monitor was created from. Null for monitors not created from a template.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public monitorTemplateId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "autoProvisionedNetworkDeviceId",
    type: TableColumnType.Entity,
    // Lazy: Monitor and NetworkDevice import each other (see modelTypeThunk).
    modelTypeThunk: () => {
      return NetworkDevice;
    },
    title: "Auto-Provisioned Network Device",
    description:
      "Network Device that caused this monitor to be provisioned automatically",
  })
  @ManyToOne(
    () => {
      return NetworkDevice;
    },
    {
      eager: false,
      nullable: true,
      /*
       * Service deletion removes automatic monitors through MonitorService.
       * RESTRICT is the final race backstop: a monitor inserted after that
       * preflight makes the device delete fail instead of being silently
       * cascade-deleted without authorization or lifecycle hooks.
       */
      onDelete: "RESTRICT",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({
    name: "autoProvisionedNetworkDeviceId",
    foreignKeyConstraintName: "FK_monitor_auto_provisioned_network_device",
  })
  public autoProvisionedNetworkDevice?: NetworkDevice = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Auto-Provisioned Network Device ID",
    description:
      "ID of the Network Device that caused this monitor to be provisioned automatically",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public autoProvisionedNetworkDeviceId?: ObjectID = undefined;

  /*
   * THE NETWORK DEVICE THIS MONITOR CHECKS (OneUptime issue #9545), when a
   * person made it rather than an import, an auto import rule or an alert
   * policy - those carry provenance instead (autoProvisionedNetworkDeviceId),
   * which is OneUptime's alone to write and deletes the monitor with its
   * device. This is a person's: set from the monitor's form or the device's
   * Monitors card, or, when a Ping, IP, Port, NTP, Website, API or SSL
   * Certificate monitor is created on an address exactly one device in the
   * project has, to that device (MonitorService). Deleting the device only
   * unties the monitor (SET NULL): somebody made it on purpose.
   *
   * It is what makes a hand-made monitor one of the device's own: listed on
   * the device's pages, linked to the incidents and alerts it raises, and
   * counted by the duplicate check that keeps an import or an auto import
   * rule from giving the device a second monitor of the same kind
   * (DeviceMonitorDuplicateCheck).
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "networkDeviceId",
    type: TableColumnType.Entity,
    // Lazy: Monitor and NetworkDevice import each other (see modelTypeThunk).
    modelTypeThunk: () => {
      return NetworkDevice;
    },
    title: "Network Device",
    description:
      "The network device this monitor checks. It is listed on the device's pages, and imports and auto import rules count it so the device never gets a second monitor of the same kind.",
  })
  @ManyToOne(
    () => {
      return NetworkDevice;
    },
    {
      eager: false,
      nullable: true,
      // A person made the monitor: the device going unties it, nothing more.
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({
    name: "networkDeviceId",
    foreignKeyConstraintName: "FK_monitor_network_device",
  })
  public networkDevice?: NetworkDevice = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Network Device ID",
    description:
      "ID of the network device this monitor checks, when a person made it for that device. Null for a monitor that checks no device, and for one an import made (see Auto-Provisioned Network Device ID).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public networkDeviceId?: ObjectID = undefined;

  /*
   * WHO SET NETWORK DEVICE (issue #9904): OneUptime, by the address the
   * monitor checks seen from its probes, or a person. OneUptime works its
   * own tie out again when the monitor's probes change - ties it to the
   * device they see now, or unties it - and never changes what a person
   * set, a tie or its removal (Types/NetworkDevice/NetworkDeviceTieSource).
   * OneUptime's alone to write: MonitorService records it with every write
   * of Network Device. Empty on a monitor tied before it was recorded,
   * which is kept as it is.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    // OneUptime fills it in: a value a create sends is not the caller's.
    computed: true,
    canReadOnRelationQuery: true,
    title: "Network Device Set By",
    description:
      "Who set Network Device: Automatic (OneUptime, by the address the monitor checks seen from its probes) or Person. OneUptime updates an automatic one when the monitor's probes change, and never one a person set. Empty on a monitor tied before this was recorded.",
    example: "Automatic",
    allowedValues: Object.values(NetworkDeviceTieSource),
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public networkDeviceTieSource?: NetworkDeviceTieSource | null = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "networkAlertPolicyId",
    type: TableColumnType.Entity,
    // Lazy: NetworkAlertPolicy reaches Monitor through MonitorTemplate.
    modelTypeThunk: () => {
      return NetworkAlertPolicy;
    },
    title: "Network Alert Policy",
    description:
      "The Network Alert Policy that provisioned this monitor, when one did. A policy owns the monitors it creates: it removes them when a device leaves the policy's scope or the policy is deleted, and it never touches monitors it did not create. System-managed.",
  })
  @ManyToOne(
    () => {
      return NetworkAlertPolicy;
    },
    {
      eager: false,
      nullable: true,
      /*
       * Deleting a policy deletes its monitors through the engine, with
       * lifecycle hooks. SET NULL is only the backstop for a monitor the
       * engine could not reach: it becomes an ordinary auto-provisioned
       * monitor rather than a dangling reference.
       */
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "networkAlertPolicyId" })
  public networkAlertPolicy?: NetworkAlertPolicy = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Network Alert Policy ID",
    description:
      "ID of the Network Alert Policy that provisioned this monitor, when one did",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public networkAlertPolicyId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.MonitorType,
    title: "Monitor Type",
    description: "What is the type of this monitor? Website? API? etc.",
    example: "API",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public monitorType?: MonitorType = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "currentMonitorStatusId",
    type: TableColumnType.Entity,
    modelType: MonitorStatus,
    title: "Current Monitor Status",
    description: "Whats the current status of this monitor?",
  })
  @ManyToOne(
    () => {
      return MonitorStatus;
    },
    {
      eager: false,
      nullable: true,
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "currentMonitorStatusId" })
  public currentMonitorStatus?: MonitorStatus = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    isDefaultValueColumn: true,
    title: "Current Monitor Status ID",
    description: "Whats the current status ID of this monitor?",
    canReadOnRelationQuery: true,
    example: "c3d4e5f6-a7b8-9012-cdef-345678901234",
    /*
     * The status a new monitor starts in may be picked; its checks move it
     * from there (an update changes it by hand, through a status timeline
     * row: MonitorService.onUpdateSuccess). The providers send it to create
     * the monitor only (#9985).
     */
    serverOwned: ServerOwned.AfterCreate,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public currentMonitorStatusId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    type: TableColumnType.MonitorSteps,
    required: false,
    title: "Monitor Steps",
    description:
      "What the monitor checks, and the criteria that judge each result. The Dashboard shows a step's criteria on the monitor's Criteria page.",
    /*
     * Never readable through a relation (#10309). A monitor's steps are the
     * whole of what it checks: its URLs, request headers and bodies, the
     * queries it runs and the criteria that judge them. As a label, every
     * reader of a record that names a monitor read them through it - an
     * incident's, an alert's, a maintenance event's, a log's, a rule's,
     * a status page resource's: the Incident, Alert, Scheduled Maintenance,
     * On-Call, Status Page and Telemetry tiers and every custom role that
     * reads one of those, through 44 relations, while the monitor keeps its
     * own read to its readers. Held to its own read through a relation, it
     * would still be read whole by a team limited to some monitors' labels
     * (a relation does not weigh the labels of the records it joins), so it
     * is read on the monitor itself, by the monitor's own read: the Root
     * Cause card and an Affected Resource's commands read the steps of the
     * monitor they chart from there, only when they use them
     * (Dashboard: Components/Monitor/ReadMonitorSteps.ts). OneUptime's own
     * reads (the probe's, an investigation's) are root and read it as
     * before.
     */
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
    // A browser build declares it without the monitor types (issue #8821).
    transformer: MonitorStepsColumnTransformer,
  })
  public monitorSteps?: MonitorSteps = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Monitoring Interval",
    description:
      'How often would you like OneUptime to monitor this resource? A 5-field cron expression, not a label: "*/5 * * * *" is every five minutes.',
    example: "*/5 * * * *",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public monitoringInterval?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.JSON,
    title: "Custom Fields",
    description: "Custom Fields on this resource.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public customFields?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Boolean,
    computed: true,
    hideColumnInDocumentation: true,
    required: true,
    isDefaultValueColumn: true,
    title: "Are Owners Notified Of Resource Creation?",
    description: "Are owners notified of when this resource is created?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isOwnerNotifiedOfResourceCreation?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    /*
     * Turning a monitor's checks off and on again is an edit of the monitor,
     * so it takes what any other edit takes: the monitor's own update list.
     */
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    isDefaultValueColumn: true,
    /*
     * Read with a record that names the monitor - a network device bound to
     * it, a network link it watches - as with its current status: while
     * its monitoring is off that status is frozen, and what reads the
     * record must be able to tell (Utils/Monitor/MonitoringOff).
     */
    canReadOnRelationQuery: true,
    title: "Disable Monitoring",
    description: "Disable active monitoring for this resource?",
    defaultValue: false,
    example: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public disableActiveMonitoring?: boolean = undefined;

  /*
   * Whether the incidents and alerts this monitor opens keep the content of
   * the check that opened them: the excerpt of the response around what a
   * filter matched, the values a JavaScript expression read, and the
   * response or request body in their monitor summary. Credentials and
   * personal data are masked either way (MonitorEvidenceRedaction); this
   * is for a monitor whose responses are sensitive in themselves. Website,
   * API and Incoming Request monitors offer it (MonitorRecordEvidence).
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    isDefaultValueColumn: true,
    title: "Keep Response Content",
    description:
      "Keep the response part that matched, and the response body and headers, in this monitor's logs and on its incidents and alerts. Secrets are masked either way.",
    defaultValue: true,
    example: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public keepResponseContent?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    isDefaultValueColumn: false,
    title:
      "When was the last time we checked the heartbeat for incoming request?",
    description:
      "This field is for Incoming Request monitor only. When was the last time we checked the heartbeat?",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public incomingRequestMonitorHeartbeatCheckedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    isDefaultValueColumn: false,
    title: "Telemetry Monitor Next Monitor At",
    description:
      "This field is for Telemetry Monitor only. When is the next time we should monitor?",
    // Every evaluation of the monitor moves it (#9985).
    serverOwned: ServerOwned.Always,
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public telemetryMonitorNextMonitorAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    isDefaultValueColumn: false,
    title: "Telemetry Monitor Last Monitor At",
    description:
      "This field is for Telemetry Monitor only. When was the last time we monitored?",
    // Every evaluation of the monitor moves it (#9985).
    serverOwned: ServerOwned.Always,
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public telemetryMonitorLastMonitorAt?: Date = undefined;

  /*
   * When something first measured the monitor: a probe's check result, a
   * heartbeat, an email or a server agent's report that arrived, or an
   * evaluation of its telemetry, its network device or the probes it
   * watches. Stamped once, by MonitorResourceUtil.monitorResource
   * (Server/Utils/Monitor/MonitorFirstMeasured); a heartbeat sweep that
   * only judges what has not arrived measures nothing and stamps nothing.
   *
   * NULL while nothing has. Until then the status the monitor holds is the
   * operational one every monitor is created in (MonitorService), which no
   * check stands behind, so the Monitors list, the Monitor List widget and
   * status pages say it is waiting for its first check instead of
   * Operational (Utils/Monitor/MonitorFirstCheck, issue #8899).
   *
   * A manual monitor holds the time it was created (MonitorService
   * .onCreateSuccess): nothing checks it, and its status is the one a person
   * sets, from the start. So "measured" is one column to ask a list for -
   * the Monitor List widget's "operational" filter asks it NOT NULL - and
   * the rule that reads a row never takes a manual monitor for one that is
   * waiting, stamped or not.
   *
   * A monitor measured before this column existed was stamped by the
   * upgrade (BackfillMonitorFirstMeasuredAt) with the time it was created:
   * the upgrade knows it had been measured, not when first, and its first
   * check came after that. Its history stays as measured as it always was.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    isDefaultValueColumn: false,
    /*
     * Readable through a relation, as isArchived is: an SLO reads whether its
     * monitors have been measured yet through itself, for its notice banner's
     * "Waiting for the first check" (SLO_MONITOR_FIRST_CHECK_SELECT).
     */
    canReadOnRelationQuery: true,
    title: "First Measured At",
    description:
      "When a check result, heartbeat, email, agent report or evaluation first reached this monitor. Empty while nothing has measured it yet: its status is then only the one every monitor is created in. A manual monitor, whose status a person sets, holds the time it was created.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public firstMeasuredAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    isDefaultValueColumn: true,
    /*
     * Readable through a relation, as disableActiveMonitoring is: what reads a
     * monitor through another record - an SLO's notice banner - must be able to
     * tell why it is paused (MONITOR_PAUSE_FLAGS_SELECT).
     */
    canReadOnRelationQuery: true,
    title: "Disable Monitoring because of Ongoing Maintenance Event",
    description: "Disable Monitoring because of Ongoing Maintenance Event",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public disableActiveMonitoringBecauseOfScheduledMaintenanceEvent?: boolean =
    undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: true,
    isDefaultValueColumn: true,
    /*
     * Readable through a relation, as disableActiveMonitoring is: what reads a
     * monitor through another record - an SLO's notice banner - must be able to
     * tell why it is paused (MONITOR_PAUSE_FLAGS_SELECT).
     */
    canReadOnRelationQuery: true,
    title: "Disable Monitoring because of Manual Incident",
    description:
      "Disable Monitoring because of Incident which is creeated manually by user.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public disableActiveMonitoringBecauseOfManualIncident?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    isDefaultValueColumn: false,
    title: "Server Monitor Request Received At",
    description:
      "This field is for Server Monitor only. When was the last time we received a request?",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public serverMonitorRequestReceivedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    /*
     * Gated on the ability to ROTATE the secret, not on the ability to view
     * the monitor: this read list is deliberately identical to the update list
     * below. A holder of this key can authenticate as any host
     * agent reporting to the monitor -- forging or suppressing heartbeats.
     *
     * Viewer, MonitorViewer and ReadProjectMonitor used to be here. Viewer is
     * the least privilege OneUptime grants and is what gets handed to
     * dashboards, auditors, contractors and automations, so "read-only" also
     * meant "can read a live bearer credential".
     * https://github.com/OneUptime/oneuptime/issues/3360
     */
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @Index()
  @TableColumn({
    secret: true,
    encrypted: true,
    presentedKey: true,
    lookupHashColumn: "serverMonitorSecretKeyHash",
    type: TableColumnType.ObjectID,
    required: false,
    isDefaultValueColumn: false,
    computed: true,
    title: "Server Monitor Secret Key",
    description:
      "This field is for Server Monitor only. Secret Key to authenticate the request.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public serverMonitorSecretKey?: ObjectID = undefined;

  /*
   * The lookup hash of serverMonitorSecretKey, the key a
   * server's agent reports with (#9012).
   * The key is kept encrypted, which no query can find by its value, so
   * a request that presents it is matched by this hash
   * (DatabaseService.findOneByPresentedKey), then held to the key itself.
   * OneUptime writes it with every write of the key.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.HashedString,
    computed: true,
    hideColumnInDocumentation: true,
    title: "Server Monitor Secret Key Hash",
    description:
      "The lookup hash of serverMonitorSecretKey, which a request that presents the key finds this record by. OneUptime writes it with every write of the key; nobody reads or writes it through the API.",
  })
  @Column({
    type: ColumnType.HashedString,
    length: ColumnLength.HashedString,
    nullable: true,
    transformer: HashedString.getDatabaseTransformer(),
  })
  public serverMonitorSecretKeyHash?: HashedString = undefined;

  @ColumnAccessControl({
    create: [],
    /*
     * Gated on the ability to ROTATE the secret, not on the ability to view
     * the monitor: this read list is deliberately identical to the update list
     * below. This key IS the heartbeat URL: a holder can beat the
     * monitor and keep a dead service looking alive.
     *
     * Viewer, MonitorViewer and ReadProjectMonitor used to be here. Viewer is
     * the least privilege OneUptime grants and is what gets handed to
     * dashboards, auditors, contractors and automations, so "read-only" also
     * meant "can read a live bearer credential".
     * https://github.com/OneUptime/oneuptime/issues/3360
     */
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @Index()
  @TableColumn({
    secret: true,
    encrypted: true,
    presentedKey: true,
    lookupHashColumn: "incomingRequestSecretKeyHash",
    type: TableColumnType.ObjectID,
    required: false,
    isDefaultValueColumn: false,
    computed: true,
    title: "Incoming Request Secret Key",
    description:
      "This field is for Incoming Request Monitor only. Secret Key to authenticate the request.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incomingRequestSecretKey?: ObjectID = undefined;

  /*
   * The lookup hash of incomingRequestSecretKey, the key in
   * the heartbeat URL (#9012).
   * The key is kept encrypted, which no query can find by its value, so
   * a request that presents it is matched by this hash
   * (DatabaseService.findOneByPresentedKey), then held to the key itself.
   * OneUptime writes it with every write of the key.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.HashedString,
    computed: true,
    hideColumnInDocumentation: true,
    title: "Incoming Request Secret Key Hash",
    description:
      "The lookup hash of incomingRequestSecretKey, which a request that presents the key finds this record by. OneUptime writes it with every write of the key; nobody reads or writes it through the API.",
  })
  @Column({
    type: ColumnType.HashedString,
    length: ColumnLength.HashedString,
    nullable: true,
    transformer: HashedString.getDatabaseTransformer(),
  })
  public incomingRequestSecretKeyHash?: HashedString = undefined;

  // this is for incoming request monitor.

  /*
   * The latest request as people read it: cut as the monitor's logs are,
   * and without its headers and body when the monitor keeps no request
   * content (LatestIncomingRequest). The request as it came is the column
   * below, which only the server reads.
   *
   * Only the server writes it, from each request the monitor receives
   * (MonitorResource, LatestIncomingRequest), so nobody may create or
   * update it through the API: a create that carries one is refused, as an
   * update is. It is not marked computed, and needs no exception: the
   * server's writes of it make no create.
   * https://github.com/OneUptime/oneuptime/issues/6541
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Incoming Monitor Request",
    description:
      "The latest request this monitor received, as its logs keep it: secrets masked, and no headers or body when it keeps no request content.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public incomingMonitorRequest?: IncomingMonitorRequest = undefined;

  /*
   * The latest request as it came - only the monitor's own key masked, at
   * ingest - for the heartbeat job, which judges it again (CheckHeartbeat):
   * a filter on its body or on a header needs what the sender sent. No role
   * reads it, so the API, exports, MCP, Terraform and the audit log leave it
   * out; people read the copy above (LatestIncomingRequest).
   *
   * Not marked computed: no create's steps write it, so it needs nothing
   * of the column check but its empty lists - a create that carries it is
   * refused, as an update is. Only the server's own hook-free writes set it
   * (MonitorResource, LatestIncomingRequest).
   * https://github.com/OneUptime/oneuptime/issues/6402
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    canReadOnRelationQuery: false,
    title: "Incoming Monitor Request As Received",
    description:
      "The latest request as it came, for the heartbeat check to judge again. Only the server reads it.",
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public incomingMonitorRequestAsReceived?: IncomingMonitorRequest = undefined;

  /*
   * Whether this Incoming Request monitor's senders send one of the project's
   * incoming request secrets (issue #8498): when a request with one last
   * came, when one without came, and why that one had none. Written by the
   * ingest path alone - the endpoint for a request it refuses, the worker for
   * every request it processes - and only while the project has a secret,
   * at most once per monitor every five minutes
   * (IncomingRequestSecretActivity), hence `create: []` and `update: []`.
   * Monitors > Settings > Incoming Request Secrets lists the monitors that
   * received a request without a valid secret in the last day, so an admin
   * knows which senders to fix before requiring one; the monitor's heartbeat
   * URL says its requests are refused, or would be. Not marked computed, as
   * incomingMonitorRequestAsReceived is not: a create that carries one is
   * refused.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Request With Secret At",
    description:
      "About when this Incoming Request monitor last received a request that sent one of its project's incoming request secrets, to the nearest five minutes. Empty until one does.",
    example: "2026-11-15T09:30:00Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public incomingRequestWithSecretAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Request Without Secret At",
    description:
      "About when this Incoming Request monitor last received a request without a valid incoming request secret, to the nearest five minutes - refused if its project requires one. Recorded only while the project has a secret.",
    example: "2026-11-15T09:30:00Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public incomingRequestWithoutSecretAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Last Request Without Secret Reason",
    description:
      "Why the request in Last Request Without Secret At had no valid secret: it sent none, or one that is not one of the project's.",
    allowedValues: Object.values(IncomingRequestSecretProblem),
    example: IncomingRequestSecretProblem.NoSecret,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public incomingRequestWithoutSecretReason?: IncomingRequestSecretProblem =
    undefined;

  // Incoming Email Monitor fields

  @ColumnAccessControl({
    create: [],
    /*
     * Gated on the ability to ROTATE the secret, not on the ability to view
     * the monitor: this read list is deliberately identical to the update list
     * below. This key IS the monitor's inbound address: a holder can
     * send mail that the monitor counts as a heartbeat.
     *
     * Viewer, MonitorViewer and ReadProjectMonitor used to be here. Viewer is
     * the least privilege OneUptime grants and is what gets handed to
     * dashboards, auditors, contractors and automations, so "read-only" also
     * meant "can read a live bearer credential".
     * https://github.com/OneUptime/oneuptime/issues/3360
     */
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @Index()
  @TableColumn({
    secret: true,
    encrypted: true,
    presentedKey: true,
    lookupHashColumn: "incomingEmailSecretKeyHash",
    type: TableColumnType.ObjectID,
    required: false,
    isDefaultValueColumn: false,
    computed: true,
    title: "Incoming Email Secret Key",
    description:
      "This field is for Incoming Email Monitor only. Secret Key used to generate unique email address.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incomingEmailSecretKey?: ObjectID = undefined;

  /*
   * The lookup hash of incomingEmailSecretKey, the key in
   * the inbound email address (#9012).
   * The key is kept encrypted, which no query can find by its value, so
   * a request that presents it is matched by this hash
   * (DatabaseService.findOneByPresentedKey), then held to the key itself.
   * OneUptime writes it with every write of the key.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.HashedString,
    computed: true,
    hideColumnInDocumentation: true,
    title: "Incoming Email Secret Key Hash",
    description:
      "The lookup hash of incomingEmailSecretKey, which a request that presents the key finds this record by. OneUptime writes it with every write of the key; nobody reads or writes it through the API.",
  })
  @Column({
    type: ColumnType.HashedString,
    length: ColumnLength.HashedString,
    nullable: true,
    transformer: HashedString.getDatabaseTransformer(),
  })
  public incomingEmailSecretKeyHash?: HashedString = undefined;

  @ColumnAccessControl({
    /*
     * Not settable on create: the column is unique across every project, so
     * letting an import or a duplicated monitor carry it over would fail the
     * copy. Set it on the monitor once it exists.
     */
    create: [],
    /*
     * Same lists as incomingEmailSecretKey, for the same reason: while this is
     * set it IS the monitor's inbound address (it replaces the generated
     * monitor-{secretKey} one), so a holder can send mail the monitor counts
     * as a heartbeat. https://github.com/OneUptime/oneuptime/issues/3360
     */
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    unique: true,
    isDefaultValueColumn: false,
    title: "Incoming Email Custom Address",
    description:
      "This field is for Incoming Email Monitor only. A custom name for this monitor's inbound email address: the part before the @, on the server's inbound email domain. While set, it replaces the generated monitor-{secret key} address. Must be unique across all monitors. Set to null to go back to the generated address.",
    example: "nightly-backups",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
    unique: true,
  })
  public incomingEmailCustomLocalPart?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    isDefaultValueColumn: false,
    title: "Incoming Email Monitor Last Email Received At",
    description:
      "This field is for Incoming Email Monitor only. When was the last email received?",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public incomingEmailMonitorLastEmailReceivedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Incoming Email Monitor Request",
    description:
      "This field is for Incoming Email Monitor only. Last email data received.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public incomingEmailMonitorRequest?: IncomingEmailMonitorRequest = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    isDefaultValueColumn: false,
    title:
      "When was the last time we checked the heartbeat for incoming email?",
    description:
      "This field is for Incoming Email monitor only. When was the last time we checked the heartbeat?",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public incomingEmailMonitorHeartbeatCheckedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Server Monitor Response",
    description: "Server Monitor Response for Server Monitor",
    serverOwned: ServerOwned.Always,
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public serverMonitorResponse?: ServerMonitorResponse = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: false,
    title: "All Probes Disconnected From This Monitor",
    description:
      "All Probes Disconnected From This Monitor. Is this monitor not being monitored?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    default: false,
  })
  public isAllProbesDisconnectedFromThisMonitor?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    required: false,
    title: "No Probe Enabled On This Monitor",
    description:
      "No Probe Enabled On This Monitor. Is this monitor not being monitored?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
    default: false,
  })
  public isNoProbeEnabledOnThisMonitor?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.CreateProjectMonitor,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.MonitorViewer,
      Permission.ReadProjectMonitor,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.MonitorAdmin,
      Permission.MonitorMember,
      Permission.EditProjectMonitor,
    ],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Minimum Probe Agreement",
    description:
      "Minimum number of probes that must agree on a status before the monitor status changes. If null, all enabled and connected probes must agree.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public minimumProbeAgreement?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.JSON,
    title: "Post Updates To Workspace Channel Name",
    description: "Post Updates To Workspace Channel Name",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public postUpdatesToWorkspaceChannels?: Array<NotificationRuleWorkspaceChannel> =
    undefined;
}
