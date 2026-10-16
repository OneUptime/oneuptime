import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import Decimal from "../../Types/Decimal";
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import CloudMarketplace from "../../Types/Marketplace/CloudMarketplace";
import MarketplaceSubscriptionStatus from "../../Types/Marketplace/MarketplaceSubscriptionStatus";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index } from "typeorm";

/*
 * One purchase of OneUptime Cloud on a cloud marketplace - AWS Marketplace,
 * Microsoft Marketplace (Azure) or Google Cloud Marketplace - and the project
 * it pays for.
 *
 * A row is written the moment the marketplace tells OneUptime about the
 * purchase (the buyer arriving on the landing page, or the marketplace's own
 * notification, whichever comes first), before anyone has linked it to a
 * project. The buyer then links it to a project of theirs (or a new one) on
 * the purchase page, and from then on the marketplace bills that project:
 * Project.billingMarketplace names it, the project's subscription columns
 * follow this row's status, and its usage is reported to the marketplace by
 * the hourly usage report (MarketplaceUsageReport).
 *
 * What identifies a purchase differs per marketplace (externalSubscriptionId):
 *   - Azure: the SaaS subscription ID.
 *   - AWS: the license ARN (concurrent agreements: one per offer accepted).
 *   - Google Cloud: the procurement account ID. A Google buyer signs up once
 *     per account, and the account's entitlements (orders) are tracked here
 *     as they come and go (externalEntitlementId).
 *
 * The project is a plain ID, not a relation: a deleted project must not take
 * the record of what a marketplace was told with it.
 *
 * SaaS only (billing enabled). Master-admin only - every list is empty, and
 * root and master admins short-circuit the checks. Nothing a project member
 * reads comes from this table: the project's own billingMarketplace column
 * is what the dashboard shows.
 */
