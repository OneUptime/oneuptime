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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Owners page every resource has - the UI the maintainer pointed at:
 * "If I click on the owners page inside of the incident, I'm able to add
 * owners just by clicking on things, and it is basically combined." Its
 * "Add owner" list is now the people picker's own search list (Common's
 * PeopleSearchPopup), so it is driven here as a person would: what it shows,
 * what one click adds, what removing asks first, and what each sends. The
 * list is the shared Add owners list (AddOwnersPopup) that a record's
 * header, a monitor's, an SLO's and a postmortem open too - one set of
 * rules wherever an owner is added (AddOwnersPopup.test.tsx).
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      create: (...args: Array<any>) => {
        return createMock(...args);
      },
      deleteItem: (...args: Array<any>) => {
        return deleteItemMock(...args);
      },
    },
  };
});

import OwnersCard from "../../../../App/FeatureSet/Dashboard/src/Components/Owners/OwnersCard";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID: string = "22222222-2222-4222-8222-222222222221";
const ADA: string = "0000000e-0000-4000-8000-000000000001";
const BOB: string = "0000000e-0000-4000-8000-000000000002";
const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";
const DATABASE: string = "0000000b-0000-4000-8000-000000000002";
const ADA_ROW: string = "33333333-3333-4333-8333-333333333331";
const PLATFORM_ROW: string = "33333333-3333-4333-8333-333333333332";

function makeUser(id: string, name: string, email: string): User {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
}

function makeTeam(id: string, name: string): Team {
  const team: Team = new Team();
  team._id = id;
  team.name = name;
  return team;
}

const PEOPLE: Array<User> = [
  makeUser(ADA, "Ada Lovelace", "ada@example.com"),
  makeUser(BOB, "Bob Stone", "bob@example.com"),
];

const TEAMS: Array<Team> = [
  makeTeam(DATABASE, "Database"),
  makeTeam(PLATFORM, "Platform"),
];

// The incident's owners, as the junction rows the card lists.
let ownerUserRows: Array<IncidentOwnerUser> = [];
let ownerTeamRows: Array<IncidentOwnerTeam> = [];

function ownerUserRow(rowId: string, user: User): IncidentOwnerUser {
  const row: IncidentOwnerUser = new IncidentOwnerUser();
  row._id = rowId;
  row.user = user;
  return row;
}

function ownerTeamRow(rowId: string, team: Team): IncidentOwnerTeam {
  const row: IncidentOwnerTeam = new IncidentOwnerTeam();
  row._id = rowId;
  row.team = team;
  return row;
}

function list(rows: Array<unknown>): {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
} {
  return { data: rows, count: rows.length, skip: 0, limit: rows.length };
}

function serve(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    if (request.modelType === IncidentOwnerUser) {
      return list(ownerUserRows);
    }

    if (request.modelType === IncidentOwnerTeam) {
      return list(ownerTeamRows);
    }

    if (request.modelType === TeamMember) {
      return list(
        PEOPLE.map((user: User): TeamMember => {
          const member: TeamMember = new TeamMember();
          member.user = user;
          return member;
        }),
      );
    }

    if (request.modelType === Team) {
      return list(TEAMS);
    }

    return list([]);
  });
}

function renderCard(
  props: { description?: string; emptyDescription?: string } = {},
): void {
  render(
    <OwnersCard<IncidentOwnerUser, IncidentOwnerTeam>
      resourceId={new ObjectID(INCIDENT_ID)}
      resourceIdField="incidentId"
      resourceDisplayName="incident"
      ownerUserModelType={IncidentOwnerUser}
      ownerTeamModelType={IncidentOwnerTeam}
      description={props.description}
      emptyDescription={props.emptyDescription}
    />,
  );
}

async function openAddOwner(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: "Add owner" }));

  const dialog: HTMLElement = await screen.findByRole("dialog", {
    name: "Add owner",
  });

  await within(dialog).findAllByRole("option");

  return dialog;
}

function optionNames(dialog: HTMLElement): Array<string> {
  return within(dialog)
    .getAllByRole("option")
    .map((option: HTMLElement): string => {
      return option.getAttribute("data-id") || "";
    });
}

function createdModels(): Array<any> {
  return createMock.mock.calls.map((call: Array<any>) => {
    return call[0];
  });
}

