import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * EVERY CLIENT READS RETRY-AFTER WITH ONE READER (issue #8928).
 *
 * Retry-After was read a dozen ways - Number(), parseInt, a digits pattern
 * and Date.parse - and most of them read "-5", "1.5" or "5 seconds" as no
 * wait at all, so a throttled request was asked again at once. Common's
 * RetryAfter reads it as RFC 9110 writes it, and is the one reader: the
 * packages that cannot import Common carry byte-identical copies of it.
 *
 * This reads every source file of the repository (tests left out) that
 * names the header, and fails on one that READS it - a get("retry-after"),
 * a headers["retry-after"], a comparison with the name - unless the file
 * imports the reader, or is listed in HANDED_TO_A_READER with the file it
 * hands the raw value to, which must. Setting the header (setHeader,
 * res.set, a headers object, a CORS list) is not reading it.
 *
 * ee/ is read when it is there (CI deletes ee/ for the open-source build).
 */

// packages/Common/Tests/Utils -> the repository.
const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const SCAN_ROOTS: Array<string> = ["packages", "ee", "agents"];

// Directories that hold no source a client runs.
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "public",
  "coverage",
  "Tests",
  "tests",
  "__tests__",
  "E2E",
  ".git",
]);

// The reader, and the copies the standalone packages carry.
const READER: string = "packages/Common/Utils/RetryAfter.ts";
const READER_COPIES: Array<string> = [
  "agents/KubernetesAIAgent/Common/Utils/RetryAfter.ts",
  "agents/ResourceAIAgent/Common/Utils/RetryAfter.ts",
  "packages/App/FeatureSet/MobileRecorder/src/RetryAfter.ts",
];

/*
 * Files that read the header and hand the raw value to a function of
 * another file, which reads it with RetryAfter.
 */
const HANDED_TO_A_READER: Readonly<Record<string, string>> = {
  // HttpMailApi.parseRetryAfter.
  "packages/App/FeatureSet/Notification/Services/MailProviders/AmazonSesMailProvider.ts":
    "packages/App/FeatureSet/Notification/Services/MailProviders/HttpMailApi.ts",
  "packages/App/FeatureSet/Notification/Services/MailProviders/MailgunMailProvider.ts":
    "packages/App/FeatureSet/Notification/Services/MailProviders/HttpMailApi.ts",
  "packages/App/FeatureSet/Notification/Services/MailProviders/PostmarkMailProvider.ts":
    "packages/App/FeatureSet/Notification/Services/MailProviders/HttpMailApi.ts",
  "packages/App/FeatureSet/Notification/Services/MailProviders/ResendMailProvider.ts":
    "packages/App/FeatureSet/Notification/Services/MailProviders/HttpMailApi.ts",
  "packages/App/FeatureSet/Notification/Services/MailProviders/SendGridMailProvider.ts":
    "packages/App/FeatureSet/Notification/Services/MailProviders/HttpMailApi.ts",
  // computeRetryDelayInMs, through parseRetryAfter.
  "packages/Probe/Utils/OpenStack/OpenStackServiceClient.ts":
    "packages/Probe/Utils/OpenStack/OpenStackBackoff.ts",
};

const HEADER_NAME: RegExp = /retry-after/i;

// What a call that SETS a header is called: res.setHeader, res.set, ...
const SETTING_CALL: RegExp =
  /(^|\.)(setHeader|set|header|append|appendHeader)$/;
// (setHeader as Function).call(res, "Retry-After", ...), too.
const SET_HEADER: RegExp = /setHeader/;

const SOURCE_FILE: RegExp = /\.tsx?$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;
const TEST_FILE: RegExp = /\.(test|spec)\.tsx?$/;

// Every .ts and .tsx source file under a directory, tests left out.
function listSources(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        files.push(...listSources(full));
      }

      continue;
    }

    if (
      SOURCE_FILE.test(entry.name) &&
      !DECLARATION_FILE.test(entry.name) &&
      !TEST_FILE.test(entry.name)
    ) {
      files.push(full);
    }
  }

  return files;
}

// Whether `node` is the target of an assignment: headers["Retry-After"] = x.
function isAssigned(node: ts.Node): boolean {
  const parent: ts.Node = node.parent;

  return (
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  );
}

/*
 * Whether a string literal naming the header reads it. Writing it - a call
 * that sets it, an object of headers to send, a list of names (CORS), an
 * assignment into headers - is not.
 */
function isRead(literal: ts.StringLiteralLike, source: ts.SourceFile): boolean {
  const parent: ts.Node = literal.parent;

  if (ts.isPropertyAssignment(parent) && parent.name === literal) {
    return false;
  }

  if (ts.isArrayLiteralExpression(parent)) {
    return false;
  }

  if (ts.isElementAccessExpression(parent)) {
    return !isAssigned(parent);
  }

  if (ts.isCallExpression(parent)) {
    const callee: string = parent.expression.getText(source);

    if (SETTING_CALL.test(callee) || SET_HEADER.test(callee)) {
      return false;
    }
  }

  return true;
}

