import ColumnLength from "../Database/ColumnLength";
import { formatFileSize } from "../File/FileSize";
import MimeType from "../File/MimeType";
import ObjectID from "../ObjectID";
import CustomFieldType from "./CustomFieldType";

/*
 * THE VALUE OF A FILE OR MULTIPLE FILES CUSTOM FIELD.
 *
 * A record's `customFields` bag never holds a file's bytes. A File field
 * holds one reference to an uploaded File, a Multiple files field a list of
 * them, in the order they were added:
 *
 *     "Signed change request": {
 *       "fileId": "5f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
 *       "name": "change-request.pdf",
 *       "fileType": "application/pdf",
 *       "size": 48213
 *     }
 *
 * The id is what the value is: the name, the type and the size ride along
 * so a table cell, an email or a chat message can name the file without
 * reading the File table. The server writes all four from the file itself
 * whenever a write changes the value (Server/Utils/CustomField/
 * CustomFieldFiles), so what a request says about a file's name or size is
 * never stored.
 *
 * A write may name a file in any of the shapes a client already holds:
 * its id as text, { "fileId": <id> }, or the File it uploaded ({ "_id" } or
 * { "id" }); a Multiple files field takes a list of those, or one on its
 * own. readCustomFieldFileReferences reads them all.
 *
 * Pure, with no database or React imports: the server, the dashboard and
 * the public form page read values and limits the same way.
 */
export interface CustomFieldFile {
  // The File's id, in lower case.
  fileId: string;
  // As it was uploaded.
  name: string;
  // Its MIME type, as FileService stored it.
  fileType: string;
  // In bytes.
  size: number;
}

// The largest file a file custom field takes: what any upload may be.
export const CUSTOM_FIELD_FILE_MAX_SIZE_IN_BYTES: number = 10 * 1024 * 1024;

// The most files one Multiple files field holds.
export const CUSTOM_FIELD_MAX_FILES: number = 10;

// The most a Multiple files field holds, all its files together.
export const CUSTOM_FIELD_FILES_MAX_TOTAL_SIZE_IN_BYTES: number =
  50 * 1024 * 1024;

// A file's name is stored in File.name.
export const CUSTOM_FIELD_FILE_NAME_MAX_LENGTH: number = ColumnLength.ShortText;

/*
 * The kinds of file a file custom field takes: documents, spreadsheets,
 * presentations, pictures, plain text and data, archives and packet
 * captures. Each is checked by what the file holds as well as by the type it
 * was uploaded as (FileContentCheck), so a page renamed to .pdf is refused.
 *
 * Not SVG: it is a document that can carry script, not a picture. Not ICO
 * or audio either: nothing anyone attaches to a record.
 */
export const CUSTOM_FIELD_FILE_TYPES: ReadonlyArray<MimeType> = [
  MimeType.pdf,
  MimeType.doc,
  MimeType.docx,
  MimeType.odt,
  MimeType.rtf,
  MimeType.xls,
  MimeType.xlsx,
  MimeType.ods,
  MimeType.ppt,
  MimeType.pptx,
  MimeType.odp,
  MimeType.png,
  MimeType.jpeg,
  MimeType.gif,
  MimeType.webp,
  MimeType.bmp,
  MimeType.tiff,
  MimeType.avif,
  MimeType.heic,
  MimeType.txt,
  MimeType.md,
  MimeType.csv,
  MimeType.json,
  MimeType.zip,
  MimeType.pcap,
];

export type IsCustomFieldFileTypeFunction = (type: unknown) => boolean;

// Whether a field type holds files: File or Multiple files.
export const isCustomFieldFileType: IsCustomFieldFileTypeFunction = (
  type: unknown,
): boolean => {
  return (
    type === CustomFieldType.File || type === CustomFieldType.MultipleFiles
  );
};

export type IsCustomFieldFileMimeTypeFunction = (fileType: unknown) => boolean;

// Whether a file of this MIME type may be put in a file custom field.
export const isCustomFieldFileMimeType: IsCustomFieldFileMimeTypeFunction = (
  fileType: unknown,
): boolean => {
  return (
    typeof fileType === "string" &&
    (CUSTOM_FIELD_FILE_TYPES as ReadonlyArray<string>).includes(
      fileType.trim().toLowerCase(),
    )
  );
};

type IsPlainObjectFunction = (
  value: unknown,
) => value is Record<string, unknown>;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is Record<string, unknown> => {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
};

type ReadIdFunction = (value: unknown) => string | null;

// An id as a value may hold it: a uuid string or an ObjectID, in lower case.
const readId: ReadIdFunction = (value: unknown): string | null => {
  if (value instanceof ObjectID) {
    value = value.toString();
  }

  if (typeof value !== "string") {
    return null;
  }

  const id: string = value.trim().toLowerCase();

  return ObjectID.isValidUUID(id) ? id : null;
};

export type ReadCustomFieldFileReferenceFunction = (
  entry: unknown,
) => string | null;

/**
 * The file one entry of a write names - its id as text, { fileId }, or an
 * uploaded File's { _id } or { id } - in lower case; null for anything else.
 */
export const readCustomFieldFileReference: ReadCustomFieldFileReferenceFunction =
  (entry: unknown): string | null => {
    const asText: string | null = readId(entry);

    if (asText) {
      return asText;
    }

    if (!isPlainObject(entry)) {
      return null;
    }

    for (const key of ["fileId", "_id", "id"]) {
      if (Object.prototype.hasOwnProperty.call(entry, key)) {
        const id: string | null = readId(entry[key]);

        if (id) {
          return id;
        }
      }
    }

    return null;
  };

