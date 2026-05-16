import OnCallDutyPolicySchedule from "./OnCallDutyPolicySchedule";
import Project from "./Project";
import Team from "./Team";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
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
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation()
@TenantColumn("projectId")
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Free,
  update: PlanType.Growth,
  delete: PlanType.Free,
})
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.CreateOnCallDutyPolicyScheduleOwnerTeam,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.OnCallViewer,
    Permission.ReadOnCallDutyPolicyScheduleOwnerTeam,
    Permission.ReadAllProjectResources,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.DeleteOnCallDutyPolicyScheduleOwnerTeam,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.EditOnCallDutyPolicyScheduleOwnerTeam,
  ],
})
@EnableWorkflow({
  create: true,
  delete: true,
  update: true,
  read: true,
})
@CrudApiEndpoint(new Route("/on-call-duty-policy-schedule-owner-team"))
@TableMetadata({
  tableName: "OnCallDutyPolicyScheduleOwnerTeam",
  singularName: "On-Call Schedule Team Owner",
  pluralName: "On-Call Schedule Team Owners",
  icon: IconProp.Calendar,
  tableDescription: "Add teams as owners to your on-call schedules.",
})
@Entity({
  name: "OnCallDutyPolicyScheduleOwnerTeam",
})
@Index(["onCallDutyPolicyScheduleId", "teamId", "projectId"])
export default class OnCallDutyPolicyScheduleOwnerTeam extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateOnCallDutyPolicyScheduleOwnerTeam,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyScheduleOwnerTeam,
      Permission.ReadAllProjectResources,
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
      nullable: false,
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
      Permission.CreateOnCallDutyPolicyScheduleOwnerTeam,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyScheduleOwnerTeam,
      Permission.ReadAllProjectResources,
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
      Permission.CreateOnCallDutyPolicyScheduleOwnerTeam,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyScheduleOwnerTeam,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "teamId",
    type: TableColumnType.Entity,
    modelType: Team,
    title: "Team",
    description:
      "Team that is the owner. All users in this team will receive notifications. ",
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

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateOnCallDutyPolicyScheduleOwnerTeam,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyScheduleOwnerTeam,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Team ID",
    description: "ID of your OneUptime Team in which this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public teamId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateOnCallDutyPolicyScheduleOwnerTeam,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyScheduleOwnerTeam,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "onCallDutyPolicyScheduleId",
    type: TableColumnType.Entity,
    modelType: OnCallDutyPolicySchedule,
    title: "On-Call Schedule",
    description:
      "Relation to On-Call Schedule Resource in which this object belongs",
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
      Permission.CreateOnCallDutyPolicyScheduleOwnerTeam,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyScheduleOwnerTeam,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "On-Call Schedule ID",
    description:
      "ID of your OneUptime On-Call Schedule in which this object belongs",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
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
      Permission.CreateOnCallDutyPolicyScheduleOwnerTeam,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyScheduleOwnerTeam,
      Permission.ReadAllProjectResources,
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
      Permission.CreateOnCallDutyPolicyScheduleOwnerTeam,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyScheduleOwnerTeam,
      Permission.ReadAllProjectResources,
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyScheduleOwnerTeam,
      Permission.ReadAllProjectResources,
    ],
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
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyScheduleOwnerTeam,
      Permission.ReadAllProjectResources,
    ],
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
    create: [],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyScheduleOwnerTeam,
      Permission.ReadAllProjectResources,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.Boolean,
    computed: true,
    hideColumnInDocumentation: true,
    required: true,
    isDefaultValueColumn: true,
    title: "Are Owners Notified",
    description: "Are owners notified of this resource ownership?",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isOwnerNotified?: boolean = undefined;
}
