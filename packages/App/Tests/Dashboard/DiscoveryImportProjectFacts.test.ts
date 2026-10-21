import { beforeEach, describe, expect, test } from "@jest/globals";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import NetworkAlertPolicy from "Common/Models/DatabaseModels/NetworkAlertPolicy";
import { ActiveMonitorLimitKind } from "Common/Types/Monitor/ActiveMonitorLimit";
import ObjectID from "Common/Types/ObjectID";
import NetworkAlertPolicyBootstrapUtil, {
  RECOMMENDED_TEMPLATE_NAME,
} from "Common/Utils/NetworkDevice/NetworkAlertPolicyBootstrapUtil";
import { MonitorCriteriaSeedIds } from "Common/Utils/NetworkDiscovery/PingMonitorBuilder";

/*
 * What the import's monitoring step knows about the project (OneUptime
 * issues #4811 and #4815): the templates a reader can pick, the recommended
 * one first - or the one Import would create, when they may create it - the
 * alert policies that already cover devices, the plan's room for monitors,
 * and why a choice is locked. Every read can fail on its own, and a reader
 * who may not list templates still imports devices.
 *
 * The browser-bound modules it imports are mocked: Common/UI/Config reads
 * `window` at import time, and the reads go through ModelAPI.getList.
 */

const mockConfig: { BILLING_ENABLED: boolean } = { BILLING_ENABLED: false };

jest.mock("Common/UI/Config", () => {
  const { default: MockURL } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (value: string) => unknown };
  };
  return {
    __esModule: true,
    APP_API_URL: MockURL.fromString("http://localhost/api"),
    get BILLING_ENABLED(): boolean {
      return mockConfig.BILLING_ENABLED;
    },
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: { getList: jest.fn(), create: jest.fn() },
  };
});

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: jest.fn((error: unknown): string => {
        return error instanceof Error ? error.message : String(error);
      }),
    },
  };
});

jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: { getCurrentProjectId: jest.fn() },
  };
});

jest.mock("Common/UI/Utils/PermissionGate", () => {
  return {
    __esModule: true,
    ModelAction: {
      Create: "create",
      Read: "read",
      Update: "update",
      Delete: "delete",
    },
    default: { check: jest.fn() },
  };
});

jest.mock(
  "../../FeatureSet/Dashboard/src/Components/Monitor/ActiveMonitorLimitStatusApi",
  () => {
    return {
      __esModule: true,
      fetchActiveMonitorLimitStatus: jest.fn(),
    };
  },
);

import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { fetchActiveMonitorLimitStatus } from "../../FeatureSet/Dashboard/src/Components/Monitor/ActiveMonitorLimitStatusApi";
import {
  DiscoveryImportProjectFacts,
  buildTemplateChoices,
  loadDiscoveryImportProjectFacts,
  toPolicyFacts,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportProjectFacts";
import { DiscoveryImportTemplateChoice } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportOutcome";

const getListMock: jest.Mock = ModelAPI.getList as unknown as jest.Mock;
const checkMock: jest.Mock = PermissionGate.check as unknown as jest.Mock;
const limitMock: jest.Mock =
  fetchActiveMonitorLimitStatus as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
);
const ONLINE_ID: ObjectID = new ObjectID(
  "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
);
const OFFLINE_ID: ObjectID = new ObjectID(
  "2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b",
);
const CRITICAL_ID: ObjectID = new ObjectID(
  "3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c",
);
const WARNING_ID: ObjectID = new ObjectID(
  "4d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d",
);
const POS_TEMPLATE_ID: ObjectID = new ObjectID(
  "5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e",
);
const RECOMMENDED_TEMPLATE_ID: ObjectID = new ObjectID(
  "6f6f6f6f-6f6f-4f6f-8f6f-6f6f6f6f6f6f",
);

const SEED_IDS: MonitorCriteriaSeedIds = {
  onlineMonitorStatusId: ONLINE_ID,
  offlineMonitorStatusId: OFFLINE_ID,
  defaultIncidentSeverityId: CRITICAL_ID,
  defaultAlertSeverityId: WARNING_ID,
};

function posTemplate(): MonitorTemplate {
  return Object.assign(new MonitorTemplate(), {
    id: POS_TEMPLATE_ID,
    templateName: "POS ping availability",
  });
}

