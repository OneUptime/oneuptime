/*
 * The shape of an OpenTelemetry guide: one framework's page at
 * /integrations/opentelemetry/<slug>.
 *
 * Every guide is data of this shape, and one template draws them all
 * (Views/integrations/opentelemetry-guide.ejs), so every page has the same
 * sections in the same order and a new framework only adds data. Every
 * section is required: a guide that leaves one out does not compile, and
 * Tests/OpenTelemetryGuides holds each to its content (no empty section, a
 * real troubleshooting list and FAQ, every snippet checked).
 *
 * Text fields are "inline text": plain words with three marks, drawn by
 * GuideText.ts - `code`, **bold** and [a link](/docs/...). The page, its
 * Markdown copy (/integrations/opentelemetry/<slug>.md) and its structured
 * data each read them their own way.
 */

// Words with `code`, **bold** and [links](/path) in them.
export type InlineText = string;

export type SnippetLanguage =
  | "bash"
  | "javascript"
  | "typescript"
  | "tsx"
  | "json"
  | "yaml"
  | "dockerfile"
  | "text";

/*
 * How the tests and the end-to-end check hold a snippet to working:
 *
 *   run          the end-to-end check runs this file or command as written
 *                (with the endpoint and key pointed at a local receiver);
 *   contained    a fragment of a file the end-to-end check runs, word for
 *                word, so it ran too;
 *   parse        parsed by the tests but not run: a Dockerfile, a Kubernetes
 *                manifest, a config file for a platform the check has none of;
 *   illustrative output to recognise, not code to copy.
 */
export type SnippetCheck = "run" | "contained" | "parse" | "illustrative";

export interface GuideSnippet {
  // Unique within its guide; the end-to-end check names files by it.
  id: string;
  language: SnippetLanguage;
  // A file name or a caption, shown above the code.
  title?: string | undefined;
  code: string;
  check: SnippetCheck;
}

export interface GuideTab {
  // The tab's label: "OneUptime Cloud", "Self-hosted".
  label: string;
  body?: InlineText | undefined;
  snippets: Array<GuideSnippet>;
  notes?: Array<InlineText> | undefined;
}

export interface GuideTabs {
  /*
   * Tab sets of one group share the reader's choice: picking "Self-hosted"
   * once picks it in every set of the group, on every guide.
   */
  group: "deployment" | "setup" | "modules" | "packageManager";
  tabs: Array<GuideTab>;
}

export interface GuideStep {
  title: string;
  body: InlineText;
  snippets?: Array<GuideSnippet> | undefined;
  tabs?: GuideTabs | undefined;
  notes?: Array<InlineText> | undefined;
}

// One bar of the example trace: what a request to this framework looks like.
export interface ExampleSpan {
  name: string;
  // How deep it sits in the tree: 0 for the root.
  depth: number;
  // Where it starts and how long it takes, in percent of the root.
  start: number;
  duration: number;
  // Who made it, shown beside the bar: "http", "express", "you".
  source: string;
  isError?: boolean | undefined;
}

export interface GuideTableRow {
  library: InlineText;
  covers: InlineText;
}

export interface GuideMetricRow {
  name: string;
  description: InlineText;
}

export interface GuideQuestion {
  question: string;
  answer: InlineText;
  snippets?: Array<GuideSnippet> | undefined;
}

export interface GuideLink {
  title: string;
  href: string;
  description: string;
}

// A section that explains, shows code and adds notes.
export interface GuideCodeSection {
  intro: InlineText;
  snippets: Array<GuideSnippet>;
  notes: Array<InlineText>;
}

/*
 * What the end-to-end check runs for a guide (Scripts/
 * VerifyOpenTelemetryGuides.ts), and what it must see arrive. The files and
 * commands are the page's own snippets wherever the page shows them, so
 * what was run is what a reader copies.
 */
export interface VerificationFile {
  path: string;
  // The page's snippet written to the file, word for word...
  snippet?: string | undefined;
  // ...or scaffolding the page does not show (a test app, a package.json).
  content?: string | undefined;
}

