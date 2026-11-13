import Alert from "../../../Models/DatabaseModels/Alert";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertOnCallRuleEngineService from "../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOnCallRuleService from "../../../Server/Services/AlertOnCallRuleService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOnCallRuleService from "../../../Server/Services/IncidentOnCallRuleService";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import { OnCallRulesPaging } from "../../../Server/Utils/OnCall/OnCallRulePageAs";
import MonitorRuleCriteriaCache from "../../../Server/Utils/Rules/MonitorRuleCriteriaCache";
import ObjectID from "../../../Types/ObjectID";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHAT "WHEN THIS GOES DOWN" SAYS WOULD PAGE IS WHAT PAGES (#6810).
 *
 * The resolver (WhoIsToldService) asks each rule engine which on-call rules
 * match an incident or alert a monitor's criteria would open, held in
 * memory (getMatchingRules), and the engines page what the same method
 * returns (applyRulesToIncident, applyRulesToAlert). Over generated rules
 * and records - severities, monitors, labels and title patterns, drawn
 * from a seed so a failure can be run again - the policies the resolver
 * would show are exactly the policies the engine pages, and both are what
 * a plain reading of each rule says.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "68100000-0000-4000-8000-000000000001",
);

const POLICIES: Array<string> = [
  "68100000-0000-4000-8000-0000000000a1",
  "68100000-0000-4000-8000-0000000000a2",
  "68100000-0000-4000-8000-0000000000a3",
];
const SEVERITIES: Array<string> = [
  "68100000-0000-4000-8000-0000000000b1",
  "68100000-0000-4000-8000-0000000000b2",
  "68100000-0000-4000-8000-0000000000b3",
];
const MONITORS: Array<string> = [
  "68100000-0000-4000-8000-0000000000c1",
  "68100000-0000-4000-8000-0000000000c2",
];
const LABELS: Array<string> = [
  "68100000-0000-4000-8000-0000000000d1",
  "68100000-0000-4000-8000-0000000000d2",
];
const TITLES: Array<string> = ["Checkout API is down", "Search is slow"];
const PATTERNS: Array<string> = ["Checkout", "slow$", "^Billing"];

const CASES: number = 150;

// A generated rule, as plain facts, and the record it is matched against.
interface RuleFacts {
  severities: Array<string>;
  monitors: Array<string>;
  labels: Array<string>;
  titlePattern: string | null;
  policies: Array<string>;
}

interface RecordFacts {
  severity: string;
  monitor: string;
  labels: Array<string>;
  title: string;
}

function pick<T>(items: Array<T>, random: SeededRandom): T {
  return items[random(items.length)]!;
}

// None of them half the time; otherwise one or two.
function someOf(items: Array<string>, random: SeededRandom): Array<string> {
  if (random(2) === 0) {
    return [];
  }

  const chosen: Array<string> = [pick(items, random)];

  if (random(2) === 0) {
    const second: string = pick(items, random);

    if (!chosen.includes(second)) {
      chosen.push(second);
    }
  }

  return chosen;
}

function generateRule(random: SeededRandom): RuleFacts {
  return {
    severities: someOf(SEVERITIES, random),
    monitors: someOf(MONITORS, random),
    labels: someOf(LABELS, random),
    titlePattern: random(3) === 0 ? pick(PATTERNS, random) : null,
    // A rule with no policy pages nobody, a fifth of the time.
    policies: random(5) === 0 ? [] : [pick(POLICIES, random)],
  };
}

function generateRecord(random: SeededRandom): RecordFacts {
  return {
    severity: pick(SEVERITIES, random),
    monitor: pick(MONITORS, random),
    labels: someOf(LABELS, random),
    title: pick(TITLES, random),
  };
}

