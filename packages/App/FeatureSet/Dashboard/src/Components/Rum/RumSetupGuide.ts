import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideLink,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  codeBlock,
  resolveSetupGuideOption,
} from "../SetupGuide/SetupGuide";

/*
 * The "instrument a browser or mobile app" guide for Real User Monitoring.
 *
 * The two options differ in the one thing that matters most: the key. A
 * browser snippet ships to every visitor, so it must carry a Browser key —
 * accepted only from the origins it lists. A mobile SDK sends no Origin
 * header, so a Browser key is refused there and a mobile app has to ship a
 * Server key instead. getRumIngestionKeyType narrows the key picker to the
 * right kind for the option on screen.
 *
 * OneUptime files telemetry as RUM when its resource carries a client
 * attribute (OtelIngestBaseService.getRumClientType) — browser.* for web,
 * device.id / device.model.identifier for mobile — and names the application
 * after service.name, so both paths set exactly those.
 */

export type RumClient = "browser" | "mobile";

export const RUM_CLIENTS: Array<SetupGuideOption<RumClient>> = [
  {
    key: "browser",
    label: "Browser",
    description:
      "A web app, instrumented with the OpenTelemetry browser SDK (OpenTelemetry Web).",
  },
  {
    key: "mobile",
    label: "Mobile (iOS / Android)",
    description:
      "An iOS, Android or React Native app, instrumented with an OpenTelemetry mobile SDK.",
  },
];

export const DEFAULT_RUM_CLIENT: RumClient = "browser";

// Suggested when the guide is not set up for a known application.
export const RUM_EXAMPLE_APP_NAMES: Readonly<Record<RumClient, string>> = {
  browser: "storefront-web",
  mobile: "storefront-mobile",
};

export const RUM_BROWSER_SETUP_DOCS_URL: string = "/docs/rum/browser-setup";
export const RUM_MOBILE_SETUP_DOCS_URL: string = "/docs/rum/mobile-setup";
export const RUM_TROUBLESHOOTING_DOCS_URL: string = "/docs/rum/troubleshooting";
export const RUM_WEB_VITALS_DOCS_URL: string = "/docs/rum/web-vitals";
export const SESSION_REPLAY_DOCS_URL: string = "/docs/telemetry/session-replay";

/*
 * What the npm command installs: every package `src/telemetry.ts` imports
 * (RumSetupGuide.test.ts checks the two agree), plus `@opentelemetry/api`,
 * which the file does not import but every other package declares as a
 * peer dependency — a package manager that does not install peers would
 * otherwise leave it out.
 */
export const RUM_BROWSER_PACKAGES: ReadonlyArray<string> = [
  "@opentelemetry/api",
  "@opentelemetry/sdk-trace-web",
  "@opentelemetry/resources",
  "@opentelemetry/semantic-conventions",
  "@opentelemetry/opentelemetry-browser-detector",
  "@opentelemetry/exporter-trace-otlp-http",
  "@opentelemetry/context-zone",
  "@opentelemetry/instrumentation",
  "@opentelemetry/instrumentation-document-load",
  "@opentelemetry/instrumentation-fetch",
];

export function resolveRumClient(client: string | null | undefined): RumClient {
  return resolveSetupGuideOption(RUM_CLIENTS, client) || DEFAULT_RUM_CLIENT;
}

/*
 * The kind of key the option's snippet may carry. A browser page can only
 * be handed a Browser key; a mobile app cannot use one at all, because a
 * Browser key is checked against the Origin header and mobile SDKs send none.
 */
export function getRumIngestionKeyType(
  client: RumClient,
): TelemetryIngestionKeyType {
  return client === "mobile"
    ? TelemetryIngestionKeyType.Server
    : TelemetryIngestionKeyType.Browser;
}

/*
 * OTEL_RESOURCE_ATTRIBUTES values are percent-decoded, so a name with a
 * comma, an equals sign, a space or a percent sign only arrives as written
 * when it is percent-encoded. Ordinary names pass through unchanged.
 */
