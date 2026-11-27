import CloudAccount from "./CloudAccount";
import Project from "./Project";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import { CloudCommitmentKind } from "../../Types/Cloud/CloudCommitments";
import {
  CloudCommitmentPaymentOption,
  CloudCommitmentScope,
  CloudCommitmentState,
} from "../../Types/Cloud/CloudCommitmentInventory";
import { CloudProvider } from "../../Types/Cloud/CloudPlatform";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import TableBillingAccessControl from "../../Types/Database/AccessControl/TableBillingAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
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
 * One commitment a connected cloud has (#11011): an AWS Savings Plan or
 * Reserved Instance, an Azure reservation or savings plan, a Google Cloud
 * committed use discount - with its term, when it ends, how it is paid,
 * what it commits to, and over the last 30 and 7 days what of it was used
 * and what the usage it covered would have cost on demand
 * (CloudCommitmentInventory).
 *
 * Written by the account's cloud connection once a day (the savings lane,
 * CloudCommitmentWriter), one row per commitment by its id in its cloud,
 * kept in step with the cloud: one it no longer lists, among the accounts
 * it read in full, is removed. An organization's are read from its
 * management account and kept on the account that bought each. Not
 * user-editable. Cloud > Spend > Commitments lists them, with the plan to
 * renew each one that ends soon; CloudCommitmentAlertEvaluator alerts
 * before one ends and while one is under-used (alertState).
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

const READ_PERMISSIONS: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.ReadCloudResource,
];

const READ_ONLY: {
  create: Array<Permission>;
  read: Array<Permission>;
  update: Array<Permission>;
} = { create: [], read: READ_PERMISSIONS, update: [] };

@EnableDocumentation()
@TableBillingAccessControl({
  create: PlanType.Free,
  read: PlanType.Free,
  update: PlanType.Free,
  delete: PlanType.Free,
})
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: READ_PERMISSIONS,
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/cloud-commitment"))
@TableMetadata({
  tableName: "CloudCommitment",
  singularName: "Cloud Commitment",
  pluralName: "Cloud Commitments",
  icon: IconProp.Billing,
  tableDescription:
    "The Savings Plans, Reserved Instances, Azure reservations and savings plans and Google Cloud committed use discounts of your connected clouds: their term, when they end, what they commit to, and what of them was used over the last 30 and 7 days. Written by the cloud connections; not user-editable.",
})
@Index(["projectId", "provider", "commitmentId"], {
  unique: true,
})
@Entity({
  name: "CloudCommitment",
})
export default class CloudCommitment extends BaseModel {
  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "Relation to the project this commitment belongs to.",
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

  @ColumnAccessControl(READ_ONLY)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Project ID",
    description: "ID of the project this commitment belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    manyToOneRelationColumn: "cloudAccountId",
    type: TableColumnType.Entity,
    modelType: CloudAccount,
    title: "Cloud Account",
    description:
      "The account the commitment was bought in, or the account its connection reads it from.",
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

