import Project from "./Project";
import RunbookAgent from "./RunbookAgent";
import RunbookExecution from "./RunbookExecution";
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
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import RunbookAgentJobStatus from "../../Types/Runbook/RunbookAgentJobStatus";
import RunbookStepType from "../../Types/Runbook/RunbookStepType";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/runbook-agent-job"))
@Entity({
  name: "RunbookAgentJob",
})
@TableMetadata({
  tableName: "RunbookAgentJob",
  singularName: "Runbook Agent Job",
  pluralName: "Runbook Agent Jobs",
  icon: IconProp.Logs,
  tableDescription:
    "One row per Bash or JavaScript step dispatched to a specific Runbook Agent. Tracks claim, execution, and result. Managed by the Worker and the agents; not user-writable.",
})
@TableAccessControl({
  create: [],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.RunbookAdmin,
    Permission.RunbookMember,
    Permission.RunbookViewer,
    Permission.ReadRunbookExecution,
  ],
  delete: [],
  update: [],
})
export default class RunbookAgentJob extends BaseModel {
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
      Permission.ReadRunbookExecution,
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
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookExecution,
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
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "runbookExecutionId",
    type: TableColumnType.Entity,
    modelType: RunbookExecution,
    title: "Runbook Execution",
    description: "The parent runbook execution this job belongs to.",
  })
  @ManyToOne(
    () => {
      return RunbookExecution;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "delete",
    },
  )
  @JoinColumn({ name: "runbookExecutionId" })
  public runbookExecution?: RunbookExecution = undefined;

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
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Runbook Execution ID",
    description: "ID of the parent runbook execution.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public runbookExecutionId?: ObjectID = undefined;

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
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Step ID",
    description: "ID of the step within the runbook that produced this job.",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
  })
  public stepId?: string = undefined;

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
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Step Type",
    description:
      "The kind of script the agent must execute (Bash or JavaScript).",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
  })
  public stepType?: RunbookStepType = undefined;

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
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "targetAgentId",
    type: TableColumnType.Entity,
    modelType: RunbookAgent,
    title: "Target Agent",
    description:
      "The agent the step is configured to run on. Only this agent may claim the job.",
  })
  @ManyToOne(
    () => {
      return RunbookAgent;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "targetAgentId" })
  public targetAgent?: RunbookAgent = undefined;

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
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Target Agent ID",
    description: "ID of the agent that should claim and execute this job.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public targetAgentId?: ObjectID = undefined;

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
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Assigned Agent ID",
    description: "ID of the agent that claimed this job (same as the target).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public assignedAgentId?: ObjectID = undefined;

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
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Status",
    description: "Lifecycle status of this job.",
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
  })
  public status?: RunbookAgentJobStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: true,
    title: "Script",
    description: "The bash script the agent must execute.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: false,
  })
  public script?: string = undefined;

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
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: true,
    title: "Execution Timeout (ms)",
    description: "How long the agent may run the script before killing it.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
  })
  public timeoutInMs?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: false,
    title: "Output",
    description: "Combined stdout/stderr from the agent, capped server-side.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public output?: string = undefined;

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
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Exit Code",
    description: "Process exit code reported by the agent. Null on timeout.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public exitCode?: number = undefined;

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
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    required: false,
    title: "Error Message",
    description: "Short error explanation when the job did not succeed.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
  })
  public errorMessage?: string = undefined;

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
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: true,
    title: "Claim Deadline",
    description:
      "If no agent claims this job by this time, the Worker fails it with TimedOut.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public claimDeadlineAt?: Date = undefined;

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
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Claimed At",
    description: "When an agent claimed this job.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public claimedAt?: Date = undefined;

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
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Lease Expires At",
    description:
      "If the agent does not heartbeat for this job by this time, the Worker reclaims it.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public leaseExpiresAt?: Date = undefined;

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
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Started At",
    description: "When the agent began executing the script.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public startedAt?: Date = undefined;

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
      Permission.ReadRunbookExecution,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: false,
    title: "Completed At",
    description: "When the job reached a terminal status.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public completedAt?: Date = undefined;
}