function resourceAttributeValue(value: string): string {
  return encodeURIComponent(value);
}

export interface RumSetupGuideOptions {
  oneuptimeUrl: string;
  apiKey: string;
  client: RumClient;
  /*
   * The application being set up (its Documentation tab). Omitted on the
   * product pages, where the guide suggests a name instead.
   */
  appName?: string | undefined;
}

interface RumGuideData {
  oneuptimeUrl: string;
  apiKey: string;
  client: RumClient;
  appName: string;
  isAppNameKnown: boolean;
}

function tokenCheckCommand(data: RumGuideData): string {
  return `curl -i ${data.oneuptimeUrl}/otlp/v1/validate \\
  -H "x-oneuptime-token: ${data.apiKey}"`;
}

function getAppNameNote(data: RumGuideData): string {
  if (data.isAppNameKnown) {
    /*
     * Only the mobile settings carry the name in OTEL_RESOURCE_ATTRIBUTES;
     * the browser file holds it as a string literal.
     */
    const encoding: string =
      data.client === "mobile" &&
      resourceAttributeValue(data.appName) !== data.appName
        ? " It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it."
        : "";

    return `\`service.name\` is **\`${data.appName}\`**, this application's identifier — keep it as it is, or the data registers as a new application.${encoding}`;
  }

  return `Replace \`${data.appName}\` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.`;
}

function getPlaceholderNotes(data: RumGuideData): Array<string> {
  if (data.apiKey !== SETUP_GUIDE_API_KEY_PLACEHOLDER) {
    return [];
  }

  return [
    `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`,
  ];
}

const NEVER_SHIP_A_SERVER_KEY: string = `> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.`;

const SERVICE_NAME_IS_NOT_ENOUGH: string = `> **Setting \`service.name\` alone is not enough.** The OpenTelemetry browser SDKs do not add \`browser.*\` attributes unless you enable the browser resource detector or set them yourself — without them this becomes a backend Service, not a RUM application.`;

const DEVICE_MANUFACTURER_CAVEAT: string =
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.";

const MOBILE_NEEDS_A_SERVER_KEY: string = `> **Mobile needs a Server key, and a mobile bundle can be unpacked.** A Browser key is enforced against the \`Origin\` header, which a mobile SDK does not send, so it cannot be used here. Assume the token shipped in your app will be extracted, and use the controls that do apply: pin a service name on the key so extracted copies cannot forge backend telemetry, set a requests-per-minute limit and an expiry, and rotate the key with each release train.`;

/* ------------------------------------------------------------ Browser */

export function getRumBrowserInstallCommand(): string {
  return `npm install ${RUM_BROWSER_PACKAGES.join(" \\\n  ")}`;
}

export function getRumBrowserTelemetryFile(data: {
  oneuptimeUrl: string;
  apiKey: string;
  appName: string;
}): string {
  return `// src/telemetry.ts
import { WebTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-web";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { defaultResource, detectResources, resourceFromAttributes } from "@opentelemetry/resources";
import { browserDetector } from "@opentelemetry/opentelemetry-browser-detector";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

// browserDetector supplies the browser.* attributes that make this RUM.
const resource = defaultResource()
  .merge(detectResources({ detectors: [browserDetector] }))
  .merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: ${JSON.stringify(data.appName)},
    }),
  );

const provider = new WebTracerProvider({
  resource: resource,
  spanProcessors: [
    new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: "${data.oneuptimeUrl}/otlp/v1/traces",
        // This value is public. It must be a Browser ingestion key,
        // never a Server one.
        headers: { "x-oneuptime-token": "${data.apiKey}" },
      }),
    ),
  ],
});

provider.register({ contextManager: new ZoneContextManager() });

registerInstrumentations({
  instrumentations: [
    new DocumentLoadInstrumentation(),
    // List only origins whose API allows the traceparent header.
    new FetchInstrumentation({
      propagateTraceHeaderCorsUrls: [/^https:\\/\\/api\\.example\\.com/],
    }),
  ],
});`;
}

