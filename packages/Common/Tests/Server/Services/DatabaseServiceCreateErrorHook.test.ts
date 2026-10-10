import DatabaseService from "../../../Server/Services/DatabaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
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
 * A CREATE'S ERROR HOOK (DatabaseService.create): a create refused or failed
 * at any step once onBeforeCreate has run - a check after the hook, the
 * INSERT, a success hook that throws - reaches onCreateError with what
 * onBeforeCreate handed back, as an update's and a delete's reach
 * onUpdateError and onDeleteError. That is where a service gives back what
 * its hooks took for the write: a lock taken in onBeforeCreate used to be
 * held for as long as the process lived by a create refused between the
 * hook and the INSERT, which ran outside the create's try.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();

class RecordingService extends DatabaseService<IncidentInternalNote> {
  public calls: Array<string> = [];
  public errorsSeen: Array<Exception> = [];

  public constructor() {
    super(IncidentInternalNote);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<IncidentInternalNote>,
  ): Promise<OnCreate<IncidentInternalNote>> {
    this.calls.push("before");
    return { createBy, carryForward: "taken" };
  }

  protected override async onCreateSuccess(
    onCreate: OnCreate<IncidentInternalNote>,
    createdItem: IncidentInternalNote,
  ): Promise<IncidentInternalNote> {
    this.calls.push(`success: ${String(onCreate.carryForward)}`);
    return createdItem;
  }

  protected override async onCreateError(
    error: Exception,
    onCreate?: OnCreate<IncidentInternalNote> | undefined,
  ): Promise<Exception> {
    this.calls.push(
      `error: ${onCreate === undefined ? "nothing" : String(onCreate.carryForward)}`,
    );
    this.errorsSeen.push(error);
    return error;
  }
}

