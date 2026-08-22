import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Source-reading helpers for the route-reservation tests.
 *
 * Some of what these tests check cannot be imported: which routers a feature
 * set mounts, on what prefixes, and what paths those routers register. That
 * only exists as code, so it has to be read out of the source.
 *
 * It is read with the TypeScript compiler's own parser, not with regexes.
 * The regex version of this file was wrong in ways that all pointed the same
 * direction - a silent false pass:
 *
 *   - A comment stripper built from /\/\*[\s\S]*?\*\//g treated the "/*"
 *     inside the template literal `${frontendConfig.routePrefix}/*` as a
 *     comment opener and deleted ~1,400 characters of Frontend/Index.ts.
 *   - A mount matcher of the shape app\.use\(...,\s*(\w+)\s*\) silently
 *     skipped 11 of the 31 real app.use calls: `new FooAPI().router`,
 *     template-literal prefixes, three-argument mounts, and - the one that
 *     mattered most - anything Prettier had reflowed across lines with a
 *     trailing comma, which is what this repo's own formatter emits as soon
 *     as a call passes 80 columns. A newly added root mount written in the
 *     house style was invisible to the guard.
 *
 * Both bugs were invisible because a regex that fails to match simply yields
 * nothing. The rule here is the opposite: anything that cannot be resolved
 * statically is REPORTED, never dropped. Callers decide what to do with it,
 * and the tests fail on anything unreviewed.
 */

export const APP_DIR: string = path.join(__dirname, "..", "..");
export const REPO_ROOT: string = path.join(APP_DIR, "..");

export function readSource(...segments: Array<string>): string {
  return fs.readFileSync(path.join(...segments), "utf8");
}

const sourceFileCache: Map<string, ts.SourceFile> = new Map<
  string,
  ts.SourceFile
>();

/* Parsed with the real TypeScript parser, so comments and strings are exact. */
export function parseSourceFile(filePath: string): ts.SourceFile {
  const cached: ts.SourceFile | undefined = sourceFileCache.get(filePath);

  if (cached) {
    return cached;
  }

  const parsed: ts.SourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );

  sourceFileCache.set(filePath, parsed);

  return parsed;
}

/* Parse from a string, for tests that exercise these helpers on fixtures. */
export function parseSourceText(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
}

function lineOf(node: ts.Node): number {
  return (
    node
      .getSourceFile()
      .getLineAndCharacterOfPosition(node.getStart(node.getSourceFile())).line +
    1
  );
}

function describe(node: ts.Node): string {
  return node.getText(node.getSourceFile()).replace(/\s+/g, " ").slice(0, 120);
}

/*
 * Comment removal that leaves code alone. A "//" inside a string literal and
 * a "/*" inside a template literal are tokens, not comments, so they survive
 * - which is the whole point. Newlines inside a removed comment are kept, so
 * line numbers still line up with the original file.
 */
export function stripComments(source: string): string {
  /*
   * Comment ranges are taken from the PARSED file, not from a raw scanner.
   * ts.createScanner is not sufficient on its own: it hands back TemplateHead
   * and then needs reScanTemplateToken() to continue a template literal, and
   * without that the "/*" in `${frontendConfig.routePrefix}/*` reads as a
   * comment opener - the very bug this helper exists to avoid. Letting the
   * parser establish token boundaries removes the whole question, for
   * templates and regex literals alike.
   */
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    "__strip_comments__.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );

  const removals: Array<ts.CommentRange> = [];

  const collect: (node: ts.Node) => void = (node: ts.Node): void => {
    const children: ReadonlyArray<ts.Node> = node.getChildren(sourceFile);

    if (children.length === 0) {
      /*
       * Both kinds. A comment after code on the same line ("x = 1; // note")
       * is TRAILING trivia of the token before it, and is not returned by
       * getLeadingCommentRanges for the token after it.
       */
      for (const range of ts.getLeadingCommentRanges(
        source,
        node.getFullStart(),
      ) || []) {
        removals.push(range);
      }

      for (const range of ts.getTrailingCommentRanges(source, node.getEnd()) ||
        []) {
        removals.push(range);
      }

      return;
    }

    for (const child of children) {
      collect(child);
    }
  };

  collect(sourceFile);

  removals.sort((a: ts.CommentRange, b: ts.CommentRange): number => {
    return a.pos - b.pos;
  });

  let output: string = "";
  let cursor: number = 0;

  for (const range of removals) {
    if (range.pos < cursor) {
      continue;
    }

    output += source.slice(cursor, range.pos);

    /*
     * Blanked to spaces rather than deleted. That keeps every offset and line
     * number identical to the original file, and stops the tokens on either
     * side being welded together - "a/* x *\/b" must not become "ab".
     */
    output += source.slice(range.pos, range.end).replace(/[^\n]/g, " ");
    cursor = range.end;
  }

  return output + source.slice(cursor);
}

