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
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index } from "typeorm";

/*
 * Internal table recording server-confirmed marketing conversions and the
 * status of uploading eligible ad-attributed rows to ad platforms. Browser
 * analytics are evidence only and never write this ledger directly.
 */
@TableAccessControl({
  create: [],
  read: [],
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/marketing-conversion"))
@TableMetadata({
  tableName: "MarketingConversion",
  singularName: "Marketing Conversion",
  pluralName: "Marketing Conversions",
  icon: IconProp.ChartBar,
  tableDescription:
    "Server-confirmed marketing conversions and their optional ad-platform upload status.",
})
@Entity({ name: "MarketingConversion" })
@Index("uq_marketing_conversion_type_user", ["conversionType", "userId"], {
  unique: true,
})
@Index(
  "uq_marketing_conversion_type_project",
  ["conversionType", "projectId"],
  { unique: true },
)
export default class MarketingConversion extends BaseModel {
  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Conversion Type",
    description: "Canonical server-confirmed conversion type.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public conversionType?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @Index("idx_marketing_conversion_user_id")
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "User ID",
    description: "User this conversion belongs to, when known.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @Index("idx_marketing_conversion_project_id")
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Project ID",
    description: "Project this conversion belongs to, when known.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Email",
    description:
      "Internal matching email. Hashed before upload to providers that support enhanced matching.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public email?: string | undefined = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.JSON,
    required: true,
    title: "Click IDs",
    description: "Allowlisted ad click identifiers retained for this conversion.",
  })
  @Column({ type: ColumnType.JSON, nullable: false })
  public clickIds?: JSONObject = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.Date,
    required: true,
    title: "Conversion At",
    description: "When the conversion happened.",
  })
  @Column({ type: ColumnType.Date, nullable: false })
  public conversionAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Conversion Value (USD Cents)",
    description:
      "Conversion value in USD cents. Null when unknown or not applicable.",
  })
  @Column({ type: ColumnType.Number, nullable: true })
  public conversionValueInUSDCents?: number | undefined = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Upload State",
    description:
      "Per-ad-platform upload state. Ledger-only conversion types are explicitly skipped.",
  })
  @Column({ type: ColumnType.JSON, nullable: true })
  public uploadState?: JSONObject = undefined;
}
