import AiContextReader from "../../../../../Server/Utils/AI/AiContext/AiContextReader";
import InvestigationRules from "../../../../../Server/Utils/AI/SRE/InvestigationRules";
import AlertService from "../../../../../Server/Services/AlertService";
import AutoRemediationRuleService from "../../../../../Server/Services/AutoRemediationRuleService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import QueryHelper from "../../../../../Server/Types/Database/QueryHelper";
import logger from "../../../../../Server/Utils/Logger";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import AutoRemediationRule from "../../../../../Models/DatabaseModels/AutoRemediationRule";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Project from "../../../../../Models/DatabaseModels/Project";
import {
  AiContextActivity,
  AiContextRule,
  AiContextSource,
} from "../../../../../Types/AI/AiContext";
import AutoRemediationTriggerEntity from "../../../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import ObjectID from "../../../../../Types/ObjectID";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../../Utils/Rules/RuleEngineLimits";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHAT A RUN READS OF ITS PROJECT'S AI CONTEXT (AiContextReader): its own
 * project's - read by that project's id and nothing else, so one project's
 * notes never reach another's prompts - and the notes of the AI rules that
 * started it: the rules that investigate an incident and match it, or the
 * rule a fix works for. Notes only add to what a run knows, so every read
 * fails open.
 */

const PROJECT_A: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_B: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ALERT_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const RULE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const MONITOR_CHECKOUT: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
);
const MONITOR_PAYMENTS: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
);

const NOTES_A: string = "## Project A\n- checkout-api depends on payments-db.";
const NOTES_B: string = "## Project B\n- nothing of A's may leak here.";

function monitor(id: ObjectID): Monitor {
  const model: Monitor = new Monitor();
  model._id = id.toString();
  return model;
}

function rule(values: Partial<AutoRemediationRule>): AutoRemediationRule {
  return Object.assign(new AutoRemediationRule(), {
    _id: ObjectID.generate().toString(),
    name: "Checkout",
    ...values,
  });
}

function incident(monitorId: ObjectID): Incident {
  return Object.assign(new Incident(), {
    _id: INCIDENT_ID.toString(),
    title: "Checkout is down",
    monitors: [monitor(monitorId)],
    labels: [],
  });
}

// ProjectService.findOneById answering each project's own notes, by id.
function mockProjects(): SpyInstance<typeof ProjectService.findOneById> {
  return jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation(async (data: { id: ObjectID }) => {
      const project: Project = new Project(data.id);

      if (data.id.toString() === PROJECT_A.toString()) {
        project.aiContext = NOTES_A;
      }

      if (data.id.toString() === PROJECT_B.toString()) {
        project.aiContext = NOTES_B;
      }

      return project;
    });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AiContextReader.readProjectContext", () => {
  test("reads the run's own project, by its id, for the one column, as root", async () => {
    const findOneById: SpyInstance<typeof ProjectService.findOneById> =
      mockProjects();

    expect(await AiContextReader.readProjectContext(PROJECT_A)).toBe(NOTES_A);
    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findOneById).toHaveBeenCalledWith({
      id: PROJECT_A,
      select: { aiContext: true },
      props: { isRoot: true },
    });
  });

  test("each project reads its own notes and never another's", async () => {
    mockProjects();

    const a: string = await AiContextReader.readProjectContext(PROJECT_A);
    const b: string = await AiContextReader.readProjectContext(PROJECT_B);

    expect(a).toBe(NOTES_A);
    expect(b).toBe(NOTES_B);
    expect(b).not.toContain("Project A");
    expect(a).not.toContain("Project B");
  });

  test("a project with none, or that cannot be found, reads as none", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValueOnce(new Project(PROJECT_A))
      .mockResolvedValueOnce(null);

    expect(await AiContextReader.readProjectContext(PROJECT_A)).toBe("");
    expect(await AiContextReader.readProjectContext(PROJECT_A)).toBe("");
  });

  test("a read that fails reads as none, and says so in the log: the run goes on", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("database is down"));
    const logged: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });

    expect(await AiContextReader.readProjectContext(PROJECT_A)).toBe("");
    expect(String(logged.mock.calls[0]![0])).toContain(
      `could not read the AI context of project ${PROJECT_A.toString()}`,
    );
  });
});

