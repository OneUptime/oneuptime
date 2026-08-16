import API from "../../../UI/Utils/API/API";
import RunNetworkRule, {
  NetworkRuleKind,
  NetworkRuleRunOutcome,
} from "../../../UI/Utils/NetworkAutomation/RunNetworkRule";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Contract under test - the dashboard half of "Run now"
 * (OneUptime/oneuptime#3191).
 *
 * Three things can only go wrong here, and all three are invisible from the
 * server: posting to the wrong route (nothing runs and the user sees a 404),
 * sending the overwrite flag as anything other than a real boolean (the
 * endpoint reads only a literal true, so a run silently declines to do what
 * the checkbox promised), and turning a failure into a blank modal.
 */

const RULE_ID: string = "44444444-4444-4444-8444-444444444444";

function successResponse(body: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, body, {});
}

function mockPost(
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
): jest.SpiedFunction<typeof API.post> {
  return jest.spyOn(API, "post").mockResolvedValue(response as never) as any;
}

function lastPostArgs(spy: jest.SpiedFunction<typeof API.post>): {
  url: URL;
  data: JSONObject;
  headers?: Record<string, string> | undefined;
} {
  return (spy.mock.calls[0] as Array<unknown>)[0] as {
    url: URL;
    data: JSONObject;
    headers?: Record<string, string> | undefined;
  };
}

const SITE_RUN_RESULT: JSONObject = {
  devicesEvaluated: 40,
  devicesMatched: 12,
  devicesAssigned: 12,
  devicesAlreadyInRuleSite: 0,
  devicesSkippedAlreadyInAnotherSite: 0,
  devicesClaimedByHigherPriorityRule: 0,
  devicesFailed: 0,
  isTruncated: false,
};

const LABEL_RUN_RESULT: JSONObject = {
  devicesEvaluated: 40,
  devicesMatched: 12,
  devicesLabeled: 12,
  labelsAttached: 24,
  labelsFailed: 0,
  isTruncated: false,
};

describe("RunNetworkRule.getRunRoute", () => {
  it("routes a site assignment rule to its own endpoint", () => {
    expect(
      RunNetworkRule.getRunRoute({
        ruleKind: NetworkRuleKind.SiteAssignment,
        ruleId: RULE_ID,
      }),
    ).toBe(`/network-site-assignment-rule/${RULE_ID}/run`);
  });

  it("routes a label rule to its own endpoint", () => {
    expect(
      RunNetworkRule.getRunRoute({
        ruleKind: NetworkRuleKind.DeviceLabel,
        ruleId: RULE_ID,
      }),
    ).toBe(`/network-device-label-rule/${RULE_ID}/run`);
  });
});