export interface CustomFieldFileReferences {
  // The files named, each once, in order.
  fileIds: Array<string>;
  // The value was a list.
  isList: boolean;
  // How many entries name no file.
  unreadableCount: number;
  // How many entries name a file named before them.
  duplicateCount: number;
  // How many entries the value has.
  entryCount: number;
}

export type ReadCustomFieldFileReferencesFunction = (
  value: unknown,
) => CustomFieldFileReferences;

/**
 * The files a write names for a field: a list's entries, or the one value
 * given. Counts what does not name a file, and what names one twice, for
 * the checks to refuse.
 */
export const readCustomFieldFileReferences: ReadCustomFieldFileReferencesFunction =
  (value: unknown): CustomFieldFileReferences => {
    const isList: boolean = Array.isArray(value);
    const entries: Array<unknown> = isList
      ? (value as Array<unknown>)
      : value === undefined || value === null || value === ""
        ? []
        : [value];

    const fileIds: Array<string> = [];
    let unreadableCount: number = 0;
    let duplicateCount: number = 0;

    for (const entry of entries) {
      const fileId: string | null = readCustomFieldFileReference(entry);

      if (!fileId) {
        unreadableCount++;
        continue;
      }

      if (fileIds.includes(fileId)) {
        duplicateCount++;
        continue;
      }

      fileIds.push(fileId);
    }

    return {
      fileIds,
      isList,
      unreadableCount,
      duplicateCount,
      entryCount: entries.length,
    };
  };

export type IsCustomFieldFileFunction = (
  value: unknown,
) => value is CustomFieldFile;

/**
 * Whether a value is a stored file reference: an object with the file's id
 * and its name. (Its type and size are read leniently: readCustomFieldFiles.)
 */
export const isCustomFieldFile: IsCustomFieldFileFunction = (
  value: unknown,
): value is CustomFieldFile => {
  return (
    isPlainObject(value) &&
    readId(value["fileId"]) !== null &&
    typeof value["name"] === "string"
  );
};

export type ReadCustomFieldFilesFunction = (
  value: unknown,
) => Array<CustomFieldFile>;

/**
 * A stored value as the files it holds, in order, for showing: one file or a
 * list of them. An entry that is not a file reference is left out, and so is
 * a file listed twice. Never throws.
 */
export const readCustomFieldFiles: ReadCustomFieldFilesFunction = (
  value: unknown,
): Array<CustomFieldFile> => {
  const entries: Array<unknown> = Array.isArray(value) ? value : [value];
  const files: Array<CustomFieldFile> = [];
  const seen: Set<string> = new Set<string>();

  for (const entry of entries) {
    if (!isCustomFieldFile(entry)) {
      continue;
    }

    const record: Record<string, unknown> = entry as unknown as Record<
      string,
      unknown
    >;
    const fileId: string = readId(record["fileId"])!;

    if (seen.has(fileId)) {
      continue;
    }

    seen.add(fileId);

    const size: unknown = record["size"];

    files.push({
      fileId: fileId,
      name: (record["name"] as string).trim() || fileId,
      fileType:
        typeof record["fileType"] === "string" ? record["fileType"] : "",
      size:
        typeof size === "number" && Number.isFinite(size) && size >= 0
          ? Math.floor(size)
          : 0,
    });
  }

  return files;
};

export type GetCustomFieldFileIdsFunction = (value: unknown) => Array<string>;

// The ids of the files a stored value holds, in order.
export const getCustomFieldFileIds: GetCustomFieldFileIdsFunction = (
  value: unknown,
): Array<string> => {
  return readCustomFieldFiles(value).map((file: CustomFieldFile): string => {
    return file.fileId;
  });
};

export type FormatCustomFieldFileNamesFunction = (value: unknown) => string;

/**
 * A stored value as people read it outside the dashboard - an email, a chat
 * message, a note, an export: its files' names, joined with commas. "" when
 * it holds none.
 */
export const formatCustomFieldFileNames: FormatCustomFieldFileNamesFunction = (
  value: unknown,
): string => {
  return readCustomFieldFiles(value)
    .map((file: CustomFieldFile): string => {
      return file.name;
    })
    .join(", ");
};

export type FormatCustomFieldFileSizeFunction = (bytes: number) => string;

/*
 * A file's size as people read it: "640 B", "48 KB", "1.5 MB" - as every
 * list of files says it (Types/File/FileSize), the file picker included.
 */
export const formatCustomFieldFileSize: FormatCustomFieldFileSizeFunction = (
  bytes: number,
): string => {
  return formatFileSize(bytes);
};

export type GetCustomFieldValueEntryKeyFunction = (entry: unknown) => string;

/**
 * One value - or one entry of a list - as "the same answer" is decided: a
 * file reference, in any shape a write names one, by its file alone; any
 * other object as its JSON; anything else as its text. So a list of files
 * sent back as the dashboard holds them reads as the list the record holds,
 * and two different lists of files never read as one.
 */
export const getCustomFieldValueEntryKey: GetCustomFieldValueEntryKeyFunction =
  (entry: unknown): string => {
    if (isPlainObject(entry)) {
      const fileId: string | null = readCustomFieldFileReference(entry);

      if (fileId) {
        return `file:${fileId}`;
      }

      try {
        return JSON.stringify(entry);
      } catch {
        return String(entry);
      }
    }

    return String(entry);
  };
