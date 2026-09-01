import MonitorLabelRuleEngineService from "../../../Server/Services/MonitorLabelRuleEngineService";
import MonitorLabelRuleService from "../../../Server/Services/MonitorLabelRuleService";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorService from "../../../Server/Services/MonitorService";
import LabelService from "../../../Server/Services/LabelService";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorLabelRule from "../../../Models/DatabaseModels/MonitorLabelRule";
import ObjectID from "../../../Types/ObjectID";
import logger from "../../../Server/Utils/Logger";
import FindBy from "../../../Server/Types/Database/FindBy";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../Utils/Rules/RuleEngineLimits";
import { describe, expect, it, afterEach } from "@jest/globals";

/*
 * Contract under test - how many of a project's monitor label rules one
 * evaluation actually looks at.
 *
 * The engine read its rules with `limit: 100, skip: 0`. Nothing paged past
 * that, so in a project with 1,243 enabled rules the 1,143 oldest were
 * fetched by nobody and matched nothing. A bulk import of 1,000+ monitors
 * came out with roughly the handful of monitors the newest 100 rules
 * happened to cover, and the rest sat unlabelled - indistinguishable, from
 * the outside, from a queue that never drains (OneUptime/oneuptime#3506).
 *
 * The numbers below are the reporter's: 1,243 rules, with the rule that
 * matches sitting well past the old cutoff.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const UNIT_LABEL_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SITE_LABEL_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

// The reporter's rule count.
const RULES_IN_PROJECT: number = 1243;
// What the engine used to read, and the whole of the bug.
const OLD_RULE_FETCH_LIMIT: number = 100;

function fakeLabel(id: ObjectID): Label {
  return { id: id, _id: id.toString() } as unknown as Label;
}

// The monitor as onCreateSuccess hands it to the engine: ids only.
function ruleTarget(): Monitor {
  return {
    id: MONITOR_ID,
    _id: MONITOR_ID.toString(),
    projectId: PROJECT_ID,
  } as unknown as Monitor;
}

// The row the engine re-reads to match on.
function fakeMonitorDetails(overrides: Record<string, unknown> = {}): Monitor {
  return {
    id: MONITOR_ID,
    _id: MONITOR_ID.toString(),
    projectId: PROJECT_ID,
    name: "WB1396 - Core Switch",
    labels: [],
    ...overrides,
  } as unknown as Monitor;
}

function fakeRule(
  index: number,
  data: Record<string, unknown> = {},
): MonitorLabelRule {
  return {
    id: new ObjectID(
      `77777777-7777-4777-8777-${index.toString().padStart(12, "0")}`,
    ),
    name: `Unit Label - Rule ${index}`,
    labelsToAdd: [fakeLabel(UNIT_LABEL_ID)],
    ...data,
  } as unknown as MonitorLabelRule;
}

/*
 * A project whose rules are one-per-unit, as the reporter's is: every rule
 * keys on a different unit code and only `matchingIndex` names this
 * monitor's. Ordered the way the engine reads them (createdAt descending),
 * so `matchingIndex` is a position in the list the engine walks - the point
 * being that it is past 100.
 */
function projectWithRules(data: {
  ruleCount: number;
  matchingIndex: number;
}): Array<MonitorLabelRule> {
  const rules: Array<MonitorLabelRule> = [];

  for (let index: number = 0; index < data.ruleCount; index++) {
    rules.push(
      fakeRule(index, {
        monitorNamePattern:
          index === data.matchingIndex ? "WB1396" : `WB${9000 + index}`,
        name:
          index === data.matchingIndex
            ? "Unit Label - WB1396"
            : `Unit Label - WB${9000 + index}`,
      }),
    );
  }

  return rules;
}

/*
 * The engine attaches through the relation query builder rather than a model
 * write, so the assertion surface is the `.add(ids)` call at the end of that
 * chain.
 */
