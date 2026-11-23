import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import MonitorEvaluationTime, {
  SLOW_EVALUATION_CEILING_IN_MS,
  SLOW_EVALUATION_FLOOR_IN_MS,
  SLOW_EVALUATION_SHARE_OF_INTERVAL,
} from "Common/Utils/Monitor/MonitorEvaluationTime";
import { CRITERIA_AND_STATUSES } from "./CriteriaGroupsPostmortemsDocsPages";
import { readPage } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";

/*
 * HOW LONG EACH CHECK TAKES, AS THE DOCS SAY IT (#10317).
 *
 * Criteria & Statuses says what a check's evaluation summary tells about
 * its time - where it is read, and when it warns - in a table of the
 * thresholds a monitor's interval gives. This suite holds the English page
 * to the product: the thresholds to MonitorEvaluationTime's, the rule's
 * words to its bounds, and the labels it names to the pages that draw
 * them. The translations are held to the English page line for line by
 * CriteriaGroupsPostmortemsDocsTranslations.
 */

const HEADING: string = "## How long each check takes";

const MINUTE: number = 60 * 1000;

const DASHBOARD_SOURCE: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src",
);

// The section, from its heading to the next.
function section(): string {
  const page: string = readPage("en", CRITERIA_AND_STATUSES);
  const start: number = page.indexOf(HEADING);

  expect(start).toBeGreaterThanOrEqual(0);

  const end: number = page.indexOf("\n## ", start + HEADING.length);

  return page.substring(start, end < 0 ? page.length : end);
}

// A time a table cell states: "6 seconds", "1 minute".
const TIME_CELL: RegExp = /^(\d+) (second|minute)s?$/;

// The time a cell states, in milliseconds.
function millisecondsIn(cell: string): number {
  const match: RegExpExecArray | null = TIME_CELL.exec(cell.trim());

  if (!match) {
    throw new Error(`Not a time: ${cell}`);
  }

  return Number(match[1]) * (match[2] === "minute" ? MINUTE : 1000);
}

describe("Criteria & Statuses: how long each check takes", () => {
  test("its table's thresholds are the product's, for every interval it names", () => {
    const found: Array<Array<Array<string>>> = tables(section());

    expect(found).toHaveLength(1);

    // The header, then the rows: tables() leaves out the separator line.
    const [header, ...rows] = found[0]!;

    expect(header).toEqual(["Monitor checked", "Warns after"]);

    const intervals: Array<number | undefined> = [
      MINUTE,
      5 * MINUTE,
      10 * MINUTE,
      undefined,
    ];

    expect(rows).toHaveLength(intervals.length);

    rows.forEach((row: Array<string>, index: number): void => {
      expect(millisecondsIn(row[1]!)).toBe(
        MonitorEvaluationTime.getSlowThresholdInMs(intervals[index]),
      );
    });

    // Less often than every 10 minutes is a minute still.
    expect(MonitorEvaluationTime.getSlowThresholdInMs(60 * MINUTE)).toBe(
      millisecondsIn(rows[2]![1]!),
    );
  });

  test("its rule's words are the product's bounds: a tenth, 5 seconds, a minute", () => {
    expect(SLOW_EVALUATION_SHARE_OF_INTERVAL).toBe(0.1);
    expect(SLOW_EVALUATION_FLOOR_IN_MS).toBe(5 * 1000);
    expect(SLOW_EVALUATION_CEILING_IN_MS).toBe(MINUTE);

    expect(section()).toContain(
      "Too long is more than a tenth of the time between the monitor's checks, never less than 5 seconds and never more than a minute:",
    );
  });

  test("the labels it names are where it says they are", () => {
    const logsPage: string = fs.readFileSync(
      path.join(DASHBOARD_SOURCE, "Pages/Monitor/View/Logs.tsx"),
      "utf8",
    );

    expect(section()).toContain(
      "under **View Summary** in the monitor's **Monitoring Logs** and for the latest check on its **Overview**",
    );
    expect(logsPage).toContain('title: "View Summary"');
    expect(logsPage).toContain('title: "Monitoring Logs"');

    // The Overview draws the latest evaluation's summary.
    expect(
      fs.readFileSync(
        path.join(DASHBOARD_SOURCE, "Pages/Monitor/View/Index.tsx"),
        "utf8",
      ),
    ).toContain("evaluationSummary={evaluation?.latest?.summary}");
  });
});
