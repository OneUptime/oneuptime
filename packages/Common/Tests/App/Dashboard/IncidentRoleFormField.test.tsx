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
  configure,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The one incident role picker: the roles step of Declare Incident and
 * Create Incident Episode, and - through their adapters - a monitor rule's
 * incident roles and a grouping rule's episode roles. One card per incident
 * role, with a picker for who takes it.
 *
 * New projects have one role, Incident Commander, and whoever declares an
 * incident takes it when nobody is picked for it - the roles marked Primary.
 * So the card tags the primary roles, and the step's help says what the
 * tag means. The "Multiple" tag went: a role that takes several people
 * keeps its picker after the first pick, and a role that takes one says so
 * once it has one, which is all the tag ever told. Its text, the picker's
 * placeholder and the remove button's name are looked up in the reader's
 * language (each string here comes back wrapped in «», as a translation
 * would come back different from the English). Each picker is named by its
 * role, and each remove button by the person and the role.
 *
 * A form that has the roles and the people already (the monitor criteria
 * read them once for every rule) hands them in, and the picker reads
 * neither again.
 *
 * The real component, with the network stubbed: the roles and the project's
 * people.
 */

configure({ asyncUtilTimeout: 10000 });

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const COMMANDER_ID: string = "22222222-2222-4222-8222-000000000001";
const RESPONDER_ID: string = "22222222-2222-4222-8222-000000000002";
const ALICE_ID: string = "33333333-3333-4333-8333-000000000001";
const BOB_ID: string = "33333333-3333-4333-8333-000000000002";

const getListMock: MockFunction = getJestMockFunction();
const fetchUsersMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/ProjectUser", () => {
  return {
    __esModule: true,
    default: {
      fetchProjectUsersAsDropdownOptions: (
        ...args: Array<unknown>
      ): unknown => {
        return fetchUsersMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        // Required here: jest.mock factories run before the imports below.
        const ObjectIDClass: { new (id: string): unknown } = (
          jest.requireActual("../../../Types/ObjectID") as {
            default: { new (id: string): unknown };
          }
        ).default;
        return new ObjectIDClass(PROJECT_ID);
      },
    },
  };
});

/*
 * The picker's own words come back marked, as a translation would come back
 * different from the English, so a test can tell they were looked up. What
 * the reader typed - role names, people's names - has no translation and
 * comes back as it is, as it does in every locale.
 */