@TableAccessControl({
  create: [],
  read: [],
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/marketplace-subscription"))
@TableMetadata({
  tableName: "MarketplaceSubscription",
  singularName: "Marketplace Subscription",
  pluralName: "Marketplace Subscriptions",
  icon: IconProp.Billing,
  tableDescription:
    "Purchases of OneUptime Cloud made on AWS Marketplace, Microsoft Marketplace or Google Cloud Marketplace, and the projects they pay for.",
})
@Entity({
  name: "MarketplaceSubscription",
})
@Index(["marketplace", "externalSubscriptionId"], { unique: true })
export default class MarketplaceSubscription extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Marketplace",
    description: "The cloud marketplace the purchase was made on.",
    example: "AWS",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public marketplace?: CloudMarketplace = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongText,
    title: "Marketplace Subscription ID",
    description:
      "What the marketplace identifies the purchase by: the Azure SaaS subscription ID, the AWS license ARN, or the Google Cloud procurement account ID.",
    example: "arn:aws:license-manager::123456789012:license:l-0123456789abcdef",
  })
  @Column({
    nullable: false,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public externalSubscriptionId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Marketplace Customer ID",
    description:
      "Who bought it, as the marketplace names them: the buyer's Microsoft Entra tenant ID, AWS account ID, or Google Cloud procurement account ID.",
    example: "123456789012",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public externalCustomerId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Marketplace Agreement or Entitlement ID",
    description:
      "The AWS agreement ID, or the Google Cloud entitlement (order) that is currently billed. Not used for Azure.",
    example: "agmt-4mwg1nevbokzw95eca5797ixs",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public externalEntitlementId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Marketplace Offer",
    description:
      "The offer or product bought: the Azure offer ID, the AWS product code, or the Google Cloud product.",
    example: "oneuptime",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public externalOfferId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Marketplace Plan",
    description:
      "The plan bought on the marketplace (Azure plan ID, Google Cloud plan). AWS has none.",
    example: "pay-as-you-go",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public externalPlanId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Quantity",
    description:
      "How many seats were bought, for a marketplace plan priced per user. Empty otherwise.",
    example: 10,
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public quantity?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Usage Reporting ID",
    description:
      "Google Cloud only: the entitlement's usage reporting ID, which usage is reported against (Service Control consumer ID).",
    example: "project_number:123456789012",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public usageReportingId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Status",
    description:
      "Pending (bought, not yet set up), Active (billed through the marketplace), Suspended (the marketplace paused billing) or Cancelled.",
    example: "Active",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: MarketplaceSubscriptionStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Marketplace State",
    description:
      "The marketplace's own word for where the purchase stands, as last read (Subscribed, ACTIVE, ENTITLEMENT_PENDING_CANCELLATION...).",
    example: "Subscribed",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public externalState?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    title: "Project ID",
    description:
      "The project this purchase pays for, once the buyer has linked one.",
    example: "5f8b9c0d-e1f2-3a4b-5c6d-7e8f9a0b1c2d",
  })
  @Column({
    nullable: true,
    type: ColumnType.ObjectID,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    title: "Linked By User ID",
    description: "The user who linked the purchase to the project.",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @Column({
    nullable: true,
    type: ColumnType.ObjectID,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public linkedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Linked At",
    description: "When the purchase was linked to the project.",
    example: "2026-10-16T09:30:00.000Z",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public linkedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Email,
    title: "Purchaser Email",
    description:
      "The email address the marketplace gave for the buyer, where it gives one (Azure).",
    example: "buyer@example.com",
  })
  @Column({
    nullable: true,
    type: ColumnType.Email,
    length: ColumnLength.Email,
  })
  public purchaserEmail?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Is Free Trial",
    description:
      "Whether the marketplace reports the purchase as being in a free trial.",
    example: false,
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: false,
  })
  public isFreeTrial?: boolean = undefined;

  /*
   * Whether OneUptime reports this project's plan and usage to the
   * marketplace. True for every public pay-as-you-go purchase. A master admin
   * turns it off for a deal whose price the marketplace already charges in
   * full (a private offer with a flat fee), so nothing is billed twice.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Boolean,
    title: "Is Usage Metered",
    description:
      "Whether the project's plan and usage are reported to the marketplace every hour. Turned off for a deal the marketplace already charges in full.",
    example: true,
    defaultValue: true,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: true,
  })
  public isUsageMetered?: boolean = undefined;

  /*
   * The SHA-256 of the one-use token that lets the buyer's browser link the
   * purchase to a project (MarketplaceClaimToken). Only the hash is kept; the
   * token itself lives in an HttpOnly cookie on the buyer's browser.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.HashedString,
    title: "Claim Token Hash",
    description:
      "SHA-256 of the token that lets the buyer link this purchase to a project.",
    hideColumnInDocumentation: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.HashedString,
    length: ColumnLength.HashedString,
  })
  public claimTokenHash?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Claim Token Expires At",
    description: "When the token that links this purchase stops working.",
    hideColumnInDocumentation: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public claimTokenExpiresAt?: Date = undefined;

  /*
   * Usage is reported in whole hours, from when the purchase was linked. This
   * is the end of the last hour reported; the next report starts here.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Usage Reported Until",
    description:
      "The end of the last period whose usage was reported to the marketplace.",
    example: "2026-10-16T09:00:00.000Z",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public usageReportedUntil?: Date = undefined;

  /*
   * Marketplaces bill whole usage units (one cent each). What a report could
   * not bill - the fraction of a cent left over - is carried into the next
   * one, so nothing is rounded away and nothing is charged twice.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Unreported Usage (USD)",
    description:
      "The fraction of a usage unit not yet reported, carried into the next report.",
    example: 0.0042,
  })
  @Column({
    nullable: true,
    type: ColumnType.Decimal,
    transformer: Decimal.getDatabaseTransformer(),
  })
  public unreportedUsageInUSD?: Decimal = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Synced At",
    description:
      "When OneUptime last heard from, or read from, the marketplace about this purchase.",
    example: "2026-10-16T09:30:00.000Z",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public lastSyncedAt?: Date = undefined;

  /*
   * What the marketplace last said about the purchase, for whoever has to
   * answer a customer's question about it. Never a token: the adapters copy
   * the fields they read, not the request.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Details",
    description:
      "What the marketplace last reported about the purchase (plan, term, buyer, offer).",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public details?: JSONObject = undefined;
}
