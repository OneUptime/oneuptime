import {
  NOT_SENSITIVE_MARKER,
  SENSITIVE_DATA_LIMITS,
} from "../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import { HunkHeader, parseHunkHeader } from "../ProductionReviewDiff";

/*
 * A PULL REQUEST'S PATCH, LINE BY LINE, AS THE SENSITIVE DATA RULES READ IT.
 *
 * The rules read only what a change brings: the lines it adds, each with
 * its number in the file after the change, so a point names the line the
 * author sees. The lines around them (a hunk's context) are read too, for
 * what an added line sits in - the resource block of a Terraform setting,
 * the CREATE TABLE of a column - but never make a point of their own.
 *
 * Everything here reads text a pull request's author wrote, so every line
 * is held to SENSITIVE_DATA_LIMITS.maxLineRead and nothing is read by a
 * pattern that backtracks.
 *
 * Pure: no IO.
 */

export enum PatchLineKind {
  Added = "Added",
  Context = "Context",
  Removed = "Removed",
}

export interface PatchLine {
  kind: PatchLineKind;
  // The line's text, without its +, - or space, held to maxLineRead.
  text: string;
  // Its number in the file after the change; 0 for a removed line.
  newLine: number;
  // Which hunk of the patch it is in, from 0.
  hunk: number;
}

// The lines of a patch that a hunk holds, in order.
export function readPatchLines(
  patch: string | null | undefined,
): Array<PatchLine> {
  const lines: Array<PatchLine> = [];

  if (!patch) {
    return lines;
  }

  let newLine: number = 0;
  let hunk: number = -1;
  let inHunk: boolean = false;

  for (const rawLine of patch.split("\n")) {
    const line: string = rawLine.endsWith("\r")
      ? rawLine.slice(0, -1)
      : rawLine;

    if (line.startsWith("@@")) {
      const header: HunkHeader | null = parseHunkHeader(line);

      // A header that is not one: nothing after it is read, until one is.
      inHunk = Boolean(header);

      if (header) {
        hunk++;
        newLine = header.headStart;
      }

      continue;
    }

    if (!inHunk) {
      continue;
    }

    const marker: string = line[0] || " ";
    const text: string = line.slice(1, SENSITIVE_DATA_LIMITS.maxLineRead + 1);

    if (marker === "\\") {
      // "\ No newline at end of file"
      continue;
    }

    if (marker === "+") {
      lines.push({ kind: PatchLineKind.Added, text, newLine, hunk });
      newLine++;
    } else if (marker === "-") {
      lines.push({ kind: PatchLineKind.Removed, text, newLine: 0, hunk });
    } else {
      lines.push({ kind: PatchLineKind.Context, text, newLine, hunk });
      newLine++;
    }
  }

  return lines;
}

/*
 * The lines a change leaves in the file - added and context, in order -
 * which is what the file reads like after the change, where a hunk shows
 * it.
 */
export function readNewLines(lines: Array<PatchLine>): Array<PatchLine> {
  return lines.filter((line: PatchLine): boolean => {
    return line.kind !== PatchLineKind.Removed;
  });
}

// What a comment of its own line starts with, in any language: //, #, --, /*, <!--, ;
const COMMENT_PUNCTUATION: string = "/#*-;<!%'";

/*
 * Whether a line is a comment that carries the marker and nothing before
 * it: `// oneuptime:not-sensitive` on a line of its own, which marks the
 * line under it.
 */
function isMarkerComment(text: string): boolean {
  const at: number = text.toLowerCase().indexOf(NOT_SENSITIVE_MARKER);

  if (at < 0) {
    return false;
  }

  let hasPunctuation: boolean = false;

  for (let index: number = 0; index < at; index++) {
    const character: string = text.charAt(index);

    if (character === " " || character === "\t") {
      continue;
    }

    if (!COMMENT_PUNCTUATION.includes(character)) {
      return false;
    }

    hasPunctuation = true;
  }

  return hasPunctuation;
}

/*
 * Whether a line carries the marker that says it is no leak
 * (NOT_SENSITIVE_MARKER), or a comment of its own just above it does:
 * written by the author, where every reviewer of the diff reads it. A
 * marker at the end of a line marks that line only.
 */
export function isMarkedNotSensitive(
  newLines: Array<PatchLine>,
  index: number,
): boolean {
  const here: PatchLine | undefined = newLines[index];

  if (!here) {
    return false;
  }

  if (here.text.toLowerCase().includes(NOT_SENSITIVE_MARKER)) {
    return true;
  }

  const above: PatchLine | undefined = newLines[index - 1];

  return Boolean(
    above &&
      above.hunk === here.hunk &&
      above.newLine === here.newLine - 1 &&
      isMarkerComment(above.text),
  );
}

// A path's parts, lower case, without empty ones.
function segmentsOf(path: string): Array<string> {
  return path
    .toLowerCase()
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });
}

function fileNameOf(path: string): string {
  const segments: Array<string> = segmentsOf(path);

  return segments[segments.length - 1] || "";
}

// Folders whose code is a dependency's copy, never the repository's own.
const VENDORED_FOLDERS: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "vendor",
  "vendors",
  "third_party",
  "third-party",
  "thirdparty",
  "bower_components",
  "jspm_packages",
  ".yarn",
  "pods",
  "carthage",
  "site-packages",
  ".venv",
  "venv",
]);

