import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The detector behind the card body padding guard
 * (Tests/App/Dashboard/CardBodyPaddingGuard.test.ts; #6555 for Data
 * Observability, #6956 for every other page).
 *
 * A card pads what it holds itself (Card's CARD_PADDING_CLASS_NAME, py-6
 * px-5 md:px-6), so what a card holds starts right under the first letter
 * of its title and ends a card's padding over its bottom edge, as on every
 * product's cards. A body that pads itself again - the px-6 pb-6 Data
 * Observability's cards had, the p-4 OpenStack's had - starts 16 to 24px
 * right of the title and leaves as much more under it.
 *
 * Read per module, through the TypeScript AST:
 *
 *   A card is an element of the module's default import of
 *   Common/UI/Components/Card/Card, whatever it is called there.
 *
 *   Its body's top-level elements are what its children draw first: each
 *   element among them, the elements of a fragment there (<>, Fragment,
 *   React.Fragment), both branches of a condition (a ? <p /> : <ul />,
 *   a && <div />), what a .map there gives back, and what a variable named
 *   there is set to anywhere in the module (let body = <div />; {body}).
 *   What those elements hold is theirs: a list row's own padding is not
 *   the card's.
 *
 *   An element's classes are every class its className could hold: its
 *   strings, and what each name in it stands for - a constant or a helper
 *   of the module, or of the module it is imported from when the scan is
 *   given a way to read imports (readImport): `${CARD_GRID_CENTERED_STATE_
 *   CLASS_NAME} py-6`, useCardRuledBodyClassName().
 *
 *   An element pads its card again when one of its classes, at any width
 *   or state (md:px-6 too), pads a side (p-, px-, pl-, pr-, ps-, pe-) or
 *   the bottom (p-, py-, pb-) - never pt-, which is the room under the
 *   header, nor a padding of 0. These pad something else than the card:
 *
 *   - an element that draws a box - a border all round, a ring or a
 *     coloured background, at every width - pads its own content;
 *   - an element that bleeds over the card's padding on a side (-mx-6,
 *     -mb-6) pads back what it bleeds on that side, and so does every
 *     element of a body the card itself bleeds (its bodyClassName: Home's
 *     row of cards, a ruled list);
 *   - an element that sets what it holds in its middle, across - a loading
 *     or an empty state: text-center, a flex row's justify-center, a flex
 *     column's items-center - and pads only above and below (py-12) gives
 *     that state its room: the padding is the state's, not the card's;
 *   - a bulleted list (a ul or ol with list-disc, list-decimal...) draws
 *     its bullets in the padding at its start (pl-5): that indent is the
 *     list's, and its bullets line up with the title.
 */

export interface CardBodyPaddingSource {
  // Repository-relative, with "/" separators.
  file: string;
  text: string;
}

export interface CardBodyPadding {
  file: string;
  // The padded element's line.
  line: number;
  // Its tag: div, ul, p, AppLink...
  element: string;
  // The classes that pad the card again, as written: px-6, sm:px-6, pb-6.
  classes: Array<string>;
  // The card's own line.
  cardLine: number;
}

export interface CardBodyPaddingScan {
  // Every card read, padded or not: what the guard counts to know it read them.
  cardCount: number;
  paddings: Array<CardBodyPadding>;
}

/*
 * Reads the module an import names, from the module that imports it
 * (repository-relative): how a class name built from another module's
 * constant or helper is read. Undefined for a package (react) or a module
 * it cannot find: its names are then read as nothing.
 */
export type CardBodyImportReader = (
  specifier: string,
  fromFile: string,
) => CardBodyPaddingSource | undefined;

export interface CardBodyPaddingScanOptions {
  readImport?: CardBodyImportReader | undefined;
}

type JsxLike = ts.JsxElement | ts.JsxSelfClosingElement;

