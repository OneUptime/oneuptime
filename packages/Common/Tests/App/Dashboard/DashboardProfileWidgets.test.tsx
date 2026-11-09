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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The dashboard's profile widgets, over a fake telemetry API
 * ---------------------------------------------------------------------------
 *
 * The REAL Flame Graph and Top Functions widgets, mounted as a dashboard
 * mounts them, against a stand-in for the Profiler's endpoints. They read
 * what the Profiler reads, in its order: the kinds the scope has data for
 * (so a kind is read in one unit), then the flame graph or the ranked
 * functions. These pin what each widget asks the server for - the window,
 * the services, the raw types, the ranking - and what it draws from the
 * answers: the scope line, the rows, the Profiler's links, every empty and
 * failed read, the dashboard's service variable, a public dashboard, the
 * dashboard edited and on a playlist's screen, and the words in German and
 * Persian.
 */

const postMock: MockFunction = getJestMockFunction();
const serviceListMock: MockFunction = getJestMockFunction();

const CHECKOUT_ID: string = "60000000-0000-4000-8000-0000000000a1";
const PAYMENTS_ID: string = "60000000-0000-4000-8000-0000000000a2";

// The names the entity-name lookup finds.
const ENTITY_NAMES: Record<string, string> = {
  [CHECKOUT_ID]: "checkout",
  [PAYMENTS_ID]: "payments",
};

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: { message?: string }) => {
        return error?.message || "error";
      },
      getFriendlyErrorMessage: (error: { message?: string }) => {
        return error?.message || "error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return serviceListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: (ids: Array<string> | undefined) => {
      const map: Record<string, unknown> = {};

      for (const id of ids || []) {
        const name: string | undefined = ENTITY_NAMES[String(id)];

        if (name) {
          map[String(id)] = {
            id: String(id),
            name,
            entityType: "OpenTelemetry",
            typeLabel: "Service",
          };
        }
      }

      return map;
    },
  };
});

