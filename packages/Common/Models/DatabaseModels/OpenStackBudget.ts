import AlertSeverity from "./AlertSeverity";
import OnCallDutyPolicy from "./OnCallDutyPolicy";
import OpenStackCloud from "./OpenStackCloud";
import Project from "./Project";
import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  ValueTransformer,
} from "typeorm";

/*
 * What one OpenStack project may come to in a month, or a whole cloud with no project named, in the
 * currency of the cloud's prices. The same pattern as a connected cloud's budget (CloudBudget): the
 * first time in a month the estimate passes each threshold, and when the month is on course to pass
 * it, an alert is raised, and the next month starts again from nothing with last month's resolved.
 * Checked every time a cloud's usage is read (OpenStackBudgetEvaluator).
 *
 * This watches estimates. It doesn't stop anything and it isn't anyone's bill.
 */

// Postgres answers a decimal as text: read it back as the number it is.
const decimalTransformer: ValueTransformer = {
  to: (value: number | null | undefined): number | null => {
    return value === null || value === undefined ? null : value;
  },
  from: (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    const parsed: number = typeof value === "number" ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  },
};

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateOpenStackCloud,
];

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadOpenStackCloud,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditOpenStackCloud,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.DeleteOpenStackCloud,
];

@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/openstack-budget"))
@TableMetadata({
  tableName: "OpenStackBudget",
  singularName: "OpenStack Budget",
  pluralName: "OpenStack Budgets",
  icon: IconProp.Wallet,
  tableDescription:
    "What an OpenStack project may come to in a month, at the cloud's own prices. OneUptime alerts the first time in a month the estimate passes each threshold, and when the month is on course to pass the budget.",
})
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: updatePermissions,
})
@Entity({
  name: "OpenStackBudget",
})
export default class OpenStackBudget extends BaseModel {
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
    description: "Relation to the OneUptime project this budget belongs to.",
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
    description: "ID of the OneUptime project this budget belongs to.",
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
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "openStackCloudId",
    type: TableColumnType.Entity,
    modelType: OpenStackCloud,
    title: "OpenStack Cloud",
    description: "The cloud this budget watches.",
  })
  @ManyToOne(
    () => {
      return OpenStackCloud;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "openStackCloudId" })
  public openStackCloud?: OpenStackCloud = undefined;

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
    title: "OpenStack Cloud ID",
    description: "ID of the cloud this budget watches.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public openStackCloudId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "OpenStack Project",
    description:
      "The Keystone id of the project the budget is for. Empty: the whole cloud.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public openStackProjectId?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "What the budget is called.",
    example: "Payments team",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Enabled",
    description: "Whether the budget is watched and raises alerts.",
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
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Monthly Amount",
    description:
      "What the estimate may come to in a calendar month (UTC), in the currency of the cloud's prices.",
    example: "500",
  })
  @Column({
    nullable: false,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public monthlyAmount?: number = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Alert At",
    description:
      "The shares of the budget, in percent, an alert is raised at, comma separated: the first time in a month the estimate passes each.",
    defaultValue: "80,100",
    isDefaultValueColumn: true,
    example: "80,100",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: "80,100",
  })
  public alertThresholds?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Alert When On Course To Pass",
    description:
      "Also alert when the month is on course to pass the budget, if what's held now is held until it ends.",
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: true,
  })
  public alertOnProjection?: boolean = undefined;

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
    description: "The severity of the alerts the budget raises.",
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
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Alert Severity ID",
    description:
      "ID of the severity of the alerts the budget raises. Empty: the project's least severe.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public alertSeverityId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.EntityArray,
    modelType: OnCallDutyPolicy,
    title: "On-Call Policies",
    description: "The on-call policies the budget's alerts page.",
  })
  @ManyToMany(
    () => {
      return OnCallDutyPolicy;
    },
    { eager: false },
  )
  @JoinTable({
    name: "OpenStackBudgetOnCallDutyPolicy",
    inverseJoinColumn: {
      name: "onCallDutyPolicyId",
      referencedColumnName: "_id",
    },
    joinColumn: {
      name: "openStackBudgetId",
      referencedColumnName: "_id",
    },
  })
  public onCallDutyPolicies?: Array<OnCallDutyPolicy> = undefined;

  /*
   * What the worker last found, for the budget's row: this month's estimate so far and where it's
   * heading, and when. Empty while nothing has a price, because then there's nothing to compare.
   */
  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Spent This Month",
    description: "This month's estimate so far, when last checked.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public spentThisMonth?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Projected This Month",
    description:
      "What this month is on course to come to, when last checked.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public projectedThisMonth?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Checked At",
    description: "When the budget was last compared with the estimate.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastCheckedAt?: Date = undefined;

  /*
   * This month's alerts, so each threshold alerts once a month: which month, the thresholds passed
   * and whether the projection passed, and the alerts raised. Server only.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Alert State",
    description:
      "Which of this month's alerts the budget raised. Used by OneUptime only.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public alertState?: JSONObject = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description: "Relation to the user who made this budget.",
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
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description: "ID of the user who made this budget.",
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
    title: "Deleted by User",
    description: "Relation to the user who deleted this budget.",
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
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description: "ID of the user who deleted this budget.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;
}