// A plain reading of a rule: every filter it sets holds.
function oracleMatches(rule: RuleFacts, record: RecordFacts): boolean {
  if (
    rule.severities.length > 0 &&
    !rule.severities.includes(record.severity)
  ) {
    return false;
  }

  if (rule.monitors.length > 0 && !rule.monitors.includes(record.monitor)) {
    return false;
  }

  if (
    rule.labels.length > 0 &&
    !rule.labels.some((label: string): boolean => {
      return record.labels.includes(label);
    })
  ) {
    return false;
  }

  if (rule.titlePattern && !new RegExp(rule.titlePattern).test(record.title)) {
    return false;
  }

  return true;
}

function oraclePolicies(
  rules: Array<RuleFacts>,
  record: RecordFacts,
): Array<string> {
  const ids: Array<string> = [];

  for (const rule of rules) {
    if (rule.policies.length === 0 || !oracleMatches(rule, record)) {
      continue;
    }

    for (const id of rule.policies) {
      if (!ids.includes(id)) {
        ids.push(id);
      }
    }
  }

  return ids.sort();
}

function withId<T extends { _id?: string | undefined }>(
  item: T,
  id: string,
): T {
  item._id = id;
  return item;
}

function policiesOf(ids: Array<string>): Array<OnCallDutyPolicy> {
  return ids.map((id: string): OnCallDutyPolicy => {
    return withId(new OnCallDutyPolicy(), id);
  });
}

function labelsOf(ids: Array<string>): Array<Label> {
  return ids.map((id: string): Label => {
    return withId(new Label(), id);
  });
}

function monitorsOf(ids: Array<string>): Array<Monitor> {
  return ids.map((id: string): Monitor => {
    return withId(new Monitor(), id);
  });
}

function toIncidentRule(facts: RuleFacts, index: number): IncidentOnCallRule {
  const rule: IncidentOnCallRule = new IncidentOnCallRule();
  rule.id = ObjectID.generate();
  rule.name = `Rule ${index}`;
  rule.incidentSeverities = facts.severities.map(
    (id: string): IncidentSeverity => {
      return withId(new IncidentSeverity(), id);
    },
  );
  rule.monitors = monitorsOf(facts.monitors);
  rule.incidentLabels = labelsOf(facts.labels);
  rule.monitorLabels = [];

  if (facts.titlePattern) {
    rule.incidentTitlePattern = facts.titlePattern;
  }

  rule.onCallDutyPolicies = policiesOf(facts.policies);
  return rule;
}

function toAlertRule(facts: RuleFacts, index: number): AlertOnCallRule {
  const rule: AlertOnCallRule = new AlertOnCallRule();
  rule.id = ObjectID.generate();
  rule.name = `Rule ${index}`;
  rule.alertSeverities = facts.severities.map((id: string): AlertSeverity => {
    return withId(new AlertSeverity(), id);
  });
  rule.monitors = monitorsOf(facts.monitors);
  rule.alertLabels = labelsOf(facts.labels);
  rule.monitorLabels = [];

  if (facts.titlePattern) {
    rule.alertTitlePattern = facts.titlePattern;
  }

  rule.onCallDutyPolicies = policiesOf(facts.policies);
  return rule;
}

// The record as a monitor's criteria would open it, held in memory.
function toIncident(facts: RecordFacts, withRecordId: boolean): Incident {
  const incident: Incident = new Incident();

  if (withRecordId) {
    incident.id = ObjectID.generate();
  }

  incident.projectId = PROJECT_ID;
  incident.incidentSeverityId = new ObjectID(facts.severity);
  incident.monitors = monitorsOf([facts.monitor]);
  incident.labels = labelsOf(facts.labels);
  incident.title = facts.title;
  incident.description = "";
  incident.onCallDutyPolicies = [];
  return incident;
}

function toAlert(facts: RecordFacts, withRecordId: boolean): Alert {
  const alert: Alert = new Alert();

  if (withRecordId) {
    alert.id = ObjectID.generate();
  }

  alert.projectId = PROJECT_ID;
  alert.alertSeverityId = new ObjectID(facts.severity);
  alert.monitorId = new ObjectID(facts.monitor);
  alert.labels = labelsOf(facts.labels);
  alert.title = facts.title;
  alert.description = "";
  alert.onCallDutyPolicies = [];
  return alert;
}

