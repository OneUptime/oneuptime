import FileModel from "../../Models/FileModel";
import Route from "../../Types/API/Route";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import Permission from "../../Types/Permission";
import { Entity } from "typeorm";

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
  create: [Permission.CurrentUser],
  read: [Permission.CurrentUser],
  delete: [],
  update: [],
})
export default class File extends FileModel {}
