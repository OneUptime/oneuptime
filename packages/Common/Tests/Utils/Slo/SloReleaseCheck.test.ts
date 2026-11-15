import { describe, expect, test } from "@jest/globals";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import {
  SLO_RELEASE_CHECK_DEFAULT_MAX_BURN_RATE,
  SLO_RELEASE_CHECK_DEFAULT_MINIMUM_REQUEST_COUNT,
  SLO_RELEASE_CHECK_DEFAULT_WINDOW_MINUTES,
  SLO_RELEASE_CHECK_ERRORS,
  SLO_RELEASE_CHECK_MAX_WINDOW_MINUTES,
  SLO_RELEASE_CHECK_ROUTE,
  SLO_RELEASE_CHECK_VERSION_ATTRIBUTE,
  SloReleaseCheckDecision,
  SloReleaseCheckOptions,
  SloReleaseCheckVerdict,
  buildSloReleaseCheckResponse,
  decideSloReleaseCheck,
  parseSloReleaseCheckOptions,
} from "../../../Utils/Slo/SloReleaseCheck";

/*
 * The release check's options, verdict and answer.
 *
 * A rollout tool reads the answer's field names and a pipeline greps its
 * verdict, so they are pinned here as an API: `isSafeToContinue` and
 * `verdict` never change name, and a freeze, too few requests and a fast
 * burn each say so in a sentence a person can read in a rollout's events.
 */

function optionsOf(
  overrides: Partial<SloReleaseCheckOptions> = {},
): SloReleaseCheckOptions {
  return {
    ...parseSloReleaseCheckOptions({}),
    ...overrides,
  };
}

function expectRefused(input: JSONObject, message: string): void {
  expect(() => {
    parseSloReleaseCheckOptions(input);
  }).toThrow(BadDataException);
  expect(() => {
    parseSloReleaseCheckOptions(input);
  }).toThrow(message);
}

describe("the release check's address and defaults", () => {
  test("it lives at /:id/release-check", () => {
    expect(SLO_RELEASE_CHECK_ROUTE).toBe("/release-check");
  });

  test("ten minutes, the SLO's own target (1x), and at least one request", () => {
    expect(parseSloReleaseCheckOptions({})).toEqual({
      windowInMinutes: 10,
      maxBurnRate: 1,
      minimumRequestCount: 1,
      serviceVersion: null,
      includeDeploymentGate: true,
      failWithStatusCode: false,
    });
    expect(SLO_RELEASE_CHECK_DEFAULT_WINDOW_MINUTES).toBe(10);
    expect(SLO_RELEASE_CHECK_DEFAULT_MAX_BURN_RATE).toBe(1);
    expect(SLO_RELEASE_CHECK_DEFAULT_MINIMUM_REQUEST_COUNT).toBe(1);
  });

  test("a release's version is read from the service.version resource attribute", () => {
    expect(SLO_RELEASE_CHECK_VERSION_ATTRIBUTE).toBe(
      "resource.service.version",
    );
  });
});

