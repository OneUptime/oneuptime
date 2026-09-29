import { getRouteForCitationTarget } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationTargetNav";
import { describeCitationTargetPage } from "../../../../App/FeatureSet/Dashboard/src/Utils/InvestigationEvidenceFormat";
import { AIChatCitationTargetType } from "../../../Types/AI/AIChatTypes";
import { AIResourceType } from "../../../Types/AI/AIResourceContext";
import ProjectUtil from "../../../UI/Utils/Project";
import PageContextUtil, {
  DashboardPageContext,
  SuggestedQuestion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/PageContext";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import RouteParams from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteParams";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import Service from "../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import AIChatPageContextType, {
  AIChatPageContextHelper,
} from "../../../Types/AI/AIChatPageContext";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const ENTITY_ID: string = "20000000-0000-4000-8000-000000000002";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

function navigateTo(pathname: string): void {
  Navigation.setLocation({
    pathname,
    search: "",
    hash: "",
    state: null,
    key: "ai-insights-test",
  });
}

function contextFor(
  type: AIChatPageContextType,
  entityId?: string,
): DashboardPageContext {
  return {
    type,
    ...([
      AIChatPageContextType.Resource,
      AIChatPageContextType.ResourcesList,
    ].includes(type)
      ? { resourceType: AIResourceType.Host }
      : {}),
    entityId,
    noun: "application",
    chipLabel: "This application",
    icon: IconProp.AltGlobe,
    isEntity: Boolean(entityId),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AI Insights page detection", () => {
  test.each([
    "",
    "/metrics",
    "/logs",
    "/traces",
    "/clients",
    "/recommendations",
    "/settings",
    "/session-replay",
    `/session-replay/${TRACE_ID}`,
  ])(
    "keeps the RUM application context on its %s subpage",
    (suffix: string) => {
      navigateTo(`/dashboard/${PROJECT_ID}/rum/${ENTITY_ID}${suffix}`);

      expect(PageContextUtil.detectPageContext()).toEqual({
        type: AIChatPageContextType.RumApplication,
        entityId: ENTITY_ID,
        noun: "RUM application",
        chipLabel: "This RUM application",
        icon: IconProp.AltGlobe,
        isEntity: true,
      });
    },
  );

  test.each(["", "/", "/new", "/invalid-id", "/applications"])(
    "uses the RUM applications area when %s has no valid application id",
    (suffix: string) => {
      navigateTo(`/dashboard/${PROJECT_ID}/rum${suffix}`);

      expect(PageContextUtil.detectPageContext()).toEqual({
        type: AIChatPageContextType.RumApplications,
        noun: "RUM applications",
        chipLabel: "RUM applications",
        icon: IconProp.AltGlobe,
        isEntity: false,
      });
    },
  );

  test("uses the services area on the services landing page", () => {
    navigateTo(`/dashboard/${PROJECT_ID}/service`);

    expect(PageContextUtil.detectPageContext()).toEqual({
      type: AIChatPageContextType.TelemetryServicesList,
      noun: "services",
      chipLabel: "Services",
      icon: IconProp.SquareStack,
      isEntity: false,
    });
  });

  test.each([
    [PageMap.INCIDENT_VIEW, AIChatPageContextType.Incident, ENTITY_ID],
    [PageMap.ALERT_VIEW, AIChatPageContextType.Alert, ENTITY_ID],
    [PageMap.MONITOR_VIEW, AIChatPageContextType.Monitor, ENTITY_ID],
    [
      PageMap.SCHEDULED_MAINTENANCE_VIEW,
      AIChatPageContextType.ScheduledMaintenanceEvent,
      ENTITY_ID,
    ],
    [PageMap.SERVICE_VIEW, AIChatPageContextType.TelemetryService, ENTITY_ID],
    [PageMap.TRACE_VIEW, AIChatPageContextType.Trace, TRACE_ID],
    [PageMap.EXCEPTIONS_VIEW, AIChatPageContextType.Exception, ENTITY_ID],
  ] as Array<[PageMap, AIChatPageContextType, string]>)(
    "preserves existing entity detection for %s, including nested pages",
    (page: PageMap, type: AIChatPageContextType, id: string) => {
      const path: string = RouteMap[page]!.toString()
        .replace(RouteParams.ProjectID, PROJECT_ID)
        .replace(RouteParams.ModelID, id);

      for (const suffix of ["", "/details"]) {
        navigateTo(path + suffix);
        expect(PageContextUtil.detectPageContext()).toMatchObject({
          type,
          entityId: id,
          isEntity: true,
        });
      }
    },
  );

  test.each([
    ["monitors", AIChatPageContextType.MonitorsList],
    ["monitors/inoperational", AIChatPageContextType.MonitorsList],
    ["incidents", AIChatPageContextType.IncidentsList],
    ["incidents/unresolved", AIChatPageContextType.IncidentsList],
    ["logs", AIChatPageContextType.LogsExplorer],
    ["logs/saved-queries", AIChatPageContextType.LogsExplorer],
    ["traces", AIChatPageContextType.TracesExplorer],
    ["traces/invalid-trace-id", AIChatPageContextType.TracesExplorer],
    ["metrics", AIChatPageContextType.MetricsExplorer],
    ["exceptions/unresolved", AIChatPageContextType.ExceptionsList],
    ["service/new", AIChatPageContextType.TelemetryServicesList],
  ] as Array<[string, AIChatPageContextType]>)(
    "detects %s as an area without capturing static route segments as ids",
    (path: string, type: AIChatPageContextType) => {
      navigateTo(`/dashboard/${PROJECT_ID}/${path}`);

      expect(PageContextUtil.detectPageContext()).toMatchObject({
        type,
        isEntity: false,
      });
      expect(PageContextUtil.detectPageContext()).not.toHaveProperty(
        "entityId",
      );
    },
  );

  test.each(["", "/rum", "/settings", "/rum-other", "/services-other"])(
    "does not infer context for unrelated path %s",
    (path: string) => {
      navigateTo(path === "/rum" ? path : `/dashboard/${PROJECT_ID}${path}`);
      expect(PageContextUtil.detectPageContext()).toBeNull();
    },
  );

  test("fails safely when navigation cannot be read", () => {
    jest.spyOn(Navigation, "getCurrentRoute").mockImplementation(() => {
      throw new Error("Navigation has not initialized");
    });

    expect(PageContextUtil.detectPageContext()).toBeNull();
  });
});

