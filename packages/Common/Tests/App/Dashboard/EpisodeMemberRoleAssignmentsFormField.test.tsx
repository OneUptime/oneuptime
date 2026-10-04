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
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An incident grouping rule's "Episode Role Assignments": who the rule puts
 * in each role of the episodes it opens. It was a copy of the declare form's
 * role picker that tagged roles "Primary" and "Multiple" of its own; now it
 * is that picker (IncidentRoleFormField), wrapped to keep what the rule
 * stores - one { userId, incidentRoleId } row per person, as strings, which
 * IncidentGroupingEngineService reads when it opens an episode - and its
 * props, so the grouping rule form hands it what it always did.
 *
 * The real field and picker, with the network stubbed: the roles and the
 * project's people.
 */

configure({ asyncUtilTimeout: 10000 });

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const COMMANDER_ID: string = "22222222-2222-4222-8222-000000000001";
const SCRIBE_ID: string = "22222222-2222-4222-8222-000000000003";
const ALICE_ID: string = "33333333-3333-4333-8333-000000000001";
const BOB_ID: string = "33333333-3333-4333-8333-000000000002";
const CAROL_ID: string = "33333333-3333-4333-8333-000000000003";

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

import EpisodeMemberRoleAssignmentsFormField, {
  EpisodeMemberRoleAssignmentsFormFieldProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentGroupingRule/EpisodeMemberRoleAssignmentsFormField";
import { INCIDENT_ROLE_CHOICE_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Components/IncidentRole/IncidentRoleAssignments";
import { EpisodeMemberRoleAssignment } from "../../../Models/DatabaseModels/IncidentGroupingRule";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import Color from "../../../Types/Color";

interface RoleRow {
  id: string;
  name: string;
  isPrimaryRole: boolean;
  canAssignMultipleUsers: boolean;
}

// The roles as the server lists them: by name, Incident Commander not first.
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

let changes: Array<Array<EpisodeMemberRoleAssignment>> = [];

async function renderField(
  props?: Partial<EpisodeMemberRoleAssignmentsFormFieldProps>,
): Promise<UserEvent> {
  await act(async (): Promise<void> => {
    render(
      <EpisodeMemberRoleAssignmentsFormField
        onChange={(value: Array<EpisodeMemberRoleAssignment>) => {
          changes.push(value);
        }}
        {...props}
      />,
    );
  });

  await screen.findAllByTestId("incident-role-card");

  return userEvent.setup({ delay: null });
}

function cardOf(roleName: string): HTMLElement {
  const card: HTMLElement | undefined = screen
    .getAllByTestId("incident-role-card")
    .find((candidate: HTMLElement): boolean => {
      return within(candidate).queryByText(roleName) !== null;
    });

  expect(card).toBeDefined();

  return card!;
}

async function pick(
  user: UserEvent,
  roleName: string,
  personName: string,
): Promise<void> {
  await user.click(
    within(cardOf(roleName)).getByRole("combobox", { name: roleName }),
  );
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
    { value: CAROL_ID, label: "Carol" },
  ] as never);
  answerRoles([
    {
      id: SCRIBE_ID,
      name: "Scribe",
      isPrimaryRole: false,
      canAssignMultipleUsers: true,
    },
    {
      id: COMMANDER_ID,
      name: "Incident Commander",
      isPrimaryRole: true,
      canAssignMultipleUsers: false,
    },
  ]);
});

afterEach(() => {
  cleanup();
});

