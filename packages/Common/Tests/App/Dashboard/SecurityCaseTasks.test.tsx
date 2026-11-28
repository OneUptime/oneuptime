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
import type { SpyInstance } from "jest-mock";
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
 *     it with the whole name under the pointer: in a column of its own where
 *     the list is 34rem wide, a line under the title where it is narrower
 *     (a phone, or a case's card beside its side menu at 768px).
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
 *     line to add one; an empty list tells them why, as every empty list
 *     with a locked Create does.
 *   - Assign Task picks one project member in the picker a case's own Assign
 *     To has ("Choose someone"), and says they are notified.
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
import DataSecurityApi, {
  DataSecurityApiError,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import {
  isExposureAnswerShown,
  isExposureReadRefusal,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Exposure/CaseExposureRead";
import {
  ANSWER_SUMMARY_DRAFTED_ON_NOTICES,
  ANSWER_SUMMARY_TO_WRITE_ON_NOTICES,
  EXPOSURE_CARD_PLACE,
  EXPOSURE_TEST_IDS,
  NOT_ASSESSED_TITLE,
  READS_LOGGED,
  READS_NOT_LOGGED,
  WAS_IT_A_BREACH,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Exposure/ExposureAssessmentCopy";
import { getExposureCardRoute } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Exposure/ExposureTaskAnswer";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import SecurityCaseTask from "../../../Models/DatabaseModels/SecurityCaseTask";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import { ExposureDraftPart } from "../../../Types/DataSecurity/ExposureAssessment";
import {
  DATA_EXPOSURE_CHECKLIST_TASKS,
  ExposureChecklistItem,
  getExposureChecklistStepKey,
} from "../../../Types/DataSecurity/ExposureChecklist";
import { ImpactAssessmentSectionSource } from "../../../Types/DataSecurity/ImpactAssessment";
import { JSONArray } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getDataStoreEntityValue } from "../../../Types/SecurityCase/SecurityEntity";
import {
  EXPOSURE_NOT_ASSESSED,
  exposureAnswerOf,
  exposureAssessmentOf,
  exposureViewOf,
} from "../../Helpers/ExposureAssessmentAnswers";
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
    const doneLine: HTMLElement = within(done).getByTestId(
      SECURITY_CASE_TASKS_TEST_IDS.doneLine,
    );
    expect(doneLine).toHaveTextContent("Done by Ana 5 minutes ago");
    /*
     * Who ticked it off reads the way the name is written, in a
     * right-to-left sentence too: the name is isolated, as Evidence's
     * "Added by" draws its name.
     */
    expect(within(doneLine).getByText("Ana").tagName).toBe("BDI");

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
    // Drawn as every empty list on the case's pages is.
    expect(
      screen.getByTestId(SECURITY_CASE_TASKS_TEST_IDS.empty),
    ).toHaveAttribute("data-empty-state-kind", "empty");
    expect(
      screen.getByTestId(SECURITY_CASE_TASKS_TEST_IDS.empty),
    ).toHaveTextContent(
      "Add what this case needs done, then hand each task to whoever will do it.",
    );
    expect(
      screen.queryByTestId(SECURITY_CASE_TASKS_TEST_IDS.progress),
    ).toBeNull();
    // Whoever may add one is shown the line to do it, not told they cannot.
    expect(
      screen.queryByTestId(`${SECURITY_CASE_TASKS_TEST_IDS.empty}-note`),
    ).toBeNull();
    expect(
      screen.getByTestId(SECURITY_CASE_TASKS_TEST_IDS.addInput),
    ).toBeInTheDocument();
  });

  test("none yet, for a Security Viewer: no line to add one, and the empty state says why", async () => {
    permissions = [Permission.SecurityViewer];
    tasks = [];
    await drawn();

    const empty: HTMLElement = await screen.findByTestId(
      SECURITY_CASE_TASKS_TEST_IDS.empty,
    );
    expect(empty).toHaveTextContent("No tasks yet");
    // As every empty list with a locked Create says it (ModelTableEmptyState).
    expect(
      within(empty).getByTestId(`${SECURITY_CASE_TASKS_TEST_IDS.empty}-note`),
    ).toHaveTextContent(
      "You don't have permission to create these. Ask a Project Admin for access.",
    );
    expect(
      screen.queryByTestId(SECURITY_CASE_TASKS_TEST_IDS.addInput),
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

  test("who has a task: a small avatar and the name on one line, the whole name under the pointer, and in a narrow list a line under the title", async () => {
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

    /*
     * The list is a size container: the column beside the task where it is
     * 34rem wide, a fixed width so the avatars line up; the line under the
     * title where it is narrower.
     */
    expect(
      screen.getByTestId(SECURITY_CASE_TASKS_TEST_IDS.list).className,
    ).toContain("[container-type:inline-size]");
    const column: HTMLElement = within(mine).getByTestId(
      SECURITY_CASE_TASKS_TEST_IDS.assignee,
    );
    expect(column.className).toContain(
      "[@container(max-width:33.99rem)]:hidden",
    );
    expect(column.className).toContain("w-44");
    expect(column).toHaveTextContent(longName);
    expect(within(column).getByTitle(longName)).toBeInTheDocument();
    // Initials on the avatar, from the name's words.
    expect(column).toHaveTextContent("DV");
    // The name keeps to one line and ends in an ellipsis.
    const name: HTMLElement = within(column).getByText(longName);
    expect(name.className).toContain("truncate");
    expect(name.className).toContain("text-sm");

    // In a narrow list: under the title, smaller.
    const line: HTMLElement = within(mine).getByTestId(
      SECURITY_CASE_TASKS_TEST_IDS.assigneeLine,
    );
    expect(line.className).toContain("[@container(min-width:34rem)]:hidden");
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

  test("Assign Task asks for one person to do the task, naming it in bold, in the picker a case's Assign To has", async () => {
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
      "Pick a person to do Pull the proxy logs. They are notified.",
    );

    // One person, as a case's own Assign To picks one - never a bare "Add".
    expect(
      within(dialog).getByRole("button", { name: "Choose someone" }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Add" })).toBeNull();
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

    // As every list on the case's pages says it: what, why, and Try again.
    const error: HTMLElement = await screen.findByTestId(
      SECURITY_CASE_TASKS_TEST_IDS.error,
    );
    expect(error).toHaveAttribute("data-empty-state-kind", "error");
    expect(
      within(error).getByTestId(`${SECURITY_CASE_TASKS_TEST_IDS.error}-title`),
    ).toHaveTextContent("Couldn't load tasks");
    expect(error).toHaveTextContent("This case's tasks could not be read.");

    const readsBefore: number = getListMock.mock.calls.length;
    getListMock.mockImplementation(async () => {
      return { data: tasks, count: tasks.length };
    });

    await act(async () => {
      fireEvent.click(within(error).getByRole("button", { name: "Try again" }));
    });

    await waitFor(() => {
      expect(getListMock.mock.calls.length).toBeGreaterThan(readsBefore);
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
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

/*
 * EACH CHECKLIST TASK'S ANSWER, ON THE TASKS PAGE (#10954).
 *
 * The Close a Data Exposure playbook adds four tasks to a case about an
 * exposed store; the Was It a Breach? card answers each. Under each such
 * task - matched by its key, else by its title as the playbook wrote it -
 * the Tasks page draws the card's answer in one quiet line, with a link that
 * lands on the card. The assessment is read once for the page, again when
 * the case changes, only for a case about a data store, and only drawn for
 * a reader the server lets read it.
 */
describe("each checklist task's answer, from the exposure assessment", () => {
  const STORE_ENTITIES: JSONArray = [
    {
      type: "Data Store",
      value: getDataStoreEntityValue("aws:s3:eu-customer-exports"),
    },
  ];
  const WHO_READ: string = "33333333-3333-4333-8333-0000000000a1";
  const REPORT: string = "33333333-3333-4333-8333-0000000000a2";
  const ROTATE: string = "33333333-3333-4333-8333-0000000000a3";
  const CLOSE: string = "33333333-3333-4333-8333-0000000000a4";
  const WHO_READ_TITLE: string =
    DATA_EXPOSURE_CHECKLIST_TASKS[ExposureChecklistItem.WhoReadIt];
  const REPORT_TITLE: string =
    DATA_EXPOSURE_CHECKLIST_TASKS[ExposureChecklistItem.MustReport];
  const ROTATE_TITLE: string =
    DATA_EXPOSURE_CHECKLIST_TASKS[ExposureChecklistItem.RotateSecrets];
  const CLOSE_TITLE: string =
    DATA_EXPOSURE_CHECKLIST_TASKS[ExposureChecklistItem.CloseTheCase];
  let exposureReads: SpyInstance<typeof DataSecurityApi.getExposureAssessment>;

  function checklistTasks(): Array<SecurityCaseTask> {
    return [
      // Made from the playbook: each keeps its line's key.
      task(WHO_READ, WHO_READ_TITLE, {
        responseStepKey: getExposureChecklistStepKey(
          ExposureChecklistItem.WhoReadIt,
        ),
      }),
      task(REPORT, REPORT_TITLE, {
        responseStepKey: getExposureChecklistStepKey(
          ExposureChecklistItem.MustReport,
        ),
      }),
      // Added by hand in the playbook's words: matched by its title.
      task(ROTATE, ROTATE_TITLE, { isDone: true }),
      task(CLOSE, CLOSE_TITLE, {
        responseStepKey: getExposureChecklistStepKey(
          ExposureChecklistItem.CloseTheCase,
        ),
      }),
      // A task of the case's own: no answer.
      task(TASK_B, "Pull the proxy logs"),
    ];
  }

  function drawAboutAStore(
    entities: JSONArray | undefined = STORE_ENTITIES,
  ): (refreshToken: string) => void {
    const drawnTasks: ReturnType<typeof render> = render(
      <MemoryRouter>
        <SecurityCaseTasks
          caseId={new ObjectID(CASE_ID)}
          entities={entities}
          refreshToken="first"
        />
      </MemoryRouter>,
    );

    return (refreshToken: string): void => {
      drawnTasks.rerender(
        <MemoryRouter>
          <SecurityCaseTasks
            caseId={new ObjectID(CASE_ID)}
            entities={entities}
            refreshToken={refreshToken}
          />
        </MemoryRouter>,
      );
    };
  }

  function answerUnder(title: string): HTMLElement | null {
    return within(rowOf(title)).queryByTestId(EXPOSURE_TEST_IDS.taskAnswer);
  }

  async function allFourAnswered(): Promise<void> {
    await waitFor(() => {
      expect(screen.getAllByTestId(EXPOSURE_TEST_IDS.taskAnswer)).toHaveLength(
        4,
      );
    });
  }

  beforeEach(() => {
    tasks = checklistTasks();
    exposureReads = jest
      .spyOn(DataSecurityApi, "getExposureAssessment")
      .mockResolvedValue(exposureAnswerOf());
  });

  test("a task's key is read with it, so a checklist task is known by its key", () => {
    expect(SECURITY_CASE_TASK_SELECT).toEqual(
      expect.objectContaining({ responseStepKey: true }),
    );
  });

  test("under each checklist task, the card's answer in one quiet line; none under the case's own task", async () => {
    drawAboutAStore();
    await allFourAnswered();

    expect(exposureReads).toHaveBeenCalledTimes(1);
    expect(exposureReads).toHaveBeenCalledWith(new ObjectID(CASE_ID));

    const whoRead: HTMLElement = answerUnder(WHO_READ_TITLE)!;

    // The brief's words: reads not logged, so the data is treated as read.
    expect(whoRead).toHaveTextContent(READS_NOT_LOGGED);
    expect(whoRead).toHaveAttribute(
      "data-item",
      ExposureChecklistItem.WhoReadIt,
    );
    // Quiet: small grey words under the task, never louder than it.
    expect(whoRead.className).toContain("text-xs");
    expect(whoRead.className).toContain("text-gray-600");

    expect(answerUnder(REPORT_TITLE)).toHaveTextContent(
      "GDPR Article 33 may apply first",
    );
    expect(answerUnder(ROTATE_TITLE)).toHaveTextContent("1 secret to rotate.");
    // The summary is not below the task: the answer says where it is.
    expect(answerUnder(CLOSE_TITLE)).toHaveTextContent(
      ANSWER_SUMMARY_TO_WRITE_ON_NOTICES,
    );
    expect(answerUnder(CLOSE_TITLE)).not.toHaveTextContent("below");
    expect(answerUnder("Pull the proxy logs")).toBeNull();
  });

  test("a written internal summary is named where it is, in Breach Notices", async () => {
    exposureReads.mockResolvedValue(
      exposureAnswerOf({
        assessment: exposureAssessmentOf({
          sections: {
            [ExposureDraftPart.InternalSummary]: {
              part: ExposureDraftPart.InternalSummary,
              markdown:
                "eu-customer-exports was public for nine days; reads were not logged.",
              source: ImpactAssessmentSectionSource.Edited,
              factKeys: [],
              editedAt: "2026-11-11T11:00:00.000Z",
            },
          },
        }),
      }),
    );
    drawAboutAStore();
    await allFourAnswered();

    expect(answerUnder(CLOSE_TITLE)).toHaveTextContent(
      ANSWER_SUMMARY_DRAFTED_ON_NOTICES,
    );
  });

  test("the answer sits under the task's title, before who has it", async () => {
    drawAboutAStore();
    await allFourAnswered();

    const row: HTMLElement = rowOf(WHO_READ_TITLE);
    const title: HTMLElement = within(row).getByTestId(
      SECURITY_CASE_TASKS_TEST_IDS.title,
    );
    const answer: HTMLElement = answerUnder(WHO_READ_TITLE)!;
    const assignee: HTMLElement = within(row).getByTestId(
      SECURITY_CASE_TASKS_TEST_IDS.assigneeLine,
    );

    expect(
      title.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      answer.compareDocumentPosition(assignee) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a done task keeps its answer, under its struck-through title", async () => {
    drawAboutAStore();
    await allFourAnswered();

    expect(rowOf(ROTATE_TITLE)).toHaveAttribute("data-done", "true");
    expect(answerUnder(ROTATE_TITLE)).toBeInTheDocument();
  });

  test("each answer links to the Was It a Breach? card on the case's Overview", async () => {
    drawAboutAStore();
    await allFourAnswered();

    for (const line of screen.getAllByTestId(EXPOSURE_TEST_IDS.taskAnswer)) {
      const href: string =
        within(line)
          .getByRole("link", { name: WAS_IT_A_BREACH })
          .getAttribute("href") || "";

      // The Overview, not its Tasks, landing on the card.
      expect(href).toContain(`/security-events/cases/${CASE_ID}`);
      expect(href).not.toContain("/tasks");
      expect(href.endsWith(`#${EXPOSURE_CARD_PLACE}`)).toBe(true);
    }

    expect(getExposureCardRoute(new ObjectID(CASE_ID)).toString()).toBe(
      `${RouteUtil.populateRouteParams(
        RouteMap[PageMap.SECURITY_CASE_VIEW] as Route,
        { modelId: new ObjectID(CASE_ID) },
      ).toString()}#${EXPOSURE_CARD_PLACE}`,
    );
  });

  test("a task a person renamed is theirs: no key, a new title, no answer; the playbook's title in other capitals is still its line", async () => {
    tasks = [
      task(WHO_READ, "Ask the vendor whether they read it"),
      task(REPORT, REPORT_TITLE.toUpperCase()),
    ];
    drawAboutAStore();

    await waitFor(() => {
      expect(answerUnder(REPORT_TITLE.toUpperCase())).toBeInTheDocument();
    });
    expect(answerUnder("Ask the vendor whether they read it")).toBeNull();
  });

  test("read once for the page: a colleague's task change reads the tasks again, not the assessment", async () => {
    drawAboutAStore();
    await allFourAnswered();
    await waitFor(() => {
      expect(colleagueChanges.length).toBeGreaterThanOrEqual(3);
    });

    const tasksBefore: number = getListMock.mock.calls.length;

    await act(async () => {
      colleagueChanges[1]!();
    });
    await waitFor(() => {
      expect(getListMock.mock.calls.length).toBeGreaterThan(tasksBefore);
    });
    expect(exposureReads).toHaveBeenCalledTimes(1);
  });

  test("a change to the case reads the assessment again, and each answer says what it says now", async () => {
    const refresh: (refreshToken: string) => void = drawAboutAStore();

    await waitFor(() => {
      expect(answerUnder(WHO_READ_TITLE)).toHaveTextContent(READS_NOT_LOGGED);
    });

    exposureReads.mockResolvedValue(
      exposureAnswerOf({ view: exposureViewOf({ accessLogging: true }) }),
    );

    await act(async () => {
      refresh("second");
    });

    await waitFor(() => {
      expect(exposureReads).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(answerUnder(WHO_READ_TITLE)).toHaveTextContent(READS_LOGGED);
    });
  });

  test("a case about no data store reads no assessment, and draws no answer", async () => {
    drawAboutAStore([{ type: "IP Address", value: "203.0.113.9" }]);

    await waitFor(() => {
      expect(rows()).toHaveLength(5);
    });
    expect(exposureReads).not.toHaveBeenCalled();
    expect(screen.queryByTestId(EXPOSURE_TEST_IDS.taskAnswer)).toBeNull();

    // A case whose entities were not read: the page as it was before.
    cleanup();
    draw();

    await waitFor(() => {
      expect(rows()).toHaveLength(5);
    });
    expect(exposureReads).not.toHaveBeenCalled();
    expect(screen.queryByTestId(EXPOSURE_TEST_IDS.taskAnswer)).toBeNull();
  });

  test("a reader the server refuses sees the tasks as they are: no answer, and no error", async () => {
    exposureReads.mockRejectedValue(
      new DataSecurityApiError("Ask a Project Admin for a role.", 403),
    );
    drawAboutAStore();

    await waitFor(() => {
      expect(exposureReads).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(5);
    });
    expect(screen.queryByTestId(EXPOSURE_TEST_IDS.taskAnswer)).toBeNull();
    expect(
      screen.queryByText("Ask a Project Admin for a role."),
    ).not.toBeInTheDocument();
    expect(isExposureReadRefusal(new DataSecurityApiError("", 403))).toBe(true);
    expect(isExposureReadRefusal(new DataSecurityApiError("", 422))).toBe(true);
    expect(isExposureReadRefusal(new DataSecurityApiError("", 500))).toBe(
      false,
    );
  });

  test("a read that fails leaves the tasks as they are", async () => {
    exposureReads.mockRejectedValue(new Error("The server could not answer."));
    drawAboutAStore();

    await waitFor(() => {
      expect(exposureReads).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(5);
    });
    expect(screen.queryByTestId(EXPOSURE_TEST_IDS.taskAnswer)).toBeNull();
    expect(
      screen.queryByText("The server could not answer."),
    ).not.toBeInTheDocument();
  });

  test("a case not assessed yet says so under each checklist task, with the link to the card where it is assessed", async () => {
    exposureReads.mockResolvedValue(exposureAnswerOf(EXPOSURE_NOT_ASSESSED));
    drawAboutAStore();
    await allFourAnswered();

    for (const line of screen.getAllByTestId(EXPOSURE_TEST_IDS.taskAnswer)) {
      expect(line).toHaveTextContent(NOT_ASSESSED_TITLE);
      expect(
        within(line).getByRole("link", { name: WAS_IT_A_BREACH }),
      ).toBeInTheDocument();
    }
  });

  test("a case about no store the reader may read draws no answer, as the Overview draws no card", async () => {
    exposureReads.mockResolvedValue(
      exposureAnswerOf({ ...EXPOSURE_NOT_ASSESSED, stores: [] }),
    );
    drawAboutAStore();

    await waitFor(() => {
      expect(exposureReads).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(rows()).toHaveLength(5);
    });
    expect(screen.queryByTestId(EXPOSURE_TEST_IDS.taskAnswer)).toBeNull();
    expect(isExposureAnswerShown(null)).toBe(false);
    expect(
      isExposureAnswerShown(
        exposureAnswerOf({ ...EXPOSURE_NOT_ASSESSED, stores: [] }),
      ),
    ).toBe(false);
    expect(isExposureAnswerShown(exposureAnswerOf(EXPOSURE_NOT_ASSESSED))).toBe(
      true,
    );
    expect(isExposureAnswerShown(exposureAnswerOf())).toBe(true);
  });
});
