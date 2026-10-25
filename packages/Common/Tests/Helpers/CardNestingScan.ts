import ts from "typescript";

/*
 * The detector behind the card-in-card guard
 * (Tests/UI/Components/CardInCardGuard.test.ts).
 *
 * The maintainer, of a page's More settings: "it looks like a card inside of
 * a card ... More Settings should look like one card instead of a card inside
 * of a card, and it should have dividers ... Please do this everywhere in the
 * project." A card inside a card is a box inside a box: two borders, two sets
 * of rounded corners, two shadows, a grey gutter between them. Where one card
 * has to hold others, it holds them in CardSections and they are drawn as its
 * sections (Card/CardSurface.ts).
 *
 * Read per module, through the TypeScript AST, over every frontend's source:
 *
 *   A whole card is an element of Card, CardModelDetail, TableCard or
 *   AdvancedPageSection; of a door (EnterprisePluginPage, which draws the
 *   Enterprise card or the upsell card in its place, with what is left of
 *   the feature beside it - never inside it); a FoldedSection drawn as a
 *   card (isElevated); a
 *   ModelTable, ModelList or BaseModelTable given cardProps; or an element of
 *   a component whose module's default export draws one of those at its root
 *   - the element its last return gives, or one directly inside a fragment,
 *   a provider or the plain div it returns - worked out over every module
 *   until nothing changes. An element passed hideCard (or any hideCard...
 *   flag) set to true draws no card.
 *
 *   It sits inside another when it is in the JSX - children or props - of a
 *   whole card, of a fold (FoldedSection, CollapsibleSection), of a dialog
 *   (Modal), of an element built by hand with a card's frame (rounded
 *   corners, a border and a shadow), or of a component that draws its
 *   children inside a card. CardSections and AdvancedPageSection draw what
 *   they hold as their sections, so nothing directly inside them counts.
 *
 * A side panel (SideOver) is a sheet of its own, not a card: cards sit on it
 * as they sit on a page, and it starts a surface of its own (CardSurface).
 */

export interface CardNestingSource {
  // Repository-relative, with "/" separators.
  file: string;
  text: string;
}

// The module an import names, repository-relative, or null when not one of the sources.
export type ImportResolver = (
  fromFile: string,
  specifier: string,
) => string | null;

export interface CardNesting {
  file: string;
  // The inner card's line.
  line: number;
  // The inner card's element name: Card, CardModelDetail, ApiKeyPermissionTable...
  card: string;
  // What it sits in: Card, FoldedSection, Modal, div (a hand-built frame)...
  container: string;
  containerLine: number;
}

export interface CardSectionsChild {
  file: string;
  line: number;
  // The element passed to CardSections or AdvancedPageSection.
  element: string;
  // Whether it is a whole card, and so draws as a section with a divider.
  isCard: boolean;
}

/*
 * A row of cards built by hand: an element whose classes make it a grid of
 * two or more columns (grid-cols-2 and up, at any width), whose cells are
 * whole cards - a card element, a component or render helper of the same
 * module that draws one, a wrapper holding just one, or a list of them
 * (.map). Read by the card-rows guard (Tests/UI/Components/
 * CardRowsGuard.test.ts): such a row is drawn with CardGrid, whose cards
 * fill their cells. A grid of columns that each stack several cards (an
 * incident's page) is not a row of cards.
 */
export interface CardRowCell {
  // What the cell draws: Card, renderTopList, div>Card, ...
  name: string;
  // Whether the cell is one whole card.
  isCard: boolean;
  // Whether it stands for a list of cells (.map).
  isRepeated: boolean;
}

export interface CardRow {
  file: string;
  line: number;
  // The grid's class attribute, as written.
  className: string;
  cells: Array<CardRowCell>;
}

const BASE_CARDS: ReadonlyArray<string> = [
  "Card",
  "CardModelDetail",
  "TableCard",
  "AdvancedPageSection",
];

