import Project from "./Project";
import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnLength from "../../Types/Database/ColumnLength";
import ColumnType from "../../Types/Database/ColumnType";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import TenantColumn from "../../Types/Database/TenantColumn";
import UniqueColumnsTogether from "../../Types/Database/UniqueColumnsTogether";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";

/*
 * ONE RECORD THAT SHOWS ONE INLINE IMAGE (#11478).
 *
 * An image pasted into the Markdown editor is a private File of the
 * record's project, carried in the Markdown by its address,
 * /file/image/access-token/<token>. That address opens the image only for a
 * person who may read a record of the project that shows it
 * (FileViewerAccess), so the image route must find, for one image, the
 * records that show it - without reading every record of the project,
 * which on a busy project is hundreds of milliseconds an image.
 *
 * A row says that this record (a table and an id) shows this image (a file
 * of the record's own project). It is a pointer and nothing more: the image
 * route reads the record again, as the person asking, and serves the image
 * only when the record as they may read it still shows it - so a row the
 * record no longer bears out (the image edited out, the record deleted)
 * opens nothing. A record that shows an image without a row here shows it
 * only to its uploader.
 *
 * Written by the server alone, as OneUptime, on every write of a record
 * that can show images (ShownImages, which DatabaseService runs after each
 * create and update), and once for the records written before this table
 * existed (BackfillShownImages). No client can read or write a row, it has
 * no API, and it goes with its project.
 */
@TenantColumn("projectId")
@TableAccessControl({
  create: [],
  read: [],
  delete: [],
  update: [],
})
@Entity({
  name: "ShownImage",
})
@TableMetadata({
  tableName: "ShownImage",
  singularName: "Shown Image",
  pluralName: "Shown Images",
  icon: IconProp.Image,
  tableDescription:
    "Internal record of which records show each inline image, so the image's address opens it only for the people who may read one of them.",
})
@Index(["fileId", "recordTableName", "recordId"], { unique: true })
@UniqueColumnsTogether(
  ["fileId", "recordTableName", "recordId"],
  "This record is recorded as showing this image already.",
)
export default class ShownImage extends BaseModel {
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    manyToOneRelationColumn: "projectId",
    type: TableColumnType.Entity,
    modelType: Project,
    title: "Project",
    description: "The project of the record and of the image it shows",
  })
  @ManyToOne(
    () => {
      return Project;
    },
    {
      eager: false,
      nullable: true,
      onDelete: "CASCADE",
      orphanedRowAction: "nullify",
    },
  )
  @JoinColumn({ name: "projectId" })
  public project?: Project = undefined;

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
    title: "Project ID",
    description: "ID of the project of the record and of the image it shows",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  /*
   * The image's File, by its id alone: a pointer, not a relation, so this
   * table is none of the records whose files FileOwnership holds to their
   * owner, and a file's rows outlive it harmlessly - the image route reads
   * the file before it reads these.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "File ID",
    description: "ID of the image's file, a file of the record's project",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public fileId?: ObjectID = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Record Table Name",
    description:
      "The table of the record that shows the image, such as Incident or IncidentInternalNote.",
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public recordTableName?: string = undefined;

  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    required: true,
    title: "Record ID",
    description: "ID of the record that shows the image",
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: false,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public recordId?: ObjectID = undefined;
}
