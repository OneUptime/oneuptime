import logIfRuleReadWasTruncated from "../../../../Server/Utils/Rules/RuleEngineRuleRead";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../Utils/Rules/RuleEngineLimits";
import logger from "../../../../Server/Utils/Logger";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, it, afterEach } from "@jest/globals";

/*
 * A rule engine reads its project's rules as `limit: <cap>, skip: 0` and
 * evaluates whatever comes back. There is no second page, so a project past
 * the cap has the remainder evaluated by nobody - and the read cannot tell
 * "that is all of them" from "that is all I was allowed to ask for".
 *
 * That gap IS OneUptime/oneuptime#3506: the cap was 100, a project had 1,243
 * rules, and the 1,143 that never ran produced no log and no counter. Raising
 * the cap to 10,000 moves the threshold; it does not change the shape of the
 * failure. This guard is what changes the shape - crossing the ceiling is now
 * an operator-visible error rather than silence.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

describe("logIfRuleReadWasTruncated", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("says nothing for a project comfortably under the ceiling", () => {
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    // The reporter's own rule count. It must not produce noise.
    const wasTruncated: boolean = logIfRuleReadWasTruncated({
      ruleKind: "MonitorLabelRule",
      projectId: PROJECT_ID,
      rulesRead: 1243,
    });

    expect(wasTruncated).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("says nothing at exactly one rule below the ceiling", () => {
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    const wasTruncated: boolean = logIfRuleReadWasTruncated({
      ruleKind: "MonitorLabelRule",
      projectId: PROJECT_ID,
      rulesRead: MAX_RULES_EVALUATED_PER_PROJECT - 1,
    });

    expect(wasTruncated).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  /*
   * A read that comes back exactly full is indistinguishable from a truncated
   * one - the row that would have been 10,001st was never fetched to be
   * counted. It has to be reported, even though a project sitting at exactly
   * the cap has in fact lost nothing.
   */
  it("reports a read that comes back exactly at the ceiling", () => {
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    const wasTruncated: boolean = logIfRuleReadWasTruncated({
      ruleKind: "MonitorLabelRule",
      projectId: PROJECT_ID,
      rulesRead: MAX_RULES_EVALUATED_PER_PROJECT,
    });

    expect(wasTruncated).toBe(true);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("names the rule kind and the project so the config can be found", () => {
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    logIfRuleReadWasTruncated({
      ruleKind: "MonitorLabelRule",
      projectId: PROJECT_ID,
      rulesRead: 100000,
    });

    const message: string = errorSpy.mock.calls[0]![0] as string;
    const attributes: { projectId?: string } = errorSpy.mock.calls[0]![1] as {
      projectId?: string;
    };

    expect(message).toContain("MonitorLabelRule");
    expect(message).toContain(String(MAX_RULES_EVALUATED_PER_PROJECT));
    expect(message).toContain("NOT being evaluated");
    expect(attributes.projectId).toBe(PROJECT_ID.toString());
  });

  // The guard reports; it never throws. A partial evaluation beats none.
  it("does not throw when the project has no id", () => {
    jest.spyOn(logger, "error").mockImplementation(() => {});

    expect(() => {
      return logIfRuleReadWasTruncated({
        ruleKind: "MonitorLabelRule",
        projectId: undefined,
        rulesRead: 100000,
      });
    }).not.toThrow();
  });
});
