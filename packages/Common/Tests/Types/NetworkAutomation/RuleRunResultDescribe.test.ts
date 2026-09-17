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
    hostsPendingImport: 0,
    monitorsPendingCreation: 0,
    hasUnevaluatedScans: false,
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

  /*
   * OneUptime issue #3642: "909 discovered, 500+ imported, the rest silently
   * skipped". The cap itself was working as designed; what made it read as
   * silence was a report that named neither how much was left nor the fact
   * that the monitor half of the work had its own separate ceiling.
   */
  describe("what a capped run says it left behind (issue #3642)", () => {
    it("names the hosts a device cap left un-imported", () => {
      const summary: string = describe_({
        isTruncated: true,
        devicesCreated: 500,
        hostsEvaluated: 909,
        hostsMatched: 909,
        hostsPendingImport: 409,
      });

      expect(summary).toContain("Imported 500 hosts as network devices.");
      expect(summary).toContain(
        "Stopped at the run cap with 409 hosts still to import.",
      );
      expect(summary).toContain("Run again to continue");
    });

    it("names the devices a monitor cap left unmonitored", () => {
      const summary: string = describe_({
        isTruncated: true,
        devicesCreated: 0,
        monitorsCreated: 500,
        hostsEvaluated: 909,
        hostsMatched: 909,
        hostsSkippedAlreadyRegistered: 909,
        monitorsPendingCreation: 409,
      });

      expect(summary).toContain(
        "Stopped at the run cap with 409 active Network Device monitors still to create.",
      );
      // The device half is not claimed as pending — it was already imported.
      expect(summary).not.toContain("still to import");
    });

    it("reports both halves when both caps left work behind", () => {
      expect(
        describe_({
          isTruncated: true,
          devicesCreated: 500,
          monitorsCreated: 500,
          hostsPendingImport: 12,
          monitorsPendingCreation: 3,
        }),
      ).toContain(
        "12 hosts still to import and 3 active Network Device monitors still to create",
      );
    });

    it("uses singular grammar for a remainder of one", () => {
      const summary: string = describe_({
        isTruncated: true,
        devicesCreated: 500,
        hostsPendingImport: 1,
        monitorsPendingCreation: 1,
      });

      expect(summary).toContain("1 host still to import");
      expect(summary).toContain("1 active Network Device monitor still to");
    });

    /*
     * A capped run stops opening scans, so what it counted is a floor. It
     * must not be reported as the total, or the operator reads "409 left",
     * runs it again, and finds more than 409 appear.
     */
    it("reports the remainder as a floor when scans went unread", () => {
      expect(
        describe_({
          isTruncated: true,
          devicesCreated: 500,
          hostsPendingImport: 409,
          hasUnevaluatedScans: true,
        }),
      ).toContain("at least 409 hosts still to import");
    });

    it("quantifies a dry run's remainder without promising a resume", () => {
      const summary: string = describe_({
        isDryRun: true,
        isTruncated: true,
        hostsMatched: 909,
        hostsEvaluated: 909,
        hostsPendingImport: 409,
      });

      expect(summary).toContain(
        "Stopped counting at the run cap with 409 hosts still to import",
      );
      expect(summary).toContain("device-import and active-monitor creation");
      expect(summary).not.toContain("run again to continue");
    });

    /*
     * A pre-#3642 server sends no pending counters, so they parse as zero.
     * The sentence must fall back rather than print "with  —".
     */
    /*
     * The two truncation truths compose. A run that created nothing resumes
     * nowhere (issue #3643), but the remainder is still the size of the
     * problem to fix, so it is named without the "run again" advice.
     */
    it("names the remainder without promising a resume when nothing was created", () => {
      const summary: string = describe_({
        isTruncated: true,
        devicesCreated: 0,
        monitorsCreated: 0,
        monitorsFailed: 500,
        monitorsPendingCreation: 409,
      });

      expect(summary).toContain(
        "Stopped at the run cap without creating anything, with 409 active Network Device monitors still to create.",
      );
      expect(summary).toContain("would repeat the same failures");
      expect(summary).not.toContain("Run again to continue");
    });

    it("falls back to the unquantified sentence with nothing counted", () => {
      const summary: string = describe_({
        isTruncated: true,
        devicesCreated: 5,
      });

      expect(summary).toContain(
        "Stopped at the run cap — run again to continue",
      );
      expect(summary).not.toContain("still to import");
    });

    /*
     * A monitor backfill over an already-imported estate creates no devices
     * at all. "No devices were imported" read as total failure directly
     * above "Created 500 active Network Device monitors".
     */
    it("does not read a monitor backfill as an import that did nothing", () => {
      const summary: string = describe_({
        devicesCreated: 0,
        monitorsCreated: 500,
        hostsEvaluated: 909,
        hostsMatched: 909,
        hostsSkippedAlreadyRegistered: 909,
      });

      expect(summary).toContain("No new network devices were imported.");
      expect(summary).toContain(
        "Created 500 active Network Device monitors from the selected Monitor Template.",
      );
    });

    it("still says nothing happened when nothing happened", () => {
      expect(describe_({ hostsEvaluated: 9, hostsMatched: 0 })).toContain(
        "No devices were imported. This rule matched 0 hosts out of the 9 discovered hosts it looked at.",
      );
    });
  });

  /*
   * The "still working" line a chained press shows between passes. It exists
   * because a run that now spans several requests must not look like a hang.
   */
  describe("progress while the passes are still chaining", () => {
    it("names what has landed so far", () => {
      const progress: string = RuleRunResultUtil.describeAutoImportProgress(
        result({ devicesCreated: 500, monitorsCreated: 500 }),
      );

      expect(progress).toContain(
        "500 hosts imported, 500 active Network Device monitors created so far",
      );
      expect(progress).toContain("leave this open");
    });

    it("says something even before the first pass has created anything", () => {
      expect(RuleRunResultUtil.describeAutoImportProgress(result({}))).toBe(
        "Still importing…",
      );
    });
  });
});
