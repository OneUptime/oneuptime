import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ProjectBalanceType from "../../Types/Billing/ProjectBalanceType";
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
import CloudMarketplace from "../../Types/Marketplace/CloudMarketplace";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index } from "typeorm";

/*
 * A one-off charge to a marketplace-billed project, billed through its cloud
 * marketplace: a top-up of its balance for SMS, calls, WhatsApp and Telegram,
 * or of its AI credits, that a card would have paid for.
 *
 * The balance is credited at once; the charge waits here until the next
 * hourly usage report, which bills it with the rest of the hour's usage
 * (MarketplaceUsageReporter) and records itself on the charge
 * (marketplaceUsageReportId). It never goes to the marketplace on its own:
 * Microsoft Marketplace takes one usage event per hour per dimension, so a
 * second event in the hour would be refused as a duplicate.
 *
 * SaaS only (billing enabled). Master-admin only.
 */
@TableAccessControl({
  create: [],
  read: [],
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/marketplace-charge"))
@TableMetadata({
  tableName: "MarketplaceCharge",
  singularName: "Marketplace Charge",
  pluralName: "Marketplace Charges",
  icon: IconProp.Billing,
  tableDescription:
    "Balance top-ups of marketplace-billed projects, billed through AWS Marketplace, Microsoft Marketplace or Google Cloud Marketplace.",
})
@Entity({
  name: "MarketplaceCharge",
})
export default class MarketplaceCharge extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ObjectID,
    title: "Marketplace Subscription ID",
    description: "The marketplace purchase that pays for the charge.",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @Column({
    nullable: false,
    type: ColumnType.ObjectID,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public marketplaceSubscriptionId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ObjectID,
    title: "Project ID",
    description: "The project whose balance was topped up.",
    example: "5f8b9c0d-e1f2-3a4b-5c6d-7e8f9a0b1c2d",
  })
  @Column({
    nullable: false,
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
    required: true,
    type: TableColumnType.ShortText,
    title: "Marketplace",
    description: "The cloud marketplace the charge is billed through.",
    example: "Azure",
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
    type: TableColumnType.ShortText,
    title: "Balance",
    description:
      "The balance that was topped up: SmsOrCall (SMS, calls, WhatsApp and Telegram) or AI (AI credits).",
    example: "SmsOrCall",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public balanceType?: ProjectBalanceType = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Amount (USD)",
    description: "What the top-up costs, in USD.",
    example: 20,
  })
  @Column({
    nullable: false,
    type: ColumnType.Decimal,
    transformer: Decimal.getDatabaseTransformer(),
  })
  public amountInUSD?: Decimal = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    title: "Is Automatic",
    description:
      "Whether Auto Recharge made the top-up, rather than somebody pressing Recharge.",
    example: false,
    defaultValue: false,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: false,
  })
  public isAutomatic?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: false,
    type: TableColumnType.ObjectID,
    title: "Marketplace Usage Report ID",
    description:
      "The hourly usage report that bills the charge. Empty until the next report takes it.",
    example: "8c4b4b4f-3f1e-4c5a-9a7d-2f6e1d2c3b4a",
  })
  @Column({
    nullable: true,
    type: ColumnType.ObjectID,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public marketplaceUsageReportId?: ObjectID = undefined;
}
