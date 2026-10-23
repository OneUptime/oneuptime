import InvestigationRules, {
  InvestigationRuleScope,
} from "../../../../Server/Utils/AI/SRE/InvestigationRules";
import AutoRemediationRuleService from "../../../../Server/Services/AutoRemediationRuleService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentService from "../../../../Server/Services/IncidentService";
import logger from "../../../../Server/Utils/Logger";
import IncidentAlertRuleMatcher from "../../../../Server/Utils/Rules/IncidentAlertRuleMatcher";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AutoRemediationTriggerEntity from "../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import ObjectID from "../../../../Types/ObjectID";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../Utils/Rules/RuleEngineLimits";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Which new incidents (or alerts) OneUptime AI investigates on its own, once
 * "Investigate new incidents" is on: the project's AI rules that
 * investigate (investigation rules and auto remediation rules are one AI
 * rule now). No enabled rule that investigates: every one is in scope.
 * Enabled rules that investigate: only those that match at least one are.
 * A rule that only fixes is never read here. Investigating only reads, so
 * rules that cannot be read leave the signal in scope.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_A: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
);
const MONITOR_B: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
);
const SEVERITY_HIGH: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
);
const SEVERITY_LOW: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
);

function ref<T extends { _id?: string | undefined }>(
  type: { new (): T },
  id: ObjectID,
): T {
  const model: T = new type();
  model._id = id.toString();
  return model;
}

function rule(values: Partial<AutoRemediationRule>): AutoRemediationRule {
  return Object.assign(new AutoRemediationRule(), {
    _id: ObjectID.generate().toString(),
    name: "Production",
    ...values,
  });
}

function incident(): Incident {
  return Object.assign(new Incident(), {
    title: "Checkout is down",
    incidentSeverityId: SEVERITY_HIGH,
    monitors: [ref(Monitor, MONITOR_A)],
    labels: [],
  });
}

function alert(): Alert {
  return Object.assign(new Alert(), {
    title: "Checkout is down",
    alertSeverityId: SEVERITY_LOW,
    monitorId: MONITOR_A,
    labels: [],
  });
}

function mockRules(
  rules: Array<AutoRemediationRule> | Error,
): SpyInstance<typeof AutoRemediationRuleService.findBy> {
  return jest
    .spyOn(AutoRemediationRuleService, "findBy")
    .mockImplementation(async () => {
      if (rules instanceof Error) {
        throw rules;
      }

      return rules;
    });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("InvestigationRules.getIncidentScope", () => {
  test("with no enabled rule, every incident is in scope", async () => {
    mockRules([]);

    expect(
      await InvestigationRules.getIncidentScope({
        projectId: PROJECT_ID,
        incident: incident(),
      }),
    ).toEqual({ isInScope: true, rulesChecked: 0 });
  });

  test("reads only the project's enabled incident rules that investigate, with what they match on, as root", async () => {
    const findBy: SpyInstance<typeof AutoRemediationRuleService.findBy> =
      mockRules([]);

    await InvestigationRules.getIncidentScope({
      projectId: PROJECT_ID,
      incident: incident(),
    });

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: {
        projectId: PROJECT_ID,
        isEnabled: true,
        triggerEntityType: AutoRemediationTriggerEntity.Incident,
        // A rule that only fixes never decides which incidents are investigated.
        investigates: true,
      },
      select: {
        criteria: true,
        titlePattern: true,
        descriptionPattern: true,
        monitors: { _id: true },
        incidentSeverities: { _id: true },
        alertSeverities: { _id: true },
        labels: { _id: true },
        monitorLabels: { _id: true },
      },
      limit: MAX_RULES_EVALUATED_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });
  });

  test("an incident that matches one rule is in scope, and says how many were checked", async () => {
    mockRules([
      rule({ monitors: [ref(Monitor, MONITOR_B)] }),
      rule({ monitors: [ref(Monitor, MONITOR_A)] }),
    ]);

    const scope: InvestigationRuleScope =
      await InvestigationRules.getIncidentScope({
        projectId: PROJECT_ID,
        incident: incident(),
      });

    expect(scope).toEqual({ isInScope: true, rulesChecked: 2 });
  });

  test("an incident that matches none is out of scope", async () => {
    mockRules([
      rule({ monitors: [ref(Monitor, MONITOR_B)] }),
      rule({
        incidentSeverities: [ref(IncidentSeverity, SEVERITY_LOW)],
      }),
      rule({ titlePattern: "^payments" }),
    ]);

    expect(
      await InvestigationRules.getIncidentScope({
        projectId: PROJECT_ID,
        incident: incident(),
      }),
    ).toEqual({ isInScope: false, rulesChecked: 3 });
  });

  test("a rule with no condition matches every incident", async () => {
    mockRules([rule({})]);

    expect(
      (
        await InvestigationRules.getIncidentScope({
          projectId: PROJECT_ID,
          incident: incident(),
        })
      ).isInScope,
    ).toBe(true);
  });

  test("rules that cannot be read leave the incident in scope, and say so in the log", async () => {
    mockRules(new Error("database is down"));
    const error: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    expect(
      await InvestigationRules.getIncidentScope({
        projectId: PROJECT_ID,
        incident: incident(),
      }),
    ).toEqual({ isInScope: true, rulesChecked: 0 });
    expect(String(error.mock.calls[0]![0])).toContain(
      "could not read the AI rules that investigate",
    );
  });
});

