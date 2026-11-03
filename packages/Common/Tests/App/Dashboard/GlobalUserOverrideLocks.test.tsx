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
import React from "react";
import { MemoryRouter } from "react-router-dom";
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
 * THE GLOBAL USER OVERRIDES PAGE SAYS WHO MAY ADD AND DELETE THERE
 * (issue #5617, Dashboard/src/Components/OnCallPolicy/UserOverrides/
 * GlobalUserOverrideLock).
 *
 * A global override applies to every on-call policy, so the server takes a
 * permission to add (or delete) overrides over the whole project for one
 * (GlobalUserOverrideAccess). Someone whose permission covers only some
 * policies - their team's label, or the policies their team owns - would
 * fill in Add User Override and be refused on save. On the real pages, with
 * only the network stubbed:
 *
 *   - the global page locks Add User Override for them, and each row's
 *     Delete, saying why and where their overrides go instead;
 *   - a "Get cover" link that brings them there says so instead of opening
 *     a form they cannot save;
 *   - a policy's own page is unchanged for them: the server holds an
 *     override there to the policy;
 *   - someone over the whole project adds and deletes on the global page as
 *     before.
 */

let allPermissionsForTest: Array<string> = [];
let projectRowsForTest: Array<unknown> = [];
let isMasterAdminForTest: boolean = false;

