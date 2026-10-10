import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "@jest/globals";

/*
 * EVERY HOOK THAT JUDGES A DELETE BY ITS ROWS READS THEM WITH
 * findRowsAndHoldDeleteToThem.
 *
 * A hook that reads the rows a delete removes by the delete's own query - a
 * findBy over `deleteBy.query`, a read of `deleteBy.query._id` - reads them
 * in a window of its own, before the delete's permission check narrows the
 * query: rows the delete removes may go unread, and rows it reads - and
 * acts on, posting a feed line, releasing a number, removing rows that hang
 * off them - may never be deleted, or be another caller's.
 * DatabaseService.findRowsAndHoldDeleteToThem (and findOneRowAndHoldDeleteToIt
 * for the one row a delete removes) reads the rows the delete removes - the
 * ones its caller may delete, or the delete's own window for OneUptime and a
 * master admin - and holds the delete to them, so the rows judged are the
 * rows deleted.
 *
 * So outside DatabaseService, a delete's query is only ever:
 *
 *   - narrowed in place (`deleteBy.query = narrow(deleteBy.query)`);
 *   - asked whether it names its rows by id at all (`!deleteBy.query._id`),
 *     which is what the query says, not what a row holds;
 *   - read for the one row it names by a plain id
 *     (DatabaseService.getOneRowIdNamedBy);
 *   - read after the delete, in onDeleteSuccess, onDeleteError and
 *     onHardDeleteSuccess;
 *   - or named below with the reason it is no check of rows the delete may
 *     not remove. The list only ever shrinks: each entry names how many
 *     times its function reads the query, and an entry that reads it no
 *     more is taken out.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

// Where hooks live. A directory missing from the checkout (ee/) is skipped.
const SCANNED_DIRECTORIES: Array<string> = [
  "packages/Common/Server",
  "ee/Server",
];

const SKIPPED_DIRECTORY_NAMES: Set<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "SchemaMigrations",
  "DataMigrations",
]);

/*
 * The delete path itself: it reads the rows its caller may delete before the
 * hooks (keepRowsCallerMayWrite), hands them to the hooks
 * (findRowsAndHoldDeleteToThem) and deletes them.
 */
const DELETE_PATH: string =
  "packages/Common/Server/Services/DatabaseService.ts";

// The source files scanned: TypeScript, not tests.
const SOURCE_FILE: RegExp = /\.tsx?$/;
const TEST_FILE: RegExp = /\.(test|spec)\.tsx?$/;

// What reads the one row a query names by its id.
const ONE_ROW_ID_READER: RegExp = /\bgetOneRowIdNamedBy$/;

// Hooks that run once the delete is done: they read what was deleted.
const AFTER_THE_DELETE: Set<string> = new Set<string>([
  "onDeleteSuccess",
  "onDeleteError",
  "onHardDeleteSuccess",
]);

interface Allowed {
  // How many times the function reads the delete's query.
  mentions: number;
  reason: string;
}