export interface VerificationCommand {
  // The page's snippet run as a shell command...
  snippet?: string | undefined;
  // ...or a command the page does not show (a build step of the test app).
  command?: string | undefined;
  // The server: started, then asked the requests below, then stopped.
  isServer?: boolean | undefined;
}

export interface VerificationRequest {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown> | undefined;
  headers?: Record<string, string> | undefined;
}

export interface ExpectedSpan {
  name: string;
  // Attributes the span must carry, with these values.
  attributes?: Record<string, string> | undefined;
  // The span must hold an exception event.
  hasException?: boolean | undefined;
}

export interface ExpectedLog {
  // The record's body contains this text.
  body: string;
  // The record carries the trace and span id of the request it was written in.
  hasTraceContext: boolean;
}

export interface VerificationExpectations {
  spans: Array<ExpectedSpan>;
  metrics: Array<string>;
  logs: Array<ExpectedLog>;
  // Resource attributes every batch must carry.
  resource?: Record<string, string> | undefined;
  // Request paths no span may be recorded for: the health checks left out.
  untracedPaths?: Array<string> | undefined;
}

export interface GuideVerification {
  // The runtime the check uses: "node", "bun", "deno", "browser".
  runtime: "node" | "bun" | "deno" | "browser";
  /*
   * The framework the app runs on, as the page names it, and the package
   * its installed version is read from: { name: "Express", package: "express" }.
   * A runtime guide names the runtime: its version is the binary's.
   */
  framework: { name: string; package?: string | undefined };
  files: Array<VerificationFile>;
  commands: Array<VerificationCommand>;
  /*
   * For a browser guide: the folder the built app is served from. The check
   * serves it on `port` and answers GET /api/* with a small JSON body, so
   * the page has a backend to call.
   */
  serve?: string | undefined;
  port: number;
  requests: Array<VerificationRequest>;
  // For a browser guide: the elements clicked once the page has loaded.
  clicks?: Array<string> | undefined;
  expect: VerificationExpectations;
}

export interface OpenTelemetryGuide {
  // The guide's catalog entry (Common/Types/Telemetry/OpenTelemetryGuides.ts).
  slug: string;
  // The search result: at most 60 characters ending " | OneUptime", and 160.
  seo: { title: string; description: string };
  // The page's one h1.
  h1: string;
  // Two or three sentences under the h1.
  lead: InlineText;
  // One sentence for the index's card and the related guides.
  cardDescription: string;
  // Extra words the index's search finds the guide by.
  searchTerms: Array<string>;
  // The badges under the lead: "Automatic instrumentation", "ES modules".
  highlights: Array<string>;

  whatYouGet: {
    intro: InlineText;
    traces: InlineText;
    metrics: InlineText;
    logs: InlineText;
    exceptions: InlineText;
  };
  exampleTrace: { caption: string; spans: Array<ExampleSpan> };
  prerequisites: Array<InlineText>;
  install: GuideCodeSection;
  configure: { intro: InlineText; tabs: GuideTabs; notes: Array<InlineText> };
  setup: { intro: InlineText; steps: Array<GuideStep> };
  autoInstrumentation: {
    intro: InlineText;
    rows: Array<GuideTableRow>;
    // Shown after the notes: an instrumentation's options, say.
    snippets: Array<GuideSnippet>;
    notes: Array<InlineText>;
  };
  manualSpans: GuideCodeSection;
  logs: GuideCodeSection;
  metrics: {
    intro: InlineText;
    builtIn: Array<GuideMetricRow>;
    snippets: Array<GuideSnippet>;
    notes: Array<InlineText>;
  };
  sampling: GuideCodeSection;
  deploy: GuideCodeSection;
  verify: { intro: InlineText; steps: Array<GuideStep> };
  troubleshooting: Array<GuideQuestion>;
  faq: Array<GuideQuestion>;
  // Slugs of the guides a reader of this one goes to next.
  related: Array<string>;
  // The docs pages that go deeper.
  docs: Array<GuideLink>;
  verification: GuideVerification;
}
