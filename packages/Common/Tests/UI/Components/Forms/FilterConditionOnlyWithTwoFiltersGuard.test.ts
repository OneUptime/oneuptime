import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";

/*
 * "All/Any appears only with two filters."
 *
 * How a rule combines its filters - All (every one must match) or Any (one
 * is enough) - is only a choice once there are two of them: with none a
 * rule matches everything, with one it matches what that filter matches,
 * whichever is picked. The rules' conditions builder asks for it from the
 * second condition on since #4252; Metrics > Settings > Pipeline Rules asked
 * before any filter existed, and now follows the same rule. Both read it
 * from one place, isFilterConditionNeeded (Common/Types/Filter/
 * FilterConditionUtil).
 *
 * This guard reads every form field in every frontend that asks for a
 * filter condition (a `field: { filterCondition: true }` with a form field
 * type) and fails unless its showIf asks isFilterConditionNeeded, or it is
 * listed below with the reason it still asks every time.
 */

// packages/Common/Tests/UI/Components/Forms -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const RULE: string = "isFilterConditionNeeded";

interface AllowedField {
  // Repository-relative, with "/".
  file: string;
  reason: string;
}

/*
 * Fields that still ask All or Any before there are two filters, and why.
 * One brought under the rule must leave this list (the guard says so).
 */
export const ASKED_EVERY_TIME_ALLOWED: Array<AllowedField> = [
  {
    file: `${DASHBOARD}/Components/Workspace/NotificationRuleForm/NotificationRuleForm.tsx`,
    reason:
      "A Slack or Microsoft Teams notification rule's Conditions step, a form of its own inside the rule's wizard. Its matcher (NotificationRuleUtil) skips a condition left without an operator and then answers differently for All and Any, so whether a rule with one condition can do without the choice is that rule's own question - left to a change of the workspace rules, which the metric pipeline task that wrote this guard did not touch.",
  },
  {
    file: `${DASHBOARD}/Components/Workspace/WorkspaceSummaryTable.tsx`,
    reason:
      "A workspace summary's Filters step. Its radio starts on neither All nor Any (the column has no default) and a summary left without one is saved as Any, so bringing it under the rule means giving the radio that default first - left to a change of the workspace forms, which the metric pipeline task that wrote this guard did not touch.",
  },
];

export interface FilterConditionField {
  file: string;
  line: number;
  // The field's showIf calls isFilterConditionNeeded.
  followsTheRule: boolean;
}

function propertyNamed(
  literal: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined {
  return literal.properties.find(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return (
        (ts.isPropertyAssignment(property) ||
          ts.isMethodDeclaration(property) ||
          ts.isShorthandPropertyAssignment(property)) &&
        property.name !== undefined &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === name
      );
    },
  );
}

// `field: { filterCondition: true }`: the one column the field selects.
function selectsFilterCondition(literal: ts.ObjectLiteralExpression): boolean {
  const field: ts.ObjectLiteralElementLike | undefined = propertyNamed(
    literal,
    "field",
  );

  if (
    !field ||
    !ts.isPropertyAssignment(field) ||
    !ts.isObjectLiteralExpression(field.initializer)
  ) {
    return false;
  }

  return field.initializer.properties.some(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return (
        ts.isPropertyAssignment(property) &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text === "filterCondition"
      );
    },
  );
}

function isFormField(
  literal: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): boolean {
  const fieldType: ts.ObjectLiteralElementLike | undefined = propertyNamed(
    literal,
    "fieldType",
  );

  return Boolean(
    fieldType &&
      ts.isPropertyAssignment(fieldType) &&
      fieldType.initializer
        .getText(sourceFile)
        .startsWith("FormFieldSchemaType."),
  );
}

function callsTheRule(node: ts.Node): boolean {
  let found: boolean = false;

  const visit: (child: ts.Node) => void = (child: ts.Node): void => {
    if (
      ts.isCallExpression(child) &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === RULE
    ) {
      found = true;
    }

    if (!found) {
      ts.forEachChild(child, visit);
    }
  };

  visit(node);

  return found;
}

/**
 * Every form field in the source that asks for a filter condition, and
 * whether its showIf follows the two-filters rule.
 */
