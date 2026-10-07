import InvestigationRules, {
  InvestigationRuleScope,
} from "../../../../Server/Utils/AI/SRE/InvestigationRules";
import AIInvestigationRuleService from "../../../../Server/Services/AIInvestigationRuleService";
import logger from "../../../../Server/Utils/Logger";
import AIInvestigationRule from "../../../../Models/DatabaseModels/AIInvestigationRule";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AIInvestigationRuleTriggerEntity from "../../../../Types/AI/AIInvestigationRuleTriggerEntity";
import ObjectID from "../../../../Types/ObjectID";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../Utils/Rules/RuleEngineLimits";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Investigation rules: which new incidents (or alerts) OneUptime AI
 * investigates on its own, once "Investigate new incidents" is on. No
 * enabled rule: every one is in scope. Enabled rules: only those that match
 * at least one are. Investigating only reads, so rules that cannot be read
 * leave the signal in scope.
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

function rule(values: Partial<AIInvestigationRule>): AIInvestigationRule {
  return Object.assign(new AIInvestigationRule(), {
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
  rules: Array<AIInvestigationRule> | Error,
): SpyInstance<typeof AIInvestigationRuleService.findBy> {
  return jest
    .spyOn(AIInvestigationRuleService, "findBy")
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

  test("reads only the project's enabled incident rules, with what they match on, as root", async () => {
    const findBy: SpyInstance<typeof AIInvestigationRuleService.findBy> =
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
        triggerEntityType: AIInvestigationRuleTriggerEntity.Incident,
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
      "could not read the investigation rules",
    );
  });
});

describe("InvestigationRules.getAlertScope", () => {
  test("reads the alert rules, not the incident ones", async () => {
    const findBy: SpyInstance<typeof AIInvestigationRuleService.findBy> =
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
        triggerEntityType: AIInvestigationRuleTriggerEntity.Alert,
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
