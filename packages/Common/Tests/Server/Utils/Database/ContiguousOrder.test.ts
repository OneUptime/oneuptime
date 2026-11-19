import type DatabaseService from "../../../../Server/Services/DatabaseService";
import AuditLogService from "../../../../Server/Services/AuditLogService";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import ContiguousOrder, {
  ListColumnValue,
} from "../../../../Server/Utils/Database/ContiguousOrder";
import RuleSetCache from "../../../../Server/Utils/Rules/RuleSetCache";
import StatusPageOverviewCache from "../../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import StatusPageGroup from "../../../../Models/DatabaseModels/StatusPageGroup";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { EntityManager } from "typeorm";

/*
 * ContiguousOrder keeps the five lists numbered by `order` (issue #9573):
 *
 *   - getAppendOrder: the number a row created without one takes - one past
 *     the last numbered row of its list, whatever gaps the list has;
 *   - move: a row moved to another row's place, in one transaction that
 *     locks the list's rows, once the caller is found allowed to change the
 *     row's order - the rows given another number written in one
 *     statement, and recorded in the audit log by the caller.
 *
 * No write of a row through a service moves another row any more; that is
 * pinned with the services themselves (ContiguousOrderWrites,
 * ContiguousOrderConverges). The service here is a stand-in that records
 * every read, and the transaction's manager one that records every
 * statement and answers the list from memory.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "9c1f2d3e-1111-4222-8333-444455556666",
);

function idOf(n: number): ObjectID {
  return new ObjectID(
    `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`,
  );
}

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

// A transaction's manager over a list held in memory.
class FakeManager {
  public statements: Array<Statement> = [];
  public rows: Array<{ _id: string; order: number | null }> = [];

  public async query(
    sql: string,
    parameters: Array<unknown>,
  ): Promise<unknown> {
    this.statements.push({ sql, parameters });

    if (sql.startsWith("SELECT")) {
      return this.rows.map((row: { _id: string; order: number | null }) => {
        return { ...row };
      });
    }

    return [[], 0];
  }

  public asManager(): EntityManager {
    return this as unknown as EntityManager;
  }
}

// A service of status page groups, as ContiguousOrder reads and writes it.
class FakeService {
  public reads: Array<Record<string, unknown>> = [];
  public lastRow: Record<string, unknown> | null = null;
  public movedRow: StatusPageGroup | null = null;
  public manager: FakeManager = new FakeManager();
  public auditRows: Array<StatusPageGroup> = [];
  public unwrittenError: Error = new NotFoundException("Not found.");
  public modelType: { new (): StatusPageGroup } = StatusPageGroup;

  public getModel(): StatusPageGroup {
    return new StatusPageGroup();
  }

  public async findOneBy(
    data: Record<string, unknown>,
  ): Promise<StatusPageGroup | Record<string, unknown> | null> {
    this.reads.push(data);

    if ((data["sort"] as Record<string, unknown> | undefined)?.["order"]) {
      return this.lastRow;
    }

    return this.movedRow;
  }

  public async findBy(data: Record<string, unknown>): Promise<unknown> {
    this.reads.push(data);
    return this.auditRows;
  }

  public async executeTransaction<T>(
    run: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return await run(this.manager.asManager());
  }

  public async getUnwrittenByIdError(): Promise<Error> {
    return this.unwrittenError;
  }

  public asService(): DatabaseService<StatusPageGroup> {
    return this as unknown as DatabaseService<StatusPageGroup>;
  }
}

function memberProps(): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: idOf(900),
  };
}

function groupRow(n: number, order: number): StatusPageGroup {
  const group: StatusPageGroup = new StatusPageGroup(idOf(n));
  group.order = order;
  group.statusPageId = STATUS_PAGE_ID;
  group.projectId = PROJECT_ID;
  group.name = `Group ${n}`;
  return group;
}

describe("ContiguousOrder", () => {
  let service: FakeService;

  beforeEach(() => {
    service = new FakeService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getAppendOrder", () => {
    test("is one past the last numbered row of the list", async () => {
      service.lastRow = { order: 3 };

      expect(
        await ContiguousOrder.getAppendOrder({
          service: service.asService(),
          list: { statusPageId: STATUS_PAGE_ID, projectId: PROJECT_ID },
        }),
      ).toBe(4);
    });

    test("is past the last row however far the gaps before it take it", async () => {
      service.lastRow = { order: 17 };

      expect(
        await ContiguousOrder.getAppendOrder({
          service: service.asService(),
          list: { statusPageId: STATUS_PAGE_ID },
        }),
      ).toBe(18);
    });

    test("is 1 for the first row of a list", async () => {
      expect(
        await ContiguousOrder.getAppendOrder({
          service: service.asService(),
          list: { statusPageId: STATUS_PAGE_ID },
        }),
      ).toBe(1);
    });

    test.each([
      ["a number stored as text", "4", 5],
      ["a fraction", 2.5, 3],
      ["no number", null, 1],
      ["nonsense", "x", 1],
      ["zero", 0, 1],
      ["a negative number", -3, 1],
    ])(
      "after a last row holding %s is %s",
      async (_label: string, order: unknown, expected: number) => {
        service.lastRow = { order: order };

        expect(
          await ContiguousOrder.getAppendOrder({
            service: service.asService(),
            list: { statusPageId: STATUS_PAGE_ID },
          }),
        ).toBe(expected);
      },
    );

    test("reads the list's last numbered row, highest first, as root", async () => {
      await ContiguousOrder.getAppendOrder({
        service: service.asService(),
        list: { statusPageId: STATUS_PAGE_ID, projectId: PROJECT_ID },
      });

      expect(service.reads).toHaveLength(1);

      const read: Record<string, unknown> = service.reads[0]!;
      const query: Record<string, unknown> = read["query"] as Record<
        string,
        unknown
      >;

      expect(query["statusPageId"]).toBe(STATUS_PAGE_ID);
      expect(query["projectId"]).toBe(PROJECT_ID);
      // Rows without a number come first in a descending read: they are left out.
      expect(query["order"]).toBeDefined();
      expect(read["sort"]).toEqual({ order: "DESC" });
      expect(read["select"]).toEqual({ _id: true, order: true });
      expect(read["props"]).toEqual({ isRoot: true });
    });
  });

  describe("moveWithinTransaction", () => {
    const list: Array<ListColumnValue> = [
      { column: "statusPageId", value: STATUS_PAGE_ID.toString() },
      { column: "projectId", value: PROJECT_ID.toString() },
    ];

    beforeEach(() => {
      service.manager.rows = [
        { _id: idOf(1).toString(), order: 1 },
        { _id: idOf(2).toString(), order: 2 },
        { _id: idOf(3).toString(), order: 3 },
      ];
    });

    test("locks every row of the list, in id order, before it reads them", async () => {
      await ContiguousOrder.moveWithinTransaction({
        manager: service.manager.asManager(),
        tableName: "StatusPageGroup",
        list: list,
        rowId: idOf(3),
        placeOfId: idOf(1),
        name: "status page group",
      });

      const select: Statement = service.manager.statements[0]!;

      expect(select.sql).toBe(
        'SELECT "_id", "order" FROM "StatusPageGroup" WHERE "statusPageId" = $1::uuid AND "projectId" = $2::uuid AND "deletedAt" IS NULL ORDER BY "_id" ASC FOR UPDATE',
      );
      expect(select.parameters).toEqual([
        STATUS_PAGE_ID.toString(),
        PROJECT_ID.toString(),
      ]);
    });

    test("writes the rows given another number in one statement, held to the list", async () => {
      const written: {
        changedRows: Array<{ id: string; order: number }>;
      } = await ContiguousOrder.moveWithinTransaction({
        manager: service.manager.asManager(),
        tableName: "StatusPageGroup",
        list: list,
        rowId: idOf(3),
        placeOfId: idOf(1),
        name: "status page group",
      });

      expect(written.changedRows).toEqual([
        { id: idOf(3).toString(), order: 1 },
        { id: idOf(1).toString(), order: 2 },
        { id: idOf(2).toString(), order: 3 },
      ]);

      expect(service.manager.statements).toHaveLength(2);

      const update: Statement = service.manager.statements[1]!;

      expect(update.sql).toBe(
        'UPDATE "StatusPageGroup" AS "row" SET "order" = "moved"."order", "updatedAt" = now(), "version" = "row"."version" + 1 FROM (VALUES ($3::uuid, $4::integer), ($5::uuid, $6::integer), ($7::uuid, $8::integer)) AS "moved"("_id", "order") WHERE "row"."_id" = "moved"."_id" AND "row"."statusPageId" = $1::uuid AND "row"."projectId" = $2::uuid',
      );
      expect(update.parameters).toEqual([
        STATUS_PAGE_ID.toString(),
        PROJECT_ID.toString(),
        idOf(3).toString(),
        1,
        idOf(1).toString(),
        2,
        idOf(2).toString(),
        3,
      ]);
    });

    test("names a list of rows in no group by IS NULL", async () => {
      await ContiguousOrder.moveWithinTransaction({
        manager: service.manager.asManager(),
        tableName: "StatusPageResource",
        list: [
          { column: "statusPageId", value: STATUS_PAGE_ID.toString() },
          { column: "statusPageGroupId", value: null },
          { column: "projectId", value: PROJECT_ID.toString() },
        ],
        rowId: idOf(2),
        placeOfId: idOf(1),
        name: "status page resource",
      });

      expect(service.manager.statements[0]!.sql).toContain(
        '"statusPageId" = $1::uuid AND "statusPageGroupId" IS NULL AND "projectId" = $2::uuid',
      );
      expect(service.manager.statements[1]!.sql).toContain(
        '"row"."statusPageGroupId" IS NULL',
      );
    });

    test("writes nothing for a move to the row's own place", async () => {
      const written: {
        changedRows: Array<{ id: string; order: number }>;
      } = await ContiguousOrder.moveWithinTransaction({
        manager: service.manager.asManager(),
        tableName: "StatusPageGroup",
        list: list,
        rowId: idOf(2),
        placeOfId: idOf(2),
        name: "status page group",
      });

      expect(written.changedRows).toEqual([]);
      expect(service.manager.statements).toHaveLength(1);
    });

    test("keeps each row's number before the move, for the audit log", async () => {
      const written: {
        previousOrders: Map<string, number | null>;
      } = await ContiguousOrder.moveWithinTransaction({
        manager: service.manager.asManager(),
        tableName: "StatusPageGroup",
        list: list,
        rowId: idOf(3),
        placeOfId: idOf(1),
        name: "status page group",
      });

      expect(written.previousOrders.get(idOf(3).toString())).toBe(3);
      expect(written.previousOrders.get(idOf(1).toString())).toBe(1);
    });

    test("a row no longer in the list, as the lock hands it over, is not found", async () => {
      await expect(
        ContiguousOrder.moveWithinTransaction({
          manager: service.manager.asManager(),
          tableName: "StatusPageGroup",
          list: list,
          rowId: idOf(9),
          placeOfId: idOf(1),
          name: "status page group",
        }),
      ).rejects.toThrow(
        new NotFoundException(
          "This status page group is no longer in its list. Reload to see the list as it is now.",
        ),
      );
      expect(service.manager.statements).toHaveLength(1);
    });

    test("the place of a row of another list is refused", async () => {
      await expect(
        ContiguousOrder.moveWithinTransaction({
          manager: service.manager.asManager(),
          tableName: "StatusPageGroup",
          list: list,
          rowId: idOf(1),
          placeOfId: idOf(9),
          name: "status page group",
        }),
      ).rejects.toThrow(BadDataException);
      expect(service.manager.statements).toHaveLength(1);
    });

    test("a column that is no plain name is refused before anything is read", async () => {
      await expect(
        ContiguousOrder.moveWithinTransaction({
          manager: service.manager.asManager(),
          tableName: "StatusPageGroup",
          list: [{ column: 'statusPageId" OR 1=1 --', value: "x" }],
          rowId: idOf(1),
          placeOfId: idOf(2),
          name: "status page group",
        }),
      ).rejects.toThrow(BadDataException);
      expect(service.manager.statements).toEqual([]);
    });
  });

  describe("move", () => {
    beforeEach(() => {
      service.movedRow = groupRow(3, 3);
      service.manager.rows = [
        { _id: idOf(1).toString(), order: 1 },
        { _id: idOf(2).toString(), order: 2 },
        { _id: idOf(3).toString(), order: 3 },
      ];

      jest
        .spyOn(ModelPermission, "checkUpdateQueryPermissions")
        .mockImplementation(async (_modelType: unknown, query: unknown) => {
          return query as never;
        });
    });

    test("asks whether the caller may change the row's order, in their project", async () => {
      await ContiguousOrder.move({
        service: service.asService(),
        rowId: idOf(3),
        placeOfId: idOf(1),
        listColumns: ["statusPageId", "projectId"],
        props: memberProps(),
      });

      expect(ModelPermission.checkUpdateQueryPermissions).toHaveBeenCalledWith(
        StatusPageGroup,
        { _id: idOf(3), projectId: PROJECT_ID },
        { order: 1 },
        memberProps(),
      );
    });

    test("reads the row's list from the row itself, as root", async () => {
      await ContiguousOrder.move({
        service: service.asService(),
        rowId: idOf(3),
        placeOfId: idOf(1),
        listColumns: ["statusPageId", "projectId"],
        alsoSelect: ["name"],
        props: memberProps(),
      });

      const read: Record<string, unknown> = service.reads[0]!;

      expect(read["select"]).toEqual({
        _id: true,
        order: true,
        statusPageId: true,
        projectId: true,
        name: true,
      });
      expect(read["props"]).toEqual({ isRoot: true });
      expect(service.manager.statements[0]!.parameters).toEqual([
        STATUS_PAGE_ID.toString(),
        PROJECT_ID.toString(),
      ]);
    });

    test("hands back the moved row and the rows given another number", async () => {
      const moved: {
        row: StatusPageGroup;
        changedRows: Array<{ id: string; order: number }>;
      } = await ContiguousOrder.move({
        service: service.asService(),
        rowId: idOf(3),
        placeOfId: idOf(1),
        listColumns: ["statusPageId", "projectId"],
        props: memberProps(),
      });

      expect(moved.row.id?.toString()).toBe(idOf(3).toString());
      expect(moved.changedRows).toEqual([
        { id: idOf(3).toString(), order: 1 },
        { id: idOf(1).toString(), order: 2 },
        { id: idOf(2).toString(), order: 3 },
      ]);
    });

    test("a row the caller may not change is refused as the service says, and nothing is written", async () => {
      service.movedRow = null;
      service.unwrittenError = new NotFoundException("Group not found.");

      await expect(
        ContiguousOrder.move({
          service: service.asService(),
          rowId: idOf(3),
          placeOfId: idOf(1),
          listColumns: ["statusPageId", "projectId"],
          props: memberProps(),
        }),
      ).rejects.toThrow("Group not found.");
      expect(service.manager.statements).toEqual([]);
    });

    test("a request of no project is refused", async () => {
      await expect(
        ContiguousOrder.move({
          service: service.asService(),
          rowId: idOf(3),
          placeOfId: idOf(1),
          listColumns: ["statusPageId", "projectId"],
          props: { userId: idOf(900) },
        }),
      ).rejects.toThrow(new BadDataException("Project ID is required."));
      expect(service.manager.statements).toEqual([]);
    });

    test("a list not held to its project is refused", async () => {
      await expect(
        ContiguousOrder.move({
          service: service.asService(),
          rowId: idOf(3),
          placeOfId: idOf(1),
          listColumns: ["statusPageId"],
          props: memberProps(),
        }),
      ).rejects.toThrow(BadDataException);
      expect(service.manager.statements).toEqual([]);
    });

    test("records each row given another number in the audit log, by the caller, with its number before", async () => {
      const recorded: Array<{
        before: StatusPageGroup;
        updatedFields: Record<string, unknown>;
        props: DatabaseCommonInteractionProps;
      }> = [];

      jest
        .spyOn(AuditLogService, "recordUpdate")
        .mockImplementation(async (data: any) => {
          recorded.push({
            before: data.before,
            updatedFields: data.updatedFields,
            props: data.props,
          });
        });

      // The rows as they are once moved, every column.
      service.auditRows = [groupRow(3, 1), groupRow(1, 2), groupRow(2, 3)];

      await ContiguousOrder.move({
        service: service.asService(),
        rowId: idOf(3),
        placeOfId: idOf(1),
        listColumns: ["statusPageId", "projectId"],
        props: memberProps(),
      });

      expect(
        recorded.map((entry: (typeof recorded)[number]) => {
          return [
            entry.before.id?.toString(),
            entry.before.order,
            entry.updatedFields["order"],
          ];
        }),
      ).toEqual([
        [idOf(3).toString(), 3, 1],
        [idOf(1).toString(), 1, 2],
        [idOf(2).toString(), 2, 3],
      ]);

      for (const entry of recorded) {
        expect(entry.props).toEqual(memberProps());
        expect(entry.before.name).toBeDefined();
      }
    });

    test("records nothing, and reads nothing for the audit log, for a move that changes nothing", async () => {
      jest.spyOn(AuditLogService, "recordUpdate");

      await ContiguousOrder.move({
        service: service.asService(),
        rowId: idOf(2),
        placeOfId: idOf(2),
        listColumns: ["statusPageId", "projectId"],
        props: memberProps(),
      });

      expect(AuditLogService.recordUpdate).not.toHaveBeenCalled();
      expect(service.reads).toHaveLength(1);
    });
  });
});

/*
 * The same move keeps every drag-ordered list (@ListOrderColumn, issue
 * #9609): its column may be `sortOrder` or `priority`, its top may be the
 * highest number, a text column may name its list, and a list whose order
 * means something (a project's states) checks the move before it writes.
 */
