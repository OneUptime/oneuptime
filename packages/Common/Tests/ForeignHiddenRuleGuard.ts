import fs from "fs";
import path from "path";
import ts from "typescript";
import { splitVariants } from "./ResponsiveVisibility";

/*
 * The detector behind the "no class string leans on a variant to undo a bare
 * `hidden`" guard (Tests/UI/ForeignHiddenRuleGuard.test.ts).
 *
 * Why the rule exists: a customer's dashboard rendered with no navigation bar
 * at all - no Home, no Products menu, so no way into any product - because
 * their browser carried `.hidden{display:none !important}`. Bootstrap 3 and
 * HTML5 Boilerplate ship exactly that rule, and browser extensions and user
 * stylesheets inject it into every page they touch. It matches the bare
 * `hidden` class and outranks every responsive or state utility we emit (it
 * is !important, or merely appended after Tailwind's <style> at equal
 * specificity), so an element written `hidden md:flex` stayed hidden at every
 * width. `max-md:hidden md:flex` displays identically everywhere and never
 * carries the class the foreign rule targets.
 *
 * What it flags:
 *
 *   1. One string - a string literal, a template without substitutions, or
 *      the static text of a template literal - whose class tokens include the
 *      bare `hidden` AND a variant-prefixed display utility that could show
 *      the element again: md:flex, max-lg:block, group-hover:flex,
 *      peer-checked:inline, [&.open]:grid, dark:block ...
 *   2. The same pair split across the pieces of one class expression: a
 *      JSX attribute or a variable / property / parameter whose name matches
 *      /class/i, a clsx / classNames / cn / cx / twMerge / twJoin call, or a
 *      template literal with the pieces in its substitutions. Only pieces
 *      that can end up in the class value together count: the two branches
 *      of a ternary (or of || and ??) never meet, a ternary's condition is
 *      not class text, and an object literal holds classes for different
 *      elements.
 *
 * What it deliberately lets through: a lone `hidden` (toggled from
 * JavaScript - the foreign rule can only hide more, never less), `md:hidden`,
 * `max-md:hidden md:flex`, `flex lg:hidden`, `overflow-hidden`, and anything
 * in a comment or in JSX text, because only real string syntax is read.
 * Tokens glued to a `${...}` substitution are not whole classes and are not
 * read either.
 */

/*
 * Tailwind's display utilities, `hidden` included. Kept in step with the
 * list in ResponsiveVisibility.ts.
 */
const DISPLAY_UTILITIES: ReadonlySet<string> = new Set<string>([
  "block",
  "inline-block",
  "inline",
  "flex",
  "inline-flex",
  "table",
  "inline-table",
  "table-caption",
  "table-cell",
  "table-column",
  "table-column-group",
  "table-footer-group",
  "table-header-group",
  "table-row-group",
  "table-row",
  "flow-root",
  "grid",
  "inline-grid",
  "contents",
  "list-item",
  "hidden",
]);

const BREAKPOINTS: ReadonlyArray<string> = ["sm", "md", "lg", "xl", "2xl"];

// The helpers whose arguments are all class text.
const CLASS_HELPERS: ReadonlySet<string> = new Set<string>([
  "clsx",
  "classnames",
  "classNames",
  "cn",
  "cx",
  "twMerge",
  "twJoin",
]);

// Methods that pass class text through: [...].join(" "), `...`.trim().
const PASS_THROUGH_METHODS: ReadonlySet<string> = new Set<string>([
  "join",
  "trim",
  "concat",
]);

const CLASS_NAME_PATTERN: RegExp = /class/i;

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "dist",
  "build",
]);

// The two hand-converted state-variant sites the failure message points at.
export const GROUP_HOVER_EXAMPLE_FILE: string =
  "packages/Common/UI/Components/LogsViewer/components/FacetValueRow.tsx";
export const DISCLOSURE_EXAMPLE_FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/View/ExecutionView.tsx";

export const STATE_VARIANT_ADVICE: string = `no breakpoint rewrite exists for this variant: show the element by default and hide it under the negated state instead - \`flex ... group-[:not(:hover)]:hidden\` (${GROUP_HOVER_EXAMPLE_FILE}) or, for a <details> disclosure, the structural \`inline [details:not([open])>summary>&]:hidden\` (${DISCLOSURE_EXAMPLE_FILE})`;

