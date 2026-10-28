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
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A security case's Tasks page: its checklist.
 *
 *   - It reads the case's tasks, the oldest first, and draws each as a line:
 *     a box to tick it off, what it is, who has it - or Unassigned - and,
 *     once done, who did it and when. How many are done sits beside the
 *     title. Who has it is a small avatar and the name on one line, cut to
 *     it with the whole name under the pointer: in a column of its own from
 *     sm up, a line under the title on a phone.
 *   - Its ⋯ is a button, as every list row's is; Assign Task and Delete
 *     Task name the task in bold in their question.
 *   - A new task is typed into the line under the list and added with Enter
 *     or Add Task, trimmed; nothing is sent for an empty one.
 *   - A box ticks a task off and on; the ⋯ hands it to the reader, takes it
 *     off whoever has it, or deletes it after asking. Every change reads the
 *     list again and asks the side menu to count the open tasks again.
 *   - A change that fails says why, in the server's words, and the list
 *     stays as it was.
 *   - A Security Viewer sees the list, its boxes and actions locked, and no
 *     line to add one.
 *   - A colleague's change to any task reads the list again.
 */

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      create: (...args: Array<unknown>) => {
        return createMock(...args);
      },
      updateById: (...args: Array<unknown>) => {
        return updateByIdMock(...args);
      },
      deleteItem: (...args: Array<unknown>) => {
        return deleteItemMock(...args);
      },
    },
  };
});

