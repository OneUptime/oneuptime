// A FILE'S OWN REGULAR EXPRESSION ESCAPE, CAUGHT BY ESLINT.
//
// The repository escapes text for a pattern in one place, escapeRegExp in
// packages/Common/Utils/RegExpEscape.ts (the docs suites import it through
// ./DocsTranslationChecks, which hands it on). A copy is what code scanning
// keeps opening alerts on: a partial one ("\\$&" after a class that leaves
// the backslash out) is js/incomplete-sanitization, and a complete one is
// one more place to get it wrong. The code scanning guards fail on both -
// packages/Common/Tests/Helpers/TestCodeScanningGuard.test.ts,
// ProductCodeScanningGuard.test.ts and, for the docs suites,
// packages/App/Tests/FeatureSet/Docs/DocsCodeScanningGuard.test.ts - but
// they run in CI's long Common and App test jobs, and pull requests merge
// without waiting for them: on 2026-11-15 three copies reached main within
// hours of each other (#8352, #8357).
//
// This rule reports the same copies where every change is checked first,
// in `npx eslint --fix <changed files>`. It is a cheaper, earlier catch, not
// a replacement: the guards also read templates' inline scripts, the .js
// files ESLint leaves out, and code scanning's other patterns. It reads less
// than they do, never more - when it cannot tell where a value comes from it
// says nothing - so a file the guards accept is never reported here.
//
// What it reports:
//
//   - a replace (replace or replaceAll) whose pattern is one character class
//     holding every character a pattern reads as syntax, \ ^ $ . * + ? ( )
//     [ ] { } | (a copy of escapeRegExp, whatever it replaces them with);
//   - a function, method or field named for one (escapeRegExp,
//     escapeForRegex, ...): CodeScanning.ts's REGEXP_ESCAPE_HELPER_NAME;
//   - a global replace that writes a backslash before what it matched
//     ("\\$&", "\\$1", or "\\|" for a "|") but cannot match a backslash
//     itself, on text no earlier replace or JSON.stringify escaped the
//     backslashes of: "This does not escape backslash characters in the
//     input", as code scanning words it;
//   - with `everyEscape` (the docs suites), any replace that writes a
//     backslash before what it matched: they escape with the shared helper
//     or write the escaped text out;
//   - with `sharedModule` (the docs suites), escapeRegExp imported from
//     anywhere but that module.
//
// Copies are reported only where the shared escape can be imported
// (PACKAGES_WITH_COMMON, as in CodeScanning.ts), and not in the shared
// escape itself; an incomplete escape, everywhere. CONFIGS below says which
// files get which, and eslint.config.js spreads it in.
// Scripts/Lint/Tests/OwnRegExpEscape.test.js runs the rule on planted
// snippets and checks this file's lists against CodeScanning.ts's.

const path = require("path");
const { createRequire } = require("module");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// ESLint's own regular expression parser: whatever ESLint runs, it has.
const { RegExpParser } = createRequire(
  require.resolve("eslint/package.json", { paths: [REPO_ROOT] }),
)("@eslint-community/regexpp");

// Every character a pattern reads as syntax outside a character class.
const REGEXP_SYNTAX_CHARACTERS = "\\^$.*+?()[]{}|";
// What a copy of the shared escape is called (CodeScanning.ts).
const REGEXP_ESCAPE_HELPER_NAME = /^escape\w*reg(?:exp|ex)$/i;
// "\\$&", "\\$1", "\\$<name>": a backslash, then what the pattern matched.
const SUBSTITUTION_ESCAPE = /^\\\$(?:&|\d{1,2}|<[^>]+>)$/;
const BACKSLASH = "\\";
// String methods whose result keeps the escapes of the text they are called on.
const STRING_METHODS_KEEPING_ESCAPES = [
  "replace",
  "replaceAll",
  "slice",
  "substr",
  "substring",
  "toLowerCase",
  "toUpperCase",
  "trim",
];

// The one regular expression escape of the repository's code and tests.
const SHARED_REGEXP_ESCAPE_FILE = "packages/Common/Utils/RegExpEscape.ts";
const SHARED_REGEXP_ESCAPE = "escapeRegExp from Common/Utils/RegExpEscape";
// The docs suites' shared helpers, which hand the escape on.
const DOCS_TESTS_DIRECTORY = "packages/App/Tests/FeatureSet/Docs";
const DOCS_SHARED_HELPERS_FILE = `${DOCS_TESTS_DIRECTORY}/DocsTranslationChecks.ts`;
const DOCS_SHARED_HELPERS_MODULE = "./DocsTranslationChecks";

