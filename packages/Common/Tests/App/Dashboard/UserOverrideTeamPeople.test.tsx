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
 * THE OVERRIDE PICKERS OFFER ONLY THE PEOPLE OF THE READER'S TEAM, SAYING
 * WHY - for a reader who manages user overrides through Manage On-Call
 * Policy User Overrides for Own Team (issue #9733,
 * Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideTeamLimit).
 *
 * "Applies to: UI Filtering in 'Add New User Override' modal, and 'Who is
 * away?'. Also filter for: 'Who covers?'." The server refuses an override
 * that names anybody outside the teams that give the permission; on the
 * real User Overrides page, with only the network stubbed:
 *
 *   - "Who is away?" and "Who covers?" list only those teams' accepted
 *     members, and say above the list which teams and why;
 *   - each row that names somebody outside them locks its Edit, End Now and
 *     Delete, saying why, and a row of the team's people does not;
 *   - a reader whose permission reaches everyone sees the page as before:
 *     everyone listed, no line above the list, nothing locked.
 *
 * Alex (signed in) and Sam are in Payments, which gives the permission;
 * Pat is in Mobile, which does not.
 */

let allPermissionsForTest: Array<string> = [];
let projectRowsForTest: Array<unknown> = [];
let isMasterAdminForTest: boolean = false;

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
          projectId: "9733d000-0000-4000-8000-000000000001",
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
            return "9733d000-0000-4000-8000-0000000000a1";
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
            return "9733d000-0000-4000-8000-000000000001";
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
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  getUserOverrideTeamHint,
  getUserOverrideTeamLimit,
  getUserOverrideTeamLock,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideTeamLimit";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import HeldPermissionsUtil, {
  HeldPermissions,
  TeamGrants,
} from "../../../Types/HeldPermissions";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  USER_OVERRIDE_TEAM_DELETE_REFUSAL,
  USER_OVERRIDE_TEAM_EDIT_REFUSAL,
} from "../../../Types/OnCallDutyPolicy/UserOverrideTeamAccess";
import Permission, { UserPermission } from "../../../Types/Permission";
import { createTranslator } from "../../../Types/Translator";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

jest.setTimeout(30000);

const PROJECT_ID: string = "9733d000-0000-4000-8000-000000000001";
const PAYMENTS: string = "9733d000-0000-4000-8000-0000000000f1";
const MOBILE: string = "9733d000-0000-4000-8000-0000000000f2";
const PAYMENTS_LABEL: string = "9733d000-0000-4000-8000-0000000000e1";

const ALEX: string = "9733d000-0000-4000-8000-0000000000a1";
const SAM: string = "9733d000-0000-4000-8000-0000000000b1";
const PAT: string = "9733d000-0000-4000-8000-0000000000c1";

const PEOPLE: Record<string, { name: string; email: string }> = {
  [ALEX]: { name: "Alex Chen", email: "alex@example.com" },
  [SAM]: { name: "Sam Rivera", email: "sam@example.com" },
  [PAT]: { name: "Pat Kim", email: "pat@example.com" },
};

// Who is in which team.
const MEMBERSHIPS: Array<{ teamId: string; userId: string }> = [
  { teamId: PAYMENTS, userId: ALEX },
  { teamId: PAYMENTS, userId: SAM },
  { teamId: MOBILE, userId: PAT },
];

const TEAM_NAMES: Record<string, string> = {
  [PAYMENTS]: "Payments",
  [MOBILE]: "Mobile",
};

const NOW: Date = OneUptimeDate.fromString("2026-11-19T12:00:00.000Z");
const TOMORROW: Date = OneUptimeDate.fromString("2026-11-20T09:00:00.000Z");
const NEXT_WEEK: Date = OneUptimeDate.fromString("2026-11-26T09:00:00.000Z");

