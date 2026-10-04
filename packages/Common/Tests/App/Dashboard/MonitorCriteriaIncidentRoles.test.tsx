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
 * A monitor rule's incident names who takes each incident role ("Incident
 * Roles", folded in the rule's incident). It drew a dropdown of its own for
 * each role - a multi-select tagged "Multiple" with "Assign multiple users
 * to the Responder role" for some, a single select for the rest. Now it is
 * the declare form's role picker (IncidentRoleFormField): one card per
 * role, primary first and tagged Primary, the people picked as chips, and a
 * picker for one more while the role takes one.
 *
 * What the rule saves is unchanged: one { roleId, userId } row per person,
 * as ObjectIDs (CriteriaIncident.incidentMemberRoles), which MonitorIncident
 * reads when the rule declares an incident. And the picker reads no roles or
 * people of its own: the monitor form reads them once for every rule
 * (MonitorSteps) and hands them down.
 *
 * The real form and picker; the network is stubbed only to prove it is not
 * used.
 */

configure({ asyncUtilTimeout: 10000 });

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

import MonitorCriteriaIncidentForm, {
  IncidentRoleOption,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MonitorCriteriaIncidentForm";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import IconProp from "../../../Types/Icon/IconProp";
import {
  CriteriaIncident,
  IncidentMemberRoleAssignment,
} from "../../../Types/Monitor/CriteriaIncident";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

const COMMANDER_ID: string = "22222222-2222-4222-8222-000000000001";
const RESPONDER_ID: string = "22222222-2222-4222-8222-000000000002";
const ALICE_ID: string = "33333333-3333-4333-8333-000000000001";
const BOB_ID: string = "33333333-3333-4333-8333-000000000002";
const CAROL_ID: string = "33333333-3333-4333-8333-000000000003";

// As MonitorSteps reads them: in its order, Incident Commander first.
const ROLES: Array<IncidentRoleOption> = [
  {
    id: COMMANDER_ID,
    name: "Incident Commander",
    color: "#7c3aed",
    icon: IconProp.ShieldCheck,
    isPrimaryRole: true,
    canAssignMultipleUsers: false,
  },
  {
    id: RESPONDER_ID,
    name: "Responder",
    color: "#0891b2",
    isPrimaryRole: false,
    canAssignMultipleUsers: true,
  },
];

const USERS: Array<DropdownOption> = [
  { value: ALICE_ID, label: "Alice" },
  { value: BOB_ID, label: "Bob" },
  { value: CAROL_ID, label: "Carol" },
];

function row(roleId: string, userId: string): IncidentMemberRoleAssignment {
  return { roleId: new ObjectID(roleId), userId: new ObjectID(userId) };
}

let changes: Array<CriteriaIncident> = [];

async function renderRule(options?: {
  rows?: Array<IncidentMemberRoleAssignment> | undefined;
  roles?: Array<IncidentRoleOption> | undefined;
}): Promise<UserEvent> {
  const initialValue: CriteriaIncident = {
    id: "rule-incident",
    title: "{{monitorName}} is down",
    description: "",
    incidentSeverityId: undefined,
  };

  if (options?.rows) {
    initialValue.incidentMemberRoles = options.rows;
  }

  await act(async (): Promise<void> => {
    render(
      <MonitorCriteriaIncidentForm
        initialValue={initialValue}
        onChange={(value: CriteriaIncident) => {
          changes.push(value);
        }}
        incidentSeverityDropdownOptions={[]}
        onCallPolicyDropdownOptions={[]}
        labelDropdownOptions={[]}
        userDropdownOptions={USERS}
        incidentRoleOptions={options?.roles ?? ROLES}
      />,
    );
  });

  return userEvent.setup({ delay: null });
}

function rolesSection(): HTMLElement {
  return screen.getByTestId("criteria-incident-roles");
}

function sectionHeader(): HTMLElement {
  return within(rolesSection()).getByTestId("folded-section-header");
}

async function openRoles(user: UserEvent): Promise<void> {
  if (sectionHeader().getAttribute("aria-expanded") !== "true") {
    await user.click(sectionHeader());
  }
}

// The card of a role, found by the role's name.
function cardOf(roleName: string): HTMLElement {
  const card: HTMLElement | undefined = within(rolesSection())
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

// The rows the rule would save now, as plain strings.
function savedRows(): Array<{ roleId: string; userId: string }> {
  const latest: CriteriaIncident | undefined = changes[changes.length - 1];

  return (latest?.incidentMemberRoles || []).map(
    (
      saved: IncidentMemberRoleAssignment,
    ): { roleId: string; userId: string } => {
      expect(saved.roleId).toBeInstanceOf(ObjectID);
      expect(saved.userId).toBeInstanceOf(ObjectID);

      return {
        roleId: saved.roleId.toString(),
        userId: saved.userId.toString(),
      };
    },
  );
}

beforeEach(() => {
  changes = [];
  getListMock.mockReset();
  fetchUsersMock.mockReset();
  getListMock.mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  } as never);
  fetchUsersMock.mockResolvedValue([] as never);
});

afterEach(() => {
  cleanup();
});

