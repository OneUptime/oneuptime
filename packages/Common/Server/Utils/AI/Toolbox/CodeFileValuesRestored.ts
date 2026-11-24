import ToolResultSerializer, { REDACTION_PLACEHOLDERS } from "./Serializer";
import {
  formatCodeLinesWithNumbers,
  getCodeLinePrefixLength,
  splitCodeFileLines,
} from "./CodeFileLines";
import { AIChatLineRange } from "../../../../Types/AI/AIChatRecordSeen";
import {
  CodeFilePlaceholderWritten,
  findCodePlaceholdersWritten,
  holdsCodePlaceholder,
} from "../../../../Types/CodeRepository/CodeFileValuesHidden";

/*
 * HIDDEN VALUES WRITTEN BACK AS THE FILE HAS THEM (issue #6388).
 *
 * read_code_file shows what looks like a secret or personal data as a
 * placeholder ("[redacted-ip]"), and a commit writes a file whole, from what
 * the model was shown. So the model's version of a file holds a
 * placeholder on every such line it kept as it read it - an interface's
 * "password: [redacted];", a git URL's "[redacted-email]:org/repo.git", a
 * lockfile's checksums - and committed as written, it would put them where
 * the values are. #6364 held such a change back, so Ask AI could not change
 * many ordinary files at all.
 *
 * So OneUptime writes the value back itself, where it can tell which it
 * was: a line of the model's version that holds a placeholder, and reads
 * exactly as read_code_file shows one line of the file - or one run of
 * lines, a private key block it shows as one placeholder - is written as
 * the file has it. Only then:
 *   - from the file the commit writes, as the branch it is held to has it:
 *     never another file's lines (the caller reads that version, and checks
 *     its blob, CodeWriteTools);
 *   - when exactly one text of the file reads that way: two lines with
 *     different values that show the same - host = "[redacted-ip]" twice -
 *     are both kept as the model wrote them, and the card says so;
 *   - when the line reads as shown, exactly: a line the model changed keeps
 *     its placeholder, so a value is never kept, stale, beside a change it
 *     may no longer belong to; and a line the file shows only together with
 *     the line before or after it (a value read across their break) is
 *     kept as written too.
 * Every other line stays exactly as the model wrote it, and a placeholder
 * left is counted against the file as before (findCodePlaceholdersWritten):
 * the card names the file, and Auto-run does not make the change.
 *
 * Pure. What comes back is the version to commit, which only the commit of
 * that same file is given - never the change's arguments, the action's
 * record, the conversation or a log - and, of what it still writes in
 * place of hidden values, counts and lines only.
 */

// A line as read_code_file shows it, without the "\r" a Windows line ends with.
const withoutCarriageReturn: (line: string) => string = (
  line: string,
): string => {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
};

/*
 * Each line read_code_file shows of the file with a placeholder in it - a
 * value hidden in it, or placeholder text the file holds itself - with the
 * texts of the file it shows that way: one line's, or a private key
 * block's run of lines. Read as a read of the whole file shows it, and
 * held to what a read of those lines alone shows, so a line shown as it is
 * only beside another (a value read across their break) is not one.
 */
const getLinesShownWithPlaceholders: (
  fileContent: string,
) => Map<string, Set<string>> = (
  fileContent: string,
): Map<string, Set<string>> => {
  const shownAs: Map<string, Set<string>> = new Map<string, Set<string>>();
  const lines: Array<string> = splitCodeFileLines(fileContent);

  if (lines.length === 0) {
    return shownAs;
  }

  const numbered: Array<string> = formatCodeLinesWithNumbers({
    lines,
    startLine: 1,
  }).split("\n");
  const prefixLength: number = getCodeLinePrefixLength(lines.length);
  const parts: Array<string> = ToolResultSerializer.redactAndOmitEmbeddedData(
    numbered.join("\n"),
  ).text.split("\n");
  const lineByPrefix: Map<string, number> = new Map<string, number>();

  numbered.forEach((line: string, index: number): void => {
    lineByPrefix.set(line.slice(0, prefixLength), index);
  });

  const add: (shown: string, text: string) => void = (
    shown: string,
    text: string,
  ): void => {
    const key: string = withoutCarriageReturn(shown);
    const texts: Set<string> = shownAs.get(key) || new Set<string>();

    texts.add(withoutCarriageReturn(text));
    shownAs.set(key, texts);
  };

  let line: number = 0;
  let part: number = 0;

  while (part < parts.length && line < numbered.length) {
    // Shown as the file has it: placeholder text of the file's own, if any.
    if (parts[part] === numbered[line]) {
      if (holdsCodePlaceholder(lines[line]!, REDACTION_PLACEHOLDERS)) {
        add(lines[line]!, lines[line]!);
      }

      line++;
      part++;
      continue;
    }

    // A run the redaction changed: it ends where a later line's number starts a part.
    let next: number = part + 1;
    let end: number = numbered.length;

    while (next < parts.length) {
      const at: number | undefined = lineByPrefix.get(
        parts[next]!.slice(0, prefixLength),
      );

      if (at !== undefined && at > line) {
        end = at;
        break;
      }

      next++;
    }

    // Shown as one line under the first one's number, as those lines alone show.
    const shown: string = parts[part]!;

    if (
      next === part + 1 &&
      shown.startsWith(numbered[line]!.slice(0, prefixLength)) &&
      ToolResultSerializer.redactAndOmitEmbeddedData(
        numbered.slice(line, end).join("\n"),
      ).text === shown
    ) {
      const shownLine: string = shown.slice(prefixLength);

      if (holdsCodePlaceholder(shownLine, REDACTION_PLACEHOLDERS)) {
        add(shownLine, lines.slice(line, end).join("\n"));
      }
    }

    line = end;
    part = next;
  }

  return shownAs;
};