describe("OwnersCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);
    ownerUserRows = [ownerUserRow(ADA_ROW, PEOPLE[0]!)];
    ownerTeamRows = [ownerTeamRow(PLATFORM_ROW, TEAMS[1]!)];
    serve();
    createMock.mockResolvedValue({});
    deleteItemMock.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    // The permission snapshot a test held, never the next test's.
    jest.restoreAllMocks();
  });

  test("shows the people and the teams who own it, in one row, counted", async () => {
    renderCard();

    expect(
      await screen.findByRole("button", { name: "Remove Ada Lovelace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Platform" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 person · 1 team/)).toBeInTheDocument();

    // Read for this incident in this project only.
    const ownerQueries: Array<any> = getListMock.mock.calls
      .map((call: Array<any>) => {
        return call[0];
      })
      .filter((request: any): boolean => {
        return (
          request.modelType === IncidentOwnerUser ||
          request.modelType === IncidentOwnerTeam
        );
      });

    expect(ownerQueries).toHaveLength(2);

    for (const request of ownerQueries) {
      expect(request.query.incidentId.toString()).toBe(INCIDENT_ID);
      expect(request.query.projectId.toString()).toBe(PROJECT_ID);
    }
  });

  test("Add owner lists the people and teams who are not owners yet, people first", async () => {
    renderCard();

    const dialog: HTMLElement = await openAddOwner();

    // Ada and Platform own it already.
    expect(optionNames(dialog)).toEqual([BOB, DATABASE]);
  });

  test("one click on a person makes them an owner of this incident", async () => {
    renderCard();

    const dialog: HTMLElement = await openAddOwner();

    ownerUserRows = [
      ...ownerUserRows,
      ownerUserRow("33333333-3333-4333-8333-333333333333", PEOPLE[1]!),
    ];

    fireEvent.click(
      within(dialog)
        .getAllByRole("option")
        .find((option: HTMLElement): boolean => {
          return option.getAttribute("data-id") === BOB;
        })!,
    );

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const request: any = createdModels()[0];

    expect(request.modelType).toBe(IncidentOwnerUser);
    expect(request.model.incidentId.toString()).toBe(INCIDENT_ID);
    expect(request.model.projectId.toString()).toBe(PROJECT_ID);
    expect(request.model.userId.toString()).toBe(BOB);

    // The card lists them, and the list stays open for the next one.
    expect(
      await screen.findByRole("button", { name: "Remove Bob Stone" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Add owner" }),
    ).toBeInTheDocument();
  });

  test("one click on a team makes it an owner", async () => {
    renderCard();

    const dialog: HTMLElement = await openAddOwner();

    fireEvent.click(
      within(dialog)
        .getAllByRole("option")
        .find((option: HTMLElement): boolean => {
          return option.getAttribute("data-id") === DATABASE;
        })!,
    );

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });

    const request: any = createdModels()[0];

    expect(request.modelType).toBe(IncidentOwnerTeam);
    expect(request.model.incidentId.toString()).toBe(INCIDENT_ID);
    expect(request.model.teamId.toString()).toBe(DATABASE);
  });

  test("says why an owner could not be added, in the list", async () => {
    createMock.mockRejectedValue(new Error("Bob is not in this project."));

    renderCard();

    const dialog: HTMLElement = await openAddOwner();

    fireEvent.click(
      within(dialog)
        .getAllByRole("option")
        .find((option: HTMLElement): boolean => {
          return option.getAttribute("data-id") === BOB;
        })!,
    );

    expect(
      await within(dialog).findByText("Bob is not in this project."),
    ).toBeInTheDocument();
  });

  test("removing an owner asks first, then deletes that owner's row", async () => {
    renderCard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Ada Lovelace" }),
    );

    const modal: HTMLElement = await screen.findByTestId("modal");

    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      "Remove owner",
    );
    expect(modal).toHaveTextContent(
      "Are you sure you want to remove Ada Lovelace as an owner of this incident?",
    );
    expect(deleteItemMock).not.toHaveBeenCalled();

    fireEvent.click(within(modal).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(deleteItemMock).toHaveBeenCalledTimes(1);
    });

    const request: any = deleteItemMock.mock.calls[0]![0];

    expect(request.modelType).toBe(IncidentOwnerUser);
    expect(request.id.toString()).toBe(ADA_ROW);
  });

  /*
   * A member whose permission to add and remove owners reaches only what
   * they or their team own may read the owners of a resource they do not
   * own: the server refuses the change, and the card says why, where it was
   * asked, keeping the owners as they are.
   */
  test("says why an owner could not be added to a resource the member does not own, and adds no one", async () => {
    createMock.mockRejectedValue(
      new Error(
        "Your access lets you add owners only to the Incidents you or your teams own.",
      ),
    );

    renderCard();

    const dialog: HTMLElement = await openAddOwner();

    fireEvent.click(
      within(dialog)
        .getAllByRole("option")
        .find((option: HTMLElement): boolean => {
          return option.getAttribute("data-id") === BOB;
        })!,
    );

    expect(
      await within(dialog).findByText(
        "Your access lets you add owners only to the Incidents you or your teams own.",
      ),
    ).toBeInTheDocument();

    // Bob is no owner, and the list stays open on its people and teams.
    expect(
      screen.queryByRole("button", { name: "Remove Bob Stone" }),
    ).not.toBeInTheDocument();
    expect(optionNames(dialog)).toEqual([BOB, DATABASE]);
  });

  test("says why an owner could not be removed, in the confirmation, and keeps the owner", async () => {
    deleteItemMock.mockRejectedValue(
      new Error(
        "You do not have permission to delete this incident user owner.",
      ),
    );

    renderCard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Ada Lovelace" }),
    );

    const modal: HTMLElement = await screen.findByTestId("modal");

    fireEvent.click(within(modal).getByRole("button", { name: "Remove" }));

    expect(
      await within(modal).findByText(
        "You do not have permission to delete this incident user owner.",
      ),
    ).toBeInTheDocument();

    // Still asked, and Ada still owns it.
    expect(screen.getByTestId("modal")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Ada Lovelace" }),
    ).toBeInTheDocument();
    expect(deleteItemMock).toHaveBeenCalledTimes(1);
  });

  test("removing a team says it is a team", async () => {
    renderCard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Platform" }),
    );

    expect(await screen.findByTestId("modal")).toHaveTextContent(
      "Platform (Team) as an owner of this incident?",
    );
  });

  test("with no owners, says so and offers Add owner", async () => {
    ownerUserRows = [];
    ownerTeamRows = [];

    renderCard();

    expect(await screen.findByText("No owners yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Add a teammate or a team so they get notified about changes to this incident.",
      ),
    ).toBeInTheDocument();

    const dialog: HTMLElement = await openAddOwner();

    expect(optionNames(dialog)).toEqual([ADA, BOB, DATABASE, PLATFORM]);
  });

  test("says under the list what a pick did, by name", async () => {
    renderCard();

    const dialog: HTMLElement = await openAddOwner();

    fireEvent.click(
      within(dialog)
        .getAllByRole("option")
        .find((option: HTMLElement): boolean => {
          return option.getAttribute("data-id") === DATABASE;
        })!,
    );

    const done: HTMLElement = await within(dialog).findByTestId(
      "people-search-notice-done",
    );

    expect(done).toHaveTextContent("Added Database.");
  });

  test("a reader who may add neither people nor teams finds Add owner locked, saying why", async () => {
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.IncidentViewer]);
    jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(null);

    renderCard();

    await screen.findByRole("button", { name: "Remove Ada Lovelace" });

    // The "+" after the avatars: still there, locked, saying why.
    const locked: HTMLElement = screen.getByTestId("owners-add-locked");
    const button: HTMLElement = within(locked).getByRole("button", {
      name: "Add owner",
    });

    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("aria-haspopup");
    expect(locked).toHaveAttribute("tabindex", "0");

    fireEvent.click(locked);
    expect(screen.queryByRole("dialog", { name: "Add owner" })).toBeNull();

    // With nobody owning it, the empty state's Add owner is locked the same way.
    cleanup();
    ownerUserRows = [];
    ownerTeamRows = [];
    renderCard();

    expect(await screen.findByText("No owners yet")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("owners-add-locked")).getByRole("button", {
        name: "Add owner",
      }),
    ).toBeDisabled();
  });

  test("a reader who may add people but not teams finds Teams locked in the list, with why", async () => {
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.CreateIncidentOwnerUser]);
    jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(null);

    renderCard();

    const dialog: HTMLElement = await openAddOwner();

    // Ada owns it: Bob is the person left; no team is offered.
    expect(optionNames(dialog)).toEqual([BOB]);
    expect(
      within(dialog).getByTestId("people-search-locked-kind"),
    ).toHaveTextContent(
      "You do not have permission to add teams as owners.",
    );
  });

  test("says what owning means where it is not 'notified about changes' - a template's owners", async () => {
    ownerUserRows = [];
    ownerTeamRows = [];

    renderCard({
      description:
        "People and teams who own every incident declared from this template.",
      emptyDescription:
        "Add a teammate or a team to own every incident declared from this template.",
    });

    expect(
      await screen.findByText(
        "Add a teammate or a team to own every incident declared from this template.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "People and teams who own every incident declared from this template.",
      ),
    ).toBeInTheDocument();
  });
});
