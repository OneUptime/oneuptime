// The own-regular-expression-escape lint rule (Scripts/Lint/OwnRegExpEscape.js),
// run with ESLint's API on planted snippets: the copies that reached main on
// 2026-11-15 (#8352) are reported, at the paths they were written in, and
// the shared escape, the docs suites' helpers and the other sinks' escapes
// (SQL LIKE, shell quoting, Markdown) are not. Then the real eslint.config.js
// is asked which files get which options, and this rule's lists are held to
// the code scanning guards' (CodeScanning.ts, DocsCodeScanningGuard.test.ts).
//
// Run: node --test Scripts/Lint/Tests/ (the js-lint job runs it before the
// lint). Needs the root's dependencies (npm install at the root).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const fromRoot = (request) => {
  return require(require.resolve(request, { paths: [REPO_ROOT] }));
};
const { ESLint, Linter } = fromRoot("eslint");
const tseslint = fromRoot("typescript-eslint");
const ownRegExpEscape = require("../OwnRegExpEscape.js");

const RULE = ownRegExpEscape.QUALIFIED_RULE_NAME;

const linter = new Linter({ configType: "flat", cwd: REPO_ROOT });
const CONFIG = [
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  ...ownRegExpEscape.CONFIGS,
];

// What the rule reports on `code`, written at `file` (a path from the root).
const lint = (code, file) => {
  const messages = linter.verify(code, CONFIG, {
    filename: path.join(REPO_ROOT, file),
  });

  for (const message of messages) {
    assert.notEqual(message.fatal, true, `${file}: ${message.message}`);
  }

  return messages
    .filter((message) => {
      return message.ruleId === RULE;
    })
    .map((message) => {
      return { line: message.line, messageId: message.messageId };
    });
};

const messageIdsOf = (code, file) => {
  return lint(code, file).map((finding) => {
    return finding.messageId;
  });
};

const messagesOf = (code, file) => {
  return linter
    .verify(code, CONFIG, { filename: path.join(REPO_ROOT, file) })
    .filter((message) => {
      return message.ruleId === RULE;
    })
    .map((message) => {
      return message.message;
    });
};

const readFromRoot = (file) => {
  return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
};

const COMMON_TEST = "packages/Common/Tests/App/Dashboard/Planted.test.tsx";
const DOCS_TEST = "packages/App/Tests/FeatureSet/Docs/Planted.test.ts";
const AGENT_FILE = "agents/KubernetesLogTailer/Planted.ts";

// ---------------------------------------------------------------------------
// The three that reached main on 2026-11-15, where they were written.
// ---------------------------------------------------------------------------

test("a copy of escapeRegExp in a docs suite (DefaultStateNamesInDocs, #8045) is reported, as a copy and as an escape of its own", () => {
  const code = [
    "const escapeRegExp: (text: string) => string = (text: string): string => {",
    '  return text.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");',
    "};",
    "",
    "export const row: RegExp = new RegExp(escapeRegExp('**Identified**'));",
  ].join("\n");

  assert.deepEqual(
    lint(
      code,
      "packages/App/Tests/FeatureSet/Docs/DefaultStateNamesInDocs.test.ts",
    ),
    [
      { line: 1, messageId: "ownEscapeHelper" },
      { line: 2, messageId: "ownEscape" },
    ],
  );
  assert.deepEqual(
    messagesOf(
      code,
      "packages/App/Tests/FeatureSet/Docs/DefaultStateNamesInDocs.test.ts",
    ),
    [
      "escapeRegExp is a copy of escapeRegExp: escape text for a pattern with escapeRegExp from ./DocsTranslationChecks.",
      "This escapes text for a pattern with a copy of escapeRegExp: escape text for a pattern with escapeRegExp from ./DocsTranslationChecks.",
    ],
  );
});

