import User from "./User";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@TableMetadata({
  tableName: "GreenlockCertificate",
  singularName: "Greenlock Certificate",
  pluralName: "Greenlock Certificate",
  icon: IconProp.Lock,
  tableDescription: "Lets Encrypt Certificates",
})
@Entity({
  name: "GreenlockCertificate",
})
export default class GreenlockCertificate extends BaseModel {
  @Index()
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.LongText })
  @Column({
    type: ColumnType.LongText,
    length: ColumnLength.LongText,
    nullable: false,
    unique: false,
  })
  public key?: string = undefined;

  /*
   * What the Greenlock store kept under the key: a certificate's chain, or,
   * for a key pair (isKeyPair), the private key of the ACME account or of a
   * domain's certificate. Nothing has read or written this table since ACME
   * certificates replaced the Greenlock store (MoveGreenlockCertsToAcmeCerts
   * reads the keys alone), but an installation that ran OneUptime before
   * then still holds those private keys. So the column is kept encrypted at
   * rest, as AcmeCertificate.certificateKey is: the EncryptLetsEncryptKeys
   * data migration encrypted the blobs stored before.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.VeryLongText, encrypted: true })
  @Column({
    type: ColumnType.VeryLongText,
    nullable: false,
    unique: false,
  })
  public blob?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.Boolean, defaultValue: false })
  @Column({
    type: ColumnType.Boolean,
    nullable: false,
    default: false,
    unique: false,
  })
  public isKeyPair?: boolean = undefined;

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
}
