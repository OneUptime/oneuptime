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
  within,
} from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import { Mock } from "jest-mock";
import { createInstance, i18n } from "i18next";
import { I18nextProvider } from "react-i18next";

/*
 * The people row of an incident's, alert's or episode's header: who commands
 * the response and who owns it (the customer's "Easy to see Incident
 * Commander and Team(s)"). What each value says, what it offers while the
 * record is open, and where its links and its Assign go.
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

import {
  CommanderFactValue,
  EVENT_ROLES_CARD_ID,
  OwnersFactValue,
  PersonFactValue,
  RoleAssignRequestState,
  getCommanderFact,
  getOwnersFact,
  scrollToEventRolesCard,
  useRoleAssignRequest,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventPeopleFacts";
import { EventStatusFact } from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import { ResourceOwnerEntry } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnerEntry";
import {
  EventRoleMember,
  PrimaryRoleHolding,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/EventPeople";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

const OWNERS_ROUTE: Route = new Route(
  "/dashboard/10000000-0000-4000-8000-000000000001/incidents/20000000-0000-4000-8000-000000001042/owners",
);

const MAYA: EventRoleMember = {
  roleId: "76000000-0000-4000-8000-000000000001",
  userId: "80000000-0000-4000-8000-000000000001",
  name: "Maya Chen",
  email: "maya.chen@acme-commerce.example",
  hasProfilePicture: false,
};

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
    "border-gray-300",
  );
  expect(place.querySelector("svg")).not.toBeNull();
}

/*
 * Assign and Add read as something to press, not as a word that happens to
 * be blue: the place and the word are one rounded control that lights up as
 * a whole, its circle lined up with the avatars beside it.
 */
function expectEmptyPlaceControl(control: HTMLElement): void {
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
}

afterEach(() => {
  cleanup();
});

describe("the commander", () => {
  test("is the person holding the role, drawn as an avatar and a name", () => {
    const view: RenderResult = render(
      <CommanderFactValue members={[MAYA]} roleName="Incident Commander" />,
    );

    expect(shownNames(view.container)).toEqual(["Maya Chen"]);

    const person: HTMLElement = screen.getByTestId("event-commander-person");

    expect(person).toHaveAttribute("data-kind", "user");
    // The avatar is decoration: a screen reader hears the name once.
    expect(person.querySelector("[aria-hidden='true']")).not.toBeNull();
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
    const onAssign: Mock<() => void> = jest.fn<() => void>();

    render(
      <CommanderFactValue
        members={[]}
        roleName="Incident Commander"
        onAssign={onAssign}
      />,
    );

    // Visibly "Assign"; heard as which role it gives.
    const assign: HTMLElement = screen.getByRole("button", {
      name: "Assign Incident Commander",
    });

    expect(assign).toHaveTextContent("Assign");
    // The dashed place and the word are one control, laid out like a person.
    expectEmptyPlace(assign);
    expectEmptyPlaceControl(assign);
    // Said once: the place and its action, not "Not assigned" beside them.
    expect(screen.queryByText("Not assigned")).toBeNull();
    expect(screen.getByTestId("event-commander")).toHaveTextContent(/^Assign$/);

    fireEvent.click(assign);

    expect(onAssign).toHaveBeenCalledTimes(1);
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
    people.unmount();

    const open: RenderResult = render(
      <CommanderFactValue
        members={[]}
        roleName="Incident Commander"
        onAssign={(): void => {}}
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
        onAssign={(): void => {}}
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

  test("Assign names the project's own role", () => {
    render(
      <CommanderFactValue
        members={[]}
        roleName="Incident Lead"
        onAssign={(): void => {}}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Assign Incident Lead" }),
    ).toBeVisible();
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
    const onAssign: () => void = (): void => {};
    const open: EventStatusFact | null = getCommanderFact({
      holding: { ...holding, members: [] },
      onAssign: onAssign,
    });
    const over: EventStatusFact | null = getCommanderFact({
      holding: { ...holding, members: [] },
    });

    expect(
      ((open!.value as ReactElement).props as { onAssign?: () => void })
        .onAssign,
    ).toBe(onAssign);
    expect(
      ((over!.value as ReactElement).props as { onAssign?: () => void })
        .onAssign,
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
  });

  test("names three, and links the rest to the Owners page", () => {
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

  test("while the record is open, the empty place and Add lead to the Owners page", () => {
    render(
      <OwnersFactValue
        owners={[]}
        ownersRoute={OWNERS_ROUTE}
        canAddOwners={true}
      />,
    );

    // Visibly "Add" after "Owners"; heard on its own as "Add owners".
    const add: HTMLElement = screen.getByRole("link", { name: "Add owners" });

    expect(add).toHaveAttribute("href", OWNERS_ROUTE.toString());
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
  });

  test("a record that is over only says None", () => {
    render(<OwnersFactValue owners={[]} ownersRoute={OWNERS_ROUTE} />);

    expect(screen.getByTestId("event-owners")).toHaveTextContent(/^None$/);
    expect(screen.queryByRole("link")).toBeNull();
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

  test("an open record's owners end with the empty place, to add more from the Owners page", () => {
    render(
      <OwnersFactValue
        owners={[team("Checkout SRE", 1), person("Sam Rivera", 2)]}
        ownersRoute={OWNERS_ROUTE}
        canAddOwners={true}
      />,
    );

    const addMore: HTMLElement = screen.getByTestId("event-owners-add-more");
    const owners: HTMLElement = screen.getByTestId("event-owners");

    // Heard and shown under the pointer as what it does.
    expect(addMore).toBe(screen.getByRole("link", { name: "Add owners" }));
    expect(addMore).toHaveAttribute("title", "Add owners");
    expect(addMore).toHaveAttribute("href", OWNERS_ROUTE.toString());
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
    expect(owners.lastElementChild).toBe(addMore);
    expect(owners).toHaveClass("flex-col");
    expect(shownNames(owners)).toEqual(["Checkout SRE", "Sam Rivera"]);
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
        canAddOwners={true}
      />,
    );

    const owners: HTMLElement = screen.getByTestId("event-owners");
    const more: HTMLElement = screen.getByRole("link", { name: "+1 more" });
    const add: HTMLElement = screen.getByRole("link", { name: "Add owners" });

    expect(screen.getAllByRole("link")).toEqual([more, add]);
    // Each a line of its own, Add the last.
    expect(more.parentElement).toBe(owners);
    expect(owners.lastElementChild).toBe(add);
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
      canAddOwners: true,
    });
    const openView: RenderResult = render(<>{open!.value}</>);

    expect(
      within(openView.container).getByRole("link", { name: "Add owners" }),
    ).toBeVisible();
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
          },
        },
      },
      keySeparator: false,
      nsSeparator: false,
    });

    return instance;
  };

  test("Assign heard with the role's name as the header shows it; Not assigned once it is over", async () => {
    const german: i18n = await createGerman();

    const open: RenderResult = render(
      <I18nextProvider i18n={german}>
        <CommanderFactValue
          members={[]}
          roleName="Incident Commander"
          onAssign={(): void => {}}
        />
      </I18nextProvider>,
    );

    const assign: HTMLElement = screen.getByRole("button", {
      name: "Vorfall-Kommandant zuweisen",
    });

    expect(assign).toHaveTextContent("Zuweisen");
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
          onAssign={(): void => {}}
        />
      </I18nextProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Incident Lead zuweisen" }),
    ).toBeVisible();
  });

  test("Add heard as Add owners; None once it is over", async () => {
    const german: i18n = await createGerman();

    const open: RenderResult = render(
      <I18nextProvider i18n={german}>
        <OwnersFactValue
          owners={[]}
          ownersRoute={OWNERS_ROUTE}
          canAddOwners={true}
        />
      </I18nextProvider>,
    );

    const add: HTMLElement = screen.getByRole("link", {
      name: "Eigentümer hinzufügen",
    });

    expect(add).toHaveAttribute("href", OWNERS_ROUTE.toString());
    expect(screen.getByTestId("event-owners-add")).toHaveTextContent(
      "HinzufügenEigentümer hinzufügen",
    );
    open.unmount();

    render(
      <I18nextProvider i18n={german}>
        <OwnersFactValue owners={[]} ownersRoute={OWNERS_ROUTE} />
      </I18nextProvider>,
    );

    expect(screen.getByText("Keine")).toBeVisible();
  });
});

