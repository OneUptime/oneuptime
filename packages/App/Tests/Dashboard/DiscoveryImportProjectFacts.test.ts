import { beforeEach, describe, expect, test } from "@jest/globals";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import NetworkAlertPolicy from "Common/Models/DatabaseModels/NetworkAlertPolicy";
import Includes from "Common/Types/BaseDatabase/Includes";
import IP from "Common/Types/IP/IP";
import { ActiveMonitorLimitKind } from "Common/Types/Monitor/ActiveMonitorLimit";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import { DEVICE_MONITOR_TEMPLATE_TYPES } from "Common/Utils/Monitor/DeviceMonitorTemplateUtil";
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
  NO_DEVICE_MONITOR_TEMPLATE_REASON,
  buildTemplateChoices,
  loadDiscoveryImportProjectFacts,
  toPolicyFacts,
  toTemplateChoice,
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
    monitorType: MonitorType.NetworkDevice,
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

  test("a template with no id is not offered; one with no name is, and the step names it", () => {
    const unnamed: MonitorTemplate = posTemplate();
    // As a list read that did not select the name hands it back.
    delete unnamed.templateName;
    const withoutId: MonitorTemplate = new MonitorTemplate();
    withoutId.monitorType = MonitorType.NetworkDevice;

    expect(
      namesOf(
        buildTemplateChoices({
          templates: [withoutId, unnamed],
          canCreateTemplates: false,
          seedIds: null,
          projectId: PROJECT_ID,
        }),
      ),
    ).toEqual([""]);
  });
});

/*
 * Issue #5145: a customer's own Ping template never showed, because only
 * Network Device templates were read. Every kind a device's monitor can be
 * made from is offered now - Network Device templates, which read each
 * device's polls, then Ping, IP, Port and NTP ones, which check each
 * device's address - and nothing else.
 */
