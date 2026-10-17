import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import { RULE_CRITERIA_MODELS_NAMED_BY_THEIR_TABLE } from "../../../../Types/Rules/RuleCriteriaSubject";

/*
 * A rule's conditions step asks "All incidents" or "Only incidents that
 * match conditions" in the words of its records. Most rule models name their
 * own (RULE_CRITERIA_SUBJECT_BY_MODEL); a table of rules about several kinds
 * of record - AI investigation, auto remediation and runbook rules, one
 * table per kind - must say which it lists, or its form falls back to
 * "Everything" / "Only what matches conditions". Every Dashboard table of
 * such a model passes ruleCriteriaSubject.
 */

const DASHBOARD_SOURCE_ROOT: string = path.join(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src",
);

const TABLE_TAGS: ReadonlyArray<string> = [
  "ModelTable",
  "RuleTable",
  "LabelRuleTable",
  "OwnerRuleTable",
];

function listTsxFiles(directory: string): Array<string> {
  const result: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      result.push(...listTsxFiles(entryPath));
    } else if (entry.name.endsWith(".tsx")) {
      result.push(entryPath);
    }
  }

  return result;
}

interface RuleTableUse {
  file: string;
  model: string;
  hasSubject: boolean;
}

function tagName(
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile,
): string {
  return node.tagName.getText(sourceFile).split(".").pop() || "";
}

function findRuleTableUses(file: string): Array<RuleTableUse> {
  const source: string = fs.readFileSync(file, "utf8");
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const uses: Array<RuleTableUse> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      TABLE_TAGS.includes(tagName(node, sourceFile))
    ) {
      let model: string | null = null;
      let hasSubject: boolean = false;

      for (const property of node.attributes.properties) {
        if (!ts.isJsxAttribute(property)) {
          continue;
        }

        const name: string = property.name.getText(sourceFile);

        if (name === "ruleCriteriaSubject") {
          hasSubject = true;
        }

        if (
          name === "modelType" &&
          property.initializer &&
          ts.isJsxExpression(property.initializer) &&
          property.initializer.expression
        ) {
          model = property.initializer.expression.getText(sourceFile);
        }
      }

      if (
        model &&
        (
          RULE_CRITERIA_MODELS_NAMED_BY_THEIR_TABLE as ReadonlyArray<string>
        ).includes(model)
      ) {
        uses.push({
          file: path.relative(DASHBOARD_SOURCE_ROOT, file),
          model: model,
          hasSubject: hasSubject,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return uses;
}

const USES: Array<RuleTableUse> = listTsxFiles(DASHBOARD_SOURCE_ROOT).flatMap(
  findRuleTableUses,
);

describe("tables of rules about several kinds of record", () => {
  test("are found, one table at least for each such model", () => {
    for (const model of RULE_CRITERIA_MODELS_NAMED_BY_THEIR_TABLE) {
      expect({
        model,
        tables:
          USES.filter((use: RuleTableUse): boolean => {
            return use.model === model;
          }).length > 0,
      }).toEqual({ model, tables: true });
    }
  });

  test("say which records they list: 'All incidents', never 'Everything'", () => {
    const silent: Array<string> = USES.filter((use: RuleTableUse): boolean => {
      return !use.hasSubject;
    }).map((use: RuleTableUse): string => {
      return `${use.file}: <… modelType={${use.model}}> without ruleCriteriaSubject`;
    });

    expect(silent).toEqual([]);
  });
});
