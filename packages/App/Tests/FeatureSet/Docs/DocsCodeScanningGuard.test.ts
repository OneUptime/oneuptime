import {
  CharacterClass,
  DocsCodeScanningFinding,
  DocsCodeScanningProblem,
  FIXES,
  SHARED_HELPERS_FILE,
  characterClassesOf,
  findCodeScanningProblems,
} from "./DocsCodeScanning";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * THE DOCS TESTS WRITE NOTHING CODE SCANNING REPORTS.
 *
 * Code scanning (CodeQL) reads test code too. In a few days it opened six
 * alerts on the docs tests, all from patterns copied between suites: a
 * RegExp built from text with only its dots escaped (#2215), Markdown and
 * CSS escapes that left a backslash in the text alone (#2111, #2137), a
 * replace of the first "{" only (#2212), and the class of wide characters
 * whose ranges overlapped (#2216, #2217) once a compatibility ideograph in
 * it had become its canonical twin. Older ones were open as well: two more
 * dots-only escapes (#1868, #2112) and a URL looked for as a substring
 * (#1718, #1719).
 *
 * This guard reads every TypeScript file of the docs tests the way code
 * scanning does (DocsCodeScanning says each check) and fails on any of
 * that, and on a suite that escapes text for a pattern, or writes a class
 * of Chinese, Japanese and Korean letters, instead of using the shared
 * escapeRegExp and labelLineWidth (DocsTranslationChecks). Each check is
 * shown catching the code its alert was opened on, and passing the code
 * that replaced it.
 */

const DOCS_TESTS_DIR: string = __dirname;
const SHARED_CHECKS_MODULE: string = "./DocsTranslationChecks";
const SHARED_ESCAPE: string = "escapeRegExp";
// What a copy of the shared escape is called: escapeRegex, escapeForRegExp.
const ESCAPE_HELPER_NAME: RegExp = /^escape\w*Reg(?:Exp|ex)$/i;

function listTypeScriptFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node) => {
    visit(child, onNode);
  });
}

// The functions a file declares under a copy's name, arrow functions too.
function escapeHelpersDeclared(source: ts.SourceFile): Array<string> {
  const names: Array<string> = [];

  visit(source, (node: ts.Node) => {
    let name: ts.Node | undefined = undefined;

    if (ts.isFunctionDeclaration(node)) {
      name = node.name;
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      name = node.name;
    }

    if (
      name !== undefined &&
      ts.isIdentifier(name) &&
      ESCAPE_HELPER_NAME.test(name.text)
    ) {
      names.push(name.text);
    }
  });

  return names;
}

// Whether a file calls a function by this name.
function calls(source: ts.SourceFile, name: string): boolean {
  let found: boolean = false;

  visit(source, (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      found = true;
    }
  });

  return found;
}

// Whether a file imports this name from the shared checks.
function importsShared(source: ts.SourceFile, name: string): boolean {
  return source.statements.some((statement: ts.Statement): boolean => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== SHARED_CHECKS_MODULE
    ) {
      return false;
    }

    const bindings: ts.NamedImportBindings | undefined =
      statement.importClause?.namedBindings;

    return (
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element: ts.ImportSpecifier): boolean => {
        return element.name.text === name && !element.propertyName;
      })
    );
  });
}

// The class of every character a pattern reads as syntax, as suites wrote it.
const EVERY_SYNTAX_CHARACTER: string = "/[.*+?^${}()|[\\]\\\\]/g";
// A backslash, then what the pattern matched.
const ESCAPED_MATCH: string = '"\\\\$&"';

// Lines of TypeScript, as a file.
const code: (...lines: Array<string>) => string = (
  ...lines: Array<string>
): string => {
  return lines.join("\n");
};

const characters: (...codePoints: Array<number>) => string = (
  ...codePoints: Array<number>
): string => {
  return String.fromCodePoint(...codePoints);
};

// A class of character ranges, each typed as its two characters.
const typedRanges: (...bounds: Array<[number, number]>) => string = (
  ...bounds: Array<[number, number]>
): string => {
  return bounds
    .map(([low, high]: [number, number]): string => {
      return `${characters(low)}-${characters(high)}`;
    })
    .join("");
};

/*
 * The class of wide characters as two suites wrote it, its ranges typed as
 * the characters themselves: NetworkDocsTranslations with U+F900 to start
 * the fourth, DocsTranslationChecks with U+8C48, its canonical twin.
 */