function recommendedTemplate(): MonitorTemplate {
  const template: MonitorTemplate =
    NetworkAlertPolicyBootstrapUtil.buildRecommendedMonitorTemplate({
      projectId: PROJECT_ID,
      onlineMonitorStatusId: ONLINE_ID,
      offlineMonitorStatusId: OFFLINE_ID,
      incidentSeverityId: CRITICAL_ID,
      alertSeverityId: WARNING_ID,
    });
  template.id = RECOMMENDED_TEMPLATE_ID;
  return template;
}

function namesOf(choices: Array<DiscoveryImportTemplateChoice>): Array<string> {
  return choices.map((choice: DiscoveryImportTemplateChoice): string => {
    return choice.name;
  });
}

describe("the templates a reader can pick", () => {
  test("the project's recommended template comes first, whatever its name sorts as", () => {
    const choices: Array<DiscoveryImportTemplateChoice> = buildTemplateChoices({
      templates: [posTemplate(), recommendedTemplate()],
      canCreateTemplates: true,
      seedIds: SEED_IDS,
      projectId: PROJECT_ID,
    });

    expect(
      choices.map((choice: DiscoveryImportTemplateChoice) => {
        return [choice.id, choice.isCreatedOnImport];
      }),
    ).toEqual([
      [RECOMMENDED_TEMPLATE_ID.toString(), undefined],
      [POS_TEMPLATE_ID.toString(), undefined],
    ]);
    // What it raises is read from its criteria.
    expect(choices[0]!.summary.raisesIncidents).toBe(true);
    expect(choices[0]!.summary.raisesIncidentsOnPingOnlyDevices).toBe(true);
  });

  test("without one, the recommended template Import would create is offered first, to whoever may create it", () => {
    const choices: Array<DiscoveryImportTemplateChoice> = buildTemplateChoices({
      templates: [posTemplate()],
      canCreateTemplates: true,
      seedIds: SEED_IDS,
      projectId: PROJECT_ID,
    });

    expect(namesOf(choices)).toEqual([
      RECOMMENDED_TEMPLATE_NAME,
      "POS ping availability",
    ]);
    expect(choices[0]!.id).toBe("");
    expect(choices[0]!.isCreatedOnImport).toBe(true);
    // Its preview is the very template Import would create.
    expect(choices[0]!.summary.criteria.length).toBeGreaterThan(3);
  });

  test("never to someone who may not create templates, or in a project without its statuses and severities", () => {
    expect(
      namesOf(
        buildTemplateChoices({
          templates: [posTemplate()],
          canCreateTemplates: false,
          seedIds: SEED_IDS,
          projectId: PROJECT_ID,
        }),
      ),
    ).toEqual(["POS ping availability"]);
    expect(
      buildTemplateChoices({
        templates: [],
        canCreateTemplates: true,
        seedIds: null,
        projectId: PROJECT_ID,
      }),
    ).toEqual([]);
  });

  test("a template with no id is not offered; one with no name is still named", () => {
    const unnamed: MonitorTemplate = posTemplate();
    // As a list read that did not select the name hands it back.
    delete unnamed.templateName;

    expect(
      namesOf(
        buildTemplateChoices({
          templates: [new MonitorTemplate(), unnamed],
          canCreateTemplates: false,
          seedIds: null,
          projectId: PROJECT_ID,
        }),
      ),
    ).toEqual(["Unnamed Network Device template"]);
  });
});

describe("the alert policies, as the summary needs them", () => {
  test("enabled or not, scoped or not, with the template they provision from", () => {
    const everyDevice: NetworkAlertPolicy = Object.assign(
      new NetworkAlertPolicy(),
      {
        name: "Alert on every device",
        isEnabled: true,
        scope: {},
        monitorTemplateId: RECOMMENDED_TEMPLATE_ID,
      },
    );
    const coreSites: NetworkAlertPolicy = Object.assign(
      new NetworkAlertPolicy(),
      {
        name: "Core sites",
        isEnabled: false,
        scope: { siteIds: ["7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a"] },
      },
    );

    expect(
      toPolicyFacts({
        policies: [everyDevice, coreSites],
        templateNamesById: new Map<string, string>([
          [RECOMMENDED_TEMPLATE_ID.toString(), RECOMMENDED_TEMPLATE_NAME],
        ]),
      }),
    ).toEqual([
      {
        name: "Alert on every device",
        isEnabled: true,
        isUnscoped: true,
        hasTemplate: true,
        templateName: RECOMMENDED_TEMPLATE_NAME,
      },
      {
        name: "Core sites",
        isEnabled: false,
        isUnscoped: false,
        hasTemplate: false,
        templateName: undefined,
      },
    ]);
  });
});