export const MIXED_BREAKPOINT_ADVICE: string =
  "the utilities that show it mix min-width and max-width screens, so no single rewrite of the bare `hidden` is exact: keep the display utilities and hide it with `max-<bp>:hidden` / `<bp>:hidden` for exactly the ranges it should be hidden in";

export const DISAGREEING_PIECES_ADVICE: string =
  "the pieces that show it never meet (they are alternative branches) and un-hide it at different screens, so no single rewrite of the bare `hidden` is exact: move the `max-<bp>:hidden` into each branch, next to the utility it pairs with";

export const WHY_PARAGRAPH: string =
  "Why: a customer's dashboard rendered with no navigation bar (no Home, no Products menu, so no way into any product) because their browser carried `.hidden{display:none !important}` - Bootstrap 3 and HTML5 Boilerplate ship exactly that rule, and browser extensions and user stylesheets inject it into pages they touch. It matches the bare `hidden` class and beats every responsive or state utility we emit (it is !important, or merely appended after Tailwind's <style> at equal specificity), so an element written `hidden md:flex` stays hidden at every width. `max-md:hidden md:flex` displays identically at every width and never carries the class that rule targets. A lone `hidden` toggled from JavaScript is fine: the foreign rule can only hide more.";

export type FindingKind = "same-string" | "cross-piece";

export interface ForeignHiddenRuleFinding {
  // As passed to analyzeSource (the scan passes a repository-relative path).
  file: string;
  line: number;
  kind: FindingKind;
  // The string that carries the bare `hidden`, as written.
  text: string;
  // cross-piece: the other piece of the class expression that shows it again.
  partnerText: string | null;
  // The variant display utilities that show the element again.
  unhidingTokens: Array<string>;
  // What to write instead of `text`, when a mechanical rewrite is exact.
  replacement: string | null;
  advice: string;
}

// A class string that hides with a variant-prefixed `hidden` (the safe forms).
export interface VariantHiddenSite {
  file: string;
  line: number;
  text: string;
}

export interface SourceAnalysis {
  findings: Array<ForeignHiddenRuleFinding>;
  variantHiddenSites: Array<VariantHiddenSite>;
}

export interface ForeignHiddenRuleScan extends SourceAnalysis {
  files: Array<string>;
}

interface ParsedToken {
  variants: Array<string>;
  utility: string;
}

/*
 * One piece of class text. A template literal is one unit: its static parts
 * always meet in the same value. `parts` has one more entry than
 * `substitutions`.
 */
interface ClassTextUnit {
  node: ts.Node;
  parts: Array<string>;
  substitutions: Array<string>;
  tokens: Array<string>;
}

interface Branch {
  node: ts.Node;
  side: number;
}

interface PlacedUnit {
  unit: ClassTextUnit;
  branches: Array<Branch>;
}

interface Rewrite {
  replacement: string | null;
  advice: string;
}

interface BreakpointFix {
  direction: "min" | "max";
  breakpointIndex: number;
}

/* A file's path relative to baseDir, with "/" separators on every platform. */
export function toRelativePath(baseDir: string, filePath: string): string {
  return path.relative(baseDir, filePath).split(path.sep).join("/");
}

/*
 * The directories the guard reads: every feature set's browser source, the
 * shared UI, and the Enterprise screens when ee/ is in the checkout (the
 * Community Edition checkout, and the Common Test job, have no ee/).
 */
export function listScanRoots(repositoryRoot: string): Array<string> {
  const featureSetDir: string = path.join(
    repositoryRoot,
    "packages",
    "App",
    "FeatureSet",
  );

  const roots: Array<string> = fs
    .readdirSync(featureSetDir, { withFileTypes: true })
    .filter((entry: fs.Dirent): boolean => {
      return entry.isDirectory();
    })
    .map((entry: fs.Dirent): string => {
      return path.join(featureSetDir, entry.name, "src");
    })
    .filter((directory: string): boolean => {
      return fs.existsSync(directory);
    })
    .sort();

  roots.push(path.join(repositoryRoot, "packages", "Common", "UI"));

  for (const enterpriseScreen of ["Dashboard", "AdminDashboard"]) {
    const directory: string = path.join(repositoryRoot, "ee", enterpriseScreen);

    if (fs.existsSync(directory)) {
      roots.push(directory);
    }
  }

  return roots;
}

/* Every .ts / .tsx module under a directory, declaration files excluded. */
export function listSourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        found.push(...listSourceFiles(fullPath));
      }
      continue;
    }

    if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      found.push(fullPath);
    }
  }

  return found;
}

