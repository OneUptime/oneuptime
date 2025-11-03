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
}
