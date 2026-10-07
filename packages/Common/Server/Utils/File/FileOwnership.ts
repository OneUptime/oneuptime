import RelationIdUtil from "../Database/RelationIdUtil";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import File from "../../../Models/DatabaseModels/File";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";

/*
 * Which files a record may point at, and which a page may serve.
 *
 * A File is addressed by its id, and many records point at one: a status
 * page's logo, favicon and cover image, a dashboard's logo and favicon, a
 * form's logo and favicon, a probe's or an AI agent's icon, the attachments
 * of notes, announcements and postmortems, a person's profile picture. Each
 * is then served - on a public status page or dashboard, through an
 * attachment link, by the id-based image route once it is public. A file
 * has an owner (File.projectId, File.createdByUserId, stamped by FileService
 * from the upload request), and a record may point only at a file of its
 * own owner:
 *
 *   - a record of a project, at a file uploaded in that project;
 *   - a person (User), at a file that person uploaded - a profile picture;
 *   - a record outside any project (a global probe or AI agent, which only
 *     server admins manage) has no project to hold its files to.
 *
 * DatabaseService checks every write that points one of these columns at a
 * file the record does not already hold - from the model's own metadata, so
 * a File column added to any model later is covered too. A file of another
 * owner, a file with none (uploaded before files recorded their project, or
 * with no project) and a file that does not exist get the same answer, word
 * for word: a write cannot be used to learn whether some other project's
 * file is there. A file the record already points at is not checked again,
 * so a record saved before this rule existed keeps saving.
 *
 * The routes that serve a record's files check the same owner again as they
 * read (keepProjectFile, findProjectAttachment, isFileOfUser), whatever
 * wrote the row.
 */

// One column of a model that points at files.
export interface FileReferenceColumn {
  // The relation - logoFile, attachments - which the dashboard's forms write.
  relationColumn: string;
  // The id column of a single file (logoFileId); null for a list of files.
  idColumn: string | null;
  // A list of files (a note's attachments) rather than one.
  isList: boolean;
  // The column in words, for refusals: "logo", "cover image", "attachments".
  name: string;
  // The refusal, the same whether the file is missing or not the record's.
  notFoundMessage: string;
}

// Who a file belongs to, as FileService.getFileOwners reads it.
export interface FileOwners {
  // The project it was uploaded in; null for none.
  projectId: ObjectID | null;
  // The user who uploaded it; null for an API key or the system.
  createdByUserId: ObjectID | null;
}

export enum FileOwnerKind {
  Project = "Project",
  User = "User",
  // A record nothing can vouch for: every file is refused.
  Nobody = "Nobody",
}

// Whose files a record may point at.
export type FileReferenceOwner =
  | { kind: FileOwnerKind.Project; projectId: ObjectID }
  | { kind: FileOwnerKind.User; userId: ObjectID | null }
  | { kind: FileOwnerKind.Nobody };

// Files a write points one column at, for a record of this owner.
export interface FileReferenceCheck {
  owner: FileReferenceOwner;
  column: FileReferenceColumn;
  fileIds: Array<ObjectID>;
}

// What reads the owners of files: FileService.
interface FileOwnersReader {
  getFileOwners: (fileIds: Array<ObjectID>) => Promise<Map<string, FileOwners>>;
}

// A file as a route has read it: its id and the owners it selected.
export interface OwnedFile {
  _id?: string | undefined;
  id?: ObjectID | null | undefined;
  projectId?: ObjectID | string | null | undefined;
  createdByUserId?: ObjectID | string | null | undefined;
}

const FILE_TABLE_NAME: string = "File";

const USER_TABLE_NAME: string = "User";

/*
 * Ids are compared in lower case: Postgres renders a uuid in lower case, and
 * a request may write one in upper case. Every comparison of file ids goes
 * through here.
 */
export const normalizeFileId: (value: unknown) => string = (
  value: unknown,
): string => {
  if (value === undefined || value === null) {
    return "";
  }

  return value.toString().trim().toLowerCase();
};

