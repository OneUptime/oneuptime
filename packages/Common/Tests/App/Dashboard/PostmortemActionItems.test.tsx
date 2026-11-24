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
 * A postmortem's Action Items, on the incident's Postmortem page (#6801):
 *
 *   - the incident's items, oldest first, each a line - a box to tick it
 *     done, what it is, who owns it (or No owner), when it is due (overdue in
 *     red), Won't Do when the team decided not to, and how many are done of
 *     those still meant to be;
 *   - a new one typed into the line under the list, trimmed;
 *   - the items the postmortem's note lists that are not tracked yet, named,
 *     with one button that tracks them all, in the reader's time zone;
 *   - its ⋯: assign it, mark it won't do or reopen it, delete it after
 *     asking by name, create its monitor, and - with AI on and a repository
 *     OneUptime AI can work in - ask for its pull request or a test, or the
 *     one step before it, connecting a repository;
 *   - what it became: its code task's stage, linked to the task, and its
 *     pull request;
 *   - for someone who may only read: the list, locked, with no line to add;
 *   - a colleague's change reads the list again.
 */

const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();
const getRepositoriesMock: MockFunction = getJestMockFunction();
const getTaskSummariesMock: MockFunction = getJestMockFunction();

let aiOffered: boolean = true;

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
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi",
  () => {
    return {
      __esModule: true,
      default: {
        /*
         * The reader's repositories as a test gives them - whole - each read
         * answered from them as the server answers it (#10764).
         */
        getRepositories: async (...args: Array<unknown>) => {
          return asServerAnswer(
            await getRepositoriesMock(...args),
            args[0] as CodeRepositoriesQuery | undefined,
          );
        },
        getRepositoriesById: async (...args: Array<unknown>) => {
          const all: { repositories?: Array<CodeRepositoryListItem> } =
            ((await getRepositoriesMock({})) as {
              repositories?: Array<CodeRepositoryListItem>;
            }) || {};

          return answerRepositoriesById({
            repositories: all.repositories || [],
            ids: (args[0] as Array<string>) || [],
          });
        },
        getTaskSummaries: (...args: Array<unknown>) => {
          return getTaskSummariesMock(...args);
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/UseAiOffered", () => {
  return {
    __esModule: true,
    default: (): boolean => {
      return aiOffered;
    },
  };
});

import PostmortemActionItems from "../../../../App/FeatureSet/Dashboard/src/Components/Postmortem/ActionItems/PostmortemActionItems";
import { POSTMORTEM_ACTION_ITEMS_TEST_IDS } from "../../../../App/FeatureSet/Dashboard/src/Components/Postmortem/ActionItems/PostmortemActionItemsCopy";
import {
  CodeRepositoriesQuery,
  CodeRepositoryListItem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";
import {
  answerRepositoriesById,
  asServerAnswer,
  repositoriesSortingFirst,
} from "./CodeRepositoriesServer";
import { POSTMORTEM_ACTION_ITEM_SELECT } from "../../../../App/FeatureSet/Dashboard/src/Components/Postmortem/ActionItems/PostmortemActionItemsModel";
import IncidentPostmortemActionItem from "../../../Models/DatabaseModels/IncidentPostmortemActionItem";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import User from "../../../Models/DatabaseModels/User";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { CodeTaskState, CodeTaskSummaryJSON } from "../../../Types/AI/CodeTask";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import PostmortemActionItemStatus from "../../../Types/Incident/PostmortemActionItemStatus";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import Realtime from "../../../UI/Utils/Realtime";
import UserUtil from "../../../UI/Utils/User";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const INCIDENT_ID: string = "22222222-2222-4222-8222-222222222222";
const ME: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const ANA: string = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const ITEM_A: string = "33333333-3333-4333-8333-000000000001";
const ITEM_B: string = "33333333-3333-4333-8333-000000000002";
const ITEM_C: string = "33333333-3333-4333-8333-000000000003";
const TASK_ID: string = "44444444-4444-4444-8444-000000000001";
const REPOSITORY_ID: string = "55555555-5555-4555-8555-000000000001";
const MONITOR_ID: string = "66666666-6666-4666-8666-000000000001";

let permissions: Array<Permission>;
let items: Array<IncidentPostmortemActionItem>;
let colleagueChanges: Array<() => void>;
let posted: Array<{ url: string; data: JSONObject }>;
let navigatedTo: Array<string>;

function user(id: string, name: string): User {
  const model: User = new User();
  model._id = id;
  model.name = name as never;
  return model;
}

function actionItem(
  id: string,
  title: string,
  overrides: Partial<IncidentPostmortemActionItem> = {},
): IncidentPostmortemActionItem {
  const model: IncidentPostmortemActionItem =
    new IncidentPostmortemActionItem();
  model._id = id;
  model.title = title;
  model.status = PostmortemActionItemStatus.Open;
  Object.assign(model, overrides);
  return model;
}

function draw(note?: string): void {
  render(
    <MemoryRouter>
      <PostmortemActionItems
        incidentId={new ObjectID(INCIDENT_ID)}
        postmortemNote={note}
      />
    </MemoryRouter>,
  );
}

async function drawn(note?: string): Promise<void> {
  draw(note);
  await waitFor(() => {
    expect(getListMock).toHaveBeenCalled();
  });
  await screen.findByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.card);
}

function rows(): Array<HTMLElement> {
  return screen.queryAllByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.row);
}

function rowOf(title: string): HTMLElement {
  const row: HTMLElement | undefined = rows().find(
    (candidate: HTMLElement): boolean => {
      return (
        within(candidate).getByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.title)
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
      within(rowOf(title)).getByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.more),
    );
  });

  return screen.getByRole("menu");
}

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  permissions = [Permission.IncidentMember];
  aiOffered = true;
  colleagueChanges = [];
  posted = [];
  navigatedTo = [];
  items = [
    actionItem(ITEM_A, "Increase the connection pool", {
      status: PostmortemActionItemStatus.Done,
      closedAt: new Date("2026-11-14T11:55:00.000Z"),
      closedByUser: user(ANA, "Ana"),
      closedByUserId: new ObjectID(ANA),
      ownerUser: user(ANA, "Ana"),
      ownerUserId: new ObjectID(ANA),
    }),
    actionItem(ITEM_B, "Alert on pool usage", {
      dueDate: new Date("2026-11-10T00:00:00.000Z"),
    }),
    actionItem(ITEM_C, "Rewrite the auth service", {
      status: PostmortemActionItemStatus.WontDo,
      closedAt: new Date("2026-11-14T11:55:00.000Z"),
      closedByUser: user(ME, "Maya"),
      closedByUserId: new ObjectID(ME),
    }),
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
  jest
    .spyOn(OneUptimeDate, "getCurrentDate")
    .mockReturnValue(new Date("2026-11-15T12:00:00.000Z"));
  jest.spyOn(Realtime, "listenToModelEvent").mockImplementation(((
    _event: unknown,
    onEvent: () => void,
  ) => {
    colleagueChanges.push(onEvent);
    return (): void => {};
  }) as never);
  jest.spyOn(API, "post").mockImplementation((async (request: {
    url: { toString: () => string };
    data: JSONObject;
  }) => {
    posted.push({ url: request.url.toString(), data: request.data });
    return new HTTPResponse<JSONObject>(
      200,
      request.url.toString().endsWith("/start-code-task")
        ? { taskId: TASK_ID }
        : { trackedCount: 1, listedCount: 1 },
      {},
    );
  }) as never);
  jest.spyOn(Navigation, "navigate").mockImplementation(((route: {
    toString: () => string;
  }): void => {
    navigatedTo.push(route.toString());
  }) as never);

  getListMock.mockReset();
  getListMock.mockImplementation(async () => {
    return { data: items, count: items.length };
  });
  createMock.mockReset();
  createMock.mockResolvedValue({} as never);
  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);
  deleteItemMock.mockReset();
  deleteItemMock.mockResolvedValue({} as never);
  getRepositoriesMock.mockReset();
  getRepositoriesMock.mockResolvedValue({
    repositories: [
      {
        id: REPOSITORY_ID,
        name: "web",
        isConnected: true,
        provider: "GitHub",
        stats: {},
      },
    ],
    tasksWithoutRepositoryCount: 0,
  } as never);
  getTaskSummariesMock.mockReset();
  getTaskSummariesMock.mockResolvedValue([] as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("an incident's action items", () => {
  test("are read the oldest first, the incident's own, each drawn as a line", async () => {
    await drawn();

    expect(getListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: IncidentPostmortemActionItem,
        query: { incidentId: new ObjectID(INCIDENT_ID) },
        select: POSTMORTEM_ACTION_ITEM_SELECT,
        sort: { createdAt: SortOrder.Ascending },
        skip: 0,
        limit: 200,
      }),
    );

    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });

    // Done: ticked, struck through, who did it and when, its owner.
    const done: HTMLElement = rowOf("Increase the connection pool");
    expect(done).toHaveAttribute(
      "data-status",
      PostmortemActionItemStatus.Done,
    );
    expect(
      within(done).getByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.checkbox),
    ).toBeChecked();
    expect(
      within(done).getByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.closedLine),
    ).toHaveTextContent("Done by Ana 5 minutes ago");
    expect(
      within(done).getByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.owner),
    ).toHaveTextContent("Ana");

    // Open, nobody owns it, and its day is over: overdue.
    const open: HTMLElement = rowOf("Alert on pool usage");
    expect(
      within(open).getByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.owner),
    ).toHaveTextContent("No owner");
    const due: HTMLElement = within(open).getByTestId(
      POSTMORTEM_ACTION_ITEMS_TEST_IDS.due,
    );
    expect(due).toHaveAttribute("data-overdue", "true");
    expect(due).toHaveTextContent(/^Overdue, due /);
    expect(due).toHaveClass("text-red-700");

    // Won't do: closed, said so, who decided.
    const wontDo: HTMLElement = rowOf("Rewrite the auth service");
    expect(wontDo).toHaveTextContent("Won't Do");
    expect(
      within(wontDo).getByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.closedLine),
    ).toHaveTextContent("Won't do, decided by Maya 5 minutes ago");

    // Done of those still meant to be: the won't-do one is not counted.
    expect(
      screen.getByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.progress),
    ).toHaveTextContent("1 of 2 done");
  });

  test("none yet: the empty state says what they are for, with the line to add one", async () => {
    items = [];
    await drawn();

    expect(
      await screen.findByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.empty),
    ).toHaveTextContent("No action items yet");
    expect(
      screen.queryByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.progress),
    ).toBeNull();
    expect(
      screen.getByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.addInput),
    ).toBeInTheDocument();
  });

  test("a new one is added from the line under the list, trimmed, for the incident", async () => {
    items = [];
    await drawn();
    await screen.findByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.empty);

    const input: HTMLElement = screen.getByTestId(
      POSTMORTEM_ACTION_ITEMS_TEST_IDS.addInput,
    );
    const addButton: HTMLElement = screen.getByTestId(
      POSTMORTEM_ACTION_ITEMS_TEST_IDS.addButton,
    );

    // Nothing typed: nothing to add.
    expect(addButton).toBeDisabled();

    await act(async () => {
      fireEvent.change(input, {
        target: { value: "  Retry the payment call  " },
      });
    });
    await act(async () => {
      fireEvent.click(addButton);
    });

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledTimes(1);
    });
    const created: IncidentPostmortemActionItem = (
      createMock.mock.calls[0]![0] as { model: IncidentPostmortemActionItem }
    ).model;
    expect(created.title).toBe("Retry the payment call");
    expect(created.incidentId?.toString()).toBe(INCIDENT_ID);
    expect(created.projectId?.toString()).toBe(PROJECT_ID);
  });

  test("the box marks an item done, and done again open", async () => {
    await drawn();
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });

    await act(async () => {
      fireEvent.click(
        within(rowOf("Alert on pool usage")).getByTestId(
          POSTMORTEM_ACTION_ITEMS_TEST_IDS.checkbox,
        ),
      );
    });
    await act(async () => {
      fireEvent.click(
        within(rowOf("Increase the connection pool")).getByTestId(
          POSTMORTEM_ACTION_ITEMS_TEST_IDS.checkbox,
        ),
      );
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(2);
    });
    expect(updateByIdMock.mock.calls[0]![0]).toMatchObject({
      modelType: IncidentPostmortemActionItem,
      id: new ObjectID(ITEM_B),
      data: { status: PostmortemActionItemStatus.Done },
    });
    expect(updateByIdMock.mock.calls[1]![0]).toMatchObject({
      id: new ObjectID(ITEM_A),
      data: { status: PostmortemActionItemStatus.Open },
    });
  });

  test("a colleague's change reads the list again", async () => {
    await drawn();
    const reads: number = getListMock.mock.calls.length;

    await act(async () => {
      colleagueChanges[0]!();
    });

    await waitFor(() => {
      expect(getListMock.mock.calls.length).toBeGreaterThan(reads);
    });
  });
});