interface EngineCase {
  label: string;
  stubRules: (rules: Array<RuleFacts>) => void;
  // The policies of the rules the resolver's matching returns.
  resolverPolicies: (record: RecordFacts) => Promise<Array<string>>;
  // How many rules the resolver's matching returns.
  resolverRuleCount: (record: RecordFacts) => Promise<number>;
  /*
   * The policies of the rules the matching returns from rules read once
   * and monitors already read (Setup health, #6812: getMatchingRules'
   * `preloaded`).
   */
  preloadedPolicies: (
    record: RecordFacts,
    monitorCache: MonitorRuleCriteriaCache,
  ) => Promise<Array<string>>;
  // A rule that pages the first policy for monitors whose name matches.
  stubMonitorNameRule: (pattern: string) => void;
  // How many times the engine's rules were read from its rule service.
  ruleReads: () => number;
  // The policies the engine pages.
  enginePolicies: (record: RecordFacts) => Promise<Array<string>>;
  stubAttach: (attached: Array<string>) => void;
  stubFeed: () => void;
}

function policyIdsOfRules(
  rules: Array<IncidentOnCallRule | AlertOnCallRule>,
): Array<string> {
  const ids: Array<string> = [];

  for (const rule of rules) {
    for (const policy of rule.onCallDutyPolicies || []) {
      const id: string = policy.id?.toString() || "";

      if (id && !ids.includes(id)) {
        ids.push(id);
      }
    }
  }

  return ids.sort();
}

function pagedIds(paging: OnCallRulesPaging): Array<string> {
  return Array.from(
    new Set<string>([...paging.addedPolicyIds, ...paging.observerPolicyIds]),
  ).sort();
}

function attachStub(attached: Array<string>): unknown {
  return {
    createQueryBuilder: () => {
      return {
        relation: () => {
          return {
            of: () => {
              return {
                // One id at a time (incidents) or all at once (alerts).
                add: async (ids: unknown): Promise<void> => {
                  attached.push(
                    ...(Array.isArray(ids) ? ids : [ids]).map(
                      (id: unknown): string => {
                        return String(id);
                      },
                    ),
                  );
                },
              };
            },
          };
        },
      };
    },
  };
}