function parseToken(token: string): ParsedToken {
  const parts: Array<string> = splitVariants(token);

  return {
    variants: parts.slice(0, -1),
    // `md:!flex` (and Tailwind 4's `md:flex!`) is still a display utility.
    utility: parts[parts.length - 1]!.replace(/^!|!$/g, ""),
  };
}

/* Exactly `hidden`: the only spelling the foreign `.hidden` rule matches. */
export function isBareHidden(token: string): boolean {
  return token === "hidden";
}

/*
 * A display utility behind at least one variant that sets something other
 * than `none`: md:flex, max-lg:block, group-hover:flex, [&.open]:grid ...
 */
export function isUnhidingToken(token: string): boolean {
  const parsed: ParsedToken = parseToken(token);

  return (
    parsed.variants.length > 0 &&
    parsed.utility !== "hidden" &&
    DISPLAY_UTILITIES.has(parsed.utility)
  );
}

/* md:hidden, max-md:hidden, group-[:not(:hover)]:hidden ... */
export function isVariantHidden(token: string): boolean {
  const parsed: ParsedToken = parseToken(token);

  return parsed.variants.length > 0 && parsed.utility === "hidden";
}

interface TokenOccurrence {
  partIndex: number;
  start: number;
  end: number;
  text: string;
}

/*
 * The whole class tokens of a unit, with their positions. A token that
 * touches a `${...}` is only part of a class name, so it is left out.
 */
function tokenOccurrences(parts: Array<string>): Array<TokenOccurrence> {
  const occurrences: Array<TokenOccurrence> = [];

  parts.forEach((part: string, partIndex: number): void => {
    const pattern: RegExp = /\S+/g;
    let match: RegExpExecArray | null = pattern.exec(part);

    while (match) {
      const start: number = match.index;
      const end: number = start + match[0].length;
      const gluedBefore: boolean = partIndex > 0 && start === 0;
      const gluedAfter: boolean =
        partIndex < parts.length - 1 && end === part.length;

      if (!gluedBefore && !gluedAfter) {
        occurrences.push({ partIndex, start, end, text: match[0] });
      }

      match = pattern.exec(part);
    }
  });

  return occurrences;
}

function makeUnit(
  node: ts.Node,
  parts: Array<string>,
  substitutions: Array<string>,
): ClassTextUnit {
  return {
    node,
    parts,
    substitutions,
    tokens: tokenOccurrences(parts).map(
      (occurrence: TokenOccurrence): string => {
        return occurrence.text;
      },
    ),
  };
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ");
}

function renderParts(
  parts: Array<string>,
  substitutions: Array<string>,
): string {
  let text: string = parts[0] || "";

  substitutions.forEach((substitution: string, index: number): void => {
    text += `\${${collapse(substitution)}}${parts[index + 1] || ""}`;
  });

  // A multi-line string reads as one line in a failure message.
  return text.includes("\n") ? collapse(text).trim() : text;
}

function renderUnit(unit: ClassTextUnit): string {
  return renderParts(unit.parts, unit.substitutions);
}

/* The unit with each whole token passed through `mapToken`. */
function mapTokens(
  unit: ClassTextUnit,
  mapToken: (token: string) => string,
): string {
  const occurrences: Array<TokenOccurrence> = tokenOccurrences(unit.parts);

  const parts: Array<string> = unit.parts.map(
    (part: string, partIndex: number): string => {
      let rebuilt: string = "";
      let cursor: number = 0;

      for (const occurrence of occurrences) {
        if (occurrence.partIndex !== partIndex) {
          continue;
        }

        rebuilt += part.slice(cursor, occurrence.start);
        rebuilt += mapToken(occurrence.text);
        cursor = occurrence.end;
      }

      return rebuilt + part.slice(cursor);
    },
  );

  return renderParts(parts, unit.substitutions);
}

/*
 * The screen a lone breakpoint variant un-hides from, or null for anything
 * else (a state, an arbitrary screen like min-[900px], or a stack).
 */
function breakpointFixOf(token: string): BreakpointFix | null {
  const parsed: ParsedToken = parseToken(token);

  if (parsed.variants.length !== 1) {
    return null;
  }

  const variant: string = parsed.variants[0]!;
  const isMax: boolean = variant.startsWith("max-");
  const breakpointIndex: number = BREAKPOINTS.indexOf(
    isMax ? variant.slice(4) : variant,
  );

  if (breakpointIndex === -1) {
    return null;
  }

  return { direction: isMax ? "max" : "min", breakpointIndex };
}

