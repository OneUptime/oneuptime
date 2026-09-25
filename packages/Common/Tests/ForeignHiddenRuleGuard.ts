import fs from "fs";
import path from "path";
import ts from "typescript";
import { isMediaQueryVariant, splitVariants } from "./ResponsiveVisibility";

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
 *   3. The `sr-only` analogue of both: a bare `sr-only` that a media-query
 *      `not-sr-only` undoes (`sr-only sm:not-sr-only`). Bootstrap 3 and HTML5
 *      Boilerplate define `.sr-only` too, and appended after Tailwind's
 *      <style> it wins on source order, collapsing a label that is meant to
 *      be visible from `sm` up to 1px at every width. See
 *      isSrOnlyUnhidingToken for why state variants are left alone.
 *   4. All of the above in the server-rendered views (EJS and HTML), which
 *      load the same Play CDN: the static text of every class attribute,
 *      split at its `<% %>` tags, and the JavaScript inside every tag (see
 *      analyzeMarkup).
 *
 * What it deliberately lets through: a lone `hidden` (toggled from
 * JavaScript - the foreign rule can only hide more, never less), `md:hidden`,
 * `max-md:hidden md:flex`, `flex lg:hidden`, `overflow-hidden`, a `sr-only`
 * shown again by a state variant (`sr-only focus:not-sr-only`, the skip-link
 * idiom), and anything in a comment or in JSX text, because only real string
 * syntax is read.
 * Tokens glued to a `${...}` substitution (or to a `<% %>` tag) are not whole
 * classes and are not read either.
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

// Markup the guard reads as views.
const MARKUP_FILE_PATTERN: RegExp = /\.(ejs|html?)$/i;

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "dist",
  "build",
]);

// The hand-converted state-variant sites the failure message points at.
export const GROUP_HOVER_EXAMPLE_FILE: string =
  "packages/Common/UI/Components/LogsViewer/components/FacetValueRow.tsx";
export const DISCLOSURE_EXAMPLE_FILE: string =
  "packages/App/FeatureSet/Dashboard/src/Pages/Runbook/View/ExecutionView.tsx";
export const NAMED_GROUP_EXAMPLE_FILE: string =
  "packages/Common/UI/Components/StatusPage/ResourceGroupNavigator.tsx";
// Brightens group-hover reveals in dark mode, keyed on class substrings.
export const THEME_STYLESHEET_FILE: string =
  "packages/Common/UI/Styles/Theme.css";

/*
 * What every `group-[:not(:hover)]` rewrite has to be checked for. The
 * inversion is not free with nested groups: `group-hover:flex` shows while ANY
 * enclosing `.group` is hovered - in effect the outermost - and
 * `group-[:not(:hover)]:hidden` hides while any is NOT, so it shows only while
 * the innermost one is. And the dark theme keys its hover brightening on the
 * class text, so a rewrite that changes that text can change the colour.
 */
export const GROUP_REWRITE_CAVEAT: string = `\`group-hover:\` shows the element while any \`.group\` around it is hovered and \`group-[:not(:hover)]:hidden\` hides it while any is not, so the two agree exactly when one \`.group\` encloses it; with nested groups the rewrite follows the innermost \`.group\`, which is right only when that group is the intended trigger - for an outer trigger, name it: \`group/card\` on the trigger and \`group-[:not(:hover)]/card:hidden\` on the element (as ${NAMED_GROUP_EXAMPLE_FILE} does). In dark mode ${THEME_STYLESHEET_FILE} brightens gray text revealed under a hovered \`.group\` by class substring and already recognises \`group-[:not(:hover)\` beside \`group-hover\`, so the unnamed rewrite keeps that colour; a named \`group/<name>\` trigger is not a \`.group\` to that rule (it was not for \`group-hover/<name>:\` either)`;

export const STATE_VARIANT_ADVICE: string = `no breakpoint rewrite exists for this variant: show the element by default and hide it under the negated state instead - \`flex ... group-[:not(:hover)]:hidden\` (${GROUP_HOVER_EXAMPLE_FILE}) or, for a <details> disclosure, the structural \`inline [details:not([open])>summary>&]:hidden\` (${DISCLOSURE_EXAMPLE_FILE}). ${GROUP_REWRITE_CAVEAT}`;

// The advice that goes with the mechanical `hidden ... group-hover:<display>` inversion.
export const GROUP_HOVER_REWRITE_ADVICE: string = `show it by default and hide it while the group is not hovered, as ${GROUP_HOVER_EXAMPLE_FILE} does. ${GROUP_REWRITE_CAVEAT}`;

/*
 * For a `not-sr-only` behind a media query that is not one of the named
 * screens (print:, motion-reduce:, min-[900px]: ...): state variants never
 * get here, since they out-specify the foreign `.sr-only` (see
 * isSrOnlyUnhidingToken).
 */
export const SR_ONLY_MEDIA_ADVICE: string =
  "no named-breakpoint rewrite exists for this media variant: keep the `not-sr-only` and apply `sr-only` only under the opposite media query instead of as the bare class - `max-[900px]:sr-only min-[900px]:not-sr-only` for `sr-only min-[900px]:not-sr-only` - so the element never carries the class a foreign `.sr-only` targets";

export type HidingClass = "hidden" | "sr-only";

function mixedBreakpointAdvice(hidingClass: HidingClass): string {
  const unhiders: string =
    hidingClass === "hidden" ? "display utilities" : "`not-sr-only` utilities";

  return `the utilities that show it mix min-width and max-width screens, so no single rewrite of the bare \`${hidingClass}\` is exact: keep the ${unhiders} and hide it with \`max-<bp>:${hidingClass}\` / \`<bp>:${hidingClass}\` for exactly the ranges it should be hidden in`;
}

