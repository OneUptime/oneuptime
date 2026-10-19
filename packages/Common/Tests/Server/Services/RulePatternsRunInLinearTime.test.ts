import Alert from "../../../Models/DatabaseModels/Alert";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import IncidentSlaRule from "../../../Models/DatabaseModels/IncidentSlaRule";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentSlaRuleService from "../../../Server/Services/IncidentSlaRuleService";
import MonitorService from "../../../Server/Services/MonitorService";
import IncidentAlertRuleMatcher, {
  IncidentAlertMatchRule,
} from "../../../Server/Utils/Rules/IncidentAlertRuleMatcher";
import ObjectID from "../../../Types/ObjectID";
import RulePatternMatchUtil from "../../../Utils/Rules/RulePatternMatchUtil";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ---------------------------------------------------------------------------
 * A RULE'S PATTERN TAKES TIME IN LINE WITH THE TEXT IT READS.
 *
 * Every rule a project writes with a pattern - label, owner, on-call,
 * privacy and runbook rules for every kind of resource, alert and incident
 * grouping rules, SLA rules, AI investigation and auto-remediation rules -
 * matched it with JavaScript's RegExp on the server every project shares.
 * A pattern such as (a+)+$ takes time that doubles with every character of
 * the text it does not match, so one rule and one long title held the
 * server for good. These run each engine's own matching on such patterns
 * and long texts: each answers, correctly, in well under two seconds.
 *
 * PATTERN_TEXT_LENGTH shortens the texts, so this suite can be run against
 * the old code and fail rather than never end.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = Number(process.env["PATTERN_TEXT_LENGTH"] || 100000);
const BUDGET_IN_MS: number = 2000;

interface SlowCase {
  name: string;
  pattern: string;
  text: string;
  matches: boolean;
}

// Patterns JavaScript's RegExp takes exponential or high-polynomial time on.
const SLOW_CASES: ReadonlyArray<SlowCase> = [
  {
    name: "a nested repeat that never ends the text",
    pattern: "(a+)+$",
    text: `${"a".repeat(LENGTH)}!`,
    matches: false,
  },
  {
    name: "words with optional spaces",
    pattern: "^(\\w+\\s?)*$",
    text: `${"word ".repeat(Math.ceil(LENGTH / 5))}!`,
    matches: false,
  },
  {
    name: "two ways to read the same character",
    pattern: "^(?:a|aa)+$",
    text: `${"a".repeat(LENGTH)}b`,
    matches: false,
  },
  {
    name: "twelve runs that each may take anything",
    pattern: "(?:.*a){12}z",
    text: "a".repeat(LENGTH),
    matches: false,
  },
  {
    // Each repetition reads ahead to the "b" again: the square of the text.
    name: "a look-ahead read again at every position",
    pattern: "^(?:(?=a+b)a)+c",
    text: `${"a".repeat(LENGTH)}b`,
    matches: false,
  },
];

function timed<T>(work: () => T): { result: T; milliseconds: number } {
  const startedAt: number = Date.now();
  const result: T = work();

  return { result: result, milliseconds: Date.now() - startedAt };
}

async function timedAsync<T>(
  work: () => Promise<T>,
): Promise<{ result: T; milliseconds: number }> {
  const startedAt: number = Date.now();
  const result: T = await work();

  return { result: result, milliseconds: Date.now() - startedAt };
}

const SERVICES_DIRECTORY: string = path.join(
  __dirname,
  "../../../Server/Services",
);

type TestRegex = (pattern: string, value: string, rule: unknown) => boolean;

interface PatternEngine {
  file: string;
  testRegex: TestRegex;
}

// Every service with a testRegex of its own: the rule engines.
async function loadPatternEngines(): Promise<Array<PatternEngine>> {
  const engines: Array<PatternEngine> = [];
  const files: Array<string> = fs
    .readdirSync(SERVICES_DIRECTORY)
    .filter((file: string): boolean => {
      return (
        file.endsWith(".ts") &&
        fs
          .readFileSync(path.join(SERVICES_DIRECTORY, file), "utf8")
          .includes("private testRegex(")
      );
    })
    .sort();

  for (const file of files) {
    const loaded: { default: unknown } = (await import(
      path.join(SERVICES_DIRECTORY, file)
    )) as { default: unknown };
    const service: { testRegex?: TestRegex } = loaded.default as {
      testRegex?: TestRegex;
    };

    if (typeof service.testRegex !== "function") {
      throw new Error(`${file} has a testRegex the test cannot reach.`);
    }

    engines.push({
      file: file,
      testRegex: service.testRegex.bind(service),
    });
  }

  return engines;
}