describe("AI Insights entity titles", () => {
  test("loads the RUM application name using its validated id", async () => {
    const application: RumApplication = new RumApplication();
    application.name = "Checkout browser";
    const getItem: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValue(application);

    expect(
      await PageContextUtil.resolveEntityTitle(
        contextFor(AIChatPageContextType.RumApplication, ENTITY_ID),
      ),
    ).toBe("Checkout browser");
    expect(getItem).toHaveBeenCalledWith({
      modelType: RumApplication,
      id: new ObjectID(ENTITY_ID),
      select: { name: true },
    });
  });

  test.each([null, new RumApplication()])(
    "falls back to the generic label for a missing name or record (%p)",
    async (application: RumApplication | null) => {
      jest.spyOn(ModelAPI, "getItem").mockResolvedValue(application);

      expect(
        await PageContextUtil.resolveEntityTitle(
          contextFor(AIChatPageContextType.RumApplication, ENTITY_ID),
        ),
      ).toBeNull();
    },
  );

  test("falls back to the generic label when the user cannot read an application", async () => {
    jest
      .spyOn(ModelAPI, "getItem")
      .mockRejectedValue(new Error("Read access denied"));

    expect(
      await PageContextUtil.resolveEntityTitle(
        contextFor(AIChatPageContextType.RumApplication, ENTITY_ID),
      ),
    ).toBeNull();
  });

  test.each([
    contextFor(AIChatPageContextType.RumApplications),
    contextFor(AIChatPageContextType.TelemetryServicesList),
    contextFor(AIChatPageContextType.RumApplication),
    contextFor(AIChatPageContextType.RumApplication, "settings"),
    contextFor(AIChatPageContextType.RumApplication, TRACE_ID),
    contextFor(AIChatPageContextType.Trace, TRACE_ID),
  ])(
    "does not fetch a title for an area or invalid record context: %p",
    async (context: DashboardPageContext) => {
      const getItem: ReturnType<typeof jest.spyOn> = jest.spyOn(
        ModelAPI,
        "getItem",
      );
      expect(await PageContextUtil.resolveEntityTitle(context)).toBeNull();
      expect(getItem).not.toHaveBeenCalled();
    },
  );

  test("preserves titles for every existing supported entity model", async () => {
    const incident: Incident = new Incident();
    incident.title = "Checkout unavailable";
    incident.incidentNumber = 42;
    const alert: Alert = new Alert();
    alert.title = "Elevated errors";
    alert.alertNumber = 7;
    const monitor: Monitor = new Monitor();
    monitor.name = "Checkout API";
    const maintenance: ScheduledMaintenance = new ScheduledMaintenance();
    maintenance.title = "Database upgrade";
    const service: Service = new Service();
    service.name = "Checkout service";
    const exception: TelemetryException = new TelemetryException();
    exception.message = "Request failed";
    exception.exceptionType = "TypeError";

    const cases: Array<{
      type: AIChatPageContextType;
      item:
        | Incident
        | Alert
        | Monitor
        | ScheduledMaintenance
        | Service
        | TelemetryException;
      title: string;
    }> = [
      {
        type: AIChatPageContextType.Incident,
        item: incident,
        title: "#42 Checkout unavailable",
      },
      {
        type: AIChatPageContextType.Alert,
        item: alert,
        title: "#7 Elevated errors",
      },
      {
        type: AIChatPageContextType.Monitor,
        item: monitor,
        title: "Checkout API",
      },
      {
        type: AIChatPageContextType.ScheduledMaintenanceEvent,
        item: maintenance,
        title: "Database upgrade",
      },
      {
        type: AIChatPageContextType.TelemetryService,
        item: service,
        title: "Checkout service",
      },
      {
        type: AIChatPageContextType.Exception,
        item: exception,
        title: "Request failed",
      },
    ];

    for (const { type, item, title } of cases) {
      jest.spyOn(ModelAPI, "getItem").mockResolvedValue(item);
      expect(
        await PageContextUtil.resolveEntityTitle(contextFor(type, ENTITY_ID)),
      ).toBe(title);
    }
  });
});