function getBrowserPrerequisites(): Array<string> {
  return [
    "A web app whose code you can change and redeploy, with its dependencies installed through npm",
    "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it",
  ];
}

function getBrowserSteps(data: RumGuideData): Array<SetupGuideStep> {
  return [
    {
      title: "Install the OpenTelemetry packages",
      description:
        "Add the browser SDK, the OTLP exporter, the browser resource detector and the page-load and fetch instrumentations.",
      markdown: codeBlock("bash", getRumBrowserInstallCommand()),
    },
    {
      title: "Create telemetry.ts and import it first",
      description:
        "Set up tracing with your endpoint and key in src/telemetry.ts, and make it the first import of your app.",
      markdown: `${codeBlock("ts", getRumBrowserTelemetryFile(data))}

Then make it the **first** import of your app, so the instrumentations patch \`fetch\` before anything else runs:

${codeBlock(
  "ts",
  `// src/index.tsx (React), src/main.ts (Vue / Angular), etc.
import "./telemetry";
// ... the rest of your app`,
)}

${[getAppNameNote(data), SERVICE_NAME_IS_NOT_ENOUGH, ...getPlaceholderNotes(data)].join("\n\n")}`,
    },
    {
      title: "Allow OneUptime in your Content Security Policy",
      description:
        "If your site sends a Content-Security-Policy header, add OneUptime to connect-src, or the exporter's requests are blocked and nothing is reported.",
      markdown: `${codeBlock("", `connect-src 'self' ${data.oneuptimeUrl};`)}

Merge it into your existing \`connect-src\` directive. No Content Security Policy on your site? Skip this step.`,
    },
    {
      title: "Load a page and verify",
      description:
        "Check the key, then open your site and look for the application under Real User Monitoring.",
      markdown: `${codeBlock("bash", tokenCheckCommand(data))}

\`200\` with \`"valid": true\` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. \`401\` means it is unknown, revoked, disabled or expired.

Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its \`service.name\`, with page views, error rate and p95 duration.`,
    },
  ];
}