/*
 * The packages that build with Common, so can import its helpers: the
 * agents, the mobile app and the scripts build on their own. The same list
 * as PACKAGES_WITH_COMMON in packages/Common/Tests/Helpers/CodeScanning.ts
 * (the rule's test checks the two agree).
 */
const PACKAGES_WITH_COMMON = [
  "packages/App/",
  "packages/CLI/",
  "packages/Common/",
  "packages/E2E/",
  "packages/Home/",
  "packages/Nginx/",
  "packages/Probe/",
  "packages/Runner/",
  "packages/TestServer/",
  "ee/",
];

const TYPESCRIPT_EXTENSIONS = ["ts", "tsx", "mts", "cts"];

const typeScriptFilesUnder = (folder) => {
  return TYPESCRIPT_EXTENSIONS.map((extension) => {
    return `${folder.replace(/\/$/, "")}/**/*.${extension}`;
  });
};

// ---------------------------------------------------------------------------
// Patterns.
// ---------------------------------------------------------------------------

const parser = new RegExpParser({ ecmaVersion: 2025 });

// A pattern's tree, or null when it does not parse.
const parsePattern = (source, flags) => {
  try {
    return parser.parsePattern(source, 0, source.length, {
      unicode: flags.includes("u"),
      unicodeSets: flags.includes("v"),
    });
  } catch {
    return null;
  }
};

const characterOf = (element) => {
  return String.fromCodePoint(element.value);
};

// The single characters of a pattern that is one character class, or null.
const classCharactersOf = (pattern) => {
  if (pattern.alternatives.length !== 1) {
    return null;
  }

  const elements = pattern.alternatives[0].elements;

  if (
    elements.length !== 1 ||
    elements[0].type !== "CharacterClass" ||
    elements[0].negate
  ) {
    return null;
  }

  return elements[0].elements
    .filter((element) => {
      return element.type === "Character";
    })
    .map(characterOf);
};

// Whether a pattern is one class holding every character of pattern syntax.
const isCopyOfEscape = (pattern) => {
  const characters = classCharactersOf(pattern);

  return (
    characters !== null &&
    Array.from(REGEXP_SYNTAX_CHARACTERS).every((character) => {
      return characters.includes(character);
    })
  );
};

/*
 * The strings a pattern can match, when it is simple - plain characters, a
 * class of plain characters, a group or an alternation of them - or null
 * when it is not, and so may match anything.
 */
const matchedStringsOfAlternatives = (alternatives) => {
  const strings = [];

  for (const alternative of alternatives) {
    const elements = alternative.elements;

    if (
      elements.length > 0 &&
      elements.every((element) => {
        return element.type === "Character";
      })
    ) {
      strings.push(elements.map(characterOf).join(""));
      continue;
    }

    if (elements.length !== 1) {
      return null;
    }

    const element = elements[0];

    if (element.type === "CharacterClass") {
      if (
        element.negate ||
        !element.elements.every((item) => {
          return item.type === "Character";
        })
      ) {
        return null;
      }

      strings.push(...element.elements.map(characterOf));
      continue;
    }

    if (element.type === "Group" || element.type === "CapturingGroup") {
      const inner = matchedStringsOfAlternatives(element.alternatives);

      if (inner === null) {
        return null;
      }

      strings.push(...inner);
      continue;
    }

    return null;
  }

  return strings;
};

// ---------------------------------------------------------------------------
// Values, followed through the file the way the guards follow them.
// ---------------------------------------------------------------------------

const TYPESCRIPT_WRAPPERS = [
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "ChainExpression",
];

const unwrap = (node) => {
  let current = node;

  while (current && TYPESCRIPT_WRAPPERS.includes(current.type)) {
    current = current.expression;
  }

  return current;
};

const findVariable = (scope, name) => {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name);

    if (variable) {
      return variable;
    }
  }

  return null;
};

/*
 * The expressions a variable is given: its initializer and every value
 * assigned to it, or null when one of them cannot be read (a destructuring,
 * a loop's variable, an import).
 */
