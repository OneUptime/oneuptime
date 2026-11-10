import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
 *     owns with the Owner chip, from the same two tables.
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
      deleteItem: async (): Promise<void> => {
        return undefined;
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

import TeamsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/Index";
import TeamViewPage, {
  BUILT_IN_TEAM_OWNERS_REASON,
  TEAM_OWNERS_DESCRIPTION,
  TEAM_OWNERS_EMPTY_DESCRIPTION,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Team from "../../../Models/DatabaseModels/Team";
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
  row._id = "0e000000-0000-4000-8000-0000000000d1";
  row.ownedTeamId = new ObjectID(ENGINEERING_ID);
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
        ? ownerUserRows()
        : modelType === TeamOwnerTeam
          ? ownerTeamRows()
          : modelType === Team
            ? TEAMS
            : [];
    return { data: data, count: data.length, skip: 0, limit: 10 };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
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

    const props: Record<string, any> = ownersCardMock.mock.calls.at(
      -1,
    )![0] as Record<string, any>;

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
      const query: Record<string, any> = callsFor(modelType).at(-1)!["query"];
      expect(query["ownedTeamId"]).toBeInstanceOf(Includes);
      expect(
        [...(query["ownedTeamId"] as Includes).values]
          .map((id: unknown): string => {
            return String(id);
          })
          .sort(),
      ).toEqual([ENGINEERING_ID, OWNERS_ID, PLATFORM_ID].sort());
    }

    expect(callsFor(TeamOwnerUser).at(-1)!["select"]["user"]).toEqual({
      _id: true,
      name: true,
      email: true,
      profilePictureId: true,
    });
    expect(callsFor(TeamOwnerTeam).at(-1)!["select"]["team"]).toEqual({
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
