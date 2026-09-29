import {
  AutoImportRuleRunResult,
  RuleRunResultUtil,
} from "../../../Types/NetworkAutomation/RuleRunResult";
import { describe, expect, it } from "@jest/globals";

/*
 * One press of "Run Rule" is now several capped server passes
 * (OneUptime issue #3642), and this is the arithmetic that turns them back
 * into one report. It is the part most easily got wrong: every pass re-reads
 * the SAME scans, so most counters describe the estate rather than the work,
 * and summing them would multiply the estate by the pass count.
 */

function pass(
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

describe("RuleRunResultUtil.mergeAutoImportRunPasses", () => {
  it("returns a single pass unchanged", () => {
    const only: AutoImportRuleRunResult = pass({ devicesCreated: 7 });

    expect(RuleRunResultUtil.mergeAutoImportRunPasses([only])).toBe(only);
  });

  it("refuses to invent a report out of no passes", () => {
    expect(() => {
      return RuleRunResultUtil.mergeAutoImportRunPasses([]);
    }).toThrow("at least one run result");
  });

  /*
   * The issue's own numbers: 909 hosts, a 500-per-pass cap, two passes.
   */
  it("sums the work done and keeps the estate from the first pass", () => {
    const merged: AutoImportRuleRunResult =
      RuleRunResultUtil.mergeAutoImportRunPasses([
        pass({
          hostsEvaluated: 909,
          hostsMatched: 909,
          devicesCreated: 500,
          hostsPendingImport: 409,
          isTruncated: true,
        }),
        pass({
          hostsEvaluated: 909,
          hostsMatched: 909,
          hostsSkippedAlreadyRegistered: 500,
          devicesCreated: 409,
        }),
      ]);

    expect(merged.devicesCreated).toBe(909);
    // Not 1,818: the second pass looked at the same 909 hosts.
    expect(merged.hostsEvaluated).toBe(909);
    expect(merged.hostsMatched).toBe(909);
    /*
     * And not 500 either. Reporting the run's own creates back as
     * "already registered" would contradict "imported 909" in the same
     * paragraph.
     */
    expect(merged.hostsSkippedAlreadyRegistered).toBe(0);
    expect(merged.isTruncated).toBe(false);
    expect(merged.hostsPendingImport).toBe(0);
  });

  it("sums monitor work and failures across passes", () => {
    const merged: AutoImportRuleRunResult =
      RuleRunResultUtil.mergeAutoImportRunPasses([
        pass({
          monitorsCreated: 500,
          monitorsFailed: 2,
          devicesFailed: 1,
          monitorsSkippedAlreadyExisting: 4,
          monitorsSkippedUnsupportedHost: 3,
          isTruncated: true,
        }),
        pass({ monitorsCreated: 409, monitorsFailed: 1 }),
      ]);

    expect(merged.monitorsCreated).toBe(909);
    expect(merged.monitorsFailed).toBe(3);
    expect(merged.devicesFailed).toBe(1);
    // Estate state, not work: taken from the first pass, never doubled.
    expect(merged.monitorsSkippedAlreadyExisting).toBe(4);
    expect(merged.monitorsSkippedUnsupportedHost).toBe(3);
  });

  it("carries the last pass's leftovers, not the first pass's", () => {
    const merged: AutoImportRuleRunResult =
      RuleRunResultUtil.mergeAutoImportRunPasses([
        pass({
          devicesCreated: 500,
          hostsPendingImport: 900,
          monitorsPendingCreation: 900,
          hasUnevaluatedScans: true,
          isTruncated: true,
        }),
        pass({
          devicesCreated: 500,
          hostsPendingImport: 400,
          monitorsPendingCreation: 400,
          hasUnevaluatedScans: false,
          hasMoreScans: true,
          isTruncated: true,
        }),
      ]);

    expect(merged.hostsPendingImport).toBe(400);
    expect(merged.monitorsPendingCreation).toBe(400);
    expect(merged.hasUnevaluatedScans).toBe(false);
    expect(merged.hasMoreScans).toBe(true);
    expect(merged.isTruncated).toBe(true);
  });

  /*
   * The sample answers "which hosts is this rule claiming". Drawn before the
   * run changed anything, it still does; drawn from the final pass it would
   * be whatever happened to be left over.
   */
  it("keeps the first pass's host sample", () => {
    const merged: AutoImportRuleRunResult =
      RuleRunResultUtil.mergeAutoImportRunPasses([
        pass({
          devicesCreated: 1,
          isTruncated: true,
          matchedIpAddressSample: ["10.0.0.1"],
        }),
        pass({ devicesCreated: 1, matchedIpAddressSample: ["10.9.9.9"] }),
      ]);

    expect(merged.matchedIpAddressSample).toEqual(["10.0.0.1"]);
  });

  /*
   * Failure reasons are what issue #3643 added to this report, and across a
   * chain they are a set: the same fault reappears in every pass, and a
   * different fault in a later pass is exactly what has to be surfaced.
   */
  it("deduplicates failure reasons across passes and keeps new ones", () => {
    const merged: AutoImportRuleRunResult =
      RuleRunResultUtil.mergeAutoImportRunPasses([
        pass({
          devicesCreated: 500,
          monitorsFailed: 1,
          monitorFailureReasons: ["Template could not be loaded."],
          deviceFailureReasons: ["Name already taken."],
          isTruncated: true,
        }),
        pass({
          devicesCreated: 400,
          monitorsFailed: 2,
          monitorFailureReasons: [
            "Template could not be loaded.",
            "Monitor limit reached.",
          ],
          deviceFailureReasons: ["Name already taken."],
        }),
      ]);

    expect(merged.monitorFailureReasons).toEqual([
      "Template could not be loaded.",
      "Monitor limit reached.",
    ]);
    expect(merged.deviceFailureReasons).toEqual(["Name already taken."]);
  });

  it("caps the merged reason list the way one pass is capped", () => {
    const merged: AutoImportRuleRunResult =
      RuleRunResultUtil.mergeAutoImportRunPasses([
        pass({
          devicesCreated: 1,
          isTruncated: true,
          monitorFailureReasons: ["one", "two"],
        }),
        pass({ devicesCreated: 1, monitorFailureReasons: ["three", "four"] }),
      ]);

    expect(merged.monitorFailureReasons).toEqual(["one", "two", "three"]);
  });

  /*
   * Halting is a property of the pass that halted, and the chain stops after
   * one — so reading only the last pass would lose it.
   */
  it("reports a halt from any pass, not only the last", () => {
    const merged: AutoImportRuleRunResult =
      RuleRunResultUtil.mergeAutoImportRunPasses([
        pass({
          devicesCreated: 500,
          monitorProvisioningHalted: true,
          isTruncated: true,
        }),
        pass({ devicesCreated: 400, monitorProvisioningHalted: false }),
      ]);

    expect(merged.monitorProvisioningHalted).toBe(true);
  });

  it("keeps the dry-run flag so a preview never reads as a write", () => {
    const merged: AutoImportRuleRunResult =
      RuleRunResultUtil.mergeAutoImportRunPasses([
        pass({ isDryRun: true, monitorsWouldCreate: 500, isTruncated: true }),
        pass({ isDryRun: true, monitorsWouldCreate: 9 }),
      ]);

    expect(merged.isDryRun).toBe(true);
    expect(merged.monitorsWouldCreate).toBe(509);
  });
});
