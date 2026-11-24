jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import DatabaseService from "../../../Server/Services/DatabaseService";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  InMemoryListEntryWrite,
  InMemoryTable,
  StoredRow,
  useInMemoryListEntryWrites,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN UPDATE'S LIST CHANGES, IN DatabaseService (#10135).
 *
 * updateOneById makes the entries an update adds to a list and takes off
 * it into the whole list, read from the record as it is now, so every
 * check and hook reads `data` as for a write of the whole list; the row's
 * write then adds and takes off only those entries. A hook that writes a
 * list of its own over it has it saved whole, as it asked, and a list sent
 * whole beside one changed entry by entry is saved whole while the other
 * is written by its entries.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10135100-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10135100-0000-4000-8000-000000000002",
);
const MONITOR_ID: string = "10135100-0000-4000-8000-0000000000a1";
const PARENT_ID: string = "10135100-0000-4000-8000-0000000000a2";
const PRODUCTION: string = "10135100-0000-4000-8000-0000000000b1";
const RULED: string = "10135100-0000-4000-8000-0000000000b2";
const CRITICAL: string = "10135100-0000-4000-8000-0000000000b3";
const FROM_A_HOOK: string = "10135100-0000-4000-8000-0000000000b4";

const ROOT: DatabaseCommonInteractionProps = {
  isRoot: true,
  tenantId: PROJECT_ID,
};

// What each update's hook was handed, and what it hands back in its place.
let handedToHook: Array<Record<string, unknown>> = [];
let hookWrites: ((data: Record<string, unknown>) => void) | null = null;

class MonitorWithAHook extends DatabaseService<Monitor> {
  public constructor() {
    super(Monitor);
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Monitor>,
  ): Promise<OnUpdate<Monitor>> {
    const data: Record<string, unknown> = updateBy.data as Record<
      string,
      unknown
    >;

    handedToHook.push(JSON.parse(JSON.stringify(data)));

    if (hookWrites) {
      hookWrites(data);
    }

    return { updateBy, carryForward: null };
  }
}

const service: MonitorWithAHook = new MonitorWithAHook();

let monitors: InMemoryTable;
let entryWrites: Array<InMemoryListEntryWrite>;

function labelsOf(id: string = MONITOR_ID): Array<string> {
  return ((monitors.get(id)!["labels"] as Array<StoredRow>) || [])
    .map((label: StoredRow): string => {
      return String(label["_id"]).toLowerCase();
    })
    .sort();
}

function idsIn(value: unknown): Array<string> {
  return ((value as Array<{ _id: string }>) || [])
    .map((entry: { _id: string }): string => {
      return String(entry._id).toLowerCase();
    })
    .sort();
}

beforeEach(() => {
  handedToHook = [];
  hookWrites = null;
  stubProjectDirectory({});

  monitors = useInMemoryTable(service, [
    {
      _id: MONITOR_ID,
      projectId: PROJECT_ID.toString(),
      name: "Checkout API",
      labels: [{ _id: PRODUCTION }, { _id: RULED }],
      dependsOnMonitors: [],
    },
    {
      _id: PARENT_ID,
      projectId: PROJECT_ID.toString(),
      name: "Payments API",
      labels: [],
      dependsOnMonitors: [],
    },
  ]);
  entryWrites = useInMemoryListEntryWrites(service, monitors);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the hooks read the whole list", () => {
  test("worked out from the record as it is now: its entries, without those taken off, with those added", async () => {
    const updated: number = await service.updateOneById({
      id: new ObjectID(MONITOR_ID),
      data: {},
      listChanges: { labels: { add: [CRITICAL], remove: [PRODUCTION] } },
      props: ROOT,
    });

    expect(updated).toBe(1);
    expect(handedToHook).toHaveLength(1);
    expect(idsIn(handedToHook[0]!["labels"])).toEqual([RULED, CRITICAL].sort());
    expect(entryWrites).toEqual([
      {
        rowId: MONITOR_ID,
        writes: { labels: { add: [CRITICAL], remove: [PRODUCTION] } },
      },
    ]);
    expect(labelsOf()).toEqual([RULED, CRITICAL].sort());
    // Never a save() of the list: only its entries were written.
    expect(monitors.repository.save).not.toHaveBeenCalled();
  });

  test("a label added to the record after it was read stays", async () => {
    const findOneBy: typeof service.findOneBy = service.findOneBy.bind(service);

    jest
      .spyOn(service, "findOneBy")
      .mockImplementation(async (read: FindOneBy<Monitor>) => {
        const found: Monitor | null = await findOneBy(read);
        const row: StoredRow = monitors.get(MONITOR_ID)!;
        row["labels"] = [
          ...(row["labels"] as Array<StoredRow>),
          { _id: FROM_A_HOOK },
        ];
        return found;
      });

    await service.updateOneById({
      id: new ObjectID(MONITOR_ID),
      data: {},
      listChanges: { labels: { add: [CRITICAL], remove: [] } },
      props: ROOT,
    });

    expect(labelsOf()).toEqual(
      [PRODUCTION, RULED, CRITICAL, FROM_A_HOOK].sort(),
    );
  });
});

