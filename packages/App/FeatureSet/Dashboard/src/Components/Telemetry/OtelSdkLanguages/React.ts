import { OtelLanguageSnippets } from "./Shared";
import { browserSnippets } from "./Browser";

/*
 * React, in the browser: src/telemetry.ts as Browser.ts writes it, which
 * the app's entry file imports before React. See Browser.ts for what was
 * checked, with which versions, and why it is written as it is.
 */

const ReactSnippets: OtelLanguageSnippets = browserSnippets({
  serviceName: "my-react-app",
  intro: [
    "// src/telemetry.ts - import it first in src/main.tsx (src/index.tsx in",
    "// Create React App), before React:",
    "//   import './telemetry';",
  ],
  traced: "Page loads, and fetch and XMLHttpRequest calls (axios's too).",
});

export default ReactSnippets;
