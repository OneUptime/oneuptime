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
import React, { act, FunctionComponent, ReactElement } from "react";
import {
  BrowserRouter,
  Route as RouterRoute,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

/*
 * Leaving a dashboard that is being edited (issue #7173). Until Save
 * Changes the new layout lives only in the page, and a click in the side
 * menu, the browser's Back button or closing the tab dropped every unsaved
 * widget without a word. Now, while the board differs from the one editing
 * started from:
 *
 *   - the side menu (any link into the app) and Back ask first, worded like
 *     the toolbar's Cancel: Keep Editing stays, Discard Changes leaves;
 *   - closing or reloading the tab asks through the browser (beforeunload);
 *   - a new version of OneUptime does not reload the page under it
 *     (useUnsavedChanges).
 *
 * A board opened for editing and left as it was asks nothing, and nothing
 * asks after Save Changes or Discard Changes.
 *
 * The real DashboardViewer, toolbar and side menu entry run inside a real
 * BrowserRouter on jsdom's history, against a fake dashboard API. The
 * canvas is stubbed (it is ~60 widget modules deep): it shows how many
 * widgets it holds and whether it is being edited.
 */

jest.setTimeout(120000);

const PROJECT_ID: string = "44444444-4444-4444-8444-444444444441";
const DASHBOARD_ID: string = "44444444-4444-4444-8444-444444444442";
const DASHBOARDS_PATH: string = `/dashboard/${PROJECT_ID}/dashboards`;
const BOARD_PATH: string = `${DASHBOARDS_PATH}/${DASHBOARD_ID}`;
const MONITORS_PATH: string = `/dashboard/${PROJECT_ID}/monitors`;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      // Permission.ProjectAdmin: someone who may edit the board.
      getAllPermissions: (): Array<string> => {
        return ["ProjectAdmin"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
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
        dashboardViewConfig: { components: Array<unknown> };
      }) => {
        return reactModule.createElement("div", {
          "data-testid": "canvas-stub",
          "data-is-edit-mode": props.isEditMode ? "true" : "false",
          "data-widget-count": String(
            props.dashboardViewConfig.components.length,
          ),
        });
      },
    };
  },
);

import DashboardViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView";
import Route from "../../../Types/API/Route";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DefaultDashboardSize from "../../../Types/Dashboard/DashboardSize";
import DashboardTextComponentUtil from "../../../Utils/Dashboard/Components/DashboardTextComponent";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import LeaveGuard from "../../../UI/Utils/LeaveGuard";
import Navigation from "../../../UI/Utils/Navigation";
import UnsavedChanges from "../../../UI/Utils/NewVersion/UnsavedChanges";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { afterHistorySteps } from "../../Helpers/HistorySteps";

const LEAVE_TITLE: string = "Leave without saving?";
const LEAVE_DESCRIPTION: string =
  "You have unsaved changes to this dashboard. If you leave now, they will be lost.";
/*
 * The toolbar Cancel's question, in the leave question's voice: both open
 * with the same sentence (DashboardLeaveQuestionInLocale holds every
 * language to it).
 */
const CANCEL_TITLE: string = "Discard unsaved changes?";
const CANCEL_DESCRIPTION: string =
  "You have unsaved changes to this dashboard. If you discard them, the dashboard goes back to how it was last saved.";
// What Cancel asked before: "Are you sure?" twice over.
const OLD_CANCEL_TITLE: string = "Are you sure?";
const OLD_CANCEL_DESCRIPTION: string =
  "You have unsaved changes. Are you sure you want to cancel?";

/*
 * The app around the board, as the Dashboard app draws it: the router's
 * navigate handed to Navigation (App.tsx), a side menu entry for another
 * page, and the pages themselves.
 */
const AppShell: FunctionComponent = (): ReactElement => {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());

  return (
    <div>
      <nav aria-label="Side menu">
        <SideMenuItem
          link={{ title: "Monitors", to: new Route(MONITORS_PATH) }}
        />
      </nav>
      <Routes>
        <RouterRoute
          path="/dashboard/:projectId/dashboards"
          element={<p>All dashboards</p>}
        />
        <RouterRoute
          path="/dashboard/:projectId/dashboards/:id"
          element={<DashboardViewer dashboardId={new ObjectID(DASHBOARD_ID)} />}
        />
        <RouterRoute
          path="/dashboard/:projectId/monitors"
          element={<p>All monitors</p>}
        />
      </Routes>
    </div>
  );
};

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn: number = 0; turn < 8; turn++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

/*
 * The dashboards list, then the board opened from it: Back from the board
 * has a page of the app to go to.
 */
async function openBoardFromList(): Promise<void> {
  render(
    <BrowserRouter useTransitions={false}>
      <AppShell />
    </BrowserRouter>,
  );

  expect(screen.getByText("All dashboards")).toBeInTheDocument();

  await act(async () => {
    Navigation.navigate(new Route(BOARD_PATH));
  });
  await waitFor(() => {
    expect(screen.getByTestId("canvas-stub")).toBeInTheDocument();
  });
  await settle();
}

function canvas(): HTMLElement {
  return screen.getByTestId("canvas-stub");
}

