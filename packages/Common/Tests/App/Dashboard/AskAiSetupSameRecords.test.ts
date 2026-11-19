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
  AddToOnCallPolicyTool,
  InvitePeopleTool,
  PublishStatusPageTool,
  SetUpPagingTool,
  SetUpServiceMonitorTool,
  SetUpWebsiteMonitoringTool,
} from "../../../Server/Utils/AI/Toolbox/SetupTools";
import { ToolContext } from "../../../Server/Utils/AI/Toolbox/ToolTypes";
import OnCallDutyPolicyEscalationRuleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import ProjectMilestoneService from "../../../Server/Services/ProjectMilestoneService";
import ServiceService from "../../../Server/Services/ServiceService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamPermissionService from "../../../Server/Services/TeamPermissionService";
import TeamService from "../../../Server/Services/TeamService";
import ServerSendingStatus from "../../../Server/Utils/ServerSending/ServerSendingStatus";
import OnCallSetupApi from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/OnCallSetupApi";
import TelemetrySetupApi from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/Telemetry/TelemetrySetupApi";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import Service from "../../../Models/DatabaseModels/Service";
import Team from "../../../Models/DatabaseModels/Team";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import Permission from "../../../Types/Permission";
import GrantablePermission from "../../../UI/Utils/GrantablePermission";
import { getTelemetryRecommendations } from "../../../Utils/GuidedSetup/ServiceMonitorRecords";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "../../../Types/OnCallDutyPolicy/EscalationRuleDefaults";
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
import { getDefaultStatusPageName } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetup";
import { DEFAULT_MONITORING_INTERVAL } from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/MonitoringIntervalDefault";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { createTranslator, Translator } from "../../../Types/Translator";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import {
  WhoIsToldMode,
  getWhoIsToldMode,
} from "../../../Utils/GuidedSetup/OnCallPolicyRecords";
import ProjectUtil from "../../../UI/Utils/Project";
import { GUIDED_SETUP_MONITORING_INTERVAL } from "../../../Utils/GuidedSetup/WebsiteMonitorRecords";
import UserLanguage from "../../../Server/Utils/Notification/UserLanguage";
import {
  FIRST_STRONG_ISOLATE,
  getRecordWordsTranslator,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Server/Utils/ServerTranslation";
import {
  EVERY_NEW_EVENT_RULES_LANGUAGE_KEY,
  getEveryNewAlertRuleDescription,
  getEveryNewAlertRuleName,
  getEveryNewIncidentRuleDescription,
  getEveryNewIncidentRuleName,
} from "../../../Types/OnCallDutyPolicy/EveryNewEventRules";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";

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
 *
 * In every language (#7247): the monitor's criteria, and the incident and
 * alert they open, are named in the language the person reads the
 * Dashboard in - the guided setup with the Dashboard's translator, Ask AI
 * with the server's for the language the Dashboard sent - and so is the
 * name a status page the person does not name starts with, and the first
 * on-call policy with its two catch-all rules (#7995), so the records are
 * compared read in English, German, Arabic, Persian and Japanese.
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
// The language saved on the person's account: none (English) unless a test says.
let savedLanguage: LooseSpy;

// What the browser handed the model API's creates, in order.
function browserCreates(): Array<{ model: unknown; miscDataProps?: unknown }> {
  return createSpy.mock.calls.map((call: Array<unknown>) => {
    return call[0] as { model: unknown; miscDataProps?: unknown };
  });
}

// The first on-call policy the website guided setup creates, as the browser sends it.
async function guidedSetupPolicy(
  translator: Translator,
): Promise<{ model: unknown; miscDataProps?: unknown }> {
  createSpy.mockClear();

  await WebsiteDownApi.createPolicy({
    userIds: [USER_ID],
    teamIds: [TEAM_ID],
    translator: translator,
  }).catch(() => {
    // Its answer is the browser's to read; the create is what is compared.
  });

  return browserCreates()[0]!;
}

// The first on-call policy Ask AI's set_up_paging creates, as the person.
async function askAiPolicy(
  context: ToolContext,
): Promise<{ data: OnCallDutyPolicy; miscDataProps: JSONObject }> {
  jest
    .spyOn(OnCallDutyPolicyService, "countBy")
    .mockResolvedValue(new PositiveNumber(0) as never);
  jest
    .spyOn(IncidentOnCallRuleService, "findBy")
    .mockResolvedValue([] as never);
  jest.spyOn(AlertOnCallRuleService, "findBy").mockResolvedValue([] as never);
  const serverCreate: SpyInstance<(...args: Array<never>) => unknown> = jest
    .spyOn(OnCallDutyPolicyService, "create")
    .mockImplementation((async (args: {
      data: OnCallDutyPolicy;
    }): Promise<OnCallDutyPolicy> => {
      const created: OnCallDutyPolicy = args.data;
      created._id = ObjectID.generate().toString();
      return created;
    }) as never) as unknown as SpyInstance<(...args: Array<never>) => unknown>;

  await SetUpPagingTool.execute(
    {
      userIds: [USER_ID],
      teamIds: [TEAM_ID],
      otherPeople: [],
      pagedTeams: ["Platform"],
    },
    context,
  );

  const created: { data: OnCallDutyPolicy; miscDataProps: JSONObject } =
    serverCreate.mock.calls[0]![0] as unknown as {
      data: OnCallDutyPolicy;
      miscDataProps: JSONObject;
    };

  delete (created.data as unknown as Record<string, unknown>)["_id"];

  return created;
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
  savedLanguage = jest
    .spyOn(UserLanguage, "getLanguage")
    .mockResolvedValue("en" as never) as unknown as LooseSpy;
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

// The monitor the website guided setup makes, in the browser, read with `translator`.
async function guidedSetupMonitor(data: {
  address: string;
  isApi: boolean;
  translator: Translator;
}): Promise<Monitor> {
  createSpy.mockResolvedValue({
    data: { id: new ObjectID(MONITOR_ID) },
  } as never);
  await WebsiteDownApi.createMonitor({
    address: parseWebsiteAddress(data.address)!,
    isApi: data.isApi,
    translator: data.translator,
  });

  return browserCreates()[browserCreates().length - 1]!.model as Monitor;
}

// The monitor Ask AI's approved set_up_website_monitoring makes on the server.
async function askAiMonitor(data: {
  address: string;
  isApi: boolean;
  context: ToolContext;
}): Promise<Monitor> {
  const serverCreate: SpyInstance<(...args: Array<never>) => unknown> = jest
    .spyOn(MonitorService, "create")
    .mockImplementation((async (args: { data: Monitor }): Promise<Monitor> => {
      const created: Monitor = args.data;
      created._id = MONITOR_ID;
      return created;
    }) as never) as unknown as SpyInstance<(...args: Array<never>) => unknown>;

  await SetUpWebsiteMonitoringTool.execute(
    { address: data.address, isApi: data.isApi },
    data.context,
  );

  const fromAskAi: Monitor = (
    serverCreate.mock.calls[
      serverCreate.mock.calls.length - 1
    ]![0] as unknown as {
      data: Monitor;
    }
  ).data;

  expect(fromAskAi.projectId?.toString()).toBe(PROJECT_ID.toString());
  delete (fromAskAi as unknown as Record<string, unknown>)["_id"];

  return fromAskAi;
}

// Every criteria's name and description, and what each opens, as written.
function criteriaWords(monitor: Monitor): Array<string> {
  const words: Array<string> = [];

  for (const step of monitor.monitorSteps?.data?.monitorStepsInstanceArray ||
    []) {
    for (const criteria of step.data?.monitorCriteria.data
      ?.monitorCriteriaInstanceArray || []) {
      words.push(criteria.data!.name, criteria.data!.description);

      for (const opened of [
        ...(criteria.data!.incidents || []),
        ...(criteria.data!.alerts || []),
      ]) {
        words.push(opened.title, opened.description);
      }
    }
  }

  return words;
}

const MONITOR_CASES: Array<[string, string, boolean]> = [
  ["a website", "example.com", false],
  ["an API", "https://api.example.com/health", true],
];

/*
 * The languages the records are compared in (#7247): English, German, and
 * the two read from the right, whose values a message would set apart with
 * isolate marks, and Japanese, whose sentences punctuate their own way.
 */
const RECORD_LANGUAGES: Array<string> = ["en", "de", "ar", "fa", "ja"];

describe("the same records, for the same answers", () => {
  test.each(MONITOR_CASES)(
    "the monitor for %s is the website guided setup's",
    async (_kind: string, address: string, isApi: boolean) => {
      // The guided setup, in the browser, in English.
      const fromGuidedSetup: Monitor = await guidedSetupMonitor({
        address: address,
        isApi: isApi,
        translator: createTranslator(undefined),
      });

      // Ask AI, on the server, for the same answers.
      const fromAskAi: Monitor = await askAiMonitor({
        address: address,
        isApi: isApi,
        context: ctx,
      });

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

  /*
   * #7247: a person reading the Dashboard in German gets German criteria
   * names from the guided setup, as Create Monitor gives them - and the
   * same ones from Ask AI, which the Dashboard tells the language it is
   * read in.
   */
  describe.each(RECORD_LANGUAGES)("read in %s", (language: string) => {
    test.each(MONITOR_CASES)(
      "the monitor for %s, its criteria and what they open named in the reader's language, is the website guided setup's",
      async (_kind: string, address: string, isApi: boolean) => {
        const fromGuidedSetup: Monitor = await guidedSetupMonitor({
          address: address,
          isApi: isApi,
          translator: dashboardTranslator(language),
        });
        const fromAskAi: Monitor = await askAiMonitor({
          address: address,
          isApi: isApi,
          context: { ...ctx, language: language },
        });

        expect(comparable(fromAskAi)).toEqual(comparable(fromGuidedSetup));

        const words: Array<string> = criteriaWords(fromAskAi);

        expect(words.length).toBeGreaterThan(4);
        expect(words).toEqual(criteriaWords(fromGuidedSetup));
        // A record keeps no invisible marks, in a language read from the right too.
        expect(JSON.stringify(words)).not.toContain(FIRST_STRONG_ISOLATE);
        expect(JSON.stringify(words)).not.toContain(POP_DIRECTIONAL_ISOLATE);

        // In the reader's language: not the English a server without one writes.
        const english: Array<string> = criteriaWords(
          await askAiMonitor({
            address: address,
            isApi: isApi,
            context: { ...ctx, language: "en" },
          }),
        );

        if (language === "en") {
          expect(words).toEqual(english);
        } else {
          expect(words).toHaveLength(english.length);
          words.forEach((word: string, index: number) => {
            expect([index, word]).not.toEqual([index, english[index]]);
          });
          expect(words[0]).toBe(
            dashboardTranslator(language).translateTemplate(
              "Check if {{monitorName}} is offline",
              { monitorName: fromAskAi.name! },
            ),
          );
        }
      },
    );
  });

  test("with no language from the Dashboard, the person's saved language words the monitor, as their Dashboard starts in it", async () => {
    savedLanguage.mockResolvedValue("de" as never);

    const fromGuidedSetup: Monitor = await guidedSetupMonitor({
      address: "example.com",
      isApi: false,
      translator: dashboardTranslator("de"),
    });
    const fromAskAi: Monitor = await askAiMonitor({
      address: "example.com",
      isApi: false,
      context: ctx,
    });

    expect(comparable(fromAskAi)).toEqual(comparable(fromGuidedSetup));
    expect(savedLanguage).toHaveBeenCalledWith(new ObjectID(USER_ID));
  });

  test("the Dashboard's language wins over the saved one: the person reads it now", async () => {
    savedLanguage.mockResolvedValue("fr" as never);

    const fromGuidedSetup: Monitor = await guidedSetupMonitor({
      address: "example.com",
      isApi: false,
      translator: dashboardTranslator("de"),
    });
    const fromAskAi: Monitor = await askAiMonitor({
      address: "example.com",
      isApi: false,
      context: { ...ctx, language: "de" },
    });

    expect(comparable(fromAskAi)).toEqual(comparable(fromGuidedSetup));
    expect(savedLanguage).not.toHaveBeenCalled();
  });

  test("the project's first on-call policy, and what its create carries, are the guided setup's", async () => {
    const fromGuidedSetup: { model: unknown; miscDataProps?: unknown } =
      await guidedSetupPolicy(dashboardTranslator("en"));
    const fromAskAi: { data: OnCallDutyPolicy; miscDataProps: JSONObject } =
      await askAiPolicy(ctx);

    expect(comparable(fromAskAi.data)).toEqual(
      comparable(fromGuidedSetup.model),
    );
    expect(fromAskAi.miscDataProps).toEqual(fromGuidedSetup.miscDataProps);
    // English, byte for byte as it always was.
    expect(fromAskAi.data.name).toBe("Default on-call policy");
  });

  /*
   * #7995: a person reading the Dashboard in German gets a German first
   * policy from the guided setup - and the same one from Ask AI, which the
   * Dashboard tells the language it is read in. Its two catch-all rules
   * are made by the server from the create, in the language the create
   * carries: the same for both, and worded as the Dashboard words them.
   */
  describe.each(RECORD_LANGUAGES)(
    "the first on-call policy read in %s",
    (language: string) => {
      test("is named, and asks for its rules, in the reader's language, as the guided setup does", async () => {
        const fromGuidedSetup: { model: unknown; miscDataProps?: unknown } =
          await guidedSetupPolicy(dashboardTranslator(language));
        const fromAskAi: {
          data: OnCallDutyPolicy;
          miscDataProps: JSONObject;
        } = await askAiPolicy({ ...ctx, language: language });

        expect(comparable(fromAskAi.data)).toEqual(
          comparable(fromGuidedSetup.model),
        );
        expect(fromAskAi.miscDataProps).toEqual(fromGuidedSetup.miscDataProps);
        expect(
          fromAskAi.miscDataProps[EVERY_NEW_EVENT_RULES_LANGUAGE_KEY],
        ).toBe(language);

        const name: string = fromAskAi.data.name!;

        expect(name).toBe(
          dashboardTranslator(language).translateText("Default on-call policy"),
        );
        // A record keeps no invisible marks, in a language read from the right too.
        expect(name).not.toContain(FIRST_STRONG_ISOLATE);
        expect(name).not.toContain(POP_DIRECTIONAL_ISOLATE);

        if (language === "en") {
          expect(name).toBe("Default on-call policy");
        } else {
          expect(name).not.toBe("Default on-call policy");
        }
      });

      test("its two rules are named and described as the Dashboard words them, by the language its create carries", async () => {
        const fromAskAi: {
          data: OnCallDutyPolicy;
          miscDataProps: JSONObject;
        } = await askAiPolicy({ ...ctx, language: language });
        const serverLanguage: string =
          await OnCallDutyPolicyService.readEveryNewEventRulesLanguage({
            miscDataProps: fromAskAi.miscDataProps,
            props: ctx.props,
          });
        const server: Translator | undefined =
          getRecordWordsTranslator(serverLanguage);
        const dashboard: Translator = dashboardTranslator(language);
        const policyName: string = fromAskAi.data.name!;

        expect(serverLanguage).toBe(language);
        expect(getEveryNewIncidentRuleName(policyName, server)).toBe(
          getEveryNewIncidentRuleName(policyName, dashboard),
        );
        expect(getEveryNewAlertRuleName(policyName, server)).toBe(
          getEveryNewAlertRuleName(policyName, dashboard),
        );
        expect(getEveryNewIncidentRuleDescription(server)).toBe(
          getEveryNewIncidentRuleDescription(dashboard),
        );
        expect(getEveryNewAlertRuleDescription(server)).toBe(
          getEveryNewAlertRuleDescription(dashboard),
        );

        const words: string = [
          getEveryNewIncidentRuleName(policyName, server),
          getEveryNewAlertRuleName(policyName, server),
          getEveryNewIncidentRuleDescription(server),
          getEveryNewAlertRuleDescription(server),
        ].join("\n");

        expect(words).toContain(policyName);
        expect(words).not.toContain(FIRST_STRONG_ISOLATE);
        expect(words).not.toContain(POP_DIRECTIONAL_ISOLATE);

        if (language === "en") {
          expect(getEveryNewIncidentRuleName(policyName, server)).toBe(
            "Page Default on-call policy for every incident",
          );
        } else {
          expect(words).not.toContain("for every incident");
          expect(words).not.toContain("Added when the policy was created.");
        }
      });
    },
  );

  test("with no language from the Dashboard, the person's saved language names the first policy and carries on to its rules", async () => {
    savedLanguage.mockResolvedValue("de" as never);

    const fromGuidedSetup: { model: unknown; miscDataProps?: unknown } =
      await guidedSetupPolicy(dashboardTranslator("de"));
    const fromAskAi: { data: OnCallDutyPolicy; miscDataProps: JSONObject } =
      await askAiPolicy(ctx);

    expect(comparable(fromAskAi.data)).toEqual(
      comparable(fromGuidedSetup.model),
    );
    expect(fromAskAi.miscDataProps).toEqual(fromGuidedSetup.miscDataProps);
    expect(savedLanguage).toHaveBeenCalledWith(new ObjectID(USER_ID));
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

  /*
   * #7247: a page the person does not name starts with the project's name,
   * in the language they read the Dashboard in - the guided setup fills its
   * name field with it, and Ask AI names the page it proposes with it.
   */
  test.each(RECORD_LANGUAGES)(
    "a status page the person does not name, read in %s, is named and made as the status page guided setup makes it",
    async (language: string) => {
      // The guided setup: the name it starts with, kept as it is.
      const startingName: string = getDefaultStatusPageName({
        translator: dashboardTranslator(language),
        projectName: "Acme",
      });
      await StatusPageSetupApi.createStatusPage(startingName);
      const page: { model: unknown } = browserCreates()[0]!;

      // Ask AI, asked for a page without a name, by the same person.
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
        .mockResolvedValue("" as never);
      jest
        .spyOn(StatusPageResourceService, "findBy")
        .mockResolvedValue([] as never);
      jest
        .spyOn(StatusPageResourceService, "create")
        .mockImplementation((async (args: {
          data: StatusPageResource;
        }): Promise<StatusPageResource> => {
          return args.data;
        }) as never);

      const context: ToolContext = { ...ctx, language: language };
      const prepared: { arguments: JSONObject } =
        await PublishStatusPageTool.prepareMutation!(
          { monitors: ["example.com"] },
          context,
        );
      await PublishStatusPageTool.execute(prepared.arguments, context);

      const pageFromAskAi: StatusPage = (
        pageCreate.mock.calls[0]![0] as unknown as { data: StatusPage }
      ).data;

      expect(prepared.arguments["name"]).toBe(startingName);
      expect(JSON.parse(JSON.stringify(pageFromAskAi))).toEqual(
        JSON.parse(JSON.stringify(page.model)),
      );
      expect(pageFromAskAi.name).toBe(startingName);
      // A record keeps no invisible marks, in a language read from the right too.
      expect(startingName).not.toContain(FIRST_STRONG_ISOLATE);
      expect(startingName).not.toContain(POP_DIRECTIONAL_ISOLATE);

      if (language === "en") {
        expect(startingName).toBe("Acme Status");
      } else {
        // In the reader's language: not the English a server without one writes.
        expect(startingName).not.toBe("Acme Status");
        expect(startingName).toContain("Acme");
      }
    },
  );
});

/*
 * THE SAME DECISION OF WHO IS TOLD, FOR THE SAME PROJECT (#8518). The
 * website-down guided setup (WebsiteDownApi.loadWhoIsToldFacts) and Ask
 * AI's set_up_paging (SetupTools' readPagingCounts) each ask whether the
 * project pages people already. Only what pages people counts in both: a
 * policy in service (#8234), and an on-call rule that runs one (#8433). The
 * project is one database here, read by both: the browser through the
 * model API, the server through the services, each answering as the real
 * ones do - only what the query matches, each rule with its policies.
 */
describe("the same decision of who is told, for the same project (#8518)", () => {
  interface Shape {
    name: string;
    policies: Array<boolean>;
    incidentRules: Array<Array<boolean>>;
    alertRules: Array<Array<boolean>>;
    pagesAlready: boolean;
  }

  const SHAPES: Array<Shape> = [
    {
      name: "a new project",
      policies: [],
      incidentRules: [],
      alertRules: [],
      pagesAlready: false,
    },
    {
      name: "its only policy archived, with the two rules that run it",
      policies: [true],
      incidentRules: [[true]],
      alertRules: [[true]],
      pagesAlready: false,
    },
    {
      name: "rules that run no policy",
      policies: [],
      incidentRules: [[]],
      alertRules: [[]],
      pagesAlready: false,
    },
    {
      name: "an archived policy beside one in service",
      policies: [true, false],
      incidentRules: [[true]],
      alertRules: [],
      pagesAlready: true,
    },
    {
      name: "a rule running a policy in service beside an archived one",
      policies: [true, false],
      incidentRules: [[true, false]],
      alertRules: [],
      pagesAlready: true,
    },
    {
      name: "a policy in service and no rule",
      policies: [false],
      incidentRules: [],
      alertRules: [],
      pagesAlready: true,
    },
  ];

  const policiesOf: (archived: Array<boolean>) => Array<OnCallDutyPolicy> = (
    archived: Array<boolean>,
  ): Array<OnCallDutyPolicy> => {
    return archived.map((isArchived: boolean): OnCallDutyPolicy => {
      return model(OnCallDutyPolicy, {
        _id: ObjectID.generate().toString(),
        isArchived: isArchived,
      });
    });
  };

  const rulesOf: <T>(
    type: { new (): T },
    rules: Array<Array<boolean>>,
  ) => Array<T> = <T>(
    type: { new (): T },
    rules: Array<Array<boolean>>,
  ): Array<T> => {
    return rules.map((archived: Array<boolean>): T => {
      return model(type, {
        _id: ObjectID.generate().toString(),
        onCallDutyPolicies: policiesOf(archived),
      });
    });
  };

  // How many of the project's policies a query matches, as a count does.
  const matching: (
    archived: Array<boolean>,
    query: Record<string, unknown>,
  ) => number = (
    archived: Array<boolean>,
    query: Record<string, unknown>,
  ): number => {
    return archived.filter((isArchived: boolean): boolean => {
      return !("isArchived" in query) || query["isArchived"] === isArchived;
    }).length;
  };

  test.each(SHAPES)("$name: both decide alike", async (shape: Shape) => {
    // The browser's reads.
    jest.spyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    jest.spyOn(ModelAPI, "count").mockImplementation((async (args: {
      query: Record<string, unknown>;
    }): Promise<number> => {
      return matching(shape.policies, args.query);
    }) as never);
    getListSpy.mockImplementation((async (args: {
      modelType: { new (): unknown };
    }) => {
      if (args.modelType === IncidentOnCallRule) {
        return list(rulesOf(IncidentOnCallRule, shape.incidentRules));
      }

      if (args.modelType === AlertOnCallRule) {
        return list(rulesOf(AlertOnCallRule, shape.alertRules));
      }

      return list([]);
    }) as unknown as (...args: Array<never>) => Promise<unknown>);

    // The server's.
    jest
      .spyOn(OnCallDutyPolicyService, "countBy")
      .mockImplementation((async (args: {
        query: Record<string, unknown>;
      }): Promise<PositiveNumber> => {
        return new PositiveNumber(matching(shape.policies, args.query));
      }) as never);
    jest
      .spyOn(IncidentOnCallRuleService, "findBy")
      .mockResolvedValue(
        rulesOf(IncidentOnCallRule, shape.incidentRules) as never,
      );
    jest
      .spyOn(AlertOnCallRuleService, "findBy")
      .mockResolvedValue(rulesOf(AlertOnCallRule, shape.alertRules) as never);

    const guidedSetup: WhoIsToldMode = getWhoIsToldMode(
      await WebsiteDownApi.loadWhoIsToldFacts(),
    );
    const askAi: { toldModel: string } | null =
      await SetUpPagingTool.checkBeforeApproval!({ userIds: [USER_ID] }, ctx);

    expect({
      guidedSetup: guidedSetup,
      askAiPagesAlready: Boolean(
        askAi?.toldModel.includes("already pages people"),
      ),
    }).toEqual({
      guidedSetup: shape.pagesAlready
        ? WhoIsToldMode.ExistingPolicy
        : WhoIsToldMode.CreatePolicy,
      askAiPagesAlready: shape.pagesAlready,
    });

    // Where the project pages nobody, nothing else stood in Ask AI's way.
    if (!shape.pagesAlready) {
      expect(askAi).toBeNull();
    }
  });
});

/*
 * #7244, #7242, #7243: the guided on-call setup's levels, repeats and
 * people added, its invitation, and the telemetry guided setup's monitors
 * - each built with Common's records by both ways in - are the same records
 * for the same answers.
 */
describe("what happens when nobody acknowledges, who else is on call, an invitation and a service's monitor are the guided setups' records", () => {
  const POLICY: string = "70707070-7070-4070-8070-707070707070";
  const FIRST_LEVEL: string = "71717171-7171-4171-8171-717171717171";
  const ANA: string = "72727272-7272-4272-8272-727272727272";
  const MEMBERS_TEAM: string = "73737373-7373-4373-8373-737373737373";
  const OWNERS_TEAM: string = "74747474-7474-4474-8474-747474747474";
  const SERVICE: string = "75757575-7575-4575-8575-757575757575";

  // The guided setup's view of the policy's first level, waiting 30 minutes.
  const firstLevel: {
    id: string;
    order: number;
    escalateAfterInMinutes: number;
    userIds: Array<string>;
    names: Array<string>;
    responderCount: number;
  } = {
    id: FIRST_LEVEL,
    order: 1,
    escalateAfterInMinutes: DEFAULT_ESCALATE_AFTER_IN_MINUTES,
    userIds: [USER_ID],
    names: ["Me"],
    responderCount: 1,
  };

  // A project that pages nobody yet, whose first policy Ask AI makes.
  function newPolicy(): void {
    jest
      .spyOn(OnCallDutyPolicyService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
    jest
      .spyOn(IncidentOnCallRuleService, "findBy")
      .mockResolvedValue([] as never);
    jest.spyOn(AlertOnCallRuleService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(OnCallDutyPolicyService, "create")
      .mockImplementation((async (args: {
        data: OnCallDutyPolicy;
      }): Promise<OnCallDutyPolicy> => {
        return model(OnCallDutyPolicy, { ...args.data, _id: POLICY });
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "findOneBy")
      .mockResolvedValue(
        model(OnCallDutyPolicyEscalationRule, {
          _id: FIRST_LEVEL,
          escalateAfterInMinutes: DEFAULT_ESCALATE_AFTER_IN_MINUTES,
        }) as never,
      );
  }

  test("someone else after a wait: the first level's wait and a second level, as the guided on-call setup writes them", async () => {
    const browserUpdate: LooseSpy = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as never) as unknown as LooseSpy;
    createSpy.mockClear();

    await OnCallSetupApi.addSecondLevel({
      policyId: POLICY,
      firstLevel: firstLevel,
      waitMinutes: 5,
      userIds: [ANA],
      teamIds: [TEAM_ID],
    });

    const guidedWait: { id: ObjectID; data: JSONObject } = browserUpdate.mock
      .calls[0]![0] as unknown as { id: ObjectID; data: JSONObject };
    const guidedLevel: { model: unknown; miscDataProps?: unknown } =
      browserCreates()[0]!;

    newPolicy();
    const serverWait: LooseSpy = jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as LooseSpy;
    const serverLevel: LooseSpy = jest
      .spyOn(OnCallDutyPolicyEscalationRuleService, "create")
      .mockResolvedValue({} as never) as unknown as LooseSpy;

    await SetUpPagingTool.execute(
      {
        userIds: [USER_ID],
        escalateUserIds: [ANA],
        escalateTeamIds: [TEAM_ID],
        escalatePeople: ["Ana Lopez"],
        escalateTeamNames: ["Platform"],
        afterMinutes: 5,
      },
      ctx,
    );

    const askAiWait: { id: ObjectID; data: JSONObject } = serverWait.mock
      .calls[0]![0] as unknown as { id: ObjectID; data: JSONObject };
    const askAiLevel: { data: unknown; miscDataProps: unknown } = serverLevel
      .mock.calls[0]![0] as unknown as {
      data: unknown;
      miscDataProps: unknown;
    };

    expect(askAiWait.id.toString()).toBe(guidedWait.id.toString());
    expect(askAiWait.data).toEqual(guidedWait.data);
    expect(comparable(askAiLevel.data)).toEqual(comparable(guidedLevel.model));
    expect(askAiLevel.miscDataProps).toEqual(guidedLevel.miscDataProps);
  });

  test("the same people again: the policy's repeat, as the guided on-call setup writes it", async () => {
    const browserUpdate: LooseSpy = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as never) as unknown as LooseSpy;

    // The wait asked is the first level's already: only the repeat is written.
    await OnCallSetupApi.setRepeat({
      policyId: POLICY,
      firstLevel: firstLevel,
      waitMinutes: DEFAULT_ESCALATE_AFTER_IN_MINUTES,
      times: 2,
    });

    expect(browserUpdate).toHaveBeenCalledTimes(1);
    const guidedRepeat: { id: ObjectID; data: JSONObject } = browserUpdate.mock
      .calls[0]![0] as unknown as { id: ObjectID; data: JSONObject };

    newPolicy();
    const serverWait: LooseSpy = jest.spyOn(
      OnCallDutyPolicyEscalationRuleService,
      "updateOneById",
    ) as unknown as LooseSpy;
    const serverRepeat: LooseSpy = jest
      .spyOn(OnCallDutyPolicyService, "updateOneById")
      .mockResolvedValue(undefined as never) as unknown as LooseSpy;

    await SetUpPagingTool.execute({ userIds: [USER_ID], repeatTimes: 2 }, ctx);

    expect(serverWait).not.toHaveBeenCalled();
    const askAiRepeat: { id: ObjectID; data: JSONObject } = serverRepeat.mock
      .calls[0]![0] as unknown as { id: ObjectID; data: JSONObject };
    expect(askAiRepeat.id.toString()).toBe(guidedRepeat.id.toString());
    expect(askAiRepeat.data).toEqual(guidedRepeat.data);
  });

  test("people added to a policy's first level: the rows Who else is on call adds", async () => {
    createSpy.mockClear();
    createSpy.mockResolvedValue({ data: {} } as never);

    await OnCallSetupApi.addToFirstLevel({
      policyId: POLICY,
      firstLevelId: FIRST_LEVEL,
      userIds: [ANA],
      teamIds: [TEAM_ID],
    });

    const [guidedUser, guidedTeam]: Array<{ model: unknown }> =
      browserCreates();

    const serverUser: LooseSpy = jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "create")
      .mockResolvedValue({} as never) as unknown as LooseSpy;
    const serverTeam: LooseSpy = jest
      .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "create")
      .mockResolvedValue({} as never) as unknown as LooseSpy;

    await AddToOnCallPolicyTool.execute(
      {
        policyId: POLICY,
        policyName: "Payments on-call",
        ruleId: FIRST_LEVEL,
        ruleName: "Level 1",
        userIds: [ANA],
        teamIds: [TEAM_ID],
        people: ["Ana Lopez"],
        teamNames: ["Platform"],
      },
      ctx,
    );

    expect(
      comparable(
        (serverUser.mock.calls[0]![0] as unknown as { data: unknown }).data,
      ),
    ).toEqual(comparable(guidedUser!.model));
    expect(
      comparable(
        (serverTeam.mock.calls[0]![0] as unknown as { data: unknown }).data,
      ),
    ).toEqual(comparable(guidedTeam!.model));
  });

  test("an invitation is the guided setup's and Invite User's: the members team, by address", async () => {
    // The project's teams, as both ways in read them, both handed on.
    const teams: Array<Team> = [
      model(Team, { _id: OWNERS_TEAM, name: "Owners" }),
      model(Team, { _id: MEMBERS_TEAM, name: "Members" }),
    ];
    const rows: Array<TeamPermission> = [
      model(TeamPermission, {
        teamId: new ObjectID(OWNERS_TEAM),
        permission: Permission.ProjectOwner,
        isBlockPermission: false,
      }),
      model(TeamPermission, {
        teamId: new ObjectID(MEMBERS_TEAM),
        permission: Permission.ProjectMember,
        isBlockPermission: false,
      }),
    ];
    getListSpy.mockImplementation((async (args: {
      modelType: { new (): unknown };
    }) => {
      if (args.modelType === Team) {
        return list(teams);
      }

      if (args.modelType === TeamPermission) {
        return list(rows);
      }

      return list([]);
    }) as unknown as (...args: Array<never>) => Promise<unknown>);
    jest
      .spyOn(GrantablePermission, "canCurrentUserGrantAll")
      .mockReturnValue(true as never);
    createSpy.mockClear();
    createSpy.mockResolvedValue({
      data: { id: ObjectID.generate(), userId: ObjectID.generate() },
    } as never);

    await OnCallSetupApi.inviteByEmail("ana@acme.example");

    const guided: { model: unknown; miscDataProps?: unknown } =
      browserCreates()[0]!;

    // Ask AI picks the team the same way, as the person, then invites.
    jest.spyOn(TeamService, "findBy").mockResolvedValue(teams as never);
    jest
      .spyOn(TeamPermissionService, "findBy")
      .mockResolvedValue(rows as never);
    jest
      .spyOn(TeamPermissionService, "findTeamsCallerCannotGrant")
      .mockResolvedValue([] as never);
    jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(ServerSendingStatus, "canSendEmailPublicly")
      .mockResolvedValue(true as never);
    const invite: LooseSpy = jest
      .spyOn(TeamMemberService, "create")
      .mockResolvedValue({} as never) as unknown as LooseSpy;

    const prepared: { arguments: JSONObject } =
      await InvitePeopleTool.prepareMutation!(
        { emails: ["ana@acme.example"] },
        ctx,
      );
    await InvitePeopleTool.execute(prepared.arguments, ctx);

    const askAi: { data: unknown; miscDataProps: unknown } = invite.mock
      .calls[0]![0] as unknown as { data: unknown; miscDataProps: unknown };

    expect(prepared.arguments["teamId"]).toBe(MEMBERS_TEAM);
    expect(comparable(askAi.data)).toEqual(comparable(guided.model));
    expect(askAi.miscDataProps).toEqual(guided.miscDataProps);
  });

  test("a service's recommended monitor is the telemetry guided setup's, for the same service and the same first data", async () => {
    const createOrUpdate: LooseSpy = jest
      .spyOn(ModelAPI, "createOrUpdate")
      .mockResolvedValue({
        data: { id: new ObjectID(MONITOR_ID) },
      } as never) as unknown as LooseSpy;
    const recommendations: ReturnType<typeof getTelemetryRecommendations> =
      getTelemetryRecommendations(null);
    const errorBurst: (typeof recommendations)[number] = recommendations.find(
      (recommendation: { templateId: string }): boolean => {
        return recommendation.templateId === "service-error-burst";
      },
    )!;

    await TelemetrySetupApi.createMonitors({
      service: { id: SERVICE, name: "checkout", hasReported: true },
      recommendations: recommendations,
      recommendationIds: [errorBurst.recommendationId],
      hasAcknowledgedBilling: true,
      translator: dashboardTranslator("en"),
    });

    const guided: { model: unknown; miscDataProps: unknown } = createOrUpdate
      .mock.calls[0]![0] as unknown as {
      model: unknown;
      miscDataProps: unknown;
    };

    jest.spyOn(ServiceService, "findOneBy").mockResolvedValue(
      model(Service, {
        _id: SERVICE,
        name: "checkout",
        lastSeenAt: new Date(),
      }) as never,
    );
    // No first data known: the guided setup's three, both ways.
    jest
      .spyOn(ProjectMilestoneService, "findBy")
      .mockResolvedValue([] as never);
    jest.spyOn(MonitorService, "findBy").mockResolvedValue([] as never);
    const serverCreate: LooseSpy = jest
      .spyOn(MonitorService, "create")
      .mockImplementation((async (args: {
        data: Monitor;
      }): Promise<Monitor> => {
        return model(Monitor, { ...args.data, _id: MONITOR_ID });
      }) as never) as unknown as LooseSpy;

    await SetUpServiceMonitorTool.execute(
      { service: "checkout", monitor: "errors" },
      ctx,
    );

    const askAi: { data: unknown; miscDataProps: unknown } = serverCreate.mock
      .calls[0]![0] as unknown as { data: unknown; miscDataProps: unknown };

    expect(comparable(askAi.data)).toEqual(comparable(guided.model));
    expect(askAi.miscDataProps).toEqual(guided.miscDataProps);
  });
});