/*
 * Doors: elements that draw a whole card in their place, and draw what they
 * are given - the upsell, what a lower plan or the Community Edition left of
 * the feature - beside it rather than inside it. A whole card, but no
 * container.
 */
const CARD_DOORS: ReadonlyArray<string> = ["EnterprisePluginPage"];

const CARD_TABLES: ReadonlyArray<string> = [
  "ModelTable",
  "ModelList",
  "BaseModelTable",
];

// What holds cards as its sections.
const SECTIONING: ReadonlyArray<string> = [
  "CardSections",
  "AdvancedPageSection",
];

// Framed holders that are not cards themselves: folds and dialogs.
const FRAMED_HOLDERS: ReadonlyArray<string> = [
  "FoldedSection",
  "CollapsibleSection",
  "Modal",
];

const HIDE_CARD_ATTRIBUTE: RegExp = /^hideCard/;
const ROUNDED_FRAME: RegExp = /(?:^|\s)rounded-(?:lg|xl|2xl)(?:\s|$)/;
const BORDER_ALL_ROUND: RegExp = /(?:^|\s)border(?:\s|$)/;
const SHADOW: RegExp = /(?:^|\s)shadow(?:-(?:sm|md|lg|xl|2xl))?(?:\s|$)/;
const PROVIDER_NAME: RegExp = /Provider$/;
// What wraps a class attribute's text: quotes, backticks, braces.
const ATTRIBUTE_WRAPPING: RegExp = /["'`{}]/g;
const CHILDREN_EXPRESSION: RegExp = /^(?:props\.)?children$/;
const INTRINSIC_NAME: RegExp = /^[a-z]/;
// A tag's type arguments, as getText() may give them: ModelTable<Rule>.
const TYPE_ARGUMENTS: RegExp = /<.*$/;
// Between the class names of a class attribute.
const CLASS_SEPARATOR: RegExp = /\s+/;
// A grid of two columns or more, at any width: grid-cols-2 ... grid-cols-12.
const MULTI_COLUMN_UTILITY: RegExp = /^grid-cols-(?:[2-9]|1[0-2])$/;

type JsxLike = ts.JsxElement | ts.JsxSelfClosingElement;

interface ParsedModule {
  file: string;
  source: ts.SourceFile;
  // Local default-import name -> the module it names.
  imports: Map<string, string>;
}

function openingOf(element: JsxLike): ts.JsxOpeningLikeElement {
  return ts.isJsxElement(element) ? element.openingElement : element;
}

function nameOf(element: JsxLike): string {
  return openingOf(element).tagName.getText();
}

function attributeOf(
  element: JsxLike,
  name: string,
): ts.JsxAttribute | undefined {
  return openingOf(element).attributes.properties.find(
    (property: ts.JsxAttributeLike): boolean => {
      return ts.isJsxAttribute(property) && property.name.getText() === name;
    },
  ) as ts.JsxAttribute | undefined;
}

function passesHideCard(element: JsxLike): boolean {
  return openingOf(element).attributes.properties.some(
    (property: ts.JsxAttributeLike): boolean => {
      if (
        !ts.isJsxAttribute(property) ||
        !HIDE_CARD_ATTRIBUTE.test(property.name.getText())
      ) {
        return false;
      }

      return (
        !property.initializer || property.initializer.getText() === "{true}"
      );
    },
  );
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

// A hand-built element drawn with a card's frame: rounded corners, a border all round, a shadow.
function isHandBuiltFrame(element: JsxLike): boolean {
  if (!INTRINSIC_NAME.test(nameOf(element))) {
    return false;
  }

  const className: ts.JsxAttribute | undefined = attributeOf(
    element,
    "className",
  );

  if (!className || !className.initializer) {
    return false;
  }

  const text: string = className.initializer
    .getText()
    .replace(ATTRIBUTE_WRAPPING, " ");

  return (
    ROUNDED_FRAME.test(text) && BORDER_ALL_ROUND.test(text) && SHADOW.test(text)
  );
}

/*
 * The utilities of a class attribute as written - a string, or the text of
 * the expression that builds one - each without its variants (md:, the
 * container queries' [@container(...)]:). The utility is what follows the
 * last colon: no utility has one of its own.
 */
function classUtilitiesOf(element: JsxLike): Array<string> {
  const className: ts.JsxAttribute | undefined = attributeOf(
    element,
    "className",
  );

  if (!className || !className.initializer) {
    return [];
  }

  return className.initializer
    .getText()
    .replace(ATTRIBUTE_WRAPPING, " ")
    .split(CLASS_SEPARATOR)
    .filter(Boolean)
    .map((token: string): string => {
      return token.split(":").pop() || "";
    });
}

// An element drawn as a grid of two columns or more, at some width.
function isMultiColumnGrid(element: JsxLike): boolean {
  const utilities: Array<string> = classUtilitiesOf(element);

  return (
    utilities.includes("grid") &&
    utilities.some((utility: string): boolean => {
      return MULTI_COLUMN_UTILITY.test(utility);
    })
  );
}

// The expression a function gives back last: its body, or its last return.
function lastReturnOf(
  declaration: ts.FunctionLikeDeclaration,
): ts.Expression | null {
  if (!declaration.body) {
    return null;
  }

  if (!ts.isBlock(declaration.body)) {
    return declaration.body;
  }

  const returns: Array<ts.ReturnStatement> = declaration.body.statements.filter(
    (statement: ts.Statement): statement is ts.ReturnStatement => {
      return ts.isReturnStatement(statement);
    },
  );

  return returns.length > 0
    ? returns[returns.length - 1]!.expression || null
    : null;
}

/*
 * Every named function of a module, at any depth - its components and the
 * render helpers inside them (const renderTopList = (...) => ...) - with
 * what each gives back last.
 */
function namedFunctionsOf(
  source: ts.SourceFile,
): Map<string, ts.Expression | null> {
  const found: Map<string, ts.Expression | null> = new Map<
    string,
    ts.Expression | null
  >();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      found.set(node.name.text, lastReturnOf(node));
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      found.set(node.name.text, lastReturnOf(node.initializer));
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

// What a cell of a grid holds that counts: elements and expressions, not blank text or comments.
function meaningfulChildrenOf(element: ts.JsxElement): Array<ts.JsxChild> {
  return element.children.filter((child: ts.JsxChild): boolean => {
    if (ts.isJsxText(child)) {
      return child.text.trim().length > 0;
    }

    if (ts.isJsxExpression(child)) {
      return Boolean(child.expression);
    }

    return true;
  });
}

function parseModules(
  sources: Array<CardNestingSource>,
  resolveImport: ImportResolver,
): Array<ParsedModule> {
  return sources.map((entry: CardNestingSource): ParsedModule => {
    const source: ts.SourceFile = ts.createSourceFile(
      entry.file,
      entry.text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const imports: Map<string, string> = new Map<string, string>();

    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !statement.importClause ||
        !statement.importClause.name ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }

      const resolved: string | null = resolveImport(
        entry.file,
        statement.moduleSpecifier.text,
      );

      if (resolved) {
        imports.set(statement.importClause.name.text, resolved);
      }
    }

    return { file: entry.file, source, imports };
  });
}

// The expression the module's default-exported component returns last.
function mainReturnOf(source: ts.SourceFile): ts.Expression | null {
  let defaultName: string | null = null;

  for (const statement of source.statements) {
    if (
      ts.isExportAssignment(statement) &&
      ts.isIdentifier(statement.expression)
    ) {
      defaultName = statement.expression.text;
    }
  }

  if (!defaultName) {
    return null;
  }

  const name: string = defaultName;

  // The component itself: a const arrow or function expression, or a function declaration.
  const findComponent: (node: ts.Node) => ts.FunctionLikeDeclaration | null = (
    node: ts.Node,
  ): ts.FunctionLikeDeclaration | null => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText() === name &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      return node.initializer;
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      node.name.text === name
    ) {
      return node;
    }

    // forEachChild stops at, and gives back, the first child that has it.
    return (
      ts.forEachChild(
        node,
        (child: ts.Node): ts.FunctionLikeDeclaration | undefined => {
          return findComponent(child) || undefined;
        },
      ) || null
    );
  };

  const found: ts.FunctionLikeDeclaration | null = findComponent(source);

  if (!found || !found.body) {
    return null;
  }

  if (!ts.isBlock(found.body)) {
    return found.body;
  }

  const returns: Array<ts.ReturnStatement> = found.body.statements.filter(
    (statement: ts.Statement): statement is ts.ReturnStatement => {
      return ts.isReturnStatement(statement);
    },
  );

  return returns.length > 0
    ? returns[returns.length - 1]!.expression || null
    : null;
}

