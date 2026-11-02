import { describe, expect, it } from "@jest/globals";
import {
  RuleRunResourceNouns,
  RuleRunResult,
  RuleRunType,
  RuleRunTypeMetadata,
  RuleRunTypeUtil,
} from "../../../Types/Rules/RuleRun";
import RuleRunSummary from "../../../Utils/Rules/RuleRunSummary";

/*
 * One table of cloud rules serves two products: Cloud, whose rows are cloud
 * resources - the rule models' own word - and App Platforms, whose rows are
 * the environments its apps run in. Run Now from App Platforms runs over
 * environments, and says so: every sentence of a run takes the page's
 * nouns, and keeps the model's when the page names none.
 */

const ENVIRONMENTS: RuleRunResourceNouns = {
  resourceSingular: "cloud environment",
  resourcePlural: "cloud environments",
};

function result(data: Partial<RuleRunResult>): RuleRunResult {
  return {
    resourcesEvaluated: 0,
    resourcesMatched: 0,
    resourcesUpdated: 0,
    itemsAdded: 0,
    itemsRemoved: 0,
    resourcesFailed: 0,
    passes: 1,
    isTruncated: false,
    ownersNotified: false,
    ...data,
  };
}

describe("a rule type's metadata with a page's nouns", () => {
  it("keeps the action and takes the page's nouns", () => {
    const meta: RuleRunTypeMetadata = RuleRunTypeUtil.getMetadata(
      RuleRunType.CloudResourceOwnerRule,
      ENVIRONMENTS,
    );

    expect(meta).toEqual({
      ...RuleRunTypeUtil.getMetadata(RuleRunType.CloudResourceOwnerRule),
      resourceSingular: "cloud environment",
      resourcePlural: "cloud environments",
    });
  });

  it("is the model's own without them, and never changes the shared table", () => {
    expect(
      RuleRunTypeUtil.getMetadata(RuleRunType.CloudResourceOwnerRule),
    ).toMatchObject({
      resourceSingular: "cloud resource",
      resourcePlural: "cloud resources",
    });

    RuleRunTypeUtil.getMetadata(
      RuleRunType.CloudResourceLabelRule,
      ENVIRONMENTS,
    );

    expect(
      RuleRunTypeUtil.getMetadata(RuleRunType.CloudResourceLabelRule),
    ).toMatchObject({ resourceSingular: "cloud resource" });
  });
});

describe("every sentence of a run in the page's nouns", () => {
  it("the Run Now card", () => {
    expect(
      RuleRunSummary.describeRunNowCard(
        RuleRunType.CloudResourceOwnerRule,
        ENVIRONMENTS,
      ),
    ).toBe(
      "This rule runs only when a cloud environment is created. Run it now for the cloud environments that already exist.",
    );
    expect(
      RuleRunSummary.describeRunNowCard(RuleRunType.CloudResourceOwnerRule),
    ).toBe(
      "This rule runs only when a cloud resource is created. Run it now for the cloud resources that already exist.",
    );
  });

  it("the confirmation", () => {
    expect(
      RuleRunSummary.describeConfirmation(
        RuleRunType.CloudResourceLabelRule,
        ENVIRONMENTS,
      ),
    ).toBe(
      "Attach this rule's labels to the existing cloud environments it matches. Labels are only added, never removed, so running this more than once is safe.",
    );
  });

  it("the bulk confirmation", () => {
    expect(
      RuleRunSummary.describeBulkConfirmation({
        ruleType: RuleRunType.CloudResourceOwnerRule,
        ruleCount: 2,
        nouns: ENVIRONMENTS,
      }),
    ).toContain(
      "Run 2 selected rules on the cloud environments that already exist?",
    );
  });

  it("the progress line", () => {
    expect(
      RuleRunSummary.describeProgress({
        ruleType: RuleRunType.CloudResourceLabelRule,
        result: result({ resourcesEvaluated: 1, resourcesUpdated: 1 }),
        nouns: ENVIRONMENTS,
      }),
    ).toBe(
      "Evaluated 1 cloud environment so far, and updated 1. Still running — leave this open.",
    );
  });

  it("the report", () => {
    const report: string = RuleRunSummary.describe({
      ruleType: RuleRunType.CloudResourceOwnerRule,
      result: result({
        resourcesEvaluated: 6,
        resourcesMatched: 2,
        resourcesUpdated: 2,
        itemsAdded: 2,
      }),
      nouns: ENVIRONMENTS,
    });

    expect(report).toContain("Added owners to 2 cloud environments");
    expect(report).not.toContain("cloud resource");
  });

  it("an article that agrees with the page's noun", () => {
    expect(
      RuleRunSummary.describeRunNowCard(RuleRunType.CloudResourceOwnerRule, {
        resourceSingular: "environment",
        resourcePlural: "environments",
      }),
    ).toContain("when an environment is created");
  });
});
