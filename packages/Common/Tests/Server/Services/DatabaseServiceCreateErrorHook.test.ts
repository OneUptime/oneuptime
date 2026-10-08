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
