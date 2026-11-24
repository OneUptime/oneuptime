import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import IncidentService from "../../../../Server/Services/IncidentService";
import ProjectService from "../../../../Server/Services/ProjectService";
import IncidentTemplateService from "../../../../Server/Services/IncidentTemplateService";
import MonitorService from "../../../../Server/Services/MonitorService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import RequiredUniqueNames, {
  UNIQUE_NAME_LOCK_NAMESPACE,
} from "../../../../Server/Utils/Database/RequiredUniqueNames";
import logger from "../../../../Server/Utils/Logger";
import IncidentTemplate from "../../../../Models/DatabaseModels/IncidentTemplate";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  getNumbersTakenNameData,
  isNumbersTakenName,
  MAX_DUPLICATE_GROUPS_PER_KIND,
  MAX_DUPLICATE_RECORDS_PER_GROUP,
  NUMBERS_TAKEN_NAME_KEY,
  UniqueNameCheckAnswer,
  DuplicateNamesOfKind,
} from "../../../../Types/Database/RequiredUniqueNames";
import {
  FREE_NAME_ATTEMPTS,
  NAME_WHITE_SPACE_RUN_PATTERN,
  REQUIRED_UNIQUE_NAMES_RENAMED_TOGETHER_REFUSAL,
} from "../../../../Types/Database/UniqueName";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NameTakenException, {
  NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
  NAME_TAKEN_REFUSAL_CODE,
  REFUSAL_CODE_FIELD,
  TAKEN_BY_ID_FIELD,
} from "../../../../Types/Exception/NameTakenException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * NAMES ONE OF THEIR KIND IN A PROJECT THAT REQUIRES IT (#10761).
 *
 * RequiredUniqueNames is what the base service asks on every create and
 * rename of a kind marked @UniqueNameWhenRequired (a monitor's name, a
 * template's templateName). Here, with the project's setting, the lock and
 * the reads stubbed and recorded:
 *
 *   - with the setting off, nothing is refused, locked or even looked for;
 *   - with it on, a create or a rename onto a name another record of the
 *     kind has - case and spacing aside - is refused, in the words of a
 *     record in service or an archived one, naming the other record and its
 *     id to a caller who may read it, and nothing of it to one who may not;
 *   - a write that gives a record its own name again is no rename;
 *   - one update that would give several records the name is refused;
 *   - OneUptime's own writes, and kinds the setting does not hold, are let
 *     through untouched;
 *   - the name is held by a lock from the check until the write is done -
 *     given back at once when it is refused - and a write goes ahead,
 *     checked, when the lock cannot be had;
 *   - a form's check and the list of names held twice answer only with what
 *     the reader may read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SECOND_MONITOR_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const HOLDER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const USER_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

const MEMBER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

interface RawOperator {
  getSql: (alias: string) => string;
  objectLiteralParameters: Record<string, unknown>;
}

interface RecordedFind {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort?: Record<string, unknown>;
  props: Record<string, unknown>;
}

function monitor(data: {
  id: ObjectID;
  name: string;
  isArchived?: boolean;
  projectId?: ObjectID;
}): Monitor {
  const model: Monitor = new Monitor();
  model._id = data.id.toString();
  model.name = data.name;
  model.projectId = data.projectId || PROJECT_ID;
  model.isArchived = data.isArchived || false;
  return model;
}

let isRequired: boolean = true;
let lockTaken: Array<{ key: string; namespace: string }> = [];
let released: Array<SemaphoreMutex> = [];
const MUTEX: SemaphoreMutex = {
  identifier: "held",
} as unknown as SemaphoreMutex;

beforeEach(() => {
  isRequired = true;
  lockTaken = [];
  released = [];

  getJestSpyOn(RequiredUniqueNames, "isRequiredInProject").mockImplementation(
    async (): Promise<boolean> => {
      return isRequired;
    },
  );

  getJestSpyOn(Semaphore, "lock").mockImplementation(
    async (data: {
      key: string;
      namespace: string;
    }): Promise<SemaphoreMutex> => {
      lockTaken.push({ key: data.key, namespace: data.namespace });
      return MUTEX;
    },
  );

  getJestSpyOn(Semaphore, "release").mockImplementation(
    async (mutex: SemaphoreMutex): Promise<void> => {
      released.push(mutex);
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The record that has the name - or none - as the clash read finds it, and
 * whether the caller may read it, as the second read finds it.
 */
function stubHolder(
  holder: Monitor | null,
  options?: { isReadable?: boolean },
): Array<RecordedFind> {
  const finds: Array<RecordedFind> = [];

  getJestSpyOn(MonitorService, "findOneBy").mockImplementation(
    async (findOneBy: RecordedFind): Promise<Monitor | null> => {
      finds.push(findOneBy);

      // The caller's own read of the holder: may they read it?
      if (findOneBy.props["isRoot"] !== true) {
        return options?.isReadable === false ? null : holder;
      }

      return holder;
    },
  );

  return finds;
}

function stubRowsWritten(rows: Array<Monitor>): void {
  getJestSpyOn(MonitorService, "findRowsAndHoldUpdateToThem").mockResolvedValue(
    rows,
  );
}

function createMonitor(
  data: Record<string, unknown>,
  props?: DatabaseCommonInteractionProps,
): Promise<SemaphoreMutex | null> {
  const model: Monitor = new Monitor();
  Object.assign(model, data);

  return RequiredUniqueNames.holdNameOnCreate({
    service: MonitorService,
    createBy: {
      data: model,
      props: props || MEMBER_PROPS,
    } as CreateBy<Monitor>,
  });
}

function renameMonitor(
  data: Record<string, unknown>,
  props?: DatabaseCommonInteractionProps,
): Promise<SemaphoreMutex | null> {
  return RequiredUniqueNames.holdNameOnRename({
    service: MonitorService,
    updateBy: {
      query: { _id: MONITOR_ID.toString() },
      data: data,
      props: props || MEMBER_PROPS,
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<Monitor>,
  });
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

function nameAskedFor(
  find: RecordedFind,
  column: string,
): { sql: string; values: Array<unknown> } {
  const operator: RawOperator = find.query[column] as RawOperator;

  return {
    sql: operator.getSql(`"Monitor"."${column}"`),
    values: Object.values(operator.objectLiteralParameters),
  };
}

describe("a new record of a kind the setting holds", () => {
  test("is let through, unlocked and unread, while the project lets names repeat", async () => {
    isRequired = false;
    const finds: Array<RecordedFind> = stubHolder(
      monitor({ id: HOLDER_ID, name: "API Health Check" }),
    );

    await expect(
      createMonitor({ name: "API Health Check", projectId: PROJECT_ID }),
    ).resolves.toBeNull();

    expect(finds).toHaveLength(0);
    expect(lockTaken).toHaveLength(0);
  });

  test("named as another record of its kind is refused, naming that record and its id", async () => {
    stubHolder(monitor({ id: HOLDER_ID, name: "API Health Check" }));

    const refusal: BadDataException = await refusalOf(
      createMonitor({ name: "  api   health check ", projectId: PROJECT_ID }),
    );

    expect(refusal).toBeInstanceOf(NameTakenException);
    expect(refusal.message).toBe(
      "Another monitor in this project is already called API Health Check, and the project requires unique names. Pick another name.",
    );
    expect((refusal as NameTakenException).details).toEqual({
      [REFUSAL_CODE_FIELD]: NAME_TAKEN_REFUSAL_CODE,
      [TAKEN_BY_ID_FIELD]: HOLDER_ID.toString(),
    });
  });

  test("named as a record the caller may not read is refused with the name as written, and nothing of that record", async () => {
    stubHolder(monitor({ id: HOLDER_ID, name: "API HEALTH CHECK" }), {
      isReadable: false,
    });

    const refusal: BadDataException = await refusalOf(
      createMonitor({ name: "api health check", projectId: PROJECT_ID }),
    );

    expect(refusal.message).toBe(
      "Another monitor in this project is already called api health check, and the project requires unique names. Pick another name.",
    );
    expect((refusal as NameTakenException).details).toEqual({
      [REFUSAL_CODE_FIELD]: NAME_TAKEN_REFUSAL_CODE,
    });
  });

  test("named as an archived record is refused with the archived words and code", async () => {
    stubHolder(
      monitor({ id: HOLDER_ID, name: "API Health Check", isArchived: true }),
    );

    const refusal: BadDataException = await refusalOf(
      createMonitor({ name: "API Health Check", projectId: PROJECT_ID }),
    );

    expect(refusal.message).toBe(
      "An archived monitor in this project is already called API Health Check, and the project requires unique names. Unarchive it, or pick another name.",
    );
    expect((refusal as NameTakenException).isTakenByArchived).toBe(true);
    expect((refusal as NameTakenException).details[REFUSAL_CODE_FIELD]).toBe(
      NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
    );
  });

  test("is looked for in its own project, as it reads, as OneUptime, a record in service first", async () => {
    const finds: Array<RecordedFind> = stubHolder(null);

    await createMonitor({ name: "Platform  Check", projectId: PROJECT_ID });

    expect(finds).toHaveLength(1);
    const find: RecordedFind = finds[0]!;

    expect(find.query["projectId"]).toEqual(PROJECT_ID);
    expect(find.query["_id"]).toBeUndefined();
    expect(find.props).toEqual({ isRoot: true });
    expect(find.select).toEqual({ _id: true, name: true, isArchived: true });
    expect(find.sort).toEqual({ isArchived: SortOrder.Ascending });

    const asked: { sql: string; values: Array<unknown> } = nameAskedFor(
      find,
      "name",
    );

    expect(asked.sql).toContain(`LOWER(BTRIM(REGEXP_REPLACE("Monitor"."name"`);
    expect(asked.values).toEqual([
      "Platform  Check",
      NAME_WHITE_SPACE_RUN_PATTERN,
    ]);
  });

  test("with a free name holds it, by a lock on its kind, its project and its name", async () => {
    stubHolder(null);

    await expect(
      createMonitor({ name: "API Health Check", projectId: PROJECT_ID }),
    ).resolves.toBe(MUTEX);

    expect(lockTaken).toEqual([
      {
        namespace: UNIQUE_NAME_LOCK_NAMESPACE,
        key: RequiredUniqueNames.getLockKey({
          tableName: "Monitor",
          projectId: PROJECT_ID,
          name: "API Health Check",
        }),
      },
    ]);
    // Held: given back by the base service once the INSERT has committed.
    expect(released).toHaveLength(0);
  });

  test("refused, gives the lock back at once", async () => {
    stubHolder(monitor({ id: HOLDER_ID, name: "API Health Check" }));

    await refusalOf(
      createMonitor({ name: "API Health Check", projectId: PROJECT_ID }),
    );

    expect(lockTaken).toHaveLength(1);
    expect(released).toEqual([MUTEX]);
  });

  test("looks for the name only once it holds the lock", async () => {
    const order: Array<string> = [];

    getJestSpyOn(Semaphore, "lock").mockImplementation(
      async (): Promise<SemaphoreMutex> => {
        order.push("lock");
        return MUTEX;
      },
    );

    getJestSpyOn(MonitorService, "findOneBy").mockImplementation(
      async (): Promise<Monitor | null> => {
        order.push("look");
        return null;
      },
    );

    await createMonitor({ name: "API Health Check", projectId: PROJECT_ID });

    expect(order).toEqual(["lock", "look"]);
  });

  test("goes ahead, still checked, when the lock cannot be had", async () => {
    getJestSpyOn(Semaphore, "lock").mockRejectedValue(
      new Error("Redis client is not connected"),
    );
    const logged: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      logger,
      "error",
    ).mockImplementation(() => {
      return undefined as never;
    });

    stubHolder(null);

    await expect(
      createMonitor({ name: "API Health Check", projectId: PROJECT_ID }),
    ).resolves.toBeNull();
    expect(logged).toHaveBeenCalled();

    stubHolder(monitor({ id: HOLDER_ID, name: "API Health Check" }));

    await refusalOf(
      createMonitor({ name: "API Health Check", projectId: PROJECT_ID }),
    );
  });

  test("named only by the request's project is compared there", async () => {
    const finds: Array<RecordedFind> = stubHolder(null);

    await createMonitor({ name: "API Health Check" });

    expect(finds[0]!.query["projectId"]).toEqual(PROJECT_ID);
  });

  test("with no name, or none of its own project, leaves it to the column's checks and reads nothing", async () => {
    const finds: Array<RecordedFind> = stubHolder(
      monitor({ id: HOLDER_ID, name: "API Health Check" }),
    );

    await expect(
      createMonitor({ name: "   ", projectId: PROJECT_ID }),
    ).resolves.toBeNull();
    await expect(createMonitor({ projectId: PROJECT_ID })).resolves.toBeNull();
    await expect(
      createMonitor({ name: "API Health Check" }, {
        userId: USER_ID,
      } as DatabaseCommonInteractionProps),
    ).resolves.toBeNull();

    expect(finds).toHaveLength(0);
    expect(lockTaken).toHaveLength(0);
  });

  test("made by OneUptime itself is trusted", async () => {
    const finds: Array<RecordedFind> = stubHolder(
      monitor({ id: HOLDER_ID, name: "API Health Check" }),
    );

    await expect(
      createMonitor({ name: "API Health Check", projectId: PROJECT_ID }, {
        isRoot: true,
      } as DatabaseCommonInteractionProps),
    ).resolves.toBeNull();

    expect(finds).toHaveLength(0);
  });

  test("of a template is held by its template name", async () => {
    const finds: Array<RecordedFind> = [];

    getJestSpyOn(IncidentTemplateService, "findOneBy").mockImplementation(
      async (findOneBy: RecordedFind): Promise<IncidentTemplate | null> => {
        finds.push(findOneBy);
        const template: IncidentTemplate = new IncidentTemplate();
        template._id = HOLDER_ID.toString();
        template.templateName = "Database Outage";
        return template;
      },
    );

    const template: IncidentTemplate = new IncidentTemplate();
    template.templateName = "database outage";
    template.projectId = PROJECT_ID;

    const refusal: BadDataException = await refusalOf(
      RequiredUniqueNames.holdNameOnCreate({
        service: IncidentTemplateService,
        createBy: {
          data: template,
          props: MEMBER_PROPS,
        } as CreateBy<IncidentTemplate>,
      }),
    );

    expect(refusal.message).toBe(
      "Another incident template in this project is already called Database Outage, and the project requires unique names. Pick another name.",
    );
    expect(finds[0]!.query["templateName"]).toBeDefined();
    expect(finds[0]!.query["name"]).toBeUndefined();
  });
});

describe("a name OneUptime picked for the person", () => {
  /*
   * The records that hold names, by the name as it reads: the clash read
   * answers the one whose name it asks for.
   */
  function stubHoldersByName(holders: Record<string, Monitor>): Array<string> {
    const asked: Array<string> = [];

    getJestSpyOn(MonitorService, "findOneBy").mockImplementation(
      async (findOneBy: RecordedFind): Promise<Monitor | null> => {
        if (findOneBy.props["isRoot"] !== true) {
          return monitor({ id: HOLDER_ID, name: "whoever" });
        }

        const name: string = String(
          Object.values(
            (findOneBy.query["name"] as RawOperator).objectLiteralParameters,
          )[0],
        );

        asked.push(name);

        return holders[name.toLowerCase().trim()] || null;
      },
    );

    return asked;
  }

  function createNamedByOneUptime(name: string): {
    model: Monitor;
    hold: Promise<SemaphoreMutex | null>;
  } {
    const model: Monitor = new Monitor();
    model.name = name;
    model.projectId = PROJECT_ID;

    return {
      model: model,
      hold: RequiredUniqueNames.holdNameOnCreate({
        service: MonitorService,
        createBy: {
          data: model,
          miscDataProps: getNumbersTakenNameData(),
          props: MEMBER_PROPS,
        } as CreateBy<Monitor>,
      }),
    };
  }

  test("takes the next free number instead of being refused, and holds that name", async () => {
    const asked: Array<string> = stubHoldersByName({
      "web - high cpu": monitor({ id: HOLDER_ID, name: "web - High CPU" }),
      "web - high cpu 2": monitor({
        id: SECOND_MONITOR_ID,
        name: "web - High CPU 2",
      }),
    });

    const create: { model: Monitor; hold: Promise<SemaphoreMutex | null> } =
      createNamedByOneUptime("web - High CPU");

    await expect(create.hold).resolves.toBe(MUTEX);

    expect(create.model.name).toBe("web - High CPU 3");
    expect(asked).toEqual([
      "web - High CPU",
      "web - High CPU 2",
      "web - High CPU 3",
    ]);

    // Each name was held while it was looked for; the taken ones given back.
    expect(
      lockTaken.map((lock: { key: string }) => {
        return lock.key;
      }),
    ).toEqual(
      ["web - High CPU", "web - High CPU 2", "web - High CPU 3"].map(
        (name: string): string => {
          return RequiredUniqueNames.getLockKey({
            tableName: "Monitor",
            projectId: PROJECT_ID,
            name: name,
          });
        },
      ),
    );
    expect(released).toHaveLength(2);
  });

  test("keeps its own name when nothing has it", async () => {
    stubHoldersByName({});

    const create: { model: Monitor; hold: Promise<SemaphoreMutex | null> } =
      createNamedByOneUptime("example.com");

    await expect(create.hold).resolves.toBe(MUTEX);
    expect(create.model.name).toBe("example.com");
  });

  test("is refused once every number it tries is taken", async () => {
    const holders: Record<string, Monitor> = {
      x: monitor({ id: HOLDER_ID, name: "x" }),
    };

    for (let number: number = 2; number <= FREE_NAME_ATTEMPTS; number++) {
      holders[`x ${number}`] = monitor({ id: HOLDER_ID, name: `x ${number}` });
    }

    const asked: Array<string> = stubHoldersByName(holders);

    const create: { model: Monitor; hold: Promise<SemaphoreMutex | null> } =
      createNamedByOneUptime("x");

    await expect(create.hold).rejects.toBeInstanceOf(NameTakenException);
    expect(asked).toHaveLength(FREE_NAME_ATTEMPTS);
    expect(released).toHaveLength(FREE_NAME_ATTEMPTS);
  });

  test("numbered, keeps to its column's length and its number", async () => {
    const long: string = "a".repeat(100);

    stubHoldersByName({ [long]: monitor({ id: HOLDER_ID, name: long }) });

    const create: { model: Monitor; hold: Promise<SemaphoreMutex | null> } =
      createNamedByOneUptime(long);

    await create.hold;

    expect(create.model.name).toBe(`${"a".repeat(98)} 2`);
    expect(create.model.name!.length).toBe(100);
  });

  test("of a rename takes the next free number too", async () => {
    stubRowsWritten([monitor({ id: MONITOR_ID, name: "Old Name" })]);
    stubHoldersByName({
      "web - high cpu": monitor({ id: HOLDER_ID, name: "web - High CPU" }),
    });

    const data: Record<string, unknown> = { name: "web - High CPU" };

    await expect(
      RequiredUniqueNames.holdNameOnRename({
        service: MonitorService,
        updateBy: {
          query: { _id: MONITOR_ID.toString() },
          data: data,
          miscDataProps: getNumbersTakenNameData(),
          props: MEMBER_PROPS,
          limit: 1,
          skip: 0,
        } as unknown as UpdateBy<Monitor>,
      }),
    ).resolves.toBe(MUTEX);

    expect(data["name"]).toBe("web - High CPU 2");
  });

  test("a name a person typed is never numbered: it is refused", async () => {
    stubHoldersByName({
      "web - high cpu": monitor({ id: HOLDER_ID, name: "web - High CPU" }),
    });

    await refusalOf(
      createMonitor({ name: "web - High CPU", projectId: PROJECT_ID }),
    );
  });

  test("a create its service named - left empty, named after its provider - is marked so", () => {
    const createBy: CreateBy<Monitor> = {
      data: new Monitor(),
      miscDataProps: { ownerUsers: ["x"] },
      props: MEMBER_PROPS,
    } as CreateBy<Monitor>;

    RequiredUniqueNames.numberTakenNameOf(createBy);

    expect(createBy.miscDataProps).toEqual({
      ownerUsers: ["x"],
      [NUMBERS_TAKEN_NAME_KEY]: true,
    });
    expect(isNumbersTakenName(createBy.miscDataProps)).toBe(true);
  });

  test("the misc data that asks for it, and nothing else, does", () => {
    expect(getNumbersTakenNameData()).toEqual({ numbersTakenName: true });
    expect(isNumbersTakenName({ numbersTakenName: true })).toBe(true);
    expect(isNumbersTakenName({ numbersTakenName: "true" })).toBe(false);
    expect(isNumbersTakenName({})).toBe(false);
    expect(isNumbersTakenName(undefined)).toBe(false);
    expect(isNumbersTakenName("numbersTakenName")).toBe(false);
  });
});

describe("a project's setting, read by the server", () => {
  beforeEach(() => {
    // The real read, not the stand-in every other test uses.
    jest.restoreAllMocks();
  });

  test("is read as OneUptime, the one column it needs", async () => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    const read: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ProjectService,
      "findOneById",
    ).mockResolvedValue({ requireUniqueNames: true } as never);

    expect(await RequiredUniqueNames.isRequiredInProject(PROJECT_ID)).toBe(
      true,
    );
    expect(read).toHaveBeenCalledWith({
      id: PROJECT_ID,
      select: { requireUniqueNames: true },
      props: { isRoot: true },
    });
  });

  test("lets names repeat where it is off, or the project is not there", async () => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    const read: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ProjectService,
      "findOneById",
    );

    read.mockResolvedValue({ requireUniqueNames: false } as never);
    expect(await RequiredUniqueNames.isRequiredInProject(PROJECT_ID)).toBe(
      false,
    );

    read.mockResolvedValue(null as never);
    expect(await RequiredUniqueNames.isRequiredInProject(PROJECT_ID)).toBe(
      false,
    );
  });

  test("never fails a write it cannot read the setting for: names repeat, and the failure is logged", async () => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    getJestSpyOn(ProjectService, "findOneById").mockRejectedValue(
      new Error("connection reset"),
    );
    const logged: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      logger,
      "error",
    ).mockImplementation(() => {
      return undefined as never;
    });

    expect(await RequiredUniqueNames.isRequiredInProject(PROJECT_ID)).toBe(
      false,
    );
    expect(logged).toHaveBeenCalled();
  });

  test("reads nothing without a database", async () => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(false);
    const read: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ProjectService,
      "findOneById",
    );

    expect(await RequiredUniqueNames.isRequiredInProject(PROJECT_ID)).toBe(
      false,
    );
    expect(read).not.toHaveBeenCalled();
  });
});