function getBrowserAdvancedTopics(data: RumGuideData): Array<SetupGuideTopic> {
  return [
    {
      title: "How OneUptime recognises a browser app",
      summary:
        "Any browser attribute plus service.name makes a RUM application; service.name alone makes a backend Service.",
      markdown: `OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of \`browser.platform\`, \`browser.language\` or a non-empty \`browser.brands\`. The application is identified by \`service.name\` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.

| Attribute | Required | What it does |
|---|---|---|
| \`service.name\` | **yes** | The application's identity, e.g. \`${RUM_EXAMPLE_APP_NAMES.browser}\`. Renaming it later creates a new application. |
| \`browser.platform\` / \`browser.language\` / \`browser.brands\` | **one of them** | Marks the telemetry as browser RUM. \`browser.platform\` also fills the **Clients** tab. |
| \`telemetry.sdk.language\` / \`telemetry.sdk.version\` | no | Shown on the overview |

\`browserDetector\` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets \`browser.language\` but not \`browser.platform\`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:

${codeBlock(
  "ts",
  `const resource = defaultResource().merge(
  resourceFromAttributes({
    [ATTR_SERVICE_NAME]: ${JSON.stringify(data.appName)},
    // Any one of these three marks the telemetry as browser RUM.
    "browser.language": navigator.language,
    "browser.platform":
      (navigator as any).userAgentData?.platform ?? "unknown",
    "browser.mobile": (navigator as any).userAgentData?.mobile ?? false,
    "user_agent.original": navigator.userAgent,
  }),
);`,
)}

Keep \`browser.platform\` coarse: every distinct value becomes a row on the **Clients** tab.`,
    },
    {
      title: "Browser ingestion keys",
      summary:
        "Why the snippet uses a Browser key, what that key can write, and why a Server key must never ship in a page.",
      markdown: `Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:

- it is accepted only from those origins, so a copied key does not work from anyone else's page;
- it can only write traces, logs, metrics and session replays — not profiles, source maps, syslog, Fluent, Pyroscope or security events;
- it is rate limited per key, can be switched off in one edit, and can be given an expiry.

An origin includes the scheme and any port, and may start with one \`*.\` host wildcard — \`https://app.example.com\`, \`https://*.example.com\`. Setting **Pinned Service Name** on the key as well forces \`service.name\` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Settings > Telemetry Ingestion Keys**.

${NEVER_SHIP_A_SERVER_KEY}`,
    },
    {
      title: "Link browser requests to your backend traces",
      summary: "Send the traceparent header only to APIs you control.",
      markdown: `\`propagateTraceHeaderCorsUrls\` decides which cross-origin requests get a W3C \`traceparent\` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.

**Do not set it to \`/.*/\`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list \`traceparent\` in its \`Access-Control-Allow-Headers\` will start failing. List only origins you control and have configured:

${codeBlock(
  "ts",
  `new FetchInstrumentation({
  propagateTraceHeaderCorsUrls: [
    /^https:\\/\\/api\\.example\\.com/,
    /^https:\\/\\/auth\\.example\\.com/,
  ],
});`,
)}

Requests made with \`XMLHttpRequest\` instead of \`fetch\` need \`@opentelemetry/instrumentation-xml-http-request\` and its \`XMLHttpRequestInstrumentation\`, with the same option.`,
    },
    {
      title: "Report uncaught errors",
      summary:
        "The browser SDK does not capture them, so report them from the window's error events.",
      markdown: `Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:

${codeBlock(
  "ts",
  `import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("app-errors");

window.addEventListener("error", (event: ErrorEvent) => {
  const span = tracer.startSpan("window.onerror");
  span.recordException(event.error ?? new Error(event.message));
  span.setStatus({ code: SpanStatusCode.ERROR });
  span.end();
});

window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
  const span = tracer.startSpan("unhandledrejection");
  span.recordException(
    event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
  );
  span.setStatus({ code: SpanStatusCode.ERROR });
  span.end();
});`,
)}`,
    },
    {
      title: "Send logs, metrics and Core Web Vitals",
      summary:
        "Extra pipelines built on the same resource, and the metrics the Core Web Vitals card reads.",
      markdown: `Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:

${codeBlock(
  "bash",
  `npm install @opentelemetry/api-logs @opentelemetry/sdk-logs \\
  @opentelemetry/exporter-logs-otlp-http \\
  @opentelemetry/sdk-metrics @opentelemetry/exporter-metrics-otlp-http`,
)}

Their exporters send to \`${data.oneuptimeUrl}/otlp/v1/logs\` and \`${data.oneuptimeUrl}/otlp/v1/metrics\` with the same \`x-oneuptime-token\` header — [Browser Setup](${RUM_BROWSER_SETUP_DOCS_URL}) has the code. Build them with the same \`resource\` object: a pipeline whose resource lacks \`browser.*\` is filed as a separate backend Service.

The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as \`web_vital.lcp\`. [Core Web Vitals](${RUM_WEB_VITALS_DOCS_URL}) lists the names OneUptime reads and wires up the \`web-vitals\` library.`,
    },
    {
      title: "Labels and owners",
      summary:
        "Tag the application from its telemetry, or with label and owner rules.",
      markdown: `Any resource attribute prefixed \`oneuptime.label.\` becomes a project label on the application — \`oneuptime.label.env\` set to \`production\` adds the label \`env:production\`:

${codeBlock(
  "ts",
  `resourceFromAttributes({
  [ATTR_SERVICE_NAME]: ${JSON.stringify(data.appName)},
  "oneuptime.label.team": "payments",
  "oneuptime.label.env": "production",
})`,
)}

Use one \`service.name\` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.

To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.`,
    },
    {
      title: "What you get",
      summary:
        "Page views, error rate and p95 duration, Core Web Vitals, clients and the telemetry tabs.",
      markdown: `- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.
- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.
- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.
- **Clients** — the browser platforms the application has been seen on, from \`browser.platform\`. Coarse by platform, never per end user.
- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](${SESSION_REPLAY_DOCS_URL}).

The application shows **Connected** while telemetry keeps arriving, and **Disconnected** after 15 minutes without any.`,
    },
  ];
}

