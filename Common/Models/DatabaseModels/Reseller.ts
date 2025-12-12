import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
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
import Permission from "../../Types/Permission";
import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";

@TableAccessControl({
  create: [],
  read: [Permission.ProjectOwner, Permission.Public],
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/reseller"))
@TableMetadata({
  tableName: "Reseller",
  singularName: "Reseller",
  pluralName: "Resellers",
  icon: IconProp.Billing,
  tableDescription: "List of Resellers that sell OneUptime to their customers",
})
@Entity({
  name: "Reseller",
})
export default class Reseller extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [Permission.Public],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Resller ID",
    description: "ID that is shared between resller and OneUptime.",
    example: "reseller_1234567890",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public resellerId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Name",
    description: "Name of the reseller",
    example: "Enterprise Solutions Inc.",
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
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Description",
    description: "Description of the reseller",
    example: "Leading provider of monitoring solutions for enterprises",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public description?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: false,
    title: "Username",
    description: "Username of the reseller",
    example: "enterprise_admin",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public username?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: false,
    title: "Password",
    description: "Password for reseller to login",
    example: "$2b$10$abcdefghijklmnopqrstuvwxyz1234567890",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public password?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "createdByUserId",
    type: TableColumnType.Entity,
    modelType: User,
    title: "Created by User",
    description:
      "Relation to User who created this object (if this object was created by a User)",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "createdByUserId" })
  public createdByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Created by User ID",
    description:
      "User ID who created this object (if this object was created by a User)",
    example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
    modelType: User,
    description:
      "Relation to User who deleted this object (if this object was deleted by a User)",
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      cascade: false,
      eager: false,
      nullable: true,
      onDelete: "SET NULL",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "deletedByUserId" })
  public deletedByUser?: User = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Deleted by User ID",
    description:
      "User ID who deleted this object (if this object was deleted by a User)",
    example: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.ShortURL,
    canReadOnRelationQuery: true,
    title: "Change Plan Link",
    description: "Reseller Change plan Link",
    example: "https://reseller.oneuptime.com/change-plan",
  })
  @Column({
    nullable: true,
    type: ColumnType.ShortURL,
    length: ColumnLength.ShortURL,
    transformer: URL.getDatabaseTransformer(),
  })
  public changePlanLink?: URL = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.Public],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Hide Phone Number on Signup",
    description:
      "Should we hide the phone number on sign up form based on reseller request?",
    example: true,
  })
  @Column({
    nullable: true,
    type: ColumnType.Boolean,
  })
  public hidePhoneNumberOnSignup?: boolean = undefined;

  @ColumnAccessControl({
    create: [],
    read: [Permission.Public],
    update: [],
  })
  @TableColumn({
    required: false,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Enable Telemetry Features",
    description: "Should we enable telemetry features for this reseller?",
    defaultValue: false,
    example: false,
  })
  @Column({
    nullable: true,
    default: false,
    type: ColumnType.Boolean,
  })
  public enableTelemetryFeatures?: boolean = undefined;
}
