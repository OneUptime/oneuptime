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
 * The upgrade notes also tell operators that OneUptime's own pages do not
 * read these metrics. The last test keeps that true.
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
    // Kept true by the last test in this file.
    expect(upgrading).toContain(
      "OneUptime's own pages and the service map do not read these metrics.",
    );
  });
});

/*
 * No product code may read a span-metrics family by name, under the old
 * names, the new ones, or the ones OBI before v0.11 used. A feature that
 * starts reading one has to follow the rename (and the upgrade notes have
 * to stop saying OneUptime reads neither).
 */
describe("OneUptime reads no eBPF span-metrics family", () => {
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

  const SPAN_METRICS_NAME: RegExp =
    /traces_spanmetrics_|traces\.span\.metrics\.|traces_span_metrics_/;

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

  test("in any TypeScript or JavaScript source outside the docs", () => {
    const offenders: Array<string> = SCAN_DIRS.flatMap(listSourceFiles)
      .filter((file: string): boolean => {
        // The in-app guide documents the metrics; it reads nothing.
        return file !== DASHBOARD_GUIDE;
      })
      .filter((file: string): boolean => {
        return SPAN_METRICS_NAME.test(read(file));
      })
      .map(relative);

    expect(offenders).toEqual([]);
  });
});
