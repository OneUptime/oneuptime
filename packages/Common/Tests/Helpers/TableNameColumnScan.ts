import ts from "typescript";

/*
 * THE TABLE COLUMNS ON A RECORD'S NAME OR TITLE THAT DRAW AN ELEMENT, READ
 * THROUGH THE TYPESCRIPT AST.
 *
 * A cell reads its line the way its words do when that is not the page's
 * (TableRow, LineDirection): an English name on an Arabic page reads left
 * to right and is cut at its own end. A column that draws an element names
 * its words with getLineText; one on a record's `name` or `title` that
 * names none reads that field (Common/UI/Components/Table/ColumnLineText).
 * That default is right only for an element that draws the field's words
 * and nothing else: one way for the whole cell turns round a logo beside
 * the name, a badge's dot, or a line of the page's own words under it.
 *
 * So the guard (TableNameColumnsLineTextGuard) holds every such column to
 * one of two things: it says what its line reads (getLineText - the
 * name's words, or drawsItsOwnLines), or its element is NAME-ONLY, which
 * is a rule read here, not a list of columns:
 *
 *   - every element it draws is a holder of text - a link (AppLink, Link,
 *     a), a span, a p, a div, a bdi, a fragment - and none of them is a
 *     flex or grid box (whose one item would be put at the line's start,
 *     not lined up by the cell), save the exact <span className="flex">
 *     a record's link draws, which a table's cell lays out as text
 *     (TableLayout's TABLE_CELL_INLINE_RECORD_LINK_CLASS_NAMES);
 *   - or IsolatedText whose text is the field;
 *   - or one of the record's own links (RECORD_NAME_ELEMENTS) handed the
 *     row whole: each draws the record's name and nothing else, which
 *     TableNameRecordElements.test.tsx draws and checks;
 *   - and every word it draws is the row's field - `row.name`,
 *     `(row.name as string) || "—"`, `row.title?.toString()`, or a const
 *     holding just that. No other words, no translated text, no other
 *     value, no element drawn on a condition.
 */

export type NameFieldKey = "name" | "title";

export interface TableNameColumn {
  // Repository-relative, with forward slashes.
  file: string;
  line: number;
  field: NameFieldKey;
  // A ModelTable column (`field: { name: true }`) or a Table one (`key`).
  declaredBy: "field" | "key";
  hasLineText: boolean;
  isNameOnly: boolean;
  // Why its element is not name-only; empty when it is.
  reason: string;
}

/*
 * The record links that draw a record's name and nothing else, handed the
 * row whole (`<IncidentElement incident={item} />`). Each is drawn on an
 * Arabic and a Persian page in TableNameRecordElements.test.tsx: a link
 * that draws more (an icon, a badge) fails there.
 */
export const RECORD_NAME_ELEMENTS: ReadonlyArray<string> = [
  "AlertElement",
  "AlertEpisodeElement",
  "DashboardElement",
  "IncidentElement",
  "IncidentEpisodeElement",
  "MonitorElement",
  "StatusPageElement",
  "WorkflowElement",
];

// Elements that hold the row's words and draw nothing of their own.
const TEXT_HOLDER_TAGS: ReadonlyArray<string> = [
  "a",
  "span",
  "p",
  "div",
  "bdi",
  "strong",
  "AppLink",
  "Link",
  "Fragment",
  "React.Fragment",
];

// A flex or grid box: its one item starts at the line's start.
const BOX_LAYOUT_CLASS_NAMES: ReadonlyArray<string> = ["flex", "grid"];

const LETTER_PATTERN: RegExp = /\p{L}/u;

const NAME_FIELD_KEYS: ReadonlyArray<NameFieldKey> = ["name", "title"];

type JsxTree = ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment;

function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function propertyNameOf(property: ts.ObjectLiteralElementLike): string | null {
  if (
    (ts.isPropertyAssignment(property) ||
      ts.isMethodDeclaration(property) ||
      ts.isShorthandPropertyAssignment(property)) &&
    property.name
  ) {
    if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
      return property.name.text;
    }
  }

  return null;
}

function findProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return propertyNameOf(property) === name;
    },
  );
}

/*
 * The name field a column is on: `field: { name: true }` (a ModelTable
 * column, `as never` and the like allowed) or `key: "name"` (a Table one).
 * A relation's name (`field: { monitor: { name: true } }`) is another
 * record's, and not read here.
 */
