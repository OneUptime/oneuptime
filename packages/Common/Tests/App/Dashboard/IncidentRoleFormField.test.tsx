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
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The roles step of Declare Incident and Create Incident Episode: one card
 * per incident role, with a picker for who takes it.
 *
 * New projects have one role, Incident Commander, and whoever declares an
 * incident takes it when nobody is picked for it - the roles marked Primary.
 * So the card tags the primary roles, and the step's help says what the
 * tag means. The "Multiple" tag went: a role that takes several people
 * keeps its picker after the first pick, and a role that takes one says so
 * once it has one, which is all the tag ever told. Its text, the picker's
 * placeholder and the remove button's name are looked up in the reader's
 * language (each string here comes back wrapped in «», as a translation
 * would come back different from the English).
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
        const ObjectIDClass: { new (id: string): unknown } =
          jest.requireActual<{ default: { new (id: string): unknown } }>(
            "../../../Types/ObjectID",
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
    "No incident roles found.",
    "Remove",
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
  RoleAssignment,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentRoleFormField";
import IncidentEpisodeRoleFormField from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentEpisode/IncidentEpisodeRoleFormField";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import Color from "../../../Types/Color";

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

  test("removing a person, by a button named in the reader's language, gives the picker back", async () => {
    const { user } = await renderField();

    await screen.findByText("Incident Commander");
    await pick(user, cardOf("Incident Commander"), "Alice");

    await user.click(
      within(cardOf("Incident Commander")).getByRole("button", {
        name: "«Remove»",
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

  test("with no roles at all, says so in the reader's language", async () => {
    answerRoles([]);

    await renderField();

    expect(
      await screen.findByText("«No incident roles found.»"),
    ).toBeInTheDocument();
  });

  test("reads the project's roles once, with what the cards show", async () => {
    await renderField();

    await screen.findByText("Incident Commander");

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(getListMock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        modelType: IncidentRole,
        select: expect.objectContaining({
          name: true,
          isPrimaryRole: true,
          canAssignMultipleUsers: true,
        }),
      }),
    );
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
