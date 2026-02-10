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
import { Column, Entity } from "typeorm";

@TableAccessControl({
  create: [],
  read: [],
  update: [],
  delete: [],
})
@CrudApiEndpoint(new Route("/open-source-deployment"))
@TableMetadata({
  tableName: "OpenSourceDeployment",
  singularName: "Open Source Deployment",
  pluralName: "Open Source Deployments",
  icon: IconProp.Globe,
  tableDescription:
    "Open source deployment registrations from self-hosted instances.",
})
@Entity({
  name: "OpenSourceDeployment",
})
export default class OpenSourceDeployment extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.Email,
    title: "Email",
    description: "Email address of the user who registered.",
  })
  @Column({
    nullable: false,
    type: ColumnType.Email,
    length: ColumnLength.Email,
  })
  public email?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Name",
    description: "Full name of the user who registered.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Company Name",
    description: "Company name of the user who registered.",
  })
  @Column({
    nullable: true,
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
    type: TableColumnType.Phone,
    title: "Company Phone Number",
    description: "Phone number of the user who registered.",
  })
  @Column({
    nullable: true,
    type: ColumnType.Phone,
    length: ColumnLength.Phone,
  })
  public companyPhoneNumber?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Version",
    description: "OneUptime version of the self-hosted instance.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public version?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortText,
    title: "Instance URL",
    description: "URL of the self-hosted instance.",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public instanceUrl?: string = undefined;
}
