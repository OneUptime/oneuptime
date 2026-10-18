import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY COOKIE ONEUPTIME WRITES STAYS ON HTTPS WHEN THE BROWSER IS ON HTTPS.
 *
 * A cookie without the Secure attribute goes with every request to its host,
 * plain HTTP included, so a session cookie written during an HTTPS sign-in
 * crossed the network in clear text on the next http:// request to the same
 * host. The server now writes every cookie through CookieUtil.setCookie and
 * CookieUtil.removeCookie, which add Secure whenever the browser is on HTTPS
 * (RequestTransport.isHttps), and the browser-side code marks what a page on
 * HTTPS writes Secure the same way. That only holds while nothing writes a
 * cookie another way, so this guard reads all product code (ee/ too, when it
 * is checked out) and fails on:
 *
 *   - a server cookie written or cleared anywhere but CookieUtil
 *     (`res.cookie(...)`, `res.clearCookie(...)`);
 *   - a Set-Cookie header written by hand (`res.setHeader("Set-Cookie", ...)`
 *     and its relatives);
 *   - a browser cookie written with universal-cookie whose options do not
 *     say whether it is Secure.
 *
 * Read by TypeScript's own parser, so a word in a comment is never taken for
 * code.
 */

const COOKIE_MODULE: string = "packages/Common/Server/Utils/Cookie.ts";
const CODE_FILE: RegExp = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const TEMPLATE_FILE: RegExp = /\.(?:ejs|html)$/;
const COOKIE_MENTION: RegExp = /cookie/i;
const UNIVERSAL_COOKIE_MODULE: string = "universal-cookie";

/*
 * The cookie libraries product code may import: cookie-parser reads what a
 * browser sends, and universal-cookie writes browser cookies under the rule
 * below. Any other one would write cookies this guard does not read.
 */
const COOKIE_LIBRARIES: ReadonlySet<string> = new Set<string>([
  "cookie-parser",
  UNIVERSAL_COOKIE_MODULE,
]);

// What `document.cookie = ...` writes when it removes a cookie (it expires it).
const COOKIE_REMOVAL: RegExp = /expires=thu,\s*01 jan 1970|max-age=0(?![0-9])/i;
// Says Secure, or decides it (isHttps ? "; Secure" : ""), and is no "insecure".
const SECURE_ATTRIBUTE: RegExp = /(?<!in)secure/i;
const DOCUMENT_COOKIE: string = "document.cookie";

// The server's own cookie writers, on an Express response.
const SERVER_COOKIE_WRITERS: ReadonlySet<string> = new Set<string>([
  "cookie",
  "clearCookie",
]);

// The calls that write a response header by name.
const HEADER_WRITERS: ReadonlySet<string> = new Set<string>([
  "setHeader",
  "appendHeader",
  "set",
  "header",
  "append",
  "writeHead",
]);

interface CookieWrite {
  file: string;
  line: number;
  code: string;
}

function scriptKindOf(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }

  if (file.endsWith(".ts")) {
    return ts.ScriptKind.TS;
  }

  if (file.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }

  return ts.ScriptKind.JS;
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    path.basename(file),
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(file),
  );
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node): void => {
    visit(child, onNode);
  });
}

function writeAt(
  file: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
): CookieWrite {
  return {
    file,
    line:
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1,
    code: node.getText(sourceFile).split("\n")[0] || "",
  };
}

function calledMethod(node: ts.Node): string | null {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression)
  ) {
    return node.expression.name.text;
  }

  return null;
}

function isSetCookieName(node: ts.Node | undefined): boolean {
  if (!node) {
    return false;
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text.toLowerCase() === "set-cookie";
  }

  if (ts.isIdentifier(node)) {
    return node.text.toLowerCase() === "set-cookie";
  }

  return false;
}

// `res.cookie(...)` and `res.clearCookie(...)`, outside CookieUtil.
function findServerCookieWrites(
  file: string,
  text: string,
): Array<CookieWrite> {
  if (file === COOKIE_MODULE) {
    return [];
  }

  const sourceFile: ts.SourceFile = parse(file, text);
  const writes: Array<CookieWrite> = [];

  visit(sourceFile, (node: ts.Node): void => {
    const method: string | null = calledMethod(node);

    if (method && SERVER_COOKIE_WRITERS.has(method)) {
      writes.push(writeAt(file, sourceFile, node));
    }
  });

  return writes;
}