const WIDE_RANGES_AS_TYPED: (fourthStart: number) => string = (
  fourthStart: number,
): string => {
  return `const WIDE_CHARACTER: RegExp = /[${typedRanges(
    [0x1100, 0x11ff],
    [0x2e80, 0x9fff],
    [0xac00, 0xd7af],
    [fourthStart, 0xfaff],
    [0xff00, 0xffef],
  )}]/;`;
};

// What a file holds, as "line: problem" for each finding.
const problemsOf: (text: string, fileName?: string) => Array<string> = (
  text: string,
  fileName: string = "SomeDocs.test.ts",
): Array<string> => {
  return findCodeScanningProblems(fileName, text).map(
    (finding: DocsCodeScanningFinding): string => {
      return `${finding.line}: ${finding.problem}`;
    },
  );
};

const detailsOf: (text: string, fileName?: string) => Array<string> = (
  text: string,
  fileName: string = "SomeDocs.test.ts",
): Array<string> => {
  return findCodeScanningProblems(fileName, text).map(
    (finding: DocsCodeScanningFinding): string => {
      return finding.detail;
    },
  );
};

describe("the docs tests write nothing code scanning reports", () => {
  const files: Array<string> = listTypeScriptFiles(DOCS_TESTS_DIR);

  const nameOf: (file: string) => string = (file: string): string => {
    return path.relative(DOCS_TESTS_DIR, file).split(path.sep).join("/");
  };

  it("reads every TypeScript file of the docs tests", () => {
    const names: Array<string> = files.map(nameOf);

    expect(names.length).toBeGreaterThan(250);
    expect(names).toEqual(
      expect.arrayContaining([
        SHARED_HELPERS_FILE,
        "DocsCodeScanning.ts",
        "DocsCodeScanningGuard.test.ts",
        // The files code scanning opened its alerts on.
        "StatusPageDocsFacts.test.ts",
        "ServerlessFunctionsDocs.test.ts",
        "FormsDocs.test.ts",
        "IncidentTemplateDocs.test.ts",
        "RightToLeftDocsLayout.test.ts",
        "LogShipperAndPublicApiDocsFacts.test.ts",
        "ValkeyRenameLocalization.test.ts",
        "NetworkDocsTranslations.test.ts",
      ]),
    );
  });

  it("finds nothing code scanning would report, and no escape or class of wide characters of a suite's own", () => {
    const findings: Array<string> = [];

    for (const file of files) {
      for (const finding of findCodeScanningProblems(
        nameOf(file),
        fs.readFileSync(file, "utf8"),
      )) {
        findings.push(
          `${finding.file}:${finding.line} ${finding.problem}: ${finding.code} (${finding.detail}) - ${FIXES[finding.problem]}`,
        );
      }
    }

    expect(findings).toEqual([]);
  });

  it("escapes text for a pattern with the one escapeRegExp, which DocsTranslationChecks exports and every suite that escapes imports", () => {
    const copies: Array<string> = [];
    const callers: Array<string> = [];
    const notImporting: Array<string> = [];

    for (const file of files) {
      const name: string = nameOf(file);
      const source: ts.SourceFile = parse(name, fs.readFileSync(file, "utf8"));

      if (name !== SHARED_HELPERS_FILE) {
        copies.push(
          ...escapeHelpersDeclared(source).map((helper: string): string => {
            return `${name}: ${helper}`;
          }),
        );
      }

      if (name === SHARED_HELPERS_FILE || !calls(source, SHARED_ESCAPE)) {
        continue;
      }

      callers.push(name);

      if (!importsShared(source, SHARED_ESCAPE)) {
        notImporting.push(name);
      }
    }

    const shared: ts.SourceFile = parse(
      SHARED_HELPERS_FILE,
      fs.readFileSync(path.join(DOCS_TESTS_DIR, SHARED_HELPERS_FILE), "utf8"),
    );

    expect(escapeHelpersDeclared(shared)).toEqual([SHARED_ESCAPE]);
    expect(copies).toEqual([]);
    expect(notImporting).toEqual([]);
    // The suites that escaped text themselves, with a partial escape among them.
    expect(callers).toEqual(
      expect.arrayContaining([
        "StatusPageDocsFacts.test.ts",
        "ServerlessFunctionsDocs.test.ts",
        "MicrosoftFoundryDocs.test.ts",
        "NetworkDocsLabels.ts",
        "IdentityDocsFacts.test.ts",
        "TelemetryDocsTranslations.test.ts",
      ]),
    );
    expect(callers.length).toBeGreaterThanOrEqual(35);
  });
});

