// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import {
  act,
  cleanup,
  render,
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import React, { FunctionComponent } from "react";
import { initReactI18next } from "react-i18next";

/*
 * A MONITOR'S TYPE (#8294) AND A SECURITY EVENT'S SEVERITY (#8295) READ IN
 * THE READER'S LANGUAGE WHEREVER THEY ARE DRAWN AS TEXT.
 *
 * Home's Needs attention and the Monitor List widget (its Type column and a
 * honeycomb tile's tooltip) drew a monitor's stored type - "SSL
 * Certificate", "Server" - where the Monitors list draws the type picker's
 * title in the reader's words: "SSL-Zertifikat", "Server / VM". The
 * Security Events list and flow widgets drew OCSF's severity as stored -
 * "High" - where the Security Events page's severity pill says "Alta". Each
 * is drawn here in English, German, Spanish, Arabic and Persian, from the
 * Dashboard's own locale files.
 */

type ListRequest = { query: Record<string, unknown>; limit: number };
type ListResponse = { data: Array<Record<string, unknown>>; count: number };

const listMock: Mock<(request: ListRequest) => Promise<ListResponse>> =
  jest.fn<(request: ListRequest) => Promise<ListResponse>>();
const analyticsListMock: Mock<(request: ListRequest) => Promise<ListResponse>> =
  jest.fn<(request: ListRequest) => Promise<ListResponse>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: ListRequest) => {
        return listMock(request);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: ListRequest) => {
        return analyticsListMock(request);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("44444444-4444-4444-8444-444444444444");
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: { children: React.ReactNode }) => {
        return React.createElement("a", {}, props.children);
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap", () => {
  return {
    __esModule: true,
    default: {},
    RouteUtil: {
      populateRouteParams: () => {
        return {
          toString: () => {
            return "/dashboard/resource";
          },
        };
      },
    },
  };
});

