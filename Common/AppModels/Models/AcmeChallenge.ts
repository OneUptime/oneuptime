import User from "./User";
import BaseModel from "../../Models/BaseModel";
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
  tableName: "AcmeChallenge",
  singularName: "Acme Challenge",
  pluralName: "Acme Challenges",
  icon: IconProp.Lock,
  tableDescription: "HTTP Challege for Lets Encrypt Certificates",
})
@Entity({
  name: "AcmeChallenge",
})
export default class AcmeChallenge extends BaseModel {
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
  public domain?: string = undefined;

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
  public token?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({ type: TableColumnType.LongText })
  @Column({
    type: ColumnType.LongText,
    nullable: false,
    unique: false,
  })
  public challenge?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "deletedByUserId",
    type: TableColumnType.Entity,
    title: "Deleted by User",
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
      onDelete: "CASCADE",
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
