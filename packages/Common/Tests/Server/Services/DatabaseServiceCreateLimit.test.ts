import Label from "../../../Models/DatabaseModels/Label";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import CreateLimit from "../../../Server/Types/Database/CreateLimit";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ProjectLimitLock from "../../../Server/Utils/Database/ProjectLimitLock";
import {
  StatementContext,
  WriteStep,
} from "../../../Server/Utils/Database/StatementOutcome";
import Color from "../../../Types/Color";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ObjectID from "../../../Types/ObjectID";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, EntityManager } from "typeorm";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * A CREATE HELD TO A LIMIT ON HOW MANY THE PROJECT MAY HAVE
 * (DatabaseService.getCreateLimit / insertWithinCreateLimit).
 *
 * A service hands back a CreateLimit for a create it limits; DatabaseService
 * then inserts the record in a transaction that first takes the limit's lock
 * in the project and asks the limit, with that transaction, whether the
 * project has room - so two creates at the limit cannot both pass. The
 * active monitor limit is the first to use it (MonitorService); any other
 * limit a project has - seats, the Free plan's status pages - can use it the
 * same way. These hold the wiring for any service: when the limit is asked,
 * in which order, on what transaction, and what a refusal leaves behind.
 * The transaction is faked; ActiveMonitorLimitPostgres races real ones.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

// What happened, in the order it happened.
let events: Array<string> = [];

// A service of a table with no hooks of its own, held to the limit a test sets.
class LimitedLabelService extends DatabaseService<Label> {
  public createLimit: CreateLimit | null = null;
  public askedFor: Array<CreateBy<Label>> = [];
  public createErrors: Array<{
    error: Exception;
    failedStatement: StatementContext | undefined;
  }> = [];
  public successes: number = 0;

  public constructor() {
    super(Label);
  }

  protected override async onCreatePermitted(
    _onCreate: OnCreate<Label>,
  ): Promise<void> {
    events.push("onCreatePermitted");
  }

  protected override async getCreateLimit(
    createBy: CreateBy<Label>,
  ): Promise<CreateLimit | null> {
    events.push("getCreateLimit");
    this.askedFor.push(createBy);
    return this.createLimit;
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<Label>,
    createdItem: Label,
  ): Promise<Label> {
    this.successes++;
    return createdItem;
  }

  protected override async onCreateError(
    error: Exception,
    _onCreate?: OnCreate<Label> | undefined,
    failedStatement?: StatementContext | undefined,
  ): Promise<Exception> {
    this.createErrors.push({ error: error, failedStatement: failedStatement });
    return error;
  }
}

let service: LimitedLabelService;
let table: InMemoryTable;
let transactions: number;
let transactionManager: EntityManager;

function newLabel(name: string): Label {
  const label: Label = new Label();
  label.name = name;
  label.color = Color.fromString("#22c55e");
  return label;
}

// A limit that records what it was asked with, and refuses when told to.
function limitThat(data: { refuses: boolean }): CreateLimit {
  return {
    limitName: "labels",
    projectId: PROJECT_ID,
    check: async (manager: EntityManager): Promise<void> => {
      events.push("check");
      expect(manager).toBe(transactionManager);

      if (data.refuses) {
        throw new BadDataException("This project has no room for one more.");
      }
    },
  };
}

beforeEach(() => {
  events = [];
  transactions = 0;
  service = new LimitedLabelService();
  table = useInMemoryTable(service, []);

  /*
   * The limit's transaction: its statements are recorded, and its
   * repository writes to the same table in memory.
   */
  transactionManager = {
    query: async (sql: string): Promise<[]> => {
      events.push(sql === ProjectLimitLock.LOCK_STATEMENT ? "lock" : sql);
      return [];
    },
    getRepository: (target: unknown): unknown => {
      expect(target).toBe("Label");
      return {
        save: async (record: Label): Promise<Label> => {
          events.push("save in the limit's transaction");
          return (await table.repository.save(record)) as Label;
        },
      };
    },
  } as unknown as EntityManager;

  jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
  jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
    transaction: async (
      run: (manager: EntityManager) => Promise<unknown>,
    ): Promise<unknown> => {
      transactions++;
      return await run(transactionManager);
    },
  } as unknown as DataSource);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function create(
  name: string,
  props: { ignoreHooks?: boolean } = {},
): Promise<Label> {
  return await service.create({
    data: newLabel(name),
    props: { isRoot: true, tenantId: PROJECT_ID, ...props },
  });
}

describe("a create no limit holds", () => {
  test("is inserted by save() in its own transaction, with no lock taken", async () => {
    const created: Label = await create("No limit");

    expect(created.id).toBeTruthy();
    expect(table.inserts).toHaveLength(1);
    expect(transactions).toBe(0);
    expect(events).toEqual(["onCreatePermitted", "getCreateLimit"]);
  });
});

describe("a create a limit holds", () => {
  test("with room: the lock first, then the limit asked on that transaction, then the INSERT in it", async () => {
    service.createLimit = limitThat({ refuses: false });

    const created: Label = await create("Fits");

    expect(created.id).toBeTruthy();
    expect(transactions).toBe(1);
    expect(events).toEqual([
      "onCreatePermitted",
      "getCreateLimit",
      "lock",
      "check",
      "save in the limit's transaction",
    ]);
    expect(table.inserts).toHaveLength(1);
    expect(service.successes).toBe(1);
  });

  test("with no room: refused in the limit's own words, nothing written, nothing announced", async () => {
    service.createLimit = limitThat({ refuses: true });

    await expect(create("Does not fit")).rejects.toThrow(
      new BadDataException("This project has no room for one more."),
    );

    expect(table.inserts).toEqual([]);
    expect(table.rows).toEqual([]);
    expect(service.successes).toBe(0);
    expect(events).toEqual([
      "onCreatePermitted",
      "getCreateLimit",
      "lock",
      "check",
    ]);
  });

  /*
   * The refusal ends the INSERT's own transaction, which commits nothing:
   * onCreateError is told the write itself failed, in a transaction of its
   * own, so a service that took something for the create gives it back.
   */
  test("with no room, onCreateError is told the write itself failed, in its own transaction", async () => {
    service.createLimit = limitThat({ refuses: true });

    await expect(create("Does not fit")).rejects.toBeInstanceOf(
      BadDataException,
    );

    expect(service.createErrors).toHaveLength(1);
    expect(service.createErrors[0]!.failedStatement).toEqual({
      failedStep: WriteStep.Write,
      inOwnTransaction: true,
    });
  });

  test("is asked of a create that skips its hooks too: a limit holds on every path", async () => {
    service.createLimit = limitThat({ refuses: true });

    await expect(
      create("Hookless", { ignoreHooks: true }),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(service.askedFor).toHaveLength(1);
    expect(table.inserts).toEqual([]);
  });

  test("is asked once per create, with the create as it will be written", async () => {
    service.createLimit = limitThat({ refuses: false });

    await create("Asked once");

    expect(service.askedFor).toHaveLength(1);
    expect(service.askedFor[0]!.data.name).toBe("Asked once");
    expect(service.askedFor[0]!.data.projectId?.toString()).toBe(
      PROJECT_ID.toString(),
    );
  });
});
