import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The end-to-end shape of the fix, through the real table rather than around
 * it: memberships in, one row per person out.
 *
 * The unit suites prove ProjectUsersModelAPI groups and pages correctly, and
 * the page suite proves the page hands the table that API. Neither proves the
 * two compose - that BaseModelTable renders what the override returns as rows,
 * pages over people, and keeps the injected per-row fields intact all the way
 * to the cell renderers. That composition is where the duplicate rows would
 * come back, so it is asserted here on the rendered DOM.
 */

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined) => {
          return value;
        },
        translateValue: (value: unknown) => {
          return value;
        },
      };
    },
  };
});

import ModelTable from "../../../../UI/Components/ModelTable/ModelTable";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUsersModelAPI from "../../../../UI/Utils/ModelAPI/ProjectUsersModelAPI";
import { ProjectUserRow } from "../../../../UI/Utils/TeamMembersByUser";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import Query from "../../../../Types/BaseDatabase/Query";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000001",
);

type MembershipSpec = {
  id: string;
  userId: string;
  userName: string;
  teamId: string;
  teamName: string;
};

const buildMembership: (spec: MembershipSpec) => TeamMember = (
  spec: MembershipSpec,
): TeamMember => {
  const teamMember: TeamMember = new TeamMember();

  teamMember._id = spec.id;
  teamMember.userId = new ObjectID(spec.userId);
  teamMember.projectId = PROJECT_ID;
  teamMember.hasAcceptedInvitation = true;

  const user: User = new User();
  user._id = spec.userId;
  user.name = new Name(spec.userName);
  teamMember.user = user;

  teamMember.teamId = new ObjectID(spec.teamId);

  const team: Team = new Team();
  team._id = spec.teamId;
  team.name = spec.teamName;
  teamMember.team = team;

  return teamMember;
};

/*
 * The list from the bug report: Thomas Stock and Jason Apel each on two teams,
 * so six membership rows for four people.
 */
const REPORTED_MEMBERSHIPS: Array<MembershipSpec> = [
  {
    id: "m1",
    userId: "thomas",
    userName: "Thomas Stock",
    teamId: "online",
    teamName: "NTW_Online Operations",
  },
  {
    id: "m2",
    userId: "thomas",
    userName: "Thomas Stock",
    teamId: "owners",
    teamName: "Owners",
  },
  {
    id: "m3",
    userId: "jason",
    userName: "Jason Apel",
    teamId: "owners",
    teamName: "Owners",
  },
  {
    id: "m4",
    userId: "colton",
    userName: "Colton Hawkins",
    teamId: "online",
    teamName: "NTW_Online Operations",
  },
  {
    id: "m5",
    userId: "karsten",
    userName: "Karsten Huster",
    teamId: "it",
    teamName: "NTW_IT Operations",
  },
  {
    id: "m6",
    userId: "jason",
    userName: "Jason Apel",
    teamId: "online",
    teamName: "NTW_Online Operations",
  },
];

type GetListCall = { limit: number; skip: number };

let getListCalls: Array<GetListCall> = [];

type RenderTableFunction = (memberships: Array<MembershipSpec>) => void;

const renderTable: RenderTableFunction = (
  memberships: Array<MembershipSpec>,
): void => {
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (data: unknown): Promise<never> => {
      const call: GetListCall = data as GetListCall;
      getListCalls.push({ limit: call.limit, skip: call.skip });

      return {
        data: memberships.map(buildMembership),
        count: memberships.length,
        skip: 0,
        limit: memberships.length,
      } as unknown as never;
    });

  render(
    <ModelTable<TeamMember>
      modelType={TeamMember}
      modelAPI={ProjectUsersModelAPI}
      id="users-table"
      userPreferencesKey="users-table-test"
      name="Settings > Users"
      singularName="User"
      pluralName="Users"
      isDeleteable={false}
      isEditable={false}
      isCreateable={false}
      isViewable={false}
      query={{ projectId: PROJECT_ID } as Query<TeamMember>}
      cardProps={{ title: "Users", description: "Everyone in this project." }}
      filters={[]}
      columns={[
        {
          field: { user: { name: true } },
          title: "User",
          type: FieldType.Element,
          getElement: (item: TeamMember): ReactElement => {
            return <span>{item.user?.name?.toString() || ""}</span>;
          },
        },
        {
          field: { team: { name: true, _id: true } },
          title: "Teams",
          type: FieldType.Element,
          getElement: (item: TeamMember): ReactElement => {
            return (
              <span>
                {((item as ProjectUserRow).teamsForUser || [])
                  .map((team: Team) => {
                    return team.name?.toString() || "";
                  })
                  .join(", ")}
              </span>
            );
          },
        },
      ]}
    />,
  );
};

