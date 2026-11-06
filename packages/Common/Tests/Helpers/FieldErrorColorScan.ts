import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * What FieldErrorColorGuard reads in the frontends' source: how a field's
 * error line is coloured, and how light an error line's red is.
 *
 * "The product-wide field error text (text-red-400) is about 2.8:1 against
 * its background, below the 4.5:1 text needs." Every field's error is drawn
 * by FieldError (FieldErrorGuard), and FieldError draws it in one red of its
 * own (FIELD_ERROR_COLOR_CLASS_NAME). Two things would bring a light red
 * back, and both are read here:
 *
 *   1. A field that colours its FieldError: the className a field hands it
 *      places the line - its gap, its indent, its size - and never colours
 *      it. Twenty-three fields coloured theirs, in four reds.
 *   2. An error line drawn by hand in a light red: an element whose one
 *      child is a value that names an error or an issue - {error},
 *      {props.nameError}, {translator.translateText(issue)} - in a resting
 *      text-red-300, -400 or -500, all under 4.5:1 on white (red-500 is
 *      3.8:1). Red-600 is the lightest that reads (4.8:1 on white).
 *
 * The same reading for the Common suite, which sees the core frontends, and
 * for ee's twin, the only run with ee/ checked out.
 */

export const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
);

export const CORE_FRONTEND_DIRECTORIES: ReadonlyArray<string> = [
  "packages/Common/UI",
  "packages/App/FeatureSet/Dashboard/src",
  "packages/App/FeatureSet/AdminDashboard/src",
  "packages/App/FeatureSet/Accounts/src",
  "packages/App/FeatureSet/StatusPage/src",
  "packages/App/FeatureSet/PublicDashboard/src",
];

export const ENTERPRISE_FRONTEND_DIRECTORIES: ReadonlyArray<string> = [
  "ee/Dashboard",
  "ee/AdminDashboard",
];

// Where a field's error is drawn, and its red written, once.
export const FIELD_ERROR_FILE: string =
  "packages/Common/UI/Components/Forms/Fields/FieldError.tsx";

// The lightest red that reads at 4.5:1 on white: red-600 (4.8:1).
export const LIGHTEST_READABLE_RED_SHADE: number = 600;

export interface FieldErrorColorSource {
  // Relative to the repository root, with forward slashes.
  file: string;
  text: string;
}

export enum FieldErrorColorFindingKind {
  // A FieldError handed a colour of its own.
  ColouredFieldError = "coloured-field-error",
  // A FieldError's className written in a way the guard cannot read.
  UnreadFieldErrorClass = "unread-field-error-class",
  // An error line drawn by hand in a red lighter than red-600.
  LightErrorLine = "light-error-line",
}

export interface FieldErrorColorFinding {
  kind: FieldErrorColorFindingKind;
  file: string;
  line: number;
  // The colour classes found, or the expression that could not be read.
  classes: Array<string>;
  // An error line's value as written: "error", "props.nameError".
  value: string;
}

/*
 * An error line that keeps a light red on purpose, because it is drawn on a
 * dark ground of its own, where a light red is the one that reads. Each
 * names its file, its value as written and why.
 */
export interface ErrorLineOnADarkGround {
  file: string;
  value: string;
  reason: string;
}

export const ERROR_LINES_ON_A_DARK_GROUND: ReadonlyArray<ErrorLineOnADarkGround> =
  [
    {
      file: "ee/AdminDashboard/Health/DiagnosticLogs.tsx",
      value: 'String(rowObject["error"] || "")',
      reason:
        "A Valkey error counter's name in the diagnostics log panel (LogPanel), whose ground is bg-gray-900 in both themes: red-400 reads at 6.3:1 there, and red-700 would not read at all.",
    },
  ];

// A value that names an error or an issue: {error}, {props.labelError}.
const ERROR_VALUE_PATTERN: RegExp = /error|issue/i;

// A resting red text colour: text-red-500, not hover:text-red-500.
const RED_TEXT_PATTERN: RegExp = /^text-red-(\d{2,3})$/;

