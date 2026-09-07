import {
  AutoImportRuleRunResult,
  RuleRunResultUtil,
} from "Common/Types/NetworkAutomation/RuleRunResult";
import { describe, expect, it } from "@jest/globals";

/*
 * describeAutoImportRun is pure text over the run counters and lives in
 * Common — no react and no browser config in its import graph — so this
 * suite runs in Node without mocking any browser-time seam.
 */
const describeAutoImportRun: (result: AutoImportRuleRunResult) => string =
  RuleRunResultUtil.describeAutoImportRun.bind(RuleRunResultUtil);

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
    deviceFailureReasons: [],
    monitorFailureReasons: [],
    monitorProvisioningHalted: false,
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

  /*
   * The report issue #3643 was actually given: 501 matched, 501 already had
   * devices, 500 monitors failed, and the only advice was to run it again.
   * This is that whole dialog, as the fixed engine now fills it in.
   */
  it("tells an operator whose run created nothing what to do about it", () => {
    const summary: string = describeAutoImportRun(
      result({
        hostsEvaluated: 501,
        hostsMatched: 501,
        hostsSkippedAlreadyRegistered: 501,
        devicesCreated: 0,
        monitorsCreated: 0,
        monitorsFailed: 501,
        monitorProvisioningHalted: true,
        monitorFailureReasons: [
          "This rule's Monitor Template could not be loaded. It may have been deleted, moved to another project, or changed to a monitor type other than Network Device. Edit the rule and select a Network Device Monitor Template.",
        ],
      }),
    );

    expect(summary).toContain(
      "501 active Network Device monitors could not be created",
    );
    expect(summary).toContain(
      "Edit the rule and select a Network Device Monitor Template.",
    );
    expect(summary).toContain("Monitor provisioning stopped");
    // The advice that sent this operator in a circle.
    expect(summary).not.toContain("run again to continue");
    expect(summary).not.toContain("check the server logs");
  });
});
