import { LocaleTree, listSourceFiles } from "./AdminOwnPagesStrings";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The sentences in the Admin Dashboard's source that no locale holds and
 * the string extractor cannot see (#8636).
 *
 * The extractor (scanSourceText) finds a text by where it stands: a
 * translation call, translationKey("..."), a prop named for what it shows.
 * A text kept in a variable or a constant first, or handed to a prop with
 * another name (cardTitle, removedText, a helper's argument), is invisible
 * to it, so AdminOwnPagesStringsLocales never asks for its entry and the
 * page reads it in English: "Block" on the bulk action, the Feedback
 * switch's card, the health log's metric labels.
 *
 * This reads every string literal instead. One that reads as words - it
 * starts with a capital letter and has a space - and is neither a key nor
 * a one form of the Admin's English locale is a text nobody looked up.
 * Code, names and values a person never reads are skipped by where they
 * stand (an import, a class name, an id, a comparison, an enum's value) or
 * listed with their reason (AdminUnseenTextsGuard).
 */

export interface UnseenText {
  // Repository-relative, with forward slashes.
  file: string;
  line: number;
  text: string;
}

// JSX attributes whose value is code, never words.
const CODE_ATTRIBUTES: RegExp =
  /^(className|key|id|href|to|type|name|role|target|rel|accept|autoComplete|inputMode|tableKey|testId|dataTestId|data-.*|aria-hidden|aria-controls|aria-labelledby|aria-describedby|htmlFor|method|src|lang|dir)$/;

const READS_AS_WORDS: RegExp = /^\p{Lu}[^]*\s/u;

const COMPARISON: RegExp = /^(===|!==|==|!=)$/;

// A call whose string is a module or a pattern: import, require, RegExp.
const CODE_CALL: RegExp = /^(import|require|RegExp)$/;

// Every string English holds: its keys, and every value (a one form, a nested entry).
export function readEnglishTexts(english: LocaleTree): Set<string> {
  const texts: Set<string> = new Set<string>();

  const walk: (tree: LocaleTree) => void = (tree: LocaleTree): void => {
    for (const [key, value] of Object.entries(tree)) {
      texts.add(key);

      if (typeof value === "string") {
        texts.add(value);
      } else {
        walk(value);
      }
    }
  };

  walk(english);

  return texts;
}

// Whether the literal stands where a person never reads it.
const isCode: (node: ts.Node) => boolean = (node: ts.Node): boolean => {
  const parent: ts.Node = node.parent;

  if (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent) ||
    ts.isLiteralTypeNode(parent) ||
    ts.isEnumMember(parent) ||
    ts.isCaseClause(parent) ||
    ts.isElementAccessExpression(parent)
  ) {
    return true;
  }

  if (ts.isJsxAttribute(parent)) {
    return CODE_ATTRIBUTES.test(parent.name.getText());
  }

  if (
    ts.isJsxExpression(parent) &&
    parent.parent &&
    ts.isJsxAttribute(parent.parent)
  ) {
    return CODE_ATTRIBUTES.test(parent.parent.name.getText());
  }

  if (ts.isPropertyAssignment(parent) && parent.name === node) {
    return true;
  }

  if (
    ts.isBinaryExpression(parent) &&
    COMPARISON.test(parent.operatorToken.getText())
  ) {
    return true;
  }

  // import("..."), require("...") and new RegExp("...").
  if (
    (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
    CODE_CALL.test(parent.expression.getText())
  ) {
    return true;
  }

  return false;
};

// The sentences one file holds that `english` does not.
export function findUnseenTextsIn(
  relativeFile: string,
  source: string,
  english: Set<string>,
): Array<UnseenText> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    relativeFile,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativeFile.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const unseen: Array<UnseenText> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      READS_AS_WORDS.test(node.text) &&
      !english.has(node.text) &&
      !isCode(node)
    ) {
      unseen.push({
        file: relativeFile,
        line:
          sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        text: node.text,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return unseen;
}

// The sentences every source file under `directory` holds that `english` does not.
export function findUnseenTexts(
  repositoryRoot: string,
  directory: string,
  english: Set<string>,
): Array<UnseenText> {
  return listSourceFiles(directory).flatMap(
    (file: string): Array<UnseenText> => {
      return findUnseenTextsIn(
        path.relative(repositoryRoot, file).split(path.sep).join("/"),
        fs.readFileSync(file, "utf8"),
        english,
      );
    },
  );
}