const ENGINES: Array<EngineCase> = [
  {
    label: "incident on-call rules",
    stubRules: (rules: Array<RuleFacts>): void => {
      jest
        .spyOn(IncidentOnCallRuleService, "findBy")
        .mockResolvedValue(rules.map(toIncidentRule) as never);
    },
    resolverPolicies: async (record: RecordFacts): Promise<Array<string>> => {
      return policyIdsOfRules(
        await IncidentOnCallRuleEngineService.getMatchingRules(
          toIncident(record, false),
        ),
      );
    },
    resolverRuleCount: async (record: RecordFacts): Promise<number> => {
      return (
        await IncidentOnCallRuleEngineService.getMatchingRules(
          toIncident(record, false),
        )
      ).length;
    },
    enginePolicies: async (record: RecordFacts): Promise<Array<string>> => {
      return pagedIds(
        await IncidentOnCallRuleEngineService.applyRulesToIncident(
          toIncident(record, true),
        ),
      );
    },
    preloadedPolicies: async (
      record: RecordFacts,
      monitorCache: MonitorRuleCriteriaCache,
    ): Promise<Array<string>> => {
      return policyIdsOfRules(
        await IncidentOnCallRuleEngineService.getMatchingRules(
          toIncident(record, false),
          {
            rules:
              await IncidentOnCallRuleEngineService.readEnabledRules(
                PROJECT_ID,
              ),
            monitorCache: monitorCache,
          },
        ),
      );
    },
    stubMonitorNameRule: (pattern: string): void => {
      const rule: IncidentOnCallRule = new IncidentOnCallRule();
      rule.id = ObjectID.generate();
      rule.name = "By monitor name";
      rule.monitorNamePattern = pattern;
      rule.onCallDutyPolicies = policiesOf([POLICIES[0]!]);

      jest
        .spyOn(IncidentOnCallRuleService, "findBy")
        .mockResolvedValue([rule] as never);
    },
    ruleReads: (): number => {
      return jest.mocked(IncidentOnCallRuleService.findBy).mock.calls.length;
    },
    stubAttach: (attached: Array<string>): void => {
      jest
        .spyOn(IncidentService, "getRepository")
        .mockReturnValue(attachStub(attached) as never);
    },
    stubFeed: (): void => {
      jest
        .spyOn(IncidentFeedService, "createIncidentFeedItem")
        .mockResolvedValue(undefined as never);
    },
  },
  {
    label: "alert on-call rules",
    stubRules: (rules: Array<RuleFacts>): void => {
      jest
        .spyOn(AlertOnCallRuleService, "findBy")
        .mockResolvedValue(rules.map(toAlertRule) as never);
    },
    resolverPolicies: async (record: RecordFacts): Promise<Array<string>> => {
      return policyIdsOfRules(
        await AlertOnCallRuleEngineService.getMatchingRules(
          toAlert(record, false),
        ),
      );
    },
    resolverRuleCount: async (record: RecordFacts): Promise<number> => {
      return (
        await AlertOnCallRuleEngineService.getMatchingRules(
          toAlert(record, false),
        )
      ).length;
    },
    enginePolicies: async (record: RecordFacts): Promise<Array<string>> => {
      return pagedIds(
        await AlertOnCallRuleEngineService.applyRulesToAlert(
          toAlert(record, true),
        ),
      );
    },
    preloadedPolicies: async (
      record: RecordFacts,
      monitorCache: MonitorRuleCriteriaCache,
    ): Promise<Array<string>> => {
      return policyIdsOfRules(
        await AlertOnCallRuleEngineService.getMatchingRules(
          toAlert(record, false),
          {
            rules:
              await AlertOnCallRuleEngineService.readEnabledRules(PROJECT_ID),
            monitorCache: monitorCache,
          },
        ),
      );
    },
    stubMonitorNameRule: (pattern: string): void => {
      const rule: AlertOnCallRule = new AlertOnCallRule();
      rule.id = ObjectID.generate();
      rule.name = "By monitor name";
      rule.monitorNamePattern = pattern;
      rule.onCallDutyPolicies = policiesOf([POLICIES[0]!]);

      jest
        .spyOn(AlertOnCallRuleService, "findBy")
        .mockResolvedValue([rule] as never);
    },
    ruleReads: (): number => {
      return jest.mocked(AlertOnCallRuleService.findBy).mock.calls.length;
    },
    stubAttach: (attached: Array<string>): void => {
      jest
        .spyOn(AlertService, "getRepository")
        .mockReturnValue(attachStub(attached) as never);
    },
    stubFeed: (): void => {
      jest
        .spyOn(AlertFeedService, "createAlertFeedItem")
        .mockResolvedValue(undefined as never);
    },
  },
];