// The elements a returned expression draws at its root.
function rootElementsOf(expression: ts.Expression | null): Array<JsxLike> {
  const found: Array<JsxLike> = [];

  const unwrap: (node: ts.Node | undefined, depth: number) => void = (
    node: ts.Node | undefined,
    depth: number,
  ): void => {
    if (!node) {
      return;
    }

    if (ts.isParenthesizedExpression(node)) {
      unwrap(node.expression, depth);
      return;
    }

    if (ts.isJsxFragment(node)) {
      for (const child of node.children) {
        unwrap(child, depth);
      }
      return;
    }

    if (ts.isJsxExpression(node)) {
      unwrap(node.expression, depth);
      return;
    }

    if (ts.isConditionalExpression(node)) {
      unwrap(node.whenTrue, depth);
      unwrap(node.whenFalse, depth);
      return;
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      unwrap(node.right, depth);
      return;
    }

    // A wrapper call around the element: withZoom(<Card ... />).
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      unwrap(node.arguments[0], depth);
      return;
    }

    if (ts.isJsxElement(node)) {
      const name: string = nameOf(node);

      found.push(node);

      if (
        name === "Fragment" ||
        name === "React.Fragment" ||
        PROVIDER_NAME.test(name) ||
        (name === "div" && depth === 0)
      ) {
        for (const child of node.children) {
          unwrap(child, depth + 1);
        }
      }
      return;
    }

    if (ts.isJsxSelfClosingElement(node)) {
      found.push(node);
    }
  };

  unwrap(expression || undefined, 0);

  return found;
}