const ALLOWED: Record<string, Allowed> = {
  "packages/Common/Server/Services/GlobalOidcProjectService.ts::onBeforeDelete":
    {
      mentions: 1,
      reason:
        "Reads the providers of the attachments the delete removes once GlobalSsoProviderChanges held the delete to the attachments it read under the sign-in lock: the query names exactly those rows.",
    },
  "packages/Common/Server/Services/GlobalSsoProjectService.ts::onBeforeDelete":
    {
      mentions: 1,
      reason:
        "Reads the providers of the attachments the delete removes once GlobalSsoProviderChanges held the delete to the attachments it read under the sign-in lock: the query names exactly those rows.",
    },
  "packages/Common/Server/Utils/GlobalSsoProviderChanges.ts::beforeProviderDelete":
    {
      mentions: 1,
      reason:
        "Reads the providers under the sign-in lock and holds the delete to the providers it read (ProjectSsoProviderChanges.writeOnlyTheRowsRead).",
    },
  "packages/Common/Server/Utils/GlobalSsoProviderChanges.ts::beforeAttachmentDelete":
    {
      mentions: 1,
      reason:
        "Reads the attachments under the sign-in lock and holds the delete to the attachments it read (ProjectSsoProviderChanges.writeOnlyTheRowsRead).",
    },
  "packages/Common/Server/Services/NetworkSiteService.ts::deleteOneBy": {
    mentions: 1,
    reason:
      "Which projects' hierarchy lock to take before the delete runs; the delete's hook reads, checks and holds its row inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteService.ts::deleteBy": {
    mentions: 1,
    reason:
      "Which projects' hierarchy lock to take before the delete runs; the delete's hook reads, checks and holds its rows inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteService.ts::hardDeleteBy": {
    mentions: 2,
    reason:
      "Whether the purge is one the hierarchy lock can scope, and which projects' lock to take; the delete's hook reads, checks and holds its rows inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteService.ts::hardDeleteClosedLeafBatch":
    {
      mentions: 2,
      reason:
        "The retention purge's own delete, composed here: it reads the sites with no child left, and deletes exactly those by their ids, inside the hierarchy lock.",
    },
  "packages/Common/Server/Services/NetworkSiteTypeService.ts::deleteOneBy": {
    mentions: 1,
    reason:
      "Which projects' hierarchy lock to take before the delete runs; the delete's hook reads, checks and holds its row inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteTypeService.ts::deleteBy": {
    mentions: 1,
    reason:
      "Which projects' hierarchy lock to take before the delete runs; the delete's hook reads, checks and holds its rows inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteTypeService.ts::hardDeleteBy": {
    mentions: 2,
    reason:
      "Whether the purge is one the hierarchy lock can scope, and which projects' lock to take; the delete's hook reads, checks and holds its rows inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteTypeService.ts::hardDeleteClosedLeafBatch":
    {
      mentions: 2,
      reason:
        "The retention purge's own delete, composed here: it reads the types nothing uses, and deletes exactly those by their ids, inside the hierarchy lock.",
    },
  "packages/Common/Server/Services/MetricService.ts::deleteBy": {
    mentions: 2,
    reason:
      "Cascades the delete, once it is done, into the rollups by the query as the delete wrote it: what was asked and what was deleted, not a check of rows.",
  },
  "packages/Common/Server/Services/AnalyticsDatabaseService.ts::toDeleteStatement":
    {
      mentions: 1,
      reason:
        "Builds the analytics delete statement: the delete itself, not a check of it.",
    },
};

interface QueryRead {
  key: string;
  line: number;
  text: string;
}

function sourceFiles(directory: string): Array<string> {
  const absolute: string = path.join(REPOSITORY_ROOT, directory);

  if (!fs.existsSync(absolute)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
        files.push(...sourceFiles(relative));
      }

      continue;
    }

    if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      files.push(relative);
    }
  }

  return files;
}

/*
 * The names a delete goes by - `deleteBy`, `deleteOneBy` - alone or as a
 * property: `onDelete.deleteBy`, `data.deleteBy`...
 */
const DELETE_NAMES: Set<string> = new Set<string>(["deleteBy", "deleteOneBy"]);

function isDeleteBy(expression: ts.Expression): boolean {
  return (
    (ts.isIdentifier(expression) && DELETE_NAMES.has(expression.text)) ||
    (ts.isPropertyAccessExpression(expression) &&
      DELETE_NAMES.has(expression.name.text))
  );
}

// Whether a file can name a delete at all (DELETE_NAMES).
const NAMES_A_DELETE: RegExp = /\b(deleteBy|deleteOneBy)\b/;

// `<delete>.query`.
function isDeleteQuery(node: ts.Node): node is ts.PropertyAccessExpression {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === "query" &&
    isDeleteBy(node.expression)
  );
}

// The class member or top-level function a node is in.
function functionNameOf(node: ts.Node): string {
  let current: ts.Node | undefined = node.parent;
  let name: string = "<module>";

  while (current) {
    if (
      (ts.isMethodDeclaration(current) ||
        ts.isGetAccessorDeclaration(current) ||
        ts.isPropertyDeclaration(current)) &&
      current.name
    ) {
      return current.name.getText();
    }

    if (ts.isFunctionDeclaration(current) && current.name) {
      return current.name.text;
    }

    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      ts.isSourceFile(current.parent.parent.parent)
    ) {
      name = current.name.text;
    }

    current = current.parent;
  }

  return name;
}

// `deleteBy.query = ...`: the query itself, written.
function isAssigned(node: ts.PropertyAccessExpression): boolean {
  const parent: ts.Node = node.parent;

  return (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.left === node
  );
}

// Inside `deleteBy.query = narrow(deleteBy.query)`: narrowed in place.
function isNarrowedInPlace(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;

  while (current && !ts.isStatement(current)) {
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isDeleteQuery(current.left)
    ) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

// `getOneRowIdNamedBy(deleteBy.query)`: the one row it names by id.
function isOneRowIdRead(node: ts.Node): boolean {
  const parent: ts.Node = node.parent;

  return (
    ts.isCallExpression(parent) &&
    parent.arguments.includes(node as ts.Expression) &&
    ONE_ROW_ID_READER.test(parent.expression.getText())
  );
}

/*
 * `!deleteBy.query._id` or `if (deleteBy.query._id)`: whether the query
 * names its rows by id at all - what the query says, not what a row holds.
 */
function isIdPresenceTest(node: ts.Node): boolean {
  const idRead: ts.Node = node.parent;

  if (
    !ts.isPropertyAccessExpression(idRead) ||
    idRead.expression !== node ||
    idRead.name.text !== "_id"
  ) {
    return false;
  }

  const test: ts.Node = idRead.parent;

  return (
    (ts.isPrefixUnaryExpression(test) &&
      test.operator === ts.SyntaxKind.ExclamationToken) ||
    (ts.isIfStatement(test) && test.expression === idRead)
  );
}

function isCounted(node: ts.Node): boolean {
  return (
    isDeleteQuery(node) &&
    !AFTER_THE_DELETE.has(functionNameOf(node)) &&
    !isAssigned(node) &&
    !isNarrowedInPlace(node) &&
    !isOneRowIdRead(node) &&
    !isIdPresenceTest(node)
  );
}

function findQueryReads(): Array<QueryRead> {
  const reads: Array<QueryRead> = [];

  for (const directory of SCANNED_DIRECTORIES) {
    for (const file of sourceFiles(directory)) {
      if (file === DELETE_PATH) {
        continue;
      }

      const text: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      if (!NAMES_A_DELETE.test(text)) {
        continue;
      }

      const source: ts.SourceFile = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
      );

      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (isCounted(node)) {
          reads.push({
            key: `${file}::${functionNameOf(node)}`,
            line:
              source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            text: node.parent.getText().split("\n")[0]!.trim(),
          });
        }

        ts.forEachChild(node, visit);
      };

      visit(source);
    }
  }

  return reads;
}

