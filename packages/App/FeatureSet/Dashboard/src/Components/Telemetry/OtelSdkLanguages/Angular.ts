import { OtelLanguageSnippets } from "./Shared";
import { browserSnippets } from "./Browser";

/*
 * Angular, in the browser: src/telemetry.ts as Browser.ts writes it, which
 * main.ts imports before Angular. See Browser.ts for what was checked, with
 * which versions, and why it is written as it is.
 */

const AngularSnippets: OtelLanguageSnippets = browserSnippets({
  serviceName: "my-angular-app",
  intro: [
    "// src/telemetry.ts - import it first in src/main.ts, before Angular:",
    "//   import './telemetry';",
  ],
  traced: "Page loads, and HttpClient calls, with or without withFetch().",
});

export default AngularSnippets;
