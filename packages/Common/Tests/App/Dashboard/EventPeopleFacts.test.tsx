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
      }): ReactElement => {
        return React.createElement(
          "a",
          { href: props.to?.toString(), className: props.className },
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
  getCommanderFact,
  getOwnersFact,
  scrollToEventRolesCard,
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

  test("says Not assigned, and offers Assign while the record is open", () => {
    const onAssign: Mock<() => void> = jest.fn<() => void>();

    render(
      <CommanderFactValue
        members={[]}
        roleName="Incident Commander"
        onAssign={onAssign}
      />,
    );

    expect(screen.getByText("Not assigned")).toBeVisible();

    // Visibly "Assign"; heard as which role it gives.
    const assign: HTMLElement = screen.getByRole("button", {
      name: "Assign Incident Commander",
    });

    expect(assign).toHaveTextContent("Assign");

    fireEvent.click(assign);

    expect(onAssign).toHaveBeenCalledTimes(1);
  });

  test("a record that is over only says nobody held it", () => {
    render(<CommanderFactValue members={[]} roleName="Incident Commander" />);

    expect(screen.getByText("Not assigned")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
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

  test("says None, and offers Add owners while the record is open", () => {
    render(
      <OwnersFactValue
        owners={[]}
        ownersRoute={OWNERS_ROUTE}
        canAddOwners={true}
      />,
    );

    expect(screen.getByText("None")).toBeVisible();

    // Visibly "Add" beside "None"; heard on its own as "Add owners".
    const add: HTMLElement = screen.getByRole("link", { name: "Add owners" });

    expect(add).toHaveAttribute("href", OWNERS_ROUTE.toString());
    expect(within(add).getByText("Add")).toHaveAttribute("aria-hidden", "true");
  });

  test("a record that is over only says None", () => {
    render(<OwnersFactValue owners={[]} ownersRoute={OWNERS_ROUTE} />);

    expect(screen.getByText("None")).toBeVisible();
    expect(screen.queryByRole("link")).toBeNull();
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
    const fact: EventStatusFact | null = getOwnersFact({
      owners: [],
      ownersRoute: OWNERS_ROUTE,
      canAddOwners: true,
    });
    const view: RenderResult = render(<>{fact!.value}</>);

    expect(view.container).toHaveTextContent("None");
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

  test("Not assigned, and Assign heard with the role's name as the header shows it", async () => {
    const german: i18n = await createGerman();

    render(
      <I18nextProvider i18n={german}>
        <CommanderFactValue
          members={[]}
          roleName="Incident Commander"
          onAssign={(): void => {}}
        />
      </I18nextProvider>,
    );

    expect(screen.getByText("Nicht zugewiesen")).toBeVisible();

    const assign: HTMLElement = screen.getByRole("button", {
      name: "Vorfall-Kommandant zuweisen",
    });

    expect(assign).toHaveTextContent("Zuweisen");
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

  test("None, and Add heard as Add owners", async () => {
    const german: i18n = await createGerman();

    render(
      <I18nextProvider i18n={german}>
        <OwnersFactValue
          owners={[]}
          ownersRoute={OWNERS_ROUTE}
          canAddOwners={true}
        />
      </I18nextProvider>,
    );

    expect(screen.getByText("Keine")).toBeVisible();

    const add: HTMLElement = screen.getByRole("link", {
      name: "Eigentümer hinzufügen",
    });

    expect(add).toHaveAttribute("href", OWNERS_ROUTE.toString());
    expect(screen.getByTestId("event-owners-add")).toHaveTextContent(
      "HinzufügenEigentümer hinzufügen",
    );
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
});
