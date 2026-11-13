import Label from "../../../Models/DatabaseModels/Label";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import UpdateLimit from "../../../Server/Types/Database/UpdateLimit";
import ProjectLimitLock from "../../../Server/Utils/Database/ProjectLimitLock";
import {
  StatementContext,
  WriteStep,
} from "../../../Server/Utils/Database/StatementOutcome";
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
 * AN UPDATE HELD TO A RULE THE PROJECT'S OTHER RECORDS DECIDE
 * (DatabaseService.getUpdateLimit / updateWithinUpdateLimit).
 *
 * A service hands back an UpdateLimit for an update a rule holds - a
 * person's user overrides may not overlap (issue #7630), so an edit of an
 * override's times is one; DatabaseService then writes each row's UPDATE
 * in a transaction that first takes the rule's lock in the row's project
 * and asks the rule, with that transaction and the row's id, whether the
 * row may be written - so two writes that would break the rule together
 * cannot both pass. These hold the wiring for any service: when the rule
 * is asked, in which order, on what transaction, and what a refusal leaves
 * behind. The transaction is faked; UserOverrideOverlapPostgres races real
 * ones.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const FIRST: string = "7630dddd-0000-4000-8000-000000000001";
const SECOND: string = "7630dddd-0000-4000-8000-000000000002";

// What happened, in the order it happened.
let events: Array<string> = [];

// A service of a table with no hooks of its own, held to the rule a test sets.
class RuledLabelService extends DatabaseService<Label> {
  public updateLimit: UpdateLimit | null = null;
  public askedFor: Array<UpdateBy<Label>> = [];
  public updateErrors: Array<{
    error: Exception;
    failedStatement: StatementContext | undefined;
  }> = [];
  public successes: number = 0;

  public constructor() {
    super(Label);
  }

  protected override async onUpdatePermitted(
    _updateBy: UpdateBy<Label>,
  ): Promise<void> {
    events.push("onUpdatePermitted");
  }

  protected override async getUpdateLimit(
    updateBy: UpdateBy<Label>,
  ): Promise<UpdateLimit | null> {
    events.push("getUpdateLimit");
    this.askedFor.push(updateBy);
    return this.updateLimit;
  }

  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Label>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Label>> {
    this.successes++;
    return onUpdate;
  }

  protected override async onUpdateError(
    error: Exception,
    _onUpdate?: OnUpdate<Label> | undefined,
    failedStatement?: StatementContext | undefined,
  ): Promise<Exception> {
    this.updateErrors.push({ error: error, failedStatement: failedStatement });
    return error;
  }
}

let service: RuledLabelService;
let table: InMemoryTable;
let transactions: number;
let transactionManager: EntityManager;

// A rule that records each row it was asked about, and refuses the ones it is told to.
function ruleThat(data: { refuses: Array<string> }): UpdateLimit {
  return {
    limitName: "labels-rule",
    check: async (manager: EntityManager, rowId: ObjectID): Promise<void> => {
      events.push(`check ${rowId.toString().toLowerCase()}`);
      expect(manager).toBe(transactionManager);

      if (data.refuses.includes(rowId.toString().toLowerCase())) {
        throw new BadDataException("This row may not be written so.");
      }
    },
  };
}