describe("Hooks that judge a delete by its rows read them with findRowsAndHoldDeleteToThem", () => {
  const reads: Array<QueryRead> = findQueryReads();

  it("finds the delete path's own readers, so the scan reads real code", () => {
    // The listed functions read the query; a scan that sees none of them sees nothing.
    expect(reads.length).toBeGreaterThan(0);
  });

  it("reads a delete's rows by its query nowhere but in the delete path and the functions listed", () => {
    const unexpected: Array<string> = reads
      .filter((read: QueryRead): boolean => {
        return !ALLOWED[read.key];
      })
      .map((read: QueryRead): string => {
        return `${read.key} (line ${read.line}): ${read.text}`;
      });

    // Read them with this.findRowsAndHoldDeleteToThem(deleteBy, select) instead.
    expect(unexpected).toEqual([]);
  });

  it("reads the query in each listed function no more often than listed", () => {
    const counts: Record<string, number> = {};

    for (const read of reads) {
      counts[read.key] = (counts[read.key] || 0) + 1;
    }

    const changed: Array<string> = Object.keys(ALLOWED)
      .filter((key: string): boolean => {
        return (counts[key] || 0) !== ALLOWED[key]!.mentions;
      })
      .map((key: string): string => {
        return `${key}: listed ${ALLOWED[key]!.mentions}, found ${counts[key] || 0}`;
      });

    // A function that reads it more often reads rows a new way; one that no longer does leaves the list.
    expect(changed).toEqual([]);
  });

  it("gives every listed function a reason", () => {
    for (const [key, allowed] of Object.entries(ALLOWED)) {
      expect({ key, reason: allowed.reason.length > 20 }).toEqual({
        key,
        reason: true,
      });
    }
  });
});