/*
 * A Set-Cookie header written by name: res.setHeader("Set-Cookie", ...),
 * res.set / header / append / appendHeader, and writeHead with a header
 * object that names it.
 */
function findSetCookieHeaderWrites(
  file: string,
  text: string,
): Array<CookieWrite> {
  if (file === COOKIE_MODULE) {
    return [];
  }

  const sourceFile: ts.SourceFile = parse(file, text);
  const writes: Array<CookieWrite> = [];

  visit(sourceFile, (node: ts.Node): void => {
    const method: string | null = calledMethod(node);

    if (!method || !HEADER_WRITERS.has(method) || !ts.isCallExpression(node)) {
      return;
    }

    const namesSetCookie: boolean = node.arguments.some(
      (argument: ts.Expression, index: number): boolean => {
        if (index === 0 && isSetCookieName(argument)) {
          return true;
        }

        return (
          ts.isObjectLiteralExpression(argument) &&
          argument.properties.some((property: ts.ObjectLiteralElementLike) => {
            return (
              ts.isPropertyAssignment(property) &&
              isSetCookieName(property.name)
            );
          })
        );
      },
    );

    if (namesSetCookie) {
      writes.push(writeAt(file, sourceFile, node));
    }
  });

  return writes;
}

function hasSecureProperty(literal: ts.ObjectLiteralExpression): boolean {
  return literal.properties.some(
    (property: ts.ObjectLiteralElementLike): boolean => {
      return (
        (ts.isPropertyAssignment(property) ||
          ts.isShorthandPropertyAssignment(property)) &&
        ts.isIdentifier(property.name) &&
        property.name.text === "secure"
      );
    },
  );
}

// The object literal a name is declared with in the same file, if any.
function declaredObjectLiteral(
  sourceFile: ts.SourceFile,
  name: string,
): ts.ObjectLiteralExpression | null {
  let found: ts.ObjectLiteralExpression | null = null;

  visit(sourceFile, (node: ts.Node): void => {
    if (
      !found &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      found = node.initializer;
    }
  });

  return found;
}

function importsUniversalCookie(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement: ts.Statement): boolean => {
    return (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === UNIVERSAL_COOKIE_MODULE
    );
  });
}

/*
 * A browser cookie written with universal-cookie (`cookies.set(name, value,
 * options)`) whose options - an object literal, or one declared under the
 * name passed - do not say `secure`.
 */
function findBrowserCookieWritesWithoutSecure(
  file: string,
  text: string,
): Array<CookieWrite> {
  const sourceFile: ts.SourceFile = parse(file, text);

  if (!importsUniversalCookie(sourceFile)) {
    return [];
  }

  const writes: Array<CookieWrite> = [];

  visit(sourceFile, (node: ts.Node): void => {
    if (calledMethod(node) !== "set" || !ts.isCallExpression(node)) {
      return;
    }

    const options: ts.Expression | undefined = node.arguments[2];
    let literal: ts.ObjectLiteralExpression | null = null;

    if (options && ts.isObjectLiteralExpression(options)) {
      literal = options;
    } else if (options && ts.isIdentifier(options)) {
      literal = declaredObjectLiteral(sourceFile, options.text);
    }

    if (!literal || !hasSecureProperty(literal)) {
      writes.push(writeAt(file, sourceFile, node));
    }
  });

  return writes;
}

// Whether a cookie string written to document.cookie may stand as it is.
function isAllowedDocumentCookieValue(value: string): boolean {
  return COOKIE_REMOVAL.test(value) || SECURE_ATTRIBUTE.test(value);
}

function isDocumentCookie(node: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(node) || node.name.text !== "cookie") {
    return false;
  }

  const owner: ts.Expression = node.expression;

  return (
    (ts.isIdentifier(owner) && owner.text === "document") ||
    (ts.isPropertyAccessExpression(owner) && owner.name.text === "document")
  );
}