const pageProps: PageComponentProps = {
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

const TEAM_PERMISSION: Permission =
  Permission.ManageTeamOnCallDutyPolicyUserOverride;

const row: (
  permission: Permission,
  data?: {
    teamId?: string;
    scope?: PermissionScope;
    labelIds?: Array<string>;
    isBlock?: boolean;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    teamId?: string;
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
    ...(data?.teamId ? { teamId: new ObjectID(data.teamId) } : {}),
  };
};

// Reads the on-call pages; Payments gives the team permission.
const TEAM_SCOPED: Array<UserPermission> = [
  row(Permission.OnCallViewer),
  row(TEAM_PERMISSION, { teamId: PAYMENTS }),
];

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

const grantsFrom: (rows: Array<UserPermission>) => TeamGrants = (
  rows: Array<UserPermission>,
): TeamGrants => {
  return HeldPermissionsUtil.getTeamGrants(rows, TEAM_PERMISSION);
};

let overrides: Array<OnCallDutyPolicyUserOverride> = [];

function list(data: Array<unknown>): JSONObject {
  return { data, count: data.length, skip: 0, limit: 50 } as JSONObject;
}

// Whether an Includes condition names `id`; no condition names every id.
function wanted(value: unknown, id: string): boolean {
  if (!(value instanceof Includes)) {
    return true;
  }

  return (value.values as Array<unknown>).some(
    (candidate: unknown): boolean => {
      return String(candidate).toLowerCase() === id.toLowerCase();
    },
  );
}

function user(id: string): User {
  const person: User = new User();
  person._id = id;
  person.name = new Name(PEOPLE[id]!.name);
  person.email = new Email(PEOPLE[id]!.email);
  return person;
}

function override(data: {
  id: string;
  away: string;
  cover?: string | undefined;
}): OnCallDutyPolicyUserOverride {
  const saved: OnCallDutyPolicyUserOverride =
    new OnCallDutyPolicyUserOverride();
  saved._id = data.id;
  saved.overrideUserId = new ObjectID(data.away);
  saved.overrideUser = user(data.away);

  if (data.cover) {
    saved.routeAlertsToUserId = new ObjectID(data.cover);
    saved.routeAlertsToUser = user(data.cover);
  }

  saved.startsAt = TOMORROW;
  saved.endsAt = NEXT_WEEK;
  return saved;
}

// The reads of team members: the pickers' searches and the teams' member lists.
function teamMemberReads(): Array<{
  query: Record<string, unknown>;
  select: Record<string, unknown>;
}> {
  return getListMock.mock.calls
    .filter((call: Array<any>): boolean => {
      return call[0].modelType === TeamMember;
    })
    .map((call: Array<any>) => {
      return {
        query: (call[0].query || {}) as Record<string, unknown>,
        select: (call[0].select || {}) as Record<string, unknown>,
      };
    });
}

/*
 * The searches a picker's list made: they ask for each person's name, and
 * name nobody in particular - a look-up of a pick's name asks by its id.
 */
function pickerSearches(): Array<Record<string, unknown>> {
  return teamMemberReads()
    .filter(
      (read: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
      }): boolean => {
        return Boolean(read.select["user"]) && !read.query["userId"];
      },
    )
    .map((read: { query: Record<string, unknown> }) => {
      return read.query;
    });
}