// The lines where a file reads the header by name.
function findReads(file: string, text: string): Array<number> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines: Array<number> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text.toLowerCase() === "retry-after" &&
      isRead(node, source)
    ) {
      lines.push(
        source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return lines;
}

// Whether a file imports the reader: a module whose last segment is RetryAfter.
function importsTheReader(text: string): boolean {
  const source: ts.SourceFile = ts.createSourceFile(
    "imports.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );

  return source.statements.some((statement: ts.Statement): boolean => {
    return (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.split("/").pop() === "RetryAfter"
    );
  });
}

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

// Every source file that reads the header, with the lines it does so on.
function findReaders(): Map<string, Array<number>> {
  const readers: Map<string, Array<number>> = new Map<string, Array<number>>();

  for (const root of SCAN_ROOTS) {
    for (const file of listSources(path.join(REPOSITORY_ROOT, root))) {
      const text: string = fs.readFileSync(file, "utf8");

      if (!HEADER_NAME.test(text)) {
        continue;
      }

      const lines: Array<number> = findReads(file, text);

      if (lines.length > 0) {
        readers.set(relative(file), lines);
      }
    }
  }

  return readers;
}

function readRepositoryFile(file: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
}

describe("every client reads Retry-After with Common's RetryAfter", () => {
  const readers: Map<string, Array<number>> = findReaders();
  const isEnterpriseHere: boolean = fs.existsSync(
    path.join(REPOSITORY_ROOT, "ee", "Server"),
  );

  test("a file that reads the header imports the reader, or hands the value to one that does", () => {
    const unread: Array<string> = [];

    for (const [file, lines] of readers) {
      if (file === READER || READER_COPIES.includes(file)) {
        continue;
      }

      if (HANDED_TO_A_READER[file]) {
        continue;
      }

      if (!importsTheReader(readRepositoryFile(file))) {
        unread.push(`${file}:${lines.join(",")}`);
      }
    }

    /*
     * A file here reads Retry-After its own way. Read it with
     * RetryAfter.msFromHeaders / secondsFromHeaders (Common/Utils/RetryAfter),
     * or, if it hands the raw value to a function elsewhere that does, list
     * it in HANDED_TO_A_READER.
     */
    expect(unread).toEqual([]);
  });

  test("each file that hands the value on still reads the header, and its reader imports RetryAfter", () => {
    for (const [file, reader] of Object.entries(HANDED_TO_A_READER)) {
      expect({ file, readsTheHeader: readers.has(file) }).toEqual({
        file,
        readsTheHeader: true,
      });
      expect({
        reader,
        importsTheReader: importsTheReader(readRepositoryFile(reader)),
      }).toEqual({ reader, importsTheReader: true });
    }
  });

  test("the copies are the reader, byte for byte", () => {
    const reader: string = readRepositoryFile(READER);

    for (const copy of READER_COPIES) {
      expect({ copy, identical: readRepositoryFile(copy) === reader }).toEqual({
        copy,
        identical: true,
      });
    }
  });

  test("the clients the issue named are among those that import it", () => {
    for (const file of [
      "packages/Common/Utils/API.ts",
      "packages/Probe/Utils/ServerBusy.ts",
      "packages/Probe/Utils/OpenStack/OpenStackBackoff.ts",
      "packages/Common/Server/Utils/Workspace/Slack/SlackUserGroups.ts",
      "packages/Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsTags.ts",
      "packages/Runner/Services/RegisterRunner.ts",
      ...(isEnterpriseHere
        ? ["ee/Server/Billing/StripeBillingProvider.ts"]
        : []),
    ]) {
      expect({
        file,
        importsTheReader: importsTheReader(readRepositoryFile(file)),
      }).toEqual({ file, importsTheReader: true });
    }
  });

  describe("the checks themselves", () => {
    const readsIn: (code: string) => Array<number> = (
      code: string,
    ): Array<number> => {
      return findReads("planted.ts", code);
    };

    test("reading the header by name is found", () => {
      expect(readsIn('const a = response.headers.get("retry-after");')).toEqual(
        [1],
      );
      expect(readsIn('const a = headers["Retry-After"];')).toEqual([1]);
      expect(readsIn("const a = headers?.['retry-after'];")).toEqual([1]);
      expect(readsIn('if (name.toLowerCase() === "retry-after") {}')).toEqual([
        1,
      ]);
      expect(readsIn('const a = headerOf(response, "retry-after");')).toEqual([
        1,
      ]);
      expect(readsIn("const a = headers[`Retry-After`];")).toEqual([1]);
    });

    test("setting it is not reading it", () => {
      expect(
        readsIn(
          [
            'res.setHeader("Retry-After", "10");',
            'res.set("Retry-After", String(seconds));',
            'setHeader(data.res, "Retry-After", "5");',
            '(setHeader as Function).call(res, "Retry-After", "5");',
            'const sent = { "Retry-After": "30" };',
            'const exposed = ["Content-Type", "Retry-After"];',
            'headers["Retry-After"] = "7";',
            'response.headers.append("Retry-After", "1");',
          ].join("\n"),
        ),
      ).toEqual([]);
    });

    test("a file imports the reader by any path that ends in RetryAfter", () => {
      expect(
        importsTheReader('import RetryAfter from "Common/Utils/RetryAfter";'),
      ).toBe(true);
      expect(
        importsTheReader('import RetryAfter from "../../Utils/RetryAfter";'),
      ).toBe(true);
      expect(importsTheReader('import RetryAfter from "./RetryAfter";')).toBe(
        true,
      );
      expect(
        importsTheReader('import RetryAfterish from "./RetryAfterish";'),
      ).toBe(false);
      expect(importsTheReader('import API from "Common/Utils/API";')).toBe(
        false,
      );
    });
  });
});
