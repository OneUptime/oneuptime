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
import fs from "fs";
import path from "path";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import DashboardMonitorListComponentElement, {
  ComponentProps as MonitorListProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardMonitorListComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import { setPublicDashboardContext } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import PublicDashboardResourceListPolicy, {
  PublicDashboardResourceListPolicyResult,
} from "../../../Server/Utils/Dashboard/PublicDashboardResourceListPolicy";
import Includes from "../../../Types/BaseDatabase/Includes";
import { Gray500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import MonitorType from "../../../Types/Monitor/MonitorType";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import DashboardMonitorListComponentUtil from "../../../Utils/Dashboard/Components/DashboardMonitorListComponent";
import NotOperationalMonitorQuery from "../../../Utils/Monitor/NotOperationalMonitorQuery";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * THE MONITOR LIST WIDGET AND A MONITOR WHOSE MONITORING IS OFF (#6476).
 *
 * Nothing checks a monitor whose monitoring is turned off, so the status it
 * holds - "Offline", say - is only what its last check saw. The widget's
 * "non-operational" filter listed it beside the monitors that really are
 * down (and archived monitors too), "operational" listed one whose last
 * check was fine, and its row drew the frozen status as if it were live.
 *
 * Read through the real widget, as a dashboard draws it: the query it sends
 * for each stored setting - the same the public dashboard's policy builds on
 * the server from the same setting - and what its rows and honeycomb say of
 * such a monitor, in every language. ModelAPI is stubbed to record the read.
 */

type ListRequest = {
  query: JSONObject;
  limit: number;
  skip: number;
  select: JSONObject;
  sort: JSONObject;
};

// The monitors as ModelAPI hands them over: models, a status's colour a Color.
type ListResponse = { data: Array<Monitor>; count: number };

const listMock: Mock<(request: ListRequest) => Promise<ListResponse>> =
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

const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return PROJECT_ID;
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
        return <span>{props.children}</span>;
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
            return "/resource";
          },
        };
      },
    },
  };
});

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const STATUS_ID: string = "5b1d6a3e-3a52-4f1f-9b8e-0b5a3a3f0001";
const LABEL_ID: string = "5b1d6a3e-3a52-4f1f-9b8e-0b5a3a3f0002";

const RED: string = "#ef4444";
const GREEN: string = "#10b981";

const dashboardViewConfig: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 12,
};

function monitorListProps(widgetArguments: JSONObject = {}): MonitorListProps {
  const component: MonitorListProps["component"] =
    DashboardMonitorListComponentUtil.getDefaultComponent();
  component.arguments = {
    title: "Monitors",
    maxRows: 25,
    ...widgetArguments,
  } as MonitorListProps["component"]["arguments"];

  const base: Omit<DashboardBaseComponentProps, "componentId"> & {
    componentId: ObjectID;
  } = {
    componentId: component.componentId,
    key: component.componentId.toString(),
    isEditMode: false,
    isSelected: false,
    onComponentUpdate: () => {},
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 480,
    dashboardViewConfig,
    dashboardStartAndEndDate: { range: TimeRange.PAST_ONE_HOUR },
    metricTypes: [],
    refreshTick: 0,
    variables: [],
    dashboardId: "d0000000-0000-4000-8000-000000000001",
  };

  return { ...base, component };
}

function monitor(data: {
  name: string;
  status: string | null;
  color?: string | undefined;
  // Left out: a monitor read without the column.
  disableActiveMonitoring?: boolean | undefined;
}): Monitor {
  const value: Monitor = new Monitor();
  value._id = ObjectID.generate().toString();
  value.name = data.name;
  value.monitorType = MonitorType.Website;

  if (data.disableActiveMonitoring !== undefined) {
    value.disableActiveMonitoring = data.disableActiveMonitoring;
  }

  if (data.status) {
    const status: MonitorStatus = new MonitorStatus();
    status.name = data.status;
    if (data.color) {
      status.color = Color.fromString(data.color);
    }
    value.currentMonitorStatus = status;
  }

  return value;
}

