import { BINARY_SNIFF_BYTES, MAX_TEXT_FILE_BYTES } from "./CodeAgentToolLimits";
import { countOf } from "./CodeAgentToolTypes";
import fs from "fs";

/*
 * A file of the repository read as text for the code agent's tools - or
 * the reason it cannot be: it is a directory, it is binary, it is too large
 * to read into memory, or it is not UTF-8 (an edit would change bytes the
 * model was never shown).
 */
export type TextFileRead =
  | { kind: "Text"; content: string; isUtf8: boolean; sizeInBytes: number }
  | { kind: "Missing" }
  | { kind: "Directory" }
  | { kind: "NotAFile" }
  | { kind: "Binary"; sizeInBytes: number }
  | { kind: "TooLarge"; sizeInBytes: number };

export default class TextFile {
  public static async read(absolutePath: string): Promise<TextFileRead> {
    let stats: fs.Stats;

    try {
      stats = await fs.promises.stat(absolutePath);
    } catch (error) {
      const code: string | undefined = (error as NodeJS.ErrnoException).code;

      if (code === "ENOENT" || code === "ENOTDIR") {
        return { kind: "Missing" };
      }

      throw error;
    }

    if (stats.isDirectory()) {
      return { kind: "Directory" };
    }

    if (!stats.isFile()) {
      return { kind: "NotAFile" };
    }

    if (stats.size > MAX_TEXT_FILE_BYTES) {
      return { kind: "TooLarge", sizeInBytes: stats.size };
    }

    const buffer: Buffer = await fs.promises.readFile(absolutePath);

    if (TextFile.isBinary(buffer)) {
      return { kind: "Binary", sizeInBytes: buffer.length };
    }

    const content: string = buffer.toString("utf8");

    return {
      kind: "Text",
      content,
      // Bytes that are not UTF-8 come back as U+FFFD, and would not round-trip.
      isUtf8:
        !content.includes("\uFFFD") || Buffer.from(content).equals(buffer),
      sizeInBytes: buffer.length,
    };
  }

  // A NUL in the first bytes makes a file binary, as git and grep tell it.
  public static isBinary(buffer: Buffer): boolean {
    return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
  }

  // "3.2 MB", "812 bytes": a size as the model reads it.
  public static describeSize(sizeInBytes: number): string {
    if (sizeInBytes >= 1024 * 1024) {
      return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    if (sizeInBytes >= 1024) {
      return `${(sizeInBytes / 1024).toFixed(1)} KB`;
    }

    return countOf(sizeInBytes, "byte");
  }

  /*
   * Whether a text mostly ends its lines with CRLF (Windows line endings):
   * an edit then writes its new lines the same way.
   */
  public static usesCrlf(content: string): boolean {
    let crlf: number = 0;
    let lf: number = 0;
    let index: number = content.indexOf("\n");

    while (index !== -1) {
      if (index > 0 && content.charCodeAt(index - 1) === 13) {
        crlf++;
      } else {
        lf++;
      }

      index = content.indexOf("\n", index + 1);
    }

    return crlf > lf;
  }
}
