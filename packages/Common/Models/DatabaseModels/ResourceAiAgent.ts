import Project from "./Project";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import AiResourceType from "../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAgentConnectionStatus,
  ResourceAiAgentRegistrationRefusalReason,
} from "../../Types/ResourceAiAgent/ResourceAiAccess";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Who may see a resource's AI agent: whoever may read a resource of any of
 * the AiResourceType models (DockerHost, PodmanHost, DockerSwarmCluster,
 * ProxmoxCluster, VMwareVCenter, CephCluster, DatabaseServer, Host) — the
 * roles every one of their read lists shares, plus each model's own Read
 * permission. The table is polymorphic, so no one list can be "exactly the
 * resource's readers" the way KubernetesAiAgent's is the cluster's: the
 * per-type check (the caller may read THIS resource) is the resource AI
 * access API's, which reads the row as root after loading the resource
 * with the caller's permissions. Nobody writes a row through the API — the
 * agent registers and heartbeats through /resource-ai-agent-ingest, and an
 * admin reset goes through the resource AI access API, both as root.
 */
const RESOURCE_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadDockerHost,
  Permission.ReadPodmanHost,
  Permission.ReadDockerSwarmCluster,
  Permission.ReadProxmoxCluster,
  Permission.ReadVMwareVCenter,
  Permission.ReadCephCluster,
  Permission.ReadDatabaseServer,
  Permission.ReadHost,
];

/*
 * The resource AI agent of one infrastructure resource (a Docker or Podman
 * host, a Docker Swarm, Proxmox or Ceph cluster, a vCenter, a database
 * server or a host): the slim executor installed next to the resource's
 * telemetry collector (image oneuptime/resource-ai-agent). Like the
 * Kubernetes AI agent it is deliberately NOT a Runner: it never appears on
 * the Runners page, is never handed a credential (it uses only credentials
 * from its own environment and mounts) and runs nothing but AI resource
 * commands — RunnerJob rows of step type ResourceCommand targeted at it
 * through RunnerJob.targetResourceAiAgentId.
 *
 * One row per resource, keyed by (resourceType, resourceId). resourceId has
 * no foreign key on purpose: it points into a different table for every
 * resourceType. The row goes with its project (ON DELETE CASCADE); nothing
 * ties it to the resource row in the database, so removing it with its
 * resource is the server's job.
 *
 * The agent registers with the project's telemetry ingestion key and
 * receives an agent key; only the key's sha256 is kept (keyHash), and no
 * user can read it. The dashboard reads the row through the resource's AI
 * access status, which is why there is no CRUD API and no API documentation
 * for this table (KubernetesAiAgent and UserProjectSsoConsent are the
 * precedent).
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: RESOURCE_READERS,
  delete: [],
  update: [],
})
/*
 * One agent per live resource, enforced by the database: two agents
 * registering for the same new resource at once must not both create a
 * row. Named, and declared here rather than only in a migration, so
 * TypeORM's schema builder recognises it and never generates a DROP for it.
 */
