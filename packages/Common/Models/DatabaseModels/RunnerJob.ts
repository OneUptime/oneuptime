import Project from "./Project";
import Runner from "./Runner";
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
import { JSONObject } from "../../Types/JSON";
import RunnerJobStatus from "../../Types/Runbook/RunnerJobStatus";
import RunnerJobOrigin from "../../Types/Runbook/RunnerJobOrigin";
import RunbookStepType from "../../Types/Runbook/RunbookStepType";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/runner-job"))
@Entity({
  name: "RunnerJob",
})
@TableMetadata({
  tableName: "RunnerJob",
  singularName: "Runner Job",
  pluralName: "Runner Jobs",
  icon: IconProp.Logs,
  tableDescription:
    "One row per step dispatched to a specific Runner — Bash and JavaScript, which carry a script, and SSH and Kubernetes, which carry structured instructions instead. Tracks claim, execution, and result. Managed by the Worker and the agents; not user-writable.",
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
export default class RunnerJob extends BaseModel {
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
    description:
      "The parent runbook execution this job belongs to. Absent for AiRemediation-origin jobs.",
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
    required: false,
    canReadOnRelationQuery: true,
    title: "Runbook Execution ID",
    description:
      "ID of the parent runbook execution. Null for AiRemediation-origin jobs, which link to an AI run instead.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public runbookExecutionId?: ObjectID = undefined;

  /*
   * Which pipeline created this job. Decides the Runner capability that
   * gates claiming: Runbook-origin jobs need canRunRunbooks,
   * AiRemediation-origin jobs need canRunAiCommands.
   */
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
    isDefaultValueColumn: true,
    title: "Origin",
    description:
      "Whether this job came from a runbook execution or from an AI remediation run.",
    defaultValue: RunnerJobOrigin.Runbook,
  })
  @Column({
    type: ColumnType.ShortText,
    nullable: false,
    length: ColumnLength.ShortText,
    default: RunnerJobOrigin.Runbook,
  })
  public origin?: RunnerJobOrigin = undefined;

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
    title: "AI Run ID",
    description:
      "The AI remediation run that composed this job. Set on AiRemediation-origin jobs only.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public aiRunId?: ObjectID = undefined;

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
    title: "Auto Remediation Suggestion ID",
    description:
      "The auto-remediation suggestion this command belongs to. Set on AiRemediation-origin jobs only.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public autoRemediationSuggestionId?: ObjectID = undefined;

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
    modelType: Runner,
    title: "Target Agent",
    description:
      "The agent the step is configured to run on. Only this agent may claim the job.",
  })
  @ManyToOne(
    () => {
      return Runner;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "targetAgentId" })
  public targetAgent?: Runner = undefined;

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
  public status?: RunnerJobStatus = undefined;

  /*
   * NOT a required column, even though the database keeps it NOT NULL.
   *
   * `required` feeds getRequiredColumns(), which
   * DatabaseService.checkRequiredFields rejects on any falsy value — and an
   * empty string is falsy. SSH and Kubernetes jobs carry their instruction in
   * `payload` and an empty script by design, so marking this required made
   * every one of them fail at create() with "script is required" before a
   * Runner ever saw the job. The NOT NULL constraint still holds:
   * RunnerJobService always writes a string, empty or not.
   *
   * Which step types must carry a script and which must carry a payload is a
   * per-type rule that column metadata cannot express, so it is enforced in
   * RunnerJobService.enqueue instead.
   */
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
    title: "Script",
    description:
      "The script the Runner must execute. Empty for step types that carry structured instructions in the payload instead.",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: false,
  })
  public script?: string = undefined;

  /*
   * Structured instructions for step types that are not a script — which
   * host to reach, which workload to restart. Never holds secret material:
   * the credential is resolved server-side at claim time and travels in the
   * claim response, so a job row can be read by anyone who can read an
   * execution without exposing a private key.
   */
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
    type: TableColumnType.JSON,
    required: false,
    title: "Payload",
    description:
      "Structured instructions for non-script step types. Contains no secrets.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public payload?: JSONObject = undefined;

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
