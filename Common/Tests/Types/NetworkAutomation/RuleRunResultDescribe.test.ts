import {
  AutoImportRuleRunResult,
  RuleRunResultUtil,
} from "../../../Types/NetworkAutomation/RuleRunResult";
import { describe, expect, it } from "@jest/globals";

/*
 * Text contract for RuleRunResultUtil.describeAutoImportRun. The wording is what
 * the "Run Now" / "Dry Run" report shows an operator, so each sentence is
 * asserted at the boundary that produces it: an import of zero must say WHY, a
 * dry run must never claim it wrote anything, and singular/plural grammar must
 * track the count.
 */

function result(
  overrides: Partial<AutoImportRuleRunResult>,
): AutoImportRuleRunResult {
  return {
    hostsEvaluated: 0,
    hostsMatched: 0,
    hostsExcluded: 0,
    hostsSkippedAlreadyRegistered: 0,
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

function describe_(overrides: Partial<AutoImportRuleRunResult>): string {
  return RuleRunResultUtil.describeAutoImportRun(result(overrides));
}

describe("RuleRunResultUtil.describeAutoImportRun", () => {
  it("reports a real import with the device count", () => {
    expect(describe_({ devicesCreated: 3, hostsMatched: 3 })).toContain(
      "Imported 3 hosts as network devices.",
    );
  });

  it("uses singular grammar for a single imported device", () => {
    const summary: string = describe_({ devicesCreated: 1, hostsMatched: 1 });
    expect(summary).toContain("Imported 1 host as network devices.");
    expect(summary).not.toContain("1 hosts");
  });

  it("explains a zero import instead of just saying zero", () => {
    const summary: string = describe_({
      devicesCreated: 0,
      hostsMatched: 0,
      hostsEvaluated: 12,
    });
    expect(summary).toContain("No devices were imported.");
    expect(summary).toContain("matched 0 hosts out of the 12 hosts");
  });

  it("a dry run that would import reports the projection and writes nothing", () => {
    const summary: string = describe_({
      isDryRun: true,
      hostsMatched: 5,
      hostsSkippedAlreadyRegistered: 2,
    });
    // wouldImport = matched - alreadyRegistered = 3
    expect(summary).toContain("This rule would import 3 hosts");
    expect(summary).toContain("Nothing was written — this was a dry run.");
  });

  it("a dry run that would import nothing says so without claiming a write", () => {
    const summary: string = describe_({
      isDryRun: true,
      hostsMatched: 0,
      hostsEvaluated: 7,
    });
    expect(summary).toContain("This rule would import nothing.");
    expect(summary).not.toContain("Imported");
  });

  it("never lets already-registered exceed matched into a negative projection", () => {
    const summary: string = describe_({
      isDryRun: true,
      hostsMatched: 1,
      hostsSkippedAlreadyRegistered: 4,
    });
    expect(summary).toContain("This rule would import nothing.");
    expect(summary).not.toContain("-3");
  });

  it("reports monitor provisioning on a real run", () => {
    const summary: string = describe_({
      devicesCreated: 2,
      hostsMatched: 2,
      monitorsCreated: 2,
    });
    expect(summary).toContain(
      "Created 2 active Network Device monitors from the selected Monitor Template.",
    );
  });

  it("predicts monitor provisioning on a dry run without claiming a write", () => {
    const summary: string = describe_({
      isDryRun: true,
      hostsMatched: 2,
      monitorsWouldCreate: 2,
    });
    expect(summary).toContain(
      "It would also create 2 active Network Device monitors",
    );
  });

  it("reports exclusions, already-registered hosts, and failures", () => {
    const summary: string = describe_({
      devicesCreated: 1,
      hostsMatched: 4,
      hostsExcluded: 1,
      hostsSkippedAlreadyRegistered: 1,
      devicesFailed: 1,
    });
    expect(summary).toContain("An exclusion rule vetoed 1 host.");
    expect(summary).toContain("1 host already had network devices");
    expect(summary).toContain("1 host could not be imported.");
  });

  it("gives resumable advice for a truncated real run and non-resumable for dry", () => {
    expect(describe_({ isTruncated: true, devicesCreated: 5 })).toContain(
      "run again to continue",
    );
    const dry: string = describe_({ isTruncated: true, isDryRun: true });
    expect(dry).toContain("device-import and active-monitor creation");
    expect(dry).not.toContain("run again to continue");
  });

  it("warns when older scans went unread", () => {
    expect(describe_({ hasMoreScans: true, devicesCreated: 1 })).toContain(
      "Only the newest 100 completed scans were read",
    );
  });
});