describe("RunNetworkRule.run", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the request", () => {
    it("posts to the site assignment endpoint for that rule kind", async () => {
      const spy: jest.SpiedFunction<typeof API.post> = mockPost(
        successResponse(SITE_RUN_RESULT),
      );

      await RunNetworkRule.run({
        ruleKind: NetworkRuleKind.SiteAssignment,
        ruleId: RULE_ID,
      });

      expect(lastPostArgs(spy).url.toString()).toContain(
        `/network-site-assignment-rule/${RULE_ID}/run`,
      );
    });

    it("posts to the label rule endpoint for that rule kind", async () => {
      const spy: jest.SpiedFunction<typeof API.post> = mockPost(
        successResponse(LABEL_RUN_RESULT),
      );

      await RunNetworkRule.run({
        ruleKind: NetworkRuleKind.DeviceLabel,
        ruleId: RULE_ID,
      });

      expect(lastPostArgs(spy).url.toString()).toContain(
        `/network-device-label-rule/${RULE_ID}/run`,
      );
    });

    /*
     * The tenantid header is what scopes the run to the current project. A
     * request without it is refused by the endpoint, so the caller's headers
     * have to survive this hop.
     */
    it("passes the caller's headers through", async () => {
      const spy: jest.SpiedFunction<typeof API.post> = mockPost(
        successResponse(SITE_RUN_RESULT),
      );

      await RunNetworkRule.run({
        ruleKind: NetworkRuleKind.SiteAssignment,
        ruleId: RULE_ID,
        headers: { tenantid: "project-1" },
      });

      expect(lastPostArgs(spy).headers).toEqual({ tenantid: "project-1" });
    });

    it("sends the overwrite flag off unless it was asked for", async () => {
      const spy: jest.SpiedFunction<typeof API.post> = mockPost(
        successResponse(SITE_RUN_RESULT),
      );

      await RunNetworkRule.run({
        ruleKind: NetworkRuleKind.SiteAssignment,
        ruleId: RULE_ID,
      });

      expect(lastPostArgs(spy).data).toEqual({
        reassignDevicesAlreadyInASite: false,
      });
    });

    /*
     * A real boolean, not a truthy value: the endpoint reads only a literal
     * true, so anything else would leave the checkbox looking broken.
     */
    it("sends the overwrite flag as a literal boolean", async () => {
      const spy: jest.SpiedFunction<typeof API.post> = mockPost(
        successResponse(SITE_RUN_RESULT),
      );

      await RunNetworkRule.run({
        ruleKind: NetworkRuleKind.SiteAssignment,
        ruleId: RULE_ID,
        reassignDevicesAlreadyInASite: true,
      });

      expect(lastPostArgs(spy).data["reassignDevicesAlreadyInASite"]).toBe(
        true,
      );
    });

    // A label run has nothing to overwrite, so it must not carry the flag.
    it("never sends the overwrite flag for a label rule", async () => {
      const spy: jest.SpiedFunction<typeof API.post> = mockPost(
        successResponse(LABEL_RUN_RESULT),
      );

      await RunNetworkRule.run({
        ruleKind: NetworkRuleKind.DeviceLabel,
        ruleId: RULE_ID,
        reassignDevicesAlreadyInASite: true,
      });

      expect(lastPostArgs(spy).data).toEqual({});
    });

    /*
     * An empty id would post to `/…//run`, which matches no route and comes
     * back as a 404 that says nothing about the real problem.
     */
    it("refuses to post a rule with no id", async () => {
      const spy: jest.SpiedFunction<typeof API.post> = mockPost(
        successResponse(SITE_RUN_RESULT),
      );

      const outcome: NetworkRuleRunOutcome = await RunNetworkRule.run({
        ruleKind: NetworkRuleKind.SiteAssignment,
        ruleId: "",
      });

      expect(spy).not.toHaveBeenCalled();
      expect(outcome.isSuccess).toBe(false);
      expect(outcome.message).toContain("no id");
    });
  });

  describe("the answer", () => {
    it("summarises a site assignment run", async () => {
      mockPost(successResponse(SITE_RUN_RESULT));

      const outcome: NetworkRuleRunOutcome = await RunNetworkRule.run({
        ruleKind: NetworkRuleKind.SiteAssignment,
        ruleId: RULE_ID,
      });

      expect(outcome.isSuccess).toBe(true);
      expect(outcome.message).toContain(
        "Assigned 12 devices to this rule's site.",
      );
    });

    it("summarises a label rule run", async () => {
      mockPost(successResponse(LABEL_RUN_RESULT));

      const outcome: NetworkRuleRunOutcome = await RunNetworkRule.run({
        ruleKind: NetworkRuleKind.DeviceLabel,
        ruleId: RULE_ID,
      });

      expect(outcome.isSuccess).toBe(true);
      expect(outcome.message).toContain("Labelled 12 devices");
    });

    /*
     * The kinds must not be summarised with each other's sentences - a label
     * run reported as "assigned 0 devices" would read as a failure.
     */
    it("does not describe a label run in site assignment terms", async () => {
      mockPost(successResponse(LABEL_RUN_RESULT));

      const outcome: NetworkRuleRunOutcome = await RunNetworkRule.run({
        ruleKind: NetworkRuleKind.DeviceLabel,
        ruleId: RULE_ID,
      });

      expect(outcome.message).not.toContain("Assigned");
    });

    it("explains a run that changed nothing rather than reporting success blankly", async () => {
      mockPost(
        successResponse({
          ...SITE_RUN_RESULT,
          devicesAssigned: 0,
          devicesSkippedAlreadyInAnotherSite: 12,
        }),
      );

      const outcome: NetworkRuleRunOutcome = await RunNetworkRule.run({
        ruleKind: NetworkRuleKind.SiteAssignment,
        ruleId: RULE_ID,
      });

      expect(outcome.isSuccess).toBe(true);
      expect(outcome.message).toContain("No devices were reassigned.");
      expect(outcome.message).toContain("already belong to another site");
    });

    /*
     * An empty body still has to produce a sentence. A server that answered
     * with nothing must not leave the modal blank.
     */
    it("survives a response carrying no counters", async () => {
      mockPost(successResponse({}));

      const outcome: NetworkRuleRunOutcome = await RunNetworkRule.run({
        ruleKind: NetworkRuleKind.SiteAssignment,
        ruleId: RULE_ID,
      });

      expect(outcome.isSuccess).toBe(true);
      expect(outcome.message).toContain("No devices were reassigned.");
    });
  });

  describe("failures", () => {
    it("reports a failure response as a message, not a success", async () => {
      mockPost(
        new HTTPErrorResponse(400, { message: "Label rule not found." }, {}),
      );

      const outcome: NetworkRuleRunOutcome = await RunNetworkRule.run({
        ruleKind: NetworkRuleKind.DeviceLabel,
        ruleId: RULE_ID,
      });

      expect(outcome.isSuccess).toBe(false);
      expect(outcome.message).toContain("Label rule not found.");
    });

    // A thrown request (offline, DNS, an aborted fetch) must not escape.
    it("reports a thrown request as a message", async () => {
      jest
        .spyOn(API, "post")
        .mockRejectedValue(new Error("Network request failed") as never);

      const outcome: NetworkRuleRunOutcome = await RunNetworkRule.run({
        ruleKind: NetworkRuleKind.SiteAssignment,
        ruleId: RULE_ID,
      });

      expect(outcome.isSuccess).toBe(false);
      expect(outcome.message).toContain("Network request failed");
    });
  });
});
