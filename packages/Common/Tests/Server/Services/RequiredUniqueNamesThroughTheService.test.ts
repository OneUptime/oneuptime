import DatabaseService from "../../../Server/Services/DatabaseService";
import RequiredUniqueNames, {
  UNIQUE_NAME_LOCK_NAMESPACE,
} from "../../../Server/Utils/Database/RequiredUniqueNames";
import logger from "../../../Server/Utils/Logger";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import TableView from "../../../Models/DatabaseModels/TableView";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NameTakenException, {
  NAME_TAKEN_REFUSAL_CODE,
  REFUSAL_CODE_FIELD,
  TAKEN_BY_ID_FIELD,
} from "../../../Types/Exception/NameTakenException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "../API/CustomDomainCallers";
import InMemoryLocks from "../TestingUtils/InMemoryLocks";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
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
 * REQUIRE UNIQUE NAMES, THROUGH THE BASE SERVICE (#10761).
 *
 * Every create and every update of a kind marked @UniqueNameWhenRequired
 * goes through DatabaseService, which asks RequiredUniqueNames - so the
 * Dashboard, the API, Terraform and a workflow are held alike, and no
 * service writes a line of its own for it. Here a monitor group (held by
 * the setting) and a table view (left out: its names are one page's) are
 * written by a project member through their services, against tables and
 * locks in memory, with the project's setting switched by the test:
 *
 *   - off, names repeat, and nothing is locked;
 *   - on, a second record of one name - in any case or spacing - is refused
 *     and never written, and so is a rename onto it;
 *   - a write that gives a record its own name again, and the edit of a
 *     record that shared its name before the setting was on, go through;
 *     so does renaming it apart;
 *   - a kind the setting does not hold repeats its names either way;
 *   - two creates of one name at the same moment: the second waits for the
 *     first's lock, which is given back only once its row is written, and
 *     is refused; a refused or failed write gives the lock back too.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

class MonitorGroupWrites extends DatabaseService<MonitorGroup> {
  public constructor() {
    super(MonitorGroup);
  }
}

class TableViewWrites extends DatabaseService<TableView> {
  public constructor() {
    super(TableView);
  }
}

let groups: MonitorGroupWrites;
let views: TableViewWrites;
let groupTable: InMemoryTable;
let viewTable: InMemoryTable;
let locks: InMemoryLocks;
let isRequired: boolean;

function member(): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: [Permission.ProjectOwner],
      projectId: PROJECT_ID,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

function storedGroup(id: string, name: string): StoredRow {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    name: name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    version: 1,
  };
}

async function createGroup(
  name: string,
  props?: DatabaseCommonInteractionProps,
): Promise<MonitorGroup> {
  const group: MonitorGroup = new MonitorGroup();
  group.name = name;
  group.projectId = PROJECT_ID;

  return await groups.create({ data: group, props: props || member() });
}

async function renameGroup(
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await groups.updateOneById({
    id: new ObjectID(id),
    data: data as never,
    props: member(),
  });
}

async function createView(name: string): Promise<TableView> {
  const view: TableView = new TableView();
  view.name = name;
  view.projectId = PROJECT_ID;
  view.tableId = "monitors";
  view.query = {} as never;
  view.sort = {} as never;
  view.itemsOnPage = 10;

  return await views.create({ data: view, props: member() });
}

async function refusalOf(write: Promise<unknown>): Promise<BadDataException> {
  try {
    await write;
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return error as BadDataException;
  }

  throw new Error("Expected the write to be refused.");
}

function namesStored(table: InMemoryTable): Array<string> {
  return table.rows
    .map((row: StoredRow): string => {
      return String(row["name"]);
    })
    .sort();
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  stubProjectDirectory({});

  isRequired = true;
  getJestSpyOn(RequiredUniqueNames, "isRequiredInProject").mockImplementation(
    async (): Promise<boolean> => {
      return isRequired;
    },
  );

  locks = new InMemoryLocks();
  locks.install();

  groups = new MonitorGroupWrites();
  views = new TableViewWrites();
  groupTable = useInMemoryTable(groups, []);
  viewTable = useInMemoryTable(views, []);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("with Require Unique Names off", () => {
  test("two monitor groups may share a name, and nothing is locked", async () => {
    isRequired = false;

    await createGroup("Production");
    await createGroup("production ");

    expect(namesStored(groupTable)).toEqual(["Production", "production "]);
    expect(
      locks.events.filter((event: string): boolean => {
        return event.includes(UNIQUE_NAME_LOCK_NAMESPACE);
      }),
    ).toEqual([]);
  });

  test("a monitor group may be renamed onto another's name", async () => {
    isRequired = false;
    groupTable.rows.push(
      storedGroup("00000000-0000-4000-8000-000000000001", "Production"),
    );
    groupTable.rows.push(
      storedGroup("00000000-0000-4000-8000-000000000002", "Staging"),
    );

    await renameGroup("00000000-0000-4000-8000-000000000002", {
      name: "Production",
    });

    expect(namesStored(groupTable)).toEqual(["Production", "Production"]);
  });
});

describe("with Require Unique Names on", () => {
  test("a monitor group with a name of its own is created", async () => {
    const created: MonitorGroup = await createGroup("Production");

    expect(created.id).toBeTruthy();
    expect(namesStored(groupTable)).toEqual(["Production"]);
  });

  test("a second monitor group of one name, in another case and spacing, is refused and never written", async () => {
    const first: MonitorGroup = await createGroup("Production APIs");

    const refusal: BadDataException = await refusalOf(
      createGroup("  production   apis "),
    );

    expect(refusal).toBeInstanceOf(NameTakenException);
    expect(refusal.message).toBe(
      "Another monitor group in this project is already called Production APIs, and the project requires unique names. Pick another name.",
    );
    expect((refusal as NameTakenException).details).toEqual({
      [REFUSAL_CODE_FIELD]: NAME_TAKEN_REFUSAL_CODE,
      [TAKEN_BY_ID_FIELD]: first.id!.toString(),
    });
    expect(namesStored(groupTable)).toEqual(["Production APIs"]);
  });

  test("a rename onto another monitor group's name is refused, and the group keeps its own", async () => {
    groupTable.rows.push(
      storedGroup("00000000-0000-4000-8000-000000000001", "Production"),
    );
    groupTable.rows.push(
      storedGroup("00000000-0000-4000-8000-000000000002", "Staging"),
    );

    await refusalOf(
      renameGroup("00000000-0000-4000-8000-000000000002", {
        name: "PRODUCTION",
      }),
    );

    expect(namesStored(groupTable)).toEqual(["Production", "Staging"]);
  });

  test("a group written with its own name again, in another case, goes through", async () => {
    groupTable.rows.push(
      storedGroup("00000000-0000-4000-8000-000000000001", "Production"),
    );

    await renameGroup("00000000-0000-4000-8000-000000000001", {
      name: "production",
      description: "Every production API",
    });

    expect(
      groupTable.get("00000000-0000-4000-8000-000000000001")?.["name"],
    ).toBe("production");
  });

  test("groups that shared a name before the setting was on stay valid: each is edited, and renamed apart", async () => {
    groupTable.rows.push(
      storedGroup("00000000-0000-4000-8000-000000000001", "Production"),
    );
    groupTable.rows.push(
      storedGroup("00000000-0000-4000-8000-000000000002", "Production"),
    );

    // An edit that sends the name back, as every edit form does.
    await renameGroup("00000000-0000-4000-8000-000000000002", {
      name: "Production",
      description: "The old one",
    });

    expect(
      groupTable.get("00000000-0000-4000-8000-000000000002")?.["description"],
    ).toBe("The old one");

    // Renamed apart.
    await renameGroup("00000000-0000-4000-8000-000000000002", {
      name: "Production (old)",
    });

    expect(namesStored(groupTable)).toEqual(["Production", "Production (old)"]);
  });

  test("OneUptime's own writes are trusted", async () => {
    await createGroup("Production");
    await createGroup("Production", {
      isRoot: true,
      tenantId: PROJECT_ID,
    } as DatabaseCommonInteractionProps);

    expect(namesStored(groupTable)).toEqual(["Production", "Production"]);
  });

  test("a table view, a kind the setting leaves out, repeats its names", async () => {
    await createView("Errors");
    await createView("errors");

    expect(namesStored(viewTable)).toEqual(["Errors", "errors"]);
  });
});

describe("two creates of one name at the same moment", () => {
  test("the second waits for the first's lock, given back once its row is written, and is refused", async () => {
    const lockKey: string = RequiredUniqueNames.getLockKey({
      tableName: "MonitorGroup",
      projectId: PROJECT_ID,
      name: "Production",
    });

    const results: Array<PromiseSettledResult<MonitorGroup>> =
      await Promise.allSettled([
        createGroup("Production"),
        createGroup("production"),
      ]);

    const created: Array<PromiseSettledResult<MonitorGroup>> = results.filter(
      (result: PromiseSettledResult<MonitorGroup>): boolean => {
        return result.status === "fulfilled";
      },
    );
    const refused: Array<PromiseSettledResult<MonitorGroup>> = results.filter(
      (result: PromiseSettledResult<MonitorGroup>): boolean => {
        return result.status === "rejected";
      },
    );

    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      NameTakenException,
    );
    expect(groupTable.rows).toHaveLength(1);

    const fullKey: string = `${UNIQUE_NAME_LOCK_NAMESPACE}/${lockKey}`;

    // One took the lock, the other waited for it, and both gave it back.
    expect(
      locks.events.filter((event: string): boolean => {
        return event.endsWith(fullKey);
      }),
    ).toEqual([
      `lock:${fullKey}`,
      `wait:${fullKey}`,
      `release:${fullKey}`,
      `lock:${fullKey}`,
      `release:${fullKey}`,
    ]);
    expect(locks.isHeld(lockKey, UNIQUE_NAME_LOCK_NAMESPACE)).toBe(false);
  });

  test("the first gives the lock back only once its row is written", async () => {
    const lockKey: string = RequiredUniqueNames.getLockKey({
      tableName: "MonitorGroup",
      projectId: PROJECT_ID,
      name: "Production",
    });
    let heldWhileWriting: boolean | null = null;
    const save: unknown = groupTable.repository.save.getMockImplementation();

    groupTable.repository.save.mockImplementation((async (
      row: StoredRow,
    ): Promise<unknown> => {
      heldWhileWriting = locks.isHeld(lockKey, UNIQUE_NAME_LOCK_NAMESPACE);
      return await (save as (row: StoredRow) => Promise<unknown>)(row);
    }) as never);

    await createGroup("Production");

    expect(heldWhileWriting).toBe(true);
    expect(locks.isHeld(lockKey, UNIQUE_NAME_LOCK_NAMESPACE)).toBe(false);
  });

  test("a create that fails at its INSERT gives the lock back", async () => {
    const lockKey: string = RequiredUniqueNames.getLockKey({
      tableName: "MonitorGroup",
      projectId: PROJECT_ID,
      name: "Production",
    });

    groupTable.repository.save.mockRejectedValueOnce(
      new Error("connection reset") as never,
    );

    await expect(createGroup("Production")).rejects.toBeTruthy();

    expect(locks.isHeld(lockKey, UNIQUE_NAME_LOCK_NAMESPACE)).toBe(false);
    expect(groupTable.rows).toHaveLength(0);

    // And the name is free for the next create.
    await createGroup("Production");
    expect(namesStored(groupTable)).toEqual(["Production"]);
  });

  test("a rename holds its new name until its row is written, then gives it back", async () => {
    groupTable.rows.push(
      storedGroup("00000000-0000-4000-8000-000000000001", "Staging"),
    );

    const lockKey: string = RequiredUniqueNames.getLockKey({
      tableName: "MonitorGroup",
      projectId: PROJECT_ID,
      name: "Production",
    });
    let heldWhileWriting: boolean | null = null;
    const update: unknown =
      groupTable.repository.update.getMockImplementation();

    groupTable.repository.update.mockImplementation((async (
      ...args: Array<unknown>
    ): Promise<unknown> => {
      heldWhileWriting = locks.isHeld(lockKey, UNIQUE_NAME_LOCK_NAMESPACE);
      return await (update as (...args: Array<unknown>) => Promise<unknown>)(
        ...args,
      );
    }) as never);

    await renameGroup("00000000-0000-4000-8000-000000000001", {
      name: "Production",
    });

    expect(heldWhileWriting).toBe(true);
    expect(locks.isHeld(lockKey, UNIQUE_NAME_LOCK_NAMESPACE)).toBe(false);
    expect(namesStored(groupTable)).toEqual(["Production"]);
  });

  test("without Valkey a create goes ahead unlocked, still checked", async () => {
    locks.unreachable = true;

    await createGroup("Production");
    await refusalOf(createGroup("Production"));

    expect(namesStored(groupTable)).toEqual(["Production"]);
  });
});
