import FileModel from "./DatabaseBaseModel/FileModel";
import Route from "../../Types/API/Route";
import TableAccessControl from "../../Types/Database/AccessControl/TableAccessControl";
import CrudApiEndpoint from "../../Types/Database/CrudApiEndpoint";
import EnableDocumentation from "../../Types/Database/EnableDocumentation";
import TableMetadata from "../../Types/Database/TableMetadata";
import IconProp from "../../Types/Icon/IconProp";
import Permission from "../../Types/Permission";
import { Entity } from "typeorm";

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
  read: [Permission.CurrentUser, Permission.AuthenticatedRequest],
  delete: [],
  update: [],
})
export default class File extends FileModel {}