/*
 * The one breakpoint rewrite for a set of tokens that always meet: min-width
 * un-hiders take `max-<narrowest>:hidden`, max-width ones `<widest>:hidden`.
 */
function combinedBreakpointFix(tokens: Array<string>): BreakpointFix | null {
  let combined: BreakpointFix | null = null;

  for (const token of tokens) {
    const fix: BreakpointFix | null = breakpointFixOf(token);

    if (!fix || (combined && combined.direction !== fix.direction)) {
      return null;
    }

    if (!combined) {
      combined = fix;
      continue;
    }

    combined = {
      direction: fix.direction,
      breakpointIndex:
        fix.direction === "min"
          ? Math.min(combined.breakpointIndex, fix.breakpointIndex)
          : Math.max(combined.breakpointIndex, fix.breakpointIndex),
    };
  }

  return combined;
}

function hiddenTokenFor(fix: BreakpointFix): string {
  const breakpoint: string = BREAKPOINTS[fix.breakpointIndex]!;

  return fix.direction === "min"
    ? `max-${breakpoint}:hidden`
    : `${breakpoint}:hidden`;
}

function breakpointRewrite(unit: ClassTextUnit, fix: BreakpointFix): Rewrite {
  const hiddenToken: string = hiddenTokenFor(fix);

  return {
    replacement: mapTokens(unit, (token: string): string => {
      return isBareHidden(token) ? hiddenToken : token;
    }),
    advice: `replace the bare \`hidden\` with \`${hiddenToken}\``,
  };
}

function hasMixedBreakpoints(tokens: Array<string>): boolean {
  return tokens.every((token: string): boolean => {
    return breakpointFixOf(token) !== null;
  });
}

/* The rewrite for a string that holds both the `hidden` and its un-hider. */
function sameStringRewrite(
  unit: ClassTextUnit,
  unhidingTokens: Array<string>,
): Rewrite {
  const fix: BreakpointFix | null = combinedBreakpointFix(unhidingTokens);

  if (fix) {
    return breakpointRewrite(unit, fix);
  }

  if (hasMixedBreakpoints(unhidingTokens)) {
    return { replacement: null, advice: MIXED_BREAKPOINT_ADVICE };
  }

  /*
   * `hidden ... group-hover:flex` inverts mechanically, exactly as
   * FacetValueRow.tsx was converted - unless another unprefixed display
   * utility would then compete with the one moved to the front.
   */
  const onlyToken: string | undefined =
    unhidingTokens.length === 1 ? unhidingTokens[0] : undefined;
  const parsed: ParsedToken | null = onlyToken ? parseToken(onlyToken) : null;
  const otherUnprefixedDisplay: boolean = unit.tokens.some(
    (token: string): boolean => {
      return !isBareHidden(token) && DISPLAY_UTILITIES.has(token);
    },
  );

  if (
    parsed &&
    parsed.variants.length === 1 &&
    parsed.variants[0] === "group-hover" &&
    !otherUnprefixedDisplay
  ) {
    return {
      replacement: mapTokens(unit, (token: string): string => {
        if (isBareHidden(token)) {
          return parsed.utility;
        }

        return token === onlyToken ? "group-[:not(:hover)]:hidden" : token;
      }),
      advice: `show it by default and hide it while the group is not hovered, as ${GROUP_HOVER_EXAMPLE_FILE} does`,
    };
  }

  return { replacement: null, advice: STATE_VARIANT_ADVICE };
}

function isExclusive(first: PlacedUnit, second: PlacedUnit): boolean {
  return first.branches.some((branch: Branch): boolean => {
    return second.branches.some((other: Branch): boolean => {
      return other.node === branch.node && other.side !== branch.side;
    });
  });
}

/*
 * The rewrite for a `hidden` whose un-hiders sit in other pieces. Pieces that
 * never meet each other (two branches of a ternary) must agree on the
 * breakpoint, or no one rewrite is exact.
 */