export function findFilterConditionFields(
  file: string,
  text: string,
): Array<FilterConditionField> {
  const found: Array<FilterConditionField> = [];

  if (!text.includes("filterCondition")) {
    return found;
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isObjectLiteralExpression(node) &&
      selectsFilterCondition(node) &&
      isFormField(node, sourceFile)
    ) {
      const showIf: ts.ObjectLiteralElementLike | undefined = propertyNamed(
        node,
        "showIf",
      );

      found.push({
        file,
        line:
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1,
        followsTheRule: Boolean(showIf && callsTheRule(showIf)),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

describe("the filter condition detector", () => {
  test("finds a field asking for a filter condition with no showIf", () => {
    expect(
      findFilterConditionFields(
        "Page.tsx",
        `const fields = [{ field: { filterCondition: true }, title: "Filter Condition", fieldType: FormFieldSchemaType.RadioButton }];`,
      ),
    ).toEqual([{ file: "Page.tsx", line: 1, followsTheRule: false }]);
  });

  test("passes one whose showIf asks the rule, however it is written", () => {
    expect(
      findFilterConditionFields(
        "Page.tsx",
        `const fields = [
          { field: { filterCondition: true }, fieldType: FormFieldSchemaType.RadioButton, showIf: (values) => isFilterConditionNeeded(values.filters) },
          { field: { filterCondition: true }, fieldType: FormFieldSchemaType.RadioButton, showIf: (values) => { return Boolean(values.on) && isFilterConditionNeeded(values.filters); } },
        ];`,
      ).map((field: FilterConditionField): boolean => {
        return field.followsTheRule;
      }),
    ).toEqual([true, true]);
  });

  test("does not take a showIf about something else for the rule", () => {
    expect(
      findFilterConditionFields(
        "Page.tsx",
        `const fields = [{ field: { filterCondition: true }, fieldType: FormFieldSchemaType.RadioButton, showIf: (values) => values.filters.length > 0 }];`,
      )[0]?.followsTheRule,
    ).toBe(false);
  });

  test("leaves alone what is not a form field: table columns, filters, models", () => {
    expect(
      findFilterConditionFields(
        "Page.tsx",
        `
          const column = { field: { filterCondition: true }, type: FieldType.Text, title: "Filter Condition" };
          const select = { filterCondition: true, filters: true };
          const rule = { filterCondition: FilterCondition.All, filters: [] };`,
      ),
    ).toEqual([]);
  });
});

describe("the project's filter condition fields", () => {
  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const fields: Array<FilterConditionField> = files.flatMap(
    (file: string): Array<FilterConditionField> => {
      return findFilterConditionFields(
        path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/"),
        fs.readFileSync(file, "utf8"),
      );
    },
  );

  const allowed: Set<string> = new Set<string>(
    ASKED_EVERY_TIME_ALLOWED.map((entry: AllowedField): string => {
      return entry.file;
    }),
  );

  test("are really read, the metric pipeline rule's among them", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(
      fields.filter((field: FilterConditionField): boolean => {
        return (
          field.file === `${DASHBOARD}/Pages/Metrics/Settings/PipelineRules.tsx`
        );
      }),
    ).toEqual([
      expect.objectContaining({
        followsTheRule: true,
      }),
    ]);
  });

  test("ask for All or Any only once there are two filters, or are listed with the reason", () => {
    expect(
      fields
        .filter((field: FilterConditionField): boolean => {
          return !field.followsTheRule && !allowed.has(field.file);
        })
        .map((field: FilterConditionField): string => {
          return `${field.file}:${field.line} asks for a filter condition before there are two filters - add showIf: (values) => ${RULE}(values.filters)`;
        }),
    ).toEqual([]);
  });

  test("listed as asking every time still do, so the list never goes stale", () => {
    for (const entry of ASKED_EVERY_TIME_ALLOWED) {
      expect(entry.reason.length).toBeGreaterThan(60);
      expect({
        file: entry.file,
        stillAsksEveryTime: fields.some(
          (field: FilterConditionField): boolean => {
            return field.file === entry.file && !field.followsTheRule;
          },
        ),
      }).toEqual({ file: entry.file, stillAsksEveryTime: true });
    }
  });

  /*
   * The conditions builder every rule page draws (RuleCriteriaModelForm)
   * draws its own Match all / Match any, not as a form field: it reads the
   * same rule.
   */
  test("include the rules' conditions builder, which reads the same rule", () => {
    const builder: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/Common/UI/Components/RuleCriteria/RuleCriteriaBuilder.tsx",
      ),
      "utf8",
    );

    expect(builder).toContain(`${RULE}(criteria.filters) && (`);
    expect(builder).not.toContain("criteria.filters.length > 1");
  });
});