jest.mock("../../../UI/Utils/Translation", () => {
  const COPY: Array<string> = [
    "Primary",
    "Select User",
    "Unknown User",
    "Only one user can be assigned to this role.",
    "No incident roles defined. Go to Incidents → Settings → Incident Roles to create roles first.",
    "Remove {{member}} from {{role}}",
    "Unknown Role",
    "Project not found",
  ];

  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value !== undefined && COPY.includes(value)
            ? `«${value}»`
            : value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import IncidentRoleFormField, {
  IncidentRoleChoice,
  RoleAssignment,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentRoleFormField";
import IncidentEpisodeRoleFormField from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisodeRoleFormField";
import { INCIDENT_ROLE_CHOICE_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentRole/IncidentRoleAssignments";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";

interface RoleRow {
  id: string;
  name: string;
  isPrimaryRole: boolean;
  canAssignMultipleUsers: boolean;
}

const COMMANDER: RoleRow = {
  id: COMMANDER_ID,
  name: "Incident Commander",
  isPrimaryRole: true,
  canAssignMultipleUsers: false,
};

const RESPONDER: RoleRow = {
  id: RESPONDER_ID,
  name: "Responder",
  isPrimaryRole: false,
  canAssignMultipleUsers: true,
};

function answerRoles(rows: Array<RoleRow>): void {
  getListMock.mockImplementation((() => {
    const roles: Array<IncidentRole> = rows.map((row: RoleRow) => {
      const role: IncidentRole = new IncidentRole();
      role._id = row.id;
      role.name = row.name;
      role.isPrimaryRole = row.isPrimaryRole;
      role.canAssignMultipleUsers = row.canAssignMultipleUsers;
      role.color = new Color("#6366f1");
      return role;
    });

    return Promise.resolve({
      data: roles,
      count: roles.length,
      skip: 0,
      limit: roles.length,
    });
  }) as never);
}

let changes: Array<Array<RoleAssignment>> = [];

async function renderField(
  Component: typeof IncidentRoleFormField = IncidentRoleFormField,
): Promise<{ user: UserEvent; result: RenderResult }> {
  let result: RenderResult | null = null;

  await act(async (): Promise<void> => {
    result = render(
      <Component
        onChange={(assignments: Array<RoleAssignment>) => {
          changes.push(assignments);
        }}
      />,
    );
  });

  return { user: userEvent.setup({ delay: null }), result: result! };
}

// The card that holds a role, found by the role's name.
function cardOf(roleName: string): HTMLElement {
  const name: HTMLElement = screen.getByText(roleName);
  const card: HTMLElement | null = name.closest(".rounded-lg");

  expect(card).not.toBeNull();

  return card as HTMLElement;
}

// react-select opens on a click; its options are portalled to the body.
async function pick(
  user: UserEvent,
  card: HTMLElement,
  personName: string,
): Promise<void> {
  await user.click(within(card).getByRole("combobox"));
  const options: Array<HTMLElement> = await screen.findAllByText(personName, {
    exact: true,
  });
  await user.click(options[options.length - 1]!);
}

beforeEach(() => {
  changes = [];
  getListMock.mockReset();
  fetchUsersMock.mockReset();
  fetchUsersMock.mockResolvedValue([
    { value: ALICE_ID, label: "Alice" },
    { value: BOB_ID, label: "Bob" },
  ] as never);
  answerRoles([RESPONDER, COMMANDER]);
});

afterEach(() => {
  cleanup();
});

describe("the incident roles picker", () => {
  test("lists the primary roles first, tagged Primary in the reader's language", async () => {
    await renderField();

    await screen.findByText("Incident Commander");

    const names: Array<string> = ["Incident Commander", "Responder"];
    const cards: Array<HTMLElement> = names.map(cardOf);

    // Primary first, whatever order the roles arrive in.
    expect(
      cards[0]!.compareDocumentPosition(cards[1]!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(within(cards[0]!).getByText("«Primary»")).toBeInTheDocument();
    expect(within(cards[1]!).queryByText("«Primary»")).toBeNull();
  });

  test("tags no role Multiple, not even one that takes several people", async () => {
    await renderField();

    await screen.findByText("Responder");

    expect(screen.queryByText(/Multiple/)).toBeNull();
  });

  test("asks for a person with a looked-up placeholder, not one glued to the role's name", async () => {
    await renderField();

    const card: HTMLElement = cardOf(
      (await screen.findByText("Incident Commander")).textContent || "",
    );

    expect(within(card).getByText("«Select User»")).toBeInTheDocument();
    expect(screen.queryByText(/Select user for/)).toBeNull();
  });

  test("a role that takes one person: picking someone takes the picker away and says why", async () => {
    const { user } = await renderField();

    await screen.findByText("Incident Commander");
    await pick(user, cardOf("Incident Commander"), "Alice");

    const card: HTMLElement = cardOf("Incident Commander");

    expect(within(card).getByText("Alice")).toBeInTheDocument();
    expect(within(card).queryByRole("combobox")).toBeNull();
    expect(
      within(card).getByText("«Only one user can be assigned to this role.»"),
    ).toBeInTheDocument();
    expect(changes[changes.length - 1]).toEqual([
      { roleId: COMMANDER_ID, userIds: [ALICE_ID] },
    ]);
  });

  test("a role that takes several people keeps its picker, without the people already picked", async () => {
    const { user } = await renderField();

    await screen.findByText("Responder");
    await pick(user, cardOf("Responder"), "Alice");

    const card: HTMLElement = cardOf("Responder");

    expect(within(card).getByRole("combobox")).toBeInTheDocument();
    expect(
      within(card).queryByText("«Only one user can be assigned to this role.»"),
    ).toBeNull();

    await user.click(within(card).getByRole("combobox"));

    // Bob is still on offer; Alice, picked already, is not.
    const offered: Array<string> = (await screen.findAllByRole("option")).map(
      (option: HTMLElement): string => {
        return option.textContent || "";
      },
    );

    expect(offered).toEqual(["Bob"]);
    expect(within(card).getAllByText("Alice")).toHaveLength(1);
  });

  test("removing a person, by a button that names them and the role in the reader's language, gives the picker back", async () => {
    const { user } = await renderField();

    await screen.findByText("Incident Commander");
    await pick(user, cardOf("Incident Commander"), "Alice");

    await user.click(
      within(cardOf("Incident Commander")).getByRole("button", {
        name: "«Remove Alice from Incident Commander»",
      }),
    );

    const card: HTMLElement = cardOf("Incident Commander");

    expect(within(card).queryByText("Alice")).toBeNull();
    expect(within(card).getByRole("combobox")).toBeInTheDocument();
    expect(changes[changes.length - 1]).toEqual([]);
  });

  test("a person who is no longer in the project is named Unknown User, in the reader's language", async () => {
    let result: RenderResult | null = null;

    await act(async (): Promise<void> => {
      result = render(
        <IncidentRoleFormField
          initialValue={[
            {
              roleId: COMMANDER_ID,
              userIds: ["33333333-3333-4333-8333-000000000099"],
            },
          ]}
        />,
      );
    });

    await screen.findByText("Incident Commander");

    expect(
      within(result!.container).getByText("«Unknown User»"),
    ).toBeInTheDocument();
  });

  test("with no roles at all, says where roles are made, in the reader's language", async () => {
    answerRoles([]);

    await renderField();

    expect(
      await screen.findByText(
        "«No incident roles defined. Go to Incidents → Settings → Incident Roles to create roles first.»",
      ),
    ).toBeInTheDocument();
  });

  test("reads the roles and the people at the same time, not one after the other", async () => {
    let answerTheRoles: () => void = (): void => {};

    getListMock.mockImplementation((() => {
      return new Promise((resolve: (value: unknown) => void) => {
        answerTheRoles = (): void => {
          resolve({ data: [], count: 0, skip: 0, limit: 0 });
        };
      });
    }) as never);

    await act(async (): Promise<void> => {
      render(<IncidentRoleFormField />);
    });

    // The people are asked for while the roles are still on their way.
    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(fetchUsersMock).toHaveBeenCalledTimes(1);

    await act(async (): Promise<void> => {
      answerTheRoles();
    });
  });

  test("reads the project's roles once, with what the cards show", async () => {
    await renderField();

    await screen.findByText("Incident Commander");

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(getListMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        modelType: IncidentRole,
        select: INCIDENT_ROLE_CHOICE_SELECT,
      }),
    );
    expect(INCIDENT_ROLE_CHOICE_SELECT).toEqual(
      expect.objectContaining({
        name: true,
        roleIcon: true,
        isPrimaryRole: true,
        canAssignMultipleUsers: true,
      }),
    );
    expect(fetchUsersMock).toHaveBeenCalledTimes(1);
  });

  test("names each role's picker by the role, for a screen reader", async () => {
    await renderField();

    await screen.findByText("Incident Commander");

    expect(
      within(cardOf("Incident Commander")).getByRole("combobox", {
        name: "Incident Commander",
      }),
    ).toBeInTheDocument();
    expect(
      within(cardOf("Responder")).getByRole("combobox", {
        name: "Responder",
      }),
    ).toBeInTheDocument();
  });

  test("starts from the value it is given, and adds a role picked for the first time after it", async () => {
    let result: RenderResult | null = null;

    await act(async (): Promise<void> => {
      result = render(
        <IncidentRoleFormField
          initialValue={[{ roleId: RESPONDER_ID, userIds: [ALICE_ID, BOB_ID] }]}
          onChange={(assignments: Array<RoleAssignment>) => {
            changes.push(assignments);
          }}
        />,
      );
    });

    await screen.findByText("Incident Commander");

    const responder: HTMLElement = cardOf("Responder");

    expect(within(responder).getByText("Alice")).toBeInTheDocument();
    expect(within(responder).getByText("Bob")).toBeInTheDocument();
    expect(changes).toHaveLength(0);

    const user: UserEvent = userEvent.setup({ delay: null });

    await pick(user, cardOf("Incident Commander"), "Bob");

    expect(changes).toEqual([
      [
        { roleId: RESPONDER_ID, userIds: [ALICE_ID, BOB_ID] },
        { roleId: COMMANDER_ID, userIds: [BOB_ID] },
      ],
    ]);

    expect(result).not.toBeNull();
  });

  test("says why when the roles cannot be read", async () => {
    getListMock.mockImplementation((() => {
      return Promise.reject(new Error("The roles could not be read."));
    }) as never);

    await renderField();

    expect(
      await screen.findByText("The roles could not be read."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("a form that has the roles and the people already", () => {
  const ROLES: Array<IncidentRoleChoice> = [
    {
      id: RESPONDER_ID,
      name: "Responder",
      color: "#0891b2",
      canAssignMultipleUsers: true,
    },
    {
      id: COMMANDER_ID,
      name: "Incident Commander",
      color: "#7c3aed",
      icon: IconProp.ShieldCheck,
      isPrimaryRole: true,
      canAssignMultipleUsers: false,
    },
  ];

  const USERS: Array<{ value: string; label: string }> = [
    { value: ALICE_ID, label: "Alice" },
    { value: BOB_ID, label: "Bob" },
  ];

  async function renderWith(
    props: Partial<React.ComponentProps<typeof IncidentRoleFormField>>,
  ): Promise<UserEvent> {
    await act(async (): Promise<void> => {
      render(
        <IncidentRoleFormField
          onChange={(assignments: Array<RoleAssignment>) => {
            changes.push(assignments);
          }}
          {...props}
        />,
      );
    });

    return userEvent.setup({ delay: null });
  }

  test("reads neither, and draws the roles it is handed, primary first, with no loader", async () => {
    await renderWith({ roles: ROLES, users: USERS });

    // Drawn on the first render: nothing to wait for.
    const cards: Array<HTMLElement> =
      screen.getAllByTestId("incident-role-card");

    expect(
      cards.map((card: HTMLElement): string => {
        return card.textContent || "";
      }),
    ).toEqual([
      expect.stringContaining("Incident Commander"),
      expect.stringContaining("Responder"),
    ]);
    expect(within(cards[0]!).getByText("«Primary»")).toBeInTheDocument();
    expect(screen.queryByText(/Multiple/)).toBeNull();

    expect(getListMock).not.toHaveBeenCalled();
    expect(fetchUsersMock).not.toHaveBeenCalled();
  });

  test("offers the people it is handed, and tells the form who was picked", async () => {
    const user: UserEvent = await renderWith({ roles: ROLES, users: USERS });

    await pick(user, cardOf("Responder"), "Bob");
    await pick(user, cardOf("Responder"), "Alice");

    expect(changes[changes.length - 1]).toEqual([
      { roleId: RESPONDER_ID, userIds: [BOB_ID, ALICE_ID] },
    ]);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("handed only the roles, it reads only the people", async () => {
    await renderWith({ roles: ROLES });

    await screen.findByText("Incident Commander");

    expect(getListMock).not.toHaveBeenCalled();
    expect(fetchUsersMock).toHaveBeenCalledTimes(1);
  });

  test("handed only the people, it reads only the roles", async () => {
    await renderWith({ users: USERS });

    await screen.findByText("Incident Commander");

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(fetchUsersMock).not.toHaveBeenCalled();
  });

  test("handed no roles at all, says where roles are made", async () => {
    await renderWith({ roles: [], users: USERS });

    expect(
      screen.getByText(
        "«No incident roles defined. Go to Incidents → Settings → Incident Roles to create roles first.»",
      ),
    ).toBeInTheDocument();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a role without a name is called Unknown Role, on its card, its picker and its remove buttons", async () => {
    const user: UserEvent = await renderWith({
      roles: [{ id: RESPONDER_ID, name: "", canAssignMultipleUsers: true }],
      users: USERS,
      initialValue: [{ roleId: RESPONDER_ID, userIds: [ALICE_ID] }],
    });

    const card: HTMLElement = screen.getByTestId("incident-role-card");

    expect(within(card).getByText("«Unknown Role»")).toBeInTheDocument();
    expect(
      within(card).getByRole("combobox", { name: "«Unknown Role»" }),
    ).toBeInTheDocument();

    await user.click(
      within(card).getByRole("button", {
        name: "«Remove Alice from «Unknown Role»»",
      }),
    );

    expect(changes[changes.length - 1]).toEqual([]);
  });

  test("a role the project no longer has is dropped from the value at the next change", async () => {
    const DELETED_ROLE_ID: string = "22222222-2222-4222-8222-000000000099";
    const user: UserEvent = await renderWith({
      roles: ROLES,
      users: USERS,
      initialValue: [
        { roleId: DELETED_ROLE_ID, userIds: [ALICE_ID] },
        { roleId: RESPONDER_ID, userIds: [BOB_ID] },
      ],
    });

    // No card shows it, so nobody could take it off.
    expect(screen.getAllByTestId("incident-role-card")).toHaveLength(2);

    await pick(user, cardOf("Incident Commander"), "Alice");

    expect(changes[changes.length - 1]).toEqual([
      { roleId: RESPONDER_ID, userIds: [BOB_ID] },
      { roleId: COMMANDER_ID, userIds: [ALICE_ID] },
    ]);
  });

  test("two changes that land before the picker draws again both count", async () => {
    await renderWith({
      roles: ROLES,
      users: USERS,
      initialValue: [{ roleId: RESPONDER_ID, userIds: [ALICE_ID, BOB_ID] }],
    });

    const responder: HTMLElement = cardOf("Responder");
    const removeAlice: HTMLElement = within(responder).getByRole("button", {
      name: "«Remove Alice from Responder»",
    });
    const removeBob: HTMLElement = within(responder).getByRole("button", {
      name: "«Remove Bob from Responder»",
    });

    // One batch: React draws once, after both clicks.
    act(() => {
      removeAlice.click();
      removeBob.click();
    });

    expect(changes).toEqual([
      [{ roleId: RESPONDER_ID, userIds: [BOB_ID] }],
      [],
    ]);
    expect(within(cardOf("Responder")).queryByText("Alice")).toBeNull();
    expect(within(cardOf("Responder")).queryByText("Bob")).toBeNull();
  });
});

describe("telling the form", () => {
  /*
   * A form that keeps the picker's value in its own state, as the monitor
   * criteria and the grouping rule do. The picker tells it from the pick
   * itself - not from inside a state update, which React may run while it
   * renders ("Cannot update a component while rendering a different
   * component") - once per pick, with the whole list, Strict Mode or not.
   */
  const Host: () => ReactElement = (): ReactElement => {
    const [value, setValue] = useState<Array<RoleAssignment>>([]);

    return (
      <div>
        <p data-testid="host-value">{JSON.stringify(value)}</p>
        <IncidentRoleFormField
          onChange={(assignments: Array<RoleAssignment>) => {
            changes.push(assignments);
            setValue(assignments);
          }}
        />
      </div>
    );
  };

  test("once per pick, with the whole list, to a form that keeps it in its own state", async () => {
    const consoleError: ReturnType<typeof jest.spyOn> = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    let errors: Array<string> = [];

    try {
      await act(async (): Promise<void> => {
        // Strict Mode runs a state update twice: a pick must still tell once.
        render(
          <React.StrictMode>
            <Host />
          </React.StrictMode>,
        );
      });

      await screen.findByText("Incident Commander");

      const user: UserEvent = userEvent.setup({ delay: null });

      await pick(user, cardOf("Responder"), "Alice");
      await pick(user, cardOf("Incident Commander"), "Bob");

      await user.click(
        within(cardOf("Responder")).getByRole("button", {
          name: "«Remove Alice from Responder»",
        }),
      );
    } finally {
      errors = consoleError.mock.calls.map((args: Array<unknown>): string => {
        return args.map(String).join(" ");
      });
      consoleError.mockRestore();
    }

    expect(changes).toEqual([
      [{ roleId: RESPONDER_ID, userIds: [ALICE_ID] }],
      [
        { roleId: RESPONDER_ID, userIds: [ALICE_ID] },
        { roleId: COMMANDER_ID, userIds: [BOB_ID] },
      ],
      [{ roleId: COMMANDER_ID, userIds: [BOB_ID] }],
    ]);
    expect(screen.getByTestId("host-value")).toHaveTextContent(
      JSON.stringify([{ roleId: COMMANDER_ID, userIds: [BOB_ID] }]),
    );
    expect(
      errors.filter((message: string): boolean => {
        return message.includes("Cannot update a component");
      }),
    ).toEqual([]);
  });
});

describe("the incident episode roles picker", () => {
  test("is the incident's picker, cards and all", async () => {
    const { user } = await renderField(IncidentEpisodeRoleFormField);

    await screen.findByText("Incident Commander");

    expect(
      within(cardOf("Incident Commander")).getByText("«Primary»"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Multiple/)).toBeNull();

    await pick(user, cardOf("Incident Commander"), "Bob");

    expect(changes[changes.length - 1]).toEqual([
      { roleId: COMMANDER_ID, userIds: [BOB_ID] },
    ]);
  });
});
