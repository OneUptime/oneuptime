/*
 * Reading the values a Git server's API answers with, the same way for
 * every server: nothing it sends is trusted to be the type its docs say.
 * Loops and indexOf only - no pattern reads what a server sent.
 */

// A full or abbreviated commit SHA: 7 to 64 hexadecimal characters.
const MIN_SHA_LENGTH: number = 7;
const MAX_SHA_LENGTH: number = 64;

export default class CodeHostText {
  public static readString(raw: unknown): string {
    return typeof raw === "string" ? raw : "";
  }

  // An id the server sends as a number or a text, as a text ("" for none).
  public static readId(raw: unknown): string {
    if (typeof raw === "number" && Number.isSafeInteger(raw)) {
      return raw.toString();
    }

    return typeof raw === "string" ? raw : "";
  }

  public static isCommitSha(value: string | null | undefined): boolean {
    if (
      !value ||
      value.length < MIN_SHA_LENGTH ||
      value.length > MAX_SHA_LENGTH
    ) {
      return false;
    }

    for (let index: number = 0; index < value.length; index++) {
      const code: number = value.charCodeAt(index);
      const isDigit: boolean = code >= 48 && code <= 57;
      const isHexLetter: boolean =
        (code >= 97 && code <= 102) || (code >= 65 && code <= 70);

      if (!isDigit && !isHexLetter) {
        return false;
      }
    }

    return true;
  }

  /*
   * A file's base64 contents as text - with the line breaks some servers
   * wrap base64 in taken out - or null for a binary file (a NUL byte), which
   * decodes into nothing a reader can use.
   */
  public static decodeBase64Text(encoded: string): string | null {
    const compact: string = encoded.split("\n").join("").split("\r").join("");

    const content: string = compact
      ? Buffer.from(compact, "base64").toString("utf8")
      : "";

    if (content.includes("\0")) {
      return null;
    }

    return content;
  }

  /*
   * Lines in a text, not counting the empty one after the trailing newline
   * nearly every source file ends with.
   */
  public static countLines(content: string): number {
    if (content === "") {
      return 0;
    }

    const lines: number = content.split("\n").length;

    return content.endsWith("\n") ? lines - 1 : lines;
  }
}
