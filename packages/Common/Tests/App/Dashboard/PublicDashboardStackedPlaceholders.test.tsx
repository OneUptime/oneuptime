import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import React, { ReactElement } from "react";

/*
 * On a phone a dashboard's board shows its widgets one under another, and a
 * chart there is at least 400px tall, so its plot has room under its title
 * and legend (Common/Utils/Dashboard/DashboardBoardLayout). A public
 * dashboard reads no logs, no traces and no external data source: a log, a
 * trace or a Data Source chart says so in its place, in a line of words -
 * and kept a chart's 400px for it, a tall empty card. It keeps its own
 * height there now; inside OneUptime, where it draws its chart, it keeps
 * the floor. Widgets are stubs that publish the size the board hands them.
 */

jest.setTimeout(120000);

function stubWidget(kind: string): () => {
  __esModule: boolean;
  default: (props: Record<string, unknown>) => ReactElement;
} {
  return () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: (props: Record<string, unknown>): ReactElement => {
        const id: string = String(
          (props["componentId"] as { toString: () => string }).toString(),
        );

        return reactModule.createElement("div", {
          "data-testid": `widget-${id}`,
          "data-kind": kind,
          "data-height": String(props["dashboardComponentHeightInPx"]),
        });
      },
    };
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardChartComponent",
  stubWidget("chart"),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardLogChartComponent",
  stubWidget("log-chart"),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTraceChartComponent",
  stubWidget("trace-chart"),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceChartComponent",
  stubWidget("data-source-chart"),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTextComponent",
  stubWidget("text"),
);

import DashboardCanvas, {
  DASHBOARD_BOARD_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index";
import {
  PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES,
  setPublicDashboardContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import URL from "../../../Types/API/URL";
import API from "../../../UI/Utils/API/API";
import { DashboardBoardArrangement } from "../../../Utils/Dashboard/DashboardBoardLayout";

// A 390px phone's board: 374px across inside the page.
const PHONE_BOARD_OUTER_WIDTH: number = 374;

const ORIGINAL_CLIENT_WIDTH: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement): number {
      return this.getAttribute("data-testid") === DASHBOARD_BOARD_TEST_ID
        ? PHONE_BOARD_OUTER_WIDTH
        : 0;
    },
  });
});

afterAll(() => {
  if (ORIGINAL_CLIENT_WIDTH) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      ORIGINAL_CLIENT_WIDTH,
    );
  }
});

const ID: Record<string, string> = {
  metrics: "66666666-6666-4666-8666-666666666661",
  logs: "66666666-6666-4666-8666-666666666662",
  traces: "66666666-6666-4666-8666-666666666663",
  dataSource: "66666666-6666-4666-8666-666666666664",
  title: "66666666-6666-4666-8666-666666666665",
};

function widget(data: {
  id: string;
  type: DashboardComponentType;
  top: number;
  height: number;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: new ObjectID(data.id),
    componentType: data.type,
    topInDashboardUnits: data.top,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 12,
    heightInDashboardUnits: data.height,
    minWidthInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
    arguments: {},
  };
}

// Every chart a board can hold, three rows high, and a one-row title.
const CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  heightInDashboardUnits: 13,
  components: [
    widget({
      id: ID["title"]!,
      type: DashboardComponentType.Text,
      top: 0,
      height: 1,
    }),
    widget({
      id: ID["metrics"]!,
      type: DashboardComponentType.Chart,
      top: 1,
      height: 3,
    }),
    widget({
      id: ID["logs"]!,
      type: DashboardComponentType.LogChart,
      top: 4,
      height: 3,
    }),
    widget({
      id: ID["traces"]!,
      type: DashboardComponentType.TraceChart,
      top: 7,
      height: 3,
    }),
    widget({
      id: ID["dataSource"]!,
      type: DashboardComponentType.DataSourceChart,
      top: 10,
      height: 3,
    }),
  ],
};

function renderBoard(): void {
  render(
    <DashboardCanvas
      dashboardViewConfig={CONFIG}
      onDashboardViewConfigChange={() => {}}
      isEditMode={false}
      currentTotalDashboardWidthInPx={390}
      onComponentSelected={() => {}}
      onComponentUnselected={() => {}}
      selectedComponentId={null}
      metrics={{ metricTypes: [], telemetryAttributes: [] }}
      dashboardStartAndEndDate={{ range: TimeRange.PAST_ONE_HOUR }}
    />,
  );
}

function heightOf(key: string): number {
  return Number(
    screen.getByTestId(`widget-${ID[key]}`).getAttribute("data-height"),
  );
}

function wrapperHeight(key: string): string {
  return document.getElementById(`dashboard-component-${ID[key]}`)!.style
    .height;
}

// Three rows of 70px and the two gaps between them.
const THREE_ROWS: number = 3 * 70 + 2 * 10;

