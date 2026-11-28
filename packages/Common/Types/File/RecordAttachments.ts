import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { CUSTOM_FIELD_FILE_TYPES } from "../CustomField/CustomFieldFile";
import { TableColumnMetadata } from "../Database/TableColumn";
import TableColumnType from "../Database/TableColumnType";
import { isFileContentOfType } from "./FileContentCheck";
import {
  MARKDOWN_FILE_MAX_SIZE_IN_BYTES,
  MARKDOWN_FILES_MAX_COUNT,
  MARKDOWN_FILES_MAX_REFERENCES,
  MARKDOWN_FILES_MAX_TOTAL_SIZE_IN_BYTES,
  MarkdownFileFacts,
  MarkdownFilesTally,
} from "./MarkdownFiles";
import { getMarkdownCustomFieldKind } from "./MarkdownRecords";
import MimeType from "./MimeType";

/*
 * THE FILES A RECORD HOLDS, HANDED TO A WORKFLOW (#11477).
 *
 * Besides the pictures its Markdown shows (MarkdownFiles: Get Files From
 * Markdown), a record holds files two ways:
 *
 *   - its File and Multiple files custom fields: the record's customFields
 *     hold references to Files of its project (Types/CustomField/
 *     CustomFieldFile);
 *   - its own lists of files: a note's attachments, an incident's
 *     postmortem attachments, an announcement's attachments.
 *
 * A Get Attachments From Record step hands a workflow those files - their
 * names, types and bytes - to attach to an email, held to the rules Get
 * Files From Markdown follows (Server/Utils/File/RecordAttachments):
 *
 *   - the record is read as the workflow, through its own service, so a
 *     record or a column the workflow may not read is not read;
 *   - only the files the record holds now, and only files of the record's
 *     own project that the workflow may see; nothing is listed or found by
 *     name;
 *   - the same limits: MARKDOWN_FILE_MAX_SIZE_IN_BYTES a file,
 *     MARKDOWN_FILES_MAX_COUNT files and MARKDOWN_FILES_MAX_TOTAL_SIZE_IN_BYTES
 *     a read, MARKDOWN_FILES_MAX_REFERENCES files looked up;
 *   - documents as well as pictures, of the kinds a file custom field takes
 *     (CUSTOM_FIELD_FILE_TYPES), each checked by what it holds as well as by
 *     its type (FileContentCheck), and never an SVG, which can carry script;
 *   - never served inline: the bytes go out as base64 in JSON, and the step
 *     hides them in the run's log.
 *
 * Pure, with no Node or React imports: the server, the workflow builder and
 * the docs read the same rules.
 */

// The largest file handed out, the most of them, and their total: Get Files From Markdown's.
export const ATTACHMENT_MAX_SIZE_IN_BYTES: number =
  MARKDOWN_FILE_MAX_SIZE_IN_BYTES;
export const ATTACHMENTS_MAX_COUNT: number = MARKDOWN_FILES_MAX_COUNT;
export const ATTACHMENTS_MAX_TOTAL_SIZE_IN_BYTES: number =
  MARKDOWN_FILES_MAX_TOTAL_SIZE_IN_BYTES;
export const ATTACHMENTS_MAX_REFERENCES: number = MARKDOWN_FILES_MAX_REFERENCES;

/*
 * The kinds of file handed out: what a file custom field takes - documents,
 * spreadsheets, presentations, pictures, text and data, archives, packet
 * captures - never SVG.
 */
export const ATTACHMENT_FILE_TYPES: ReadonlyArray<MimeType> =
  CUSTOM_FIELD_FILE_TYPES.filter((type: MimeType): boolean => {
    return type !== MimeType.svg;
  });

/*
 * Other names a type was stored under before uploads were held to MimeType,
 * read as the type they are.
 */
const MIME_TYPE_ALIASES: Readonly<Record<string, MimeType>> = {
  "image/jpg": MimeType.jpeg,
  "image/pjpeg": MimeType.jpeg,
  "image/x-ms-bmp": MimeType.bmp,
};

// Why a file the record holds was not handed out.
export enum AttachmentLeftOutReason {
  // No file of the record's project has this id, or the workflow may not see it.
  NotFound = "NotFound",
  // Not a kind of file handed out (an SVG, a page), or not what its type says.
  NotAllowed = "NotAllowed",
  // Larger than ATTACHMENT_MAX_SIZE_IN_BYTES.
  TooLarge = "TooLarge",
  // It would take the read past ATTACHMENTS_MAX_TOTAL_SIZE_IN_BYTES.
  OverTotalSize = "OverTotalSize",
  // The read already holds ATTACHMENTS_MAX_COUNT files, or past the files looked up.
  TooMany = "TooMany",
}