function nameFieldOf(
  object: ts.ObjectLiteralExpression,
): { field: NameFieldKey; declaredBy: "field" | "key" } | null {
  const field: ts.ObjectLiteralElementLike | undefined = findProperty(
    object,
    "field",
  );

  if (field && ts.isPropertyAssignment(field)) {
    const value: ts.Expression = unwrap(field.initializer);

    if (ts.isObjectLiteralExpression(value) && value.properties.length === 1) {
      const only: ts.ObjectLiteralElementLike = value.properties[0]!;
      const name: string | null = propertyNameOf(only);

      if (
        name &&
        (NAME_FIELD_KEYS as ReadonlyArray<string>).includes(name) &&
        ts.isPropertyAssignment(only) &&
        only.initializer.kind === ts.SyntaxKind.TrueKeyword
      ) {
        return { field: name as NameFieldKey, declaredBy: "field" };
      }
    }

    return null;
  }

  const key: ts.ObjectLiteralElementLike | undefined = findProperty(
    object,
    "key",
  );

  if (key && ts.isPropertyAssignment(key)) {
    const value: ts.Expression = unwrap(key.initializer);

    if (
      ts.isStringLiteral(value) &&
      (NAME_FIELD_KEYS as ReadonlyArray<string>).includes(value.text)
    ) {
      return { field: value.text as NameFieldKey, declaredBy: "key" };
    }
  }

  return null;
}

/*
 * A table's column: a title, a type (FieldType) and - here - an element.
 * A details card's field says `fieldType`, and a filter draws no element.
 */
function isTableColumn(object: ts.ObjectLiteralExpression): boolean {
  return Boolean(
    findProperty(object, "type") &&
      findProperty(object, "title") &&
      findProperty(object, "getElement") &&
      !findProperty(object, "fieldType"),
  );
}

interface ElementFunction {
  parameterName: string;
  body: ts.Node;
}

function elementFunctionOf(
  property: ts.ObjectLiteralElementLike,
): ElementFunction | null {
  let fn: ts.SignatureDeclaration | null = null;
  let body: ts.Node | undefined = undefined;

  if (ts.isMethodDeclaration(property)) {
    fn = property;
    body = property.body;
  } else if (ts.isPropertyAssignment(property)) {
    const value: ts.Expression = unwrap(property.initializer);

    if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) {
      fn = value;
      body = value.body;
    }
  }

  if (!fn || !body) {
    return null;
  }

  const first: ts.ParameterDeclaration | undefined = fn.parameters[0];

  if (!first || !ts.isIdentifier(first.name)) {
    return null;
  }

  return { parameterName: first.name.text, body: body };
}

class NameOnlyReader {
  private readonly fieldConsts: Set<string> = new Set<string>();

  public constructor(
    private readonly sourceFile: ts.SourceFile,
    private readonly field: NameFieldKey,
    private readonly parameterName: string,
  ) {}

  // The row's field, read as it is: what a name-only element may draw.
  public isFieldRead(expression: ts.Expression): boolean {
    const value: ts.Expression = unwrap(expression);

    if (ts.isIdentifier(value)) {
      return this.fieldConsts.has(value.text);
    }

    if (ts.isPropertyAccessExpression(value)) {
      return (
        ts.isIdentifier(value.expression) &&
        value.expression.text === this.parameterName &&
        value.name.text === this.field
      );
    }

    if (ts.isElementAccessExpression(value)) {
      const argument: ts.Expression = unwrap(value.argumentExpression);

      return (
        ts.isIdentifier(unwrap(value.expression)) &&
        (unwrap(value.expression) as ts.Identifier).text ===
          this.parameterName &&
        ts.isStringLiteral(argument) &&
        argument.text === this.field
      );
    }

    // row.name.toString(), row.name?.toString()
    if (
      ts.isCallExpression(value) &&
      value.arguments.length === 0 &&
      ts.isPropertyAccessExpression(value.expression) &&
      value.expression.name.text === "toString"
    ) {
      return this.isFieldRead(value.expression.expression);
    }

    // row.name || "—": a fallback with no words of its own.
    if (
      ts.isBinaryExpression(value) &&
      (value.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      const fallback: ts.Expression = unwrap(value.right);

      return (
        this.isFieldRead(value.left) &&
        (ts.isStringLiteral(fallback) ||
          ts.isNoSubstitutionTemplateLiteral(fallback)) &&
        !LETTER_PATTERN.test(fallback.text)
      );
    }

    return false;
  }

  private readFieldConsts(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      this.isFieldRead(node.initializer)
    ) {
      this.fieldConsts.add(node.name.text);
    }

    ts.forEachChild(node, (child: ts.Node): void => {
      this.readFieldConsts(child);
    });
  }