describe("AiContextReader.read", () => {
  test("the project's notes, then the rules', composed", async () => {
    mockProjects();

    const read: AiContextActivity | null = await AiContextReader.read({
      projectId: PROJECT_A,
      rules: [
        { id: RULE_ID.toString(), name: "Checkout", aiContext: "Rule notes" },
      ],
    });

    expect(read!.parts).toEqual([
      { source: AiContextSource.Project, text: NOTES_A },
      {
        source: AiContextSource.AiRule,
        ruleId: RULE_ID.toString(),
        ruleName: "Checkout",
        text: "Rule notes",
      },
    ]);
  });

  test("null when there is nothing to read", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(new Project(PROJECT_A));

    expect(await AiContextReader.read({ projectId: PROJECT_A })).toBeNull();
  });

  test("an image pasted into the notes is left out: a model reads text, and the run records what it was given", async () => {
    const image: string = `![diagram](data:image/png;base64,${"iVBORw0KGgo".repeat(400)})`;
    const project: Project = new Project(PROJECT_A);
    project.aiContext = `Architecture: ${image}`;
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project);

    const read: AiContextActivity | null = await AiContextReader.read({
      projectId: PROJECT_A,
      rules: [{ id: "r1", name: "Rule", aiContext: `See ${image}` }],
    });

    for (const part of read!.parts) {
      expect(part.text).not.toContain("base64,");
      expect(part.text).toContain("omitted");
    }
  });

  test("a project that cannot be read still gives the run its rules' notes", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockRejectedValue(new Error("down"));
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });

    const read: AiContextActivity | null = await AiContextReader.read({
      projectId: PROJECT_A,
      rules: [{ id: "r1", name: "Rule", aiContext: "Rule notes" }],
    });

    expect(read!.parts).toEqual([
      {
        source: AiContextSource.AiRule,
        ruleId: "r1",
        ruleName: "Rule",
        text: "Rule notes",
      },
    ]);
  });
});

describe("AiContextReader.forRule: the notes of the rule a fix works for", () => {
  test("no rule started the fix: no rule's notes, and nothing is read", async () => {
    const findOneBy: SpyInstance<typeof AutoRemediationRuleService.findOneBy> =
      jest.spyOn(AutoRemediationRuleService, "findOneBy");

    expect(await AiContextReader.forRule({ projectId: PROJECT_A })).toEqual([]);
    expect(
      await AiContextReader.forRule({
        projectId: PROJECT_A,
        autoRemediationRuleId: null,
      }),
    ).toEqual([]);
    expect(findOneBy).not.toHaveBeenCalled();
  });

  test("reads the rule by its id within the run's project only", async () => {
    const findOneBy: SpyInstance<typeof AutoRemediationRuleService.findOneBy> =
      jest
        .spyOn(AutoRemediationRuleService, "findOneBy")
        .mockResolvedValue(
          rule({ name: "Checkout", aiContext: "Checkout notes" }),
        );

    expect(
      await AiContextReader.forRule({
        projectId: PROJECT_A,
        autoRemediationRuleId: RULE_ID,
      }),
    ).toEqual([
      {
        id: RULE_ID.toString(),
        name: "Checkout",
        aiContext: "Checkout notes",
      },
    ]);
    expect(findOneBy).toHaveBeenCalledWith({
      query: { _id: RULE_ID.toString(), projectId: PROJECT_A },
      select: { _id: true, name: true, aiContext: true },
      props: { isRoot: true },
    });
  });

  test("a rule of another project - or one deleted since - gives nothing", async () => {
    jest.spyOn(AutoRemediationRuleService, "findOneBy").mockResolvedValue(null);

    expect(
      await AiContextReader.forRule({
        projectId: PROJECT_B,
        autoRemediationRuleId: RULE_ID,
      }),
    ).toEqual([]);
  });

  test("a rule without notes gives nothing", async () => {
    jest
      .spyOn(AutoRemediationRuleService, "findOneBy")
      .mockResolvedValue(rule({ aiContext: "   " }));

    expect(
      await AiContextReader.forRule({
        projectId: PROJECT_A,
        autoRemediationRuleId: RULE_ID,
      }),
    ).toEqual([]);
  });

  test("a read that fails gives nothing: the fix goes on with the project's notes", async () => {
    jest
      .spyOn(AutoRemediationRuleService, "findOneBy")
      .mockRejectedValue(new Error("down"));
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });

    expect(
      await AiContextReader.forRule({
        projectId: PROJECT_A,
        autoRemediationRuleId: RULE_ID,
      }),
    ).toEqual([]);
  });
});

