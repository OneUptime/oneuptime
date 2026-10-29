import { CodeHostChangedFile, CodeHostChangedFiles } from "./CodeHostTypes";

/*
 * A GIT DIFF, FILE BY FILE.
 *
 * Forgejo and Gitea give a pull request's diff as one text - what `git diff`
 * prints (/pulls/{index}.diff) - where GitHub and GitLab give it file by
 * file. A production review reads it file by file, in the shape GitHub's
 * pull request files have: each file's name (and the name it had before a
 * rename), what happened to it, how many lines it adds and removes, and its
 * hunks from the first "@@" on, as GitHub's `patch` holds them. A binary
 * file has no hunks: its patch is null.
 *
 * The text is the server's, and holds whatever the pull request's author
 * wrote, so it is read in one pass, line by line, with startsWith and
 * indexOf only - no pattern - and in time in line with its length.
 */

const DIFF_HEADER: string = "diff --git ";
const HUNK_START: string = "@@";
const OLD_FILE: string = "--- ";
const NEW_FILE: string = "+++ ";
const NO_FILE: string = "/dev/null";
const RENAME_FROM: string = "rename from ";
const RENAME_TO: string = "rename to ";
const NEW_FILE_MODE: string = "new file mode";
const DELETED_FILE_MODE: string = "deleted file mode";
const BINARY_FILES: string = "Binary files ";

interface FileBuilder {
  headerLine: string;
  oldPath: string | null;
  newPath: string | null;
  renameFrom: string | null;
  renameTo: string | null;
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
  hunkLines: Array<string>;
  isInHunks: boolean;
  additions: number;
  deletions: number;
}

function newBuilder(headerLine: string): FileBuilder {
  return {
    headerLine,
    oldPath: null,
    newPath: null,
    renameFrom: null,
    renameTo: null,
    isNew: false,
    isDeleted: false,
    isBinary: false,
    hunkLines: [],
    isInHunks: false,
    additions: 0,
    deletions: 0,
  };
}

export default class UnifiedDiff {
  /*
   * The files of a git diff, in its order: at most `maxFiles` of them, and
   * whether it holds more.
   */
  public static splitFiles(
    diff: string,
    maxFiles: number,
  ): CodeHostChangedFiles {
    const files: Array<CodeHostChangedFile> = [];
    const limit: number = Math.max(0, Math.floor(maxFiles));
    let current: FileBuilder | null = null;
    let hasMore: boolean = false;

    const close: () => void = (): void => {
      if (!current) {
        return;
      }

      const file: CodeHostChangedFile | null = UnifiedDiff.toFile(current);
      current = null;

      if (!file) {
        return;
      }

      if (files.length >= limit) {
        hasMore = true;
        return;
      }

      files.push(file);
    };

    for (const rawLine of (diff || "").split("\n")) {
      // A diff written on Windows ends its lines with \r\n.
      const line: string = rawLine.endsWith("\r")
        ? rawLine.substring(0, rawLine.length - 1)
        : rawLine;

      if (line.startsWith(DIFF_HEADER)) {
        close();

        if (files.length >= limit) {
          // One more file starts: there are more than were asked for.
          hasMore = true;
          break;
        }

        current = newBuilder(line.substring(DIFF_HEADER.length));
        continue;
      }

      const file: FileBuilder | null = current;

      if (!file) {
        // Text before the first file: a commit message, a mail header.
        continue;
      }

      if (file.isInHunks) {
        file.hunkLines.push(line);

        if (line.startsWith("+")) {
          file.additions++;
        } else if (line.startsWith("-")) {
          file.deletions++;
        }

        continue;
      }

      if (line.startsWith(HUNK_START)) {
        file.isInHunks = true;
        file.hunkLines.push(line);
        continue;
      }

      UnifiedDiff.readHeaderLine(file, line);
    }

    close();

    return { files, hasMore };
  }

  /*
   * A path as git writes it in a header: "a/src/x.ts", or quoted when it
   * holds a character git escapes ("\"a/caf\\303\\251.ts\""). The prefix
   * ("a/" or "b/") is dropped. Null for /dev/null and for nothing.
   */
  public static readHeaderPath(value: string): string | null {
    let path: string = value.trim();

    if (!path || path === NO_FILE) {
      return null;
    }

    if (path.startsWith('"') && path.endsWith('"') && path.length >= 2) {
      path = UnifiedDiff.unquote(path.substring(1, path.length - 1));
    }

    // A tab may follow the path, then a time (diff's own format).
    const tab: number = path.indexOf("\t");

    if (tab >= 0) {
      path = path.substring(0, tab);
    }

    if (path.startsWith("a/") || path.startsWith("b/")) {
      path = path.substring(2);
    }

    return path || null;
  }

