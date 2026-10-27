import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * MemberRoleAssignment renders an incident's (or episode's) roles and who
 * holds them. It lives full width on the Roles page and, since the overview
 * redesign, in the ~300px right-hand column of the incident and incident
 * episode overviews - where a member row used to run off the card, cutting
 * the email and the Reassign action in half. The rows now wrap instead of
 * overflowing; the classes that make that happen are pinned here along with
 * the behaviour the actions must keep.
 *
 * A role is tagged Primary, and nothing else: the "Multiple" tag went, as it
 * did from the role picker on every form. A role that takes several people
 * says so where it matters, by offering Add More once it has someone.
 */

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import MemberRoleAssignment, {
  AssignedMember,
  AvailableUser,
  ComponentProps,
  MemberRole,
  MemberRoleButtonAccess,
  canRoleTakeMorePeople,
  getMemberRoleButtonState,
  getMemberRolePickerId,
} from "../../../UI/Components/MemberRoleAssignment/MemberRoleAssignment";
import { PermissionGateResult } from "../../../UI/Utils/PermissionGate";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";

const COMMANDER: MemberRole = {
  id: new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"),
  name: "Incident Commander",
  color: new Color("#6366f1"),
  isPrimaryRole: true,
};

const COMMUNICATIONS: MemberRole = {
  id: new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"),
  name: "Communications Lead",
  color: new Color("#0891b2"),
};

const SCRIBE: MemberRole = {
  id: new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"),
  name: "Scribe",
  color: new Color("#6b7280"),
  canAssignMultipleUsers: true,
};

const MAYA: AssignedMember = {
  id: new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"),
  memberId: new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"),
  userId: new ObjectID("cccccccc-cccc-4ccc-8ccc-ccccccccccc1"),
  userName: "Maya Chen",
  userEmail: "maya.chen@acme-commerce.example",
  roleId: COMMANDER.id,
  roleName: COMMANDER.name,
  roleColor: COMMANDER.color,
};

const JORDAN: AssignedMember = {
  id: new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"),
  memberId: new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"),
  userId: new ObjectID("cccccccc-cccc-4ccc-8ccc-ccccccccccc2"),
  userName: "Jordan Patel",
  userEmail: "jordan.patel@acme-commerce.example",
  roleId: COMMUNICATIONS.id,
  roleName: COMMUNICATIONS.name,
  roleColor: COMMUNICATIONS.color,
};

const USERS: Array<AvailableUser> = [
  { id: MAYA.userId, name: "Maya Chen", email: "" },
  { id: JORDAN.userId, name: "Jordan Patel", email: "" },
  {
    id: new ObjectID("cccccccc-cccc-4ccc-8ccc-ccccccccccc3"),
    name: "Sam Rivera",
    email: "",
  },
];

type RenderAssignmentFunction = (
  overrides?: Partial<ComponentProps>,
) => ReturnType<typeof render>;

const renderAssignment: RenderAssignmentFunction = (
  overrides?: Partial<ComponentProps>,
): ReturnType<typeof render> => {
  const props: ComponentProps = {
    title: "Incident Roles",
    description: "Assign one team member per role.",
    roles: [COMMANDER, COMMUNICATIONS, SCRIBE],
    assignedMembers: [MAYA, JORDAN],
    availableUsers: USERS,
    onAssignMember: async (): Promise<void> => {},
    onUnassignMember: async (): Promise<void> => {},
    onRefresh: async (): Promise<void> => {},
    ...overrides,
  };

  return render(<MemberRoleAssignment {...props} />);
};

type RowForFunction = (name: string) => HTMLElement;

const rowFor: RowForFunction = (name: string): HTMLElement => {
  const row: HTMLElement | null = screen
    .getByText(name, { selector: "p" })
    .closest("[data-testid='member-role-row']");

  if (!row) {
    throw new Error(`No member row for ${name}`);
  }

  return row as HTMLElement;
};

type HeaderForFunction = (roleName: string) => HTMLElement;