function disagreeingPiecesAdvice(hidingClass: HidingClass): string {
  return `the pieces that show it never meet (they are alternative branches) and un-hide it at different screens, so no single rewrite of the bare \`${hidingClass}\` is exact: move the \`max-<bp>:${hidingClass}\` into each branch, next to the utility it pairs with`;
}

function conditionalPartnerAdvice(hidingClass: HidingClass): string {
  const pair: string =
    hidingClass === "hidden"
      ? "max-<bp>:hidden <bp>:<display>"
      : "max-<bp>:sr-only <bp>:not-sr-only";

  return `the utility that shows it is only there under a condition the bare \`${hidingClass}\` does not share, so rewriting the \`${hidingClass}\` alone would show the element whenever that condition is off: move the pair into the condition together - \`condition ? "${pair}" : "${hidingClass}"\` - so a lone \`${hidingClass}\` is all that is left when it is off`;
}

export const MIXED_BREAKPOINT_ADVICE: string = mixedBreakpointAdvice("hidden");
export const DISAGREEING_PIECES_ADVICE: string =
  disagreeingPiecesAdvice("hidden");
export const CONDITIONAL_PARTNER_ADVICE: string =
  conditionalPartnerAdvice("hidden");
export const SR_ONLY_MIXED_BREAKPOINT_ADVICE: string =
  mixedBreakpointAdvice("sr-only");
export const SR_ONLY_DISAGREEING_PIECES_ADVICE: string =
  disagreeingPiecesAdvice("sr-only");
export const SR_ONLY_CONDITIONAL_PARTNER_ADVICE: string =
  conditionalPartnerAdvice("sr-only");

export const WHY_PARAGRAPH: string =
  "Why: a customer's dashboard rendered with no navigation bar (no Home, no Products menu, so no way into any product) because their browser carried `.hidden{display:none !important}` - Bootstrap 3 and HTML5 Boilerplate ship exactly that rule, and browser extensions and user stylesheets inject it into pages they touch. It matches the bare `hidden` class and beats every responsive or state utility we emit (it is !important, or merely appended after Tailwind's <style> at equal specificity), so an element written `hidden md:flex` stays hidden at every width. `max-md:hidden md:flex` displays identically at every width and never carries the class that rule targets. A lone `hidden` toggled from JavaScript is fine: the foreign rule can only hide more.";

export const SR_ONLY_WHY_PARAGRAPH: string =
  "Why `sr-only` too: Bootstrap 3 and HTML5 Boilerplate also define `.sr-only`, and a sheet carrying it that is appended after Tailwind's <style> ties with a media-query utility on specificity (an @media wrapper adds none) and wins on source order, so a label written `sr-only sm:not-sr-only` stays a 1px screen-reader-only box at every width. `max-sm:sr-only sm:not-sr-only` renders identically and never carries that class. A state variant is fine - a skip link written `sr-only focus:not-sr-only`, a `group-hover:not-sr-only` - because its selector out-specifies the lone class of a foreign `.sr-only`, which neither library marks !important.";

export type FindingKind = "same-string" | "cross-piece";

