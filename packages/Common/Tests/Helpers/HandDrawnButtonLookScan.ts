import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The detector behind the hand-drawn button guard
 * (Tests/UI/HandDrawnButtonLockedLookGuard.test.ts, and its ee/ twin in
 * ee/Tests/Server).
 *
 * A button that cannot be pressed looks it the same way everywhere: faded,
 * with the not-allowed cursor and no hover - Button draws it
 * (BUTTON_DISABLED_CLASS_NAME), and a button drawn by hand - a tile, a chip,
 * a segmented control, a toolbar's or a player's control - takes the same
 * look from Button/ButtonStates (getHandDrawnButtonStateClassName). A busy
 * one keeps its look. Before, some forty hand-drawn buttons said "locked" in
 * looks of their own: faded to 40%, 60% or 70%, their words grey or a pale
 * indigo, a wait or an arrow cursor, a hover wash that still came when they
 * could not be pressed - and a busy Refresh faded as if it had been turned
 * off.
 *
 * Read per module, through the TypeScript AST, over every frontend's source
 * (the shared components, the five frontends and, when the checkout has
 * them, ee/'s two):
 *
 *   A class string that carries a `disabled:` utility (disabled:opacity-60,
 *   disabled:hover:bg-transparent, md:disabled:...), or the not-allowed
 *   cursor written by hand (cursor-not-allowed), is followed to the element
 *   it styles: the class attribute it sits in (className, or any attribute
 *   whose name ends in ClassName), or through the constant, the variable or
 *   the function that holds it to the class attributes that use them - in
 *   its own module, or in a module that imports it.
 *
 *   It is left alone only where it styles a field you type in or pick from
 *   (input, select, textarea): a locked field is greyed, not faded, and its
 *   look is its own. Everywhere else - a <button>, a Button's className, a
 *   label drawn as a choice, an element the scan cannot follow it to - it is
 *   a finding. ButtonStates itself is where the look is written.
 */

// packages/Common/Tests/Helpers -> the repository root.
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

// Where the locked look is written, once.
export const BUTTON_STATES_FILE: string =
  "packages/Common/UI/Components/Button/ButtonStates.ts";

/*
 * A field you type in or pick from draws its own locked look - greyed, as
 * the browser greys it - and so does a group of them (a fieldset the whole
 * form is paused in).
 */
export const FIELD_ELEMENTS: ReadonlyArray<string> = [
  "input",
  "select",
  "textarea",
  "fieldset",
];

/*
 * The faces of fields drawn by hand: what they write is a field's locked
 * look, not a button's. Each names its file, the class string as written
 * and why - a new string in these files is read like any other.
 */
export interface FieldFace {
  file: string;
  // The class string's own text, as written (collapsed whitespace).
  classText: string;
  reason: string;
}

export const FIELD_FACES: ReadonlyArray<FieldFace> = [
  {
    file: "packages/Common/UI/Components/EntityDropdown/EntityDropdown.tsx",
    classText: "cursor-not-allowed text-gray-400",
    reason:
      "the face of a dropdown, which shows its picked value: a locked field is greyed, as an input is",
  },
  {
    file: "packages/Common/UI/Components/TimePicker/TimePicker.tsx",
    classText: "cursor-not-allowed",
    reason: "a time field's box, greyed with it (bg-gray-100) when locked",
  },
  {
    file: "packages/Common/UI/Components/Workflow/ValuePicker/TemplateTextEditor.tsx",
    classText: "cursor-not-allowed text-gray-500",
    reason: "a field you type in, drawn as an editable box",
  },
  {
    file: "packages/Common/UI/Components/FilePicker/FilePicker.tsx",
    classText: "cursor-not-allowed bg-gray-50 border-gray-200",
    reason: "a read-only file field's drop zone, greyed as a read-only field",
  },
  {
    file: "packages/Common/UI/Components/Workflow/ValuePicker/ValuePickerMenu.tsx",
    classText:
      "mt-0.5 flex min-w-0 cursor-not-allowed items-center gap-2 rounded-md py-1 pl-5 pr-1",
    reason:
      "a value a field's picker cannot offer here, greyed as a select greys an option it cannot offer",
  },
];

const collapse: (text: string) => string = (text: string): string => {
  return text.split(/\s+/u).filter(Boolean).join(" ");
};

export const isFieldFace: (file: string, text: string) => boolean = (
  file: string,
  text: string,
): boolean => {
  const classText: string = collapse(text);

  return FIELD_FACES.some((face: FieldFace): boolean => {
    return face.file === file && face.classText === classText;
  });
};

export enum LockedLookKind {
  // A `disabled:` utility: the look of its own, or a hover it takes back.
  DisabledVariant = "disabled-variant",
  // The not-allowed cursor written by hand, beside a look of its own.
  OwnCursor = "own-cursor",
}

// What the scan reports for an element it cannot follow a class string to.
export const UNKNOWN_ELEMENT: string = "?";

export interface LockedLookFinding {
  // Repository-relative, with "/" separators.
  file: string;
  line: number;
  kind: LockedLookKind;
  // The classes that draw the look, as written.
  classes: Array<string>;
  // What they style - button, Button, label - or UNKNOWN_ELEMENT.
  element: string;
}

export interface LockedLookSource {
  // Repository-relative, with "/" separators.
  file: string;
  text: string;
}

// A `disabled:` utility, whatever comes before it (md:disabled:opacity-50).
export const isDisabledVariantClass: (token: string) => boolean = (
  token: string,
): boolean => {
  const parts: Array<string> = token.split(":");

  // The last part is the utility itself; the rest are its variants.
  return parts.slice(0, -1).includes("disabled");
};

// The not-allowed cursor with no variant before it.
export const isOwnCursorClass: (token: string) => boolean = (
  token: string,
): boolean => {
  return token === "cursor-not-allowed";
};

const classTokensOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  return text.split(/\s+/u).filter((token: string): boolean => {
    return token.length > 0;
  });
};