beforeEach(() => {
  events = [];
  transactions = 0;
  service = new RuledLabelService();
  table = useInMemoryTable(service, [
    { _id: FIRST, projectId: PROJECT_ID.toString(), name: "First" },
    { _id: SECOND, projectId: PROJECT_ID.toString(), name: "Second" },
  ]);

  /*
   * The rule's transaction: its statements are recorded, and its
   * repository writes to the same table in memory.
   */
  transactionManager = {
    query: async (sql: string, parameters: Array<unknown>): Promise<[]> => {
      if (sql === ProjectLimitLock.LOCK_STATEMENT) {
        events.push(`lock ${String(parameters[0])}`);
        return [];
      }

      events.push(sql);
      return [];
    },
    getRepository: (target: unknown): unknown => {
      expect(target).toBe("Label");
      return {
        update: async (
          criteria: unknown,
          values: unknown,
        ): Promise<unknown> => {
          events.push("update in the rule's transaction");
          return await table.repository.update(criteria, values);
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

const LOCK: string = `lock ${ProjectLimitLock.getLockKey({
  limitName: "labels-rule",
  projectId: PROJECT_ID,
})}`;

async function rename(
  id: string,
  name: string,
  props: { ignoreHooks?: boolean } = {},
): Promise<number> {
  return await service.updateOneById({
    id: new ObjectID(id),
    data: { name: name },
    props: { isRoot: true, tenantId: PROJECT_ID, ...props },
  });
}

const nameOf: (id: string) => unknown = (id: string): unknown => {
  return table.get(id)?.["name"];
};

describe("an update no rule holds", () => {
  test("is written by update() on its own, with no lock taken", async () => {
    await rename(FIRST, "No rule");

    expect(nameOf(FIRST)).toBe("No rule");
    expect(transactions).toBe(0);
    expect(events).toEqual(["onUpdatePermitted", "getUpdateLimit"]);
  });
});

describe("an update a rule holds", () => {
  test("the lock first, in the row's project, then the rule asked about the row on that transaction, then the UPDATE in it", async () => {
    service.updateLimit = ruleThat({ refuses: [] });

    await rename(FIRST, "Allowed");

    expect(nameOf(FIRST)).toBe("Allowed");
    expect(transactions).toBe(1);
    expect(events).toEqual([
      "onUpdatePermitted",
      "getUpdateLimit",
      LOCK,
      `check ${FIRST}`,
      "update in the rule's transaction",
    ]);
    expect(service.successes).toBe(1);
  });

  test("refused: in the rule's own words, nothing written, nothing announced", async () => {
    service.updateLimit = ruleThat({ refuses: [FIRST] });

    await expect(rename(FIRST, "Refused")).rejects.toThrow(
      new BadDataException("This row may not be written so."),
    );

    expect(nameOf(FIRST)).toBe("First");
    expect(table.updates).toEqual([]);
    expect(service.successes).toBe(0);
    expect(events).toEqual([
      "onUpdatePermitted",
      "getUpdateLimit",
      LOCK,
      `check ${FIRST}`,
    ]);
  });

  /*
   * The refusal ends the UPDATE's own transaction, which commits nothing:
   * onUpdateError is told the write itself failed, in a transaction of its
   * own.
   */
  test("refused, onUpdateError is told the write itself failed, in its own transaction", async () => {
    service.updateLimit = ruleThat({ refuses: [FIRST] });

    await expect(rename(FIRST, "Refused")).rejects.toBeInstanceOf(
      BadDataException,
    );

    expect(service.updateErrors).toHaveLength(1);
    expect(service.updateErrors[0]!.failedStatement).toEqual({
      failedStep: WriteStep.Write,
      inOwnTransaction: true,
    });
  });

  test("is asked of an update that skips its hooks too: a rule holds on every path", async () => {
    service.updateLimit = ruleThat({ refuses: [FIRST] });

    await expect(
      rename(FIRST, "Hookless", { ignoreHooks: true }),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(service.askedFor).toHaveLength(1);
    expect(nameOf(FIRST)).toBe("First");
  });

  test("is asked once per update, with the update as it will be written", async () => {
    service.updateLimit = ruleThat({ refuses: [] });

    await rename(FIRST, "Asked once");

    expect(service.askedFor).toHaveLength(1);
    expect(service.askedFor[0]!.data).toEqual({ name: "Asked once" });
  });

  test("each row is decided in a transaction of its own, about that row", async () => {
    service.updateLimit = ruleThat({ refuses: [] });

    await service.updateBy({
      query: {},
      data: { name: "Both" },
      limit: 10,
      skip: 0,
      props: { isRoot: true, tenantId: PROJECT_ID },
    });

    expect(nameOf(FIRST)).toBe("Both");
    expect(nameOf(SECOND)).toBe("Both");
    expect(transactions).toBe(2);
    expect(
      events.filter((event: string): boolean => {
        return event.startsWith("check ");
      }),
    ).toEqual([`check ${FIRST}`, `check ${SECOND}`]);
  });

  test("an update that matches no row asks nothing", async () => {
    service.updateLimit = ruleThat({ refuses: [] });

    await service.updateOneById({
      id: new ObjectID("7630dddd-0000-4000-8000-0000000000ff"),
      data: { name: "Nobody" },
      props: { isRoot: true, tenantId: PROJECT_ID },
    });

    expect(service.askedFor).toHaveLength(0);
    expect(transactions).toBe(0);
  });
});