export interface ForeignHiddenRuleFinding {
  // As passed to analyzeSource (the scan passes a repository-relative path).
  file: string;
  // Markup: the line of the class attribute. Code: the line the string starts on.
  line: number;
  kind: FindingKind;
  // The class a foreign rule targets: `hidden`, or its `sr-only` analogue.
  hidingClass: HidingClass;
  // The string that carries the bare `hidden` (or `sr-only`), as written.
  text: string;
  // cross-piece: the other piece of the class expression that shows it again.
  partnerText: string | null;
  // The variant utilities that show the element again.
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
 * One piece of class text. A template literal (or a class attribute) is one
 * unit: its static parts always meet in the same value. `parts` has one more
 * entry than `substitutions`, which hold each `${...}` or `<% %>` as it is to
 * be printed.
 */
interface ClassTextUnit {
  // The string's node; null for the static text of a markup class attribute.
  node: ts.Node | null;
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

/*
 * A class a foreign stylesheet can pin, and what undoes it in our markup.
 * Everything else - the breakpoint arithmetic, the cross-piece reading, the
 * failure message - is shared.
 */
interface HidingClassRule {
  hidingClass: HidingClass;
  isUnhiding: (token: string) => boolean;
  /*
   * When no breakpoint rewrite exists: a state variant for `hidden`, a
   * media query other than a named screen for `sr-only`.
   */
  noBreakpointAdvice: string;
  mixedBreakpointAdvice: string;
  disagreeingPiecesAdvice: string;
  conditionalPartnerAdvice: string;
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

function isDirectory(directory: string): boolean {
  try {
    // statSync follows a symlinked directory, which realpath then dedupes.
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

/*
 * The children of `parent` whose name is `lowercaseName` in any case. Read
 * from the listing rather than guessed: git tracks Docs/Views but
 * APIReference/views, and on a case-insensitive filesystem a guessed
 * `views` and `Views` would both exist and name the same directory.
 */
function childDirectoriesNamed(
  parent: string,
  lowercaseName: string,
): Array<string> {
  if (!isDirectory(parent)) {
    return [];
  }

  return fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((entry: fs.Dirent): boolean => {
      return (
        entry.name.toLowerCase() === lowercaseName &&
        isDirectory(path.join(parent, entry.name))
      );
    })
    .map((entry: fs.Dirent): string => {
      return path.join(parent, entry.name);
    })
    .sort();
}

/*
 * The server-rendered views the guard reads, which load the same Tailwind
 * Play CDN as the React frontends: every feature set's views (Docs, API
 * Reference, the frontends' index.ejs shells, Identity) and public/ HTML,
 * Common's server views and the website (packages/Home/Views). Deduped by
 * real path, so a symlink or a case-insensitive filesystem cannot read a
 * directory twice.
 */
export function listViewRoots(repositoryRoot: string): Array<string> {
  const featureSetDir: string = path.join(
    repositoryRoot,
    "packages",
    "App",
    "FeatureSet",
  );

  const candidates: Array<string> = [];

  for (const featureSet of childDirectoriesOf(featureSetDir)) {
    candidates.push(
      ...childDirectoriesNamed(featureSet, "views"),
      ...childDirectoriesNamed(featureSet, "public"),
    );
  }

  candidates.push(
    ...childDirectoriesNamed(
      path.join(repositoryRoot, "packages", "Common", "Server"),
      "views",
    ),
    ...childDirectoriesNamed(
      path.join(repositoryRoot, "packages", "Home"),
      "views",
    ),
  );

  const seen: Set<string> = new Set<string>();

  return candidates.filter((directory: string): boolean => {
    const realPath: string = fs.realpathSync(directory);

    if (seen.has(realPath)) {
      return false;
    }

    seen.add(realPath);
    return true;
  });
}

function childDirectoriesOf(parent: string): Array<string> {
  if (!isDirectory(parent)) {
    return [];
  }

  return fs
    .readdirSync(parent, { withFileTypes: true })
    .map((entry: fs.Dirent): string => {
      return path.join(parent, entry.name);
    })
    .filter(isDirectory)
    .sort();
}

/* Markup the guard reads as views: EJS templates and plain HTML. */
export function isMarkupFile(fileName: string): boolean {
  return MARKUP_FILE_PATTERN.test(fileName);
}

/* Every .ejs / .html file under a directory. */
export function listViewFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  if (!isDirectory(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        found.push(...listViewFiles(fullPath));
      }
      continue;
    }

    if (entry.isFile() && isMarkupFile(entry.name)) {
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

/*
 * A `not-sr-only` behind variants that are all media queries - the ones a
 * foreign `.sr-only` beats: sm:not-sr-only, max-lg:not-sr-only,
 * min-[900px]:not-sr-only, print:not-sr-only, md:motion-safe:not-sr-only ...
 *
 * Why only those: the `.sr-only` Bootstrap 3 and HTML5 Boilerplate ship is
 * not !important, so specificity decides before source order does. An @media
 * wrapper adds no specificity - `.sm\:not-sr-only` inside a media query ties
 * with the foreign `.sr-only` and loses to it on source order - which is what
 * hid the session replay and feed labels. Every state or pseudo variant adds
 * to the selector and so out-specifies that lone class wherever the foreign
 * sheet sits: `.focus\:not-sr-only:focus` (the skip-link idiom `sr-only
 * focus:not-sr-only`), `.hover\:x:hover`, `.group:hover .group-hover\:x`,
 * `.peer:checked ~ .peer-checked\:x`, `[aria-*]`, `[data-*]`,
 * `.dark\:x:is(.dark *)` under darkMode "class", and any `[&...]`. A stack
 * with one such variant in it (`lg:group-hover:not-sr-only`) out-specifies it
 * too. Flagging those would ask for rewrites that fix nothing.
 *
 * Which variants are media queries is decided by isMediaQueryVariant in
 * ResponsiveVisibility.ts, beside the sr-only resolver (isVisuallyCollapsed)
 * that SrOnlyForeignRule.test.tsx sweeps the tree with. That file is the
 * source of truth: this check asks it rather than keeping its own list, so
 * the guard and the resolver cannot drift apart.
 */
export function isSrOnlyUnhidingToken(token: string): boolean {
  const parsed: ParsedToken = parseToken(token);

  return (
    parsed.variants.length > 0 &&
    parsed.utility === "not-sr-only" &&
    parsed.variants.every(isMediaQueryVariant)
  );
}

const HIDDEN_RULE: HidingClassRule = {
  hidingClass: "hidden",
  isUnhiding: isUnhidingToken,
  noBreakpointAdvice: STATE_VARIANT_ADVICE,
  mixedBreakpointAdvice: MIXED_BREAKPOINT_ADVICE,
  disagreeingPiecesAdvice: DISAGREEING_PIECES_ADVICE,
  conditionalPartnerAdvice: CONDITIONAL_PARTNER_ADVICE,
};

const SR_ONLY_RULE: HidingClassRule = {
  hidingClass: "sr-only",
  isUnhiding: isSrOnlyUnhidingToken,
  noBreakpointAdvice: SR_ONLY_MEDIA_ADVICE,
  mixedBreakpointAdvice: SR_ONLY_MIXED_BREAKPOINT_ADVICE,
  disagreeingPiecesAdvice: SR_ONLY_DISAGREEING_PIECES_ADVICE,
  conditionalPartnerAdvice: SR_ONLY_CONDITIONAL_PARTNER_ADVICE,
};

const HIDING_CLASS_RULES: ReadonlyArray<HidingClassRule> = [
  HIDDEN_RULE,
  SR_ONLY_RULE,
];

// Every class string either rule reads spells one of these.
function mentionsHidingClass(text: string): boolean {
  return text.includes("hidden") || text.includes("sr-only");
}

function carriesBare(unit: ClassTextUnit, rule: HidingClassRule): boolean {
  return unit.tokens.includes(rule.hidingClass);
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
  node: ts.Node | null,
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
    text += `${collapse(substitution)}${parts[index + 1] || ""}`;
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

function hiddenTokenFor(fix: BreakpointFix, rule: HidingClassRule): string {
  const breakpoint: string = BREAKPOINTS[fix.breakpointIndex]!;

  return fix.direction === "min"
    ? `max-${breakpoint}:${rule.hidingClass}`
    : `${breakpoint}:${rule.hidingClass}`;
}

function breakpointRewrite(
  unit: ClassTextUnit,
  fix: BreakpointFix,
  rule: HidingClassRule,
): Rewrite {
  const hiddenToken: string = hiddenTokenFor(fix, rule);

  return {
    replacement: mapTokens(unit, (token: string): string => {
      return token === rule.hidingClass ? hiddenToken : token;
    }),
    advice: `replace the bare \`${rule.hidingClass}\` with \`${hiddenToken}\``,
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
  rule: HidingClassRule,
): Rewrite {
  const fix: BreakpointFix | null = combinedBreakpointFix(unhidingTokens);

  if (fix) {
    return breakpointRewrite(unit, fix, rule);
  }

  if (hasMixedBreakpoints(unhidingTokens)) {
    return { replacement: null, advice: rule.mixedBreakpointAdvice };
  }

  if (rule !== HIDDEN_RULE) {
    return { replacement: null, advice: rule.noBreakpointAdvice };
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
      advice: GROUP_HOVER_REWRITE_ADVICE,
    };
  }

  return { replacement: null, advice: rule.noBreakpointAdvice };
}

function isExclusive(first: PlacedUnit, second: PlacedUnit): boolean {
  return first.branches.some((branch: Branch): boolean => {
    return second.branches.some((other: Branch): boolean => {
      return other.node === branch.node && other.side !== branch.side;
    });
  });
}

/*
 * Whether `partner` sits behind a condition `hidden` does not: a ternary
 * branch, an `&&` operand or a clsx object key that the hidden piece is not
 * inside as well. Then the partner can be missing while the `hidden` stays.
 */
function isConditionalTo(partner: PlacedUnit, hidden: PlacedUnit): boolean {
  return partner.branches.some((branch: Branch): boolean => {
    return !hidden.branches.some((own: Branch): boolean => {
      return own.node === branch.node && own.side === branch.side;
    });
  });
}

/*
 * The rewrite for a `hidden` whose un-hiders sit in other pieces. Pieces that
 * never meet each other (two branches of a ternary) must agree on the
 * breakpoint, or no one rewrite is exact; and a partner that is only there
 * under its own condition leaves nothing to rewrite the `hidden` against.
 */
function crossPieceRewrite(
  hidden: PlacedUnit,
  partners: Array<PlacedUnit>,
  rule: HidingClassRule,
): Rewrite {
  const partnerTokens: Array<Array<string>> = partners.map(
    (partner: PlacedUnit): Array<string> => {
      return partner.unit.tokens.filter(rule.isUnhiding);
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
        return partnerFix ? hiddenTokenFor(partnerFix, rule) : "";
      },
    );

    if (new Set<string>(perPartner).size !== 1) {
      return { replacement: null, advice: rule.disagreeingPiecesAdvice };
    }
  }

  if (
    fix &&
    partners.some((partner: PlacedUnit): boolean => {
      return isConditionalTo(partner, hidden);
    })
  ) {
    return { replacement: null, advice: rule.conditionalPartnerAdvice };
  }

  if (fix) {
    return breakpointRewrite(hidden.unit, fix, rule);
  }

  if (hasMixedBreakpoints(allTokens)) {
    return { replacement: null, advice: rule.mixedBreakpointAdvice };
  }

  return { replacement: null, advice: rule.noBreakpointAdvice };
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
      return `\${${span.expression.getText(sourceFile)}}`;
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
      // One-sided: only there when the left operand holds.
      collectValueUnits(
        node.right,
        [...branches, { node, side: 0 }],
        sourceFile,
        into,
      );
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
                // Each key is only there when its value holds.
                branches: [...branches, { node: property, side: 0 }],
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

function sameStringFinding(
  file: string,
  line: number,
  unit: ClassTextUnit,
  rule: HidingClassRule,
): ForeignHiddenRuleFinding | null {
  const unhidingTokens: Array<string> = unit.tokens.filter(rule.isUnhiding);

  if (!carriesBare(unit, rule) || unhidingTokens.length === 0) {
    return null;
  }

  const rewrite: Rewrite = sameStringRewrite(unit, unhidingTokens, rule);

  return {
    file,
    line,
    kind: "same-string",
    hidingClass: rule.hidingClass,
    text: renderUnit(unit),
    partnerText: null,
    unhidingTokens,
    replacement: rewrite.replacement,
    advice: rewrite.advice,
  };
}

/* The other pieces that meet `hidden` and show it again. */
function partnersOf(
  hidden: PlacedUnit,
  placed: Array<PlacedUnit>,
  rule: HidingClassRule,
): Array<PlacedUnit> {
  return placed.filter((other: PlacedUnit): boolean => {
    return (
      other.unit !== hidden.unit &&
      !isExclusive(hidden, other) &&
      other.unit.tokens.some(rule.isUnhiding)
    );
  });
}

function crossPieceFinding(
  file: string,
  line: number,
  hidden: PlacedUnit,
  partners: Array<PlacedUnit>,
  rule: HidingClassRule,
): ForeignHiddenRuleFinding {
  const rewrite: Rewrite = crossPieceRewrite(hidden, partners, rule);

  return {
    file,
    line,
    kind: "cross-piece",
    hidingClass: rule.hidingClass,
    text: renderUnit(hidden.unit),
    partnerText: renderUnit(partners[0]!.unit),
    unhidingTokens: partners.flatMap((partner: PlacedUnit): Array<string> => {
      return partner.unit.tokens.filter(rule.isUnhiding);
    }),
    replacement: rewrite.replacement,
    advice: rewrite.advice,
  };
}

function sortByLine(findings: Array<ForeignHiddenRuleFinding>): void {
  findings.sort(
    (first: ForeignHiddenRuleFinding, second: ForeignHiddenRuleFinding) => {
      return first.line - second.line;
    },
  );
}

interface TreeAnalysis extends SourceAnalysis {
  // Per hiding class: every string node already reported, on its own or as the hidden piece.
  reported: Map<HidingClass, Set<ts.Node>>;
}

/*
 * Reads one parsed module (or the code of one EJS tag). `lineOffset` maps the
 * tree's lines onto the file's.
 */
function analyzeTree(
  fileName: string,
  sourceFile: ts.SourceFile,
  lineOffset: number,
): TreeAnalysis {
  const analysis: TreeAnalysis = {
    findings: [],
    variantHiddenSites: [],
    reported: new Map<HidingClass, Set<ts.Node>>(),
  };

  const lineOf: (node: ts.Node) => number = (node: ts.Node): number => {
    return (
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1 +
      lineOffset
    );
  };

  const units: Array<ClassTextUnit> = [];
  const classExpressions: Array<ts.Node> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    const unit: ClassTextUnit | null = unitOf(node, sourceFile);

    if (unit) {
      units.push(unit);

      if (unit.tokens.some(isVariantHidden)) {
        analysis.variantHiddenSites.push({
          file: fileName,
          line: lineOf(node),
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

  for (const rule of HIDING_CLASS_RULES) {
    // One finding per bare class, however many class expressions hold it.
    const reported: Set<ts.Node> = new Set<ts.Node>();
    analysis.reported.set(rule.hidingClass, reported);

    for (const unit of units) {
      const finding: ForeignHiddenRuleFinding | null = sameStringFinding(
        fileName,
        lineOf(unit.node!),
        unit,
        rule,
      );

      if (finding) {
        reported.add(unit.node!);
        analysis.findings.push(finding);
      }
    }

    for (const expression of classExpressions) {
      const placed: Array<PlacedUnit> = [];
      collectValueUnits(expression, [], sourceFile, placed);

      for (const hidden of placed) {
        const node: ts.Node | null = hidden.unit.node;

        if (!node || !carriesBare(hidden.unit, rule) || reported.has(node)) {
          continue;
        }

        const partners: Array<PlacedUnit> = partnersOf(hidden, placed, rule);

        if (partners.length === 0) {
          continue;
        }

        reported.add(node);
        analysis.findings.push(
          crossPieceFinding(fileName, lineOf(node), hidden, partners, rule),
        );
      }
    }
  }

  sortByLine(analysis.findings);

  return analysis;
}

/*
 * Reads one module. Parsed rather than grepped, so a comment, a JSDoc example
 * or JSX text that quotes `hidden md:flex` is never a finding.
 */
export function analyzeSource(
  fileName: string,
  source: string,
): SourceAnalysis {
  // Every class string this guard reads spells "hidden" or "sr-only" somewhere.
  if (!mentionsHidingClass(source)) {
    return { findings: [], variantHiddenSites: [] };
  }

  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const tree: TreeAnalysis = analyzeTree(fileName, sourceFile, 0);

  return {
    findings: tree.findings,
    variantHiddenSites: tree.variantHiddenSites,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Server-rendered views: EJS templates and plain HTML.
 *
 * The Docs, the API Reference and the website load the same Play CDN and used
 * the same `hidden <bp>:<display>` markup - under a foreign `.hidden` rule the
 * Docs sidebar and search, the API Reference rail and the website's primary
 * nav all disappeared on desktop. A view is not TypeScript, so it is read in
 * three layers:
 *
 *   - Markup. Every class attribute of every start tag, double- or
 *     single-quoted, over as many lines as it takes. Each `<% %>` tag inside
 *     the value is dropped and treated as a token boundary, exactly like a
 *     `${...}` substitution: a token glued to one (`bg-<%= tone %>-50`) is
 *     only part of a class name and is not read. Other attributes
 *     (data-class, :class, className=) are not class attributes. HTML
 *     comments, <style>, <textarea> and <title> hold no markup and are
 *     skipped; so is markup shown as escaped text (`&lt;div class=...`),
 *     which is not a tag.
 *   - Script text. A <script> element's content is JavaScript, not markup,
 *     but markup written inside its strings (`el.innerHTML = '<span
 *     class="...">'`) becomes a real class attribute the moment it is
 *     inserted. So `class="..."` inside a <script> is read as an attribute
 *     too. Class names a script sets through `className =` or `classList`
 *     are not attributes and are not read here: a lone `hidden` toggled from
 *     JavaScript is the one use the foreign rule cannot break.
 *   - Code. The JavaScript inside every `<% %>` tag - anywhere in the file,
 *     not only in class attributes - goes through the same TypeScript reader
 *     as a module (analyzeTree), so `<% const navClass = 'hidden md:flex' %>`
 *     is caught where it is written.
 *
 * And across markup and code: a class attribute's static text and the strings its
 * output tags (`<%= %>`, `<%- %>`) can print always meet in one class value,
 * so `class="md:flex <%= open ? '' : 'hidden' %>"` is the cross-piece shape
 * with the pieces on either side of a `<% %>`. Only a tag's value is class
 * text: a condition (`mode === 'hidden' ? ...`) is not, and `<% %>`
 * scriptlets print nothing.
 * ---------------------------------------------------------------------------
 */

export interface EjsTag {
  // Offsets of the whole tag in the file, `<%` to `%>` (end exclusive).
  start: number;
  end: number;
  // As written, delimiters included.
  text: string;
  // The JavaScript between the delimiters.
  code: string;
  // `<%=` and `<%-` print their value; `<%`, `<%_` and `<%#` print nothing.
  outputs: boolean;
  isComment: boolean;
  // The line the code starts on.
  codeLine: number;
}

export interface ClassAttribute {
  // The line the attribute's name is on.
  line: number;
  // The static text of the value, split at each tag: one more entry than `tags`.
  parts: Array<string>;
  tags: Array<EjsTag>;
}

// Stands in for tag text while the markup is read, so nothing inside a tag - a quote, a `>` - is markup.
const TAG_PLACEHOLDER: string = "\u0000";

// Elements whose content is text, not markup.
const TEXT_ONLY_ELEMENTS: ReadonlySet<string> = new Set<string>([
  "style",
  "textarea",
  "title",
]);

// `class="` / `class='` inside script text, allowing `class=\"...\"` in a double-quoted JS string.
const SCRIPT_CLASS_ATTRIBUTE: RegExp = /(^|[\s"'`])class\s*=\s*(\\?)(["'])/gi;

// The HTML tokenizer's character classes (the tag text is masked out first).
const WHITESPACE: RegExp = /\s/;
const TAG_NAME_START: RegExp = /[A-Za-z]/;
const TAG_NAME_END: RegExp = /[\s/>]/;
const ATTRIBUTE_SEPARATOR: RegExp = /[\s/]/;
const ATTRIBUTE_NAME_END: RegExp = /[\s/>=]/;
const UNQUOTED_VALUE_END: RegExp = /[\s>]/;

/* Offsets where each line starts, for turning an offset into a line. */
function lineStartsOf(source: string): Array<number> {
  const starts: Array<number> = [0];

  for (let index: number = 0; index < source.length; index++) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }

  return starts;
}

function lineAt(lineStarts: Array<number>, offset: number): number {
  let low: number = 0;
  let high: number = lineStarts.length - 1;

  while (low < high) {
    const middle: number = Math.ceil((low + high) / 2);

    if (lineStarts[middle]! <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return low + 1;
}

function findEjsTagsWithLines(
  source: string,
  lineStarts: Array<number>,
): Array<EjsTag> {
  const tags: Array<EjsTag> = [];
  let index: number = 0;

  for (;;) {
    const start: number = source.indexOf("<%", index);

    if (start === -1) {
      return tags;
    }

    const marker: string = source[start + 2] || "";

    // `<%%` prints a literal `<%`: static text, not a tag.
    if (marker === "%") {
      index = start + 3;
      continue;
    }

    const close: number = source.indexOf("%>", start + 2);
    const end: number = close === -1 ? source.length : close + 2;
    const codeStart: number = start + 2 + ("=-_#".includes(marker) ? 1 : 0);
    let codeEnd: number = close === -1 ? source.length : close;

    // `-%>` and `_%>` trim whitespace after the tag; the `-` / `_` is not code.
    if (
      codeEnd > codeStart &&
      (source[codeEnd - 1] === "-" || source[codeEnd - 1] === "_")
    ) {
      codeEnd--;
    }

    tags.push({
      start,
      end,
      text: source.slice(start, end),
      code: source.slice(codeStart, codeEnd),
      outputs: marker === "=" || marker === "-",
      isComment: marker === "#",
      codeLine: lineAt(lineStarts, codeStart),
    });

    index = end;
  }
}

/* Every `<% %>` tag in an EJS template, in order. */
export function findEjsTags(source: string): Array<EjsTag> {
  return findEjsTagsWithLines(source, lineStartsOf(source));
}

function maskTags(source: string, tags: Array<EjsTag>): string {
  let masked: string = "";
  let cursor: number = 0;

  for (const tag of tags) {
    masked += source.slice(cursor, tag.start);
    /*
     * Same length, so an offset means the same in both strings (lines are
     * read from the source). Newlines go too: an unquoted value ends at
     * whitespace, and must not end inside a tag.
     */
    masked += TAG_PLACEHOLDER.repeat(tag.text.length);
    cursor = tag.end;
  }

  return masked + source.slice(cursor);
}

interface AttributeRange {
  nameStart: number;
  valueStart: number;
  valueEnd: number;
}

function isSpace(character: string | undefined): boolean {
  return character !== undefined && WHITESPACE.test(character);
}

/*
 * Reads one start tag from just after its `<`, recording its class
 * attributes. Returns the tag's name and the offset after its `>`.
 */
function readStartTag(
  masked: string,
  from: number,
  into: Array<AttributeRange>,
): { name: string; end: number } {
  const length: number = masked.length;
  let cursor: number = from;

  while (cursor < length && !TAG_NAME_END.test(masked[cursor]!)) {
    cursor++;
  }

  const name: string = masked.slice(from, cursor).toLowerCase();

  for (;;) {
    while (cursor < length && ATTRIBUTE_SEPARATOR.test(masked[cursor]!)) {
      cursor++;
    }

    if (cursor >= length) {
      return { name, end: length };
    }

    if (masked[cursor] === ">") {
      return { name, end: cursor + 1 };
    }

    const nameStart: number = cursor;
    cursor++;

    while (cursor < length && !ATTRIBUTE_NAME_END.test(masked[cursor]!)) {
      cursor++;
    }

    const attributeName: string = masked.slice(nameStart, cursor);
    let after: number = cursor;

    while (isSpace(masked[after])) {
      after++;
    }

    // An attribute with no value (`disabled`, `hidden`).
    if (masked[after] !== "=") {
      continue;
    }

    after++;

    while (isSpace(masked[after])) {
      after++;
    }

    const quote: string | undefined = masked[after];
    let valueStart: number;
    let valueEnd: number;

    if (quote === '"' || quote === "'") {
      valueStart = after + 1;
      const close: number = masked.indexOf(quote, valueStart);
      valueEnd = close === -1 ? length : close;
      cursor = close === -1 ? length : close + 1;
    } else {
      valueStart = after;
      cursor = after;

      while (cursor < length && !UNQUOTED_VALUE_END.test(masked[cursor]!)) {
        cursor++;
      }

      valueEnd = cursor;
    }

    if (attributeName.toLowerCase() === "class") {
      into.push({ nameStart, valueStart, valueEnd });
    }
  }
}

/* `class="..."` written inside script text, e.g. in an innerHTML string. */
function readScriptText(
  masked: string,
  start: number,
  end: number,
  into: Array<AttributeRange>,
): void {
  const text: string = masked.slice(start, end);
  const pattern: RegExp = new RegExp(SCRIPT_CLASS_ATTRIBUTE.source, "gi");
  let match: RegExpExecArray | null = pattern.exec(text);

  while (match) {
    const closing: string = `${match[2]}${match[3]}`;
    const valueStart: number = match.index + match[0].length;
    const close: number = text.indexOf(closing, valueStart);
    const valueEnd: number = close === -1 ? text.length : close;

    into.push({
      nameStart: start + match.index + match[1]!.length,
      valueStart: start + valueStart,
      valueEnd: start + valueEnd,
    });

    pattern.lastIndex = close === -1 ? text.length : close + closing.length;
    match = pattern.exec(text);
  }
}

function closingTagOffset(masked: string, name: string, from: number): number {
  const pattern: RegExp = new RegExp(`</${name}(?=[\\s/>]|$)`, "gi");
  pattern.lastIndex = from;
  const match: RegExpExecArray | null = pattern.exec(masked);

  return match ? match.index : masked.length;
}

/* Every class attribute's value range, read from the tag-masked markup. */
function classAttributeRanges(masked: string): Array<AttributeRange> {
  const ranges: Array<AttributeRange> = [];
  let index: number = 0;

  while (index < masked.length) {
    const open: number = masked.indexOf("<", index);

    if (open === -1) {
      break;
    }

    if (masked.startsWith("<!--", open)) {
      const close: number = masked.indexOf("-->", open + 4);
      index = close === -1 ? masked.length : close + 3;
      continue;
    }

    // A letter starts a tag name; so does a tag, as in `<<%= headingTag %> class="...">`.
    const next: string = masked[open + 1] || "";

    if (!TAG_NAME_START.test(next) && next !== TAG_PLACEHOLDER) {
      index = open + 1;
      continue;
    }

    const tag: { name: string; end: number } = readStartTag(
      masked,
      open + 1,
      ranges,
    );
    index = tag.end;

    if (tag.name === "script" || TEXT_ONLY_ELEMENTS.has(tag.name)) {
      const contentEnd: number = closingTagOffset(masked, tag.name, index);

      if (tag.name === "script") {
        readScriptText(masked, index, contentEnd, ranges);
      }

      index = contentEnd;
    }
  }

  return ranges;
}

interface MarkupReading {
  lineStarts: Array<number>;
  tags: Array<EjsTag>;
  attributes: Array<ClassAttribute>;
}

function readMarkup(source: string): MarkupReading {
  const lineStarts: Array<number> = lineStartsOf(source);
  const tags: Array<EjsTag> = findEjsTagsWithLines(source, lineStarts);
  const masked: string = maskTags(source, tags);
  let tagIndex: number = 0;

  // Ranges come in document order and never overlap, so one pass over the tags does.
  const attributes: Array<ClassAttribute> = classAttributeRanges(masked).map(
    (range: AttributeRange): ClassAttribute => {
      while (
        tagIndex < tags.length &&
        tags[tagIndex]!.start < range.valueStart
      ) {
        tagIndex++;
      }

      const inside: Array<EjsTag> = [];
      const parts: Array<string> = [];
      let cursor: number = range.valueStart;

      while (tagIndex < tags.length && tags[tagIndex]!.end <= range.valueEnd) {
        const tag: EjsTag = tags[tagIndex]!;
        parts.push(source.slice(cursor, tag.start));
        inside.push(tag);
        cursor = tag.end;
        tagIndex++;
      }

      parts.push(source.slice(cursor, range.valueEnd));

      return {
        line: lineAt(lineStarts, range.nameStart),
        parts,
        tags: inside,
      };
    },
  );

  return { lineStarts, tags, attributes };
}

/* The class attributes of an EJS template or HTML page (see the notes above). */
export function extractClassAttributes(source: string): Array<ClassAttribute> {
  return readMarkup(source).attributes;
}

interface ParsedTag {
  sourceFile: ts.SourceFile;
  // An output tag's value; null for a scriptlet or a comment.
  expression: ts.Expression | null;
  tree: TreeAnalysis | null;
}

function parseTag(fileName: string, tag: EjsTag): ParsedTag {
  // Parenthesised, an output tag is one expression: `{ a: 1 }` is an object, not a block.
  const code: string = tag.outputs ? `(${tag.code}\n)` : tag.code;
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    `${fileName}:${tag.codeLine}.ts`,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const first: ts.Statement | undefined = sourceFile.statements[0];

  return {
    sourceFile,
    expression:
      tag.outputs && first && ts.isExpressionStatement(first)
        ? first.expression
        : null,
    tree: mentionsHidingClass(tag.code)
      ? analyzeTree(fileName, sourceFile, tag.codeLine - 1)
      : null,
  };
}

/*
 * Reads one EJS template or HTML page: the markup, the code in its tags, and
 * the class attributes whose static text and printed values meet.
 */
export function analyzeMarkup(
  fileName: string,
  source: string,
): SourceAnalysis {
  const analysis: SourceAnalysis = { findings: [], variantHiddenSites: [] };

  if (!mentionsHidingClass(source)) {
    return analysis;
  }

  const reading: MarkupReading = readMarkup(source);
  const parsedTags: Map<EjsTag, ParsedTag> = new Map<EjsTag, ParsedTag>();

  const parsed: (tag: EjsTag) => ParsedTag = (tag: EjsTag): ParsedTag => {
    let result: ParsedTag | undefined = parsedTags.get(tag);

    if (!result) {
      result = parseTag(fileName, tag);
      parsedTags.set(tag, result);

      if (result.tree) {
        analysis.findings.push(...result.tree.findings);
        analysis.variantHiddenSites.push(...result.tree.variantHiddenSites);
      }
    }

    return result;
  };

  // The code in every tag that could hold one of the classes, wherever it is.
  for (const tag of reading.tags) {
    if (!tag.isComment && mentionsHidingClass(tag.code)) {
      parsed(tag);
    }
  }

  for (const attribute of reading.attributes) {
    const staticText: ClassTextUnit = makeUnit(
      null,
      attribute.parts,
      attribute.tags.map((tag: EjsTag): string => {
        return tag.text;
      }),
    );

    if (staticText.tokens.some(isVariantHidden)) {
      analysis.variantHiddenSites.push({
        file: fileName,
        line: attribute.line,
        text: renderUnit(staticText),
      });
    }

    const flaggedStatic: Set<HidingClass> = new Set<HidingClass>();

    for (const rule of HIDING_CLASS_RULES) {
      const finding: ForeignHiddenRuleFinding | null = sameStringFinding(
        fileName,
        attribute.line,
        staticText,
        rule,
      );

      if (finding) {
        flaggedStatic.add(rule.hidingClass);
        analysis.findings.push(finding);
      }
    }

    const outputTags: Array<EjsTag> = attribute.tags.filter(
      (tag: EjsTag): boolean => {
        return tag.outputs;
      },
    );

    if (
      outputTags.length === 0 ||
      (!mentionsHidingClass(renderUnit(staticText)) &&
        !outputTags.some((tag: EjsTag): boolean => {
          return mentionsHidingClass(tag.code);
        }))
    ) {
      continue;
    }

    /*
     * The pieces of the value: the static text, which is always there, and
     * each string an output tag can print, with the branches inside that tag
     * that decide whether it does. Pieces in different tags always meet.
     */
    const placed: Array<PlacedUnit> = [{ unit: staticText, branches: [] }];
    const treeOf: Map<ClassTextUnit, TreeAnalysis | null> = new Map<
      ClassTextUnit,
      TreeAnalysis | null
    >();

    for (const tag of outputTags) {
      const parsedTag: ParsedTag = parsed(tag);

      if (!parsedTag.expression) {
        continue;
      }

      const pieces: Array<PlacedUnit> = [];
      collectValueUnits(parsedTag.expression, [], parsedTag.sourceFile, pieces);

      for (const piece of pieces) {
        treeOf.set(piece.unit, parsedTag.tree);
        placed.push(piece);
      }
    }

    for (const rule of HIDING_CLASS_RULES) {
      for (const hidden of placed) {
        if (!carriesBare(hidden.unit, rule)) {
          continue;
        }

        // Already reported on its own, or by the reading of its tag's code.
        const alreadyReported: boolean =
          hidden.unit === staticText
            ? flaggedStatic.has(rule.hidingClass)
            : Boolean(
                hidden.unit.node &&
                  treeOf
                    .get(hidden.unit)
                    ?.reported.get(rule.hidingClass)
                    ?.has(hidden.unit.node),
              );

        if (alreadyReported) {
          continue;
        }

        const partners: Array<PlacedUnit> = partnersOf(hidden, placed, rule);

        if (partners.length > 0) {
          analysis.findings.push(
            crossPieceFinding(fileName, attribute.line, hidden, partners, rule),
          );
        }
      }
    }
  }

  sortByLine(analysis.findings);
  analysis.variantHiddenSites.sort(
    (first: VariantHiddenSite, second: VariantHiddenSite): number => {
      return first.line - second.line;
    },
  );

  return analysis;
}

/* Reads one file as a view or as a module, by its extension. */
export function analyzeFile(fileName: string, source: string): SourceAnalysis {
  return isMarkupFile(fileName)
    ? analyzeMarkup(fileName, source)
    : analyzeSource(fileName, source);
}

/* The findings alone, for callers that do not need the safe sites. */
export function findForeignHiddenRuleHazards(
  fileName: string,
  source: string,
): Array<ForeignHiddenRuleFinding> {
  return analyzeFile(fileName, source).findings;
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
    const analysis: SourceAnalysis = analyzeFile(
      relative,
      fs.readFileSync(file, "utf8"),
    );

    scan.files.push(relative);
    scan.findings.push(...analysis.findings);
    scan.variantHiddenSites.push(...analysis.variantHiddenSites);
  }

  return scan;
}

function crossPieceNote(finding: ForeignHiddenRuleFinding): string {
  const where: string = isMarkupFile(finding.file)
    ? "one class attribute (its static text and a <% %> tag)"
    : "one class expression";

  return ` (the bare \`${finding.hidingClass}\` and the utility that shows the element again are in different pieces of ${where})`;
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

  const countOf: (hidingClass: HidingClass) => number = (
    hidingClass: HidingClass,
  ): number => {
    return findings.filter((finding: ForeignHiddenRuleFinding): boolean => {
      return finding.hidingClass === hidingClass;
    }).length;
  };

  const hiddenCount: number = countOf("hidden");
  const srOnlyCount: number = countOf("sr-only");
  const summaries: Array<string> = [];

  if (hiddenCount > 0) {
    summaries.push(
      `${hiddenCount} class string(s) hide an element with the bare \`hidden\` class and rely on a variant utility to show it again. A foreign \`.hidden{display:none !important}\` rule keeps every one of them hidden at every width. Use \`max-<bp>:hidden <bp>:<display>\` instead of \`hidden <bp>:<display>\`${srOnlyCount > 0 ? "." : ":"}`,
    );
  }

  if (srOnlyCount > 0) {
    summaries.push(
      `${srOnlyCount} class string(s) visually hide an element with the bare \`sr-only\` class and rely on a media-query \`not-sr-only\` to show it again. A foreign \`.sr-only\` rule appended after Tailwind keeps every one of them collapsed to 1px at every width. Use \`max-<bp>:sr-only <bp>:not-sr-only\` instead of \`sr-only <bp>:not-sr-only\`:`,
    );
  }

  const entries: Array<string> = findings.map(
    (finding: ForeignHiddenRuleFinding): string => {
      const lines: Array<string> = [
        `  ${finding.file}:${finding.line}${
          finding.kind === "cross-piece" ? crossPieceNote(finding) : ""
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
    summaries.join("\n"),
    "",
    entries.join("\n\n"),
    "",
    ...(srOnlyCount > 0 ? [SR_ONLY_WHY_PARAGRAPH] : []),
    ...(hiddenCount > 0 ? [WHY_PARAGRAPH] : []),
  ].join("\n");
}
