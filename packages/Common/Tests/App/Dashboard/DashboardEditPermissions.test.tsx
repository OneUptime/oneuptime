import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DefaultDashboardSize from "../../../Types/Dashboard/DashboardSize";
import DashboardTextComponentUtil from "../../../Utils/Dashboard/Components/DashboardTextComponent";

/*
 * github.com/OneUptime/oneuptime/issues/3550.
 *
 * A user whose only roles were `Viewer` and `Monitor Viewer` - both read-only
 * by definition - opened a dashboard, pressed Edit, added and removed widgets,
 * rearranged the board and pressed Save Changes.
 *
 * The API was never going to accept that write: Dashboard's update ACL is
 * [ProjectOwner, ProjectAdmin, EditDashboard] and TablePermission refuses
 * anything else (Common/Tests/Server/.../DashboardAccessPermission.test.ts
 * pins that). The bug was that nothing in the UI said so. The dashboard is a
 * bespoke screen - no ModelTable, no ModelForm - so none of the generic
 * permission gates ever ran over it, and the first and only sign of the
 * refusal came after all the work was done. Worse, the failed save set the
 * page-level error, which replaced the entire board with a bare message and
 * took every unsaved widget with it.
 *
 * So there are two things to hold onto here, and both are asserted below:
 *
 *   1. A reader is turned back at the door - no Edit, no Add Widget, no Save.
 *   2. If a save is ever refused anyway, the board and the work survive it.
 *
 * The suite drives the real DashboardViewer against a fake dashboard API, the
 * way DashboardVariablesDiscard does, so what is asserted is what a person
 * actually sees.
 */

/*
 * Mounting the real DashboardViewer pulls in ~60 widget modules. The default
 * 5s budget is a machine-speed check, not an assertion about this code.
 */
jest.setTimeout(120000);

const DASHBOARD_ID: string = "33333333-3333-4333-8333-333333333333";

let permissionsForTest: Array<unknown> = [];
let isMasterAdminForTest: boolean = false;

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
        return isMasterAdminForTest;
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

/* The fake server's copy of the board. */
const serverState: { dashboardViewConfig: JSONObject | null } = {
  dashboardViewConfig: null,
};

const getItemMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;
const updateByIdMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (err: Error) => {
        return err.message;
      },
      getFriendlyMessage: (err: Error) => {
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
 * The canvas is ~60 widget implementations deep and none of them are under
 * test here. The stub publishes the edit flag it was handed, so "is the board
 * editable" is directly observable rather than inferred from the toolbar.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index",
  () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;
    return {
      __esModule: true,
      default: (props: { isEditMode?: boolean | undefined }) => {
        return reactModule.createElement("div", {
          "data-testid": "canvas-stub",
          "data-is-edit-mode": props.isEditMode ? "true" : "false",
        });
      },
    };
  },
);

import DashboardViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import Permission from "../../../Types/Permission";

type MakeConfigFunction = () => DashboardViewConfig;

const makeConfig: MakeConfigFunction = (): DashboardViewConfig => {
  return {
    _type: ObjectType.DashboardViewConfig,
    components: [DashboardTextComponentUtil.getDefaultComponent()],
    heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
  };
};

type SettleFunction = () => Promise<void>;

const settle: SettleFunction = async (): Promise<void> => {
  await act(async () => {
    for (let turn: number = 0; turn < 5; turn++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
};

type RenderDashboardFunction = () => Promise<void>;

const renderDashboard: RenderDashboardFunction = async (): Promise<void> => {
  render(<DashboardViewer dashboardId={new ObjectID(DASHBOARD_ID)} />);
  await waitFor(() => {
    expect(screen.getByTestId("canvas-stub")).toBeInTheDocument();
  });
};

type OpenMoreMenuFunction = () => Promise<void>;

const openMoreMenu: OpenMoreMenuFunction = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByLabelText("More dashboard options"));
  });
};

type EnterEditModeFunction = () => Promise<void>;

const enterEditMode: EnterEditModeFunction = async (): Promise<void> => {
  await openMoreMenu();
  await act(async () => {
    fireEvent.click(screen.getByText("Edit Dashboard"));
  });
};

