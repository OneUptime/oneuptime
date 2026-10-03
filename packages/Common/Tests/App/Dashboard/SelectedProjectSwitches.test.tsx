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
  renderHook,
  screen,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * The dashboard reads Monitor Groups off the project it has selected (the
 * Monitors menu's Monitor Groups page, a status page's Resources item), and
 * the switch on Settings > Feature Flags saves it without a reload. So the
 * dashboard follows the switch's saves (Utils/SelectedProjectSwitches and
 * UseSelectedProjectSwitches, wired in App.tsx): a save for the selected
 * project swaps in a copy of it with the new value, and the menus follow at
 * once. The Edit dialog this replaced reloaded the whole dashboard instead.
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

import {
  followSelectedProjectSwitches,
  getProjectWithSwitchedColumn,
  SELECTED_PROJECT_SWITCH_COLUMNS,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SelectedProjectSwitches";
import useSelectedProjectSwitches from "../../../../App/FeatureSet/Dashboard/src/Utils/UseSelectedProjectSwitches";
import MonitorGroupsSwitchCard from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupsSwitchCard";
import {
  MONITOR_GROUPS_SWITCH_COLUMN,
  MONITOR_GROUPS_SWITCH_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupsSwitchCopy";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import { announceModelSwitchSaved } from "../../../UI/Components/ModelSwitch/ModelSwitchEvents";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "5e5e5e5e-0000-4000-8000-0000000000cc";
const OTHER_PROJECT_ID: string = "6f6f6f6f-0000-4000-8000-0000000000dd";

function makeProject(id: string, monitorGroups?: boolean): Project {
  const project: Project = new Project();
  project._id = id;
  project.name = "Acme";
  project.paymentProviderPlanId = "plan_growth";

  if (monitorGroups !== undefined) {
    project.isFeatureFlagMonitorGroupsEnabled = monitorGroups;
  }

  return project;
}

function announce(data: {
  projectId: string;
  column?: string | undefined;
  value: boolean;
}): void {
  act(() => {
    announceModelSwitchSaved({
      modelType: Project,
      modelId: new ObjectID(data.projectId),
      column: data.column || MONITOR_GROUPS_SWITCH_COLUMN,
      value: data.value,
    });
  });
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the columns the menus read off the selected project", () => {
  test("are Monitor Groups, the one the project list selects for the menus", () => {
    expect(SELECTED_PROJECT_SWITCH_COLUMNS).toEqual([
      "isFeatureFlagMonitorGroupsEnabled",
    ]);
  });

  test("a copy with the column switched keeps every other column, and is a new object", () => {
    const project: Project = makeProject(PROJECT_ID, false);

    const updated: Project = getProjectWithSwitchedColumn({
      project: project,
      column: MONITOR_GROUPS_SWITCH_COLUMN,
      value: true,
    });

    expect(updated).not.toBe(project);
    expect(updated).toBeInstanceOf(Project);
    expect(updated.isFeatureFlagMonitorGroupsEnabled).toBe(true);
    expect(updated._id?.toString()).toBe(PROJECT_ID);
    expect(updated.name).toBe("Acme");
    expect(updated.paymentProviderPlanId).toBe("plan_growth");

    // The selected project itself is not changed under the dashboard.
    expect(project.isFeatureFlagMonitorGroupsEnabled).toBe(false);
  });
});

describe("following the switches' saves", () => {
  test("hears a save of a selected-project column for this project, and only that", () => {
    const heard: Array<string> = [];

    const unsubscribe: () => void = followSelectedProjectSwitches({
      projectId: new ObjectID(PROJECT_ID),
      onSaved: (column: string, value: boolean): void => {
        heard.push(`${column}=${value}`);
      },
    });

    announce({ projectId: PROJECT_ID, value: true });
    announce({ projectId: OTHER_PROJECT_ID, value: true });
    announce({
      projectId: PROJECT_ID,
      column: "letCustomerSupportAccessProject",
      value: true,
    });

    expect(heard).toEqual(["isFeatureFlagMonitorGroupsEnabled=true"]);

    unsubscribe();

    announce({ projectId: PROJECT_ID, value: false });

    expect(heard).toEqual(["isFeatureFlagMonitorGroupsEnabled=true"]);
  });
});

describe("useSelectedProjectSwitches", () => {
  test("hands back the selected project with the saved value, as a new project", () => {
    const updates: Array<Project> = [];
    const selected: Project = makeProject(PROJECT_ID, false);

    renderHook(() => {
      useSelectedProjectSwitches({
        selectedProject: selected,
        onProjectUpdated: (project: Project): void => {
          updates.push(project);
        },
      });
    });

    announce({ projectId: PROJECT_ID, value: true });

    expect(updates).toHaveLength(1);
    expect(updates[0]).not.toBe(selected);
    expect(updates[0]!.isFeatureFlagMonitorGroupsEnabled).toBe(true);
    expect(updates[0]!.name).toBe("Acme");
  });

  test("a second save before the next render builds on the first", () => {
    const updates: Array<Project> = [];

    renderHook(() => {
      useSelectedProjectSwitches({
        selectedProject: makeProject(PROJECT_ID, false),
        onProjectUpdated: (project: Project): void => {
          updates.push(project);
        },
      });
    });

    act(() => {
      announceModelSwitchSaved({
        modelType: Project,
        modelId: new ObjectID(PROJECT_ID),
        column: MONITOR_GROUPS_SWITCH_COLUMN,
        value: true,
      });
      announceModelSwitchSaved({
        modelType: Project,
        modelId: new ObjectID(PROJECT_ID),
        column: MONITOR_GROUPS_SWITCH_COLUMN,
        value: false,
      });
    });

    expect(
      updates.map((project: Project): boolean | undefined => {
        return project.isFeatureFlagMonitorGroupsEnabled;
      }),
    ).toEqual([true, false]);
    expect(updates[1]!.name).toBe("Acme");
  });

  test("ignores another project's saves, and stops listening for a project no longer selected", () => {
    const updates: Array<Project> = [];
    const onProjectUpdated: (project: Project) => void = (
      project: Project,
    ): void => {
      updates.push(project);
    };

    interface HookProps {
      selectedProject: Project | null;
    }

    const initialProps: HookProps = {
      selectedProject: makeProject(PROJECT_ID, false),
    };

    const { rerender } = renderHook(
      (props: HookProps) => {
        useSelectedProjectSwitches({
          selectedProject: props.selectedProject,
          onProjectUpdated: onProjectUpdated,
        });
      },
      { initialProps: initialProps },
    );

    announce({ projectId: OTHER_PROJECT_ID, value: true });

    expect(updates).toEqual([]);

    rerender({ selectedProject: makeProject(OTHER_PROJECT_ID, false) });

    announce({ projectId: PROJECT_ID, value: true });

    expect(updates).toEqual([]);

    announce({ projectId: OTHER_PROJECT_ID, value: true });

    expect(updates).toHaveLength(1);
    expect(updates[0]!._id?.toString()).toBe(OTHER_PROJECT_ID);

    rerender({ selectedProject: null });

    announce({ projectId: OTHER_PROJECT_ID, value: false });

    expect(updates).toHaveLength(1);
  });
});

describe("the Monitor Groups switch and the menus", () => {
  beforeEach(() => {
    getItemMock.mockReset();
    getItemMock.mockImplementation(async (): Promise<Project> => {
      return makeProject(PROJECT_ID, false);
    });

    updateByIdMock.mockReset();
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      return {};
    });

    getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
      (): PermissionGateResult => {
        return { isAllowed: true };
      },
    );
    getJestSpyOn(ProjectUtil, "getCurrentPlan").mockReturnValue(null);
  });

  /*
   * A stand-in for App.tsx and the Monitors menu: the selected project in
   * state, followed by the hook, and a menu that shows Monitor Groups when
   * the project has them on - the way Pages/Monitor/SideMenu reads it.
   */
  const Dashboard: () => ReactElement = (): ReactElement => {
    const [selectedProject, setSelectedProject] = useState<Project | null>(
      makeProject(PROJECT_ID, false),
    );

    useSelectedProjectSwitches({
      selectedProject: selectedProject,
      onProjectUpdated: setSelectedProject,
    });

    return (
      <div>
        <nav data-testid="monitors-menu">
          All Monitors
          {selectedProject?.isFeatureFlagMonitorGroupsEnabled
            ? " | Monitor Groups"
            : ""}
        </nav>
        <MonitorGroupsSwitchCard projectId={new ObjectID(PROJECT_ID)} />
      </div>
    );
  };

  test("flipping it on puts Monitor Groups in the menu without a reload, and flipping it off takes it out", async () => {
    render(<Dashboard />);

    await act(async () => {
      for (let i: number = 0; i < 8; i++) {
        await Promise.resolve();
      }
    });

    expect(screen.getByTestId("monitors-menu")).toHaveTextContent(
      "All Monitors",
    );
    expect(screen.getByTestId("monitors-menu")).not.toHaveTextContent(
      "Monitor Groups",
    );

    const control: HTMLElement = screen.getByTestId(
      MONITOR_GROUPS_SWITCH_TEST_ID,
    );

    fireEvent.click(control);

    await act(async () => {
      for (let i: number = 0; i < 8; i++) {
        await Promise.resolve();
      }
    });

    expect(screen.getByTestId("monitors-menu")).toHaveTextContent(
      "Monitor Groups",
    );

    fireEvent.click(control);

    await act(async () => {
      for (let i: number = 0; i < 8; i++) {
        await Promise.resolve();
      }
    });

    expect(screen.getByTestId("monitors-menu")).not.toHaveTextContent(
      "Monitor Groups",
    );
  });
});
