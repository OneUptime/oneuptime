import FileOwnership, {
  FileOwnerKind,
  FileOwners,
  FileReferenceColumn,
  FileReferenceOwner,
  normalizeFileId,
} from "./FileOwnership";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";

/*
 * A record's files, as a read hands them back.
 *
 * A record names its files - a status page its logo, a note its
 * attachments, a person their picture - and a read that selects one beyond
 * its id (its bytes, its name, its type) gets the file itself. Being allowed
 * to read the record does not settle who may see the file: a record saved
 * before records were held to their own files (FileOwnership) can name a
 * file of another project, and a file uploaded with no project is nobody's.
 * So a read hands back a record's file only to someone who may see that
 * file, by the rule the image routes use (FileViewerAccess):
 *
 *   - a public file, to anyone: a record shows it to everyone
 *     (PublishedImages, FileService.makeStoredIconsPublic);
 *   - a file of a project the request may open - the projects its
 *     permissions are for: a member's, an API key's own project, each
 *     project of a read across the person's projects;
 *   - a file uploaded with no project, to the person who uploaded it;
 *   - a person's own picture, read with the person (it is served to anyone
 *     by the profile picture route);
 *   - OneUptime itself (root reads) and server admins: every file.
 *
 * Any other file is left out: the record comes back as one without it - a
 * single file unset, a list without that entry - rather than the whole read
 * failing, since the record itself is the caller's to read. Who may see
 * each file is read in one query for the whole answer, never with the
 * bytes.
 *
 * DatabaseService applies this to every read made for a caller (non-root),
 * and the workflow steps that read records for a project (FindOne,
 * FindMany, the model triggers) to what they read, as the project.
 */

// Who a file belongs to, and whether it is public: what deciding reads.
export interface FileAccessFacts extends FileOwners {
  isPublic: boolean;
}

// Who is reading.
export interface RelatedFileReader {
  // The projects whose files the reader may see.
  projectIds: Array<ObjectID | string>;
  // The person reading, who may see what they uploaded with no project.
  userId: ObjectID | string | null;
}

// What reads who may see files: FileService.
interface FileAccessReader {
  getFileAccess: (
    fileIds: Array<ObjectID>,
  ) => Promise<Map<string, FileAccessFacts>>;
}

type Row = Record<string, unknown>;

// A related file's id, however the read shaped it.
const readFileId: (file: unknown) => string = (file: unknown): string => {
  if (!file || typeof file !== "object") {
    return "";
  }

  const values: Row = file as Row;

  return normalizeFileId(values["_id"] || values["id"]);
};

export default class RelatedFileAccess {
  /**
   * Who a request reads as: the projects its permissions are for, and the
   * person. Null for OneUptime itself and server admins, who may see every
   * file.
   */
  public static getReader(
    props: DatabaseCommonInteractionProps,
  ): RelatedFileReader | null {
    if (props.isRoot || props.isMasterAdmin) {
      return null;
    }

    const permissions: Record<string, unknown> =
      (props.userTenantAccessPermission as Record<string, unknown>) || {};

    return {
      projectIds: Object.keys(permissions).filter((projectId: string) => {
        return Boolean(permissions[projectId]);
      }),
      userId: props.userId || null,
    };
  }

  // A project reading its own records: a workflow's steps.
  public static getProjectReader(projectId: ObjectID): RelatedFileReader {
    return { projectIds: [projectId], userId: null };
  }

  /**
   * The File columns of a model a select reads more of than the id: the
   * bytes, the name, the type. A file selected by its id alone, or as
   * `true` (which reads its id alone), is the record's own data.
   */
  public static getColumnsReadingFiles(
    model: BaseModel,
    select: unknown,
  ): Array<FileReferenceColumn> {
    if (!select || typeof select !== "object") {
      return [];
    }

    const values: Row = select as Row;

    return FileOwnership.getFileReferenceColumns(model).filter(
      (column: FileReferenceColumn): boolean => {
        const relationSelect: unknown = values[column.relationColumn];

        if (!relationSelect || typeof relationSelect !== "object") {
          return false;
        }

        return Object.keys(relationSelect).some((key: string): boolean => {
          return key !== "_id" && Boolean((relationSelect as Row)[key]);
        });
      },
    );
  }

