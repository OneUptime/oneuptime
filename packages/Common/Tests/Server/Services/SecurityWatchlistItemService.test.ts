import AuditLogService from "../../../Server/Services/AuditLogService";
import SecurityWatchlistItemService, {
  SECURITY_WATCHLIST_IMPORT_PROBLEMS_SHOWN,
  SecurityWatchlistImportSummary,
  getWrittenWatchlistId,
} from "../../../Server/Services/SecurityWatchlistItemService";
import SecurityWatchlistService from "../../../Server/Services/SecurityWatchlistService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import SecurityWatchlist from "../../../Models/DatabaseModels/SecurityWatchlist";
import SecurityWatchlistItem from "../../../Models/DatabaseModels/SecurityWatchlistItem";
import Includes from "../../../Types/BaseDatabase/Includes";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  SecurityWatchlistImportMode,
  SecurityWatchlistSource,
} from "../../../Types/SecurityEvent/SecurityWatchlist";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE VALUES OF A WATCHLIST THE TEAM KEEPS, AS THEY ARE SAVED: each checked
 * against what its list holds, once per list whatever the case, the list
 * within its limits, never on a list that follows a feed - and the list's
 * count following every write. An import adds or replaces many at once:
 * checked as one, written in batches, each value audited.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<SecurityWatchlistItem>,
  ) => Promise<OnCreate<SecurityWatchlistItem>>;
  onCreateSuccess: (
    onCreate: OnCreate<SecurityWatchlistItem>,
    createdItem: SecurityWatchlistItem,
  ) => Promise<SecurityWatchlistItem>;
  onBeforeUpdate: (
    updateBy: UpdateBy<SecurityWatchlistItem>,
  ) => Promise<OnUpdate<SecurityWatchlistItem>>;
  onBeforeDelete: (
    deleteBy: DeleteBy<SecurityWatchlistItem>,
  ) => Promise<OnDelete<SecurityWatchlistItem>>;
  onDeleteSuccess: (
    onDelete: OnDelete<SecurityWatchlistItem>,
    itemIds: Array<ObjectID>,
  ) => Promise<OnDelete<SecurityWatchlistItem>>;
};

const service: HookCaller =
  SecurityWatchlistItemService as unknown as HookCaller;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const LIST_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const ROW_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const USER_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");

function list(values: Partial<Record<string, unknown>> = {}): SecurityWatchlist {
  const model: SecurityWatchlist = new SecurityWatchlist();
  model._id = LIST_ID.toString();
  model.projectId = PROJECT_ID;
  model.name = "vip_users";
  model.entityType = SecurityEntityType.User;
  model.source = SecurityWatchlistSource.Values;
  Object.assign(model, values);
  return model;
}

function item(value: string, id?: string): SecurityWatchlistItem {
  const model: SecurityWatchlistItem = new SecurityWatchlistItem();
  model._id = id || `99999999-9999-4999-8999-${String(value.length).padStart(12, "0")}`;
  model.securityWatchlistId = LIST_ID;
  model.value = value;
  return model;
}

function newValue(values: Partial<Record<string, unknown>> = {}): SecurityWatchlistItem {
  const model: SecurityWatchlistItem = new SecurityWatchlistItem();
  model.projectId = PROJECT_ID;
  model.securityWatchlistId = LIST_ID;
  model.value = "alice@example.com";
  Object.assign(model, values);
  return model;
}

let findList: Spy;
let findValues: Spy;
let count: Spy;
let updateList: Spy;