class CardNestingScanner {
  private readonly modules: Array<ParsedModule>;
  private readonly cardModules: Set<string> = new Set<string>();
  private readonly childrenInCardModules: Set<string> = new Set<string>();
  // Per module: its own functions that draw a whole card (localCardDrawers).
  private readonly localCardDrawersByFile: Map<string, Set<string>> = new Map<
    string,
    Set<string>
  >();

  public constructor(
    sources: Array<CardNestingSource>,
    resolveImport: ImportResolver,
  ) {
    this.modules = parseModules(sources, resolveImport);
    this.findCardModules();
    this.findChildrenInCardModules();
  }

  public isCardElement(module: ParsedModule, element: JsxLike): boolean {
    const name: string = nameOf(element).replace(TYPE_ARGUMENTS, "");

    if (passesHideCard(element)) {
      return false;
    }

    if (BASE_CARDS.includes(name) || CARD_DOORS.includes(name)) {
      return true;
    }

    if (CARD_TABLES.includes(name)) {
      return Boolean(attributeOf(element, "cardProps"));
    }

    if (name === "FoldedSection") {
      return Boolean(attributeOf(element, "isElevated"));
    }

    const imported: string | undefined = module.imports.get(name);

    return Boolean(imported && this.cardModules.has(imported));
  }

  public cardModuleFiles(): Array<string> {
    return Array.from(this.cardModules).sort();
  }

  public nestings(): Array<CardNesting> {
    const found: Array<CardNesting> = [];

    for (const module of this.modules) {
      this.walk(module, module.source, null, found);
    }

    return found;
  }