describe("InvestigationRules.getAlertScope", () => {
  test("reads the alert rules that investigate, not the incident ones", async () => {
    const findBy: SpyInstance<typeof AutoRemediationRuleService.findBy> =
      mockRules([]);

    expect(
      await InvestigationRules.getAlertScope({
        projectId: PROJECT_ID,
        alert: alert(),
      }),
    ).toEqual({ isInScope: true, rulesChecked: 0 });
    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: {
        projectId: PROJECT_ID,
        isEnabled: true,
        triggerEntityType: AutoRemediationTriggerEntity.Alert,
        investigates: true,
      },
    });
  });

  test("an alert is matched on its own severity and monitor", async () => {
    mockRules([rule({ alertSeverities: [ref(AlertSeverity, SEVERITY_LOW)] })]);

    expect(
      await InvestigationRules.getAlertScope({
        projectId: PROJECT_ID,
        alert: alert(),
      }),
    ).toEqual({ isInScope: true, rulesChecked: 1 });

    jest.restoreAllMocks();
    mockRules([
      rule({ alertSeverities: [ref(AlertSeverity, SEVERITY_HIGH)] }),
      rule({ monitors: [ref(Monitor, MONITOR_B)] }),
    ]);

    expect(
      await InvestigationRules.getAlertScope({
        projectId: PROJECT_ID,
        alert: alert(),
      }),
    ).toEqual({ isInScope: false, rulesChecked: 2 });
  });

  test("rules that cannot be read leave the alert in scope", async () => {
    mockRules(new Error("database is down"));
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    expect(
      (
        await InvestigationRules.getAlertScope({
          projectId: PROJECT_ID,
          alert: alert(),
        })
      ).isInScope,
    ).toBe(true);
  });
});

/*
 * A rule may make OneUptime AI wait (issue #5074): "only if the incident is
 * still open after N minutes" (onlyIfOpenAfterMinutes). Rules widen what is
 * investigated, so the rule that lets OneUptime AI start soonest decides:
 * the shortest wait of the rules a signal matches, and none when one of
 * them has none. Nothing waits unless a rule says so.
 */
