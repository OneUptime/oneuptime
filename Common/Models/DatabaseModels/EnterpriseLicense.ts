import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import EnterpriseLicenseUserCountSource from "../../Types/EnterpriseLicense/EnterpriseLicenseUserCountSource";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import Email from "../../Types/Email";
import IconProp from "../../Types/Icon/IconProp";
import { Column, Entity, Index } from "typeorm";

@TableAccessControl({
  create: [],
  read: [],
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/enterprise-license"))
@TableMetadata({
  tableName: "EnterpriseLicense",
  singularName: "Enterprise License",
  pluralName: "Enterprise Licenses",
  icon: IconProp.Lock,
  tableDescription: "Enterprise license keys issued by OneUptime.",
})
@Entity({
  name: "EnterpriseLicense",
})
export default class EnterpriseLicense extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Company Name",
    description: "Company name associated with this license.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public companyName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Email,
    title: "Email",
    description:
      "Contact email for this license. Set it to the address the customer booked their meeting with, so the licence can be joined to the conversion that produced it.",
  })
  @Index("idx_enterprise_license_email")
  @Column({
    nullable: true,
    type: ColumnType.Email,
    length: ColumnLength.Email,
    unique: false,
    transformer: Email.getDatabaseTransformer(),
  })
  public email?: Email = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "License Key",
    description: "Enterprise license key.",
    unique: true,
  })
  @Index({ unique: true })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    unique: true,
  })
  public licenseKey?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Date,
    title: "Expires At",
    description: "Expiration date of this license.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Date,
  })
  public expiresAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Annual Contract Value",
    description: "Annual contract value (in USD) for this license.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public annualContractValue?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    title: "Evaluation License",
    description:
      "When enabled, this key is for evaluation and testing only — the customer's installation shows an evaluation notice and it is not meant for production use.",
    defaultValue: false,
  })
  @Column({
    nullable: false,
    type: ColumnType.Boolean,
    default: false,
  })
  public isEvaluationLicense?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "User Limit",
    description:
      "Maximum number of users allowed under this enterprise license.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public userLimit?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Current User Count",
    description:
      "Most recent user count reported by the customer's self-hosted installation.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public currentUserCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "User Count Updated At",
    description:
      "Timestamp of the most recent user count report from the customer's self-hosted installation.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public userCountUpdatedAt?: Date = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "User Count Source",
    description:
      "Whether the current user count came from per-instance usage or a legacy license-wide report.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public userCountSource?: EnterpriseLicenseUserCountSource = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Number,
    title: "Legacy User Count",
    description:
      "Most recent license-wide user count from an older installation that cannot identify its instance.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Number,
  })
  public legacyUserCount?: number = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Date,
    title: "Legacy User Count Updated At",
    description:
      "Timestamp of the most recent license-wide user count report from an older installation.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Date,
  })
  public legacyUserCountUpdatedAt?: Date = undefined;
}