const valuesOfVariable = (variable) => {
  const values = [];

  for (const definition of variable.defs) {
    if (definition.type === "Parameter") {
      // Text handed in: anything, a backslash too.
      values.push(definition.name);
      continue;
    }

    if (
      definition.type !== "Variable" ||
      definition.node.id.type !== "Identifier"
    ) {
      return null;
    }

    if (definition.node.init) {
      values.push(definition.node.init);
    } else if (
      definition.parent &&
      ["ForInStatement", "ForOfStatement"].includes(
        definition.parent.parent && definition.parent.parent.type,
      )
    ) {
      return null;
    }
  }

  for (const reference of variable.references) {
    if (!reference.isWrite() || reference.init) {
      continue;
    }

    if (!reference.writeExpr) {
      return null;
    }

    const assignment = reference.writeExpr.parent;

    if (
      assignment &&
      assignment.type === "AssignmentExpression" &&
      assignment.operator !== "="
    ) {
      return null;
    }

    values.push(reference.writeExpr);
  }

  return values;
};

const stringOf = (node) => {
  const value = unwrap(node);

  if (!value) {
    return null;
  }

  if (value.type === "Literal" && typeof value.value === "string") {
    return value.value;
  }

  if (
    value.type === "TemplateLiteral" &&
    value.expressions.length === 0 &&
    typeof value.quasis[0].value.cooked === "string"
  ) {
    return value.quasis[0].value.cooked;
  }

  return null;
};

/*
 * The pattern a replace's first argument is - a /literal/, RegExp("...",
 * "...") or a variable that holds one of them and nothing else - as its
 * tree and flags, or null when it is not one that can be read.
 */
const patternOf = (node, scope, seen = new Set()) => {
  const value = unwrap(node);

  if (!value || seen.has(value)) {
    return null;
  }

  seen.add(value);

  if (value.type === "Literal" && value.regex) {
    const tree = parsePattern(value.regex.pattern, value.regex.flags);

    return tree === null ? null : { tree: tree, flags: value.regex.flags };
  }

  if (
    (value.type === "NewExpression" || value.type === "CallExpression") &&
    value.callee.type === "Identifier" &&
    value.callee.name === "RegExp"
  ) {
    const source =
      value.arguments[0] === undefined ? null : stringOf(value.arguments[0]);
    const flags =
      value.arguments[1] === undefined ? "" : stringOf(value.arguments[1]);

    if (source === null || flags === null) {
      return null;
    }

    const tree = parsePattern(source, flags);

    return tree === null ? null : { tree: tree, flags: flags };
  }

  if (value.type === "Identifier") {
    const variable = findVariable(scope, value.name);
    const values = variable ? valuesOfVariable(variable) : null;

    if (values === null || values.length !== 1) {
      return null;
    }

    return patternOf(values[0], scope, seen);
  }

  return null;
};

// A replace call, read: its method, receiver, pattern and replacement.
const replaceOf = (node, scope) => {
  if (
    node.type !== "CallExpression" ||
    node.arguments.length !== 2 ||
    node.callee.type !== "MemberExpression" ||
    node.callee.computed ||
    node.callee.property.type !== "Identifier" ||
    !["replace", "replaceAll"].includes(node.callee.property.name)
  ) {
    return null;
  }

  const method = node.callee.property.name;
  const pattern = patternOf(node.arguments[0], scope);
  const text = pattern === null ? stringOf(node.arguments[0]) : null;

  return {
    node: node,
    method: method,
    receiver: node.callee.object,
    pattern: pattern,
    // What it matches: the pattern's strings, the text, or null for anything.
    matched:
      pattern !== null
        ? matchedStringsOfAlternatives(pattern.tree.alternatives)
        : text !== null
          ? [text]
          : null,
    global:
      method === "replaceAll" ||
      (pattern !== null && pattern.flags.includes("g")),
    replacement: stringOf(node.arguments[1]),
  };
};

// Whether a replace writes a backslash before what it matched.
const writesBackslashBefore = (replace) => {
  if (replace.replacement === null) {
    return false;
  }

  if (SUBSTITUTION_ESCAPE.test(replace.replacement)) {
    return true;
  }

  return (replace.matched || []).some((old) => {
    return (
      old !== "" &&
      replace.replacement.split("$&").join(old) === `${BACKSLASH}${old}`
    );
  });
};