describe("ContiguousOrder.moveWithinTransaction, for a drag-ordered list", () => {
  let manager: FakeManager;

  beforeEach(() => {
    manager = new FakeManager();
  });

  const projectOnly: Array<ListColumnValue> = [
    { column: "projectId", value: PROJECT_ID.toString(), isId: true },
  ];

  test("locks and writes the list's own column", async () => {
    manager.rows = [
      { _id: idOf(1).toString(), sortOrder: 1 },
      { _id: idOf(2).toString(), sortOrder: 2 },
    ] as never;

    const written: { changedRows: Array<{ id: string; order: number }> } =
      await ContiguousOrder.moveWithinTransaction({
        manager: manager.asManager(),
        tableName: "LogPipeline",
        list: projectOnly,
        rowId: idOf(2),
        placeOfId: idOf(1),
        name: "log pipeline",
        orderColumn: "sortOrder",
      });

    expect(manager.statements[0]!.sql).toBe(
      'SELECT "_id", "sortOrder" FROM "LogPipeline" WHERE "projectId" = $1::uuid AND "deletedAt" IS NULL ORDER BY "_id" ASC FOR UPDATE',
    );
    expect(manager.statements[1]!.sql).toContain(
      'UPDATE "LogPipeline" AS "row" SET "sortOrder" = "moved"."order",',
    );
    expect(written.changedRows).toEqual([
      { id: idOf(2).toString(), order: 1 },
      { id: idOf(1).toString(), order: 2 },
    ]);
  });

  test("numbers a list whose top is its highest number n..1 from the top", async () => {
    manager.rows = [
      { _id: idOf(1).toString(), priority: 30 },
      { _id: idOf(2).toString(), priority: 20 },
      { _id: idOf(3).toString(), priority: 10 },
    ] as never;

    const written: { changedRows: Array<{ id: string; order: number }> } =
      await ContiguousOrder.moveWithinTransaction({
        manager: manager.asManager(),
        tableName: "NetworkSiteAssignmentRule",
        list: projectOnly,
        rowId: idOf(3),
        placeOfId: idOf(1),
        name: "network site assignment rule",
        orderColumn: "priority",
        sortOrder: SortOrder.Descending,
      });

    // The bottom rule moved to the top: it is 3, the others 2 and 1.
    expect(written.changedRows).toEqual([
      { id: idOf(3).toString(), order: 3 },
      { id: idOf(1).toString(), order: 2 },
      { id: idOf(2).toString(), order: 1 },
    ]);
  });

  test("holds the statements to a list named by a text column as it is, not as an id", async () => {
    manager.rows = [
      { _id: idOf(1).toString(), order: 1 },
      { _id: idOf(2).toString(), order: 2 },
    ];

    await ContiguousOrder.moveWithinTransaction({
      manager: manager.asManager(),
      tableName: "PublicNoteApprovalStep",
      list: [
        ...projectOnly,
        { column: "eventType", value: "Incident", isId: false },
      ],
      rowId: idOf(2),
      placeOfId: idOf(1),
      name: "public note approval step",
    });

    expect(manager.statements[0]!.sql).toContain(
      '"projectId" = $1::uuid AND "eventType" = $2 AND "deletedAt" IS NULL',
    );
    expect(manager.statements[0]!.parameters).toEqual([
      PROJECT_ID.toString(),
      "Incident",
    ]);
    expect(manager.statements[1]!.sql).toContain('"row"."eventType" = $2');
  });

  test("a column that is no plain name is refused before anything is read", async () => {
    await expect(
      ContiguousOrder.moveWithinTransaction({
        manager: manager.asManager(),
        tableName: "IncidentSeverity",
        list: projectOnly,
        rowId: idOf(1),
        placeOfId: idOf(2),
        name: "incident severity",
        orderColumn: 'order" = 0 --',
      }),
    ).rejects.toThrow(BadDataException);
    expect(manager.statements).toEqual([]);
  });

  test("the check is handed the list as the lock handed it over, and the numbers the move gives", async () => {
    manager.rows = [
      { _id: idOf(1).toString(), order: 1 },
      { _id: idOf(2).toString(), order: 2 },
    ];

    const checked: Array<unknown> = [];

    await ContiguousOrder.moveWithinTransaction({
      manager: manager.asManager(),
      tableName: "IncidentState",
      list: projectOnly,
      rowId: idOf(2),
      placeOfId: idOf(1),
      name: "incident state",
      check: async (move: unknown): Promise<void> => {
        checked.push(move);
      },
    });

    expect(checked).toEqual([
      {
        rows: [
          { id: idOf(1).toString(), order: 1 },
          { id: idOf(2).toString(), order: 2 },
        ],
        changedRows: [
          { id: idOf(2).toString(), order: 1 },
          { id: idOf(1).toString(), order: 2 },
        ],
      },
    ]);
  });

  test("a check that refuses the move leaves the list as it was: nothing is written", async () => {
    manager.rows = [
      { _id: idOf(1).toString(), order: 1 },
      { _id: idOf(2).toString(), order: 2 },
    ];

    await expect(
      ContiguousOrder.moveWithinTransaction({
        manager: manager.asManager(),
        tableName: "IncidentState",
        list: projectOnly,
        rowId: idOf(2),
        placeOfId: idOf(1),
        name: "incident state",
        check: async (): Promise<void> => {
          throw new BadDataException("Out of order.");
        },
      }),
    ).rejects.toThrow("Out of order.");

    expect(manager.statements).toHaveLength(1);
    expect(manager.statements[0]!.sql).toContain("FOR UPDATE");
  });

  test("a move that changes nothing asks no check", async () => {
    manager.rows = [{ _id: idOf(1).toString(), order: 1 }];

    const check: jest.Mock = jest.fn();

    await ContiguousOrder.moveWithinTransaction({
      manager: manager.asManager(),
      tableName: "IncidentState",
      list: projectOnly,
      rowId: idOf(1),
      placeOfId: idOf(1),
      name: "incident state",
      check: check as never,
    });

    expect(check).not.toHaveBeenCalled();
  });
});

