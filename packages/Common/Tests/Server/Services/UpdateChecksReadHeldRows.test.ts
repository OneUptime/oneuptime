import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "@jest/globals";

/*
 * EVERY HOOK THAT JUDGES AN UPDATE BY ITS ROWS READS THEM WITH
 * findRowsAndHoldUpdateToThem.
 *
 * A hook that reads the rows an update writes by the update's own query - a
 * findBy over `updateBy.query`, a read of `updateBy.query._id` - reads them
 * in a window of its own, before the update's permission check narrows the
 * query: rows the update writes may go unread, and rows it reads may never
 * be written, or be another caller's. DatabaseService
 * .findRowsAndHoldUpdateToThem reads the rows the update writes - the ones
 * its caller may write, or the update's own window for OneUptime and a
 * master admin - and holds the update to them, so the rows checked are the
 * rows written.
 *
 * So outside DatabaseService, an update's query is only ever:
 *
 *   - narrowed in place (`updateBy.query = narrow(updateBy.query)`);
 *   - read for the one row it names by a plain id
 *     (DatabaseService.getOneRowIdNamedBy), which the write can reach alone;
 *   - read after the write, in onUpdateSuccess and onUpdateError;
 *   - or named below with the reason it is no check of rows the update may
 *     not write. The list only ever shrinks: each entry names how many
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
 * The update path itself: it reads the rows its caller may write before the
 * hooks (keepRowsCallerMayWrite), hands them to the hooks
 * (findRowsAndHoldUpdateToThem) and writes them.
 */
const UPDATE_PATH: string =
  "packages/Common/Server/Services/DatabaseService.ts";

// The source files scanned: TypeScript, not tests.
const SOURCE_FILE: RegExp = /\.tsx?$/;
const TEST_FILE: RegExp = /\.(test|spec)\.tsx?$/;

// What reads the one row a query names by its id.
const ONE_ROW_ID_READER: RegExp = /\bgetOneRowIdNamedBy$/;

// Hooks that run once the write is done: they read what was written.
const AFTER_THE_WRITE: Set<string> = new Set<string>([
  "onUpdateSuccess",
  "onUpdateError",
]);

interface Allowed {
  // How many times the function reads the update's query.
  mentions: number;
  reason: string;
}