import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import DashboardMonitorListComponentElement, {
  getMonitorListTypeText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardMonitorListComponent";
import DashboardSecurityEventsListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSecurityEventsListComponent";
import {
  buildSecurityEventsFlow,
  getSecurityEventSeverityText,
  getSecurityEventsFlowInLanguage,
  SecurityEventsFlowData,
  SecurityEventsFlowNode,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/SecurityEventsWidgetData";
import { HomeOverviewData } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HomeOverviewData";
import {
  AttentionGroup,
  AttentionGroupKey,
  getAttentionGroups,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/NeedsAttention";
import { getMonitorTypeTitleInLanguage } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTypeTitle";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import TimeRange from "../../../Types/Time/TimeRange";
import { Translator } from "../../../Types/Translator";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

const DRAWN: ReadonlyArray<string> = ["en", "de", "es", "ar", "fa"];

const COMPONENT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000008294",
);

// A word as `language` writes it.
const wordIn: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  return readDashboardLocale(language)[english] || english;
};

const monitorOf: (type: MonitorType | undefined) => Monitor = (
  type: MonitorType | undefined,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = ObjectID.generate().toString();
  monitor.name = "checkout-api";

  if (type) {
    monitor.monitorType = type;
  }

  return monitor;
};

const overviewWith: (monitors: Array<Monitor>) => HomeOverviewData = (
  monitors: Array<Monitor>,
): HomeOverviewData => {
  return {
    activeIncidents: { items: [], count: 0 },
    activeAlerts: { items: [], count: 0 },
    notOperationalMonitors: { items: monitors, count: monitors.length },
    ongoingMaintenance: { items: [], count: 0 },
    slosNeedingAttention: { items: [], count: 0 },
    totalMonitors: monitors.length,
    totalSlos: 0,
  };
};

const subtitlesIn: (
  language: string,
  monitors: Array<Monitor>,
) => Array<string | undefined> = (
  language: string,
  monitors: Array<Monitor>,
): Array<string | undefined> => {
  const group: AttentionGroup | undefined = getAttentionGroups(
    overviewWith(monitors),
    dashboardTranslator(language),
  ).find((candidate: AttentionGroup): boolean => {
    return candidate.key === AttentionGroupKey.Monitors;
  });

  return (group?.rows || []).map((row: { subtitle?: string | undefined }) => {
    return row.subtitle;
  });
};

type WidgetElement = FunctionComponent<
  DashboardBaseComponentProps & { component: DashboardBaseComponent }
>;

const propsOf: (
  type: DashboardComponentType,
) => DashboardBaseComponentProps & { component: DashboardBaseComponent } = (
  type: DashboardComponentType,
): DashboardBaseComponentProps & { component: DashboardBaseComponent } => {
  return {
    componentId: COMPONENT_ID,
    key: COMPONENT_ID.toString(),
    isEditMode: false,
    isSelected: false,
    onComponentUpdate: (): void => {
      // A list never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1280,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1280,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig: {
      _type: ObjectType.DashboardViewConfig,
      components: [],
      heightInDashboardUnits: 12,
    },
    dashboardStartAndEndDate: { range: TimeRange.PAST_ONE_HOUR },
    metricTypes: [],
    refreshTick: 0,
    variables: [],
    dashboardId: "d0000000-0000-4000-8000-000000008294",
    component: {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: type,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      minWidthInDashboardUnits: 4,
      minHeightInDashboardUnits: 3,
      arguments: { viewMode: "list", title: "Fleet" },
    } as unknown as DashboardBaseComponent,
  };
};

const draw: (
  element: WidgetElement,
  type: DashboardComponentType,
  named: string,
) => Promise<RenderResult> = async (
  element: WidgetElement,
  type: DashboardComponentType,
  named: string,
): Promise<RenderResult> => {
  const Element: WidgetElement = element;
  const result: RenderResult = render(<Element {...propsOf(type)} />);

  await waitFor(() => {
    expect(result.container.textContent || "").toContain(named);
  });

  return result;
};

const inLanguage: (language: string) => Promise<void> = async (
  language: string,
): Promise<void> => {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
};

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of DRAWN) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  listMock.mockReset();
  analyticsListMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("a monitor's type (#8294)", () => {
  test("German, Arabic and Persian word the types this test leans on", () => {
    for (const language of ["de", "ar", "fa"]) {
      expect(wordIn(language, "SSL Certificate")).not.toBe("SSL Certificate");
    }

    // German keeps "Server / VM" as it is; Arabic and Persian word it.
    for (const language of ["ar", "fa"]) {
      expect(wordIn(language, "Server / VM")).not.toBe("Server / VM");
    }
  });

  test.each(DRAWN)(
    "%s: Needs attention names a monitor's type by the picker's title, in the reader's words",
    (language: string) => {
      expect(
        subtitlesIn(language, [
          monitorOf(MonitorType.SSLCertificate),
          monitorOf(MonitorType.Server),
          monitorOf(undefined),
        ]),
      ).toEqual([
        wordIn(language, "SSL Certificate"),
        wordIn(language, "Server / VM"),
        undefined,
      ]);
    },
  );

  test("in English, the picker's title, never the stored value", () => {
    expect(subtitlesIn("en", [monitorOf(MonitorType.Server)])).toEqual([
      "Server / VM",
    ]);
    expect(subtitlesIn("de", [monitorOf(MonitorType.SSLCertificate)])).toEqual([
      "SSL-Zertifikat",
    ]);
  });

  test("the Monitor List widget's type keeps its dash for a monitor with none", () => {
    expect(
      getMonitorListTypeText(monitorOf(undefined), dashboardTranslator("de")),
    ).toBe("—");
    expect(
      getMonitorListTypeText(
        monitorOf(MonitorType.Database),
        dashboardTranslator("en"),
      ),
    ).toBe("Database Health");
  });

  test("every type reads one way wherever it is named as text", () => {
    const translator: Translator = dashboardTranslator("de");

    for (const type of Object.values(MonitorType)) {
      expect(getMonitorListTypeText(monitorOf(type), translator)).toBe(
        getMonitorTypeTitleInLanguage(type, translator),
      );
    }
  });

  test.each(DRAWN)(
    "%s: the Monitor List widget's Type column",
    async (language: string) => {
      listMock.mockResolvedValue({
        data: [
          {
            _id: ObjectID.generate().toString(),
            name: "checkout-api",
            monitorType: MonitorType.SSLCertificate,
            currentMonitorStatus: { name: "Operational" },
          },
        ],
        count: 1,
      });
      await inLanguage(language);

      const result: RenderResult = await draw(
        DashboardMonitorListComponentElement as unknown as WidgetElement,
        DashboardComponentType.MonitorList,
        "checkout-api",
      );

      const cells: Array<string> = Array.from(
        result.container.querySelectorAll("tbody td"),
      ).map((cell: Element): string => {
        return (cell.textContent || "").trim();
      });

      expect(cells).toContain(wordIn(language, "SSL Certificate"));

      if (language !== "en") {
        expect(cells).not.toContain("SSL Certificate");
      }
    },
  );
});

