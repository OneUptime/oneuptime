import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  CHART_README,
  CHART_SCHEMA,
  CHART_VALUES,
  PACKAGES_ROOT,
  REPOSITORY_ROOT,
  getHeadings,
  getSection,
  read,
  relative,
} from "./KubernetesAiAgentDocsSupport";
import {
  METRIC_INSIGHT_REQUEST_METRIC_PREFIXES,
  isRequestMetricName,
} from "Common/Utils/Metrics/MetricInsight";
import {
  SPAN_METRICS_CALLS_METRIC,
  SPAN_METRICS_COLLECTOR_STEP,
  SPAN_METRICS_DURATION_METRIC,
  SPAN_METRICS_NAMESPACE,
} from "Common/Utils/Metrics/SpanMetricsCollectorStep";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The kubernetes-agent chart's ebpf.features.spanMetrics asks OBI for
 * `application_span_otel` instead of the deprecated `application_span`
 * (tests/ebpf-span-metrics_test.yaml in the chart pins the render). Both
 * count the same spans; only the names differ:
 *
 *   traces_spanmetrics_calls_total -> traces.span.metrics.calls
 *   traces_spanmetrics_latency     -> traces.span.metrics.duration (unit s)
 *
 * A dashboard or metric monitor on an old name goes quiet after the upgrade
 * without an error, so every copy an operator reads names the new metrics,
 * and each upgrade section maps the old names to them: the chart README,
 * values.yaml, values.schema.json, both Kubernetes agent docs pages in every
 * docs language, and the Dashboard's in-app guide. No copy may promise
 * request or response sizes, which this feature never sent.
 *
 * The README's upgrade note also says what in OneUptime reads these metrics:
 * Metrics AI alone, which counts them under the old names and the new as a
 * service's request metrics, so the upgrade changes nothing there. The last
 * tests keep that true.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const DASHBOARD_GUIDE: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/DocumentationMarkdown.ts",
);

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

const OLD_CALLS: string = "traces_spanmetrics_calls_total";
const OLD_LATENCY: string = "traces_spanmetrics_latency";
const NEW_CALLS: string = "traces.span.metrics.calls";
const NEW_DURATION: string = "traces.span.metrics.duration";

// Each page, and the first cell of its spanMetrics row.
const PAGES: Array<{ page: string; key: string }> = [
  { page: "monitor/kubernetes-agent.md", key: "ebpf.features.spanMetrics" },
  { page: "telemetry/kubernetes-agent.md", key: "spanMetrics" },
];

type RowsFunction = (markdown: string, key: string) => Array<string>;

// The table rows whose first cell is `key`.
const rowsOf: RowsFunction = (markdown: string, key: string): Array<string> => {
  return markdown.split("\n").filter((line: string): boolean => {
    return line.replace(/\s+/g, " ").startsWith(`| \`${key}\` |`);
  });
};

type NotesFunction = (markdown: string) => Array<string>;

// The blockquote lines that name both old metrics and both new ones.
const renameNotesOf: NotesFunction = (markdown: string): Array<string> => {
  return markdown.split("\n").filter((line: string): boolean => {
    return (
      line.startsWith(">") &&
      [OLD_CALLS, OLD_LATENCY, NEW_CALLS, NEW_DURATION].every(
        (name: string): boolean => {
          return line.includes(`\`${name}\``);
        },
      )
    );
  });
};

type HeadingFunction = (markdown: string, line: string) => string;

// The `## ` heading a line sits under.
const h2Above: HeadingFunction = (markdown: string, line: string): string => {
  const before: string = markdown.slice(0, markdown.indexOf(line));

  return getHeadings(before)
    .filter((heading: string): boolean => {
      return heading.startsWith("## ");
    })
    .pop()!;
};

type NextLineFunction = (markdown: string, line: string) => string;

// The first non-blank line after `line`.
const lineAfter: NextLineFunction = (
  markdown: string,
  line: string,
): string => {
  return markdown
    .slice(markdown.indexOf(line) + line.length)
    .split("\n")
    .find((next: string): boolean => {
      return next.trim() !== "";
    })!;
};

