import CephCluster from "./CephCluster";
import StorageArray from "./StorageArray";
import DatabaseServer from "./DatabaseServer";
import DockerHost from "./DockerHost";
import DockerResource from "./DockerResource";
import PodmanHost from "./PodmanHost";
import PodmanResource from "./PodmanResource";
import Host from "./Host";
import IncidentEpisode from "./IncidentEpisode";
import IncidentSeverity from "./IncidentSeverity";
import IncidentState from "./IncidentState";
import KubernetesCluster from "./KubernetesCluster";
import KubernetesContainer from "./KubernetesContainer";
import KubernetesResource from "./KubernetesResource";
import Label from "./Label";
import Monitor from "./Monitor";
import MonitorStatus from "./MonitorStatus";
import OnCallDutyPolicy from "./OnCallDutyPolicy";
import Probe from "./Probe";
import Project from "./Project";
import ProxmoxCluster from "./ProxmoxCluster";
import VMwareVCenter from "./VMwareVCenter";
import IoTFleet from "./IoTFleet";
import DockerSwarmCluster from "./DockerSwarmCluster";
import Service from "./Service";
import ServiceLevelObjective from "./ServiceLevelObjective";
import StatusPage from "./StatusPage";
import User from "./User";
import File from "./File";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OperationalResource from "../../Types/Database/AccessControl/OperationalResource";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import AccessControlColumn from "../../Types/Database/AccessControlColumn";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableMCP from "../../Types/Database/EnableMCP";
import EnableAuditLog from "../../Types/Database/EnableAuditLog";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import MultiTenentQueryAllowed from "../../Types/Database/MultiTenentQueryAllowed";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import InvestigationNotStartedReason from "../../Types/AI/InvestigationNotStartedReason";
import Permission from "../../Types/Permission";
import StatusPageSubscriberNotificationStatus from "../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";
import { TelemetryQuery } from "../../Types/Telemetry/TelemetryQuery";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";