  private lineOf(node: ts.Node): number {
    return (
      this.sourceFile.getLineAndCharacterOfPosition(
        node.getStart(this.sourceFile),
      ).line + 1
    );
  }

  private classNameOf(
    attributes: ts.JsxAttributes,
  ): { text: string | null; isLiteral: boolean } | null {
    for (const attribute of attributes.properties) {
      if (
        ts.isJsxAttribute(attribute) &&
        ts.isIdentifier(attribute.name) &&
        attribute.name.text === "className"
      ) {
        const initializer: ts.JsxAttributeValue | undefined =
          attribute.initializer;

        if (initializer && ts.isStringLiteral(initializer)) {
          return { text: initializer.text, isLiteral: true };
        }

        if (
          initializer &&
          ts.isJsxExpression(initializer) &&
          initializer.expression &&
          (ts.isStringLiteral(initializer.expression) ||
            ts.isNoSubstitutionTemplateLiteral(initializer.expression))
        ) {
          return { text: initializer.expression.text, isLiteral: true };
        }

        return { text: null, isLiteral: false };
      }
    }

    return null;
  }

  private attributeExpression(
    attributes: ts.JsxAttributes,
    name: string,
  ): ts.Expression | null {
    for (const attribute of attributes.properties) {
      if (
        ts.isJsxAttribute(attribute) &&
        ts.isIdentifier(attribute.name) &&
        attribute.name.text === name &&
        attribute.initializer &&
        ts.isJsxExpression(attribute.initializer) &&
        attribute.initializer.expression
      ) {
        return attribute.initializer.expression;
      }
    }

    return null;
  }

  // Why an opening tag is not one a name-only element draws; "" when it is.
  private tagReason(
    tagName: string,
    attributes: ts.JsxAttributes,
    node: ts.Node,
  ): string {
    if (RECORD_NAME_ELEMENTS.includes(tagName)) {
      /*
       * Handed the row and nothing else: an option (an icon beside the
       * name) would draw more than the name.
       */
      const only: ts.JsxAttributeLike | undefined =
        attributes.properties.length === 1
          ? attributes.properties[0]
          : undefined;
      const value: ts.Expression | undefined =
        only &&
        ts.isJsxAttribute(only) &&
        only.initializer &&
        ts.isJsxExpression(only.initializer) &&
        only.initializer.expression
          ? unwrap(only.initializer.expression)
          : undefined;
      const handsTheRowAlone: boolean = Boolean(
        value && ts.isIdentifier(value) && value.text === this.parameterName,
      );

      return handsTheRowAlone
        ? ""
        : `draws <${tagName}> with more than its row (line ${this.lineOf(node)})`;
    }

    if (tagName === "IsolatedText") {
      const text: ts.Expression | null = this.attributeExpression(
        attributes,
        "text",
      );

      return text && this.isFieldRead(text)
        ? ""
        : `draws <IsolatedText> with other words than the row's ${this.field} (line ${this.lineOf(node)})`;
    }

    if (!TEXT_HOLDER_TAGS.includes(tagName)) {
      return `draws <${tagName}> (line ${this.lineOf(node)})`;
    }

    const className: { text: string | null; isLiteral: boolean } | null =
      this.classNameOf(attributes);

    if (!className) {
      return "";
    }

    if (!className.isLiteral) {
      return `draws a <${tagName}> whose classes are worked out as it is drawn (line ${this.lineOf(node)})`;
    }

    const classes: Array<string> = (className.text || "")
      .split(/\s+/)
      .filter(Boolean);

    if (tagName === "span" && classes.length === 1 && classes[0] === "flex") {
      return "";
    }

    const layout: string | undefined = classes.find((name: string): boolean => {
      return BOX_LAYOUT_CLASS_NAMES.includes(name);
    });

    return layout
      ? `draws a ${layout} box, <${tagName} className="${className.text}"> (line ${this.lineOf(node)})`
      : "";
  }

