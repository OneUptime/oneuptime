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

import OwnersCard, {
  OWNERS_ADD_BUTTON_CLASS_NAME,
  OWNERS_ADD_BUTTON_IDLE_CLASS_NAME,
  OWNERS_ADD_BUTTON_OPEN_CLASS_NAME,
  OWNERS_ADD_CIRCLE_CLASS_NAME,
  OWNERS_ADD_CIRCLE_IDLE_CLASS_NAME,
  OWNERS_ADD_CIRCLE_OPEN_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Owners/OwnersCard";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import HeldPermissionsUtil, {
  HeldPermissions,
} from "../../../Types/HeldPermissions";
import PermissionUtil from "../../../UI/Utils/Permission";
import { PrivateRecordScopeContext } from "../../../UI/Utils/PrivateRecordScope";

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

// Every class in `classNames` is on the element.
function expectClasses(element: HTMLElement, classNames: Array<string>): void {
  for (const className of classNames) {
    expect(element).toHaveClass(className);
  }
}

// None of the classes of `classNames` (one class string) is on the element.
function expectNoneOf(element: HTMLElement, classNames: string): void {
  for (const className of classNames.split(" ")) {
    expect(element).not.toHaveClass(className);
  }
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

    // The "+" after the avatars: still there, locked, saying why.
    const locked: HTMLElement = await screen.findByTestId("owners-add-locked");

    // And no owner offers to be removed: a refusal is not a shortcut.
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
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
    ).toHaveTextContent("You do not have permission to add teams as owners.");
  });

  /*
   * An owner's remove button is a shortcut on the avatar: offered for each
   * kind of owner only to a reader who may remove that kind, so it never
   * leads to a refusal they could have been spared.
   */
  test("a reader who may remove people but not teams is offered Remove on the people only", async () => {
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([
        Permission.IncidentViewer,
        Permission.DeleteIncidentOwnerUser,
      ]);
    jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(null);

    renderCard();

    expect(
      await screen.findByRole("button", { name: "Remove Ada Lovelace" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove Platform" }),
    ).toBeNull();
  });

  /*
   * A PRIVATE INCIDENT'S OWNERS PAGE (block 33): the incident is changed
   * only with the permissions of the teams that own it, and its owners are
   * a part of it. The page hands the card what the reader holds on it
   * (PrivateRecordScope). A member whose owning team may only view it -
   * while another team of theirs may change every incident - reads its
   * owners, finds Add owner locked saying why, and is offered no Remove.
   */
  describe("on a private incident's Owners page", () => {
    const PRIVATE_REASON: string =
      "This incident is private, so it is changed only with the permissions of the teams that own it, and Checkout SRE, your team that owns it, may not do this.";

    function heldOf(permissions: Array<Permission>): HeldPermissions {
      return HeldPermissionsUtil.fromRows({
        rows: permissions.map((permission: Permission): UserPermission => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        }),
        globalPermissions: [],
      });
    }

    function renderOnPrivateIncident(held: HeldPermissions): void {
      render(
        <PrivateRecordScopeContext.Provider
          value={{ tableName: "Incident", held: held, reason: PRIVATE_REASON }}
        >
          <OwnersCard<IncidentOwnerUser, IncidentOwnerTeam>
            resourceId={new ObjectID(INCIDENT_ID)}
            resourceIdField="incidentId"
            resourceDisplayName="incident"
            ownerUserModelType={IncidentOwnerUser}
            ownerTeamModelType={IncidentOwnerTeam}
          />
        </PrivateRecordScopeContext.Provider>,
      );
    }

    beforeEach(() => {
      // Their whole snapshot may change every incident, through another team.
      jest
        .spyOn(PermissionUtil, "getAllPermissions")
        .mockReturnValue([Permission.ProjectMember]);
      jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(null);
    });

    test("a view-only owning team: the owners are read, Add owner is locked saying why, and nobody offers to be removed", async () => {
      renderOnPrivateIncident(heldOf([Permission.Viewer]));

      const locked: HTMLElement =
        await screen.findByTestId("owners-add-locked");

      expect(screen.getByText(/1 person · 1 team/)).toBeInTheDocument();
      expect(
        within(locked).getByRole("button", { name: "Add owner" }),
      ).toBeDisabled();
      expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();

      // The lock says why: the incident's rule, not a permission they hold.
      fireEvent.mouseEnter(locked);
      const tooltips: Array<HTMLElement> = screen.getAllByRole("tooltip");
      expect(tooltips[tooltips.length - 1]).toHaveTextContent(
        `You do not have permission to add owners. ${PRIVATE_REASON}`,
      );
    });

    test("an owning team that may change incidents: Add owner and every Remove are offered", async () => {
      renderOnPrivateIncident(heldOf([Permission.IncidentMember]));

      expect(
        await screen.findByRole("button", { name: "Remove Ada Lovelace" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Remove Platform" }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("owners-add-locked")).toBeNull();
      expect(screen.getByTestId("owners-add-circle")).toBeEnabled();
    });
  });

  /*
   * The two controls that open the Add owners list each have an open state
   * of their own (#5262's follow-up): while the list is open, the control
   * that opened it stays as the pointer draws it, so it is clear which
   * control the list belongs to - as a header's place button and the
   * word-and-plus Add owners stay lit. One colour set or the other, never
   * both: the Dashboard's Tailwind would let whichever rule it wrote last
   * win.
   */
  test("the + after the avatars stays filled while its list is open, and goes back when it closes", async () => {
    renderCard();

    const plus: HTMLElement = await screen.findByTestId("owners-add-circle");

    expect(plus).toHaveAccessibleName("Add owner");
    expect(plus).toHaveAttribute("aria-haspopup", "dialog");
    expect(plus).toHaveAttribute("aria-expanded", "false");
    expectClasses(plus, [
      ...OWNERS_ADD_CIRCLE_CLASS_NAME.split(" "),
      ...OWNERS_ADD_CIRCLE_IDLE_CLASS_NAME.split(" "),
    ]);
    expectNoneOf(plus, OWNERS_ADD_CIRCLE_OPEN_CLASS_NAME);

    fireEvent.click(plus);

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Add owner",
    });

    expect(plus).toHaveAttribute("aria-expanded", "true");
    expect(plus).toHaveAttribute("aria-controls", dialog.id);
    expectClasses(plus, [
      ...OWNERS_ADD_CIRCLE_CLASS_NAME.split(" "),
      ...OWNERS_ADD_CIRCLE_OPEN_CLASS_NAME.split(" "),
    ]);
    expectNoneOf(plus, OWNERS_ADD_CIRCLE_IDLE_CLASS_NAME);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add owner" })).toBeNull();
    });
    expect(plus).toHaveFocus();
    expect(plus).toHaveAttribute("aria-expanded", "false");
    expectClasses(plus, OWNERS_ADD_CIRCLE_IDLE_CLASS_NAME.split(" "));
    expectNoneOf(plus, OWNERS_ADD_CIRCLE_OPEN_CLASS_NAME);
  });

  test("the + stays filled while owners are added from its list, one after another", async () => {
    renderCard();

    const plus: HTMLElement = await screen.findByTestId("owners-add-circle");

    fireEvent.click(plus);

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Add owner",
    });

    await within(dialog).findAllByRole("option");

    ownerTeamRows = [
      ...ownerTeamRows,
      ownerTeamRow("33333333-3333-4333-8333-333333333334", TEAMS[0]!),
    ];

    fireEvent.click(
      within(dialog)
        .getAllByRole("option")
        .find((option: HTMLElement): boolean => {
          return option.getAttribute("data-id") === DATABASE;
        })!,
    );

    // The new team's avatar is drawn in front of it, and the + is still lit.
    expect(
      await screen.findByRole("button", { name: "Remove Database" }),
    ).toBeInTheDocument();

    const plusAfter: HTMLElement = screen.getByTestId("owners-add-circle");

    expect(screen.getByRole("dialog", { name: "Add owner" })).toBeVisible();
    expect(plusAfter).toHaveAttribute("aria-expanded", "true");
    expectClasses(plusAfter, OWNERS_ADD_CIRCLE_OPEN_CLASS_NAME.split(" "));
    expectNoneOf(plusAfter, OWNERS_ADD_CIRCLE_IDLE_CLASS_NAME);
  });

  test("with nobody owning it, Add owner keeps its pressed fill while its list is open", async () => {
    ownerUserRows = [];
    ownerTeamRows = [];

    renderCard();

    expect(await screen.findByText("No owners yet")).toBeInTheDocument();

    const add: HTMLElement = screen.getByTestId("owners-add");

    expect(add).toHaveAccessibleName("Add owner");
    expect(add).toHaveAttribute("aria-haspopup", "dialog");
    expect(add).toHaveAttribute("aria-expanded", "false");
    expectClasses(add, [
      ...OWNERS_ADD_BUTTON_CLASS_NAME.split(" "),
      ...OWNERS_ADD_BUTTON_IDLE_CLASS_NAME.split(" "),
    ]);
    expectNoneOf(add, OWNERS_ADD_BUTTON_OPEN_CLASS_NAME);

    fireEvent.click(add);

    const dialog: HTMLElement = await screen.findByRole("dialog", {
      name: "Add owner",
    });

    expect(add).toHaveAttribute("aria-expanded", "true");
    expect(add).toHaveAttribute("aria-controls", dialog.id);
    expectClasses(add, [
      ...OWNERS_ADD_BUTTON_CLASS_NAME.split(" "),
      ...OWNERS_ADD_BUTTON_OPEN_CLASS_NAME.split(" "),
    ]);
    expectNoneOf(add, OWNERS_ADD_BUTTON_IDLE_CLASS_NAME);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Add owner" })).toBeNull();
    });
    expect(add).toHaveFocus();
    expectClasses(add, OWNERS_ADD_BUTTON_IDLE_CLASS_NAME.split(" "));
    expectNoneOf(add, OWNERS_ADD_BUTTON_OPEN_CLASS_NAME);
  });

  test("the open look is what the pointer draws: the + filled indigo with a white plus, Add owner its hover fill", () => {
    // The + under the pointer turns indigo-600 with a white plus ...
    const circleHover: Array<string> = OWNERS_ADD_CIRCLE_IDLE_CLASS_NAME.split(
      " ",
    )
      .filter((className: string): boolean => {
        return className.startsWith("hover:");
      })
      .map((className: string): string => {
        return className.slice("hover:".length);
      });

    // ... and open, it stays so (its lift and scale are for the pointer only).
    for (const className of [
      "border-indigo-500",
      "bg-indigo-600",
      "text-white",
      "shadow-md",
    ]) {
      expect(circleHover).toContain(className);
      expect(OWNERS_ADD_CIRCLE_OPEN_CLASS_NAME.split(" ")).toContain(className);
    }

    expect(OWNERS_ADD_BUTTON_IDLE_CLASS_NAME.split(" ")).toContain(
      "hover:bg-indigo-700",
    );
    expect(OWNERS_ADD_BUTTON_OPEN_CLASS_NAME.split(" ")).toEqual([
      "bg-indigo-700",
    ]);

    // The sets never share a class, so neither can undo the other.
    for (const [idle, open] of [
      [OWNERS_ADD_CIRCLE_IDLE_CLASS_NAME, OWNERS_ADD_CIRCLE_OPEN_CLASS_NAME],
      [OWNERS_ADD_BUTTON_IDLE_CLASS_NAME, OWNERS_ADD_BUTTON_OPEN_CLASS_NAME],
    ] as Array<[string, string]>) {
      const idleClasses: Array<string> = idle.split(" ");

      for (const className of open.split(" ")) {
        expect(idleClasses).not.toContain(className);
      }
    }
  });

  /*
   * With no word beside it, the + is the control's only mark: grey-500
   * (4.8:1 on white), not the grey-400 of a decoration (2.5:1), which is
   * under the 3:1 a control's mark needs - as the header's place button.
   */
  test("the + is grey-500 while idle, not the fainter grey of a decoration", async () => {
    renderCard();

    const plus: HTMLElement = await screen.findByTestId("owners-add-circle");

    expect(plus).toHaveClass("text-gray-500");
    expect(plus).not.toHaveClass("text-gray-400");
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