beforeEach(() => {
  setPublicDashboardContext(null);
});

afterEach(() => {
  cleanup();
  setPublicDashboardContext(null);
});

describe("a phone's public dashboard: a chart it cannot draw keeps its own height", () => {
  beforeEach(() => {
    setPublicDashboardContext({
      dashboardId: new ObjectID("66666666-6666-4666-8666-666666666660"),
      apiUrl: URL.fromString("https://oneuptime.example/public-dashboard-api"),
      postJSON: async () => {
        throw new Error("No read in this test.");
      },
      apiClient: API,
    });
  });

  test("the log, trace and Data Source charts, which say they are not available there, keep their three rows", () => {
    renderBoard();

    expect(screen.getByTestId(DASHBOARD_BOARD_TEST_ID)).toHaveAttribute(
      "data-arrangement",
      DashboardBoardArrangement.Stacked,
    );

    for (const key of ["logs", "traces", "dataSource"]) {
      expect(heightOf(key)).toBe(THREE_ROWS);
      expect(wrapperHeight(key)).toBe(`${THREE_ROWS}px`);
    }
  });

  test("a metric chart, which a public dashboard draws, keeps a chart's 400px", () => {
    renderBoard();

    expect(heightOf("metrics")).toBe(400);
    expect(wrapperHeight("metrics")).toBe("400px");
    // A widget that is no chart is as tall as its rows, as ever.
    expect(heightOf("title")).toBe(70);
  });
});

describe("inside OneUptime, where every chart is drawn", () => {
  test("every chart keeps a chart's 400px on a phone", () => {
    renderBoard();

    for (const key of ["metrics", "logs", "traces", "dataSource"]) {
      expect(heightOf(key)).toBe(400);
    }
  });
});

/*
 * The list the board reads is the widgets' own word: each widget it names
 * says, on a public dashboard, that it is not available there - and no
 * widget it leaves out does. Read from the widgets' sources, through the
 * registry that picks a widget for each type (DashboardBaseComponent).
 */
describe("the widgets a public dashboard cannot draw", () => {
  const COMPONENTS_DIR: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Components",
    "Dashboard",
    "Components",
  );

  // `[DashboardComponentType.LogChart]: DashboardLogChartComponent,`
  const REGISTRY_ENTRY: RegExp = /\[DashboardComponentType\.(\w+)\]:\s*(\w+),/g;
  // `import DashboardLogChartComponent from "./DashboardLogChartComponent";`
  const WIDGET_IMPORT: RegExp = /^import (\w+) from "\.\/(\w+)";$/gm;

  // What a widget that declines on a public dashboard writes or draws there.
  const NOT_AVAILABLE_HERE: string = "not available on public dashboards";
  const DATA_SOURCE_PLACEHOLDER: string = "<DataSourceWidgetPlaceholder";

  function widgetSourcesByType(): Map<string, string> {
    const registry: string = fs.readFileSync(
      path.join(COMPONENTS_DIR, "DashboardBaseComponent.tsx"),
      "utf8",
    );
    const fileByIdentifier: Map<string, string> = new Map<string, string>();

    for (const match of registry.matchAll(WIDGET_IMPORT)) {
      fileByIdentifier.set(match[1]!, `${match[2]!}.tsx`);
    }

    const sources: Map<string, string> = new Map<string, string>();

    for (const match of registry.matchAll(REGISTRY_ENTRY)) {
      const file: string | undefined = fileByIdentifier.get(match[2]!);

      if (file) {
        sources.set(
          match[1]!,
          fs.readFileSync(path.join(COMPONENTS_DIR, file), "utf8"),
        );
      }
    }

    return sources;
  }

  function declinesOnPublicDashboards(source: string): boolean {
    return (
      source.includes(NOT_AVAILABLE_HERE) ||
      source.includes(DATA_SOURCE_PLACEHOLDER)
    );
  }

  test("every widget type has a widget the registry draws", () => {
    const sources: Map<string, string> = widgetSourcesByType();

    for (const componentType of Object.values(DashboardComponentType)) {
      expect(sources.has(componentType)).toBe(true);
    }
  });

  test("each widget the board names declines on a public dashboard, saying so in its place", () => {
    const sources: Map<string, string> = widgetSourcesByType();

    for (const componentType of PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES) {
      expect({
        componentType,
        declines: declinesOnPublicDashboards(sources.get(componentType)!),
      }).toEqual({ componentType, declines: true });
    }
  });

  test("and every widget it leaves out is drawn there", () => {
    const sources: Map<string, string> = widgetSourcesByType();

    for (const [componentType, source] of sources) {
      if (
        PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES.includes(
          componentType as DashboardComponentType,
        )
      ) {
        continue;
      }

      expect({
        componentType,
        declines: declinesOnPublicDashboards(source),
      }).toEqual({ componentType, declines: false });
    }
  });
});