describe("its ⋯", () => {
  test("assigns it to the reader, marks it won't do, and reopens it", async () => {
    await drawn();
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });

    const menu: HTMLElement = await openMore("Alert on pool usage");
    await act(async () => {
      fireEvent.click(within(menu).getByText("Assign to Me"));
    });

    const second: HTMLElement = await openMore("Alert on pool usage");
    await act(async () => {
      fireEvent.click(within(second).getByText("Mark as Won't Do"));
    });

    const third: HTMLElement = await openMore("Rewrite the auth service");
    expect(within(third).queryByText("Mark as Won't Do")).toBeNull();
    await act(async () => {
      fireEvent.click(within(third).getByText("Reopen"));
    });

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(3);
    });
    expect(
      updateByIdMock.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as { data: unknown }).data;
      }),
    ).toEqual([
      { ownerUserId: ME },
      { status: PostmortemActionItemStatus.WontDo },
      { status: PostmortemActionItemStatus.Open },
    ]);
  });

  test("deletes it after asking, by name", async () => {
    await drawn();
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });

    const menu: HTMLElement = await openMore("Alert on pool usage");
    await act(async () => {
      fireEvent.click(within(menu).getByText("Delete Action Item"));
    });

    expect(
      screen.getByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.dialogItem),
    ).toHaveTextContent("Alert on pool usage");
    expect(deleteItemMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Delete Action Item" }),
      );
    });

    await waitFor(() => {
      expect(deleteItemMock).toHaveBeenCalledWith(
        expect.objectContaining({
          modelType: IncidentPostmortemActionItem,
          id: new ObjectID(ITEM_B),
        }),
      );
    });
  });

  test("Create Monitor opens Create Monitor for the item", async () => {
    await drawn();
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });

    const menu: HTMLElement = await openMore("Alert on pool usage");
    await act(async () => {
      fireEvent.click(within(menu).getByText("Create Monitor"));
    });

    expect(navigatedTo).toHaveLength(1);
    expect(navigatedTo[0]).toMatch(/\/monitors\/create\?/);
    expect(navigatedTo[0]).toContain(`postmortemActionItemId=${ITEM_B}`);
  });

  test("a closed item offers nothing it could become, and an item with a monitor no second one", async () => {
    items[1]!.monitorId = new ObjectID(MONITOR_ID);
    items[1]!.monitor = Object.assign(new Monitor(), { name: "Pool usage" });
    await drawn();
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });

    const done: HTMLElement = await openMore("Increase the connection pool");
    expect(within(done).queryByText("Create Monitor")).toBeNull();
    expect(within(done).queryByText("Open Pull Request with AI")).toBeNull();

    await act(async () => {
      fireEvent.keyDown(done, { key: "Escape" });
    });

    const withMonitor: HTMLElement = await openMore("Alert on pool usage");
    expect(within(withMonitor).queryByText("Create Monitor")).toBeNull();

    // The monitor it became, linked.
    expect(
      within(rowOf("Alert on pool usage")).getByTestId(
        POSTMORTEM_ACTION_ITEMS_TEST_IDS.monitor,
      ),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/monitors/${MONITOR_ID}`),
    );
  });
});

describe("a pull request or a test from OneUptime AI", () => {
  test("with AI on and a repository, both are offered, and asking starts the task in the repository", async () => {
    await drawn();
    await waitFor(() => {
      expect(getRepositoriesMock).toHaveBeenCalled();
    });

    const menu: HTMLElement = await openMore("Alert on pool usage");
    expect(within(menu).getByText("Write a Test with AI")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(menu).getByText("Open Pull Request with AI"));
    });

    // The dialog names the item, the one repository picked already.
    expect(
      screen.getByText("Open Pull Request with OneUptime AI"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.dialogItem),
    ).toHaveTextContent("Alert on pool usage");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ask OneUptime AI" }));
    });

    await waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted[0]!.url).toMatch(
      /\/incident-postmortem-action-item\/start-code-task$/,
    );
    expect(posted[0]!.data).toEqual({
      actionItemId: ITEM_B,
      kind: "PullRequest",
      repositoryId: REPOSITORY_ID,
    });
  });

  test("with AI off, neither is offered, and Code is not read", async () => {
    aiOffered = false;
    await drawn();
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });

    const menu: HTMLElement = await openMore("Alert on pool usage");
    expect(within(menu).queryByText("Open Pull Request with AI")).toBeNull();
    expect(within(menu).queryByText("Write a Test with AI")).toBeNull();
    expect(within(menu).queryByText("Connect a Repository")).toBeNull();
    expect(getRepositoriesMock).not.toHaveBeenCalled();
  });

  test("with no repository OneUptime AI reaches, the one step before it: Connect a Repository", async () => {
    getRepositoriesMock.mockResolvedValue({
      repositories: [
        {
          id: REPOSITORY_ID,
          name: "web",
          isConnected: false,
          provider: "GitHub",
          stats: {},
        },
      ],
      tasksWithoutRepositoryCount: 0,
    } as never);
    await drawn();
    await waitFor(() => {
      expect(getRepositoriesMock).toHaveBeenCalled();
    });

    const menu: HTMLElement = await openMore("Alert on pool usage");
    expect(within(menu).queryByText("Open Pull Request with AI")).toBeNull();

    await act(async () => {
      fireEvent.click(within(menu).getByText("Connect a Repository"));
    });

    expect(navigatedTo[0]).toMatch(/\/code$/);
  });

  /*
   * #10764: the dialog offered the connected repositories among the
   * project's first 500, so one past them could not be picked. Its field
   * searches every connected repository the reader may read on the server.
   */
  describe("past the project's first 10,000 repositories", () => {
    const WAREHOUSE_ID: string = "0000000a-0000-4000-8000-0000000c0de1";
    const WHARF_ID: string = "0000000a-0000-4000-8000-0000000c0de2";

    function manyRepositories(): Array<CodeRepositoryListItem> {
      return [
        ...repositoriesSortingFirst(10050),
        {
          id: WAREHOUSE_ID,
          name: "warehouse-api",
          organizationName: "harbour",
          repositoryName: "warehouse-api",
          isConnected: true,
          provider: "GitHub",
          stats: {
            working: 0,
            waitingForYou: 0,
            openPullRequests: 0,
            taskCount: 0,
          },
        },
        {
          id: WHARF_ID,
          name: "wharf-legacy",
          organizationName: "harbour",
          repositoryName: "wharf-legacy",
          isConnected: false,
          provider: "GitHub",
          stats: {
            working: 0,
            waitingForYou: 0,
            openPullRequests: 0,
            taskCount: 0,
          },
        },
      ];
    }

    async function openDialog(): Promise<void> {
      await drawn();
      await waitFor(() => {
        expect(getRepositoriesMock).toHaveBeenCalled();
      });

      const menu: HTMLElement = await openMore("Alert on pool usage");

      await act(async () => {
        fireEvent.click(within(menu).getByText("Open Pull Request with AI"));
      });
    }

    async function searchRepositories(text: string): Promise<void> {
      const field: HTMLElement = screen.getByTestId(
        POSTMORTEM_ACTION_ITEMS_TEST_IDS.repositoryPicker,
      );

      await act(async () => {
        fireEvent.focus(field);
        fireEvent.change(field, { target: { value: text } });
      });
    }

    test("whether to offer it is asked of the server: how many it can work in, never a list of 500", async () => {
      getRepositoriesMock.mockResolvedValue({
        repositories: manyRepositories(),
      } as never);

      await openDialog();

      expect(getRepositoriesMock).toHaveBeenCalledWith({
        group: "connected",
        order: "name",
        limit: 1,
      });
      // Several to choose from: none is picked for the person.
      expect(
        screen.getByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.repositoryPicker),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("entity-dropdown-value"),
      ).not.toBeInTheDocument();
    });

    test("a connected repository past them is found on the server, picked and asked in", async () => {
      getRepositoriesMock.mockResolvedValue({
        repositories: manyRepositories(),
      } as never);

      await openDialog();
      await searchRepositories("warehouse");

      const option: HTMLElement = await screen.findByRole("option", {
        name: /warehouse-api/,
      });

      // Searched among the connected ones, for what was typed.
      expect(getRepositoriesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          search: "warehouse",
          group: "connected",
        }),
      );
      // Its host's organization/name under it.
      expect(option).toHaveTextContent("harbour/warehouse-api");

      await act(async () => {
        fireEvent.click(option);
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Ask OneUptime AI" }),
        );
      });

      await waitFor(() => {
        expect(posted).toHaveLength(1);
      });
      expect(posted[0]!.data).toEqual({
        actionItemId: ITEM_B,
        kind: "PullRequest",
        repositoryId: WAREHOUSE_ID,
      });
    });

    test("one OneUptime cannot reach is never offered, however it is searched for", async () => {
      getRepositoriesMock.mockResolvedValue({
        repositories: manyRepositories(),
      } as never);

      await openDialog();
      await searchRepositories("wharf");

      await waitFor(() => {
        expect(getRepositoriesMock).toHaveBeenCalledWith(
          expect.objectContaining({ search: "wharf", group: "connected" }),
        );
      });
      expect(
        screen.queryByRole("option", { name: /wharf-legacy/ }),
      ).not.toBeInTheDocument();
    });

    test("the only one it can work in - past thousands it cannot - is picked already, by its name", async () => {
      getRepositoriesMock.mockResolvedValue({
        repositories: manyRepositories().map(
          (repository: CodeRepositoryListItem): CodeRepositoryListItem => {
            return repository.id === WAREHOUSE_ID
              ? repository
              : { ...repository, isConnected: false };
          },
        ),
      } as never);

      await openDialog();

      await waitFor(() => {
        expect(
          screen.getAllByTestId("entity-dropdown-value")[0],
        ).toHaveTextContent("warehouse-api");
      });

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Ask OneUptime AI" }),
        );
      });

      await waitFor(() => {
        expect(posted).toHaveLength(1);
      });
      expect(posted[0]!.data).toMatchObject({ repositoryId: WAREHOUSE_ID });
    });
  });

  test("an item whose pull request is open shows its stage and its pull request, and asks for none again", async () => {
    items[1]!.codeTaskId = new ObjectID(TASK_ID);
    getTaskSummariesMock.mockResolvedValue([
      {
        id: TASK_ID,
        title: "Alert on pool usage",
        recipe: "CodeRequest",
        state: CodeTaskState.Done,
        isQueued: false,
        createdAt: "2026-11-15T10:00:00.000Z",
        lastActivityAt: "2026-11-15T10:30:00.000Z",
        origin: { type: "Request" },
        turnCount: 1,
        pullRequest: {
          number: 12,
          url: "https://github.com/acme/web/pull/12",
          state: "open",
        },
      } as unknown as CodeTaskSummaryJSON,
    ] as never);
    await drawn();
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });

    const codeTask: HTMLElement = await within(
      rowOf("Alert on pool usage"),
    ).findByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.codeTask);
    await waitFor(() => {
      expect(
        within(codeTask).getByTestId("postmortem-action-item-code-task-stage"),
      ).toHaveAttribute("data-stage", "PullRequestOpen");
    });
    expect(within(codeTask).getByText("Pull request #12")).toBeInTheDocument();
    expect(within(codeTask).getAllByRole("link")[0]).toHaveAttribute(
      "href",
      expect.stringContaining(`/tasks/${TASK_ID}`),
    );

    const menu: HTMLElement = await openMore("Alert on pool usage");
    expect(within(menu).queryByText("Open Pull Request with AI")).toBeNull();
    expect(within(menu).queryByText("Write a Test with AI")).toBeNull();
  });
});

describe("the action items the postmortem's note lists", () => {
  const NOTE: string = `## Action Items
- [x] Increase the connection pool
- [ ] Page the database team on pool exhaustion
- [ ] Add a regression test for the auth leak`;

  test("those not tracked yet are named, with one button that tracks them all in the reader's time zone", async () => {
    await drawn(NOTE);

    const box: HTMLElement = await screen.findByTestId(
      POSTMORTEM_ACTION_ITEMS_TEST_IDS.track,
    );
    expect(box).toHaveTextContent(
      "The postmortem lists 2 action items that are not tracked yet.",
    );
    expect(box).toHaveTextContent("Page the database team on pool exhaustion");
    expect(box).toHaveTextContent("Add a regression test for the auth leak");
    // Tracked already, by its title: not offered again.
    expect(box).not.toHaveTextContent("Increase the connection pool");

    const button: HTMLElement = within(box).getByTestId(
      POSTMORTEM_ACTION_ITEMS_TEST_IDS.trackButton,
    );
    expect(button).toHaveTextContent("Track 2 Action Items");

    const reads: number = getListMock.mock.calls.length;

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(posted).toHaveLength(1);
    });
    expect(posted[0]!.url).toMatch(
      /\/incident-postmortem-action-item\/track-from-postmortem$/,
    );
    expect(posted[0]!.data).toEqual({
      incidentId: INCIDENT_ID,
      timezone: OneUptimeDate.getCurrentTimezone().toString(),
    });
    await waitFor(() => {
      expect(getListMock.mock.calls.length).toBeGreaterThan(reads);
    });
  });

  test("none to track once every one is tracked, and none for a note without them", async () => {
    items.push(
      actionItem(
        "33333333-3333-4333-8333-000000000004",
        "Page the database team on pool exhaustion",
      ),
      actionItem(
        "33333333-3333-4333-8333-000000000005",
        "add a regression test for the auth leak",
      ),
    );
    await drawn(NOTE);
    await waitFor(() => {
      expect(rows()).toHaveLength(5);
    });

    expect(
      screen.queryByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.track),
    ).toBeNull();

    cleanup();
    await drawn("## Impact\nCheckout was down for 12 minutes.");
    expect(
      screen.queryByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.track),
    ).toBeNull();
  });

  test("on an incident with none yet, the note's items stand in for the empty state", async () => {
    items = [];
    await drawn(NOTE);

    expect(
      await screen.findByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.track),
    ).toHaveTextContent("Track 3 Action Items");
    expect(
      screen.queryByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.empty),
    ).toBeNull();
  });
});

describe("for someone who may only read the incident", () => {
  test("the list is there, locked, with nothing to add or track", async () => {
    permissions = [Permission.IncidentViewer];
    await drawn(
      "## Action Items\n- [ ] Page the database team on pool exhaustion",
    );
    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });

    expect(
      within(rowOf("Alert on pool usage")).getByTestId(
        POSTMORTEM_ACTION_ITEMS_TEST_IDS.checkbox,
      ),
    ).toBeDisabled();
    expect(
      screen.queryByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.addInput),
    ).toBeNull();
    expect(
      screen.queryByTestId(POSTMORTEM_ACTION_ITEMS_TEST_IDS.track),
    ).toBeNull();
    // No Code read for someone who could not ask for a pull request.
    expect(getRepositoriesMock).not.toHaveBeenCalled();
  });
});
