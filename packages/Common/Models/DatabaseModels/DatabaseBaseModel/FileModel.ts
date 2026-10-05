import ColumnAccessControl from "../../../Types/Database/AccessControl/ColumnAccessControl";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ColumnType from "../../../Types/Database/ColumnType";
import SlugifyColumn from "../../../Types/Database/SlugifyColumn";
import TableColumn from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import MimeType from "../../../Types/File/MimeType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import BaseModel from "./DatabaseBaseModel";
import { Column } from "typeorm";

@SlugifyColumn("name", "slug")
export default class FileModel extends BaseModel {
  public constructor(id?: ObjectID) {
    super(id);
  }

  public override isFileModel(): boolean {
    return true;
  }

  @ColumnAccessControl({
    create: [Permission.CurrentUser, Permission.AuthenticatedRequest],
    read: [Permission.CurrentUser, Permission.AuthenticatedRequest],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.File,
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.File,
  })
  public file?: Buffer = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser, Permission.AuthenticatedRequest],
    read: [Permission.CurrentUser, Permission.AuthenticatedRequest],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    title: "Name",
    description: "Any friendly name of this object",
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public name?: string = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser, Permission.AuthenticatedRequest],
    read: [Permission.CurrentUser, Permission.AuthenticatedRequest],
    update: [],
  })
  @TableColumn({
    required: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public fileType?: MimeType = undefined;

  @ColumnAccessControl({
    create: [Permission.CurrentUser, Permission.AuthenticatedRequest],
    read: [Permission.CurrentUser, Permission.AuthenticatedRequest],
    update: [],
  })
  @TableColumn({
    required: true,
    unique: true,
    type: TableColumnType.Slug,
    canReadOnRelationQuery: true,
  })
  @Column({
    nullable: false,
    type: ColumnType.Slug,
    length: ColumnLength.Slug,
  })
  public slug?: string = undefined;

  /*
   * Whether anyone may read the file, signed in or not. OneUptime decides
   * it, never the upload: every upload starts private (FileService), and a
   * file becomes public only when a record that shows it to everyone is
   * published - an image in a public note, an announcement or a published
   * postmortem, a probe's or an AI agent's icon - and private again when
   * that record stops showing it (InlineImageAccessTokenSync,
   * FileService.makeRecordFilesPublic). Files uploaded before uploads
   * started private keep the visibility they had.
   *
   * Computed and closed to every write, as File.projectId is: a value a
   * request sends is replaced, never refused, so a client that still sends
   * `isPublic: false` keeps working.
   */
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser, Permission.AuthenticatedRequest],
    update: [],
  })
  @TableColumn({
    required: true,
    isDefaultValueColumn: true,
    type: TableColumnType.Boolean,
    canReadOnRelationQuery: true,
    computed: true,
    defaultValue: false,
    title: "Is Public",
    description:
      "Whether anyone may read the file without signing in. Set by OneUptime: every upload starts private, and a file becomes public only when a record that shows it to everyone, such as a public note or a probe's icon, is published.",
  })
  @Column({
    nullable: false,
    default: false,
    type: ColumnType.Boolean,
  })
  public isPublic?: boolean = undefined;

  /*
   * High-entropy token used to address a file via /file/image/access-token/:token.
   * Generated server-side on create. Unguessable replacement for the
   * file id when embedding files in markdown so that ObjectIDs are not
   * enumerable. The token only addresses the file; it does not open it.
   * The token route serves a public file to anyone, and a private one only
   * to the people who may see it - the members of the project it was
   * uploaded in (FileViewerAccess).
   *
   * Computed and closed to every write: FileService generates it for every
   * upload, and a value a request sends is replaced, never refused.
   */
  @ColumnAccessControl({
    create: [],
    read: [Permission.CurrentUser, Permission.AuthenticatedRequest],
    update: [],
  })
  @TableColumn({
    required: false,
    unique: true,
    type: TableColumnType.ShortText,
    canReadOnRelationQuery: true,
    computed: true,
  })
  @Column({
    nullable: true,
    unique: true,
    type: ColumnType.ShortText,
    length: ColumnLength.ShortText,
  })
  public imageAccessToken?: string = undefined;
}
