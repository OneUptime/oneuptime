import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { SpyInstance } from "jest-mock";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4571 on the public dashboard, which draws the same canvas: a
 * dashboard whose stored config is not the editor's shape, or holds a widget
 * that cannot be drawn, opens for its anonymous visitors with what can be
 * shown.
 *
 * The fake public API answers /view-config the way the real route does:
 * the STORED config goes through the server's own sanitizer
 * (PublicDashboardViewConfig.sanitize) and is serialized - so this also
 * pins that a config stored as the API reference's envelope reaches the
 * visitor with its Data Source widgets stripped, not as it was stored.
 */

const SQL_SECRET: string = "SELECT * FROM internal_billing_accounts";

let clockThrows: boolean = false;

const publicPostMock: MockFunction = getJestMockFunction();

jest.mock("../../../../App/FeatureSet/PublicDashboard/src/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return publicPostMock(...args);
      },
      getFriendlyErrorMessage: (err: Error) => {
        return err.message;
      },
    },
  };
});

// The Clock widget, made to throw while it draws when the test says so.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardClockComponent",
  () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: () => {
        if (clockThrows) {
          throw new Error("internal stack detail");
        }

        return reactModule.createElement(
          "div",
          { "data-testid": "clock-widget" },
          "Clock drawn",
        );
      },
    };
  },
);

import DashboardViewPage from "../../../../App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardViewPage";
import { DASHBOARD_WIDGET_FALLBACK_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetFallback";
import PublicDashboardViewConfig from "../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";

const DASHBOARD_ID: ObjectID = new ObjectID(
  "d4d4d4d4-1111-4111-8111-d4d4d4d4d4d4",
);

class AppErrorPage extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  public constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  public static getDerivedStateFromError(error: Error): { error: Error } {
    return { error: error };
  }

  public override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div data-testid="app-error-page">{`${this.state.error.name}: ${this.state.error.message}`}</div>
      );
    }

    return this.props.children;
  }
}

function textWidget(id: string, text: string, left: number = 0): JSONObject {
  return {
    componentId: id,
    componentType: "Text",
    topInDashboardUnits: 0,
    leftInDashboardUnits: left,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 2,
    arguments: { text: text },
  };
}

function widgetOfType(id: string, componentType: string): JSONObject {
  return {
    componentId: id,
    componentType: componentType,
    topInDashboardUnits: 2,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 4,
    arguments: {},
  };
}

// What /view-config sends for this stored value, as the real route builds it.
let lastServedJson: string = "";

function serveStored(stored: unknown): void {
  publicPostMock.mockImplementation((...args: Array<any>) => {
    const url: string = String(args[0]?.url || "");

    if (!url.includes("/view-config/")) {
      return Promise.resolve({
        isFailure: (): boolean => {
          return true;
        },
        data: {},
      });
    }

    const publicViewConfig: DashboardViewConfig | null =
      PublicDashboardViewConfig.sanitize(stored as DashboardViewConfig);

    const served: JSONObject = {
      name: "Status board",
      dashboardViewConfig: publicViewConfig
        ? JSONFunctions.serialize(publicViewConfig as unknown as JSONObject)
        : null,
    };

    // Over the wire.
    lastServedJson = JSON.stringify(served);

    return Promise.resolve({
      isFailure: (): boolean => {
        return false;
      },
      data: JSONFunctions.deserialize(JSON.parse(lastServedJson) as JSONObject),
    });
  });
}

async function openPublicDashboard(): Promise<void> {
  render(
    <AppErrorPage>
      <DashboardViewPage dashboardId={DASHBOARD_ID} />
    </AppErrorPage>,
  );

  await waitFor(() => {
    expect(
      screen.queryByText("Status board") ||
        screen.queryByTestId("app-error-page"),
    ).not.toBeNull();
  });
}

function fallbacks(): Array<HTMLElement> {
  return screen.queryAllByTestId(DASHBOARD_WIDGET_FALLBACK_TEST_ID);
}

let consoleErrorSpy: SpyInstance<typeof console.error>;

beforeEach(() => {
  clockThrows = false;
  lastServedJson = "";
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  consoleErrorSpy.mockRestore();
});