// An id as a record or a request may hold it: an ObjectID or a uuid string.
const readId: (value: unknown) => ObjectID | null = (
  value: unknown,
): ObjectID | null => {
  if (value instanceof ObjectID) {
    return value.toString() ? value : null;
  }

  if (typeof value === "string" && value.trim()) {
    return new ObjectID(value.trim());
  }

  return null;
};

/*
 * One file a write names, in every shape DatabaseService links: a model, a
 * { _id } or { id } object, an ObjectID or a uuid string - read the way
 * every other relation a hook checks is read (RelationIdUtil). A value with
 * no id names nothing.
 */
const readEntryId: (entry: unknown) => ObjectID | null = (
  entry: unknown,
): ObjectID | null => {
  return RelationIdUtil.read({ entry: entry }, ["entry"]);
};

// "Cover Image" -> "cover image"; profilePictureFile (no title) -> "profile picture".
const getColumnName: (
  metadata: TableColumnMetadata,
  columnName: string,
) => string = (metadata: TableColumnMetadata, columnName: string): string => {
  const title: string =
    metadata.title?.trim() ||
    columnName
      .replace(/File$/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .trim();

  return title.toLowerCase();
};

export default class FileOwnership {
  private static columnsByTable: Map<string, Array<FileReferenceColumn>> =
    new Map();

  /**
   * Every column of a model that points at files, read from its metadata:
   * a relation to File, one file or a list of them.
   */
  public static getFileReferenceColumns(
    model: BaseModel,
  ): Array<FileReferenceColumn> {
    const tableName: string = model.tableName || "";
    const cached: Array<FileReferenceColumn> | undefined =
      this.columnsByTable.get(tableName);

    if (cached && tableName) {
      return cached;
    }

    const columns: Array<FileReferenceColumn> = [];

    for (const columnName of model.getTableColumns().columns) {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(columnName);

      if (
        !metadata ||
        !metadata.modelType ||
        (metadata.type !== TableColumnType.Entity &&
          metadata.type !== TableColumnType.EntityArray) ||
        new metadata.modelType().tableName !== FILE_TABLE_NAME
      ) {
        continue;
      }

      const isList: boolean = metadata.type === TableColumnType.EntityArray;
      const name: string = getColumnName(metadata, columnName);

      columns.push({
        relationColumn: columnName,
        idColumn: isList ? null : metadata.manyToOneRelationColumn || null,
        isList: isList,
        name: name,
        notFoundMessage: isList
          ? `One of the ${name} could not be found. Upload it again.`
          : `The ${name}'s file could not be found. Upload the ${name} again.`,
      });
    }

    if (tableName) {
      this.columnsByTable.set(tableName, columns);
    }

    return columns;
  }

  /**
   * The files a write points a column at: null when it leaves the column
   * alone, an empty list when it clears it. A single file written both ways
   * (logoFileId and logoFile) yields both ids, so each is checked: which of
   * the two the database keeps is not something to leave to chance.
   */
  public static readWrittenFileIds(
    data: unknown,
    column: FileReferenceColumn,
  ): Array<ObjectID> | null {
    const values: Record<string, unknown> = (data || {}) as Record<
      string,
      unknown
    >;

    if (column.isList) {
      const value: unknown = values[column.relationColumn];

      if (value === undefined) {
        return null;
      }

      const entries: Array<unknown> =
        value === null ? [] : Array.isArray(value) ? value : [value];

      const ids: Array<ObjectID> = [];

      for (const entry of entries) {
        const id: ObjectID | null = readEntryId(entry);

        if (id) {
          ids.push(id);
        }
      }

      return ids;
    }

    const keys: Array<string> = column.idColumn
      ? [column.idColumn, column.relationColumn]
      : [column.relationColumn];

    if (
      keys.every((key: string): boolean => {
        return values[key] === undefined;
      })
    ) {
      return null;
    }

    const ids: Array<ObjectID> = [];
    const seen: Set<string> = new Set();

    for (const key of keys) {
      const id: ObjectID | null = readEntryId(values[key]);

      if (id && !seen.has(normalizeFileId(id))) {
        seen.add(normalizeFileId(id));
        ids.push(id);
      }
    }

    return ids;
  }

  /**
   * The files a stored record points a column at, as a read of it with the
   * column's id (or the list's ids) selected returns them.
   */
  public static readStoredFileIds(
    row: unknown,
    column: FileReferenceColumn,
  ): Set<string> {
    const values: Record<string, unknown> = (row || {}) as Record<
      string,
      unknown
    >;

    const ids: Set<string> = new Set();

    if (column.isList) {
      const value: unknown = values[column.relationColumn];

      for (const entry of Array.isArray(value) ? value : []) {
        const id: ObjectID | null = readEntryId(entry);

        if (id) {
          ids.add(normalizeFileId(id));
        }
      }

      return ids;
    }

    const id: ObjectID | null =
      (column.idColumn ? readId(values[column.idColumn]) : null) ||
      readEntryId(values[column.relationColumn]);

    if (id) {
      ids.add(normalizeFileId(id));
    }

    return ids;
  }

  /**
   * Whose files a record may point at: a project's record, its project's; a
   * person, their own. Null for a record of a project-scoped model that is
   * in no project (a global probe or AI agent): only server admins write
   * those, and there is no project to hold their files to.
   */
  public static getOwner(
    model: BaseModel,
    row: unknown,
  ): FileReferenceOwner | null {
    const values: Record<string, unknown> = (row || {}) as Record<
      string,
      unknown
    >;

    const tenantColumn: string | null = model.getTenantColumn();

    if (tenantColumn) {
      const projectId: ObjectID | null = readId(values[tenantColumn]);

      return projectId ? { kind: FileOwnerKind.Project, projectId } : null;
    }

    if (model.tableName === USER_TABLE_NAME) {
      return { kind: FileOwnerKind.User, userId: readId(values["_id"]) };
    }

    return { kind: FileOwnerKind.Nobody };
  }

  // Whether a file was uploaded in the project.
  public static isFileOfProject(
    file: OwnedFile | FileOwners | null | undefined,
    projectId: ObjectID | string | null | undefined,
  ): boolean {
    const fileProjectId: string = normalizeFileId(file?.projectId);

    return Boolean(
      fileProjectId && fileProjectId === normalizeFileId(projectId),
    );
  }

  // Whether a file was uploaded by the user.
  public static isFileOfUser(
    file: OwnedFile | FileOwners | null | undefined,
    userId: ObjectID | string | null | undefined,
  ): boolean {
    const uploadedBy: string = normalizeFileId(file?.createdByUserId);

    return Boolean(uploadedBy && uploadedBy === normalizeFileId(userId));
  }

  /**
   * Whether someone may see a file, the one rule every way of reading a
   * file's bytes follows (FileViewerAccess for the image routes,
   * RelatedFileAccess for a record's files): a public file, anyone; a file
   * of a project, whoever may open that project now (`mayOpenProject`); a
   * file uploaded with no project, the person who uploaded it. Server
   * admins and OneUptime itself are decided before this is asked.
   */
  public static async maySeeFile(data: {
    file:
      | {
          isPublic?: unknown;
          projectId?: ObjectID | string | null | undefined;
          createdByUserId?: ObjectID | string | null | undefined;
        }
      | null
      | undefined;
    userId: ObjectID | string | null | undefined;
    mayOpenProject: (projectId: ObjectID) => boolean | Promise<boolean>;
  }): Promise<boolean> {
    const file: typeof data.file = data.file;

    if (!file) {
      return false;
    }

    // Strictly true: anything else, a loose 'true' string included, is private.
    if (file.isPublic === true) {
      return true;
    }

    const projectId: string = normalizeFileId(file.projectId);

    if (!projectId) {
      return Boolean(data.userId) && this.isFileOfUser(file, data.userId);
    }

    if (!ObjectID.isValidUUID(projectId)) {
      return false;
    }

    return await data.mayOpenProject(new ObjectID(projectId));
  }

  // Whether a file belongs to the owner a record holds its files to.
  public static isOwnedBy(
    file: FileOwners | undefined,
    owner: FileReferenceOwner,
  ): boolean {
    if (!file) {
      return false;
    }

    switch (owner.kind) {
      case FileOwnerKind.Project:
        return this.isFileOfProject(file, owner.projectId);
      case FileOwnerKind.User:
        return this.isFileOfUser(file, owner.userId);
      case FileOwnerKind.Nobody:
        return false;
    }
  }

  /**
   * Refuses the write unless every file it points at belongs to the owner of
   * the record it points it from - with the column's own words, the same
   * for a file of another owner, of none, or one that does not exist. The
   * owners of every file are read in one query.
   */
  public static async assertOwned(
    checks: Array<FileReferenceCheck>,
  ): Promise<void> {
    const pending: Array<FileReferenceCheck> = checks.filter(
      (check: FileReferenceCheck): boolean => {
        return check.fileIds.length > 0;
      },
    );

    if (pending.length === 0) {
      return;
    }

    const fileIds: Array<ObjectID> = [];
    const seen: Set<string> = new Set();

    for (const check of pending) {
      for (const fileId of check.fileIds) {
        const key: string = normalizeFileId(fileId);

        if (!seen.has(key)) {
          seen.add(key);
          fileIds.push(fileId);
        }
      }
    }

    const owners: Map<string, FileOwners> = await this.readFileOwners(fileIds);

    for (const check of pending) {
      for (const fileId of check.fileIds) {
        if (!this.isOwnedBy(owners.get(normalizeFileId(fileId)), check.owner)) {
          throw new BadDataException(check.column.notFoundMessage);
        }
      }
    }
  }

  /**
   * The attachment of a record a request names: one of the record's files,
   * with its bytes, uploaded in the record's own project. Undefined for any
   * other - not one of the record's, or a file of another project or of
   * none - so a route answers it as it answers an attachment that does not
   * exist. A route that read the files with their projectId (a root read)
   * is answered from it; otherwise the file's owner is looked up.
   */
  public static async findProjectAttachment(data: {
    files: Array<File> | null | undefined;
    fileId: ObjectID;
    projectId: ObjectID | null | undefined;
  }): Promise<File | undefined> {
    const wanted: string = normalizeFileId(data.fileId);

    const attachment: File | undefined = (data.files || []).find(
      (file: File): boolean => {
        return Boolean(
          wanted && normalizeFileId(file._id || file.id || "") === wanted,
        );
      },
    );

    if (!attachment || !attachment.file || !data.projectId) {
      return undefined;
    }

    if (attachment.projectId !== undefined) {
      return this.isFileOfProject(attachment, data.projectId)
        ? attachment
        : undefined;
    }

    const owners: Map<string, FileOwners> = await this.readFileOwners([
      data.fileId,
    ]);

    return this.isFileOfProject(owners.get(wanted), data.projectId)
      ? attachment
      : undefined;
  }

  /**
   * A record's image as a page may serve it - the file, when it was
   * uploaded in the record's own project - or undefined, and the page shows
   * what it shows for a record with no image. The file must have been read
   * with its projectId.
   */
  public static keepProjectFile<T extends OwnedFile>(
    file: T | null | undefined,
    projectId: ObjectID | string | null | undefined,
  ): T | undefined {
    return file && this.isFileOfProject(file, projectId) ? file : undefined;
  }

  /*
   * Who each file belongs to (FileService.getFileOwners), keyed by its id in
   * lower case. Required here rather than imported: FileService is a
   * DatabaseService, and DatabaseService runs these checks.
   */
  public static async readFileOwners(
    fileIds: Array<ObjectID>,
  ): Promise<Map<string, FileOwners>> {
    const fileService: FileOwnersReader =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../../Services/FileService").default;

    return await fileService.getFileOwners(fileIds);
  }
}
