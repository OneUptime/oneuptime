import BadDataException from "../../../Types/Exception/BadDataException";
import {
  CUSTOM_FIELD_FILE_MAX_SIZE_IN_BYTES,
  CUSTOM_FIELD_FILES_MAX_TOTAL_SIZE_IN_BYTES,
  CUSTOM_FIELD_MAX_FILES,
  CustomFieldFile,
  CustomFieldFileReferences,
  formatCustomFieldFileSize,
  isCustomFieldFile,
  isCustomFieldFileMimeType,
  readCustomFieldFileReference,
  readCustomFieldFileReferences,
  readCustomFieldFiles,
} from "../../../Types/CustomField/CustomFieldFile";
import {
  CUSTOM_FIELD_RECORD_KINDS,
  CustomFieldRecordKind,
  getCustomFieldRecordKind,
} from "../../../Types/CustomField/CustomFieldRecordKinds";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { isCustomFieldValueEmpty } from "../../../Types/CustomField/CustomFieldValueMapping";
import {
  FILE_CONTENT_HEAD_LENGTH,
  isFileContentOfType,
} from "../../../Types/File/FileContentCheck";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";

/*
 * FILE AND MULTIPLE FILES CUSTOM FIELDS, AS THE SERVER HOLDS THEM.
 *
 * A record's file field holds references to uploaded Files
 * (Types/CustomField/CustomFieldFile), never their bytes. This is the one
 * place that decides what such a value may be and what it is stored as, run
 * by DatabaseService on every create and update of a record with custom
 * fields - root and hook-free writes too, since a workflow, an import or an
 * API call can carry any id - once the caller is known to be allowed the
 * write (prepareWrite), and after every write and delete that lets go of a
 * file (deleteUnheldFiles).
 *
 * WHAT A WRITE MAY PUT IN A FILE FIELD. Each file it names that the record
 * does not hold already must be:
 *
 *   - a file uploaded in the record's own project (File.projectId). One of
 *     another project, one uploaded with none, and one that does not exist
 *     get the same answer, word for word, so a write cannot be used to learn
 *     whether some other project's file is there;
 *   - at most CUSTOM_FIELD_FILE_MAX_SIZE_IN_BYTES;
 *   - of a kind a file field takes (CUSTOM_FIELD_FILE_TYPES), and holding
 *     what its type says (FileContentCheck): a page renamed .pdf is refused.
 *
 * and a field holds one file (File) or at most CUSTOM_FIELD_MAX_FILES of
 * them, CUSTOM_FIELD_FILES_MAX_TOTAL_SIZE_IN_BYTES together (Multiple files).
 * A file the record holds already is not checked again: nothing about a
 * file can change once it is uploaded.
 *
 * WHAT IS STORED. Each file as the file itself says it is - its id, name,
 * type and size, read from File - whatever the write said about its name or
 * size. A field emptied, or a Multiple files field left with no file, loses
 * its key.
 *
 * WHEN A FILE GOES. A file a record lets go of - taken out of a field,
 * replaced, or the record deleted, by anyone or by retention - is deleted
 * once nothing holds it: no record of the project holds it in a custom field
 * (a template's value is copied onto the records made from it, and a
 * monitor's onto its incidents, so one file can be held by many), and no
 * other column points at it (FileReferenceColumn). Best-effort: a failure is
 * logged, and never fails the write.
 *
 * Every statement goes through the query function the caller hands in (the
 * record's own repository), with every value a bound parameter; table and
 * column names come from the registry and the entity metadata, never from a
 * request.
 */

export type CustomFieldFileQuery = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<unknown>;

// A column that points at Files, found in the entity metadata.
export interface FileReferenceColumn {
  tableName: string;
  columnName: string;
}

// One file field of a project, as a write needs it.
export interface CustomFieldFileField {
  name: string;
  customFieldType: CustomFieldType;
}