describe("ContiguousOrder.move, telling every process the list changed", () => {
  let service: FakeService;

  beforeEach(() => {
    service = new FakeService();
    service.movedRow = groupRow(3, 3);
    service.manager.rows = [
      { _id: idOf(1).toString(), order: 1 },
      { _id: idOf(2).toString(), order: 2 },
      { _id: idOf(3).toString(), order: 3 },
    ];

    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockImplementation(async (_modelType: unknown, query: unknown) => {
        return query as never;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * A status page shows its groups in their order, from an overview kept
   * in every process (StatusPageOverviewCache); a project's rules are
   * tried in theirs (RuleSetCache). The move writes past the service, so it
   * tells them itself, as a write through the service would.
   */
  test("the status page overview and the project's rules are read again", async () => {
    const overview: jest.SpyInstance = jest
      .spyOn(StatusPageOverviewCache, "afterUpdate")
      .mockResolvedValue(undefined as never);
    const rules: jest.SpyInstance = jest
      .spyOn(RuleSetCache, "afterUpdate")
      .mockResolvedValue(undefined as never);

    await ContiguousOrder.move({
      service: service.asService(),
      rowId: idOf(3),
      placeOfId: idOf(1),
      listColumns: ["statusPageId", "projectId"],
      props: memberProps(),
    });

    for (const spy of [overview, rules]) {
      expect(spy).toHaveBeenCalledTimes(1);

      const told: {
        tableName: string;
        rows: Array<Record<string, unknown>>;
        written: Record<string, unknown>;
      } = spy.mock.calls[0]![0] as {
        tableName: string;
        rows: Array<Record<string, unknown>>;
        written: Record<string, unknown>;
      };

      expect(told.tableName).toBe("StatusPageGroup");
      expect(told.rows).toEqual([
        { _id: idOf(3).toString(), projectId: PROJECT_ID.toString() },
        { _id: idOf(1).toString(), projectId: PROJECT_ID.toString() },
        { _id: idOf(2).toString(), projectId: PROJECT_ID.toString() },
      ]);
      expect(Object.keys(told.written)).toEqual(["order"]);
    }
  });

  test("a move that changes nothing tells nobody", async () => {
    const overview: jest.SpyInstance = jest
      .spyOn(StatusPageOverviewCache, "afterUpdate")
      .mockResolvedValue(undefined as never);

    await ContiguousOrder.move({
      service: service.asService(),
      rowId: idOf(3),
      placeOfId: idOf(3),
      listColumns: ["statusPageId", "projectId"],
      props: memberProps(),
    });

    expect(overview).not.toHaveBeenCalled();
  });

  test("asks whether the caller may change the list's own column", async () => {
    service.manager.rows = [
      { _id: idOf(1).toString(), priority: 2 },
      { _id: idOf(3).toString(), priority: 1 },
    ] as never;

    await ContiguousOrder.move({
      service: service.asService(),
      rowId: idOf(3),
      placeOfId: idOf(1),
      listColumns: ["projectId"],
      orderColumn: "priority",
      sortOrder: SortOrder.Descending,
      props: memberProps(),
    });

    expect(ModelPermission.checkUpdateQueryPermissions).toHaveBeenCalledWith(
      StatusPageGroup,
      { _id: idOf(3), projectId: PROJECT_ID },
      { priority: 1 },
      memberProps(),
    );
    expect(service.reads[0]!["select"]).toEqual({
      _id: true,
      priority: true,
      projectId: true,
    });
  });

  test("hands the check the row as read before it moved", async () => {
    const rowsChecked: Array<unknown> = [];

    await ContiguousOrder.move({
      service: service.asService(),
      rowId: idOf(3),
      placeOfId: idOf(1),
      listColumns: ["statusPageId", "projectId"],
      check: async (move: { row: StatusPageGroup }): Promise<void> => {
        rowsChecked.push(move.row.id?.toString());
      },
      props: memberProps(),
    });

    expect(rowsChecked).toEqual([idOf(3).toString()]);
  });
});