describe("a kind the setting does not hold", () => {
  test("an incident's title repeats freely: nothing is read or locked", async () => {
    const read: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      IncidentService,
      "findOneBy",
    );

    await expect(
      RequiredUniqueNames.holdNameOnCreate({
        service: IncidentService,
        createBy: {
          data: { title: "Database down", projectId: PROJECT_ID },
          props: MEMBER_PROPS,
        } as unknown as CreateBy<never>,
      }),
    ).resolves.toBeNull();

    expect(RequiredUniqueNames.getColumn(IncidentService)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(RequiredUniqueNames.isRequiredInProject).not.toHaveBeenCalled();
    expect(lockTaken).toHaveLength(0);
  });
});

describe("renaming a record of a kind the setting holds", () => {
  test("onto another record's name is refused, and the lock given back", async () => {
    stubRowsWritten([monitor({ id: MONITOR_ID, name: "Old Name" })]);
    const finds: Array<RecordedFind> = stubHolder(
      monitor({ id: HOLDER_ID, name: "API Health Check" }),
    );

    const refusal: BadDataException = await refusalOf(
      renameMonitor({ name: "API health check" }),
    );

    expect(refusal.message).toBe(
      "Another monitor in this project is already called API Health Check, and the project requires unique names. Pick another name.",
    );
    expect(released).toEqual([MUTEX]);

    // The record itself never holds its own new name against it.
    expect(finds[0]!.query["_id"]).toBeDefined();
  });

  test("onto a free name holds it until the row is written", async () => {
    stubRowsWritten([monitor({ id: MONITOR_ID, name: "Old Name" })]);
    stubHolder(null);

    await expect(renameMonitor({ name: "New Name" })).resolves.toBe(MUTEX);
    expect(released).toHaveLength(0);
  });

  test("with its own name again, in another case or spacing, is no rename: nothing is read or locked", async () => {
    stubRowsWritten([monitor({ id: MONITOR_ID, name: "API Health Check" })]);
    const finds: Array<RecordedFind> = stubHolder(
      monitor({ id: HOLDER_ID, name: "API Health Check" }),
    );

    await expect(
      renameMonitor({ name: "  api  HEALTH check" }),
    ).resolves.toBeNull();

    expect(finds).toHaveLength(0);
    expect(lockTaken).toHaveLength(0);
    expect(RequiredUniqueNames.isRequiredInProject).not.toHaveBeenCalled();
  });

  test("onto a taken name is let through while the project lets names repeat", async () => {
    isRequired = false;
    stubRowsWritten([monitor({ id: MONITOR_ID, name: "Old Name" })]);
    const finds: Array<RecordedFind> = stubHolder(
      monitor({ id: HOLDER_ID, name: "API Health Check" }),
    );

    await expect(
      renameMonitor({ name: "API Health Check" }),
    ).resolves.toBeNull();
    expect(finds).toHaveLength(0);
  });

  test("of several records to one name in one update is refused, with no code", async () => {
    stubRowsWritten([
      monitor({ id: MONITOR_ID, name: "First" }),
      monitor({ id: SECOND_MONITOR_ID, name: "Second" }),
    ]);
    stubHolder(null);

    const refusal: BadDataException = await refusalOf(
      renameMonitor({ name: "Same" }),
    );

    expect(refusal).not.toBeInstanceOf(NameTakenException);
    expect(refusal.message).toBe(
      REQUIRED_UNIQUE_NAMES_RENAMED_TOGETHER_REFUSAL,
    );
    expect(lockTaken).toHaveLength(0);
  });

  test("of several records is let through while their project lets names repeat", async () => {
    isRequired = false;
    stubRowsWritten([
      monitor({ id: MONITOR_ID, name: "First" }),
      monitor({ id: SECOND_MONITOR_ID, name: "Second" }),
    ]);

    await expect(renameMonitor({ name: "Same" })).resolves.toBeNull();
  });

  test("that writes no name reads nothing", async () => {
    const rows: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      MonitorService,
      "findRowsAndHoldUpdateToThem",
    );

    await expect(
      renameMonitor({ description: "Checks the API" }),
    ).resolves.toBeNull();
    await expect(renameMonitor({ name: "  " })).resolves.toBeNull();

    expect(rows).not.toHaveBeenCalled();
  });

  test("by OneUptime itself is trusted", async () => {
    const rows: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      MonitorService,
      "findRowsAndHoldUpdateToThem",
    );

    await expect(
      renameMonitor({ name: "API Health Check" }, {
        isRoot: true,
      } as DatabaseCommonInteractionProps),
    ).resolves.toBeNull();

    expect(rows).not.toHaveBeenCalled();
  });

  test("reads the rows it writes through the update's own hold", async () => {
    const rows: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      MonitorService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([monitor({ id: MONITOR_ID, name: "Old" })]);
    stubHolder(null);

    await renameMonitor({ name: "New" });

    expect(rows).toHaveBeenCalledTimes(1);
    expect(rows.mock.calls[0]![1]).toEqual({
      _id: true,
      projectId: true,
      name: true,
    });
  });
});