// A row a write is about to write: its project, and what it holds now.
export interface CustomFieldFileRow {
  projectId: ObjectID | string | null | undefined;
  customFields: unknown;
}

// What a write turned out to store, and which files it let go of.
export interface PreparedCustomFieldFiles {
  // The bag to write in place of the one the write was given.
  customFields: JSONObject | null;
  // Per project, the files a row held that the write no longer holds.
  releasedFileIds: Map<string, Set<string>>;
}

// A file as the checks read it.
interface StoredFile {
  fileId: string;
  name: string;
  fileType: string;
  size: number;
  projectId: string | null;
  head: Uint8Array;
}

// What each of the refusals says.
export const CustomFieldFileMessages: {
  notFound: (field: string) => string;
  tooLarge: (data: { field: string; file: string }) => string;
  notAccepted: (data: { field: string; file: string }) => string;
  notWhatItSays: (data: { field: string; file: string }) => string;
  tooMuchInAll: (data: { field: string; size: string }) => string;
  severalProjects: string;
} = {
  notFound: (field: string): string => {
    return `One of the files for "${field}" could not be found. Upload it again.`;
  },
  tooLarge: (data: { field: string; file: string }): string => {
    return `"${data.file}" is larger than ${formatCustomFieldFileSize(
      CUSTOM_FIELD_FILE_MAX_SIZE_IN_BYTES,
    )}, the most a file in "${data.field}" can be.`;
  },
  notAccepted: (data: { field: string; file: string }): string => {
    return `"${data.field}" does not take files like "${data.file}". It takes documents, spreadsheets, presentations, pictures, text, ZIP archives and packet captures.`;
  },
  notWhatItSays: (data: { field: string; file: string }): string => {
    return `"${data.file}" does not hold what its type says. Upload the file as it was saved, not renamed.`;
  },
  tooMuchInAll: (data: { field: string; size: string }): string => {
    return `"${data.field}" holds at most ${formatCustomFieldFileSize(
      CUSTOM_FIELD_FILES_MAX_TOTAL_SIZE_IN_BYTES,
    )} of files, and these come to ${data.size}.`;
  },
  severalProjects:
    "This write changes records of several projects whose file custom fields differ. Write the records of one project at a time.",
};

type IsPlainObjectFunction = (value: unknown) => value is JSONObject;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is JSONObject => {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
};

type ReadIdFunction = (value: unknown) => string | null;

const readId: ReadIdFunction = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const id: string = value.toString().trim().toLowerCase();

  return ObjectID.isValidUUID(id) ? id : null;
};

type ReadRowsFunction = (result: unknown) => Array<Record<string, unknown>>;

// What a query handed back, as rows: pg's array, or TypeORM's [rows, count].
const readRows: ReadRowsFunction = (
  result: unknown,
): Array<Record<string, unknown>> => {
  if (!Array.isArray(result)) {
    return [];
  }

  if (result.length === 2 && Array.isArray(result[0])) {
    return result[0] as Array<Record<string, unknown>>;
  }

  return result.filter((row: unknown): row is Record<string, unknown> => {
    return isPlainObject(row);
  });
};

type QuoteIdentifierFunction = (name: string) => string;

// A table or column name from the registry or the metadata, quoted.
const quoteIdentifier: QuoteIdentifierFunction = (name: string): string => {
  return `"${name.replace(/"/g, '""')}"`;
};

type ToBytesFunction = (value: unknown) => Uint8Array;

// The bytes Postgres hands back for a bytea: a Buffer, or any byte view.
const toBytes: ToBytesFunction = (value: unknown): Uint8Array => {
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  return new Uint8Array(0);
};

