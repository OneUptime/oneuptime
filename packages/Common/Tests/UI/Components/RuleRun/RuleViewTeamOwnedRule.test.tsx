import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A RULE TEAMS OWN, ON ITS OWN PAGE.
 *
 * A rule some teams own is changed and deleted only with the permissions of
 * those teams, and by the project's owners and admins; everyone else who
 * may read rules sees it read-only. Its list locks its row's Edit and
 * Delete, naming the teams (RuleOwningTeams). Its own page - RuleView, an
 * incident owner rule's - offered both to everyone whose permissions let
 * them change rules of its kind, and the server then refused. The page now
 * reads who owns the rule and hands RuleView what it read (RuleOwnership):
 *
 *   - a member outside the owning teams finds Edit and Delete locked, with
 *     the reason the row gives, naming the teams;
 *   - a member of an owning team, a project admin, and anyone on a rule no
 *     team owns, edit and delete it as before;
 *   - while the page reads who owns it, Edit waits and Delete is locked,
 *     with nothing to say yet, rather than offered for that moment;
 *   - the kind's own lock comes first, naming the permission missing;
 *   - the Edit form opens on the teams that own it (onEditFormItemFetched),
 *     and once it saves, the page reads who owns the rule again;
 *   - the rule's details end with the teams that own it.
 *
 * Drawn with the real cards - CardModelDetail's Edit and ModelDelete's
 * Delete - and the real gate (PermissionGate.checkTeamOwnedRule) over a
 * permission snapshot; only the network and the Edit dialog are stubbed.
 */

let isMasterAdminForTest: boolean = false;
let rowsForTest: Array<unknown> = [];
let deleteItemCalls: number = 0;
const mockModalProps: Array<Record<string, any>> = [];

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return (rowsForTest as Array<{ permission: unknown }>).map(
          (row: { permission: unknown }): unknown => {
            return row.permission;
          },
        );
      },
      getProjectPermissions: (): { permissions: Array<unknown> } => {
        return { permissions: rowsForTest };
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [] };
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdminForTest;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Translation", () => {
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

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<Record<string, unknown>> => {
        const { default: Rule } = jest.requireActual(
          "../../../../Models/DatabaseModels/IncidentOwnerRule",
        ) as { default: { new (): Record<string, unknown> } };

        return Object.assign(new Rule(), {
          _id: "7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e",
          name: "Oversight sees every Sev 0",
          isEnabled: true,
        });
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      deleteItem: async (): Promise<void> => {
        deleteItemCalls++;
      },
    },
  };
});

// The Edit dialog, as far as the page goes: what it opens with, and a save.
jest.mock("../../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  const mockReact: typeof React = jest.requireActual("react");
  return {
    __esModule: true,
    default: (props: Record<string, any>) => {
      mockModalProps.push(props);
      return mockReact.createElement(
        "button",
        {
          "data-testid": "edit-dialog-save",
          onClick: () => {
            props["onSuccess"](new props["modelType"]());
          },
        },
        "Save Changes",
      );
    },
  };
});

import IncidentOwnerRule from "../../../../Models/DatabaseModels/IncidentOwnerRule";
import Route from "../../../../Types/API/Route";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import RuleView, {
  ComponentProps as RuleViewProps,
  RuleOwnership,
} from "../../../../UI/Components/RuleRun/RuleView";
import FieldType from "../../../../UI/Components/Types/FieldType";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../../UI/Utils/PermissionGate";
import getJestMockFunction, { MockFunction } from "../../../MockType";

const RULE_ID: string = "7b8c9d0e-1f2a-4b3c-8d4e-5f6a7b8c9d0e";
const OVERSIGHT: string = "8c9d0e1f-2a3b-4c4d-9e5f-6a7b8c9d0e1f";
const PLATFORM: string = "9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a";

// What the list's row says of a rule Oversight owns (RuleOwningTeams).
const REASON: string =
  "This rule belongs to Oversight: only its members, with its permissions, and project admins can change it.";

const FORM_FIELDS: RuleViewProps<IncidentOwnerRule>["formFields"] = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
  },
];

function row(permission: Permission, teamId?: string): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
    scope: PermissionScope.All,
    ...(teamId ? { teamId: new ObjectID(teamId) } : {}),
  };
}

// A member of `teamId`, whose team may read, edit and delete owner rules.
function editorOf(teamId: string): Array<UserPermission> {
  return [
    row(Permission.ReadIncidentOwnerRule, teamId),
    row(Permission.EditIncidentOwnerRule, teamId),
    row(Permission.DeleteIncidentOwnerRule, teamId),
  ];
}