const headerFor: HeaderForFunction = (roleName: string): HTMLElement => {
  const header: HTMLElement | null = screen
    .getByText(roleName, { selector: "span" })
    .closest("[data-testid='member-role-header']");

  if (!header) {
    throw new Error(`No role header for ${roleName}`);
  }

  return header as HTMLElement;
};

afterEach(() => {
  cleanup();
});

describe("MemberRoleAssignment in a narrow column", () => {
  test("a member row wraps instead of overflowing", () => {
    renderAssignment();

    const row: HTMLElement = rowFor("Maya Chen");

    expect(row).toHaveClass(
      "flex",
      "flex-wrap",
      "items-center",
      "justify-between",
      "gap-x-2",
      "gap-y-1",
    );

    const identity: HTMLElement = row.children[0] as HTMLElement;

    expect(identity).toHaveClass("flex", "min-w-[8rem]", "flex-1");
    expect(row).not.toHaveClass("overflow-hidden");
  });

  test("the name and email truncate, and say themselves in full on hover", () => {
    renderAssignment();

    const name: HTMLElement = screen.getByText("Maya Chen", { selector: "p" });
    const email: HTMLElement = screen.getByText(
      "maya.chen@acme-commerce.example",
    );

    expect(name).toHaveClass("truncate");
    expect(name).toHaveAttribute("title", "Maya Chen");
    expect(email).toHaveClass("truncate");
    expect(email).toHaveAttribute("title", "maya.chen@acme-commerce.example");
    expect(name.parentElement).toHaveClass("min-w-0", "flex-1");
  });

  test("the avatar never shrinks", () => {
    renderAssignment();

    const row: HTMLElement = rowFor("Maya Chen");
    const avatar: Element = (row.children[0] as HTMLElement).children[0]!;

    expect(avatar).toHaveClass("flex-shrink-0");
  });

  test("a member without a name shows the email once, still truncated", () => {
    renderAssignment({
      assignedMembers: [{ ...MAYA, userName: "" }],
    });

    const label: HTMLElement = screen.getByText(
      "maya.chen@acme-commerce.example",
    );

    expect(label).toHaveClass("truncate");
    expect(label).toHaveAttribute("title", "maya.chen@acme-commerce.example");
    expect(screen.getAllByText("maya.chen@acme-commerce.example")).toHaveLength(
      1,
    );
  });

  test("Reassign keeps its words and lines up under the name when it wraps", () => {
    renderAssignment();

    const reassign: HTMLElement = within(rowFor("Maya Chen")).getByRole(
      "button",
      { name: "Reassign Incident Commander from Maya Chen" },
    );

    expect(reassign).toHaveTextContent("Reassign");
    expect(reassign).toHaveAttribute("title", "Reassign");
    expect(reassign).toHaveAttribute("type", "button");
    expect(reassign).toHaveClass("ml-9", "flex-shrink-0");
  });

  test("Remove is an icon with an accessible name", () => {
    renderAssignment();

    const remove: HTMLElement = within(rowFor("Jordan Patel")).getByRole(
      "button",
      { name: "Remove Jordan Patel from Communications Lead" },
    );

    expect(remove).toHaveAttribute("title", "Remove");
    expect(remove).toHaveAttribute("type", "button");
    expect(remove).toHaveClass("ml-auto", "flex-shrink-0");
    expect(remove.textContent?.trim()).toBe("");
  });

  test("a role header wraps its Assign button under the role name", () => {
    renderAssignment();

    const header: HTMLElement = headerFor("Scribe");

    expect(header).toHaveClass("flex", "flex-wrap", "gap-x-3", "gap-y-2");
    expect(header.children[0]).toHaveClass("flex", "min-w-[8rem]", "flex-1");

    const assign: HTMLElement = within(header).getByRole("button", {
      name: "Assign",
    });

    expect(assign).toHaveClass("ml-12", "flex-shrink-0");
  });

  test("a long role name wraps rather than pushing the badges out", () => {
    renderAssignment();

    const roleName: HTMLElement = screen.getByText("Communications Lead", {
      selector: "span",
    });

    expect(roleName).toHaveClass("min-w-0", "break-words");
    expect(roleName.parentElement).toHaveClass("flex", "flex-wrap");
    expect(roleName.parentElement!.parentElement).toHaveClass("min-w-0");
  });
});

