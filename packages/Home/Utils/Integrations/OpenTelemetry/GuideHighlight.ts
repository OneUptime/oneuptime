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

// The shell grammars, whose arguments highlight.js can take for builtins.
const SHELL_GRAMMARS: ReadonlySet<SnippetLanguage> = new Set<SnippetLanguage>([
  "bash",
  "dockerfile",
]);

const BUILT_IN_OPEN: string = '<span class="hljs-built_in">';
const SPAN_END: string = "</span>";

// After one of these characters a new command starts: ; | && || $( ` { !
const COMMAND_SEPARATORS: ReadonlySet<string> = new Set<string>([
  ";",
  "|",
  "&",
  "(",
  "`",
  "{",
  "!",
]);

// After one of these words a command starts: a Dockerfile's RUN, the shell's own keywords.
const COMMAND_STARTERS: ReadonlySet<string> = new Set<string>([
  "RUN",
  "then",
  "do",
  "else",
  "elif",
]);

// The entities highlight.js escapes text with, back to their characters.
const ENTITIES: ReadonlyMap<string, string> = new Map<string, string>([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&#x27;", "'"],
]);

// Whether the next word, after this much of its command line, starts a command.
function startsACommand(lineBefore: string): boolean {
  const text: string = lineBefore.trimEnd();

  if (text.length === 0) {
    return true;
  }

  if (COMMAND_SEPARATORS.has(text[text.length - 1]!)) {
    return true;
  }

  return COMMAND_STARTERS.has(text.slice(text.lastIndexOf(" ") + 1));
}

/*
 * A shell builtin is one only where a command starts: first on its line, or
 * after ; | && ( or a word that starts one (then, do, a Dockerfile's RUN).
 * Anywhere else the bash grammar's builtin is an argument - the "log" of
 * go.opentelemetry.io/otel/sdk/log, the "exec" of bundle exec, the "local"
 * of /usr/local, the "bind" of gunicorn's --bind - and goes back to plain
 * text. A line ending in a backslash goes on as the same command.
 */
export function plainArgumentBuiltins(html: string): string {
  let result: string = "";
  // The text of the command line so far, without its tags.
  let line: string = "";
  let index: number = 0;

  while (index < html.length) {
    const character: string = html[index]!;

    if (character === "<") {
      const wordStart: number = index + BUILT_IN_OPEN.length;
      const wordEnd: number = html.startsWith(BUILT_IN_OPEN, index)
        ? html.indexOf(SPAN_END, wordStart)
        : -1;
      const word: string = wordEnd < 0 ? "" : html.slice(wordStart, wordEnd);

      if (wordEnd >= 0 && !word.includes("<")) {
        result += startsACommand(line)
          ? html.slice(index, wordEnd + SPAN_END.length)
          : word;
        line += word;
        index = wordEnd + SPAN_END.length;
        continue;
      }

      // Any other tag is copied as it is, and is no text of the line.
      const tagEnd: number = html.indexOf(">", index);

      if (tagEnd < 0) {
        return result + html.slice(index);
      }

      result += html.slice(index, tagEnd + 1);
      index = tagEnd + 1;
      continue;
    }

    if (character === "&") {
      const entityEnd: number = html.indexOf(";", index);
      const entity: string =
        entityEnd < 0 ? "" : html.slice(index, entityEnd + 1);
      const decoded: string | undefined = ENTITIES.get(entity);

      if (decoded !== undefined) {
        result += entity;
        line += decoded;
        index = entityEnd + 1;
        continue;
      }
    }

    if (character === "\n") {
      const ended: string = line.trimEnd();

      line = ended.endsWith("\\") ? `${ended.slice(0, -1)} ` : "";
    } else {
      line += character;
    }

    result += character;
    index++;
  }

  return result;
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
    ? plainArgumentBuiltins(coloured)
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