function getBrowserTroubleshootingTopics(
  data: RumGuideData,
): Array<SetupGuideTopic> {
  return [
    {
      title: "No request to OneUptime in the browser's Network tab",
      markdown: `Open DevTools → **Network** and filter for \`otlp\`: you are looking for \`POST /otlp/v1/traces\`. No request at all means the SDK never started:

- \`telemetry.ts\` is not imported first. The instrumentations patch \`fetch\`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.
- The batch processor has not flushed yet. \`BatchSpanProcessor\` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.
- A build-time environment variable resolved to \`undefined\`, so the exporter URL is malformed. Log it once at startup.`,
    },
    {
      title: "The request is blocked or refused",
      markdown: `- **Blocked by the Content Security Policy** — the console says so. Add \`connect-src 'self' ${data.oneuptimeUrl};\` (step 4).
- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the \`x-oneuptime-token\` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.
- **\`Origin … is not allowed for this browser ingestion key\`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Settings > Telemetry Ingestion Keys**.
- **\`This telemetry ingestion key has been disabled\`** — switch the key back on there, or pick another key in step 1.
- **\`401\`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.
- **\`404\`** — the URL is wrong. The trace exporter needs the full path, \`/otlp/v1/traces\`.`,
    },
    {
      title: "The app shows up under Services instead of Real User Monitoring",
      markdown: `The resource carries no browser attribute, so the telemetry was filed as a backend Service. Enable \`browserDetector\` as in step 3, or set the \`browser.*\` attributes yourself (**How OneUptime recognises a browser app** under Advanced).

Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: \`resourceSpans[0].resource.attributes\` is the list that decides it.

The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.`,
    },
    {
      title: "The Clients tab is empty on Safari or Firefox",
      markdown:
        "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).",
    },
    {
      title: 'Core Web Vitals say "No web vitals reported yet"',
      markdown: `The card is filled only from metrics your app emits. Check, in order:

1. You have a **metrics** pipeline at all — traces alone never fill this card.
2. The metric names are ones OneUptime reads — see [Core Web Vitals](${RUM_WEB_VITALS_DOCS_URL}).
3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.
4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.`,
    },
    {
      title: "The application's tabs are empty",
      markdown: `- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.
- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.
- **Check the project.** The key decides which project the telemetry lands in.`,
    },
    {
      title: 'Status shows "Disconnected" while the app is live',
      markdown: `Status flips to **Disconnected** after 15 minutes without telemetry. If your app has traffic:

- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.
- The app may only emit on interactions nobody triggered in that window.
- The key may have been revoked after the deploy — run the key check in step 5.`,
    },
  ];
}

/* ------------------------------------------------------------- Mobile */

export function getRumMobileResourceAttributes(appName: string): string {
  return `service.name=${resourceAttributeValue(appName)},device.manufacturer=Acme,device.model.identifier=AC-100`;
}

function getMobilePrerequisites(): Array<string> {
  return [
    "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK",
    "A **Server** ingestion key — a Browser key is refused from a native app",
  ];
}

function getMobileSteps(data: RumGuideData): Array<SetupGuideStep> {
  return [
    {
      title: "Point the SDK's exporter at OneUptime",
      description:
        "Give your OpenTelemetry mobile SDK the endpoint, your key, the app's name and its device attributes.",
      markdown: `${codeBlock(
        "bash",
        `OTEL_EXPORTER_OTLP_ENDPOINT="${data.oneuptimeUrl}/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=${data.apiKey}"
OTEL_RESOURCE_ATTRIBUTES="${getRumMobileResourceAttributes(data.appName)}"`,
      )}

These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, \`x-oneuptime-token\` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](${RUM_MOBILE_SETUP_DOCS_URL}) shows it for Android, iOS and React Native.

${[
  "Most mobile SDKs set the `device.*` attributes for you — verify it, and set them explicitly as above if the application is filed under Services instead.",
  getAppNameNote(data),
  ...getPlaceholderNotes(data),
].join("\n\n")}`,
    },
    {
      title: "Launch the app and verify",
      description:
        "Check the key, then run the app and look for it under Real User Monitoring.",
      markdown: `${codeBlock("bash", tokenCheckCommand(data))}

\`200\` with \`"valid": true\` means OneUptime accepts the key; \`401\` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.

Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry. If it appears under Services instead, the \`device.*\` attributes are not reaching the resource — see Troubleshooting below.`,
    },
  ];
}