test("an inline copy in a Common test (MetricChartUnsetGroupInLocale, 7f6b92e79a9) is reported, pointing to Common/Utils/RegExpEscape", () => {
  const code = [
    "declare const screen: { getByRole: (role: string, options: object) => unknown };",
    "export const find = (readerName: string): unknown => {",
    "  return screen.getByRole('button', {",
    '    name: new RegExp(readerName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")),',
    "    expanded: false,",
    "  });",
    "};",
  ].join("\n");
  const file =
    "packages/Common/Tests/App/Dashboard/MetricChartUnsetGroupInLocale.test.tsx";

  assert.deepEqual(lint(code, file), [{ line: 4, messageId: "ownEscape" }]);
  assert.deepEqual(messagesOf(code, file), [
    "This escapes text for a pattern with a copy of escapeRegExp: escape text for a pattern with escapeRegExp from Common/Utils/RegExpEscape.",
  ]);
});

test("a partial escape (NumbersKeepTheirUnitsGuard, 016ef41508c) is reported as leaving backslashes as they are", () => {
  const code = [
    "const UNITS: Array<string> = ['%', 'ms'];",
    "export const UNIT: string = [...UNITS]",
    "  .map((unit: string): string => {",
    '    return unit.replace(/[%]/g, "\\\\$&");',
    "  })",
    "  .join('|');",
  ].join("\n");
  const file = "packages/Common/Tests/App/NumbersKeepTheirUnitsGuard.test.ts";

  assert.deepEqual(lint(code, file), [
    { line: 4, messageId: "incompleteEscape" },
  ]);
  assert.match(
    messagesOf(code, file)[0],
    /^This does not escape backslash characters in the input: escape text for a pattern with escapeRegExp from Common\/Utils\/RegExpEscape/,
  );
});

test("the fixed versions of all three are not reported", () => {
  assert.deepEqual(
    lint(
      [
        'import { escapeRegExp } from "./DocsTranslationChecks";',
        "export const row: RegExp = new RegExp(escapeRegExp('**Identified**'));",
      ].join("\n"),
      "packages/App/Tests/FeatureSet/Docs/DefaultStateNamesInDocs.test.ts",
    ),
    [],
  );
  assert.deepEqual(
    lint(
      [
        'import { escapeRegExp } from "../../../Utils/RegExpEscape";',
        "export const name = (readerName: string): RegExp => {",
        "  return new RegExp(escapeRegExp(readerName));",
        "};",
        "export const UNIT: string = ['%'].map((unit: string): string => {",
        "  return escapeRegExp(unit);",
        "}).join('|');",
      ].join("\n"),
      COMMON_TEST,
    ),
    [],
  );
});

// ---------------------------------------------------------------------------
// The shared escape and the docs suites' helpers.
// ---------------------------------------------------------------------------

test("the shared escape itself, packages/Common/Utils/RegExpEscape.ts, is not reported", () => {
  const code = readFromRoot(ownRegExpEscape.SHARED_REGEXP_ESCAPE_FILE);

  assert.deepEqual(lint(code, ownRegExpEscape.SHARED_REGEXP_ESCAPE_FILE), []);
});

test("its code anywhere else Common reaches is a copy: the exemption is what keeps it clean", () => {
  const code = readFromRoot(ownRegExpEscape.SHARED_REGEXP_ESCAPE_FILE);

  assert.deepEqual(messageIdsOf(code, "packages/Common/Utils/Copy.ts"), [
    "ownEscapeHelper",
    "ownEscape",
  ]);
  assert.deepEqual(messageIdsOf(code, "ee/Server/Utils/Copy.ts"), [
    "ownEscapeHelper",
    "ownEscape",
  ]);
});

test("DocsTranslationChecks.ts, which hands the shared escape on to the docs suites, is not reported", () => {
  const code = readFromRoot(ownRegExpEscape.DOCS_SHARED_HELPERS_FILE);

  assert.match(
    code,
    /export \{ escapeRegExp \} from "Common\/Utils\/RegExpEscape";/,
  );
  assert.deepEqual(lint(code, ownRegExpEscape.DOCS_SHARED_HELPERS_FILE), []);
  // In any other docs file, the same re-export would be a second door.
  assert.deepEqual(
    lint(
      'import { escapeRegExp } from "Common/Utils/RegExpEscape";\nexport { escapeRegExp };',
      DOCS_TEST,
    ),
    [{ line: 1, messageId: "importShared" }],
  );
});

