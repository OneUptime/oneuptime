import { AIChatLineRange, readAIChatLineRanges } from "../AI/AIChatRecordSeen";

/*
 * WHAT A CODE CHANGE WRITES IN PLACE OF VALUES HIDDEN FROM ASK AI (issue
 * #6364).
 *
 * Before a tool result reaches the model, OneUptime hides what looks like a
 * secret or personal data in it (Server/Utils/AI/Toolbox/Serializer): an
 * IP address reads "[redacted-ip]", an email address "[redacted-email]",
 * "password = hunter22" reads "password = [redacted]", a private key block
 * "[redacted-private-key]". That is right for what the model reads. But
 * Ask AI writes a file whole (commit_code_to_branch, open_code_pull_request),
 * from what read_code_file showed it: a model that changes one line of
 * config/servers.ts writes the whole file back, with "[redacted-ip]" where
 * every address was.
 *
 * So the change is held to the file on the branch it writes to: a
 * placeholder that Ask AI's version holds more often than that file does
 * was written from a value hidden from it - the placeholder lands where the
 * value was, or in a new file where a value belongs. A repository may hold
 * the placeholder's text itself (OneUptime's own redaction tests do), so it
 * is the count that tells, never the text alone: a version that keeps the
 * file's own placeholders, and adds none, writes over nothing hidden.
 *
 * Pure: no host, and the placeholders are the caller's. They are distinct,
 * and none holds another, so each is counted on its own. Every text is
 * read with indexOf, never a regular expression: a file can be megabytes
 * long, or one line of them.
 */

// A placeholder that Ask AI's version of a file holds more often than the file on the branch does.
export interface CodeFilePlaceholderWritten {
  // The text OneUptime showed in place of a hidden value: "[redacted-ip]".
  placeholder: string;
  // How many times Ask AI's version holds it.
  written: number;
  // How many times the file on the branch holds it: fewer.
  onBranch: number;
  // The lines of Ask AI's version that hold it, in runs, counted as read_code_file numbers them.
  lines: Array<AIChatLineRange>;
}

type PositionsFunction = (text: string, placeholder: string) => Array<number>;

// Where a placeholder starts in a text, each time, in order.
const positionsOf: PositionsFunction = (
  text: string,
  placeholder: string,
): Array<number> => {
  const positions: Array<number> = [];

  if (!placeholder) {
    return positions;
  }

  let at: number = text.indexOf(placeholder);

  while (at !== -1) {
    positions.push(at);
    at = text.indexOf(placeholder, at + placeholder.length);
  }

  return positions;
};

type CountFunction = (text: string, placeholder: string) => number;

// How many times a text holds a placeholder.
export const countCodePlaceholder: CountFunction = (
  text: string,
  placeholder: string,
): number => {
  return positionsOf(text, placeholder).length;
};

type ContainsAnyFunction = (
  text: string,
  placeholders: ReadonlyArray<string>,
) => boolean;

// Whether a text holds any of the placeholders: the only versions the branch's file is read for.
export const holdsCodePlaceholder: ContainsAnyFunction = (
  text: string,
  placeholders: ReadonlyArray<string>,
): boolean => {
  return placeholders.some((placeholder: string): boolean => {
    return placeholder.length > 0 && text.includes(placeholder);
  });
};

type LinesOfFunction = (
  text: string,
  positions: ReadonlyArray<number>,
) => Array<AIChatLineRange>;

/*
 * The lines positions of a text are on, in runs: line 1 is the text up to
 * its first newline, as read_code_file numbers a file's lines.
 */
const linesOf: LinesOfFunction = (
  text: string,
  positions: ReadonlyArray<number>,
): Array<AIChatLineRange> => {
  const ranges: Array<AIChatLineRange> = [];
  let line: number = 1;
  let newline: number = text.indexOf("\n");

  for (const position of positions) {
    while (newline !== -1 && newline < position) {
      line++;
      newline = text.indexOf("\n", newline + 1);
    }

    const previous: AIChatLineRange | undefined = ranges[ranges.length - 1];

    if (previous && previous.last >= line - 1) {
      previous.last = Math.max(previous.last, line);
    } else {
      ranges.push({ first: line, last: line });
    }
  }

  return ranges;
};

type FindWrittenFunction = (data: {
  // Ask AI's version of the file: what the change writes.
  content: string;
  // The file as the branch has it; "" for none.
  branchContent: string;
  // The placeholders OneUptime writes in place of what it hides, in the order to say them.
  placeholders: ReadonlyArray<string>;
}) => Array<CodeFilePlaceholderWritten>;

/*
 * Each placeholder Ask AI's version holds more often than the branch's
 * file does, in the placeholders' order - none when it adds none.
 */
export const findCodePlaceholdersWritten: FindWrittenFunction = (data: {
  content: string;
  branchContent: string;
  placeholders: ReadonlyArray<string>;
}): Array<CodeFilePlaceholderWritten> => {
  const written: Array<CodeFilePlaceholderWritten> = [];

  for (const placeholder of data.placeholders) {
    const positions: Array<number> = positionsOf(data.content, placeholder);

    if (positions.length === 0) {
      continue;
    }

    const onBranch: number = countCodePlaceholder(
      data.branchContent,
      placeholder,
    );

    if (positions.length > onBranch) {
      written.push({
        placeholder: placeholder,
        written: positions.length,
        onBranch: onBranch,
        lines: linesOf(data.content, positions),
      });
    }
  }

  return written;
};


/*
 * The most placeholders a stored finding may name: more than redaction
 * writes kinds of.
 */
export const MAX_PLACEHOLDERS_WRITTEN: number = 64;

// The longest a stored placeholder may be: longer than any redaction writes.
const MAX_PLACEHOLDER_LENGTH: number = 64;

/*
 * The most lines a file Ask AI writes may have: one line a character, of
 * the largest file a commit of its own may write (CodeWriteTools'
 * MAX_FILE_BYTES).
 */
const MAX_LINE_NUMBER: number = 256 * 1024 + 1;

type IsCountFunction = (value: unknown) => value is number;

const isCount: IsCountFunction = (value: unknown): value is number => {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
};

type ReadWrittenFunction = (
  value: unknown,
) => Array<CodeFilePlaceholderWritten> | null;

/*
 * The placeholders a stored finding says Ask AI's version writes, or null
 * for anything not well formed: a note for the pull request's reviewer
 * (Types/CodeRepository/CodeFileSeen), so a damaged one leaves out the
 * note, never the finding.
 */
export const readCodePlaceholdersWritten: ReadWrittenFunction = (
  value: unknown,
): Array<CodeFilePlaceholderWritten> | null => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_PLACEHOLDERS_WRITTEN
  ) {
    return null;
  }

  const read: Array<CodeFilePlaceholderWritten> = [];

  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    const placeholder: unknown = record["placeholder"];
    const written: unknown = record["written"];
    const onBranch: unknown = record["onBranch"];

    if (
      typeof placeholder !== "string" ||
      placeholder.length === 0 ||
      placeholder.length > MAX_PLACEHOLDER_LENGTH ||
      !isCount(written) ||
      !isCount(onBranch) ||
      written <= onBranch
    ) {
      return null;
    }

    const lines: Array<AIChatLineRange> | null = readAIChatLineRanges(
      record["lines"],
      MAX_LINE_NUMBER,
    );

    if (!lines || lines.length === 0) {
      return null;
    }

    read.push({ placeholder, written, onBranch, lines });
  }

  return read;
};