function getMobileAdvancedTopics(data: RumGuideData): Array<SetupGuideTopic> {
  return [
    {
      title: "How OneUptime recognises a mobile app",
      summary:
        "service.name plus device.id or device.model.identifier makes a mobile RUM application.",
      markdown: `OneUptime classifies telemetry as **mobile RUM** when its resource carries \`device.id\` or \`device.model.identifier\`. The application is identified by \`service.name\` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.

| Attribute | Required | What it does |
|---|---|---|
| \`service.name\` | **yes** | The application's identity, e.g. \`${RUM_EXAMPLE_APP_NAMES.mobile}\`. Renaming it later creates a new application. |
| \`device.id\` / \`device.model.identifier\` | **one of them** | Marks the telemetry as mobile RUM. \`device.model.identifier\` also fills the **Clients** tab. |
| \`telemetry.sdk.language\` / \`telemetry.sdk.version\` | no | Shown on the overview |

${DEVICE_MANUFACTURER_CAVEAT}

\`device.id\` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.`,
    },
    {
      title: "Protect the key shipped in your app",
      summary:
        "Mobile apps need a Server key, so pin a service name on it, set a limit and an expiry, and rotate it.",
      markdown: `${MOBILE_NEEDS_A_SERVER_KEY}

All three are on the key's page in **Settings > Telemetry Ingestion Keys**: **Pinned Service Name** replaces \`service.name\` on everything the key writes, **Requests Per Minute Limit** caps the key across every copy of your app, and **Expires At** stops it being accepted after a date.`,
    },
    {
      title: "SDK notes for Android, iOS and React Native",
      summary:
        "Which device attributes each SDK sets for you, and where to find its code.",
      markdown: `- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent's own resource provides \`device.model.identifier\`, \`device.manufacturer\` and an install-scoped \`device.id\`, so classification works without extra configuration. Verify it on your version: if the **Clients** tab stays empty while traces arrive, add the device attributes yourself.
- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set \`device.model.identifier\` and \`device.manufacturer\` on the resource yourself: the resource an SDK version contributes has changed between releases.
- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](${RUM_BROWSER_SETUP_DOCS_URL}) with two differences: there is no \`browserDetector\`, and you set \`device.manufacturer\` and \`device.model.identifier\` yourself so the telemetry classifies as mobile. It still sends with a **Server** key, like any mobile app.
- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries \`service.name\` plus one \`device.*\` attribute.

The mobile OpenTelemetry SDKs are pre-1.0 and their builder APIs change between releases. [Mobile Setup](${RUM_MOBILE_SETUP_DOCS_URL}) has code for each; check the method names against the version you pin.`,
    },
    {
      title: "Labels and owners",
      summary:
        "Tag the application from its telemetry, or with label and owner rules.",
      markdown: `Any resource attribute prefixed \`oneuptime.label.\` becomes a project label on the application — \`oneuptime.label.env=production\` adds the label \`env:production\`:

${codeBlock(
  "bash",
  `OTEL_RESOURCE_ATTRIBUTES="${getRumMobileResourceAttributes(data.appName)},oneuptime.label.team=payments,oneuptime.label.env=production"`,
)}

Use one \`service.name\` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.

To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.`,
    },
    {
      title: "What you get",
      summary:
        "Page views, error rate and p95 duration, device models and the telemetry tabs.",
      markdown: `- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.
- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.
- **Clients** — the device models the application has been seen on, from \`device.model.identifier\`. Coarse by model, never per end user.

The application shows **Connected** while telemetry keeps arriving, and **Disconnected** after 15 minutes without any.`,
    },
  ];
}

