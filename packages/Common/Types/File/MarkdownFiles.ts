import {
  FILE_CONTENT_HEAD_LENGTH,
  isFileContentOfType,
} from "./FileContentCheck";
import MimeType from "./MimeType";

/*
 * THE FILES A RECORD'S MARKDOWN SHOWS, HANDED TO A WORKFLOW OR AN API KEY
 * (#11256).
 *
 * An image pasted into the Markdown editor - an incident's description, a
 * Markdown custom field, a note - is a File of the record's project, private
 * from its upload on, and the Markdown carries it by its address:
 *
 *     ![screenshot.png](https://oneuptime.example/file/image/access-token/<token>)
 *
 * That address opens the image only for a person signed in to the project
 * (FileViewerAccess): a browser drawing the page. A workflow has no session,
 * and the address does not take an API key, so neither could read the image
 * to put it in an email.
 *
 * Opening the address to API keys and workflows would let any of them read
 * any private image of its project whose address it learnt, whatever records
 * it may read. So the files are handed out through the record instead: the
 * caller names a record, the record is read as the caller - every table,
 * column, label, private-record and project rule applies - and only the
 * files that the Markdown it may read shows come back
 * (Server/Utils/File/MarkdownFiles):
 *
 *   - GET /api/<record>/:id/markdown-files, with an API key or signed in;
 *   - the Get Files From Markdown workflow step.
 *
 * A file is handed out only when it is a file of the record's own project, a
 * picture that holds what its type says, and within the limits below. The
 * rest of what the Markdown shows is listed as left out, with the reason, and
 * a file nothing the caller may read shows is never named at all.
 *
 * Pure, with no Node or React imports: the server, the workflow builder and
 * the docs read the same limits.
 */

// Where a record's files are read, under the record's own API path.
export const MARKDOWN_FILES_ROUTE: string = "/markdown-files";

// The largest file handed out: what any upload may be.
export const MARKDOWN_FILE_MAX_SIZE_IN_BYTES: number = 10 * 1024 * 1024;

/*
 * The most bytes one read hands out, every file together. A run keeps its
 * steps' values while it runs, and writes them to its record while it waits;
 * the steps after this one write what they are handed to the run's log; and
 * Microsoft Graph takes a message of 4 MB at most, SMTP servers commonly 10
 * to 25 MB.
 */
export const MARKDOWN_FILES_MAX_TOTAL_SIZE_IN_BYTES: number = 10 * 1024 * 1024;

// The most files one read hands out.
export const MARKDOWN_FILES_MAX_COUNT: number = 20;

/*
 * The most addresses of one record looked up. Markdown can hold any number
 * of them; past this many, the rest are left out unread.
 */
export const MARKDOWN_FILES_MAX_REFERENCES: number = 100;

/*
 * The kinds of file handed out: raster pictures, which hold no script and
 * which an email shows inline. Not SVG: it is a document that can carry
 * script, not a picture (Response.SAFE_IMAGE_MIME_TYPES). Each is checked by
 * what it holds as well as by its type (FileContentCheck), so a page stored
 * as image/png is left out.
 */
export const MARKDOWN_FILE_TYPES: ReadonlyArray<MimeType> = [
  MimeType.png,
  MimeType.jpeg,
  MimeType.gif,
  MimeType.webp,
  MimeType.bmp,
  MimeType.tiff,
  MimeType.avif,
  MimeType.heic,
  MimeType.ico,
];

/*
 * Other names a picture's type was stored under before uploads were held to
 * MimeType (Response.SAFE_IMAGE_MIME_TYPES keeps them servable), read as the
 * type they are.
 */
const MIME_TYPE_ALIASES: Readonly<Record<string, MimeType>> = {
  "image/jpg": MimeType.jpeg,
  "image/pjpeg": MimeType.jpeg,
  "image/vnd.microsoft.icon": MimeType.ico,
  "image/x-ms-bmp": MimeType.bmp,
};

// How much of a file is read to check what it holds.
export const MARKDOWN_FILE_HEAD_LENGTH: number = FILE_CONTENT_HEAD_LENGTH;