describe("a hook that writes the list itself has its own way", () => {
  test("a list of its own over it is saved whole, and no entry is written", async () => {
    hookWrites = (data: Record<string, unknown>): void => {
      data["labels"] = [{ _id: FROM_A_HOOK }];
    };

    await service.updateOneById({
      id: new ObjectID(MONITOR_ID),
      data: {},
      listChanges: { labels: { add: [CRITICAL], remove: [] } },
      props: ROOT,
    });

    expect(entryWrites).toEqual([]);
    expect(monitors.repository.save).toHaveBeenCalledTimes(1);
    expect(labelsOf()).toEqual([FROM_A_HOOK]);
  });

  test("a hook that takes the list out of the write leaves the record's labels as they are", async () => {
    hookWrites = (data: Record<string, unknown>): void => {
      delete data["labels"];
      data["name"] = "Checkout API (renamed by a hook)";
    };

    await service.updateOneById({
      id: new ObjectID(MONITOR_ID),
      data: {},
      listChanges: { labels: { add: [CRITICAL], remove: [] } },
      props: ROOT,
    });

    expect(entryWrites).toEqual([]);
    expect(labelsOf()).toEqual([PRODUCTION, RULED].sort());
    expect(monitors.get(MONITOR_ID)!["name"]).toBe(
      "Checkout API (renamed by a hook)",
    );
  });
});

describe("another list sent whole beside one changed entry by entry", () => {
  test("the whole one is saved without the other, which is written by its entries", async () => {
    await service.updateOneById({
      id: new ObjectID(MONITOR_ID),
      data: { dependsOnMonitors: [{ _id: PARENT_ID }] } as never,
      listChanges: { labels: { add: [CRITICAL], remove: [] } },
      props: ROOT,
    });

    expect(monitors.repository.save).toHaveBeenCalledTimes(1);

    const saved: Record<string, unknown> = (
      monitors.repository.save.mock.calls[0] as Array<Record<string, unknown>>
    )[0]!;

    expect(saved).not.toHaveProperty("labels");
    expect(idsIn(saved["dependsOnMonitors"])).toEqual([PARENT_ID]);
    expect(entryWrites).toEqual([
      {
        rowId: MONITOR_ID,
        writes: { labels: { add: [CRITICAL], remove: [] } },
      },
    ]);
    expect(labelsOf()).toEqual([PRODUCTION, RULED, CRITICAL].sort());
  });
});

describe("what updateOneById refuses", () => {
  test("a field that is not a list of related records", async () => {
    await expect(
      service.updateOneById({
        id: new ObjectID(MONITOR_ID),
        data: {},
        listChanges: { name: { add: [CRITICAL], remove: [] } },
        props: ROOT,
      }),
    ).rejects.toThrow(
      new BadDataException(
        "Monitor has no list of related records called name, so its entries cannot be added or taken off.",
      ),
    );
    expect(entryWrites).toEqual([]);
  });

  test("a list named in data and changed entry by entry at once", async () => {
    await expect(
      service.updateOneById({
        id: new ObjectID(MONITOR_ID),
        data: { labels: [{ _id: CRITICAL }] } as never,
        listChanges: { labels: { add: [CRITICAL], remove: [] } },
        props: ROOT,
      }),
    ).rejects.toThrow(BadDataException);
    expect(entryWrites).toEqual([]);
    expect(labelsOf()).toEqual([PRODUCTION, RULED].sort());
  });
});

describe("a record outside the caller's project", () => {
  test("gives no list to work from, and nothing is written", async () => {
    const updated: number = await service
      .updateOneById({
        id: new ObjectID(MONITOR_ID),
        data: {},
        listChanges: { labels: { add: [CRITICAL], remove: [PRODUCTION] } },
        props: { isRoot: false, tenantId: OTHER_PROJECT_ID },
      })
      .catch((): number => {
        return 0;
      });

    expect(updated).toBe(0);
    expect(entryWrites).toEqual([]);
    expect(labelsOf()).toEqual([PRODUCTION, RULED].sort());
  });
});