/*
 * A browser cookie written straight to document.cookie that neither says
 * whether it is Secure nor removes the cookie (expires it). In code it is
 * read by the parser; in a template (.ejs, .html), whose scripts are inline,
 * by the line the write is on.
 */
function findDocumentCookieWritesWithoutSecure(
  file: string,
  text: string,
): Array<CookieWrite> {
  if (!text.includes(DOCUMENT_COOKIE)) {
    return [];
  }

  const writes: Array<CookieWrite> = [];

  if (TEMPLATE_FILE.test(file)) {
    text.split("\n").forEach((lineText: string, index: number): void => {
      let at: number = lineText.indexOf(DOCUMENT_COOKIE);

      while (at !== -1) {
        const rest: string = lineText
          .slice(at + DOCUMENT_COOKIE.length)
          .trimStart();
        const isWrite: boolean =
          (rest.startsWith("=") && !rest.startsWith("==")) ||
          rest.startsWith("+=");

        if (isWrite && !isAllowedDocumentCookieValue(rest)) {
          writes.push({
            file,
            line: index + 1,
            code: lineText.trim(),
          });
        }

        at = lineText.indexOf(DOCUMENT_COOKIE, at + DOCUMENT_COOKIE.length);
      }
    });

    return writes;
  }

  const sourceFile: ts.SourceFile = parse(file, text);

  visit(sourceFile, (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) &&
      isDocumentCookie(node.left) &&
      !isAllowedDocumentCookieValue(node.right.getText(sourceFile))
    ) {
      writes.push(writeAt(file, sourceFile, node));
    }
  });

  return writes;
}

/*
 * The package a module specifier names: "universal-cookie" of
 * "universal-cookie", "@scope/name" of "@scope/name/sub", "Common" of
 * "Common/Server/Utils/Cookie" (the repository's own package, whose file
 * names are no library).
 */
function packageNameOf(specifier: string): string {
  const parts: Array<string> = specifier.split("/");

  return specifier.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : parts[0] || "";
}

// The packages a file imports or requires whose names speak of cookies.
function findCookieLibraries(file: string, text: string): Array<string> {
  const sourceFile: ts.SourceFile = parse(file, text);
  const libraries: Array<string> = [];

  const note: (specifier: ts.Expression | undefined) => void = (
    specifier: ts.Expression | undefined,
  ): void => {
    if (
      specifier &&
      ts.isStringLiteralLike(specifier) &&
      !specifier.text.startsWith(".") &&
      COOKIE_MENTION.test(packageNameOf(specifier.text))
    ) {
      libraries.push(packageNameOf(specifier.text));
    }
  };

  visit(sourceFile, (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      note(node.moduleSpecifier);
      return;
    }

    if (
      ts.isCallExpression(node) &&
      ((ts.isIdentifier(node.expression) &&
        node.expression.text === "require") ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) {
      note(node.arguments[0]);
    }
  });

  return libraries;
}

const hasEe: boolean = fs.existsSync(path.join(REPOSITORY_DIRECTORY, "ee"));

// Product code that mentions cookies at all: the only files these rules read.
function cookieCode(): Array<{ file: string; text: string }> {
  return listProductFiles(REPOSITORY_DIRECTORY, ["packages", "ee"])
    .filter((file: string): boolean => {
      return CODE_FILE.test(file);
    })
    .map((file: string) => {
      return {
        file,
        text: fs.readFileSync(path.join(REPOSITORY_DIRECTORY, file), "utf8"),
      };
    })
    .filter((entry: { file: string; text: string }): boolean => {
      return COOKIE_MENTION.test(entry.text);
    });
}

// Product templates (.ejs, .html) whose inline scripts touch document.cookie.
function cookieTemplates(): Array<{ file: string; text: string }> {
  return listProductFiles(REPOSITORY_DIRECTORY, ["packages", "ee"])
    .filter((file: string): boolean => {
      return TEMPLATE_FILE.test(file);
    })
    .map((file: string) => {
      return {
        file,
        text: fs.readFileSync(path.join(REPOSITORY_DIRECTORY, file), "utf8"),
      };
    })
    .filter((entry: { file: string; text: string }): boolean => {
      return entry.text.includes(DOCUMENT_COOKIE);
    });
}

