import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import DatabaseService from "../../Services/DatabaseService";
import FileService, { ProjectImageFacts } from "../../Services/FileService";
import FileOwnership, { FileOwnerKind, normalizeFileId } from "./FileOwnership";
import MarkdownFiles from "./MarkdownFiles";
import RelatedFileAccess, { RelatedFileReader } from "./RelatedFileAccess";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import {
  CustomFieldFile,
  readCustomFieldFiles,
} from "../../../Types/CustomField/CustomFieldFile";
import { CustomFieldRecordKind } from "../../../Types/CustomField/CustomFieldRecordKinds";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import {
  ATTACHMENT_LEFT_OUT_MESSAGES,
  ATTACHMENTS_MAX_REFERENCES,
  AttachmentFile,
  AttachmentLeftOut,
  AttachmentLeftOutReason,
  AttachmentReference,
  canHoldAttachments,
  getAttachmentColumns,
  getAttachmentFileType,
  getAttachmentLeftOutReason,
  RecordAttachmentsResult,
} from "../../../Types/File/RecordAttachments";
import { MarkdownFilesTally } from "../../../Types/File/MarkdownFiles";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import crypto from "crypto";

/*
 * THE FILES A RECORD HOLDS, READ AS THE CALLER (#11477).
 *
 * What a Get Attachments From Record step hands a workflow: the files of
 * the record's File and Multiple files custom fields, and of its own lists
 * of files - a note's attachments, an incident's postmortem attachments.
 * Decided in the order Get Files From Markdown's images are
 * (MarkdownFiles):
 *
 *   1. The caller is signed in: a workflow's step, a person or an API key.
 *      OneUptime itself is never asked.
 *   2. The record is read as the caller, through its own service: the
 *      table, its labels, private records, the project - every rule a read
 *      of it meets. A record the caller may not read is not there for them,
 *      exactly as for one that does not exist.
 *   3. Only the columns the caller may read are read: the lists of files
 *      their permissions open, and the custom fields when they may read
 *      them - of those, only the project's File and Multiple files fields.
 *      The lists are read as ids alone: a file's bytes are read below, and
 *      only for what is handed out.
 *   4. Each file is looked up among the files of the record's own project,
 *      and only there: another project's file, a deleted one and an id of
 *      none all read as no file. The file must then be one the caller may
 *      see by the rule every read of a file's bytes follows
 *      (RelatedFileAccess).
 *   5. It is handed out when it is a kind of file handed out that holds what
 *      its type says - never an SVG - within the limits on one file, on the
 *      number of files and on their total (Types/File/RecordAttachments).
 *
 * Nothing else is ever read: the caller cannot list files, name one, or
 * reach one through a record they may not read.
 */

