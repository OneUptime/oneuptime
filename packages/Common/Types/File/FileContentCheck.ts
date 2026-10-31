import MimeType from "./MimeType";

/*
 * WHETHER A FILE HOLDS WHAT ITS TYPE SAYS.
 *
 * A file's type is whatever its uploader said it is (File.fileType), and a
 * browser goes by the name's extension: a web page renamed to report.pdf is
 * uploaded as application/pdf. So where a file is kept for others to open -
 * a file custom field, a form's file question - its first bytes are read as
 * well: every kind of file below begins with a signature of its own, and a
 * text file is text.
 *
 * Only the start of the file is read (FILE_CONTENT_HEAD_LENGTH), never the
 * whole of it, and in a single pass. A type with no rule here is refused:
 * nothing is taken on its name alone.
 *
 * This is not what makes serving a file safe - every download goes out as
 * an attachment, with nosniff and a sandbox (Response.sendFileResponse) -
 * but it keeps a stranger's page or program from being stored as a picture
 * or a document for someone to open.
 *
 * Pure, with no Node or React imports: the server checks what it stores,
 * and the public form page can tell a submitter before anything is sent.
 */

// How much of a file is read to check it.
export const FILE_CONTENT_HEAD_LENGTH: number = 8192;

type StartsWithFunction = (
  head: Uint8Array,
  signature: Array<number>,
  offset?: number,
) => boolean;

const startsWith: StartsWithFunction = (
  head: Uint8Array,
  signature: Array<number>,
  offset: number = 0,
): boolean => {
  if (head.length < offset + signature.length) {
    return false;
  }

  for (let index: number = 0; index < signature.length; index++) {
    if (head[offset + index] !== signature[index]) {
      return false;
    }
  }

  return true;
};

type AsciiFunction = (text: string) => Array<number>;

const ascii: AsciiFunction = (text: string): Array<number> => {
  const bytes: Array<number> = [];

  for (let index: number = 0; index < text.length; index++) {
    bytes.push(text.charCodeAt(index));
  }

  return bytes;
};

type ReadAsciiFunction = (
  head: Uint8Array,
  offset: number,
  length: number,
) => string;

const readAscii: ReadAsciiFunction = (
  head: Uint8Array,
  offset: number,
  length: number,
): string => {
  let text: string = "";

  for (
    let index: number = offset;
    index < offset + length && index < head.length;
    index++
  ) {
    text += String.fromCharCode(head[index]!);
  }

  return text;
};

const PNG_SIGNATURE: Array<number> = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
];

const JPEG_SIGNATURE: Array<number> = [0xff, 0xd8, 0xff];

// An OLE compound file: Word, Excel and PowerPoint before 2007.
const OLE_SIGNATURE: Array<number> = [
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
];

/*
 * A ZIP archive: a local file header, or the end of an empty archive. Every
 * Office Open XML and OpenDocument file is one.
 */
const ZIP_SIGNATURES: Array<Array<number>> = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
];

// libpcap, both byte orders, microsecond and nanosecond; and pcapng.
const PCAP_SIGNATURES: Array<Array<number>> = [
  [0xa1, 0xb2, 0xc3, 0xd4],
  [0xd4, 0xc3, 0xb2, 0xa1],
  [0xa1, 0xb2, 0x3c, 0x4d],
  [0x4d, 0x3c, 0xb2, 0xa1],
  [0x0a, 0x0d, 0x0d, 0x0a],
];

// The ISO base media brands of an AVIF image, and of a HEIC/HEIF one.
const AVIF_BRANDS: ReadonlyArray<string> = ["avif", "avis", "mif1", "msf1"];

const HEIC_BRANDS: ReadonlyArray<string> = [
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
];

type IsHeifFunction = (
  head: Uint8Array,
  brands: ReadonlyArray<string>,
) => boolean;

// A HEIF container: an "ftyp" box first, with one of these major brands.
const isHeif: IsHeifFunction = (
  head: Uint8Array,
  brands: ReadonlyArray<string>,
): boolean => {
  return (
    readAscii(head, 4, 4) === "ftyp" && brands.includes(readAscii(head, 8, 4))
  );
};

const PDF_MARKER: Array<number> = ascii("%PDF-");

// Readers find a PDF's header anywhere in its first kilobyte.
const PDF_HEADER_WINDOW: number = 1024;

