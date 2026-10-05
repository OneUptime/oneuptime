import FileModel from "./DatabaseBaseModel/FileModel";
import Route from "../../Types/API/Route";
import ColumnAccessControl from "../../Types/Database/AccessControl/ColumnAccessControl";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import ColumnType from "../../Types/Database/ColumnType";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableColumn from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import { Column, Entity } from "typeorm";

@EnableDocumentation()
@TableMetadata({
  tableName: "File",
  singularName: "File",
  pluralName: "Files",
  icon: IconProp.File,
  tableDescription: "BLOB or File storage",
})
@Entity({
  name: "File",
})
@CrudApiEndpoint(new Route("/file"))
@TableAccessControl({
  create: [Permission.CurrentUser, Permission.AuthenticatedRequest],
  read: [],
  delete: [],
  update: [],
})
export default class File extends FileModel {
  /*
   * The project the file was uploaded in: stamped by FileService from the
   * request's project (the dashboard's tenant, an API key's project) on
   * every create, whatever the request body says, and never changed or read
   * through the API. Files have no owner otherwise, so this is what lets
   * every record of a project - a status page's logo, a dashboard's
   * favicon, a note's attachments, a form's logo - point only at files of
   * that project, and what lets a public page refuse to serve any other
   * (FileOwnership). Null for files uploaded with no project. Files
   * uploaded before the column existed got the project of the records that
   * use them (BackfillFileOwners1797900000000), unless records of two
   * projects use the same file.
   *
   * Nobody may write it, so it is computed, as a password's salt is: the
   * create's column check, which runs after the stamp, skips it, and a value
   * a request sends is replaced, never refused.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Project ID",
    description:
      "The project the file was uploaded in. Set by OneUptime from the request, never from the request body.",
    computed: true,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public projectId?: ObjectID = undefined;

  /*
   * The person who uploaded the file: stamped by FileService from the
   * signed-in user making the upload, whatever the request body says. A
   * profile picture belongs to a person rather than to a project, and is
   * served to anyone who asks for it, so a user may make their picture only
   * a file they uploaded themselves (FileOwnership). Null for files an API
   * key or the system uploaded. Profile pictures set before the column
   * existed got their user (BackfillFileOwners1797900000000).
   *
   * Computed and closed to every request, like projectId above.
   */
  @ColumnAccessControl({
    create: [],
    read: [],
    update: [],
  })
  @TableColumn({
    type: TableColumnType.ObjectID,
    title: "Uploaded By User ID",
    description:
      "The user who uploaded the file. Set by OneUptime from the request, never from the request body.",
    computed: true,
    hideColumnInDocumentation: true,
  })
  @Column({
    type: ColumnType.ObjectID,
    nullable: true,
    transformer: ObjectID.getDatabaseTransformer(),
  })
  public createdByUserId?: ObjectID = undefined;
}