/*
 * What the page hands RuleView once it has read who owns the rule - the
 * teams' ids, or undefined while it reads them - asked of the real gate.
 */
function ownership(
  owningTeamIds: Array<string> | undefined,
  more?: Partial<RuleOwnership<IncidentOwnerRule>>,
): RuleOwnership<IncidentOwnerRule> {
  const lock: (
    action: ModelAction.Update | ModelAction.Delete,
  ) => PermissionGateResult = (
    action: ModelAction.Update | ModelAction.Delete,
  ): PermissionGateResult => {
    return PermissionGate.checkTeamOwnedRule(new IncidentOwnerRule(), action, {
      owningTeamIds: owningTeamIds,
      reason: owningTeamIds ? REASON : "",
    });
  };

  return {
    editLock: lock(ModelAction.Update),
    deleteLock: lock(ModelAction.Delete),
    ...(more || {}),
  };
}

function page(
  rule: RuleOwnership<IncidentOwnerRule> | undefined,
  more?: Partial<RuleViewProps<IncidentOwnerRule>>,
): ReactElement {
  return (
    <RuleView<IncidentOwnerRule>
      modelType={IncidentOwnerRule}
      ruleId={new ObjectID(RULE_ID)}
      formFields={FORM_FIELDS}
      listRoute={new Route("/dashboard/incidents/settings/owner-rules")}
      ownership={rule}
      {...(more || {})}
    />
  );
}

// Draws the rule's page and waits for the rule to be read.
async function openPage(
  rule: RuleOwnership<IncidentOwnerRule> | undefined,
  more?: Partial<RuleViewProps<IncidentOwnerRule>>,
): Promise<RenderResult> {
  const result: RenderResult = render(page(rule, more));

  await waitFor(() => {
    expect(
      screen.getAllByText("Oversight sees every Sev 0").length,
    ).toBeGreaterThan(0);
  });

  return result;
}

function findButton(label: string): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
      (button: HTMLButtonElement) => {
        return (button.textContent || "").trim().startsWith(label);
      },
    ) || null
  );
}

function editButton(): HTMLButtonElement | null {
  return findButton("Edit Incident Owner Rule");
}

function deleteButton(): HTMLButtonElement | null {
  return findButton("Delete Incident Owner Rule");
}

// The tooltip a locked button explains itself with, or null.
function hover(button: HTMLButtonElement): HTMLElement | null {
  const shown: number = screen.queryAllByRole("tooltip").length;

  fireEvent.mouseEnter(button.parentElement as HTMLElement);

  // A tooltip stays in the page once shown: this button's is the one it adds.
  const tooltips: Array<HTMLElement> = screen.queryAllByRole("tooltip");

  return tooltips.length > shown ? tooltips[tooltips.length - 1]! : null;
}

