import MimeType from "./MimeType";

/*
 * A FILE'S TYPE AS PEOPLE READ IT: "PDF", "DOCX", "PNG".
 *
 * A browser reports a file's type as its MIME type, and the one a Word
 * document has - application/vnd.openxmlformats-officedocument.
 * wordprocessingml.document - is a word of 71 letters with nowhere to break,
 * which runs off a phone's screen. The label is the MimeType key the type is
 * listed under, in capitals (the first one, where two keys share a type:
 * image/jpeg is "JPG"); for a type MimeType does not list, the part after
 * the slash, in capitals; "" for no type at all.
 *
 * Pure, with no React imports: the file picker and the tests read it alike.
 */

const KEYS: ReadonlyArray<string> = Object.keys(MimeType);
const VALUES: ReadonlyArray<string> = Object.values(MimeType);

export type GetMimeTypeLabelFunction = (fileType: unknown) => string;

export const getMimeTypeLabel: GetMimeTypeLabelFunction = (
  fileType: unknown,
): string => {
  if (typeof fileType !== "string") {
    return "";
  }

  const type: string = fileType.trim().toLowerCase();

  if (!type) {
    return "";
  }

  const index: number = VALUES.indexOf(type);

  if (index !== -1) {
    return (KEYS[index] || "").toUpperCase();
  }

  const slash: number = type.indexOf("/");

  return (slash === -1 ? type : type.slice(slash + 1)).toUpperCase();
};

export default getMimeTypeLabel;
