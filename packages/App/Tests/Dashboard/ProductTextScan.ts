import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * ONEUPTIME'S OWN WORDS, AS A READER SEES THEM.
 *
 * The strings and template literals of the server, the emails and every
 * frontend, read with the TypeScript scanner - so a comment does not count,
 * and a sentence written as a template literal does, with "{value}" where it
 * puts a value in - and the email and page templates line by line, without
 * their comments. A ModelTable's `name`, which is never drawn, is left out.
 *
 * ee/ is read where it is checked out: the App Test job deletes it, and the
 * Enterprise Edition Test workflow (test.ee.yaml) runs the suites that read
 * these with it present.
 *
 * The menu path guards read their texts here: SettingsMenuPathsInProductText
 * (User Settings and Project Settings) and OnCallDutyMenuPathsInProductText
 * (On-Call Duty). A plain module, not a .test.ts file: importing it runs no
 * tests.
 */

export const PACKAGES_ROOT: string = path.resolve(__dirname, "../../..");
export const REPO_ROOT: string = path.resolve(PACKAGES_ROOT, "..");

const SKIPPED_DIRECTORIES: ReadonlyArray<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "__tests__",
  ".claude",
];

export const CODE_FILE: RegExp = /\.(ts|tsx)$/;
export const TEMPLATE_FILE: RegExp = /\.(hbs|ejs)$/;
const TEST_FILE: RegExp = /\.(test|spec)\.(ts|tsx)$/;

// Where OneUptime's own words are: the server, the emails, every frontend.
export const SCANNED_ROOTS: ReadonlyArray<string> = [
  path.join(PACKAGES_ROOT, "Common", "Server"),
  path.join(PACKAGES_ROOT, "Common", "Utils"),
  path.join(PACKAGES_ROOT, "Common", "Types"),
  path.join(PACKAGES_ROOT, "Common", "UI"),
  path.join(PACKAGES_ROOT, "Common", "Models"),
  path.join(PACKAGES_ROOT, "App", "FeatureSet"),
  path.join(REPO_ROOT, "ee", "Server"),
  path.join(REPO_ROOT, "ee", "Dashboard"),
  path.join(REPO_ROOT, "ee", "AdminDashboard"),
];

// The code and template files under a root, tests and builds left out.
export function filesUnder(root: string): Array<string> {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full: string = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...filesUnder(full));
      }
      continue;
    }

    const isCode: boolean =
      CODE_FILE.test(entry.name) &&
      !TEST_FILE.test(entry.name) &&
      !entry.name.endsWith(".d.ts");

    if (isCode || TEMPLATE_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

// A file's path from packages/, as the guards' messages name it.
export function relative(file: string): string {
  return path.relative(PACKAGES_ROOT, file);
}

// A JSX attribute that is never drawn: a ModelTable's `name`.
function isUndrawnAttribute(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;

  for (let depth: number = 0; current && depth < 3; depth++) {
    if (ts.isJsxAttribute(current)) {
      return current.name.getText() === "name";
    }

    current = current.parent;
  }

  return false;
}

export interface FoundText {
  file: string;
  line: number;
  text: string;
}

// The strings and template literals of a code file, as a reader sees them.
export function codeTexts(file: string, source: string): Array<FoundText> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const texts: Array<FoundText> = [];

  const add: (node: ts.Node, text: string) => void = (
    node: ts.Node,
    text: string,
  ): void => {
    texts.push({
      file: relative(file),
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      text: text,
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isJsxText(node)) &&
      !isUndrawnAttribute(node)
    ) {
      add(node, node.text);
    } else if (ts.isTemplateExpression(node) && !isUndrawnAttribute(node)) {
      // The sentence as a reader sees it, with a placeholder per value.
      add(
        node,
        node.head.text +
          node.templateSpans
            .map((span: ts.TemplateSpan): string => {
              return `{value}${span.literal.text}`;
            })
            .join(""),
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return texts;
}

// Text between two markers removed: a template's comments.
function withoutBetween(text: string, open: string, close: string): string {
  let result: string = "";
  let from: number = 0;

  while (from < text.length) {
    const start: number = text.indexOf(open, from);

    if (start < 0) {
      result += text.slice(from);
      break;
    }

    result += text.slice(from, start);

    const end: number = text.indexOf(close, start + open.length);

    if (end < 0) {
      break;
    }

    from = end + close.length;
  }

  return result;
}

// An email or page template's text, line by line, without its comments.
export function templateTexts(file: string, source: string): Array<FoundText> {
  const text: string = withoutBetween(
    withoutBetween(source, "{{!--", "--}}"),
    "<!--",
    "-->",
  );

  return text.split("\n").map((line: string, index: number): FoundText => {
    return { file: relative(file), line: index + 1, text: line };
  });
}

/*
 * Every text of every scanned file whose source passes `isRead` (a quick
 * look for the words a guard is about, before the file is parsed).
 */
export function productTexts(
  isRead: (source: string) => boolean,
): Array<FoundText> {
  const texts: Array<FoundText> = [];

  for (const file of SCANNED_ROOTS.flatMap(filesUnder)) {
    const source: string = fs.readFileSync(file, "utf8");

    if (!isRead(source)) {
      continue;
    }

    texts.push(
      ...(TEMPLATE_FILE.test(file)
        ? templateTexts(file, source)
        : codeTexts(file, source)),
    );
  }

  return texts;
}