export default class CustomFieldFiles {
  /**
   * Whether a written bag might name a file at all: a value that is an id,
   * an object naming one, or a list holding either. Decides, without a
   * query, whether a write needs the project's file fields read. A text
   * field holding an id costs that read, and nothing else.
   */
  public static mayNameFiles(customFields: unknown): boolean {
    if (!isPlainObject(customFields)) {
      return false;
    }

    return Object.values(customFields).some((value: unknown): boolean => {
      const entries: Array<unknown> = Array.isArray(value) ? value : [value];

      return entries.some((entry: unknown): boolean => {
        return readCustomFieldFileReference(entry) !== null;
      });
    });
  }

  /**
   * Whether a stored bag holds a file: a value that is a file reference, or
   * a list holding one.
   */
  public static holdsFiles(customFields: unknown): boolean {
    if (!isPlainObject(customFields)) {
      return false;
    }

    return Object.values(customFields).some((value: unknown): boolean => {
      const entries: Array<unknown> = Array.isArray(value) ? value : [value];

      return entries.some((entry: unknown): boolean => {
        return isCustomFieldFile(entry);
      });
    });
  }

  /**
   * Every file a stored bag holds, whatever field holds it: the files a
   * deleted record lets go of.
   */
  public static getHeldFileIds(customFields: unknown): Set<string> {
    const held: Set<string> = new Set<string>();

    if (!isPlainObject(customFields)) {
      return held;
    }

    for (const value of Object.values(customFields)) {
      for (const file of readCustomFieldFiles(value)) {
        held.add(file.fileId);
      }
    }

    return held;
  }

  /**
   * The file fields a project gives a kind of record: File and Multiple
   * files definitions, by name. One query.
   */
  public static async getFileFields(data: {
    recordTableName: string;
    projectId: string;
    query: CustomFieldFileQuery;
  }): Promise<Array<CustomFieldFileField>> {
    const kind: CustomFieldRecordKind | undefined = getCustomFieldRecordKind(
      data.recordTableName,
    );

    if (!kind || !ObjectID.isValidUUID(data.projectId)) {
      return [];
    }

    const rows: Array<Record<string, unknown>> = readRows(
      await data.query(
        `SELECT "name", "customFieldType" FROM ${quoteIdentifier(
          kind.definitionTableName,
        )} WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "customFieldType" IN ($2, $3)`,
        [data.projectId, CustomFieldType.File, CustomFieldType.MultipleFiles],
      ),
    );

    const fields: Array<CustomFieldFileField> = [];

    for (const row of rows) {
      if (
        typeof row["name"] === "string" &&
        row["name"].length > 0 &&
        (row["customFieldType"] === CustomFieldType.File ||
          row["customFieldType"] === CustomFieldType.MultipleFiles)
      ) {
        fields.push({
          name: row["name"],
          customFieldType: row["customFieldType"] as CustomFieldType,
        });
      }
    }

    return fields;
  }

  /*
   * Each file's facts and first bytes, in one query, never the whole of the
   * bytes: a file that does not exist, or has been deleted, is absent.
   */
  private static async readFiles(data: {
    fileIds: Array<string>;
    query: CustomFieldFileQuery;
  }): Promise<Map<string, StoredFile>> {
    const files: Map<string, StoredFile> = new Map<string, StoredFile>();

    if (data.fileIds.length === 0) {
      return files;
    }

    const rows: Array<Record<string, unknown>> = readRows(
      await data.query(
        `SELECT "_id", "name", "fileType", "projectId", octet_length("file") AS "size", substring("file" from 1 for ${FILE_CONTENT_HEAD_LENGTH}) AS "head" FROM "File" WHERE "_id" = ANY($1::uuid[]) AND "deletedAt" IS NULL`,
        [data.fileIds],
      ),
    );

    for (const row of rows) {
      const fileId: string | null = readId(row["_id"]);

      if (!fileId) {
        continue;
      }

      files.set(fileId, {
        fileId: fileId,
        name: typeof row["name"] === "string" ? row["name"] : "",
        fileType: typeof row["fileType"] === "string" ? row["fileType"] : "",
        size: Number(row["size"]) || 0,
        projectId: readId(row["projectId"]),
        head: toBytes(row["head"]),
      });
    }

    return files;
  }

