import API from "../../../UI/Utils/API/API";
import RuleRunClient, {
  RuleRunOutcome,
} from "../../../UI/Utils/Rules/RuleRunClient";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import { RuleRunResult, RuleRunType } from "../../../Types/Rules/RuleRun";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - the dashboard half of "Run now".
 *
 * The server answers one bounded pass per request; this client is what turns
 * passes into a run. What can go wrong here is invisible from the server:
 * posting to the wrong route, sending the cursor back wrong (a run that loops
 * on its first page, or skips the rest), trusting a cursor that never moves,
 * sending the notify flag as anything but a real boolean, and reporting a run
 * that failed half-way as if nothing had happened.
 */

const RULE_ID: string = "44444444-4444-4444-8444-444444444444";
const CURSOR_1: string = "00000000-0000-4000-8000-000000000001";
const CURSOR_2: string = "00000000-0000-4000-8000-000000000002";

interface PostArgs {
  url: URL;
  data: JSONObject;
  headers?: Record<string, string> | undefined;
}

function passBody(overrides: JSONObject = {}): JSONObject {
  return {
    resourcesEvaluated: 0,
    resourcesMatched: 0,
    resourcesUpdated: 0,
    itemsAdded: 0,
    itemsRemoved: 0,
    resourcesFailed: 0,
    nextCursor: null,
    ownersNotified: false,
    ...overrides,
  };
}

function ok(body: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, body, {});
}

function mockPostSequence(
  responses: Array<HTTPResponse<JSONObject> | HTTPErrorResponse | Error>,
): jest.SpyInstance {
  const spy: jest.SpyInstance = jest.spyOn(API, "post");

  for (const response of responses) {
    if (response instanceof Error) {
      spy.mockRejectedValueOnce(response as never);
    } else {
      spy.mockResolvedValueOnce(response as never);
    }
  }

  return spy;
}

function postArgs(spy: jest.SpyInstance, index: number): PostArgs {
  return (spy.mock.calls[index] as Array<unknown>)[0] as PostArgs;
}

describe("RuleRunClient.getRunRoute", () => {
  it("routes every rule type through one endpoint", () => {
    expect(
      RuleRunClient.getRunRoute({
        ruleType: RuleRunType.IncidentOwnerRule,
        ruleId: RULE_ID,
      }),
    ).toBe(`/rule-run/IncidentOwnerRule/${RULE_ID}/run`);
  });
});