const RULE: { id: ObjectID } = {
  id: new ObjectID("00000000-0000-4000-8000-000000000101"),
};

describe("every rule engine's own pattern match", () => {
  test("there are the rule engines this was written for, and more cannot hide", async () => {
    const engines: Array<PatternEngine> = await loadPatternEngines();

    // 67 label, owner, on-call, privacy and runbook rule engines.
    expect(engines.length).toBeGreaterThanOrEqual(67);
  });

  test.each(SLOW_CASES)(
    "answers $name in time in line with the text",
    async (slow: SlowCase) => {
      const engines: Array<PatternEngine> = await loadPatternEngines();

      for (const engine of engines) {
        const { result, milliseconds } = timed((): boolean => {
          return engine.testRegex(slow.pattern, slow.text, RULE);
        });

        expect({ file: engine.file, result }).toEqual({
          file: engine.file,
          result: slow.matches,
        });
        expect({ file: engine.file, milliseconds }).toEqual({
          file: engine.file,
          milliseconds: expect.any(Number),
        });
        expect(milliseconds).toBeLessThan(BUDGET_IN_MS);
      }
    },
  );

  test("still matches as JavaScript did: case-insensitive, look-arounds and all", async () => {
    const engines: Array<PatternEngine> = await loadPatternEngines();

    for (const engine of engines) {
      const answers: Array<boolean> = [
        engine.testRegex("^prod-", "PROD-payments-db", RULE),
        engine.testRegex("^prod-(?!test)", "prod-test-db", RULE),
        engine.testRegex("^prod-(?!test)", "prod-payments-db", RULE),
        engine.testRegex("(?<=db-)0\\d", "db-03", RULE),
        engine.testRegex("database|postgres", "A Postgres replica", RULE),
        engine.testRegex("api-(01", "api-(01", RULE),
      ];

      expect({ file: engine.file, answers }).toEqual({
        file: engine.file,
        answers: [true, false, true, true, true, false],
      });
    }
  });

  /*
   * A back-reference cannot run in linear time: a rule with one matches
   * nothing (the save refuses new ones - DatabaseService).
   */
  test("matches nothing with a pattern that refers back to a group", async () => {
    const engines: Array<PatternEngine> = await loadPatternEngines();

    for (const engine of engines) {
      expect({
        file: engine.file,
        answer: engine.testRegex("(a)\\1", "aa", RULE),
      }).toEqual({ file: engine.file, answer: false });
    }
  });
});