describe("parseSloReleaseCheckOptions", () => {
  test("reads query-string text the way a URL carries it", () => {
    expect(
      parseSloReleaseCheckOptions({
        windowInMinutes: "15",
        maxBurnRate: "2.5",
        minimumRequestCount: "100",
        serviceVersion: " 1.4.2 ",
        includeDeploymentGate: "false",
        failWithStatusCode: "true",
      }),
    ).toEqual({
      windowInMinutes: 15,
      maxBurnRate: 2.5,
      minimumRequestCount: 100,
      serviceVersion: "1.4.2",
      includeDeploymentGate: false,
      failWithStatusCode: true,
    });
  });

  test("reads a JSON body's numbers and booleans", () => {
    expect(
      parseSloReleaseCheckOptions({
        windowInMinutes: 30,
        maxBurnRate: 14.4,
        minimumRequestCount: 0,
        serviceVersion: 42,
        failWithStatusCode: true,
      }),
    ).toEqual({
      windowInMinutes: 30,
      maxBurnRate: 14.4,
      minimumRequestCount: 0,
      serviceVersion: "42",
      includeDeploymentGate: true,
      failWithStatusCode: true,
    });
  });

  test("a key repeated in the query string takes its last value", () => {
    expect(
      parseSloReleaseCheckOptions({ windowInMinutes: ["5", "20"] })
        .windowInMinutes,
    ).toBe(20);
  });

  test("empty values read as the defaults, and 1/0 as true/false", () => {
    expect(
      parseSloReleaseCheckOptions({
        windowInMinutes: "",
        serviceVersion: "   ",
        failWithStatusCode: "1",
        includeDeploymentGate: "0",
      }),
    ).toEqual({
      ...parseSloReleaseCheckOptions({}),
      failWithStatusCode: true,
      includeDeploymentGate: false,
    });
  });

  test("a window from 1 minute to 6 hours", () => {
    expect(
      parseSloReleaseCheckOptions({ windowInMinutes: 1 }).windowInMinutes,
    ).toBe(1);
    expect(
      parseSloReleaseCheckOptions({
        windowInMinutes: SLO_RELEASE_CHECK_MAX_WINDOW_MINUTES,
      }).windowInMinutes,
    ).toBe(360);

    for (const value of [0, -5, 361, 2.5, "ten", "1e3", true]) {
      expectRefused(
        { windowInMinutes: value as never },
        SLO_RELEASE_CHECK_ERRORS.windowInMinutes,
      );
    }
  });

  test("a burn rate above 0", () => {
    for (const value of [0, -1, "fast", "Infinity"]) {
      expectRefused(
        { maxBurnRate: value as never },
        SLO_RELEASE_CHECK_ERRORS.maxBurnRate,
      );
    }
  });

  test("a whole number of requests from 0", () => {
    for (const value of [-1, 1.5, "some"]) {
      expectRefused(
        { minimumRequestCount: value as never },
        SLO_RELEASE_CHECK_ERRORS.minimumRequestCount,
      );
    }
  });

  test("a version of at most 200 characters, never an object", () => {
    expectRefused(
      { serviceVersion: "v".repeat(201) },
      SLO_RELEASE_CHECK_ERRORS.serviceVersion,
    );
    expectRefused(
      { serviceVersion: { version: "1" } as never },
      SLO_RELEASE_CHECK_ERRORS.serviceVersion,
    );
  });

  test("a switch that is neither true nor false is refused", () => {
    expectRefused(
      { failWithStatusCode: "yes" },
      SLO_RELEASE_CHECK_ERRORS.boolean,
    );
  });

  test("every refusal is a sentence that names the option", () => {
    for (const [option, message] of Object.entries(SLO_RELEASE_CHECK_ERRORS)) {
      expect(message).toMatch(/\.$/);

      if (option !== "boolean") {
        expect(message.startsWith(option)).toBe(true);
      }
    }
  });
});

