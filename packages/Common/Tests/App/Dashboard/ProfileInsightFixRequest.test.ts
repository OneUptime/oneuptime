import { describe, expect, test } from "@jest/globals";
import {
  doesInsightOfferProfileFix,
  getProfileInsightFixRequest,
  getProfileInsightMonitorRoute,
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

// Create Monitor's address, whatever project it is under.
const MONITOR_CREATE_PATH: RegExp = /\/monitors\/create$/;

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

/*
 * What a slow-code finding's Create Monitor opens
 * (getProfileInsightMonitorRoute): the Profiler's own monitor on the
 * function - the one its function panel offers - with a threshold above
 * the share it takes now, so it alerts when it grows, not once it is saved.
 * The UI review found the button greyed out on every finding ("Monitors
 * cannot be created from this kind of insight yet").
 */
describe("getProfileInsightMonitorRoute", () => {
  function queryOf(route: unknown): URLSearchParams {
    const address: string = String(route);

    return new URLSearchParams(address.substring(address.indexOf("?") + 1));
  }

  test("a Profiles monitor of the function in its service, for the kind it was found in", () => {
    const route: unknown = getProfileInsightMonitorRoute(EVIDENCE);
    const query: URLSearchParams = queryOf(route);

    expect(String(route).split("?")[0]).toMatch(MONITOR_CREATE_PATH);
    expect(query.get("profileServiceId")).toBe(EVIDENCE.serviceId);
    expect(query.get("profileFunction")).toBe("OrderParser.parse");
    expect(query.get("profileType")).toBe("cpu");
  });

  test("its threshold is above the whole share the function takes now", () => {
    // 600 of 5000 samples: 12%, the share named too. 12 + 10, to the next 5.
    expect(
      queryOf(getProfileInsightMonitorRoute(EVIDENCE)).get("profileThreshold"),
    ).toBe("25");

    /*
     * Its samples hold more than its own-code share (code of its own it
     * calls): the monitor reads every stack it is in, so the larger one
     * decides. 2000 of 5000 is 40%: 40 + 20, to the next 5.
     */
    expect(
      queryOf(
        getProfileInsightMonitorRoute({
          ...EVIDENCE,
          functionSampleCount: 2000,
        }),
      ).get("profileThreshold"),
    ).toBe("60");
  });

  test("a service id that is not one is left out, and the kind falls back to CPU time", () => {
    const query: URLSearchParams = queryOf(
      getProfileInsightMonitorRoute({
        ...EVIDENCE,
        serviceId: "checkout",
        profileType: "",
        category: "",
      }),
    );

    expect(query.get("profileServiceId")).toBeNull();
    expect(query.get("profileType")).toBe("cpu");
  });

  test.each([
    ["no evidence", undefined],
    ["no function", { ...EVIDENCE, functionName: "  " }],
  ])("nothing to watch with %s", (_name: string, evidence: unknown) => {
    expect(
      getProfileInsightMonitorRoute(evidence as ProfileInsightEvidence),
    ).toBeNull();
  });
});
