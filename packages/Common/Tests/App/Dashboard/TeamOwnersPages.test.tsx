import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A TEAM'S OWNERS ON THE DASHBOARD (#6561): the people and teams who look
 * after a team, on its page and in the Teams list, with only the network
 * stubbed.
 *
 *   - A team's page lists its owners in the Owners card every resource with
 *     owners has, over TeamOwnerUser and TeamOwnerTeam by ownedTeamId, and
 *     says what they do;
 *   - Owners and Admin, which come with every project, take no owners: their
 *     page says so where the card would be, in the server's words
 *     (BuiltInTeam), and offers no Add;
 *   - the Teams list shows each team's owners and finds the teams someone
 *     owns with the Owner chip, from the same two tables;
 *   - its Bulk Actions add and remove owners of many teams at once (#6592):
 *     Owners and Admin in the selection are sent nothing, not even a read,
 *     and the result lists them as left alone, saying why.
 */

let allPermissionsForTest: Array<string> = [];
let projectPermissionsForTest: unknown = null;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return allPermissionsForTest;
      },
      getProjectPermissions: (): unknown => {
        return projectPermissionsForTest;
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
        return false;
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

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();
const ownersCardMock: MockFunction = getJestMockFunction();

// The arrow wrappers are load bearing: jest.mock is hoisted above the consts.
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
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      count: async (): Promise<number> => {
        return 0;
      },
      create: (...args: Array<any>) => {
        return createMock(...args);
      },
      deleteItem: (...args: Array<any>) => {
        return deleteItemMock(...args);
      },
      updateById: async (): Promise<void> => {
        return undefined;
      },
    },
  };
});

// The team custom field definitions: this project has none.
jest.mock("../../../UI/Utils/ModelListCache", () => {
  return {
    __esModule: true,
    default: {
      getList: async (): Promise<any> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
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
            return "0e000000-0000-4000-8000-000000000001";
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

// The Owners card every resource with owners shows, held to its own suite.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Owners/OwnersCard",
  () => {
    return {
      __esModule: true,
      default: (props: unknown) => {
        ownersCardMock(props);
        return <div data-testid="owners-card" />;
      },
    };
  },
);

// The team's name and description, read by the card's own suites.
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="team-details" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/OverviewCustomFields",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="team-custom-fields" />;
      },
    };
  },
);

