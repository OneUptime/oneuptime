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
@CrudApiEndpoint(new Route("/marketing-touchpoint"))
@TableMetadata({
  tableName: "MarketingTouchpoint",
  singularName: "Marketing Touchpoint",
  pluralName: "Marketing Touchpoints",
  icon: IconProp.ChartBar,
  tableDescription:
    "Privacy-bounded first-party acquisition visits and anonymous-to-account identity joins.",
})
@Entity({ name: "MarketingTouchpoint" })
@Index("uq_marketing_touchpoint_event_id", ["eventId"], { unique: true })
export default class MarketingTouchpoint extends BaseModel {
  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.ShortText, required: true })
  @Column({ type: ColumnType.ShortText, length: ColumnLength.ShortText, nullable: false })
  public eventId?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @Index("idx_marketing_touchpoint_visitor")
  @TableColumn({ type: TableColumnType.ShortText, required: true })
  @Column({ type: ColumnType.ShortText, length: ColumnLength.ShortText, nullable: false })
  public anonymousVisitorId?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.ShortText, required: true })
  @Column({ type: ColumnType.ShortText, length: ColumnLength.ShortText, nullable: false })
  public touchpointType?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.ShortText, required: true })
  @Column({ type: ColumnType.ShortText, length: ColumnLength.ShortText, nullable: false })
  public consentState?: string = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.JSON, required: true })
  @Column({ type: ColumnType.JSON, nullable: false })
  public attribution?: JSONObject = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.Date, required: true })
  @Column({ type: ColumnType.Date, nullable: false })
  public occurredAt?: Date = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @Index("idx_marketing_touchpoint_user_id")
  @TableColumn({ type: TableColumnType.ObjectID })
  @Column({ type: ColumnType.ObjectID, nullable: true, transformer: ObjectID.getDatabaseTransformer() })
  public userId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @Index("idx_marketing_touchpoint_project_id")
  @TableColumn({ type: TableColumnType.ObjectID })
  @Column({ type: ColumnType.ObjectID, nullable: true, transformer: ObjectID.getDatabaseTransformer() })
  public projectId?: ObjectID = undefined;

  @ColumnAccessControl({ create: [], read: [], update: [] })
  @TableColumn({ type: TableColumnType.ShortText })
  @Column({ type: ColumnType.ShortText, length: ColumnLength.ShortText, nullable: true })
  public externalReferenceId?: string = undefined;
}