describe("the code each alert was opened on, found again", () => {
  it.each([
    [
      "#2215, a RegExp built from text with its dots escaped",
      "StatusPageDocsFacts.test.ts",
      String.raw`const pattern: RegExp = new RegExp(condition.replace(/\./g, "\\."));`,
      ["1: incomplete escape"],
    ],
    [
      "#1868, the same in a table row's first cell",
      "ServerlessFunctionsDocs.test.ts",
      String.raw`const row: RegExp = new RegExp(attribute.replace(/\./g, "\\."));`,
      ["1: incomplete escape"],
    ],
    [
      "#2111, a mention's angle brackets escaped",
      "FormsDocs.test.ts",
      String.raw`expect(section).toContain(mention.replace(/[<>]/g, "\\$&"));`,
      ["1: incomplete escape"],
    ],
    [
      "#2112, the same in a helper",
      "IncidentTemplateDocs.test.ts",
      code(
        "const escapedInProse: (text: string) => string = (text: string): string => {",
        String.raw`  return text.replace(/[<>]/g, "\\$&");`,
        "};",
      ),
      ["2: incomplete escape"],
    ],
    [
      "#2137, a Tailwind class escaped into a selector by hand",
      "RightToLeftDocsLayout.test.ts",
      String.raw`const selector: string = "." + token.replace(/([.:/[\]])/g, "\\$1");`,
      ["1: incomplete escape"],
    ],
    [
      "#2212, the first brace of a block replaced",
      "LogShipperAndPublicApiDocsFacts.test.ts",
      code(
        "while (at >= 0) {",
        '  blocks.push(blockFrom(NGINX_TEMPLATE, at).replace("{", opening + "{"));',
        "}",
      ),
      ["2: first occurrence only"],
    ],
    [
      "#1718 and #1719, valkey.io looked for in the text",
      "ValkeyRenameLocalization.test.ts",
      code(
        'const VALKEY_LINK: string = "https://valkey.io";',
        "blocks.filter((block: string): boolean => {",
        "  return block.includes(VALKEY_LINK);",
        "});",
        "lines.filter((line: string): boolean => {",
        "  return !line.includes(VALKEY_LINK);",
        "});",
      ),
      ["3: URL substring check", "6: URL substring check"],
    ],
  ])(
    "finds %s",
    (
      _alert: string,
      fileName: string,
      text: string,
      expected: Array<string>,
    ) => {
      expect(problemsOf(text, fileName)).toEqual(expected);
    },
  );

  it("finds #2216 and #2217: the shared class of wide characters, whose fourth range started at U+8C48", () => {
    const text: string = WIDE_RANGES_AS_TYPED(0x8c48);

    expect(problemsOf(text, SHARED_HELPERS_FILE)).toEqual([
      "1: overlapping ranges",
      "1: overlapping ranges",
    ]);
    expect(detailsOf(text, SHARED_HELPERS_FILE)).toEqual([
      expect.stringContaining("(U+2E80-U+9FFF) and ") as unknown as string,
      expect.stringContaining("(U+AC00-U+D7AF) and ") as unknown as string,
    ]);
    // What code scanning said each overlaps with.
    for (const detail of detailsOf(text, SHARED_HELPERS_FILE)) {
      expect(detail).toContain("(U+8C48-U+FAFF)");
    }
  });

  it("finds the network suite's copy, typed with U+F900, which normalization turns into the shared one's", () => {
    const text: string = WIDE_RANGES_AS_TYPED(0xf900);

    expect(problemsOf(text, "NetworkDocsTranslations.test.ts")).toEqual([
      "1: normalized character",
      "1: own wide-character class",
    ]);
    expect(detailsOf(text, "NetworkDocsTranslations.test.ts")[0]).toBe(
      "NFC turns U+F900 into U+8C48",
    );
    // Normalized, it is the shared class's bug.
    expect(problemsOf(text.normalize("NFC"), SHARED_HELPERS_FILE)).toEqual([
      "1: overlapping ranges",
      "1: overlapping ranges",
    ]);
  });

  it("passes what replaced each", () => {
    const shared: string = fs.readFileSync(
      path.join(DOCS_TESTS_DIR, SHARED_HELPERS_FILE),
      "utf8",
    );

    expect(problemsOf(shared, SHARED_HELPERS_FILE)).toEqual([]);
    expect(
      problemsOf(
        code(
          'import { escapeRegExp } from "./DocsTranslationChecks";',
          "const pattern: RegExp = new RegExp(escapeRegExp(condition));",
          'expect(section).toContain("\\\\<!channel\\\\>");',
          "blocks.push(opening.slice(0, -1) + blockFrom(NGINX_TEMPLATE, at));",
          'const VALKEY_ORIGIN: string = "https://valkey.io";',
          "const linked: boolean = new URL(address).origin === VALKEY_ORIGIN;",
        ),
      ),
    ).toEqual([]);
  });
});

