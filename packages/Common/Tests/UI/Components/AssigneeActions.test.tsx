import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Assign to Me and Assign to Someone Else, for a record with one assignee
 * (useAssigneeActions): a security case holds its assignee in a column of
 * its own (assignedToUserId, and its team in assignedToTeamId). In a row's
 * ⋯ menu and in Bulk Actions:
 *
 *   - Assign to Me writes the viewer at once; a row assigned to them
 *     already does not offer it, and in bulk is left alone, with why;
 *   - Assign to Someone Else opens the people picker - one person, and the
 *     team where the record has one - and writes them;
 *   - both are locked, saying which permission it takes, for someone who
 *     may not change the column;
 *   - the list reads its rows again once a row is assigned.
 *
 * The hook is shared: the security case lists adopt it.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [...permissionsForTest] };
      },
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

import useAssigneeActions, {
  ALREADY_ASSIGNED_TO_YOU,
  ASSIGN_ROW_DESCRIPTION,
  ASSIGN_TO_SOMEONE_ELSE_TITLE,
  AssigneeActionsConfig,
  AssigneeActionsResult,
  getAssigneeWrite,
  isAlreadyAssigned,
  readAssigneeId,
} from "../../../UI/Components/BulkUpdate/AssigneeActions";
import { ASSIGN_TO_ME_TITLE } from "../../../UI/Components/BulkUpdate/BulkOwnerActions";
import {
  BulkActionOnClickProps,
  BulkActionUnchanged,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import RowActions from "../../../UI/Components/ActionButton/RowActions";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { withRowActionContext } from "../../../UI/Components/ActionButton/RowActionContext";
import { ActionMenuGroup } from "../../../UI/Components/ActionButton/ActionMenuGroup";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import UserModel from "../../../Models/DatabaseModels/User";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import IconProp from "../../../Types/Icon/IconProp";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

const WAIT_TIMEOUT: number = 20000;
jest.setTimeout(30000);

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CASE_ONE_ID: string = "22222222-2222-4222-8222-222222222221";
const CASE_TWO_ID: string = "22222222-2222-4222-8222-222222222222";
const VIEWER_ID: string = "33333333-3333-4333-8333-333333333330";
const ALICE_ID: string = "33333333-3333-4333-8333-333333333331";
const TEAM_ID: string = "44444444-4444-4444-8444-444444444441";

const securityCase: (
  id: string,
  title: string,
  assignedToUserId?: string,
) => SecurityCase = (
  id: string,
  title: string,
  assignedToUserId?: string,
): SecurityCase => {
  const row: SecurityCase = new SecurityCase();
  row._id = id;
  row.title = title;

  if (assignedToUserId) {
    row.assignedToUserId = new ObjectID(assignedToUserId);
  }

  return row;
};

const CASE_ASSIGNEE: AssigneeActionsConfig<SecurityCase> = {
  modelType: SecurityCase,
  userIdColumn: "assignedToUserId",
  teamIdColumn: "assignedToTeamId",
  singularName: "Case",
  pluralName: "Cases",
};

// The writes, as { id, data }.
const writes: () => Array<{
  id: string;
  data: Record<string, unknown>;
}> = (): Array<{ id: string; data: Record<string, unknown> }> => {
  return (updateByIdMock.mock.calls as Array<Array<any>>).map(
    (call: Array<any>) => {
      return { id: call[0].id.toString(), data: call[0].data };
    },
  );
};

let refreshCount: number = 0;

function RowHarness(props: { item: SecurityCase }): ReactElement {
  const { rowActions, modals }: AssigneeActionsResult<SecurityCase> =
    useAssigneeActions<SecurityCase>(CASE_ASSIGNEE);

  const view: ActionButtonSchema<SecurityCase> = {
    title: "View",
    icon: IconProp.ChevronRight,
    buttonStyleType: ButtonStyleType.OUTLINE,
    onClick: (): void => {},
  };

  return (
    <>
      <RowActions<SecurityCase>
        item={props.item}
        actionButtons={withRowActionContext<SecurityCase>(
          [view, ...rowActions],
          {
            refresh: () => {
              refreshCount++;
            },
          },
        )}
      />
      {modals}
    </>
  );
}

const openMenu: () => HTMLElement = (): HTMLElement => {
  fireEvent.click(screen.getByTestId("row-actions-more-button"));
  return screen.getByRole("menu");
};

const menuItemNames: (menu: HTMLElement) => Array<string> = (
  menu: HTMLElement,
): Array<string> => {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
};

// Picks the one option named so in the open people picker's list.
const pickFromList: (
  buttonName: string,
  optionName: string,
) => Promise<void> = async (
  buttonName: string,
  optionName: string,
): Promise<void> => {
  fireEvent.click(screen.getByRole("button", { name: buttonName }));

  const list: HTMLElement = await screen.findByTestId(
    "people-search-popup",
    {},
    { timeout: WAIT_TIMEOUT },
  );
  const option: HTMLElement | undefined = (
    await within(list).findAllByRole("option", {}, { timeout: WAIT_TIMEOUT })
  ).find((candidate: HTMLElement): boolean => {
    return (
      candidate.querySelector(".text-sm.font-medium")?.textContent ===
      optionName
    );
  });

  fireEvent.click(option!);
};

beforeEach(() => {
  cleanup();
  jest.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/cases`);
  User.setUserId(new ObjectID(VIEWER_ID));
  permissionsForTest = [Permission.ProjectOwner];
  PermissionGate.clearPermissionPropsCache();
  refreshCount = 0;

  getListMock.mockImplementation(async (listData: any): Promise<any> => {
    let rows: Array<any> = [];

    if (listData.modelType === TeamMember) {
      const user: UserModel = new UserModel();
      user._id = ALICE_ID;
      user.name = new Name("Alice");

      const member: TeamMember = new TeamMember();
      member.user = user;

      rows = [member];
    } else if (listData.modelType === Team) {
      const team: Team = new Team();
      team._id = TEAM_ID;
      team.name = "Blue Team";

      rows = [team];
    }

    return {
      data: rows,
      count: rows.length,
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    };
  });
  updateByIdMock.mockResolvedValue({});
});

describe("what a write sets", () => {
  test("readAssigneeId reads the column as text, or nothing", () => {
    expect(
      readAssigneeId(
        securityCase(CASE_ONE_ID, "Brute force", ALICE_ID),
        "assignedToUserId",
      ),
    ).toBe(ALICE_ID);
    expect(
      readAssigneeId(
        securityCase(CASE_ONE_ID, "Brute force"),
        "assignedToUserId",
      ),
    ).toBe("");
  });

  test("the person, and the team only when one was picked and the record has one", () => {
    expect(
      getAssigneeWrite({
        picked: { userId: ALICE_ID, teamId: TEAM_ID },
        userIdColumn: "assignedToUserId",
        teamIdColumn: "assignedToTeamId",
      }),
    ).toEqual({ assignedToUserId: ALICE_ID, assignedToTeamId: TEAM_ID });
    expect(
      getAssigneeWrite({
        picked: { userId: ALICE_ID, teamId: "" },
        userIdColumn: "assignedToUserId",
        teamIdColumn: "assignedToTeamId",
      }),
    ).toEqual({ assignedToUserId: ALICE_ID });
    expect(
      getAssigneeWrite({
        picked: { userId: ALICE_ID, teamId: TEAM_ID },
        userIdColumn: "assignedToUserId",
      }),
    ).toEqual({ assignedToUserId: ALICE_ID });
  });

  test("a row holding what a write would set is assigned already", () => {
    const assigned: SecurityCase = securityCase(
      CASE_ONE_ID,
      "Brute force",
      ALICE_ID,
    );

    expect(
      isAlreadyAssigned({
        item: assigned,
        picked: { userId: ALICE_ID, teamId: "" },
        userIdColumn: "assignedToUserId",
        teamIdColumn: "assignedToTeamId",
      }),
    ).toBe(true);
    // The same person with a new team is a change.
    expect(
      isAlreadyAssigned({
        item: assigned,
        picked: { userId: ALICE_ID, teamId: TEAM_ID },
        userIdColumn: "assignedToUserId",
        teamIdColumn: "assignedToTeamId",
      }),
    ).toBe(false);
    expect(
      isAlreadyAssigned({
        item: assigned,
        picked: { userId: VIEWER_ID, teamId: "" },
        userIdColumn: "assignedToUserId",
      }),
    ).toBe(false);
  });
});

describe("a row's assignee actions", () => {
  test("are Assign to Me and Assign to Someone Else, in the ⋯ menu", () => {
    const { result } = renderHook(() => {
      return useAssigneeActions<SecurityCase>(CASE_ASSIGNEE);
    });

    expect(
      result.current.rowActions.map(
        (action: ActionButtonSchema<SecurityCase>) => {
          return [action.title, action.icon, action.placement];
        },
      ),
    ).toEqual([
      [ASSIGN_TO_ME_TITLE, IconProp.User, ActionButtonPlacement.MoreMenu],
      [
        ASSIGN_TO_SOMEONE_ELSE_TITLE,
        IconProp.UserPlus,
        ActionButtonPlacement.MoreMenu,
      ],
    ]);
    expect(
      result.current.bulkActions.map((action: { title: string }) => {
        return action.title;
      }),
    ).toEqual([ASSIGN_TO_ME_TITLE, ASSIGN_TO_SOMEONE_ELSE_TITLE]);
  });

  test("sit in their menus' run of a record's people, in the row and in bulk", () => {
    const { result } = renderHook(() => {
      return useAssigneeActions<SecurityCase>(CASE_ASSIGNEE);
    });

    expect(
      [...result.current.rowActions, ...result.current.bulkActions].map(
        (action: { menuGroup?: string | undefined }) => {
          return action.menuGroup;
        },
      ),
    ).toEqual([
      ActionMenuGroup.People,
      ActionMenuGroup.People,
      ActionMenuGroup.People,
      ActionMenuGroup.People,
    ]);
  });

  test("Assign to Me writes the viewer at once, and the list is read again", async () => {
    render(<RowHarness item={securityCase(CASE_ONE_ID, "Brute force")} />);

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", { name: ASSIGN_TO_ME_TITLE }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();

    await waitFor(() => {
      expect(refreshCount).toBe(1);
    });
    expect(writes()).toEqual([
      { id: CASE_ONE_ID, data: { assignedToUserId: VIEWER_ID } },
    ]);
  });

  test("a row assigned to the viewer already does not offer Assign to Me", () => {
    render(
      <RowHarness item={securityCase(CASE_ONE_ID, "Brute force", VIEWER_ID)} />,
    );

    expect(menuItemNames(openMenu())).toEqual([ASSIGN_TO_SOMEONE_ELSE_TITLE]);
  });

  test("Assign to Someone Else asks who, naming the row, and writes the person and the team", async () => {
    render(<RowHarness item={securityCase(CASE_ONE_ID, "Brute force")} />);

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", {
        name: ASSIGN_TO_SOMEONE_ELSE_TITLE,
      }),
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("modal-title")).toHaveTextContent(
          ASSIGN_TO_SOMEONE_ELSE_TITLE,
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(screen.getByRole("dialog")).toHaveTextContent(
      ASSIGN_ROW_DESCRIPTION.replace("{{name}}", "Brute force"),
    );

    await pickFromList("Choose someone", "Alice");
    await pickFromList("Choose a team", "Blue Team");

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(screen.queryByRole("dialog")).toBeNull();
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(writes()).toEqual([
      {
        id: CASE_ONE_ID,
        data: { assignedToUserId: ALICE_ID, assignedToTeamId: TEAM_ID },
      },
    ]);
    expect(refreshCount).toBe(1);
  });

  test("while the person is written the dialog's button is busy, and a second press writes nothing more", async () => {
    let release: () => void = (): void => {};
    updateByIdMock.mockImplementation(async (): Promise<any> => {
      await new Promise<void>((resolve: () => void) => {
        release = resolve;
      });

      return {};
    });

    render(<RowHarness item={securityCase(CASE_ONE_ID, "Brute force")} />);

    fireEvent.click(
      within(openMenu()).getByRole("menuitem", {
        name: ASSIGN_TO_SOMEONE_ELSE_TITLE,
      }),
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("modal-title")).toHaveTextContent(
          ASSIGN_TO_SOMEONE_ELSE_TITLE,
        );
      },
      { timeout: WAIT_TIMEOUT },
    );

    await pickFromList("Choose someone", "Alice");

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(
      () => {
        expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
      },
      { timeout: WAIT_TIMEOUT },
    );
    // The pick stays in view while it is written.
    expect(screen.getByRole("dialog")).toHaveTextContent("Alice");

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await act(async () => {
      release();
    });

    await waitFor(
      () => {
        expect(screen.queryByRole("dialog")).toBeNull();
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(writes()).toEqual([
      { id: CASE_ONE_ID, data: { assignedToUserId: ALICE_ID } },
    ]);
    expect(refreshCount).toBe(1);
  });

  test("someone who may not change the assignee finds both locked, saying which permission it takes", () => {
    permissionsForTest = [Permission.Viewer];

    render(<RowHarness item={securityCase(CASE_ONE_ID, "Brute force")} />);

    const menu: HTMLElement = openMenu();

    for (const name of [ASSIGN_TO_ME_TITLE, ASSIGN_TO_SOMEONE_ELSE_TITLE]) {
      const item: HTMLElement = within(menu).getByRole("menuitem", {
        name: name,
      });

      expect(item).toHaveAttribute("aria-disabled", "true");
      expect(
        document.getElementById(item.getAttribute("aria-describedby")!)
          ?.textContent,
      ).toContain("permission");
    }

    fireEvent.click(
      within(menu).getByRole("menuitem", { name: ASSIGN_TO_ME_TITLE }),
    );

    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});

describe("Assign to Me in Bulk Actions", () => {
  test("assigns each selected row to the viewer, leaving one assigned to them already alone, with why", async () => {
    const progress: Array<ProgressInfo<SecurityCase>> = [];
    const result: AssigneeActionsResult<SecurityCase> = renderHook(() => {
      return useAssigneeActions<SecurityCase>(CASE_ASSIGNEE);
    }).result.current;

    await act(async () => {
      await result.bulkActions[0]!.onClick({
        items: [
          securityCase(CASE_ONE_ID, "Brute force"),
          securityCase(CASE_TWO_ID, "Impossible travel", VIEWER_ID),
        ],
        onProgressInfo: (info: ProgressInfo<SecurityCase>): void => {
          progress.push(info);
        },
        onBulkActionStart: (): void => {},
        onBulkActionEnd: (): void => {},
      } as BulkActionOnClickProps<SecurityCase>);
    });

    const last: ProgressInfo<SecurityCase> = progress[progress.length - 1]!;

    expect(writes()).toEqual([
      { id: CASE_ONE_ID, data: { assignedToUserId: VIEWER_ID } },
    ]);
    expect(
      (last.unchanged || []).map((entry: BulkActionUnchanged<SecurityCase>) => {
        return [entry.item._id, entry.reason];
      }),
    ).toEqual([[CASE_TWO_ID, ALREADY_ASSIGNED_TO_YOU]]);
  });
});