describe("templates of every kind a device's monitor can be made from (#5145)", () => {
  const KDS_TEMPLATE_ID: ObjectID = new ObjectID(
    "8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a",
  );
  const PRINTER_TEMPLATE_ID: ObjectID = new ObjectID(
    "9b9b9b9b-9b9b-4b9b-8b9b-9b9b9b9b9b9b",
  );
  const TIME_TEMPLATE_ID: ObjectID = new ObjectID(
    "acacacac-acac-4cac-8cac-acacacacacac",
  );
  const IP_TEMPLATE_ID: ObjectID = new ObjectID(
    "bdbdbdbd-bdbd-4dbd-8dbd-bdbdbdbdbdbd",
  );
  const WEBSITE_TEMPLATE_ID: ObjectID = new ObjectID(
    "cececece-cece-4ece-8ece-cececececece",
  );

  function addressTemplate(data: {
    id: ObjectID;
    name: string;
    monitorType: MonitorType;
    ports?: Array<number>;
    monitoringInterval?: string;
  }): MonitorTemplate {
    const steps: MonitorSteps = new MonitorSteps();
    steps.data = {
      monitorStepsInstanceArray: (data.ports || [0]).map(
        (port: number): MonitorStep => {
          const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
            monitorName: data.name,
            monitorType: data.monitorType,
            onlineMonitorStatusId: ONLINE_ID,
            offlineMonitorStatusId: OFFLINE_ID,
            defaultIncidentSeverityId: CRITICAL_ID,
            defaultAlertSeverityId: WARNING_ID,
          });
          step.setMonitorDestination(IP.fromString("192.0.2.10"));
          if (port) {
            step.setPort(new Port(port));
          }
          return step;
        },
      ),
      defaultMonitorStatusId: ONLINE_ID,
    };

    return Object.assign(new MonitorTemplate(), {
      id: data.id,
      templateName: data.name,
      monitorType: data.monitorType,
      monitorSteps: steps,
      ...(data.monitoringInterval
        ? { monitoringInterval: data.monitoringInterval }
        : {}),
    });
  }

  function kdsTemplate(): MonitorTemplate {
    return addressTemplate({
      id: KDS_TEMPLATE_ID,
      name: "WB KDS Ping Monitor Template",
      monitorType: MonitorType.Ping,
      monitoringInterval: "*/5 * * * *",
    });
  }

  function printerTemplate(): MonitorTemplate {
    return addressTemplate({
      id: PRINTER_TEMPLATE_ID,
      name: "Receipt printers",
      monitorType: MonitorType.Port,
      ports: [9100, 22, 9100],
      monitoringInterval: "* * * * *",
    });
  }

  function timeTemplate(): MonitorTemplate {
    return addressTemplate({
      id: TIME_TEMPLATE_ID,
      name: "Store time servers",
      monitorType: MonitorType.NTP,
    });
  }

  function ipTemplate(): MonitorTemplate {
    return addressTemplate({
      id: IP_TEMPLATE_ID,
      name: "Registers by IP",
      monitorType: MonitorType.IP,
      monitoringInterval: "*/10 * * * *",
    });
  }

  function websiteTemplate(): MonitorTemplate {
    return Object.assign(new MonitorTemplate(), {
      id: WEBSITE_TEMPLATE_ID,
      templateName: "Storefront website",
      monitorType: MonitorType.Website,
    });
  }

  function idsOf(choices: Array<DiscoveryImportTemplateChoice>): Array<string> {
    return choices.map((choice: DiscoveryImportTemplateChoice): string => {
      return choice.id;
    });
  }

  test("the recommended one first, then the other Network Device templates, then the address ones - each in the order read", () => {
    const choices: Array<DiscoveryImportTemplateChoice> = buildTemplateChoices({
      templates: [
        kdsTemplate(),
        websiteTemplate(),
        posTemplate(),
        printerTemplate(),
        recommendedTemplate(),
        timeTemplate(),
        ipTemplate(),
      ],
      canCreateTemplates: true,
      seedIds: SEED_IDS,
      projectId: PROJECT_ID,
    });

    expect(idsOf(choices)).toEqual([
      RECOMMENDED_TEMPLATE_ID.toString(),
      POS_TEMPLATE_ID.toString(),
      KDS_TEMPLATE_ID.toString(),
      PRINTER_TEMPLATE_ID.toString(),
      TIME_TEMPLATE_ID.toString(),
      IP_TEMPLATE_ID.toString(),
    ]);
    expect(
      choices.map((choice: DiscoveryImportTemplateChoice): MonitorType => {
        return choice.monitorType;
      }),
    ).toEqual([
      MonitorType.NetworkDevice,
      MonitorType.NetworkDevice,
      MonitorType.Ping,
      MonitorType.Port,
      MonitorType.NTP,
      MonitorType.IP,
    ]);
  });

  test("a template that checks no device's address is never offered, whatever the read returned", () => {
    for (const monitorType of [
      MonitorType.Website,
      MonitorType.API,
      MonitorType.SSLCertificate,
      MonitorType.DNS,
      MonitorType.Manual,
      MonitorType.Logs,
    ]) {
      const template: MonitorTemplate = websiteTemplate();
      template.monitorType = monitorType;

      expect(
        buildTemplateChoices({
          templates: [template],
          canCreateTemplates: false,
          seedIds: null,
          projectId: PROJECT_ID,
        }),
      ).toEqual([]);
    }
  });

  test("only a Network Device template can be the recommended one, marker or not", () => {
    const pretender: MonitorTemplate = kdsTemplate();
    pretender.templateDescription =
      recommendedTemplate().templateDescription || "";

    const choices: Array<DiscoveryImportTemplateChoice> = buildTemplateChoices({
      templates: [pretender],
      canCreateTemplates: true,
      seedIds: SEED_IDS,
      projectId: PROJECT_ID,
    });

    // The real recommended template is offered to be created, before it.
    expect(choices[0]!.isCreatedOnImport).toBe(true);
    expect(choices[0]!.monitorType).toBe(MonitorType.NetworkDevice);
    expect(idsOf(choices)).toEqual(["", KDS_TEMPLATE_ID.toString()]);
  });

  test("a Ping template alone is offered as it is to someone who may not create templates", () => {
    expect(
      idsOf(
        buildTemplateChoices({
          templates: [kdsTemplate()],
          canCreateTemplates: false,
          seedIds: SEED_IDS,
          projectId: PROJECT_ID,
        }),
      ),
    ).toEqual([KDS_TEMPLATE_ID.toString()]);
  });

  test("what the step says about an address template: its schedule, its ports, and that every check fires on any device", () => {
    const kds: DiscoveryImportTemplateChoice = toTemplateChoice(kdsTemplate());
    expect(kds).toEqual(
      expect.objectContaining({
        id: KDS_TEMPLATE_ID.toString(),
        name: "WB KDS Ping Monitor Template",
        monitorType: MonitorType.Ping,
        monitoringInterval: "*/5 * * * *",
      }),
    );
    expect(kds.ports).toBeUndefined();
    expect(kds.summary.raisesIncidents).toBe(true);
    expect(kds.summary.raisesIncidentsOnPingOnlyDevices).toBe(true);

    const printers: DiscoveryImportTemplateChoice =
      toTemplateChoice(printerTemplate());
    expect(printers.ports).toEqual([9100, 22]);
    expect(printers.monitoringInterval).toBe("* * * * *");

    // An NTP template's port is the protocol's: not named.
    expect(toTemplateChoice(timeTemplate()).ports).toBeUndefined();
    expect(
      toTemplateChoice(timeTemplate()).monitoringInterval,
    ).toBeUndefined();
  });

  test("a Network Device template's monitors are judged on each poll: no schedule or ports of their own", () => {
    const template: MonitorTemplate = recommendedTemplate();
    template.monitoringInterval = "*/5 * * * *";

    const choice: DiscoveryImportTemplateChoice = toTemplateChoice(template);

    expect(choice.monitorType).toBe(MonitorType.NetworkDevice);
    expect(choice.monitoringInterval).toBeUndefined();
    expect(choice.ports).toBeUndefined();
    // Read as before: only "Device unreachable" fires on a ping-only device.
    expect(choice.summary.raisesIncidentsOnPingOnlyDevices).toBe(true);
    expect(choice.summary.raisesAlertsOnPingOnlyDevices).toBe(false);
  });

  test("a template saved with no name is offered with none: the step names it in the reader's language", () => {
    const unnamed: MonitorTemplate = kdsTemplate();
    delete unnamed.templateName;
    const spaces: MonitorTemplate = printerTemplate();
    spaces.templateName = "   ";

    expect(toTemplateChoice(unnamed).name).toBe("");
    expect(toTemplateChoice(spaces).name).toBe("");
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
    /*
     * This project's templates of every kind a device's monitor can be
     * made from (#5145: a Ping template never showed), each with its type
     * and schedule.
     */
    const templateRead: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = getListMock.mock.calls.find((call: Array<unknown>): boolean => {
      return (call[0] as { modelType: unknown }).modelType === MonitorTemplate;
    })![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    };
    expect(templateRead.query["projectId"]).toBe(PROJECT_ID);
    expect(templateRead.query["monitorType"]).toBeInstanceOf(Includes);
    expect(
      (templateRead.query["monitorType"] as Includes).values.map(String),
    ).toEqual([...DEVICE_MONITOR_TEMPLATE_TYPES].map(String));
    expect(templateRead.select).toEqual(
      expect.objectContaining({
        _id: true,
        templateName: true,
        monitorType: true,
        monitorSteps: true,
        monitoringInterval: true,
      }),
    );
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
      NO_DEVICE_MONITOR_TEMPLATE_REASON,
    );
    expect(NO_DEVICE_MONITOR_TEMPLATE_REASON).toBe(
      "This project has no Network Device, Ping, IP, Port or NTP monitor template, and you may not create one. Ask a project owner or admin to create the recommended one under Network > Settings > Alert Policies, or another under Monitors > Settings > Templates.",
    );
  });

  test("a Ping template is enough: no reason to give, though the reader may not create one", async () => {
    allow({ createTemplates: false });
    answerLists({
      templates: {
        data: [
          Object.assign(new MonitorTemplate(), {
            id: POS_TEMPLATE_ID,
            templateName: "WB KDS Ping Monitor Template",
            monitorType: MonitorType.Ping,
            monitoringInterval: "*/5 * * * *",
          }),
        ],
      },
      statuses: STATUSES,
      incidentSeverities: INCIDENT_SEVERITIES,
      alertSeverities: ALERT_SEVERITIES,
    });

    const facts: DiscoveryImportProjectFacts =
      await loadDiscoveryImportProjectFacts();

    expect(namesOf(facts.templates)).toEqual(["WB KDS Ping Monitor Template"]);
    expect(facts.templates[0]!.monitorType).toBe(MonitorType.Ping);
    expect(facts.templatesUnavailableReason).toBeUndefined();
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
