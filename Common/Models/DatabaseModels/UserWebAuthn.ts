import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import User from "./User";
import Route from "../../Types/API/Route";
import AllowAccessIfSubscriptionIsUnpaid from "../../Types/Database/AccessControl/AllowAccessIfSubscriptionIsUnpaid";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import CurrentUserCanAccessRecordBy from "../../Types/Database/CurrentUserCanAccessRecordBy";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity, JoinColumn, ManyToOne } from "typeorm";

@EnableDocumentation({
  isMasterAdminApiDocs: true,
})
@AllowAccessIfSubscriptionIsUnpaid()
@TableAccessControl({
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser],
  delete: [Permission.CurrentUser],
  update: [Permission.CurrentUser],
})
@CrudApiEndpoint(new Route("/user-webauthn"))
@Entity({
  name: "UserWebAuthn",
})
@TableMetadata({
  tableName: "UserWebAuthn",
  singularName: "WebAuthn Credential",
  pluralName: "WebAuthn Credentials",
  icon: IconProp.ShieldCheck,
  tableDescription: "WebAuthn credentials for users (security keys)",
})
@CurrentUserCanAccessRecordBy("userId")
class UserWebAuthn extends BaseModel {
  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    title: "Credential Name",
    description: "Name of the WebAuthn credential",
  })
  @Column({
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
    nullable: false,
    unique: false,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    canReadOnRelationQuery: false,
    title: "Credential ID",
    description: "Unique identifier for the WebAuthn credential",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: false,
    unique: true,
  })
  public credentialId?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    canReadOnRelationQuery: false,
    title: "Public Key",
    description: "Public key of the WebAuthn credential",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: false,
    unique: false,
  })
  public publicKey?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    canReadOnRelationQuery: false,
    title: "Counter",
    description: "Counter for the WebAuthn credential",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: false,
    unique: false,
  })
  public counter?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.VeryLongText,
    canReadOnRelationQuery: false,
    title: "Transports",
    description: "Transports supported by the WebAuthn credential",
  })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: true,
    unique: false,
  })
  public transports?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    title: "Is Verified",
    isDefaultValueColumn: true,
    description: "Is this WebAuthn credential verified and validated",
    defaultValue: false,
  })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
  })
  public isVerified?: boolean = undefined;

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
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public deletedByUserId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    manyToOneRelationColumn: "userId",
    type: TableColumnType.Entity,
    title: "User",
    description: "Relation to User who owns this WebAuthn credential",
  })
  @ManyToOne(
    () => {
      return User;
    },
    {
      cascade: false,
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "userId" })
  public user?: User = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser],
    read: [Permission.CurrentUser],
    update: [Permission.CurrentUser],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "User ID",
    description: "User ID who owns this WebAuthn credential",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public userId?: ObjectID = undefined;
}

export default UserWebAuthn;