function mockLabelAttach(): jest.Mock {
  const addSpy: jest.Mock = jest.fn().mockResolvedValue(undefined);

  jest.spyOn(MonitorService, "getRepository").mockReturnValue({
    createQueryBuilder: (): any => {
      return {
        relation: (): any => {
          return {
            of: (): any => {
              return { add: addSpy };
            },
          };
        },
      };
    },
  } as any);

  return addSpy;
}

/*
 * Stands in for the database: answers the engine's rule read with the page
 * it actually asked for, so a query that asks for 100 rules gets 100 rules
 * and no more. Without this the mock would hand back every rule regardless
 * of the limit and the bug would be invisible to the test.
 */
function mockRuleFetch(rules: Array<MonitorLabelRule>): jest.Mock {
  const findBySpy: jest.Mock = jest.fn(
    async (findBy: FindBy<MonitorLabelRule>) => {
      const skip: number = Number(findBy.skip ?? 0);
      const limit: number = Number(findBy.limit ?? 0);
      return rules.slice(skip, skip + limit);
    },
  );

  jest
    .spyOn(MonitorLabelRuleService, "findBy")
    .mockImplementation(findBySpy as any);

  return findBySpy;
}

function mockFeedItem(): jest.Mock {
  jest.spyOn(LabelService, "findBy").mockResolvedValue([
    {
      id: UNIT_LABEL_ID,
      name: "WB1396",
    } as unknown as Label,
  ]);

  const feedSpy: jest.Mock = jest.fn().mockResolvedValue(undefined);

  jest
    .spyOn(MonitorFeedService, "createMonitorFeedItem")
    .mockImplementation(feedSpy as any);

  return feedSpy;
}

