import DockerSwarmCluster from "./DockerSwarmCluster";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ------------------------------------------------------------------
 *                         DockerSwarmResource
 * ------------------------------------------------------------------
 *
 * Inventory snapshot of a single Docker Swarm object in a single
 * cluster. One wide table holds every kind:
 *
 *   Node    — a manager or worker node in the swarm
 *   Service — a replicated or global swarm service
 *   Task    — a single task (container instance) of a service
 *   Stack   — a deployed compose stack (grouping of services)
 *   Network — a swarm-scoped (overlay) or local network
 *   Secret  — a swarm-managed secret (metadata only; no value)
 *   Config  — a swarm-managed config (metadata only)
 *   Volume  — a volume reported by a node
 *
 * Populated by the telemetry ingest path from the OneUptime Docker
 * Swarm agent's inventory poller (`docker node/service/task/stack/
 * network/secret/config/volume ls`, shipped as JSON-line log records)
 * plus the docker_stats receiver for the per-task latest CPU/memory
 * mirror. The list/detail pages read this table instead of grouping
 * over ClickHouse telemetry.
 *
 * `externalId` is the stable, collision-free id within a cluster and
 * the detail-route param: `node/<id>`, `service/<id>`, `task/<id>`,
 * `stack/<name>`, `network/<id>`, `secret/<id>`, `config/<id>`,
 * `volume/<name>@<nodeId>`.
 *
 * Kind-specific fields that the list/detail pages do not sort or
 * filter on live in the `attributes` JSON column (node availability /
 * managerStatus / engineVersion / addr, network scope / ingress,
 * volume mountpoint, task slot / containerId / message, secret/config
 * createdAt, …) so the schema does not explode across eight kinds.
 *
 * Rows are upserted per snapshot and hard-deleted once lastSeenAt
 * falls behind "now - 15min" for clusters that remain connected.
 * Writes go through DockerSwarmResourceService under isRoot; users
 * never create/update/delete rows directly.
 *
 * ------------------------------------------------------------------
 */

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadDockerSwarmCluster,
];

@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: READ_PERMISSIONS,
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/docker-swarm-resource"))
@TableMetadata({
  tableName: "DockerSwarmResource",
  singularName: "Docker Swarm Resource",
  pluralName: "Docker Swarm Resources",
  icon: IconProp.Cube,
  tableDescription:
    "Snapshot of a Docker Swarm object (node, service, task, stack, network, secret, config or volume) as last reported by the Docker Swarm agent. Populated by the telemetry ingest pipeline; not user-editable.",
})
@Index(["projectId", "dockerSwarmClusterId", "kind", "externalId"], {
  unique: true,
})
@Entity({
  name: "DockerSwarmResource",
})
export default class DockerSwarmResource extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project this resource belongs to.",
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
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the Project this resource belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "dockerSwarmClusterId",
    type: TableColumnType.Entity,
    modelType: DockerSwarmCluster,
    title: "Docker Swarm Cluster",
    description: "Cluster this resource lives in.",
  })
  @ManyToOne(
    () => {
      return DockerSwarmCluster;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "dockerSwarmClusterId" })
  public dockerSwarmCluster?: DockerSwarmCluster = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Docker Swarm Cluster ID",
    description: "ID of the Docker Swarm Cluster this resource lives in.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public dockerSwarmClusterId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Kind",
    description:
      "Docker Swarm resource kind in singular PascalCase: Node, Service, Task, Stack, Network, Secret, Config or Volume.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public kind?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "External ID",
    description:
      "Stable, collision-free id within a cluster (e.g. node/<id>, service/<id>, task/<id>, stack/<name>, network/<id>, volume/<name>@<nodeId>). Also the detail-route param.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public externalId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "Human-friendly name: node hostname, service name, task name (service.slot), stack name, network/secret/config/volume name.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "State",
    description:
      "Latest state word for this kind — Node: ready/down; Task: new/assigned/preparing/running/complete/failed/shutdown/rejected/orphaned; Service/Stack: derived running/replica string; null for kinds without a state.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public state?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Role",
    description: "Node role: manager or worker. Null for non-Node kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public role?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Service Mode",
    description:
      "Service scheduling mode: replicated or global. Null for non-Service kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public serviceMode?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Desired Replicas",
    description:
      "Desired task count for a replicated Service (null for global services and non-Service kinds).",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public desiredReplicas?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Running Replicas",
    description:
      "Count of running tasks for a Service. The numerator of the X/Y replicas badge.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public runningReplicas?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Image",
    description:
      "Container image reference for a Service or Task (e.g. nginx:1.27). Null for other kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public image?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Stack Name",
    description:
      "The com.docker.stack.namespace this Service/Task/Stack belongs to (null for resources not deployed via a stack).",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public stackName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Service Name",
    description:
      "The parent service name for a Task (null for non-Task kinds).",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public serviceName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Node Hostname",
    description:
      "The swarm node a Task is scheduled on, or the node a Volume lives on. Null for kinds without a node placement.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public nodeHostname?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Driver",
    description:
      "Network or Volume driver (overlay / bridge / local / …). Null for other kinds.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public driver?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Ready",
    description:
      "True when this resource is in a healthy steady state — Node ready, Task running, Service fully converged (running == desired). Null for kinds without a readiness notion.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public isReady?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Attributes",
    description:
      "Kind-specific extras the list/detail pages render but do not sort on: node availability/managerStatus/engineVersion/addr/isLeader, network scope/isIngress/isAttachable, volume mountpoint, task slot/containerId/message, secret/config createdAt, stack serviceCount, etc.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public attributes?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Latest CPU Percent",
    description:
      "Most recent CPU utilization percent for a Task (docker_stats container.cpu.utilization * 100), or the aggregate for a Service. Stored as decimal so sub-percent precision survives the round trip. Null until the first metric arrives.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: {
      to: (value: number | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return value;
      },
      from: (value: string | number | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        if (typeof value === "number") {
          return value;
        }
        const parsed: number = parseFloat(value);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public latestCpuPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Latest Memory Bytes",
    description:
      "Most recent memory usage (docker_stats container.memory.usage). Stored as bigint so values past 2 GiB don't overflow.",
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
  public latestMemoryBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.BigPositiveNumber,
    canReadOnRelationQuery: true,
    title: "Max Memory Bytes",
    description:
      "Memory limit for this Task/Service (docker_stats container.memory.limit), the denominator for the memory usage bar. Null when unlimited.",
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
  public maxMemoryBytes?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Latest Memory Percent",
    description:
      "Most recent memory usage as a percent of maxMemoryBytes. Stored as decimal — mirrors latestCpuPercent — so list views can sort/filter without dividing bigints client-side.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: {
      to: (value: number | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        return value;
      },
      from: (value: string | number | null | undefined): number | null => {
        if (value === null || value === undefined) {
          return null;
        }
        if (typeof value === "number") {
          return value;
        }
        const parsed: number = parseFloat(value);
        return isNaN(parsed) ? null : parsed;
      },
    },
  })
  public latestMemoryPercent?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Metrics Updated At",
    description:
      "Observed timestamp of the latest metric point. Acts as the monotonic guard for metric updates and the cutoff for staleness rendering.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public metricsUpdatedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Last Seen At",
    description:
      "Agent-observed timestamp of the most recent snapshot containing this resource. Also acts as the monotonic guard for upserts.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public lastSeenAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description:
      "Not user-facing; ingest writes as isRoot so this stays null in practice.",
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
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who created this row.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Relation to the user who deleted this row.",
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
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: READ_PERMISSIONS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user who deleted this row.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