describe("a hold given back", () => {
  test("releases the lock it holds", async () => {
    await RequiredUniqueNames.giveBack(MUTEX);
    expect(released).toEqual([MUTEX]);
  });

  test("of nothing does nothing", async () => {
    await RequiredUniqueNames.giveBack(null);
    await RequiredUniqueNames.giveBack(undefined);
    expect(released).toHaveLength(0);
  });

  test("never throws: a release that fails is logged", async () => {
    getJestSpyOn(Semaphore, "release").mockRejectedValue(
      new Error("Valkey went away"),
    );
    const logged: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      logger,
      "error",
    ).mockImplementation(() => {
      return undefined as never;
    });

    await expect(RequiredUniqueNames.giveBack(MUTEX)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
  });
});

describe("the lock's key", () => {
  const key: (name: string, projectId?: ObjectID) => string = (
    name: string,
    projectId?: ObjectID,
  ): string => {
    return RequiredUniqueNames.getLockKey({
      tableName: "Monitor",
      projectId: projectId || PROJECT_ID,
      name: name,
    });
  };

  test("is one for every way a name is written", () => {
    expect(key(" api  HEALTH check")).toBe(key("API Health Check"));
    expect(key(`API${String.fromCharCode(0xa0)}Health Check`)).toBe(
      key("API Health Check"),
    );
  });

  test("names the kind and the project as Postgres writes its id, and no long name", () => {
    const written: string = key("x".repeat(500));

    expect(
      written.startsWith("Monitor:11111111-1111-4111-8111-111111111111:"),
    ).toBe(true);
    expect(written.length).toBeLessThan(120);
    expect(
      key(
        "API",
        new ObjectID("11111111-1111-4111-8111-111111111111".toUpperCase()),
      ),
    ).toBe(key("API"));
  });

  test("differs for another name, kind or project", () => {
    expect(key("API Health Check")).not.toBe(key("API Health Check 2"));
    expect(
      RequiredUniqueNames.getLockKey({
        tableName: "MonitorGroup",
        projectId: PROJECT_ID,
        name: "API Health Check",
      }),
    ).not.toBe(key("API Health Check"));
    expect(
      key(
        "API Health Check",
        new ObjectID("22222222-2222-4222-8222-222222222222"),
      ),
    ).not.toBe(key("API Health Check"));
  });
});