describe("issue #4571: a public dashboard whose stored config is not the editor's shape opens", () => {
  test("the API reference's envelope: the visitor sees its widgets, and never its Data Source queries", async () => {
    serveStored({
      _type: "DashboardViewConfig",
      value: {
        components: [
          textWidget("550e8400-e29b-41d4-a716-446655440000", "Checkout service"),
          {
            ...widgetOfType(
              "550e8400-e29b-41d4-a716-446655440001",
              "DataSourceChart",
            ),
            arguments: { queries: [{ dataSourceId: "ds", query: SQL_SECRET }] },
          },
        ],
      },
    });

    await openPublicDashboard();

    expect(screen.queryByTestId("app-error-page")).toBeNull();
    expect(screen.getByText("Checkout service")).toBeInTheDocument();
    expect(lastServedJson).not.toContain(SQL_SECRET);
    expect(document.body.textContent).not.toContain(SQL_SECRET);
  });

  test("no widget list: the empty board", async () => {
    serveStored({});

    await openPublicDashboard();

    expect(screen.queryByTestId("app-error-page")).toBeNull();
    expect(
      screen.getByText("This dashboard does not have any widgets."),
    ).toBeInTheDocument();
  });

  test("the config stored as JSON text: its widgets", async () => {
    serveStored(
      JSON.stringify({
        components: [
          textWidget("550e8400-e29b-41d4-a716-446655440000", "From text"),
        ],
      }),
    );

    await openPublicDashboard();

    expect(screen.queryByTestId("app-error-page")).toBeNull();
    expect(screen.getByText("From text")).toBeInTheDocument();
  });

  test("a widget saved without arguments draws its own empty state", async () => {
    const widget: JSONObject = textWidget(
      "550e8400-e29b-41d4-a716-446655440000",
      "x",
    );
    delete widget["arguments"];
    serveStored({ components: [widget] });

    await openPublicDashboard();

    expect(screen.queryByTestId("app-error-page")).toBeNull();
    expect(screen.getByText("No text configured")).toBeInTheDocument();
  });
});

describe("a widget the public dashboard cannot draw", () => {
  test("a type this version does not draw: the visitor is told only that it could not be shown", async () => {
    serveStored({
      components: [
        textWidget("550e8400-e29b-41d4-a716-446655440000", "Checkout service"),
        widgetOfType("550e8400-e29b-41d4-a716-446655440002", "HostMetricChart"),
      ],
    });

    await openPublicDashboard();

    expect(screen.queryByTestId("app-error-page")).toBeNull();
    expect(screen.getByText("Checkout service")).toBeInTheDocument();

    const [fallback] = fallbacks();
    expect(fallback).toHaveTextContent("This widget could not be shown");
    expect(fallback).not.toHaveTextContent("HostMetricChart");
    expect(within(fallback!).queryAllByRole("button")).toHaveLength(0);
  });

  test("a widget that throws: replaced in its place, with Try again and no error text", async () => {
    clockThrows = true;
    serveStored({
      components: [
        textWidget("550e8400-e29b-41d4-a716-446655440000", "Checkout service"),
        widgetOfType("550e8400-e29b-41d4-a716-446655440003", "Clock"),
      ],
    });

    await openPublicDashboard();

    expect(screen.queryByTestId("app-error-page")).toBeNull();
    expect(screen.getByText("Checkout service")).toBeInTheDocument();

    const [fallback] = fallbacks();
    expect(fallback).toHaveAttribute("data-problem", "Crashed");
    expect(fallback).not.toHaveTextContent("internal stack detail");
    expect(
      within(fallback!).queryByTestId("dashboard-widget-fallback-edit"),
    ).toBeNull();

    clockThrows = false;
    fireEvent.click(
      within(fallback!).getByTestId("dashboard-widget-fallback-retry"),
    );

    expect(await screen.findByTestId("clock-widget")).toBeInTheDocument();
  });

  test("widgets stored without ids, or sharing one, are each drawn once", async () => {
    const first: JSONObject = textWidget("", "First", 0);
    const second: JSONObject = textWidget("", "Second", 6);
    delete first["componentId"];
    delete second["componentId"];

    serveStored({
      components: [
        first,
        second,
        textWidget("550e8400-e29b-41d4-a716-446655440009", "Third", 0),
        textWidget("550e8400-e29b-41d4-a716-446655440009", "Fourth", 6),
      ],
    });

    await openPublicDashboard();

    expect(screen.queryByTestId("app-error-page")).toBeNull();

    for (const text of ["First", "Second", "Third", "Fourth"]) {
      expect(screen.getAllByText(text)).toHaveLength(1);
    }
  });
});