beforeEach(() => {
  holding(TEAM_SCOPED);
  isMasterAdminForTest = false;
  overrides = [];
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  getListMock.mockImplementation(async (params: any): Promise<any> => {
    const query: Record<string, unknown> = params.query || {};

    if (params.modelType === OnCallDutyPolicyUserOverride) {
      return list(overrides);
    }

    if (params.modelType === Team) {
      return list(
        Object.keys(TEAM_NAMES)
          .filter((id: string): boolean => {
            return wanted(query["_id"], id);
          })
          .map((id: string): Team => {
            const team: Team = new Team();
            team._id = id;
            team.name = TEAM_NAMES[id]!;
            return team;
          }),
      );
    }

    // Searches and look-ups by id, and the teams' member lists.
    if (params.modelType === TeamMember) {
      const found: Array<TeamMember> = [];

      for (const membership of MEMBERSHIPS) {
        if (
          !wanted(query["teamId"], membership.teamId) ||
          !wanted(query["userId"], membership.userId)
        ) {
          continue;
        }

        const member: TeamMember = new TeamMember();
        member.userId = new ObjectID(membership.userId);
        member.user = user(membership.userId);
        found.push(member);
      }

      return list(found);
    }

    return list([]);
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  jest.restoreAllMocks();
});

async function renderGlobalPage(): Promise<void> {
  const path: string = `/dashboard/${PROJECT_ID}/on-call-duty/user-overrides`;

  window.history.replaceState(window.history.state, "", path);

  Navigation.setLocation({
    pathname: path,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as never);

  render(
    <MemoryRouter>
      <GlobalUserOverridesPage {...pageProps} />
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

async function openAddDialog(): Promise<HTMLElement> {
  const button: HTMLElement = await waitFor((): HTMLElement => {
    const found: HTMLElement | undefined = screen
      .getAllByRole("button")
      .find((candidate: HTMLElement): boolean => {
        return (candidate.textContent || "").trim() === "Add User Override";
      });

    if (!found) {
      throw new Error("No Add User Override button yet");
    }

    return found;
  });

  fireEvent.click(button);

  const modal: HTMLElement = await screen.findByTestId("modal");

  await within(modal).findByText("Who covers?");

  return modal;
}

async function openPicker(
  modal: HTMLElement,
  question: string,
  listName: string,
): Promise<HTMLElement> {
  // The picker is loaded on its own, after the dialog: its group, once drawn.
  const group: HTMLElement = await within(modal).findByRole(
    "group",
    { name: question },
    { timeout: 10000 },
  );

  fireEvent.click(within(group).getByTestId("people-picker-add-button"));

  const popup: HTMLElement = await screen.findByRole("dialog", {
    name: listName,
  });

  await waitFor(() => {
    expect(within(popup).getByRole("listbox")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  return popup;
}

function listedIds(popup: HTMLElement): Array<string | null> {
  return within(popup)
    .queryAllByTestId("people-search-option")
    .map((option: HTMLElement): string | null => {
      return option.getAttribute("data-id");
    });
}

// The row of the override `name` is away in.
async function tableRowOf(name: string): Promise<HTMLElement> {
  const cell: HTMLElement = await screen.findByText(name);
  return cell.closest("tr") as HTMLElement;
}

// What a locked menu item says why with.
function reasonOf(item: HTMLElement): string | null {
  const describedBy: string | null = item.getAttribute("aria-describedby");

  return describedBy
    ? document.getElementById(describedBy)?.textContent || null
    : null;
}

describe("whom the reader may name, read from the permission snapshot", () => {
  test("the team permission alone: the people of the team that gives it, for every write", () => {
    for (const action of [
      ModelAction.Create,
      ModelAction.Update,
      ModelAction.Delete,
    ] as const) {
      for (const isGlobal of [true, false]) {
        expect(
          getUserOverrideTeamLimit({
            action,
            isGlobal,
            held: heldFrom(TEAM_SCOPED),
            grants: grantsFrom(TEAM_SCOPED),
          }),
        ).toEqual({ teamIds: [PAYMENTS] });
      }
    }
  });

  test("given by two teams, both teams' people", () => {
    const rows: Array<UserPermission> = [
      ...TEAM_SCOPED,
      row(TEAM_PERMISSION, { teamId: MOBILE }),
    ];

    expect(
      getUserOverrideTeamLimit({
        action: ModelAction.Create,
        isGlobal: true,
        held: heldFrom(rows),
        grants: grantsFrom(rows),
      }),
    ).toEqual({ teamIds: [PAYMENTS, MOBILE] });
  });

  test("a permission that reaches everyone over the whole project: nobody is left out", () => {
    for (const permission of [
      Permission.OnCallMember,
      Permission.OnCallAdmin,
      Permission.ProjectMember,
      Permission.ProjectAdmin,
      Permission.ProjectOwner,
    ]) {
      const rows: Array<UserPermission> = [...TEAM_SCOPED, row(permission)];

      expect({
        permission,
        limit: getUserOverrideTeamLimit({
          action: ModelAction.Create,
          isGlobal: true,
          held: heldFrom(rows),
          grants: grantsFrom(rows),
        }),
      }).toEqual({ permission, limit: null });
    }
  });

  test("the single permission of a write reaching everyone frees that write only", () => {
    const rows: Array<UserPermission> = [
      ...TEAM_SCOPED,
      row(Permission.EditOnCallDutyPolicyUserOverride),
    ];

    const limitOf: (
      action: ModelAction.Create | ModelAction.Update,
    ) => unknown = (
      action: ModelAction.Create | ModelAction.Update,
    ): unknown => {
      return getUserOverrideTeamLimit({
        action,
        isGlobal: true,
        held: heldFrom(rows),
        grants: grantsFrom(rows),
      });
    };

    expect(limitOf(ModelAction.Update)).toBeNull();
    expect(limitOf(ModelAction.Create)).toEqual({ teamIds: [PAYMENTS] });
  });

  test("beside a permission narrowed to a label: a global override keeps to the team, an override on a policy is the server's to weigh", () => {
    const rows: Array<UserPermission> = [
      ...TEAM_SCOPED,
      row(Permission.CreateOnCallDutyPolicyUserOverride, {
        scope: PermissionScope.Labels,
        labelIds: [PAYMENTS_LABEL],
      }),
    ];

    expect(
      getUserOverrideTeamLimit({
        action: ModelAction.Create,
        isGlobal: true,
        held: heldFrom(rows),
        grants: grantsFrom(rows),
      }),
    ).toEqual({ teamIds: [PAYMENTS] });
    expect(
      getUserOverrideTeamLimit({
        action: ModelAction.Create,
        isGlobal: false,
        held: heldFrom(rows),
        grants: grantsFrom(rows),
      }),
    ).toBeNull();
  });

  test("a team's grant narrowed to a label reaches no global override, and its policies' overrides", () => {
    const rows: Array<UserPermission> = [
      row(Permission.OnCallViewer),
      row(TEAM_PERMISSION, {
        teamId: PAYMENTS,
        scope: PermissionScope.Labels,
        labelIds: [PAYMENTS_LABEL],
      }),
      row(TEAM_PERMISSION, { teamId: MOBILE }),
    ];

    expect(
      getUserOverrideTeamLimit({
        action: ModelAction.Create,
        isGlobal: true,
        held: heldFrom(rows),
        grants: grantsFrom(rows),
      }),
    ).toEqual({ teamIds: [MOBILE] });
    expect(
      getUserOverrideTeamLimit({
        action: ModelAction.Create,
        isGlobal: false,
        held: heldFrom(rows),
        grants: grantsFrom(rows),
      }),
    ).toEqual({ teamIds: [PAYMENTS, MOBILE] });
  });

  test("no team permission, a block on it, or a master admin: not limited by it", () => {
    for (const rows of [
      [row(Permission.OnCallViewer)],
      [...TEAM_SCOPED, row(TEAM_PERMISSION, { isBlock: true })],
    ]) {
      expect(
        getUserOverrideTeamLimit({
          action: ModelAction.Create,
          isGlobal: true,
          held: heldFrom(rows),
          grants: grantsFrom(rows),
        }),
      ).toBeNull();
    }

    isMasterAdminForTest = true;

    expect(
      getUserOverrideTeamLimit({
        action: ModelAction.Create,
        isGlobal: true,
        held: heldFrom(TEAM_SCOPED),
        grants: grantsFrom(TEAM_SCOPED),
      }),
    ).toBeNull();
  });
});

describe("which overrides are locked for it", () => {
  const MEMBERS: ReadonlySet<string> = new Set<string>([ALEX, SAM]);
  const LIMIT: { teamIds: Array<string> } = { teamIds: [PAYMENTS] };

  test("one that names somebody outside the teams, away or covering: Edit and Delete say why", () => {
    for (const people of [
      { awayUserId: PAT, coverUserId: SAM },
      { awayUserId: SAM, coverUserId: PAT },
      { awayUserId: PAT, coverUserId: null },
    ]) {
      expect(
        getUserOverrideTeamLock({
          action: ModelAction.Update,
          limit: LIMIT,
          memberIds: MEMBERS,
          people,
        }),
      ).toBe(USER_OVERRIDE_TEAM_EDIT_REFUSAL);
      expect(
        getUserOverrideTeamLock({
          action: ModelAction.Delete,
          limit: LIMIT,
          memberIds: MEMBERS,
          people,
        }),
      ).toBe(USER_OVERRIDE_TEAM_DELETE_REFUSAL);
    }
  });

  test("one of the team's people - a skip too, ids in any case - is not", () => {
    for (const people of [
      { awayUserId: ALEX, coverUserId: SAM },
      { awayUserId: SAM, coverUserId: null },
      { awayUserId: SAM.toUpperCase(), coverUserId: ALEX.toUpperCase() },
    ]) {
      expect(
        getUserOverrideTeamLock({
          action: ModelAction.Update,
          limit: LIMIT,
          memberIds: MEMBERS,
          people,
        }),
      ).toBeNull();
    }
  });

  test("nothing is locked while the members are not known, or for a reader not limited", () => {
    const people: { awayUserId: string; coverUserId: string } = {
      awayUserId: PAT,
      coverUserId: SAM,
    };

    expect(
      getUserOverrideTeamLock({
        action: ModelAction.Update,
        limit: LIMIT,
        memberIds: null,
        people,
      }),
    ).toBeNull();
    expect(
      getUserOverrideTeamLock({
        action: ModelAction.Delete,
        limit: null,
        memberIds: MEMBERS,
        people,
      }),
    ).toBeNull();
  });
});

describe("the line above a picker's list", () => {
  test("names the teams, each as the project calls it", () => {
    expect(
      getUserOverrideTeamHint({
        translator: createTranslator(undefined),
        teamNames: ["Payments", "Mobile"],
      }),
    ).toBe(
      "Only people in Payments, Mobile are listed: the teams that let you manage user overrides.",
    );
  });

  test("says nothing with no team named", () => {
    expect(
      getUserOverrideTeamHint({
        translator: createTranslator(undefined),
        teamNames: [],
      }),
    ).toBeNull();
  });
});

describe("the global User Overrides page, for a reader who manages their team's overrides", () => {
  test("Who covers? lists only Payments' people, and says why above the list", async () => {
    await renderGlobalPage();
    const modal: HTMLElement = await openAddDialog();

    const popup: HTMLElement = await openPicker(
      modal,
      "Who covers?",
      "Choose someone",
    );

    // Alex is away (the dialog starts with the reader), so only Sam is left.
    await waitFor(() => {
      expect(listedIds(popup)).toEqual([SAM]);
    });

    expect(within(popup).getByTestId("people-search-hint")).toHaveTextContent(
      "Only people in Payments are listed: the teams that let you manage user overrides.",
    );

    // The search asked for Payments' accepted members only.
    const searches: Array<Record<string, unknown>> = pickerSearches();
    expect(searches.length).toBeGreaterThan(0);

    for (const query of searches) {
      expect(query["teamId"]).toBeInstanceOf(Includes);
      expect((query["teamId"] as Includes).values).toEqual([PAYMENTS]);
      expect(query["hasAcceptedInvitation"]).toBe(true);
    }
  });

  test("Who is away? lists only Payments' people too", async () => {
    await renderGlobalPage();
    const modal: HTMLElement = await openAddDialog();

    const popup: HTMLElement = await openPicker(
      modal,
      "Who is away?",
      "Choose who is away",
    );

    await waitFor(() => {
      expect([...listedIds(popup)].sort()).toEqual([ALEX, SAM].sort());
    });
    expect(listedIds(popup)).not.toContain(PAT);
    expect(within(popup).getByTestId("people-search-hint")).toBeVisible();
  });

  test("a row naming somebody of another team locks Edit and Delete, saying why; a row of the team's people does not", async () => {
    overrides = [
      override({
        id: "9733d000-0000-4000-8000-0000000000d1",
        away: PAT,
        cover: SAM,
      }),
      override({
        id: "9733d000-0000-4000-8000-0000000000d2",
        away: ALEX,
        cover: SAM,
      }),
    ];

    await renderGlobalPage();

    const outsiders: HTMLElement = await tableRowOf("Pat Kim");

    await waitFor(() => {
      expect(
        within(outsiders).getByRole("button", { name: "Edit" }),
      ).toHaveAttribute("aria-disabled", "true");
    });

    fireEvent.click(
      within(outsiders)
        .getByRole("button", { name: "Edit" })
        .closest("span[tabindex]") as HTMLElement,
    );

    await waitFor(() => {
      expect(document.body).toHaveTextContent(USER_OVERRIDE_TEAM_EDIT_REFUSAL);
    });

    fireEvent.click(within(outsiders).getByTestId("row-actions-more-button"));

    const deleteItem: HTMLElement = within(screen.getByRole("menu")).getByRole(
      "menuitem",
      { name: "Delete" },
    );

    expect(deleteItem).toHaveAttribute("aria-disabled", "true");
    expect(reasonOf(deleteItem)).toBe(USER_OVERRIDE_TEAM_DELETE_REFUSAL);

    // Alex's own override, Sam covering: both of Payments.
    const teammates: HTMLElement = (await screen.findAllByText("Alex Chen"))
      .map((cell: HTMLElement): HTMLElement => {
        return cell.closest("tr") as HTMLElement;
      })
      .find((candidate: HTMLElement | null): boolean => {
        return Boolean(candidate);
      }) as HTMLElement;

    expect(
      within(teammates).getByRole("button", { name: "Edit" }),
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  test("a reader whose permission reaches everyone: everyone listed, no line above the list, nothing locked", async () => {
    holding([row(Permission.OnCallMember), ...TEAM_SCOPED]);
    overrides = [
      override({
        id: "9733d000-0000-4000-8000-0000000000d1",
        away: PAT,
        cover: SAM,
      }),
    ];

    await renderGlobalPage();

    expect(
      within(await tableRowOf("Pat Kim")).getByRole("button", {
        name: "Edit",
      }),
    ).not.toHaveAttribute("aria-disabled", "true");

    const modal: HTMLElement = await openAddDialog();
    const popup: HTMLElement = await openPicker(
      modal,
      "Who covers?",
      "Choose someone",
    );

    await waitFor(() => {
      expect([...listedIds(popup)].sort()).toEqual([PAT, SAM].sort());
    });

    expect(within(popup).queryByTestId("people-search-hint")).toBeNull();

    for (const query of pickerSearches()) {
      expect(query["teamId"]).toBeUndefined();
    }

    // No team's members were read for it.
    expect(
      teamMemberReads().some(
        (read: { select: Record<string, unknown> }): boolean => {
          return Boolean(read.select["userId"]);
        },
      ),
    ).toBe(false);

    await act(async (): Promise<void> => {});
  });
});
