import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import ColumnPermissions from "../../Types/Database/Permissions/ColumnPermission";
import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import DatabaseService from "../../Services/DatabaseService";
import FileService, { ProjectImageFacts } from "../../Services/FileService";
import FileOwnership, { FileOwnerKind, normalizeFileId } from "./FileOwnership";
import RelatedFileAccess, { RelatedFileReader } from "./RelatedFileAccess";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { CustomFieldRecordKind } from "../../../Types/CustomField/CustomFieldRecordKinds";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import {
  collectMarkdownFileReferences,
  getMarkdownFileLeftOutReason,
  getMarkdownFileType,
  MARKDOWN_FILE_LEFT_OUT_MESSAGES,
  MARKDOWN_FILES_MAX_REFERENCES,
  MarkdownFile,
  MarkdownFileLeftOut,
  MarkdownFileLeftOutReason,
  MarkdownFileReference,
  MarkdownFilesResult,
  MarkdownFilesTally,
  MarkdownSource,
} from "../../../Types/File/MarkdownFiles";
import {
  canShowMarkdownFiles,
  CUSTOM_FIELDS_COLUMN,
  getMarkdownColumns,
  getMarkdownCustomFieldKind,
} from "../../../Types/File/MarkdownRecords";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import crypto from "crypto";

/*
 * THE FILES A RECORD'S MARKDOWN SHOWS, READ AS THE CALLER (#11256).
 *
 * The one way an API key or a workflow reads the bytes of an image pasted
 * into Markdown (Types/File/MarkdownFiles says why the image's own address
 * does not take them). A caller names a record; what it is handed is decided
 * in this order:
 *
 *   1. The caller is signed in: a person, an API key, a workflow's step. An
 *      anonymous request is refused, whatever the record's table lets the
 *      public read.
 *   2. The record is read as the caller, through its own service: the
 *      table, its labels, private records, the project - every rule a read
 *      of it meets. A record the caller may not read is not there for them,
 *      exactly as for one that does not exist.
 *   3. Only the Markdown the caller may read is read: the record's Markdown
 *      columns their permissions let them read, and its Markdown custom
 *      fields when they may read its custom fields. An image only a column
 *      they may not read shows is never named.
 *   4. Each address that Markdown holds is looked up among the files of the
 *      record's own project, and only there: a token copied from another
 *      project's record, a deleted file and a made-up token all read as no
 *      file. The file must then be one the caller may see by the rule every
 *      read of a file's bytes follows (RelatedFileAccess).
 *   5. It is handed out when it is a raster picture that holds what its type
 *      says, within the limits on one file, on the number of files and on
 *      their total (Types/File/MarkdownFiles). Its bytes are read only then.
 *
 * Nothing else is ever read: the caller cannot list files, name one, or
 * reach one through a record they may not read. A file two records show is
 * handed out through either, to whoever may read that record.
 */

// What reads the project's Markdown custom fields: the record's service.
type RawQuery = (sql: string, parameters: Array<unknown>) => Promise<unknown>;

type ReadRowsFunction = (result: unknown) => Array<Record<string, unknown>>;

// What a raw query handed back, as rows: pg's array, or TypeORM's [rows, count].
const readRows: ReadRowsFunction = (
  result: unknown,
): Array<Record<string, unknown>> => {
  if (!Array.isArray(result)) {
    return [];
  }

  const rows: Array<unknown> =
    result.length === 2 && Array.isArray(result[0]) ? result[0] : result;

  return rows.filter((row: unknown): row is Record<string, unknown> => {
    return typeof row === "object" && row !== null && !Array.isArray(row);
  });
};

// An id as a record holds it: an ObjectID, or a uuid string.
const readId: (value: unknown) => ObjectID | null = (
  value: unknown,
): ObjectID | null => {
  const id: string = normalizeFileId(value);

  return ObjectID.isValidUUID(id) ? new ObjectID(id) : null;
};

export default class MarkdownFiles {
  // The column every record keeps its custom field values in.
  public static readonly CUSTOM_FIELDS_COLUMN: string = CUSTOM_FIELDS_COLUMN;

  // A model's Markdown columns, in the order it declares them.
  public static getMarkdownColumns(model: BaseModel): Array<string> {
    return getMarkdownColumns(model);
  }

  // The kind of custom fields a model's records hold, when they hold them.
  public static getCustomFieldKind(
    model: BaseModel,
  ): CustomFieldRecordKind | undefined {
    return getMarkdownCustomFieldKind(model);
  }

  /*
   * Whether a model's records can show files in Markdown
   * (Types/File/MarkdownRecords): only these get the markdown-files route.
   */
  public static canShowFiles(model: BaseModel): boolean {
    return canShowMarkdownFiles(model);
  }