describe("a form's check of a name", () => {
  async function check(data: {
    name: string;
    isAlwaysUnique?: boolean;
    exceptId?: ObjectID | null;
  }): Promise<UniqueNameCheckAnswer> {
    return await RequiredUniqueNames.checkName({
      service: MonitorService,
      rule: { column: "name", isAlwaysUnique: Boolean(data.isAlwaysUnique) },
      projectId: PROJECT_ID,
      name: data.name,
      exceptId: data.exceptId || null,
      props: MEMBER_PROPS,
    });
  }

  test("names the record the reader may read that has it, and whether saving would be refused", async () => {
    stubHolder(monitor({ id: HOLDER_ID, name: "API Health Check" }));

    expect(await check({ name: "api health check" })).toEqual({
      isRequired: true,
      takenBy: {
        id: HOLDER_ID.toString(),
        name: "API Health Check",
        isArchived: false,
      },
      isTakenByUnreadable: false,
    });

    isRequired = false;

    expect((await check({ name: "api health check" })).isRequired).toBe(false);
  });

  test("says an archived record has it", async () => {
    stubHolder(
      monitor({ id: HOLDER_ID, name: "API Health Check", isArchived: true }),
    );

    expect(
      (await check({ name: "API Health Check" })).takenBy?.isArchived,
    ).toBe(true);
  });

  test("of a record the reader may not read says only that saving would be refused, and only where it would", async () => {
    stubHolder(monitor({ id: HOLDER_ID, name: "Secret" }), {
      isReadable: false,
    });

    expect(await check({ name: "Secret" })).toEqual({
      isRequired: true,
      takenBy: null,
      isTakenByUnreadable: true,
    });

    isRequired = false;

    expect(await check({ name: "Secret" })).toEqual({
      isRequired: false,
      takenBy: null,
      isTakenByUnreadable: false,
    });
  });

  test("leaves out the record the form edits", async () => {
    const finds: Array<RecordedFind> = stubHolder(null);

    expect(
      await check({ name: "API Health Check", exceptId: MONITOR_ID }),
    ).toEqual({ isRequired: true, takenBy: null, isTakenByUnreadable: false });

    expect(finds[0]!.query["_id"]).toBeDefined();
  });

  test("of a kind unique always is refused-when-saved without reading the project", async () => {
    stubHolder(null);
    isRequired = false;

    expect((await check({ name: "x", isAlwaysUnique: true })).isRequired).toBe(
      true,
    );
    expect(RequiredUniqueNames.isRequiredInProject).not.toHaveBeenCalled();
  });

  test("of no name reads no record", async () => {
    const finds: Array<RecordedFind> = stubHolder(
      monitor({ id: HOLDER_ID, name: "x" }),
    );

    expect((await check({ name: "   " })).takenBy).toBeNull();
    expect(finds).toHaveLength(0);
  });
});