function note(): IncidentInternalNote {
  const internalNote: IncidentInternalNote = new IncidentInternalNote();
  internalNote.projectId = PROJECT_ID;
  internalNote.incidentId = INCIDENT_ID;
  internalNote.note = "Rolled back the deploy.";
  return internalNote;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

describe("a create's error hook", () => {
  let service: RecordingService;
  let saveFails: boolean;

  beforeEach(() => {
    service = new RecordingService();
    saveFails = false;

    jest.spyOn(service, "getRepository").mockReturnValue({
      save: async (
        entity: IncidentInternalNote,
      ): Promise<IncidentInternalNote> => {
        if (saveFails) {
          throw new Error("The database could not write the note");
        }

        entity.id = ObjectID.generate();
        return entity;
      },
    } as never);

    jest
      .spyOn(service, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(PublishedImages, "afterCreate")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a create that is saved runs the success hook, and not the error hook", async () => {
    await service.create({ data: note(), props: { isRoot: true } });

    expect(service.calls).toEqual(["before", "success: taken"]);
  });

  test("one the database fails hands what onBeforeCreate handed back to onCreateError, and runs no success hook", async () => {
    saveFails = true;

    const error: unknown = await rejectionOf(
      service.create({ data: note(), props: { isRoot: true } }),
    );

    expect((error as Error).message).toBe(
      "The database could not write the note",
    );
    expect(service.calls).toEqual(["before", "error: taken"]);
    // The error the create answers with is the one the hook was handed.
    expect(service.errorsSeen).toEqual([error]);
  });

  /*
   * Each step DatabaseService.create runs between the hook and the INSERT:
   * a create refused by any of them reaches onCreateError too. They used to
   * run outside the create's try.
   */
  const REFUSALS: Array<[string, string, boolean]> = [
    // [what refuses, the method, whether it answers synchronously]
    ["the clash check after the hook", "onBeforeCreateUniqueCheck", false],
    ["the last hook before the write", "onCreatePermitted", false],
    ["the serializing of the row", "sanitizeCreateOrUpdate", false],
    ["the check that the write inserts", "assertCreateWillInsert", true],
    ["a unique-column check", "checkUniqueColumnBy", false],
    ["the required-field check", "checkRequiredFields", true],
  ];

  test.each(REFUSALS)(
    "one refused by %s (%s) reaches onCreateError with what onBeforeCreate handed back",
    async (_what: string, method: string, isSynchronous: boolean) => {
      const refusal: BadDataException = new BadDataException(
        "This note clashes with another.",
      );

      if (isSynchronous) {
        jest
          .spyOn(service as never, method as never)
          .mockImplementation((() => {
            throw refusal;
          }) as never);
      } else {
        jest
          .spyOn(service as never, method as never)
          .mockRejectedValue(refusal as never);
      }

      const error: unknown = await rejectionOf(
        service.create({ data: note(), props: { isRoot: true } }),
      );

      expect(error).toBe(refusal);
      expect(service.calls).toEqual(["before", "error: taken"]);
    },
  );

  test("one whose success hook throws reaches onCreateError too: the hook may not have given back what it took", async () => {
    jest
      .spyOn(service as never, "onCreateSuccess")
      .mockRejectedValue(new Error("The feed could not be written") as never);

    const error: unknown = await rejectionOf(
      service.create({ data: note(), props: { isRoot: true } }),
    );

    expect((error as Error).message).toBe("The feed could not be written");
    expect(service.calls).toEqual(["before", "error: taken"]);
  });

  test("one refused before onBeforeCreate ran hands onCreateError nothing: the hook took nothing", async () => {
    // A member of no project may create nothing here.
    const error: unknown = await rejectionOf(
      service.create({
        data: note(),
        props: { userId: ObjectID.generate(), tenantId: PROJECT_ID },
      }),
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(service.calls).toEqual(["error: nothing"]);
  });

  test("with ignoreHooks no hook runs before the write, and a failed write hands onCreateError a create that carries nothing", async () => {
    saveFails = true;

    await rejectionOf(
      service.create({
        data: note(),
        props: { isRoot: true, ignoreHooks: true },
      }),
    );

    expect(service.calls).toEqual(["error: "]);
  });

  test("the database's own refusal reaches the caller in words they can act on, as before", async () => {
    jest.spyOn(service, "getRepository").mockReturnValue({
      save: async (): Promise<never> => {
        throw Object.assign(new Error("duplicate key"), {
          code: "23505",
          detail: "Key (_id)=(x) already exists.",
          table: "IncidentInternalNote",
        });
      },
    } as never);

    const error: unknown = await rejectionOf(
      service.create({ data: note(), props: { isRoot: true } }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(service.calls).toEqual(["before", "error: taken"]);
  });
});

/*
 * THE CREATE'S ONE OnCreate (DatabaseService.create): the object
 * onBeforeCreate hands back is the very one onCreatePermitted,
 * onCreateSuccess and onCreateError are handed, so a service gives back what
 * its hooks took through that object - by the OnCreate itself, by the create
 * a later hook was handed, or by what it carries forward - however the create
 * ends. It used to hand onCreatePermitted and onCreateSuccess objects of its
 * own and onCreateError what onBeforeCreate returned: a hook that handed back
 * a create of its own made onCreateError look a lock up by the wrong create,
 * and keep it.
 */

type HookSeen = {
  hook: "permitted" | "success" | "error";
  onCreate: OnCreate<IncidentInternalNote> | undefined;
  createBy: CreateBy<IncidentInternalNote> | undefined;
  carryForward: unknown;
};

class OneObjectService extends DatabaseService<IncidentInternalNote> {
  // What onBeforeCreate handed back, each create.
  public handedBack: Array<OnCreate<IncidentInternalNote>> = [];
  public seen: Array<HookSeen> = [];
  // onBeforeCreate hands back a create of its own, as a hook may.
  public handsBackNewCreate: boolean = false;
  // onCreatePermitted carries something further forward on the object.
  public carriesForwardInPermitted: boolean = false;
  // A lock taken in onCreatePermitted, kept by the OnCreate it is handed...
  public lockByOnCreate: WeakMap<OnCreate<IncidentInternalNote>, string> =
    new WeakMap();
  // ...and one kept by the create that OnCreate holds then.
  public lockByCreateBy: WeakMap<CreateBy<IncidentInternalNote>, string> =
    new WeakMap();
  public taken: Array<string> = [];
  public givenBack: Array<string> = [];

  public constructor() {
    super(IncidentInternalNote);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<IncidentInternalNote>,
  ): Promise<OnCreate<IncidentInternalNote>> {
    const onCreate: OnCreate<IncidentInternalNote> = {
      createBy: this.handsBackNewCreate ? { ...createBy } : createBy,
      carryForward: { from: "onBeforeCreate" },
    };

    this.handedBack.push(onCreate);

    return onCreate;
  }

  protected override async onCreatePermitted(
    onCreate: OnCreate<IncidentInternalNote>,
  ): Promise<void> {
    this.record("permitted", onCreate);

    this.lockByOnCreate.set(onCreate, "the lock kept by the OnCreate");
    this.lockByCreateBy.set(onCreate.createBy, "the lock kept by the create");
    this.taken.push(
      "the lock kept by the OnCreate",
      "the lock kept by the create",
    );

    if (this.carriesForwardInPermitted) {
      onCreate.carryForward = { from: "onCreatePermitted" };
    }
  }

  protected override async onCreateSuccess(
    onCreate: OnCreate<IncidentInternalNote>,
    createdItem: IncidentInternalNote,
  ): Promise<IncidentInternalNote> {
    this.record("success", onCreate);
    this.giveBack(onCreate);
    return createdItem;
  }

  protected override async onCreateError(
    error: Exception,
    onCreate?: OnCreate<IncidentInternalNote> | undefined,
  ): Promise<Exception> {
    this.record("error", onCreate);

    if (onCreate) {
      this.giveBack(onCreate);
    }

    return error;
  }

  private record(
    hook: HookSeen["hook"],
    onCreate: OnCreate<IncidentInternalNote> | undefined,
  ): void {
    this.seen.push({
      hook: hook,
      onCreate: onCreate,
      createBy: onCreate?.createBy,
      carryForward: onCreate?.carryForward,
    });
  }

  // Each lock this create holds, given back once.
  private giveBack(onCreate: OnCreate<IncidentInternalNote>): void {
    const byOnCreate: string | undefined = this.lockByOnCreate.get(onCreate);

    if (byOnCreate) {
      this.lockByOnCreate.delete(onCreate);
      this.givenBack.push(byOnCreate);
    }

    const byCreateBy: string | undefined = this.lockByCreateBy.get(
      onCreate.createBy,
    );

    if (byCreateBy) {
      this.lockByCreateBy.delete(onCreate.createBy);
      this.givenBack.push(byCreateBy);
    }
  }
}

describe("a create's one OnCreate", () => {
  let service: OneObjectService;
  let saveFails: boolean;
  let saved: Array<IncidentInternalNote>;

  beforeEach(() => {
    service = new OneObjectService();
    saveFails = false;
    saved = [];

    jest.spyOn(service, "getRepository").mockReturnValue({
      save: async (
        entity: IncidentInternalNote,
      ): Promise<IncidentInternalNote> => {
        if (saveFails) {
          throw new Error("The database could not write the note");
        }

        saved.push(entity);
        entity.id = ObjectID.generate();
        return entity;
      },
    } as never);

    jest
      .spyOn(service, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(PublishedImages, "afterCreate")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("onCreatePermitted and onCreateSuccess are handed the very object onBeforeCreate handed back", async () => {
    await service.create({ data: note(), props: { isRoot: true } });

    expect(service.handedBack).toHaveLength(1);
    expect(
      service.seen.map((seen: HookSeen): string => {
        return seen.hook;
      }),
    ).toEqual(["permitted", "success"]);

    for (const seen of service.seen) {
      expect(seen.onCreate).toBe(service.handedBack[0]);
    }
  });

  test("onCreateError is handed that same object, the one onCreatePermitted was handed", async () => {
    saveFails = true;

    await rejectionOf(
      service.create({ data: note(), props: { isRoot: true } }),
    );

    expect(
      service.seen.map((seen: HookSeen): string => {
        return seen.hook;
      }),
    ).toEqual(["permitted", "error"]);
    expect(service.seen[1]!.onCreate).toBe(service.seen[0]!.onCreate);
    expect(service.seen[1]!.onCreate).toBe(service.handedBack[0]);
  });

  test("from onCreatePermitted on, it holds the create as it is written: the caller's create, with the row the INSERT writes - even when onBeforeCreate handed back a create of its own", async () => {
    service.handsBackNewCreate = true;

    const createBy: CreateBy<IncidentInternalNote> = {
      data: note(),
      props: { isRoot: true },
    };

    await service.create(createBy);

    expect(service.handedBack[0]!.createBy).toBe(createBy);
    expect(service.seen[0]!.createBy).toBe(createBy);
    expect(service.seen[1]!.createBy).toBe(createBy);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toBe(createBy.data);
  });

  /*
   * Each step that can fail once onCreatePermitted has taken its locks: the
   * locks are given back by onCreateError, once - whether onBeforeCreate
   * handed back the caller's create or one of its own, and whether the lock
   * is kept by the OnCreate or by the create it holds.
   */
  const FAILURES: Array<[string, string | null, boolean]> = [
    // [what fails, the method made to fail (null: the INSERT), synchronously]
    ["the INSERT", null, false],
    ["the serializing of the row", "sanitizeCreateOrUpdate", false],
    ["the check that the write inserts", "assertCreateWillInsert", true],
    ["a success hook that throws", "onCreateSuccess", false],
  ];

  describe.each([
    ["the caller's create", false],
    ["a create of its own", true],
  ])(
    "when onBeforeCreate hands back %s",
    (_what: string, handsBackNewCreate: boolean) => {
      test.each(FAILURES)(
        "a create that fails at %s gives back every lock onCreatePermitted took, once",
        async (
          _failure: string,
          method: string | null,
          isSynchronous: boolean,
        ) => {
          service.handsBackNewCreate = handsBackNewCreate;

          const failure: BadDataException = new BadDataException(
            "This note could not be written.",
          );

          if (method === null) {
            saveFails = true;
          } else if (isSynchronous) {
            jest
              .spyOn(service as never, method as never)
              .mockImplementation((() => {
                throw failure;
              }) as never);
          } else {
            jest
              .spyOn(service as never, method as never)
              .mockRejectedValue(failure as never);
          }

          await rejectionOf(
            service.create({ data: note(), props: { isRoot: true } }),
          );

          expect(service.taken).toEqual([
            "the lock kept by the OnCreate",
            "the lock kept by the create",
          ]);
          expect([...service.givenBack].sort()).toEqual(
            [...service.taken].sort(),
          );
        },
      );

      test("a create that is saved gives back every lock onCreatePermitted took, once", async () => {
        service.handsBackNewCreate = handsBackNewCreate;

        await service.create({ data: note(), props: { isRoot: true } });

        expect([...service.givenBack].sort()).toEqual(
          [...service.taken].sort(),
        );
        expect(service.givenBack).toHaveLength(2);
      });
    },
  );

  test("what a later hook carries forward on the object reaches onCreateError", async () => {
    service.carriesForwardInPermitted = true;
    saveFails = true;

    await rejectionOf(
      service.create({ data: note(), props: { isRoot: true } }),
    );

    expect(service.seen[1]!.hook).toBe("error");
    expect(service.seen[1]!.carryForward).toEqual({
      from: "onCreatePermitted",
    });
  });

  test("...and onCreateSuccess", async () => {
    service.carriesForwardInPermitted = true;

    await service.create({ data: note(), props: { isRoot: true } });

    expect(service.seen[1]!.hook).toBe("success");
    expect(service.seen[1]!.carryForward).toEqual({
      from: "onCreatePermitted",
    });
  });

  test("two creates are handed two objects: one create's locks are never another's", async () => {
    saveFails = true;

    await rejectionOf(
      service.create({ data: note(), props: { isRoot: true } }),
    );

    saveFails = false;

    await service.create({ data: note(), props: { isRoot: true } });

    expect(service.handedBack).toHaveLength(2);
    expect(service.handedBack[0]).not.toBe(service.handedBack[1]);
    expect(service.givenBack).toHaveLength(4);
  });
});