  /*
   * Git's C-style quoting undone: \\, \", \t, \n, and octal byte escapes
   * (\303\251), read back as UTF-8. One pass.
   */
  public static unquote(value: string): string {
    const bytes: Array<number> = [];
    let index: number = 0;

    const pushText: (text: string) => void = (text: string): void => {
      for (const byte of Buffer.from(text, "utf8")) {
        bytes.push(byte);
      }
    };

    while (index < value.length) {
      const character: string = value.charAt(index);

      if (character !== "\\" || index === value.length - 1) {
        pushText(character);
        index++;
        continue;
      }

      const next: string = value.charAt(index + 1);
      const octal: string = value.substring(index + 1, index + 4);

      if (
        octal.length === 3 &&
        UnifiedDiff.isOctalDigit(octal.charAt(0)) &&
        UnifiedDiff.isOctalDigit(octal.charAt(1)) &&
        UnifiedDiff.isOctalDigit(octal.charAt(2))
      ) {
        bytes.push(parseInt(octal, 8) & 0xff);
        index += 4;
        continue;
      }

      pushText(
        next === "t"
          ? "\t"
          : next === "n"
            ? "\n"
            : next === "r"
              ? "\r"
              : next === "a"
                ? "\u0007"
                : next === "b"
                  ? "\b"
                  : next === "f"
                    ? "\f"
                    : next === "v"
                      ? "\v"
                      : next,
      );
      index += 2;
    }

    return Buffer.from(bytes).toString("utf8");
  }

  private static isOctalDigit(character: string): boolean {
    return character >= "0" && character <= "7";
  }

  private static readHeaderLine(file: FileBuilder, line: string): void {
    if (line.startsWith(OLD_FILE)) {
      file.oldPath = UnifiedDiff.readHeaderPath(
        line.substring(OLD_FILE.length),
      );
      if (line.substring(OLD_FILE.length).trim() === NO_FILE) {
        file.isNew = true;
      }
      return;
    }

    if (line.startsWith(NEW_FILE)) {
      file.newPath = UnifiedDiff.readHeaderPath(
        line.substring(NEW_FILE.length),
      );
      if (line.substring(NEW_FILE.length).trim() === NO_FILE) {
        file.isDeleted = true;
      }
      return;
    }

    if (line.startsWith(RENAME_FROM)) {
      file.renameFrom = UnifiedDiff.readRenamePath(
        line.substring(RENAME_FROM.length),
      );
      return;
    }

    if (line.startsWith(RENAME_TO)) {
      file.renameTo = UnifiedDiff.readRenamePath(
        line.substring(RENAME_TO.length),
      );
      return;
    }

    if (line.startsWith(NEW_FILE_MODE)) {
      file.isNew = true;
      return;
    }

    if (line.startsWith(DELETED_FILE_MODE)) {
      file.isDeleted = true;
      return;
    }

    if (line.startsWith(BINARY_FILES) || line === "GIT binary patch") {
      file.isBinary = true;
    }
  }

  // A rename line's path: as written, unquoted, never with a/ or b/.
  private static readRenamePath(value: string): string | null {
    let path: string = value.trim();

    if (path.startsWith('"') && path.endsWith('"') && path.length >= 2) {
      path = UnifiedDiff.unquote(path.substring(1, path.length - 1));
    }

    return path || null;
  }

  /*
   * The paths a header line names when nothing else does - a file whose
   * mode alone changed, a binary one: "a/x b/x". Read from the end, so a
   * space inside a path only matters when both paths hold " b/".
   */
  private static readGitHeaderPaths(header: string): {
    oldPath: string | null;
    newPath: string | null;
  } {
    const text: string = header.trim();

    if (text.startsWith('"')) {
      const close: number = text.indexOf('" ', 1);

      if (close > 0) {
        return {
          oldPath: UnifiedDiff.readHeaderPath(text.substring(0, close + 1)),
          newPath: UnifiedDiff.readHeaderPath(text.substring(close + 2)),
        };
      }
    }

    const split: number = text.lastIndexOf(" b/");

    if (split <= 0) {
      return { oldPath: null, newPath: null };
    }

    return {
      oldPath: UnifiedDiff.readHeaderPath(text.substring(0, split)),
      newPath: UnifiedDiff.readHeaderPath(text.substring(split + 1)),
    };
  }

  private static toFile(file: FileBuilder): CodeHostChangedFile | null {
    const fromHeader: { oldPath: string | null; newPath: string | null } =
      file.newPath || file.oldPath || file.renameTo
        ? { oldPath: null, newPath: null }
        : UnifiedDiff.readGitHeaderPaths(file.headerLine);

    const newPath: string | null =
      file.newPath || file.renameTo || fromHeader.newPath;
    const oldPath: string | null =
      file.oldPath || file.renameFrom || fromHeader.oldPath;

    const filename: string | null = file.isDeleted
      ? oldPath || newPath
      : newPath || oldPath;

    if (!filename) {
      return null;
    }

    const isRenamed: boolean = Boolean(
      !file.isNew &&
        !file.isDeleted &&
        oldPath &&
        newPath &&
        oldPath !== newPath,
    );

    // A last empty line is the end of the text, not a line of the hunk.
    while (
      file.hunkLines.length > 0 &&
      file.hunkLines[file.hunkLines.length - 1] === ""
    ) {
      file.hunkLines.pop();
    }

    return {
      filename,
      previousFilename: isRenamed ? oldPath : null,
      status: file.isNew
        ? "added"
        : file.isDeleted
          ? "removed"
          : isRenamed
            ? "renamed"
            : "modified",
      additions: file.additions,
      deletions: file.deletions,
      patch:
        file.isBinary || file.hunkLines.length === 0
          ? null
          : file.hunkLines.join("\n"),
    };
  }
}