describe("MemberRoleAssignment behaviour", () => {
  test("shows each role with its Primary tag and member counts", () => {
    renderAssignment();

    expect(
      within(headerFor("Incident Commander")).getByText("Primary"),
    ).toBeInTheDocument();
    expect(
      within(headerFor("Incident Commander")).getByText("1 member assigned"),
    ).toBeInTheDocument();
    expect(
      within(headerFor("Scribe")).getByText("0 members assigned"),
    ).toBeInTheDocument();
    expect(screen.getByText("Not assigned")).toBeInTheDocument();
  });

  test("tags no role Multiple, not even one that takes several people", () => {
    renderAssignment();

    expect(screen.queryByText(/Multiple/)).toBeNull();
    // Only the primary role is tagged.
    expect(screen.getAllByText("Primary")).toHaveLength(1);
    expect(within(headerFor("Scribe")).queryByText("Primary")).toBeNull();
  });

  test("a role that takes several people says so by Add More once it has someone", () => {
    const SAM: AssignedMember = {
      id: new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3"),
      memberId: new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3"),
      userId: USERS[2]!.id,
      userName: "Sam Rivera",
      userEmail: "sam.rivera@acme-commerce.example",
      roleId: SCRIBE.id,
      roleName: SCRIBE.name,
      roleColor: SCRIBE.color,
    };

    renderAssignment({ assignedMembers: [MAYA, JORDAN, SAM] });

    expect(
      within(headerFor("Scribe")).getByRole("button", { name: "Add More" }),
    ).toBeInTheDocument();
    // A role that takes one person, once filled, offers nothing.
    expect(
      within(headerFor("Communications Lead")).queryByRole("button"),
    ).toBeNull();
    expect(screen.queryByText(/Multiple/)).toBeNull();
  });

  test("a single-member role that is filled offers no Assign button", () => {
    renderAssignment();

    expect(
      within(headerFor("Communications Lead")).queryByRole("button"),
    ).toBeNull();
    expect(
      within(headerFor("Incident Commander")).queryByRole("button"),
    ).toBeNull();
  });

  test("Reassign opens the reassign dialog for that member", () => {
    renderAssignment();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reassign Incident Commander from Maya Chen",
      }),
    );

    expect(screen.getByText("Reassign Role")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Select a new user to reassign the Incident Commander role from Maya Chen.",
      ),
    ).toBeInTheDocument();
  });

  test("Remove asks before removing, then unassigns that member", async () => {
    const onUnassignMember: MockFunction = getJestMockFunction();
    onUnassignMember.mockResolvedValue(undefined as never);

    renderAssignment({
      onUnassignMember: onUnassignMember as unknown as (
        memberId: ObjectID,
      ) => Promise<void>,
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Jordan Patel from Communications Lead",
      }),
    );

    expect(
      screen.getByText(
        "Are you sure you want to remove Jordan Patel from the Communications Lead role?",
      ),
    ).toBeInTheDocument();
    expect(onUnassignMember).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(onUnassignMember).toHaveBeenCalledTimes(1);
    });

    expect((onUnassignMember.mock.calls[0]![0] as ObjectID).toString()).toBe(
      JORDAN.memberId.toString(),
    );
  });

  test("Assign opens a picker whose row wraps too", () => {
    renderAssignment();

    fireEvent.click(
      within(headerFor("Scribe")).getByRole("button", { name: "Assign" }),
    );

    const save: HTMLElement = screen.getByRole("button", { name: "Save" });
    const cancel: HTMLElement = screen.getByRole("button", { name: "Cancel" });
    const pickerRow: HTMLElement = save.parentElement as HTMLElement;

    expect(pickerRow).toContainElement(cancel);
    expect(pickerRow).toHaveClass("flex", "flex-wrap", "items-center", "gap-2");
    expect(pickerRow.children[0]).toHaveClass(
      "min-w-[10rem]",
      "max-w-sm",
      "flex-1",
    );
    expect(save).toBeDisabled();

    fireEvent.click(cancel);

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  test("Refresh calls back", () => {
    const onRefresh: MockFunction = getJestMockFunction();
    onRefresh.mockResolvedValue(undefined as never);

    renderAssignment({
      onRefresh: onRefresh as unknown as () => Promise<void>,
    });

    fireEvent.click(screen.getByText("Refresh"));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test("with no roles it explains where to configure them", () => {
    renderAssignment({
      roles: [],
      assignedMembers: [],
      emptyStateMessage: "Configure incident roles in settings.",
    });

    expect(screen.getByText("No roles defined")).toBeInTheDocument();
    expect(
      screen.getByText("Configure incident roles in settings."),
    ).toBeInTheDocument();
  });
});

describe("MemberRoleAssignment header layout", () => {
  test("leaves the card header side by side by default", () => {
    renderAssignment();

    expect(screen.getByText("Incident Roles")).toBeInTheDocument();
    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "default",
    );
  });

  test("stacks the description under the header's row when asked, with Refresh on the title's row, at the right", () => {
    renderAssignment({ headerLayout: "stacked" });

    const header: HTMLElement = screen.getByTestId("card-header");
    const titleRow: HTMLElement = screen.getByTestId("card-header-title-row");

    expect(header).toHaveAttribute("data-header-layout", "stacked");
    expect(
      within(screen.getByTestId("card-header-actions")).getByText("Refresh"),
    ).toBeInTheDocument();
    expect(titleRow).toContainElement(
      screen.getByTestId("card-header-actions"),
    );
    expect(within(titleRow).getByText("Incident Roles")).toBeInTheDocument();
    expect(titleRow.lastElementChild).toBe(
      screen.getByTestId("card-header-actions"),
    );
  });

  test("the loading and error cards stack the same way", () => {
    const { unmount } = renderAssignment({
      headerLayout: "stacked",
      isLoading: true,
    });

    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "stacked",
    );

    unmount();

    renderAssignment({ headerLayout: "stacked", error: "Could not load." });

    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "stacked",
    );
    expect(screen.getByText("Could not load.")).toBeInTheDocument();
  });
});

