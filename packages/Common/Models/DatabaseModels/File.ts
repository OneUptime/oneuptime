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
   * through the API. Files have no owner otherwise, so this is what lets a
   * record that is shown to people outside the project - a form's logo on
   * its public page - refuse a file uploaded somewhere else (FormService).
   * Null for files uploaded with no project, and for every file uploaded
   * before the column existed.
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
}
