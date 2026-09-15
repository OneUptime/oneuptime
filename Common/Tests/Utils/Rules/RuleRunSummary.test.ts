import {
  RuleRunResult,
  RuleRunResultUtil,
  RuleRunType,
} from "../../../Types/Rules/RuleRun";
import RuleRunSummary from "../../../Utils/Rules/RuleRunSummary";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test - what a rule run says it did.
 *
 * Once a rule has been run once, the next run changing nothing is the common
 * case, and "0 updated" with no reason reads as a broken button. Every outcome
 * is therefore phrased on its own: nothing matched, everything matched was
 * already done, some of it could not be done, and the run stopped early.
 */

function result(overrides: Partial<RuleRunResult> = {}): RuleRunResult {
  return {
    ...RuleRunResultUtil.emptyCounts(),
    passes: 1,
    isTruncated: false,
    ownersNotified: false,
    ...overrides,
  };
}

function describeRun(
  ruleType: RuleRunType,
  overrides: Partial<RuleRunResult>,
): string {
  return RuleRunSummary.describe({
    ruleType: ruleType,
    result: result(overrides),
  });
}

describe("RuleRunSummary.describe - label rules", () => {
  it("says how many resources gained labels and how many labels that was", () => {
    expect(
      describeRun(RuleRunType.MonitorLabelRule, {
        resourcesEvaluated: 40,
        resourcesMatched: 12,
        resourcesUpdated: 12,
        itemsAdded: 24,
      }),
    ).toBe("Added labels to 12 monitors (24 labels attached).");
  });

  it("names matched resources that already had the labels", () => {
    expect(
      describeRun(RuleRunType.HostLabelRule, {
        resourcesEvaluated: 40,
        resourcesMatched: 12,
        resourcesUpdated: 1,
        itemsAdded: 1,
      }),
    ).toBe(
      "Added labels to 1 host (1 label attached). 11 hosts already had this rule's labels.",
    );
  });

  it("explains a run that matched everything and added nothing", () => {
    expect(
      describeRun(RuleRunType.IncidentLabelRule, {
        resourcesEvaluated: 500,
        resourcesMatched: 30,
      }),
    ).toBe(
      "No labels were attached. This rule matched 30 incidents out of the 500 incidents it looked at. Every matching incident already has this rule's labels, so there was nothing to add.",
    );
  });

  it("explains a run that matched nothing without claiming it was already done", () => {
    const text: string = describeRun(RuleRunType.ServiceLabelRule, {
      resourcesEvaluated: 7,
    });

    expect(text).toBe(
      "No labels were attached. This rule matched 0 services out of the 7 services it looked at.",
    );
  });

  it("does not count failures as already done", () => {
    const text: string = describeRun(RuleRunType.MonitorLabelRule, {
      resourcesEvaluated: 10,
      resourcesMatched: 3,
      resourcesFailed: 3,
    });

    expect(text).not.toContain("already");
    expect(text).toContain(
      "3 monitors could not be updated. Check the server logs for the reason.",
    );
  });
});

describe("RuleRunSummary.describe - owner rules", () => {
  it("says owners were added and that they were not notified", () => {
    expect(
      describeRun(RuleRunType.AlertOwnerRule, {
        resourcesEvaluated: 90,
        resourcesMatched: 5,
        resourcesUpdated: 5,
        itemsAdded: 10,
      }),
    ).toBe(
      "Added owners to 5 alerts (10 owners assigned). The added owners were not notified.",
    );
  });

  it("says added owners will be notified when the run notified them", () => {
    expect(
      describeRun(RuleRunType.AlertOwnerRule, {
        resourcesEvaluated: 1,
        resourcesMatched: 1,
        resourcesUpdated: 1,
        itemsAdded: 1,
        ownersNotified: true,
      }),
    ).toContain("The added owners will be notified.");
  });

  it("does not talk about notification when nothing was added", () => {
    const text: string = describeRun(RuleRunType.HostOwnerRule, {
      resourcesEvaluated: 4,
      resourcesMatched: 4,
      ownersNotified: true,
    });

    expect(text).not.toContain("notified");
    expect(text).toContain(
      "Every matching host already has this rule's owners, so there was nothing to add.",
    );
  });
});

