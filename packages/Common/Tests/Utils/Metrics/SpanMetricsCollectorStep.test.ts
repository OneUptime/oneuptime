/*
 * The no-code way past Metrics AI's Missing Metrics and Missing Request
 * Metrics findings (Utils/Metrics/SpanMetricsCollectorStep): the lines an
 * OpenTelemetry Collector's config takes to record request metrics from
 * the traces passing through it. The Dashboard draws them on the finding
 * and the docs carry them (App's MetricsAiDocsFacts holds the docs to these
 * exact lines), so they are held here to what the collector reads: a
 * connector is both an exporter of one pipeline and a receiver of another,
 * the duration in seconds, delta temporality, and the names the docs'
 * collector config gives its receiver, processor and exporter.
 */

import yaml from "js-yaml";
import { slugifyMarkdownHeading } from "../../../Server/Types/MarkdownSlugify";
import {
  SEND_THROUGH_COLLECTOR_DOCS_PATH,
  SPAN_METRICS_CALLS_METRIC,
  SPAN_METRICS_COLLECTOR_STEP,
  SPAN_METRICS_CONNECTOR,
  SPAN_METRICS_DOCS_PATH,
  SPAN_METRICS_DURATION_METRIC,
  SPAN_METRICS_NAMESPACE,
  SPAN_METRICS_ONEUPTIME_EXPORTER,
  SPAN_METRICS_PROCESSOR,
  SPAN_METRICS_RECEIVER,
} from "../../../Utils/Metrics/SpanMetricsCollectorStep";
import { isRequestMetricName } from "../../../Utils/Metrics/MetricInsight";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

interface Pipeline {
  receivers: Array<string>;
  processors: Array<string>;
  exporters: Array<string>;
}

function readStep(): JSONObject {
  return yaml.load(SPAN_METRICS_COLLECTOR_STEP) as JSONObject;
}

function readPipelines(): Record<string, Pipeline> {
  return (readStep()["service"] as JSONObject)[
    "pipelines"
  ] as unknown as Record<string, Pipeline>;
}

describe("the span metrics step", () => {
  test("is YAML a collector reads: the connector, then the two pipelines", () => {
    expect(readStep()).toEqual({
      connectors: {
        spanmetrics: {
          histogram: { unit: "s" },
          aggregation_temporality: "AGGREGATION_TEMPORALITY_DELTA",
        },
      },
      service: {
        pipelines: {
          traces: {
            receivers: ["otlp"],
            processors: ["batch"],
            exporters: ["otlphttp", "spanmetrics"],
          },
          metrics: {
            receivers: ["otlp", "spanmetrics"],
            processors: ["batch"],
            exporters: ["otlphttp"],
          },
        },
      },
    });
  });

  test("the connector is an exporter of the traces pipeline and a receiver of the metrics one, nowhere else", () => {
    const pipelines: Record<string, Pipeline> = readPipelines();

    const exportsTo: Array<string> = Object.keys(pipelines).filter(
      (name: string): boolean => {
        return pipelines[name]!.exporters.includes(SPAN_METRICS_CONNECTOR);
      },
    );
    const receivesIn: Array<string> = Object.keys(pipelines).filter(
      (name: string): boolean => {
        return pipelines[name]!.receivers.includes(SPAN_METRICS_CONNECTOR);
      },
    );

    expect(exportsTo).toEqual(["traces"]);
    expect(receivesIn).toEqual(["metrics"]);
  });

  test("both pipelines keep the receiver, the processor and the exporter the OpenTelemetry docs' collector config names", () => {
    const pipelines: Record<string, Pipeline> = readPipelines();

    expect(SPAN_METRICS_RECEIVER).toBe("otlp");
    expect(SPAN_METRICS_PROCESSOR).toBe("batch");
    expect(SPAN_METRICS_ONEUPTIME_EXPORTER).toBe("otlphttp");

    for (const pipeline of Object.values(pipelines)) {
      expect(pipeline.receivers).toContain(SPAN_METRICS_RECEIVER);
      expect(pipeline.processors).toEqual([SPAN_METRICS_PROCESSOR]);
      expect(pipeline.exporters).toContain(SPAN_METRICS_ONEUPTIME_EXPORTER);
    }
  });

  test("its lines are indented by two spaces, with no tab and no trailing space", () => {
    for (const line of SPAN_METRICS_COLLECTOR_STEP.split("\n")) {
      expect(line).not.toContain("\t");
      expect(line).toBe(line.trimEnd());
      expect((line.length - line.trimStart().length) % 2).toBe(0);
    }

    expect(SPAN_METRICS_COLLECTOR_STEP.endsWith("\n")).toBe(false);
  });

  test("records the connector's own metric names, which are request metrics", () => {
    expect(SPAN_METRICS_CONNECTOR).toBe("spanmetrics");
    expect(SPAN_METRICS_NAMESPACE).toBe("traces.span.metrics");
    expect(SPAN_METRICS_CALLS_METRIC).toBe("traces.span.metrics.calls");
    expect(SPAN_METRICS_DURATION_METRIC).toBe("traces.span.metrics.duration");
    expect(isRequestMetricName(SPAN_METRICS_CALLS_METRIC)).toBe(true);
    expect(isRequestMetricName(SPAN_METRICS_DURATION_METRIC)).toBe(true);
  });

  test("names the docs' sections by their headings' own anchors", () => {
    const [page, anchor] = SPAN_METRICS_DOCS_PATH.split("#");

    expect(page).toBe("/telemetry/metrics-explorer");
    expect(anchor).toBe(
      slugifyMarkdownHeading("Record request metrics without changing code"),
    );

    const [collectorPage, collectorAnchor] =
      SEND_THROUGH_COLLECTOR_DOCS_PATH.split("#");

    expect(collectorPage).toBe("/telemetry/open-telemetry");
    expect(collectorAnchor).toBe(
      slugifyMarkdownHeading("Send through an OpenTelemetry Collector"),
    );
  });
});