// The module a card is the default export of: Common's Card, by package or by a relative path.
const CARD_MODULE: RegExp = /(?:^|\/)Card\/Card$/;
const FRAGMENT_NAMES: ReadonlyArray<string> = ["Fragment", "React.Fragment"];
// What runs a list's rows: their elements are the body's top level.
const LIST_METHODS: ReadonlyArray<string> = ["map", "flatMap"];
const CLASS_SEPARATOR: RegExp = /\s+/;
const IMPORTANT_MARK: RegExp = /^!/;
/*
 * A padding utility, without its variants: p-6, px-6, pb-[10px]. The value
 * is a scale step, px (1px) or an arbitrary [value].
 */
const PADDING_UTILITY: RegExp = /^(p|px|py|pl|pr|ps|pe|pt|pb)-(.+)$/;
// A negative margin utility, without its variants: -mx-6, -mb-[10px].
const NEGATIVE_MARGIN_UTILITY: RegExp = /^-(m|mx|my|ml|mr|ms|me|mt|mb)-(.+)$/;
// A padding or margin of nothing: 0, [0], [0px].
const ZERO_VALUE: RegExp = /^(?:0|\[0(?:px|rem|em)?\])$/;
// A border all round, of any width: border, border-2.
const BORDER_ALL_ROUND: RegExp = /^border(?:-\d+)?$/;
const RING: RegExp = /^ring(?:-\d+)?$/;
// A background of a colour of its own: bg-yellow-50, bg-gray-900/50, bg-black, bg-[#fafafa].
const COLOURED_BACKGROUND: RegExp =
  /^bg-(?:[a-z]+-\d{2,3}(?:\/\d+)?|black(?:\/\d+)?|\[.+\])$/;
/*
 * A list's marker: list-disc, list-decimal, list-[square]. Not list-none,
 * which draws none, nor where a marker sits (list-inside, list-outside) or
 * an image (list-image-*).
 */
const LIST_MARKER: RegExp = /^list-(?!none$|inside$|outside$|image-)(.+)$/;
const LIST_TAGS: ReadonlyArray<string> = ["ul", "ol"];
/*
 * How many names one class attribute is followed through - constants,
 * helpers and imports - before the rest are read as nothing.
 */
const MAXIMUM_NAMES_READ: number = 64;

/*
 * The sides of a card's padding a utility reaches: left and right, or the
 * reading direction's start and end (ps-, -ms-), and the bottom. The top is
 * the room under the header, never the card's padding again.
 */
type Side = "left" | "right" | "start" | "end" | "bottom";

const ACROSS_SIDES: ReadonlyArray<Side> = ["left", "right", "start", "end"];

// The sides each padding utility pads: px- both sides, py- the bottom (and the top).
const PADDED_SIDES: Readonly<Record<string, ReadonlyArray<Side>>> = {
  p: ["left", "right", "bottom"],
  px: ["left", "right"],
  pl: ["left"],
  pr: ["right"],
  ps: ["start"],
  pe: ["end"],
  py: ["bottom"],
  pb: ["bottom"],
  pt: [],
};

/*
 * The sides each negative margin bleeds over: -mx- both sides, whichever
 * the reading direction starts from, so its start and end too.
 */
const BLED_SIDES: Readonly<Record<string, ReadonlyArray<Side>>> = {
  m: ["left", "right", "start", "end", "bottom"],
  mx: ["left", "right", "start", "end"],
  ml: ["left"],
  mr: ["right"],
  ms: ["start"],
  me: ["end"],
  my: ["bottom"],
  mb: ["bottom"],
  mt: [],
};

/*
 * The paddings at a bulleted list's start, where its bullets are drawn.
 * Every Dashboard page reads pl- as the reading direction's start
 * (Common/UI/Styles/TailwindReadingDirection.js), so pl- is the start on a
 * right-to-left page too.
 */
const LIST_INDENT_KINDS: ReadonlyArray<string> = ["pl", "ps"];

interface ClassUtility {
  // As written: md:!px-6.
  written: string;
  // Without its variants and without !: px-6.
  utility: string;
  // Whether it applies at every width and state: no variant.
  isUnconditional: boolean;
}

function openingOf(element: JsxLike): ts.JsxOpeningLikeElement {
  return ts.isJsxElement(element) ? element.openingElement : element;
}

