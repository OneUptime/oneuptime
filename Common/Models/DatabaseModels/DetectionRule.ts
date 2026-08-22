import Project from "./Project";
import User from "./User";
import AlertSeverity from "./AlertSeverity";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.CreateProjectDetectionRule,
];

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.TelemetryAdmin,
  Permission.TelemetryMember,
  Permission.TelemetryViewer,
  Permission.ReadProjectDetectionRule,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.EditProjectDetectionRule,
];

/*
 * Detections-as-code: a Sigma rule evaluated on a schedule against the
 * SecurityEvent ClickHouse table. Matches open Alerts (deduped per rule +
 * group-by fingerprint) and, optionally, write a Detection Finding row
 * back into the security events table so detections are themselves
 * queryable signals.
 */
@EnableDocumentation()
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/detection-rule"))
@Entity({
  name: "DetectionRule",
})
@TableMetadata({
  tableName: "DetectionRule",
  singularName: "Detection Rule",
  pluralName: "Detection Rules",
  icon: IconProp.ShieldExclamation,
  tableDescription:
    "Sigma detection rules evaluated against security events. Matches create alerts and detection findings.",
})
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteProjectDetectionRule,
  ],
  update: updatePermissions,
})
export default class DetectionRule extends BaseModel {
  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this detection rule belongs to.",
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
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this detection rule belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Name,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Friendly name for this detection rule.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Name,
    length: ColumnLength.Name,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Description",
    description: "Description of what this detection rule looks for.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.VeryLongText,
    title: "Sigma Rule (YAML)",
    description:
      "The Sigma rule to evaluate, in YAML. detection selections and condition are compiled to a ClickHouse query over security events.",
  })
  @Column({
    nullable: false,
    type: ColumnType.VeryLongText,
  })
  public sigmaRuleYaml?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Enabled",
    description: "Whether this detection rule is evaluated.",
    defaultValue: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    title: "Evaluation Interval (Minutes)",
    required: true,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    description:
      "How often this rule is evaluated, in minutes. The evaluation window covers the time since the previous evaluation.",
    defaultValue: 1,
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 1,
  })
  public evaluationIntervalInMinutes?: number = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    title: "Group By Field",
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    description:
      "Optional security-event field (e.g. principalHost, principalUser) to group matches by. One alert is opened per distinct value; empty groups all matches into one alert.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public groupByField?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Create Alerts",
    description: "Whether matches open OneUptime alerts.",
    defaultValue: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public shouldCreateAlert?: boolean = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Write Detection Findings",
    description:
      "Whether matches also write a Detection Finding security event back into the events table.",
    defaultValue: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public shouldWriteDetectionFinding?: boolean = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "alertSeverityId",
    type: TableColumnType.Entity,
    modelType: AlertSeverity,
    title: "Alert Severity",
    description:
      "Severity of alerts opened by this rule. Defaults from the Sigma rule's level, mapped onto this project's severities, when unset.",
  })
  @ManyToOne(
    () => {
      return AlertSeverity;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "alertSeverityId" })
  public alertSeverity?: AlertSeverity = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Alert Severity ID",
    description: "ID of the alert severity for alerts opened by this rule.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public alertSeverityId?: ObjectID = undefined;

  /*
   * Evaluator-owned state. Written only by the detection engine cron,
   * never by users.
   */
  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    title: "Last Evaluated At",
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    description:
      "When the detection engine last evaluated this rule. Null means it has never run.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastEvaluatedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    title: "Last Match At",
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    description:
      "When this rule most recently matched security events. Null means it has never matched.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: true,
  })
  public lastMatchAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    title: "Last Error",
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    description:
      "The most recent evaluation error, if any. Cleared on the next successful evaluation.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public lastError?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "Relation to the user who created this detection rule.",
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
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who created this detection rule.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Deleted By User",
    description: "Relation to the user who deleted this detection rule.",
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
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted By User ID",
    description: "ID of the user who deleted this detection rule.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
