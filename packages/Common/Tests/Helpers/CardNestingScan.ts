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
 *   AdvancedPageSection; a FoldedSection drawn as a card (isElevated); a
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

const BASE_CARDS: ReadonlyArray<string> = [
  "Card",
  "CardModelDetail",
  "TableCard",
  "AdvancedPageSection",
];

const CARD_TABLES: ReadonlyArray<string> = [
  "ModelTable",
  "ModelList",
  "BaseModelTable",
];

// What holds cards as its sections.
const SECTIONING: ReadonlyArray<string> = ["CardSections", "AdvancedPageSection"];

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
  const findComponent: (
    node: ts.Node,
  ) => ts.FunctionLikeDeclaration | null = (
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

    if (ts.isFunctionDeclaration(node) && node.name && node.name.text === name) {
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

    if (BASE_CARDS.includes(name)) {
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
          const inCard: boolean =
            isInCard || this.isCardElement(module, node);

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