import {
  BUILT_IN_TEAM_OWNERS_REASON,
  getTeamOwnersDisabledReason,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Team/BuiltInTeamOwners";
import TeamsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/Index";
import TeamViewPage, {
  TEAM_OWNERS_DESCRIPTION,
  TEAM_OWNERS_EMPTY_DESCRIPTION,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamOwnerTeam from "../../../Models/DatabaseModels/TeamOwnerTeam";
import TeamOwnerUser from "../../../Models/DatabaseModels/TeamOwnerUser";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { BUILT_IN_TEAM_OWNERS_MESSAGE } from "../../../Types/Team/BuiltInTeam";
import { getPeopleInitials } from "../../../UI/Components/PeoplePicker/PeopleAvatar";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

jest.setTimeout(30000);

const PROJECT_ID: string = "0e000000-0000-4000-8000-000000000001";

const OWNERS_ID: string = "0e000000-0000-4000-8000-0000000000b1";
const ENGINEERING_ID: string = "0e000000-0000-4000-8000-0000000000b2";
const PLATFORM_ID: string = "0e000000-0000-4000-8000-0000000000b3";
const ADA_ID: string = "0e000000-0000-4000-8000-0000000000c1";
const GRACE_ID: string = "0e000000-0000-4000-8000-0000000000c2";
const ADA_OWNS_ENGINEERING_ROW_ID: string =
  "0e000000-0000-4000-8000-0000000000d1";

const listProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.TEAMS] as Route,
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

const viewProps: PageComponentProps = {
  pageRoute: RouteMap[PageMap.TEAM_VIEW] as Route,
  hasPaymentMethod: true,
  currentProject: null,
} as unknown as PageComponentProps;

function holding(permissions: Array<Permission>): void {
  allPermissionsForTest = permissions;
  projectPermissionsForTest = {
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  };
}

function team(id: string, name: string, isTeamEditable: boolean): Team {
  const row: Team = new Team();
  row._id = id;
  row.name = name;
  row.isTeamEditable = isTeamEditable;
  row.isTeamDeleteable = isTeamEditable;
  return row;
}

const TEAMS: Array<Team> = [
  team(OWNERS_ID, "Owners", false),
  team(ENGINEERING_ID, "Engineering", true),
  team(PLATFORM_ID, "Platform", true),
];

// Engineering is looked after by Ada and by the Platform team.
function ownerUserRows(): Array<TeamOwnerUser> {
  const row: TeamOwnerUser = new TeamOwnerUser();
  row._id = ADA_OWNS_ENGINEERING_ROW_ID;
  row.ownedTeamId = new ObjectID(ENGINEERING_ID);
  row.userId = new ObjectID(ADA_ID);
  const ada: User = new User();
  ada._id = ADA_ID;
  ada.name = new Name("Ada Lovelace");
  row.user = ada;
  return [row];
}

function ownerTeamRows(): Array<TeamOwnerTeam> {
  const row: TeamOwnerTeam = new TeamOwnerTeam();
  row._id = "0e000000-0000-4000-8000-0000000000d2";
  row.ownedTeamId = new ObjectID(ENGINEERING_ID);
  row.team = team(PLATFORM_ID, "Platform", true);
  return [row];
}

// The project's people, as the Owners field's search lists them.
function member(userId: string, name: string): TeamMember {
  const user: User = new User();
  user._id = userId;
  user.name = new Name(name);
  const row: TeamMember = new TeamMember();
  row.user = user;
  return row;
}

const MEMBERS: Array<TeamMember> = [
  member(ADA_ID, "Ada Lovelace"),
  member(GRACE_ID, "Grace Hopper"),
];

/*
 * The owner rows a read names, as the server answers it: each Includes in
 * the query (the owned teams, the people or teams picked) narrows them.
 */
function matching(
  rows: Array<TeamOwnerUser | TeamOwnerTeam>,
  query: Record<string, unknown> | undefined,
): Array<TeamOwnerUser | TeamOwnerTeam> {
  return rows.filter((row: TeamOwnerUser | TeamOwnerTeam): boolean => {
    return Object.entries(query || {}).every(
      ([column, value]: [string, unknown]): boolean => {
        if (!(value instanceof Includes)) {
          return true;
        }

        return value.values
          .map((id: unknown): string => {
            return String(id);
          })
          .includes(
            String((row as unknown as Record<string, unknown>)[column]),
          );
      },
    );
  });
}

type ModelTypeOf = { new (): unknown };

function callsFor(modelType: ModelTypeOf): Array<Record<string, any>> {
  return getListMock.mock.calls
    .map((args: Array<any>): Record<string, any> => {
      return args[0] as Record<string, any>;
    })
    .filter((args: Record<string, any>): boolean => {
      return args["modelType"] === modelType;
    });
}

// The last of a list - indexed, as this project targets es2017 (no .at).
function lastOf<T>(items: Array<T>): T {
  return items[items.length - 1]!;
}

// The page's own card for a team that takes no owners.
function builtInOwnersCard(): HTMLElement | null {
  return document.getElementById("team-owners-built-in");
}

beforeEach(() => {
  holding([Permission.ProjectOwner]);
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();

  getListMock.mockImplementation(async (args: any): Promise<any> => {
    const modelType: ModelTypeOf = args.modelType;
    const data: Array<unknown> =
      modelType === TeamOwnerUser
        ? matching(ownerUserRows(), args.query)
        : modelType === TeamOwnerTeam
          ? matching(ownerTeamRows(), args.query)
          : modelType === Team
            ? TEAMS
            : modelType === TeamMember
              ? MEMBERS
              : [];
    return { data: data, count: data.length, skip: 0, limit: 10 };
  });
  createMock.mockImplementation(async (): Promise<unknown> => {
    return {};
  });
  deleteItemMock.mockImplementation(async (): Promise<void> => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  createMock.mockReset();
  deleteItemMock.mockReset();
  ownersCardMock.mockReset();
});

describe("a team's page", () => {
  function openTeam(teamId: string): void {
    window.history.replaceState(
      window.history.state,
      "",
      `/dashboard/${PROJECT_ID}/settings/teams/${teamId}`,
    );
    render(<TeamViewPage {...viewProps} />);
  }

  test("lists the team's owners in the Owners card, over the two owner tables by ownedTeamId, saying what owners do", async () => {
    getItemMock.mockImplementation(async (): Promise<Team> => {
      return team(ENGINEERING_ID, "Engineering", true);
    });

    openTeam(ENGINEERING_ID);

    await screen.findByTestId("owners-card");

    const props: Record<string, any> = lastOf(
      ownersCardMock.mock.calls as Array<Array<unknown>>,
    )[0] as Record<string, any>;

    expect(props["resourceId"].toString()).toBe(ENGINEERING_ID);
    expect(props["resourceIdField"]).toBe("ownedTeamId");
    expect(props["resourceDisplayName"]).toBe("team");
    expect(props["ownerUserModelType"]).toBe(TeamOwnerUser);
    expect(props["ownerTeamModelType"]).toBe(TeamOwnerTeam);
    expect(props["description"]).toBe(TEAM_OWNERS_DESCRIPTION);
    expect(props["emptyDescription"]).toBe(TEAM_OWNERS_EMPTY_DESCRIPTION);
    expect(builtInOwnersCard()).toBeNull();

    // Whether the team may have owners is all the page reads of it.
    expect(getItemMock).toHaveBeenCalledTimes(1);
    const read: Record<string, any> = getItemMock.mock.calls[0]![0] as Record<
      string,
      any
    >;
    expect(read["modelType"]).toBe(Team);
    expect(read["id"].toString()).toBe(ENGINEERING_ID);
    expect(read["select"]).toEqual({ isTeamEditable: true });
  });

  test("Owners and Admin say they take no owners, in the server's words, and offer no Add", async () => {
    getItemMock.mockImplementation(async (): Promise<Team> => {
      return team(OWNERS_ID, "Owners", false);
    });

    openTeam(OWNERS_ID);

    await waitFor(() => {
      expect(builtInOwnersCard()).not.toBeNull();
    });

    const card: HTMLElement = builtInOwnersCard()!;
    expect(card).toHaveTextContent("Owners");
    expect(card).toHaveTextContent(BUILT_IN_TEAM_OWNERS_MESSAGE);
    expect(card.querySelector("button")).toBeNull();
    expect(screen.queryByTestId("owners-card")).toBeNull();
    expect(ownersCardMock).not.toHaveBeenCalled();
  });

  test("draws neither card until it knows which one the team has", async () => {
    let answer: (team: Team) => void = () => {};
    getItemMock.mockImplementation((): Promise<Team> => {
      return new Promise((resolve: (team: Team) => void) => {
        answer = resolve;
      });
    });

    openTeam(OWNERS_ID);

    await screen.findByTestId("team-details");
    expect(screen.queryByTestId("owners-card")).toBeNull();
    expect(builtInOwnersCard()).toBeNull();

    answer(team(OWNERS_ID, "Owners", false));

    await waitFor(() => {
      expect(builtInOwnersCard()).not.toBeNull();
    });
    expect(screen.queryByTestId("owners-card")).toBeNull();
  });

  test("a team it cannot read shows the Owners card, which answers for itself", async () => {
    getItemMock.mockImplementation(async (): Promise<Team> => {
      throw new Error("The network is down.");
    });

    openTeam(ENGINEERING_ID);

    await screen.findByTestId("owners-card");
    expect(builtInOwnersCard()).toBeNull();
  });

  test("the reason is the server's refusal, word for word", () => {
    expect(BUILT_IN_TEAM_OWNERS_REASON).toBe(BUILT_IN_TEAM_OWNERS_MESSAGE);
  });
});

describe("the Teams list", () => {
  beforeEach(() => {
    window.history.replaceState(
      window.history.state,
      "",
      `/dashboard/${PROJECT_ID}/settings/teams`,
    );
  });

  async function rowOf(name: string): Promise<HTMLElement> {
    const cell: HTMLElement = await screen.findByText(
      name,
      { selector: "td *, td" },
      { timeout: 10000 },
    );
    return cell.closest("tr")!;
  }

  test("reads the owners of the teams it shows from the two owner tables, by ownedTeamId", async () => {
    render(<TeamsPage {...listProps} />);

    await waitFor(() => {
      expect(callsFor(TeamOwnerUser).length).toBeGreaterThan(0);
      expect(callsFor(TeamOwnerTeam).length).toBeGreaterThan(0);
    });

    for (const modelType of [TeamOwnerUser, TeamOwnerTeam]) {
      const query: Record<string, any> = lastOf(callsFor(modelType))["query"];
      expect(query["ownedTeamId"]).toBeInstanceOf(Includes);
      expect(
        [...(query["ownedTeamId"] as Includes).values]
          .map((id: unknown): string => {
            return String(id);
          })
          .sort(),
      ).toEqual([ENGINEERING_ID, OWNERS_ID, PLATFORM_ID].sort());
    }

    expect(lastOf(callsFor(TeamOwnerUser))["select"]["user"]).toEqual({
      _id: true,
      name: true,
      email: true,
      profilePictureId: true,
    });
    expect(lastOf(callsFor(TeamOwnerTeam))["select"]["team"]).toEqual({
      _id: true,
      name: true,
    });
  });

  test("shows each team's owners in an Owners column, and a quiet dash for a team with none", async () => {
    render(<TeamsPage {...listProps} />);

    const engineering: HTMLElement = await rowOf("Engineering");

    // Ada and the Platform team, by their initials.
    expect(getPeopleInitials("Ada Lovelace")).toBe("AL");
    await waitFor(() => {
      expect(engineering).toHaveTextContent(getPeopleInitials("Ada Lovelace"));
    });
    expect(engineering).toHaveTextContent(getPeopleInitials("Platform"));
    expect(engineering).not.toHaveTextContent("No owners.");
    expect(
      screen.getAllByRole("columnheader").some((header: HTMLElement) => {
        return (header.textContent || "").trim() === "Owners";
      }),
    ).toBe(true);

    const platform: HTMLElement = await rowOf("Platform");
    await waitFor(() => {
      expect(platform).toHaveTextContent("No owners.");
    });
  });

  test("finds the teams someone owns with the Owner chip", async () => {
    render(<TeamsPage {...listProps} />);

    await rowOf("Engineering");

    expect(
      screen.getAllByRole("button").some((button: HTMLElement) => {
        return (button.textContent || "").trim().startsWith("Owner");
      }),
    ).toBe(true);
  });
});

describe("the Teams list's Add Owner and Remove Owner (#6592)", () => {
  beforeEach(() => {
    window.history.replaceState(
      window.history.state,
      "",
      `/dashboard/${PROJECT_ID}/settings/teams`,
    );
  });

  async function rowOf(name: string): Promise<HTMLElement> {
    const cell: HTMLElement = await screen.findByText(
      name,
      { selector: "td *, td" },
      { timeout: 10000 },
    );
    return cell.closest("tr")!;
  }

  async function selectRows(names: Array<string>): Promise<void> {
    for (const name of names) {
      const row: HTMLElement = await rowOf(name);
      fireEvent.click(row.querySelector('input[type="checkbox"]')!);
    }
  }

  function menuItemNamed(label: string): HTMLElement | undefined {
    return Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item: HTMLElement): boolean => {
      return (item.textContent || "").trim() === label;
    });
  }

  async function openBulkActions(): Promise<void> {
    fireEvent.click(await screen.findByText("Bulk Actions"));

    await waitFor(() => {
      expect(menuItemNamed("Add Owner")).toBeDefined();
    });
  }

  /*
   * Bulk Actions, then the action, one person picked in its Owners field,
   * and submit - then the run's result, once it lists what it left alone.
   */
  async function runOwnerAction(
    action: "Add Owner" | "Remove Owner",
    person: string,
  ): Promise<void> {
    await openBulkActions();
    fireEvent.click(menuItemNamed(action)!);

    fireEvent.click(
      await screen.findByRole(
        "button",
        { name: "Add owner" },
        { timeout: 10000 },
      ),
    );

    const list: HTMLElement = await screen.findByTestId(
      "people-search-popup",
      {},
      { timeout: 10000 },
    );

    const option: HTMLElement = await waitFor(
      (): HTMLElement => {
        const found: HTMLElement | undefined = within(list)
          .getAllByRole("option")
          .find((candidate: HTMLElement): boolean => {
            return (
              candidate.querySelector(".text-sm.font-medium")?.textContent ===
              person
            );
          });
        expect(found).toBeDefined();
        return found!;
      },
      { timeout: 10000 },
    );

    fireEvent.click(option);
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await screen.findByTestId(
      "bulk-action-unchanged-items",
      {},
      { timeout: 10000 },
    );
  }

  // The owner rows the run read: the list's own reads name no person.
  function bulkOwnerReads(): Array<Record<string, any>> {
    return callsFor(TeamOwnerUser).filter(
      (args: Record<string, any>): boolean => {
        return Boolean(args["query"]?.["userId"]);
      },
    );
  }

  function teamsIn(read: Record<string, any>): Array<string> {
    return [...(read["query"]["ownedTeamId"] as Includes).values].map(
      (id: unknown): string => {
        return String(id);
      },
    );
  }

  test("are in Bulk Actions, beside Delete", async () => {
    render(<TeamsPage {...listProps} />);

    await selectRows(["Engineering"]);
    await openBulkActions();

    expect(menuItemNamed("Remove Owner")).toBeDefined();
    expect(menuItemNamed("Delete")).toBeDefined();
  });

  test("reads whether each team takes owners with the list", async () => {
    render(<TeamsPage {...listProps} />);

    await rowOf("Engineering");

    expect(
      callsFor(Team).some((args: Record<string, any>): boolean => {
        return (
          args["select"]?.["isTeamEditable"] === true &&
          args["select"]?.["isTeamDeleteable"] === true
        );
      }),
    ).toBe(true);
  });

  test("Add Owner makes the person an owner of each selected team, and leaves Owners alone, saying why", async () => {
    render(<TeamsPage {...listProps} />);

    await selectRows(["Owners", "Engineering"]);
    await runOwnerAction("Add Owner", "Grace Hopper");

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const created: Record<string, any> = createMock.mock.calls[0]![0] as Record<
      string,
      any
    >;
    expect(created["modelType"]).toBe(TeamOwnerUser);
    expect(String(created["model"]["ownedTeamId"])).toBe(ENGINEERING_ID);
    expect(String(created["model"]["userId"])).toBe(GRACE_ID);
    expect(String(created["model"]["projectId"])).toBe(PROJECT_ID);

    // Owners was not even read.
    expect(bulkOwnerReads().map(teamsIn)).toEqual([[ENGINEERING_ID]]);

    const leftAlone: HTMLElement = screen.getByTestId(
      "bulk-action-unchanged-items",
    );
    expect(leftAlone).toHaveTextContent("Owners");
    expect(leftAlone).toHaveTextContent(BUILT_IN_TEAM_OWNERS_MESSAGE);
    expect(leftAlone).not.toHaveTextContent("Engineering");
    expect(screen.getByTestId("bulk-action-unchanged-count")).toHaveTextContent(
      "1",
    );
    expect(
      document.querySelector('[data-testid="bulk-action-failed-count"]'),
    ).toBeNull();
  });

  test("Add Owner skips a team the person owns already", async () => {
    render(<TeamsPage {...listProps} />);

    await selectRows(["Owners", "Engineering", "Platform"]);
    await runOwnerAction("Add Owner", "Ada Lovelace");

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    // Ada looks after Engineering already: only Platform gains her.
    expect(
      String(
        (createMock.mock.calls[0]![0] as Record<string, any>)["model"][
          "ownedTeamId"
        ],
      ),
    ).toBe(PLATFORM_ID);
    expect(bulkOwnerReads().map(teamsIn)).toEqual([
      [ENGINEERING_ID, PLATFORM_ID],
    ]);
  });

  test("Remove Owner removes the person from each selected team, and leaves Owners alone, saying why", async () => {
    render(<TeamsPage {...listProps} />);

    await selectRows(["Owners", "Engineering"]);
    await runOwnerAction("Remove Owner", "Ada Lovelace");

    await waitFor(() => {
      expect(deleteItemMock).toHaveBeenCalledTimes(1);
    });

    const deleted: Record<string, any> = deleteItemMock.mock
      .calls[0]![0] as Record<string, any>;
    expect(deleted["modelType"]).toBe(TeamOwnerUser);
    expect(String(deleted["id"])).toBe(ADA_OWNS_ENGINEERING_ROW_ID);
    expect(createMock).not.toHaveBeenCalled();

    expect(bulkOwnerReads().map(teamsIn)).toEqual([[ENGINEERING_ID]]);

    const leftAlone: HTMLElement = screen.getByTestId(
      "bulk-action-unchanged-items",
    );
    expect(leftAlone).toHaveTextContent("Owners");
    expect(leftAlone).toHaveTextContent(BUILT_IN_TEAM_OWNERS_MESSAGE);
  });

  test("a selection of only Owners sends nothing at all", async () => {
    render(<TeamsPage {...listProps} />);

    await selectRows(["Owners"]);
    await runOwnerAction("Add Owner", "Grace Hopper");

    expect(createMock).not.toHaveBeenCalled();
    expect(deleteItemMock).not.toHaveBeenCalled();
    expect(bulkOwnerReads()).toEqual([]);
    expect(screen.getByTestId("bulk-action-unchanged-items")).toHaveTextContent(
      BUILT_IN_TEAM_OWNERS_MESSAGE,
    );
  });
});

describe("which teams take owners", () => {
  test("every team but the two that come with every project", () => {
    expect(getTeamOwnersDisabledReason(team(OWNERS_ID, "Owners", false))).toBe(
      BUILT_IN_TEAM_OWNERS_REASON,
    );
    expect(
      getTeamOwnersDisabledReason(team(ENGINEERING_ID, "Engineering", true)),
    ).toBeUndefined();
  });

  test("a team whose kind was not read takes owners: the server refuses what it must", () => {
    expect(getTeamOwnersDisabledReason(new Team())).toBeUndefined();
  });
});
