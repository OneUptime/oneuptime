import { FormFactor, FormFactors } from "./Pages";
import {
  AllCategories,
  ProductionPage,
  ProductionPages,
  ProductionReportsFolder,
  RunsPerPage,
  measureOf,
  medianRun,
  writeMeasure,
} from "./Production";
import { Report } from "./Results";
import { scanPage } from "./Scan";
import { expect, test } from "@playwright/test";
import fs from "fs";
import { RunnerResult } from "lighthouse";
import path from "path";

/*
 * The nightly scan of oneuptime.com (Production.ts): every page in all four
 * of Lighthouse's categories, on a phone and on a laptop, RunsPerPage times,
 * with every third party it loads. The median run's report is written to the
 * reports folder and its measures to the run's summary (ProductionTeardown.ts).
 *
 * It tracks: a page fails only when no run of it could be scanned.
 */

function fileNameOf(page: ProductionPage, formFactor: FormFactor): string {
  const { hostname, pathname } = new URL(page.url);
  const name: string = `${hostname}${pathname}`
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${name}.${formFactor}.html`;
}

for (const page of ProductionPages) {
  for (const formFactor of FormFactors) {
    test(`${page.name} (${page.url}) on ${formFactor}`, async () => {
      const runs: Array<RunnerResult> = [];

      for (let run: number = 0; run < RunsPerPage; run++) {
        runs.push(
          await scanPage(page.url, formFactor, {
            categories: AllCategories,
            blockedUrlPatterns: [],
          }),
        );
      }

      const reports: Array<Report> = runs.map(
        (result: RunnerResult): Report => {
          return result.lhr;
        },
      );
      const median: Report | null = medianRun(reports);

      expect(
        median,
        `No run of ${page.url} could be scanned: ${reports
          .map((report: Report): string => {
            return report.runtimeError?.message || "no error";
          })
          .join("; ")}`,
      ).not.toBeNull();

      const chosen: RunnerResult = runs[reports.indexOf(median!)]!;

      fs.mkdirSync(ProductionReportsFolder, { recursive: true });
      fs.writeFileSync(
        path.join(ProductionReportsFolder, fileNameOf(page, formFactor)),
        Array.isArray(chosen.report) ? chosen.report.join("\n") : chosen.report,
      );

      writeMeasure(
        measureOf({
          page,
          formFactor,
          report: median!,
          runs: reports.filter((report: Report): boolean => {
            return !report.runtimeError;
          }).length,
        }),
      );
    });
  }
}