// What a raw query handed back, as rows: pg's array, or TypeORM's [rows, count].
const readRows: (result: unknown) => Array<Record<string, unknown>> = (
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

type RawQuery = (sql: string, parameters: Array<unknown>) => Promise<unknown>;

export default class RecordAttachments {
  /*
   * The id a file goes by in an email (cid:<id>): derived from the file's
   * id, the same from any record, while the id itself never goes out.
   */
  public static getContentId(fileId: string): string {
    return `attachment-${crypto
      .createHash("sha256")
      .update(normalizeFileId(fileId))
      .digest("hex")
      .slice(0, 24)}`;
  }

  /**
   * The files the record holds, as `props` - the caller's - may have them
   * (see the top of this file). Throws NotFoundException for a record that
   * does not exist or the caller may not read, and whatever the read throws
   * for a caller who may not read the table at all.
   */
  public static async readRecordAttachments(data: {
    service: DatabaseService<BaseModel>;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<RecordAttachmentsResult> {
    // OneUptime itself (root) is never a request, so never anonymous.
    if (!data.props.isRoot) {
      DatabaseCommonInteractionPropsUtil.assertCredentialsPresent(data.props);
    }

    const model: BaseModel = data.service.getModel();
    const tenantColumn: string | null = model.getTenantColumn();

    if (!canHoldAttachments(model) || !tenantColumn) {
      throw new NotFoundException(MarkdownFiles.getNotFoundMessage(model));
    }

    const readable: Set<string> = MarkdownFiles.getReadableColumns(data);

    const listColumns: Array<string> = getAttachmentColumns(model).filter(
      (column: string): boolean => {
        return readable.has(column);
      },
    );

    const customFieldKind: CustomFieldRecordKind | undefined = readable.has(
      MarkdownFiles.CUSTOM_FIELDS_COLUMN,
    )
      ? MarkdownFiles.getCustomFieldKind(model)
      : undefined;

    const select: JSONObject = { _id: true, [tenantColumn]: true };

    // Each list as the ids of its files: their bytes are read only below.
    for (const column of listColumns) {
      select[column] = { _id: true };
    }

    if (customFieldKind) {
      select[MarkdownFiles.CUSTOM_FIELDS_COLUMN] = true;
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

    const projectId: string = normalizeFileId(
      record?.getValue<ObjectID>(tenantColumn),
    );

    if (!record || !ObjectID.isValidUUID(projectId)) {
      throw new NotFoundException(MarkdownFiles.getNotFoundMessage(model));
    }

    const references: Array<AttachmentReference> = [];

    const add: (fileId: unknown, field: string) => void = (
      fileId: unknown,
      field: string,
    ): void => {
      const id: string = normalizeFileId(fileId);

      if (!ObjectID.isValidUUID(id)) {
        return;
      }

      const known: AttachmentReference | undefined = references.find(
        (reference: AttachmentReference): boolean => {
          return reference.fileId === id;
        },
      );

      if (!known) {
        references.push({ fileId: id, fields: [field] });
      } else if (!known.fields.includes(field)) {
        known.fields.push(field);
      }
    };

    // The record's own lists, in the order the model declares them.
    for (const column of listColumns) {
      const files: unknown = record.getValue<JSONObject>(column);

      for (const file of Array.isArray(files) ? files : []) {
        add(
          (file as Record<string, unknown> | null)?.["_id"] ||
            (file as Record<string, unknown> | null)?.["id"],
          column,
        );
      }
    }

    // Then its file custom fields, in the order the project made them.
    if (customFieldKind) {
      const customFields: unknown = record.getValue<JSONObject>(
        MarkdownFiles.CUSTOM_FIELDS_COLUMN,
      );

      if (customFields && typeof customFields === "object") {
        for (const name of await this.getFileCustomFieldNames({
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
          for (const file of readCustomFieldFiles(
            (customFields as Record<string, unknown>)[name],
          ) as Array<CustomFieldFile>) {
            add(file.fileId, name);
          }
        }
      }
    }

    return await this.handOut({
      references: references,
      projectId: new ObjectID(projectId),
      reader: RelatedFileAccess.getReader(data.props),
    });
  }

  /*
   * The project's File and Multiple files custom fields for this kind of
   * record, by name, in the order they were made. Read as OneUptime: which
   * fields hold files is the project's setup, not the caller's data, and
   * decides only which of the values the caller already read are looked in.
   */
  public static async getFileCustomFieldNames(data: {
    kind: CustomFieldRecordKind;
    projectId: string;
    query: RawQuery;
  }): Promise<Array<string>> {
    const rows: Array<Record<string, unknown>> = readRows(
      await data.query(
        `SELECT "name" FROM "${data.kind.definitionTableName.replace(/"/g, '""')}" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND "customFieldType" IN ($2, $3) ORDER BY "createdAt" ASC, "name" ASC`,
        [data.projectId, CustomFieldType.File, CustomFieldType.MultipleFiles],
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
   * Each file the record holds, handed out or left out with the reason, in
   * the order it holds them. The files are looked up among the project's
   * alone, and only the bytes of those handed out are read.
   */
  public static async handOut(data: {
    references: Array<AttachmentReference>;
    projectId: ObjectID;
    reader: RelatedFileReader | null;
  }): Promise<RecordAttachmentsResult> {
    const leftOut: Array<AttachmentLeftOut> = [];

    const leaveOut: (
      reference: AttachmentReference,
      reason: AttachmentLeftOutReason,
      name: string | null,
    ) => void = (
      reference: AttachmentReference,
      reason: AttachmentLeftOutReason,
      name: string | null,
    ): void => {
      leftOut.push({
        name: name,
        fields: [...reference.fields],
        reason: reason,
        message: ATTACHMENT_LEFT_OUT_MESSAGES[reason],
      });
    };

    const lookedUp: Array<AttachmentReference> = data.references.slice(
      0,
      ATTACHMENTS_MAX_REFERENCES,
    );

    const stored: Map<string, ProjectImageFacts> =
      lookedUp.length > 0
        ? await FileService.getProjectFilesById({
            fileIds: lookedUp.map((reference: AttachmentReference): string => {
              return reference.fileId;
            }),
            projectId: data.projectId,
          })
        : new Map();

    const kept: Array<{
      reference: AttachmentReference;
      file: ProjectImageFacts;
    }> = [];

    const tally: MarkdownFilesTally = { count: 0, totalSizeInBytes: 0 };

    for (const reference of lookedUp) {
      const file: ProjectImageFacts | undefined = stored.get(reference.fileId);

      // Of the record's own project, and one the caller may see.
      if (
        !file ||
        !FileOwnership.isFileOfProject(file, data.projectId) ||
        !(await this.mayRead({
          file: file,
          projectId: data.projectId,
          reader: data.reader,
        }))
      ) {
        leaveOut(reference, AttachmentLeftOutReason.NotFound, null);
        continue;
      }

      const reason: AttachmentLeftOutReason | null = getAttachmentLeftOutReason(
        {
          file: {
            name: file.name,
            fileType: file.fileType,
            sizeInBytes: file.sizeInBytes,
            head: file.head,
          },
          tally: tally,
        },
      );

      if (reason) {
        leaveOut(reference, reason, file.name);
        continue;
      }

      kept.push({ reference, file });
      tally.count++;
      tally.totalSizeInBytes += file.sizeInBytes;
    }

    // The rest were never looked up.
    for (const reference of data.references.slice(ATTACHMENTS_MAX_REFERENCES)) {
      leaveOut(reference, AttachmentLeftOutReason.TooMany, null);
    }

    const bytes: Map<string, Buffer> =
      kept.length > 0
        ? await FileService.getProjectFileBytes({
            fileIds: kept.map(
              (entry: { file: ProjectImageFacts }): ObjectID => {
                return entry.file.fileId;
              },
            ),
            projectId: data.projectId,
          })
        : new Map();

    const files: Array<AttachmentFile> = [];

    for (const entry of kept) {
      const fileBytes: Buffer | undefined = bytes.get(
        normalizeFileId(entry.file.fileId),
      );

      // Deleted between the two reads.
      if (!fileBytes) {
        leaveOut(entry.reference, AttachmentLeftOutReason.NotFound, null);
        continue;
      }

      files.push({
        name: entry.file.name,
        mimeType:
          getAttachmentFileType(entry.file.fileType) || entry.file.fileType,
        sizeInBytes: fileBytes.length,
        base64: fileBytes.toString("base64"),
        contentId: this.getContentId(entry.reference.fileId),
        fields: [...entry.reference.fields],
      });
    }

    return { files: files, leftOut: leftOut };
  }

  /*
   * Whether the caller may see the file, by the rule every read of a file's
   * bytes follows (RelatedFileAccess): a file of the record's project, to a
   * caller whose permissions are for that project. Null - OneUptime itself
   * or a server admin - may see every file.
   */
  private static async mayRead(data: {
    file: ProjectImageFacts;
    projectId: ObjectID;
    reader: RelatedFileReader | null;
  }): Promise<boolean> {
    if (!data.reader) {
      return true;
    }

    return await RelatedFileAccess.mayRead({
      file: data.file,
      owner: { kind: FileOwnerKind.Project, projectId: data.projectId },
      reader: data.reader,
    });
  }
}