function nameOf(element: JsxLike): string {
  return openingOf(element).tagName.getText();
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

// The local names the module gives Common's Card: its default import of it.
function cardNamesOf(source: ts.SourceFile): Set<string> {
  const names: Set<string> = new Set<string>();

  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      CARD_MODULE.test(statement.moduleSpecifier.text) &&
      statement.importClause?.name
    ) {
      names.add(statement.importClause.name.text);
    }
  }

  return names;
}

type FunctionWithBody =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionDeclaration;

// What a function gives back: its expression body, or every return of its own block.
function returnsOf(declaration: FunctionWithBody): Array<ts.Expression> {
  if (!declaration.body) {
    return [];
  }

  if (!ts.isBlock(declaration.body)) {
    return [declaration.body];
  }

  const found: Array<ts.Expression> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    // A function inside gives back its own: not this one's.
    if (ts.isFunctionLike(node)) {
      return;
    }

    if (ts.isReturnStatement(node) && node.expression) {
      found.push(node.expression);
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(declaration.body, visit);

  return found;
}

// A name a module imports: the module it names, and the name there ("default" for a default import).
interface ImportedName {
  specifier: string;
  name: string;
}

/*
 * What one module says about its names: every expression a variable is set
 * to - where it is declared (let body = <div />) and at every assignment
 * (body = ...) - what every function of the module gives back
 * (const renderRows = () => ..., function renderRows() {...}), by name,
 * what it imports from where, and the local name of each name it exports.
 */
class ModuleFacts {
  public readonly file: string;
  public readonly source: ts.SourceFile;
  public readonly values: Map<string, Array<ts.Expression>> = new Map<
    string,
    Array<ts.Expression>
  >();
  public readonly returns: Map<string, Array<ts.Expression>> = new Map<
    string,
    Array<ts.Expression>
  >();
  public readonly imports: Map<string, ImportedName> = new Map<
    string,
    ImportedName
  >();
  // An exported name and the local name it exports: default -> Card.
  public readonly exported: Map<string, string> = new Map<string, string>();
  // A name exported from another module: export { X } from "./Y".
  public readonly reexported: Map<string, ImportedName> = new Map<
    string,
    ImportedName
  >();

  public constructor(module: CardBodyPaddingSource) {
    this.file = module.file;
    this.source = ts.createSourceFile(
      module.file,
      module.text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    this.readStatements();
    this.readNames(this.source);
  }

  private add(
    table: Map<string, Array<ts.Expression>>,
    name: string,
    expressions: Array<ts.Expression>,
  ): void {
    table.set(name, [...(table.get(name) || []), ...expressions]);
  }

  private readStatements(): void {
    for (const statement of this.source.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.importClause
      ) {
        const specifier: string = statement.moduleSpecifier.text;
        const clause: ts.ImportClause = statement.importClause;

        if (clause.name) {
          this.imports.set(clause.name.text, { specifier, name: "default" });
        }

        if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            this.imports.set(element.name.text, {
              specifier,
              name: (element.propertyName || element.name).text,
            });
          }
        }
      } else if (
        ts.isExportAssignment(statement) &&
        !statement.isExportEquals &&
        ts.isIdentifier(statement.expression)
      ) {
        this.exported.set("default", statement.expression.text);
      } else if (
        ts.isFunctionDeclaration(statement) &&
        statement.name &&
        statement.modifiers?.some((modifier: ts.ModifierLike): boolean => {
          return modifier.kind === ts.SyntaxKind.DefaultKeyword;
        })
      ) {
        this.exported.set("default", statement.name.text);
      } else if (
        ts.isExportDeclaration(statement) &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      ) {
        for (const element of statement.exportClause.elements) {
          const local: string = (element.propertyName || element.name).text;

          if (
            statement.moduleSpecifier &&
            ts.isStringLiteral(statement.moduleSpecifier)
          ) {
            this.reexported.set(element.name.text, {
              specifier: statement.moduleSpecifier.text,
              name: local,
            });
          } else {
            this.exported.set(element.name.text, local);
          }
        }
      }
    }
  }

  private readNames(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      if (
        ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer)
      ) {
        this.add(this.returns, node.name.text, returnsOf(node.initializer));
      } else {
        this.add(this.values, node.name.text, [node.initializer]);
      }
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      this.add(this.returns, node.name.text, returnsOf(node));
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      this.add(this.values, node.left.text, [node.right]);
    }

    ts.forEachChild(node, (child: ts.Node): void => {
      this.readNames(child);
    });
  }
}

