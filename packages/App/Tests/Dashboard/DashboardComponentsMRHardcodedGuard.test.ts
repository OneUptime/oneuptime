import { describe, expect, test } from "@jest/globals";
import {
  getDefaultContext,
  getHardcodedStrings,
} from "../../FeatureSet/Dashboard/scripts/i18n/I18n";
import { HardcodedString } from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";

/*
 * Every user-facing string in the Dashboard's components from MasterPage to
 * Runner (src/Components/M* to R*) goes through translation
 * (src/Locales/README.md). `npm run i18n:hardcoded -- --dir Components/<name>`
 * lists what does not; this keeps those directories at what was reviewed:
 * nothing, except the strings below, which read the same in every language.
 *
 * Counted per file rather than quoted, so reformatting a file never fails
 * this; a new hard-coded string in any of these directories does.
 */

const DASHBOARD_SOURCE: string = "packages/App/FeatureSet/Dashboard/src/";

// Components/MasterPage ... Components/Runner.
const IN_SCOPE: RegExp = /^Components\/[M-R]/;

const ALLOWED: Record<string, { count: number; why: string }> = {
  "Components/MicrosoftTeams/MicrosoftTeamsIntegration.tsx": {
    count: 1,
    why: "the setup-guide markdown: Teams admin-center paths, manifest field names and a code block, written as one document",
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

describe("the Dashboard's components from M to R route their strings through translation", () => {
  test("only the reviewed strings that read the same in every language are left", () => {
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

    // Every exception is explained, and still needed.
    for (const file of Object.keys(ALLOWED)) {
      expect(ALLOWED[file]!.why.length).toBeGreaterThan(0);
      expect(counts[file] || 0).toBeLessThanOrEqual(ALLOWED[file]!.count);
    }
  }, 300000);
});
