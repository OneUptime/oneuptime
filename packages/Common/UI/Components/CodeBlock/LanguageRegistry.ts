/*
 * CodeBlock used to render through react-highlight, whose `import hljs from
 * "highlight.js"` drags every one of the 194 language grammars (~1.5MB) into
 * the eager bundle — and CodeBlock sits in the eager graph via Detail. This
 * registry mirrors the trim MarkdownViewer.tsx already does with prism-light:
 * import highlight.js/lib/core (no grammars) and register only the languages
 * call sites actually pass, plus a few cheap obvious companions.
 *
 * Audit of every `language` prop passed to CodeBlock (2026-08):
 *   bash        — ServerMonitor/Probe/AIAgent docs, Runner install, MCP pages,
 *                 Telemetry Documentation snippets
 *   text        — MCP pages, AIAgentTasks logs, subscriber templates (SMS);
 *                 built-in alias of plaintext
 *   plaintext   — Detail.tsx FieldType.Code
 *   json        — MCP pages, AIAgentTasks logs, Detail.tsx JSON fields,
 *                 subscriber templates (webhook)
 *   html        — Detail.tsx HTML fields, subscriber templates (email);
 *                 built-in alias of xml
 *   css         — Detail.tsx CSS fields
 *   javascript  — Detail.tsx FieldType.JavaScript, Telemetry Documentation
 *   markdown    — subscriber templates (Slack / Microsoft Teams)
 *   typescript, python, go, csharp, rust, php, ruby, elixir, cpp, swift
 *               — Telemetry Documentation per-language OTel snippets
 * Cheap future-proofing (each a few KB, likely next in docs pages):
 *   shell, yaml, sql, dockerfile
 *
 * highlight.js registers each grammar's own aliases automatically (js/ts/py/
 * sh/rb/rs/golang/md/text/…), so resolveRegisteredLanguage("ts") works too.
 * Anything unregistered resolves to null and CodeBlock renders plain escaped
 * text — hljs is never invoked with an unknown language, so it never logs
 * "Could not find the language" warnings.
 */
/*
 * highlight.js ships its deep-path typings (highlight.js/lib/core and the
 * lib/languages/* wildcard) as ambient `declare module` blocks inside its
 * root types/index.d.ts, which only enters the program when something
 * resolves the bare specifier. `import type` is erased at emit, so this does
 * NOT pull the full-language barrel into the bundle.
 */
import type {} from "highlight.js";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import elixir from "highlight.js/lib/languages/elixir";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("elixir", elixir);
hljs.registerLanguage("go", go);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("php", php);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("python", python);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("swift", swift);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

/*
 * Maps a caller-supplied language string to a name highlight.js can actually
 * highlight with, or null when the language (or one of its aliases) is not
 * registered above. Callers must treat null as "render plain text".
 */
export const resolveRegisteredLanguage: (language: string) => string | null = (
  language: string,
): string | null => {
  const normalized: string = language.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  return hljs.getLanguage(normalized) ? normalized : null;
};

export default hljs;
