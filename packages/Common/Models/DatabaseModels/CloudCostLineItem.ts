import CloudAccount from "./CloudAccount";
import CloudCostGroup from "./CloudCostGroup";
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
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import EnableMCP from "../../Types/Database/EnableMCP";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import {
  CloudCostLineItemKind,
  CloudCostLineItemRecurrence,
} from "../../Types/Cloud/CloudCostAllocation";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  ValueTransformer,
} from "typeorm";

/*
 * A CUSTOM LINE ITEM: a charge or a credit the cloud's bill does not carry
 * - a share of a support contract, an enterprise discount, an internal
 * markup or a platform fee - added for chargeback. Once, on a day, or every
 * month, spread over the month's days so part of a month takes its part.
 *
 * Added to an account, it goes through the cost views' rules as that
 * account's costs do; added to a cost group, it is that group's. Every read
 * keeps it apart from what the cloud billed (CloudCostAllocation's
 * lineItems), so the cloud's own figures still match its console.
 */

// Postgres answers a decimal as text: read it back as the number it is.
const decimalTransformer: ValueTransformer = {
  to: (value: number | null | undefined): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    return value;
  },
  from: (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "number") {
      return value;
    }
    const parsed: number = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  },
};

const createPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.CreateCloudResource,
];

const readPermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadCloudResource,
];

const updatePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.EditCloudResource,
];

const deletePermissions: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.DeleteCloudResource,
];

@EnableDocumentation()
@EnableMCP()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@CrudApiEndpoint(new Route("/cloud-cost-line-item"))
@TableMetadata({
  tableName: "CloudCostLineItem",
  singularName: "Cloud Cost Line Item",
  pluralName: "Cloud Cost Line Items",
  icon: IconProp.ReceiptPercent,
  tableDescription:
    "Charges and credits your clouds' bills do not carry, such as a share of a support contract or an internal markup, added to an account or a cost group for chargeback.",
})
@TableAccessControl({
  create: createPermissions,
  read: readPermissions,
  delete: deletePermissions,
  update: updatePermissions,
})
@Entity({
  name: "CloudCostLineItem",
})
export default class CloudCostLineItem extends BaseModel {
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
    description: "Relation to the project this line item belongs to.",
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
    description: "ID of the project this line item belongs to.",
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
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "What the charge or credit is.",
    example: "Support contract share",
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
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Description",
    description: "Why the line item is added, in your team's words.",
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
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Kind",
    description:
      "Charge (adds to the spend) or Credit (takes off it, such as a discount).",
    defaultValue: CloudCostLineItemKind.Charge,
    isDefaultValueColumn: true,
    allowedValues: Object.values(CloudCostLineItemKind),
    example: "Charge",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: CloudCostLineItemKind.Charge,
  })
  public kind?: CloudCostLineItemKind = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Amount",
    description:
      "How much, in the line item's currency: once, or each month. Always positive; Kind says whether it adds or takes off.",
    example: "1200",
  })
  @Column({
    nullable: false,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public amount?: number = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Currency",
    description:
      "The currency of the amount, as three letters. A read in another currency leaves it out.",
    defaultValue: "USD",
    isDefaultValueColumn: true,
    example: "USD",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: "USD",
  })
  public currency?: string = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Repeats",
    description:
      "Once (on the start date) or Monthly (every month from the start date's month, spread over each month's days).",
    defaultValue: CloudCostLineItemRecurrence.Monthly,
    isDefaultValueColumn: true,
    allowedValues: Object.values(CloudCostLineItemRecurrence),
    example: "Monthly",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    default: CloudCostLineItemRecurrence.Monthly,
  })
  public recurrence?: CloudCostLineItemRecurrence = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Start Date",
    description:
      "The day a one-off line item is for, or the first month a monthly one counts in (UTC).",
  })
  @Column({ type: ColumnType.Date, nullable: false })
  public startDate?: Date = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "End Date",
    description:
      "For a monthly line item, the last month it counts in. Empty: every month from the start.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public endDate?: Date = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "cloudAccountId",
    type: TableColumnType.Entity,
    modelType: CloudAccount,
    title: "Cloud Account",
    description:
      "The account the line item is added to. Its cost views sort it as they sort the account's costs.",
  })
  @ManyToOne(
    () => {
      return CloudAccount;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudAccountId" })
  public cloudAccount?: CloudAccount = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Cloud Account ID",
    description: "ID of the account the line item is added to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudAccountId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @TableColumn({
    manyToOneRelationColumn: "cloudCostGroupId",
    type: TableColumnType.Entity,
    modelType: CloudCostGroup,
    title: "Cost Group",
    description: "The cost group the line item is added to.",
  })
  @ManyToOne(
    () => {
      return CloudCostGroup;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "cloudCostGroupId" })
  public cloudCostGroup?: CloudCostGroup = undefined;

  @ColumnAccessControl({
    create: createPermissions,
    read: readPermissions,
    update: updatePermissions,
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    canReadOnRelationQuery: true,
    title: "Cost Group ID",
    description: "ID of the cost group the line item is added to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudCostGroupId?: ObjectID = undefined;

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
    description: "Relation to the user who created this line item.",
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
    create: createPermissions,
    read: readPermissions,
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description: "ID of the user who created this line item.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