describe("RuleRunClient.run", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses to post for a rule with no id", async () => {
    const spy: jest.SpyInstance = mockPostSequence([]);

    const outcome: RuleRunOutcome = await RuleRunClient.run({
      ruleType: RuleRunType.MonitorLabelRule,
      ruleId: "",
    });

    expect(outcome.isSuccess).toBe(false);
    expect(outcome.message).toBe("This rule has no id, so it cannot be run.");
    expect(outcome.result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("runs a single-pass rule and reports it", async () => {
    const spy: jest.SpyInstance = mockPostSequence([
      ok(
        passBody({
          resourcesEvaluated: 40,
          resourcesMatched: 12,
          resourcesUpdated: 12,
          itemsAdded: 24,
        }),
      ),
    ]);

    const outcome: RuleRunOutcome = await RuleRunClient.run({
      ruleType: RuleRunType.MonitorLabelRule,
      ruleId: RULE_ID,
      headers: { tenantid: "project-1" },
    });

    expect(outcome.isSuccess).toBe(true);
    expect(outcome.message).toBe(
      "Added labels to 12 monitors (24 labels attached).",
    );
    expect(outcome.result?.passes).toBe(1);

    const args: PostArgs = postArgs(spy, 0);
    expect(args.url.toString()).toContain(
      `/rule-run/MonitorLabelRule/${RULE_ID}/run`,
    );
    expect(args.data).toEqual({ notifyOwners: false });
    expect(args.headers).toEqual({ tenantid: "project-1" });
  });

  it("sends notifyOwners only as a real boolean", async () => {
    const spy: jest.SpyInstance = mockPostSequence([ok(passBody())]);

    await RuleRunClient.run({
      ruleType: RuleRunType.HostOwnerRule,
      ruleId: RULE_ID,
      notifyOwners: true,
    });

    expect(postArgs(spy, 0).data["notifyOwners"]).toBe(true);
  });

  it("chains passes by sending each cursor back, and sums what they did", async () => {
    const progress: Array<RuleRunResult> = [];
    const spy: jest.SpyInstance = mockPostSequence([
      ok(
        passBody({
          resourcesEvaluated: 200,
          resourcesMatched: 5,
          resourcesUpdated: 5,
          itemsAdded: 5,
          nextCursor: CURSOR_1,
        }),
      ),
      ok(
        passBody({
          resourcesEvaluated: 200,
          resourcesMatched: 1,
          resourcesUpdated: 1,
          itemsAdded: 2,
          nextCursor: CURSOR_2,
        }),
      ),
      ok(passBody({ resourcesEvaluated: 13 })),
    ]);

    const outcome: RuleRunOutcome = await RuleRunClient.run({
      ruleType: RuleRunType.IncidentLabelRule,
      ruleId: RULE_ID,
      onProgress: (result: RuleRunResult) => {
        progress.push(result);
      },
    });

    expect(spy).toHaveBeenCalledTimes(3);
    expect(postArgs(spy, 0).data["cursor"]).toBeUndefined();
    expect(postArgs(spy, 1).data["cursor"]).toBe(CURSOR_1);
    expect(postArgs(spy, 2).data["cursor"]).toBe(CURSOR_2);

    expect(outcome.isSuccess).toBe(true);
    expect(outcome.result).toMatchObject({
      resourcesEvaluated: 413,
      resourcesMatched: 6,
      resourcesUpdated: 6,
      itemsAdded: 7,
      passes: 3,
      isTruncated: false,
    });

    // Progress is reported between passes, never for the last one.
    expect(
      progress.map((result: RuleRunResult): number => {
        return result.resourcesEvaluated;
      }),
    ).toEqual([200, 400]);
  });

  it("stops at the pass cap and reports the run as unfinished", async () => {
    const spy: jest.SpyInstance = mockPostSequence([
      ok(passBody({ resourcesEvaluated: 200, nextCursor: CURSOR_1 })),
      ok(passBody({ resourcesEvaluated: 200, nextCursor: CURSOR_2 })),
    ]);

    const outcome: RuleRunOutcome = await RuleRunClient.run({
      ruleType: RuleRunType.MonitorLabelRule,
      ruleId: RULE_ID,
      maxPasses: 2,
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(outcome.isSuccess).toBe(true);
    expect(outcome.result?.isTruncated).toBe(true);
    expect(outcome.message).toContain("The run stopped after evaluating");
  });

  it("does not loop on a cursor that does not move", async () => {
    const spy: jest.SpyInstance = mockPostSequence([
      ok(passBody({ resourcesEvaluated: 200, nextCursor: CURSOR_1 })),
      ok(passBody({ resourcesEvaluated: 200, nextCursor: CURSOR_1 })),
      ok(passBody({ resourcesEvaluated: 200, nextCursor: CURSOR_1 })),
    ]);

    const outcome: RuleRunOutcome = await RuleRunClient.run({
      ruleType: RuleRunType.MonitorLabelRule,
      ruleId: RULE_ID,
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(outcome.result?.isTruncated).toBe(true);
  });

  it("ends the run on a malformed cursor rather than posting it back", async () => {
    const spy: jest.SpyInstance = mockPostSequence([
      ok(passBody({ resourcesEvaluated: 5, nextCursor: "page-2" })),
    ]);

    const outcome: RuleRunOutcome = await RuleRunClient.run({
      ruleType: RuleRunType.MonitorLabelRule,
      ruleId: RULE_ID,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(outcome.isSuccess).toBe(true);
    expect(outcome.result?.isTruncated).toBe(false);
  });

  it("turns a refused first pass into the server's message", async () => {
    mockPostSequence([
      new HTTPErrorResponse(
        400,
        { message: "This rule is disabled. Enable it before running it." },
        {},
      ),
    ]);

    const outcome: RuleRunOutcome = await RuleRunClient.run({
      ruleType: RuleRunType.MonitorLabelRule,
      ruleId: RULE_ID,
    });

    expect(outcome.isSuccess).toBe(false);
    expect(outcome.message).toBe(
      "This rule is disabled. Enable it before running it.",
    );
    expect(outcome.result).toBeNull();
  });

  /*
   * Earlier passes really changed resources. Hiding that behind "failed"
   * invites a re-run that then appears to do nothing.
   */
  it("reports what a run that failed part-way had already done", async () => {
    mockPostSequence([
      ok(
        passBody({
          resourcesEvaluated: 200,
          resourcesMatched: 4,
          resourcesUpdated: 4,
          itemsAdded: 4,
          nextCursor: CURSOR_1,
        }),
      ),
      new Error("Network request failed"),
    ]);

    const outcome: RuleRunOutcome = await RuleRunClient.run({
      ruleType: RuleRunType.MonitorLabelRule,
      ruleId: RULE_ID,
    });

    expect(outcome.isSuccess).toBe(false);
    expect(outcome.message).toContain("The run stopped part-way.");
    expect(outcome.message).toContain(
      "Added labels to 4 monitors (4 labels attached).",
    );
    expect(outcome.result).toMatchObject({
      resourcesUpdated: 4,
      passes: 1,
    });
  });
});