  /*
   * The id the file goes by in an email that shows it inline (cid:<id>):
   * derived from its token, so the same file has the same id from any record,
   * while the token itself - which opens the image for the project's people -
   * never goes out with the email.
   */
  public static getContentId(token: string): string {
    return `image-${crypto
      .createHash("sha256")
      .update(token)
      .digest("hex")
      .slice(0, 24)}`;
  }

  /**
   * The files the record's Markdown shows, as `props` - the caller's - may
   * have them (see the top of this file). Throws NotFoundException for a
   * record that does not exist or the caller may not read, and whatever the
   * read throws for a caller who may not read the table at all.
   */
  public static async readRecordFiles(data: {
    service: DatabaseService<BaseModel>;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<MarkdownFilesResult> {
    DatabaseCommonInteractionPropsUtil.assertCredentialsPresent(data.props);

    const model: BaseModel = data.service.getModel();
    const tenantColumn: string | null = model.getTenantColumn();

    if (!this.canShowFiles(model) || !tenantColumn) {
      throw new NotFoundException(this.getNotFoundMessage(model));
    }

    const readable: Set<string> = this.getReadableColumns(data);

    const markdownColumns: Array<string> = this.getMarkdownColumns(
      model,
    ).filter((column: string): boolean => {
      return readable.has(column);
    });

    const customFieldKind: CustomFieldRecordKind | undefined = readable.has(
      this.CUSTOM_FIELDS_COLUMN,
    )
      ? this.getCustomFieldKind(model)
      : undefined;

    const select: JSONObject = { _id: true, [tenantColumn]: true };

    for (const column of markdownColumns) {
      select[column] = true;
    }

    if (customFieldKind) {
      select[this.CUSTOM_FIELDS_COLUMN] = true;
    }

    // As the caller: what they may not read is not there for them.
    const record: BaseModel | null = await data.service.findOneBy({
      query: {
        _id: data.recordId.toString(),
        ...(data.props.tenantId && !data.props.isRoot
          ? { [tenantColumn]: data.props.tenantId }
          : {}),
      } as Query<BaseModel>,
      select: select as Select<BaseModel>,
      props: data.props,
    });

    const projectId: ObjectID | null = readId(
      record?.getValue<ObjectID>(tenantColumn),
    );

    if (!record || !projectId) {
      throw new NotFoundException(this.getNotFoundMessage(model));
    }

    const sources: Array<MarkdownSource> = markdownColumns.map(
      (column: string): MarkdownSource => {
        return { field: column, markdown: record.getValue<string>(column) };
      },
    );

    if (customFieldKind) {
      const customFields: JSONObject | undefined = record.getValue<JSONObject>(
        this.CUSTOM_FIELDS_COLUMN,
      );

      if (customFields && typeof customFields === "object") {
        for (const name of await this.getMarkdownCustomFieldNames({
          kind: customFieldKind,
          projectId: projectId,
          query: async (
            sql: string,
            parameters: Array<unknown>,
          ): Promise<unknown> => {
            return await data.service
              .getRepository()
              .manager.query(sql, parameters);
          },
        })) {
          sources.push({
            field: name,
            markdown: (customFields as Record<string, unknown>)[name],
          });
        }
      }
    }

    return await this.handOut({
      references: collectMarkdownFileReferences(sources),
      projectId: projectId,
      reader: RelatedFileAccess.getReader(data.props),
    });
  }

  /*
   * The columns of the record's table the caller may read: all of them for
   * OneUptime itself and server admins, whose reads are never held to
   * columns; otherwise the ones their permission rows open
   * (ColumnPermissions), exactly as the read below checks its select.
   */
  private static getReadableColumns(data: {
    service: DatabaseService<BaseModel>;
    props: DatabaseCommonInteractionProps;
  }): Set<string> {
    const model: BaseModel = data.service.getModel();

    if (data.props.isRoot || data.props.isMasterAdmin) {
      return new Set<string>(model.getTableColumns().columns);
    }

    return new Set<string>(
      ColumnPermissions.getModelColumnsByPermissions(
        data.service.modelType,
        ColumnPermissions.getColumnCheckRows(data.props),
        DatabaseRequestType.Read,
      ).columns,
    );
  }

  /*
   * The project's Markdown custom fields for this kind of record, by name, in
   * the order they were made. Read as OneUptime: which fields are Markdown is
   * the project's setup, not the caller's data, and decides only which of
   * the values the caller already read are looked in.
   */
  public static async getMarkdownCustomFieldNames(data: {
    kind: CustomFieldRecordKind;
    projectId: ObjectID;
    query: RawQuery;
  }): Promise<Array<string>> {
    const rows: Array<Record<string, unknown>> = readRows(
      await data.query(
        `SELECT "name" FROM "${data.kind.definitionTableName.replace(/"/g, '""')}" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "customFieldType" = $2 ORDER BY "createdAt" ASC, "name" ASC`,
        [data.projectId.toString(), CustomFieldType.Markdown],
      ),
    );

    const names: Array<string> = [];

    for (const row of rows) {
      const name: unknown = row["name"];

      if (typeof name === "string" && name && !names.includes(name)) {
        names.push(name);
      }
    }

    return names;
  }

  /*
   * Each file the Markdown shows, handed out or left out with the reason, in
   * the order it is shown. The files are looked up among the project's alone,
   * and only the bytes of those handed out are read.
   */
  public static async handOut(data: {
    references: Array<MarkdownFileReference>;
    projectId: ObjectID;
    reader: RelatedFileReader | null;
  }): Promise<MarkdownFilesResult> {
    const leftOut: Array<MarkdownFileLeftOut> = [];

    const leaveOut: (
      reference: MarkdownFileReference,
      reason: MarkdownFileLeftOutReason,
      name: string | null,
    ) => void = (
      reference: MarkdownFileReference,
      reason: MarkdownFileLeftOutReason,
      name: string | null,
    ): void => {
      leftOut.push({
        name: name,
        urls: [...reference.urls],
        fields: [...reference.fields],
        reason: reason,
        message: MARKDOWN_FILE_LEFT_OUT_MESSAGES[reason],
      });
    };

    const lookedUp: Array<MarkdownFileReference> = data.references.slice(
      0,
      MARKDOWN_FILES_MAX_REFERENCES,
    );

    const images: Map<string, ProjectImageFacts> =
      lookedUp.length > 0
        ? await FileService.getProjectImagesByToken({
            tokens: lookedUp.map((reference: MarkdownFileReference): string => {
              return reference.token;
            }),
            projectId: data.projectId,
          })
        : new Map();

    const kept: Array<{
      reference: MarkdownFileReference;
      image: ProjectImageFacts;
    }> = [];

    const tally: MarkdownFilesTally = { count: 0, totalSizeInBytes: 0 };

    for (const reference of lookedUp) {
      const image: ProjectImageFacts | undefined = images.get(reference.token);

      // Of the record's own project, and one the caller may see.
      if (
        !image ||
        !FileOwnership.isFileOfProject(image, data.projectId) ||
        !(await this.mayRead({
          image: image,
          projectId: data.projectId,
          reader: data.reader,
        }))
      ) {
        leaveOut(reference, MarkdownFileLeftOutReason.NotFound, null);
        continue;
      }

      const reason: MarkdownFileLeftOutReason | null =
        getMarkdownFileLeftOutReason({
          file: {
            name: image.name,
            fileType: image.fileType,
            sizeInBytes: image.sizeInBytes,
            head: image.head,
          },
          tally: tally,
        });

      if (reason) {
        leaveOut(reference, reason, image.name);
        continue;
      }

      kept.push({ reference, image });
      tally.count++;
      tally.totalSizeInBytes += image.sizeInBytes;
    }

    // The rest were never looked up.
    for (const reference of data.references.slice(
      MARKDOWN_FILES_MAX_REFERENCES,
    )) {
      leaveOut(reference, MarkdownFileLeftOutReason.TooMany, null);
    }

    const bytes: Map<string, Buffer> =
      kept.length > 0
        ? await FileService.getProjectFileBytes({
            fileIds: kept.map(
              (entry: { image: ProjectImageFacts }): ObjectID => {
                return entry.image.fileId;
              },
            ),
            projectId: data.projectId,
          })
        : new Map();

    const files: Array<MarkdownFile> = [];

    for (const entry of kept) {
      const fileBytes: Buffer | undefined = bytes.get(
        normalizeFileId(entry.image.fileId),
      );

      // Deleted between the two reads.
      if (!fileBytes) {
        leaveOut(entry.reference, MarkdownFileLeftOutReason.NotFound, null);
        continue;
      }

      files.push({
        name: entry.image.name,
        mimeType:
          getMarkdownFileType(entry.image.fileType) || entry.image.fileType,
        sizeInBytes: fileBytes.length,
        base64: fileBytes.toString("base64"),
        contentId: this.getContentId(entry.reference.token),
        urls: [...entry.reference.urls],
        fields: [...entry.reference.fields],
      });
    }

    return { files: files, leftOut: leftOut };
  }

  /*
   * Whether the caller may see the image, by the rule every read of a file's
   * bytes follows (RelatedFileAccess): an image of the record's project, to
   * a caller whose permissions are for that project. Null - OneUptime itself
   * or a server admin - may see every file.
   */
  private static async mayRead(data: {
    image: ProjectImageFacts;
    projectId: ObjectID;
    reader: RelatedFileReader | null;
  }): Promise<boolean> {
    if (!data.reader) {
      return true;
    }

    return await RelatedFileAccess.mayRead({
      file: data.image,
      owner: { kind: FileOwnerKind.Project, projectId: data.projectId },
      reader: data.reader,
    });
  }

  // What a record that is not there for the caller is answered with.
  public static getNotFoundMessage(model: BaseModel): string {
    return `${model.singularName || "Record"} not found.`;
  }
}
