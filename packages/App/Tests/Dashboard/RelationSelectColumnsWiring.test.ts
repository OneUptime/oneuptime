import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import TableColumnType from "Common/Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A select that reaches through a relation is checked against the RELATED
 * model, not the one being queried, and the check is all-or-nothing:
 *
 *   QueryPermission.checkRelationQueryPermission walks every inner key of
 *   `select: { someRelation: { ... } }` and THROWS on the first one whose
 *   column lacks canReadOnRelationQuery. It does not drop the key and carry on.
 *
 * So a single unflagged column fails the whole request, for every caller, at
 * any permission level. That is how the escalation rule page broke: it added
 * `currentUserIdOnRoster` next to `name` in the schedule join, the model had no
 * flag on that column, and the page stopped loading entirely with
 *
 *   Column currentUserIdOnRoster on On-Call Policy Schedule does not
 *   support read on relation query.
 *
 * Nothing catches this at compile time. `Select<TBaseModel>` is typed from the
 * model's fields, so every column is spellable in a relation select and only
 * the runtime knows which ones are actually reachable - which means the first
 * report comes from a user with a blank page, as it did here.
 *
 * This test closes that gap. It parses the sources for the call shape that
 * carries both a `modelType` and a `select`, walks each nested relation, and
 * resolves the inner columns against the model metadata the server will use.
 *
 * WHAT IT DOES NOT COVER. Only literal `modelType: X` / `select: { ... }` pairs
 * in one object are matched. A select built in a variable, spread in, or
 * assembled conditionally is invisible here, as is any call that names its
 * model somewhere other than a `modelType` property. The count assertion at the
 * bottom guards the parse itself: if a refactor moves the call shape, this file
 * fails rather than quietly checking nothing.
 */

const REPO_ROOT: string = path.join(__dirname, "..", "..", "..");

const MODEL_DIR: string = path.join(
  REPO_ROOT,
  "Common",
  "Models",
  "DatabaseModels",
);

// Mirrors ColumnPermissions.getExcludedColumnNames().
const EXCLUDED_COLUMN_NAMES: Array<string> = [
  "_id",
  "createdAt",
  "deletedAt",
  "updatedAt",
  "version",
];

const SCAN_DIRECTORIES: Array<string> = [
  path.join(REPO_ROOT, "App"),
  path.join(REPO_ROOT, "Common", "UI"),
  path.join(REPO_ROOT, "Common", "Server"),
  path.join(REPO_ROOT, "Common", "Utils"),
];

/*
 * Test trees are skipped along with build output: a test asserting that a bad
 * select is refused has to spell out a bad select, and that is not a call site
 * anybody will make. Only production query sites are checked. No test declared
 * one either way when this was written, so nothing is lost by excluding them.
 */
const SKIP_DIRECTORY_NAMES: Array<string> = [
  "node_modules",
  "dist",
  "build",
  ".git",
  "Tests",
  "__tests__",
];

const SOURCE_FILE_PATTERN: RegExp = new RegExp("\\.(ts|tsx)$");
const TSX_FILE_PATTERN: RegExp = new RegExp("\\.tsx$");
const MODEL_FILE_SUFFIX_PATTERN: RegExp = new RegExp("\\.ts$");

interface RelationSelectSite {
  file: string;
  line: number;
  modelName: string;
  relation: string;
  column: string;
}

function listModelNames(): Set<string> {
  return new Set(
    fs
      .readdirSync(MODEL_DIR)
      .filter((fileName: string) => {
        return fileName.endsWith(".ts") && fileName !== "Index.ts";
      })
      .map((fileName: string) => {
        return fileName.replace(MODEL_FILE_SUFFIX_PATTERN, "");
      }),
  );
}

function listSourceFiles(directory: string, out: Array<string> = []): string[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRECTORY_NAMES.includes(entry.name)) {
      continue;
    }

    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      listSourceFiles(entryPath, out);
    } else if (SOURCE_FILE_PATTERN.test(entry.name)) {
      out.push(entryPath);
    }
  }

  return out;
}

function readObjectProperties(
  node: ts.ObjectLiteralExpression,
): Map<string, ts.Expression> {
  const properties: Map<string, ts.Expression> = new Map();

  for (const property of node.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ) {
      properties.set(property.name.text, property.initializer);
    }
  }

  return properties;
}