  /*
   * The checks a file a row does not hold yet must pass to go in a field of
   * that row's project. Throws the refusal; returns nothing when it passes.
   */
  private static assertMayAdd(data: {
    fieldName: string;
    file: StoredFile | undefined;
    projectId: string | null;
  }): void {
    const file: StoredFile | undefined = data.file;

    if (!file || !data.projectId || file.projectId !== data.projectId) {
      throw new BadDataException(
        CustomFieldFileMessages.notFound(data.fieldName),
      );
    }

    const fileName: string = file.name || file.fileId;

    if (file.size > CUSTOM_FIELD_FILE_MAX_SIZE_IN_BYTES) {
      throw new BadDataException(
        CustomFieldFileMessages.tooLarge({
          field: data.fieldName,
          file: fileName,
        }),
      );
    }

    if (!isCustomFieldFileMimeType(file.fileType)) {
      throw new BadDataException(
        CustomFieldFileMessages.notAccepted({
          field: data.fieldName,
          file: fileName,
        }),
      );
    }

    if (
      !isFileContentOfType({
        fileType: file.fileType,
        head: file.head,
        size: file.size,
      })
    ) {
      throw new BadDataException(
        CustomFieldFileMessages.notWhatItSays({
          field: data.fieldName,
          file: fileName,
        }),
      );
    }
  }

  /*
   * The ids a field's written value names, in order, after the shape
   * checks a value of its type must pass (the API's own value check words
   * them the same: CustomFieldValueValidator).
   */
  private static readWrittenFileIds(data: {
    field: CustomFieldFileField;
    value: unknown;
  }): Array<string> {
    const references: CustomFieldFileReferences = readCustomFieldFileReferences(
      data.value,
    );
    const name: string = data.field.name;

    if (data.field.customFieldType === CustomFieldType.File) {
      if (references.isList || references.fileIds.length !== 1) {
        throw new BadDataException(
          `"${name}" holds one file: send the file's id, or { "fileId": "<id>" }.`,
        );
      }

      return references.fileIds;
    }

    if (references.unreadableCount > 0) {
      throw new BadDataException(
        `"${name}" holds a list of files: send a list of file ids, or of { "fileId": "<id>" }.`,
      );
    }

    if (references.duplicateCount > 0) {
      throw new BadDataException(
        `"${name}" lists the same file more than once.`,
      );
    }

    if (references.fileIds.length > CUSTOM_FIELD_MAX_FILES) {
      throw new BadDataException(
        `"${name}" holds at most ${CUSTOM_FIELD_MAX_FILES} files, but was sent ${references.fileIds.length}.`,
      );
    }

    return references.fileIds;
  }

