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
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import { Mock } from "jest-mock";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The people row of an incident's, alert's or episode's header: who commands
 * the response and who owns it (the customer's "Easy to see Incident
 * Commander and Team(s)"). What each value says, what it offers while the
 * record is open, and what its Add and Assign do: both are done right there,
 * from a list under them - the maintainer: "If I click on add owners, I
 * should be able to add owners from this page directly instead of going to
 * owners page."
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
        title?: string;
        dataTestId?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          {
            href: props.to?.toString(),
            className: props.className,
            title: props.title,
            "data-testid": props.dataTestId,
          },
          props.children,
        );
      },
    };
  },
);

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();

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
    },
  };
});

import {
  CommanderFactValue,
  EVENT_EMPTY_PLACE_ACTION_OPEN_CLASS_NAME,
  EventAddOwners,
  OwnersFactValue,
  PersonFactValue,
  getCommanderFact,
  getOwnersFact,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventPeopleFacts";
import { EventStatusFact } from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import { OwnersChange } from "../../../../App/FeatureSet/Dashboard/src/Components/Owners/AddOwners";
import { ResourceOwnerEntry } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnerEntry";
import {
  EventRoleMember,
  PrimaryRoleHolding,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/EventPeople";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import Email from "../../../Types/Email";
import IconProp from "../../../Types/Icon/IconProp";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { PeoplePickerOption } from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const INCIDENT_ID: string = "20000000-0000-4000-8000-000000001042";

const OWNERS_ROUTE: Route = new Route(
  `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}/owners`,
);

const MAYA: EventRoleMember = {
  roleId: "76000000-0000-4000-8000-000000000001",
  userId: "80000000-0000-4000-8000-000000000001",
  name: "Maya Chen",
  email: "maya.chen@acme-commerce.example",
  hasProfilePicture: false,
};

// The project's people and teams, as the lists search them.
const JORDAN_ID: string = "80000000-0000-4000-8000-000000000003";
const SAM_ID: string = "80000000-0000-4000-8000-000000000002";
const PAYMENTS_ID: string = "81000000-0000-4000-8000-000000000009";

function projectUser(id: string, name: string, email: string): User {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
}

function team(name: string, number: number): ResourceOwnerEntry {
  const record: Team = new Team();
  record._id = `81000000-0000-4000-8000-00000000000${number}`;
  record.name = name;
  return { kind: "team", team: record };
}

function person(
  name: string,
  number: number,
  hasPicture: boolean = false,
): ResourceOwnerEntry {
  const record: User = new User();
  record._id = `80000000-0000-4000-8000-00000000000${number}`;
  record.name = new Name(name);
  if (hasPicture) {
    record.profilePictureId = new ObjectID(
      "90000000-0000-4000-8000-000000000001",
    );
  }
  return { kind: "user", user: record };
}

function shownNames(container: HTMLElement): Array<string> {
  return within(container)
    .queryAllByTestId("event-person-name")
    .map((element: HTMLElement): string => {
      return element.textContent || "";
    });
}

/*
 * The empty place an open record shows where an avatar would be: a dashed
 * circle with a plus, read as nothing (the word beside it is the action).
 */
function expectEmptyPlace(control: HTMLElement): void {
  const place: HTMLElement = within(control).getByTestId("event-empty-place");

  expect(place).toHaveAttribute("aria-hidden", "true");
  expect(place).toHaveClass(
    "h-6",
    "w-6",
    "rounded-full",
    "border",
    "border-dashed",
  );
  expect(place.querySelector("svg")).not.toBeNull();
}

/*
 * Assign and Add read as something to press, not as a word that happens to
 * be blue: the place and the word are one rounded control that lights up as
 * a whole, its circle lined up with the avatars beside it.
 */
function expectEmptyPlaceControl(control: HTMLElement): void {
  expect(control.tagName).toBe("BUTTON");
  expect(control).toHaveClass(
    "group",
    "inline-flex",
    "items-center",
    "gap-1.5",
    "rounded-full",
    "-ms-1",
    "ps-1",
    "pe-2.5",
    "text-gray-700",
    "hover:bg-indigo-50",
    "hover:text-indigo-700",
    "focus-visible:ring-2",
  );
  // Not a bare link: no underline, no link blue at rest.
  expect(control).not.toHaveClass("text-indigo-600", "hover:underline");
  expect(control.innerHTML).not.toContain("group-hover:underline");
  // It opens a list, right where it is.
  expect(control).toHaveAttribute("aria-haspopup", "dialog");
  expect(control).toHaveAttribute("aria-expanded", "false");
  expect(control).not.toHaveAttribute("href");
}

const ADD_OWNERS: EventAddOwners = {
  target: {
    ownerUserModelType: IncidentOwnerUser,
    ownerTeamModelType: IncidentOwnerTeam,
    resourceIdField: "incidentId",
    resourceId: new ObjectID(INCIDENT_ID),
  },
  onOwnersChanged: (): void => {},
};

function serveLists(): void {
  getListMock.mockImplementation(async (request: any): Promise<any> => {
    if (request.modelType === TeamMember) {
      const members: Array<TeamMember> = [
        projectUser(
          JORDAN_ID,
          "Jordan Patel",
          "jordan.patel@acme-commerce.example",
        ),
        projectUser(SAM_ID, "Sam Rivera", "sam.rivera@acme-commerce.example"),
      ].map((user: User): TeamMember => {
        const member: TeamMember = new TeamMember();
        member.user = user;
        return member;
      });
      return { data: members, count: members.length, skip: 0, limit: 25 };
    }

    if (request.modelType === Team) {
      const payments: Team = new Team();
      payments._id = PAYMENTS_ID;
      payments.name = "Payments";
      const checkout: ResourceOwnerEntry = team("Checkout SRE", 1);
      return {
        data: [(checkout as { kind: "team"; team: Team }).team, payments],
        count: 2,
        skip: 0,
        limit: 25,
      };
    }

    return { data: [], count: 0, skip: 0, limit: 0 };
  });
}

async function openedList(name: string): Promise<HTMLElement> {
  const dialog: HTMLElement = await screen.findByRole("dialog", { name });
  await within(dialog).findAllByRole("option");
  return dialog;
}

function offered(dialog: HTMLElement): Array<string> {
  return within(dialog)
    .getAllByRole("option")
    .map((option: HTMLElement): string => {
      return option.getAttribute("data-id") || "";
    });
}

function pick(dialog: HTMLElement, id: string): void {
  fireEvent.click(
    within(dialog)
      .getAllByRole("option")
      .find((option: HTMLElement): boolean => {
        return option.getAttribute("data-id") === id;
      })!,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/incidents`);
  serveLists();
  createMock.mockResolvedValue({});
  // jsdom has no scrollIntoView.
  (
    Element.prototype as unknown as { scrollIntoView: () => void }
  ).scrollIntoView = (): void => {};
});

afterEach(() => {
  cleanup();
});

describe("the commander", () => {
  test("is the person holding the role, drawn as an avatar and a name", () => {
    const view: RenderResult = render(
      <CommanderFactValue members={[MAYA]} roleName="Incident Commander" />,
    );

    expect(shownNames(view.container)).toEqual(["Maya Chen"]);

    const holder: HTMLElement = screen.getByTestId("event-commander-person");

    expect(holder).toHaveAttribute("data-kind", "user");
    // The avatar is decoration: a screen reader hears the name once.
    expect(holder.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("a person without a name is named by their email", () => {
    const view: RenderResult = render(
      <CommanderFactValue
        members={[{ ...MAYA, name: "" }]}
        roleName="Incident Commander"
      />,
    );

    expect(shownNames(view.container)).toEqual([
      "maya.chen@acme-commerce.example",
    ]);
  });

  test("while the record is open, the empty place and Assign stand where the commander would", () => {
    render(
      <CommanderFactValue
        members={[]}
        roleName="Incident Commander"
        onAssign={async (): Promise<void> => {}}
      />,
    );

    // Visibly "Assign"; heard as which role it gives.
    const assign: HTMLElement = screen.getByRole("button", {
      name: "Assign Incident Commander",
    });

    expect(assign).toHaveTextContent("Assign");
    expect(assign).toHaveAttribute("data-testid", "event-commander-assign");
    // The dashed place and the word are one control, laid out like a person.
    expectEmptyPlace(assign);
    expectEmptyPlaceControl(assign);
    // Said once: the place and its action, not "Not assigned" beside them.
    expect(screen.queryByText("Not assigned")).toBeNull();
    expect(screen.getByTestId("event-commander")).toHaveTextContent(/^Assign$/);
  });

  test("Assign opens a list of the project's people right under it, and lights up while it is open", async () => {
    render(
      <CommanderFactValue
        members={[]}
        roleName="Incident Commander"
        onAssign={async (): Promise<void> => {}}
      />,
    );

    const assign: HTMLElement = screen.getByRole("button", {
      name: "Assign Incident Commander",
    });

    fireEvent.click(assign);

    // Named as the role it gives; people only, no teams.
    const list: HTMLElement = await openedList("Assign Incident Commander");

    expect(offered(list)).toEqual([JORDAN_ID, SAM_ID]);
    expect(
      within(list).getByRole("combobox", {
        name: "Search people by name or email",
      }),
    ).toBeVisible();
    expect(
      getListMock.mock.calls.some((call: Array<any>): boolean => {
        return call[0].modelType === Team;
      }),
    ).toBe(false);
    // A single choice: nothing to add, no tick until one is given.
    expect(within(list).getByRole("listbox")).not.toHaveAttribute(
      "aria-multiselectable",
    );
    expect(assign).toHaveAttribute("aria-expanded", "true");
    expect(assign).toHaveAttribute("aria-controls", list.id);
    for (const className of EVENT_EMPTY_PLACE_ACTION_OPEN_CLASS_NAME.split(
      " ",
    )) {
      expect(assign).toHaveClass(className);
    }
    // Never both the idle and the lit colour: the later rule would win.
    expect(assign).not.toHaveClass("text-gray-700");
    expect(within(assign).getByTestId("event-empty-place")).toHaveClass(
      "border-indigo-500",
    );
  });

  test("a person picked is given the role, and the list closes with the keyboard where it was", async () => {
    const onAssign: Mock<(person: PeoplePickerOption) => Promise<void>> =
      jest.fn<(person: PeoplePickerOption) => Promise<void>>(
        async (): Promise<void> => {},
      );

    render(
      <CommanderFactValue
        members={[]}
        roleName="Incident Commander"
        onAssign={onAssign}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Assign Incident Commander" }),
    );

    const list: HTMLElement = await openedList("Assign Incident Commander");

    pick(list, JORDAN_ID);

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Assign Incident Commander" }),
      ).toBeNull();
    });

    expect(onAssign).toHaveBeenCalledTimes(1);
    expect(onAssign.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        id: JORDAN_ID,
        name: "Jordan Patel",
        description: "jordan.patel@acme-commerce.example",
      }),
    );
    // Focus lands on the commander, not on the page's body.
    expect(screen.getByTestId("event-commander")).toHaveFocus();
  });

  test("a refusal is said in the list, which stays open on the same people", async () => {
    const onAssign: () => Promise<void> = async (): Promise<void> => {
      throw new Error("This user already has this role.");
    };

    render(
      <CommanderFactValue
        members={[]}
        roleName="Incident Commander"
        onAssign={onAssign}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Assign Incident Commander" }),
    );

    const list: HTMLElement = await openedList("Assign Incident Commander");

    pick(list, SAM_ID);

    expect(
      await within(list).findByText("This user already has this role."),
    ).toBeVisible();
    expect(
      screen.getByRole("dialog", { name: "Assign Incident Commander" }),
    ).toBe(list);
    expect(offered(list)).toEqual([JORDAN_ID, SAM_ID]);
    // Still nobody: Assign stays.
    expect(
      screen.getByRole("button", { name: "Assign Incident Commander" }),
    ).toBeVisible();
  });

  test("a record that is over only says nobody held it", () => {
    render(<CommanderFactValue members={[]} roleName="Incident Commander" />);

    expect(screen.getByTestId("event-commander")).toHaveTextContent(
      /^Not assigned$/,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("event-empty-place")).toBeNull();
  });

  test("lists people one a line under the label, as the header lists monitors", () => {
    const people: RenderResult = render(
      <CommanderFactValue
        members={[
          MAYA,
          {
            ...MAYA,
            userId: "80000000-0000-4000-8000-000000000002",
            name: "Sam Rivera",
          },
        ]}
        roleName="Incident Commander"
      />,
    );

    const commander: HTMLElement = people.getByTestId("event-commander");

    expect(commander).toHaveClass(
      "flex",
      "max-w-full",
      "flex-col",
      "items-start",
      "gap-2",
    );
    // Never side by side, so a list never wraps two to a line and one under.
    expect(commander).not.toHaveClass("flex-wrap");
    expect(shownNames(people.container)).toEqual(["Maya Chen", "Sam Rivera"]);
    // Each person is a line of the list.
    expect(
      Array.from(commander.children).map((line: Element): string | null => {
        return line.getAttribute("data-testid");
      }),
    ).toEqual(["event-commander-person", "event-commander-person"]);
    // Nothing to focus: no Assign was offered.
    expect(commander).not.toHaveAttribute("tabindex");
    people.unmount();

    const open: RenderResult = render(
      <CommanderFactValue
        members={[]}
        roleName="Incident Commander"
        onAssign={async (): Promise<void> => {}}
      />,
    );

    expect(open.getByTestId("event-commander")).toHaveClass("flex", "flex-col");
  });

  test("an avatar and the empty place take a text line's 20px in the row, so a name sits level with the words beside it", () => {
    const people: RenderResult = render(
      <CommanderFactValue members={[MAYA]} roleName="Incident Commander" />,
    );
    const avatar: HTMLElement = people.getByTestId("event-person-name")
      .previousElementSibling as HTMLElement;

    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(avatar).toHaveClass("-my-0.5");
    people.unmount();

    render(
      <CommanderFactValue
        members={[]}
        roleName="Incident Commander"
        onAssign={async (): Promise<void> => {}}
      />,
    );

    expect(screen.getByTestId("event-empty-place")).toHaveClass(
      "-my-0.5",
      "h-6",
      "w-6",
    );
  });

  test("wraps a long name beside its avatar instead of cutting it short", () => {
    render(
      <CommanderFactValue
        members={[
          { ...MAYA, name: "Maximiliane Alexandra Rosenthal-Vandenberg" },
        ]}
        roleName="Incident Commander"
      />,
    );

    const name: HTMLElement = screen.getByTestId("event-person-name");

    expect(name).toHaveClass("min-w-0", "break-words");
    expect(name).not.toHaveClass("truncate");
  });

  test("Assign names the project's own role", async () => {
    render(
      <CommanderFactValue
        members={[]}
        roleName="Incident Lead"
        onAssign={async (): Promise<void> => {}}
      />,
    );

    const assign: HTMLElement = screen.getByRole("button", {
      name: "Assign Incident Lead",
    });

    expect(assign).toBeVisible();
    fireEvent.click(assign);
    expect(await openedList("Assign Incident Lead")).toBeVisible();
  });
});

describe("getCommanderFact", () => {
  const holding: PrimaryRoleHolding = {
    role: {
      id: MAYA.roleId,
      name: "Incident Commander",
      isPrimaryRole: true,
      icon: IconProp.ShieldCheck,
    },
    members: [MAYA],
  };

  test("is named after the primary role, with its icon", () => {
    const fact: EventStatusFact | null = getCommanderFact({ holding });

    expect(fact?.label).toBe("Incident Commander");
    expect(fact?.icon).toBe(IconProp.ShieldCheck);

    const view: RenderResult = render(<>{fact!.value}</>);

    expect(shownNames(view.container)).toEqual(["Maya Chen"]);
  });

  test("a renamed role keeps its name; a role without an icon gets the shield", () => {
    const fact: EventStatusFact | null = getCommanderFact({
      holding: {
        role: { id: MAYA.roleId, name: "Incident Lead", isPrimaryRole: true },
        members: [],
      },
    });

    expect(fact?.label).toBe("Incident Lead");
    expect(fact?.icon).toBe(IconProp.ShieldCheck);
  });

  test("a role with no name reads Incident Commander", () => {
    const fact: EventStatusFact | null = getCommanderFact({
      holding: {
        role: { id: MAYA.roleId, name: "", isPrimaryRole: true },
        members: [],
      },
    });

    expect(fact?.label).toBe("Incident Commander");
  });

  test("says nothing until the roles are read, or for a project without a primary role", () => {
    expect(getCommanderFact({ holding: null })).toBeNull();
  });

  test("hands Assign to the value only when it is offered", () => {
    const onAssign: (
      person: PeoplePickerOption,
    ) => Promise<void> = async (): Promise<void> => {};
    const open: EventStatusFact | null = getCommanderFact({
      holding: { ...holding, members: [] },
      onAssign: onAssign,
    });
    const over: EventStatusFact | null = getCommanderFact({
      holding: { ...holding, members: [] },
    });

    expect(
      (
        (open!.value as ReactElement).props as {
          onAssign?: (person: PeoplePickerOption) => Promise<void>;
        }
      ).onAssign,
    ).toBe(onAssign);
    expect(
      (
        (over!.value as ReactElement).props as {
          onAssign?: (person: PeoplePickerOption) => Promise<void>;
        }
      ).onAssign,
    ).toBeUndefined();
  });
});

describe("the owners", () => {
  test("names each owner as given: teams as teams, people as people", () => {
    const view: RenderResult = render(
      <OwnersFactValue
        owners={[team("Checkout SRE", 1), person("Sam Rivera", 2, true)]}
        ownersRoute={OWNERS_ROUTE}
      />,
    );

    expect(shownNames(view.container)).toEqual(["Checkout SRE", "Sam Rivera"]);
    expect(
      screen.getAllByTestId("event-owner").map((owner: HTMLElement) => {
        return owner.getAttribute("data-kind");
      }),
    ).toEqual(["team", "user"]);
    // A person with a picture: the picture, read as nothing (decoration).
    expect(view.container.querySelector("img")).not.toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("names three, and links the rest to the Owners page, where the full list is managed", () => {
    const view: RenderResult = render(
      <OwnersFactValue
        owners={[
          team("Checkout SRE", 1),
          team("Database Reliability", 2),
          team("Platform", 3),
          person("Alex Kim", 4),
          person("Jordan Patel", 5),
        ]}
        ownersRoute={OWNERS_ROUTE}
      />,
    );

    expect(shownNames(view.container)).toEqual([
      "Checkout SRE",
      "Database Reliability",
      "Platform",
    ]);

    const more: HTMLElement = screen.getByRole("link", { name: "+2 more" });

    expect(more).toHaveAttribute("href", OWNERS_ROUTE.toString());
  });

  test("while the record is open, the empty place and Add stand in the owners' place, and open the Add owners list - not the Owners page", async () => {
    render(
      <OwnersFactValue
        owners={[]}
        ownersRoute={OWNERS_ROUTE}
        addOwners={ADD_OWNERS}
      />,
    );

    // Visibly "Add" after "Owners"; heard on its own as "Add owners".
    const add: HTMLElement = screen.getByRole("button", { name: "Add owners" });

    expect(add).toHaveAttribute("data-testid", "event-owners-add");
    // Shown under the pointer as what it adds, as the Add after owners is.
    expect(add).toHaveAttribute("title", "Add owners");
    expect(within(add).getByText("Add")).toHaveAttribute("aria-hidden", "true");
    expectEmptyPlace(add);
    expectEmptyPlaceControl(add);
    // Said once: no "None" beside the place that says it.
    expect(screen.queryByText("None")).toBeNull();
    expect(screen.getByTestId("event-owners")).toHaveClass("flex-col");
    // The one place to add owners: no second one at the end of an empty list.
    expect(screen.queryByTestId("event-owners-add-more")).toBeNull();
    // Nowhere to go: no link at all.
    expect(screen.queryByRole("link")).toBeNull();

    fireEvent.click(add);

    const list: HTMLElement = await openedList("Add owners");

    // The project's people, then its teams.
    expect(offered(list)).toEqual([
      JORDAN_ID,
      SAM_ID,
      "81000000-0000-4000-8000-000000000001",
      PAYMENTS_ID,
    ]);
    expect(add).toHaveAttribute("aria-expanded", "true");
  });

  test("a record that is over only says None", () => {
    render(<OwnersFactValue owners={[]} ownersRoute={OWNERS_ROUTE} />);

    expect(screen.getByTestId("event-owners")).toHaveTextContent(/^None$/);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("event-empty-place")).toBeNull();
  });

  test("owners are listed one a line under the label, as the header lists monitors", () => {
    render(
      <OwnersFactValue
        owners={[team("Checkout SRE", 1), person("Sam Rivera", 2)]}
        ownersRoute={OWNERS_ROUTE}
      />,
    );

    const owners: HTMLElement = screen.getByTestId("event-owners");

    expect(owners).toHaveClass("flex", "flex-col", "items-start", "gap-2");
    expect(owners).not.toHaveClass("flex-wrap");
    expect(
      Array.from(owners.children).map((line: Element): string | null => {
        return line.getAttribute("data-testid");
      }),
    ).toEqual(["event-owner", "event-owner"]);
  });

  test("an open record's owners end with the empty place, which adds more right there", async () => {
    render(
      <OwnersFactValue
        owners={[team("Checkout SRE", 1), person("Sam Rivera", 2)]}
        ownersRoute={OWNERS_ROUTE}
        addOwners={ADD_OWNERS}
      />,
    );

    const addMore: HTMLElement = screen.getByTestId("event-owners-add-more");
    const owners: HTMLElement = screen.getByTestId("event-owners");

    // Heard and shown under the pointer as what it does.
    expect(addMore).toBe(screen.getByRole("button", { name: "Add owners" }));
    expect(addMore).toHaveAttribute("title", "Add owners");
    /*
     * The same control as on a record nobody owns: the empty place and the
     * word "Add", so it reads as one to press on a phone too, where nothing
     * shows under a pointer.
     */
    expectEmptyPlace(addMore);
    expectEmptyPlaceControl(addMore);
    expect(within(addMore).getByText("Add")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    // The list's last line, after the people.
    expect(owners.lastElementChild?.contains(addMore)).toBe(true);
    expect(owners).toHaveClass("flex-col");
    expect(shownNames(owners)).toEqual(["Checkout SRE", "Sam Rivera"]);

    fireEvent.click(addMore);

    const list: HTMLElement = await openedList("Add owners");

    // Whoever owns it already is left out: Sam Rivera and Checkout SRE.
    expect(offered(list)).toEqual([JORDAN_ID, PAYMENTS_ID]);
  });

  test("a pick is added to the record, and the header is told to read its owners again", async () => {
    const changes: Array<OwnersChange> = [];

    render(
      <OwnersFactValue
        owners={[team("Checkout SRE", 1)]}
        ownersRoute={OWNERS_ROUTE}
        addOwners={{
          ...ADD_OWNERS,
          onOwnersChanged: (change: OwnersChange): void => {
            changes.push(change);
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add owners" }));

    const list: HTMLElement = await openedList("Add owners");

    pick(list, JORDAN_ID);

    expect(await within(list).findByText("Added Jordan Patel.")).toBeVisible();

    const request: any = createMock.mock.calls[0]![0];

    expect(request.modelType).toBe(IncidentOwnerUser);
    expect(String(request.model.incidentId)).toBe(INCIDENT_ID);
    expect(String(request.model.userId)).toBe(JORDAN_ID);
    expect(changes).toEqual([{ wasAdded: true }]);
    // Still open, for the next one.
    expect(screen.getByRole("dialog", { name: "Add owners" })).toBe(list);
  });

  test("the list stays open as the empty place gives way to the first owner and the Add after it", async () => {
    const view: RenderResult = render(
      <OwnersFactValue
        owners={[]}
        ownersRoute={OWNERS_ROUTE}
        addOwners={ADD_OWNERS}
      />,
    );

    fireEvent.click(screen.getByTestId("event-owners-add"));

    const list: HTMLElement = await openedList("Add owners");

    pick(list, SAM_ID);

    await within(list).findByText("Added Sam Rivera.");

    // The header read its owners again: Sam is the first.
    view.rerender(
      <OwnersFactValue
        owners={[person("Sam Rivera", 2)]}
        ownersRoute={OWNERS_ROUTE}
        addOwners={ADD_OWNERS}
      />,
    );

    expect(shownNames(screen.getByTestId("event-owners"))).toEqual([
      "Sam Rivera",
    ]);
    expect(screen.getByTestId("event-owners-add-more")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("dialog", { name: "Add owners" })).toBe(list);
    expect(offered(list)).not.toContain(SAM_ID);
  });

  test("the place to add more follows +N more on a long list", () => {
    render(
      <OwnersFactValue
        owners={[
          team("Checkout SRE", 1),
          team("Database Reliability", 2),
          team("Platform", 3),
          person("Alex Kim", 4),
        ]}
        ownersRoute={OWNERS_ROUTE}
        addOwners={ADD_OWNERS}
      />,
    );

    const owners: HTMLElement = screen.getByTestId("event-owners");
    const more: HTMLElement = screen.getByRole("link", { name: "+1 more" });
    const add: HTMLElement = screen.getByRole("button", { name: "Add owners" });

    expect(screen.getAllByRole("link")).toEqual([more]);
    // Each a line of its own, Add the last.
    expect(more.parentElement).toBe(owners);
    expect(owners.lastElementChild?.contains(add)).toBe(true);
  });

  test("a record that is over offers no place to add owners", () => {
    render(
      <OwnersFactValue
        owners={[team("Checkout SRE", 1)]}
        ownersRoute={OWNERS_ROUTE}
      />,
    );

    expect(screen.queryByTestId("event-owners-add-more")).toBeNull();
    expect(screen.queryByTestId("event-empty-place")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("a person by name", () => {
  test("is drawn as the header's other people are: an avatar with initials and the name", () => {
    render(<PersonFactValue name="Jordan Patel" />);

    const value: HTMLElement = screen.getByTestId("event-person");
    const entry: HTMLElement = screen.getByTestId("event-person-entry");

    expect(value).toHaveClass("flex", "flex-col");
    expect(entry).toHaveAttribute("data-kind", "user");
    expect(shownNames(value)).toEqual(["Jordan Patel"]);
    // The avatar is decoration: the name is read once.
    expect(entry.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(value).toHaveTextContent(/^JPJordan Patel$/);
  });

  test("names someone without a name by the email it is given", () => {
    render(<PersonFactValue name="jordan.patel@acme-commerce.example" />);

    expect(shownNames(screen.getByTestId("event-person"))).toEqual([
      "jordan.patel@acme-commerce.example",
    ]);
  });
});

describe("getOwnersFact", () => {
  test("is Owners, with the team icon, once the owners are read", () => {
    const fact: EventStatusFact | null = getOwnersFact({
      owners: [team("Checkout SRE", 1)],
      ownersRoute: OWNERS_ROUTE,
    });

    expect(fact?.label).toBe("Owners");
    expect(fact?.icon).toBe(IconProp.Team);
  });

  test("says nothing while they are being read, or when they cannot be", () => {
    expect(
      getOwnersFact({ owners: undefined, ownersRoute: OWNERS_ROUTE }),
    ).toBeNull();
  });

  test("an empty list is a fact: the record has no owners", () => {
    const over: EventStatusFact | null = getOwnersFact({
      owners: [],
      ownersRoute: OWNERS_ROUTE,
    });
    const overView: RenderResult = render(<>{over!.value}</>);

    expect(overView.container).toHaveTextContent("None");
    overView.unmount();

    const open: EventStatusFact | null = getOwnersFact({
      owners: [],
      ownersRoute: OWNERS_ROUTE,
      addOwners: ADD_OWNERS,
    });
    const openView: RenderResult = render(<>{open!.value}</>);

    expect(
      within(openView.container).getByRole("button", { name: "Add owners" }),
    ).toBeVisible();
  });

  test("hands Add to the value only when it is offered", () => {
    const open: EventStatusFact | null = getOwnersFact({
      owners: [],
      ownersRoute: OWNERS_ROUTE,
      addOwners: ADD_OWNERS,
    });
    const over: EventStatusFact | null = getOwnersFact({
      owners: [],
      ownersRoute: OWNERS_ROUTE,
    });

    expect(
      ((open!.value as ReactElement).props as { addOwners?: EventAddOwners })
        .addOwners,
    ).toBe(ADD_OWNERS);
    expect(
      ((over!.value as ReactElement).props as { addOwners?: EventAddOwners })
        .addOwners,
    ).toBeUndefined();
  });
});

/*
 * In the reader's language: what the values say, and the role's name in
 * what Assign is heard as - the name the header's label shows, which the
 * panel looks up. The instance reaches the values through I18nextProvider
 * only, so German never leaks into the other suites of this worker.
 */
describe("in the reader's language", () => {
  const createGerman: () => Promise<i18n> = async (): Promise<i18n> => {
    const instance: i18n = createInstance();

    await instance.init({
      lng: "de",
      resources: {
        de: {
          translation: {
            "Not assigned": "Nicht zugewiesen",
            Assign: "Zuweisen",
            "Assign {{role}}": "{{role}} zuweisen",
            "Incident Commander": "Vorfall-Kommandant",
            None: "Keine",
            Add: "Hinzufügen",
            "Add owners": "Eigentümer hinzufügen",
            "Search people by name or email":
              "Personen nach Name oder E-Mail suchen",
            "Added {{name}}.": "{{name}} hinzugefügt.",
          },
        },
      },
      keySeparator: false,
      nsSeparator: false,
    });

    return instance;
  };

  test("Assign heard with the role's name as the header shows it, and its list named the same; Not assigned once it is over", async () => {
    const german: i18n = await createGerman();

    const open: RenderResult = render(
      <I18nextProvider i18n={german}>
        <CommanderFactValue
          members={[]}
          roleName="Incident Commander"
          onAssign={async (): Promise<void> => {}}
        />
      </I18nextProvider>,
    );

    const assign: HTMLElement = screen.getByRole("button", {
      name: "Vorfall-Kommandant zuweisen",
    });

    expect(assign).toHaveTextContent("Zuweisen");

    fireEvent.click(assign);

    const list: HTMLElement = await openedList("Vorfall-Kommandant zuweisen");

    expect(
      within(list).getByPlaceholderText(
        "Personen nach Name oder E-Mail suchen",
      ),
    ).toBeVisible();
    open.unmount();

    render(
      <I18nextProvider i18n={german}>
        <CommanderFactValue members={[]} roleName="Incident Commander" />
      </I18nextProvider>,
    );

    expect(screen.getByText("Nicht zugewiesen")).toBeVisible();
  });

  test("a project's own role name, with no entry of its own, reads as written", async () => {
    const german: i18n = await createGerman();

    render(
      <I18nextProvider i18n={german}>
        <CommanderFactValue
          members={[]}
          roleName="Incident Lead"
          onAssign={async (): Promise<void> => {}}
        />
      </I18nextProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Incident Lead zuweisen" }),
    ).toBeVisible();
  });

  test("Add heard as Add owners, its list named the same and saying what it added; None once it is over", async () => {
    const german: i18n = await createGerman();

    const open: RenderResult = render(
      <I18nextProvider i18n={german}>
        <OwnersFactValue
          owners={[]}
          ownersRoute={OWNERS_ROUTE}
          addOwners={ADD_OWNERS}
        />
      </I18nextProvider>,
    );

    const add: HTMLElement = screen.getByRole("button", {
      name: "Eigentümer hinzufügen",
    });

    expect(add).toHaveTextContent("HinzufügenEigentümer hinzufügen");
    expect(add).toHaveAttribute("title", "Eigentümer hinzufügen");

    fireEvent.click(add);

    const list: HTMLElement = await openedList("Eigentümer hinzufügen");

    pick(list, JORDAN_ID);

    expect(
      await within(list).findByText("Jordan Patel hinzugefügt."),
    ).toBeVisible();
    open.unmount();

    render(
      <I18nextProvider i18n={german}>
        <OwnersFactValue owners={[]} ownersRoute={OWNERS_ROUTE} />
      </I18nextProvider>,
    );

    expect(screen.getByText("Keine")).toBeVisible();
  });
});

describe("nothing in the people row sends the reader away to fill it", () => {
  test("Add and Assign are buttons; the only link is +N more, to the full list", async () => {
    await act(async () => {
      render(
        <>
          <CommanderFactValue
            members={[]}
            roleName="Incident Commander"
            onAssign={async (): Promise<void> => {}}
          />
          <OwnersFactValue
            owners={[
              team("Checkout SRE", 1),
              team("Database Reliability", 2),
              team("Platform", 3),
              person("Alex Kim", 4),
            ]}
            ownersRoute={OWNERS_ROUTE}
            addOwners={ADD_OWNERS}
          />
        </>,
      );
    });

    expect(
      screen.getAllByRole("link").map((link: HTMLElement) => {
        return link.textContent;
      }),
    ).toEqual(["+1 more"]);
    expect(
      screen.getAllByRole("button").map((button: HTMLElement) => {
        return button.getAttribute("aria-haspopup");
      }),
    ).toEqual(["dialog", "dialog"]);
  });
});
