import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  RUM_EMPTY_SIGNALS_DOCS_URL,
  RUM_ERRORS_DOCS_URL,
  RUM_LOGS_DOCS_URL,
  RUM_LOG_PACKAGES,
  getRumCaughtErrorSnippet,
  getRumErrorTestSnippet,
  getRumLogPipelineSnippet,
  getRumLogRecordSnippet,
  getRumLogsInstallCommand,
  getRumSignalSetupGuide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/RumSignalSetupGuide";
import {
  RUM_BROWSER_SETUP_DOCS_URL,
  RUM_TROUBLESHOOTING_DOCS_URL,
  getRumBrowserTelemetryFile,
  getRumErrorHandlersSnippet,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/RumSetupGuide";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideStep,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";

/*
 * "Set up exceptions" and "Set up logs" (issue #5770): what an empty
 * Exceptions or Logs chart opens for a browser app whose signal never
 * arrived. Each is a few lines added to the src/telemetry.ts the RUM setup
 * guide wrote, so they build on its tracer and its resource:
 *
 *   - exceptions travel with the traces the app already sends, so the
 *     dialog asks for no key and adds the guide's own error handlers;
 *   - logs need their own pipeline, with this install's OTLP logs endpoint,
 *     the Browser key the reader picks and the app's resource, and code
 *     that writes records.
 */

const URL: string = "https://oneuptime.example.com";
const KEY: string = "tik_browser_secret";

const DASHBOARD_LOCALE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales/en.json",
);

function guide(signal: "exceptions" | "logs"): SetupGuideContent {
  return getRumSignalSetupGuide({ signal, oneuptimeUrl: URL, apiKey: KEY });
}

function titles(content: SetupGuideContent): Array<string> {
  return content.steps.map((step: SetupGuideStep): string => {
    return step.title;
  });
}

// Every word a reader of the dialog sees outside its code.
function words(content: SetupGuideContent): Array<string> {
  return [
    ...content.steps.flatMap((step: SetupGuideStep): Array<string> => {
      return [step.title, step.description || "", step.note || ""].filter(
        Boolean,
      );
    }),
    ...(content.keyStep
      ? [content.keyStep.description || "", content.keyStep.endpointLabel || ""]
      : []),
    ...(content.links || []).map((link: { title: string }): string => {
      return link.title;
    }),
  ].filter(Boolean);
}

