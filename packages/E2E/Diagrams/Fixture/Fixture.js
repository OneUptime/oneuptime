import React from "react";
import { createRoot } from "react-dom/client";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import ThemeUtil from "Common/UI/Utils/Theme";
import "Common/UI/Styles/Theme.css";

/*
 * The production MarkdownViewer, as the Dashboard draws a note, a runbook or
 * a settings page's help text. Its mermaid comes from the frontends' esbuild
 * config, so this is the build every frontend ships.
 *
 * ?diagrams= picks what the markdown holds:
 *
 *   all     (default) a flowchart with a $$...$$ label, and a sequence
 *           diagram.
 *   plain   the sequence diagram only: nothing that needs KaTeX.
 *   broken  a diagram that does not parse.
 *   none    no diagram at all.
 *
 * ?theme=dark turns the dark theme on before anything renders; the Toggle
 * theme button switches it the way the Dashboard's menu does.
 */

const params = new URLSearchParams(window.location.search);

if (params.get("theme") === "dark") {
  document.documentElement.classList.add("dark");
}

const FLOWCHART = [
  "```mermaid",
  "graph LR",
  '  A["$$x^2 + y^2 = z^2$$"] --> B[Plain label]',
  "```",
].join("\n");

const SEQUENCE = [
  "```mermaid",
  "sequenceDiagram",
  "  Alice->>Bob: Hello Bob",
  "  Bob-->>Alice: Hello Alice",
  "```",
].join("\n");

const BROKEN = ["```mermaid", "graph LR", "  A -->", "```"].join("\n");

const MARKDOWN = {
  all: ["## Diagrams", "", FLOWCHART, "", SEQUENCE].join("\n"),
  plain: ["## Diagrams", "", SEQUENCE].join("\n"),
  broken: ["## Diagrams", "", BROKEN].join("\n"),
  none: ["## No diagrams", "", "Just text, and `code`."].join("\n"),
};

const text = MARKDOWN[params.get("diagrams") || "all"] || MARKDOWN.all;

function App() {
  return (
    <main className="mx-auto max-w-3xl p-6 text-gray-700">
      <button
        type="button"
        className="rounded border px-2 py-1 text-sm"
        onClick={() => {
          ThemeUtil.toggleTheme();
        }}
      >
        Toggle theme
      </button>
      <div data-testid="markdown">
        <MarkdownViewer text={text} />
      </div>
    </main>
  );
}

// No top-level await: the bundle keeps the frontends' es2017 target.
i18next
  .use(initReactI18next)
  .init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  })
  .then(() => {
    createRoot(document.getElementById("root")).render(<App />);
  });