  public sectionsChildren(): Array<CardSectionsChild> {
    const found: Array<CardSectionsChild> = [];

    for (const module of this.modules) {
      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (
          ts.isJsxElement(node) &&
          SECTIONING.includes(nameOf(node).replace(TYPE_ARGUMENTS, ""))
        ) {
          for (const child of node.children) {
            if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
              found.push({
                file: module.file,
                line: lineOf(module.source, child),
                element: nameOf(child),
                isCard: this.isCardElement(module, child),
              });
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(module.source);
    }

    return found;
  }

  public cardRows(): Array<CardRow> {
    const found: Array<CardRow> = [];

    for (const module of this.modules) {
      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (
          ts.isJsxElement(node) &&
          INTRINSIC_NAME.test(nameOf(node)) &&
          isMultiColumnGrid(node)
        ) {
          const cells: Array<CardRowCell> = node.children.flatMap(
            (child: ts.JsxChild): Array<CardRowCell> => {
              return this.cellsOfChild(module, child);
            },
          );

          const isRowOfCards: boolean =
            cells.some((cell: CardRowCell): boolean => {
              return cell.isCard;
            }) &&
            (cells.length > 1 ||
              cells.some((cell: CardRowCell): boolean => {
                return cell.isRepeated;
              }));

          if (isRowOfCards) {
            found.push({
              file: module.file,
              line: lineOf(module.source, node),
              className:
                attributeOf(node, "className")?.initializer?.getText() || "",
              cells,
            });
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(module.source);
    }

    return found;
  }

  /*
   * The names of a module's own functions - components and render helpers
   * - that draw a whole card at their root, worked out until nothing
   * changes (one may draw another).
   */
  private localCardDrawers(module: ParsedModule): Set<string> {
    const cached: Set<string> | undefined = this.localCardDrawersByFile.get(
      module.file,
    );

    if (cached) {
      return cached;
    }

    const drawers: Set<string> = new Set<string>();
    const functions: Map<string, ts.Expression | null> = namedFunctionsOf(
      module.source,
    );
    let changed: boolean = true;

    while (changed) {
      changed = false;

      for (const [name, returned] of functions) {
        if (drawers.has(name)) {
          continue;
        }

        const draws: boolean = rootElementsOf(returned).some(
          (element: JsxLike): boolean => {
            return (
              this.isCardElement(module, element) ||
              drawers.has(nameOf(element).replace(TYPE_ARGUMENTS, ""))
            );
          },
        );

        if (draws) {
          drawers.add(name);
          changed = true;
        }
      }
    }

    this.localCardDrawersByFile.set(module.file, drawers);

    return drawers;
  }

  private drawsCard(module: ParsedModule, element: JsxLike): boolean {
    return (
      this.isCardElement(module, element) ||
      this.localCardDrawers(module).has(
        nameOf(element).replace(TYPE_ARGUMENTS, ""),
      )
    );
  }

  // The cells one child of a grid stands for: none, one, or a fragment's or a list's.
  private cellsOfChild(
    module: ParsedModule,
    child: ts.JsxChild,
  ): Array<CardRowCell> {
    if (ts.isJsxText(child)) {
      return [];
    }

    if (ts.isJsxExpression(child)) {
      return child.expression
        ? this.cellsOfExpression(module, child.expression)
        : [];
    }

    return this.cellsOfExpression(module, child as ts.Expression);
  }

  private cellsOfExpression(
    module: ParsedModule,
    expression: ts.Expression,
  ): Array<CardRowCell> {
    if (ts.isParenthesizedExpression(expression)) {
      return this.cellsOfExpression(module, expression.expression);
    }

    if (ts.isJsxFragment(expression)) {
      return expression.children.flatMap(
        (child: ts.JsxChild): Array<CardRowCell> => {
          return this.cellsOfChild(module, child);
        },
      );
    }

    if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression)) {
      const name: string = nameOf(expression).replace(TYPE_ARGUMENTS, "");

      if (
        ts.isJsxElement(expression) &&
        (name === "Fragment" || name === "React.Fragment")
      ) {
        return expression.children.flatMap(
          (child: ts.JsxChild): Array<CardRowCell> => {
            return this.cellsOfChild(module, child);
          },
        );
      }

      return [this.cellOfElement(module, expression)];
    }

    // One of two at a time: as many cells as the longer, a card if either is.
    if (ts.isConditionalExpression(expression)) {
      const whenTrue: Array<CardRowCell> = this.cellsOfExpression(
        module,
        expression.whenTrue,
      );
      const whenFalse: Array<CardRowCell> = this.cellsOfExpression(
        module,
        expression.whenFalse,
      );
      const longer: Array<CardRowCell> =
        whenTrue.length >= whenFalse.length ? whenTrue : whenFalse;
      const isCard: boolean = [...whenTrue, ...whenFalse].some(
        (cell: CardRowCell): boolean => {
          return cell.isCard;
        },
      );

      return longer.map((cell: CardRowCell): CardRowCell => {
        return { ...cell, isCard: cell.isCard || isCard };
      });
    }

    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    ) {
      return this.cellsOfExpression(module, expression.right);
    }

    if (ts.isCallExpression(expression)) {
      const callee: ts.Expression = expression.expression;

      // A list: what each item gives back is a cell, as many as there are items.
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "map" &&
        expression.arguments[0] &&
        (ts.isArrowFunction(expression.arguments[0]) ||
          ts.isFunctionExpression(expression.arguments[0]))
      ) {
        const returned: ts.Expression | null = lastReturnOf(
          expression.arguments[0],
        );

        return (returned ? this.cellsOfExpression(module, returned) : []).map(
          (cell: CardRowCell): CardRowCell => {
            return { ...cell, isRepeated: true };
          },
        );
      }

      // A render helper of the module: renderTopList(...).
      if (ts.isIdentifier(callee)) {
        return [
          {
            name: callee.text,
            isCard: this.localCardDrawers(module).has(callee.text),
            isRepeated: false,
          },
        ];
      }
    }

    return [{ name: "{...}", isCard: false, isRepeated: false }];
  }