  @ColumnAccessControl(READ_ONLY)
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Cloud Account ID",
    description: "ID of the account the commitment is kept on.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public cloudAccountId?: ObjectID = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(CloudProvider),
    canReadOnRelationQuery: true,
    title: "Cloud",
    description: "Which cloud the commitment is in: 'aws', 'azure' or 'gcp'.",
    example: "aws",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public provider?: CloudProvider = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "Commitment ID",
    description:
      "The cloud's own id for the commitment: a Savings Plan's ARN, a reservation's id, a Google Cloud commitment's URL.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public commitmentId?: string = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(CloudCommitmentKind),
    canReadOnRelationQuery: true,
    title: "Kind",
    description:
      "'savings-plans' (AWS Savings Plans, Azure savings plans), 'reservations' (AWS Reserved Instances, Azure reservations) or 'committed-use-discounts' (Google Cloud).",
    example: "savings-plans",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public kind?: CloudCommitmentKind = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    canReadOnRelationQuery: true,
    title: "Name",
    description:
      "What the cloud calls the commitment: an Azure reservation's display name, a Google Cloud commitment's name, an AWS one's id.",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public name?: string = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Type",
    description:
      "The commitment's type in its cloud's words: 'Compute Savings Plans', 'Amazon Relational Database Service', 'VirtualMachines', 'GENERAL_PURPOSE_E2'.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public commitmentType?: string = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Covers",
    description:
      "What the commitment pays for, in its cloud's words: an instance type and count, a machine family, vCPUs and memory.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public covers?: string = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Region",
    description: "The Region the commitment applies in; empty for any Region.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public region?: string = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(CloudCommitmentScope),
    title: "Scope",
    description:
      "Who it applies to: 'account' (the one it was bought in), 'shared' (every account of its organization or billing scope), 'management-group' or 'resource-group'.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public scope?: CloudCommitmentScope = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Applies To",
    description:
      "The account, management group or resource group it applies to, as its cloud names it; empty when it is shared.",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public appliesTo?: string = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Term (Months)",
    description: "How long the commitment runs, in months: 12, 36 or 60.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public termMonths?: number = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(CloudCommitmentPaymentOption),
    title: "Payment Option",
    description:
      "How it is paid for: 'all-upfront', 'partial-upfront' or 'no-upfront' (paid as it runs).",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public paymentOption?: CloudCommitmentPaymentOption = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Starts At",
    description: "When the commitment started, or starts.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public startsAt?: Date = undefined;

  @ColumnAccessControl(READ_ONLY)
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Ends At",
    description: "When the commitment ends.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public endsAt?: Date = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    allowedValues: Object.values(CloudCommitmentState),
    canReadOnRelationQuery: true,
    title: "State",
    description:
      "'active', 'queued' (bought to start later), 'pending' (its payment is going through), 'expired' or 'retired'.",
    example: "active",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public state?: CloudCommitmentState = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Renews Itself",
    description:
      "Whether the cloud buys it again when it ends (Azure's and Google Cloud's auto-renew).",
  })
  @Column({ type: ColumnType.Boolean, nullable: true })
  public isAutoRenew?: boolean = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Hourly Commitment",
    description:
      "What a savings plan commits to spend each hour, in its currency.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public hourlyCommitment?: number = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Quantity",
    description:
      "How many instances, nodes or units a reservation holds, or vCPUs a Google Cloud commitment does.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public quantity?: number = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Upfront Cost",
    description: "What was paid for it up front, in its currency.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public upfrontCost?: number = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Hourly Fee",
    description: "What it costs each hour besides its upfront payment.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public recurringHourlyCost?: number = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Currency",
    description: "The currency its figures are in.",
    example: "USD",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public currency?: string = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    canReadOnRelationQuery: true,
    title: "Utilization",
    description:
      "How much of it was used over the last 30 days, in percent; empty where its cloud does not say.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public utilizationPercent?: number = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Utilization (7 Days)",
    description:
      "How much of it was used over the last 7 days, in percent: what an under-use alert judges.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: decimalTransformer,
  })
  public weekUtilizationPercent?: number = undefined;

  /*
   * What its use came to over the last 30 and 7 days, in its currency
   * (CloudCommitmentFigures): what it cost, what of it was used and left
   * unused, and what the usage it covered would have cost on demand.
   */
  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Figures",
    description:
      "What it cost, what of it was used and left unused, and what the usage it covered would have cost on demand, over the last 30 days - and what it cost and left unused over the last 7.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public figures?: JSONObject = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    canReadOnRelationQuery: true,
    title: "Last Seen At",
    description: "When its connection last read the commitment.",
  })
  @Column({ type: ColumnType.Date, nullable: true })
  public lastSeenAt?: Date = undefined;

  /*
   * Which alerts it raised (CloudCommitmentAlertState): the days-before-
   * its-end it was alerted at, and its open alerts. Server only.
   */
  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Alert State",
    description:
      "Which of the commitment's alerts were raised. Used by OneUptime only.",
  })
  @Column({
    nullable: true,
    type: ColumnType.JSON,
  })
  public alertState?: JSONObject = undefined;

  @ColumnAccessControl(READ_ONLY)
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created By User ID",
    description:
      "ID of the user who created this row (the connection writes as root).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