  /**
   * The bag a create or an update of these rows stores, with every file
   * field's value read from its files and checked (see the file header), and
   * which files each row lets go of. Null when the write names no file and
   * no row holds one: nothing to do, and nothing was read. Throws the
   * refusal.
   *
   * A create passes its one new row, holding nothing yet; an update the
   * rows it is about to write, as they are. An update writes the whole bag,
   * so a file field it leaves out lets go of its files.
   */
  public static async prepareWrite(data: {
    recordTableName: string;
    // The bag the write was given.
    customFields: unknown;
    rows: Array<CustomFieldFileRow>;
    query: CustomFieldFileQuery;
  }): Promise<PreparedCustomFieldFiles | null> {
    if (!getCustomFieldRecordKind(data.recordTableName)) {
      return null;
    }

    const written: JSONObject | null = isPlainObject(data.customFields)
      ? data.customFields
      : null;

    const namesFiles: boolean = CustomFieldFiles.mayNameFiles(written);
    const anyHeld: boolean = data.rows.some(
      (row: CustomFieldFileRow): boolean => {
        return CustomFieldFiles.holdsFiles(row.customFields);
      },
    );

    if (!namesFiles && !anyHeld) {
      return null;
    }

    // The file fields of each project the rows are in.
    const projectIds: Array<string> = Array.from(
      new Set<string>(
        data.rows
          .map((row: CustomFieldFileRow): string | null => {
            return readId(row.projectId);
          })
          .filter((id: string | null): id is string => {
            return id !== null;
          }),
      ),
    );

    const fieldsByProject: Map<
      string,
      Array<CustomFieldFileField>
    > = new Map();

    for (const projectId of projectIds) {
      fieldsByProject.set(
        projectId,
        await CustomFieldFiles.getFileFields({
          recordTableName: data.recordTableName,
          projectId: projectId,
          query: data.query,
        }),
      );
    }

    /*
     * One bag is written to every row, so a field is a file field for all
     * of them or for none: a root write across projects whose fields
     * differ is refused rather than stored as files in one and text in
     * another.
     */
    const fieldSets: Array<string> = projectIds.map(
      (projectId: string): string => {
        return JSON.stringify(
          (fieldsByProject.get(projectId) || [])
            .map((field: CustomFieldFileField): string => {
              return `${field.customFieldType}:${field.name}`;
            })
            .sort(),
        );
      },
    );

    if (new Set<string>(fieldSets).size > 1 && namesFiles) {
      throw new BadDataException(CustomFieldFileMessages.severalProjects);
    }

    const fields: Array<CustomFieldFileField> =
      fieldsByProject.get(projectIds[0] || "") || [];

    const rewritten: JSONObject | null = written ? { ...written } : null;

    // The files each field's written value names, in order.
    const writtenIds: Map<string, Array<string>> = new Map();

    for (const field of fields) {
      if (
        !rewritten ||
        !Object.prototype.hasOwnProperty.call(rewritten, field.name)
      ) {
        continue;
      }

      const value: unknown = rewritten[field.name];

      if (isCustomFieldValueEmpty(value)) {
        delete rewritten[field.name];
        continue;
      }

      writtenIds.set(
        field.name,
        CustomFieldFiles.readWrittenFileIds({ field, value }),
      );
    }

    const allWrittenIds: Array<string> = Array.from(
      new Set<string>(Array.from(writtenIds.values()).flat()),
    );

    const files: Map<string, StoredFile> = await CustomFieldFiles.readFiles({
      fileIds: allWrittenIds,
      query: data.query,
    });

    // Each new file is checked against the project of every row that gains it.
    for (const field of fields) {
      const ids: Array<string> = writtenIds.get(field.name) || [];

      if (ids.length === 0) {
        continue;
      }

      for (const row of data.rows) {
        const held: Set<string> = new Set<string>(
          readCustomFieldFiles(
            isPlainObject(row.customFields)
              ? row.customFields[field.name]
              : undefined,
          ).map((file: CustomFieldFile): string => {
            return file.fileId;
          }),
        );

        for (const id of ids) {
          if (held.has(id)) {
            continue;
          }

          CustomFieldFiles.assertMayAdd({
            fieldName: field.name,
            file: files.get(id),
            projectId: readId(row.projectId),
          });
        }
      }

      /*
       * What is stored: each file as File says it is. A file a row held
       * that is gone since is no file to hold.
       */
      const stored: Array<CustomFieldFile> = [];

      for (const id of ids) {
        const file: StoredFile | undefined = files.get(id);

        if (!file) {
          continue;
        }

        stored.push({
          fileId: file.fileId,
          name: file.name || file.fileId,
          fileType: file.fileType,
          size: file.size,
        });
      }

      if (field.customFieldType === CustomFieldType.MultipleFiles) {
        const total: number = stored.reduce(
          (sum: number, file: CustomFieldFile): number => {
            return sum + file.size;
          },
          0,
        );

        if (total > CUSTOM_FIELD_FILES_MAX_TOTAL_SIZE_IN_BYTES) {
          throw new BadDataException(
            CustomFieldFileMessages.tooMuchInAll({
              field: field.name,
              size: formatCustomFieldFileSize(total),
            }),
          );
        }
      }

      if (stored.length === 0) {
        delete rewritten![field.name];
      } else if (field.customFieldType === CustomFieldType.File) {
        rewritten![field.name] = stored[0] as unknown as JSONValue;
      } else {
        rewritten![field.name] = stored as unknown as JSONValue;
      }
    }

    // The files each row holds now that the bag it is given does not.
    const keptIds: Set<string> = new Set<string>();

    for (const field of fields) {
      for (const file of readCustomFieldFiles(rewritten?.[field.name])) {
        keptIds.add(file.fileId);
      }
    }

    const releasedFileIds: Map<string, Set<string>> = new Map();

    for (const row of data.rows) {
      const projectId: string | null = readId(row.projectId);

      if (!projectId || !isPlainObject(row.customFields)) {
        continue;
      }

      for (const field of fieldsByProject.get(projectId) || []) {
        for (const file of readCustomFieldFiles(
          row.customFields[field.name],
        )) {
          if (keptIds.has(file.fileId)) {
            continue;
          }

          if (!releasedFileIds.has(projectId)) {
            releasedFileIds.set(projectId, new Set<string>());
          }

          releasedFileIds.get(projectId)!.add(file.fileId);
        }
      }
    }

    return { customFields: rewritten, releasedFileIds: releasedFileIds };
  }