// Whether a backslash-writing replace escapes every backslash it is given.
const escapesBackslashes = (replace) => {
  return replace.matched === null || replace.matched.includes(BACKSLASH);
};

/*
 * Whether the backslashes of a value were escaped before it reached a
 * replace: true or false, or null when where it comes from cannot be read,
 * so nothing is said about it.
 */
const backslashesEscapedIn = (node, scope, seen = new Set()) => {
  const value = unwrap(node);

  if (!value || seen.has(value)) {
    return null;
  }

  seen.add(value);

  if (value.type === "Identifier") {
    const variable = findVariable(scope, value.name);

    if (!variable) {
      return null;
    }

    // A parameter's value is whatever it is handed.
    if (
      variable.defs.length === 1 &&
      variable.defs[0].type === "Parameter" &&
      variable.references.every((reference) => {
        return !reference.isWrite();
      })
    ) {
      return false;
    }

    const values = valuesOfVariable(variable);

    if (values === null || values.length === 0) {
      return null;
    }

    return anyEscaped(values, scope, seen);
  }

  if (value.type === "ConditionalExpression") {
    return anyEscaped([value.consequent, value.alternate], scope, seen);
  }

  if (
    value.type === "LogicalExpression" &&
    (value.operator === "||" || value.operator === "??")
  ) {
    return anyEscaped([value.left, value.right], scope, seen);
  }

  if (value.type === "CallExpression") {
    const callee = unwrap(value.callee);

    if (
      callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.object.type === "Identifier" &&
      callee.object.name === "JSON" &&
      callee.property.type === "Identifier" &&
      callee.property.name === "stringify"
    ) {
      return true;
    }

    const replace = replaceOf(value, scope);

    if (
      replace !== null &&
      writesBackslashBefore(replace) &&
      escapesBackslashes(replace)
    ) {
      return true;
    }

    if (
      callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.property.type === "Identifier" &&
      STRING_METHODS_KEEPING_ESCAPES.includes(callee.property.name)
    ) {
      return backslashesEscapedIn(callee.object, scope, seen);
    }

    // Any other call's result: nothing on the way escaped it.
    return false;
  }

  if (
    value.type === "Literal" ||
    value.type === "TemplateLiteral" ||
    value.type === "BinaryExpression"
  ) {
    return false;
  }

  // A field, an element, a call's member: not read here.
  return null;
};

// Escaped when one value is; unknown when one cannot be read and none is.
const anyEscaped = (values, scope, seen) => {
  let unknown = false;

  for (const value of values) {
    const escaped = backslashesEscapedIn(value, scope, seen);

    if (escaped === true) {
      return true;
    }

    if (escaped === null) {
      unknown = true;
    }
  }

  return unknown ? null : false;
};

// ---------------------------------------------------------------------------
// The rule.
// ---------------------------------------------------------------------------

