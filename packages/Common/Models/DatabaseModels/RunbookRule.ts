import AlertSeverity from "./AlertSeverity";
import IncidentSeverity from "./IncidentSeverity";
import Label from "./Label";
import Monitor from "./Monitor";
import Project from "./Project";
import Runbook from "./Runbook";
import User from "./User";
import RuleBaseModel from "./DatabaseBaseModel/RuleBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import RunbookRuleTriggerEntity from "../../Types/Runbook/RunbookRuleTriggerEntity";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from "typeorm";

@EnableDocumentation()
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.CreateRunbookRule,
    Permission.RunbookAdmin,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.RunbookAdmin,
    Permission.RunbookMember,
    Permission.RunbookViewer,
    Permission.ReadRunbookRule,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.DeleteRunbookRule,
    Permission.RunbookAdmin,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.EditRunbookRule,
    Permission.RunbookAdmin,
  ],
})
@CrudApiEndpoint(new Route("/runbook-rule"))
@Entity({
  name: "RunbookRule",
})
@TableMetadata({
  tableName: "RunbookRule",
  singularName: "Runbook Rule",
  pluralName: "Runbook Rules",
  icon: IconProp.BookOpen,
  tableDescription:
    "Auto-attach runbooks to incidents, alerts, or scheduled maintenance events when they are created.",
})
export default class RunbookRule extends RuleBaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
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
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
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
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookRule,
      Permission.RunbookAdmin,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Name of this runbook rule.",
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
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookRule,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Description of this runbook rule.",
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
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookRule,
      Permission.RunbookAdmin,
    ],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description: "Whether this rule is enabled.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public isEnabled?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Trigger Entity Type",
    description:
      "Entity type that triggers this rule on creation: Incident, Alert, or ScheduledMaintenance.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public triggerEntityType?: RunbookRuleTriggerEntity = undefined;

  /*
   * Match criteria. One rule table serves incidents, alerts and scheduled
   * maintenance events (triggerEntityType), so the criteria are the union of
   * what the three can be matched on; each rule only uses those of its own
   * trigger entity (RunbookRuleCriteria in Types/Runbook says which, and the
   * service refuses the others).
   */

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookRule,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Monitor,
    title: "Monitors",
    description:
      "Only match incidents and scheduled maintenance events that affect, and alerts raised by, at least one of these monitors. Leave empty to match any monitor.",
  })
  @ManyToMany(
    () => {
      return Monitor;
    },
    { eager: false },
  )
  @JoinTable({
    name: "RunbookRuleMonitor",
    inverseJoinColumn: {
      name: "monitorId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "runbookRuleId",
      referencedColumnName: "_id",
    },
  })
  public monitors?: Array<Monitor> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookRule,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: IncidentSeverity,
    title: "Incident Severities",
    description:
      "Only match incidents with one of these severities. Incident rules only. Leave empty to match any severity.",
  })
  @ManyToMany(
    () => {
      return IncidentSeverity;
    },
    { eager: false },
  )
  @JoinTable({
    name: "RunbookRuleIncidentSeverity",
    inverseJoinColumn: {
      name: "incidentSeverityId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "runbookRuleId",
      referencedColumnName: "_id",
    },
  })
  public incidentSeverities?: Array<IncidentSeverity> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookRule,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: AlertSeverity,
    title: "Alert Severities",
    description:
      "Only match alerts with one of these severities. Alert rules only. Leave empty to match any severity.",
  })
  @ManyToMany(
    () => {
      return AlertSeverity;
    },
    { eager: false },
  )
  @JoinTable({
    name: "RunbookRuleAlertSeverity",
    inverseJoinColumn: {
      name: "alertSeverityId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "runbookRuleId",
      referencedColumnName: "_id",
    },
  })
  public alertSeverities?: Array<AlertSeverity> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookRule,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Labels",
    description:
      "Only match incidents, alerts or scheduled maintenance events that carry at least one of these labels. Leave empty to match regardless of their labels.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "RunbookRuleLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "runbookRuleId",
      referencedColumnName: "_id",
    },
  })
  public labels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookRule,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Label,
    title: "Monitor Labels",
    description:
      "Only match when a monitor of the incident, alert or scheduled maintenance event carries at least one of these labels. Leave empty to match regardless of monitor labels.",
  })
  @ManyToMany(
    () => {
      return Label;
    },
    { eager: false },
  )
  @JoinTable({
    name: "RunbookRuleMonitorLabel",
    inverseJoinColumn: {
      name: "labelId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "runbookRuleId",
      referencedColumnName: "_id",
    },
  })
  public monitorLabels?: Array<Label> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookRule,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Title Pattern",
    description:
      "Case-insensitive regex matched against the entity's title. Leave empty to match any title.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public titlePattern?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookRule,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description Pattern",
    description:
      "Case-insensitive regex matched against the entity's description. Leave empty to match any description.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public descriptionPattern?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookRule,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Monitor Name Pattern",
    description:
      "Case-insensitive regex matched against the names of the monitors of the incident, alert or scheduled maintenance event. Leave empty to match any monitor name.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public monitorNamePattern?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookRule,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Monitor Description Pattern",
    description:
      "Case-insensitive regex matched against the descriptions of the monitors of the incident, alert or scheduled maintenance event. Leave empty to match any monitor description.",
  })
  @Column({
    type: ColumnType.LongText,
    nullable: true,
    length: ColumnLength.LongText,
  })
  public monitorDescriptionPattern?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditRunbookRule,
      Permission.RunbookAdmin,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: Runbook,
    title: "Runbooks",
    description:
      "Runbooks to start when this rule matches. Each runbook produces its own execution.",
  })
  @ManyToMany(
    () => {
      return Runbook;
    },
    { eager: false },
  )
  @JoinTable({
    name: "RunbookRuleRunbook",
    inverseJoinColumn: {
      name: "runbookId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "runbookRuleId",
      referencedColumnName: "_id",
    },
  })
  public runbooks?: Array<Runbook> = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
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
      Permission.CreateRunbookRule,
      Permission.RunbookAdmin,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.RunbookAdmin,
      Permission.RunbookMember,
      Permission.RunbookViewer,
      Permission.ReadRunbookRule,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description: "User ID who created this object.",
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
    description: "User ID who deleted this object.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