function widgetCount(): string | null {
  return canvas().getAttribute("data-widget-count");
}

function isEditing(): boolean {
  return canvas().getAttribute("data-is-edit-mode") === "true";
}

function queryLeaveDialog(): HTMLElement | null {
  return screen.queryByRole("dialog", { name: LEAVE_TITLE });
}

function browserAsksBeforeUnload(): boolean {
  const event: Event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

async function enterEditMode(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByLabelText("More dashboard options"));
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Edit Dashboard"));
  });
  expect(isEditing()).toBe(true);
}

async function addTextWidget(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTitle("Add Widget"));
  });
  await act(async () => {
    fireEvent.click(
      screen.getByTestId(`widget-card-${DashboardComponentType.Text}`),
    );
  });
  expect(widgetCount()).toBe("2");
}

async function clickSideMenuMonitors(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByText("Monitors"));
  });
  await settle();
}

async function pressBrowserBack(): Promise<void> {
  await act(async () => {
    window.history.back();
  });
  /*
   * The step, the guard's step back in the next frame (issue #7404), and
   * React drawing what followed.
   */
  await act(async () => {
    await afterHistorySteps();
  });
  await settle();
}

async function answer(
  button: "Keep Editing" | "Discard Changes",
): Promise<void> {
  await act(async () => {
    fireEvent.click(within(queryLeaveDialog()!).getByText(button));
  });
  await settle();
}

beforeEach(() => {
  LeaveGuard.reset();
  UnsavedChanges.reset();
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(null, "", DASHBOARDS_PATH);

  // A saved board with one widget on it.
  getItemMock.mockImplementation(() => {
    return Promise.resolve({
      dashboardViewConfig: {
        _type: ObjectType.DashboardViewConfig,
        components: [DashboardTextComponentUtil.getDefaultComponent()],
        heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
      },
      name: "Checkout",
      description: "",
      pageTitle: null,
      pageDescription: null,
    });
  });

  updateByIdMock.mockImplementation(() => {
    return Promise.resolve();
  });
});

afterEach(async () => {
  cleanup();
  LeaveGuard.reset();
  UnsavedChanges.reset();
  jest.clearAllMocks();
  // A history step still in flight lands before the next test.
  await settle();
});

describe("a dashboard opened for editing and left as it was", () => {
  test("the side menu leaves at once, and nothing asks", async () => {
    await openBoardFromList();
    await enterEditMode();

    expect(browserAsksBeforeUnload()).toBe(false);

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All monitors")).toBeInTheDocument();
    expect(window.location.pathname).toBe(MONITORS_PATH);
  });

  test("Back leaves at once, and nothing asks", async () => {
    await openBoardFromList();
    await enterEditMode();

    await pressBrowserBack();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All dashboards")).toBeInTheDocument();
  });

  test("Cancel goes back to view mode without asking: nothing is thrown away", async () => {
    await openBoardFromList();
    await enterEditMode();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Cancel"));
    });
    await settle();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(CANCEL_DESCRIPTION)).toBeNull();
    expect(isEditing()).toBe(false);
  });

  test("a new version of OneUptime is not held back", async () => {
    await openBoardFromList();
    await enterEditMode();

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
  });

  test("the Variables dialog saved as it was, on a board with none, changes nothing: the side menu leaves at once", async () => {
    await openBoardFromList();
    await enterEditMode();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Variables"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Save Variables"));
    });
    await settle();

    expect(screen.queryByText("Save Variables")).toBeNull();
    expect(isEditing()).toBe(true);
    expect(browserAsksBeforeUnload()).toBe(false);

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All monitors")).toBeInTheDocument();
  });
});

