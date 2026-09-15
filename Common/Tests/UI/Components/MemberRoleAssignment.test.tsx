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
} from "../../../UI/Components/MemberRoleAssignment/MemberRoleAssignment";
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
  test("shows each role with its badges and member counts", () => {
    renderAssignment();

    expect(
      within(headerFor("Incident Commander")).getByText("Primary"),
    ).toBeInTheDocument();
    expect(
      within(headerFor("Incident Commander")).getByText("1 member assigned"),
    ).toBeInTheDocument();
    expect(
      within(headerFor("Scribe")).getByText("Multiple"),
    ).toBeInTheDocument();
    expect(
      within(headerFor("Scribe")).getByText("0 members assigned"),
    ).toBeInTheDocument();
    expect(screen.getByText("Not assigned")).toBeInTheDocument();
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
    expect(screen.queryByTestId("card-header")).toBeNull();
  });

  test("stacks the header, with Refresh on its own row, when asked", () => {
    renderAssignment({ headerLayout: "stacked" });

    const header: HTMLElement = screen.getByTestId("card-header");

    expect(header).toHaveAttribute("data-header-layout", "stacked");
    expect(
      within(screen.getByTestId("card-header-actions")).getByText("Refresh"),
    ).toBeInTheDocument();
    expect(within(header).getByText("Incident Roles")).toBeInTheDocument();
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
