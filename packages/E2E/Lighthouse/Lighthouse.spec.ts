import {
  RecordedBaselineFile,
  ReportsFolder,
  readBaseline,
  recordInBaseline,
  writeScoreLine,
} from "./BaselineFile";
import LighthousePages, {
  FormFactor,
  FormFactors,
  LighthousePage,
} from "./Pages";
import {
  Report,
  ScannedCategories,
  differencesFromBaseline,
  failingAudits,
  scoreOf,
} from "./Results";
import { scanPage } from "./Scan";
import { expect, test } from "@playwright/test";
import fs from "fs";
import { RunnerResult } from "lighthouse";
import path from "path";

/*
 * Every page in Pages.ts, scanned on a phone and on a laptop, against what
 * Baseline.json recorded for it: an audit that fails now and did not then,
 * or one Baseline.json records that passes now, fails the test. Each
 * page's report, and what it would record, go to the reports folder for
 * the run's artifact.
 *
 * LIGHTHOUSE_RECORD=1 records the pages it scans in Baseline.json instead
 * (README.md).
 */
const Recording: boolean = process.env["LIGHTHOUSE_RECORD"] === "1";

// The report's file name: the page's path, without its slashes.
function fileNameOf(page: LighthousePage, formFactor: FormFactor): string {
  const name: string =
    page.path === "/"
      ? "home"
      : page.path.replace(/^\/+/, "").replace(/[^A-Za-z0-9]+/g, "-");

  return `${name}.${formFactor}.html`;
}

for (const page of LighthousePages) {
  for (const formFactor of FormFactors) {
    test(`${page.path} (${page.template}) on ${formFactor}`, async ({
      baseURL,
    }: {
      baseURL: string | undefined;
    }) => {
      const result: RunnerResult = await scanPage(
        `${baseURL}${page.path}`,
        formFactor,
      );
      const report: Report = result.lhr;
      const reportFile: string = path.join(
        ReportsFolder,
        fileNameOf(page, formFactor),
      );

      fs.mkdirSync(ReportsFolder, { recursive: true });
      fs.writeFileSync(
        reportFile,
        Array.isArray(result.report) ? result.report.join("\n") : result.report,
      );

      writeScoreLine({
        path: page.path,
        template: page.template,
        formFactor: formFactor,
        scores: Object.fromEntries(
          ScannedCategories.map((category: string): [string, string] => {
            return [category, scoreOf(report, category)];
          }),
        ),
        failing: failingAudits(report),
        report: path.basename(reportFile),
      });

      const record: Parameters<typeof recordInBaseline>[0] = {
        lighthouse: report.lighthouseVersion,
        path: page.path,
        formFactor: formFactor,
        failing: failingAudits(report),
      };

      recordInBaseline(record, RecordedBaselineFile);

      if (Recording) {
        recordInBaseline(record);

        return;
      }

      expect(
        differencesFromBaseline({
          report: report,
          baseline: readBaseline(),
          path: page.path,
          formFactor: formFactor,
        }),
        `Lighthouse's report on the page: ${reportFile}`,
      ).toEqual([]);
    });
  }
}
