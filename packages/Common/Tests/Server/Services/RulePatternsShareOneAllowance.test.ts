import MonitorLabelRuleEngineService from "../../../Server/Services/MonitorLabelRuleEngineService";
import MonitorLabelRuleService from "../../../Server/Services/MonitorLabelRuleService";
import MonitorFeedService from "../../../Server/Services/MonitorFeedService";
import MonitorService from "../../../Server/Services/MonitorService";
import LabelService from "../../../Server/Services/LabelService";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorLabelRule from "../../../Models/DatabaseModels/MonitorLabelRule";
import ObjectID from "../../../Types/ObjectID";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import FindBy from "../../../Server/Types/Database/FindBy";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../Utils/Rules/RuleEngineLimits";
import {
  PatternWorkAllowance,
  RULE_EVALUATION_WORK,
  WORK_PER_TEXT_CHARACTER,
} from "../../../Utils/LinearRegExp/PatternWork";
import {
  clearKeptAutomata,
  WORK_PER_CODE_UNIT,
  WORK_PER_STEP,
} from "../../../Utils/LinearRegExp/Matcher";
import { clearLinearRegExpCache } from "../../../Utils/LinearRegExp/PatternCache";
import { fastestRunAsync, FastestRun } from "../../Helpers/FastestRun";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A PROJECT'S RULES OF ONE KIND SHARE ONE ALLOWANCE FOR EACH RESOURCE.
 *
 * Each pattern question is bounded on its own, but an evaluation asks one
 * per rule and field - up to 10,000 rules of a kind - inline, when the
 * resource is created, on a server every project shares. A rule's pattern
 * can be written so that each question takes all its own limit allows, and
 * so that it must be compiled anew every time, and before this every one of
 * them was asked: tens of seconds of one server for one new resource.
 *
 * Every rule engine's evaluation now has one allowance of work
 * (Utils/LinearRegExp/PatternWork.ts): these run the monitor label rule
 * engine, through its own create hook, on such rules - stopped within the
 * allowance - and on the most plain rules an evaluation reads, every one of
 * them answered as before.
 *
 * PATTERN_RULE_COUNT sets how many rules the first test builds, so the
 * suite can be run against the old code and fail rather than take minutes.
 * ---------------------------------------------------------------------------
 */

const RULE_COUNT: number = Number(
  process.env["PATTERN_RULE_COUNT"] || MAX_RULES_EVALUATED_PER_PROJECT,
);

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const LABEL_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

// Written to need many steps per character on a's and b's (LinearRegExp.test.ts).
const EXPLODING: string = "(?:[ab]*a[ab]{14}|[ab]{0,2000})Q";

function randomAb(length: number, seed: number): string {
  const random: SeededRandom = seededRandom(seed);
  let text: string = "";

  for (let index: number = 0; index < length; index++) {
    text += random(2) === 0 ? "a" : "b";
  }

  return text;
}

/*
 * A rule pattern of a few hundred characters - a rule's column holds 500 -
 * built so that its automaton keeps almost no state and each question
 * takes about all its own limit allows, and so that each rule's is its own:
 * no cache keeps ten thousand of them.
 */
function heavyPattern(index: number): string {
  let wide: string = "";

  for (let codeUnit: number = 0x4e00; wide.length < 380; codeUnit += 2) {
    wide += String.fromCharCode(codeUnit);
  }

  return `(?=.)(?!\\n)(?<=.)(?<!\\r)[${wide}]?(?:a?){${2000 + (index % 400)}}b`;
}

function fakeLabel(id: ObjectID): Label {
  return { id: id, _id: id.toString() } as unknown as Label;
}

function ruleTarget(): Monitor {
  return {
    id: MONITOR_ID,
    _id: MONITOR_ID.toString(),
    projectId: PROJECT_ID,
  } as unknown as Monitor;
}

function monitorNamed(name: string): Monitor {
  return {
    id: MONITOR_ID,
    _id: MONITOR_ID.toString(),
    projectId: PROJECT_ID,
    name: name,
    labels: [],
  } as unknown as Monitor;
}

function labelRule(
  index: number,
  data: Record<string, unknown>,
): MonitorLabelRule {
  return {
    id: new ObjectID(
      `77777777-7777-4777-8777-${index.toString().padStart(12, "0")}`,
    ),
    name: `Label rule ${index}`,
    labelsToAdd: [fakeLabel(LABEL_ID)],
    ...data,
  } as unknown as MonitorLabelRule;
}

interface EngineMocks {
  attached: jest.Mock;
}