function collectRelationSelectSites(): Array<RelationSelectSite> {
  const modelNames: Set<string> = listModelNames();
  const sites: Array<RelationSelectSite> = [];

  for (const directory of SCAN_DIRECTORIES) {
    if (!fs.existsSync(directory)) {
      continue;
    }

    for (const filePath of listSourceFiles(directory)) {
      const sourceFile: ts.SourceFile = ts.createSourceFile(
        filePath,
        fs.readFileSync(filePath, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        TSX_FILE_PATTERN.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );

      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (ts.isObjectLiteralExpression(node)) {
          const properties: Map<string, ts.Expression> =
            readObjectProperties(node);
          const modelTypeExpression: ts.Expression | undefined =
            properties.get("modelType");
          const selectExpression: ts.Expression | undefined =
            properties.get("select");

          if (
            modelTypeExpression &&
            selectExpression &&
            ts.isIdentifier(modelTypeExpression) &&
            ts.isObjectLiteralExpression(selectExpression) &&
            modelNames.has(modelTypeExpression.text)
          ) {
            for (const [key, value] of readObjectProperties(selectExpression)) {
              // A nested object literal is a select through a relation.
              if (!ts.isObjectLiteralExpression(value)) {
                continue;
              }

              const { line } = sourceFile.getLineAndCharacterOfPosition(
                value.getStart(),
              );

              for (const [innerKey] of readObjectProperties(value)) {
                sites.push({
                  file: path.relative(REPO_ROOT, filePath),
                  line: line + 1,
                  modelName: modelTypeExpression.text,
                  relation: key,
                  column: innerKey,
                });
              }
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    }
  }

  return sites;
}

/*
 * Only the models a relation select actually names are loaded, rather than the
 * whole DatabaseModels index - a few dozen instead of several hundred, which is
 * the difference between this file costing seconds and costing a minute.
 */
async function loadModel(modelName: string): Promise<BaseModel | null> {
  try {
    const imported: { default: { new (): BaseModel } } = await import(
      path.join(MODEL_DIR, modelName)
    );

    return new imported.default();
  } catch {
    return null;
  }
}

interface ScanResult {
  sites: Array<RelationSelectSite>;
  checkedCount: number;
  violations: Array<string>;
}

/*
 * Parsing the tree and instantiating the models costs a few seconds, and every
 * assertion below wants the same answer. Do it once, on first use.
 */
let cachedResult: ScanResult | null = null;

async function scan(): Promise<ScanResult> {
  if (cachedResult) {
    return cachedResult;
  }

  const sites: Array<RelationSelectSite> = collectRelationSelectSites();
  const modelCache: Map<string, BaseModel | null> = new Map();
  const violations: Array<string> = [];
  let checkedCount: number = 0;

  const modelFor: (name: string) => Promise<BaseModel | null> = async (
    name: string,
  ): Promise<BaseModel | null> => {
    if (!modelCache.has(name)) {
      modelCache.set(name, await loadModel(name));
    }

    return modelCache.get(name) ?? null;
  };

  for (const site of sites) {
    const outerModel: BaseModel | null = await modelFor(site.modelName);

    if (!outerModel) {
      continue;
    }

    let relationMetadata: TableColumnMetadata | undefined = undefined;

    try {
      relationMetadata = outerModel.getTableColumnMetadata(site.relation);
    } catch {
      continue;
    }

    /*
     * Not every nested object under a select is a relation - `select` also
     * carries shapes the permission layer never walks. Only Entity and
     * EntityArray columns reach checkRelationQueryPermission's inner loop.
     */
    if (
      !relationMetadata ||
      !relationMetadata.modelType ||
      (relationMetadata.type !== TableColumnType.Entity &&
        relationMetadata.type !== TableColumnType.EntityArray)
    ) {
      continue;
    }

    const relatedModel: BaseModel = new relationMetadata.modelType();
    const columnMetadata: TableColumnMetadata =
      relatedModel.getTableColumnMetadata(site.column);

    checkedCount++;

    if (!columnMetadata) {
      violations.push(
        `${site.file}:${site.line} - ${site.modelName}.${site.relation} selects ` +
          `"${site.column}", which is not a column on ${relatedModel.singularName}.`,
      );
      continue;
    }

    if (
      !columnMetadata.canReadOnRelationQuery &&
      !EXCLUDED_COLUMN_NAMES.includes(site.column)
    ) {
      violations.push(
        `${site.file}:${site.line} - ${site.modelName}.${site.relation} selects ` +
          `${relatedModel.singularName}.${site.column}, but that column has no ` +
          `canReadOnRelationQuery. The read throws "Column ${site.column} on ` +
          `${relatedModel.singularName} does not support read on relation query." ` +
          `Add canReadOnRelationQuery to the column, or stop selecting it here.`,
      );
    }
  }

  cachedResult = {
    sites: sites,
    checkedCount: checkedCount,
    violations: Array.from(new Set(violations)).sort(),
  };

  return cachedResult;
}

describe("relation selects only name columns the permission layer allows", () => {
  test("every relation-selected column is readable through the relation", async () => {
    expect((await scan()).violations).toEqual([]);
  });

  test("the scan actually found relation selects to check", async () => {
    /*
     * Guards the assertion above against passing because the parse found
     * nothing. The repo had well over two hundred checkable relation columns
     * when this was written; a floor well under that still catches a scan that
     * has silently stopped matching the call shape.
     */
    const result: ScanResult = await scan();

    expect(result.sites.length).toBeGreaterThan(100);
    expect(result.checkedCount).toBeGreaterThan(100);
  });

  test("the escalation rule schedule join is one of the sites covered", async () => {
    /*
     * The select that caused the original report. Naming it here means that
     * deleting the component, or restructuring its query into a shape the
     * parse cannot see, shows up as a failure rather than as silent loss of
     * coverage over the exact regression this file exists for.
     */
    const rosterSites: Array<RelationSelectSite> = (await scan()).sites.filter(
      (site: RelationSelectSite) => {
        return (
          site.modelName === "OnCallDutyPolicyEscalationRuleSchedule" &&
          site.relation === "onCallDutyPolicySchedule" &&
          site.column === "currentUserIdOnRoster"
        );
      },
    );

    expect(rosterSites.length).toBeGreaterThan(0);
  });
});
