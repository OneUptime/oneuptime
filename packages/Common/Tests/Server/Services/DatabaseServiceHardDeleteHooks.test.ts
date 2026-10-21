import DatabaseService from "../../../Server/Services/DatabaseService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import StatusPageOverviewCache from "../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import Exception from "../../../Types/Exception/Exception";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A HARD DELETE'S HOOKS (DatabaseService.hardDeleteBy): the retention job's
 * purge runs onBeforeDelete like any delete, but not onDeleteSuccess, whose
 * work is for the rows a person deletes. What onBeforeDelete took for the
 * write - a lock - is handed back through onHardDeleteSuccess once the
 * delete is done, or through onDeleteError when it fails.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const NOTE_ID: ObjectID = ObjectID.generate();

class RecordingService extends DatabaseService<IncidentInternalNote> {
  public calls: Array<string> = [];

  public constructor() {
    super(IncidentInternalNote);
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<IncidentInternalNote>,
  ): Promise<OnDelete<IncidentInternalNote>> {
    this.calls.push("before");
    return { deleteBy, carryForward: "taken" };
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<IncidentInternalNote>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<IncidentInternalNote>> {
    this.calls.push("delete success");
    return onDelete;
  }

  protected override async onHardDeleteSuccess(
    onDelete: OnDelete<IncidentInternalNote>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<IncidentInternalNote>> {
    this.calls.push(
      `hard delete success: ${String(onDelete.carryForward)}: ${itemIdsBeforeDelete
        .map((id: ObjectID): string => {
          return id.toString();
        })
        .join(",")}`,
    );
    return onDelete;
  }

  protected override async onDeleteError(
    error: Exception,
    onDelete?: OnDelete<IncidentInternalNote> | undefined,
  ): Promise<Exception> {
    this.calls.push(`delete error: ${String(onDelete?.carryForward)}`);
    return error;
  }
}

describe("a hard delete's hooks", () => {
  let service: RecordingService;
  let deleteFails: boolean;

  beforeEach(() => {
    service = new RecordingService();
    deleteFails = false;

    const note: IncidentInternalNote = new IncidentInternalNote();
    note.id = NOTE_ID;
    note.projectId = PROJECT_ID;

    jest.spyOn(service as never, "_findBy").mockResolvedValue([note] as never);
    jest
      .spyOn(service as never, "readRowsShowingImages")
      .mockResolvedValue([note] as never);
    jest
      .spyOn(service as never, "readRowsDeletedWith")
      .mockResolvedValue([] as never);

    jest.spyOn(service, "getRepository").mockReturnValue({
      delete: async (): Promise<{ affected: number }> => {
        if (deleteFails) {
          throw new Error("The database could not delete the row");
        }

        return { affected: 1 };
      },
    } as never);

    jest
      .spyOn(PublishedImages, "afterDelete")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(StatusPageOverviewCache, "afterDelete")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("one that is done hands its own success hook what onBeforeDelete handed back and the rows it deleted, and runs no onDeleteSuccess", async () => {
    await expect(
      service.hardDeleteBy({
        query: { _id: NOTE_ID },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      }),
    ).resolves.toBe(1);

    expect(service.calls).toEqual([
      "before",
      `hard delete success: taken: ${NOTE_ID.toString()}`,
    ]);
  });

  test("one the database fails hands what onBeforeDelete handed back to onDeleteError, and runs no success hook", async () => {
    deleteFails = true;

    await expect(
      service.hardDeleteBy({
        query: { _id: NOTE_ID },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      }),
    ).rejects.toThrow("The database could not delete the row");

    expect(service.calls).toEqual(["before", "delete error: taken"]);
  });

  test("with ignoreHooks, none of them runs", async () => {
    await expect(
      service.hardDeleteBy({
        query: { _id: NOTE_ID },
        limit: 1,
        skip: 0,
        props: { isRoot: true, ignoreHooks: true },
      }),
    ).resolves.toBe(1);

    expect(service.calls).toEqual([]);
  });
});
