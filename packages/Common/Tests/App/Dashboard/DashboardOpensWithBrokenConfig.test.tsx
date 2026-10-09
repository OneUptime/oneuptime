import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
import React from "react";
import { SpyInstance } from "jest-mock";

/*
 * Issue #4571, end to end on the real board: a dashboard whose stored config
 * is not the shape the editor saves never opened - "Cannot read properties
 * of undefined (reading 'length')" in DashboardCanvas, and the app's error
 * page in its place. The config came back from the API as stored: the
 * envelope the API reference documented, `{}`, JSON text, widgets without
 * arguments.
 *
 * The real DashboardViewer, toolbar, canvas and widgets are rendered against
 * a fake dashboard API, inside a boundary that stands for the app's own
 * error page: nothing may reach it. One widget module (the Clock) is swapped
 * for one that throws on demand, and the settings form for a stub that can
 * throw too, so a widget that fails while drawing - and a settings form that
 * cannot read what was saved - can be driven from here.
 */

jest.setTimeout(120000);

const DASHBOARD_ID: string = "33333333-3333-4333-8333-333333333333";
const TEXT_WIDGET_ID: string = "550e8400-e29b-41d4-a716-446655440000";
const BROKEN_WIDGET_ID: string = "550e8400-e29b-41d4-a716-446655440001";

let permissionsForTest: Array<unknown> = [];
let clockThrows: boolean = false;
let argumentsFormThrows: boolean = false;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [...permissionsForTest] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

const getItemMock: jest.Mock<any> = jest.fn() as jest.Mock<any>;
const updateByIdMock: jest.Mock<any> = jest.fn() as jest.Mock<any>;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (err: Error): string => {
        return err.message;
      },
      getFriendlyMessage: (err: Error): string => {
        return err.message;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        loadAllMetricsTypes: () => {
          return Promise.resolve({ metricTypes: [], telemetryAttributes: [] });
        },
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributeValues: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

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
          throw new Error(
            "Cannot read properties of undefined (reading 'zone')",
          );
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

// The settings form is not under test - what happens when it throws is.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm",
  () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: () => {
        if (argumentsFormThrows) {
          throw new Error("Cannot read properties of null (reading 'map')");
        }

        return reactModule.createElement("div", {
          "data-testid": "arguments-form-stub",
        });
      },
    };
  },
);

import DashboardViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView";
import { DASHBOARD_WIDGET_FALLBACK_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardWidgetFallback";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";

// Stands for the app's error page: a throw anywhere under it shows here.
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

function textWidget(text: string = "Checkout service"): JSONObject {
  return {
    componentId: TEXT_WIDGET_ID,
    componentType: "Text",
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 2,
    arguments: { text: text },
  };
}

function widgetOfType(componentType: string): JSONObject {
  return {
    componentId: BROKEN_WIDGET_ID,
    componentType: componentType,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 6,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 4,
    arguments: {},
  };
}

function storeConfig(dashboardViewConfig: unknown): void {
  getItemMock.mockImplementation(() => {
    return Promise.resolve({
      dashboardViewConfig: dashboardViewConfig,
      name: "Checkout on-call",
      description: "",
      pageTitle: null,
      pageDescription: null,
    });
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn: number = 0; turn < 5; turn++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

async function openDashboard(): Promise<void> {
  render(
    <AppErrorPage>
      <DashboardViewer dashboardId={new ObjectID(DASHBOARD_ID)} />
    </AppErrorPage>,
  );

  await waitFor(() => {
    expect(
      screen.queryByText("More dashboard options") ||
        screen.queryByLabelText("More dashboard options") ||
        screen.queryByTestId("app-error-page"),
    ).not.toBeNull();
  });
  await settle();
}

function expectTheDashboardOpened(): void {
  expect(screen.queryByTestId("app-error-page")).toBeNull();
}

function boardFallbacks(): Array<HTMLElement> {
  return screen.queryAllByTestId(DASHBOARD_WIDGET_FALLBACK_TEST_ID);
}

function settingsDialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "Component Settings" });
}

/*
 * jsdom has no ResizeObserver, and the settings dialog measures its preview
 * with one (a browser always has it). Report a real width.
 */
class FakeResizeObserver {
  private callback: ResizeObserverCallback;

  public constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  public observe(): void {
    this.callback(
      [{ contentRect: { width: 800 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }

  public unobserve(): void {
    // Nothing to stop observing.
  }

  public disconnect(): void {
    // Nothing to disconnect.
  }
}

const ORIGINAL_RESIZE_OBSERVER: unknown = (
  globalThis as unknown as { ResizeObserver: unknown }
).ResizeObserver;

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    FakeResizeObserver;
});

afterAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ORIGINAL_RESIZE_OBSERVER;
});

let consoleErrorSpy: SpyInstance<typeof console.error>;

beforeEach(() => {
  permissionsForTest = [Permission.Viewer, Permission.EditDashboard];
  clockThrows = false;
  argumentsFormThrows = false;
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState({}, "", `/dashboard/${DASHBOARD_ID}`);
  updateByIdMock.mockImplementation(() => {
    return Promise.resolve();
  });

  // A widget that throws is reported by React and by its boundary.
  consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  consoleErrorSpy.mockRestore();
});

describe("issue #4571: a dashboard whose stored config is not the editor's shape opens", () => {
  test("the API reference's envelope: the widgets under `value` are drawn", async () => {
    storeConfig({
      _type: "DashboardViewConfig",
      value: { components: [textWidget("Hello from the envelope")] },
    });

    await openDashboard();

    expectTheDashboardOpened();
    expect(screen.getByText("Hello from the envelope")).toBeInTheDocument();
    expect(boardFallbacks()).toHaveLength(0);
  });

  test("no widget list at all: the empty board", async () => {
    storeConfig({});

    await openDashboard();

    expectTheDashboardOpened();
    expect(screen.getByTestId("dashboard-blank-canvas")).toBeInTheDocument();
  });

  test("the config stored as JSON text: its widgets are drawn", async () => {
    storeConfig(JSON.stringify({ components: [textWidget("From text")] }));

    await openDashboard();

    expectTheDashboardOpened();
    expect(screen.getByText("From text")).toBeInTheDocument();
  });

  test("a widget saved without arguments draws its own empty state", async () => {
    const widget: JSONObject = textWidget();
    delete widget["arguments"];
    storeConfig({ components: [widget] });

    await openDashboard();

    expectTheDashboardOpened();
    expect(screen.getByText("No text configured")).toBeInTheDocument();
  });

  test("a widget list that is not a list: the empty board, not an error", async () => {
    storeConfig({ components: "not a list", heightInDashboardUnits: "tall" });

    await openDashboard();

    expectTheDashboardOpened();
    expect(screen.getByTestId("dashboard-blank-canvas")).toBeInTheDocument();
  });

  test("junk among the widgets is left out and the widgets are drawn", async () => {
    storeConfig({ components: [null, 42, textWidget("Still here"), "x"] });

    await openDashboard();

    expectTheDashboardOpened();
    expect(screen.getByText("Still here")).toBeInTheDocument();
  });

  test("malformed variables do not take the toolbar down", async () => {
    storeConfig({
      components: [textWidget()],
      variables: [
        null,
        { name: "env", customListValues: 12, labelOptions: "x" },
        { id: "c", name: "cluster", selectedValues: "prod" },
      ],
      refreshInterval: "every so often",
    });

    await openDashboard();

    expectTheDashboardOpened();
    expect(screen.getByText("Checkout service")).toBeInTheDocument();
  });
});

describe("a widget of a type this version does not draw", () => {
  beforeEach(() => {
    storeConfig({
      components: [textWidget(), widgetOfType("HostMetricChart")],
    });
  });

  test("shows that it could not be shown, in its own place, beside the widgets that can", async () => {
    await openDashboard();

    expectTheDashboardOpened();
    expect(screen.getByText("Checkout service")).toBeInTheDocument();

    const [fallback] = boardFallbacks();
    expect(fallback).toHaveTextContent("This widget could not be shown");
    expect(fallback).toHaveTextContent(
      'OneUptime has no "HostMetricChart" widget.',
    );

    // In the widget's own card on the board.
    expect(
      fallback!.closest(`#dashboard-component-${BROKEN_WIDGET_ID}`),
    ).not.toBeNull();
  });

  test("someone who may edit gets Edit widget: edit mode with its settings, saying there is nothing to set", async () => {
    await openDashboard();

    fireEvent.click(
      within(boardFallbacks()[0]!).getByTestId(
        "dashboard-widget-fallback-edit",
      ),
    );
    await settle();

    // The board is being edited...
    expect(screen.getByText("Save Changes")).toBeInTheDocument();

    // ...with this widget's settings open.
    const dialog: HTMLElement = settingsDialog();
    expect(
      within(dialog).getByTestId("widget-settings-unknown-type"),
    ).toHaveTextContent(
      'OneUptime has no "HostMetricChart" widget, so there are no settings to change. Delete it to take it off this dashboard.',
    );
    expect(within(dialog).queryByTestId("arguments-form-stub")).toBeNull();
    // A copy would be just as broken.
    expect(within(dialog).queryByText("Duplicate Widget")).toBeNull();
    expect(within(dialog).getByText("Delete Widget")).toBeInTheDocument();
  });

  test("Delete Widget takes it off, and Save Changes writes the board without it, in the editor's shape", async () => {
    await openDashboard();

    fireEvent.click(
      within(boardFallbacks()[0]!).getByTestId(
        "dashboard-widget-fallback-edit",
      ),
    );
    await settle();

    fireEvent.click(within(settingsDialog()).getByText("Delete Widget"));
    await settle();

    const confirm: HTMLElement = screen.getByRole("dialog", {
      name: "Delete Widget?",
    });
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Delete Widget" }),
    );
    await settle();

    expectTheDashboardOpened();
    expect(
      screen.queryByRole("dialog", { name: "Component Settings" }),
    ).toBeNull();
    expect(boardFallbacks()).toHaveLength(0);
    expect(screen.getByText("Checkout service")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("Save Changes"));
    });
    await settle();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    const saved: JSONObject = (
      updateByIdMock.mock.calls[0]![0] as { data: JSONObject }
    ).data["dashboardViewConfig"] as JSONObject;
    const savedJson: JSONObject = JSON.parse(JSON.stringify(saved));

    expect(savedJson["_type"]).toBe("DashboardViewConfig");
    expect(Array.isArray(savedJson["components"])).toBe(true);
    expect(
      (savedJson["components"] as Array<JSONObject>).map(
        (component: JSONObject) => {
          return component["componentType"];
        },
      ),
    ).toEqual(["Text"]);
  });

  test("a reader is told it could not be shown, and offered nothing to click", async () => {
    permissionsForTest = [Permission.Viewer, Permission.MonitorViewer];

    await openDashboard();

    const [fallback] = boardFallbacks();
    expect(fallback).toHaveTextContent("This widget could not be shown");
    expect(within(fallback!).queryAllByRole("button")).toHaveLength(0);
  });

  test("while the board is edited, it says the widget itself opens its settings", async () => {
    await openDashboard();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("More dashboard options"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Edit Dashboard"));
    });
    await settle();

    const [fallback] = boardFallbacks();
    expect(
      within(fallback!).getByTestId("dashboard-widget-fallback-edit-hint"),
    ).toHaveTextContent("Click it to edit or delete it.");
    expect(within(fallback!).queryAllByRole("button")).toHaveLength(0);
  });

  test("a widget with no type at all is shown the same way", async () => {
    const untyped: JSONObject = widgetOfType("Chart");
    delete untyped["componentType"];
    storeConfig({ components: [textWidget(), untyped] });

    await openDashboard();

    expectTheDashboardOpened();
    expect(boardFallbacks()[0]).toHaveTextContent(
      "It does not say which kind of widget it is.",
    );
  });
});

