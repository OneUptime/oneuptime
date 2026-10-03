import { describe, expect, test } from "@jest/globals";
import {
  getDefaultContext,
  getHardcodedStrings,
} from "../../FeatureSet/Dashboard/scripts/i18n/I18n";
import { HardcodedString } from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";

/*
 * Every user-facing string in the Dashboard's components from AI to Logs
 * (the folders under src/Components whose names start with A to L) goes
 * through translation (src/Locales/README.md). `npm run i18n:hardcoded --
 * --dir Components` lists what does not; this keeps those folders at what was
 * reviewed: only the strings below, which read the same in every language.
 *
 * Counted per file rather than quoted, so reformatting a file never fails
 * this; a new hard-coded string in one of these folders does.
 */

const DASHBOARD_SOURCE: string = "packages/App/FeatureSet/Dashboard/src/";

// The folders this guard covers: Components/AI ... Components/Logs.
const IN_SCOPE: RegExp = /^Components\/[A-L][^/]*\//;

const ALLOWED: Record<string, { count: number; why: string }> = {
  "Components/AIChat/Widgets/TraceWaterfallWidget.tsx": {
    count: 2,
    why: '"{n} ms" span durations (unit)',
  },
};

type CountByFileFunction = (
  strings: Array<HardcodedString>,
) => Record<string, number>;

const countByFile: CountByFileFunction = (
  strings: Array<HardcodedString>,
): Record<string, number> => {
  const counts: Record<string, number> = {};

  for (const entry of strings) {
    const file: string = entry.file.startsWith(DASHBOARD_SOURCE)
      ? entry.file.slice(DASHBOARD_SOURCE.length)
      : entry.file;

    if (!IN_SCOPE.test(file)) {
      continue;
    }

    counts[file] = (counts[file] || 0) + 1;
  }

  return counts;
};

describe("the Dashboard's components from AI to Logs route their strings through translation", () => {
  test("only the reviewed strings that read the same in every language stay hard-coded", () => {
    const counts: Record<string, number> = countByFile(
      getHardcodedStrings(getDefaultContext(), { directory: "Components" }),
    );

    const unexpected: Array<string> = Object.keys(counts)
      .filter((file: string): boolean => {
        return counts[file]! > (ALLOWED[file]?.count || 0);
      })
      .map((file: string): string => {
        return `${file}: ${counts[file]} (allowed ${ALLOWED[file]?.count || 0})`;
      });

    expect(unexpected).toEqual([]);
  }, 180000);

  test("every exception is in scope and explained", () => {
    for (const file of Object.keys(ALLOWED)) {
      expect(IN_SCOPE.test(file)).toBe(true);
      expect(ALLOWED[file]!.why.length).toBeGreaterThan(0);
    }
  });

  test("the scope reaches every folder from AI to Logs and nothing after", () => {
    expect(IN_SCOPE.test("Components/AI/InvestigationPanel.tsx")).toBe(true);
    expect(IN_SCOPE.test("Components/Logs/LogsDashboard.tsx")).toBe(true);
    expect(IN_SCOPE.test("Components/LogPipeline/ProcessorForm.tsx")).toBe(
      true,
    );
    expect(IN_SCOPE.test("Components/Monitor/MonitorElement.tsx")).toBe(false);
    expect(IN_SCOPE.test("Components/AppLink.tsx")).toBe(false);
  });
});