describe("every cookie OneUptime writes goes through the rule that keeps it on HTTPS", () => {
  const code: Array<{ file: string; text: string }> = cookieCode();

  test("the scan reads the product code that writes cookies", () => {
    const files: Array<string> = code.map(
      (entry: { file: string; text: string }) => {
        return entry.file;
      },
    );

    expect(files).toContain(COOKIE_MODULE);
    expect(files).toContain(
      "packages/App/FeatureSet/Identity/API/Authentication.ts",
    );
    expect(files).toContain("packages/Common/UI/Utils/Cookie.ts");

    if (hasEe) {
      expect(
        listProductFiles(REPOSITORY_DIRECTORY, ["ee"]).length,
      ).toBeGreaterThan(0);
    }
  });

  test("no server code sets or clears a cookie except CookieUtil", () => {
    const writes: Array<CookieWrite> = code.flatMap(
      (entry: { file: string; text: string }) => {
        return findServerCookieWrites(entry.file, entry.text);
      },
    );

    expect(writes).toEqual([]);
  });

  test("no code writes a Set-Cookie header by hand", () => {
    const writes: Array<CookieWrite> = code.flatMap(
      (entry: { file: string; text: string }) => {
        return findSetCookieHeaderWrites(entry.file, entry.text);
      },
    );

    expect(writes).toEqual([]);
  });

  test("every browser cookie written with universal-cookie says whether it is Secure", () => {
    const writes: Array<CookieWrite> = code.flatMap(
      (entry: { file: string; text: string }) => {
        return findBrowserCookieWritesWithoutSecure(entry.file, entry.text);
      },
    );

    expect(writes).toEqual([]);
  });

  test("CookieUtil itself writes through Express with the Secure rule", () => {
    const text: string = fs.readFileSync(
      path.join(REPOSITORY_DIRECTORY, COOKIE_MODULE),
      "utf8",
    );

    // setCookie and removeCookie, each asking the rule.
    expect(text.split("RequestTransport.isHttps(res.req)").length - 1).toBe(2);
  });

  test("no browser code writes document.cookie without saying whether it is Secure, except to remove a cookie", () => {
    const templates: Array<{ file: string; text: string }> = cookieTemplates();

    // The consent banner's script removes analytics cookies this way.
    expect(
      templates.map((entry: { file: string; text: string }) => {
        return entry.file;
      }),
    ).toContain("packages/Common/Server/Views/Partials/AnalyticsConsent.ejs");

    const writes: Array<CookieWrite> = [...code, ...templates].flatMap(
      (entry: { file: string; text: string }) => {
        return findDocumentCookieWritesWithoutSecure(entry.file, entry.text);
      },
    );

    expect(writes).toEqual([]);
  });

  test("no product code brings in a cookie library but the two these rules cover", () => {
    const libraries: Array<string> = code.flatMap(
      (entry: { file: string; text: string }) => {
        return findCookieLibraries(entry.file, entry.text);
      },
    );

    expect(libraries).toContain("cookie-parser");
    expect(libraries).toContain(UNIVERSAL_COOKIE_MODULE);
    expect(
      [...new Set(libraries)].filter((library: string): boolean => {
        return !COOKIE_LIBRARIES.has(library);
      }),
    ).toEqual([]);
  });
});