const isClassAttributeName: (name: string) => boolean = (
  name: string,
): boolean => {
  return name === "className" || name.endsWith("ClassName");
};

const scriptKindOf: (file: string) => ts.ScriptKind = (
  file: string,
): ts.ScriptKind => {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
};

interface ParsedSource {
  file: string;
  sourceFile: ts.SourceFile;
  // Every identifier in the module, by its text.
  identifiers: Map<string, Array<ts.Identifier>>;
}

const parseSource: (source: LockedLookSource) => ParsedSource = (
  source: LockedLookSource,
): ParsedSource => {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    source.file,
    source.text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindOf(source.file),
  );
  const identifiers: Map<string, Array<ts.Identifier>> = new Map();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const list: Array<ts.Identifier> = identifiers.get(node.text) || [];
      list.push(node);
      identifiers.set(node.text, list);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return { file: source.file, sourceFile, identifiers };
};

// "packages/Common/UI/Components/Button/Button" without its extension.
const withoutExtension: (file: string) => string = (file: string): string => {
  return file.replace(/\.(?:tsx?|jsx?)$/u, "");
};

/*
 * The module an import names, repository-relative and without its
 * extension: a relative path, or Common/... (packages/Common/...).
 */
export const resolveImportedModule: (
  fromFile: string,
  specifier: string,
) => string | null = (fromFile: string, specifier: string): string | null => {
  if (specifier.startsWith(".")) {
    return path.posix.normalize(
      path.posix.join(path.posix.dirname(fromFile), specifier),
    );
  }

  if (specifier.startsWith("Common/")) {
    return `packages/${specifier}`;
  }

  return null;
};

const isDeclarationName: (identifier: ts.Identifier) => boolean = (
  identifier: ts.Identifier,
): boolean => {
  const parent: ts.Node = identifier.parent;

  return (
    ((ts.isVariableDeclaration(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent)) &&
      parent.name === identifier) ||
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isExportSpecifier(parent) ||
    // obj.name, { name: value }: a property's name, not the variable.
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier) ||
    (ts.isPropertySignature(parent) && parent.name === identifier) ||
    ts.isJsxAttribute(parent) ||
    ts.isTypeReferenceNode(parent) ||
    // className = ...; className += ...: a write, not a read.
    (ts.isBinaryExpression(parent) &&
      parent.left === identifier &&
      (parent.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
        parent.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken))
  );
};

const isExported: (node: ts.Node) => boolean = (node: ts.Node): boolean => {
  let current: ts.Node | undefined = node;

  while (current && !ts.isSourceFile(current)) {
    if (
      (ts.isVariableStatement(current) || ts.isFunctionDeclaration(current)) &&
      (ts.getCombinedModifierFlags(current as ts.Declaration) &
        ts.ModifierFlags.Export) !==
        0
    ) {
      return true;
    }

    current = current.parent;
  }

  return false;
};

const tagNameOf: (attribute: ts.JsxAttribute) => string = (
  attribute: ts.JsxAttribute,
): string => {
  const element: ts.Node = attribute.parent.parent;

  if (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) {
    return element.tagName.getText();
  }

  return UNKNOWN_ELEMENT;
};

// How deep the scan follows a value through constants and functions.
const MAX_DEPTH: number = 6;

/*
 * A call whose string arguments are words or a lookup, not classes: a
 * translation, a test of a class list (classes.includes("...")), a query.
 */
const TEXT_CALL: RegExp =
  /(?:^|\.)(?:translate\w*|includes|indexOf|startsWith|endsWith|split|test|querySelector\w*|closest|matches)$/u;