test("DocsEscapeRegExp.test.ts, which checks the docs' escape is Common's, is not reported", () => {
  const file = "packages/App/Tests/FeatureSet/Docs/DocsEscapeRegExp.test.ts";

  assert.deepEqual(lint(readFromRoot(file), file), []);
});

// ---------------------------------------------------------------------------
// Copies, however they are written.
// ---------------------------------------------------------------------------

const COPIES = [
  [
    "a pattern literal",
    'export const e = (t: string): string => t.replace(/[\\\\^$.*+?()[\\]{}|]/g, "\\\\$&");',
  ],
  [
    "the class in another order, with more in it",
    'export const e = (t: string): string => t.replace(/[.*+?^${}()|[\\]\\\\/-]/g, "\\\\$&");',
  ],
  [
    "a pattern built from a string",
    'export const e = (t: string): string => t.replace(new RegExp("[.*+?^${}()|[\\\\]\\\\\\\\]", "g"), "\\\\$&");',
  ],
  [
    "a pattern held in a constant",
    [
      "const SPECIAL: RegExp = /[.*+?^${}()|[\\]\\\\]/g;",
      'export const e = (t: string): string => t.replace(SPECIAL, "\\\\$&");',
    ].join("\n"),
  ],
  [
    "replaceAll",
    'export const e = (t: string): string => t.replaceAll(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");',
  ],
  [
    "a function for a replacement",
    'export const e = (t: string): string => t.replace(/[.*+?^${}()|[\\]\\\\]/g, (m: string): string => "\\\\" + m);',
  ],
  [
    "a cast pattern",
    'export const e = (t: string): string => t.replace(/[.*+?^${}()|[\\]\\\\]/g as RegExp, "\\\\$&");',
  ],
];

for (const [kind, code] of COPIES) {
  test(`a copy written with ${kind} is reported where Common reaches, and not where it does not`, () => {
    assert.deepEqual(messageIdsOf(code, COMMON_TEST), ["ownEscape"]);
    assert.deepEqual(messageIdsOf(code, "packages/Probe/Utils/Planted.ts"), [
      "ownEscape",
    ]);
    // The agents build on their own: no Common to import it from.
    assert.deepEqual(messageIdsOf(code, AGENT_FILE), []);
    assert.deepEqual(
      messageIdsOf(code, "packages/MobileApp/src/Planted.ts"),
      [],
    );
  });
}

const HELPERS = [
  [
    "a function",
    "export function escapeRegExp(text: string): string { return text; }",
  ],
  [
    "an arrow function",
    "export const escapeRegex = (text: string): string => { return text; };",
  ],
  [
    "a function expression",
    "export const escapeForRegExp = function (text: string): string { return text; };",
  ],
  [
    "a method",
    "export class A { public escapeTextForRegex(text: string): string { return text; } }",
  ],
  [
    "a field",
    "export class A { private escapeRegExp = (text: string): string => { return text; }; }",
  ],
];

for (const [kind, code] of HELPERS) {
  test(`${kind} named for an escape of its own is reported where Common reaches`, () => {
    assert.deepEqual(messageIdsOf(code, COMMON_TEST), ["ownEscapeHelper"]);
    assert.deepEqual(messageIdsOf(code, AGENT_FILE), []);
  });
}

test("a name that only looks like one is not: escapeHtml, regexpEscaped, a call of escapeRegExp", () => {
  assert.deepEqual(
    lint(
      [
        'import { escapeRegExp } from "Common/Utils/RegExpEscape";',
        "export const escapeHtml = (text: string): string => { return text; };",
        "export const regexpEscaped: string = escapeRegExp('a.b');",
        "export const escapeRegExpResult: string = escapeRegExp('a.b');",
      ].join("\n"),
      COMMON_TEST,
    ),
    [],
  );
});

// ---------------------------------------------------------------------------
// Escapes that leave the backslash as it is: reported everywhere.
// ---------------------------------------------------------------------------