describe("AI Insights request context", () => {
  test("sends only the entity type, id and resolved title", () => {
    const context: DashboardPageContext = {
      ...contextFor(AIChatPageContextType.RumApplication, ENTITY_ID),
      entityTitle: "Checkout browser",
    };
    const payload: JSONObject = PageContextUtil.toRequestPayload(context);

    expect(payload).toEqual({
      type: AIChatPageContextType.RumApplication,
      entityId: ENTITY_ID,
      entityTitle: "Checkout browser",
    });
    expect(AIChatPageContextHelper.sanitize(payload)).toEqual(payload);
  });

  test("still sends a usable entity context when the title cannot be read", () => {
    expect(
      PageContextUtil.toRequestPayload(
        contextFor(AIChatPageContextType.RumApplication, ENTITY_ID),
      ),
    ).toEqual({
      type: AIChatPageContextType.RumApplication,
      entityId: ENTITY_ID,
    });
  });

  test.each([
    AIChatPageContextType.RumApplications,
    AIChatPageContextType.TelemetryServicesList,
    AIChatPageContextType.MonitorsList,
    AIChatPageContextType.LogsExplorer,
    AIChatPageContextType.TracesExplorer,
    AIChatPageContextType.IncidentsList,
  ])("sends only the type for the %s area", (type: AIChatPageContextType) => {
    const payload: JSONObject = PageContextUtil.toRequestPayload(
      contextFor(type),
    );

    expect(payload).toEqual({ type });
    expect(AIChatPageContextHelper.sanitize(payload)).toEqual(payload);
  });
});

describe("AI Insights suggested prompts", () => {
  test.each(Object.values(AIChatPageContextType))(
    "provides useful, distinct prompts for %s",
    (type: AIChatPageContextType) => {
      const suggestions: Array<SuggestedQuestion> =
        PageContextUtil.getSuggestions(contextFor(type));

      expect(suggestions).toHaveLength(4);
      expect(
        new Set(
          suggestions.map((item: SuggestedQuestion) => {
            return item.title;
          }),
        ).size,
      ).toBe(4);
      for (const item of suggestions) {
        expect(item.icon).toBeTruthy();
        expect(item.title.trim().length).toBeGreaterThan(0);
        expect(item.question.trim().length).toBeGreaterThan(20);
      }
    },
  );

  test.each([
    AIChatPageContextType.RumApplication,
    AIChatPageContextType.RumApplications,
  ])(
    "offers supported, bounded RUM analysis for %s",
    (type: AIChatPageContextType) => {
      const questions: string = PageContextUtil.getSuggestions(contextFor(type))
        .map((item: SuggestedQuestion): string => {
          return item.question;
        })
        .join(" ");

      expect(questions).toContain("LCP, INP and CLS");
      expect(questions).toContain("last 24 hours");
      expect(questions).toContain("previous 24 hours");
      expect(questions).toContain("slow browser requests and error spans");
      expect(questions).toContain("last 6 hours");
      expect(questions).toContain("connection status");
      expect(questions).not.toMatch(
        /unique visitors|page views|session replay/i,
      );
    },
  );

  test("returns no suggestions for an unknown context type", () => {
    expect(
      PageContextUtil.getSuggestions(
        contextFor("Unknown" as AIChatPageContextType),
      ),
    ).toEqual([]);
  });
});

describe("RUM citation destinations", () => {
  test("application citations link to the selected application in the current project", () => {
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
    expect(
      getRouteForCitationTarget({
        type: AIChatCitationTargetType.RumApplicationView,
        params: { rumApplicationId: ENTITY_ID },
      })?.toString(),
    ).toBe(`/dashboard/${PROJECT_ID}/rum/${ENTITY_ID}`);
    expect(
      describeCitationTargetPage(AIChatCitationTargetType.RumApplicationView),
    ).toBe("RUM application");
  });

  test("inventory citations link to the applications list", () => {
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
    expect(
      getRouteForCitationTarget({
        type: AIChatCitationTargetType.RumApplications,
      })?.toString(),
    ).toBe(`/dashboard/${PROJECT_ID}/rum`);
    expect(
      describeCitationTargetPage(AIChatCitationTargetType.RumApplications),
    ).toBe("RUM applications");
  });
});
