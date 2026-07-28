import Label from "./Label";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import AccessControlColumn from "../../Types/Database/AccessControlColumn";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import SlugifyColumn from "../../Types/Database/SlugifyColumn";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnBy from "../../Types/Database/UniqueColumnBy";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import Version from "../../Types/Version";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

export enum RunbookAgentConnectionStatus {
  Connected = "connected",
  Disconnected = "disconnected",
}

@EnableDocumentation()
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/runbook-agent"))
@AccessControlColumn("labels")
@SlugifyColumn("name", "slug")
@Entity({
  name: "RunbookAgent",
})
@TableMetadata({
  tableName: "RunbookAgent",
  singularName: "Runbook Agent",
  pluralName: "Runbook Agents",
  icon: IconProp.Terminal,
  tableDescription:
    "A self-hosted agent that executes Bash and JavaScript runbook steps in your own infrastructure and reports results back to OneUptime. Each step picks the agent that should run it.",
})
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.RunbookAdmin,
    Permission.RunbookMember,
    Permission.CreateRunbookAgent,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.RunbookAdmin,
    Permission.RunbookMember,
    Permission.RunbookViewer,
    Permission.ReadRunbookAgent,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.RunbookAdmin,
    Permission.DeleteRunbookAgent,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.RunbookAdmin,
    Permission.EditRunbookAgent,
  ],
})
export default class RunbookAgent extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.CreateRunbookAgent,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookAgent,
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
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.CreateRunbookAgent,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookAgent,
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
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.CreateRunbookAgent,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookAgent,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.RunbookAdmin,
      Permission.EditRunbookAgent,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Friendly name for this agent",
    example: "prod-eu-west-1-agent",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  @UniqueColumnBy("projectId")
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.CreateRunbookAgent,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookAgent,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.RunbookAdmin,
      Permission.EditRunbookAgent,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Optional description for this agent",
    example: "Runs in the production EU cluster; can reach internal services.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  /*
   * INFORMATIONAL context for humans: where this agent lives. Shown as a
   * badge wherever the agent appears (including on AI remediation
   * proposals, so an approver sees at a glance that a command targets
   * production). It does NOT gate AI auto-execution — Auto Remediation
   * Rules on incidents/alerts decide that, and the accessLevel grant below
   * decides what kind of action may dispatch here.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.CreateRunbookAgent,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookAgent,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.RunbookAdmin,
      Permission.EditRunbookAgent,
    ],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.ShortText,
    title: "Environment",
    description:
      "Which environment this agent lives in: Production, Staging, Testing or Development. Informational — shown to approvers as context; it does not gate AI auto-execution (Auto Remediation Rules and the Access Level grant do).",
    defaultValue: "Production",
    example: "Testing",
  })
  @Column({
    nullable: false,
    default: "Production",
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public environmentType?: string = undefined;

  /*
   * The per-agent capability grant for the AI remediation lane: what kind
   * of AI-dispatched action this agent accepts. ReadOnly (the default —
   * fail-safe) accepts only Diagnostic actions; ReadWrite also accepts
   * Remediation actions. Grant production agents ReadOnly and test/staging
   * agents ReadWrite. Applies to BOTH auto-executed and human-approved
   * AI-lane dispatch — it is the agent's declared capability, not an
   * approval shortcut; humans wanting more run runbooks directly.
   *
   * SECURITY-SENSITIVE ACL: writing this grant is restricted to Project
   * Owners/Admins — it is the boundary that decides whether AI-proposed
   * writes can reach this host at all. The honest enforcement backstop is
   * OS-level: run ReadOnly agents as OS users that genuinely cannot mutate
   * anything (see RunbookAgentAccessLevel).
   */
  @ColumnAccessControl({
    create: [Permission.ProjectOwner, Permission.ProjectAdmin],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookAgent,
    ],
    update: [Permission.ProjectOwner, Permission.ProjectAdmin],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.ShortText,
    title: "AI Access Level",
    description:
      "What the AI remediation lane may dispatch to this agent: ReadOnly (diagnostics only — the default) or ReadWrite (remediations too). Grant ReadWrite deliberately; run ReadOnly agents as OS users that cannot mutate anything so the grant is enforced by the host, not by trust.",
    defaultValue: "ReadOnly",
    example: "ReadWrite",
  })
  @Column({
    nullable: false,
    default: "ReadOnly",
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public accessLevel?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookAgent,
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
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.CreateRunbookAgent,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.RunbookAdmin,
      Permission.EditRunbookAgent,
    ],
  })
  @TableColumn({
    required: true,
    unique: true,
    type: TableColumnType.ShortText,
    title: "Agent Key",
    description:
      "Secret key the agent presents on every request. Never share this key. Reset it to revoke the agent.",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    unique: true,
  })
  public key?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.CreateRunbookAgent,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookAgent,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Version,
    title: "Agent Version",
    description:
      "Self-reported version of the agent binary. Updated on each heartbeat.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Version,
    length: ColumnLength.Version,
    transformer: Version.getDatabaseTransformer(),
  })
  public agentVersion?: Version = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookAgent,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Alive",
    description: "Most recent heartbeat from this agent.",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public lastAlive?: Date = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.CreateRunbookAgent,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookAgent,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Connection Status",
    description: "Connected if the agent has heartbeated recently.",
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: true,
    unique: false,
  })
  public connectionStatus?: RunbookAgentConnectionStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookAgent,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Host Info",
    description:
      "Self-reported host info (hostname, OS, arch). Updated on each heartbeat.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public hostInfo?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.CreateRunbookAgent,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookAgent,
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
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.CreateRunbookAgent,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookAgent,
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
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.CreateRunbookAgent,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookAgent,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.EditRunbookAgent,
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
    name: "RunbookAgentLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "runbookAgentId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;
}