/*
 * Tailwind's text utilities that are not colours: the sizes, the alignment
 * and the wrapping.
 */
const TEXT_UTILITIES_THAT_ARE_NOT_COLOURS: ReadonlySet<string> =
  new Set<string>([
    "text-xs",
    "text-sm",
    "text-base",
    "text-lg",
    "text-xl",
    "text-2xl",
    "text-3xl",
    "text-4xl",
    "text-5xl",
    "text-6xl",
    "text-7xl",
    "text-8xl",
    "text-9xl",
    "text-left",
    "text-center",
    "text-right",
    "text-justify",
    "text-start",
    "text-end",
    "text-ellipsis",
    "text-clip",
    "text-wrap",
    "text-nowrap",
    "text-balance",
    "text-pretty",
  ]);

// An arbitrary text value that is a size, not a colour: text-[11px].
const ARBITRARY_TEXT_SIZE_PATTERN: RegExp =
  /^text-\[(?:length:)?\d*\.?\d+(?:px|rem|em|%)?\]$/;

const WHITESPACE_PATTERN: RegExp = /\s+/;

// Tailwind's important mark: !text-red-700.
const IMPORTANT_PREFIX_PATTERN: RegExp = /^!/;

/*
 * The utility a class token applies, after its variants: "hover:text-red-700"
 * is text-red-700 under a hover. A variant's brackets may hold a colon of
 * their own ("[&>p]:text-sm"), so the split skips them.
 */
export const utilityOfClassToken: (token: string) => string = (
  token: string,
): string => {
  let depth: number = 0;
  let lastColon: number = -1;

  for (let index: number = 0; index < token.length; index++) {
    const character: string = token.charAt(index);

    if (character === "[") {
      depth++;
    } else if (character === "]") {
      depth--;
    } else if (character === ":" && depth === 0) {
      lastColon = index;
    }
  }

  return token.slice(lastColon + 1).replace(IMPORTANT_PREFIX_PATTERN, "");
};

// Whether a class token gives text a colour, under any variant.
export const isTextColourClass: (token: string) => boolean = (
  token: string,
): boolean => {
  const utility: string = utilityOfClassToken(token);

  if (!utility.startsWith("text-")) {
    return false;
  }

  if (TEXT_UTILITIES_THAT_ARE_NOT_COLOURS.has(utility)) {
    return false;
  }

  return !ARBITRARY_TEXT_SIZE_PATTERN.test(utility);
};

/*
 * The shade of a resting red text class - 500 for "text-red-500" - or null
 * for any other token, a variant's red included: what is drawn at rest is
 * what a reader reads.
 */
export const restingRedShadeOf: (token: string) => number | null = (
  token: string,
): number | null => {
  if (token.includes(":")) {
    return null;
  }

  const match: RegExpMatchArray | null = token.match(RED_TEXT_PATTERN);

  return match ? Number(match[1]) : null;
};

interface ClassText {
  // Every class token the expression can give.
  tokens: Array<string>;
  // Parts of it that are not written out: a variable, a call.
  unread: Array<string>;
}

/*
 * The class text an attribute's value can give: the words of its strings,
 * the static text of its templates, and both branches of a choice. What is
 * not written out where it is used - a variable, a call - is unread.
 */
