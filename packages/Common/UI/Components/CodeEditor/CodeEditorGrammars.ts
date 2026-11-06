/*
 * highlight.js core plus only the grammars CodeEditor's languages use,
 * loaded the first time an editor with a grammar is drawn
 * (CodeEditorHighlight's loadCodeHighlighter): never import this module
 * from anywhere else. Every form can hold a code field, so FormField reaches
 * the editor on every page - the sign-in page among them - and the grammars,
 * about 90 KB of script, used to be downloaded and parsed before any page
 * could draw (issue #5619). Registering all of CodeBlock's languages here
 * would put C#, Rust and Swift grammars in every editor for nothing.
 *
 * Both modules register onto the same core, and a grammar already
 * registered is left alone.
 */
/*
 * highlight.js ships its deep-path typings as ambient `declare module`
 * blocks inside its root types, which only enter the program when something
 * resolves the bare specifier. `import type` is erased at emit.
 */
import type {} from "highlight.js";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const GRAMMARS: Array<[string, typeof json]> = [
  ["bash", bash],
  ["css", css],
  ["javascript", javascript],
  ["json", json],
  ["markdown", markdown],
  ["sql", sql],
  ["xml", xml],
  ["yaml", yaml],
];

for (const [name, grammar] of GRAMMARS) {
  if (!hljs.getLanguage(name)) {
    hljs.registerLanguage(name, grammar);
  }
}

export default hljs;