function crossPieceRewrite(
  hiddenUnit: ClassTextUnit,
  partners: Array<PlacedUnit>,
): Rewrite {
  const partnerTokens: Array<Array<string>> = partners.map(
    (partner: PlacedUnit): Array<string> => {
      return partner.unit.tokens.filter(isUnhidingToken);
    },
  );
  const allTokens: Array<string> = partnerTokens.flat();

  const allMeet: boolean = partners.every(
    (partner: PlacedUnit, index: number): boolean => {
      return partners.slice(index + 1).every((other: PlacedUnit): boolean => {
        return !isExclusive(partner, other);
      });
    },
  );

  const fix: BreakpointFix | null = combinedBreakpointFix(allTokens);

  if (fix && !allMeet) {
    const perPartner: Array<string> = partnerTokens.map(
      (tokens: Array<string>): string => {
        const partnerFix: BreakpointFix | null = combinedBreakpointFix(tokens);
        return partnerFix ? hiddenTokenFor(partnerFix) : "";
      },
    );

    if (new Set<string>(perPartner).size !== 1) {
      return { replacement: null, advice: DISAGREEING_PIECES_ADVICE };
    }
  }

  if (fix) {
    return breakpointRewrite(hiddenUnit, fix);
  }

  if (hasMixedBreakpoints(allTokens)) {
    return { replacement: null, advice: MIXED_BREAKPOINT_ADVICE };
  }

  return { replacement: null, advice: STATE_VARIANT_ADVICE };
}

function nameText(name: ts.Node | undefined): string | null {
  if (!name) {
    return null;
  }

  if (
    ts.isIdentifier(name) ||
    ts.isPrivateIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }

  return null;
}

function isClassName(name: ts.Node | undefined): boolean {
  const text: string | null = nameText(name);
  return text !== null && CLASS_NAME_PATTERN.test(text);
}

function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  return null;
}

function templateUnit(
  node: ts.TemplateExpression,
  sourceFile: ts.SourceFile,
): ClassTextUnit {
  return makeUnit(
    node,
    [
      node.head.text,
      ...node.templateSpans.map((span: ts.TemplateSpan): string => {
        return span.literal.text;
      }),
    ],
    node.templateSpans.map((span: ts.TemplateSpan): string => {
      return span.expression.getText(sourceFile);
    }),
  );
}

/* The class text a node is on its own, or null when it is not a string. */
function unitOf(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): ClassTextUnit | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return makeUnit(node, [node.text], []);
  }

  if (ts.isTemplateExpression(node)) {
    return templateUnit(node, sourceFile);
  }

  return null;
}

/* Return statements of a function body, not of functions nested inside it. */
function collectReturns(node: ts.Node, into: Array<ts.ReturnStatement>): void {
  if (ts.isReturnStatement(node)) {
    into.push(node);
    return;
  }

  if (ts.isFunctionLike(node)) {
    return;
  }

  ts.forEachChild(node, (child: ts.Node): void => {
    collectReturns(child, into);
  });
}

/*
 * Every piece of class text that can end up in the value of `node`, with the
 * branches that decide whether it does. Anything that is not a value - a
 * condition, a comparison, an argument to an unknown function, an object
 * literal, JSX - is not followed.
 */