// The modules one scan reads: the scanned one and those its class names are imported from, each read once.
class ModuleSet {
  private readonly modules: Map<string, ModuleFacts | null> = new Map<
    string,
    ModuleFacts | null
  >();
  private readonly readImport: CardBodyImportReader | undefined;

  public constructor(readImport: CardBodyImportReader | undefined) {
    this.readImport = readImport;
  }

  public read(module: CardBodyPaddingSource): ModuleFacts {
    const facts: ModuleFacts = new ModuleFacts(module);

    this.modules.set(module.file, facts);

    return facts;
  }

  public imported(
    from: ModuleFacts,
    specifier: string,
  ): ModuleFacts | undefined {
    if (!this.readImport) {
      return undefined;
    }

    const source: CardBodyPaddingSource | undefined = this.readImport(
      specifier,
      from.file,
    );

    if (!source) {
      return undefined;
    }

    if (!this.modules.has(source.file)) {
      this.modules.set(source.file, new ModuleFacts(source));
    }

    return this.modules.get(source.file) || undefined;
  }
}

type NameKind = "value" | "returns";

/*
 * Every string a class expression could hold, in pieces: its strings, and
 * what each name in it stands for, followed through the module's constants
 * and helpers and the modules they are imported from. Both branches of a
 * condition count, so an element has every class it could have.
 */
class ClassReader {
  private readonly modules: ModuleSet;

  public constructor(modules: ModuleSet) {
    this.modules = modules;
  }

  public piecesOf(node: ts.Node, module: ModuleFacts): Array<string> {
    const pieces: Array<string> = [];

    this.visit(node, module, new Set<string>(), pieces);

    return pieces;
  }

  private visit(
    node: ts.Node,
    module: ModuleFacts,
    namesRead: Set<string>,
    pieces: Array<string>,
  ): void {
    // A type names no class: x as string.
    if (ts.isTypeNode(node)) {
      return;
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      pieces.push(node.text);
      return;
    }

    if (ts.isTemplateExpression(node)) {
      pieces.push(node.head.text);

      for (const span of node.templateSpans) {
        this.visit(span.expression, module, namesRead, pieces);
        pieces.push(span.literal.text);
      }

      return;
    }

    // A helper called by name: what it gives back, and what it is given.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      this.visitName(
        node.expression.text,
        "returns",
        module,
        namesRead,
        pieces,
      );

      for (const argument of node.arguments) {
        this.visit(argument, module, namesRead, pieces);
      }

      return;
    }

    // A property's name is not a name of the module: x.className.
    if (ts.isPropertyAccessExpression(node)) {
      this.visit(node.expression, module, namesRead, pieces);
      return;
    }

    if (ts.isIdentifier(node)) {
      this.visitName(node.text, "value", module, namesRead, pieces);
      return;
    }

    ts.forEachChild(node, (child: ts.Node): void => {
      this.visit(child, module, namesRead, pieces);
    });
  }

  private visitName(
    name: string,
    kind: NameKind,
    module: ModuleFacts,
    namesRead: Set<string>,
    pieces: Array<string>,
  ): void {
    const key: string = `${module.file}#${kind}#${name}`;

    if (namesRead.has(key) || namesRead.size >= MAXIMUM_NAMES_READ) {
      return;
    }

    namesRead.add(key);

    const table: Map<string, Array<ts.Expression>> = kind === "value"
      ? module.values
      : module.returns;
    const own: Array<ts.Expression> | undefined = table.get(name);

    if (own) {
      for (const expression of own) {
        this.visit(expression, module, namesRead, pieces);
      }

      return;
    }

    const imported: ImportedName | undefined = module.imports.get(name);

    if (imported) {
      this.visitExported(imported, kind, module, namesRead, pieces);
    }
  }

  // A name another module exports, by the name it exports it as.
  private visitExported(
    imported: ImportedName,
    kind: NameKind,
    from: ModuleFacts,
    namesRead: Set<string>,
    pieces: Array<string>,
  ): void {
    const target: ModuleFacts | undefined = this.modules.imported(
      from,
      imported.specifier,
    );

    if (!target) {
      return;
    }

    const reexported: ImportedName | undefined = target.reexported.get(
      imported.name,
    );

    if (reexported) {
      this.visitExported(reexported, kind, target, namesRead, pieces);
      return;
    }

    this.visitName(
      target.exported.get(imported.name) || imported.name,
      kind,
      target,
      namesRead,
      pieces,
    );
  }
}

