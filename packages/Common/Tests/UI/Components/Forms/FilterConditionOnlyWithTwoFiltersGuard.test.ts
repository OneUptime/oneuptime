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
 * second condition on since #4252; Metrics > Settings > Pipeline Rules
 * since #4379; a workspace notification rule's Conditions step, a workspace
 * summary's Filters step and a monitor criteria's filters since this guard
 * learned to read controls too. All of them read it from one place,
 * isFilterConditionNeeded (Common/Types/Filter/FilterConditionUtil).
 *
 * This guard reads every frontend for the two ways a screen asks for a
 * filter condition, and fails unless each follows the rule:
 *
 *   - a form field (`field: { filterCondition: true }` with a form field
 *     type), whose showIf must ask isFilterConditionNeeded;
 *   - a control drawn by hand - a <Radio>, an <input type="radio">, any JSX
 *     element - whose onChange writes `filterCondition`, which must sit
 *     inside `isFilterConditionNeeded(...) && ...` or a ternary on it.
 *
 * A screen that still asks every time has to be listed below with the
 * reason, and leaves the list once it follows the rule (the guard says so).
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

const FILTER_CONDITION: string = "filterCondition";

interface AllowedField {
  // Repository-relative, with "/".
  file: string;
  reason: string;
}

/*
 * Screens that still ask All or Any before there are two filters, and why.
 * One brought under the rule must leave this list (the guard says so). The
 * workspace notification rule and summary forms were here until they
 * followed the rule.
 */
export const ASKED_EVERY_TIME_ALLOWED: Array<AllowedField> = [];

export interface FilterConditionField {
  file: string;
  line: number;
  // The field's showIf calls isFilterConditionNeeded.
  followsTheRule: boolean;
}

export interface FilterConditionControl {
  file: string;
  line: number;
  // The element's tag: "Radio", "input".
  tag: string;
  // It is drawn only where isFilterConditionNeeded says so.
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
        property.name.text === FILTER_CONDITION
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

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function lineOf(node: ts.Node, sourceFile: ts.SourceFile): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
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

  if (!text.includes(FILTER_CONDITION)) {
    return found;
  }

