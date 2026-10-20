import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPageMonitorRule from "../../../Models/DatabaseModels/StatusPageMonitorRule";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import MonitorService from "../../../Server/Services/MonitorService";
import StatusPageMonitorRuleEngineService from "../../../Server/Services/StatusPageMonitorRuleEngineService";
import StatusPageMonitorRuleService from "../../../Server/Services/StatusPageMonitorRuleService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import ObjectID from "../../../Types/ObjectID";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../Utils/Rules/RuleEngineLimits";
import { PatternWorkAllowance } from "../../../Utils/LinearRegExp/PatternWork";
import { clearKeptAutomata } from "../../../Utils/LinearRegExp/Matcher";
import { clearLinearRegExpCache } from "../../../Utils/LinearRegExp/PatternCache";
import { fastestRunAsync, FastestRun } from "../../Helpers/FastestRun";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * WILDCARD RULES SHARE THE EVALUATION'S ALLOWANCE TOO.
 *
 * A rule's pattern with a '*' is also read as a wildcard
 * (RulePatternMatchUtil.matches), and the status page and SLO monitor rules
 * read it against a monitor's description, which has no length limit. The
 * wildcard question did not run on the matcher, so it was not counted: once
 * the regular expressions had spent the evaluation's allowance, every rule
 * after them still read the whole description as a wildcard - seconds of
 * one server for one monitor change. These run the status page monitor rule
 * engine through its own entry point: wildcard rules built to read all of a
 * long description end within the allowance, and plain ones are answered
 * as before.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

function monitorDescribed(description: string): Monitor {
  return {
    id: MONITOR_ID,
    _id: MONITOR_ID.toString(),
    projectId: PROJECT_ID,
    name: "API Monitor",
    description: description,
    labels: [],
  } as unknown as Monitor;
}

function ruleWithDescriptionPattern(
  index: number,
  pattern: string,
): StatusPageMonitorRule {
  const id: ObjectID = new ObjectID(
    `77777777-7777-4777-8777-${index.toString().padStart(12, "0")}`,
  );

  return {
    id: id,
    _id: id.toString(),
    projectId: PROJECT_ID,
    statusPageId: STATUS_PAGE_ID,
    isEnabled: true,
    monitorLabels: [],
    monitorDescriptionPattern: pattern,
  } as unknown as StatusPageMonitorRule;
}

// Every allowance an evaluation is given, to read what it counted.
function captureAllowances(): Array<PatternWorkAllowance> {
  const made: Array<PatternWorkAllowance> = [];
  const original: () => PatternWorkAllowance =
    PatternWorkAllowance.forRuleEvaluation;

  jest
    .spyOn(PatternWorkAllowance, "forRuleEvaluation")
    .mockImplementation((): PatternWorkAllowance => {
      const allowance: PatternWorkAllowance = original();
      made.push(allowance);
      return allowance;
    });

  return made;
}

let resourceCreateSpy: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(StatusPageResourceService, "findBy").mockResolvedValue([]);
  resourceCreateSpy = jest
    .spyOn(StatusPageResourceService, "create")
    .mockResolvedValue(new StatusPageResource());
  jest.spyOn(StatusPageResourceService, "deleteOneById").mockResolvedValue(1);
  jest.spyOn(StatusPageResourceService, "updateOneById").mockResolvedValue(1);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a monitor's status page monitor rules", () => {
  jest.setTimeout(300_000);

  it(`${MAX_RULES_EVALUATED_PER_PROJECT} wildcard rules reading a long description end within the evaluation's allowance`, async () => {
    const description: string = "x".repeat(100_000);
    const rules: Array<StatusPageMonitorRule> = [];

    for (
      let index: number = 0;
      index < MAX_RULES_EVALUATED_PER_PROJECT;
      index++
    ) {
      rules.push(ruleWithDescriptionPattern(index, `*x${index}*`));
    }

    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(monitorDescribed(description));
    jest.spyOn(StatusPageMonitorRuleService, "findBy").mockResolvedValue(rules);

    const allowances: Array<PatternWorkAllowance> = captureAllowances();

    const run: FastestRun<void> = await fastestRunAsync({
      run: async (): Promise<void> => {
        clearLinearRegExpCache();
        clearKeptAutomata();
        await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
          monitorId: MONITOR_ID,
        });
      },
      limitInMs: 5000,
    });

    expect(run.inMs).toBeLessThan(5000);

    const allowance: PatternWorkAllowance = allowances[allowances.length - 1]!;

    // The wildcards were counted: the allowance was spent, and it held.
    expect(allowance.isSpent).toBe(true);
    expect(allowance.stoppedQuestions).toBeGreaterThan(0);
    expect(allowance.usedWork).toBeLessThan(
      allowance.allowedWork + 65_536 + description.length,
    );
    expect(resourceCreateSpy).not.toHaveBeenCalled();
  });

  it("plain wildcard rules are each answered, as before", async () => {
    const rules: Array<StatusPageMonitorRule> = [];

    for (let index: number = 0; index < 1_000; index++) {
      rules.push(ruleWithDescriptionPattern(index, `*team-${index} *`));
    }

    jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(
        monitorDescribed("Checkout API, owned by team-999 (payments)."),
      );
    jest.spyOn(StatusPageMonitorRuleService, "findBy").mockResolvedValue(rules);

    const allowances: Array<PatternWorkAllowance> = captureAllowances();

    await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
      monitorId: MONITOR_ID,
    });

    // The last rule's wildcard matches, and only it adds the monitor.
    expect(resourceCreateSpy).toHaveBeenCalledTimes(1);
    expect(allowances).toHaveLength(1);
    expect(allowances[0]!.stoppedQuestions).toBe(0);
    expect(allowances[0]!.isSpent).toBe(false);
  });
});