// Whether the file is a dependency's copy: read for nothing.
export function isVendoredPath(path: string): boolean {
  const segments: Array<string> = segmentsOf(path);

  return segments.slice(0, -1).some((segment: string): boolean => {
    return VENDORED_FOLDERS.has(segment);
  });
}

// Folders that hold tests, test data and fixtures.
const TEST_FOLDERS: ReadonlySet<string> = new Set<string>([
  "test",
  "tests",
  "__tests__",
  "__test__",
  "spec",
  "specs",
  "__specs__",
  "__mocks__",
  "mocks",
  "mock",
  "fixtures",
  "fixture",
  "__fixtures__",
  "testdata",
  "test-data",
  "test_data",
  "e2e",
  "cypress",
  "integration-tests",
  "integration_tests",
]);

// The parts of a file's name that say it is a test or a fixture.
const TEST_NAME_PARTS: ReadonlyArray<string> = [
  ".test.",
  ".spec.",
  ".stories.",
  ".fixture.",
  ".fixtures.",
  ".mock.",
  ".e2e.",
];

// Read lower case: login_test.go.
const TEST_NAME_ENDINGS: ReadonlyArray<string> = [
  "_test.go",
  "_test.py",
  "_spec.rb",
  "_test.rb",
  "_test.exs",
  "_test.dart",
];

/*
 * Read as written, so a class's name ends in its own word: LoginTest.java
 * is a test, Contest.java and Latest.php are not.
 */
const TEST_CLASS_ENDINGS: ReadonlyArray<string> = [
  "Test.java",
  "Tests.java",
  "IT.java",
  "Test.kt",
  "Tests.kt",
  "Test.cs",
  "Tests.cs",
  "Spec.scala",
  "Test.scala",
  "Test.swift",
  "Tests.swift",
  "Test.php",
];

/*
 * Whether the file is a test, test data or a fixture: read for its
 * infrastructure only, never for what it writes to telemetry or the
 * columns it adds - a test logs an email on purpose.
 */
export function isTestPath(path: string): boolean {
  const segments: Array<string> = segmentsOf(path);
  const name: string = fileNameOf(path);
  const writtenName: string = path.slice(path.lastIndexOf("/") + 1);

  if (
    segments.slice(0, -1).some((segment: string): boolean => {
      return TEST_FOLDERS.has(segment);
    })
  ) {
    return true;
  }

  return (
    name === "conftest.py" ||
    name === "tests.py" ||
    name.startsWith("test_") ||
    TEST_NAME_PARTS.some((part: string): boolean => {
      return name.includes(part);
    }) ||
    TEST_NAME_ENDINGS.some((ending: string): boolean => {
      return name.endsWith(ending);
    }) ||
    TEST_CLASS_ENDINGS.some((ending: string): boolean => {
      return writtenName.endsWith(ending);
    })
  );
}

// Folders and names of code that a tool wrote.
const GENERATED_FOLDERS: ReadonlySet<string> = new Set<string>([
  "generated",
  "__generated__",
  "gen-src",
  "dist",
]);

const GENERATED_NAME_PARTS: ReadonlyArray<string> = [
  ".generated.",
  "_generated.",
  ".gen.",
  ".pb.",
  "_pb2.",
  "_pb2_grpc.",
  ".min.",
  ".bundle.",
];

// What a tool writes at the top of what it generated.
const GENERATED_HEADERS: ReadonlyArray<string> = [
  "@generated",
  "do not edit",
  "code generated by",
  "auto-generated",
  "autogenerated",
  "this file was generated",
  "this file is generated",
];

/*
 * Whether the file is code a tool wrote: read for its infrastructure only.
 * A file is generated when its folder or name says so, or when the first
 * lines of a patch that starts at its top say so.
 */
export function isGeneratedPath(
  path: string,
  lines: Array<PatchLine>,
): boolean {
  const segments: Array<string> = segmentsOf(path);
  const name: string = fileNameOf(path);

  if (
    segments.slice(0, -1).some((segment: string): boolean => {
      return GENERATED_FOLDERS.has(segment);
    }) ||
    GENERATED_NAME_PARTS.some((part: string): boolean => {
      return name.includes(part);
    })
  ) {
    return true;
  }

  const top: Array<PatchLine> = lines
    .filter((line: PatchLine): boolean => {
      return line.kind !== PatchLineKind.Removed && line.newLine <= 5;
    })
    .slice(0, 5);

  return top.some((line: PatchLine): boolean => {
    const text: string = line.text.toLowerCase();

    return GENERATED_HEADERS.some((header: string): boolean => {
      return text.includes(header);
    });
  });
}

// A path's extension, lower case, without its dot: "" when it has none.
export function extensionOf(path: string): string {
  const name: string = fileNameOf(path);
  const dot: number = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot + 1) : "";
}

export function fileNameOfPath(path: string): string {
  return fileNameOf(path);
}

// The number of white-space characters a line starts with.
export function indentOf(text: string): number {
  let index: number = 0;

  while (
    index < text.length &&
    (text.charCodeAt(index) === 0x20 || text.charCodeAt(index) === 0x09)
  ) {
    index++;
  }

  return index;
}
