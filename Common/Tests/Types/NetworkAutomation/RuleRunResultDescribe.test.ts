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
    expect(summary).toContain(
      "matched 0 hosts out of the 12 discovered hosts it looked at",
    );
  });

  /*
   * The denominator used to compose two nouns — "out of the 501 hosts
   * discovered hosts it looked at" — which is what the report on issue #3643
   * actually read.
   */
  it("does not double the noun in the matched-out-of sentence", () => {
    expect(describe_({ hostsMatched: 501, hostsEvaluated: 501 })).not.toContain(
      "hosts discovered hosts",
    );
    expect(
      describe_({ isDryRun: true, hostsMatched: 0, hostsEvaluated: 501 }),
    ).not.toContain("hosts discovered hosts");
  });

  it("uses singular grammar for a single discovered host", () => {
    expect(describe_({ hostsMatched: 0, hostsEvaluated: 1 })).toContain(
      "out of the 1 discovered host it looked at",
    );
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

  /*
   * Issue #3643. A run that reached the cap having created nothing has nothing
   * to resume: the identical run would fail identically. "Run again to
   * continue" was the advice that report gave, and it was an instruction to
   * repeat a doomed run.
   */
  it("does not promise progress for a truncated run that created nothing", () => {
    const summary: string = describe_({
      isTruncated: true,
      hostsMatched: 501,
      hostsEvaluated: 501,
      hostsSkippedAlreadyRegistered: 501,
      devicesCreated: 0,
      monitorsCreated: 0,
      monitorsFailed: 500,
    });

    expect(summary).not.toContain("run again to continue");
    expect(summary).toContain(
      "Stopped at the run cap without creating anything",
    );
    expect(summary).toContain("fix the failures reported above first");
  });

  it("still promises progress for a truncated run that created monitors only", () => {
    expect(
      describe_({
        isTruncated: true,
        devicesCreated: 0,
        monitorsCreated: 12,
      }),
    ).toContain("run again to continue");
  });

  it("gives the reason monitors could not be created instead of pointing at logs", () => {
    const summary: string = describe_({
      hostsMatched: 501,
      hostsEvaluated: 501,
      monitorsFailed: 501,
      monitorFailureReasons: [
        "This rule's Monitor Template could not be loaded",
      ],
    });

    expect(summary).toContain(
      "Reason: This rule's Monitor Template could not be loaded.",
    );
    expect(summary).not.toContain("check the server logs");
  });

  it("still points at the logs when the server recorded no reason", () => {
    expect(describe_({ monitorsFailed: 2 })).toContain(
      "Their network devices remain imported. Check the server logs for the reason.",
    );
    expect(describe_({ devicesFailed: 2 })).toContain(
      "2 hosts could not be imported. Check the server logs for the reason.",
    );
  });

  it("renders several distinct reasons as one list and punctuates each", () => {
    const summary: string = describe_({
      monitorsFailed: 4,
      monitorFailureReasons: ["Plan limit reached", "Duplicate key."],
    });

    expect(summary).toContain("Reasons: Plan limit reached. Duplicate key.");
  });

  it("gives the reason devices could not be imported", () => {
    expect(
      describe_({
        devicesFailed: 3,
        deviceFailureReasons: ["Device name is too long"],
      }),
    ).toContain(
      "3 hosts could not be imported. Reason: Device name is too long.",
    );
  });

  it("says monitor provisioning stopped rather than leaving it implied", () => {
    const summary: string = describe_({
      hostsMatched: 501,
      hostsEvaluated: 501,
      monitorsFailed: 501,
      monitorProvisioningHalted: true,
      monitorFailureReasons: ["Plan limit reached"],
    });

    expect(summary).toContain(
      "Monitor provisioning stopped for the rest of this run",
    );
    expect(summary).toContain("Fix it and run this rule again.");
  });

  it("warns when older scans went unread", () => {
    expect(describe_({ hasMoreScans: true, devicesCreated: 1 })).toContain(
      "Only the newest 100 completed scans were read",
    );
  });
});