// Why a file the Markdown shows was not handed out.
export enum MarkdownFileLeftOutReason {
  // No file of the record's project has this address.
  NotFound = "NotFound",
  // Not a raster picture (an SVG, a PDF), or not what its type says.
  NotAPicture = "NotAPicture",
  // Larger than MARKDOWN_FILE_MAX_SIZE_IN_BYTES.
  TooLarge = "TooLarge",
  // It would take the read past MARKDOWN_FILES_MAX_TOTAL_SIZE_IN_BYTES.
  OverTotalSize = "OverTotalSize",
  // The read already holds MARKDOWN_FILES_MAX_COUNT files.
  TooMany = "TooMany",
}

// One file a record's Markdown shows, handed out.
export interface MarkdownFile {
  // As it was uploaded: "screenshot.png".
  name: string;
  // Its type, as one of MARKDOWN_FILE_TYPES: "image/png".
  mimeType: string;
  sizeInBytes: number;
  // Its bytes, in base64: an email attachment's content as most APIs take it.
  base64: string;
  /*
   * An id for the file in an email that shows it inline: the HTML says
   * `<img src="cid:<contentId>">`, and the attachment carries the same id.
   * The same for the same file whichever record or step hands it out.
   */
  contentId: string;
  // Every address the record's Markdown shows it by, as written there.
  urls: Array<string>;
  // The fields that show it: a column ("description") or a custom field's name.
  fields: Array<string>;
}

// One file a record's Markdown shows that was not handed out.
export interface MarkdownFileLeftOut {
  // As it was uploaded; null when no file of the project has the address.
  name: string | null;
  urls: Array<string>;
  fields: Array<string>;
  reason: MarkdownFileLeftOutReason;
  // Why, in words.
  message: string;
}

// What a read of a record's files answers.
export interface MarkdownFilesResult {
  files: Array<MarkdownFile>;
  leftOut: Array<MarkdownFileLeftOut>;
}

// Why a file was left out, in words.
export const MARKDOWN_FILE_LEFT_OUT_MESSAGES: Readonly<
  Record<MarkdownFileLeftOutReason, string>
> = {
  [MarkdownFileLeftOutReason.NotFound]:
    "No file of this project has this address. It may have been deleted, or copied from another project.",
  [MarkdownFileLeftOutReason.NotAPicture]:
    "Only pictures such as PNG, JPEG, GIF and WebP are handed out. An SVG can carry script, so it is left out.",
  [MarkdownFileLeftOutReason.TooLarge]: `It is larger than ${MARKDOWN_FILE_MAX_SIZE_IN_BYTES / (1024 * 1024)} MB, the most one file may be.`,
  [MarkdownFileLeftOutReason.OverTotalSize]: `With the files before it, it would come to more than ${MARKDOWN_FILES_MAX_TOTAL_SIZE_IN_BYTES / (1024 * 1024)} MB, the most one read hands out.`,
  [MarkdownFileLeftOutReason.TooMany]: `The record shows more than ${MARKDOWN_FILES_MAX_COUNT} files. Only the first ${MARKDOWN_FILES_MAX_COUNT} pictures are handed out.`,
};

// One image address in a piece of Markdown.
export interface MarkdownImageReference {
  // The token that addresses the file.
  token: string;
  // The address as written: absolute ("https://.../file/image/access-token/<token>") or not.
  url: string;
}

/*
 * An inline image's address, as the editor writes it - the installation's
 * address, then /file/image/access-token/<token> - or as a path alone. The
 * address before the path is everything back to a quote, a bracket or a
 * space: an installation served under a path of its own is read whole.
 */