  /**
   * Whether the reader may see a file a record names (see the top of this
   * file). `owner` is the record's (FileOwnership.getOwner), which matters
   * for a person's own picture; a file that could not be found is not
   * seen.
   */
  public static async mayRead(data: {
    file: FileAccessFacts | undefined;
    owner: FileReferenceOwner | null;
    reader: RelatedFileReader;
  }): Promise<boolean> {
    const file: FileAccessFacts | undefined = data.file;

    if (!file) {
      return false;
    }

    // A person's own picture: the profile picture route serves it to anyone.
    if (
      data.owner?.kind === FileOwnerKind.User &&
      FileOwnership.isOwnedBy(file, data.owner)
    ) {
      return true;
    }

    return await FileOwnership.maySeeFile({
      file: file,
      userId: data.reader.userId,
      mayOpenProject: (projectId: ObjectID): boolean => {
        return data.reader.projectIds.some(
          (readerProjectId: ObjectID | string): boolean => {
            return (
              normalizeFileId(readerProjectId) === normalizeFileId(projectId)
            );
          },
        );
      },
    });
  }

  /**
   * Leaves out of `rows` every file the reader may not see, of every File
   * column `select` reads beyond the id. Nothing to do for a reader who
   * may see every file (null), or a select that reads no file.
   */
  public static async keepReadableFiles(data: {
    model: BaseModel;
    rows: Array<unknown>;
    select: unknown;
    reader: RelatedFileReader | null;
  }): Promise<void> {
    if (!data.reader || data.rows.length === 0) {
      return;
    }

    const columns: Array<FileReferenceColumn> = this.getColumnsReadingFiles(
      data.model,
      data.select,
    );

    if (columns.length === 0) {
      return;
    }

    const fileIds: Map<string, ObjectID> = new Map();

    for (const row of data.rows) {
      for (const column of columns) {
        const value: unknown = ((row || {}) as Row)[column.relationColumn];

        for (const file of Array.isArray(value) ? value : [value]) {
          const fileId: string = readFileId(file);

          if (fileId && ObjectID.isValidUUID(fileId)) {
            fileIds.set(fileId, new ObjectID(fileId));
          }
        }
      }
    }

    const files: Map<string, FileAccessFacts> =
      fileIds.size > 0
        ? await this.readFileAccess(Array.from(fileIds.values()))
        : new Map();

    for (const row of data.rows) {
      if (!row || typeof row !== "object") {
        continue;
      }

      const values: Row = row as Row;
      const owner: FileReferenceOwner | null = FileOwnership.getOwner(
        data.model,
        values,
      );

      const mayRead: (file: unknown) => Promise<boolean> = async (
        file: unknown,
      ): Promise<boolean> => {
        return await this.mayRead({
          file: files.get(readFileId(file)),
          owner: owner,
          reader: data.reader!,
        });
      };

      for (const column of columns) {
        const value: unknown = values[column.relationColumn];

        if (value === undefined || value === null) {
          continue;
        }

        if (Array.isArray(value)) {
          const kept: Array<unknown> = [];

          for (const file of value) {
            if (await mayRead(file)) {
              kept.push(file);
            }
          }

          values[column.relationColumn] = kept;
          continue;
        }

        if (!(await mayRead(value))) {
          values[column.relationColumn] = undefined;
        }
      }
    }
  }

  /*
   * Who may see each file (FileService.getFileAccess), keyed by its id in
   * lower case. Required rather than imported: FileService is a
   * DatabaseService, and DatabaseService runs this check.
   */
  public static async readFileAccess(
    fileIds: Array<ObjectID>,
  ): Promise<Map<string, FileAccessFacts>> {
    const fileService: FileAccessReader =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("../../Services/FileService").default;

    return await fileService.getFileAccess(fileIds);
  }
}