const PROJECT_ID: string = "0d518000-0000-4000-8000-000000000001";

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return allPermissionsForTest;
      },
      getProjectPermissions: (): unknown => {
        return {
          _type: "UserTenantAccessPermission",
          projectId: "0d518000-0000-4000-8000-000000000001",
          permissions: projectRowsForTest,
        };
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: [] };
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
      getUserId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "0d518000-0000-4000-8000-0000000000a1";
          },
        };
      },
      getProfilePictureRoute: (): string => {
        return "/picture";
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

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
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
      createOrUpdate: async (): Promise<{ data: null }> => {
        return { data: null };
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
            return "0d518000-0000-4000-8000-000000000001";
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

import GlobalUserOverridesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/UserOverrides";
import PolicyUserOverridesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/UserOverrides";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { getGlobalUserOverrideLock } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/GlobalUserOverrideLock";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import User from "../../../Models/DatabaseModels/User";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../Types/HeldPermissions";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
  GLOBAL_USER_OVERRIDE_DELETE_REFUSAL,
} from "../../../Types/OnCallDutyPolicy/GlobalUserOverrideAccess";
import { getUserOverrideCoverQueryParams } from "../../../Types/OnCallDutyPolicy/UserOverrideCoverRequest";
import Permission, { UserPermission } from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

jest.setTimeout(30000);

const POLICY_ID: string = "0d518000-0000-4000-8000-000000000002";
const TEAM_A_LABEL: string = "0d518000-0000-4000-8000-0000000000a3";
const ALEX: string = "0d518000-0000-4000-8000-0000000000a1";
const SAM: string = "0d518000-0000-4000-8000-0000000000b1";

const NOW: Date = OneUptimeDate.fromString("2026-11-03T12:00:00.000Z");
const NEXT_WEEK: Date = OneUptimeDate.fromString("2026-11-10T12:00:00.000Z");

const pageProps: PageComponentProps = {
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

const row: (
  permission: Permission,
  data?: {
    scope?: PermissionScope;
    labelIds?: Array<string>;
    isBlock?: boolean;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    scope?: PermissionScope;
    labelIds?: Array<string>;
    isBlock?: boolean;
  },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: (data?.labelIds || []).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    scope: data?.scope || PermissionScope.All,
    isBlockPermission: Boolean(data?.isBlock),
  };
};

const ON_CALL_MEMBER_ON_TEAM_A_LABEL: UserPermission = row(
  Permission.OnCallMember,
  { scope: PermissionScope.Labels, labelIds: [TEAM_A_LABEL] },
);
const ON_CALL_MEMBER_ON_OWNED: UserPermission = row(Permission.OnCallMember, {
  scope: PermissionScope.Owned,
});
const READS_EVERY_POLICY: UserPermission = row(Permission.Viewer);

// The reader holds these rows, as the permission snapshot carries them.
function holding(rows: Array<UserPermission>): void {
  projectRowsForTest = rows;
  allPermissionsForTest = Array.from(
    new Set<string>(
      rows
        .filter((candidate: UserPermission): boolean => {
          return !candidate.isBlockPermission;
        })
        .map((candidate: UserPermission): string => {
          return candidate.permission;
        }),
    ),
  );
}

const heldFrom: (rows: Array<UserPermission>) => HeldPermissions = (
  rows: Array<UserPermission>,
): HeldPermissions => {
  return HeldPermissionsUtil.fromRows({ rows });
};

let overrides: Array<OnCallDutyPolicyUserOverride> = [];

function list(data: Array<unknown>): JSONObject {
  return { data, count: data.length, skip: 0, limit: 50 } as JSONObject;
}

function person(id: string, name: string): User {
  const result: User = new User();
  result._id = id;
  result.name = new Name(name);
  result.email = new Email(`${name.split(" ")[0]!.toLowerCase()}@example.com`);
  return result;
}

function globalOverride(): OnCallDutyPolicyUserOverride {
  const result: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();
  result._id = "0d518000-0000-4000-8000-0000000000f1";
  result.overrideUserId = new ObjectID(ALEX);
  result.overrideUser = person(ALEX, "Alex Chen");
  result.routeAlertsToUserId = new ObjectID(SAM);
  result.routeAlertsToUser = person(SAM, "Sam Rivera");
  result.startsAt = NOW;
  result.endsAt = NEXT_WEEK;
  return result;
}

beforeEach(() => {
  holding([row(Permission.ProjectAdmin)]);
  isMasterAdminForTest = false;
  overrides = [];
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    if (params.modelType === OnCallDutyPolicyUserOverride) {
      return list(overrides);
    }

    return list([]);
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  jest.restoreAllMocks();
});

async function renderPage(
  page: "global" | "policy",
  search: string = "",
): Promise<void> {
  const path: string =
    page === "global"
      ? `/dashboard/${PROJECT_ID}/on-call-duty/user-overrides`
      : `/dashboard/${PROJECT_ID}/on-call-duty/policies/${POLICY_ID}/user-overrides`;

  window.history.replaceState(window.history.state, "", `${path}${search}`);

  Navigation.setLocation({
    pathname: path,
    search: search,
    hash: "",
    state: null,
    key: "test",
  } as never);

  render(
    <MemoryRouter>
      {page === "global" ? (
        <GlobalUserOverridesPage {...pageProps} />
      ) : (
        <PolicyUserOverridesPage {...pageProps} />
      )}
    </MemoryRouter>,
  );

  await waitFor(
    () => {
      expect(
        getListMock.mock.calls.some((call: Array<any>): boolean => {
          return call[0].modelType === OnCallDutyPolicyUserOverride;
        }),
      ).toBe(true);
    },
    { timeout: 10000 },
  );
}

// The card's Add User Override button (the table's own, or its locked stand-in).
async function addButton(): Promise<HTMLElement> {
  return await waitFor((): HTMLElement => {
    const found: HTMLElement | undefined = screen
      .getAllByTestId("card-button")
      .find((candidate: HTMLElement): boolean => {
        return (candidate.textContent || "").trim() === "Add User Override";
      });

    if (!found) {
      throw new Error("No Add User Override button yet");
    }

    return found;
  });
}

describe("why Add or Delete is locked on the global page", () => {
  test("a reader limited to their team's label: Add and Delete are locked, each with its reason", () => {
    const held: HeldPermissions = heldFrom([
      ON_CALL_MEMBER_ON_TEAM_A_LABEL,
      READS_EVERY_POLICY,
    ]);

    expect(getGlobalUserOverrideLock(ModelAction.Create, { held })).toBe(
      GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
    );
    expect(getGlobalUserOverrideLock(ModelAction.Delete, { held })).toBe(
      GLOBAL_USER_OVERRIDE_DELETE_REFUSAL,
    );
  });

  test("a reader limited to what their team owns: locked the same way", () => {
    const held: HeldPermissions = heldFrom([
      ON_CALL_MEMBER_ON_OWNED,
      READS_EVERY_POLICY,
    ]);

    expect(getGlobalUserOverrideLock(ModelAction.Create, { held })).toBe(
      GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
    );
    expect(getGlobalUserOverrideLock(ModelAction.Delete, { held })).toBe(
      GLOBAL_USER_OVERRIDE_DELETE_REFUSAL,
    );
  });

  test("a reader over the whole project: nothing is locked", () => {
    for (const permission of [
      Permission.OnCallMember,
      Permission.OnCallAdmin,
      Permission.ProjectMember,
      Permission.ProjectAdmin,
    ]) {
      const held: HeldPermissions = heldFrom([row(permission)]);

      expect({
        permission,
        add: getGlobalUserOverrideLock(ModelAction.Create, { held }),
        remove: getGlobalUserOverrideLock(ModelAction.Delete, { held }),
      }).toEqual({ permission, add: null, remove: null });
    }
  });

  test("one row over the whole project beside a narrower one: nothing is locked", () => {
    const held: HeldPermissions = heldFrom([
      ON_CALL_MEMBER_ON_TEAM_A_LABEL,
      row(Permission.OnCallMember),
    ]);

    expect(getGlobalUserOverrideLock(ModelAction.Create, { held })).toBeNull();
  });

  test("a block with labels on adding overrides locks Add: a global one would reach the blocked policies", () => {
    const held: HeldPermissions = heldFrom([
      row(Permission.OnCallMember),
      row(Permission.CreateOnCallDutyPolicyUserOverride, {
        isBlock: true,
        labelIds: [TEAM_A_LABEL],
      }),
    ]);

    expect(getGlobalUserOverrideLock(ModelAction.Create, { held })).toBe(
      GLOBAL_USER_OVERRIDE_ADD_REFUSAL,
    );
    // Deleting is a permission of its own, not blocked here.
    expect(getGlobalUserOverrideLock(ModelAction.Delete, { held })).toBeNull();
  });

  test("a reader who may not add overrides at all is left to the table's own lock, which names the permission", () => {
    const held: HeldPermissions = heldFrom([READS_EVERY_POLICY]);

    expect(getGlobalUserOverrideLock(ModelAction.Create, { held })).toBeNull();
    expect(
      PermissionGate.check(
        new OnCallDutyPolicyUserOverride(),
        ModelAction.Create,
        {
          held,
        },
      ).isAllowed,
    ).toBe(false);
  });

  test("a master admin is never locked", () => {
    isMasterAdminForTest = true;

    expect(
      getGlobalUserOverrideLock(ModelAction.Create, {
        held: heldFrom([ON_CALL_MEMBER_ON_TEAM_A_LABEL]),
      }),
    ).toBeNull();
  });
});

describe("the global page", () => {
  test("for a reader limited to their team's label: Add User Override is there, locked, and opens nothing", async () => {
    holding([ON_CALL_MEMBER_ON_TEAM_A_LABEL, READS_EVERY_POLICY]);

    await renderPage("global");

    const button: HTMLElement = await addButton();

    expect(button).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(button);
    await act(async (): Promise<void> => {});

    expect(screen.queryByTestId("modal")).toBeNull();

    // Pressed, it says why: the wrapper a locked button is drawn in.
    fireEvent.click(button.closest("span[tabindex]") as HTMLElement);

    await waitFor(() => {
      expect(document.body).toHaveTextContent(GLOBAL_USER_OVERRIDE_ADD_REFUSAL);
    });
  });

  test("for a reader over the whole project: Add User Override opens the form, as before", async () => {
    holding([row(Permission.OnCallMember)]);

    await renderPage("global");

    const button: HTMLElement = await addButton();

    expect(button).not.toHaveAttribute("aria-disabled", "true");

    fireEvent.click(button);

    const modal: HTMLElement = await screen.findByTestId("modal");

    expect(await within(modal).findByText("Who covers?")).toBeInTheDocument();
  });

  test("a Get cover link that brings a reader limited to a label here says why instead of opening the form", async () => {
    holding([ON_CALL_MEMBER_ON_TEAM_A_LABEL, READS_EVERY_POLICY]);

    const params: Record<string, string> = getUserOverrideCoverQueryParams({
      startsAt: OneUptimeDate.fromString("2026-11-04T09:00:00.000Z"),
      endsAt: OneUptimeDate.fromString("2026-11-04T17:00:00.000Z"),
    }) as Record<string, string>;
    const search: string = `?${Object.entries(params)
      .map(([key, value]: [string, string]): string => {
        return `${key}=${value}`;
      })
      .join("&")}`;

    await renderPage("global", search);

    expect(
      await screen.findByTestId("global-user-override-cover-locked"),
    ).toHaveTextContent(GLOBAL_USER_OVERRIDE_ADD_REFUSAL);

    await act(async (): Promise<void> => {});

    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("a Get cover link opens the form for a reader over the whole project, with no word of a lock", async () => {
    holding([row(Permission.OnCallMember)]);

    const params: Record<string, string> = getUserOverrideCoverQueryParams({
      startsAt: OneUptimeDate.fromString("2026-11-04T09:00:00.000Z"),
      endsAt: OneUptimeDate.fromString("2026-11-04T17:00:00.000Z"),
    }) as Record<string, string>;
    const search: string = `?${Object.entries(params)
      .map(([key, value]: [string, string]): string => {
        return `${key}=${value}`;
      })
      .join("&")}`;

    await renderPage("global", search);

    expect(await screen.findByTestId("modal")).toBeInTheDocument();
    expect(
      screen.queryByTestId("global-user-override-cover-locked"),
    ).toBeNull();
  });
});

describe("a policy's own page", () => {
  test("for a reader limited to their team's label, Add User Override is not locked: the server holds the override to the policy", async () => {
    holding([ON_CALL_MEMBER_ON_TEAM_A_LABEL, READS_EVERY_POLICY]);

    await renderPage("policy");

    const button: HTMLElement = await addButton();

    expect(button).not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("a global override's Delete", () => {
  // The ⋯ menu of the row of the override Alex is away in.
  async function openRowMenu(): Promise<HTMLElement> {
    const name: HTMLElement = await screen.findByText("Alex Chen");
    const tableRow: HTMLElement = name.closest("tr")!;

    fireEvent.click(within(tableRow).getByTestId("row-actions-more-button"));

    return screen.getByRole("menu");
  }

  // The words a locked menu item says why with.
  function reasonOf(item: HTMLElement): string | null {
    const describedBy: string | null = item.getAttribute("aria-describedby");

    return describedBy
      ? document.getElementById(describedBy)?.textContent || null
      : null;
  }

  test("for a reader limited to their team's label it stays in the menu, locked, saying why - and opens nothing", async () => {
    holding([ON_CALL_MEMBER_ON_TEAM_A_LABEL, READS_EVERY_POLICY]);
    overrides = [globalOverride()];

    await renderPage("global");

    const menu: HTMLElement = await openRowMenu();
    const deleteItem: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Delete",
    });

    expect(deleteItem).toHaveAttribute("aria-disabled", "true");
    expect(reasonOf(deleteItem)).toBe(GLOBAL_USER_OVERRIDE_DELETE_REFUSAL);

    fireEvent.click(deleteItem);
    await act(async (): Promise<void> => {});

    expect(document.querySelector('[data-testid="modal-footer"]')).toBeNull();
  });

  test("for a reader over the whole project it deletes as before", async () => {
    holding([row(Permission.OnCallMember)]);
    overrides = [globalOverride()];

    await renderPage("global");

    const menu: HTMLElement = await openRowMenu();
    const deleteItem: HTMLElement = within(menu).getByRole("menuitem", {
      name: "Delete",
    });

    expect(deleteItem).not.toHaveAttribute("aria-disabled", "true");

    fireEvent.click(deleteItem);

    await waitFor(() => {
      expect(
        document.querySelector('[data-testid="modal-footer"]'),
      ).not.toBeNull();
    });
  });
});
