import { describe, expect, test } from "@jest/globals";
import {
  getDefaultContext,
  getHardcodedStrings,
} from "../../FeatureSet/Dashboard/scripts/i18n/I18n";
import { HardcodedString } from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";

/*
 * Every user-facing string in the Dashboard's Pages and Utils goes through
 * translation (src/Locales/README.md). `npm run i18n:hardcoded -- --dir Pages`
 * and `--dir Utils` list what does not; this keeps the two at what was
 * reviewed: nothing in Utils, and in Pages only the strings below - units,
 * identifiers, product and library names, and setup-guide markdown with code
 * in it - which stay the same in every language.
 *
 * Counted per file rather than quoted, so reformatting a file never fails
 * this; a new hard-coded string in Pages or Utils does.
 */

const DASHBOARD_SOURCE: string = "packages/App/FeatureSet/Dashboard/src/";

const ALLOWED_IN_PAGES: Record<string, { count: number; why: string }> = {
  "Pages/AIAgentTasks/View/Logs.tsx": {
    count: 2,
    why: '"{n} ms" durations (unit)',
  },
  "Pages/Dashboards/View/CustomDomains.tsx": {
    count: 1,
    why: '"CNAME" (DNS record type)',
  },
  "Pages/Database/Utils/DocumentationMarkdown.ts": {
    count: 8,
    why: "setup-guide markdown bodies built around SQL/JS/HTTP code blocks",
  },
  "Pages/Host/View/ProcessView.tsx": {
    count: 1,
    why: '"pid {n}" (process id label)',
  },
  "Pages/Host/View/Processes.tsx": {
    count: 1,
    why: '"pid {n}" (process id label)',
  },
  "Pages/IoT/View/Devices.tsx": { count: 1, why: '"{n} °C" (unit)' },
  "Pages/Llm/Documentation.tsx": {
    count: 2,
    why: '"OpenLLMetry", "OpenInference" (library names inside a translated sentence)',
  },
  "Pages/MessageQueue/Utils/DocumentationMarkdown.ts": {
    count: 2,
    why: "a line of setup-guide markdown and an attribute name/value",
  },
  "Pages/NetworkDevice/View/Traffic.tsx": {
    count: 1,
    why: '"NetFlow v5" (protocol name inside a translated sentence)',
  },
  "Pages/OnCallDuty/IncomingCallPolicy/Escalation.tsx": {
    count: 1,
    why: '"{n}s" (seconds, unit)',
  },
  "Pages/OnCallDuty/IncomingCallPolicy/LogView.tsx": {
    count: 2,
    why: '"{m}m {s}s" call duration (units)',
  },
  "Pages/OnCallDuty/IncomingCallPolicy/Logs.tsx": {
    count: 2,
    why: '"{m}m {s}s" call duration (units)',
  },
  "Pages/Rum/View/SessionReplaySettings.tsx": {
    count: 1,
    why: '"{n} GB" (unit)',
  },
  "Pages/Settings/Domains.tsx": { count: 1, why: '"TXT" (DNS record type)' },
  "Pages/Settings/LlmProviders.tsx": {
    count: 1,
    why: '"${n} USD" (currency)',
  },
  "Pages/Settings/UsageHistory.tsx": {
    count: 3,
    why: '"{n} GB" twice and "{n} USD" (units, currency)',
  },
  "Pages/StatusPages/View/Domains.tsx": {
    count: 1,
    why: '"CNAME" (DNS record type)',
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

    counts[file] = (counts[file] || 0) + 1;
  }

  return counts;
};

describe("the Dashboard's Pages and Utils route their strings through translation", () => {
  test("Utils has no hard-coded user-facing string", () => {
    const strings: Array<HardcodedString> = getHardcodedStrings(
      getDefaultContext(),
      { directory: "Utils" },
    );

    expect(
      strings.map((entry: HardcodedString): string => {
        return `${entry.file}:${entry.line} ${entry.text}`;
      }),
    ).toEqual([]);
  }, 120000);

  test("Pages keeps only the reviewed strings that read the same in every language", () => {
    const counts: Record<string, number> = countByFile(
      getHardcodedStrings(getDefaultContext(), { directory: "Pages" }),
    );

    const unexpected: Array<string> = Object.keys(counts)
      .filter((file: string): boolean => {
        return counts[file]! > (ALLOWED_IN_PAGES[file]?.count || 0);
      })
      .map((file: string): string => {
        return `${file}: ${counts[file]} (allowed ${ALLOWED_IN_PAGES[file]?.count || 0})`;
      });

    expect(unexpected).toEqual([]);

    // Every exception is explained.
    for (const file of Object.keys(ALLOWED_IN_PAGES)) {
      expect(ALLOWED_IN_PAGES[file]!.why.length).toBeGreaterThan(0);
    }
  }, 120000);
});