describe("the names a project holds more than once, of one kind", () => {
  interface Row {
    id: string;
    nameKey: string;
    count: string;
  }

  const id: (n: number) => string = (n: number): string => {
    return `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
  };

  function stubNames(
    rows: Array<Row>,
  ): Array<{ sql: string; values: unknown }> {
    const queries: Array<{ sql: string; values: unknown }> = [];

    getJestSpyOn(MonitorService, "getRepository").mockReturnValue({
      metadata: { tableName: "Monitor" },
      query: async (sql: string, values: unknown): Promise<Array<Row>> => {
        queries.push({ sql, values });
        return rows;
      },
    } as never);

    return queries;
  }

  function stubReadable(records: Array<Monitor>): Array<RecordedFind> {
    const finds: Array<RecordedFind> = [];

    getJestSpyOn(MonitorService, "findBy").mockImplementation(
      async (findBy: RecordedFind): Promise<Array<Monitor>> => {
        finds.push(findBy);
        return records;
      },
    );

    return finds;
  }

  function find(): Promise<DuplicateNamesOfKind | null> {
    return RequiredUniqueNames.findDuplicatesOfKind({
      service: MonitorService,
      projectId: PROJECT_ID,
      props: MEMBER_PROPS,
    });
  }

  test("groups the records whose names read alike, with the reader's own permissions", async () => {
    const queries: Array<{ sql: string; values: unknown }> = stubNames([
      { id: id(1), nameKey: "api health check", count: "2" },
      { id: id(2), nameKey: "api health check", count: "2" },
      { id: id(3), nameKey: "web", count: "3" },
      { id: id(4), nameKey: "web", count: "3" },
      { id: id(5), nameKey: "web", count: "3" },
    ]);

    const created: Date = new Date("2026-11-05T10:00:00.000Z");
    const one: Monitor = monitor({
      id: new ObjectID(id(1)),
      name: "API Health Check",
    });
    one.createdAt = created;
    const two: Monitor = monitor({
      id: new ObjectID(id(2)),
      name: "api health  check",
      isArchived: true,
    });
    const web: Monitor = monitor({ id: new ObjectID(id(4)), name: "Web" });

    const finds: Array<RecordedFind> = stubReadable([one, two, web]);

    expect(await find()).toEqual({
      tableName: "Monitor",
      pluralName: "Monitors",
      groupCount: 2,
      groups: [
        {
          name: "API Health Check",
          count: 2,
          records: [
            {
              id: id(1),
              name: "API Health Check",
              createdAt: created.toISOString(),
              isArchived: false,
            },
            {
              id: id(2),
              name: "api health check",
              createdAt: null,
              isArchived: true,
            },
          ],
        },
        {
          name: "Web",
          count: 3,
          records: [
            { id: id(4), name: "Web", createdAt: null, isArchived: false },
          ],
        },
      ],
    });

    // The names are read as the rule compares them, in the project, in service.
    expect(queries[0]!.sql).toContain(`LOWER(BTRIM(REGEXP_REPLACE("name", $2`);
    expect(queries[0]!.sql).toContain(`"projectId" = $1`);
    expect(queries[0]!.sql).toContain(`"deletedAt" IS NULL`);
    expect(queries[0]!.sql).toContain(`"count" > 1`);
    expect(queries[0]!.values).toEqual([
      PROJECT_ID.toString(),
      NAME_WHITE_SPACE_RUN_PATTERN,
    ]);

    // And the records with the reader's props, never as root.
    expect(finds[0]!.props).toBe(MEMBER_PROPS);
  });

  test("is none when no name repeats", async () => {
    stubNames([]);
    const finds: Array<RecordedFind> = stubReadable([]);

    expect(await find()).toBeNull();
    expect(finds).toHaveLength(0);
  });

  test("is none for a reader who may not read the kind, or reads none of the records", async () => {
    stubNames([
      { id: id(1), nameKey: "x", count: "2" },
      { id: id(2), nameKey: "x", count: "2" },
    ]);

    getJestSpyOn(MonitorService, "findBy").mockRejectedValue(
      new NotAuthorizedException("You may not read monitors."),
    );

    expect(await find()).toBeNull();

    stubReadable([]);

    expect(await find()).toBeNull();
  });

  test("lists a bounded number of names, and of records of each, with how many there are", async () => {
    const rows: Array<Row> = [];
    let n: number = 0;

    for (
      let group: number = 0;
      group < MAX_DUPLICATE_GROUPS_PER_KIND + 5;
      group++
    ) {
      for (
        let record: number = 0;
        record < MAX_DUPLICATE_RECORDS_PER_GROUP + 2;
        record++
      ) {
        n++;
        rows.push({
          id: id(n),
          nameKey: `name ${group.toString().padStart(3, "0")}`,
          count: String(MAX_DUPLICATE_RECORDS_PER_GROUP + 2),
        });
      }
    }

    stubNames(rows);

    const finds: Array<RecordedFind> = stubReadable(
      rows.map((row: Row): Monitor => {
        return monitor({ id: new ObjectID(row.id), name: row.nameKey });
      }),
    );

    const answer: DuplicateNamesOfKind | null = await find();

    expect(answer?.groupCount).toBe(MAX_DUPLICATE_GROUPS_PER_KIND + 5);
    expect(answer?.groups).toHaveLength(MAX_DUPLICATE_GROUPS_PER_KIND);
    expect(answer?.groups[0]!.records).toHaveLength(
      MAX_DUPLICATE_RECORDS_PER_GROUP,
    );
    expect(answer?.groups[0]!.count).toBe(MAX_DUPLICATE_RECORDS_PER_GROUP + 2);

    // Only the records it lists are read.
    const askedIds: unknown = Object.values(
      (finds[0]!.query["_id"] as RawOperator).objectLiteralParameters,
    )[0];

    expect(Array.isArray(askedIds) ? askedIds.length : 0).toBe(
      MAX_DUPLICATE_GROUPS_PER_KIND * MAX_DUPLICATE_RECORDS_PER_GROUP,
    );
  });

  test("is none for a kind the setting does not hold", async () => {
    expect(
      await RequiredUniqueNames.findDuplicatesOfKind({
        service: IncidentService as never,
        projectId: PROJECT_ID,
        props: MEMBER_PROPS,
      }),
    ).toBeNull();
  });
});