describe("grouping, SLA and AI rules", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const PROJECT_ID: ObjectID = new ObjectID(
    "00000000-0000-4000-8000-0000000000a1",
  );
  const MONITOR_ID: ObjectID = new ObjectID(
    "00000000-0000-4000-8000-0000000000c1",
  );

  function alertTitled(title: string, description: string): Alert {
    const alert: Alert = new Alert();
    alert.id = new ObjectID("00000000-0000-4000-8000-0000000000e1");
    alert.projectId = PROJECT_ID;
    alert.title = title;
    alert.description = description;
    alert.monitorId = MONITOR_ID;
    return alert;
  }

  function incidentTitled(title: string, description: string): Incident {
    const incident: Incident = new Incident();
    incident.id = new ObjectID("00000000-0000-4000-8000-0000000000e2");
    incident.projectId = PROJECT_ID;
    incident.title = title;
    incident.description = description;
    return incident;
  }

  type AlertRuleMatch = (
    alert: Alert,
    rule: AlertGroupingRule,
  ) => Promise<boolean>;
  type IncidentRuleMatch = (
    incident: Incident,
    rule: IncidentGroupingRule,
  ) => Promise<boolean>;

  const alertGroupingMatch: AlertRuleMatch = (
    AlertGroupingEngineService as unknown as {
      doesAlertMatchRule: AlertRuleMatch;
    }
  ).doesAlertMatchRule.bind(AlertGroupingEngineService);
  const incidentGroupingMatch: IncidentRuleMatch = (
    IncidentGroupingEngineService as unknown as {
      doesIncidentMatchRule: IncidentRuleMatch;
    }
  ).doesIncidentMatchRule.bind(IncidentGroupingEngineService);

  test.each(SLOW_CASES)(
    "an alert grouping rule's title, description and monitor patterns: $name",
    async (slow: SlowCase) => {
      const monitor: Monitor = new Monitor();
      monitor.id = MONITOR_ID;
      monitor.name = slow.text;
      monitor.description = slow.text;
      jest
        .spyOn(MonitorService, "findOneById")
        .mockResolvedValue(monitor as never);

      for (const field of [
        "alertTitlePattern",
        "alertDescriptionPattern",
        "monitorNamePattern",
        "monitorDescriptionPattern",
      ] as const) {
        const rule: AlertGroupingRule = new AlertGroupingRule();
        rule.id = RULE.id;
        rule[field] = slow.pattern;

        const { result, milliseconds } = await timedAsync(
          (): Promise<boolean> => {
            return alertGroupingMatch(alertTitled(slow.text, slow.text), rule);
          },
        );

        expect({ field, result }).toEqual({ field, result: slow.matches });
        expect(milliseconds).toBeLessThan(BUDGET_IN_MS);
      }
    },
  );

  test.each(SLOW_CASES)(
    "an incident grouping rule's title and description patterns: $name",
    async (slow: SlowCase) => {
      for (const field of [
        "incidentTitlePattern",
        "incidentDescriptionPattern",
      ] as const) {
        const rule: IncidentGroupingRule = new IncidentGroupingRule();
        rule.id = RULE.id;
        rule[field] = slow.pattern;

        const { result, milliseconds } = await timedAsync(
          (): Promise<boolean> => {
            return incidentGroupingMatch(
              incidentTitled(slow.text, slow.text),
              rule,
            );
          },
        );

        expect({ field, result }).toEqual({ field, result: slow.matches });
        expect(milliseconds).toBeLessThan(BUDGET_IN_MS);
      }
    },
  );

  test.each(SLOW_CASES)(
    "an SLA rule's title and description patterns: $name",
    async (slow: SlowCase) => {
      for (const field of [
        "incidentTitlePattern",
        "incidentDescriptionPattern",
      ] as const) {
        const rule: IncidentSlaRule = new IncidentSlaRule();
        rule.id = RULE.id;
        rule[field] = slow.pattern;

        const { result, milliseconds } = await timedAsync(
          (): Promise<boolean> => {
            return IncidentSlaRuleService.doesIncidentMatchRule(
              incidentTitled(slow.text, slow.text),
              rule,
            );
          },
        );

        expect({ field, result }).toEqual({ field, result: slow.matches });
        expect(milliseconds).toBeLessThan(BUDGET_IN_MS);
      }
    },
  );

  test.each(SLOW_CASES)(
    "an AI investigation or auto-remediation rule's patterns: $name",
    async (slow: SlowCase) => {
      for (const field of ["titlePattern", "descriptionPattern"] as const) {
        const rule: IncidentAlertMatchRule = {
          id: RULE.id,
          [field]: slow.pattern,
        } as IncidentAlertMatchRule;

        const incident: { result: boolean; milliseconds: number } =
          await timedAsync((): Promise<boolean> => {
            return IncidentAlertRuleMatcher.doesIncidentMatch(
              incidentTitled(slow.text, slow.text),
              rule,
              "auto-remediation rule",
            );
          });
        const alert: { result: boolean; milliseconds: number } =
          await timedAsync((): Promise<boolean> => {
            return IncidentAlertRuleMatcher.doesAlertMatch(
              alertTitled(slow.text, slow.text),
              rule,
              "AI investigation rule",
            );
          });

        expect([incident.result, alert.result]).toEqual([
          slow.matches,
          slow.matches,
        ]);
        expect(incident.milliseconds).toBeLessThan(BUDGET_IN_MS);
        expect(alert.milliseconds).toBeLessThan(BUDGET_IN_MS);
      }
    },
  );

  test("a grouping rule still groups what its pattern matches", async () => {
    const rule: AlertGroupingRule = new AlertGroupingRule();
    rule.id = RULE.id;
    rule.alertTitlePattern = "^High CPU on (?!staging-)";

    expect(
      await alertGroupingMatch(alertTitled("High CPU on prod-db-03", ""), rule),
    ).toBe(true);
    expect(
      await alertGroupingMatch(
        alertTitled("High CPU on staging-db-03", ""),
        rule,
      ),
    ).toBe(false);
  });
});

describe("RulePatternMatchUtil, which the SLO, status page and network rules use", () => {
  test.each(SLOW_CASES)(
    "matches answers $name in time in line with the text",
    (slow: SlowCase) => {
      const { result, milliseconds } = timed((): boolean => {
        return RulePatternMatchUtil.matches(slow.text, slow.pattern);
      });

      expect(result).toBe(slow.matches);
      expect(milliseconds).toBeLessThan(BUDGET_IN_MS);
    },
  );
});