describe("Assign takes the reader to the roles card", () => {
  let scrollIntoView: Mock<(options?: ScrollIntoViewOptions) => void>;
  let reducedMotion: boolean = false;
  const originalMatchMedia: typeof window.matchMedia = window.matchMedia;

  beforeEach(() => {
    reducedMotion = false;
    scrollIntoView = jest.fn<(options?: ScrollIntoViewOptions) => void>();
    Element.prototype.scrollIntoView = scrollIntoView as never;
    window.matchMedia = ((query: string) => {
      return {
        matches: reducedMotion && query.includes("prefers-reduced-motion"),
      };
    }) as never;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  test("scrolls it into view and gives it focus, without a second jump", () => {
    render(
      <div id={EVENT_ROLES_CARD_ID} tabIndex={-1} data-testid="roles">
        Incident Roles
      </div>,
    );

    scrollToEventRolesCard();

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
    expect(screen.getByTestId("roles")).toHaveFocus();
  });

  test("jumps without the animation for a reader who asked for less motion", () => {
    reducedMotion = true;
    render(
      <div id={EVENT_ROLES_CARD_ID} tabIndex={-1}>
        Incident Roles
      </div>,
    );

    scrollToEventRolesCard();

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "start",
    });
  });

  test("does nothing on a page without the card", () => {
    expect(() => {
      scrollToEventRolesCard();
    }).not.toThrow();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  /*
   * The page's side of Assign (useRoleAssignRequest): each Assign is a new
   * request for the role's picker, handed to the roles card, and the reader
   * is taken to the card.
   */
  describe("useRoleAssignRequest", () => {
    let latest: RoleAssignRequestState | undefined;

    const Page: () => ReactElement = (): ReactElement => {
      latest = useRoleAssignRequest();

      return (
        <div id={EVENT_ROLES_CARD_ID} tabIndex={-1} data-testid="roles">
          Incident Roles
        </div>
      );
    };

    test("asks for nothing until Assign is pressed", () => {
      render(<Page />);

      expect(latest?.request).toBeUndefined();
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    test("each Assign is a new request for the role, and takes the reader to the card", () => {
      render(<Page />);

      act(() => {
        latest!.requestAssign("76000000-0000-4000-8000-000000000001");
      });

      expect(latest?.request).toEqual({
        roleId: "76000000-0000-4000-8000-000000000001",
        requestId: 1,
      });
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("roles")).toHaveFocus();

      // Pressed again (the picker was closed): a new request, so it reopens.
      act(() => {
        latest!.requestAssign("76000000-0000-4000-8000-000000000001");
      });

      expect(latest?.request?.requestId).toBe(2);
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
    });

    test("keeps the same function between renders, so a header built from it never changes for nothing", () => {
      const view: RenderResult = render(<Page />);
      const first: ((roleId: string) => void) | undefined =
        latest?.requestAssign;

      view.rerender(<Page />);

      expect(latest?.requestAssign).toBe(first);
    });
  });
});