// One file a record holds, handed out.
export interface AttachmentFile {
  // As it was uploaded: "change-request.pdf".
  name: string;
  // Its type, as one of ATTACHMENT_FILE_TYPES: "application/pdf".
  mimeType: string;
  sizeInBytes: number;
  // Its bytes, in base64: an email attachment's content as most APIs take it.
  base64: string;
  /*
   * An id for the file in an email: the same for the same file whichever
   * record or step hands it out, and never the file's own id.
   */
  contentId: string;
  /*
   * Where the record holds it: a list of its own ("attachments",
   * "postmortemAttachments") or a custom field's name.
   */
  fields: Array<string>;
}

// One file a record holds that was not handed out.
export interface AttachmentLeftOut {
  // As it was uploaded; null when no file of the project has its id.
  name: string | null;
  fields: Array<string>;
  reason: AttachmentLeftOutReason;
  // Why, in words.
  message: string;
}

// What a read of a record's attachments answers.
export interface RecordAttachmentsResult {
  files: Array<AttachmentFile>;
  leftOut: Array<AttachmentLeftOut>;
}

// Why a file was left out, in words.
export const ATTACHMENT_LEFT_OUT_MESSAGES: Readonly<
  Record<AttachmentLeftOutReason, string>
> = {
  [AttachmentLeftOutReason.NotFound]:
    "No file of this project the workflow may see has this id. It may have been deleted, or belong to another project.",
  [AttachmentLeftOutReason.NotAllowed]:
    "Only documents, spreadsheets, presentations, pictures, text, data, archives and packet captures that hold what their type says are handed out. An SVG can carry script, so it is left out.",
  [AttachmentLeftOutReason.TooLarge]: `It is larger than ${ATTACHMENT_MAX_SIZE_IN_BYTES / (1024 * 1024)} MB, the most one file may be.`,
  [AttachmentLeftOutReason.OverTotalSize]: `With the files before it, it would come to more than ${ATTACHMENTS_MAX_TOTAL_SIZE_IN_BYTES / (1024 * 1024)} MB, the most one read hands out.`,
  [AttachmentLeftOutReason.TooMany]: `The record holds more than ${ATTACHMENTS_MAX_COUNT} files. Only the first ${ATTACHMENTS_MAX_COUNT} are handed out.`,
};

// A file the record holds, before it is looked up.
export interface AttachmentReference {
  fileId: string;
  fields: Array<string>;
}

export type GetAttachmentFileTypeFunction = (
  fileType: string | null | undefined,
) => MimeType | null;

/*
 * The type a file is handed out as - one of ATTACHMENT_FILE_TYPES, an older
 * name for one read as it - or null for a type that is never handed out.
 */
export const getAttachmentFileType: GetAttachmentFileTypeFunction = (
  fileType: string | null | undefined,
): MimeType | null => {
  const normalized: string = (fileType || "").trim().toLowerCase();

  const canonical: string = Object.prototype.hasOwnProperty.call(
    MIME_TYPE_ALIASES,
    normalized,
  )
    ? MIME_TYPE_ALIASES[normalized]!
    : normalized;

  return (
    ATTACHMENT_FILE_TYPES.find((type: MimeType): boolean => {
      return type === canonical;
    }) || null
  );
};

export type GetAttachmentLeftOutReasonFunction = (data: {
  file: MarkdownFileFacts;
  tally: MarkdownFilesTally;
}) => AttachmentLeftOutReason | null;

/*
 * Why a file of the record's project is not handed out, or null when it is:
 * a kind of file handed out that holds what its type says, no larger than
 * one file may be, while the read holds fewer files than it may and this one
 * keeps it within its total.
 */
