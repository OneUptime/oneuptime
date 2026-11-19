import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import HostCollectorConfigService from "../../../Server/Services/HostCollectorConfigService";
import IncidentReminderRuleService from "../../../Server/Services/IncidentReminderRuleService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import PublicNoteApprovalStepService from "../../../Server/Services/PublicNoteApprovalStepService";
import HostCollectorProjectConfigsMemo from "../../../Server/Utils/HostCollector/HostCollectorProjectConfigsMemo";
import PublicNoteApproverChanges from "../../../Server/Utils/Notes/PublicNoteApproverChanges";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { MoveInListResult } from "../../../Types/Database/MoveInList";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import { PublicNoteApprovalEventType } from "../../../Types/StatusPage/PublicNoteApproval";
import {
  ListOrderItem,
  getListOrderValue,
  moveListItem,
  sortListOrderItems,
} from "../../../Utils/ListOrder";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryHookFreeWrites,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import {
  ListMoveTransactions,
  useInMemoryListMoves,
} from "../TestingUtils/ListMovesInMemory";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  PROJECT_ID,
  rejectionOf,
  strangerProps,
  viewerProps,
} from "./ContiguousOrderCases";
import {
  LIST_ORDER_CASES,
  ListOrderCase,
  listAdminProps,
  listRow,
  numbersById,
} from "./ListOrderCases";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * MOVING A ROW OF A DRAG-ORDERED LIST IS ITS OWN REQUEST (issue #9609).
 *
 * A write of a list's number places that row alone, which is what Terraform
 * needs (ListOrderConverges). A drag in the Dashboard means more: the row
 * takes the place of the row it was dropped on, and the rows between step
 * aside. That is the move (POST <list>/:id/move), here through the real
 * moveInList of every drag-ordered list's service: the list is read and
 * written in one transaction that locks its rows (ListMovesInMemory runs
 * them one after another, as the locks do), put in order as the list shows
 * it, and numbered from the top - n..1 for a list that counts down. The
 * caller must be allowed to change the row's number, the row named must be
 * in the same list, and nothing of another list or project moves.
 *
 * Then what a list's rules make of a move: a path's built-in states keep
 * their order, what a write of the numbers sets off follows a move (state
 * caches, reminder schedules, collector configs, waiting public notes),
 * the audit log records each row renumbered, and a list of one kind (a
 * public note approval step's event type) is moved apart from the other.
 */

beforeEach(() => {
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The rows of the list under test: six, at 1..6, created in that order.
const LIST_ROWS: Array<string> = [
  "9c000000-0000-4000-8000-0000000000d1",
  "9c000000-0000-4000-8000-0000000000d2",
  "9c000000-0000-4000-8000-0000000000d3",
  "9c000000-0000-4000-8000-0000000000d4",
  "9c000000-0000-4000-8000-0000000000d5",
  "9c000000-0000-4000-8000-0000000000d6",
];

// Another project's list of two.
const OTHER_ROWS: Array<string> = [
  "9c000000-0000-4000-8000-0000000000b1",
  "9c000000-0000-4000-8000-0000000000b2",
];

const OTHER_LIST: Record<string, number> = {
  [OTHER_ROWS[0]!]: 1,
  [OTHER_ROWS[1]!]: 2,
};

function startingRows(listCase: ListOrderCase): Array<StoredRow> {
  return [
    ...LIST_ROWS.map((id: string, index: number): StoredRow => {
      return listRow({ listCase, id, order: index + 1, n: index + 1 });
    }),
    ...OTHER_ROWS.map((id: string, index: number): StoredRow => {
      return listRow({
        listCase,
        id,
        order: index + 1,
        n: index + 1,
        isOtherList: true,
      });
    }),
  ];
}

// The list's rows top first, as the list shows them, by id.
function shownOrder(table: InMemoryTable, listCase: ListOrderCase): string[] {
  const numbers: Record<string, number | null> = numbersById(table, listCase);

  return sortListOrderItems(
    Object.entries(numbers).map(
      ([id, value]: [string, number | null]): ListOrderItem => {
        return {
          id: id,
          value: value,
          createdAt: table.get(id)?.["createdAt"] as Date,
        };
      },
    ),
    listCase.settings.sortOrder,
  ).map((item: ListOrderItem): string => {
    return item.id;
  });
}

// The numbers a list shown in `order` holds, numbered from the top.
function numberedFromTheTop(
  listCase: ListOrderCase,
  order: Array<string>,
): Record<string, number> {
  const numbers: Record<string, number> = {};

  order.forEach((id: string, index: number) => {
    numbers[id] = getListOrderValue({
      position: index + 1,
      count: order.length,
      sortOrder: listCase.settings.sortOrder,
    });
  });

  return numbers;
}

async function move(
  listCase: ListOrderCase,
  data: {
    id: string;
    placeOfId: string;
    props?: DatabaseCommonInteractionProps | undefined;
  },
): Promise<MoveInListResult> {
  return await listCase.service.moveInList({
    id: new ObjectID(data.id),
    placeOfId: new ObjectID(data.placeOfId),
    props: data.props || listAdminProps(),
  });
}

describe.each(LIST_ORDER_CASES)("$label", (listCase: ListOrderCase) => {
  let table: InMemoryTable;
  let transactions: ListMoveTransactions;

  beforeEach(() => {
    table = useInMemoryTable(listCase.service, startingRows(listCase));
    useInMemoryHookFreeWrites(listCase.service, table);
    transactions = useInMemoryListMoves({
      service: listCase.service,
      table: table,
    });

    listCase.stubCollaborators?.();
  });

  test("the bottom row moved to the top row's place takes it, and the list is numbered from the top", async () => {
    const before: Array<string> = shownOrder(table, listCase);

    const result: MoveInListResult = await move(listCase, {
      id: before[5]!,
      placeOfId: before[0]!,
    });

    const expected: Array<string> = moveListItem(before, 5, 0);

    expect(shownOrder(table, listCase)).toEqual(expected);
    expect(numbersById(table, listCase)).toEqual(
      numberedFromTheTop(listCase, expected),
    );
    expect(numbersById(table, listCase, true)).toEqual(OTHER_LIST);

    // Every row stepped one place, and the moved one came up: all six renumbered.
    expect(result.changedRows).toHaveLength(6);
  });

  test("a row moved down lands just below the row named, and only the rows between are written", async () => {
    const before: Array<string> = shownOrder(table, listCase);

    const result: MoveInListResult = await move(listCase, {
      id: before[1]!,
      placeOfId: before[3]!,
    });

    const expected: Array<string> = moveListItem(before, 1, 3);

    expect(shownOrder(table, listCase)).toEqual(expected);
    expect(
      result.changedRows
        .map((row: { id: string }): string => {
          return row.id;
        })
        .sort(),
    ).toEqual([before[1]!, before[2]!, before[3]!].sort());
    expect(
      table.updates
        .map((update: { id: string }): string => {
          return update.id;
        })
        .sort(),
    ).toEqual([before[1]!, before[2]!, before[3]!].sort());
  });

  test("a row moved to its own place writes nothing", async () => {
    const result: MoveInListResult = await move(listCase, {
      id: LIST_ROWS[2]!,
      placeOfId: LIST_ROWS[2]!,
    });

    expect(result.changedRows).toEqual([]);
    expect(table.updates).toEqual([]);
  });

  /*
   * A list written through the API - by Terraform, say - can have gaps,
   * twins (read the older first) and rows without a number (read last). A
   * move goes by the order the list shows, and numbers it from the top.
   */
  test("a move in a list with gaps, twins and a row without a number lands where it was dropped", async () => {
    const numbers: Array<number | null> = [3, 3, 10, 40, 40, null];

    LIST_ROWS.forEach((id: string, index: number) => {
      table.get(id)![listCase.settings.column] = numbers[index];
    });

    const before: Array<string> = shownOrder(table, listCase);

    await move(listCase, { id: before[4]!, placeOfId: before[1]! });

    const expected: Array<string> = moveListItem(before, 4, 1);

    expect(shownOrder(table, listCase)).toEqual(expected);
    expect(numbersById(table, listCase)).toEqual(
      numberedFromTheTop(listCase, expected),
    );
  });

  test("answers each row given another number, with its number now", async () => {
    const before: Array<string> = shownOrder(table, listCase);

    const result: MoveInListResult = await move(listCase, {
      id: before[2]!,
      placeOfId: before[1]!,
    });

    const numbers: Record<string, number | null> = numbersById(
      table,
      listCase,
    );

    expect(result.changedRows).toHaveLength(2);

    for (const row of result.changedRows) {
      expect(numbers[row.id]).toBe(row.order);
    }
  });

  test("the place of a row of another list is refused, and nothing moves", async () => {
    const error: unknown = await rejectionOf(
      move(listCase, { id: LIST_ROWS[2]!, placeOfId: OTHER_ROWS[0]! }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toContain("is not in the same list");
    expect(table.updates).toEqual([]);
    expect(numbersById(table, listCase, true)).toEqual(OTHER_LIST);
  });

  test("a member who may only look is refused, and nothing moves", async () => {
    const error: unknown = await rejectionOf(
      move(listCase, {
        id: LIST_ROWS[2]!,
        placeOfId: LIST_ROWS[0]!,
        props: viewerProps(),
      }),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(transactions.opened).toBe(0);
    expect(table.updates).toEqual([]);
  });

  test("an owner of another project naming this project's row is told it is not found, and nothing moves", async () => {
    const error: unknown = await rejectionOf(
      move(listCase, {
        id: LIST_ROWS[2]!,
        placeOfId: LIST_ROWS[0]!,
        props: strangerProps(),
      }),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(transactions.opened).toBe(0);
    expect(table.updates).toEqual([]);
    expect(numbersById(table, listCase, true)).toEqual(OTHER_LIST);
  });

  test("a row deleted before its move is told it is not found, and nothing moves", async () => {
    table.rows = table.rows.filter((row: StoredRow): boolean => {
      return row["_id"] !== LIST_ROWS[2];
    });

    const error: unknown = await rejectionOf(
      move(listCase, { id: LIST_ROWS[2]!, placeOfId: LIST_ROWS[0]! }),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(table.updates).toEqual([]);
  });

  /*
   * The move reads and writes its list in one transaction that holds the
   * list's rows: two at once run one after the other, the second on the
   * list as the first left it - never two rows at one number.
   */
  test("two moves at once run one after the other, and leave the list numbered from the top", async () => {
    await Promise.all([
      move(listCase, { id: LIST_ROWS[5]!, placeOfId: LIST_ROWS[0]! }),
      move(listCase, { id: LIST_ROWS[0]!, placeOfId: LIST_ROWS[3]! }),
    ]);

    expect(transactions.opened).toBe(2);
    expect(numbersById(table, listCase)).toEqual(
      numberedFromTheTop(listCase, shownOrder(table, listCase)),
    );
  });

  test("reads and writes the list in one transaction that locks its rows, by its own number column", async () => {
    await move(listCase, { id: LIST_ROWS[5]!, placeOfId: LIST_ROWS[0]! });

    expect(transactions.opened).toBe(1);
    expect(transactions.statements).toHaveLength(2);
    expect(transactions.statements[0]).toContain("FOR UPDATE");
    expect(transactions.statements[0]).toContain(
      `"${listCase.settings.column}" AS "order"`,
    );
    expect(transactions.statements[0]).toContain('"projectId"');

    for (const scopeColumn of listCase.settings.scopeColumns) {
      expect(transactions.statements[0]).toContain(`"${scopeColumn}"`);
    }

    expect(transactions.statements[1]).toMatch(
      new RegExp(`^UPDATE "\\w+" AS "row" SET "${listCase.settings.column}"`),
    );
  });
});

describe("a path's built-in states keep their order on a move", () => {
  const CREATED: string = "9c000000-0000-4000-8000-0000000000e1";
  const ACKNOWLEDGED: string = "9c000000-0000-4000-8000-0000000000e2";
  const RESOLVED: string = "9c000000-0000-4000-8000-0000000000e3";
  const INVESTIGATING: string = "9c000000-0000-4000-8000-0000000000e4";

  let table: InMemoryTable;

  beforeEach(() => {
    const listCase: ListOrderCase = LIST_ORDER_CASES.find(
      (candidate: ListOrderCase): boolean => {
        return candidate.label === "IncidentState";
      },
    )!;

    table = useInMemoryTable(IncidentStateService, [
      {
        ...listRow({ listCase, id: CREATED, order: 1, n: 1 }),
        name: "Identified",
        isCreatedState: true,
      },
      {
        ...listRow({ listCase, id: ACKNOWLEDGED, order: 2, n: 2 }),
        name: "Acknowledged",
        isAcknowledgedState: true,
      },
      {
        ...listRow({ listCase, id: RESOLVED, order: 3, n: 3 }),
        name: "Resolved",
        isResolvedState: true,
      },
      {
        ...listRow({ listCase, id: INVESTIGATING, order: 4, n: 4 }),
        name: "Investigating",
      },
    ]);
    useInMemoryListMoves({ service: IncidentStateService, table: table });
  });

  test("a move that would put Resolved above Acknowledged is refused, saying why, and nothing moves", async () => {
    const error: unknown = await rejectionOf(
      IncidentStateService.moveInList({
        id: new ObjectID(RESOLVED),
        placeOfId: new ObjectID(ACKNOWLEDGED),
        props: listAdminProps(),
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      'Incidents only ever move down this list, so the resolved state ("Resolved") has to stay below the acknowledged state ("Acknowledged").',
    );
    expect(table.updates).toEqual([]);
  });

  test("a state of the project's own moves between the built-in ones", async () => {
    await IncidentStateService.moveInList({
      id: new ObjectID(INVESTIGATING),
      placeOfId: new ObjectID(ACKNOWLEDGED),
      props: listAdminProps(),
    });

    expect(
      [CREATED, INVESTIGATING, ACKNOWLEDGED, RESOLVED].map(
        (id: string): unknown => {
          return table.get(id)!["order"];
        },
      ),
    ).toEqual([1, 2, 3, 4]);
  });

  test("a move OneUptime makes itself is trusted", async () => {
    // Root moves nothing through the API; the guard only holds signed-in callers.
    const error: unknown = await rejectionOf(
      IncidentStateService.moveInList({
        id: new ObjectID(RESOLVED),
        placeOfId: new ObjectID(ACKNOWLEDGED),
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    );

    expect(error).toBeUndefined();
    expect(table.get(RESOLVED)!["order"]).toBe(2);
  });
});

describe("what a move sets off, as a write of the numbers does", () => {
  function caseOf(label: string): ListOrderCase {
    return LIST_ORDER_CASES.find((candidate: ListOrderCase): boolean => {
      return candidate.label === label;
    })!;
  }

  function useList(listCase: ListOrderCase): InMemoryTable {
    const table: InMemoryTable = useInMemoryTable(
      listCase.service,
      startingRows(listCase),
    );
    useInMemoryListMoves({ service: listCase.service, table: table });
    listCase.stubCollaborators?.();
    return table;
  }

  test("a state moved: the project's list kept in every process is read again", async () => {
    useList(caseOf("IncidentState"));
    const forget: jest.SpyInstance = getJestSpyOn(
      IncidentStateService.statesAsOneUptime,
      "forgetProjects",
    ).mockResolvedValue(undefined);

    await move(caseOf("IncidentState"), {
      id: LIST_ROWS[3]!,
      placeOfId: LIST_ROWS[1]!,
    });

    expect(forget).toHaveBeenCalledTimes(1);
    expect(
      (forget.mock.calls[0]![0] as Array<unknown>).map(String),
    ).toEqual([PROJECT_ID.toString()]);
  });

  test("a reminder rule moved: the project's open incidents' reminders are worked out again", async () => {
    useList(caseOf("IncidentReminderRule"));
    const refresh: jest.SpyInstance = getJestSpyOn(
      IncidentReminderRuleService,
      "refreshSchedulesForOpenIncidents",
    ).mockResolvedValue(undefined);

    await move(caseOf("IncidentReminderRule"), {
      id: LIST_ROWS[3]!,
      placeOfId: LIST_ROWS[1]!,
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(String(refresh.mock.calls[0]![0])).toBe(PROJECT_ID.toString());
  });

  test("a collector config moved: the project's hosts read the list again", async () => {
    useList(caseOf("HostCollectorConfig"));
    const forget: jest.SpyInstance = getJestSpyOn(
      HostCollectorProjectConfigsMemo,
      "forget",
    );

    await move(caseOf("HostCollectorConfig"), {
      id: LIST_ROWS[3]!,
      placeOfId: LIST_ROWS[1]!,
    });

    expect(forget).toHaveBeenCalledWith(PROJECT_ID.toString());
  });

  test("an approval step moved: the notes waiting for its kind's steps follow the new order", async () => {
    useList(caseOf("PublicNoteApprovalStep"));
    const follow: jest.SpyInstance = getJestSpyOn(
      PublicNoteApproverChanges,
      "afterStepsChanged",
    ).mockImplementation(() => {});

    await move(caseOf("PublicNoteApprovalStep"), {
      id: LIST_ROWS[3]!,
      placeOfId: LIST_ROWS[1]!,
    });

    expect(follow).toHaveBeenCalledTimes(1);

    const changes: Array<{ projectId: ObjectID; eventType: string }> = follow
      .mock.calls[0]![0] as Array<{ projectId: ObjectID; eventType: string }>;

    expect(
      changes.map((change: { projectId: ObjectID; eventType: string }) => {
        return [String(change.projectId), change.eventType];
      }),
    ).toEqual([[PROJECT_ID.toString(), PublicNoteApprovalEventType.Incident]]);
  });

  test("a move that changes nothing sets nothing off", async () => {
    useList(caseOf("IncidentState"));
    const forget: jest.SpyInstance = getJestSpyOn(
      IncidentStateService.statesAsOneUptime,
      "forgetProjects",
    ).mockResolvedValue(undefined);

    await move(caseOf("IncidentState"), {
      id: LIST_ROWS[1]!,
      placeOfId: LIST_ROWS[1]!,
    });

    expect(forget).not.toHaveBeenCalled();
  });

  test("the audit log records each row a move renumbers, by the caller, with its number before", async () => {
    const listCase: ListOrderCase = caseOf("IncidentSeverity");
    useList(listCase);

    const recorded: Array<{
      updatedFields: Record<string, unknown>;
      before: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    }> = [];

    getJestSpyOn(AuditLogService, "recordUpdate").mockImplementation(
      async (entry: unknown): Promise<void> => {
        recorded.push(
          entry as {
            updatedFields: Record<string, unknown>;
            before: Record<string, unknown>;
            props: DatabaseCommonInteractionProps;
          },
        );
      },
    );

    const props: DatabaseCommonInteractionProps = listAdminProps();

    await move(listCase, {
      id: LIST_ROWS[2]!,
      placeOfId: LIST_ROWS[1]!,
      props: props,
    });

    expect(
      recorded
        .map((entry: (typeof recorded)[number]): [unknown, unknown] => {
          return [entry.before["order"], entry.updatedFields["order"]];
        })
        .sort(),
    ).toEqual([
      [2, 3],
      [3, 2],
    ]);

    for (const entry of recorded) {
      expect(entry.props).toBe(props);
    }
  });
});

describe("a list of one kind", () => {
  // A project's approval steps of the other kind: scheduled maintenance's.
  const OTHER_KIND_ROWS: Array<string> = [
    "9c000000-0000-4000-8000-0000000000f1",
    "9c000000-0000-4000-8000-0000000000f2",
  ];

  let table: InMemoryTable;
  const listCase: () => ListOrderCase = (): ListOrderCase => {
    return LIST_ORDER_CASES.find((candidate: ListOrderCase): boolean => {
      return candidate.label === "PublicNoteApprovalStep";
    })!;
  };

  beforeEach(() => {
    table = useInMemoryTable(PublicNoteApprovalStepService, [
      ...startingRows(listCase()),
      ...OTHER_KIND_ROWS.map((id: string, index: number): StoredRow => {
        return {
          ...listRow({ listCase: listCase(), id, order: index + 1, n: index }),
          eventType: PublicNoteApprovalEventType.ScheduledMaintenance,
        };
      }),
    ]);
    useInMemoryListMoves({
      service: PublicNoteApprovalStepService,
      table: table,
    });
    getJestSpyOn(PublicNoteApproverChanges, "afterStepsChanged").mockImplementation(
      () => {},
    );
  });

  test("moves within its kind, and leaves the project's steps of the other kind alone", async () => {
    await move(listCase(), { id: LIST_ROWS[5]!, placeOfId: LIST_ROWS[0]! });

    expect(table.get(LIST_ROWS[5]!)!["order"]).toBe(1);
    expect(
      OTHER_KIND_ROWS.map((id: string): unknown => {
        return table.get(id)!["order"];
      }),
    ).toEqual([1, 2]);
  });

  test("refuses the place of a step of the other kind", async () => {
    const error: unknown = await rejectionOf(
      move(listCase(), { id: LIST_ROWS[5]!, placeOfId: OTHER_KIND_ROWS[0]! }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(table.updates).toEqual([]);
  });
});

describe("a table that is no list", () => {
  test("refuses a move, saying so", async () => {
    const error: unknown = await rejectionOf(
      (
        NetworkDeviceDiscoveryScanService as unknown as DatabaseService<BaseModel>
      ).moveInList({
        id: ObjectID.generate(),
        placeOfId: ObjectID.generate(),
        props: listAdminProps(),
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toContain(
      "are not a list that can be put in another order",
    );
  });
});
