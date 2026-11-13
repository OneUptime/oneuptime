import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * READING A FRONTEND'S TEXT FOR THE LLM PROVIDERS SETTING'S NAME (#7156,
 * #7356).
 *
 * The page where OneUptime AI's models are set up is LLM Providers: Project
 * Settings → AI → LLM Providers in a project, Settings → Global LLM
 * Providers in the Admin Dashboard. Text that sends people there says "LLM
 * provider", never "AI provider", which names no setting. The Dashboard's
 * guard (LlmProviderNameInDashboard) and the Admin Dashboard's
 * (LlmProviderNameInAdminDashboard) read the source the same way, here.
 */

// "AI provider", "AI providers", "AI-provider", in any case.
export const AI_PROVIDER: RegExp = /\bAI[ -]providers?\b/i;

// The page, with any of the separators the Dashboard writes.
export const LLM_PROVIDERS_PAGE: RegExp =
  /\bAI\s*(?:→|->|>|›|&gt;)\s*LLM Providers\b/;

// A call that only logs: nobody looks for a setting in a console line.
const LOG_CALL: RegExp = /^(?:logger|console)\.\w+$/;

export interface WrittenText {
  file: string;
  line: number;
  text: string;
}

// Every piece of text a file writes - strings, template text, JSX text.
export function writtenTexts(file: string, source: string): Array<WrittenText> {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const texts: Array<WrittenText> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      LOG_CALL.test(node.expression.getText(sourceFile))
    ) {
      return;
    }

    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      const text: string = node.text.trim();

      if (text) {
        texts.push({
          file,
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1,
          text,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return texts;
}

// Every .ts and .tsx file under a folder, declaration files aside.
export function sourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...sourceFiles(entryPath));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

export function describeText(found: WrittenText): string {
  return `${found.file}:${found.line}: ${found.text}`;
}