type RowTextsFunction = () => Array<string>;

const rowTexts: RowTextsFunction = (): Array<string> => {
  return screen.getAllByRole("row").map((row: HTMLElement) => {
    return row.textContent || "";
  });
};

describe("ModelTable driven by ProjectUsersModelAPI", () => {
  beforeEach(() => {
    getListCalls = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The regression that started all this. If this fails, Thomas Stock is on
   * screen twice again.
   */
  test("renders one row per person, not one per membership", async () => {
    renderTable(REPORTED_MEMBERSHIPS);

    await waitFor(() => {
      expect(screen.getByText("Thomas Stock")).toBeInTheDocument();
    });

    expect(screen.getAllByText("Thomas Stock")).toHaveLength(1);
    expect(screen.getAllByText("Jason Apel")).toHaveLength(1);
    expect(screen.getAllByText("Colton Hawkins")).toHaveLength(1);
    expect(screen.getAllByText("Karsten Huster")).toHaveLength(1);
  });

  test("six memberships become four body rows", async () => {
    renderTable(REPORTED_MEMBERSHIPS);

    await waitFor(() => {
      expect(screen.getByText("Thomas Stock")).toBeInTheDocument();
    });

    // The header row plus one row per person - not one per membership.
    expect(rowTexts()).toHaveLength(5);
  });

  test("each person's row carries every team they belong to", async () => {
    renderTable(REPORTED_MEMBERSHIPS);

    await waitFor(() => {
      expect(screen.getByText("Thomas Stock")).toBeInTheDocument();
    });

    const thomasRow: string =
      rowTexts().find((text: string) => {
        return text.includes("Thomas Stock");
      }) || "";

    expect(thomasRow).toContain("NTW_Online Operations");
    expect(thomasRow).toContain("Owners");

    const coltonRow: string =
      rowTexts().find((text: string) => {
        return text.includes("Colton Hawkins");
      }) || "";

    expect(coltonRow).toContain("NTW_Online Operations");
    expect(coltonRow).not.toContain("Owners");
  });

  test("the rows are sorted by name, so paging is stable", async () => {
    renderTable(REPORTED_MEMBERSHIPS);

    await waitFor(() => {
      expect(screen.getByText("Thomas Stock")).toBeInTheDocument();
    });

    const names: Array<string> = [
      "Colton Hawkins",
      "Jason Apel",
      "Karsten Huster",
      "Thomas Stock",
    ];

    const rendered: Array<string> = rowTexts()
      .map((text: string) => {
        return (
          names.find((name: string) => {
            return text.includes(name);
          }) || ""
        );
      })
      .filter(Boolean);

    expect(rendered).toEqual(names);
  });

  test("the table reads the membership list itself rather than asking for a page of it", async () => {
    renderTable(REPORTED_MEMBERSHIPS);

    await waitFor(() => {
      expect(screen.getByText("Thomas Stock")).toBeInTheDocument();
    });

    /*
     * The table's own page size never reaches the server: the override has to
     * see every membership before it can know which people are on page 1.
     */
    expect(getListCalls[0]!.skip).toBe(0);
    expect(getListCalls[0]!.limit).toBeGreaterThan(REPORTED_MEMBERSHIPS.length);
  });

  test("a project where nobody is on two teams renders unchanged", async () => {
    renderTable([
      {
        id: "m1",
        userId: "a",
        userName: "Aaron Falzon",
        teamId: "t1",
        teamName: "Ops",
      },
      {
        id: "m2",
        userId: "b",
        userName: "Zoe Baker",
        teamId: "t1",
        teamName: "Ops",
      },
    ]);

    await waitFor(() => {
      expect(screen.getByText("Aaron Falzon")).toBeInTheDocument();
    });

    expect(screen.getAllByText("Aaron Falzon")).toHaveLength(1);
    expect(screen.getAllByText("Zoe Baker")).toHaveLength(1);
  });
});