  private childReason(child: ts.JsxChild): string {
    if (ts.isJsxText(child)) {
      return child.text.trim()
        ? `draws words of its own, "${child.text.trim()}" (line ${this.lineOf(child)})`
        : "";
    }

    if (ts.isJsxExpression(child)) {
      if (!child.expression) {
        return "";
      }

      const expression: ts.Expression = unwrap(child.expression);

      // {" "}: a space between parts, no words.
      if (
        (ts.isStringLiteral(expression) ||
          ts.isNoSubstitutionTemplateLiteral(expression)) &&
        !expression.text.trim()
      ) {
        return "";
      }

      if (
        ts.isJsxElement(expression) ||
        ts.isJsxSelfClosingElement(expression) ||
        ts.isJsxFragment(expression)
      ) {
        return this.elementReason(expression);
      }

      return this.isFieldRead(expression)
        ? ""
        : `draws {${expression.getText(this.sourceFile).slice(0, 80)}}, not the row's ${this.field} (line ${this.lineOf(child)})`;
    }

    return this.elementReason(child);
  }

  private elementReason(node: JsxTree): string {
    if (ts.isJsxFragment(node)) {
      for (const child of node.children) {
        const reason: string = this.childReason(child);

        if (reason) {
          return reason;
        }
      }

      return "";
    }

    const opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement =
      ts.isJsxElement(node) ? node.openingElement : node;
    const tagName: string = opening.tagName.getText(this.sourceFile);
    const tagReason: string = this.tagReason(tagName, opening.attributes, node);

    if (tagReason) {
      return tagReason;
    }

    if (ts.isJsxElement(node)) {
      for (const child of node.children) {
        const reason: string = this.childReason(child);

        if (reason) {
          return reason;
        }
      }
    }

    return "";
  }

  /*
   * The JSX trees a returned value draws: a tree, or each branch of a
   * condition between trees (a link when there is a page to open, a span
   * when not). Null for a value that is no tree (a string, a call).
   */
  private treesOf(expression: ts.Expression): Array<JsxTree> | null {
    const value: ts.Expression = unwrap(expression);

    if (
      ts.isJsxElement(value) ||
      ts.isJsxSelfClosingElement(value) ||
      ts.isJsxFragment(value)
    ) {
      return [value];
    }

    if (ts.isConditionalExpression(value)) {
      const whenTrue: Array<JsxTree> | null = this.treesOf(value.whenTrue);
      const whenFalse: Array<JsxTree> | null = this.treesOf(value.whenFalse);

      return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null;
    }

    return null;
  }

  /*
   * Why the element is not name-only, or "" when it is: every tree the
   * function returns is read whole, and a return of anything else - a
   * value drawn through another function - is not name-only.
   */
  public read(body: ts.Node): string {
    this.readFieldConsts(body);

    const returned: Array<ts.Expression> = [];

    if (ts.isBlock(body)) {
      const collect: (node: ts.Node) => void = (node: ts.Node): void => {
        // A function inside draws for itself (a list's map): not read here.
        if (ts.isFunctionLike(node)) {
          return;
        }

        if (ts.isReturnStatement(node) && node.expression) {
          returned.push(node.expression);
          return;
        }

        ts.forEachChild(node, collect);
      };

      ts.forEachChild(body, collect);
    } else {
      returned.push(body as ts.Expression);
    }

    if (returned.length === 0) {
      return "returns no element the guard can read";
    }

    for (const value of returned) {
      const trees: Array<JsxTree> | null = this.treesOf(value);

      if (!trees) {
        return `returns ${value.getText(this.sourceFile).slice(0, 80)}, not an element the guard can read (line ${this.lineOf(value)})`;
      }

      for (const tree of trees) {
        const reason: string = this.elementReason(tree);

        if (reason) {
          return reason;
        }
      }
    }

    return "";
  }
}

// Every table column on a name field that draws an element, in one module.
export function scanTableNameColumns(
  sourceText: string,
  file: string,
): Array<TableNameColumn> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<TableNameColumn> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) && isTableColumn(node)) {
      const nameField: {
        field: NameFieldKey;
        declaredBy: "field" | "key";
      } | null = nameFieldOf(node);

      if (nameField) {
        const getElement: ts.ObjectLiteralElementLike = findProperty(
          node,
          "getElement",
        )!;
        const elementFunction: ElementFunction | null =
          elementFunctionOf(getElement);
        const reason: string = elementFunction
          ? new NameOnlyReader(
              sourceFile,
              nameField.field,
              elementFunction.parameterName,
            ).read(elementFunction.body)
          : "draws through a function the guard cannot read";

        found.push({
          file: file,
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1,
          field: nameField.field,
          declaredBy: nameField.declaredBy,
          hasLineText: Boolean(findProperty(node, "getLineText")),
          isNameOnly: reason === "",
          reason: reason,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}