type HasPdfHeaderFunction = (head: Uint8Array) => boolean;

const hasPdfHeader: HasPdfHeaderFunction = (head: Uint8Array): boolean => {
  const last: number =
    Math.min(head.length, PDF_HEADER_WINDOW) - PDF_MARKER.length;

  for (let offset: number = 0; offset <= last; offset++) {
    if (startsWith(head, PDF_MARKER, offset)) {
      return true;
    }
  }

  return false;
};

type IsUtf8TextFunction = (head: Uint8Array, isWholeFile: boolean) => boolean;

/*
 * Whether the bytes read are text: UTF-8 (ASCII included) with no NUL and no
 * control character but tab, line breaks, form feed and escape. A character
 * cut off by the end of what was read counts, unless the file ends there.
 */
const isUtf8Text: IsUtf8TextFunction = (
  head: Uint8Array,
  isWholeFile: boolean,
): boolean => {
  let index: number = 0;

  // A byte order mark.
  if (startsWith(head, [0xef, 0xbb, 0xbf])) {
    index = 3;
  }

  while (index < head.length) {
    const byte: number = head[index]!;

    if (byte < 0x80) {
      if (
        byte < 0x20 &&
        byte !== 0x09 &&
        byte !== 0x0a &&
        byte !== 0x0d &&
        byte !== 0x0c &&
        byte !== 0x1b
      ) {
        return false;
      }

      if (byte === 0x7f) {
        return false;
      }

      index++;
      continue;
    }

    let continuationBytes: number = 0;

    if (byte >= 0xc2 && byte <= 0xdf) {
      continuationBytes = 1;
    } else if (byte >= 0xe0 && byte <= 0xef) {
      continuationBytes = 2;
    } else if (byte >= 0xf0 && byte <= 0xf4) {
      continuationBytes = 3;
    } else {
      return false;
    }

    if (index + continuationBytes >= head.length) {
      // Cut off by the end of what was read.
      return !isWholeFile;
    }

    for (let next: number = 1; next <= continuationBytes; next++) {
      const continuation: number = head[index + next]!;

      if (continuation < 0x80 || continuation > 0xbf) {
        return false;
      }
    }

    index += continuationBytes + 1;
  }

  return true;
};

type IsUtf16TextFunction = (head: Uint8Array) => boolean;

/*
 * Text saved as UTF-16 with its byte order mark - how spreadsheet programs
 * often save a CSV - with no NUL character in it.
 */
const isUtf16Text: IsUtf16TextFunction = (head: Uint8Array): boolean => {
  const isLittleEndian: boolean = startsWith(head, [0xff, 0xfe]);
  const isBigEndian: boolean = startsWith(head, [0xfe, 0xff]);

  if (!isLittleEndian && !isBigEndian) {
    return false;
  }

  for (let index: number = 2; index + 1 < head.length; index += 2) {
    const unit: number = isLittleEndian
      ? head[index]! | (head[index + 1]! << 8)
      : (head[index]! << 8) | head[index + 1]!;

    if (unit === 0) {
      return false;
    }
  }

  return true;
};

type IsTextFunction = (head: Uint8Array, isWholeFile: boolean) => boolean;

const isText: IsTextFunction = (
  head: Uint8Array,
  isWholeFile: boolean,
): boolean => {
  return isUtf16Text(head) || isUtf8Text(head, isWholeFile);
};

type IsJsonTextFunction = (head: Uint8Array, isWholeFile: boolean) => boolean;

// Text whose first character, past white space, opens an object or a list.
const isJsonText: IsJsonTextFunction = (
  head: Uint8Array,
  isWholeFile: boolean,
): boolean => {
  if (!isUtf8Text(head, isWholeFile)) {
    return false;
  }

  let index: number = startsWith(head, [0xef, 0xbb, 0xbf]) ? 3 : 0;

  while (
    index < head.length &&
    (head[index] === 0x20 ||
      head[index] === 0x09 ||
      head[index] === 0x0a ||
      head[index] === 0x0d)
  ) {
    index++;
  }

  return head[index] === 0x7b || head[index] === 0x5b;
};

type ContentRuleFunction = (head: Uint8Array, isWholeFile: boolean) => boolean;

