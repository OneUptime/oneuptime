import OnCallDutyPolicy from "./OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "./OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicySchedule from "./OnCallDutyPolicySchedule";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import OwnedThrough from "../../Types/Database/AccessControl/OwnedThrough";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CanAccessIfCanReadOn from "../../Types/Database/CanAccessIfCanReadOn";
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
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation()
@CanAccessIfCanReadOn("onCallDutyPolicy")
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.CreateProjectOnCallDutyPolicyEscalationRuleSchedule,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.OnCallViewer,
    Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.DeleteProjectOnCallDutyPolicyEscalationRuleSchedule,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.EditProjectOnCallDutyPolicyEscalationRuleSchedule,
  ],
})
@CrudApiEndpoint(new Route("/on-call-duty-policy-escalation-rule-schedule"))
@OwnedThrough("onCallDutyPolicyId", OnCallDutyPolicy)
@Entity({
  name: "OnCallDutyPolicyEscalationRuleSchedule",
})
@TableMetadata({
  tableName: "OnCallDutyPolicyEscalationRuleSchedule",
  singularName: "Schedule's On-Call Duty Escalation Rule",
  pluralName: "Schedule's On-Call Duty Escalation Rules",
  icon: IconProp.Calendar,
  tableDescription:
    "Manage schedules for on-call duty policy escalation rules.",
})
export default class OnCallDutyPolicyEscalationRuleSchedule extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
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
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
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
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "onCallDutyPolicyId",
    type: TableColumnType.Entity,
    modelType: OnCallDutyPolicy,
    title: "On-Call Policy",
    description:
      "Relation to On-Call Policy where this escalation rule belongs.",
  })
  @ManyToOne(
    () => {
      return OnCallDutyPolicy;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "onCallDutyPolicyId" })
  public onCallDutyPolicy?: OnCallDutyPolicy = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "On-Call Policy ID",
    description:
      "ID of your On-Call Policy where this escalation rule belongs.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public onCallDutyPolicyId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "onCallDutyPolicyScheduleId",
    type: TableColumnType.Entity,
    modelType: OnCallDutyPolicySchedule,
    title: "On Call Policy Schedule",
    description:
      "Relation to On Call Policy Schedule who is in this escalation rule.",
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
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "On Call Duty Policy Schedule ID",
    description: "ID of the on call schedule which is in this escalation rule.",
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
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "onCallDutyPolicyEscalationRuleId",
    type: TableColumnType.Entity,
    modelType: OnCallDutyPolicyEscalationRule,
    title: "Escalation Rule",
    description:
      "Relation to On-Call Policy Escalation Rule where this user belongs.",
  })
  @ManyToOne(
    () => {
      return OnCallDutyPolicyEscalationRule;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "onCallDutyPolicyEscalationRuleId" })
  public onCallDutyPolicyEscalationRule?: OnCallDutyPolicyEscalationRule =
    undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "On-Call Policy Escalation Rule ID",
    description:
      "ID of your On-Call Policy Escalation Rule where this user belongs.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public onCallDutyPolicyEscalationRuleId?: ObjectID = undefined;

  /*
   * Who the rule pages in this schedule: whoever is on call (false, as every
   * schedule of a rule always did), or the next person in the rotation after
   * them (true) - the backup a level after the on-call person's own pages.
   * Set when the schedule is added to the rule and never changed: the
   * dashboard removes the row and adds another to change it.
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    update: [],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Page Next in Rotation",
    description:
      "When true, the escalation rule pages the next person in this schedule's rotation - the person after whoever is on call, passing over anyone who is away - instead of whoever is on call. Use it on the level after the one that pages the schedule, so a page nobody acknowledges goes to the backup from the same rotation.",
    defaultValue: false,
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public pageNextInRotation?: boolean = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
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
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateProjectOnCallDutyPolicyEscalationRuleSchedule,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
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