const readClassText: (
  node: ts.Node,
  sourceFile: ts.SourceFile,
  into: ClassText,
) => void = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
  into: ClassText,
): void => {
  const addWords: (text: string) => void = (text: string): void => {
    into.tokens.push(
      ...text.split(WHITESPACE_PATTERN).filter((word: string): boolean => {
        return word.length > 0;
      }),
    );
  };

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    addWords(node.text);
    return;
  }

  if (ts.isTemplateExpression(node)) {
    addWords(node.head.text);

    for (const span of node.templateSpans) {
      readClassText(span.expression, sourceFile, into);
      addWords(span.literal.text);
    }

    return;
  }

  if (ts.isParenthesizedExpression(node)) {
    readClassText(node.expression, sourceFile, into);
    return;
  }

  if (ts.isConditionalExpression(node)) {
    readClassText(node.whenTrue, sourceFile, into);
    readClassText(node.whenFalse, sourceFile, into);
    return;
  }

  if (ts.isBinaryExpression(node)) {
    const operator: ts.SyntaxKind = node.operatorToken.kind;

    // a && "x": the left is a condition; a || "x", a ?? "x", "x" + "y".
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
      readClassText(node.right, sourceFile, into);
      return;
    }

    if (
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.QuestionQuestionToken ||
      operator === ts.SyntaxKind.PlusToken
    ) {
      readClassText(node.left, sourceFile, into);
      readClassText(node.right, sourceFile, into);
      return;
    }
  }

  into.unread.push(node.getText(sourceFile));
};

// The tag name of an element as written: "FieldError", "p".
const tagNameOf: (
  element: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
) => string = (
  element: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
): string => {
  return element.tagName.getText(sourceFile);
};

// The class text of an element's className attribute, or null without one.
const classTextOf: (
  element: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
) => ClassText | null = (
  element: ts.JsxOpeningLikeElement,
  sourceFile: ts.SourceFile,
): ClassText | null => {
  for (const attribute of element.attributes.properties) {
    if (
      !ts.isJsxAttribute(attribute) ||
      attribute.name.getText(sourceFile) !== "className" ||
      !attribute.initializer
    ) {
      continue;
    }

    const classText: ClassText = { tokens: [], unread: [] };
    const initializer: ts.JsxAttributeValue = attribute.initializer;

    if (ts.isStringLiteral(initializer)) {
      readClassText(initializer, sourceFile, classText);
    } else if (ts.isJsxExpression(initializer) && initializer.expression) {
      readClassText(initializer.expression, sourceFile, classText);
    } else {
      classText.unread.push(initializer.getText(sourceFile));
    }

    return classText;
  }

  return null;
};

const lineOf: (node: ts.Node, sourceFile: ts.SourceFile) => number = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
): number => {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
};

/*
 * The one value an element shows, when it shows nothing else: {error} in
 * <p className="...">{error}</p>. Null for an element with words of its
 * own, more than one child, or none.
 */
const onlyValueOf: (
  element: ts.JsxElement,
  sourceFile: ts.SourceFile,
) => ts.Expression | null = (
  element: ts.JsxElement,
  sourceFile: ts.SourceFile,
): ts.Expression | null => {
  const children: Array<ts.JsxChild> = element.children.filter(
    (child: ts.JsxChild): boolean => {
      return !(ts.isJsxText(child) && child.getText(sourceFile).trim() === "");
    },
  );

  const only: ts.JsxChild | undefined = children[0];

  if (
    children.length !== 1 ||
    !only ||
    !ts.isJsxExpression(only) ||
    !only.expression
  ) {
    return null;
  }

  return only.expression;
};

const WHITESPACE_RUN_PATTERN: RegExp = /\s+/g;