describe("a widget that throws while it draws", () => {
  beforeEach(() => {
    clockThrows = true;
    storeConfig({
      components: [textWidget(), widgetOfType("Clock")],
    });
  });

  test("only that widget is replaced: the dashboard and the other widgets stay", async () => {
    await openDashboard();

    expectTheDashboardOpened();
    expect(screen.getByText("Checkout service")).toBeInTheDocument();

    const [fallback] = boardFallbacks();
    expect(fallback).toHaveAttribute("data-problem", "Crashed");
    expect(fallback).toHaveTextContent(
      "Something went wrong while drawing it.",
    );
    expect(
      within(fallback!).getByTestId("dashboard-widget-fallback-details"),
    ).toHaveTextContent("Cannot read properties of undefined (reading 'zone')");
    expect(
      fallback!.closest(`#dashboard-component-${BROKEN_WIDGET_ID}`),
    ).not.toBeNull();
  });

  test("Try again draws it again once it can be", async () => {
    await openDashboard();

    clockThrows = false;
    fireEvent.click(
      within(boardFallbacks()[0]!).getByTestId(
        "dashboard-widget-fallback-retry",
      ),
    );
    await settle();

    expect(boardFallbacks()).toHaveLength(0);
    expect(screen.getByTestId("clock-widget")).toHaveTextContent("Clock drawn");
  });

  test("Edit widget opens its settings; a settings form that throws says so, and Delete Widget still works", async () => {
    argumentsFormThrows = true;

    await openDashboard();

    fireEvent.click(
      within(boardFallbacks()[0]!).getByTestId(
        "dashboard-widget-fallback-edit",
      ),
    );
    await settle();

    expectTheDashboardOpened();

    const dialog: HTMLElement = settingsDialog();
    expect(
      within(dialog).getByTestId("widget-settings-unavailable"),
    ).toHaveTextContent(
      "These settings could not be shown. You can still delete this widget and add it again.",
    );
    // A known widget type can be copied.
    expect(within(dialog).getByText("Duplicate Widget")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText("Delete Widget"));
    await settle();
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Delete Widget?" })).getByRole(
        "button",
        { name: "Delete Widget" },
      ),
    );
    await settle();

    expectTheDashboardOpened();
    expect(boardFallbacks()).toHaveLength(0);
    expect(screen.getByText("Checkout service")).toBeInTheDocument();
  });

  test("a reader gets Try again, but not Edit widget", async () => {
    permissionsForTest = [Permission.Viewer, Permission.MonitorViewer];

    await openDashboard();

    const fallback: HTMLElement = boardFallbacks()[0]!;
    expect(
      within(fallback).getByTestId("dashboard-widget-fallback-retry"),
    ).toBeInTheDocument();
    expect(
      within(fallback).queryByTestId("dashboard-widget-fallback-edit"),
    ).toBeNull();
  });
});

describe("saving a dashboard that was stored in another shape", () => {
  test("writes it back in the shape the editor saves: widgets at the top, no envelope", async () => {
    storeConfig({
      _type: "DashboardViewConfig",
      value: { components: [textWidget("Hello from the envelope")] },
    });

    await openDashboard();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("More dashboard options"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Edit Dashboard"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Save Changes"));
    });
    await settle();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);

    const saved: JSONObject = JSON.parse(
      JSON.stringify(
        (updateByIdMock.mock.calls[0]![0] as { data: JSONObject }).data[
          "dashboardViewConfig"
        ],
      ),
    ) as JSONObject;

    expect(saved["value"]).toBeUndefined();
    expect(saved["_type"]).toBe("DashboardViewConfig");

    const components: Array<JSONObject> = saved[
      "components"
    ] as Array<JSONObject>;
    expect(components).toHaveLength(1);
    expect(components[0]!["componentType"]).toBe("Text");
    expect(components[0]!["arguments"]).toEqual({
      text: "Hello from the envelope",
    });
    expect(JSON.stringify(components[0]!["componentId"])).toContain(
      TEXT_WIDGET_ID,
    );
  });
});