describe("MonitorLabelRuleEngineService - rule fetch is not capped at 100", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The reported bug, end to end: the reporter's "Unit Label - WB1396" rule
   * against the monitor their dashboard showed as "No labels attached".
   */
  it("labels a monitor from a rule that sits past the old 100-rule cutoff", async () => {
    const rules: Array<MonitorLabelRule> = projectWithRules({
      ruleCount: RULES_IN_PROJECT,
      matchingIndex: 1200,
    });

    // The premise of the test: the only matching rule was out of reach.
    expect(1200).toBeGreaterThan(OLD_RULE_FETCH_LIMIT);

    mockRuleFetch(rules);
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(fakeMonitorDetails());
    const addSpy: jest.Mock = mockLabelAttach();
    mockFeedItem();

    await MonitorLabelRuleEngineService.applyRulesToMonitor(ruleTarget());

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy.mock.calls[0]![0]).toEqual([UNIT_LABEL_ID.toString()]);
  });

  it("asks the database for the project's whole rule set in one read", async () => {
    const findBySpy: jest.Mock = mockRuleFetch(
      projectWithRules({
        ruleCount: RULES_IN_PROJECT,
        matchingIndex: 1200,
      }),
    );
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(fakeMonitorDetails());
    mockLabelAttach();
    mockFeedItem();

    await MonitorLabelRuleEngineService.applyRulesToMonitor(ruleTarget());

    expect(findBySpy).toHaveBeenCalledTimes(1);

    const findBy: FindBy<MonitorLabelRule> = findBySpy.mock
      .calls[0]![0] as FindBy<MonitorLabelRule>;

    expect(Number(findBy.limit)).toBe(MAX_RULES_EVALUATED_PER_PROJECT);
    expect(Number(findBy.skip)).toBe(0);
    expect(Number(findBy.limit)).toBeGreaterThan(RULES_IN_PROJECT);
    expect(findBy.query).toMatchObject({
      projectId: PROJECT_ID,
      isEnabled: true,
    });
  });

  /*
   * The counterfactual, stated as a test so the regression cannot come back
   * quietly: with the old limit in place this same project and monitor
   * produce no labels at all.
   */
  it("would have attached nothing under the old 100-rule limit", async () => {
    const rules: Array<MonitorLabelRule> = projectWithRules({
      ruleCount: RULES_IN_PROJECT,
      matchingIndex: 1200,
    });

    const reachableUnderOldLimit: Array<MonitorLabelRule> = rules.slice(
      0,
      OLD_RULE_FETCH_LIMIT,
    );

    mockRuleFetch(reachableUnderOldLimit);
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(fakeMonitorDetails());
    const addSpy: jest.Mock = mockLabelAttach();
    mockFeedItem();

    await MonitorLabelRuleEngineService.applyRulesToMonitor(ruleTarget());

    expect(addSpy).not.toHaveBeenCalled();
  });

  /*
   * The ceiling is only a ceiling if crossing it is audible. A read that
   * comes back exactly full is indistinguishable from a truncated one, so it
   * has to be reported - otherwise 10,000 is the old 100-rule cliff moved
   * 100x further out, and the next #3506 arrives the same way this one did:
   * as a customer noticing bare monitors, with nothing in the logs.
   */
  it("logs an error when the read comes back at the ceiling", async () => {
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    mockRuleFetch(
      projectWithRules({
        ruleCount: MAX_RULES_EVALUATED_PER_PROJECT,
        matchingIndex: 0,
      }),
    );
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(fakeMonitorDetails());
    mockLabelAttach();
    mockFeedItem();

    await MonitorLabelRuleEngineService.applyRulesToMonitor(ruleTarget());

    const truncationLogs: Array<unknown> = errorSpy.mock.calls.filter(
      (call: Array<unknown>) => {
        return (
          typeof call[0] === "string" && call[0].includes("MonitorLabelRule")
        );
      },
    );

    expect(truncationLogs).toHaveLength(1);
    expect(String(truncationLogs[0])).toContain("NOT being evaluated");
  });

  // ...and stays quiet for the project size that actually broke.
  it("stays silent at the reporter's 1,243 rules", async () => {
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    mockRuleFetch(
      projectWithRules({
        ruleCount: RULES_IN_PROJECT,
        matchingIndex: 1200,
      }),
    );
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(fakeMonitorDetails());
    mockLabelAttach();
    mockFeedItem();

    await MonitorLabelRuleEngineService.applyRulesToMonitor(ruleTarget());

    expect(errorSpy).not.toHaveBeenCalled();
  });

  /*
   * A rule at the very end of a full-size project still runs. This is the
   * boundary the constant itself promises.
   */
  it("evaluates the last rule of a project sitting at the ceiling", async () => {
    const ruleCount: number = MAX_RULES_EVALUATED_PER_PROJECT;

    mockRuleFetch(
      projectWithRules({
        ruleCount: ruleCount,
        matchingIndex: ruleCount - 1,
      }),
    );
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(fakeMonitorDetails());
    const addSpy: jest.Mock = mockLabelAttach();
    mockFeedItem();

    await MonitorLabelRuleEngineService.applyRulesToMonitor(ruleTarget());

    expect(addSpy).toHaveBeenCalledTimes(1);
  });
});