describe("InvestigationRules - a rule's wait", () => {
  test("reads each rule's wait with its conditions", async () => {
    const findBy: SpyInstance<typeof AutoRemediationRuleService.findBy> =
      mockRules([]);

    await InvestigationRules.getIncidentScope({
      projectId: PROJECT_ID,
      incident: incident(),
    });

    expect(findBy.mock.calls[0]![0]).toMatchObject({
      select: { onlyIfOpenAfterMinutes: true },
    });
  });

  test("with no rule there is no wait", async () => {
    mockRules([]);

    const scope: InvestigationRuleScope =
      await InvestigationRules.getIncidentScope({
        projectId: PROJECT_ID,
        incident: incident(),
      });

    expect(scope.waitMinutes).toBeUndefined();
  });

  test("a matching rule with no wait investigates right away, as every rule did before", async () => {
    mockRules([rule({ monitors: [ref(Monitor, MONITOR_A)] })]);

    expect(
      await InvestigationRules.getIncidentScope({
        projectId: PROJECT_ID,
        incident: incident(),
      }),
    ).toEqual({ isInScope: true, rulesChecked: 1 });
  });

  test("a matching rule that waits makes the incident wait", async () => {
    mockRules([
      rule({ monitors: [ref(Monitor, MONITOR_A)], onlyIfOpenAfterMinutes: 10 }),
    ]);

    expect(
      await InvestigationRules.getIncidentScope({
        projectId: PROJECT_ID,
        incident: incident(),
      }),
    ).toEqual({ isInScope: true, rulesChecked: 1, waitMinutes: 10 });
  });

  test("of several matching rules that wait, the shortest wait decides", async () => {
    mockRules([
      rule({ onlyIfOpenAfterMinutes: 30 }),
      rule({ onlyIfOpenAfterMinutes: 10 }),
      rule({ onlyIfOpenAfterMinutes: 60 }),
    ]);

    expect(
      await InvestigationRules.getIncidentScope({
        projectId: PROJECT_ID,
        incident: incident(),
      }),
    ).toEqual({ isInScope: true, rulesChecked: 3, waitMinutes: 10 });
  });

  test("one matching rule with no wait means no wait, wherever it is in the list", async () => {
    for (const waits of [
      [30, 0],
      [0, 30],
      [30, null],
      [10, undefined, 60],
    ]) {
      jest.restoreAllMocks();
      mockRules(
        waits.map((wait: number | null | undefined) => {
          return rule({
            ...(wait === undefined ? {} : { onlyIfOpenAfterMinutes: wait! }),
          });
        }),
      );

      const scope: InvestigationRuleScope =
        await InvestigationRules.getIncidentScope({
          projectId: PROJECT_ID,
          incident: incident(),
        });

      expect(scope.isInScope).toBe(true);
      expect(scope.waitMinutes).toBeUndefined();
    }
  });

  test("a rule the incident does not match lends it no wait, short or none", async () => {
    mockRules([
      // Not matched: another monitor, and no wait.
      rule({ monitors: [ref(Monitor, MONITOR_B)] }),
      // Not matched: another monitor, and a short wait.
      rule({ monitors: [ref(Monitor, MONITOR_B)], onlyIfOpenAfterMinutes: 5 }),
      // Matched: waits 30 minutes.
      rule({ monitors: [ref(Monitor, MONITOR_A)], onlyIfOpenAfterMinutes: 30 }),
    ]);

    expect(
      await InvestigationRules.getIncidentScope({
        projectId: PROJECT_ID,
        incident: incident(),
      }),
    ).toEqual({ isInScope: true, rulesChecked: 3, waitMinutes: 30 });
  });

  test("an incident no rule matches is out of scope, whatever the rules' waits", async () => {
    mockRules([
      rule({ monitors: [ref(Monitor, MONITOR_B)], onlyIfOpenAfterMinutes: 10 }),
      rule({ titlePattern: "^payments", onlyIfOpenAfterMinutes: 30 }),
    ]);

    expect(
      await InvestigationRules.getIncidentScope({
        projectId: PROJECT_ID,
        incident: incident(),
      }),
    ).toEqual({ isInScope: false, rulesChecked: 2 });
  });

  test("the severity decides which rule's wait applies (Critical waits 10, Major 30)", async () => {
    const rules: Array<AutoRemediationRule> = [
      rule({
        name: "Critical",
        incidentSeverities: [ref(IncidentSeverity, SEVERITY_HIGH)],
        onlyIfOpenAfterMinutes: 10,
      }),
      rule({
        name: "Major",
        incidentSeverities: [ref(IncidentSeverity, SEVERITY_LOW)],
        onlyIfOpenAfterMinutes: 30,
      }),
    ];

    mockRules(rules);
    expect(
      (
        await InvestigationRules.getIncidentScope({
          projectId: PROJECT_ID,
          incident: incident(),
        })
      ).waitMinutes,
    ).toBe(10);

    jest.restoreAllMocks();
    mockRules(rules);
    expect(
      (
        await InvestigationRules.getIncidentScope({
          projectId: PROJECT_ID,
          incident: Object.assign(incident(), {
            incidentSeverityId: SEVERITY_LOW,
          }),
        })
      ).waitMinutes,
    ).toBe(30);
  });

  test("a rule that cannot shorten the wait found so far is not matched at all", async () => {
    const matcher: SpyInstance<
      typeof IncidentAlertRuleMatcher.doesIncidentMatch
    > = jest.spyOn(IncidentAlertRuleMatcher, "doesIncidentMatch");

    mockRules([
      rule({ name: "ten", onlyIfOpenAfterMinutes: 10 }),
      rule({ name: "thirty", onlyIfOpenAfterMinutes: 30 }),
      rule({ name: "ten again", onlyIfOpenAfterMinutes: 10 }),
      rule({ name: "five", onlyIfOpenAfterMinutes: 5 }),
    ]);

    expect(
      (
        await InvestigationRules.getIncidentScope({
          projectId: PROJECT_ID,
          incident: incident(),
        })
      ).waitMinutes,
    ).toBe(5);
    expect(
      matcher.mock.calls.map(
        (
          call: Parameters<typeof IncidentAlertRuleMatcher.doesIncidentMatch>,
        ) => {
          return (call[1] as AutoRemediationRule).name;
        },
      ),
    ).toEqual(["ten", "five"]);
  });

  test("the first matching rule with no wait ends the reading, as before rules could wait", async () => {
    const matcher: SpyInstance<
      typeof IncidentAlertRuleMatcher.doesIncidentMatch
    > = jest.spyOn(IncidentAlertRuleMatcher, "doesIncidentMatch");

    mockRules([
      rule({ name: "now" }),
      rule({ name: "later", onlyIfOpenAfterMinutes: 10 }),
    ]);

    await InvestigationRules.getIncidentScope({
      projectId: PROJECT_ID,
      incident: incident(),
    });

    expect(matcher).toHaveBeenCalledTimes(1);
  });

  test("rules that cannot be read leave the incident in scope with no wait", async () => {
    mockRules(new Error("database is down"));
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    expect(
      await InvestigationRules.getIncidentScope({
        projectId: PROJECT_ID,
        incident: incident(),
      }),
    ).toEqual({ isInScope: true, rulesChecked: 0 });
  });

  test("an alert waits by its own rules the same way", async () => {
    mockRules([
      rule({
        alertSeverities: [ref(AlertSeverity, SEVERITY_LOW)],
        onlyIfOpenAfterMinutes: 15,
      }),
      rule({
        alertSeverities: [ref(AlertSeverity, SEVERITY_HIGH)],
        onlyIfOpenAfterMinutes: 5,
      }),
    ]);

    expect(
      await InvestigationRules.getAlertScope({
        projectId: PROJECT_ID,
        alert: alert(),
      }),
    ).toEqual({ isInScope: true, rulesChecked: 2, waitMinutes: 15 });
  });
});

