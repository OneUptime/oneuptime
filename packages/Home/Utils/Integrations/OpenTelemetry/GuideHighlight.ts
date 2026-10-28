import hljs, {
  resolveRegisteredLanguage,
} from "Common/UI/Components/CodeBlock/WebsiteLanguageRegistry";
import { escapeHtml } from "./GuideText";
import { SnippetLanguage } from "./GuideTypes";

/*
 * A snippet's code as highlighted HTML, made on the server.
 *
 * The guides' code is coloured where the page is made, with the grammars the
 * Dashboard's code blocks register (Common's LanguageRegistry) and the few
 * only the guides show - Java, Kotlin, .properties, INI - registered on the
 * same core by WebsiteLanguageRegistry, so a page ships no highlighter
 * script and its code never changes colour as the page loads. The template styles the classes highlight.js writes (hljs-keyword,
 * hljs-string, ...); the text inside is escaped by highlight.js itself.
 *
 * Each snippet is highlighted once per process: the guides are fixed data.
 */

const GRAMMAR_FOR: Record<SnippetLanguage, string> = {
  bash: "bash",
  javascript: "javascript",
  typescript: "typescript",
  tsx: "typescript",
  json: "json",
  yaml: "yaml",
  dockerfile: "dockerfile",
  text: "plaintext",
  python: "python",
  java: "java",
  kotlin: "kotlin",
  csharp: "csharp",
  xml: "xml",
  properties: "properties",
  ini: "ini",
};

const highlighted: Map<string, string> = new Map<string, string>();

export function highlightSnippet(
  code: string,
  language: SnippetLanguage,
): string {
  const key: string = `${language}\n${code}`;
  const cached: string | undefined = highlighted.get(key);

  if (cached !== undefined) {
    return cached;
  }

  const grammar: string | null = resolveRegisteredLanguage(
    GRAMMAR_FOR[language],
  );

  const html: string = grammar
    ? hljs.highlight(code, { language: grammar, ignoreIllegals: true }).value
    : escapeHtml(code);

  highlighted.set(key, html);

  return html;
}

// The label a code block's header shows for its language.
export const SNIPPET_LANGUAGE_LABELS: Record<SnippetLanguage, string> = {
  bash: "Shell",
  javascript: "JavaScript",
  typescript: "TypeScript",
  tsx: "TSX",
  json: "JSON",
  yaml: "YAML",
  dockerfile: "Dockerfile",
  text: "Output",
  python: "Python",
  java: "Java",
  kotlin: "Kotlin",
  csharp: "C#",
  xml: "XML",
  properties: "Properties",
  ini: "INI",
};
