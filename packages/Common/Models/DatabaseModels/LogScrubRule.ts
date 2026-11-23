import Project from "./Project";
import Service from "./Service";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import LogScrubAction from "../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../Types/Log/LogScrubPatternType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import ListOrderColumn from "../../Types/Database/ListOrderColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import { JSONObject } from "../../Types/JSON";
import Permission from "../../Types/Permission";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { LOG_SCRUB_RULE_DEFAULTS } from "../../Types/Telemetry/ScrubRule";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@ListOrderColumn({ column: "sortOrder", scopeColumns: ["projectId"] })
@CrudApiEndpoint(new Route("/log-scrub-rule"))
@Entity({
  name: "LogScrubRule",
})
@TableMetadata({
  tableName: "LogScrubRule",
  singularName: "Log Scrub Rule",
  pluralName: "Log Scrub Rules",
  icon: IconProp.ShieldCheck,
  tableDescription:
    "Configure rules to automatically detect and scrub sensitive data (PII) from logs at ingest time.",
})
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateProjectLogScrubRule,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.TelemetryAdmin,
    Permission.TelemetryMember,
    Permission.TelemetryViewer,
    Permission.ReadProjectLogScrubRule,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteProjectLogScrubRule,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditProjectLogScrubRule,
  ],
})
export default class LogScrubRule extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectLogScrubRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadProjectLogScrubRule,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this log scrub rule belongs to.",
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
      Permission.CreateProjectLogScrubRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadProjectLogScrubRule,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this log scrub rule belongs to.",
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
      Permission.CreateProjectLogScrubRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadProjectLogScrubRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectLogScrubRule,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Friendly name for this scrub rule.",
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
      Permission.CreateProjectLogScrubRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadProjectLogScrubRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectLogScrubRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Description",
    description: "Description of what this scrub rule does.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectLogScrubRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadProjectLogScrubRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectLogScrubRule,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(LogScrubPatternType),
    canReadOnRelationQuery: true,
    title: "Pattern Type",
    description:
      "The type of sensitive data to detect: email, creditCard, ssn, phoneNumber, ipAddress, sensitiveKeys (the whole value of every attribute whose key looks sensitive, such as password or token), or custom (the regular expression in customRegex). Any other value is refused: it would scrub nothing.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public patternType?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectLogScrubRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadProjectLogScrubRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectLogScrubRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Custom Regex",
    description:
      "The regular expression a 'custom' rule scrubs, written without slashes or flags and matched case-sensitively. Required when patternType is 'custom': a pattern that is empty, does not compile, or matches empty text is refused. Ignored for the other pattern types.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public customRegex?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectLogScrubRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadProjectLogScrubRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectLogScrubRule,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(LogScrubAction),
    canReadOnRelationQuery: true,
    title: "Scrub Action",
    description:
      "How to scrub matched data: 'redact' replaces it with [REDACTED] (the default), 'mask' partially hides it, 'hash' replaces it with a short hash of the value.",
    defaultValue: LOG_SCRUB_RULE_DEFAULTS.scrubAction,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: LOG_SCRUB_RULE_DEFAULTS.scrubAction,
  })
  public scrubAction?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectLogScrubRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadProjectLogScrubRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectLogScrubRule,
    ],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Fields to Scrub",
    description:
      "Which log fields to scrub: 'body' (the log message), 'attributes' (attribute values), or 'both', the default. A sensitiveKeys rule always scrubs attribute values, whatever this says.",
    defaultValue: LOG_SCRUB_RULE_DEFAULTS.fieldsToScrub,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: LOG_SCRUB_RULE_DEFAULTS.fieldsToScrub,
  })
  public fieldsToScrub?: string = undefined;

  /*
   * The attributes the rule names (#10366): a Named Attributes rule hides
   * the whole value of each; any other pattern looks for its matches only
   * in their values. A key names an attribute exactly, or by a dotted
   * prefix (Types/Telemetry/ScrubRuleKeys). None for a rule that reads every
   * attribute, as every rule saved before a rule could name one.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectLogScrubRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadProjectLogScrubRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectLogScrubRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Attribute Keys",
    description:
      "The attributes this rule reads, each by its key or a dotted prefix of it (customer_name, request.headers). A Named Attributes rule hides the whole value of each; any other pattern looks for its matches only in their values. Empty for every attribute.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public attributeKeys?: Array<string> = undefined;

  /*
   * How OneUptime proved the rule hides a finding's data (#10366): the
   * records it was run on, through the code ingest runs, and what was left
   * (Types/Telemetry/ScrubRuleProof). Only OneUptime writes it - a proof a
   * person could type would mark a leak scrubbed that nobody had proven -
   * and it counts only while the rule is still the rule that was proven.
   */
  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadProjectLogScrubRule,
    ],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Proof",
    description:
      "Written by OneUptime: how this rule was proven to hide what Data Security found, on the very logs it was found in - the records read, the values that held the data and the share of other values it changed. It counts only while the rule is unchanged.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public proof?: JSONObject = undefined;

  /*
   * The service whose logs the rule scrubs (#10433): a rule for one service
   * scrubs the logs that service sends and no other's, as a metric pipeline
   * rule for a service does. None for every service and app of the project,
   * as every rule saved before a rule could name one. A rule goes with its
   * service when the service is deleted: no log of it is left to scrub.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectLogScrubRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadProjectLogScrubRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectLogScrubRule,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "serviceId",
    type: TableColumnType.Entity,
    modelType: Service,
    required: false,
    title: "Service",
    description:
      "The service whose logs this rule scrubs. Leave it empty to scrub the logs of every service in the project.",
  })
  @ManyToOne(
    () => {
      return Service;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "serviceId" })
  public service?: Service = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectLogScrubRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadProjectLogScrubRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectLogScrubRule,
    ],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Service ID",
    description:
      "ID of the service whose logs this rule scrubs: a rule that names a service scrubs only the logs that service sends. Null scrubs the logs of every service in the project.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public serviceId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectLogScrubRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadProjectLogScrubRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectLogScrubRule,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Enabled",
    description: "Whether this scrub rule is active.",
    defaultValue: LOG_SCRUB_RULE_DEFAULTS.isEnabled,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: LOG_SCRUB_RULE_DEFAULTS.isEnabled,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateProjectLogScrubRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadProjectLogScrubRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditProjectLogScrubRule,
    ],
  })
  @TableColumn({
    title: "Sort Order",
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    description:
      "Where this rule is applied among the project's log scrub rules, lowest number first. A new rule is added to the end of the list. Setting a number places it there and moves no other one: two at one number are read the older first. In the dashboard, drag the rows to reorder them.",
  })
  @Column({
    type: ColumnType.Number,
    nullable: false,
    default: 0,
  })
  public sortOrder?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadProjectLogScrubRule,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created By User",
    description: "Relation to the user who created this log scrub rule.",
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.TelemetryAdmin,
      Permission.TelemetryMember,
      Permission.TelemetryViewer,
      Permission.ReadProjectLogScrubRule,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description: "ID of the user who created this log scrub rule.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