// An Offline monitor nobody checks any more, and two that are checked.
const MONITORS: Array<Monitor> = [
  monitor({
    name: "checkout",
    status: "Offline",
    color: RED,
    disableActiveMonitoring: true,
  }),
  monitor({
    name: "search",
    status: "Offline",
    color: RED,
    disableActiveMonitoring: false,
  }),
  monitor({
    name: "api",
    status: "Operational",
    color: GREEN,
    disableActiveMonitoring: false,
  }),
];

async function firstRequest(): Promise<ListRequest> {
  await waitFor(() => {
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  return listMock.mock.calls[0]![0];
}

function withoutProject(query: JSONObject): JSONObject {
  const rest: JSONObject = { ...query };
  delete rest["projectId"];
  return rest;
}

// The widget's query and the public policy's, from the same stored settings.
async function queriesFor(widgetArguments: JSONObject): Promise<{
  widget: JSONObject;
  publicPage: JSONObject;
}> {
  listMock.mockReset();
  listMock.mockResolvedValue({ data: [], count: 0 });
  render(
    <DashboardMonitorListComponentElement
      {...monitorListProps(widgetArguments)}
    />,
  );
  const request: ListRequest = await firstRequest();
  cleanup();

  const policy: PublicDashboardResourceListPolicyResult =
    PublicDashboardResourceListPolicy.build({
      widget: {
        componentType: DashboardComponentType.MonitorList,
        arguments: widgetArguments,
      },
      variables: [],
      requestedVariables: [],
      requestedQuery: {},
    });

  expect(request.query["projectId"]).toEqual(PROJECT_ID);

  return { widget: withoutProject(request.query), publicPage: policy.query };
}

function statusCellOf(name: string): HTMLElement {
  const row: HTMLElement | null = screen.getByText(name).closest("tr");
  expect(row).not.toBeNull();
  return row!.querySelector('[data-testid="monitor-list-status"]')!;
}

function dotColorOf(name: string): string {
  return (statusCellOf(name).firstElementChild as HTMLElement).style
    .backgroundColor;
}

function toRgb(hex: string): string {
  const value: number = parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

beforeEach(() => {
  listMock.mockReset();
  listMock.mockResolvedValue({ data: MONITORS, count: MONITORS.length });
  window.localStorage.clear();
  setPublicDashboardContext(null);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  setPublicDashboardContext(null);
});

describe("the monitors each status filter lists, on a board and on its public page", () => {
  test("no filter: every monitor but the archived ones - one whose monitoring is off too", async () => {
    const { widget, publicPage } = await queriesFor({});

    expect(widget).toEqual({ isArchived: false });
    expect(publicPage).toEqual(widget);
  });

  test("'non-operational' is the Not Operational rule: no monitor whose monitoring is off, no archived one", async () => {
    const { widget, publicPage } = await queriesFor({
      statusFilter: "non-operational",
    });

    expect(widget).toEqual(NotOperationalMonitorQuery.getQuery());
    expect(widget).toEqual({
      isArchived: false,
      disableActiveMonitoring: false,
      currentMonitorStatus: { isOperationalState: false },
    });
    expect(publicPage).toEqual(widget);
  });

  test("'operational' leaves out a monitor whose monitoring is off, however its last check went", async () => {
    const { widget, publicPage } = await queriesFor({
      statusFilter: "operational",
    });

    expect(widget).toEqual({
      isArchived: false,
      disableActiveMonitoring: false,
      currentMonitorStatus: { isOperationalState: true },
    });
    expect(publicPage).toEqual(widget);
  });

  test("picked statuses match only monitors whose monitoring is on", async () => {
    const { widget, publicPage } = await queriesFor({
      monitorStatusIds: [STATUS_ID],
    });

    expect(widget).toEqual({
      isArchived: false,
      disableActiveMonitoring: false,
      currentMonitorStatusId: new Includes([STATUS_ID]),
    });
    expect(publicPage).toEqual(widget);
  });

  test("with types and labels as well, both build the same query", async () => {
    const { widget, publicPage } = await queriesFor({
      statusFilter: "non-operational",
      monitorStatusIds: [STATUS_ID],
      monitorTypes: ["Website", "Ping"],
      labelIds: [LABEL_ID],
    });

    expect(widget).toEqual({
      isArchived: false,
      disableActiveMonitoring: false,
      currentMonitorStatus: { isOperationalState: false },
      currentMonitorStatusId: new Includes([STATUS_ID]),
      monitorType: new Includes(["Website", "Ping"]),
      labels: new Includes([LABEL_ID]),
    });
    expect(publicPage).toEqual(widget);
  });

  test("the read asks whether monitoring is off, on a board and on its public page", async () => {
    render(<DashboardMonitorListComponentElement {...monitorListProps()} />);
    const request: ListRequest = await firstRequest();

    expect(request.select["disableActiveMonitoring"]).toBe(true);
    expect(
      PublicDashboardResourceListPolicy.build({
        widget: {
          componentType: DashboardComponentType.MonitorList,
          arguments: {},
        },
        variables: [],
        requestedVariables: [],
        requestedQuery: {},
      }).select["disableActiveMonitoring"],
    ).toBe(true);
  });
});

/*
 * The widget and the public policy build their status predicates with
 * getMonitorListQuery and spell none of their own: one written inline beside
 * it would list a monitor whose monitoring is off again, on one of the two.
 */
describe("one rule for the board and its public page", () => {
  const PACKAGES: string = path.resolve(__dirname, "../../../..");

  function read(relativePath: string): string {
    return fs.readFileSync(path.join(PACKAGES, relativePath), "utf8");
  }

  test("the widget", () => {
    const source: string = read(
      "App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardMonitorListComponent.tsx",
    );

    expect(source).toContain("...getMonitorListQuery({");
    expect(source).toContain("getMonitorListRowStatus(monitor)");
    expect(source).toContain("...MONITOR_LIST_WIDGET_SELECT");
    expect(source).not.toMatch(/isOperationalState/);
    expect(source).not.toMatch(/currentMonitorStatusId/);
  });

  test("the public policy's Monitor List", () => {
    const source: string = read(
      "Common/Server/Utils/Dashboard/PublicDashboardResourceListPolicy.ts",
    );
    const start: number = source.indexOf("private static buildMonitorPolicy(");
    const end: number = source.indexOf("private static ", start + 1);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const buildMonitorPolicy: string = source.slice(start, end);

    expect(buildMonitorPolicy).toContain("getMonitorListQuery({");
    expect(buildMonitorPolicy).toContain("MONITOR_LIST_STATUS_FILTER_VALUES");
    expect(buildMonitorPolicy).not.toMatch(/isOperationalState/);
    expect(buildMonitorPolicy).not.toMatch(/currentMonitorStatusId/);
  });
});

describe("a row says Disabled for a monitor whose monitoring is off", () => {
  test("in gray, not the Offline its last check left - beside a checked Offline monitor that keeps its status", async () => {
    render(<DashboardMonitorListComponentElement {...monitorListProps()} />);

    expect(await screen.findByText("checkout")).toBeInTheDocument();

    expect(statusCellOf("checkout")).toHaveTextContent("Disabled");
    expect(statusCellOf("checkout")).not.toHaveTextContent("Offline");
    expect(dotColorOf("checkout")).toBe(toRgb(Gray500.toString()));

    expect(statusCellOf("search")).toHaveTextContent("Offline");
    expect(dotColorOf("search")).toBe(toRgb(RED));
    expect(statusCellOf("api")).toHaveTextContent("Operational");
    expect(dotColorOf("api")).toBe(toRgb(GREEN));

    // The frozen status is shown nowhere for it: only the checked one says Offline.
    expect(screen.getAllByText("Offline")).toHaveLength(1);
  });

  test("a monitor read without the flag, or with no status, draws as it always did", async () => {
    listMock.mockResolvedValue({
      data: [
        monitor({ name: "legacy", status: "Degraded", color: RED }),
        monitor({
          name: "fresh",
          status: null,
          disableActiveMonitoring: false,
        }),
      ],
      count: 2,
    });
    render(<DashboardMonitorListComponentElement {...monitorListProps()} />);

    expect(await screen.findByText("legacy")).toBeInTheDocument();
    expect(statusCellOf("legacy")).toHaveTextContent("Degraded");
    expect(dotColorOf("legacy")).toBe(toRgb(RED));
    expect(statusCellOf("fresh")).toHaveTextContent("Unknown");
    expect(dotColorOf("fresh")).toBe(toRgb("#9ca3af"));
  });
});

describe("the honeycomb paints it gray and says Disabled", () => {
  let originalResizeObserver: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalResizeObserver = Object.getOwnPropertyDescriptor(
      window,
      "ResizeObserver",
    );
    // The honeycomb watches its width; jsdom has no layout to report.
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: class {
        public observe(): void {
          return;
        }
        public unobserve(): void {
          return;
        }
        public disconnect(): void {
          return;
        }
      },
    });
  });

  afterEach(() => {
    if (originalResizeObserver) {
      Object.defineProperty(window, "ResizeObserver", originalResizeObserver);
    } else {
      delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver;
    }
  });

  // The hexagons, in list order: the only divs painted with an inline colour.
  function tiles(): Array<HTMLElement> {
    return Array.from(
      document.body.querySelectorAll<HTMLElement>(
        'div[style*="background-color"]',
      ),
    );
  }

  test("each tile in its status's colour, and hovering one names what it is", async () => {
    render(
      <DashboardMonitorListComponentElement
        {...monitorListProps({ viewMode: "honeycomb" })}
      />,
    );

    await waitFor(() => {
      expect(tiles()).toHaveLength(3);
    });

    expect(
      tiles().map((tile: HTMLElement): string => {
        return tile.style.backgroundColor;
      }),
    ).toEqual([toRgb(Gray500.toString()), toRgb(RED), toRgb(GREEN)]);

    const expected: Array<{ name: string; status: string }> = [
      { name: "checkout", status: "Disabled" },
      { name: "search", status: "Offline" },
      { name: "api", status: "Operational" },
    ];

    expected.forEach(
      (entry: { name: string; status: string }, index: number): void => {
        fireEvent.mouseEnter(tiles()[index]!);

        expect(screen.getByText(entry.name)).toBeInTheDocument();
        expect(screen.getByText("Status").nextElementSibling).toHaveTextContent(
          entry.status,
        );

        fireEvent.mouseLeave(tiles()[index]!);
      },
    );
  });
});