describe("Set up exceptions", () => {
  test("asks for no key: the trace exporter the app already has sends them", () => {
    const content: SetupGuideContent = guide("exceptions");

    expect(content.needsNoKey).toBe(true);
    expect(content.keyStep).toBeUndefined();
    expect(JSON.stringify(content)).not.toContain(KEY);
    expect(JSON.stringify(content)).not.toContain(
      SETUP_GUIDE_API_KEY_PLACEHOLDER,
    );
  });

  test("adds the guide's own error handlers, then the handled errors, then a test error", () => {
    const content: SetupGuideContent = guide("exceptions");

    expect(titles(content)).toEqual([
      "Add the error handlers to src/telemetry.ts",
      "Record the errors your code handles",
      "Check that they arrive",
    ]);
    expect(content.steps[0]!.markdown).toContain(getRumErrorHandlersSnippet());
    expect(content.steps[1]!.markdown).toContain(getRumCaughtErrorSnippet());
    expect(content.steps[2]!.markdown).toContain(getRumErrorTestSnippet());
    // Ruling out "handlers added, nothing thrown yet".
    expect(content.steps[2]!.note).toContain("caught no error yet");
  });

  test("the handlers record each uncaught error and rejected promise on a span", () => {
    const handlers: string = getRumErrorHandlersSnippet();

    expect(handlers).toContain('window.addEventListener("error"');
    expect(handlers).toContain('window.addEventListener("unhandledrejection"');
    expect(handlers.match(/span\.recordException\(/g)).toHaveLength(2);
    expect(handlers.match(/span\.end\(\);/g)).toHaveLength(2);
  });

  test("the test error is thrown outside the console's own evaluation, so the handler sees it", () => {
    // An error thrown straight from the console never reaches window.onerror.
    expect(getRumErrorTestSnippet()).toBe(
      'setTimeout(() => {\n  throw new Error("OneUptime test error");\n});',
    );
  });

  test("links to Browser Setup's errors section and the troubleshooting section", () => {
    expect(guide("exceptions").links).toEqual([
      { title: "Browser setup", url: RUM_ERRORS_DOCS_URL },
      { title: "RUM troubleshooting", url: RUM_EMPTY_SIGNALS_DOCS_URL },
    ]);
    expect(RUM_ERRORS_DOCS_URL).toBe(
      `${RUM_BROWSER_SETUP_DOCS_URL}#report-uncaught-errors`,
    );
    expect(RUM_EMPTY_SIGNALS_DOCS_URL).toBe(
      `${RUM_TROUBLESHOOTING_DOCS_URL}#exceptions-or-logs-are-empty`,
    );
  });
});

describe("Set up logs", () => {
  test("asks for a key, for this install's OTLP logs endpoint", () => {
    const content: SetupGuideContent = guide("logs");

    expect(content.needsNoKey).toBeFalsy();
    expect(content.keyStep?.endpointLabel).toBe("OTLP logs endpoint");
    expect(content.keyStep?.endpointValue).toBe(`${URL}/otlp/v1/logs`);
  });

  test("installs the packages, adds the pipeline, writes records, then checks", () => {
    const content: SetupGuideContent = guide("logs");

    expect(titles(content)).toEqual([
      "Install the log packages",
      "Add a log pipeline to src/telemetry.ts",
      "Write log records",
      "Check that they arrive",
    ]);
    expect(content.steps[0]!.markdown).toContain(getRumLogsInstallCommand());
    expect(content.steps[2]!.markdown).toContain(getRumLogRecordSnippet());
  });

  test("the install command names each log package on a line of its own", () => {
    expect(getRumLogsInstallCommand()).toBe(
      `npm install ${RUM_LOG_PACKAGES.join(" \\\n  ")}`,
    );
    expect(RUM_LOG_PACKAGES).toEqual([
      "@opentelemetry/api-logs",
      "@opentelemetry/sdk-logs",
      "@opentelemetry/exporter-logs-otlp-http",
    ]);
  });

  test("the pipeline sends to this install with the picked key, under the app's own resource", () => {
    const pipeline: string = guide("logs").steps[1]!.markdown || "";

    expect(pipeline).toContain(
      getRumLogPipelineSnippet({ oneuptimeUrl: URL, apiKey: KEY }),
    );
    expect(pipeline).toContain(`url: "${URL}/otlp/v1/logs"`);
    expect(pipeline).toContain(`headers: { "x-oneuptime-token": "${KEY}" }`);
    // The guide's telemetry file defines it: its browser.* attributes make RUM.
    expect(pipeline).toContain("resource: resource,");
    expect(
      getRumBrowserTelemetryFile({
        oneuptimeUrl: URL,
        apiKey: KEY,
        appName: "storefront-web",
      }),
    ).toContain("const resource = ");
  });

  test("the pipeline uses the options-object processor of the SDK the install command fetches", () => {
    const pipeline: string = getRumLogPipelineSnippet({
      oneuptimeUrl: URL,
      apiKey: KEY,
    });

    // sdk-logs takes { exporter }, and the provider takes its processors.
    expect(pipeline).toContain("new BatchLogRecordProcessor({");
    expect(pipeline).toContain("exporter: new OTLPLogExporter({");
    expect(pipeline).toContain("processors: [");
    expect(pipeline).toContain("logs.setGlobalLoggerProvider(");
  });

  test("a record is written through the global provider the pipeline set", () => {
    const record: string = getRumLogRecordSnippet();

    expect(record).toContain('const logger = logs.getLogger("app");');
    expect(record).toContain("logger.emit({");
    expect(record).toContain("severityNumber: SeverityNumber.WARN,");
  });

  test("links to Browser Setup's logs section and the troubleshooting section", () => {
    expect(guide("logs").links).toEqual([
      { title: "Browser setup", url: RUM_LOGS_DOCS_URL },
      { title: "RUM troubleshooting", url: RUM_EMPTY_SIGNALS_DOCS_URL },
    ]);
    expect(RUM_LOGS_DOCS_URL).toBe(
      `${RUM_BROWSER_SETUP_DOCS_URL}#add-logs-and-metrics`,
    );
  });
});

describe("both dialogs", () => {
  test("draw only words the Dashboard's English locale has, so every language can word them", () => {
    const english: Record<string, unknown> = JSON.parse(
      fs.readFileSync(DASHBOARD_LOCALE, "utf8"),
    ) as Record<string, unknown>;

    const missing: Array<string> = [
      ...words(guide("exceptions")),
      ...words(guide("logs")),
    ].filter((word: string): boolean => {
      return !(word in english);
    });

    expect(missing).toEqual([]);
  });

  test("hold no URL or key but the ones they were given", () => {
    const other: SetupGuideContent = getRumSignalSetupGuide({
      signal: "logs",
      oneuptimeUrl: "https://oneuptime.internal.example.org",
      apiKey: "tik_other_key",
    });
    const text: string = JSON.stringify(other);

    expect(text).not.toContain(URL);
    expect(text).not.toContain(KEY);
    expect(text).toContain(
      "https://oneuptime.internal.example.org/otlp/v1/logs",
    );
    expect(text).toContain("tik_other_key");
  });
});