  const sourceFile: ts.SourceFile = parse(file, text);

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
        line: lineOf(node, sourceFile),
        followsTheRule: Boolean(showIf && callsTheRule(showIf)),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

/*
 * The title of every form field in the source that asks for a filter
 * condition, as written (a string literal), or "" when it is computed.
 */
export function findFilterConditionFieldTitles(
  file: string,
  text: string,
): Array<string> {
  const titles: Array<string> = [];

  if (!text.includes(FILTER_CONDITION)) {
    return titles;
  }

  const sourceFile: ts.SourceFile = parse(file, text);

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isObjectLiteralExpression(node) &&
      selectsFilterCondition(node) &&
      isFormField(node, sourceFile)
    ) {
      const title: ts.ObjectLiteralElementLike | undefined = propertyNamed(
        node,
        "title",
      );

      titles.push(
        title &&
          ts.isPropertyAssignment(title) &&
          ts.isStringLiteral(title.initializer)
          ? title.initializer.text
          : "",
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return titles;
}

// Whether the code writes a filter condition: `{ filterCondition: ... }`.
function writesFilterCondition(node: ts.Node): boolean {
  let found: boolean = false;

  const visit: (child: ts.Node) => void = (child: ts.Node): void => {
    if (
      (ts.isPropertyAssignment(child) ||
        ts.isShorthandPropertyAssignment(child)) &&
      (ts.isIdentifier(child.name) || ts.isStringLiteral(child.name)) &&
      child.name.text === FILTER_CONDITION
    ) {
      found = true;
    }

    // `rule.filterCondition = ...` and `setFilterCondition(...)` too.
    if (
      ts.isBinaryExpression(child) &&
      child.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(child.left) &&
      child.left.name.text === FILTER_CONDITION
    ) {
      found = true;
    }

    if (
      ts.isCallExpression(child) &&
      ts.isPropertyAccessExpression(child.expression) &&
      child.expression.name.text === "setFilterCondition"
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

/*
 * Whether a JSX element is drawn only where the rule says: inside
 * `isFilterConditionNeeded(...) && (...)`, or the true branch of
 * `isFilterConditionNeeded(...) ? (...) : ...`, at any depth.
 */
function isDrawnOnlyWhereTheRuleSays(node: ts.Node): boolean {
  let child: ts.Node = node;
  let parent: ts.Node | undefined = node.parent;

  while (parent) {
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      parent.right === child &&
      callsTheRule(parent.left)
    ) {
      return true;
    }

    if (
      ts.isConditionalExpression(parent) &&
      parent.whenTrue === child &&
      callsTheRule(parent.condition)
    ) {
      return true;
    }

    child = parent;
    parent = parent.parent;
  }

  return false;
}

function tagNameOf(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  sourceFile: ts.SourceFile,
): string {
  return element.tagName.getText(sourceFile);
}

/**
 * Every JSX control in the source whose onChange writes a filter condition,
 * and whether it is drawn only once there are two filters.
 */
export function findFilterConditionControls(
  file: string,
  text: string,
): Array<FilterConditionControl> {
  const found: Array<FilterConditionControl> = [];

  if (!file.endsWith(".tsx") || !text.includes(FILTER_CONDITION)) {
    return found;
  }

  const sourceFile: ts.SourceFile = parse(file, text);

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const onChange: ts.JsxAttributeLike | undefined =
        node.attributes.properties.find(
          (attribute: ts.JsxAttributeLike): boolean => {
            return (
              ts.isJsxAttribute(attribute) &&
              attribute.name.getText(sourceFile) === "onChange"
            );
          },
        );

      if (
        onChange &&
        ts.isJsxAttribute(onChange) &&
        onChange.initializer &&
        writesFilterCondition(onChange.initializer)
      ) {
        found.push({
          file,
          line: lineOf(node, sourceFile),
          tag: tagNameOf(node, sourceFile),
          followsTheRule: isDrawnOnlyWhereTheRuleSays(
            ts.isJsxOpeningElement(node) ? node.parent : node,
          ),
        });
      }
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

describe("the filter condition control detector", () => {
  test("finds a Radio that writes a filter condition, drawn every time", () => {
    expect(
      findFilterConditionControls(
        "Criteria.tsx",
        `const a = (<div>
          <Radio value={x} onChange={(value) => { change({ filterCondition: value }); }} />
        </div>);`,
      ),
    ).toEqual([
      { file: "Criteria.tsx", line: 2, tag: "Radio", followsTheRule: false },
    ]);
  });

  test("passes one drawn inside the rule's && or the true side of its ternary", () => {
    expect(
      findFilterConditionControls(
        "Criteria.tsx",
        `const a = (<div>
          {isFilterConditionNeeded(filters) && (
            <div><Radio onChange={(value) => { change({ filterCondition: value }); }} /></div>
          )}
          {isFilterConditionNeeded(filters) ? (
            <input type="radio" onChange={() => { rule.filterCondition = FilterCondition.Any; }} />
          ) : null}
        </div>);`,
      ).map((control: FilterConditionControl): [string, boolean] => {
        return [control.tag, control.followsTheRule];
      }),
    ).toEqual([
      ["Radio", true],
      ["input", true],
    ]);
  });

  test("does not take the false side of the ternary, or another condition, for the rule", () => {
    expect(
      findFilterConditionControls(
        "Criteria.tsx",
        `const a = (<div>
          {isFilterConditionNeeded(filters) ? null : (
            <Radio onChange={(value) => { instance.setFilterCondition(value); }} />
          )}
          {filters.length > 0 && (
            <Radio onChange={(value) => { change({ filterCondition: value }); }} />
          )}
        </div>);`,
      ).map((control: FilterConditionControl): boolean => {
        return control.followsTheRule;
      }),
    ).toEqual([false, false]);
  });

  test("leaves alone controls that only read a filter condition, and plain .ts files", () => {
    expect(
      findFilterConditionControls(
        "Criteria.tsx",
        `const a = (<CriteriaFilters filterCondition={x} onChange={(value) => { change({ filters: value }); }} />);`,
      ),
    ).toEqual([]);
    expect(
      findFilterConditionControls(
        "Criteria.ts",
        `const a = { onChange: () => ({ filterCondition: 1 }) };`,
      ),
    ).toEqual([]);
  });
});

describe("the project's filter condition fields and controls", () => {
  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const sources: Array<{ file: string; text: string }> = files.map(
    (file: string): { file: string; text: string } => {
      return {
        file: path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/"),
        text: fs.readFileSync(file, "utf8"),
      };
    },
  );

  const fields: Array<FilterConditionField> = sources.flatMap(
    (source: { file: string; text: string }): Array<FilterConditionField> => {
      return findFilterConditionFields(source.file, source.text);
    },
  );

  const controls: Array<FilterConditionControl> = sources.flatMap(
    (source: { file: string; text: string }): Array<FilterConditionControl> => {
      return findFilterConditionControls(source.file, source.text);
    },
  );

  const allowed: Set<string> = new Set<string>(
    ASKED_EVERY_TIME_ALLOWED.map((entry: AllowedField): string => {
      return entry.file;
    }),
  );

  test("are really read, every form that asks among them", () => {
    expect(files.length).toBeGreaterThan(2000);

    const fieldFiles: Array<string> = fields.map(
      (field: FilterConditionField): string => {
        return field.file;
      },
    );

    for (const file of [
      `${DASHBOARD}/Pages/Metrics/Settings/PipelineRules.tsx`,
      `${DASHBOARD}/Components/Workspace/NotificationRuleForm/NotificationRuleForm.tsx`,
      `${DASHBOARD}/Components/Workspace/WorkspaceSummaryTable.tsx`,
    ]) {
      expect(fieldFiles).toContain(file);
    }

    expect(
      controls.map((control: FilterConditionControl): string => {
        return `${control.file} <${control.tag}>`;
      }),
    ).toEqual(
      expect.arrayContaining([
        `${DASHBOARD}/Components/Form/Monitor/MonitorCriteriaInstance.tsx <Radio>`,
        "packages/Common/UI/Components/RuleCriteria/RuleCriteriaBuilder.tsx <input>",
      ]),
    );
  });

  /*
   * One name for the one choice, wherever a form asks it: Match Condition.
   * Most forms called it "Filter Condition" - the name each filter's own
   * operator goes by on the same form.
   */
  test("are all titled Match Condition", () => {
    const titles: Array<string> = sources.flatMap(
      (source: { file: string; text: string }): Array<string> => {
        return findFilterConditionFieldTitles(source.file, source.text);
      },
    );

    expect(titles.length).toBeGreaterThanOrEqual(3);
    expect(
      titles.filter((title: string): boolean => {
        return title !== "Match Condition";
      }),
    ).toEqual([]);
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

  test("draw an All or Any control only once there are two filters, or are listed with the reason", () => {
    expect(
      controls
        .filter((control: FilterConditionControl): boolean => {
          return !control.followsTheRule && !allowed.has(control.file);
        })
        .map((control: FilterConditionControl): string => {
          return `${control.file}:${control.line} draws <${control.tag}> for a filter condition before there are two filters - draw it inside {${RULE}(filters) && (...)}`;
        }),
    ).toEqual([]);
  });

  test("listed as asking every time still do, so the list never goes stale", () => {
    for (const entry of ASKED_EVERY_TIME_ALLOWED) {
      expect(entry.reason.length).toBeGreaterThan(60);
      expect({
        file: entry.file,
        stillAsksEveryTime:
          fields.some((field: FilterConditionField): boolean => {
            return field.file === entry.file && !field.followsTheRule;
          }) ||
          controls.some((control: FilterConditionControl): boolean => {
            return control.file === entry.file && !control.followsTheRule;
          }),
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