function collectValueUnits(
  node: ts.Node,
  branches: Array<Branch>,
  sourceFile: ts.SourceFile,
  into: Array<PlacedUnit>,
): void {
  const unit: ClassTextUnit | null = unitOf(node, sourceFile);

  if (unit) {
    into.push({ unit, branches });

    if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) {
        collectValueUnits(span.expression, branches, sourceFile, into);
      }
    }

    return;
  }

  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSpreadElement(node)
  ) {
    collectValueUnits(node.expression, branches, sourceFile, into);
    return;
  }

  if (ts.isConditionalExpression(node)) {
    collectValueUnits(
      node.whenTrue,
      [...branches, { node, side: 0 }],
      sourceFile,
      into,
    );
    collectValueUnits(
      node.whenFalse,
      [...branches, { node, side: 1 }],
      sourceFile,
      into,
    );
    return;
  }

  if (ts.isBinaryExpression(node)) {
    const operator: ts.SyntaxKind = node.operatorToken.kind;

    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      collectValueUnits(node.right, branches, sourceFile, into);
    } else if (
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken
    ) {
      collectValueUnits(
        node.left,
        [...branches, { node, side: 0 }],
        sourceFile,
        into,
      );
      collectValueUnits(
        node.right,
        [...branches, { node, side: 1 }],
        sourceFile,
        into,
      );
    } else if (operator === ts.SyntaxKind.PlusToken) {
      collectValueUnits(node.left, branches, sourceFile, into);
      collectValueUnits(node.right, branches, sourceFile, into);
    }
    return;
  }

  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      collectValueUnits(element, branches, sourceFile, into);
    }
    return;
  }

  if (ts.isCallExpression(node)) {
    const name: string | null = calleeName(node.expression);

    if (name && CLASS_HELPERS.has(name)) {
      for (const argument of node.arguments) {
        if (ts.isObjectLiteralExpression(argument)) {
          // clsx({ "md:flex": wide, hidden: !open }): the keys are the classes.
          for (const property of argument.properties) {
            const key: string | null = nameText(property.name);

            if (property.name && key !== null) {
              into.push({
                unit: makeUnit(property.name, [key], []),
                branches,
              });
            }
          }
          continue;
        }

        collectValueUnits(argument, branches, sourceFile, into);
      }
      return;
    }

    if (
      name &&
      PASS_THROUGH_METHODS.has(name) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      collectValueUnits(node.expression.expression, branches, sourceFile, into);

      if (name === "concat") {
        for (const argument of node.arguments) {
          collectValueUnits(argument, branches, sourceFile, into);
        }
      }
    }
    return;
  }

  // NavLink-style `className={({ isActive }) => ...}` and class getters.
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    if (!ts.isBlock(node.body)) {
      collectValueUnits(node.body, branches, sourceFile, into);
      return;
    }

    const returns: Array<ts.ReturnStatement> = [];
    collectReturns(node.body, returns);

    returns.forEach((statement: ts.ReturnStatement, index: number): void => {
      if (statement.expression) {
        collectValueUnits(
          statement.expression,
          [...branches, { node, side: index }],
          sourceFile,
          into,
        );
      }
    });
  }
}

/* The expression whose value is a class list, when `node` introduces one. */
function classExpressionOf(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): ts.Node | null {
  if (ts.isJsxAttribute(node)) {
    if (
      !CLASS_NAME_PATTERN.test(node.name.getText(sourceFile)) ||
      !node.initializer
    ) {
      return null;
    }

    if (ts.isJsxExpression(node.initializer)) {
      return node.initializer.expression || null;
    }

    return node.initializer;
  }

  if (
    (ts.isVariableDeclaration(node) ||
      ts.isPropertyAssignment(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isBindingElement(node)) &&
    node.initializer &&
    isClassName(node.name)
  ) {
    return node.initializer;
  }

  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
      node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken)
  ) {
    const target: ts.Node | undefined = ts.isPropertyAccessExpression(node.left)
      ? node.left.name
      : node.left;

    return isClassName(target) ? node.right : null;
  }

  if (ts.isCallExpression(node)) {
    const name: string | null = calleeName(node.expression);
    return name && CLASS_HELPERS.has(name) ? node : null;
  }

  // The substitutions of a template always meet its static text.
  if (ts.isTemplateExpression(node)) {
    return node;
  }

  return null;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

/*
 * Reads one module. Parsed rather than grepped, so a comment, a JSDoc example
 * or JSX text that quotes `hidden md:flex` is never a finding.
 */