const isZip: ContentRuleFunction = (head: Uint8Array): boolean => {
  return ZIP_SIGNATURES.some((signature: Array<number>): boolean => {
    return startsWith(head, signature);
  });
};

const isOle: ContentRuleFunction = (head: Uint8Array): boolean => {
  return startsWith(head, OLE_SIGNATURE);
};

/*
 * What each type's file begins with. A type that is not here has no way to
 * be checked, so a file of it is refused.
 */
const CONTENT_RULES: Partial<Record<string, ContentRuleFunction>> = {
  [MimeType.png]: (head: Uint8Array): boolean => {
    return startsWith(head, PNG_SIGNATURE);
  },
  [MimeType.jpeg]: (head: Uint8Array): boolean => {
    return startsWith(head, JPEG_SIGNATURE);
  },
  [MimeType.gif]: (head: Uint8Array): boolean => {
    return (
      startsWith(head, ascii("GIF87a")) || startsWith(head, ascii("GIF89a"))
    );
  },
  [MimeType.webp]: (head: Uint8Array): boolean => {
    return startsWith(head, ascii("RIFF")) && readAscii(head, 8, 4) === "WEBP";
  },
  [MimeType.bmp]: (head: Uint8Array): boolean => {
    return startsWith(head, ascii("BM"));
  },
  [MimeType.tiff]: (head: Uint8Array): boolean => {
    return (
      startsWith(head, [0x49, 0x49, 0x2a, 0x00]) ||
      startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])
    );
  },
  [MimeType.avif]: (head: Uint8Array): boolean => {
    return isHeif(head, AVIF_BRANDS);
  },
  [MimeType.heic]: (head: Uint8Array): boolean => {
    return isHeif(head, HEIC_BRANDS);
  },
  [MimeType.ico]: (head: Uint8Array): boolean => {
    return startsWith(head, [0x00, 0x00, 0x01, 0x00]);
  },
  [MimeType.pdf]: hasPdfHeader,
  [MimeType.rtf]: (head: Uint8Array): boolean => {
    return startsWith(head, ascii("{\\rtf"));
  },
  [MimeType.doc]: isOle,
  [MimeType.xls]: isOle,
  [MimeType.ppt]: isOle,
  [MimeType.docx]: isZip,
  [MimeType.xlsx]: isZip,
  [MimeType.pptx]: isZip,
  [MimeType.odt]: isZip,
  [MimeType.ods]: isZip,
  [MimeType.odp]: isZip,
  [MimeType.zip]: isZip,
  [MimeType.pcap]: (head: Uint8Array): boolean => {
    return PCAP_SIGNATURES.some((signature: Array<number>): boolean => {
      return startsWith(head, signature);
    });
  },
  [MimeType.txt]: isText,
  [MimeType.md]: isText,
  [MimeType.csv]: isText,
  [MimeType.json]: isJsonText,
};

export type IsFileContentOfTypeFunction = (data: {
  // The type the file was uploaded as.
  fileType: string | null | undefined;
  // Its first bytes: at least FILE_CONTENT_HEAD_LENGTH of them, or all.
  head: Uint8Array;
  // How many bytes the whole file holds.
  size: number;
}) => boolean;

/**
 * Whether a file holds what its type says, judged by its first bytes. An
 * empty file holds nothing of any type, and a type with no rule is refused.
 */
export const isFileContentOfType: IsFileContentOfTypeFunction = (data: {
  fileType: string | null | undefined;
  head: Uint8Array;
  size: number;
}): boolean => {
  const fileType: string = (data.fileType || "").trim().toLowerCase();
  const rule: ContentRuleFunction | undefined = CONTENT_RULES[fileType];

  if (!rule || data.size <= 0 || data.head.length === 0) {
    return false;
  }

  const head: Uint8Array =
    data.head.length > FILE_CONTENT_HEAD_LENGTH
      ? data.head.subarray(0, FILE_CONTENT_HEAD_LENGTH)
      : data.head;

  return rule(head, head.length >= data.size);
};

export type HasFileContentRuleFunction = (fileType: unknown) => boolean;

// Whether files of this type can be checked by what they hold.
export const hasFileContentRule: HasFileContentRuleFunction = (
  fileType: unknown,
): boolean => {
  return (
    typeof fileType === "string" &&
    Boolean(CONTENT_RULES[fileType.trim().toLowerCase()])
  );
};