const IMAGE_ADDRESS_REGEX: RegExp =
  /(?:https?:\/\/[^\s"'<>()[\]]*?)?\/file\/image\/access-token\/([a-fA-F0-9]+)/g;

export type ReadMarkdownImageReferencesFunction = (
  markdown: unknown,
) => Array<MarkdownImageReference>;

/*
 * Every image address a piece of Markdown holds, in the order written, each
 * once: the same address twice is one reference, the same file by two
 * addresses is two.
 */
export const readMarkdownImageReferences: ReadMarkdownImageReferencesFunction =
  (markdown: unknown): Array<MarkdownImageReference> => {
    if (typeof markdown !== "string" || !markdown) {
      return [];
    }

    const references: Array<MarkdownImageReference> = [];
    const seen: Set<string> = new Set<string>();

    for (const match of markdown.matchAll(IMAGE_ADDRESS_REGEX)) {
      const url: string = match[0];
      const token: string | undefined = match[1];

      if (!token || seen.has(url)) {
        continue;
      }

      seen.add(url);
      references.push({ token: token, url: url });
    }

    return references;
  };

// One field of a record and the Markdown it holds.
export interface MarkdownSource {
  // A column ("description") or a custom field's name.
  field: string;
  markdown: unknown;
}

// A file a record's Markdown shows, before it is looked up.
export interface MarkdownFileReference {
  token: string;
  urls: Array<string>;
  fields: Array<string>;
}

export type CollectMarkdownFileReferencesFunction = (
  sources: Array<MarkdownSource>,
) => Array<MarkdownFileReference>;

/*
 * The files the record's fields show, each once, in the order the fields
 * show them: a file in two fields, or by two addresses, is one reference
 * naming both.
 */
export const collectMarkdownFileReferences: CollectMarkdownFileReferencesFunction =
  (sources: Array<MarkdownSource>): Array<MarkdownFileReference> => {
    const byToken: Map<string, MarkdownFileReference> = new Map();

    for (const source of sources) {
      for (const reference of readMarkdownImageReferences(source.markdown)) {
        // Matched exactly, as the image route matches it.
        let found: MarkdownFileReference | undefined = byToken.get(
          reference.token,
        );

        if (!found) {
          found = { token: reference.token, urls: [], fields: [] };
          byToken.set(reference.token, found);
        }

        if (!found.urls.includes(reference.url)) {
          found.urls.push(reference.url);
        }

        if (!found.fields.includes(source.field)) {
          found.fields.push(source.field);
        }
      }
    }

    return Array.from(byToken.values());
  };

export type GetMarkdownFileTypeFunction = (
  fileType: string | null | undefined,
) => MimeType | null;

/*
 * The type a file is handed out as - one of MARKDOWN_FILE_TYPES, an older
 * name for one read as it - or null for a type that is never handed out.
 */
export const getMarkdownFileType: GetMarkdownFileTypeFunction = (
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
    MARKDOWN_FILE_TYPES.find((type: MimeType): boolean => {
      return type === canonical;
    }) || null
  );
};

// A file as deciding whether to hand it out reads it: never all its bytes.
export interface MarkdownFileFacts {
  name: string;
  fileType: string;
  sizeInBytes: number;
  // Its first MARKDOWN_FILE_HEAD_LENGTH bytes, or all of them.
  head: Uint8Array;
}

// Where a read stands: what it has handed out so far.
export interface MarkdownFilesTally {
  count: number;
  totalSizeInBytes: number;
}

export type GetMarkdownFileLeftOutReasonFunction = (data: {
  file: MarkdownFileFacts;
  tally: MarkdownFilesTally;
}) => MarkdownFileLeftOutReason | null;

/*
 * Why a file of the record's project is not handed out, or null when it is:
 * a picture of a type handed out that holds what its type says, no larger
 * than one file may be, while the read holds fewer files than it may and
 * this one keeps it within its total.
 */
export const getMarkdownFileLeftOutReason: GetMarkdownFileLeftOutReasonFunction =
  (data: {
    file: MarkdownFileFacts;
    tally: MarkdownFilesTally;
  }): MarkdownFileLeftOutReason | null => {
    const type: MimeType | null = getMarkdownFileType(data.file.fileType);

    if (
      !type ||
      !isFileContentOfType({
        fileType: type,
        head: data.file.head,
        size: data.file.sizeInBytes,
      })
    ) {
      return MarkdownFileLeftOutReason.NotAPicture;
    }

    if (data.file.sizeInBytes > MARKDOWN_FILE_MAX_SIZE_IN_BYTES) {
      return MarkdownFileLeftOutReason.TooLarge;
    }

    if (data.tally.count >= MARKDOWN_FILES_MAX_COUNT) {
      return MarkdownFileLeftOutReason.TooMany;
    }

    if (
      data.tally.totalSizeInBytes + data.file.sizeInBytes >
      MARKDOWN_FILES_MAX_TOTAL_SIZE_IN_BYTES
    ) {
      return MarkdownFileLeftOutReason.OverTotalSize;
    }

    return null;
  };