export class LockedLookScan {
  private readonly parsed: Map<string, ParsedSource> = new Map();
  private readonly byModule: Map<string, ParsedSource> = new Map();

  public constructor(sources: Array<LockedLookSource>) {
    for (const source of sources) {
      const parsedSource: ParsedSource = parseSource(source);
      this.parsed.set(source.file, parsedSource);
      this.byModule.set(withoutExtension(source.file), parsedSource);
    }
  }

  public findAll(): Array<LockedLookFinding> {
    const findings: Array<LockedLookFinding> = [];

    for (const parsedSource of this.parsed.values()) {
      findings.push(...this.findIn(parsedSource));
    }

    return findings;
  }

  private findIn(parsedSource: ParsedSource): Array<LockedLookFinding> {
    if (parsedSource.file === BUTTON_STATES_FILE) {
      return [];
    }

    const findings: Array<LockedLookFinding> = [];
    const sourceFile: ts.SourceFile = parsedSource.sourceFile;

    const check: (node: ts.Node, text: string) => void = (
      node: ts.Node,
      text: string,
    ): void => {
      const tokens: Array<string> = classTokensOf(text);
      const variants: Array<string> = tokens.filter(isDisabledVariantClass);
      const cursors: Array<string> = tokens.filter(isOwnCursorClass);

      if (variants.length === 0 && cursors.length === 0) {
        return;
      }

      if (isFieldFace(parsedSource.file, text)) {
        return;
      }

      const elements: Array<string> = this.elementsOf(
        parsedSource,
        node,
        0,
        new Set(),
      );

      // A string that never reaches a class attribute is not a class.
      if (elements.length === 0) {
        return;
      }

      const styled: Array<string> = elements.filter(
        (element: string): boolean => {
          return !FIELD_ELEMENTS.includes(element);
        },
      );

      if (styled.length === 0) {
        return;
      }

      const line: number =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1;
      const element: string = Array.from(new Set(styled)).sort().join("|");

      if (variants.length > 0) {
        findings.push({
          file: parsedSource.file,
          line,
          kind: LockedLookKind.DisabledVariant,
          classes: variants,
          element,
        });
      }

      if (cursors.length > 0) {
        findings.push({
          file: parsedSource.file,
          line,
          kind: LockedLookKind.OwnCursor,
          classes: cursors,
          element,
        });
      }
    };

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        check(node, node.text);
        return;
      }

      // An import's path, a type's name: never class text.
      if (ts.isImportDeclaration(node) || ts.isTypeNode(node)) {
        return;
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    return findings;
  }

