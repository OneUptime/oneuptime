import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * "We have some items in the More menu that don't have an icon. Can you
 * please add icons to them as well? Please audit the entire app, check
 * everything, and add icons to this More menu. It is basically the actions
 * column More menu of the model table."
 *
 * A table row shows one action as a button and puts the rest in a ⋯ menu,
 * and which actions go in the menu is only decided per row. "Show ID" went
 * in as a bare label above a red "Delete" with its bin - and so did View,
 * Edit, 32 actions pages added themselves, and "Add in Bulk" in the card
 * header's ⋯ menu of six status page tables. Every item has an icon now, and
 * this keeps it that way. It reads the TypeScript of Common's UI, every
 * feature set of the App (Dashboard, Admin Dashboard, Status Page, Accounts,
 * Public Dashboard, ...) and the enterprise dashboards, and fails on:
 *
 *   1. a row action or bulk action (an object with a `buttonStyleType`)
 *      without an `icon`, or with one that can be undefined;
 *   2. a card button cast `as CardButtonSchema` without an `icon` - a cast is
 *      how "Add in Bulk" hid its missing icon from the compiler;
 *   3. a <MoreMenuItem> with nothing in its icon slot: no `icon`, no `color`
 *      (a state's colour dot) and no `iconElement` (a heading's "H1"). An
 *      item whose icon is only sometimes there - a picker's tick on the
 *      choice in use - keeps the icon's space for the others;
 *   4. "Show ID" (and "Show group ID") wearing anything but the ID card -
 *      the info circle it wore on the status page's resource lists could
 *      not be told from the "!" circle of "View Status Message" and "View
 *      Error", which share its menus;
 *   5. ActionButtonSchema, BulkActionButtonSchema or CardButtonSchema making
 *      `icon` optional again - the compiler is the first line of this rule.
 *
 * The rendered menus are tested in Common/Tests/UI/Components (RowActions,
 * BaseModelTableMenuIcons).
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..");
const REPOSITORY_DIR: string = path.resolve(PACKAGES_DIR, "..");

const SCAN_DIRS: Array<string> = [
  path.join(PACKAGES_DIR, "Common", "UI"),
  path.join(PACKAGES_DIR, "App", "FeatureSet"),
  path.join(REPOSITORY_DIR, "ee", "Dashboard"),
  path.join(REPOSITORY_DIR, "ee", "AdminDashboard"),
];

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Locales",
];

// Cheap first pass: only files that could hold one of these are parsed.
const MENTION: RegExp = /buttonStyleType|MoreMenuItem|CardButtonSchema/;

// The icon "Show ID" wears in every menu: an ID card.
const SHOW_ID_ICON: string = "IconProp.Identification";

// "Show ID", "Show group ID": showing a record's ID.
const SHOW_ID_LABEL: RegExp = /^Show (\w+ )?ID$/;

function isShowIdLabel(text: string): boolean {
  return SHOW_ID_LABEL.test(text.replace(/^tx\(|\)$/g, "").replace(/"/g, ""));
}

interface Finding {
  file: string;
  line: number;
  text: string;
}

interface ParsedFile {
  // Relative to the repository root, with forward slashes.
  file: string;
  source: ts.SourceFile;
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.includes(entry.name)) {
        continue;
      }

      files.push(...listSourceFiles(fullPath));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.includes(".test.")
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

function relative(file: string): string {
  return path.relative(REPOSITORY_DIR, file).split(path.sep).join("/");
}

const PARSED: Array<ParsedFile> = SCAN_DIRS.flatMap(
  (directory: string): Array<string> => {
    return listSourceFiles(directory);
  },
)
  .filter((file: string): boolean => {
    return MENTION.test(fs.readFileSync(file, "utf8"));
  })
  .map((file: string): ParsedFile => {
    return {
      file: relative(file),
      source: ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ),
    };
  });

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node) => {
    visit(child, onNode);
  });
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 120);
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (
    property.name &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
  ) {
    return property.name.text;
  }

  return null;
}

function findProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((property: ts.ObjectLiteralElementLike) => {
    return propertyName(property) === name;
  });
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

// Whether an icon expression can come out undefined (or null).
function canBeMissing(expression: ts.Expression): boolean {
  const value: ts.Expression = unwrap(expression);

  if (
    (ts.isIdentifier(value) && value.text === "undefined") ||
    value.kind === ts.SyntaxKind.NullKeyword ||
    value.kind === ts.SyntaxKind.VoidExpression
  ) {
    return true;
  }

  if (ts.isConditionalExpression(value)) {
    return canBeMissing(value.whenTrue) || canBeMissing(value.whenFalse);
  }

  if (
    ts.isBinaryExpression(value) &&
    (value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    // `a && b` can be a falsy `a`; `a || b` / `a ?? b` are as safe as `b`.
    if (value.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return true;
    }

    return canBeMissing(value.right);
  }

  return false;
}

interface IconProblem {
  file: string;
  line: number;
  text: string;
  problem: string;
}

// Every object literal with a `buttonStyleType`: a row action or a bulk action.
function findActionObjects(): Array<{
  parsed: ParsedFile;
  node: ts.ObjectLiteralExpression;
}> {
  const found: Array<{ parsed: ParsedFile; node: ts.ObjectLiteralExpression }> =
    [];

  for (const parsed of PARSED) {
    visit(parsed.source, (node: ts.Node) => {
      if (
        ts.isObjectLiteralExpression(node) &&
        findProperty(node, "buttonStyleType")
      ) {
        found.push({ parsed, node });
      }
    });
  }

  return found;
}

function iconProblemOfObject(
  object: ts.ObjectLiteralExpression,
): string | null {
  const icon: ts.ObjectLiteralElementLike | undefined = findProperty(
    object,
    "icon",
  );

  if (!icon) {
    /*
     * `{ ...action, disabled: true }` keeps the icon of the action it
     * spreads, and the compiler holds that action to the required icon.
     */
    const spreads: boolean = object.properties.some(
      (property: ts.ObjectLiteralElementLike) => {
        return ts.isSpreadAssignment(property);
      },
    );

    return spreads ? null : "has no icon";
  }

  if (ts.isShorthandPropertyAssignment(icon)) {
    return null;
  }

  if (ts.isPropertyAssignment(icon) && canBeMissing(icon.initializer)) {
    return `has an icon that can be missing: ${compact(
      icon.initializer.getText(),
    )}`;
  }

  return null;
}

function titleOf(object: ts.ObjectLiteralExpression): string {
  const title: ts.ObjectLiteralElementLike | undefined = findProperty(
    object,
    "title",
  );

  if (title && ts.isPropertyAssignment(title)) {
    return compact(title.initializer.getText());
  }

  return compact(object.getText());
}

interface JsxElementLike {
  parsed: ParsedFile;
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement;
}

function findMoreMenuItems(): Array<JsxElementLike> {
  const found: Array<JsxElementLike> = [];

  for (const parsed of PARSED) {
    visit(parsed.source, (node: ts.Node) => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(parsed.source) === "MoreMenuItem"
      ) {
        found.push({ parsed, node });
      }
    });
  }

  return found;
}

function jsxAttribute(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  name: string,
): ts.JsxAttribute | undefined {
  return element.attributes.properties.find(
    (attribute: ts.JsxAttributeLike): attribute is ts.JsxAttribute => {
      return ts.isJsxAttribute(attribute) && attribute.name.getText() === name;
    },
  );
}

function jsxAttributeValue(
  attribute: ts.JsxAttribute | undefined,
): ts.Expression | null {
  if (
    attribute &&
    attribute.initializer &&
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression
  ) {
    return attribute.initializer.expression;
  }

  return null;
}

function jsxAttributeText(attribute: ts.JsxAttribute | undefined): string {
  if (!attribute || !attribute.initializer) {
    return "";
  }

  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text;
  }

  const value: ts.Expression | null = jsxAttributeValue(attribute);

  return value ? value.getText() : "";
}

