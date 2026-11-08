import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  SetupGuideContent,
  SetupGuideLink,
  codeBlock,
} from "../SetupGuide/SetupGuide";
import {
  RUM_BROWSER_SETUP_DOCS_URL,
  RUM_TROUBLESHOOTING_DOCS_URL,
  getRumErrorHandlersSnippet,
} from "./RumSetupGuide";

/*
 * "Set up exceptions" and "Set up logs" for a browser RUM application
 * (issue #5770): what an empty Exceptions or Logs chart, the application's
 * Logs page and its setup check open when the signal is not set up.
 *
 * The OpenTelemetry browser SDK reports page loads and requests on its own
 * and nothing else. Uncaught errors need a window "error" and
 * "unhandledrejection" handler that records them on a span - the trace
 * exporter the app already has sends them, so no key is asked for. Logs
 * need a log pipeline with the app's own resource (a pipeline without the
 * browser.* attributes is filed as a backend service) and code that writes
 * log records: a LoggerProvider on its own sends nothing.
 *
 * The snippets go into the src/telemetry.ts the app's setup guide made, so
 * they use its `resource`, and the log exporter carries this install's URL
 * and the Browser key picked above it. The step titles and descriptions
 * are English keys the guide card draws in the reader's language; the code
 * is code.
 *
 * Pure. The error handlers are the RUM setup guide's own
 * (getRumErrorHandlersSnippet): its "Report uncaught errors" topic shows the
 * same code, so the two can never drift apart.
 */

export type RumSignalSetupSignal = "exceptions" | "logs";

export const RUM_ERRORS_DOCS_URL: string = `${RUM_BROWSER_SETUP_DOCS_URL}#report-uncaught-errors`;
export const RUM_LOGS_DOCS_URL: string = `${RUM_BROWSER_SETUP_DOCS_URL}#add-logs-and-metrics`;
export const RUM_EMPTY_SIGNALS_DOCS_URL: string = `${RUM_TROUBLESHOOTING_DOCS_URL}#exceptions-or-logs-are-empty`;

export const RUM_LOG_PACKAGES: ReadonlyArray<string> = [
  "@opentelemetry/api-logs",
  "@opentelemetry/sdk-logs",
  "@opentelemetry/exporter-logs-otlp-http",
];

export function getRumCaughtErrorSnippet(): string {
  return `import { trace, SpanStatusCode } from "@opentelemetry/api";

try {
  await placeOrder(cart);
} catch (error) {
  const span = trace.getTracer("app-errors").startSpan("placeOrder");
  span.recordException(error as Error);
  span.setStatus({ code: SpanStatusCode.ERROR });
  span.end();
  showOrderFailedMessage();
}`;
}

export function getRumErrorTestSnippet(): string {
  return `setTimeout(() => {
  throw new Error("OneUptime test error");
});`;
}

export function getRumLogsInstallCommand(): string {
  return `npm install ${RUM_LOG_PACKAGES.join(" \\\n  ")}`;
}

export function getRumLogPipelineSnippet(data: {
  oneuptimeUrl: string;
  apiKey: string;
}): string {
  return `import { logs } from "@opentelemetry/api-logs";
import { LoggerProvider, BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";

logs.setGlobalLoggerProvider(
  new LoggerProvider({
    // The resource your traces use: its browser.* attributes file
    // these logs under this application.
    resource: resource,
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: "${data.oneuptimeUrl}/otlp/v1/logs",
          // The same Browser ingestion key as your trace exporter.
          headers: { "x-oneuptime-token": "${data.apiKey}" },
        }),
      }),
    ],
  }),
);`;
}

export function getRumLogRecordSnippet(): string {
  return `import { logs, SeverityNumber } from "@opentelemetry/api-logs";

const logger = logs.getLogger("app");

logger.emit({
  severityNumber: SeverityNumber.WARN,
  severityText: "WARN",
  body: "Payment was declined",
  attributes: { "checkout.step": "payment" },
});`;
}

function getLinks(signal: RumSignalSetupSignal): Array<SetupGuideLink> {
  return [
    {
      title: "Browser setup",
      url: signal === "exceptions" ? RUM_ERRORS_DOCS_URL : RUM_LOGS_DOCS_URL,
    },
    { title: "RUM troubleshooting", url: RUM_EMPTY_SIGNALS_DOCS_URL },
  ];
}

export function getRumSignalSetupGuide(data: {
  signal: RumSignalSetupSignal;
  oneuptimeUrl: string;
  apiKey: string;
}): SetupGuideContent {
  if (data.signal === "exceptions") {
    return {
      // The trace exporter the app already has sends them.
      needsNoKey: true,
      steps: [
        {
          title: translationKey("Add the error handlers to src/telemetry.ts"),
          description: translationKey(
            "Below the tracer provider. Each uncaught error and rejected promise is recorded on a span, which the trace exporter you already have sends.",
          ),
          markdown: codeBlock("ts", getRumErrorHandlersSnippet()),
        },
        {
          title: translationKey("Record the errors your code handles"),
          description: translationKey(
            "An error that an error boundary or a try/catch handles never reaches the window, so record it where you handle it.",
          ),
          markdown: codeBlock("ts", getRumCaughtErrorSnippet()),
        },
        {
          title: translationKey("Check that they arrive"),
          description: translationKey(
            "Deploy, open your site and run this in the browser's console. Within a minute the error is on this app's Overview, under Exceptions.",
          ),
          markdown: codeBlock("js", getRumErrorTestSnippet()),
          note: translationKey(
            "Already added the handlers? Exceptions travel with the app's traces, so while its page loads arrive, the handlers have simply caught no error yet.",
          ),
        },
      ],
      links: getLinks("exceptions"),
    };
  }

  return {
    keyStep: {
      description: translationKey(
        "The log exporter sends with this key. Use the Browser key your trace exporter already has, or pick another Browser key.",
      ),
      endpointLabel: translationKey("OTLP logs endpoint"),
      endpointValue: `${data.oneuptimeUrl}/otlp/v1/logs`,
    },
    steps: [
      {
        title: translationKey("Install the log packages"),
        description: translationKey(
          "The OpenTelemetry logs API, its SDK and the OTLP log exporter.",
        ),
        markdown: codeBlock("bash", getRumLogsInstallCommand()),
      },
      {
        title: translationKey("Add a log pipeline to src/telemetry.ts"),
        description: translationKey(
          "Below the tracer provider, with the same resource, so the logs are filed under this application rather than as a backend service.",
        ),
        markdown: codeBlock(
          "ts",
          getRumLogPipelineSnippet({
            oneuptimeUrl: data.oneuptimeUrl,
            apiKey: data.apiKey,
          }),
        ),
      },
      {
        title: translationKey("Write log records"),
        description: translationKey(
          "The pipeline sends only the records your code writes. Write one wherever something worth knowing happens.",
        ),
        markdown: codeBlock("ts", getRumLogRecordSnippet()),
      },
      {
        title: translationKey("Check that they arrive"),
        description: translationKey(
          "Deploy, then load a page that writes a record. It is on this app's Logs page within a minute, once the batch processor has exported it.",
        ),
      },
    ],
    links: getLinks("logs"),
  };
}