  /*
   * The elements a value at `node` styles: the tag of each class attribute it
   * ends up in. Empty when it ends up in none (an attribute that is not a
   * class, a message) - and UNKNOWN_ELEMENT when it leaves the module in a
   * way the scan cannot follow.
   */
  private elementsOf(
    parsedSource: ParsedSource,
    node: ts.Node,
    depth: number,
    seen: Set<string>,
  ): Array<string> {
    let current: ts.Node = node;

    while (current.parent) {
      const parent: ts.Node = current.parent;

      if (ts.isJsxAttribute(parent)) {
        return isClassAttributeName(parent.name.getText())
          ? [tagNameOf(parent)]
          : [];
      }

      // A value spread into a component's props ({...{ className }}) or handed to children.
      if (ts.isJsxSpreadAttribute(parent) || ts.isJsxElement(parent)) {
        return [UNKNOWN_ELEMENT];
      }

      if (
        ts.isVariableDeclaration(parent) &&
        parent.initializer === current &&
        ts.isIdentifier(parent.name)
      ) {
        return this.usesOf(parsedSource, parent.name, depth, seen);
      }

      if (
        ts.isBinaryExpression(parent) &&
        parent.right === current &&
        ts.isIdentifier(parent.left) &&
        (parent.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
          parent.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken)
      ) {
        return this.usesOf(parsedSource, parent.left, depth, seen);
      }

      // A function's result: where the function is called.
      if (
        (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
        parent.body === current
      ) {
        current = parent;
        continue;
      }

      if (ts.isReturnStatement(parent)) {
        let fn: ts.Node | undefined = parent.parent;

        while (fn && !ts.isFunctionLike(fn)) {
          fn = fn.parent;
        }

        if (!fn) {
          return [UNKNOWN_ELEMENT];
        }

        if (ts.isFunctionDeclaration(fn) && fn.name) {
          return this.usesOf(parsedSource, fn.name, depth, seen);
        }

        current = fn;
        continue;
      }

      if (ts.isFunctionDeclaration(parent) && parent.body === current) {
        return parent.name
          ? this.usesOf(parsedSource, parent.name, depth, seen)
          : [UNKNOWN_ELEMENT];
      }

      // A class field or a method: the scan does not follow `this`.
      if (
        ts.isPropertyDeclaration(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isClassDeclaration(parent)
      ) {
        return [UNKNOWN_ELEMENT];
      }

      // An argument to a call that is not a class helper: a message, a key.
      if (
        ts.isCallExpression(parent) &&
        parent.expression !== current &&
        this.isTextCall(parent)
      ) {
        return [];
      }

      if (ts.isSourceFile(parent) || ts.isExpressionStatement(parent)) {
        return [UNKNOWN_ELEMENT];
      }

      current = parent;
    }

    return [UNKNOWN_ELEMENT];
  }

  // A call whose arguments are words, not classes: translate, log, throw.
  private isTextCall(call: ts.CallExpression): boolean {
    const callee: string = call.expression.getText();

    return TEXT_CALL.test(callee);
  }

  private usesOf(
    parsedSource: ParsedSource,
    declarationName: ts.Identifier,
    depth: number,
    seen: Set<string>,
  ): Array<string> {
    const key: string = `${parsedSource.file}#${declarationName.text}`;

    if (seen.has(key)) {
      return [];
    }

    if (depth > MAX_DEPTH) {
      return [UNKNOWN_ELEMENT];
    }

    const nextSeen: Set<string> = new Set(seen);
    nextSeen.add(key);

    const uses: Array<ts.Identifier> = (
      parsedSource.identifiers.get(declarationName.text) || []
    ).filter((identifier: ts.Identifier): boolean => {
      return identifier !== declarationName && !isDeclarationName(identifier);
    });

    const elements: Array<string> = [];

    for (const use of uses) {
      elements.push(...this.elementsOf(parsedSource, use, depth + 1, nextSeen));
    }

    if (isExported(declarationName)) {
      elements.push(
        ...this.importedUsesOf(
          parsedSource,
          declarationName.text,
          depth,
          nextSeen,
        ),
      );
    }

    if (uses.length === 0 && !isExported(declarationName)) {
      return [];
    }

    return elements;
  }

  // Where the modules that import `name` from this one use it.
  private importedUsesOf(
    parsedSource: ParsedSource,
    name: string,
    depth: number,
    seen: Set<string>,
  ): Array<string> {
    const module: string = withoutExtension(parsedSource.file);
    const elements: Array<string> = [];

    for (const other of this.parsed.values()) {
      if (other === parsedSource) {
        continue;
      }

      for (const statement of other.sourceFile.statements) {
        if (
          !ts.isImportDeclaration(statement) ||
          !ts.isStringLiteral(statement.moduleSpecifier)
        ) {
          continue;
        }

        const target: string | null = resolveImportedModule(
          other.file,
          statement.moduleSpecifier.text,
        );

        if (target !== module) {
          continue;
        }

        const bindings: ts.NamedImportBindings | undefined =
          statement.importClause?.namedBindings;

        if (!bindings || !ts.isNamedImports(bindings)) {
          continue;
        }

        for (const specifier of bindings.elements) {
          const importedName: string = (
            specifier.propertyName || specifier.name
          ).getText();

          if (importedName === name) {
            elements.push(
              ...this.usesOf(other, specifier.name, depth + 1, seen),
            );
          }
        }
      }
    }

    return elements;
  }
}

const SOURCE_FILE: RegExp = /\.tsx?$/u;

// Every .ts and .tsx module under a directory, but tests, builds and packages.
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

      if (
        SOURCE_FILE.test(entry.name) &&
        !entry.name.endsWith(".d.ts") &&
        !entry.name.includes(".test.")
      ) {
        files.push(
          path.relative(REPOSITORY_ROOT, entryPath).split(path.sep).join("/"),
        );
      }
    }
  };

  walk(absolute);

  return files;
};

export const readSources: (files: Array<string>) => Array<LockedLookSource> = (
  files: Array<string>,
): Array<LockedLookSource> => {
  return files.map((file: string): LockedLookSource => {
    return {
      file,
      text: fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
    };
  });
};

// One line per finding, with what to write instead.
export const describeFinding: (finding: LockedLookFinding) => string = (
  finding: LockedLookFinding,
): string => {
  return `${finding.file}:${finding.line} <${finding.element}> ${finding.classes.join(" ")}`;
};

export const LOCKED_LOOK_ADVICE: string =
  "A button that cannot be pressed takes the shared locked look: Button draws it, and a button drawn by hand takes it from getHandDrawnButtonStateClassName({ isLocked, isBusy, hoverClassName }) in Common/UI/Components/Button/ButtonStates (BUTTON_DISABLED_CLASS_NAME for a look on its own) - with disabled={isLocked || isBusy} on the element. A field you type in or pick from (input, select, textarea) keeps its own.";
