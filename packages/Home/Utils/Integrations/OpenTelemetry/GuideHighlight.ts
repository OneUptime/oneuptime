import hljs, {
  resolveRegisteredLanguage,
} from "Common/UI/Components/CodeBlock/WebsiteLanguageRegistry";
import { escapeHtml } from "./GuideText";
import { SnippetLanguage } from "./GuideTypes";

/*
 * A snippet's code as highlighted HTML, made on the server.
 *
 * The guides' code is coloured where the page is made, with the grammars the
 * Dashboard's code blocks register (Common's LanguageRegistry: Go, Ruby,
 * PHP, Rust and Elixir among them) and the few only the guides show -
 * Java, Kotlin, .properties, INI, TOML and Protobuf - registered on the same core by
 * WebsiteLanguageRegistry, so a page ships no highlighter script and its
 * code never changes colour as the page loads. The template styles the
 * classes highlight.js writes (hljs-keyword, hljs-string, ...); the text
 * inside is escaped by highlight.js itself.
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
  go: "go",
  ruby: "ruby",
  php: "php",
  rust: "rust",
  elixir: "elixir",
  // highlight.js reads TOML with its INI grammar, which names it as an alias.
  toml: "toml",
  protobuf: "protobuf",
};

const highlighted: Map<string, string> = new Map<string, string>();

// The shell grammars, whose flags highlight.js can take for builtins.
const SHELL_GRAMMARS: ReadonlySet<SnippetLanguage> = new Set<SnippetLanguage>([
  "bash",
  "dockerfile",
]);

const FLAG_THEN_BUILT_IN: string = '-<span class="hljs-built_in">';
const SPAN_END: string = "</span>";

/*
 * A command's flag is the command's own, never a shell builtin: the bash
 * grammar colours the "bind" of gunicorn's --bind as bash's bind. Each such
 * word right after a dash goes back to plain text.
 */
export function plainFlags(html: string): string {
  let result: string = "";
  let rest: string = html;

  for (;;) {
    const at: number = rest.indexOf(FLAG_THEN_BUILT_IN);

    if (at < 0) {
      return result + rest;
    }

    const wordStart: number = at + FLAG_THEN_BUILT_IN.length;
    const wordEnd: number = rest.indexOf(SPAN_END, wordStart);

    if (wordEnd < 0) {
      return result + rest;
    }

    result += `${rest.slice(0, at + 1)}${rest.slice(wordStart, wordEnd)}`;
    rest = rest.slice(wordEnd + SPAN_END.length);
  }
}

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

  const coloured: string = grammar
    ? hljs.highlight(code, { language: grammar, ignoreIllegals: true }).value
    : escapeHtml(code);
  const html: string = SHELL_GRAMMARS.has(language)
    ? plainFlags(coloured)
    : coloured;

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
  go: "Go",
  ruby: "Ruby",
  php: "PHP",
  rust: "Rust",
  elixir: "Elixir",
  toml: "TOML",
  protobuf: "Protobuf",
};
