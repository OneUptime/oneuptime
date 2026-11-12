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
 * Toolbox/Index first: the toolbox sits in an import cycle (tool -> service
 * -> ... -> AIToolbox), and production always enters through Index.
 */
import AIToolbox from "../../../Server/Utils/AI/Toolbox/Index";
import {
  PublishStatusPageTool,
  SetUpPagingTool,
  SetUpWebsiteMonitoringTool,
} from "../../../Server/Utils/AI/Toolbox/SetupTools";
import { ToolContext } from "../../../Server/Utils/AI/Toolbox/ToolTypes";
import AlertOnCallRuleService from "../../../Server/Services/AlertOnCallRuleService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentOnCallRuleService from "../../../Server/Services/IncidentOnCallRuleService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ProbeService from "../../../Server/Services/ProbeService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import WebsiteDownApi from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownApi";
import { parseWebsiteAddress } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownSetup";
import StatusPageSetupApi from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetupApi";
import { DEFAULT_MONITORING_INTERVAL } from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitoringIntervalDefault";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { createTranslator } from "../../../Types/Translator";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { GUIDED_SETUP_MONITORING_INTERVAL } from "../../../Utils/GuidedSetup/WebsiteMonitorRecords";

/*
 * "THE RECORDS ARE THE SAME ONES THE GUIDED SETUP WOULD HAVE MADE FOR THE
 * SAME ANSWERS. A TEST COMPARES THEM." (issue #6829)
 *
 * The guided setups write through the model API from the browser
 * (WebsiteDownApi, StatusPageSetupApi); Ask AI's setup actions write through
 * the services on the server (SetupTools). Both build their records with
 * Common/Utils/GuidedSetup, so for the same answers they hand the same
 * records to the same creates: this suite captures both and compares them -
 * the website monitor (and the API one), the project's first on-call policy
 * with what its create carries, and the status page with each monitor on
 * it. The only difference is the project, which the browser leaves to the
 * server to fill from the request's tenant and the server sets itself.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const USER_ID: string = "abababab-abab-4bab-8bab-abababababab";
const TEAM_ID: string = "efefefef-efef-4fef-8fef-efefefefefef";
const MONITOR_ID: string = "55555555-5555-4555-8555-555555555555";
const STATUS_PAGE_ID: string = "88888888-8888-4888-8888-888888888888";

const OPERATIONAL: string = "11111111-1111-4111-8111-111111111111";
const DEGRADED: string = "12121212-1212-4212-8212-121212121212";
const OFFLINE: string = "22222222-2222-4222-8222-222222222222";
const ARCHIVED_SEVERITY: string = "30303030-3030-4030-8030-303030303030";
const INCIDENT_SEVERITY: string = "33333333-3333-4333-8333-333333333333";
const ALERT_SEVERITY: string = "44444444-4444-4444-8444-444444444444";

const SEEDS: ReadonlySet<string> = new Set<string>([
  OPERATIONAL,
  DEGRADED,
  OFFLINE,
  ARCHIVED_SEVERITY,
  INCIDENT_SEVERITY,
  ALERT_SEVERITY,
]);

const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: { userId: new ObjectID(USER_ID), tenantId: PROJECT_ID },
};

type LooseSpy = SpyInstance<(...args: Array<never>) => Promise<unknown>>;

function model<T>(type: { new (): T }, values: Record<string, unknown>): T {
  const record: T = new type();
  Object.assign(record as unknown as Record<string, unknown>, values);
  return record;
}

function list<T>(data: Array<T>): {
  data: Array<T>;
  count: number;
  skip: number;
  limit: number;
} {
  return { data, count: data.length, skip: 0, limit: data.length };
}

// The project's statuses and severities, in the order each read sorts them.
const statuses: () => Array<MonitorStatus> = (): Array<MonitorStatus> => {
  return [
    model(MonitorStatus, { _id: OPERATIONAL, isOperationalState: true }),
    model(MonitorStatus, { _id: DEGRADED }),
    model(MonitorStatus, { _id: OFFLINE, isOfflineState: true }),
  ];
};
const incidentSeverities: () => Array<IncidentSeverity> =
  (): Array<IncidentSeverity> => {
    return [
      model(IncidentSeverity, { _id: ARCHIVED_SEVERITY, isArchived: true }),
      model(IncidentSeverity, {
        _id: INCIDENT_SEVERITY,
        name: "Critical Incident",
      }),
    ];
  };
const alertSeverities: () => Array<AlertSeverity> =
  (): Array<AlertSeverity> => {
    return [model(AlertSeverity, { _id: ALERT_SEVERITY })];
  };

/*
 * A record as JSON, with the ids its criteria and steps generate for
 * themselves numbered in the order they appear - the project's statuses and
 * severities kept as they are - and the project left out.
 */