type IsCanvasEditableFunction = () => boolean;

const isCanvasEditable: IsCanvasEditableFunction = (): boolean => {
  return (
    screen.getByTestId("canvas-stub").getAttribute("data-is-edit-mode") ===
    "true"
  );
};

/* The exact roles from the report. */
const READ_ONLY_ROLES: Array<Permission> = [
  Permission.Viewer,
  Permission.MonitorViewer,
];

beforeEach(() => {
  permissionsForTest = [];
  isMasterAdminForTest = false;
  PermissionGate.clearPermissionPropsCache();
  serverState.dashboardViewConfig = makeConfig() as unknown as JSONObject;
  window.history.replaceState({}, "", `/dashboard/${DASHBOARD_ID}`);

  getItemMock.mockImplementation(() => {
    return Promise.resolve({
      dashboardViewConfig: serverState.dashboardViewConfig,
      name: "Monitor status",
      description: "A dashboard",
      pageTitle: null,
      pageDescription: null,
    });
  });

  updateByIdMock.mockImplementation((args: any) => {
    serverState.dashboardViewConfig = args.data
      .dashboardViewConfig as JSONObject;
    return Promise.resolve();
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("DashboardView - a reader cannot edit the board (issue #3550)", () => {
  describe("a user holding only Viewer and Monitor Viewer", () => {
    beforeEach(() => {
      permissionsForTest = [...READ_ONLY_ROLES];
    });

    test("still sees the dashboard", async () => {
      await renderDashboard();

      expect(screen.getByTestId("canvas-stub")).toBeInTheDocument();
      expect(screen.getAllByText("Monitor status").length).toBeGreaterThan(0);
    });

    test("is offered a locked Edit Dashboard, not a working one", async () => {
      await renderDashboard();
      await openMoreMenu();

      const editItem: HTMLElement = screen.getByText("Edit Dashboard");
      const editButton: HTMLElement = editItem.closest("button") as HTMLElement;

      expect(editButton).toBeDisabled();
    });

    test("is told which permission the Edit would need", async () => {
      await renderDashboard();
      await openMoreMenu();

      const editButton: HTMLElement = screen
        .getByText("Edit Dashboard")
        .closest("button") as HTMLElement;

      fireEvent.mouseEnter(editButton.parentElement as HTMLElement);

      const tooltip: HTMLElement = screen.getByRole("tooltip");

      expect(tooltip).toHaveTextContent(
        "You do not have permission to update this Dashboard.",
      );
      /* The human title, not the raw `EditDashboard` enum value. */
      expect(tooltip).toHaveTextContent("Edit Dashboard");
      expect(tooltip).toHaveTextContent("Project Admin");
    });

    /*
     * The heart of the report. Clicking through must not put the board into
     * edit mode, because everything downstream of edit mode - Add Widget,
     * drag, resize, Save Changes - ends in a refused write.
     */
    test("cannot get the board into edit mode by clicking the locked item", async () => {
      await renderDashboard();
      await enterEditMode();

      expect(isCanvasEditable()).toBe(false);
      expect(screen.queryByText("Save Changes")).not.toBeInTheDocument();
      expect(screen.queryByText("Add Widget")).not.toBeInTheDocument();
      expect(screen.queryByText("Editing")).not.toBeInTheDocument();
    });

    test("never reaches the update endpoint", async () => {
      await renderDashboard();
      await enterEditMode();
      await settle();

      expect(updateByIdMock).not.toHaveBeenCalled();
    });

    /*
     * View-mode affordances are untouched: this is about writing to the
     * board, not about looking at it.
     */
    test("keeps the read-only tools it is entitled to", async () => {
      await renderDashboard();
      await openMoreMenu();

      expect(screen.getByText("Full Screen")).toBeInTheDocument();
    });
  });

  describe("a user holding Edit Dashboard", () => {
    beforeEach(() => {
      permissionsForTest = [Permission.Viewer, Permission.EditDashboard];
    });

    test("gets a working Edit Dashboard", async () => {
      await renderDashboard();
      await openMoreMenu();

      expect(
        screen.getByText("Edit Dashboard").closest("button"),
      ).not.toBeDisabled();
    });

    test("can put the board into edit mode and save it", async () => {
      await renderDashboard();
      await enterEditMode();

      expect(isCanvasEditable()).toBe(true);
      expect(screen.getByText("Save Changes")).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByText("Save Changes"));
      });
      await settle();

      expect(updateByIdMock).toHaveBeenCalledTimes(1);
      expect(isCanvasEditable()).toBe(false);
    });
  });

  /*
   * Dashboard is @OperationalResource, so the server's table-level check
   * accepts the EditAllOperationalResources wildcard for it even though the
   * model's ACL does not enumerate it. A gate that did not know that would
   * lock the editor for somebody the API would have let through.
   */
  describe("a user holding only the operational-resource wildcard", () => {
    beforeEach(() => {
      permissionsForTest = [
        Permission.Viewer,
        Permission.EditAllOperationalResources,
      ];
    });

    test("can edit the board", async () => {
      await renderDashboard();
      await enterEditMode();

      expect(isCanvasEditable()).toBe(true);
    });
  });

  /*
   * The permission snapshot arrives on a response header, so it is empty for
   * the first paint after a login and for a beat after a project switch.
   * Telling a project owner they need a permission they hold is worse than
   * briefly not offering the button - PermissionGate's documented contract.
   */
  describe("before the permission snapshot has landed", () => {
    test("hides Edit Dashboard rather than accusing the user", async () => {
      permissionsForTest = [];

      await renderDashboard();
      await openMoreMenu();

      expect(screen.queryByText("Edit Dashboard")).not.toBeInTheDocument();
      /* The rest of the menu still works. */
      expect(screen.getByText("Full Screen")).toBeInTheDocument();
    });
  });

  describe("a master admin", () => {
    test("is allowed everything, snapshot or not", async () => {
      permissionsForTest = [];
      isMasterAdminForTest = true;

      await renderDashboard();
      await enterEditMode();

      expect(isCanvasEditable()).toBe(true);
    });
  });

  /*
   * The second half of the damage. Even for somebody who IS allowed to edit,
   * a save can fail - a revoked permission, a lost connection, a conflict.
   * That used to drop straight back to view mode and swap the whole board for
   * a bare error, so the user could not tell a refused save from a successful
   * one and lost every unsaved widget either way.
   */
  describe("when a save is refused", () => {
    beforeEach(() => {
      permissionsForTest = [Permission.Viewer, Permission.EditDashboard];
      updateByIdMock.mockImplementation(() => {
        return Promise.reject(
          new Error(
            "You do not have permissions to update Dashboard. You need one of these permissions: Project Owner, Project Admin, Edit Dashboard",
          ),
        );
      });
    });

    test("says so instead of looking like it worked", async () => {
      await renderDashboard();
      await enterEditMode();

      await act(async () => {
        fireEvent.click(screen.getByText("Save Changes"));
      });
      await settle();

      expect(
        screen.getByText(/You do not have permissions to update Dashboard/),
      ).toBeInTheDocument();
    });

    test("keeps the user in edit mode with the board still on screen", async () => {
      await renderDashboard();
      await enterEditMode();

      await act(async () => {
        fireEvent.click(screen.getByText("Save Changes"));
      });
      await settle();

      expect(screen.getByTestId("canvas-stub")).toBeInTheDocument();
      expect(isCanvasEditable()).toBe(true);
      expect(screen.getByText("Save Changes")).toBeInTheDocument();
    });

    test("lets the user try again once the cause is gone", async () => {
      await renderDashboard();
      await enterEditMode();

      await act(async () => {
        fireEvent.click(screen.getByText("Save Changes"));
      });
      await settle();

      updateByIdMock.mockImplementation(() => {
        return Promise.resolve();
      });

      await act(async () => {
        fireEvent.click(screen.getByText("Save Changes"));
      });
      await settle();

      expect(isCanvasEditable()).toBe(false);
      expect(
        screen.queryByText(/You do not have permissions to update Dashboard/),
      ).not.toBeInTheDocument();
    });
  });
});