describe("Disabled in the reader's language", () => {
  const instances: Record<string, i18n> = {};
  const locales: Record<string, Record<string, unknown>> = {};

  beforeAll(async () => {
    for (const language of DASHBOARD_LANGUAGES) {
      locales[language] = JSON.parse(
        fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
      ) as Record<string, unknown>;

      const instance: i18n = createInstance();
      await instance.init({
        lng: language,
        resources: {
          [language]: {
            translation: locales[language] as Record<string, string>,
          },
        },
        interpolation: { escapeValue: false },
        keySeparator: false,
        nsSeparator: false,
      });
      instances[language] = instance;
    }
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "in %s the row says the Dashboard's word for Disabled",
    async (language: string) => {
      const word: string = locales[language]!["Disabled"] as string;

      expect(word).not.toBe("Disabled");

      render(
        <I18nextProvider i18n={instances[language]!}>
          <DashboardMonitorListComponentElement {...monitorListProps()} />
        </I18nextProvider>,
      );

      expect(await screen.findByText("checkout")).toBeInTheDocument();
      expect(statusCellOf("checkout")).toHaveTextContent(word);
      expect(statusCellOf("checkout")).not.toHaveTextContent("Disabled");
      // A checked monitor's status is the project's own name, as stored.
      expect(statusCellOf("search")).toHaveTextContent("Offline");
    },
  );
});