beforeEach(() => {
  getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue(
    undefined as never,
  );
  findList = getJestSpyOn(
    SecurityWatchlistService,
    "findOneById",
  ).mockResolvedValue(list() as never);
  findValues = getJestSpyOn(
    SecurityWatchlistItemService,
    "findAllBy",
  ).mockResolvedValue([] as never);
  count = getJestSpyOn(
    SecurityWatchlistItemService,
    "countBy",
  ).mockResolvedValue(new PositiveNumber(1) as never);
  updateList = getJestSpyOn(
    SecurityWatchlistService,
    "updateOneById",
  ).mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function create(
  data: SecurityWatchlistItem,
): Promise<OnCreate<SecurityWatchlistItem>> {
  return service.onBeforeCreate({ data, props: { isRoot: true } });
}

describe("the list a write names", () => {
  test("its id column, or the relation", () => {
    expect(
      getWrittenWatchlistId({ securityWatchlistId: LIST_ID.toString() }),
    ).toBe(LIST_ID.toString());
    expect(
      getWrittenWatchlistId({ securityWatchlist: { _id: LIST_ID.toString() } }),
    ).toBe(LIST_ID.toString());
    expect(getWrittenWatchlistId({})).toBeUndefined();
  });
});

describe("adding a value", () => {
  test("stored trimmed, on the list named by its id, its note trimmed", async () => {
    const data: SecurityWatchlistItem = newValue({
      value: "  svc-**  ",
      note: "  The backup account.  ",
    });
    (data as unknown as JSONObject)["securityWatchlistId"] = undefined;
    (data as unknown as JSONObject)["securityWatchlist"] = {
      _id: LIST_ID.toString(),
    };

    await create(data);

    expect(data.value).toBe("svc-*");
    expect(data.note).toBe("The backup account.");
    expect(data.securityWatchlistId?.toString()).toBe(LIST_ID.toString());
    expect(
      (data as unknown as JSONObject)["securityWatchlist"],
    ).toBeUndefined();
    expect(findList).toHaveBeenCalledWith({
      id: LIST_ID,
      select: {
        _id: true,
        projectId: true,
        name: true,
        entityType: true,
        source: true,
      },
      props: { isRoot: true },
    });
  });

  test("a value with no list is refused", async () => {
    await expect(
      create(newValue({ securityWatchlistId: undefined })),
    ).rejects.toThrow("Choose the watchlist the value goes on.");

    findList.mockResolvedValue(null as never);

    await expect(create(newValue())).rejects.toThrow(
      "Choose the watchlist the value goes on.",
    );
  });

  test("checked against what the list holds", async () => {
    findList.mockResolvedValue(
      list({ entityType: SecurityEntityType.IpAddress }) as never,
    );

    await expect(create(newValue({ value: "alice" }))).rejects.toThrow(
      "Enter an IP address, a range such as 10.20.0.0/16, or a pattern with *.",
    );
    await expect(create(newValue({ value: "10.0.0.0/8" }))).resolves.toBeDefined();
  });

  test("a lone * and a long note are refused", async () => {
    await expect(create(newValue({ value: "*" }))).rejects.toThrow(
      "A value of only * would match everything.",
    );
    await expect(
      create(newValue({ note: "n".repeat(501) })),
    ).rejects.toThrow("A note is at most 500 characters.");
  });

  test("a list that follows a feed takes no value", async () => {
    findList.mockResolvedValue(
      list({ source: SecurityWatchlistSource.ThreatIntelFeed }) as never,
    );

    await expect(create(newValue())).rejects.toThrow(
      "This watchlist follows a threat intel feed, which keeps its values. To keep values by hand, create a watchlist of your own.",
    );
  });

  test("a value the list holds already, whatever its case, is refused by name", async () => {
    findValues.mockResolvedValue([item("Alice@Example.com")] as never);

    await expect(create(newValue())).rejects.toThrow(
      "vip_users already holds alice@example.com.",
    );
  });

  test("a list past its limits is refused", async () => {
    const values: Array<SecurityWatchlistItem> = [];

    for (let index: number = 0; index < 100; index++) {
      values.push(item(`svc-${index}-*`, `99999999-9999-4999-8999-${String(index).padStart(12, "0")}`));
    }

    findValues.mockResolvedValue(values as never);

    await expect(create(newValue({ value: "ops-*" }))).rejects.toThrow(
      "A watchlist holds at most 100 values with *.",
    );
    // A value as written still has room.
    await expect(create(newValue({ value: "carol" }))).resolves.toBeDefined();
  });

  test("the list's count follows: read again, and stored as the server", async () => {
    count.mockResolvedValue(new PositiveNumber(12) as never);

    await service.onCreateSuccess(
      { createBy: { data: newValue(), props: { isRoot: true } }, carryForward: null },
      newValue(),
    );

    expect(count).toHaveBeenCalledWith({
      query: { securityWatchlistId: LIST_ID },
      props: { isRoot: true },
    });
    expect(updateList).toHaveBeenCalledWith({
      id: LIST_ID,
      data: { valueCount: 12 },
      props: { isRoot: true },
    });
  });

  test("a count that fails to store never fails the value's write", async () => {
    updateList.mockRejectedValue(new Error("down") as never);

    await expect(
      service.onCreateSuccess(
        {
          createBy: { data: newValue(), props: { isRoot: true } },
          carryForward: null,
        },
        newValue(),
      ),
    ).resolves.toBeDefined();
  });
});

describe("changing a value", () => {
  function update(
    data: JSONObject,
    rows: Array<SecurityWatchlistItem> = [item("alice", ROW_ID.toString())],
  ): Promise<OnUpdate<SecurityWatchlistItem>> {
    getJestSpyOn(
      SecurityWatchlistItemService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue(rows as never);

    return service.onBeforeUpdate({
      query: { _id: ROW_ID },
      data,
      props: { isRoot: true },
    } as unknown as UpdateBy<SecurityWatchlistItem>);
  }

  test("checked as a new one is, against its list and its other values", async () => {
    findValues.mockResolvedValue([
      item("alice", ROW_ID.toString()),
      item("bob", "99999999-9999-4999-8999-000000000123"),
    ] as never);

    await expect(update({ value: "BOB" })).rejects.toThrow(
      "vip_users already holds BOB.",
    );

    // Its own value written again, in another case, is no clash.
    const data: JSONObject = { value: " ALICE " };
    await update(data);
    expect(data["value"]).toBe("ALICE");
  });

  test("a note alone is checked, never the list's other values", async () => {
    await update({ note: "  why  " });
    expect(findValues).not.toHaveBeenCalled();

    await expect(update({ note: "n".repeat(501) })).rejects.toThrow(
      "A note is at most 500 characters.",
    );
  });

  test("one value at a time", async () => {
    await expect(
      update({ value: "x" }, [
        item("a", ROW_ID.toString()),
        item("bb", "99999999-9999-4999-8999-000000000002"),
      ]),
    ).rejects.toThrow(
      "A watchlist holds each value once: change one value at a time.",
    );
  });

  test("a value never moves to another list", () => {
    expect(
      new SecurityWatchlistItem().getColumnAccessControlFor(
        "securityWatchlistId",
      )?.update || [],
    ).toEqual([]);
  });
});

describe("removing values", () => {
  test("the lists a delete touches are counted again after it", async () => {
    getJestSpyOn(
      SecurityWatchlistItemService,
      "findRowsAndHoldDeleteToThem",
    ).mockResolvedValue([item("a"), item("bb")] as never);

    const onDelete: OnDelete<SecurityWatchlistItem> =
      await service.onBeforeDelete({
        query: { _id: ROW_ID },
        props: { isRoot: true },
      } as unknown as DeleteBy<SecurityWatchlistItem>);

    expect(onDelete.carryForward).toEqual([
      LIST_ID.toString(),
      LIST_ID.toString(),
    ]);

    await service.onDeleteSuccess(onDelete, []);

    // One list: counted once.
    expect(updateList).toHaveBeenCalledTimes(1);
  });
});

describe("importing values", () => {
  const CALLER: { userId: ObjectID; tenantId: ObjectID } = {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  };

  let insert: jest.Mock;
  let deleteBy: Spy;
  let audit: Spy;

  beforeEach(() => {
    insert = jest.fn((rows: unknown): Promise<unknown> => {
      return Promise.resolve({
        identifiers: (rows as Array<unknown>).map(
          (_row: unknown, index: number): JSONObject => {
            return {
              _id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`,
            };
          },
        ),
      });
    });
    getJestSpyOn(SecurityWatchlistItemService, "getRepository").mockReturnValue({
      insert,
    } as never);
    deleteBy = getJestSpyOn(
      SecurityWatchlistItemService,
      "deleteBy",
    ).mockResolvedValue(1 as never);
    audit = getJestSpyOn(AuditLogService, "recordCreate").mockResolvedValue(
      undefined as never,
    );
  });

  function importText(
    text: string,
    mode: SecurityWatchlistImportMode = SecurityWatchlistImportMode.Add,
  ): Promise<SecurityWatchlistImportSummary> {
    return SecurityWatchlistItemService.importValues({
      watchlistId: LIST_ID,
      text,
      mode,
      props: CALLER,
    });
  }

  test("the list is read as the caller: one they cannot read is not found", async () => {
    findList.mockResolvedValue(null as never);

    await expect(importText("alice")).rejects.toThrow("Watchlist not found.");
    expect(findList).toHaveBeenCalledWith(
      expect.objectContaining({ id: LIST_ID, props: CALLER }),
    );
  });

  test("adding: the new values written in one batch, as the caller, each audited", async () => {
    findValues.mockResolvedValue([item("alice")] as never);
    count.mockResolvedValue(new PositiveNumber(3) as never);

    const summary: SecurityWatchlistImportSummary = await importText(
      "value,note\nAlice,already there\nbob,Board\ncarol\nbob\n*",
    );

    expect(insert).toHaveBeenCalledTimes(1);

    const rows: Array<SecurityWatchlistItem> = insert.mock
      .calls[0]![0] as Array<SecurityWatchlistItem>;

    expect(
      rows.map((row: SecurityWatchlistItem): unknown => {
        return [
          row.value,
          row.note,
          row.projectId?.toString(),
          row.securityWatchlistId?.toString(),
          row.createdByUserId?.toString(),
        ];
      }),
    ).toEqual([
      ["bob", "Board", PROJECT_ID.toString(), LIST_ID.toString(), USER_ID.toString()],
      ["carol", undefined, PROJECT_ID.toString(), LIST_ID.toString(), USER_ID.toString()],
    ]);
    expect(audit).toHaveBeenCalledTimes(2);
    expect(deleteBy).not.toHaveBeenCalled();
    expect(updateList).toHaveBeenCalledWith({
      id: LIST_ID,
      data: { valueCount: 3 },
      props: { isRoot: true },
    });
    expect(summary).toEqual({
      added: 2,
      removed: 0,
      unchanged: 1,
      duplicates: 1,
      problems: [
        {
          line: 6,
          value: "*",
          message: "A value of only * would match everything.",
        },
      ],
      problemCount: 1,
      valueCount: 3,
    });
  });

  test("replacing: the values the import does not hold are removed as the caller", async () => {
    findValues.mockResolvedValue([
      item("alice", "99999999-9999-4999-8999-00000000000a"),
      item("dave", "99999999-9999-4999-8999-00000000000d"),
    ] as never);

    const summary: SecurityWatchlistImportSummary = await importText(
      "ALICE\nbob",
      SecurityWatchlistImportMode.Replace,
    );

    expect(deleteBy).toHaveBeenCalledTimes(1);

    const args: { query: JSONObject; props: unknown } = deleteBy.mock
      .calls[0]![0] as { query: JSONObject; props: unknown };

    expect((args.query["_id"] as Includes).values).toEqual([
      "99999999-9999-4999-8999-00000000000d",
    ]);
    expect(String(args.query["securityWatchlistId"])).toBe(LIST_ID.toString());
    expect(args.props).toBe(CALLER);
    expect(summary.added).toBe(1);
    expect(summary.removed).toBe(1);
    expect(summary.unchanged).toBe(1);
  });

  test("a replace with nothing in it is refused: emptying a list is deleting its values", async () => {
    await expect(
      importText("# nothing\n\n", SecurityWatchlistImportMode.Replace),
    ).rejects.toThrow(
      "The import has no values to replace the list with. To empty a list, delete its values.",
    );
    expect(deleteBy).not.toHaveBeenCalled();
  });

  test("an import that would take the list past its limits is refused whole", async () => {
    const lines: Array<string> = [];

    for (let index: number = 0; index < 101; index++) {
      lines.push(`svc-${index}-*`);
    }

    await expect(importText(lines.join("\n"))).rejects.toThrow(
      "A watchlist holds at most 100 values with *.",
    );
    expect(insert).not.toHaveBeenCalled();
  });

  test("lines that are not values are left out and named, the first twenty", async () => {
    findList.mockResolvedValue(
      list({ entityType: SecurityEntityType.IpAddress }) as never,
    );

    const lines: Array<string> = ["10.0.0.1"];

    for (let index: number = 0; index < 25; index++) {
      lines.push(`host-${index}`);
    }

    const summary: SecurityWatchlistImportSummary = await importText(
      lines.join("\n"),
    );

    expect(summary.added).toBe(1);
    expect(summary.problemCount).toBe(25);
    expect(summary.problems).toHaveLength(SECURITY_WATCHLIST_IMPORT_PROBLEMS_SHOWN);
    expect(summary.problems[0]).toEqual({
      line: 2,
      value: "host-0",
      message:
        "Enter an IP address, a range such as 10.20.0.0/16, or a pattern with *.",
    });
  });

  test("a list that follows a feed takes no import", async () => {
    findList.mockResolvedValue(
      list({ source: SecurityWatchlistSource.ThreatIntelFeed }) as never,
    );

    await expect(importText("alice")).rejects.toThrow(BadDataException);
  });

  test("a text past 4 MB is refused before anything is read", async () => {
    await expect(importText("a".repeat(4 * 1024 * 1024 + 1))).rejects.toThrow(
      "An import is at most 4 MB. Split the file, or import it in parts.",
    );
    expect(findList).not.toHaveBeenCalled();
  });

  test("thousands of values go in batches of 500", async () => {
    const lines: Array<string> = [];

    for (let index: number = 0; index < 1200; index++) {
      lines.push(`user-${index}`);
    }

    const summary: SecurityWatchlistImportSummary = await importText(
      lines.join("\n"),
    );

    expect(summary.added).toBe(1200);
    expect(
      insert.mock.calls.map((call: Array<unknown>): number => {
        return (call[0] as Array<unknown>).length;
      }),
    ).toEqual([500, 500, 200]);
    expect(audit).toHaveBeenCalledTimes(1200);
  });

  test("a write that fails half way still leaves the count right", async () => {
    insert.mockImplementationOnce((): Promise<unknown> => {
      return Promise.reject(new Error("insert failed"));
    });

    await expect(importText("alice\nbob")).rejects.toThrow("insert failed");
    expect(updateList).toHaveBeenCalled();
  });
});