/** Every finding in the given sources, in file and line order. */
export const findFieldErrorColorFindings: (
  sources: Array<FieldErrorColorSource>,
) => Array<FieldErrorColorFinding> = (
  sources: Array<FieldErrorColorSource>,
): Array<FieldErrorColorFinding> => {
  const findings: Array<FieldErrorColorFinding> = [];

  for (const source of sources) {
    if (!source.file.endsWith(".tsx")) {
      continue;
    }

    const sourceFile: ts.SourceFile = ts.createSourceFile(
      source.file,
      source.text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        tagNameOf(node, sourceFile) === "FieldError" &&
        source.file !== FIELD_ERROR_FILE
      ) {
        const classText: ClassText | null = classTextOf(node, sourceFile);
        const colours: Array<string> = (classText?.tokens || []).filter(
          isTextColourClass,
        );

        if (colours.length > 0) {
          findings.push({
            kind: FieldErrorColorFindingKind.ColouredFieldError,
            file: source.file,
            line: lineOf(node, sourceFile),
            classes: colours,
            value: "",
          });
        }

        if (classText && classText.unread.length > 0) {
          findings.push({
            kind: FieldErrorColorFindingKind.UnreadFieldErrorClass,
            file: source.file,
            line: lineOf(node, sourceFile),
            classes: classText.unread,
            value: "",
          });
        }
      }

      if (ts.isJsxElement(node)) {
        const value: ts.Expression | null = onlyValueOf(node, sourceFile);
        const valueText: string = value
          ? value.getText(sourceFile).replace(WHITESPACE_RUN_PATTERN, " ")
          : "";

        if (value && ERROR_VALUE_PATTERN.test(valueText)) {
          const classText: ClassText | null = classTextOf(
            node.openingElement,
            sourceFile,
          );
          const lightReds: Array<string> = (classText?.tokens || []).filter(
            (token: string): boolean => {
              const shade: number | null = restingRedShadeOf(token);

              return shade !== null && shade < LIGHTEST_READABLE_RED_SHADE;
            },
          );

          if (lightReds.length > 0) {
            findings.push({
              kind: FieldErrorColorFindingKind.LightErrorLine,
              file: source.file,
              line: lineOf(node, sourceFile),
              classes: lightReds,
              value: valueText,
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return findings;
};

// Whether a finding is an error line left on a dark ground, by its entry.
export const isOnADarkGround: (finding: FieldErrorColorFinding) => boolean = (
  finding: FieldErrorColorFinding,
): boolean => {
  return (
    finding.kind === FieldErrorColorFindingKind.LightErrorLine &&
    ERROR_LINES_ON_A_DARK_GROUND.some(
      (entry: ErrorLineOnADarkGround): boolean => {
        return entry.file === finding.file && entry.value === finding.value;
      },
    )
  );
};

/** Every .tsx under a frontend directory, relative to the repository root. */
export const listFrontendFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
  const absolute: string = path.join(REPOSITORY_ROOT, directory);

  if (!fs.existsSync(absolute)) {
    return [];
  }

  const files: Array<string> = [];

  const walk: (current: string) => void = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath: string = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (
          entry.name !== "node_modules" &&
          entry.name !== "build" &&
          entry.name !== "dist" &&
          entry.name !== "Tests"
        ) {
          walk(entryPath);
        }

        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".tsx")) {
        files.push(
          path.relative(REPOSITORY_ROOT, entryPath).split(path.sep).join("/"),
        );
      }
    }
  };

  walk(absolute);

  return files.sort();
};

export const readSources: (
  files: Array<string>,
) => Array<FieldErrorColorSource> = (
  files: Array<string>,
): Array<FieldErrorColorSource> => {
  return files.map((file: string): FieldErrorColorSource => {
    return {
      file,
      text: fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
    };
  });
};

// One line per finding.
export const describeFieldErrorColorFinding: (
  finding: FieldErrorColorFinding,
) => string = (finding: FieldErrorColorFinding): string => {
  if (finding.kind === FieldErrorColorFindingKind.UnreadFieldErrorClass) {
    return `${finding.file}:${finding.line} <FieldError className={${finding.classes.join(" ")}}> - write its place where it can be read`;
  }

  if (finding.kind === FieldErrorColorFindingKind.ColouredFieldError) {
    return `${finding.file}:${finding.line} <FieldError> coloured ${finding.classes.join(" ")}`;
  }

  return `${finding.file}:${finding.line} {${finding.value}} in ${finding.classes.join(" ")}`;
};

export const FIELD_ERROR_COLOR_ADVICE: string =
  "A field's error is drawn by FieldError (Common/UI/Components/Forms/Fields/FieldError) in its own red, FIELD_ERROR_COLOR_CLASS_NAME: a field's className places the line (mt-2, pl-14, text-xs) and never colours it. Any other error line is drawn in text-red-600 or darker: text-red-300, -400 and -500 read under the 4.5:1 text needs on white.";
