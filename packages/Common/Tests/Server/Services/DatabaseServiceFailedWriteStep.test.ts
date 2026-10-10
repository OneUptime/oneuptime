import DatabaseService from "../../../Server/Services/DatabaseService";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import StatementOutcome, {
  StatementContext,
  WriteStep,
} from "../../../Server/Utils/Database/StatementOutcome";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import StatusPageOverviewCache from "../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ObjectID from "../../../Types/ObjectID";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import {
  COMMIT_STATEMENT,
  INSERT_STATEMENT,
  UPDATE_STATEMENT,
  clientTimeout,
} from "../TestingUtils/StatementFailures";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

// Every failure below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * WHICH STEP OF A WRITE FAILED, AS DATABASESERVICE TELLS A SERVICE'S ERROR
 * HOOKS (Server/Utils/Database/WriteProgress).
 *
 * A create, update or delete that fails once its before-hook ran reaches its
 * error hook with what failed - and with which step it was: the
 * repository's own statement (the INSERT, in save()'s own transaction; a
 * row's UPDATE; the DELETE), or one around it - a check before the write, a
 * step after it, a success hook. A statement around the write applied
 * nothing of it (StatementOutcome), however it failed: a service holding a
 * lock for the write gives it back at once, where it used to judge by the
 * failed statement's first word - and keep it after a helper's own UPDATE
 * timed out, as if the write itself might still land.
 *
 * These run the real pipeline, with the table in memory.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();
const NOTE_ID: string = ObjectID.generate().toString();

type Hook = "create" | "update" | "delete";

class RecordingService extends DatabaseService<IncidentInternalNote> {
  public failures: Array<{
    hook: Hook;
    error: Exception;
    failedStatement: StatementContext | undefined;
  }> = [];

  public constructor() {
    super(IncidentInternalNote);
  }

  protected override async onCreateError(
    error: Exception,
    _onCreate?: OnCreate<IncidentInternalNote> | undefined,
    failedStatement?: StatementContext | undefined,
  ): Promise<Exception> {
    this.failures.push({ hook: "create", error, failedStatement });
    return error;
  }

  protected override async onUpdateError(
    error: Exception,
    _onUpdate?: OnUpdate<IncidentInternalNote> | undefined,
    failedStatement?: StatementContext | undefined,
  ): Promise<Exception> {
    this.failures.push({ hook: "update", error, failedStatement });
    return error;
  }

  protected override async onDeleteError(
    error: Exception,
    _onDelete?: OnDelete<IncidentInternalNote> | undefined,
    failedStatement?: StatementContext | undefined,
  ): Promise<Exception> {
    this.failures.push({ hook: "delete", error, failedStatement });
    return error;
  }
}

const THE_INSERT: StatementContext = {
  failedStep: WriteStep.Write,
  inOwnTransaction: true,
};

const A_ROW_WRITE: StatementContext = {
  failedStep: WriteStep.Write,
  inOwnTransaction: false,
};

const AROUND_THE_WRITE: StatementContext = {
  failedStep: WriteStep.AroundWrite,
};

function note(): IncidentInternalNote {
  const internalNote: IncidentInternalNote = new IncidentInternalNote();
  internalNote.projectId = PROJECT_ID;
  internalNote.incidentId = INCIDENT_ID;
  internalNote.note = "Rolled back the deploy.";
  return internalNote;
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the write to fail.");
}

