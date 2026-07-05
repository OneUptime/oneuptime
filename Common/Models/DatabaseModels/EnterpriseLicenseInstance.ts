import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import EnterpriseLicense from "./EnterpriseLicense";
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
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@TableAccessControl({
  create: [],
  read: [],
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/enterprise-license-instance"))
@TableMetadata({
  tableName: "EnterpriseLicenseInstance",
  singularName: "Enterprise License Instance",
  pluralName: "Enterprise License Instances",
  icon: IconProp.Lock,
  tableDescription:
    "Self-hosted OneUptime instances that report usage against an enterprise license. One license can be used across multiple instances (staging, production, etc.) and users are counted uniquely across all of them.",
})
@Entity({
  name: "EnterpriseLicenseInstance",
})
export default class EnterpriseLicenseInstance extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "enterpriseLicenseId",
    type: TableColumnType.Entity,
    modelType: EnterpriseLicense,
    title: "Enterprise License",
    description: "Enterprise license this instance reports usage against.",
  })
  @ManyToOne(
    () => {
      return EnterpriseLicense;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "enterpriseLicenseId" })
  public enterpriseLicense?: EnterpriseLicense = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    canReadOnRelationQuery: true,
    title: "Enterprise License ID",
    description: "ID of the enterprise license this instance belongs to.",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public enterpriseLicenseId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Instance ID",
    description:
      "Unique identifier of the self-hosted OneUptime instance (auto-generated on the instance when it is installed).",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public instanceId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Host",
    description:
      "Host of the self-hosted instance (for example oneuptime.acme.com). Shown to the customer so they can tell instances apart.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public host?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "User Count",
    description: "Most recent user count reported by this instance.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public userCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.JSON,
    title: "User Email Hashes",
    description:
      "SHA-256 hashes of the emails of users on this instance. Used to count unique users across all instances of a license without storing raw emails.",
  })
  @Column({
    type: ColumnType.JSON,
    nullable: true,
  })
  public userEmailHashes?: Array<string> = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Last Reported At",
    description: "Timestamp of the most recent report from this instance.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public lastReportedAt?: Date = undefined;
}