describe("a security event's severity (#8295)", () => {
  test("Spanish, German, Arabic and Persian word OCSF's severities", () => {
    expect(wordIn("es", "High")).toBe("Alta");

    for (const language of ["de", "ar", "fa"]) {
      expect(wordIn(language, "High")).not.toBe("High");
    }
  });

  test.each(DRAWN)(
    "%s: the widgets say an event's severity as the Security Events page does",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const severity of Object.values(OcsfSeverity)) {
        expect(getSecurityEventSeverityText(severity, translator)).toBe(
          translator.translateText(severity) || severity,
        );
      }

      // A word OCSF does not have reads as stored.
      expect(getSecurityEventSeverityText("Sev-9", translator)).toBe("Sev-9");
    },
  );

  test("the flow's severity layer reads in the reader's words, its colour from OCSF's stored word", () => {
    const flow: SecurityEventsFlowData = buildSecurityEventsFlow([
      {
        vendorName: "CrowdStrike",
        className: "Authentication",
        severityName: "High",
      },
      {
        vendorName: "CrowdStrike",
        className: "Authentication",
        severityName: "Low",
      },
    ]);

    // Only the severity layer carries OCSF's word.
    expect(
      flow.nodes.map((node: SecurityEventsFlowNode) => {
        return node.severityName;
      }),
    ).toEqual([undefined, undefined, "High", "Low"]);

    const spanish: SecurityEventsFlowData = getSecurityEventsFlowInLanguage(
      flow,
      dashboardTranslator("es"),
    );

    expect(
      spanish.nodes.map((node: SecurityEventsFlowNode) => {
        return node.name;
      }),
    ).toEqual(["CrowdStrike", "Authentication", "Alta", wordIn("es", "Low")]);
    expect(spanish.nodes[2]!.severityName).toBe("High");
    expect(spanish.links).toEqual(flow.links);

    // English draws the flow as it always did.
    expect(
      getSecurityEventsFlowInLanguage(flow, dashboardTranslator("en")).nodes,
    ).toEqual(flow.nodes);
  });

  test.each(DRAWN)(
    "%s: the Security Events list widget's severity cell and its title",
    async (language: string) => {
      analyticsListMock.mockResolvedValue({
        data: [
          {
            time: "2026-11-12T10:00:00.000Z",
            severityName: "High",
            className: "Authentication",
            message: "Failed login for root",
            principalHost: "bastion-1",
          },
        ],
        count: 1,
      });
      await inLanguage(language);

      const result: RenderResult = await draw(
        DashboardSecurityEventsListComponentElement as unknown as WidgetElement,
        DashboardComponentType.SecurityEventsList,
        "Failed login for root",
      );

      const severityCell: Element | undefined = Array.from(
        result.container.querySelectorAll("tbody td"),
      ).find((cell: Element): boolean => {
        return (
          (cell.textContent || "").trim() === wordIn(language, "High") &&
          cell.getAttribute("title") !== null
        );
      });

      expect(severityCell).toBeDefined();
      expect(severityCell!.getAttribute("title")).toBe(
        wordIn(language, "High"),
      );

      if (language !== "en") {
        expect(screen.queryByText("High")).toBeNull();
      }
    },
  );
});
