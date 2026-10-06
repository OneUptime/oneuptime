import IncomingCallPolicy from "./IncomingCallPolicy";
import OnCallDutyPolicySchedule from "./OnCallDutyPolicySchedule";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
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
import ListOrderColumn from "../../Types/Database/ListOrderColumn";
import IconProp from "../../Types/Icon/IconProp";
import {
  DEFAULT_INCOMING_CALL_RING_SECONDS,
  MAX_INCOMING_CALL_RING_SECONDS,
  MIN_INCOMING_CALL_RING_SECONDS,
} from "../../Types/IncomingCall/IncomingCallRingTime";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import EnableWorkflow from "../../Types/Database/EnableWorkflow";

@EnableDocumentation()
@TenantColumn("projectId")
@ListOrderColumn({ column: "order", scopeColumns: ["incomingCallPolicyId"] })
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.CreateProjectIncomingCallPolicyEscalationRule,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.SettingsViewer,
    Permission.ReadProjectIncomingCallPolicyEscalationRule,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.DeleteProjectIncomingCallPolicyEscalationRule,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.SettingsAdmin,
    Permission.SettingsMember,
    Permission.EditProjectIncomingCallPolicyEscalationRule,
  ],
})
@CrudApiEndpoint(new Route("/incoming-call-policy-escalation-rule"))
@Entity({
  name: "IncomingCallPolicyEscalationRule",
})
@TableMetadata({
  tableName: "IncomingCallPolicyEscalationRule",
  singularName: "Incoming Call Policy Escalation Rule",
  pluralName: "Incoming Call Policy Escalation Rules",
  icon: IconProp.Call,
  tableDescription:
    "Manage escalation rules for incoming call policies that define who to call and in what order",
})
export default class IncomingCallPolicyEscalationRule extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateProjectIncomingCallPolicyEscalationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectIncomingCallPolicyEscalationRule,
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
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateProjectIncomingCallPolicyEscalationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectIncomingCallPolicyEscalationRule,
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
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateProjectIncomingCallPolicyEscalationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectIncomingCallPolicyEscalationRule,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "incomingCallPolicyId",
    type: TableColumnType.Entity,
    modelType: IncomingCallPolicy,
    title: "Incoming Call Policy",
    description: "Relation to the parent Incoming Call Policy",
  })
  @ManyToOne(
    () => {
      return IncomingCallPolicy;
    },
    {
      eager: false,
      nullable: false,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "incomingCallPolicyId" })
  public incomingCallPolicy?: IncomingCallPolicy = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateProjectIncomingCallPolicyEscalationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectIncomingCallPolicyEscalationRule,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Incoming Call Policy ID",
    description: "ID of the parent Incoming Call Policy",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public incomingCallPolicyId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateProjectIncomingCallPolicyEscalationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectIncomingCallPolicyEscalationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditProjectIncomingCallPolicyEscalationRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Name",
    description: "Rule name (e.g., 'Primary On-Call', 'Backup Engineer')",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateProjectIncomingCallPolicyEscalationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectIncomingCallPolicyEscalationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditProjectIncomingCallPolicyEscalationRule,
    ],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Optional description of this escalation rule",
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
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateProjectIncomingCallPolicyEscalationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectIncomingCallPolicyEscalationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditProjectIncomingCallPolicyEscalationRule,
    ],
  })
  @Index()
  @TableColumn({
    required: false,
    isDefaultValueColumn: false,
    type: TableColumnType.Number,
    title: "Order",
    description:
      "Where this rule sits in the escalation, lowest number first. A new rule is added to the end of the list. Setting a number another one already has puts it in that place, and the ones in the way move one place along to make room. In the dashboard, drag the rows to reorder them.",
    canReadOnRelationQuery: true,
  })
  @Column({
    type: ColumnType.Number,
  })
  public order?: number = undefined;

  /*
   * How long the phone rings before the call moves on to the next rule: the
   * timeout of Twilio's <Dial>. A new rule rings for 20 seconds; rules made
   * when the default was 30 keep the 30 they hold (IncomingCallRingTime).
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateProjectIncomingCallPolicyEscalationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectIncomingCallPolicyEscalationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditProjectIncomingCallPolicyEscalationRule,
    ],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Number,
    title: "Escalate After (Seconds)",
    description: `How long, in seconds, the phone rings before the call moves on to the next rule. ${DEFAULT_INCOMING_CALL_RING_SECONDS} when left out; a time below ${MIN_INCOMING_CALL_RING_SECONDS} or above ${MAX_INCOMING_CALL_RING_SECONDS} rings for ${MIN_INCOMING_CALL_RING_SECONDS} or ${MAX_INCOMING_CALL_RING_SECONDS}, the limits Twilio takes.`,
    defaultValue: DEFAULT_INCOMING_CALL_RING_SECONDS,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    default: DEFAULT_INCOMING_CALL_RING_SECONDS,
  })
  public escalateAfterSeconds?: number = undefined;

  // Either onCallDutyPolicyScheduleId OR userId must be set, never both
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateProjectIncomingCallPolicyEscalationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectIncomingCallPolicyEscalationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditProjectIncomingCallPolicyEscalationRule,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "onCallDutyPolicyScheduleId",
    type: TableColumnType.Entity,
    modelType: OnCallDutyPolicySchedule,
    title: "On-Call Schedule",
    description: "Reference to on-call schedule (mutually exclusive with user)",
  })
  @ManyToOne(
    () => {
      return OnCallDutyPolicySchedule;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "onCallDutyPolicyScheduleId" })
  public onCallDutyPolicySchedule?: OnCallDutyPolicySchedule = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateProjectIncomingCallPolicyEscalationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectIncomingCallPolicyEscalationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditProjectIncomingCallPolicyEscalationRule,
    ],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "On-Call Schedule ID",
    description:
      "ID of the on-call schedule to route to (mutually exclusive with userId)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public onCallDutyPolicyScheduleId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateProjectIncomingCallPolicyEscalationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectIncomingCallPolicyEscalationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditProjectIncomingCallPolicyEscalationRule,
    ],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "User",
    description:
      "Direct user reference (mutually exclusive with on-call schedule)",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userId" })
  public user?: User = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateProjectIncomingCallPolicyEscalationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectIncomingCallPolicyEscalationRule,
    ],
    update: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.EditProjectIncomingCallPolicyEscalationRule,
    ],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "User ID",
    description:
      "ID of the user to route to directly (mutually exclusive with onCallDutyPolicyScheduleId)",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateProjectIncomingCallPolicyEscalationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectIncomingCallPolicyEscalationRule,
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
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.CreateProjectIncomingCallPolicyEscalationRule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.SettingsAdmin,
      Permission.SettingsMember,
      Permission.SettingsViewer,
      Permission.ReadProjectIncomingCallPolicyEscalationRule,
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
}