@Index(
  "IDX_ResourceAiAgent_projectId_resourceType_resourceId",
  ["projectId", "resourceType", "resourceId"],
  {
    unique: true,
    where: '"deletedAt" IS NULL',
  },
)
@TableMetadata({
  tableName: "ResourceAiAgent",
  singularName: "Resource AI Agent",
  pluralName: "Resource AI Agents",
  icon: IconProp.ServerStack,
  tableDescription:
    "The AI agent installed next to an infrastructure resource (a Docker or Podman host, a Docker Swarm, Proxmox or Ceph cluster, a VMware vCenter, a database server or a host): the executor OneUptime AI uses to investigate (and, when allowed, fix) that resource. One per resource. Managed by the server; not user-writable.",
})
@Entity({
  name: "ResourceAiAgent",
})
export default class ResourceAiAgent extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: RESOURCE_READERS,
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
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

  @ColumnAccessControl({
    create: [],
    read: RESOURCE_READERS,
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

  /*
   * Which model resourceId points into: an AiResourceType value, stored as
   * spelled (the enum values are the database contract).
   */
  @ColumnAccessControl({
    create: [],
    read: RESOURCE_READERS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    canReadOnRelationQuery: true,
    title: "Resource Type",
    description:
      "The kind of resource this AI agent runs next to: DockerHost, PodmanHost, DockerSwarmCluster, ProxmoxCluster, VMwareVCenter, CephCluster, DatabaseServer or Host.",
    example: AiResourceType.DockerHost,
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public resourceType?: AiResourceType = undefined;

  /*
   * The resource row (in the table resourceType names). No foreign key: a
   * column can reference only one table.
   */
  @ColumnAccessControl({
    create: [],
    read: RESOURCE_READERS,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Resource ID",
    description:
      "ID of the resource this AI agent runs next to, in the table its resource type names. A resource has at most one agent.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public resourceId?: ObjectID = undefined;

  /*
   * The identity the agent registered with — the one its resource's
   * collector reports (a host name, a cluster name, a database endpoint) —
   * as it last presented it.
   */
  @ColumnAccessControl({
    create: [],
    read: RESOURCE_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.LongText,
    required: false,
    title: "Resource Identifier",
    description:
      "The identity the agent registered its resource with (the host name, cluster name or database endpoint its telemetry collector reports). Set by the server.",
  })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: true,
  })
  public resourceIdentifier?: string = undefined;

  /*
   * sha256 (hex) of the agent key the agent presents on every request after
   * registration. The key itself is never stored. Null after an admin reset:
   * no key matches, so the running agent fails authentication and registers
   * again. Unreadable by every role — even a hash of a bearer credential is
   * nothing the dashboard or the API should hand out.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Key Hash",
    description:
      "SHA-256 of the key the agent authenticates with. Set by the server; never readable.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public keyHash?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: RESOURCE_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Agent Version",
    description:
      "Self-reported version of the resource AI agent. Updated on registration and every heartbeat.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public agentVersion?: string = undefined;

  /*
   * The agent's last reported posture (ResourceAiAgentPosture), always read
   * back through parseResourceAiAgentPosture. The server forces
   * resourceType and resourceIdentifier before storing it.
   */
  @ColumnAccessControl({
    create: [],
    read: RESOURCE_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Posture",
    description:
      "What the agent last reported about itself: whether it may write, the targets it may write to, the targets it never changes, whether it could reach its resource and the resource's version. Set by the server.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public posture?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: RESOURCE_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    canReadOnRelationQuery: true,
    title: "Last Alive At",
    description: "Most recent registration or heartbeat from this agent.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastAliveAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: RESOURCE_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    isDefaultValueColumn: true,
    canReadOnRelationQuery: true,
    title: "Connection Status",
    description:
      "connected while the agent registers and heartbeats; disconnected once it signs off or is reset. It is online only when connected AND its last heartbeat is recent.",
    defaultValue: "disconnected",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    default: "disconnected",
  })
  public connectionStatus?: ResourceAiAgentConnectionStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: RESOURCE_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Registered At",
    description: "When the agent last registered and was issued a key.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastRegisteredAt?: Date = undefined;

  /*
   * The TelemetryIngestionKey whose request last minted this agent's key
   * (TelemetryRequest.ingestionKeyPolicy.ingestionKeyId), so an operator
   * who revokes a leaked key can tell which agents it registered. No foreign
   * key: deleting an ingestion key must not delete or re-key an agent.
   */
  @ColumnAccessControl({
    create: [],
    read: RESOURCE_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Registered With Ingestion Key ID",
    description:
      "ID of the telemetry ingestion key the agent last registered with.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public registeredWithIngestionKeyId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: RESOURCE_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Refused Registration At",
    description:
      "When another agent last tried to register for this resource and was refused.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastRefusedRegistrationAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: RESOURCE_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Last Refused Registration Reason",
    description:
      "Why that registration was refused, for example previous_instance_online.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public lastRefusedRegistrationReason?: ResourceAiAgentRegistrationRefusalReason =
    undefined;
}