const noOwnRegExpEscape = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Escape text for a pattern with the shared escapeRegExp, not a copy of it",
    },
    schema: [
      {
        type: "object",
        properties: {
          copies: { type: "boolean" },
          everyEscape: { type: "boolean" },
          sharedModule: { type: "string" },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      ownEscape:
        "This escapes text for a pattern with a copy of escapeRegExp: escape text for a pattern with {{shared}}.",
      ownEscapeHelper:
        "{{name}} is a copy of escapeRegExp: escape text for a pattern with {{shared}}.",
      escapesItself:
        "This escapes text itself: escape text for a pattern with {{shared}}, or write the escaped text out.",
      incompleteEscape:
        "This does not escape backslash characters in the input: escape text for a pattern with {{shared}}; for another sink, match the backslash too, in the same replace.",
      importShared:
        "Import escapeRegExp from {{module}}, which hands on Common's: the docs suites escape with the one helper.",
    },
  },
  create(context) {
    const options = context.options[0] || {};
    const sourceCode = context.sourceCode;
    const shared =
      options.sharedModule === undefined
        ? SHARED_REGEXP_ESCAPE
        : `escapeRegExp from ${options.sharedModule}`;

    const reportHelper = (node, name) => {
      if (
        options.copies &&
        name &&
        name.type === "Identifier" &&
        REGEXP_ESCAPE_HELPER_NAME.test(name.name)
      ) {
        context.report({
          node: node,
          messageId: "ownEscapeHelper",
          data: { name: name.name, shared: shared },
        });
      }
    };

    return {
      CallExpression(node) {
        const scope = sourceCode.getScope(node);
        const replace = replaceOf(node, scope);

        if (replace === null) {
          return;
        }

        if (
          options.copies &&
          replace.pattern !== null &&
          isCopyOfEscape(replace.pattern.tree)
        ) {
          context.report({
            node: node,
            messageId: "ownEscape",
            data: { shared: shared },
          });
          return;
        }

        if (!writesBackslashBefore(replace)) {
          return;
        }

        if (options.everyEscape) {
          context.report({
            node: node,
            messageId: "escapesItself",
            data: { shared: shared },
          });
          return;
        }

        if (
          replace.global &&
          !escapesBackslashes(replace) &&
          backslashesEscapedIn(replace.receiver, scope) === false
        ) {
          context.report({
            node: node,
            messageId: "incompleteEscape",
            data: { shared: shared },
          });
        }
      },
      FunctionDeclaration(node) {
        reportHelper(node, node.id);
      },
      MethodDefinition(node) {
        reportHelper(node, node.key);
      },
      PropertyDefinition(node) {
        reportHelper(node, node.key);
      },
      VariableDeclarator(node) {
        const init = unwrap(node.init);

        if (
          init &&
          (init.type === "ArrowFunctionExpression" ||
            init.type === "FunctionExpression")
        ) {
          reportHelper(node, node.id);
        }
      },
      ImportDeclaration(node) {
        if (
          options.sharedModule === undefined ||
          node.source.value === options.sharedModule
        ) {
          return;
        }

        for (const specifier of node.specifiers) {
          if (
            specifier.type !== "ImportNamespaceSpecifier" &&
            specifier.local.name === "escapeRegExp"
          ) {
            context.report({
              node: specifier,
              messageId: "importShared",
              data: { module: options.sharedModule },
            });
          }
        }
      },
    };
  },
};

const RULE_NAME = "no-own-regexp-escape";
const PLUGIN_NAME = "oneuptime";
const QUALIFIED_RULE_NAME = `${PLUGIN_NAME}/${RULE_NAME}`;

const plugin = {
  meta: { name: "oneuptime-own-regexp-escape" },
  rules: { [RULE_NAME]: noOwnRegExpEscape },
};

/*
 * Which files get which. A later object replaces a rule's options for the
 * files it matches, so each narrows the one before it:
 *   - every TypeScript file: an incomplete escape (code scanning reads all
 *     of them);
 *   - where Common can be imported, but the shared escape itself: a copy
 *     too;
 *   - the docs suites, but their shared helpers: any escape of their own,
 *     and escapeRegExp from ./DocsTranslationChecks only.
 */
const CONFIGS = [
  {
    files: typeScriptFilesUnder("**"),
    plugins: { [PLUGIN_NAME]: plugin },
    rules: { [QUALIFIED_RULE_NAME]: ["error", {}] },
  },
  {
    files: PACKAGES_WITH_COMMON.flatMap(typeScriptFilesUnder),
    ignores: [SHARED_REGEXP_ESCAPE_FILE],
    plugins: { [PLUGIN_NAME]: plugin },
    rules: { [QUALIFIED_RULE_NAME]: ["error", { copies: true }] },
  },
  {
    files: typeScriptFilesUnder(DOCS_TESTS_DIRECTORY),
    ignores: [DOCS_SHARED_HELPERS_FILE],
    plugins: { [PLUGIN_NAME]: plugin },
    rules: {
      [QUALIFIED_RULE_NAME]: [
        "error",
        {
          copies: true,
          everyEscape: true,
          sharedModule: DOCS_SHARED_HELPERS_MODULE,
        },
      ],
    },
  },
];

module.exports = {
  CONFIGS,
  DOCS_SHARED_HELPERS_FILE,
  DOCS_SHARED_HELPERS_MODULE,
  PACKAGES_WITH_COMMON,
  QUALIFIED_RULE_NAME,
  REGEXP_ESCAPE_HELPER_NAME,
  SHARED_REGEXP_ESCAPE,
  SHARED_REGEXP_ESCAPE_FILE,
  plugin,
};