describe("decideSloReleaseCheck - a request SLO", () => {
  test("passes at or under the burn rate it allows", () => {
    const decision: SloReleaseCheckDecision = decideSloReleaseCheck({
      sliType: SliType.RequestSuccess,
      targetPercentage: 99.9,
      options: optionsOf(),
      measurement: {
        burnRate: 1,
        sliPercentage: 99.9,
        goodRequestCount: 999,
        totalRequestCount: 1000,
      },
      deploymentsAllowed: true,
    });

    expect(decision).toEqual({
      verdict: SloReleaseCheckVerdict.Pass,
      isSafeToContinue: true,
      reason:
        "The last 10 minutes burned the error budget at 1x, within the 1x this check allows (SLI 99.9% against the 99.9% target).",
    });
  });

  test("fails above it, and says how fast", () => {
    const decision: SloReleaseCheckDecision = decideSloReleaseCheck({
      sliType: SliType.RequestLatency,
      targetPercentage: 99,
      options: optionsOf({ windowInMinutes: 5, maxBurnRate: 2 }),
      measurement: {
        burnRate: 5.123,
        sliPercentage: 94.877,
        goodRequestCount: 94877,
        totalRequestCount: 100000,
      },
      deploymentsAllowed: true,
    });

    expect(decision.verdict).toBe(SloReleaseCheckVerdict.Fail);
    expect(decision.isSafeToContinue).toBe(false);
    expect(decision.reason).toBe(
      "The last 5 minutes burned the error budget at 5.12x, faster than the 2x this check allows (SLI 94.877% against the 99% target).",
    );
  });

  test("too few requests is no verdict to roll on", () => {
    const decision: SloReleaseCheckDecision = decideSloReleaseCheck({
      sliType: SliType.RequestSuccess,
      targetPercentage: 99.9,
      options: optionsOf({ minimumRequestCount: 100, serviceVersion: "1.4.2" }),
      measurement: {
        burnRate: 0,
        sliPercentage: 100,
        goodRequestCount: 12,
        totalRequestCount: 12,
      },
      deploymentsAllowed: true,
    });

    expect(decision).toEqual({
      verdict: SloReleaseCheckVerdict.NotEnoughData,
      isSafeToContinue: false,
      reason:
        "Only 12 requests of version 1.4.2 in the last 10 minutes, and this check needs at least 100 requests to judge.",
    });
  });

  // A Metric SLO counts its metric's events, whatever they are (#8445).
  test("a Metric SLO's verdict counts events, not requests", () => {
    const tooFew: SloReleaseCheckDecision = decideSloReleaseCheck({
      sliType: SliType.Metric,
      targetPercentage: 99.9,
      options: optionsOf({ minimumRequestCount: 100 }),
      measurement: {
        burnRate: 0,
        sliPercentage: 100,
        goodRequestCount: 1,
        totalRequestCount: 1,
      },
      deploymentsAllowed: true,
    });

    expect(tooFew.reason).toBe(
      "Only 1 event in the last 10 minutes, and this check needs at least 100 events to judge.",
    );

    const none: SloReleaseCheckDecision = decideSloReleaseCheck({
      sliType: SliType.Metric,
      targetPercentage: 99.9,
      options: optionsOf({ minimumRequestCount: 0 }),
      measurement: {
        burnRate: 0,
        sliPercentage: null,
        goodRequestCount: 0,
        totalRequestCount: 0,
      },
      deploymentsAllowed: true,
    });

    expect(none.verdict).toBe(SloReleaseCheckVerdict.Pass);
    expect(none.reason).toBe(
      "No events in the last 10 minutes, so nothing burned the error budget.",
    );
  });

  test("no requests at all, with the default minimum, is not enough either", () => {
    const decision: SloReleaseCheckDecision = decideSloReleaseCheck({
      sliType: SliType.RequestSuccess,
      targetPercentage: 99.9,
      options: optionsOf(),
      measurement: {
        burnRate: 0,
        sliPercentage: null,
        goodRequestCount: 0,
        totalRequestCount: 0,
      },
      deploymentsAllowed: true,
    });

    expect(decision.verdict).toBe(SloReleaseCheckVerdict.NotEnoughData);
    expect(decision.reason).toContain("Only 0 requests in the last 10 minutes");
  });

  test("no requests with a minimum of 0 passes: nothing burned", () => {
    const decision: SloReleaseCheckDecision = decideSloReleaseCheck({
      sliType: SliType.RequestSuccess,
      targetPercentage: 99.9,
      options: optionsOf({ minimumRequestCount: 0 }),
      measurement: {
        burnRate: 0,
        sliPercentage: null,
        goodRequestCount: 0,
        totalRequestCount: 0,
      },
      deploymentsAllowed: true,
    });

    expect(decision).toEqual({
      verdict: SloReleaseCheckVerdict.Pass,
      isSafeToContinue: true,
      reason:
        "No requests in the last 10 minutes, so nothing burned the error budget.",
    });
  });

  test("one request and one minute read in the singular", () => {
    const decision: SloReleaseCheckDecision = decideSloReleaseCheck({
      sliType: SliType.RequestSuccess,
      targetPercentage: 99.9,
      options: optionsOf({ windowInMinutes: 1, minimumRequestCount: 2 }),
      measurement: {
        burnRate: 0,
        sliPercentage: 100,
        goodRequestCount: 1,
        totalRequestCount: 1,
      },
      deploymentsAllowed: true,
    });

    expect(decision.reason).toBe(
      "Only 1 request in the last 1 minute, and this check needs at least 2 requests to judge.",
    );
  });
});