import DashboardProfileFlameGraphComponentElement, {
  PROFILE_FLAME_GRAPH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardProfileFlameGraphComponent";
import DashboardProfileTopFunctionsComponentElement, {
  PROFILE_TOP_FUNCTIONS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardProfileTopFunctionsComponent";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import { WIDGET_PLACEHOLDER_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/WidgetPlaceholder";
import {
  PublicDashboardContext,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import {
  FLAME_TITLES,
  FUNCTIONS_OWN_EMPTY,
  HEADLINE_NO_DATA,
  SORT_BY_SELF,
  SORT_BY_TOTAL,
  VIEW_YOUR_CODE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileCopy";
import {
  PROFILE_KIND_LABELS,
  PROFILE_KIND_NOUNS,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProfilesView";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import DashboardProfileFlameGraphComponent from "../../../Types/Dashboard/DashboardComponents/DashboardProfileFlameGraphComponent";
import DashboardProfileTopFunctionsComponent from "../../../Types/Dashboard/DashboardComponents/DashboardProfileTopFunctionsComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import { translatableTerm } from "../../../UI/Utils/TranslateTemplate";
import { ProfileCategory } from "../../../Utils/Profiles/ProfileTypes";
import {
  createLanguageInstances,
  inLanguage,
  sentence,
  word,
} from "./TracesLanguageHarness";

const COMPONENT_ID: ObjectID = new ObjectID(
  "70000000-0000-4000-8000-0000000000b1",
);

const START: Date = new Date("2026-11-09T11:00:00.000Z");
const END: Date = new Date("2026-11-09T12:00:00.000Z");

// A CUSTOM range: the window never depends on the clock.
const ONE_HOUR: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(START, END),
};

const THIRTY_DAYS: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date(END.getTime() - 30 * 24 * 60 * 60 * 1000),
    END,
  ),
};

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 60,
};

// Stands for the public board: the page registers this context on mount.
const PUBLIC_CONTEXT: PublicDashboardContext = {
  dashboardId: new ObjectID("70000000-0000-4000-8000-0000000000b2"),
} as unknown as PublicDashboardContext;

/*
 * What the profile store answers. CPU time came in two units - the Go
 * SDK's nanoseconds and the eBPF profiler's sample counts - and the
 * Profiler reads the unit with more samples: nanoseconds here.
 */
interface Scenario {
  types: Array<JSONObject>;
  functions: Array<JSONObject>;
  windowTotal: number;
  truncated: boolean;
  flamegraph: JSONObject | null;
  failRoutes: Array<string>;
}

const FUNCTIONS: Array<JSONObject> = [
  {
    functionName: "JSON.parse",
    fileName: "node:internal/json",
    lineNumber: 0,
    frameType: "",
    selfValue: 420_000_000,
    totalValue: 450_000_000,
    sampleCount: 4200,
    ownValue: 0,
  },
  {
    functionName: "parseOrder",
    fileName: "src/orders/parse.ts",
    lineNumber: 88,
    frameType: "",
    selfValue: 150_000_000,
    totalValue: 700_000_000,
    sampleCount: 1500,
    ownValue: 600_000_000,
  },
  {
    functionName: "express.Router",
    fileName: "node_modules/express/lib/router/index.js",
    lineNumber: 12,
    frameType: "",
    selfValue: 0,
    totalValue: 900_000_000,
    sampleCount: 9000,
    ownValue: 0,
  },
];

const FLAMEGRAPH: JSONObject = {
  functionName: "(root)",
  fileName: "",
  lineNumber: 0,
  selfValue: 0,
  totalValue: 1_000_000_000,
  frameType: "",
  children: [
    {
      functionName: "handleCheckout",
      fileName: "src/routes/checkout.ts",
      lineNumber: 40,
      selfValue: 100_000_000,
      totalValue: 1_000_000_000,
      frameType: "",
      children: [
        {
          functionName: "parseOrder",
          fileName: "src/orders/parse.ts",
          lineNumber: 88,
          selfValue: 900_000_000,
          totalValue: 900_000_000,
          frameType: "",
          children: [],
        },
      ],
    },
  ],
};

let scenario: Scenario;

function freshScenario(): Scenario {
  return {
    types: [
      {
        profileType: "cpu",
        unit: "nanoseconds",
        sampleCount: 9000,
        profileCount: 60,
      },
      { profileType: "samples", unit: "count", sampleCount: 300, profileCount: 4 },
      {
        profileType: "inuse_space",
        unit: "bytes",
        sampleCount: 500,
        profileCount: 60,
      },
    ],
    functions: FUNCTIONS,
    windowTotal: 1_000_000_000,
    truncated: false,
    flamegraph: FLAMEGRAPH,
    failRoutes: [],
  };
}

interface PostCall {
  route: string;
  body: JSONObject;
}

const PROFILE_ROUTES: Array<string> = [
  "/telemetry/profiles/profile-types",
  "/telemetry/profiles/function-list",
  "/telemetry/profiles/flamegraph",
];

function routeOf(url: unknown): string {
  const text: string = String(url);

  return (
    PROFILE_ROUTES.find((route: string): boolean => {
      return text.includes(route);
    }) || text
  );
}

function postCalls(route?: string): Array<PostCall> {
  return postMock.mock.calls
    .map((call: Array<unknown>): PostCall => {
      const options: { url: unknown; data: JSONObject } = call[0] as {
        url: unknown;
        data: JSONObject;
      };

      return { route: routeOf(options.url), body: options.data };
    })
    .filter((call: PostCall): boolean => {
      return !route || call.route === route;
    });
}

function answer(route: string): JSONObject {
  if (route === "/telemetry/profiles/profile-types") {
    return { profileTypes: scenario.types };
  }

  if (route === "/telemetry/profiles/function-list") {
    return {
      functions: scenario.functions,
      windowTotal: scenario.windowTotal,
      windowSampleCount: 10000,
      truncated: scenario.truncated,
    };
  }

  if (route === "/telemetry/profiles/flamegraph") {
    return { flamegraph: scenario.flamegraph, truncated: false };
  }

  throw new Error(`The widget asked for ${route}, which it never reads.`);
}

function widgetProps(
  overrides: Partial<DashboardBaseComponentProps> = {},
): DashboardBaseComponentProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: false,
    isSelected: false,
    key: "profile-widget",
    onComponentUpdate: (): void => {
      // The widgets never write back through this.
    },
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 600,
    dashboardComponentWidthInPx: 600,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: ONE_HOUR,
    metricTypes: [],
    refreshTick: 0,
    ...overrides,
  };
}