export function analyzeSource(
  fileName: string,
  source: string,
): SourceAnalysis {
  const analysis: SourceAnalysis = { findings: [], variantHiddenSites: [] };

  // Every class string this guard reads spells "hidden" somewhere.
  if (!source.includes("hidden")) {
    return analysis;
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  // Strings already flagged on their own; a cross-piece finding never repeats them.
  const flaggedUnits: Set<ts.Node> = new Set<ts.Node>();
  const classExpressions: Array<ts.Node> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    const unit: ClassTextUnit | null = unitOf(node, sourceFile);

    if (unit) {
      const unhidingTokens: Array<string> = unit.tokens.filter(isUnhidingToken);

      if (unit.tokens.some(isBareHidden) && unhidingTokens.length > 0) {
        const rewrite: Rewrite = sameStringRewrite(unit, unhidingTokens);

        flaggedUnits.add(node);
        analysis.findings.push({
          file: fileName,
          line: lineOf(sourceFile, node),
          kind: "same-string",
          text: renderUnit(unit),
          partnerText: null,
          unhidingTokens,
          replacement: rewrite.replacement,
          advice: rewrite.advice,
        });
      }

      if (unit.tokens.some(isVariantHidden)) {
        analysis.variantHiddenSites.push({
          file: fileName,
          line: lineOf(sourceFile, node),
          text: renderUnit(unit),
        });
      }
    }

    const classExpression: ts.Node | null = classExpressionOf(node, sourceFile);

    if (classExpression) {
      classExpressions.push(classExpression);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  // One finding per bare `hidden`, however many class expressions hold it.
  const reported: Set<ts.Node> = new Set<ts.Node>();

  for (const expression of classExpressions) {
    const placed: Array<PlacedUnit> = [];
    collectValueUnits(expression, [], sourceFile, placed);

    for (const hidden of placed) {
      if (
        !hidden.unit.tokens.some(isBareHidden) ||
        flaggedUnits.has(hidden.unit.node) ||
        reported.has(hidden.unit.node)
      ) {
        continue;
      }

      const partners: Array<PlacedUnit> = placed.filter(
        (other: PlacedUnit): boolean => {
          return (
            other.unit.node !== hidden.unit.node &&
            !isExclusive(hidden, other) &&
            other.unit.tokens.some(isUnhidingToken)
          );
        },
      );

      if (partners.length === 0) {
        continue;
      }

      const rewrite: Rewrite = crossPieceRewrite(hidden.unit, partners);

      reported.add(hidden.unit.node);
      analysis.findings.push({
        file: fileName,
        line: lineOf(sourceFile, hidden.unit.node),
        kind: "cross-piece",
        text: renderUnit(hidden.unit),
        partnerText: renderUnit(partners[0]!.unit),
        unhidingTokens: partners.flatMap(
          (partner: PlacedUnit): Array<string> => {
            return partner.unit.tokens.filter(isUnhidingToken);
          },
        ),
        replacement: rewrite.replacement,
        advice: rewrite.advice,
      });
    }
  }

  analysis.findings.sort(
    (first: ForeignHiddenRuleFinding, second: ForeignHiddenRuleFinding) => {
      return first.line - second.line;
    },
  );

  return analysis;
}

/* The findings alone, for callers that do not need the safe sites. */
export function findForeignHiddenRuleHazards(
  fileName: string,
  source: string,
): Array<ForeignHiddenRuleFinding> {
  return analyzeSource(fileName, source).findings;
}

/* Reads every file; paths in the result are relative to baseDir. */
export function scanFiles(
  files: Array<string>,
  baseDir: string,
): ForeignHiddenRuleScan {
  const scan: ForeignHiddenRuleScan = {
    files: [],
    findings: [],
    variantHiddenSites: [],
  };

  for (const file of files) {
    const relative: string = toRelativePath(baseDir, file);
    const analysis: SourceAnalysis = analyzeSource(
      relative,
      fs.readFileSync(file, "utf8"),
    );

    scan.files.push(relative);
    scan.findings.push(...analysis.findings);
    scan.variantHiddenSites.push(...analysis.variantHiddenSites);
  }

  return scan;
}

/*
 * The failure message: every offending string with its file:line and what
 * to write instead, then why. Empty when there is nothing to report, so a
 * suite can assert `toBe("")` and get the whole message as the diff.
 */
export function formatFindings(
  findings: Array<ForeignHiddenRuleFinding>,
): string {
  if (findings.length === 0) {
    return "";
  }

  const entries: Array<string> = findings.map(
    (finding: ForeignHiddenRuleFinding): string => {
      const lines: Array<string> = [
        `  ${finding.file}:${finding.line}${
          finding.kind === "cross-piece"
            ? " (the bare `hidden` and the utility that shows the element again are in different pieces of one class expression)"
            : ""
        }`,
        `    offending string: "${finding.text}"`,
      ];

      if (finding.partnerText !== null) {
        lines.push(`    other piece:      "${finding.partnerText}"`);
      }

      lines.push(`    shown again by:   ${finding.unhidingTokens.join(" ")}`);

      if (finding.replacement !== null) {
        lines.push(`    replace with:     "${finding.replacement}"`);
      }

      lines.push(`    fix:              ${finding.advice}`);

      return lines.join("\n");
    },
  );

  return [
    `${findings.length} class string(s) hide an element with the bare \`hidden\` class and rely on a variant utility to show it again. A foreign \`.hidden{display:none !important}\` rule keeps every one of them hidden at every width. Use \`max-<bp>:hidden <bp>:<display>\` instead of \`hidden <bp>:<display>\`:`,
    "",
    entries.join("\n\n"),
    "",
    WHY_PARAGRAPH,
  ].join("\n");
}