describe("a grouping rule's episode role assignments", () => {
  test("are the declare form's role cards: primary first and tagged Primary, with no Multiple tag", async () => {
    await renderField();

    const cards: Array<HTMLElement> =
      screen.getAllByTestId("incident-role-card");

    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText("Incident Commander")).toBeTruthy();
    expect(within(cards[0]!).getByText("Primary")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("Scribe")).toBeTruthy();
    expect(within(cards[1]!).queryByText("Primary")).toBeNull();
    expect(screen.queryByText(/Multiple/)).toBeNull();
    // The copy's own placeholder, glued to the role's name, is gone.
    expect(screen.queryByText(/Select user for/)).toBeNull();
  });

  test("read the project's roles the way the picker reads them, once", async () => {
    await renderField();

    const roleReads: Array<Array<unknown>> = getListMock.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType?: unknown } | undefined)?.modelType ===
          IncidentRole
        );
      },
    );

    expect(roleReads).toHaveLength(1);
    expect(roleReads[0]![0]).toEqual(
      expect.objectContaining({ select: INCIDENT_ROLE_CHOICE_SELECT }),
    );
    expect(fetchUsersMock).toHaveBeenCalledTimes(1);
  });

  test("show the people the rule already names, each under their role", async () => {
    await renderField({
      initialValue: [
        { userId: ALICE_ID, incidentRoleId: SCRIBE_ID },
        { userId: BOB_ID, incidentRoleId: COMMANDER_ID },
        { userId: CAROL_ID, incidentRoleId: SCRIBE_ID },
      ],
    });

    expect(within(cardOf("Scribe")).getByText("Alice")).toBeInTheDocument();
    expect(within(cardOf("Scribe")).getByText("Carol")).toBeInTheDocument();
    expect(
      within(cardOf("Incident Commander")).getByText("Bob"),
    ).toBeInTheDocument();
    expect(changes).toEqual([]);
  });

  test("picking someone saves one { userId, incidentRoleId } row per person, as strings", async () => {
    const user: UserEvent = await renderField({
      initialValue: [{ userId: ALICE_ID, incidentRoleId: SCRIBE_ID }],
    });

    await pick(user, "Scribe", "Carol");
    await pick(user, "Incident Commander", "Bob");

    expect(changes[changes.length - 1]).toEqual([
      { userId: ALICE_ID, incidentRoleId: SCRIBE_ID },
      { userId: CAROL_ID, incidentRoleId: SCRIBE_ID },
      { userId: BOB_ID, incidentRoleId: COMMANDER_ID },
    ]);
  });

  test("removing someone drops their row, and only theirs", async () => {
    const user: UserEvent = await renderField({
      initialValue: [
        { userId: ALICE_ID, incidentRoleId: SCRIBE_ID },
        { userId: CAROL_ID, incidentRoleId: SCRIBE_ID },
        { userId: BOB_ID, incidentRoleId: COMMANDER_ID },
      ],
    });

    await user.click(
      within(cardOf("Scribe")).getByRole("button", {
        name: "Remove Alice from Scribe",
      }),
    );

    expect(changes[changes.length - 1]).toEqual([
      { userId: CAROL_ID, incidentRoleId: SCRIBE_ID },
      { userId: BOB_ID, incidentRoleId: COMMANDER_ID },
    ]);
  });

  test("a role that takes one person drops its picker once it has one", async () => {
    const user: UserEvent = await renderField();

    await pick(user, "Incident Commander", "Alice");

    const commander: HTMLElement = cardOf("Incident Commander");

    expect(within(commander).queryByRole("combobox")).toBeNull();
    expect(
      within(commander).getByText(
        "Only one user can be assigned to this role.",
      ),
    ).toBeInTheDocument();
    // The role that takes several keeps its picker.
    expect(
      within(cardOf("Scribe")).getByRole("combobox", { name: "Scribe" }),
    ).toBeInTheDocument();
  });

  test("show the form's error under the cards", async () => {
    await renderField({ error: "Pick someone for Incident Commander." });

    expect(
      screen.getByText("Pick someone for Incident Commander."),
    ).toBeInTheDocument();
  });

  test("with no roles in the project, say so", async () => {
    answerRoles([]);

    await act(async (): Promise<void> => {
      render(<EpisodeMemberRoleAssignmentsFormField />);
    });

    expect(
      await screen.findByText("No incident roles found."),
    ).toBeInTheDocument();
  });
});