describe("reading the facts", () => {
  type ListAnswer = { data: Array<unknown> } | Error;

  function answerLists(answers: {
    templates?: ListAnswer;
    statuses?: ListAnswer;
    incidentSeverities?: ListAnswer;
    alertSeverities?: ListAnswer;
    policies?: ListAnswer;
  }): void {
    getListMock.mockImplementation(
      async (request: { modelType: unknown }): Promise<unknown> => {
        const answer: ListAnswer | undefined =
          request.modelType === MonitorTemplate
            ? answers.templates
            : request.modelType === MonitorStatus
              ? answers.statuses
              : request.modelType === IncidentSeverity
                ? answers.incidentSeverities
                : request.modelType === AlertSeverity
                  ? answers.alertSeverities
                  : answers.policies;

        if (answer instanceof Error) {
          throw answer;
        }

        return answer || { data: [] };
      },
    );
  }

  const STATUSES: { data: Array<MonitorStatus> } = {
    data: [
      Object.assign(new MonitorStatus(), {
        id: ONLINE_ID,
        name: "Operational",
        isOperationalState: true,
      }),
      Object.assign(new MonitorStatus(), {
        id: OFFLINE_ID,
        name: "Offline",
        isOfflineState: true,
      }),
    ],
  };
  const INCIDENT_SEVERITIES: { data: Array<IncidentSeverity> } = {
    data: [
      Object.assign(new IncidentSeverity(), {
        id: CRITICAL_ID,
        name: "Critical",
      }),
    ],
  };
  const ALERT_SEVERITIES: { data: Array<AlertSeverity> } = {
    data: [
      Object.assign(new AlertSeverity(), { id: WARNING_ID, name: "Warning" }),
    ],
  };

  function allow(
    actions: { readTemplates?: boolean; createTemplates?: boolean } = {},
  ): void {
    checkMock.mockImplementation(
      (
        model: unknown,
        action: string,
      ): { isAllowed: boolean; disabledReason?: string } => {
        if (model instanceof MonitorTemplate && action === "read") {
          return actions.readTemplates === false
            ? {
                isAllowed: false,
                disabledReason: "You may not see monitor templates.",
              }
            : { isAllowed: true };
        }

        if (model instanceof MonitorTemplate && action === "create") {
          return { isAllowed: actions.createTemplates !== false };
        }

        return { isAllowed: true };
      },
    );
  }

  beforeEach(() => {
    getListMock.mockReset();
    checkMock.mockReset();
    limitMock.mockReset();
    mockConfig.BILLING_ENABLED = false;
    (ProjectUtil.getCurrentProjectId as jest.Mock).mockReturnValue(PROJECT_ID);
  });

  test("everything a reader may see: templates, names of statuses and severities, policies, seed ids", async () => {
    allow();
    answerLists({
      templates: { data: [posTemplate(), recommendedTemplate()] },
      statuses: STATUSES,
      incidentSeverities: INCIDENT_SEVERITIES,
      alertSeverities: ALERT_SEVERITIES,
      policies: {
        data: [
          Object.assign(new NetworkAlertPolicy(), {
            name: "Alert on every device",
            isEnabled: true,
            monitorTemplateId: RECOMMENDED_TEMPLATE_ID,
          }),
        ],
      },
    });

    const facts: DiscoveryImportProjectFacts =
      await loadDiscoveryImportProjectFacts();

    expect(namesOf(facts.templates)[0]).toBe(RECOMMENDED_TEMPLATE_NAME);
    expect(facts.templatesUnavailableReason).toBeUndefined();
    expect(facts.incidentSeverities.get(CRITICAL_ID.toString())?.name).toBe(
      "Critical",
    );
    expect(facts.monitorStatuses.get(OFFLINE_ID.toString())?.name).toBe(
      "Offline",
    );
    expect(facts.policies).toEqual([
      expect.objectContaining({
        name: "Alert on every device",
        templateName: RECOMMENDED_TEMPLATE_NAME,
      }),
    ]);
    expect(facts.seedIds?.offlineMonitorStatusId.toString()).toBe(
      OFFLINE_ID.toString(),
    );
    // Only Network Device templates of this project are asked for.
    const templateRead: { query: Record<string, unknown> } =
      getListMock.mock.calls.find((call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType: unknown }).modelType === MonitorTemplate
        );
      })![0] as { query: Record<string, unknown> };
    expect(templateRead.query).toEqual({
      projectId: PROJECT_ID,
      monitorType: "Network Device",
    });
  });

  test("a self-hosted install has no plan: nothing is asked, and there is no limit", async () => {
    allow();
    answerLists({ statuses: STATUSES });

    const facts: DiscoveryImportProjectFacts =
      await loadDiscoveryImportProjectFacts();

    expect(limitMock).not.toHaveBeenCalled();
    expect(facts.monitorRoom).toBeNull();
    expect(facts.monitorLimitStatus).toBeNull();
  });

  test("on a plan with a limit, the room left is what the limit leaves", async () => {
    mockConfig.BILLING_ENABLED = true;
    allow();
    answerLists({ statuses: STATUSES });
    limitMock.mockResolvedValue({
      limit: { limit: 100, kind: ActiveMonitorLimitKind.FreePlan },
      activeMonitors: 96,
    });

    const facts: DiscoveryImportProjectFacts =
      await loadDiscoveryImportProjectFacts();

    expect(facts.monitorRoom).toBe(4);
  });

  test("a plan read that fails leaves the room unknown rather than failing the step", async () => {
    mockConfig.BILLING_ENABLED = true;
    allow();
    answerLists({ statuses: STATUSES });
    limitMock.mockRejectedValue(new Error("Plan unavailable"));

    const facts: DiscoveryImportProjectFacts =
      await loadDiscoveryImportProjectFacts();

    expect(facts.monitorRoom).toBeNull();
  });

  test("a reader who may not see templates is told so, and still gets the rest", async () => {
    allow({ readTemplates: false });
    answerLists({
      statuses: STATUSES,
      incidentSeverities: INCIDENT_SEVERITIES,
      alertSeverities: ALERT_SEVERITIES,
    });

    const facts: DiscoveryImportProjectFacts =
      await loadDiscoveryImportProjectFacts();

    expect(facts.templates).toEqual([]);
    expect(facts.templatesUnavailableReason).toBe(
      "You may not see monitor templates.",
    );
    expect(
      getListMock.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType: unknown }).modelType === MonitorTemplate
        );
      }),
    ).toBe(false);
    expect(facts.incidentSeverities.size).toBe(1);
  });

  test("no template, and no right to create one: says who can", async () => {
    allow({ createTemplates: false });
    answerLists({
      templates: { data: [] },
      statuses: STATUSES,
      incidentSeverities: INCIDENT_SEVERITIES,
      alertSeverities: ALERT_SEVERITIES,
    });

    const facts: DiscoveryImportProjectFacts =
      await loadDiscoveryImportProjectFacts();

    expect(facts.templates).toEqual([]);
    expect(facts.templatesUnavailableReason).toBe(
      "This project has no Network Device monitor template, and you may not create one. Ask a project owner or admin to create the recommended one under Network > Settings > Alert Policies.",
    );
  });

  test("no template, and the project lacks what the recommended one is built from: says what to add", async () => {
    allow();
    answerLists({
      templates: { data: [] },
      statuses: STATUSES,
      incidentSeverities: { data: [] },
      alertSeverities: ALERT_SEVERITIES,
    });

    const facts: DiscoveryImportProjectFacts =
      await loadDiscoveryImportProjectFacts();

    expect(facts.seedIds).toBeNull();
    expect(facts.templatesUnavailableReason).toBe(
      "This project needs at least one incident severity before the recommended monitor template can be created. Add one under Incidents → Settings → Incident Severity, then try again.",
    );
  });

  /*
   * With no list there is no telling whether the project has the
   * recommended template already: offering to create it could make a
   * second one, so nothing is offered, and the step says why.
   */
  test("a template read that fails offers nothing to create, and says why", async () => {
    allow();
    answerLists({
      templates: new Error("The monitor templates could not be read."),
      statuses: STATUSES,
      incidentSeverities: INCIDENT_SEVERITIES,
      alertSeverities: ALERT_SEVERITIES,
    });

    const facts: DiscoveryImportProjectFacts =
      await loadDiscoveryImportProjectFacts();

    expect(facts.templates).toEqual([]);
    expect(facts.templatesUnavailableReason).toBe(
      "The monitor templates could not be read.",
    );
    // The seed ids are still there for whatever else needs them.
    expect(facts.seedIds).not.toBeNull();
  });
});
