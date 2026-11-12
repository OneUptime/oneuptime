import ts from "typescript";

/*
 * The detector behind the Data Observability card padding guard
 * (Tests/App/Dashboard/DataObservabilityCardPaddingGuard.test.ts, #6555).
 *
 * A card pads what it holds itself (Card's CARD_PADDING_CLASS_NAME, py-6
 * px-5 md:px-6), so what a card holds starts right under the first letter
 * of its title and ends a card's padding over its bottom edge, as on every
 * product's cards. A body that pads itself again - the px-6 pb-6 Data
 * Observability's cards had - starts 24px right of the title and leaves
 * 24px more under it.
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
 *   An element pads its card again when one of its classes, at any width
 *   or state (md:px-6 too), pads a side (p-, px-, pl-, pr-, ps-, pe-) or
 *   the bottom (p-, py-, pb-) - never pt-, which is the room under the
 *   header, nor a padding of 0. Two exceptions, each padding inside a
 *   box of the element's own rather than the card's: an element that
 *   draws a box - a border all round, a ring or a coloured background, at
 *   every width - pads its own content; and an element that bleeds over
 *   the card's padding on a side (-mx-6, -mb-6) pads back what it bleeds
 *   on that side.
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

type JsxLike = ts.JsxElement | ts.JsxSelfClosingElement;

// The module a card is the default export of: Common's Card, by package or by a relative path.
const CARD_MODULE: RegExp = /(?:^|\/)Card\/Card$/;
const FRAGMENT_NAMES: ReadonlyArray<string> = ["Fragment", "React.Fragment"];
// What runs a list's rows: their elements are the body's top level.
const LIST_METHODS: ReadonlyArray<string> = ["map", "flatMap"];
const CLASS_SEPARATOR: RegExp = /\s+/;
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
 * The sides of a card's padding a utility reaches: left and right, or the
 * reading direction's start and end (ps-, -ms-), and the bottom. The top is
 * the room under the header, never the card's padding again.
 */
type Side = "left" | "right" | "start" | "end" | "bottom";

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

/*
 * The module's names, as a card's body reads them: every expression a
 * variable is set to - where it is declared (let body = <div />) and at
 * every assignment (body = ...) - and what every function of the module
 * gives back (const renderRows = () => ..., function renderRows() {...}),
 * by name.
 */
interface ModuleNames {
  values: Map<string, Array<ts.Expression>>;
  returns: Map<string, Array<ts.Expression>>;
}

function namesOf(source: ts.SourceFile): ModuleNames {
  const names: ModuleNames = {
    values: new Map<string, Array<ts.Expression>>(),
    returns: new Map<string, Array<ts.Expression>>(),
  };

  const add: (
    table: Map<string, Array<ts.Expression>>,
    name: string,
    expressions: Array<ts.Expression>,
  ) => void = (
    table: Map<string, Array<ts.Expression>>,
    name: string,
    expressions: Array<ts.Expression>,
  ): void => {
    table.set(name, [...(table.get(name) || []), ...expressions]);
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      if (
        ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer)
      ) {
        add(names.returns, node.name.text, returnsOf(node.initializer));
      } else {
        add(names.values, node.name.text, [node.initializer]);
      }
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      add(names.returns, node.name.text, returnsOf(node));
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      add(names.values, node.left.text, [node.right]);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return names;
}

class BodyReader {
  private readonly names: ModuleNames;

  public constructor(source: ts.SourceFile) {
    this.names = namesOf(source);
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
        this.names.returns,
        expression.expression.text,
        namesRead,
      );
    }

    if (ts.isIdentifier(expression)) {
      return this.elementsOfName(this.names.values, expression.text, namesRead);
    }

    return [];
  }
}

// Every piece of text a class attribute is built from: a string, or the strings of the expression that builds one.
function classTextOf(element: JsxLike): string {
  const attribute: ts.JsxAttributeLike | undefined = openingOf(
    element,
  ).attributes.properties.find((property: ts.JsxAttributeLike): boolean => {
    return (
      ts.isJsxAttribute(property) && property.name.getText() === "className"
    );
  });

  if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer) {
    return "";
  }

  const pieces: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      pieces.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      pieces.push(node.head.text);

      for (const span of node.templateSpans) {
        visit(span.expression);
        pieces.push(span.literal.text);
      }

      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(attribute.initializer);

  return pieces.join(" ");
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
    utility: written.slice(lastColon + 1).replace(/^!/, ""),
    isUnconditional: lastColon === -1,
  };
}

function utilitiesOf(element: JsxLike): Array<ClassUtility> {
  return classTextOf(element)
    .split(CLASS_SEPARATOR)
    .filter(Boolean)
    .map(readClassUtility);
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

// The classes of an element that pad its card again, as written; none when it pads inside a box of its own.
export function paddingClassesOf(classNames: string): Array<string> {
  const utilities: Array<ClassUtility> = classNames
    .split(CLASS_SEPARATOR)
    .filter(Boolean)
    .map(readClassUtility);

  return paddingOf(utilities);
}

function paddingOf(utilities: Array<ClassUtility>): Array<string> {
  if (drawsOwnBox(utilities)) {
    return [];
  }

  const bled: Set<Side> = bledSidesOf(utilities);

  return utilities
    .filter((utility: ClassUtility): boolean => {
      const match: RegExpMatchArray | null =
        utility.utility.match(PADDING_UTILITY);

      if (!match || ZERO_VALUE.test(match[2]!)) {
        return false;
      }

      // Padding on a side the element does not bleed over is the card's padding again.
      return (PADDED_SIDES[match[1]!] || []).some((side: Side): boolean => {
        return !bled.has(side);
      });
    })
    .map((utility: ClassUtility): string => {
      return utility.written;
    });
}

// Every card of one module and every top-level element of its body that pads it again.
export function scanCardBodyPadding(
  file: CardBodyPaddingSource,
): CardBodyPaddingScan {
  const source: ts.SourceFile = ts.createSourceFile(
    file.file,
    file.text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const cardNames: Set<string> = cardNamesOf(source);
  const scan: CardBodyPaddingScan = { cardCount: 0, paddings: [] };

  if (cardNames.size === 0) {
    return scan;
  }

  const reader: BodyReader = new BodyReader(source);

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
      cardNames.has(nameOf(node))
    ) {
      scan.cardCount++;

      if (ts.isJsxElement(node)) {
        // An element reached two ways (a variable named twice) is told once.
        const elements: Set<JsxLike> = new Set<JsxLike>(
          reader.elementsOfChildren(node.children, new Set<string>()),
        );

        for (const element of elements) {
          const classes: Array<string> = paddingOf(utilitiesOf(element));

          if (classes.length > 0) {
            scan.paddings.push({
              file: file.file,
              line: lineOf(source, element),
              element: nameOf(element),
              classes,
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