import SecurityCaseTasks from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Tasks/SecurityCaseTasks";
import { SECURITY_CASE_TASKS_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Tasks/SecurityCaseTasksCopy";
import { SECURITY_CASE_TASK_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Tasks/SecurityCaseTasksModel";
import SecurityCaseTask from "../../../Models/DatabaseModels/SecurityCaseTask";
import User from "../../../Models/DatabaseModels/User";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "../../../UI/Components/SideMenu/CountModelSideMenuItem";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import Realtime from "../../../UI/Utils/Realtime";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CASE_ID: string = "22222222-2222-4222-8222-222222222222";
const ME: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const ANA: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const TASK_A: string = "33333333-3333-4333-8333-000000000001";
const TASK_B: string = "33333333-3333-4333-8333-000000000002";

let permissions: Array<Permission>;
let tasks: Array<SecurityCaseTask>;
let colleagueChanges: Array<() => void>;
let dispatched: Array<string>;

function user(id: string, name: string): User {
  const model: User = new User();
  model._id = id;
  model.name = name as never;
  return model;
}

function task(
  id: string,
  title: string,
  overrides: Partial<SecurityCaseTask> = {},
): SecurityCaseTask {
  const model: SecurityCaseTask = new SecurityCaseTask();
  model._id = id;
  model.title = title;
  model.isDone = false;
  Object.assign(model, overrides);
  return model;
}

function draw(): void {
  render(
    <MemoryRouter>
      <SecurityCaseTasks caseId={new ObjectID(CASE_ID)} />
    </MemoryRouter>,
  );
}

async function drawn(): Promise<void> {
  draw();
  await waitFor(() => {
    expect(getListMock).toHaveBeenCalled();
  });
  await screen.findByTestId(SECURITY_CASE_TASKS_TEST_IDS.card);
}

function rows(): Array<HTMLElement> {
  return screen.queryAllByTestId(SECURITY_CASE_TASKS_TEST_IDS.row);
}

function rowOf(title: string): HTMLElement {
  const row: HTMLElement | undefined = rows().find(
    (candidate: HTMLElement): boolean => {
      return (
        within(candidate).getByTestId(SECURITY_CASE_TASKS_TEST_IDS.title)
          .textContent === title
      );
    },
  );

  expect(row).toBeDefined();
  return row!;
}

async function openMore(title: string): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(
      within(rowOf(title)).getByTestId(SECURITY_CASE_TASKS_TEST_IDS.more),
    );
  });

  return screen.getByRole("menu");
}

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  permissions = [Permission.SecurityMember];
  colleagueChanges = [];
  dispatched = [];
  tasks = [
    task(TASK_A, "Reset the admin password", {
      isDone: true,
      doneAt: new Date("2026-10-14T11:55:00.000Z"),
      doneByUser: user(ANA, "Ana"),
      doneByUserId: new ObjectID(ANA),
      assignedToUser: user(ANA, "Ana"),
      assignedToUserId: new ObjectID(ANA),
    }),
    task(TASK_B, "Pull the proxy logs"),
  ];

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
    return permissions;
  });
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(ME));
  jest.spyOn(OneUptimeDate, "fromNow").mockReturnValue("5 minutes ago");
  jest.spyOn(Realtime, "listenToModelEvent").mockImplementation(((
    _event: unknown,
    onEvent: () => void,
  ) => {
    colleagueChanges.push(onEvent);
    return (): void => {};
  }) as never);
  jest.spyOn(GlobalEvents, "dispatchEvent").mockImplementation(((
    name: string,
  ): void => {
    dispatched.push(name);
  }) as never);

  getListMock.mockReset();
  getListMock.mockImplementation(async () => {
    return { data: tasks, count: tasks.length };
  });
  createMock.mockReset();
  createMock.mockResolvedValue({} as never);
  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);
  deleteItemMock.mockReset();
  deleteItemMock.mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a case's tasks", () => {
  test("are read the oldest first, the case's own, and each is drawn as a line", async () => {
    await drawn();

    expect(getListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: SecurityCaseTask,
        query: { securityCaseId: new ObjectID(CASE_ID) },
        select: SECURITY_CASE_TASK_SELECT,
        sort: { createdAt: SortOrder.Ascending },
        skip: 0,
        limit: 200,
      }),
    );

    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(
      rows().map((row: HTMLElement): string => {
        return within(row).getByTestId(SECURITY_CASE_TASKS_TEST_IDS.title)
          .textContent as string;
      }),
    ).toEqual(["Reset the admin password", "Pull the proxy logs"]);

    // Done: ticked, struck through, and who did it and when.
    const done: HTMLElement = rowOf("Reset the admin password");
    expect(done).toHaveAttribute("data-done", "true");
    expect(
      within(done).getByTestId(SECURITY_CASE_TASKS_TEST_IDS.checkbox),
    ).toBeChecked();
    expect(
      within(done).getByTestId(SECURITY_CASE_TASKS_TEST_IDS.doneLine),
    ).toHaveTextContent("Done by Ana 5 minutes ago");

    // Not done, and nobody has it.
    const open: HTMLElement = rowOf("Pull the proxy logs");
    expect(open).toHaveAttribute("data-done", "false");
    expect(
      within(open).queryByTestId(SECURITY_CASE_TASKS_TEST_IDS.doneLine),
    ).toBeNull();
    expect(
      within(open).getByTestId(SECURITY_CASE_TASKS_TEST_IDS.assignee),
    ).toHaveTextContent("Unassigned");

    expect(
      screen.getByTestId(SECURITY_CASE_TASKS_TEST_IDS.progress),
    ).toHaveTextContent("1 of 2 done");
  });

  test("none yet: the empty state says what the page is for, and there is no count", async () => {
    tasks = [];
    await drawn();

    expect(
      await screen.findByTestId(SECURITY_CASE_TASKS_TEST_IDS.empty),
    ).toHaveTextContent("No tasks yet");
    expect(
      screen.getByTestId(SECURITY_CASE_TASKS_TEST_IDS.empty),
    ).toHaveTextContent(
      "Add what this case needs done, then hand each task to whoever will do it.",
    );
    expect(
      screen.queryByTestId(SECURITY_CASE_TASKS_TEST_IDS.progress),
    ).toBeNull();
  });

  test("a new one is added trimmed, the list read again and the menu's count asked again", async () => {
    await drawn();

    const input: HTMLElement = await screen.findByTestId(
      SECURITY_CASE_TASKS_TEST_IDS.addInput,
    );
    const addButton: HTMLElement = screen.getByTestId(
      SECURITY_CASE_TASKS_TEST_IDS.addButton,
    );

    expect(addButton).toBeDisabled();
    fireEvent.change(input, { target: { value: "   " } });
    expect(addButton).toBeDisabled();

    fireEvent.change(input, { target: { value: "  Block the address  " } });
    expect(addButton).toBeEnabled();

    const readsBefore: number = getListMock.mock.calls.length;

    await act(async () => {
      fireEvent.submit(input.closest("form") as HTMLFormElement);
    });

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    const created: SecurityCaseTask = (
      createMock.mock.calls[0]![0] as { model: SecurityCaseTask }
    ).model;
    expect(created.title).toBe("Block the address");
    expect(created.securityCaseId?.toString()).toBe(CASE_ID);
    expect(created.projectId?.toString()).toBe(PROJECT_ID);

    await waitFor(() => {
      expect(getListMock.mock.calls.length).toBeGreaterThan(readsBefore);
    });
    expect(input).toHaveValue("");
    expect(dispatched).toContain(REFRESH_SIDEBAR_COUNT_EVENT);
  });

  test("a box ticks a task off and on again", async () => {
    await drawn();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    const open: HTMLElement = within(rowOf("Pull the proxy logs")).getByTestId(
      SECURITY_CASE_TASKS_TEST_IDS.checkbox,
    );
    expect(open).toHaveAttribute("title", "Mark Pull the proxy logs done");

    await act(async () => {
      fireEvent.click(open);
    });
    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: SecurityCaseTask,
          id: new ObjectID(TASK_B),
          data: { isDone: true },
        }),
      );
    });

    const done: HTMLElement = within(
      rowOf("Reset the admin password"),
    ).getByTestId(SECURITY_CASE_TASKS_TEST_IDS.checkbox);
    expect(done).toHaveAttribute(
      "title",
      "Mark Reset the admin password not done",
    );

    await act(async () => {
      fireEvent.click(done);
    });
    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: new ObjectID(TASK_A),
          data: { isDone: false },
        }),
      );
    });
    expect(dispatched).toContain(REFRESH_SIDEBAR_COUNT_EVENT);
  });

  test("the ⋯ hands a task to the reader, or takes it off whoever has it", async () => {
    await drawn();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    // Nobody has it: Assign to Me, and no Unassign.
    let menu: HTMLElement = await openMore("Pull the proxy logs");
    expect(
      within(menu).queryByRole("menuitem", { name: /Unassign/ }),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("menuitem", { name: /Assign to Me/ }),
      );
    });
    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: new ObjectID(TASK_B),
          data: { assignedToUserId: ME },
        }),
      );
    });

    // Ana has it: Unassign takes it off her.
    menu = await openMore("Reset the admin password");

    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: /Unassign/ }));
    });
    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: new ObjectID(TASK_A),
          data: { assignedToUserId: null },
        }),
      );
    });
  });

  test("a task the reader has offers no Assign to Me", async () => {
    tasks = [
      task(TASK_B, "Pull the proxy logs", {
        assignedToUser: user(ME, "Me"),
        assignedToUserId: new ObjectID(ME),
      }),
    ];
    await drawn();
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });

    const menu: HTMLElement = await openMore("Pull the proxy logs");

    expect(
      within(menu).queryByRole("menuitem", { name: /Assign to Me/ }),
    ).toBeNull();
    expect(
      within(menu).getByRole("menuitem", { name: /Assign to Someone Else/ }),
    ).toBeInTheDocument();
  });

  test("Delete Task asks first, saying the timeline keeps a record, then deletes it", async () => {
    await drawn();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    const menu: HTMLElement = await openMore("Pull the proxy logs");

    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("menuitem", { name: /Delete Task/ }),
      );
    });

    const dialog: HTMLElement = await screen.findByRole("dialog");

    // The task in bold, so it reads as the task and not part of the question.
    expect(
      within(dialog).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(
      "Delete Pull the proxy logs? The case's timeline keeps a record that it was deleted.",
    );
    const name: HTMLElement = within(dialog).getByTestId(
      SECURITY_CASE_TASKS_TEST_IDS.dialogTask,
    );
    expect(name.tagName).toBe("STRONG");
    expect(name).toHaveTextContent("Pull the proxy logs");
    expect(deleteItemMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: /Delete Task/ }),
      );
    });

    await waitFor(() => {
      expect(deleteItemMock).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: SecurityCaseTask,
          id: new ObjectID(TASK_B),
        }),
      );
    });
  });

  test("who has a task: a small avatar and the name on one line, the whole name under the pointer, and on a phone a line under the title", async () => {
    const longName: string = "Diego Fernando Alvarez-Montenegro de la Vega";
    tasks = [
      task(TASK_A, "Pull the proxy logs", {
        assignedToUser: user(ANA, longName),
        assignedToUserId: new ObjectID(ANA),
      }),
      task(TASK_B, "Rotate keys"),
    ];
    await drawn();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    const mine: HTMLElement = rowOf("Pull the proxy logs");

    // The column beside the task, from sm up: a fixed width, so avatars line up.
    const column: HTMLElement = within(mine).getByTestId(
      SECURITY_CASE_TASKS_TEST_IDS.assignee,
    );
    expect(column.className).toContain("max-sm:hidden");
    expect(column.className).toContain("w-44");
    expect(column).toHaveTextContent(longName);
    expect(within(column).getByTitle(longName)).toBeInTheDocument();
    // Initials on the avatar, from the name's words.
    expect(column).toHaveTextContent("DV");
    // The name keeps to one line and ends in an ellipsis.
    const name: HTMLElement = within(column).getByText(longName);
    expect(name.className).toContain("truncate");
    expect(name.className).toContain("text-sm");

    // On a phone: under the title, smaller.
    const line: HTMLElement = within(mine).getByTestId(
      SECURITY_CASE_TASKS_TEST_IDS.assigneeLine,
    );
    expect(line.className).toContain("sm:hidden");
    expect(within(line).getByText(longName).className).toContain("text-xs");

    // Nobody's: Unassigned in both places.
    const nobodys: HTMLElement = rowOf("Rotate keys");
    expect(
      within(nobodys).getByTestId(SECURITY_CASE_TASKS_TEST_IDS.assignee),
    ).toHaveTextContent("Unassigned");
    expect(
      within(nobodys).getByTestId(SECURITY_CASE_TASKS_TEST_IDS.assigneeLine),
    ).toHaveTextContent("Unassigned");
  });

  test("a task's ⋯ is a button, as every list row's is, named for what it holds", async () => {
    await drawn();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    const more: HTMLElement = within(rowOf("Pull the proxy logs")).getByTestId(
      SECURITY_CASE_TASKS_TEST_IDS.more,
    );
    expect(more.tagName).toBe("BUTTON");
    expect(more).toHaveAttribute("aria-label", "More task actions");
    expect(more).toHaveAttribute("aria-haspopup", "menu");
  });

  test("the line that adds a task is the product's text box, and takes what a task keeps", async () => {
    await drawn();

    const input: HTMLElement = await screen.findByTestId(
      SECURITY_CASE_TASKS_TEST_IDS.addInput,
    );
    expect(input.tagName).toBe("INPUT");
    // The product's own box: its border and its background, which the dark theme remaps.
    expect(input.className).toContain("border-gray-300");
    expect(input.className).toContain("bg-white");
    expect(input).toHaveAttribute("maxLength", "500");
    expect(input).toHaveAttribute(
      "placeholder",
      "Add a task, like Reset the user's password",
    );
    // Labelled for a screen reader.
    expect(screen.getByLabelText("New task")).toBe(input);
  });

  test("Assign Task asks who is doing the task, naming it in bold", async () => {
    await drawn();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    const menu: HTMLElement = await openMore("Pull the proxy logs");

    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("menuitem", { name: /Assign to Someone Else/ }),
      );
    });

    const dialog: HTMLElement = await screen.findByRole("dialog");
    const name: HTMLElement = within(dialog).getByTestId(
      SECURITY_CASE_TASKS_TEST_IDS.dialogTask,
    );
    expect(name.tagName).toBe("STRONG");
    expect(name).toHaveTextContent("Pull the proxy logs");
    expect(within(dialog).getByTestId("modal-description")).toHaveTextContent(
      "Who is doing Pull the proxy logs? They are told it is theirs.",
    );
  });

  test("a change that fails says why, and the list stays", async () => {
    updateByIdMock.mockRejectedValue(
      new HTTPErrorResponse(
        400,
        { message: "A task needs a title: what has to be done." },
        {},
      ) as never,
    );
    await drawn();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    await act(async () => {
      fireEvent.click(
        within(rowOf("Pull the proxy logs")).getByTestId(
          SECURITY_CASE_TASKS_TEST_IDS.checkbox,
        ),
      );
    });

    expect(
      await screen.findByText("A task needs a title: what has to be done."),
    ).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
  });

  test("a list that cannot be read says so, with a way to try again", async () => {
    getListMock.mockRejectedValue(
      new HTTPErrorResponse(
        500,
        { message: "This case's tasks could not be read." },
        {},
      ) as never,
    );
    await drawn();

    expect(
      await screen.findByTestId(SECURITY_CASE_TASKS_TEST_IDS.error),
    ).toHaveTextContent("This case's tasks could not be read.");
  });

  test("a Security Viewer sees the list, locked, and no line to add one", async () => {
    permissions = [Permission.SecurityViewer];
    await drawn();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    for (const row of rows()) {
      expect(
        within(row).getByTestId(SECURITY_CASE_TASKS_TEST_IDS.checkbox),
      ).toBeDisabled();
    }
    expect(
      screen.queryByTestId(SECURITY_CASE_TASKS_TEST_IDS.addInput),
    ).toBeNull();

    const menu: HTMLElement = await openMore("Pull the proxy logs");

    for (const item of within(menu).getAllByRole("menuitem")) {
      expect(item).toHaveAttribute("aria-disabled", "true");
    }
  });

  test("a colleague's change to a task reads the list again", async () => {
    await drawn();
    await waitFor(() => {
      expect(colleagueChanges.length).toBeGreaterThanOrEqual(3);
    });

    const readsBefore: number = getListMock.mock.calls.length;
    tasks = [
      ...tasks,
      task("33333333-3333-4333-8333-000000000003", "Rotate keys"),
    ];

    await act(async () => {
      colleagueChanges[0]!();
    });

    await waitFor(() => {
      expect(getListMock.mock.calls.length).toBeGreaterThan(readsBefore);
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
  });
});
