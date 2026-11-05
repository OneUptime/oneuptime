import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A PAGE'S GATES READ THE SNAPSHOT THAT LANDS AFTER THEY DREW.
 *
 * A project's permission snapshot arrives on an API response's header. The
 * first time this browser opens a project it has none yet, so what a page
 * draws first is read from the person's global permissions alone, and a gate
 * says they may not. A table's own buttons were put right by the table's own
 * list arriving, but a button a page gave the table, as Import JSON is, kept
 * what it said until something else drew the page: a Project Owner who opened
 * a new project's Label Rules found Import JSON locked, saying they lacked a
 * permission they held (the live LabelRules/ImportExport suite, which clicks
 * it). Each project's snapshot has been kept under its own name since a tab
 * stopped reading another project's, so this first visit is every project's.
 */

let isMasterAdminForTest: boolean = false;

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

import PermissionUtil, {
  getProjectPermissionsStorageKey,
} from "../../../UI/Utils/Permission";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import usePermissionSnapshot from "../../../UI/Utils/UsePermissionSnapshot";
import LocalStorage from "../../../UI/Utils/LocalStorage";
import Label from "../../../Models/DatabaseModels/Label";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";

const PROJECT_ID: string = "5f000000-0000-4000-8000-000000000011";
const OTHER_PROJECT_ID: string = "5f000000-0000-4000-8000-000000000012";

const ownerOf: (projectId: string) => UserTenantAccessPermission = (
  projectId: string,
): UserTenantAccessPermission => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(projectId),
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectOwner,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };
};

const GLOBAL_SNAPSHOT: UserGlobalAccessPermission = {
  _type: "UserGlobalAccessPermission",
  projectIds: [new ObjectID(PROJECT_ID)],
  globalPermissions: [Permission.Public, Permission.User],
  isMasterAdmin: false,
};

let draws: number = 0;

// A button a page hands its table, read as the page draws, as Import JSON's is.
const Page: FunctionComponent = (): ReactElement => {
  usePermissionSnapshot();
  draws++;

  const gate: PermissionGateResult = PermissionGate.check(
    new Label(),
    ModelAction.Create,
  );

  return (
    <button disabled={!gate.isAllowed} title={gate.disabledReason}>
      Import JSON
    </button>
  );
};

const button: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("button", { name: "Import JSON" });
};

beforeEach(() => {
  isMasterAdminForTest = false;
  draws = 0;
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(
    null,
    "",
    `/dashboard/${PROJECT_ID}/network-devices/settings/label-rules`,
  );
  PermissionUtil.setGlobalPermissions(GLOBAL_SNAPSHOT);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("the first visit to a project", () => {
  test("a button locked before the snapshot lands opens when it does", () => {
    render(<Page />);

    // Only the person's global permissions so far: this is what stood.
    expect(button()).toBeDisabled();

    act(() => {
      PermissionUtil.setProjectPermissions(ownerOf(PROJECT_ID), { hash: "h" });
    });

    expect(button()).toBeEnabled();
    expect(button()).not.toHaveAttribute("title");
  });

  test("a snapshot that takes a permission away locks it again, as soon as it lands", () => {
    PermissionUtil.setProjectPermissions(ownerOf(PROJECT_ID), { hash: "h" });
    render(<Page />);
    expect(button()).toBeEnabled();

    act(() => {
      PermissionUtil.clearProjectPermissions(PROJECT_ID);
    });

    expect(button()).toBeDisabled();
  });
});

describe("what is told", () => {
  test("an answer that changes nothing draws nothing: only a changed snapshot does", () => {
    PermissionUtil.setProjectPermissions(ownerOf(PROJECT_ID), { hash: "h" });
    render(<Page />);

    const before: number = draws;
    const version: number = PermissionUtil.getSnapshotVersion();

    act(() => {
      PermissionUtil.setProjectPermissions(ownerOf(PROJECT_ID), { hash: "h" });
      PermissionUtil.setGlobalPermissions(GLOBAL_SNAPSHOT);
    });

    expect(draws).toBe(before);
    expect(PermissionUtil.getSnapshotVersion()).toBe(version);
  });

  test("a storage that refuses the snapshot draws nothing, however often the server sends it", () => {
    render(<Page />);

    const before: number = draws;

    jest.spyOn(LocalStorage, "setItem").mockImplementation((): void => {
      throw new Error("The storage is full.");
    });

    act(() => {
      PermissionUtil.setProjectPermissions(ownerOf(PROJECT_ID), { hash: "h" });
      PermissionUtil.setProjectPermissions(ownerOf(PROJECT_ID), { hash: "h" });
    });

    expect(draws).toBe(before);
    expect(button()).toBeDisabled();
  });

  test("another project's snapshot is told too: a page that reads several projects reads it", () => {
    const told: jest.Mock<() => void> = jest.fn<() => void>();
    const stop: () => void = PermissionUtil.subscribeToSnapshots(told);

    PermissionUtil.setProjectPermissions(ownerOf(OTHER_PROJECT_ID));

    expect(told).toHaveBeenCalledTimes(1);
    expect(
      LocalStorage.getItem(
        getProjectPermissionsStorageKey(OTHER_PROJECT_ID) as string,
      ),
    ).not.toBeNull();

    stop();
  });

  test("nobody is told after they stop listening", () => {
    const told: jest.Mock<() => void> = jest.fn<() => void>();
    const stop: () => void = PermissionUtil.subscribeToSnapshots(told);

    stop();
    PermissionUtil.setProjectPermissions(ownerOf(PROJECT_ID));

    expect(told).not.toHaveBeenCalled();
  });

  test("a component that leaves the page stops listening", () => {
    const { unmount }: { unmount: () => void } = render(<Page />);

    unmount();

    const before: number = draws;

    PermissionUtil.setProjectPermissions(ownerOf(PROJECT_ID));

    expect(draws).toBe(before);
  });
});

describe("the Dashboard", () => {
  test("draws every page again when a snapshot lands", () => {
    const app: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/App.tsx",
      ),
      "utf8",
    );

    expect(app).toContain(
      'import usePermissionSnapshot from "Common/UI/Utils/UsePermissionSnapshot";',
    );
    expect(app).toMatch(/\n {2}usePermissionSnapshot\(\);\n/);
  });
});
