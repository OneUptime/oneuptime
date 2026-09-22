import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #3914: clicking a bar of the Log Volume chart showed "no logs". A
 * bar is labelled with the START of its bucket, so unless the chart knows
 * how wide its buckets are, a click on one bar can only zoom into a window
 * zero seconds wide. The chart and the shared viewer shells take that width
 * as a prop (covered by the Common render suites HistogramClickToZoom and
 * TelemetryViewerHistogramClickZoom); this file pins that every explorer
 * actually hands it over.
 *
 * The App suite runs in plain Node with no renderer, so the wiring is read
 * from the sources, comment-stripped and whitespace-squashed so a prettier
 * re-wrap cannot fake a failure. The explorers are DISCOVERED (anything that
 * makes a volume chart zoomable), not listed, so a new one is held to the
 * same rule and an unrelated refactor of a listed file cannot break this.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readSource(absolutePath: string): string {
  return squash(stripComments(fs.readFileSync(absolutePath, "utf8")));
}

const SOURCE_FILE: RegExp = /\.tsx?$/;

function listSources(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSources(fullPath));
    } else if (SOURCE_FILE.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

/*
 * The text between the first `{` after `marker` and the brace that closes
 * it - a function body, for the handlers below.
 */
function blockAfter(source: string, marker: string): string {
  const markerIndex: number = source.indexOf(marker);

  expect(markerIndex).toBeGreaterThanOrEqual(0);

  const open: number = source.indexOf("{", markerIndex);
  let depth: number = 0;

  for (let index: number = open; index < source.length; index++) {
    if (source[index] === "{") {
      depth++;
    } else if (source[index] === "}") {
      depth--;

      if (depth === 0) {
        return source.slice(open, index + 1);
      }
    }
  }

  throw new Error(`Unbalanced block after ${marker}`);
}

function relative(file: string): string {
  return path.relative(DASHBOARD_SRC, file);
}

const ZOOMABLE_EXPLORERS: Array<{ file: string; source: string }> = listSources(
  DASHBOARD_SRC,
)
  .map((file: string) => {
    return { file: file, source: readSource(file) };
  })
  .filter((entry: { file: string; source: string }): boolean => {
    return entry.source.includes("onHistogramTimeRangeSelect={");
  });

function explorer(fileName: string): string {
  const match: { file: string; source: string } | undefined =
    ZOOMABLE_EXPLORERS.find((entry: { file: string; source: string }) => {
      return path.basename(entry.file) === fileName;
    });

  expect(match).toBeDefined();

  return match!.source;
}

describe("every zoomable volume chart is told how wide its bars are", () => {
  test("the scan finds the explorers (so the rule below is not vacuous)", () => {
    const names: Array<string> = ZOOMABLE_EXPLORERS.map(
      (entry: { file: string; source: string }): string => {
        return path.basename(entry.file);
      },
    );

    expect(names).toEqual(
      expect.arrayContaining([
        "LogsViewer.tsx",
        "TracesViewer.tsx",
        "ExceptionsViewer.tsx",
        "SecurityEventsViewer.tsx",
      ]),
    );
  });

  test("each one passes histogramBucketIntervalMs next to its select handler", () => {
    const missing: Array<string> = ZOOMABLE_EXPLORERS.filter(
      (entry: { file: string; source: string }): boolean => {
        return !entry.source.includes("histogramBucketIntervalMs={");
      },
    ).map((entry: { file: string; source: string }): string => {
      return relative(entry.file);
    });

    expect(missing).toEqual([]);
  });
});

describe("the width travels with the buckets it describes", () => {
  test("logs read it out of the histogram response", () => {
    const source: string = explorer("LogsViewer.tsx");

    expect(source).toContain(
      "return parseLogsHistogramResponse(response.data);",
    );
    expect(source).toContain(
      "histogramBucketIntervalMs={histogram.bucketIntervalMs}",
    );
  });

  test.each(["TracesViewer.tsx", "ExceptionsViewer.tsx"])(
    "%s derives it from the bucket size it asks the server for",
    (fileName: string) => {
      const source: string = explorer(fileName);

      expect(source).toContain(
        "setHistogramBucketIntervalMs(bucketSizeInMinutes * 60 * 1000);",
      );
      expect(source).toContain(
        "histogramBucketIntervalMs={histogramBucketIntervalMs}",
      );
      // A failed fetch leaves no width behind for the next window's bars.
      expect(source).toContain("setHistogramBucketIntervalMs(undefined);");
    },
  );

  /*
   * Security events used to widen the selection by one bucket itself. The
   * chart does that now, so doing it again here would open two buckets for
   * every one clicked.
   */
  test("security events pass their interval and no longer widen the selection themselves", () => {
    const source: string = explorer("SecurityEventsViewer.tsx");

    expect(source).toContain("histogramBucketIntervalMs={volume?.intervalMs}");

    const handler: string = blockAfter(
      source,
      "const handleHistogramTimeRangeSelect",
    );

    expect(handler).not.toContain("intervalMs");
    expect(handler).toContain(
      "startAndEndDate: new InBetween<Date>(startDate, endDate)",
    );
  });
});
