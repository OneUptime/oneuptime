import User from "./User";
import BaseModel from "Common/Models/BaseModel";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ColumnAccessControl from "Common/Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "Common/Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "Common/Types/Database/ColumnLength";
import ColumnType from "Common/Types/Database/ColumnType";
import CrudApiEndpoint from "Common/Types/Database/CrudApiEndpoint";
import TableColumn from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import TableMetadata from "Common/Types/Database/TableMetadata";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@CrudApiEndpoint(new Route("/short-link"))
@Entity({
  name: "ShortLink",
})
@TableMetadata({
  tableName: "ShortLink",
  singularName: "Short Link",
  pluralName: "Short Links",
  icon: IconProp.Link,
  tableDescription:
    "Short links are used to redirect users to a specific long link in OneUptime.",
})
export default class ShortLink extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @Index()
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Short Link ID",
    description: "Random ID for the short link",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public shortId?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.LongURL,
    title: "Long URL",
    description: "Long URL to redirect to",
    canReadOnRelationQuery: false,
  })
  @Column({
    nullable: false,
    type: ColumnType.LongURL,
    transformer: URL.getDatabaseTransformer(),
  })
  public link?: URL = undefined;

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
