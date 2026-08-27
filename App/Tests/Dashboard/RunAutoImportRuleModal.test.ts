import { describeAutoImportRun } from "../../FeatureSet/Dashboard/src/Components/NetworkAutomation/RunAutoImportRuleModal";
import { AutoImportRuleRunResult } from "Common/Types/NetworkAutomation/RuleRunResult";
import { describe, expect, it, jest } from "@jest/globals";

/*
 * The summary helper lives beside the browser component, whose import graph
 * reads APP_API_URL. Keep this pure text test in Node by replacing only that
 * browser-time configuration value.
 */
jest.mock("Common/UI/Config", () => {
  const { default: MockURL } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (value: string) => unknown };
  };

  return {
    __esModule: true,
    APP_API_URL: MockURL.fromString("http://localhost/api"),
  };
});

function result(
  overrides: Partial<AutoImportRuleRunResult>,
): AutoImportRuleRunResult {
  return {
    hostsEvaluated: 1,
    hostsMatched: 1,
    hostsExcluded: 0,
    hostsSkippedAlreadyRegistered: 1,
    devicesCreated: 0,
    devicesFailed: 0,
    monitorsWouldCreate: 0,
    monitorsCreated: 0,
    monitorsSkippedAlreadyExisting: 0,
    monitorsSkippedUnsupportedHost: 0,
    monitorsFailed: 0,
    isTruncated: false,
    hasMoreScans: false,
    isDryRun: false,
    matchedIpAddressSample: [],
    ...overrides,
  };
}

describe("auto-import rule run summary", () => {
  it("uses singular grammar for one skipped monitor request", () => {
    const summary: string = describeAutoImportRun(
      result({ monitorsSkippedAlreadyExisting: 1 }),
    );

    expect(summary).toContain(
      "1 requested active Network Device monitor was skipped",
    );
    expect(summary).not.toContain("monitor were");
  });

  it("describes multiple skipped requests without claiming that many monitors exist", () => {
    expect(
      describeAutoImportRun(result({ monitorsSkippedAlreadyExisting: 3 })),
    ).toContain("3 requested active Network Device monitors were skipped");
  });

  it("explains that a dry-run cap can come from device or monitor work", () => {
    const summary: string = describeAutoImportRun(
      result({ isDryRun: true, isTruncated: true }),
    );

    expect(summary).toContain("device-import and active-monitor creation");
    expect(summary).not.toContain("imports this many");
  });
});
