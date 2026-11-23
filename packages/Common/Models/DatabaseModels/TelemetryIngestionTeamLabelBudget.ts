import Label from "./Label";
import Project from "./Project";
import Team from "./Team";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { ColumnAccessControl as BaseColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import { getDecimalDatabaseTransformer } from "../../Types/Database/DecimalColumnTransformer";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnsTogether from "../../Types/Database/UniqueColumnsTogether";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PROJECT_TELEMETRY_USAGE_READ_PERMISSIONS } from "../../Utils/Project/ProjectBilling";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * A TEAM'S OR A LABEL'S INGESTION BUDGET INSIDE A PROJECT (issue #6386).
 *
 * The most logs, traces, metrics and profiles the services, hosts and other
 * resources one team owns - or that carry one label - may send in a budget
 * day (#10101). One
 * row per team or label: exactly one of teamId and labelId is set
 * (TelemetryIngestionTeamLabelBudgetService refuses anything else).
 *
 * Counted in the telemetry worker, once each batch's resources are filed
 * under their services, hosts and the like (TelemetryIngestAttribution),
 * whether they came over OTLP or from Fluent Bit, Fluentd or syslog
 * (#10102): the request path never
 * decodes a body, so it cannot tell whose telemetry a request carries.
 * Once one is used up, that team's or label's telemetry of the signal is
 * dropped until the budget resets, and no longer counts against the
 * project's budget, so the rest of the project keeps sending. The sender is
 * not told: it was answered when the batch arrived.
 *
 * A budget only subdivides the project's own: one above the project's is
 * refused when it is saved, and held to it when the project's is lowered.
 * Set by whoever runs the project (Project Owners and Project Admins) and
 * read by whoever reads its telemetry usage, beside the usage it limits.
 *
 * Its daily budgets use the column names of every other level
 * (TELEMETRY_INGESTION_BUDGET_COLUMNS), so one reader walks them all. There
 * is no rate and no security events budget: see
 * TELEMETRY_INGESTION_TEAM_LABEL_BUDGET_SIGNALS.
 */

const WRITE_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

const READ_PERMISSIONS: Array<Permission> = [
  ...PROJECT_TELEMETRY_USAGE_READ_PERMISSIONS,
];

const BUDGET_COLUMN_ACCESS: BaseColumnAccessControl = {
  create: [...WRITE_PERMISSIONS],
  read: [...READ_PERMISSIONS],
  update: [...WRITE_PERMISSIONS],
};

// Whose budget it is: set once, when it is created.
const TARGET_COLUMN_ACCESS: BaseColumnAccessControl = {
  create: [...WRITE_PERMISSIONS],
  read: [...READ_PERMISSIONS],
  update: [],
};

@EnableDocumentation()
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/telemetry-ingestion-team-label-budget"))
@Entity({
  name: "TelemetryIngestionTeamLabelBudget",
})
@TableAccessControl({
  create: [...WRITE_PERMISSIONS],
  read: [...READ_PERMISSIONS],
  delete: [...WRITE_PERMISSIONS],
  update: [...WRITE_PERMISSIONS],
})
@TableMetadata({
  tableName: "TelemetryIngestionTeamLabelBudget",
  singularName: "Team or Label Budget",
  pluralName: "Team and Label Budgets",
  icon: IconProp.Signal,
  tableDescription:
    "Daily ingestion budgets for the telemetry of the services, hosts and other resources a team owns, or that carry a label.",
})
@Index(["projectId", "teamId"], { unique: true })
@Index(["projectId", "labelId"], { unique: true })
@UniqueColumnsTogether(
  ["projectId", "teamId"],
  "This team already has a budget. Edit that one instead.",
)
@UniqueColumnsTogether(
  ["projectId", "labelId"],
  "This label already has a budget. Edit that one instead.",
)
export default class TelemetryIngestionTeamLabelBudget extends BaseModel {
  @ColumnAccessControl(TARGET_COLUMN_ACCESS)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to Project Resource in which this object belongs",
    example: "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
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

  @ColumnAccessControl(TARGET_COLUMN_ACCESS)
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

  @ColumnAccessControl(TARGET_COLUMN_ACCESS)
  @TableColumn({
    manyToOneRelationColumn: "teamId",
    type: TableColumnType.Entity,
    modelType: Team,
    title: "Team",
    description:
      "The team the budget is for: every service, host and other resource the team owns. Empty for a label's budget.",
    example: "a1b2c3d4-e5f6-7890-ab12-cd34ef567890",
  })
  @ManyToOne(
    () => {
      return Team;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "teamId" })
  public team?: Team = undefined;

  @ColumnAccessControl(TARGET_COLUMN_ACCESS)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Team ID",
    description:
      "ID of the team the budget is for: every service, host and other resource it owns. Empty for a label's budget.",
    example: "a1b2c3d4-e5f6-7890-ab12-cd34ef567890",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public teamId?: ObjectID = undefined;

  @ColumnAccessControl(TARGET_COLUMN_ACCESS)
  @TableColumn({
    manyToOneRelationColumn: "labelId",
    type: TableColumnType.Entity,
    modelType: Label,
    title: "Label",
    description:
      "The label the budget is for: every service, host and other resource that carries it. Empty for a team's budget.",
    example: "b2c3d4e5-f6a7-8901-bc23-de45fa678901",
  })
  @ManyToOne(
    () => {
      return Label;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "labelId" })
  public label?: Label = undefined;

  @ColumnAccessControl(TARGET_COLUMN_ACCESS)
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Label ID",
    description:
      "ID of the label the budget is for: every service, host and other resource that carries it. Empty for a team's budget.",
    example: "b2c3d4e5-f6a7-8901-bc23-de45fa678901",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public labelId?: ObjectID = undefined;

  @ColumnAccessControl(BUDGET_COLUMN_ACCESS)
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Logs Daily Budget (GB)",
    description:
      "The most logs the team's or label's services may send in a budget day, in GB, counted decompressed as they arrive; once used up, their logs are dropped until the budget resets. At most the project's own budget. Empty: no logs budget of their own (the project's still applies).",
    example: 5,
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: true,
    transformer: getDecimalDatabaseTransformer(),
  })
  public logsDailyIngestionBudgetInGB?: number = undefined;

  @ColumnAccessControl(BUDGET_COLUMN_ACCESS)
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Traces Daily Budget (GB)",
    description:
      "The most traces the team's or label's services may send in a budget day, in GB, counted decompressed as they arrive; once used up, their traces are dropped until the budget resets. At most the project's own budget. Empty: no traces budget of their own (the project's still applies).",
    example: 5,
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: true,
    transformer: getDecimalDatabaseTransformer(),
  })
  public tracesDailyIngestionBudgetInGB?: number = undefined;

  @ColumnAccessControl(BUDGET_COLUMN_ACCESS)
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Metrics Daily Budget (GB)",
    description:
      "The most metrics the team's or label's services may send in a budget day, in GB, counted decompressed as they arrive; once used up, their metrics are dropped until the budget resets. At most the project's own budget. Empty: no metrics budget of their own (the project's still applies).",
    example: 5,
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: true,
    transformer: getDecimalDatabaseTransformer(),
  })
  public metricsDailyIngestionBudgetInGB?: number = undefined;

  @ColumnAccessControl(BUDGET_COLUMN_ACCESS)
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Profiles Daily Budget (GB)",
    description:
      "The most profiles the team's or label's services may send in a budget day, in GB, counted decompressed as they arrive; once used up, their profiles are dropped until the budget resets. At most the project's own budget. Empty: no profiles budget of their own (the project's still applies).",
    example: 5,
  })
  @Column({
    type: ColumnType.Decimal,
    nullable: true,
    transformer: getDecimalDatabaseTransformer(),
  })
  public profilesDailyIngestionBudgetInGB?: number = undefined;

  @ColumnAccessControl(TARGET_COLUMN_ACCESS)
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
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

  @ColumnAccessControl(TARGET_COLUMN_ACCESS)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
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
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
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
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