@OperationalResource()
@EnableDocumentation()
@EnableMCP()
@AccessControlColumn("labels")
@MultiTenentQueryAllowed(true)
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.IncidentAdmin,
    Permission.IncidentMember,
    Permission.CreateProjectIncident,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.IncidentAdmin,
    Permission.IncidentMember,
    Permission.IncidentViewer,
    Permission.ReadProjectIncident,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.IncidentAdmin,
    Permission.IncidentMember,
    Permission.DeleteProjectIncident,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.IncidentAdmin,
    Permission.IncidentMember,
    Permission.EditProjectIncident,
  ],
})
@CrudApiEndpoint(new Route("/incident"))
@SlugifyColumn("title", "slug")
@Entity({
  name: "Incident",
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@EnableAuditLog()
@TableMetadata({
  tableName: "Incident",
  singularName: "Incident",
  pluralName: "Incidents",
  icon: IconProp.Alert,
  tableDescription: "Manage incidents for your project",
  enableRealtimeEventsOn: {
    create: true,
    update: true,
    delete: true,
  },
})
@Index(["projectId", "currentIncidentStateId"]) // Active-incident counters on dashboard
export default class Incident extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
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
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
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
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Title",
    description: "Title of this incident",
    example: "Database connection failure in production",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public title?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "Description",
    description:
      "Short description of this incident. This is in markdown and will be visible on the status page.",
    example:
      "Our engineering team is investigating database connectivity issues affecting the main production cluster.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Declared At",
    description: "Date and time when this incident was declared.",
    isDefaultValueColumn: true,
    example: "2024-01-15T09:30:00.000Z",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
    default: () => {
      return "now()";
    },
  })
  public declaredAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Impact Started At",
    description:
      "When customer impact actually began. Left blank until someone records it - never inferred, because a guessed value is worse than no value.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public impactStartedAt?: Date = undefined;

  @Index()
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
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
    example: "database-connection-failure-in-production",
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
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
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
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
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
    create: [],
    read: [],
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
    read: [],
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
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Monitor,
    title: "Monitors",
    description: "List of monitors affected by this incident",
  })
  @ManyToMany(
    () => {
      return Monitor;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentMonitor",
    inverseJoinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public monitors?: Array<Monitor> = undefined; // monitors affected by this incident.

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Host,
    title: "Hosts",
    description: "List of hosts affected by this incident.",
  })
  @ManyToMany(
    () => {
      return Host;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentHost",
    inverseJoinColumn: {
      name: "hostId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public hosts?: Array<Host> = undefined; // hosts affected by this incident.

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: KubernetesCluster,
    title: "Kubernetes Clusters",
    description: "List of Kubernetes clusters affected by this incident.",
  })
  @ManyToMany(
    () => {
      return KubernetesCluster;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentKubernetesCluster",
    inverseJoinColumn: {
      name: "kubernetesClusterId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public kubernetesClusters?: Array<KubernetesCluster> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: KubernetesResource,
    title: "Kubernetes Resources",
    description:
      "List of Kubernetes resources (pods, deployments, nodes, etc.) affected by this incident.",
  })
  @ManyToMany(
    () => {
      return KubernetesResource;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentKubernetesResource",
    inverseJoinColumn: {
      name: "kubernetesResourceId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public kubernetesResources?: Array<KubernetesResource> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: KubernetesContainer,
    title: "Kubernetes Containers",
    description: "List of Kubernetes containers affected by this incident.",
  })
  @ManyToMany(
    () => {
      return KubernetesContainer;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentKubernetesContainer",
    inverseJoinColumn: {
      name: "kubernetesContainerId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public kubernetesContainers?: Array<KubernetesContainer> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: DockerHost,
    title: "Docker Hosts",
    description: "List of Docker hosts affected by this incident.",
  })
  @ManyToMany(
    () => {
      return DockerHost;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentDockerHost",
    inverseJoinColumn: {
      name: "dockerHostId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public dockerHosts?: Array<DockerHost> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: PodmanHost,
    title: "Podman Hosts",
    description: "List of Podman hosts affected by this incident.",
  })
  @ManyToMany(
    () => {
      return PodmanHost;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentPodmanHost",
    inverseJoinColumn: {
      name: "podmanHostId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public podmanHosts?: Array<PodmanHost> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: ProxmoxCluster,
    title: "Proxmox Clusters",
    description: "List of Proxmox clusters affected by this incident.",
  })
  @ManyToMany(
    () => {
      return ProxmoxCluster;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentProxmoxCluster",
    inverseJoinColumn: {
      name: "proxmoxClusterId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public proxmoxClusters?: Array<ProxmoxCluster> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: VMwareVCenter,
    title: "vCenters",
    description: "List of vCenters affected by this incident.",
  })
  @ManyToMany(
    () => {
      return VMwareVCenter;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentVMwareVCenter",
    inverseJoinColumn: {
      name: "vmwareVCenterId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public vmwareVCenters?: Array<VMwareVCenter> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: IoTFleet,
    title: "IoT Fleets",
    description: "List of IoT fleets affected by this incident.",
  })
  @ManyToMany(
    () => {
      return IoTFleet;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentIoTFleet",
    inverseJoinColumn: {
      name: "iotFleetId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public iotFleets?: Array<IoTFleet> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: DockerSwarmCluster,
    title: "Docker Swarm Clusters",
    description: "List of Docker Swarm clusters affected by this incident.",
  })
  @ManyToMany(
    () => {
      return DockerSwarmCluster;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentDockerSwarmCluster",
    inverseJoinColumn: {
      name: "dockerSwarmClusterId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public dockerSwarmClusters?: Array<DockerSwarmCluster> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: CephCluster,
    title: "Ceph Clusters",
    description: "List of Ceph clusters affected by this incident.",
  })
  @ManyToMany(
    () => {
      return CephCluster;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentCephCluster",
    inverseJoinColumn: {
      name: "cephClusterId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public cephClusters?: Array<CephCluster> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: StorageArray,
    title: "Storage Arrays",
    description: "List of storage arrays affected by this incident.",
  })
  @ManyToMany(
    () => {
      return StorageArray;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentStorageArray",
    inverseJoinColumn: {
      name: "storageArrayId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public storageArrays?: Array<StorageArray> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: DatabaseServer,
    title: "Databases",
    description: "List of databases affected by this incident.",
  })
  @ManyToMany(
    () => {
      return DatabaseServer;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentDatabaseServer",
    inverseJoinColumn: {
      name: "databaseServerId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public databaseServers?: Array<DatabaseServer> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: DockerResource,
    title: "Docker Resources",
    description:
      "List of Docker resources (containers, images, networks, volumes) affected by this incident.",
  })
  @ManyToMany(
    () => {
      return DockerResource;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentDockerResource",
    inverseJoinColumn: {
      name: "dockerResourceId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public dockerResources?: Array<DockerResource> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: PodmanResource,
    title: "Podman Resources",
    description:
      "List of Podman resources (containers, images, networks, volumes) affected by this incident.",
  })
  @ManyToMany(
    () => {
      return PodmanResource;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentPodmanResource",
    inverseJoinColumn: {
      name: "podmanResourceId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public podmanResources?: Array<PodmanResource> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Service,
    title: "Services",
    description: "List of services affected by this incident.",
  })
  @ManyToMany(
    () => {
      return Service;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentService",
    inverseJoinColumn: {
      name: "serviceId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public services?: Array<Service> = undefined;

  /*
   * The SLOs this incident is about. An SLO burn rate rule attaches its own
   * SLO when it declares the incident, which is what lets the incident name
   * the objective it was declared for and the SLO list the incidents it
   * caused - before this, the only link was an opaque seriesFingerprint.
   *
   * Only the SLO is linked, never the SLO's monitors: resolving an incident
   * that carries monitors rewrites their status timeline, which is the very
   * history the SLI is computed from. Same column ACL as `services`.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: ServiceLevelObjective,
    title: "Service Level Objectives",
    description:
      "List of Service Level Objectives (SLOs) affected by this incident.",
  })
  @ManyToMany(
    () => {
      return ServiceLevelObjective;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentServiceLevelObjective",
    inverseJoinColumn: {
      name: "serviceLevelObjectiveId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public serviceLevelObjectives?: Array<ServiceLevelObjective> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: OnCallDutyPolicy,
    title: "On-Call Duty Policies",
    description: "List of on-call duty policies affected by this incident.",
  })
  @ManyToMany(
    () => {
      return OnCallDutyPolicy;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentOnCallDutyPolicy",
    inverseJoinColumn: {
      name: "onCallDutyPolicyId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public onCallDutyPolicies?: Array<OnCallDutyPolicy> = undefined; // on-call duty policies affected by this incident.

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
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
    name: "IncidentLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "currentIncidentStateId",
    type: TableColumnType.Entity,
    computed: true,
    modelType: IncidentState,
    title: "Current Incident State",
    description:
      "Current state of this incident. Is the incident acknowledged? or resolved?. This is related to Incident State",
  })
  @ManyToOne(
    () => {
      return IncidentState;
    },
    {
      eager: false,
      nullable: true,
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "currentIncidentStateId" })
  public currentIncidentState?: IncidentState = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    isDefaultValueColumn: true,
    required: true,
    canReadOnRelationQuery: true,
    title: "Current Incident State ID",
    description: "Current Incident State ID",
    example: "d4e5f6a7-b8c9-0123-defg-456789012345",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public currentIncidentStateId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentSeverityId",
    type: TableColumnType.Entity,
    modelType: IncidentSeverity,
    title: "Incident Severity",
    description:
      "How severe is this incident. Is it critical? or a minor incident?. This is related to Incident Severity.",
  })
  @ManyToOne(
    () => {
      return IncidentSeverity;
    },
    {
      eager: false,
      nullable: true,
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentSeverityId" })
  public incidentSeverity?: IncidentSeverity = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Incident Severity ID",
    description: "Incident Severity ID",
    example: "e5f6a7b8-c9d0-1234-efgh-567890123456",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentSeverityId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "changeMonitorStatusToId",
    type: TableColumnType.Entity,
    modelType: MonitorStatus,
    title: "Change Monitor Status To",
    description:
      "Relation to Monitor Status Object. All monitors connected to this incident will be changed to this status when the incident is created.",
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
  @JoinColumn({ name: "changeMonitorStatusToId" })
  public changeMonitorStatusTo?: MonitorStatus = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Change Monitor Status To ID",
    description:
      "Relation to Monitor Status Object ID. All monitors connected to this incident will be changed to this status when the incident is created.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public changeMonitorStatusToId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    computed: true,
    hideColumnInDocumentation: true,
    type: TableColumnType.ShortText,
    title: "Subscriber Notification Status",
    description:
      "Status of notification sent to subscribers about this incident",
    defaultValue: StatusPageSubscriberNotificationStatus.Pending,
  })
  @Index()
  @Column({
    type: ColumnType.ShortText,
    default: StatusPageSubscriberNotificationStatus.Pending,
  })
  public subscriberNotificationStatusOnIncidentCreated?: StatusPageSubscriberNotificationStatus =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    computed: true,
    type: TableColumnType.VeryLongText,
    title: "Notification Status Message",
    description:
      "Status message for subscriber notifications - includes success messages, failure reasons, or skip reasons",
    required: false,
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public subscriberNotificationStatusMessage?: string = undefined;

  /*
   * When a subscriber job last claimed the 'incident created' notification
   * (SubscriberNotificationClaim), which the sweeper
   * (StatusPageSubscriber:TimeoutStuckNotifications) times a notification
   * still In progress from. Not updatedAt: other code writes this row on a
   * schedule while the incident is open - the owners' reminders, state
   * changes, scope and field edits - so updatedAt could keep an interrupted
   * send from ever looking stuck, and Retry, Resend and the added-pages
   * notification all wait for it to settle. Written by the claim only;
   * nobody reads or writes it through the API.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    computed: true,
    hideColumnInDocumentation: true,
    required: false,
    type: TableColumnType.Date,
    title: "Subscriber Notification Claimed At on Incident Created",
    description:
      "When a subscriber notification job last started sending the notification that this incident was created.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public subscriberNotificationClaimedAtOnIncidentCreated?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    computed: true,
    hideColumnInDocumentation: true,
    type: TableColumnType.ShortText,
    title: "Subscriber Notification Status on Postmortem Published",
    description:
      "Status of notification sent to subscribers about this incident postmortem",
    defaultValue: StatusPageSubscriberNotificationStatus.Pending,
  })
  @Index()
  @Column({
    type: ColumnType.ShortText,
    default: StatusPageSubscriberNotificationStatus.Pending,
  })
  public subscriberNotificationStatusOnPostmortemPublished?: StatusPageSubscriberNotificationStatus =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    computed: true,
    type: TableColumnType.VeryLongText,
    title: "Notification Status Message on Postmortem Published",
    description:
      "Status message for subscriber notifications on postmortem published - includes success messages, failure reasons, or skip reasons",
    required: false,
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public subscriberNotificationStatusMessageOnPostmortemPublished?: string =
    undefined;

  /*
   * When a subscriber job last claimed the postmortem notification
   * (SubscriberNotificationClaim), which the sweeper
   * (StatusPageSubscriber:TimeoutStuckNotifications) times a notification
   * still In progress from. Not updatedAt: other code writes this row on a
   * schedule while the incident is open - the owners' reminders, state
   * changes, scope and field edits - so updatedAt could keep an interrupted
   * send from ever looking stuck, and Retry, Resend and the added-pages
   * notification all wait for it to settle. Written by the claim only;
   * nobody reads or writes it through the API.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    computed: true,
    hideColumnInDocumentation: true,
    required: false,
    type: TableColumnType.Date,
    title: "Subscriber Notification Claimed At on Postmortem Published",
    description:
      "When a subscriber notification job last started sending the notification about this incident's postmortem.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public subscriberNotificationClaimedAtOnPostmortemPublished?: Date =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Should subscribers be notified?",
    description: "Should subscribers be notified about this incident?",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public shouldStatusPageSubscribersBeNotifiedOnIncidentCreated?: boolean =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.JSON,
    title: "Custom Fields",
    description:
      "The incident's custom field values, keyed by each incident custom field's name. When a user or an API key creates or updates an incident, each value it sets or changes must fit its field - a number for a Number field, true or false for a Boolean, one of the options for a Dropdown, and so on - or the request is refused. Values left as they were, keys that are not the name of a field and empty values are not checked. Required on Create is not enforced here: it applies to the dashboard's Declare Incident form only.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public customFields?: JSONObject = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "AI Investigation Decision",
    description:
      "Internal: the reason automatic AI investigation did not start when this record was created.",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public aiInvestigationDecision?: InvestigationNotStartedReason = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
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
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    type: TableColumnType.Markdown,
    required: false,
    isDefaultValueColumn: false,
    title: "Root Cause",
    description: "What is the root cause of this incident?",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: true,
  })
  public rootCause?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    type: TableColumnType.Markdown,
    required: false,
    isDefaultValueColumn: false,
    title: "Postmortem Note",
    description: "Document the postmortem summary for this incident.",
  })
  @Column({
    type: ColumnType.Markdown,
    nullable: true,
  })
  public postmortemNote?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Show postmortem on status page?",
    description:
      "Should the postmortem note and attachments be visible on the status page once published?",
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public showPostmortemOnStatusPage?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    title: "Notify Subscribers on Postmortem Published",
    description:
      "Should subscribers be notified when the postmortem is published?",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
  })
  public notifySubscribersOnPostmortemPublished?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    type: TableColumnType.Date,
    title: "Postmortem Posted At",
    description:
      "Timestamp that will be shown alongside the published postmortem on the status page.",
    required: false,
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public postmortemPostedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    type: TableColumnType.EntityArray,
    modelType: File,
    title: "Postmortem Attachments",
    description:
      "Files that accompany the postmortem note and can be shared publicly when enabled.",
    required: false,
  })
  @ManyToMany(() => {
    return File;
  })
  @JoinTable({
    name: "IncidentPostmortemAttachmentFile",
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
    inverseJoinColumn: {
      name: "fileId",
      referencedColumnName: "_id",
    },
  })
  public postmortemAttachments?: Array<File> = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.JSON,
    computed: true,
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
    unique: false,
  })
  public createdStateLog?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    isDefaultValueColumn: false,
    title: "Created Criteria ID",
    description:
      "If this incident was created by a Probe, this is the ID of the criteria that created it.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
  })
  public createdCriteriaId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    isDefaultValueColumn: false,
    title: "Created Incident Template ID",
    description:
      "If this incident was created by a Probe, this is the ID of the incident template that was used for creation.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
  })
  public createdIncidentTemplateId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    isDefaultValueColumn: false,
    title: "Series Fingerprint",
    description:
      "For metric monitors with per-series alerting (e.g. grouped by host.name), this is a stable hash of the series label values so one incident is created per affected series.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
  })
  public seriesFingerprint?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    isDefaultValueColumn: false,
    title: "Series Labels",
    description:
      "Attribute key/value pairs that identify the affected series (e.g. {host.name: prod-db-01}) when this incident was created from a per-series metric breach.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public seriesLabels?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    isDefaultValueColumn: false,
    computed: true,
    title: "Monitor Summary",
    description:
      "The monitor summary captured at the moment this incident was created - the same card the monitor page shows, frozen so it survives the monitor log being aged out.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public monitorSummary?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByProbeId",
    type: TableColumnType.Entity,
    modelType: Probe,
    title: "Created By Probe",
    description:
      "If this incident was created by a Probe, this is the probe that created it.",
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
  @JoinColumn({ name: "createdByProbeId" })
  public createdByProbe?: Probe = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Created By Probe ID",
    description:
      "If this incident was created by a Probe, this is the ID of the probe that created it.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByProbeId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Is created automatically?",
    description:
      "Is this incident created by OneUptime Probe or Workers automatically (and not created manually by a user)?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
  })
  public isCreatedAutomatically?: boolean = undefined;

  /*
   * Whether the incident holds its monitors, recorded by OneUptime: true
   * from when it is declared open, or from when an edit while it is open
   * puts its monitors in its monitor status; false for one declared already
   * resolved, which never held them, and from when a resolve gives them
   * back. Resolving gives back only what it holds - so an incident declared
   * resolved, reopened and resolved again gives back nothing it never had.
   * Null for incidents from before it was recorded: their resolve gives the
   * monitors back, as it always did, and records false.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    computed: true,
    type: TableColumnType.Boolean,
    title: "Holds Monitors",
    description:
      "Whether this incident is holding its monitors - keeping them in its monitor status, or their monitoring paused - so that resolving it gives them back: their monitoring resumes and their status returns to operational. True from when the incident is declared open, or from when an edit while it is open puts its monitors in its monitor status. False for an incident declared already resolved, which never held them, and once a resolve has given them back. Empty for incidents from before it was recorded, which give their monitors back when they are resolved. Set by OneUptime; it cannot be written.",
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: true,
  })
  public holdsMonitors?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Markdown,
    title: "Remediation Notes",
    description:
      "Notes on how to remediate this incident. This is in markdown.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Markdown,
  })
  public remediationNotes?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.JSON,
    title: "Telemetry Query",
    description: "Telemetry query for this incident",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public telemetryQuery?: TelemetryQuery = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.Number,
    title: "Incident Number",
    description: "Incident Number",
    computed: true,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public incidentNumber?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @TableColumn({
    isDefaultValueColumn: false,
    required: false,
    type: TableColumnType.ShortText,
    title: "Incident Number With Prefix",
    description: "Incident number with prefix (e.g., 'INC-42' or '#42')",
    computed: true,
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public incidentNumberWithPrefix?: string = undefined;

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

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Should be visible on status page?",
    description: "Should this incident be visible on the status page?",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
    nullable: true,
  })
  public isVisibleOnStatusPage?: boolean = undefined;

  /*
   * The status pages this incident is limited to. An incident reaches a
   * status page through its monitors: every page that lists one of them shows
   * it and notifies its subscribers. So a monitor shared by ten site pages
   * used to tell all ten sites about an outage that affects two. Picking
   * pages here narrows that: a scoped incident shows on, and notifies, only
   * the selected pages among those its monitors already reach (the two sets
   * intersect - a scope never puts an incident on a page that does not list
   * its monitors). Empty means unscoped: every page its monitors reach, as
   * before. Status pages that only show scoped incidents
   * (StatusPage.onlyShowScopedIncidents) never show an unscoped one.
   *
   * Shaped like ScheduledMaintenance.statusPages, with the access control of
   * the monitors list above. Whether an incident is scoped is kept separately
   * in isScopedToStatusPages, so the status page queries can filter on it.
   *
   * Like the monitors list, the pages are part of the incident: anyone who
   * can read it sees their names (StatusPage.name is readable on a relation
   * query), whether or not they can read those status pages. Picking a page
   * needs read access to it (StatusPageReadAccess).
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: StatusPage,
    title: "Status Pages",
    description:
      "Limit this incident to these status pages. When set, the incident is shown on, and notifies the subscribers of, only these pages among the status pages that list its monitors. Leave empty to reach every status page that lists its monitors.",
  })
  @ManyToMany(
    () => {
      return StatusPage;
    },
    { eager: false },
  )
  @JoinTable({
    name: "IncidentStatusPage",
    inverseJoinColumn: {
      name: "statusPageId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "incidentId",
      referencedColumnName: "_id",
    },
  })
  public statusPages?: Array<StatusPage> = undefined;

  /*
   * Whether this incident is limited to the status pages in statusPages. The
   * status page queries split on it (unscoped incidents by monitor, scoped
   * ones by monitor AND page), which keeps the scope in SQL rather than in a
   * post-filter that a LIMIT could silently cut.
   *
   * IncidentService derives it from writes to statusPages and ignores any
   * value a client sends. It is deliberately never recomputed when join rows
   * disappear: deleting the only status page an incident is scoped to
   * cascades its join row away, and the incident stays scoped - to nothing -
   * so it is hidden everywhere rather than widened to every page its monitors
   * reach.
   *
   * Computed, so a client cannot set it on create. Its update access control
   * matches statusPages all the same: the service writes it into the caller's
   * own update, and the column check that runs after the hook exempts computed
   * columns only on create.
   *
   * Not indexed. It is false on nearly every row, so an index cannot help the
   * unscoped half of those queries, and the scoped half reaches its incidents
   * through the IncidentStatusPage join table's statusPageId index. Building
   * one would also have held the lock of the migration's ALTER TABLE on
   * Incident - reads included - for as long as it took on a large table.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    computed: true,
    hideColumnInDocumentation: true,
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Scoped To Status Pages",
    description:
      "Whether this incident is limited to the status pages in Status Pages. Derived from Status Pages; any value sent for it is ignored.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isScopedToStatusPages?: boolean = undefined;

  /*
   * The ids of the status pages whose subscribers were sent this incident's
   * 'created' notification. A status page added to the scope later can then
   * be told exactly once, without telling the pages that already heard.
   *
   * The Incident:SendNotificationToSubscribers job writes it as root, once per
   * send, with the status it settles on. It is computed and never taken from
   * a client; its update access control matches
   * subscriberNotificationStatusOnIncidentCreated so IncidentService can write
   * it inside the caller's own update: it empties it when the update resends
   * the notification to every page (the status set back to Pending), and when
   * pages are added to an incident whose notification was skipped, it lists
   * the pages the incident was limited to before, which were deliberately not
   * told, so only the added ones are (see IncidentScopeAddedPagesNotification).
   *
   * Null means no send has settled since the column was added: an incident
   * whose notification went out before then has no record, and pages added to
   * it are not sent the notification again.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    required: false,
    computed: true,
    hideColumnInDocumentation: true,
    type: TableColumnType.JSON,
    title: "Status Pages Notified On Creation",
    description:
      "IDs of the status pages whose subscribers were sent the notification that this incident was created.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public statusPagesNotifiedOnCreation?: Array<string> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @Index()
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Is Private?",
    description:
      "If true, this incident is only visible to its owners (users in 'owner users' and members of 'owner teams'), project admins, and project owners. Private incidents are hidden from status pages.",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    default: false,
    nullable: true,
  })
  public isPrivate?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Send Reminders?",
    description:
      "Should reminder notifications be sent to owners while this incident is still open? Reminders are sent based on the reminder rules configured for this project.",
    defaultValue: true,
  })
  @Column({
    type: ColumnType.Boolean,
    default: true,
    nullable: true,
  })
  public enableReminders?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    isDefaultValueColumn: false,
    title: "Next Reminder Notification At",
    description:
      "When will the next reminder notification be sent to owners of this incident? This is set automatically based on the reminder rules configured for this project.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public nextReminderNotificationAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    isDefaultValueColumn: false,
    title: "Reminder Notifications Sent Count",
    description:
      "How many reminder notifications have been sent to owners of this incident so far.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public reminderNotificationSentCount?: number = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "incidentEpisodeId",
    type: TableColumnType.Entity,
    modelType: IncidentEpisode,
    title: "Incident Episode",
    description: "Relation to Incident Episode this incident belongs to",
  })
  @ManyToOne(
    () => {
      return IncidentEpisode;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incidentEpisodeId" })
  public incidentEpisode?: IncidentEpisode = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.CreateProjectIncident,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.IncidentViewer,
      Permission.ReadProjectIncident,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.IncidentAdmin,
      Permission.IncidentMember,
      Permission.EditProjectIncident,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Incident Episode ID",
    description: "ID of the Incident Episode this incident belongs to",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incidentEpisodeId?: ObjectID = undefined;
}