const ALLOWED: Record<string, Allowed> = {
  "packages/Common/Server/Services/ApiKeyPermissionService.ts::onBeforeUpdate":
    {
      mentions: 1,
      reason:
        "Narrows the update by the caller's update permission first, reads the rows in the update's own window, and holds the update to them by id itself.",
    },
  "packages/Common/Server/Services/TeamPermissionService.ts::onBeforeUpdate": {
    mentions: 1,
    reason:
      "Narrows the update by the caller's update permission first, reads the rows in the update's own window, and holds the update to them by id itself.",
  },
  "packages/Common/Server/Utils/SsoProviderTeamGrant.ts::checkUpdate": {
    mentions: 1,
    reason:
      "Narrows the update by the caller's update permission first, reads the rows in the update's own window, and holds the update to them by id itself.",
  },
  "packages/Common/Server/Utils/SsoRequirementChanges.ts::rememberProjectRulesBefore":
    {
      mentions: 1,
      reason:
        "The sign-in rules as they were, for the announcement made after the write; the write is held to the projects read again under the sign-in lock (lockAndCheckProjects).",
    },
  "packages/Common/Server/Utils/SsoRequirementChanges.ts::rememberServerRuleBefore":
    {
      mentions: 1,
      reason:
        "The server's sign-in rule as it was, for the announcement made after the write; it judges nothing.",
    },
  "packages/Common/Server/Utils/SsoRequirementChanges.ts::lockAndCheckProjects":
    {
      mentions: 1,
      reason:
        "Reads the projects under the sign-in lock and holds the write to the projects it read (ProjectSsoProviderChanges.writeOnlyTheRowsRead).",
    },
  "packages/Common/Server/Utils/SsoRequirementChanges.ts::readProjectIds": {
    mentions: 1,
    reason:
      "Which projects' sign-in locks to take; the projects are read again, and the write held to them, under those locks.",
  },
  "packages/Common/Server/Utils/GlobalSsoProviderChanges.ts::beforeProviderUpdate":
    {
      mentions: 1,
      reason:
        "Reads the providers under the sign-in lock and holds the write to the providers it read (ProjectSsoProviderChanges.writeOnlyTheRowsRead).",
    },
  "packages/Common/Server/Utils/GlobalSsoProviderChanges.ts::beforeAttachmentUpdate":
    {
      mentions: 1,
      reason:
        "Reads the attachments under the sign-in lock and holds the write to the attachments it read (ProjectSsoProviderChanges.writeOnlyTheRowsRead).",
    },
  "packages/Common/Server/Services/NetworkSiteService.ts::updateBy": {
    mentions: 1,
    reason:
      "Which projects' hierarchy lock to take before the update runs; the update's hook reads, checks and holds its rows inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteService.ts::updateOneBy": {
    mentions: 1,
    reason:
      "Which projects' hierarchy lock to take before the update runs; the update's hook reads, checks and holds its row inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteTypeService.ts::updateBy": {
    mentions: 1,
    reason:
      "Which projects' hierarchy lock to take before the update runs; the update's hook reads, checks and holds its rows inside that lock.",
  },
  "packages/Common/Server/Services/NetworkSiteTypeService.ts::updateOneBy": {
    mentions: 1,
    reason:
      "Which projects' hierarchy lock to take before the update runs; the update's hook reads, checks and holds its row inside that lock.",
  },
  "packages/Common/Server/Types/Workflow/Components/BaseModel/CustomFieldsArgument.ts::queryForRecord":
    {
      mentions: 1,
      reason:
        "A workflow step's own update, composed here: each record it read is written by its own id, with the step's conditions and the version read, so every record written is one it read.",
    },
  "packages/Common/Server/Types/Workflow/Components/BaseModel/CustomFieldsArgument.ts::updateOneMergingCustomFields":
    {
      mentions: 1,
      reason:
        "Reads, with the step's own permissions, the record the step's Update One reaches, to merge its custom fields; that record is then written by its id (queryForRecord).",
    },
  "packages/Common/Server/Types/Workflow/Components/BaseModel/CustomFieldsArgument.ts::updateManyMergingCustomFields":
    {
      mentions: 1,
      reason:
        "Reads, with the step's own permissions, the records the step's Update Many reaches in its window, to merge each one's custom fields; each is then written by its own id (queryForRecord).",
    },
  "packages/Common/Server/Utils/ProjectSsoProviderChanges.ts::lockReadAndCheckRows":
    {
      mentions: 1,
      reason:
        "Reads the rows to learn which projects' sign-in locks to take, reads them again under the locks and checks them, and holds the write to the rows read (writeOnlyTheRowsRead).",
    },
  "packages/Common/Server/Utils/ProjectSsoProviderChanges.ts::writeOnlyTheRowsRead":
    {
      mentions: 1,
      reason:
        "Holds the write to the rows read under the sign-in lock: reads the query only to name those rows in it, branch by branch.",
    },
  "packages/Common/Server/Services/UserService.ts::onBeforeUpdate": {
    mentions: 1,
    reason:
      "Asks whether the query names the caller's own user (OwnerOnlyColumnPermission.isQueryPinnedToCurrentUser): what the query says, not what a row holds.",
  },
  "packages/Common/Server/Services/DomainService.ts::onBeforeUpdate": {
    mentions: 1,
    reason:
      "Asks whether the update names a project when its caller has none, to refuse it: what the query says, not what a row holds. The domains are read with findRowsAndHoldUpdateToThem.",
  },
  "packages/Common/Server/Services/TeamComplianceSettingService.ts::assertMayUpdate":
    {
      mentions: 1,
      reason:
        "Runs the update's own permission check on a copy of its query, ahead of the update path; reads no row.",
    },
  "packages/Common/Server/Utils/AnalyticsDatabase/StatementGenerator.ts::toUpdateStatement":
    {
      mentions: 1,
      reason:
        "Builds the analytics update statement: the write itself, not a check of it.",
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
 * The names an update goes by - `updateBy`, `updateOneBy`, `update`,
 * `write` - alone or as a property: `data.updateBy`, `onUpdate.updateBy`,
 * `data.write`...
 */
const UPDATE_NAMES: Set<string> = new Set<string>([
  "updateBy",
  "updateOneBy",
  "update",
  "write",
]);

function isUpdateBy(expression: ts.Expression): boolean {
  return (
    (ts.isIdentifier(expression) && UPDATE_NAMES.has(expression.text)) ||
    (ts.isPropertyAccessExpression(expression) &&
      UPDATE_NAMES.has(expression.name.text))
  );
}

// Whether a file can name an update at all (UPDATE_NAMES).
const NAMES_AN_UPDATE: RegExp = /\b(updateBy|updateOneBy|update|write)\b/;

// `<update>.query`.
function isUpdateQuery(node: ts.Node): node is ts.PropertyAccessExpression {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === "query" &&
    isUpdateBy(node.expression)
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

// `updateBy.query = ...`: the query itself, written.
function isAssigned(node: ts.PropertyAccessExpression): boolean {
  const parent: ts.Node = node.parent;

  return (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.left === node
  );
}

// Inside `updateBy.query = narrow(updateBy.query)`: narrowed in place.
function isNarrowedInPlace(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;

  while (current && !ts.isStatement(current)) {
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isUpdateQuery(current.left)
    ) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

// `getOneRowIdNamedBy(updateBy.query)`: the one row it names by id.
function isOneRowIdRead(node: ts.Node): boolean {
  const parent: ts.Node = node.parent;

  return (
    ts.isCallExpression(parent) &&
    parent.arguments.includes(node as ts.Expression) &&
    ONE_ROW_ID_READER.test(parent.expression.getText())
  );
}

function findQueryReads(): Array<QueryRead> {
  const reads: Array<QueryRead> = [];

  for (const directory of SCANNED_DIRECTORIES) {
    for (const file of sourceFiles(directory)) {
      if (file === UPDATE_PATH) {
        continue;
      }

      const text: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      if (!NAMES_AN_UPDATE.test(text)) {
        continue;
      }

      const source: ts.SourceFile = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
      );

      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (
          isUpdateQuery(node) &&
          !AFTER_THE_WRITE.has(functionNameOf(node)) &&
          !isAssigned(node) &&
          !isNarrowedInPlace(node) &&
          !isOneRowIdRead(node)
        ) {
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

describe("Hooks that judge an update by its rows read them with findRowsAndHoldUpdateToThem", () => {
  const reads: Array<QueryRead> = findQueryReads();

  it("finds the update path's own readers, so the scan reads real code", () => {
    // The listed functions read the query; a scan that sees none of them sees nothing.
    expect(reads.length).toBeGreaterThan(0);
  });

  it("reads an update's rows by its query nowhere but in the update path and the functions listed", () => {
    const unexpected: Array<string> = reads
      .filter((read: QueryRead): boolean => {
        return !ALLOWED[read.key];
      })
      .map((read: QueryRead): string => {
        return `${read.key} (line ${read.line}): ${read.text}`;
      });

    // Read them with this.findRowsAndHoldUpdateToThem(updateBy, select) instead.
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

describe("The update query readers the scan recognizes", () => {
  function readsIn(code: string): Array<string> {
    const source: ts.SourceFile = ts.createSourceFile(
      "Example.ts",
      code,
      ts.ScriptTarget.Latest,
      true,
    );
    const found: Array<string> = [];

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        isUpdateQuery(node) &&
        !AFTER_THE_WRITE.has(functionNameOf(node)) &&
        !isAssigned(node) &&
        !isNarrowedInPlace(node) &&
        !isOneRowIdRead(node)
      ) {
        found.push(functionNameOf(node));
      }

      ts.forEachChild(node, visit);
    };

    visit(source);

    return found;
  }

  it("counts a read of the update's rows by its query, whatever the update is called on", () => {
    expect(
      readsIn(`class S {
        async onBeforeUpdate(updateBy) {
          await this.findBy({ query: updateBy.query, select: {}, limit: 1, skip: 0, props: {} });
        }
        async check(data) {
          return data.service.findBy({ query: { ...data.updateBy.query }, select: {} });
        }
        async single(updateBy) {
          return this.findOneById({ id: updateBy.query._id });
        }
      }`),
    ).toEqual(["onBeforeUpdate", "check", "single"]);
  });

  it("counts it under the other names an update goes by", () => {
    expect(
      readsIn(`class S {
        async updateOneBy(updateOneBy) {
          await this.findBy({ query: updateOneBy.query, select: {} });
        }
        async step(update) {
          return this.findBy({ query: update.query, select: {} });
        }
        async lockRows(data) {
          return this.findBy({ query: data.write.query, select: {} });
        }
      }`),
    ).toEqual(["updateOneBy", "step", "lockRows"]);
  });

  it("does not count a narrowing in place, a one-row id read, or a read after the write", () => {
    expect(
      readsIn(`class S {
        async onBeforeUpdate(updateBy) {
          updateBy.query = applyFilter(updateBy.query, updateBy.props);
          updateBy.query = { ...updateBy.query, _id: ids };
          const id = Service.getOneRowIdNamedBy(updateBy.query);
          return this.findRowsAndHoldUpdateToThem(updateBy, { _id: true });
        }
        async onUpdateSuccess(onUpdate, ids) {
          return this.findBy({ query: onUpdate.updateBy.query });
        }
      }`),
    ).toEqual([]);
  });
});