  /*
   * One element's cell: a card if it draws one, or if it is a plain wrapper
   * (a div holding a span's classes) around nothing but one card.
   */
  private cellOfElement(module: ParsedModule, element: JsxLike): CardRowCell {
    const name: string = nameOf(element).replace(TYPE_ARGUMENTS, "");

    if (this.drawsCard(module, element)) {
      return { name, isCard: true, isRepeated: false };
    }

    if (ts.isJsxElement(element) && INTRINSIC_NAME.test(name)) {
      const children: Array<ts.JsxChild> = meaningfulChildrenOf(element);
      const inner: Array<CardRowCell> =
        children.length === 1
          ? this.cellsOfChild(module, children[0]!)
          : [];

      if (inner.length === 1 && inner[0]!.isCard) {
        return {
          name: `${name}>${inner[0]!.name}`,
          isCard: true,
          isRepeated: inner[0]!.isRepeated,
        };
      }
    }

    return { name, isCard: false, isRepeated: false };
  }

  private findCardModules(): void {
    let changed: boolean = true;

    while (changed) {
      changed = false;

      for (const module of this.modules) {
        if (this.cardModules.has(module.file)) {
          continue;
        }

        const drawsCard: boolean = rootElementsOf(
          mainReturnOf(module.source),
        ).some((element: JsxLike): boolean => {
          return this.isCardElement(module, element);
        });

        if (drawsCard) {
          this.cardModules.add(module.file);
          changed = true;
        }
      }
    }
  }

  // Modules that draw {children} (or {props.children}) inside a whole card.
  private findChildrenInCardModules(): void {
    for (const module of this.modules) {
      const visit: (node: ts.Node, isInCard: boolean) => void = (
        node: ts.Node,
        isInCard: boolean,
      ): void => {
        if (ts.isJsxElement(node)) {
          const inCard: boolean = isInCard || this.isCardElement(module, node);

          for (const child of node.children) {
            visit(child, inCard);
          }
          return;
        }

        if (
          isInCard &&
          ts.isJsxExpression(node) &&
          node.expression &&
          CHILDREN_EXPRESSION.test(node.expression.getText())
        ) {
          this.childrenInCardModules.add(module.file);
        }

        ts.forEachChild(node, (child: ts.Node): void => {
          visit(child, isInCard);
        });
      };

      visit(module.source, false);
    }
  }

