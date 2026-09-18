import RuleRunSummary from "../../../Utils/NetworkAutomation/RuleRunSummary";
import {
  LabelRuleRunResult,
  SiteAssignmentRuleRunResult,
} from "../../../Types/NetworkAutomation/RuleRunResult";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test - the sentences a "Run now" reports back with.
 *
 * The interesting case is not the happy one. A rule run that changes nothing
 * is the norm once a rule has been run once, and "0 devices assigned" with no
 * reason attached reads as a broken button. Every way a matched device can be
 * left alone therefore has to name itself and, where the operator can do
 * something about it, say what.
 */

function siteRun(
  overrides: Partial<SiteAssignmentRuleRunResult> = {},
): SiteAssignmentRuleRunResult {
  return {
    devicesEvaluated: 0,
    devicesMatched: 0,
    devicesAssigned: 0,
    devicesAlreadyInRuleSite: 0,
    devicesSkippedAlreadyInAnotherSite: 0,
    devicesClaimedByHigherPriorityRule: 0,
    devicesFailed: 0,
    isTruncated: false,
    ...overrides,
  };
}

function labelRun(
  overrides: Partial<LabelRuleRunResult> = {},
): LabelRuleRunResult {
  return {
    devicesEvaluated: 0,
    devicesMatched: 0,
    devicesLabeled: 0,
    labelsAttached: 0,
    labelsFailed: 0,
    isTruncated: false,
    ...overrides,
  };
}

describe("RuleRunSummary.describeSiteAssignmentRun", () => {
  it("leads with what changed", () => {
    const summary: string = RuleRunSummary.describeSiteAssignmentRun(
      siteRun({
        devicesEvaluated: 40,
        devicesMatched: 12,
        devicesAssigned: 12,
      }),
    );

    expect(summary).toContain("Assigned 12 devices to this rule's site.");
  });

  it("uses the singular for a single device", () => {
    const summary: string = RuleRunSummary.describeSiteAssignmentRun(
      siteRun({ devicesEvaluated: 1, devicesMatched: 1, devicesAssigned: 1 }),
    );

    expect(summary).toContain("Assigned 1 device to this rule's site.");
    expect(summary).not.toContain("1 devices");
  });

  /*
   * The whole point of the counters: a run that assigned nothing has to say
   * how much it looked at and how much it matched, or the operator cannot
   * tell a rule that does not match from a rule with nothing left to do.
   */
  it("explains a run that assigned nothing", () => {
    const summary: string = RuleRunSummary.describeSiteAssignmentRun(
      siteRun({ devicesEvaluated: 40, devicesMatched: 0 }),
    );

    expect(summary).toContain("No devices were reassigned.");
    expect(summary).toContain("matched 0 devices out of the 40");
  });

  it("says when the matched devices were already in this rule's site", () => {
    const summary: string = RuleRunSummary.describeSiteAssignmentRun(
      siteRun({
        devicesEvaluated: 40,
        devicesMatched: 12,
        devicesAlreadyInRuleSite: 12,
      }),
    );

    expect(summary).toContain(
      "12 devices already belonged to this rule's site",
    );
  });

  // The skip the operator can undo - so the summary names the switch.
  it("points at the overwrite option when devices were left in another site", () => {
    const summary: string = RuleRunSummary.describeSiteAssignmentRun(
      siteRun({
        devicesEvaluated: 40,
        devicesMatched: 12,
        devicesSkippedAlreadyInAnotherSite: 12,
      }),
    );

    expect(summary).toContain("already belong to another site");
    expect(summary).toContain(
      "Move devices that are already assigned to a site",
    );
  });

  // The skip the operator fixes by running the OTHER rule.
  it("explains a device claimed by a higher-priority rule", () => {
    const summary: string = RuleRunSummary.describeSiteAssignmentRun(
      siteRun({
        devicesEvaluated: 40,
        devicesMatched: 3,
        devicesClaimedByHigherPriorityRule: 3,
      }),
    );

    expect(summary).toContain("matched a higher-priority rule as well");
    expect(summary).toContain("Run that rule to place them.");
  });

  it("reports failures", () => {
    const summary: string = RuleRunSummary.describeSiteAssignmentRun(
      siteRun({
        devicesEvaluated: 40,
        devicesMatched: 4,
        devicesAssigned: 3,
        devicesFailed: 1,
      }),
    );

    expect(summary).toContain("1 device could not be updated");
  });

  it("tells the operator to run again after a truncated run", () => {
    const summary: string = RuleRunSummary.describeSiteAssignmentRun(
      siteRun({
        devicesEvaluated: 10000,
        devicesMatched: 10,
        devicesAssigned: 10,
        isTruncated: true,
      }),
    );

    expect(summary).toContain("Only the first 10000 devices were evaluated");
    expect(summary).toContain("Run the rule again");
  });

  // A run can hit several of these at once; none of them may swallow another.
  it("reports every applicable reason in one summary", () => {
    const summary: string = RuleRunSummary.describeSiteAssignmentRun(
      siteRun({
        devicesEvaluated: 100,
        devicesMatched: 10,
        devicesAssigned: 4,
        devicesAlreadyInRuleSite: 2,
        devicesSkippedAlreadyInAnotherSite: 2,
        devicesClaimedByHigherPriorityRule: 1,
        devicesFailed: 1,
      }),
    );

    expect(summary).toContain("Assigned 4 devices");
    expect(summary).toContain("2 devices already belonged");
    expect(summary).toContain("already belong to another site");
    expect(summary).toContain("higher-priority rule");
    expect(summary).toContain("could not be updated");
  });

  it("stays silent about buckets that are empty", () => {
    const summary: string = RuleRunSummary.describeSiteAssignmentRun(
      siteRun({
        devicesEvaluated: 40,
        devicesMatched: 12,
        devicesAssigned: 12,
      }),
    );

    expect(summary).not.toContain("higher-priority");
    expect(summary).not.toContain("could not be updated");
    expect(summary).not.toContain("Only the first");
  });
});