class BodyReader {
  private readonly module: ModuleFacts;

  public constructor(module: ModuleFacts) {
    this.module = module;
  }

  /*
   * What a name of the module stands for, read once: a variable set to
   * itself, or a helper that calls itself, is not read again.
   */
  private elementsOfName(
    table: Map<string, Array<ts.Expression>>,
    name: string,
    namesRead: Set<string>,
  ): Array<JsxLike> {
    if (namesRead.has(name)) {
      return [];
    }

    const read: Set<string> = new Set<string>([...namesRead, name]);

    return (table.get(name) || []).flatMap(
      (value: ts.Expression): Array<JsxLike> => {
        return this.elementsOfExpression(value, read);
      },
    );
  }

  // The top-level elements of what a card holds.
  public elementsOfChildren(
    children: ts.NodeArray<ts.JsxChild>,
    namesRead: Set<string>,
  ): Array<JsxLike> {
    return children.flatMap((child: ts.JsxChild): Array<JsxLike> => {
      if (ts.isJsxExpression(child)) {
        return child.expression
          ? this.elementsOfExpression(child.expression, namesRead)
          : [];
      }

      if (
        ts.isJsxElement(child) ||
        ts.isJsxSelfClosingElement(child) ||
        ts.isJsxFragment(child)
      ) {
        return this.elementsOfExpression(child, namesRead);
      }

      // Text between the elements.
      return [];
    });
  }

  public elementsOfExpression(
    expression: ts.Expression,
    namesRead: Set<string>,
  ): Array<JsxLike> {
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isNonNullExpression(expression) ||
      ts.isTypeAssertionExpression(expression)
    ) {
      return this.elementsOfExpression(expression.expression, namesRead);
    }

    if (ts.isJsxFragment(expression)) {
      return this.elementsOfChildren(expression.children, namesRead);
    }

    if (ts.isJsxElement(expression) || ts.isJsxSelfClosingElement(expression)) {
      if (FRAGMENT_NAMES.includes(nameOf(expression))) {
        return ts.isJsxElement(expression)
          ? this.elementsOfChildren(expression.children, namesRead)
          : [];
      }

      return [expression];
    }

    if (ts.isConditionalExpression(expression)) {
      return [
        ...this.elementsOfExpression(expression.whenTrue, namesRead),
        ...this.elementsOfExpression(expression.whenFalse, namesRead),
      ];
    }

    if (ts.isBinaryExpression(expression)) {
      const operator: ts.SyntaxKind = expression.operatorToken.kind;

      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
        return this.elementsOfExpression(expression.right, namesRead);
      }

      if (
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken
      ) {
        return [
          ...this.elementsOfExpression(expression.left, namesRead),
          ...this.elementsOfExpression(expression.right, namesRead),
        ];
      }