/*
 * The last line of the plain upgrade command. Other sections pass
 * --reset-then-reuse-values along with a --set, so only the upgrade section
 * has it on a line of its own.
 */
const UPGRADE_COMMAND_END: RegExp = /^ *--reset-then-reuse-values$/m;

describe("kubernetes-agent docs: eBPF span metrics under their new names", () => {
  test("every docs language is checked", () => {
    expect(LANGUAGES.length).toBe(17);
    expect(LANGUAGES).toContain("en");
  });

  for (const { page, key } of PAGES) {
    test.each(LANGUAGES)(
      `%s ${page}: the spanMetrics row names the new metrics`,
      (language: string) => {
        const rows: Array<string> = rowsOf(
          read(path.join(CONTENT_DIR, language, page)),
          key,
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]).toContain("`traces.span.metrics.");
        expect(rows[0]).not.toContain(OLD_CALLS);
      },
    );

    test.each(LANGUAGES)(
      `%s ${page}: one note in the upgrade section maps the old names to the new`,
      (language: string) => {
        const markdown: string = read(path.join(CONTENT_DIR, language, page));
        const notes: Array<string> = renameNotesOf(markdown);

        expect(notes).toHaveLength(1);
        // The section the note is in is the one with the upgrade command,
        expect(getSection(markdown, h2Above(markdown, notes[0]!))).toMatch(
          UPGRADE_COMMAND_END,
        );
        // after everything that section says about the command.
        expect(lineAfter(markdown, notes[0]!)).toMatch(/^#/);
        expect(notes[0]).toContain("`filters.metrics`");
        // And the old names appear nowhere else on the page.
        expect(markdown.split(OLD_CALLS)).toHaveLength(2);
        expect(markdown.split(OLD_LATENCY)).toHaveLength(2);
      },
    );
  }

  test("the English pages describe the rows without sizes", () => {
    for (const { page, key } of PAGES) {
      const row: string = rowsOf(
        read(path.join(CONTENT_DIR, "en", page)),
        key,
      )[0]!;

      expect({ page, row }).toEqual({
        page,
        row: expect.not.stringMatching(/size/i),
      });
    }
  });

  test("the Dashboard's in-app guide names the new metrics in its spanMetrics row", () => {
    const rows: Array<string> = read(DASHBOARD_GUIDE)
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("| \\`spanMetrics\\` |");
      });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("traces.span.metrics.");
    expect(rows[0]).not.toMatch(/size/i);
  });
});