describe("findCodeScanningProblems, on code written here", () => {
  describe("escapes (js/incomplete-sanitization)", () => {
    it.each([
      [
        "a complete escape in a constant",
        code(
          `const SPECIAL: RegExp = ${EVERY_SYNTAX_CHARACTER};`,
          `text.replace(SPECIAL, ${ESCAPED_MATCH});`,
        ),
        "2: own escape",
      ],
      [
        "replaceAll",
        `text.replaceAll(${EVERY_SYNTAX_CHARACTER}, ${ESCAPED_MATCH});`,
        "1: own escape",
      ],
      [
        "a numbered group",
        String.raw`text.replace(/([.\\])/g, "\\$1");`,
        "1: own escape",
      ],
      [
        "a named group",
        String.raw`text.replace(/(?<c>[.\\])/g, "\\$<c>");`,
        "1: own escape",
      ],
      [
        "backslashes doubled with a pattern",
        String.raw`text.replace(/\\/g, "\\\\");`,
        "1: own escape",
      ],
      [
        "backslashes doubled with replaceAll",
        String.raw`text.replaceAll("\\", "\\\\");`,
        "1: own escape",
      ],
      [
        "an escape in a pattern built with new RegExp",
        String.raw`text.replace(new RegExp("[.\\\\]", "g"), "\\$&");`,
        "1: own escape",
      ],
    ])(
      "finds %s outside the shared helpers",
      (_shape: string, text: string, expected: string) => {
        expect(problemsOf(text)).toEqual([expected]);
        // The same code is the shared helpers' to write.
        expect(problemsOf(text, SHARED_HELPERS_FILE)).toEqual([]);
      },
    );

    it.each([
      ["only the dots", String.raw`text.replace(/\./g, "\\.");`],
      ["only the angle brackets", String.raw`text.replace(/[<>]/g, "\\$&");`],
      ["a group of a few", String.raw`text.replace(/([.:/[\]])/g, "\\$1");`],
      [
        "every syntax character but only the first",
        `text.replace(${EVERY_SYNTAX_CHARACTER.slice(0, -1)}, ${ESCAPED_MATCH});`,
      ],
      ["a string's first match", String.raw`text.replace("/", "\\/");`],
      ["a backslash's first match", String.raw`text.replace("\\", "\\\\");`],
    ])(
      "finds an incomplete escape: %s, even in the shared helpers",
      (_shape: string, text: string) => {
        expect(problemsOf(text)).toEqual(["1: incomplete escape"]);
        expect(problemsOf(text, SHARED_HELPERS_FILE)).toEqual([
          "1: incomplete escape",
        ]);
      },
    );

    it("says what an incomplete escape leaves", () => {
      expect(detailsOf(String.raw`text.replace(/\./g, "\\.");`)).toEqual([
        "a backslash in the text is left as it is",
      ]);
      expect(detailsOf(String.raw`text.replace("/", "\\/");`)).toEqual([
        "it escapes only the first match",
      ]);
    });

    it("passes what escapes nothing", () => {
      expect(
        problemsOf(
          code(
            // The shared helper.
            "const pattern: RegExp = new RegExp(`^${escapeRegExp(label)}$`);",
            // An escaped placeholder turned into a pattern of its own.
            String.raw`text.replace(/\\\{\\\{count\\\}\\\}/g, "\\d+");`,
            // A backslash written for a character, not before it.
            String.raw`text.replace(/x/g, "\\");`,
            String.raw`text.replace(/a/g, "b");`,
            // A replacement that a function makes.
            String.raw`text.replace(/[<>]/g, (c: string): string => { return "&#" + c.charCodeAt(0) + ";"; });`,
            // An unescape: the backslash taken out.
            String.raw`text.replace(/\\(.)/g, "$1");`,
          ),
        ),
      ).toEqual([]);
    });
  });

  describe("first occurrences (js/incomplete-sanitization)", () => {
    it.each([
      ["a brace", 'text.replace("{", "x");'],
      ["an angle bracket", 'text.replace("<", "&lt;");'],
      ["a pattern of one", "text.replace(/</, '&lt;');"],
      ["a class of two", "text.replace(/[<>]/, '');"],
      ["a quote", "text.replace('\"', '');"],
      ["a path step", 'text.replace("..", "");'],
      ["a URL escape", 'text.replace("%20", " ");'],
      ["a URL encoding", 'text.replace(" ", "%20");'],
      ["a percent sign in a chain", 'text.replace("%", "").replace("a", "b");'],
      ["a newline, by a pattern", "text.replace(/\\n/, ' ');"],
      ["a tab, by a pattern", "text.replace(/\\t/, ' ');"],
      [
        "a replace inside a loop whose result is kept elsewhere",
        'for (const b of blocks) { out.push(b.replace("{", "")); }',
      ],
    ])("finds %s", (_shape: string, text: string) => {
      expect(problemsOf(text)).toContain("1: first occurrence only");
    });

    it("says which text is replaced only once", () => {
      expect(detailsOf('text.replace("{", "x");')).toEqual([
        'it replaces only the first "{"',
      ]);
    });

    it("passes what code scanning lets be", () => {
      expect(
        problemsOf(
          code(
            // Every occurrence.
            'text.replaceAll("{", "x");',
            "text.replace(/\\{/g, 'x');",
            // A loop that feeds the replace its own text.
            'while (text.includes("<")) { text = text.replace("<", ""); }',
            // The delimiters taken off both ends.
            'text.replace("[", "").replace("]", "");',
            "text.replace('\"', '').replace('\"', '');",
            // One newline, percent sign or dollar taken out on its own.
            'text.replace("%", "");',
            'text.replace("\\n", "");',
            "text.replace(/\\n/, '');",
            'price.replace("$", "");',
            // A word boundary, which is no character.
            "text.replace(/\\b/, ' ');",
            // Not a meta-character.
            'text.replace("abc", "x");',
            'text.replace("{{", "x");',
          ),
        ),
      ).toEqual([]);
    });
  });

  describe("ranges (js/overly-large-range)", () => {
    it("finds two ranges that share characters, and says which", () => {
      expect(problemsOf("const P: RegExp = /[a-zc-f]/;")).toEqual([
        "1: overlapping ranges",
      ]);
      expect(detailsOf("const P: RegExp = /[a-zc-f]/;")).toEqual([
        "a-z (U+0061-U+007A) and c-f (U+0063-U+0066) share U+0063-U+0066",
      ]);
    });

    it("finds them written with escapes, and in a pattern built from a string, which code scanning leaves out", () => {
      expect(
        problemsOf(
          String.raw`const P: RegExp = /[\u{3000}-\u{30FF}\u{3040}-\u{309F}]/u;`,
        ),
      ).toEqual(["1: overlapping ranges"]);
      expect(
        problemsOf(String.raw`const P: RegExp = new RegExp("[a-zc-f]");`),
      ).toEqual(["1: overlapping ranges"]);
      expect(
        problemsOf(
          String.raw`const P: RegExp = new RegExp("[\\x61-\\x7a\\x63-\\x66]");`,
        ),
      ).toEqual(["1: overlapping ranges"]);
    });

    it("finds a range that matches what a class escape beside it does", () => {
      expect(problemsOf(String.raw`const P: RegExp = /[\da-f0-5]/;`)).toEqual([
        "1: range overlapping a class escape",
      ]);
      expect(problemsOf(String.raw`const P: RegExp = /[\s\t-\r]/;`)).toEqual([
        "1: range overlapping a class escape",
      ]);
      expect(problemsOf(String.raw`const P: RegExp = /[\w$-_]/;`)).toContain(
        "1: range overlapping a class escape",
      );
    });

    it("reads \\d, \\w and \\s as the runtime does, up to their last character", () => {
      // [ \\ ] ^ sit just before "_", the one \\w character between Z and a.
      expect(
        problemsOf(String.raw`const P: RegExp = /[\w\u{5B}-\u{5E}]/u;`),
      ).toEqual([]);
      expect(
        problemsOf(String.raw`const P: RegExp = /[\w\u{5B}-\u{5F}]/u;`),
      ).toEqual(["1: range overlapping a class escape"]);
      // The general punctuation spaces are \\s; the zero-width ones after them are not.
      expect(
        problemsOf(String.raw`const P: RegExp = /[\s\u{2000}-\u{200A}]/u;`),
      ).toEqual(["1: range overlapping a class escape"]);
      expect(
        problemsOf(String.raw`const P: RegExp = /[\s\u{200B}-\u{200F}]/u;`),
      ).toEqual([]);
      expect(
        problemsOf(String.raw`const P: RegExp = /[\s\u{FEFF}]/u;`),
      ).toEqual([]);
      expect(
        problemsOf(String.raw`const P: RegExp = /[\d\u{3A}-\u{40}]/u;`),
      ).toEqual([]);
    });

    it.each([
      ["A-z", "/[A-z]/"],
      ["+-=", "/[+-=]/"],
      ["0-z", "/[0-z]/"],
      ["#-/", "/[#-/x]/"],
    ])("finds the overly wide range %s", (_range: string, literal: string) => {
      expect(problemsOf(`const P: RegExp = ${literal};`)).toContain(
        "1: overly wide range",
      );
    });

    it("passes ranges that share nothing, and the wide ones code scanning allows", () => {
      expect(
        problemsOf(
          code(
            "const HEX: RegExp = /^[0-9A-Fa-f]+$/;",
            "const PRINTABLE: RegExp = /[ -~]/;",
            "const VISIBLE: RegExp = /[!-~]/;",
            "const CONTROL: RegExp = /[@-_]/;",
            "const UPPER: RegExp = /[@-Z]/;",
            "const DIGITS_AND_SIGNS: RegExp = /[0-?]/;",
            String.raw`const ASCII: RegExp = /[\x00-\x7f]/;`,
            "const PERSIAN_DIGITS: RegExp = /[۰-۹]/g;",
            String.raw`const ADJACENT: RegExp = /[\u{3000}-\u{303F}\u{3040}-\u{309F}]/u;`,
            String.raw`const SCRIPTS: RegExp = /[\p{Script=Han}\u{3000}-\u{303F}]/u;`,
            // A pattern the runtime refuses is passed over, not thrown on.
            'const BROKEN: RegExp = new RegExp("[z-a]");',
            'const OPEN: RegExp = new RegExp("(");',
          ),
        ),
      ).toEqual([]);
    });
  });

  describe("characters normalization changes", () => {
    it("finds a CJK compatibility ideograph, and a Kelvin sign, typed in a pattern", () => {
      expect(
        problemsOf(
          `const P: RegExp = /[${characters(0xf900)}-${characters(0xfaff)}]/;`,
        ),
      ).toEqual(["1: normalized character"]);
      expect(
        detailsOf(`const P: RegExp = /[${characters(0x212a)}a-z]/i;`),
      ).toEqual(["NFC turns U+212A into U+004B"]);
    });

    it("finds a letter and a combining mark that normalization joins", () => {
      expect(
        detailsOf(`const P: RegExp = /caf${characters(0x65, 0x301)}/;`),
      ).toEqual(["NFC joins characters of it into one"]);
    });

    it("passes the character written as an escape, and characters normalization keeps", () => {
      expect(
        problemsOf(
          code(
            String.raw`const P: RegExp = /[\u{F900}-\u{FAFF}]/u;`,
            `const Q: RegExp = /[${characters(0x8c48)}${characters(0xac00)}-${characters(0xd7a3)}]/;`,
            `const R: RegExp = /caf${characters(0xe9)}/;`,
          ),
        ),
      ).toEqual([]);
    });
  });

  describe("classes of wide characters", () => {
    it.each([
      [
        "by code points",
        String.raw`const WIDE: RegExp = /[\u{4E00}-\u{9FFF}\u{30A0}-\u{30FF}\u{AC00}-\u{D7AF}]/u;`,
      ],
      [
        "by script",
        String.raw`const WIDE: RegExp = /[\p{Script=Han}\p{Script=Katakana}\p{Script=Hangul}]/u;`,
      ],
    ])(
      "finds one a suite writes %s, and leaves the shared helpers theirs",
      (_shape: string, text: string) => {
        expect(problemsOf(text)).toEqual(["1: own wide-character class"]);
        expect(problemsOf(text, SHARED_HELPERS_FILE)).toEqual([]);
      },
    );

    it("passes a class of one script, of letters of every script, and of right-to-left letters", () => {
      expect(
        problemsOf(
          code(
            String.raw`const HAN: RegExp = /[\u{4E00}-\u{9FFF}]/u;`,
            String.raw`const LETTER: RegExp = /\p{L}/u;`,
            String.raw`const NOT_ASCII: RegExp = /[^\x00-\x7F]/;`,
            String.raw`const RIGHT_TO_LEFT: RegExp = /[\p{Script=Arabic}\p{Script=Hebrew}]/u;`,
          ),
        ),
      ).toEqual([]);
    });
  });

  describe("URL substring checks (js/incomplete-url-substring-sanitization)", () => {
    it.each([
      ["includes", 'url.includes("https://valkey.io");'],
      [
        "includes, with a path",
        'text.includes("https://example.dev/docs/page");',
      ],
      ["a host's suffix", 'host.endsWith("example.com");'],
      ["a prefix without a slash", 'url.startsWith("https://example.com");'],
      ["a compared indexOf", 'text.indexOf("example.org") !== -1;'],
      ["an indexOf at the start", 'url.indexOf("https://example.com") === 0;'],
      ["a bitwise-not indexOf", 'if (~text.indexOf("example.io")) { x(); }'],
      [
        "a constant's URL",
        code(
          'const SITE: string = "https://oneuptime.com";',
          "text.includes(SITE);",
        ),
      ],
    ])("finds %s", (_shape: string, text: string) => {
      expect(problemsOf(text)).toEqual([
        expect.stringMatching(
          /^\d+: URL substring check$/,
        ) as unknown as string,
      ]);
    });

    it("says what each kind of check lets through", () => {
      expect(detailsOf('url.includes("https://valkey.io");')).toEqual([
        '"https://valkey.io" can be anywhere in the URL, with any host before or after it',
      ]);
      expect(detailsOf('url.startsWith("https://example.com");')).toEqual([
        '"https://example.com" can be followed by any host name',
      ]);
      expect(detailsOf('host.endsWith("example.com");')).toEqual([
        '"example.com" can be preceded by any host name',
      ]);
    });

    it("passes what code scanning allows, and what is not a substring check", () => {
      expect(
        problemsOf(
          code(
            'url.startsWith("https://example.com/");',
            'url.startsWith("https://example.com:8443");',
            'host.endsWith(".example.com");',
            'text.includes("example");',
            'url.startsWith("https://example.dev/docs/page");',
            'const linked: boolean = new URL(address).origin === "https://valkey.io";',
            'expect(page).toContain("https://valkey.io");',
            'const at: number = text.indexOf("https://valkey.io");',
          ),
        ),
      ).toEqual([]);
    });
  });

  it("gives each finding its line, its code on one line, and a fix", () => {
    const findings: Array<DocsCodeScanningFinding> = findCodeScanningProblems(
      "SomeDocs.test.ts",
      code(
        "const a: number = 1;",
        "",
        "const b: string = text.replace(",
        "  /\\./g,",
        '  "\\\\.",',
        ");",
      ),
    );

    expect(findings).toEqual([
      {
        file: "SomeDocs.test.ts",
        line: 3,
        problem: "incomplete escape",
        code: 'text.replace( /\\./g, "\\\\.", )',
        detail: "a backslash in the text is left as it is",
      },
    ]);

    const problems: Array<DocsCodeScanningProblem> = Object.keys(
      FIXES,
    ) as Array<DocsCodeScanningProblem>;

    expect(problems.length).toBe(9);

    for (const problem of problems) {
      expect(FIXES[problem].length).toBeGreaterThan(20);
    }
  });
});