      return [];
    }

    if (
      ts.isCallExpression(expression) &&
      ts.isPropertyAccessExpression(expression.expression) &&
      LIST_METHODS.includes(expression.expression.name.text)
    ) {
      const row: ts.Expression | undefined = expression.arguments[0];

      if (row && (ts.isArrowFunction(row) || ts.isFunctionExpression(row))) {
        return returnsOf(row).flatMap(
          (returned: ts.Expression): Array<JsxLike> => {
            return this.elementsOfExpression(returned, namesRead);
          },
        );
      }

      return [];
    }

    // A render helper of the module, called there: {renderRows()}.
    if (
      ts.isCallExpression(expression) &&
      ts.isIdentifier(expression.expression)
    ) {
      return this.elementsOfName(
        this.module.returns,
        expression.expression.text,
        namesRead,
      );
    }

    if (ts.isIdentifier(expression)) {
      return this.elementsOfName(
        this.module.values,
        expression.text,
        namesRead,
      );
    }

    return [];
  }
}

// The value an element gives an attribute: className, or a card's bodyClassName.
function attributeOf(
  element: JsxLike,
  name: string,
): ts.JsxAttributeValue | undefined {
  const attribute: ts.JsxAttributeLike | undefined = openingOf(
    element,
  ).attributes.properties.find((property: ts.JsxAttributeLike): boolean => {
    return ts.isJsxAttribute(property) && property.name.getText() === name;
  });

  if (!attribute || !ts.isJsxAttribute(attribute)) {
    return undefined;
  }

  return attribute.initializer;
}

/*
 * A class as written, split into its utility and whether it has variants.
 * The utility follows the last colon outside brackets:
 * [@container(min-width:24rem)]:px-6 is px-6 in a wide container.
 */
export function readClassUtility(written: string): ClassUtility {
  let depth: number = 0;
  let lastColon: number = -1;

  for (let index: number = 0; index < written.length; index++) {
    const character: string = written[index]!;

    if (character === "[" || character === "(") {
      depth++;
    } else if (character === "]" || character === ")") {
      depth = Math.max(0, depth - 1);
    } else if (character === ":" && depth === 0) {
      lastColon = index;
    }
  }

  return {
    written,
    utility: written.slice(lastColon + 1).replace(IMPORTANT_MARK, ""),
    isUnconditional: lastColon === -1,
  };
}

function utilitiesOfText(classNames: string): Array<ClassUtility> {
  return classNames
    .split(CLASS_SEPARATOR)
    .filter(Boolean)
    .map(readClassUtility);
}

// The utilities that hold at every width and state, without their variants.
function unconditionalUtilitiesOf(utilities: Array<ClassUtility>): Set<string> {
  return new Set<string>(
    utilities
      .filter((utility: ClassUtility): boolean => {
        return utility.isUnconditional;
      })
      .map((utility: ClassUtility): string => {
        return utility.utility;
      }),
  );
}

// Whether an element draws a box of its own at every width: a border all round, a ring or a coloured background.
function drawsOwnBox(utilities: Array<ClassUtility>): boolean {
  return utilities.some((utility: ClassUtility): boolean => {
    return (
      utility.isUnconditional &&
      (BORDER_ALL_ROUND.test(utility.utility) ||
        RING.test(utility.utility) ||
        COLOURED_BACKGROUND.test(utility.utility))
    );
  });
}

/*
 * Whether an element sets what it holds in the middle of its width, at
 * every width: centred text, a flex row's items centred along it, a flex
 * column's centred across it, or a grid's centred in their cells.
 */
function centresAcross(utilities: Array<ClassUtility>): boolean {
  const always: Set<string> = unconditionalUtilitiesOf(utilities);
  const isFlex: boolean = always.has("flex") || always.has("inline-flex");
  const isColumn: boolean = always.has("flex-col");
  const isGrid: boolean = always.has("grid") || always.has("inline-grid");

  return (
    always.has("text-center") ||
    (isFlex && !isColumn && always.has("justify-center")) ||
    (isFlex && isColumn && always.has("items-center")) ||
    (isGrid &&
      (always.has("place-items-center") || always.has("justify-items-center")))
  );
}

// Whether an element is a list that draws its bullets or numbers in the padding at its start.
function isBulletedList(tag: string, utilities: Array<ClassUtility>): boolean {
  const always: Set<string> = unconditionalUtilitiesOf(utilities);

  return (
    LIST_TAGS.includes(tag) &&
    !always.has("list-inside") &&
    [...always].some((utility: string): boolean => {
      return LIST_MARKER.test(utility);
    })
  );
}