function isTrueAttribute(attribute: ts.JsxAttribute | undefined): boolean {
  if (!attribute) {
    return false;
  }

  // A bare `isIconSpaceReserved`, or `isIconSpaceReserved={true}`.
  if (!attribute.initializer) {
    return true;
  }

  const value: ts.Expression | null = jsxAttributeValue(attribute);

  return Boolean(value && value.kind === ts.SyntaxKind.TrueKeyword);
}

function moreMenuItemProblem(
  element: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): string | null {
  const hasSpread: boolean = element.attributes.properties.some(
    (attribute: ts.JsxAttributeLike) => {
      return ts.isJsxSpreadAttribute(attribute);
    },
  );
  const icon: ts.JsxAttribute | undefined = jsxAttribute(element, "icon");
  const color: ts.JsxAttribute | undefined = jsxAttribute(element, "color");
  const iconElement: ts.JsxAttribute | undefined = jsxAttribute(
    element,
    "iconElement",
  );

  if (!icon && !color && !iconElement) {
    return hasSpread ? null : "has no icon, colour or mark";
  }

  const iconValue: ts.Expression | null = jsxAttributeValue(icon);

  if (
    icon &&
    !color &&
    !iconElement &&
    (!iconValue || canBeMissing(iconValue)) &&
    !isTrueAttribute(jsxAttribute(element, "isIconSpaceReserved"))
  ) {
    return "has an icon that can be missing and does not keep its space (isIconSpaceReserved)";
  }

  return null;
}