describe("The delete query readers the scan recognizes", () => {
  function readsIn(code: string): Array<string> {
    const source: ts.SourceFile = ts.createSourceFile(
      "Example.ts",
      code,
      ts.ScriptTarget.Latest,
      true,
    );
    const found: Array<string> = [];

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (isCounted(node)) {
        found.push(functionNameOf(node));
      }

      ts.forEachChild(node, visit);
    };

    visit(source);

    return found;
  }

  it("counts a read of the delete's rows by its query, whatever the delete is called on", () => {
    expect(
      readsIn(`class S {
        async onBeforeDelete(deleteBy) {
          await this.findBy({ query: deleteBy.query, select: {}, limit: 1, skip: 0, props: {} });
        }
        async check(data) {
          return data.service.findBy({ query: { ...data.deleteBy.query }, select: {} });
        }
        async single(deleteBy) {
          return this.findOneById({ id: deleteBy.query._id });
        }
      }`),
    ).toEqual(["onBeforeDelete", "check", "single"]);
  });

  it("counts it under the other names a delete goes by", () => {
    expect(
      readsIn(`class S {
        async deleteOneBy(deleteOneBy) {
          await this.findBy({ query: deleteOneBy.query, select: {} });
        }
        async cleanup(onDelete) {
          return this.findBy({ query: onDelete.deleteBy.query, select: {} });
        }
      }`),
    ).toEqual(["deleteOneBy", "cleanup"]);
  });

  it("counts a read of the id a query names, beyond asking whether it names one", () => {
    expect(
      readsIn(`class S {
        async onBeforeDelete(deleteBy) {
          if (deleteBy.query._id) {
            await this.archive(new ObjectID(deleteBy.query._id as string));
          }
        }
      }`),
    ).toEqual(["onBeforeDelete"]);
  });

  it("does not count a narrowing in place, an id presence test, a one-row id read, or a read after the delete", () => {
    expect(
      readsIn(`class S {
        async onBeforeDelete(deleteBy) {
          deleteBy.query = applyFilter(deleteBy.query, deleteBy.props);
          if (!deleteBy.query._id && !deleteBy.props.isRoot) {
            throw new Error("by id");
          }
          if (deleteBy.query._id) {
            return null;
          }
          const id = Service.getOneRowIdNamedBy(deleteBy.query);
          return this.findRowsAndHoldDeleteToThem(deleteBy, { _id: true });
        }
        async onDeleteSuccess(onDelete, ids) {
          return this.findBy({ query: onDelete.deleteBy.query });
        }
        async onDeleteError(error, onDelete) {
          return this.findBy({ query: onDelete.deleteBy.query });
        }
        async onHardDeleteSuccess(onDelete, ids) {
          return this.findBy({ query: onDelete.deleteBy.query });
        }
      }`),
    ).toEqual([]);
  });
});