// Runs of lines of the version to commit, as the lines of the model's version they were written from.
const toModelLines: (
  ranges: ReadonlyArray<AIChatLineRange>,
  // For each line of the version to commit, from 1: the model's line it comes from.
  fromLine: ReadonlyArray<number>,
) => Array<AIChatLineRange> = (
  ranges: ReadonlyArray<AIChatLineRange>,
  fromLine: ReadonlyArray<number>,
): Array<AIChatLineRange> => {
  const mapped: Array<AIChatLineRange> = [];

  for (const range of ranges) {
    const first: number = fromLine[range.first - 1] ?? range.first;
    const last: number = fromLine[range.last - 1] ?? range.last;
    const previous: AIChatLineRange | undefined = mapped[mapped.length - 1];

    if (previous && previous.last >= first - 1) {
      previous.last = Math.max(previous.last, last);
    } else {
      mapped.push({ first, last });
    }
  }

  return mapped;
};

export interface CodeFileValuesRestored {
  // The version to commit: each line kept as shown written as the file has it.
  content: string;
  // How many of the model's lines were written back with a value it was not shown.
  restoredLineCount: number;
  /*
   * What it still writes in place of values hidden from the model, more
   * often than the file holds it - none when every one was written back -
   * on the lines of the model's version (findCodePlaceholdersWritten).
   */
  placeholdersWritten: Array<CodeFilePlaceholderWritten>;
}

/*
 * The model's version of a file with each placeholder it kept as shown
 * written back as the file has it - see the header - and what it still
 * writes in place of hidden values.
 */
export const restoreCodeFileValuesHidden: (data: {
  // The model's version of the file: what the change writes.
  content: string;
  // The file as the branch has it, in the version the commit is held to.
  fileContent: string;
}) => CodeFileValuesRestored = (data: {
  content: string;
  fileContent: string;
}): CodeFileValuesRestored => {
  const shownAs: Map<string, Set<string>> = holdsCodePlaceholder(
    data.content,
    REDACTION_PLACEHOLDERS,
  )
    ? getLinesShownWithPlaceholders(data.fileContent)
    : new Map<string, Set<string>>();
  const written: Array<string> = [];
  const fromLine: Array<number> = [];
  let restoredLineCount: number = 0;

  data.content.split("\n").forEach((line: string, index: number): void => {
    const texts: Set<string> | undefined =
      shownAs.size > 0 && holdsCodePlaceholder(line, REDACTION_PLACEHOLDERS)
        ? shownAs.get(withoutCarriageReturn(line))
        : undefined;

    // Exactly one text of the file reads this way: it is that one.
    const text: string | undefined =
      texts && texts.size === 1 ? texts.values().next().value : undefined;

    if (text === undefined) {
      written.push(line);
      fromLine.push(index + 1);
      return;
    }

    // Its line ends as the model ended it.
    const restored: string = line.endsWith("\r") ? `${text}\r` : text;

    if (restored !== line) {
      restoredLineCount++;
    }

    for (const part of restored.split("\n")) {
      written.push(part);
      fromLine.push(index + 1);
    }
  });

  const content: string = written.join("\n");

  return {
    content,
    restoredLineCount,
    placeholdersWritten: findCodePlaceholdersWritten({
      content,
      branchContent: data.fileContent,
      placeholders: REDACTION_PLACEHOLDERS,
    }).map(
      (placeholder: CodeFilePlaceholderWritten): CodeFilePlaceholderWritten => {
        return {
          ...placeholder,
          lines: toModelLines(placeholder.lines, fromLine),
        };
      },
    ),
  };
};