describe("characterClassesOf, as the runtime reads a class", () => {
  const only: (source: string, flags?: string) => CharacterClass = (
    source: string,
    flags: string = "",
  ): CharacterClass => {
    const classes: Array<CharacterClass> = characterClassesOf(source, flags);

    expect(classes).toHaveLength(1);

    return classes[0] as CharacterClass;
  };

  it("reads ranges, single characters, class escapes and negation", () => {
    expect(only("[^a-z\\d_]")).toEqual({
      text: "[^a-z\\d_]",
      negated: true,
      ranges: [{ low: 0x61, high: 0x7a, text: "a-z" }],
      characters: [0x5f],
      classEscapes: ["d"],
      propertyEscapes: [],
    });
  });

  it("reads a dash at either end, or beside a class escape, as itself", () => {
    expect(only("[-a]").characters).toEqual([0x2d, 0x61]);
    expect(only("[a-]").characters).toEqual([0x61, 0x2d]);
    expect(only("[\\w-.]")).toMatchObject({
      ranges: [],
      characters: [0x2d, 0x2e],
      classEscapes: ["w"],
    });
  });

  it("reads escaped brackets and backslashes inside a class, and skips escapes outside one", () => {
    expect(only("[\\]a]").characters).toEqual([0x5d, 0x61]);
    expect(only("[\\\\-a]").ranges).toEqual([
      { low: 0x5c, high: 0x61, text: "\\\\-a" },
    ]);
    expect(characterClassesOf("\\[a-z\\]", "")).toEqual([]);
    // An escaped backslash, then a class.
    expect(characterClassesOf("a\\\\[b-c]", "")).toHaveLength(1);
  });

  it("reads an empty class, and one of everything", () => {
    expect(only("[]")).toMatchObject({ negated: false, characters: [] });
    expect(only("[^]")).toMatchObject({ negated: true, characters: [] });
  });

  it("reads hex, unicode and control escapes", () => {
    expect(only("[\\x41-\\x5A]").ranges[0]).toMatchObject({
      low: 0x41,
      high: 0x5a,
    });
    expect(only("[\\u0041-\\u005A]").ranges[0]).toMatchObject({
      low: 0x41,
      high: 0x5a,
    });
    expect(only("[\\b\\t\\n\\v\\f\\r\\cJ\\0]").characters).toEqual([
      0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0a, 0x00,
    ]);
  });

  it("reads a character by code point with the u flag, by code unit without", () => {
    expect(only("[\\u{1F600}-\\u{1F64F}]", "u").ranges[0]).toMatchObject({
      low: 0x1f600,
      high: 0x1f64f,
    });
    expect(
      only("[\\uD83D\\uDE00-\\uD83D\\uDE4F]", "u").ranges[0],
    ).toMatchObject({ low: 0x1f600, high: 0x1f64f });
    expect(
      only(`[${characters(0x1f600)}-${characters(0x1f64f)}]`, "u").ranges[0],
    ).toMatchObject({ low: 0x1f600, high: 0x1f64f });
    // Without the u flag, "\u{...}" is a "u" and the rest as written.
    expect(only("[\\u{41}]").characters).toEqual(
      Array.from("u{41}").map((character: string): number => {
        return character.charCodeAt(0);
      }),
    );
    expect(only(`[${characters(0x1f600)}]`).characters).toEqual([
      0xd83d, 0xde00,
    ]);
  });

  it("reads property escapes with the u flag, and legacy octal escapes without it", () => {
    expect(only("[\\p{Script=Han}\\P{L}]", "u").propertyEscapes).toEqual([
      "\\p{Script=Han}",
      "\\P{L}",
    ]);
    expect(only("[\\101-\\132]").ranges[0]).toMatchObject({
      low: 0x41,
      high: 0x5a,
    });
  });

  it("reads every class of a pattern, and none of one with the v flag", () => {
    expect(
      characterClassesOf("[a-c]x[d-f]", "").map(
        (characterClass: CharacterClass): string => {
          return characterClass.text;
        },
      ),
    ).toEqual(["[a-c]", "[d-f]"]);
    expect(characterClassesOf("[\\p{L}--[a-z]]", "v")).toEqual([]);
  });

  it("reads the classes as the runtime does: each class's characters and ranges match what it matches", () => {
    const samples: Array<[string, string]> = [
      ["[a-f0-9_]", ""],
      ["[^\\x20-\\x7e]", ""],
      ["[\\u{3000}-\\u{303F}\\u{FF00}-\\u{FFEF}]", "u"],
      ["[\\]\\\\.-]", ""],
      ["[\\cA-\\cZ]", ""],
    ];

    for (const [source, flags] of samples) {
      const characterClass: CharacterClass = only(source, flags);
      const pattern: RegExp = new RegExp(`^${source}$`, flags);
      const misread: Array<number> = [];

      for (let value: number = 0; value <= 0xffff; value++) {
        const listed: boolean =
          characterClass.characters.includes(value) ||
          characterClass.ranges.some(
            (range: { low: number; high: number }): boolean => {
              return value >= range.low && value <= range.high;
            },
          );

        if (listed === characterClass.negated) {
          if (pattern.test(characters(value))) {
            misread.push(value);
          }
        } else if (!pattern.test(characters(value))) {
          misread.push(value);
        }
      }

      expect({ source: source, misread: misread }).toEqual({
        source: source,
        misread: [],
      });
    }
  });
});