/*
 * An archived role (Common/Utils/ArchivableValues): the people who hold it
 * keep it, and can be taken off, but nobody new is given it.
 */
describe("an archived role", () => {
  const ARCHIVED_SCRIBE: MemberRole = { ...SCRIBE, isArchived: true };

  const KAI: AssignedMember = {
    id: new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3"),
    memberId: new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3"),
    userId: new ObjectID("cccccccc-cccc-4ccc-8ccc-ccccccccccc3"),
    userName: "Kai Morgan",
    userEmail: "kai.morgan@acme-commerce.example",
    roleId: SCRIBE.id,
    roleName: SCRIBE.name,
    roleColor: SCRIBE.color,
  };

  test("is tagged Archived, and offers neither Assign nor Add More", () => {
    renderAssignment({
      roles: [COMMANDER, COMMUNICATIONS, ARCHIVED_SCRIBE],
      assignedMembers: [MAYA, JORDAN, KAI],
    });

    const header: HTMLElement = headerFor("Scribe");

    expect(
      within(header).getByTestId("member-role-archived-tag"),
    ).toHaveTextContent("Archived");
    expect(
      within(header).queryByRole("button", { name: "Add More" }),
    ).toBeNull();
    expect(within(header).queryByRole("button", { name: "Assign" })).toBeNull();
  });

  test("keeps the person who holds it, who can still be taken off", () => {
    renderAssignment({
      roles: [COMMANDER, COMMUNICATIONS, ARCHIVED_SCRIBE],
      assignedMembers: [MAYA, JORDAN, KAI],
    });

    expect(rowFor("Kai Morgan")).toBeInTheDocument();
    expect(
      within(rowFor("Kai Morgan")).getAllByRole("button").length,
    ).toBeGreaterThan(0);
  });

  test("an empty archived role is not offered to anyone", () => {
    renderAssignment({
      roles: [COMMANDER, COMMUNICATIONS, ARCHIVED_SCRIBE],
      assignedMembers: [MAYA, JORDAN],
    });

    expect(
      within(headerFor("Scribe")).queryByRole("button", { name: "Assign" }),
    ).toBeNull();
  });

  test("a live role carries no tag", () => {
    renderAssignment();

    expect(screen.queryByTestId("member-role-archived-tag")).toBeNull();
  });
});

