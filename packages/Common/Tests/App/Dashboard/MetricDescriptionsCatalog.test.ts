import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  expectReadableDescriptionRecord,
  metricDescriptionProblems,
} from "./MetricDescriptionRules";

/*
 * Every metric-explanation module in the dashboard, found on disk rather
 * than listed by hand, so a new resource type's descriptions are held to the
 * same rules the day they are added. Each module exports one or more
 * Record<string, string> of tooltip texts.
 */

const DESCRIPTIONS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "MetricDescriptions",
);

const MODULE_FILES: Array<string> = fs
  .readdirSync(DESCRIPTIONS_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".ts") && !file.endsWith(".d.ts");
  })
  .sort();

type DescriptionModule = Record<string, unknown>;

function loadModule(file: string): DescriptionModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require(path.join(DESCRIPTIONS_DIR, file)) as DescriptionModule;
}

function descriptionRecords(
  module: DescriptionModule,
): Array<[string, Record<string, unknown>]> {
  return Object.entries(module).filter(
    (entry: [string, unknown]): entry is [string, Record<string, unknown>] => {
      const value: unknown = entry[1];

      return (
        Boolean(value) &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.values(value as Record<string, unknown>).every(
          (v: unknown): boolean => {
            return typeof v === "string";
          },
        )
      );
    },
  );
}

describe("metric description modules", () => {
  test("the directory exists and holds modules", () => {
    expect(MODULE_FILES.length).toBeGreaterThan(0);
    expect(MODULE_FILES).toContain("RumMetricDescriptions.ts");
  });

  test.each(MODULE_FILES)(
    "%s is plain data - no React, no API client",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.join(DESCRIPTIONS_DIR, file),
        "utf8",
      );

      /*
       * The App suite imports these from a node test; anything that reaches
       * react or Common/UI/Config would break it.
       */
      expect(source).not.toMatch(/from\s+["']react["']/);
      expect(source).not.toMatch(/Common\/UI\//);
      expect(source).not.toMatch(/\.tsx["']/);
    },
  );

  test.each(MODULE_FILES)(
    "%s exports at least one description record",
    (file: string) => {
      expect(descriptionRecords(loadModule(file)).length).toBeGreaterThan(0);
    },
  );

  test.each(MODULE_FILES)(
    "%s: every description reads as a short, finished, jargon-explaining sentence",
    (file: string) => {
      for (const [exportName, record] of descriptionRecords(loadModule(file))) {
        expectReadableDescriptionRecord(record, `${file}:${exportName}`);
      }
    },
  );
});

describe("the rules themselves", () => {
  test("accept a good explanation", () => {
    expect(
      metricDescriptionProblems(
        "p95 means 95% of requests finished faster than this, and the slowest 5% took longer.",
      ),
    ).toEqual([]);
  });

  test("reject a percentile that is named but not explained", () => {
    expect(
      metricDescriptionProblems("The p95 latency of requests in the range."),
    ).toContain("names p95 without explaining it");
    expect(
      metricDescriptionProblems("The p99 latency of requests in the range."),
    ).toContain("names p99 without explaining it");
    expect(
      metricDescriptionProblems("The p50 latency of requests in the range."),
    ).toContain("names p50 without explaining it");
  });

  test("reject placeholders, leaked values and unfinished text", () => {
    expect(
      metricDescriptionProblems("TODO explain this metric properly."),
    ).toContain("contains placeholder text");
    expect(
      metricDescriptionProblems("The value is undefined for this resource."),
    ).toContain("contains a leaked programming value");
    expect(
      metricDescriptionProblems("How long requests took on this service"),
    ).toContain("does not end like a sentence");
    expect(metricDescriptionProblems("CPU.")).toContain(
      "is too short to explain anything (4 chars)",
    );
    expect(
      metricDescriptionProblems(`${"Long words. ".repeat(40)}`.trim()),
    ).toEqual(expect.arrayContaining([expect.stringContaining("is too long")]));
    expect(
      metricDescriptionProblems("Share of  requests that failed in the range."),
    ).toContain("contains a double space or a line break");
    expect(metricDescriptionProblems(42)).toEqual(["is not a string (number)"]);
  });
});
