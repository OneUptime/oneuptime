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

@TableAccessControl({ create: [], read: [], update: [], delete: [] })
@CrudApiEndpoint(new Route("/marketing-conversion"))
@TableMetadata({
  tableName: "MarketingConversion",
  singularName: "Marketing Conversion",
  pluralName: "Marketing Conversions",
  icon: IconProp.ChartBar,
  tableDescription:
    "Durable acquisition touchpoints, attributed conversions, identity joins, and ad-platform upload state.",
})
@Entity({ name: "MarketingConversion" })
@Index("uq_marketing_conversion_type_user", ["conversionType", "userId"], { unique: true })
@Index("uq_marketing_conversion_type_project", ["conversionType", "projectId"], { unique: true })
@Index("uq_marketing_conversion_source_event", ["sourceEventId"], { unique: true })
export default class MarketingConversion extends BaseModel {
  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.ShortText, required: true, title: "Conversion Type" })
  @Column({ type: ColumnType.ShortText, length: ColumnLength.ShortText, nullable: false })
  public conversionType?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @Index("idx_marketing_conversion_user_id")
  @TableColumn({ type: TableColumnType.ObjectID })
  @Column({ type: ColumnType.ObjectID, nullable: true, transformer: ObjectID.getDatabaseTransformer() })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @Index("idx_marketing_conversion_project_id")
  @TableColumn({ type: TableColumnType.ObjectID })
  @Column({ type: ColumnType.ObjectID, nullable: true, transformer: ObjectID.getDatabaseTransformer() })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @Index("idx_marketing_conversion_visitor")
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({ type: ColumnType.ShortText, length: ColumnLength.ShortText, nullable: true })
  public anonymousVisitorId?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({ type: ColumnType.ShortText, length: ColumnLength.ShortText, nullable: true })
  public sourceEventId?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({ type: ColumnType.ShortText, length: ColumnLength.ShortText, nullable: true })
  public touchpointType?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({ type: ColumnType.ShortText, length: ColumnLength.ShortText, nullable: true })
  public consentState?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({ type: ColumnType.ShortText, length: ColumnLength.ShortText, nullable: true })
  public externalReferenceId?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({ type: ColumnType.ShortText, length: ColumnLength.ShortText, nullable: true })
  public email?: string | undefined = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.JSON, required: true })
  @Column({ type: ColumnType.JSON, nullable: false })
  public clickIds?: JSONObject = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.JSON })
  @Column({ type: ColumnType.JSON, nullable: true })
  public attribution?: JSONObject = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.Date, required: true })
  @Column({ type: ColumnType.Date, nullable: false })
  public conversionAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.Number })
  @Column({ type: ColumnType.Number, nullable: true })
  public conversionValueInUSDCents?: number | undefined = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.JSON })
  @Column({ type: ColumnType.JSON, nullable: true })
  public uploadState?: JSONObject = undefined;
}