// The sides of the card's padding an element bleeds over with negative margins.
function bledSidesOf(utilities: Array<ClassUtility>): Set<Side> {
  const sides: Set<Side> = new Set<Side>();

  for (const utility of utilities) {
    const match: RegExpMatchArray | null = utility.utility.match(
      NEGATIVE_MARGIN_UTILITY,
    );

    if (match && !ZERO_VALUE.test(match[2]!)) {
      for (const side of BLED_SIDES[match[1]!] || []) {
        sides.add(side);
      }
    }
  }

  return sides;
}

export interface CardBodyElementClasses {
  // Every class the element could have, as written.
  classNames: string;
  // Its tag: div, ul, p. A list's bullets are drawn in its start padding.
  tag?: string | undefined;
  // Every class the card's body could have (its bodyClassName): a body that bleeds lets its elements pad back.
  cardBodyClassNames?: string | undefined;
}

/*
 * The classes of an element that pad its card again, as written; none when
 * it pads inside a box of its own, pads back what it or its card's body
 * bleeds, gives a centred state its room, or draws a list's bullets.
 */
export function paddingClassesOf(
  element: string | CardBodyElementClasses,
): Array<string> {
  const read: CardBodyElementClasses =
    typeof element === "string" ? { classNames: element } : element;

  return paddingOf(
    utilitiesOfText(read.classNames),
    read.tag || "div",
    bledSidesOf(utilitiesOfText(read.cardBodyClassNames || "")),
  );
}

function paddingOf(
  utilities: Array<ClassUtility>,
  tag: string,
  cardBodyBled: Set<Side>,
): Array<string> {
  if (drawsOwnBox(utilities)) {
    return [];
  }

  const bled: Set<Side> = new Set<Side>([
    ...cardBodyBled,
    ...bledSidesOf(utilities),
  ]);
  const isList: boolean = isBulletedList(tag, utilities);

  // Each padding and the sides of the card's padding it pads again.
  const paddings: Array<{ utility: ClassUtility; sides: Array<Side> }> =
    utilities.flatMap(
      (
        utility: ClassUtility,
      ): Array<{ utility: ClassUtility; sides: Array<Side> }> => {
        const match: RegExpMatchArray | null =
          utility.utility.match(PADDING_UTILITY);

        if (!match || ZERO_VALUE.test(match[2]!)) {
          return [];
        }

        const kind: string = match[1]!;

        // A list's start padding is where its bullets are drawn.
        if (isList && LIST_INDENT_KINDS.includes(kind)) {
          return [];
        }

        // Padding on a side the element does not bleed over is the card's padding again.
        const sides: Array<Side> = (PADDED_SIDES[kind] || []).filter(
          (side: Side): boolean => {
            return !bled.has(side);
          },
        );

        return sides.length > 0 ? [{ utility, sides }] : [];
      },
    );

  const padsAcross: boolean = paddings.some(
    (padding: { utility: ClassUtility; sides: Array<Side> }): boolean => {
      return padding.sides.some((side: Side): boolean => {
        return ACROSS_SIDES.includes(side);
      });
    },
  );

  // A state centred across, padded only above and below: the room is the state's.
  if (!padsAcross && centresAcross(utilities)) {
    return [];
  }

  return paddings.map(
    (padding: { utility: ClassUtility; sides: Array<Side> }): string => {
      return padding.utility.written;
    },
  );
}