function getMobileTroubleshootingTopics(): Array<SetupGuideTopic> {
  return [
    {
      title: "The key check returns 401, or the key is refused",
      markdown: `A \`401\` means the key is unknown, revoked, disabled or expired: pick or create a Server key in step 1 and rebuild the app with it.

A Browser key passes the check but is refused from a mobile app, because it needs an \`Origin\` header and mobile SDKs send none. Use a **Server** key.`,
    },
    {
      title: "The app shows up under Services instead of Real User Monitoring",
      markdown: `The resource carries no \`device.id\` or \`device.model.identifier\`, so the telemetry was filed as a backend Service. Set them on the SDK's resource, as in step 2.

${DEVICE_MANUFACTURER_CAVEAT}

The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.`,
    },
    {
      title: "The Clients tab is empty",
      markdown:
        "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.",
    },
    {
      title: "The application's tabs are empty",
      markdown: `- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.
- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.
- **Check the project.** The key decides which project the telemetry lands in.`,
    },
    {
      title: 'Status shows "Disconnected" while the app is live',
      markdown: `Status flips to **Disconnected** after 15 minutes without telemetry. If your app is in use:

- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.
- The app may only emit on interactions nobody triggered in that window.
- The key may have been revoked after the release — run the key check in step 3.`,
    },
  ];
}

/* ---------------------------------------------------------------- Guide */

function getLinks(client: RumClient): Array<SetupGuideLink> {
  return [
    client === "mobile"
      ? { title: "Mobile setup", url: RUM_MOBILE_SETUP_DOCS_URL }
      : { title: "Browser setup", url: RUM_BROWSER_SETUP_DOCS_URL },
    { title: "RUM troubleshooting", url: RUM_TROUBLESHOOTING_DOCS_URL },
  ];
}

/**
 * The RUM setup guide for a browser or a mobile app, filled in with the
 * reader's OneUptime URL and ingestion key.
 */
export function getRumSetupGuide(
  options: RumSetupGuideOptions,
): SetupGuideContent {
  const client: RumClient = options.client;
  const knownAppName: string = (options.appName || "").trim();

  const data: RumGuideData = {
    oneuptimeUrl: options.oneuptimeUrl,
    apiKey: options.apiKey,
    client: client,
    appName: knownAppName || RUM_EXAMPLE_APP_NAMES[client],
    isAppNameKnown: Boolean(knownAppName),
  };

  if (client === "mobile") {
    return {
      keyStep: {
        description:
          "Mobile apps send with a Server key: a Browser key is checked against the Origin header, which mobile SDKs do not send. The key ships inside your app, so treat it as public — Advanced shows how to limit what an extracted copy can do.",
        endpointLabel: "OTLP Endpoint",
        endpointValue: `${options.oneuptimeUrl}/otlp`,
        endpointHint:
          "SDKs that take a base endpoint add /v1/traces, /v1/metrics and /v1/logs to it.",
      },
      prerequisites: getMobilePrerequisites(),
      steps: getMobileSteps(data),
      advanced: getMobileAdvancedTopics(data),
      troubleshooting: getMobileTroubleshootingTopics(),
      links: getLinks(client),
    };
  }

  return {
    keyStep: {
      description:
        "Everything in the snippet ships to your users' browsers, so this must be a Browser key: it is accepted only from the origins you list. Never put a Server key in a page — anyone who reads it can write into this project. Pick a key or create one; the snippet below updates to use it.",
      endpointLabel: "OTLP Endpoint",
      endpointValue: `${options.oneuptimeUrl}/otlp`,
      endpointHint:
        "The browser exporter takes the full URL of each signal: this address plus /v1/traces.",
    },
    prerequisites: getBrowserPrerequisites(),
    steps: getBrowserSteps(data),
    advanced: getBrowserAdvancedTopics(data),
    troubleshooting: getBrowserTroubleshootingTopics(data),
    links: getLinks(client),
  };
}