describe("decideSloReleaseCheck - the deploy gate and monitors", () => {
  test("a freeze fails the check first, naming the tier", () => {
    const decision: SloReleaseCheckDecision = decideSloReleaseCheck({
      sliType: SliType.RequestSuccess,
      targetPercentage: 99.9,
      options: optionsOf(),
      measurement: {
        burnRate: 0,
        sliPercentage: 100,
        goodRequestCount: 1000,
        totalRequestCount: 1000,
      },
      deploymentsAllowed: false,
      errorBudgetPolicyTierName: "Budget exhausted",
    });

    expect(decision).toEqual({
      verdict: SloReleaseCheckVerdict.Fail,
      isSafeToContinue: false,
      reason:
        'Deployments are frozen: this SLO is in the "Budget exhausted" tier of its error budget policy, which freezes deployments.',
    });
  });

  test("a freeze with no tier name still says so", () => {
    expect(
      decideSloReleaseCheck({
        sliType: SliType.MonitorUptime,
        targetPercentage: 99.9,
        options: optionsOf(),
        measurement: { burnRate: 0, sliPercentage: 100, measuredSeconds: 600 },
        deploymentsAllowed: false,
      }).reason,
    ).toBe("Deployments are frozen by this SLO's error budget policy.");
  });

  test("a check that leaves the gate out reads only the burn", () => {
    expect(
      decideSloReleaseCheck({
        sliType: SliType.RequestSuccess,
        targetPercentage: 99.9,
        options: optionsOf({ includeDeploymentGate: false }),
        measurement: {
          burnRate: 0.2,
          sliPercentage: 99.98,
          goodRequestCount: 4999,
          totalRequestCount: 5000,
        },
        deploymentsAllowed: false,
      }).verdict,
    ).toBe(SloReleaseCheckVerdict.Pass);
  });

  test("a Monitor Uptime SLO with no status in the window has nothing to judge", () => {
    expect(
      decideSloReleaseCheck({
        sliType: SliType.MonitorUptime,
        targetPercentage: 99.9,
        options: optionsOf(),
        measurement: { burnRate: 0, sliPercentage: null, measuredSeconds: 0 },
        deploymentsAllowed: true,
      }),
    ).toEqual({
      verdict: SloReleaseCheckVerdict.NotEnoughData,
      isSafeToContinue: false,
      reason:
        "This SLO's monitors recorded no status in the last 10 minutes, so there is nothing to judge.",
    });
  });

  test("a Monitor Uptime SLO's downtime fails a check on its burn", () => {
    const decision: SloReleaseCheckDecision = decideSloReleaseCheck({
      sliType: SliType.MonitorUptime,
      targetPercentage: 99.9,
      options: optionsOf(),
      measurement: { burnRate: 100, sliPercentage: 90, measuredSeconds: 600 },
      deploymentsAllowed: true,
    });

    expect(decision.verdict).toBe(SloReleaseCheckVerdict.Fail);
    expect(decision.reason).toContain("at 100x, faster than the 1x");
  });
});