describe("which step of a write failed reaches its error hook", () => {
  let service: RecordingService;
  let table: InMemoryTable;

  beforeEach(() => {
    service = new RecordingService();
    table = useInMemoryTable(service, [
      {
        _id: NOTE_ID,
        projectId: PROJECT_ID.toString(),
        incidentId: INCIDENT_ID.toString(),
        note: "Paged the database team.",
      },
    ]);

    getJestSpyOn(PublishedImages, "afterCreate").mockResolvedValue(undefined);
    getJestSpyOn(PublishedImages, "afterUpdate").mockResolvedValue(undefined);
    getJestSpyOn(PublishedImages, "afterDelete").mockResolvedValue(undefined);
    getJestSpyOn(StatusPageOverviewCache, "afterDelete").mockResolvedValue(
      undefined,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function create(): Promise<IncidentInternalNote> {
    return service.create({ data: note(), props: { isRoot: true } });
  }

  function update(): Promise<number> {
    return service.updateOneById({
      id: new ObjectID(NOTE_ID),
      data: { note: "Rolled back the deploy." },
      props: { isRoot: true },
    });
  }

  function remove(): Promise<number> {
    return service.deleteOneById({
      id: new ObjectID(NOTE_ID),
      props: { isRoot: true },
    });
  }

  function hardDelete(): Promise<number> {
    return service.hardDeleteBy({
      query: { _id: NOTE_ID },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });
  }

  describe("a create", () => {
    test("whose INSERT failed: the write itself, in save()'s own transaction", async () => {
      table.repository.save.mockRejectedValueOnce(
        clientTimeout(INSERT_STATEMENT),
      );

      const error: unknown = await failureOf(create());

      expect(service.failures).toEqual([
        { hook: "create", error, failedStatement: THE_INSERT },
      ]);
      // An INSERT whose answer never came is rolled back with its transaction.
      expect(
        StatementOutcome.mayStillApply(
          error,
          service.failures[0]!.failedStatement,
        ),
      ).toBe(false);
    });

    test("whose COMMIT went unanswered may still land", async () => {
      table.repository.save.mockRejectedValueOnce(
        clientTimeout(COMMIT_STATEMENT),
      );

      const error: unknown = await failureOf(create());

      expect(service.failures[0]!.failedStatement).toEqual(THE_INSERT);
      expect(
        StatementOutcome.mayStillApply(
          error,
          service.failures[0]!.failedStatement,
        ),
      ).toBe(true);
    });

    test("refused by a check before the INSERT: around the write", async () => {
      getJestSpyOn(service as never, "onCreatePermitted").mockRejectedValue(
        new BadDataException("Refused.") as never,
      );

      await failureOf(create());

      expect(service.failures).toHaveLength(1);
      expect(service.failures[0]!.failedStatement).toEqual(AROUND_THE_WRITE);
      expect(table.inserts).toEqual([]);
    });

    test("failed by a statement after the INSERT: around the write, which was committed", async () => {
      // A helper's own UPDATE, unanswered: by its first word it would count as the write.
      getJestSpyOn(PublishedImages, "afterCreate").mockRejectedValue(
        clientTimeout(UPDATE_STATEMENT),
      );

      const error: unknown = await failureOf(create());

      expect(table.inserts).toHaveLength(1);
      expect(service.failures[0]!.failedStatement).toEqual(AROUND_THE_WRITE);
      expect(
        StatementOutcome.mayStillApply(
          error,
          service.failures[0]!.failedStatement,
        ),
      ).toBe(false);
    });

    test("failed in its success hook: around the write", async () => {
      getJestSpyOn(service as never, "onCreateSuccess").mockRejectedValue(
        clientTimeout(UPDATE_STATEMENT) as never,
      );

      await failureOf(create());

      expect(service.failures[0]!.failedStatement).toEqual(AROUND_THE_WRITE);
    });
  });

  describe("an update", () => {
    test("whose UPDATE failed: the write itself, committed on its own", async () => {
      table.repository.update.mockRejectedValueOnce(
        clientTimeout(UPDATE_STATEMENT),
      );

      const error: unknown = await failureOf(update());

      expect(service.failures).toEqual([
        { hook: "update", error, failedStatement: A_ROW_WRITE },
      ]);
      // An UPDATE whose answer never came may still land.
      expect(
        StatementOutcome.mayStillApply(
          error,
          service.failures[0]!.failedStatement,
        ),
      ).toBe(true);
    });

    test("refused right before the write: around it", async () => {
      getJestSpyOn(service as never, "onUpdatePermitted").mockRejectedValue(
        clientTimeout('SELECT "_id" FROM "IncidentInternalNote"') as never,
      );

      await failureOf(update());

      expect(service.failures[0]!.failedStatement).toEqual(AROUND_THE_WRITE);
      expect(table.updates).toEqual([]);
    });

    test("failed in its success hook, once the UPDATE was done: around the write", async () => {
      getJestSpyOn(service as never, "onUpdateSuccess").mockRejectedValue(
        clientTimeout(UPDATE_STATEMENT) as never,
      );

      const error: unknown = await failureOf(update());

      expect(table.updates).toHaveLength(1);
      expect(service.failures[0]!.failedStatement).toEqual(AROUND_THE_WRITE);
      expect(
        StatementOutcome.mayStillApply(
          error,
          service.failures[0]!.failedStatement,
        ),
      ).toBe(false);
    });
  });

  describe("a delete", () => {
    test("whose DELETE failed: the write itself, committed on its own", async () => {
      table.repository.delete.mockRejectedValueOnce(clientTimeout());

      const error: unknown = await failureOf(remove());

      expect(service.failures).toEqual([
        { hook: "delete", error, failedStatement: A_ROW_WRITE },
      ]);
    });

    test("failed by a read right before the DELETE: around it", async () => {
      getJestSpyOn(service as never, "readRowsDeletedWith").mockRejectedValue(
        new Error("The read failed") as never,
      );

      await failureOf(remove());

      expect(service.failures[0]!.failedStatement).toEqual(AROUND_THE_WRITE);
      expect(table.deletes).toEqual([]);
    });

    test("failed in its success hook, once the DELETE was done: around the write", async () => {
      getJestSpyOn(service as never, "onDeleteSuccess").mockRejectedValue(
        clientTimeout(UPDATE_STATEMENT) as never,
      );

      await failureOf(remove());

      expect(table.deletes).toEqual([NOTE_ID]);
      expect(service.failures[0]!.failedStatement).toEqual(AROUND_THE_WRITE);
    });
  });

  describe("a hard delete", () => {
    test("whose DELETE failed: the write itself, committed on its own", async () => {
      table.repository.delete.mockRejectedValueOnce(clientTimeout());

      await failureOf(hardDelete());

      expect(service.failures[0]!.failedStatement).toEqual(A_ROW_WRITE);
    });

    test("failed by a read right before the DELETE: around it", async () => {
      getJestSpyOn(service as never, "readRowsDeletedWith").mockRejectedValue(
        new Error("The read failed") as never,
      );

      await failureOf(hardDelete());

      expect(service.failures[0]!.failedStatement).toEqual(AROUND_THE_WRITE);
    });
  });

  test("a write that is done reaches no error hook", async () => {
    await create();
    await update();
    await remove();

    expect(service.failures).toEqual([]);
  });
});