describe("the guard finds what it is there to find", () => {
  test("a server cookie written or cleared outside CookieUtil", () => {
    const source: string = [
      "router.get('/x', (req, res) => {",
      "  res.cookie('session', token, { httpOnly: true });",
      "  res.clearCookie('state', { path: '/x' });",
      "  // res.cookie('in a comment', 'is not code');",
      "});",
    ].join("\n");

    expect(
      findServerCookieWrites("packages/App/Some/Route.ts", source).map(
        (write: CookieWrite) => {
          return write.line;
        },
      ),
    ).toEqual([2, 3]);
    expect(findServerCookieWrites(COOKIE_MODULE, source)).toEqual([]);
  });

  test("a Set-Cookie header written by hand, however it is spelled", () => {
    const source: string = [
      "res.setHeader('Set-Cookie', 'a=b');",
      'res.set("set-cookie", "a=b");',
      "res.append('SET-COOKIE', 'a=b');",
      "res.writeHead(200, { 'Set-Cookie': 'a=b' });",
      "res.setHeader('X-Other', 'a=b');",
      "const value = response.headers['set-cookie'];",
    ].join("\n");

    expect(
      findSetCookieHeaderWrites("packages/App/Some/Route.ts", source).map(
        (write: CookieWrite) => {
          return write.line;
        },
      ),
    ).toEqual([1, 2, 3, 4]);
  });

  test("a universal-cookie write that does not say whether it is Secure", () => {
    const source: string = [
      "import UniversalCookies from 'universal-cookie';",
      "new UniversalCookies().set('a', '1', { path: '/' });",
      "new UniversalCookies().set('b', '1');",
      "new UniversalCookies().set('c', '1', { path: '/', secure: isHttps });",
      "const options = { path: '/', secure: window.location.protocol === 'https:' };",
      "new UniversalCookies().set('d', '1', options);",
      "const bare = { path: '/' };",
      "new UniversalCookies().set('e', '1', bare);",
      "new UniversalCookies().remove('f', { path: '/' });",
    ].join("\n");

    expect(
      findBrowserCookieWritesWithoutSecure(
        "packages/Common/UI/Utils/Some.ts",
        source,
      ).map((write: CookieWrite) => {
        return write.line;
      }),
    ).toEqual([2, 3, 8]);
  });

  test("a file that does not use universal-cookie is not read for it", () => {
    expect(
      findBrowserCookieWritesWithoutSecure(
        "packages/Common/Server/Some.ts",
        "map.set('a', 1);",
      ),
    ).toEqual([]);
  });

  test("a document.cookie write in code that does not say whether it is Secure", () => {
    const source: string = [
      "document.cookie = 'session=' + token + '; path=/';",
      "window.document.cookie = `a=${value}; path=/`;",
      "document.cookie += 'b=1';",
      "document.cookie = 'insecure=1; path=/';",
      "document.cookie = `c=${value}; path=/${isHttps ? '; Secure' : ''}`;",
      "document.cookie = 'd=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';",
      "document.cookie = 'e=; Max-Age=0; path=/';",
      "const all: string = document.cookie;",
      "if (document.cookie == 'x') {}",
      "// document.cookie = 'in a comment';",
    ].join("\n");

    expect(
      findDocumentCookieWritesWithoutSecure(
        "packages/Common/UI/Utils/Some.ts",
        source,
      ).map((write: CookieWrite) => {
        return write.line;
      }),
    ).toEqual([1, 2, 3, 4]);
  });

  test("a document.cookie write in a template's inline script", () => {
    const source: string = [
      "<script>",
      "  document.cookie = 'session=' + token + '; path=/';",
      "  document.cookie='a=1';",
      "  var removed = document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';",
      "  document.cookie = 'b=1; Secure; path=/';",
      "  var all = document.cookie.split(';');",
      "  if (document.cookie === '') {}",
      "</script>",
    ].join("\n");

    expect(
      findDocumentCookieWritesWithoutSecure(
        "packages/Common/Server/Views/Some.ejs",
        source,
      ).map((write: CookieWrite) => {
        return write.line;
      }),
    ).toEqual([2, 3]);
  });

  test("a cookie library other than the two these rules cover", () => {
    const source: string = [
      "import Cookies from 'js-cookie';",
      "import { serialize } from 'cookie';",
      "import UniversalCookies from 'universal-cookie';",
      "import CookieParser from 'cookie-parser';",
      "import CookieUtil from '../Utils/Cookie';",
      "import ServerCookieUtil from 'Common/Server/Utils/Cookie';",
      "const nookies = require('nookies-cookie');",
      "export { default as ReactCookie } from 'react-cookie';",
      "const lazy = import('cookies-next');",
      "import CookieManager from '@react-native-cookies/cookies/lib';",
    ].join("\n");

    expect(
      findCookieLibraries("packages/Common/UI/Utils/Some.ts", source),
    ).toEqual([
      "js-cookie",
      "cookie",
      "universal-cookie",
      "cookie-parser",
      "nookies-cookie",
      "react-cookie",
      "cookies-next",
      "@react-native-cookies/cookies",
    ]);
  });
});