describe("AiContextReader.forIncident and forAlert: the matching rules' notes", () => {
  test("reads the incident within the run's project, with what rules match on", async () => {
    const findIncident: SpyInstance<typeof IncidentService.findOneBy> = jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(incident(MONITOR_CHECKOUT));
    jest.spyOn(AutoRemediationRuleService, "findBy").mockResolvedValue([]);

    await AiContextReader.forIncident({
      projectId: PROJECT_A,
      incidentId: INCIDENT_ID,
    });

    expect(findIncident.mock.calls[0]![0]).toMatchObject({
      query: { _id: INCIDENT_ID.toString(), projectId: PROJECT_A },
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

  test("only the rules the incident matches give their notes", async () => {
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockResolvedValue(incident(MONITOR_CHECKOUT));
    jest.spyOn(AutoRemediationRuleService, "findBy").mockResolvedValue([
      rule({
        _id: "aaaaaaaa-0000-4000-8000-000000000001",
        name: "Checkout",
        monitors: [monitor(MONITOR_CHECKOUT)],
        aiContext: "Checkout notes",
      }),
      rule({
        _id: "aaaaaaaa-0000-4000-8000-000000000002",
        name: "Payments",
        monitors: [monitor(MONITOR_PAYMENTS)],
        aiContext: "Payments notes",
      }),
      rule({
        _id: "aaaaaaaa-0000-4000-8000-000000000003",
        name: "Everything",
        aiContext: "Notes for every incident",
      }),
    ]);

    const rules: Array<AiContextRule> = await AiContextReader.forIncident({
      projectId: PROJECT_A,
      incidentId: INCIDENT_ID,
    });

    expect(
      rules.map((matched: AiContextRule) => {
        return matched.name;
      }),
    ).toEqual(["Checkout", "Everything"]);
  });

  test("an incident that cannot be found gives nothing", async () => {
    jest.spyOn(IncidentService, "findOneBy").mockResolvedValue(null);
    const findBy: SpyInstance<typeof AutoRemediationRuleService.findBy> =
      jest.spyOn(AutoRemediationRuleService, "findBy");

    expect(
      await AiContextReader.forIncident({
        projectId: PROJECT_A,
        incidentId: INCIDENT_ID,
      }),
    ).toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("an alert is read within the run's project, and matched as alerts are", async () => {
    const findAlert: SpyInstance<typeof AlertService.findOneBy> = jest
      .spyOn(AlertService, "findOneBy")
      .mockResolvedValue(
        Object.assign(new Alert(), {
          _id: ALERT_ID.toString(),
          title: "Checkout is slow",
          monitorId: MONITOR_CHECKOUT,
          labels: [],
        }),
      );
    const findBy: SpyInstance<typeof AutoRemediationRuleService.findBy> = jest
      .spyOn(AutoRemediationRuleService, "findBy")
      .mockResolvedValue([rule({ name: "Alerts", aiContext: "Alert notes" })]);

    const rules: Array<AiContextRule> = await AiContextReader.forAlert({
      projectId: PROJECT_A,
      alertId: ALERT_ID,
    });

    expect(findAlert.mock.calls[0]![0]).toMatchObject({
      query: { _id: ALERT_ID.toString(), projectId: PROJECT_A },
    });
    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: { triggerEntityType: AutoRemediationTriggerEntity.Alert },
    });
    expect(rules).toHaveLength(1);
    expect(rules[0]!.aiContext).toBe("Alert notes");
  });

  test("a read that fails gives nothing", async () => {
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockRejectedValue(new Error("down"));
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined;
    });

    expect(
      await AiContextReader.forIncident({
        projectId: PROJECT_A,
        incidentId: INCIDENT_ID,
      }),
    ).toEqual([]);
  });
});

describe("InvestigationRules.getIncidentAiContextRules: the rules a run reads notes from", () => {
  test("reads only the project's enabled rules that investigate and carry notes, for what they match on and the notes", async () => {
    const findBy: SpyInstance<typeof AutoRemediationRuleService.findBy> = jest
      .spyOn(AutoRemediationRuleService, "findBy")
      .mockResolvedValue([]);

    await InvestigationRules.getIncidentAiContextRules({
      projectId: PROJECT_A,
      incident: incident(MONITOR_CHECKOUT),
    });

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: {
        projectId: PROJECT_A,
        isEnabled: true,
        triggerEntityType: AutoRemediationTriggerEntity.Incident,
        // The rules that decide which incidents are investigated.
        investigates: true,
      },
      select: {
        _id: true,
        name: true,
        criteria: true,
        monitors: { _id: true },
        aiContext: true,
      },
      limit: MAX_RULES_EVALUATED_PER_PROJECT,
      props: { isRoot: true },
    });
    // Only rules with notes are read at all: aiContext IS NOT NULL.
    const aiContextFilter: { getSql: (alias: string) => string } = (
      findBy.mock.calls[0]![0] as unknown as {
        query: { aiContext: { getSql: (alias: string) => string } };
      }
    ).query.aiContext;

    expect(aiContextFilter.getSql('"aiContext"')).toBe(
      (QueryHelper.notNull() as { getSql: (alias: string) => string }).getSql(
        '"aiContext"',
      ),
    );
    expect(aiContextFilter.getSql('"aiContext"')).toBe(
      '("aiContext" IS NOT NULL)',
    );
  });

  test("a rule whose notes are blank is not matched", async () => {
    jest
      .spyOn(AutoRemediationRuleService, "findBy")
      .mockResolvedValue([rule({ aiContext: "  \n " })]);

    expect(
      await InvestigationRules.getIncidentAiContextRules({
        projectId: PROJECT_A,
        incident: incident(MONITOR_CHECKOUT),
      }),
    ).toEqual([]);
  });

  test("rules that cannot be read give no notes, and the run goes on", async () => {
    jest
      .spyOn(AutoRemediationRuleService, "findBy")
      .mockRejectedValue(new Error("down"));
    const logged: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined;
      });

    expect(
      await InvestigationRules.getAlertAiContextRules({
        projectId: PROJECT_A,
        alert: Object.assign(new Alert(), { title: "x", labels: [] }),
      }),
    ).toEqual([]);
    expect(String(logged.mock.calls[0]![0])).toContain(
      "could not read the AI context of the AI rules that investigate",
    );
  });
});