function mockEngine(data: {
  rules: Array<MonitorLabelRule>;
  monitor: Monitor;
}): EngineMocks {
  jest.spyOn(MonitorLabelRuleService, "findBy").mockImplementation((async (
    findBy: FindBy<MonitorLabelRule>,
  ) => {
    return data.rules.slice(0, Number(findBy.limit ?? 0));
  }) as any);
  jest.spyOn(MonitorService, "findOneById").mockResolvedValue(data.monitor);

  const attached: jest.Mock = jest.fn().mockResolvedValue(undefined);

  jest.spyOn(MonitorService, "getRepository").mockReturnValue({
    createQueryBuilder: (): any => {
      return {
        relation: (): any => {
          return {
            of: (): any => {
              return { add: attached };
            },
          };
        },
      };
    },
  } as any);
  jest
    .spyOn(LabelService, "findBy")
    .mockResolvedValue([{ id: LABEL_ID, name: "Prod" } as unknown as Label]);
  jest
    .spyOn(MonitorFeedService, "createMonitorFeedItem")
    .mockResolvedValue(undefined as any);

  return { attached: attached };
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

beforeEach(() => {
  stubProjectDirectory({});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a new monitor's label rules", () => {
  jest.setTimeout(300_000);

  it(`${RULE_COUNT} rules built to take all the work they may are stopped within the evaluation's allowance`, async () => {
    const title: string = randomAb(100, 1);
    const rules: Array<MonitorLabelRule> = [];

    for (let index: number = 0; index < RULE_COUNT; index++) {
      rules.push(labelRule(index, { monitorNamePattern: heavyPattern(index) }));
    }

    const allowances: Array<PatternWorkAllowance> = captureAllowances();

    mockEngine({ rules: rules, monitor: monitorNamed(title) });

    const run: FastestRun<void> = await fastestRunAsync({
      run: async (): Promise<void> => {
        clearLinearRegExpCache();
        clearKeptAutomata();
        await MonitorLabelRuleEngineService.applyRulesToMonitor(ruleTarget());
      },
      limitInMs: 5000,
    });

    // Every rule was asked about, as many as the project holds.
    expect(rules).toHaveLength(RULE_COUNT);
    expect(run.inMs).toBeLessThan(5000);

    const allowance: PatternWorkAllowance = allowances[allowances.length - 1]!;

    /*
     * What it counted: the allowance, and at most one compile and one
     * question past it - not the thousands of rules after.
     */
    const onePastIt: number =
      2_000_000 +
      WORK_PER_CODE_UNIT * (title.length + 1) +
      WORK_PER_STEP * 40_000;

    expect(allowance.usedWork).toBeLessThan(
      RULE_EVALUATION_WORK + WORK_PER_TEXT_CHARACTER * title.length + onePastIt,
    );
    expect(allowance.stoppedQuestions).toBeGreaterThan(0);
  });

  it("the most plain rules an evaluation reads are each answered, as before", async () => {
    const rules: Array<MonitorLabelRule> = [];

    for (
      let index: number = 0;
      index < MAX_RULES_EVALUATED_PER_PROJECT;
      index++
    ) {
      rules.push(
        labelRule(index, {
          monitorNamePattern: `^WB${10_000 + index} - core`,
        }),
      );
    }

    const allowances: Array<PatternWorkAllowance> = captureAllowances();
    const mocks: EngineMocks = mockEngine({
      rules: rules,
      // The last rule the evaluation reads is the one that matches.
      monitor: monitorNamed(
        `WB${10_000 + MAX_RULES_EVALUATED_PER_PROJECT - 1} - Core Switch`,
      ),
    });

    clearLinearRegExpCache();
    clearKeptAutomata();

    await MonitorLabelRuleEngineService.applyRulesToMonitor(ruleTarget());

    expect(mocks.attached).toHaveBeenCalledTimes(1);
    expect(mocks.attached.mock.calls[0]![0]).toEqual([LABEL_ID.toString()]);
    expect(allowances).toHaveLength(1);
    expect(allowances[0]!.stoppedQuestions).toBe(0);
    expect(allowances[0]!.isSpent).toBe(false);
  });

  it("a rule whose negated condition cannot be answered adds no label", async () => {
    const mocks: EngineMocks = mockEngine({
      rules: [
        labelRule(1, {
          criteria: {
            schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
            filterCondition: FilterCondition.All,
            filters: [
              {
                field: "monitorNamePattern",
                operator: RuleCriteriaOperator.DoesNotMatchPattern,
                value: EXPLODING,
              },
            ],
          },
        }),
      ],
      monitor: monitorNamed(randomAb(60_000, 2)),
    });

    await MonitorLabelRuleEngineService.applyRulesToMonitor(ruleTarget());

    expect(mocks.attached).not.toHaveBeenCalled();
  });

  it("a rule whose negated condition is answered still adds its label", async () => {
    const mocks: EngineMocks = mockEngine({
      rules: [
        labelRule(1, {
          criteria: {
            schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
            filterCondition: FilterCondition.All,
            filters: [
              {
                field: "monitorNamePattern",
                operator: RuleCriteriaOperator.DoesNotMatchPattern,
                value: "^staging-",
              },
            ],
          },
        }),
      ],
      monitor: monitorNamed("prod-db-01"),
    });

    await MonitorLabelRuleEngineService.applyRulesToMonitor(ruleTarget());

    expect(mocks.attached).toHaveBeenCalledTimes(1);
  });

  it("each evaluation has an allowance of its own: one spent leaves the next monitor's whole", async () => {
    const allowances: Array<PatternWorkAllowance> = captureAllowances();
    const heavy: Array<MonitorLabelRule> = [];

    for (let index: number = 0; index < 400; index++) {
      heavy.push(labelRule(index, { monitorNamePattern: heavyPattern(index) }));
    }

    mockEngine({ rules: heavy, monitor: monitorNamed(randomAb(100, 3)) });
    await MonitorLabelRuleEngineService.applyRulesToMonitor(ruleTarget());
    jest.restoreAllMocks();
    stubProjectDirectory({});

    const original: () => PatternWorkAllowance =
      PatternWorkAllowance.forRuleEvaluation;

    jest
      .spyOn(PatternWorkAllowance, "forRuleEvaluation")
      .mockImplementation((): PatternWorkAllowance => {
        const allowance: PatternWorkAllowance = original();
        allowances.push(allowance);
        return allowance;
      });

    const mocks: EngineMocks = mockEngine({
      rules: [labelRule(1, { monitorNamePattern: "^prod-" })],
      monitor: monitorNamed("prod-db-02"),
    });

    await MonitorLabelRuleEngineService.applyRulesToMonitor(ruleTarget());

    expect(allowances).toHaveLength(2);
    expect(allowances[0]!.isSpent).toBe(true);
    expect(allowances[1]!.isSpent).toBe(false);
    expect(mocks.attached).toHaveBeenCalledTimes(1);
  });
});
