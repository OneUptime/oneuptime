/**
 * The reported bug was one hand-rolled formatter behind the time range picker's
 * custom-range label, which wrote a 24-hour clock in the browser's own timezone
 * no matter what the user's computer was set to. The formatter is fixed and
 * unit-tested in Common (DateLocalShortDateTimeString.test.ts), and the label
 * it produces is covered by rendering the picker in
 * Common/Tests/UI/Components/TimeRangePickerClockFormat.test.tsx.
 *
 * What neither of those can see is the claim the bug report actually makes:
 * that Metrics, Traces AND Logs are all fixed. They are, because all three
 * mount the one shared picker - but nothing stops a future explorer from
 * growing its own range label instead, which is exactly how the defect got in.
 * So this pins the wiring.
 *
 * The App suite runs in plain Node with no renderer, so the check is made by
 * reading the sources, the same way TelemetryPreviewSnapshotWindow.test.ts and
 * IncidentMetricSeriesScope.test.ts do. Sources are comment-stripped and
 * whitespace-squashed first so a prettier re-wrap cannot turn a real regression
 * check into a red herring.
 */
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

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

function readSource(...relativeParts: Array<string>): string {
  return squash(
    stripComments(
      fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
    ),
  );
}

interface Explorer {
  name: string;
  source: string;
}

/*
 * The three surfaces named in the bug report, plus the metric explorer that
 * shares the metrics screen with the metrics dashboard.
 */
const EXPLORERS: Array<Explorer> = [
  {
    name: "metrics",
    source: readSource("Components", "Metrics", "MetricsDashboard.tsx"),
  },
  {
    name: "single metric",
    source: readSource("Components", "Metrics", "MetricExplorer.tsx"),
  },
  {
    name: "traces",
    source: readSource("Components", "Traces", "TracesDashboard.tsx"),
  },
  {
    name: "logs",
    source: readSource("Components", "Logs", "LogsDashboard.tsx"),
  },
];

describe.each(EXPLORERS)(
  "the $name explorer's time range picker",
  (explorer: Explorer) => {
    test("is the shared picker, so it inherits the fixed label", () => {
      expect(explorer.source).toContain(
        'import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker"',
      );
      expect(explorer.source).toContain("<TelemetryTimeRangePicker");
    });

    test("writes no range label of its own", () => {
      /*
       * The defect in one line: a component that formats a picked window by
       * reading fields off the Date, or by pinning a locale, cannot see either
       * the user's configured timezone or their machine's clock preference.
       */
      for (const bannedIdiom of [
        'toLocaleString("en-US"',
        "toLocaleTimeString([]",
        "hour12: false",
        "hour12: true",
      ]) {
        expect(explorer.source).not.toContain(bannedIdiom);
      }
    });
  },
);

describe("the shared picker itself", () => {
  const PICKER: string = squash(
    stripComments(
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "Common",
          "UI",
          "Components",
          "Date",
          "TimeRangePickerDropdown.tsx",
        ),
        "utf8",
      ),
    ),
  );

  test("formats a custom window through the timezone- and clock-aware helper", () => {
    expect(PICKER).toContain("OneUptimeDate.getDateAsLocalShortDateTimeString");
  });

  test("reads no wall-clock field off the Date and pins no locale", () => {
    for (const bannedIdiom of [
      ".getHours()",
      ".getMinutes()",
      ".getDate()",
      '"en-US"',
      "hour12",
    ]) {
      expect(PICKER).not.toContain(bannedIdiom);
    }
  });
});