// Every card of one module and every top-level element of its body that pads it again.
export function scanCardBodyPadding(
  file: CardBodyPaddingSource,
  options: CardBodyPaddingScanOptions = {},
): CardBodyPaddingScan {
  const scan: CardBodyPaddingScan = { cardCount: 0, paddings: [] };
  const modules: ModuleSet = new ModuleSet(options.readImport);
  const module: ModuleFacts = modules.read(file);
  const source: ts.SourceFile = module.source;
  const cardNames: Set<string> = cardNamesOf(source);

  if (cardNames.size === 0) {
    return scan;
  }

  const reader: BodyReader = new BodyReader(module);
  const classes: ClassReader = new ClassReader(modules);

  const utilitiesOfAttribute: (
    element: JsxLike,
    name: string,
  ) => Array<ClassUtility> = (
    element: JsxLike,
    name: string,
  ): Array<ClassUtility> => {
    const value: ts.JsxAttributeValue | undefined = attributeOf(element, name);

    return value
      ? utilitiesOfText(classes.piecesOf(value, module).join(" "))
      : [];
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
      cardNames.has(nameOf(node))
    ) {
      scan.cardCount++;

      if (ts.isJsxElement(node)) {
        // What the card's own body bleeds (bodyClassName): its elements pad that back.
        const cardBodyBled: Set<Side> = bledSidesOf(
          utilitiesOfAttribute(node, "bodyClassName"),
        );
        // An element reached two ways (a variable named twice) is told once.
        const elements: Set<JsxLike> = new Set<JsxLike>(
          reader.elementsOfChildren(node.children, new Set<string>()),
        );

        for (const element of elements) {
          const padded: Array<string> = paddingOf(
            utilitiesOfAttribute(element, "className"),
            nameOf(element),
            cardBodyBled,
          );

          if (padded.length > 0) {
            scan.paddings.push({
              file: file.file,
              line: lineOf(source, element),
              element: nameOf(element),
              classes: padded,
              cardLine: lineOf(source, node),
            });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return scan;
}

/*
 * The frontends' module names, as their bundles resolve them: Common's
 * modules by package, the Dashboard's and the Admin Dashboard's own from ee
 * (Common/UI/esbuild-enterprise.js).
 */
const PACKAGE_FOLDERS: ReadonlyArray<{ prefix: string; folder: string }> = [
  { prefix: "Common/", folder: "packages/Common/" },
  {
    prefix: "@oneuptime/dashboard/",
    folder: "packages/App/FeatureSet/Dashboard/src/",
  },
  {
    prefix: "@oneuptime/admin-dashboard/",
    folder: "packages/App/FeatureSet/AdminDashboard/src/",
  },
];

const MODULE_EXTENSIONS: ReadonlyArray<string> = [
  ".ts",
  ".tsx",
  "/index.ts",
  "/index.tsx",
  "",
];

/*
 * Reads a frontend's imports from a checkout of the repository: a relative
 * module, or one of the package names above. Anything else (react, a
 * package) is read as nothing.
 */
export function createRepositoryImportReader(
  repositoryRoot: string,
): CardBodyImportReader {
  const cache: Map<string, CardBodyPaddingSource | undefined> = new Map<
    string,
    CardBodyPaddingSource | undefined
  >();

  return (
    specifier: string,
    fromFile: string,
  ): CardBodyPaddingSource | undefined => {
    let base: string | undefined = undefined;

    if (specifier.startsWith(".")) {
      base = path.posix.join(path.posix.dirname(fromFile), specifier);
    } else {
      const folder: { prefix: string; folder: string } | undefined =
        PACKAGE_FOLDERS.find((entry: { prefix: string }): boolean => {
          return specifier.startsWith(entry.prefix);
        });

      if (folder) {
        base = `${folder.folder}${specifier.slice(folder.prefix.length)}`;
      }
    }

    if (!base) {
      return undefined;
    }

    if (cache.has(base)) {
      return cache.get(base);
    }

    let found: CardBodyPaddingSource | undefined = undefined;

    for (const extension of MODULE_EXTENSIONS) {
      const file: string = `${base}${extension}`;
      const absolute: string = path.join(repositoryRoot, file);

      if (
        (file.endsWith(".ts") || file.endsWith(".tsx")) &&
        fs.existsSync(absolute) &&
        fs.statSync(absolute).isFile()
      ) {
        found = { file, text: fs.readFileSync(absolute, "utf8") };
        break;
      }
    }

    cache.set(base, found);

    return found;
  };
}
