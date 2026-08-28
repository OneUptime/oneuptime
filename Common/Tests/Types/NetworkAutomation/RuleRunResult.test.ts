import {
  AutoImportRuleRunResult,
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

describe("RuleRunResultUtil.parseAutoImportRuleRunResult", () => {
  it("reads the device and active-monitor outcome independently", () => {
    const parsed: AutoImportRuleRunResult =
      RuleRunResultUtil.parseAutoImportRuleRunResult({
        hostsEvaluated: 20,
        hostsMatched: 10,
        hostsExcluded: 2,
        hostsSkippedAlreadyRegistered: 3,
        devicesCreated: 4,
        devicesFailed: 1,
        monitorsWouldCreate: 0,
        monitorsCreated: 3,
        monitorsSkippedAlreadyExisting: 2,
        monitorsSkippedUnsupportedHost: 1,
        monitorsFailed: 1,
        isTruncated: true,
        hasMoreScans: true,
        isDryRun: false,
        matchedIpAddressSample: ["10.0.0.1", "10.0.0.2"],
      } as JSONObject);

    expect(parsed).toEqual({
      hostsEvaluated: 20,
      hostsMatched: 10,
      hostsExcluded: 2,
      hostsSkippedAlreadyRegistered: 3,
      devicesCreated: 4,
      devicesFailed: 1,
      monitorsWouldCreate: 0,
      monitorsCreated: 3,
      monitorsSkippedAlreadyExisting: 2,
      monitorsSkippedUnsupportedHost: 1,
      monitorsFailed: 1,
      isTruncated: true,
      hasMoreScans: true,
      isDryRun: false,
      matchedIpAddressSample: ["10.0.0.1", "10.0.0.2"],
    });
  });

  it("reads every missing monitor counter as zero for older servers", () => {
    const parsed: AutoImportRuleRunResult =
      RuleRunResultUtil.parseAutoImportRuleRunResult({
        hostsEvaluated: 1,
      });

    expect(parsed.monitorsWouldCreate).toBe(0);
    expect(parsed.monitorsCreated).toBe(0);
    expect(parsed.monitorsSkippedAlreadyExisting).toBe(0);
    expect(parsed.monitorsSkippedUnsupportedHost).toBe(0);
    expect(parsed.monitorsFailed).toBe(0);
  });

  it("refuses malformed and non-finite monitor counters", () => {
    const parsed: AutoImportRuleRunResult =
      RuleRunResultUtil.parseAutoImportRuleRunResult({
        monitorsWouldCreate: "4",
        monitorsCreated: Number.NaN,
        monitorsSkippedAlreadyExisting: null,
        monitorsSkippedUnsupportedHost: {},
        monitorsFailed: Number.POSITIVE_INFINITY,
      } as unknown as JSONObject);

    expect(parsed.monitorsWouldCreate).toBe(0);
    expect(parsed.monitorsCreated).toBe(0);
    expect(parsed.monitorsSkippedAlreadyExisting).toBe(0);
    expect(parsed.monitorsSkippedUnsupportedHost).toBe(0);
    expect(parsed.monitorsFailed).toBe(0);
  });

  it("keeps only a bounded sample of string IP addresses", () => {
    const sample: Array<unknown> = Array.from(
      { length: 60 },
      (_value: unknown, index: number): unknown => {
        return index === 1 ? 42 : `10.0.0.${index}`;
      },
    );

    const parsed: AutoImportRuleRunResult =
      RuleRunResultUtil.parseAutoImportRuleRunResult({
        matchedIpAddressSample: sample,
      } as unknown as JSONObject);

    expect(parsed.matchedIpAddressSample).toHaveLength(50);
    expect(parsed.matchedIpAddressSample).not.toContain(42);
  });

  it("treats only literal true as dry-run and truncation flags", () => {
    const parsed: AutoImportRuleRunResult =
      RuleRunResultUtil.parseAutoImportRuleRunResult({
        isDryRun: "true",
        isTruncated: 1,
        hasMoreScans: true,
      } as unknown as JSONObject);

    expect(parsed.isDryRun).toBe(false);
    expect(parsed.isTruncated).toBe(false);
    expect(parsed.hasMoreScans).toBe(true);
  });
});