describe.each(ENGINES)("$label", (engine: EngineCase) => {
  let attached: Array<string> = [];

  beforeEach(() => {
    attached = [];
    stubProjectDirectory({
      projectId: PROJECT_ID,
      records: { OnCallDutyPolicy: POLICIES },
    });
    engine.stubAttach(attached);
    engine.stubFeed();
    jest
      .spyOn(OnCallDutyPolicyService, "findBy")
      .mockResolvedValue(policiesOf(POLICIES) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the resolver's matching, the engine's paging and a plain reading of the rules agree on generated cases", async () => {
    const random: SeededRandom = seededRandom(6810);
    let matchedSomething: number = 0;
    let matchedNothing: number = 0;

    for (let index: number = 0; index < CASES; index++) {
      const rules: Array<RuleFacts> = [];
      const ruleCount: number = 1 + random(4);

      for (let ruleIndex: number = 0; ruleIndex < ruleCount; ruleIndex++) {
        rules.push(generateRule(random));
      }

      const record: RecordFacts = generateRecord(random);
      const expected: Array<string> = oraclePolicies(rules, record);

      engine.stubRules(rules);

      const shown: Array<string> = await engine.resolverPolicies(record);

      const preloaded: Array<string> = await engine.preloadedPolicies(
        record,
        new MonitorRuleCriteriaCache(),
      );

      attached.length = 0;
      const paged: Array<string> = await engine.enginePolicies(record);

      const context: string = JSON.stringify({ case: index, rules, record });

      expect({ context, shown }).toEqual({ context, shown: expected });
      expect({ context, preloaded }).toEqual({ context, preloaded: expected });
      expect({ context, paged }).toEqual({ context, paged: expected });
      expect({ context, attached: [...attached].sort() }).toEqual({
        context,
        attached: expected,
      });

      if (expected.length > 0) {
        matchedSomething++;
      } else {
        matchedNothing++;
      }
    }

    // The generator draws both kinds of case, so the agreement means something.
    expect(matchedSomething).toBeGreaterThan(CASES / 5);
    expect(matchedNothing).toBeGreaterThan(CASES / 5);
  });

  test("a rule that pages no policy is never shown, though it matches", async () => {
    engine.stubRules([
      {
        severities: [],
        monitors: [],
        labels: [],
        titlePattern: null,
        policies: [],
      },
    ]);

    const record: RecordFacts = {
      severity: SEVERITIES[0]!,
      monitor: MONITORS[0]!,
      labels: [],
      title: TITLES[0]!,
    };

    expect(await engine.resolverPolicies(record)).toEqual([]);
    // Not listed either: "When this goes down" shows only rules that page.
    expect(await engine.resolverRuleCount(record)).toBe(0);
  });

  test("the resolver's matching changes nothing: no policy is attached and no feed is written", async () => {
    engine.stubRules([
      {
        severities: [],
        monitors: [],
        labels: [],
        titlePattern: null,
        policies: [POLICIES[0]!],
      },
    ]);

    const shown: Array<string> = await engine.resolverPolicies({
      severity: SEVERITIES[0]!,
      monitor: MONITORS[0]!,
      labels: [],
      title: TITLES[0]!,
    });

    expect(shown).toEqual([POLICIES[0]]);
    expect(attached).toEqual([]);
  });

  test("a record with no project matches no rule and reads none", async () => {
    engine.stubRules([
      {
        severities: [],
        monitors: [],
        labels: [],
        titlePattern: null,
        policies: [POLICIES[0]!],
      },
    ]);

    const incident: Incident = new Incident();
    const alert: Alert = new Alert();

    expect(
      await IncidentOnCallRuleEngineService.getMatchingRules(incident),
    ).toEqual([]);
    expect(await AlertOnCallRuleEngineService.getMatchingRules(alert)).toEqual(
      [],
    );
  });

  test("matched from rules read once and monitors already read, a rule on the monitor's name reads no monitor", async () => {
    engine.stubMonitorNameRule("^Checkout");

    const read: SpyInstance<typeof MonitorService.findOneById> = jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue(null as never);

    const record: RecordFacts = {
      severity: SEVERITIES[0]!,
      monitor: MONITORS[0]!,
      labels: [],
      title: TITLES[0]!,
    };

    const named: (name: string) => MonitorRuleCriteriaCache = (
      name: string,
    ): MonitorRuleCriteriaCache => {
      const monitor: Monitor = withId(new Monitor(), MONITORS[0]!);
      monitor.name = name;
      monitor.labels = [];

      const cache: MonitorRuleCriteriaCache = new MonitorRuleCriteriaCache();
      cache.seed(monitor);
      return cache;
    };

    expect(
      await engine.preloadedPolicies(record, named("Checkout API")),
    ).toEqual([POLICIES[0]]);
    expect(await engine.preloadedPolicies(record, named("Search"))).toEqual([]);
    expect(read).not.toHaveBeenCalled();
    // Each read is readEnabledRules', before its matching: the matching reads none.
    expect(engine.ruleReads()).toBe(2);
  });
});