describe("buildSloReleaseCheckResponse", () => {
  const CHECKED_AT: Date = new Date("2026-07-19T12:00:00.000Z");

  test("a request SLO's answer, verdict first, with its counts and version", () => {
    const options: SloReleaseCheckOptions = optionsOf({
      serviceVersion: "1.4.2",
    });
    const response: JSONObject = buildSloReleaseCheckResponse({
      sloId: "slo-1",
      sloName: "Checkout requests",
      sliType: SliType.RequestSuccess,
      targetPercentage: 99.9,
      sloStatus: SloStatus.Healthy,
      deploymentsAllowed: true,
      errorBudgetPolicyTierName: null,
      options: options,
      measurement: {
        burnRate: 0.5,
        sliPercentage: 99.95,
        goodRequestCount: 1999,
        totalRequestCount: 2000,
      },
      decision: {
        verdict: SloReleaseCheckVerdict.Pass,
        isSafeToContinue: true,
        reason: "fine",
      },
      checkedAt: CHECKED_AT,
    });

    expect(Object.keys(response).slice(0, 3)).toEqual([
      "isSafeToContinue",
      "verdict",
      "reason",
    ]);
    expect(response).toEqual({
      isSafeToContinue: true,
      verdict: "Pass",
      reason: "fine",
      sloId: "slo-1",
      sloName: "Checkout requests",
      sliType: "Request Success",
      targetPercentage: 99.9,
      windowInMinutes: 10,
      maxBurnRate: 1,
      burnRate: 0.5,
      sliPercentage: 99.95,
      deploymentsAllowed: true,
      errorBudgetPolicyTier: null,
      sloStatus: "Healthy",
      checkedAt: "2026-07-19T12:00:00.000Z",
      goodRequestCount: 1999,
      totalRequestCount: 2000,
      minimumRequestCount: 1,
      serviceVersion: "1.4.2",
    });
  });

  test("a Monitor Uptime SLO's answer has no request fields", () => {
    const response: JSONObject = buildSloReleaseCheckResponse({
      sloId: "slo-2",
      sloName: "API uptime",
      sliType: SliType.MonitorUptime,
      targetPercentage: 99.9,
      sloStatus: SloStatus.AtRisk,
      deploymentsAllowed: false,
      errorBudgetPolicyTierName: "Budget exhausted",
      options: optionsOf(),
      measurement: { burnRate: 3, sliPercentage: 99.7, measuredSeconds: 600 },
      decision: {
        verdict: SloReleaseCheckVerdict.Fail,
        isSafeToContinue: false,
        reason: "frozen",
      },
      checkedAt: CHECKED_AT,
    });

    expect(response["goodRequestCount"]).toBeUndefined();
    expect(response["serviceVersion"]).toBeUndefined();
    expect(response["deploymentsAllowed"]).toBe(false);
    expect(response["errorBudgetPolicyTier"]).toBe("Budget exhausted");
  });

  test("a burn rate that is not a number is null, never NaN in JSON", () => {
    const response: JSONObject = buildSloReleaseCheckResponse({
      sloId: "slo-3",
      sloName: undefined,
      sliType: SliType.MonitorUptime,
      targetPercentage: 99.9,
      sloStatus: undefined,
      deploymentsAllowed: undefined,
      errorBudgetPolicyTierName: undefined,
      options: optionsOf(),
      measurement: {
        burnRate: Number.NaN,
        sliPercentage: null,
        measuredSeconds: 0,
      },
      decision: {
        verdict: SloReleaseCheckVerdict.NotEnoughData,
        isSafeToContinue: false,
        reason: "nothing",
      },
      checkedAt: CHECKED_AT,
    });

    expect(response["burnRate"]).toBeNull();
    expect(response["sloName"]).toBeNull();
    expect(response["sloStatus"]).toBeNull();
    // An SLO that never froze answers as allowed, as the deploy gate does.
    expect(response["deploymentsAllowed"]).toBe(true);
  });
});
