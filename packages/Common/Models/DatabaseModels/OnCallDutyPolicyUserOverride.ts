import OnCallDutyPolicy from "./OnCallDutyPolicy";
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
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";

@EnableDocumentation()
@CanAccessIfCanReadOn("onCallDutyPolicy")
@TableBillingAccessControl({
  create: PlanType.Growth,
  read: PlanType.Growth,
  update: PlanType.Growth,
  delete: PlanType.Growth,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.CreateOnCallDutyPolicyUserOverride,
  ],
  read: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.OnCallViewer,
    Permission.ReadOnCallDutyPolicyUserOverride,
  ],
  delete: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.DeleteOnCallDutyPolicyUserOverride,
  ],
  update: [
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.OnCallAdmin,
    Permission.OnCallMember,
    Permission.EditOnCallDutyPolicyUserOverride,
  ],
})
@CrudApiEndpoint(new Route("/on-call-duty-policy-user-override"))
@OwnedThrough("onCallDutyPolicyId", OnCallDutyPolicy)
@Entity({
  name: "OnCallDutyPolicyUserOverride",
})
@TableMetadata({
  tableName: "OnCallDutyPolicyUserOverride",
  singularName: "User Override",
  pluralName: "User Overrides",
  icon: IconProp.Call,
  tableDescription:
    "While someone is away, a user override sends the alerts that would page them to the person who covers, for a set time. An override on an on-call policy applies to that policy only; one without a policy applies to every on-call policy.",
})
export default class OnCallDutyPolicyUserOverride extends BaseModel {
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateOnCallDutyPolicyUserOverride,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyUserOverride,
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
      Permission.CreateOnCallDutyPolicyUserOverride,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyUserOverride,
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

  /*
   * If this is null then it's a global override
   * If this is set then it's a policy specific override
   * Policy specifc override will take precedence over global override
   */

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateOnCallDutyPolicyUserOverride,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyUserOverride,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "onCallDutyPolicyId",
    type: TableColumnType.Entity,
    modelType: OnCallDutyPolicy,
    title: "On-Call Policy",
    description:
      "The on-call policy this override applies to. Empty for a global override, which applies to every on-call policy.",
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
      Permission.CreateOnCallDutyPolicyUserOverride,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyUserOverride,
    ],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "On-Call Policy ID",
    description:
      "ID of the on-call policy this override applies to. Leave it empty for a global override, which applies to every on-call policy.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
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
      Permission.CreateOnCallDutyPolicyUserOverride,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyUserOverride,
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
      Permission.CreateOnCallDutyPolicyUserOverride,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyUserOverride,
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

  /*
   * The person who is AWAY: alerts that would page them go to the
   * routeAlertsToUser instead while the override is in force. Paging looks
   * overrides up by this column (OnCallDutyPolicyEscalationRuleService.
   * getRouteAlertToUserId), and schedules swap this person out
   * (UserOverrideUtil). The dashboard asks for it as "Who is away?".
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateOnCallDutyPolicyUserOverride,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyUserOverride,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "overrideUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Override User",
    description:
      "The user who is away. While the override is in force, alerts that would page this user go to the Route Alerts To User instead.",
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
  @JoinColumn({ name: "overrideUserId" })
  public overrideUser?: User = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateOnCallDutyPolicyUserOverride,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyUserOverride,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Override User ID",
    description:
      "ID of the user who is away. While the override is in force, alerts that would page this user go to the user in Route Alerts To User ID instead.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public overrideUserId?: ObjectID = undefined;

  /*
   * The person who COVERS: they get the overrideUser's alerts while the
   * override is in force. The dashboard asks for it as "Who covers?".
   */
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateOnCallDutyPolicyUserOverride,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyUserOverride,
    ],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "routeAlertsToUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Route Alerts To User",
    description:
      "The user who covers. While the override is in force, this user gets the alerts that would page the Override User.",
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
  @JoinColumn({ name: "routeAlertsToUserId" })
  public routeAlertsToUser?: User = undefined;

  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateOnCallDutyPolicyUserOverride,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyUserOverride,
    ],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Route Alerts To User ID",
    description:
      "ID of the user who covers. While the override is in force, this user gets the alerts that would page the user in Override User ID.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public routeAlertsToUserId?: ObjectID = undefined;

  @TableColumn({
    title: "Start At",
    type: TableColumnType.Date,
    required: true,
    description:
      "When the override starts sending the Override User's alerts to the Route Alerts To User.",
  })
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateOnCallDutyPolicyUserOverride,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyUserOverride,
    ],
    update: [],
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public startsAt?: Date = undefined;

  @TableColumn({
    title: "Ends At",
    type: TableColumnType.Date,
    required: true,
    description:
      "When the override ends, which has to be after it starts. From then on, alerts page the Override User again.",
  })
  @ColumnAccessControl({
    create: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.CreateOnCallDutyPolicyUserOverride,
    ],
    read: [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.OnCallAdmin,
      Permission.OnCallMember,
      Permission.OnCallViewer,
      Permission.ReadOnCallDutyPolicyUserOverride,
    ],
    update: [],
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public endsAt?: Date = undefined;

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