describe("MonitorLabelRuleEngineService - matching across a large rule set", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("unions the labels of every matching rule and attaches each once", async () => {
    const rules: Array<MonitorLabelRule> = projectWithRules({
      ruleCount: RULES_IN_PROJECT,
      matchingIndex: 1200,
    });

    // A second rule, further down still, adding a different label.
    rules[1240] = fakeRule(1240, {
      name: "Site Label - WB1396",
      monitorNamePattern: "WB1396",
      labelsToAdd: [fakeLabel(SITE_LABEL_ID)],
    });

    // And a third repeating the first rule's label - it must not double up.
    rules[1241] = fakeRule(1241, {
      name: "Duplicate Unit Label - WB1396",
      monitorNamePattern: "wb1396",
      labelsToAdd: [fakeLabel(UNIT_LABEL_ID)],
    });

    mockRuleFetch(rules);
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(fakeMonitorDetails());
    const addSpy: jest.Mock = mockLabelAttach();
    mockFeedItem();

    await MonitorLabelRuleEngineService.applyRulesToMonitor(ruleTarget());

    expect(addSpy).toHaveBeenCalledTimes(1);

    const attached: Array<string> = addSpy.mock.calls[0]![0] as Array<string>;

    expect(attached).toHaveLength(2);
    expect(attached).toEqual(
      expect.arrayContaining([
        UNIT_LABEL_ID.toString(),
        SITE_LABEL_ID.toString(),
      ]),
    );
  });

  /*
   * Re-labelling is additive, so a monitor that already carries everything
   * its rules attach must not produce an insert - the join table's primary
   * key would reject it.
   */
  it("attaches nothing when the monitor already carries the matched labels", async () => {
    mockRuleFetch(
      projectWithRules({
        ruleCount: RULES_IN_PROJECT,
        matchingIndex: 1200,
      }),
    );
    jest.spyOn(MonitorService, "findOneById").mockResolvedValue(
      fakeMonitorDetails({
        labels: [fakeLabel(UNIT_LABEL_ID)],
      }),
    );
    const addSpy: jest.Mock = mockLabelAttach();
    mockFeedItem();

    await MonitorLabelRuleEngineService.applyRulesToMonitor(ruleTarget());

    expect(addSpy).not.toHaveBeenCalled();
  });

  /*
   * One unparseable pattern among a thousand rules is a typo in one row, not
   * a reason for the other 1,242 to stop being evaluated.
   */
  it("keeps evaluating later rules after an invalid regex", async () => {
    const rules: Array<MonitorLabelRule> = projectWithRules({
      ruleCount: RULES_IN_PROJECT,
      matchingIndex: 1200,
    });

    rules[500] = fakeRule(500, {
      name: "Broken Rule",
      monitorNamePattern: "switch-(01",
    });

    mockRuleFetch(rules);
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(fakeMonitorDetails());
    const addSpy: jest.Mock = mockLabelAttach();
    mockFeedItem();

    await MonitorLabelRuleEngineService.applyRulesToMonitor(ruleTarget());

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy.mock.calls[0]![0]).toEqual([UNIT_LABEL_ID.toString()]);
  });

  /*
   * The engine writes the labels back onto the in-memory monitor so the
   * owner-rule engine, which runs next in the same onCreateSuccess chain,
   * can key on them. A rule found past position 100 has to land there too.
   */
  it("syncs the in-memory monitor with the labels a late rule added", async () => {
    mockRuleFetch(
      projectWithRules({
        ruleCount: RULES_IN_PROJECT,
        matchingIndex: 1200,
      }),
    );
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(fakeMonitorDetails());
    mockLabelAttach();
    mockFeedItem();

    const monitor: Monitor = ruleTarget();

    await MonitorLabelRuleEngineService.applyRulesToMonitor(monitor);

    expect(
      (monitor.labels || []).map((label: Label) => {
        return label.id?.toString();
      }),
    ).toEqual([UNIT_LABEL_ID.toString()]);
  });

  it("names the rule that fired in the monitor's feed", async () => {
    mockRuleFetch(
      projectWithRules({
        ruleCount: RULES_IN_PROJECT,
        matchingIndex: 1200,
      }),
    );
    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(fakeMonitorDetails());
    mockLabelAttach();
    const feedSpy: jest.Mock = mockFeedItem();

    await MonitorLabelRuleEngineService.applyRulesToMonitor(ruleTarget());

    expect(feedSpy).toHaveBeenCalledTimes(1);

    const feedItem: { feedInfoInMarkdown: string } = feedSpy.mock
      .calls[0]![0] as { feedInfoInMarkdown: string };

    expect(feedItem.feedInfoInMarkdown).toContain("Unit Label - WB1396");
    expect(feedItem.feedInfoInMarkdown).toContain("WB1396");
  });

  // A project with no rules must not pay for a monitor read it cannot use.
  it("does not read the monitor when the project has no enabled rules", async () => {
    mockRuleFetch([]);
    const findOneByIdSpy: jest.SpyInstance = jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(fakeMonitorDetails());
    const addSpy: jest.Mock = mockLabelAttach();

    await MonitorLabelRuleEngineService.applyRulesToMonitor(ruleTarget());

    expect(findOneByIdSpy).not.toHaveBeenCalled();
    expect(addSpy).not.toHaveBeenCalled();
  });
});