function topFunctions(
  args: DashboardProfileTopFunctionsComponent["arguments"],
): DashboardProfileTopFunctionsComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.ProfileTopFunctions,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 6,
    minWidthInDashboardUnits: 4,
    minHeightInDashboardUnits: 3,
    arguments: args,
  };
}

function flameGraph(
  args: DashboardProfileFlameGraphComponent["arguments"],
): DashboardProfileFlameGraphComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: DashboardComponentType.ProfileFlameGraph,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 12,
    heightInDashboardUnits: 4,
    minWidthInDashboardUnits: 6,
    minHeightInDashboardUnits: 3,
    arguments: args,
  };
}

function renderTopFunctions(
  args: DashboardProfileTopFunctionsComponent["arguments"],
  overrides: Partial<DashboardBaseComponentProps> = {},
  language: string = "en",
): ReturnType<typeof render> {
  return render(
    inLanguage(
      language,
      <MemoryRouter>
        <DashboardProfileTopFunctionsComponentElement
          {...widgetProps(overrides)}
          component={topFunctions(args)}
        />
      </MemoryRouter>,
    ),
  );
}

function renderFlameGraph(
  args: DashboardProfileFlameGraphComponent["arguments"],
  overrides: Partial<DashboardBaseComponentProps> = {},
  language: string = "en",
): ReturnType<typeof render> {
  return render(
    inLanguage(
      language,
      <MemoryRouter>
        <DashboardProfileFlameGraphComponentElement
          {...widgetProps(overrides)}
          component={flameGraph(args)}
        />
      </MemoryRouter>,
    ),
  );
}

function serviceVariable(selectedValue: string): DashboardVariable {
  return {
    id: "service-variable",
    name: "service",
    label: "Service",
    type: DashboardVariableType.TelemetryAttribute,
    attributeKey: "resource.service.name",
    selectedValue,
  };
}

