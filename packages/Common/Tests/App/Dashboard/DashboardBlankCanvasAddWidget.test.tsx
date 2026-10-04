import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React, { act } from "react";

/*
 * A dashboard made from Blank Dashboard opens on its empty canvas - Create
 * Dashboard now goes straight to the new dashboard. Its next step is its
 * first widget, but the way in was Edit Dashboard in the toolbar's ⋯ menu,
 * then Add Widget, and the canvas only said "This dashboard does not have
 * any widgets." The empty canvas now has its own Add Widget for someone
 * who may edit the board: one click into edit mode with the widget catalog
 * open. A reader is never offered it (the board's edit gate, issue #3550).
 *
 * The board is driven as DashboardEditPermissions drives it: the real
 * DashboardViewer and toolbar against a fake dashboard API, with the canvas
 * stubbed (it is ~60 widget modules deep) - the stub publishes what it was
 * handed. The empty canvas itself (BlankCanvas, and DashboardCanvas
 * handing it the handler) is rendered for real below.
 */

jest.setTimeout(120000);

const DASHBOARD_ID: string = "33333333-3333-4333-8333-333333333333";

let permissionsForTest: Array<unknown> = [];

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

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
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

/*
 * The canvas, for the board tests: it shows whether it was handed the
 * empty board's Add Widget, as a button that calls it, and what it holds.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index",
  () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: (props: {
        isEditMode?: boolean | undefined;
        onAddWidgetClick?: (() => void) | undefined;
        dashboardViewConfig: { components: Array<unknown> };
      }) => {
        return reactModule.createElement(
          "div",
          {
            "data-testid": "canvas-stub",
            "data-is-edit-mode": props.isEditMode ? "true" : "false",
            "data-widget-count": String(
              props.dashboardViewConfig.components.length,
            ),
          },
          props.onAddWidgetClick
            ? reactModule.createElement(
                "button",
                {
                  type: "button",
                  "data-testid": "canvas-stub-add-widget",
                  onClick: props.onAddWidgetClick,
                },
                "Add Widget",
              )
            : null,
        );
      },
    };
  },
);

import DashboardViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView";
import BlankCanvasElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/BlankCanvas";
import ObjectID from "../../../Types/ObjectID";
import { ObjectType } from "../../../Types/JSON";
import DefaultDashboardSize from "../../../Types/Dashboard/DashboardSize";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import Permission from "../../../Types/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn: number = 0; turn < 5; turn++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

async function renderBoard(): Promise<void> {
  render(<DashboardViewer dashboardId={new ObjectID(DASHBOARD_ID)} />);
  await waitFor(() => {
    expect(screen.getByTestId("canvas-stub")).toBeInTheDocument();
  });
  await settle();
}

function canvas(): HTMLElement {
  return screen.getByTestId("canvas-stub");
}

function isEditing(): boolean {
  return canvas().getAttribute("data-is-edit-mode") === "true";
}

function queryCanvasAddWidget(): HTMLElement | null {
  return screen.queryByTestId("canvas-stub-add-widget");
}

function queryWidgetCatalog(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: "Add Widget" });
}

beforeEach(() => {
  permissionsForTest = [];
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState({}, "", `/dashboard/${DASHBOARD_ID}`);

  // A dashboard made from Blank Dashboard: no widgets.
  getItemMock.mockImplementation(() => {
    return Promise.resolve({
      dashboardViewConfig: {
        _type: ObjectType.DashboardViewConfig,
        components: [],
        heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
      },
      name: "Checkout on-call",
      description: "",
      pageTitle: null,
      pageDescription: null,
    });
  });

  updateByIdMock.mockImplementation(() => {
    return Promise.resolve();
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("the empty canvas", () => {
  test("offers Add Widget to someone who may edit, saying what it is for", () => {
    let clicks: number = 0;

    render(
      <BlankCanvasElement
        isEditMode={false}
        onAddWidgetClick={() => {
          clicks += 1;
        }}
      />,
    );

    const blank: HTMLElement = screen.getByTestId("dashboard-blank-canvas");
    expect(within(blank).getByText("No widgets yet")).toBeInTheDocument();
    expect(
      within(blank).getByText(
        "Add a chart, a number or a list to start this dashboard.",
      ),
    ).toBeInTheDocument();

    const button: HTMLElement = within(blank).getByTestId(
      "dashboard-blank-canvas-add-widget",
    );
    expect(button).toHaveTextContent("Add Widget");

    fireEvent.click(button);
    expect(clicks).toBe(1);
  });

  test("is only a sentence for a reader: nothing to click", () => {
    render(<BlankCanvasElement isEditMode={false} />);

    expect(
      screen.getByText("This dashboard does not have any widgets."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("dashboard-blank-canvas-add-widget"),
    ).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("while editing, points at the toolbar's Add Widget instead of repeating it", () => {
    render(
      <BlankCanvasElement
        isEditMode={true}
        onAddWidgetClick={() => {
          return undefined;
        }}
      />,
    );

    expect(
      screen.getByText(
        "Add your first widget from the toolbar above. You can drag and resize widgets anywhere on the grid.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("dashboard-blank-canvas-add-widget"),
    ).toBeNull();
  });
});

describe("a new, empty dashboard opened by someone who may edit it", () => {
  beforeEach(() => {
    permissionsForTest = [Permission.Viewer, Permission.EditDashboard];
  });

  test("shows Add Widget on its canvas, in view mode", async () => {
    await renderBoard();

    expect(isEditing()).toBe(false);
    expect(queryCanvasAddWidget()).not.toBeNull();
    expect(queryWidgetCatalog()).toBeNull();
  });

  test("Add Widget goes into edit mode with the widget catalog open", async () => {
    await renderBoard();

    await act(async () => {
      fireEvent.click(queryCanvasAddWidget()!);
    });

    expect(isEditing()).toBe(true);
    expect(queryWidgetCatalog()).not.toBeNull();
    // The board is being edited: its own Save and Cancel are there.
    expect(screen.getByText("Save Changes")).toBeInTheDocument();
  });

  test("the widget picked lands on the board, ready to save", async () => {
    await renderBoard();

    await act(async () => {
      fireEvent.click(queryCanvasAddWidget()!);
    });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId(`widget-card-${DashboardComponentType.Text}`),
      );
    });

    expect(queryWidgetCatalog()).toBeNull();
    expect(canvas().getAttribute("data-widget-count")).toBe("1");
    expect(isEditing()).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByText("Save Changes"));
    });
    await settle();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(isEditing()).toBe(false);
  });

  test("closing the catalog leaves the board in edit mode, and the toolbar's Add Widget opens it again", async () => {
    await renderBoard();

    await act(async () => {
      fireEvent.click(queryCanvasAddWidget()!);
    });
    await act(async () => {
      fireEvent.click(
        within(queryWidgetCatalog()!).getByRole("button", { name: "Cancel" }),
      );
    });

    expect(queryWidgetCatalog()).toBeNull();
    expect(isEditing()).toBe(true);

    await act(async () => {
      fireEvent.click(screen.getByTitle("Add Widget"));
    });

    expect(queryWidgetCatalog()).not.toBeNull();
  });

  test("Edit Dashboard in the ⋯ menu still opens the editor without the catalog", async () => {
    await renderBoard();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("More dashboard options"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Edit Dashboard"));
    });

    expect(isEditing()).toBe(true);
    expect(queryWidgetCatalog()).toBeNull();
  });
});

describe("an empty dashboard opened by a reader", () => {
  test("offers no Add Widget: the canvas is handed none", async () => {
    permissionsForTest = [Permission.Viewer, Permission.MonitorViewer];

    await renderBoard();

    expect(queryCanvasAddWidget()).toBeNull();
    expect(isEditing()).toBe(false);
  });

  test("nor before the permission snapshot has landed", async () => {
    permissionsForTest = [];

    await renderBoard();

    expect(queryCanvasAddWidget()).toBeNull();
  });
});
