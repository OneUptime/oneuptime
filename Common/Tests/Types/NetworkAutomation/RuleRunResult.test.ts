import {
  LabelRuleRunResult,
  RuleRunResultUtil,
  SiteAssignmentRuleRunResult,
} from "../../../Types/NetworkAutomation/RuleRunResult";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test - narrowing a rule run's response.
 *
 * The dashboard renders these counters straight into a sentence, so anything
 * the parser lets through untyped ends up on screen. A field the server did
 * not send has to read as zero, not as "NaN devices"; isTruncated has to be a
 * real boolean, not whatever truthy value happened to arrive.
 */

describe("RuleRunResultUtil.parseSiteAssignmentRuleRunResult", () => {
  it("reads a full response", () => {
    const parsed: SiteAssignmentRuleRunResult =
      RuleRunResultUtil.parseSiteAssignmentRuleRunResult({
        devicesEvaluated: 40,
        devicesMatched: 12,
        devicesAssigned: 8,
        devicesAlreadyInRuleSite: 2,
        devicesSkippedAlreadyInAnotherSite: 1,
        devicesClaimedByHigherPriorityRule: 1,
        devicesFailed: 0,
        isTruncated: false,
      } as JSONObject);

    expect(parsed).toEqual({
      devicesEvaluated: 40,
      devicesMatched: 12,
      devicesAssigned: 8,
      devicesAlreadyInRuleSite: 2,
      devicesSkippedAlreadyInAnotherSite: 1,
      devicesClaimedByHigherPriorityRule: 1,
      devicesFailed: 0,
      isTruncated: false,
    });
  });

  it("reads every missing counter as zero", () => {
    const parsed: SiteAssignmentRuleRunResult =
      RuleRunResultUtil.parseSiteAssignmentRuleRunResult({});

    expect(parsed).toEqual({
      devicesEvaluated: 0,
      devicesMatched: 0,
      devicesAssigned: 0,
      devicesAlreadyInRuleSite: 0,
      devicesSkippedAlreadyInAnotherSite: 0,
      devicesClaimedByHigherPriorityRule: 0,
      devicesFailed: 0,
      isTruncated: false,
    });
  });

  it("survives a null or undefined body", () => {
    expect(
      RuleRunResultUtil.parseSiteAssignmentRuleRunResult(null).devicesEvaluated,
    ).toBe(0);
    expect(
      RuleRunResultUtil.parseSiteAssignmentRuleRunResult(undefined)
        .devicesMatched,
    ).toBe(0);
  });

  /*
   * A numeric string is exactly what a hand-rolled proxy or a JSON layer that
   * stringifies large numbers would send. It must not become "12" concatenated
   * into a sentence, nor NaN.
   */
  it("refuses a non-numeric counter rather than passing it through", () => {
    const parsed: SiteAssignmentRuleRunResult =
      RuleRunResultUtil.parseSiteAssignmentRuleRunResult({
        devicesEvaluated: "40",
        devicesMatched: null,
        devicesAssigned: {},
      } as unknown as JSONObject);

    expect(parsed.devicesEvaluated).toBe(0);
    expect(parsed.devicesMatched).toBe(0);
    expect(parsed.devicesAssigned).toBe(0);
  });

  it("refuses NaN and Infinity", () => {
    const parsed: SiteAssignmentRuleRunResult =
      RuleRunResultUtil.parseSiteAssignmentRuleRunResult({
        devicesEvaluated: Number.NaN,
        devicesMatched: Number.POSITIVE_INFINITY,
      } as unknown as JSONObject);

    expect(parsed.devicesEvaluated).toBe(0);
    expect(parsed.devicesMatched).toBe(0);
  });

  it("treats only a literal true as truncation", () => {
    expect(
      RuleRunResultUtil.parseSiteAssignmentRuleRunResult({
        isTruncated: true,
      }).isTruncated,
    ).toBe(true);

    expect(
      RuleRunResultUtil.parseSiteAssignmentRuleRunResult({
        isTruncated: "true",
      } as unknown as JSONObject).isTruncated,
    ).toBe(false);

    expect(
      RuleRunResultUtil.parseSiteAssignmentRuleRunResult({
        isTruncated: 1,
      } as unknown as JSONObject).isTruncated,
    ).toBe(false);
  });

  // Unknown fields are dropped: the shape the UI reads is the declared one.
  it("ignores fields it does not know", () => {
    const parsed: SiteAssignmentRuleRunResult =
      RuleRunResultUtil.parseSiteAssignmentRuleRunResult({
        devicesEvaluated: 3,
        somethingElse: "ignored",
      } as unknown as JSONObject);

    expect(parsed.devicesEvaluated).toBe(3);
    expect(Object.keys(parsed)).not.toContain("somethingElse");
  });
});

describe("RuleRunResultUtil.parseLabelRuleRunResult", () => {
  it("reads a full response", () => {
    const parsed: LabelRuleRunResult =
      RuleRunResultUtil.parseLabelRuleRunResult({
        devicesEvaluated: 40,
        devicesMatched: 12,
        devicesLabeled: 10,
        labelsAttached: 20,
        labelsFailed: 0,
        isTruncated: true,
      } as JSONObject);

    expect(parsed).toEqual({
      devicesEvaluated: 40,
      devicesMatched: 12,
      devicesLabeled: 10,
      labelsAttached: 20,
      labelsFailed: 0,
      isTruncated: true,
    });
  });

  it("reads every missing counter as zero", () => {
    const parsed: LabelRuleRunResult =
      RuleRunResultUtil.parseLabelRuleRunResult({});

    expect(parsed).toEqual({
      devicesEvaluated: 0,
      devicesMatched: 0,
      devicesLabeled: 0,
      labelsAttached: 0,
      labelsFailed: 0,
      isTruncated: false,
    });
  });

  it("survives a null body", () => {
    expect(RuleRunResultUtil.parseLabelRuleRunResult(null).labelsAttached).toBe(
      0,
    );
  });

  it("refuses a non-numeric counter", () => {
    const parsed: LabelRuleRunResult =
      RuleRunResultUtil.parseLabelRuleRunResult({
        labelsAttached: "20",
        devicesLabeled: false,
      } as unknown as JSONObject);

    expect(parsed.labelsAttached).toBe(0);
    expect(parsed.devicesLabeled).toBe(0);
  });
});