const INCOMPLETE = [
  [
    "a class without the backslash",
    'export const e = (t: string): string => t.replace(/[.*+?()]/g, "\\\\$&");',
  ],
  [
    "a numbered group",
    'export const e = (t: string): string => t.replace(/([<>])/g, "\\\\$1");',
  ],
  [
    "a named group",
    'export const e = (t: string): string => t.replace(/(?<c>[<>])/g, "\\\\$<c>");',
  ],
  [
    "the escape written out",
    'export const e = (t: string): string => t.replace(/\\|/g, "\\\\|");',
  ],
  [
    "replaceAll of a string",
    'export const e = (t: string): string => t.replaceAll(".", "\\\\.");',
  ],
  [
    "an alternation",
    'export const e = (t: string): string => t.replace(/<|>/g, "\\\\$&");',
  ],
  [
    "a template literal for a replacement",
    "export const e = (t: string): string => t.replace(/[<>]/g, `\\\\$&`);",
  ],
  [
    "text through String()",
    'export const e = (t: unknown): string => String(t).replace(/[%]/g, "\\\\$&");',
  ],
  [
    "text through a variable and a string method",
    'export const e = (t: string): string => { const lower: string = t.toLowerCase(); return lower.replace(/[%]/g, "\\\\$&"); };',
  ],
  [
    "text that is one or the other",
    'export const e = (a: string, b: string, c: boolean): string => (c ? a : b).replace(/[%]/g, "\\\\$&");',
  ],
  [
    "text after a replace that escapes nothing",
    'export const e = (t: string): string => t.replace(/a/g, "b").replace(/[%]/g, "\\\\$&");',
  ],
];

for (const [kind, code] of INCOMPLETE) {
  test(`an escape that misses the backslash, with ${kind}, is reported, in the agents too`, () => {
    assert.deepEqual(messageIdsOf(code, COMMON_TEST), ["incompleteEscape"]);
    assert.deepEqual(messageIdsOf(code, AGENT_FILE), ["incompleteEscape"]);
    assert.deepEqual(messageIdsOf(code, "Scripts/Planted.ts"), [
      "incompleteEscape",
    ]);
  });
}

// What the repository's other sinks write, as they are on main.
const OTHER_SINKS = [
  [
    "a SQL LIKE pattern",
    'export const e = (search: string): string => `%${search.replace(/[\\\\%_]/g, "\\\\$&")}%`;',
  ],
  [
    "a shell word",
    'export const e = (value: string): string => `"${value.replace(/[\\\\"]/g, "\\\\$&")}"`;',
  ],
  [
    "a ClickHouse string",
    "export const e = (raw: string): string => `'${raw.replace(/'|\\\\/g, \"\\\\$&\")}'`;",
  ],
  [
    "an identifier",
    'export const e = (name: string): string => `\\`${name.replace(/[`\\\\]/g, "\\\\$&")}\\``;',
  ],
  [
    "a glob",
    'const GLOB: RegExp = /[\\\\*?[]/g;\nexport const e = (t: string): string => t.replace(GLOB, "\\\\$&");',
  ],
  [
    "Markdown, every ASCII punctuation by ranges",
    'const P: RegExp = /[!-/:-@[-`{-~]/g;\nexport const e = (t: string): string => t.replace(P, "\\\\$&");',
  ],
  [
    "a negated class",
    'export const e = (t: string): string => t.replace(/[^a-z]/g, "\\\\$&");',
  ],
  [
    "a class escape",
    'export const e = (t: string): string => t.replace(/\\W/g, "\\\\$&");',
  ],
  [
    "the backslashes escaped by the replace before",
    'export const e = (t: string): string => t.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, "\\\\$&");',
  ],
  [
    "the backslashes escaped before, through a variable",
    'export const e = (t: string): string => { const safe: string = t.replace(/\\\\/g, "\\\\\\\\"); return safe.trim().replace(/"/g, "\\\\$&"); };',
  ],
  [
    "JSON.stringify before",
    'export const e = (t: string): string => JSON.stringify(t).replace(/</g, "\\\\$&");',
  ],
  [
    "a field it does not follow",
    'export const e = (props: { text: string }): string => props.text.replace(/[%]/g, "\\\\$&");',
  ],
  [
    "the first match only",
    'export const e = (t: string): string => t.replace(/[%]/, "\\\\$&");',
  ],
  [
    "no backslash written",
    'export const e = (t: string): string => t.replace(/[%]/g, "$&$&");',
  ],
  [
    "a backslash taken out",
    'export const e = (t: string): string => t.replace(/\\\\/g, "");',
  ],
  [
    "a replacement it cannot read",
    "export const e = (t: string, r: string): string => t.replace(/[%]/g, r);",
  ],
  [
    "a pattern it cannot read",
    'export const e = (t: string, p: RegExp): string => t.replace(p, "\\\\$&");',
  ],
  [
    "a pattern that does not parse",
    'export const e = (t: string): string => t.replace(new RegExp("[", "g"), "\\\\$&");',
  ],
];