describe("RuleRunSummary.describeLabelRun", () => {
  it("leads with what was labelled", () => {
    const summary: string = RuleRunSummary.describeLabelRun(
      labelRun({
        devicesEvaluated: 40,
        devicesMatched: 12,
        devicesLabeled: 12,
        labelsAttached: 24,
      }),
    );

    expect(summary).toContain("Labelled 12 devices (24 labels attached).");
  });

  it("uses the singular for a single device and a single label", () => {
    const summary: string = RuleRunSummary.describeLabelRun(
      labelRun({
        devicesEvaluated: 1,
        devicesMatched: 1,
        devicesLabeled: 1,
        labelsAttached: 1,
      }),
    );

    expect(summary).toContain("Labelled 1 device (1 label attached).");
  });

  /*
   * Matching everything and attaching nothing is the signature of a rule that
   * has already been run. Saying so is the difference between "it worked, and
   * there was nothing left to do" and "it did not work".
   */
  it("explains a rule that has already been applied", () => {
    const summary: string = RuleRunSummary.describeLabelRun(
      labelRun({ devicesEvaluated: 40, devicesMatched: 12, devicesLabeled: 0 }),
    );

    expect(summary).toContain("No labels were attached.");
    expect(summary).toContain("matched 12 devices out of the 40");
    expect(summary).toContain(
      "Every matching device already carries this rule's labels",
    );
  });

  // Nothing matched is a different answer, and must not claim otherwise.
  it("does not claim devices are already labelled when nothing matched", () => {
    const summary: string = RuleRunSummary.describeLabelRun(
      labelRun({ devicesEvaluated: 40, devicesMatched: 0 }),
    );

    expect(summary).toContain("No labels were attached.");
    expect(summary).not.toContain("already carries");
  });

  it("reports failures", () => {
    const summary: string = RuleRunSummary.describeLabelRun(
      labelRun({
        devicesEvaluated: 40,
        devicesMatched: 5,
        devicesLabeled: 4,
        labelsAttached: 4,
        labelsFailed: 1,
      }),
    );

    expect(summary).toContain("1 label could not be attached");
  });

  it("tells the operator to run again after a truncated run", () => {
    const summary: string = RuleRunSummary.describeLabelRun(
      labelRun({
        devicesEvaluated: 10000,
        devicesMatched: 10,
        devicesLabeled: 10,
        labelsAttached: 10,
        isTruncated: true,
      }),
    );

    expect(summary).toContain("Only the first 10000 devices were evaluated");
  });

  it("stays silent about buckets that are empty", () => {
    const summary: string = RuleRunSummary.describeLabelRun(
      labelRun({
        devicesEvaluated: 40,
        devicesMatched: 12,
        devicesLabeled: 12,
        labelsAttached: 12,
      }),
    );

    expect(summary).not.toContain("could not be attached");
    expect(summary).not.toContain("Only the first");
  });
});