  /**
   * The files deleted rows let go of, per project: every file their bags
   * hold, in any field.
   */
  public static getReleasedFileIdsOfDeletedRows(
    rows: Array<CustomFieldFileRow>,
  ): Map<string, Set<string>> {
    const released: Map<string, Set<string>> = new Map();

    for (const row of rows) {
      const projectId: string | null = readId(row.projectId);
      const held: Set<string> = CustomFieldFiles.getHeldFileIds(
        row.customFields,
      );

      if (!projectId || held.size === 0) {
        continue;
      }

      if (!released.has(projectId)) {
        released.set(projectId, new Set<string>());
      }

      for (const fileId of held) {
        released.get(projectId)!.add(fileId);
      }
    }

    return released;
  }

  /**
   * Of these files of a project, the ones something still holds: a record
   * of the project in a custom field - any kind of record, deleted rows
   * included - or any column that points at a File. One query a table.
   */
  public static async findHeldFileIds(data: {
    projectId: string;
    fileIds: Array<string>;
    fileReferenceColumns: Array<FileReferenceColumn>;
    query: CustomFieldFileQuery;
  }): Promise<Set<string>> {
    const held: Set<string> = new Set<string>();
    const fileIds: Array<string> = data.fileIds.filter((id: string) => {
      return ObjectID.isValidUUID(id);
    });

    if (fileIds.length === 0) {
      return held;
    }

    const recordTables: Array<string> = Array.from(
      new Set<string>(
        CUSTOM_FIELD_RECORD_KINDS.map((kind: CustomFieldRecordKind): string => {
          return kind.recordTableName;
        }),
      ),
    );

    for (const tableName of recordTables) {
      const rows: Array<Record<string, unknown>> = readRows(
        await data.query(
          `SELECT "candidate" FROM unnest($2::text[]) AS "candidate" WHERE EXISTS (SELECT 1 FROM ${quoteIdentifier(
            tableName,
          )} AS "record" WHERE "record"."projectId" = $1 AND "record"."customFields" IS NOT NULL AND "record"."customFields"::text LIKE '%' || "candidate" || '%')`,
          [data.projectId, fileIds],
        ),
      );

      for (const row of rows) {
        const id: string | null = readId(row["candidate"]);

        if (id) {
          held.add(id);
        }
      }
    }

    for (const reference of data.fileReferenceColumns) {
      const rows: Array<Record<string, unknown>> = readRows(
        await data.query(
          `SELECT DISTINCT ${quoteIdentifier(
            reference.columnName,
          )}::text AS "fileId" FROM ${quoteIdentifier(
            reference.tableName,
          )} WHERE ${quoteIdentifier(reference.columnName)} = ANY($1::uuid[])`,
          [fileIds],
        ),
      );

      for (const row of rows) {
        const id: string | null = readId(row["fileId"]);

        if (id) {
          held.add(id);
        }
      }
    }

    return held;
  }