describe("a dashboard with an unsaved widget", () => {
  test("the side menu asks first, in the toolbar Cancel's words, and the page stays", async () => {
    await openBoardFromList();
    await enterEditMode();
    await addTextWidget();

    await clickSideMenuMonitors();

    const dialog: HTMLElement | null = queryLeaveDialog();
    expect(dialog).not.toBeNull();
    expect(within(dialog!).getByText(LEAVE_DESCRIPTION)).toBeInTheDocument();
    expect(within(dialog!).getByText("Keep Editing")).toBeInTheDocument();
    expect(within(dialog!).getByText("Discard Changes")).toBeInTheDocument();

    // Nothing has moved yet.
    expect(screen.queryByText("All monitors")).toBeNull();
    expect(window.location.pathname).toBe(BOARD_PATH);
    expect(widgetCount()).toBe("2");
  });

  test("Keep Editing stays on the board, the widget and edit mode with it", async () => {
    await openBoardFromList();
    await enterEditMode();
    await addTextWidget();
    await clickSideMenuMonitors();

    await answer("Keep Editing");

    expect(queryLeaveDialog()).toBeNull();
    expect(window.location.pathname).toBe(BOARD_PATH);
    expect(widgetCount()).toBe("2");
    expect(isEditing()).toBe(true);
    // Still unsaved: the next try asks again.
    await clickSideMenuMonitors();
    expect(queryLeaveDialog()).not.toBeNull();
  });

  test("Discard Changes goes where the side menu was going", async () => {
    await openBoardFromList();
    await enterEditMode();
    await addTextWidget();
    await clickSideMenuMonitors();

    await answer("Discard Changes");

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All monitors")).toBeInTheDocument();
    expect(window.location.pathname).toBe(MONITORS_PATH);
    expect(updateByIdMock).not.toHaveBeenCalled();
    expect(browserAsksBeforeUnload()).toBe(false);
  });

  test("Back asks first, and the board and its address stay", async () => {
    await openBoardFromList();
    await enterEditMode();
    await addTextWidget();

    await pressBrowserBack();

    expect(queryLeaveDialog()).not.toBeNull();
    expect(window.location.pathname).toBe(BOARD_PATH);
    expect(screen.queryByText("All dashboards")).toBeNull();
    expect(widgetCount()).toBe("2");
  });

  test("Keep Editing after Back stays; Back again asks again", async () => {
    await openBoardFromList();
    await enterEditMode();
    await addTextWidget();
    await pressBrowserBack();

    await answer("Keep Editing");

    expect(window.location.pathname).toBe(BOARD_PATH);
    expect(widgetCount()).toBe("2");
    expect(isEditing()).toBe(true);

    await pressBrowserBack();

    expect(queryLeaveDialog()).not.toBeNull();
    expect(window.location.pathname).toBe(BOARD_PATH);
  });

  test("Discard Changes after Back goes back", async () => {
    await openBoardFromList();
    await enterEditMode();
    await addTextWidget();
    await pressBrowserBack();

    await answer("Discard Changes");

    expect(screen.getByText("All dashboards")).toBeInTheDocument();
    expect(window.location.pathname).toBe(DASHBOARDS_PATH);
    expect(queryLeaveDialog()).toBeNull();
  });

  test("closing or reloading the tab asks through the browser, and a new version waits", async () => {
    await openBoardFromList();

    expect(browserAsksBeforeUnload()).toBe(false);

    await enterEditMode();
    expect(browserAsksBeforeUnload()).toBe(false);

    await addTextWidget();

    expect(browserAsksBeforeUnload()).toBe(true);
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
  });

  test("the toolbar's Cancel still asks before throwing the widget away, in the leave question's voice", async () => {
    await openBoardFromList();
    await enterEditMode();
    await addTextWidget();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Cancel"));
    });

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: CANCEL_TITLE,
    });

    expect(within(dialog).getByText(CANCEL_DESCRIPTION)).toBeInTheDocument();
    expect(within(dialog).getByText("Keep Editing")).toBeInTheDocument();
    expect(within(dialog).getByText("Discard Changes")).toBeInTheDocument();
    // Not "Are you sure?" twice over any more.
    expect(within(dialog).queryByText(OLD_CANCEL_TITLE)).toBeNull();
    expect(within(dialog).queryByText(OLD_CANCEL_DESCRIPTION)).toBeNull();
    // It opens as leaving the board does.
    expect(
      CANCEL_DESCRIPTION.startsWith(LEAVE_DESCRIPTION.split(". ")[0]!),
    ).toBe(true);

    // Keep Editing keeps the widget, still being edited.
    await act(async () => {
      fireEvent.click(within(dialog).getByText("Keep Editing"));
    });
    await settle();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(isEditing()).toBe(true);
    expect(widgetCount()).toBe("2");
  });
});

describe("after Save Changes or Discard Changes", () => {
  test("a saved board leaves at once: the side menu asks nothing", async () => {
    await openBoardFromList();
    await enterEditMode();
    await addTextWidget();

    await act(async () => {
      fireEvent.click(screen.getByText("Save Changes"));
    });
    await settle();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(isEditing()).toBe(false);
    expect(browserAsksBeforeUnload()).toBe(false);
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All monitors")).toBeInTheDocument();
  });

  test("a saved board: Back asks nothing", async () => {
    await openBoardFromList();
    await enterEditMode();
    await addTextWidget();

    await act(async () => {
      fireEvent.click(screen.getByText("Save Changes"));
    });
    await settle();

    await pressBrowserBack();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All dashboards")).toBeInTheDocument();
  });

  test("a board whose changes were discarded with Cancel leaves at once", async () => {
    await openBoardFromList();
    await enterEditMode();
    await addTextWidget();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Cancel"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Discard Changes"));
    });
    await settle();

    expect(isEditing()).toBe(false);
    expect(widgetCount()).toBe("1");
    expect(browserAsksBeforeUnload()).toBe(false);

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).toBeNull();
    expect(screen.getByText("All monitors")).toBeInTheDocument();
  });

  test("a save that is refused keeps asking: the widget is still unsaved", async () => {
    updateByIdMock.mockImplementation(() => {
      return Promise.reject(new Error("You no longer have permission."));
    });

    await openBoardFromList();
    await enterEditMode();
    await addTextWidget();

    await act(async () => {
      fireEvent.click(screen.getByText("Save Changes"));
    });
    await settle();

    expect(isEditing()).toBe(true);
    expect(browserAsksBeforeUnload()).toBe(true);

    await clickSideMenuMonitors();

    expect(queryLeaveDialog()).not.toBeNull();
  });
});