describe("a monitor rule's incident roles", () => {
  test("are the declare form's role cards: primary first and tagged Primary, with no Multiple tag", async () => {
    const user: UserEvent = await renderRule();

    await openRoles(user);

    const cards: Array<HTMLElement> =
      within(rolesSection()).getAllByTestId("incident-role-card");

    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText("Incident Commander")).toBeTruthy();
    expect(within(cards[0]!).getByText("Primary")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("Responder")).toBeTruthy();
    expect(within(cards[1]!).queryByText("Primary")).toBeNull();

    // The old per-role dropdowns and their copy are gone.
    expect(screen.queryByText(/Multiple/)).toBeNull();
    expect(screen.queryByText(/Assign multiple users to/)).toBeNull();
    expect(screen.queryByText(/Assign a user to/)).toBeNull();
    expect(screen.queryByText(/^Select Responder/)).toBeNull();
  });

  test("still says what the section is for", async () => {
    const user: UserEvent = await renderRule();

    await openRoles(user);

    expect(
      within(rolesSection()).getByText(
        "Optionally assign users to incident roles. These users will be automatically assigned when the incident is created.",
      ),
    ).toBeInTheDocument();
  });

  test("shows the people the rule already names, each under their role, with the section open", async () => {
    await renderRule({
      rows: [
        row(RESPONDER_ID, ALICE_ID),
        row(COMMANDER_ID, BOB_ID),
        row(RESPONDER_ID, CAROL_ID),
      ],
    });

    expect(sectionHeader()).toHaveAttribute("aria-expanded", "true");

    const responder: HTMLElement = cardOf("Responder");
    const commander: HTMLElement = cardOf("Incident Commander");

    expect(within(responder).getByText("Alice")).toBeInTheDocument();
    expect(within(responder).getByText("Carol")).toBeInTheDocument();
    expect(within(commander).getByText("Bob")).toBeInTheDocument();
    expect(within(commander).queryByText("Alice")).toBeNull();
  });

  test("folds while nobody is named", async () => {
    await renderRule();

    expect(sectionHeader()).toHaveAttribute("aria-expanded", "false");
  });

  test("picking someone saves one { roleId, userId } row per person, as ObjectIDs, and keeps the rest of the rule", async () => {
    const user: UserEvent = await renderRule({
      rows: [row(RESPONDER_ID, ALICE_ID), row(COMMANDER_ID, BOB_ID)],
    });

    await pick(user, "Responder", "Carol");

    expect(savedRows()).toEqual([
      { roleId: RESPONDER_ID, userId: ALICE_ID },
      { roleId: RESPONDER_ID, userId: CAROL_ID },
      { roleId: COMMANDER_ID, userId: BOB_ID },
    ]);

    // Nothing else about the rule's incident changed.
    expect(changes[changes.length - 1]!.title).toBe("{{monitorName}} is down");
    expect(changes[changes.length - 1]!.id).toBe("rule-incident");
  });

  test("removing someone drops their row, and only theirs", async () => {
    const user: UserEvent = await renderRule({
      rows: [
        row(RESPONDER_ID, ALICE_ID),
        row(RESPONDER_ID, CAROL_ID),
        row(COMMANDER_ID, BOB_ID),
      ],
    });

    await user.click(
      within(cardOf("Responder")).getByRole("button", {
        name: "Remove Alice from Responder",
      }),
    );

    expect(savedRows()).toEqual([
      { roleId: RESPONDER_ID, userId: CAROL_ID },
      { roleId: COMMANDER_ID, userId: BOB_ID },
    ]);
  });

  test("a role that takes one person drops its picker once it has one, and says why", async () => {
    const user: UserEvent = await renderRule();

    await openRoles(user);
    await pick(user, "Incident Commander", "Alice");

    const commander: HTMLElement = cardOf("Incident Commander");

    expect(within(commander).queryByRole("combobox")).toBeNull();
    expect(
      within(commander).getByText(
        "Only one user can be assigned to this role.",
      ),
    ).toBeInTheDocument();
    expect(savedRows()).toEqual([{ roleId: COMMANDER_ID, userId: ALICE_ID }]);
  });

  test("a role that takes several people keeps its picker, without the people picked already", async () => {
    const user: UserEvent = await renderRule();

    await openRoles(user);
    await pick(user, "Responder", "Alice");
    await pick(user, "Responder", "Bob");

    await user.click(
      within(cardOf("Responder")).getByRole("combobox", { name: "Responder" }),
    );

    const offered: Array<string> = (await screen.findAllByRole("option")).map(
      (option: HTMLElement): string => {
        return option.textContent || "";
      },
    );

    expect(offered).toEqual(["Carol"]);
    expect(savedRows()).toEqual([
      { roleId: RESPONDER_ID, userId: ALICE_ID },
      { roleId: RESPONDER_ID, userId: BOB_ID },
    ]);
  });

  test("reads no roles or people of its own: the monitor form handed them down", async () => {
    const user: UserEvent = await renderRule();

    await openRoles(user);
    await pick(user, "Responder", "Alice");

    const roleReads: Array<unknown> = getListMock.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return (
          (call[0] as { modelType?: unknown } | undefined)?.modelType ===
          IncidentRole
        );
      },
    );

    expect(roleReads).toEqual([]);
    expect(fetchUsersMock).not.toHaveBeenCalled();
  });

  test("a row for a role the project no longer has does not make the section read as set, and the next pick drops it", async () => {
    const DELETED_ROLE_ID: string = "22222222-2222-4222-8222-000000000099";
    const user: UserEvent = await renderRule({
      rows: [row(DELETED_ROLE_ID, ALICE_ID)],
    });

    // Nobody this rule names can be assigned, so it folds like an unset one.
    expect(sectionHeader()).toHaveAttribute("aria-expanded", "false");

    await openRoles(user);
    await pick(user, "Responder", "Bob");

    expect(savedRows()).toEqual([{ roleId: RESPONDER_ID, userId: BOB_ID }]);
  });

  test("with no incident roles in the project, has no Incident Roles section", async () => {
    await renderRule({ roles: [] });

    expect(screen.queryByTestId("criteria-incident-roles")).toBeNull();
    expect(screen.queryByTestId("incident-role-card")).toBeNull();
  });
});