/*
 * ------------------------------------------------------------------ *
 * Array literals
 * ------------------------------------------------------------------
 */

function findVariableInitializer(
  sourceFile: ts.SourceFile,
  name: string,
): ts.Expression | null {
  let found: ts.Expression | null = null;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      found = node.initializer;
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

/*
 * Entries of a string-array declaration, with `...Other` spreads resolved
 * against declarations in the same file. Throws on any entry that is not a
 * statically known string, so an entry shape this cannot read can never be
 * mistaken for "the list does not contain it".
 */
export function arrayEntries(
  sourceFile: ts.SourceFile,
  name: string,
  seen: Array<string> = [],
): Array<string> {
  if (seen.includes(name)) {
    throw new Error(
      `Circular spread resolving "${name}" (${[...seen, name].join(" -> ")}).`,
    );
  }

  const initializer: ts.Expression | null = findVariableInitializer(
    sourceFile,
    name,
  );

  if (!initializer) {
    return [];
  }

  if (!ts.isArrayLiteralExpression(initializer)) {
    throw new Error(
      `"${name}" in ${path.basename(sourceFile.fileName)} is not an array ` +
        `literal, so its entries cannot be read.`,
    );
  }

  const entries: Array<string> = [];

  for (const element of initializer.elements) {
    if (ts.isStringLiteral(element)) {
      entries.push(element.text);
      continue;
    }

    if (ts.isSpreadElement(element) && ts.isIdentifier(element.expression)) {
      const spreadName: string = element.expression.text;
      const resolved: Array<string> = arrayEntries(sourceFile, spreadName, [
        ...seen,
        name,
      ]);

      if (resolved.length === 0) {
        throw new Error(
          `Spread "...${spreadName}" in "${name}" resolved to nothing.`,
        );
      }

      entries.push(...resolved);
      continue;
    }

    throw new Error(
      `Unreadable entry ${JSON.stringify(describe(element))} in "${name}" ` +
        `(${path.basename(sourceFile.fileName)}:${lineOf(element)}). Entries ` +
        `must be string literals or spreads of another array in the same file.`,
    );
  }

  return entries;
}

/* Convenience: read a named array straight out of a file path. */
export function arrayEntriesInFile(
  filePath: string,
  name: string,
): Array<string> {
  return arrayEntries(parseSourceFile(filePath), name);
}

/*
 * ------------------------------------------------------------------ *
 * Static evaluation of mount paths
 * ------------------------------------------------------------------
 */

function stringConstant(
  sourceFile: ts.SourceFile,
  name: string,
): string | null {
  const initializer: ts.Expression | null = findVariableInitializer(
    sourceFile,
    name,
  );

  if (initializer && ts.isStringLiteral(initializer)) {
    return initializer.text;
  }

  if (initializer && ts.isNoSubstitutionTemplateLiteral(initializer)) {
    return initializer.text;
  }

  return null;
}

/*
 * Resolve an expression used as a mount path to the concrete string(s) it
 * produces, or null when that cannot be known from this file alone.
 * Handles the forms this codebase actually uses: "/x", `/${CONST}`,
 * ["/a", "/b"], a named Array<string>, and spreads inside those.
 */
function staticMountPaths(
  sourceFile: ts.SourceFile,
  node: ts.Expression,
): Array<string> | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return [node.text];
  }

  if (ts.isTemplateExpression(node)) {
    let text: string = node.head.text;

    for (const span of node.templateSpans) {
      if (!ts.isIdentifier(span.expression)) {
        return null;
      }

      const value: string | null = stringConstant(
        sourceFile,
        span.expression.text,
      );

      if (value === null) {
        return null;
      }

      text += value + span.literal.text;
    }

    return [text];
  }

  if (ts.isArrayLiteralExpression(node)) {
    const paths: Array<string> = [];

    for (const element of node.elements) {
      if (ts.isSpreadElement(element)) {
        const spread: Array<string> | null = staticMountPaths(
          sourceFile,
          element.expression,
        );

        if (spread === null) {
          return null;
        }

        paths.push(...spread);
        continue;
      }

      const single: Array<string> | null = staticMountPaths(
        sourceFile,
        element,
      );

      if (single === null) {
        return null;
      }

      paths.push(...single);
    }

    return paths;
  }

  if (ts.isIdentifier(node)) {
    const initializer: ts.Expression | null = findVariableInitializer(
      sourceFile,
      node.text,
    );

    if (!initializer) {
      return null;
    }

    return staticMountPaths(sourceFile, initializer);
  }

  return null;
}