export const getAttachmentLeftOutReason: GetAttachmentLeftOutReasonFunction =
  (data: {
    file: MarkdownFileFacts;
    tally: MarkdownFilesTally;
  }): AttachmentLeftOutReason | null => {
    const type: MimeType | null = getAttachmentFileType(data.file.fileType);

    if (
      !type ||
      !isFileContentOfType({
        fileType: type,
        head: data.file.head,
        size: data.file.sizeInBytes,
      })
    ) {
      return AttachmentLeftOutReason.NotAllowed;
    }

    if (data.file.sizeInBytes > ATTACHMENT_MAX_SIZE_IN_BYTES) {
      return AttachmentLeftOutReason.TooLarge;
    }

    if (data.tally.count >= ATTACHMENTS_MAX_COUNT) {
      return AttachmentLeftOutReason.TooMany;
    }

    if (
      data.tally.totalSizeInBytes + data.file.sizeInBytes >
      ATTACHMENTS_MAX_TOTAL_SIZE_IN_BYTES
    ) {
      return AttachmentLeftOutReason.OverTotalSize;
    }

    return null;
  };

export type GetAttachmentColumnsFunction = (model: BaseModel) => Array<string>;

/*
 * A model's own lists of files - a note's attachments, an incident's
 * postmortem attachments - in the order it declares them: its relations to
 * many Files. A single file (a logo, an icon) is no attachment.
 */
export const getAttachmentColumns: GetAttachmentColumnsFunction = (
  model: BaseModel,
): Array<string> => {
  return model
    .getTableColumns()
    .columns.filter((columnName: string): boolean => {
      const metadata: TableColumnMetadata | undefined =
        model.getTableColumnMetadata(columnName);

      return (
        metadata?.type === TableColumnType.EntityArray &&
        Boolean(metadata.modelType) &&
        new metadata.modelType!().tableName === "File"
      );
    });
};

export type CanHoldAttachmentsFunction = (model: BaseModel) => boolean;

/*
 * Whether a model's records can hold files: records of a project with a
 * list of files of their own, or with custom fields, any of which may be a
 * File or Multiple files field.
 */
export const canHoldAttachments: CanHoldAttachmentsFunction = (
  model: BaseModel,
): boolean => {
  return (
    Boolean(model.tableName) &&
    Boolean(model.getTenantColumn()) &&
    (getAttachmentColumns(model).length > 0 ||
      Boolean(getMarkdownCustomFieldKind(model)))
  );
};

export type IsAttachmentRecordTypeFunction = (model: BaseModel) => boolean;

/*
 * Whether a Get Attachments From Record step reads this kind of record: one
 * that can hold files, and that a workflow reads at all (its Find One step).
 */
export const isAttachmentRecordType: IsAttachmentRecordTypeFunction = (
  model: BaseModel,
): boolean => {
  return canHoldAttachments(model) && Boolean(model.enableWorkflowOn?.read);
};

/*
 * The record types people attach files to most, in the order the Record
 * Type list leads with. Every other record type follows, by name.
 */
export const COMMON_ATTACHMENT_RECORD_TABLE_NAMES: ReadonlyArray<string> = [
  "Incident",
  "IncidentInternalNote",
  "IncidentPublicNote",
  "Alert",
  "AlertInternalNote",
  "ScheduledMaintenance",
  "ScheduledMaintenanceInternalNote",
  "ScheduledMaintenancePublicNote",
  "IncidentEpisodeInternalNote",
  "IncidentEpisodePublicNote",
  "AlertEpisodeInternalNote",
  "StatusPageAnnouncement",
];

export type GetAttachmentRecordTypesFunction = (
  models: Array<BaseModel>,
) => Array<BaseModel>;

/*
 * The record types a Get Attachments From Record step reads, as its Record
 * Type list shows them: the common ones first, in their order, then the
 * rest by name. Each once.
 */
export const getAttachmentRecordTypes: GetAttachmentRecordTypesFunction = (
  models: Array<BaseModel>,
): Array<BaseModel> => {
  const byTable: Map<string, BaseModel> = new Map();

  for (const model of models) {
    if (
      model.tableName &&
      !byTable.has(model.tableName) &&
      isAttachmentRecordType(model)
    ) {
      byTable.set(model.tableName, model);
    }
  }

  const common: Array<BaseModel> = [];

  for (const tableName of COMMON_ATTACHMENT_RECORD_TABLE_NAMES) {
    const model: BaseModel | undefined = byTable.get(tableName);

    if (model) {
      common.push(model);
      byTable.delete(tableName);
    }
  }

  const rest: Array<BaseModel> = Array.from(byTable.values()).sort(
    (left: BaseModel, right: BaseModel): number => {
      return (left.singularName || left.tableName || "").localeCompare(
        right.singularName || right.tableName || "",
      );
    },
  );

  return [...common, ...rest];
};
