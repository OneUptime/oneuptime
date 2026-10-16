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
import IconProp from "../../Types/Icon/IconProp";
import { JSONObject } from "../../Types/JSON";
import CloudMarketplace from "../../Types/Marketplace/CloudMarketplace";
import MarketplaceUsageReportStatus from "../../Types/Marketplace/MarketplaceUsageReportStatus";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index } from "typeorm";

/*
 * One report of a marketplace-billed project's charges to its marketplace:
 * the plan's seats, active monitors and telemetry for one period, as a whole
 * number of usage units (one cent each).
 *
 * This is the record of what OneUptime billed through a marketplace, kept so
 * a customer's question about a line on their cloud bill can be answered, and
 * so a report is never sent twice: it is written down before it is sent, with
 * the period, quantity and timestamp the marketplace deduplicates on, and a
 * retry sends exactly that again (see MarketplaceUsageReporter).
 *
 * SaaS only (billing enabled). Master-admin only.
 */
@TableAccessControl({
  create: [],
  read: [],
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/marketplace-usage-report"))
@TableMetadata({
  tableName: "MarketplaceUsageReport",
  singularName: "Marketplace Usage Report",
  pluralName: "Marketplace Usage Reports",
  icon: IconProp.Billing,
  tableDescription:
    "Charges of marketplace-billed projects, as reported to AWS Marketplace, Microsoft Marketplace or Google Cloud Marketplace.",
})
@Entity({
  name: "MarketplaceUsageReport",
})
export default class MarketplaceUsageReport extends BaseModel {
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
    description: "The marketplace purchase this usage was reported against.",
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
    description: "The project whose usage this is.",
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
    description: "The cloud marketplace the usage was reported to.",
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
    type: TableColumnType.Date,
    title: "Period Start",
    description: "The start of the period this usage covers.",
    example: "2026-10-16T08:00:00.000Z",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public periodStart?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Period End",
    description: "The end of the period this usage covers.",
    example: "2026-10-16T09:00:00.000Z",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public periodEnd?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Usage Units",
    description: "How many usage units (one cent each) were reported.",
    example: 1250,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
  })
  public quantity?: number = undefined;

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
      "Pending (written, not yet confirmed), Reported (accepted by the marketplace) or Failed.",
    example: "Reported",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public status?: MarketplaceUsageReportStatus = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Reported At",
    description: "When the marketplace accepted the report.",
    example: "2026-10-16T09:05:00.000Z",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public reportedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Marketplace Record ID",
    description:
      "The marketplace's ID for the record: the Azure usage event ID, the AWS metering record ID or the Google Cloud operation ID.",
    example: "8c4b4b4f-3f1e-4c5a-9a7d-2f6e1d2c3b4a",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public externalReportId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Number,
    title: "Attempts",
    description: "How many times the report has been sent.",
    example: 1,
    defaultValue: 0,
    isDefaultValueColumn: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Number,
    default: 0,
  })
  public attempts?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.LongText,
    title: "Last Error",
    description: "Why the last attempt to send the report did not succeed.",
    example: "ThrottlingException",
  })
  @Column({
    nullable: true,
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
  })
  public lastError?: string = undefined;

  /*
   * How the units were arrived at: the plan, seats and active monitors at
   * report time, the telemetry charged, and what was carried in and out.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "Breakdown",
    description:
      "How the usage units were calculated: plan, seats, active monitors, telemetry, and the fraction carried over.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public breakdown?: JSONObject = undefined;
}