describe("a rule teams own, on its own page", () => {
  beforeEach(() => {
    isMasterAdminForTest = false;
    rowsForTest = [];
    deleteItemCalls = 0;
    mockModalProps.length = 0;
    PermissionGate.clearPermissionPropsCache();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("a member outside the owning teams finds Edit locked, told which teams own the rule", async () => {
    rowsForTest = editorOf(PLATFORM);

    await openPage(ownership([OVERSIGHT]));

    expect(editButton()).toBeDisabled();

    const tooltip: HTMLElement | null = hover(editButton()!);

    expect(tooltip).toHaveTextContent(
      "You do not have permission to update this Incident Owner Rule.",
    );
    expect(tooltip).toHaveTextContent(REASON);

    // A locked Edit opens no form.
    fireEvent.click(editButton()!);
    expect(mockModalProps).toHaveLength(0);
  });

  test("and Delete locked, with the same reason, deleting nothing", async () => {
    rowsForTest = editorOf(PLATFORM);

    await openPage(ownership([OVERSIGHT]));

    expect(deleteButton()).toBeDisabled();

    const tooltip: HTMLElement | null = hover(deleteButton()!);

    expect(tooltip).toHaveTextContent(
      "You do not have permission to delete this Incident Owner Rule.",
    );
    expect(tooltip).toHaveTextContent(REASON);

    fireEvent.click(deleteButton()!);

    expect(screen.queryByTestId("confirm-modal-description")).toBeNull();
    expect(deleteItemCalls).toBe(0);
  });

  test("a member of the owning team edits and deletes it", async () => {
    rowsForTest = editorOf(OVERSIGHT);

    await openPage(ownership([OVERSIGHT]));

    expect(editButton()).not.toBeDisabled();
    expect(deleteButton()).not.toBeDisabled();
  });

  test("so do a project admin and a master admin, whichever teams own it", async () => {
    rowsForTest = [row(Permission.ProjectAdmin, PLATFORM)];

    await openPage(ownership([OVERSIGHT]));

    expect(editButton()).not.toBeDisabled();
    expect(deleteButton()).not.toBeDisabled();

    cleanup();
    rowsForTest = [];
    isMasterAdminForTest = true;

    await openPage(ownership([OVERSIGHT]));

    expect(editButton()).not.toBeDisabled();
    expect(deleteButton()).not.toBeDisabled();
  });

  test("a rule no team owns is everyone's who may change rules, as before", async () => {
    rowsForTest = editorOf(PLATFORM);

    await openPage(ownership([]));

    expect(editButton()).not.toBeDisabled();
    expect(deleteButton()).not.toBeDisabled();
  });

  test("while the page reads who owns it, Edit waits and Delete is locked with nothing to say", async () => {
    rowsForTest = editorOf(PLATFORM);

    const result: RenderResult = await openPage(ownership(undefined));

    // Not offered for the moment the read takes, and nobody is accused.
    expect(editButton()).toBeNull();
    expect(deleteButton()).toBeDisabled();
    expect(hover(deleteButton()!)).toBeNull();

    // Read: Oversight owns it.
    result.rerender(page(ownership([OVERSIGHT])));

    await waitFor(() => {
      expect(editButton()).not.toBeNull();
    });

    expect(editButton()).toBeDisabled();
    expect(hover(editButton()!)).toHaveTextContent(REASON);
    expect(deleteButton()).toBeDisabled();
  });

  test("the reading holds back nothing from a project admin", async () => {
    rowsForTest = [row(Permission.ProjectAdmin, PLATFORM)];

    await openPage(ownership(undefined));

    expect(editButton()).not.toBeDisabled();
    expect(deleteButton()).not.toBeDisabled();
  });

  test("a reader who may not change rules at all is told what they are missing, not who owns it", async () => {
    rowsForTest = [row(Permission.ReadIncidentOwnerRule, PLATFORM)];

    // A lock the page worked out cannot take the kind's word away.
    await openPage({
      editLock: { isAllowed: false, disabledReason: REASON },
      deleteLock: { isAllowed: false, disabledReason: REASON },
    });

    for (const button of [editButton()!, deleteButton()!]) {
      expect(button).toBeDisabled();

      const tooltip: HTMLElement | null = hover(button);

      expect(tooltip).toHaveTextContent(/You do not have permission to/);
      expect(tooltip).not.toHaveTextContent(REASON);
    }
  });

  test("its Edit form opens on the teams that own it, and once it saves, the page reads them again", async () => {
    rowsForTest = editorOf(OVERSIGHT);

    const onEditFormItemFetched: (
      item: IncidentOwnerRule,
    ) => Promise<IncidentOwnerRule> = async (
      item: IncidentOwnerRule,
    ): Promise<IncidentOwnerRule> => {
      return item;
    };
    const onRuleSaved: MockFunction = getJestMockFunction();

    await openPage(
      ownership([OVERSIGHT], { onRuleSaved: onRuleSaved as () => void }),
      {
        onEditFormItemFetched: onEditFormItemFetched,
      },
    );

    fireEvent.click(editButton()!);

    expect(mockModalProps.length).toBeGreaterThan(0);
    expect(
      mockModalProps[mockModalProps.length - 1]!["formProps"]["onItemFetched"],
    ).toBe(onEditFormItemFetched);
    expect(onRuleSaved).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByTestId("edit-dialog-save"));
    });

    expect(onRuleSaved).toHaveBeenCalledTimes(1);
  });

  test("its details end with the teams that own it", async () => {
    rowsForTest = editorOf(PLATFORM);

    await openPage(
      ownership([OVERSIGHT], {
        owningTeamsField: {
          field: { _id: true },
          title: "Owning Teams",
          fieldType: FieldType.Element,
          getElement: (): ReactElement => {
            return <span data-testid="owning-teams">Oversight</span>;
          },
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("owning-teams")).toHaveTextContent("Oversight");
    });

    // After the rule's own details, drawn from its form.
    const labels: Array<string> = screen
      .getAllByTestId("detail-label")
      .map((label: HTMLElement): string => {
        return (label.textContent || "").trim();
      });

    expect(labels).toContain("Name");
    expect(labels[labels.length - 1]).toBe("Owning Teams");
  });

  test("without a word of who owns it, the page is as it was", async () => {
    rowsForTest = editorOf(PLATFORM);

    await openPage(undefined);

    expect(editButton()).not.toBeDisabled();
    expect(deleteButton()).not.toBeDisabled();
    expect(screen.queryByText("Owning Teams")).toBeNull();
  });
});