for (const [kind, code] of OTHER_SINKS) {
  test(`${kind} is not reported`, () => {
    assert.deepEqual(messageIdsOf(code, COMMON_TEST), []);
    assert.deepEqual(messageIdsOf(code, AGENT_FILE), []);
  });
}

// ---------------------------------------------------------------------------
// The docs suites.
// ---------------------------------------------------------------------------

test("a docs suite that escapes text itself is reported, even when the escape is complete for its sink", () => {
  assert.deepEqual(
    lint(
      'export const e = (mention: string): string => mention.replace(/[<>]/g, "\\\\$&");',
      DOCS_TEST,
    ),
    [{ line: 1, messageId: "escapesItself" }],
  );
  assert.deepEqual(
    messagesOf(
      'export const e = (value: string): string => value.replace(/[\\\\"]/g, "\\\\$&");',
      DOCS_TEST,
    ),
    [
      "This escapes text itself: escape text for a pattern with escapeRegExp from ./DocsTranslationChecks, or write the escaped text out.",
    ],
  );
  // The same is fine outside the docs suites.
  assert.deepEqual(
    lint(
      'export const e = (value: string): string => value.replace(/[\\\\"]/g, "\\\\$&");',
      COMMON_TEST,
    ),
    [],
  );
});

test("a docs suite imports escapeRegExp from ./DocsTranslationChecks, not from Common, and may compare the two under another name", () => {
  assert.deepEqual(
    lint(
      'import { escapeRegExp } from "Common/Utils/RegExpEscape";\nexport const p: RegExp = new RegExp(escapeRegExp("a"));',
      DOCS_TEST,
    ),
    [{ line: 1, messageId: "importShared" }],
  );
  assert.deepEqual(
    messagesOf(
      'import escapeRegExp from "Common/Utils/RegExpEscape";\nexport const p: RegExp = new RegExp(escapeRegExp("a"));',
      DOCS_TEST,
    ),
    [
      "Import escapeRegExp from ./DocsTranslationChecks, which hands on Common's: the docs suites escape with the one helper.",
    ],
  );
  assert.deepEqual(
    lint(
      'import { escapeRegExp } from "./DocsRoleNames";\nexport const p: RegExp = new RegExp(escapeRegExp("a"));',
      DOCS_TEST,
    ),
    [{ line: 1, messageId: "importShared" }],
  );
  assert.deepEqual(
    lint(
      [
        'import { escapeRegExp } from "./DocsTranslationChecks";',
        'import { escapeRegExp as repositoryEscapeRegExp } from "Common/Utils/RegExpEscape";',
        "export const same: boolean = escapeRegExp === repositoryEscapeRegExp;",
      ].join("\n"),
      DOCS_TEST,
    ),
    [],
  );
  // Outside the docs suites, Common's is the one to import.
  assert.deepEqual(
    lint(
      'import { escapeRegExp } from "Common/Utils/RegExpEscape";\nexport const p: RegExp = new RegExp(escapeRegExp("a"));',
      COMMON_TEST,
    ),
    [],
  );
});

