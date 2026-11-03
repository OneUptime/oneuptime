import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #5378: where a network topology map learns the layout its project
 * opens maps on, how it saves a new one, and who is offered the controls.
 * The API is a recorder; the permission gate is the real one, fed the
 * permissions a reader holds, so these tests say exactly who sees "Make
 * default for everyone".
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
let currentProjectId: unknown = null;
let isMasterAdminForTest: boolean = false;
let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return currentProjectId;
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
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

import {
  DEFAULT_LAYOUT_COLUMN,
  canChangeProjectDefaultLayout,
  fetchProjectDefaultLayout,
  saveProjectDefaultLayout,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyDefaultLayout";
import Project from "../../../Models/DatabaseModels/Project";
import { NETWORK_TOPOLOGY_LAYOUTS } from "../../../Types/NetworkDevice/NetworkTopologyLayout";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);

function projectWith(value: unknown): Project {
  const project: Project = new Project();
  (project as unknown as Record<string, unknown>)[DEFAULT_LAYOUT_COLUMN] =
    value;
  return project;
}

beforeEach(() => {
  getItemMock.mockReset();
  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue(undefined);
  currentProjectId = PROJECT_ID;
  isMasterAdminForTest = false;
  permissionsForTest = [];
  PermissionGate.clearPermissionPropsCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the column the map reads and writes", () => {
  test("is the project's default layout column", () => {
    expect(DEFAULT_LAYOUT_COLUMN).toBe("defaultNetworkTopologyLayout");
    expect(
      new Project().getTableColumnMetadata(DEFAULT_LAYOUT_COLUMN),
    ).toBeTruthy();
  });
});

describe("fetchProjectDefaultLayout", () => {
  test("reads that one column of the current project", async () => {
    getItemMock.mockResolvedValue(projectWith("parentChild"));

    await expect(fetchProjectDefaultLayout()).resolves.toBe("parentChild");

    expect(getItemMock).toHaveBeenCalledTimes(1);
    const request: {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, boolean>;
    } = getItemMock.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, boolean>;
    };
    expect(request.modelType).toBe(Project);
    expect(request.id.toString()).toBe(PROJECT_ID.toString());
    expect(request.select).toEqual({ defaultNetworkTopologyLayout: true });
  });

  test.each([...NETWORK_TOPOLOGY_LAYOUTS])(
    "a project that chose %s opens on it",
    async (layout: string) => {
      getItemMock.mockResolvedValue(projectWith(layout));
      await expect(fetchProjectDefaultLayout()).resolves.toBe(layout);
    },
  );

  test.each([
    [null],
    [undefined],
    [""],
    ["   "],
    ["Parent and child"],
    ["a layout a later version removed"],
    [42],
  ])(
    "a project whose column holds %p has no default",
    async (value: unknown) => {
      getItemMock.mockResolvedValue(projectWith(value));
      await expect(fetchProjectDefaultLayout()).resolves.toBeNull();
    },
  );

  test("a project the API does not return has no default", async () => {
    getItemMock.mockResolvedValue(null);
    await expect(fetchProjectDefaultLayout()).resolves.toBeNull();
  });

  test("without a project there is nothing to read, and nothing is asked", async () => {
    currentProjectId = null;
    await expect(fetchProjectDefaultLayout()).resolves.toBeNull();
    expect(getItemMock).not.toHaveBeenCalled();
  });

  test("a failed read is the caller's to handle: the map then opens on its own default", async () => {
    getItemMock.mockRejectedValue(new Error("Server unavailable"));
    await expect(fetchProjectDefaultLayout()).rejects.toThrow(
      "Server unavailable",
    );
  });
});

describe("saveProjectDefaultLayout", () => {
  test.each([...NETWORK_TOPOLOGY_LAYOUTS])(
    "makes %s the current project's default",
    async (layout: string) => {
      await saveProjectDefaultLayout(
        layout as (typeof NETWORK_TOPOLOGY_LAYOUTS)[number],
      );

      expect(updateByIdMock).toHaveBeenCalledTimes(1);
      const request: {
        modelType: unknown;
        id: ObjectID;
        data: Record<string, unknown>;
      } = updateByIdMock.mock.calls[0]![0] as {
        modelType: unknown;
        id: ObjectID;
        data: Record<string, unknown>;
      };
      expect(request.modelType).toBe(Project);
      expect(request.id.toString()).toBe(PROJECT_ID.toString());
      expect(request.data).toEqual({ defaultNetworkTopologyLayout: layout });
    },
  );

  test("clears it with null, and writes nothing else", async () => {
    await saveProjectDefaultLayout(null);

    const request: { data: Record<string, unknown> } = updateByIdMock.mock
      .calls[0]![0] as { data: Record<string, unknown> };
    expect(request.data).toEqual({ defaultNetworkTopologyLayout: null });
    expect(Object.keys(request.data)).toEqual([DEFAULT_LAYOUT_COLUMN]);
  });

  test("without a project it refuses, and asks nothing", async () => {
    currentProjectId = null;
    await expect(saveProjectDefaultLayout("star")).rejects.toThrow(
      "No project is selected.",
    );
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a refusal from the server reaches the caller", async () => {
    updateByIdMock.mockRejectedValue(
      new Error("You do not have permission to update this Project."),
    );
    await expect(saveProjectDefaultLayout("star")).rejects.toThrow(
      "You do not have permission to update this Project.",
    );
  });
});

describe("canChangeProjectDefaultLayout: who is offered the controls", () => {
  test.each([Permission.ProjectOwner, Permission.ProjectAdmin])(
    "%s is",
    (permission: Permission) => {
      permissionsForTest = [permission];
      expect(canChangeProjectDefaultLayout()).toBe(true);
    },
  );

  test.each([
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.ReadProject,
    Permission.ProjectUser,
    // These may update a project, but not this column.
    Permission.EditProject,
    Permission.ManageProjectBilling,
    Permission.BillingAdmin,
    Permission.BillingMember,
    // These may change the network, but not the project's settings.
    Permission.EditNetworkDevice,
    Permission.EditNetworkDeviceLink,
    Permission.EditNetworkSite,
  ])("%s is not", (permission: Permission) => {
    permissionsForTest = [permission];
    expect(canChangeProjectDefaultLayout()).toBe(false);
  });

  test("a master admin is", () => {
    isMasterAdminForTest = true;
    expect(canChangeProjectDefaultLayout()).toBe(true);
  });

  test("nobody is before their permissions have loaded: the controls are hidden, not refused", () => {
    permissionsForTest = [];
    expect(canChangeProjectDefaultLayout()).toBe(false);
  });

  test("the gate asks about this column, not the project as a whole", () => {
    const columnGate: ReturnType<typeof jest.spyOn> = jest.spyOn(
      PermissionGate,
      "checkColumnUpdate",
    );
    permissionsForTest = [Permission.ProjectAdmin];

    canChangeProjectDefaultLayout();

    expect(columnGate).toHaveBeenCalledTimes(1);
    expect(columnGate.mock.calls[0]![0]).toBeInstanceOf(Project);
    expect(columnGate.mock.calls[0]![1]).toBe("defaultNetworkTopologyLayout");
  });
});
