import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Issue #3306, at its point of origin.
 *
 * A handful of tables do not use ModelTable's built-in create modal. They set
 * isCreateable={false} and substitute their own card button that navigates to
 * a full create page instead - Monitors, Incidents, Alerts, both kinds of
 * episode, Scheduled Maintenance, Announcements. Doing that also opts them out
 * of ModelTable's permission gate, which is why a Viewer-only user could click
 * "Create Monitor", walk all three steps of the wizard, press Create, and be
 * told "Monitor type required to create monitor" - a form-validation error, for
 * a permissions problem, naming a field they had never been shown.
 *
 * Each of those buttons now carries its own gate. The two things that matter
 * are asserted for every one of them: the button says why it is locked, and
 * clicking it does not navigate anybody into a flow that will refuse them.
 */

let isMasterAdminForTest: boolean = false;
let permissionsForTest: Array<unknown> = [];
let navigateCalls: number = 0;

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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      count: async (): Promise<number> => {
        return 0;
      },
      deleteItem: async (): Promise<void> => {
        return undefined;
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
      createOrUpdate: async (): Promise<null> => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "00000000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

import MonitorTable from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import Permission from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";

type FindButtonFunction = (label: string) => HTMLButtonElement | null;

const findButton: FindButtonFunction = (
  label: string,
): HTMLButtonElement | null => {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button: HTMLButtonElement) => {
        return (button.textContent || "").trim().startsWith(label);
      },
    ) || null
  );
};

describe("dedicated create-page entry points", () => {
  beforeEach(() => {
    isMasterAdminForTest = false;
    permissionsForTest = [];
    navigateCalls = 0;
    PermissionGate.clearPermissionPropsCache();
    window.history.replaceState(
      window.history.state,
      "",
      "/dashboard/monitors",
    );
    TableFilterUrlState.resetClaimedKeys();
    window.localStorage.clear();

    /*
     * Spied rather than stubbed wholesale: the table's own URL-state helpers
     * call several other Navigation methods on mount, and only the page
     * transition is interesting here.
     */
    getJestSpyOn(Navigation, "navigate").mockImplementation((): void => {
      navigateCalls++;
    });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("Monitors table", () => {
    test("offers a working Create Monitor button to somebody who may create", async () => {
      permissionsForTest = [Permission.ProjectAdmin];

      render(<MonitorTable />);

      await waitFor(() => {
        expect(findButton("Create Monitor")).not.toBeNull();
      });

      const button: HTMLButtonElement = findButton("Create Monitor")!;

      expect(button).not.toBeDisabled();

      fireEvent.click(button);

      expect(navigateCalls).toBe(1);
    });

    /*
     * The reported scenario, exactly: a Viewer-only user on Monitors.
     */
    test("locks Create Monitor for a Viewer instead of letting them into the wizard", async () => {
      permissionsForTest = [Permission.Viewer];

      render(<MonitorTable />);

      await waitFor(() => {
        expect(findButton("Create Monitor")).not.toBeNull();
      });

      expect(findButton("Create Monitor")).toBeDisabled();
    });

    test("tells the Viewer which permission they are missing", async () => {
      permissionsForTest = [Permission.Viewer];

      render(<MonitorTable />);

      await waitFor(() => {
        expect(findButton("Create Monitor")).not.toBeNull();
      });

      fireEvent.mouseEnter(
        findButton("Create Monitor")!.parentElement as HTMLElement,
      );

      const tooltip: HTMLElement = screen.getByRole("tooltip");

      expect(tooltip).toHaveTextContent(
        "You do not have permission to create this Monitor.",
      );
      expect(tooltip).toHaveTextContent("Create Monitor");
      expect(tooltip).toHaveTextContent("Monitor Admin");
    });

    /*
     * "Block on click of Create", in the words of the bug report - rather than
     * letting the user through and failing at submission.
     */
    test("does not navigate to the create page when the locked button is clicked", async () => {
      permissionsForTest = [Permission.Viewer];

      render(<MonitorTable />);

      await waitFor(() => {
        expect(findButton("Create Monitor")).not.toBeNull();
      });

      fireEvent.click(findButton("Create Monitor")!);

      expect(navigateCalls).toBe(0);
    });

    /*
     * disableCreate is a layout flag - the disabled-monitors and
     * probe-disconnected pages set it because those lists are not a place to
     * create anything, which has nothing to do with permissions. Turning it
     * into a permanently locked button would be its own bug.
     */
    test("keeps the button absent when the caller disabled create for layout reasons", async () => {
      permissionsForTest = [Permission.ProjectAdmin];

      render(<MonitorTable disableCreate={true} />);

      await waitFor(() => {
        expect(screen.getAllByText("Monitors").length).toBeGreaterThan(0);
      });

      expect(findButton("Create Monitor")).toBeNull();
    });

    test("keeps the button absent while the permission snapshot has not loaded", async () => {
      permissionsForTest = [];

      render(<MonitorTable />);

      await waitFor(() => {
        expect(screen.getAllByText("Monitors").length).toBeGreaterThan(0);
      });

      expect(findButton("Create Monitor")).toBeNull();
    });

    test("works for a master admin", async () => {
      isMasterAdminForTest = true;
      permissionsForTest = [];

      render(<MonitorTable />);

      await waitFor(() => {
        expect(findButton("Create Monitor")).not.toBeNull();
      });

      expect(findButton("Create Monitor")).not.toBeDisabled();
    });
  });
});
