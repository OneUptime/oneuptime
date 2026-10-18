import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * Every route of the product that takes OneUptime's cluster key, read from
 * the source: a router call (get, post, put, patch, delete, all, use) that
 * hands it ClusterKeyAuthorization.isAuthorizedServiceMiddleware.
 *
 * The over-HTTP suite in App (Tests/ClusterKey/ClusterKeyRoutesOverHttp.test.ts)
 * holds its own list of routes to this one, so a new route that takes the
 * cluster key is noticed, and sends every value this repository ships to
 * every one of them. ClusterKeyGuard checks every use of the check is such a
 * route.
 */

export interface ClusterKeyRoute {
  // The file, from the repository root.
  file: string;
  // The router method, upper-cased (GET, POST, ...).
  method: string;
  // The source text of the path argument, as written.
  path: string;
}

export interface ClusterKeyMiddlewareUse {
  file: string;
  line: number;
  // Whether this use is an argument of a router call (a route).
  isRouteArgument: boolean;
}

const ROUTER_METHODS: Array<string> = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "all",
  "use",
];

const CODE_FILE: RegExp = /\.(?:ts|tsx)$/;

const MIDDLEWARE_OBJECT: string = "ClusterKeyAuthorization";
const MIDDLEWARE_PROPERTY: string = "isAuthorizedServiceMiddleware";

function parse(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    path.basename(relativePath),
    fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function isMiddlewareReference(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === MIDDLEWARE_OBJECT &&
    node.name.text === MIDDLEWARE_PROPERTY
  );
}

// The router method a call is, when it is `<anything>.<router method>(...)`.
function routerMethodOf(call: ts.CallExpression): string | null {
  if (!ts.isPropertyAccessExpression(call.expression)) {
    return null;
  }

  const name: string = call.expression.name.text;

  return ROUTER_METHODS.includes(name) ? name : null;
}

/*
 * Product files (packages/ and, when checked out, ee/) whose text mentions
 * the middleware at all: the cheap first pass.
 */
export function filesMentioningClusterKeyMiddleware(): Array<string> {
  return listProductFiles(REPOSITORY_DIRECTORY, ["packages", "ee"])
    .filter((relativePath: string): boolean => {
      return CODE_FILE.test(relativePath);
    })
    .filter((relativePath: string): boolean => {
      return fs
        .readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8")
        .includes(MIDDLEWARE_PROPERTY);
    });
}

// Every use of ClusterKeyAuthorization.isAuthorizedServiceMiddleware in code.
export function findClusterKeyMiddlewareUses(): Array<ClusterKeyMiddlewareUse> {
  const uses: Array<ClusterKeyMiddlewareUse> = [];

  for (const relativePath of filesMentioningClusterKeyMiddleware()) {
    const sourceFile: ts.SourceFile = parse(relativePath);

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (isMiddlewareReference(node)) {
        const parent: ts.Node = node.parent;
        const isRouteArgument: boolean =
          ts.isCallExpression(parent) &&
          parent.arguments.some((argument: ts.Expression): boolean => {
            return argument === node;
          }) &&
          routerMethodOf(parent) !== null;

        // The middleware's own definition site is not a use.
        if (!relativePath.endsWith("Middleware/ClusterKeyAuthorization.ts")) {
          uses.push({
            file: relativePath,
            line:
              sourceFile.getLineAndCharacterOfPosition(node.getStart()).line +
              1,
            isRouteArgument: isRouteArgument,
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return uses;
}

// Every route that takes the cluster key, sorted by file, then path, then method.
export function findClusterKeyRoutes(): Array<ClusterKeyRoute> {
  const routes: Array<ClusterKeyRoute> = [];

  for (const relativePath of filesMentioningClusterKeyMiddleware()) {
    const sourceFile: ts.SourceFile = parse(relativePath);

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const method: string | null = routerMethodOf(node);

        if (method && node.arguments.some(isMiddlewareReference)) {
          routes.push({
            file: relativePath,
            method: method.toUpperCase(),
            path: node.arguments[0]!.getText(sourceFile),
          });
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return routes.sort((a: ClusterKeyRoute, b: ClusterKeyRoute): number => {
    return (
      a.file.localeCompare(b.file) ||
      a.path.localeCompare(b.path) ||
      a.method.localeCompare(b.method)
    );
  });
}
