import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "./ForeignHiddenRuleGuard";

/*
 * Where browser code touches the clipboard directly (ClipboardWritesGuard).
 *
 * Issue #5132: the status page's Subscribe to calendar awaited
 * navigator.clipboard?.writeText(...) and then said "Copied!". On a page
 * served over plain http there is no navigator.clipboard, the optional call
 * resolves to undefined, and the dialog said "Copied!" over an empty
 * clipboard. A dozen other copy buttons wrote to navigator.clipboard
 * themselves, each failing its own way: a tick over nothing, a click that
 * threw, silence.
 *
 * So text reaches the clipboard through one file, Common/UI/Utils/Clipboard.ts
 * (the async clipboard, then the older copy command a plain-http page still
 * has, and a boolean saying whether either worked), and a copy control
 * draws what that boolean says (UseClipboardCopy.ts). This finds every
 * other place that reads navigator.clipboard - by any spelling: optional,
 * through window or globalThis, by index, destructured - or runs the copy
 * command, read through the TypeScript AST so a comment that names
 * navigator.clipboard is not a finding.
 */

export const CLIPBOARD_WRITER_FILE: string =
  "packages/Common/UI/Utils/Clipboard.ts";

/*
 * Files that may reach the clipboard themselves, and why. An image is not
 * text: it needs the async Clipboard API's write() with a ClipboardItem built
 * inside the click (Safari), and there is no older command that copies one -
 * so Clipboard.ts has nothing to offer it. Such a file must still never write
 * text (no writeText, no copy command): that goes through Clipboard.ts.
 */
export const IMAGE_CLIPBOARD_FILES: Record<string, string> = {
  "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayScreenshot.ts":
    "puts a replay frame on the clipboard as a PNG (navigator.clipboard.write with a ClipboardItem); ReplayScreenshotActions says when the browser has no image clipboard or refuses, and offers the download",
};

export enum ClipboardWriteKind {
  NavigatorClipboard = "navigator.clipboard",
  CopyCommand = "execCommand copy",
}

export interface ClipboardWriteSite {
  kind: ClipboardWriteKind;
  // 1-based.
  line: number;
  // The expression as written.
  text: string;
}

export interface ClipboardWriteFinding extends ClipboardWriteSite {
  // Relative to the repository root, with forward slashes.
  file: string;
}

const NAVIGATOR_OWNERS: ReadonlySet<string> = new Set<string>([
  "window",
  "globalThis",
  "self",
]);

const CLIPBOARD_COMMANDS: ReadonlySet<string> = new Set<string>([
  "copy",
  "cut",
]);

// `x`, `(x)`, `x!` and `x as T` are all `x`.
function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

// navigator, window.navigator, globalThis.navigator, self.navigator.
function isNavigator(expression: ts.Expression): boolean {
  const target: ts.Expression = unwrap(expression);

  if (ts.isIdentifier(target)) {
    return target.text === "navigator";
  }

  if (ts.isPropertyAccessExpression(target)) {
    const owner: ts.Expression = unwrap(target.expression);

    return (
      target.name.text === "navigator" &&
      ts.isIdentifier(owner) &&
      NAVIGATOR_OWNERS.has(owner.text)
    );
  }

  return false;
}

// document.execCommand, window.document.execCommand.
function isExecCommand(expression: ts.Expression): boolean {
  const target: ts.Expression = unwrap(expression);

  return (
    (ts.isPropertyAccessExpression(target) &&
      target.name.text === "execCommand") ||
    (ts.isElementAccessExpression(target) &&
      ts.isStringLiteralLike(target.argumentExpression) &&
      target.argumentExpression.text === "execCommand")
  );
}

function bindsClipboard(pattern: ts.ObjectBindingPattern): boolean {
  return pattern.elements.some((element: ts.BindingElement): boolean => {
    const name: ts.Node = element.propertyName || element.name;

    return (
      (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) &&
      name.text === "clipboard"
    );
  });
}

/*
 * Every direct clipboard access in one module's source. A copy command
 * named by a variable (the Markdown editor's formatting commands) is not
 * one: only a written "copy" or "cut" is.
 */
export function findClipboardWriteSites(
  fileName: string,
  source: string,
): Array<ClipboardWriteSite> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") || fileName.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );

  const sites: Array<ClipboardWriteSite> = [];

  const record: (kind: ClipboardWriteKind, node: ts.Node) => void = (
    kind: ClipboardWriteKind,
    node: ts.Node,
  ): void => {
    sites.push({
      kind: kind,
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      text: node.getText(sourceFile),
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "clipboard" &&
      isNavigator(node.expression)
    ) {
      record(ClipboardWriteKind.NavigatorClipboard, node);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "clipboard" &&
      isNavigator(node.expression)
    ) {
      record(ClipboardWriteKind.NavigatorClipboard, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isNavigator(node.initializer) &&
      bindsClipboard(node.name)
    ) {
      record(ClipboardWriteKind.NavigatorClipboard, node);
    } else if (
      ts.isCallExpression(node) &&
      isExecCommand(node.expression) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]!) &&
      CLIPBOARD_COMMANDS.has(
        (node.arguments[0] as ts.StringLiteralLike).text.toLowerCase(),
      )
    ) {
      record(ClipboardWriteKind.CopyCommand, node);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return sites;
}

// Every browser module the guard reads (ForeignHiddenRuleGuard's roots).
export function listClipboardScanFiles(repositoryRoot: string): Array<string> {
  return listScanRoots(repositoryRoot).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );
}

export function scanClipboardWrites(
  repositoryRoot: string,
  files: Array<string>,
): Array<ClipboardWriteFinding> {
  return files.flatMap((file: string): Array<ClipboardWriteFinding> => {
    const relative: string = toRelativePath(repositoryRoot, file);

    return findClipboardWriteSites(file, fs.readFileSync(file, "utf8")).map(
      (site: ClipboardWriteSite): ClipboardWriteFinding => {
        return { ...site, file: relative };
      },
    );
  });
}

// What is not allowed: everything outside Clipboard.ts and the image files.
export function disallowedClipboardWrites(
  findings: Array<ClipboardWriteFinding>,
): Array<ClipboardWriteFinding> {
  return findings.filter((finding: ClipboardWriteFinding): boolean => {
    return (
      finding.file !== CLIPBOARD_WRITER_FILE &&
      !Object.prototype.hasOwnProperty.call(IMAGE_CLIPBOARD_FILES, finding.file)
    );
  });
}

export function formatClipboardWriteFindings(
  findings: Array<ClipboardWriteFinding>,
): string {
  if (findings.length === 0) {
    return "";
  }

  return [
    `${findings.length} direct clipboard write(s) outside ${CLIPBOARD_WRITER_FILE}:`,
    ...findings.map((finding: ClipboardWriteFinding): string => {
      return `  ${finding.file}:${finding.line}  ${finding.text}`;
    }),
    "",
    "Copy text with Clipboard.copyToClipboard (it falls back to the older copy",
    "command on a page served over plain http, where navigator.clipboard is",
    "missing), or with the useClipboardCopy hook, which also holds the Copied /",
    "Copy failed state. Say Copied only when the copy resolved true, and",
    "otherwise say it could not (Clipboard.selectForManualCopy selects the text",
    "so it can be copied by hand). See issue #5132.",
  ].join("\n");
}

// packages/Common/Tests -> the repository root.
export const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
);
