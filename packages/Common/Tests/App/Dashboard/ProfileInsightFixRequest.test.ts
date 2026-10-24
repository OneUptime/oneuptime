import { describe, expect, test } from "@jest/globals";
import {
  doesInsightOfferProfileFix,
  getProfileInsightFixRequest,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/ProfileInsightFixRequest";
import { ProfileInsightEvidence } from "../../../Types/AI/AIInsightEvidence";
import AIInsightStatus from "../../../Types/AI/AIInsightStatus";
import AIInsightType from "../../../Types/AI/AIInsightType";
import ObjectID from "../../../Types/ObjectID";

/*
 * What a slow-code finding offers "Fix with AI" for
 * (Components/TelemetryAi/ProfileInsightFixRequest): the request the
 * Profiler's function panel sends, built from the finding's evidence, and
 * only while the finding is open with no fix linked.
 */

const EVIDENCE: ProfileInsightEvidence = {
  serviceId: "5092cdcd-0000-4000-8000-000000000001",
  functionName: "OrderParser.parse",
  fileName: "src/orders/parser.ts",
  lineNumber: 42,
  profileType: "cpu",
  category: "cpu",
  reason: "Grew",
  ownShare: 12,
  ownShareBefore: 1.5,
  functionSampleCount: 600,
  windowSampleCount: 5000,
  windowStartTime: "2026-10-24T08:00:00.000Z",
  windowEndTime: "2026-10-24T09:00:00.000Z",
  baselineStartTime: "2026-10-23T08:00:00.000Z",
  baselineEndTime: "2026-10-23T09:00:00.000Z",
  callers: [],
  callees: [],
};

describe("getProfileInsightFixRequest", () => {
  test("the function, in the window it was found in, against the window it was compared with", () => {
    expect(getProfileInsightFixRequest(EVIDENCE)).toEqual({
      serviceId: EVIDENCE.serviceId,
      functionName: "OrderParser.parse",
      fileName: "src/orders/parser.ts",
      profileType: "cpu",
      window: {
        startTime: new Date("2026-10-24T08:00:00.000Z"),
        endTime: new Date("2026-10-24T09:00:00.000Z"),
      },
      beforeWindow: {
        startTime: new Date("2026-10-23T08:00:00.000Z"),
        endTime: new Date("2026-10-23T09:00:00.000Z"),
      },
    });
  });

  test("a function that was hot, not grown, is compared with nothing", () => {
    const hot: ProfileInsightEvidence = { ...EVIDENCE, reason: "Hot" };
    delete hot.baselineStartTime;
    delete hot.baselineEndTime;

    expect(getProfileInsightFixRequest(hot)?.beforeWindow).toBeUndefined();
  });

  test.each([
    ["no evidence", undefined],
    ["no service", { ...EVIDENCE, serviceId: "" }],
    ["no function", { ...EVIDENCE, functionName: "" }],
    ["a window that is not a time", { ...EVIDENCE, windowStartTime: "soon" }],
    [
      "a window that ends before it starts",
      {
        ...EVIDENCE,
        windowStartTime: EVIDENCE.windowEndTime,
        windowEndTime: EVIDENCE.windowStartTime,
      },
    ],
  ])("nothing to ask for with %s", (_name: string, evidence: unknown) => {
    expect(
      getProfileInsightFixRequest(evidence as ProfileInsightEvidence),
    ).toBeNull();
  });

  test("a baseline that does not hold together is left out, not the request", () => {
    expect(
      getProfileInsightFixRequest({ ...EVIDENCE, baselineEndTime: "never" })
        ?.beforeWindow,
    ).toBeUndefined();
  });
});

describe("doesInsightOfferProfileFix", () => {
  const OPEN: Parameters<typeof doesInsightOfferProfileFix>[0] = {
    insightType: AIInsightType.ProfileHotspot,
    status: AIInsightStatus.ActionRequired,
    evidence: { profile: EVIDENCE },
  };

  test("an open slow-code finding with no fix yet offers it", () => {
    expect(doesInsightOfferProfileFix(OPEN)).toBe(true);
  });

  test.each([
    ["a fix already linked", { ...OPEN, fixAiRunId: ObjectID.generate() }],
    ["a resolved finding", { ...OPEN, status: AIInsightStatus.Resolved }],
    ["a dismissed finding", { ...OPEN, status: AIInsightStatus.Dismissed }],
    ["a status not read yet", { ...OPEN, status: null }],
    [
      "another kind of finding",
      { ...OPEN, insightType: AIInsightType.TraceLatencyRegression },
    ],
    ["no profile evidence", { ...OPEN, evidence: {} }],
  ])("%s offers nothing", (_name: string, insight: unknown) => {
    expect(
      doesInsightOfferProfileFix(
        insight as Parameters<typeof doesInsightOfferProfileFix>[0],
      ),
    ).toBe(false);
  });
});