/*
 * A role's picker takes the cursor when it opens - its Assign button is gone
 * the moment it is pressed. The card is the only one that opens it: an
 * incident overview's header gives the commander from a list of its own,
 * right where it names them, and the card reads its roles again.
 */
describe("a role's picker, opened by its Assign", () => {
  type PropsFunction = (overrides?: Partial<ComponentProps>) => ComponentProps;

  // Nobody holds Incident Commander; Jordan is the Communications Lead.
  const propsWith: PropsFunction = (
    overrides?: Partial<ComponentProps>,
  ): ComponentProps => {
    return {
      title: "Incident Roles",
      description: "Who takes each role on this incident.",
      roles: [COMMANDER, COMMUNICATIONS, SCRIBE],
      assignedMembers: [JORDAN],
      availableUsers: USERS,
      onAssignMember: async (): Promise<void> => {},
      onUnassignMember: async (): Promise<void> => {},
      onRefresh: async (): Promise<void> => {},
      ...overrides,
    };
  };

  type PickerFunction = (role: MemberRole) => HTMLElement | null;

  const pickerOf: PickerFunction = (role: MemberRole): HTMLElement | null => {
    return document.getElementById(getMemberRolePickerId(role.id));
  };

  test("Assign puts the cursor in the picker it opens, named by its role", () => {
    render(<MemberRoleAssignment {...propsWith()} />);

    fireEvent.click(
      within(headerFor("Scribe")).getByRole("button", { name: "Assign" }),
    );

    const picker: HTMLElement | null = pickerOf(SCRIBE);

    expect(picker).not.toBeNull();

    const input: HTMLElement = within(picker as HTMLElement).getByRole(
      "combobox",
      { name: "Scribe" },
    );

    expect(input).toHaveFocus();
  });

  test("a card drawn again with new roles opens no picker by itself", () => {
    const view: ReturnType<typeof render> = render(
      <MemberRoleAssignment {...propsWith()} />,
    );

    view.rerender(
      <MemberRoleAssignment
        {...propsWith({ assignedMembers: [JORDAN, MAYA] })}
      />,
    );

    expect(pickerOf(COMMANDER)).toBeNull();
    expect(pickerOf(SCRIBE)).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("canRoleTakeMorePeople", () => {
  test("a live role nobody holds, or one that takes several people", () => {
    expect(canRoleTakeMorePeople(COMMANDER, 0)).toBe(true);
    expect(canRoleTakeMorePeople(COMMANDER, 1)).toBe(false);
    expect(canRoleTakeMorePeople(SCRIBE, 3)).toBe(true);
  });

  test("an archived role takes nobody new", () => {
    expect(canRoleTakeMorePeople({ ...COMMANDER, isArchived: true }, 0)).toBe(
      false,
    );
    expect(canRoleTakeMorePeople({ ...SCRIBE, isArchived: true }, 1)).toBe(
      false,
    );
  });
});

/*
 * WHO MAY GIVE A ROLE, OR TAKE ONE OFF.
 *
 * The header's Assign gives the commander only to a reader who may add a
 * row of the record's members (#5262), but the roles card itself offered
 * Assign, Add More, Reassign and Remove to everyone, and the server refused
 * a reader without the permission (#5251's follow-up). The card now asks
 * the gates it is handed: refused with a reason, a button is drawn locked,
 * saying why; refused before the permissions are read, it is left out, as
 * the header's Assign is; handed no gate, everything is offered as before.
 */
describe("who may give a role, or take one off", () => {
  const ASSIGN_REFUSED: PermissionGateResult = {
    isAllowed: false,
    disabledReason:
      "You do not have permission to change this incident's roles. You need one of these permissions: Create Incident Member.",
  };

  const UNASSIGN_REFUSED: PermissionGateResult = {
    isAllowed: false,
    disabledReason:
      "You do not have permission to change this incident's roles. You need one of these permissions: Delete Incident Member.",
  };

  // Refused, with nothing honest to say yet: the permissions are not read.
  const NOT_READ: PermissionGateResult = { isAllowed: false };

  const ALLOWED: PermissionGateResult = { isAllowed: true };

  test("handed no gates, every button is offered, as before", () => {
    renderAssignment();

    expect(
      within(headerFor("Scribe")).getByRole("button", { name: "Assign" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "Reassign Incident Commander from Maya Chen",
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "Remove Jordan Patel from Communications Lead",
      }),
    ).toBeEnabled();
    expect(screen.queryByTestId("member-role-assign-locked")).toBeNull();
  });

  test("allowed both ways, every button is offered", () => {
    renderAssignment({ assignGate: ALLOWED, unassignGate: ALLOWED });

    expect(
      within(headerFor("Scribe")).getByRole("button", { name: "Assign" }),
    ).toBeEnabled();
    expect(screen.queryByTestId("member-role-remove-locked")).toBeNull();
    expect(screen.queryByTestId("member-role-reassign-locked")).toBeNull();
  });

  test("a reader who may not give a role finds Assign locked, saying why, and pressing it opens nothing", () => {
    const onAssignMember: MockFunction = getJestMockFunction();

    renderAssignment({
      assignGate: ASSIGN_REFUSED,
      unassignGate: ALLOWED,
      onAssignMember: onAssignMember as unknown as (
        userId: ObjectID,
        roleId: ObjectID,
      ) => Promise<void>,
    });

    const locked: HTMLElement = within(headerFor("Scribe")).getByTestId(
      "member-role-assign-locked",
    );
    const button: HTMLElement = within(locked).getByRole("button", {
      name: "Assign",
    });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveClass("pointer-events-none", "opacity-50");
    // The reason is what the wrapper says, to the pointer and to a screen reader.
    expect(locked).toHaveAttribute(
      "aria-label",
      ASSIGN_REFUSED.disabledReason!,
    );
    expect(locked).toHaveAttribute("tabindex", "0");
    expect(locked).toHaveClass("cursor-not-allowed", "ml-12");

    fireEvent.click(button);
    fireEvent.click(locked);

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(onAssignMember).not.toHaveBeenCalled();
  });

  test("Add More is locked the same way on a role that takes several people", () => {
    renderAssignment({
      assignedMembers: [
        MAYA,
        JORDAN,
        {
          ...JORDAN,
          id: new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3"),
          memberId: new ObjectID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3"),
          roleId: SCRIBE.id,
          roleName: SCRIBE.name,
          roleColor: SCRIBE.color,
        },
      ],
      assignGate: ASSIGN_REFUSED,
      unassignGate: ALLOWED,
    });

    const locked: HTMLElement = within(headerFor("Scribe")).getByTestId(
      "member-role-assign-locked",
    );

    expect(
      within(locked).getByRole("button", { name: "Add More" }),
    ).toBeDisabled();
  });

  test("Reassign needs both: locked when the reader may not give the role", () => {
    renderAssignment({ assignGate: ASSIGN_REFUSED, unassignGate: ALLOWED });

    const locked: HTMLElement = screen.getByTestId(
      "member-role-reassign-locked",
    );

    expect(
      within(locked).getByRole("button", {
        name: "Reassign Incident Commander from Maya Chen",
      }),
    ).toBeDisabled();
    expect(locked).toHaveAttribute(
      "aria-label",
      ASSIGN_REFUSED.disabledReason!,
    );

    // Taking a role off is still open to them.
    expect(
      screen.getByRole("button", {
        name: "Remove Jordan Patel from Communications Lead",
      }),
    ).toBeEnabled();
  });

  test("a reader who may not take a role off finds Remove and Reassign locked, saying why", () => {
    const onUnassignMember: MockFunction = getJestMockFunction();

    renderAssignment({
      assignGate: ALLOWED,
      unassignGate: UNASSIGN_REFUSED,
      onUnassignMember: onUnassignMember as unknown as (
        memberId: ObjectID,
      ) => Promise<void>,
    });

    const remove: HTMLElement = within(rowFor("Jordan Patel")).getByTestId(
      "member-role-remove-locked",
    );
    const removeButton: HTMLElement = within(remove).getByRole("button", {
      name: "Remove Jordan Patel from Communications Lead",
    });

    expect(removeButton).toBeDisabled();
    expect(remove).toHaveAttribute(
      "aria-label",
      UNASSIGN_REFUSED.disabledReason!,
    );
    expect(remove).toHaveClass("ml-auto");

    fireEvent.click(removeButton);

    expect(
      screen.queryByText(
        "Are you sure you want to remove Jordan Patel from the Communications Lead role?",
      ),
    ).toBeNull();
    expect(onUnassignMember).not.toHaveBeenCalled();

    expect(screen.getByTestId("member-role-reassign-locked")).toHaveAttribute(
      "aria-label",
      UNASSIGN_REFUSED.disabledReason!,
    );

    // Giving a role is still open to them.
    expect(
      within(headerFor("Scribe")).getByRole("button", { name: "Assign" }),
    ).toBeEnabled();
  });

  test("before the permissions are read, the buttons that need them are left out, not locked", () => {
    renderAssignment({ assignGate: NOT_READ, unassignGate: NOT_READ });

    expect(within(headerFor("Scribe")).queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("member-role-assign-locked")).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Reassign Incident Commander from Maya Chen",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "Remove Jordan Patel from Communications Lead",
      }),
    ).toBeNull();
    // The people who hold the roles are still named.
    expect(rowFor("Maya Chen")).toBeVisible();
  });

  test("a person's name in the picker is drawn as written, never looked up as a label", () => {
    renderAssignment();

    fireEvent.click(
      within(headerFor("Scribe")).getByRole("button", { name: "Assign" }),
    );

    const picker: HTMLElement = document.getElementById(
      getMemberRolePickerId(SCRIBE.id),
    )!;

    fireEvent.keyDown(within(picker).getByRole("combobox"), {
      key: "ArrowDown",
      code: "ArrowDown",
    });

    const names: Array<HTMLElement> = screen.getAllByTestId(
      "dropdown-option-label",
    );

    expect(
      names.map((name: HTMLElement): string => {
        return name.textContent || "";
      }),
    ).toEqual(["Maya Chen", "Jordan Patel", "Sam Rivera"]);
    // A name reads the way most of its letters do.
    for (const name of names) {
      expect(name).toHaveAttribute("dir", "ltr");
    }
  });
});

describe("getMemberRoleButtonState", () => {
  test("no gate, or every gate open: offered", () => {
    expect(getMemberRoleButtonState([])).toEqual({
      access: MemberRoleButtonAccess.Offered,
    });
    expect(getMemberRoleButtonState([undefined])).toEqual({
      access: MemberRoleButtonAccess.Offered,
    });
    expect(
      getMemberRoleButtonState([{ isAllowed: true }, { isAllowed: true }]),
    ).toEqual({ access: MemberRoleButtonAccess.Offered });
  });

  test("a gate refused with a reason: locked, with that reason", () => {
    expect(
      getMemberRoleButtonState([
        { isAllowed: true },
        { isAllowed: false, disabledReason: "Why." },
      ]),
    ).toEqual({ access: MemberRoleButtonAccess.Locked, reason: "Why." });
  });

  test("two refused with reasons: the first one says why", () => {
    expect(
      getMemberRoleButtonState([
        { isAllowed: false, disabledReason: "First." },
        { isAllowed: false, disabledReason: "Second." },
      ]),
    ).toEqual({ access: MemberRoleButtonAccess.Locked, reason: "First." });
  });

  test("any refusal with nothing to say yet: left out", () => {
    expect(getMemberRoleButtonState([{ isAllowed: false }])).toEqual({
      access: MemberRoleButtonAccess.Hidden,
    });
    expect(
      getMemberRoleButtonState([
        { isAllowed: false, disabledReason: "Why." },
        { isAllowed: false },
      ]),
    ).toEqual({ access: MemberRoleButtonAccess.Hidden });
  });
});