  /**
   * Deletes the files of a project that nothing holds any more (see
   * findHeldFileIds), and only files of that project. Best-effort: never
   * throws. Returns how many were deleted.
   */
  public static async deleteUnheldFiles(data: {
    releasedFileIds: Map<string, Set<string>>;
    fileReferenceColumns: Array<FileReferenceColumn>;
    query: CustomFieldFileQuery;
  }): Promise<number> {
    let deleted: number = 0;

    for (const [projectId, fileIdSet] of data.releasedFileIds) {
      const fileIds: Array<string> = Array.from(fileIdSet).filter(
        (id: string): boolean => {
          return ObjectID.isValidUUID(id);
        },
      );

      if (fileIds.length === 0 || !ObjectID.isValidUUID(projectId)) {
        continue;
      }

      try {
        const held: Set<string> = await CustomFieldFiles.findHeldFileIds({
          projectId: projectId,
          fileIds: fileIds,
          fileReferenceColumns: data.fileReferenceColumns,
          query: data.query,
        });

        const unheld: Array<string> = fileIds.filter((id: string): boolean => {
          return !held.has(id);
        });

        if (unheld.length === 0) {
          continue;
        }

        const rows: Array<Record<string, unknown>> = readRows(
          await data.query(
            `DELETE FROM "File" WHERE "_id" = ANY($1::uuid[]) AND "projectId" = $2 RETURNING "_id"`,
            [unheld, projectId],
          ),
        );

        deleted += rows.length;
      } catch (err) {
        logger.error(
          `CustomFieldFiles: could not delete the files records of project ${projectId} let go of: ${String(err)}`,
        );
      }
    }

    return deleted;
  }

  /**
   * Every column that points at a File, from the entity metadata: the id
   * column of a relation to one file, and the File side of each join table
   * that lists several. A file one of them points at is never deleted here.
   */
  public static getFileReferenceColumns(
    entityMetadatas: Array<{
      tableName: string;
      relations: Array<{
        inverseEntityMetadata: { tableName: string };
        isManyToOne?: boolean;
        isOneToOneOwner?: boolean;
        isManyToManyOwner?: boolean;
        joinColumns: Array<{ databaseName: string }>;
        junctionEntityMetadata?:
          | {
              tableName: string;
              inverseColumns: Array<{ databaseName: string }>;
            }
          | undefined;
      }>;
    }>,
  ): Array<FileReferenceColumn> {
    const columns: Array<FileReferenceColumn> = [];
    const seen: Set<string> = new Set<string>();

    const add: (tableName: string, columnName: string) => void = (
      tableName: string,
      columnName: string,
    ): void => {
      const key: string = `${tableName}.${columnName}`;

      if (!seen.has(key)) {
        seen.add(key);
        columns.push({ tableName, columnName });
      }
    };

    for (const entity of entityMetadatas || []) {
      for (const relation of entity.relations || []) {
        if (relation.inverseEntityMetadata?.tableName !== "File") {
          continue;
        }

        if (relation.isManyToOne || relation.isOneToOneOwner) {
          for (const column of relation.joinColumns || []) {
            add(entity.tableName, column.databaseName);
          }
        }

        if (relation.isManyToManyOwner && relation.junctionEntityMetadata) {
          for (const column of relation.junctionEntityMetadata
            .inverseColumns || []) {
            add(relation.junctionEntityMetadata.tableName, column.databaseName);
          }
        }
      }
    }

    return columns;
  }
}
