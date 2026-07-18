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
 * Internal table (no API access) recording ad-attributed conversions —
 * signups and paid subscriptions from visitors that carried ad click IDs —
 * and the status of uploading each of them to ad platforms (Google Ads
 * offline click conversions, Meta Conversions API). Written and read only by
 * the MarketingConversions worker job.
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
    "Ad-attributed conversions (signups, paid subscriptions) and their upload status to ad platforms for offline conversion tracking.",
})
@Entity({
  name: "MarketingConversion",
})
@Index("uq_marketing_conversion_type_user", ["conversionType", "userId"], {
  unique: true,
})
@Index(
  "uq_marketing_conversion_type_project",
  ["conversionType", "projectId"],
  {
    unique: true,
  },
)
export default class MarketingConversion extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: true,
    title: "Conversion Type",
    description: "SignUp or PaidSubscription.",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
  })
  public conversionType?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index("idx_marketing_conversion_user_id")
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "User ID",
    description: "User this conversion belongs to (SignUp conversions).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index("idx_marketing_conversion_project_id")
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: false,
    title: "Project ID",
    description:
      "Project this conversion belongs to (PaidSubscription conversions).",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    required: false,
    title: "Email",
    description:
      "Email of the converting user. Hashed before being sent to ad platforms that support enhanced matching (Meta).",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: true,
  })
  public email?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: true,
    title: "Click IDs",
    description:
      "Ad click identifiers (gclid, wbraid, gbraid, fbclid, ...) captured for this conversion.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: false,
  })
  public clickIds?: JSONObject = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Date,
    required: true,
    title: "Conversion At",
    description: "When the conversion happened.",
  })
  @Column({
    type: ColumnType.Date,
    nullable: false,
  })
  public conversionAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Number,
    required: false,
    title: "Conversion Value (USD Cents)",
    description:
      "Conversion value in USD cents (monthly recurring revenue for paid subscriptions). Null when unknown (custom pricing) or not applicable (signups).",
  })
  @Column({
    type: ColumnType.Number,
    nullable: true,
  })
  public conversionValueInUSDCents?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.JSON,
    required: false,
    title: "Upload State",
    description:
      "Per-ad-platform upload state, keyed by provider (google, meta, microsoft, linkedin, reddit, ...): { status: Uploaded|Failed|Skipped, attempts, error, uploadedAt }. Absent key or absent status means pending.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public uploadState?: JSONObject = undefined;
}