function comparable(record: unknown): unknown {
  const json: JSONObject = JSON.parse(JSON.stringify(record)) as JSONObject;
  delete json["projectId"];

  const numbered: Map<string, string> = new Map<string, string>();
  const text: string = JSON.stringify(json).replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    (uuid: string): string => {
      if (SEEDS.has(uuid)) {
        return uuid;
      }

      if (!numbered.has(uuid)) {
        numbered.set(uuid, `generated-${numbered.size + 1}`);
      }

      return numbered.get(uuid)!;
    },
  );

  return JSON.parse(text);
}

let getListSpy: LooseSpy;
let createSpy: LooseSpy;

// What the browser handed the model API's creates, in order.
function browserCreates(): Array<{ model: unknown; miscDataProps?: unknown }> {
  return createSpy.mock.calls.map((call: Array<unknown>) => {
    return call[0] as { model: unknown; miscDataProps?: unknown };
  });
}

beforeEach(() => {
  getListSpy = jest.spyOn(ModelAPI, "getList") as unknown as LooseSpy;
  createSpy = jest.spyOn(ModelAPI, "create") as unknown as LooseSpy;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

  getListSpy.mockImplementation((async (args: {
    modelType: { new (): unknown };
  }) => {
    if (args.modelType === MonitorStatus) {
      return list(statuses());
    }

    if (args.modelType === IncidentSeverity) {
      return list(incidentSeverities());
    }

    if (args.modelType === AlertSeverity) {
      return list(alertSeverities());
    }

    return list([]);
  }) as unknown as (...args: Array<never>) => Promise<unknown>);
  createSpy.mockResolvedValue({
    data: { id: new ObjectID(STATUS_PAGE_ID) },
  } as never);

  // The server reads the same records, as the person.
  jest
    .spyOn(MonitorStatusService, "findBy")
    .mockResolvedValue(statuses() as never);
  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockResolvedValue(incidentSeverities() as never);
  jest
    .spyOn(IncidentSeverityService, "findOneById")
    .mockResolvedValue(incidentSeverities()[1] as never);
  jest
    .spyOn(AlertSeverityService, "findBy")
    .mockResolvedValue(alertSeverities() as never);
  jest
    .spyOn(MonitorProbeService, "countBy")
    .mockResolvedValue(new PositiveNumber(2) as never);
  jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(model(Project, { name: "Acme" }) as never);
  jest
    .spyOn(ProbeService, "countBy")
    .mockResolvedValue(new PositiveNumber(1) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the two ways in build one copy of each record", () => {
  test("Ask AI's monitor checks as often as Create Monitor's default, the browser's own copy of it", () => {
    expect(GUIDED_SETUP_MONITORING_INTERVAL).toBe(DEFAULT_MONITORING_INTERVAL);
    expect(AIToolbox.getToolByName("set_up_website_monitoring")).toBe(
      SetUpWebsiteMonitoringTool,
    );
  });
});

describe("the same records, for the same answers", () => {
  test.each([
    ["a website", "example.com", false],
    ["an API", "https://api.example.com/health", true],
  ])(
    "the monitor for %s is the website guided setup's",
    async (_kind: string, address: string, isApi: boolean) => {
      // The guided setup, in the browser, in English.
      createSpy.mockResolvedValue({
        data: { id: new ObjectID(MONITOR_ID) },
      } as never);
      await WebsiteDownApi.createMonitor({
        address: parseWebsiteAddress(address)!,
        isApi: isApi,
        translator: createTranslator(undefined),
      });
      const fromGuidedSetup: Monitor = browserCreates()[0]!.model as Monitor;

      // Ask AI, on the server, for the same answers.
      const serverCreate: SpyInstance<(...args: Array<never>) => unknown> = jest
        .spyOn(MonitorService, "create")
        .mockImplementation((async (args: {
          data: Monitor;
        }): Promise<Monitor> => {
          const created: Monitor = args.data;
          created._id = MONITOR_ID;
          return created;
        }) as never) as unknown as SpyInstance<
        (...args: Array<never>) => unknown
      >;
      await SetUpWebsiteMonitoringTool.execute(
        { address: address, isApi: isApi },
        ctx,
      );
      const fromAskAi: Monitor = (
        serverCreate.mock.calls[0]![0] as unknown as { data: Monitor }
      ).data;

      expect(fromAskAi.projectId?.toString()).toBe(PROJECT_ID.toString());
      delete (fromAskAi as unknown as Record<string, unknown>)["_id"];
      expect(comparable(fromAskAi)).toEqual(comparable(fromGuidedSetup));

      // And the comparison reads what matters.
      expect(fromAskAi.name).toBe(fromGuidedSetup.name);
      expect(fromAskAi.monitorType).toBe(fromGuidedSetup.monitorType);
      expect(fromAskAi.monitoringInterval).toBe(DEFAULT_MONITORING_INTERVAL);
      expect(JSON.stringify(fromAskAi.monitorSteps)).toContain(OFFLINE);
      expect(JSON.stringify(fromAskAi.monitorSteps)).toContain(
        INCIDENT_SEVERITY,
      );
      expect(JSON.stringify(fromAskAi.monitorSteps)).not.toContain(
        ARCHIVED_SEVERITY,
      );
    },
  );

  test("the project's first on-call policy, and what its create carries, are the guided setup's", async () => {
    await WebsiteDownApi.createPolicy({
      userIds: [USER_ID],
      teamIds: [TEAM_ID],
    }).catch(() => {
      // Its answer is the browser's to read; the create is what is compared.
    });
    const fromGuidedSetup: { model: unknown; miscDataProps?: unknown } =
      browserCreates()[0]!;

    jest
      .spyOn(OnCallDutyPolicyService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    jest
      .spyOn(IncidentOnCallRuleService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    jest
      .spyOn(AlertOnCallRuleService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    const serverCreate: SpyInstance<(...args: Array<never>) => unknown> = jest
      .spyOn(OnCallDutyPolicyService, "create")
      .mockImplementation((async (args: {
        data: OnCallDutyPolicy;
      }): Promise<OnCallDutyPolicy> => {
        const created: OnCallDutyPolicy = args.data;
        created._id = ObjectID.generate().toString();
        return created;
      }) as never) as unknown as SpyInstance<
      (...args: Array<never>) => unknown
    >;

    await SetUpPagingTool.execute(
      {
        userIds: [USER_ID],
        teamIds: [TEAM_ID],
        otherPeople: [],
        pagedTeams: ["Platform"],
      },
      ctx,
    );
    const fromAskAi: { data: OnCallDutyPolicy; miscDataProps: unknown } =
      serverCreate.mock.calls[0]![0] as unknown as {
        data: OnCallDutyPolicy;
        miscDataProps: unknown;
      };

    delete (fromAskAi.data as unknown as Record<string, unknown>)["_id"];
    expect(comparable(fromAskAi.data)).toEqual(
      comparable(fromGuidedSetup.model),
    );
    expect(fromAskAi.miscDataProps).toEqual(fromGuidedSetup.miscDataProps);
  });

  test("the status page and each monitor on it are the status page guided setup's", async () => {
    // The guided setup: the page, then the monitors picked.
    await StatusPageSetupApi.createStatusPage(" Acme Status ");
    await StatusPageSetupApi.addMonitors({
      statusPageId: STATUS_PAGE_ID,
      monitors: [{ id: MONITOR_ID, name: "example.com" }],
    });
    const [page, resource]: Array<{ model: unknown }> = browserCreates();

    // Ask AI, for the same answers.
    jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue([
        model(Monitor, { _id: MONITOR_ID, name: "example.com" }),
      ] as never);
    const pageCreate: SpyInstance<(...args: Array<never>) => unknown> = jest
      .spyOn(StatusPageService, "create")
      .mockImplementation((async (args: {
        data: StatusPage;
      }): Promise<StatusPage> => {
        return model(StatusPage, { ...args.data, _id: STATUS_PAGE_ID });
      }) as never) as unknown as SpyInstance<
      (...args: Array<never>) => unknown
    >;
    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue("https://oneuptime.example/status-page/x" as never);
    jest
      .spyOn(StatusPageResourceService, "findBy")
      .mockResolvedValue([] as never);
    const resourceCreate: SpyInstance<(...args: Array<never>) => unknown> = jest
      .spyOn(StatusPageResourceService, "create")
      .mockImplementation((async (args: {
        data: StatusPageResource;
      }): Promise<StatusPageResource> => {
        return args.data;
      }) as never) as unknown as SpyInstance<
      (...args: Array<never>) => unknown
    >;

    await PublishStatusPageTool.execute(
      { name: " Acme Status ", monitors: ["example.com"] },
      ctx,
    );

    const pageFromAskAi: StatusPage = (
      pageCreate.mock.calls[0]![0] as unknown as { data: StatusPage }
    ).data;
    const resourceFromAskAi: StatusPageResource = (
      resourceCreate.mock.calls[0]![0] as unknown as {
        data: StatusPageResource;
      }
    ).data;

    // The page names its project in both: the browser's from the project it is in.
    expect(JSON.parse(JSON.stringify(pageFromAskAi))).toEqual(
      JSON.parse(JSON.stringify(page!.model)),
    );
    expect(JSON.parse(JSON.stringify(resourceFromAskAi))).toEqual(
      JSON.parse(JSON.stringify(resource!.model)),
    );
    expect(resourceFromAskAi.showUptimePercent).toBe(true);
    expect(resourceFromAskAi.monitorId?.toString()).toBe(MONITOR_ID);
  });
});