describe("kubernetes-agent chart copy: eBPF span metrics under their new names", () => {
  test("values.yaml maps spanMetrics to application_span_otel and names its metrics", () => {
    const values: string = read(CHART_VALUES);
    const comment: string = values.slice(
      values.indexOf("    httpMetrics: true"),
      values.indexOf("    spanMetrics: true"),
    );

    expect(comment).toContain("Maps to feature: `application_span_otel`.");
    expect(comment).toContain(`\`${NEW_CALLS}\``);
    expect(comment).toContain(`\`${NEW_DURATION}\``);
    expect(comment).not.toMatch(/size/i);
  });

  test("values.schema.json describes spanMetrics as application_span_otel", () => {
    const description: string = JSON.parse(read(CHART_SCHEMA)).properties.ebpf
      .properties.features.properties.spanMetrics.description;

    expect(description).toContain("OBI `application_span_otel`");
    expect(description).toContain(`\`${NEW_CALLS}\``);
    expect(description).toContain(`\`${NEW_DURATION}\``);
    expect(description).not.toMatch(/size/i);
  });

  test("the README's spanMetrics row names the new metrics and no sizes", () => {
    const rows: Array<string> = rowsOf(
      read(CHART_README),
      "ebpf.features.spanMetrics",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(`\`${NEW_CALLS}\``);
    expect(rows[0]).toContain(`\`${NEW_DURATION}\``);
    expect(rows[0]).not.toMatch(/size/i);
  });

  test("the README's Upgrading section maps each old name to its new one and corrects the sizes claim", () => {
    const upgrading: string = getSection(read(CHART_README), "## Upgrading");
    const tableRows: Array<string> = upgrading
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("> | `traces");
      });

    // `| old name (kind) | new name (kind) |`, one row per metric.
    expect(
      tableRows.map((row: string): Array<string> => {
        return Array.from(row.matchAll(/\| `([^`]+)`/g)).map(
          (match: RegExpMatchArray): string => {
            return match[1]!;
          },
        );
      }),
    ).toEqual([
      [OLD_CALLS, NEW_CALLS],
      [OLD_LATENCY, NEW_DURATION],
    ]);
    expect(upgrading).toContain("`application_span_otel`");
    expect(upgrading).toContain("`application_span_sizes`");
    // Kept true by the last tests in this file.
    expect(upgrading).toContain(
      "Within OneUptime, only Metrics AI reads these metrics: it counts them, under any of these names, as a service's request metrics, so the upgrade does not make it report **Missing Request Metrics**. OneUptime's pages and the service map do not read them.",
    );
    expect(upgrading).not.toContain("do not read these metrics");
  });
});

/*
 * Product code reads a span-metrics family in one place: Metrics AI's
 * request metrics (Common/Utils/Metrics/MetricInsight). A service that sends
 * the series - under the new names, the old ones, or the ones OBI before
 * v0.11 used - records its request metrics, so Metrics AI files no Missing
 * Request Metrics for it, before the upgrade or after: the rename changes
 * nothing there, as the README's upgrade note says. Metrics AI's collector
 * step (Common/Utils/Metrics/SpanMetricsCollectorStep) names what the
 * collector's span metrics connector records - its default namespace,
 * traces.span.metrics, which OBI's application_span_otel uses too - and the
 * Dashboard draws those names in the step's sentences: neither reads a
 * metric. Anything else that starts naming one, or reads these names for
 * something more, fails here: it has to follow the rename, and the upgrade
 * notes have to say what the rename does to it.
 */
describe("OneUptime reads the eBPF span-metrics families only as Metrics AI's request metrics", () => {
  const SCAN_DIRS: Array<string> = [
    path.join(PACKAGES_ROOT, "App", "FeatureSet"),
    path.join(PACKAGES_ROOT, "Common", "Models"),
    path.join(PACKAGES_ROOT, "Common", "Server"),
    path.join(PACKAGES_ROOT, "Common", "Types"),
    path.join(PACKAGES_ROOT, "Common", "UI"),
    path.join(PACKAGES_ROOT, "Common", "Utils"),
    // Absent in the App Test job, which deletes ee/ before it runs.
    path.join(REPOSITORY_ROOT, "ee"),
  ];

  const SKIPPED_DIRECTORIES: Array<string> = [
    "node_modules",
    "build",
    "dist",
    "Tests",
  ];

  const SOURCE_EXTENSIONS: Array<string> = [".ts", ".tsx", ".js", ".mjs"];

  // Every form of the families' names, the namespace on its own included.
  const SPAN_METRICS_NAME: RegExp = /traces[._]span[._]?metrics/i;

  const METRIC_INSIGHT: string = path.join(
    PACKAGES_ROOT,
    "Common/Utils/Metrics/MetricInsight.ts",
  );
  const COLLECTOR_STEP: string = path.join(
    PACKAGES_ROOT,
    "Common/Utils/Metrics/SpanMetricsCollectorStep.ts",
  );
  const METRIC_PROBLEM_DETECTOR: string = path.join(
    PACKAGES_ROOT,
    "Common/Server/Utils/AI/SRE/Insights/Detectors/MetricProblemDetector.ts",
  );
  const STEP_PANEL: string = path.join(
    PACKAGES_ROOT,
    "App/FeatureSet/Dashboard/src/Components/TelemetryAi/SpanMetricsStepPanel.tsx",
  );
  const STEP_COPY: string = path.join(
    PACKAGES_ROOT,
    "App/FeatureSet/Dashboard/src/Components/TelemetryAi/SpanMetricsStepCopy.ts",
  );

  // What Metrics AI reads the families through, and what draws their names.
  const READER_NAMES: Array<string> = [
    "METRIC_INSIGHT_REQUEST_METRIC_PREFIXES",
    "isRequestMetricName",
    "SPAN_METRICS_NAMESPACE",
    "SPAN_METRICS_CALLS_METRIC",
    "SPAN_METRICS_DURATION_METRIC",
  ];

  // Every name the chart's spanMetrics has sent the series under (README).
  const CHART_SERIES_NAMES: Array<string> = [
    OLD_CALLS,
    OLD_LATENCY,
    NEW_CALLS,
    NEW_DURATION,
    // OBI before v0.11.
    "traces_span_metrics_calls_total",
    "traces_span_metrics_duration",
  ];

  function listSourceFiles(directory: string): Array<string> {
    const files: Array<string> = [];

    if (!fs.existsSync(directory)) {
      return files;
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
          files.push(...listSourceFiles(fullPath));
        }
      } else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }

    return files;
  }

  let sources: Map<string, string> | null = null;

  /*
   * The product's sources that name a span-metrics family or one of the
   * reader names, by path, with their text: each source is read once. The
   * in-app guide is left out: it documents the metrics, and reads nothing.
   */
  function namingSources(): Map<string, string> {
    if (sources) {
      return sources;
    }

    sources = new Map<string, string>();

    for (const file of SCAN_DIRS.flatMap(listSourceFiles)) {
      if (file === DASHBOARD_GUIDE) {
        continue;
      }

      const text: string = read(file);

      if (
        SPAN_METRICS_NAME.test(text) ||
        READER_NAMES.some((name: string): boolean => {
          return text.includes(name);
        })
      ) {
        sources.set(file, text);
      }
    }

    return sources;
  }

  // A source's code: its comments removed (a comment reads nothing).
  function codeOf(text: string): string {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|\s)\/\/.*$/gm, " ")
      .replace(/\s+/g, " ");
  }

  // The same with no whitespace left, so Prettier can reflow it freely.
  function denseCodeOf(file: string): string {
    return codeOf(read(file)).replace(/\s+/g, "");
  }

  type TextFunction = (text: string) => string;

  // The sources whose text matches, as repository paths, sorted.
  function sourcesMatching(
    pattern: RegExp,
    textOf: TextFunction = (text: string): string => {
      return text;
    },
  ): Array<string> {
    return Array.from(namingSources().entries())
      .filter(([, text]: [string, string]): boolean => {
        return pattern.test(textOf(text));
      })
      .map(([file]: [string, string]): string => {
        return relative(file);
      })
      .sort();
  }

  function repositoryPaths(files: Array<string>): Array<string> {
    return files.map(relative).sort();
  }

  type CountFunction = (text: string, part: string) => number;

  const countOf: CountFunction = (text: string, part: string): number => {
    return text.split(part).length - 1;
  };

  test("are named only by Metrics AI's request metrics and its collector step, comments included", () => {
    expect(sourcesMatching(SPAN_METRICS_NAME)).toEqual(
      repositoryPaths([METRIC_INSIGHT, COLLECTOR_STEP, STEP_PANEL]),
    );
  });

  test("are named in code only as request-metric prefixes and as the connector's namespace", () => {
    expect(sourcesMatching(SPAN_METRICS_NAME, codeOf)).toEqual(
      repositoryPaths([METRIC_INSIGHT, COLLECTOR_STEP]),
    );

    /*
     * The collector step, once: the connector's namespace, which the step's
     * lines leave at its default.
     */
    const step: string = codeOf(read(COLLECTOR_STEP));

    expect(step.match(new RegExp(SPAN_METRICS_NAME.source, "gi"))).toEqual([
      SPAN_METRICS_NAMESPACE,
    ]);
    expect(denseCodeOf(COLLECTOR_STEP)).toContain(
      'exportconstSPAN_METRICS_NAMESPACE:string="traces.span.metrics";',
    );
    expect(SPAN_METRICS_COLLECTOR_STEP).not.toContain("namespace");

    // Metric insights: only in the names a request metric goes by.
    const insight: string = denseCodeOf(METRIC_INSIGHT);
    const listStart: string =
      "exportconstMETRIC_INSIGHT_REQUEST_METRIC_PREFIXES:ReadonlyArray<string>=[";
    const listAt: number = insight.indexOf(listStart);
    const listEnd: number = insight.indexOf("];", listAt);

    expect(listAt).toBeGreaterThan(-1);
    expect(listEnd).toBeGreaterThan(listAt);
    expect(
      SPAN_METRICS_NAME.test(insight.slice(0, listAt) + insight.slice(listEnd)),
    ).toBe(false);
  });

  test("count the series under every name the chart has sent it as a service's request metrics, so the upgrade changes nothing there", () => {
    // The new names, through Prometheus too, and the old ones.
    expect(
      METRIC_INSIGHT_REQUEST_METRIC_PREFIXES.filter(
        (prefix: string): boolean => {
          return SPAN_METRICS_NAME.test(prefix);
        },
      ),
    ).toEqual([
      "traces.span.metrics.",
      "traces_span_metrics_",
      "traces.spanmetrics.",
      "traces_spanmetrics_",
    ]);

    // What OBI's application_span_otel and the collector's connector record.
    expect(SPAN_METRICS_NAMESPACE).toBe("traces.span.metrics");
    expect([SPAN_METRICS_CALLS_METRIC, SPAN_METRICS_DURATION_METRIC]).toEqual([
      NEW_CALLS,
      NEW_DURATION,
    ]);

    for (const name of CHART_SERIES_NAMES) {
      expect({ name, requestMetric: isRequestMetricName(name) }).toEqual({
        name,
        requestMetric: true,
      });
    }
  });

  test("read them for nothing else: the prefixes only tell a request metric, and the connector's names are only drawn", () => {
    function users(name: string): Array<string> {
      return sourcesMatching(new RegExp(`\\b${name}\\b`), codeOf);
    }

    /*
     * The names a request metric goes by: the check of a service's metrics
     * in the hour, and the metric catalog's question whether it ever sent
     * one. Nothing charts, counts or alerts on them.
     */
    expect(users("METRIC_INSIGHT_REQUEST_METRIC_PREFIXES")).toEqual(
      repositoryPaths([METRIC_INSIGHT, METRIC_PROBLEM_DETECTOR]),
    );
    expect(users("isRequestMetricName")).toEqual(
      repositoryPaths([METRIC_INSIGHT]),
    );

    const insight: string = denseCodeOf(METRIC_INSIGHT);
    const detector: string = denseCodeOf(METRIC_PROBLEM_DETECTOR);

    expect(countOf(insight, "METRIC_INSIGHT_REQUEST_METRIC_PREFIXES")).toBe(2);
    expect(insight).toContain(
      "METRIC_INSIGHT_REQUEST_METRIC_PREFIXES.some((prefix:string):boolean=>{returnlowered.startsWith(prefix);})",
    );
    expect(countOf(insight, "isRequestMetricName(")).toBe(2);
    expect(insight).toContain("returnisRequestMetricName(reading.metricName);");
    expect(countOf(detector, "METRIC_INSIGHT_REQUEST_METRIC_PREFIXES")).toBe(2);
    expect(detector).toContain(
      "name:QueryHelper.startsWithAnyOf([...METRIC_INSIGHT_REQUEST_METRIC_PREFIXES,]),",
    );

    /*
     * The connector's names: built in the collector step, read as prefixes
     * by metric insights, and drawn in the step's restart sentence.
     */
    expect(users("SPAN_METRICS_NAMESPACE")).toEqual(
      repositoryPaths([COLLECTOR_STEP, METRIC_INSIGHT]),
    );

    for (const name of [
      "SPAN_METRICS_CALLS_METRIC",
      "SPAN_METRICS_DURATION_METRIC",
    ]) {
      expect(users(name)).toEqual(repositoryPaths([COLLECTOR_STEP, STEP_COPY]));
    }

    expect(denseCodeOf(STEP_COPY)).toContain(
      "restart:{calls:SPAN_METRICS_CALLS_METRIC,duration:SPAN_METRICS_DURATION_METRIC,},",
    );
  });
});
