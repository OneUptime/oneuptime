import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadSourceFunction = (...relativeParts: Array<string>) => string;

const readSource: ReadSourceFunction = (
  ...relativeParts: Array<string>
): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const TRACE_EXPLORER: string = readSource(
  "Components",
  "Traces",
  "TraceExplorer.tsx",
);
const SPAN_DETAILS_PANEL: string = readSource(
  "Components",
  "Traces",
  "SpanDetailsPanel.tsx",
);

/*
 * The lazy correlated-signal fetches (Trace Explorer's Metrics tab, the span
 * panel's Logs and Exceptions tabs) must never list their own loading flag as
 * a dependency of the effect that sets it: setLoading(true) inside the effect
 * body re-runs the effect, which first runs the previous run's cleanup and
 * deterministically cancels the in-flight request — leaving the tab on a
 * permanent spinner with every retry blocked by the stuck loading guard.
 *
 * The corrected shape pinned here is the TraceScopedFlamegraph generation
 * counter: a ref bumped only when the tab/trace/span actually changes (or the
 * component unmounts), loading-free dependency arrays, and finally blocks
 * that always clear the loading flag for the current generation.
 */

describe("trace explorer metrics tab lazy fetch", () => {
  test("the effect neither guards on nor depends on its own loading flag", () => {
    expect(TRACE_EXPLORER).toContain(
      'if (activeSignalTab !== "metrics" || metricsFetched) { return; }',
    );
    expect(TRACE_EXPLORER).not.toContain("metricsFetched || metricsLoading");
    expect(TRACE_EXPLORER).not.toContain(
      "[activeSignalTab, metricsFetched, metricsLoading, traceIdFromUrl]",
    );
  });

  test("cancellation is a generation counter bumped only on tab/trace change or unmount", () => {
    expect(TRACE_EXPLORER).toContain(
      "const metricsLoadGenerationRef: React.MutableRefObject<number> = React.useRef<number>(0);",
    );
    expect(TRACE_EXPLORER).toContain(
      "metricsLoadGenerationRef.current += 1; const generation: number = metricsLoadGenerationRef.current;",
    );
    expect(TRACE_EXPLORER).toContain(
      "if (generation !== metricsLoadGenerationRef.current) { return; }",
    );
    expect(TRACE_EXPLORER).toContain(
      "return () => { metricsLoadGenerationRef.current += 1; }; }, [activeSignalTab, metricsFetched, traceIdFromUrl]);",
    );
  });

  test("a settled fetch always clears the spinner and marks the tab fetched", () => {
    expect(TRACE_EXPLORER).toContain(
      "} finally { if (generation === metricsLoadGenerationRef.current) { setMetricsLoading(false); setMetricsFetched(true); } }",
    );
  });

  test("failures surface an error message instead of spinning", () => {
    expect(TRACE_EXPLORER).toContain(
      "setMetricsError(API.getFriendlyMessage(err));",
    );
    expect(TRACE_EXPLORER).toContain("<ErrorMessage message={metricsError} />");
  });
});

describe("span panel logs tab lazy fetch", () => {
  test("the effect neither guards on nor depends on its own loading flag", () => {
    expect(SPAN_DETAILS_PANEL).toContain(
      'if (activeTab !== "logs" || logsFetched) { return; }',
    );
    expect(SPAN_DETAILS_PANEL).not.toContain("logsFetched || logsLoading");
    expect(SPAN_DETAILS_PANEL).not.toContain(
      "[activeTab, logsFetched, logsLoading, spanIdStr, traceIdStr]",
    );
  });

  test("cancellation is a generation counter bumped only on tab/span change or unmount", () => {
    expect(SPAN_DETAILS_PANEL).toContain(
      "const logsLoadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);",
    );
    expect(SPAN_DETAILS_PANEL).toContain(
      "logsLoadGenerationRef.current += 1; const generation: number = logsLoadGenerationRef.current;",
    );
    expect(SPAN_DETAILS_PANEL).toContain(
      "if (generation === logsLoadGenerationRef.current) { setRelatedLogs(rows); setLogsScope(scope); }",
    );
    expect(SPAN_DETAILS_PANEL).toContain(
      "return () => { logsLoadGenerationRef.current += 1; }; }, [activeTab, logsFetched, spanIdStr, traceIdStr]);",
    );
  });

  test("a settled fetch always clears the spinner and marks the tab fetched", () => {
    expect(SPAN_DETAILS_PANEL).toContain(
      "} finally { if (generation === logsLoadGenerationRef.current) { setLogsLoading(false); setLogsFetched(true); } }",
    );
  });
});

describe("span panel exceptions tab lazy fetch", () => {
  test("the effect neither guards on nor depends on its own loading flag", () => {
    expect(SPAN_DETAILS_PANEL).toContain(
      'if (activeTab !== "exceptions" || exceptionsFetched) { return; }',
    );
    expect(SPAN_DETAILS_PANEL).not.toContain(
      "exceptionsFetched || exceptionsLoading",
    );
    expect(SPAN_DETAILS_PANEL).not.toContain(
      "[activeTab, exceptionsFetched, exceptionsLoading, spanIdStr]",
    );
  });

  test("cancellation is a generation counter bumped only on tab/span change or unmount", () => {
    expect(SPAN_DETAILS_PANEL).toContain(
      "const exceptionsLoadGenerationRef: React.MutableRefObject<number> = useRef<number>(0);",
    );
    expect(SPAN_DETAILS_PANEL).toContain(
      "exceptionsLoadGenerationRef.current += 1; const generation: number = exceptionsLoadGenerationRef.current;",
    );
    expect(SPAN_DETAILS_PANEL).toContain(
      "if (generation === exceptionsLoadGenerationRef.current) { setExceptionInstances(result.data); }",
    );
    expect(SPAN_DETAILS_PANEL).toContain(
      "return () => { exceptionsLoadGenerationRef.current += 1; }; }, [activeTab, exceptionsFetched, spanIdStr]);",
    );
  });

  test("a settled fetch always clears the spinner and marks the tab fetched", () => {
    expect(SPAN_DETAILS_PANEL).toContain(
      "} finally { if (generation === exceptionsLoadGenerationRef.current) { setExceptionsLoading(false); setExceptionsFetched(true); } }",
    );
  });
});

describe("span panel row-change reset", () => {
  test("expanding a different row clears loading flags along with fetched state", () => {
    expect(SPAN_DETAILS_PANEL).toContain(
      "setLogsLoading(false); setLogsFetched(false);",
    );
    expect(SPAN_DETAILS_PANEL).toContain(
      "setExceptionsLoading(false); setExceptionsFetched(false);",
    );
  });
});
