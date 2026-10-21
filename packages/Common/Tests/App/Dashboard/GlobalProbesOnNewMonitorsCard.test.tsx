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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "Add global probes to new monitors", on Monitors -> Settings -> Probes.
 *
 * It used to be a "Global Probe Settings" card whose Edit dialog held one
 * switch, "Disable Global Probes on New Monitors": on meant global probes
 * were NOT added. Now it is one switch, on while they are added, saved the
 * moment it is flipped. It writes a project column that only a project
 * admin may change, so for anyone else it is locked, saying who may.
 *
 * Only the network and the signed-in user's permissions are stubbed: the
 * permission gate is the real one.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

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

let permissionsForTest: Array<string> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return permissionsForTest;
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

import GlobalProbesOnNewMonitorsCard from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/GlobalProbesOnNewMonitorsCard";
import GlobalProbesOnNewMonitorsCopy, {
  GLOBAL_PROBES_ON_NEW_MONITORS_COLUMN,
  GLOBAL_PROBES_ON_NEW_MONITORS_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Probe/GlobalProbesOnNewMonitorsCopy";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const PROJECT_ID: string = "9e9e9e9e-0000-4000-8000-0000000000aa";

let stored: Partial<Project> = {};

beforeEach(() => {
  stored = {};
  permissionsForTest = [Permission.ProjectAdmin];
  PermissionGate.clearPermissionPropsCache();

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const project: Project = new Project();
    project._id = PROJECT_ID;
    Object.assign(project, stored);
    return project;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return {};
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderCard(): Promise<HTMLElement> {
  render(
    <GlobalProbesOnNewMonitorsCard projectId={new ObjectID(PROJECT_ID)} />,
  );
  return await screen.findByTestId(
    GLOBAL_PROBES_ON_NEW_MONITORS_SWITCH_TEST_ID,
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 6; i++) {
      await Promise.resolve();
    }
  });
}

describe("Global Probes on New Monitors", () => {
  test("a new project adds global probes to new monitors: the switch is on", async () => {
    // The column defaults to false ("do NOT add" off).
    const control: HTMLElement = await renderCard();

    expect(
      screen.getByText("Global Probes on New Monitors"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Add global probes to new monitors" }),
    ).toBe(control);
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(
        "New monitors start with OneUptime's global probes, along with the custom probes you add to new monitors. Monitors that already exist keep their probes.",
      ),
    ).toBeInTheDocument();

    const read: {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    } = getItemMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    };
    expect(read.modelType).toBe(Project);
    expect(read.id.toString()).toBe(PROJECT_ID);
    expect(read.select).toEqual({
      doNotAddGlobalProbesByDefaultOnNewMonitors: true,
    });
  });

  test("a project that turned them off shows it off, and says what off means", async () => {
    stored.doNotAddGlobalProbesByDefaultOnNewMonitors = true;

    const control: HTMLElement = await renderCard();

    expect(control).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByText(
        "New monitors start with only the custom probes you add to new monitors. Monitors that already exist keep their probes.",
      ),
    ).toBeInTheDocument();
  });

  test("turning it off saves 'do not add global probes', at once", async () => {
    const control: HTMLElement = await renderCard();

    fireEvent.click(control);
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    const call: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = updateByIdMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    };
    expect(call.modelType).toBe(Project);
    expect(call.id.toString()).toBe(PROJECT_ID);
    expect(call.data).toEqual({
      [GLOBAL_PROBES_ON_NEW_MONITORS_COLUMN]: true,
    });
    expect(control).toHaveAttribute("aria-checked", "false");
  });

  test("turning it back on saves the other way", async () => {
    stored.doNotAddGlobalProbesByDefaultOnNewMonitors = true;

    const control: HTMLElement = await renderCard();

    fireEvent.click(control);
    await flush();

    expect(
      (updateByIdMock.mock.calls[0]![0] as { data: Record<string, unknown> })
        .data,
    ).toEqual({ doNotAddGlobalProbesByDefaultOnNewMonitors: false });
  });

  test("someone who may update the project but not this setting sees it locked, saying who may", async () => {
    // Manage Billing may update the project, not its monitor defaults.
    permissionsForTest = [Permission.ManageProjectBilling];

    const control: HTMLElement = await renderCard();

    expect(control).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByTestId(`${GLOBAL_PROBES_ON_NEW_MONITORS_SWITCH_TEST_ID}-row`),
    ).toHaveTextContent(
      "You do not have permission to update this Project. You need one of these permissions: Project Owner, Project Admin, Edit Project.",
    );

    fireEvent.click(control);
    await flush();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a project member sees it locked too", async () => {
    permissionsForTest = [Permission.ProjectMember];

    const control: HTMLElement = await renderCard();

    expect(control).toHaveAttribute("aria-disabled", "true");
  });

  test("its words say on = added, and never 'disable'", () => {
    expect(GlobalProbesOnNewMonitorsCopy.switchTitle).toBe(
      "Add global probes to new monitors",
    );
    for (const text of Object.values(GlobalProbesOnNewMonitorsCopy)) {
      expect(text).not.toMatch(/disable/i);
    }
  });
});