function rowTexts(): Array<string> {
  return screen
    .getAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-name`)
    .map((element: HTMLElement): string => {
      return element.textContent || "";
    });
}

function queryOf(href: string | null): URLSearchParams {
  const text: string = href || "";
  const at: number = text.indexOf("?");

  return new URLSearchParams(at >= 0 ? text.slice(at + 1) : "");
}

function noData(language: string, category: ProfileCategory): string {
  return sentence(language, HEADLINE_NO_DATA, {
    kind: translatableTerm(PROFILE_KIND_NOUNS[category], { inSentence: true }),
  });
}

beforeAll(async () => {
  await createLanguageInstances();
});

beforeEach(() => {
  scenario = freshScenario();
  postMock.mockReset();
  serviceListMock.mockReset();
  setPublicDashboardContext(null);

  postMock.mockImplementation(async (options: unknown) => {
    const route: string = routeOf((options as { url: unknown }).url);

    if (scenario.failRoutes.includes(route)) {
      throw new Error("The profile store did not answer.");
    }

    return { data: answer(route) };
  });

  // The services, by name, as the service variable's lookup reads them.
  serviceListMock.mockImplementation(async (options: unknown) => {
    const query: JSONObject = (options as { query: JSONObject }).query;
    const names: Array<string> =
      query["name"] instanceof Includes
        ? (query["name"] as Includes).values.map((value: unknown): string => {
            return String(value);
          })
        : [];

    const data: Array<{ id: ObjectID; name: string }> = Object.entries(
      ENTITY_NAMES,
    )
      .filter(([, name]: [string, string]): boolean => {
        return names.includes(name);
      })
      .map(([id, name]: [string, string]) => {
        return { id: new ObjectID(id), name };
      });

    return { data, count: data.length };
  });
});

afterEach(() => {
  cleanup();
  setPublicDashboardContext(null);
});

describe("Top Functions", () => {
  test("reads the kinds first, then the functions of CPU time in its one unit, over the dashboard's window", async () => {
    renderTopFunctions({ profileKind: "cpu", rankBy: "self", maxRows: 10 });

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    const routes: Array<string> = postCalls().map((call: PostCall) => {
      return call.route;
    });

    expect(routes[0]).toBe("/telemetry/profiles/profile-types");
    expect(routes).toContain("/telemetry/profiles/function-list");

    expect(postCalls("/telemetry/profiles/profile-types")[0]?.body).toEqual({
      startTime: START.toISOString(),
      endTime: END.toISOString(),
    });

    // Nanoseconds only: the eBPF profiler's counts are never added to them.
    expect(postCalls("/telemetry/profiles/function-list")[0]?.body).toEqual({
      startTime: START.toISOString(),
      endTime: END.toISOString(),
      profileTypes: ["cpu"],
      sortBy: "selfValue",
      limit: 100,
    });
  });

  test("lists the functions by Self, each with whose code it is, its share and its time", async () => {
    renderTopFunctions({ profileKind: "cpu", rankBy: "self", maxRows: 10 });

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    // express.Router does no work of its own: Self leaves it out.
    expect(rowTexts()).toEqual(["JSON.parse", "parseOrder"]);

    const rows: Array<HTMLElement> = screen.getAllByTestId(
      `${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`,
    );

    expect(
      within(rows[0]!).getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-share`),
    ).toHaveTextContent("42%");
    expect(
      within(rows[0]!).getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-value`),
    ).toHaveTextContent("420 ms");
    expect(
      within(rows[0]!).getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-origin`),
    ).toHaveTextContent("Runtime");
    expect(
      within(rows[1]!).getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-origin`),
    ).toHaveTextContent("Your code");
    expect(rows[1]).toHaveTextContent("src/orders/parse.ts:88");
  });

  test("says whose profiles, of what and how ranked, under a title that says what it is", async () => {
    renderTopFunctions({ profileKind: "cpu", rankBy: "self", maxRows: 10 });

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-title`),
    ).toHaveTextContent("Top functions");
    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-services`),
    ).toHaveTextContent("All services");
    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-kind`),
    ).toHaveTextContent("CPU time");
    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-rank`),
    ).toHaveTextContent("Self");
    expect(
      screen.queryByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-capped`),
    ).toBeNull();
  });

  test("a title of its own is drawn as written", async () => {
    renderTopFunctions({ title: "  Checkout hot paths ", rankBy: "self" });

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-title`),
    ).toHaveTextContent("Checkout hot paths");
  });

  test("by Total, with everything each function calls", async () => {
    renderTopFunctions({ profileKind: "cpu", rankBy: "total", maxRows: 2 });

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    expect(postCalls("/telemetry/profiles/function-list")[0]?.body).toEqual(
      expect.objectContaining({ sortBy: "totalValue" }),
    );
    expect(rowTexts()).toEqual(["express.Router", "parseOrder"]);
    expect(
      screen.getAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-share`)[0],
    ).toHaveTextContent("90%");
    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-rank`),
    ).toHaveTextContent("Total");
  });

  test("Your code lists only the application's own functions, by own-code time", async () => {
    renderTopFunctions({ profileKind: "cpu", rankBy: "own", maxRows: 10 });

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    expect(postCalls("/telemetry/profiles/function-list")[0]?.body).toEqual(
      expect.objectContaining({ sortBy: "ownValue" }),
    );
    expect(rowTexts()).toEqual(["parseOrder"]);
    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-share`),
    ).toHaveTextContent("60%");
  });

  test("Your code with none of the application's own code in the window says so", async () => {
    scenario.functions = [FUNCTIONS[0]!, FUNCTIONS[2]!];

    renderTopFunctions({ profileKind: "cpu", rankBy: "own" });

    expect(
      await screen.findByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-empty`),
    ).toHaveTextContent(FUNCTIONS_OWN_EMPTY);
  });

  test("lists at most its rows", async () => {
    renderTopFunctions({ profileKind: "cpu", rankBy: "total", maxRows: 1 });

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    expect(rowTexts()).toEqual(["express.Router"]);
  });

  test("a kind the scope has no data for reads no functions, and says so", async () => {
    renderTopFunctions({ profileKind: "locks", rankBy: "self" });

    expect(
      await screen.findByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-empty`),
    ).toHaveTextContent(noData("en", ProfileCategory.Locks));
    expect(postCalls("/telemetry/profiles/function-list")).toHaveLength(0);
  });

  test("memory is read in bytes, and its values written as sizes", async () => {
    scenario.functions = [
      {
        functionName: "Buffer.alloc",
        fileName: "node:buffer",
        lineNumber: 0,
        frameType: "",
        selfValue: 12 * 1024 * 1024,
        totalValue: 12 * 1024 * 1024,
        sampleCount: 40,
        ownValue: 0,
      },
    ];
    scenario.windowTotal = 48 * 1024 * 1024;

    renderTopFunctions({ profileKind: "memory", rankBy: "self" });

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    expect(postCalls("/telemetry/profiles/function-list")[0]?.body).toEqual(
      expect.objectContaining({ profileTypes: ["inuse_space"] }),
    );
    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-value`),
    ).toHaveTextContent("12 MB");
    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-share`),
    ).toHaveTextContent("25%");
    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-kind`),
    ).toHaveTextContent("Memory");
  });

  test("CPU time from the eBPF profiler alone is read as its sample counts", async () => {
    scenario.types = [
      {
        profileType: "samples",
        unit: "count",
        sampleCount: 3000,
        profileCount: 30,
      },
    ];
    scenario.windowTotal = 3000;
    scenario.functions = [
      {
        functionName: "memcpy",
        fileName: "/usr/lib/libc.so.6",
        lineNumber: 0,
        frameType: "native",
        selfValue: 1500,
        totalValue: 1500,
        sampleCount: 1500,
        ownValue: 0,
      },
    ];

    renderTopFunctions({ profileKind: "cpu", rankBy: "self" });

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    expect(postCalls("/telemetry/profiles/function-list")[0]?.body).toEqual(
      expect.objectContaining({ profileTypes: ["samples"] }),
    );
    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-value`),
    ).toHaveTextContent("1.5K");
    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-origin`),
    ).toHaveTextContent("System");
  });

  test("a failed read says why, and Try again reads again", async () => {
    scenario.failRoutes = ["/telemetry/profiles/function-list"];

    renderTopFunctions({ profileKind: "cpu", rankBy: "self" });

    expect(
      await screen.findByText("The profile store did not answer."),
    ).toBeInTheDocument();

    scenario.failRoutes = [];
    const before: number = postCalls("/telemetry/profiles/function-list")
      .length;

    fireEvent.click(screen.getByRole("button"));

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);
    expect(
      postCalls("/telemetry/profiles/function-list").length,
    ).toBeGreaterThan(before);
  });

  test("a failed read of the kinds says why too, and draws no rows", async () => {
    scenario.failRoutes = ["/telemetry/profiles/profile-types"];

    renderTopFunctions({ profileKind: "cpu", rankBy: "self" });

    expect(
      await screen.findByText("The profile store did not answer."),
    ).toBeInTheDocument();
    expect(
      screen.queryAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`),
    ).toHaveLength(0);
    expect(postCalls("/telemetry/profiles/function-list")).toHaveLength(0);
  });

  test("a range longer than a week reads its newest 7 days, and says so", async () => {
    renderTopFunctions(
      { profileKind: "cpu", rankBy: "self" },
      { dashboardStartAndEndDate: THIRTY_DAYS },
    );

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    expect(postCalls("/telemetry/profiles/function-list")[0]?.body).toEqual(
      expect.objectContaining({
        startTime: new Date(
          END.getTime() - 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        endTime: END.toISOString(),
      }),
    );
    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-capped`),
    ).toHaveTextContent("Last 7 days");
  });

  test("each function opens the Profiler on it, in the widget's window", async () => {
    renderTopFunctions({
      serviceId: CHECKOUT_ID,
      profileKind: "cpu",
      rankBy: "self",
    });

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    const link: HTMLElement = screen.getAllByTestId(
      `${PROFILE_TOP_FUNCTIONS_TEST_ID}-name`,
    )[1]!;

    expect(link.tagName).toBe("A");

    const query: URLSearchParams = queryOf(link.getAttribute("href"));

    expect(query.get("serviceId")).toBe(CHECKOUT_ID);
    expect(query.get("function")).toBe("parseOrder");
    expect(query.get("file")).toBe("src/orders/parse.ts");
    expect(query.get("startTime")).toBe(START.toISOString());
    expect(query.get("endTime")).toBe(END.toISOString());

    const open: HTMLElement = screen.getByTestId(
      `${PROFILE_TOP_FUNCTIONS_TEST_ID}-open`,
    );

    expect(open).toHaveAttribute("aria-label", "Open in Profiler");
    expect(queryOf(open.getAttribute("href")).get("function")).toBeNull();
  });

  test("while the dashboard is edited, and on a playlist's screen, nothing leads away", async () => {
    for (const overrides of [{ isEditMode: true }, { isPlayback: true }]) {
      renderTopFunctions({ profileKind: "cpu", rankBy: "self" }, overrides);

      await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

      for (const name of screen.getAllByTestId(
        `${PROFILE_TOP_FUNCTIONS_TEST_ID}-name`,
      )) {
        expect(name.tagName).toBe("SPAN");
      }

      expect(
        screen.queryByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-open`),
      ).toBeNull();

      cleanup();
    }
  });

  test("a pinned service is read alone, and named", async () => {
    renderTopFunctions({
      serviceId: CHECKOUT_ID,
      profileKind: "cpu",
      rankBy: "self",
    });

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    for (const call of postCalls()) {
      expect(call.body["serviceIds"]).toEqual([CHECKOUT_ID]);
    }

    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-services`),
    ).toHaveTextContent("checkout");
  });

  test("a pinned service whose name cannot be found reads as this service", async () => {
    const unknown: string = "60000000-0000-4000-8000-0000000000ff";

    renderTopFunctions({ serviceId: unknown, rankBy: "self" });

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-services`),
    ).toHaveTextContent("This service");
  });

  test("a stored service that is no id pins nothing: every service is read", async () => {
    renderTopFunctions({ serviceId: "checkout", rankBy: "self" });

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    for (const call of postCalls()) {
      expect(call.body["serviceIds"]).toBeUndefined();
    }
  });

  test("with All services, it follows the dashboard's service variable", async () => {
    renderTopFunctions(
      { profileKind: "cpu", rankBy: "self" },
      { variables: [serviceVariable("payments")] },
    );

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    expect(serviceListMock).toHaveBeenCalledTimes(1);
    expect(postCalls().length).toBeGreaterThan(0);

    for (const call of postCalls()) {
      expect(call.body["serviceIds"]).toEqual([PAYMENTS_ID]);
    }

    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-services`),
    ).toHaveTextContent("payments");
  });

  test("a variable that picks a name no service has reads nothing, and says so", async () => {
    renderTopFunctions(
      { profileKind: "cpu", rankBy: "self" },
      { variables: [serviceVariable("no-such-service")] },
    );

    expect(
      await screen.findByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-empty`),
    ).toHaveTextContent(noData("en", ProfileCategory.Cpu));
    expect(postCalls()).toHaveLength(0);
  });

  test("a pinned service wins over the toolbar's pick", async () => {
    renderTopFunctions(
      { serviceId: CHECKOUT_ID, profileKind: "cpu", rankBy: "self" },
      { variables: [serviceVariable("payments")] },
    );

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    expect(serviceListMock).not.toHaveBeenCalled();

    for (const call of postCalls()) {
      expect(call.body["serviceIds"]).toEqual([CHECKOUT_ID]);
    }
  });

  test("a refresh reads again and keeps the rows drawn while it does", async () => {
    const view: ReturnType<typeof render> = renderTopFunctions({
      profileKind: "cpu",
      rankBy: "self",
    });

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    const readsBefore: number = postCalls(
      "/telemetry/profiles/function-list",
    ).length;

    // The next answers wait until the test lets them through.
    const waiting: Array<() => void> = [];

    postMock.mockImplementation(async (options: unknown) => {
      const route: string = routeOf((options as { url: unknown }).url);

      await new Promise<void>((resolve: () => void) => {
        waiting.push(resolve);
      });

      return { data: answer(route) };
    });

    view.rerender(
      inLanguage(
        "en",
        <MemoryRouter>
          <DashboardProfileTopFunctionsComponentElement
            {...widgetProps({ refreshTick: 1 })}
            component={topFunctions({ profileKind: "cpu", rankBy: "self" })}
          />
        </MemoryRouter>,
      ),
    );

    await waitFor(() => {
      expect(
        postCalls("/telemetry/profiles/function-list").length,
      ).toBeGreaterThan(readsBefore);
    });

    // Still drawn while the new answers are on their way.
    expect(rowTexts()).toEqual(["JSON.parse", "parseOrder"]);
    expect(
      screen.queryByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-empty`),
    ).toBeNull();

    await act(async () => {
      while (waiting.length > 0) {
        waiting.shift()!();
        await Promise.resolve();
      }
    });

    await waitFor(() => {
      expect(rowTexts()).toEqual(["JSON.parse", "parseOrder"]);
    });
  });
});

describe("Flame Graph", () => {
  test("reads the kinds, then every profile of the scope merged into one graph, and draws it", async () => {
    renderFlameGraph({ serviceId: CHECKOUT_ID, profileKind: "cpu" });

    const graph: HTMLElement = await screen.findByTestId(
      `${PROFILE_FLAME_GRAPH_TEST_ID}-graph`,
    );

    expect(postCalls()[0]?.route).toBe("/telemetry/profiles/profile-types");
    expect(postCalls("/telemetry/profiles/flamegraph")[0]?.body).toEqual({
      startTime: START.toISOString(),
      endTime: END.toISOString(),
      serviceIds: [CHECKOUT_ID],
      profileTypes: ["cpu"],
    });

    // The Profiler's own graph, its frames read left to right.
    const frames: HTMLElement = within(graph).getByTestId("flamegraph-frames");

    expect(frames).toHaveAttribute("dir", "ltr");
    expect(frames).toHaveTextContent("handleCheckout");
    expect(frames).toHaveTextContent("parseOrder");
  });

  test("its title says where the kind goes, and its line whose profiles", async () => {
    renderFlameGraph({ serviceId: CHECKOUT_ID, profileKind: "cpu" });

    await screen.findByTestId(`${PROFILE_FLAME_GRAPH_TEST_ID}-graph`);

    expect(
      screen.getByTestId(`${PROFILE_FLAME_GRAPH_TEST_ID}-title`),
    ).toHaveTextContent(FLAME_TITLES[ProfileCategory.Cpu]);
    expect(
      screen.getByTestId(`${PROFILE_FLAME_GRAPH_TEST_ID}-services`),
    ).toHaveTextContent("checkout");
    expect(
      screen.getByTestId(`${PROFILE_FLAME_GRAPH_TEST_ID}-kind`),
    ).toHaveTextContent(PROFILE_KIND_LABELS[ProfileCategory.Cpu]);
    // No ranking: a flame graph is every stack.
    expect(
      screen.queryByTestId(`${PROFILE_FLAME_GRAPH_TEST_ID}-rank`),
    ).toBeNull();

    expect(
      queryOf(
        screen
          .getByTestId(`${PROFILE_FLAME_GRAPH_TEST_ID}-open`)
          .getAttribute("href"),
      ).get("serviceId"),
    ).toBe(CHECKOUT_ID);
  });

  test("of memory, it says what holds the memory", async () => {
    renderFlameGraph({ profileKind: "memory" });

    await screen.findByTestId(`${PROFILE_FLAME_GRAPH_TEST_ID}-graph`);

    expect(
      screen.getByTestId(`${PROFILE_FLAME_GRAPH_TEST_ID}-title`),
    ).toHaveTextContent(FLAME_TITLES[ProfileCategory.Memory]);
    expect(postCalls("/telemetry/profiles/flamegraph")[0]?.body).toEqual(
      expect.objectContaining({ profileTypes: ["inuse_space"] }),
    );
  });

  test("an empty graph, or a kind with no data, says there is nothing in the window", async () => {
    scenario.flamegraph = { ...FLAMEGRAPH, totalValue: 0, children: [] };

    renderFlameGraph({ profileKind: "cpu" });

    expect(
      await screen.findByTestId(`${PROFILE_FLAME_GRAPH_TEST_ID}-empty`),
    ).toHaveTextContent(noData("en", ProfileCategory.Cpu));

    cleanup();

    renderFlameGraph({ profileKind: "goroutines" });

    expect(
      await screen.findByTestId(`${PROFILE_FLAME_GRAPH_TEST_ID}-empty`),
    ).toHaveTextContent(noData("en", ProfileCategory.Goroutines));
    expect(postCalls("/telemetry/profiles/flamegraph")).toHaveLength(1);
  });

  test("a failed read says why", async () => {
    scenario.failRoutes = ["/telemetry/profiles/flamegraph"];

    renderFlameGraph({ profileKind: "cpu" });

    expect(
      await screen.findByText("The profile store did not answer."),
    ).toBeInTheDocument();
  });

  test("while the dashboard is edited, nothing leads away", async () => {
    renderFlameGraph({ profileKind: "cpu" }, { isEditMode: true });

    await screen.findByTestId(`${PROFILE_FLAME_GRAPH_TEST_ID}-graph`);

    expect(
      screen.queryByTestId(`${PROFILE_FLAME_GRAPH_TEST_ID}-open`),
    ).toBeNull();
  });
});

describe("on a public dashboard", () => {
  test("neither widget reads anything; each says why in its place, under its title", async () => {
    setPublicDashboardContext(PUBLIC_CONTEXT);

    renderTopFunctions({ title: "Checkout hot paths", rankBy: "self" });
    renderFlameGraph({ profileKind: "cpu" });

    const placeholders: Array<HTMLElement> = await screen.findAllByTestId(
      WIDGET_PLACEHOLDER_TEST_ID,
    );

    expect(placeholders).toHaveLength(2);

    for (const placeholder of placeholders) {
      expect(placeholder).toHaveTextContent(
        "Profile widgets are not available on public dashboards.",
      );
    }

    expect(screen.getByText("Checkout hot paths")).toBeInTheDocument();
    expect(postCalls()).toHaveLength(0);
    expect(serviceListMock).not.toHaveBeenCalled();
  });
});

describe("in the reader's language", () => {
  test("German: the title, the scope line and the ranking are German; the code is as written", async () => {
    renderTopFunctions(
      { profileKind: "cpu", rankBy: "total", maxRows: 2 },
      {},
      "de",
    );

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-title`),
    ).toHaveTextContent(word("de", "Top functions"));
    expect(word("de", "Top functions")).not.toBe("Top functions");
    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-services`),
    ).toHaveTextContent(word("de", "All services"));
    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-kind`),
    ).toHaveTextContent(word("de", PROFILE_KIND_LABELS[ProfileCategory.Cpu]));
    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-rank`),
    ).toHaveTextContent(word("de", SORT_BY_TOTAL));
    expect(rowTexts()).toEqual(["express.Router", "parseOrder"]);
  });

  test("German: the empty window says so in German", async () => {
    renderFlameGraph({ profileKind: "locks" }, {}, "de");

    const empty: HTMLElement = await screen.findByTestId(
      `${PROFILE_FLAME_GRAPH_TEST_ID}-empty`,
    );

    expect(empty).toHaveTextContent(noData("de", ProfileCategory.Locks));
    expect(noData("de", ProfileCategory.Locks)).not.toBe(
      noData("en", ProfileCategory.Locks),
    );
  });

  test("Persian: the words are Persian, and each function's name reads left to right", async () => {
    renderTopFunctions(
      { serviceId: CHECKOUT_ID, profileKind: "cpu", rankBy: "self" },
      {},
      "fa",
    );

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-title`),
    ).toHaveTextContent(word("fa", "Top functions"));
    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-rank`),
    ).toHaveTextContent(word("fa", SORT_BY_SELF));

    for (const name of screen.getAllByTestId(
      `${PROFILE_TOP_FUNCTIONS_TEST_ID}-name`,
    )) {
      const isolate: HTMLElement | null = name.querySelector("bdi");

      expect(isolate).not.toBeNull();
      expect(isolate).toHaveAttribute("dir", "ltr");
    }

    // The service's name is set apart in the direction its letters read.
    const services: HTMLElement = screen.getByTestId(
      `${PROFILE_TOP_FUNCTIONS_TEST_ID}-services`,
    );

    expect(services.querySelector("bdi")).toHaveAttribute("dir", "ltr");
  });

  test("Persian: Your code and every origin read Persian", async () => {
    renderTopFunctions({ profileKind: "cpu", rankBy: "own" }, {}, "fa");

    await screen.findAllByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-row`);

    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-rank`),
    ).toHaveTextContent(word("fa", VIEW_YOUR_CODE));
    expect(
      screen.getByTestId(`${PROFILE_TOP_FUNCTIONS_TEST_ID}-origin`),
    ).toHaveTextContent(word("fa", "Your code"));
  });
});