describe("every item in a More (⋯) menu has an icon", () => {
  test("the scan reaches the menus it is about", () => {
    const files: Array<string> = PARSED.map((parsed: ParsedFile): string => {
      return parsed.file;
    });

    // So the rules below cannot pass by reading nothing.
    expect(files).toEqual(
      expect.arrayContaining([
        "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx",
        "packages/Common/UI/Components/ActionButton/RowActions.tsx",
        "packages/Common/UI/Components/BulkUpdate/BulkUpdateForm.tsx",
        "packages/App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable.tsx",
        "packages/App/FeatureSet/AdminDashboard/src/Pages/Users/Index.tsx",
        "packages/App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardViewPage.tsx",
        "ee/Dashboard/Identity/Pages/Settings/SCIM.tsx",
      ]),
    );
    expect(findActionObjects().length).toBeGreaterThan(150);
    expect(findMoreMenuItems().length).toBeGreaterThan(60);
  });

  test("every row action and bulk action has an icon", () => {
    const problems: Array<IconProblem> = [];

    for (const { parsed, node } of findActionObjects()) {
      const problem: string | null = iconProblemOfObject(node);

      if (problem) {
        problems.push({
          file: parsed.file,
          line: lineOf(parsed.source, node),
          text: titleOf(node),
          problem: problem,
        });
      }
    }

    // Give the action an `icon: IconProp.<X>` that fits what it does.
    expect(problems).toEqual([]);
  });

  test("no card button is cast past its required icon", () => {
    const problems: Array<IconProblem> = [];

    for (const parsed of PARSED) {
      visit(parsed.source, (node: ts.Node) => {
        if (
          !ts.isAsExpression(node) ||
          !ts.isTypeReferenceNode(node.type) ||
          ![
            "CardButtonSchema",
            "ActionButtonSchema",
            "BulkActionButtonSchema",
          ].includes(node.type.typeName.getText(parsed.source))
        ) {
          return;
        }

        const value: ts.Expression = unwrap(node.expression);

        if (!ts.isObjectLiteralExpression(value)) {
          return;
        }

        const problem: string | null = iconProblemOfObject(value);

        if (problem) {
          problems.push({
            file: parsed.file,
            line: lineOf(parsed.source, node),
            text: titleOf(value),
            problem: `is cast to ${node.type.getText(parsed.source)} and ${problem}`,
          });
        }
      });
    }

    // Add the icon - and drop the cast, so the compiler checks it next time.
    expect(problems).toEqual([]);
  });

  test("every <MoreMenuItem> has an icon, a colour or a mark", () => {
    const problems: Array<IconProblem> = [];

    for (const { parsed, node } of findMoreMenuItems()) {
      const problem: string | null = moreMenuItemProblem(node);

      if (problem) {
        problems.push({
          file: parsed.file,
          line: lineOf(parsed.source, node),
          text:
            jsxAttributeText(jsxAttribute(node, "text")) ||
            compact(node.getText(parsed.source)),
          problem: problem,
        });
      }
    }

    expect(problems).toEqual([]);
  });

  test('"Show ID" wears the ID card in every menu', () => {
    const icons: Array<Finding> = [];

    for (const { parsed, node } of findActionObjects()) {
      const title: string = titleOf(node);

      if (isShowIdLabel(title)) {
        const icon: ts.ObjectLiteralElementLike | undefined = findProperty(
          node,
          "icon",
        );

        icons.push({
          file: parsed.file,
          line: lineOf(parsed.source, node),
          text:
            icon && ts.isPropertyAssignment(icon)
              ? icon.initializer.getText(parsed.source)
              : "",
        });
      }
    }

    for (const { parsed, node } of findMoreMenuItems()) {
      if (isShowIdLabel(jsxAttributeText(jsxAttribute(node, "text")))) {
        icons.push({
          file: parsed.file,
          line: lineOf(parsed.source, node),
          text: jsxAttributeText(jsxAttribute(node, "icon")),
        });
      }
    }

    /*
     * The table's own, the status page's resource list, grid and group
     * navigator, and its resource panel's "Show group ID".
     */
    expect(icons.length).toBeGreaterThanOrEqual(5);
    expect(
      icons.filter((finding: Finding) => {
        return finding.text !== SHOW_ID_ICON;
      }),
    ).toEqual([]);
  });

  test("the action and card button types keep the icon required", () => {
    const schemas: Array<{ file: string; name: string }> = [
      {
        file: "packages/Common/UI/Components/ActionButton/ActionButtonSchema.ts",
        name: "ActionButtonSchema",
      },
      {
        file: "packages/Common/UI/Components/BulkUpdate/BulkUpdateForm.tsx",
        name: "BulkActionButtonSchema",
      },
      {
        file: "packages/Common/UI/Components/Card/Card.tsx",
        name: "CardButtonSchema",
      },
    ];

    for (const schema of schemas) {
      const parsed: ParsedFile | undefined = PARSED.find(
        (candidate: ParsedFile) => {
          return candidate.file === schema.file;
        },
      );

      expect(parsed).toBeDefined();

      let iconSignature: ts.PropertySignature | undefined;

      visit(parsed!.source, (node: ts.Node) => {
        if (ts.isInterfaceDeclaration(node) && node.name.text === schema.name) {
          iconSignature = node.members.find(
            (member: ts.TypeElement): member is ts.PropertySignature => {
              return (
                ts.isPropertySignature(member) &&
                member.name.getText(parsed!.source) === "icon"
              );
            },
          );
        }
      });

      expect([schema.name, Boolean(iconSignature)]).toEqual([
        schema.name,
        true,
      ]);
      expect([schema.name, Boolean(iconSignature!.questionToken)]).toEqual([
        schema.name,
        false,
      ]);
      expect([
        schema.name,
        iconSignature!.type!.getText(parsed!.source),
      ]).toEqual([schema.name, "IconProp"]);
    }
  });

  /*
   * The rules themselves, on code written to break them - so a rule that
   * stops seeing what it is for fails here rather than passing quietly.
   */
  describe("the rules catch what they are for", () => {
    function parse(code: string): ts.SourceFile {
      return ts.createSourceFile(
        "fixture.tsx",
        code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
    }

    function firstObjectWith(
      source: ts.SourceFile,
      key: string,
    ): ts.ObjectLiteralExpression {
      let found: ts.ObjectLiteralExpression | undefined;

      visit(source, (node: ts.Node) => {
        if (
          !found &&
          ts.isObjectLiteralExpression(node) &&
          findProperty(node, key)
        ) {
          found = node;
        }
      });

      return found!;
    }

    function firstMoreMenuItem(
      source: ts.SourceFile,
    ): ts.JsxOpeningElement | ts.JsxSelfClosingElement {
      let found: ts.JsxOpeningElement | ts.JsxSelfClosingElement | undefined;

      visit(source, (node: ts.Node) => {
        if (
          !found &&
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          node.tagName.getText(source) === "MoreMenuItem"
        ) {
          found = node;
        }
      });

      return found!;
    }

    test("an action without an icon, or with one that can be missing", () => {
      expect(
        iconProblemOfObject(
          firstObjectWith(
            parse(
              'const a = { title: "Show ID", buttonStyleType: ButtonStyleType.OUTLINE, onClick: () => {} };',
            ),
            "buttonStyleType",
          ),
        ),
      ).toBe("has no icon");

      expect(
        iconProblemOfObject(
          firstObjectWith(
            parse(
              'const a = { title: "Edit", icon: isLocked ? IconProp.Lock : undefined, buttonStyleType: ButtonStyleType.OUTLINE };',
            ),
            "buttonStyleType",
          ),
        ),
      ).toMatch(/can be missing/);

      expect(
        iconProblemOfObject(
          firstObjectWith(
            parse(
              'const a = { title: "Edit", icon: undefined as any, buttonStyleType: ButtonStyleType.OUTLINE };',
            ),
            "buttonStyleType",
          ),
        ),
      ).toMatch(/can be missing/);
    });

    test("an action with an icon, or spreading one that has it, passes", () => {
      expect(
        iconProblemOfObject(
          firstObjectWith(
            parse(
              'const a = { title: "Edit", icon: IconProp.Edit, buttonStyleType: ButtonStyleType.OUTLINE };',
            ),
            "buttonStyleType",
          ),
        ),
      ).toBeNull();

      expect(
        iconProblemOfObject(
          firstObjectWith(
            parse(
              "const a = { ...edit, disabled: true, buttonStyleType: ButtonStyleType.OUTLINE };",
            ),
            "buttonStyleType",
          ),
        ),
      ).toBeNull();

      expect(
        iconProblemOfObject(
          firstObjectWith(
            parse(
              'const a = { title: "Block", icon: isBlocked ? IconProp.Lock : IconProp.LockOpen, buttonStyleType: ButtonStyleType.OUTLINE };',
            ),
            "buttonStyleType",
          ),
        ),
      ).toBeNull();
    });

    test("a menu item with nothing in its icon slot", () => {
      expect(
        moreMenuItemProblem(
          firstMoreMenuItem(
            parse('const x = <MoreMenuItem text="Show ID" onClick={f} />;'),
          ),
        ),
      ).toBe("has no icon, colour or mark");

      expect(
        moreMenuItemProblem(
          firstMoreMenuItem(
            parse(
              'const x = <MoreMenuItem text="5 seconds" icon={isOn ? IconProp.Check : undefined} onClick={f} />;',
            ),
          ),
        ),
      ).toMatch(/can be missing/);
    });

    test("an icon, a colour dot, a mark or a picker's tick passes", () => {
      for (const code of [
        'const x = <MoreMenuItem text="Show ID" icon={IconProp.Identification} onClick={f} />;',
        "const x = <MoreMenuItem text={state.name} color={state.color} onClick={f} />;",
        "const x = <MoreMenuItem text={action.label} icon={action.icon} iconElement={action.mark} onClick={f} />;",
        'const x = <MoreMenuItem text="5 seconds" icon={isOn ? IconProp.Check : undefined} isIconSpaceReserved={true} onClick={f} />;',
      ]) {
        expect([
          code,
          moreMenuItemProblem(firstMoreMenuItem(parse(code))),
        ]).toEqual([code, null]);
      }
    });
  });
});
