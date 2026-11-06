import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  clearAllProjectPermissions,
  getProjectPermissionRows,
  readResponseHeader,
  recordProjectPermissions,
  subscribeToProjectPermissions,
} from "./projectPermissions";
import type { ProjectPermissionRow } from "../oncall/globalOverrideAccess";

/*
 * The person's permission rows in each project, as the server last sent
 * them on an answer about that project (the `project-permissions` header).
 * The cover sheet reads them to know, before anything is chosen, whether
 * the server would accept cover for every policy.
 */

const PROJECT_A: string = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_B: string = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function snapshot(
  projectId: string,
  permissions: Array<Record<string, unknown>>,
): string {
  return JSON.stringify({
    _type: "UserTenantAccessPermission",
    projectId: { _type: "ObjectID", value: projectId },
    permissions: permissions,
  });
}

const LIMITED_TO_A_LABEL: Record<string, unknown> = {
  _type: "UserPermission",
  permission: "OnCallMember",
  labelIds: [{ _type: "ObjectID", value: "label-a" }],
  scope: "Labels",
  isBlockPermission: false,
};

const OVER_THE_WHOLE_PROJECT: Record<string, unknown> = {
  _type: "UserPermission",
  permission: "OnCallMember",
  labelIds: [],
  scope: "All",
  isBlockPermission: false,
};

// Headers as axios hands them over: an AxiosHeaders-like object with get().
function axiosHeaders(values: Record<string, string>): {
  get: (name: string) => string | undefined;
} {
  return {
    get: (name: string): string | undefined => {
      return values[name.toLowerCase()];
    },
  };
}

afterEach(() => {
  clearAllProjectPermissions();
});

describe("keeping a project's permission rows", () => {
  test("keeps the rows an answer about the project carries", () => {
    recordProjectPermissions(
      PROJECT_A,
      axiosHeaders({
        "project-permissions": snapshot(PROJECT_A, [LIMITED_TO_A_LABEL]),
      }),
    );

    expect(getProjectPermissionRows(PROJECT_A)).toEqual([
      {
        permission: "OnCallMember",
        labelIds: [{ _type: "ObjectID", value: "label-a" }],
        scope: "Labels",
        isBlockPermission: false,
      },
    ]);
    expect(getProjectPermissionRows(PROJECT_B)).toBeNull();
  });

  test("reads the header whatever its casing, from plain headers too", () => {
    recordProjectPermissions(PROJECT_A, {
      "Project-Permissions": snapshot(PROJECT_A, [OVER_THE_WHOLE_PROJECT]),
    });

    expect(getProjectPermissionRows(PROJECT_A)).toHaveLength(1);
    expect(getProjectPermissionRows(PROJECT_A.toUpperCase())).toHaveLength(1);
  });

  test("an answer without the header, or with one it cannot read, keeps what was there", () => {
    recordProjectPermissions(PROJECT_A, {
      "project-permissions": snapshot(PROJECT_A, [LIMITED_TO_A_LABEL]),
    });

    const kept: Array<ProjectPermissionRow> | null =
      getProjectPermissionRows(PROJECT_A);

    recordProjectPermissions(PROJECT_A, {});
    recordProjectPermissions(PROJECT_A, { "project-permissions": "{broken" });
    recordProjectPermissions(PROJECT_A, null);

    expect(getProjectPermissionRows(PROJECT_A)).toBe(kept);
  });

  test("a snapshot naming another project is not kept under this one", () => {
    recordProjectPermissions(PROJECT_A, {
      "project-permissions": snapshot(PROJECT_B, [OVER_THE_WHOLE_PROJECT]),
    });

    expect(getProjectPermissionRows(PROJECT_A)).toBeNull();
  });

  test("a later answer replaces the rows, and tells whoever listens", () => {
    const listener: jest.Mock = jest.fn();
    const unsubscribe: () => void = subscribeToProjectPermissions(
      listener as unknown as () => void,
    );

    recordProjectPermissions(PROJECT_A, {
      "project-permissions": snapshot(PROJECT_A, [LIMITED_TO_A_LABEL]),
    });
    recordProjectPermissions(PROJECT_A, {
      "project-permissions": snapshot(PROJECT_A, [OVER_THE_WHOLE_PROJECT]),
    });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(getProjectPermissionRows(PROJECT_A)?.[0]?.scope).toBe("All");

    unsubscribe();
    recordProjectPermissions(PROJECT_A, {
      "project-permissions": snapshot(PROJECT_A, [LIMITED_TO_A_LABEL]),
    });

    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("the same snapshot again - every answer carries it - changes nothing", () => {
    const listener: jest.Mock = jest.fn();
    const unsubscribe: () => void = subscribeToProjectPermissions(
      listener as unknown as () => void,
    );
    const value: string = snapshot(PROJECT_A, [LIMITED_TO_A_LABEL]);

    recordProjectPermissions(PROJECT_A, { "project-permissions": value });
    const first: Array<ProjectPermissionRow> | null =
      getProjectPermissionRows(PROJECT_A);
    recordProjectPermissions(PROJECT_A, { "project-permissions": value });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getProjectPermissionRows(PROJECT_A)).toBe(first);

    unsubscribe();
  });

  test("signing out forgets every project's rows", () => {
    const listener: jest.Mock = jest.fn();
    const unsubscribe: () => void = subscribeToProjectPermissions(
      listener as unknown as () => void,
    );

    recordProjectPermissions(PROJECT_A, {
      "project-permissions": snapshot(PROJECT_A, [LIMITED_TO_A_LABEL]),
    });
    recordProjectPermissions(PROJECT_B, {
      "project-permissions": snapshot(PROJECT_B, [OVER_THE_WHOLE_PROJECT]),
    });
    listener.mockClear();

    clearAllProjectPermissions();

    expect(getProjectPermissionRows(PROJECT_A)).toBeNull();
    expect(getProjectPermissionRows(PROJECT_B)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);

    // Nothing left to forget: nobody is told again.
    clearAllProjectPermissions();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  test("an answer about no project is not kept", () => {
    recordProjectPermissions("", {
      "project-permissions": snapshot(PROJECT_A, [OVER_THE_WHOLE_PROJECT]),
    });

    expect(getProjectPermissionRows("")).toBeNull();
    expect(getProjectPermissionRows(null)).toBeNull();
  });
});

describe("reading a response header", () => {
  test("by name, whatever its casing, and only a text value", () => {
    expect(readResponseHeader({ "X-Thing": "1" }, "x-thing")).toBe("1");
    expect(
      readResponseHeader(axiosHeaders({ "x-thing": "2" }), "X-Thing"),
    ).toBe("2");
    expect(readResponseHeader({ "x-thing": 3 }, "x-thing")).toBeNull();
    expect(readResponseHeader(undefined, "x-thing")).toBeNull();
  });
});