/*
 * A rule may pick the LLM provider OneUptime AI investigates with
 * (Types/AI/LlmProviderChoice): the first matching rule by name that picks
 * one decides, for the run the rules start and for one someone starts by
 * hand. No rule, no matching rule that picks one, or rules that cannot be
 * read: none - the project's default provider, else the global one.
 */
describe("InvestigationRules - the LLM provider a rule picks", () => {
  const OPUS: string = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
  const AZURE: string = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

  test("reads each rule's pick with its conditions", async () => {
    const findBy: SpyInstance<typeof AutoRemediationRuleService.findBy> =
      mockRules([]);

    await InvestigationRules.getIncidentScope({
      projectId: PROJECT_ID,
      incident: incident(),
    });

    expect(findBy.mock.calls[0]![0]).toMatchObject({
      select: { name: true, llmProviderId: true },
    });
  });

  test("a matching rule that picks a provider: the scope says which", async () => {
    mockRules([rule({ llmProviderId: new ObjectID(OPUS) })]);

    expect(
      await InvestigationRules.getIncidentScope({
        projectId: PROJECT_ID,
        incident: incident(),
      }),
    ).toEqual({
      isInScope: true,
      rulesChecked: 1,
      llmProviderId: new ObjectID(OPUS),
    });
  });

  test("no rule picks one: none, as before rules could pick one", async () => {
    mockRules([rule({}), rule({ name: "Another" })]);

    expect(
      await InvestigationRules.getIncidentScope({
        projectId: PROJECT_ID,
        incident: incident(),
      }),
    ).toEqual({ isInScope: true, rulesChecked: 2 });
  });

  test("a rule the incident does not match lends it no provider", async () => {
    mockRules([
      rule({
        name: "Payments",
        monitors: [ref(Monitor, MONITOR_B)],
        llmProviderId: new ObjectID(OPUS),
      }),
      rule({ name: "Everything" }),
    ]);

    const scope: InvestigationRuleScope =
      await InvestigationRules.getIncidentScope({
        projectId: PROJECT_ID,
        incident: incident(),
      });

    expect(scope.isInScope).toBe(true);
    expect(scope.llmProviderId).toBeUndefined();
  });

  test("of several matching rules that pick one, the first by name decides", async () => {
    mockRules([
      rule({ name: "Zeta", llmProviderId: new ObjectID(AZURE) }),
      rule({ name: "alpha", llmProviderId: new ObjectID(OPUS) }),
    ]);

    expect(
      (
        await InvestigationRules.getIncidentScope({
          projectId: PROJECT_ID,
          incident: incident(),
        })
      ).llmProviderId?.toString(),
    ).toBe(OPUS);
  });

  test("a catch-all rule that picks none never hides a matching rule's pick", async () => {
    mockRules([
      rule({ name: "A catch-all" }),
      rule({
        name: "Critical",
        incidentSeverities: [ref(IncidentSeverity, SEVERITY_HIGH)],
        llmProviderId: new ObjectID(OPUS),
      }),
    ]);

    expect(
      (
        await InvestigationRules.getIncidentScope({
          projectId: PROJECT_ID,
          incident: incident(),
        })
      ).llmProviderId?.toString(),
    ).toBe(OPUS);
  });

  test("the wait is decided as before, the provider beside it", async () => {
    mockRules([
      rule({
        name: "Waits",
        onlyIfOpenAfterMinutes: 10,
        llmProviderId: new ObjectID(OPUS),
      }),
    ]);

    expect(
      await InvestigationRules.getIncidentScope({
        projectId: PROJECT_ID,
        incident: incident(),
      }),
    ).toEqual({
      isInScope: true,
      rulesChecked: 1,
      waitMinutes: 10,
      llmProviderId: new ObjectID(OPUS),
    });
  });

  test("out of scope: no provider", async () => {
    mockRules([
      rule({
        monitors: [ref(Monitor, MONITOR_B)],
        llmProviderId: new ObjectID(OPUS),
      }),
    ]);

    expect(
      await InvestigationRules.getIncidentScope({
        projectId: PROJECT_ID,
        incident: incident(),
      }),
    ).toEqual({ isInScope: false, rulesChecked: 1 });
  });

  test("only the rules that pick a provider are matched again for it", async () => {
    const matcher: SpyInstance<
      typeof IncidentAlertRuleMatcher.doesIncidentMatch
    > = jest.spyOn(IncidentAlertRuleMatcher, "doesIncidentMatch");

    mockRules([
      rule({ name: "now" }),
      rule({ name: "later", onlyIfOpenAfterMinutes: 10 }),
      rule({ name: "picks", llmProviderId: new ObjectID(OPUS) }),
    ]);

    await InvestigationRules.getIncidentScope({
      projectId: PROJECT_ID,
      incident: incident(),
    });

    expect(
      matcher.mock.calls.map(
        (
          call: Parameters<typeof IncidentAlertRuleMatcher.doesIncidentMatch>,
        ) => {
          return (call[1] as AutoRemediationRule).name;
        },
      ),
    ).toEqual(["now", "picks"]);
  });

  test("an alert's rules decide its provider the same way", async () => {
    mockRules([
      rule({
        alertSeverities: [ref(AlertSeverity, SEVERITY_LOW)],
        llmProviderId: new ObjectID(AZURE),
      }),
    ]);

    expect(
      (
        await InvestigationRules.getAlertScope({
          projectId: PROJECT_ID,
          alert: alert(),
        })
      ).llmProviderId?.toString(),
    ).toBe(AZURE);
  });

  test("getIncidentLlmProviderId: what the rules pick for an incident, whatever their waits", async () => {
    mockRules([
      rule({
        name: "Waits",
        onlyIfOpenAfterMinutes: 120,
        llmProviderId: new ObjectID(OPUS),
      }),
    ]);

    expect(
      (
        await InvestigationRules.getIncidentLlmProviderId({
          projectId: PROJECT_ID,
          incident: incident(),
        })
      )?.toString(),
    ).toBe(OPUS);
  });

  test("rules that cannot be read pick no provider", async () => {
    mockRules(new Error("database is down"));
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    expect(
      await InvestigationRules.getIncidentLlmProviderId({
        projectId: PROJECT_ID,
        incident: incident(),
      }),
    ).toBeUndefined();
    expect(
      await InvestigationRules.getAlertLlmProviderId({
        projectId: PROJECT_ID,
        alert: alert(),
      }),
    ).toBeUndefined();
  });

  test("getSubjectLlmProviderId reads the incident with what a rule matches on, in its project", async () => {
    mockRules([rule({ llmProviderId: new ObjectID(OPUS) })]);
    const findIncident: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(incident());
    const incidentId: ObjectID = ObjectID.generate();

    expect(
      (
        await InvestigationRules.getSubjectLlmProviderId({
          projectId: PROJECT_ID,
          incidentId,
        })
      )?.toString(),
    ).toBe(OPUS);
    expect(findIncident.mock.calls[0]![0]).toMatchObject({
      query: { _id: incidentId.toString(), projectId: PROJECT_ID },
      select: {
        title: true,
        description: true,
        incidentSeverityId: true,
        labels: { _id: true },
        monitors: { _id: true },
      },
      props: { isRoot: true },
    });
  });

  test("getSubjectLlmProviderId reads an alert the same way", async () => {
    mockRules([rule({ llmProviderId: new ObjectID(AZURE) })]);
    const findAlert: SpyInstance<typeof AlertService.findOneBy> = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(alert());

    expect(
      (
        await InvestigationRules.getSubjectLlmProviderId({
          projectId: PROJECT_ID,
          alertId: ObjectID.generate(),
        })
      )?.toString(),
    ).toBe(AZURE);
    expect(findAlert.mock.calls[0]![0]).toMatchObject({
      select: { alertSeverityId: true, monitorId: true },
    });
  });

  test("getSubjectLlmProviderId: a subject that is gone, or cannot be read, picks none", async () => {
    mockRules([rule({ llmProviderId: new ObjectID(OPUS) })]);
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(null);

    expect(
      await InvestigationRules.getSubjectLlmProviderId({
        projectId: PROJECT_ID,
        incidentId: ObjectID.generate(),
      }),
    ).toBeUndefined();

    jest
      .spyOn(IncidentService, "findOneBy")
      .mockRejectedValue(new Error("database is down"));

    expect(
      await InvestigationRules.getSubjectLlmProviderId({
        projectId: PROJECT_ID,
        incidentId: ObjectID.generate(),
      }),
    ).toBeUndefined();
    expect(
      await InvestigationRules.getSubjectLlmProviderId({
        projectId: PROJECT_ID,
      }),
    ).toBeUndefined();
  });
});
