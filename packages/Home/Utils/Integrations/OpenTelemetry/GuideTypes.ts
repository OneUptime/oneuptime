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
  | "text"
  | "python"
  | "java"
  | "kotlin"
  | "csharp"
  // pom.xml, a .csproj, logback.xml.
  | "xml"
  // application.properties.
  | "properties"
  // uwsgi.ini.
  | "ini";

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
  group: "deployment" | "setup" | "modules" | "packageManager" | "buildTool";
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
 * The install section: what to add, as commands or a build file's lines.
 * Where the same packages go into a Maven or a Gradle build, it shows both
 * as build-tool tabs instead, and the reader's tool is picked on every
 * guide at once.
 */
export interface GuideInstallSection extends GuideCodeSection {
  tabs?: GuideTabs | undefined;
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
  /*
   * The server: started, then asked the requests below, then stopped. The
   * commands after it run once it is ready: once it listens on the run's
   * port, or once it prints readyText.
   */
  isServer?: boolean | undefined;
  // A server that listens on no port (a queue's worker) is ready once it prints this.
  readyText?: string | undefined;
  /*
   * Variables this command alone runs with, beside the run's: the web app's
   * own service name when the server is its worker, say.
   */
  environment?: Record<string, string> | undefined;
}

/*
 * A container the check starts beside the app, on a free port: the broker a
 * queue's worker reads, a database. The app finds it through appEnvironment.
 */
export interface VerificationService {
  // Its name in the check's output: "redis".
  name: string;
  image: string;
  containerPort: number;
  // Variables the container starts with.
  environment?: Record<string, string> | undefined;
  /*
   * Variables the app is given to reach it, {port} standing for the port the
   * check maps: { CELERY_BROKER_URL: "redis://127.0.0.1:{port}/0" }.
   */
  appEnvironment: Record<string, string>;
  /*
   * A line the container logs once it takes connections, and how many times:
   * PostgreSQL logs "ready to accept connections" twice on its first start,
   * once before and once after it creates its database.
   */
  readyLog?: { text: string; times: number } | undefined;
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
  // true: the span must hold an exception event; false: it must hold none.
  hasException?: boolean | undefined;
  // An exception event's message must contain this text.
  exceptionMessage?: string | undefined;
  /*
   * The span's parent must be a span of this name: the HTTP client call
   * nests under the span the code opened around it, across a coroutine's
   * or a task's threads.
   */
  parent?: string | undefined;
}

export interface ExpectedLog {
  // The record's body contains this text.
  body: string;
  // The record carries the trace and span id of the request it was written in.
  hasTraceContext: boolean;
  /*
   * true: the record carries exception.* attributes, which OneUptime files
   * under Exceptions; false: it carries none.
   */
  hasException?: boolean | undefined;
}

export interface VerificationExpectations {
  spans: Array<ExpectedSpan>;
  metrics: Array<string>;
  logs: Array<ExpectedLog>;
  // Resource attributes every batch must carry.
  resource?: Record<string, string> | undefined;
  // Request paths no span may be recorded for: the health checks left out.
  untracedPaths?: Array<string> | undefined;
  // Span names that must not arrive: what the guide's configuration turns off.
  absentSpans?: Array<string> | undefined;
  // Metric names that must not arrive: the metrics the guide leaves out.
  absentMetrics?: Array<string> | undefined;
  // Text no log record's body may contain: the lines the guide leaves out.
  absentLogs?: Array<string> | undefined;
}

/*
 * One run of the end-to-end check: the app's files, the commands that
 * install, build and start it, what it is asked, and what must arrive.
 */
export interface GuideVerificationRun {
  files: Array<VerificationFile>;
  commands: Array<VerificationCommand>;
  /*
   * For a browser guide: the folder the built app is served from. The check
   * serves it on `port` and answers GET /api/* with a small JSON body, so
   * the page has a backend to call.
   */
  serve?: string | undefined;
  /*
   * Where the app listens, for the requests below. A run whose server
   * listens on no port (a queue's worker) has none, and asks nothing.
   */
  port?: number | undefined;
  requests: Array<VerificationRequest>;
  // For a browser guide: the elements clicked once the page has loaded.
  clicks?: Array<string> | undefined;
  /*
   * A stand-in for the other services an app calls (a payment provider, a
   * billing API): the check answers any request to /api/* on this port with
   * a small JSON body - two invoices under "items" - so the app's own HTTP
   * client has somewhere to call.
   */
  stubApiPort?: number | undefined;
  // Containers the check starts before the app: a broker, a database.
  services?: Array<VerificationService> | undefined;
  /*
   * Snippets of `export NAME="value"` lines the run takes as its
   * environment, beside the Cloud tab's: a setting the page shows, such as
   * the metrics an instrumentation leaves out.
   */
  environmentSnippets?: Array<string> | undefined;
  expect: VerificationExpectations;
}

export interface GuideVerification extends GuideVerificationRun {
  /*
   * The runtime the check uses: "node", "bun", "deno", "browser"; "python"
   * (a virtual environment of the app's own, whose pip, python and scripts
   * come first on PATH), "jvm" (a JDK, with Maven and Gradle) or "dotnet".
   */
  runtime: "node" | "bun" | "deno" | "browser" | "python" | "jvm" | "dotnet";
  /*
   * The framework the app runs on, as the page names it, and the package
   * its installed version is read from: { name: "Express", package: "express" },
   * { name: "Spring Boot", package: "org.springframework.boot:spring-boot" }.
   * A runtime guide names the runtime: its version is the binary's.
   */
  framework: { name: string; package?: string | undefined };
  /*
   * The other ways the page sets the same app up, each run the same way in
   * a folder of its own: uWSGI beside gunicorn, the Spring Boot starter
   * beside the Java agent. A snippet only a variant runs is checked by it.
   */
  variants?: Array<GuideVerificationVariant> | undefined;
}

export interface GuideVerificationVariant extends GuideVerificationRun {
  // What the variant sets up, in the check's output and its record: "uWSGI".
  name: string;
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
  install: GuideInstallSection;
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
