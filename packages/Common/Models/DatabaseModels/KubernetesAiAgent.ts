import KubernetesCluster from "./KubernetesCluster";
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
import {
  KubernetesAiAgentConnectionStatus,
  KubernetesAiAgentRegistrationRefusalReason,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * Who may see a cluster's Kubernetes AI agent: exactly who may read the
 * cluster (KubernetesCluster's read list). Nobody writes a row through the
 * API — the agent registers and heartbeats through
 * /kubernetes-ai-agent-ingest, and an admin reset goes through the cluster's
 * AI access API, both as root.
 */
const CLUSTER_READERS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadKubernetesCluster,
];

/*
 * The Kubernetes AI agent of one cluster: the slim in-cluster kubectl
 * executor the kubernetes-agent chart installs (image
 * oneuptime/kubernetes-ai-agent). It is deliberately NOT a Runner: it never
 * appears on the Runners page, is never handed a credential and runs nothing
 * but AI kubectl jobs (RunnerJob rows targeted at it through
 * RunnerJob.targetKubernetesAiAgentId) with its own ServiceAccount.
 *
 * One row per cluster. The agent registers with the project's telemetry
 * ingestion key and receives an agent key; only the key's sha256 is kept
 * (keyHash), and no user can read it. The dashboard reads the row through the
 * cluster's AI access status, which is why there is no CRUD API and no API
 * documentation for this table (UserProjectSsoConsent is the precedent).
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: CLUSTER_READERS,
  delete: [],
  update: [],
})
/*
 * One agent per cluster, enforced by the database: two pods registering for
 * the same new cluster at once must not both create a row. Named, and
 * declared here rather than only in a migration, so TypeORM's schema builder
 * recognises it and never generates a DROP for it.
 */
@Index("IDX_KubernetesAiAgent_kubernetesClusterId", ["kubernetesClusterId"], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@TableMetadata({
  tableName: "KubernetesAiAgent",
  singularName: "Kubernetes AI Agent",
  pluralName: "Kubernetes AI Agents",
  icon: IconProp.Cube,
  tableDescription:
    "The Kubernetes AI agent installed in a cluster by the Kubernetes agent chart: the in-cluster kubectl executor OneUptime AI uses to investigate (and, when allowed, fix) that cluster. One per cluster. Managed by the server; not user-writable.",
})
@Entity({
  name: "KubernetesAiAgent",
})
export default class KubernetesAiAgent extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: CLUSTER_READERS,
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
    read: CLUSTER_READERS,
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
    create: [],
    read: CLUSTER_READERS,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "kubernetesClusterId",
    type: TableColumnType.Entity,
    modelType: KubernetesCluster,
    title: "Kubernetes Cluster",
    description: "The cluster this Kubernetes AI agent runs in.",
  })
  @ManyToOne(
    () => {
      return KubernetesCluster;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "kubernetesClusterId" })
  public kubernetesCluster?: KubernetesCluster = undefined;

  @ColumnAccessControl({
    create: [],
    read: CLUSTER_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Kubernetes Cluster ID",
    description:
      "ID of the cluster this Kubernetes AI agent runs in. A cluster has at most one agent.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public kubernetesClusterId?: ObjectID = undefined;

  /*
   * sha256 (hex) of the agent key the agent presents on every request after
   * registration. The key itself is never stored. Null after an admin reset:
   * no key matches, so the running pod fails authentication and registers
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
    read: CLUSTER_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Agent Version",
    description:
      "Self-reported version of the Kubernetes AI agent. Updated on registration and every heartbeat.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public agentVersion?: string = undefined;

  /*
   * The agent's last reported posture (KubernetesAgentPosture), stored bare
   * — not under a hostInfo.kubernetes wrapper like a Runner's — and always
   * read back through parseKubernetesAgentPosture. The server forces
   * inCluster and clusterIdentifier before storing it.
   */
  @ColumnAccessControl({
    create: [],
    read: CLUSTER_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Posture",
    description:
      "What the agent last reported about itself: whether it may write, the namespaces it may write in, whether it may run node operations, its own namespace and its kubectl and chart versions. Set by the server.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public posture?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: CLUSTER_READERS,
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
    read: CLUSTER_READERS,
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
  public connectionStatus?: KubernetesAiAgentConnectionStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: CLUSTER_READERS,
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
    read: CLUSTER_READERS,
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
    read: CLUSTER_READERS,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Last Refused Registration At",
    description:
      "When another agent pod last tried to register for this cluster and was refused.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastRefusedRegistrationAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: CLUSTER_READERS,
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
  public lastRefusedRegistrationReason?: KubernetesAiAgentRegistrationRefusalReason =
    undefined;
}