  private containerName(module: ParsedModule, element: JsxLike): string | null {
    const name: string = nameOf(element).replace(TYPE_ARGUMENTS, "");

    // A door draws what it is given beside its card, not inside it.
    if (CARD_DOORS.includes(name)) {
      return null;
    }

    if (this.isCardElement(module, element)) {
      return name;
    }

    if (FRAMED_HOLDERS.includes(name)) {
      return name;
    }

    if (isHandBuiltFrame(element)) {
      return name;
    }

    const imported: string | undefined = module.imports.get(name);

    if (imported && this.childrenInCardModules.has(imported)) {
      return name;
    }

    return null;
  }

  private walk(
    module: ParsedModule,
    node: ts.Node,
    container: { name: string; line: number } | null,
    found: Array<CardNesting>,
  ): void {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name: string = nameOf(node).replace(TYPE_ARGUMENTS, "");

      if (container && this.isCardElement(module, node)) {
        found.push({
          file: module.file,
          line: lineOf(module.source, node),
          card: name,
          container: container.name,
          containerLine: container.line,
        });
      }

      let inner: { name: string; line: number } | null = container;

      if (SECTIONING.includes(name)) {
        inner = null;
      } else {
        const holder: string | null = this.containerName(module, node);

        if (holder) {
          inner = { name: holder, line: lineOf(module.source, node) };
        }
      }

      // What it is given - props as well as children - is drawn inside it.
      ts.forEachChild(openingOf(node).attributes, (child: ts.Node): void => {
        this.walk(module, child, inner, found);
      });

      if (ts.isJsxElement(node)) {
        for (const child of node.children) {
          this.walk(module, child, inner, found);
        }
      }

      return;
    }

    ts.forEachChild(node, (child: ts.Node): void => {
      this.walk(module, child, container, found);
    });
  }
}

export function scanCardNesting(
  sources: Array<CardNestingSource>,
  resolveImport: ImportResolver,
): Array<CardNesting> {
  return new CardNestingScanner(sources, resolveImport).nestings();
}

export function scanCardSectionsChildren(
  sources: Array<CardNestingSource>,
  resolveImport: ImportResolver,
): Array<CardSectionsChild> {
  return new CardNestingScanner(sources, resolveImport).sectionsChildren();
}

export function listCardDrawingModules(
  sources: Array<CardNestingSource>,
  resolveImport: ImportResolver,
): Array<string> {
  return new CardNestingScanner(sources, resolveImport).cardModuleFiles();
}

export function scanCardRows(
  sources: Array<CardNestingSource>,
  resolveImport: ImportResolver,
): Array<CardRow> {
  return new CardNestingScanner(sources, resolveImport).cardRows();
}

/*
 * Resolves a relative import, or one of Common ("Common/..."), to one of the
 * known modules: the .tsx file, or a directory's Index.tsx / index.tsx.
 */
export function makeImportResolver(knownFiles: Set<string>): ImportResolver {
  return (fromFile: string, specifier: string): string | null => {
    let base: string;

    if (specifier.startsWith(".")) {
      const directory: Array<string> = fromFile.split("/").slice(0, -1);

      for (const part of specifier.split("/")) {
        if (part === "." || part === "") {
          continue;
        }

        if (part === "..") {
          directory.pop();
        } else {
          directory.push(part);
        }
      }

      base = directory.join("/");
    } else if (specifier.startsWith("Common/")) {
      base = `packages/Common/${specifier.slice("Common/".length)}`;
    } else {
      return null;
    }

    for (const candidate of [
      `${base}.tsx`,
      `${base}/Index.tsx`,
      `${base}/index.tsx`,
    ]) {
      if (knownFiles.has(candidate)) {
        return candidate;
      }
    }

    return null;
  };
}