describe("RuleRunSummary.describe - privacy rules", () => {
  it("says how many resources were made private and how many already were", () => {
    expect(
      describeRun(RuleRunType.IncidentPrivacyRule, {
        resourcesEvaluated: 100,
        resourcesMatched: 9,
        resourcesUpdated: 8,
        itemsAdded: 8,
      }),
    ).toBe("Made 8 incidents private. 1 incident was already private.");
  });

  it("uses the plural verb for several already-private resources", () => {
    expect(
      describeRun(RuleRunType.AlertEpisodePrivacyRule, {
        resourcesEvaluated: 10,
        resourcesMatched: 5,
        resourcesUpdated: 2,
        itemsAdded: 2,
      }),
    ).toBe(
      "Made 2 alert episodes private. 3 alert episodes were already private.",
    );
  });

  it("explains a run where everything was already private", () => {
    expect(
      describeRun(RuleRunType.IncidentEpisodePrivacyRule, {
        resourcesEvaluated: 10,
        resourcesMatched: 2,
      }),
    ).toBe(
      "No incident episodes were made private. This rule matched 2 incident episodes out of the 10 incident episodes it looked at. Every matching incident episode is already private, so there was nothing to change.",
    );
  });
});

describe("RuleRunSummary.describe - status page monitor rules", () => {
  it("lists what the sync changed", () => {
    expect(
      describeRun(RuleRunType.StatusPageMonitorRule, {
        itemsAdded: 3,
        itemsRemoved: 1,
        resourcesUpdated: 2,
      }),
    ).toBe(
      "Added 3 monitors to the status page, removed 1 monitor this rule no longer matches, refreshed the display settings of 2 monitors.",
    );
  });

  it("says a page already in step changed nothing", () => {
    expect(describeRun(RuleRunType.StatusPageMonitorRule, {})).toBe(
      "The status page already matches this rule, so nothing changed.",
    );
  });
});

describe("RuleRunSummary.describe - truncation", () => {
  it("says the run stopped and that running again continues safely", () => {
    const text: string = describeRun(RuleRunType.MonitorLabelRule, {
      resourcesEvaluated: 100000,
      resourcesMatched: 100000,
      resourcesUpdated: 100000,
      itemsAdded: 100000,
      isTruncated: true,
    });

    expect(text).toContain(
      "The run stopped after evaluating 100000 monitors so that it stays bounded.",
    );
    expect(text).toContain("monitors it already updated are skipped");
  });
});

describe("RuleRunSummary.describeConfirmation", () => {
  it.each([
    [RuleRunType.MonitorLabelRule, "attach its labels", "monitors"],
    [
      RuleRunType.KubernetesClusterOwnerRule,
      "add its owners",
      "Kubernetes clusters",
    ],
    [
      RuleRunType.AlertPrivacyRule,
      "make the ones it matches private",
      "alerts",
    ],
  ])(
    "%s describes what the run does to which resources",
    (ruleType: RuleRunType, action: string, resources: string) => {
      const text: string = RuleRunSummary.describeConfirmation(ruleType);

      expect(text).toContain(action);
      expect(text).toContain(resources);
      expect(text).toContain("running this more than once is safe");
    },
  );

  it("says a status page sync never touches hand-added monitors", () => {
    expect(
      RuleRunSummary.describeConfirmation(RuleRunType.StatusPageMonitorRule),
    ).toContain("Monitors added to the page by hand are never touched.");
  });
});

describe("RuleRunSummary.describeBulkConfirmation", () => {
  it("counts the selected rules", () => {
    expect(
      RuleRunSummary.describeBulkConfirmation({
        ruleType: RuleRunType.HostLabelRule,
        ruleCount: 1,
      }),
    ).toContain("Run 1 selected rule against the hosts");
    expect(
      RuleRunSummary.describeBulkConfirmation({
        ruleType: RuleRunType.HostLabelRule,
        ruleCount: 4,
      }),
    ).toContain("Run 4 selected rules against the hosts");
  });

  it("warns that a bulk owner run does not notify", () => {
    expect(
      RuleRunSummary.describeBulkConfirmation({
        ruleType: RuleRunType.IncidentOwnerRule,
        ruleCount: 2,
      }),
    ).toContain("Owners added by a bulk run are not notified.");
    expect(
      RuleRunSummary.describeBulkConfirmation({
        ruleType: RuleRunType.IncidentLabelRule,
        ruleCount: 2,
      }),
    ).not.toContain("notified");
  });

  it("describes a bulk status page re-sync", () => {
    expect(
      RuleRunSummary.describeBulkConfirmation({
        ruleType: RuleRunType.StatusPageMonitorRule,
        ruleCount: 3,
      }),
    ).toContain("Re-sync this status page against 3 selected rules?");
  });
});

describe("RuleRunSummary.describeProgress", () => {
  it("says how far the run has got", () => {
    expect(
      RuleRunSummary.describeProgress({
        ruleType: RuleRunType.IncidentLabelRule,
        result: result({ resourcesEvaluated: 400, resourcesUpdated: 12 }),
      }),
    ).toBe(
      "Evaluated 400 incidents so far, and updated 12. Still running — leave this open.",
    );
  });
});
