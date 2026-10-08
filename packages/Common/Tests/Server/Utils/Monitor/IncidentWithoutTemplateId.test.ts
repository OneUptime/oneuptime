/*
 * PasswordHash fails to COMPILE under ts-jest (TS 5.9 + @types/node Buffer
 * mismatch) and DatabaseService (which every concrete service used below
 * extends) imports it. Nothing password-related is under test here, so the
 * module is replaced WITH A FACTORY — an automock would still require (and
 * type-check) the real file.
 */
jest.mock("../../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import IncidentService from "../../../../Server/Services/IncidentService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import Dictionary from "../../../../Types/Dictionary";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { mockProjectStates } from "../../TestingUtils/Services/ProjectStatesHelper";

/*
 * An incident remembers the criteria and the incident template that raised
 * it. Before the server gave templates ids, a template written through the
 * API - every one the Terraform provider wrote - had none, so its incidents
 * were stored with no createdIncidentTemplateId.
 *
 * Auto-resolve required that id on the path every whole-monitor incident
 * takes, so those incidents stayed open after the monitor recovered. And once
 * the template does get an id, an incident still open from before must keep
 * being found, or the next failing check opens a second one beside it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const OFFLINE_CRITERIA_ID: string = "criteria-offline";
const ONLINE_CRITERIA_ID: string = "criteria-online";
const TEMPLATE_ID: string = "template-offline";

function openIncident(templateId?: string): Incident {
  const incident: Incident = new Incident();
  incident._id = new ObjectID(
    "99999999-9999-4999-8999-999999999999",
  ).toString();
  incident.createdCriteriaId = OFFLINE_CRITERIA_ID;
  if (templateId) {
    incident.createdIncidentTemplateId = templateId;
  }
  return incident;
}

function criteria(id: string): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = id;
  return instance;
}

function shouldCloseIncident(input: Record<string, unknown>): boolean {
  return (MonitorIncident as any).shouldCloseIncident(input);
}

// The offline criteria opted into auto-resolve, through a template with an id.
const AUTO_RESOLVE: Dictionary<Array<string>> = {
  [OFFLINE_CRITERIA_ID]: [TEMPLATE_ID],
};

// The same, written before the server gave templates ids.
const AUTO_RESOLVE_WITHOUT_TEMPLATE_IDS: Dictionary<Array<string>> = {
  [OFFLINE_CRITERIA_ID]: [undefined as unknown as string],
};

describe("Auto-resolving an incident whose template had no id", () => {
  it("resolves it once another criteria matches - the monitor recovered", () => {
    expect(
      shouldCloseIncident({
        openIncident: openIncident(),
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: AUTO_RESOLVE,
        criteriaInstance: criteria(ONLINE_CRITERIA_ID),
      }),
    ).toBe(true);
  });

  it("resolves it when the criteria still has no template ids either", () => {
    expect(
      shouldCloseIncident({
        openIncident: openIncident(),
        autoResolveCriteriaInstanceIdIncidentIdsDictionary:
          AUTO_RESOLVE_WITHOUT_TEMPLATE_IDS,
        criteriaInstance: criteria(ONLINE_CRITERIA_ID),
      }),
    ).toBe(true);
  });

  it("resolves it when no criteria matches at all", () => {
    expect(
      shouldCloseIncident({
        openIncident: openIncident(),
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: AUTO_RESOLVE,
        criteriaInstance: null,
      }),
    ).toBe(true);
  });

  it("keeps it open while the criteria that raised it still matches", () => {
    expect(
      shouldCloseIncident({
        openIncident: openIncident(),
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: AUTO_RESOLVE,
        criteriaInstance: criteria(OFFLINE_CRITERIA_ID),
      }),
    ).toBe(false);
  });

  it("keeps it open when its criteria did not opt into auto-resolve", () => {
    expect(
      shouldCloseIncident({
        openIncident: openIncident(),
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: {},
        criteriaInstance: criteria(ONLINE_CRITERIA_ID),
      }),
    ).toBe(false);
  });

  it("keeps it open when it names no criteria", () => {
    const incident: Incident = openIncident();
    incident.createdCriteriaId = undefined;

    expect(
      shouldCloseIncident({
        openIncident: incident,
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: AUTO_RESOLVE,
        criteriaInstance: criteria(ONLINE_CRITERIA_ID),
      }),
    ).toBe(false);
  });
});

describe("Auto-resolving an incident whose template had an id (unchanged)", () => {
  it("resolves it when that template opted into auto-resolve", () => {
    expect(
      shouldCloseIncident({
        openIncident: openIncident(TEMPLATE_ID),
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: AUTO_RESOLVE,
        criteriaInstance: criteria(ONLINE_CRITERIA_ID),
      }),
    ).toBe(true);
  });

  it("keeps it open when that template did not opt in", () => {
    expect(
      shouldCloseIncident({
        openIncident: openIncident("another-template"),
        autoResolveCriteriaInstanceIdIncidentIdsDictionary: AUTO_RESOLVE,
        criteriaInstance: criteria(ONLINE_CRITERIA_ID),
      }),
    ).toBe(false);
  });
});

describe("An open incident whose template had no id still dedupes", () => {
  let created: Array<Incident> = [];

  const dataToProcess: ProbeMonitorResponse = {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    probeId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    failureCause: "Connection refused",
    responseCode: 503,
    monitoredAt: new Date("2026-10-08T10:00:00.000Z"),
  } as unknown as ProbeMonitorResponse;

  function monitor(): Monitor {
    const model: Monitor = new Monitor();
    model._id = MONITOR_ID.toString();
    model.projectId = PROJECT_ID;
    model.monitorType = MonitorType.Website;
    model.name = "NPR";
    return model;
  }

  function offlineCriteria(): MonitorCriteriaInstance {
    const instance: MonitorCriteriaInstance = criteria(OFFLINE_CRITERIA_ID);
    instance.data!.name = "Check if NPR is offline";
    instance.data!.createIncidents = true;
    instance.data!.incidents = [
      {
        // The server has given the template an id since the incident opened.
        id: TEMPLATE_ID,
        title: "NPR is offline",
        description: "NPR is currently offline.",
        incidentSeverityId: SEVERITY_ID,
        autoResolveIncident: true,
      },
    ];
    return instance;
  }

  function summary(): MonitorEvaluationSummary {
    return {
      evaluatedAt: new Date("2026-10-08T10:00:00.000Z"),
      criteriaResults: [],
      events: [],
    };
  }

  async function runCreator(openIncidents: Array<Incident>): Promise<void> {
    await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: offlineCriteria(),
      monitor: monitor(),
      dataToProcess: dataToProcess,
      rootCause: "Monitor is offline",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: AUTO_RESOLVE,
      evaluationSummary: summary(),
      openIncidents: openIncidents,
      props: {},
    });
  }

  beforeEach(() => {
    mockProjectStates();
    created = [];

    jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
      .mockResolvedValue(true);
    jest
      .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
      .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
    jest
      .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
      .mockResolvedValue(MonitorResourceContextUtil.emptyContext());
    jest
      .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
      .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });
    jest
      .spyOn(IncidentService, "create")
      .mockImplementation(async (createBy: unknown): Promise<Incident> => {
        const incident: Incident = (createBy as { data: Incident }).data;
        created.push(incident);
        incident._id = new ObjectID(
          "66666666-6666-4666-8666-666666666666",
        ).toString();
        return incident;
      });
    jest.spyOn(IncidentService, "addOwners").mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not open a second incident beside it", async () => {
    await runCreator([openIncident()]);

    expect(created).toHaveLength(0);
  });

  it("does not open a second incident beside one from the same template", async () => {
    await runCreator([openIncident(TEMPLATE_ID)]);

    expect(created).toHaveLength(0);
  });

  it("opens one when the open incident came from a different template", async () => {
    await runCreator([openIncident("another-template")]);

    expect(created).toHaveLength(1);
    expect(created[0]!.createdIncidentTemplateId).toBe(TEMPLATE_ID);
    expect(created[0]!.createdCriteriaId).toBe(OFFLINE_CRITERIA_ID);
  });

  it("opens one when nothing is open", async () => {
    await runCreator([]);

    expect(created).toHaveLength(1);
  });
});