// ---------------------------------------------------------------------------
// The real eslint.config.js, and the guards' lists.
// ---------------------------------------------------------------------------

test("eslint.config.js gives each file the options its guard reads it with", async () => {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const optionsFor = async (file) => {
    const config = await eslint.calculateConfigForFile(file);

    return config.rules[RULE];
  };

  assert.deepEqual(
    await optionsFor(ownRegExpEscape.SHARED_REGEXP_ESCAPE_FILE),
    [2, {}],
  );

  for (const prefix of ownRegExpEscape.PACKAGES_WITH_COMMON) {
    for (const extension of ["ts", "tsx", "mts", "cts"]) {
      assert.deepEqual(
        await optionsFor(`${prefix}Some/Planted.${extension}`),
        [2, { copies: true }],
        `${prefix}Some/Planted.${extension}`,
      );
    }
  }

  for (const file of [
    "agents/KubernetesLogTailer/NamespaceFilter.ts",
    "packages/MobileApp/src/Planted.tsx",
    "Scripts/Docs/Planted.ts",
    "Tests/Ops/Planted.ts",
  ]) {
    assert.deepEqual(await optionsFor(file), [2, {}], file);
  }

  assert.deepEqual(await optionsFor(DOCS_TEST), [
    2,
    {
      copies: true,
      everyEscape: true,
      sharedModule: ownRegExpEscape.DOCS_SHARED_HELPERS_MODULE,
    },
  ]);
  assert.deepEqual(await optionsFor(ownRegExpEscape.DOCS_SHARED_HELPERS_FILE), [
    2,
    { copies: true },
  ]);
});

const CODE_SCANNING = readFromRoot(
  "packages/Common/Tests/Helpers/CodeScanning.ts",
);
const DOCS_GUARD = readFromRoot(
  "packages/App/Tests/FeatureSet/Docs/DocsCodeScanningGuard.test.ts",
);

const constantOf = (source, name) => {
  const match = new RegExp(
    `(?:export )?const ${name}: [^=]+ =\\s*([\\s\\S]*?);\\n`,
  ).exec(source);

  assert.ok(match, `${name} is declared`);

  return match[1];
};

test("copies are looked for in the packages the guards look in (CodeScanning.ts's PACKAGES_WITH_COMMON)", () => {
  const listed = Array.from(
    constantOf(CODE_SCANNING, "PACKAGES_WITH_COMMON").matchAll(/"([^"]+)"/g),
    (match) => {
      return match[1];
    },
  );

  assert.deepEqual(ownRegExpEscape.PACKAGES_WITH_COMMON, listed);
});

test("the shared escape, its name pattern and its fix are the guards'", () => {
  assert.equal(
    constantOf(CODE_SCANNING, "SHARED_REGEXP_ESCAPE_FILE"),
    `"${ownRegExpEscape.SHARED_REGEXP_ESCAPE_FILE}"`,
  );
  assert.equal(
    constantOf(CODE_SCANNING, "REGEXP_ESCAPE_HELPER_NAME"),
    String(ownRegExpEscape.REGEXP_ESCAPE_HELPER_NAME),
  );
  assert.ok(
    CODE_SCANNING.includes(
      `"own regular expression escape":\n    "escape text for a pattern with ${ownRegExpEscape.SHARED_REGEXP_ESCAPE}",`,
    ),
    "CODE_SCANNING_FIXES words the fix as the rule does",
  );
  assert.equal(
    constantOf(DOCS_GUARD, "SHARED_CHECKS_MODULE"),
    `"${ownRegExpEscape.DOCS_SHARED_HELPERS_MODULE}"`,
  );
  assert.ok(
    fs.existsSync(
      path.join(REPO_ROOT, ownRegExpEscape.DOCS_SHARED_HELPERS_FILE),
    ),
  );
  assert.ok(
    fs.existsSync(
      path.join(REPO_ROOT, ownRegExpEscape.SHARED_REGEXP_ESCAPE_FILE),
    ),
  );
});