/*
 * ------------------------------------------------------------------ *
 * app.use() mounts
 * ------------------------------------------------------------------
 */

export interface RouterMount {
  /* Every prefix the router is mounted on. */
  mountPaths: Array<string>;
  /* Source text of the router argument, for messages. */
  routerText: string;
  /* Absolute path of the router's module, when it could be resolved. */
  routerFile: string | null;
  /* True when the handler is a static-file mount rather than a router. */
  isStaticFileMount: boolean;
  line: number;
}

export interface UnreadableMount {
  reason: string;
  text: string;
  line: number;
}

export interface MountScan {
  mounts: Array<RouterMount>;
  /* Mounts whose path or router could not be resolved from this file. */
  unreadable: Array<UnreadableMount>;
}

function importedModuleSpecifier(
  sourceFile: ts.SourceFile,
  identifier: string,
): string | null {
  let specifier: string | null = null;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      node.importClause &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause: ts.ImportClause = node.importClause;
      const named: ts.NamedImportBindings | undefined = clause.namedBindings;

      if (clause.name && clause.name.text === identifier) {
        specifier = node.moduleSpecifier.text;
      } else if (named && ts.isNamedImports(named)) {
        for (const element of named.elements) {
          if (element.name.text === identifier) {
            specifier = (node.moduleSpecifier as ts.StringLiteral).text;
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return specifier;
}

function resolveModuleFile(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const base: string = path.resolve(path.dirname(fromFile), specifier);

  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "Index.ts"),
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/*
 * The identifier a router expression ultimately comes from:
 *   FooAPI                 -> FooAPI
 *   new FooAPI().router    -> FooAPI
 *   Foo.router             -> Foo
 *   FooAPI.getRouter()     -> FooAPI
 */
function rootIdentifier(node: ts.Expression): string | null {
  let current: ts.Node = node;

  for (let guard: number = 0; guard < 12; guard++) {
    if (ts.isIdentifier(current)) {
      return current.text;
    }

    if (ts.isPropertyAccessExpression(current)) {
      current = current.expression;
      continue;
    }

    if (ts.isCallExpression(current) || ts.isNewExpression(current)) {
      current = current.expression;
      continue;
    }

    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)) {
      current = current.expression;
      continue;
    }

    return null;
  }

  return null;
}

function isStaticFileMount(node: ts.Expression): boolean {
  const identifier: string | null = rootIdentifier(node);

  return identifier === "ExpressStatic" || identifier === "static";
}

/*
 * The module a router argument comes from. Follows one hop through a local
 * `const x = new FooAPI()` so the `app.use(prefix, x.router)` form used in
 * Workflow resolves to FooAPI's module.
 */
function routerModuleFor(
  sourceFile: ts.SourceFile,
  handler: ts.Expression,
): string | null {
  const identifier: string | null = rootIdentifier(handler);

  if (!identifier) {
    return null;
  }

  const direct: string | null = importedModuleSpecifier(sourceFile, identifier);

  if (direct) {
    return resolveModuleFile(sourceFile.fileName, direct);
  }

  const initializer: ts.Expression | null = findVariableInitializer(
    sourceFile,
    identifier,
  );

  if (initializer) {
    const constructed: string | null = rootIdentifier(initializer);

    if (constructed) {
      const viaClass: string | null = importedModuleSpecifier(
        sourceFile,
        constructed,
      );

      if (viaClass) {
        return resolveModuleFile(sourceFile.fileName, viaClass);
      }
    }
  }

  return null;
}

/* Express serves HEAD from GET handlers, and app.all() covers GET too. */
const GET_SERVING_METHODS: Array<string> = ["get", "all"];

/* "router", "probeRouter", "this.router" - but not "app". */
const ROUTER_RECEIVER: RegExp = /(^|\.)\w*router$/i;

/*
 * Paths a file registers directly on the app for GET, e.g. the Docs and
 * APIReference feature sets, which serve their pages with app.get() rather
 * than through a router. These sit after the SPA fallbacks in the stack just
 * like router mounts do, so they need reserving on exactly the same terms.
 */
export function scanAppGetPaths(sourceFile: ts.SourceFile): RouteScan {
  const getPaths: Array<string> = [];
  const unreadable: Array<UnreadableMount> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "app" &&
      GET_SERVING_METHODS.includes(node.expression.name.text) &&
      node.arguments.length >= 1
    ) {
      const first: ts.Expression = node.arguments[0] as ts.Expression;
      const paths: Array<string> | null = staticMountPaths(sourceFile, first);

      if (paths === null) {
        unreadable.push({
          reason: `app.${node.expression.name.text}() path is not statically resolvable`,
          text: describe(node),
          line: lineOf(node),
        });
      } else {
        getPaths.push(...paths);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return { getPaths: getPaths, unreadable: unreadable };
}

/*
 * Every `app.use(...)` in a file, with mount prefixes resolved. A call whose
 * prefix or router cannot be resolved is returned under `unreadable` rather
 * than dropped - the caller must account for it.
 */
export function scanAppUseMounts(sourceFile: ts.SourceFile): MountScan {
  const mounts: Array<RouterMount> = [];
  const unreadable: Array<UnreadableMount> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "use" &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "app" &&
      node.arguments.length >= 2
    ) {
      const first: ts.Expression = node.arguments[0] as ts.Expression;
      const handler: ts.Expression = node.arguments[
        node.arguments.length - 1
      ] as ts.Expression;

      const paths: Array<string> | null = staticMountPaths(sourceFile, first);

      if (paths === null) {
        unreadable.push({
          reason: "mount path is not statically resolvable",
          text: describe(node),
          line: lineOf(node),
        });
      } else if (isStaticFileMount(handler)) {
        mounts.push({
          mountPaths: paths,
          routerText: describe(handler),
          routerFile: null,
          isStaticFileMount: true,
          line: lineOf(node),
        });
      } else {
        const identifier: string | null = rootIdentifier(handler);
        const routerFile: string | null = routerModuleFor(sourceFile, handler);

        if (!routerFile) {
          unreadable.push({
            reason: identifier
              ? `router "${identifier}" is not imported from a local module`
              : "router expression is not statically resolvable",
            text: describe(node),
            line: lineOf(node),
          });
        } else {
          mounts.push({
            mountPaths: paths,
            routerText: describe(handler),
            routerFile: routerFile,
            isStaticFileMount: false,
            line: lineOf(node),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return { mounts: mounts, unreadable: unreadable };
}

/*
 * ------------------------------------------------------------------ *
 * router.get() registrations
 * ------------------------------------------------------------------
 */

export interface RouteScan {
  /* Paths registered for GET (which Express also serves for HEAD). */
  getPaths: Array<string>;
  /* Registrations whose path could not be resolved, or that nest a router. */
  unreadable: Array<UnreadableMount>;
}

/*
 * GET paths a router module registers. `router.use(sub)` is reported as
 * unreadable rather than followed: a nested router's paths are relative to
 * its own mount, and quietly ignoring one would understate the surface.
 */
export function scanRouterGetPaths(sourceFile: ts.SourceFile): RouteScan {
  const getPaths: Array<string> = [];
  const unreadable: Array<UnreadableMount> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      const method: string = node.expression.name.text;
      const target: ts.Expression = node.expression.expression;

      /*
       * Match on the receiver's source text, not on a resolved identifier:
       * the class-based APIs register with `this.router.get(...)`, whose
       * receiver bottoms out at `this` rather than at any identifier.
       */
      const looksLikeRouter: boolean = ROUTER_RECEIVER.test(
        target.getText(sourceFile).trim(),
      );

      if (looksLikeRouter && method === "route") {
        unreadable.push({
          reason: "router.route() chains are not read by this scanner",
          text: describe(node),
          line: lineOf(node),
        });
      }

      if (looksLikeRouter && method === "use") {
        unreadable.push({
          reason: "router.use() nests a router whose paths are not followed",
          text: describe(node),
          line: lineOf(node),
        });
      }

      if (
        looksLikeRouter &&
        GET_SERVING_METHODS.includes(method) &&
        node.arguments.length >= 1
      ) {
        const first: ts.Expression = node.arguments[0] as ts.Expression;
        const paths: Array<string> | null = staticMountPaths(sourceFile, first);

        if (paths === null) {
          unreadable.push({
            reason: `${method}() path is not statically resolvable`,
            text: describe(node),
            line: lineOf(node),
          });
        } else {
          getPaths.push(...paths);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return { getPaths: getPaths, unreadable: unreadable };
}

/*
 * ------------------------------------------------------------------ *
 * The predicate under test
 * ------------------------------------------------------------------
 */

export function firstPathSegment(requestPath: string): string | null {
  const segment: string | undefined = requestPath.split("/").filter(Boolean)[0];

  return segment ? `/${segment}` : null;
}

export function joinMountAndRoute(mountPath: string, route: string): string {
  const prefix: string = mountPath === "/" ? "" : mountPath.replace(/\/$/, "");
  const suffix: string = route.startsWith("/") ? route : `/${route}`;

  return `${prefix}${suffix}`;
}
